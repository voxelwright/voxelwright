// The street's page (#118). It draws the same toys the world process simulates: the engine's
// own World (home/src/engine/world.ts) runs here too, over a solver core that solves nothing
// (src/puppet.ts) and is posed from what the wire says. Other things are drawn a little in
// the past, between the two poses either side of that moment; your own walker is drawn where
// your inputs put it now (walk.ts's rule, run ahead of the world's answer) and put right when
// the answer differs. `?stop=1` makes it stop at things where they are drawn instead of
// walking into them. `?predict=0` draws your walker like everything else, to feel the
// difference; `?delay=50` holds everything 50 ms each way.
import * as THREE from 'three/webgpu'
import { load, root, type Stage } from '../../home/src/kernel'
import { focusOn } from '../../home/src/lens'
import atmosphere from '../../home/src/plugins/atmosphere'
import postfx from '../../home/src/plugins/postfx'
import rendererPlugin from '../../home/src/plugins/renderer'
import { SUN_DIRECTION } from '../../home/src/sky'
import type { Quat, Vec3 } from '../../home/src/engine/core.ts'
import { World } from '../../home/src/engine/world.ts'
import { place } from './place.ts'
import { Puppet } from '../src/puppet.ts'
import { resident, type Resident } from './figure.ts'
import { registerBlock } from '../src/scene.ts'
import { GRADE, HALF_L, HALF_W, NORMAL, heightAt } from '../src/ground.ts'
import { HALF_H, RADIUS, TICK, predict, standing, type Input, type Walker } from '../src/walk.ts'
import { PING, SELF, SNAP, packDelay, packInputs, packPing, rounded, unpackPing, unpackSelf, unpackSnap, type Ask, type Drawn, type Line, type Pose } from '../src/wire.ts'

const params = new URLSearchParams(location.search)
const PREDICT = params.get('predict') !== '0'
/** Your walker, drawn ahead, stops at things where they are drawn (`?stop=1`). Without it, it walks into them until the world's answer moves them. */
const STOP = PREDICT && params.get('stop') === '1'
let delay = Number(params.get('delay') ?? 0), jitter = Number(params.get('jitter') ?? 0)
const hud = document.getElementById('hud')!, knobs = document.getElementById('knobs')!

// ---- the picture: the home's own stage (its renderer with quality tiers, its sky, its post effects), with the street in it
load(rendererPlugin)
const stage = await new Promise<Stage>((resolve) => {
  const look = () => { const s = root.get('stage') as Stage | undefined; if (s) resolve(s); else setTimeout(look, 10) }
  look()
})
// `?post=0` and `?sky=0` leave one out, to see what each costs and adds.
if (params.get('post') !== '0') load(postfx)
if (params.get('sky') !== '0') load(atmosphere)
const { renderer, scene, camera } = stage
camera.far = 1200
// A tall screen (a phone held upright) sees a narrow slice at the same lens, so it gets a wider one.
const lens = () => { camera.fov = innerWidth < innerHeight ? 72 : 50; camera.updateProjectionMatrix() }
lens()
addEventListener('resize', lens)
// The sun stands where the sky says it does. Its shadow box holds the whole block and never moves, so no shadow starts or stops as you walk.
const SHADOW = 40
const sun = new THREE.DirectionalLight('#ffe2b8', 3.1)
sun.castShadow = true
sun.shadow.mapSize.set(stage.quality === 'low' ? 1024 : 2048, stage.quality === 'low' ? 1024 : 2048)
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.03
sun.shadow.radius = 3
Object.assign(sun.shadow.camera, { left: -SHADOW, right: SHADOW, top: SHADOW, bottom: -SHADOW, near: 1, far: 170 })
sun.position.copy(SUN_DIRECTION).multiplyScalar(85)
scene.add(sun, sun.target, new THREE.HemisphereLight('#e3ecfb', '#c9b89a', 1.7))
// The hill, the bay and the streets round the block: `?land=0` leaves them out.
const land = params.get('land') !== '0' ? place(scene) : null

