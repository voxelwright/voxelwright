import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z, WINDOW } from '../layout'

// Matches the sun in plugins/window.ts: from (-4.4, 4.0, -7.5) towards (0.1, 0.7, 0.2).
const SUN_DIRECTION = new THREE.Vector3(4.5, -3.3, 7.7).normalize()

/**
 * A shaft of light from the window: the window opening swept along the sun's
 * direction. Several nested, slightly shrunk shells add up to a soft edge, and
 * vertex colours fade it out along its length.
 */
export default {
  name: 'sunbeam',
  inject: ['stage'],
  apply(ctx: Context) {
    const { x0, x1, y0, y1 } = WINDOW
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const length = 2.6
    const shells = ctx.stage.quality === 'low' ? 6 : 12
    const group = new THREE.Group()
    group.name = 'sunbeam'
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
    for (let s = 0; s < shells; s++) {
      const k = 1 - s * 0.035
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => new THREE.Vector3(cx + (x - cx) * k, cy + (y - cy) * k, WALL_Z - 0.05))
      const positions: number[] = []
      const colors: number[] = []
      const near = new THREE.Color('#ffcf8a').multiplyScalar(0.011)
      const far = new THREE.Color(0, 0, 0)
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4]
        const a2 = a.clone().addScaledVector(SUN_DIRECTION, length), b2 = b.clone().addScaledVector(SUN_DIRECTION, length)
        for (const [p, c] of [[a, near], [b, near], [b2, far], [a, near], [b2, far], [a2, far]] as const) {
          positions.push(p.x, p.y, p.z)
          colors.push(c.r, c.g, c.b)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      const shell = new THREE.Mesh(geo, material)
      shell.renderOrder = 5
      group.add(shell)
    }
    own(ctx, group)
    ctx.on('village/frame', (_dt, t) => {
      material.opacity = 0.85 + Math.sin(t * 0.7) * 0.08 + Math.sin(t * 1.9) * 0.05
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
