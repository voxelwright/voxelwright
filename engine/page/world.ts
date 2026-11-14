// The world as the GPU holds it (#140). Round the camera lie boxes of sectors one inside the
// next: the innermost of the finest cells, each further one of cells twice as big covering
// twice as far. A box is a fixed number of slots; a sector's slot is its place in the world
// wrapped round the box, so moving the camera makes and drops sectors at the edges and moves
// nothing. Workers make the sectors; this file decides which, keeps their trees in one pool of
// words, and tells the shader which part of each box is whole enough to march.
import { stream, type Edit } from './edits.ts'
import type { Answer, Ask } from './worker.ts'

export const SIDE = 64
const UNIFORM = 0x80000000
/** A slot: nothing wanted yet, asked for but not sent, being made, made, made but changed since (wanted again), changed and being made again. */
const MISSING = 0, QUEUED = 1, FLYING = 2, READY = 3, STALE = 4, STALE_FLYING = 5

export interface WorldOptions {
  /** Sectors a side of every box: across, up, deep. Multiples of 4. */
  grid: readonly [number, number, number]
  levels: number
  /** How many words of trees the GPU keeps. */
  poolWords: number
  workers: number
  /** How many times finer than the core's own the finest cells here are (#259, an experiment; worker.ts). */
  fine?: number
  /** Whether cells may hold cells a quarter their size (#259, an experiment): the marcher then walks them (march.ts BLOCK). */
  bricks?: boolean
  /** With `bricks`, unless `finesun=0`: the sun's maps say where a cell of finer cells is, so that its shadow is asked of the world at its own grain (march.ts `sunlitText`). */
  fineSun?: boolean
  /** Edits of rows, one after another, as one edit that leaves the column from x0, z0 to x1, z1 the same in the copy `lod` times coarser (the core's `merge_rows`). */
  merge(edits: readonly Edit[], lod: number, x0: number, x1: number, z0: number, z1: number): Edit
}

/** A run of the pool that is free. */
interface Run { at: number; size: number }

/** The pool of words every sector's tree lives in: first fit, neighbours joined when freed. */
class Pool {
  private free: Run[]
  used = 0
  constructor(words: number) { this.free = [{ at: 64, size: words - 64 }] }
  /** Room for `size` words, or -1. */
  take(size: number): number {
    size = (size + 63) & ~63
    for (let i = 0; i < this.free.length; i++) {
      const run = this.free[i]
      if (run.size < size) continue
      const at = run.at
      if (run.size === size) this.free.splice(i, 1)
      else { run.at += size; run.size -= size }
      this.used += size
      return at
    }
    return -1
  }
  give(at: number, size: number) {
    size = (size + 63) & ~63
    this.used -= size
    let i = 0
    while (i < this.free.length && this.free[i].at < at) i++
    this.free.splice(i, 0, { at, size })
    const here = this.free[i], next = this.free[i + 1], before = this.free[i - 1]
    if (next && here.at + here.size === next.at) { here.size += next.size; this.free.splice(i + 1, 1) }
    if (before && before.at + before.size === here.at) { before.size += here.size; this.free.splice(i, 1) }
  }
}

