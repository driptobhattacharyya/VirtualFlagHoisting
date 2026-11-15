import { MAX_DETECT_FPS, MODEL_TIMEOUT_MS, FRAME_WATCHDOG_MS } from './config.js';
import { PullDetector } from './gesture.js';

const cancelled = () => Object.assign(new Error('Camera start was cancelled.'), { cancelled: true });

/** Re-throwable copy of an error that says which half of start-up failed. */
function tagged(error, stage) {
  if (error?.cancelled) return error;
  return Object.assign(new Error(error?.message || String(error), { cause: error }), {
    name: error?.name || 'Error',
    stage,
  });
}

/**
 * Webcam + MediaPipe HandLandmarker.
 *
 * The camera is held only while the game needs it: releaseCamera() stops the
 * tracks (and the camera light), acquireCamera() asks for it again. The model
 * stays loaded in between. Detection runs in its own loop, at most once per
 * new camera frame, and reports through callbacks; the render loop never
 * waits for it.
 */
export class HandTracker {
  constructor({ video, overlay, onGesture, onRate, onError }) {
    this.video = video;
    this.overlay = overlay;
    this.overlayCtx = overlay.getContext('2d');
    this.onGesture = onGesture;
    this.onRate = onRate || (() => {});
    this.onError = onError;
    this.detector = new PullDetector();
    this.landmarker = null;
    this.stream = null;
    this.track = null;
    this.onTrackEnded = () => this.fail('ended');
    this.active = false; // detect only while the game wants input
    this.destroyed = false;
    this.cameraToken = 0; // invalidates camera requests that resolve late
    this.loopId = 0;
    this.detections = 0;
    this.resetTiming(0);
  }

  get hasCamera() {
    return this.stream !== null;
  }

  /**
   * Must be called from a user gesture so the permission prompt may show.
   * The model (about 18 MB with its runtime) is only fetched once the camera
   * is available, so visitors who decline do not download it for nothing.
   */
  async start(onStage = () => {}) {
    onStage('camera');
    await this.acquireCamera();
    onStage('model');
    let landmarker;
    try {
      landmarker = await withTimeout(loadLandmarker(), MODEL_TIMEOUT_MS);
    } catch (error) {
      this.destroy();
      throw tagged(error, 'model');
    }
    if (this.destroyed) {
      landmarker.close();
      throw cancelled();
    }
    this.landmarker = landmarker;
  }

  /** Ask for the camera (again). Rejects with `.cancelled` if superseded. */
  async acquireCamera() {
    const token = ++this.cameraToken;
    const stale = () => token !== this.cameraToken || this.destroyed;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('This browser has no camera support.', 'NotSupportedError');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (stale()) {
        // Resolved after the visitor moved on: never keep this camera.
        stream.getTracks().forEach((track) => track.stop());
        throw cancelled();
      }
      this.stream = stream;
      this.track = stream.getVideoTracks()[0] || null;
      this.track?.addEventListener('ended', this.onTrackEnded);
      this.video.srcObject = stream;
      await this.video.play();
      if (stale()) throw cancelled();
    } catch (error) {
      if (stale()) throw cancelled();
      this.releaseCamera();
      throw tagged(error, 'camera');
    }
    this.startLoop();
  }

  /** Stop the camera tracks; the model stays loaded for the next round. */
  releaseCamera() {
    this.cameraToken++;
    this.loopId++;
    this.active = false;
    this.track?.removeEventListener('ended', this.onTrackEnded);
    this.track = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.detector.reset();
    this.clearOverlay();
  }

  setActive(active) {
    this.active = active;
    this.resetTiming(performance.now());
    if (!active) {
      this.detector.reset();
      this.clearOverlay();
    }
  }

  destroy() {
    this.destroyed = true;
    this.releaseCamera();
    this.landmarker?.close();
    this.landmarker = null;
  }

  /** The camera or the detector gave up: let go and tell the page. */
  fail(reason, error) {
    if (this.destroyed) return;
    this.destroy();
    this.onError(reason, error);
  }

  resetTiming(now) {
    this.lastTick = now;
    this.lastFrameAt = now;
    this.seenVideoTime = -1;
    this.lastVideoTime = -1;
    this.lastDetect = 0;
    this.rateStart = now;
    this.rateCount = 0;
  }

  startLoop() {
    const id = ++this.loopId;
    this.resetTiming(performance.now());
    const tick = (now) => {
      if (id !== this.loopId) return;
      requestAnimationFrame(tick);
      this.step(now);
    };
    requestAnimationFrame(tick);
  }

  step(now) {
    const video = this.video;
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (!this.active || !this.landmarker) {
      this.lastFrameAt = now;
      return;
    }
    // The loop itself was paused (background tab): not the camera's fault.
    if (gap > 500) {
      this.lastFrameAt = now;
      this.rateStart = now;
      this.rateCount = 0;
    }

    const ready = video.readyState >= 2 && video.videoWidth > 0;
    if (ready && video.currentTime !== this.seenVideoTime) {
      this.seenVideoTime = video.currentTime;
      this.lastFrameAt = now;
    } else if (now - this.lastFrameAt > FRAME_WATCHDOG_MS) {
      this.fail('stalled'); // no new camera frame for a while
      return;
    }
    if (!ready || video.currentTime === this.lastVideoTime) return; // no new frame yet
    if (now - this.lastDetect < 1000 / MAX_DETECT_FPS - 2) return;
    this.lastVideoTime = video.currentTime;
    this.lastDetect = now;

    let hand = null;
    try {
      const result = this.landmarker.detectForVideo(video, now);
      hand = result.landmarks?.[0] ?? null;
    } catch (error) {
      this.fail('detector', error);
      return;
    }
    this.detections++;
    this.rateCount++;
    const elapsed = performance.now() - this.rateStart;
    if (elapsed >= 1000) {
      this.onRate((this.rateCount * 1000) / elapsed);
      this.rateStart = performance.now();
      this.rateCount = 0;
    }

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

/** Reject after `ms`; a model that still arrives later is closed again. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new DOMException('Hand tracking took too long to load.', 'TimeoutError'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) value.close();
        else resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
  // vendor.js is written by `npm run build` (scripts/build.mjs) and points at
  // versioned copies of the MediaPipe runtime and the model.
  const { MEDIAPIPE_URL, MODEL_URL } = await import('./vendor.js');
  const base = new URL(MEDIAPIPE_URL, import.meta.url);
  const { FilesetResolver, HandLandmarker } = await import(new URL('vision_bundle.mjs', base).href);
  const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', base).href);
  const modelAssetPath = new URL(MODEL_URL, import.meta.url).href;

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
