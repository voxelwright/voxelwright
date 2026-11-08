import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { build, defineConfig, type Connect, type Plugin } from 'vite'
import { BOX_PATH, boxDocument, boxPolicy } from './src/props/relay.ts'

// The villager host (host/src/villager.ts) listens on 127.0.0.1. The dev server
// forwards /villager/api/* to it, so the page and the API share an origin. The
// page gets its person's token from the link the host prints, never from here.
const port = Number(process.env.VILLAGER_PORT ?? 5190)

// Page scripts, promoted plugins included, may fetch and open sockets only to this
// origin: the API and Vite's HMR websocket ('self' covers ws: on the same host and
// port). The policy does not stop a script navigating the page to another origin.
// Styles stay inline-capable because Vite injects CSS as <style> tags in dev.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
]

// #74 physics: the solver is WebAssembly (Jolt), and compiling wasm needs 'wasm-unsafe-eval'
// in script-src. It allows WebAssembly.compile/instantiate only, not eval() or new Function().
// Physics is on by default (src/features.ts), so every page gets it except one opened with
// ?physics=0, which keeps the policy above. This
// middleware is the one place either server (dev and preview) sets the policy (server.headers
// would be applied after it, at send time, and overwrite the choice).
const physicsCsp = csp.map((d) => (d === "script-src 'self'" ? "script-src 'self' 'wasm-unsafe-eval'" : d)).join('; ')
const homeCsp = csp.join('; ')
const policy: Connect.NextHandleFunction = (req, res, next) => {
  const url = new URL(req.url ?? '/', 'http://home')
  res.setHeader('content-security-policy', url.searchParams.get('physics') === '0' ? homeCsp : physicsCsp)
  next()
}
const physicsPolicy: Plugin = {
  name: 'physics-policy',
  configureServer: (server) => void server.middlewares.use(policy),
  configurePreviewServer: (server) => void server.middlewares.use(policy),
}

// #42 prop sandbox, dev only: `virtual:prop-box` is the sandbox worker bundled into one
// self-contained script (three core, the painters, the serializer) and exported as a
// string. The sealed iframe has no network, so the page hands it this text to start
// its worker from a blob. Only src/props/load.ts imports it, behind the ?props= flag.
// BOX_PATH is the iframe's relay document, served with its own policy in place of the
// home's (src/props/relay.ts), so the home's CSP keeps no inline script or blob worker.
const propBox: Plugin = {
  name: 'prop-box',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(BOX_PATH, (_req, res) => {
      const nonce = randomBytes(16).toString('hex')
      res.setHeader('content-security-policy', boxPolicy(nonce))
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(boxDocument(nonce))
    })
  },
  resolveId: (id) => (id === 'virtual:prop-box' ? '\0virtual:prop-box' : undefined),
  async load(id) {
    if (id !== '\0virtual:prop-box') return
    const entry = join(import.meta.dirname, 'src/props/box/worker.ts')
    const out = await build({
      configFile: false,
      logLevel: 'warn',
      resolve: { alias: [{ find: /^three\/webgpu$/, replacement: 'three' }] },
      build: { write: false, minify: true, lib: { entry, formats: ['iife'], name: 'propBox' } },
    })
    const chunk = (Array.isArray(out) ? out[0] : out as { output: { type: string; code?: string; moduleIds?: string[] }[] }).output[0]
    for (const file of chunk.moduleIds ?? []) if (!file.startsWith('\0') && !file.includes('node_modules')) this.addWatchFile(file)
    return `export default ${JSON.stringify(chunk.code)}`
  },
}

// #52 listening room, dev only: /sound-lab.html saves the owner's picks here. POST takes
// { picks: { cue: variant | 'none' | 'keep' | 'change' }, notes: { cue: text } }, checked
// against the live palette, and writes .sound-lab/picks.json (the current round) and a
// line in .sound-lab/history.jsonl (every round). GET returns the current picks.
const LAB = join(import.meta.dirname, '.sound-lab')
const NOTE_MAX = 2000
const BODY_MAX = 64 * 1024

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > BODY_MAX) reject(new Error('too large'))
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

