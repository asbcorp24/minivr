import * as THREE from '/assets/vendor/three/three.module.js';
import { anglesToDirection, directionToAngles, validHotspotAngles } from '/assets/hotspot-import-geometry.js';

const root = document.querySelector('#hotspot-import-viewer');
const data = JSON.parse(document.querySelector('#hotspot-import-data').textContent);
const points = data.points.map(point => ({ ...point, originalYaw: point.yaw, originalPitch: point.pitch, dirty: false }));
const buttons = [...document.querySelectorAll('[data-point]')];
const form = document.querySelector('#hotspot-import-place-form');
const label = document.querySelector('#hotspot-import-selected-label');
const description = document.querySelector('#hotspot-import-selected-content');
const placementStatus = document.querySelector('#hotspot-import-placement-status');
const viewerStatus = document.querySelector('#hotspot-import-viewer-status');
const yawInput = document.querySelector('#hotspot-import-yaw');
const pitchInput = document.querySelector('#hotspot-import-pitch');
const indexInput = document.querySelector('#hotspot-import-index');
const saveButton = document.querySelector('#hotspot-import-save');
const fullscreenButton = document.querySelector('#hotspot-import-fullscreen');

let selected = data.initial;
let longitude = 0;
let latitude = 0;
let imageReady = false;
let disposed = false;
let pointer = null;
const markerMeshes = [];
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
const raycaster = new THREE.Raycaster();
let sphere = null;
let sphereTexture = null;
let sphereGeometry = null;
let sphereMaterial = null;
let renderer;

try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  root.appendChild(renderer.domElement);
} catch (error) {
  viewerStatus.textContent = 'WebGL недоступен. Можно ввести yaw/pitch вручную.';
}

const markerGeometry = new THREE.SphereGeometry(9, 12, 8);
function markerColor(point, index) {
  if (index === selected) return 0xffd475;
  return point.saved ? 0x5be8c1 : 0x62b6ff;
}
function refreshMarkers() {
  for (const marker of markerMeshes) {
    scene.remove(marker);
    marker.material.dispose();
  }
  markerMeshes.length = 0;
  points.forEach((point, index) => {
    if (!validHotspotAngles(point.yaw, point.pitch)) return;
    const direction = anglesToDirection(point.yaw, point.pitch);
    const material = new THREE.MeshBasicMaterial({ color: markerColor(point, index), depthTest: false });
    const marker = new THREE.Mesh(markerGeometry, material);
    marker.position.set(direction.x * 490, direction.y * 490, direction.z * 490);
    marker.renderOrder = 2;
    scene.add(marker);
    markerMeshes.push(marker);
  });
}
function syncSelected() {
  const point = points[selected];
  if (!point) return;
  buttons.forEach((button, index) => {
    button.classList.toggle('selected', index === selected);
    button.setAttribute('aria-pressed', String(index === selected));
    const text = button.querySelector('small');
    if (text) text.textContent = points[index].conflict ? '⚠ дубликаты в базе'
      : points[index].dirty ? '✎ изменения не сохранены'
        : points[index].saved ? '✓ сохранена' : '◯ не размещена';
  });
  indexInput.value = String(point.index);
  label.textContent = point.label;
  description.textContent = point.content || 'Нет дополнительного описания.';
  yawInput.value = validHotspotAngles(point.yaw, point.pitch) ? String(Number(point.yaw.toFixed(3))) : '';
  pitchInput.value = validHotspotAngles(point.yaw, point.pitch) ? String(Number(point.pitch.toFixed(3))) : '';
  saveButton.disabled = !!point.conflict || !validHotspotAngles(point.yaw, point.pitch);
  placementStatus.textContent = point.conflict
    ? 'В базе несколько совпадающих записей. Уберите дубликаты через редактор точек.'
    : point.saved && point.dirty ? 'Позиция изменена — нажмите «Сохранить координаты», чтобы обновить точку.'
      : point.saved ? 'Точка сохранена. Можно выбрать новое место и обновить координаты.'
      : validHotspotAngles(point.yaw, point.pitch) ? 'Координаты готовы — сохраните их.'
        : 'Нажмите на панораму или используйте кнопку «Поставить в центре».';
  refreshMarkers();
}
function updatePosition(yaw, pitch) {
  if (!validHotspotAngles(yaw, pitch) || points[selected].conflict) return;
  points[selected].yaw = yaw;
  points[selected].pitch = pitch;
  points[selected].dirty = yaw !== points[selected].originalYaw || pitch !== points[selected].originalPitch;
  syncSelected();
}

buttons.forEach((button, index) => button.addEventListener('click', () => {
  selected = index;
  syncSelected();
  const point = points[index];
  if (validHotspotAngles(point.yaw, point.pitch)) {
    longitude = point.yaw;
    latitude = Math.max(-85, Math.min(85, point.pitch));
  }
}));

