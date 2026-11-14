// The helper (#243, #244): what the page talks to, on the asker's own machine, to have a thing made. A browser
// cannot run a model; this can. It takes one ask from the page, runs the asker's own Claude Code once for it
// (make.mjs), and sends what came of it to the world as any client would. The world's server never runs a model.
//
//   node helper.mjs --world http://127.0.0.1:5761            then open the address it prints
//
//   --port 5762        where it listens, on this machine only
//   --model opus       which of your models makes things and writes rules; --quick sonnet which fleshes an idea out (a short reply, wanted soon)
//   --journal file     where what was made is written down (default ~/.village/engine/made.jsonl)
//   --page URL --reach URL --only login [--reach-port 5763]    for a phone on the tailnet: see "From a phone" in engine/README.md
//   --library dir      where what was made is kept, to be made again at once (default ~/.village/engine/library)
//   --voice sonnet     which of your models answers for the people of the world when a rule asks one to think (#264, mind/voice.mjs);
//                      --no-voice and nobody is voiced from this machine (nor with --reply: no model is run then); --voice-most 40 is the most answers a minute;
//                      --voice-warm 2 is how many of its processes wait started, so that an answer does not wait for one to start
//   --workshop-project dir --t3 file    the workshop (workshop/route.mjs): which T3 Code project a development session is started in, and T3 Code's command
//   --workshop-provider id --workshop-model slug    which model a development session runs on (needed when the project in T3 Code has no default)
//   --workshop-checkout dir    the checkout the game's server runs from: when a session's pull request is merged its plugins are brought to main there (as node plug.mjs --at does)
//   --reply file       a reply kept in a file stands in for the model (no model is run); --wait 20 makes it take that many seconds
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
//     "by": "Ada",
//     "fresh": true }                                  make it anew even if one like it was made before
// All of it is data for the model, never instruction to this program or to it. The answer is lines of JSON as it
// goes: {stage: "reading"} (a link is being fetched), {stage: "place", at, facing}, {stage: "asking", try}, {stage: "shaped", name, size, facing} (a reply could be read),
// {stage: "refused", why} (it is asked again),
// {stage: "sending", id, name, at, size, facing}, and last {stage: "done", state, why, id, name, at, size, ms, tries}:
// state "there" if it stands in the world. State "held": it is made and no place near would take it; `held` is a
// token for POST /put {held, from, clear, by, target}, which stands it where the asker now looks, or (clear) at that very
// place with what is there emptied first. A thing is held for fifteen minutes. One ask at a time.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { JOURNAL, make, put } from './make.mjs'
import { fieldKeys } from './make/form.mjs'
import { LIBRARY, library } from './make/library.mjs'
import { fetched, notFetched } from './make/link.mjs'
import { reply } from './make/model.mjs'
import { ID as DIRECTOR, direct } from './make/director.mjs'
import { imagine, realm as makeRealm } from './make/realm.mjs'
import { write as writeRule } from './make/rules.mjs'
import { workshop } from './workshop/route.mjs'
import { towards } from './make/place.mjs'
import { voices as voicing } from './mind/voice.mjs'

/** A picture is at most this much base64: the page makes it small first (page/picture.ts). */
const WISH_MOST = 400, LINK_MOST = 2000, PICTURE_MOST = 4 << 20, BODY_MOST = PICTURE_MOST + (1 << 16)
const PICTURES = ['image/png', 'image/jpeg', 'image/webp']
/** A realm's id, as the world's server gives them. */
const REALM = /^[a-z0-9][a-z0-9-]{0,39}$/
const three = (a, most = 2 ** 30) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(v) && Math.abs(v) <= most)
const cells = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => Number.isInteger(v) && Math.abs(v) <= 2 ** 30)
const text = (v, most) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, most) : '')

