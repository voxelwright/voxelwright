// Time (#226, after Small Magic's time.js, MIT). The key pressed, everything stops where it is: pieces in the air,
// fire, smoke. Whoever pressed it alone goes on walking, through it. Held, time is wound back: what fell flies up
// and sets itself where it was, smoke goes back down. Let go, it stands
// still again at that moment; pressed once more, time is let go from there.
//
// How: while time runs, what changes is written down thirty times a second, each entry holding what it changed
// from and to (the pieces that moved, and how many edits the world had). Nothing is written while nothing happens,
// so winding back goes straight from one thing happening to the one before it. Winding back undoes entries from
// the last; when time is let go each piece is handed back where it then is, going and turning as it was
// (`onResumePose`, for the mover's `pose` ask).
//
// What it cannot do: a piece that broke, or came to rest and is cells again, is not made again by winding back past
// that. Each piece is wound back as far as it has been a piece. Cells cut or built since are the caller's to undo
// (`onUndoEdits`); the page does not yet keep what an edit replaced, so it leaves that unset and they stay.
//
// Seen: the colour drains to a cold silver, out from the middle of the view as a wave (gold while it winds back),
// fire keeps its own, and motes hang in the stopped air. The grading is the last pass's (`postFx`, glow.ts).
import { shader, type Gpu, type Target, NEAR, FAR } from '../probe/gpu.ts'
import type { PostFx } from './glow.ts'
import type { View } from './march.ts'

type V3 = [number, number, number]

/** Cells in a metre. */
const M = 10
/** Entries a second while things are happening. */
const RATE = 30
/** Bytes of it kept; the oldest goes first. */
const MOST = 64e6
/** How far a piece must have moved (cells) or turned (in its quaternion) since it was last written down to be written again. */
const MOVED = 4e-4 * M, TURNED = 4e-4
/** Motes that hang in the stopped air. */
const MOTES = 900

export type RewindState = 'live' | 'frozen' | 'rewinding'
/** A loose piece as the page keeps it: its middle of mass (cells) and its turn (a quaternion: x, y, z, w). */
export interface Piece { id: number; pos: readonly [number, number, number]; rot: readonly [number, number, number, number] }
export interface RewindStep {
  state: RewindState
  /** How fast the world's own time runs: 1, or not at all while it is stopped or wound back (for `tempo.rate`). */
  rate: number
  /** How fast it is being wound back, in seconds of the world a second (0 when it is not). */
  rewinding: number
  /** How much of the world's time was gone back over this frame, in seconds (stretches in which nothing happened are skipped). */
  went: number
  /** How much of what is written down is still ahead of where time now stands (1: none wound back; 0: all of it). */
  left: number
}
export interface RewindOptions {
  /** The land's top at a column (cells), for where the motes hang; without it they hang about the eye's own height. */
  ground?(x: number, z: number): number
  /** What is to be heard: 'stop' time stopped, 'back' winding back begun, 'still' stopped again, 'go' let go (sound/world.ts `rewind`). */
  onCue?(what: 'stop' | 'back' | 'still' | 'go'): void
}
export interface Rewind {
  readonly state: RewindState
  /** The world's own clock (s): it runs with the world, stands while time is stopped and runs down while it is wound back. What has no state of its own (a billow's age) is read against it. */
  readonly clock: number
  /** After the world has moved on by `dt` of its own time: what changed is written down. `pieces` is every loose piece now; `edits` is how many edits the world has had (the mark that is gone back to). */
  record(dt: number, pieces: Iterable<Piece>, edits: number): void
  /** The key, each frame, by the wall's clock, before the world is drawn: a tap stops time, holding winds it back, a tap again lets it go. */
  step(realDt: number, keyDown: boolean, view?: View): RewindStep
  /** The motes, drawn into the picture (before the last pass). */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, realT: number): void
  /** Fills time's own part of what the last pass is told (glow.ts): every frame, so that it also goes out. */
  postFx(out: PostFx): void
  /** Time is let go at once (another world, the key's owner gone). */
  end(): void
  /** What has been written down is thrown away, and nothing is written for a moment: the world was put back as it first was. */
  forget(secs?: number): void
  /** While it is wound back: where a piece is now to be shown. */
  onPose: ((id: number, pos: Readonly<V3>, rot: readonly [number, number, number, number]) => void) | null
  /** Time let go after it was wound back: each piece that was moved, where it is, and how it was going (cells a second) and turning (radians a second) then. */
  onResumePose: ((id: number, pos: Readonly<V3>, rot: readonly [number, number, number, number], vel: Readonly<V3>, spin: Readonly<V3>) => void) | null
  /** Wound back past an edit: the world is to be put back to when it had had only so many. */
  onUndoEdits: ((count: number) => void) | null
  /** How much is written down. */
  stats: { entries: number; bytes: number }
}

