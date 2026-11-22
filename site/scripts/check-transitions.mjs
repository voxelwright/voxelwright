// Checks moving between pages in real browsers: the view transitions run and carry the bar and
// the title, Back returns to the city from the back/forward cache, the speculation rules are on
// every page, likely pages are prerendered, the city never is, and WebKit just navigates.
//
//   PLAYWRIGHT=<path to playwright> node scripts/check-transitions.mjs
//
// It builds its own copy of the site with drafts (so the blog has posts to open) and serves it
// with scripts/serve.mjs, which sends the platform's own cache headers. OUT (default
// .shots/transitions) receives frame strips of city → blog and blog → post.
//
// Three parts, because the browsers are driven differently:
//   1. Prerendering. Chrome turns prerendering off for a page that a driver attaches to directly
//      ("PrerenderingDisabledByDevTools"), which is how Playwright attaches. So this part starts
//      Chrome itself (CHROME, or the installed Google Chrome) and speaks to it over the DevTools
//      protocol through the tab, which leaves prerendering on.
//   2. Ordinary loads, Back, reduced motion and the films, in Playwright. Playwright starts Chrome
//      with --disable-back-forward-cache, which is dropped here, and a page restored from that
//      cache fires no load event, so Back waits for the commit.
//   3. WebKit, in Playwright: no cross-document transitions, links must simply work.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "../generator/build.mjs";
import { startServer } from "./serve.mjs";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT ?? "playwright");
const ROOT = path.resolve(import.meta.dirname, "..");
const out = path.resolve(ROOT, process.env.OUT ?? ".shots/transitions");
fs.mkdirSync(out, { recursive: true });

const site = fs.mkdtempSync(path.join(os.tmpdir(), "site-transitions-"));
// the city and its moves exist only when the site owns the whole origin, so build it that way
const config = (await import("../site.config.mjs")).default;
await build({ outDir: site, drafts: true, dev: false, site: { ...config, base: "/" } });
const server = await startServer({ root: site, port: 0, host: "127.0.0.1" });
const base = `http://127.0.0.1:${server.address().port}`;
const POST = "/blog/kitchen-sink/";
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isCity = (u) => { try { return new URL(u).pathname === "/"; } catch { return false; } };
// Light graphics, so the city starts quickly beside other work on the machine.
const GRAPHICS = JSON.stringify({ preset: "low", scale: 0.5, dynamic: false, target: 30 });
// The quality check starts above the lowest preset, so a lowering would show.
const MEDIUM = JSON.stringify({ preset: "medium", scale: 0.5, dynamic: false, target: 30 });

// Runs in every document before its own scripts: how it was reached, every transition it takes
// part in, and any GPU adapter asked for while it is still prerendering.
function recorder() {
  const nav = () => performance.getEntriesByType("navigation")[0];
  const log = (window.__moves = {
    url: location.href,
    prerendered: document.prerendering === true,
    activationStart: null,
    deliveryType: null,
    gpuWhilePrerendering: 0,
    shows: [],
    reveals: [],
  });
  const done = () => { log.activationStart = nav()?.activationStart ?? 0; log.deliveryType = nav()?.deliveryType ?? ""; };
  if (document.prerendering) document.addEventListener("prerenderingchange", done, { once: true });
  else done();
  if (navigator.gpu) {
    const ask = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = (...a) => { if (document.prerendering) log.gpuWhilePrerendering++; return ask(...a); };
  }
  addEventListener("pageshow", (e) => log.shows.push({ persisted: e.persisted }));
  addEventListener("pagereveal", (e) => {
    const entry = { vt: !!e.viewTransition, ran: null };
    log.reveals.push(entry);
    e.viewTransition?.ready.then(
      () => {
        entry.ran = true;
        entry.types = [...(e.viewTransition.types ?? [])];
        entry.parts = document.getAnimations().map((a) => a.effect?.pseudoElement).filter(Boolean);
        // filming: hold the transition so it can be shown at exact moments
        if (sessionStorage.getItem("check-transitions-film")) {
          const held = document.getAnimations().filter((a) => a.effect?.pseudoElement?.startsWith("::view-transition"));
          for (const a of held) a.pause();
          window.__seek = (ms) => {
            for (const a of held) a.currentTime = ms;
            return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          };
          window.__release = () => { for (const a of held) a.play(); };
        }
      },
      () => { entry.ran = false; },
    );
  });
}
const settled = "(() => { const r = window.__moves?.reveals.at(-1); return !!r && (!r.vt || r.ran !== null); })()";
const has = (reveal, ...parts) => parts.every((p) => reveal.parts?.includes(p));
const TITLE = ["::view-transition-old(page-title)", "::view-transition-new(page-title)"];
const BAR = ["::view-transition-old(site-bar)", "::view-transition-new(site-bar)"];

