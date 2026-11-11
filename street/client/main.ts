// The street's page (#118). It draws the same toys the world process simulates: the engine's
// own World (home/src/engine/world.ts) runs here too, over a solver core that solves nothing
// (src/puppet.ts) and is posed from what the wire says. Other things are drawn a little in
// the past, between the two poses either side of that moment; your own walker is drawn where
// your inputs put it now (walk.ts's rule, run ahead of the world's answer) and put right when
// the answer differs. `?stop=1` makes it stop at things where they are drawn instead of
// walking into them. `?predict=0` draws your walker like everything else, to feel the
// difference; `?delay=50` holds everything 50 ms each way.
import * as THREE from 'three/webgpu'
import { smoothstep, uv, vec3 } from 'three/tsl'
import { load, root, type Stage } from '../../home/src/kernel'
import rendererPlugin from '../../home/src/plugins/renderer'
import type { Quat, Vec3 } from '../../home/src/engine/core.ts'
import { World } from '../../home/src/engine/world.ts'
import { nearest, standsOver } from '../src/near.ts'
import { place } from './place.ts'
import { cars } from './look/cars.ts'
import { dressed, dressing } from './look/dressing.ts'
import { houses } from './look/facade.ts'
import { post, type Post } from './look/post.ts'
import { sky } from './look/sky.ts'
import { dress, dressKey } from './look/things.ts'
import { lift as raised, street } from './look/street.ts'
import { Puppet } from '../src/puppet.ts'
import { resident, type Resident } from './figure.ts'
import { LOTS, houseAt } from '../src/houses.ts'
import { PARKED, registerBlock } from '../src/scene.ts'
import { GRADE, HALF_L, HALF_W, NORMAL, heightAt } from '../src/ground.ts'
import { HALF_H, RADIUS, TICK, predict, standing, type Input, type Walker } from '../src/walk.ts'
import { PING, SELF, SNAP, packDelay, packInputs, packPing, rounded, unpackPing, unpackSelf, unpackSnap, type Ask, type Drawn, type Line, type Pose } from '../src/wire.ts'

const params = new URLSearchParams(location.search)
const PREDICT = params.get('predict') !== '0'
/** Your walker, drawn ahead, stops at things where they are drawn (`?stop=1`). Without it, it walks into them until the world's answer moves them. */
const STOP = PREDICT && params.get('stop') === '1'
let delay = Number(params.get('delay') ?? 0), jitter = Number(params.get('jitter') ?? 0)
const hud = document.getElementById('hud')!, knobs = document.getElementById('knobs')!

// ---- the picture: the home's renderer and its quality tiers, with the street's own sky, light and finish (look/)
load(rendererPlugin)
const stage = await new Promise<Stage>((resolve) => {
  const look = () => { const s = root.get('stage') as Stage | undefined; if (s) resolve(s); else setTimeout(look, 10) }
  look()
})
const { renderer, scene, camera } = stage
camera.far = 1200
// `?tone=` tries another curve from light to screen; `?expose=` another exposure.
const TONES: Record<string, THREE.ToneMapping> = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }
renderer.toneMapping = TONES[params.get('tone') ?? 'neutral'] ?? THREE.NeutralToneMapping
renderer.toneMappingExposure = Number(params.get('expose') ?? 1.3)
renderer.shadowMap.type = THREE.PCFSoftShadowMap
const air = sky(stage)
// A tall screen (a phone held upright) sees a narrow slice at the same lens, so it gets a wider one.
const lens = () => { camera.fov = innerWidth < innerHeight ? 72 : 50; camera.updateProjectionMatrix(); air.resize() }
lens()
addEventListener('resize', lens)
// `?post=0` leaves the finish out, to see what it costs and adds. A change of tier builds it again for that tier.
let finish: Post | null = params.get('post') !== '0' ? post(stage) : null
let dressed_: THREE.Group | null = null
root.on('village/tier', () => {
  if (finish) { finish.dispose(); finish = post(stage) }
  air.tier()
  dressed_?.userData.steady(stage.features().has('traa'))
})
// The hill, the bay and the streets round the block: `?land=0` leaves them out.
const land = params.get('land') !== '0' ? place(scene) : null

