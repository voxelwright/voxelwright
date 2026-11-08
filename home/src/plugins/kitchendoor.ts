import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { DOORWAY, FRONT_Z, HOUSE_H, KITCHEN, LIVING_X, WALL_T, WALL_Z } from '../layout'
import { openDoorway } from '../doorway'
import { canvas, paintPlaster, toTexture } from '../paint'
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
      // Stop 2 mm short of the back and front walls' caps, so no two caps share a top face.
      const ca = za === WALL_Z ? za + 0.002 : za, cb = zb === FRONT_Z ? zb - 0.002 : zb
      const cap = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.004, 0.02, cb - ca), cut)
      cap.position.set(xc, yb + 0.01, (ca + cb) / 2)
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
    // Seated, neither room's view can see the doorway or where its trim's shadow falls
    // (the sun throws it towards +x, into the wall and the living room): skip its shadow draws.
    if (MODE === 'seat') door.traverse((o) => void (o.castShadow = false))
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

    // The seated view faces each room's back wall, and the doorway is beside you, off
    // screen. A painted sign on the back wall points the way and is the doorway's entry
    // there: choosing it walks you through the real doorway.
    if (MODE === 'seat') {
      const signs = new THREE.Group()
      signs.name = 'doorway signs'
      const sign = (text: string, arrow: 'left' | 'right', x: number, y: number) => {
        const [c, g] = canvas(512, 160)
        g.fillStyle = '#c99a62'
        g.fillRect(0, 0, 512, 160)
        g.strokeStyle = 'rgba(92, 58, 30, 0.35)'
        g.lineWidth = 2
        for (let i = 0; i < 9; i++) {
          g.beginPath()
          g.moveTo(0, 12 + i * 17 + Math.sin(i * 1.7) * 4)
          g.bezierCurveTo(170, 6 + i * 17, 340, 20 + i * 17, 512, 10 + i * 17 + Math.cos(i) * 4)
          g.stroke()
        }
        g.fillStyle = '#3c2416'
        g.font = '600 64px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
        g.textBaseline = 'middle'
        g.textAlign = 'center'
        g.fillText(arrow === 'left' ? `\u2190 ${text}` : `${text} \u2192`, 256, 84)
        // One material on the whole board: its thin edges take the painted wood too.
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.02), new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.75 }))
        board.position.set(x, y, WALL_Z + 0.012)
        board.name = `sign ${text}`
        // Hung on a string from a nail (the string's apex).
        const pts = [new THREE.Vector3(x - 0.15, y + 0.065, WALL_Z + 0.012), new THREE.Vector3(x, y + 0.15, WALL_Z + 0.01), new THREE.Vector3(x + 0.15, y + 0.065, WALL_Z + 0.012)]
        const string = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#6b4a2c' }))
        signs.add(board, string)
        return board
      }
      // Above the fridge's right, clear of the clock; in the living room, the back wall's left, over the bookcase.
      const toLiving = sign('Living room', 'right', 1.74, 2.4)
      const toKitchen = sign('Kitchen', 'left', LIVING_X - 2.45, 2.35)
      own(ctx, signs)
      ctx.effect(() => ctx.entries.add({ id: 'sign-living', label: 'Living room', object: toLiving, select: () => void ctx.rooms.go('living') }), 'living room sign')
      ctx.effect(() => ctx.entries.add({ id: 'sign-kitchen', label: 'Kitchen', object: toKitchen, select: () => void ctx.rooms.go('kitchen') }), 'kitchen sign')
    }
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