/** One thing happening: the pieces that moved (from `a` to `b`, seven numbers each: where, and the turn), over `dt` ending at `t` of the world's clock, and how many edits the world had before and after. */
interface Entry { t: number; dt: number; ids: Int32Array; a: Float64Array; b: Float64Array; editsA: number; editsB: number; size: number }

const CODE = /* wgsl */ `
struct U {
  fwd: vec4f,    // the eye's forward; tan of half the view's height
  right: vec4f,  // its right; width over height
  up: vec4f,     // its up; the wall's clock (s)
  off: vec4f,    // where the motes were strewn from, from the eye (cells); how much they are there
  hue: vec4f,    // their light
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var depths: texture_depth_2d;
struct Mote { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) light: f32, @location(2) off: f32 }
// A mote: it does not move, so walking among them shows that nothing else does either. It twinkles by the wall's
// clock, is not seen right before the eye, and is gone some way off.
@vertex fn vs(@builtin(vertex_index) i: u32, @location(0) at: vec3f, @location(1) seed: f32) -> Mote {
  let corner = vec2f(f32(i & 1u), f32((i >> 1u) & 1u)) * 2.0 - 1.0;
  let p = at + u.off.xyz;
  let z = dot(p, u.fwd.xyz);
  let m = z / 10.0;
  let size = 0.2 + 0.42 * seed * seed;
  let q = p + (u.right.xyz * corner.x + u.up.xyz * corner.y) * size;
  let zq = dot(q, u.fwd.xyz);
  var out: Mote;
  out.pos = vec4f(dot(q, u.right.xyz) / (u.fwd.w * u.right.w), dot(q, u.up.xyz) / u.fwd.w, 0.5 * zq, zq);
  out.uv = corner;
  let twinkle = 0.55 + 0.45 * sin(u.up.w * (0.7 + 1.6 * seed) + seed * 40.0);
  out.light = twinkle * smoothstep(0.6, 2.5, m) * (1.0 - smoothstep(22.0, 34.0, m)) * u.off.w;
  out.off = z;
  return out;
}
@fragment fn fs(in: Mote) -> @location(0) vec4f {
  let r = length(in.uv);
  let a = exp(-r * r * 5.0) + 0.6 * exp(-r * 26.0);
  // (whatever stands nearer than it does hides it)
  let d = textureLoad(depths, vec2i(in.pos.xy), 0);
  let behind = ${NEAR.toFixed(1)} / max(1.0e-7, 1.0 - d * ${((FAR - NEAR) / FAR).toFixed(7)});
  let seen = 1.0 - smoothstep(behind - 0.5, behind + 0.5, in.off);
  return vec4f(u.hue.rgb * a * in.light * seen * (1.0 - smoothstep(0.85, 1.0, r)), 0.0);
}
`

