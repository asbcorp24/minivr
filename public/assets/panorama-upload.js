(() => {
  'use strict';

  const formatBytes = bytes => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.ceil(bytes / 1024)} КБ`;
  };

  // Upload progress describes network transfer; the server can keep processing
  // thumbnails and tiles after the last byte has been transmitted.
  function sendUpload(url, payload, onProgress, onProcessing) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.responseType = 'json';
      xhr.upload.addEventListener('progress', event => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      });
      xhr.upload.addEventListener('load', onProcessing);
      xhr.addEventListener('load', () => {
        let result = xhr.response;
        if (!result || typeof result !== 'object') {
          try { result = JSON.parse(xhr.responseText); } catch (_) { result = null; }
        }
        if (xhr.status >= 200 && xhr.status < 300 && result && result.ok) {
          resolve(result);
        } else {
          const message = result && typeof result.error === 'string' ? result.error :
            xhr.status === 413 ? 'Файл слишком большой для сервера.' :
              `Сервер вернул ошибку (${xhr.status || 'нет ответа'}).`;
          reject(new Error(message));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Не удалось соединиться с сервером.')));
      xhr.addEventListener('abort', () => reject(new Error('Загрузка прервана.')));
      xhr.addEventListener('timeout', () => reject(new Error('Сервер слишком долго не отвечает.')));
      xhr.send(payload);
    });
  }

  function addLinks(target, id) {
    const links = document.createElement('span');
    links.className = 'panorama-async-feedback-links';
    for (const [title, href] of [
      ['Открыть панораму', `/viewer.php?id=${id}`],
      ['Настроить', `/admin/panorama.php?id=${id}`]
    ]) {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = title;
      if (title === 'Открыть панораму') anchor.target = '_blank';
      links.append(anchor);
    }
    target.append(links);
  }

  function initSingle() {
    const form = document.querySelector('[data-async-panorama]');
    if (!form) return;
    const button = form.querySelector('button[type=submit], button.btn');
    const fileField = form.querySelector('input[type=file][name=image]');
    const panel = document.createElement('div');
    panel.className = 'panorama-async-feedback';
    panel.hidden = true;
    panel.setAttribute('role', 'status');
    const label = document.createElement('p');
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = 0;
    const links = document.createElement('div');
    panel.append(label, progress, links);
    form.append(panel);
    let busy = false;

    // Register after the existing editor scripts. They write unsaved masks into
    // hidden form fields during the submit event before we take the FormData snapshot.
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      busy = true;
      if (button) button.disabled = true;
      panel.hidden = false;
      panel.classList.remove('is-error');
      links.replaceChildren();
      progress.value = 0;
      const file = fileField?.files?.[0];
      label.textContent = file ? `Передача ${file.name}: 0%` : 'Сохраняем настройки…';
      const url = new URL(window.location.href);
      url.searchParams.set('async', '1');

      try {
        const result = await sendUpload(url.pathname + url.search, new FormData(form),
          (sent, total) => {
            const percent = Math.min(100, Math.round(sent / total * 100));
            progress.value = percent;
            label.textContent = `Передача ${file?.name || 'данных'}: ${percent}% (${formatBytes(sent)} из ${formatBytes(total)})`;
          }, () => {
            progress.value = 100;
            label.textContent = 'Файл передан. Сервер сохраняет панораму и создаёт превью/тайлы…';
          });
        progress.value = 100;
        label.textContent = `✓ ${result.created ? 'Панорама загружена' : 'Изменения сохранены'}: ${result.title}`;
        addLinks(links, result.id);
        if (result.created) {
          // Ready for another new panorama without leaving the editor.
          form.reset();
          window.history.replaceState(null, '', '/admin/panorama.php');
        }
      } catch (error) {
        panel.classList.add('is-error');
        label.textContent = `Ошибка: ${error.message}. Исправьте проблему и повторите сохранение.`;
      } finally {
        busy = false;
        if (button) button.disabled = false;
      }
    });
  }

  function panoramaTitle(filename) {
    // Preserve the file name exactly, removing only its final extension.
    return filename.replace(/\.[^.]+$/, '');
  }

  function initBulk() {
    const form = document.getElementById('panorama-bulk-form');
    if (!form) return;
    const input = form.querySelector('input[name=images]');
    const countLabel = form.querySelector('[data-bulk-files-label]');
    const results = document.querySelector('[data-bulk-results]');
    const overallLabel = results.querySelector('[data-bulk-overall-label]');
    const overallProgress = results.querySelector('[data-bulk-overall-progress]');
    const list = results.querySelector('[data-bulk-file-list]');
    const finish = results.querySelector('[data-bulk-finish]');
    let busy = false;

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      const bytes = files.reduce((sum, file) => sum + file.size, 0);
      countLabel.textContent = files.length ? `${files.length} файлов · ${formatBytes(bytes)}` : 'Файлы ещё не выбраны';
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      const files = Array.from(input.files || []);
      if (!files.length) return;
      const settings = new FormData(form);
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      const progressTotal = totalBytes || files.length;
      let completedBytes = 0;
      let success = 0;
      let failed = 0;
      busy = true;
      for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = true;
      results.hidden = false;
      finish.textContent = '';
      list.replaceChildren();
      overallProgress.value = 0;

      for (const [index, file] of files.entries()) {
        const item = document.createElement('li');
        item.className = 'bulk-upload-item';
        const head = document.createElement('div');
        head.className = 'bulk-upload-item-head';
        const name = document.createElement('span');
        name.className = 'bulk-upload-item-name';
        name.textContent = file.name;
        const status = document.createElement('span');
        status.className = 'bulk-upload-item-status';
        status.textContent = 'Ожидание';
        const progress = document.createElement('progress');
        progress.max = 100;
        progress.value = 0;
        const links = document.createElement('div');
        links.className = 'bulk-upload-item-links';
        head.append(name, status);
        item.append(head, progress, links);
        list.append(item);

        const updateOverall = loaded => {
          const sent = completedBytes + (totalBytes ? loaded : 1);
          overallProgress.value = Math.min(100, Math.round(sent / progressTotal * 100));
          overallLabel.textContent = `Файл ${index + 1} из ${files.length} · передано ${formatBytes(completedBytes + loaded)} из ${formatBytes(totalBytes)}`;
        };
        const data = new FormData();
        data.append('csrf_token', settings.get('csrf_token'));
        data.append('image', file, file.name);
        data.append('title', panoramaTitle(file.name));
        for (const key of ['projection', 'stereo', 'description']) data.append(key, settings.get(key) || '');
        if (settings.has('published')) data.append('published', '1');

        try {
          status.textContent = 'Загрузка: 0%';
          const result = await sendUpload(form.action, data, (loaded, total) => {
            const percent = Math.min(100, Math.round(loaded / total * 100));
            progress.value = percent;
            status.textContent = `Загрузка: ${percent}%`;
            updateOverall(loaded);
          }, () => {
            progress.value = 100;
            status.textContent = 'Создаются превью и тайлы…';
            updateOverall(file.size);
          });
          success++;
          progress.value = 100;
          item.classList.add('is-ok');
          status.textContent = '✓ Готово';
          addLinks(links, result.id);
        } catch (error) {
          failed++;
          item.classList.add('is-error');
          status.textContent = `Ошибка: ${error.message}`;
        } finally {
          completedBytes += totalBytes ? file.size : 1;
          updateOverall(0);
        }
      }

      overallProgress.value = 100;
      overallLabel.textContent = `Обработано ${files.length} из ${files.length}`;
      finish.textContent = `Готово: ${success} · Ошибок: ${failed}. Загруженные панорамы доступны по ссылкам выше.`;
      for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = false;
      input.value = '';
      countLabel.textContent = 'Файлы ещё не выбраны';
      busy = false;
    });
  }

  initSingle();
  initBulk();
})();
