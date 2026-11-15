import { Game } from './game.js';
import { HandTracker } from './tracker.js';
import {
  DRAG_HEIGHTS_TO_TOP,
  KEY_PULL,
  SLOW_DETECT_FPS,
  HIDDEN_RELEASE_MS,
} from './config.js';

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
  announcer: $('announcer'),
};

const DRAG_INSTEAD = 'Drag the rope down to hoist the flag instead.';
const CAMERA_HINT = 'You can also drag the rope.';
const SLOW_HINT = 'Hand tracking is slow on this device. Dragging the rope works better.';

let tracker = null; // HandTracker with a loaded model, while in camera mode
let pending = null; // HandTracker that is still starting up
let attempt = 0; // bumped to abandon a camera start that is in flight
let resuming = false;
let slowSeconds = 0;
let hiddenTimer = 0;
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

  // The camera is only needed while hoisting: switch it off (and its light)
  // as soon as the flag is up. "Hoist again" asks for it again.
  if (!hoisting) tracker?.releaseCamera();

  if (state === 'celebration') {
    ui.announcer.textContent = 'The flag is flying. Jai Hind! Happy Independence Day!';
  } else if (hoisting) {
    ui.announcer.textContent = '';
  }
  if (state === 'end') ui.again.focus({ preventScroll: true });
  if (!hoisting) canvas.classList.remove('dragging');
}

function setMode(mode) {
  body.dataset.mode = mode;
  ui.camera.hidden = mode !== 'camera';
  if (mode === 'camera') {
    ui.line1.textContent = 'Pinch your thumb and index finger together';
    ui.line2.textContent = 'Then pull down to hoist the flag';
    ui.line3.textContent = CAMERA_HINT;
  } else {
    ui.line1.textContent = 'Drag the rope down, again and again,';
    ui.line2.textContent = 'to hoist the flag';
    ui.line3.textContent = 'Or press the ↓ key.';
  }
}

function showToast(message, ms = 8000) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
}

// --- Starting ------------------------------------------------------------------------

function setLoading(text) {
  ui.startCamera.disabled = text !== null;
  ui.status.hidden = text === null;
  if (text !== null) ui.statusText.textContent = text;
}

function startDragMode(message) {
  setMode('drag');
  body.dataset.tracking = message ? 'error' : 'off';
  if (game.state === 'start') game.start();
  if (message) showToast(message);
}

/** Camera mode is over for this visit: release everything, keep playing. */
function dropToDrag(message) {
  tracker?.destroy();
  tracker = null;
  startDragMode(message);
}

function cameraFailureMessage(error) {
  if (error?.stage !== 'camera') {
    return error?.name === 'TimeoutError'
      ? `Hand tracking took too long to load. ${DRAG_INSTEAD}`
      : `Hand tracking could not be loaded. ${DRAG_INSTEAD}`;
  }
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Camera access was not allowed. ${DRAG_INSTEAD}`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No camera was found. ${DRAG_INSTEAD}`;
    default:
      return `The camera could not be started. ${DRAG_INSTEAD}`;
  }
}

function createTracker() {
  const created = new HandTracker({
    video: $('video'),
    overlay: $('overlay'),
    onGesture: (gesture) => {
      body.dataset.detections = String(created.detections);
      if (gesture.pulling) game.pull(gesture.gain);
    },
    onRate: (rate) => {
      body.dataset.detectRate = rate.toFixed(1);
      slowSeconds = rate < SLOW_DETECT_FPS ? slowSeconds + 1 : 0;
      if (body.dataset.mode === 'camera') {
        ui.line3.textContent = slowSeconds >= 3 ? SLOW_HINT : CAMERA_HINT;
      }
    },
    onError: (reason, error) => {
      if (created !== tracker) return;
      console.info(`Hand tracking stopped (${reason}).`, error ?? '');
      dropToDrag(reason === 'detector'
        ? `Hand tracking stopped working. ${DRAG_INSTEAD}`
        : `The camera stopped. ${DRAG_INSTEAD}`);
    },
  });
  return created;
}

async function startCameraMode() {
  const mine = ++attempt;
  const candidate = createTracker();
  pending = candidate;
  body.dataset.tracking = 'loading';
  setLoading('Waiting for the camera…');

  try {
    await candidate.start((stage) => {
      if (mine === attempt && stage === 'model') setLoading('Loading hand tracking…');
    });
    if (mine !== attempt) {
      candidate.destroy(); // the visitor chose to play without the camera
      return;
    }
    tracker = candidate;
    slowSeconds = 0;
    body.dataset.tracking = 'ready';
    setMode('camera');
    game.start();
    candidate.setActive(true);
  } catch (error) {
    candidate.destroy();
    if (mine !== attempt) return;
    console.info('Camera mode unavailable, falling back to dragging.', error);
    startDragMode(cameraFailureMessage(error));
  } finally {
    if (pending === candidate) pending = null;
    if (mine === attempt) setLoading(null);
  }
}

/** "Play without camera" stays available while the camera is starting. */
function chooseDragMode() {
  attempt++;
  pending?.destroy(); // a camera that still arrives later is stopped at once
  pending = null;
  setLoading(null);
  startDragMode();
}

/** Take the camera back after it was released (new round, tab shown again). */
async function resumeCamera() {
  if (!tracker || resuming || tracker.hasCamera) return;
  if (game.state !== 'hoisting' || document.hidden) return;
  const current = tracker;
  resuming = true;
  try {
    await current.acquireCamera();
    if (current !== tracker) return;
    if (game.state !== 'hoisting' || document.hidden) current.releaseCamera();
    else current.setActive(true);
  } catch (error) {
    if (error?.cancelled || current !== tracker) return;
    console.info('Camera could not be restarted, falling back to dragging.', error);
    dropToDrag(cameraFailureMessage(error));
  } finally {
    resuming = false;
  }
}

ui.startCamera.addEventListener('click', startCameraMode);
ui.startDrag.addEventListener('click', chooseDragMode);
ui.again.addEventListener('click', () => {
  game.reset();
  resumeCamera();
});

// Let go of the camera when the page goes away or sits in the background.
document.addEventListener('visibilitychange', () => {
  clearTimeout(hiddenTimer);
  if (document.hidden) {
    hiddenTimer = setTimeout(() => tracker?.releaseCamera(), HIDDEN_RELEASE_MS);
  } else {
    resumeCamera();
  }
});
window.addEventListener('pagehide', () => {
  clearTimeout(hiddenTimer);
  tracker?.releaseCamera();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) resumeCamera();
});

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
