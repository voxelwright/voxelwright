// Browser check for the 404 page ("lost in the fog") on the production build in dist/.
//   npm run build && PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-lost.mjs
// Serves dist/ on a loopback port (or uses BASE), checks status, links, no-script, reduced
// motion, night and 390 px, and writes screenshots to OUT (default .shots/lost).
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { startServer } from "./serve.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const out = resolve(process.env.OUT ?? ".shots/lost");
await mkdir(out, { recursive: true });

const DAY_FOG = "#dbe0e5";
const NIGHT_FOG = "#2c3651";
const DEEP = "/blog/2019/an-old-post-that-moved/";
const LONG = "/" + "a-very-long-address-without-a-single-break-".repeat(4) + "x".repeat(80) + "/";

let server;
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const errors = [];
const passed = [];
const ok = (name) => {
  passed.push(name);
  console.log("ok  " + name);
};

try {
  if (!process.env.BASE) server = await startServer({ root: resolve(import.meta.dirname, "../dist"), port: 0, host: "127.0.0.1" });
  const base = new URL(process.env.BASE ?? `http://127.0.0.1:${server.address().port}/`);
  const url = (p) => new URL(p, base).href;

  // ---- status: every unknown address answers 404 with the page, at any depth ----
  for (const [path, headers] of [
    ["/nope", {}],
    ["/nope/", {}],
    [DEEP, {}],
    ["/blog/missing.png", {}],
    ["/nope/", { Accept: "text/markdown" }],
  ]) {
    const res = await fetch(url(path), { headers, redirect: "manual" });
    const body = await res.text();
    assert.equal(res.status, 404, `${path} ${JSON.stringify(headers)} should be 404, got ${res.status}`);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/, `${path}: the 404 is HTML`);
    assert.match(body, /Nothing here but fog/, `${path}: the 404 body is the lost page`);
  }
  for (const asset of ["/lost/lost.css", "/lost/lost.js", "/lost/fog.js", "/landing/ina.webp"]) {
    const res = await fetch(url(asset));
    assert.equal(res.status, 200, `${asset} is served`);
  }
  ok("status 404 for unknown paths (file, page, deep, markdown) and its assets load");

  const open = async (options, path = DEEP) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...options });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${path}: ${error.message}`));
    const res = await page.goto(url(path), { waitUntil: "networkidle" });
    assert.equal(res.status(), 404, "the page itself answers 404");
    return { context, page };
  };
  const fogVar = (page) => page.evaluate(() => getComputedStyle(document.querySelector(".lost")).getPropertyValue("--fog").trim());
  const live = (page) => page.waitForFunction(() => document.querySelector(".lost")?.dataset.fog === "live", null, { timeout: 5000 });
  // the fog's alpha (0 to 1) at a point in CSS px, read from the low-resolution canvas
  const fogAt = (page, x, y) =>
    page.evaluate(([x, y]) => {
      const c = document.querySelector(".lost-fog");
      const k = c.width / innerWidth;
      return c.getContext("2d").getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data[3] / 255;
    }, [x, y]);
  const fogRGB = (page, x, y) =>
    page.evaluate(([x, y]) => {
      const c = document.querySelector(".lost-fog");
      const k = c.width / innerWidth;
      return [...c.getContext("2d").getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data].slice(0, 3);
    }, [x, y]);

  // ---- day, with motion: the address named, the fog drifting, the pointer clearing it ----
  {
    const { context, page } = await open({ colorScheme: "light" });
    await live(page);
    assert.equal(await page.locator(".lost-path").textContent(), DEEP, "the asked-for address is named");
    assert.equal(await fogVar(page), DAY_FOG);
    assert.equal(await page.locator(".lost-banks").evaluate((e) => getComputedStyle(e).display), "none", "the CSS banks step aside for the canvas");
    // the fog moves on its own
    const before = await page.locator(".lost-fog").evaluate((c) => c.toDataURL());
    await page.waitForTimeout(1200);
    assert.notEqual(await page.locator(".lost-fog").evaluate((c) => c.toDataURL()), before, "the fog drifts");
    // the pointer clears a little where it moves (right of the sign, in the bank)
    const [x, y] = [1000, 640];
    const thick = await fogAt(page, x, y);
    for (let i = 0; i < 12; i++) await page.mouse.move(x - 60 + i * 10, y + (i % 2) * 6);
    await page.waitForTimeout(80);
    const cleared = await fogAt(page, x, y);
    assert.ok(cleared < thick - 0.25, `the pointer clears fog (${thick.toFixed(2)} → ${cleared.toFixed(2)})`);
    // and it closes again
    await page.mouse.move(200, 120);
    await page.waitForTimeout(3000);
    assert.ok((await fogAt(page, x, y)) > cleared + 0.2, "the clearing closes again");
    await page.screenshot({ path: join(out, "day.png") });
    // the Night key turns the fog to night without a reload
    await page.locator(".site-lights").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    assert.equal(await fogVar(page), NIGHT_FOG, "the Night key turns the fog");
    await page.waitForTimeout(300);
    const [r, g, b] = await fogRGB(page, 1100, 560);
    assert.ok(r + g + b < 3 * 140, `the canvas repaints in night colours (${r},${g},${b})`);
    await context.close();
    ok("day: address named, fog drifts, pointer clears and it closes, Night key repaints");
  }

  // ---- links: each way out leads somewhere real, from a deep unknown address ----
  {
    const { context, page } = await open({ colorScheme: "light" });
    const ways = await page.locator(".lost-ways a").evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
    assert.deepEqual(ways, [["Back to the city", "/"], ["Blog", "/blog/"], ["Voxelmorphism", "/voxelmorphism/"]]);
    for (const [name, href] of ways) {
      const res = await fetch(url(href));
      assert.equal(res.status, 200, `${name} (${href}) answers 200`);
    }
    // and a real press follows one, from the page itself
    const [nav] = await Promise.all([page.waitForNavigation(), page.getByRole("link", { name: "Blog", exact: true }).last().click()]);
    assert.equal(nav.status(), 200);
    assert.equal(new URL(page.url()).pathname, "/blog/");
    // the keyboard reaches the plates, and their focus is visible
    await page.goto(url(DEEP));
    const home = page.locator(".lost-home");
    await home.focus();
    const outline = await home.evaluate((a) => getComputedStyle(a).outlineStyle);
    assert.equal(outline, "solid", "a focused plate shows its outline");
    await context.close();
    ok("links: Back to the city, Blog and Voxelmorphism all reach 200 pages, focus visible");
  }

  // ---- no script: static fog, real links, the sentence still reads ----
  for (const scheme of ["light", "dark"]) {
    const { context, page } = await open({ colorScheme: scheme, javaScriptEnabled: false });
    assert.equal(await page.locator(".lost-where").textContent(), "this address");
    assert.match(await page.locator(".lost-note").textContent(), /^No page stands at this address\. Either it was never built, or Karl the Fog has it\.$/);
    assert.equal(await page.locator(".lost-fog").isHidden(), true, "no canvas without a script");
    assert.notEqual(await page.locator(".lost-banks").evaluate((e) => getComputedStyle(e).display), "none", "the CSS fog stands");
    assert.equal(await fogVar(page), scheme === "dark" ? NIGHT_FOG : DAY_FOG, "night follows the system without a script");
    assert.equal(await page.locator(".lost-ways a").count(), 3);
    const [nav] = await Promise.all([page.waitForNavigation(), page.locator(".lost-home").click()]);
    assert.equal(nav.status(), 200);
    await page.goto(url(DEEP));
    await page.screenshot({ path: join(out, `no-script-${scheme === "dark" ? "night" : "day"}.png`) });
    await context.close();
  }
  ok("no script: static fog by day and night, the sentence reads, links work");

  // ---- reduced motion: static fog, no canvas; and the fog stops when it turns on later ----
  {
    const { context, page } = await open({ colorScheme: "light", reducedMotion: "reduce" });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator(".lost").getAttribute("data-fog"), null, "no drifting fog under reduced motion");
    assert.equal(await page.locator(".lost-fog").isHidden(), true);
    assert.notEqual(await page.locator(".lost-banks").evaluate((e) => getComputedStyle(e).display), "none");
    assert.equal(await page.locator(".lost-path").textContent(), DEEP, "the address is still named");
    await page.screenshot({ path: join(out, "reduced-motion.png") });
    await context.close();

    const second = await open({ colorScheme: "light" });
    await live(second.page);
    await second.page.emulateMedia({ reducedMotion: "reduce" });
    await second.page.waitForFunction(() => !document.querySelector(".lost").dataset.fog);
    assert.equal(await second.page.locator(".lost-fog").isHidden(), true, "the fog stops when reduced motion turns on");
    await second.context.close();
  }
  ok("reduced motion: static CSS fog, and a live fog stops when it turns on");

  // ---- night: the system's, the Night key's saved choice, and day chosen at night ----
  {
    const saved = (theme) => ({
      cookies: [],
      origins: [{ origin: base.origin, localStorage: [{ name: "vx-theme", value: theme }] }],
    });
    const night = await open({ colorScheme: "dark" });
    await live(night.page);
    assert.equal(await fogVar(night.page), NIGHT_FOG, "system dark is night");
    const glow = await night.page.locator(".lost-glow").evaluate((e) => getComputedStyle(e).backgroundImage);
    assert.match(glow, /rgba\(255, 124, 32/, "the city glows orange under the fog at night");
    await night.page.waitForTimeout(500);
    await night.page.screenshot({ path: join(out, "night.png") });
    await night.context.close();

    const chosen = await open({ colorScheme: "light", storageState: saved("dark") });
    assert.equal(await fogVar(chosen.page), NIGHT_FOG, "a saved Night choice is night by a light system");
    await chosen.context.close();

    const day = await open({ colorScheme: "dark", storageState: saved("light") });
    assert.equal(await fogVar(day.page), DAY_FOG, "a saved day choice is day by a dark system");
    await day.context.close();
  }
  ok("night: system dark, saved night and saved day all give the right fog");

  // ---- 390 px: nothing wider than the screen, even with a long address; taps part the fog ----
  for (const scheme of ["light", "dark"]) {
    const { context, page } = await open(
      { viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      LONG,
    );
    await live(page);
    const wide = await page.evaluate(() => {
      const over = [...document.querySelectorAll(".lost-sign, .lost-sign *, .site-bar, .site-foot")]
        .filter((e) => getComputedStyle(e).display !== "none")
        .map((e) => [e.className || e.tagName, e.getBoundingClientRect()])
        .filter(([, r]) => r.width && (r.right > innerWidth + 0.5 || r.left < -0.5))
        .map(([n, r]) => `${n} ${Math.round(r.left)}..${Math.round(r.right)}`);
      // the kit's own stage canvas may pass the edge (the page clips it, as on every page)
      scrollTo(400, 0);
      return { over, scroll: document.documentElement.scrollWidth, x: scrollX };
    });
    assert.deepEqual(wide.over, [], "nothing pokes past the screen's edges");
    assert.ok(wide.scroll <= 390 && wide.x === 0, `no sideways scroll (width ${wide.scroll}, scrolled to ${wide.x})`);
    const heights = await page.locator(".lost-ways a").evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
    assert.ok(heights.every((h) => h >= 44), `plates are at least 44 px tall (${heights})`);
    const fontSize = await page.locator(".lost-note").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(fontSize >= 16, "body text at least 16 px");
    if (scheme === "light") {
      // a tap on the scene, above the sign, parts the fog
      const box = await page.locator(".lost-sign").boundingBox();
      const [x, y] = [195, Math.max(150, box.y - 60)];
      const before = await fogAt(page, x, y);
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(500);
      const after = await fogAt(page, x, y);
      assert.ok(after < before - 0.15, `a tap parts the fog (${before.toFixed(2)} → ${after.toFixed(2)})`);
      await page.waitForTimeout(2500);
    }
    await page.screenshot({ path: join(out, `phone-${scheme === "dark" ? "night" : "day"}.png`) });
    await context.close();
  }
  ok("390 px: no sideways scroll or overflow with a long address, 44 px plates, a tap parts the fog");

  // ---- other screens: a middle width keeps its edges; a tall one has nothing to scroll ----
  for (const [width, height] of [[768, 1024], [1280, 1800], [1920, 1080]]) {
    const { context, page } = await open({ viewport: { width, height }, colorScheme: "light" }, LONG);
    const fit = await page.evaluate(() => {
      const r = document.querySelector(".lost-sign").getBoundingClientRect();
      return { left: r.left, right: r.right, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
    });
    assert.ok(fit.left >= 0 && fit.right <= width && fit.scrollWidth <= width, `${width}×${height}: the sign fits (${Math.round(fit.left)}..${Math.round(fit.right)})`);
    assert.ok(fit.scrollHeight <= height, `${width}×${height}: nothing to scroll (${fit.scrollHeight})`);
    await context.close();
  }
  ok("768, 1280×1800 and 1920: the sign fits and a tall screen does not scroll");

  assert.deepEqual(errors, [], "no page errors");
  console.log(`\n${passed.length} checks passed. Screenshots in ${out}`);
} finally {
  await browser.close();
  server?.close();
}
