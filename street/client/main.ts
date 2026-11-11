// The street's page (#118). It draws the same toys the world process simulates: the engine's
// own World (home/src/engine/world.ts) runs here too, over a solver core that solves nothing
// (src/puppet.ts) and is posed from what the wire says. Other things are drawn a little in
// the past, between the two poses either side of that moment; your own walker is drawn where
// your inputs put it now (walk.ts's rule, run ahead of the world's answer) and put right when
// the answer differs. `?stop=1` makes it stop at things where they are drawn instead of
// walking into them. `?predict=0` draws your walker like everything else, to feel the
// difference; `?delay=50` holds everything 50 ms each way.
import * as THREE from 'three/webgpu'
import type { Quat, Vec3 } from '../../home/src/engine/core.ts'
import { World } from '../../home/src/engine/world.ts'
import { Puppet } from '../src/puppet.ts'
import { registerBlock } from '../src/scene.ts'
import { HALF_H, RADIUS, TICK, predict, type Input, type Walker } from '../src/walk.ts'
import { PING, SELF, SNAP, packDelay, packInputs, packPing, rounded, unpackPing, unpackSelf, unpackSnap, type Drawn, type Line, type Pose } from '../src/wire.ts'

const params = new URLSearchParams(location.search)
const PREDICT = params.get('predict') !== '0'
/** Your walker, drawn ahead, stops at things where they are drawn (`?stop=1`). Without it, it walks into them until the world's answer moves them. */
const STOP = PREDICT && params.get('stop') === '1'
let delay = Number(params.get('delay') ?? 0), jitter = Number(params.get('jitter') ?? 0)
const hud = document.getElementById('hud')!, knobs = document.getElementById('knobs')!

// ---- the picture
const renderer = new THREE.WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.1
renderer.shadowMap.enabled = params.get('shadows') !== '0'
renderer.shadowMap.type = THREE.PCFShadowMap
document.body.prepend(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbfd9ee)
scene.fog = new THREE.Fog(0xbfd9ee, 45, 110)
scene.add(new THREE.HemisphereLight(0xdcebff, 0x8a8f7a, 1.5))
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0008
sun.shadow.normalBias = 0.03
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 })
scene.add(sun, sun.target)
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
addEventListener('resize', resize)
resize()

// ---- the world as this page holds it: the engine's World, posed and never stepped
registerBlock()
const puppet = new Puppet()
let world: World | null = null
interface Sample { tick: number; p: Vec3; q: Quat }
/** A moving part: its body in the puppet, its poses as heard, and where it is drawn now. */
interface View { key: string; id: number; body: number; kind: 'crate' | 'ball' | 'walker'; reach: number; samples: Sample[]; p: Vec3; q: Quat; shown: THREE.Vector3 }
const views = new Map<number, View>()
let you = 0, snapEvery = 2
function build(drawn: Drawn) {
  const first = puppet.size
  world!.addToy(drawn.toy)
  drawn.toy.parts.forEach((part, i) => {
    const id = drawn.ids[part.id], pose = drawn.poses[part.id]
    if (id === undefined || !pose) return
    const shape = part.shape
    const view: View = {
      key: `${drawn.toy.id}/${part.id}`, id, body: first + i,
      kind: shape.kind === 'sphere' ? 'ball' : shape.kind === 'capsule' ? 'walker' : 'crate',
      reach: shape.kind === 'box' ? shape.half[0] : shape.kind === 'compound' ? 0.3 : shape.radius,
      samples: [{ tick: 0, p: pose.p, q: pose.q }], p: [...pose.p], q: [...pose.q], shown: new THREE.Vector3(...pose.p),
    }
    puppet.pose(view.body, view.p, view.q)
    views.set(id, view)
  })
}
function remove(toy: string) {
  for (const [id, view] of views) if (view.key.startsWith(`${toy}/`)) views.delete(id)
  world!.removeToy(toy)
}
function heard(pose: Pose, tick: number) {
  const view = views.get(pose.id)
  if (!view) return
  const s = view.samples
  if (s.some((x) => x.tick === tick)) return
  s.push({ tick, p: pose.p, q: pose.q })
  s.sort((a, b) => a.tick - b.tick)
  if (s.length > 6) s.shift()
}

