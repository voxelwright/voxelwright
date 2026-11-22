// The 404 page's fog on a 2D canvas: the CSS veil and banks of lost.css, drifting.
// The bank moves east, away from Ina Coolbrith Park and slightly left in the view, as the
// marine layer does in the city (landing/fog.js). The pointer clears a little where it moves
// and a tap parts it; the gap closes again in a couple of seconds.
//
// Cheap on purpose: one canvas at about a third of the page's size (fog is soft, so the
// browser's upscale is the blur), some sixty soft sprites a frame, thirty frames a second.

/** Fog bands, top to bottom: where they sit (fractions of the height), how big, how dense, how fast. */
export const BANDS = [
  { name: "wisps", count: 10, top: 0.2, bottom: 0.38, size: [0.1, 0.16], alpha: [0.2, 0.34], speed: 0.0035 },
  { name: "far", count: 16, top: 0.46, bottom: 0.66, size: [0.09, 0.15], alpha: [0.42, 0.62], speed: 0.005 },
  { name: "mid", count: 16, top: 0.6, bottom: 0.84, size: [0.12, 0.2], alpha: [0.5, 0.7], speed: 0.008 },
  { name: "near", count: 16, top: 0.76, bottom: 1.02, size: [0.15, 0.26], alpha: [0.6, 0.85], speed: 0.012 },
];
/** Sideways room beyond each edge, as a fraction of the width, so puffs enter and leave whole. */
export const MARGIN = 0.35;

/** A small seeded random source (mulberry32), so the fog has the same shape on every visit. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every puff: x across the travel span, y and radius as fractions of the height. */
export function field(seed = 404) {
  const rnd = random(seed);
  const span = 1 + MARGIN * 2;
  const lerp = ([a, b], t) => a + (b - a) * t;
  return BANDS.flatMap((band) =>
    Array.from({ length: band.count }, (_, i) => ({
      band: band.name,
      // spread evenly with a little jitter, so no stretch of sky is left bare
      x: ((i + rnd() * 0.8) / band.count) * span,
      y: band.top + (band.bottom - band.top) * rnd(),
      r: lerp(band.size, rnd()),
      alpha: lerp(band.alpha, rnd()),
      speed: band.speed * (0.8 + rnd() * 0.4),
      phase: rnd() * Math.PI * 2,
    })),
  );
}

/** A puff's centre at time t (seconds), x as a fraction of the width, from -MARGIN to 1 + MARGIN. */
export function place(puff, t) {
  const span = 1 + MARGIN * 2;
  const x = (((puff.x - puff.speed * t) % span) + span) % span - MARGIN;
  const y = puff.y + Math.sin(t * 0.05 + puff.phase) * 0.008;
  return [x, y];
}

const SCALE = 0.33;
const MAX_WIDTH = 720;
const FRAME = 1000 / 30;
const BRUSH = 90; // CSS px, the pointer's clearing
const BURST = [50, 240, 900]; // a tap: from, to (CSS px), over ms

