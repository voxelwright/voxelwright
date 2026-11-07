import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { TABLE_TOP, WALL_Z } from '../layout'
import { paintBraid, paintClockFace, paintFabric, paintRunner, paintWicker, paintWood } from '../paint'
import { NEAR_CHAIR } from '../villagers/world'
import { Kit, at, ball, basketPlant, box, contactDecals, cyl } from '../kit'

const LEFT = -3.31 // inner face of the left wall
const RIGHT = 3.4 // inner face of the right wall
const talk = new URLSearchParams(location.search).get('talk') === 'npc'

/**
 * Daily life in the kitchen (#42 room): a braided rug under the table, a runner
 * by the sink, a stove with a tea towel, an open shelf of jars and cookbooks over
 * a painted dresser, coat pegs and a bench by the doorway, a toy box, a reading
 * chair, plants in baskets, a wall clock that keeps the real time, fruit and
 * flowers on the table, and soft contact shadows under everything that stands on
 * the floor. Everything keeps clear of the villagers' corridors (villagers/world.ts).
 */
export default {
  name: 'furnish',
  inject: ['stage'],
  apply(ctx: Context) {
    const phys = ctx.stage.features().has('phys')
    const kit = new Kit(phys)
    // Things hung on the side walls go in their own kits, hidden with their wall when the
    // dollhouse camera stands outside it (camera.ts cuts away anything tagged inward).
    const leftWall = new Kit(phys), rightWall = new Kit(phys)
    let k = kit
    const part: Kit['part'] = (...a) => k.part(...a)
    const dress: Kit['dress'] = (...a) => k.dress(...a)
    const flat = new THREE.Group()
    flat.name = 'furnish flat'

    // Materials with painted maps.
    const pine = new THREE.MeshStandardMaterial({ map: paintWood({ seed: 13, w: 256, h: 256, planks: 1, light: [232, 190, 132], dark: [196, 150, 98], knots: 1 }), roughness: 0.62 })
    const sage = new THREE.MeshStandardMaterial({ map: paintWood({ seed: 17, w: 256, h: 256, planks: 2, light: [168, 184, 150], dark: [150, 166, 134], knots: 0 }), roughness: 0.66 })
    const wicker = new THREE.MeshStandardMaterial({ map: paintWicker(5), roughness: 0.9 })
    const towel = new THREE.MeshStandardMaterial({ map: paintFabric(8, [240, 232, 214], 'stripes', [184, 72, 58], 128), roughness: 0.95, side: THREE.DoubleSide })
    const velvet = new THREE.MeshStandardMaterial({ map: paintFabric(12, [196, 112, 80], 'velvet', [196, 112, 80], 256), roughness: 0.9 })
    const throwRug = new THREE.MeshStandardMaterial({ map: paintFabric(14, [232, 220, 196], 'check', [120, 140, 104], 128), roughness: 0.95 })

    // Floor textiles: thin enough (3 mm) that the villagers' contact shadows (4 mm) still sit on top.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: paintBraid(4), roughness: 1 }))
    rug.scale.set(1.78, 1, 1.28)
    rug.position.set(-0.22, 0.0025, 0.2)
    rug.receiveShadow = true
    rug.name = 'braided rug'
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: paintRunner(6), roughness: 1 }))
    runner.position.set(2.35, 0.0025, -1.3)
    runner.receiveShadow = true
    runner.name = 'sink runner'
    flat.add(rug, runner)

    // The stove along the right wall, its oven door facing the room, a striped towel on the bar.
    {
      const z0 = -1.5, z1 = -0.88, x0 = RIGHT - 0.62, H = 0.9, cz = (z0 + z1) / 2
      part(box(0.62, H, z1 - z0), '#efe5d2', 'gloss', at(x0 + 0.31, H / 2, cz))
      part(box(0.01, 0.4, 0.42), '#2c2622', 'gloss', at(x0 - 0.004, 0.42, cz)) // oven window
      part(box(0.012, 0.56, 0.54), '#e4d8c2', 'gloss', at(x0 - 0.002, 0.42, cz)) // door
      part(box(0.03, 0.08, 0.62), '#d7cbb4', 'satin', at(x0 + 0.03, H - 0.06, cz)) // control strip
      for (let i = 0; i < 4; i++) part(cyl(0.018, 0.018, 0.02, 12), '#3a302a', 'satin', at(x0 - 0.0, H - 0.06, z0 + 0.1 + i * 0.14, 0, 0, Math.PI / 2))
      part(cyl(0.008, 0.008, 0.52, 8), '#cfcac0', 'metal', at(x0 - 0.04, 0.72, cz, 0, Math.PI / 2))
      for (const z of [z0 + 0.04, z1 - 0.04]) part(box(0.04, 0.012, 0.012), '#cfcac0', 'metal', at(x0 - 0.02, 0.72, z))
      part(box(0.6, 0.012, z1 - z0 - 0.02), '#2b2724', 'satin', at(x0 + 0.31, H + 0.006, cz)) // hob
      for (const [dx, dz] of [[0.16, -0.14], [0.16, 0.14], [0.44, -0.14], [0.44, 0.14]]) part(new THREE.TorusGeometry(0.075, 0.008, 6, 20).rotateX(Math.PI / 2), '#4a4440', 'metal', at(x0 + dx, H + 0.014, cz + dz))
      // A red enamel kettle on the front ring, a pot behind.
      const kettle = new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.1, 0.05], [0.085, 0.13], [0.04, 0.17], [0.012, 0.19], [0, 0.2]].map(([x, y]) => new THREE.Vector2(x, y)), 20)
      part(kettle, '#c2463a', 'gloss', at(x0 + 0.16, H + 0.012, cz + 0.14))
      part(new THREE.TorusGeometry(0.06, 0.008, 6, 14, Math.PI), '#2b2724', 'satin', at(x0 + 0.16, H + 0.17, cz + 0.14, Math.PI / 2))
      part(cyl(0.012, 0.02, 0.1, 8), '#c2463a', 'gloss', at(x0 + 0.08, H + 0.1, cz + 0.14, 0, 0, 0.9))
      part(cyl(0.1, 0.095, 0.13, 20), '#9aa3a6', 'metal', at(x0 + 0.44, H + 0.08, cz - 0.14))
      part(cyl(0.104, 0.104, 0.012, 20), '#9aa3a6', 'metal', at(x0 + 0.44, H + 0.15, cz - 0.14))
      // Towel folded over the bar: two hanging leaves and the fold.
      dress(new THREE.PlaneGeometry(0.22, 0.32), towel, at(x0 - 0.052, 0.57, cz + 0.08, -Math.PI / 2))
      dress(new THREE.PlaneGeometry(0.22, 0.26), towel, at(x0 - 0.03, 0.6, cz + 0.08, -Math.PI / 2, 0, 0))
      dress(cyl(0.012, 0.012, 0.22, 10, ).rotateX(Math.PI / 2), towel, at(x0 - 0.041, 0.728, cz + 0.08))
      // A slim cupboard beside it with a utensil crock and a bread board.
      const c0 = z1 + 0.02, c1 = z1 + 0.5
      part(box(0.6, 0.88, c1 - c0), '#f1ece2', 'satin', at(RIGHT - 0.3, 0.44, (c0 + c1) / 2))
      part(box(0.012, 0.74, c1 - c0 - 0.06), '#e8e2d6', 'satin', at(RIGHT - 0.606, 0.42, (c0 + c1) / 2))
      part(ball(0.014, 10, 8), '#8f8a80', 'metal', at(RIGHT - 0.62, 0.7, c1 - 0.08))
      part(box(0.63, 0.04, c1 - c0 + 0.02), '#9a9a96', 'satin', at(RIGHT - 0.31, 0.9, (c0 + c1) / 2))
      part(cyl(0.06, 0.055, 0.14, 16), '#e8dcc6', 'gloss', at(RIGHT - 0.2, 0.99, c0 + 0.14))
      for (let i = 0; i < 4; i++) part(cyl(0.006, 0.006, 0.22, 6), i % 2 ? '#b8865a' : '#8a6a4a', 'satin', at(RIGHT - 0.2 + (i - 1.5) * 0.015, 1.08, c0 + 0.14 + (i % 2 - 0.5) * 0.02, 0, 0.1 * (i - 1.5), 0.12 * (i - 1.5)))
      dress(box(0.02, 0.36, 0.24), pine, at(RIGHT - 0.03, 1.09, c1 - 0.16, 0, 0, -0.12))
    }

    // Over the stove on the right wall: a brass rail with copper pans and utensils, and a framed print further along.
    k = rightWall
    {
      const y = 1.62, z0 = -1.6, z1 = -0.7
      part(cyl(0.01, 0.01, z1 - z0, 8).rotateX(Math.PI / 2), '#b08a5a', 'metal', at(RIGHT - 0.06, y, (z0 + z1) / 2))
      for (const z of [z0 + 0.03, z1 - 0.03]) part(box(0.06, 0.02, 0.02), '#b08a5a', 'metal', at(RIGHT - 0.03, y, z))
      const pans: Array<[number, number]> = [[z0 + 0.14, 0.11], [z0 + 0.42, 0.085], [z0 + 0.68, 0.07]]
      for (const [z, r] of pans) {
        part(cyl(r, r * 0.9, 0.012, 20).rotateZ(Math.PI / 2), '#b8693e', 'metal', at(RIGHT - 0.035, y - 0.18 - r, z))
        part(cyl(r * 0.94, r * 0.94, 0.04, 20).rotateZ(Math.PI / 2), '#c47a4a', 'metal', at(RIGHT - 0.06, y - 0.18 - r, z))
        part(box(0.012, 0.16, 0.02), '#2b2420', 'satin', at(RIGHT - 0.05, y - 0.09, z))
      }
      for (let i = 0; i < 3; i++) part(box(0.01, 0.24, 0.035), i === 1 ? '#c9a46a' : '#3a302a', 'satin', at(RIGHT - 0.04, y - 0.12, z1 - 0.1 - i * 0.07))
      // A framed botanical print further along the wall.
      part(box(0.03, 0.56, 0.44), '#8a5a3a', 'satin', at(RIGHT - 0.015, 1.72, 1.15))
      part(box(0.01, 0.48, 0.36), '#f3ead8', 'matte', at(RIGHT - 0.032, 1.72, 1.15))
      for (let i = 0; i < 5; i++) part(ball(0.05, 8, 6).scale(0.2, 1.4, 0.6), i % 2 ? '#6b8a3e' : '#86a347', 'matte', at(RIGHT - 0.04, 1.62 + i * 0.05, 1.15 + (i - 2) * 0.04, 0, 0, 0))
      part(box(0.012, 0.18, 0.04), '#c2714f', 'matte', at(RIGHT - 0.04, 1.84, 1.15))
    }
    k = kit

    // Painted dresser on the left wall, an open shelf of jars and cookbooks above it.
    {
      const z0 = 0.2, z1 = 1.6, d = 0.44, H = 0.84, cz = (z0 + z1) / 2, x = LEFT + d / 2
      dress(box(d, H - 0.04, z1 - z0), sage, at(x, (H - 0.04) / 2, cz))
      dress(box(d + 0.03, 0.04, z1 - z0 + 0.04), pine, at(x + 0.01, H - 0.02, cz))
      const doorW = (z1 - z0) / 2
      for (let i = 0; i < 2; i++) {
        const dz = z0 + doorW * (i + 0.5)
        dress(box(0.02, 0.5, doorW - 0.02), sage, at(LEFT + d + 0.01, 0.3, dz))
        part(ball(0.016, 10, 8), '#b08a5a', 'metal', at(LEFT + d + 0.03, 0.38, dz + (i ? -1 : 1) * (doorW / 2 - 0.07)))
        dress(box(0.02, 0.18, doorW - 0.02), sage, at(LEFT + d + 0.01, 0.68, dz))
        part(box(0.02, 0.02, 0.14), '#b08a5a', 'metal', at(LEFT + d + 0.025, 0.68, dz))
      }
      // On top: a stack of plates and a fruit crate of onions.
      for (let i = 0; i < 4; i++) part(cyl(0.12, 0.1, 0.018, 24), '#f2ece0', 'gloss', at(x + 0.02, H + 0.01 + i * 0.019, z0 + 0.3))
      dress(box(0.3, 0.14, 0.4), pine, at(x + 0.02, H + 0.07, z1 - 0.32))
      for (let i = 0; i < 6; i++) part(ball(0.04, 10, 8), i % 2 ? '#c99a5a' : '#b5763c', 'satin', at(x - 0.06 + (i % 2) * 0.1, H + 0.15, z1 - 0.46 + Math.floor(i / 2) * 0.1))
      // Two shelves on iron brackets.
      k = leftWall
      for (const y of [1.42, 1.82]) {
        dress(box(0.24, 0.028, 1.3), pine, at(LEFT + 0.12, y, cz))
        for (const bz of [z0 + 0.15, z1 - 0.15]) part(box(0.18, 0.018, 0.018), '#2b2420', 'satin', at(LEFT + 0.09, y - 0.08, bz, 0, 0, -0.75))
      }
      // Lower shelf: storage jars with what they keep showing through.
      const jars: Array<[string, number, number]> = [['#d98a3a', 0.22, 0.06], ['#f0e2c0', 0.26, 0.065], ['#5a3a24', 0.18, 0.055], ['#f6f2ea', 0.22, 0.06], ['#9a5a3a', 0.16, 0.05], ['#c8b46a', 0.2, 0.055]]
      let jz = z0 + 0.1
      for (const [fill, h, r] of jars) {
        jz += r
        // What a jar keeps shows through the glass: the fill up to its level, a pale glass shoulder above.
        part(cyl(r, r, h * 0.72, 16), fill, 'satin', at(LEFT + 0.12, 1.434 + h * 0.36, jz))
        part(cyl(r * 0.92, r, h * 0.28, 16), '#dfe6e2', 'gloss', at(LEFT + 0.12, 1.434 + h * 0.86, jz))
        part(cyl(r + 0.004, r + 0.004, 0.022, 16), '#7a5a3a', 'satin', at(LEFT + 0.12, 1.434 + h + 0.011, jz))
        jz += r + 0.03
      }
      // Upper shelf: cookbooks standing, two leaning, a small trailing plant.
      const spines = ['#7a3b2e', '#2f5446', '#c9a24a', '#e8dcc2', '#4b5d7a', '#a6553a', '#6a7d4a', '#3a2a24']
      let bz = z0 + 0.08
      spines.forEach((c, i) => {
        const t = 0.03 + (i % 3) * 0.012, h = 0.2 + ((i * 7) % 5) * 0.018
        part(box(0.17, h, t), c, 'satin', at(LEFT + 0.1, 1.834 + h / 2, bz + t / 2, 0, i === 7 ? 0 : 0, i >= 6 ? 0 : 0))
        bz += t + 0.004
      })
      part(box(0.17, 0.22, 0.035), '#d9c39a', 'satin', at(LEFT + 0.1, 1.834 + 0.105, bz + 0.05, 0, 0.32))
      part(cyl(0.05, 0.04, 0.09, 14), '#c2714f', 'satin', at(LEFT + 0.12, 1.88, z1 - 0.2))
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        part(ball(0.035, 8, 6), i % 2 ? '#5d8a3a' : '#79a34a', 'matte', at(LEFT + 0.12 + Math.cos(a) * 0.05, 1.93 - (i % 3) * 0.06, z1 - 0.2 + Math.sin(a) * 0.05, 0, 0, 0, [1, 0.6, 1]))
      }
      for (let i = 0; i < 4; i++) part(ball(0.026, 8, 6), '#6b9640', 'matte', at(LEFT + 0.2, 1.8 - i * 0.07, z1 - 0.16 + (i % 2) * 0.03, 0, 0, 0, [0.8, 1, 0.8]))
      k = kit
    }

    // Coat pegs by the doorway with a coat, a scarf and a tote; a bench with wellies under it.
    {
      const z0 = -1.95, z1 = -1.12, cz = (z0 + z1) / 2
      k = leftWall
      dress(box(0.03, 0.1, z1 - z0), pine, at(LEFT + 0.015, 1.64, cz))
      const pegs = [z0 + 0.1, z0 + 0.32, z0 + 0.52, z1 - 0.1]
      for (const z of pegs) part(cyl(0.012, 0.012, 0.08, 10), '#8a6a4a', 'satin', at(LEFT + 0.07, 1.64, z, 0, 0, Math.PI / 2 - 0.25))
      // A mustard coat: a tapered body with the shoulders hung on the first peg.
      part(new THREE.CylinderGeometry(0.14, 0.2, 0.78, 14, 1).scale(0.55, 1, 1), '#c8923a', 'matte', at(LEFT + 0.1, 1.22, pegs[0] + 0.02))
      part(ball(0.13, 12, 8).scale(0.6, 0.55, 1.1), '#c8923a', 'matte', at(LEFT + 0.1, 1.6, pegs[0] + 0.02))
      part(box(0.02, 0.5, 0.012), '#b07a2a', 'matte', at(LEFT + 0.18, 1.3, pegs[0] + 0.02))
      // A long red scarf.
      part(box(0.03, 0.62, 0.1), '#b8483a', 'matte', at(LEFT + 0.08, 1.33, pegs[2]))
      part(box(0.03, 0.5, 0.1), '#d8c8a8', 'matte', at(LEFT + 0.1, 1.38, pegs[2] + 0.06, 0, 0, 0.05))
      // A canvas tote.
      dress(box(0.08, 0.32, 0.28), throwRug, at(LEFT + 0.07, 1.36, pegs[3] - 0.05))
      part(new THREE.TorusGeometry(0.08, 0.008, 6, 14, Math.PI), '#8a6a4a', 'matte', at(LEFT + 0.07, 1.52, pegs[3] - 0.05, Math.PI / 2))
      k = kit
      // The bench.
      const bx = LEFT + 0.19
      dress(box(0.36, 0.04, z1 - z0 + 0.1), pine, at(bx, 0.44, cz))
      for (const z of [z0 + 0.02, z1 - 0.02]) dress(box(0.32, 0.42, 0.04), pine, at(bx, 0.21, z))
      dress(box(0.03, 0.06, z1 - z0 - 0.04), pine, at(bx + 0.14, 0.38, cz))
      // Yellow wellies and a small pair of red ones.
      for (const [z, c, s] of [[cz - 0.18, '#e6b832', 1], [cz - 0.08, '#e6b832', 1], [cz + 0.12, '#c8483a', 0.7], [cz + 0.2, '#c8483a', 0.7]] as const) {
        part(cyl(0.04 * s, 0.045 * s, 0.26 * s, 12), c, 'gloss', at(bx + 0.02, 0.13 * s, z))
        part(box(0.15 * s, 0.05 * s, 0.075 * s), c, 'gloss', at(bx + 0.06 * s + 0.02, 0.025 * s, z))
      }
    }

    // Toy box in the front-left corner, its lid ajar, blocks and a ball on the floor.
    {
      const x = -2.55, z = 3.2, ry = 0.15
      const base = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1))
      const local = (lx: number, ly: number, lz: number, rx = 0, rz = 0) => base.clone().multiply(at(lx, ly, lz, 0, rx, rz))
      part(box(0.72, 0.4, 0.42), '#8fb0b4', 'satin', local(0, 0.2, 0))
      part(box(0.74, 0.03, 0.08), '#e8dcc2', 'satin', local(0, 0.03, 0.18))
      part(box(0.74, 0.03, 0.44), '#a9c6c8', 'satin', local(0, 0.48, -0.2, -0.55))
      part(box(0.06, 0.07, 0.01), '#e8dcc2', 'satin', local(-0.25, 0.25, 0.215))
      part(box(0.06, 0.07, 0.01), '#e8dcc2', 'satin', local(0.25, 0.25, 0.215))
      // What peeks out: a rabbit's ears, a drum, a wooden boat.
      part(ball(0.08, 12, 8), '#e8d6c0', 'matte', local(-0.18, 0.42, 0.02))
      part(ball(0.025, 8, 6).scale(0.6, 2.2, 1), '#e8d6c0', 'matte', local(-0.21, 0.52, 0.02))
      part(ball(0.025, 8, 6).scale(0.6, 2.2, 1), '#e8d6c0', 'matte', local(-0.15, 0.52, 0.02))
      part(cyl(0.08, 0.08, 0.09, 16), '#c8483a', 'satin', local(0.12, 0.42, -0.02, 0.3))
      part(cyl(0.083, 0.083, 0.012, 16), '#f2ece0', 'satin', local(0.12, 0.465, -0.035, 0.3))
      const blocks: Array<[number, number, number, string]> = [[0.62, 0.05, 0.12, '#e6b832'], [0.7, 0.05, -0.05, '#5a8ab0'], [0.65, 0.15, 0.04, '#c8483a'], [0.48, 0.05, 0.3, '#79a34a']]
      for (const [bx2, by, bz2, c] of blocks) part(box(0.1, 0.1, 0.1), c, 'satin', local(bx2, by, bz2, 0, by > 0.1 ? 0.3 : 0))
      part(ball(0.09, 16, 12), '#d8503e', 'satin', at(-1.62, 0.09, 2.62))
      part(new THREE.TorusGeometry(0.09, 0.012, 6, 24).rotateX(Math.PI / 2), '#f2ece0', 'satin', at(-1.62, 0.09, 2.62, 0, 0.3))
    }

    // A reading chair on the open floor in front of the kitchen, turned to the table, with a throw, a side table and a lamp.
    {
      const x = 1.95, z = 2.0, ry = -2.3
      const base = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1))
      const local = (lx: number, ly: number, lz: number, rx = 0) => base.clone().multiply(at(lx, ly, lz, 0, rx))
      dress(box(0.8, 0.26, 0.78), velvet, local(0, 0.27, 0))
      dress(box(0.58, 0.12, 0.6), velvet, local(0, 0.46, 0.06))
      dress(box(0.8, 0.52, 0.18), velvet, local(0, 0.62, -0.31, -0.12))
      for (const s of [-1, 1]) dress(box(0.14, 0.22, 0.74), velvet, local(s * 0.33, 0.5, 0.02))
      for (const [lx, lz] of [[-0.34, -0.32], [0.34, -0.32], [-0.34, 0.32], [0.34, 0.32]]) dress(cyl(0.022, 0.016, 0.14, 8), pine, local(lx, 0.07, lz))
      dress(box(0.42, 0.02, 0.6), throwRug, local(0.36, 0.62, 0.02))
      dress(box(0.02, 0.3, 0.6), throwRug, local(0.42, 0.47, 0.02))
      // Side table with a book and a cup.
      const t = base.clone().multiply(at(0.62, 0, 0.05))
      const st = (lx: number, ly: number, lz: number) => t.clone().multiply(at(lx, ly, lz))
      dress(cyl(0.2, 0.2, 0.03, 24), pine, st(0, 0.55, 0))
      dress(cyl(0.025, 0.03, 0.54, 10), pine, st(0, 0.27, 0))
      dress(cyl(0.14, 0.16, 0.02, 20), pine, st(0, 0.01, 0))
      part(box(0.16, 0.035, 0.22), '#2f5446', 'satin', st(0.04, 0.585, 0.02))
      part(cyl(0.035, 0.03, 0.07, 14), '#e8dcc6', 'gloss', st(-0.1, 0.6, -0.06))
      // Floor lamp behind the chair, its linen shade lit from inside.
      const lamp = (lx: number, ly: number, lz: number) => base.clone().multiply(at(lx, ly, lz))
      part(cyl(0.012, 0.012, 1.4, 8), '#2b2420', 'satin', lamp(-0.58, 0.7, 0.1))
      part(cyl(0.13, 0.14, 0.02, 20), '#2b2420', 'satin', lamp(-0.58, 0.01, 0.1))
    }
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.19, 0.24, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#f6e6c8', emissive: '#ffc98a', emissiveIntensity: 0.55, roughness: 0.9, side: THREE.DoubleSide }),
    )
    {
      const p = new THREE.Vector3(-0.58, 1.46, 0.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -2.3).add(new THREE.Vector3(1.95, 0, 2.0))
      shade.position.copy(p)
      shade.castShadow = true
      shade.name = 'reading lamp shade'
    }

    // A tall plant in a woven basket by the dresser.
    basketPlant(kit, wicker, LEFT + 0.32, 2.05, 1.15, 0)

    // Fruit in a blue bowl and a jug of flowers on the table.
    {
      const bx = 0.36, bz = -0.06, y = TABLE_TOP
      const bowl = new THREE.LatheGeometry([[0, 0], [0.06, 0], [0.07, 0.01], [0.13, 0.05], [0.15, 0.085], [0.142, 0.088], [0.12, 0.055], [0.05, 0.02], [0, 0.02]].map(([u, v]) => new THREE.Vector2(u, v)), 28)
      part(bowl, '#4f7896', 'gloss', at(bx, y, bz))
      const fruit: Array<[number, number, number, number, string]> = [[-0.04, 0.07, -0.03, 0.042, '#e8892c'], [0.05, 0.07, 0.02, 0.042, '#e8892c'], [-0.01, 0.075, 0.06, 0.04, '#c0392b'], [0.02, 0.11, -0.01, 0.04, '#e8892c'], [0.07, 0.072, -0.06, 0.038, '#9bb04a']]
      for (const [fx, fy, fz, r, c] of fruit) part(ball(r, 14, 10), c, 'satin', at(bx + fx, y + fy, bz + fz))
      part(ball(0.035, 12, 8).scale(1.35, 1, 1), '#efd24a', 'satin', at(bx - 0.08, y + 0.1, bz + 0.03, 0.4))
      const jug = new THREE.LatheGeometry([[0, 0], [0.045, 0], [0.055, 0.04], [0.05, 0.1], [0.035, 0.14], [0.04, 0.16], [0.036, 0.162], [0, 0.12]].map(([u, v]) => new THREE.Vector2(u, v)), 20)
      const vx = -0.98, vz = -0.12
      part(jug, '#f2ece0', 'gloss', at(vx, y, vz))
      const blooms = ['#f29a7a', '#fff4dc', '#f4d36b', '#e7849c', '#fff4dc']
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3, tilt = 0.18 + (i % 2) * 0.12
        const stem = at(vx, y + 0.12, vz, a, tilt)
        part(cyl(0.003, 0.003, 0.16, 5).translate(0, 0.08, 0), '#5f7a3a', 'matte', stem)
        part(ball(0.026, 10, 6).scale(1, 0.6, 1), blooms[i], 'matte', stem.clone().multiply(at(0, 0.165, 0)))
        part(ball(0.03, 8, 6).scale(0.5, 0.2, 1.2), '#5f8a3a', 'matte', stem.clone().multiply(at(0.02, 0.07, 0, 0.5)))
      }
    }

    // A wall clock between the lamp arm and the fridge, keeping the real time.
    const clock = new THREE.Group()
    clock.name = 'wall clock'
    clock.position.set(1.25, 2.36, WALL_Z)
    // Its own meshes, not merged into the kit, so the whole clock leaves with the back wall when the dollhouse cuts it (#42).
    const rimMat = new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.45 })
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 10, 40), rimMat)
    rim.position.z = 0.03
    const body = new THREE.Mesh(cyl(0.15, 0.15, 0.03, 32).rotateX(Math.PI / 2), rimMat)
    body.position.z = 0.015
    clock.add(rim, body)
    clock.userData.inward = new THREE.Vector3(0, 0, 1)
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.142, 40), new THREE.MeshStandardMaterial({ map: paintClockFace(), roughness: 0.6 }))
    face.position.z = 0.032
    const handMat = new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.5 })
    const hour = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.003).translate(0, 0.03, 0), handMat)
    const minute = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.11, 0.003).translate(0, 0.045, 0), handMat)
    hour.position.z = 0.036
    minute.position.z = 0.04
    clock.add(face, hour, minute)
    let lastMinute = -1
    ctx.on('village/frame', () => {
      const now = new Date()
      const m = now.getMinutes()
      if (m === lastMinute) return
      lastMinute = m
      minute.rotation.z = -(m / 60) * Math.PI * 2
      hour.rotation.z = -(((now.getHours() % 12) + m / 60) / 12) * Math.PI * 2
    })

    // Contact shadows: one soft decal per footprint, merged into one draw. They hold at
    // ?q=low too, where sun shadows are coarser.
    const prints: Array<[number, number, number, number, number]> = [
      // x, z, width, depth, yaw
      [-0.25, 0.15, 1.9, 1.05, 0], // table
      [-0.7, -0.5, 0.62, 0.62, 0], [0.2, -0.5, 0.62, 0.62, 0], [1.05, -0.05, 0.62, 0.62, -Math.PI / 2 + 0.35], // chairs
      [-1.28, 0, 0.62, 0.62, Math.PI / 2 - 0.2], // high chair
      [1.5 - 0.04, WALL_Z + 0.36, 0.95, 0.9, -0.12], // fridge
      [2.69, WALL_Z + 0.3, 1.65, 0.85, 0], // base cabinets
      [RIGHT - 0.31, -0.6, 0.85, 1.35, 0], // stove and cupboard
      [0.78, WALL_Z + 0.32, 0.55, 0.55, 0], // big plant
      [LEFT + 0.22, 0.9, 0.62, 1.6, 0], // dresser
      [LEFT + 0.19, -1.53, 0.55, 1.05, 0], // bench
      [-2.55, 3.2, 0.95, 0.65, 0.15], // toy box
      [1.95, 2.0, 1.05, 1.0, -2.3], // reading chair
      [LEFT + 0.32, 2.05, 0.6, 0.6, 0], // basket
      [1.5, 2.43, 0.42, 0.42, 0], [2.26, 1.5, 0.32, 0.32, 0], // the reading chair's side table and lamp
    ]
    if (talk) prints.push([NEAR_CHAIR.x, NEAR_CHAIR.z, 0.62, 0.62, NEAR_CHAIR.yaw])
    flat.add(contactDecals(prints))

    const onWall = (wallKit: Kit, x: number, inward: THREE.Vector3, name: string) => {
      const hung = new THREE.Group()
      hung.name = name
      hung.position.x = x // the cutaway test reads this group's position as the wall's
      hung.userData.inward = inward
      const built = wallKit.build(name)
      built.position.x = -x
      hung.add(built)
      return hung
    }
    const all = [kit.build('furnish'), onWall(leftWall, LEFT, new THREE.Vector3(1, 0, 0), 'left wall things'), onWall(rightWall, RIGHT, new THREE.Vector3(-1, 0, 0), 'right wall things'), flat, clock, shade]
    // Small separate pieces would otherwise reach the GPU only when a camera first
    // turns to them, so a room walk could add memory the first visit never showed.
    for (const o of all) o.traverse((n) => (n.frustumCulled = false))
    for (const o of all) own(ctx, o)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
