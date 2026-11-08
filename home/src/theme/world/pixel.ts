// 16-bit's world (rollout B of regroup S1): the house stands on a pixel-art lot. The ground is
// one small painting read texel for texel (10 cm each, about two art pixels from the dollhouse
// view): grass in the palette's greens with tufts, a stone path from the front to the back door,
// flowers as single-texel clusters and flat drop shadows under the trees. A wooden fence a few
// pixels high closes the back and sides; chunky faceted trees and bushes, two-tone like sprites,
// stand along it, thickest behind the house where the frame's top band looks. The front stays
// open grass. The seated window sees the same tree line against a banded pixel sky.
import * as THREE from 'three/webgpu'
import { canvas, rng } from '../../paint'
import { YARD_TOP } from '../../diorama'
import { WINDOW } from '../../layout'
import type { House, World } from './index'
import { Bin } from './build'

const TEXEL = 0.1 // metres per ground texel
const SPAN = 48 // the ground's side in metres, centred on the house
const BACK = 5.2 // fence line behind the back wall
const SIDE = 4.6 // fence line beside the side walls

type RGB = [number, number, number]
const hex = (h: string): RGB => {
  const c = new THREE.Color(h)
  return [c.r, c.g, c.b]
}

/** A texture read texel for texel: no filtering, no mipmaps. */
function crisp(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.anisotropy = 1
  return t
}

interface Lot {
  cx: number
  cz: number
  /** Fence corners: back left, back right, front right, front left (the front is open). */
  fx0: number
  fx1: number
  fz0: number
  fz1: number
  trees: Array<{ x: number; z: number; s: number; pine: boolean }>
  bushes: Array<{ x: number; z: number; s: number }>
  path: Array<[number, number]>
}

function layout(house: House, r: () => number): Lot {
  const { x0, x1, z0, z1 } = house
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  const fx0 = x0 - SIDE, fx1 = x1 + SIDE, fz0 = z0 - BACK, fz1 = z1 + 0.5
  const trees: Lot['trees'] = []
  // A tree line just behind the back fence and a second, staggered row further back.
  // The rows open where the kitchen window looks out (from the seat, x about -3.8 to -0.4 at
  // that depth), so the window sees across the lot to the far hills and sky.
  const vista = (x: number) => x > WINDOW.x0 - 2.6 && x < WINDOW.x1 + 0.2
  for (let x = fx0 - 1.5; x < fx1 + 2; x += 1.7 + r() * 0.8) if (!vista(x)) trees.push({ x: x + (r() - 0.5) * 0.4, z: fz0 - 1.2 - r() * 0.6, s: 0.95 + r() * 0.35, pine: r() < 0.15 })
  for (let x = fx0 - 3; x < fx1 + 3; x += 2.2 + r() * 1.2) if (!vista(x)) trees.push({ x, z: fz0 - 3.6 - r() * 1.2, s: 1.1 + r() * 0.4, pine: r() < 0.25 })
  // Down the sides, outside the fence, stopping short of the front.
  for (const sx of [fx0 - 1.3, fx1 + 1.3]) for (let z = fz0 + 0.6; z < z1 - 0.8; z += 1.9 + r() * 0.8) trees.push({ x: sx + (r() - 0.5) * 0.6, z, s: 0.85 + r() * 0.3, pine: r() < 0.12 })
  // Bushes inside the fence at the back corners and along the back, and a pair by the path.
  const bushes: Lot['bushes'] = [
    { x: fx0 + 0.7, z: fz0 + 0.7, s: 1 }, { x: fx0 + 1.6, z: fz0 + 0.6, s: 0.8 }, { x: fx1 - 0.7, z: fz0 + 0.7, s: 1.1 },
    { x: cx + 1.5, z: fz0 + 0.6, s: 0.8 }, { x: fx1 - 0.6, z: z0 + 1.2, s: 0.9 }, { x: fx0 + 0.6, z: z1 - 1.2, s: 0.85 },
  ]
  // The path: in from the open front, up the left side, along the back to the kitchen door.
  const path: Array<[number, number]> = [[x0 - 1.6, z1 + 6], [x0 - 1.5, z1 + 0.8], [x0 - 1.4, z0 - 1.3], [x0 + 1.4, z0 - 1.3]]
  return { cx, cz, fx0, fx1, fz0, fz1, trees, bushes, path }
}

