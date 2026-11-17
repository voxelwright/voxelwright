// The wand (#246): aiming. Held, it gives three ways to say where a spell goes, each drawn in the world so that
// it is plain what will be hit: a point (a ring lying on whatever is there), an area on the ground that can be made
// bigger and smaller (its foot lit, its box in lines), and a thing: the whole of it, the one part pointed at, or
// the one side pointed at (the thing's own cells lit, their edge drawn).
//
// What is aimed at is what is at the middle of the picture, asked of the marcher (one look at a time) and then of
// the cells themselves, edits and all: this page's own core is told every edit the page applies, so a hole is a
// hole and a made thing is a thing.
//
// Where one thing ends (a short experiment, November 13): cells that touch, down to where someone on foot would
// stand (`feet_at`). A parked car is 5,634 cells found in 3 ms, a street tree 7,929 in 6 ms, a hydrant 74. A house
// is not one thing by that rule: a terrace is joined from end to end, so anything over the cap is taken a part at
// a time (cells of one kind that touch). Stopping at ground materials instead did not work at all: the pavement is
// concrete and so is a house's foot.
//
// Its keys are a mode of page/input.ts (`aiming`, there while the wand is in hand) and its bar is a panel of
// page/hud.ts; it listens for nothing itself.
import { shader, type Target as Picture } from '../probe/gpu.ts'
import type { Edit } from './edits.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Marcher, View } from './march.ts'

export type Cell = readonly [number, number, number]
export type Box = readonly [number, number, number, number, number, number]
/** How much of a thing: all of it, the cells of one kind that touch the one pointed at, or its cells that face the way the pointed face does. */
export type Share = 'whole' | 'part' | 'side'
/** What a spell is aimed at. Places are the world's finest cells; a box's high corner is exclusive. This is the target an ask carries (#243). */
export type Target =
  | { how: 'point'; at: Cell; cell: Cell | null; normal: Cell }
  | { how: 'area'; box: Box }
  | { how: 'thing'; share: Share; cell: Cell; normal: Cell; box: Box; /** x, y, z of each cell, one after another. */ cells: Int32Array; /** The kind of each. */ kinds: Uint16Array; /** Over the cap: only the nearest of it was taken. */ partial: boolean; /** A made thing's record, when it is one (#244). */ id?: string }

export type Mode = 'point' | 'area' | 'thing'
const MODES: Mode[] = ['point', 'area', 'thing'], SHARES: Share[] = ['whole', 'part', 'side']
/** The most cells one thing may be, and the most across. Past either it is taken a part at a time. */
const CELLS_MOST = 60_000, PART_MOST = 20_000, ACROSS_MOST = 192
/** An area's side, in cells: 40 cm to 25.6 m. */
const AREA_LEAST = 4, AREA_MOST = 256

export interface Core { memory: WebAssembly.Memory; world_kind(x: number, y: number, z: number): number; feet_at(x: number, z: number): number; edits_room(words: number): number; world_edit(after: number): void }

export interface Wand {
  /** Whether it is in hand. */
  held: boolean
  mode: Mode
  share: Share
  /** An area's size on the ground and its height, in cells. */
  area: [number, number, number]
  /** What is aimed at now, or null (the sky, or nothing yet). */
  readonly target: Target | null
  /** What a cast may be: the spell in hand, and whatever a realm offers that is aimed. The wheel turns through them while a point is aimed at; `power` is the one a click casts, and its name is shown before the aim. */
  powers: readonly { name: string }[]
  power: number
  /** What it says of the aim, as the bar shows it. */
  readonly says: string
  /** Every edit the page applies, in order: the wand reads the world as it stands. */
  changed(edit: Edit): void
  /** What a cell is, edits and all. */
  kind(x: number, y: number, z: number): number
  /** Once a frame: looks at what is ahead. */
  frame(view: View): void
  draw(encoder: GPUCommandEncoder, to: Picture, view: View, time: number): void
  /** Aims afresh from this view and answers when the aim is whole (a thing gathered). For checks and for casting on a touch. */
  aim(view: View): Promise<Target | null>
  /** What a cast does with the target: set by whoever knows spells. */
  oncast: ((target: Target | null) => void) | null
  /** A flash on the aim, as when something is cast at it. */
  flash(): void
  /** Casts at what is aimed at: a flash on the aim, and `oncast`. */
  cast(): void
}

