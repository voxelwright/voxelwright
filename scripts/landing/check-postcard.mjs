// Make a postcard in the live city (night and day), in the GPU-free still on a touch phone and
// on the plain page by keyboard. Each PNG comes from the real download and must hold a picture:
// the photo window is sampled away from the printed border and lettering.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { startServer } from "../serve.mjs";
import { cardLayout } from "../../static/landing/postcard.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const out = resolve(process.env.OUT ?? ".shots/postcard");
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const errors = [];
let server;

// Stand in for the system share sheet and record what it was given.
const fakeShare = () => {
  navigator.canShare = (data) => !!data?.files?.length;
  navigator.share = async (data) => {
    window.__shared = data.files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
  };
};

async function picture(page, png, photo) {
  // Read the PNG in the page and measure the top of the photo window (above the greeting).
  return page.evaluate(
    async ({ data, photo }) => {
      const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob());
      const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      c.drawImage(bitmap, 0, 0);
      const [x, y, w, h] = [photo.x + 8, photo.y + 8, photo.w - 16, Math.round(photo.h * 0.5)];
      const px = c.getImageData(x, y, w, h).data;
      let sum = 0,
        sq = 0,
        n = 0;
      const colours = new Set();
      for (let i = 0; i < px.length; i += 4 * 7) {
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        sum += l;
        sq += l * l;
        n++;
        colours.add((px[i] >> 3) * 1024 + (px[i + 1] >> 3) * 32 + (px[i + 2] >> 3));
      }
      const mean = sum / n;
      return { w: bitmap.width, h: bitmap.height, mean, spread: Math.sqrt(sq / n - mean * mean), colours: colours.size };
    },
    { data: png.toString("base64"), photo },
  );
}

async function take(page, trigger, name, expect) {
  const dialog = page.locator("dialog.postcard");
  await trigger();
  await dialog.waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await dialog.evaluate((d) => d.matches(":modal")), true, "the preview is a modal dialog");
  assert.equal(await page.getByRole("dialog", { name: "Your postcard" }).count(), 1, "the dialog is labelled");
  const save = dialog.locator("[data-postcard-save]");
  assert.equal(await save.evaluate((a) => document.activeElement === a), true, "focus lands on Download");
  assert.match(await dialog.locator(".postcard-print").getAttribute("alt"), /Greetings from San Francisco.*Ina Coolbrith Park.*zahynailo\.dev/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, name + "-dialog.png") });
  const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
  assert.match(download.suggestedFilename(), /^zahynailo-postcard-\d{4}-\d\d-\d\d\.png$/);
  const file = join(out, name + ".png");
  await download.saveAs(file);
  const png = await readFile(file);
  const layout = cardLayout(...(expect.portrait ? [1, 2] : [2, 1]));
  const stats = await picture(page, png, layout.photo);
  assert.equal(stats.w, layout.width, name + " card width");
  assert.equal(stats.h, layout.height, name + " card height");
  assert.ok(stats.spread > 10 && stats.colours > 200, `${name}: the photo window holds a picture (${JSON.stringify(stats)})`);
  console.log(`${name}: ${stats.w}x${stats.h}, photo mean ${stats.mean.toFixed(1)}, spread ${stats.spread.toFixed(1)}, ${stats.colours} colours -> ${file}`);
  return { dialog, stats };
}

