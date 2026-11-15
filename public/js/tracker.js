import { MAX_DETECT_FPS } from './config.js';
import { PullDetector } from './gesture.js';

// Self-hosted copies made by `npm run build` (see scripts/build.mjs).
const VENDOR = new URL('../vendor/', import.meta.url);

/**
 * Webcam + MediaPipe HandLandmarker. Detection runs in its own loop, at most
 * once per new camera frame, and reports through callbacks; the render loop
 * never waits for it.
 */
export class HandTracker {
  constructor({ video, overlay, onGesture, onError }) {
    this.video = video;
    this.overlay = overlay;
    this.overlayCtx = overlay.getContext('2d');
    this.onGesture = onGesture;
    this.onError = onError;
    this.detector = new PullDetector();
    this.landmarker = null;
    this.stream = null;
    this.active = false; // detect only while the game wants input
    this.running = false;
    this.lastVideoTime = -1;
    this.lastDetect = 0;
    this.detections = 0;
    this.tick = this.tick.bind(this);
  }

  /**
   * Must be called from a user gesture so the permission prompt may show.
   * The model (about 18 MB with its runtime) is only fetched once the camera
   * is available, so visitors who decline do not download it for nothing.
   */
  async start(onStage = () => {}) {
    let stage = 'camera';
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('This browser has no camera support.', 'NotSupportedError');
      }
      onStage(stage);
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      this.video.srcObject = this.stream;
      await this.video.play();

      stage = 'model';
      onStage(stage);
      this.landmarker = await loadLandmarker();
    } catch (error) {
      this.stop();
      // Tell the caller which half failed so it can explain it.
      throw Object.assign(new Error(error?.message || String(error), { cause: error }), {
        name: error?.name || 'Error',
        stage,
      });
    }

    this.running = true;
    requestAnimationFrame(this.tick);
  }

  setActive(active) {
    this.active = active;
    if (!active) {
      this.detector.reset();
      this.clearOverlay();
    }
  }

  stop() {
    this.running = false;
    this.active = false;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.landmarker?.close();
    this.landmarker = null;
  }

  tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    const video = this.video;
    if (!this.active || video.readyState < 2 || !video.videoWidth) return;
    if (video.currentTime === this.lastVideoTime) return; // no new frame yet
    if (now - this.lastDetect < 1000 / MAX_DETECT_FPS - 2) return;
    this.lastVideoTime = video.currentTime;
    this.lastDetect = now;

    let hand = null;
    try {
      const result = this.landmarker.detectForVideo(video, now);
      hand = result.landmarks?.[0] ?? null;
    } catch (error) {
      this.stop();
      this.onError(error);
      return;
    }
    this.detections++;

    const gesture = this.detector.update(hand, now);
    this.drawOverlay(hand, gesture.pinching);
    this.onGesture(gesture);
  }

  clearOverlay() {
    this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  /** Thumb and index markers, joined by a line while pinching (as in main.py). */
  drawOverlay(hand, pinching) {
    const { overlay, video } = this;
    if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    const ctx = this.overlayCtx;
    const w = overlay.width;
    const h = overlay.height;
    ctx.clearRect(0, 0, w, h);
    if (!hand) return;

    const thumb = hand[4];
    const index = hand[8];
    const r = Math.max(5, w / 90);
    ctx.fillStyle = 'rgb(0, 255, 0)';
    ctx.strokeStyle = 'rgb(0, 255, 0)';
    ctx.lineWidth = Math.max(2, w / 220);
    if (pinching) {
      ctx.beginPath();
      ctx.moveTo(thumb.x * w, thumb.y * h);
      ctx.lineTo(index.x * w, index.y * h);
      ctx.stroke();
    }
    for (const p of [thumb, index]) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** True when WebGL is missing or emulated in software (slower than wasm). */
function hasHardwareWebGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

async function loadLandmarker() {
  const [{ FilesetResolver, HandLandmarker }, { MODEL_URL }] = await Promise.all([
    import(new URL('mediapipe/vision_bundle.mjs', VENDOR).href),
    import(new URL('config.js', VENDOR).href),
  ]);
  const wasmBase = new URL('mediapipe/wasm', VENDOR).href;
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);
  const modelAssetPath = new URL(MODEL_URL, VENDOR).href;

  // Same settings as mp.solutions.hands.Hands(max_num_hands=1,
  // min_detection_confidence=0.7) in main.py.
  const create = (delegate) => {
    // MediaPipe writes its start-up notes ("INFO: Created TensorFlow Lite
    // XNNPACK delegate for CPU.") to stderr, which would show up as console
    // errors. The loader picks up a pre-set Emscripten Module, so route them
    // to the debug level instead.
    const log = (...args) => console.debug('[mediapipe]', ...args);
    self.Module = { print: log, printErr: log };
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.7,
    }).finally(() => { self.Module = undefined; });
  };

  if (!hasHardwareWebGL()) return create('CPU');
  try {
    return await create('GPU');
  } catch (gpuError) {
    console.info('GPU hand tracking unavailable, using CPU.', gpuError);
    return create('CPU');
  }
}
