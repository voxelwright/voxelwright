import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'

/** A low back light from behind the furniture, so edges catch a warm outline. */
export default {
  name: 'rimlight',
  inject: ['stage'],
  apply(ctx: Context) {
    const rim = new THREE.DirectionalLight('#ffcf9e', 0.9)
    rim.name = 'rim light'
    rim.position.set(1.6, 1.3, -2.0)
    rim.target.position.set(-0.4, 0.6, 1.6)
    own(ctx, rim)
    own(ctx, rim.target)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
