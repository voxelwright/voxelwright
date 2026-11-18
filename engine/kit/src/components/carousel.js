// Carousel. Slides in a window: a recess that holds one slide at a time. Previous and next are
// keys under it, and between them a row of lamps in a slot says which slide it is on.
// Tool: the kit's recess (.vx-recess) for the window and the kit's key (.vx-button) for previous,
// next and pause. What this part draws is the lamps: a slot with one lamp a slide, two voxels of
// light each way, a voxel apart; the current slide's is lit, the others are dark studs.
// Markup: <section class="vx-carousel" aria-roledescription="carousel" aria-label="This week in fogline">
//           <div class="vx-recess vx-carousel-window">
//             <div class="vx-carousel-track" tabindex="0">
//               <div class="vx-carousel-slide" role="group" aria-roledescription="slide" aria-label="1 of 3">…</div>
//               …
//             </div>
//           </div>
//           <div class="vx-carousel-bar">
//             <button class="vx-button" type="button" data-vx-step="prev" aria-label="Previous slide"><span class="vx-carousel-chevron" aria-hidden="true"></span></button>
//             <span class="vx-carousel-lamps" aria-hidden="true" style="--vx-carousel-n: 3"></span>
//             <button class="vx-button" type="button" data-vx-step="next" aria-label="Next slide"><span class="vx-carousel-chevron" aria-hidden="true"></span></button>
//           </div>
//         </section>
// The track is a real scrolling element that snaps a slide at a time: a finger swipes it, and
// with no script it scrolls under the browser's own bar (the keys and lamps are then not shown).
// A slide with no name is named "2 of 5" (data-vx-of="з" on the carousel changes the word).
// Keys: with the focus on the track or in the bar, the arrows go a slide back or on (mirrored
// where the line runs right to left), Home to the first, End to the last. At an end the key that
// leads nowhere is switched off (aria-disabled).
//
// It never moves by itself unless asked: data-vx-auto="5000" on the carousel (milliseconds a
// slide) and a pause key in the bar, <button class="vx-button" type="button" data-vx-play>Pause</button>
// (data-vx-pause="…" and data-vx-play="…" on it change its two words). Then it goes on a slide at
// a time and round again; it waits while the pointer is over it or the page is hidden; and it
// stops, its key saying Play, when the focus comes into it, when previous or next is pressed, an
// arrow key is used or it is swiped. Where less motion is asked for it does not start. After a
// press on Play it runs until it is paused or moved by hand.

