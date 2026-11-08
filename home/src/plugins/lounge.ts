import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { canvas, paintKidDrawing, paintPlaster, paintWood, rng, toTexture } from '../paint'
import { HOUSE_H, LIVING_X, WALL_T } from '../layout'

/** Living room measurements, local to the room (x from LIVING_X). Its left wall is the one it shares with the kitchen. */
export const LOUNGE = { back: -2.2, right: 1.6, left: -3.2, height: HOUSE_H }

/**
 * The living room shell, next door to the kitchen: oak floor, the back and right
 * walls meeting in the plant corner, and a lamp's warm glow. Fog, background, sun
 * and fill are the house's, from the kitchen's plugins.
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

    // Thick plaster walls, as the kitchen's: the back wall runs from the shared wall's
    // kitchen face to the outer corner, the right wall (with the Workshop's door) between it and the front.
    const wallMat = new THREE.MeshStandardMaterial({ map: paintPlaster(41, [240, 236, 229], 1536, 768, 0.3), roughness: 0.95 })
    const T = WALL_T
    const wall = (x0: number, x1: number, z0: number, z1: number, inward: THREE.Vector3) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, height, z1 - z0), wallMat)
      m.position.set((x0 + x1) / 2, height / 2, (z0 + z1) / 2)
      const uv = m.geometry.attributes.uv as THREE.BufferAttribute
      const len = Math.max(x1 - x0, z1 - z0)
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 6, uv.getY(i))
      m.castShadow = m.receiveShadow = true
      m.userData.inward = inward // cut away when a camera stands behind it (#42)
      room.add(m)
    }
    wall(left - T, right + T, back - T, back, new THREE.Vector3(0, 0, 1))
    wall(right, right + T, back, back + 6, new THREE.Vector3(-1, 0, 0))
    // The seated view looks up into the room: a ceiling it sees from below only.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(right - left, 6), new THREE.MeshStandardMaterial({ color: '#efe9e0', roughness: 0.95 }))
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set((left + right) / 2, height, back + 3)
    ceiling.userData.seatOnly = true
    room.add(ceiling)
    const trim = new THREE.MeshStandardMaterial({ color: '#f3efe8', roughness: 0.6 })
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(right - left, 0.09, 0.02), trim)
    skirt.position.set((left + right) / 2, 0.045, back + 0.01)
    room.add(skirt)
    const skirtSide = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 6), trim)
    skirtSide.position.set(right - 0.01, 0.045, back + 3)
    room.add(skirtSide)

    // A soft woven rug in front of the sideboard: terracotta and honey bands on cream wool.
    const [rc, rg] = canvas(512, 320)
    rg.fillStyle = '#efdcc0'
    rg.fillRect(0, 0, 512, 320)
    const weave = rng(41)
    for (let i = 0; i < 2200; i++) {
      rg.fillStyle = `rgba(150, 90, 50, ${0.03 + weave() * 0.05})`
      rg.fillRect(weave() * 512, weave() * 320, 2 + weave() * 6, 1)
    }
    for (const [y, h, colour] of [[40, 16, '#c06a45'], [64, 6, '#e0a95a'], [250, 6, '#e0a95a'], [264, 16, '#c06a45']] as const) {
      rg.fillStyle = colour
      rg.globalAlpha = 0.75
      rg.fillRect(20, y, 472, h)
    }
    rg.globalAlpha = 0.5
    for (let x = 60; x < 460; x += 56) {
      rg.fillStyle = '#b5583a'
      rg.beginPath()
      rg.moveTo(x, 160)
      rg.lineTo(x + 18, 130)
      rg.lineTo(x + 36, 160)
      rg.lineTo(x + 18, 190)
      rg.closePath()
      rg.fill()
    }
    rg.globalAlpha = 1
    rg.strokeStyle = '#a4553a'
    rg.lineWidth = 12
    rg.strokeRect(8, 8, 496, 304)
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), new THREE.MeshStandardMaterial({ map: toTexture(rc), roughness: 1 }))
    rug.rotation.x = -Math.PI / 2
    rug.position.set(-0.4, 0.004, back + 1.3)
    rug.receiveShadow = true
    room.add(rug)

    // A child's painting taped to the side wall, between the plant corner and the workshop door.
    const painting = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), new THREE.MeshStandardMaterial({ map: paintKidDrawing(8), roughness: 0.9 }))
    painting.rotation.y = -Math.PI / 2
    painting.rotation.x = 0.02
    painting.position.set(right - 0.006, 1.5, back + 0.95)
    room.add(painting)

    // A low cushioned bench under the plant shelves, pine base and an oatmeal cushion.
    const pine = new THREE.MeshStandardMaterial({ map: paintWood({ seed: 52, w: 256, h: 128, planks: 1, light: [214, 178, 134], dark: [184, 146, 104], knots: 1 }), roughness: 0.6 })
    const bench = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.36, 0.36), pine)
    base.position.y = 0.18
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.07, 0.34, 6, 1, 4), new THREE.MeshStandardMaterial({ color: '#e9dfcf', roughness: 1 }))
    const bulge = cushion.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < bulge.count; i++) if (bulge.getY(i) > 0) bulge.setY(i, bulge.getY(i) + 0.018 * Math.cos((bulge.getX(i) / 0.76) * Math.PI) * Math.cos((bulge.getZ(i) / 0.34) * Math.PI))
    cushion.geometry.computeVertexNormals()
    cushion.position.y = 0.395
    for (const m of [base, cushion]) m.castShadow = m.receiveShadow = true
    bench.add(base, cushion)
    bench.position.set(0.3, 0, back + 0.22)
    room.add(bench)

    // The house shares one sun and one fill (the kitchen's). The living room adds only a
    // warm lamp-light that fades out before the kitchen, so its corner glows in the evening.
    // One light for the room (the sideboard lamp and the grow strips are emissive): with the
    // whole house drawn, every point light is paid for by every pixel.
    const glow = new THREE.PointLight('#ffc98a', 2.6, 5.5, 1.2)
    glow.name = 'lounge glow'
    glow.position.set(-0.5, 1.9, back + 1.1)
    room.add(glow)
    own(ctx, room)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
