// From engine/kit, with tools/serve.mjs running on the same PORT:
//   PORT=5989 node tools/physical-specimens.mjs
//   PORT=5989 node tools/physical-specimens.mjs --audit
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { assertNativeVoxels, inspectNativeVoxels } from './native-voxels.mjs';

const base = new URL(`http://127.0.0.1:${process.env.PORT || 5989}/kit/showcase/`);
const browser = await chromium.launch({
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader'])],
});
const pageOptions = { viewport: { width: 1180, height: 900 }, reducedMotion: 'reduce' };

async function open(page, path) {
  const response = await page.goto(new URL(path, base).href);
  if (!response?.ok()) throw new Error(`HTTP ${response?.status()} loading ${path}`);
}

async function specimens(plain) {
  const page = await browser.newPage(pageOptions);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    if (plain) await page.addInitScript(() => localStorage.setItem('vx-plain', '1'));
    await open(page, './');
    await page.waitForSelector('html[data-ready]');
    await assertNativeVoxels(page.locator('.vx-slider:has(#contour)'), { plain });
    await assertNativeVoxels(page.locator('.vx-rotary:has(#gain)'), { plain });
    await assertNativeVoxels(page.getByRole('button', { name: 'Scan field' }), { plain });
    await assertNativeVoxels(page.getByRole('combobox', { name: 'Keycaps' }), { plain: true });
    await page.getByRole('slider', { name: 'Contour' }).press('End');
    assert.equal(await page.locator('#contour-out').textContent(), '09');
    await page.getByRole('slider', { name: 'Lamp brightness' }).press('Home');
    assert.equal(await page.locator('#gain-out').textContent(), '00');
    await page.getByRole('button', { name: 'Scan field' }).press('Enter');
    assert.equal(await page.locator('#sweep').textContent(), 'FIELD SCOPE / 02');

    await open(page, 'parts/checkbox.html');
    await page.waitForSelector('html[data-ready]');
    const latch = page.getByRole('checkbox', { name: 'Post to the team channel' });
    await latch.press('Space');
    assert.equal(await latch.isChecked(), true);
    await assertNativeVoxels(page.locator('label:has(#post) .vx-box'), { plain });

    if (!plain) {
      // A real kit instance and canvas still need geometry.
      await page.evaluate(async () => {
        const { adopt, define } = await import('/kit/src/index.js');
        define({ name: 'empty-specimen', selector: '#empty-specimen', build(live, model) { model.part('empty'); } });
        const el = document.createElement('button');
        el.id = 'empty-specimen';
        document.body.append(el);
        adopt(el);
      });
      await assert.rejects(assertNativeVoxels(page.locator('#empty-specimen')), {
        code: 'ERR_ASSERTION', message: /no populated voxel parts/,
      });
      console.log('PASS shared stage rejects an empty voxel model');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${plain ? 'plain' : 'voxel'} fader, dial, action key and latch, plus DOM keycap picker`);
  } finally {
    await page.close();
  }
}

// Audit the authored drawing hosts for physical controls and their fittings.
// Start from markup so a missing adoption is visible. Behavior-only wrappers
// such as the multiselect toolbar and the native controls beneath hosts are omitted.
// Navigation marks and calendar fittings only draw in states that call for them.
const current = 'a[aria-current]:not([aria-current="false"])';
const families = [
  '.vx-button:not([data-lamp])', '.vx-button[data-lamp]', '.vx-toggle-button',
  '.vx-switch', '.vx-slider', '.vx-rotary', '.vx-box', '.vx-dot', '.vx-well', '.vx-select',
  '.vx-tabs', '.vx-toggle-group:not([role="toolbar"])', '.vx-theme-lamp', '.vx-otp-cell',
  `.vx-nav:is([data-vx-mark="seats"], [data-vx-mark="groove"]:has(${current}))`,
  `.vx-navigation-menu:has(${current})`, '.vx-menubar:has([aria-expanded="true"])',
  '.vx-list-group', '.vx-pagination-pages',
  '.vx-menu', '.vx-navigation-menu-float', '.vx-combobox-float', '.vx-command',
  '.vx-calendar-week:has([data-vx-mark], [aria-current="date"])',
  '.vx-carousel-lamps', '.vx-resizable-groove', '.vx-scroll-bar',
  '.vx-attachment-tile', '.vx-kbd',
];

async function audit() {
  // The renderer seam intentionally releases a control and can install test renderers.
  const files = (await readdir(new URL('../showcase/', import.meta.url), { recursive: true }))
    .filter(file => file.endsWith('.html') && file !== 'seam.html').sort();
  let checked = 0, pages = 0, violations = 0, harnessErrors = 0;
  const seenFamilies = new Set();
  for (const file of files) {
    const page = await browser.newPage(pageOptions);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await open(page, file);
      const hosts = page.locator(`:is(${families.join(',')}):not([data-plain], [data-plain] *):visible`);
      await page.waitForSelector('html[data-ready]', { timeout: 10000 });
      await page.evaluate(async () => {
        const { ready } = await import('/kit/src/index.js');
        await ready();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const matches = await inspectNativeVoxels(hosts, { families });
      if (errors.length) throw new Error(errors.join(' | '));
      if (matches.length) pages++;
      checked += matches.length;
      for (const [index, { family, id, problem }] of matches.entries()) {
        seenFamilies.add(family);
        if (!problem) continue;
        violations++;
        console.log(`FAIL ${file} ${id ? '#' + id : family} (host ${index + 1}): ${problem}`);
      }
    } catch (error) {
      harnessErrors++;
      console.log(`HARNESS ${file}: ${error.message}`);
    } finally {
      await page.close();
    }
  }
  assert.ok(checked, 'no physical controls found in the showcase');
  console.log(`Audit: ${checked} hosts in ${seenFamilies.size} families on ${pages}/${files.length} pages, ${violations} violations, ${harnessErrors} harness errors`);
  process.exitCode = harnessErrors ? 2 : violations ? 1 : 0;
}

try {
  if (process.argv.includes('--audit')) await audit();
  else for (const plain of [false, true]) await specimens(plain);
} finally {
  await browser.close();
}
