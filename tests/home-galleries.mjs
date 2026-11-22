import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/assets/home-galleries.js', import.meta.url), 'utf8');

function makeResults(page) {
  const classes = new Set();
  return {
    dataset: { page: String(page) },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    replaceWith() { throw new Error('Replacement not connected'); }
  };
}

function harness() {
  const listeners = {};
  const requests = [];
  const actions = { reloads: 0, assigns: [], scrolls: 0, history: [] };
  const location = {
    href: 'https://minivr.test/',
    origin: 'https://minivr.test',
    assign(url) { actions.assigns.push(url); },
    reload() { actions.reloads++; }
  };
  const history = {
    pushState(_state, _unused, url) {
      actions.history.push(url);
      location.href = new URL(url, location.href).href;
    }
  };
  const makeSection = kind => {
    const section = {
      dataset: { gallery: kind, galleryPage: '1' },
      attributes: {},
      status: { hidden: true, textContent: '' },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      querySelector(selector) {
        if (selector === '[data-gallery-results]') return this.results;
        if (selector === '[data-gallery-status]') return this.status;
        return null;
      },
      scrollIntoView() { actions.scrolls++; }
    };
    const connect = results => {
      results.replaceWith = next => connect(next);
      section.results = results;
    };
    connect(makeResults(1));
    return section;
  };
  const tours = makeSection('tours');
  const materials = makeSection('materials');
  const document = {
    querySelectorAll: () => [tours, materials],
    addEventListener: (kind, handler) => { listeners[kind] = handler; },
    importNode: node => makeResults(node.dataset.page)
  };
  class DOMParserMock {
    parseFromString(text) {
      return { querySelector: () => makeResults(Number(text)) };
    }
  }
  const fetch = async (url, options) => {
    requests.push({ url, options });
    const params = new URL(url, location.href).searchParams;
    const kind = params.get('gallery_fragment');
    const page = params.get(kind === 'tours' ? 'tours_page' : 'materials_page') || '1';
    return { ok: true, text: async () => page };
  };
  vm.runInNewContext(source, {
    document, window: { location, addEventListener: (name, handler) => { listeners[name] = handler; } },
    history, URL, fetch, AbortController, DOMParser: DOMParserMock, WeakMap, Number
  });
  async function click(section, url, extra = {}) {
    const link = {
      href: url,
      target: '',
      hasAttribute: () => false,
      closest: selector => selector === 'section[data-gallery]' ? section : null
    };
    let prevented = false;
    listeners.click({
      target: { closest: () => link }, button: 0,
      defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      preventDefault: () => { prevented = true; }, ...extra
    });
    await new Promise(resolve => setImmediate(resolve));
    return prevented;
  }
  async function pop(url) {
    location.href = new URL(url, location.href).href;
    listeners.popstate();
    await new Promise(resolve => setImmediate(resolve));
  }
  return { actions, requests, tours, materials, location, click, pop };
}

const h = harness();
assert.equal(await h.click(h.tours, 'https://minivr.test/?tours_page=2#tours'), true);
assert.equal(h.tours.dataset.galleryPage, '2');
assert.equal(h.materials.dataset.galleryPage, '1');
assert.match(h.requests[0].url, /gallery_fragment=tours/);
assert.equal(h.actions.history.at(-1), '/?tours_page=2#tours');
assert.equal(h.actions.assigns.length + h.actions.reloads, 0, 'No page reload on tour pagination');

// Links in the untouched materials gallery were rendered before tours moved to page 2.
// The browser-side navigation must retain that new tour page in its URL.
assert.equal(await h.click(h.materials, 'https://minivr.test/?materials_page=2#panoramas'), true);
assert.equal(h.materials.dataset.galleryPage, '2');
assert.equal(h.tours.dataset.galleryPage, '2');
assert.equal(h.actions.history.at(-1), '/?materials_page=2&tours_page=2#panoramas');
assert.match(h.requests[1].url, /gallery_fragment=materials/);
assert.equal(h.actions.assigns.length + h.actions.reloads, 0, 'No page reload on materials pagination');

await h.pop('https://minivr.test/?materials_page=2#panoramas');
assert.equal(h.tours.dataset.galleryPage, '1', 'Back/forward restores the visible tour page');
assert.equal(h.materials.dataset.galleryPage, '2');
assert.equal(h.actions.assigns.length + h.actions.reloads, 0);

console.log('home-galleries: async tours, materials, shared URL state and popstate passed');
