// Progressive enhancement: keep the original form and every input intact.
// Run after existing editors initialize so canvas-based mask tools can measure
// their dimensions before panels are collapsed.
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form.editor[enctype="multipart/form-data"]');
  if (!form || !form.querySelector('input[name="projection"] , select[name="projection"]')) return;

  const makePanel = (nodes, title, initiallyOpen = false) => {
    if (!nodes.length) return null;
    const details = document.createElement('details');
    details.className = 'panorama-accordion';
    details.open = initiallyOpen;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.append(summary);
    const body = document.createElement('div');
    body.className = 'panorama-accordion-body';
    details.append(body);
    nodes[0].before(details);
    nodes.forEach(node => body.append(node));
    details.addEventListener('toggle', () => {
      if (details.open) {
        // Editors and WebGL/canvas previews may need a new layout measurement.
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      }
    });
    return details;
  };

  const topFieldsets = Array.from(form.children).filter(el => el.tagName === 'FIELDSET');
  if (!topFieldsets.length) return;

  const first = topFieldsets[0];
  const basicNodes = [];
  for (let node = form.firstChild; node && node !== first; node = node.nextSibling) {
    basicNodes.push(node);
  }
  makePanel(basicNodes, '01 · Основное: название, формат и изображение', true);

  topFieldsets.forEach((fieldset, index) => {
    const legend = fieldset.querySelector(':scope > legend');
    const title = legend?.textContent.trim() || 'Дополнительные настройки';
    const nested = Array.from(fieldset.querySelectorAll(':scope > fieldset'));
    nested.forEach((child, nestedIndex) => {
      const childTitle = child.querySelector(':scope > legend')?.textContent.trim() || 'Дополнительно';
      makePanel([child], childTitle, false);
    });
    makePanel([fieldset], String(index + 2).padStart(2, '0') + ' · ' + title, false);
  });

  // Browser constraint validation cannot focus controls inside closed details.
  form.addEventListener('invalid', event => {
    let parent = event.target.closest('details.panorama-accordion');
    while (parent) {
      parent.open = true;
      parent = parent.parentElement?.closest('details.panorama-accordion');
    }
  }, true);

  const toolbar = document.createElement('div');
  toolbar.className = 'panorama-accordion-toolbar';
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.textContent = 'Развернуть всё';
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.textContent = 'Свернуть всё';
  expand.addEventListener('click', () => form.querySelectorAll('details.panorama-accordion').forEach(panel => { panel.open = true; }));
  collapse.addEventListener('click', () => {
    form.querySelectorAll('details.panorama-accordion').forEach(panel => { panel.open = false; });
    const basic = form.querySelector('details.panorama-accordion');
    if (basic) basic.open = true;
  });
  toolbar.append(expand, collapse);
  form.prepend(toolbar);
});
