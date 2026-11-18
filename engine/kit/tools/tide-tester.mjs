// From engine/kit, run PORT=5989 node tools/tide-tester.mjs against the showcase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = new URL(`http://127.0.0.1:${process.env.PORT || 5989}/kit/showcase/`);
const browser = await chromium.launch({
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader'])],
});
try {
  for (const plain of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    if (plain) await page.addInitScript(() => localStorage.setItem('vx-plain', '1'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base.href);
    await page.getByRole('combobox', { name: 'Keycaps' }).selectOption('carbon');
    await page.getByRole('button', { name: 'Lilac', exact: true }).click();
    await page.getByRole('link', { name: /Inspect Tide/ }).click();
    await page.waitForSelector('html[data-ready]');
    const key = page.getByRole('button', { name: 'Tide', exact: true });
    assert.equal(await page.locator('#caps').inputValue(), 'carbon');
    assert.equal(await key.getAttribute('aria-pressed'), 'false');
    await page.locator('#caps').selectOption('opal');
    const usesVoxels = await key.evaluate(async el => {
      const kit = await import('../src/index.js');
      const { Model, Part } = await import('../src/core/model.js');
      const instance = kit.live(el);
      if (!instance) return false;
      return instance.stage === kit.getStage() &&
        instance.model instanceof Model &&
        instance.model.parts.every(part => part instanceof Part) &&
        instance.model.parts.some(part => part.cells.size > 0 && part.count > 0) &&
        el.querySelectorAll('canvas').length === 1 &&
        el.querySelector('canvas') === instance.canvas;
    });
    assert.equal(usesVoxels, !plain, 'the enhanced key must be drawn by the shared voxel stage');
    const depths = () => key.evaluate(async el => {
      const { live } = await import('../src/index.js');
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      return Object.fromEntries(live(el).model.parts.map(part => [part.name, part.tz]));
    });
    await key.focus();
    const rest = plain ? null : await depths();
    await page.keyboard.down('Space');
    assert.equal(await key.getAttribute('aria-pressed'), 'false');
    const pressed = plain ? null : await depths();
    await page.keyboard.up('Space');
    assert.equal(await key.getAttribute('aria-pressed'), 'true');
    if (rest) {
      const moving = Object.keys(rest).filter(name => pressed[name] < rest[name] - .5);
      assert(moving.length > 0, 'holding the switch must lower actual model parts');
      const released = await depths();
      for (const name of moving) assert(Math.abs(released[name] - rest[name]) < .1, name + ' must return with the lamp still lit');
    }
    await key.evaluate(el => el.setAttribute('aria-disabled', 'true'));
    await page.keyboard.press('Enter');
    assert.equal(await key.getAttribute('aria-pressed'), 'true');
    await key.evaluate(el => el.removeAttribute('aria-disabled'));
    const dimmer = page.getByRole('slider', { name: 'Lamp brightness' });
    await dimmer.press('End');
    assert.equal(await page.locator('#level-out').textContent(), '100%');
    await dimmer.press('Home');
    assert.equal(await page.locator('#level-out').textContent(), '0%');
    await page.getByRole('link', { name: 'Back to Signal Desk' }).click();
    await page.waitForSelector('html[data-ready]');
    assert.equal(await page.locator('#caps').inputValue(), 'carbon');
    assert.equal(await page.getByRole('button', { name: 'Lilac', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(plain ? 'PASS plain Tide tester and saved desk build' : 'PASS native voxel Tide tester and saved desk build');
  }
} finally {
  await browser.close();
}