// ---- the world as this page holds it: the engine's World, posed and never stepped
registerBlock()
const puppet = new Puppet()
let world: World | null = null
interface Sample { tick: number; p: Vec3; q: Quat }
/** A moving part: its body in the puppet, its poses as heard, and where it is drawn now. */
interface View { key: string; id: number; body: number; kind: 'crate' | 'ball' | 'walker'; reach: number; samples: Sample[]; p: Vec3; q: Quat; shown: THREE.Vector3; figure?: Resident }
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
    if (view.kind === 'walker') {
      headOf(id).name.textContent = drawn.toy.label
      // The body the world simulates is a capsule; what is drawn in its place is a resident (figure.ts).
      const capsule = world!.mesh(view.key)
      if (capsule) capsule.visible = false
      view.figure = resident(Number(/\d+/.exec(drawn.toy.id)?.[0] ?? 1) - 1, part.paint ?? '#c8553d', stage.features().has('phys'))
      scene.add(view.figure.root)
    }
  })
}
function remove(toy: string) {
  for (const [id, view] of views) if (view.key.startsWith(`${toy}/`)) { views.delete(id); view.figure?.dispose(); heads.get(id)?.el.remove(); heads.delete(id) }
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
/** The height the world last said your walker stands at when that is on some thing, not the bare ground: the guess keeps it up there. */
let platform = -Infinity
/** One tick of your walker, ahead of the answer. With STOP it does not walk into a crate or a ball where that is drawn: it is pushed back out sideways and loses its speed into it. */
function ahead(w: Walker, input: Input): Walker {
  const next = predict(w, input, platform)
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
  platform = s.grounded && s.p[1] - (heightAt(s.p[2]) + standing(NORMAL)) > 0.05 ? s.p[1] : -Infinity
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
const words = document.getElementById('words') as HTMLInputElement
addEventListener('keydown', (e) => {
  // Typing a sentence is not walking; Enter goes to the sentence, Escape back to the street.
  if (e.target === words) { if (e.code === 'Escape') words.blur(); return }
  if (e.code === 'Enter') { words.focus(); e.preventDefault(); return }
  if (e.code === 'Space' && !e.repeat) jump = true
  held.add(e.code)
  if (['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
})
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
/** What this page asks of the world goes up its own reliable stream, a line of JSON each. */
const asks = (await wt.createUnidirectionalStream()).getWriter()
const encoder = new TextEncoder()
const ask = (line: Ask) => void asks.write(encoder.encode(JSON.stringify(line) + '\n')).catch(() => {})

// ---- names and words over heads, and the shimmer where a thing is on its way
/** Over each resident's head: their name, and for a while what they said or what was made for them. */
const heads = new Map<number, { el: HTMLDivElement; name: HTMLSpanElement; words: HTMLDivElement; until: number }>()
function headOf(by: number) {
  let h = heads.get(by)
  if (!h) {
    const el = document.createElement('div'), words = document.createElement('div'), name = document.createElement('span')
    el.className = 'head'
    name.className = 'name'
    words.hidden = true
    el.append(words, name)
    document.body.append(el)
    heads.set(by, (h = { el, name, words, until: 0 }))
  }
  return h
}
function bubble(by: number, text: string, kind: 'said' | 'making' | 'made' | 'sorry', seconds = 6) {
  const h = headOf(by)
  h.words.className = `bubble ${kind}`
  h.words.textContent = text
  h.words.hidden = false
  h.until = performance.now() + seconds * 1000
}
const shimmers = new Map<number, THREE.Mesh>()
const shimmerLook = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.45, depthWrite: false })
function shimmer(by: number, at: Vec3 | null) {
  const old = shimmers.get(by)
  if (old) { scene.remove(old); old.geometry.dispose(); shimmers.delete(by) }
  if (!at) return
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), shimmerLook)
  mesh.position.set(at[0], at[1] + 1, at[2])
  scene.add(mesh)
  shimmers.set(by, mesh)
}
function told(line: Exclude<Line, { t: 'hello' | 'add' | 'remove' }>) {
  if (line.t === 'said') bubble(line.by, line.text, 'said')
  else if (line.t === 'making') { bubble(line.by, `${line.text}…`, 'making', 120); shimmer(line.by, line.at) }
  else if (line.t === 'made') { bubble(line.by, line.say, line.ok ? 'made' : 'sorry', line.ok ? 5 : 8); shimmer(line.by, null) }
  else if (line.t === 'named') headOf(line.by).name.textContent = line.name
  else invited(line)
}
/** A key for an agent of yours: shown to you alone, in the workshop panel, with the command that hands it over. */
function invited(line: Extract<Line, { t: 'key' }>) {
  const box = document.getElementById('invite')!
  box.hidden = false
  box.querySelector('code')!.textContent = line.command
  document.body.classList.add('open')
}

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
        // Building a street's worth of meshes is a long task: the renderer must not read it as a slow GPU and drop a tier.
        const release = stage.hold()
        world = new World(puppet, () => {}, undefined, line.floor)
        scene.add(world.group)
        snapEvery = Math.round(line.tickHz / line.snapHz)
        line.drawn.forEach(build)
        release()
        you = line.you
        me = { p: [...views.get(you)!.p], v: [0, 0, 0], hop: 0, grounded: true }
      } else if (line.t === 'add') build(line.drawn)
      else if (line.t === 'remove') remove(line.toy)
      else told(line)
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
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), head = new THREE.Vector3()
/** How much the lens blurs what is far from where the view looks: the home's miniature look, `?lens=0.5` for a picture. Walking about, everything is sharp. */
const LENS = Number(params.get('lens') ?? 0)
/** How far behind you the camera rides, how much of that it has now (1 is all of it), and how far from the street's middle it may stand: short of the fronts, and out onto the street across each end. */
const BOOM = 7, INSIDE_X = HALF_W - 0.7, INSIDE_Z = HALF_L * Math.cos(Math.atan(GRADE)) + 2
let boom = 1
/** A camera put somewhere by hand, for pictures (test/gallery.ts); null follows your walker. */
let fixed: { from: Vec3; to: Vec3 } | null = null
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
    view.figure?.update(view.shown, dt)
  }
  // The engine draws: its meshes go where the puppet's bodies now are.
  world.frame(dt)
  const mine = views.get(you)
  if (fixed) {
    camera.position.set(...fixed.from)
    camera.lookAt(...fixed.to)
    focusOn(Math.hypot(fixed.from[0] - fixed.to[0], fixed.from[1] - fixed.to[1], fixed.from[2] - fixed.to[2]), 0.3, LENS)
  } else if (mine) {
    // The camera rides seven metres behind you, and stays inside the street: where a wall is nearer than that it comes in closer and lower, over your shoulder.
    const bx = -Math.sin(yaw) * BOOM, bz = -Math.cos(yaw) * BOOM
    const room = (from: number, by: number, most: number) => (by > 0 ? (most - from) / by : by < 0 ? (-most - from) / by : 1)
    const fits = Math.max(0.3, Math.min(1, room(mine.shown.x, bx, INSIDE_X), room(mine.shown.z, bz, INSIDE_Z)))
    boom = fits < boom ? fits : boom + (fits - boom) * (1 - Math.exp(-dt * 5))
    camera.position.set(mine.shown.x + bx * boom, mine.shown.y + 1.7 + 1.7 * boom, mine.shown.z + bz * boom)
    // It looks a little past you, so the street ahead and the sky over it are in the picture.
    const past = (4 * boom) / BOOM
    camera.lookAt(mine.shown.x - bx * past, mine.shown.y + 1 + 0.2 * (1 - boom), mine.shown.z - bz * past)
    focusOn(camera.position.distanceTo(mine.shown), 0.3, LENS)
  }
  // The stage draws after this; names are placed with the camera as it now stands.
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  for (const mesh of shimmers.values()) { mesh.rotation.y += dt * 1.8; mesh.rotation.x += dt * 0.7; mesh.scale.setScalar(1 + 0.25 * Math.sin(now / 180)) }
  // A name, and words for a while, stand over each resident's head while they are in front of the camera.
  for (const [by, h] of heads) {
    const view = views.get(by)
    if (!view) continue
    if (!h.words.hidden && now > h.until) h.words.hidden = true
    head.set(view.shown.x, view.shown.y + 1.05, view.shown.z).project(camera)
    const seen = head.z < 1 && Math.abs(head.x) < 1.2 && (by !== you || !h.words.hidden)
    h.el.style.display = seen ? '' : 'none'
    if (seen) h.el.style.transform = `translate(-50%, -100%) translate(${((head.x + 1) / 2) * innerWidth}px, ${((1 - head.y) / 2) * innerHeight}px)`
  }
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
  return { rttMs: Math.round(rtt), snapshotsLostPct: due ? +((1 - ticks.heard.size / due) * 100).toFixed(2) : 0, downBps: Math.round(rates.down), upBps: Math.round(rates.up), datagramsPerS: Math.round(rates.snaps), frameMs: spread(frames), workMs: spread(works, 2), fixMm: spread(fixes.map((f) => f * 1000)), things: views.size, predict: PREDICT, stop: STOP, delay, jitter, backend: stage.backend, quality: stage.quality, landTriangles: land?.triangles ?? 0, gpuMs: spread(stage.timing.gpu.slice(-300), 2), cpuMs: spread(stage.timing.cpu.slice(-300), 2), tier: stage.timing.tierReason }
}
root.on('village/frame', () => frame(performance.now()))

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

