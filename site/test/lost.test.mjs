// The 404 page ("lost in the fog"): its markup works at any depth and without a script, and
// the fog's field and drift are stable. The browser side is scripts/check-lost.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build } from "../generator/build.mjs";
import { notFoundPage } from "../generator/pages.mjs";
import { BANDS, MARGIN, field, place } from "../static/lost/fog.js";

const SITE = (await import("../site.config.mjs")).default;
const ROOT = path.resolve(import.meta.dirname, "..");

test("the 404 page is served from any depth, so every URL in it is absolute", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-lost-"));
  fs.mkdirSync(path.join(root, "posts"));
  try {
    const outDir = path.join(root, "out");
    await build({ outDir, postsDir: path.join(root, "posts"), site: SITE });
    const html = fs.readFileSync(path.join(outDir, "404.html"), "utf8");
    for (const [, attr, url] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
      if (url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("?")) continue;
      assert.ok(url.startsWith("/"), `${attr}="${url}" is relative, and breaks below the top level`);
      // mounted under /blog/, everything but the way home ("/", the app mounted there) is the site's
      if (url !== "/") assert.ok(url.startsWith("/blog/"), `${attr}="${url}" is outside the site's /blog/ mount`);
    }
    for (const file of ["blog/lost/lost.css", "blog/lost/lost.js", "blog/lost/fog.js", "blog/landing/ina.webp"]) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `${file} is published`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("without a script the sign still reads and its ways out are real links", () => {
  const { html } = notFoundPage(SITE);
  const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  assert.match(text, /Nothing here but fog/);
  assert.match(text, /No page stands at this address\. Either it was never built, or Karl the Fog has it\./);
  const ways = [...html.matchAll(/<nav class="lost-ways"[^>]*>([\s\S]*?)<\/nav>/g)][0][1];
  assert.deepEqual(
    [...ways.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]),
    [["Back to the city", "/"], ["Blog", "/blog/"], ["Voxelmorphism", "/blog/voxelmorphism/"]],
  );
  // the scene is decoration; the sign is the page
  assert.match(html, /<div class="lost-scene" aria-hidden="true">/);
  assert.match(html, /<canvas class="lost-fog" hidden>/);
});

test("the night fog is declared for the system's dark and for the Night key, as the kit does", () => {
  const css = fs.readFileSync(path.join(ROOT, "static/lost/lost.css"), "utf8");
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \.lost \{/);
  assert.match(css, /:root\[data-theme="dark"\] \.lost \{/);
});

test("the fog has the same shape every visit, and its puffs drift left and wrap", () => {
  const a = field();
  assert.deepEqual(a, field(), "seeded");
  assert.equal(a.length, BANDS.reduce((n, b) => n + b.count, 0));
  for (const puff of a) {
    const band = BANDS.find((b) => b.name === puff.band);
    assert.ok(puff.y >= band.top && puff.y <= band.bottom);
    for (const t of [0, 1, 60, 3600, 86400]) {
      const [x] = place(puff, t);
      assert.ok(x >= -MARGIN && x < 1 + MARGIN, `x ${x} at ${t}s stays in its span`);
    }
    // a short while later it is a little further left (unless it just wrapped round)
    const [x0] = place(puff, 10);
    const [x1] = place(puff, 11);
    assert.ok(x1 < x0 || x1 - x0 > 1, "drifts left");
  }
});
