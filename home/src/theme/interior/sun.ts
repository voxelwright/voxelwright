// The sun's shadow, fitted to the house while a theme world stands (#50, regroup 3).
//
// In the dollhouse view the sun's shadow box was 18 m across and the evening sun is low, so
// the house threw a long shadow over the yard that the box's edge cut off in hard diagonal
// wedges. While a world stands: the box is fitted to the house's bounds plus a margin (more
// texels for the room), and the world's ground fades the shadow it receives out to nothing
// within FADE metres of the walls, so no edge of either can show. The seat keeps its own box.
// Without a world nothing changes; `&sunfit=0` turns this off for comparisons.
import * as THREE from 'three/webgpu'
import { Fn, float, max, mix, positionWorld, smoothstep, uniform, vec2 } from 'three/tsl'
import { MODE } from '../../plugins/camera'
import type { House } from '../world'

const OFF = new URLSearchParams(location.search).get('sunfit') === '0'
/** Metres beyond the house's walls the box reaches, and over which the yard's shadow fades out. */
const MARGIN = 2.2
const FADE: [number, number] = [0.3, 1.8]

interface Kept { left: number; right: number; top: number; bottom: number; near: number; far: number }

export function sunFit(scene: THREE.Scene) {
  const kept = new Map<THREE.DirectionalLight, Kept>()
  const faded = new WeakSet<THREE.Material>()
  // The house's footprint on the ground, shared by every faded material.
  const rect = uniform(new THREE.Vector4(0, 0, 0, 0))
  const fade = Fn(([shadow]: [THREE.Node]) => {
    const p = positionWorld.xz
    const out = max(vec2(rect.x, rect.y).sub(p), p.sub(vec2(rect.z, rect.w))).max(0)
    const d = out.length()
    return mix(shadow as THREE.Node<'float'>, float(1), smoothstep(FADE[0], FADE[1], d))
  })
  const corner = new THREE.Vector3()
  const box = new THREE.Box3()

  const restore = () => {
    for (const [sun, k] of kept) {
      Object.assign(sun.shadow.camera, k)
      sun.shadow.camera.updateProjectionMatrix()
    }
    kept.clear()
  }

  /** Each walk: fit while `stood` is a world, put the box back otherwise. */
  const place = (stood: { house: House; group: THREE.Group } | null) => {
    if (OFF || MODE === 'seat' || !stood) return restore()
    const { house, group } = stood
    rect.value.set(house.x0, house.z0, house.x1, house.z1)
    // The ground of the world receives the house's shadow only near the walls.
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || !mesh.receiveShadow) return
      for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
        if (faded.has(m)) continue
        ;(m as THREE.Material & { receivedShadowNode?: unknown }).receivedShadowNode = fade
        m.needsUpdate = true
        faded.add(m)
      }
    })
    scene.traverse((o) => {
      const sun = o as THREE.DirectionalLight
      if (!sun.isDirectionalLight || !sun.castShadow) return
      const cam = sun.shadow.camera
      if (!kept.has(sun)) kept.set(sun, { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far })
      sun.updateMatrixWorld()
      sun.target.updateMatrixWorld()
      sun.shadow.updateMatrices(sun)
      box.makeEmpty()
      for (const x of [house.x0 - MARGIN, house.x1 + MARGIN]) for (const y of [0, house.top]) for (const z of [house.z0 - MARGIN, house.z1 + MARGIN]) {
        box.expandByPoint(corner.set(x, y, z).applyMatrix4(cam.matrixWorldInverse))
      }
      const next = { left: box.min.x, right: box.max.x, bottom: box.min.y, top: box.max.y, near: Math.max(0.1, -box.max.z - 1), far: -box.min.z + 1 }
      if (Object.entries(next).every(([k, v]) => Math.abs(cam[k as keyof Kept] - v) < 1e-3)) return
      Object.assign(cam, next)
      cam.updateProjectionMatrix()
    })
  }
  return { place, drop: restore }
}