export async function createRewind(gpu: Gpu, format: GPUTextureFormat = gpu.sceneFormat, options: RewindOptions = {}): Promise<Rewind> {
  const { device } = gpu
  const module = await shader(device, 'rewind motes', CODE)
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'rewind motes', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
  })
  const block = device.createBuffer({ label: 'rewind', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const strewn = new Float32Array(MOTES * 4), motes = device.createBuffer({ label: 'rewind motes', size: strewn.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const binds = new WeakMap<GPUTextureView, GPUBindGroup>()
  const uniforms = new Float32Array(20)
  /** Where the motes were strewn from: they are kept from there, so that far from the world's corner nothing wobbles. */
  const anchor: V3 = [0, 0, 0]

  // ── what is written down ──
  // (`wt` is the world's own time, in seconds: each entry is stamped with it, and winding back runs it down)
  let log: Entry[] = [], bytes = 0, acc = 0, wt = 0, forgetting = 0
  /** Each piece as it was last written down (seven numbers), and whether it was seen at the last look. */
  const known = new Map<number, Float64Array>(), seenNow = new Set<number>()
  let editsNow = -1, ids = new Int32Array(256), from = new Float64Array(256 * 7), to = new Float64Array(256 * 7), lastPieces: Iterable<Piece> | null = null, lastEdits = 0
  const note = (dt: number, pieces: Iterable<Piece>, edits: number) => {
    if (editsNow < 0) editsNow = edits
    let n = 0
    seenNow.clear()
    for (const p of pieces) {
      seenNow.add(p.id)
      const was = known.get(p.id)
      // (a piece seen for the first time is only taken note of: it has not moved yet)
      if (!was) { known.set(p.id, Float64Array.of(p.pos[0], p.pos[1], p.pos[2], p.rot[0], p.rot[1], p.rot[2], p.rot[3])); continue }
      if (Math.abs(p.pos[0] - was[0]) + Math.abs(p.pos[1] - was[1]) + Math.abs(p.pos[2] - was[2]) <= MOVED && Math.abs(p.rot[0] - was[3]) + Math.abs(p.rot[1] - was[4]) + Math.abs(p.rot[2] - was[5]) + Math.abs(p.rot[3] - was[6]) <= TURNED) continue
      if (n === ids.length) { const i2 = new Int32Array(n * 2), f2 = new Float64Array(n * 14), t2 = new Float64Array(n * 14); i2.set(ids); f2.set(from); t2.set(to); ids = i2; from = f2; to = t2 }
      from.set(was, n * 7)
      was[0] = p.pos[0]; was[1] = p.pos[1]; was[2] = p.pos[2]; was[3] = p.rot[0]; was[4] = p.rot[1]; was[5] = p.rot[2]; was[6] = p.rot[3]
      to.set(was, n * 7)
      ids[n++] = p.id
    }
    // (a piece that is no more is forgotten: it cannot be wound back to)
    if (known.size > seenNow.size) for (const id of known.keys()) if (!seenNow.has(id)) known.delete(id)
    // (while it is forgetting, what has changed is taken as how things are, and not written down)
    const quiet = forgetting > 0
    if (quiet) forgetting -= dt
    const was = editsNow
    editsNow = edits
    if (quiet || (!n && edits === was)) return
    const e: Entry = { t: wt, dt, ids: ids.slice(0, n), a: from.slice(0, n * 7), b: to.slice(0, n * 7), editsA: was, editsB: edits, size: 96 + n * 116 }
    log.push(e); bytes += e.size
    while (bytes > MOST && log.length > 1) bytes -= log.shift()!.size
  }

  // ── going back over it ──
  let state: RewindState = 'live', frac = 0, speed = 0, wound = false, backFor = 0, pressed = false, heldFor = 0, fresh = false, woundNow = false, most = 1
  /** The pieces winding back has moved: each is handed back when time is let go. */
  const moved = new Set<number>()
  const pos: V3 = [0, 0, 0], rot: [number, number, number, number] = [0, 0, 0, 1], vel: V3 = [0, 0, 0], spin: V3 = [0, 0, 0]
  /** The pieces of an entry, somewhere between as it left them (f 0) and as it found them (f 1). */
  const put = (e: Entry, f: number) => {
    const g = 1 - f, { a, b } = e
    for (let i = 0; i < e.ids.length; i++) {
      const o = i * 7, id = e.ids[i], was = known.get(id)
      if (!was) continue
      // (the turn: between the two by the shorter way)
      const d = a[o + 3] * b[o + 3] + a[o + 4] * b[o + 4] + a[o + 5] * b[o + 5] + a[o + 6] * b[o + 6] < 0 ? -1 : 1
      const x = b[o + 3] * g + d * a[o + 3] * f, y = b[o + 4] * g + d * a[o + 4] * f, z = b[o + 5] * g + d * a[o + 5] * f, w = b[o + 6] * g + d * a[o + 6] * f, l = Math.hypot(x, y, z, w) || 1
      was[0] = b[o] * g + a[o] * f; was[1] = b[o + 1] * g + a[o + 1] * f; was[2] = b[o + 2] * g + a[o + 2] * f; was[3] = x / l; was[4] = y / l; was[5] = z / l; was[6] = w / l
      moved.add(id)
      if (api.onPose) { pos[0] = was[0]; pos[1] = was[1]; pos[2] = was[2]; rot[0] = was[3]; rot[1] = was[4]; rot[2] = was[5]; rot[3] = was[6]; api.onPose(id, pos, rot) }
    }
  }
  const undo = (e: Entry) => {
    put(e, 1)
    if (e.editsA !== e.editsB) api.onUndoEdits?.(e.editsA)
    editsNow = e.editsA
  }
  const cue = (what: 'stop' | 'back' | 'still' | 'go') => options.onCue?.(what)

  // ── what is seen of it ──
  let on = 0, gold = 0, streak = 0, inkFor = 0, wave = 9, flash = 0, wroteFlash = false, strewnOnce = false
  const strew = (view: View | undefined) => {
    const eye = view ? view.eye : anchor
    anchor[0] = Math.round(eye[0]); anchor[1] = Math.round(eye[1]); anchor[2] = Math.round(eye[2])
    for (let i = 0; i < MOTES; i++) {
      const a = Math.random() * 6.283, r = (1.2 + 22 * Math.random() ** 0.7) * M, x = Math.cos(a) * r, z = Math.sin(a) * r
      const floor = options.ground ? options.ground(Math.round(anchor[0] + x), Math.round(anchor[2] + z)) - anchor[1] : -1.7 * M
      strewn[i * 4] = x; strewn[i * 4 + 1] = floor + (0.2 + 5.5 * Math.random() ** 1.6) * M; strewn[i * 4 + 2] = z; strewn[i * 4 + 3] = Math.random()
    }
    device.queue.writeBuffer(motes, 0, strewn)
    strewnOnce = true
  }
  const stop = (view: View | undefined) => {
    // (what has happened since the last entry is written down first, so that nothing is left out of what can be gone back over)
    if (lastPieces) note(Math.max(acc, 1e-3), lastPieces, lastEdits)
    acc = 0
    state = 'frozen'; frac = 0; speed = 0; wound = false; backFor = 0; most = Math.max(1, log.length)
    inkFor = 0.09; wave = 0; flash = 1
    moved.clear()
    strew(view)
    cue('stop')
  }
  /** Time is let go: if it was wound back, each piece it moved is handed back as it is now drawn, going as it was. */
  const letGo = () => {
    if (wound) {
      if (frac > 0 && log.length) { const e = log.pop()!; bytes -= e.size; undo(e); wt = e.t - e.dt; frac = 0 }
      const e = log[log.length - 1], going = new Map<number, number>()
      if (e && e.dt >= 0.5 / RATE) for (let i = 0; i < e.ids.length; i++) going.set(e.ids[i], i)
      for (const id of moved) {
        const was = known.get(id)
        if (!was || !api.onResumePose) continue
        vel[0] = vel[1] = vel[2] = spin[0] = spin[1] = spin[2] = 0
        const i = going.get(id)
        if (e && i !== undefined) {
          const o = i * 7, a = e.a, b = e.b
          vel[0] = (b[o] - a[o]) / e.dt; vel[1] = (b[o + 1] - a[o + 1]) / e.dt; vel[2] = (b[o + 2] - a[o + 2]) / e.dt
          // (how it was turning: twice the vector part of what turned it from then to now, over the time)
          const x = b[o + 6] * -a[o + 3] + b[o + 3] * a[o + 6] + b[o + 4] * -a[o + 5] - b[o + 5] * -a[o + 4], y = b[o + 6] * -a[o + 4] - b[o + 3] * -a[o + 5] + b[o + 4] * a[o + 6] + b[o + 5] * -a[o + 3], z = b[o + 6] * -a[o + 5] + b[o + 3] * -a[o + 4] - b[o + 4] * -a[o + 3] + b[o + 5] * a[o + 6]
          const w = b[o + 6] * a[o + 6] + b[o + 3] * a[o + 3] + b[o + 4] * a[o + 4] + b[o + 5] * a[o + 5], sgn = w < 0 ? -2 : 2
          spin[0] = Math.max(-12, Math.min(12, (sgn * x) / e.dt)); spin[1] = Math.max(-12, Math.min(12, (sgn * y) / e.dt)); spin[2] = Math.max(-12, Math.min(12, (sgn * z) / e.dt))
        }
        pos[0] = was[0]; pos[1] = was[1]; pos[2] = was[2]; rot[0] = was[3]; rot[1] = was[4]; rot[2] = was[5]; rot[3] = was[6]
        api.onResumePose(id, pos, rot, vel, spin)
      }
    }
    moved.clear()
    flash = 0.5
    state = 'live'; wound = false; speed = 0; frac = 0; acc = 0
  }

  const api: Rewind = {
    get state() { return state },
    get clock() { return wt },
    onPose: null, onResumePose: null, onUndoEdits: null,
    stats: { get entries() { return log.length }, get bytes() { return bytes } },
    record(dt, pieces, edits) {
      lastPieces = pieces; lastEdits = edits
      // (where the pieces are comes back from the mover a frame or two late: what arrives after time has stopped is
      // written down too, until it is first wound back, or it would be left out of what can be undone)
      if (state === 'frozen' && !wound) { note(1e-3, pieces, edits); return }
      if (state !== 'live' || dt <= 0) return
      acc += dt; wt += dt
      if (acc >= 1 / RATE) { note(acc, pieces, edits); acc = 0 }
    },
    step(realDt, keyDown, view) {
      const dt = Math.min(Math.max(realDt, 0), 0.1)
      if (keyDown && !pressed) {
        pressed = true; heldFor = 0
        if (state === 'live') { stop(view); fresh = true } else fresh = false
      } else if (!keyDown && pressed) {
        pressed = false
        // (a press that wound time back leaves it stopped; only a short press of its own lets it go)
        if (state === 'rewinding') { state = 'frozen'; speed = 0; cue('still') }
        else if (state === 'frozen' && !fresh && !woundNow) { letGo(); cue('go') }
        woundNow = false
      }
      if (keyDown && state !== 'live') {
        heldFor += dt
        if (state === 'frozen' && heldFor > (fresh ? 0.5 : 0.22) && log.length) { state = 'rewinding'; backFor = 0; woundNow = true; wound = true; cue('back') }
      }
      let went = 0
      if (state === 'rewinding') {
        backFor += dt
        speed = 0.6 + 2.6 * Math.min(1, backFor / 3.5) ** 1.5
        let by = speed * dt
        wt -= by
        // (a stretch in which nothing happened is not waited through: time goes straight to the last thing that did)
        const top = log[log.length - 1]
        if (top && wt > top.t + 0.12) { by += wt - top.t - 0.12; wt = top.t + 0.12 }
        while (log.length && wt <= log[log.length - 1].t - log[log.length - 1].dt) { const e = log.pop()!; bytes -= e.size; undo(e) }
        frac = 0
        if (!log.length) { state = 'frozen'; speed = 0; cue('still') }
        else { const e = log[log.length - 1]; if (wt < e.t) { frac = Math.min(1, (e.t - wt) / e.dt); put(e, frac) } }
        went = by
      }
      // what is seen
      const want = state === 'live' ? 0 : 1
      on += (want - on) * Math.min(1, dt * (want ? 9 : 3.5)); if (on < 0.01 && !want) on = 0
      gold += ((state === 'rewinding' ? 1 : 0) - gold) * Math.min(1, dt * 5)
      streak += ((state === 'rewinding' ? 0.5 + 0.17 * speed : 0) - streak) * Math.min(1, dt * 6); if (streak < 0.01 && state !== 'rewinding') streak = 0
      inkFor = Math.max(0, inkFor - dt)
      if (wave < 9) { wave += dt * 3.4; if (wave > 1.5) wave = 9 }
      flash = Math.max(0, flash - dt * 4)
      return { state, rate: state === 'live' ? 1 : 0, rewinding: state === 'rewinding' && log.length ? speed : 0, went, left: state === 'live' ? 0 : Math.min(1, log.length / most) }
    },
    end() { pressed = false; if (state !== 'live') { letGo(); cue('go') } },
    forget(secs = 2.5) { pressed = false; if (state !== 'live') letGo(); log = []; bytes = 0; forgetting = secs; known.clear(); editsNow = -1 },
    draw(encoder, to, view, time) {
      if (on <= 0.004 || !strewnOnce) return
      let bind = binds.get(to.depth)
      if (!bind) { bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: block } }, { binding: 1, resource: to.depth }] }); binds.set(to.depth, bind) }
      uniforms.set([view.forward[0], view.forward[1], view.forward[2], view.tanHalf, view.right[0], view.right[1], view.right[2], to.size[0] / Math.max(1, to.size[1]), view.up[0], view.up[1], view.up[2], time,
        anchor[0] - view.eye[0], anchor[1] - view.eye[1], anchor[2] - view.eye[2], on * 0.9, 1.6 + 0.3 * gold, 1.25, 0.7 - 0.25 * gold, 0])
      device.queue.writeBuffer(block, 0, uniforms)
      const pass = encoder.beginRenderPass({ label: 'rewind motes', colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }] })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.setVertexBuffer(0, motes)
      pass.draw(4, MOTES)
      pass.end()
    },
    postFx(out) {
      // (the colour is drained nearly all the way to a cold silver, but what is warm keeps its own, so fire is still fire; toward old gold while it winds back)
      out.doom = on * 0.92; out.doomWarm = on > 0 ? 1 : 0; out.doomKeep = 0.15
      out.doomTint[0] = 0.4 + 0.2 * gold; out.doomTint[1] = 0.47 + 0.02 * gold; out.doomTint[2] = 0.62 - 0.32 * gold
      out.rewind = streak; out.wave = on > 0 ? wave : 9
      // (as it stops: a frame of ink and its turn-about, and a pale flash. These are a blast's to set too: time
      // writes its own over them while they last, and clears them once after)
      const ink = inkFor > 0.045 ? 1 : inkFor > 0 ? -1 : 0
      if (ink !== 0 || flash > 0) { out.ink = ink; out.white = Math.max(out.white, flash * 0.35); wroteFlash = true }
      else if (wroteFlash) { out.ink = 0; out.white = 0; wroteFlash = false }
    },
  }
  return api
}
