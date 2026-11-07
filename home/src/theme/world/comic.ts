// Comic's world (regroup S1): the house stands in one panel of a printed page. The panel is
// a flat inked street (pavement, a road with dashes, Ben-Day dot shading) behind a bold ink
// border; neighbouring panels lie on the page round it with their own flat fills and dots; a
// row of simple flat-coloured houses, lollipop trees and lamp posts stand inside the panel,
// and the seated window looks out at them under a flat halftone sky card.
import * as THREE from 'three/webgpu'
import { canvas, rng, toTexture } from '../../paint'
import { YARD_TOP } from '../../diorama'
import type { House, World } from './index'
import { Bin, cellBox, tint } from './build'

const INK = '#22161c'
const PAPER = '#fbf1dc'
const GROUND = YARD_TOP
const PAGE = YARD_TOP - 0.16
const MARGIN = 2.6 // panel edge from the house's walls
const BACK = 8 // the panel reaches further behind the house, for the street and its houses
const GUTTER = 0.7
const BORDER = 0.22
const PX_PER_M = 48

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
function paintStreet(w: number, d: number, road: [number, number], seed: number) {
  const r = rng(seed)
  const W = Math.round(w * PX_PER_M), D = Math.round(d * PX_PER_M), m = PX_PER_M
  const [c, g] = canvas(W, D)
  g.fillStyle = '#f6dc98' // pavement
  g.fillRect(0, 0, W, D)
  g.strokeStyle = INK
  g.lineWidth = 2
  for (let x = 0; x < W; x += m * 1.2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, D); g.globalAlpha = 0.25; g.stroke() }
  for (let y = 0; y < D; y += m * 1.2) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  g.globalAlpha = 1
  dots(g, 0, 0, W, D, '#e2a85a', 9, (u, v) => 0.25 + 0.2 * Math.sin(u * 7 + v * 5))
  // The road: flat lavender, dots darkening towards the far kerb, white dashes, inked kerbs.
  const [r0, r1] = road.map((z) => z * m)
  g.fillStyle = '#a9a6d6'
  g.fillRect(0, r0, W, r1 - r0)
  dots(g, 0, r0, W, r1 - r0, '#6c68a8', 10, (_u, v) => 0.65 - v * 0.45)
  g.fillStyle = '#ffffff'
  for (let x = m * 0.4; x < W; x += m * 2.4) {
    g.fillRect(x, (r0 + r1) / 2 - 5, m * 1.2, 10)
    g.strokeRect(x, (r0 + r1) / 2 - 5, m * 1.2, 10)
  }
  g.lineWidth = 6
  for (const y of [r0, r1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  // A few inked cracks and a manhole, so the street reads as drawn.
  g.lineWidth = 3
  for (let i = 0; i < 8; i++) {
    const x = r() * W, y = r() * D
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + 10 + r() * 20); g.lineTo(x + (r() - 0.5) * 50, y + 30 + r() * 20); g.stroke()
  }
  g.fillStyle = '#7a76a8'
  g.beginPath(); g.ellipse(W * 0.62, (r0 + r1) / 2 + m * 0.9, 26, 20, 0, 0, Math.PI * 2); g.fill(); g.stroke()
  return toTexture(c)
}

