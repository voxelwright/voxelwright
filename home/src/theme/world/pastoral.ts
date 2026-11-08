// Hand-painted pastoral's world (rollout B of regroup S1): the house stands in a meadow in
// rolling painted countryside. One heightfield carries a gouache patchwork of fields, a pale
// lane curving past the left of the house and soft tree shadows; hedgerows run along some field
// edges; a few trees with layered crowns stand beside and behind the house; a small farmhouse
// sits on a rise behind; and the pastoral sky card stands on the far hills. The meadow is flat
// round the house and stays plain towards the camera, so the room keeps the eye; the hills rise
// behind and to the sides, where the dollhouse frame's top band and edges see them, and fade
// into the paper with the theme's fog. The seated window looks out at the same hills.
import * as THREE from 'three/webgpu'
import { canvas, makeNoise, rng, toTexture } from '../../paint'
import { YARD_TOP } from '../../diorama'
import { paintGouacheLeaves, paintPastoralSky } from '../paint'
import type { House, World } from './index'
import { Bin, tint } from './build'

const FLAT = 1.7 // metres of flat meadow round the walls (the house's own contact shadow lies on it)
const SPAN = 64 // the heightfield's side, centred on the house
const PX = 2048 // the ground painting's side in pixels (about 3 cm each)

type Height = (x: number, z: number) => number

/** Rolling ground: flat by the house, gentle in front, rising behind and to the sides. */
function terrain(house: House): Height {
  const { x0, x1, z0, z1 } = house
  const s = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  return (x, z) => {
    const side = Math.max(x0 - FLAT - x, x - x1 - FLAT, 0)
    const back = Math.max(z0 - FLAT - z, 0)
    const front = Math.max(z - z1 - FLAT, 0)
    const roll = 0.62 + 0.3 * Math.sin(x * 0.29 + 1.3) * Math.cos(z * 0.23 + 0.4) + 0.18 * Math.sin(x * 0.11 - z * 0.15 + 2)
    const rise = Math.max(s(0, 11, back) * 2.4, s(0, 9, side) * 3.0, s(2, 14, front) * 0.35)
    // A far ridge behind everything, low enough that the seated window keeps its sky.
    const ridge = s(14, 26, back) * 1.1
    return YARD_TOP + rise * roll + ridge
  }
}

/** The lane: a smooth curve in world x, z from the front left, round the house's left side, off behind. */
function lane(house: House): Array<[number, number]> {
  const { x0, z0, z1 } = house
  const ctrl: Array<[number, number]> = [[x0 - 1.2, z1 + 12], [x0 - 2.0, z1 + 3], [x0 - 2.6, (z0 + z1) / 2], [x0 - 3.4, z0 - 4], [x0 - 7.5, z0 - 11], [x0 - 15, z0 - 18]]
  const out: Array<[number, number]> = []
  // Catmull-Rom through the control points.
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]
    for (let k = 0; k < 16; k++) {
      const t = k / 16, t2 = t * t, t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(ctrl[ctrl.length - 1])
  return out
}

interface Plan {
  house: House
  cx: number
  cz: number
  /** Field patches: a jittered grid in world metres, each with a wash colour (none near the house). */
  fields: Array<{ corners: Array<[number, number]>; colour: string }>
  /** Hedgerow runs along some field edges. */
  hedges: Array<[[number, number], [number, number]]>
  trees: Array<{ x: number; z: number; s: number }>
  farm: { x: number; z: number }
  lane: Array<[number, number]>
}

