import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z, WINDOW } from '../layout'
import { paintGarden } from '../paint'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { MODE, SHADOW_ONLY } from './camera'

export default {
  name: 'window',
  inject: ['stage'],
  apply(ctx: Context) {
    const { quality } = ctx.stage
    const { x0, x1, y0, y1 } = WINDOW
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0
    const group = new THREE.Group()
    group.name = 'window'

    // The garden: a painted backdrop far enough away to parallax against the frame.
    const garden = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 8),
      new THREE.MeshBasicMaterial({ map: paintGarden(3), fog: false }),
    )
    garden.position.set(cx - 1.5, 1.6, WALL_Z - 6)
    garden.userData.seatOnly = true // a painted card: from above it shows over the wall (#42)
    group.add(garden)

    const frameMat = new THREE.MeshStandardMaterial({
      color: '#efe4cf',
      roughness: 0.55,
    })
    const bar = (bw: number, bh: number, x: number, y: number, d = 0.06) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), frameMat)
      m.position.set(x, y, WALL_Z - 0.09)
      m.castShadow = true
      group.add(m)
    }
    const f = 0.06
    bar(w + f * 2, f, cx, y1 + f / 2, 0.2)
    bar(w + f * 2, f, cx, y0 - f / 2, 0.2)
    bar(f, h, x0 - f / 2, cy, 0.2)
    bar(f, h, x1 + f / 2, cy, 0.2)
    bar(0.035, h, cx, cy)
    bar(w, 0.035, cx, cy + h * 0.12)

    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.05, 0.3), frameMat)
    sill.position.set(cx, y0 - 0.03, WALL_Z + 0.06)
    sill.castShadow = sill.receiveShadow = true
    group.add(sill)

    // A little terracotta pot with a leafy plant on the sill
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.055, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: '#c0643c', roughness: 0.85 }),
    )
    pot.position.set(x0 + 0.25, y0 + 0.06, WALL_Z + 0.08)
    pot.castShadow = true
    group.add(pot)
    const leafMat = new THREE.MeshStandardMaterial({ color: '#5f8a3a', roughness: 0.7, side: THREE.DoubleSide })
    const leafGeo = new THREE.SphereGeometry(0.05, 10, 6)
    leafGeo.scale(1, 0.35, 0.55)
    for (let i = 0; i < 9; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat)
      const a = (i / 9) * Math.PI * 2
      leaf.position.set(pot.position.x + Math.cos(a) * 0.06, y0 + 0.15 + (i % 3) * 0.03, pot.position.z + Math.sin(a) * 0.05)
      leaf.rotation.set(0.4 * Math.sin(a), a, 0.6)
      leaf.castShadow = true
      group.add(leaf)
    }

    own(ctx, group)

    // Low golden-hour sun pouring through the window onto the table.
    const sun = new THREE.DirectionalLight('#ffc98a', 5.2)
    sun.name = 'sun'
    sun.position.set(-4.4, 4.0, -7.5)
    sun.target.position.set(0.1, 0.7, 0.2)
    sun.castShadow = true
    const size = quality === 'low' ? 1024 : 2048
    sun.shadow.mapSize.set(size, size)
    sun.shadow.camera.left = -3
    sun.shadow.camera.right = 3
    sun.shadow.camera.top = 3
    sun.shadow.camera.bottom = -3
    sun.shadow.camera.near = 2
    sun.shadow.camera.far = 16
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 4
    if (MODE !== 'seat') {
      // The wider views see the whole floor, so the shadow box covers the whole room
      // (outside it the sun lit the floor in hard wedges), and walls cut away from
      // the camera still throw their shadows (#42).
      Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, far: 22 })
      sun.shadow.radius = 6
      sun.shadow.camera.layers.enable(SHADOW_ONLY)
    }
    if (ctx.stage.features().has('csm')) {
      // Three cascades over the room's depth only (the camera's far plane is 60 m;
      // the kitchen is about 6 m deep), soft-filtered, so near shadows get the texels.
      sun.shadow.mapSize.set(1024, 1024)
      sun.shadow.radius = 6
      sun.shadow.shadowNode = new CSMShadowNode(sun, { cascades: 3, maxFar: 9, mode: 'practical', lightMargin: 6 })
    }
    own(ctx, sun)
    own(ctx, sun.target)

    // Wind in the garden: the backdrop sways a touch, light breathes with passing leaves.
    ctx.on('village/frame', (_dt, t) => {
      garden.position.x = cx - 1.5 + Math.sin(t * 0.3) * 0.02
      sun.intensity = 5.2 + Math.sin(t * 0.7) * 0.15 + Math.sin(t * 1.9) * 0.08
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
