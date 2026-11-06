import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z, WINDOW } from '../layout'
import { paintPlaster, paintWood } from '../paint'

export default {
  name: 'room',
  inject: ['stage'],
  apply(ctx: Context) {
    const { scene } = ctx.stage
    const room = new THREE.Group()
    room.name = 'room'

    const floorTex = paintWood({ seed: 11, planks: 8, light: [170, 116, 74], dark: [128, 82, 50], knots: 3 })
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
    floorTex.repeat.set(2, 3)
    floorTex.rotation = Math.PI / 2
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.62 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    room.add(floor)

    const plaster = paintPlaster(5, [246, 230, 204])
    plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping
    const wallMat = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 })
    const T = 0.18
    const H = 3.0
    const { x0, x1, y0, y1 } = WINDOW
    const block = (xa: number, xb: number, ya: number, yb: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, yb - ya, T), wallMat)
      m.position.set((xa + xb) / 2, (ya + yb) / 2, WALL_Z - T / 2)
      // Keep painted plaster at a consistent scale across blocks
      const uv = m.geometry.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (xb - xa) + xa) / 3, (uv.getY(i) * (yb - ya) + ya) / 3)
      m.castShadow = m.receiveShadow = true
      room.add(m)
    }
    block(-3.4, x0, 0, H)
    block(x1, 3.4, 0, H)
    block(x0, x1, 0, y0)
    block(x0, x1, y1, H)

    const side = new THREE.Mesh(new THREE.BoxGeometry(T, H, 6), wallMat)
    side.position.set(-3.4, H / 2, WALL_Z + 3)
    side.receiveShadow = side.castShadow = true
    room.add(side)

    // Skirting board
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, 0.12, 0.03),
      new THREE.MeshStandardMaterial({ color: '#7a5034', roughness: 0.7 }),
    )
    skirt.position.set(0, 0.06, WALL_Z + 0.015)
    room.add(skirt)

    own(ctx, room)

    // Soft bounce light from the warm room, and a flickering hearth off to the right.
    const hemi = own(ctx, new THREE.HemisphereLight('#ffe6c4', '#7a5238', 1.1))
    hemi.name = 'room fill'
    const hearth = own(ctx, new THREE.PointLight('#ff8a3c', 5, 7, 1.6))
    hearth.name = 'hearth glow'
    hearth.position.set(3.0, 0.6, 0.6)
    ctx.on('village/frame', (_dt, t) => {
      hearth.intensity = 4.2 + Math.sin(t * 7.1) * 0.4 + Math.sin(t * 13.3 + 1) * 0.3 + Math.sin(t * 2.3) * 0.5
    })

    ctx.effect(() => {
      const before = scene.fog
      const background = scene.background
      scene.fog = new THREE.Fog('#e8c49a', 6, 22)
      scene.background = new THREE.Color('#2a1d16')
      return () => {
        scene.fog = before
        scene.background = background
      }
    }, 'room atmosphere')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
