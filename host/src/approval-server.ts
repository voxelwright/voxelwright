// The approval page's own server (#87): Keep, Undo and Not this happen here only (approval.ts says why).
//
//   GET  /                                   the approval page (approval/index.html), for #run=<id>
//   GET  /approval.js, /approval.css          its script and style, from this repo
//   GET  /villager/api/session                who this device is paired as
//   GET  /villager/api/people/<id>/elder…                    the Elder's reads (elder-home handle)
//   POST /villager/api/people/<id>/elder/runs/<run>/keep|undo|decline   (elder-home decide; approval.ts has the rule)
//
// The page is plain static HTML and script written in this repo: no plugin code,
// no third-party code, a strict Content Security Policy, and no framing. The API
// paths sit under /villager/api because that is the session cookie's path: the
// cookie is host-only and ignores ports, so the device's pairing on the home
// (localhost, or the tailnet name) is sent here too, and nowhere else is needed.
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { ElderHome } from './elder-home.ts'

const PAGE_DIR = join(import.meta.dirname, '..', 'approval')

/** Every response from this server: nothing may frame it, embed its files or keep a handle on its window. */
export const APPROVAL_HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cache-control': 'no-store',
} as const

const FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/approval.js': { file: 'approval.js', type: 'text/javascript; charset=utf-8' },
  '/approval.css': { file: 'approval.css', type: 'text/css; charset=utf-8' },
}

export interface ApprovalServerConfig {
  port: number
  elder: ElderHome
  /** The paired session for a request's cookie, for a listed person. */
  holder: (req: IncomingMessage) => Promise<{ person: string; tag: string } | undefined>
  people: Record<string, string>
}

export async function startApprovalServer(config: ApprovalServerConfig) {
  // Read once at start: the page cannot change while the host runs, and no request names a file.
  const files = Object.fromEntries(Object.entries(FILES).map(([path, f]) => [path, { body: readFileSync(join(PAGE_DIR, f.file)), type: f.type }]))
  const send = (res: ServerResponse, status: number, value: unknown) => {
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(value))
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Set once, before anything answers: the page, the API and the Elder's pictures all carry them.
    for (const [name, value] of Object.entries(APPROVAL_HEADERS)) res.setHeader(name, value)
    const url = new URL(req.url ?? '/', 'http://x')
    const page = files[url.pathname]
    if (page) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' })
      res.writeHead(200, { 'content-type': page.type })
      return res.end(req.method === 'HEAD' ? undefined : page.body)
    }
    if (!url.pathname.startsWith('/villager/api/')) return send(res, 404, { error: 'not found' })
    // Only this page reads the API: a browser request from anywhere else is refused before the session is looked at.
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin') return send(res, 403, { refused: 'not-approval-origin', message: "That didn't come from the approval page." })
    const path = url.pathname.slice('/villager/api'.length)
    const session = await config.holder(req)
    if (!session) return send(res, 401, { error: 'this device is not paired' })
    if (path === '/session') return send(res, 200, { person: session.person, name: config.people[session.person] })
    // A session opens its own person's paths only, as on the home's API.
    if (/^\/people\/([^/]+)\//.exec(path)?.[1] !== session.person) return send(res, 404, { error: 'not found' })
    // Reads are the Elder's (the run, its pictures); a POST here is only ever Keep, Undo or Not this (elder-home decide).
    const answered = req.method === 'GET' ? await config.elder.handle(path, req, res, session.person, send) : await config.elder.decide(path, req, res, session.person, send)
    if (!answered) send(res, 404, { error: 'not found' })
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'internal error' }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, '127.0.0.1', resolve)
  })
  return {
    port: (server.address() as AddressInfo).port,
    close() {
      server.close()
      server.closeAllConnections()
    },
  }
}
