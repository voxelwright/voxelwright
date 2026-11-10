import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { MODE } from './camera'
import { HOUSE_H, KITCHEN, WALL_T, WALL_Z, WINDOW } from '../layout'
import { floorPlanks, paintPlaster } from '../paint'
import { FLOOR_ROUGHNESS } from '../diorama'

export default {
  name: 'room',
  inject: ['stage'],
  apply(ctx: Context) {
    const room = new THREE.Group()
    room.name = 'room'
    room.userData.body = { material: 'plaster' } // walls and floor (src/physics/home.ts)

    const floorTex = floorPlanks()
    floorTex.repeat.set(6.2, 4.9) // the dollhouse floor's board width and grain over the kitchen
    // The seated view's floor stops at the kitchen's walls: the living room has its own next door.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(KITCHEN.x1 - KITCHEN.x0, 7),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: FLOOR_ROUGHNESS }),
    )
    floor.material.userData.themeRole = 'floor'
    floor.rotation.x = -Math.PI / 2
    floor.position.set((KITCHEN.x0 + KITCHEN.x1) / 2, 0, WALL_Z + 3.5)
    floor.receiveShadow = true
    floor.userData.seatOnly = true // runs past the walls; iso stands on the diorama's own floor (#42)
    room.add(floor)

    // One plaster map stretched over the whole back wall, never repeated, so
    // the blocks around the window share it without seams. The wall runs to the
    // outer corner on the left and to the wall shared with the living room on the right.
    const W0 = KITCHEN.x0 - WALL_T, W1 = KITCHEN.x1, H = HOUSE_H
    const plaster = paintPlaster(5, [244, 239, 230], 1536, 768, 0.45)
    const wallMat = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 })
    wallMat.userData.themeRole = 'wall'
    const T = WALL_T
    const { x0, x1, y0, y1 } = WINDOW
    const block = (xa: number, xb: number, ya: number, yb: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, yb - ya, T), wallMat)
      m.position.set((xa + xb) / 2, (ya + yb) / 2, WALL_Z - T / 2)
      const uv = m.geometry.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (xb - xa) + xa - W0) / (W1 - W0), (uv.getY(i) * (yb - ya) + ya) / H)
      m.castShadow = m.receiveShadow = true
      m.userData.inward = new THREE.Vector3(0, 0, 1) // cut away when a camera stands behind it (#42)
      room.add(m)
    }
    block(W0, x0, 0, H)
    block(x1, W1, 0, H)
    block(x0, x1, 0, y0)
    block(x0, x1, y1, H)

    const side = new THREE.Mesh(new THREE.BoxGeometry(T, H, 6), wallMat)
    side.position.set(-3.4, H / 2, WALL_Z + 3)
    side.receiveShadow = side.castShadow = true
    side.userData.inward = new THREE.Vector3(1, 0, 0)
    room.add(side)

    // Skirting board
    const trim = new THREE.MeshStandardMaterial({ color: '#f1ebe0', roughness: 0.6 })
    trim.userData.themeRole = 'trim'
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(KITCHEN.x1 - KITCHEN.x0, 0.1, 0.02), trim)
    skirt.position.set((KITCHEN.x0 + KITCHEN.x1) / 2, 0.06, WALL_Z + 0.015)
    room.add(skirt)

    own(ctx, room)

    // Soft bounce light from the warm room. The fire's own light lives in the hearth plugin.
    // Under the open sky of the dollhouse the environment (atmosphere.ts) is the fill, and this only lifts the shade a little, cool from above and warm off the floor.
    const hemi = own(ctx, MODE === 'seat' ? new THREE.HemisphereLight('#fff0dc', '#a07a58', 1.6) : new THREE.HemisphereLight('#dfe9ff', '#ffc890', 0.5))
    hemi.name = 'room fill'
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
