// The street's trees as the page draws them (#136). The world holds a tree as a post and four
// balls; what is seen is a trunk that forks into boughs and a crown of a few hundred sprigs of
// leaves, each a small card, lit as one round mass, stirred by the wind and letting the sun
// through in patches onto the pavement.
import * as THREE from 'three/webgpu'
import { cameraPosition, dot, float, mix, normalLocal, positionLocal, positionWorld, sin, smoothstep, step, texture, time, transformNormalToView, uv, vec3, vertexColor } from 'three/tsl'
import { SUN } from '../../src/sun.ts'
import { GRADE } from '../../src/ground.ts'
import { Mesher, rgb, type P3 } from './mesher.ts'
import { made, type Surface } from './surfaces.ts'

/** A repeatable stream of numbers from 0 to 1. */
function stream(seed: number) {
  let s = (seed * 2654435761) >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** A sprig: a twig with leaves either side of it, painted once. Its light and dark are the leaves' own; its tint comes from the tree. */
function sprig(): THREE.CanvasTexture {
  const size = 256, canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const next = stream(7)
  const leaf = (x: number, y: number, turn: number, long: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(turn)
    const shade = 150 + Math.floor(next() * 90)
    g.fillStyle = `rgb(${shade},${shade},${shade})`
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(long * 0.3, -long * 0.34, long * 0.75, -long * 0.3, long, 0)
    g.bezierCurveTo(long * 0.75, long * 0.3, long * 0.3, long * 0.34, 0, 0)
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,0.55)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(long * 0.92, 0)
    g.stroke()
    g.restore()
  }
  // Three twigs from the middle of the foot, leaves in pairs along each.
  for (const [turn, reach] of [[-Math.PI / 2, 190], [-Math.PI / 2 - 0.75, 150], [-Math.PI / 2 + 0.75, 150]] as const) {
    for (let i = 1; i <= 6; i++) {
      const along = (i / 6.5) * reach, x = 128 + Math.cos(turn) * along, y = 236 + Math.sin(turn) * along
      for (const side of [-1, 1]) leaf(x, y, turn + side * (0.75 + next() * 0.4), 52 + next() * 26)
    }
    leaf(128 + Math.cos(turn) * reach * 0.93, 236 + Math.sin(turn) * reach * 0.93, turn, 60)
  }
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.anisotropy = 4
  return t
}

/** A tree as the world has it: where it stands, how tall and thick its trunk is, and the balls of its crown (each a middle, from the tree's foot, and a size). */
export interface Tree { at: P3; trunk: { radius: number; height: number }; crown: { at: P3; radius: number }[]; seed: number; leaves?: string; /** A palm: fronds from the one ball of its crown, in place of sprigs over many. */ palm?: boolean }

