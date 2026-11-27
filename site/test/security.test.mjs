// The site's security headers (#81) reach every file of the origin, the front page and 404 included, and the
// Markdown Worker sets the same ones. The front page at "/" is in the sitemap and llms.txt.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build } from "../generator/build.mjs";
import { directoryAssets, headerRules } from "../scripts/serve.mjs";
import worker, { SECURITY_HEADERS } from "../src/worker.mjs";

const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-security-"));
await build({ outDir: out, drafts: false, dev: false, personalHome: true });
process.on("exit", () => fs.rmSync(out, { recursive: true, force: true }));
const assets = directoryAssets(out);
const get = (p) => assets.fetch(new Request("http://site.test" + p));

test("static/_headers' /* rule is the Worker's SECURITY_HEADERS, and stays /* when the site is mounted", () => {
  const rules = headerRules(out);
  const all = rules.filter((r) => r.pattern.test("/") && r.pattern.test("/anything/at/all.png"));
  assert.equal(all.length, 1, "one origin-wide rule");
  assert.deepEqual(Object.fromEntries(all[0].set), SECURITY_HEADERS);
  assert.doesNotMatch(fs.readFileSync(path.join(out, "_headers"), "utf8"), /^\/blog\/\*$/m);
});

test("the front page, a blog page, 404.html, robots.txt and a script all carry the security headers", async () => {
  for (const p of ["/", "/blog/", "/404.html", "/robots.txt", "/blog/site.js"]) {
    const res = await get(p);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(name), value, `${p}: ${name}`);
  }
});

test("the CSP leaves scripts alone: no script-src or default-src to block the inline scripts", () => {
  assert.doesNotMatch(SECURITY_HEADERS["Content-Security-Policy"], /script-src|default-src/);
  assert.match(fs.readFileSync(path.join(out, "blog/index.html"), "utf8"), /<script type="speculationrules">/);
});

test("the Worker sets the security headers on HTML and Markdown answers, and never asks another origin", async () => {
  const asked = [];
  const env = { ASSETS: { async fetch(input) { asked.push(new URL(input.url ?? input).href); return new Response("ok", { headers: { "Content-Type": "text/html" } }); } } };
  for (const accept of ["text/html", "text/markdown"]) {
    const res = await worker.fetch(new Request("https://zahynailo.dev/blog/", { headers: { Accept: accept } }), env);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(name), value, `${accept}: ${name}`);
  }
  asked.length = 0;
  await worker.fetch(new Request("https://zahynailo.dev//evil.example/blog/x/", { headers: { Accept: "text/markdown" } }), env);
  for (const href of asked) assert.equal(new URL(href).host, "zahynailo.dev", href);
});

test("the sitemap and llms.txt list the front page at / first", () => {
  const sitemap = fs.readFileSync(path.join(out, "blog/sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs[0], "https://zahynailo.dev/");
  assert.equal(locs.filter((l) => l === "https://zahynailo.dev/").length, 1);
  const llms = fs.readFileSync(path.join(out, "blog/llms.txt"), "utf8");
  const pages = llms.slice(llms.indexOf("## Pages"));
  assert.match(pages.split("\n").find((l) => l.startsWith("- ")), /^- \[Home\]\(https:\/\/zahynailo\.dev\/index\.md\): /);
  assert.ok(fs.existsSync(path.join(out, "index.md")), "the link's Markdown exists");
});

test("without the front page, nothing at / is listed", async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "site-security-bare-"));
  try {
    await build({ outDir: bare, drafts: false, dev: false, personalHome: false });
    assert.doesNotMatch(fs.readFileSync(path.join(bare, "blog/sitemap.xml"), "utf8"), /<loc>https:\/\/zahynailo\.dev\/<\/loc>/);
    assert.doesNotMatch(fs.readFileSync(path.join(bare, "blog/llms.txt"), "utf8"), /\/index\.md\): /);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});