function plan(house: House, r: () => number): Plan {
  const { x0, x1, z0, z1 } = house
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  const CELL = 7.5, N = Math.ceil(SPAN / CELL) + 1
  const ox = cx - (N * CELL) / 2, oz = cz - (N * CELL) / 2
  const grid: Array<Array<[number, number]>> = []
  for (let i = 0; i <= N; i++) {
    grid.push([])
    for (let j = 0; j <= N; j++) grid[i].push([ox + i * CELL + (r() - 0.5) * CELL * 0.5, oz + j * CELL + (r() - 0.5) * CELL * 0.5])
  }
  // Fields keep clear of the meadow round the house (and of the front, the frame's quiet edge).
  const near = (x: number, z: number) => x > x0 - 4.5 && x < x1 + 4.5 && z > z0 - 4.5
  const washes = ['#a2bc72', '#b4c682', '#94b268', '#d2cc8e', '#c2c890', '#a6bc80', '#dccb92', '#9cb47a']
  const fields: Plan['fields'] = []
  const hedges: Plan['hedges'] = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const c = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
    const mx = c.reduce((a, p) => a + p[0], 0) / 4, mz = c.reduce((a, p) => a + p[1], 0) / 4
    if (near(mx, mz)) continue
    fields.push({ corners: c, colour: washes[Math.floor(r() * washes.length)] })
    // Hedges on some edges, none level with or in front of the house (the bottom of the dollhouse frame).
    for (const [a, b] of [[c[0], c[1]], [c[1], c[2]]] as const) {
      const ex = (a[0] + b[0]) / 2, ez = (a[1] + b[1]) / 2
      if (ez > z1 - 2 || near(ex, ez) || r() < 0.4) continue
      hedges.push([a, b])
    }
  }
  const trees: Plan['trees'] = [
    { x: x0 - 2.3, z: z0 + 0.9, s: 1.05 }, { x: x0 - 3.4, z: z1 - 1.2, s: 0.85 },
    { x: cx + 1.8, z: z0 - 6.2, s: 1.2 }, { x: x1 - 1.4, z: z0 - 3.0, s: 0.9 },
    { x: x1 + 2.6, z: z0 - 0.6, s: 1.1 }, { x: x1 + 3.4, z: z0 + 2.4, s: 0.8 },
    { x: x0 - 6.5, z: z0 - 6, s: 1.15 }, { x: -4.6, z: -16, s: 0.7 }, { x: -2.0, z: -19, s: 0.6 }, { x: cx + 4, z: z0 - 10.5, s: 1.0 }, { x: x1 + 6, z: z0 - 7, s: 1.2 },
  ]
  return { house, cx, cz, fields, hedges, trees, farm: { x: -3.0, z: z0 - 24 }, lane: lane(house) }
}