/** A block's trees as three meshes: wood, leaves, and the bed each stands in. */
export function trees(list: Tree[], steady: boolean): THREE.Group {
  const wood = new Mesher(), bed = new Mesher()
  const at: number[] = [], normal: number[] = [], color: number[] = [], uvs: number[] = []
  const BARK = rgb('#8d7862'), SOIL = rgb('#4a3a2c'), EDGE = rgb('#8f8a80')
  const a = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), tint = new THREE.Color()
  const frond = { at: [] as number[], normal: [] as number[], color: [] as number[], uv: [] as number[] }
  for (const tree of list) {
    const next = stream(tree.seed), [x, y, z] = tree.at, fork = tree.trunk.height, thick = tree.trunk.radius
    if (tree.palm) {
      // A palm: a bed, a trunk that swells at its foot and under its crown, and fronds that rise from the crown's heart and arch over, the oldest hanging.
      bed.place(new THREE.Matrix4().makeRotationX(Math.atan(GRADE)).setPosition(x, y, z))
      bed.box([0, 0.006, 0], [0.62, 0.012, 0.62], EDGE, '-y')
      bed.box([0, 0.012, 0], [0.52, 0.012, 0.52], SOIL, '-y')
      wood.place(new THREE.Matrix4().makeTranslation(x, y, z))
      wood.post([0, 0, 0], thick * 1.5, 0.5, BARK, 10, thick * 1.05)
      wood.post([0, 0.5, 0], thick * 1.05, fork - 1.1, BARK, 10, thick * 0.95)
      wood.post([0, fork - 0.6, 0], thick * 0.95, 0.9, rgb('#7d6a4c'), 10, thick * 1.7)
      const heart = new THREE.Vector3(x + tree.crown[0].at[0], y + tree.crown[0].at[1] - 0.3, z + tree.crown[0].at[2]), base = new THREE.Color(tree.leaves ?? '#4f8f3c'), fronds = 26
      for (let i = 0; i < fronds; i++) {
        const age = i / (fronds - 1), round = i * 2.39996 + next(), long = 2.5 + next() * 0.7, segments = 7
        const out = new THREE.Vector3(Math.cos(round), 0, Math.sin(round)), across = new THREE.Vector3(-out.z, 0, out.x)
        tint.copy(base).offsetHSL((next() - 0.5) * 0.04, 0, (next() - 0.5) * 0.06).multiplyScalar(1.0 - age * 0.45)
        let pitch = 1.25 - age * 1.5
        a.copy(heart).addScaledVector(out, 0.15)
        for (let k = 0; k < segments; k++) {
          const from = a.clone(), wide0 = 0.55 * Math.sin((Math.PI * (k + 0.35)) / (segments + 0.7)) ** 0.7, wide1 = 0.55 * Math.sin((Math.PI * (k + 1.35)) / (segments + 0.7)) ** 0.7
          t.copy(out).multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch))
          a.addScaledVector(t, long / segments)
          pitch -= 0.2 + age * 0.12
          n.crossVectors(across, t).normalize()
          const corner = (p: THREE.Vector3, side: number, wide: number, v: number) => { frond.at.push(p.x + across.x * side * wide, p.y, p.z + across.z * side * wide); frond.normal.push(n.x, n.y, n.z); frond.color.push(tint.r, tint.g, tint.b); frond.uv.push(side * 0.5 + 0.5, v) }
          corner(from, -1, wide0, k / segments); corner(from, 1, wide0, k / segments); corner(a, 1, wide1, (k + 1) / segments)
          corner(from, -1, wide0, k / segments); corner(a, 1, wide1, (k + 1) / segments); corner(a, -1, wide1, (k + 1) / segments)
        }
      }
      continue
    }
    // The bed: a square of soil let into the pavement, a stone edge round it.
    bed.place(new THREE.Matrix4().makeRotationX(Math.atan(GRADE)).setPosition(x, y, z))
    bed.box([0, 0.006, 0], [0.62, 0.012, 0.62], EDGE, '-y')
    bed.box([0, 0.012, 0], [0.52, 0.012, 0.52], SOIL, '-y')
    // The trunk, spreading at its foot, then a bough up into each ball of the crown.
    wood.place(new THREE.Matrix4().makeTranslation(x, y, z))
    wood.post([0, 0, 0], thick * 1.6, 0.18, BARK, 9, thick * 1.15)
    wood.post([0, 0.16, 0], thick * 1.15, fork - 0.16, BARK, 9, thick * 0.9)
    const clumps = tree.crown.map((c) => ({ c: new THREE.Vector3(x + c.at[0], y + c.at[1], z + c.at[2]), r: c.radius }))
    const heart = clumps[0].c
    for (const c of tree.crown.slice(1)) wood.bar([0, fork - 0.1, 0], [c.at[0] * 0.9, c.at[1] - c.radius * 0.25, c.at[2] * 0.9], thick * 0.5, BARK, 6)
    // Sprigs over each ball of the crown: cards that face outward, more or less, each turned its own way.
    const base = new THREE.Color(tree.leaves ?? '#4f8f3c'), reach = Math.max(...clumps.map((o) => o.c.distanceTo(heart) + o.r))
    for (const { c, r } of clumps) {
      const count = Math.round(240 * r * r)
      for (let i = 0; i < count; i++) {
        const u = next() * 2 - 0.7, round = next() * Math.PI * 2, flat = Math.sqrt(Math.max(0, 1 - Math.min(1, u) ** 2))
        n.set(Math.cos(round) * flat, Math.min(1, u), Math.sin(round) * flat).normalize()
        a.copy(c).addScaledVector(n, r * (0.55 + next() * 0.55))
        // What is inside another ball is not seen: left out.
        if (clumps.some((o) => o.c !== c && a.distanceTo(o.c) < o.r * 0.6)) continue
        const face = n.clone().add(new THREE.Vector3(next() - 0.5, next() - 0.2, next() - 0.5).multiplyScalar(0.9)).normalize()
        t.set(next() - 0.5, next() - 0.5, next() - 0.5).cross(face).normalize()
        b.crossVectors(face, t)
        const half = 0.2 + next() * 0.13
        // Lit as part of the whole crown: its normal is mostly the way out from the crown's heart.
        const soft = a.clone().sub(heart).normalize().lerp(face, 0.3).normalize()
        // Lower and deeper leaves are darker; each sprig is a little its own green.
        const high = THREE.MathUtils.clamp(((a.y - heart.y) / reach) * 0.5 + 0.5, 0, 1), deep = THREE.MathUtils.clamp(a.distanceTo(heart) / reach, 0, 1)
        tint.copy(base).offsetHSL((next() - 0.5) * 0.05, (next() - 0.5) * 0.12, (next() - 0.5) * 0.1).multiplyScalar(0.42 + 0.4 * high + 0.3 * deep)
        const corner = (i: number, j: number) => { at.push(a.x + t.x * i * half + b.x * j * half, a.y + t.y * i * half + b.y * j * half, a.z + t.z * i * half + b.z * j * half); normal.push(soft.x, soft.y, soft.z); color.push(tint.r, tint.g, tint.b); uvs.push(i * 0.5 + 0.5, j * 0.5 + 0.5) }
        corner(-1, -1); corner(1, -1); corner(1, 1); corner(-1, -1); corner(1, 1); corner(-1, 1)
      }
    }
  }
  const crown = new THREE.BufferGeometry()
  crown.setAttribute('position', new THREE.Float32BufferAttribute(at, 3))
  crown.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  crown.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  crown.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))

  const paint = sprig(), leafAt = texture(paint, uv())
  const leaves = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0, side: THREE.DoubleSide })
  // With frames blended (the steady tiers) a leaf's soft edge is a scatter of dots that blends smooth; without, it is cut.
  const edges = (blended: boolean) => { leaves.alphaHash = blended; leaves.alphaTest = blended ? 0 : 0.45; leaves.needsUpdate = true }
  edges(steady)
  // Leaves close to the eye thin away, so the camera that follows you is never shut inside a crown.
  leaves.opacityNode = leafAt.a.mul(smoothstep(1.3, 3.4, cameraPosition.sub(positionWorld).length()))
  leaves.colorNode = vertexColor().rgb.mul(leafAt.rgb.mul(1.25))
  leaves.normalNode = transformNormalToView(normalLocal)
  // The sun through a leaf: seen from the far side of it, a leaf glows its own yellow green.
  const toEye = cameraPosition.sub(positionWorld).normalize(), through = dot(toEye, vec3(-SUN[0], -SUN[1], -SUN[2])).max(0).pow(2)
  leaves.emissiveNode = vertexColor().rgb.mul(vec3(1.25, 1.3, 0.5)).mul(through.mul(0.45)).mul(leafAt.rgb)
  // The wind: the whole crown leans a little and each sprig shivers, more the higher it is.
  const where = positionLocal, phase = where.x.mul(0.7).add(where.z.mul(0.9))
  const lean = vec3(sin(time.mul(0.9).add(phase.mul(0.3))), 0, sin(time.mul(0.7).add(phase.mul(0.23)).add(1.7))).mul(0.05)
  const shiver = vec3(sin(time.mul(3.1).add(phase.mul(5.3))), sin(time.mul(2.7).add(phase.mul(4.1))), sin(time.mul(3.7).add(phase.mul(6.7)))).mul(0.018)
  leaves.positionNode = where.add(lean).add(shiver)

  const bark: Surface = (() => {
    const p = positionWorld, ridge = sin(p.x.add(p.z).mul(46).add(sin(p.y.mul(7)).mul(1.4))).mul(0.5).add(0.5)
    return { color: mix(vertexColor().rgb.mul(0.72), vertexColor().rgb.mul(1.08), ridge), roughness: float(0.92), height: ridge.mul(0.006) }
  })()
  const group = new THREE.Group()
  group.name = 'the trees'
  const plain = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  plain.colorNode = vertexColor().rgb
  // A palm's frond: a rib down its middle and leaflets either side, slanting towards its tip; the gaps between them are cut away.
  const blades = new THREE.BufferGeometry()
  blades.setAttribute('position', new THREE.Float32BufferAttribute(frond.at, 3))
  blades.setAttribute('normal', new THREE.Float32BufferAttribute(frond.normal, 3))
  blades.setAttribute('color', new THREE.Float32BufferAttribute(frond.color, 3))
  blades.setAttribute('uv', new THREE.Float32BufferAttribute(frond.uv, 2))
  const palm = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 })
  const off = uv().x.sub(0.5).abs().mul(2), leaflet = float(1).sub(step(0.6, uv().y.mul(20).sub(off.mul(1.3)).fract()))
  palm.opacityNode = float(1).sub(step(0.07, off)).max(leaflet)
  palm.colorNode = vertexColor().rgb.mul(off.mul(0.35).add(0.8))
  palm.emissiveNode = vertexColor().rgb.mul(vec3(1.2, 1.25, 0.5)).mul(through.mul(0.3))
  palm.positionNode = where.add(lean.mul(where.y.sub(4).max(0).mul(0.35)))
  for (const [name, geometry, material] of [['wood', wood.geometry(), made(bark)], ['beds', bed.geometry(), plain], ['leaves', crown, leaves], ['fronds', blades, palm]] as const) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `trees ${name}`
    mesh.castShadow = name !== 'beds'
    mesh.receiveShadow = true
    group.add(mesh)
  }
  group.userData.steady = edges
  return group
}
