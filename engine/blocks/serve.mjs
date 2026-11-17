// A server for trying the block pass against the Voxelmorphism kit (#430):
//
//   node blocks/serve.mjs [--port 5990] [--kit ~/Developer/plant-a-seed] [--reports ~/.village/engine/blocks/reports.jsonl]
//   node blocks/serve.mjs --port 5991 --as kit     the kit's own pages, drawn by the engine
//
// It sends the engine's files with the types stripped from each .ts as the page server does (../serve.mjs), the kit's
// own checkout under /kit/ (read, never written), and keeps what a page posts to /report, one line each: real Safari
// can be opened but not driven, so a page that measures says what it found itself.
//
// With `--as kit` it stands where the kit's own server stands (its tools/serve.mjs): the kit's checkout is the
// root, so its showcase and its film run unchanged, and each of its pages is handed the engine's renderer before
// its own script runs, from the built folder (`npm run player` writes dist/blocks/renderer.js) under /engine/. A
// page asked for with ?gl is sent as it is, and draws with the kit's own WebGL2.
import { createServer } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { homedir } from 'node:os'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { foreign, named } from '../guard.mjs'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const kit = resolve(arg('kit', join(homedir(), 'Developer', 'plant-a-seed')))
const reports = resolve(arg('reports', join(homedir(), '.village', 'engine', 'blocks', 'reports.jsonl')))
const asKit = arg('as', '') === 'kit'
/** What a page of the kit's is handed, before its own script: the engine's renderer, and a word to /report that it drew. */
const HANDED = `<script type="module">
import { use } from '/packages/voxelmorphism/src/index.js'
import { renderer } from '/engine/blocks/renderer.js'
use(renderer().catch((e) => { navigator.sendBeacon('/report', JSON.stringify({ route: 'kit page', step: location.pathname + ' has no renderer: ' + (e?.message ?? e), ms: Math.round(performance.now()) })); return null }).then((r) => {
  if (!r) return null
  const draw = r.draw
  r.draw = (frame, canvas) => { const n = r.stage.stats.draws; if (n === 0 || n % 200 === 199) navigator.sendBeacon('/report', JSON.stringify({ route: 'kit page', step: location.pathname + ' drew ' + (n + 1), ms: Math.round(performance.now()) })); return draw(frame, canvas) }
  globalThis.blocks = r
  return r
}))
</script>
`
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.ts': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }

export function serve(port = 5990, host = '127.0.0.1') {
  mkdirSync(dirname(reports), { recursive: true })
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), no = (status, why) => { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(why) }
    if (!named(req.headers.host)) return no(403, 'not by that name')
    if (req.method === 'POST' && url.pathname === '/report') {
      if (foreign(req)) return no(403, 'not from another site')
      let body = ''
      req.on('data', (d) => { body += d; if (body.length > 4e6) req.destroy() })
      req.on('end', () => {
        let said
        try { said = JSON.parse(body) } catch { return no(400, 'not JSON') }
        if (!said || typeof said !== 'object' || Array.isArray(said)) return no(400, 'a report is an object')
        try { appendFileSync(reports, `${JSON.stringify({ ...said, at: new Date().toISOString(), agent: req.headers['user-agent'] })}\n`) } catch (e) { console.error(`the report was not kept: ${e}`); return no(500, 'not kept') }
        console.log(`report: ${said.route ?? '?'} ${said.browser ?? ''} ${said.step ? `step ${said.step} at ${said.ms} ms${said.hidden ? ' (hidden)' : ''}` : 'done'}`)
        res.writeHead(204).end()
      })
      return
    }
    let path
    try { path = decodeURIComponent(url.pathname) } catch { return no(404, 'not found') }
    if (path.endsWith('/')) path += 'index.html'
    if (asKit && path === '/index.html') path = '/showcase/index.html'
    const built = asKit && path.startsWith('/engine/')
    const inKit = asKit ? !built : path.startsWith('/kit/'), base = built ? join(root, 'dist') : inKit ? kit : root
    const rel = normalize(built ? path.slice(8) : inKit && !asKit ? path.slice(5) : path).replace(/^[/\\]+/, ''), file = join(base, rel)
    // Of the engine only what the proof's pages load; of the kit whatever its own showcase server sends.
    if ((!inKit && !built && !['blocks', 'probe'].includes(rel.split(sep)[0])) || rel.split(sep).some((p) => p === '..' || p === 'node_modules' || p.startsWith('.')) || !(extname(rel) in TYPES) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
    let body = readFileSync(file)
    if (extname(rel) === '.ts') { try { body = stripTypeScriptTypes(body.toString('utf8')) } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end(`${rel}: ${e.message}`) } }
    if (asKit && inKit && extname(rel) === '.html' && !url.searchParams.has('gl')) body = body.toString('utf8').replace(/<script type="module"/, `${HANDED}<script type="module"`)
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)], 'Cache-Control': 'no-store' })
    res.end(body)
  })
  return new Promise((done) => server.listen(port, host, () => done({ url: `http://${host}:${server.address().port}`, reports, stop: () => server.close() })))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const site = await serve(Number(arg('port', '5990')))
  console.log(asKit ? `the kit's pages drawn by the engine on ${site.url}/showcase/ (with ?gl, by the kit's own WebGL2); reports kept in ${site.reports}` : `the proof on ${site.url}/blocks/proof/ ; reports kept in ${site.reports}`)
}
