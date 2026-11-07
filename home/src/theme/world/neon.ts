// Neon night's world (regroup S1): the house stands on a wet city block at night. A pavement
// ring with kerbs, a ring road of wet asphalt with lane dashes, and blocks of towers across the
// road with lit window grids, neon signs and shopfronts; streetlights with light cones and
// pools, fake reflection streaks under the signs, and rain. Tall blocks stand only behind and
// left of the house, where the dollhouse camera (front right) never looks through them.
import * as THREE from 'three/webgpu'
import { attribute, mod, positionLocal, time, vec3 } from 'three/tsl'
import { canvas, makeNoise, rng, toTexture } from '../../paint'
import { YARD_TOP } from '../../diorama'
import type { House, World } from './index'
import { Bin, cellBox, flatQuad, glowTexture, tint } from './build'

const WALK = YARD_TOP // pavement top: the house's contact shadow lies on it
const ROAD = YARD_TOP - 0.14
const PAVE = 1.4 // house-side pavement width
const LANES = 3.8
const FAR_PAVE = 0.9
const CELL: [number, number] = [1.5, 1.25] // one window bay, one storey
/** Where the dollhouse camera looks from (yaw 0.6 in camera.ts): reflections stretch towards it. */
const VIEW_TURN = 0.6

const NEON: Array<[number, number, number]> = [
  [2.0, 0.22, 1.4], // magenta
  [0.22, 1.6, 2.0], // cyan
  [2.1, 1.0, 0.25], // amber
  [1.0, 0.4, 2.1], // violet
  [1.9, 0.3, 0.55], // hot red-pink
]

/** Window grids: 8 by 8 bays, about four in ten lit in warm, cool or pink light. */
function paintWindows(seed: number) {
  const r = rng(seed)
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#0c0a18'
  g.fillRect(0, 0, 512, 512)
  const lit = ['#ffcf7a', '#ffdf9e', '#ffc066', '#9fe8ff', '#c9f2ff', '#ff8ad8']
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const x = col * 64, y = row * 64
    if (row === 7 && col === 0) continue // the dark cell roofs sample
    const on = r() < 0.42
    if (on) {
      const tone = lit[Math.floor(r() * lit.length)]
      const grad = g.createLinearGradient(0, y + 14, 0, y + 52)
      grad.addColorStop(0, tone)
      grad.addColorStop(1, r() < 0.5 ? tone : '#6a3a5a')
      g.fillStyle = grad
    } else g.fillStyle = r() < 0.5 ? '#141a34' : '#1a1430'
    g.fillRect(x + 12, y + 14, 40, 38)
    if (on && r() < 0.4) { // half-drawn blind
      g.fillStyle = 'rgba(20,10,30,0.7)'
      g.fillRect(x + 12, y + 14, 40, 8 + r() * 18)
    }
    g.fillStyle = 'rgba(0,0,0,0.6)' // mullion
    g.fillRect(x + 31, y + 14, 2, 38)
  }
  const t = toTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Left half: an abstract neon tube mark (no letters). Right half: a lit shopfront. */
function paintSigns() {
  const [c, g] = canvas(512, 256)
  g.fillStyle = '#050308'
  g.fillRect(0, 0, 512, 256)
  g.strokeStyle = '#ffffff'
  g.lineCap = g.lineJoin = 'round'
  g.shadowColor = '#ffffff'
  g.shadowBlur = 14
  g.lineWidth = 9
  g.beginPath()
  g.roundRect(18, 18, 220, 220, 26)
  g.stroke()
  g.lineWidth = 11
  g.beginPath()
  g.arc(128, 92, 34, 0, Math.PI * 2)
  g.stroke()
  g.beginPath()
  g.moveTo(70, 196); g.lineTo(128, 150); g.lineTo(186, 196)
  g.stroke()
  g.beginPath()
  g.moveTo(64, 140); g.lineTo(192, 140)
  g.stroke()
  // Shopfront: a lit pane under a dark fascia, with mullions and a warm floor glow.
  const pane = g.createLinearGradient(0, 40, 0, 256)
  pane.addColorStop(0, '#c8c0d8')
  pane.addColorStop(1, '#ffffff')
  g.shadowBlur = 0
  g.fillStyle = pane
  g.fillRect(256, 40, 256, 216)
  g.fillStyle = '#1a1424'
  g.fillRect(256, 0, 256, 40)
  for (let x = 256; x <= 512; x += 64) g.fillRect(x - 3, 40, 6, 216)
  return toTexture(c)
}