// ---- the world as this page holds it: the engine's World, posed and never stepped
registerBlock()
const puppet = new Puppet()
let world: World | null = null
interface Sample { tick: number; p: Vec3; q: Quat }
/** A moving part: its body in the puppet, its poses as heard, and where it is drawn now. */
interface View { key: string; id: number; body: number; kind: 'crate' | 'ball' | 'walker'; reach: number; samples: Sample[]; p: Vec3; q: Quat; shown: THREE.Vector3; mesh?: THREE.Object3D; figure?: Resident; under?: THREE.Mesh; plush?: number }
const views = new Map<number, View>()
let you = 0, snapEvery = 2
/** The made things on the street, as they were put: for showing which one a sentence would change. */
const made = new Map<string, Drawn['toy']>()
function build(drawn: Drawn) {
  const first = puppet.size
  world!.addToy(drawn.toy)
  if (drawn.toy.id.startsWith('made-')) made.set(drawn.toy.id, drawn.toy)
  // The page draws the ground itself (look/street.ts), with a pavement a kerb's height over the world's one plane: what stands still is put up on it here, what moves each frame.
  for (const mesh of world!.group.children) {
    if (mesh.name.startsWith('street scenery') || /^house-\d+\//.test(mesh.name) || (mesh.name.startsWith('furniture/') && dressed(mesh.name.slice(10))) || mesh.name.startsWith('cars/')) mesh.visible = false
    else if (mesh.name.startsWith(`${drawn.toy.id} scenery`)) mesh.position.y = raised(drawn.toy.frame.at[0], drawn.toy.frame.at[2])
    else if (mesh.name.startsWith(`${drawn.toy.id}/`) && !mesh.userData.lifted) { mesh.userData.lifted = true; mesh.position.y += raised(mesh.position.x, mesh.position.z) }
  }
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
    view.mesh = world!.mesh(view.key) ?? undefined
    if (view.kind === 'walker') {
      headOf(id).name.textContent = drawn.toy.label
      // The body the world simulates is a capsule; what is drawn in its place is a resident (figure.ts).
      const capsule = world!.mesh(view.key)
      if (capsule) capsule.visible = false
      wear(view, drawn.plush ?? Number(/\d+/.exec(drawn.toy.id)?.[0] ?? 1) - 1, part.paint ?? '#c8553d')
    }
  })
}
/** The soft dark round under a figure's feet, where it shuts the sky's light out: the sun is low, so the shadow it casts lies well to one side. One shape and one look for all of them. */
const underShape = new THREE.CircleGeometry(0.46, 24), underLook = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
underLook.colorNode = vec3(0.02, 0.025, 0.05)
underLook.opacityNode = smoothstep(1, 0.15, uv().sub(0.5).length().mul(2)).mul(0.42)
/** Draws a walker as one of the felt figures, in place of whichever it was. */
function wear(view: View, plush: number, paint: string) {
  if (view.figure) { scene.remove(view.figure.root); view.figure.dispose() }
  view.plush = plush
  view.figure = resident(plush, paint, stage.features().has('phys'))
  scene.add(view.figure.root)
  if (!view.under) {
    view.under = new THREE.Mesh(underShape, underLook)
    view.under.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...NORMAL))
    view.under.renderOrder = 1
    scene.add(view.under)
  }
}
function remove(toy: string) {
  made.delete(toy)
  for (const [id, view] of views) if (view.key.startsWith(`${toy}/`)) { views.delete(id); view.figure?.dispose(); if (view.under) scene.remove(view.under); heads.get(id)?.el.remove(); heads.delete(id) }
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
  if (e.code === 'KeyF' && !doorButton.hidden) { goInside(); return }
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

// ---- the door home
/** Where the home is and where its door stands on the street, when the world process was told (`--home`). */
interface HomeDoor { url: string; door: Vec3 }
let homeDoor = null as HomeDoor | null
const doorButton = document.getElementById('door') as HTMLButtonElement
/** Through the door: the picture goes to warm light, then the home opens, told where the street is so it can show the way back. */
function goInside() {
  if (!homeDoor) return
  const to = new URL(homeDoor.url)
  to.searchParams.set('street', location.origin + location.pathname)
  document.getElementById('fade')!.classList.add('on')
  setTimeout(() => { location.href = to.href }, 450)
}
doorButton.onclick = goInside

// ---- the wire
/** Sits down, or says on the page why not: a phone has no console to read. */
async function connect() {
  if (typeof WebTransport !== 'function') throw new Error('this browser has no WebTransport')
  const where = await (await fetch('/where')).json() as { port: number; hash: number[]; home?: HomeDoor }
  homeDoor = where.home ?? null
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
  const url = `https://${host}:${params.get('port') ?? where.port}/street`
  hud.textContent = `finding the street at ${url}…`
  const wt = new WebTransport(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: new Uint8Array(where.hash) }] })
  await Promise.race([wt.ready, new Promise((_, no) => setTimeout(() => no(new Error(`no answer from ${url} in 8 s (is UDP ${where.port} reachable from here?)`)), 8000))])
  return wt
}
const wt = await connect().catch((e) => {
  document.getElementById('fade')!.classList.remove('on')
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
/** Over each resident's head: their name, for a while what they said or what was made for them, and what they want for as long as they want it. */
const heads = new Map<number, { el: HTMLDivElement; name: HTMLSpanElement; words: HTMLDivElement; want: HTMLDivElement; wants: string; until: number }>()
function headOf(by: number) {
  let h = heads.get(by)
  if (!h) {
    const el = document.createElement('div'), words = document.createElement('div'), want = document.createElement('div'), name = document.createElement('span')
    el.className = 'head'
    name.className = 'name'
    want.className = 'bubble wants'
    words.hidden = want.hidden = true
    el.append(words, want, name)
    document.body.append(el)
    heads.set(by, (h = { el, name, words, want, wants: '', until: 0 }))
  }
  return h
}
/** A problem solved: a notice everyone reads for a while, and paper in the air over whoever was helped. */
const notice = document.getElementById('notice')!
let noticeUntil = 0
interface Paper { mesh: THREE.InstancedMesh; p: Float32Array; v: Float32Array; spin: Float32Array; born: number }
const papers: Paper[] = []
const paperLook = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), paperShape = new THREE.PlaneGeometry(0.09, 0.13)
function celebrate(by: number, words: string) {
  notice.textContent = words
  notice.classList.add('on')
  noticeUntil = performance.now() + 7000
  const at = views.get(by)?.shown
  if (!at) return
  const n = 110, mesh = new THREE.InstancedMesh(paperShape, paperLook, n), p = new Float32Array(n * 3), v = new Float32Array(n * 3), spin = new Float32Array(n * 2), tint = new THREE.Color()
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, out = 0.6 + Math.random() * 1.6
    p.set([at.x, at.y + 1.1, at.z], i * 3)
    v.set([Math.cos(a) * out, 3.2 + Math.random() * 2.6, Math.sin(a) * out], i * 3)
    spin.set([Math.random() * 6.28, 4 + Math.random() * 9], i * 2)
    mesh.setColorAt(i, tint.set(['#e8553d', '#f2c94c', '#5fb0e8', '#84c96a', '#e05a8a', '#fbf6ea'][i % 6]))
  }
  mesh.frustumCulled = false
  scene.add(mesh)
  papers.push({ mesh, p, v, spin, born: performance.now() })
}
const paperAt = new THREE.Object3D()
/** The paper falls: thrown up, slowed by the air, turning as it comes down; gone after four seconds. */
function flutter(dt: number, now: number) {
  for (const paper of [...papers]) {
    const age = (now - paper.born) / 1000
    if (age > 4) { scene.remove(paper.mesh); paper.mesh.dispose(); papers.splice(papers.indexOf(paper), 1); continue }
    for (let i = 0; i < paper.mesh.count; i++) {
      const drag = Math.exp(-dt * 1.6)
      paper.v[i * 3] *= drag; paper.v[i * 3 + 2] *= drag
      paper.v[i * 3 + 1] = Math.max(-1.3, paper.v[i * 3 + 1] - 9 * dt)
      for (let k = 0; k < 3; k++) paper.p[i * 3 + k] += paper.v[i * 3 + k] * dt
      paperAt.position.set(paper.p[i * 3], paper.p[i * 3 + 1], paper.p[i * 3 + 2])
      paperAt.rotation.set(paper.spin[i * 2] + age * paper.spin[i * 2 + 1], age * 3 + i, 0)
      paperAt.scale.setScalar(age > 3.2 ? Math.max(0, (4 - age) / 0.8) : 1)
      paperAt.updateMatrix()
      paper.mesh.setMatrixAt(i, paperAt.matrix)
    }
    paper.mesh.instanceMatrix.needsUpdate = true
  }
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
  else if (line.t === 'named') {
    headOf(line.by).name.textContent = line.name
    const view = views.get(line.by)
    if (view && line.plush !== undefined && line.plush !== view.plush) wear(view, line.plush, line.paint ?? '#c8553d')
  }
  else if (line.t === 'wants') { const h = headOf(line.by); h.wants = h.want.textContent = line.text }
  else if (line.t === 'solved') celebrate(line.by, `${line.solver} ${line.done}${line.with ? ` with ${line.with}` : ''}`)
  else invited(line)
}
/** A key for an agent of yours: shown to you alone, in the workshop panel, with the command that hands it over. */
function invited(line: Extract<Line, { t: 'key' }>) {
  const box = document.getElementById('invite')!
  box.hidden = false
  box.querySelector('code')!.textContent = line.command
  document.body.classList.add('open')
}

