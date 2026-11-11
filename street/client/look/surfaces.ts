// What the street is made of (#136): asphalt, concrete, earth, painted boards, glass. Each is
// painted in the shader from where a point is in the world, so nothing repeats down a street
// and nothing is stretched over a shape; one small tiling noise is read at several sizes for
// all of it. A surface says its colour, how rough it is and how high it stands (metres), and
// its light comes from that height: the grain of a road, the lip of a board.
import * as THREE from 'three/webgpu'
import { abs, attribute, cross, dFdx, dFdy, dot, faceDirection, float, floor, fract, fwidth, max, min, mix, normalView, normalWorldGeometry, positionView, positionWorld, sin, smoothstep, texture, time, uv, vec2, vec3, vertexColor } from 'three/tsl'
import { GRADE } from '../../src/ground.ts'

type F = THREE.Node<'float'>
type V2 = THREE.Node<'vec2'>
type V3 = THREE.Node<'vec3'>
export interface Surface { color: V3; roughness: F; height: F }

/** Four unrelated fields in one tiling texture: r slow clouds, g fine grain, b cells (how far from the nearest of scattered points), a middling clouds. */
function noiseTexture(): THREE.DataTexture {
  const N = 256
  const rand = (i: number, j: number, s: number) => { const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x) }
  const value = (x: number, y: number, cells: number, seed: number) => {
    const gx = x * cells, gy = y * cells, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    const at = (i: number, j: number) => rand(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed + cells)
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy
  }
  const clouds = (x: number, y: number, cells: number, seed: number, octaves: number) => {
    let sum = 0, amp = 0.5, norm = 0
    for (let o = 0; o < octaves; o++, amp *= 0.5) { sum += value(x, y, cells << o, seed + o * 13) * amp; norm += amp }
    return sum / norm
  }
  const cellsOf = (x: number, y: number, cells: number, seed: number) => {
    const gx = x * cells, gy = y * cells, x0 = Math.floor(gx), y0 = Math.floor(gy)
    let least = 9
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = x0 + i, cy = y0 + j, wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells
      least = Math.min(least, Math.hypot(cx + rand(wx, wy, seed) - gx, cy + rand(wx, wy, seed + 5) - gy))
    }
    return Math.min(1, least)
  }
  const fields = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)]
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / N, y = j / N, k = j * N + i
    fields[0][k] = clouds(x, y, 4, 1, 5)
    fields[1][k] = clouds(x, y, 48, 2, 2)
    fields[2][k] = cellsOf(x, y, 20, 3)
    fields[3][k] = clouds(x, y, 9, 4, 4)
  }
  const data = new Uint8Array(N * N * 4)
  fields.forEach((field, c) => {
    let lo = Infinity, hi = -Infinity
    for (const v of field) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    for (let k = 0; k < N * N; k++) data[k * 4 + c] = Math.round(((field[k] - lo) / (hi - lo)) * 255)
  })
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}
export const NOISE = noiseTexture()
/** The noise read with one tile `size` metres across. */
const noise = (p: V2, size: number, shift = 0) => texture(NOISE, p.mul(1 / size).add(shift))
const hash = (cell: V2): F => fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453))
/** 0 below `edge`, 1 above it, the step as wide as a pixel sees. */
const over = (edge: number | F, x: F): F => { const w = fwidth(x).max(1e-5), e = typeof edge === 'number' ? float(edge) : edge; return smoothstep(e.sub(w), e.add(w), x) }
/** 1 between `from` and `to`. */
const within = (from: number, to: number, x: F): F => over(from, x).mul(float(1).sub(over(to, x)))
const linear = (hex: string): V3 => { const c = new THREE.Color(hex); return vec3(c.r, c.g, c.b) }

/** A point on the ground as metres across the street and metres down it (the hill makes a metre of z a little more of road). */
export const onGround: V2 = vec2(positionWorld.x, positionWorld.z.mul(Math.hypot(1, GRADE)))

