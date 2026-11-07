import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { build, defineConfig, type Plugin } from 'vite'

// The villager host (host/src/villager.ts) writes its port and per-launch token
// to <VILLAGE_ROOT>/villager/launch.json. The dev server hands the token to
// same-origin pages at /villager/launch and forwards /villager/api/* to the host,
// so the page and the API share an origin.
const root = process.env.VILLAGE_ROOT ?? join(homedir(), '.village')
const port = Number(process.env.VILLAGER_PORT ?? 5190)

const villagerLaunch: Plugin = {
  name: 'villager-launch',
  configureServer(server) {
    server.middlewares.use('/villager/launch', async (req, res) => {
      res.setHeader('cache-control', 'no-store')
      const site = req.headers['sec-fetch-site']
      if (site && site !== 'same-origin') {
        res.statusCode = 403
        return res.end()
      }
      try {
        const { token } = JSON.parse(await readFile(join(root, 'villager', 'launch.json'), 'utf8'))
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ token }))
      } catch {
        res.statusCode = 503
        res.end()
      }
    })
  },
}

// #42 prop sandbox, dev only: `virtual:prop-box` is the sandbox worker bundled into one
// self-contained script (three core, the painters, the serializer) and exported as a
// string. The sealed iframe has no network, so the page hands it this text to start
// its worker from a blob. Only src/props/load.ts imports it, behind the ?props= flag.
const propBox: Plugin = {
  name: 'prop-box',
  apply: 'serve',
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
  if (!body || typeof body !== 'object') return 'not an object'
  const { picks = {}, notes = {} } = body as Record<string, unknown>
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) return 'picks must be an object'
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return 'notes must be an object'
  for (const [cue, value] of Object.entries(picks)) {
    const variants = palette[cue]
    if (!variants) return `unknown cue ${cue}`
    const allowed = Object.keys(variants).length > 1 ? [...Object.keys(variants), 'none'] : ['keep', 'change']
    if (typeof value !== 'string' || !allowed.includes(value)) return `${cue}: ${String(value)} is not one of ${allowed.join(', ')}`
  }
  for (const [cue, text] of Object.entries(notes)) {
    if (!palette[cue]) return `unknown cue ${cue}`
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
    })
  },
}

export default defineConfig({
  plugins: [villagerLaunch, propBox, soundLab],
  server: {
    proxy: {
      '/villager/api': {
        target: `http://127.0.0.1:${port}`,
        rewrite: (path) => path.replace(/^\/villager\/api/, ''),
      },
    },
  },
})
