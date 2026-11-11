// What the street's loose and made things look like (#136). The world draws them (they are its
// toys), and asks here for each material and paint: wood has a grain and a crate its slats,
// rubber a dull bloom, steel a brushed shine, ice and jelly their gloss, fur a soft edge. Each is
// painted over the thing's own shape, so it stays put as the thing rolls.
import * as THREE from 'three/webgpu'
import { abs, float, floor, fract, max, min, mix, normalLocal, positionLocal, smoothstep, texture, vec2, vec3, vertexColor } from 'three/tsl'
import { material as facts } from '../../../home/src/engine/materials.ts'
import type { PartSpec } from '../../../home/src/engine/toy.ts'
import { NOISE, made, type Surface } from './surfaces.ts'

type F = THREE.Node<'float'>
type V2 = THREE.Node<'vec2'>
type V3 = THREE.Node<'vec3'>

// A point on a thing's own surface, seen flat from whichever side its face looks: three views, weighed by how squarely each sees it.
const n = normalLocal.abs(), p = positionLocal, weight = n.pow(6), share = weight.div(weight.x.add(weight.y).add(weight.z))
const over = <T extends F | V3>(f: (q: V2) => T): T => (f(p.zy) as F).mul(share.x).add((f(p.xz) as F).mul(share.y)).add((f(p.xy) as F).mul(share.z)) as T
const read = (q: V2, size: number, shift = 0) => texture(NOISE, q.mul(1 / size).add(shift))

/** How each of the engine's materials is painted: which grain, how deep, how much its roughness wanders. */
const KIND: Record<string, 'wood' | 'metal' | 'soft' | 'gloss' | 'grit' | 'fuzz'> = {
  maple: 'wood', walnut: 'wood', lacquer: 'gloss', cork: 'grit', steel: 'metal', brass: 'metal', rubber: 'soft', felt: 'fuzz', fur: 'fuzz', glass: 'gloss', plaster: 'grit', wax: 'soft',
  paper: 'soft', ceramic: 'gloss', fruit: 'soft', stone: 'grit', asphalt: 'grit', foam: 'grit', plastic: 'gloss', ice: 'gloss', jelly: 'gloss',
}

/** A crate's face: slats with gaps between, a frame of boards round the edge, grain along each. `half` is half its side. */
function crate(tone0: V3, half: number, variant: number): Surface {
  // Four kinds of crate, so a wall of them is not one crate over and over: older and newer wood, slats up or across.
  const tone = tone0.mul([1, 0.88, 1.07, 0.8][variant])
  const face = (q0: V2) => {
    const q = variant % 2 ? vec2(q0.y, q0.x) : q0
    const frame = smoothstep(half - 0.062, half - 0.058, max(abs(q.x), abs(q.y)))
    const slat = fract(q.y.add(half).div(0.148)), gap = float(1).sub(smoothstep(0.02, 0.05, min(slat, float(1).sub(slat)))).mul(float(1).sub(frame))
    // Grain runs along a slat; round the frame it runs along each board.
    const along = mix(vec2(q.x.mul(0.1), q.y), vec2(q.x, q.y.mul(0.1)), frame.mul(smoothstep(0, 0.01, abs(q.x).sub(abs(q.y)))))
    const grain = read(along, 0.21).a, board = read(vec2(floor(q.y.add(half).div(0.148)).mul(0.37), 0.5), 1).r
    return vec3(grain, gap, frame.add(board.mul(0.3)))
  }
  const f = over(face), grain = f.x, gap = f.y, frame = smoothstep(0.5, 1, f.z), board = f.z.sub(frame).mul(3.3)
  const color = tone.mul(grain.sub(0.5).mul(0.42).add(1)).mul(board.sub(0.5).mul(0.22).add(1)).mul(mix(float(1), float(1.1), frame)).mul(float(1).sub(gap.mul(0.72)))
  return { color, roughness: float(0.72).add(grain.mul(0.14)), height: frame.mul(0.006).sub(gap.mul(0.008)).add(grain.mul(0.0012)) }
}

