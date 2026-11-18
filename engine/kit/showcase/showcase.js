import { adopt, release, live, toast, sound, stageOf, getStage, ready } from '/packages/voxelmorphism/src/index.js';

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

// Remembered choices are a convenience; the page works without them.
const store = {
  get(k) { try { return localStorage.getItem('vx-' + k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem('vx-' + k) : localStorage.setItem('vx-' + k, v); } catch {} },
};

// The plain bench in "The plain version" is never adopted.
const adoptAll = () => {
  adopt();
  // by container, not by what is live now: with a renderer still on its way nothing is live yet,
  // and the kit keeps the release to replay after the adopt
  for (const el of document.querySelectorAll('[data-plain]')) release(el);
};

// ----- light
const savedTheme = store.get('theme');
if (savedTheme) {
  root.dataset.theme = savedTheme;
  for (const t of document.querySelectorAll('#light [role="tab"]')) t.setAttribute('aria-selected', String(t.dataset.themeValue === savedTheme));
}
$('#light').addEventListener('vx-change', (e) => {
  const v = $('#light').querySelectorAll('[role="tab"]')[e.detail.index].dataset.themeValue;
  if (v) root.dataset.theme = v; else delete root.dataset.theme;
  store.set('theme', v || null);
});
// with no voxels the tabs are plain buttons: make them work anyway
$('#light').addEventListener('click', (e) => {
  if (live($('#light'))) return;
  const t = e.target.closest('[role="tab"]');
  if (!t) return;
  for (const o of $('#light').querySelectorAll('[role="tab"]')) o.setAttribute('aria-selected', String(o === t));
  if (t.dataset.themeValue) root.dataset.theme = t.dataset.themeValue; else delete root.dataset.theme;
  store.set('theme', t.dataset.themeValue || null);
});

// ----- voxels on or off
const voxels = $('#voxels');
if (store.get('plain') === '1') { voxels.checked = false; root.setAttribute('data-vx-plain', ''); }
voxels.addEventListener('change', () => {
  if (voxels.checked) { root.removeAttribute('data-vx-plain'); adoptAll(); }
  else { release(); root.setAttribute('data-vx-plain', ''); }
  store.set('plain', voxels.checked ? null : '1');
});

// ----- sound
$('#sound').addEventListener('change', (e) => sound(e.target.checked));

// ----- rule: the voxel is the unit
$('#scale').addEventListener('input', (e) => {
  $('#scale-bench').style.setProperty('--vx', e.target.value + 'px');
  $('#scale-out').textContent = e.target.value + ' px';
});

// ----- rule: the front face sits on the grid
$('#depth').addEventListener('input', (e) => {
  $('#depth-block').dataset.vxDepth = e.target.value;
  $('#depth-out').textContent = e.target.value + (e.target.value === '1' ? ' voxel' : ' voxels');
});

// ----- rule: built, and they break
const card = $('#build-card'), brk = $('#break'), bld = $('#build');
brk.addEventListener('click', async () => {
  brk.disabled = true;
  card.setAttribute('data-gone', '');
  await live(card)?.play('crumble', null, { from: [0, 0] });
  bld.disabled = false;
  bld.focus();
});
bld.addEventListener('click', async () => {
  bld.disabled = true;
  const l = live(card);
  setTimeout(() => card.removeAttribute('data-gone'), l ? 380 : 0);
  await l?.play('assemble', null, { duration: 0.5 });
  brk.disabled = false;
  brk.focus();
});

// ----- kit
$('#w').addEventListener('input', (e) => { $('#w-out').textContent = e.target.value; });
$('#open-dialog').addEventListener('click', () => $('#dlg').showModal());
$('#dlg').addEventListener('close', () => { if ($('#dlg').returnValue === 'yes') toast('Bloom started. The session is running.', { kind: 'done' }); });
$('#toast-done').addEventListener('click', () => toast('Watered. Two more and it buds.', { kind: 'done' }));

// ----- growth
const meters = [...document.querySelectorAll('#shelf progress')];
const grow = (v) => {
  // the four plants are a little apart in age, so the shelf is never a row of twins
  meters.forEach((p, i) => p.setAttribute('value', String(Math.max(0, Math.min(1, v + (i - 1.5) * 0.09)))));
  $('#grow-out').textContent = stageOf(v);
};
$('#grow').addEventListener('input', (e) => grow(e.target.value / 100));
grow(0.55);

if (!root.hasAttribute('data-vx-plain')) adoptAll();
// a notice written in the page breaks under a click like any other; this page puts its samples back
document.addEventListener('vx-dismiss', (e) => { const el = e.target; if (el.closest('.vx-toasts')) return; setTimeout(() => { el.removeAttribute('data-vx-leaving'); const l = live(el); l?.play('assemble', null, { from: [0, l.H / 2] }); }, 900); });
window.vx = { live, toast, get stage() { return getStage(); } };
ready().then(() => { root.dataset.ready = '1'; });