/** Four neighbouring panels in one atlas (2 by 2): flat fills, dots, and simple graphic marks. */
function paintPanels() {
  const S = 1024, H = S / 2
  const [c, g] = canvas(S, S)
  g.lineJoin = g.lineCap = 'round'
  g.strokeStyle = INK
  const cell = (i: number) => [(i % 2) * H, Math.floor(i / 2) * H] as const
  // 0: sky with a speech balloon (no words: three inked squiggles).
  {
    const [x, y] = cell(0)
    g.fillStyle = '#86cdf2'; g.fillRect(x, y, H, H)
    dots(g, x, y, H, H, '#4a9ad8', 14, (_u, v) => 0.8 - v * 0.7)
    g.fillStyle = '#ffffff'; g.lineWidth = 7
    g.beginPath(); g.ellipse(x + H * 0.5, y + H * 0.42, H * 0.34, H * 0.22, 0, 0, Math.PI * 2); g.fill(); g.stroke()
    g.beginPath(); g.moveTo(x + H * 0.42, y + H * 0.6); g.lineTo(x + H * 0.32, y + H * 0.82); g.lineTo(x + H * 0.54, y + H * 0.62); g.fill(); g.stroke()
    g.lineWidth = 6
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      const yy = y + H * (0.34 + i * 0.08)
      g.moveTo(x + H * 0.3, yy)
      for (let k = 1; k <= 8; k++) g.lineTo(x + H * (0.3 + k * 0.05), yy + (k % 2 ? -8 : 8))
      g.stroke()
    }
  }
  // 1: a sunburst in yellow and orange.
  {
    const [x, y] = cell(1)
    g.fillStyle = '#ffd23f'; g.fillRect(x, y, H, H)
    g.fillStyle = '#ff9a3c'
    for (let i = 0; i < 16; i += 2) {
      const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2
      g.beginPath(); g.moveTo(x + H / 2, y + H / 2); g.lineTo(x + H / 2 + Math.cos(a0) * H, y + H / 2 + Math.sin(a0) * H); g.lineTo(x + H / 2 + Math.cos(a1) * H, y + H / 2 + Math.sin(a1) * H); g.fill()
    }
    dots(g, x, y, H, H, '#e0602a', 12, (u, v) => Math.hypot(u - 0.5, v - 0.5) * 0.9)
    g.fillStyle = '#ffffff'; g.lineWidth = 8
    g.beginPath()
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2, rr = (i % 2 ? 0.16 : 0.3) * H
      g.lineTo(x + H / 2 + Math.cos(a) * rr, y + H / 2 + Math.sin(a) * rr)
    }
    g.fill(); g.stroke()
  }
  // 2: a city skyline at dusk, flat silhouettes.
  {
    const [x, y] = cell(2)
    g.fillStyle = '#f48aa8'; g.fillRect(x, y, H, H)
    dots(g, x, y, H, H, '#c8507a', 13, (_u, v) => v * 0.8)
    const r = rng(5)
    g.fillStyle = '#4a3a78'; g.lineWidth = 6
    for (let bx = x; bx < x + H; ) {
      const bw = 40 + r() * 70, bh = H * (0.25 + r() * 0.45)
      g.fillRect(bx, y + H - bh, bw, bh); g.strokeRect(bx, y + H - bh, bw, bh)
      g.fillStyle = '#ffe680'
      for (let wy = y + H - bh + 16; wy < y + H - 20; wy += 26) for (let wx = bx + 10; wx < bx + bw - 14; wx += 20) if (r() < 0.45) g.fillRect(wx, wy, 9, 12)
      g.fillStyle = '#4a3a78'
      bx += bw + 4
    }
  }
  // 3: speed lines on mint.
  {
    const [x, y] = cell(3)
    g.fillStyle = '#9fe0c0'; g.fillRect(x, y, H, H)
    dots(g, x, y, H, H, '#4fb08a', 12, (u) => 0.2 + u * 0.5)
    g.lineWidth = 5
    const r = rng(9)
    for (let i = 0; i < 26; i++) {
      const yy = y + r() * H
      g.beginPath(); g.moveTo(x + r() * H * 0.3, yy); g.lineTo(x + H * (0.6 + r() * 0.4), yy); g.stroke()
    }
  }
  return toTexture(c)
}

/** Flat house fronts: white walls (the vertex colour tints them) with inked windows and a door. */
function paintFacade() {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256)
  g.strokeStyle = INK; g.lineWidth = 6
  for (const [x, y] of [[40, 40], [148, 40], [40, 148], [148, 148]]) {
    g.fillStyle = '#3c4a8a'; g.fillRect(x, y, 68, 72); g.strokeRect(x, y, 68, 72)
    g.fillStyle = '#bfe4ff'; g.fillRect(x + 8, y + 8, 16, 40)
    g.beginPath(); g.moveTo(x + 34, y); g.lineTo(x + 34, y + 72); g.stroke()
  }
  return toTexture(c)
}

