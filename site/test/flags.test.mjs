// Feature flags: off means absent, on means built in, and mistakes stop the build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build, ContentError } from "../generator/build.mjs";
import { flagsOn } from "../lib/flags.mjs";

const SITE = (await import("../site.config.mjs")).default;

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-flags-"));
  fs.mkdirSync(path.join(root, "posts"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const HELLO = {
  "features/hello/feature.mjs": `export default {
    head: () => '<meta name="hello" content="1">',
    bodyEnd: (page, site) => '<script src="' + site.base + 'hello/hello.js" data-on="' + page.kind + '"></script>',
    pages: () => [{ path: "/hello/", title: "Hello", html: "<h1>Hello</h1>", markdown: "# Hello\\n" }],
  };`,
  "features/hello/static/hello/hello.js": "console.log('hello there');",
};

async function run(root, flags, options = {}) {
  const outDir = path.join(root, "out-" + Math.random().toString(36).slice(2));
  await build({ outDir, postsDir: path.join(root, "posts"), featuresDir: path.join(root, "features"), site: { ...SITE, flags }, ...options });
  return outDir;
}

function sums(dir, rel = "", out = {}) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) sums(dir, next, out);
    else out[next] = createHash("sha256").update(fs.readFileSync(path.join(dir, next))).digest("hex");
  }
  return out;
}

test("a feature whose flag is off, or missing, leaves the output exactly as it was", async () => {
  const bare = fixture({});
  const withFeature = fixture(HELLO);
  try {
    const base = sums(await run(bare, {}));
    assert.deepEqual(sums(await run(withFeature, {})), base);
    assert.deepEqual(sums(await run(withFeature, { hello: false })), base);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(withFeature, { recursive: true, force: true });
  }
});

test("a feature whose flag is off is never even read", async () => {
  const root = fixture({ "features/broken/feature.mjs": "this is not javascript (" });
  try {
    await run(root, { broken: false });
    await assert.rejects(run(root, { broken: true }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a feature whose flag is on adds its page, its files and its tags on every page", async () => {
  const root = fixture(HELLO);
  try {
    // the site is mounted under /blog/, and a feature's page and files go there with it
    const out = await run(root, { hello: true });
    assert.match(fs.readFileSync(path.join(out, "blog/hello/index.html"), "utf8"), /<h1>Hello<\/h1>/);
    assert.equal(fs.readFileSync(path.join(out, "blog/hello.md"), "utf8"), "# Hello\n");
    assert.equal(fs.readFileSync(path.join(out, "blog/hello/hello.js"), "utf8"), "console.log('hello there');");
    for (const file of ["blog/index.html", "blog/voxelmorphism/index.html", "blog/hello/index.html", "404.html"]) {
      const html = fs.readFileSync(path.join(out, file), "utf8");
      assert.match(html, /<meta name="hello" content="1"><\/head>/, file);
      assert.match(html, /<script src="\/blog\/hello\/hello\.js" data-on="[a-z-]+"><\/script><\/body>/, file);
    }
    assert.match(fs.readFileSync(path.join(out, "blog/sitemap.xml"), "utf8"), /\/blog\/hello\//);
    // on the whole origin the same feature is at the top, and the home page carries it too
    const whole = await run(root, { hello: true }, { site: { ...SITE, base: "/", flags: { hello: true } } });
    assert.match(fs.readFileSync(path.join(whole, "hello/index.html"), "utf8"), /<h1>Hello<\/h1>/);
    assert.match(fs.readFileSync(path.join(whole, "index.html"), "utf8"), /<script src="\/hello\/hello\.js" data-on="home"><\/script><\/body>/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a flag that is on with no feature folder fails the build", async () => {
  const root = fixture({});
  try {
    await assert.rejects(run(root, { ghost: true }), (e) => e instanceof ContentError && /no features\/ghost\/ folder/.test(e.message));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a flag must be true or false, and its name plain", async () => {
  assert.deepEqual(flagsOn({ flags: { a: true, b: false } }).on, ["a"]);
  assert.match(flagsOn({ flags: { a: "yes" } }).errors[0], /true or false/);
  assert.match(flagsOn({ flags: { "../a": true } }).errors[0], /lower-case words/);
  assert.match(flagsOn({ flags: ["a"] }).errors[0], /must be an object/);
  assert.deepEqual(flagsOn({}).on, []);
});

test("SITE_FLAGS turns a feature on in a dev build only", async () => {
  const env = { SITE_FLAGS: "hello, other" };
  assert.deepEqual(flagsOn({ flags: {} }, { dev: true, env }).on, ["hello", "other"]);
  assert.deepEqual(flagsOn({ flags: {} }, { dev: false, env }).on, []);
  assert.match(flagsOn({ flags: {} }, { dev: true, env: { SITE_FLAGS: "../x" } }).errors[0], /not a flag name/);
});

test("a feature cannot replace a page through another spelling of its address", async () => {
  for (const route of ["/voxelmorphism//", "/nested/../voxelmorphism/", "/Voxelmorphism/"]) {
    const root = fixture({ "features/grab/feature.mjs": `export default { pages: () => [{ path: ${JSON.stringify(route)}, title: "Mine", html: "<h1>Mine</h1>", markdown: "# Mine\\n" }] };` });
    try {
      // "/Voxelmorphism/" only collides where the file system ignores case; elsewhere it is simply another page
      const sensitive = route === "/Voxelmorphism/" && !fs.existsSync(root.toUpperCase());
      if (sensitive) continue;
      await assert.rejects(run(root, { grab: true }), (e) => e instanceof ContentError && /written twice|already exists/.test(e.message), route);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a feature cannot replace a page or a file the site already has", async () => {
  // a feature names its page in the site's own tree; mounted under /blog/, "/" there is the posts list
  const page = fixture({ "features/grab/feature.mjs": `export default { pages: () => [{ path: "/", title: "Mine", html: "", markdown: "" }] };` });
  const escape = fixture({ "features/grab/feature.mjs": `export default { pages: () => [{ path: "/../realm/", title: "Mine", html: "", markdown: "" }] };` });
  const file = fixture({ "features/grab/static/site.css": "nope" });
  const made = fixture({ "features/grab/static/llms.txt": "nope" });
  const twin = fixture({ "features/grab/static/tags.md": "nope" });
  try {
    await assert.rejects(run(page, { grab: true }), (e) => e instanceof ContentError && /already exists/.test(e.message));
    await assert.rejects(run(escape, { grab: true }), (e) => e instanceof ContentError && /outside the site's \/blog\//.test(e.message));
    for (const root of [file, made, twin]) await assert.rejects(run(root, { grab: true }), (e) => e instanceof ContentError && /would replace a file/.test(e.message));
  } finally {
    fs.rmSync(made, { recursive: true, force: true });
    fs.rmSync(escape, { recursive: true, force: true });
    fs.rmSync(twin, { recursive: true, force: true });
    fs.rmSync(page, { recursive: true, force: true });
    fs.rmSync(file, { recursive: true, force: true });
  }
});