// ---- the sentence: what you type is made, or said
let saying = false
const mode = document.getElementById('mode') as HTMLButtonElement
const setMode = (say: boolean) => { saying = say; mode.textContent = say ? 'say' : 'make'; words.placeholder = say ? 'say something…' : 'make anything: a big red dog, a bridge, a ladder…' }
mode.onclick = () => { setMode(!saying); words.focus() }
setMode(false)
const speak = (text: string, say = saying) => { if (text.trim()) ask(say ? { t: 'say', text } : { t: 'make', text, yaw }) }
;(document.getElementById('ask') as HTMLFormElement).onsubmit = (e) => {
  e.preventDefault()
  speak(words.value)
  words.value = ''
  words.blur()
}
document.getElementById('undo')!.onclick = () => ask({ t: 'unmake' })
document.getElementById('bring')!.onclick = () => ask({ t: 'key' })
document.getElementById('copy')!.onclick = () => void navigator.clipboard?.writeText(document.querySelector('#invite code')!.textContent ?? '')
// Your name: from the link (?name=), or the one this browser gave before.
const named = (params.get('name') ?? localStorage.getItem('street.name') ?? '').trim().slice(0, 24)
if (named) { localStorage.setItem('street.name', named); ask({ t: 'name', text: named }) }
document.getElementById('top')!.onclick = () => { ask({ t: 'top' }); pending = []; offset.set(0, 0, 0) }

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
Object.assign(window, { __street: { stats, shownOf, keyToMotion, pushCrate, setDelay, hold: (code: string, down: boolean) => (down ? held.add(code) : held.delete(code)), census: () => world?.census(), make: (text: string) => speak(text, false), say: (text: string) => speak(text, true), unmake: () => ask({ t: 'unmake' }), bubbles: () => [...heads].filter(([, h]) => !h.words.hidden).map(([by, h]) => ({ by, text: h.words.textContent, kind: h.words.className })), names: () => Object.fromEntries([...heads].map(([by, h]) => [by, h.name.textContent])), invite: () => ask({ t: 'key' }), invitation: () => document.querySelector('#invite code')?.textContent ?? '', toys: () => [...new Set([...views.values()].map((v) => v.key.slice(0, v.key.indexOf('/'))))], turn: (to: number) => { yaw = to }, camera: (from: Vec3 | null, to: Vec3) => { fixed = from ? { from, to } : null }, get you() { return you }, get ready() { return you > 0 && clock !== null }, clearFixes: () => { fixes.length = 0 } } })