import { hole, halo, byTheme, lightName } from '../core/light.js';
import { reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const EVERY = 5000; // ms a slide, where data-vx-auto gives no number
const LEAST = 1000; // and never faster than this
const LAMP = 2, PITCH = 3; // a lamp is two voxels of light; the next one starts three on
const EDGE = 1;            // voxels of the slot's floor round the row of lamps
const GLOW = 0.1;

/**
 * The carousel's behaviour, with voxels or without. Keeps `st` true to the track (count, index,
 * playing), writes --vx-carousel-n and --_at on the lamps for the CSS, and calls
 * changed(what) after each change: 'count' when the slides themselves changed, 'words' when the
 * pause key's words did.
 */
function wire(lamps, on, changed = () => {}) {
  const root = lamps.closest('.vx-carousel'), track = root?.querySelector('.vx-carousel-track');
  const st = { count: 0, index: 0, playing: false };
  if (!track) return st;
  const mine = (node) => node && node.closest('.vx-carousel') === root;
  const slides = () => [...track.children].filter((c) => c.classList.contains('vx-carousel-slide'));
  const keyOf = (way) => [...root.querySelectorAll(`[data-vx-step="${way}"]`)].find(mine);
  const play = [...root.querySelectorAll('[data-vx-play]')].find(mine) ?? null;
  const loops = root.hasAttribute('data-vx-auto') && !!play; // it may only run where it can be paused
  const rtl = () => getComputedStyle(track).direction === 'rtl';
  const named = new WeakSet(); // the slides this part named, and so names again when their number changes

  // which slide is in the window: the one whose middle is nearest the window's middle
  const nearest = () => {
    const b = track.getBoundingClientRect(), c = b.left + b.width / 2;
    let best = 0, least = Infinity;
    slides().forEach((s, i) => { const r = s.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - c); if (d < least) { least = d; best = i; } });
    return best;
  };

  const off = (key, yes) => { if (key && yes !== (key.getAttribute('aria-disabled') === 'true')) { if (yes) key.setAttribute('aria-disabled', 'true'); else key.removeAttribute('aria-disabled'); } };

  // slide i is the current one: the lamps, the keys and what a screen reader may read follow
  const show = (i) => {
    const all = slides(), n = all.length, was = st.count;
    st.count = n;
    st.index = Math.max(0, Math.min(n - 1, i));
    const word = root.dataset.vxOf || 'of';
    all.forEach((s, j) => {
      if (!s.hasAttribute('role')) s.setAttribute('role', 'group');
      if (!s.hasAttribute('aria-roledescription')) s.setAttribute('aria-roledescription', 'slide');
      if (named.has(s) || !(s.hasAttribute('aria-label') || s.hasAttribute('aria-labelledby'))) { s.setAttribute('aria-label', `${j + 1} ${word} ${n}`); named.add(s); }
      // a slide that is out of the window is out of reach too, unless the focus is still in it
      s.inert = j !== st.index && !s.contains(document.activeElement);
    });
    off(keyOf('prev'), n < 2 || (!loops && st.index === 0));
    off(keyOf('next'), n < 2 || (!loops && st.index === n - 1));
    lamps.style.setProperty('--vx-carousel-n', String(Math.max(1, n)));
    lamps.style.setProperty('--_at', String(st.index));
    changed(n !== was ? 'count' : '');
  };

  // go to slide i: at once where less motion is asked for, or when told to
  let going = -1; // the slide it is on its way to: what is passed on the way is not the current one
  const go = (i, at = 'smooth') => {
    const all = slides();
    if (!all.length) return;
    i = Math.max(0, Math.min(all.length - 1, i));
    const a = all[i].getBoundingClientRect(), b = track.getBoundingClientRect();
    const dx = rtl() ? a.right - (b.right - track.clientLeft) : a.left - (b.left + track.clientLeft);
    going = Math.abs(dx) < 1 ? -1 : i;
    show(i);
    if (going >= 0) track.scrollTo({ left: track.scrollLeft + dx, behavior: at === 'instant' || reducedMotion() ? 'instant' : 'smooth' });
  };
  const step = (dir) => {
    const n = slides().length;
    if (n < 2) return;
    const to = loops ? (st.index + dir + n) % n : Math.max(0, Math.min(n - 1, st.index + dir));
    if (to === st.index) return;
    go(to);
    cue('slide');
  };

  // the track moved (a finger, the wheel, its own bar, or on its way where it was sent)
  let frame = 0;
  const seen = () => {
    frame = 0;
    const i = nearest();
    if (going >= 0) { if (i !== going) return; going = -1; }
    if (i !== st.index) show(i);
  };
  on(track, 'scroll', () => { if (!frame) frame = requestAnimationFrame(seen); }, { passive: true });
  on(track, 'scrollend', () => { going = -1; if (!frame) frame = requestAnimationFrame(seen); });

  // ---- going on by itself, where that was asked for
  let timer = 0, hovered = false, asked = false, pressing = false;
  const arm = () => {
    clearTimeout(timer); timer = 0;
    if (st.playing && (asked || !hovered) && !document.hidden) timer = setTimeout(() => { timer = 0; const n = slides().length; if (n > 1) go((st.index + 1) % n); arm(); }, Math.max(LEAST, Number(root.dataset.vxAuto) || EVERY));
  };
  const say = (word) => {
    const face = play.querySelector(':scope > .vx-label') ?? play;
    if (face.textContent.trim() === word) return;
    const text = [...face.childNodes].find((n) => n.nodeType === 3 && n.data.trim());
    if (text) text.data = word; else face.append(word);
    changed('words');
  };
  const run = (yes, byHand = false) => {
    if (!loops) return;
    st.playing = yes;
    asked = yes && byHand;
    track.setAttribute('aria-live', yes ? 'off' : 'polite'); // while it runs, a screen reader is not told of every slide
    say(yes ? play.dataset.vxPause || 'Pause' : play.dataset.vxPlay || 'Play');
    arm();
  };
  const byHand = () => { going = -1; if (st.playing) run(false); };

  // ---- the hand
  on(root, 'click', (e) => {
    const key = e.target.closest?.('[data-vx-step], [data-vx-play]');
    if (!mine(key)) return;
    if (key === play) { run(!st.playing, true); return; }
    if (key.getAttribute('aria-disabled') === 'true') return;
    if (st.playing) run(false);
    step(key.dataset.vxStep === 'prev' ? -1 : 1);
  });
  on(root, 'keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !(e.target === track || (mine(e.target) && e.target.closest('.vx-carousel-bar')))) return;
    const n = slides().length, onward = rtl() ? 'ArrowLeft' : 'ArrowRight', back = rtl() ? 'ArrowRight' : 'ArrowLeft';
    if (![onward, back, 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); // the track would otherwise creep a few pixels and snap back
    if (st.playing) run(false);
    if (e.key === 'Home') go(0); else if (e.key === 'End') go(n - 1); else step(e.key === onward ? 1 : -1);
  });
  // a finger or the wheel on the track: it is the hand's now
  on(track, 'pointerdown', byHand);
  on(track, 'touchstart', byHand, { passive: true });
  on(track, 'wheel', byHand, { passive: true });
  if (loops) {
    // the focus coming in stops it; a press on the pause key says what it wants itself
    on(play, 'pointerdown', () => { pressing = true; });
    on(document, 'pointerup', () => { setTimeout(() => { pressing = false; }, 0); });
    on(root, 'focusin', () => { if (st.playing && !asked && !pressing) run(false); });
    on(root, 'pointerenter', (e) => { if (e.pointerType === 'mouse') { hovered = true; arm(); } });
    on(root, 'pointerleave', () => { hovered = false; arm(); });
    on(document, 'visibilitychange', arm);
    if (typeof matchMedia === 'function') on(matchMedia('(prefers-reduced-motion: reduce)'), 'change', (e) => { if (e.matches && st.playing && !asked) run(false); });
  }

  // slides added or taken away; the window made wider or narrower (the current slide stays put)
  on.watch(track, { childList: true }, () => show(Math.min(st.index, slides().length - 1)));
  const sizes = new ResizeObserver(() => { if (going < 0 && slides().length) go(st.index, 'instant'); });
  sizes.observe(track);

  // from here the keys and lamps stand in for the browser's bar; give it back when the listeners go
  root.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() {
    clearTimeout(timer); cancelAnimationFrame(frame); sizes.disconnect();
    root.removeAttribute('data-vx-on');
    for (const s of slides()) s.inert = false;
  } }, 'end', show);

  show(nearest());
  if (loops) run(!reducedMotion()); else if (!track.hasAttribute('aria-live')) track.setAttribute('aria-live', 'polite');
  return st;
}

