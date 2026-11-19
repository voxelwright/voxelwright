// Every page as a pair: HTML for people and Markdown for agents.
// Each function returns { path, title, description, html, markdown }.
import { escapeHtml as e, renderInline } from "./markdown.mjs";
import { markdownTwin, postPath, tagPath, slugify } from "../lib/paths.mjs";
import { lookStylesheet } from "./looks.mjs";

const NAV = [
  { href: "/blog/", label: "Blog" },
  { href: "/voxelmorphism/", label: "Voxelmorphism" },
];

function masthead(page, site) {
  const links = NAV.map(({ href, label }) => {
    let current;
    if (page.path === href) current = "page";
    else if (href === "/blog/" && ["post", "tag", "tags"].includes(page.kind)) current = "true";
    return `<li><a href="${href}"${current ? ` aria-current="${current}"` : ""}>${label}</a></li>`;
  });
  return `<a class="site-title" href="/">${e(site.title)}</a>
<nav aria-label="Site"><ul>${links.join("")}</ul></nav>`;
}

export function layout(page, site, { dev }) {
  const twin = markdownTwin(page.path);
  const canonical = site.origin + page.path;
  const home = page.kind === "home";
  return `<!doctype html>
<html lang="${e(site.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(page.path === "/" ? site.title : `${page.title} · ${site.title}`)}</title>
<meta name="description" content="${e(page.description || site.description)}">
<meta name="color-scheme" content="light dark">
${twin ? `<link rel="canonical" href="${e(canonical)}">
<link rel="alternate" type="text/markdown" href="${e(twin)}" title="This page as Markdown">` : ""}
<link rel="alternate" type="application/atom+xml" href="/feed.xml" title="${e(site.title)}">
<link rel="stylesheet" href="${home ? "/world-shell.css" : lookStylesheet(site.look)}">
${dev && !home ? DEV_LOOK : ""}</head>
<body data-page="${page.kind}">
${home ? '<a class="skip" href="/?view=2d#main">Plain page</a>' : '<a class="skip" href="#main">Skip to content</a>'}
${home ? "" : `<header class="site-header">${masthead(page, site)}</header>`}
<main id="main" tabindex="-1">
${page.html}
</main>
<footer class="site-footer">
<ul class="footer-links">${twin ? `<li><a href="${e(twin)}">Markdown</a></li>` : ""}<li><a href="/llms.txt">llms.txt</a></li><li><a href="/feed.xml">Atom feed</a></li></ul>
${site.links?.length ? `<ul class="footer-links social-links" aria-label="Elsewhere">${site.links.map((l) => `<li><a href="${e(l.url)}" rel="me">${e(l.name)}</a></li>`).join("")}</ul>` : ""}
${home ? `<details id="support-desk" hidden><summary>Contact support</summary><template><iframe title="Support button" src="/support/desk.html"></iframe></template></details>
<script type="module" src="/support/desk.js"></script>` : ""}
</footer>
${dev ? DEV_RELOAD : ""}</body>
</html>
`;
}

// dev only: ?look=<name> swaps the stylesheet and sticks for the tab; ?look= clears it.
const DEV_LOOK = `<script>
{
  const q = new URLSearchParams(location.search).get("look");
  let look = q;
  try { if (q !== null) sessionStorage.setItem("look", q); else look = sessionStorage.getItem("look"); } catch {}
  if (look && /^[a-z0-9-]+$/.test(look)) document.querySelector('link[rel="stylesheet"]').href = "/looks/" + look + ".css";
}
</script>
`;

const DEV_RELOAD = `<script type="module">
// dev only: reload when the build changes
const es = new EventSource("http://localhost:" + (Number(location.port) + 1) + "/events");
es.onmessage = () => location.reload();
</script>
`;

// ---------------------------------------------------------------------------

export function homePage(site, posts, tagsWithPosts) {
  const latest = posts.slice(0, 5);
  const projects = site.projects.map((p) => {
    const hasTag = p.tag && tagsWithPosts.has(slugify(p.tag));
    return { ...p, href: hasTag ? tagPath(p.tag) : null };
  });

  const html = `<section class="intro">
<h1>${e(site.title)}</h1>
<p>${renderInline(site.intro)}</p>
</section>
<section>
<h2>Latest posts</h2>
${postListHtml(latest) || "<p>No posts yet.</p>"}
${posts.length > latest.length ? `<p><a href="/blog/">All posts</a></p>` : ""}
</section>
<section>
<h2>Projects</h2>
<ul class="projects">
${projects.map((p) => `<li><strong>${p.href ? `<a href="${p.href}">${e(p.name)}</a>` : e(p.name)}</strong>: ${renderInline(p.description)}</li>`).join("\n")}
</ul>
</section>
<section>
<h2>Links</h2>
${site.links.length ? `<ul>${site.links.map((l) => `<li><a href="${e(l.url)}">${e(l.name)}</a></li>`).join("")}</ul>` : "<p>TODO: links.</p>"}
</section>`;

  const md = [
    `# ${site.title}`,
    "",
    site.intro,
    "",
    "## Latest posts",
    "",
    postListMd(latest, site) || "No posts yet.",
    "",
    "## Projects",
    "",
    ...projects.map((p) => `- **${p.href ? `[${p.name}](${site.origin}${markdownTwin(p.href)})` : p.name}**: ${p.description}`),
    "",
    "## Links",
    "",
    site.links.length ? site.links.map((l) => `- [${l.name}](${l.url})`).join("\n") : "TODO: links.",
    "",
    `All posts: ${site.origin}/blog.md`,
  ].join("\n");

  return { path: "/", kind: "home", title: site.title, description: site.description, html, markdown: md + "\n" };
}

