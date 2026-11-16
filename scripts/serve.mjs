// A small local server that behaves like Workers static assets plus the Worker:
// trailing-slash redirects, 404.html, and Markdown negotiation on page routes.
// npm run dev uses it only when `cf dev` cannot start (or with --node).
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
  return {
    async fetch(input) {
      const url = new URL(input.url ?? input);
      const rel = decodeURIComponent(url.pathname);
      const file = path.join(root, rel);
      if (!file.startsWith(root)) return new Response("Bad path", { status: 400 });
      const isFile = (f) => fs.existsSync(f) && fs.statSync(f).isFile();

      if (rel.endsWith("/") && isFile(path.join(file, "index.html"))) return serve(path.join(file, "index.html"));
      if (!rel.endsWith("/") && isFile(file)) return serve(file);
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

function serve(file) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}

export function startServer({ root, port }) {
  const ASSETS = directoryAssets(path.resolve(root));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const request = new Request(url, { method: req.method, headers: req.headers });
    const response = matchesRunWorkerFirst(url.pathname) ? await worker.fetch(request, { ASSETS }) : await ASSETS.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
