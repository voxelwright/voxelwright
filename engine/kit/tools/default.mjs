// Which renderer draws a page that hands the kit none?   [PORT=5989] node tools/default.mjs [page]
//   with WebGPU      the Village engine's (it owns each part's canvas)
//   without WebGPU   the kit's own WebGL2 stand-in, until core/gl.js goes; then the plain page
//   plain by choice  nothing, and no GPU device is asked for
//   use(null)        nothing: an explicit "none" still wins over the default
import { chromium, webkit } from 'playwright';

const port = process.env.PORT || 5985;
const path = process.argv[2] || 'showcase/';
const url = `http://127.0.0.1:${port}/${path}`;
let bad = 0;
const say = (ok, what, got) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}`); };

// counts every request for a GPU adapter the page makes
const COUNT = () => {
  window.__asked = 0;
  const gpu = navigator.gpu;
  if (gpu) { const real = gpu.requestAdapter.bind(gpu); gpu.requestAdapter = (...a) => { window.__asked++; return real(...a); }; }
};
const read = (p) => p.evaluate(async () => {
  const kit = await import('/packages/voxelmorphism/src/index.js');
  const st = await kit.ready();
  return { by: st ? (st.renderer.ownsCanvas ? 'engine' : 'webgl2') : 'plain', live: document.querySelectorAll('[data-vx-live]').length, canvases: document.querySelectorAll('.vx-canvas').length, asked: window.__asked, gpu: !!navigator.gpu };
});
const settle = async (p) => { await p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(600); };

const gpu = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
{
  const p = await gpu.newPage();
  await p.addInitScript(COUNT);
  await p.goto(url); await settle(p);
  const r = await read(p);
  say(r.gpu && r.by === 'engine' && r.live > 0, 'Chromium with WebGPU', `${r.by}, ${r.live} parts, ${r.asked} adapter request${r.asked === 1 ? '' : 's'}`);
  await p.close();
}
{
  // plain by choice: the attribute is there before the kit's script runs
  const p = await gpu.newPage();
  await p.addInitScript(COUNT);
  await p.addInitScript(() => { new MutationObserver((_, o) => { if (document.documentElement) { document.documentElement.setAttribute('data-vx-plain', ''); o.disconnect(); } }).observe(document, { childList: true }); });
  await p.goto(url); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({ live: document.querySelectorAll('[data-vx-live]').length, asked: window.__asked, set: document.documentElement.hasAttribute('data-vx-plain') }));
  say(r.set && r.live === 0 && r.asked === 0, 'plain by choice', `${r.live} parts, ${r.asked} adapter requests`);
  await p.close();
}
{
  const p = await gpu.newPage();
  await p.addInitScript(COUNT);
  await p.goto(`http://127.0.0.1:${port}/showcase/seam.html?none`);
  await p.waitForSelector('html[data-ready]');
  const r = await p.evaluate(() => ({ live: document.querySelectorAll('[data-vx-live]').length, asked: window.__asked }));
  say(r.live === 0 && r.asked === 0, 'use(null)', `${r.live} parts, ${r.asked} adapter requests`);
  await p.close();
}
{
  // a browser with no WebGPU at all
  const p = await gpu.newPage();
  await p.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }));
  await p.goto(url); await settle(p);
  const r = await read(p);
  say(!r.gpu && r.by === 'webgl2' && r.live > 0, 'Chromium, WebGPU taken away', `${r.by}, ${r.live} parts`);
  await p.close();
}
{
  // WebGPU is there, but no adapter can be had
  const p = await gpu.newPage();
  await p.addInitScript(() => { navigator.gpu.requestAdapter = async () => null; });
  await p.goto(url); await settle(p);
  const r = await read(p);
  say(r.gpu && r.by === 'webgl2' && r.live > 0, 'Chromium, WebGPU with no adapter', `${r.by}, ${r.live} parts`);
  await p.close();
}
await gpu.close();

const wk = await webkit.launch();
{
  const p = await wk.newPage();
  await p.goto(url); await settle(p);
  const r = await read(p);
  say(!r.gpu ? r.by === 'webgl2' && r.live > 0 : r.by === 'engine' && r.live > 0, `WebKit (${r.gpu ? 'with' : 'without'} WebGPU)`, `${r.by}, ${r.live} parts`);
  await p.close();
}
await wk.close();

console.log(bad ? `${bad} wrong` : 'the default renderer is the engine; without WebGPU the stand-in draws; plain asks for nothing');
process.exit(bad ? 1 : 0);
