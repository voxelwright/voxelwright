// A small local server that behaves like Workers static assets plus the Worker:
// trailing-slash redirects, 404.html, Markdown negotiation on page routes, and the platform's
// caching: an ETag on every file, "public, max-age=0, must-revalidate" unless the site's _headers
// file says otherwise (so the back/forward cache and prefetches behave as they do in production).
// npm run dev uses it only when `cf dev` cannot start (or with --node).
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import worker from "../src/worker.mjs";
import { matchesRunWorkerFirst } from "../lib/paths.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

/** env.ASSETS for a directory, following htmlHandling "auto-trailing-slash" and notFoundHandling "404-page". */
export function directoryAssets(root) {
  const rules = headerRules(root);
  const serve = (file, request) => {
    const body = fs.readFileSync(file);
    const etag = `"${crypto.createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
    const headers = new Headers({
      "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": DEFAULT_CACHE,
      ETag: etag,
    });
    applyRules(rules, "/" + path.relative(root, file).split(path.sep).join("/").replace(/(^|\/)index\.html$/, "$1"), headers);
    const match = request?.headers?.get?.("If-None-Match");
    if (match && match.split(",").some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers });
    return new Response(body, { headers });
  };
  return {
    async fetch(input) {
      const url = new URL(input.url ?? input);
      const rel = decodeURIComponent(url.pathname);
      const file = path.join(root, rel);
      if (!file.startsWith(root)) return new Response("Bad path", { status: 400 });
      // the host reads _headers as configuration and never serves it
      const hidden = rel === "/_headers";
      const isFile = (f) => fs.existsSync(f) && fs.statSync(f).isFile();

      if (rel.endsWith("/") && isFile(path.join(file, "index.html"))) return serve(path.join(file, "index.html"), input);
      if (!rel.endsWith("/") && !hidden && isFile(file)) return serve(file, input);
      if (!rel.endsWith("/") && isFile(path.join(file, "index.html"))) {
        return new Response(null, { status: 307, headers: { Location: rel + "/" + url.search } });
      }
      const notFound = path.join(root, "404.html");
      return new Response(isFile(notFound) ? fs.readFileSync(notFound) : "Not found", {
        status: 404,
        headers: { "Content-Type": TYPES[".html"] },
      });
    },
  };
}

// Workers static assets' default (developers.cloudflare.com/workers/static-assets/headers/).
const DEFAULT_CACHE = "public, max-age=0, must-revalidate";

/**
 * The rules in <root>/_headers, as Workers static assets reads them: a path pattern on its own
 * line (one `*` splat, greedy; `:name` placeholders stop at "/"), then indented "Name: value"
 * lines, or "! Name" to drop a header an earlier rule set. Rules apply in order; a header two
 * rules set is joined with ", ".
 */
export function headerRules(root) {
  const file = path.join(root, "_headers");
  if (!fs.existsSync(file)) return [];
  const rules = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const source = line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/, ".*").replace(/:[A-Za-z]\w*/g, "[^/]+");
      rules.push({ pattern: new RegExp("^" + source + "$"), set: [], drop: [] });
    } else if (rules.length) {
      const drop = line.trim().match(/^!\s*(\S+)$/);
      if (drop) rules.at(-1).drop.push(drop[1]);
      else {
        const at = line.indexOf(":");
        rules.at(-1).set.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
      }
    }
  }
  return rules;
}

function applyRules(rules, pathname, headers) {
  const added = new Set();
  for (const rule of rules) {
    if (!rule.pattern.test(pathname)) continue;
    for (const name of rule.drop) { headers.delete(name); added.delete(name.toLowerCase()); }
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      if (added.has(key)) headers.set(name, headers.get(name) + ", " + value);
      else { headers.set(name, value); added.add(key); }
    }
  }
}

export function startServer({ root, port, host }) {
  const ASSETS = directoryAssets(path.resolve(root));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const request = new Request(url, { method: req.method, headers: req.headers });
    const response = matchesRunWorkerFirst(url.pathname) ? await worker.fetch(request, { ASSETS }) : await ASSETS.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
