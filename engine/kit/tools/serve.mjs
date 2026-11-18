// A static server for the showcase. Port 5985 by default; 127.0.0.1 only.
// The kit lives in the Village engine (engine/kit), and its renderer is the engine's own source (engine/blocks), so
// this serves the engine folder: the kit under /kit/, and the two folders its renderer reads (blocks/, probe/), each .ts
// with its types stripped as the engine's servers do. The root goes to /kit/showcase/.
// The engine's renderer is the kit's default now. --engine still hands it over by name before a
// page's own script runs, and has each page tell this server what drew it (milestones/seen.log),
// which is how a phone's answer is read: PORT=5986 node tools/serve.mjs --engine
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { appendFile, readFile, rename, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const kit = join(root, 'kit');
const port = Number(process.env.PORT || 5985);
const engine = process.argv.includes('--engine');
// The Village engine's built folder (its engine/dist, after `npm run player`), sent under /engine/ and never
// written: with it a kit panel can stand in the engine's world, on this one port, as
//   /engine/landing/index.html?kit=/kit/&hour=17.8&scale=1
//   ENGINE_DIST=<Village>/engine/dist PORT=5989 node tools/serve.mjs
const world = process.env.ENGINE_DIST ? resolve(process.env.ENGINE_DIST) : null;
// module scripts run in document order, so this one runs before the page's own.
// It also tells this server what ended up drawing the page, so a phone's answer can be read here.
const HAND = `<script type="module">import { use, ready } from '/kit/src/index.js'; import { renderer } from '/kit/src/engine.js'; use(renderer()); addEventListener('load', () => ready().then((st) => fetch('/__seen?by=' + (st ? (st.renderer.ownsCanvas ? 'engine' : 'webgl2') : 'plain') + '&page=' + encodeURIComponent(location.pathname), { method: 'POST' }).catch(() => {})));</script>\n`;
const seen = join(kit, 'milestones', 'seen.log');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.mp4': 'video/mp4', '.ts': 'text/javascript; charset=utf-8' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    // the pages name their own files by relative address, so the root has to move, not just answer
    if (path === '/') { res.writeHead(302, { location: '/kit/showcase/' + url.search, 'cache-control': 'no-store' }).end(); return; }
    if (engine && path === '/__seen') {
      // A note per page load, from fixed words only. Only a page this server served may leave one:
      // a GET writes nothing, and neither does a request another site's page made. A refusal is
      // noted as such, so a phone that was turned away still shows up, and nobody can write
      // "engine" for it.
      const site = req.headers['sec-fetch-site'];
      const origin = String(req.headers.origin || '');
      const hosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
      const own = req.method === 'POST' && (site ? site === 'same-origin' : hosts.some((h) => origin === 'http://' + h || origin === 'https://' + h));
      const by = own ? ['engine', 'webgl2', 'plain'].find((b) => b === url.searchParams.get('by')) || '?' : 'refused';
      const ua = String(req.headers['user-agent'] || '');
      const device = (/iPhone|iPad|Macintosh|Android|Linux|Windows/.exec(ua) || ['?'])[0] + ' ' + (/HeadlessChrome|Chrome|Firefox|Safari/.exec(ua) || ['?'])[0];
      const page = own ? String(url.searchParams.get('page') || '').replace(/[^\w./-]/g, '').slice(0, 80) : '';
      // at 200 KB the log moves aside (one old copy is kept), so it can be filled but never stopped
      const size = await stat(seen).then((st) => st.size, () => 0);
      if (size >= 200_000) await rename(seen, seen + '.1').catch(() => {});
      await appendFile(seen, `${new Date().toISOString()} ${by} ${device} ${page}\n`).catch(() => {});
      res.writeHead(own ? 204 : 403).end(); return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const built = world && path.startsWith('/engine/');
    const base = built ? world : root;
    const file = normalize(join(base, built ? path.slice(7) : path));
    // nothing whose name starts with a dot is served: .git, .claude, an env file; of the engine only the kit and what its renderer reads
    if (!file.startsWith(base + '/') || /\/node_modules\//.test(file) || /\/\./.test(file.slice(base.length)) || (!built && !['kit', 'blocks', 'probe'].includes(file.slice(base.length + 1).split('/')[0]))) { res.writeHead(403).end('no'); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    let body = await readFile(file);
    if (file.endsWith('.ts')) body = stripTypeScriptTypes(body.toString('utf8'));
    // a clip is asked for a piece at a time (Safari plays nothing otherwise)
    const piece = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (piece && file.endsWith('.mp4') && (piece[1] || piece[2])) {
      const from = piece[1] ? Number(piece[1]) : Math.max(0, body.length - Number(piece[2]));
      const to = piece[1] && piece[2] ? Math.min(Number(piece[2]), body.length - 1) : body.length - 1;
      if (from > to || from >= body.length) { res.writeHead(416, { 'content-range': `bytes */${body.length}` }).end(); return; }
      res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${from}-${to}/${body.length}`, 'accept-ranges': 'bytes', 'content-length': to - from + 1, 'cache-control': 'no-store' });
      res.end(body.subarray(from, to + 1)); return;
    }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...(file.endsWith('.mp4') ? { 'accept-ranges': 'bytes' } : {}) });
    if (engine && !built && file.endsWith('.html') && !/[?&]gl\b/.test(req.url)) {
      const html = body.toString('utf8');
      const at = html.indexOf('<script type="module"');
      if (at >= 0 && !html.includes('seam')) body = html.slice(0, at) + HAND + html.slice(at);
    }
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`showcase on http://127.0.0.1:${port}/${engine ? ' (drawn by the engine)' : ''}`));
