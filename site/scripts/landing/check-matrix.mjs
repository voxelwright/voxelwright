// Browser check for the window screen (static/landing/screen.js) and the Matrix egg
// on the production build. It counts the egg's own passes by pipeline label, so it
// does not depend on pixel noise, and compares pixels only where the scene is held
// still by Pause. The check exposes the live world to the page (world.beacons and
// world.frame) to tap a red tower light; the shipped page does not.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { serveLanding } from "./serve-landing.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const out = process.env.OUT ?? ".shots/matrix";
await mkdir(out, { recursive: true });

const LABELS = { "Window map": "map", "Window screen": "screen", "Mood grade": "grade", "Marine layer": "fog" };
function count() {
  const n = (window.__matrix = { map: 0, screen: 0, grade: 0, fog: 0, frames: 0, bakes: 0 });
  const pass = GPURenderPassEncoder.prototype;
  const { setPipeline, draw } = pass;
  const labels = new WeakMap();
  let baked = false;
  // Each of the egg's passes sets its pipeline once.
  pass.setPipeline = function (pipeline) {
    labels.set(this, pipeline.label);
    if (pipeline.label in LABELS) n[LABELS[pipeline.label]]++;
    return setPipeline.call(this, pipeline);
  };
  pass.draw = function (vertices, instances = 1, ...rest) {
    if (labels.get(this) !== "Window map" && vertices === 4 && instances >= 1000) baked = true;
    return draw.call(this, vertices, instances, ...rest);
  };
  const { submit } = GPUQueue.prototype;
  GPUQueue.prototype.submit = function (buffers) {
    n.frames++;
    if (baked) n.bakes++;
    baked = false;
    return submit.call(this, buffers);
  };
}
// Labels defined in this file are matched in the page by name.
const counter = `const LABELS = ${JSON.stringify(LABELS)};\n(${count})();`;

