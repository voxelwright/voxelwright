// Smoke test the built home on loopback. A WebGPU-capable Chrome is required.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const base = process.env.BASE ?? "http://127.0.0.1:5989/";
const out = process.env.OUT ?? ".shots/eggs";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
  const page = await context.newPage();
  const errors = [];
  const greetings = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.text().includes("General Kenobi.")) greetings.push(message.text());
  });
  await page.goto(base);
  await page.locator(".overlook[data-live]").waitFor();
  await page.locator("[data-pause]").click();
  const link = page.locator(".park-sign a").first();
  const status = page.locator(".egg-status");
  const view = await page.locator(".park-canvas").boundingBox();
  const shoot = (x, y) => page.mouse.click(view.x + x * view.width, view.y + y * view.height);
  const shot = (name) => page.screenshot({ path: join(out, name + ".png") });

  await shoot(.72, .35);
  assert.equal(await status.innerText(), "");
  await shot("night");
  await shoot(.70, .14);
  await shoot(.70, .14);
  assert.match(await status.innerText(), /3 of 3/);
  await shot("moon");
  await shoot(.70, .14);
  assert.match(await status.innerText(), /1 of 3/);

  await link.focus();
  await page.keyboard.type("iddqd");
  await link.press("Space");
  assert.equal(await link.getAttribute("href"), "/blog/");
  await page.keyboard.type("iddqd");
  const b = await link.locator(".breakable-b").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForTimeout(550); // Also catch an accidental navigation after the sign's flight.
  assert.equal(page.url(), base);
  assert.equal(await link.getAttribute("href"), "#site-log");
  await link.click();
  assert.equal(new URL(page.url()).hash, "#site-log");
  await shot("log");
  await page.locator("[data-mend]").click();
  assert.equal(await link.getAttribute("href"), "/blog/");

  for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
    await page.keyboard.press(key);
  }
  assert.match(await status.innerText(), /30 lives/);
  await shot("konami");
  await page.locator("[data-time]").click();
  await shoot(.70, .14);
  assert.match(await status.innerText(), /30 lives/);
  await link.click();
  await page.waitForURL("**/blog/");

  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  assert.equal(await page.locator(".park-canvas").isVisible(), false);
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
  assert.equal(greetings.length, 2);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
