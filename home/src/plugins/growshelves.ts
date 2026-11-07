import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { LIVING_X } from '../layout'
import { canvas, paintWood, rng, toTexture } from '../paint'
import { Foliage, paintCeramic, pot, pothos } from '../greenery'
import { LOUNGE } from './lounge'

/** A soft warm pool of light on the wall under a grow-light strip. */
function paintGlow(): THREE.Texture {
  const [c, g] = canvas(256, 128)
  const grad = g.createRadialGradient(128, 0, 4, 128, 0, 128)
  grad.addColorStop(0, 'rgba(255, 226, 170, 0.9)')
  grad.addColorStop(0.5, 'rgba(255, 210, 150, 0.32)')
  grad.addColorStop(1, 'rgba(255, 200, 140, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 128)
  return toTexture(c)
}

/**
 * Walnut floating shelves with warm grow-light strips beneath, carrying
 * pothos and potted plants in white textured pots. The future idea garden for
 * Plant a Seed, and an entry: for now choosing it frames the shelves and says
 * what will grow here.
 */
export default {
  name: 'growshelves',
  inject: ['stage', 'view', 'entries'],
  apply(ctx: Context) {
    const low = ctx.stage.quality === 'low'
    const group = new THREE.Group()
    group.name = 'grow shelves'
    group.position.set(LIVING_X, 0, LOUNGE.back)

    const walnut = new THREE.MeshStandardMaterial({
      map: paintWood({ seed: 31, w: 512, h: 256, planks: 1, light: [128, 92, 64], dark: [86, 58, 40], knots: 1 }),
      roughness: 0.5,
    })
    const strip = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffe2ae', emissiveIntensity: 1.4 })
    const glowTex = paintGlow()
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.2 })
    const ceramic = ctx.stage.features().has('phys')
      ? new THREE.MeshPhysicalMaterial({ map: paintCeramic(5), roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.1 })
      : new THREE.MeshStandardMaterial({ map: paintCeramic(5), roughness: 0.35 })
    const stemMat = new THREE.MeshStandardMaterial({ color: '#5d7f33', roughness: 0.7 })
    const leaves = new Foliage('heart')
    const broad = new Foliage('oval')
    const r = rng(12)

    const shelves: [number, number, number][] = [
      // x centre, height, length
      [-0.72, 1.32, 0.95],
      [-0.72, 1.9, 0.95],
      [0.95, 1.62, 1.1],
      [0.95, 2.22, 1.1],
    ]
    const tops: THREE.Vector3[] = []
    for (const [x, y, len] of shelves) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(len, 0.045, 0.24), walnut)
      board.position.set(x, y, 0.12)
      board.castShadow = board.receiveShadow = true
      const light = new THREE.Mesh(new THREE.BoxGeometry(len * 0.88, 0.012, 0.02), strip)
      light.position.set(x, y - 0.03, 0.17)
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(len * 1.25, 0.6), glowMat)
      pool.position.set(x, y - 0.33, 0.004)
      group.add(board, light, pool)
      tops.push(new THREE.Vector3(x, y + 0.0225, 0.12))
    }

    // Pots along each shelf: pothos trails from the lower ones, bushier plants above.
    const stems: THREE.Mesh[] = []
    const place = (shelf: number, dx: number, radius: number, height: number, kind: 'pothos' | 'golden' | 'bush') => {
      const p = pot(radius, height, ceramic)
      const at = tops[shelf].clone().add(new THREE.Vector3(dx, 0, 0))
      p.position.copy(at)
      group.add(p)
      const top = at.clone().add(new THREE.Vector3(0, height, 0))
      if (kind === 'bush') {
        for (let i = 0; i < 44; i++) {
          const a = r() * Math.PI * 2
          const dir = new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5)
          broad.add(top.clone().add(new THREE.Vector3(Math.cos(a) * 0.02, 0.02 + r() * 0.16, Math.sin(a) * 0.02)), dir, 0.09 + r() * 0.05, ['#6f9a3d', '#7faa45', '#8fb84d'][i % 3], r() * 3)
        }
      } else stems.push(...pothos(leaves, top, radius, 40 + shelf * 7 + Math.round(dx * 10), low ? 2 : kind === 'golden' ? 4 : 3, stemMat, kind === 'golden'))
    }
    // Layered: pots overlap along each shelf and vines from the upper shelves fall past the lower ones.
    place(0, -0.3, 0.085, 0.15, 'bush')
    place(0, 0.05, 0.09, 0.15, 'golden')
    place(0, 0.34, 0.06, 0.1, 'pothos')
    place(1, 0.38, 0.06, 0.1, 'golden')
    place(2, -0.32, 0.08, 0.13, 'pothos')
    place(2, 0.05, 0.07, 0.12, 'golden')
    place(2, 0.36, 0.065, 0.1, 'bush')
    place(3, 0.38, 0.055, 0.09, 'pothos')
    // The top shelves hold a candle, a little stack of books and a ceramic bud vase.
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 20), new THREE.MeshStandardMaterial({ color: '#2a201c', roughness: 0.3 }))
    candle.position.copy(tops[1]).add(new THREE.Vector3(-0.36, 0.05, 0))
    const vase = pot(0.035, 0.12, ceramic)
    vase.position.copy(tops[3]).add(new THREE.Vector3(0.05, 0, 0))
    const books = new THREE.Group()
    for (const [i, colour] of ['#a5483a', '#e2c79a', '#4f6b5a'].entries()) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.15), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8 }))
      b.position.y = 0.015 + i * 0.03
      b.rotation.y = (r() - 0.5) * 0.2
      books.add(b)
    }
    books.position.copy(tops[1]).add(new THREE.Vector3(0.0, 0, 0))
    const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), new THREE.MeshStandardMaterial({ color: '#c8682e', roughness: 0.7 }))
    pumpkin.scale.y = 0.7
    pumpkin.position.copy(tops[3]).add(new THREE.Vector3(-0.32, 0.04, 0))
    for (const m of [candle, pumpkin]) m.castShadow = true
    group.add(candle, vase, books, pumpkin, leaves.build('pothos leaves'), broad.build('shelf plant leaves'), ...stems)

    // The strips' light on the plants below is painted (the pools above) and the living room's lamp-light:
    // with the whole house drawn, each point light costs every pixel (#42).
    own(ctx, group)

    const { view, entries } = ctx
    const pose = {
      position: new THREE.Vector3(LIVING_X + 0.15, 1.65, LOUNGE.back + 2.3),
      look: new THREE.Vector3(LIVING_X + 0.15, 1.6, LOUNGE.back),
    }
    ctx.effect(() => entries.add({
      id: 'idea-garden',
      label: 'Idea garden',
      object: group,
      select() {
        view.focus(pose)
        entries.say('The idea garden. Seeds you plant will grow here soon')
      },
      leave: () => view.focus(null),
    }), 'idea garden entry')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
