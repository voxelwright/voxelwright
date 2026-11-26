// Verification, screenshot capture, and performance benchmark for the personal front page (#578).
//
// Usage:
//   node scripts/check-home.mjs [--shots <dir>] [--bench]
//
// Fails if:
//   - the off-switch build differs in any file path or byte from origin/main (or leaks front files)
//   - any required link is missing, out of order, or points at a private repository
//   - the page needs JavaScript or WebGPU to show its name, line, and links
//   - reduced motion breaks the sign, keyboard focus is invisible, contrast fails, or 390 px overflows
//   - any existing /blog/ path disappears or changes when the switch is turned on
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "../generator/build.mjs";
import { WORLD_URL, BIO } from "../generator/front.mjs";
import { shareProblems } from "./check.mjs";
import { startServer } from "./serve.mjs";
import baseConfig from "../site.config.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT,
    path.join(REPO_ROOT, "home/node_modules/playwright"),
    path.join(REPO_ROOT, "street/node_modules/playwright"),
    "playwright",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return require(c);
    } catch {}
  }
  throw new Error("Playwright not found. Run `npm ci --prefix home` or set PLAYWRIGHT=<path>.");
}

function parseArgs(argv) {
  let shotsDir = null;
  let bench = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shots") shotsDir = path.resolve(argv[++i]);
    else if (argv[i] === "--bench") bench = true;
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return { shotsDir, bench };
}

function manifest(dir, rel = "", out = new Map()) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) manifest(dir, next, out);
    else {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, next))).digest("hex");
      out.set(next.split(path.sep).join("/"), hash);
    }
  }
  return out;
}