/** The picks as sent, or the reason they are not acceptable. */
function checkPicks(body: unknown, palette: Record<string, Record<string, unknown>>): { picks: Record<string, string>; notes: Record<string, string> } | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'not an object'
  const { picks = {}, notes = {} } = body as Record<string, unknown>
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) return 'picks must be an object'
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return 'notes must be an object'
  // An empty round would overwrite the saved picks with nothing.
  if (!Object.keys(picks).length && !Object.keys(notes).length) return 'no picks or notes'
  for (const [cue, value] of Object.entries(picks)) {
    // Own keys only: "__proto__" or "constructor" are not cues.
    const variants = Object.hasOwn(palette, cue) ? palette[cue] : undefined
    if (!variants) return `unknown cue ${cue}`
    const allowed = Object.keys(variants).length > 1 ? [...Object.keys(variants), 'none'] : ['keep', 'change']
    if (typeof value !== 'string' || !allowed.includes(value)) return `${cue}: ${String(value)} is not one of ${allowed.join(', ')}`
  }
  for (const [cue, text] of Object.entries(notes)) {
    if (!Object.hasOwn(palette, cue)) return `unknown cue ${cue}`
    if (typeof text !== 'string' || text.length >= NOTE_MAX) return `${cue}: a note must be text under ${NOTE_MAX} characters`
  }
  return { picks: picks as Record<string, string>, notes: notes as Record<string, string> }
}

const soundLab: Plugin = {
  name: 'sound-lab',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/sound-lab/picks', async (req, res) => {
      res.setHeader('cache-control', 'no-store')
      res.setHeader('content-type', 'application/json')
      const site = req.headers['sec-fetch-site']
      if (site && site !== 'same-origin') {
        res.statusCode = 403
        return res.end()
      }
      const file = join(LAB, 'picks.json')
      if (req.method === 'GET') {
        try {
          return res.end(await readFile(file, 'utf8'))
        } catch {
          return res.end(JSON.stringify({ picks: {}, notes: {} }))
        }
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        return res.end()
      }
      // JSON only: a cross-site page cannot send application/json without a CORS preflight,
      // which this server never answers, so a browser without Sec-Fetch-Site is covered too.
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        res.statusCode = 415
        return res.end(JSON.stringify({ error: 'send application/json' }))
      }
      try {
        await savePicks(req, res)
      } catch (error) {
        // Connect ignores a rejected promise: answer here, or the request hangs and Node may exit.
        console.warn('sound-lab: could not save picks', error)
        if (!res.headersSent) res.statusCode = 500
        res.end(JSON.stringify({ error: 'could not save picks' }))
      }
    })
    async function savePicks(req: IncomingMessage, res: ServerResponse) {
      const file = join(LAB, 'picks.json')
      let body: unknown
      try {
        body = JSON.parse(await readBody(req))
      } catch (error) {
        res.statusCode = (error as Error).message === 'too large' ? 413 : 400
        return res.end(JSON.stringify({ error: (error as Error).message }))
      }
      const { PALETTE } = (await server.ssrLoadModule('/src/sound/palette/index.ts')) as { PALETTE: Record<string, Record<string, unknown>> }
      const checked = checkPicks(body, PALETTE)
      if (typeof checked === 'string') {
        res.statusCode = 422
        return res.end(JSON.stringify({ error: checked }))
      }
      const round = { savedAt: new Date().toISOString(), ...checked }
      await mkdir(LAB, { recursive: true })
      await writeFile(file, `${JSON.stringify(round, null, 2)}\n`)
      await appendFile(join(LAB, 'history.jsonl'), `${JSON.stringify(round)}\n`)
      res.end(JSON.stringify(round))
    }
  },
}

export default defineConfig({
  plugins: [physicsPolicy, propBox, soundLab],
  // No SPA fallback: an unknown path is a 404, not the page.
  appType: 'mpa',
  server: {
    proxy: {
      '/villager/api': {
        target: `http://127.0.0.1:${port}`,
        rewrite: (path) => path.replace(/^\/villager\/api/, ''),
      },
    },
  },
})
