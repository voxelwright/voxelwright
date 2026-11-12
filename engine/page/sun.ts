// The sun's shadows, kept (#140). Tracing a ray towards the sun from every pixel was three
// quarters of a frame near the ground. Instead each box of the world has a map looking along
// the sun: for each of its texels, how far towards the sun the last solid thing on that line
// is. A lit point is one at least that far. A map is 16 x 16 tiles; a few tiles are drawn each
// frame, the nearest first, and a tile is drawn again when an edit touches its line or it has
// grown old. Where a tile is not yet drawn the shader traces a ray as before.
//
// A map's texel is as wide as its box's cell, and a texel keeps its place in the world: the
// map wraps round as the camera moves, like the boxes themselves.
import type { Edit } from './edits.ts'

export const SUN_SIDE = 1024, SUN_TILE = 64
const TILES = SUN_SIDE / SUN_TILE
/** Tiles each side of the camera's that a map covers: 15 across, one fewer than it holds, so none meets itself coming round. */
const AROUND = 7

type V3 = readonly [number, number, number]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mod = (a: number, n: number) => ((a % n) + n) % n

export interface SunTile { level: number; slotX: number; slotY: number; tx: number; ty: number }

export class SunMaps {
  readonly texture: GPUTexture
  /** Every map, for the march to read. */
  readonly all: GPUTextureView
  /** One map, to draw into. */
  readonly layers: GPUTextureView[]
  /** Towards the sun, and two directions square to it and to each other: a map's across and up. */
  readonly s: V3
  readonly u: V3
  readonly v: V3
  /** Which tile of the world each slot holds (two numbers a slot), whether it is drawn, and when. */
  private held: Int32Array[]
  private drawn: Uint32Array[]
  /** Which drawn tiles an edit has since made wrong: used as they are until drawn again, which is soon. */
  private wrong: Uint32Array[]
  private when: Float64Array[]
  private clock = 0
  private levels: number
  /** How many tiles round the eye are not drawn yet, as of the last plan; and how many are drawn but wrong since an edit. */
  undrawn = 0
  spoiled = 0

  constructor(device: GPUDevice, levels: number, sun: V3) {
    this.levels = levels
    this.texture = device.createTexture({ label: 'sun maps', size: [SUN_SIDE, SUN_SIDE, levels], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    this.all = this.texture.createView({ dimension: '2d-array' })
    this.layers = Array.from({ length: levels }, (_, i) => this.texture.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }))
    const length = Math.hypot(sun[0], sun[1], sun[2])
    this.s = [sun[0] / length, sun[1] / length, sun[2] / length]
    // Across: level, square to the sun. Up: square to both.
    const across = Math.hypot(this.s[2], this.s[0])
    this.u = [this.s[2] / across, 0, -this.s[0] / across]
    this.v = [this.s[1] * this.u[2] - this.s[2] * this.u[1], this.s[2] * this.u[0] - this.s[0] * this.u[2], this.s[0] * this.u[1] - this.s[1] * this.u[0]]
    this.held = Array.from({ length: levels }, () => new Int32Array(TILES * TILES * 2).fill(0x7fffffff))
    this.drawn = Array.from({ length: levels }, () => new Uint32Array(8))
    this.wrong = Array.from({ length: levels }, () => new Uint32Array(8))
    this.when = Array.from({ length: levels }, () => new Float64Array(TILES * TILES))
  }

  private clear(level: number, slot: number) { this.drawn[level][slot >> 5] &= ~(1 << (slot & 31)); this.wrong[level][slot >> 5] &= ~(1 << (slot & 31)) }
  private isWrong(level: number, slot: number) { return (this.wrong[level][slot >> 5] >>> (slot & 31)) & 1 }
  private isDrawn(level: number, slot: number) { return (this.drawn[level][slot >> 5] >>> (slot & 31)) & 1 }

