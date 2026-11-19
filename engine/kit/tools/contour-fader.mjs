// PORT=5989 node tools/contour-fader.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist',
  '--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
try {
  for (const backend of ['webgpu', 'webgl2', 'plain']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (backend === 'webgl2') await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    if (backend === 'plain') await page.addInitScript(() => localStorage.setItem('vx-plain', '1'));
    await page.goto('http://127.0.0.1:' + (process.env.PORT || 5989) + '/kit/showcase/index.html');
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    assert.equal(await page.evaluate(() => window.vx.stage?.renderer.ownsCanvas ? 'webgpu' : window.vx.stage ? 'webgl2' : 'plain'), backend);
    const fader = page.getByRole('slider', { name: 'Contour', exact: true });
    const rect = await fader.boundingBox();
    assert.equal(rect.height, 44);
    const y = rect.y + rect.height / 2;
    const assertValue = async value => {
      assert.equal(await fader.inputValue(), String(value));
      assert.equal(await page.locator('#contour-out').textContent(), String(value).padStart(2, '0'));
    };
    await fader.press('Home');
    const firstTrace = await page.locator('#scope').evaluate(el => el.toDataURL());
    await page.mouse.move(rect.x + 19, y);
    await page.mouse.down();
    for (let value = 1; value <= 9; value++) {
      const center = rect.x + 19 + (rect.width - 38) * (value - 1) / 8;
      await page.mouse.move(center, y);
      await assertValue(value);
      if (backend === 'plain') continue;
      // Read the drawn pose, including the projected stripe and the cells at
      // the moving joint. Both ends of the runner must meet a real wall.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const joint = await fader.evaluate(input => {
        const host = input.parentElement, live = window.vx.live(host);
        const { thumb, guide, walls } = live.model.byName;
        const [left, top, right] = live.well;
        const x = thumb.tx, y = top + 2;
        return {
          stripe: host.getBoundingClientRect().left + live.base + live.ox / devicePixelRatio + (x + 1.5 + 4 / 2) * live.vx,
          onGuide: thumb.has(0, y, -1) && guide.has(x, y, -2),
          leftContact: x === left && walls.has(x - 1, y, -1),
          rightContact: x + 3 === right && thumb.has(2, y, -1) && walls.has(x + 3, y, -1),
        };
      });
      assert.ok(Math.abs(joint.stripe - center) < 2, JSON.stringify(joint));
      assert.ok(joint.onGuide);
      assert.equal(joint.leftContact, value === 1);
      assert.equal(joint.rightContact, value === 9);
    }
    await page.mouse.move(rect.x + rect.width + 30, y);
    await page.mouse.up();
    await assertValue(9);
    assert.notEqual(await page.locator('#scope').evaluate(el => el.toDataURL()), firstTrace);
    // A touch can acquire the control near the outside of its hit area.
    await page.touchscreen.tap(rect.x + rect.width / 2, y + 18);
    await assertValue(5);
    await fader.evaluate(el => { el.parentElement.dir = 'rtl'; });
    await fader.press('Home');
    await page.touchscreen.tap(rect.x + 19, y);
    await assertValue(9);
    await page.locator('input[name="shell"][value="clear"]').check();
    await assertValue(9);
    assert.deepEqual(errors, []);
    console.log(backend + ': nine positions, stops, readout, touch, RTL and clear enclosure passed');
    await page.close();
  }
} finally {
  await browser.close();
}