/** Wet asphalt: grain in the colour, puddles as smooth patches in the roughness (green channel). */
function paintAsphalt(seed: number) {
  const n = makeNoise(seed, 32)
  const [c, g] = canvas(256, 256)
  const [rc, rg] = canvas(256, 256)
  const img = g.createImageData(256, 256), rough = rg.createImageData(256, 256)
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4
    const grain = n(x / 2, y / 2, 2), puddle = n(x / 40, y / 40, 3)
    const v = 26 + grain * 30
    img.data.set([v, v * 0.95, v * 1.15, 255], i)
    const rr = puddle > 0.56 ? 70 : 140 + grain * 70
    rough.data.set([rr, rr, rr, 255], i)
  }
  g.putImageData(img, 0, 0)
  rg.putImageData(rough, 0, 0)
  const map = toTexture(c), roughness = toTexture(rc, { color: false })
  for (const t of [map, roughness]) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return { map, roughness }
}

/** Concrete slabs a metre square, darkened by the wet. */
function paintSlabs(seed: number) {
  const n = makeNoise(seed, 32)
  const [c, g] = canvas(256, 256)
  const img = g.createImageData(256, 256)
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const seam = x % 128 < 3 || y % 128 < 3
    const v = seam ? 30 : 58 + n(x / 3, y / 3, 3) * 34
    img.data.set([v, v * 0.96, v * 1.12, 255], (y * 256 + x) * 4)
  }
  g.putImageData(img, 0, 0)
  const t = toTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** A box whose UVs are its world x and z over `cell` metres, for ground slabs. */
function slab(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, cell: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  const p = g.attributes.position, uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / cell, p.getZ(i) / cell)
  return g
}

