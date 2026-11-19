// From engine/kit, run PORT=5989 node tools/tide-tester.mjs against the showcase.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { assertNativeVoxels } from './native-voxels.mjs';

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
    await assertNativeVoxels(key, { plain });
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
    await page.keyboard.down('Enter');
    assert.equal(await key.getAttribute('aria-pressed'), 'false');
    await page.keyboard.down('Enter');
    assert.equal(await key.getAttribute('aria-pressed'), 'false', 'holding Enter switches the lamp once');
    await page.keyboard.up('Enter');
    await page.keyboard.press('Enter');
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
    if (plain) {
      await page.locator('#caps').selectOption('opal');
      const capPaint = () => key.evaluate(el => {
        const cap = getComputedStyle(el, '::before');
        return [cap.backgroundColor, cap.backgroundImage, cap.borderBottomColor, cap.borderBottomWidth, cap.boxShadow];
      });
      const unlit = await capPaint();
      await page.getByRole('button', { name: 'Amber' }).click();
      assert.deepEqual(await capPaint(), unlit, 'an unpowered opal key must keep its resin color');
      await key.click();
      const poweredOpal = (await capPaint())[1];
      assert.notEqual(poweredOpal, unlit[1]);
      const bank = page.locator('#lamp-bank');
      await bank.evaluate(el => el.dataset.caps = 'carbon');
      const carbon = await key.screenshot();
      const bare = await page.addStyleTag({ content: '#lamp-bank .vx-button[data-lamp]::before {background-image:none !important}' });
      assert.deepEqual(await key.screenshot(), carbon, 'the opaque key must look exactly like bare resin');
      await bare.evaluate(el => el.remove());
      await bank.evaluate(el => el.dataset.caps = 'field');
      assert((await capPaint())[1].includes('155%'), 'the nearest field finish supplies its own printed artwork');
      await bank.evaluate(el => delete el.dataset.caps);
      assert.equal((await capPaint())[1], poweredOpal);
      await page.getByRole('radio', { name: 'Low', exact: true }).check();
      const low = await capPaint();
      await page.getByRole('radio', { name: 'Sculpted', exact: true }).check();
      assert(parseFloat((await capPaint())[3]) > parseFloat(low[3]));
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(plain ? 'PASS plain Tide tester and saved desk build' : 'PASS native voxel Tide tester and saved desk build');
  }
} finally {
  await browser.close();
}
