// PORT=61442 node tools/lamp-key.mjs (optionally CAPTURES=/tmp/keys).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:' + (process.env.PORT || 5989) + '/kit/showcase/';
const captures = process.env.CAPTURES;
if (captures) await mkdir(captures, { recursive: true });
const browser = await chromium.launch({
  args: [
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader']),
  ],
});

async function geometry(key) {
  return key.evaluate((el) => {
    const live = window.vx.live(el);
    const { cap, stem, guide, pilot, emitter, diffuser, plate, floor, walls } = live.model.byName;
    const cells = (part) =>
      Array.from(part.cells.keys(), (k) => [(k >>> 21) - 1024, ((k >>> 8) & 8191) - 4096, (k & 255) - 128]);
    const body = cells(cap);
    const [x0, y0, x1, y1] = live.well;
    const widths = new Map();
    for (const [x, , z] of body) {
      if (!widths.has(z)) widths.set(z, new Set());
      widths.get(z).add(x);
    }
    const rows = Array.from(widths, ([z, cols]) => [z, cols.size]).sort((a, b) => a[0] - b[0]);
    const zAt = (x) =>
      Math.max(
        ...body.filter((cell) => cell[0] === x && cell[1] === Math.floor(live.H / 2)).map((cell) => cell[2]),
      );
    const heights = Array.from({ length: x1 - x0 }, (_, i) => zAt(i + x0));
    // Trace the cabinet view from each diffuser cell to the eye. Occlusion is
    // a consequence of cell locations and the cap transform at this instant.
    const exposed = cells(diffuser).filter(([x, y, z]) => {
      for (let d = 0.01; d < 24; d += 0.125) {
        const xx = Math.floor(x + 0.5 - d / 2),
          yy = Math.floor(y + 0.5 - d / 2),
          zz = z + 1 + d;
        if (cap.has(xx, yy, Math.floor(zz - cap.tz)) || plate.has(xx, yy, Math.floor(zz))) return false;
      }
      return true;
    }).length;
    const carrierFits = [emitter, diffuser].every(part => cells(part).every(([x, y, z]) => {
      for (let xx = x + 1; xx <= x1; xx++) if (!walls.has(xx, y, z)) return false;
      return true;
    }));
    const bore = cells(guide).map(cell => cell[2]);
    const shaft = cells(stem);
    const stemBottom = Math.min(...shaft.map(cell => cell[2])) + stem.tz;
    const guided = stem.tz === cap.tz && stemBottom > Math.min(...bore) && stemBottom <= Math.max(...bore) &&
      shaft.every(([x, y, z]) => !guide.has(x, y, z + stem.tz) && !floor.has(x, y, z + stem.tz));
    const fixed = [plate, walls, floor, guide, emitter, diffuser].map((p) => [p.tx, p.ty, p.tz, ...p.cells.keys()]);
    const fitting = [emitter, diffuser, pilot].map((p) => [...p.col.slice(0, 4)]);
    const bottom = Math.min(...body.map((cell) => cell[2])) + cap.tz;
    return {
      backend: live.stage.renderer.ownsCanvas ? 'webgpu' : 'webgl2',
      fixed,
      fitting,
      bottom,
      travel: live.model.keyTravel,
      tz: cap.tz,
      pilotZ: pilot.tz,
      exposed,
      guided, carrierFits,
      skirtFits: body.every(([x, y]) => x >= x0 && x < x1 && y >= y0 && y < y1),
      plateIsOpen: !plate.has(x0, y0, 0) && plate.has(x0 - 1, y0, 0) && plate.has(x1, y0, 0),
      wallDepth: Math.min(...cells(walls).map((c) => c[2])),
      floorZ: cells(floor)[0][2],
      footWidth: rows[0][1],
      shoulderWidth: rows.at(-2)[1],
      dish: Math.max(...heights) - heights[Math.floor(heights.length / 2)],
      cells: body.length,
    };
  });
}

