import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { LIVING_X } from '../layout'
import { paintBraid, paintFabric, paintWicker, paintWood } from '../paint'
import { Kit, at, ball, basketPlant, box, contactDecals, cyl } from '../kit'
import { LOUNGE } from './lounge'

/**
 * The living room lived in (#42 room): a sage sofa along the left wall with
 * cushions and a throw, a round rug and a coffee table with books, a bookcase,
 * a floor lamp, a reading chair turned to the sofa, a blanket basket and a plant.
 * Everything stands left of the seated view's line to the plant corner, so the
 * seated living room looks as before.
 */
export default {
  name: 'loungefurnish',
  inject: ['stage'],
  apply(ctx: Context) {
    const X = LIVING_X
    const L = X + LOUNGE.left // inner face of the left wall
    const kit = new Kit(ctx.stage.features().has('phys'))
    const { part, dress } = { part: kit.part.bind(kit), dress: kit.dress.bind(kit) }
    const flat = new THREE.Group()
    flat.name = 'lounge furnish flat'

    const pine = new THREE.MeshStandardMaterial({ map: paintWood({ seed: 52, w: 256, h: 128, planks: 1, light: [214, 178, 134], dark: [190, 152, 110], knots: 1 }), roughness: 0.62 })
    const sofaCloth = new THREE.MeshStandardMaterial({ map: paintFabric(21, [146, 160, 124], 'plain', [146, 160, 124], 256), roughness: 0.92 })
    const chairCloth = new THREE.MeshStandardMaterial({ map: paintFabric(22, [222, 206, 176], 'check', [196, 132, 96], 128), roughness: 0.92 })
    const throwCloth = new THREE.MeshStandardMaterial({ map: paintFabric(23, [236, 226, 204], 'stripes', [190, 112, 80], 128), roughness: 0.95 })
    const wicker = new THREE.MeshStandardMaterial({ map: paintWicker(9), roughness: 0.9 })

    // Round rug in front of the sofa: the kitchen's braid in the same rag colours.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: paintBraid(9), roughness: 1 }))
    rug.scale.set(1.1, 1, 0.95)
    rug.position.set(X - 1.6, 0.0025, 0.95)
    rug.receiveShadow = true
    rug.name = 'lounge rug'
    flat.add(rug)

    // The sofa, facing into the room.
    {
      const z0 = -0.1, z1 = 1.95, cz = (z0 + z1) / 2, len = z1 - z0, sx = L + 0.43
      dress(box(0.84, 0.28, len), sofaCloth, at(sx, 0.26, cz))
      for (const s of [-1, 1]) dress(box(0.62, 0.13, len / 2 - 0.2), sofaCloth, at(sx + 0.08, 0.465, cz + s * (len / 4 - 0.07)))
      dress(box(0.2, 0.5, len - 0.3), sofaCloth, at(L + 0.11, 0.62, cz, 0, 0, 0.1))
      for (const z of [z0 + 0.1, z1 - 0.1]) dress(box(0.84, 0.36, 0.18), sofaCloth, at(sx, 0.5, z))
      for (const [dx, dz] of [[-0.36, z0 + 0.05], [0.36, z0 + 0.05], [-0.36, z1 - 0.05], [0.36, z1 - 0.05]]) dress(cyl(0.025, 0.018, 0.12, 8), pine, at(sx + dx, 0.06, dz))
      // Cushions, leaning back.
      for (const [z, c] of [[z0 + 0.42, '#c2714f'], [z0 + 0.78, '#e6b85a'], [z1 - 0.4, '#efe4cc']] as const) part(ball(1, 16, 12).scale(0.07, 0.17, 0.18), c, 'matte', at(L + 0.3, 0.68, z, 0, 0, -0.35))
      // A striped throw over the far arm.
      dress(box(0.5, 0.02, 0.32), throwCloth, at(sx + 0.05, 0.69, z1 - 0.12))
      dress(box(0.02, 0.32, 0.32), throwCloth, at(sx + 0.3, 0.53, z1 - 0.12))
    }

    // Coffee table on the rug with books, a candle and a bowl of clementines.
    {
      const cx = X - 1.55, cz = 0.95
      dress(cyl(0.46, 0.46, 0.04, 32).scale(1, 1, 0.75), pine, at(cx, 0.42, cz))
      for (const [dx, dz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) dress(cyl(0.022, 0.016, 0.4, 8), pine, at(cx + dx, 0.2, cz + dz))
      dress(cyl(0.4, 0.4, 0.02, 28).scale(1, 1, 0.72), pine, at(cx, 0.12, cz))
      const books: Array<[number, string]> = [[0.04, '#2f5446'], [0.035, '#c9a24a'], [0.03, '#7a3b2e']]
      let y = 0.44
      books.forEach(([h, c], i) => {
        part(box(0.28 - i * 0.03, h, 0.2 - i * 0.02), c, 'satin', at(cx - 0.18, y + h / 2, cz + 0.05, 0.15 * i - 0.1))
        y += h
      })
      part(cyl(0.035, 0.035, 0.09, 14), '#f4ecd8', 'satin', at(cx - 0.18, y + 0.045, cz + 0.05))
      part(cyl(0.11, 0.07, 0.06, 20), '#4f7896', 'gloss', at(cx + 0.18, 0.47, cz - 0.04))
      for (let i = 0; i < 4; i++) part(ball(0.035, 12, 8), '#e8892c', 'satin', at(cx + 0.15 + (i % 2) * 0.06, 0.51 + (i > 1 ? 0.03 : 0), cz - 0.07 + Math.floor(i / 2) * 0.06))
    }

    // A tall bookcase on the left wall near the door.
    {
      const z0 = -1.75, z1 = -0.85, cz = (z0 + z1) / 2, d = 0.32, H = 1.8, bx = L + d / 2
      for (const z of [z0, z1]) dress(box(d, H, 0.03), pine, at(bx, H / 2, z))
      dress(box(0.015, H, z1 - z0), pine, at(L + 0.008, H / 2, cz))
      const shelves = [0.06, 0.48, 0.9, 1.32, 1.78]
      for (const y of shelves) dress(box(d, 0.025, z1 - z0), pine, at(bx, y, cz))
      const spines = ['#7a3b2e', '#2f5446', '#c9a24a', '#e8dcc2', '#4b5d7a', '#a6553a', '#6a7d4a', '#3a2a24', '#d9c39a', '#8a5a7a']
      shelves.slice(0, 4).forEach((y0, row) => {
        let z = z0 + 0.04
        let k = row * 3
        while (z < z1 - 0.12) {
          const t = 0.03 + (k % 3) * 0.01, h = 0.24 + ((k * 7) % 5) * 0.025
          if (row === 2 && z > cz) {
            // A gap with a little vase and a framed photo.
            part(cyl(0.04, 0.05, 0.16, 14), '#c2714f', 'gloss', at(bx, y0 + 0.095, z1 - 0.15))
            break
          }
          part(box(0.22, h, t), spines[k % spines.length], 'satin', at(bx + 0.02, y0 + 0.0125 + h / 2, z + t / 2))
          z += t + 0.003
          k++
        }
      })
    }

    // Floor lamp at the sofa's end, its shade glowing.
    part(cyl(0.012, 0.012, 1.45, 8), '#2b2420', 'satin', at(L + 0.3, 0.73, -0.45))
    part(cyl(0.14, 0.15, 0.02, 20), '#2b2420', 'satin', at(L + 0.3, 0.01, -0.45))
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, 0.26, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#f6e6c8', emissive: '#ffc98a', emissiveIntensity: 0.7, roughness: 0.9, side: THREE.DoubleSide }),
    )
    shade.position.set(L + 0.3, 1.5, -0.45)
    shade.castShadow = true
    shade.name = 'lounge lamp shade'

    // A reading chair turned to the coffee table, beside where the seated view stands.
    {
      const base = new THREE.Matrix4().compose(new THREE.Vector3(X - 0.55, 0, 2.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -2.3), new THREE.Vector3(1, 1, 1))
      const local = (lx: number, ly: number, lz: number, rx = 0) => base.clone().multiply(at(lx, ly, lz, 0, rx))
      dress(box(0.78, 0.26, 0.76), chairCloth, local(0, 0.27, 0))
      dress(box(0.56, 0.12, 0.58), chairCloth, local(0, 0.46, 0.06))
      dress(box(0.78, 0.5, 0.18), chairCloth, local(0, 0.62, -0.3, -0.12))
      for (const s of [-1, 1]) dress(box(0.13, 0.22, 0.72), chairCloth, local(s * 0.33, 0.5, 0.02))
      for (const [lx, lz] of [[-0.33, -0.31], [0.33, -0.31], [-0.33, 0.31], [0.33, 0.31]]) dress(cyl(0.022, 0.016, 0.14, 8), pine, local(lx, 0.07, lz))
    }

    // A basket of blankets beside the sofa (the doorway to the kitchen is just past it), and a plant in the front corner.
    dress(cyl(0.24, 0.2, 0.4, 24), wicker, at(L + 0.32, 0.2, 2.18))
    part(ball(0.2, 14, 8).scale(1, 0.45, 1), '#c2714f', 'matte', at(L + 0.32, 0.4, 2.15))
    part(ball(0.18, 14, 8).scale(1, 0.4, 1), '#efe4cc', 'matte', at(L + 0.36, 0.46, 2.23))
    basketPlant(kit, wicker, X + 1.22, 3.42, 1.1, 2.1)
    // A knitted pouf and a stack of board games behind the seated view, so the front of the room is not bare.
    part(cyl(0.26, 0.26, 0.3, 24), '#d8a85a', 'matte', at(X + 0.55, 0.15, 2.8))
    part(new THREE.TorusGeometry(0.24, 0.04, 8, 24).rotateX(Math.PI / 2), '#c8984a', 'matte', at(X + 0.55, 0.3, 2.8))
    for (const [i, c] of ['#4b5d7a', '#c2463a', '#e8dcc2'].entries()) part(box(0.4 - i * 0.04, 0.06, 0.28), c, 'satin', at(X + 0.1, 0.03 + i * 0.06, 3.35, 0.2 * i))

    flat.add(contactDecals([
      [L + 0.43, 0.92, 1.05, 2.25, 0], // sofa
      [X - 1.55, 0.95, 1.1, 0.85, 0], // coffee table
      [L + 0.16, -1.3, 0.5, 1.1, 0], // bookcase
      [X - 0.55, 2.2, 1.0, 1.0, -2.3], // reading chair
      [L + 0.32, 2.18, 0.6, 0.6, 0], [X + 1.22, 3.42, 0.55, 0.55, 0], [L + 0.3, -0.45, 0.4, 0.4, 0], [X + 0.55, 2.8, 0.65, 0.65, 0], [X + 0.1, 3.35, 0.55, 0.42, 0.2],
      [X + 0.3, LOUNGE.back + 0.22, 0.95, 0.55, 0], // the lounge's bench
      [L + 0.3, -0.45, 0.34, 0.34, 0], // floor lamp
      [X - 0.78, LOUNGE.back + 0.245, 1.65, 0.62, 0], [X + 1.09, LOUNGE.back + 0.47, 0.72, 0.72, 0], // the sideboard and the plant stand (their own plugins)
    ]))

    const all = [kit.build('lounge furnish'), flat, shade]
    for (const o of all) o.traverse((n) => (n.frustumCulled = false))
    for (const o of all) own(ctx, o)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
