import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintPanelling } from '../paint'

/** Painted tongue-and-groove panelling on the lower wall with a dado rail. */
export default {
  name: 'panelling',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'panelling'
    const height = 0.92, width = 6.8
    const tex = paintPanelling(41, [150, 168, 140])
    tex.wrapS = THREE.RepeatWrapping
    tex.repeat.set(width / 1.2, 1)
    const boards = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }))
    boards.position.set(0, height / 2, WALL_Z + 0.004)
    boards.receiveShadow = true
    group.add(boards)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, 0.035), new THREE.MeshStandardMaterial({ color: '#8fa286', roughness: 0.6 }))
    rail.position.set(0, height + 0.02, WALL_Z + 0.018)
    rail.castShadow = rail.receiveShadow = true
    group.add(rail)
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