/** An ask with nothing in it but what one may hold, or (a string) why it is not one. */
export function shaped(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'an ask is an object'
  for (const key of Object.keys(body)) if (!['wish', 'picture', 'link', 'target', 'from', 'by', 'fresh', 'realm'].includes(key)) return `"${key.slice(0, 20)}" is not part of an ask`
  const ask = { wish: text(body.wish, WISH_MOST), by: text(body.by, 24) || 'someone', fresh: body.fresh === true }
  if (body.realm !== undefined) { if (typeof body.realm !== 'string' || !REALM.test(body.realm)) return 'a realm is named by its id'; ask.realm = body.realm }
  if (body.wish !== undefined && typeof body.wish !== 'string') return 'a wish is words'
  if (body.picture !== undefined) {
    const p = body.picture
    if (!p || !PICTURES.includes(p.type) || typeof p.data !== 'string' || !p.data || p.data.length > PICTURE_MOST || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) return `a picture is {type: ${PICTURES.join(' | ')}, data: base64}`
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

/**
 * Where an ask goes, and how big it is to be. A point aimed at is looked at from the asker's eye, so the thing faces
 * them and stands as a looked-at place does. A box is filled: the thing is as big as it, in its middle, its front
 * to the asker. No target: what is ahead of the eye.
 */
function aimed(target, from) {
  if (target?.box) {
    const b = target.box, facing = towards([(b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2], from.eye), across = facing === 'east' || facing === 'west'
    return { where: { box: b, from: from.eye }, facing, fill: [across ? b[5] - b[2] : b[3] - b[0], b[4] - b[1], across ? b[3] - b[0] : b[5] - b[2]] }
  }
  const toward = target?.point ? target.point.map((v, a) => v - from.eye[a]) : from.toward
  return { where: { from: from.eye, toward: Math.hypot(...toward) > 0 ? toward : from.toward } }
}

/** Whether two secrets are the same, in a time that does not say how much of one was right. */
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest())

/**
 * Starts the helper. `world` is the one world it makes things in, fixed here: no request can name another.
 * `origins` are further pages that may ask (the world's own always may). Resolves to { url, secret, link, close }.
 */
export async function helper({ world, port = 5762, origins = [], hosts = [], page, reach, reachPort = 0, only, secret = randomBytes(24).toString('base64url'), model = (q) => reply(q), journal = JOURNAL, say = () => {}, resolve, grow = 'cap', kept = LIBRARY, quick = model, cannot, voice = null , shop: shopWith = {} }) {
  /** What was made before, kept on this machine: a wish made before is made again with no model. `kept: null` keeps none. */
  const shelf = kept ? library(kept) : null
  world = world.replace(/\/$/, '')
  const at = new URL(world), loopback = ['127.0.0.1', 'localhost'].includes(at.hostname)
  // The world's page may be open under either name of this machine.
  const allowed = new Set([at.origin, ...(loopback ? [`${at.protocol}//127.0.0.1:${at.port}`, `${at.protocol}//localhost:${at.port}`] : []), ...origins, ...(page ? [new URL(page).origin] : [])])
  // From another device (a phone on the tailnet): `page` is where the world's page is opened from there, `reach` the
  // address the helper is reached by there. Both are this machine's own name on the tailnet, served by `tailscale
  // serve` (tailnet only), which says who on the tailnet asks (Tailscale-User-Login). What comes that way comes in
  // by a door of its own (`reachPort`, a second listener on this machine that `tailscale serve` is pointed at), and
  // everything through that door must be from the one person named (`only`), beside the secret. Which door a
  // request came by is not something the request can say for itself, as its Host is.
  if (reach && !only) throw new Error('to be reached from the tailnet the helper must be told whose it is: --only <your tailnet login>')
  const far = reach ? new URL(reach).host : null
  // Two lanes (#264): a thing takes seconds and may be for someone's hand in the middle of a game; a rule, a realm or a
  // director takes minutes in the writing. Each lane does one at a time, and neither waits on the other (seen November
  // 14: a pistol reached the hand after 95 s, 80 of them behind a rule being changed). `busy` is the things' lane.
  let busy = false, writing = false
  /** The workshop's door (workshop/route.mjs): reads the same list of what could not be done that the rules' maker writes. */
  const shop = workshop({
    journal: cannot, world, say,
    // A rule that ran into something the engine lacked, asked for again in the same words once the plugin is in
    // (the owner said yes to that when sending the gap): by this helper's own model, in its turn, put again under its id.
    again: async ({ wish, realm, change, where, by }) => {
      const at = realm && realm !== 'home' ? `${world}/realm/${realm}` : world
      if (!(await fetch(`${at}/world/rules?id=${encodeURIComponent(change)}`)).ok) return { state: 'refused', why: 'that rule is no longer there' }
      for (let waited = 0; writing && waited < 150; waited++) await new Promise((r) => setTimeout(r, 2000))
      if (writing) return { state: 'refused', why: 'the helper was busy writing something' }
      writing = true
      try { return await writeRule({ wish, world: at, where, change, by, model, cannot, say: (words) => say(`  ${words}`) }) } finally { writing = false }
    },
    ...shopWith,
  })
  /** Things made that no place would take, kept a while for the asker to say where: by a token only this helper and that page know. */
  const holds = new Map()
  /** Says how an ask ended. What the model said is not passed on: the page gets what was made of it, and the world its cells. */
  const ended = (r, line) => {
    say(`  ${r.state}${r.why ? `: ${r.why}` : ''}`)
    let held
    if (r.state === 'held') {
      held = randomBytes(9).toString('base64url')
      holds.set(held, { hold: r.hold, since: Date.now() })
      for (const [token, h] of holds) if (Date.now() - h.since > 15 * 60_000 || holds.size > 8) { holds.delete(token); if (holds.size <= 8) break }
    }
    line({ stage: 'done', state: r.state, why: r.why, id: r.id, name: r.name, at: r.origin, size: r.size, ms: r.ms, tries: r.tries, moved: r.moved, left: r.left, held })
  }
  const answer = (door) => (req, res) => {
    const server = door === 'far' ? farServer : nearServer
    const origin = req.headers.origin, cors = origin && allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cross-Origin-Resource-Policy': 'cross-origin' } : {}
    const end = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }); res.end(JSON.stringify(body)) }
    // Asked by this machine's own name, or not at all: a name someone else points here is not it.
    // Asked by this machine's own name, or not at all: a name someone else points here is not it. By the tailnet's
    // door the name is the tailnet one, and the tailnet's word for who asks must be the one person this is for.
    const names = door === 'far' ? [far] : [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`, ...hosts]
    if (!names.includes(req.headers.host)) return end(403, { why: 'not by that name' })
    if (door === 'far' && req.headers['tailscale-user-login'] !== only) return end(403, { why: 'not from that person on the tailnet' })
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
    // The workshop (#264, workshop/route.mjs): what the engine could not do, sent to a development session. This machine's own door only.
    if (url.pathname.startsWith('/workshop/')) return void shop(door, req, url, end).catch((e) => { say(`  the workshop failed: ${e.message}`); if (!res.headersSent) end(500, { why: 'the workshop failed' }) })
    if (req.method !== 'POST' || !['/ask', '/put', '/rule', '/imagine', '/realm'].includes(url.pathname)) return end(404, { why: 'not here' })
    void (async () => {
      const parts = []
      let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > BODY_MOST) return end(413, { why: 'too much' }); parts.push(chunk) }
      let body
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return end(400, { why: 'not JSON' }) }
      // Which of the server's worlds this is for: home, or the realm the asking page is in. Never another server.
      if (body?.realm !== undefined && (typeof body.realm !== 'string' || !REALM.test(body.realm))) return end(400, { why: 'a realm is named by its id' })
      const server = world, here = url.pathname !== '/realm' && typeof body?.realm === 'string' ? `${world}/realm/${body.realm}` : world
      const stream = async (work) => {
        if (writing) return end(429, { why: 'one at a time: something is being written' })
        writing = true
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...cors })
        const line = (o) => res.write(JSON.stringify(o) + '\n')
        try { await work(line, (words, stage) => { say(`  ${words}`); if (stage) line(stage) }) } catch (e) { say(`  failed: ${e.message}`); line({ stage: 'done', state: 'refused', why: 'the helper could not do it' }) } finally { writing = false; res.end() }
      }
      const place = (f) => (f && three(f.eye) && three(f.toward, 1e6) ? { at: [Math.round(f.eye[0]), Math.round(f.eye[1]) - 16, Math.round(f.eye[2])], facing: Math.abs(f.toward[0]) > Math.abs(f.toward[2]) ? (f.toward[0] > 0 ? 'east' : 'west') : f.toward[2] > 0 ? 'south' : 'north' } : null)
      if (url.pathname === '/rule') {
        // A rule for the world the asker is in: what its people do, a game, a power. {wish, from, by, change, realm}
        const wish = text(body?.wish, 20_000), where = place(body?.from), change = body?.change
        const directs = body?.director === true
        if ((!wish && !directs) || !where) return end(400, { why: 'a rule is asked for with a wish and where the asker stands: {wish, from: {eye, toward}}' })
        if (change !== undefined && (typeof change !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(change))) return end(400, { why: 'the rule to change is named by its id' })
        return stream(async (line, tell) => {
          // The realm's director (make/director.mjs): written with the realm's own rules in front of the model if there is none, changed as the wish says if there is, and turned on. A quick one first, the fuller behind it.
          if (directs) {
            say(`asked by ${text(body.by, 24) || 'someone'} for a director${wish ? `: ${wish}` : ''}`)
            const r = await direct({ world: here, where, more: wish || undefined, by: text(body.by, 24) || 'someone', model, first: quick === model ? undefined : quick, cannot, say: tell })
            void r.better?.then((b) => say(`  the fuller director: ${b.state}${b.why ? ` (${b.why})` : ''}${b.ms ? ` in ${(b.ms / 1000).toFixed(0)} s` : ''}`))
            say(`  ${r.state}${r.why ? `: ${r.why}` : ''}`)
            return line({ stage: 'done', state: r.state, why: r.why, rule: r.id, name: r.name, cannot: r.cannot, rough: r.rough, ms: r.ms, tries: r.tries, more: !!r.better })
          }
          say(`asked by ${text(body.by, 24) || 'someone'} for a rule: ${wish}`)
          // In a realm with one rule (the realm's own, written when it was made), what is asked for is a change to
          // that rule: a power, a new habit of its people. It is put again under its id, so nothing starts over.
          let changing = change
          if (!changing && typeof body.realm === 'string') { const there = await (await fetch(`${here}/world/rules`)).json().catch(() => []); const own = Array.isArray(there) ? there.filter((r) => r.id !== DIRECTOR) : []; if (own.length === 1) changing = own[0].id }
          const r = await writeRule({ wish, world: here, where, change: changing, by: text(body.by, 24) || 'someone', model, cannot, say: tell })
          say(`  ${r.state}${r.why ? `: ${r.why}` : ''}`)
          line({ stage: 'done', state: r.state, why: r.why, rule: r.id, name: r.name, cannot: r.cannot, rough: r.rough, ms: r.ms, tries: r.tries })
        })
      }
      if (url.pathname === '/imagine') {
        // An idea for a realm, fleshed out before anything is built. {idea}
        const idea = text(body?.idea, 4000)
        if (!idea) return end(400, { why: 'say what the realm is: {idea}' })
        if (writing) return end(429, { why: 'one at a time: something is being written' })
        writing = true
        try { const r = await imagine({ idea, model: quick }); return r.why ? end(200, { why: r.why }) : end(200, { name: r.name, about: r.about, look: r.look, place: r.place, questions: r.questions }) } finally { writing = false }
      }
      if (url.pathname === '/realm') {
        // A realm made on the world's server and its rules written into it. {name, about, look, place, answers, by}
        const answers = Array.isArray(body?.answers) ? body.answers.slice(0, 3).map((a) => ({ ask: text(a?.ask, 80), answer: text(a?.answer, 60) })).filter((a) => a.ask && a.answer) : []
        if (!text(body?.name, 40)) return end(400, { why: 'a realm has a name: {name, about}' })
        if (body.into !== undefined && (typeof body.into !== 'string' || !REALM.test(body.into))) return end(400, { why: 'the realm to go on with is named by its id' })
        return stream(async (line, tell) => {
          say(`asked by ${text(body.by, 24) || 'someone'} for a realm: ${text(body.name, 40)}`)
          // Its rules are written quickly first, so the realm can be stepped into; the fuller ones follow and are put under the same id.
          const r = await makeRealm({ server, name: body.name, about: text(body.about, 4000) || text(body.name, 40), look: body.look, place: body.place, into: body.into, answers, by: text(body.by, 24) || 'someone', model, first: quick === model ? undefined : quick, cannot, say: tell })
          void r.better?.then((b) => say(`  the fuller rules of ${r.name}: ${b.state}${b.why ? ` (${b.why})` : ''}${b.ms ? ` in ${(b.ms / 1000).toFixed(0)} s` : ''}`))
          say(`  ${r.state}${r.why ? `: ${r.why}` : ''}`)
          // With a director (asked for in the new realm's flow): written once the realm's first rules are in, for it to read them, and behind the realm's being ready, so nobody waits on it to step in.
          if (body.director === true && r.realm && !r.rough) void direct({ world: `${server}/realm/${r.realm}`, where: { at: r.at, facing: 'north' }, by: text(body.by, 24) || 'someone', model, first: quick === model ? undefined : quick, cannot }).then((d) => say(`  the director of ${r.name}: ${d.state}${d.why ? ` (${d.why})` : ''}${d.ms ? ` in ${(d.ms / 1000).toFixed(0)} s` : ''}`), (e) => say(`  the director of ${r.name} failed: ${e.message}`))
          line({ stage: 'done', state: r.state, why: r.why, realm: r.realm, rule: r.rule, name: r.name, cannot: r.cannot, rough: r.rough, ms: r.ms, tries: r.tries, more: !!r.better })
        })
      }
      if (url.pathname === '/put') {
        // A held thing, stood where the asker now says: no model is asked. {held, from, clear, by}
        const f = body?.from, h = typeof body?.held === 'string' ? holds.get(body.held) : null
        if (!h) return end(404, { why: 'that is not held any more: ask for it again' })
        if (!f || !three(f.eye) || !three(f.toward, 1e6) || !(Math.hypot(...f.toward) > 0)) return end(400, { why: 'from is {eye: [x, y, z], toward: [dx, dy, dz]}' })
        if (busy) return end(429, { why: 'one thing at a time: something is being made' })
        busy = true
        holds.delete(body.held)
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...cors })
        const line = (o) => res.write(JSON.stringify(o) + '\n')
        try {
          // Where it goes now: what the asker aims at (a point or a box, as in an ask), else what is ahead of the eye.
          const t = body.target, to = t && cells(t.point, 3) ? { point: t.point } : t && cells(t.box, 6) && [0, 1, 2].every((a) => t.box[a] < t.box[a + 3]) ? { box: t.box } : undefined
          const r = await put({ hold: h.hold, world: here, where: aimed(to, { eye: f.eye.map(Math.round), toward: f.toward }).where, clear: body.clear === true, by: text(body.by, 24) || 'someone', journal, say: (words, stage) => { say(`  ${words}`); if (stage) line(stage) } })
          ended(r, line)
        } catch (e) { say(`  failed: ${e.message}`); line({ stage: 'done', state: 'refused', why: 'the helper could not place it' }) } finally { busy = false; res.end() }
        return
      }
      const ask = shaped(body)
      if (typeof ask === 'string') return end(400, { why: ask })
      // Said before anything is started, and never half done: what is not built yet is refused whole.
      if (ask.target?.thing) return end(501, { why: 'a thing cannot be aimed at yet' })
      if (busy) return end(429, { why: 'one thing at a time: something is being made' })
      busy = true
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...cors })
      const line = (o) => res.write(JSON.stringify(o) + '\n')
      try {
        const { where, fill, facing } = aimed(ask.target, ask.from)
        say(`asked by ${ask.by}: ${ask.wish || '(no words)'}${ask.picture ? ' with a picture' : ''}${ask.link ? ' with a link' : ''}`)
        // A link is fetched here, by this program, from public hosts only (make/link.mjs). What it holds is looked
        // at by the model and kept nowhere. A picture the asker gave comes before one the page named.
        let page, picture = ask.picture
        if (ask.link) {
          line({ stage: 'reading' })
          try { const got = await fetched(ask.link, { resolve }); page = got.text ? { from: got.from, text: got.text } : undefined; picture ??= got.picture } catch (e) {
            if (!notFetched(e)) throw e
            say(`  the link was not read: ${e.message}`)
            // With words or a picture beside it, the thing is made from those: only a link alone has nothing to go on.
            if (!ask.wish && !picture) return line({ stage: 'done', state: 'refused', why: `the link could not be read: ${e.message}` })
            line({ stage: 'note', why: 'the link could not be read: making it from the rest' })
          }
        }
        // A wish of words alone that was made before, or one close to it, is made from the reply kept then: no model.
        // (`fresh` asks for a new one all the same.) It is read, checked, stood and placed as any reply is.
        const apart = fill ? `${grow} ${fill.map((v) => Math.round(v / 16)).join('x')}` : '', plain = shelf && ask.wish && !picture && !page
        const known = plain && !ask.fresh ? await shelf.find(ask.wish, apart, fieldKeys()) : null
        if (known) { say(`  made before as ${known.name}: no model is asked`); line({ stage: 'known', name: known.name }) }
        const from = known ? async () => ({ text: known.reply, model: `kept (${known.model})`, ms: 0, cost: 0 }) : model
        const run = (how) => make({ wish: ask.wish, picture, page, world: here, where, fill, facing, grow, by: ask.by, journal, model: how, say: (words, stage) => { say(`  ${words}`); if (stage) line(stage) } })
        let r = await run(from)
        // What was kept could not be used after all (the form has moved on since): the model is asked, as if nothing had been kept.
        if (known && r.state === 'refused') { say('  what was kept could not be used: asking the model'); r = await run(model) }
        if (plain && r.reply && !r.model?.startsWith('kept (') && ['there', 'held'].includes(r.state)) await shelf.keep(ask.wish, apart, r.reply, { name: r.name, model: r.model, fields: fieldKeys() }).catch((e) => say(`  not kept: ${e.message}`))
        ended(r, line)
      } catch (e) {
        say(`  failed: ${e.message}`)
        line({ stage: 'done', state: 'refused', why: 'the helper could not make it' })
      } finally {
        busy = false
        res.end()
      }
    })()
  }
  const nearServer = createServer(answer('near')), farServer = reach ? createServer(answer('far')) : null
  const listen = (server, at) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(at, '127.0.0.1', resolve) })
  await listen(nearServer, port)
  if (farServer) await listen(farServer, reachPort)
  const server = nearServer
  // The people of the server's worlds are voiced from this machine too (#264): by a loop of the talk lane's own, which asks each world someone is in and answers it.
  const voiced = voice ? voicing({ server: world, say, ...voice }) : null
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, secret, link: `${(page ?? world).replace(/\/$/, '')}/city?shared=1#helper=${encodeURIComponent((reach ?? url).replace(/\/$/, ''))}&secret=${secret}`, reachPort: farServer?.address().port, voiced, close: () => (void voiced?.close(), Promise.all([nearServer, farServer].filter(Boolean).map((one) => new Promise((resolve) => { one.closeAllConnections(); one.close(resolve) })))) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }
  const world = flag('world')
  if (!world) { console.error('say which world: node helper.mjs --world http://127.0.0.1:port (a server started with --world file)'); process.exit(2) }
  const canned = flag('reply')
  const model = canned ? async () => (await new Promise((r) => setTimeout(r, Number(flag('wait') ?? 0) * 1000)), { text: await readFile(canned, 'utf8'), model: `a reply kept in ${canned} (no model was run)`, ms: 0, cost: 0 }) : (q) => reply({ ...q, model: flag('model') ?? 'opus', binary: flag('claude') ?? 'claude' })
  const h = await helper({ world, port: Number(flag('port') ?? 5762), quick: canned ? undefined : (q) => reply({ ...q, model: flag('quick') ?? 'sonnet', binary: flag('claude') ?? 'claude' }), cannot: flag('cannot'), shop: { ...(flag('workshop-project') ? { project: flag('workshop-project') } : {}), ...(flag('t3') ? { t3: flag('t3') } : {}), provider: flag('workshop-provider'), model: flag('workshop-model'), checkout: flag('workshop-checkout') }, journal: flag('journal') ?? JOURNAL, kept: flag('library') ?? LIBRARY, grow: flag('grow') ?? 'cap', page: flag('page'), reach: flag('reach'), reachPort: Number(flag('reach-port') ?? 5763), only: flag('only'), model, voice: args.includes('--no-voice') || canned ? null : { name: flag('voice') ?? 'sonnet', binary: flag('claude') ?? 'claude', most: Number(flag('voice-most') ?? 40), warm: Number(flag('voice-warm') ?? 2) }, say: (s) => console.log(s) })
  console.log(`the helper listens on ${h.url}, on this machine only, and makes things in ${world}${canned ? ' from a kept reply (no model is run)' : ' with your own Claude Code'}`)
  if (h.voiced) console.log(`it also answers for the people of that world when a rule asks one to think, with your own Claude Code (${flag('voice') ?? 'sonnet'}), at most ${Number(flag('voice-most') ?? 40)} answers a minute: --no-voice turns that off`)
  console.log(`open this once, in the browser you play in. It carries the secret, which is kept by that page from then on:\n\n  ${h.link}\n`)
}