// ---------------------------------------------------------------------------------------------
// 1. Prerendering, through the tab.

async function chromeOverTab() {
  const exe = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-transitions-"));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--enable-unsafe-webgpu", "--window-size=1280,800", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let text = "";
    proc.stderr.on("data", (d) => { text += d; const m = text.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    proc.on("exit", () => reject(new Error("Chrome exited: " + text)));
  });
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map(), pages = new Map(), events = [];
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  ws.addEventListener("message", async ({ data }) => {
    const d = JSON.parse(data);
    if (d.id) return pending.get(d.id)?.(d), pending.delete(d.id);
    events.push(d);
    if (d.method === "Target.attachedToTarget" && d.params.targetInfo.type === "page") {
      const s = d.params.sessionId;
      pages.set(s, d.params.targetInfo);
      // every page in the tab, prerendered ones included, gets the recorder before it runs
      // (sent together: a target waiting for its debugger may answer none until it runs)
      await Promise.all([
        send("Page.enable", {}, s),
        send("Page.addScriptToEvaluateOnNewDocument", { source: `(${recorder})()` }, s),
        send("Preload.enable", {}, s),
        send("Runtime.runIfWaitingForDebugger", {}, s),
      ].map((p) => p.catch(() => {})));
    }
    if (d.method === "Target.detachedFromTarget") pages.delete(d.params.sessionId);
  });
  const { targetInfos } = await send("Target.getTargets", { filter: [{ type: "tab" }] });
  const { sessionId: tab } = await send("Target.attachToTarget", { targetId: targetInfos[0].targetId, flatten: true });
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, tab);
  while (!pages.size) await wait(50);

  const evaluate = async (s, expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s)).result?.value;
  // the page the tab shows: not one still prerendering, not one waiting in the back/forward cache
  async function shown() {
    for (const s of pages.keys()) {
      if (await evaluate(s, "!document.prerendering && document.visibilityState === 'visible'").catch(() => false)) return s;
    }
    return null;
  }
  async function until(expression, ms = 10000, what = expression) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await shown();
      if (s && (await evaluate(s, expression).catch(() => false))) return s;
      await wait(50);
    }
    throw new Error(`timed out waiting for ${what}`);
  }
  const at = async (selector) => {
    const s = await shown();
    return evaluate(s, `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`);
  };
  const mouse = async (type, [x, y]) => send("Input.dispatchMouseEvent", {
    type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1,
  }, await shown());
  return {
    events, evaluate, shown, until, at,
    async go(href) { await send("Page.navigate", { url: href }, await shown()); },
    async hover(selector, ms) { const p = await at(selector); assert.ok(p, `${selector} is on screen`); await mouse("mouseMoved", p); await wait(ms); return p; },
    async click(p) { await mouse("mouseMoved", p); await mouse("mousePressed", p); await mouse("mouseReleased", p); },
    async moves() { return evaluate(await shown(), "window.__moves"); },
    async setup(script) { for (const s of pages.keys()) await evaluate(s, script); },
    async close() { proc.kill(); await wait(200); fs.rmSync(profile, { recursive: true, force: true }); },
  };
}

