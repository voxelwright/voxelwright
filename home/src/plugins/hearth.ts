import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z } from '../layout'
import { paintFlame, paintWood, rng } from '../paint'

/** A small cast-iron wood stove with a soft fire, a kettle and a few logs. */
export default {
  name: 'hearth',
  inject: ['stage'],
  apply(ctx: Context) {
    const low = ctx.stage.quality === 'low'
    const group = new THREE.Group()
    group.name = 'hearth'
    group.position.set(-1.95, 0, WALL_Z + 0.42)
    group.rotation.y = 0.25

    const iron = new THREE.MeshStandardMaterial({ color: '#2e2925', roughness: 0.62, metalness: 0.55 })
    const W = 0.52, H = 0.5, D = 0.42, legs = 0.16
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.03), iron)
    body.position.y = legs + H / 2
    body.castShadow = body.receiveShadow = true
    group.add(body)
    const top = new THREE.Mesh(new RoundedBoxGeometry(W + 0.06, 0.035, D + 0.06, 3, 0.012), iron)
    top.position.y = legs + H + 0.015
    top.castShadow = true
    group.add(top)
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, legs, 8), iron)
      leg.position.set(x * (W / 2 - 0.05), legs / 2, z * (D / 2 - 0.05))
      group.add(leg)
    }

    // Door: a brass-edged frame around glass with the fire behind it.
    const front = D / 2
    const doorW = 0.3, doorH = 0.24, doorY = legs + H * 0.5
    const brass = new THREE.MeshStandardMaterial({ color: '#b88a4a', roughness: 0.35, metalness: 0.9 })
    const frameBar = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.018), iron)
      m.position.set(x, y, front + 0.009)
      group.add(m)
    }
    frameBar(doorW + 0.05, 0.03, 0, doorY + doorH / 2 + 0.01)
    frameBar(doorW + 0.05, 0.03, 0, doorY - doorH / 2 - 0.01)
    frameBar(0.03, doorH, -doorW / 2 - 0.01, doorY)
    frameBar(0.03, doorH, doorW / 2 + 0.01, doorY)
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), brass)
    knob.position.set(doorW / 2 + 0.035, doorY, front + 0.02)
    group.add(knob)

    // Fire: an ember bed and flame cards, all additive so bloom picks them up.
    const ember = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW, doorH),
      new THREE.MeshBasicMaterial({ color: '#4a1606', fog: false }),
    )
    ember.position.set(0, doorY, front + 0.002)
    group.add(ember)
    const flameTex = paintFlame(21)
    const flames = Array.from({ length: low ? 3 : 5 }, (_, i) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.11, 0.2),
        new THREE.MeshBasicMaterial({ map: flameTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(1.6, 1.25, 1.0) }),
      )
      m.userData.x = -doorW / 2 + 0.05 + (i / ((low ? 3 : 5) - 1)) * (doorW - 0.1)
      m.userData.phase = i * 1.7
      m.position.set(m.userData.x, doorY - 0.02, front + 0.004 + i * 0.0005)
      group.add(m)
      return m
    })
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW, doorH),
      new THREE.MeshPhysicalMaterial({ color: '#201410', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, clearcoat: 1 }),
    )
    glass.position.set(0, doorY, front + 0.007)
    group.add(glass)

    // Flue: up, then an elbow back into the wall.
    const pipeMat = new THREE.MeshStandardMaterial({ color: '#2a2522', roughness: 0.5, metalness: 0.6 })
    const pipeR = 0.055
    const up = 1.3 - (legs + H)
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(pipeR, pipeR, up, 16), pipeMat)
    pipe.position.set(0, legs + H + up / 2, -0.06)
    pipe.castShadow = true
    group.add(pipe)
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(pipeR + 0.012, pipeR + 0.012, 0.03, 16), brass)
    collar.position.set(0, legs + H + 0.05, -0.06)
    group.add(collar)
    const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.08, pipeR, 10, 16, Math.PI / 2), pipeMat)
    elbow.rotation.y = Math.PI / 2
    elbow.position.set(0, 1.3, -0.14)
    group.add(elbow)
    const into = new THREE.Mesh(new THREE.CylinderGeometry(pipeR, pipeR, 0.5, 16), pipeMat)
    into.rotation.x = Math.PI / 2
    into.position.set(0, 1.38, -0.39)
    group.add(into)

    // Kettle on the hot plate.
    const enamel = new THREE.MeshPhysicalMaterial({ color: '#b5463a', roughness: 0.3, clearcoat: 0.8 })
    const kettle = new THREE.Group()
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), enamel)
    pot.scale.set(1, 0.72, 1)
    pot.castShadow = true
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), new THREE.MeshStandardMaterial({ color: '#2a2522' }))
    lid.position.y = 0.068
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.018, 0.1, 10), enamel)
    spout.position.set(0.09, 0.02, 0)
    spout.rotation.z = -0.9
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.007, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: '#2a2522', roughness: 0.6 }))
    handle.position.y = 0.05
    kettle.add(pot, lid, spout, handle)
    kettle.position.set(0.1, legs + H + 0.095, 0.05)
    group.add(kettle)

    // A few split logs leaning by the stove.
    const logMat = new THREE.MeshStandardMaterial({ map: paintWood({ seed: 31, planks: 1, light: [150, 108, 72], dark: [92, 62, 40], knots: 2, w: 256, h: 256 }), roughness: 0.85 })
    const r = rng(9)
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 7), logMat)
      log.rotation.set(Math.PI / 2, 0, (r() - 0.5) * 0.4)
      log.position.set(-W / 2 - 0.12 - (i % 2) * 0.1, 0.05 + Math.floor(i / 2) * 0.085, 0.02 + (r() - 0.5) * 0.05)
      log.castShadow = log.receiveShadow = true
      group.add(log)
    }

    own(ctx, group)

    const glow = new THREE.PointLight('#ff8a3c', 3, 4.5, 1.5)
    glow.name = 'hearth glow'
    glow.position.set(0, doorY, front + 0.25)
    group.add(glow)

    ctx.on('village/frame', (_dt, t) => {
      const flicker = Math.sin(t * 7.1) * 0.25 + Math.sin(t * 13.3 + 1) * 0.18 + Math.sin(t * 2.3) * 0.3
      glow.intensity = 3 + flicker
      for (const f of flames) {
        const p = f.userData.phase
        f.scale.set(0.85 + Math.sin(t * 5.3 + p) * 0.12, 0.8 + Math.sin(t * 8.1 + p * 2) * 0.22 + Math.sin(t * 3.1 + p) * 0.1, 1)
        f.position.x = f.userData.x + Math.sin(t * 4.3 + p) * 0.008
      }
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