  /**
   * Moves each map to be round the eye (in the finest cells of the world) and says which tiles to draw now:
   * up to `most` that are not drawn, the finest and nearest first; then those an edit made wrong; then, while
   * there is room, tiles whose box has moved since they were drawn (all still used meanwhile), then the oldest one, so a tile
   * drawn while the world behind it was still being made does not stay wrong. `ready` is whether the
   * world is made enough to draw from.
   */
  plan(eye: V3, most: number, ready: boolean): SunTile[] {
    this.clock++
    const want: (SunTile & { rank: number })[] = [], wrong: (SunTile & { rank: number })[] = [], aged: (SunTile & { rank: number })[] = []
    let oldest: (SunTile & { rank: number }) | null = null
    for (let level = 0; level < this.levels; level++) {
      const texel = 1 << level, held = this.held[level]
      const cx = Math.floor(dot(eye, this.u) / texel / SUN_TILE), cy = Math.floor(dot(eye, this.v) / texel / SUN_TILE)
      for (let ty = cy - AROUND; ty <= cy + AROUND; ty++) for (let tx = cx - AROUND; tx <= cx + AROUND; tx++) {
        const slotX = mod(tx, TILES), slotY = mod(ty, TILES), slot = slotX + TILES * slotY
        if (held[slot * 2] !== tx || held[slot * 2 + 1] !== ty) { held[slot * 2] = tx; held[slot * 2 + 1] = ty; this.clear(level, slot) }
        const tile = { level, slotX, slotY, tx, ty }
        const rank = (tx - cx) ** 2 + (ty - cy) ** 2 + level * 6
        if (!this.isDrawn(level, slot)) want.push({ ...tile, rank })
        else if (this.isWrong(level, slot)) wrong.push({ ...tile, rank })
        else if (this.when[level][slot] === 0) aged.push({ ...tile, rank })
        else if (!oldest || this.when[level][slot] < oldest.rank) oldest = { ...tile, rank: this.when[level][slot] }
      }
    }
    this.undrawn = want.length
    this.spoiled = wrong.length
    if (!ready) return []
    want.sort((a, b) => a.rank - b.rank)
    wrong.sort((a, b) => a.rank - b.rank)
    aged.sort((a, b) => a.rank - b.rank)
    // A tile that is used meanwhile is not worth a frame's time: two of those a frame, each a pass of long rays.
    const out: SunTile[] = [...want, ...wrong, ...aged].slice(0, Math.min(most, want.length + 2))
    if (out.length < most && oldest && this.clock - oldest.rank > 600) out.push(oldest)
    for (const t of out) {
      const slot = t.slotX + TILES * t.slotY
      this.drawn[t.level][slot >> 5] |= 1 << (slot & 31)
      this.wrong[t.level][slot >> 5] &= ~(1 << (slot & 31))
      this.when[t.level][slot] = this.clock
    }
    return out
  }

  /**
   * An edit changes what is on the sun's lines through it: every tile those lines cross is to be drawn again. It is
   * used as it is until then: a shadow a few frames late is not seen, and a street that burns is edited ten times a
   * second, which with its tiles thrown away had the shader tracing every shadow there (three times the march).
   */
  spoil(e: Edit) {
    // The ball round the edit's box: every line to the sun through it.
    const b = e.box, at: V3 = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2
    const u = dot(at, this.u), v = dot(at, this.v)
    for (let level = 0; level < this.levels; level++) {
      const size = (1 << level) * SUN_TILE, held = this.held[level]
      for (let ty = Math.floor((v - r) / size); ty <= Math.floor((v + r) / size); ty++) for (let tx = Math.floor((u - r) / size); tx <= Math.floor((u + r) / size); tx++) {
        const slot = mod(tx, TILES) + TILES * mod(ty, TILES)
        if (held[slot * 2] === tx && held[slot * 2 + 1] === ty && this.isDrawn(level, slot)) this.wrong[level][slot >> 5] |= 1 << (slot & 31)
      }
    }
  }

  /**
   * A box moved. A tile's line was followed from where it came into the box as the box then stood, so a
   * point the box has since come to hold, further from the sun than that, may be told it is lit when
   * something stands between. The box's tiles are drawn again as there is room, and used until then.
   */
  age(level: number) { this.when[level].fill(0) }

  /** Everything is to be drawn again: the world behind the maps changed wholesale. */
  spoilAll() { for (const d of this.drawn) d.fill(0); for (const w of this.wrong) w.fill(0) }

  /** Where a map's texels are counted from, for the shader: the anchor's place in the map, in texels, wrapped. And which tiles are drawn. */
  tell(level: number, anchor: V3): { base: [number, number]; drawn: Uint32Array } {
    const texel = 1 << level
    return { base: [mod(dot(anchor, this.u) / texel, SUN_SIDE), mod(dot(anchor, this.v) / texel, SUN_SIDE)], drawn: this.drawn[level] }
  }

  /** Where a tile's first texel's middle is from the anchor, across and up, in the finest cells. */
  corner(tile: SunTile, anchor: V3): [number, number] {
    const texel = 1 << tile.level
    return [(tile.tx * SUN_TILE + 0.5) * texel - dot(anchor, this.u), (tile.ty * SUN_TILE + 0.5) * texel - dot(anchor, this.v)]
  }
}