/** Lines from the world that this page failed to act on (none, when all is well). */
let unread = 0
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
      // One line that cannot be read or acted on must not stop the rest: the page would go on drawing a street it no longer hears.
      try { heardLine(JSON.parse(text) as Line) } catch (e) {
        unread++
        console.error('a line from the street could not be acted on', e)
      }
    }
  }
})()
function heardLine(line: Line) {
  if (line.t === 'hello') {
    // Building a street's worth of meshes is a long task: the renderer must not read it as a slow GPU and drop a tier.
    const release = stage.hold()
    world = new World(puppet, () => {}, undefined, line.floor)
    world.dress = dress
    world.dressKey = dressKey
    scene.add(world.group, street(), houses(Array.from({ length: LOTS }, (_, lot) => [houseAt(lot, -1), houseAt(lot, 1)]).flat()), (dressed_ = dressing(stage.features().has('traa'))), cars(PARKED))
    snapEvery = Math.round(line.tickHz / line.snapHz)
    line.drawn.forEach(build)
    // The street lights itself: a picture from over the middle of the road, without what moves.
    world.frame(0)
    air.probe(new THREE.Vector3(0, heightAt(-6) + 4, -6), [...views.values()].flatMap((v) => [world!.mesh(v.key), v.figure?.root, v.under]).filter((o): o is THREE.Object3D => !!o))
    release()
    // The page opens covered (index.html): the street is shown once the frame that builds its looks has been drawn, so arriving is a fade in, not a frozen half-built street.
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('fade')!.classList.remove('on')))
    you = line.you
    me = { p: [...views.get(you)!.p], v: [0, 0, 0], hop: 0, grounded: true }
    // The first time here, whichever figure the world gave you is who you are from now on.
    if (localStorage.getItem('street.plush') === null) localStorage.setItem('street.plush', String(views.get(you)!.plush ?? 0))
    // Coming out of the home, you stand at its door, under its lantern.
    if (params.get('from') === 'home' && homeDoor) ask({ t: 'door' })
    if (homeDoor) {
      const lantern = new THREE.PointLight('#ffc98a', 9, 6, 1.6)
      lantern.position.set(homeDoor.door[0] + 0.5 * Math.sign(homeDoor.door[0]), homeDoor.door[1] + 2, homeDoor.door[2] - 0.9)
      scene.add(lantern)
    }
  } else if (line.t === 'add') build(line.drawn)
  else if (line.t === 'remove') remove(line.toy)
  else told(line)
}
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
/** How far behind you the camera rides, how much of that it has now (1 is all of it), and how far from the street's middle it may stand: short of the fronts and their bays, and a little out onto the street across each end. */
const BOOM = 7, INSIDE_X = HALF_W - 1.3, INSIDE_Z = HALF_L * Math.cos(Math.atan(GRADE)) + 2
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
    view.shown.set(view.p[0], view.p[1] + raised(view.p[0], view.p[2]), view.p[2])
    view.figure?.update(view.shown, dt)
    view.under?.position.set(view.shown.x, view.shown.y - standing(NORMAL) + 0.02, view.shown.z)
  }
  // The engine draws: its meshes go where the puppet's bodies now are, and up onto the pavement where they are over it.
  world.frame(dt)
  for (const view of views.values()) if (view.mesh) view.mesh.position.y = view.shown.y
  const mine = views.get(you)
  if (fixed) {
    camera.position.set(...fixed.from)
    camera.lookAt(...fixed.to)
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
  }
  if (homeDoor && mine) doorButton.hidden = Math.hypot(mine.shown.x - homeDoor.door[0], mine.shown.z - homeDoor.door[2]) > 1.7
  // The stage draws after this; names are placed with the camera as it now stands.
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  flutter(dt, now)
  mean(now)
  if (noticeUntil && now > noticeUntil) { notice.classList.remove('on'); noticeUntil = 0 }
  for (const mesh of shimmers.values()) { mesh.rotation.y += dt * 1.8; mesh.rotation.x += dt * 0.7; mesh.scale.setScalar(1 + 0.25 * Math.sin(now / 180)) }
  // A name, and words for a while, stand over each resident's head while they are in front of the camera.
  for (const [by, h] of heads) {
    const view = views.get(by)
    if (!view) continue
    if (!h.words.hidden && now > h.until) h.words.hidden = true
    // What they want stands there while they say nothing else: in full from near, as a mark from far.
    h.want.hidden = !h.wants || !h.words.hidden
    if (!h.want.hidden) { const far = camera.position.distanceTo(view.shown) > 17; if (far !== h.want.classList.contains('far')) { h.want.classList.toggle('far', far); h.want.textContent = far ? '?' : h.wants } }
    head.set(view.shown.x, view.shown.y + 1.05, view.shown.z).project(camera)
    const seen = head.z < 1 && Math.abs(head.x) < 1.2 && (by !== you || !h.words.hidden)
    h.el.style.display = seen ? '' : 'none'
    // Over their head, but never off the side of the screen: a wide bubble near an edge is moved in.
    if (seen) { const half = h.el.offsetWidth / 2 + 6; h.el.style.transform = `translate(-50%, -100%) translate(${Math.max(half, Math.min(innerWidth - half, ((head.x + 1) / 2) * innerWidth))}px, ${((1 - head.y) / 2) * innerHeight}px)` }
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
  return { rttMs: Math.round(rtt), snapshotsLostPct: due ? +((1 - ticks.heard.size / due) * 100).toFixed(2) : 0, downBps: Math.round(rates.down), upBps: Math.round(rates.up), datagramsPerS: Math.round(rates.snaps), frameMs: spread(frames), workMs: spread(works, 2), fixMm: spread(fixes.map((f) => f * 1000)), things: views.size, predict: PREDICT, stop: STOP, delay, jitter, unread, backend: stage.backend, quality: stage.quality, landTriangles: land?.triangles ?? 0, gpuMs: spread(stage.timing.gpu.slice(-300), 2), cpuMs: spread(stage.timing.cpu.slice(-300), 2), tier: stage.timing.tierReason }
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

// ---- the sentence: what you type makes a thing, changes the made thing you face, or is said
type Verb = 'make' | 'change' | 'say'
const VERBS: Record<Verb, string> = { make: 'make anything: a big red dog, a bridge, a ladder…', change: 'change the thing you face: turn it into ice, make it bigger…', say: 'say something…' }
let verb: Verb = 'make'
const mode = document.getElementById('mode') as HTMLButtonElement
const setMode = (to: Verb) => { verb = to; mode.textContent = to; words.placeholder = VERBS[to] }
mode.onclick = () => { setMode(verb === 'make' ? 'change' : verb === 'change' ? 'say' : 'make'); words.focus() }
setMode('make')
const speak = (text: string, as: Verb = verb) => { if (text.trim()) ask(as === 'say' ? { t: 'say', text } : { t: as, text, yaw }) }
/** In `change`: the made thing a sentence would change now (the world picks by the same rule, near.ts), ringed on the ground and named in the bar. */
let meant: { id: string; label: string } | null = null
const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }))
ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...NORMAL))
ring.visible = false
ring.renderOrder = 2
scene.add(ring)
let lookedAt = 0
function mean(now: number) {
  const mine = views.get(you)
  if (verb !== 'change' || !mine) { if (ring.visible) { ring.visible = false; meant = null } return }
  if (now - lookedAt > 150) {
    lookedAt = now
    const where = (key: string): Vec3 | null => { for (const v of views.values()) if (v.key === key) return [v.shown.x, v.shown.y, v.shown.z]; return null }
    const near = nearest([...made.values()].map((toy) => ({ toy, box: standsOver(toy, where) })), [mine.shown.x, mine.shown.y, mine.shown.z], yaw)
    if ((near?.toy.id ?? null) !== (meant?.id ?? null)) words.placeholder = near ? `change ${near.toy.label}: turn it into ice, make it bigger…` : 'stand by something made, and face it'
    meant = near ? { id: near.toy.id, label: near.toy.label } : null
    ring.visible = !!near
    if (near) {
      const x = (near.box.x0 + near.box.x1) / 2, z = (near.box.z0 + near.box.z1) / 2
      ring.userData.size = Math.max(0.7, Math.hypot(near.box.x1 - near.box.x0, near.box.z1 - near.box.z0) / 2 + 0.25)
      // On the ground as it is drawn: up on the pavement where any of the ring lies over it.
      ring.position.set(x, heightAt(z) + 0.06 + raised(Math.abs(x) + ring.userData.size, z), z)
    }
  }
  if (ring.visible) ring.scale.setScalar(ring.userData.size * (1 + 0.03 * Math.sin(now / 160)))
}
;(document.getElementById('ask') as HTMLFormElement).onsubmit = (e) => {
  e.preventDefault()
  speak(words.value)
  words.value = ''
  words.blur()
}
document.getElementById('undo')!.onclick = () => ask({ t: 'unmake' })
document.getElementById('bring')!.onclick = () => ask({ t: 'key' })
document.getElementById('copy')!.onclick = () => void navigator.clipboard?.writeText(document.querySelector('#invite code')!.textContent ?? '')
// Who you are: your name from the link (?name=) or the one this browser gave before, and the felt figure this
// browser was last time, so you come back out of the home (or back tomorrow) as yourself.
const named = (params.get('name') ?? localStorage.getItem('street.name') ?? '').trim().slice(0, 24)
const was = localStorage.getItem('street.plush')
if (named) localStorage.setItem('street.name', named)
if (named || was !== null) ask({ t: 'name', text: named, ...(was !== null ? { plush: Number(was) } : {}) })
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
/** What the page draws now, for test/drawn.ts: its own groups by name, how many of the world's meshes for things the page draws itself are showing (none should), and how the sun's shadow is drawn. */
const drawnNow = () => ({ groups: scene.children.map((o) => o.name).filter(Boolean), doubled: world?.group.children.filter((m) => m.visible && (/^house-\d+\/|^cars\/|^street scenery/.test(m.name) || (m.name.startsWith('furniture/') && dressed(m.name.slice(10))))).length ?? -1, boxed: air.boxed() })
Object.assign(window, { __street: { stats, drawn: drawnNow, shownOf, keyToMotion, pushCrate, setDelay, hold: (code: string, down: boolean) => (down ? held.add(code) : held.delete(code)), census: () => world?.census(), make: (text: string) => speak(text, 'make'), change: (text: string) => speak(text, 'change'), say: (text: string) => speak(text, 'say'), unmake: () => ask({ t: 'unmake' }), bubbles: () => [...heads].filter(([, h]) => !h.words.hidden).map(([by, h]) => ({ by, text: h.words.textContent, kind: h.words.className })), whereIs: (name: string) => { const id = [...heads].find(([, h]) => h.name.textContent === name)?.[0]; const v = id === undefined ? undefined : views.get(id); return v ? [v.shown.x, v.shown.y, v.shown.z] : null }, wants: () => Object.fromEntries([...heads].filter(([, h]) => h.wants).map(([by, h]) => [h.name.textContent, h.wants])), notice: () => (notice.classList.contains('on') ? notice.textContent : ''), meant: () => meant, who: () => Object.fromEntries([...views.values()].filter((v) => v.kind === 'walker').map((v) => [headOf(v.id).name.textContent, v.plush])), names: () => Object.fromEntries([...heads].map(([by, h]) => [by, h.name.textContent])), invite: () => ask({ t: 'key' }), invitation: () => document.querySelector('#invite code')?.textContent ?? '', toys: () => [...new Set([...views.values()].map((v) => v.key.slice(0, v.key.indexOf('/'))))], turn: (to: number) => { yaw = to }, camera: (from: Vec3 | null, to: Vec3) => { fixed = from ? { from, to } : null }, get you() { return you }, get ready() { return you > 0 && clock !== null }, clearFixes: () => { fixes.length = 0 } } })
