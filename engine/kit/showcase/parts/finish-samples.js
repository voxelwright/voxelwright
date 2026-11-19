// The four finish samples in Fogline's header. The picker still owns the radios,
// theme events and storage. The shared toggle-group binding supplies the springs.
import { defineLook, defineMaterial, THEMES, cue } from '../../src/index.js';

const samples = {
  bay:  { name: 'Alloy', color: '#365e7c', ink: '#fff4de', gloss: 78 },
  rose: { name: 'Lacquer', color: '#884458', ink: '#fff3df', gloss: 95 },
  dusk: { name: 'PBT', color: '#514c66', ink: '#fff4e4', gloss: 12 },
  tide: { name: 'Frost', color: '#aad2c8', ink: '#143d41', gloss: 44, transmission: .34 },
};

function buildBank(live, model) {
  const { state, el, vx } = live;
  const deck = model.part('deck');
  state.seats = [...el.querySelectorAll(':scope > label')];
  state.inputs = state.seats.map(seat => seat.querySelector('input'));
  state.caps = state.seats.map((seat, i) => {
    const input = state.inputs[i], sample = samples[input.value];
    const mat = sample ? 'sample-' + input.value : 'key';
    const x = Math.round(seat.offsetLeft / vx), y = Math.round(seat.offsetTop / vx);
    const w = Math.round(seat.offsetWidth / vx), h = Math.round(seat.offsetHeight / vx);
    // Each opening has a floor, a square guide, and three courses of fixed wall.
    // Tile the deck by actual seats so a wrapped last row ends at its last key.
    deck.box(x, y, 0, w, h, 3, 'gasket').carve(x + 1, y + 1, 1, w - 2, h - 5, 2);
    const key = model.part('sample' + i);
    key.grounded = false;
    const stem = Math.max(2, Math.floor(w / 4));
    const sx = x + Math.floor((w - stem) / 2), sy = y + Math.floor((h - 5 - stem) / 2);
    deck.carve(sx - 1, sy - 1, 0, stem + 2, stem + 2, 1);
    key.box(sx, sy, 0, stem, stem, 4, 'slate');
    key.slab(x + 1, y + 1, 4, w - 3, h - 5, 2, mat, 1);
    key.slab(x + 2, y + 2, 6, w - 5, h - 7, 1, mat, 1);
    key.mouldRadius = 2;
    const latch = live.spring('on' + i, +input.checked);
    latch.snap(+input.checked);
    live.spring('hold' + i, 0);
    // The text is centred over the crown in plan. Track its projected height.
    live.label(seat.querySelector('.vx-label'), () => 7 + key.tz);
    return key;
  });
  live.faceZ = 3;
  state.index = state.inputs.findIndex(r => r.checked);
}

function poseBank(live) {
  live.state.caps.forEach((cap, i) => {
    const latch = live.spring('on' + i), hold = live.spring('hold' + i);
    // The latched position leaves one more course to bottom out on a second press.
    cap.tz = -Math.min(3, Math.max(0, 2 * latch.x, -3 * hold.x));
  });
}

function buildLens(live, m) {
  const { W, H } = live;
  m.part('socket').box(-1, 0, 0, W + 2, H, 1, 'gasket');
  m.part('glass').box(0, 0, 1, W, H, 1, 'lens');
  live.faceZ = 2;
}

function poseLens(live) {
  const input = live.el.closest('label').querySelector('input');
  const color = THEMES[input.value]?.light[live.theme] || '#98afa7';
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  const glass = live.model.byName.glass;
  for (let i = 0; i < glass.count; i++) {
    // One diode behind a smoked slit. The diffuser tapers toward both ends.
    const d = Math.abs(glass.rest[3 * i] - live.W / 2);
    const power = input.checked ? Math.exp(-.22 * d) : .025;
    for (let c = 0; c < 3; c++) glass.col[4 * i + c] = .16 + (rgb[c] - .16) * power + .40 * power ** 4;
    glass.col[4 * i + 3] = input.checked ? power : 0;
  }
  // A satin metal collar picks up the light leaking from the two cut ends.
  const socket = live.model.byName.socket;
  socket.tint(live.theme, live.look);
  if (input.checked) {
    for (let i = 0; i < socket.count; i++) {
      for (let c = 0; c < 3; c++) socket.col[4 * i + c] += rgb[c] * .1;
    }
  }
  live.glows = input.checked;
  live.glowStrength = .07;
  live.glowRadius = 1.25;
}

export function fitFinishSamples(bank) {
  const materials = { gasket: { day: '#474a45', night: '#3d403c' } }, finishes = {};
  for (const [value, sample] of Object.entries(samples)) {
    const mat = 'sample-' + value;
    defineMaterial(mat, { day: sample.color, jitter: value === 'dusk' ? .016 : .004 });
    materials[mat] = { transmission: sample.transmission || 0 };
    if (value === 'bay') materials[mat].grain = (_, y) => .013 * Math.sin(y * 2.5);
    finishes[mat] = { chamfer: 70, specular: sample.gloss };
    const seat = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio'; input.value = value;
    input.setAttribute('aria-description', sample.name);
    const title = document.createElement('span');
    title.className = 'vx-label';
    title.append(THEMES[value].label ?? value[0].toUpperCase() + value.slice(1));
    const sub = document.createElement('small');
    sub.textContent = sample.name;
    sub.setAttribute('aria-hidden', 'true');
    title.append(sub);
    seat.append(input, title);
    seat.style.setProperty('--sample', sample.color);
    seat.style.setProperty('--legend', sample.ink);
    bank.append(seat);
  }
  defineLook('finish-samples', {
    from: 'lit', quiet: false, seam: .23, grain: 1, step: 1,
    materials, finishes, parts: {
      'toggle-group': { build: buildBank, pose: poseBank, pad: 4, recordedReturn: true, instantKeyboardChoice: true },
      'theme-picker': { build: buildLens, pose: poseLens, pad: 2 },
    },
  });
}

function strokes(el, on) {
  let held = null;
  const begin = (kind, target) => {
    if (held !== null || !target.closest('label')?.querySelector('input:enabled')) return;
    held = kind;
    cue('press');
  };
  const end = kind => {
    if (held !== kind) return;
    held = null;
    cue('release');
  };
  on(el, 'pointerdown', e => { if (e.button === 0) begin(e.pointerId, e.target); });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) on(el, type, e => end(e.pointerId));
  on(el, 'keydown', e => { if (e.key === ' ' && !e.repeat) begin('space', e.target); });
  on(el, 'keyup', e => { if (e.key === ' ') end('space'); });
  on(el, 'focusout', () => end('space'));

}

export const sampleReturn = {
  name: 'sample-return', selector: '#picker > [data-vx-pick="theme"]',
  plain: strokes,
};
