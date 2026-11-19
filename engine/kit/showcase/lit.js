// Depth and light: one system on the real parts, shown as two screens with a pointer of the same
// voxels doing one thing in each. The look is the kit's (src/looks/lit.js); this file is the page: the time of
// day, the theme, and the two short stories (written the way Benji Taylor's Stageshow skill
// teaches: a finished screen, one gesture, a result that stays, a reset with a cause).
import { adopt, ready, live, refresh, getStage, theme, THEMES, PRESS, RELEASE } from '../src/index.js';
import './deploy-pilot.js';

const root = document.documentElement;
const q = new URLSearchParams(location.search);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------------------------
// The time of day and the theme, by the page's own switches. A theme is the kit's: theme(name).
function tabs(el, value, set) {
  const all = $$('[role="tab"]', el);
  for (const t of all) t.setAttribute('aria-selected', String(t.dataset.value === value));
  el.addEventListener('vx-change', (e) => set(all[e.detail.index].dataset.value));
  el.addEventListener('click', (e) => { if (live(el)) return; const t = e.target.closest('[role="tab"]'); if (t) set(t.dataset.value); });
}
tabs($('#time'), root.dataset.theme, (v) => { root.dataset.theme = v; });
const first = THEMES[q.get('accent')] ? q.get('accent') : 'bay';
tabs($('#accent'), first, theme);
if (first !== 'bay') theme(first);

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
    show(on = true) {
      if (on === el.hasAttribute('data-on')) return;
      el.toggleAttribute('data-on', on);
      if (el.hasAttribute('data-demo-pointer')) {
        const part = live(el);
        part?.play(on ? 'assemble' : 'crumble', null, {
          surface: 'courses', from: [0, 0], duration: on ? 0.22 : 0.16,
        }).then(finished => { if (finished && !on) part.clearSurface(); });
      }
    },
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
  const park = h.el.hasAttribute('data-demo-pointer') ? [go, 1.06, 1.18] : [$('.actions', stage), 0.5, 0.66];
  const BUILDS = [
    ['10:42:17', 'Cloned main at 4f2c9a1', '10:42:31', 'Installed 212 packages', '10:43:02', 'Built in 45 s'],
    ['10:51:40', 'Cloned main at 9be01d3', '10:51:52', 'Installed 212 packages', '10:52:21', 'Built in 41 s'],
  ];
  let n = 0;
  const lines = () => $$('.line', log);
  const write = (b) => lines().forEach((l, i) => { l.innerHTML = `<span class="at">${b[i * 2]}</span>${b[i * 2 + 1]}`; });
  let swap = 0;
  const state = (text, light, now = false) => {
    if (lamp.dataset.vxLight !== light) lamp.dataset.vxLight = light;
    clearTimeout(swap);
    if (now) { word.textContent = text; word.style.opacity = ''; return; }
    if (word.textContent === text) return;
    word.style.opacity = 0;
    swap = setTimeout(() => { word.textContent = text; word.style.opacity = ''; }, 150);
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
      const gone = note.hasAttribute('data-vx-leaving'); // a person's click has already broken it
      note.setAttribute('data-vx-leaving', '');
      if (l && !reduced && !gone) await l.play('crumble', null, { duration: 0.3 });
      note.removeAttribute('data-shown');
    }
  };
  const rest = () => {
    cancelAnimationFrame(following);
    bar(1); num.textContent = '100%';
    write(BUILDS[n % 2]);
    for (const l of lines()) l.removeAttribute('data-out');
    state('Live', 'go', true);
    note.removeAttribute('data-shown'); note.removeAttribute('data-vx-leaving');
    for (const p of live(note)?.model.parts ?? []) { p.fx = null; p.hidden = false; }
  };
  async function play() {
    h.put(...park);
    h.show();
    for (;;) {
      await h.wait(1500);
      await h.move(go);
      await h.press(go);
      await build(true);
    }
  }
  // The press is the cause: the last build's light drains and its log leaves, last line first;
  // then the new one fills, its lines arrive, and a notice says it is done.
  async function build(shown) {
    cancelAnimationFrame(following);
    follow();
    notice(false);
    state('Building', 'accent');
    bar(0);
    for (const l of lines().reverse()) { l.setAttribute('data-out', ''); await h.wait(70); }
    await h.wait(260);
    if (shown) h.move(...park, 1.25).catch(() => {}); // it rests on empty surface, near its next move
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
  // a person's own press does the same
  let manualBuild;
  go.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    h.stop();
    manualBuild = build(false).catch((err) => { if (!(err instanceof Stop)) throw err; });
  });
  return { stage, h, play, rest, get manualBuild() { return manualBuild; } };
}