/**
 * A surface's own normal from its height: how the height changes across the screen against how the surface
 * does. Height is in metres, so a groove is as deep from far as from near.
 */
export function relief(height: F): V3 {
  const sx = dFdx(positionView), sy = dFdy(positionView), n = normalView
  const r1 = cross(sy, n), r2 = cross(n, sx)
  const det = dot(sx, r1).mul(faceDirection)
  const grad = det.sign().mul(dFdx(height).mul(r1).add(dFdy(height).mul(r2)))
  return det.abs().mul(n).sub(grad).normalize()
}

/** Old city concrete: mottled, stained in places, with a fine sandy grain. */
function concreteAt(p: V2): Surface {
  const mottle = noise(p, 2.7).r, blot = noise(p, 7.9, 0.37).a, grain = noise(p, 0.41).g
  const stain = smoothstep(0.58, 0.8, blot).mul(0.16)
  const color = mix(linear('#a39d92'), linear('#c4bfb3'), mottle).mul(grain.sub(0.5).mul(0.22).add(1)).mul(float(1).sub(stain))
  return { color, roughness: float(0.9).sub(stain.mul(0.5)), height: grain.mul(0.0016) }
}

/** Old asphalt: paler and darker in patches, its stones showing, cracked in places, mended with darker squares and a long strip where a pipe was laid. */
export function tarmac(p: V2 = onGround): Surface & { stones: F; mid: F } {
  const big = noise(p, 37).r, mid = noise(p, 6.1, 0.21).a, stones = noise(p, 0.83).g, grit = noise(p, 0.21, 0.5).g
  let color: V3 = mix(linear('#4a4a4c'), linear('#6c6a67'), big.mul(0.6).add(mid.mul(0.4)))
  let rough: F = float(0.93)
  let height: F = stones.mul(0.0035).add(grit.mul(0.001))
  // Mends: a darker, smoother square in some of the cells of a wide grid, a line of tar round it.
  const grid = vec2(6.7, 10.3), cell = floor(p.div(grid)), inCell = fract(p.div(grid)).mul(grid)
  const pick = hash(cell), from = vec2(hash(cell.add(3.1)).mul(2.2).add(0.4), hash(cell.add(7.7)).mul(3).add(0.5)), size = vec2(hash(cell.add(11.3)).mul(2).add(1.6), hash(cell.add(5.9)).mul(3.5).add(2))
  const wander = noise(p, 1.7, 0.3).a.sub(0.5).mul(0.05), gaps = smoothstep(0.22, 0.4, noise(p, 2.9, 0.6).r)
  const edge = min(min(inCell.x.sub(from.x), from.x.add(size.x).sub(inCell.x)), min(inCell.y.sub(from.y), from.y.add(size.y).sub(inCell.y))).add(wander)
  // A strip where the road was cut for a pipe, a metre and a half off the middle, its edges wandering a little.
  const cut = float(0.42).sub(abs(p.x.sub(1.6).add(noise(p, 13).a.sub(0.5).mul(0.12)))).add(wander)
  const mended = max(over(0, edge).mul(over(0.62, pick)), over(0, cut))
  const seam = max(within(-0.014, 0.014, edge).mul(over(0.62, pick)), within(-0.013, 0.013, cut)).mul(gaps)
  color = mix(color, color.mul(0.8), mended.mul(0.85))
  rough = rough.sub(mended.mul(0.05))
  // Cracks: thin lines where a slow field crosses its middle, in the parts of the road a second field picks.
  const vein = abs(noise(p, 11.3, 0.63).r.sub(0.5)), cracked = smoothstep(0.5, 0.68, noise(p, 23, 0.11).a)
  const crack = float(1).sub(smoothstep(0.0, 0.006, vein)).mul(cracked)
  const tar = max(seam, crack)
  color = mix(color, linear('#1f1f21'), tar.mul(0.82))
  rough = mix(rough, float(0.74), tar)
  height = height.sub(crack.mul(0.004)).add(seam.mul(0.002))
  // Stones: the road's own gravel, worn bare: pale flecks and dark pits a centimetre across, over a finer grain.
  const pale = float(1).sub(smoothstep(0.1, 0.24, noise(p, 0.31).b)), pit = float(1).sub(smoothstep(0.08, 0.2, noise(p, 0.27, 0.43).b))
  color = color.mul(stones.sub(0.5).mul(0.3).add(1)).add(grit.sub(0.5).mul(0.03))
  color = mix(color, color.mul(1.55).add(0.02), pale.mul(0.5))
  color = mix(color, color.mul(0.55), pit.mul(0.5))
  height = height.add(pale.mul(0.0012)).sub(pit.mul(0.0015))
  return { color, roughness: rough, height, stones, mid }
}

