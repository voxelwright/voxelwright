// Every page as a pair: HTML for people and Markdown for agents.
// Each function returns { path, kind, title, description, html, markdown }.
//
// The HTML is built from Voxelmorphism, the Village kit vendored in static/vendor/village/kit
// (see notes/voxelmorphism.md): the page stands on the kit's ground, the bar is the kit's navbar,
// lists are its list groups and items, an article is its prose. static/site.css lays these out
// and holds no colours or controls of its own; static/site.js starts the kit.
import { escapeHtml as e } from "./markdown.mjs";
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
${shareMeta(page, site)}
${twin ? `<link rel="canonical" href="${e(canonical)}">
<link rel="alternate" type="text/markdown" href="${e(twin)}" title="This page as Markdown">` : ""}
<link rel="alternate" type="application/atom+xml" href="/feed.xml" title="${e(site.title)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${KIT}/voxelmorphism.css">
<link rel="stylesheet" href="/site.css">
${(page.stylesheets ?? []).map((href) => `<link rel="stylesheet" href="${e(href)}">`).join("\n")}
${EARLY}${BETWEEN}${SPECULATION}</head>
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
  // The home page is always the full-screen city; only its plain address (?view=2d) is plain.
  // Reduced motion, forced colours and Save-Data get the city's still (static/landing/home.js).
  if (location.pathname === "/") {
    if (q === "2d") r.setAttribute("data-vx-plain", "");
    else r.dataset.city = "";
  } else {
    // every other page: the saved choice, then the address, then reduced motion, forced colours
    // or Save-Data (static/site.js)
    const calm = ["(prefers-reduced-motion: reduce)", "(forced-colors: active)"].some((m) => matchMedia(m).matches) || navigator.connection?.saveData;
    if (p === "1" || q === "2d" || (q !== "3d" && calm)) r.setAttribute("data-vx-plain", "");
  }
}
</script>
`;

// ---------------------------------------------------------------------------
// Share cards: what a link to a page shows on X, LinkedIn, iMessage, Slack and Discord. A card is
// the city with the page's title on the park sign, painted by `npm run cards` (scripts/cards.mjs)
// into static/og/. Which card a page has depends on its kind, never on which files exist, so
// `npm run check` can fail when a page links a card that isn't there.

export const CARD = { width: 1200, height: 630 };
const HOME_CARD = "/og/home.png";
const OWN_CARDS = { home: HOME_CARD, blog: "/og/blog.png", tags: "/og/tags.png", voxelmorphism: "/og/voxelmorphism.png" };

/** The page's own card, or null when it shows the home card (tags, 404, features, draft posts). */
export function shareCard(page) {
  // a draft's Markdown twin says so in its front matter (postPage)
  if (page.kind === "post") return /^draft: true$/m.test(page.markdown) ? null : `/og${page.path.replace(/\/$/, "")}.png`;
  return OWN_CARDS[page.kind] ?? null;
}

/** Open Graph and Twitter tags, every URL absolute from site.origin. */
export function shareMeta(page, site) {
  const own = shareCard(page);
  const image = site.origin + (own ?? HOME_CARD);
  const title = page.kind === "home" ? site.title : page.title;
  const description = page.description || site.description;
  const alt = `A voxel model of San Francisco seen from Ina Coolbrith Park, with “${own ? title : site.title}” on the park sign`;
  const tags = [
    ["og:type", page.kind === "post" ? "article" : "website"],
    ["og:site_name", site.title],
    ["og:title", title],
    ["og:description", description],
    // the 404 page answers at every missing address, so it names none
    markdownTwin(page.path) && ["og:url", site.origin + page.path],
    ["og:image", image],
    ["og:image:type", "image/png"],
    ["og:image:width", CARD.width],
    ["og:image:height", CARD.height],
    ["og:image:alt", alt],
    ["twitter:card", "summary_large_image"],
    ["twitter:title", title],
    ["twitter:description", description],
    ["twitter:image", image],
    ["twitter:image:alt", alt],
  ];
  return tags
    .filter(Boolean)
    .map(([key, value]) => `<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${e(String(value))}">`)
    .join("\n");
}

