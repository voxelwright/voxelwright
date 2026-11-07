// Comic's world (#50): the house stands in one panel of a printed page. The panel is a flat
// inked street (pavement, a road with dashes, fine Ben-Day dots) inside a border; quieter
// neighbouring panels lie on the page round it; a row of flat-coloured houses, lollipop
// trees and lamp posts stand inside the panel. Outside is printed lighter than the room:
// paler fills, small low-contrast dots and a soft plum line instead of black ink, so the
// kitchen stays the subject. The seated window looks at the same street, printed at depth
// on a card hung in front of the house row.
import * as THREE from 'three/webgpu'
import { canvas, rng, toTexture } from '../../paint'
import { YARD_TOP } from '../../diorama'
import type { House, World } from './index'
import { Bin, behindCard, cellBox, seatCard, tint } from './build'

/** Outside's line: a soft plum, lighter than the room's ink stage (#22161c). */
const LINE = '#6e5664'
const FAR_LINE = '#9a8896'
const PAPER = '#fbf1dc'
const GROUND = YARD_TOP
const PAGE = YARD_TOP - 0.16
const MARGIN = 2.6 // panel edge from the house's walls
const BACK = 8 // the panel reaches further behind the house, for the street and its houses
const GUTTER = 0.7
const BORDER = 0.14
const PX_PER_M = 48
/** House fronts, printed a step paler than the room's colours. */
const FLAT = ['#e07a62', '#6fb3ac', '#eabf6a', '#a994cf', '#7fb0dc', '#e996b0']