/** A road with a gutter laid along its kerbs: a strip of concrete, a dark joint where it meets the asphalt, and dirt gathered against the kerb. `across` is how far a point is from the road's middle, `much` how much of the gutter is there (1, or 0 where another road crosses). */
export function guttered(s: Surface, p: V2, across: F, road: number, much: F = float(1)): Surface {
  const gutter = over(road - 0.46, abs(across)).mul(much), pan = concreteAt(p)
  const joint = within(road - 0.475, road - 0.445, abs(across)), dirt = smoothstep(road - 0.22, road, abs(across)).mul(noise(p, 1.4).a.mul(0.6).add(0.4))
  const color = mix(mix(s.color, pan.color.mul(0.86), gutter), linear('#2a2823'), max(joint.mul(0.8), dirt.mul(0.55)).mul(much))
  return { color, roughness: mix(s.roughness, pan.roughness, gutter), height: mix(s.height, pan.height, gutter) }
}

/**
 * The block's roadway: old asphalt, oil where cars stand along the kerbs, white bars for a crossing at each end,
 * and a gutter along each kerb.
 */
export function asphalt(p: V2 = onGround, road = 5, ends = 30): Surface {
  const base = tarmac(p), { stones, mid } = base
  let color = base.color, rough = base.roughness, height = base.height
  const parked = within(road - 2.4, road - 0.7, abs(p.x)), oil = smoothstep(0.7, 0.9, noise(p, 3.3, 0.9).a).mul(parked)
  color = mix(color, linear('#242426'), oil.mul(0.7))
  rough = mix(rough, float(0.5), oil.mul(0.8))
  // The crossings: bars 0.6 m wide along the street, worn through where the stones stand proud.
  const along = abs(p.y), bars = within(ends - 5, ends - 2, along).mul(over(0.5, fract(p.x.div(1.22).add(0.25)))).mul(within(-road + 0.75, road - 0.75, p.x))
  const worn = smoothstep(0.2, 0.42, stones.mul(0.5).add(mid.mul(0.5)).add(noise(p, 1.9).r.mul(0.25)))
  const paint = bars.mul(worn)
  color = mix(color, linear('#d9d5c8').mul(stones.mul(0.2).add(0.86)), paint)
  rough = mix(rough, float(0.62), paint)
  height = height.add(paint.mul(0.0018))
  return guttered({ color, roughness: rough, height }, p, p.x, road)
}

/** A pavement of concrete squares: each a little its own shade, scored where they meet. `from` is where the first joint lies across the street. */
export function paving(p: V2 = onGround, from = 5.15, square = 0.91): Surface {
  const base = concreteAt(p)
  const q = vec2(abs(p.x).sub(from), p.y).div(square), cell = floor(q), f = fract(q)
  const gap = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(square)
  const joint = float(1).sub(smoothstep(0.004, 0.011, gap)), shade = hash(cell.add(vec2(floor(p.x.sign().mul(40)), 0)))
  // Gum and old spots: small dark rounds.
  const spot = float(1).sub(smoothstep(0.03, 0.06, noise(p, 1.3, 0.4).b)).mul(over(0.55, noise(p, 4.7).r))
  let color: V3 = base.color.mul(shade.mul(0.2).add(0.9)).mul(mix(vec3(1), vec3(1.03, 1, 0.95), hash(cell.add(9.1))))
  // Dust and leaves gather along the foot of the walls.
  const drift = smoothstep(7.25, 7.8, abs(p.x)).mul(noise(p, 2.1, 0.2).a.mul(0.7).add(0.3))
  color = mix(color, linear('#4b4841'), max(max(joint.mul(0.75), spot.mul(0.5)), drift.mul(0.45)))
  return { color, roughness: base.roughness, height: base.height.sub(joint.mul(0.004)) }
}

