// Three directions for the kit, on the real parts. Each column stands in its own look
// (data-vx-look, which directions.css turns into --vx-look and a voxel size); the kit draws each
// part from the look it finds itself in. An experiment: the chosen direction moves into the kit.
import { adopt, ready, getStage, live, defineLook, wrapLabel, SLIDE } from '/packages/voxelmorphism/src/index.js';

const root = document.documentElement;

// ---------------------------------------------------------------------------------------------
// What every column gets: the two faults both reviewers found in the baseline.
//  1. The grid on a face you read from was louder than the shape. Now the middle of a face is
//     plain; edges and sides keep their seams, so the blocks can still be counted.
//  2. At night every surface that holds content was the action blue. Now content is a quiet
//     blue-grey, trays and switched-off things are darker still, and the floor of a field is
//     darker than the page, so a field reads as a hole.
const NIGHT = {
  chalk: { night: '#3d4258' },
  slate: { night: '#262b47' },
  steel: { night: '#30344c' },
  floor: { night: '#05071b' },
};

// ---------------------------------------------------------------------------------------------
// Today: the shapes as they are.
defineLook('today', { quiet: true, materials: NIGHT });

// ---------------------------------------------------------------------------------------------
// Paper: only what you touch is a solid. Content lies one voxel off the page, a menu two, a
// dialog three; a field's floor is a shade darker than paper by day too.
defineLook('paper', {
  from: 'today',
  slab: 1, float: 2, dialog: 3, round: 1,
  materials: { ...NIGHT, floor: { day: '#eceff9', night: '#05071b' } },
});

// ---------------------------------------------------------------------------------------------
// Chunky: an 8 px voxel, and half as many of them. Things you press stand three voxels up and go
// two down. The switch, the slider and the tabs are drawn again for the coarser grid.
const KNOB = 4, THUMB = 3;

const chunkyToggle = {
  build(live, m) {
    const { W, H } = live;
    const input = live.state.input = live.el.parentElement.querySelector('input');
    const off = input?.disabled;
    m.part('tray').slab(0, 0, 0, W, H, 1, off ? 'steel' : 'slate', 1);
    // on: the bed beside the knob is the state colour, a voxel proud of the tray
    const lit = m.part('lit');
    lit.masked = true; lit.grounded = false; lit.covered = true;
    lit.slab(0, 0, 1, W, H, 1, 'signal', 1);
    // the knob is one block, half the switch wide and as tall as the tray
    const knob = m.part('knob');
    knob.grounded = false;
    knob.box(0, 0, 1, KNOB, H, 2, off ? 'steel' : 'ivory');
    live.faceZ = 1;
    live.state.travel = W - KNOB;
    const s = live.spring('at', input?.checked ? 1 : 0, SLIDE.k, SLIDE.c);
    if (!s.moving) s.snap(input?.checked ? 1 : 0);
  },
  pose(live) {
    const { knob, lit } = live.model.byName;
    const t = live.spring('at').x;
    const x = t * live.state.travel;
    knob.tx = x;
    knob.tz = live.spring('press').x * 0.5;
    const edge = x + KNOB / 2;
    for (let i = 0; i < lit.count; i++) lit.scales[i] = t <= 0.001 ? 0 : Math.max(0, Math.min(1, edge - lit.rest[i * 3] + 0.5));
  },
};

const chunkySlider = {
  build(live, m) {
    const { W, H } = live;
    const y = Math.floor((H - 2) / 2);
    // a low bar; the part behind the thumb is the state colour
    m.part('rail').box(0, y, 0, W, 2, 1, 'slate');
    const lit = m.part('lit');
    lit.masked = true; lit.grounded = false; lit.covered = true;
    lit.box(0, y, 0, W, 2, 1, 'signal');
    lit.tz = 0.03;
    // the thumb is a block as tall as a button
    const thumb = m.part('thumb');
    thumb.grounded = false;
    thumb.slab(0, 0, 1, THUMB, H, 2, live.el.querySelector('input')?.disabled ? 'steel' : 'enamel', 0);
    live.faceZ = 1;
    live.state.travel = W - THUMB;
  },
  pose(live) {
    const input = live.el.querySelector('input');
    const { thumb, lit } = live.model.byName;
    const min = Number(input.min || 0), max = Number(input.max || 100);
    const t = max > min ? Math.max(0, Math.min(1, (Number(input.value) - min) / (max - min))) : 0;
    const x = t * live.state.travel;
    thumb.tx = x;
    thumb.tz = live.spring('press').x * 0.5;
    const edge = x + THUMB / 2;
    for (let i = 0; i < lit.count; i++) lit.scales[i] = Math.max(0, Math.min(1, edge - lit.rest[i * 3] + 0.5));
  },
};