/** Ben-Day dots over a rectangle: a grid of round dots, `size` 0 to 1 of the pitch. */
function dots(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string, pitch: number, size: (u: number, v: number) => number) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.fillStyle = colour
  for (let j = 0, py = y; py < y + h + pitch; j++, py += pitch * 0.866) for (let px = x + (j % 2) * pitch / 2; px < x + w + pitch; px += pitch) {
    const r = size((px - x) / w, (py - y) / h) * pitch * 0.5
    if (r <= 0.3) continue
    g.beginPath()
    g.arc(px, py, r, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

/** The street inside the house's panel, top of the canvas at the panel's back edge. */
function paintStreet(w: number, d: number, road: [number, number]) {
  const W = Math.round(w * PX_PER_M), D = Math.round(d * PX_PER_M), m = PX_PER_M
  const [c, g] = canvas(W, D)
  g.fillStyle = '#f6e0a8' // pavement
  g.fillRect(0, 0, W, D)
  g.strokeStyle = LINE
  g.lineWidth = 2
  g.globalAlpha = 0.12
  for (let x = 0; x < W; x += m * 1.2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, D); g.stroke() }
  for (let y = 0; y < D; y += m * 1.2) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  g.globalAlpha = 1
  dots(g, 0, 0, W, D, '#efcf8e', 7, (u, v) => 0.22 + 0.1 * Math.sin(u * 7 + v * 5))
  // The road: flat lavender, fine dots darkening towards the far kerb, white dashes, kerbs.
  const [r0, r1] = road.map((z) => z * m)
  g.fillStyle = '#bab6de'
  g.fillRect(0, r0, W, r1 - r0)
  dots(g, 0, r0, W, r1 - r0, '#a29ed0', 7, (_u, v) => 0.5 - v * 0.3)
  g.fillStyle = '#ffffff'
  for (let x = m * 0.4; x < W; x += m * 2.4) {
    g.fillRect(x, (r0 + r1) / 2 - 5, m * 1.2, 10)
    g.strokeRect(x, (r0 + r1) / 2 - 5, m * 1.2, 10)
  }
  g.lineWidth = 4
  for (const y of [r0, r1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  g.lineWidth = 2
  g.fillStyle = '#9894c4'
  g.beginPath(); g.ellipse(W * 0.62, (r0 + r1) / 2 + m * 0.9, 24, 18, 0, 0, Math.PI * 2); g.fill(); g.stroke()
  return toTexture(c)
}

/** Neighbouring panels in one atlas (2 by 2), pale and quiet: the page round the house's panel. */
function paintPanels() {
  const S = 1024, H = S / 2
  const [c, g] = canvas(S, S)
  g.lineJoin = g.lineCap = 'round'
  g.strokeStyle = LINE
  const cell = (i: number) => [(i % 2) * H, Math.floor(i / 2) * H] as const
  // 0: sky with a speech balloon (no words: three squiggles).
  {
    const [x, y] = cell(0)
    g.fillStyle = '#b8e0f2'; g.fillRect(x, y, H, H)
    dots(g, x, y, H, H, '#98cae6', 8, (_u, v) => 0.6 - v * 0.5)
    g.fillStyle = '#ffffff'; g.lineWidth = 5
    g.beginPath(); g.ellipse(x + H * 0.5, y + H * 0.42, H * 0.34, H * 0.22, 0, 0, Math.PI * 2); g.fill(); g.stroke()
    g.beginPath(); g.moveTo(x + H * 0.42, y + H * 0.6); g.lineTo(x + H * 0.32, y + H * 0.82); g.lineTo(x + H * 0.54, y + H * 0.62); g.fill(); g.stroke()
    g.lineWidth = 4
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      const yy = y + H * (0.34 + i * 0.08)
      g.moveTo(x + H * 0.3, yy)
      for (let k = 1; k <= 8; k++) g.lineTo(x + H * (0.3 + k * 0.05), yy + (k % 2 ? -6 : 6))
      g.stroke()
    }
  }
  // 1: a soft sunburst in cream and apricot.
  {
    const [x, y] = cell(1)
    g.fillStyle = '#f8e4a8'; g.fillRect(x, y, H, H)
    g.fillStyle = '#f4d08e'
    for (let i = 0; i < 16; i += 2) {
      const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2
      g.beginPath(); g.moveTo(x + H / 2, y + H / 2); g.lineTo(x + H / 2 + Math.cos(a0) * H, y + H / 2 + Math.sin(a0) * H); g.lineTo(x + H / 2 + Math.cos(a1) * H, y + H / 2 + Math.sin(a1) * H); g.fill()
    }
    dots(g, x, y, H, H, '#eab27a', 8, (u, v) => Math.hypot(u - 0.5, v - 0.5) * 0.6)
  }
  // 2: a city skyline at dusk, flat silhouettes.
  {
    const [x, y] = cell(2)
    g.fillStyle = '#f4c6d2'; g.fillRect(x, y, H, H)
    dots(g, x, y, H, H, '#e4a2b8', 8, (_u, v) => v * 0.55)
    const r = rng(5)
    g.fillStyle = '#8a7cb4'; g.lineWidth = 4
    for (let bx = x; bx < x + H; ) {
      const bw = 40 + r() * 70, bh = H * (0.25 + r() * 0.45)
      g.fillRect(bx, y + H - bh, bw, bh); g.strokeRect(bx, y + H - bh, bw, bh)
      g.fillStyle = '#f6e6a0'
      for (let wy = y + H - bh + 16; wy < y + H - 20; wy += 26) for (let wx = bx + 10; wx < bx + bw - 14; wx += 20) if (r() < 0.35) g.fillRect(wx, wy, 9, 12)
      g.fillStyle = '#8a7cb4'
      bx += bw + 4
    }
  }
  // 3: a quiet mint panel, dots thinning out.
  {
    const [x, y] = cell(3)
    g.fillStyle = '#d4ecdc'; g.fillRect(x, y, H, H)
    dots(g, x, y, H, H, '#b6dcc4', 8, (u) => 0.15 + u * 0.3)
  }
  return toTexture(c)
}

/** Flat house fronts: white walls (the vertex colour tints them) with lined windows and a door. */
function paintFacade() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256)
  g.strokeStyle = LINE; g.lineWidth = 5
  for (const [x, y] of [[40, 40], [148, 40], [40, 148], [148, 148]]) {
    g.fillStyle = '#56609a'; g.fillRect(x, y, 68, 72); g.strokeRect(x, y, 68, 72)
    g.fillStyle = '#cbe8fb'; g.fillRect(x + 8, y + 8, 16, 40)
    g.beginPath(); g.moveTo(x + 34, y); g.lineTo(x + 34, y + 72); g.stroke()
  }
  return toTexture(c)
}