export function comicPage(house: House): World {
  const bin = new Bin()
  const r = rng(23)
  const { x0, x1, z0, z1 } = house
  const px0 = x0 - MARGIN, px1 = x1 + MARGIN, pz0 = z0 - BACK, pz1 = z1 + MARGIN
  const ink = new THREE.MeshStandardMaterial({ color: INK, roughness: 1, fog: false })

  // The page itself, under everything.
  bin.mesh([new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2).translate((px0 + px1) / 2, PAGE, (pz0 + pz1) / 2)], new THREE.MeshStandardMaterial({ color: PAPER, roughness: 1, fog: false }), { receive: true, name: 'comic page' })

  /** A raised panel slab whose top shows `uv` (u0, v0, u1, v1) of its texture, back edge at the top. */
  const panel = (ax: number, bx: number, az: number, bz: number, top: number, uv: [number, number, number, number]) => {
    const g = new THREE.BoxGeometry(bx - ax, top - PAGE, bz - az).translate((ax + bx) / 2, (PAGE + top) / 2, (az + bz) / 2)
    const p = g.attributes.position, t = g.attributes.uv
    for (let i = 0; i < p.count; i++) t.setXY(i, uv[0] + ((p.getX(i) - ax) / (bx - ax)) * (uv[2] - uv[0]), uv[3] - ((p.getZ(i) - az) / (bz - az)) * (uv[3] - uv[1]))
    return g
  }
  /** The bold ink border round a panel. */
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
  const street = bin.keep(paintStreet(px1 - px0, pz1 - pz0, road, 3))
  bin.mesh([panel(px0, px1, pz0, pz1, GROUND, [0, 0, 1, 1])], new THREE.MeshStandardMaterial({ map: street, roughness: 1, fog: false }), { receive: true, name: 'comic street panel' })
  frame(px0, px1, pz0, pz1, GROUND)

  // Neighbouring panels across the gutters, a little lower, from the atlas.
  const q = (i: number): [number, number, number, number] => [(i % 2) * 0.5, 0.5 - Math.floor(i / 2) * 0.5, (i % 2) * 0.5 + 0.5, 1 - Math.floor(i / 2) * 0.5]
  const low = PAGE + 0.05
  const L = px0 - GUTTER, R = px1 + GUTTER, B = pz0 - GUTTER, F = pz1 + GUTTER
  const others: Array<[number, number, number, number, number]> = [
    [L - 9, L, pz0, (pz0 + pz1) / 2 - GUTTER / 2, 0], // left, back half: sky and balloon
    [L - 9, L, (pz0 + pz1) / 2 + GUTTER / 2, F + 8, 3], // left, front half: speed lines
    [L - 9, (px0 + px1) / 2 - GUTTER / 2, B - 9, B, 2], // back left: skyline
    [(px0 + px1) / 2 + GUTTER / 2, R + 9, B - 9, B, 1], // back right: sunburst
    [R, R + 9, pz0, F + 8, 0],
    [px0, R, F, F + 8, 1],
  ]
  bin.mesh(others.map(([a, b, c, d, i]) => panel(a, b, c, d, low, q(i))), new THREE.MeshStandardMaterial({ map: bin.keep(paintPanels()), roughness: 1, fog: false }), { receive: true, name: 'comic panels' })
  for (const [a, b, c, d] of others) frame(a, b, c, d, low)
  bin.mesh(frames, ink, { name: 'comic panel borders' })

  // Flat-coloured houses across the road, facing the house: what the seated window sees.
  const fronts: THREE.BufferGeometry[] = []
  const flat = ['#e8553f', '#3fa7a0', '#f2b134', '#9a7ad0', '#5aa0e0', '#f07aa0']
  const line = pz0 + road[0] - 0.9
  for (let at = px0 + 0.3; at < px1 - 1.5;) {
    const w = 2.2 + r() * 1.6, h = 1.7 + r() * 1.1, d = 1.6
    const col = new THREE.Color(flat[Math.floor(r() * flat.length)])
    fronts.push(tint(cellBox(w, h, d, at + w / 2, GROUND, line - d / 2, [w, h], [0, 0], [0.01, 0.01]), col.r, col.g, col.b))
    // A flat roof slab in ink-dark, so each house has a crisp top edge.
    fronts.push(tint(cellBox(w + 0.12, 0.14, d + 0.12, at + w / 2, GROUND + h, line - d / 2, [1, 1]), 0.16, 0.1, 0.12))
    at += w + 0.25
  }
  // Unlit: printed flat fills, so the low sun behind them never shades their fronts into dots.
  bin.mesh(fronts, new THREE.MeshBasicMaterial({ map: bin.keep(paintFacade()), vertexColors: true, fog: false }), { name: 'comic houses' })

  // Lollipop trees, lamp posts and a hydrant, flat colours for the ink to draw round.
  const props: THREE.BufferGeometry[] = []
  const col = (hex: string) => new THREE.Color(hex)
  const add = (made: THREE.BufferGeometry, hex: string) => {
    const c = col(hex)
    const g = made.index ? made.toNonIndexed() : made
    if (g !== made) made.dispose()
    g.deleteAttribute('uv')
    props.push(tint(g, c.r, c.g, c.b))
  }
  const tree = (x: number, z: number, s: number) => {
    add(new THREE.CylinderGeometry(0.08 * s, 0.11 * s, 1.6 * s, 8).translate(x, GROUND + 0.8 * s, z), '#8a5a3a')
    add(new THREE.IcosahedronGeometry(0.75 * s, 1).translate(x, GROUND + 1.9 * s, z), '#4fbf5a')
  }
  const post = (x: number, z: number) => {
    add(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 8).translate(x, GROUND + 1.55, z), '#3a3a5a')
    add(new THREE.SphereGeometry(0.2, 12, 8).translate(x, GROUND + 3.2, z), '#ffe066')
  }
  tree(x0 - 1.4, z1 - 0.8, 1)
  tree(x0 - 1.3, z0 + 1.2, 0.85)
  tree(x1 + 1.3, z0 - 0.6, 0.9)
  post(x0 - 1.2, (z0 + z1) / 2 + 0.6)
  post(x1 + 1.0, z0 + 0.2)
  post((x0 + x1) / 2 - 1, pz0 + road[1] + 0.4)
  add(new THREE.CylinderGeometry(0.12, 0.14, 0.45, 10).translate(x0 - 1.0, GROUND + 0.22, z0 - 0.6), '#e8452f')
  bin.mesh(props, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false }), { cast: true, name: 'comic street props' })

  // The flat halftone sky the seated window sees, behind the houses. Only the seat shows it.
  const sky = bin.mesh([new THREE.PlaneGeometry(40, 16).translate((px0 + px1) / 2 - 3, GROUND + 8, line - 6)], new THREE.MeshBasicMaterial({ map: bin.keep(paintSky()), fog: false }), { name: 'comic sky' })
  sky.userData.seatOnly = true
  return bin.world()
}

/** A flat cyan sky with dots thickening upwards, a sun and two inked clouds. */
function paintSky() {
  const W = 1024, H = 410
  const [c, g] = canvas(W, H)
  g.fillStyle = '#8fd4f4'; g.fillRect(0, 0, W, H)
  dots(g, 0, 0, W, H, '#5aa8e6', 14, (_u, v) => 0.85 - v * 0.75)
  g.strokeStyle = INK; g.lineWidth = 6
  g.fillStyle = '#ffe066'
  g.beginPath(); g.arc(W * 0.78, H * 0.3, 42, 0, Math.PI * 2); g.fill(); g.stroke()
  g.fillStyle = '#ffffff'
  for (const [cx, cy, s] of [[W * 0.3, H * 0.28, 1], [W * 0.58, H * 0.5, 0.75]] as const) {
    g.beginPath()
    for (const [dx, dy, rr] of [[-60, 10, 40], [-20, -14, 52], [30, -6, 46], [70, 12, 36], [0, 22, 44]] as const) {
      g.moveTo(cx + (dx + rr) * s, cy + dy * s)
      g.arc(cx + dx * s, cy + dy * s, rr * s, 0, Math.PI * 2)
    }
    g.fill()
    g.stroke()
  }
  return toTexture(c)
}
