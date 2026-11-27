// A host for the launch measurements (#83): a built realm's data (a `dist-sf` somebody already built, never written
// to) with this checkout's code laid over it, so a prototype is measured without a second 6.6 GB build.
//
// A `.js` address whose source is in this checkout (`.ts`, `.mjs`, or the kit's own `.js`) is answered from that
// source, stripped and renamed as sf/build.mjs does. Everything else (the page, the release, the core) is the base
// folder's own file, sent as player/serve.mjs sends it. Worker modules get one import put first (`probe`), which is
// how the measurements reach a worker: a page's init script does not.
import { stripTypeScriptTypes } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
import { plain } from '../../player/serve.mjs'

const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.(ts|mjs)\b/g
const js = (text) => text.replace(NAMED, '$1$2$3.js')
const WORKERS = new Set(['page/worker.js', 'page/mover.js', 'page/streetfaces.js'])

/** This checkout's source for a served `.js` address, as the build would write it; null where it has none. */
export function built(root, rel) {
  if (!rel.endsWith('.js')) return null
  const stem = join(root, rel.slice(0, -3))
  for (const ext of ['.ts', '.mjs', '.js']) {
    if (!existsSync(stem + ext)) continue
    const source = readFileSync(stem + ext, 'utf8')
    return js(ext === '.ts' ? stripTypeScriptTypes(source) : source)
  }
  return null
}

/** Which of the base folder's modules this checkout would write differently (a base built from another commit). */
export function differs(root, base, rels) {
  return rels.filter((rel) => { const mine = built(root, rel); return mine !== null && existsSync(join(base, rel)) && mine !== readFileSync(join(base, rel), 'utf8') })
}

/** What says the base folder is still the one a run began with: its page's script and its release pointer. */
export const fingerprint = (base) => ['page/main.js', 'sf/current.json'].map((f) => { try { const s = statSync(join(base, f)); return `${s.size}:${s.mtimeMs}` } catch { return 'gone' } }).join('|')

/**
 * `base`: a built realm. `root`: the engine folder whose code is served over it. `probe`: text of a module every
 * worker imports first (or null). `asked` lists every answer, overlaid or not.
 */
export async function host({ base, root, probe = null }) {
  const kept = new Map()
  const overlay = (req, res) => {
    const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '')
    let text = rel === '__launch/worker-probe.js' ? probe : built(root, rel)
    if (text === null) return false
    if (probe && WORKERS.has(rel)) text = `import '/__launch/worker-probe.js';\n${text}`
    let entry = kept.get(rel)
    if (!entry || entry.text !== text) {
      const body = Buffer.from(text)
      entry = { text, body, br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"` }
      kept.set(rel, entry)
    }
    const br = /\bbr\b/.test(String(req.headers['accept-encoding'] ?? ''))
    const headers = { 'Content-Type': 'text/javascript; charset=utf-8', ETag: entry.etag, 'Cache-Control': 'max-age=600', Vary: 'Accept-Encoding' }
    site.asked.push({ path: `/${rel}`, status: 200, at: Date.now(), bytes: entry.body.length, wire: br ? entry.br.length : entry.body.length, encoding: br ? 'br' : 'identity', overlaid: true })
    if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return true }
    const out = br ? entry.br : entry.body
    res.writeHead(200, { ...headers, 'Content-Length': out.length, ...(br ? { 'Content-Encoding': 'br' } : {}) })
    res.end(out)
    return true
  }
  const site = await plain(base, '127.0.0.1', 0, { extra: overlay })
  return site
}
