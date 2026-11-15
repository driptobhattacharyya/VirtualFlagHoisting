// Tunable constants for the browser port. Values marked "Python" are taken
// from main.py; the per-frame ones are converted to per-second so behaviour
// does not depend on how fast the browser renders or detects.

export const COLORS = {
  saffron: 'rgb(255, 153, 51)',
  white: 'rgb(255, 255, 255)',
  green: 'rgb(18, 136, 7)',
  navy: 'rgb(0, 0, 128)',
  pole: 'rgb(139, 69, 19)',
  poleShadow: 'rgb(100, 50, 0)',
};

// --- Gesture (Python: evaluated once per camera frame, ~30 fps) -------------

// Python: pinch when the 3D distance between landmarks 4 and 8 is < 0.05.
export const PINCH_THRESHOLD = 0.05;

// Python: wrist (landmark 0) must move down by > 0.01 of the frame height
// between two consecutive frames. At 30 fps that is 0.3 frame heights/second.
export const PULL_MIN_SPEED = 0.3;

// Python: +12 px per pulling frame with max_height = 0.7 * 1080 px, i.e.
// 12 / 756 of the pole per frame, or ~0.476 of the pole per second at 30 fps.
export const HOIST_RATE = (12 / 756) * 30;

// Wrist speed is measured against a sample at least this old (one 30 fps
// frame), so fast detectors do not amplify landmark jitter.
export const SPEED_WINDOW_MS = 30;

// If the hand was last seen longer ago than this, start measuring afresh.
// Generous enough for slow devices that only manage a few detections/second.
export const MAX_SAMPLE_GAP_MS = 500;

// Longest time one detection may be credited with pulling.
export const MAX_GAIN_DT_MS = 250;

// A wrist "moving" faster than this (frame heights/second) is a tracking jump
// or a hand that reappeared elsewhere, not a pull. A brisk real pull is ~1-2.5.
export const PULL_MAX_SPEED = 4;

// Below this many detections per second the page suggests dragging the rope.
export const SLOW_DETECT_FPS = 8;

// Hand tracking start-up and camera health.
export const MODEL_TIMEOUT_MS = 25000;
export const FRAME_WATCHDOG_MS = 2000;
export const HIDDEN_RELEASE_MS = 15000;

// Upper bound on hand detections per second.
export const MAX_DETECT_FPS = 30;

// --- Rope dragging (no-camera input) ----------------------------------------

// Total downward drag, in viewport heights, needed to hoist the flag fully.
export const DRAG_HEIGHTS_TO_TOP = 2.2;

// Fraction of the pole gained per ArrowDown / Space key press.
export const KEY_PULL = 0.05;

// --- Flag ---------------------------------------------------------------------

// Python: the flag counts as "at the top" from 98 % and is drawn at 37 % of
// its width (fold_factor 0.9 * 0.7) until then.
export const TOP_FRACTION = 0.98;
export const FOLDED_WIDTH = 1 - 0.9 * 0.7;
export const UNFURL_SECONDS = 0.9;

// --- Celebration --------------------------------------------------------------

export const CELEBRATION_SECONDS = 5; // Python
export const FIREWORK_INTERVAL = 0.3; // Python, seconds
export const FIREWORK_INTERVAL_REDUCED = 0.75;

// Python physics is per frame at 60 fps; converted to seconds here.
export const FRAME = 1 / 60;
export const FIREWORK_GRAVITY = 0.2 / (FRAME * FRAME); // px/s^2
export const PARTICLE_LIFE = 100 * FRAME; // s, Python
export const PARTICLE_GRAVITY = 170; // px/s^2 at scale 1; sparks are light
export const PARTICLE_DRAG = 2.2; // 1/s, air resistance
