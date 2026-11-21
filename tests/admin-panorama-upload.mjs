import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/assets/panorama-upload.js', import.meta.url), 'utf8');

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.classList = { names: new Set(), add: name => this.classList.names.add(name), remove: name => this.classList.names.delete(name) };
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
  }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  async trigger(name) { for (const listener of this.listeners[name] || []) await listener({ preventDefault() {} }); }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  setAttribute(name, value) { this[name] = value; }
}

function harness(mode, responses) {
  const requests = [];
  class FormDataMock {
    constructor(form) { this.values = new Map(form?.values || []); }
    append(name, value) { this.values.set(name, value); }
    has(name) { return this.values.has(name); }
    get(name) { return this.values.get(name) ?? null; }
  }
  class XhrMock extends Element {
    constructor() { super(); this.upload = new Element(); }
    open(method, url) { this.method = method; this.url = url; }
    send(data) {
      requests.push({ method: this.method, url: this.url, data });
      const result = responses[requests.length - 1];
      queueMicrotask(async () => {
        await this.upload.trigger('progress', { loaded: 25, total: 100, lengthComputable: true });
        await this.upload.trigger('load');
        this.status = result.status;
        this.response = result.body;
        await this.trigger('load');
      });
    }
  }
  const form = new Element();
  form.reportValidity = () => true;
  form.reset = () => { form.resets = (form.resets || 0) + 1; };
  form.action = 'https://minivr.test/admin/panorama-bulk-upload.php';
  form.values = [
    ['csrf_token', 'token'], ['projection', '360'], ['stereo', 'mono'],
    ['title_prefix', 'Музей — '], ['description', 'Первый этаж'], ['published', '1']
  ];
  const file = new Element();
  const label = new Element();
  const button = new Element();
  button.className = 'btn';
  const results = new Element();
  const parts = Object.fromEntries(['overall-label', 'overall-progress', 'file-list', 'finish'].map(key => [key, new Element()]));
  results.querySelector = selector => parts[selector.replace('[data-bulk-', '').replace(']', '')];
  const controls = [file, button];
  form.querySelector = selector => {
    if (selector === 'input[name=images]' || selector === 'input[type=file][name=image]') return file;
    if (selector === '[data-bulk-files-label]') return label;
    if (selector.startsWith('button')) return button;
    return null;
  };
  form.querySelectorAll = () => controls;
  const doc = {
    createElement: () => new Element(),
    getElementById: id => mode === 'bulk' && id === 'panorama-bulk-form' ? form : null,
    querySelector: selector => selector === '[data-bulk-results]' ? results : selector === '[data-async-panorama]' && mode === 'single' ? form : null
  };
  const location = { href: 'https://minivr.test/admin/panorama.php', pathname: '/admin/panorama.php' };
  const history = { replaceState: (...args) => { history.last = args; } };
  vm.runInNewContext(source, { document: doc, window: { location, history }, XMLHttpRequest: XhrMock, FormData: FormDataMock, URL, Promise, console, queueMicrotask });
  return { requests, form, file, label, results, parts, button, history };
}

// One panorama: existing editor settings and file travel together; no redirect.
{
  const h = harness('single', [{ status: 200, body: { ok: true, created: true, id: 42, title: 'Новый зал' } }]);
  h.file.files = [{ name: 'Зал.jpg', size: 100 }];
  await h.form.trigger('submit');
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /async=1/);
  assert.equal(h.requests[0].data.get('csrf_token'), 'token');
  assert.equal(h.form.resets, 1);
  assert.match(h.form.children[0].children[0].textContent, /Панорама загружена/);
  assert.equal(h.button.disabled, false);
}

// Bulk queue continues after a per-file server error; defaults persist.
{
  const h = harness('bulk', [
    { status: 201, body: { ok: true, id: 11, title: 'Музей — Зал 1' } },
    { status: 422, body: { ok: false, error: 'Некорректное изображение' } }
  ]);
  h.file.files = [
    { name: 'Зал_1.jpg', size: 100 },
    { name: 'broken.png', size: 100 }
  ];
  await h.file.trigger('change');
  assert.match(h.label.textContent, /2 файлов/);
  await h.form.trigger('submit');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].data.get('title'), 'Музей — Зал 1');
  assert.equal(h.requests[0].data.get('projection'), '360');
  assert.equal(h.requests[0].data.get('description'), 'Первый этаж');
  assert.equal(h.requests[0].data.get('published'), '1');
  assert.equal(h.requests[1].data.get('title'), 'Музей — broken');
  assert.equal(h.parts['file-list'].children.length, 2);
  assert.equal(h.parts['overall-progress'].value, 100);
  assert.match(h.parts.finish.textContent, /Готово: 1 · Ошибок: 1/);
  assert.equal(h.button.disabled, false);
  assert.equal(h.file.value, '');
}

console.log('admin-panorama-upload: single and bulk scenarios passed');
