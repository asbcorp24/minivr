// Layer-based corrections of the panorama's saved grayscale depth map.
// The photograph is the background; only the transparent mask is drawn here.
import {
  depthGroupCount, layerCoverage, rawForLayer, rawOutsideLayer,
  fittedPanoramaSize, boundedPanOffsets
} from './depth-layer-logic.js';
import { chooseMaskAtPoint, maskToEditorPixels } from './depth-ai-selection.js';

const panel = document.querySelector('[data-depth-panel]');
if (panel) {
  const root = panel.querySelector('[data-depth-editor]');
  const saved = panel.querySelector('[data-depth-saved]');
  const status = panel.querySelector('[data-depth-status]');
  const form = panel.closest('form');
  if (root && saved && form) {
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const viewport = root.querySelector('.depth-editor-viewport');
    const stage = root.querySelector('.depth-editor-photo');
    const fullscreenButton = root.querySelector('[data-toggle-fullscreen]');
    const zoomInput = root.querySelector('[data-zoom]');
    const zoomOutput = root.querySelector('[data-zoom-output]');
    const W = 512, H = 256;
    canvas.width = W;
    canvas.height = H;

    const photo = root.querySelector('[data-layer-photo]');
    photo.src = root.dataset.image;
    const groupInput = form.querySelector('[name="parallaxGroups"]');
    const nonlinearInput = form.querySelector('[name="parallaxNonlinear"]');
    const nonlinearStrengthInput = form.querySelector('[name="parallaxNonlinearStrength"]');
    const strengthInput = form.querySelector('[name="parallaxStrength"]');
    const brush = root.querySelector('[data-brush]');
    const opacity = root.querySelector('[data-opacity]');
    const tool = root.querySelector('[data-mode]');
    const layer = root.querySelector('[data-layer]');
    const list = root.querySelector('[data-layer-list]');
    const showAll = root.querySelector('[data-show-all]');
    const overlayOpacity = root.querySelector('[data-layer-opacity]');
    const hint = root.querySelector('[data-layer-hint]');
    const aiButton = root.querySelector('[data-ai-select]');
    const aiApply = root.querySelector('[data-ai-apply]');
    const aiCancel = root.querySelector('[data-ai-cancel]');
    const aiStatus = root.querySelector('[data-ai-status]');
    const buttons = {
      save: root.querySelector('[data-save]'),
      undo: root.querySelector('[data-undo]'),
      redo: root.querySelector('[data-redo]'),
      reset: root.querySelector('[data-reset]'),
      restore: root.querySelector('[data-restore]')
    };
    const history = [], redo = [];
    const frame = ctx.createImageData(W, H);
    const palette = [[33, 122, 233], [31, 186, 185], [91, 187, 113],
      [245, 182, 56], [244, 96, 76]];
    let original = null, working = null, selected = 0, painting = false;
    let last = null, dirty = false, saving = false, pendingFrame = false;
    let zoom = 1, panX = 0, panY = 0, panning = false, panStart = null, spaceDown = false;
    let aiPipeline = null, aiLoading = false, aiSelecting = false, aiMask = null;

    const isFullscreen = () => document.fullscreenElement === root || root.classList.contains('depth-editor-expanded');
    function positionStage() {
      const bounds = boundedPanOffsets(panX, panY, zoom,
        stage.offsetWidth, stage.offsetHeight, viewport.clientWidth, viewport.clientHeight);
      panX = bounds.x; panY = bounds.y;
      stage.style.transform = 'translate(calc(-50% + ' + panX + 'px), calc(-50% + ' + panY + 'px)) scale(' + zoom + ')';
    }
    function fitStage() {
      if (isFullscreen()) {
        const fitted = fittedPanoramaSize(viewport.clientWidth, viewport.clientHeight);
        stage.style.width = fitted.width + 'px';
        stage.style.height = fitted.height + 'px';
      } else {
        stage.style.width = '';
        stage.style.height = '';
      }
      positionStage();
    }
    function updateFullscreenButton() {
      const expanded = isFullscreen();
      fullscreenButton.textContent = expanded ? '↙ Закрыть полный экран' : '⛶ На весь экран';
      fullscreenButton.setAttribute('aria-pressed', String(expanded));
      fullscreenButton.setAttribute('aria-label', expanded ? 'Закрыть полноэкранный редактор' : 'Открыть редактор на весь экран');
      fitStage();
    }
    function exitFallbackFullscreen() {
      root.classList.remove('depth-editor-expanded');
      document.body.classList.remove('depth-editor-fullscreen-open');
      updateFullscreenButton();
    }
    fullscreenButton.addEventListener('click', async () => {
      if (document.fullscreenElement === root) {
        try { await document.exitFullscreen(); } catch (e) { console.warn('Depth editor fullscreen exit failed', e); }
      } else if (root.classList.contains('depth-editor-expanded')) {
        exitFallbackFullscreen();
      } else {
        try {
          if (!root.requestFullscreen) throw Error('Fullscreen API недоступен');
          await root.requestFullscreen();
        } catch (e) {
          // Embedded admin pages and some mobile browsers deny native fullscreen.
          // A fixed viewport fallback keeps the editor usable without navigation.
          root.classList.add('depth-editor-expanded');
          document.body.classList.add('depth-editor-fullscreen-open');
          updateFullscreenButton();
        }
      }
    });
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && root.classList.contains('depth-editor-expanded')) exitFallbackFullscreen();
      if (e.code === 'Space' && !e.repeat && !e.target?.closest?.('input,select,textarea,button')) {
        spaceDown = true;
        root.classList.add('depth-editor-panning');
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        spaceDown = false;
        if (tool.value !== 'pan') root.classList.remove('depth-editor-panning');
      }
    });
    window.addEventListener('blur', () => { spaceDown = false; if (tool.value !== 'pan') root.classList.remove('depth-editor-panning'); });
    zoomInput.addEventListener('input', () => {
      zoom = Math.max(1, Math.min(4, Number(zoomInput.value) / 100));
      zoomOutput.textContent = Math.round(zoom * 100) + '%';
      positionStage();
    });
    tool.addEventListener('change', () => root.classList.toggle('depth-editor-panning', tool.value === 'pan'));
    window.addEventListener('resize', fitStage);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (isFullscreen()) fitStage(); }).observe(viewport);

    const count = () => depthGroupCount(groupInput?.value);
    const nonlinear = () => !!nonlinearInput?.checked;
    const nonlinearStrength = () => Number(nonlinearStrengthInput?.value || 50);
    const colorFor = (i, n) => {
      const scaled = i / Math.max(1, n - 1) * (palette.length - 1);
      const lo = Math.floor(scaled), hi = Math.min(palette.length - 1, lo + 1), t = scaled - lo;
      return palette[lo].map((v, channel) => Math.round(v * (1 - t) + palette[hi][channel] * t));
    };
    const labelFor = (i, n) => i === 0 ? 'дальний' : i === n - 1 ? 'ближний' : 'промежуточный';
    const layerPercentages = n => {
      if (!working) return Array(n).fill('');
      const histogram = new Uint32Array(256);
      for (let j = 0; j < W * H; j++) histogram[working.data[j * 4]]++;
      const curved = nonlinear(), curve = nonlinearStrength();
      return Array.from({ length: n }, (_, i) => {
        let pixels = 0;
        for (let v = 0; v < 256; v++) {
          if (layerCoverage(v / 255, i, n, curved, curve) >= .5) pixels += histogram[v];
        }
        return ' · ' + Math.round(pixels / (W * H) * 100) + '%';
      });
    };
    function updateLayerList(recalculate = false) {
      const n = count();
      const percentages = layerPercentages(n);
      if (recalculate || list.children.length !== n) {
        list.replaceChildren();
        layer.replaceChildren();
        for (let i = 0; i < n; i++) {
          const option = document.createElement('option');
          option.value = String(i);
          option.textContent = 'Слой ' + (i + 1) + ' — ' + labelFor(i, n);
          layer.append(option);
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.layerIndex = String(i);
          const swatch = document.createElement('span');
          swatch.className = 'depth-layer-swatch';
          swatch.style.backgroundColor = 'rgb(' + colorFor(i, n).join(',') + ')';
          const text = document.createElement('span');
          text.className = 'depth-layer-name';
          text.textContent = option.textContent + percentages[i];
          button.append(swatch, text);
          button.addEventListener('click', () => selectLayer(i));
          list.append(button);
        }
      } else {
        for (const [i, button] of [...list.children].entries()) {
          button.querySelector('.depth-layer-name').textContent =
            'Слой ' + (i + 1) + ' — ' + labelFor(i, n) + percentages[i];
        }
      }
      selected = Math.max(0, Math.min(n - 1, selected));
      layer.value = String(selected);
      [...list.children].forEach((button, i) => {
        button.classList.toggle('active', i === selected);
        button.setAttribute('aria-pressed', i === selected ? 'true' : 'false');
      });
      hint.textContent = 'Редактируется слой ' + (selected + 1) + ' (' + labelFor(selected, n) + '). ' +
        'Добавить — назначить область этому слою; Убрать — перенести за его границу; ' +
        'Ластик — вернуть глубину последнего сохранения.';
    }
    function selectLayer(i) {
      selected = i;
      updateLayerList();
      scheduleDraw();
    }
    // Most users start correcting near-field object silhouettes first.
    selected = count() - 1;
    function renderOverlay() {
      pendingFrame = false;
      if (!working) return;
      const n = count(), all = showAll.checked, colors = Array.from({ length: n }, (_, i) => colorFor(i, n));
      const alpha = Number(overlayOpacity.value) / 100;
      // Only 256 possible grayscale values: calculate each group's contribution
      // once per value, then use a fast lookup while rendering 131k pixels.
      const lut = new Uint8ClampedArray(256 * 4);
      for (let v = 0; v < 256; v++) {
        const j = v * 4, raw = v / 255;
        if (!all) {
          const coverage = layerCoverage(raw, selected, n, nonlinear(), nonlinearStrength());
          const rgb = colors[selected];
          lut[j] = rgb[0]; lut[j + 1] = rgb[1]; lut[j + 2] = rgb[2];
          lut[j + 3] = Math.round(255 * coverage * alpha);
        } else {
          let total = 0, visibility = 0, r = 0, g = 0, b = 0;
          for (let i = 0; i < n; i++) {
            const coverage = layerCoverage(raw, i, n, nonlinear(), nonlinearStrength());
            const weight = coverage * (i === selected ? 2.2 : .65);
            total += weight; visibility = Math.max(visibility, coverage);
            r += colors[i][0] * weight; g += colors[i][1] * weight; b += colors[i][2] * weight;
          }
          if (total > 0) {
            lut[j] = Math.round(r / total);
            lut[j + 1] = Math.round(g / total);
            lut[j + 2] = Math.round(b / total);
            lut[j + 3] = Math.round(255 * visibility * alpha * .75);
          }
        }
      }
      const data = frame.data, values = working.data;
      for (let j = 0; j < data.length; j += 4) {
        const k = values[j] * 4;
        data[j] = lut[k]; data[j + 1] = lut[k + 1];
        data[j + 2] = lut[k + 2]; data[j + 3] = lut[k + 3];
      }
      ctx.putImageData(frame, 0, 0);
      if (aiMask) {
        const overlay = ctx.createImageData(W, H);
        for (let i = 0; i < aiMask.length; i++) {
          const a = aiMask[i];
          if (a < 24) continue;
          const j = i * 4;
          overlay.data[j] = 255; overlay.data[j + 1] = 220; overlay.data[j + 2] = 35;
          overlay.data[j + 3] = Math.round(Math.min(220, a * .78));
        }
        ctx.putImageData(overlay, 0, 0);
      }
      buttons.undo.disabled = saving || history.length === 0;
      buttons.redo.disabled = saving || redo.length === 0;
      buttons.save.disabled = saving || !dirty;
    }
    function scheduleDraw() {
      if (!pendingFrame) {
        pendingFrame = true;
        requestAnimationFrame(renderOverlay);
      }
    }
    function snapshot() {
      history.push(new Uint8ClampedArray(working.data));
      if (history.length > 20) history.shift();
      redo.length = 0;
    }
    function setPixels(pixels) {
      working.data.set(pixels);
      dirty = true;
      updateLayerList();
      scheduleDraw();
    }
    async function load() {
      const img = new Image();
      img.src = saved.src;
      await img.decode();
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      original = ctx.getImageData(0, 0, W, H);
      working = ctx.createImageData(W, H);
      working.data.set(original.data);
      dirty = false;
      updateLayerList(true);
      scheduleDraw();
    }
    function paint(x, y) {
      const radius = Math.max(1, Number(brush.value));
      const pressure = Number(opacity.value) / 100;
      const n = count(), isNonlinear = nonlinear(), curve = nonlinearStrength();
      const target = rawForLayer(selected, n, isNonlinear, curve) * 255;
      const pixels = working.data, baseline = original.data;
      const smoothSource = tool.value === 'smooth' && history.length ? history[history.length - 1] : pixels;
      for (let yy = Math.max(0, Math.floor(y - radius)); yy <= Math.min(H - 1, Math.ceil(y + radius)); yy++) {
        for (let xx = Math.floor(x - radius); xx <= Math.ceil(x + radius); xx++) {
          const dx = xx - x, dy = yy - y, distance = Math.hypot(dx, dy);
          if (distance > radius) continue;
          const px = ((xx % W) + W) % W, idx = (yy * W + px) * 4;
          const weight = pressure * Math.min(1, (radius - distance) / Math.max(1, radius * .25));
          if (weight <= 0) continue;
          const old = pixels[idx];
          let nextTarget = target;
          if (tool.value === 'erase') nextTarget = baseline[idx];
          if (tool.value === 'remove') nextTarget = rawOutsideLayer(old / 255, selected, n, isNonlinear, curve) * 255;
          if (tool.value === 'smooth') {
            let sum = 0;
            for (let sy = -2; sy <= 2; sy++) for (let sx = -2; sx <= 2; sx++) {
              const py = Math.max(0, Math.min(H - 1, yy + sy)), qx = (px + sx + W) % W;
              sum += smoothSource[(py * W + qx) * 4];
            }
            nextTarget = sum / 25;
          }
          const next = Math.round(old + (nextTarget - old) * weight);
          pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = next;
          pixels[idx + 3] = 255;
        }
      }
      dirty = true;
    }
    const position = e => {
      const rect = canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left) * W / rect.width, y: (e.clientY - rect.top) * H / rect.height };
    };
    async function ensureAiModel() {
      if (aiPipeline) return aiPipeline;
      if (aiLoading) throw Error('Модель уже загружается, подождите');
      aiLoading = true;
      try {
        aiStatus.textContent = 'Загружаю SlimSAM и процессор (первый запуск может занять несколько минут)…';
        const response = await fetch('/models/slimsam-77-uniform/minivr-manifest.json', { cache: 'no-store' });
        if (!response.ok) throw Error('Модель не установлена на сервере. Откройте админку → Нейросети и скачайте SlimSAM.');
        const manifest = await response.json();
        if (manifest?.status?.ready !== true) throw Error('Файлы модели на сервере неполные. В админке откройте «Нейросети» и нажмите «Проверить / восстановить файлы».');
        const { SamModel, AutoProcessor, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm');
        env.localModelPath = '/models/';
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.useBrowserCache = true;
        const loadOptions = { device: 'webgpu', dtype: 'q8' };
        try {
          const [model, processor] = await Promise.all([
            SamModel.from_pretrained('slimsam-77-uniform', loadOptions),
            AutoProcessor.from_pretrained('slimsam-77-uniform')
          ]);
          aiPipeline = { model, processor, RawImage: (await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm')).RawImage, device: 'webgpu' };
        } catch (gpuError) {
          console.warn('MiniVR SAM WebGPU unavailable; fallback to WASM', gpuError);
          aiStatus.textContent = 'WebGPU недоступен — загружаю SlimSAM через CPU/WASM…';
          const [model, processor] = await Promise.all([
            SamModel.from_pretrained('slimsam-77-uniform', { device: 'wasm', dtype: 'q8' }),
            AutoProcessor.from_pretrained('slimsam-77-uniform')
          ]);
          const { RawImage } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm');
          aiPipeline = { model, processor, RawImage, device: 'wasm' };
        }
        return aiPipeline;
      } finally { aiLoading = false; }
    }
    async function selectObjectAt(point) {
      if (saving || !working || aiLoading) return;
      aiSelecting = true;
      canvas.classList.add('depth-ai-selecting');
      aiButton.disabled = true;
      aiApply.disabled = true;
      aiCancel.disabled = true;
      try {
        const { model, processor, RawImage, device } = await ensureAiModel();
        aiStatus.textContent = 'SlimSAM анализирует точку и строит маски объекта…';
        const source = await RawImage.fromURL(photo.src);
        const sourceX = Math.max(0, Math.min(source.width - 1, Math.round(point.x / W * source.width)));
        const sourceY = Math.max(0, Math.min(source.height - 1, Math.round(point.y / H * source.height)));
        const inputs = await processor(source, { input_points: [[[sourceX, sourceY]]] });
        const outputs = await model(inputs);
        const masks = await processor.post_process_masks(
          outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes
        );
        const maskTensor = masks?.[0];
        const dims = maskTensor?.dims || [];
        const maskCount = dims.length >= 3 ? dims[dims.length - 3] : 0;
        const maskHeight = dims[dims.length - 2] || 0;
        const maskWidth = dims[dims.length - 1] || 0;
        if (!maskTensor?.data || !maskCount || !maskWidth || !maskHeight) {
          throw Error('SlimSAM не вернула маски. Проверьте файлы модели и формат входного изображения.');
        }
        const scores = outputs.iou_scores?.data || [];
        let bestIndex = 0, bestScore = -Infinity;
        const planeSize = maskWidth * maskHeight;
        for (let i = 0; i < maskCount; i++) {
          const score = Number(scores[i]) || 0;
          if (score > bestScore) { bestScore = score; bestIndex = i; }
        }
        const pickedData = maskTensor.data.slice(bestIndex * planeSize, (bestIndex + 1) * planeSize);
        aiMask = maskToEditorPixels(pickedData, maskWidth, maskHeight, W, H);
        // SAM returns a candidate mask for the prompted point. Guard against an empty mask.
        if (!aiMask.some(value => value >= 128)) {
          aiMask = null;
          throw Error('В выбранной точке объект не распознан. Попробуйте щёлкнуть ближе к центру предмета.');
        }
        aiApply.disabled = false;
        aiStatus.textContent = 'Объект выделен (SlimSAM / ' + device.toUpperCase() + '). Жёлтая область — маска. Добавьте её в выбранный слой или отмените.';
        scheduleDraw();
      } catch (error) {
        aiMask = null;
        aiStatus.textContent = 'Ошибка ИИ-выделения: ' + (error?.message || error);
        console.error('MiniVR AI object selection', error);
      } finally {
        aiSelecting = false;
        canvas.classList.remove('depth-ai-selecting');
        aiButton.disabled = false;
        aiCancel.disabled = !aiMask;
      }
    }
    aiButton?.addEventListener('click', () => {
      aiMask = null;
      aiSelecting = true;
      canvas.classList.add('depth-ai-selecting');
      aiStatus.textContent = 'Щёлкните по объекту на панораме. ИИ определит его контур.';
      aiApply.disabled = true;
      aiCancel.disabled = false;
      scheduleDraw();
    });
    aiApply?.addEventListener('click', () => {
      if (!aiMask || !working || saving) return;
      snapshot();
      const pixels = working.data;
      const target = Math.round(rawForLayer(selected, count(), nonlinear(), nonlinearStrength()) * 255);
      for (let i = 0; i < aiMask.length; i++) {
        const alpha = aiMask[i] / 255;
        if (alpha < .08) continue;
        const j = i * 4;
        const value = Math.round(pixels[j] + (target - pixels[j]) * alpha);
        pixels[j] = pixels[j + 1] = pixels[j + 2] = value;
        pixels[j + 3] = 255;
      }
      aiMask = null; dirty = true;
      aiApply.disabled = true; aiCancel.disabled = true;
      aiStatus.textContent = 'Объект добавлен в слой ' + (selected + 1) + '. Проверьте края и сохраните карту.';
      updateLayerList(); scheduleDraw();
    });
    aiCancel?.addEventListener('click', () => {
      aiMask = null; aiSelecting = false; canvas.classList.remove('depth-ai-selecting');
      aiApply.disabled = true; aiCancel.disabled = true;
      aiStatus.textContent = 'Выделение отменено.';
      scheduleDraw();
    });

    canvas.addEventListener('pointerdown', e => {
      if (!working || saving || (e.button !== 0 && e.button !== 1)) return;
      e.preventDefault();
      if (aiSelecting) { selectObjectAt(position(e)); return; }
      if (tool.value === 'pan' || spaceDown || e.button === 1) {
        panning = true;
        panStart = { x: e.clientX, y: e.clientY, panX, panY };
        root.classList.add('depth-editor-dragging');
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      snapshot(); painting = true; last = position(e);
      canvas.setPointerCapture(e.pointerId);
      paint(last.x, last.y); scheduleDraw();
    });
    canvas.addEventListener('pointermove', e => {
      if (panning && panStart) {
        e.preventDefault();
        panX = panStart.panX + e.clientX - panStart.x;
        panY = panStart.panY + e.clientY - panStart.y;
        positionStage();
        return;
      }
      if (aiSelecting) return;
      if (!painting || !last) return;
      e.preventDefault();
      const p = position(e);
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, Number(brush.value) / 3)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        paint(last.x + (p.x - last.x) * t, last.y + (p.y - last.y) * t);
      }
      last = p; scheduleDraw();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, () => {
        if (panning) {
          panning = false; panStart = null;
          root.classList.remove('depth-editor-dragging');
          return;
        }
        if (!painting) return;
        painting = false; last = null; updateLayerList(); scheduleDraw();
      });
    }
    layer.addEventListener('change', () => selectLayer(Number(layer.value)));
    groupInput?.addEventListener('input', () => { updateLayerList(true); scheduleDraw(); });
    nonlinearInput?.addEventListener('change', () => { updateLayerList(); scheduleDraw(); });
    nonlinearStrengthInput?.addEventListener('input', () => { updateLayerList(); scheduleDraw(); });
    showAll.addEventListener('change', scheduleDraw);
    overlayOpacity.addEventListener('input', scheduleDraw);
    buttons.undo.addEventListener('click', () => {
      if (!history.length || saving) return;
      redo.push(new Uint8ClampedArray(working.data)); setPixels(history.pop());
    });
    buttons.redo.addEventListener('click', () => {
      if (!redo.length || saving) return;
      history.push(new Uint8ClampedArray(working.data)); setPixels(redo.pop());
    });
    buttons.reset.addEventListener('click', () => {
      if (!original || saving || !confirm('Отменить все локальные правки карты?')) return;
      snapshot(); setPixels(original.data);
    });
    async function send(uploadForm) {
      const response = await fetch('/admin/depth-upload.php', {
        method: 'POST', body: uploadForm, credentials: 'same-origin'
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error || 'Ошибка сохранения');
      return data;
    }
    buttons.save.addEventListener('click', async () => {
      if (!working || !dirty || saving) return;
      saving = true; scheduleDraw(); status.textContent = 'Сохраняю карту глубины по слоям…';
      try {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = W; exportCanvas.height = H;
        exportCanvas.getContext('2d').putImageData(working, 0, 0);
        const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));
        if (!blob) throw Error('Не удалось создать PNG');
        const uploadForm = new FormData();
        uploadForm.append('id', panel.dataset.id);
        uploadForm.append('strength', strengthInput.value);
        uploadForm.append('manual', '1');
        // Save settings that determine the edited layer boundaries together
        // with the depth PNG, or the viewer could display different groups.
        uploadForm.append('groups', String(count()));
        uploadForm.append('nonlinear', nonlinear() ? '1' : '0');
        uploadForm.append('nonlinearStrength', String(nonlinearStrength()));
        uploadForm.append('depth', blob, 'manual-depth.png');
        const data = await send(uploadForm);
        saved.src = data.url + '?v=' + Date.now();
        const download = panel.querySelector('[data-depth-download]');
        if (download) download.href = data.url;
        original = ctx.createImageData(W, H);
        original.data.set(working.data);
        dirty = false; history.length = 0; redo.length = 0;
        status.textContent = 'Карта сохранена. Изменения слоёв появятся в просмотрщике при следующем открытии панорамы.';
      } catch (e) {
        status.textContent = 'Ошибка: ' + e.message;
      } finally {
        saving = false; updateLayerList(); scheduleDraw();
      }
    });
    buttons.restore.addEventListener('click', async () => {
      if (saving || !confirm('Вернуть исходную автоматически созданную карту глубины?')) return;
      saving = true; scheduleDraw();
      const uploadForm = new FormData();
      uploadForm.append('id', panel.dataset.id); uploadForm.append('action', 'restore');
      try {
        const data = await send(uploadForm);
        saved.src = data.url + '?v=' + Date.now();
        const download = panel.querySelector('[data-depth-download]');
        if (download) download.href = data.url;
        await load(); history.length = 0; redo.length = 0; dirty = false;
        status.textContent = 'Автоматическая карта восстановлена.';
      } catch (e) {
        status.textContent = 'Ошибка: ' + e.message;
      } finally {
        saving = false; scheduleDraw();
      }
    });
    window.addEventListener('beforeunload', e => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
    load().catch(e => {
      status.textContent = 'Не удалось открыть карту глубины: ' + e.message;
      root.hidden = true;
    });
  }
}
