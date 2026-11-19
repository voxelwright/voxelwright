// Every page as a pair: HTML for people and Markdown for agents.
// Each function returns { path, kind, title, description, html, markdown }.
//
// The HTML is built from Voxelmorphism, the Village kit vendored in static/vendor/village/kit
// (see notes/voxelmorphism.md): the page stands on the kit's ground, the bar is the kit's navbar,
// lists are its list groups and items, an article is its prose. static/site.css lays these out
// and holds no colours or controls of its own; static/site.js starts the kit.
import { escapeHtml as e, renderInline } from "./markdown.mjs";
import { markdownTwin, postPath, tagPath, slugify } from "../lib/paths.mjs";

export const KIT = "/vendor/village/kit";
// The instrument every page is fitted as: the Signal Desk's walnut case and Ridgeline caps.
// At night (the system's setting or the Lights key) the same case has its lights down.
const FITTING = { shell: "walnut", caps: "field", profile: "high", rail: "steady" };

const NAV = [
  { href: "/blog/", label: "Blog" },
  { href: "/voxelmorphism/", label: "Voxelmorphism" },
];

function navbar(page, site) {
  const links = NAV.map(({ href, label }) => {
    let current;
    if (page.path === href) current = "page";
    else if (href === "/blog/" && ["post", "tag", "tags"].includes(page.kind)) current = "true";
    return `<a href="${href}"${current ? ` aria-current="${current}"` : ""}>${label}</a>`;
  });
  return `<header class="vx-card vx-navbar-surface site-bar" data-vx-bolts="none">
<div class="vx-navbar">
<a class="vx-navbar-brand" href="/">${e(site.title)}</a>
<button class="vx-button vx-navbar-key" type="button" aria-expanded="false" aria-controls="site-links">Menu</button>
<div class="vx-navbar-fold" id="site-links">
<nav class="vx-nav" data-vx-mark="groove" aria-label="Site">${links.join("")}</nav>
<button class="vx-toggle-button site-lights" type="button" aria-pressed="false" hidden>Night</button>
</div>
</div>
</header>`;
}

function footer(page, site, twin) {
  const own = [
    twin && `<li><a href="${e(twin)}">This page as Markdown</a></li>`,
    `<li><a href="/llms.txt">llms.txt</a></li>`,
    `<li><a href="/feed.xml">Atom feed</a></li>`,
    `<li><a class="site-view" href="?view=2d" hidden>Plain page</a></li>`,
  ].filter(Boolean);
  const elsewhere = site.links?.length
    ? `<ul aria-label="Elsewhere">${site.links.map((l) => `<li><a href="${e(l.url)}" rel="me">${e(l.name)}</a></li>`).join("")}</ul>`
    : "";
  return `<footer class="vx-page-foot site-foot">
<ul aria-label="This site">${own.join("")}</ul>
${elsewhere}
</footer>`;
}

export function layout(page, site, { dev }) {
  const twin = markdownTwin(page.path);
  const canonical = site.origin + page.path;
  const home = page.kind === "home";
  const fitted = Object.entries(FITTING).map(([k, v]) => ` data-${k}="${v}"`).join("");
  return `<!doctype html>
<html lang="${e(site.language)}" data-vx-look="lit"${fitted}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(page.path === "/" ? site.title : `${page.title} · ${site.title}`)}</title>
<meta name="description" content="${e(page.description || site.description)}">
<meta name="color-scheme" content="light dark">
${twin ? `<link rel="canonical" href="${e(canonical)}">
<link rel="alternate" type="text/markdown" href="${e(twin)}" title="This page as Markdown">` : ""}
<link rel="alternate" type="application/atom+xml" href="/feed.xml" title="${e(site.title)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${KIT}/voxelmorphism.css">
<link rel="stylesheet" href="/site.css">
${(page.stylesheets ?? []).map((href) => `<link rel="stylesheet" href="${e(href)}">`).join("\n")}
${EARLY}</head>
<body class="vx-page" data-page="${page.kind}"${page.script ? ' data-boot="page"' : ""}>
${home ? '<a class="skip" href="/?view=2d#main">Plain page</a>' : '<a class="skip" href="#main">Skip to content</a>'}
<div class="vx-page-column">
${navbar(page, site)}
<main id="main" tabindex="-1">
${home ? SUPPORT : ""}${page.html}
</main>
${footer(page, site, twin)}
</div>
<script type="module" src="${page.script ?? "/site.js"}"></script>
${dev ? DEV_RELOAD : ""}</body>
</html>
`;
}

