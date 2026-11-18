// The numbers the type study gates on, per text face. Run with the showcase server up.
// crisp: share of a text block's ink pixels at 1x that are fully on or fully off (hard edges). 100 is a bitmap.
// offset: how far the middle of a label's capitals sits from the middle of a 44 px button, in px (minus is high).
// shift: change in a paragraph's height when the face replaces its fallback stack, in px (layout shift on load).
import { chromium } from 'playwright';
const port = process.env.PORT || 5987;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${port}/kit/showcase/type.html?faces=none&lettering=none`);
await page.waitForFunction(() => window.vx, null, { timeout: 9000 });
const rows = await page.evaluate(async () => {
  const FACES = window.vx.FACES;
  const F = '/kit/fonts/';
  const text = 'One voxel is 4 px. Every size is a whole number of voxels: a button is 11 tall, a switch is 16 by 8, a gap is 1. Nothing is a fraction of a block, so nothing looks nearly right.';
  const out = [];
  const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  for (const face of FACES) {
    let bytes = 0, ok = true;
    for (const f of face.files) { const r = await fetch(F + f); if (!r.ok) { ok = false; break; } bytes += (await r.blob()).size; }
    if (!ok) continue;
    for (const w of face.weights) await document.fonts.load(`${w} 16px "${face.font}"`);
    const row = { id: face.id, name: face.name, bytes, weights: face.weights.join(' ') };
    // crispness at 1x, per size
    for (const size of [14, 16, 17, 20]) {
      const c = document.createElement('canvas'); c.width = 600; c.height = 80;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 80); x.fillStyle = '#000';
      x.font = `400 ${size}px "${face.font}"`; x.textBaseline = 'alphabetic';
      x.fillText('Every watering becomes part of the brief 0123', 4, 30); x.fillText('Hamburgefonstiv quartz judge my vow', 4, 64);
      const d = x.getImageData(0, 0, 600, 80).data; let ink = 0, hard = 0;
      for (let i = 0; i < d.length; i += 4) { const v = d[i]; if (v < 250) { ink++; if (v < 40) hard++; } }
      row['crisp' + size] = Math.round((hard / ink) * 100);
    }
    // metrics: where capitals sit in a 44 px button at 16 px, line-height 1, centred
    const c = document.createElement('canvas').getContext('2d');
    c.font = `700 100px "${face.font}"`;
    const m = c.measureText('H'), mx = c.measureText('x');
    const A = m.fontBoundingBoxAscent / 100, D = m.fontBoundingBoxDescent / 100, cap = m.actualBoundingBoxAscent / 100, xh = mx.actualBoundingBoxAscent / 100;
    row.cap = cap.toFixed(3); row.xh = xh.toFixed(3);
    row.offsetCaps = (((A - D - cap) / 2) * 16).toFixed(1);   // + is low, - is high
    row.offsetMixed = (((A - D - (cap + xh) / 2) / 2) * 16).toFixed(1);
    row.capVoxels17 = ((cap * 17) / 4).toFixed(2);
    // layout shift: the same paragraph in the face and in the fallback stack
    const p = document.createElement('p');
    p.style.cssText = 'position:absolute;left:0;top:0;width:358px;margin:0;font-size:17px;line-height:1.6;visibility:hidden';
    p.textContent = text; document.body.append(p);
    p.style.fontFamily = `"${face.font}"`; const h1 = p.getBoundingClientRect().height;
    p.style.fontFamily = '"Avenir Next", "Segoe UI", sans-serif'; const h2 = p.getBoundingClientRect().height;
    p.style.width = 'auto'; p.style.whiteSpace = 'nowrap';
    p.style.fontFamily = `"${face.font}"`; const w1 = p.getBoundingClientRect().width;
    p.style.fontFamily = '"Avenir Next", "Segoe UI", sans-serif'; const w2 = p.getBoundingClientRect().width;
    p.remove();
    row.shiftPx = Math.round(h1 - h2); row.widthVsFallback = ((w1 / w2 - 1) * 100).toFixed(1) + '%'; row.charsPerLine = Math.round(text.length / (w1 / 358));
    out.push(row);
  }
  // contrast of the theme's text colours, from the tokens themselves
  const contrast = {};
  const probe = document.createElement('div'); document.body.append(probe);
  const rgb = (v) => { probe.style.color = v; return getComputedStyle(probe).color.match(/[\d.]+/g).map(Number); };
  const cr = (a, b) => { const la = lum(...rgb(a)), lb = lum(...rgb(b)); return ((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(2); };
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme;
    const cs = getComputedStyle(document.documentElement); const v = (n) => cs.getPropertyValue(n).trim();
    contrast[theme] = {
      'ink on ground': cr(v('--vx-ink'), v('--vx-ground')), 'ink on chalk': cr(v('--vx-ink'), v('--vx-chalk')),
      'quiet on ground': cr(v('--vx-ink-quiet'), v('--vx-ground')), 'quiet on chalk': cr(v('--vx-ink-quiet'), v('--vx-chalk')),
      'white on enamel': cr('#ffffff', v('--vx-enamel')), 'ink on signal': cr('#0a0f3d', v('--vx-signal')), 'ink on slate (tabs)': cr(v('--vx-ink'), v('--vx-slate')),
      'ink on steel (off)': cr(v('--vx-ink'), v('--vx-steel')), 'link on ground': cr(v('--vx-link'), v('--vx-ground')),
    };
  }
  probe.remove();
  return { out, contrast };
});
await browser.close();
const cols = ['id', 'bytes', 'weights', 'crisp14', 'crisp16', 'crisp17', 'crisp20', 'cap', 'xh', 'capVoxels17', 'offsetCaps', 'offsetMixed', 'shiftPx', 'widthVsFallback', 'charsPerLine'];
console.log(cols.join('\t'));
for (const r of rows.out) console.log(cols.map((c) => r[c]).join('\t'));
console.log(JSON.stringify(rows.contrast, null, 1));
