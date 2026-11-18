// Measure the real key legends, shutter lamps and lower bezels at one device pixel per CSS pixel.
// PORT=5989 node tools/latch-fit.mjs
import { chromium } from 'playwright';

const base = `http://127.0.0.1:${process.env.PORT || 5989}/kit/showcase/`;
const controls = [
  { name: 'tabs', path: '', selector: '.tabcard .vx-tabs', legend: '[aria-selected="true"] .vx-label' },
  { name: 'follow', path: 'parts/toggle-button.html', selector: '#s-off', legend: ':scope > .vx-label' },
  { name: 'bank', path: 'parts/toggle-group.html', selector: '#range', legend: 'label:has(input:checked) .vx-label' },
  { name: 'pager', path: 'parts/pagination.html', selector: '#pager ol', legend: '[aria-current="page"] .vx-label' },
];

function geometry(el, name) {
  const live = window.vx.live(el);
  const selected = { tabs: live.state.index, follow: '', bank: live.state.index, pager: live.state.latched }[name];
  const partsFor = key => ['lens', 'guide', 'tongue'].map(prefix => live.model.byName[prefix + key]);
  const seatEnd = key => name === 'bank' ? live.state.at[key][1] + live.state.at[key][3] : live.H;
  const canvas = live.canvas.getBoundingClientRect();
  const originX = canvas.x + live.ox / devicePixelRatio;
  const originY = canvas.y + live.oy / devicePixelRatio;
  const lowerEdge = originY + seatEnd(selected) * live.vx;
  const assembly = partsFor(selected);
  const lens = assembly[0];
  const centres = [];
  for (let i = 0; i < lens.count; i++) {
    const at = 3 * i;
    const z = lens.rest[at + 2] + lens.tz + 0.5;
    centres.push([originX + (lens.rest[at] + lens.tx + z / 2) * live.vx,
      originY + (lens.rest[at + 1] + lens.ty + z / 2) * live.vx]);
  }

  let solidClear = Infinity, inactiveCells = 0, inactiveLit = 0;
  for (const glass of live.model.parts.filter(p => /^lens\d*$/.test(p.name))) {
    const key = glass.name.slice(4);
    const inactive = key !== String(selected) || (name === 'follow' && el.getAttribute('aria-pressed') === 'false');
    if (inactive) {
      inactiveCells += glass.count;
      for (let i = 0; i < glass.count; i++) {
        if (!glass.hidden && glass.col[4 * i + 3] > 0) inactiveLit++;
      }
    }
    // The closed neighbour may project further than the open shutter. Check both.
    for (const part of partsFor(key)) {
      for (let i = 0; i < part.count; i++) {
        const at = 3 * i;
        const z = part.rest[at + 2] + part.tz + 0.5;
        const bottom = part.rest[at + 1] + part.ty + 0.5 + z / 2;
        solidClear = Math.min(solidClear, (seatEnd(key) - bottom) * live.vx);
      }
    }
  }
  return { lowerEdge, solidClear, inactiveCells, inactiveLit, names: assembly.map(p => p.name), centres };
}

// Mask just the measured pieces on a disposable page. Preserve the plate, cap and camera.
function removeParts(el, names) {
  const live = window.vx.live(el);
  for (const name of names) live.model.byName[name].count = 0;
  live.dirty = true;
  live.draw();
}

async function comparePixels({ frames, centres, clip, edge }) {
  async function decode(png) {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
  }
  const images = await Promise.all(frames.map(decode));
  function delta(a, b, i) {
    return Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]));
  }
  function rows(a, b, threshold) {
    let first = Infinity, last = -Infinity;
    for (let i = 0; i < a.data.length; i += 4) {
      if (delta(a, b, i) <= threshold) continue;
      const y = Math.floor(i / 4 / a.width);
      first = Math.min(first, y);
      last = y;
    }
    if (!Number.isFinite(last)) throw Error('Missing legend, lamp or bezel in screenshot');
    return { first, last };
  }

  // The two images for a released key differ only by its lens. On a
  // latched key the same two images are taken after hiding the letter ink.
  const [withGlass, withoutGlass] = images.length === 2 ? images : images.slice(1, 3);
  const visible = centres.filter(([x, y]) => {
    const i = 4 * ((Math.floor(y) - clip.y) * withGlass.width + Math.floor(x) - clip.x);
    return delta(withGlass, withoutGlass, i) > 48;
  }).length;
  if (images.length === 2) return { visible };
  const [full, noInk, noLens, bare] = images;
  const ink = rows(full, noInk, 12), lamp = rows(noInk, noLens, 32), assembly = rows(noInk, bare, 32);
  return { visible, inkClear: lamp.first - ink.last - 1, paintedClear: edge - clip.y - assembly.last - 1 };
}

let failures = 0;
function report(ok, message) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok' : 'FAIL'} ${message}`);
}
async function check(page, { name, path, selector, legend }, theme, width) {
  await page.goto(base + path + (path ? '?theme=' + theme : ''));
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const settle = () => page.waitForFunction(() => document.documentElement.dataset.ready === '1' &&
    window.vx?.stage && !window.vx.stage.awake.size);
  const capture = async clip => (await page.screenshot({ clip })).toString('base64');
  const prefix = `${width} ${theme} ${name}`;
  if (name === 'follow') {
    await settle();
    const { centres, names, solidClear, inactiveLit } = await control.evaluate(geometry, name);
    const box = await control.boundingBox();
    const clip = { x: Math.floor(box.x - 12), y: Math.floor(box.y - 12),
      width: Math.ceil(box.width + 24), height: Math.ceil(box.height + 24) };
    const full = await capture(clip);
    await control.evaluate(removeParts, [names[0]]);
    const bare = await capture(clip);
    const { visible } = await page.evaluate(comparePixels, { frames: [full, bare], centres, clip });
    report(visible === 0 && inactiveLit === 0 && solidClear >= 0,
      `${prefix} released: ${visible}/${centres.length} lens cells visible, ${inactiveLit} emit, ${solidClear} px inside bezel`);
    await control.evaluate(el => window.vx.live(el).rebuild());
    await control.click();
  }
  await page.mouse.move(0, 0);
  await settle();
  const label = control.locator(legend);
  const box = await label.boundingBox();
  const clip = { x: Math.max(0, Math.floor(box.x - 16)), y: Math.floor(box.y - 16),
    width: Math.ceil(box.width + 32), height: Math.ceil(box.height + 62) };
  const { lowerEdge, solidClear, names, centres, inactiveCells, inactiveLit } = await control.evaluate(geometry, name);
  const full = await capture(clip);
  await label.evaluate(node => { node.style.visibility = 'hidden'; });
  const noInk = await capture(clip);
  await control.evaluate(removeParts, [names[0]]);
  const noLens = await capture(clip);
  await control.evaluate(removeParts, names);
  const bare = await capture(clip);
  const { visible, inkClear, paintedClear } = await page.evaluate(comparePixels, {
    frames: [full, noInk, noLens, bare], centres, clip, edge: lowerEdge,
  });
  const ok = inactiveLit === 0 && visible > 0 && visible === centres.length &&
    inkClear >= 4 && paintedClear >= 0 && solidClear >= 0;
  report(ok, `${prefix}: ${inkClear} px under lettering, ${paintedClear} px inside painted bezel, ` +
    `${solidClear} px inside in geometry, ${visible}/${centres.length} lens cells visible, ${inactiveLit}/${inactiveCells} inactive cells emit`);
}

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu', '--enable-gpu'] });
try {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
    for (const control of controls) await check(page, control, theme, width);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exitCode = failures ? 1 : 0;
