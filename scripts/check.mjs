// npm run check (part 1): builds, then checks the outputs.
// Runs on the production build in dist/ and on a drafts-included build in a temp
// directory, so the post, tag, embed and feed paths are exercised even when every
// post is still a draft.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { build, ContentError } from "../generator/build.mjs";
import { loadPosts } from "../generator/posts.mjs";
import { markdownTwin, postPath } from "../lib/paths.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const failures = [];
const fail = (label, msg) => failures.push(`[${label}] ${msg}`);

async function run(label, options) {
  let result;
  try {
    result = await build(options);
  } catch (e) {
    if (e instanceof ContentError) {
      fail(label, e.message);
      return null;
    }
    throw e;
  }
  const stats = checkOutput(label, options.outDir, result);
  console.log(`${label}: ${stats.pages} pages, ${stats.posts} posts, ${stats.embeds} embeds, ${stats.links} internal links checked`);
  return result;
}

function checkOutput(label, out, { posts, site }) {
  const files = walk(out);
  const rel = (f) => "/" + path.relative(out, f).split(path.sep).join("/");
  const pageFiles = files.filter((f) => f.endsWith("index.html"));
  const pageRoutes = pageFiles.map((f) => rel(f).replace(/index\.html$/, ""));
  let embeds = 0;
  let links = 0;

  const exists = (p) => {
    const file = path.join(out, decodeURIComponent(p));
    if (p.endsWith("/")) return fs.existsSync(path.join(file, "index.html"));
    return fs.existsSync(file) && fs.statSync(file).isFile();
  };
  const checkLink = (from, url) => {
    if (!url || url.startsWith("#") || url.startsWith("mailto:")) return;
    let p;
    if (url.startsWith(site.origin + "/")) p = url.slice(site.origin.length);
    else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) return; // external
    else p = new URL(url, "https://site.invalid" + from).pathname;
    p = p.split("#")[0].split("?")[0];
    links++;
    if (!exists(p)) fail(label, `${from}: broken internal link ${url}`);
  };

  // Every page: Markdown twin, alternate link, internal links, embeds.
  for (const [i, file] of pageFiles.entries()) {
    const route = pageRoutes[i];
    const html = fs.readFileSync(file, "utf8");
    const twin = markdownTwin(route);
    if (!exists(twin)) fail(label, `${route}: missing Markdown twin ${twin}`);
    if (!html.includes(`<link rel="alternate" type="text/markdown" href="${twin}"`)) fail(label, `${route}: missing <link rel="alternate" type="text/markdown" href="${twin}">`);
    for (const m of html.matchAll(/\s(?:href|src|poster|before|after)="([^"]*)"/g)) checkLink(route, decode(m[1]));

    for (const m of html.matchAll(/<(engine-scene|model-compare)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      embeds++;
      const poster = /\sposter="[^"]+"/.test(m[2]) && /<img [^>]*src="[^"]+"/.test(m[3]);
      const text = /<p class="embed-text">[^<\s][^<]*<\/p>/.test(m[3]);
      if (!poster && !text) fail(label, `${route}: <${m[1]}> without a poster or a text equivalent`);
    }
    for (const m of html.matchAll(/<model-note\b([^>]*)>([\s\S]*?)<\/model-note>/g)) {
      embeds++;
      if (!/\smodel="[^"]+"/.test(m[1]) || !/\smaker="[^"]+"/.test(m[1])) fail(label, `${route}: <model-note> without model and maker`);
      if (!m[2].includes('class="model-note-by"')) fail(label, `${route}: <model-note> without its attribution line`);
    }
  }

  // Markdown twins and llms.txt: links resolve, no raw embed tags outside code.
  for (const file of files.filter((f) => f.endsWith(".md") || f.endsWith("llms.txt"))) {
    const from = rel(file);
    const text = fs.readFileSync(file, "utf8");
    const prose = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, "");
    for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) checkLink(from, m[1]);
    if (/<(engine-scene|model-compare|model-note)\b/.test(prose)) fail(label, `${from}: raw embed tag in Markdown output`);
  }

  // llms.txt lists every post.
  const llms = fs.readFileSync(path.join(out, "llms.txt"), "utf8");
  if (!/^# .+\n\n> .+/.test(llms)) fail(label, "llms.txt: must start with an H1 and a blockquote summary");
  for (const p of posts) {
    const url = site.origin + markdownTwin(postPath(p.slug));
    if (!llms.includes(`](${url})`)) fail(label, `llms.txt: missing ${url}`);
  }

  // Feed and sitemap: well-formed XML with the required elements.
  const parser = new XMLParser({ ignoreAttributes: false, isArray: (name) => ["entry", "url", "link"].includes(name) });
  const feedXml = fs.readFileSync(path.join(out, "feed.xml"), "utf8");
  const feedValid = XMLValidator.validate(feedXml);
  if (feedValid !== true) fail(label, `feed.xml: ${JSON.stringify(feedValid.err)}`);
  else {
    const feed = parser.parse(feedXml).feed;
    if (feed?.["@_xmlns"] !== "http://www.w3.org/2005/Atom") fail(label, "feed.xml: not an Atom feed");
    for (const key of ["id", "title", "updated", "author"]) if (!feed?.[key]) fail(label, `feed.xml: missing <${key}>`);
    const entries = feed?.entry ?? [];
    if (entries.length !== Math.min(posts.length, 30)) fail(label, `feed.xml: ${entries.length} entries for ${posts.length} posts`);
    for (const e of entries) {
      for (const key of ["id", "title", "updated", "content"]) if (!e[key]) fail(label, `feed.xml: entry ${e.id} missing <${key}>`);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(e.updated)) fail(label, `feed.xml: entry ${e.id} has a bad <updated>`);
      const content = typeof e.content === "object" ? e.content["#text"] : e.content;
      for (const m of String(content).matchAll(/\s(?:href|src|poster)="([^"]*)"/g)) {
        if (!/^(https?:|mailto:|#)/.test(m[1])) fail(label, `feed.xml: entry ${e.id} has a relative URL ${m[1]}`);
      }
    }
  }
  const sitemapXml = fs.readFileSync(path.join(out, "sitemap.xml"), "utf8");
  const sitemapValid = XMLValidator.validate(sitemapXml);
  if (sitemapValid !== true) fail(label, `sitemap.xml: ${JSON.stringify(sitemapValid.err)}`);
  else {
    const urls = (parser.parse(sitemapXml).urlset?.url ?? []).map((u) => u.loc);
    for (const route of pageRoutes) if (!urls.includes(site.origin + route)) fail(label, `sitemap.xml: missing ${route}`);
    if (urls.length !== pageRoutes.length) fail(label, `sitemap.xml: ${urls.length} URLs for ${pageRoutes.length} pages`);
  }

  const robots = fs.readFileSync(path.join(out, "robots.txt"), "utf8");
  if (!robots.includes(`Sitemap: ${site.origin}/sitemap.xml`) || /^Disallow:\s*\/\s*$/m.test(robots)) fail(label, "robots.txt: must allow crawling and name the sitemap");

  return { pages: pageRoutes.length, posts: posts.length, embeds, links };
}