/** A kerb: a line of pale stone, jointed every metre and a half. `red` is where it is painted red (no stopping: by a hydrant): each a side of the street and from where to where along it. */
export function kerbstone(p: V2 = onGround, red: [number, number, number][] = []): Surface {
  // Its face stands upright, where a point's place on the ground does not change: its height stands in for the way across.
  const base = concreteAt(vec2(p.x.add(positionWorld.y.mul(2.3)), p.y).mul(1.7))
  const f = fract(p.y.div(1.5)), joint = float(1).sub(smoothstep(0.003, 0.008, min(f, float(1).sub(f)).mul(1.5)))
  let color: V3 = base.color.mul(1.12)
  // Old paint, chipped where the stone's grain stands proud.
  const chipped = smoothstep(0.28, 0.4, noise(p, 0.6).g.mul(0.6).add(noise(p, 2.3).r.mul(0.4)))
  for (const [side, from, to] of red) color = mix(color, linear('#b3251c'), within(from, to, p.y).mul(over(0, p.x.mul(side))).mul(chipped))
  return { color: mix(color, linear('#4b4841'), joint.mul(0.7)), roughness: float(0.8), height: base.height.sub(joint.mul(0.003)) }
}

/** Dug earth, in bands as it was laid down, with stones in it. `p` is across and up the face. */
export function earth(p: V2): Surface {
  const band = noise(vec2(p.x.mul(0.15), p.y), 1.1).r, clod = noise(p, 0.9).a, stone = float(1).sub(smoothstep(0.05, 0.12, noise(p, 1.6).b))
  let color: V3 = mix(linear('#5f4a36'), linear('#8a7355'), band.mul(0.6).add(clod.mul(0.4)))
  color = mix(color, linear('#a59f93'), stone.mul(0.8))
  return { color, roughness: float(0.97), height: clod.mul(0.02).add(stone.mul(0.015)) }
}

/** A lit material from a surface. */
export function made(s: Surface, bump = 1): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 })
  m.colorNode = s.color
  m.roughnessNode = s.roughness
  if (bump) m.normalNode = relief(s.height.mul(bump))
  return m
}

/** A point on an upright wall: metres along it and metres up. */
const onWall: V2 = vec2(positionWorld.z.mul(abs(normalWorldGeometry.x)).add(positionWorld.x.mul(abs(normalWorldGeometry.z))), positionWorld.y)
/** How much of a pattern `period` metres across a pixel still shows: 1 near, 0 where a pixel holds a whole period. */
const shows = (x: F): F => float(1).sub(smoothstep(0.3, 0.7, fwidth(x)))

/** How much of a pixel lies in the last `part` of each whole step of `x`: a line at every whole number, as dark from far as from near and never broken into dashes. */
const lineShare = (x: F, part: number): F => {
  const w = fwidth(x).max(1e-4), sum = (v: F) => floor(v).mul(part).add(fract(v).sub(1 - part).max(0))
  return sum(x.add(w.mul(0.5))).sub(sum(x.sub(w.mul(0.5)))).div(w)
}