const CODE = /* wgsl */ `
struct U {
  // The eye and what is aimed at are measured from a whole cell near the eye, so far from the world's corner nothing wobbles.
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, time: f32,
  forward: vec3f, mode: f32,
  point: vec3f, ring: f32,
  lo: vec3f, struck: f32,
  hi: vec3f, ready: f32,
  // For a side: which way the chosen faces look, and whether only they are lit.
  normal: vec3f, side: f32,
  res: vec2f, pad1: vec2f,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var depths: texture_depth_2d;
@group(0) @binding(2) var cells: texture_3d<u32>;
// Where the march looked through a pane, how far off it was (a; 0 where it looked through none: march.ts panes).
@group(0) @binding(3) var panes: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}
const NEAR = 1.0;
const FAR = 100000.0;
// The wand's light: pale and cool where it only shows, warm where it strikes.
const SHOW = vec3f(0.62, 0.9, 1.0);
const STRIKE = vec3f(1.0, 0.78, 0.42);

fn chosen(c: vec3i) -> bool {
  let size = vec3i(textureDimensions(cells));
  let k = c - vec3i(u.lo);
  if (any(k < vec3i(0)) || any(k >= size)) { return false; }
  return textureLoad(cells, k, 0).r != 0u;
}
// How near a point on a box's skin is to one of the box's edges, 1 on it.
fn onEdge(p: vec3f, lo: vec3f, hi: vec3f, wide: f32) -> f32 {
  let d = min(abs(p - lo), abs(p - hi));
  // On an edge two of the three are nothing.
  let big = max(d.x, max(d.y, d.z));
  let small = min(d.x, min(d.y, d.z));
  let mid = d.x + d.y + d.z - big - small;
  return 1.0 - smoothstep(wide * 0.5, wide, mid);
}

@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / u.res) * 2.0 - 1.0;
  let rd = normalize(u.forward + u.right * (uv.x * u.tanHalf * u.aspect) - u.up * (uv.y * u.tanHalf));
  let depth = textureLoad(depths, vec2i(at.xy), 0);
  // The depth is of what is behind a pane the march looked through (#163): the wand stops at the pane, as a pick does.
  let pane = textureLoad(panes, vec2i(at.xy), 0).a;
  let sky = depth >= 0.999999 && pane <= 0.0;
  var t = (NEAR / max(1.0e-7, 1.0 - depth * (FAR - NEAR) / FAR)) / dot(rd, u.forward);
  if (pane > 0.0) { t = pane; }
  let pos = u.eye + rd * t;
  // How wide a pixel is where the picture is, in cells: lines are kept a pixel or two wide however far off.
  let px = t * u.tanHalf * 2.0 / u.res.y;
  let tint = mix(SHOW, STRIKE, u.struck);
  var light = 0.0;
  var cover = 0.0;

  if (u.mode == 1.0 && !sky) {
    // A point: a ring lying on whatever is round it, and a dot at its middle.
    let d = length(pos - u.point);
    let wide = max(u.ring * 0.14, px * 1.5);
    let beat = 1.0 + 0.08 * sin(u.time * 5.0) + u.struck * 0.9;
    let ring = 1.0 - smoothstep(wide * 0.5, wide, abs(d - u.ring * beat));
    let dot = 1.0 - smoothstep(u.ring * 0.16, u.ring * 0.16 + px * 1.5, d);
    light = max(ring, dot);
    cover = light * 0.55;
  }
  if (u.mode == 2.0) {
    // An area: its foot lit on the ground and on what stands in it, a line round it, a mark at each metre.
    if (!sky && all(pos > u.lo - vec3f(0.0, 3.0, 0.0)) && all(pos < u.hi)) {
      let edge = min(min(pos.x - u.lo.x, u.hi.x - pos.x), min(pos.z - u.lo.z, u.hi.z - pos.z));
      let line = 1.0 - smoothstep(max(0.6, px * 1.5), max(1.2, px * 3.0), edge);
      let across = abs(fract((pos.xz - u.lo.xz) / 10.0 + 0.5) - 0.5) * 10.0;
      let grid = (1.0 - smoothstep(px * 0.75, px * 1.5 + 0.1, min(across.x, across.y))) * 0.35;
      let low = 1.0 - smoothstep(0.0, 6.0, pos.y - u.lo.y);
      light = max(line, grid * low) ;
      cover = 0.16 * low + light * 0.5;
    }
    // Its box in lines: how big a thing made here will be.
    let inv = 1.0 / rd;
    let a = (u.lo - u.eye) * inv;
    let b = (u.hi - u.eye) * inv;
    let near = max(max(min(a.x, b.x), min(a.y, b.y)), min(a.z, b.z));
    let far = min(min(max(a.x, b.x), max(a.y, b.y)), max(a.z, b.z));
    if (far > max(near, 0.0)) {
      let limit = select(t, 1.0e9, sky);
      var lines = 0.0;
      if (near > 0.0 && near < limit) { lines = onEdge(u.eye + rd * near, u.lo, u.hi, max(0.5, near * u.tanHalf * 3.0 / u.res.y)); }
      if (far < limit) { lines = max(lines, 0.45 * onEdge(u.eye + rd * far, u.lo, u.hi, max(0.5, far * u.tanHalf * 3.0 / u.res.y))); }
      light = max(light, lines * 0.8);
      cover = max(cover, lines * 0.4);
    }
  }
  if (u.mode == 3.0 && !sky) {
    // A thing: its own cells lit, bands of light going up it, a line where it ends.
    let inside = pos + rd * 0.06;
    let c = vec3i(floor(inside));
    if (chosen(c)) {
      let f = fract(inside);
      // The face seen is the wall of the cell the look came in by: the one crossed last, of those with nothing chosen
      // beyond them. Asked of the place alone, every cell's edge was taken for a face and drawn as a line.
      var face = -1;
      var since = 1.0e9;
      for (var k = 0; k < 3; k++) {
        var back = vec3i(0); back[k] = select(1, -1, rd[k] > 0.0);
        let gone = select(1.0 - f[k], f[k], rd[k] > 0.0) / max(abs(rd[k]), 1.0e-4);
        if (gone < since && !chosen(c + back)) { since = gone; face = k; }
      }
      // One side of a thing: only the faces that look that way.
      var lit = 1.0;
      if (u.side > 0.0 && (face < 0 || u.normal[max(face, 0)] * rd[max(face, 0)] > -1.0e-4)) { lit = 0.0; }
      var rim = 0.0;
      let wide = max(0.16, px * 1.6);
      for (var k = 0; k < 3; k++) {
        if (k == face) { continue; }
        var one = vec3i(0); one[k] = 1;
        if (f[k] < wide && !chosen(c - one)) { rim = 1.0; }
        if (f[k] > 1.0 - wide && !chosen(c + one)) { rim = 1.0; }
      }
      let band = pow(0.5 + 0.5 * sin((pos.y + pos.x * 0.35 + pos.z * 0.35) * 0.55 - u.time * 3.2), 8.0);
      // Still being gathered: it flickers until all of it is known.
      let sure = mix(0.45 + 0.25 * sin(u.time * 20.0), 1.0, u.ready) * lit;
      light = (rim * 0.9 + band * 0.3) * sure;
      cover = (0.14 + rim * 0.45 + band * 0.1 + u.struck * 0.5) * sure;
    }
  }
  let colour = tint * (cover * 0.6 + light * 0.9);
  // The picture's fourth number is the last pass's own (how much a thing glows): left as it is.
  return vec4f(colour, min(cover, 0.85));
}
`

