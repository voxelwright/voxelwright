// The yard steps aside where the house grows (#48): fence pickets and rails, flowers,
// stepping stones and shrubs that stand inside a built room, its walls, or the sketch
// paper are left out at runtime. diorama.ts still draws the yard as before; this keeps
// each changed mesh's original instance matrices or index and puts them back on
// restore(). One owner (plugins/build.ts) combines every area to clear into one call.
import * as THREE from 'three/webgpu'
import type { P } from './plan'

/** Instanced yard things, hidden whole by their middle. */
const INSTANCED = ['picket fence', 'yard blooms', 'stepping stones']
/** Merged yard meshes (the shrubs; the fence's rails are found next to its pickets), cut by triangle. */
const MERGED = ['yard plants']

const inside = (p: P, poly: P[]) => {
  let inn = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inn = !inn
  }
  return inn
}

export function makeYard(scene: THREE.Scene) {
  const instanced = new Map<THREE.InstancedMesh, Float32Array>()
  const merged = new Map<THREE.Mesh, THREE.BufferAttribute | null>()
  const zero = new THREE.Matrix4().makeScale(0, 0, 0)
  const m4 = new THREE.Matrix4(), at = new THREE.Vector3()
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  let hiddenCount = 0

  const find = () => {
    for (const name of INSTANCED) {
      const m = scene.getObjectByName(name) as THREE.InstancedMesh | undefined
      if (m?.isInstancedMesh && !instanced.has(m)) instanced.set(m, (m.instanceMatrix.array as Float32Array).slice())
    }
    const fence = scene.getObjectByName('picket fence') as THREE.Mesh | undefined
    const rail = fence?.parent?.children.find((c) => (c as THREE.Mesh).isMesh && c !== fence && (c as THREE.Mesh).material === fence.material) as THREE.Mesh | undefined
    for (const m of [rail, ...MERGED.map((n) => scene.getObjectByName(n) as THREE.Mesh | undefined)]) {
      if (m?.isMesh && !merged.has(m)) merged.set(m, m.geometry.index)
    }
  }

  /** Leave out every yard thing inside any of these floor polygons (world x, z); an empty list puts everything back. */
  const hide = (polys: P[][]) => {
    if (polys.length) find()
    const under = (x: number, z: number) => polys.some((poly) => inside([x, z], poly))
    hiddenCount = 0
    for (const [m, saved] of instanced) {
      m.updateMatrixWorld()
      for (let i = 0; i < m.count; i++) {
        m4.fromArray(saved, i * 16)
        at.setFromMatrixPosition(m4).applyMatrix4(m.matrixWorld)
        const out = under(at.x, at.z)
        if (out) hiddenCount++
        m.setMatrixAt(i, out ? zero : m4)
      }
      m.instanceMatrix.needsUpdate = true
      m.computeBoundingSphere()
    }
    for (const [m, index] of merged) {
      if (!polys.length) {
        m.geometry.setIndex(index)
        continue
      }
      const pos = m.geometry.attributes.position
      const n = index ? index.count : pos.count
      const vi = (t: number) => (index ? index.getX(t) : t)
      m.updateMatrixWorld()
      const keep: number[] = []
      for (let t = 0; t + 2 < n; t += 3) {
        for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(pos, vi(t + j)).applyMatrix4(m.matrixWorld)
        // A triangle goes if any point along its edges is inside: a long rail is cut where it runs under.
        let out = false
        for (let j = 0; j < 3 && !out; j++) for (let s = 0; s <= 12 && !out; s++) {
          const a = v[j], b = v[(j + 1) % 3], f = s / 12
          out = under(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f)
        }
        if (out) hiddenCount++
        else keep.push(vi(t), vi(t + 1), vi(t + 2))
      }
      m.geometry.setIndex(keep)
    }
    if (!polys.length) {
      instanced.clear()
      merged.clear()
    }
  }

  return {
    hide,
    restore: () => hide([]),
    /** Instances and triangles left out by the last hide(). */
    hidden: () => hiddenCount,
  }
}
export type YardHider = ReturnType<typeof makeYard>
