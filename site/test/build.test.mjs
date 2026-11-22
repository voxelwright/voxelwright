// Build failures that must stop a publish, using throwaway posts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build, ContentError } from "../generator/build.mjs";

const SITE = (await import("../site.config.mjs")).default;

async function buildPost(body, files = {}, summary = "A fixture.") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-fixture-"));
  const dir = path.join(root, "posts", "fixture");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.md"), `---\ntitle: Fixture\ndate: 2026-01-02\nsummary: ${JSON.stringify(summary)}\ntags: [test]\ndraft: false\n---\n\n${body}\n`);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  try {
    return await build({ outDir: path.join(root, "out"), postsDir: path.join(root, "posts"), site: SITE });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const poster = { "p.png": "x", "s.json": "{}", "a.glb": "x", "b.glb": "x" };

test("an embed with neither alt text nor a poster fails the build", async () => {
  await assert.rejects(buildPost(`<engine-scene src="s.json"></engine-scene>`, poster), (e) => e instanceof ContentError && /needs alt="…" \(a text equivalent\) or poster=/.test(e.message));
  await assert.rejects(buildPost(`<model-compare before="a.glb" after="b.glb">`, poster), (e) => e instanceof ContentError && /or poster=/.test(e.message));
});

test("the bare opening-tag form builds, with alt alone or poster alone", async () => {
  const { pages } = await buildPost(`<engine-scene src="s.json" poster="p.png" alt="A scene.">\n\n<model-compare before="a.glb" after="b.glb" alt="Two models.">\n\nAfter.`, poster);
  const page = pages.find((p) => p.path === "/blog/fixture/");
  assert.match(page.html, /<engine-scene [^>]*><img src="\/blog\/fixture\/p.png" alt="A scene."/);
  assert.match(page.html, /<model-compare [^>]*><p class="embed-text">Two models.<\/p><\/model-compare>/);
  assert.match(page.html, /<p>After.<\/p>/);
  assert.match(page.markdown, /^Two models\.$/m);
});

test("an embed never swallows the text after it", async () => {
  const body = `<engine-scene src="s.json" alt="A scene.">\n\nProse after.\n\n\`\`\`html\n</engine-scene>\n\`\`\``;
  const { pages } = await buildPost(body, poster);
  const page = pages.find((p) => p.path === "/blog/fixture/");
  assert.match(page.html, /<p>Prose after.<\/p>/);
  assert.equal(page.html.match(/<engine-scene /g).length, 1);
  assert.match(page.html, /<pre class="shiki/);
});

test("an embed pointing at a missing file fails the build", async () => {
  await assert.rejects(buildPost(`<engine-scene src="nope.json" poster="p.png" alt="A scene."></engine-scene>`, poster), (e) => e instanceof ContentError && /does not exist/.test(e.message));
});

test("a model note needs model, maker and words", async () => {
  await assert.rejects(buildPost(`<model-note model="M">Hi.</model-note>`), (e) => /needs maker=/.test(e.message));
  await assert.rejects(buildPost(`<model-note model="M" maker="L"></model-note>`), (e) => /is empty/.test(e.message));
});

test("an embed inside a paragraph fails instead of passing through unchecked", async () => {
  await assert.rejects(buildPost(`Text then <engine-scene src="s.json" poster="p.png" alt="x"></engine-scene> inline.`, poster), (e) => /must start its own top-level block/.test(e.message));
});

test("an unclosed model note fails the build", async () => {
  await assert.rejects(buildPost(`<model-note model="M" maker="L">\nWords.`), (e) => /is not closed/.test(e.message));
});

test("a published post needs a summary", async () => {
  await assert.rejects(buildPost("Body.", {}, ""), (e) => e instanceof ContentError && /summary is required/.test(e.message));
});

test("a valid model note becomes an attributed blockquote in Markdown", async () => {
  const { pages } = await buildPost(`<model-note model="Model X" maker="Maker Y">\nFirst line.\n\nSecond.\n</model-note>`);
  const md = pages.find((p) => p.path === "/blog/fixture/").markdown;
  assert.match(md, /^> \*\*Note from Model X \(Maker Y\):\*\* First line\.\n>\n> Second\.$/m);
});

test("inline Markdown resolves links relative to the site root", async () => {
  const { renderInline } = await import("../generator/markdown.mjs");
  assert.equal(renderInline("See [Village](tags/village/)."), 'See <a href="/tags/village/">Village</a>.');
});