/** The first solid cell along a look, near where the marcher said something is: the cell, the way its face looks, how far. */
function meet(kind: (x: number, y: number, z: number) => number, eye: Cell, dir: Cell, t: number): { cell: Cell; normal: Cell; t: number } | null {
  const from = Math.max(0, t - 2), p = [eye[0] + dir[0] * from, eye[1] + dir[1] * from, eye[2] + dir[2] * from]
  const c = p.map(Math.floor), step = dir.map((d) => (d > 0 ? 1 : -1))
  const next = [0, 1, 2].map((a) => (Math.abs(dir[a]) < 1e-9 ? Infinity : ((dir[a] > 0 ? c[a] + 1 - p[a] : p[a] - c[a]) / Math.abs(dir[a]))))
  const each = dir.map((d) => (Math.abs(d) < 1e-9 ? Infinity : 1 / Math.abs(d)))
  // What the marcher draws far off is coarser than a cell: the cell itself may lie a little further on.
  const reach = 6 + t * 0.06
  let axis = [0, 1, 2].reduce((best, a) => (Math.abs(dir[a]) > Math.abs(dir[best]) ? a : best), 0), gone = 0
  for (let i = 0; i < 400 && gone <= reach; i++) {
    if (kind(c[0], c[1], c[2])) {
      const normal = [0, 0, 0]
      normal[axis] = -step[axis]
      return { cell: [c[0], c[1], c[2]], normal: normal as unknown as Cell, t: from + gone }
    }
    axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2
    gone = next[axis]
    next[axis] += each[axis]
    c[axis] += step[axis]
  }
  return null
}

