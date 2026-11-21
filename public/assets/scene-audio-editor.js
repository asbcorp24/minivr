(() => {
  'use strict';
  document.querySelectorAll('[data-scene-audio-editor]').forEach(root => {
    const form = root.closest('form');
    const value = root.querySelector('[data-scene-audio-value]');
    const file = root.querySelector('[data-scene-audio-file]');
    const clear = root.querySelector('[data-scene-audio-clear]');
    const preview = root.querySelector('[data-scene-audio-preview]');
    const status = root.querySelector('[data-scene-audio-status]');
    let uploading = false;

    const refresh = () => {
      if (value.value) {
        preview.src = value.value;
        preview.hidden = false;
      } else {
        preview.pause();
        preview.removeAttribute('src');
        preview.load();
        preview.hidden = true;
      }
      clear.disabled = uploading || !value.value;
    };

    clear.addEventListener('click', () => {
      if (uploading) return;
      value.value = '';
      file.value = '';
      status.textContent = 'Аудиогид удалён из настроек. Нажмите «Сохранить сцену».';
      refresh();
    });

    file.addEventListener('change', async () => {
      const selected = file.files?.[0];
      if (!selected || uploading) return;
      if (selected.size > 20 * 1024 * 1024) {
        status.textContent = 'Файл слишком большой. Максимум 20 МБ.';
        file.value = '';
        return;
      }
      uploading = true;
      clear.disabled = true;
      file.disabled = true;
      status.textContent = 'Загрузка аудиокомментария…';
      const body = new FormData();
      body.append('audio', selected);
      try {
        const response = await fetch('/admin/guided-audio-upload.php', {
          method: 'POST', credentials: 'same-origin', body
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось загрузить аудио');
        if (!/^\/uploads\/guided-audio\/[a-f0-9]{32}\.(mp3|ogg|wav)$/i.test(result.url || '')) {
          throw new Error('Сервер вернул некорректный путь аудио');
        }
        value.value = result.url;
        status.textContent = '✓ Аудио загружено. Нажмите «Сохранить сцену», чтобы привязать его к экскурсии.';
      } catch (error) {
        status.textContent = `Ошибка: ${error.message}`;
      } finally {
        uploading = false;
        file.disabled = false;
        refresh();
      }
    });

    form?.addEventListener('submit', event => {
      if (uploading) {
        event.preventDefault();
        status.textContent = 'Дождитесь окончания загрузки аудио.';
      }
    });
    refresh();
  });
})();
