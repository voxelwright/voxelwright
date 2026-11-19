// Smoke test the production build on loopback with WebGPU-capable Chrome.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { startServer } from "../serve.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const out = process.env.OUT ?? ".shots/eggs";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const errors = [];
let server;

function observe(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  const greetings = [];
  page.on("console", (message) => {
    if (message.text().includes("General Kenobi.")) greetings.push(message.text());
  });
  return greetings;
}

function park(page) {
  return {
    link: page.locator(".park-sign a").first(),
    status: page.locator(".egg-status"),
    canvas: page.locator(".park-canvas"),
    support: page.locator("support-button .root[data-ready] .body"),
    shot: (name) => page.screenshot({ path: join(out, name + ".png") }),
  };
}

try {
  if (!process.env.BASE) {
    server = await startServer({ root: resolve(import.meta.dirname, "../../dist"), port: 0, host: "127.0.0.1" });
  }
  const base = new URL(process.env.BASE ?? `http://127.0.0.1:${server.address().port}/`).href;
  // Start the live checks with a light saved setting so startup on slower test
  // hosts leaves headroom. The test then drives the real graphics controls.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(base).origin,
        localStorage: [
          { name: "village.graphics", value: JSON.stringify({ preset: "low", scale: 0.5, dynamic: false, target: 30 }) },
          { name: "support-button-muted", value: "1" },
        ],
      }],
    },
  });
  const page = await context.newPage();
  const greetings = observe(page);
  const { link, status, canvas, support, shot } = park(page);
  const live = page.locator(".overlook[data-live]");
  const pause = page.locator("[data-pause]");
  const settings = page.locator(".display-settings");
  const summary = settings.locator("summary");
  const preset = settings.locator("[name=preset]");
  const scale = settings.locator("[name=scale]");
  const dynamic = settings.locator("[name=dynamic]");
  const target = settings.locator("[name=target]");
  const b = link.locator(".breakable-b");

  async function openLive() {
    assert.ok((await page.goto(base)).ok(), "production home responds");
    await live.waitFor({ timeout: 8000 });
    await pause.click();
    assert.equal(await pause.getAttribute("aria-pressed"), "true");
  }

  await openLive();
  assert.equal(await support.count(), 1);
  assert.equal(await page.locator("support-button").getAttribute("dock"), "support-dock");
  assert.equal(await support.isVisible(), false);
  assert.deepEqual(await canvas.boundingBox(), { x:0, y:0, width:1280, height:860 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight),860);
  // City sound is silent until the visitor asks, then toggles from the directory.
  const sound = page.locator('[data-sign="sound"]');
  assert.equal(await sound.getAttribute("aria-pressed"), "false");
  await sound.click();
  assert.equal(await sound.getAttribute("aria-pressed"), "true");
  await sound.click();
  assert.equal(await sound.getAttribute("aria-pressed"), "false");
  await summary.click();
  await page.locator('[data-sign="support"]').click();
  assert.equal(await support.evaluate((button) => button.getRootNode().activeElement === button), true);
  await page.keyboard.type("iddqd");
  assert.equal(await status.innerText(), "");

  await page.locator("support-button .live:not(:empty)").waitFor({ state: "attached" });
  assert.equal(await link.getAttribute("href"), "/blog/");

  await support.press("Escape");
  assert.equal(await support.isVisible(), false);

  const expectScale = (factor) => page.waitForFunction((factor) => {
    const canvas = document.querySelector(".park-canvas");
    return canvas.width === Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2) * factor);
  }, factor);
  await expectScale(0.5);
  await preset.selectOption("ultra");
  await expectScale(0.7);
  await scale.press("ArrowRight");
  await expectScale(0.55 * 1.4);
  assert.equal(await scale.getAttribute("aria-valuetext"), "55%");
  await dynamic.check();
  await target.selectOption("60");
  await scale.focus();
  await page.keyboard.type("iddqd");
  assert.equal(await status.innerText(), "");
  await scale.press("Escape");
  assert.equal(await settings.getAttribute("open"), null);
  assert.equal(await summary.evaluate((node) => document.activeElement === node), true);

  await page.evaluate(() => window.scrollTo(0, 0));
  const view = await canvas.boundingBox();
  const shoot = async (x, y) => {
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + x * box.width, box.y + y * box.height);
  };
  // Sample the sky between the original and largest moon radii. A brighter
  // pixel also verifies that the live renderer updates while flight is paused.
  async function moonPixel() {
    const png = await page.screenshot({ clip: {
      x: Math.round(view.x + view.width * 0.7 - view.height * 0.033),
      y: Math.round(view.y + view.height * 0.14),
      width: 1, height: 1,
    } });
    return page.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const ctx = new OffscreenCanvas(1, 1).getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, 1, 1).data[0];
    }, "data:image/png;base64," + png.toString("base64"));
  }

  await shoot(0.72, 0.35);
  assert.equal(await status.innerText(), "");
  const smallMoon = await moonPixel();
  await shot("night");
  await shoot(0.70, 0.14);
  await shoot(0.70, 0.14);
  assert.match(await status.innerText(), /3 of 3/);
  await shot("moon");
  assert.ok(await moonPixel() > smallMoon + 20, "the live moon visibly grows");
  await shoot(0.70, 0.14);
  assert.match(await status.innerText(), /1 of 3/);

  const skyClip = {
    x: Math.round(view.x + view.width * 0.15),
    y: Math.round(view.y + view.height * 0.10),
    width: Math.round(view.width * 0.42),
    height: Math.round(view.height * 0.13),
  };
  const sky = () => page.screenshot({ clip: skyClip });
  const still = await sky();
  await page.waitForTimeout(250);
  assert.ok((await sky()).equals(still), "the paused sky holds still");
  await shoot(0.10, 0.175);
  assert.match(await status.innerText(), /Never gonna/);
  await page.locator(".sign-dancer").waitFor();

  await summary.click();
  assert.notEqual(await settings.getAttribute("open"), null);
  await summary.press("Escape");

  async function holdB() {
    const box = await b.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
  }

  await link.focus();
  await page.keyboard.type("iddqd");
  await link.press("Space");
  assert.match(await status.innerText(), /IDDQD is on/);
  await holdB();
  assert.equal(await link.getAttribute("href"), "/blog/");
  await link.focus();
  await page.keyboard.type("iddqd");
  assert.match(await status.innerText(), /IDDQD off/);
  await holdB();
  assert.equal(await link.getAttribute("href"), "#site-log");
  await page.waitForTimeout(550); // The held press must also outlast the departure timer.
  assert.equal(page.url(), base);
  await link.click();
  assert.equal(new URL(page.url()).hash, "#site-log");
  await shot("log");
  await page.locator("[data-mend]").click();
  assert.equal(await link.getAttribute("href"), "/blog/");

  await link.press("Space");
  assert.equal(await link.getAttribute("href"), "#site-log");
  assert.equal(await page.locator(".b-chips").count(), 0);
  await link.press("Enter");
  assert.equal(new URL(page.url()).hash, "#site-log");
  await page.locator("[data-mend]").click();
  for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
    await page.keyboard.press(key);
  }
  assert.match(await status.innerText(), /30 lives/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("konami");
  await pause.click();
  assert.equal(await pause.getAttribute("aria-pressed"), "false");
  await page.locator("#main").focus();
  await page.keyboard.type("do a barrel roll");
  assert.match(await status.innerText(), /Barrel roll/);
  assert.equal(await page.locator(".bearing i").evaluate((node) => node.getAnimations().length), 1);
  await pause.click();
  assert.equal(await pause.getAttribute("aria-pressed"), "true");
  await page.locator("[data-time]").click();
  assert.equal(await live.getAttribute("data-hour"), "day");
  await shoot(0.70, 0.14);
  assert.match(await status.innerText(), /Barrel roll/);
  await b.click();
  await page.waitForURL("**/blog/");

  await openLive();
  await summary.click();
  assert.equal(await preset.inputValue(), "ultra");
  assert.equal(await scale.inputValue(), "55");
  assert.equal(await dynamic.isChecked(), true);
  assert.equal(await target.inputValue(), "60");
  const localBlog = page.locator('[data-sign="local-blog"][data-hit]');
  await localBlog.waitFor();
  await localBlog.press("Enter");
  await page.waitForURL("**/blog/");

  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  assert.equal(await canvas.isVisible(), false);
  await support.waitFor();
  await link.press("Space");
  assert.equal(await page.locator(".b-chips").count(), 0);
  await link.press("Enter");
  assert.equal(new URL(page.url()).hash, "#site-log");
  await shot("reduced-log");
  await page.locator("[data-mend]").click();
  await page.locator(".park-credit > summary").click();
  await page.locator(".park-secrets > summary").click();
  await page.locator('[data-egg="rick"]').click();
  assert.match(await status.innerText(), /Never gonna/);
  await page.locator('[data-egg="rain"]').click();
  assert.equal(await page.locator(".glyph-rain i").first().evaluate((node) => node.getAnimations().length), 0);
  await context.setOffline(true);
  await page.locator(".offline-car").click();
  assert.match(await status.innerText(), /cleared/);
  await context.setOffline(false);
  await page.locator(".offline-car").waitFor({ state: "hidden" });
  assert.equal(greetings.length, 3);
  await context.close();

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await touchContext.newPage();
  observe(mobile);
  const plain = new URL("?view=2d", base).href;
  const mobilePark = park(mobile);
  const mobileB = mobilePark.link.locator(".breakable-b");
  const finger = await touchContext.newCDPSession(mobile);
  const touch = (type, touchPoints = []) => finger.send("Input.dispatchTouchEvent", { type, touchPoints });
  async function startTouch() {
    const box = await mobileB.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touch("touchStart", [point]);
  }

  await mobile.goto(plain);
  await mobilePark.support.waitFor();
  await mobileB.tap();
  await mobile.waitForURL("**/blog/");
  await mobile.goto(plain);
  await startTouch();
  await mobile.waitForTimeout(600);
  await touch("touchCancel");
  assert.equal(await mobilePark.link.getAttribute("href"), "/blog/");
  await startTouch();
  await mobile.waitForTimeout(600);
  assert.equal(await mobileB.evaluate((letter) =>
    letter.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
  ), false);
  await touch("touchEnd");
  assert.equal(await mobilePark.link.getAttribute("href"), "#site-log");
  assert.equal(mobile.url(), plain);
  await mobilePark.link.tap();
  assert.equal(new URL(mobile.url()).hash, "#site-log");
  await mobile.locator(".b-chips").waitFor({ state: "detached" });
  await mobilePark.shot("touch-log");
  await touchContext.close();

  // The city and both destinations also fill a phone when there is no GPU.
  const stillPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const fetched = [];
  stillPage.on("request", r => fetched.push(new URL(r.url()).pathname));
  await stillPage.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await stillPage.goto(base);
  await stillPage.locator('.overlook[data-scene] [data-sign="local-voxel"][data-hit]').waitFor();
  assert.deepEqual(await stillPage.locator(".park-still").boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
  assert.ok(!fetched.includes("/landing/ina.faces.gz"));
  await stillPage.locator('[data-sign="local-voxel"]').click();
  await stillPage.waitForURL("**/voxelmorphism/");
  await stillPage.close();

  assert.deepEqual(errors, []);
  console.log("Landing smoke passed: live WebGPU, graphics and pause, Support shadow controls, desktop navigation and eggs, reduced motion, offline, touch, and GPU-free phone navigation.");
} finally {
  server?.close();
  await browser.close();
}
