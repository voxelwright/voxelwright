// Building by hand (#226): every shape added and carved, the rake levelling bumps and laying a ramp, undo and redo
// back to the very same world, and where a shape goes under each snap. Pure Node, no browser, no core: edits are
// applied by reading their words as the core does ([1, n, x0, x1, y, z, kind, …]).
//   node test/build-tools.mjs
import assert from 'node:assert/strict'
import { EditUndoStack, SHAPES, SIZES, basisOf, captureBefore, rakeRuns, runsOf, snapPlacement, stampEdit, stampRuns } from '../page/build-tools.ts'

const t0 = performance.now()
let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }

// ── A small world in a typed array ─────────────────────────────────────────────────────────────────────
const N = 96, at = (x, y, z) => x + N * (y + N * z)
const world = () => {
  const cells = new Uint16Array(N * N * N)
  return {
    cells,
    kind: (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= N || y >= N || z >= N ? 0 : cells[at(x, y, z)]),
    /** Applies an edit by its words alone. */
    apply(edit) {
      const w = edit.words
      assert.equal(w[0], 1, 'an edit of rows')
      assert.equal(w.length, 2 + w[1] * 5)
      for (let i = 2; i < w.length; i += 5) for (let x = w[i]; x < w[i + 1]; x++) cells[at(x, w[i + 2], w[i + 3])] = w[i + 4]
    },
  }
}

/** Rows are in order (y, z, x), each at least one cell, none overlapping, all inside the box. */
function wellFormed(runs, box, what) {
  for (let i = 0; i < runs.length; i += 5) {
    const [x0, x1, y, z] = runs.subarray(i, i + 4)
    ok(x0 < x1, `${what}: row ${i / 5} is empty`)
    ok(x0 >= box[0] && x1 <= box[3] && y >= box[1] && y < box[4] && z >= box[2] && z < box[5], `${what}: row ${i / 5} outside the box`)
    if (i) {
      const [px1, py, pz] = [runs[i - 4], runs[i - 3], runs[i - 2]]
      const order = py - y || pz - z
      ok(order < 0 || (order === 0 && px1 <= x0), `${what}: rows out of order or overlapping at ${i / 5}`)
    }
  }
}
const cellsOf = (runs) => { const s = new Set(); for (let i = 0; i < runs.length; i += 5) for (let x = runs[i]; x < runs[i + 1]; x++) s.add(`${x},${runs[i + 2]},${runs[i + 3]}`); return s }
const has = (runs, x, y, z) => cellsOf(runs).has(`${x},${y},${z}`)