/** A wall of lapped boards in a paint: each board's foot stands proud of the one below and shades it. */
export function boards(paint: V3, lap = 0.118): Surface {
  const p = onWall, rows = p.y.div(lap), t = fract(rows), row = floor(rows), near = float(1).sub(smoothstep(0.12, 0.4, fwidth(rows)))
  const lip = smoothstep(0.93, 1, t)
  const height = float(1).sub(t).mul(0.007).add(lip.mul(0.007)).mul(near)
  // Where one board ends and the next begins along the wall: a hair's width of shade, at a different place on every row.
  const butt = float(1).sub(over(0.0016, abs(fract(p.x.div(3.9).add(hash(vec2(row, 1.7)))).sub(0.5)))).mul(near)
  const tone = noise(p, 3.7).r.sub(0.5).mul(0.1).add(hash(vec2(row, 9.3)).sub(0.5).mul(0.045)).add(1)
  const shadeUnder = lineShare(rows, 0.15).mul(0.42).add(butt.mul(0.4))
  // Rain and dust: a little darker low on the wall and under each board in streaks.
  const streak = noise(vec2(p.x.mul(9), p.y.mul(0.35)), 1).a
  const color = paint.mul(tone).mul(float(1).sub(shadeUnder)).mul(streak.sub(0.5).mul(0.08).add(1))
  return { color, roughness: float(0.58).add(noise(p, 0.9).g.mul(0.1)), height }
}

/** Painted plaster: a sandy grain, the paint a little uneven, lines scored along it every `course` metres. */
export function plaster(paint: V3, course = 0.42): Surface {
  const p = onWall, grain = noise(p, 0.37).g, cloud = noise(p, 2.9).r
  const f = fract(p.y.div(course)), groove = float(1).sub(smoothstep(0.012, 0.03, min(f, float(1).sub(f)).mul(course))).mul(shows(p.y.div(course)))
  const color = paint.mul(cloud.sub(0.5).mul(0.12).add(1)).mul(grain.sub(0.5).mul(0.1).add(1)).mul(float(1).sub(groove.mul(0.35)))
  return { color, roughness: float(0.86), height: grain.mul(0.0014).sub(groove.mul(0.008)) }
}

/** Painted joinery: smooth, with a soft shine. */
export function joinery(paint: V3): Surface {
  const p = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y), cloud = noise(p, 1.3).r
  return { color: paint.mul(cloud.sub(0.5).mul(0.07).add(1)), roughness: float(0.42).add(cloud.mul(0.12)), height: float(0) }
}

/** Shingles with round feet, in rows that break joint. */
export function shingles(paint: V3, wide = 0.16): Surface {
  const p = onWall, rows = p.y.div(wide * 0.8), row = floor(rows), t = fract(rows), q = fract(p.x.div(wide).add(row.mul(0.5))).sub(0.5)
  const near = shows(rows)
  // A scale's foot is a half round: beyond it the row below shows, in shade.
  const round = q.mul(q).mul(1.9).add(float(1).sub(t).mul(0.9)), gap = smoothstep(0.86, 0.98, round).mul(near)
  const color = paint.mul(hash(vec2(row, floor(p.x.div(wide).add(row.mul(0.5))))).sub(0.5).mul(0.14).add(1)).mul(float(1).sub(gap.mul(0.55)))
  return { color, roughness: float(0.75), height: t.oneMinus().mul(0.006).sub(gap.mul(0.006)).mul(near) }
}

/** A flat roof: tar and grit. */
export function roofing(paint: V3): Surface {
  const p = positionWorld.xz, grit = noise(p, 0.6).g, cloud = noise(p, 5.3).r
  return { color: paint.mul(cloud.mul(0.4).add(0.8)).mul(grit.sub(0.5).mul(0.3).add(1)), roughness: float(0.95), height: grit.mul(0.003) }
}

/**
 * A window's glass. It shows the room a little (dark, with curtains at the sides of some and a blind down others)
 * and the street a lot: the sky and the houses across the way, each pane tilted a hair from the next as old glass is.
 */