/** The ground: grass, the path, flowers and tree shadows, one texel per 10 cm. */
function paintLot(lot: Lot, r: () => number) {
  const N = Math.round(SPAN / TEXEL)
  const [c, g] = canvas(N, N)
  const img = g.createImageData(N, N)
  const tx = (x: number) => Math.round((x - (lot.cx - SPAN / 2)) / TEXEL)
  const tz = (z: number) => Math.round((z - (lot.cz - SPAN / 2)) / TEXEL)
  const set = (x: number, y: number, h: string) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return
    const v = parseInt(h.slice(1), 16)
    img.data.set([v >> 16, (v >> 8) & 255, v & 255, 255], (y * N + x) * 4)
  }
  const inLot = (x: number, y: number) => x >= tx(lot.fx0) && x <= tx(lot.fx1) && y >= tz(lot.fz0) && y <= tz(lot.fz1 + 6)
  // Grass on a coarse 3-texel lattice, so each patch is a clean blob of art pixels.
  const blob = (x: number, y: number) => {
    const qx = Math.floor(x / 3), qy = Math.floor(y / 3)
    const h = Math.sin(qx * 12.9898 + qy * 78.233) * 43758.5453
    return h - Math.floor(h)
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Inside the fence one mid green with a few faint lighter patches; outside, a darker field.
    const b = blob(x + (y >> 3), y)
    set(x, y, inLot(x, y) ? (b < 0.04 ? '#a6c858' : '#6a9a3a') : (b < 0.12 ? '#6a9a3a' : '#3e6a34'))
  }
  // Tufts: a dark two-texel tick, and a lighter texel above some of them.
  for (let i = 0; i < N * N * 0.008; i++) {
    const x = Math.floor(r() * N), y = Math.floor(r() * N)
    const inside = inLot(x, y)
    set(x, y, inside ? '#3e6a34' : '#2e5a3a')
    set(x + 1, y - 1, inside ? '#3e6a34' : '#2e5a3a')
    if (r() < 0.4) set(x, y - 1, inside ? '#a6c858' : '#6a9a3a')
  }
  // Flat drop shadows under trees and bushes, falling away from the sun (towards the front right).
  const ellipse = (x: number, z: number, rx: number, rz: number, h: string) => {
    for (let y = tz(z - rz); y <= tz(z + rz); y++) for (let xx = tx(x - rx); xx <= tx(x + rx); xx++) {
      const dx = (xx - tx(x)) / (rx / TEXEL), dy = (y - tz(z)) / (rz / TEXEL)
      if (dx * dx + dy * dy <= 1) set(xx, y, h)
    }
  }
  for (const t of lot.trees) ellipse(t.x + 0.35 * t.s, t.z + 0.35 * t.s, 0.95 * t.s, 0.65 * t.s, '#2e5a3a')
  for (const b of lot.bushes) ellipse(b.x + 0.2, b.z + 0.2, 0.55 * b.s, 0.4 * b.s, '#3e6a34')
  // The path: 4-by-4-texel stones in two warm greys with one-texel gaps, a dirt edge either side.
  const stones = ['#dacdc0', '#c4b4a8', '#dacdc0', '#ece4d8']
  for (let i = 0; i < lot.path.length - 1; i++) {
    const [ax, az] = lot.path[i], [bx, bz] = lot.path[i + 1]
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / TEXEL)
    for (let k = 0; k <= steps; k++) {
      const x = tx(ax + ((bx - ax) * k) / steps), y = tz(az + ((bz - az) * k) / steps)
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const px = x + dx, py = y + dy
        const edge = Math.abs(dx) === 4 || Math.abs(dy) === 4
        if (edge) {
          if (img.data[(py * N + px) * 4 + 1] > 150) continue // keep stones already laid
          set(px, py, '#a07050')
          continue
        }
        const gap = ((px % 5) + 5) % 5 === 0 || ((py % 5) + 5) % 5 === 0
        set(px, py, gap ? '#8a7876' : stones[(Math.floor(px / 5) * 7 + Math.floor(py / 5) * 3) & 3])
      }
    }
  }
  // Flowers: clusters of one to three texels in pink, butter yellow and white, inside the fence.
  const petals = ['#d07090', '#ecc66a', '#fffdf6', '#f09a58']
  for (let i = 0; i < 90; i++) {
    let x = 0, y = 0
    // Most of them in beds along the fence and the house's walls, a few loose in the grass.
    if (r() < 0.6) {
      const onBack = r() < 0.5
      x = onBack ? tx(lot.fx0 + 0.5 + r() * (lot.fx1 - lot.fx0 - 1)) : tx(r() < 0.5 ? lot.fx0 + 0.4 : lot.fx1 - 0.4)
      y = onBack ? tz(lot.fz0 + 0.4 + r() * 0.5) : tz(lot.fz0 + 1 + r() * (lot.fz1 - lot.fz0 - 1))
    } else {
      x = tx(lot.fx0 + r() * (lot.fx1 - lot.fx0)), y = tz(lot.fz0 + r() * (lot.fz1 + 4 - lot.fz0))
    }
    const col = petals[Math.floor(r() * petals.length)]
    set(x, y, col)
    if (r() < 0.6) set(x + 2, y + 1, col)
    if (r() < 0.4) set(x + 1, y - 2, col)
    set(x, y + 1, '#2e5a3a') // a dark stem pixel under the head
  }
  g.putImageData(img, 0, 0)
  return crisp(c)
}