// ── Shapes ─────────────────────────────────────────────────────────────────────────────────────────────
const O = [48, 10, 48], BRICK = 8
for (const shape of SHAPES) {
  for (const mode of ['add', 'carve']) {
    const s = stampRuns(shape, O, { mode, kind: BRICK })
    wellFormed(s.runs, s.box, `${shape} ${mode}`)
    ok(s.cells > 0, `${shape} ${mode} has cells`)
    ok(s.cells === cellsOf(s.runs).size, `${shape} ${mode}: cells counted once each`)
    for (let i = 4; i < s.runs.length; i += 5) ok(s.runs[i] === (mode === 'add' ? BRICK : 0), `${shape} ${mode}: kind`)
    const [W, H, D] = SIZES[shape]
    ok(s.box[3] - s.box[0] <= W && s.box[4] - s.box[1] <= H && s.box[5] - s.box[2] <= D, `${shape} ${mode}: within its size`)
    // Turned a quarter at a time, it is the same many cells, and the box swaps across and deep.
    for (const yaw of [90, 180, 270]) {
      const t = stampRuns(shape, O, { mode, kind: BRICK, yaw })
      wellFormed(t.runs, t.box, `${shape} ${mode} yaw ${yaw}`)
      ok(t.cells === s.cells, `${shape} ${mode} yaw ${yaw}: ${t.cells} cells, not ${s.cells}`)
      const q = yaw % 180 === 90
      ok(t.box[3] - t.box[0] === (q ? s.box[5] - s.box[2] : s.box[3] - s.box[0]), `${shape} ${mode} yaw ${yaw}: across`)
    }
    // The same call twice gives the very same rows.
    ok(Buffer.compare(Buffer.from(s.runs.buffer), Buffer.from(stampRuns(shape, O, { mode, kind: BRICK }).runs.buffer)) === 0, `${shape} deterministic`)
  }
}
// A wall is the whole box; a solid shape carves what it adds.
const wall = stampRuns('wall', O, { mode: 'add', kind: BRICK })
ok(wall.cells === 20 * 30 * 4, 'a wall fills 2 m by 3 m by 40 cm')
ok(wall.runs.length / 5 === 30 * 4, 'a wall is one row per line of cells')
ok(stampRuns('wall', O, { mode: 'add', kind: BRICK, thickness: 2 }).cells === 20 * 30 * 2, 'a wall thinned')
for (const shape of ['wall', 'slab', 'stairs', 'roof', 'pillar']) ok(stampRuns(shape, O, { mode: 'carve' }).cells === stampRuns(shape, O, { mode: 'add', kind: 1 }).cells, `${shape}: carving takes what adding puts`)
ok(stampRuns('slab', O, { mode: 'add', kind: 1 }).cells === 20 * 2 * 20, 'a slab')
// Arch: the wall and its opening together are the whole wall, and the opening is round at the top.
{
  const add = stampRuns('arch', O, { mode: 'add', kind: BRICK }), hole = stampRuns('arch', O, { mode: 'carve' })
  ok(add.cells + hole.cells === 20 * 30 * 4, 'an arch and its opening make a wall')
  const a = cellsOf(add.runs), h = cellsOf(hole.runs)
  for (const c of h) ok(!a.has(c), 'the opening is not in the arch')
  // From the foot (x 38…58, y 10…40): the opening is 12 wide at the floor and reaches up to 26 cells, narrowing near its top.
  const z = 48
  ok(has(hole.runs, 48, 10, z) && has(hole.runs, 42, 10, z) && !has(hole.runs, 41, 10, z) && has(hole.runs, 53, 10, z) && !has(hole.runs, 54, 10, z), 'opening 12 cells at the floor')
  ok(has(hole.runs, 48, 10 + 25, z) && !has(hole.runs, 48, 10 + 26, z), 'opening 2.6 m high in the middle')
  ok(!has(hole.runs, 42, 10 + 24, z) && has(hole.runs, 42, 10 + 19, z), 'the opening rounds off toward its sides')
  ok(has(add.runs, 48, 10 + 29, z), 'a head over the arch')
}
// Window and door cuts: carving empties the opening; adding frames it.
for (const [shape, sill] of [['window_cut', true], ['door_cut', false]]) {
  const [W, H, D] = SIZES[shape]
  const cut = stampRuns(shape, O, { mode: 'carve' }), frame = stampRuns(shape, O, { mode: 'add', kind: 10 })
  ok(cut.cells === W * H * D, `${shape}: the whole opening carved`)
  const ring = 2 * H + W - 2 + (sill ? W - 2 : 0)
  ok(frame.cells === ring * D, `${shape}: a frame of ${ring} cells round, ${frame.cells / D} found`)
  ok(!has(frame.runs, O[0], O[1] + 3, O[2]), `${shape}: the frame is open in the middle`)
  ok(has(frame.runs, O[0], O[1], O[2]) === sill, `${shape}: ${sill ? 'a sill' : 'no sill, a door goes to the floor'}`)
}
// Stairs: as many risers as asked, each two cells high and two deep.
{
  const st = stampRuns('stairs', [5, 0, 10], { mode: 'add', kind: 7, steps: 10 })
  const tops = []
  for (let w = 0; w < 20; w++) { let top = -1; for (let y = 0; y < 20; y++) if (has(st.runs, 5, y, w)) top = y; tops.push(top) }
  const risers = new Set(tops).size
  ok(risers === 10, `ten steps, found ${risers}`)
  for (let w = 1; w < 20; w++) ok(tops[w] - tops[w - 1] === (w % 2 === 0 ? 2 : 0), `stairs: tread ${w}`)
  ok(tops[0] === 1 && tops[19] === 19, 'stairs from 20 cm to the top')
  // Turned to look along +x (yaw 90), they climb along +x.
  const east = stampRuns('stairs', [10, 0, 5], { mode: 'add', kind: 7, yaw: 90 })
  ok(has(east.runs, 1, 1, 5) && !has(east.runs, 1, 2, 5) && has(east.runs, 19, 19, 5), 'stairs turned climb the way they face')
}
// Roof: at 45°, each cell toward the ridge is a cell higher.
{
  const roof = stampRuns('roof', [10, 0, 10], { mode: 'add', kind: 14 })
  const tops = []
  for (let w = 0; w < 20; w++) { let top = -1; for (let y = 0; y < 12; y++) if (has(roof.runs, 10, y, w)) top = y; tops.push(top) }
  for (let w = 1; w < 10; w++) ok(tops[w] - tops[w - 1] === 1, `roof rises 1 in 1 at ${w}`)
  for (let w = 11; w < 20; w++) ok(tops[w] - tops[w - 1] === -1, `roof falls 1 in 1 at ${w}`)
  ok(!has(roof.runs, 10, 0, 10), 'the roof is a skin, not a block')
}
// Pillar: chamfered corners.
ok(stampRuns('pillar', O, { mode: 'add', kind: 7 }).cells === (16 - 4) * 30, 'a pillar with its four corners cut')
ok(stampRuns('pillar', O, { mode: 'add', kind: 7, chamfer: 0 }).cells === 16 * 30, 'a square pillar')
// Turned off the quarter, it still makes a wall of about the same many cells.
{
  const w45 = stampRuns('wall', O, { mode: 'add', kind: 8, yaw: 45 })
  wellFormed(w45.runs, w45.box, 'wall at 45°')
  ok(Math.abs(w45.cells - 2400) / 2400 < 0.12, `a wall at 45° (cell-centre sampling on the lattice): ${w45.cells} cells`)
}
assert.throws(() => stampRuns('wall', O, { mode: 'add' }), /kind/)