const SIX: Cell[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

/**
 * Gathers a thing from the cell pointed at, a little each time it is asked on (so that a frame is never held up):
 * yields until done. Nearest first, so that when the cap is met what was taken is the part round the cell.
 */
function* gather(core: Core, start: Cell, normal: Cell, share: Share, budget = 3): Generator<null, { cells: Int32Array; kinds: Uint16Array; box: Box; share: Share; partial: boolean } | null> {
  const grounded = (x: number, y: number, z: number) => y < core.feet_at(x, z)
  const first = core.world_kind(start[0], start[1], start[2])
  if (!first || grounded(start[0], start[1], start[2])) return null
  const key = (x: number, y: number, z: number) => (x - start[0] + 1024) + (y - start[1] + 1024) * 2048 + (z - start[2] + 1024) * 4194304
  let began = performance.now()
  const flood = function* (same: boolean, most: number): Generator<null, { cells: number[]; kinds: number[]; partial: boolean }> {
    const seen = new Set<number>([key(...start)]), cells: number[] = [...start], kinds: number[] = [first]
    let partial = false
    for (let at = 0; at < kinds.length; at++) {
      if (kinds.length > most) { partial = true; break }
      if ((at & 255) === 255 && performance.now() - began > budget) { yield null; began = performance.now() }
      const x = cells[at * 3], y = cells[at * 3 + 1], z = cells[at * 3 + 2]
      for (const [dx, dy, dz] of SIX) {
        const X = x + dx, Y = y + dy, Z = z + dz, k = key(X, Y, Z)
        if (seen.has(k)) continue
        seen.add(k)
        if (Math.max(Math.abs(X - start[0]), Math.abs(Y - start[1]), Math.abs(Z - start[2])) >= ACROSS_MOST) { partial = true; continue }
        const kind = core.world_kind(X, Y, Z)
        if (!kind || (same ? kind !== first : grounded(X, Y, Z))) continue
        cells.push(X, Y, Z)
        kinds.push(kind)
      }
    }
    return { cells, kinds, partial }
  }
  let got = yield* flood(share === 'part', share === 'part' ? PART_MOST : CELLS_MOST), taken = share
  // Too big to be one thing (a terrace of houses is joined from end to end): the part pointed at.
  if (share !== 'part' && got.partial) { got = yield* flood(true, PART_MOST); taken = share === 'side' ? 'side' : 'part' }
  if (share === 'side') {
    // Of those, the ones that show a face the way the pointed face looks.
    const cells: number[] = [], kinds: number[] = []
    for (let i = 0; i < got.kinds.length; i++) {
      const x = got.cells[i * 3], y = got.cells[i * 3 + 1], z = got.cells[i * 3 + 2]
      if (core.world_kind(x + normal[0], y + normal[1], z + normal[2])) continue
      cells.push(x, y, z)
      kinds.push(got.kinds[i])
    }
    got = { cells, kinds, partial: got.partial }
  }
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < got.cells.length; i++) { const a = i % 3; box[a] = Math.min(box[a], got.cells[i]); box[a + 3] = Math.max(box[a + 3], got.cells[i] + 1) }
  return { cells: Int32Array.from(got.cells), kinds: Uint16Array.from(got.kinds), box: box as unknown as Box, share: taken, partial: got.partial }
}