export function neonCity(house: House): World {
  const bin = new Bin()
  const r = rng(41)
  const { x0, x1, z0, z1 } = house
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
  // From the house's walls to the far kerb: a street behind, in front and to the right; on the
  // left the next block starts at the pavement, so its towers stand close behind the left wall.
  const o = PAVE + LANES, ol = PAVE

  // Ground: one wide road plane under everything, glossy and dark; SSR makes it wet on high.
  const asphalt = paintAsphalt(3)
  for (const t of [asphalt.map, asphalt.roughness]) t.repeat.set(18, 18)
  bin.keep(asphalt.map); bin.keep(asphalt.roughness)
  const road = bin.mesh([flatQuad(100, 100, cx, ROAD, cz)], new THREE.MeshStandardMaterial({ color: '#8a84a8', map: asphalt.map, roughnessMap: asphalt.roughness, roughness: 0.5, metalness: 0 }), { receive: true, name: 'neon road' })
  road.renderOrder = -1

  // Pavements: the house's own ring and four city blocks across the road.
  const slabs = bin.keep(paintSlabs(5))
  const blocks = [
    slab(x0 - PAVE, x1 + PAVE, z0 - PAVE, z1 + PAVE, ROAD, WALK, 2),
    slab(cx - 60, cx + 60, z0 - o - 40, z0 - o, ROAD, WALK, 2), // back
    slab(x0 - ol - 40, x0 - ol, z0 - o, cz + 60, ROAD, WALK, 2), // left
    slab(x0 - ol, cx + 60, z1 + o, z1 + o + 40, ROAD, WALK, 2), // front
    slab(x1 + o, x1 + o + 40, z0 - o, z1 + o, ROAD, WALK, 2), // right
  ]
  bin.mesh(blocks, new THREE.MeshStandardMaterial({ map: slabs, roughness: 0.38, metalness: 0 }), { receive: true, name: 'neon pavement' })
  // Kerbs: pale stone edges where each pavement meets the road.
  const kerbs: THREE.BufferGeometry[] = []
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const w = Math.abs(bx - ax) || 0.14, d = Math.abs(bz - az) || 0.14
    kerbs.push(new THREE.BoxGeometry(w, 0.15, d).translate((ax + bx) / 2, WALK - 0.07, (az + bz) / 2))
  }
  const hx0 = x0 - PAVE, hx1 = x1 + PAVE, hz0 = z0 - PAVE, hz1 = z1 + PAVE
  edge(hx0, hz0, hx1, hz0); edge(hx0, hz1, hx1, hz1); edge(hx0, hz0, hx0, hz1); edge(hx1, hz0, hx1, hz1)
  edge(cx - 60, z0 - o, cx + 60, z0 - o); edge(x0 - ol, z1 + PAVE, x0 - ol, cz + 60)
  edge(x0 - ol, z1 + o, cx + 60, z1 + o); edge(x1 + o, z0 - o, x1 + o, z1 + o)
  bin.mesh(kerbs, new THREE.MeshStandardMaterial({ color: '#8c88a8', roughness: 0.5 }), { name: 'neon kerbs' })

  // Lane dashes along the middle of the ring road.
  const dashes: THREE.BufferGeometry[] = []
  const lane = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 2.6), along = Math.abs(bx - ax) > Math.abs(bz - az)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      dashes.push(flatQuad(along ? 1.2 : 0.12, along ? 0.12 : 1.2, ax + (bx - ax) * t, ROAD + 0.006, az + (bz - az) * t))
    }
  }
  const m = PAVE + LANES / 2
  lane(x0 - ol, z0 - m, x1 + m, z0 - m); lane(x0 - ol, z1 + m, x1 + m + 20, z1 + m)
  lane(x1 + m, z0 - m - 20, x1 + m, z1 + m + 20); lane(x1 + m, z0 - m, x1 + m + 30, z0 - m)
  bin.mesh(dashes, new THREE.MeshStandardMaterial({ color: '#d8c890', roughness: 0.4, emissive: '#3a3020' }), { name: 'neon lane paint' })

  // Towers across the road. Bodies share one window-grid texture laid out in metres.
  const windows = bin.keep(paintWindows(9))
  const bodies: THREE.BufferGeometry[] = []
  const glows: THREE.BufferGeometry[] = [] // signs, shopfronts, lamp heads, roof tubes: one unlit mesh
  const pools: THREE.BufferGeometry[] = [] // additive ground light
  const shift = (): [number, number] => [Math.floor(r() * 8) / 8 * 8, 0]
  const signUV = (g: THREE.BufferGeometry, shop: boolean) => {
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (shop ? 0.5 : 0))
    return g
  }
  const streak = (x: number, z: number, c: [number, number, number], w: number, len: number, k: number) => {
    pools.push(tint(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2).translate(0, 0, len / 2).rotateY(VIEW_TURN).translate(x, ROAD + 0.01, z), c[0] * k, c[1] * k, c[2] * k))
  }
  /**
   * One row of towers along a facade line. `face` is the facade's outward normal (towards the
   * house); `along` runs from a to b; towers go back by their depth. `tall` false cuts them low.
   */
  const row = (a: number, b: number, line: number, face: 'z+' | 'x+' | 'z-' | 'x-', tall: boolean) => {
    let at = a
    while (at < b) {
      const width = 3 + r() * 4.5, depth = 5 + r() * 5
      const h = tall ? 4.5 + r() * 11 : 1.0 + r() * 0.4
      const mid = at + width / 2
      const zAxis = face === 'z+' || face === 'z-'
      const out = face === 'z+' || face === 'x+' ? 1 : -1
      const bx = zAxis ? mid : line - (out * depth) / 2
      const bz = zAxis ? line - (out * depth) / 2 : mid
      bodies.push(cellBox(zAxis ? width : depth, h, zAxis ? depth : width, bx, ROAD, bz, CELL, shift()))
      // Point on the facade, `along` metres from the tower's middle, `off` metres out.
      const onFace = (along: number, off: number): [number, number] => zAxis ? [mid + along, line + out * off] : [line + out * off, mid + along]
      const colour = NEON[Math.floor(r() * NEON.length)]
      if (tall && r() < 0.65) { // a lit shopfront on the ground floor
        const [sx, sz] = onFace(0, 0.03)
        const sw = width * 0.7
        glows.push(signUV(tint(new THREE.BoxGeometry(zAxis ? sw : 0.04, 1.5, zAxis ? 0.04 : sw).translate(sx, WALK + 0.8, sz), 0.95, 0.62, 0.5), true))
        streak(sx, sz, [1, 0.8, 0.6], sw * 0.6, 2.2, 0.35)
      }
      if (tall && r() < 0.7) { // a neon sign: a vertical blade or a band over the shop
        const blade = r() < 0.55
        const [sx, sz] = onFace((r() - 0.5) * width * 0.5, blade ? 0.45 : 0.06)
        const y = blade ? WALK + 2.4 + r() * 2 : WALK + 2.1
        const g = blade
          ? new THREE.BoxGeometry(zAxis ? 0.12 : 0.8, 2.6, zAxis ? 0.8 : 0.12).translate(sx, y + 1.3, sz)
          : new THREE.BoxGeometry(zAxis ? width * 0.6 : 0.1, 0.7, zAxis ? 0.1 : width * 0.6).translate(sx, y + 0.35, sz)
        glows.push(signUV(tint(g, ...colour), false))
        streak(sx, sz, colour, blade ? 0.9 : width * 0.5, 4.5, 0.32)
      }
      if (tall && r() < 0.35) { // a tube along the roof edge
        const [sx, sz] = onFace(0, 0.02)
        glows.push(signUV(tint(new THREE.BoxGeometry(zAxis ? width : 0.06, 0.06, zAxis ? 0.06 : width).translate(sx, ROAD + h - 0.15, sz), ...colour), false))
      }
      at += width + (r() < 0.3 ? 0.6 + r() * 0.8 : 0.02)
    }
  }
  row(cx - 34, cx + 34, z0 - o - FAR_PAVE, 'z+', true) // behind the house: what the window sees
  row(z0 - o - FAR_PAVE + 0.1, z1 + PAVE, x0 - ol - FAR_PAVE, 'x+', true) // left, beside the house
  row(x0 - ol - FAR_PAVE, cx + 30, z1 + o + FAR_PAVE, 'z-', false) // in front: cut low
  row(z0 - o - FAR_PAVE, z1 + o + FAR_PAVE, x1 + o + FAR_PAVE, 'x-', false) // right: cut low
  bin.mesh(bodies, new THREE.MeshStandardMaterial({ color: '#1c1830', roughness: 0.75, metalness: 0.1, emissiveMap: windows, emissive: '#ffffff', emissiveIntensity: 1.7 }), { name: 'neon towers' })

  // Streetlights on the house's pavement, arms over the road (none at the front-right corner,
  // where they would stand between the dollhouse camera and the room).
  const poles: THREE.BufferGeometry[] = []
  const cones: THREE.BufferGeometry[] = []
  const lamp = (x: number, z: number, dx: number, dz: number, colour: [number, number, number]) => {
    const H = 3.8, arm = 1.1
    poles.push(new THREE.CylinderGeometry(0.045, 0.06, H, 8).translate(x, WALK + H / 2, z))
    poles.push(new THREE.BoxGeometry(Math.abs(dx) * arm + 0.06, 0.06, Math.abs(dz) * arm + 0.06).translate(x + (dx * arm) / 2, WALK + H, z + (dz * arm) / 2))
    const hx = x + dx * arm, hz = z + dz * arm
    glows.push(signUV(tint(new THREE.BoxGeometry(0.34, 0.05, 0.34).translate(hx, WALK + H - 0.06, hz), colour[0] * 1.4, colour[1] * 1.4, colour[2] * 1.4), true))
    const cone = new THREE.ConeGeometry(0.95, H - 0.1, 24, 1, true).translate(hx, WALK + (H - 0.1) / 2, hz)
    const p = cone.attributes.position, c = new Float32Array(p.count * 3)
    for (let i = 0; i < p.count; i++) {
      const k = Math.max(0, (p.getY(i) - WALK) / (H - 0.1)) ** 2 * 0.06
      c.set([colour[0] * k, colour[1] * k, colour[2] * k], i * 3)
    }
    cone.setAttribute('color', new THREE.BufferAttribute(c, 3))
    cones.push(cone)
    pools.push(tint(flatQuad(3.4, 3.4, hx, WALK + 0.012, hz), colour[0] * 0.12, colour[1] * 0.12, colour[2] * 0.12))
    streak(hx, hz, colour, 0.7, 3, 0.25)
  }
  const cool: [number, number, number] = [0.85, 0.8, 1.2], pink: [number, number, number] = [1.3, 0.55, 1.0]
  const k = PAVE - 0.3
  lamp(x0 - k, z0 - k, -0.7, -0.7, cool)
  lamp(cx, z0 - k, 0, -1, cool)
  lamp(x1 + k, z0 - k, 0.7, -0.7, cool)
  lamp(x0 - k, cz, -1, 0, pink)
  lamp(x0 - k, z1 + k, -0.7, 0.7, cool)
  bin.mesh(poles, new THREE.MeshStandardMaterial({ color: '#2a2838', roughness: 0.4, metalness: 0.7 }), { name: 'neon poles' })
  bin.mesh(glows, new THREE.MeshBasicMaterial({ map: bin.keep(paintSigns()), vertexColors: true, fog: false }), { name: 'neon signs' })
  const glowMap = bin.keep(glowTexture())
  bin.mesh(cones, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }), { name: 'neon light cones' })
  bin.mesh(pools, new THREE.MeshBasicMaterial({ map: glowMap, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), { name: 'neon pools and reflections' })

  bin.group.add(rain(house, bin))
  return bin.world()
}

