// Runs only on page routes (see PAGE_ROUTE_PATTERNS) and only when Markdown negotiation is on.
// `Accept: text/markdown` gets the page's static .md twin; everything else gets the HTML asset.
import { isPageRoute, markdownTwin, normalizeBase } from "../lib/paths.mjs";
import site from "../site.config.mjs";

const BASE = normalizeBase(site.base);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    if ((method !== "GET" && method !== "HEAD") || !isPageRoute(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const twinPath = markdownTwin(url.pathname, BASE);
    if (twinPath && prefersMarkdown(request.headers.get("Accept"))) {
      const twin = new URL(twinPath, url);
      const res = await env.ASSETS.fetch(new Request(twin, { method, headers: request.headers }));
      if (res.ok || res.status === 304) {
        const out = new Response(res.body, res);
        out.headers.set("Content-Type", "text/markdown; charset=utf-8");
        out.headers.set("Vary", "Accept");
        return out;
      }
      // No twin (for example a 404): fall through to the HTML answer.
    }

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.append("Vary", "Accept");
    return out;
  },
};

/**
 * True when the client explicitly asks for text/markdown at least as strongly as text/html.
 * Wildcards (`*\/*`, `text/*`) never select Markdown, so browsers and generic clients get HTML.
 */
export function prefersMarkdown(accept) {
  if (!accept) return false;
  let markdown = 0;
  let html = 0;
  for (const part of accept.split(",")) {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    if (Number.isNaN(q)) continue;
    if (type.trim() === "text/markdown") markdown = Math.max(markdown, q);
    if (type.trim() === "text/html") html = Math.max(html, q);
  }
  return markdown > 0 && markdown >= html;
}
