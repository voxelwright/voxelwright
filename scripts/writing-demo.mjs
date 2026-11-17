// Demo for the writing lane: builds the real posts (drafts included) in the fresh and blend
// looks and serves them side by side, at /fresh/… and /blend/….
//
//   node scripts/writing-demo.mjs            build, then serve http://localhost:5976/
//   node scripts/writing-demo.mjs --build    build only
//   PORT=5977 node scripts/writing-demo.mjs
//
// Builds are production builds with drafts (no live-reload script). Root-absolute URLs in pages
// and stylesheets are rewritten per request so each look stays inside its own prefix.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { build } from "../generator/build.mjs";
import config from "../site.config.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, ".dev-writing");
const PORT = Number(process.env.PORT || 5976);
export const LOOKS = ["fresh", "blend"];
const DEMO = "/blog/ai-sessions-as-blocks/";

// Stand-in settings, so the pages are not full of TODOs. Nothing here is the owner's writing.
const site = { ...config, title: "zahynailo.dev", author: "Preview author", description: "Placeholder description for the writing demo." };

export async function buildAll() {
  for (const look of LOOKS) {
    process.env.SITE_LOOK = look;
    const started = performance.now();
    const { pages } = await build({ outDir: path.join(OUT, look), drafts: true, site });
    console.log(`/${look}/: ${pages.length} pages in ${Math.round(performance.now() - started)} ms`);
  }
  delete process.env.SITE_LOOK;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
};

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}

function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const m = /^\/([a-z]+)(\/.*)?$/.exec(decodeURIComponent(url.pathname));
  if (!m || !LOOKS.includes(m[1])) return send(res, 302, "text/plain", "", { location: `/fresh${DEMO}` });
  const look = m[1];
  const rest = m[2] ?? "/";
  const root = path.join(OUT, look);
  let file = path.resolve(root, "." + rest);
  if (!file.startsWith(root)) return send(res, 400, "text/plain", "Bad path");
  if (rest.endsWith("/")) file = path.join(file, "index.html");
  let status = 200;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    status = 404;
    file = path.join(root, "404.html");
  }
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  if (type.startsWith("text/html")) {
    const html = fs.readFileSync(file, "utf8").replace(/(\s(?:href|src)=")\/(?!\/)/g, `$1/${look}/`);
    const other = LOOKS.find((l) => l !== look);
    const switcher = `<p style="position:fixed;right:12px;bottom:12px;margin:0;z-index:9;font:600 13px/1 ui-sans-serif,sans-serif"><a href="/${other}${rest}${url.hash}" style="display:inline-block;padding:10px 14px;border-radius:999px;background:#16171d;color:#fff;text-decoration:none">${look}: switch to ${other}</a></p>`;
    return send(res, status, type, url.searchParams.has("noswitch") ? html : html.replace("</body>", switcher + "</body>"));
  }
  if (type.startsWith("text/css")) return send(res, status, type, fs.readFileSync(file, "utf8").replace(/url\("\//g, `url("/${look}/`));
  send(res, status, type, fs.readFileSync(file));
}

if (process.argv[1] === import.meta.filename) {
  await buildAll();
  if (!process.argv.includes("--build")) {
    http.createServer(handle).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}/fresh${DEMO}  and  /blend${DEMO}`));
  }
}
