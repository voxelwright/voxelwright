// Unit tests for the Markdown negotiation Worker and the routes that reach it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import worker, { prefersMarkdown } from "../src/worker.mjs";
import { PAGE_ROUTE_PATTERNS, markdownTwin, matchesRunWorkerFirst } from "../lib/paths.mjs";
import { build } from "../generator/build.mjs";
import cloudflareConfig from "../cloudflare.config.ts";

const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/** A fake env.ASSETS holding a few files. */
function assets(files) {
  const calls = [];
  return {
    calls,
    async fetch(input) {
      const { pathname } = new URL(input.url ?? input);
      calls.push(pathname);
      const key = pathname.endsWith("/") ? pathname + "index.html" : pathname;
      if (!(key in files)) return new Response("<h1>404</h1>", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
      const type = key.endsWith(".md") ? "text/markdown; charset=utf-8" : key.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      return new Response(files[key], { headers: { "Content-Type": type } });
    },
  };
}

const FILES = {
  "/index.html": "<h1>Home</h1>",
  "/index.md": "# Home",
  "/blog/hello/index.html": "<h1>Hello</h1>",
  "/blog/hello.md": "# Hello",
  "/tags/ai/index.html": "<h1>AI</h1>",
};
const get = (pathname, accept, method = "GET") =>
  new Request("https://example.com" + pathname, { method, headers: accept ? { Accept: accept } : {} });

test("Accept: text/markdown gets the page's Markdown twin", async () => {
  for (const [route, body] of [["/", "# Home"], ["/blog/hello/", "# Hello"]]) {
    const res = await worker.fetch(get(route, "text/markdown"), { ASSETS: assets(FILES) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/markdown; charset=utf-8");
    assert.equal(res.headers.get("Vary"), "Accept");
    assert.equal(await res.text(), body);
  }
});

test("a browser Accept header gets HTML, with Vary: Accept", async () => {
  const res = await worker.fetch(get("/blog/hello/", BROWSER), { ASSETS: assets(FILES) });
  assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.match(res.headers.get("Vary"), /Accept/);
  assert.equal(await res.text(), "<h1>Hello</h1>");
});

test("wildcards and lower-ranked markdown never select Markdown", () => {
  assert.equal(prefersMarkdown("*/*"), false);
  assert.equal(prefersMarkdown("text/*"), false);
  assert.equal(prefersMarkdown(null), false);
  assert.equal(prefersMarkdown(BROWSER), false);
  assert.equal(prefersMarkdown("text/html, text/markdown;q=0.5"), false);
  assert.equal(prefersMarkdown("text/markdown;q=0"), false);
  assert.equal(prefersMarkdown("text/markdown, text/html;q=0.9"), true);
  assert.equal(prefersMarkdown("text/markdown, text/plain, */*"), true);
});

test("a conditional request for Markdown gets a Markdown 304, not HTML", async () => {
  const env = {
    ASSETS: {
      async fetch(input) {
        const { pathname } = new URL(input.url);
        if (pathname === "/index.md" && input.headers.get("If-None-Match") === '"md"') return new Response(null, { status: 304, headers: { ETag: '"md"' } });
        return new Response("<h1>Home</h1>", { headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"html"' } });
      },
    },
  };
  const req = new Request("https://example.com/", { headers: { Accept: "text/markdown", "If-None-Match": '"md"' } });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 304);
  assert.equal(res.headers.get("Vary"), "Accept");
});

test("a page without a twin falls back to HTML", async () => {
  const res = await worker.fetch(get("/tags/ai/", "text/markdown"), { ASSETS: assets(FILES) });
  assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.match(res.headers.get("Vary"), /Accept/);
});

test("non-page paths and non-GET methods pass straight to assets", async () => {
  const env = { ASSETS: assets(FILES) };
  const res = await worker.fetch(get("/blog/hello.md", "text/markdown"), env);
  assert.equal(res.headers.get("Vary"), null);
  const post = await worker.fetch(get("/", "text/markdown", "POST"), env);
  assert.equal(post.headers.get("Content-Type"), "text/html; charset=utf-8");
});

test("runWorkerFirst matches every page route and no asset", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-routes-"));
  try {
    await build({ outDir: out, drafts: true });
    const files = walk(out).map((f) => "/" + path.relative(out, f).split(path.sep).join("/"));
    const pages = files.filter((f) => f.endsWith("/index.html")).map((f) => f.slice(0, -"index.html".length));
    const assetsOnly = files.filter((f) => !f.endsWith("/index.html"));
    assert.ok(pages.length >= 3 && assetsOnly.length >= 5);
    for (const p of pages) assert.ok(matchesRunWorkerFirst(p), `page ${p} must reach the Worker`);
    for (const f of assetsOnly) assert.ok(!matchesRunWorkerFirst(f), `asset ${f} must not reach the Worker`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
  for (const f of ["/engine/core.wasm", "/engine/main.js", "/blog/a/model.glb", "/blog/a/clip.mp4", "/blog/a/scene.json", "/style.css", "/favicon.ico"]) {
    assert.ok(!matchesRunWorkerFirst(f), f);
  }
});

test("one switch: negotiation off deploys assets only; dev always negotiates", async () => {
  const site = (await import("../site.config.mjs")).default;
  const prod = (await cloudflareConfig({ mode: undefined, isPreview: false })).worker;
  const dev = (await cloudflareConfig({ mode: "development", isPreview: false })).worker;
  assert.deepEqual(dev.assets.runWorkerFirst, PAGE_ROUTE_PATTERNS);
  assert.ok(dev.entrypoint);
  if (site.negotiateMarkdown) {
    assert.deepEqual(prod.assets.runWorkerFirst, PAGE_ROUTE_PATTERNS);
  } else {
    assert.equal(prod.assets.runWorkerFirst, undefined);
    assert.equal(prod.entrypoint, undefined);
    assert.equal(prod.env, undefined);
  }
});

test("markdownTwin maps page routes only", () => {
  assert.equal(markdownTwin("/"), "/index.md");
  assert.equal(markdownTwin("/blog/"), "/blog.md");
  assert.equal(markdownTwin("/tags/ai/"), "/tags/ai.md");
  assert.equal(markdownTwin("/style.css"), null);
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