// ── The rake ───────────────────────────────────────────────────────────────────────────────────────────
{
  // Bumpy ground: earth with a bump and a dip, grass on top; the rake levels it to y = 20.
  const w = world()
  const ground = (x, z) => 20 + Math.round(3 * Math.sin(x * 0.7) * Math.cos(z * 0.5))
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { const g = ground(x, z); for (let y = 0; y < g; y++) w.cells[at(x, y, z)] = y === g - 1 ? 3 : 1 }
  const before = w.cells.slice()
  const c = [48, 20, 48], r = 12
  const rake = rakeRuns(w.kind, c, [0, 1, 0], r, null, 6)
  wellFormed(rake.runs, rake.box, 'rake')
  ok(rake.filled > 0 && rake.trimmed > 0, `the rake fills and cuts (${rake.filled} filled, ${rake.trimmed} cut)`)
  const undo = new EditUndoStack()
  w.apply(undo.record(w.kind, rake.runs, 'rake'))
  let outside = 0
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + 0.5 - c[0], z + 0.5 - c[2]), inBrush = d <= r
    let top = 0
    for (let y = 0; y < N; y++) if (w.kind(x, y, z)) top = y + 1
    if (inBrush) ok(top === 20, `levelled at ${x},${z}: ${top}`)
    for (let y = 0; y < N; y++) if (w.cells[at(x, y, z)] !== before[at(x, y, z)] && !inBrush) outside++
  }
  ok(outside === 0, 'nothing changes outside the brush')
  // What fills a dip is what the ground's top was.
  ok(w.kind(48, 19, 48) !== 0, 'ground under the plane')
  // Undo gives back the bumps.
  w.apply(undo.undo())
  ok(Buffer.compare(Buffer.from(w.cells.buffer), Buffer.from(before.buffer)) === 0, 'the rake undone')
  // A limit of 1 changes no column by more than one cell.
  const small = rakeRuns(w.kind, c, [0, 1, 0], r, 4, 1)
  for (let i = 0; i < small.runs.length; i += 5) ok(Math.abs(small.runs[i + 2] - 20) <= 1, 'within maxDeltaY')
  ok(small.runs.every((v, i) => i % 5 !== 4 || v === 0 || v === 4), 'filled with the material asked for')
}
{
  // A ramp: flat ground at 20, a plane leaning so it climbs 1 in 2 along +x.
  const w = world()
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) for (let y = 0; y < 20; y++) w.cells[at(x, y, z)] = 1
  const n = [-1, 2, 0], c = [48, 20, 48]
  const ramp = rakeRuns(w.kind, c, n, 10, 7, 8)
  wellFormed(ramp.runs, ramp.box, 'ramp')
  w.apply({ words: Int32Array.of(1, ramp.runs.length / 5, ...ramp.runs), box: ramp.box })
  const top = (x, z) => { let t = 0; for (let y = 0; y < N; y++) if (w.kind(x, y, z)) t = y + 1; return t }
  for (const x of [40, 44, 48, 52, 56]) ok(top(x, 48) === Math.round(20 + (x + 0.5 - 48) / 2), `ramp at x ${x}: ${top(x, 48)}`)
  ok(top(56, 48) > top(40, 48), 'the ramp climbs')
  ok(w.kind(56, 22, 48) === 7, 'raised with the material asked for')
  assert.throws(() => rakeRuns(w.kind, c, [1, 0, 0], 10, 7, 8), /face up/)
  // Water is not ground: over a pond nothing is filled.
  const pond = world()
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) for (let y = 0; y < 18; y++) pond.cells[at(x, y, z)] = y < 10 ? 1 : 5
  ok(rakeRuns(pond.kind, [48, 20, 48], [0, 1, 0], 6, 7, 4).cells === 0, 'no ground within reach: nothing changed')
  // A wall taller than the rake reaches stands in the brush: its foot is not cut, so it is not left hanging.
  const walled = world()
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) for (let y = 0; y < 22; y++) walled.cells[at(x, y, z)] = 1
  for (let y = 22; y < 50; y++) for (let x = 46; x < 50; x++) walled.cells[at(x, y, 48)] = 8
  const cut = rakeRuns(walled.kind, [48, 20, 48], [0, 1, 0], 8, null, 4)
  const hit = cellsOf(cut.runs)
  ok(cut.trimmed > 0, 'the ground round the wall is cut')
  for (let x = 46; x < 50; x++) ok(![20, 21, 22, 23].some((y) => hit.has(`${x},${y},48`)), `the wall's foot at ${x} is left`)
}

