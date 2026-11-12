// The engine's page server (#140). It serves the page's TypeScript with the types taken out
// (Node's own stripper, so there is no bundler and a visit always runs what is on disk), and it
// keeps what a page reports about the device it ran on: one JSON line a report, outside the repo.
//
//   node serve.mjs [--port 5740] [--reports ~/.village/engine/reports.jsonl]
//
// It listens on this machine only. A phone reaches it through `tailscale serve`.
import { createServer } from 'node:http'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { homedir } from 'node:os'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const port = Number(arg('port', '5740'))
const reports = arg('reports', join(homedir(), '.village', 'engine', 'reports.jsonl'))
/** What the page may ask for: the folders of pages, never the server or its tests. */
const OPEN = ['probe', 'page']
const TYPES = { '.html': 'text/html; charset=utf-8', '.ts': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json' }
/** A page that is its own origin's only reader may share memory with its workers and read a fine clock. */
const HEADERS = { 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
const BODY_MOST = 2 << 20

const send = (res, code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { ...HEADERS, 'Content-Type': type }); res.end(body) }

async function file(res, path) {
  const rel = normalize(path).replace(/^[/\\]+/, '')
  if (rel.startsWith('..') || !OPEN.includes(rel.split(sep)[0]) || !(extname(rel) in TYPES)) return send(res, 404, 'not here')
  let body
  try { body = await readFile(join(root, rel)) } catch { return send(res, 404, 'not here') }
  if (extname(rel) === '.ts') {
    try { body = stripTypeScriptTypes(body.toString('utf8')) } catch (e) { return send(res, 500, `${rel}: ${e.message}`) }
  }
  send(res, 200, body, TYPES[extname(rel)])
}

/** Keeps one report. The page sends JSON; the line kept adds when it came. */
async function report(req, res) {
  const parts = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_MOST) return send(res, 413, 'too much')
    parts.push(chunk)
  }
  let body
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return send(res, 400, 'not JSON') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, 'a report is an object')
  await mkdir(dirname(reports), { recursive: true })
  await appendFile(reports, JSON.stringify({ at: new Date().toISOString(), ...body }) + '\n')
  console.log(`report ${body.run ?? '?'} ${body.stage ?? ''} ${String(body.env?.ua ?? '').slice(0, 80)}`)
  send(res, 200, '{"kept":true}', TYPES['.json'])
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const done = (p) => p.catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, 'failed') })
  if (req.method === 'POST' && url.pathname === '/report') return done(report(req, res))
  if (req.method !== 'GET') return send(res, 405, 'GET or POST /report')
  // The address a phone is sent is the city, which measures itself; the probe keeps its own.
  const path = url.pathname === '/' || url.pathname === '/city' ? 'page/index.html' : url.pathname === '/probe' ? 'probe/index.html' : url.pathname
  done(file(res, path))
})
server.listen(port, '127.0.0.1', () => console.log(`engine page on http://127.0.0.1:${port}/ (reports kept in ${reports})`))
