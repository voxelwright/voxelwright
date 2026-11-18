// A server for trying the block pass against the Voxelmorphism kit (#430):
//
//   node blocks/serve.mjs [--port 5990] [--reports ~/.village/engine/blocks/reports.jsonl]
//
// It sends the engine's files with the types stripped from each .ts as the page server does (../serve.mjs), the kit
// (engine/kit, #434) under /kit/, and keeps what a page posts to /report, one line each: real Safari can be opened but
// not driven, so a page that measures says what it found itself. The kit's pages import the engine's renderer
// themselves (kit/src/engine.js), so they run here as they are: /kit/showcase/.
import { createServer } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { homedir } from 'node:os'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { foreign, named } from '../guard.mjs'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const reports = resolve(arg('reports', join(homedir(), '.village', 'engine', 'blocks', 'reports.jsonl')))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.ts': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' }

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
    const rel = normalize(path).replace(/^[/\\]+/, ''), file = join(root, rel)
    // Of the engine only what the proof's pages and the kit's load.
    if (!['blocks', 'probe', 'kit'].includes(rel.split(sep)[0]) || rel.split(sep).some((p) => p === '..' || p === 'node_modules' || p.startsWith('.')) || !(extname(rel) in TYPES) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
    let body = readFileSync(file)
    if (extname(rel) === '.ts') { try { body = stripTypeScriptTypes(body.toString('utf8')) } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end(`${rel}: ${e.message}`) } }
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)], 'Cache-Control': 'no-store' })
    res.end(body)
  })
  return new Promise((done) => server.listen(port, host, () => done({ url: `http://${host}:${server.address().port}`, reports, stop: () => server.close() })))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const site = await serve(Number(arg('port', '5990')))
  console.log(`the proof on ${site.url}/blocks/proof/ , the kit on ${site.url}/kit/showcase/ ; reports kept in ${site.reports}`)
}
