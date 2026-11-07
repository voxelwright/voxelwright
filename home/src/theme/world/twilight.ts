// Blue hour's world (#50): the house stands on its lawn on a quiet street just after sunset.
// A slate-blue sky all round, a dusk-blue lawn, the street behind with its kerbs, and the
// neighbours' gabled houses across it with a few warm lit windows; dark trees at the left
// and behind, and two warm streetlamps beside the side walls, where the dollhouse camera
// sees them past the walls. The front stays plain lawn. The seated window shows the same street
// painted at depth on a card. Nothing here is a real light: lamp heads and windows glow,
// and the lamps' pools are additive cards. Out of the rooms' fog (dusk is clear, not hazy),
// and nothing out here casts: the sun has set, so no long shadows cross the lawn.
import * as THREE from 'three/webgpu'
import { canvas, makeNoise, rng, toTexture } from '../../paint'
import { YARD_TOP } from '../../diorama'
import type { House, World } from './index'
import { Bin, behindCard, cellBox, flatQuad, glowTexture, seatCard, tint } from './build'

const GROUND = YARD_TOP
const STREET = 2.4 // from the back wall to the far kerb's pavement: pavement, road, pavement
const ROAD: [number, number] = [0.9, 3.6] // the road, metres behind the back wall
const SKY_R = 42
const WARM: [number, number, number] = [2.0, 1.35, 0.7]
const WALLS = ['#6c7290', '#7a7388', '#5f6b84', '#857a86', '#6e7a8a']

/** The sky from below the horizon to the zenith, as a vertical gradient. */
function paintSky() {
  const [c, g] = canvas(8, 512)
  const sky = g.createLinearGradient(0, 0, 0, 512)
  sky.addColorStop(0, '#1b2340')
  sky.addColorStop(0.45, '#33406c')
  sky.addColorStop(0.72, '#6a74a2')
  sky.addColorStop(0.8, '#a090ae')
  sky.addColorStop(0.84, '#3a4660')
  sky.addColorStop(1, '#2a3446')
  g.fillStyle = sky
  g.fillRect(0, 0, 8, 512)
  return toTexture(c)
}

/** Lawn at dusk: blue-green grain with darker clumps. */
function paintLawn(seed: number) {
  const n = makeNoise(seed, 32)
  const [c, g] = canvas(256, 256)
  const img = g.createImageData(256, 256)
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = n(x / 3, y / 3, 2) * 0.6 + n(x / 24, y / 24, 3) * 0.4
    img.data.set([62 + v * 34, 104 + v * 44, 84 + v * 30, 255], (y * 256 + x) * 4)
  }
  g.putImageData(img, 0, 0)
  const t = toTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/**
 * The neighbours' fronts, one bay and storey a cell: a white wall the vertex colour tints,
 * dark glass in light frames; the same layout in `light` holds only the lit windows, warm
 * and soft, about one in three.
 */
function paintFronts(seed: number) {
  const r = rng(seed)
  const [c, g] = canvas(256, 256)
  const [lc, lg] = canvas(256, 256)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256)
  lg.fillStyle = '#000000'; lg.fillRect(0, 0, 256, 256)
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * 64, y = row * 64
    g.fillStyle = '#d8d4cc'; g.fillRect(x + 16, y + 12, 32, 38)
    g.fillStyle = '#26304a'; g.fillRect(x + 19, y + 15, 26, 32)
    if (r() < 0.26) {
      const glow = lg.createLinearGradient(0, y + 15, 0, y + 47)
      glow.addColorStop(0, '#ffc888')
      glow.addColorStop(1, '#c87840')
      lg.fillStyle = glow
      lg.fillRect(x + 19, y + 15, 26, 32)
      if (r() < 0.5) { lg.fillStyle = 'rgba(0,0,0,0.6)'; lg.fillRect(x + 19, y + 15, 26, 10) } // a curtain
    }
    g.fillStyle = '#d8d4cc'; g.fillRect(x + 31, y + 15, 2, 32)
    lg.fillStyle = '#000000'; lg.fillRect(x + 31, y + 15, 2, 32)
  }
  const map = toTexture(c), light = toTexture(lc)
  for (const t of [map, light]) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return { map, light }
}