try {
  server = await startServer({ root: resolve(import.meta.dirname, "../../dist"), port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.address().port}/`;

  // 1. The live city with a light saved graphics setting, as in check-eggs.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(base).origin,
        localStorage: [
          { name: "village.graphics", value: JSON.stringify({ preset: "medium", scale: 0.7, dynamic: false, target: 30 }) },
          { name: "support-button-muted", value: "1" },
        ],
      }],
    },
  });
  await context.addInitScript(fakeShare);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  assert.ok((await page.goto(base)).ok());
  await page.locator(".overlook[data-live]").waitFor({ timeout: 15000 });
  const plate = page.locator('[data-sign="postcard"][data-hit]');
  await plate.waitFor();
  // Lean: rest the pointer at the right of the view, then let the spring settle.
  await page.mouse.move(1180, 300);
  await page.waitForTimeout(1500);
  await page.locator("[data-pause]").click();
  const hour = await page.locator(".overlook").getAttribute("data-hour");
  const night = await take(page, () => plate.click(), "live-" + hour, { portrait: false });
  // Sharing hands the same PNG to the system sheet.
  const share = night.dialog.locator("[data-postcard-share]");
  assert.equal(await share.isVisible(), true, "Share shows where files can be shared");
  await share.click();
  const shared = await page.evaluate(() => window.__shared);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].type, "image/png");
  assert.match(shared[0].name, /\.png$/);
  await page.keyboard.press("Escape");
  await night.dialog.waitFor({ state: "hidden" });
  assert.equal(await plate.evaluate((b) => document.activeElement === b), true, "focus returns to the plate");
  // The directory came back after the shutter.
  assert.equal(await page.locator('[data-sign="time"][data-hit]').count(), 1);
  // With the View panel open, the plate folds the panel away and prints the view it covered.
  const settings = page.locator(".display-settings");
  await settings.locator("summary").click();
  assert.notEqual(await settings.getAttribute("open"), null);
  const folded = await take(page, () => plate.click(), "live-panel-" + hour, { portrait: false });
  assert.equal(await settings.getAttribute("open"), null, "the panel is closed for the postcard");
  await folded.dialog.locator("[data-postcard-close]").click();
  await folded.dialog.waitFor({ state: "hidden" });
  await page.locator("[data-time]").click();
  const other = await page.locator(".overlook").getAttribute("data-hour");
  assert.notEqual(other, hour);
  await page.waitForTimeout(9000); // the light eases between day and night
  const day = await take(page, () => plate.click(), "live-" + other, { portrait: false });
  await page.locator("[data-postcard-close]").click();
  await day.dialog.waitFor({ state: "hidden" });
  const [dark, light] = hour === "night" ? [night.stats, day.stats] : [day.stats, night.stats];
  assert.ok(light.mean > dark.mean + 20, "the night card is darker than the day card");
  await page.screenshot({ path: join(out, "live-after.png") });
  await context.close();

  // 2. The GPU-free still on a phone, by touch.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "light", reducedMotion: "reduce" });
  await phone.addInitScript(fakeShare);
  const still = await phone.newPage();
  still.on("pageerror", (e) => errors.push(e.message));
  await still.goto(base);
  await still.locator(".overlook[data-scene] .park-still").waitFor();
  const stillPlate = still.locator('[data-sign="postcard"][data-hit]');
  await stillPlate.waitFor();
  const box = await stillPlate.boundingBox();
  console.log(`still plate at 390 px: ${box.width.toFixed(1)} x ${box.height.toFixed(1)} px`);
  await still.screenshot({ path: join(out, "still-phone.png") });
  const phoneCard = await take(still, () => stillPlate.tap(), "still-phone", { portrait: true });
  await phoneCard.dialog.locator("[data-postcard-close]").tap();
  await phoneCard.dialog.waitFor({ state: "hidden" });
  await phone.close();

  // 3. The plain page, by keyboard.
  const plainContext = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "light" });
  const plain = await plainContext.newPage();
  plain.on("pageerror", (e) => errors.push(e.message));
  await plain.goto(new URL("?view=2d", base).href);
  const button = plain.locator("[data-postcard-plain]");
  await button.waitFor();
  await plain.screenshot({ path: join(out, "plain-page.png"), fullPage: true });
  const plainCard = await take(plain, async () => {
    await button.focus();
    await plain.keyboard.press("Enter");
  }, "plain", { portrait: false });
  await plain.keyboard.press("Escape");
  await plainCard.dialog.waitFor({ state: "hidden" });
  assert.equal(await button.evaluate((b) => document.activeElement === b), true, "focus returns to the plain button");
  await plainContext.close();

  assert.deepEqual(errors, []);
  await writeFile(join(out, "README.txt"), "Postcards and screenshots from scripts/landing/check-postcard.mjs.\n");
  console.log("Postcard check passed: live night and day, share, still on a phone by touch, plain page by keyboard.");
} finally {
  server?.close();
  await browser.close();
}