export function glazing(): THREE.MeshStandardNodeMaterial {
  // A mirror, dimmed: glass throws back a few parts in a hundred, but against a dark room that is most of what a window shows by day.
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 1, roughness: 0.03 })
  const at = uv(), which = vertexColor().r, other = vertexColor().g
  const drawn = other.mul(0.34).add(0.04).mul(over(0.25, which)), curtain = over(float(0.5).sub(drawn), abs(at.x.sub(0.5)))
  const fold = sin(at.x.mul(90)).mul(0.12).add(0.88)
  const blind = over(float(1).sub(which.mul(0.55)), at.y).mul(over(0.62, other))
  const room = mix(vec3(0.012, 0.014, 0.018), vec3(0.2, 0.19, 0.17).mul(fold), max(curtain, blind.mul(0.8)))
  m.colorNode = vec3(0.4, 0.44, 0.48)
  // The room is not lit by the street: what shows of it shows by its own light, and in a few a lamp is on.
  m.emissiveNode = room.mul(0.8).add(vec3(1, 0.72, 0.38).mul(over(0.88, which)).mul(float(1).sub(max(curtain, blind)).mul(0.5).add(0.12)))
  // Each pane leans its own way, a degree or so.
  const lean = vec2(hash(vec2(which.mul(91), floor(at.y.mul(2)))), hash(vec2(other.mul(57), floor(at.y.mul(2))))).sub(0.5).mul(0.035)
  m.normalNode = normalView.add(vec3(lean, 0)).normalize()
  return m
}

/** A wall with the dirt it gathers: splashed up from the pavement over its lowest metre, and washed down it in faint streaks. */
function weathered(s: Surface): Surface {
  const high = positionWorld.y.add(positionWorld.z.mul(GRADE)).sub(0.13), splash = smoothstep(1.1, 0, high).mul(noise(onWall, 1.7).a.mul(0.6).add(0.4))
  const streak = smoothstep(0.55, 0.8, noise(vec2(onWall.x.mul(6), onWall.y.mul(0.22)), 1).r)
  const dirt = splash.mul(0.5).add(streak.mul(0.14)).min(0.6)
  return { color: mix(s.color, s.color.mul(vec3(0.5, 0.46, 0.4)), dirt), roughness: mix(s.roughness, float(0.95), dirt), height: s.height }
}

/** The materials a block of house fronts is drawn in, by the kit's names (facade.ts). */
export function fronts(): Record<string, THREE.Material> {
  const paint = vertexColor().rgb
  const iron = new THREE.MeshStandardNodeMaterial({ metalness: 0.55, roughness: 0.5 })
  iron.colorNode = paint
  const glow = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 })
  glow.colorNode = paint
  glow.emissiveNode = paint.mul(2.2)
  const leaf = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 })
  leaf.colorNode = paint
  const stone = concreteAt(vec2(onWall.x.add(positionWorld.x), onWall.y))
  return {
    boards: made(weathered(boards(paint))), plaster: made(weathered(plaster(paint))), trim: made(weathered(joinery(paint)), 0), glass: glazing(),
    stone: made(weathered({ ...stone, color: stone.color.mul(paint).mul(1.9) })), roof: made(roofing(paint)), iron, glow, shingle: made(shingles(paint)), leaf,
  }
}

/** A yard behind a row of houses: grass, darker where shrubs stand, a paved corner here and there. */
export function yard(p: V2 = onGround): Surface {
  const patch = noise(p, 9.3).r, bush = smoothstep(0.55, 0.7, noise(p, 3.1, 0.2).a), blade = noise(p, 0.5).g, paved = over(0.8, noise(p, 13.7, 0.7).a)
  const grass = mix(linear('#6f8f45'), linear('#93a85a'), patch).mul(blade.mul(0.4).add(0.8))
  const color = mix(mix(grass, linear('#3f6a36').mul(blade.mul(0.5).add(0.75)), bush), concreteAt(p).color, paved)
  return { color, roughness: float(0.95), height: blade.mul(0.01).add(bush.mul(0.2)) }
}

