// npm run check (part 1): builds, then checks the outputs.
// Runs on the production build in dist/ and on a drafts-included build in a temp
// directory, so the post, tag, embed and feed paths are exercised even when every
// post is still a draft.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { build, ContentError } from "../generator/build.mjs";
import { personalHomeOn } from "../generator/front.mjs";
import { loadPosts } from "../generator/posts.mjs";
import { markdownTwin, postPath, sitePath, blogPath, isMounted, HOME } from "../lib/paths.mjs";

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
  const mounted = isMounted(site.base);
  const front = mounted && fs.existsSync(path.join(out, "index.html"));
  // mounted below its origin without a personal front page, "/" is another app; with one, "/" is built here
  const home = mounted ? null : HOME;
  for (const route of [home, front ? HOME : null, blogPath(site.base), sitePath(site.base, "/voxelmorphism/")].filter(Boolean)) {
    if (!pageRoutes.includes(route)) fail(label, `missing destination ${route}`);
  }
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
    if (mounted && !front && p === HOME) return; // the app that owns "/", not part of this build
    links++;
    if (!exists(p)) fail(label, `${from}: broken internal link ${url}`);
  };

  // Every page: Markdown twin, alternate link, internal links, embeds.
  for (const [i, file] of pageFiles.entries()) {
    const route = pageRoutes[i];
    const html = fs.readFileSync(file, "utf8");
    const support = [...html.matchAll(/<support-button\b([^>]*)>/g)];
    if (route === home) {
      if (support.length !== 1 || !support[0][1].includes('version="instrument"') || !html.includes(`src="${sitePath(site.base, "/support/support-button.js")}"`)) {
        fail(label, "the landing must mount the enamel support button directly");
      }
    } else if (support.length) fail(label, `${route}: support belongs on the landing`);
    const twin = front && route === HOME ? "/index.md" : markdownTwin(route, site.base);
    if (!exists(twin)) fail(label, `${route}: missing Markdown twin ${twin}`);
    if (!html.includes(`<link rel="alternate" type="text/markdown" href="${twin}"`)) fail(label, `${route}: missing <link rel="alternate" type="text/markdown" href="${twin}">`);
    for (const m of html.matchAll(/\s(?:href|src|poster|before|after)="([^"]*)"/g)) checkLink(route, decode(m[1]));
    for (const problem of shareProblems(route, html, site, out)) fail(label, problem);

    for (const m of html.matchAll(/<(engine-scene|model-compare)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      embeds++;
      const poster = /\sposter="[^"]+"/.test(m[2]) && /<img [^>]*src="[^"]+"/.test(m[3]);
      const text = /<p class="embed-text">[^<\s][^<]*<\/p>/.test(m[3]);
      if (!poster && !text) fail(label, `${route}: <${m[1]}> without a poster or a text equivalent`);
    }
    for (const m of html.matchAll(/<ai-session\b([^>]*)>([\s\S]*?)<\/ai-session>/g)) {
      embeds++;
      if (!/<figure class="ais"/.test(m[2]) || !/class="ais-ex"/.test(m[2])) fail(label, `${route}: <ai-session> rendered without its turns`);
      if (!/\ssrc="[^"]+"/.test(m[1])) fail(label, `${route}: <ai-session> without src`);
      if (new RegExp(`<script(?! type="module" src="${sitePath(site.base, "/ai-session.js")}")`).test(m[2])) fail(label, `${route}: <ai-session> contains a script`);
    }
    for (const m of html.matchAll(/<model-note\b([^>]*)>([\s\S]*?)<\/model-note>/g)) {
      embeds++;
      if (!/\smodel="[^"]+"/.test(m[1]) || !/\smaker="[^"]+"/.test(m[1])) fail(label, `${route}: <model-note> without model and maker`);
      if (!/class="[^"]*\bmodel-note-by\b/.test(m[2])) fail(label, `${route}: <model-note> without its attribution line`);
    }
  }

  for (const problem of shareProblems("/404.html", fs.readFileSync(path.join(out, "404.html"), "utf8"), site, out)) fail(label, problem);

  // Markdown twins and llms.txt: links resolve, no raw embed tags outside code.
  for (const file of files.filter((f) => f.endsWith(".md") || f.endsWith("llms.txt"))) {
    const from = rel(file);
    const text = fs.readFileSync(file, "utf8");
    // Fenced code, also inside quotes (a session's replies are quoted), and inline code spans
    // may mention a tag; only bare tags count as raw embeds.
    const prose = text.replace(/^((?:> ?)*)(```|~~~)[\s\S]*?^\1\2/gm, "").replace(/`[^`\n]*`/g, "");
    for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) checkLink(from, m[1]);
    if (/<(engine-scene|model-compare|model-note|ai-session)\b/.test(prose)) fail(label, `${from}: raw embed tag in Markdown output`);
  }

  // llms.txt lists every post.
  const llms = fs.readFileSync(path.join(out, sitePath(site.base, "/llms.txt")), "utf8");
  if (!/^# .+\n\n> .+/.test(llms)) fail(label, "llms.txt: must start with an H1 and a blockquote summary");
  for (const p of posts) {
    const url = site.origin + markdownTwin(postPath(site.base, p.slug), site.base);
    if (!llms.includes(`](${url})`)) fail(label, `llms.txt: missing ${url}`);
  }

  // Feed and sitemap: well-formed XML with the required elements.
  const parser = new XMLParser({ ignoreAttributes: false, isArray: (name) => ["entry", "url", "link"].includes(name) });
  const feedXml = fs.readFileSync(path.join(out, sitePath(site.base, "/feed.xml")), "utf8");
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
  const sitemapXml = fs.readFileSync(path.join(out, sitePath(site.base, "/sitemap.xml")), "utf8");
  const sitemapValid = XMLValidator.validate(sitemapXml);
  if (sitemapValid !== true) fail(label, `sitemap.xml: ${JSON.stringify(sitemapValid.err)}`);
  else {
    const urls = (parser.parse(sitemapXml).urlset?.url ?? []).map((u) => u.loc);
    // the personal front page at "/" is listed too (generator/build.mjs, #81)
    const sitemapRoutes = pageRoutes;
    for (const route of sitemapRoutes) if (!urls.includes(site.origin + route)) fail(label, `sitemap.xml: missing ${route}`);
    if (urls.length !== sitemapRoutes.length) fail(label, `sitemap.xml: ${urls.length} URLs for ${sitemapRoutes.length} pages`);
  }

  const robots = fs.readFileSync(path.join(out, "robots.txt"), "utf8");
  if (!robots.includes(`Sitemap: ${site.origin}${sitePath(site.base, "/sitemap.xml")}`) || /^Disallow:\s*\/\s*$/m.test(robots)) fail(label, "robots.txt: must allow crawling and name the sitemap");

  return { pages: pageRoutes.length, posts: posts.length, embeds, links };
}

/**
 * Open Graph and Twitter tags: all there, absolute on site.origin, and pointing at a share card
 * that exists in the built site (`out`) at the size the page states. Returns the problems.
 */
export function shareProblems(route, html, site, out) {
  const problems = [];
  const meta = new Map();
  for (const m of html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">/g)) meta.set(m[1], decode(m[2]));
  const required = ["og:type", "og:site_name", "og:title", "og:description", "og:image", "og:image:width", "og:image:height", "og:image:alt", "twitter:card", "twitter:title", "twitter:description", "twitter:image", "twitter:image:alt"];
  if (html.includes('<link rel="canonical"')) required.push("og:url");
  for (const key of required) if (!meta.get(key)) problems.push(`${route}: missing <meta ${key}>`);
  if (meta.has("twitter:card") && meta.get("twitter:card") !== "summary_large_image") problems.push(`${route}: twitter:card must be summary_large_image`);
  for (const key of ["og:url", "og:image", "twitter:image"]) {
    if (meta.has(key) && !meta.get(key).startsWith(site.origin + "/")) problems.push(`${route}: ${key} must be an absolute URL on ${site.origin}, got ${meta.get(key)}`);
  }
  const image = meta.get("og:image");
  if (!image?.startsWith(site.origin + "/")) return problems;
  if (meta.get("twitter:image") !== image) problems.push(`${route}: twitter:image and og:image differ`);
  const card = image.slice(site.origin.length);
  const file = path.join(out, decodeURIComponent(card));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    problems.push(`${route}: its share card ${card} does not exist. Run \`npm run cards\` (with PLAYWRIGHT=<path to playwright>) and commit static/og/.`);
    return problems;
  }
  const png = fs.readFileSync(file);
  const size = png.length > 24 ? `${png.readUInt32BE(16)}×${png.readUInt32BE(20)}` : "not a PNG";
  const stated = `${meta.get("og:image:width")}×${meta.get("og:image:height")}`;
  if (size !== stated) problems.push(`${route}: ${card} is ${size}, but the page says ${stated}. Run \`npm run cards\`.`);
  return problems;
}

/** Production builds must not mention a draft anywhere: pages, twins, llms.txt, feed, sitemap, tags, assets. */
function checkNoDrafts(out, { base }) {
  const { posts: all } = loadPosts(path.join(ROOT, "posts"), { includeDrafts: true });
  const drafts = all.filter((p) => p.draft);
  for (const d of drafts) if (fs.existsSync(path.join(out, postPath(base, d.slug)))) fail("production", `draft folder leaked: ${postPath(base, d.slug)}`);
  for (const file of walk(out)) {
    if (!/\.(html|md|txt|xml)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const d of drafts) {
      if (text.includes(postPath(base, d.slug)) || text.includes(markdownTwin(postPath(base, d.slug), base))) fail("production", `${path.relative(out, file)} mentions draft "${d.slug}"`);
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

// Run as a script; tests import shareProblems.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const draftsDir = fs.mkdtempSync(path.join(os.tmpdir(), "site-check-"));
  const personalHome = personalHomeOn(process.env, true);
  try {
    const prod = await run("production", { outDir: path.join(ROOT, "dist"), personalHome });
    if (prod) console.log(`production: ${checkNoDrafts(path.join(ROOT, "dist"), prod.site)} draft(s) kept out`);
    await run("with drafts", { outDir: draftsDir, drafts: true, personalHome });
  } finally {
    fs.rmSync(draftsDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Output checks passed.");
}
