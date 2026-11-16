// llms.txt, Atom feed, sitemap and robots.txt.
import { escapeHtml as x } from "./markdown.mjs";
import { markdownTwin, postPath } from "../lib/paths.mjs";

/** https://llmstxt.org: H1, a blockquote summary, then H2 sections of links. */
export function llmsTxt(site, posts, pages) {
  const abs = (p) => site.origin + markdownTwin(p);
  const pageLinks = pages.filter((p) => !p.path.startsWith("/blog/") || p.path === "/blog/");
  return [
    `# ${site.title}`,
    "",
    `> ${site.description}`,
    "",
    "Every page here has a Markdown version at the same address with `.md` instead of the trailing slash (`/` is `/index.md`). The links below point to those versions.",
    "",
    "## Posts",
    "",
    ...(posts.length ? posts.map((p) => `- [${p.title}](${abs(postPath(p.slug))}): ${p.summary || "Draft."}`) : ["No posts yet."]),
    "",
    "## Pages",
    "",
    ...pageLinks.map((p) => `- [${p.path === "/" ? "Home" : p.title}](${abs(p.path)})`),
    "",
    "## Optional",
    "",
    `- [Atom feed](${site.origin}/feed.xml): every post with full content`,
    `- [Sitemap](${site.origin}/sitemap.xml)`,
    "",
  ].join("\n");
}

export function atomFeed(site, posts, renderedBySlug) {
  const updated = posts.length ? `${posts[0].date}T00:00:00Z` : "1970-01-01T00:00:00Z";
  const entries = posts.slice(0, 30).map((p) => {
    const url = site.origin + postPath(p.slug);
    return `  <entry>
    <title>${x(p.title)}</title>
    <id>${x(url)}</id>
    <link rel="alternate" type="text/html" href="${x(url)}"/>
    <link rel="alternate" type="text/markdown" href="${x(site.origin + markdownTwin(postPath(p.slug)))}"/>
    <published>${p.date}T00:00:00Z</published>
    <updated>${p.date}T00:00:00Z</updated>
${p.tags.map((t) => `    <category term="${x(t)}"/>`).join("\n")}
    <summary>${x(p.summary)}</summary>
    <content type="html">${x(renderedBySlug.get(p.slug).feedHtml)}</content>
  </entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${x(site.language)}">
  <title>${x(site.title)}</title>
  <subtitle>${x(site.description)}</subtitle>
  <id>${x(site.origin + "/")}</id>
  <link rel="alternate" type="text/html" href="${x(site.origin + "/")}"/>
  <link rel="self" type="application/atom+xml" href="${x(site.origin + "/feed.xml")}"/>
  <updated>${updated}</updated>
  <author><name>${x(site.author)}</name></author>
${entries.join("\n")}
</feed>
`;
}

export function sitemap(site, pages, posts) {
  const dates = new Map(posts.map((p) => [postPath(p.slug), p.date]));
  const urls = pages
    .filter((p) => p.path.endsWith("/"))
    .map((p) => `  <url><loc>${x(site.origin + p.path)}</loc>${dates.has(p.path) ? `<lastmod>${dates.get(p.path)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

/** Crawlers named so their operators see an explicit welcome. Everything is allowed. */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "Amazonbot",
  "DuckAssistBot",
  "MistralAI-User",
];

export function robotsTxt(site) {
  return [
    "# People, search engines and AI agents are all welcome.",
    "# Markdown versions of every page: see /llms.txt",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    ...AI_CRAWLERS.map((ua) => `User-agent: ${ua}`),
    "Allow: /",
    "",
    `Sitemap: ${site.origin}/sitemap.xml`,
    "",
  ].join("\n");
}
