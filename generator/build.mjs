// Builds the whole site into one directory.
import fs from "node:fs";
import path from "node:path";
import { loadPosts } from "./posts.mjs";
import { renderPost, ContentError } from "./markdown.mjs";
import * as basePages from "./pages.mjs";
import { llmsTxt, atomFeed, sitemap, robotsTxt } from "./feeds.mjs";
import { markdownTwin, postPath, slugify } from "../lib/paths.mjs";
import { lookStylesheet, chosenLook, DESIGNS } from "./looks.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * @param {object} options
 * @param {string} options.outDir      Output directory; emptied first.
 * @param {boolean} [options.drafts]   Include draft posts (dev only).
 * @param {boolean} [options.dev]      Add the live-reload script.
 * @param {string} [options.postsDir]  Defaults to ./posts.
 * @param {object} [options.site]      Defaults to site.config.mjs.
 * @returns {Promise<{ posts: object[], pages: object[] }>}
 * @throws {ContentError} listing every content problem found.
 */
export async function build({ outDir, drafts = false, dev = false, postsDir = path.join(ROOT, "posts"), site }) {
  site ??= (await import(path.join(ROOT, "site.config.mjs"))).default;
  site = { ...site, origin: site.origin.replace(/\/+$/, ""), look: chosenLook(site) };
  lookStylesheet(site.look); // fails early on an unknown look
  const design = DESIGNS[site.look];
  const pagesModule = design?.pagesFile ? await import(design.pagesFile) : basePages;
  const { layout, homePage, blogPage, tagsPage, tagPage, postPage, notFoundPage } = pagesModule;

  const { posts, errors } = loadPosts(postsDir, { includeDrafts: drafts });

  const rendered = new Map();
  for (const post of posts) {
    const result = renderPost(post.body, {
      file: post.file,
      lineOffset: post.bodyLine,
      dir: post.dir,
      basePath: postPath(post.slug),
      origin: site.origin,
      look: site.look,
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
    blogPage(site, posts),
    tagsPage(site, tags),
    ...[...tags.values()].map((t) => tagPage(site, t)),
    ...posts.map((p) => postPage(site, p, rendered.get(p.slug))),
  ];

  // Empty the directory rather than replacing it, so a dev server watching it keeps working.
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "static"), outDir, { recursive: true });
  if (design && fs.existsSync(path.join(design.dir, "static"))) fs.cpSync(path.join(design.dir, "static"), outDir, { recursive: true });

  for (const page of pages) {
    write(outDir, path.join(page.path, "index.html"), layout(page, site, { dev }));
    write(outDir, markdownTwin(page.path), page.markdown);
  }
  write(outDir, "404.html", layout(notFoundPage(site), site, { dev }));

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

  return { posts, pages, site };
}

function write(outDir, rel, content) {
  const file = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export { ContentError };
