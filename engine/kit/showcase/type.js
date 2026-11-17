import { adopt, define, live, getStage } from '/packages/voxelmorphism/src/index.js';

const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const q = new URLSearchParams(location.search);
const F = '/packages/voxelmorphism/fonts/';

// The text faces. wrong: a fallback nobody could mistake for the face, so a failed load is seen.
const WRONG = '"Zapfino", "Papyrus", fantasy';
export const FACES = [
  { id: 'overpass', name: 'Overpass', why: 'Today. Drawn from US highway signs.', font: 'Overpass', mono: 'Overpass Mono', weights: [400, 500, 600, 700],
    files: ['overpass/overpass-latin-wght-normal.woff2', 'overpass-mono/overpass-mono-latin-wght-normal.woff2'] },
  { id: 'plex', name: 'IBM Plex Sans', why: 'Engineered: flat cuts, square dots, a machine made by people.', font: 'IBM Plex Sans', mono: 'IBM Plex Mono', weights: [400, 500, 600, 700],
    files: ['ibm-plex-sans/ibm-plex-sans-latin-wght-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'] },
  { id: 'atkinson', name: 'Atkinson Hyperlegible Next', why: 'Drawn for low vision: every letter is unmistakable.', font: 'Atkinson Hyperlegible Next', mono: 'Atkinson Hyperlegible Mono', weights: [400, 500, 600, 700],
    files: ['atkinson-hyperlegible-next/atkinson-hyperlegible-next-latin-wght-normal.woff2', 'atkinson-hyperlegible-mono/atkinson-hyperlegible-mono-latin-wght-normal.woff2'] },
  { id: 'barlow', name: 'Barlow', why: 'California plates, highway signs and buses: the city the billboards stand in.', font: 'Barlow', mono: 'IBM Plex Mono', weights: [400, 500, 600, 700],
    files: ['barlow/barlow-latin-400-normal.woff2', 'barlow/barlow-latin-500-normal.woff2', 'barlow/barlow-latin-600-normal.woff2', 'barlow/barlow-latin-700-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'] },
  { id: 'chakra', name: 'Chakra Petch', why: 'Square bowls with one corner cut, like a stepped voxel corner.', font: 'Chakra Petch', mono: 'IBM Plex Mono', weights: [400, 500, 600, 700],
    files: ['chakra-petch/chakra-petch-latin-400-normal.woff2', 'chakra-petch/chakra-petch-latin-500-normal.woff2', 'chakra-petch/chakra-petch-latin-600-normal.woff2', 'chakra-petch/chakra-petch-latin-700-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'] },
  { id: 'b612', name: 'B612', why: 'Made for aircraft cockpit screens: low resolution, no mistakes.', font: 'B612', mono: 'IBM Plex Mono', weights: [400, 700],
    files: ['b612/b612-latin-400-normal.woff2', 'b612/b612-latin-700-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'] },
  { id: 'geistpixel', name: 'Geist Pixel', why: 'A grotesque redrawn on a fine pixel grid.', font: 'Geist Pixel', mono: 'Departure Mono', weights: [400],
    files: ['geist-pixel/geist-pixel-latin-400-normal.woff2', 'departure-mono/departure-mono-400-normal.woff2'] },
  { id: 'departure', name: 'Departure Mono', why: 'A pixel monospace with real craft. Crisp only at 11, 22 and 33 px.', font: 'Departure Mono', mono: 'Departure Mono', weights: [400],
    files: ['departure-mono/departure-mono-400-normal.woff2'] },
  { id: 'voxtext', name: 'Vox Text', why: 'Ours: the voxel lettering itself, flat, as a web font.', font: 'Vox Text', mono: 'Departure Mono', weights: [400, 700], optional: true,
    files: ['vox-text/vox-text-400-normal.woff2', 'vox-text/vox-text-700-normal.woff2', 'departure-mono/departure-mono-400-normal.woff2'] },
];

// ----- controls
const solo = q.get('face');
if (solo) document.body.classList.add('solo');
const pick = (tabs, v) => { for (const t of tabs.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', String(t.dataset.v === v)); };
if (q.get('size')) pick($('#size'), q.get('size'));
if (q.get('theme')) pick($('#light'), q.get('theme'));
const choose = (tabs, fn) => {
  const act = (t) => { if (t) { pick(tabs, t.dataset.v); fn(t.dataset.v); } };
  tabs.addEventListener('vx-change', (e) => act(tabs.querySelectorAll('[role="tab"]')[e.detail.index]));
  tabs.addEventListener('click', (e) => { if (!live(tabs)) act(e.target.closest('[role="tab"]')); });
};
choose($('#size'), (v) => { root.style.fontSize = v + 'px'; });
choose($('#light'), (v) => { if (v) root.dataset.theme = v; else delete root.dataset.theme; });

// ----- the screens
const tpl = $('#screen');
const screens = $('#screens');
const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
const wanted = (q.get('faces') || '').split(',').filter(Boolean);

async function exists(file) {
  try { return (await fetch(F + file, { method: 'HEAD' })).ok; } catch { return false; }
}

async function build(face) {
  if (face.optional && !(await exists(face.files[0]))) return;
  if (solo && solo !== face.id) return;
  if (wanted.length && !wanted.includes(face.id)) return;
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.dataset.face = face.id;
  if (solo) el.dataset.solo = '';
  el.style.setProperty('--vx-font', `"${face.font}", ${WRONG}`);
  el.style.setProperty('--vx-mono', `"${face.mono}", ${WRONG}`);
  el.querySelector('.tag b').textContent = face.name;
  el.querySelector('.why').textContent = face.why;
  screens.append(el);
  // what it costs, read from the files themselves
  let bytes = 0;
  for (const f of face.files) { try { bytes += (await (await fetch(F + f)).blob()).size; } catch {} }
  el.querySelector('.cost').textContent = `OFL 1.1, ${kb(bytes)} for text and code. Weights: ${face.weights.join(', ')}.`;
  // did every weight really load?
  const missing = [];
  for (const w of face.weights) {
    const got = await document.fonts.load(`${w} 16px "${face.font}"`).catch(() => []);
    if (!got.length) missing.push(w);
  }
  const gotMono = await document.fonts.load(`400 16px "${face.mono}"`).catch(() => []);
  if (!gotMono.length) missing.push('mono');
  const st = el.querySelector('.status');
  if (missing.length) { st.textContent = 'Did not load: ' + missing.join(', '); st.dataset.bad = ''; } else st.remove();
  el.dataset.loaded = missing.length ? 'no' : 'yes';
}

for (const face of FACES) await build(face);

// ----- lettering directions (filled in by lettering.js when it exists)
try {
  const m = await import('./type-lettering.js');
  await m.default({ define, host: $('#directions'), solo: q.get('lettering') });
} catch (e) { if (!/Failed to fetch|import/.test(String(e))) console.error(e); $('#lettering').hidden = !$('#directions').children.length; }

await document.fonts.ready;
adopt();
window.vx = { live, FACES, get stage() { return getStage(); } };
// let open dialogs finish building before anyone takes a picture
setTimeout(() => { root.dataset.ready = '1'; }, 900);
