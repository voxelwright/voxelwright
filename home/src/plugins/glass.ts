import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z, WINDOW } from '../layout'
import { paintGlass } from '../paint'

/** Window panes: faint warm reflections and smudges over the garden. */
export default {
  name: 'glass',
  inject: ['stage'],
  apply(ctx: Context) {
    const { x0, x1, y0, y1 } = WINDOW
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, y1 - y0),
      new THREE.MeshBasicMaterial({ map: paintGlass(13), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8, fog: false }),
    )
    pane.name = 'glass'
    pane.position.set((x0 + x1) / 2, (y0 + y1) / 2, WALL_Z - 0.11)
    own(ctx, pane)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
