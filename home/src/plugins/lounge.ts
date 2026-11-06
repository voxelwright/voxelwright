import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { canvas, paintPlaster, paintWood, toTexture } from '../paint'
import { LIVING_X } from '../layout'

/** Living room corner measurements, local to the room. */
export const LOUNGE = { back: -2.2, right: 1.6, left: -3.2, height: 2.9, door: { x0: -2.36, x1: -1.64, top: 2.05 } }

/**
 * The living room shell: oak floor, two soft white walls meeting in the plant
 * corner, an evening table lamp's warmth and a quiet fill. Fog and background
 * stay with the kitchen's room plugin, so this one never touches them.
 */
export default {
  name: 'lounge',
  inject: ['stage'],
  apply(ctx: Context) {
    const room = new THREE.Group()
    room.name = 'lounge'
    room.position.x = LIVING_X
    const { back, right, left, height } = LOUNGE

    const floorTex = paintWood({ seed: 17, planks: 7, light: [214, 190, 160], dark: [178, 152, 122], knots: 1 })
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
    floorTex.repeat.set(4, 5)
    floorTex.rotation = Math.PI / 2
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(right - left, 6), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.set((left + right) / 2, 0, back + 3)
    floor.receiveShadow = true
    room.add(floor)

    const wallMat = new THREE.MeshStandardMaterial({ map: paintPlaster(41, [240, 236, 229], 1536, 768, 0.3), roughness: 0.95 })
    // The back wall is three panels around the kitchen doorway, sharing one unrepeated map.
    const panel = (xa: number, xb: number, ya: number, yb: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, yb - ya), wallMat)
      m.position.set((xa + xb) / 2, (ya + yb) / 2, back)
      const uv = m.geometry.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (xb - xa) + xa - left) / (right - left), (uv.getY(i) * (yb - ya) + ya) / height)
      m.receiveShadow = true
      room.add(m)
    }
    const { door } = LOUNGE
    panel(left, door.x0, 0, height)
    panel(door.x0, door.x1, door.top, height)
    panel(door.x1, right, 0, height)
    const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(6, height), wallMat)
    sideWall.rotation.y = -Math.PI / 2
    sideWall.position.set(right, height / 2, back + 3)
    sideWall.receiveShadow = true
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(right - left, 6), new THREE.MeshStandardMaterial({ color: '#efe9e0', roughness: 0.95 }))
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set((left + right) / 2, height, back + 3)
    room.add(sideWall, ceiling)
    const trim = new THREE.MeshStandardMaterial({ color: '#f3efe8', roughness: 0.6 })
    for (const [xa, xb] of [[left, door.x0], [door.x1, right]]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, 0.09, 0.02), trim)
      skirt.position.set((xa + xb) / 2, 0.045, back + 0.01)
      room.add(skirt)
    }
    const skirtSide = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 6), trim)
    skirtSide.position.set(right - 0.01, 0.045, back + 3)
    room.add(skirtSide)

    // A soft woven rug in front of the sideboard.
    const [rc, rg] = canvas(512, 320)
    rg.fillStyle = '#e9dccb'
    rg.fillRect(0, 0, 512, 320)
    for (let y = 18; y < 320; y += 22) {
      rg.fillStyle = y % 44 < 22 ? 'rgba(176, 120, 92, 0.35)' : 'rgba(120, 140, 110, 0.25)'
      rg.fillRect(14, y, 484, 6)
    }
    rg.strokeStyle = '#b0785c'
    rg.lineWidth = 10
    rg.strokeRect(8, 8, 496, 304)
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), new THREE.MeshStandardMaterial({ map: toTexture(rc), roughness: 1 }))
    rug.rotation.x = -Math.PI / 2
    rug.position.set(-0.6, 0.004, back + 1.6)
    rug.receiveShadow = true
    room.add(rug)

    // Evening light: a warm key from the lamp side, a soft fill, and a bounce.
    const fill = new THREE.HemisphereLight('#fff4e6', '#9a8068', 1.05)
    fill.name = 'lounge fill'
    room.add(fill)
    const key = new THREE.DirectionalLight('#ffd9a8', 1.15)
    key.name = 'lounge key'
    key.position.set(-2.5, 3.2, 2.5)
    key.target.position.set(0.6, 0.8, -1.8)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.0005
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 10 })
    room.add(key, key.target)
    own(ctx, room)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
