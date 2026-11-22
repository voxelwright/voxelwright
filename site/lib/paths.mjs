// URL rules shared by the build, the Worker, the checks and the dev server.
// Keep the page ↔ Markdown mapping and the base path rule here and nowhere else.
//
// The base path (site.config.mjs `base`) is where the site is mounted on its origin. With "/" the
// site owns the whole origin: the landing at "/", the posts list at "/blog/". With any other base,
// say "/blog/", another app owns "/" and the site lives under the base: the posts list is the base
// itself, and every other page and file the site has is under it ("/site.css" → "/blog/site.css",
// "/tags/" → "/blog/tags/"). Posts are "/blog/<slug>/" either way. Only robots.txt and 404.html
// stay at the origin root, because crawlers and the host only read them there.

/** "blog" or "/blog" or "/blog/" → "/blog/"; nothing → "/". */
export function normalizeBase(base = "/") {
  const trimmed = String(base).replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

/** True when the site shares its origin with something that owns "/". */
export const isMounted = (base) => base !== "/";

/** A path in the site's own tree ("/site.css", "/tags/", "/") at its address under the base. */
export function sitePath(base, p) {
  return base + p.replace(/^\/+/, "");
}

/** The origin's "/": the landing when the site owns the origin, otherwise the app mounted there. */
export const HOME = "/";

/** The posts list: "/blog/" on its own origin, the base itself when mounted. */
export const blogPath = (base) => (isMounted(base) ? base : "/blog/");

/** Page routes are "/" and paths ending in "/". Everything else is a file. */
export function isPageRoute(pathname) {
  return pathname.endsWith("/");
}

/**
 * "/blog/hello/" → "/blog/hello.md"; the base itself → "<base>index.md" ("/" → "/index.md",
 * "/blog/" → "/blog/index.md" when mounted there). Null for non-page paths and for paths outside
 * the base, which are not the site's.
 */
export function markdownTwin(pathname, base = "/") {
  if (!isPageRoute(pathname) || !pathname.startsWith(base)) return null;
  if (pathname === base) return base + "index.md";
  return pathname.slice(0, -1) + ".md";
}

/**
 * Patterns for the Worker's `assets.runWorkerFirst`. Cloudflare's `*` matches across
 * slashes, so "/*\/" covers every page route at any depth and never matches a file
 * (images, scripts, models, engine files), because files do not end in "/".
 */
export const PAGE_ROUTE_PATTERNS = ["/", "/*/"];

/** Matches a pathname against Cloudflare-style patterns (`*` matches anything, `!` negates). */
export function matchesRunWorkerFirst(pathname, patterns = PAGE_ROUTE_PATTERNS) {
  const toRegExp = (p) => new RegExp("^" + p.split("*").map(escapeRegExp).join(".*") + "$");
  const negative = patterns.filter((p) => p.startsWith("!")).map((p) => toRegExp(p.slice(1)));
  const positive = patterns.filter((p) => !p.startsWith("!")).map(toRegExp);
  return positive.some((r) => r.test(pathname)) && !negative.some((r) => r.test(pathname));
}

function escapeRegExp(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const postPath = (base, slug) => `${blogPath(base)}${slug}/`;
export const tagPath = (base, tag) => sitePath(base, `/tags/${slugify(tag)}/`);

/**
 * The lines of a `_headers` file with every rule's path pattern moved under the base, for a site
 * mounted below its origin. Comments and the indented header lines stay as they are.
 */
export function mountHeaders(text, base) {
  return text
    .split("\n")
    .map((line) => (!line.trim() || /^\s/.test(line) || line.startsWith("#") ? line : sitePath(base, line)))
    .join("\n");
}