// ---- the world's clock, as this page hears it: the tick the world is at now
let clock: { tick: number; at: number } | null = null
function clockHeard(tick: number, now: number) {
  if (!clock) { clock = { tick, at: now }; return }
  const expected = clock.tick + (now - clock.at) * 0.06
  // A snapshot that arrives early pulls the clock at once (the world is at least there); late ones barely.
  clock = { tick: expected + (tick - expected) * (tick > expected ? 0.5 : 0.02), at: now }
}
const worldTick = (now: number) => (clock ? clock.tick + (now - clock.at) * 0.06 : 0)

// ---- your own walker
let me: Walker | null = null
let pending: Input[] = []
let seq = 0, lastSelf = 0
const offset = new THREE.Vector3()
const fixes: number[] = []
/** One tick of your walker, ahead of the answer. With STOP it does not walk into a crate or a ball where that is drawn: it is pushed back out sideways and loses its speed into it. */
function ahead(w: Walker, input: Input): Walker {
  const next = predict(w, input)
  if (!STOP) return next
  for (const view of views.values()) {
    if (view.kind === 'walker') continue
    const r = RADIUS + view.reach, dx = next.p[0] - view.shown.x, dz = next.p[2] - view.shown.z, d = Math.hypot(dx, dz)
    if (d >= r || d < 1e-6 || Math.abs(next.p[1] - view.shown.y) > HALF_H + RADIUS + view.reach * 0.5) continue
    const nx = dx / d, nz = dz / d, into = Math.min(0, next.v[0] * nx + next.v[2] * nz)
    next.p[0] = view.shown.x + nx * r
    next.p[2] = view.shown.z + nz * r
    next.v[0] -= into * nx
    next.v[2] -= into * nz
  }
  return next
}
function selfHeard(data: Uint8Array) {
  const s = unpackSelf(data)
  if (s.tick <= lastSelf) return
  lastSelf = s.tick
  if (!PREDICT) return
  const before = me?.p
  pending = pending.filter((input) => input.seq > s.ack)
  let w: Walker = { p: s.p, v: s.v, hop: s.hop, grounded: s.grounded }
  for (const input of pending) w = ahead(w, input)
  if (before) {
    const fix = Math.hypot(w.p[0] - before[0], w.p[1] - before[1], w.p[2] - before[2])
    fixes.push(fix)
    if (fixes.length > 6000) fixes.shift()
    // The picture keeps where it was and eases to the corrected place.
    if (fix < 3) offset.add(new THREE.Vector3(before[0] - w.p[0], before[1] - w.p[1], before[2] - w.p[2]))
    else offset.set(0, 0, 0)
  }
  me = w
}

// ---- input
const held = new Set<string>()
let jump = false, yaw = 0
const stick = { id: -1, x0: 0, y0: 0, x: 0, z: 0 }, look = { id: -1, x: 0, moved: 0, at: 0 }
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) jump = true; held.add(e.code); if (['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault() })
addEventListener('keyup', (e) => held.delete(e.code))
addEventListener('blur', () => held.clear())
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && e.clientX < innerWidth / 2 && stick.id < 0) Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, z: 0 })
  else if (look.id < 0) Object.assign(look, { id: e.pointerId, x: e.clientX, moved: 0, at: performance.now() })
})
addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) { stick.x = Math.max(-1, Math.min(1, (e.clientX - stick.x0) / 50)); stick.z = Math.max(-1, Math.min(1, (stick.y0 - e.clientY) / 50)) }
  if (e.pointerId === look.id) { yaw -= (e.clientX - look.x) * 0.006; look.moved += Math.abs(e.clientX - look.x); look.x = e.clientX }
})
const lift = (e: PointerEvent) => {
  if (e.pointerId === stick.id) Object.assign(stick, { id: -1, x: 0, z: 0 })
  if (e.pointerId === look.id) { if (e.pointerType === 'touch' && look.moved < 8 && performance.now() - look.at < 300) jump = true; look.id = -1 }
}
addEventListener('pointerup', lift)
addEventListener('pointercancel', lift)
/** This tick's input, in the world's axes: forward is where the camera looks. */
function sample(): Input {
  const f = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) + stick.z
  const r = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0) + stick.x
  const s = Math.sin(yaw), c = Math.cos(yaw)
  const input = rounded({ seq: ++seq, x: f * s - r * c, z: f * c + r * s, jump })
  jump = false
  return input
}

