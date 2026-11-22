// Mounted under a base (zahynailo.dev/blog/), the site shares its folder with its posts and the
// origin with the realm at "/": what would cross either line fails the build.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build, ContentError } from "../generator/build.mjs";
import site from "../site.config.mjs";

const post = (dir, slug, body) => {
  fs.mkdirSync(path.join(dir, slug), { recursive: true });
  fs.writeFileSync(path.join(dir, slug, "index.md"), `---\ntitle: "${slug}"\ndate: 2026-11-20\nsummary: "A test post."\ntags: [test]\n---\n\n${body}\n`);
};
const attempt = async (make) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mount-test-")), posts = path.join(root, "posts");
  make(posts);
  try { await build({ outDir: path.join(root, "out"), postsDir: posts, site: { ...site, base: "/blog/" } }); return { out: path.join(root, "out") } }
  catch (e) { if (e instanceof ContentError) return { error: e.message }; throw e }
};

test("a post named like one of the site's own folders fails the build", async () => {
  const { error } = await attempt((d) => post(d, "lost", "Hello."));
  assert.match(error ?? "", /a post cannot be called "lost"/);
});

test("a link from / that leaves the base fails the build; the realm, the base and relative links pass", async () => {
  const { error } = await attempt((d) => post(d, "away", "See [the desk](/voxelmorphism/)."));
  assert.match(error ?? "", /the link \/voxelmorphism\/ leaves the site/);
  const { error: raw } = await attempt((d) => post(d, "raw", '<p><a href="/voxelmorphism/">the desk</a></p>'));
  assert.match(raw ?? "", /the link \/voxelmorphism\/ leaves the site/);
  const { out, error: none } = await attempt((d) => post(d, "fine", 'Back to [the city](/), [tags](/blog/tags/), [the blog](/blog), [robots](/robots.txt), [up](../) and <a href="/blog/voxelmorphism/">the desk</a>.'));
  assert.equal(none, undefined);
  assert.ok(fs.existsSync(path.join(out, "blog", "fine", "index.html")));
});
