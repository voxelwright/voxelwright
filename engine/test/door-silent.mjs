// Joins that say nothing cannot keep a dedicated server's door shut (#526). Node only: the real master, `server.mjs`
// (the generated town) and clients on the wire (node-datachannel), with the door's ICE ports pinned tight, so every
// place at the door is a port and a join let go must give its port back before the next can have it.
//
//   node test/door-silent.mjs [--ports 6070] [--rounds 3] [--trickle 30] [--server server.mjs]
//
// Ports (from --ports): +1 the master, +2 the world's server, UDP +4 to +9 the door's ICE: six, two of them players',
// so four joins can wait. --server runs another copy of server.mjs (an older door, to see these steps fail on it).
import { spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { Agent, request } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, here } from './kit.mjs'
import { PROTO, fingerprintOf, signed } from '../page/wire.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PORTS = Number(arg('ports', '6070')), port = (n) => PORTS + n
const ROUNDS = Number(arg('rounds', '3')), TRICKLE = Number(arg('trickle', '30')) * 1000, SERVER = arg('server', 'server.mjs')
/**
 * How long a join that says hello may take from its offer to its welcome, whatever is waiting at the door: a place
 * within 3 s (door.mjs PLACE_WAIT; joins answered under 2 s ago are not let go), its answer gathered, its channels open.
 * Measured here: 34 ms to 2.4 s.
 */
const BOUND = 4000
const MASTER = `http://127.0.0.1:${port(1)}`
const scratch = mkdtempSync(join(tmpdir(), 'engine-door-silent-'))
const stops = []
// Whatever happens, the master and the server started here are stopped.
process.on('uncaughtException', (e) => { console.error(e); finish(1) })
process.on('unhandledRejection', (e) => { console.error(e); finish(1) })
const finish = (code) => { for (const s of stops.reverse()) { try { s() } catch { /* gone */ } } rmSync(scratch, { recursive: true, force: true }); process.exit(code) }

// ── The master: limits for one address raised, since every client here is this machine ──
const masterDir = resolve(here, '..', 'master'), binary = join(masterDir, 'target', 'release', 'village-master')
if (!existsSync(binary) && spawnSync('cargo', ['build', '--release', '--quiet'], { cwd: masterDir, stdio: 'inherit' }).status !== 0) { console.error('the master did not build'); process.exit(1) }
const master = spawn(binary, ['--listen', `127.0.0.1:${port(1)}`, '--registrations-per-minute', '100', '--joins-per-minute', '5000', '--lookups-per-minute', '5000', '--max-lobbies-per-addr', '16'], { stdio: ['ignore', 'ignore', 'pipe'] })
stops.push(() => master.kill('SIGINT'))
for (let i = 0; ; i++) { try { await fetch(MASTER); break } catch { if (i > 100) { console.error('the master did not start'); finish(1) } await wait(100) } }

// ── The dedicated server: three players at most, six ICE ports ──
const server = spawn('node', [SERVER, '--world', join(scratch, 'world.log'), '--port', String(port(2)), '--master', MASTER, '--name', 'Fern Hollow', '--most', '3', '--ice-ports', `${port(4)}-${port(9)}`], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] })
stops.push(() => server.kill('SIGKILL'))
server.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(`  server: ${t}`) })
const said = []
const lobby = await new Promise((done, no) => {
  server.stdout.on('data', (d) => { said.push(String(d)); const m = /lobby ([0-9a-z]{12}), code/.exec(said.join('')); if (m) done(m[1]) })
  server.on('exit', (code) => no(new Error(`the server ended (${code}): ${said.join('').slice(-400)}`)))
}).catch((e) => { console.error(e.message); finish(1) })

// ── Clients on the wire ──
const { RTCPeerConnection } = await import('node-datachannel/polyfill')
/** Only the candidates of one address, so a connection is made from it and nothing else. */
const only = (sdp, address) => (address ? sdp.split('\r\n').filter((l) => !l.startsWith('a=candidate:') || l.split(' ')[4] === address).join('\r\n') : sdp)
/**
 * A join. `as`: 'hello' (a page: it says hello the moment its channels open), 'silent' (its channels open and it says
 * nothing), 'unopened' (it never takes the answer, so nothing opens), 'ctl' (one channel of three, and nothing said),
 * 'garbled' (its first word is not JSON). `from`: the one address it uses. Answers {status, why, you, ms, open, close}.
 */