// ---- the wire
/** Sits down, or says on the page why not: a phone has no console to read. */
async function connect() {
  if (typeof WebTransport !== 'function') throw new Error('this browser has no WebTransport')
  await renderer.init()
  const where = await (await fetch('/where')).json() as { port: number; hash: number[] }
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
  const url = `https://${host}:${params.get('port') ?? where.port}/street`
  hud.textContent = `finding the street at ${url}…`
  const wt = new WebTransport(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: new Uint8Array(where.hash) }] })
  await Promise.race([wt.ready, new Promise((_, no) => setTimeout(() => no(new Error(`no answer from ${url} in 8 s (is UDP ${where.port} reachable from here?)`)), 8000))])
  return wt
}
const wt = await connect().catch((e) => {
  hud.textContent = `could not reach the street\n${e instanceof Error ? e.message : String(e)}\nWebTransport here: ${typeof WebTransport === 'function' ? 'yes' : 'no'} · ${navigator.userAgent.replace(/^.*?\) /, '')}`
  hud.style.whiteSpace = 'pre-wrap'
  throw e
})
const dg = wt.datagrams as unknown as { createWritable?: () => WritableStream<Uint8Array>; writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }
const out = (dg.createWritable?.() ?? dg.writable).getWriter()
let up = 0, down = 0, snaps = 0, rtt = 0
/** Snapshot ticks heard, to count the ones that never came. */
const ticks = { first: 0, last: 0, heard: new Set<number>() }
const send = (data: Uint8Array) => { up += data.byteLength; out.write(data).catch(() => {}) }
const setDelay = (ms: number, j = jitter) => { delay = ms; jitter = j; for (let i = 0; i < 3; i++) send(packDelay(ms, j)) }
if (delay || jitter) setDelay(delay, jitter)

void (async () => {
  const stream = (await wt.incomingUnidirectionalStreams.getReader().read()).value as ReadableStream<Uint8Array>
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader()
  let rest = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const lines = (rest + value).split('\n')
    rest = lines.pop()!
    for (const text of lines) {
      const line = JSON.parse(text) as Line
      if (line.t === 'hello') {
        world = new World(puppet, () => {}, undefined, line.floor)
        scene.add(world.group)
        snapEvery = Math.round(line.tickHz / line.snapHz)
        line.drawn.forEach(build)
        you = line.you
        me = { p: [...views.get(you)!.p], v: [0, 0, 0], hop: 0, grounded: true }
      } else if (line.t === 'add') build(line.drawn)
      else remove(line.toy)
    }
  }
})()
void (async () => {
  const reader = dg.readable.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const now = performance.now()
    down += value.byteLength
    if (value[0] === SNAP) {
      const snap = unpackSnap(value)
      snaps++
      clockHeard(snap.tick, now)
      ticks.first ||= snap.tick
      ticks.last = Math.max(ticks.last, snap.tick)
      ticks.heard.add(snap.tick)
      for (const pose of snap.poses) heard(pose, snap.tick)
    } else if (value[0] === SELF) selfHeard(value)
    else if (value[0] === PING) { const r = now - unpackPing(value); rtt = rtt ? rtt + (r - rtt) * 0.2 : r }
  }
  hud.textContent = 'the street closed'
})()
setInterval(() => send(packPing(performance.now())), 250)