// ---------------------------------------------------------------------------------------------
// Story 2. A blog: the well takes focus and its rim turns to the accent, an address is typed,
// the key confirms on itself.
function blog() {
  const stage = $('#blog'), h = hand(stage);
  const well = $('.vx-well', stage), mail = $('#mail'), sub = $('#sub'), word = $('.sub-word', stage);
  let swap = 0;
  const say = (text, light, now = false) => {
    if (light) sub.dataset.vxLight = light; else delete sub.dataset.vxLight;
    refresh(sub);
    clearTimeout(swap);
    if (now) { word.textContent = text; word.style.opacity = ''; return; }
    if (word.textContent === text) return;
    word.style.opacity = 0;
    swap = setTimeout(() => { word.textContent = text; word.style.opacity = ''; }, 130);
  };
  const rest = () => {
    mail.value = '';
    mail.removeAttribute('aria-invalid');
    if (document.activeElement === mail) mail.blur();
    say('Subscribe', '', true);
  };
  // a person's own press: an address that will not do lights the well red until it is mended;
  // one that will, and the key confirms on itself
  sub.addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
    h.stop();
    if (!/^\S+@\S+\.\S+$/.test(mail.value.trim())) { mail.setAttribute('aria-invalid', 'true'); mail.focus(); return; }
    say('Subscribed', 'go');
    try { await h.wait(2600); } catch (err) { if (err instanceof Stop) return; throw err; }
    say('Subscribe', '');
    mail.value = '';
  });
  mail.addEventListener('input', () => mail.removeAttribute('aria-invalid'));
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
      for (const c of 'ada@fogline.example') { mail.value += c; await h.wait(c === '@' || c === '.' ? 150 : 62 + (c.charCodeAt(0) % 5) * 9); }
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
  const reading = () => stage.querySelector('.log-view:focus-within');
  const start = (force = false) => { if (!force && (own || reading() || !seen || reduced || q.has('still'))) return; h.stop(); rest(); play().catch((e) => { if (!(e instanceof Stop)) throw e; }); };
  const halt = () => { h.stop(); h.show(false); rest(); };
  new IntersectionObserver(([e]) => { const was = seen; seen = e.isIntersecting; if (seen && !was) start(); else if (!seen && was && !own) halt(); }, { threshold: 0.35 }).observe(stage);
  const log = stage.querySelector('.log-view');
  // This pointer narrates the demo. Leave the operating system in charge of actual input.
  if (h.el.hasAttribute('data-demo-pointer')) {
    let inside = false;
    const take = () => {
      clearTimeout(back);
      if (!own) {
        own = true;
        if (reading()) {
          h.stop();
          h.show(false);
          for (const line of log.querySelectorAll('[data-out]')) line.removeAttribute('data-out');
        } else halt();
      }
    };
    const resume = () => {
      clearTimeout(back);
      const timer = back = setTimeout(async () => {
        // Let a tap finish its build even after the finger lifts off the glass.
        await story.manualBuild;
        if (back !== timer || inside || stage.querySelector(':focus-visible')) return;
        own = false;
        start();
      }, 2600);
    };
    const enter = e => { if (e.isTrusted) { inside = true; take(); } };
    const leave = e => { if (e.isTrusted) { inside = false; resume(); } };
    stage.addEventListener('pointerenter', enter);
    stage.addEventListener('pointerdown', enter);
    stage.addEventListener('pointerleave', leave);
    stage.addEventListener('pointercancel', leave);
    stage.addEventListener('focusin', take);
    stage.addEventListener('focusout', resume);
    inside = stage.matches(':hover');
    if (inside || stage.querySelector(':focus-visible')) take();
    return { start, halt };
  }
  const real = (e) => e.isTrusted && e.pointerType === 'mouse';
  stage.addEventListener('pointermove', (e) => {
    if (!e.isTrusted) return;
    clearTimeout(back);
    if (!own) { own = true; h.stop(); if (!reading()) rest(); if (e.pointerType === 'mouse') stage.setAttribute('data-own', ''); }
    if (!real(e) || log?.contains(e.target)) return h.show(false);
    const s = stage.getBoundingClientRect();
    h.place(e.clientX - s.left, e.clientY - s.top);
    h.show();
  });
  stage.addEventListener('pointerdown', (e) => { if (real(e)) h.dip(true); });
  addEventListener('pointerup', (e) => { if (real(e) && own) h.dip(false); });
  stage.addEventListener('pointerleave', (e) => {
    if (!e.isTrusted || !own) return;
    h.show(false);
    back = setTimeout(() => {
      if (reading() || (stage.contains(document.activeElement) && document.activeElement.matches('input'))) return; // someone is typing
      own = false; stage.removeAttribute('data-own'); start();
    }, 2600);
  });
  return { start, halt };
}

if (q.get('log') !== 'quiet') $('#deploy .log').dataset.vxReflection = 'warm';
adopt();
window.vx = { live, get stage() { return getStage(); } };
ready().then(() => {
  const stories = [deploy(), blog()].map(direct);
  window.lit = { stories };
  root.dataset.ready = '1';
});