export function blogPage(site, posts) {
  return {
    path: "/blog/",
    kind: "blog",
    title: "Blog",
    description: `All posts on ${site.title}.`,
    html: `<h1>Blog</h1>\n${postListHtml(posts) || "<p>No posts yet.</p>"}`,
    markdown: `# Blog\n\n${postListMd(posts, site) || "No posts yet."}\n`,
  };
}

export function tagsPage(site, tags) {
  const list = [...tags.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: "/tags/",
    kind: "tags",
    title: "Tags",
    description: `Topics on ${site.title}.`,
    html: `<h1>Tags</h1>\n<ul class="tags-list">\n${list.map((t) => `<li><a href="${tagPath(t.name)}">${e(t.name)}</a> <span class="count">${t.posts.length}</span></li>`).join("\n")}\n</ul>`,
    markdown: `# Tags\n\n${list.map((t) => `- [${t.name}](${site.origin}${markdownTwin(tagPath(t.name))}) (${t.posts.length})`).join("\n")}\n`,
  };
}

export function tagPage(site, tag) {
  return {
    path: tagPath(tag.name),
    kind: "tag",
    title: `Tag: ${tag.name}`,
    description: `Posts tagged ${tag.name} on ${site.title}.`,
    html: `<h1>Posts tagged <em>${e(tag.name)}</em></h1>\n${postListHtml(tag.posts)}\n<p><a href="/tags/">All tags</a></p>`,
    markdown: `# Posts tagged ${tag.name}\n\n${postListMd(tag.posts, site)}\n`,
  };
}

export function postPage(site, post, rendered) {
  const tags = post.tags.map((t) => `<li><a href="${tagPath(t)}">${e(t)}</a></li>`).join("");
  const html = `<article class="post">
<header class="post-header">
<h1>${e(post.title)}</h1>
<div class="post-meta"><time datetime="${post.date}">${formatDate(post.date)}</time>${tags ? `<ul class="post-tags" aria-label="Tags">${tags}</ul>` : ""}${post.draft ? `<span class="draft">Draft</span>` : ""}</div>
</header>
${rendered.html}
</article>`;

  const front = [
    "---",
    `title: ${JSON.stringify(post.title)}`,
    `date: ${post.date}`,
    `summary: ${JSON.stringify(post.summary)}`,
    `tags: [${post.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
    `url: ${site.origin}${postPath(post.slug)}`,
    `author: ${JSON.stringify(site.author)}`,
    ...(post.draft ? ["draft: true"] : []),
    "---",
  ].join("\n");

  return {
    path: postPath(post.slug),
    kind: "post",
    title: post.title,
    description: post.summary,
    html,
    markdown: `${front}\n\n# ${post.title}\n\n${rendered.markdown}`,
  };
}

export function notFoundPage(site) {
  return {
    path: "/404.html",
    kind: "not-found",
    title: "Not found",
    html: `<h1>Not found</h1>\n<p>Nothing lives at this address. Try the <a href="/">home page</a> or the <a href="/blog/">blog</a>.</p>`,
  };
}

// ---------------------------------------------------------------------------

function postListHtml(posts) {
  if (!posts.length) return "";
  return `<ul class="post-list">\n${posts
    .map(
      (p) =>
        `<li><a href="${postPath(p.slug)}">${e(p.title)}</a> <time datetime="${p.date}">${formatDate(p.date)}</time>${p.draft ? ` <span class="draft">Draft</span>` : ""}${p.summary ? `<p>${e(p.summary)}</p>` : ""}</li>`,
    )
    .join("\n")}\n</ul>`;
}

function postListMd(posts, site) {
  return posts.map((p) => `- [${p.title}](${site.origin}${markdownTwin(postPath(p.slug))}) (${p.date})${p.summary ? `: ${p.summary}` : ""}`).join("\n");
}

export function formatDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