async function wire(name, { as = 'hello', from = null } = {}) {
  const pc = new RTCPeerConnection({ iceServers: [] })
  stops.push(() => pc.close())
  const ch = { ctl: pc.createDataChannel('ctl') }
  if (as !== 'ctl') { ch.down = pc.createDataChannel('down'); ch.up = pc.createDataChannel('up') }
  await pc.setLocalDescription(await pc.createOffer())
  await wait(300)
  const t0 = Date.now()
  let r
  try { r = await fetch(`${MASTER}/lobbies/${lobby}/join`, { method: 'POST', body: JSON.stringify({ sdp: only(pc.localDescription.sdp, from) }) }) } catch (e) { pc.close(); return { why: `the master: ${e.message}`, close: () => {}, open: () => false } }
  const v = await r.json()
  const out = { status: r.status, pc, close: () => pc.close(), open: () => ch.ctl.readyState === 'open' }
  if (!r.ok) { pc.close(); return { ...out, why: v.why ?? String(r.status) } }
  if (as === 'unopened') return out
  await pc.setRemoteDescription({ type: 'answer', sdp: only(v.sdp, from) })
  const opened = await Promise.race([Promise.all(Object.values(ch).map((c) => (c.readyState === 'open' ? null : new Promise((done) => c.addEventListener('open', done, { once: true }))))).then(() => true), wait(5000).then(() => false)])
  if (!opened) { const why = `no channel opened (${pc.connectionState}, ice ${pc.iceConnectionState}, ${Object.entries(ch).map(([k, c]) => `${k} ${c.readyState}`).join(', ')})`; pc.close(); return { ...out, why } }
  try { out.local = pc.selectedCandidatePair()?.local?.address } catch { /* not known */ }
  // (A join the door has let go by now is closed: sending on it throws.)
  if (as === 'garbled') try { ch.ctl.send('not a word of this door') } catch { /* let go already */ }
  if (as !== 'hello') return out
  const heard = []
  ch.ctl.addEventListener('message', (e) => heard.push(JSON.parse(e.data)))
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const key = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const sig = sign('sha256', Buffer.from(signed(fingerprintOf(v.sdp))), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
  try { ch.ctl.send(JSON.stringify({ hello: { proto: PROTO, pin: 'town', name, key, sig } })) } catch { pc.close(); return { ...out, why: 'closed before its hello' } }
  for (let i = 0; i < 100 && !heard.length; i++) await wait(20)
  const first = heard.shift()
  if (!first?.welcome) { pc.close(); return { ...out, why: first?.refuse?.why ?? 'no answer' } }
  const beat = setInterval(() => { try { ch.ctl.send(JSON.stringify({ ping: 1 })) } catch { clearInterval(beat) } }, 2000)
  return { ...out, you: first.welcome.you, ms: Date.now() - t0, close: () => { clearInterval(beat); pc.close() } }
}
const QUIET = ['silent', 'unopened', 'ctl', 'garbled']
/** This machine's addresses other than loopback (the door's answer names no loopback candidate). */
const mine = Object.values(networkInterfaces()).flat().filter((i) => !i.internal && (i.family === 'IPv4' || !/^fe80/i.test(i.address))).map((i) => i.address)

try {
  // Two players in: of six ports, four are left for joins waiting.
  const ada = await wire('Ada'), cleo = await wire('Cleo')
  check(!!ada.you && !!cleo.you, `two players are in (${ada.you ?? ada.why}, ${cleo.you ?? cleo.why})`)

  // ── Nine joins that say nothing, then one that says hello ──
  // From two addresses where there are two, so the four places fill without one address's limit and every join after
  // them has to take the place of one waiting.
  for (let round = 0; round < ROUNDS; round++) {
    const quiet = []
    for (let i = 0; i < 9; i++) quiet.push(await wire('Quiet', { as: 'silent', from: mine.length >= 2 ? mine[i % 2] : null }))
    const fern = await wire('Fern')
    const answered = quiet.filter((q) => q.status === 200 && !q.why).length
    check(answered === 9 && !!fern.you && fern.ms <= BOUND, `round ${round + 1}: nine silent joins are all answered (${answered}; ${[...new Set(quiet.map((q) => q.why).filter(Boolean))].join('; ') || 'none refused'}), and Fern, who says hello at once, is let in (${fern.you ?? fern.why}) in ${fern.ms ?? '-'} ms (at most ${BOUND})`)
    fern.close(); for (const q of quiet) q.close()
    await wait(500)
  }

  // ── A trickle of joins that stall, every way, and players arriving through it ──
  {
    const end = Date.now() + TRICKLE, quiet = []
    let n = 0, refusedQuiet = 0
    const trickle = (async () => { while (Date.now() < end) { const q = await wire('Quiet', { as: QUIET[n++ % QUIET.length] }); if (q.why) refusedQuiet++; quiet.push(q); await wait(150) } })()
    const players = []
    await wait(1500)
    while (Date.now() < end - 1000) { const p = await wire(`Gil ${players.length + 1}`); players.push(p); p.close(); await wait(1200) }
    await trickle
    const late = players.filter((p) => !p.you || p.ms > BOUND)
    const ms = players.filter((p) => p.you).map((p) => p.ms).sort((a, b) => a - b)
    check(players.length >= 10 && !late.length, `while ${quiet.length} joins that stall arrive over ${TRICKLE / 1000} s (silent, never opened, one channel of three, garbled; ${refusedQuiet} of them refused), every one of ${players.length} players is let in within ${BOUND} ms (median ${ms[ms.length >> 1]} ms, worst ${ms.at(-1)} ms${late.length ? `; not: ${late.map((p) => p.why ?? `${p.ms} ms`).join('; ')}` : ''})`)
    for (const q of quiet) q.close()
    await wait(500)
  }

  // ── Offers at once ──
  {
    // Eight together (as many as the master lets wait on one host), for four places: each is answered and opens, or is
    // refused as busy. None is left without an answer for the master to give up on (504), and none is answered for a
    // connection the door has already let go (its channels would never open).
    const burst = await Promise.all(Array.from({ length: 8 }, () => wire('Quiet', { as: 'silent' })))
    const said = burst.map((b) => (b.why ? `${b.status} ${b.why}` : String(b.status)))
    const tally = Object.entries(said.reduce((t, w) => ({ ...t, [w]: (t[w] ?? 0) + 1 }), {})).map(([w, k]) => `${k} × ${w}`).join('; ')
    check(!burst.some((b) => b.status === 504 || (b.status === 200 && b.why)) && burst.filter((b) => b.status === 200).length >= 4, `eight offers at once each open or are refused, none left hanging or answered for nothing (${tally})`)
    for (const b of burst) b.close()
    // Sixty refused in a moment (an SDP the master takes and the door cannot): the door's replies are paced under the
    // master's 50 a second, so the master keeps the host, and its lobby keeps its id.
    // (Four kept connections, each sending one after another: the master takes eight at once from one address.)
    const agent = new Agent({ keepAlive: true, maxSockets: 4 }), body = JSON.stringify({ sdp: 'v=0\r\n' })
    const once = () => new Promise((done) => { const q = request(`${MASTER}/lobbies/${lobby}/join`, { method: 'POST', agent, headers: { 'content-length': Buffer.byteLength(body) } }, (r) => { r.resume(); r.on('end', () => done(r.statusCode)) }); q.on('error', () => done(0)); q.end(body) })
    // (A connection the master turns away, while the burst's own are still open, is tried again.)
    const post = async () => { for (let i = 0; i < 100; i++) { const status = await once(); if (status) return status; await wait(100) } return 0 }
    const t0 = Date.now(), bad = await Promise.all(Array.from({ length: 60 }, post)), took = Date.now() - t0
    agent.destroy()
    await wait(1500)
    const still = (await fetch(`${MASTER}/lobbies/${lobby}`)).status, after = await wire('Jun')
    check(bad.filter((b) => b === 409).length >= 40 && still === 200 && !!after.you, `sixty offers refused in ${took} ms (${Object.entries(bad.reduce((t, w) => ({ ...t, [w]: (t[w] ?? 0) + 1 }), {})).map(([w, k]) => `${k} × ${w}`).join(', ')}) leave the lobby listed as it was (${still}), and Jun joins after (${after.you ?? after.why})`)
    after.close()
    await wait(500)
  }

  // ── A flood from one address, and someone from another ──
  if (mine.length < 2) console.log(`  not run: a flood from one address beside another needs two addresses on this machine (${mine.length})`)
  else {
    const [a, b] = mine
    // Hana, from the second address, comes to the door in the middle of a flood from the first and has not said hello
    // (a page a moment from its hello): she is still there when the flood is over. (A join silent for 8 s is let go
    // whatever else is waiting, so she comes in the middle: twelve joins take 5 to 9 s here.)
    const flood = []
    for (let i = 0; i < 6; i++) flood.push(await wire('Flood', { as: 'silent', from: a }))
    const hana = await wire('Hana', { as: 'silent', from: b }), hanaAt = Date.now()
    for (let i = 0; i < 6; i++) flood.push(await wire('Flood', { as: 'silent', from: a }))
    await wait(500)
    const held = flood.filter((f) => f.open()).length, fromA = flood.every((f) => !f.local || f.local === a), hanaFrom = hana.local, waited = Date.now() - hanaAt
    check(fromA && hanaFrom === b && hana.open() && held <= 2, `twelve silent joins from one address hold ${held} places (at most 2, --waiting-per-address), and Hana's from another, at the door through the second half of it (${waited} ms), is still there (${hana.open()}; from ${hanaFrom === b ? 'her own address' : hanaFrom})`)
    const ivo = await wire('Ivo', { from: b })
    check(!!ivo.you && ivo.ms <= BOUND, `someone from that other address is let in at once (${ivo.you ?? ivo.why}, ${ivo.ms ?? '-'} ms)`)
    for (const f of flood) f.close()
    hana.close(); ivo.close?.()
  }
  ada.close(); cleo.close()
} catch (e) {
  failures.push(String(e?.stack ?? e))
}

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); finish(1) }
console.log('door-silent: ok')
finish(0)
