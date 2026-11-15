import {
  COLORS,
  TOP_FRACTION,
  FOLDED_WIDTH,
  UNFURL_SECONDS,
  CELEBRATION_SECONDS,
  FIREWORK_INTERVAL,
  FIREWORK_INTERVAL_REDUCED,
  FIREWORK_GRAVITY,
  PARTICLE_LIFE,
  PARTICLE_GRAVITY,
  PARTICLE_DRAG,
} from './config.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));

/**
 * The flag hoisting game: state machine, animation and canvas rendering.
 *
 * States, as in main.py: "start" (web only, before the first input),
 * "hoisting", "celebration" and "end".
 */
export class Game {
  constructor(canvas, { onStateChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStateChange = onStateChange || (() => {});
    this.reducedMotion = false;

    this.width = 1;
    this.height = 1;
    this.dpr = 1;

    this.state = 'start';
    this.progress = 0; // 0 = bottom of the pole, 1 = top
    this.shown = 0; // eased copy of progress used for drawing
    this.unfurl = 0; // 0 = folded, 1 = fully open
    this.time = 0;

    this.celebrationTime = 0;
    this.sinceFirework = 0;
    this.fireworks = [];
    this.particles = [];

    this.ropeTravel = 0; // px of rope hauled, drives the rope pattern
    this.grab = 0; // px the rope handle is currently pulled down
    this.grabbing = false;

    this.flagTexture = document.createElement('canvas');
    this.flagTextureKey = '';

    this.resize();
  }

  // --- State -----------------------------------------------------------------

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.onStateChange(state);
  }

  start() {
    this.reset();
  }

  reset() {
    this.progress = 0;
    this.shown = 0;
    this.unfurl = 0;
    this.celebrationTime = 0;
    this.sinceFirework = 0;
    this.fireworks.length = 0;
    this.particles.length = 0;
    this.grab = 0;
    this.grabbing = false;
    this.setState('hoisting');
  }

  /** Raise the flag by a fraction of the pole. Only acts while hoisting. */
  pull(fraction) {
    if (this.state !== 'hoisting' || !(fraction > 0)) return;
    this.progress = Math.min(1, this.progress + fraction);
    this.ropeTravel += fraction * this.layout().maxHeight;
    if (this.progress >= 1) {
      this.celebrationTime = 0;
      this.sinceFirework = Infinity; // launch the first firework immediately
      this.setState('celebration');
    }
  }

  /** Visual feedback for the rope handle; dy in CSS px (may be negative). */
  moveGrab(dy) {
    this.grab = clamp(this.grab + dy, 0, this.height * 0.25);
  }

