import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintBotanical } from '../paint'

/** A framed watercolour botanical print in a thin walnut frame. */
export default {
  name: 'botanical',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'botanical'
    group.position.set(-2.25, 1.75, WALL_Z + 0.015)
    const w = 0.36, h = 0.48, f = 0.025
    const walnut = new THREE.MeshStandardMaterial({ color: '#5a3a26', roughness: 0.5 })
    for (const [bw, bh, x, y] of [[w + f * 2, f, 0, h / 2 + f / 2], [w + f * 2, f, 0, -h / 2 - f / 2], [f, h, -w / 2 - f / 2, 0], [f, h, w / 2 + f / 2, 0]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.03), walnut)
      bar.position.set(x, y, 0)
      bar.castShadow = true
      group.add(bar)
    }
    const print = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: paintBotanical(19), roughness: 0.8 }))
    print.position.z = -0.005
    print.receiveShadow = true
    group.add(print)
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