const STUFF = ['air', 'earth', 'rock', 'grass', 'sand', 'water', 'asphalt', 'concrete', 'brick', 'plaster', 'wood', 'glass', 'steel', 'leaves', 'roofing', 'lamp']
const metres = (cells: number) => (cells / 10).toFixed(cells < 100 ? 1 : 0)

export async function wand(device: GPUDevice, format: GPUTextureFormat, march: Marcher, core: Core, keys: Input, over: Hud): Promise<Wand> {
  const module = await shader(device, 'wand', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'wand', layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
  })
  const block = new ArrayBuffer(144), floats = new Float32Array(block)
  const uniforms = device.createBuffer({ size: block.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const none = device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'r8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  let mask = none, bound: { depth: GPUTextureView; mask: GPUTexture; panes: GPUTextureView; group: GPUBindGroup } | null = null

  let held = false, mode: Mode = 'point', share: Share = 'whole'
  const area: [number, number, number] = [30, 30, 30]
  /** What the look last met. */
  let met: { cell: Cell; normal: Cell; at: Cell; t: number } | null = null
  /** The thing gathered, the cell and share it was gathered for, and the gathering still going on. */
  let thing: Extract<Target, { how: 'thing' }> | null = null, chosen = new Set<number>(), wanted: { cell: Cell; normal: Cell; share: Share } | null = null
  let going: ReturnType<typeof gather> | null = null
  let powers: readonly { name: string }[] = [], power = 0
  let looking = false, flash = 0, lastFrame = performance.now(), note = ''
  const waiting: (() => void)[] = []
  const pack = (x: number, y: number, z: number) => x + (y + 2048) * 1048576 + z * 4294967296

  const forget = () => { thing = null; chosen = new Set(); wanted = null; going = null; if (mask !== none) { mask.destroy(); mask = none } }
  /** The thing's cells as the GPU is shown them: one byte a cell of the box round it. */
  const show = (t: Extract<Target, { how: 'thing' }>) => {
    const size = [t.box[3] - t.box[0], t.box[4] - t.box[1], t.box[5] - t.box[2]], bytes = new Uint8Array(size[0] * size[1] * size[2])
    chosen = new Set()
    for (let i = 0; i < t.kinds.length; i++) {
      const x = t.cells[i * 3], y = t.cells[i * 3 + 1], z = t.cells[i * 3 + 2]
      bytes[(x - t.box[0]) + size[0] * ((y - t.box[1]) + size[1] * (z - t.box[2]))] = 1
      chosen.add(pack(x, y, z))
    }
    if (mask !== none) mask.destroy()
    mask = device.createTexture({ size, dimension: '3d', format: 'r8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    device.queue.writeTexture({ texture: mask }, bytes, { bytesPerRow: size[0], rowsPerImage: size[1] }, size)
  }
  /** Goes on with the gathering for a few ms. */
  const gatherOn = () => {
    if (!going || !wanted) return
    const step = going.next()
    if (!step.done) return
    going = null
    const got = step.value
    if (!got || !got.kinds.length) { thing = null; chosen = new Set(); if (mask !== none) { mask.destroy(); mask = none }; note = 'That is the ground: aim at something standing on it'; return }
    thing = { how: 'thing', share: got.share, cell: wanted.cell, normal: wanted.normal, box: got.box, cells: got.cells, kinds: got.kinds, partial: got.partial }
    note = ''
    show(thing)
  }
  const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
  /** What the look met has changed: a thing is gathered afresh only when the cell is not one already chosen. */
  const choose = () => {
    if (mode !== 'thing' || !met) return
    const stale = !wanted || wanted.share !== share || (share === 'side' && !sameCell(wanted.normal, met.normal))
    if (!stale && (sameCell(wanted!.cell, met.cell) || (!going && chosen.has(pack(...met.cell))))) return
    wanted = { cell: met.cell, normal: met.normal, share }
    going = gather(core, met.cell, met.normal, share)
  }
  const look = async (view: View) => {
    looking = true
    try {
      const hit = await march.pick(view)
      const found = hit && meet(core.world_kind, view.eye, view.forward, hit.t)
      if (!hit) met = null
      else if (found) met = { ...found, at: [view.eye[0] + view.forward[0] * found.t, view.eye[1] + view.forward[1] * found.t, view.eye[2] + view.forward[2] * found.t] }
      // Too far off to say which cell: the place alone.
      else met = { cell: view.eye.map((e, a) => Math.floor(e + view.forward[a] * (hit.t + 0.5))) as unknown as Cell, normal: [0, 1, 0], at: view.eye.map((e, a) => e + view.forward[a] * hit.t) as unknown as Cell, t: hit.t }
      choose()
    } finally { looking = false }
  }
  /** The area's box where the look meets the ground: on top of what is there, or at the foot of a wall. */
  const areaBox = (): Box | null => {
    if (!met) return null
    const up = met.normal[1] > 0, x = met.cell[0] + (up ? 0 : met.normal[0]), z = met.cell[2] + (up ? 0 : met.normal[2])
    let y = met.cell[1] + (up ? 1 : 0)
    if (!up) for (let i = 0; i < 300 && !core.world_kind(x, y - 1, z); i++) y--
    const x0 = x - (area[0] >> 1), z0 = z - (area[1] >> 1)
    return [x0, y, z0, x0 + area[0], y + area[2], z0 + area[1]]
  }
  const target = (): Target | null => {
    if (!met) return null
    if (mode === 'point') return { how: 'point', at: met.at, cell: met.cell, normal: met.normal }
    if (mode === 'area') { const box = areaBox(); return box && { how: 'area', box } }
    return going ? null : thing
  }
  const says = () => {
    if (!met) return 'Nothing there'
    if (mode === 'point') return `A point ${metres(met.t)} m off`
    if (mode === 'area') return `${metres(area[0])} by ${metres(area[1])} m, ${metres(area[2])} m high`
    if (going) return 'Looking…'
    if (!thing) return note || 'Nothing there'
    const most = new Map<number, number>()
    for (const k of thing.kinds) most.set(k & 15, (most.get(k & 15) ?? 0) + 1)
    const stuff = STUFF[[...most].sort((a, b) => b[1] - a[1])[0][0]]
    const size = `${metres(thing.box[3] - thing.box[0])} by ${metres(thing.box[5] - thing.box[2])} m, ${metres(thing.box[4] - thing.box[1])} m high`
    const what = thing.share === 'whole' ? 'The whole thing' : thing.share === 'part' ? (share === 'whole' ? 'Too big to be one thing: this part' : 'This part') : 'This side'
    return `${what}: ${stuff}, ${size}${thing.partial && thing.share !== 'whole' ? ' (the nearest of it)' : ''}`
  }

  const self: Wand = {
    get held() { return held },
    set held(v: boolean) {
      if (v === held) return
      held = v
      leave?.()
      leave = v ? keys.push(aiming) : null
      if (!v) { met = null; forget() }
      panel.show()
    },
    get mode() { return mode },
    set mode(v: Mode) { mode = v; forget(); choose(); panel.show() },
    get share() { return share },
    set share(v: Share) { share = v; choose(); panel.show() },
    get area() { return area },
    set area(v: [number, number, number]) { for (let a = 0; a < 3; a++) area[a] = Math.max(AREA_LEAST, Math.min(AREA_MOST, Math.round(v[a]))) },
    get target() { return target() },
    get says() { return says() },
    oncast: null,
    get powers() { return powers },
    set powers(v: readonly { name: string }[]) { const was = powers[power]?.name; powers = v; power = Math.max(0, v.findIndex((p) => p.name === was)) },
    get power() { return power },
    set power(v: number) { if (powers.length) power = ((Math.round(v) % powers.length) + powers.length) % powers.length },
    changed(edit) {
      const room = core.edits_room(edit.words.length)
      new Int32Array(core.memory.buffer, room, edit.words.length).set(edit.words)
      core.world_edit(-1)
      // What was chosen may not be there any more, or not as it was.
      if (thing && edit.box[0] < thing.box[3] && edit.box[3] > thing.box[0] && edit.box[1] < thing.box[4] && edit.box[4] > thing.box[1] && edit.box[2] < thing.box[5] && edit.box[5] > thing.box[2]) forget()
    },
    kind: (x, y, z) => core.world_kind(x, y, z),
    frame(view) {
      const now = performance.now()
      flash = Math.max(0, flash - (now - lastFrame) / 350)
      lastFrame = now
      if (!held) return
      gatherOn()
      if (!looking && !going) void look(view).then(() => { for (const done of waiting.splice(0)) done() })
      panel.tell()
    },
    async aim(view) {
      // After whatever look is on its way, one from this view; then the gathering to its end.
      while (looking) await new Promise<void>((done) => waiting.push(done))
      await look(view)
      while (going) { gatherOn(); if (going) await new Promise((done) => setTimeout(done, 0)) }
      return target()
    },
    flash() { flash = 1 },
    cast() {
      flash = 1
      self.oncast?.(target())
    },
    draw(encoder, to, view, time) {
      const aimed = held && met ? target() : null, showing = held && met && (aimed || (mode === 'thing' && mask !== none))
      if (!showing && flash <= 0) return
      const anchor = view.eye.map(Math.floor), rel = (p: readonly number[]) => [p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]]
      const box = mode === 'area' ? areaBox() : mode === 'thing' && thing ? thing.box : null
      floats.set([...rel(view.eye), view.tanHalf, ...view.right, to.size[0] / to.size[1], ...view.up, time % 1000, ...view.forward, showing ? MODES.indexOf(mode) + 1 : 0])
      // A ring big enough to be seen from where the eye is, and never smaller than a hand.
      floats.set([...rel(met?.at ?? view.eye), Math.max(2.5, (met?.t ?? 0) * 0.03), ...(box ? rel(box) : [0, 0, 0]), flash, ...(box ? rel(box.slice(3)) : [0, 0, 0]), going ? 0 : 1, ...(thing?.normal ?? [0, 1, 0]), mode === 'thing' && thing?.share === 'side' ? 1 : 0, to.size[0], to.size[1]], 16)
      device.queue.writeBuffer(uniforms, 0, block)
      const panes = march.panes(to.size)
      if (!bound || bound.depth !== to.depth || bound.mask !== mask || bound.panes !== panes) bound = { depth: to.depth, mask, panes, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: to.depth }, { binding: 2, resource: mask.createView() }, { binding: 3, resource: panes }] }) }
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }] })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bound.group)
      pass.draw(3)
      pass.end()
    },
  }

  // ── The bar (a panel of the page's one layer, hud.ts; its look is in index.html) ─────────────────────────
  const panel = (() => {
    const root = over.panel('wand'), told = document.createElement('div'), row = document.createElement('div'), take = document.createElement('button')
    told.className = 'says'; row.className = 'row'
    // On a phone there is no wheel: a touch on the line turns to the next thing a cast may be.
    told.addEventListener('click', () => { self.power = power + 1 })
    const q = document.createElement('i'); q.textContent = 'Q'
    take.append(q, 'Wand'); take.setAttribute('aria-label', 'Take the wand in hand, or put it away')
    take.addEventListener('click', () => { self.held = !held; take.blur() })
    const button = (label: string, key: string, act: () => void) => { const b = document.createElement('button'); if (key) { const k = document.createElement('i'); k.textContent = key; b.append(k) } b.append(label); b.addEventListener('click', () => { act(); b.blur() }); row.append(b); return b }
    const modes = MODES.map((m, i) => button(m === 'point' ? 'Point' : m === 'area' ? 'Area' : 'Thing', String(i + 1), () => { self.mode = m }))
    const gap = document.createElement('div'); gap.className = 'gap'; row.append(gap)
    const shares = SHARES.map((s) => button(s === 'whole' ? 'Whole' : s === 'part' ? 'Part' : 'Side', '', () => { self.share = s }))
    const smaller = button('Smaller', '', () => resize(0.8)), bigger = button('Bigger', '', () => resize(1.25))
    root.append(told, row)
    over.panel('wand-take').append(take)
    let last = ''
    return {
      show() {
        document.body.classList.toggle('wand', held)
        take.classList.toggle('on', held)
        modes.forEach((b, i) => b.classList.toggle('on', MODES[i] === mode))
        shares.forEach((b, i) => { b.hidden = mode !== 'thing'; b.classList.toggle('on', SHARES[i] === share) })
        for (const b of [smaller, bigger]) b.hidden = mode !== 'area'
        gap.hidden = mode === 'point'
      },
      tell() { const text = `${powers[power] ? `${powers[power].name} · ` : ''}${says()}`; if (text !== last) told.textContent = last = text },
    }
  })()
  /** An area made bigger or smaller, all three ways together; `only` picks one way (0 across, 1 deep, 2 high). */
  const resize = (by: number, only?: number) => {
    const next = area.map((v, a) => (only === undefined || only === a ? Math.max(v + Math.sign(by - 1), v * by) : v)) as [number, number, number]
    self.area = next
  }
  // ── Its keys: a mode of the page's one owner of them (input.ts), there while the wand is in hand ───────
  let leave: (() => void) | null = null
  const aiming = {
    name: 'aiming',
    // In hand, the number keys pick how it aims, not a tool.
    key(code: string) {
      const i = Number(code.replace('Digit', '')) - 1
      if (code.startsWith('Digit')) { if (i >= 0 && i < MODES.length) self.mode = MODES[i]; return true }
      if (code === 'KeyX' && mode === 'thing') { self.share = SHARES[(SHARES.indexOf(share) + 1) % SHARES.length]; return true }
      return false
    },
    // A click casts; so does the round button on a phone.
    use() { self.cast(); return true },
    // The wheel sizes an area (with Shift its height alone, with Alt its depth alone) and turns through whole, part and side of a thing.
    wheel(deltaY: number) {
      // A point: the wheel turns through what a cast may be, when there is more than one.
      if (mode === 'point') { if (powers.length < 2) return false; self.power = power + (deltaY < 0 ? -1 : 1); return true }
      const up = deltaY < 0, shift = keys.held('ShiftLeft') || keys.held('ShiftRight'), alt = keys.held('AltLeft') || keys.held('AltRight')
      if (mode === 'area') resize(up ? 1.12 : 1 / 1.12, shift ? 2 : alt ? 1 : undefined)
      else self.share = SHARES[(SHARES.indexOf(share) + (up ? 1 : SHARES.length - 1)) % SHARES.length]
      return true
    },
  }
  keys.always('KeyQ', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return false; self.held = !held; return true })
  panel.show()
  return self
}
