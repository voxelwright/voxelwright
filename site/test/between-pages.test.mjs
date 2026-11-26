// Moving between pages: the cache rules, the speculation rules and the view-transition hooks
// every page carries. The browser side is scripts/check-transitions.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build } from "../generator/build.mjs";
import { directoryAssets } from "../scripts/serve.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT = "public, max-age=0, must-revalidate";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-between-"));
await build({ outDir: out, drafts: true, dev: false });
process.on("exit", () => fs.rmSync(out, { recursive: true, force: true }));

const walk = (dir, rel = "") => fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(dir, path.join(rel, e.name)) : ["/" + path.join(rel, e.name).split(path.sep).join("/")]));
const files = walk(out).filter((f) => f !== "/_headers");
const pages = files.filter((f) => f.endsWith("/index.html") || f === "/404.html");
const assets = directoryAssets(out);
// site.config.mjs mounts the site under /blog/; "/" is the realm's, not built here
const get = (p, headers) => assets.fetch(new Request("http://site.test" + p, { headers }));

test("only files named by their content are kept for good; pages, twins, feeds and scripts are checked every time", async () => {
  let immutable = 0;
  for (const file of files) {
    const url = file.replace(/(^|\/)index\.html$/, "$1");
    const cache = (await get(url)).headers.get("Cache-Control");
    if (/immutable/.test(cache)) {
      immutable++;
      assert.match(file, /^\/blog\/vendor\/village\/kit\/shared\/chunk-[A-Z0-9]{8}\.js$/, `${file} is kept for good but its name is not a content hash`);
      assert.equal(cache, "public, max-age=31536000, immutable");
    } else if (/^\/blog\/(?:fonts|vendor\/village\/kit\/fonts|support\/fonts)\//.test(file)) {
      assert.equal(cache, "public, max-age=604800, stale-while-revalidate=2592000", file);
    } else {
      assert.equal(cache, DEFAULT, `${file} must be checked before reuse`);
    }
  }
  assert.ok(immutable > 0, "the kit's hashed chunks are kept for good");
});

test("every chunk the kit imports exists, so a kept chunk is never asked for by a name the kit dropped", () => {
  const kit = path.join(out, "blog/vendor/village/kit");
  let imports = 0;
  for (const entry of ["src/index.js", "showcase/desk-controls.js"]) {
    for (const [, name] of fs.readFileSync(path.join(kit, entry), "utf8").matchAll(/["'](\.\.\/shared\/chunk-[A-Z0-9]+\.js)["']/g)) {
      imports++;
      assert.ok(fs.existsSync(path.join(kit, path.dirname(entry), name)), `${entry} imports ${name}`);
    }
  }
  assert.ok(imports > 0, "the kit's entries import their chunks by relative name");
});

test("the local server answers like the host: ETags, 304s, and _headers never served", async () => {
  const first = await get("/blog/site.css");
  const etag = first.headers.get("ETag");
  assert.match(etag, /^"[0-9a-f]+"$/);
  assert.equal((await get("/blog/site.css", { "If-None-Match": etag })).status, 304);
  assert.equal((await get("/_headers")).status, 404);
  // the mounted site's rules are the host's, at the top; none is left inside the mount
  assert.equal(fs.existsSync(path.join(out, "blog/_headers")), false);
});

test("every page has one set of speculation rules in its head: pages prerendered, the city only prefetched", () => {
  for (const file of pages) {
    const html = fs.readFileSync(path.join(out, file), "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    const rules = [...head.matchAll(/<script type="speculationrules">([\s\S]*?)<\/script>/g)];
    assert.equal(rules.length, 1, `${file}: one rules script, in the head`);
    assert.equal((html.match(/type="speculationrules"/g) ?? []).length, 1, file);
    const { prerender, prefetch } = JSON.parse(rules[0][1]);
    for (const rule of prerender) assert.equal(rule.eagerness, "moderate");
    for (const rule of prefetch) assert.equal(rule.eagerness, "moderate");
    // href_matches is one pattern or a list of them
    const patterns = (rules) => [...JSON.stringify(rules).matchAll(/"href_matches":(\[[^\]]*\]|"[^"]*")/g)].flatMap((m) => JSON.parse(m[1]));
    if (typeof URLPattern === "function") {
      const base = "https://site.test";
      const matches = (list, url) => list.some((p) => new URLPattern(p, base).test(url, base));
      for (const city of ["/", "/?view=2d", "/?view=3d", "/#main"]) {
        assert.equal(matches(patterns(prerender), city), false, `${file}: the city (${city}) is never prerendered`);
        assert.equal(matches(patterns(prefetch), city), true, `${file}: the city (${city}) may be prefetched`);
      }
      for (const page of ["/blog/", "/blog/kitchen-sink/", "/blog/tags/", "/blog/tags/village/", "/blog/voxelmorphism/"]) assert.ok(matches(patterns(prerender), page), page);
      for (const file of ["/blog/index.md", "/blog/feed.xml", "/blog/llms.txt", "/blog/landing/home.js"]) assert.equal(matches(patterns(prerender), file), false, file);
      // the realm's own addresses are never prerendered: it would start its world in the background
      for (const realm of ["/play/", "/realms/sf/"]) assert.equal(matches(patterns(prerender), realm), false, realm);
    }
    // links that change a saved choice when pressed (?view=) are never loaded ahead
    assert.match(JSON.stringify(prerender), /\[href\*='\?'\]/);
  }
});

test("every page opts in to transitions and names at most one title", () => {
  const css = fs.readFileSync(path.join(ROOT, "static/site.css"), "utf8");
  assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto;\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.site-bar, \.page-title, \.post-title \{ view-transition-name: none; \}/);
  for (const file of pages) {
    const html = fs.readFileSync(path.join(out, file), "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /addEventListener\("pagereveal"/, `${file}: the transition script is in the head, before the first paint`);
    // two elements with one view-transition-name skip the whole transition
    const titles = (html.match(/class="[^"]*\b(?:page-title|post-title)\b[^"]*"/g) ?? []).length;
    assert.ok(titles <= 1, `${file}: ${titles} titles would share the name page-title`);
    assert.equal((html.match(/class="[^"]*\bsite-bar\b/g) ?? []).length, 1, `${file}: one bar`);
    // mounted under /blog/, "/" is the personal page rather than the 3D city landing
    assert.doesNotMatch(head, /from-city|to-city/, `${file}: mounted blog pages must not play the city arrival transition`);
    assert.match(head, /localStorage\.removeItem\("village\.ai"\)/, `${file}: clears left-behind village.ai key`);
  }
});
