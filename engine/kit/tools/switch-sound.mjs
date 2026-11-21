// Drive a real key and observe when decoded samples enter the browser's audio graph.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const port = process.env.PORT || 5989;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => {
    if (request.url().endsWith('.wav')) requests.push(request.url());
  });
  await page.addInitScript(() => {
    window.strokes = [];
    window.decoded = 0;
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (...args) {
      const buffer = await decode.apply(this, args);
      window.decoded++;
      return buffer;
    };
    const createFilter = BaseAudioContext.prototype.createBiquadFilter;
    BaseAudioContext.prototype.createBiquadFilter = function () {
      const filter = createFilter.call(this);
      (window.filters ??= []).push(filter);
      return filter;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.strokes.push(this.buffer.duration);
      return start.apply(this, args);
    };
  });
  await page.goto('http://127.0.0.1:' + port + '/kit/showcase/parts/button-group.html');
  const key = page.locator('#draft[data-vx-live]');
  await key.click();
  assert.equal(requests.length, 0);
  const sound = page.getByRole('checkbox', {name: 'Switch sound'});
  await sound.check();
  await page.waitForFunction(() => window.decoded === 2);
  await page.evaluate(async () => {
    const { fitInstrument } = await import('/kit/src/index.js');
    fitInstrument({ shell: 'alloy' });
  });
  await page.waitForFunction(() => window.filters?.some(f => f.type === 'highshelf' && f.gain.value > 1.9));
  await key.focus();
  await page.keyboard.down('Space');
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  const strokes = await page.evaluate(() => window.strokes);
  assert.equal(strokes.length, 2);
  assert.notEqual(strokes[0], strokes[1]);
  const tap = await key.evaluate(el => {
    const press = window.vx.live(el).spring('press');
    press.snap(0);
    const send = type => el.dispatchEvent(new PointerEvent(type, {pointerId: 8, button: 0}));
    send('pointerdown');
    el.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter'}));
    const held = press.target;
    send('pointercancel');
    return {held, released: press.target, position: press.x, samples: window.strokes.length};
  });
  assert.ok(tap.held < 0 && tap.position < 0);
  assert.equal(tap.released, 0);
  assert.equal(tap.samples, 3); // cancelled stroke has no return sound
  await sound.uncheck();
  await key.click();
  assert.equal(await page.evaluate(() => window.strokes.length), 3);
  await sound.check();
  await page.getByRole('navigation', {name: 'Instrument library'})
    .getByRole('link', {name: 'Parts catalog', exact: true}).click();
  assert.equal(await page.getByRole('checkbox', {name: 'Switch sound'}).isChecked(), true);
  await page.waitForFunction(() => window.decoded === 2);
  assert.equal(await page.evaluate(() => window.strokes.length), 0);
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      document.documentElement.setAttribute('data-vx-plain', '');
      observer.disconnect();
    }).observe(document, {childList: true});
  });
  await page.goto('http://127.0.0.1:' + port + '/kit/showcase/parts/button-group.html');
  await page.waitForFunction(() => window.decoded === 2);
  await page.locator('#draft').click();
  const pointerStrokes = await page.evaluate(() => window.strokes.length);
  assert.ok(pointerStrokes > 0);
  assert.equal(await page.locator('#draft[data-vx-live]').count(), 0);
  await page.locator('#draft').press('Space');
  assert.equal(await page.evaluate(() => window.strokes.length), pointerStrokes + 2);
  console.log('Recorded down/up, repeat suppression, opt-in, mute, and catalog navigation passed.');
} finally {
  await browser.close();
}