const isCrate = (part: PartSpec) => part.material === 'maple' && !part.paint && !part.pieces && part.shape.kind === 'box' && /^crate-/.test(part.id)
/** What this page's look for a part depends on beyond its material and paint: the world keeps one look for each such kind. */
const kindOf = (part: PartSpec) => (Number(/\d+/.exec(part.id)?.[0] ?? 0) * 7 + 3) % 4
export const dressKey = (part: PartSpec) => (isCrate(part) ? `:crate${(part.shape as { half: number[] }).half[0]}:${kindOf(part)}` : '')

/** The material the page draws a part in, or null to leave it to the world (a part with a card or a light keeps the world's own). */
export function dress(part: PartSpec): THREE.Material | null {
  const fact = facts(part.material)
  if (!fact || part.hidden) return null
  const kind = KIND[part.material] ?? 'soft', look = fact.look
  const paint: V3 = part.pieces ? vertexColor().rgb : (() => { const c = new THREE.Color(part.paint ?? look.color); return vec3(c.r, c.g, c.b) })()
  if (isCrate(part)) return made(crate(paint, (part.shape as { half: number[] }).half[0], kindOf(part)))
  const cloud = over((q) => read(q, 0.9).r), fine = over((q) => read(q, 0.17).g)
  let surface: Surface
  if (kind === 'wood') {
    const grain = over((q) => read(vec2(q.x.mul(0.09), q.y), 0.19).a)
    surface = { color: paint.mul(grain.sub(0.5).mul(0.4).add(1)).mul(cloud.sub(0.5).mul(0.12).add(1)), roughness: float(look.roughness).add(grain.mul(0.18)), height: grain.mul(0.0012) }
  } else if (kind === 'metal') {
    // Brushed, a little duller where it has been handled; a painted metal thing is paint first.
    const brush = over((q) => read(vec2(q.x.mul(0.04), q.y), 0.12).g)
    surface = { color: paint.mul(cloud.sub(0.5).mul(0.1).add(1)), roughness: float(Math.max(0.18, look.roughness)).add(brush.mul(0.22)).add(cloud.mul(0.1)), height: brush.mul(0.0003) }
  } else if (kind === 'gloss') {
    surface = { color: paint.mul(cloud.sub(0.5).mul(0.06).add(1)), roughness: float(Math.min(look.roughness, 0.3)).add(fine.mul(0.05)), height: fine.mul(0.00025) }
  } else if (kind === 'grit') {
    surface = { color: paint.mul(fine.sub(0.5).mul(0.3).add(1)).mul(cloud.sub(0.5).mul(0.14).add(1)), roughness: float(Math.max(0.85, look.roughness)), height: fine.mul(0.004) }
  } else if (kind === 'fuzz') {
    surface = { color: paint.mul(fine.sub(0.5).mul(0.22).add(1)), roughness: float(1), height: fine.mul(0.002) }
  } else {
    // Rubber, wax, fruit: a dull bloom over it, scuffed in places.
    surface = { color: paint.mul(cloud.sub(0.5).mul(0.1).add(1)), roughness: float(look.roughness).sub(0.12).add(cloud.mul(0.25)), height: fine.mul(0.0006) }
  }
  const drawn = made(surface)
  drawn.metalness = part.paint && kind === 'metal' ? look.metalness * 0.35 : look.metalness
  if (kind === 'fuzz' || part.material === 'ice' || part.material === 'jelly' || part.material === 'lacquer' || part.material === 'plastic') {
    // A soft thing catches light round its edge; ice, jelly and lacquer shine under a clear coat.
    const fine = new THREE.MeshPhysicalNodeMaterial({ metalness: drawn.metalness })
    fine.colorNode = drawn.colorNode
    fine.roughnessNode = drawn.roughnessNode
    fine.normalNode = drawn.normalNode
    if (kind === 'fuzz') { fine.sheen = 1; fine.sheenRoughness = 0.55; fine.sheenNode = paint.mul(0.6).add(0.25) }
    else { fine.clearcoat = part.material === 'plastic' ? 0.35 : 1; fine.clearcoatRoughness = part.material === 'ice' ? 0.12 : 0.06 }
    if (part.material === 'jelly' || part.material === 'ice') fine.emissiveNode = paint.mul(part.material === 'jelly' ? 0.2 : 0.08)
    drawn.dispose()
    return fine
  }
  return drawn
}
