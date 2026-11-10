// Leaves for the garden's trees and shrubs: one material that sways with the wind's gusts,
// breaks its colour into clumps of leaf, and lets the sun warm the side it strikes while
// the far side falls to a cool deep green.
import * as THREE from 'three/webgpu'
import { color, float, materialColor, mix, normalWorld, positionLocal, positionWorld, sin, texture, time, uniform, vec2, vec3 } from 'three/tsl'
import { SUN_DIRECTION } from './sky'
import { gustAt, wind, windNoise } from './wind'

/**
 * A crown of leaves in `base` colour. `foot` is the height (local y) below which nothing
 * sways, and `reach` how far a full gust carries the top, in metres per metre of height.
 */
export function foliage(base: THREE.ColorRepresentation, opts: { foot?: number; reach?: number } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: base, roughness: 0.85 })
  m.userData.themeRole = 'foliage'
  const noise = windNoise()
  const sun = uniform(SUN_DIRECTION)
  const lift = positionLocal.y.sub(opts.foot ?? 0).max(0)
  const gust = gustAt(positionLocal.xz.mul(0.35))
  const rustle = sin(time.mul(2.3).add(positionLocal.x.mul(3.1)).add(positionLocal.y.mul(2.7)).add(positionLocal.z.mul(3.7))).mul(0.012)
  const push = gust.mul(opts.reach ?? 0.035).add(rustle).mul(wind.strength).mul(lift)
  m.positionNode = positionLocal.add(vec3(wind.direction.x.mul(push), rustle.mul(lift).mul(0.4), wind.direction.y.mul(push)))
  // Clumps of leaf: a soft two-tone break in the colour, laid through the air the crown stands in.
  const p = positionWorld
  const clump = texture(noise, vec2(p.x.add(p.y.mul(0.6)), p.z.sub(p.y.mul(0.45))).mul(0.55)).r.smoothstep(0.42, 0.6)
  const facing = normalWorld.dot(sun).mul(0.5).add(0.5)
  const leaf = vec3(materialColor)
  const lit = mix(leaf.mul(color('#5c8f7a')).mul(1.25), leaf.mul(color('#fff4b8')).mul(1.22), facing.smoothstep(0.25, 0.85))
  m.colorNode = lit.mul(mix(float(0.86), float(1.1), clump))
  return m
}