/** Rain: thin falling streaks behind and beside the house, moved on the GPU by time. */
function rain(house: House, bin: Bin) {
  const r = rng(77)
  const N = 2400, H = 11, LEN = 0.38, SPREAD = 12
  const pos: number[] = [], base: number[] = [], dy: number[] = []
  const { x0, x1, z0, z1 } = house
  while (base.length < N * 2) {
    const x = x0 - SPREAD + r() * (x1 - x0 + SPREAD * 2), z = z0 - SPREAD + r() * (z1 - z0 + SPREAD * 2)
    // Only behind and left of the house: rain on the camera's side would streak over the room.
    if (x > x0 - 0.3 && z > z0 - 0.3) continue
    const b = r() * H
    pos.push(x, 0, z, x, 0, z)
    base.push(b, b)
    dy.push(0, LEN)
  }
  const g = bin.keep(new THREE.BufferGeometry())
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('base', new THREE.Float32BufferAttribute(base, 1))
  g.setAttribute('dy', new THREE.Float32BufferAttribute(dy, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, H / 2, (z0 + z1) / 2), 40)
  const material = bin.keep(new THREE.LineBasicNodeMaterial({ color: '#9fb4ff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  const lift = attribute('dy', 'float')
  const y = mod(attribute('base', 'float').sub(time.mul(8.5)), H).add(lift).add(ROAD)
  material.positionNode = vec3(positionLocal.x.add(lift.mul(0.12)), y, positionLocal.z)
  const lines = new THREE.LineSegments(g, material)
  lines.name = 'neon rain'
  lines.frustumCulled = false
  lines.raycast = () => {}
  return lines
}
