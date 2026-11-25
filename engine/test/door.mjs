// A dedicated server strangers join (#526): `server.mjs` keeps a released world and opens its door (door.mjs) with the
// real master server (master/, built here if it is not); pages served by a plain host of files on another port (the
// static realm, `node sf/build.mjs`) join it through the master and data channels, as strangers to the world's server.
//
//   node test/door.mjs [--release dist-sf]
//
// Ports (this lane's): 6001 the master, 6002 the world's server (this machine only), 6003 the pages' host, UDP 6004
// to 6009 the door's ICE. (6000 is a port browsers and Node's fetch refuse: X11.)
import { spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, chrome, here, still } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { PROTO, fingerprintOf, signed } from '../page/wire.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const folder = resolve(here, arg('release', 'dist-sf'))
const scratch = mkdtempSync(join(tmpdir(), 'engine-door-'))
const file = join(scratch, 'world.log'), adminFile = join(scratch, 'admin'), ADMIN = 'amber-lantern-42'
writeFileSync(adminFile, `${ADMIN}\n`, { mode: 0o600 })
const MASTER = 'http://127.0.0.1:6001', WORLD = 'http://127.0.0.1:6002'
const stops = []
const finish = (code) => { for (const s of stops.reverse()) { try { s() } catch { /* gone */ } } rmSync(scratch, { recursive: true, force: true }); process.exit(code) }

// ── The master (master/README.md): limits for one address raised, since every page here is this machine ──
const masterDir = resolve(here, '..', 'master'), binary = join(masterDir, 'target', 'release', 'village-master')
if (!existsSync(binary) && spawnSync('cargo', ['build', '--release', '--quiet'], { cwd: masterDir, stdio: 'inherit' }).status !== 0) { console.error('the master did not build'); process.exit(1) }
const master = spawn(binary, ['--listen', '127.0.0.1:6001', '--registrations-per-minute', '100', '--joins-per-minute', '1000', '--lookups-per-minute', '5000', '--max-lobbies-per-addr', '16'], { stdio: ['ignore', 'ignore', 'pipe'] })
stops.push(() => master.kill('SIGINT'))
for (let i = 0; ; i++) { try { await fetch(MASTER); break } catch { if (i > 100) { console.error('the master did not start'); finish(1) } await wait(100) } }

// ── The dedicated server ──
/** Starts server.mjs and answers its lobby's id and code once the master has listed it, with how to stop it. */
async function dedicated(more = []) {
  const p = spawn('node', ['server.mjs', '--world', file, '--release', folder, '--port', '6002', '--master', MASTER, '--name', 'Fern Hollow', '--about', 'a check', '--most', '2', '--admin-password-file', adminFile, '--ice-ports', '6004-6009', ...more], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] })
  const said = []
  p.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(`  server: ${t}`) })
  const lobby = await new Promise((done, no) => {
    p.stdout.on('data', (d) => { said.push(String(d)); const m = /lobby ([0-9a-z]{12}), code ([0-9a-z]{20})/.exec(said.join('')); if (m) done({ id: m[1], code: m[2] }) })
    p.on('exit', (code) => no(new Error(`the server ended (${code}): ${said.join('').slice(-400)}`)))
  })
  return { ...lobby, process: p, said, stop: () => p.kill('SIGINT') }
}
let server = await dedicated()
stops.push(() => server.process.kill('SIGKILL'))
const site = await plain(folder, '127.0.0.1', 6003)
stops.push(() => site.stop())
check(!!server.id && !!server.code, `server.mjs keeps the world and is listed with the master as lobby ${server.id}`)
const json = async (path) => { const r = await fetch(`${WORLD}${path}`); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r.json() }
const ground = await json('/world/ground')
const arrive = ground.arrive.at.map(Math.round)