/** The hills across the bay: dry grass on their backs, scrub in the gullies that run down them, pale rock at the water. `high` is metres over the water. */
export function hillside(high: F): Surface {
  // A gully runs down the slope, which here faces the block: bands along z, wandering.
  const p = positionWorld.xz, gully = noise(vec2(p.x.add(noise(p, 310).a.mul(60)), p.y.mul(0.2)), 230).r, patch = noise(p, 150, 0.3).a
  const scrub = smoothstep(0.42, 0.66, gully.mul(0.75).add(patch.mul(0.25)).sub(high.mul(0.002)))
  const grass = mix(linear('#a3945c'), linear('#bda865'), noise(p, 67).r)
  const color = mix(mix(grass, linear('#46603a'), scrub.mul(0.85)), linear('#8d8676'), float(1).sub(smoothstep(1, 7, high)))
  return { color, roughness: float(0.95), height: float(0) }
}

/** The bay: dark water under a small chop that runs before the wind, bright where it throws the sky or the sun back. */
export function water(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.08 })
  const p = positionWorld.xz, t = time
  const swell = noise(p.add(vec2(t.mul(0.7), t.mul(0.3))), 41).r, chop = noise(p.sub(vec2(t.mul(0.4), t.mul(0.55))), 11.7, 0.3).a, ripple = noise(p.add(vec2(t.mul(-0.3), t.mul(0.5))), 3.7, 0.6).g
  m.normalNode = relief(swell.mul(0.5).add(chop.mul(0.16)).add(ripple.mul(0.05)))
  // Deeper and bluer far out; a little green and paler over the shallows by the shore.
  const out = smoothstep(180, 420, positionWorld.z)
  m.colorNode = mix(vec3(0.02, 0.085, 0.09), vec3(0.008, 0.035, 0.06), out).mul(chop.mul(0.3).add(0.85))
  return m
}

/** The streets round the block, from afar: a house's painted boxes, tar on whatever faces the sky, a shine on its dark panes, and on a bare back or side wall (`plain`) rows of windows painted on. */
export function distant(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 })
  const paint = vertexColor().rgb, up = over(0.9, normalWorldGeometry.y), bare = attribute<'float'>('plain', 'float')
  const p = onWall, col = fract(p.x.div(2.9)), row = fract(p.y.div(3.0)), near = shows(p.x.div(2.9))
  const frame = within(0.26, 0.74, col).mul(within(0.3, 0.86, row)), glass = within(0.3, 0.7, col).mul(within(0.34, 0.82, row))
  const walls = mix(mix(paint.mul(noise(p, 5.1).r.mul(0.16).add(0.92)), vec3(0.93, 0.9, 0.84), frame.mul(bare).mul(near)), vec3(0.05, 0.065, 0.085), glass.mul(bare).mul(near))
  // A pane is the one dark, blue thing a front is painted with.
  const pane = max(float(1).sub(over(0.12, paint.g)), glass.mul(bare).mul(near)).mul(float(1).sub(up))
  m.colorNode = mix(walls, vec3(0.085, 0.08, 0.085), up)
  m.roughnessNode = mix(float(0.85), float(0.06), pane)
  return m
}

/** A far tower: floors of glass between bands of its own stone or steel, a dark roof. Its paint says which it is mostly made of. */
export function towers(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial()
  const paint = vertexColor().rgb, p = onWall, up = over(0.9, normalWorldGeometry.y)
  const floor = fract(p.y.div(3.9)), bay = fract(p.x.div(3.3)), near = shows(p.y.div(3.9)).mul(shows(p.x.div(3.3)))
  // A tower's own shade varies floor by floor, as blinds are up or down.
  const lit = hash(vec2(floor.sub(p.y.div(3.9)), bay.sub(p.x.div(3.3)))).mul(0.5).add(0.5)
  const pane = within(0.2, 0.92, floor).mul(within(0.1, 0.9, bay)).mul(near).add(float(1).sub(near).mul(0.62)).mul(float(1).sub(up))
  m.colorNode = mix(mix(paint, vec3(0.3, 0.36, 0.42).mul(lit), pane), vec3(0.07, 0.07, 0.075), up)
  m.roughnessNode = mix(float(0.8), float(0.1), pane)
  m.metalnessNode = pane.mul(0.85)
  return m
}