/** Flat-shaded, coloured by facing: lit tops, mid sides, dark undersides, like a two-tone sprite. */
function facets(g: THREE.BufferGeometry, top: RGB, side: RGB, under: RGB) {
  const q = g.index ? g.toNonIndexed() : g
  if (q !== g) g.dispose()
  q.deleteAttribute('uv')
  q.computeVertexNormals() // unindexed: one normal per face
  const n = q.attributes.normal, c = new Float32Array(n.count * 3)
  for (let i = 0; i < n.count; i++) c.set(n.getY(i) > 0.45 ? top : n.getY(i) < -0.2 ? under : side, i * 3)
  q.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return q
}

/** A banded pixel sky with chunky clouds and a far hill line, for the seated window only. */
function paintSky(r: () => number) {
  const W = 192, H = 72
  const [c, g] = canvas(W, H)
  const bands = ['#48608c', '#6a8ec0', '#7894bc', '#b6d0e6']
  const stops = [0, 0.22, 0.48, 0.72]
  for (let i = 0; i < bands.length; i++) {
    g.fillStyle = bands[i]
    g.fillRect(0, Math.floor(stops[i] * H), W, H)
  }
  // Clouds: stacked rounded slabs, white tops and a pale-blue underside.
  for (const [cx, cy, w] of [[40, 34, 30], [112, 26, 40], [168, 38, 22]]) {
    for (const [dx, dy, ww, hh, col] of [[0, 4, w, 5, '#b6d0e6'], [2, 0, w - 4, 5, '#fffdf6'], [w * 0.25, -4, w * 0.45, 5, '#fffdf6']] as const) {
      g.fillStyle = col
      g.fillRect(Math.round(cx - w / 2 + dx), cy + dy, Math.round(ww), hh)
    }
  }
  // Far hills: a sage line with a darker rim, bumps in whole texels.
  for (let x = 0; x < W; x++) {
    const top = Math.round(H - 12 - 3 * Math.sin(x * 0.07 + 1) - 2 * Math.sin(x * 0.19 + r()))
    g.fillStyle = '#7c9a78'
    g.fillRect(x, top, 1, H - top)
    g.fillStyle = '#a8c0a0'
    g.fillRect(x, top, 1, 1)
  }
  return crisp(c)
}