// ── Pages, strangers to the world's server ──
const browser = await chrome()
stops.push(() => browser.close())
const pages = []
/** A page of the static realm from the plain host, joining the lobby by its id (or a code). Answers {page, errors, asked}. */
async function open(name, { lobby = server.id, query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  ${name}'s page: ${m.text().slice(0, 300)}`) })
  await page.goto(`${site.url}/sf/index.html?lobbies=1&master=${encodeURIComponent(MASTER)}&lobby=${lobby}&name=${name}&first=0&boards=0&fly=0&fire=0&scale=0.5&sound=0${query}`)
  const p = { name, page, errors, context }
  pages.push(p)
  return p
}
const joined = (p) => p.page.waitForFunction(() => globalThis.engine?.lobby?.you, null, { timeout: 120_000 }).then(() => true, () => false)
const notice = (p) => p.page.evaluate(() => document.getElementById('door-notice')?.textContent ?? '')
const noticed = (p, re, ms = 30_000) => p.page.waitForFunction((src) => new RegExp(src).test(document.getElementById('door-notice')?.textContent ?? ''), re.source, { timeout: ms }).then(() => true, () => false)
/** The eye over a place, with the world round it made. */
const over = async (page, { x, z }) => {
  await page.evaluate(([x, z]) => { const e = globalThis.engine; Object.assign(e.pose, { x: x / 10, y: e.ground(x / 10, z / 10) + 3, z: z / 10, yaw: 0, pitch: -0.3 }) }, [x, z])
  await page.waitForTimeout(1200)
  await still(page, { limit: 120_000 })
}
const firstSolid = (page, x, z, y) => page.evaluate(([x, z, y]) => { let at = y; for (; at > y - 400 && !globalThis.engine.kind(x, at, z); at--); return at }, [x, z, y])
const worldSolid = async (x, z, y) => (await json(`/world/tops?x0=${x}&z0=${z}&x1=${x + 1}&z1=${z + 1}&y=${y}`)).high[0]

// ── A client on the wire (node-datachannel): the same protocol a page speaks, for steps that need no picture ──
const { RTCPeerConnection } = await import('node-datachannel/polyfill')
/** Joins a lobby as a page does. Answers {you, name, fetch, ctl, close, gone} once welcomed, or {why}. `hello` overrides fields of the hello. */
async function wire(name, { lobby = server.id, keys = generateKeyPairSync('ec', { namedCurve: 'P-256' }), password, hello = {}, munge = (sdp) => sdp, silent = false } = {}) {
  const pc = new RTCPeerConnection({ iceServers: [] })
  const ch = { ctl: pc.createDataChannel('ctl'), down: pc.createDataChannel('down'), up: pc.createDataChannel('up') }
  await pc.setLocalDescription(await pc.createOffer())
  await wait(300)
  const r = await fetch(`${MASTER}/lobbies/${lobby}/join`, { method: 'POST', body: JSON.stringify({ sdp: munge(pc.localDescription.sdp) }) })
  const v = await r.json()
  if (!r.ok) { pc.close(); return { why: v.why ?? String(r.status), status: r.status } }
  await pc.setRemoteDescription({ type: 'answer', sdp: v.sdp })
  const opened = await Promise.race([Promise.all(Object.values(ch).map((c) => (c.readyState === 'open' ? null : new Promise((done) => c.addEventListener('open', done, { once: true }))))).then(() => true), wait(10_000).then(() => false)])
  if (!opened) { pc.close(); return { why: 'no channel opened' } }
  // Joined and saying nothing: holding a place at the door.
  if (silent) { stops.push(() => pc.close()); return { pc } }
  const said = []
  const { promise: gone, resolve: went } = Promise.withResolvers()
  ch.ctl.addEventListener('message', (e) => { const m = JSON.parse(e.data); said.push(m); if (m.gone) went(m.gone.why) })
  // Who this client is: its key, and its signature over this connection's fingerprint, as a page says it (page/wire.ts).
  const key = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const sig = sign('sha256', Buffer.from(signed(fingerprintOf(v.sdp))), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
  try { ch.ctl.send(JSON.stringify({ hello: { proto: PROTO, pin: ground.release, name, key, sig, ...(password ? { password } : {}), ...hello } })) } catch { /* closed already */ }
  for (let i = 0; i < 100 && !said.length; i++) await wait(50)
  const first = said.shift()
  if (!first?.welcome) { pc.close(); return { why: first?.refuse?.why ?? 'no answer' } }
  let n = 0
  const replies = new Map()
  let current = null
  ch.up.addEventListener('message', (e) => {
    if (typeof e.data === 'string') { const h = JSON.parse(e.data), w = replies.get(h.n); if (!w) return; w.head = h; w.parts = []; current = h.n; if (!h.k) { replies.delete(h.n); w.done({ status: h.s, text: '' }) } return }
    const w = replies.get(current); if (!w) return
    w.parts.push(Buffer.from(e.data))
    if (w.parts.length === w.head.k) { replies.delete(current); w.done({ status: w.head.s, text: Buffer.concat(w.parts).toString('utf8') }) }
  })
  // What comes down a stream, as bytes in order (one stream at a time here).
  let down = Buffer.alloc(0)
  ch.down.addEventListener('message', (e) => { down = Buffer.concat([down, Buffer.from(e.data, 4)]) })
  const request = (path, { method = 'GET', body } = {}) => new Promise((done) => {
    const k = n++, bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), parts = Math.ceil(bytes.length / 16384)
    replies.set(k, { done })
    setTimeout(() => { if (replies.delete(k)) done({ status: 0, text: 'no reply' }) }, 30_000)
    ch.up.send(JSON.stringify({ n: k, m: method, p: path, k: parts }))
    for (let i = 0; i < parts; i++) ch.up.send(bytes.subarray(i * 16384, (i + 1) * 16384))
  })
  const ctl = (m) => new Promise((done) => { const k = 1e6 + n++; const on = (e) => { const r = JSON.parse(e.data); if (r.n === k) { ch.ctl.removeEventListener('message', on); done(r) } }; ch.ctl.addEventListener('message', on); ch.ctl.send(JSON.stringify({ n: k, ...m })) })
  const beat = setInterval(() => { try { ch.ctl.send(JSON.stringify({ ping: 1 })) } catch { clearInterval(beat) } }, 2000)
  const w = { ...first.welcome, pc, fetch: request, ctl, gone, frames: () => framesOf(down), close: () => { clearInterval(beat); pc.close() } }
  stops.push(w.close)
  return w
}
/** The JSON frames of the kinds asked for in a stream's bytes. */
function framesOf(bytes, kinds = [3, 5, 6, 11]) {
  const out = []
  for (let at = 0; bytes.length - at >= 12;) {
    const kind = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 8)
    if (bytes.length - at < 12 + size) break
    if (kinds.includes(kind)) { try { out.push({ kind, data: JSON.parse(bytes.subarray(at + 12, at + 12 + size).toString('utf8')) }) } catch { /* not JSON */ } }
    at += 12 + size
  }
  return out
}
/** The world's own stream, read from this machine (the check is the host here): what it echoes, who is where, what is said, what it tells pages of plugins. */
function watch() {
  const frames = [], stop = new AbortController()
  void (async () => {
    const r = await fetch(`${WORLD}/world/stream?from=0`, { signal: stop.signal })
    let held = Buffer.alloc(0)
    for await (const chunk of r.body) {
      held = Buffer.concat([held, chunk])
      let at = 0
      while (held.length - at >= 12) {
        const kind = held.readUInt32LE(at), size = held.readUInt32LE(at + 8)
        if (held.length - at < 12 + size) break
        if ([3, 5, 6, 11].includes(kind)) { try { frames.push({ kind, data: JSON.parse(held.subarray(at + 12, at + 12 + size).toString('utf8')) }) } catch { /* not JSON */ } }
        at += 12 + size
      }
      held = held.subarray(at)
    }
  })().catch(() => {})
  stops.push(() => stop.abort())
  return { frames, stop: () => stop.abort(), echoes: () => frames.filter((f) => f.kind === 3).map((f) => f.data), said: () => frames.filter((f) => f.kind === 6).map((f) => f.data), here: () => frames.filter((f) => f.kind === 5).map((f) => f.data), plugged: () => frames.filter((f) => f.kind === 11).map((f) => f.data) }
}
const lobbyOf = (p, script, arg) => p.page.evaluate(script, arg)

