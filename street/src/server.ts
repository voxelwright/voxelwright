// The street's world process (#118 spike): it owns the one world (block.ts), steps it 60 times a
// second, and gives each WebTransport session a seat: a walker, the world's things on a
// reliable stream, and poses on datagrams. A spike: no sign-in and synthetic residents, so
// it listens on this machine only unless told a tailnet address, and never on every interface.
//
// Usage: node run.mjs [--port 4433] [--http 4434] [--host 127.0.0.1]... [--name host.ts.net]...
//          [--crates 120] [--balls 24] [--snap 30] [--awake]
import { Http3Server } from '@fails-components/webtransport'
import { createServer } from 'node:http'
import { loadavg } from 'node:os'
import { makeCert } from './cert.ts'
import { Block, FLOOR } from './block.ts'
import { DELAY, INPUT, PING, packSelf, packSnap, posesIn, unpackDelay, unpackInputs, type Line } from './wire.ts'

const args = process.argv.slice(2)
const all = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []))
const one = (name: string, otherwise: number) => Number(all(name)[0] ?? otherwise)
const hosts = all('host').length ? all('host') : ['127.0.0.1']
if (hosts.some((h) => h === '0.0.0.0' || h === '::')) throw new Error('The street has no sign-in yet: name an address (127.0.0.1 or a tailnet one), not every interface.')
const port = one('port', 4433), httpPort = one('http', 4434), snapEvery = Math.max(1, Math.round(60 / one('snap', 30)))
const MAX_SEATS = 16, TICK_MS = 1000 / 60

interface Writer { write(data: Uint8Array): Promise<void>; close(): Promise<void> }
/** A session as the transport library hands it over (its own types ask for options the probe in #81 never needed). */
interface Session {
  ready: Promise<unknown>
  closed: Promise<unknown>
  close(): void
  datagrams: { readable: ReadableStream<Uint8Array>; createWritable(): WritableStream<Uint8Array>; maxDatagramSize: number }
  createUnidirectionalStream(): Promise<WritableStream<Uint8Array>>
}
interface Seat { id: number; datagrams: Writer; lines: Writer; room: number; delay: number; jitter: number; out: number; in: number; gone: boolean }

const sim = await Block.make({ crates: one('crates', 120), balls: one('balls', 24), awake: args.includes('--awake') })
const seats = new Map<number, Seat>()
const text = new TextEncoder()
const late: number[] = []

/** Now, or after the seat's test delay. */
const later = (seat: Seat, run: () => void) => (seat.delay || seat.jitter ? void setTimeout(run, Math.max(0, seat.delay + (Math.random() * 2 - 1) * seat.jitter)) : run())
function send(seat: Seat, data: Uint8Array) {
  later(seat, () => {
    if (seat.gone) return
    seat.out += data.byteLength
    seat.datagrams.write(data).catch(() => {})
  })
}
const say = (seat: Seat, line: Line) => void seat.lines.write(text.encode(JSON.stringify(line) + '\n')).catch(() => {})

async function sit(session: Session) {
  await session.ready
  if (seats.size >= MAX_SEATS) return session.close()
  const datagrams = session.datagrams.createWritable().getWriter()
  const lines = (await session.createUnidirectionalStream()).getWriter()
  const id = sim.join()
  const seat: Seat = { id, datagrams, lines, room: Math.min(1150, session.datagrams.maxDatagramSize || 1150), delay: 0, jitter: 0, out: 0, in: 0, gone: false }
  for (const other of seats.values()) say(other, { t: 'add', drawn: sim.drawnOf(id) })
  seats.set(id, seat)
  say(seat, { t: 'hello', you: id, tickHz: 60, snapHz: 60 / snapEvery, tick: sim.tick, floor: FLOOR, drawn: sim.drawn() })
  console.log(`seat ${id} sat down (${seats.size} here)`)
  const leave = () => {
    if (seat.gone) return
    seat.gone = true
    seats.delete(id)
    const toy = sim.toyOf(id)
    sim.leave(id)
    if (toy) for (const other of seats.values()) say(other, { t: 'remove', toy })
    console.log(`seat ${id} left (${seats.size} here)`)
  }
  session.closed.then(leave, leave)
  const reader = session.datagrams.readable.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      seat.in += value.byteLength
      const kind = value[0]
      // The delay knob itself is not delayed, or turning it down would wait for the old delay.
      if (kind === DELAY && value.byteLength >= 5) Object.assign(seat, { delay: unpackDelay(value).ms, jitter: unpackDelay(value).jitter })
      else if (kind === INPUT) later(seat, () => sim.input(id, unpackInputs(value)))
      else if (kind === PING) later(seat, () => send(seat, value))
    }
  } catch { /* the session ended */ }
  leave()
}

const { cert, privKey, hash } = makeCert(new URL('..', import.meta.url).pathname, [...hosts, ...all('name')])
for (const host of hosts) {
  const server = new Http3Server({ port, host, secret: crypto.randomUUID(), cert, privKey } as ConstructorParameters<typeof Http3Server>[0])
  const sessions = server.sessionStream('/street').getReader()
  server.startServer()
  await server.ready
  void (async () => { for (;;) { const { value, done } = await sessions.read(); if (done) break; sit(value as unknown as Session).catch((e) => console.error('seat failed:', e)) } })()
  console.log(`street: WebTransport on https://${host}:${port}/street`)
}

let next = performance.now()
function loop() {
  const now = performance.now()
  for (let n = 0; now >= next && n < 4; n++) {
    late.push(now - next)
    if (late.length > 3600) late.shift()
    sim.step()
    next += TICK_MS
    if (sim.tick % snapEvery === 0) snapshot()
  }
  if (now - next > 250) next = now
  setTimeout(loop, Math.max(0, next - performance.now()))
}
function snapshot() {
  if (!seats.size) return
  const poses = sim.poses()
  for (const seat of seats.values()) {
    const per = posesIn(seat.room)
    for (let i = 0; i < poses.length; i += per) send(seat, packSnap(sim.tick, poses.slice(i, i + per)))
    const self = sim.self(seat.id)
    if (self) send(seat, packSelf(self))
  }
}
loop()

const spread = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b), at = (q: number) => +(s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0).toFixed(3)
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1), n: s.length }
}
let rates: Record<number, { outBps: number; inBps: number }> = {}
setInterval(() => {
  rates = {}
  for (const seat of seats.values()) { rates[seat.id] = { outBps: seat.out, inBps: seat.in }; seat.out = seat.in = 0 }
}, 1000)

// Where the page finds the world, and how the world is doing. This machine only: the page's own server passes it on.
createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  if (req.url === '/where') return res.end(JSON.stringify({ port, hash }))
  if (req.url === '/stats') return res.end(JSON.stringify({ tick: sim.tick, awake: sim.awake(), stepMs: spread(sim.stepMs), lateMs: spread(late), seats: rates, load1: +loadavg()[0].toFixed(1) }))
  res.statusCode = 404
  res.end('{}')
}).listen(httpPort, '127.0.0.1', () => console.log(`street: /where and /stats on http://127.0.0.1:${httpPort}`))
