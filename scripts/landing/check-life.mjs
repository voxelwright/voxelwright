// Browser check for the city's ambient life (static/landing/life.js) on the
// production build. It counts the life pass's own draws and the city rebakes by
// wrapping WebGPU's encoder, so it does not depend on pixel noise from fog or the plane.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { startServer } from "../serve.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const out = process.env.OUT ?? ".shots/life";
const idle = Number(process.env.IDLE ?? 30);
await mkdir(out, { recursive: true });

// Counts per submitted frame: gull draws, and frames that rebaked the city.
function count() {
  const life = (window.__life = { gull: 0, bakes: 0, frames: 0, clocks: [] });
  const pass = GPURenderPassEncoder.prototype;
  const { setPipeline, draw } = pass;
  const labels = new WeakMap();
  let baked = false;
  pass.setPipeline = function (pipeline) {
    labels.set(this, pipeline.label);
    return setPipeline.call(this, pipeline);
  };
  pass.draw = function (vertices, instances = 1, ...rest) {
    const label = labels.get(this) ?? "";
    if (label === "City life gull") life.gull++;
    // The city's blocks are the only draws of thousands of instanced quads.
    if (vertices === 4 && instances >= 1000) baked = true;
    return draw.call(this, vertices, instances, ...rest);
  };
  // The life pass's clock and strength are the first two floats of its uniform buffer.
  const { writeBuffer } = GPUQueue.prototype;
  GPUQueue.prototype.writeBuffer = function (buffer, offset, data, ...rest) {
    const state = data[0] + " " + data[1];
    if (buffer.label === "City life clock" && life.clocks.at(-1) !== state) life.clocks.push(state);
    return writeBuffer.call(this, buffer, offset, data, ...rest);
  };
  const { submit } = GPUQueue.prototype;
  GPUQueue.prototype.submit = function (buffers) {
    life.frames++;
    if (baked) life.bakes++;
    baked = false;
    return submit.call(this, buffers);
  };
}

const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const errors = [];
let server;
try {
  server = await startServer({ root: resolve(import.meta.dirname, "../../dist"), port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.address().port}/`;
  async function open({ width = 1440, height = 900, scale = 2, scheme = "dark", graphics, motion = "no-preference", mobile = false }) {
    const storage = [{ name: "support-button-muted", value: "1" }];
    if (graphics) storage.push({ name: "village.graphics", value: JSON.stringify(graphics) });
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: scheme,
      reducedMotion: motion,
      storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: storage }] },
    });
    await context.addInitScript(count);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    assert.ok((await page.goto(base)).ok(), "home responds");
    return { context, page };
  }
  const live = (page) => page.locator(".overlook[data-live]").waitFor({ timeout: 15000 });
  const reset = (page) =>
    page.evaluate(() => Object.keys(window.__life).forEach((k) => (window.__life[k] = k === "clocks" ? [] : 0)));
  const read = (page) => page.evaluate(() => ({ ...window.__life }));
  const preset = (page) => page.locator(".display-settings [name=preset]").inputValue();

  // Night on the fitted default: life draws every frame, the windows rebake about
  // once a step, and an idle half minute keeps the preset where it started.
  {
    const { context, page } = await open({});
    await live(page);
    await page.waitForTimeout(4000);
    const before = { preset: await preset(page), width: await page.locator(".park-canvas").evaluate((c) => c.width) };
    await page.screenshot({ path: join(out, "desk-night.png") });
    await reset(page);
    await page.waitForTimeout(idle * 1000);
    const { clocks, ...n } = await read(page);
    const after = { preset: await preset(page), width: await page.locator(".park-canvas").evaluate((c) => c.width) };
    await page.screenshot({ path: join(out, "desk-night-later.png") });
    console.log("night idle", idle, "s:", JSON.stringify(n), "preset", before.preset, "→", after.preset, "canvas", before.width, "→", after.width, "fps", (n.frames / idle).toFixed(1));
    assert.notEqual(before.preset, "low", "the default path is not Low");
    assert.equal(after.preset, before.preset, "an idle night keeps its preset");
    assert.ok(n.frames > idle * 20, "frames keep coming");
    assert.equal(n.gull, n.frames, "one gull draw a frame");

    assert.ok(clocks.length > idle * 20, "the life clock runs");
    // Pause freezes the life clock. Frames may still come while the lean settles
    // after the click, but nothing in the city moves on.
    await page.locator("[data-pause]").click();
    await page.waitForTimeout(300);
    await reset(page);
    await page.waitForTimeout(3000);
    const paused = await read(page);
    console.log("paused 3 s:", JSON.stringify({ ...paused, clocks: paused.clocks.length }));
    assert.ok(paused.clocks.length <= 1, "the gulls' clock and strength stand still under Pause");
    await context.close();
  }

  // On a fixed High setting nothing else changes the canvas, so every rebake at
  // night is a window step (one a second) and there are none by day.
  const fixed = { preset: "high", scale: 1, dynamic: false, target: 60 };
  {
    const { context, page } = await open({ graphics: fixed });
    await live(page);
    await page.waitForTimeout(4000);
    await reset(page);
    await page.waitForTimeout(10000);
    const n = await read(page);
    console.log("fixed high night 10 s:", n.bakes, "rebakes,", n.frames, "frames");
    assert.ok(n.bakes >= 9 && n.bakes <= 11, `windows rebake once a second, not ${n.bakes}`);
    await context.close();
  }
  {
    const { context, page } = await open({ scheme: "light", graphics: fixed });
    await live(page);
    await page.waitForTimeout(3000);
    await reset(page);
    await page.waitForTimeout(5000);
    const n = await read(page);
    await page.screenshot({ path: join(out, "desk-day.png") });
    assert.ok(n.gull > 100 && n.gull === n.frames, "gulls by day");
    assert.equal(n.bakes, 0, "no rebakes by day");
    await context.close();
  }

  // Low switches it all off, windows included.
  {
    const { context, page } = await open({ graphics: { preset: "low", scale: 0.5, dynamic: false, target: 30 } });
    await live(page);
    await page.waitForTimeout(3000);
    await reset(page);
    await page.waitForTimeout(5000);
    const n = await read(page);
    assert.ok(n.frames > 50, "Low still runs");
    assert.deepEqual([n.gull, n.bakes], [0, 0], "Low has no life and no window rebakes");
    await context.close();
  }

  // Reduced motion keeps the GPU-free still.
  {
    const { context, page } = await open({ motion: "reduce" });
    await page.locator(".park-still").waitFor({ state: "visible", timeout: 8000 });
    await page.waitForTimeout(2000);
    const n = await read(page);
    assert.equal(await page.locator(".overlook[data-live]").count(), 0);
    assert.deepEqual([n.gull, n.bakes], [0, 0]);
    await context.close();
  }

  // Phone at 390 px, day and night: live, no sideways scroll.
  for (const scheme of ["light", "dark"]) {
    const { context, page } = await open({ width: 390, height: 844, scale: 3, mobile: true, scheme });
    await live(page);
    await page.waitForTimeout(3000);
    const n = await read(page);
    assert.ok(n.gull > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.screenshot({ path: join(out, `phone-${scheme === "dark" ? "night" : "day"}.png`) });
    await context.close();
  }

  assert.deepEqual(errors, []);
  console.log("life checks passed; screenshots in", out);
} finally {
  await browser.close();
  server?.close();
}
