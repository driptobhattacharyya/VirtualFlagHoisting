import { Game } from './game.js';
import { DRAG_HEIGHTS_TO_TOP, KEY_PULL } from './config.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
const canvas = $('stage');

const ui = {
  start: $('start'),
  startCamera: $('start-camera'),
  startDrag: $('start-drag'),
  status: $('start-status'),
  statusText: $('start-status-text'),
  hud: $('hud'),
  camera: $('camera'),
  line1: $('instruction-1'),
  line2: $('instruction-2'),
  line3: $('instruction-3'),
  jaiHind: $('jai-hind'),
  celebration: $('celebration'),
  again: $('again'),
  toast: $('toast'),
};

let tracker = null; // set while the camera is in use
let toastTimer = 0;

const game = new Game(canvas, { onStateChange: applyState });

// --- Reduced motion --------------------------------------------------------------

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const applyMotion = () => { game.reducedMotion = motionQuery.matches; };
applyMotion();
motionQuery.addEventListener('change', applyMotion);

// --- State -> DOM ------------------------------------------------------------------

function applyState(state) {
  body.dataset.state = state;
  const hoisting = state === 'hoisting';
  const celebrating = state === 'celebration' || state === 'end';

  ui.start.hidden = state !== 'start';
  ui.hud.hidden = !hoisting;
  ui.jaiHind.hidden = !celebrating;
  ui.celebration.hidden = !celebrating;
  ui.again.hidden = state !== 'end';
  tracker?.setActive(hoisting);

  if (state === 'end') ui.again.focus({ preventScroll: true });
  if (!hoisting) canvas.classList.remove('dragging');
}

function setMode(mode) {
  body.dataset.mode = mode;
  ui.camera.hidden = mode !== 'camera';
  if (mode === 'camera') {
    ui.line1.textContent = 'Pinch your thumb and index finger together';
    ui.line2.textContent = 'Then pull down to hoist the flag';
    ui.line3.textContent = 'You can also drag the rope.';
  } else {
    ui.line1.textContent = 'Drag the rope down, again and again,';
    ui.line2.textContent = 'to hoist the flag';
    ui.line3.textContent = 'Or press the ↓ key.';
  }
}

function showToast(message, ms = 7000) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
}

// --- Starting ------------------------------------------------------------------------

function startDragMode(message) {
  setMode('drag');
  body.dataset.tracking = message ? 'error' : 'off';
  game.start();
  if (message) showToast(message);
}

function cameraFailureMessage(error) {
  const fallback = 'Drag the rope down to hoist the flag instead.';
  if (error?.stage !== 'camera') return `Hand tracking could not be loaded. ${fallback}`;
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Camera access was not allowed. ${fallback}`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No camera was found. ${fallback}`;
    default:
      return `The camera could not be started. ${fallback}`;
  }
}

async function startCameraMode() {
  ui.startCamera.disabled = true;
  ui.startDrag.disabled = true;
  ui.statusText.textContent = 'Waiting for the camera…';
  ui.status.hidden = false;
  body.dataset.tracking = 'loading';

  try {
    const { HandTracker } = await import('./tracker.js');
    const candidate = new HandTracker({
      video: $('video'),
      overlay: $('overlay'),
      onGesture: (gesture) => {
        body.dataset.detections = String(candidate.detections);
        if (gesture.pulling) game.pull(gesture.gain);
      },
      onError: (error) => {
        console.warn('Hand tracking stopped.', error);
        tracker = null;
        setMode('drag');
        body.dataset.tracking = 'error';
        showToast('Hand tracking stopped working. Drag the rope down to hoist the flag instead.');
      },
    });
    await candidate.start((stage) => {
      if (stage === 'model') ui.statusText.textContent = 'Loading hand tracking…';
    });
    tracker = candidate;
    body.dataset.tracking = 'ready';
    setMode('camera');
    game.start();
  } catch (error) {
    console.info('Camera mode unavailable, falling back to dragging.', error);
    startDragMode(cameraFailureMessage(error));
  } finally {
    ui.status.hidden = true;
    ui.startCamera.disabled = false;
    ui.startDrag.disabled = false;
  }
}

ui.startCamera.addEventListener('click', startCameraMode);
ui.startDrag.addEventListener('click', () => startDragMode());
ui.again.addEventListener('click', () => game.reset());

// --- Rope dragging (mouse, touch, pen) and keyboard -------------------------------------

let dragPointer = null;
let lastY = 0;

canvas.addEventListener('pointerdown', (event) => {
  if (game.state !== 'hoisting' || dragPointer !== null) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  dragPointer = event.pointerId;
  lastY = event.clientY;
  game.grabbing = true;
  canvas.classList.add('dragging');
  try { canvas.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== dragPointer) return;
  const dy = event.clientY - lastY;
  lastY = event.clientY;
  game.moveGrab(dy);
  // Only downward movement hauls the rope; moving back up is the next reach.
  if (dy > 0) game.pull(dy / (game.height * DRAG_HEIGHTS_TO_TOP));
});

function endDrag(event) {
  if (event.pointerId !== dragPointer) return;
  dragPointer = null;
  game.grabbing = false;
  canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);

window.addEventListener('keydown', (event) => {
  if (game.state !== 'hoisting' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLElement && event.target.closest('button, a, input')) return;
  if (event.key === 'ArrowDown' || event.key === ' ') {
    event.preventDefault();
    game.pull(KEY_PULL);
    game.moveGrab(game.height * 0.06);
  }
});

// --- Render loop -----------------------------------------------------------------------

const onResize = () => game.resize();
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(canvas);
// devicePixelRatio changes (zoom, moving between monitors) are picked up in
// the frame loop, which is cheap: resize() is a no-op when nothing changed.

let previous = performance.now();
function frame(now) {
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  game.resize();
  game.update(dt);
  game.render();
  body.dataset.progress = game.progress.toFixed(3);
  requestAnimationFrame(frame);
}

applyState(game.state);
requestAnimationFrame(frame);
