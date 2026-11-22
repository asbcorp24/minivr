(() => {
  'use strict';
  const sections = Array.from(document.querySelectorAll('section[data-gallery]'));
  if (!sections.length) return;
  const requests = new WeakMap();

  function pageFromUrl(url, kind) {
    const value = Number(new URL(url, window.location.href).searchParams.get(kind === 'tours' ? 'tours_page' : 'materials_page'));
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  }

  async function loadGallery(section, target, { push = false, scroll = false } = {}) {
    const kind = section.dataset.gallery;
    if (kind !== 'tours' && kind !== 'materials') return;
    requests.get(section)?.abort();
    const controller = new AbortController();
    requests.set(section, controller);
    const content = section.querySelector('[data-gallery-results]');
    const status = section.querySelector('[data-gallery-status]');
    if (!content || !status) return;

    const destination = new URL(target, window.location.href);
    const fragmentUrl = new URL(destination.href);
    fragmentUrl.searchParams.set('gallery_fragment', kind);
    section.setAttribute('aria-busy', 'true');
    content.classList.add('is-loading');
    status.hidden = false;
    status.textContent = 'Загружаем страницу…';

    try {
      const response = await fetch(fragmentUrl.pathname + fragmentUrl.search, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }, signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      const next = parsed.querySelector('[data-gallery-results]');
      if (!next || !Number.isSafeInteger(Number(next.dataset.page))) throw new Error('Некорректный ответ сервера');
      if (controller.signal.aborted) return;

      content.replaceWith(document.importNode(next, true));
      section.dataset.galleryPage = next.dataset.page;
      if (push) history.pushState({ miniVRGallery: true }, '', destination.pathname + destination.search + destination.hash);
      if (scroll) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      status.textContent = '';
      status.hidden = true;
    } catch (error) {
      if (controller.signal.aborted) return;
      status.textContent = 'Не удалось загрузить страницу. Открываем обычным способом…';
      if (push) window.location.assign(destination.href);
      else window.location.reload();
    } finally {
      if (requests.get(section) === controller) {
        requests.delete(section);
        section.removeAttribute('aria-busy');
        section.querySelector('[data-gallery-results]')?.classList.remove('is-loading');
      }
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[data-gallery-page]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank' || link.hasAttribute('download')) return;
    const section = link.closest('section[data-gallery]');
    if (!section) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    // Other gallery's links may be stale after its last AJAX update.
    // Keep the visible page of that gallery in the navigable URL.
    for (const other of sections) {
      if (other === section) continue;
      const param = other.dataset.gallery === 'tours' ? 'tours_page' : 'materials_page';
      const page = Number(other.dataset.galleryPage || 1);
      if (page > 1) destination.searchParams.set(param, String(page));
      else destination.searchParams.delete(param);
    }
    event.preventDefault();
    loadGallery(section, destination.href, { push: true, scroll: true });
  });

  window.addEventListener('popstate', () => {
    for (const section of sections) {
      if (pageFromUrl(window.location.href, section.dataset.gallery) !== Number(section.dataset.galleryPage || 1)) {
        loadGallery(section, window.location.href);
      }
    }
  });
})();
