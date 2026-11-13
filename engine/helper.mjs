// The helper (#243, #244): what the page talks to, on the asker's own machine, to have a thing made. A browser
// cannot run a model; this can. It takes one ask from the page, runs the asker's own Claude Code once for it
// (make.mjs), and sends what came of it to the world as any client would. The world's server never runs a model.
//
//   node helper.mjs --world http://127.0.0.1:5761            then open the address it prints
//
//   --port 5762        where it listens, on this machine only
//   --model opus       which of your models makes things
//   --journal file     where what was made is written down (default ~/.village/engine/made.jsonl)
//   --reply file       a reply kept in a file stands in for the model (no model is run)
//
// Who may ask. It starts a model on your subscription, so it answers only: a request to this machine's own name
// (the Host it was asked by: a page elsewhere that points a name of its own at 127.0.0.1 is refused), from the
// world's own page (the Origin a browser gives), that knows the secret printed in this terminal. The page is
// given the secret in the part of the address after #, which a browser never sends to a server, and keeps it.
//
// One ask (the shape every lane uses; page/ask.ts):
//   POST /ask   X-Village-Secret: ...
//   { "wish": "a market stall",                       what is wanted, up to 400 characters; and, or instead:
//     "picture": { "type": "image/png", "data": "<base64>" },
//     "link": "https://...",
//     "target": { "point": [x, y, z] } | { "box": [x0, y0, z0, x1, y1, z1] } | { "thing": id, "part": name },
//     "from": { "eye": [x, y, z], "toward": [dx, dy, dz] },      where the asker's eye is and looks, in cells
//     "by": "Ada" }
// All of it is data for the model, never instruction to this program or to it. The answer is lines of JSON as it
// goes: {stage: "place", at, facing}, {stage: "asking", try}, {stage: "refused", why} (it is asked again),
// {stage: "sending", name, at, size}, and last {stage: "done", state, why, id, name, at, size, ms, tries}:
// state "there" if it stands in the world, else why not. One ask at a time.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { JOURNAL, make } from './make.mjs'
import { reply } from './make/model.mjs'

const WISH_MOST = 400, LINK_MOST = 2000, BODY_MOST = 1 << 20
const PICTURES = ['image/png', 'image/jpeg', 'image/webp']
const three = (a, most = 2 ** 30) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(v) && Math.abs(v) <= most)
const cells = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => Number.isInteger(v) && Math.abs(v) <= 2 ** 30)
const text = (v, most) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, most) : '')

/** An ask with nothing in it but what one may hold, or (a string) why it is not one. */
export function shaped(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'an ask is an object'
  for (const key of Object.keys(body)) if (!['wish', 'picture', 'link', 'target', 'from', 'by'].includes(key)) return `"${key.slice(0, 20)}" is not part of an ask`
  const ask = { wish: text(body.wish, WISH_MOST), by: text(body.by, 24) || 'someone' }
  if (body.wish !== undefined && typeof body.wish !== 'string') return 'a wish is words'
  if (body.picture !== undefined) {
    const p = body.picture
    if (!p || !PICTURES.includes(p.type) || typeof p.data !== 'string' || !p.data || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) return `a picture is {type: ${PICTURES.join(' | ')}, data: base64}`
    ask.picture = { type: p.type, data: p.data }
  }
  if (body.link !== undefined) {
    const url = typeof body.link === 'string' && body.link.length <= LINK_MOST ? URL.parse(body.link) : null
    if (!url || !['http:', 'https:'].includes(url.protocol)) return 'a link is an http or https address'
    ask.link = url.href
  }
  if (!ask.wish && !ask.picture && !ask.link) return 'say what to make: a wish, a picture or a link'
  if (body.target !== undefined) {
    const t = body.target
    if (t && cells(t.point, 3)) ask.target = { point: t.point }
    else if (t && cells(t.box, 6) && [0, 1, 2].every((a) => t.box[a] < t.box[a + 3])) ask.target = { box: t.box }
    else if (t && typeof t.thing === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(t.thing) && (t.part === undefined || (typeof t.part === 'string' && t.part.length <= 40))) ask.target = { thing: t.thing, ...(t.part === undefined ? {} : { part: t.part }) }
    else return 'a target is {point: [x, y, z]}, {box: [x0, y0, z0, x1, y1, z1]} or {thing: id, part}'
  }
  const f = body.from
  if (!f || !three(f.eye) || !three(f.toward, 1e6) || !(Math.hypot(...f.toward) > 0)) return 'from is {eye: [x, y, z], toward: [dx, dy, dz]}: where the asker is and looks'
  ask.from = { eye: f.eye.map(Math.round), toward: f.toward }
  return ask
}

/** Whether two secrets are the same, in a time that does not say how much of one was right. */
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest())

