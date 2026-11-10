import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { MODE } from './camera'

/** A low back light from behind the furniture, so edges catch a warm outline. */
export default {
  name: 'rimlight',
  inject: ['stage'],
  apply(ctx: Context) {
    // It has no shadow, so under the dollhouse's open sky it stays faint: there the sun models the furniture.
    const rim = new THREE.DirectionalLight('#ffcf9e', MODE === 'seat' ? 0.9 : 0.2)
    rim.name = 'rim light'
    rim.position.set(1.6, 1.3, -2.0)
    rim.target.position.set(-0.4, 0.6, 1.6)
    own(ctx, rim)
    own(ctx, rim.target)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