// ── Undo and redo ──────────────────────────────────────────────────────────────────────────────────────
{
  const w = world()
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) for (let y = 0; y < 12; y++) w.cells[at(x, y, z)] = y < 11 ? 1 : 3
  const original = w.cells.slice(), stack = new EditUndoStack(64)
  const steps = [
    ['wall', [40, 12, 40], { mode: 'add', kind: 8 }],
    ['arch', [40, 12, 40], { mode: 'carve' }],
    ['slab', [44, 42, 44], { mode: 'add', kind: 7 }],
    ['door_cut', [40, 12, 41], { mode: 'carve', yaw: 90 }],
    ['roof', [44, 44, 44], { mode: 'add', kind: 14, yaw: 90 }],
    ['pillar', [36, 10, 38], { mode: 'carve' }],
    ['stairs', [50, 12, 46], { mode: 'add', kind: 10, yaw: 180 }],
  ]
  const after = []
  for (const [shape, o, opts] of steps) {
    const s = stampRuns(shape, o, opts)
    w.apply(stack.record(w.kind, s.runs, shape))
    after.push(w.cells.slice())
  }
  const r = rakeRuns(w.kind, [44, 12, 44], [0, 1, 0], 9, 4, 5)
  w.apply(stack.record(w.kind, r.runs, 'rake'))
  after.push(w.cells.slice())
  ok(stack.watermark === steps.length + 1 && stack.undoLabel === 'rake', 'every step kept')
  const same = (a, b) => Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0
  // All the way back, a step at a time, each step back to the world before it.
  for (let i = after.length - 1; i >= 0; i--) {
    w.apply(stack.undo())
    ok(same(w.cells, i ? after[i - 1] : original), `undo to before step ${i}`)
  }
  ok(stack.undo() === null && same(w.cells, original), 'back to the very same world')
  // And forward again.
  for (let i = 0; i < after.length; i++) { w.apply(stack.redo()); ok(same(w.cells, after[i]), `redo step ${i}`) }
  ok(stack.redo() === null, 'nothing more to redo')
  // A new step after undoing drops what was undone.
  w.apply(stack.undo()); w.apply(stack.undo())
  w.apply(stack.record(w.kind, stampRuns('wall', [60, 12, 60], { mode: 'add', kind: 2 }).runs, 'late wall'))
  ok(!stack.canRedo && stack.undoLabel === 'late wall', 'a new step drops the undone ones')
  // Rewinding to a mark takes back everything since, in order.
  const mark = 3, back = stack.truncateTo(mark)
  for (const e of back.edits) w.apply(e)
  ok(back.reached && stack.watermark === mark && same(w.cells, after[mark - 1]), 'truncated to mark 3')
  const rest = stack.truncateTo(0)
  for (const e of rest.edits) w.apply(e)
  ok(same(w.cells, original), 'truncated to the start')
  // Bounded: past its depth the oldest go, and a mark older than them cannot be reached.
  const short = new EditUndoStack(3)
  for (let i = 0; i < 5; i++) short.record(w.kind, stampRuns('slab', [20, 30 + i * 3, 20], { mode: 'add', kind: 1 }).runs, `slab ${i}`)
  ok(short.floor === 2 && short.watermark === 5, 'three kept of five')
  ok(!short.truncateTo(0).reached && short.watermark === 2, 'a dropped mark is not reached')
  // Capture keeps air as air.
  const cap = captureBefore(() => 0, Int32Array.of(0, 4, 0, 0, 9))
  ok(cap.length === 5 && cap[0] === 0 && cap[1] === 4 && cap[4] === 0, 'air captured as a row of kind 0')
  // Single cells into rows: last word wins, neighbours join.
  ok(runsOf([2, 0, 0, 5, 1, 0, 0, 5, 1, 0, 0, 6, 3, 0, 0, 5]).join() === '1,2,0,0,6,2,4,0,0,5', 'runsOf joins and keeps the last word')
}

