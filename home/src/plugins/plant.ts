import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { rng } from '../paint'

/** A leafy floor plant in a woven basket, swaying slightly in the warm air. */
export default {
  name: 'plant',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'plant'
    // A villager's workplace (villagers/world.ts SPOTS.plant): its pot stays put (src/physics/home.ts).
    group.userData.body = { material: 'plaster' }
    group.position.set(0.78, 0, WALL_Z + 0.32)
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.3, 24, 4), new THREE.MeshStandardMaterial({ color: '#b98d58', roughness: 0.9 }))
    basket.position.y = 0.15
    basket.castShadow = basket.receiveShadow = true
    group.add(basket)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.014, 8, 28), new THREE.MeshStandardMaterial({ color: '#9a6f40', roughness: 0.9 }))
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.3
    group.add(rim)

    // Broad leaves on arching stems, darker inside, sunlit at the tips.
    const leafShape = new THREE.Shape()
    leafShape.moveTo(0, 0)
    leafShape.bezierCurveTo(0.09, 0.06, 0.08, 0.22, 0, 0.3)
    leafShape.bezierCurveTo(-0.08, 0.22, -0.09, 0.06, 0, 0)
    const leafGeo = new THREE.ShapeGeometry(leafShape, 8)
    const pos = leafGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -Math.abs(pos.getX(i)) * 0.6 + pos.getY(i) * pos.getY(i) * 0.4)
    leafGeo.computeVertexNormals()
    const greens = ['#3a632c', '#47733a', '#557f35', '#628d3f', '#6f9a44', '#83a94e'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }))
    const stemMat = new THREE.MeshStandardMaterial({ color: '#5a7a35', roughness: 0.7 })
    const r = rng(23)
    const leaves: THREE.Object3D[] = []
    const count = ctx.stage.quality === 'low' ? 20 : 34
    for (let i = 0; i < count; i++) {
      const stem = new THREE.Group()
      const a = r() * Math.PI * 2
      const height = 0.3 + r() * 0.55
      const tilt = 0.25 + r() * 0.55
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, height, 5), stemMat)
      stalk.position.y = height / 2
      stem.add(stalk)
      const leaf = new THREE.Mesh(leafGeo, greens[Math.min(5, Math.floor((height - 0.3) / 0.11 + r() * 1.5))])
      leaf.position.y = height
      leaf.rotation.set(-0.6 - r() * 0.6, 0, (r() - 0.5) * 0.5)
      leaf.scale.set(0.8 + r() * 0.4, 0.8 + r() * 0.5, 1)
      leaf.castShadow = true
      stem.add(leaf)
      stem.position.set(Math.cos(a) * 0.05, 0.28, Math.sin(a) * 0.05)
      stem.rotation.set(Math.sin(a) * tilt, a, -Math.cos(a) * tilt, 'YXZ')
      stem.userData.phase = r() * 10
      stem.userData.base = stem.rotation.x
      group.add(stem)
      leaves.push(stem)
    }
    own(ctx, group)
    ctx.on('village/frame', (_dt, t) => {
      for (const s of leaves) s.rotation.x = s.userData.base + Math.sin(t * 0.6 + s.userData.phase) * 0.015
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
