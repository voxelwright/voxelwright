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
 * path it was asked for, what it answered, when (ms since 1970), how many bytes the file holds and how many were
 * sent (`wire`), with what encoding, and what encodings the browser said it takes.
 *
 * As a host set up for a release (#450, sf/release.md) would also do, unless `plainly`: a file with a Brotli copy
 * beside it (`<file>.br`, sf/build.mjs) is sent as that copy with `Content-Encoding: br` to a browser that takes it;
 * what is under a `releases/` folder may be kept a year and never asked again (it is named by its hash); and a
 * release's pointer (`current.json`) is asked again every time. `fail(path)`, for the checks, answers a status in
 * place of the file where it says one. `extra(req, res)`, for the checks, answers what it says it has (true).
 */
export async function plain(dir, host = '127.0.0.1', port = 0, { plainly = false, fail = null, extra = null } = {}) {
  const asked = []
  const server = createServer((req, res) => {
    // A check's own pages and reports (test/sf-phone.mjs), answered before any file.
    if (extra?.(req, res)) return
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname), rel = normalize(path).replace(/^[/\\]+/, ''), file = join(dir, rel)
    const accept = String(req.headers['accept-encoding'] ?? '')
    const failed = fail?.(path)
    if (failed) { asked.push({ path, status: failed, at: Date.now(), accept }); res.writeHead(failed, { 'Content-Type': 'text/plain' }); return res.end('failed') }
    if (rel.split(sep).includes('..') || !(extname(rel) in TYPES) || !existsSync(file) || !statSync(file).isFile()) { asked.push({ path, status: 404, at: Date.now(), accept }); res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
    const s = statSync(file), etag = `"${s.size.toString(16)}-${Math.round(s.mtimeMs).toString(16)}"`
    const keep = plainly ? 'max-age=600' : rel.split(sep).includes('releases') ? 'public, max-age=31536000, immutable' : rel.endsWith('current.json') ? 'no-cache' : 'max-age=600'
    const squeezed = !plainly && /\bbr\b/.test(accept) && existsSync(`${file}.br`) ? `${file}.br` : null
    const headers = { 'Content-Type': TYPES[extname(rel)], ETag: squeezed ? etag.replace(/"$/, '-br"') : etag, 'Last-Modified': s.mtime.toUTCString(), 'Cache-Control': keep, ...(plainly ? {} : { Vary: 'Accept-Encoding' }) }
    if (req.headers['if-none-match'] === headers.ETag) { asked.push({ path, status: 304, at: Date.now(), accept }); res.writeHead(304, headers); return res.end() }
    const wire = squeezed ? statSync(squeezed).size : s.size
    asked.push({ path, status: 200, at: Date.now(), bytes: s.size, wire, encoding: squeezed ? 'br' : 'identity', accept })
    res.writeHead(200, { ...headers, 'Content-Length': wire, ...(squeezed ? { 'Content-Encoding': 'br' } : {}) })
    createReadStream(squeezed ?? file).pipe(res)
  })
  await new Promise((done) => server.listen(port, host, done))
  return { url: `http://${host}:${server.address().port}`, asked, stop: () => server.close() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
  const site = await plain(resolve(dirname(dirname(fileURLToPath(import.meta.url))), arg('dir', 'dist')), '127.0.0.1', Number(arg('port', '5760')))
  console.log(`the player on ${site.url}/player/index.html, two in a page on ${site.url}/player/host.html\nthe landing (#421): the home page over the street on ${site.url}/landing/site/index.html, the street alone on ${site.url}/landing/index.html`)
}