// The field keeps its rim inside its own box, so it is as tall as a button and no taller.
const chunkyField = {
  build(live, m) {
    const { W, H, el } = live;
    const input = el.querySelector('input, textarea');
    const wall = input?.matches(':focus') ? 'enamel' : input?.getAttribute('aria-invalid') === 'true' ? 'brick' : 'slate';
    const walls = m.part('walls');
    walls.sunk = true;
    walls.box(0, 0, -1, W, H, 1, wall).carve(1, 1, -1, W - 2, H - 2, 1);
    const floor = m.part('floor');
    floor.sunk = true;
    floor.box(1, 1, -2, W - 2, H - 2, 1, input?.disabled ? 'slate' : 'floor');
    live.well = [0, 0, W, H];
    live.faceZ = 0;
  },
};

const chunkyTabs = {
  build(live, m) {
    const { W, H, el, vx } = live;
    const tabsEl = live.state.tabs = [...el.querySelectorAll(':scope > [role="tab"]')];
    m.part('tray').slab(0, 0, 0, W, H, 1, 'slate', 1);
    const seat = live.state.seat = tabsEl.length ? Math.round(tabsEl[0].offsetWidth / vx) : W;
    // the chosen tab is one block of the state colour: nothing sits above its words
    const block = m.part('block');
    block.grounded = false;
    block.slab(0, 1, 1, seat - 2, H - 2, 2, 'signal', 1);
    live.faceZ = 1;
    const index = Math.max(0, tabsEl.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    live.state.index = index;
    const xs = live.state.xs = tabsEl.map((t) => Math.round(t.offsetLeft / vx) + 1);
    const s = live.spring('x', xs[index] ?? 1, SLIDE.k * 1.25, SLIDE.c * 1.12);
    s.snap(xs[index] ?? 1);
    tabsEl.forEach((t) => live.label(wrapLabel(t), () => live.faceZ)); // they do not move; registered so their words are kept on whole pixels
    block.ty = -1;
  },
};

defineLook('chunky', {
  from: 'today',
  rise: 3, travel: 2, step: 1, inlay: true,
  slab: 1, float: 2, dialog: 3, well: 1, round: 1,
  // A face here is four voxels tall, so an icon three tall cannot sit in its middle. Only the
  // chevron (two tall) is drawn in voxels; other icons would have to be flat glyphs in the legend.
  icons: { chevron: ['#.#', '.#.'] },
  parts: { toggle: chunkyToggle, slider: chunkySlider, tabs: chunkyTabs, field: chunkyField },
});

// ---------------------------------------------------------------------------------------------
// The page.
const q = new URLSearchParams(location.search);
const only = q.get('look');
if (only) { root.dataset.only = only; document.getElementById('col-' + only)?.setAttribute('data-shown', ''); }
if (q.get('theme')) root.dataset.theme = q.get('theme');

const light = document.getElementById('light');
const setTheme = (v) => { if (v) root.dataset.theme = v; else delete root.dataset.theme; };
if (root.dataset.theme) for (const t of light.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', String(t.dataset.themeValue === root.dataset.theme));
light.addEventListener('vx-change', (e) => setTheme(light.querySelectorAll('[role="tab"]')[e.detail.index].dataset.themeValue));
light.addEventListener('click', (e) => {
  if (live(light)) return; // with no voxels the kit's plain behaviour has no vx-change yet
  const t = e.target.closest('[role="tab"]');
  if (t) setTheme(t.dataset.themeValue);
});

for (const input of document.querySelectorAll('.knob input[type="range"]')) {
  const out = input.closest('.knob').querySelector('output');
  input.addEventListener('input', () => { out.textContent = input.value; });
}

adopt();
window.vx = { live, get stage() { return getStage(); } };
ready().then(() => { root.dataset.ready = '1'; });
