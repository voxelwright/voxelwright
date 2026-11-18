// Depth and light: one system on the real parts, shown as two screens with a pointer of the same
// voxels doing one thing in each. The look is in lit-look.js; this file is the page: the time of
// day, the theme, and the two short stories (written the way Benji Taylor's Stageshow skill
// teaches: a finished screen, one gesture, a result that stays, a reset with a cause).
import { adopt, ready, live, refresh, getStage, defineMaterial, LOOKS, PRESS, RELEASE } from '/packages/voxelmorphism/src/index.js';
import './lit-look.js';

const root = document.documentElement;
const q = new URLSearchParams(location.search);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------------------------
// Themes. A theme is the accent: the light under what acts, and the cap of the one main key.
// The system does not change with it.
const ACCENTS = {
  '': { light: { day: '#2f5bff', night: '#4d7dff' }, cap: { day: '#2f5bff', night: '#3560f2' } },
  ember: { light: { day: '#ff5a1f', night: '#ff7a3d' }, cap: { day: '#c7400e', night: '#cc4410' } },
  moss: { light: { day: '#17a35a', night: '#45d184' }, cap: { day: '#1f7a4a', night: '#23874f' } },
};
function setAccent(name) {
  const a = ACCENTS[name] ?? ACCENTS[''];
  if (name) root.dataset.accent = name; else delete root.dataset.accent;
  const look = LOOKS.lit;
  look.materials.enamel = a.cap;
  look.materials.signal = { ...a.light, glow: 1 };
  defineMaterial('light', { ...a.light, glow: 1, jitter: 0 }); // and every look's table is made again
  const stage = getStage();
  if (stage) for (const l of stage.lives.values()) { l.model.tint(l.theme, l.look); l.invalidate(); }
}

function tabs(el, value, set) {
  const all = $$('[role="tab"]', el);
  for (const t of all) t.setAttribute('aria-selected', String(t.dataset.value === value));
  el.addEventListener('vx-change', (e) => set(all[e.detail.index].dataset.value));
  el.addEventListener('click', (e) => { if (live(el)) return; const t = e.target.closest('[role="tab"]'); if (t) set(t.dataset.value); });
}
tabs($('#time'), root.dataset.theme, (v) => { root.dataset.theme = v; });
tabs($('#accent'), root.dataset.accent || '', setAccent);
if (root.dataset.accent) setAccent(root.dataset.accent);

// ---------------------------------------------------------------------------------------------
// The pointer, and a hand to move it.
class Stop extends Error {}

// the travel curve: a departure, clear travel, a soft arrival
const travel = bezier(0.45, 0, 0.1, 1);
function bezier(x1, y1, x2, y2) {
  const f = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x) => { let lo = 0, hi = 1; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (f(m, x1, x2) < x) lo = m; else hi = m; } return f((lo + hi) / 2, y1, y2); };
}

function hand(stage) {
  const el = $('.vx-cursor', stage);
  let x = 0, y = 0, run = 0, over = null;
  const snap = (v) => Math.round(v * devicePixelRatio) / devicePixelRatio;
  const place = (nx, ny) => { x = nx; y = ny; el.style.translate = `${snap(nx)}px ${snap(ny)}px`; };
  const at = (target, fx, fy) => { const s = stage.getBoundingClientRect(), r = target.getBoundingClientRect(); return [r.left - s.left + r.width * fx, r.top - s.top + r.height * fy]; };
  const fire = (target, type) => target.dispatchEvent(new PointerEvent(type, { bubbles: !/enter|leave/.test(type), pointerType: 'mouse', isPrimary: true }));
  const dip = (down) => { const l = live(el); if (!l) return; l.spring('press').to(down ? -3.5 : 0, down ? PRESS.k : RELEASE.k, down ? PRESS.c : RELEASE.c); l.invalidate(); };
  const h = {
    el, stage,
    get run() { return run; },
    stop() { run++; if (over) { fire(over, 'pointerup'); fire(over, 'pointerleave'); over = null; } dip(false); },
    show(on = true) { el.toggleAttribute('data-on', on); },
    place, dip,
    put(target, fx = 0.5, fy = 0.5) { place(...at(target, fx, fy)); },
    wait(ms) { const id = run; return new Promise((res, rej) => setTimeout(() => (id === run ? res() : rej(new Stop())), ms)); },
    /** Go to a point on something: by default low and to the right of its middle, clear of its words. */
    move(target, fx = 0.86, fy = 0.8, pace = 1) {
      const id = run;
      if (over && over !== target) { fire(over, 'pointerleave'); over = null; }
      return new Promise((res, rej) => {
        const [tx, ty] = at(target, fx, fy), sx = x, sy = y;
        const ms = Math.min(1150, 340 + Math.hypot(tx - sx, ty - sy) * 1.15) * pace;
        const t0 = performance.now();
        const tick = (now) => {
          if (id !== run) return rej(new Stop());
          const t = Math.min(1, (now - t0) / ms), e = travel(t);
          place(sx + (tx - sx) * e, sy + (ty - sy) * e);
          if (t < 1) requestAnimationFrame(tick); else res();
        };
        requestAnimationFrame(tick);
      });
    },
    /** Aim, come down, let go. The part hears real pointer events, so it answers as it would to a person. */
    async press(target) {
      over = target;
      fire(target, 'pointerenter');
      await h.wait(170);
      dip(true);
      await h.wait(60);
      fire(target, 'pointerdown');
      await h.wait(150);
      fire(target, 'pointerup');
      dip(false);
      await h.wait(90);
    },
  };
  return h;
}