async function prerendering() {
  const tab = await chromeOverTab();
  try {
    const attempts = (kind) => tab.events.filter((e) => e.method === `Preload.${kind}StatusUpdated`).map((e) => ({ url: e.params.key.url, status: e.params.status, why: e.params.prerenderStatus }));
    await tab.go(base + "/blog/");
    await tab.until("location.pathname === '/blog/'");
    await tab.setup(`localStorage.setItem("village.graphics", ${JSON.stringify(GRAPHICS)}); localStorage.setItem("support-button-muted", "1")`);

    // the rules are on every page, parse, and are understood
    for (const route of ["/", "/blog/", "/tags/", "/voxelmorphism/", POST]) {
      const html = await (await fetch(base + route)).text();
      const rules = [...html.matchAll(/<script type="speculationrules">([\s\S]*?)<\/script>/g)];
      assert.equal(rules.length, 1, `${route} has one set of speculation rules`);
      const parsed = JSON.parse(rules[0][1]);
      assert.ok(parsed.prerender?.length && parsed.prefetch?.length, `${route}: prerender and prefetch rules`);
    }
    const ruleSets = () => tab.events.filter((e) => e.method === "Preload.ruleSetUpdated");
    for (let t = 0; t < 50 && !ruleSets().length; t++) await wait(100);
    assert.ok(ruleSets().length && ruleSets().every((e) => !e.params.ruleSet.errorType), "Chrome accepts the rules");

    // the city at medium quality: first a rest away from the signs (the control), then a rest on
    // the BLOG sign; the Blog is prerendered and the city keeps its quality
    await tab.setup(`localStorage.setItem("village.graphics", ${JSON.stringify(MEDIUM)})`);
    await tab.go(base + "/");
    await tab.until("!!document.querySelector('.overlook[data-live]')", 30000, "the live city");
    const preset = "document.querySelector('.display-settings [name=preset]').value";
    await tab.hover(".park-view", 100);
    await wait(2500);
    const control = await tab.evaluate(await tab.shown(), preset);
    await tab.until("!!document.querySelector('.park-sign a[data-sign=blog][data-hit]')", 5000, "the BLOG sign");
    const sign = await tab.hover(".park-sign a[data-sign=blog][data-hit]", 300);
    const ready = (u) => attempts("prerender").some((a) => a.url === u && a.status === "Ready");
    for (let t = 0; t < 100 && !ready(base + "/blog/"); t++) await wait(100);
    assert.ok(ready(base + "/blog/"), `the Blog is prerendered from the city sign: ${JSON.stringify(attempts("prerender"))}`);
    await wait(1000);
    const after = await tab.evaluate(await tab.shown(), preset);
    assert.equal(after, control, "a prerender started from the city does not lower its quality");
    await tab.click(sign);
    await tab.until(`location.pathname === '/blog/' && ${settled}`, 5000, "the Blog after the flight");
    let log = await tab.moves();
    assert.ok(log.activationStart > 0, "the Blog shown is the prerendered one");
    assert.equal(log.gpuWhilePrerendering, 0, "the prerendered Blog opened no GPU adapter before it was shown");
    let reveal = log.reveals.at(-1);
    assert.equal(reveal.ran, true, "city → prerendered Blog runs a view transition");
    assert.ok(reveal.types.includes("from-city") && has(reveal, ...TITLE), "the sign travels into the Blog title");

    // Back: the city from the back/forward cache, at once
    await tab.evaluate(await tab.shown(), "history.back()");
    await tab.until("location.pathname === '/' && window.__moves.shows.at(-1)?.persisted === true", 5000, "the city restored from the back/forward cache");
    log = await tab.moves();
    assert.ok(log.reveals.at(-1).ran !== true, "Back to the city plays no transition");
    await tab.until("!!document.querySelector('.overlook[data-live]')", 2000, "the city still live");

    // the other sign: the Signal Desk, prerendered, its title from the sign, live once shown
    await tab.until("!!document.querySelector('.park-sign a[data-sign=voxel][data-hit]')", 5000, "the Voxelmorphism sign");
    const desk = await tab.hover(".park-sign a[data-sign=voxel][data-hit]", 300);
    for (let t = 0; t < 100 && !ready(base + "/voxelmorphism/"); t++) await wait(100);
    assert.ok(ready(base + "/voxelmorphism/"), "the Signal Desk is prerendered from its sign");
    await tab.click(desk);
    await tab.until(`location.pathname === '/voxelmorphism/' && ${settled}`, 5000, "the Signal Desk after the flight");
    log = await tab.moves();
    assert.ok(log.activationStart > 0, "the Signal Desk shown is the prerendered one");
    assert.equal(log.gpuWhilePrerendering, 0, "the prerendered Signal Desk opened no GPU adapter before it was shown");
    reveal = log.reveals.at(-1);
    assert.ok(reveal.ran && has(reveal, ...TITLE), "a second sign after Back carries its title too (the first sign's name is gone)");
    await tab.until("document.documentElement.dataset.vx === 'live' && document.querySelector('#desk-fallback').hidden", 15000, "the Signal Desk live, its fallback put away");

    // the Blog's list: a rest on a post prerenders it; the Night key is pressed while it waits; the
    // post arrives with the time of day chosen, its row's title grown into its title
    await tab.go(base + "/blog/");
    await tab.until(`location.pathname === '/blog/' && document.documentElement.dataset.vx === 'live'`, 15000, "the Blog");
    // (this Chrome follows the system's light or dark, so the press goes to whichever is not)
    const wasNight = (await tab.evaluate(await tab.shown(), "document.querySelector('.site-lights').getAttribute('aria-pressed')")) === "true";
    const chosen = wasNight ? "light" : "dark";
    const row = await tab.hover(`.post-list a[href="${POST}"]`, 300);
    for (let t = 0; t < 100 && !ready(base + POST); t++) await wait(100);
    assert.ok(ready(base + POST), "the post is prerendered from its row");
    await tab.click(await tab.at(".site-lights"));
    await tab.until(`document.documentElement.dataset.theme === '${chosen}'`, 2000, `${chosen} chosen on the Blog`);
    await tab.click(row);
    await tab.until(`location.pathname === '${POST}' && ${settled}`, 5000, "the post");
    log = await tab.moves();
    assert.ok(log.activationStart > 0, "the post shown is the prerendered one, prepared before the press");
    assert.equal(await tab.evaluate(await tab.shown(), "document.documentElement.dataset.theme"), chosen, "and it arrives with the time of day chosen meanwhile");
    assert.equal(log.gpuWhilePrerendering, 0, "the prerendered post opened no GPU adapter before it was shown");
    reveal = log.reveals.at(-1);
    assert.equal(reveal.ran, true, "blog → prerendered post runs a view transition");
    assert.ok(has(reveal, ...TITLE, ...BAR), "the row's title travels into the post title and the bar is held");
    await tab.until(`document.documentElement.dataset.vx === 'live' && document.querySelector('.site-lights').getAttribute('aria-pressed') === '${!wasNight}'`, 15000, "the post's kit, live once shown, its Night key as chosen");

    // a rest on the bar's name, then the city: prefetched, never prerendered
    await tab.hover(".site-bar .vx-navbar-brand", 1200);
    await tab.click(await tab.at(".site-bar .vx-navbar-brand"));
    await tab.until("location.pathname === '/'", 5000, "the city");
    log = await tab.moves();
    assert.equal(log.prerendered, false, "the city never starts prerendered");
    assert.equal(log.activationStart, 0, "the city is not activated from a prerender");
    assert.equal(log.deliveryType, "navigational-prefetch", "the city's page arrives from the prefetch");
    assert.ok(!attempts("prerender").some((a) => isCity(a.url)), "no prerender of the city was ever attempted");
    assert.ok(attempts("prefetch").some((a) => isCity(a.url)), "the city is prefetched instead");
    console.log(`chrome, prerendering: Blog, Signal Desk and post prerendered and shown with transitions, no GPU before shown, a night chosen meanwhile taken up, the city's quality held (${control}); city prefetched only (${attempts("prerender").length} prerender, ${attempts("prefetch").length} prefetch updates)`);
  } finally {
    await tab.close();
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Ordinary loads in Playwright: the transitions, Back, the second departure, reduced motion,
//    and the films.

async function lastReveal(page) {
  await page.waitForFunction(settled, null, { timeout: 5000 });
  return page.evaluate(() => window.__moves.reveals.at(-1));
}

// A move filmed at exact moments: the next page's transition is held as it starts, then shown
// at each time in `times` (ms), and the stills are kept one by one and as one strip.
async function film(page, name, act, times = [0, 40, 80, 120, 160, 200, 240, 280, 320, 380, 440, 520]) {
  const dir = path.join(out, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = [path.join(dir, "before.png")];
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.effect?.pseudoElement?.startsWith("::view-transition")));
  await page.screenshot({ path: files[0] });
  await page.evaluate(() => sessionStorage.setItem("check-transitions-film", "1"));
  await act();
  await page.waitForFunction(() => typeof window.__seek === "function", null, { timeout: 5000 });
  for (const t of times) {
    await page.evaluate((t) => window.__seek(t), t);
    const file = path.join(dir, `${String(t).padStart(4, "0")}ms.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await page.evaluate(() => { sessionStorage.removeItem("check-transitions-film"); window.__release(); });
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "strip-"));
    files.forEach((f, i) => fs.copyFileSync(f, path.join(tmp, `f${String(i).padStart(3, "0")}.png`)));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(tmp, "f%03d.png"),
      "-vf", `scale=480:-2,tile=4x${Math.ceil(files.length / 4)}`, "-frames:v", "1", path.join(out, `${name}.jpg`)]);
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    console.log(`(no strip for ${name}: ${e.message.split("\n")[0]})`);
  }
  return files.length;
}

async function ordinaryLoads() {
  const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"], ignoreDefaultArgs: ["--disable-back-forward-cache"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: { cookies: [], origins: [{ origin: base, localStorage: [{ name: "village.graphics", value: GRAPHICS }, { name: "support-button-muted", value: "1" }] }] },
    });
    await context.addInitScript(recorder);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`chrome ${page.url()}: ${e.message}`));

    // city → blog: the pressed sign becomes the Blog's title, the bar settles in
    await page.goto(base + "/");
    await page.locator(".overlook[data-live]").waitFor({ timeout: 30000 });
    const sign = page.locator('.park-sign a[data-sign="blog"][data-hit]');
    const cityFrames = await film(page, "city-to-blog", async () => {
      await sign.click();
      await page.waitForURL(base + "/blog/");
    });
    let reveal = await lastReveal(page);
    assert.equal(reveal.ran, true, "city → blog runs a view transition");
    assert.ok(reveal.types.includes("from-city"), "it is marked as an arrival from the city");
    assert.ok(has(reveal, ...TITLE), "the sign travels into the Blog title");
    assert.ok(has(reveal, "::view-transition-new(site-bar)") && !has(reveal, "::view-transition-old(site-bar)"), "the bar settles in (the city has none)");
    await page.locator(":root[data-vx]").waitFor({ timeout: 15000 });
    await page.screenshot({ path: path.join(out, "blog-after-city.png") });

    // Back: the city comes back whole, at once, and its sign works again
    await page.goBack({ waitUntil: "commit" });
    await page.waitForFunction(() => window.__moves?.shows.at(-1)?.persisted === true, null, { timeout: 5000 });
    assert.ok(isCity(page.url()), "Back lands on the city");
    assert.notEqual((await lastReveal(page)).ran, true, "Back to the city plays no transition");
    await page.locator(".overlook[data-live]").waitFor({ timeout: 2000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "city-after-back.png") });
    // the other sign next: if the BLOG sign still held its name, two names would skip the move
    const other = page.locator('.park-sign a[data-sign="voxel"][data-hit]');
    await other.waitFor({ timeout: 5000 });
    await other.click();
    await page.waitForURL(base + "/voxelmorphism/");
    reveal = await lastReveal(page);
    assert.ok(reveal.ran && reveal.types.includes("from-city") && has(reveal, ...TITLE), "a second departure, by the other sign, carries its title");
    await page.goBack({ waitUntil: "commit" });
    await page.waitForFunction(() => window.__moves?.shows.at(-1)?.persisted === true, null, { timeout: 5000 });
    await sign.waitFor({ timeout: 5000 });
    await sign.click();
    await page.waitForURL(base + "/blog/");
    reveal = await lastReveal(page);
    assert.ok(reveal.ran && has(reveal, ...TITLE), "and a third, by the first sign again");

    // blog → post: the row's title grows into the post's, the bar is held
    await page.locator(":root[data-vx]").waitFor({ timeout: 15000 });
    const row = page.locator(`.post-list a[href="${POST}"]`);
    const postFrames = await film(page, "blog-to-post", async () => {
      await row.click();
      await page.waitForURL(base + POST);
    });
    reveal = await lastReveal(page);
    assert.equal(reveal.ran, true, "blog → post runs a view transition");
    assert.ok(has(reveal, ...TITLE, ...BAR), "the row's title travels into the post title and the bar is held");
    await page.screenshot({ path: path.join(out, "post.png") });

    // post → blog by Back: the title returns to its row
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(base + "/blog/", { waitUntil: "commit" });
    reveal = await lastReveal(page);
    assert.equal(reveal.ran, true, "Back to the blog runs a view transition");
    assert.ok(has(reveal, ...TITLE), "the title goes back to its row");

    // the other post: the first row's name from the way back is gone, so this one runs too
    const other2 = await page.locator(".post-list a.vx-item").evaluateAll((as, post) => as.map((a) => a.getAttribute("href")).find((h) => h !== post), POST);
    await page.locator(`.post-list a[href="${other2}"]`).click();
    await page.waitForURL(base + other2);
    reveal = await lastReveal(page);
    assert.ok(reveal.ran && has(reveal, ...TITLE, ...BAR), "a second post after Back carries its title");
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(base + "/blog/", { waitUntil: "commit" });
    await lastReveal(page);

    // from a post read past its bar and title: they fade with the page instead of flying in from above
    await page.locator(`.post-list a[href="${POST}"]`).click();
    await page.waitForURL(base + POST);
    await lastReveal(page);
    await page.evaluate(() => window.scrollTo(0, 320));
    const scrolledFrames = await film(page, "scrolled-post-to-blog", async () => {
      await page.locator('.post-body a[href="/blog/"]').click();
      await page.waitForURL(base + "/blog/");
    }, [0, 40, 80, 120, 160, 200, 260, 340]);
    reveal = await lastReveal(page);
    assert.ok(reveal.ran && has(reveal, "::view-transition-new(site-bar)") && !has(reveal, "::view-transition-old(site-bar)"), "the bar scrolled out of sight is not carried");
    assert.ok(!has(reveal, "::view-transition-old(page-title)"), "nor is the title scrolled out of sight");

    // blog → tags: one lettering into the next
    await page.locator(".page-tools a[href='/tags/']").click();
    await page.waitForURL(base + "/tags/");
    reveal = await lastReveal(page);
    assert.ok(reveal.ran && has(reveal, ...TITLE, ...BAR), "blog → tags carries the title and holds the bar");

    // tags → city by the bar's name: the page fades into the city
    await page.locator(".site-bar .vx-navbar-brand").click();
    await page.waitForURL(base + "/");
    reveal = await lastReveal(page);
    assert.ok(reveal.ran && reveal.types.includes("to-city"), "into the city by a link fades");

    // Night pressed on the Blog, then Back: the city kept in the cache by day comes back at night
    await page.locator(".overlook[data-live]").waitFor({ timeout: 30000 });
    assert.equal(await page.locator("[data-time]").getAttribute("aria-pressed"), "false", "the city starts by day");
    await sign.waitFor({ timeout: 5000 });
    await sign.click();
    await page.waitForURL(base + "/blog/");
    await lastReveal(page);
    await page.locator(".site-lights").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await page.goBack({ waitUntil: "commit" });
    await page.waitForFunction(() => window.__moves?.shows.at(-1)?.persisted === true, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "the restored city takes up the night");
    await page.waitForFunction(() => document.querySelector("[data-time]").getAttribute("aria-pressed") === "true", null, { timeout: 3000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "city-night-after-back.png") });
    console.log(`chrome, ordinary loads: transitions run, bar held, title carried by either sign and either post, nothing carried from out of sight, Back restores the city from the back/forward cache and takes up a night chosen meanwhile (films: ${cityFrames}, ${postFrames} and ${scrolledFrames} stills)`);
    await context.close();

    // reduced motion: one short cross-fade, nothing named, nothing moving
    const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await calm.addInitScript(recorder);
    const quiet = await calm.newPage();
    quiet.on("pageerror", (e) => errors.push(`chrome ${quiet.url()}: ${e.message}`));
    await quiet.goto(base + "/blog/");
    await quiet.locator(`.post-list a[href="${POST}"]`).click();
    await quiet.waitForURL(base + POST);
    reveal = await lastReveal(quiet);
    assert.equal(reveal.ran, true, "reduced motion still cross-fades");
    assert.deepEqual([...new Set(reveal.parts.map((p) => p.match(/\((.*)\)/)[1]))], ["root"], "and moves nothing but the page's fade");
    console.log("chrome, reduced motion: a cross-fade only");
    await calm.close();
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------
// 3. WebKit: the links simply work, and the head's script throws nothing.

async function inWebKit() {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(recorder);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`webkit ${page.url()}: ${e.message}`));
    await page.goto(base + "/blog/");
    await page.locator(`.post-list a[href="${POST}"]`).click();
    await page.waitForURL(base + POST);
    assert.match(await page.locator("h1").innerText(), /\S/);
    const moved = await page.waitForFunction(settled, null, { timeout: 5000 }).then(() => page.evaluate(() => window.__moves.reveals.at(-1)), () => null);
    await page.screenshot({ path: path.join(out, "webkit-post.png") });
    await page.goBack();
    await page.waitForURL(base + "/blog/");
    await page.locator(".site-bar .vx-navbar-brand").click();
    await page.waitForURL(base + "/");
    await page.goto(base + "/blog/");
    const support = await page.evaluate(() => ({ reveal: "onpagereveal" in window, rules: HTMLScriptElement.supports?.("speculationrules") ?? false }));
    const ran = moved?.ran ? `a transition ran, carrying ${[...new Set(moved.parts.map((p) => p.match(/\((.*)\)/)[1]))].join(", ")}` : "no transition";
    console.log(`webkit: links navigate; blog → post: ${ran} (pagereveal ${support.reveal ? "supported" : "absent"}, speculation rules ${support.rules ? "supported" : "absent"})`);
  } finally {
    await browser.close();
  }
}

try {
  await prerendering();
  await ordinaryLoads();
  await inWebKit();
  assert.deepEqual(errors, [], "no page errors");
  console.log(`transitions: ok (films in ${path.relative(ROOT, out)})`);
} finally {
  server.close();
  fs.rmSync(site, { recursive: true, force: true });
}