/** The ground's painting: meadow, field washes, the lane and soft shadows, laid over SPAN metres. */
function paintGround(p: Plan, seed: number) {
  const r = rng(seed)
  const n = makeNoise(seed, 64)
  const [c, g] = canvas(PX, PX)
  const k = PX / SPAN
  const u = (x: number) => (x - (p.cx - SPAN / 2)) * k
  const v = (z: number) => (z - (p.cz - SPAN / 2)) * k
  g.fillStyle = '#9cb86c'
  g.fillRect(0, 0, PX, PX)
  /** A soft dab (radial wash) at pixel x, y. */
  const dab = (x: number, y: number, rx: number, ry: number, rgb: string, a: number, turn = 0) => {
    g.save()
    g.translate(x, y)
    g.rotate(turn)
    g.scale(1, ry / rx)
    const f = g.createRadialGradient(0, 0, 0, 0, 0, rx)
    f.addColorStop(0, `rgba(${rgb},${a})`)
    f.addColorStop(0.6, `rgba(${rgb},${a * 0.7})`)
    f.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = f
    g.beginPath()
    g.arc(0, 0, rx, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  // Fields: a flat wash each, a little inset, with a darker pooled rim, as watercolour dries.
  g.lineJoin = 'round'
  for (const f of p.fields) {
    g.beginPath()
    f.corners.forEach(([x, z], i) => (i ? g.lineTo(u(x), v(z)) : g.moveTo(u(x), v(z))))
    g.closePath()
    g.globalAlpha = 0.85
    g.fillStyle = f.colour
    g.fill()
    g.globalAlpha = 0.18
    g.strokeStyle = '#3e6a34'
    g.lineWidth = 10
    g.stroke()
    g.globalAlpha = 1
    // Mown or ploughed rows in some fields: faint parallel strokes.
    if (r() < 0.45) {
      const [a, b] = [f.corners[0], f.corners[1]]
      const ang = Math.atan2(v(b[1]) - v(a[1]), u(b[0]) - u(a[0]))
      g.save()
      g.clip()
      g.strokeStyle = r() < 0.5 ? 'rgba(255,248,210,0.16)' : 'rgba(70,110,50,0.14)'
      g.lineWidth = 8
      const mx = f.corners.reduce((s, q) => s + u(q[0]), 0) / 4, my = f.corners.reduce((s, q) => s + v(q[1]), 0) / 4
      g.translate(mx, my)
      g.rotate(ang)
      for (let y = -300; y < 300; y += 26) { g.beginPath(); g.moveTo(-320, y); g.lineTo(320, y); g.stroke() }
      g.restore()
    }
  }
  // Uneven wash over everything, so no field is a flat fill.
  for (let i = 0; i < 260; i++) {
    const x = r() * PX, y = r() * PX, light = r() < 0.5
    dab(x, y, 60 + r() * 140, 30 + r() * 60, light ? '240,240,196' : '84,118,70', light ? 0.14 : 0.08, r() * 3)
  }
  // Short grass strokes in two tones near the house, where the dollhouse camera looks closest.
  g.lineCap = 'round'
  const hx = u(p.cx), hy = v(p.cz)
  for (let i = 0; i < 6000; i++) {
    const x = hx + (r() - 0.5) * 30 * k, y = hy + (r() - 0.5) * 26 * k
    const len = 6 + r() * 10, lean = (r() - 0.5) * 6, shade = n(x / 40, y / 40, 2)
    g.strokeStyle = shade < 0.5 ? `rgba(84,124,66,${0.1 + r() * 0.14})` : `rgba(226,234,170,${0.12 + r() * 0.16})`
    g.lineWidth = 1.5 + r() * 2
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + lean, y - len)
    g.stroke()
  }
  // Meadow flowers: tiny dabs of cream, butter and pale lilac in loose drifts round the house.
  // Never in front of the house: the bottom of the dollhouse frame stays quiet.
  for (let d = 0; d < 16; d++) {
    const dx = hx + (r() - 0.5) * 28 * k, dy = v(p.house.z0 - 1 - r() * 6) + (r() < 0.5 ? 0 : (r() * 0.6) * (v(p.house.z1) - v(p.house.z0)))
    const col = ['255,250,232', '250,232,150', '222,206,240'][Math.floor(r() * 3)]
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${col},${0.4 + r() * 0.35})`
      g.beginPath()
      g.arc(dx + (r() - 0.5) * 70, dy + (r() - 0.5) * 44, 1.4 + r() * 1.6, 0, Math.PI * 2)
      g.fill()
    }
  }
  // The lane: a pale ochre track with a grassy crown and two darker wheel ruts.
  const path = () => {
    g.beginPath()
    p.lane.forEach(([x, z], i) => (i ? g.lineTo(u(x), v(z)) : g.moveTo(u(x), v(z))))
  }
  g.lineJoin = g.lineCap = 'round'
  path(); g.strokeStyle = 'rgba(150,120,70,0.35)'; g.lineWidth = 1.5 * k; g.stroke()
  path(); g.strokeStyle = '#dcc596'; g.lineWidth = 1.3 * k; g.stroke()
  path(); g.strokeStyle = 'rgba(176,146,96,0.45)'; g.lineWidth = 0.95 * k; g.stroke()
  path(); g.strokeStyle = 'rgba(130,168,84,0.75)'; g.lineWidth = 0.32 * k; g.stroke()
  // Soft cool shadows under the trees and the farmhouse, falling away from the sun (behind, left).
  for (const t of p.trees) dab(u(t.x + 0.6 * t.s), v(t.z + 0.7 * t.s), 1.7 * t.s * k, 1.2 * t.s * k, '52,70,92', 0.32, 0.6)
  dab(u(p.farm.x + 0.8), v(p.farm.z + 1.2), 2.6 * k, 1.5 * k, '52,70,92', 0.28)
  // The sheet's margin: the painting fades to warm paper from about 13 m out from the house.
  const fade = g.createRadialGradient(hx, hy, 13 * k, hx, hy, 30 * k)
  fade.addColorStop(0, 'rgba(244,236,220,0)')
  fade.addColorStop(1, 'rgba(244,236,220,0.85)')
  g.fillStyle = fade
  g.fillRect(0, 0, PX, PX)
  const t = toTexture(c)
  t.anisotropy = 4
  return t
}

/** Blobs along a hedgerow run, sitting on the ground, two greens with a lit top. */
function hedgerow(a: [number, number], b: [number, number], h: Height, r: () => number, out: THREE.BufferGeometry[]) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.ceil(len / 0.45)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = a[0] + (b[0] - a[0]) * t + (r() - 0.5) * 0.16, z = a[1] + (b[1] - a[1]) * t + (r() - 0.5) * 0.16
    const s = 0.3 + r() * 0.14
    const g = new THREE.IcosahedronGeometry(s, 1).scale(1.3, 0.85 + r() * 0.3, 1.3).translate(x, h(x, z) + s * 0.45, z)
    out.push(shadeBlob(g, [0.22, 0.34, 0.2], [0.42, 0.56, 0.3]))
  }
}

/** Vertex colours from a shadow colour at the bottom to a lit colour at the top of the blob. */
function shadeBlob(g: THREE.BufferGeometry, low: [number, number, number], high: [number, number, number]) {
  g.computeBoundingBox()
  const { min, max } = g.boundingBox!
  const p = g.attributes.position
  const c = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - min.y) / (max.y - min.y || 1)))
    const k = t * t
    c.set([low[0] + (high[0] - low[0]) * k, low[1] + (high[1] - low[1]) * k, low[2] + (high[2] - low[2]) * k], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

/** A tree: a tapering trunk and a crown of three or four layered blobs, darker below and to the back, lit on top. */
function tree(x: number, z: number, s: number, h: Height, r: () => number, wood: THREE.BufferGeometry[], leaves: THREE.BufferGeometry[]) {
  const y = h(x, z)
  wood.push(tint(new THREE.CylinderGeometry(0.07 * s, 0.13 * s, 1.7 * s, 7).translate(x, y + 0.85 * s, z), 0.42, 0.3, 0.22))
  const lobes: Array<[number, number, number, number, [number, number, number], [number, number, number]]> = [
    [0, 1.85, 0, 0.95, [0.2, 0.32, 0.2], [0.36, 0.52, 0.26]], // the big shaded mass
    [0.45, 2.2, 0.25, 0.7, [0.3, 0.44, 0.22], [0.5, 0.66, 0.3]],
    [-0.4, 2.35, -0.1, 0.62, [0.3, 0.46, 0.24], [0.56, 0.72, 0.34]],
    [0.05, 2.7, 0.1, 0.5, [0.44, 0.6, 0.28], [0.74, 0.84, 0.44]], // the sunlit top
  ]
  for (const [dx, dy, dz, rad, low, high] of lobes) {
    const g = new THREE.IcosahedronGeometry(rad * s * (0.9 + r() * 0.2), 2).scale(1, 0.88, 1).translate(x + dx * s, y + dy * s, z + dz * s)
    leaves.push(shadeBlob(g, low, high))
  }
}

/** A small whitewashed farmhouse with a terracotta roof and a chimney, and a barn beside it. */
function farmhouse(x: number, z: number, h: Height, walls: THREE.BufferGeometry[], roofs: THREE.BufferGeometry[]) {
  const y = Math.min(h(x - 1, z), h(x + 1, z), h(x, z - 0.8), h(x, z + 0.8)) - 0.05
  const block = (w: number, ht: number, d: number, bx: number, bz: number, wall: [number, number, number], roof: [number, number, number]) => {
    walls.push(tint(new THREE.BoxGeometry(w, ht, d).translate(bx, y + ht / 2, bz), ...wall))
    // A gable roof: a three-sided prism along x, a little overhang.
    const prism = new THREE.CylinderGeometry(d * 0.62, d * 0.62, w + 0.16, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2)
    prism.scale(1, 0.62, 1).translate(bx, y + ht + d * 0.19, bz)
    roofs.push(tint(prism, ...roof))
  }
  block(2.2, 1.25, 1.4, x, z, [0.96, 0.92, 0.84], [0.74, 0.4, 0.28])
  block(1.4, 1.0, 1.2, x + 2.1, z + 0.3, [0.7, 0.42, 0.32], [0.46, 0.36, 0.32]) // the barn
  walls.push(tint(new THREE.BoxGeometry(0.22, 0.6, 0.22).translate(x - 0.6, y + 1.75, z - 0.2), 0.86, 0.8, 0.72))
}

/**
 * Everything here is out of the fog: in the dollhouse view the theme's paper fog veiled the whole
 * meadow, and the seated room's room-sized fog (6 to 22 m) washed the window's view to blank
 * paper. The ground's painting fades to paper towards its edges instead, so only the far hills go pale.
 */
export function pastoralHills(house: House): World {
  const bin = new Bin()
  const r = rng(31)
  const p = plan(house, r)
  const h = terrain(house)

  // The ground: one heightfield wearing its painting. It takes the house's and the trees' shadows.
  const ground = new THREE.PlaneGeometry(SPAN, SPAN, 128, 128).rotateX(-Math.PI / 2).translate(p.cx, 0, p.cz)
  const pos = ground.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setY(i, h(pos.getX(i), pos.getZ(i)))
  ground.computeVertexNormals()
  bin.mesh([ground], new THREE.MeshStandardMaterial({ map: bin.keep(paintGround(p, 7)), roughness: 1, fog: false }), { receive: true, name: 'pastoral ground' })

  // Hedgerows, trees and the farmhouse share one leaf material: gouache dabs over vertex greens.
  const leaves: THREE.BufferGeometry[] = []
  const wood: THREE.BufferGeometry[] = []
  for (const [a, b] of p.hedges) hedgerow(a, b, h, r, leaves)
  for (const t of p.trees) tree(t.x, t.z, t.s, h, r, wood, leaves)
  const leafMap = bin.keep(paintGouacheLeaves(4))
  leafMap.wrapS = leafMap.wrapT = THREE.RepeatWrapping
  leafMap.repeat.set(5, 3)
  bin.mesh(leaves, new THREE.MeshStandardMaterial({ map: leafMap, vertexColors: true, roughness: 1, fog: false }), { name: 'pastoral leaves' })
  const walls: THREE.BufferGeometry[] = []
  const roofs: THREE.BufferGeometry[] = []
  farmhouse(p.farm.x, p.farm.z, h, walls, roofs)
  const plain = (gs: THREE.BufferGeometry[]) => gs.map((g) => {
    const q = g.index ? g.toNonIndexed() : g
    if (q !== g) g.dispose()
    q.deleteAttribute('uv')
    return q
  })
  bin.mesh(plain([...wood, ...walls, ...roofs]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false }), { name: 'pastoral trunks and farm' })

  // The sky card: an arc behind the hills and round the sides, the same painting the theme's
  // own sky wore, on the far ridge. Its foot shows distant blue hills; clouds stand on them.
  const R = Math.max(house.x1 - house.x0, house.z1 - house.z0) * 0.5 + 13
  const H = 11
  const arc = new THREE.CylinderGeometry(R, R, H, 96, 1, true, Math.PI * 0.42, Math.PI * 1.16).translate(p.cx, h(p.cx, p.cz - R) - 1 + H / 2, p.cz)
  const sky = bin.keep(paintPastoralSky(13))
  sky.wrapS = THREE.RepeatWrapping
  sky.repeat.set(1.4, 1)
  bin.mesh([arc], new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false }), { name: 'pastoral sky card' })
  return bin.world()
}