// ---------------------------------------------------------------------------------------------
// Story 1. A deploy: press the key, the old build's light drains, the new one fills, a notice.
function deploy() {
  const stage = $('#deploy'), h = hand(stage);
  const go = $('#go'), meter = $('.vx-meter', stage), prog = $('progress', stage), num = $('.build-num', stage);
  const lamp = $('.vx-lamp', stage), word = $('.state-word', stage), note = $('.vx-toast', stage), log = $('.log', stage);
  const BUILDS = [
    ['10:42:17', 'Cloned main at 4f2c9a1', '10:42:31', 'Installed 212 packages', '10:43:02', 'Built in 45 s'],
    ['10:51:40', 'Cloned main at 9be01d3', '10:51:52', 'Installed 212 packages', '10:52:21', 'Built in 41 s'],
  ];
  let n = 0;
  const lines = () => $$('.line', log);
  const write = (b) => lines().forEach((l, i) => { l.innerHTML = `<span class="at">${b[i * 2]}</span>${b[i * 2 + 1]}`; });
  const state = (text, light) => {
    if (lamp.dataset.vxLight !== light) lamp.dataset.vxLight = light;
    if (word.textContent === text) return;
    word.style.opacity = 0;
    setTimeout(() => { word.textContent = text; word.style.opacity = ''; }, 150);
  };
  const bar = (v) => { prog.setAttribute('value', String(v)); prog.textContent = Math.round(v * 100) + '%'; };
  // the number follows the light in the trench, not the other way round
  let following = 0;
  const follow = () => {
    const v = live(meter)?.spring('v').x ?? Number(prog.getAttribute('value'));
    const t = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%';
    if (num.textContent !== t) num.textContent = t;
    following = requestAnimationFrame(follow);
  };
  const notice = async (on) => {
    const l = live(note);
    if (on) {
      note.removeAttribute('data-vx-leaving');
      note.setAttribute('data-shown', '');
      l?.play('assemble', null, { from: [0, l.H / 2], duration: 0.34, each: 0.2 });
    } else if (note.hasAttribute('data-shown')) {
      note.setAttribute('data-vx-leaving', '');
      if (l && !reduced) await l.play('crumble', null, { duration: 0.3 });
      note.removeAttribute('data-shown');
    }
  };
  const rest = () => {
    cancelAnimationFrame(following);
    bar(1); num.textContent = '100%';
    write(BUILDS[n % 2]);
    for (const l of lines()) l.removeAttribute('data-out');
    state('Live', 'go');
    note.removeAttribute('data-shown'); note.removeAttribute('data-vx-leaving');
    for (const p of live(note)?.model.parts ?? []) { p.fx = null; p.hidden = false; }
  };
  async function play() {
    h.put($('.actions', stage), 0.5, 0.66);
    h.show();
    for (;;) {
      await h.wait(1500);
      await h.move(go);
      await h.press(go);
      // the press is the cause: the last build's light drains and its log leaves, last line first
      follow();
      state('Building', 'accent');
      bar(0);
      for (const l of lines().reverse()) { l.setAttribute('data-out', ''); await h.wait(70); }
      await h.wait(260);
      h.move($('.actions', stage), 0.5, 0.66, 1.25).catch(() => {}); // it rests on empty surface, near its next move
      n++;
      write(BUILDS[n % 2]);
      const ls = lines();
      for (const [i, v] of [0.34, 0.71, 1].entries()) {
        bar(v);
        await h.wait(520);
        ls[i].removeAttribute('data-out');
        await h.wait(i === 2 ? 620 : 430);
      }
      state('Live', 'go');
      await h.wait(180);
      notice(true);
      await h.wait(2700);
      cancelAnimationFrame(following);
      await notice(false);
    }
  }
  return { stage, h, play, rest };
}

