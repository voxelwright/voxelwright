// With the showcase server running: PORT=5989 node tools/lamp-dial.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader'])] });
const url = 'http://127.0.0.1:' + (process.env.PORT || 5989) + '/kit/showcase/index.html';

async function exercise(backend) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  try {
    if (backend === 'webgl2') await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    if (backend === 'plain') await page.addInitScript(() => localStorage.setItem('vx-plain', '1'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForSelector('html[data-ready]');
    const slider = page.getByRole('slider', { name: 'Lamp brightness', exact: true });
    const box = await slider.boundingBox();
    assert(box.width >= 44 && box.height >= 44);
    await slider.press('Home');
    for (let stop = 0; stop <= 10; stop++) {
      if (stop) await slider.press('ArrowUp');
      assert.equal(await slider.getAttribute('aria-valuetext'), stop * 10 + '%');
      assert.equal(await page.locator('#gain-out').textContent(), stop * 10 + '%');
      const result = await slider.evaluate(async input => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const host = input.parentElement;
        const live = window.vx.live(host);
        const drum = live?.model.byName.drum;
        return {
          backend: live ? live.stage.renderer.ownsCanvas ? 'webgpu' : 'webgl2' : 'plain',
          angle: drum?.axle.angle ?? parseFloat(host.style.getPropertyValue('--angle')),
          cast: drum ? drum.cells.size > 0 && live.model.byName.collar.cells.size > 0 : null,
          opacity: Number(getComputedStyle(document.querySelector('.case-light > i')).opacity),
        };
      });
      assert.equal(result.backend, backend);
      if (backend !== 'plain') assert(result.cast);
      assert(Math.abs(result.angle - (stop / 10 - .5) * 1.5 * Math.PI) < .00001);
      assert(Math.abs(result.opacity - .76 * stop / 10) < .00001);
    }
    // Rotate counterclockwise through two detents, then hold and release.
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const radius = box.width * .37;
    await page.mouse.move(cx + radius, cy);
    await page.mouse.down();
    const arc = Math.PI * .3;
    await page.mouse.move(cx + radius * Math.cos(arc), cy - radius * Math.sin(arc), { steps: 8 });
    assert.equal(await slider.inputValue(), '8');
    await page.mouse.up();
    assert.equal(await slider.inputValue(), '8');
    await page.reload();
    await page.waitForSelector('html[data-ready]');
    assert.equal(await slider.getAttribute('aria-valuetext'), '80%');
    assert.deepEqual(errors, []);
    console.log(backend + ' passed all eleven scale positions, case-light output, captured drag and restored value.');
  } finally { await page.close(); }
}

try {
  for (const backend of ['webgpu', 'webgl2', 'plain']) await exercise(backend);
} finally { await browser.close(); }