function syncManualInput() {
  const yaw = yawInput.value === '' ? NaN : Number(yawInput.value);
  const pitch = pitchInput.value === '' ? NaN : Number(pitchInput.value);
  if (validHotspotAngles(yaw, pitch)) {
    updatePosition(yaw, pitch);
  } else {
    points[selected].yaw = null;
    points[selected].pitch = null;
    saveButton.disabled = true;
    placementStatus.textContent = 'Введите корректные yaw и pitch или выберите место на панораме.';
    refreshMarkers();
  }
}
yawInput.addEventListener('change', syncManualInput);
pitchInput.addEventListener('change', syncManualInput);
form.addEventListener('submit', event => {
  if (points[selected].conflict || !validHotspotAngles(points[selected].yaw, points[selected].pitch)) {
    event.preventDefault();
    syncSelected();
  }
});

function updateCamera() {
  const dir = anglesToDirection(longitude, latitude);
  camera.lookAt(dir.x * 500, dir.y * 500, dir.z * 500);
}
function placeAtCenter() {
  if (!imageReady) return;
  updatePosition(((longitude + 180) % 360 + 360) % 360 - 180, latitude);
}
document.querySelector('#hotspot-import-center').addEventListener('click', placeAtCenter);

function resize() {
  if (!renderer || disposed) return;
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
const observer = new ResizeObserver(resize);
observer.observe(root);

if (renderer) {
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  const sensitivity = 0.3;
  canvas.addEventListener('pointerdown', event => {
    if (pointer !== null || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) pointer.dragged = true;
    if (pointer.dragged) {
      longitude -= (event.clientX - pointer.lastX) * sensitivity;
      latitude = Math.max(-85, Math.min(85, latitude + (event.clientY - pointer.lastY) * sensitivity));
    }
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  });
  function finishPointer(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const clicked = !pointer.dragged && event.type === 'pointerup';
    pointer = null;
    canvas.style.cursor = 'crosshair';
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (!clicked || !imageReady || points[selected].conflict) return;
    updateCamera();
    camera.updateMatrixWorld();
    const bounds = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    ), camera);
    const hit = raycaster.intersectObject(sphere)[0];
    if (hit) {
      const { yaw, pitch } = directionToAngles(hit.point);
      updatePosition(yaw, pitch);
    }
  }
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    camera.fov = Math.max(35, Math.min(95, camera.fov + (event.deltaY > 0 ? 4 : -4)));
    camera.updateProjectionMatrix();
  }, { passive: false });

  new THREE.TextureLoader().load(root.dataset.image, texture => {
    if (disposed) { texture.dispose(); return; }
    sphereTexture = texture;
    texture.colorSpace = THREE.SRGBColorSpace;
    if (root.dataset.stereo === 'sbs') texture.repeat.set(0.5, 1);
    if (root.dataset.stereo === 'tb') { texture.repeat.set(1, 0.5); texture.offset.y = 0.5; }
    sphereGeometry = new THREE.SphereGeometry(500, 64, 40);
    sphereMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
    sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(sphere);
    imageReady = true;
    viewerStatus.textContent = 'Нажмите на нужное место; цветные маркеры показывают позиции точек.';
  }, undefined, () => {
    viewerStatus.textContent = 'Не удалось загрузить панораму. Координаты можно ввести вручную.';
  });
  resize();
  renderer.setAnimationLoop(() => {
    updateCamera();
    renderer.render(scene, camera);
  });
}

function syncFullscreen() {
  const expanded = root.classList.contains('hotspot-import-expanded');
  document.body.classList.toggle('hotspot-import-fullscreen-active', expanded);
  fullscreenButton.textContent = expanded ? '⤢ Свернуть' : '⛶ Развернуть';
  fullscreenButton.setAttribute('aria-label', expanded ? 'Свернуть панораму' : 'На весь экран');
  requestAnimationFrame(resize);
}
fullscreenButton.addEventListener('click', () => {
  root.classList.toggle('hotspot-import-expanded');
  syncFullscreen();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && root.classList.contains('hotspot-import-expanded')) {
    root.classList.remove('hotspot-import-expanded');
    syncFullscreen();
  }
});

window.addEventListener('pagehide', () => {
  disposed = true;
  observer.disconnect();
  for (const marker of markerMeshes) marker.material.dispose();
  markerGeometry.dispose();
  sphereGeometry?.dispose();
  sphereMaterial?.dispose();
  sphereTexture?.dispose();
  renderer?.setAnimationLoop(null);
  renderer?.dispose();
});

syncSelected();
