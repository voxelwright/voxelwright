// The filter cassette shares the sheet's native dialog, stage and block travel.
import { defineLook, cue, MATERIALS } from '../../src/index.js';
import { edgeOf } from '../../src/components/sheet.js';
import { inlineX } from '../../src/plain.js';

function cassette(live, model) {
  const { W, H, vx, el } = live;
  const d = live.faceZ = live.look.slab;
  live.state.edge = edgeOf(el);
  const x = inlineX(live);
  const body = model.part('panel');
  body.box(0, -2, 0, W, H + 4, d, 'panel');
  if (W < 30 || H < 20) return;

  const head = Math.round(el.querySelector('header').offsetHeight / vx);
  const foot = Math.round(el.querySelector('footer').offsetTop / vx);
  // The reading plate sits inside a folded metal end channel. The two dark
  // crosspieces are fixed to that channel, with the key bank carried between.
  body.box(0, -2, d - 2, W, head + 2, 2, 'slate');
  body.box(0, foot, d - 2, W, H - foot + 2, 2, 'slate');
  body.box(x(0, 2), -2, d - 2, 2, H + 4, 2, 'steel');
  body.box(x(2), -2, d - 1, 1, H + 4, 1, 'gasket');
  // A short pipe behind the leading edge of the header. Metal end stops
  // meet the same lens when the instrument dimmer is turned down.
  body.box(x(3, 14), head - 2, d - 1, 14, 2, 1, 'gasket');
  body.carve(x(4, 12), head - 2, d - 1, 12, 1, 1);
  const pipe = model.part('groove');
  pipe.box(x(4, 12), head - 2, d - 1, 12, 1, 1, 'backlight');
  body.carve(x(4, 12), head - 3, d - 1, 12, 1, 1);
  pipe.box(x(4, 12), head - 3, d - 1, 12, 1, 1, 'steel');
  // Knurl on the thumb land beside the title, parallel to the free edge.
  for (const start of [7, 9, 11]) {
    body.box(x(start), Math.floor(head / 2) - 2, d, 1, 4, 1, 'steel');
  }
}

// Only the polished lip across the pipe catches its reflection. The compressed
// gasket below it stays dark and isolates the reading surface.
function lightPipe(live) {
  live.glows = false;
  const pipe = live.model.byName.groove;
  if (!pipe || pipe.tintRevision === live.tintRevision) return;
  pipe.tintRevision = live.tintRevision;
  const source = live.look.illuminant;
  const weight = 0.32 * live.look.dimmer;
  for (let c = 0; c < 3; c++) {
    const tint = parseInt(source.slice(1 + c * 2, 3 + c * 2), 16) / 255;
    for (let i = 0; i < pipe.count; i++) {
      if (pipe.mats[i] !== MATERIALS.steel.id) continue;
      const channel = i * 4 + c;
      pipe.col[channel] += (tint - pipe.col[channel]) * weight;
    }
  }
}

function headerPull(el) {
  const head = el.querySelector('header');
  let grip;
  function release(dismiss) {
    if (!grip) return;
    const id = grip.id;
    grip = null;
    if (head.hasPointerCapture(id)) head.releasePointerCapture(id);
    el.removeAttribute('data-dragging');
    el.style.removeProperty('transition');
    el.style.removeProperty('translate');
    el.style.removeProperty('--_drag');
    if (dismiss) {
      cue('release');
      el.close('cancel');
    }
  }
  head.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0 || !el.open || grip || e.target.closest('button')) return;
    const sign = edgeOf(el) === 'left' ? -1 : 1;
    const box = el.getBoundingClientRect();
    const offset = sign > 0 ? box.right - document.documentElement.clientWidth : -box.left;
    grip = { id: e.pointerId, sign, start: e.clientX, offset, distance: offset, x: e.clientX, time: e.timeStamp, speed: 0 };
    el.setAttribute('data-dragging', '');
    head.setPointerCapture(e.pointerId);
    el.style.translate = sign * offset + 'px 0';
    el.style.transition = 'none';
  });
  head.addEventListener('pointermove', e => {
    if (grip?.id !== e.pointerId) return;
    const { sign, start, offset, x, time } = grip;
    const distance = Math.max(0, Math.min(el.offsetWidth, offset + sign * (e.clientX - start)));
    grip.speed = sign * (e.clientX - x) / Math.max(1, e.timeStamp - time);
    Object.assign(grip, { distance, x: e.clientX, time: e.timeStamp });
    el.style.translate = sign * distance + 'px 0';
    el.style.setProperty('--_drag', distance / el.offsetWidth);
  });
  head.addEventListener('pointerup', e => {
    if (grip?.id !== e.pointerId) return;
    const pulled = (e.clientX - grip.start) * grip.sign;
    const flick = e.timeStamp - grip.time < 80 && grip.speed > 0.55 && pulled > 20;
    release(pulled > el.offsetWidth * 0.4 || flick);
  });
  head.addEventListener('lostpointercapture', e => { if (grip?.id === e.pointerId) release(false); });
  el.addEventListener('close', () => release(false));
}

export function mountFilters(el, rows, status) {
  const form = el.querySelector('form');
  const { failed, mine, live, branch } = form.elements;
  let saved = new FormData(form);
  el.addEventListener('beforetoggle', e => {
    if (e.newState === 'open') {
      defineLook('filter-sheet', { from: 'instrument', parts: { sheet: { build: cassette, pose: lightPipe } } });
      failed.checked = saved.has('failed');
      mine.checked = saved.has('mine');
      live.checked = saved.has('live');
      branch.value = saved.get('branch');
      el.returnValue = 'cancel';
    }
  });
  el.addEventListener('close', () => {
    if (el.returnValue === 'cancel') {
      status.textContent = 'Filters left as they were';
      return;
    }
    if (el.returnValue === 'reset') {
      failed.checked = mine.checked = false;
      live.checked = true;
      branch.value = '';
    }
    saved = new FormData(form);
    const wanted = branch.value.trim();
    let count = 0;
    for (const row of rows) {
      const match = (!failed.checked || row.dataset.status === 'failed') &&
        (!mine.checked || row.hasAttribute('data-mine')) && (!wanted || row.dataset.branch === wanted);
      row.hidden = !(match || (live.checked && row.dataset.status === 'live'));
      if (!row.hidden) count++;
    }
    status.textContent = count === rows.length ? 'Showing every deploy' : count ? `Showing ${count} of ${rows.length} deploys` : 'No matching deploys';
  });
  headerPull(el);
}