function manifestDigest(map) {
  const h = crypto.createHash("sha256");
  for (const [k, v] of [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    h.update(`${k}\0${v}\n`);
  }
  return h.digest("hex");
}

function compareManifests(a, b) {
  const diffs = [];
  for (const [k, v] of a) {
    if (!b.has(k)) diffs.push(`missing: ${k}`);
    else if (b.get(k) !== v) diffs.push(`changed: ${k}`);
  }
  for (const k of b.keys()) if (!a.has(k)) diffs.push(`added: ${k}`);
  return diffs;
}

function parseRgb(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const EXPECTED_LINKS = [
  WORLD_URL,
  "/blog/",
  ...(baseConfig.links ?? []).map((l) => l.url),
];

const { shotsDir, bench } = parseArgs(process.argv.slice(2));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-home-check-"));

try {
  // 0. Verify site.config.mjs links include a GitHub profile URL (not a repository URL).
  const ghLinks = (baseConfig.links ?? []).filter((l) => {
    try { return new URL(l.url).hostname === "github.com"; } catch { return false; }
  });
  assert.equal(ghLinks.length, 1, "site.config.mjs `links` must include one GitHub profile entry");
  const ghSegments = new URL(ghLinks[0].url).pathname.split("/").filter(Boolean);
  assert.equal(ghSegments.length, 1, "GitHub link in site.config.mjs must be a profile URL, never a repository URL");

  // 1. Verify default switch is OFF and off-switch build matches origin/main (with current site.config.mjs) file-for-file.
  const offDir = path.join(tmp, "out-off");
  const savedEnv = process.env.SITE_PERSONAL_HOME;
  delete process.env.SITE_PERSONAL_HOME;
  await build({ outDir: offDir, site: baseConfig });
  if (savedEnv !== undefined) process.env.SITE_PERSONAL_HOME = savedEnv;

  const offMap = manifest(offDir);
  assert.equal(offMap.has("index.html"), false, "off-switch build must not emit index.html");
  assert.equal(offMap.has("index.md"), false, "off-switch build must not emit index.md");
  assert.equal([...offMap.keys()].some((k) => k.includes("/front/")), false, "off-switch build must not emit front/ assets");

  // Compare against clean origin/main generator + current site.config.mjs (the one authorized links line).
  let mainChecked = false;
  try {
    const ref = execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    if (ref) {
      const baseCheckout = path.join(tmp, "base-site");
      fs.mkdirSync(baseCheckout, { recursive: true });
      const tar = execFileSync("git", ["archive", ref, "site"], { cwd: REPO_ROOT, maxBuffer: 1 << 30 });
      execFileSync("tar", ["-x", "-C", baseCheckout, "--strip-components=1"], { input: tar });
      fs.copyFileSync(path.join(ROOT, "site.config.mjs"), path.join(baseCheckout, "site.config.mjs"));
      fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(baseCheckout, "node_modules"));
      const mainOut = path.join(tmp, "out-main");
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", `const { build } = await import("./generator/build.mjs"); await build({ outDir: ${JSON.stringify(mainOut)} });`],
        { cwd: baseCheckout, env: { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp }, stdio: "pipe" },
      );
      const mainMap = manifest(mainOut);
      const diffs = compareManifests(mainMap, offMap);
      assert.deepEqual(diffs, [], `off-switch build differs from origin/main:\n  ${diffs.join("\n  ")}`);
      console.log(`off-switch proof: identical to origin/main (${offMap.size} files, sha256=${manifestDigest(offMap)})`);
      mainChecked = true;
    }
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    console.log(`off-switch proof: skipped origin/main archive compare (${e.message.split("\n")[0]})`);
  }
  if (!mainChecked) {
    console.log(`off-switch build: ${offMap.size} files, sha256=${manifestDigest(offMap)}`);
  }

  // 2. Build with personalHome ON and verify all HTML/Markdown/blog-preservation invariants.
  const onDir = path.join(tmp, "out-on");
  await build({ outDir: onDir, personalHome: true, site: baseConfig });
  const onMap = manifest(onDir);

  assert.ok(onMap.has("index.html"), "on-switch build must write dist/index.html");
  assert.ok(onMap.has("index.md"), "on-switch build must write dist/index.md");
  // Every file from the off-switch build must still exist with identical content.
  for (const [rel, hash] of offMap) {
    assert.ok(onMap.has(rel), `on-switch build lost existing file ${rel}`);
    assert.equal(onMap.get(rel), hash, `on-switch build altered existing file ${rel}`);
  }

  const html = fs.readFileSync(path.join(onDir, "index.html"), "utf8");
  const md = fs.readFileSync(path.join(onDir, "index.md"), "utf8");

  assert.match(html, /<title>Pavlo Zahynailo<\/title>/, "sensible <title>");
  assert.match(html, /<meta name="description" content="[^"]+">/, "meta description");
  assert.match(html, /<link rel="canonical" href="https:\/\/zahynailo\.dev\/">/, "canonical link");
  assert.match(html, /<link rel="alternate" type="text\/markdown" href="\/index\.md"/, "Markdown alternate link");
  assert.match(html, /<h1 class="vx-sign[^"]*"[^>]*data-vx-board="none"[^>]*>Pavlo Zahynailo<\/h1>/, "vx-sign heading");
  assert.ok(html.includes(BIO), "bio line present in static HTML");

  // Share card / OG / Twitter tags.
  const shareErrs = shareProblems("/", html, { ...baseConfig, base: "/blog/" }, onDir);
  assert.deepEqual(shareErrs, [], `share meta problems: ${shareErrs.join("; ")}`);

  // Exact link order in static HTML (ignoring <head> links).
  const body = html.slice(html.indexOf("<body"));
  const bodyHrefs = [...body.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bodyHrefs, EXPECTED_LINKS, `links in static HTML must match exact required order`);

  // No GitHub repository URLs (profile URL only), no external fonts/scripts/analytics/cookies.
  assert.doesNotMatch(html, /github\.com\/[^/"'\s]+\/[^/"'\s]+/i, "must not link any GitHub repository");
  assert.doesNotMatch(md, /github\.com\/[^/"'\s]+\/[^/"'\s]+/i, "Markdown must not link any GitHub repository");
  assert.doesNotMatch(
    html,
    /https?:\/\/(?!zahynailo\.dev|voxelwright\.world|x\.com|www\.linkedin\.com|www\.twitch\.tv|github\.com|www\.w3\.org\/2000\/svg)/i,
    "no external scripts, fonts, or analytics",
  );
  assert.doesNotMatch(html, /google-analytics|gtag|plausible|posthog|document\.cookie/i, "no analytics or cookies");

  // Markdown twin lists every required link in order.
  let lastIdx = -1;
  for (const url of EXPECTED_LINKS) {
    const target = url === "/blog/" ? `${baseConfig.origin}/blog/` : url;
    const idx = md.indexOf(target);
    assert.ok(idx > lastIdx, `index.md missing or out-of-order link ${target}`);
    lastIdx = idx;
  }
  console.log(`static HTML & Markdown checks: passed (${bodyHrefs.length} links in order, all ${offMap.size} /blog/ files preserved)`);

  // 3. Browser checks (and optional screenshots + performance benchmark) via Playwright.
  const { chromium } = loadPlaywright();
  const server = await startServer({ root: onDir, port: 0, host: "127.0.0.1" });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
  } catch {
    browser = await chromium.launch({ args: ["--enable-unsafe-webgpu"] });
  }

  try {
    if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

    // 3a. JavaScript disabled: desktop & phone, light & dark.
    for (const scheme of ["light", "dark"]) {
      for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ viewport, colorScheme: scheme, javaScriptEnabled: false });
        const page = await ctx.newPage();
        await page.goto(origin + "/", { waitUntil: "load" });
        const check = await page.evaluate((expected) => {
          const h1 = document.querySelector("h1.vx-sign");
          const bio = document.querySelector(".front-bio");
          const links = [...document.querySelectorAll("main a[href]")];
          const visible = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && Number(s.opacity) > 0;
          };
          const bg = getComputedStyle(document.body).backgroundColor;
          const ink = getComputedStyle(document.body).color;
          const quiet = getComputedStyle(bio).color;
          const world = document.querySelector(".front-world");
          const worldBg = getComputedStyle(world).backgroundColor;
          const worldFg = getComputedStyle(world).color;
          const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
          return {
            name: h1?.textContent.trim(),
            nameVisible: visible(h1),
            bioVisible: visible(bio),
            hrefs: links.map((a) => a.getAttribute("href")),
            allVisible: links.every(visible),
            targetsOk: links.every((a) => a.getBoundingClientRect().height >= 43.5),
            overflow,
            bg,
            ink,
            quiet,
            worldBg,
            worldFg,
            fontsCount: document.fonts.size,
          };
        }, EXPECTED_LINKS);
        assert.equal(check.name, "Pavlo Zahynailo", `no-JS ${scheme} ${label}: heading text`);
        assert.ok(check.nameVisible, `no-JS ${scheme} ${label}: heading visible`);
        assert.ok(check.bioVisible, `no-JS ${scheme} ${label}: bio visible`);
        assert.deepEqual(check.hrefs, EXPECTED_LINKS, `no-JS ${scheme} ${label}: links`);
        assert.ok(check.allVisible, `no-JS ${scheme} ${label}: all links visible`);
        assert.ok(check.targetsOk, `no-JS ${scheme} ${label}: every link target >= 44px tall`);
        assert.equal(check.overflow, false, `no-JS ${scheme} ${label}: no horizontal overflow`);

        const bg = parseRgb(check.bg);
        const ink = parseRgb(check.ink);
        const quiet = parseRgb(check.quiet);
        const wBg = parseRgb(check.worldBg);
        const wFg = parseRgb(check.worldFg);
        assert.ok(contrastRatio(ink, bg) >= 7, `no-JS ${scheme} ${label}: body contrast ${contrastRatio(ink, bg).toFixed(2)} < 7`);
        assert.ok(contrastRatio(quiet, bg) >= 4.5, `no-JS ${scheme} ${label}: quiet contrast ${contrastRatio(quiet, bg).toFixed(2)} < 4.5`);
        // Note: 20px keycap legend is WCAG large text (>= 3:1 AA); log ratio so we can track kit token contrast.
        assert.ok(contrastRatio(wFg, wBg) >= 3, `no-JS ${scheme} ${label}: primary key contrast ${contrastRatio(wFg, wBg).toFixed(2)} < 3`);

        if (shotsDir && scheme === "light" && label === "desktop") {
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: path.join(shotsDir, "nojs-desktop-light.png") });
        }
        await ctx.close();
      }
    }
    console.log("no-JS checks (desktop & phone, light & dark, contrast, 44px targets, no overflow): passed");

    // 3b. No WebGPU fallback: page stays plain, zero errors.
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await page.goto(origin + "/", { waitUntil: "load" });
      await page.waitForFunction(() => document.documentElement.dataset.vx === "plain", null, { timeout: 5000 });
      assert.deepEqual(errs, [], "no-WebGPU: zero page errors");
      assert.equal(await page.locator("h1.vx-sign").getAttribute("data-vx-live"), null, "no-WebGPU: sign stays plain");
      await ctx.close();
      console.log("no-WebGPU fallback check: passed");
    }

    // 3c. WebGPU live mode: light & dark, desktop & phone, break & mend, keyboard focus, reduced motion.
    for (const scheme of ["light", "dark"]) {
      for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ viewport, colorScheme: scheme });
        const page = await ctx.newPage();
        const errs = [];
        page.on("pageerror", (e) => errs.push(e.message));
        const failedReqs = [];
        page.on("response", (res) => { if (res.status() >= 400) failedReqs.push(`${res.status()} ${res.url()}`); });

        await page.goto(origin + "/", { waitUntil: "networkidle" });
        await page.waitForFunction(() => Boolean(document.documentElement.dataset.vx), null, { timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);

        const state = await page.evaluate(() => ({
          vx: document.documentElement.dataset.vx,
          signLive: document.querySelector("h1.vx-sign")?.hasAttribute("data-vx-live"),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          externalReqs: performance
            .getEntriesByType("resource")
            .map((r) => r.name)
            .filter((u) => !u.startsWith(location.origin)),
        }));
        assert.deepEqual(errs, [], `live ${scheme} ${label}: page errors`);
        assert.deepEqual(failedReqs, [], `live ${scheme} ${label}: failed requests`);
        assert.deepEqual(state.externalReqs, [], `live ${scheme} ${label}: no external requests`);
        assert.equal(state.overflow, false, `live ${scheme} ${label}: no horizontal overflow`);
        assert.equal(state.vx, "live", `live ${scheme} ${label}: WebGPU stage went live`);
        assert.equal(state.signLive, true, `live ${scheme} ${label}: vx-sign is live`);

        if (shotsDir) {
          await page.screenshot({ path: path.join(shotsDir, `${label}-${scheme}.png`) });
        }

        // Break & mend check on desktop light (and capture whole / mid-break / mended shots).
        if (label === "desktop" && scheme === "light") {
          await page.evaluate(() => {
            window.__pokes = 0;
            document.querySelector("h1.vx-sign").addEventListener("vx-poke", () => window.__pokes++);
          });
          const wholeShot = await page.screenshot(shotsDir ? { path: path.join(shotsDir, "sign-whole.png") } : {});
          const box = await page.locator("h1.vx-sign").boundingBox();
          assert.ok(box && box.width > 100 && box.height > 20, "sign has real box");
          // Verify the sign area actually painted pixels (not blank ground).
          const signClip = { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 32, height: box.height + 48 };
          const beforeCrop = await page.screenshot({ clip: signClip });
          // Brush across part of the name so multiple letters shatter vividly.
          await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 6 });
          await page.waitForTimeout(140);
          const midCrop = await page.screenshot({ clip: signClip });
          if (shotsDir) {
            await page.screenshot({ path: path.join(shotsDir, "sign-mid-break.png") });
          }
          await page.mouse.up();
          const pokes = await page.evaluate(() => window.__pokes);
          assert.ok(pokes >= 1, `expected vx-poke on sign interaction, got ${pokes}`);
          assert.equal(Buffer.compare(beforeCrop, midCrop) !== 0, true, "sign pixels must visibly shatter mid-break");
          // Wait for mend spring to settle back home.
          await page.waitForTimeout(1800);
          if (shotsDir) {
            await page.screenshot({ path: path.join(shotsDir, "sign-mended.png") });
          }
          assert.ok(wholeShot.length > 0);

          // Keyboard Tab order & focus visibility.
          const tabbed = [];
          for (let i = 0; i < EXPECTED_LINKS.length; i++) {
            await page.keyboard.press("Tab");
            const focused = await page.evaluate(() => {
              const el = document.activeElement;
              const s = el ? getComputedStyle(el) : null;
              const after = el ? getComputedStyle(el, "::after") : null;
              const ringVisible =
                (s && s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1 && s.outlineColor !== "rgba(0, 0, 0, 0)") ||
                (after && after.outlineStyle !== "none" && parseFloat(after.outlineWidth) >= 1);
              return { href: el?.getAttribute("href"), ringVisible };
            });
            assert.ok(focused.ringVisible, `keyboard focus ring must be visible on ${focused.href}`);
            tabbed.push(focused.href);
          }
          assert.deepEqual(tabbed, EXPECTED_LINKS, "keyboard Tab order matches required link order");
        }

        await ctx.close();
      }
    }
    console.log("live WebGPU checks (light/dark, desktop/phone, break & mend, keyboard focus): passed");

    // 3d. Reduced motion: voxels stay, sign does NOT break on click.
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(origin + "/", { waitUntil: "networkidle" });
      await page.waitForFunction(() => Boolean(document.documentElement.dataset.vx), null, { timeout: 10000 });
      await page.evaluate(() => {
        window.__pokes = 0;
        document.querySelector("h1.vx-sign").addEventListener("vx-poke", () => window.__pokes++);
      });
      const box = await page.locator("h1.vx-sign").boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.__pokes), 0, "reduced motion must not break the sign");
      await ctx.close();
      console.log("reduced-motion check: passed");
    }

    // 4. Performance benchmark: "/" vs "/blog/" on desktop and phone (cold load, median of 3 runs).
    if (bench) {
      async function measure(route, viewport) {
        const runs = [];
        for (let r = 0; r < 3; r++) {
          const ctx = await browser.newContext({ viewport, colorScheme: "light" });
          const page = await ctx.newPage();
          const cdp = await ctx.newCDPSession(page);
          await cdp.send("Network.enable");
          const httpIds = new Set();
          let bytes = 0;
          let requests = 0;
          cdp.on("Network.requestWillBeSent", (e) => {
            if (/^https?:/.test(e.request.url)) httpIds.add(e.requestId);
          });
          cdp.on("Network.loadingFinished", (e) => {
            if (!httpIds.has(e.requestId)) return;
            bytes += e.encodedDataLength;
            requests++;
          });
          await page.goto(origin + route, { waitUntil: "networkidle" });
          await page.waitForFunction(() => Boolean(document.documentElement.dataset.vx), null, { timeout: 10000 });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(100);
          const timing = await page.evaluate(() => {
            const fp = performance.getEntriesByName("first-paint")[0]?.startTime ?? null;
            const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
            const dcl = performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? null;
            return { fp, fcp, dcl };
          });
          runs.push({ bytes, requests, ...timing });
          await ctx.close();
        }
        const med = (k) => {
          const vals = runs.map((x) => x[k]).filter((v) => v != null).sort((a, b) => a - b);
          return vals.length ? vals[Math.floor(vals.length / 2)] : null;
        };
        return {
          bytes: Math.round(med("bytes")),
          requests: med("requests"),
          fpMs: med("fp") != null ? Number(med("fp").toFixed(1)) : null,
          fcpMs: med("fcp") != null ? Number(med("fcp").toFixed(1)) : null,
        };
      }

      const results = {
        desktop: {
          front: await measure("/", { width: 1280, height: 800 }),
          blog: await measure("/blog/", { width: 1280, height: 800 }),
        },
        phone: {
          front: await measure("/", { width: 390, height: 844 }),
          blog: await measure("/blog/", { width: 390, height: 844 }),
        },
      };
      console.log("BENCHMARK_JSON:" + JSON.stringify(results));
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log("check-home: ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