/**
 * Starts the helper. `world` is the one world it makes things in, fixed here: no request can name another.
 * `origins` are further pages that may ask (the world's own always may). Resolves to { url, secret, link, close }.
 */
export async function helper({ world, port = 5762, origins = [], hosts = [], secret = randomBytes(24).toString('base64url'), model = (q) => reply(q), journal = JOURNAL, say = () => {} }) {
  world = world.replace(/\/$/, '')
  const at = new URL(world), loopback = ['127.0.0.1', 'localhost'].includes(at.hostname)
  // The world's page may be open under either name of this machine.
  const allowed = new Set([at.origin, ...(loopback ? [`${at.protocol}//127.0.0.1:${at.port}`, `${at.protocol}//localhost:${at.port}`] : []), ...origins])
  let busy = false
  const server = createServer((req, res) => {
    const origin = req.headers.origin, cors = origin && allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cross-Origin-Resource-Policy': 'cross-origin' } : {}
    const end = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }); res.end(JSON.stringify(body)) }
    // Asked by this machine's own name, or not at all: a name someone else points here is not it.
    const names = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`, ...hosts]
    if (!names.includes(req.headers.host)) return end(403, { why: 'not by that name' })
    // A browser says which page asks. Only the world's own page may; what is not a browser says nothing and needs the secret all the same.
    if (origin !== undefined && !allowed.has(origin)) return end(403, { why: 'not from that page' })
    if (req.method === 'OPTIONS') {
      if (origin === undefined) return end(403, { why: 'not from that page' })
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type, x-village-secret', 'Access-Control-Max-Age': '600' })
      return res.end()
    }
    if (!same(req.headers['x-village-secret'] ?? '', secret)) return end(401, { why: 'the secret is not right: open the address the helper printed' })
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET' && url.pathname === '/hello') return end(200, { helper: 1, world, busy })
    if (req.method !== 'POST' || url.pathname !== '/ask') return end(404, { why: 'not here' })
    void (async () => {
      const parts = []
      let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > BODY_MOST) return end(413, { why: 'too much' }); parts.push(chunk) }
      let body
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return end(400, { why: 'not JSON' }) }
      const ask = shaped(body)
      if (typeof ask === 'string') return end(400, { why: ask })
      // Said before anything is started, and never half done: what is not built yet is refused whole.
      if (ask.picture || ask.link) return end(501, { why: 'pictures and links are not made from yet' })
      if (ask.target && !ask.target.point) return end(501, { why: 'only a point can be aimed at yet' })
      if (busy) return end(429, { why: 'one thing at a time: something is being made' })
      busy = true
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...cors })
      const line = (o) => res.write(JSON.stringify(o) + '\n')
      try {
        // A point aimed at is looked at from the asker's eye, so the thing faces them and stands as a looked-at place does.
        const toward = ask.target ? ask.target.point.map((v, a) => v - ask.from.eye[a]) : ask.from.toward
        const where = { from: ask.from.eye, toward: Math.hypot(...toward) > 0 ? toward : ask.from.toward }
        say(`asked by ${ask.by}: ${ask.wish}`)
        const r = await make({ wish: ask.wish, world, where, by: ask.by, journal, model, say: (words, stage) => { say(`  ${words}`); if (stage) line(stage) } })
        say(`  ${r.state}${r.why ? `: ${r.why}` : ''}`)
        // What the model said is not passed on: the page gets what was made of it, and the world its cells.
        line({ stage: 'done', state: r.state, why: r.why, id: r.id, name: r.name, at: r.origin, size: r.size, ms: r.ms, tries: r.tries })
      } catch (e) {
        say(`  failed: ${e.message}`)
        line({ stage: 'done', state: 'refused', why: 'the helper could not make it' })
      } finally {
        busy = false
        res.end()
      }
    })()
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, secret, link: `${world}/city?shared=1#helper=${encodeURIComponent(url)}&secret=${secret}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }
  const world = flag('world')
  if (!world) { console.error('say which world: node helper.mjs --world http://127.0.0.1:port (a server started with --world file)'); process.exit(2) }
  const canned = flag('reply')
  const model = canned ? async () => ({ text: await readFile(canned, 'utf8'), model: `a reply kept in ${canned} (no model was run)`, ms: 0, cost: 0 }) : (q) => reply({ ...q, model: flag('model') ?? 'opus', binary: flag('claude') ?? 'claude' })
  const h = await helper({ world, port: Number(flag('port') ?? 5762), journal: flag('journal') ?? JOURNAL, model, say: (s) => console.log(s) })
  console.log(`the helper listens on ${h.url}, on this machine only, and makes things in ${world}${canned ? ' from a kept reply (no model is run)' : ' with your own Claude Code'}`)
  console.log(`open this once, in the browser you play in. It carries the secret, which is kept by that page from then on:\n\n  ${h.link}\n`)
}
