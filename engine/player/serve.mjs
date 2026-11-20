// A host of plain files (#419), for looking at what `npm run player` wrote and for measuring it (test/player.mjs):
//
//   node player/serve.mjs [--port 5760] [--dir dist]
//
// It is here so that the player is tried as a static site would serve it, and not by the page server, whose
// headers (COOP, COEP, a CSP) a static site does not send.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.png': 'image/png', '.svg': 'image/svg+xml', '.bay': 'application/octet-stream' }
/**
 * A host of plain files, as a static site's is: each file with its usual type, an ETag, and leave to keep it ten
 * minutes (what GitHub Pages sends). No header of the page server's: no COOP, no COEP, no CSP. `asked` is every
 * path it was asked for, what it answered, when (ms since 1970) and how many bytes it sent.
 */
export async function plain(dir, host = '127.0.0.1', port = 0) {
  const asked = []
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname), rel = normalize(path).replace(/^[/\\]+/, ''), file = join(dir, rel)
    if (rel.split(sep).includes('..') || !(extname(rel) in TYPES) || !existsSync(file) || !statSync(file).isFile()) { asked.push({ path, status: 404, at: Date.now() }); res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
    const s = statSync(file), etag = `"${s.size.toString(16)}-${Math.round(s.mtimeMs).toString(16)}"`
    const headers = { 'Content-Type': TYPES[extname(rel)], ETag: etag, 'Last-Modified': s.mtime.toUTCString(), 'Cache-Control': 'max-age=600' }
    if (req.headers['if-none-match'] === etag) { asked.push({ path, status: 304, at: Date.now() }); res.writeHead(304, headers); return res.end() }
    asked.push({ path, status: 200, at: Date.now(), bytes: s.size })
    res.writeHead(200, { ...headers, 'Content-Length': s.size })
    createReadStream(file).pipe(res)
  })
  await new Promise((done) => server.listen(port, host, done))
  return { url: `http://${host}:${server.address().port}`, asked, stop: () => server.close() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
  const site = await plain(resolve(dirname(dirname(fileURLToPath(import.meta.url))), arg('dir', 'dist')), '127.0.0.1', Number(arg('port', '5760')))
  console.log(`the player on ${site.url}/player/index.html, two in a page on ${site.url}/player/host.html\nthe landing (#421): the home page over the street on ${site.url}/landing/site/index.html, the street alone on ${site.url}/landing/index.html`)
}
