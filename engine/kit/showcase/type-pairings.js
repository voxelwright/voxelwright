// Whole pairings in context: the board, headings in voxels, the kit and running text, as one page top.

const Q = new URLSearchParams(location.search);

export const PAIRINGS = [
  { id: 'vox', name: 'Chosen. Vox Block, Vox Text on keys, IBM Plex',
    say: 'Vox Block on the board and for headings, Vox Sign 2 where the board is too narrow for it. What is written on a key (buttons, tabs, menu items) in Vox Text, the voxel glyphs laid flat, five voxels to the em so one text cell is half a voxel. Everything you read or type in IBM Plex Sans, code in IBM Plex Mono. All of it covers Ukrainian.',
    board: 'block sign', boardMax: 2, h2: 'block', h2Scale: 1, label: 'Vox Text', text: 'IBM Plex Sans', mono: 'IBM Plex Mono', cells: true,
    files: ['vox-text/vox-text-400-normal.woff2', 'vox-text/vox-text-700-normal.woff2', 'vox-block/vox-block-400-normal.woff2', 'vox-sign/vox-sign-400-normal.woff2', 'ibm-plex-sans/ibm-plex-sans-latin-wght-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'],
    more: ['ibm-plex-sans/ibm-plex-sans-cyrillic-wght-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-cyrillic-400-normal.woff2'] },
  { id: 'plex', name: 'Without Vox Text: Block and Plex',
    say: 'Vox Block on the board and for headings. All text in IBM Plex Sans, including labels; code in IBM Plex Mono. Nothing of our own outside the voxels.',
    board: 'block sign', boardMax: 2, h2: 'block', h2Scale: 1, label: 'IBM Plex Sans', text: 'IBM Plex Sans', mono: 'IBM Plex Mono',
    files: ['vox-block/vox-block-400-normal.woff2', 'vox-sign/vox-sign-400-normal.woff2', 'ibm-plex-sans/ibm-plex-sans-latin-wght-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'] },
  { id: 'over', name: 'Block and Overpass',
    say: 'The control for the text face: the same Vox Block lettering and the same layout, with the text left as it is today, in Overpass and Overpass Mono.',
    board: 'block sign', boardMax: 2, h2: 'block', h2Scale: 1, label: 'Overpass', text: 'Overpass', mono: 'Overpass Mono', nudge: true,
    files: ['vox-block/vox-block-400-normal.woff2', 'vox-sign/vox-sign-400-normal.woff2', 'overpass/overpass-latin-wght-normal.woff2', 'overpass-mono/overpass-mono-latin-wght-normal.woff2'] },
  { id: 'plain', name: 'Refine what is there',
    say: 'Vox Sign 2 everywhere in voxels, capitals only. All text in IBM Plex Sans, code in IBM Plex Mono. Nothing of our own outside the voxels.',
    board: 'sign', boardMax: 3, h2: 'sign', h2Scale: 2, label: 'IBM Plex Sans', text: 'IBM Plex Sans', mono: 'IBM Plex Mono',
    files: ['ibm-plex-sans/ibm-plex-sans-latin-wght-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'] },
  { id: 'chakra', name: 'Cut corners',
    say: 'Vox Block in voxels. All text in Chakra Petch, whose bowls lose one corner the way a voxel slab does. Latin only.',
    board: 'block sign', boardMax: 2, h2: 'block', h2Scale: 1, label: 'Chakra Petch', text: 'Chakra Petch', mono: 'IBM Plex Mono',
    files: ['chakra-petch/chakra-petch-latin-400-normal.woff2', 'chakra-petch/chakra-petch-latin-500-normal.woff2', 'chakra-petch/chakra-petch-latin-600-normal.woff2', 'chakra-petch/chakra-petch-latin-700-normal.woff2', 'ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2'] },
  { id: 'today', name: 'Today',
    say: 'For reference: Vox Sign as it is, Overpass and Overpass Mono.',
    today: true, label: 'Overpass', text: 'Overpass', mono: 'Overpass Mono', nudge: true,
    files: ['overpass/overpass-latin-wght-normal.woff2', 'overpass-mono/overpass-mono-latin-wght-normal.woff2'] },
];