class Level {
  /** The box's low corner, in this level's sectors. */
  origin: [number, number, number] = [NaN, NaN, NaN]
  state: Uint8Array
  /** Which sector each slot holds: three numbers a slot. */
  key: Int32Array
  /** Where each slot's tree is in the pool and how long, or -1. */
  at: Int32Array
  size: Int32Array
  /** The number of the ask each slot was last sent to be made by: an answer to an older one is not taken. */
  asked: Int32Array
  /** How high each slot's contents reach in its sector, in cells: 0 for air, 64 for a full one. */
  high: Uint8Array
  /**
   * What the shader reads: a word a slot (0 air, the top bit and a kind for all one kind, else where its tree is),
   * then two words of mask for each 4 x 4 x 4 slots, then how high the contents of each column of slots reach
   * (in this level's cells, from the world's zero), then the same for each 4 x 4 columns.
   */
  top: Uint32Array<ArrayBuffer>
  dirty = true
  /** The height nothing in the box stands above, in the finest cells: a ray over it and rising has nothing more to meet here. */
  roof = -1e9
  /** The same for each quarter of the box round the eye's own sector (which is in all four): -x -z, +x -z, -x +z, +x +z. */
  roofs = [-1e9, -1e9, -1e9, -1e9]
  /** The part of the box that is whole: low and high corners in this level's sectors (high exclusive). Empty when low equals high. */
  whole: { low: [number, number, number]; high: [number, number, number] } = { low: [0, 0, 0], high: [0, 0, 0] }
  readonly index: number
  readonly grid: readonly [number, number, number]
  constructor(index: number, grid: readonly [number, number, number]) {
    this.index = index
    this.grid = grid
    const slots = grid[0] * grid[1] * grid[2]
    this.state = new Uint8Array(slots)
    this.key = new Int32Array(slots * 3)
    this.at = new Int32Array(slots).fill(-1)
    this.size = new Int32Array(slots)
    this.asked = new Int32Array(slots)
    this.high = new Uint8Array(slots)
    this.top = new Uint32Array(slots + (slots / 64) * 2 + grid[0] * grid[2] + (grid[0] * grid[2]) / 16)
  }
  slot(sx: number, sy: number, sz: number): number {
    const [gx, gy, gz] = this.grid
    return mod(sx, gx) + gx * (mod(sz, gz) + gz * mod(sy, gy))
  }
  holds(sx: number, sy: number, sz: number): boolean {
    const o = this.origin, g = this.grid
    return sx >= o[0] && sx < o[0] + g[0] && sy >= o[1] && sy < o[1] + g[1] && sz >= o[2] && sz < o[2] + g[2]
  }
  /** Sets what the shader reads for a slot, and how high its contents reach in it. */
  show(slot: number, word: number, high: number) {
    const [gx, gy, gz] = this.grid, slots = gx * gy * gz
    this.top[slot] = word
    this.high[slot] = high
    const wx = slot % gx, wz = Math.floor(slot / gx) % gz, wy = Math.floor(slot / (gx * gz))
    const mask = slots + 2 * ((wx >> 2) + (gx >> 2) * ((wz >> 2) + (gz >> 2) * (wy >> 2)))
    const bit = (wx & 3) + 4 * (wz & 3) + 16 * (wy & 3)
    if (word) this.top[mask + (bit >> 5)] |= 1 << (bit & 31)
    else this.top[mask + (bit >> 5)] &= ~(1 << (bit & 31))
    this.dirty = true
  }
}

const mod = (a: number, n: number) => ((a % n) + n) % n
/** One number for a column of sectors. */
const column = (sx: number, sz: number) => (sx + 0x200000) * 0x400000 + (sz + 0x200000)

export interface WorldStats {
  ready: number
  wanted: number
  /** Sectors shown as they were while they are made again after an edit. */
  stale: number
  flying: number
  poolUsed: number
  poolWords: number
  made: number
  makeMs: number
  full: number
  /** How many times a sector made here refused an edit of finer cells whole (#259): the switch is off, or the sector's limits (the core's scratch.rs). The edit is still in the list, and other sectors may show it. */
  refused: number
  wholeLevels: number
  /** For each box: sectors made, the workers' time making them (ms), and the words of trees it now keeps. */
  boxes: { made: number; ms: number; words: number }[]
}

export class World {
  readonly levels: Level[]
  readonly pool: Pool
  readonly poolBuffer: GPUBuffer
  readonly topBuffer: GPUBuffer
  /** Words a level takes in the top buffer. */
  readonly stride: number
  private workers: { worker: Worker; busy: number }[] = []
  private asks: { level: number; sx: number; sz: number; y0: number; y1: number; rank: number }[] = []
  private nextId = 1
  private edits: Edit[] = []
  /** For each box, the edits that reach each column of its sectors, in order: a column made again is told only of those. */
  private reach: Map<number, Edit[]>[] = []
  private plan = true
  /** The boxes that moved in the last update. */
  moved: number[] = []
  stats: WorldStats
  private device: GPUDevice
  readonly options: WorldOptions