/** A gabled roof over a box `w` wide (x) and `d` deep (z), its ridge along x. */
function roof(w: number, d: number, rise: number, x: number, y: number, z: number) {
  const s = new THREE.Shape([new THREE.Vector2(-d / 2 - 0.2, 0), new THREE.Vector2(d / 2 + 0.2, 0), new THREE.Vector2(0, rise)])
  return new THREE.ExtrudeGeometry(s, { depth: w + 0.3, bevelEnabled: false }).translate(0, 0, -(w + 0.3) / 2).rotateY(Math.PI / 2).translate(x, y, z)
}

/**
 * The street the seated window sees, painted at depth on a card laid out like the garden it
 * replaces (the window shows x 0.41 to 0.62, y 0.31 to 0.65): the dusk sky with a first star,
 * a far tree line, the neighbours' houses across the road with warm windows, a streetlamp
 * and its pool, a dark tree, and the lawn.
 */
function paintView() {
  const W = 2048, H = 1024
  const r = rng(17)
  const [c, g] = canvas(W, H)
  const sky = g.createLinearGradient(0, 0, 0, H * 0.56)
  sky.addColorStop(0, '#1c2442')
  sky.addColorStop(0.55, '#3a4874')
  sky.addColorStop(0.88, '#7c80a8')
  sky.addColorStop(1, '#b49aac')
  g.fillStyle = sky; g.fillRect(0, 0, W, H)
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(230,236,255,${0.2 + r() * 0.5})`; g.fillRect(r() * W, r() * H * 0.3, 2, 2) }
  g.fillStyle = 'rgba(255,248,230,0.95)'; g.beginPath(); g.arc(W * 0.565, H * 0.34, 3, 0, Math.PI * 2); g.fill() // the first star
  // A far tree line along the horizon.
  g.fillStyle = '#2c3654'
  g.beginPath(); g.moveTo(0, H * 0.56)
  for (let x = 0; x <= W; x += 24) g.lineTo(x, H * (0.5 - 0.02 * Math.sin(x / 70) - r() * 0.02))
  g.lineTo(W, H * 0.56); g.closePath(); g.fill()
  // The houses across the road.
  const base = H * 0.575
  for (let x = -40; x < W;) {
    const w = 200 + r() * 120, h = 110 + r() * 40, rise = 60 + r() * 30
    g.fillStyle = r() < 0.5 ? '#3e4662' : '#454a64'
    g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - h); g.lineTo(x + w / 2, base - h - rise); g.lineTo(x + w, base - h); g.lineTo(x + w, base); g.closePath(); g.fill()
    g.fillStyle = '#262c40'
    g.beginPath(); g.moveTo(x - 10, base - h + 2); g.lineTo(x + w / 2, base - h - rise - 4); g.lineTo(x + w + 10, base - h + 2); g.lineTo(x + w + 10, base - h - 8); g.lineTo(x + w / 2, base - h - rise - 14); g.lineTo(x - 10, base - h - 8); g.closePath(); g.fill()
    for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) {
      const wx = x + 26 + k * (w - 60) / 2.6, wy = base - h + 18 + j * 52
      const lit = r() < 0.38
      if (lit) { g.shadowColor = '#ffb060'; g.shadowBlur = 16 }
      g.fillStyle = lit ? '#ffc47a' : '#252c44'
      g.fillRect(wx, wy, 26, 30)
      g.shadowBlur = 0
    }
    x += w + 40 + r() * 30
  }
  // The street and its far pavement, the lamp's warm pool on it, then the lawn.
  g.fillStyle = '#4a5064'; g.fillRect(0, base, W, H * 0.012)
  g.fillStyle = '#2e3446'; g.fillRect(0, base + H * 0.012, W, H * 0.035)
  const lawn = g.createLinearGradient(0, H * 0.62, 0, H)
  lawn.addColorStop(0, '#34445a'); lawn.addColorStop(1, '#1e2836')
  g.fillStyle = lawn; g.fillRect(0, base + H * 0.047, W, H)
  const lamp = (x: number) => {
    const pool = g.createRadialGradient(x, base + H * 0.03, 0, x, base + H * 0.03, 160)
    pool.addColorStop(0, 'rgba(255,190,110,0.5)'); pool.addColorStop(1, 'rgba(255,190,110,0)')
    g.fillStyle = pool; g.fillRect(x - 170, base - 40, 340, 140)
    g.fillStyle = '#1a1e2c'; g.fillRect(x - 4, base - 200, 8, 206)
    const halo = g.createRadialGradient(x, base - 206, 0, x, base - 206, 70)
    halo.addColorStop(0, 'rgba(255,214,150,0.9)'); halo.addColorStop(0.2, 'rgba(255,190,110,0.35)'); halo.addColorStop(1, 'rgba(255,190,110,0)')
    g.fillStyle = halo; g.fillRect(x - 70, base - 276, 140, 140)
    g.fillStyle = '#fff0d0'; g.fillRect(x - 10, base - 212, 20, 12)
  }
  lamp(W * 0.585)
  lamp(W * 0.2)
  // A dark tree at the left of the window's band.
  g.fillStyle = '#1e2838'
  g.fillRect(W * 0.43 - 8, base - 120, 16, 150)
  for (const [dx, dy, rr] of [[0, -190, 90], [-60, -150, 70], [60, -140, 74], [10, -260, 60]] as const) { g.beginPath(); g.arc(W * 0.43 + dx, base + dy, rr, 0, Math.PI * 2); g.fill() }
  return toTexture(c)
}

export function twilightStreet(house: House): World {
  const bin = new Bin()
  const r = rng(53)
  const { x0, x1, z0, z1 } = house
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2

  // The sky all round, so the dollhouse view never shows the backdrop beyond the lawn.
  const sky = bin.mesh([new THREE.CylinderGeometry(SKY_R, SKY_R, 40, 48, 1, true).translate(cx, 12, cz)], new THREE.MeshBasicMaterial({ map: bin.keep(paintSky()), side: THREE.BackSide, fog: false }), { name: 'twilight sky' })
  sky.renderOrder = -2

  // The lawn, and the street behind the house: pavement, road with kerbs, far pavement.
  const lawnMap = bin.keep(paintLawn(8))
  lawnMap.repeat.set(30, 30)
  bin.mesh([flatQuad(SKY_R * 2, SKY_R * 2, cx, GROUND, cz)], new THREE.MeshStandardMaterial({ color: '#a4b8b8', map: lawnMap, roughness: 1, emissive: '#14222a', fog: false }), { receive: true, name: 'twilight lawn' })
  const far = behindCard(house, z0 - ROAD[1] - STREET + 0.4, 0.3) // the neighbours' front line
  const ground: THREE.BufferGeometry[] = []
  ground.push(tint(flatQuad(80, ROAD[1] - ROAD[0], cx, GROUND + 0.004, z0 - (ROAD[0] + ROAD[1]) / 2), 0.13, 0.14, 0.19)) // road
  ground.push(tint(flatQuad(80, 0.8, cx, GROUND + 0.006, z0 - 0.45), 0.24, 0.25, 0.3)) // our pavement
  ground.push(tint(flatQuad(80, z0 - ROAD[1] - far, cx, GROUND + 0.006, (z0 - ROAD[1] + far) / 2), 0.24, 0.25, 0.3)) // far pavement
  for (const z of [z0 - ROAD[0], z0 - ROAD[1]]) ground.push(tint(new THREE.BoxGeometry(80, 0.08, 0.12).translate(cx, GROUND + 0.03, z), 0.34, 0.35, 0.4)) // kerbs
  bin.mesh(ground, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, fog: false }), { receive: true, name: 'twilight street' })

  // The neighbours across the road: gabled houses with lit windows.
  const fronts = paintFronts(12)
  bin.keep(fronts.map); bin.keep(fronts.light)
  const bodies: THREE.BufferGeometry[] = []
  const roofs: THREE.BufferGeometry[] = []
  for (let at = cx - 22; at < cx + 22;) {
    const w = 4.2 + r() * 2.2, h = 2.4 + r() * 0.5, d = 4.2
    const col = new THREE.Color(WALLS[Math.floor(r() * WALLS.length)])
    bodies.push(tint(cellBox(w, h, d, at + w / 2, GROUND, far - d / 2, [1.8, 1.5], [Math.floor(r() * 4), 0]), col.r, col.g, col.b))
    roofs.push(roof(w, d, 1.3 + r() * 0.5, at + w / 2, GROUND + h, far - d / 2))
    at += w + 2.4 + r() * 1.8
  }
  bin.mesh(bodies, new THREE.MeshStandardMaterial({ map: fronts.map, vertexColors: true, roughness: 0.9, emissiveMap: fronts.light, emissive: '#ffffff', emissiveIntensity: 1.1, fog: false }), { receive: true, name: 'twilight houses' })
  bin.mesh(roofs, new THREE.MeshStandardMaterial({ color: '#4a4c62', roughness: 0.8, fog: false }), { name: 'twilight roofs' })

  // Trees: dark rounded crowns at the left, behind the neighbours, and one at the back right.
  const crowns: THREE.BufferGeometry[] = []
  const trunks: THREE.BufferGeometry[] = []
  const tree = (x: number, z: number, s: number) => {
    trunks.push(new THREE.CylinderGeometry(0.09 * s, 0.13 * s, 1.8 * s, 7).translate(x, GROUND + 0.9 * s, z))
    for (let i = 0; i < 3; i++) crowns.push(new THREE.IcosahedronGeometry((0.8 + r() * 0.4) * s, 3).translate(x + (r() - 0.5) * 0.9 * s, GROUND + (2.0 + r() * 0.8) * s, z + (r() - 0.5) * 0.9 * s))
  }
  tree(x0 - 2.6, z0 - 0.4, 0.95)
  tree(x0 - 3.4, cz + 1.2, 0.75)
  tree(x1 + 2.8, z0 - 1.2, 0.9)
  for (let x = cx - 20; x < cx + 20; x += 5 + r() * 4) tree(x, far - 6.5 - r() * 2, 1.3 + r() * 0.5)
  bin.mesh(trunks, new THREE.MeshStandardMaterial({ color: '#2a2630', roughness: 1, fog: false }), { name: 'twilight trunks' })
  bin.mesh(crowns, new THREE.MeshStandardMaterial({ color: '#46666a', roughness: 1, fog: false }), { name: 'twilight crowns' })

  // Two warm streetlamps on our pavement, at the back corners; heads glow, pools are cards.
  const poles: THREE.BufferGeometry[] = []
  const heads: THREE.BufferGeometry[] = []
  const pools: THREE.BufferGeometry[] = []
  const lamp = (x: number, z: number) => {
    const H = 3.2
    poles.push(new THREE.CylinderGeometry(0.04, 0.055, H, 8).translate(x, GROUND + H / 2, z))
    poles.push(new THREE.CylinderGeometry(0.12, 0.06, 0.08, 8).translate(x, GROUND + H + 0.26, z))
    heads.push(tint(new THREE.CylinderGeometry(0.1, 0.13, 0.26, 8).translate(x, GROUND + H + 0.12, z), ...WARM))
    pools.push(tint(flatQuad(4.4, 4.4, x, GROUND + 0.012, z), 0.3, 0.2, 0.1))
  }
  // One beside the left wall and one past the right, where the dollhouse view sees them.
  lamp(x0 - 1.8, z0 + 0.8)
  lamp(x1 + 1.3, z0 - 0.9)
  bin.mesh(poles, new THREE.MeshStandardMaterial({ color: '#22242e', roughness: 0.5, metalness: 0.6, fog: false }), { name: 'twilight poles' })
  bin.mesh(heads, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), { name: 'twilight lamp heads' })
  bin.mesh(pools, new THREE.MeshBasicMaterial({ map: bin.keep(glowTexture()), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), { name: 'twilight lamp pools' })

  seatCard(bin, house, paintView())
  return bin.world()
}
