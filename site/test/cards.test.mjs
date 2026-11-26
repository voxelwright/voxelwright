// Share cards: the head's Open Graph and Twitter tags, which card each page links, the check
// that a linked card exists, and the PNG writer behind `npm run cards`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { test } from "node:test";
import { build } from "../generator/build.mjs";
import { shareCard, CARD } from "../generator/pages.mjs";
import { cardJobs, palette, remap, indexedPng, encodeCard } from "../scripts/cards.mjs";
import { shareProblems } from "../scripts/check.mjs";

const SITE = (await import("../site.config.mjs")).default;
// the whole origin, with the home page: what `npm run cards` builds
const WHOLE = { ...SITE, base: "/" };
const ROOT = path.resolve(import.meta.dirname, "..");

async function buildSite({ site = SITE, drafts = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-cards-"));
  const post = (slug, title, draft) => {
    const dir = path.join(root, "posts", slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.md"), `---\ntitle: ${JSON.stringify(title)}\ndate: 2026-01-02\nsummary: "A fixture."\ntags: [test]\ndraft: ${draft}\n---\n\nBody.\n`);
  };
  post("published", "A published post & its card", false);
  post("unfinished", "An unfinished post", true);
  const out = path.join(root, "out");
  const result = await build({ outDir: out, postsDir: path.join(root, "posts"), site, drafts });
  const html = (route) => fs.readFileSync(path.join(out, route === "/404.html" ? "404.html" : path.join(route, "index.html")), "utf8");
  const meta = (route) => new Map([...html(route).matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">/g)].map((m) => [m[1], m[2]]));
  return { ...result, root, out, html, meta, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("every page has full Open Graph and Twitter tags with absolute URLs", async () => {
  const s = await buildSite();
  try {
    const origin = s.site.origin;
    assert.equal(s.site.base, "/blog/");
    const post = s.meta("/blog/published/");
    assert.equal(post.get("og:type"), "article");
    assert.equal(post.get("og:title"), "A published post &amp; its card");
    assert.equal(post.get("og:url"), `${origin}/blog/published/`);
    assert.equal(post.get("og:image"), `${origin}/blog/og/blog/published.png`);
    assert.equal(post.get("og:image:width"), String(CARD.width));
    assert.equal(post.get("og:image:height"), String(CARD.height));
    assert.match(post.get("og:image:alt"), /park sign/);
    assert.equal(post.get("twitter:card"), "summary_large_image");
    assert.equal(post.get("twitter:image"), post.get("og:image"));

    for (const [route, card] of [["/blog/", "blog"], ["/blog/tags/", "tags"], ["/blog/voxelmorphism/", "voxelmorphism"]]) {
      assert.equal(s.meta(route).get("og:url"), `${origin}${route}`, route);
      assert.equal(s.meta(route).get("og:image"), `${origin}/blog/og/${card}.png`, route);
    }
    // the 404 page answers at every missing address, so it names none
    assert.equal(s.meta("/404.html").has("og:url"), false);
    // mounted below the origin, "/" is not the site's: no home page is built
    assert.equal(fs.existsSync(path.join(s.out, "index.html")), false);
  } finally {
    s.done();
  }
});

test("the whole origin has the home page and its card", async () => {
  const s = await buildSite({ site: WHOLE });
  try {
    const origin = s.site.origin;
    const home = s.meta("/");
    assert.equal(home.get("og:type"), "website");
    assert.equal(home.get("og:url"), `${origin}/`);
    assert.equal(home.get("og:image"), `${origin}/og/home.png`);
    assert.equal(s.meta("/blog/published/").get("og:image"), `${origin}/og/blog/published.png`);
    for (const [route, card] of [["/blog/", "blog"], ["/tags/", "tags"], ["/voxelmorphism/", "voxelmorphism"]]) {
      assert.equal(s.meta(route).get("og:image"), `${origin}/og/${card}.png`, route);
    }
  } finally {
    s.done();
  }
});

test("pages without their own card fall back to the home card; drafts never get one", async () => {
  const s = await buildSite();
  const whole = await buildSite({ site: WHOLE });
  try {
    const home = `${s.site.origin}/blog/og/home.png`;
    assert.equal(s.meta("/blog/tags/test/").get("og:image"), home);
    assert.equal(s.meta("/404.html").get("og:image"), home);
    assert.equal(s.meta("/blog/unfinished/").get("og:image"), home);
    // npm run cards paints from the whole origin, so the home card stays painted when mounted
    const files = cardJobs(whole.pages, whole.site).map((job) => job.file).sort();
    assert.deepEqual(files, ["blog.png", "blog/published.png", "home.png", "tags.png", "voxelmorphism.png"]);
    assert.equal(shareCard({ kind: "feature", path: "/x/" }), null);
  } finally {
    s.done();
    whole.done();
  }
});

test("the base URL comes from the site config", async () => {
  const s = await buildSite({ site: { ...SITE, origin: "https://example.test/" } });
  try {
    const meta = s.meta("/blog/published/");
    for (const key of ["og:url", "og:image", "twitter:image"]) assert.match(meta.get(key), /^https:\/\/example\.test\//, key);
    assert.doesNotMatch(s.html("/blog/published/"), /zahynailo\.dev\/og/);
    const job = cardJobs(s.pages, s.site).find((j) => j.file === "blog/published.png");
    assert.deepEqual(job.plates, [SITE.author, "example.test"]);
    assert.equal(job.title, "A published post & its card");
  } finally {
    s.done();
  }
});

test("the check fails, naming npm run cards, when a page links a card that isn't there", async () => {
  const s = await buildSite({ site: WHOLE, drafts: false });
  const mounted = await buildSite({ drafts: false });
  try {
    assert.deepEqual(shareProblems("/blog/", mounted.html("/blog/"), mounted.site, mounted.out), []);
    assert.deepEqual(shareProblems("/404.html", mounted.html("/404.html"), mounted.site, mounted.out), []);
    const problems = (route) => shareProblems(route, s.html(route), s.site, s.out);
    // the committed cards are copied in from static/og
    assert.deepEqual(problems("/"), []);
    assert.deepEqual(problems("/404.html"), []);
    const [missing] = problems("/blog/published/");
    assert.match(missing, /\/og\/blog\/published\.png does not exist\. Run `npm run cards`/);
    // a card of the wrong size is caught too
    fs.mkdirSync(path.join(s.out, "og", "blog"), { recursive: true });
    fs.writeFileSync(path.join(s.out, "og", "blog", "published.png"), indexedPng(new Uint8Array(4), 2, 2, [[0, 0, 0]]));
    assert.match(problems("/blog/published/")[0], /is 2×2, but the page says 1200×630/);
    // and a relative image
    assert.match(shareProblems("/", s.html("/").replace(`${s.site.origin}/og/home.png`, "/og/home.png"), s.site, s.out).join("\n"), /og:image must be an absolute URL/);
  } finally {
    s.done();
    mounted.done();
  }
});

test("the committed cards are 1200×630 PNGs within the size budget", () => {
  const dir = path.join(ROOT, "static", "og");
  const pngs = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".png"));
  assert.ok(pngs.includes("home.png"));
  assert.ok(pngs.includes("front.png"));
  for (const file of pngs) {
    const png = fs.readFileSync(path.join(dir, file));
    assert.equal(png.subarray(1, 4).toString(), "PNG", file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [CARD.width, CARD.height], file);
    assert.ok(png.length <= 320 * 1024, `${file} is ${Math.round(png.length / 1024)} KB`);
  }
});

test("the PNG writer makes a valid indexed PNG that keeps the picture", () => {
  const [width, height] = [64, 32];
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set([x * 4, y * 8, 120, 255], (y * width + x) * 4);
  const colours = palette(rgba, 16);
  assert.ok(colours.length <= 16);
  const indices = remap(rgba, width, height, colours);
  const png = indexedPng(indices, width, height, colours);
  // chunks: IHDR, PLTE, IDAT, IEND, each with a correct length
  const chunks = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    chunks.push([png.subarray(at + 4, at + 8).toString("latin1"), png.subarray(at + 8, at + 8 + length)]);
    at += 12 + length;
  }
  assert.deepEqual(chunks.map(([type]) => type), ["IHDR", "PLTE", "IDAT", "IEND"]);
  assert.equal(chunks[1][1].length, colours.length * 3);
  const raw = zlib.inflateSync(chunks[2][1]);
  assert.equal(raw.length, (width + 1) * height);
  assert.equal(raw[(width + 1) * 5 + 1 + 7], indices[5 * width + 7]);
  // nearest colours stay close to the source
  let worst = 0;
  for (let i = 0; i < indices.length; i++) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(colours[indices[i]][k] - rgba[i * 4 + k]));
  assert.ok(worst < 48, `worst channel error ${worst}`);
  assert.ok(encodeCard(rgba, width, height).length < 4096);
});