  constructor(device: GPUDevice, options: WorldOptions) {
    this.device = device
    this.options = options
    const { grid, levels, poolWords } = options
    if (grid.some((g) => g < 4 || (g & (g - 1)))) throw new Error('a box is 4, 8, 16 or 32 sectors a side')
    this.levels = Array.from({ length: levels }, (_, i) => new Level(i, grid))
    this.stride = this.levels[0].top.length
    this.pool = new Pool(poolWords)
    this.poolBuffer = device.createBuffer({ label: 'trees', size: poolWords * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.topBuffer = device.createBuffer({ label: 'boxes', size: this.stride * levels * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.stats = { ready: 0, wanted: 0, stale: 0, flying: 0, poolUsed: 0, poolWords, made: 0, makeMs: 0, full: 0, refused: 0, wholeLevels: 0, boxes: Array.from({ length: levels }, () => ({ made: 0, ms: 0, words: 0 })) }
    for (let i = 0; i < options.workers; i++) {
      const worker = new Worker('/page/worker.ts', { type: 'module' })
      const slot = { worker, busy: 0 }
      worker.onmessage = (e: MessageEvent<Answer>) => { slot.busy--; this.take(e.data) }
      this.workers.push(slot)
    }
  }

  /** Something was done to the world. Every sector it reaches is made again; the old one is shown until then. */
  edit(e: Edit) {
    this.edits.push(e)
    this.touch(e, true)
  }

  /**
   * This becomes another world (#264): everything done to this one is forgotten, and `edits` (what was done to the
   * other, in order) are what has been done. Both are worlds of one planet by one rule, so a sector that no edit of
   * either reaches is the same in both and stays as it is: only those that one of them reaches are made again.
   * Returns what was forgotten.
   */
  swap(edits: readonly Edit[]): readonly Edit[] {
    const old = this.edits
    this.edits = []
    this.reach = []
    for (const e of old) this.touch(e, false)
    for (const e of edits) this.edit(e)
    return old
  }

  /** Every sector an edit reaches is to be made again; `keep` also lists the edit under each column it reaches. */
  private touch(e: Edit, keep: boolean) {
    for (const level of this.levels) {
      const size = SIDE << level.index
      const lo = [e.box[0], e.box[1], e.box[2]].map((v) => Math.floor(v / size))
      const hi = [e.box[3] - 1, e.box[4] - 1, e.box[5] - 1].map((v) => Math.floor(v / size))
      const columns = this.reach[level.index] ??= new Map()
      if (keep) for (let sz = lo[2]; sz <= hi[2]; sz++) for (let sx = lo[0]; sx <= hi[0]; sx++) {
        const key = column(sx, sz), list = columns.get(key)
        if (list) list.push(e); else columns.set(key, [e])
      }
      for (let sy = lo[1]; sy <= hi[1]; sy++) for (let sz = lo[2]; sz <= hi[2]; sz++) for (let sx = lo[0]; sx <= hi[0]; sx++) {
        if (!level.holds(sx, sy, sz)) continue
        const slot = level.slot(sx, sy, sz)
        if (level.state[slot] === READY) level.state[slot] = STALE
        // One being made was asked before this edit: what comes back is already old.
        else if (level.state[slot] === FLYING) level.state[slot] = MISSING
        else if (level.state[slot] === STALE_FLYING) level.state[slot] = STALE
      }
    }
    this.plan = true
  }

  /** The edits that reach a column of the finest box's sectors, in order. */
  reaching(sx: number, sz: number): readonly Edit[] { return this.reach[0]?.get(column(sx, sz)) ?? [] }

  /** Everything done to the world so far, in order. */
  done(): readonly Edit[] { return this.edits }

  private release(level: Level, slot: number) {
    if (level.at[slot] >= 0) this.pool.give(level.at[slot], level.size[slot])
    level.at[slot] = -1
    level.size[slot] = 0
    level.state[slot] = MISSING
    if (level.top[slot]) level.show(slot, 0, 0)
  }

  /** Moves the boxes to be round `eye` (in the finest cells), asks for what is missing, and writes what changed to the GPU. */
  update(eye: readonly [number, number, number]) {
    this.moved = []
    for (const level of this.levels) {
      const size = SIDE << level.index, g = level.grid
      const origin = eye.map((v, a) => Math.floor(v / size) - (g[a] >> 1)) as [number, number, number]
      if (origin.every((v, a) => v === level.origin[a])) continue
      level.origin = origin
      level.dirty = true
      this.moved.push(level.index)
      this.plan = true
      // Each slot now belongs to one sector of the new box: drop what it held if that was another.
      for (let wy = 0; wy < g[1]; wy++) for (let wz = 0; wz < g[2]; wz++) for (let wx = 0; wx < g[0]; wx++) {
        const slot = wx + g[0] * (wz + g[2] * wy)
        const sx = origin[0] + mod(wx - origin[0], g[0]), sy = origin[1] + mod(wy - origin[1], g[1]), sz = origin[2] + mod(wz - origin[2], g[2])
        if (level.key[slot * 3] === sx && level.key[slot * 3 + 1] === sy && level.key[slot * 3 + 2] === sz && level.state[slot] !== MISSING) continue
        this.release(level, slot)
        level.key.set([sx, sy, sz], slot * 3)
      }
    }
    if (this.plan) this.replan(eye)
    this.send()
    this.flush()
  }

  /** Lists what to ask for, nearest first within each box, the changed before the new. */
  private replan(eye: readonly [number, number, number]) {
    this.plan = false
    this.asks = []
    for (const level of this.levels) {
      const g = level.grid, o = level.origin, size = SIDE << level.index
      for (let i = 0; i < level.state.length; i++) if (level.state[i] === QUEUED) level.state[i] = MISSING
      for (let sz = o[2]; sz < o[2] + g[2]; sz++) for (let sx = o[0]; sx < o[0] + g[0]; sx++) {
        let y0 = Infinity, y1 = -Infinity, stale = false
        for (let sy = o[1]; sy < o[1] + g[1]; sy++) {
          const state = level.state[level.slot(sx, sy, sz)]
          if (state !== MISSING && state !== STALE) continue
          y0 = Math.min(y0, sy)
          y1 = Math.max(y1, sy)
          stale ||= state === STALE
        }
        if (y0 > y1) continue
        // How far the column is from the eye, in this level's sectors: every box fills from its middle outwards, the far ones a little sooner.
        const far = Math.hypot((sx + 0.5) * size - eye[0], (sz + 0.5) * size - eye[2]) / size
        this.asks.push({ level: level.index, sx, sz, y0, y1, rank: stale ? -1 : far - level.index * 0.05 })
        for (let sy = y0; sy <= y1; sy++) {
          const slot = level.slot(sx, sy, sz)
          if (level.state[slot] === MISSING) level.state[slot] = QUEUED
        }
      }
    }
    this.asks.sort((a, b) => b.rank - a.rank)
  }

  private send() {
    for (const w of this.workers) {
      while (w.busy < 2 && this.asks.length) {
        const ask = this.asks.pop()!
        const level = this.levels[ask.level]
        let any = false
        for (let sy = ask.y0; sy <= ask.y1; sy++) {
          const slot = level.slot(ask.sx, sy, ask.sz)
          if (level.state[slot] === QUEUED) { level.state[slot] = FLYING; any = true }
          else if (level.state[slot] === STALE) { level.state[slot] = STALE_FLYING; any = true }
          else continue
          level.asked[slot] = this.nextId
        }
        if (!any) continue
        const reach = this.reach[ask.level]?.get(column(ask.sx, ask.sz)) ?? []
        if (reach.length >= 8) this.tidy(reach, ask.level, ask.sx, ask.sz)
        const heights = new Int32Array(reach.length * 2)
        for (let i = 0; i < reach.length; i++) { heights[i * 2] = reach[i].box[1]; heights[i * 2 + 1] = reach[i].box[4] }
        w.busy++
        w.worker.postMessage({ id: this.nextId++, level: ask.level, sx: ask.sx, sz: ask.sz, y0: ask.y0, y1: ask.y1, edits: stream(reach), heights, fine: this.options.fine, bricks: this.options.bricks } satisfies Ask)
      }
    }
  }

  /**
   * A column's edits made fewer: each run of edits of rows, one after another, becomes one. A column that burns is
   * edited ten times a second, and every sector of it made again is told all of them.
   */
  private tidy(reach: Edit[], level: number, sx: number, sz: number) {
    const size = SIDE << level, out: Edit[] = []
    for (let i = 0; i < reach.length;) {
      let j = i
      while (j < reach.length && reach[j].words[0] !== 0 && reach[j].words[0] < 3) j++
      if (j - i >= 2) out.push(this.options.merge(reach.slice(i, j), level, sx * size, (sx + 1) * size, sz * size, (sz + 1) * size))
      else if (j > i) out.push(reach[i])
      if (j < reach.length) out.push(reach[j])
      i = j + 1
    }
    reach.length = 0
    reach.push(...out)
  }

  /** A worker's answer: keep each sector that is still wanted. */
  private take(answer: Answer) {
    const level = this.levels[answer.level]
    let at = 0
    this.stats.makeMs += answer.ms
    this.stats.refused += answer.refused
    this.stats.boxes[answer.level].ms += answer.ms
    this.stats.boxes[answer.level].made += answer.sizes.length
    for (let i = 0; i < answer.sizes.length; i++) {
      const n = answer.sizes[i], sy = answer.y0 + i, from = at
      at += n
      this.stats.made++
      if (!level.holds(answer.sx, sy, answer.sz)) continue
      const slot = level.slot(answer.sx, sy, answer.sz)
      const state = level.state[slot]
      // Asked for again since (an edit reached it while it was being made, or the world became another): this answer is of what it was.
      if ((state !== FLYING && state !== STALE_FLYING) || level.asked[slot] !== answer.id) continue
      if (level.at[slot] >= 0) { this.pool.give(level.at[slot], level.size[slot]); level.at[slot] = -1; level.size[slot] = 0 }
      level.state[slot] = READY
      if (n === 0) { level.show(slot, 0, 0); continue }
      if (n === 1) { level.show(slot, (UNIFORM | answer.words[from]) >>> 0, SIDE); continue }
      const room = this.pool.take(n)
      if (room < 0) { this.stats.full++; level.show(slot, 0, 0); continue }
      level.at[slot] = room
      level.size[slot] = n
      this.device.queue.writeBuffer(this.poolBuffer, room * 4, answer.words, from, n)
      // The root says which is the highest leaf that holds anything (tree.rs).
      level.show(slot, room, (((answer.words[from + 2] >>> 24) & 15) + 1) * 4)
    }
    level.dirty = true
    // A sector changed while it was being made is wanted again.
    this.plan ||= level.state.includes(STALE) || level.state.includes(MISSING)
  }

  /** Writes each changed box to the GPU and works out how much of it is whole. */
  private flush() {
    let ready = 0, wanted = 0, flying = 0, stale = 0, wholeLevels = 0
    for (const level of this.levels) {
      for (const s of level.state) { if (s >= READY) ready++; else wanted++; if (s === FLYING || s === STALE_FLYING) flying++; if (s >= STALE) stale++ }
      this.stats.boxes[level.index].words = level.size.reduce((n, v) => n + v, 0)
      if (level.dirty) {
        level.dirty = false
        this.roofs(level)
        this.device.queue.writeBuffer(this.topBuffer, level.index * this.stride * 4, level.top)
        this.grow(level)
      }
      if (level.whole.high[0] - level.whole.low[0] === level.grid[0] && level.whole.high[1] - level.whole.low[1] === level.grid[1] && level.whole.high[2] - level.whole.low[2] === level.grid[2]) wholeLevels++
    }
    Object.assign(this.stats, { ready, wanted, stale, flying, poolUsed: this.pool.used, wholeLevels })
  }

  /** Whether every box is whole but for a layer of sectors at each side: enough to follow the sun's lines through while the edges are still being made. */
  nearlyWhole(): boolean {
    return this.levels.every((l) => l.whole.high.every((h, a) => h - l.whole.low[a] >= l.grid[a] - 2))
  }

  /** How high the contents of each column of a level's slots reach, and of each 4 x 4 columns, and of the whole box. */
  private roofs(level: Level) {
    const [gx, gy, gz] = level.grid, slots = gx * gy * gz, columns = slots + (slots / 64) * 2, blocks = columns + gx * gz
    const NONE = -(1 << 30), roofs = new Int32Array(level.top.buffer, columns * 4, gx * gz + (gx * gz) / 16).fill(NONE)
    let roof = NONE
    const quarters = [NONE, NONE, NONE, NONE], o = level.origin
    for (let wz = 0; wz < gz; wz++) for (let wx = 0; wx < gx; wx++) {
      let high = NONE
      for (let wy = 0; wy < gy; wy++) {
        const slot = wx + gx * (wz + gz * wy)
        if (level.high[slot]) high = Math.max(high, level.key[slot * 3 + 1] * SIDE + level.high[slot])
      }
      roofs[wx + gx * wz] = high
      const block = blocks - columns + (wx >> 2) + (gx >> 2) * (wz >> 2)
      roofs[block] = Math.max(roofs[block], high)
      roof = Math.max(roof, high)
      // Which quarters the column is in: the eye's sector is the middle one of the box, and its row and its column
      // are in the quarters on both sides of them.
      const rx = (((wx - o[0]) % gx) + gx) % gx - (gx >> 1), rz = (((wz - o[2]) % gz) + gz) % gz - (gz >> 1)
      for (let q = 0; q < 4; q++) if ((q & 1 ? rx >= 0 : rx <= 0) && (q & 2 ? rz >= 0 : rz <= 0)) quarters[q] = Math.max(quarters[q], high)
    }
    level.roof = roof === NONE ? -1e9 : roof * (1 << level.index)
    level.roofs = quarters.map((high) => (high === NONE ? -1e9 : high * (1 << level.index)))
  }

  /** The biggest box round the middle of a level in which every sector is made: from the middle sector, a face at a time, while the layer it would take in is all made. */
  private grow(level: Level) {
    const g = level.grid, o = level.origin
    const made = (sx: number, sy: number, sz: number) => level.state[level.slot(sx, sy, sz)] >= READY
    const low: [number, number, number] = [o[0] + (g[0] >> 1), o[1] + (g[1] >> 1), o[2] + (g[2] >> 1)]
    const high: [number, number, number] = [low[0], low[1], low[2]]
    level.whole = { low, high }
    if (!made(low[0], low[1], low[2])) return
    high[0]++; high[1]++; high[2]++
    const layer = (axis: number, at: number) => {
      const a = (axis + 1) % 3, b = (axis + 2) % 3, p = [0, 0, 0]
      p[axis] = at
      for (p[a] = low[a]; p[a] < high[a]; p[a]++) for (p[b] = low[b]; p[b] < high[b]; p[b]++) if (!made(p[0], p[1], p[2])) return false
      return true
    }
    for (let grew = true; grew;) {
      grew = false
      for (let axis = 0; axis < 3; axis++) {
        if (low[axis] > o[axis] && layer(axis, low[axis] - 1)) { low[axis]--; grew = true }
        if (high[axis] < o[axis] + g[axis] && layer(axis, high[axis])) { high[axis]++; grew = true }
      }
    }
  }
}
