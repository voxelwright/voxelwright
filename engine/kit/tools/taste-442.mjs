// From engine/kit: PORT=5989 node tools/taste-442.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = new URL(`http://127.0.0.1:${process.env.PORT || 5989}/kit/showcase/`);
const browser = await chromium.launch({
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader'])],
}).catch(error => {
  console.error(`HARNESS browser launch: ${error.message}`);
  process.exit(2);
});

let failures = 0, errors = 0;
async function check(name, part, test, { reduced = false, init, liveSelector } = {}) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 },
    reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(5000);
  try {
    if (init) await page.addInitScript(init);
    const response = await page.goto(new URL(`parts/${part}.html?theme=light`, base).href);
    if (!response?.ok()) throw new Error(`HTTP ${response?.status()} loading ${part}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.vx?.stage);
    await page.evaluate(() => document.fonts.ready);
    if (liveSelector) await page.locator(`${liveSelector}[data-vx-live]`).first().waitFor({ state: 'attached' });
    const detail = await test(page);
    if (pageErrors.length) throw new Error(pageErrors.join(' | '));
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    const violation = error instanceof assert.AssertionError && !pageErrors.length;
    if (violation) failures++; else errors++;
    const message = error.message.split('\n\n')[0];
    console.log(`${violation ? 'FAIL' : 'HARNESS'} ${name} — ${pageErrors.join(' | ') || message}`);
  } finally {
    await context.close();
  }
}

const frame = page => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

// Run the kit's real renderer with its manual clock. Cancel the frame queued before switching clocks.
async function manual(page) {
  await page.evaluate(() => {
    const stage = window.vx.stage;
    stage.manual = true;
    cancelAnimationFrame(stage.raf);
    stage.raf = 0;
  });
}

const hardware = [
  { name: 'key', part: 'button-group', id: '#publish', host: '#publish', surface: 'cap', role: 'button', label: 'Publish' },
  { name: 'latch', part: 'checkbox', id: '#post', host: 'label:has(#post) .vx-box', surface: 'lit', role: 'checkbox',
    label: 'Post to the team channel' },
  { name: 'fader', part: 'slider', id: '#fine', host: '.vx-slider:has(#fine)', surface: 'thumb', role: 'slider', label: 'Half way' },
];

async function finishes(page, { name, id, host, surface, role, label }) {
  const control = page.getByRole(role, { name: label, exact: true });
  if (name === 'key') await control.evaluate(el => {
    el.addEventListener('click', event => {
      if (event.isTrusted) el.dataset.testClicks = String(Number(el.dataset.testClicks ?? 0) + 1);
    });
  });
  const state = () => page.$eval(id, el => el.type === 'checkbox' ? el.checked : el.value);
  const paint = () => page.$eval(host, (el, surface) => {
    const { col, ao } = window.vx.live(el).model.byName[surface];
    return { tint: [...col], finish: Array.from(ao, word => word >>> 16) };
  }, surface);
  const operate = async () => {
    if (name === 'key') {
      const clicks = Number(await control.getAttribute('data-test-clicks'));
      await control.press('Enter');
      assert.equal(Number(await control.getAttribute('data-test-clicks')), clicks + 1, 'Enter activates the key once');
      assert.equal(await page.locator('#said').textContent(), 'Published', 'the key still publishes');
    } else if (name === 'latch') {
      const checked = await state();
      await control.press('Space');
      assert.equal(await state(), !checked, 'Space changes the latch');
      await control.press('Space');
    } else {
      const value = Number(await state());
      await control.press('ArrowRight');
      assert.equal(Number(await state()), value + 1, 'ArrowRight advances the fader by one step');
    }
  };
  await operate();
  if (name === 'latch') await control.press('Space'); // preserve a non-default checked setting
  const presets = await page.evaluate(async () => {
    const { defineLook, LOOKS, theme } = await import('/kit/src/index.js');
    const extra = Object.keys(LOOKS).filter(name => !['default', 'lit'].includes(name) && LOOKS[name].finishes);
    const finishes = { ...LOOKS.lit.finishes };
    const materials = {};
    for (const name of ['enamel', 'steel', 'ivory', 'key', 'chalk']) {
      finishes[name] = { chamfer: 45, specular: 220 };
      materials[name] = { day: '#87594e', night: '#ba8f72' };
    }
    theme('bay');
    defineLook('taste-test', { from: 'lit', finishes, materials });
    return extra;
  });
  await control.focus();
  const before = await paint();
  for (const swap of ['rose', 'dusk', 'taste-test', ...presets]) {
    const value = await state();
    if (swap === 'rose' || swap === 'dusk') await page.evaluate(swap => window.vx.theme(swap), swap);
    else await page.$eval(host, async (el, swap) => {
      const { refresh } = await import('/kit/src/index.js');
      el.style.setProperty('--vx-look', swap);
      refresh(el);
    }, swap);
    await frame(page);
    assert.equal(await state(), value, `${swap} preserves the ${name} setting`);
    assert.equal(await control.count(), 1, `${swap} preserves the accessible name "${label}"`);
    assert.ok(await control.evaluate(el => el === document.activeElement), `${swap} preserves focus`);
    const after = await paint();
    if (swap === 'rose') assert.notDeepEqual(after.tint, before.tint, 'theme changes the live material tint');
    if (swap === 'taste-test') {
      assert.ok(after.finish.includes(45 | (220 << 8)) && !before.finish.includes(45 | (220 << 8)),
        'the requested chamfer and specular values reach the baked mesh');
    }
    await operate();
    await control.focus();
  }
  return `theme('rose'/'dusk'), defineLook({ materials, finishes })${presets.length ? `, presets: ${presets.join(', ')}` : ''}`;
}

async function lenses(page) {
  const snapshot = selector => page.$eval(selector, el => {
    const live = window.vx.live(el);
    const rows = [...el.querySelectorAll(':scope > li')];
    return rows.map(row => {
      const cells = [], emissions = [];
      for (const part of live.model.parts.filter(part => !part.hidden)) {
        for (let i = 0; i < part.count; i++) {
          const [x, y, z] = part.rest.subarray(i * 3, i * 3 + 3);
          const py = (y + part.ty) * live.vx;
          if (py < row.offsetTop || py >= row.offsetTop + row.offsetHeight) continue;
          if (part.scales?.[i] === 0) continue;
          cells.push([x + part.tx, y + part.ty, z + part.tz]);
          emissions.push(part.col[i * 4 + 3]);
        }
      }
      return { cells: cells.sort(), glow: Math.max(0, ...emissions) };
    });
  });
  const before = await snapshot('#sections');
  await page.getByRole('link', { name: 'Secrets', exact: true }).click();
  await frame(page);
  assert.equal(await page.locator('#pane-name').textContent(), 'Secrets');
  const after = await snapshot('#sections');
  const idle = await snapshot('#none');
  assert.ok([...before, ...after, ...idle].every(row => row.cells.length > 0),
    `every row keeps a fitting (before [${before.map(row => row.cells.length)}], after [${after.map(row => row.cells.length)}], no selection [${idle.map(row => row.cells.length)}])`);
  assert.deepEqual(after.map(row => row.cells), before.map(row => row.cells), 'selecting a row preserves fitting geometry');
  const lit = rows => rows.flatMap((row, i) => row.glow > 0 ? [i] : []);
  assert.deepEqual([lit(before), lit(after), lit(idle)], [[1], [2], []], 'only the selected fitting emits');
  return `${before.length} fittings stay put as the light moves`;
}

async function inlineKbd(page) {
  const caps = page.locator('.words kbd.vx-kbd');
  const geometry = await caps.evaluateAll(caps => caps.map(el => {
    const live = window.vx.live(el);
    let top = -Infinity;
    for (const part of live.model.parts.filter(part => !part.hidden)) {
      for (let i = 0; i < part.count; i++) top = Math.max(top, part.rest[i * 3 + 2] + part.tz + 0.5);
    }
    const inline = el.closest('kbd.vx-keys') ?? el;
    return { top, display: getComputedStyle(inline).display, tag: el.tagName, tab: el.tabIndex };
  }));
  assert.ok(geometry.length > 1 && geometry.every(g => g.tag === 'KBD' && g.display.startsWith('inline') && g.tab < 0),
    'shortcut caps stay native, inline and outside the tab order');
  await page.locator('p.words').first().evaluate(el => {
    for (const [id, side] of [['before-kbd', 'beforebegin'], ['after-kbd', 'afterend']]) {
      el.insertAdjacentHTML(side, `<button id="${id}">${id}</button>`);
    }
  });
  await page.locator('#before-kbd').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'after-kbd', 'Tab skips the inline shortcuts');
  assert.ok(geometry.every(g => g.top > 0), `caps must stand above support at z=0 (tops: ${geometry.map(g => g.top)})`);
  return `${geometry.length} inline caps above support, Tab skips all`;
}

function observeAudio() {
  const decode = BaseAudioContext.prototype.decodeAudioData;
  const start = AudioBufferSourceNode.prototype.start;
  const decoded = new WeakMap();
  window.switchAudio = { decoded: 0, played: [] };
  BaseAudioContext.prototype.decodeAudioData = async function (...args) {
    const buffer = await decode.apply(this, args);
    // A one-ms RMS envelope ignores isolated samples and accounts for the quieter release.
    const channel = buffer.getChannelData(0), width = Math.round(buffer.sampleRate / 1000), energy = [];
    for (let i = 0; i + width <= channel.length; i += width) {
      let sum = 0;
      for (let j = i; j < i + width; j++) sum += channel[j] ** 2;
      energy.push(Math.sqrt(sum / width));
    }
    const peak = Math.max(0, ...energy);
    decoded.set(buffer, { onset: peak > 0 ? energy.findIndex(rms => rms >= peak / 2) : -1,
      peak, duration: buffer.duration });
    window.switchAudio.decoded++;
    return buffer;
  };
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (decoded.has(this.buffer)) window.switchAudio.played.push(decoded.get(this.buffer));
    return start.apply(this, args);
  };
}

async function impacts(page) {
  await page.getByRole('checkbox', { name: 'Switch sound' }).check();
  await page.waitForFunction(() => window.switchAudio.decoded === 2);
  const played = () => page.evaluate(() => window.switchAudio.played);
  await page.locator('#draft').focus();
  await page.keyboard.down('Space');
  const down = await played();
  await page.keyboard.up('Space');
  const both = await played();
  assert.deepEqual([down.length, both.length], [1, 2], 'one decoded buffer starts on each stroke');
  assert.notDeepEqual(both[0], both[1], 'downstroke and return play distinct samples');
  const ms = both.map(cue => cue.onset);
  assert.ok(ms.every(onset => onset >= 0 && onset <= 12), `impact must arrive within 12 ms (press ${ms[0]} ms, release ${ms[1]} ms)`);
  return `press ${ms[0]} ms, release ${ms[1]} ms`;
}

const overlays = [
  { name: 'dialog', open: '#open-rename', host: '#rename', body: 'panel', event: 'close' },
  { name: 'toast', open: '#stay', host: '.vx-toasts > .vx-toast', body: 'body', event: 'vx-dismiss' },
];

async function openOverlay(page, spec) {
  await page.locator(spec.open).click();
  const target = page.locator(spec.host);
  await target.waitFor({ state: 'visible' });
  await page.waitForFunction(host => window.vx.live(document.querySelector(host))?.visible, spec.host);
  await target.evaluate((el, event) => {
    window.dismissals = 0;
    el.addEventListener(event, () => window.dismissals++);
  }, spec.event);
}

async function dismiss(page, spec) {
  if (spec.name === 'dialog') await page.keyboard.press('Escape');
  else {
    const box = await page.locator(spec.host).boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2);
  }
}

async function sample(page, { host, body }, phase = 0.5) {
  return page.evaluate(({ host, body, phase }) => {
    const live = window.vx.live(document.querySelector(host));
    const part = live?.model.byName[body];
    if (!part?.count || part.hidden || !part.fx) return null;
    const { end, t } = part.fx;
    window.vx.stage.advance(Math.max(0, end * phase - t));
    if (live.dirty) throw new Error('renderer did not draw the stepped overlay');
    let offset = 0;
    for (const other of live.model.parts) {
      if (other === part) break;
      if (!other.hidden) offset += other.count * 8;
    }

    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const cells = new Map(), translation = [part.tx, part.ty, part.tz];
    let travel = 0, scaleMin = 1, scaleMax = 0;
    for (let i = 0; i < part.count; i++) {
      const rest = [...part.rest.subarray(i * 3, i * 3 + 3)];
      const pose = live.pos.subarray(offset + i * 8, offset + (i + 1) * 8);
      const delta = rest.map((value, axis) => pose[axis] - value - translation[axis]);
      delta.forEach((d, axis) => { min[axis] = Math.min(min[axis], d); max[axis] = Math.max(max[axis], d); });
      const moved = Math.hypot(...delta, ...pose.subarray(4, 7));
      travel = Math.max(travel, moved);
      scaleMin = Math.min(scaleMin, pose[3]);
      scaleMax = Math.max(scaleMax, pose[3]);
      cells.set(rest.join(','), { rest, pose, moved });
    }
    // Moving neighbors in a brick keep their spacing and turn together.
    let joined = 0, movingPairs = 0;
    for (const { rest: [x, y, z], pose, moved } of cells.values()) {
      for (const key of [`${x + 1},${y},${z}`, `${x},${y + 1},${z}`, `${x},${y},${z + 1}`]) {
        const next = cells.get(key);
        if (!next || Math.max(moved, next.moved) < 0.1) continue;
        movingPairs++;
        const distance = Math.hypot(pose[0] - next.pose[0], pose[1] - next.pose[1], pose[2] - next.pose[2]);
        if (Math.abs(distance - 1) < 0.05 && pose.subarray(4).every((v, i) => Math.abs(v - next.pose[i + 4]) < 0.01)) joined++;
      }
    }
    return { spread: Math.max(...max.map((value, axis) => value - min[axis])), travel, joined, movingPairs,
      scaleMin, scaleMax, opacity: Number(getComputedStyle(live.canvas).opacity) };
  }, { host, body, phase });
}

const finishMotion = page => page.evaluate(() => {
  for (let i = 0; i < 60; i++) window.vx.stage.advance(1 / 60);
});

async function overlayMotion(page, spec, reduced) {
  await manual(page);
  await openOverlay(page, spec);
  const entering = await sample(page, spec);
  await finishMotion(page);
  await dismiss(page, spec);
  const exiting = await sample(page, spec);
  await finishMotion(page);
  const results = [entering, exiting].map((sample, i) => {
    const phase = i === 0 ? 'entry' : 'exit';
    if (!sample) return { ok: false, detail: `${phase}: no moving geometry at midpoint` };
    const { spread, travel, joined, movingPairs, scaleMin, scaleMax, opacity } = sample;
    const faded = (opacity > 0 && opacity < 1) || (scaleMin > 0 && scaleMax < 1 && scaleMax - scaleMin < 0.01);
    const ok = reduced ? travel < 0.01 && faded : spread > 0.35 && joined > movingPairs / 2;
    return { ok, detail: reduced
      ? `${phase} ${ok ? 'PASS' : 'FAIL'}: travel ${travel.toFixed(2)} voxels, alpha ${opacity}, scale ${scaleMax.toFixed(2)}`
      : `${phase} ${ok ? 'PASS' : 'FAIL'}: relative displacement ${spread.toFixed(2)} voxels, ${joined}/${movingPairs} moving neighbor pairs joined` };
  });
  const report = results.map(result => result.detail).join(' | ');
  assert.ok(results.every(result => result.ok), report);
  return report;
}

async function rapidDismiss(page, spec) {
  await manual(page);
  await openOverlay(page, spec);
  const start = await sample(page, spec, 0.2);
  await dismiss(page, spec);
  await dismiss(page, spec);
  await finishMotion(page);
  // A dialog's native close event is queued by the browser after close().
  await frame(page);
  assert.ok(start, 'dismissal was requested while entry was still active');
  assert.equal(await page.evaluate(() => window.dismissals), 1, 'rapid dismissal completes exactly once');
  assert.equal(await page.locator(spec.host).isVisible(), false, 'overlay is gone');
  if (spec.name === 'dialog') {
    assert.equal(await page.evaluate(() => document.activeElement.id), 'open-rename', 'focus returns to the opener');
  } else {
    assert.equal(await page.locator(spec.host).count(), 0, 'owned toast is detached');
  }
  await openOverlay(page, spec);
  await finishMotion(page);
  assert.ok(await page.locator(spec.host).isVisible(), 'overlay opens again cleanly');
  if (spec.name === 'dialog') {
    const continuous = await page.locator(spec.host).evaluate(async el => {
      const { stage, live: find } = window.vx, live = find(el);
      el.close();
      stage.advance(0.07);
      const progress = live.surface.progress, pose = live.pos.slice();
      el.showModal();
      await Promise.resolve();
      live.draw();
      return progress > 0 && progress < 1 && live.surface.progress === progress &&
        pose.length === live.pos.length && pose.every((value, i) => Math.abs(value - live.pos[i]) < 0.001);
    });
    assert.ok(continuous, 'the first reopened frame preserves the closing position and rotation of every block');
  }
}

try {
  for (const spec of hardware) {
    await check(`finish/theme ${spec.name}`, spec.part, page => finishes(page, spec), { liveSelector: spec.host });
  }
  await check('persistent unlit list fittings', 'list-group', lenses, { liveSelector: '#sections' });
  await check('raised inline Kbd without a focus stop', 'kbd', inlineKbd, { liveSelector: '.words .vx-kbd' });
  await check('decoded switch impact onset', 'button-group', impacts, { liveSelector: '#draft', init: observeAudio });
  for (const spec of overlays) {
    await check(`${spec.name} block geometry`, spec.name, page => overlayMotion(page, spec, false));
    await check(`${spec.name} reduced motion`, spec.name, page => overlayMotion(page, spec, true), { reduced: true });
    await check(`${spec.name} rapid dismissal`, spec.name, page => rapidDismiss(page, spec));
  }
} finally {
  await browser.close();
}
console.log(`${failures} rule failures, ${errors} harness error(s)`);
process.exitCode = errors ? 2 : failures ? 1 : 0;
