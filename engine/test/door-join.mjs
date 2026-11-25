// What a join through a dedicated server's door carries (#526): the bytes a page is sent before it is "now" in the
// world (the world's stream, from what is kept to the frame that says it has all of it), by kind of frame, and how
// long that took on this machine; for a freshly released world and for one with 100 made things and 500 edits.
// Not a check: it prints what it measured. A browser pulls 6 to 15 Mbps down a data channel across a real network
// (the lobby-transport skill), so the seconds there are worked out from the bytes at those speeds.
//
//   node test/door-join.mjs [--release dist-sf]
//
// Ports: 6001 the master, 6002 the world's server, UDP 6004 to 6009.
import { spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, here } from './kit.mjs'
import { PROTO, fingerprintOf, signed } from '../page/wire.ts'

const { RTCPeerConnection } = await import('node-datachannel/polyfill')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const folder = resolve(here, arg('release', 'dist-sf'))
const scratch = mkdtempSync(join(tmpdir(), 'engine-door-join-'))
const file = join(scratch, 'world.log')
const MASTER = 'http://127.0.0.1:6001', WORLD = 'http://127.0.0.1:6002'
const stops = []
const masterDir = resolve(here, '..', 'master'), binary = join(masterDir, 'target', 'release', 'village-master')
if (!existsSync(binary) && spawnSync('cargo', ['build', '--release', '--quiet'], { cwd: masterDir, stdio: 'inherit' }).status !== 0) process.exit(1)
const master = spawn(binary, ['--listen', '127.0.0.1:6001', '--registrations-per-minute', '100', '--joins-per-minute', '1000'], { stdio: 'ignore' })
stops.push(() => master.kill('SIGINT'))
for (let i = 0; ; i++) { try { await fetch(MASTER); break } catch { if (i > 100) throw new Error('no master'); await wait(100) } }
async function dedicated() {
  const p = spawn('node', ['server.mjs', '--world', file, '--release', folder, '--port', '6002', '--master', MASTER, '--name', 'Measure', '--ice-ports', '6004-6009'], { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  const id = await new Promise((done) => p.stdout.on('data', (d) => { out += d; const m = /lobby ([0-9a-z]{12})/.exec(out); if (m) done(m[1]) }))
  return { id, stop: () => new Promise((done) => { p.on('exit', done); p.kill('SIGINT') }) }
}
const NAMES = { 1: 'log (the core\'s words)', 2: 'state', 3: 'echo (asks as done)', 4: 'now', 5: 'here', 7: 'living', 8: 'offers', 9: 'shown', 11: 'plugged', 12: 'bodies', 14: 'ground' }
/** Joins as a page does and reads the stream to its NOW frame: bytes by kind, and ms from the offer to NOW. */
async function measured(lobby) {
  const t0 = performance.now()
  const pc = new RTCPeerConnection({ iceServers: [] })
  const ch = { ctl: pc.createDataChannel('ctl'), down: pc.createDataChannel('down'), up: pc.createDataChannel('up') }
  await pc.setLocalDescription(await pc.createOffer())
  await wait(300)
  const r = await (await fetch(`${MASTER}/lobbies/${lobby}/join`, { method: 'POST', body: JSON.stringify({ sdp: pc.localDescription.sdp }) })).json()
  await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp })
  await Promise.all(Object.values(ch).map((c) => (c.readyState === 'open' ? null : new Promise((done) => c.addEventListener('open', done, { once: true })))))
  const opened = performance.now()
  const ground = await (await fetch(`${WORLD}/world/ground`)).json()
  await new Promise((done) => { ch.ctl.addEventListener('message', done, { once: true }); const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' }), key = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), sig = sign('sha256', Buffer.from(signed(fingerprintOf(r.sdp))), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64'); ch.ctl.send(JSON.stringify({ hello: { proto: PROTO, pin: ground.release, name: 'Gauge', key, sig } })) })
  const by = {}
  let held = Buffer.alloc(0), wire = 0
  const now = new Promise((done) => {
    ch.down.addEventListener('message', (e) => {
      wire += e.data.byteLength
      held = Buffer.concat([held, Buffer.from(e.data, 4)])
      let at = 0
      while (held.length - at >= 12) {
        const kind = held.readUInt32LE(at), size = held.readUInt32LE(at + 8)
        if (held.length - at < 12 + size) break
        by[kind] = (by[kind] ?? 0) + 12 + size
        at += 12 + size
        if (kind === 4) done()
      }
      held = held.subarray(at)
    })
  })
  ch.up.send(JSON.stringify({ n: 0, m: 'GET', p: '/world/stream?from=0', k: 0 }))
  await now
  const ms = performance.now() - t0
  pc.close()
  return { ms: Math.round(ms), openMs: Math.round(opened - t0), wire, by }
}
const say = (what, m) => {
  const mb = (b) => (b < 1 << 20 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 2 ** 20).toFixed(2)} MB`)
  console.log(`${what}: ${mb(m.wire)} on the wire before "now", ${m.ms} ms on this machine (channels open at ${m.openMs} ms); at 6 to 15 Mbps that is ${((m.wire * 8) / 15e6).toFixed(1)} to ${((m.wire * 8) / 6e6).toFixed(1)} s`)
  for (const [k, b] of Object.entries(m.by).sort((a, b) => b[1] - a[1])) console.log(`    ${NAMES[k] ?? k}: ${mb(b)}`)
}

let server = await dedicated()
say('a fresh released world', await measured(server.id))
// 100 made things (a box of 10 a side, rows of cells as a model's would be) and 500 edits (balls of brick), asked of
// the world on this machine at the pace its server takes them.
const ground = await (await fetch(`${WORLD}/world/ground`)).json()
const [ax, , az] = ground.arrive.at.map(Math.round)
const base = (await (await fetch(`${WORLD}/world/at?x=${ax}&y=0&z=${az}`)).json()).ground + 1
const post = (body) => fetch(`${WORLD}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'gauge', ...body }) })
for (let i = 0; i < 100; i++) {
  const x0 = ax - 500 + (i % 10) * 40, z0 = az - 500 + Math.floor(i / 10) * 40, rows = []
  for (let y = 0; y < 10; y++) for (let z = 0; z < 10; z++) rows.push(x0, x0 + 10, base + y, z0 + z, 8 + 256 * (1 + (i % 20)))
  const r = await post({ edit: [1, rows.length / 5, ...rows], release: [x0, base, z0], thing: { id: `box-${i}`, name: 'a box', wish: 'a box of bricks', at: [x0 + 5, base, z0 + 5], size: [10, 10, 10], facing: 'north' }, wait: true })
  if (!r.ok) throw new Error(`thing ${i}: ${r.status} ${await r.text()}`)
}
for (let i = 0; i < 500; i++) {
  const r = await post({ edit: [0, ax + 300 + (i % 25) * 8, base + 3, az + 300 + Math.floor(i / 25) * 8, 3, 8], release: [ax + 300, base, az + 300] })
  if (r.status === 429) { i--; await wait(1000); continue }
  if (!r.ok) throw new Error(`edit ${i}: ${r.status} ${await r.text()}`)
  await wait(20)
}
await wait(3000)
await server.stop()
server = await dedicated()
say('with 100 made things and 500 edits, after a restart', await measured(server.id))
await server.stop()
for (const s of stops) s()
rmSync(scratch, { recursive: true, force: true })
process.exit(0)