export function pixelLot(house: House): World {
  // Out of the fog everywhere: the theme's tan haze turns far grass to dirt, and the seated room's
  // short fog would wash the tree line into the wall. Pixel art keeps its colours flat with distance.
  const bin = new Bin()
  const r = rng(53)
  const lot = layout(house, r)

  const ground = new THREE.PlaneGeometry(SPAN, SPAN).rotateX(-Math.PI / 2).translate(lot.cx, YARD_TOP, lot.cz)
  bin.mesh([ground], new THREE.MeshStandardMaterial({ map: bin.keep(paintLot(lot, r)), roughness: 1, fog: false }), { receive: true, name: 'pixel lot' })

  const solid: THREE.BufferGeometry[] = []
  const wood = hex('#7c5444'), woodDark = hex('#5a3a3a')
  for (const t of lot.trees) {
    const y = YARD_TOP, s = t.s
    solid.push(facets(new THREE.BoxGeometry(0.22 * s, 1.0 * s, 0.22 * s).translate(t.x, y + 0.5 * s, t.z), wood, wood, woodDark))
    if (t.pine) {
      for (const [k, ry, rad] of [[0, 1.0, 0.8], [1, 1.6, 0.62], [2, 2.15, 0.42]] as const) {
        const cone = new THREE.ConeGeometry(rad * s, 0.9 * s, 6).rotateY(k * 0.5).translate(t.x, y + ry * s, t.z)
        solid.push(facets(cone, hex('#3e6a34'), hex('#2e5a3a'), hex('#24402e')))
      }
    } else {
      const crown = new THREE.IcosahedronGeometry(0.85 * s, 1).scale(1, 0.85, 1).rotateY(r() * 3).translate(t.x, y + 1.55 * s, t.z)
      solid.push(facets(crown, hex('#6a9a3a'), hex('#3e6a34'), hex('#2e5a3a')))
      const cap = new THREE.IcosahedronGeometry(0.5 * s, 1).rotateY(r() * 3).translate(t.x - 0.15 * s, y + 2.1 * s, t.z - 0.1 * s)
      solid.push(facets(cap, hex('#a6c858'), hex('#6a9a3a'), hex('#3e6a34')))
    }
  }
  for (const b of lot.bushes) {
    const g = new THREE.IcosahedronGeometry(0.42 * b.s, 0).scale(1.25, 0.8, 1.1).rotateY(r() * 3).translate(b.x, YARD_TOP + 0.28 * b.s, b.z)
    solid.push(facets(g, hex('#6a9a3a'), hex('#3e6a34'), hex('#2e5a3a')))
  }
  // The fence: posts every metre and two rails, back and sides only; the front is open.
  const post = hex('#dfba86'), rail = hex('#cc9e6c'), under = hex('#a07050')
  const run = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.0))
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n
      solid.push(facets(new THREE.BoxGeometry(0.1, 0.55, 0.1).translate(x, YARD_TOP + 0.275, z), post, post, under))
    }
    const along = Math.abs(bx - ax) > Math.abs(bz - az)
    for (const y of [0.2, 0.42]) solid.push(facets(new THREE.BoxGeometry(along ? len : 0.05, 0.06, along ? 0.05 : len).translate((ax + bx) / 2, YARD_TOP + y, (az + bz) / 2), rail, rail, under))
  }
  run(lot.fx0, lot.fz0, lot.fx1, lot.fz0)
  run(lot.fx0, lot.fz0, lot.fx0, lot.fz1)
  run(lot.fx1, lot.fz0, lot.fx1, lot.fz1)
  bin.mesh(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false }), { name: 'pixel trees and fence' })

  // The pixel sky behind the tree line, for the seated window.
  const sky = bin.mesh([new THREE.PlaneGeometry(64, 24).translate(lot.cx - 6, YARD_TOP + 9, lot.fz0 - 18)], new THREE.MeshBasicMaterial({ map: bin.keep(paintSky(r)), fog: false }), { name: 'pixel sky' })
  sky.userData.seatOnly = true
  return bin.world()
}