// ---- every frame
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion()
const frames: number[] = [], works: number[] = []
let last = performance.now(), owed = 0, lastSecond = last, rates = { up: 0, down: 0, snaps: 0 }
/** Puts a view where it was at a world tick: between the samples either side, or the nearest one. */
function poseAt(view: View, tick: number) {
  const s = view.samples
  let b = s.findIndex((x) => x.tick >= tick)
  if (b < 0) b = s.length - 1
  const a = Math.max(0, b - 1), A = s[a], B = s[b]
  const k = B.tick > A.tick ? Math.max(0, Math.min(1, (tick - A.tick) / (B.tick - A.tick))) : 1
  for (let i = 0; i < 3; i++) view.p[i] = A.p[i] + (B.p[i] - A.p[i]) * k
  qa.set(...A.q).slerp(qb.set(...B.q), k)
  view.q[0] = qa.x; view.q[1] = qa.y; view.q[2] = qa.z; view.q[3] = qa.w
}
function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.1, (now - last) / 1000)
  frames.push(now - last)
  last = now
  if (!world) return
  const t0 = performance.now()
  if (held.has('KeyQ') || held.has('ArrowLeft')) yaw += dt * 2
  if (held.has('KeyE') || held.has('ArrowRight')) yaw -= dt * 2
  if (me) for (owed += dt; owed >= TICK; owed -= TICK) {
    const input = sample()
    pending.push(input)
    if (pending.length > 180) pending.shift()
    if (PREDICT) me = ahead(me, input)
    send(packInputs(pending.slice(-3).reverse()))
  }
  // Others are drawn two snapshots back, so there is nearly always a pose either side.
  const then = worldTick(now) - snapEvery * 2 - jitter * 0.06
  for (const view of views.values()) {
    if (view.id === you && PREDICT && me) {
      offset.multiplyScalar(Math.exp(-dt * 12))
      view.p[0] = me.p[0] + offset.x; view.p[1] = me.p[1] + offset.y; view.p[2] = me.p[2] + offset.z
    } else poseAt(view, then)
    view.shown.set(view.p[0], view.p[1], view.p[2])
  }
  // The engine draws: its meshes go where the puppet's bodies now are.
  world.frame(dt)
  const mine = views.get(you)
  if (mine) {
    const s = Math.sin(yaw), c = Math.cos(yaw)
    camera.position.set(mine.shown.x - s * 7, mine.shown.y + 3.4, mine.shown.z - c * 7)
    camera.lookAt(mine.shown.x, mine.shown.y + 0.8, mine.shown.z)
    sun.target.position.copy(mine.shown)
    sun.position.set(mine.shown.x + 9, mine.shown.y + 22, mine.shown.z - 7)
  }
  renderer.render(scene, camera)
  works.push(performance.now() - t0)
  if (frames.length > 600) { frames.shift(); works.shift() }
  if (now - lastSecond >= 1000) {
    const k = 1000 / (now - lastSecond)
    rates = { up: up * k, down: down * k, snaps: snaps * k }
    up = down = snaps = 0
    lastSecond = now
    const st = stats()
    hud.textContent = `round trip ${st.rttMs} ms${delay ? ` (held ${delay} ms each way)` : ''} · ${views.size} moving things · drawn with ${st.backend}\ndown ${(rates.down / 1000).toFixed(1)} kB/s · up ${(rates.up / 1000).toFixed(1)} kB/s · frame ${st.frameMs.p50} ms (p95 ${st.frameMs.p95}), page work ${st.workMs.p50} ms\nyour walker: ${PREDICT ? `ahead of the answer${STOP ? ', stops at things' : ''}, put right by ${st.fixMm.p50} mm (p95 ${st.fixMm.p95})` : 'drawn from the answer'}`
  }
}
const spread = (values: number[], digits = 1) => {
  const s = [...values].sort((a, b) => a - b), at = (f: number) => +(s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0).toFixed(digits)
  return { p50: at(0.5), p95: at(0.95), max: at(1), n: s.length }
}
function stats() {
  const due = ticks.first ? (ticks.last - ticks.first) / snapEvery + 1 : 0
  return { rttMs: Math.round(rtt), snapshotsLostPct: due ? +((1 - ticks.heard.size / due) * 100).toFixed(2) : 0, downBps: Math.round(rates.down), upBps: Math.round(rates.up), datagramsPerS: Math.round(rates.snaps), frameMs: spread(frames), workMs: spread(works, 2), fixMm: spread(fixes.map((f) => f * 1000)), things: views.size, predict: PREDICT, stop: STOP, delay, jitter, backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2' }
}
requestAnimationFrame(frame)

// ---- the test knobs, folded away until asked for
const knob = (label: string, pressed: boolean, tap: () => void, group = '') => {
  const b = document.createElement('button')
  b.textContent = label
  b.setAttribute('aria-pressed', String(pressed))
  if (group) b.dataset.group = group
  b.onclick = tap
  knobs.append(b)
  return b
}
const reload = (key: string, value: string) => { params.set(key, value); params.set('delay', String(delay)); location.search = params.toString() }
for (const ms of [0, 25, 50, 100]) {
  const b = knob(ms ? `hold ${ms} ms` : 'no delay', ms === delay, () => { setDelay(ms); for (const x of knobs.querySelectorAll('button[data-group="delay"]')) x.setAttribute('aria-pressed', String(x === b)) }, 'delay')
}
knob(PREDICT ? 'walker ahead' : 'walker from the answer', PREDICT, () => reload('predict', PREDICT ? '0' : '1'))
if (PREDICT) knob('stops at things', STOP, () => reload('stop', STOP ? '0' : '1'))
document.getElementById('more')!.onclick = () => document.body.classList.toggle('open')

// For the two-browser check (test/two.ts): what this page sees, and probes that time what a hand would feel.
const shownOf = (id: number) => views.get(id)?.shown.toArray() ?? null
/** ms from a key going down to the first frame your walker is drawn somewhere else. */
function keyToMotion(code = 'KeyW'): Promise<number> {
  const start = views.get(you)!.shown.clone(), t0 = performance.now()
  held.add(code)
  return new Promise((resolve) => {
    const look = () => {
      if (views.get(you)!.shown.distanceTo(start) > 0.01) { held.delete(code); resolve(performance.now() - t0) }
      else if (performance.now() - t0 > 3000) { held.delete(code); resolve(-1) }
      else requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
}
/** Walk with `code` held until your walker is drawn touching a crate, then ms until that crate is drawn moving, and how deep the walker was drawn inside it. */
function pushCrate(code = 'KeyW'): Promise<{ touchToMoveMs: number; deepestMm: number } | null> {
  const t0 = performance.now()
  let touched: { view: View; at: number; from: THREE.Vector3 } | null = null, deepest = 0
  held.add(code)
  return new Promise((resolve) => {
    const look = () => {
      const mine = views.get(you)!.shown
      if (!touched) {
        for (const view of views.values()) {
          if (view.kind !== 'crate' || Math.abs(view.shown.y - mine.y) > 0.6) continue
          if (Math.hypot(view.shown.x - mine.x, view.shown.z - mine.z) < RADIUS + view.reach + 0.01) { touched = { view, at: performance.now(), from: view.shown.clone() }; break }
        }
      } else {
        deepest = Math.max(deepest, RADIUS + touched.view.reach - Math.hypot(touched.view.shown.x - mine.x, touched.view.shown.z - mine.z))
        if (touched.view.shown.distanceTo(touched.from) > 0.02) { held.delete(code); return resolve({ touchToMoveMs: performance.now() - touched.at, deepestMm: deepest * 1000 }) }
      }
      if (performance.now() - t0 > 8000) { held.delete(code); return resolve(null) }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
}
Object.assign(window, { __street: { stats, shownOf, keyToMotion, pushCrate, setDelay, hold: (code: string, down: boolean) => (down ? held.add(code) : held.delete(code)), census: () => world?.census(), get you() { return you }, get ready() { return you > 0 && clock !== null }, clearFixes: () => { fixes.length = 0 } } })