// The support character lives on the home page, in the city and on the plain page alike.
const SUPPORT = `<span id="support-dock" aria-hidden="true"></span>
<support-button version="instrument" dock="support-dock"></support-button>
<script type="module" src="/support/support-button.js"></script>
`;

// Before the first paint: the Night key's saved choice, and whether the page stays plain, so
// neither the colours nor the controls change under the reader.
const EARLY = `<script>
{
  const r = document.documentElement, q = new URLSearchParams(location.search).get("view");
  let t = null, p = null;
  try { t = localStorage.getItem("vx-theme"); p = localStorage.getItem("vx-plain"); } catch {}
  if (t === "dark" || t === "light") r.dataset.theme = t;
  // the Signal Desk's enclosure and caps, chosen this visit, fit every page
  try { const b = JSON.parse(sessionStorage.getItem("vx-instrument-build")); for (const k of ["shell", "caps", "profile", "rail"]) if (/^[a-z]+$/.test(b?.[k] ?? "")) r.dataset[k] = b[k]; } catch {}
  // plain or voxels: the saved choice, then the address, then reduced motion (static/site.js)
  if (p === "1" || q === "2d" || (q !== "3d" && matchMedia("(prefers-reduced-motion: reduce)").matches)) r.setAttribute("data-vx-plain", "");
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
// Page headings. An index page's title is voxel lettering: words built from voxels that break
// under the pointer and mend (the kit's lettering; the words stay text). A post's is set in
// the reading face, since reading comes first there.

function lettering(text, id) {
  return `<h1 class="vx-sign page-title" data-vx-board="none"${id ? ` id="${id}"` : ""}>${e(text)}</h1>`;
}

export function blogPage(site, posts) {
  const markdown = `# Blog\n\n${postListMd(posts, site) || "I haven’t published a post here yet."}\n`;
  const lead = `<header class="page-head">
${lettering("Blog")}
<p class="page-lead">Writing on Village, voxels, and building with models.</p>
</header>`;
  if (!posts.length) {
    return {
      path: "/blog/", kind: "blog", title: "Blog", description: `All posts on ${site.title}.`,
      html: `${lead}
<div class="vx-empty" data-vx-align="start">
<h2 class="vx-empty-title">Nothing published yet</h2>
<p class="vx-empty-text">The first post is on its way. Follow the feed to hear when it lands.</p>
<a class="vx-button" data-vx-kind="main" href="/feed.xml">Follow by Atom</a>
</div>`,
      markdown: `# Blog\n\nI haven’t published a post here yet.\n\n[Follow new posts by Atom](${site.origin}/feed.xml)\n`,
    };
  }
  const years = Map.groupBy(posts, (p) => p.date.slice(0, 4));
  const sections = [...years]
    .map(([year, list]) => `<section class="year" aria-labelledby="y${year}">
<h2 class="year-title" id="y${year}">${year}</h2>
${postListHtml(list)}
</section>`)
    .join("\n");
  return {
    path: "/blog/",
    kind: "blog",
    title: "Blog",
    description: `All posts on ${site.title}.`,
    html: `${lead}
<p class="page-tools"><a href="/tags/">Browse by tag</a><a href="/feed.xml">Follow by Atom</a></p>
${sections}`,
    markdown,
  };
}