export const carousel = {
  name: 'carousel',
  selector: '.vx-carousel-lamps',
  pad: 6,
  glowRadius: 2.8,
  glowStrength: halo(GLOW),

  build(live, m) {
    const { W, H, el } = live, D = live.look.well, s = live.state;
    const n = s.n = Math.max(1, Math.min(s.c?.count || 1, Math.floor((W - EDGE * 2 + 1) / PITCH)));
    const flip = getComputedStyle(el).direction === 'rtl';
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    // A row of lamps in a slot. One that is not lit is a dark stud on the floor of the slot; a
    // lit one is light to the level of the surface, so its light lies on the surface round it.
    const studs = m.part('studs'), fill = m.part('fill');
    for (const p of [studs, fill]) { p.sunk = true; p.grounded = false; p.masked = true; }
    const mat = lightName(el, 'light');
    const h = Math.max(1, H - EDGE * 2);
    for (let i = 0; i < n; i++) {
      const x = flip ? W - EDGE - LAMP - i * PITCH : EDGE + i * PITCH;
      studs.box(x, EDGE, -D, LAMP, h, 1, 'steel');
      fill.box(x, EDGE, -D, LAMP, h, D, mat);
    }
    s.lampOf = (x) => Math.max(0, Math.min(n - 1, Math.floor(((flip ? W - 1 - Math.floor(x) : Math.floor(x)) - EDGE) / PITCH)));
    s.of = null; // which lamp each drawn cube belongs to: found once the model is baked
    // as it is now, with no growing in
    s.level = new Float32Array(n);
    s.level[Math.min(n - 1, s.c?.index ?? 0)] = 1;
  },

  pose(live) {
    const { studs, fill } = live.model.byName, s = live.state;
    s.of ??= [studs, fill].map((p) => Array.from({ length: p.count }, (_, i) => s.lampOf(p.rest[i * 3])));
    for (let i = 0; i < studs.count; i++) studs.scales[i] = s.level[s.of[0][i]] >= 1 ? 0 : 1; // a lit lamp is all light
    for (let i = 0; i < fill.count; i++) { const p = s.level[s.of[1][i]]; fill.scales[i] = p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p); }
    live.glowStrength = halo(GLOW) * byTheme(live);
  },

  // the light goes out of one lamp and comes on in the next: about 140 ms, or at once
  step(live, dt) {
    const s = live.state, at = Math.min(s.n - 1, s.c?.index ?? 0), now = reducedMotion();
    let busy = false;
    for (let i = 0; i < s.n; i++) {
      const want = i === at ? 1 : 0, p = s.level[i];
      if (p === want) continue;
      s.level[i] = now ? want : want > p ? Math.min(1, p + dt / 0.14) : Math.max(0, p - dt / 0.1);
      if (s.level[i] !== want) busy = true;
    }
    return busy;
  },

  bind(live) {
    const on = listeners();
    live.state.c = wire(live.el, on, (what) => {
      if (!live.model) return; // the first call comes before the first model
      if (what === 'words') live.stage.resnapSoon(); // other words on the key: they start on a whole pixel again
      if (live.state.c && live.state.c.count !== live.state.n && what === 'count') live.rebuild(); else live.invalidate();
    });
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-light'] }, () => live.rebuild());
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
