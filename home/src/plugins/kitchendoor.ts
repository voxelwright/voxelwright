import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { DOORWAY, FRONT_Z, HOUSE_H, KITCHEN, WALL_T, WALL_Z } from '../layout'
import { openDoorway } from '../doorway'
import { paintPlaster } from '../paint'
import { CUT } from '../diorama'
import { MODE } from './camera'

/**
 * The wall the kitchen shares with the living room, and the open doorway in it.
 * The doorway is two entries, one on each face: choosing it glides the view through
 * to the room on the other side.
 * The wall is interior (`userData.interior`): in the dollhouse it stands at full
 * height only when you look into a room it backs, and is a low cut stub otherwise.
 */
export default {
  name: 'kitchendoor',
  inject: ['stage', 'entries', 'rooms'],
  apply(ctx: Context) {
    const { z0, z1, top } = DOORWAY
    const xa = KITCHEN.x1, xb = KITCHEN.x1 + WALL_T, xc = (xa + xb) / 2
    const group = new THREE.Group()
    group.name = 'shared wall'
    const interior = { x: xc }
    const plaster = new THREE.MeshStandardMaterial({ map: paintPlaster(5, [244, 239, 230], 1536, 768, 0.45), roughness: 0.95 })
    const cut = new THREE.MeshStandardMaterial({ color: CUT, roughness: 0.8 })
    const piece = (za: number, zb: number, ya: number, yb: number, stub = false) => {
      const geo = new THREE.BoxGeometry(WALL_T, yb - ya, zb - za)
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (zb - za) + za - WALL_Z) / 6, (uv.getY(i) * (yb - ya) + ya) / HOUSE_H)
      const m = new THREE.Mesh(geo, plaster)
      m.position.set(xc, (ya + yb) / 2, (za + zb) / 2)
      m.castShadow = m.receiveShadow = true
      m.userData.interior = interior
      group.add(m)
      if (MODE !== 'iso') return
      const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.004, 0.02, zb - za), cut)
      cap.position.set(xc, yb + 0.01, m.position.z)
      cap.castShadow = true
      cap.userData.interior = interior
      group.add(cap)
      if (stub) for (const o of [m, cap]) {
        o.userData.cutaway = true // shown in place of the full wall when it is cut
        o.visible = false
      }
    }
    piece(WALL_Z, z0, 0, HOUSE_H)
    piece(z1, FRONT_Z, 0, HOUSE_H)
    piece(z0, z1, top, HOUSE_H)
    if (MODE === 'iso') {
      piece(WALL_Z, z0, 0, 0.42, true)
      piece(z1, FRONT_Z, 0, 0.42, true)
    }
    own(ctx, group)

    // The doorway faces the kitchen (its local +z is world -x).
    const door = openDoorway(z1 - z0, top, WALL_T)
    door.name = 'kitchen doorway'
    door.rotation.y = -Math.PI / 2
    door.position.set(xa, 0, (z0 + z1) / 2)
    // The trim goes with the wall when it is cut; the pick slabs and the threshold stay.
    for (const part of [...door.sides.map((s) => s.children[0]), door.getObjectByName('lining')!]) part.userData.interior = interior
    own(ctx, door)
    ctx.effect(() => ctx.entries.add({
      id: 'to-living',
      label: 'Living room',
      object: door.sides[0],
      select: () => void ctx.rooms.go('living'),
    }), 'living room entry')
    ctx.effect(() => ctx.entries.add({
      id: 'to-kitchen',
      label: 'Kitchen',
      object: door.sides[1],
      select: () => void ctx.rooms.go('kitchen'),
    }), 'kitchen entry')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