export function tagsPage(site, tags) {
  const list = [...tags.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: "/tags/",
    kind: "tags",
    title: "Tags",
    description: `Topics on ${site.title}.`,
    html: `<header class="page-head">
${lettering("Tags")}
<p class="page-lead">Every topic, with how many posts each holds.</p>
</header>
<ul class="vx-list-group post-list">
${list.map((t) => `<li><a class="vx-item" href="${tagPath(t.name)}"><span class="vx-item-text"><span class="vx-item-title">${e(t.name)}</span></span><span class="vx-item-trail"><span class="vx-badge">${t.posts.length}<span class="vx-badge-aloud"> ${t.posts.length === 1 ? "post" : "posts"}</span></span></span></a></li>`).join("\n")}
</ul>`,
    markdown: `# Tags\n\n${list.map((t) => `- [${t.name}](${site.origin}${markdownTwin(tagPath(t.name))}) (${t.posts.length})`).join("\n")}\n`,
  };
}

export function tagPage(site, tag) {
  return {
    path: tagPath(tag.name),
    kind: "tag",
    title: `Tag: ${tag.name}`,
    description: `Posts tagged ${tag.name} on ${site.title}.`,
    html: `<header class="page-head">
<p class="page-kicker"><a href="/tags/">Tags</a></p>
${lettering(tag.name)}
<p class="page-lead">${tag.posts.length} ${tag.posts.length === 1 ? "post" : "posts"} tagged ${e(tag.name)}.</p>
</header>
${postListHtml(tag.posts)}`,
    markdown: `# Posts tagged ${tag.name}\n\n${postListMd(tag.posts, site)}\n`,
  };
}

export function postPage(site, post, rendered) {
  const minutes = Math.max(1, Math.round(post.body.trim().split(/\s+/).length / 220));
  const tags = post.tags.map((t) => `<li><a href="${tagPath(t)}">${e(t)}</a></li>`).join("");
  const html = `<article class="post" aria-labelledby="post-title">
<header class="post-head">
<h1 class="post-title" id="post-title">${e(post.title)}</h1>
${post.summary ? `<p class="post-standfirst">${e(post.summary)}</p>\n` : ""}<div class="post-meta"><time datetime="${post.date}">${formatDate(post.date)}</time><span class="read-time">${minutes} min read</span>${post.draft ? `<span class="vx-badge">Draft</span>` : ""}${tags ? `<ul class="post-tags" aria-label="Tags">${tags}</ul>` : ""}</div>
</header>
<div class="vx-groove post-rule" role="separator"></div>
<div class="vx-prose post-body">
${rendered.html}
</div>
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
    html: `<div class="vx-empty not-found">
${lettering("404")}
<h2 class="vx-empty-title">Nothing lives at this address</h2>
<p class="vx-empty-text">The page may have moved, or the link has a typo. The blog lists everything there is to read.</p>
<a class="vx-button" data-vx-kind="main" href="/blog/">Go to the blog</a>
</div>`,
  };
}

// The home page for builds that have no landing (generator/landing.mjs replaces it).
export function homePage(site, posts) {
  const latest = posts.slice(0, 5);
  return {
    path: "/",
    kind: "home",
    title: site.title,
    description: site.description,
    html: `<h1>${e(site.title)}</h1>\n<p>${renderInline(site.intro)}</p>\n${postListHtml(latest)}`,
    markdown: `# ${site.title}\n\n${site.intro}\n\n${postListMd(latest, site)}\n`,
  };
}

// ---------------------------------------------------------------------------

export function postListHtml(posts) {
  if (!posts.length) return "";
  return `<ul class="vx-list-group post-list">\n${posts
    .map(
      (p) =>
        `<li><a class="vx-item" data-vx-size="large" href="${postPath(p.slug)}"><span class="vx-item-text"><span class="vx-item-title">${e(p.title)}</span>${p.summary ? `<span class="vx-item-line">${e(p.summary)}</span>` : ""}</span><span class="vx-item-trail">${p.draft ? `<span class="vx-badge">Draft</span>` : ""}<time datetime="${p.date}">${shortDate(p.date)}</time></span></a></li>`,
    )
    .join("\n")}\n</ul>`;
}

function postListMd(posts, site) {
  return posts.map((p) => `- [${p.title}](${site.origin}${markdownTwin(postPath(p.slug))}) (${p.date})${p.summary ? `: ${p.summary}` : ""}`).join("\n");
}

export function formatDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function shortDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}
