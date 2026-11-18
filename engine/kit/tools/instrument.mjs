// Run from engine/kit with the showcase server running.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const desk = new URL('/kit/showcase/', 'http://127.0.0.1:' + (process.env.PORT || 5989));
const browser = await chromium.launch({ args: ['--enable-gpu', '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function visit(path = '') {
  await page.goto(new URL(path, desk).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
}
// Sample the actual painted surface, including GPU-drawn material behind DOM text.
async function contrastAtText(locator) {
  await locator.scrollIntoViewIfNeeded();
  const { x, y, ink } = await locator.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el.firstChild);
    const box = range.getClientRects()[0];
    const ink = getComputedStyle(el).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    el.style.webkitTextFillColor = 'transparent';
    return { x: Math.floor(box.left + box.width / 2), y: Math.floor(box.top + box.height / 2), ink };
  });
  let patch;
  try { patch = await page.screenshot({ clip: { x, y, width: 1, height: 1 } }); }
  finally { await locator.evaluate(el => el.style.removeProperty('-webkit-text-fill-color')); }
  return page.evaluate(async ({ ink, image }) => {
    const bitmap = new Image();
    bitmap.src = 'data:image/png;base64,' + image;
    await bitmap.decode();
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    function luminance(rgb) {
      const [r, g, b] = Array.from(rgb).slice(0, 3).map(n => n / 255)
        .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
      return r * .2126 + g * .7152 + b * .0722;
    }
    const paper = luminance(ctx.getImageData(0, 0, 1, 1).data);
    const text = luminance(ink);
    return (Math.max(text, paper) + .05) / (Math.min(text, paper) + .05);
  }, { ink, image: patch.toString('base64') });
}
try {
  await visit();
  for (const shell of ['alloy', 'smoke']) {
    await page.locator('[name=shell][value=' + shell + ']').check();
    const ratio = await contrastAtText(page.locator('.sound > span:last-child'));
    assert(ratio >= 4.5, shell + ' switch sound contrast ' + ratio);
  }
  assert(await page.getByRole('link', { name: 'Design notes' }).isVisible());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const rail = page.locator('.case-light > i').first();
  const animation = () => rail.evaluate(el => getComputedStyle(el, '::before').animationName);
  await page.getByLabel('Spectrum').check();
  assert.equal(await animation(), 'travel-rail');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await animation(), 'none');
  const gain = page.getByRole('slider', { name: 'Lamp brightness' });
  await gain.press('Home');
  assert.equal(await rail.evaluate(el => getComputedStyle(el).opacity), '0');
  await gain.press('ArrowRight');
  assert.equal(await gain.inputValue(), '1');
  await visit('parts/toggle-button.html');
  assert.equal(await page.locator('html').getAttribute('data-rail'), 'spectrum');
  const result = await page.locator('#s-off').evaluate(async el => {
    const { fitInstrument, theme, THEMES, live } = await import('/kit/src/index.js');
    const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const emission = () => {
      const lens = live(el).model.parts.find(part => part.name.startsWith('lens'));
      return Math.max(...lens.col.filter((_, i) => i % 4 === 3));
    };
    const build = fitInstrument({ shell: 'smoke', lamp: 'amber' });
    await paint();
    const before = emission();
    fitInstrument({ ...build, lamp: 'lilac' });
    await paint();
    const after = emission();
    const cap = { day: '#532d67', night: '#825b95' };
    theme({ ...THEMES.rose, cap });
    fitInstrument({ ...build, profile: 'low' });
    return { before, after, enamel: live(el).look.materials.enamel, cap };
  });
  assert.equal(result.before, 0);
  assert.equal(result.after, 0);
  assert.deepEqual(result.enamel, result.cap);
  await visit('parts/bubble.html');
  const replyContrast = await contrastAtText(page.locator('#reply p'));
  assert(replyContrast >= 4.5, 'reading ink on the dark enclosure measured ' + replyContrast);
  await visit('principles.html');
  await page.getByRole('switch', { name: 'Voxels' }).press('Space');
  for (const path of ['', 'parts/', 'parts/slider.html']) {
    await visit(path);
    assert.equal(await page.locator('[data-vx-live]').count(), 0, path + ' respects Voxels off');
  }
  await visit('principles.html');
  await page.getByRole('switch', { name: 'Voxels' }).press('Space');
  await visit();
  assert(await page.locator('.vx-rotary[data-vx-live]').count());
  assert.deepEqual(errors, []);
  console.log('Passed dark enclosure contrast, phone navigation, spectrum and reduced motion, dimmer stops, closed lens, custom enamel and saved renderer choice.');
} finally {
  await browser.close();
}