const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const errors = [];
let server;
try {
  server = await serveLanding();
  const base = server.base;
  const home = (await readFile(join(server.root, "landing/home.js"), "utf8")) + "\nwindow.__world = () => world;";
  async function open({ width = 1440, height = 900, scale = 1, scheme = "dark", preset = "high", motion = "no-preference", mobile = false }) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: scheme,
      reducedMotion: motion,
      storageState: {
        cookies: [],
        origins: [{
          origin: new URL(base).origin,
          localStorage: [
            { name: "support-button-muted", value: "1" },
            { name: "village.graphics", value: JSON.stringify({ preset, scale: 1, dynamic: false, target: 60 }) },
          ],
        }],
      },
    });
    await context.addInitScript(counter);
    await context.route("**/landing/home.js", (route) => route.fulfill({ body: home, contentType: "text/javascript" }));
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => ["error", "warning"].includes(message.type()) && errors.push(message.text()));
    assert.ok((await page.goto(base)).ok(), "home responds");
    return { context, page };
  }
  const live = (page) => page.locator(".overlook[data-live]").waitFor({ timeout: 20000 });
  const reset = (page) => page.evaluate(() => Object.keys(window.__matrix).forEach((k) => (window.__matrix[k] = 0)));
  const read = (page) => page.evaluate(() => ({ ...window.__matrix }));
  const status = (page) => page.locator(".egg-status").innerText();
  const inMatrix = (page) => page.locator(".overlook").evaluate((el) => el.hasAttribute("data-matrix"));
  // A red tower light on screen, in CSS pixels.
  const beacon = (page) =>
    page.evaluate(async () => {
      const { project } = await import("/landing/survey.js");
      const world = window.__world();
      const box = document.querySelector(".park-canvas").getBoundingClientRect();
      const seen = world.beacons
        .map((p) => project(p, world.frame, box.width, box.height))
        .filter(([x, y, z]) => z > 0 && x > 30 && x < box.width - 30 && y > 30 && y < box.height * 0.6);
      const [x, y] = seen[0];
      return { x: box.x + x, y: box.y + y };
    });

  // Night on a fixed High setting.
  {
    const { context, page } = await open({});
    await live(page);
    await page.waitForTimeout(4000);
    await reset(page);
    await page.waitForTimeout(2000);
    const idle = await read(page);
    assert.ok(idle.frames > 30, "the city runs");
    assert.deepEqual([idle.map, idle.screen, idle.grade], [0, 0, 0], "without the egg the city draws nothing new");

    // Under Pause the scene holds still, so leaving must give back the same picture.
    await page.locator("[data-pause]").click();
    await page.waitForTimeout(1500);
    const clip = { x: 0, y: 0, width: 1440, height: 760 };
    const before = await page.screenshot({ clip });
    await page.locator("#main").focus();
    await page.keyboard.type("neo");
    assert.equal(await inMatrix(page), true, "typing neo enters");
    assert.match(await status(page), /Wake up, Neo/);
    await page.waitForTimeout(4000);
    const paused = await read(page);
    assert.ok(paused.map >= 1 && paused.screen > 10 && paused.grade > 10, `the mood rolls in under Pause: ${JSON.stringify(paused)}`);
    await page.screenshot({ path: join(out, "night-paused.png") });
    const held = await page.screenshot({ clip });
    await page.waitForTimeout(400);
    assert.ok(held.equals(await page.screenshot({ clip })), "Pause holds the rain");
    assert.ok(!held.equals(before), "the Matrix changes the view");
    assert.equal(await page.locator('[data-sign="matrix-exit"][data-hit]').isVisible(), true);
    assert.equal(await page.locator('[data-egg="rain"]').getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await inMatrix(page), false, "Esc leaves");
    assert.match(await status(page), /Blue pill/);
    await page.waitForTimeout(2500);
    assert.ok((await page.screenshot({ clip })).equals(before), "leaving gives back the exact city");
    await reset(page);
    await page.waitForTimeout(1000);
    const after = await read(page);
    assert.deepEqual([after.map, after.screen, after.grade], [0, 0, 0], "nothing left drawing after leaving");

    // Playing: tap a red tower light. The screen draws every frame, the map only on rebakes.
    await page.locator("[data-pause]").click();
    const red = await beacon(page);
    await page.mouse.click(red.x, red.y);
    assert.equal(await inMatrix(page), true, "a red tower light enters");
    await page.waitForTimeout(4000);
    await reset(page);
    await page.waitForTimeout(5000);
    const playing = await read(page);
    console.log("night matrix 5 s:", JSON.stringify(playing));
    assert.equal(playing.screen, playing.frames, "one screen draw a frame");
    assert.equal(playing.grade, playing.frames, "one grade a frame");
    assert.equal(playing.map, playing.bakes, "the map redraws only with the city");
    assert.ok(playing.bakes <= 7, `the city rebakes about once a second, not ${playing.bakes} times`);
    assert.ok(playing.fog === playing.frames, "the marine layer still runs");
    await page.screenshot({ path: join(out, "night.png") });
    await page.locator('[data-sign="matrix-exit"][data-hit]').click();
    assert.equal(await inMatrix(page), false, "the exit plate leaves");
    await page.locator('[data-sign="time"][data-hit]').waitFor({ state: "attached" });
    assert.notEqual(await page.evaluate(() => document.activeElement), null);
    assert.equal(await page.evaluate(() => document.activeElement === document.body), false, "focus doesn't drop to the body");
    await context.close();
  }

  // Day, entered by typing.
  {
    const { context, page } = await open({ scheme: "light" });
    await live(page);
    await page.waitForTimeout(3000);
    await page.locator("#main").focus();
    await page.keyboard.type("red pill");
    await page.waitForTimeout(7000);
    assert.equal(await inMatrix(page), true);
    await page.screenshot({ path: join(out, "day.png") });
    await page.keyboard.type("blue pill");
    assert.equal(await inMatrix(page), false, "blue pill leaves");
    await page.keyboard.type("follow the white rabbit");
    assert.equal(await inMatrix(page), true, "the longest phrase enters too");
    await page.keyboard.press("Escape");
    await context.close();
  }

  // Low: its marine layer is off, but a light one (four steps) comes with the mood.
  {
    const { context, page } = await open({ preset: "low" });
    await live(page);
    await page.waitForTimeout(3000);
    await page.locator("#main").focus();
    await page.keyboard.type("wake up");
    await page.waitForTimeout(4000);
    await reset(page);
    await page.waitForTimeout(2000);
    const low = await read(page);
    assert.ok(low.screen > 30 && low.grade > 30 && low.fog === low.frames, `Low plays with a light fog: ${JSON.stringify(low)}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2500);
    await reset(page);
    await page.waitForTimeout(1000);
    assert.equal((await read(page)).fog, 0, "Low's marine layer goes again with the mood");
    await context.close();
  }

  // The fitted default with adaptive pacing, the egg on and the pointer leaning the
  // view (each lean frame rebakes the city and the map): the preset holds.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark",
      storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: [{ name: "support-button-muted", value: "1" }] }] } });
    await context.addInitScript(counter);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await live(page);
    await page.waitForTimeout(4000);
    const preset = () => page.locator(".display-settings [name=preset]").inputValue();
    const before = await preset();
    await page.locator("#main").focus();
    await page.keyboard.type("neo");
    await reset(page);
    const seconds = Number(process.env.LEAN ?? 20);
    const end = Date.now() + seconds * 1000;
    for (let i = 0; Date.now() < end; i++) await page.mouse.move(400 + 600 * Math.abs(Math.sin(i / 9)), 300 + 200 * Math.abs(Math.cos(i / 7)), { steps: 4 });
    const n = await read(page);
    console.log(`adaptive with lean ${seconds} s:`, JSON.stringify(n), "fps", (n.frames / seconds).toFixed(1), "preset", before, "→", await preset());
    assert.equal(await preset(), before, "the egg and the lean keep the preset");
    assert.ok(n.map > seconds * 10, "the lean rebakes the map with the city");
    await context.close();
  }

  // Phone, by touch: the billboard swaps its controls for the exit plate.
  for (const scheme of ["dark", "light"]) {
    const { context, page } = await open({ width: 390, height: 844, scale: 3, mobile: true, scheme, preset: "medium" });
    await live(page);
    await page.waitForTimeout(3000);
    // No red light's reach covers the moon, which a night tap resizes.
    const clash = await page.evaluate(async () => {
      const { project } = await import("/landing/survey.js");
      const world = window.__world();
      const { width, height } = document.querySelector(".park-canvas").getBoundingClientRect();
      const reach = Math.max(18, height * 0.025), moon = Math.max(14, height * 0.044);
      return world.beacons.map((p) => project(p, world.frame, width, height))
        .some(([x, y, z]) => z > 0 && Math.hypot(x - width * 0.7, y - height * 0.14) < reach + moon);
    });
    assert.equal(clash, false, "tower lights and the moon don't share a tap");
    const red = await beacon(page);
    await page.touchscreen.tap(red.x, red.y);
    assert.equal(await inMatrix(page), true, "a tapped tower light enters on a phone");
    await page.waitForTimeout(6000);
    // The directory turns digital: its controls give way to one Exit the Matrix plate.
    const exit = await page.locator('[data-sign="matrix-exit"][data-hit]').boundingBox();
    assert.ok(exit.width >= 44 && exit.height >= 44, "the exit plate is a full touch target");
    for (const id of ["time", "pause", "sound", "postcard", "view"])
      assert.equal(await page.locator(`[data-sign="${id}"][data-hit]`).count(), 0, `${id} gives way on the billboard`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.screenshot({ path: join(out, `phone-${scheme === "dark" ? "night" : "day"}.png`) });
    await context.close();
  }

  // Reduced motion keeps the still and its short glyph fall.
  {
    const { context, page } = await open({ motion: "reduce" });
    await page.locator(".park-still").waitFor({ state: "visible", timeout: 8000 });
    await page.locator("#main").focus();
    await page.keyboard.type("neo");
    assert.equal(await page.locator(".glyph-rain").count(), 1);
    assert.equal(await inMatrix(page), false);
    await context.close();
  }

  assert.deepEqual(errors, []);
  console.log("matrix checks passed; screenshots in", out);
} finally {
  await browser.close();
  await server?.close();
}