/** Start the fog on a canvas inside .lost. Returns stop(). */
export function startFog(canvas, host) {
  const ctx = canvas.getContext("2d");
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d");
  if (!ctx || !mctx) return null;
  const puffs = field();
  const sprite = soft(128);
  let w = 0,
    h = 0,
    k = 1,
    colours = read(host),
    frame = 0,
    last = 0,
    shown = false,
    pointer = null;
  const bursts = [];
  const t0 = performance.now();

  function size() {
    const cw = innerWidth,
      ch = innerHeight;
    k = Math.min(SCALE, MAX_WIDTH / cw);
    const nw = Math.max(1, Math.round(cw * k)),
      nh = Math.max(1, Math.round(ch * k));
    if (nw === w && nh === h) return;
    w = canvas.width = mask.width = nw;
    h = canvas.height = mask.height = nh;
  }

  function stamp(x, y, radius, alpha) {
    const r = radius * k;
    mctx.globalCompositeOperation = "source-over";
    mctx.globalAlpha = alpha;
    mctx.drawImage(sprite, x * k - r, y * k - r, r * 2, r * 2);
    mctx.globalAlpha = 1;
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    // the clearing closes again
    mctx.globalCompositeOperation = "destination-out";
    mctx.fillStyle = "rgb(0 0 0 / 0.045)";
    mctx.fillRect(0, 0, w, h);
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const p = Math.min(1, (now - b.at) / BURST[2]);
      const eased = 1 - Math.pow(1 - p, 3);
      stamp(b.x, b.y, BURST[0] + (BURST[1] - BURST[0]) * eased, 0.22);
      if (p >= 1) bursts.splice(i, 1);
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    // density first, as alpha: the veil, then the puffs
    const veil = ctx.createLinearGradient(0, 0, 0, h);
    veil.addColorStop(0, "rgb(255 255 255 / 0.5)");
    veil.addColorStop(0.3, "rgb(255 255 255 / 0.24)");
    veil.addColorStop(0.45, "rgb(255 255 255 / 0.4)");
    veil.addColorStop(0.6, "rgb(255 255 255 / 0.74)");
    veil.addColorStop(0.76, "rgb(255 255 255 / 0.88)");
    veil.addColorStop(1, "rgb(255 255 255 / 1)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
    for (const puff of puffs) {
      const [x, y] = place(puff, t);
      const ry = puff.r * h,
        rx = ry * 2.6;
      ctx.globalAlpha = puff.alpha;
      ctx.drawImage(sprite, x * w - rx, y * h - ry, rx * 2, ry * 2);
    }
    ctx.globalAlpha = 1;
    // then colour: the crest catches the sky, the bottom takes the city's light
    ctx.globalCompositeOperation = "source-in";
    const tone = ctx.createLinearGradient(0, 0, 0, h);
    tone.addColorStop(0, colours.crest);
    tone.addColorStop(0.45, colours.fog);
    tone.addColorStop(0.72, colours.fog);
    tone.addColorStop(1, colours.deep);
    ctx.fillStyle = tone;
    ctx.fillRect(0, 0, w, h);
    // and the pointer's clearing
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (now - last < FRAME - 2) return;
    last = now;
    draw(now);
    if (!shown) {
      shown = true;
      canvas.hidden = false;
      host.dataset.fog = "live";
    }
  }

  // The pointer, in CSS px. Mouse and pen clear as they move; any press on the scene parts it.
  const scene = (event) => !event.target.closest?.("a, button, input, select, summary, .lost-sign, .site-bar, .site-foot");
  function move(event) {
    if (event.pointerType === "touch") return;
    const x = event.clientX,
      y = event.clientY;
    if (pointer) {
      // fill the gap between events so a fast sweep leaves a trail, not dots
      const steps = Math.min(12, Math.ceil(Math.hypot(x - pointer[0], y - pointer[1]) / 24));
      for (let i = 1; i <= steps; i++) stamp(pointer[0] + ((x - pointer[0]) * i) / steps, pointer[1] + ((y - pointer[1]) * i) / steps, BRUSH, 0.16);
    } else stamp(x, y, BRUSH, 0.16);
    pointer = [x, y];
  }
  function leave() {
    pointer = null;
  }
  function press(event) {
    if (!scene(event)) return;
    bursts.push({ x: event.clientX, y: event.clientY, at: performance.now() });
  }
  function recolour() {
    colours = read(host);
  }

  size();
  addEventListener("resize", size);
  addEventListener("pointermove", move, { passive: true });
  document.documentElement.addEventListener("pointerleave", leave);
  addEventListener("pointerdown", press, { passive: true });
  document.addEventListener("vx-night", recolour);
  const dark = matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", recolour);
  frame = requestAnimationFrame(tick);

  return function stop() {
    cancelAnimationFrame(frame);
    removeEventListener("resize", size);
    removeEventListener("pointermove", move);
    document.documentElement.removeEventListener("pointerleave", leave);
    removeEventListener("pointerdown", press);
    document.removeEventListener("vx-night", recolour);
    dark.removeEventListener("change", recolour);
    canvas.hidden = true;
    delete host.dataset.fog;
  };
}

/** The fog's colours for the time of day, from lost.css's custom properties. */
function read(host) {
  const style = getComputedStyle(host);
  const get = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return { crest: get("--fog-crest", "#f6f6f3"), fog: get("--fog", "#dbe0e5"), deep: get("--fog-deep", "#c9d0d7") };
}

/** One soft white puff, opaque in the middle and gone at the edge. */
function soft(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgb(255 255 255 / 1)");
  grad.addColorStop(0.45, "rgb(255 255 255 / 0.62)");
  grad.addColorStop(1, "rgb(255 255 255 / 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