// The same page top in Ukrainian (?lang=uk), to see every face and glyph set carry it.
const UK = {
  board: 'Вокселморфізм',
  lede: 'Скевоморфізм малював елементи так, ніби вони зі шкіри та шліфованого металу. Вокселморфізм будує їх із блоків, освітлених одним світлом, і можна порахувати, з чого зроблено кожен.',
  h2: ['Правила', 'Рослина, вирощена з числа'],
  h3: 'Усе міряється вокселями',
  say: ['Один воксель дорівнює 4 пікселям. Кожен розмір є цілим числом вокселів: кнопка заввишки 11, перемикач 16 на 8, проміжок 1. Ніщо не є часткою блока, тож ніщо не виглядає майже правильним.',
    'Змініть розмір вокселя, і весь інтерфейс масштабується разом із ним. Викличте <code>adopt()</code>, і його збудовано.',
    'Індикатор росту є рослиною. Кожен воксель у ній має день народження між 0 і 1, тож одне число малює її в будь-яку мить життя.'],
  meta: 'Полито 16 листопада 2026 о 09:41. 3 з 5 тестів пройдено.',
  buttons: ['Посадити насіння', 'Полити'], toggle: 'Поливати щодня', tabs: ['Росте', 'Розквітло', 'Зів’яло'],
  rows: [['Нова пасхалка для блогу', 'бутон'], ['Привітання в консолі', 'паросток']],
  field: ['Насінина', 'Нова пасхалка для блогу', 'Кожен полив стає частиною завдання.'],
  card: ['Полито 16 листопада', 'Старий чит-код на хвилину перетворює кожен заголовок на вокселі.'],
  toast: 'Полито. Ще два, і з’явиться бутон.',
};
function ukrainian(el) {
  el.lang = 'uk';
  const all = (q) => [...el.querySelectorAll(q)];
  el.querySelector('[data-role="board"]').textContent = UK.board;
  el.querySelector('.lede').textContent = UK.lede;
  all('[data-role="h2"]').forEach((h, i) => { h.textContent = UK.h2[i]; });
  el.querySelector('h3').textContent = UK.h3;
  all('.say p:not(.meta)').forEach((p, i) => { p.innerHTML = UK.say[i]; });
  el.querySelector('.meta').textContent = UK.meta;
  all('.vx-button').forEach((b, i) => { b.textContent = UK.buttons[i]; });
  el.querySelector('.vx-toggle').lastChild.textContent = UK.toggle;
  all('[role="tab"]').forEach((t, i) => { t.textContent = UK.tabs[i]; });
  all('.vx-list li').forEach((li, i) => { li.querySelector('a').textContent = UK.rows[i][0]; li.querySelector('.vx-row-meta').textContent = UK.rows[i][1]; });
  el.querySelector('.vx-field-label').textContent = UK.field[0];
  el.querySelector('.vx-well input').value = UK.field[1];
  el.querySelector('.vx-field-hint').textContent = UK.field[2];
  el.querySelector('.vx-card strong').textContent = UK.card[0];
  el.querySelector('.vx-card p + p').textContent = UK.card[1];
  el.querySelector('.vx-toast-text').textContent = UK.toast;
}

const F = '../fonts/';
// ?fallback=real uses the stack a real page would ship, so font loading can be measured
const WRONG = Q.get('fallback') === 'real' ? 'Arial, "Helvetica Neue", sans-serif' : '"Zapfino", "Papyrus", fantasy';
const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';

export default async function ({ host, solo }) {
  const tpl = document.querySelector('#pairing');
  for (const p of PAIRINGS) {
    if (solo && solo !== p.id) continue;
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.pair = p.id;
    if (p.cells) el.dataset.cells = '';
    if (!p.nudge) el.dataset.level = ''; // the kit nudges labels down 0.12em to suit Overpass; other faces sit level without it
    el.style.setProperty('--vx-font', `"${p.label}", ${WRONG}`);
    el.style.setProperty('--text-font', `"${p.text}", ${WRONG}`);
    el.style.setProperty('--vx-mono', `"${p.mono}", ${WRONG}`);
    el.querySelector('.tag b').textContent = p.name;
    el.querySelector('.tag .why').textContent = p.say;
    for (const h of el.querySelectorAll('[data-role]')) {
      const board = h.dataset.role === 'board';
      if (p.today) { h.className = 'vx-sign'; if (board) h.dataset.vxMax = '3'; else { h.dataset.vxBoard = 'none'; h.dataset.vxScale = '2'; } continue; }
      h.className = 'vx-lettering';
      if (board) { h.dataset.vxFont = Q.get('board') || p.board; h.dataset.vxMax = Q.get('boardmax') || p.boardMax; }
      else { h.dataset.vxBoard = 'none'; h.dataset.vxFont = Q.get('h2') || p.h2; h.dataset.vxScale = Q.get('h2scale') || p.h2Scale; }
    }
    if (Q.get('lang') === 'uk' && !p.today) ukrainian(el);
    const h3font = Q.get('h3') || p.h3;
    if (h3font) for (const h of el.querySelectorAll('h3')) { h.className = 'vx-lettering'; h.dataset.vxBoard = 'none'; h.dataset.vxFont = h3font; h.dataset.vxScale = '1'; }
    host.append(el);
    let bytes = 0;
    for (const f of p.files) { try { bytes += (await (await fetch(F + f)).blob()).size; } catch {} }
    let more = 0;
    for (const f of p.more || []) { try { more += (await (await fetch(F + f)).blob()).size; } catch {} }
    el.querySelector('.tag .cost').textContent = `${kb(bytes)} of fonts in all` + (more ? `, and ${kb(more)} more on a page with Ukrainian in it.` : '.');
    for (const fam of new Set([p.label, p.text, p.mono])) { await document.fonts.load(`400 16px "${fam}"`).catch(() => {}); await document.fonts.load(`400 16px "${fam}"`, 'Її').catch(() => {}); }
    await document.fonts.load(`700 16px "${p.text}"`, 'Її').catch(() => {});
    await document.fonts.load(`700 16px "${p.text}"`).catch(() => {});
  }
  if (solo) document.body.classList.add('solo-pair');
}