// ---------------------------------------------------------------------------------------------
// Story 2. A blog: the well takes focus and its rim turns to the accent, an address is typed,
// the key confirms on itself.
function blog() {
  const stage = $('#blog'), h = hand(stage);
  const well = $('.vx-well', stage), mail = $('#mail'), sub = $('#sub'), word = $('.sub-word', stage);
  const say = (text, light) => {
    if (light) sub.dataset.vxLight = light; else delete sub.dataset.vxLight;
    refresh(sub);
    if (word.textContent === text) return;
    word.style.opacity = 0;
    setTimeout(() => { word.textContent = text; word.style.opacity = ''; }, 130);
  };
  const rest = () => {
    mail.value = '';
    if (document.activeElement === mail) mail.blur();
    say('Subscribe', '');
  };
  // the key is as wide as its longer word from the start, so it never changes size under the pointer
  word.textContent = 'Subscribed';
  sub.style.minInlineSize = Math.ceil(sub.getBoundingClientRect().width / 4) * 4 + 'px';
  word.textContent = 'Subscribe';
  async function play() {
    h.put($('.quote', stage), 0.78, 0.6);
    h.show();
    for (;;) {
      await h.wait(1700);
      await h.move(well, 0.62, 0.62); // clear of where the address will be typed
      h.dip(true); await h.wait(110); h.dip(false);
      // only take the keyboard when nobody else is using it
      if (document.hasFocus() && (document.activeElement === document.body || stage.contains(document.activeElement))) mail.focus({ preventScroll: true });
      await h.wait(420);
      for (const c of 'ada@fogline.dev') { mail.value += c; await h.wait(c === '@' || c === '.' ? 150 : 62 + (c.charCodeAt(0) % 5) * 9); }
      await h.wait(380);
      await h.move(sub);
      await h.press(sub);
      mail.blur();
      say('Subscribed', 'go');
      await h.wait(420);
      h.move($('.subscribe', stage), 0.9, 0.62, 1.2).catch(() => {});
      await h.wait(2700);
      // the reset, last change first
      say('Subscribe', '');
      await h.wait(90);
      mail.value = '';
    }
  }
  return { stage, h, play, rest };
}

// ---------------------------------------------------------------------------------------------
// Running them: only while a screen is on screen, never against less motion, and never against
// the person: the moment a real pointer comes in, the story stops and the pointer is theirs.
function direct(story) {
  const { stage, h, play, rest } = story;
  let seen = false, own = false, back = 0;
  // force: start whatever the page thinks (a film starts it by hand, once its clock is in place)
  const start = (force = false) => { if (!force && (own || !seen || reduced || q.has('still'))) return; h.stop(); rest(); play().catch((e) => { if (!(e instanceof Stop)) throw e; }); };
  const halt = () => { h.stop(); h.show(false); rest(); };
  new IntersectionObserver(([e]) => { const was = seen; seen = e.isIntersecting; if (seen && !was) start(); else if (!seen && was && !own) halt(); }, { threshold: 0.35 }).observe(stage);
  const real = (e) => e.isTrusted && e.pointerType === 'mouse';
  stage.addEventListener('pointermove', (e) => {
    if (!e.isTrusted) return;
    clearTimeout(back);
    if (!own) { own = true; h.stop(); rest(); if (e.pointerType === 'mouse') stage.setAttribute('data-own', ''); }
    if (!real(e)) return h.show(false);
    const s = stage.getBoundingClientRect();
    h.place(e.clientX - s.left, e.clientY - s.top);
    h.show();
  });
  stage.addEventListener('pointerdown', (e) => { if (real(e)) h.dip(true); });
  addEventListener('pointerup', (e) => { if (real(e) && own) h.dip(false); });
  stage.addEventListener('pointerleave', (e) => {
    if (!e.isTrusted || !own) return;
    h.show(false);
    back = setTimeout(() => { if (stage.contains(document.activeElement)) return; own = false; stage.removeAttribute('data-own'); start(); }, 2600);
  });
  return { start, halt };
}

adopt();
window.vx = { live, get stage() { return getStage(); } };
ready().then(() => {
  const stories = [deploy(), blog()].map(direct);
  window.lit = { stories };
  root.dataset.ready = '1';
});