/**
 * The street the seated window sees, printed at depth on a card laid out like the garden it
 * replaces (the window shows x 0.41 to 0.62, y 0.31 to 0.65): a dotted sky, a pale far row,
 * the near row of flat-coloured houses across the road, a tree and a lamp, the road and
 * the near pavement. Line weight and contrast fall with distance.
 */
function paintView() {
  const W = 2048, H = 1024
  const r = rng(31)
  const [c, g] = canvas(W, H)
  g.lineJoin = g.lineCap = 'round'
  // Sky: cream at the horizon to soft cyan, fine dots thickening upwards, two small clouds.
  const sky = g.createLinearGradient(0, 0, 0, H * 0.55)
  sky.addColorStop(0, '#9fd2ec')
  sky.addColorStop(1, '#e8f2e8')
  g.fillStyle = sky; g.fillRect(0, 0, W, H)
  dots(g, 0, 0, W, H * 0.5, '#86c2e2', 12, (_u, v) => 0.5 - v * 0.3)
  g.strokeStyle = FAR_LINE; g.lineWidth = 3; g.fillStyle = '#ffffff'
  for (const [cx, cy, s] of [[W * 0.52, H * 0.25, 0.5], [W * 0.25, H * 0.3, 1]] as const) {
    g.beginPath()
    for (const [dx, dy, rr] of [[-60, 10, 34], [-20, -10, 44], [30, -4, 40], [66, 12, 30]] as const) {
      g.moveTo(cx + (dx + rr) * s, cy + dy * s)
      g.arc(cx + dx * s, cy + dy * s, rr * s, 0, Math.PI * 2)
    }
    g.fill(); g.stroke()
  }
  // The far row: pale roofs and gables, thin light lines.
  const far = H * 0.475
  for (let x = -20; x < W;) {
    const w = 50 + r() * 60, h = 26 + r() * 34
    g.fillStyle = r() < 0.5 ? '#d6cfe6' : '#e2d6e0'
    g.beginPath()
    g.moveTo(x, far); g.lineTo(x, far - h)
    if (r() < 0.6) g.lineTo(x + w / 2, far - h - 16 - r() * 12)
    g.lineTo(x + w, far - h); g.lineTo(x + w, far); g.closePath()
    g.fill(); g.lineWidth = 2; g.strokeStyle = FAR_LINE; g.stroke()
    g.fillStyle = '#bfb6d8'
    for (let k = 0; k < 2; k++) g.fillRect(x + w * (0.2 + k * 0.4), far - h * 0.7, w * 0.18, h * 0.25)
    x += w + 4
  }
  // The near row across the road.
  const base = H * 0.54
  for (let x = -30; x < W;) {
    const w = 96 + r() * 70, h = 64 + r() * 36
    const fill = FLAT[Math.floor(r() * FLAT.length)]
    g.fillStyle = fill
    g.strokeStyle = LINE; g.lineWidth = 4
    g.beginPath()
    g.moveTo(x, base); g.lineTo(x, base - h)
    const gable = r() < 0.55
    if (gable) g.lineTo(x + w / 2, base - h - 30)
    g.lineTo(x + w, base - h); g.lineTo(x + w, base); g.closePath()
    g.fill(); g.stroke()
    // Roof: a dark band on flat roofs, a darker gable edge on pitched ones.
    g.fillStyle = '#5c4654'
    if (gable) {
      g.beginPath(); g.moveTo(x - 6, base - h + 3); g.lineTo(x + w / 2, base - h - 34); g.lineTo(x + w + 6, base - h + 3); g.lineTo(x + w + 6, base - h - 4); g.lineTo(x + w / 2, base - h - 41); g.lineTo(x - 6, base - h - 4); g.closePath(); g.fill()
    } else g.fillRect(x - 5, base - h - 8, w + 10, 9)
    // Windows, a door, and the shade side in dots.
    g.lineWidth = 3
    const cols = Math.max(2, Math.floor(w / 46))
    for (let k = 0; k < cols; k++) for (let j = 0; j < 2; j++) {
      const wx = x + 12 + k * ((w - 24) / cols), wy = base - h + 12 + j * (h * 0.44)
      if (j === 1 && k === 0) continue
      g.fillStyle = '#56609a'; g.fillRect(wx, wy, 20, 24); g.strokeRect(wx, wy, 20, 24)
      g.fillStyle = '#cbe8fb'; g.fillRect(wx + 3, wy + 3, 5, 13)
    }
    g.fillStyle = '#7a5a4a'; g.fillRect(x + 12, base - 38, 18, 38); g.strokeRect(x + 12, base - 38, 18, 38)
    dots(g, x + w * 0.78, base - h, w * 0.22, h, 'rgba(70,40,70,0.2)', 6, () => 0.5)
    x += w + 12 + r() * 14
  }
  // Pavement, road and the near pavement, fine dots thickening towards the viewer.
  g.fillStyle = '#f6e0a8'; g.fillRect(0, base, W, H * 0.02)
  const r0 = base + H * 0.02, r1 = H * 0.63
  g.fillStyle = '#bab6de'; g.fillRect(0, r0, W, r1 - r0)
  dots(g, 0, r0, W, r1 - r0, '#a29ed0', 9, (_u, v) => 0.25 + v * 0.3)
  g.fillStyle = '#ffffff'; g.strokeStyle = LINE; g.lineWidth = 2
  for (let x = 30; x < W; x += 150) { g.fillRect(x, (r0 + r1) / 2 - 3, 70, 6); g.strokeRect(x, (r0 + r1) / 2 - 3, 70, 6) }
  g.lineWidth = 4
  for (const y of [r0, r1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  g.fillStyle = '#f6e0a8'; g.fillRect(0, r1, W, H - r1)
  dots(g, 0, r1, W, H - r1, '#efcf8e', 10, (_u, v) => 0.25 + v * 0.3)
  // A lollipop tree and a lamp post on the far pavement, inside the window's band.
  const tree = (x: number, s: number) => {
    g.strokeStyle = LINE; g.lineWidth = 4
    const y = base + 10 * s
    g.fillStyle = '#9a6a4a'; g.fillRect(x - 6 * s, y - 90 * s, 12 * s, 92 * s); g.strokeRect(x - 6 * s, y - 90 * s, 12 * s, 92 * s)
    g.fillStyle = '#7cbf74'; g.beginPath(); g.arc(x, y - 122 * s, 50 * s, 0, Math.PI * 2); g.fill(); g.stroke()
    dots(g, x - 8 * s, y - 172 * s, 58 * s, 100 * s, 'rgba(40,90,50,0.25)', 6, () => 0.5)
  }
  const post = (x: number) => {
    g.strokeStyle = LINE; g.lineWidth = 4
    g.fillStyle = '#5a5a7a'; g.fillRect(x - 4, base - 150, 8, 160); g.strokeRect(x - 4, base - 150, 8, 160)
    g.fillStyle = '#ffe48a'; g.beginPath(); g.arc(x, base - 156, 13, 0, Math.PI * 2); g.fill(); g.stroke()
  }
  tree(W * 0.445, 0.9)
  tree(W * 0.3, 0.8)
  tree(W * 0.75, 1)
  post(W * 0.6)
  post(W * 0.2)
  return toTexture(c)
}

export function comicPage(house: House): World {
  const bin = new Bin()
  const r = rng(23)
  const { x0, x1, z0, z1 } = house
  const px0 = x0 - MARGIN, px1 = x1 + MARGIN, pz0 = z0 - BACK, pz1 = z1 + MARGIN
  const ink = new THREE.MeshStandardMaterial({ color: LINE, roughness: 1, fog: false })

  // The page itself, under everything.
  bin.mesh([new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2).translate((px0 + px1) / 2, PAGE, (pz0 + pz1) / 2)], new THREE.MeshStandardMaterial({ color: PAPER, roughness: 1, fog: false }), { receive: true, name: 'comic page' })

  /** A raised panel slab whose top shows `uv` (u0, v0, u1, v1) of its texture, back edge at the top. */
  const panel = (ax: number, bx: number, az: number, bz: number, top: number, uv: [number, number, number, number]) => {
    const g = new THREE.BoxGeometry(bx - ax, top - PAGE, bz - az).translate((ax + bx) / 2, (PAGE + top) / 2, (az + bz) / 2)
    const p = g.attributes.position, t = g.attributes.uv
    for (let i = 0; i < p.count; i++) t.setXY(i, uv[0] + ((p.getX(i) - ax) / (bx - ax)) * (uv[2] - uv[0]), uv[3] - ((p.getZ(i) - az) / (bz - az)) * (uv[3] - uv[1]))
    return g
  }
  /** The border round a panel. */
  const frames: THREE.BufferGeometry[] = []
  const frame = (ax: number, bx: number, az: number, bz: number, top: number) => {
    const y = (PAGE + top + 0.05) / 2, h = top + 0.05 - PAGE
    frames.push(new THREE.BoxGeometry(bx - ax + BORDER, h, BORDER).translate((ax + bx) / 2, y, az))
    frames.push(new THREE.BoxGeometry(bx - ax + BORDER, h, BORDER).translate((ax + bx) / 2, y, bz))
    frames.push(new THREE.BoxGeometry(BORDER, h, bz - az).translate(ax, y, (az + bz) / 2))
    frames.push(new THREE.BoxGeometry(BORDER, h, bz - az).translate(bx, y, (az + bz) / 2))
  }

  // The house's panel: the street. The road runs behind the house, across the whole panel.
  const road: [number, number] = [BACK - 4.9, BACK - 1.7] // metres from the panel's back edge
  const street = bin.keep(paintStreet(px1 - px0, pz1 - pz0, road))
  bin.mesh([panel(px0, px1, pz0, pz1, GROUND, [0, 0, 1, 1])], new THREE.MeshStandardMaterial({ map: street, roughness: 1, fog: false }), { receive: true, name: 'comic street panel' })
  frame(px0, px1, pz0, pz1, GROUND)

  // Neighbouring panels across the gutters, a little lower, from the atlas. The busier ones
  // lie behind and to the left, where the dollhouse view sees past the walls; the front stays quiet.
  const q = (i: number): [number, number, number, number] => [(i % 2) * 0.5, 0.5 - Math.floor(i / 2) * 0.5, (i % 2) * 0.5 + 0.5, 1 - Math.floor(i / 2) * 0.5]
  const low = PAGE + 0.05
  const L = px0 - GUTTER, R = px1 + GUTTER, B = pz0 - GUTTER, F = pz1 + GUTTER
  const others: Array<[number, number, number, number, number]> = [
    [L - 9, L, pz0, (pz0 + pz1) / 2 - GUTTER / 2, 2], // left, back half: skyline
    [L - 9, L, (pz0 + pz1) / 2 + GUTTER / 2, F + 8, 3], // left, front half: quiet
    [L - 9, (px0 + px1) / 2 - GUTTER / 2, B - 9, B, 0], // back left: sky and balloon, mostly under the houses
    [(px0 + px1) / 2 + GUTTER / 2, R + 9, B - 9, B, 3], // back right: quiet
    [R, R + 9, pz0, F + 8, 3], // right: quiet
    [px0, R, F, F + 8, 3], // front: quiet
  ]
  bin.mesh(others.map(([a, b, c, d, i]) => panel(a, b, c, d, low, q(i))), new THREE.MeshStandardMaterial({ map: bin.keep(paintPanels()), roughness: 1, fog: false }), { receive: true, name: 'comic panels' })
  for (const [a, b, c, d] of others) frame(a, b, c, d, low)
  bin.mesh(frames, ink, { name: 'comic panel borders' })

  // Flat-coloured houses across the road, facing the house, behind the seat card.
  const fronts: THREE.BufferGeometry[] = []
  const line = behindCard(house, pz0 + road[0] - 0.9, 0.2)
  for (let at = px0 + 0.3; at < px1 - 1.5;) {
    const w = 2.2 + r() * 1.6, h = 1.7 + r() * 1.1, d = Math.min(1.6, line - pz0 - 0.1)
    const col = new THREE.Color(FLAT[Math.floor(r() * FLAT.length)])
    // The front maps the facade once (u 0 to 1 across its width); sides repeat it.
    fronts.push(tint(cellBox(w, h, d, at + w / 2, GROUND, line - d / 2, [w, h], [-at / w, -GROUND / h], [0.01, 0.01]), col.r, col.g, col.b))
    // A flat roof slab in plum, so each house has a crisp top edge.
    fronts.push(tint(cellBox(w + 0.12, 0.14, d + 0.12, at + w / 2, GROUND + h, line - d / 2, [1, 1]), 0.3, 0.2, 0.26))
    at += w + 0.25
  }
  // Unlit: printed flat fills, so the low sun behind them never shades their fronts into dots.
  const facade = bin.keep(paintFacade())
  facade.wrapS = facade.wrapT = THREE.RepeatWrapping
  bin.mesh(fronts, new THREE.MeshBasicMaterial({ map: facade, vertexColors: true, fog: false }), { name: 'comic houses' })

  // Lollipop trees, lamp posts and a hydrant, flat colours for the ink to draw round.
  const props: THREE.BufferGeometry[] = []
  const add = (made: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex)
    const g = made.index ? made.toNonIndexed() : made
    if (g !== made) made.dispose()
    g.deleteAttribute('uv')
    props.push(tint(g, c.r, c.g, c.b))
  }
  const tree = (x: number, z: number, s: number) => {
    add(new THREE.CylinderGeometry(0.08 * s, 0.11 * s, 1.6 * s, 8).translate(x, GROUND + 0.8 * s, z), '#9a6a4a')
    add(new THREE.IcosahedronGeometry(0.75 * s, 1).translate(x, GROUND + 1.9 * s, z), '#7cbf74')
  }
  const post = (x: number, z: number) => {
    add(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 8).translate(x, GROUND + 1.55, z), '#5a5a7a')
    add(new THREE.SphereGeometry(0.2, 12, 8).translate(x, GROUND + 3.2, z), '#ffe48a')
  }
  tree(x0 - 1.4, z1 - 0.8, 1)
  tree(x0 - 1.3, z0 + 1.2, 0.85)
  tree(x1 + 1.3, z0 - 0.6, 0.9)
  post(x0 - 1.2, (z0 + z1) / 2 + 0.6)
  post(x1 + 1.0, z0 + 0.2)
  post((x0 + x1) / 2 - 1, pz0 + road[1] + 0.4)
  add(new THREE.CylinderGeometry(0.12, 0.14, 0.45, 10).translate(x0 - 1.0, GROUND + 0.22, z0 - 0.6), '#e07a62')
  // No cast shadows: the low sun drew long grey bars across the front of the page.
  bin.mesh(props, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false }), { name: 'comic street props' })

  seatCard(bin, house, paintView())
  return bin.world()
}
