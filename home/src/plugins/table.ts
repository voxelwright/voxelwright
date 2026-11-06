import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { TABLE_TOP } from '../layout'
import { paintPage, paintWood } from '../paint'

/** A page that curls up gently from the spine, like an open notebook resting flat. */
function pageGeometry(w: number, h: number, side: 1 | -1) {
  const g = new THREE.PlaneGeometry(w, h, 24, 2)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2 // 0 at spine edge for the right page
    const u = side === 1 ? x / w : 1 - x / w
    const lift = Math.sin(Math.min(u, 0.25) / 0.25 * Math.PI / 2) * 0.014 - u * 0.006 + (1 - Math.min(u * 6, 1)) * -0.008
    pos.setXYZ(i, pos.getX(i) + (side * w) / 2, pos.getY(i), lift)
  }
  g.computeVertexNormals()
  return g
}

export default {
  name: 'table',
  inject: ['stage'],
  apply(ctx: Context) {
    const group = new THREE.Group()
    group.name = 'table'
    group.position.set(-0.25, 0, 0.15)

    const top = TABLE_TOP
    const wood = new THREE.MeshStandardMaterial({
      map: paintWood({ seed: 7, planks: 4, light: [214, 160, 104], dark: [138, 86, 48], knots: 4 }),
      roughness: 0.48,
    })
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.055, 1.0), wood)
    slab.position.y = top - 0.0275
    slab.castShadow = slab.receiveShadow = true
    group.add(slab)

    const legMat = new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.6 })
    const legGeo = new THREE.CylinderGeometry(0.035, 0.026, top - 0.055, 12)
    for (const [x, z] of [[-0.8, -0.42], [0.8, -0.42], [-0.8, 0.42], [0.8, 0.42]]) {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(x, (top - 0.055) / 2, z)
      leg.castShadow = true
      group.add(leg)
    }
    const apron = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 0.86), legMat)
    apron.position.y = top - 0.095
    apron.castShadow = true
    group.add(apron)

    // Open notebook: linen cover, two curled pages, the start of a note.
    const book = new THREE.Group()
    book.name = 'notebook'
    book.position.set(0.05, top + 0.002, 0.12)
    book.rotation.y = -0.08
    book.scale.setScalar(1.3)
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.006, 0.42),
      new THREE.MeshStandardMaterial({ color: '#7a3b2e', roughness: 0.85 }),
    )
    cover.position.y = 0.003
    cover.castShadow = cover.receiveShadow = true
    book.add(cover)
    const pages = [
      paintPage(101, ['Thursday', 'Good morning.', 'The bread is rising,', 'tea is on the stove.'], false),
      paintPage(102, ['What shall we', 'do this weekend?'], true),
    ]
    ;([-1, 1] as const).forEach((side, i) => {
      const page = new THREE.Mesh(
        pageGeometry(0.29, 0.4, side),
        new THREE.MeshStandardMaterial({ map: pages[i], roughness: 0.92 }),
      )
      page.name = side === 1 ? 'notebook right page' : 'notebook left page'
      page.rotation.x = -Math.PI / 2
      page.position.y = 0.008
      page.castShadow = page.receiveShadow = true
      book.add(page)
    })
    group.add(book)

    // Yellow hexagonal pencil resting across the right page.
    const pencil = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.17, 6),
      new THREE.MeshStandardMaterial({ color: '#f2b631', roughness: 0.45 }),
    )
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.0045, 0.022, 6),
      new THREE.MeshStandardMaterial({ color: '#e7c79a', roughness: 0.8 }),
    )
    tip.position.y = 0.096
    const lead = new THREE.Mesh(new THREE.ConeGeometry(0.0013, 0.006, 6), new THREE.MeshStandardMaterial({ color: '#333', roughness: 0.4 }))
    lead.position.y = 0.106
    const ferrule = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0048, 0.0048, 0.012, 12),
      new THREE.MeshStandardMaterial({ color: '#c9c3b5', metalness: 0.9, roughness: 0.3 }),
    )
    ferrule.position.y = -0.091
    const eraser = new THREE.Mesh(new THREE.CylinderGeometry(0.0046, 0.0046, 0.01, 12), new THREE.MeshStandardMaterial({ color: '#e58a8a', roughness: 0.9 }))
    eraser.position.y = -0.102
    pencil.add(body, tip, lead, ferrule, eraser)
    pencil.traverse((o) => (o.castShadow = true))
    pencil.rotation.set(Math.PI / 2, 0, -1.05)
    pencil.position.set(0.3, top + 0.038, 0.18)
    pencil.scale.setScalar(1.3)
    group.add(pencil)

    // A warm mug of tea, steam rising.
    const mugMat = new THREE.MeshStandardMaterial({ color: '#e9dcc4', roughness: 0.35 })
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 28, 1, true), mugMat)
    mug.material.side = THREE.DoubleSide
    mug.position.set(-0.52, top + 0.05, 0.02)
    mug.castShadow = true
    const tea = new THREE.Mesh(new THREE.CircleGeometry(0.042, 28), new THREE.MeshStandardMaterial({ color: '#6b3a1c', roughness: 0.15 }))
    tea.rotation.x = -Math.PI / 2
    tea.position.set(mug.position.x, top + 0.085, mug.position.z)
    const base = new THREE.Mesh(new THREE.CircleGeometry(0.04, 28), mugMat)
    base.rotation.x = -Math.PI / 2
    base.position.set(mug.position.x, top + 0.002, mug.position.z)
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, 8, 20, Math.PI * 1.2), mugMat)
    handle.position.set(mug.position.x + 0.045, top + 0.05, mug.position.z)
    handle.rotation.z = -Math.PI * 0.6
    handle.castShadow = true
    group.add(mug, tea, base, handle)

    const steamGeo = new THREE.SphereGeometry(0.02, 10, 8)
    const puffs = Array.from({ length: 10 }, (_, i) => {
      const p = new THREE.Mesh(steamGeo, new THREE.MeshBasicMaterial({ color: '#fff3e0', transparent: true, opacity: 0, depthWrite: false }))
      p.userData.phase = i / 10
      group.add(p)
      return p
    })
    ctx.on('village/frame', (_dt, t) => {
      for (const p of puffs) {
        const k = (t * 0.18 + p.userData.phase) % 1
        p.position.set(mug.position.x + Math.sin(k * 5 + t * 0.7 + p.userData.phase * 9) * 0.05 * k, top + 0.1 + k * 0.22, mug.position.z + Math.cos(k * 5) * 0.01)
        p.scale.setScalar(0.8 + k * 2.6)
        ;(p.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * (1 - k) * 0.035
      }
    })

    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