// ── Where a shape goes ─────────────────────────────────────────────────────────────────────────────────
{
  const near = (a, b, msg) => ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-6), `${msg}: ${a} not ${b}`)
  const snap = { mode: 'global', step: 10, yaw: 100, pitch: 30, roll: 5, angleStep: 15 }
  // Global: on a floor, yaw to the nearest quarter, the low corner on the 1 m grid, no pitch or roll.
  let p = snapPlacement([123.4, 20, 87.2], [0, 1, 0], [20, 30, 4], snap)
  ok(p.yaw === 90 && p.pitch === 0 && p.roll === 0, 'global: a quarter turn, upright')
  near(p.origin, [122, 20, 90], 'global on a floor')
  ok((p.origin[0] - 4 / 2) % 10 === 0 && (p.origin[2] - 20 / 2) % 10 === 0, 'global: low corner on the grid')
  // Against a wall looking +x: its back on the wall, x from the face out.
  p = snapPlacement([60, 23.7, 41.3], [1, 0, 0], [20, 30, 4], { ...snap, yaw: 90, step: 2 })
  near(p.origin, [62, 22, 42], 'global against a wall')
  // Under a ceiling: it hangs.
  p = snapPlacement([10, 50, 10], [0, -1, 0], [20, 2, 20], { ...snap, yaw: 0, step: 1 })
  ok(p.origin[1] === 48, 'global under a ceiling hangs')
  // Carving goes into the face.
  p = snapPlacement([60, 23, 41], [1, 0, 0], [10, 22, 6], { ...snap, yaw: 90, step: 1, into: true })
  near(p.origin, [57, 23, 41], 'global carving into a wall')
  // Local: against a wall the shape looks out of it, its back on it.
  p = snapPlacement([60, 23, 41], [-1, 0, 0], [20, 30, 4], { ...snap, mode: 'local' })
  ok(p.yaw === 270 && p.pitch === 0 && p.roll === 0, `local: faces out of the wall (${p.yaw})`)
  near(p.origin, [58, 23, 41], 'local against a wall')
  near(p.basis.forward, [-1, 0, 0], 'local: forward is the normal')
  // A door carved where it is aimed, through the wall: the cells of the cut are in the wall, not in front of it.
  p = snapPlacement([60, 12, 41], [-1, 0, 0], [10, 22, 6], { ...snap, mode: 'local', into: true })
  const door = stampRuns('door_cut', p.origin, { mode: 'carve', yaw: p.yaw })
  ok(door.box[0] === 60 && door.box[3] === 66 && door.box[1] === 12, `the door goes into the wall: ${door.box}`)
  // Local on a 45° slope: up along the normal.
  p = snapPlacement([30, 20, 30], [0, 1, 1], [20, 2, 20], { ...snap, mode: 'local', yaw: 0 })
  near(p.basis.up, [0, Math.SQRT1_2, Math.SQRT1_2], 'local on a slope: up along the normal')
  ok(Math.abs(p.pitch - 45) < 1e-9 && p.roll === 0, `local on a slope: pitched 45 (${p.pitch})`)
  // Stamped as placed: a slab tilted on the slope, whole and about as many cells as flat.
  const tilted = stampRuns('slab', p.origin, { mode: 'add', kind: 7, yaw: p.yaw, pitch: p.pitch, roll: p.roll })
  wellFormed(tilted.runs, tilted.box, 'slab on a slope')
  ok(Math.abs(tilted.cells - 800) / 800 < 0.12 && tilted.box[4] - tilted.box[1] > 12, `slab on a slope: ${tilted.cells} cells, ${tilted.box[4] - tilted.box[1]} high`)
  p = snapPlacement([30, 20, 30], [1, 1, 0], [20, 2, 20], { ...snap, mode: 'local', yaw: 90 })
  near(p.basis.up, [Math.SQRT1_2, Math.SQRT1_2, 0], 'local on a slope turned a quarter')
  // Local on a ceiling: upright, hanging.
  p = snapPlacement([30, 40, 30], [0, -1, 0], [20, 2, 20], { ...snap, mode: 'local', yaw: 0 })
  near(p.basis.up, [0, 1, 0], 'local under a ceiling stays upright')
  ok(p.origin[1] === 38, 'local under a ceiling hangs')
  // Free: turns kept to 15°, the nearest cell.
  p = snapPlacement([12.6, 20, 7.4], [0, 1, 0], [4, 30, 4], { ...snap, mode: 'free', yaw: 37, pitch: 8, roll: -22 })
  ok(p.yaw === 30 && p.pitch === 15 && p.roll === -15, `free: 15° steps (${p.yaw}, ${p.pitch}, ${p.roll})`)
  near(p.origin, [13, 20, 7], 'free: the nearest cell')
  p = snapPlacement([12, 20, 7], [0, 1, 0], [4, 30, 4], { ...snap, mode: 'free', yaw: 37.5, angleStep: 0 })
  ok(p.yaw === 37.5, 'free: any angle')
  // The basis is a turn: orthonormal and right-handed.
  for (const [y, pi, r] of [[0, 0, 0], [37, 15, -22], [90, 0, 0], [200, 45, 10]]) {
    const { right, up, forward } = basisOf(y, pi, r)
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    ok(Math.abs(dot(right, up)) < 1e-12 && Math.abs(dot(up, forward)) < 1e-12 && Math.abs(dot(right, forward)) < 1e-12, 'orthogonal')
    const cross = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]]
    near(cross, forward, 'right-handed')
  }
  near(basisOf(90).forward, [1, 0, 0], 'yaw 90 looks along +x')
}

// An edit made by stampEdit reads as the core reads it.
{
  const e = stampEdit('wall', O, { mode: 'add', kind: 8 })
  ok(e.words[0] === 1 && e.words[1] === 120 && e.box.join() === '38,10,46,58,40,50', `stampEdit: ${e.box}`)
}

console.log(`build-tools: ${checks} checks passed in ${(performance.now() - t0).toFixed(0)} ms`)
