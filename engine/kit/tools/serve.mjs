// A static server for the showcase. Port 5985 by default; 127.0.0.1 only.
// With --engine every page is handed the Village engine's renderer before its own script runs,
// so the same pages and the same tools run on WebGPU: PORT=5986 node tools/serve.mjs --engine
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 5985);
const engine = process.argv.includes('--engine');
// module scripts run in document order, so this one runs before the page's own
const HAND = `<script type="module">import { use } from '/packages/voxelmorphism/src/index.js'; import { renderer } from '/packages/voxelmorphism/src/engine.js'; use(renderer());</script>\n`;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/showcase/';
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + '/') || /\/(node_modules|\.git)\//.test(file)) { res.writeHead(403).end('no'); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    let body = await readFile(file);
    if (engine && file.endsWith('.html') && !/[?&]gl\b/.test(req.url)) {
      const html = body.toString('utf8');
      const at = html.indexOf('<script type="module"');
      if (at >= 0 && !html.includes('seam')) body = html.slice(0, at) + HAND + html.slice(at);
    }
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`showcase on http://127.0.0.1:${port}/${engine ? ' (drawn by the engine)' : ''}`));
