import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { rng } from '../paint'

/** Dust drifting through the sunbeam between the window and the table. */
export default {
  name: 'motes',
  inject: ['stage'],
  apply(ctx: Context) {
    const count = ctx.stage.quality === 'low' ? 60 : 160
    const mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.0022, 0),
      new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
      count,
    )
    mesh.name = 'motes'
    mesh.frustumCulled = false
    const r = rng(77)
    // Seeds along the beam: from the window opening down towards the table.
    const seeds = Array.from({ length: count }, () => {
      const k = r()
      return {
        k,
        ox: (r() - 0.5) * 0.9,
        oy: (r() - 0.5) * 0.6,
        speed: 0.01 + r() * 0.025,
        phase: r() * 100,
        size: 0.6 + r() * 1.6,
      }
    })
    const from = new THREE.Vector3(-0.85, 1.65, -2.0)
    const to = new THREE.Vector3(0.1, 0.9, 0.3)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    ctx.on('village/frame', (_dt, t) => {
      for (let i = 0; i < count; i++) {
        const d = seeds[i]
        const k = (d.k + t * d.speed) % 1
        p.lerpVectors(from, to, k)
        p.x += d.ox + Math.sin(t * 0.3 + d.phase) * 0.06
        p.y += d.oy + Math.sin(t * 0.21 + d.phase * 1.3) * 0.05
        p.z += Math.cos(t * 0.17 + d.phase) * 0.05
        // Fade in and out at the ends of the beam by scale
        s.setScalar(d.size * Math.sin(k * Math.PI))
        m.compose(p, q, s)
        mesh.setMatrixAt(i, m)
      }
      mesh.instanceMatrix.needsUpdate = true
    })
    own(ctx, mesh)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
