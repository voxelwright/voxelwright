// PORT=5985 node engine/kit/tools/ship-latch.mjs (kit showcase server running)
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
try {
  for (const backend of ['WebGPU', 'WebGL2', 'plain']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (backend === 'WebGL2') await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    if (backend === 'plain') await page.route('**/lab.html', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('<html lang', '<html data-vx-plain lang') });
    });
    await page.addInitScript(() => sessionStorage.setItem('vx-showcase-switch-sound', 'on'));
    await page.goto(`http://127.0.0.1:${process.env.PORT || 5985}/kit/showcase/lab.html`);
    await page.waitForFunction(() => window.vx);
    const latch = page.locator('.ship-latch');
    const input = page.getByRole('switch', { name: 'Ship when the tests pass', exact: true });
    await latch.scrollIntoViewIfNeeded();
    assert.equal(await input.isChecked(), true);
    assert.ok((await input.boundingBox()).height >= 44);

    if (backend !== 'plain') {
      await page.waitForFunction(() => window.vx.live(document.querySelector('.ship-latch'))?.capacity);
      assert.equal(await latch.evaluate(el => !!window.vx.live(el).stage.renderer.ownsCanvas), backend === 'WebGPU');
      const manual = () => latch.evaluate(el => {
        const stage = window.vx.live(el).stage;
        stage.manual = true;
        cancelAnimationFrame(stage.raf);
        stage.raf = 0;
      });
      const step = frames => latch.evaluate((el, frames) => {
        const live = window.vx.live(el);
        for (let i = 0; i < frames; i++) live.stage.advance(1 / 60);
        const { thumb, shoe, lens } = live.model.byName;
        return { x: thumb.tx, z: thumb.tz, shoe: shoe.tx, lit: lens.col[3] > 0, left: lens.rest[0] + lens.tx,
          cells: live.capacity };
      }, frames);
      await manual();
      const on = await step(1);
      assert.ok(on.lit && on.cells > 0);
      const box = await latch.boundingBox();
      await page.mouse.move(box.x + 20, box.y + 16);
      await page.mouse.down();
      const hold = await step(40);
      assert.equal(hold.z, -1);
      assert.equal(hold.x, on.x);
      await page.mouse.up();
      const mid = await step(3);
      assert.ok(mid.x < on.x && mid.x > on.x - 12);
      assert.equal(mid.shoe, mid.x);
      const off = await step(60);
      assert.equal(off.x, on.x - 12);
      assert.equal(off.z, 0);
      assert.equal(off.left, on.left);
      assert.equal(off.lit, false);
      // A system-cancelled touch must drop its hold and leave the checkbox alone.
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      await touch('touchStart', [{ x: box.x + 16, y: box.y + 16 }]);
      await touch('touchMove', [{ x: box.x + 32, y: box.y + 16 }]);
      assert.ok((await step(1)).x > off.x);
      await touch('touchCancel', []);
      assert.deepEqual(await step(60), off);
      assert.equal(await input.isChecked(), false);
      let changes = 0;
      await input.evaluate(el => el.addEventListener('change', () => { el.dataset.changes = String(Number(el.dataset.changes || 0) + 1); }));
      for (const [start, end, expected] of [[16, 44, true], [44, 16, false]]) {
        await touch('touchStart', [{ x: box.x + start, y: box.y + 16 }]);
        await touch('touchMove', [{ x: box.x + end, y: box.y + 16 }]);
        await touch('touchEnd', []);
        await step(60);
        assert.equal(await input.isChecked(), expected);
        assert.equal(await input.getAttribute('data-changes'), String(++changes));
      }
      await cdp.detach();
      // Pull part-way, return to the original detent, then throw it the full distance.
      const left = box.x + 16, centre = box.y + 16;
      await page.mouse.move(left, centre);
      await page.mouse.down();
      await page.mouse.move(left + 8, centre);
      assert.equal((await step(1)).x, off.x + 4);
      await page.mouse.up();
      assert.deepEqual(await step(60), off);
      assert.equal(await input.isChecked(), false);
      await page.mouse.move(left, centre);
      await page.mouse.down();
      await page.mouse.move(left + 24, centre);
      await page.mouse.up();
      assert.deepEqual(await step(60), on);
      assert.equal(await input.isChecked(), true);
      await input.press('Space');
      assert.deepEqual(await step(1), off);
      await input.press('Space');
      assert.deepEqual(await step(1), on);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await latch.tap();
      assert.deepEqual(await step(1), off);
      await input.evaluate(el => { el.checked = true; });
      assert.deepEqual(await step(1), on);
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
      assert.equal((await step(1)).x, 32 - 9 - on.x);
      console.log(`${backend}: ${on.cells} visible cells, thumb ${off.x} → ${on.x}, held z ${hold.z}, fixed lens`);
    } else {
      assert.equal(await latch.locator('canvas').count(), 0);
      const offset = () => latch.evaluate(el => getComputedStyle(el, '::after').transform);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const tray = () => latch.evaluate(el => getComputedStyle(el).backgroundColor);
      const on = await offset(), onTray = await tray();
      await latch.tap();
      assert.equal(await input.isChecked(), false);
      assert.notEqual(await offset(), on);
      assert.equal(await tray(), onTray);
      await input.press('Space');
      assert.equal(await offset(), on);
      const box = await latch.boundingBox();
      for (const [dx, checked] of [[-8, true], [-24, false]]) {
        await page.mouse.move(box.x + 40, box.y + 16);
        await page.mouse.down();
        await page.mouse.move(box.x + 40 + dx, box.y + 16);
        await page.mouse.up();
        assert.equal(await input.isChecked(), checked);
      }
      await page.emulateMedia({ forcedColors: 'active' });
      await input.focus();
      const off = await latch.screenshot();
      await input.press('Space');
      assert.ok(!off.equals(await latch.screenshot()));
      console.log('plain: touch, Space, near and far drag, distinguishable forced-color stops');
    }
    assert.equal(await page.getByRole('switch', { name: 'Hold every bloom for review' }).isChecked(), false);
    assert.equal(await page.getByRole('switch', { name: 'Let visitors water' }).isDisabled(), true);
    assert.ok(await page.evaluate(async () => (await import('/kit/src/core/sound.js')).sound()));
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
