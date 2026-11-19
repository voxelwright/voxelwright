// Builds the whole site into one directory.
import fs from "node:fs";
import path from "node:path";
import { loadPosts } from "./posts.mjs";
import { renderPost, ContentError } from "./markdown.mjs";
import { homePage } from "./landing.mjs";
import { voxelmorphismPage } from "./voxelmorphism.mjs";
import { layout, blogPage, tagsPage, tagPage, postPage, notFoundPage } from "./pages.mjs";
import { llmsTxt, atomFeed, sitemap, robotsTxt } from "./feeds.mjs";
import { markdownTwin, postPath, slugify } from "../lib/paths.mjs";
import { loadFeatures, inject } from "./features.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * @param {object} options
 * @param {string} options.outDir      Output directory; emptied first.
 * @param {boolean} [options.drafts]   Include draft posts (dev only).
 * @param {boolean} [options.dev]      Add the live-reload script.
 * @param {string} [options.postsDir]  Defaults to ./posts.
 * @param {object} [options.site]      Defaults to site.config.mjs.
 * @param {string} [options.featuresDir]  Defaults to ./features. Only features whose flag is on are read.
 * @returns {Promise<{ posts: object[], pages: object[] }>}
 * @throws {ContentError} listing every content problem found.
 */
export async function build({ outDir, drafts = false, dev = false, postsDir = path.join(ROOT, "posts"), featuresDir = path.join(ROOT, "features"), site }) {
  site ??= (await import(path.join(ROOT, "site.config.mjs"))).default;
  site = { ...site, origin: site.origin.replace(/\/+$/, "") };

  const { posts, errors } = loadPosts(postsDir, { includeDrafts: drafts });
  const loaded = await loadFeatures(site, { featuresDir, dev });
  const features = loaded.features;
  errors.push(...loaded.errors);

  const rendered = new Map();
  for (const post of posts) {
    const result = renderPost(post.body, {
      file: post.file,
      lineOffset: post.bodyLine,
      dir: post.dir,
      basePath: postPath(post.slug),
      origin: site.origin,
      dev,
    });
    errors.push(...result.errors);
    rendered.set(post.slug, result);
  }
  if (errors.length) throw new ContentError(`Build failed:\n  ${errors.join("\n  ")}`);

  const tags = new Map();
  for (const post of posts) {
    for (const name of post.tags) {
      const key = slugify(name);
      if (!tags.has(key)) tags.set(key, { name, posts: [] });
      tags.get(key).posts.push(post);
    }
  }

  const pages = [
    homePage(site, posts, new Set(tags.keys())),
    voxelmorphismPage(site),
    blogPage(site, posts),
    tagsPage(site, tags),
    ...[...tags.values()].map((t) => tagPage(site, t)),
    ...posts.map((p) => postPage(site, p, rendered.get(p.slug))),
  ];
  // Pages and files added by features that are on. A feature may add, never replace.
  const problems = [];
  for (const f of features) {
    for (const page of (await f.hooks.pages?.(site, { posts })) ?? []) {
      if (typeof page?.path !== "string" || !page.path.startsWith("/") || !page.path.endsWith("/")) problems.push(`features/${f.name}: a page path must start and end with "/", got ${JSON.stringify(page?.path)}.`);
      else if (pages.some((p) => p.path === page.path)) problems.push(`features/${f.name}: the page ${page.path} already exists.`);
      else if (typeof page.html !== "string" || typeof page.markdown !== "string" || !page.title) problems.push(`features/${f.name}: the page ${page.path} needs a title, html and markdown.`);
      else pages.push({ kind: "feature", description: "", ...page });
    }
  }
  if (problems.length) throw new ContentError(`Build failed:\n  ${problems.join("\n  ")}`);

  // Empty the directory rather than replacing it, so a dev server watching it keeps working.
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "static"), outDir, { recursive: true });

  for (const page of pages) {
    write(outDir, path.join(page.path, "index.html"), inject(layout(page, site, { dev }), page, site, features));
    write(outDir, markdownTwin(page.path), page.markdown);
  }
  const notFound = notFoundPage(site);
  write(outDir, "404.html", inject(layout(notFound, site, { dev }), notFound, site, features));

  // Post folders: everything beside index.md is published with the post.
  for (const post of posts) {
    for (const entry of fs.readdirSync(post.dir, { withFileTypes: true })) {
      if (entry.name === "index.md" || entry.name.startsWith(".")) continue;
      fs.cpSync(path.join(post.dir, entry.name), path.join(outDir, "blog", post.slug, entry.name), { recursive: true });
    }
  }

  write(outDir, "llms.txt", llmsTxt(site, posts, pages));
  write(outDir, "feed.xml", atomFeed(site, posts, rendered));
  write(outDir, "sitemap.xml", sitemap(site, pages, posts));
  write(outDir, "robots.txt", robotsTxt(site));

  // Feature files go in last, so they can be checked against everything the site itself wrote.
  const taken = [];
  for (const f of features) {
    if (!f.staticDir) continue;
    for (const rel of walk(f.staticDir)) {
      if (fs.existsSync(path.join(outDir, rel))) taken.push(`features/${f.name}/static/${rel} would replace a file the site already has.`);
      // _headers, _redirects, .assetsignore and their kind are read by the host as rules for the whole site
      if (/^[._]/.test(rel.split(path.sep)[0])) taken.push(`features/${f.name}/static/${rel}: a name that starts with "." or "_" at the top of the site is configuration for the host, not a file to publish.`);
    }
    if (!taken.length) fs.cpSync(f.staticDir, outDir, { recursive: true });
  }
  if (taken.length) throw new ContentError(`Build failed:\n  ${taken.join("\n  ")}`);

  return { posts, pages, site };
}

/** Every file under dir, as paths relative to it. */
function walk(dir, rel = "") {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(rel, entry.name);
    return entry.isDirectory() ? walk(dir, next) : [next];
  });
}

function write(outDir, rel, content) {
  const file = path.join(outDir, rel);
  // Two routes can name one file (/blog// and /blog/, or /Blog/ where case does not count).
  // The build writes each file once, so the second is a mistake, never a replacement.
  if (fs.existsSync(file)) throw new ContentError(`Build failed:\n  ${rel} would be written twice: two pages, or a page and a file, have the same address.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export { ContentError };