async function exercise(backend) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (backend === 'webgl2')
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  if (backend === 'plain') await page.addInitScript(() => localStorage.setItem('vx-plain', '1'));
  await page.addInitScript(() => {
    window.recordedStrokes = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.recordedStrokes.push(this.buffer.duration);
      return start.apply(this, args);
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    window.decoded = 0;
    BaseAudioContext.prototype.decodeAudioData = async function (...args) {
      const sample = await decode.apply(this, args);
      window.decoded++;
      return sample;
    };
  });
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.locator('#caps').selectOption('linen');
  const key = page.getByRole('button', { name: 'Tide', exact: true });
  const shot = (name) =>
    key.screenshot({ ...(captures && { path: join(captures, backend + '-' + name + '.png') }) });
  try {
    if (backend !== 'plain') {
      await key.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => !window.vx.live(document.querySelector('[data-lamp=tide]')).dirty);
      const settle = () =>
        page.waitForFunction(() => {
          const l = window.vx.live(document.querySelector('[data-lamp=tide]'));
          return !l.spring('press').moving && !l.dirty;
        });
      const rest = await geometry(key);
      assert.equal(rest.backend, backend);
      assert.ok(rest.plateIsOpen && rest.skirtFits && rest.shoulderWidth < rest.footWidth && rest.dish >= 1);
      assert(rest.carrierFits && rest.guided, 'the LED must connect to the liner and the stem must engage the guide');
      assert.equal(rest.bottom, 0);
      const off = await shot('rest');
      const box = await key.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await settle();
      const held = await geometry(key);
      assert.equal(held.bottom, -rest.travel);
      assert(held.guided && held.carrierFits, 'the stem must clear the housing at bottom-out');
      assert.ok(held.floorZ < held.wallDepth && held.wallDepth < held.bottom);
      assert.deepEqual(held.fixed, rest.fixed);
      assert.deepEqual(held.fitting, rest.fitting);
      assert.equal(held.tz, held.pilotZ);
      assert.ok(held.exposed > rest.exposed, 'fixed diffuser must physically emerge as the skirt seats');
      assert.notDeepEqual(await shot('held'), off);
      await page.mouse.up();
      await settle();
      const lit = await geometry(key);
      assert.equal(lit.tz, 0);
      assert.deepEqual(lit.fixed, rest.fixed);
      assert.ok(lit.fitting.every((lens) => lens[3] > 0));
      assert.notDeepEqual(await shot('lit'), off);
      await key.focus();
      await page.keyboard.down('Space');
      await settle();
      const repeat = await geometry(key);
      assert.equal(repeat.tz, held.tz);
      assert.deepEqual(repeat.fitting, lit.fitting);
      await page.keyboard.up('Space');
      await settle();
      assert.equal((await geometry(key)).tz, 0);
      console.log(
        backend,
        rest.cells,
        'cap cells;',
        held.bottom,
        'held z;',
        rest.exposed,
        'to',
        held.exposed,
        'exposed diffuser cells',
      );
    } else {
      assert.equal(await key.locator('canvas').count(), 0);
      await key.press('Space');
      assert.equal(await key.getAttribute('aria-pressed'), 'true');
      assert.equal(await key.evaluate((el) => getComputedStyle(el).transform), 'none');
      await key.press('Space');
      assert.equal(await page.locator('[data-lamp][aria-pressed=true]').count(), 1);
      await shot('lit');
    }
    await page.locator('#sound').check();
    await page.waitForFunction(() => window.decoded === 2);
    await key.press('Space');
    const strokes = await page.evaluate(() => window.recordedStrokes.slice(-2));
    assert.equal(strokes.length, 2);
    assert.notEqual(strokes[0], strokes[1], 'the selected key plays both distinct recorded strokes');
    if (backend !== 'plain') {
      await page.locator('#caps').selectOption('opal');
      await page.locator('[name=profile][value=low]').check();
      await key.evaluate((el) => window.vx.live(el).draw());
      const low = await geometry(key);
      assert.ok(low.travel > 0 && low.travel < 9);
      const gain = page.getByRole('slider', { name: 'Lamp brightness' });
      const before = await key.evaluate((el) => [...window.vx.live(el).model.byName.cap.col]);
      await gain.press('Home');
      await page.waitForFunction(() => {
        const { pilot, emitter } = window.vx.live(document.querySelector('[data-lamp=tide]')).model.byName;
        return pilot.col[3] > 0 && emitter.col[3] === 0;
      });
      await page.getByRole('button', { name: 'Amber', exact: true }).click();
      const optics = await key.evaluate((el, before) => {
        const l = window.vx.live(el),
          { cap, pilot } = l.model.byName;
        const near = [],
          far = [];
        for (let i = 0; i < cap.count; i++) {
          const [x, y, z] = cap.rest.subarray(i * 3, i * 3 + 3);
          if (Math.abs(y - pilot.rest[1]) < 3 && Math.abs(x - pilot.rest[0]) < 4 && z >= pilot.rest[2] - 1)
            near.push(i);
          if (x < l.W / 2 && y > 0.75 * l.H) far.push(i);
        }
        l.draw();
        const diff = (indices) => Math.max(...indices.map((i) => Math.abs(before[i * 4] - cap.col[i * 4])));
        return { transmission: -1 - before[3], near: diff(near), far: diff(far), off: pilot.col[3] };
      }, before);
      assert.ok(
        optics.transmission > 0 && optics.near > 0.01 && optics.far === 0 && optics.off === 0,
        JSON.stringify(optics),
      );
    }
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const layout = await page.locator('.keybed button').evaluateAll((keys) =>
        keys.map((el) => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        }),
      );
      assert.ok(
        layout.every(([x, y, w, h]) => x >= 0 && x + w <= width && y === layout[0][1] && w >= 44 && h >= 44),
      );
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, {
        timeout: 3000,
      });
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

try {
  for (const backend of ['webgpu', 'webgl2', 'plain']) await exercise(backend);
} finally {
  await browser.close();
}
