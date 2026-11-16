// URL rules shared by the build, the Worker, the checks and the dev server.
// Keep the page ↔ Markdown mapping here and nowhere else.

/** Page routes are "/" and paths ending in "/". Everything else is a file. */
export function isPageRoute(pathname) {
  return pathname.endsWith("/");
}

/** "/" → "/index.md", "/blog/hello/" → "/blog/hello.md". Null for non-page paths. */
export function markdownTwin(pathname) {
  if (!isPageRoute(pathname)) return null;
  if (pathname === "/") return "/index.md";
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

export const postPath = (slug) => `/blog/${slug}/`;
export const tagPath = (tag) => `/tags/${slugify(tag)}/`;
