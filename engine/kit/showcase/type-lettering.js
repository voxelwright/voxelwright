// The lettering half of the type study: each direction as real voxels, at 1, 2 and 3 voxels per cell.

import { lettering } from '/packages/voxelmorphism/src/components/lettering.js';

const DIRECTIONS = [
  { id: 'today', name: 'Vox Sign, as it is today', tag: 'vx-sign',
    say: 'For reference. Five by seven, capitals only, one gap for every pair, two voxels deep at every size, and enlarged rather than redrawn.' },
  { id: 'sign', name: 'Direction 1. Vox Sign 2: the five by seven, refined', font: 'sign',
    say: 'The same grid and the same voice. Every corner follows one rule, the M, N, W, G, J and 2 are redrawn, the I is a single post, the comma hangs below the line, pairs are kerned in whole cells, depth follows scale, and at two or three voxels per cell diagonals are redrawn as single steps.' },
  { id: 'block', name: 'Direction 2. Vox Block: the billboard', font: 'block', bigScale: 1,
    say: 'Eleven cells tall, the height of a button, with a stroke two cells wide. A corner can lose one cell and still be a corner, so it is already detailed at one voxel per cell and never needs enlarging. Capitals only; it wants room.' },
  { id: 'sentence', name: 'Direction 3. Vox Sentence: capitals and lowercase', font: 'sentence',
    say: 'Vox Sign 2 with a lowercase: x-height five, descenders two, lowercase four cells wide. A heading can be a sentence, and it sets about a seventh shorter than capitals. Laid flat, this set is Vox Text.' },
];

const Q = new URLSearchParams(location.search);
const PANGRAM = 'Sphinx of black quartz, judge my vow.';
const NUMBERS = '0123456789 +-=/:;!?&';

export default async function ({ define, host, solo }) {
  define(lettering);
  const el = (tag, attrs = {}, text = '') => { const n = document.createElement(tag); for (const k in attrs) n.setAttribute(k, attrs[k]); n.textContent = text; return n; };
  for (const d of DIRECTIONS) {
    if (solo && solo !== d.id) continue;
    const sec = el('article', { class: 'direction', 'data-direction': d.id });
    const head = el('header');
    head.append(el('b', {}, d.name), el('span', {}, d.say));
    sec.append(head);
    const set = el('div', { class: 'set' });
    const line = (text, scale, opts = {}) => {
      const a = { class: d.tag || 'vx-lettering', 'data-vx-board': opts.board ? '' : 'none', 'data-vx-scale': String(scale) };
      if (opts.board) { delete a['data-vx-board']; delete a['data-vx-scale']; a['data-vx-max'] = String(scale); }
      if (d.font) a['data-vx-font'] = opts.font || d.font;
      if (opts.refine === false || Q.get('refine') === 'off') a['data-vx-refine'] = 'off';
      if (Q.get('depth')) a['data-vx-depth'] = Q.get('depth');
      if (Q.get('ink')) a['data-vx-ink'] = Q.get('ink');
      return el(opts.tag || 'p', a, text);
    };
    const cap = (t) => el('p', { class: 'cap' }, t);
    set.append(cap('One voxel per cell'), line(PANGRAM, 1), line(NUMBERS, 1));
    set.append(cap('The rules, at 1, 2 and 3 voxels per cell'), line('The rules', 1), line('The rules', 2), line('The rules', 3));
    set.append(cap('A real heading'), line('A plant, grown from a number', d.bigScale || 2));
    set.append(cap('On the board'), line('Voxelmorphism', 3, { board: true }));
    sec.append(set);
    host.append(sec);
  }
  if (solo && solo !== 'none') document.body.classList.add('solo-lettering');
}
