import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintAlphabet, paintBrushed, paintKidDrawing, paintPhoto, rng } from '../paint'

const KINDS = ['beach', 'cat', 'mountains', 'drawing'] as const
const MAGNETS = ['#d9534f', '#f0ad4e', '#5bc0de', '#7cb35b', '#b388c9', '#f7e7c6']

/**
 * The heart of the kitchen: a stainless bottom-freezer fridge covered in
 * polaroids, magnets, an alphabet poster and a child's drawing. Photos are
 * painted placeholders until family privacy is in place.
 */
export default {
  name: 'fridge',
  inject: ['stage', 'view', 'entries'],
  apply(ctx: Context) {
    const low = ctx.stage.quality === 'low'
    const group = new THREE.Group()
    group.name = 'fridge'
    const W = 0.72, H = 1.78, D = 0.68
    group.position.set(1.5, 0, WALL_Z + D / 2 + 0.02)
    group.rotation.y = -0.12

    const brushed = paintBrushed(9)
    const steel = new THREE.MeshPhysicalMaterial({ map: brushed, color: '#eef0f2', metalness: 0.3, roughness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.3 })
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.03), steel)
    body.position.y = H / 2 + 0.04
    body.castShadow = body.receiveShadow = true
    group.add(body)

    const front = D / 2
    const freezerTop = 0.62
    const seam = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.012, 0.01), new THREE.MeshStandardMaterial({ color: '#4a4a4a' }))
    seam.position.set(0, freezerTop, front + 0.001)
    group.add(seam)
    const handleMat = new THREE.MeshStandardMaterial({ color: '#d8d6d0', metalness: 1, roughness: 0.25 })
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.6, 0.035, 3, 0.01), handleMat)
    door.position.set(W / 2 - 0.06, 1.25, front + 0.03)
    const drawer = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.03, 0.035, 3, 0.01), handleMat)
    drawer.position.set(0, freezerTop - 0.06, front + 0.03)
    for (const h of [door, drawer]) {
      h.castShadow = true
      group.add(h)
    }

    // Laundry baskets on top, as in the real kitchen.
    const rope = new THREE.MeshStandardMaterial({ color: '#efe8dc', roughness: 0.95 })
    const band = new THREE.MeshStandardMaterial({ color: '#b48a5e', roughness: 0.9 })
    for (const x of [-0.17, 0.17]) {
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.2, 20, 1), rope)
      basket.position.set(x, H + 0.04 + 0.1, 0)
      basket.castShadow = true
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.148, 0.035, 20, 1, true), band)
      stripe.position.set(x, H + 0.04 + 0.04, 0)
      group.add(basket, stripe)
    }

    // Everything stuck to the door sits just in front of it.
    const magnetGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.01, 14)
    const stick = (mesh: THREE.Mesh, x: number, y: number, rot: number, layer: number, magnet?: string) => {
      mesh.position.set(x, y, front + 0.003 + layer * 0.0006)
      mesh.rotation.z = rot
      mesh.receiveShadow = true
      if (magnet) {
        const m = new THREE.Mesh(magnetGeo, new THREE.MeshStandardMaterial({ color: magnet, roughness: 0.3 }))
        m.rotation.x = Math.PI / 2
        const size = (mesh.geometry as THREE.PlaneGeometry).parameters.height
        m.position.set(0, size / 2 - 0.015, 0.006)
        m.castShadow = true
        mesh.add(m)
      }
      group.add(mesh)
    }

    const alphabet = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.35), new THREE.MeshStandardMaterial({ map: paintAlphabet(3), roughness: 0.8 }))
    stick(alphabet, -0.1, 1.05, 0.0, 0)
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.165), new THREE.MeshStandardMaterial({ map: paintKidDrawing(61), roughness: 0.9 }))
    stick(art, 0.17, 0.95, 0.06, 1, '#e8a0bf')

    // Polaroids, mostly on the upper door, a couple on the freezer.
    const r = rng(42)
    const count = low ? 10 : 16
    const spots: [number, number][] = []
    let s = 1
    for (let i = 0; i < count; i++) {
      const lower = i >= count - 3
      let x = 0, y = 0
      for (let tries = 0; tries < 20; tries++) {
        x = -W / 2 + 0.09 + r() * (W - 0.24)
        y = lower ? 0.2 + r() * 0.3 : 1.32 + r() * 0.42
        if (spots.every(([sx, sy]) => Math.abs(sx - x) > 0.1 || Math.abs(sy - y) > 0.12)) break
      }
      spots.push([x, y])
      const photo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.09 * (s = 0.85 + r() * 0.5), 0.105 * s),
        new THREE.MeshStandardMaterial({ map: paintPhoto(KINDS[Math.floor(r() * KINDS.length)], 50 + i), roughness: 0.7 }),
      )
      stick(photo, x, y, (r() - 0.5) * 0.3, 2 + (i % 3), r() < 0.6 ? MAGNETS[i % MAGNETS.length] : undefined)
    }
    own(ctx, group)

    // An entry: choosing the fridge frames its door. Family moments and what's
    // coming up will live here; for now it says so gently.
    const { view, entries } = ctx
    const facing = new THREE.Vector3(Math.sin(group.rotation.y), 0, Math.cos(group.rotation.y))
    const centre = group.position.clone().setY(1.12)
    const pose = { position: centre.clone().addScaledVector(facing, 1.75).setY(1.22), look: centre }
    ctx.effect(() => entries.add({
      id: 'fridge',
      label: 'Fridge',
      object: group,
      select() {
        view.focus(pose)
        entries.say("Family moments and what's coming up will gather here soon")
      },
      leave: () => view.focus(null),
    }), 'fridge entry')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