// Between pages: the site moves as one place (site.css, "Between pages"). A browser without
// cross-document view transitions just navigates; this script only names and sorts them.
//   - The bar stays put and the page's title travels into the next one's: the city sign that was
//     pressed rises into the Blog's lettering, a list's row grows into its post's title, and back.
//   - Back to the city is instant: the city waits whole in the back/forward cache.
// What it names for one departure is cleared when the page shows again, since the back/forward
// cache keeps the page as it left. A page prepared ahead (prerendered, see SPECULATION) takes up
// the night and the instrument chosen since, as the early script would have.
const BETWEEN = `<script>
{
  const r = document.documentElement, still = matchMedia("(prefers-reduced-motion: reduce)");
  const at = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x : null; } catch { return null; } };
  const city = (x) => x?.pathname === "/" && x.searchParams.get("view") !== "2d";
  const seen = (el) => { const b = el?.getBoundingClientRect(); return !!b && b.width > 1 && b.height > 1 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth; };
  const named = new Set();
  const name = (el, n) => { el.style.viewTransitionName = n; named.add(el); };
  const forget = () => { for (const el of named) el.style.viewTransitionName = ""; named.clear(); };
  const travellers = () => document.querySelectorAll(".site-bar, .page-title, .post-title");
  // a skipped transition rejects its ready promise; nobody waits on it here
  const skip = (vt) => { vt.ready.catch(() => {}); vt.skipTransition(); };
  // the row in a list that opens the page at x
  const row = (x) => [...document.querySelectorAll(".post-list a.vx-item")].find((a) => at(a.href)?.pathname === x?.pathname)?.querySelector(".vx-item-title");
  // the title travels from (or to) a stand-in for it on this page; the page's own title stays
  const stand = (el) => { if (!seen(el)) return; for (const t of document.querySelectorAll(".page-title, .post-title")) name(t, "none"); name(el, "page-title"); };
  // a bar or title off screen would fly in from above the window; it fades with the page instead
  const settle = () => { for (const el of travellers()) if (!named.has(el) && !seen(el)) name(el, "none"); };
  let pressed = null;
  addEventListener("click", (e) => { pressed = e.target.closest?.("a[href]") ?? null; }, true);
  addEventListener("pageswap", (e) => {
    const vt = e.viewTransition, to = at(e.activation?.entry.url ?? pressed?.href ?? "");
    if (!vt) return;
    if (city(to) && e.activation?.navigationType === "traverse") return skip(vt);
    if (still.matches || !to) return;
    if (pressed?.matches(".park-sign a[data-hit]") && at(pressed.href)?.pathname === to.pathname) stand(pressed);
    else stand(row(to));
    settle();
  });
  addEventListener("pagereveal", (e) => {
    const vt = e.viewTransition, a = window.navigation?.activation, from = at(a?.from?.url ?? document.referrer);
    if (!vt) return;
    if (city(at(location.href)) && a?.navigationType === "traverse") return skip(vt);
    if (still.matches) return;
    if (city(from)) vt.types?.add("from-city");
    else if (city(at(location.href))) vt.types?.add("to-city");
    if (from && from.pathname !== location.pathname) stand(row(from));
    settle();
    vt.finished.finally(forget);
  });
  // a page prepared ahead, or kept in the back/forward cache, catches up with the night and the
  // instrument chosen on other pages since; a change of night is told as the Night key tells it
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const night = () => r.dataset.theme === "dark" || (r.dataset.theme !== "light" && dark.matches);
  const catchUp = () => {
    const was = night();
    let t = null, b = null;
    try { t = localStorage.getItem("vx-theme"); b = JSON.parse(sessionStorage.getItem("vx-instrument-build")); } catch {}
    if (t === "dark" || t === "light") r.dataset.theme = t; else delete r.dataset.theme;
    for (const k of ["shell", "caps", "profile", "rail"]) if (/^[a-z]+$/.test(b?.[k] ?? "")) r.dataset[k] = b[k];
    if (night() !== was) document.dispatchEvent(new CustomEvent("vx-night", { detail: { night: night() } }));
  };
  addEventListener("pageshow", (e) => { forget(); if (e.persisted) catchUp(); });
  document.addEventListener("prerenderingchange", catchUp, { once: true });
}
</script>
`;

// The next page, ready before the press. A page route the pointer rests on (or presses) is
// prerendered: its kit waits for the page to be shown before it opens a GPU device (site.js).
// The city ("/", and its plain address) is only prefetched: prerendered, it would open the GPU
// and start its world in a background tab. Links with a query (?view=) change a saved choice when
// pressed, so they are left to load as they are.
const SPECULATION = `<script type="speculationrules">
{"prerender":[{"where":{"and":[{"href_matches":"/*/"},{"not":{"selector_matches":"[href*='?'], [href^='#'], [download]"}}]},"eagerness":"moderate"}],
"prefetch":[{"where":{"href_matches":"/"},"eagerness":"moderate"}]}
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

// Lost in the fog: the city's poster swallowed by the marine layer, and a park sign with the
// ways out. The fog is CSS and stands still on its own (no script, reduced motion); with motion
// allowed, static/lost/fog.js drifts it on a 2D canvas and lets the pointer clear it. It is
// served for every unknown address, at any depth, so every URL here is absolute.
export function notFoundPage(site) {
  return {
    path: "/404.html",
    kind: "not-found",
    title: "Not found",
    description: "Nothing stands at this address. Ways back to the city, the blog and Voxelmorphism.",
    stylesheets: ["/lost/lost.css"],
    html: `<div class="lost">
<div class="lost-scene" aria-hidden="true">
<img class="lost-city" src="/landing/ina.webp" width="2018" height="864" alt="" fetchpriority="high">
<div class="lost-banks"><i></i><i></i><i></i><i></i></div>
<canvas class="lost-fog" hidden></canvas>
<div class="lost-glow"></div>
</div>
<section class="lost-sign" aria-labelledby="lost-title">
<p class="lost-head"><span>Fog advisory</span><span class="lost-code">404</span></p>
<h1 class="lost-title" id="lost-title">Nothing here but fog</h1>
<p class="lost-note">No page stands at <span class="lost-where">this address</span>. Either it was never built, or Karl the Fog has it.</p>
<nav class="lost-ways" aria-label="Ways out">
<a class="lost-home" href="/">Back to the city</a>
<a href="/blog/">Blog</a>
<a href="/voxelmorphism/">Voxelmorphism</a>
</nav>
</section>
</div>
<script type="module" src="/lost/lost.js"></script>`,
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