/** Production builds must not mention a draft anywhere: pages, twins, llms.txt, feed, sitemap, tags, assets. */
function checkNoDrafts(out) {
  const { posts: all } = loadPosts(path.join(ROOT, "posts"), { includeDrafts: true });
  const drafts = all.filter((p) => p.draft);
  if (fs.existsSync(path.join(out, "blog"))) {
    for (const d of drafts) if (fs.existsSync(path.join(out, "blog", d.slug))) fail("production", `draft folder leaked: blog/${d.slug}/`);
  }
  for (const file of walk(out)) {
    if (!/\.(html|md|txt|xml)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const d of drafts) {
      if (text.includes(`/blog/${d.slug}/`) || text.includes(`/blog/${d.slug}.md`)) fail("production", `${path.relative(out, file)} mentions draft "${d.slug}"`);
    }
    if (/class="draft"|^draft: true$/m.test(text)) fail("production", `${path.relative(out, file)} contains a draft marker`);
  }
  return drafts.length;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

// ---------------------------------------------------------------------------

const draftsDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-check-"));
try {
  const prod = await run("production", { outDir: path.join(ROOT, "dist") });
  if (prod) console.log(`production: ${checkNoDrafts(path.join(ROOT, "dist"))} draft(s) kept out`);
  await run("with drafts", { outDir: draftsDir, drafts: true });
} finally {
  fs.rmSync(draftsDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("Output checks passed.");