try {
  // ── Two strangers in one world ──────────────────────────────────────────────
  const ada = await open('Ada'), bram = await open('Bram')
  const both = [await joined(ada), await joined(bram)]
  check(both.every(Boolean), `two pages from another host join through the master and the door (${both})`)
  if (!both.every(Boolean)) throw new Error(`not joined: ${await notice(ada)} / ${await notice(bram)}`)
  const yous = [await ada.page.evaluate(() => globalThis.engine.lobby.you), await bram.page.evaluate(() => globalThis.engine.lobby.you)]
  check(yous[0] !== yous[1] && yous.every((y) => /^v[0-9a-f]{9}$/.test(y)), `each is someone the server named (${yous.join(', ')})`)
  for (const p of [ada, bram]) await over(p.page, { x: arrive[0], z: arrive[2] })
  await ada.page.waitForTimeout(1500)
  const seen = [await ada.page.evaluate(() => globalThis.engine.others), await bram.page.evaluate(() => globalThis.engine.others)]
  check(seen[0] === 1 && seen[1] === 1, `each sees the other (${seen})`)

  const world = watch()
  const [adaYou, bramYou] = yous

  // ── The same ground, a blast, a brick, a word ───────────────────────────────
  const top = (await json(`/world/at?x=${arrive[0]}&y=0&z=${arrive[2]}`)).ground + 350
  const spot = { x: arrive[0] + 30, z: arrive[2] - 40 }
  const before = await worldSolid(spot.x, spot.z, top)
  const sameGround = [await firstSolid(ada.page, spot.x, spot.z, top), await firstSolid(bram.page, spot.x, spot.z, top)]
  check(sameGround.every((h) => h === before), `both pages stand on the world's own ground (first solid cell ${sameGround.join(', ')}; the world's ${before})`)
  await ada.page.evaluate(([x, y, z]) => globalThis.engine.strike([x, y, z], 14, false), [spot.x, before, spot.z])
  await wait(3000)
  for (const p of [ada, bram]) await still(p.page, { limit: 120_000 })
  const blasted = [await worldSolid(spot.x, spot.z, top), await firstSolid(ada.page, spot.x, spot.z, top), await firstSolid(bram.page, spot.x, spot.z, top)]
  check(blasted[0] < before && blasted.every((h) => h === blasted[0]), `Ada's blast breaks the ground for Bram and the world alike (${before} before, ${blasted.join(', ')} after)`)
  const brick = [arrive[0] - 40, 0, arrive[2] + 20]
  brick[1] = (await worldSolid(brick[0], brick[2], top)) + 1
  await bram.page.evaluate(([x, y, z]) => globalThis.engine.set([x, y + 2, z], 2, 8), brick)
  await wait(3000)
  for (const p of [ada, bram]) await still(p.page, { limit: 120_000 })
  const cell = [brick[0], brick[1] + 1, brick[2]]
  const kinds = [(await json(`/world/at?x=${cell[0]}&y=${cell[1]}&z=${cell[2]}`)).kind, await ada.page.evaluate((c) => globalThis.engine.kind(...c), cell), await bram.page.evaluate((c) => globalThis.engine.kind(...c), cell)]
  check((kinds[0] & 15) === 8 && kinds.every((k) => k === kinds[0]), `Bram's bricks stand for Ada and in the world (${kinds}: brick is 8)`)
  await ada.page.evaluate(() => globalThis.engine.say('hello from Ada'))
  const heard = await bram.page.waitForFunction(() => document.body.textContent.includes('Ada: hello from Ada'), null, { timeout: 15_000 }).then(() => true, () => false)
  check(heard, 'Ada talks and Bram hears her')
  const echoes = world.echoes()
  check(echoes.some((e) => e.blast && e.by === adaYou) && echoes.some((e) => e.edit && e.by === bramYou), 'the world has each one\'s ask under the id the server gave them')

  // ── A page that writes another's name acts as itself ────────────────────────
  const n0 = world.frames.length
  await ada.page.evaluate(async ([bram, x, y, z]) => {
    const f = (p, b) => globalThis.engine.lobby.fetch(p, { method: 'POST', body: JSON.stringify(b) })
    await f('/world/ask', { by: bram, blast: [x, y, z], radius: 2 })
    await f('/world/here', { by: bram, name: 'Bram', at: [x, y + 40, z], yaw: 0 })
    await f('/world/say', { by: bram, name: 'Bram', text: 'not Bram at all' })
  }, [bramYou, spot.x + 60, before, spot.z])
  await wait(1500)
  const after = world.frames.slice(n0)
  const spoofEcho = after.find((f) => f.kind === 3 && f.data.blast && f.data.radius === 2)?.data
  const spoofSaid = after.find((f) => f.kind === 6 && f.data.text === 'not Bram at all')?.data
  // Where the page said it stood with Bram's id: the world kept x and z as they were sent.
  const spoofHere = after.filter((f) => f.kind === 5 && f.data.at?.[0] === spot.x + 60 && f.data.at?.[2] === spot.z).map((f) => f.data)
  check(spoofEcho?.by === adaYou && spoofSaid?.by === adaYou && spoofSaid?.name === 'Ada' && spoofHere.length > 0 && spoofHere.every((h) => h.by === adaYou && h.name === 'Ada'), `a page that writes Bram's id in by blasts, stands and speaks as itself (blast by ${spoofEcho?.by}, said by ${spoofSaid?.by} as ${spoofSaid?.name}; at the spot it named: ${[...new Set(spoofHere.map((h) => `${h.name} ${h.by}`))].join(', ') || 'nobody'})`)

  // ── Plugins: the world lists page sides, a page through a door takes none ────
  const listed = world.plugged().find((m) => m.list)?.list ?? []
  const loaded = [await ada.page.evaluate(() => Object.keys(globalThis.engine.plugins?.loaded ?? {}).length), await bram.page.evaluate(() => Object.keys(globalThis.engine.plugins?.loaded ?? {}).length)]
  const fetchedCode = site.asked.filter((q) => /\/plugins\/|core\.wasm\?v=/.test(q.path)).length
  check(listed.length > 0 && loaded.every((n) => n === 0) && fetchedCode === 0, `the world asks pages to load ${listed.length} plugins' page sides (${listed.map((p) => p.name).join(', ')}), and a page through a door loads none (${loaded}) and asks for none (${fetchedCode})`)

  // ── Full ────────────────────────────────────────────────────────────────────
  const third = await wire('Cleo')
  check(third.why === 'the server is full', `a third of a server of two is refused: "${third.why}"`)

  // ── Admins ──────────────────────────────────────────────────────────────────
  const wrong = await lobbyOf(ada, () => globalThis.engine.lobby.admin('not-the-password'))
  const tooSoon = await lobbyOf(ada, (pw) => globalThis.engine.lobby.admin(pw), ADMIN)
  await wait(1500)
  const right = await lobbyOf(ada, (pw) => globalThis.engine.lobby.admin(pw), ADMIN)
  check(wrong.why === 'wrong password' && /wait/.test(tooSoon.why ?? '') && right.ok === true, `a wrong admin password is refused (${wrong.why}), the next try waits (${tooSoon.why}), and the right one is taken`)
  const strangerOps = await lobbyOf(bram, () => globalThis.engine.lobby.kick('v000000000'))
  check(strangerOps.why === 'only an admin may', `a stranger cannot kick (${strangerOps.why})`)
  check((await lobbyOf(ada, () => globalThis.engine.lobby.most(3))).ok, 'an admin makes room for three')
  const cleoKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' }), cleo = await wire('Cleo', { keys: cleoKeys })
  check(!!cleo.you, `then a third joins (${cleo.you ?? cleo.why})`)
  const people = await lobbyOf(ada, () => globalThis.engine.lobby.who())
  check(people.people?.map((p) => p.name).sort().join(',') === 'Ada,Bram,Cleo', `an admin lists who is there (${people.people?.map((p) => `${p.name}${p.admin ? ' (admin)' : ''}`).join(', ')})`)

  // ── What is off the list ────────────────────────────────────────────────────
  const off = {}
  for (const [m, p] of [['GET', '/world/minds'], ['POST', '/world/mind'], ['POST', '/world/join'], ['GET', `/world/me?by=${adaYou}`], ['GET', `/world/around?by=${adaYou}`], ['GET', '/release/current.json'], ['GET', '/page/main.ts'], ['GET', '/plugins/make/page.ts'], ['GET', '/'], ['POST', '/report'], ['GET', '/realm/home/world/ground'], ['GET', '/world/../release/current.json'], ['GET', '//127.0.0.1:6002/world/ground'], ['GET', 'http://127.0.0.1:6002/world/ground'], ['GET', '/world/ground/'], ['GET', '/WORLD/ground'], ['PUT', '/world/ask']]) { off[`${m} ${p}`] = (await cleo.fetch(p, { method: m, body: m === 'GET' ? undefined : {} })).status; await wait(80) }
  check(Object.values(off).every((s) => s === 404), `routes off the list are not passed: ${Object.entries(off).map(([k, s]) => `${k} ${s}`).join('; ')}`)
  const admin = {}
  for (const [m, p, b] of [['POST', '/world/ask', { rule: { id: 'cleo-rule', source: 'on("tick", () => {})' } }], ['POST', '/world/ask', { unrule: 'talk' }], ['POST', '/world/ask', { realm: { name: 'Cleo\'s now' } }], ['POST', '/world/ask', { realm: { director: true } }], ['GET', '/world/rules?id=talk'], ['POST', '/realms', { name: 'elsewhere' }], ['GET', '/gaps'], ['POST', '/world/gap', { cannot: ['x'] }], ['POST', '/plugins/look'], ['POST', '/core/look']]) { admin[`${m} ${p}${b ? ` ${Object.keys(b)[0]}` : ''}`] = (await cleo.fetch(p, { method: m, body: b ?? {} })).status; await wait(80) }
  check(Object.values(admin).every((s) => s === 403), `what changes the game is an admin's: ${Object.entries(admin).map(([k, s]) => `${k} ${s}`).join('; ')}`)
  const ruled = await ada.page.evaluate(async () => (await globalThis.engine.lobby.fetch('/world/ask', { method: 'POST', body: JSON.stringify({ rule: { id: 'ada-rule', name: 'a quiet rule', source: 'on("tick", () => {})' } }) })).status)
  await wait(1000)
  const rules = await json('/world/rules')
  check(ruled === 202 && rules.some((r) => r.id === 'ada-rule' && r.by === adaYou) && !rules.some((r) => r.id === 'cleo-rule'), `a rule put in by an admin is taken, under her id, and the stranger's is not (${ruled}; ${rules.map((r) => r.id).join(', ')})`)
  // A rule's source is the admins': the stream through the door carries the rule without it.
  const streamed = (await cleo.fetch('/world/stream?from=0')).status
  await wait(1500)
  const ruleEcho = cleo.frames().find((f) => f.kind === 3 && f.data.rule?.id === 'ada-rule')?.data.rule
  check(streamed === 200 && !!ruleEcho && ruleEcho.source === undefined && world.echoes().some((e) => e.rule?.id === 'ada-rule' && typeof e.rule.source === 'string'), `a stranger's stream tells of the admin's rule without its source (${ruleEcho ? Object.keys(ruleEcho).join(', ') : 'none'})`)

  // ── Building for admins only ────────────────────────────────────────────────
  check((await lobbyOf(ada, () => globalThis.engine.lobby.build('admins'))).build === 'admins', 'an admin says only admins build')
  const s1 = world.frames.length
  const ground0 = await worldSolid(spot.x - 60, spot.z, top)
  const strangerBlast = (await cleo.fetch('/world/ask', { method: 'POST', body: { blast: [spot.x - 60, ground0, spot.z], radius: 6 } })).status
  // A body to speak from: a page says where it is ten times a second.
  const standing = setInterval(() => void cleo.fetch('/world/here', { method: 'POST', body: { at: [arrive[0] + 20, arrive[1] + 20, arrive[2]], yaw: 0 } }), 200)
  await wait(600)
  const strangerSay = (await cleo.fetch('/world/say', { method: 'POST', body: { text: 'may I build?' } })).status
  await bram.page.evaluate(([x, y, z]) => globalThis.engine.strike([x, y, z], 6, false), [spot.x - 60, ground0, spot.z])
  await wait(2500)
  const ground1 = await worldSolid(spot.x - 60, spot.z, top)
  const heardCleo = world.frames.slice(s1).some((f) => f.kind === 6 && f.data.text === 'may I build?' && f.data.by === cleo.you)
  check(strangerBlast === 403 && ground1 === ground0 && heardCleo, `with building for admins only a stranger's blast is refused (${strangerBlast}) and Bram's page changes nothing (${ground0} then ${ground1}), and words are still heard (${strangerSay}, ${heardCleo})`)
  clearInterval(standing)
  await lobbyOf(ada, () => globalThis.engine.lobby.build('everyone'))

  // ── One connection's flood does not starve the rest ─────────────────────────
  const flood = Promise.all(Array.from({ length: 400 }, (_, i) => cleo.fetch(`/world/at?x=${arrive[0] + i}&y=${top}&z=${arrive[2]}`)))
  const adaDuring = await ada.page.evaluate(async ([x, y, z]) => { const out = []; for (let i = 0; i < 10; i++) { out.push((await globalThis.engine.lobby.fetch(`/world/at?x=${x + i}&y=${y}&z=${z}`)).status); await new Promise((r) => setTimeout(r, 100)) } return out }, [arrive[0], top, arrive[2]])
  const flooded = (await flood).map((r) => r.status)
  const refused = flooded.filter((s) => s === 429).length
  check(refused > 300 && adaDuring.every((s) => s === 200), `one connection's 400 asks at once are held to its own limit (${refused} refused, ${flooded.filter((s) => s === 200).length} answered) while Ada's are all answered (${adaDuring.join(',')})`)

  // Guesses sent together wait as guesses sent one by one do: one is tried, the rest are told to wait.
  const guesses = (await Promise.all(Array.from({ length: 6 }, (_, i) => cleo.ctl({ admin: `guess-${i}` })))).map((r) => r.why)
  check(guesses.filter((w) => w === 'wrong password').length === 1 && guesses.filter((w) => /wait/.test(w ?? '')).length === 5, `six admin passwords sent at once: one tried, five told to wait (${[...new Set(guesses)].join('; ')})`)

  // ── Kick and ban ────────────────────────────────────────────────────────────
  check((await lobbyOf(ada, (you) => globalThis.engine.lobby.kick(you), bramYou)).ok === true, 'an admin kicks Bram')
  const bramTold = await noticed(bram, /sent this page away: an admin kicked you/)
  const adaAlone = await ada.page.waitForFunction(() => globalThis.engine.others === 0, null, { timeout: 15_000 }).then(() => true, () => false)
  check(bramTold && adaAlone, `Bram's page says he was sent away (${await notice(bram)}), and he is gone from Ada's world (Cleo, on the wire, has no figure)`)
  check((await lobbyOf(ada, (you) => globalThis.engine.lobby.ban(you), bramYou)).ok === true, 'an admin bans Bram by his id')
  await bram.page.reload()
  const bramBanned = await noticed(bram, /banned/)
  check(bramBanned, `Bram cannot come back: "${await notice(bram)}"`)

  // ── Hellos the door refuses (there is room now) ─────────────────────────────
  const proto = await wire('Dove', { hello: { proto: 2 } }), pinned = await wire('Dove', { hello: { pin: 'a'.repeat(64) } })
  const unsigned = await wire('Dove', { hello: { sig: Buffer.alloc(64).toString('base64') } })
  // Cleo's key is no secret (every server she joins sees it); without her private key nobody can be her.
  const asCleo = await wire('Dove', { hello: { key: cleoKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } })
  check(/protocol 1/.test(proto.why) && /release/.test(pinned.why) && /signed/.test(unsigned.why) && /signed/.test(asCleo.why), `a hello of another protocol or release, unsigned, or with another's key is refused ("${proto.why}"; "${pinned.why}"; "${unsigned.why}"; "${asCleo.why}")`)
  const alike = await wire('Ada\u200b')
  check(alike.name === 'Ada (2)', `a name that only looks like Ada's is told apart (${JSON.stringify(alike.name)})`)
  alike.close?.()
  await wait(1500)
  // Joins that open their channels and say nothing cannot keep the door shut.
  for (let i = 0; i < 9; i++) await wire('Quiet', { silent: true })
  const fern = await wire('Fern')
  check(!!fern.you, `after nine joins that say nothing, someone who says hello is let in (${fern.you ?? fern.why})`)
  fern.close?.()
  // A page that says it takes four-byte messages is let go, and the server goes on.
  const tiny = await wire('Gil', { munge: (sdp) => `${sdp.replace(/a=max-message-size:\d+\r\n/, '')}a=max-message-size:4\r\n` })
  const t0 = Date.now(), still_ = await ada.page.evaluate(async () => (await globalThis.engine.lobby.fetch('/world/ground')).status)
  check(!tiny.you && still_ === 200 && Date.now() - t0 < 3000, `a peer that takes four-byte messages is not let in (${tiny.why}), and the server answers Ada at once (${still_} in ${Date.now() - t0} ms)`)
  await wait(11_000)

  // ── A password ──────────────────────────────────────────────────────────────
  check((await lobbyOf(ada, () => globalThis.engine.lobby.lock('quiet-river'))).locked === true, 'an admin sets a password')
  const lockedFile = readFileSync(`${file}.door.json`, 'utf8')
  check(!lockedFile.includes('quiet-river') && /^[0-9a-f]{64}$/.test(JSON.parse(lockedFile).password?.hash ?? ''), 'the password is kept as a hash, not plainly')
  const listedLocked = (await (await fetch(`${MASTER}/lobbies/${server.id}`)).json()).locked
  const badPw = await wire('Dove', { password: 'loud-river' })
  const noPw = await wire('Dove')
  await wait(2500)
  const goodPw = await wire('Dove', { password: 'quiet-river' })
  check(listedLocked === true && badPw.why === 'wrong password' && noPw.why === 'this server asks for a password' && !!goodPw.you, `the master lists it locked (${listedLocked}); a wrong password is refused (${badPw.why}), none is asked for (${noPw.why}), and the right one lets Dove in (${goodPw.you ?? goodPw.why})`)
  await lobbyOf(ada, () => globalThis.engine.lobby.lock(null))

  // ── Banned by address (last: every page here comes from this one address) ──
  const seenAs = goodPw.pc?.selectedCandidatePair?.()?.local?.address
  check((await lobbyOf(ada, (you) => globalThis.engine.lobby.ban(you, { address: true }), goodPw.you)).ok === true, 'an admin bans Dove by her id and her address')
  const fresh = await wire('Esme')
  check(/banned/.test(fresh.why ?? ''), `someone new from that address is refused: "${fresh.why}"`)
  const kept = JSON.parse(readFileSync(`${file}.door.json`, 'utf8'))
  check(kept.bans.length === 2 && !!seenAs && !JSON.stringify(kept).includes(seenAs), `bans are kept beside the world's file (${kept.bans.length}), with no address in it plainly`)

  // ── A link alone takes nobody into a lobby (local.ts `MASTER`): the realm's rule is a preview, and without ?lobbies=1
  // the address is not read for a master ──
  {
    const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 }), page = await context.newPage()
    const toMaster = [], from = Date.now()
    page.on('request', (r) => { if (r.url().startsWith(MASTER)) toMaster.push(r.url()) })
    await page.goto(`${site.url}/sf/index.html?master=${encodeURIComponent(MASTER)}&lobby=${server.id}&name=Cleo&first=0&boards=0&fly=0&fire=0&scale=0.5&sound=0`)
    await page.waitForFunction(() => globalThis.engine?.seen?.near, null, { timeout: 120_000 }).catch(() => {})
    await page.waitForTimeout(3000)
    const lobby = await page.evaluate(() => typeof globalThis.engine?.lobby)
    const door = site.asked.filter((q) => q.at >= from && /\/page\/(door|wire)\.js/.test(q.path)).length
    check(lobby === 'undefined' && toMaster.length === 0 && door === 0, `without ?lobbies=1 a link with a master and a lobby joins nothing: no lobby (${lobby}), ${toMaster.length} requests to the master, the door's code not fetched (${door})`)
    await context.close()
  }

  // ── The host's process is killed ────────────────────────────────────────────
  server.process.kill('SIGKILL')
  const adaGone = await noticed(ada, /server is gone/, 30_000)
  check(adaGone, `when the host's process is killed Ada's page says so: "${await notice(ada)}"`)
  for (const p of [ada, bram]) check(!p.errors.length, `${p.name}'s page raised no error (${p.errors.join('; ').slice(0, 300)})`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); finish(1) }
console.log('door: ok')
finish(0)
