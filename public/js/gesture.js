import {
  PINCH_THRESHOLD,
  PULL_MIN_SPEED,
  HOIST_RATE,
  SPEED_WINDOW_MS,
  MAX_SAMPLE_GAP_MS,
} from './config.js';

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;

/**
 * Time-based version of the pull detection in main.py.
 *
 * Feed it the hand landmarks of every detection (or null when no hand is
 * visible) together with a timestamp in milliseconds. It reports whether the
 * hand is pinching, whether it is pulling down, and how much of the pole the
 * flag should rise for this detection.
 */
export class PullDetector {
  constructor() {
    this.samples = []; // { t, y } of the wrist, oldest first
    this.lastTime = null;
  }

  reset() {
    this.samples.length = 0;
    this.lastTime = null;
  }

  update(landmarks, timeMs) {
    const result = { hand: false, pinching: false, pulling: false, gain: 0 };
    if (!landmarks || landmarks.length <= INDEX_TIP) {
      this.reset();
      return result;
    }
    result.hand = true;

    const thumb = landmarks[THUMB_TIP];
    const index = landmarks[INDEX_TIP];
    const pinch = Math.hypot(
      thumb.x - index.x,
      thumb.y - index.y,
      (thumb.z || 0) - (index.z || 0),
    );
    result.pinching = pinch < PINCH_THRESHOLD;

    const y = landmarks[WRIST].y;
    const samples = this.samples;
    while (samples.length && timeMs - samples[0].t > MAX_SAMPLE_GAP_MS) samples.shift();

    // Reference: the newest sample that is at least one 30 fps frame old,
    // otherwise the oldest one we still have.
    let ref = null;
    for (let i = samples.length - 1; i >= 0; i--) {
      ref = samples[i];
      if (timeMs - ref.t >= SPEED_WINDOW_MS) break;
    }

    if (ref && result.pinching && timeMs > ref.t) {
      const speed = (y - ref.y) / ((timeMs - ref.t) / 1000); // + is downward
      if (speed > PULL_MIN_SPEED) {
        const dt = Math.min(timeMs - this.lastTime, 100) / 1000;
        result.pulling = true;
        result.gain = HOIST_RATE * dt;
      }
    }

    samples.push({ t: timeMs, y });
    this.lastTime = timeMs;
    return result;
  }
}