  // --- Layout ------------------------------------------------------------------

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.width = width;
    this.height = height;
    this.dpr = dpr;
  }

  /** All geometry is derived from the viewport, so resizing is free. */
  layout() {
    const W = this.width;
    const H = this.height;
    const poleWidth = clamp(W * 0.01, 6, 18);
    const poleX = W / 2; // centre line of the pole
    const poleY = H * 0.1;
    const maxHeight = H * 0.7; // Python: max_height
    const flagX = poleX + poleWidth / 2;
    // Python: 15 % of the screen width, 3:2. Kept readable on narrow screens
    // and small enough to fit beside the pole and below it before hoisting.
    const room = W - flagX - 28;
    const flagWidth = Math.max(40, Math.min(Math.max(W * 0.15, 130), room, H * 0.27));
    const flagHeight = (flagWidth * 2) / 3;
    const ropeX = poleX - poleWidth / 2 - clamp(W * 0.012, 9, 16);
    return { W, H, poleWidth, poleX, poleY, maxHeight, flagX, flagWidth, flagHeight, ropeX };
  }

  // --- Simulation ----------------------------------------------------------------

  update(dt) {
    this.time += dt;

    // Ease the drawn height towards the real one so pulls look smooth.
    this.shown += (this.progress - this.shown) * (1 - Math.exp(-dt * 14));
    if (Math.abs(this.progress - this.shown) < 0.0005) this.shown = this.progress;

    const atTop = this.state !== 'start' && this.shown >= TOP_FRACTION;
    this.unfurl = atTop ? Math.min(1, this.unfurl + dt / UNFURL_SECONDS) : 0;

    if (!this.grabbing && this.grab > 0) {
      this.grab *= Math.exp(-dt * 10);
      if (this.grab < 0.5) this.grab = 0;
    }

    if (this.state === 'celebration') this.updateCelebration(dt);
  }

  updateCelebration(dt) {
    const { W, H } = this.layout();
    this.celebrationTime += dt;
    this.sinceFirework += dt;

    const active = this.celebrationTime <= CELEBRATION_SECONDS;
    const interval = this.reducedMotion ? FIREWORK_INTERVAL_REDUCED : FIREWORK_INTERVAL;
    if (active && this.sinceFirework > interval) {
      this.sinceFirework = 0;
      this.launchFirework(W, H);
    }

    // Fireworks rise until they stall, then burst into sparks.
    for (let i = this.fireworks.length - 1; i >= 0; i--) {
      const fw = this.fireworks[i];
      fw.y += fw.vy * dt;
      fw.vy += fw.gravity * dt;
      if (fw.vy >= 0) {
        this.fireworks.splice(i, 1);
        this.burst(fw);
      }
    }

    const size = this.sparkSize();
    const slow = Math.exp(-PARTICLE_DRAG * dt);
    const follow = 1 - Math.exp(-dt * 9);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= slow;
      p.vy = p.vy * slow + PARTICLE_GRAVITY * size * dt;
      // The tail trails behind the head, which draws a short streak.
      p.tx += (p.x - p.tx) * follow;
      p.ty += (p.y - p.ty) * follow;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    if (!active && this.fireworks.length === 0 && this.particles.length === 0) {
      this.setState('end');
    }
  }

  /** Spark size factor: bigger sparks on bigger screens. */
  sparkSize() {
    return clamp(Math.min(this.width, this.height) / 600, 0.9, 2.2);
  }

  launchFirework(W, H) {
    // Launched from the bottom edge anywhere across the viewport (the Python
    // version used a fixed 100-700 px range) and aimed to burst in the sky.
    const rise = rand(0.45, 0.88) * H;
    const gravity = FIREWORK_GRAVITY * clamp(H / 900, 0.6, 1.6);
    // Python: 30-50 particles. Scaled with the viewport so a large screen
    // does not get a thin scatter and a phone is not asked to draw too many.
    const density = clamp(Math.sqrt(W * H) / 750, 0.8, 2.2);
    const count = randInt(30, 50) * density * (this.reducedMotion ? 0.5 : 1);
    // Mostly random bright colours, with the tricolour mixed in.
    const palette = [
      { hue: 28, light: 60 }, // saffron
      { hue: 0, light: 96 }, // white
      { hue: 115, light: 55 }, // green
    ];
    const color = Math.random() < 0.35
      ? palette[randInt(0, 2)]
      : { hue: randInt(0, 359), light: randInt(58, 70) };
    this.fireworks.push({
      x: rand(0.06, 0.94) * W,
      y: H,
      vy: -Math.sqrt(2 * gravity * rise),
      gravity,
      color,
      count: Math.round(count),
      spread: Math.min(W, H) * rand(0.16, 0.26), // radius of the burst
    });
  }

  burst(fw) {
    const size = this.sparkSize();
    // With drag, a spark launched at v travels about v / drag in total.
    const speed = fw.spread * PARTICLE_DRAG;
    for (let n = 0; n < fw.count; n++) {
      const angle = rand(0, Math.PI * 2);
      const v = speed * (0.3 + 0.7 * Math.sqrt(Math.random()));
      const life = PARTICLE_LIFE * rand(0.7, 1);
      this.particles.push({
        x: fw.x,
        y: fw.y,
        tx: fw.x,
        ty: fw.y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        radius: rand(1.3, 2.6) * size,
        life,
        maxLife: life,
        hue: fw.color.hue,
        light: fw.color.light,
      });
    }
  }

  // --- Rendering -------------------------------------------------------------------

  render() {
    const ctx = this.ctx;
    const L = this.layout();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);

    this.drawPole(L);
    this.drawRope(L);
    this.drawFlag(L);
    this.drawFireworks();
  }

  drawPole(L) {
    const ctx = this.ctx;
    const x = L.poleX - L.poleWidth / 2;
    const h = L.H - L.poleY;
    ctx.fillStyle = COLORS.poleShadow;
    ctx.fillRect(x + 3, L.poleY + 3, L.poleWidth, h);
    ctx.fillStyle = COLORS.pole;
    ctx.fillRect(x, L.poleY, L.poleWidth, h);
    // Soft highlight so the pole reads against the red sandstone.
    ctx.fillStyle = 'rgba(255, 220, 170, 0.35)';
    ctx.fillRect(x + L.poleWidth * 0.18, L.poleY, L.poleWidth * 0.22, h);
    // Finial
    ctx.beginPath();
    ctx.arc(L.poleX, L.poleY - L.poleWidth * 0.2, L.poleWidth * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(212, 175, 55)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.poleShadow;
    ctx.stroke();
  }

  drawRope(L) {
    const ctx = this.ctx;
    const top = L.poleY + L.poleWidth;
    const x = L.ropeX;
    const width = clamp(L.poleWidth * 0.4, 3, 5);

    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.9)';
    ctx.lineWidth = width + 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, L.H);
    ctx.stroke();

    ctx.strokeStyle = 'rgb(240, 228, 196)';
    ctx.lineWidth = width;
    ctx.stroke();

    // Twist marks that travel downward as the rope is hauled.
    ctx.strokeStyle = 'rgba(120, 90, 50, 0.9)';
    ctx.setLineDash([3, 11]);
    ctx.lineDashOffset = -(this.ropeTravel + this.grab);
    ctx.stroke();
    ctx.setLineDash([]);

    // Short tie from the pulley to the rope.
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.poleX, top);
    ctx.lineTo(x, top);
    ctx.stroke();

    // Handle to grab, only while the rope can be pulled.
    if (this.state === 'hoisting') {
      const y = L.H * 0.52 + this.grab;
      const r = clamp(L.W * 0.012, 9, 14);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.grabbing ? 'rgb(255, 196, 120)' : 'rgb(250, 240, 215)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgb(90, 55, 20)';
      ctx.stroke();
      // Downward chevron
      ctx.beginPath();
      ctx.moveTo(x - r * 0.45, y - r * 0.2);
      ctx.lineTo(x, y + r * 0.35);
      ctx.lineTo(x + r * 0.45, y - r * 0.2);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  /** Flat flag (stripes + chakra) rendered once per size, then warped. */
  ensureFlagTexture(L) {
    const w = Math.max(2, Math.round(L.flagWidth * this.dpr));
    const h = Math.max(2, Math.round(L.flagHeight * this.dpr));
    const key = `${w}x${h}`;
    if (key === this.flagTextureKey) return;
    this.flagTextureKey = key;
    const tex = this.flagTexture;
    tex.width = w;
    tex.height = h;
    const c = tex.getContext('2d');
    const stripe = h / 3;
    c.fillStyle = COLORS.saffron;
    c.fillRect(0, 0, w, stripe + 1);
    c.fillStyle = COLORS.white;
    c.fillRect(0, stripe, w, stripe + 1);
    c.fillStyle = COLORS.green;
    c.fillRect(0, stripe * 2, w, h - stripe * 2);
    drawChakra(c, w / 2, h / 2, (stripe / 2) * 0.92);
  }

  drawFlag(L) {
    const ctx = this.ctx;
    const { flagX: x, flagWidth, flagHeight } = L;
    // Python: flag_start_y = y + pole_height - progress * 0.9
    const y = L.poleY + L.maxHeight - this.shown * L.maxHeight * 0.9;
    const stripe = flagHeight / 3;

    if (this.unfurl <= 0) {
      // Folded while it is being hoisted: a narrow tricolour, no chakra.
      const w = flagWidth * FOLDED_WIDTH;
      ctx.fillStyle = COLORS.saffron;
      ctx.fillRect(x, y, w, stripe);
      ctx.fillStyle = COLORS.white;
      ctx.fillRect(x, y + stripe, w, stripe);
      ctx.fillStyle = COLORS.green;
      ctx.fillRect(x, y + stripe * 2, w, stripe);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, flagHeight - 1);
      return;
    }

    this.ensureFlagTexture(L);
    const tex = this.flagTexture;
    const open = 1 - Math.pow(1 - this.unfurl, 3); // ease-out
    const width = flagWidth * (FOLDED_WIDTH + (1 - FOLDED_WIDTH) * open);

    // Wind: a wave travelling from the hoist to the fly, growing with distance
    // from the pole. Python used wind_time = time * 3.
    const calm = this.reducedMotion;
    const amplitude = flagHeight * (calm ? 0.025 : 0.085) * open;
    const speed = calm ? 1.2 : 3;
    const phase = this.time * speed;
    const waves = 1.35;

    const step = 1; // CSS px per slice
    for (let sx = 0; sx < width; sx += step) {
      const f = sx / width;
      const angle = f * waves * Math.PI * 2 - phase;
      const dy = amplitude * f * Math.sin(angle);
      const sw = Math.min(step, width - sx);
      ctx.drawImage(
        tex,
        (sx / width) * tex.width, 0, (sw / width) * tex.width, tex.height,
        x + sx, y + dy, sw + 0.6, flagHeight,
      );
      // Light and shade along the folds.
      const shade = Math.cos(angle) * f * (calm ? 0.06 : 0.16) * open;
      if (Math.abs(shade) > 0.004) {
        ctx.fillStyle = shade > 0 ? `rgba(0, 0, 0, ${shade})` : `rgba(255, 255, 255, ${-shade})`;
        ctx.fillRect(x + sx, y + dy, sw + 0.6, flagHeight);
      }
    }
  }

  drawFireworks() {
    if (!this.fireworks.length && !this.particles.length) return;
    const ctx = this.ctx;
    const size = this.sparkSize();
    const trails = !this.reducedMotion;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // overlapping sparks glow
    ctx.lineCap = 'round';

    // Rising rockets with a short tail.
    for (const fw of this.fireworks) {
      const tail = Math.min(46 * size, -fw.vy * 0.07);
      ctx.strokeStyle = `hsla(${fw.color.hue}, 100%, 85%, 0.55)`;
      ctx.lineWidth = 2 * size;
      ctx.beginPath();
      ctx.moveTo(fw.x, fw.y + tail);
      ctx.lineTo(fw.x, fw.y);
      ctx.stroke();
      ctx.fillStyle = `hsl(${fw.color.hue}, 100%, 92%)`;
      ctx.beginPath();
      ctx.arc(fw.x, fw.y, 2.4 * size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of this.particles) {
      const age = p.life / p.maxLife; // 1 = fresh, 0 = gone
      const alpha = Math.min(1, age * 2.2); // fade over the second half
      const radius = p.radius * (0.45 + 0.55 * Math.min(1, age * 2));
      const sat = p.light > 90 ? 20 : 100;
      if (trails) {
        ctx.strokeStyle = `hsla(${p.hue}, ${sat}%, ${p.light}%, ${alpha * 0.45})`;
        ctx.lineWidth = radius * 1.5;
        ctx.beginPath();
        ctx.moveTo(p.tx, p.ty);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      // Soft halo, then a bright core.
      ctx.fillStyle = `hsla(${p.hue}, ${sat}%, ${p.light}%, ${alpha * 0.22})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${p.hue}, ${sat}%, ${Math.min(97, p.light + 22)}%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Ashoka Chakra: navy wheel with 24 spokes. */
function drawChakra(c, cx, cy, radius) {
  c.save();
  c.translate(cx, cy);
  c.strokeStyle = COLORS.navy;
  c.fillStyle = COLORS.navy;

  const rim = Math.max(1, radius * 0.12);
  c.lineWidth = rim;
  c.beginPath();
  c.arc(0, 0, radius - rim / 2, 0, Math.PI * 2);
  c.stroke();

  const hub = radius * 0.17;
  c.lineWidth = Math.max(0.75, radius * 0.045);
  c.lineCap = 'butt';
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI * 2) / 24;
    c.beginPath();
    c.moveTo(Math.cos(a) * hub, Math.sin(a) * hub);
    c.lineTo(Math.cos(a) * (radius - rim), Math.sin(a) * (radius - rim));
    c.stroke();
  }

  // Small studs on the rim between the spokes.
  for (let i = 0; i < 24; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / 24;
    c.beginPath();
    c.arc(Math.cos(a) * (radius - rim), Math.sin(a) * (radius - rim), radius * 0.035, 0, Math.PI * 2);
    c.fill();
  }

  c.beginPath();
  c.arc(0, 0, hub, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
