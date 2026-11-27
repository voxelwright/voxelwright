// Waymo Ojai (Zeekr RT) autonomous robotaxi sculpted from continuous shapes (#57), not stacked boxes:
// modeled after the sixth-generation monobox electric robotaxi silhouette (4.68 m long, 1.98 m wide,
// 3.00 m long wheelbase with ultra-short overhangs, smoothly rounded pebble nose flowing straight into a
// swept panoramic windshield, contrasting gloss-black floating roof and B-pillarless wrap-around sliding-door
// glasshouse, recessed full-width Stargate visor lightbar with wrap-around amber hazards, slim horizontal rear
// LED bar, streamlined roof LiDAR fairing, compact fender cheek pods, stalked aero mirrors, sculpted 19-inch
// EV turbine wheels, and a flat-floor lounge interior with empty driver seat and glowing ride displays).
//
// Zero DOM/browser imports: Node (sf/fleet.mjs, sf/cars.mjs) and the browser (page/robotaxi.ts) share this
// exact geometry as one source of truth. Lengths are metres; cells laid `cells[x + w * (z + d * y)]`, +x front.
import { mostAround, outsideAir, sealLeaks } from './car-sculpt.ts'

const GLASS = 11, STEEL = 12, ROOFING = 14, LAMP = 15, PLASTER = 9
const k = (material: number, colour = 0) => material | (colour << 8)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const grey = (step: number) => 1 + Math.max(0, Math.min(14, step))

/** Shared material kinds for a sculpted Ojai robotaxi, independent of brand livery. */
export const OJAI_KINDS = {
  glass: k(GLASS, grey(12)),
  screen: k(GLASS, grey(11)),
  gloss: k(STEEL, grey(13)),
  cladding: k(ROOFING, grey(13)),
  liner: k(ROOFING, grey(13)),
  tyre: k(ROOFING, grey(14)),
  rim: k(STEEL, grey(3)),
  barrel: k(STEEL, grey(12)),
  alloy: k(STEEL, grey(6)),
  caliper: k(STEEL, grey(9)),
  chrome: k(STEEL, grey(2)),
  head: k(LAMP, grey(0)),
  drl: k(LAMP, 1),
  amber: k(LAMP, hue(2, 4)),
  tail: k(LAMP, hue(0, 4)),
  reverse: k(LAMP, grey(0)),
  plate: k(PLASTER, grey(1)),
  seat: k(ROOFING, grey(11)),
  cushion: k(ROOFING, grey(9)),
  dash: k(ROOFING, grey(12)),
} as const

/** Brand livery colors for any robotaxi service riding on the Ojai platform. */
export interface OjaiLivery {
  /** Main lower/mid body clearcoat paint (e.g. pearl white). */
  body: number
  /** Two-tone floating roof & pillar clearcoat paint (e.g. gloss obsidian black). */
  roof: number
  /** Brand accent stripe & rocker badge color. */
  accent: number
  /** Emissive LED accent for front visor status bar, roof sensor indicator, and cabin displays. */
  accentLamp: number
  /** High-contrast door badge lettering color. */
  text: number
  /** Lower rocker & wheel-arch surround cladding color. */
  trim: number
}

export interface OjaiSpec {
  L: number
  H: number
  W: number
  per: number
  /** Rear and front wheel centers along +x (metres), center height, tire radius, tire width. */
  wheels: readonly [number, number]
  wheelY: number
  wheelR: number
  tyreW: number
  /** Spinning roof LiDAR turret mount offset from vehicle foot center [dx, dy, dz] in 10 cm world cells. */
  domeOffset: readonly [number, number, number]
  /** Driver-position eye for first-person V cockpit view [x, y, z] in 10 cm body cells. */
  eye: readonly [number, number, number]
  /** Seat slots in 10 cm body cells. */
  seats: readonly (readonly [number, number, number])[]
}

/** Waymo Ojai / Zeekr RT production proportions (4.68 m long, 1.96 m body / 2.12 m mirror-to-mirror, 1.82 m tall, 3.00 m wheelbase). */
export const OJAI_SPEC: OjaiSpec = {
  L: 4.68,
  H: 1.82,
  W: 2.12,
  per: 4,
  wheels: [0.84, 3.84],
  wheelY: 0.43,
  wheelR: 0.36,
  tyreW: 0.25,
  // Roof fairing crown is centered at x = 2.50 m (+1.5 cells ahead of L/2 = 2.35 m), plinth top at y = 1.77 m (17.7 cells).
  domeOffset: [1.5, 17.7, 0],
  eye: [28.0, 12.6, 6.2],
  seats: [
    [27.5, 0.2, 6.2],
    [27.5, 0.2, 15.0],
    [14.5, 0.2, 6.2],
    [14.5, 0.2, 15.0],
  ],
}

/** Full uppercase 5x7 voxel pixel font so any service name or station sign renders crisply. */
export const FONT_5X7: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const bump = (v: number, at: number, wide: number) => Math.exp(-(((v - at) / wide) ** 2))
const through = (pts: readonly (readonly [number, number])[]) => (s: number) => {
  if (s <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (s <= pts[i][0]) {
    const [s0, y0] = pts[i - 1], [s1, y1] = pts[i], t = (s - s0) / (s1 - s0)
    return y0 + (y1 - y0) * (1 - Math.cos(Math.PI * t)) / 2
  }
  return pts[pts.length - 1][1]
}

/**
 * Sculpts a sleek Waymo Ojai (Zeekr RT) autonomous EV robotaxi at 2.5 cm cells: `{ cells, size }`.
 * Continuous analytical surfaces + 2-cell sealed shell + conformal door badge + 19" EV aero wheels + lounge interior.
 */
export function sculptOjai(o: { livery: OjaiLivery; badge?: string; spec?: OjaiSpec }): { cells: Uint16Array; size: [number, number, number] } {
  const sp = o.spec ?? OJAI_SPEC
  const { L, H, W, per, wheels: [xr, xf], wheelY, wheelR: R, tyreW } = sp
  const K = OJAI_KINDS, liv = o.livery
  const S = per * 10
  const w = Math.ceil(L * S), h = Math.ceil(H * S), d = Math.ceil(W * S)
  const zc = d / (2 * S), n = w * h * d
  const kinds = new Uint16Array(n)
  // Body half-width stays 0.98 m (1.96 m body) while the 2.12 m grid leaves clean room for unclipped aero wing mirrors.
  const hw = Math.min(0.98, W / 2 - 0.08)

  // ── Continuous Waymo Ojai / Zeekr RT capsule silhouette (s = X / L, 0 = rear, 1 = front) ──
  /** Smooth rounded pebble plan half-width: subtle wheel haunches, generous rounded nose & tail taper. */
  const B = (X: number) => {
    const s = X / L
    let b = Math.min(hw, hw - 0.028 + 0.026 * bump(X, xr, 0.46) + 0.024 * bump(X, xf, 0.46))
    if (s > 0.76) b *= 1 - 0.25 * ((s - 0.76) / 0.24) ** 2.05
    if (s < 0.16) b *= 1 - 0.16 * ((0.16 - s) / 0.16) ** 2.0
    return b
  }

  /** Low-floor EV skateboard bottom: ultra-low flat sill between axles, gently upswept aero chin & rear diffuser. */
  const bottom = (X: number) => {
    const s = X / L
    return 0.23 + 0.08 * smooth(0.86, 1.0, s) + 0.10 * smooth(0.14, 0.0, s)
  }

  /** Rising modern beltline separating the pearl-white lower body from the two-tone floating black glasshouse. */
  const belt = (X: number) => {
    const s = X / L
    return 0.935 + 0.032 * smooth(0.68, 0.12, s) - 0.028 * smooth(0.78, 0.92, s)
  }

  /**
   * Single continuous monovolume upper centerline profile from rounded tail apex -> arched panoramic roof ->
   * steep swept windshield -> short rounded pebble nose (ZERO boxy step between hood and windshield!).
   */
  const upperMid = through([
    [0.0, 0.62],
    [0.025, 0.94],
    [0.06, 1.24],
    [0.12, 1.56],
    [0.18, 1.665],
    [0.36, 1.705],
    [0.52, 1.70],
    [0.64, 1.655],
    [0.74, 1.40],
    [0.825, 1.045],
    [0.895, 0.925],
    [0.955, 0.835],
    [1.0, 0.63],
  ])

  /** Front & rear curved nose/tail boundary in plan + vertical roll-in (eliminates vertical flat walls at nose & tail). */
  const frontX = (Y: number, u: number) => {
    const q = clamp(u / hw)
    const chin = Y < 0.44 ? 0.10 * ((0.44 - Y) / 0.21) ** 2 : 0
    const brow = Y > 0.76 ? 0.14 * ((Math.min(Y, 1.05) - 0.76) / 0.29) ** 1.8 : 0
    return L - 0.015 - 0.27 * q ** 2.25 - chin - brow
  }
  const backX = (Y: number, u: number) => {
    const q = clamp(u / hw)
    const diff = Y < 0.46 ? 0.09 * ((0.46 - Y) / 0.23) ** 2 : 0
    const hatch = Y > 0.92 ? 0.18 * ((Math.min(Y, 1.70) - 0.92) / 0.78) ** 1.7 : 0
    return 0.015 + 0.18 * q ** 2.2 + diff + hatch
  }

  /**
   * Continuous cross-section half-width `side(X, Y)` from lower rocker tuck -> sculpted convex lower door ->
   * seamless inward glasshouse tumblehome up to the rounded roof rail (zero boxy shelf!).
   */
  const side = (X: number, Y: number) => {
    const b = B(X), yb = bottom(X), yBelt = belt(X)
    const yTop = Math.max(yBelt + 0.1, upperMid(X / L))
    // Lower body: smooth convex swell widest around y = 0.54 m, tucked gently under at the rocker sill.
    let u = b - 0.022 * smooth(0.56, yBelt, Y)
    const rb = 0.11
    if (Y < yb + rb) u -= rb - Math.sqrt(Math.max(0, rb * rb - (yb + rb - Y) ** 2))
    // Subtle sculpted lower EV door crease right above the black rocker cladding.
    const s = X / L
    if (s > 0.24 && s < 0.76 && Y > 0.34 && Y < 0.46) {
      u -= 0.016 * Math.sin(((Y - 0.34) / 0.12) * Math.PI)
    }
    // Smooth continuous glasshouse tumblehome above the beltline: curves gracefully inward to the arched roof.
    if (Y > yBelt) {
      const t = clamp((Y - yBelt) / Math.max(0.25, yTop - yBelt))
      u -= 0.22 * t ** 1.38
    }
    return Math.max(0.05, u)
  }

  /** Roof / nose crown height at lateral distance `u`: smoothly domed across width so upper corners stay silky round. */
  const topAt = (X: number, u: number) => {
    const s = X / L
    const yMid = upperMid(s)
    const bRef = Math.max(0.18, side(X, Math.min(yMid, belt(X) + 0.35)))
    const q = clamp(u / bRef)
    const crown = s > 0.78 || s < 0.10 ? 0.075 : 0.095
    return yMid - crown * q ** 2.35
  }

  // ── Signature Stargate Front Visor & Rear Horizontal Lightbar Recesses ──
  const frontVisorZone = (Y: number, u: number, b: number) => Y > 0.675 && Y < 0.775 && u < b * 0.96
  const frontIntakeZone = (Y: number, u: number, b: number) => Y > 0.27 && Y < 0.45 && u < b * 0.66
  const rearBarZone = (Y: number, u: number, b: number) => Y > 0.845 && Y < 0.955 && u < b * 0.96
  const rearPlateZone = (Y: number, u: number) => Y > 0.44 && Y < 0.59 && u < 0.245
  const rearDiffuserZone = (Y: number, u: number, b: number) => Y < 0.385 && u < b * 0.86

  const recess = (atFront: boolean, Y: number, u: number) => {
    const b = B(atFront ? L - 0.22 : 0.22)
    if (atFront) return frontVisorZone(Y, u, b) ? 0.032 : frontIntakeZone(Y, u, b) ? 0.048 : 0
    return rearBarZone(Y, u, b) ? 0.028 : rearPlateZone(Y, u) ? 0.026 : rearDiffuserZone(Y, u, b) ? 0.035 : 0
  }

  // ── 1. Primary sculpted capsule solid ──
  const solid = new Uint8Array(n)
  const archR = R + 0.045, inner = hw - tyreW - 0.08
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const X = (x + 0.5) / S, Y = (y + 0.5) / S, u = Math.abs((z + 0.5) / S - zc)
    const f = frontX(Y, u), r0 = backX(Y, u)
    if (X > f || X < r0) continue
    if (Y < bottom(X)) continue
    // Smooth circular wheel-arch cutouts.
    if ((Math.hypot(X - xr, Y - wheelY) < archR || Math.hypot(X - xf, Y - wheelY) < archR) && u > inner) continue
    if (u > side(X, Y)) continue
    if (Y > topAt(X, u)) continue
    // Sculpted recesses on nose & tail.
    if (X > f - 0.075 && X > f - recess(true, Y, u)) continue
    if (X < r0 + 0.075 && X < r0 + recess(false, Y, u)) continue
    solid[x + w * (z + d * y)] = 1
  }

  // ── 2. Integrated Waymo 6th-gen Ojai aerodynamic exterior hardware (roof LiDAR fairing, fender cheek pods, stalked wing mirrors, rear spoiler) ──
  const add = (x0: number, x1: number, y0: number, y1: number, test: (X: number, Y: number, u: number) => boolean) => {
    for (let y = Math.max(0, Math.floor(y0 * S)); y < Math.min(h, Math.ceil(y1 * S)); y++) {
      for (let z = 0; z < d; z++) {
        for (let x = Math.max(0, Math.floor(x0 * S)); x < Math.min(w, Math.ceil(x1 * S)); x++) {
          const X = (x + 0.5) / S, Y = (y + 0.5) / S, u = Math.abs((z + 0.5) / S - zc)
          if (test(X, Y, u)) solid[x + w * (z + d * y)] = 2
        }
      }
    }
  }

  // Streamlined teardrop gloss-black roof LiDAR fairing blending seamlessly into the curved black roof (x = 2.08..2.94 m).
  const podCx = 2.50
  const roofPod = (X: number, Y: number, u: number) => {
    if (X < 2.06 || X > 2.96 || Y < 1.63 || Y > 1.80) return false
    const dx = X >= podCx ? (X - podCx) / 0.44 : (podCx - X) / 0.42
    const dz = u / 0.34
    const base = topAt(X, u) - 0.02
    const arch = 1 - dx * dx - dz * dz
    if (arch <= 0) return false
    // Flat circular turret mounting deck around podCx (r <= 0.21 m) at y = 1.77 m.
    const rDeck = Math.hypot(X - podCx, u)
    const capH = rDeck < 0.21 ? 1.775 : base + 0.125 * Math.sqrt(arch)
    return Y >= base && Y <= Math.min(1.785, capH)
  }
  add(2.04, 2.98, 1.62, 1.80, roofPod)

  // Compact aerodynamic rear-roof camera/spoiler pod (x = 0.56..0.82 m).
  const rearPod = (X: number, Y: number, u: number) => {
    const base = topAt(X, u) - 0.02
    const dx = (X - 0.69) / 0.14, dz = u / 0.21
    const arch = 1 - dx * dx - dz * dz
    return arch > 0 && Y >= base && Y <= base + 0.075 * Math.sqrt(arch)
  }
  add(0.54, 0.84, 1.56, 1.76, rearPod)

  // Smoothly faired front-fender cheek sensor blisters just behind the front wheel arches (x = 3.18..3.46 m).
  const cheekPod = (X: number, Y: number, u: number) => {
    const sU = side(X, Y)
    const dx = (X - 3.32) / 0.14, dy = (Y - 0.87) / 0.068
    const arch = 1 - dx * dx - dy * dy
    return arch > 0 && u >= sU - 0.03 && u <= sU + 0.052 * Math.sqrt(arch)
  }
  add(3.16, 3.48, 0.79, 0.96, cheekPod)

  // Sleek aerodynamic stalked wing mirrors with integrated amber side hazard repeaters (x = 3.06..3.24 m, y = 0.99..1.11 m).
  const mx = 3.15, my = 1.05
  const mu = side(mx, my) + 0.072
  const mirrorPod = (X: number, Y: number, u: number) => {
    const cap = ((X - mx) / 0.078) ** 2 + ((Y - my) / 0.048) ** 2 + ((u - mu) / 0.058) ** 2 <= 1
    const stalk = Math.abs(X - (mx + 0.015)) < 0.025 && Y > my - 0.068 && Y < my - 0.005 && u > side(mx, my - 0.04) - 0.04 && u < mu + 0.01
    return cap || stalk
  }
  add(mx - 0.10, mx + 0.10, my - 0.08, my + 0.07, mirrorPod)

  // ── 3. Hollow to a tight 2-cell skin (pinhole-free across 2.5 cm, 5 cm & 10 cm LODs!) ──
  const outside = outsideAir(solid, [w, h, d])
  const depth = new Uint8Array(n)
  for (let layer = 1; layer <= 2; layer++) {
    for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const i = x + w * (z + d * y)
      if (!solid[i] || depth[i]) continue
      let near = false
      for (let b = -1; b <= 1 && !near; b++) for (let c = -1; c <= 1 && !near; c++) for (let a = -1; a <= 1 && !near; a++) {
        const X = x + a, Y = y + b, Z = z + c
        if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d) { near = layer === 1; continue }
        const j = X + w * (Z + d * Y)
        near = layer === 1 ? !!outside[j] : depth[j] === 1
      }
      if (near) depth[i] = layer + 8
    }
    for (let i = 0; i < n; i++) if (depth[i] > 8) depth[i] -= 8
  }

  // ── 4. Surface material assignment ──
  const facing = (x: number, y: number, z: number) => {
    let gx = 0, gy = 0, gz = 0
    for (let c = -2; c <= 2; c++) for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
      const X = x + a, Y = y + b, Z = z + c
      if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d || !solid[X + w * (Z + d * Y)]) continue
      gx += a; gy += b; gz += c
    }
    const l = Math.hypot(gx, gy, gz) || 1
    return { ahead: -gx / l, up: -gy / l, out: Math.abs(gz) / l }
  }
  const nearArch = (X: number, Y: number, extra: number) =>
    Math.min(Math.hypot(X - xr, Y - wheelY), Math.hypot(X - xf, Y - wheelY)) < archR + extra

  const kindAt = (x: number, y: number, z: number, added: boolean): number => {
    const X = (x + 0.5) / S, Y = (y + 0.5) / S, u = Math.abs((z + 0.5) / S - zc), s = X / L
    if (added) {
      // Roof LiDAR fairing & rear-roof sensor pod: pure gloss obsidian (spinning LiDAR turret owns the status/amber beacon LED!).
      if (Y > 1.50) return K.gloss
      // Wing mirror: gloss black housing + integrated amber side-repeater signal strip facing forward & outward!
      if (Y > 0.96) {
        const cap = ((X - mx) / 0.078) ** 2 + ((Y - my) / 0.048) ** 2 + ((u - mu) / 0.058) ** 2 <= 1
        if (cap && X > mx - 0.01 && Math.abs(Y - my) < 0.020 && u > mu + 0.022) return K.amber
        return K.gloss
      }
      // Fender cheek sensor pods: gloss black housing.
      return K.gloss
    }

    // Dark wheel-well inner liners & sleek EV black wheel-arch lip surrounds.
    if (u > inner - 1.2 / S && nearArch(X, Y, 1.8 / S)) {
      const f = facing(x, y, z)
      if (f.out < 0.58 && f.up < 0.35) return K.liner
    }
    if (nearArch(X, Y, 0.052) && Y < 0.88 && u > side(X, Y) - 0.045) return liv.trim

    // ── Front fascia: full-width gloss-black Stargate visor lightbar, crisp white LED blades, tidy wrap-around amber hazards & lower aero intake ──
    const fX = frontX(Y, u), bf = B(L - 0.22), sFront = Math.max(0.25, side(X, Y))
    if (X > fX - 0.105) {
      const q = u / sFront
      if (frontVisorZone(Y, u, sFront)) {
        // Laser-slim outer wrap-around amber corner hazard blinkers inside the gloss-black visor bezel!
        if (q > 0.84 && Y > 0.695 && Y < 0.755) return K.amber
        // Crisp horizontal bright-white LED matrix headlamp blades inside the gloss-black Stargate visor!
        if (q > 0.36 && q <= 0.81 && Y > 0.695 && Y < 0.755) return Y > 0.73 ? K.drl : K.head
        // Sleek glowing center brand status bar in the Stargate visor.
        if (q < 0.17 && Y > 0.70 && Y < 0.748) return liv.accentLamp
        return K.gloss
      }
      if (frontIntakeZone(Y, u, bf)) {
        // Recessed gloss-black lower bumper intake + center imaging radar module.
        if (u < 0.16 && Y > 0.32 && Y < 0.41) return K.gloss
        return K.cladding
      }
      if (Y < 0.32) return liv.trim
    }
    // Tidy slim wrap-around amber corner blinker on the front fender cheek (matches visor height cleanly).
    if (X > L - 0.30 && X < L - 0.14 && Y > 0.695 && Y < 0.755 && u > sFront - 0.05 && u > sFront * 0.85) return K.amber

    // ── Rear fascia: full-width slim crimson LED bar, bold wrap-around amber hazards, reverse lenses, plate & diffuser ──
    const rX = backX(Y, u), bt = B(0.22)
    if (X < rX + 0.105) {
      const q = u / bt
      if (rearBarZone(Y, u, bt)) {
        if (q > 0.76) return K.amber
        if (q > 0.18 && q < 0.33 && Y < 0.88) return K.reverse
        if (Y > 0.875 && Y < 0.928) return K.tail
        return K.gloss
      }
      if (rearPlateZone(Y, u)) {
        if (u > 0.22 || Y < 0.455 || Y > 0.575) return K.cladding
        if (Y > 0.545 && u < 0.18) return liv.text
        if (Y > 0.485 && Y < 0.525 && u < 0.16) return K.gloss
        return K.plate
      }
      if (rearDiffuserZone(Y, u, bt)) return liv.trim
    }
    // Wrap rear amber hazard cleanly onto the rear quarter cheek so it's unmistakable from side and 3/4 views!
    if (X < 0.32 && Y > 0.85 && Y < 0.95 && u > side(X, Y) - 0.055 && u > bt * 0.76) return K.amber

    // ── Two-tone floating gloss-black roof & B-pillarless wrap-around panoramic glasshouse (signature Waymo Ojai / Zeekr Mix!) ──
    const yBelt = belt(X)
    if (Y >= yBelt - 0.01) {
      const f = facing(x, y, z)
      const yTop = topAt(X, u)
      const sU = side(X, Y)
      // Huge swept monovolume panoramic windshield (s = 0.64..0.85).
      if (s > 0.64 && f.ahead > 0.12 && u < sU - 0.04) {
        // Sleek gloss-black A-pillar frame edges & lower cowl blackout band.
        if (Y < yBelt + 0.045 || u > sU - 0.065) return liv.roof
        return K.screen
      }
      // Clean raked rear liftgate window (s < 0.14).
      if (s < 0.14 && f.ahead < -0.12 && u < sU - 0.04) {
        if (Y < yBelt + 0.06 || Y > 1.56 || u > sU - 0.10) return liv.roof
        return K.glass
      }
      // Upper black floating roof cap & spoiler band.
      if (Y > yTop - 0.085 || (f.up > 0.72 && s > 0.14 && s < 0.65)) {
        // Panoramic tinted glass moonroof panel framed by the gloss-black floating roof rails!
        if (s > 0.22 && s < 0.58 && u < sU - 0.14 && Y > 1.62) return K.glass
        return liv.roof
      }
      // B-pillarless panoramic sliding-door side windows (uninterrupted sleek dark glass from A-pillar to D-pillar!).
      if (s > 0.12 && s < 0.78 && Y > yBelt + 0.025 && Y < yTop - 0.095) {
        // Slim gloss-black A-pillar trim along windshield rake + slim D-pillar corner cap at the very back.
        const aPillar = 0.84 - clamp((Y - yBelt) / 0.72) * 0.20
        if (s > aPillar - 0.03) return liv.roof
        if (s < 0.155 + clamp((Y - yBelt) / 0.72) * 0.035) return liv.roof
        return K.glass
      }
      return liv.roof
    }

    // ── Lower body sills, rocker cladding, and sleek brand-accent side stripe ──
    if (Y < 0.355) return liv.trim
    if (X > xr + 0.44 && X < xf - 0.44 && Y >= 0.355 && Y < 0.42) return liv.accent
    // Subtle flush dark recessed sliding-door touch handles tucked right under the beltline (clear of door lettering!).
    if (Y > 0.875 && Y < 0.91 && u > side(X, Y) - 0.035 && ((X > 2.08 && X < 2.24) || (X > 2.44 && X < 2.60))) {
      return K.gloss
    }
    return liv.body
  }

  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const i = x + w * (z + d * y)
    if (depth[i] === 1) kinds[i] = kindAt(x, y, z, solid[i] === 2)
  }
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const i = x + w * (z + d * y)
    if (depth[i] !== 2) continue
    let glass = 0, first = 0
    for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const X = x + a, Y = y + b, Z = z + c
      if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d) continue
      const j = X + w * (Z + d * Y)
      if (depth[j] !== 1) continue
      if ((kinds[j] & 15) === GLASS) glass = kinds[j]
      else if (!first || Math.abs(a) + Math.abs(b) + Math.abs(c) === 1) first = kinds[j]
    }
    kinds[i] = glass || first || kindAt(x, y, z, solid[i] === 2)
  }

  // Seal tiny corner notches between body & added hardware.
  for (let y = 1; y < h - 1; y++) for (let z = 1; z < d - 1; z++) for (let x = 1; x < w - 1; x++) {
    const i = x + w * (z + d * y)
    if (kinds[i]) continue
    const pairs = (kinds[i - 1] && kinds[i + 1] ? 1 : 0) + (kinds[i - w] && kinds[i + w] ? 1 : 0) + (kinds[i - w * d] && kinds[i + w * d] ? 1 : 0)
    if (pairs >= 2) kinds[i] = mostAround(kinds, [w, h, d], i, (kk) => kk === liv.body || kk === liv.roof)
  }

  // ── 5. Conformal door badge lettering (exact integer voxel pitch so every letter stroke is razor-sharp!) ──
  const badge = (o.badge ?? '').trim().toUpperCase()
  if (badge) {
    const chars = [...badge]
    const totalCols = chars.length * 6 - 1
    // Fit cleanly in the smooth white mid-door zone (1.42..3.26 m along x, 0.48..0.84 m in y) with exact integer voxels per glyph pixel!
    const availX = Math.floor(1.56 * S)
    const pitchX = Math.max(1, Math.min(2, Math.floor(availX / Math.max(1, totalCols))))
    const pitchY = pitchX
    const startXi = Math.round(2.34 * S - (totalCols * pitchX) / 2)
    const topYi = Math.round(0.66 * S + (7 * pitchY) / 2)
    const stampSide = (leftSide: boolean) => {
      // Left side (z near 0): viewer looks along +z, so +x is on viewer's LEFT -> flipX = true.
      // Right side (z near d-1): viewer looks along -z, so +x is on viewer's RIGHT -> flipX = false.
      const flipX = leftSide
      for (let ci = 0; ci < chars.length; ci++) {
        const glyph = FONT_5X7[chars[ci]] ?? FONT_5X7[' ']
        for (let r = 0; r < 7; r++) {
          for (let col = 0; col < 5; col++) {
            if (glyph[r][col] !== '1') continue
            const lc = flipX ? (chars.length - 1 - ci) * 6 + (4 - col) : ci * 6 + col
            const x0 = startXi + lc * pitchX
            const x1 = x0 + pitchX
            const y0 = topYi - (r + 1) * pitchY
            const y1 = y0 + pitchY
            for (let yi = y0; yi < y1; yi++) {
              if (yi < 0 || yi >= h) continue
              for (let xi = x0; xi < x1; xi++) {
                if (xi < 0 || xi >= w) continue
                // Find the outermost painted body cell along z on this side and paint it flush!
                if (leftSide) {
                  for (let zi = 0; zi < Math.floor(d / 2); zi++) {
                    const idx = xi + w * (zi + d * yi)
                    if (!kinds[idx]) continue
                    if (kinds[idx] === liv.body) kinds[idx] = liv.text
                    break
                  }
                } else {
                  for (let zi = d - 1; zi >= Math.floor(d / 2); zi--) {
                    const idx = xi + w * (zi + d * yi)
                    if (!kinds[idx]) continue
                    if (kinds[idx] === liv.body) kinds[idx] = liv.text
                    break
                  }
                }
              }
            }
          }
        }
      }
    }
    stampSide(true)
    stampSide(false)
  }

  // ── 6. Sculpted 19-inch EV aero turbine wheels (flush with sculpted body arches, 5-blade aero spokes, dark barrels & discs) ──
  for (const xm of [xr, xf]) for (const left of [true, false]) {
    const z0 = left ? zc - (hw - 0.004) : zc + (hw - 0.004) - tyreW
    const z1 = z0 + tyreW
    for (let y = Math.floor((wheelY - R) * S); y <= Math.ceil((wheelY + R) * S); y++) {
      for (let z = Math.floor(z0 * S); z < Math.ceil(z1 * S); z++) {
        for (let x = Math.floor((xm - R) * S); x <= Math.ceil((xm + R) * S); x++) {
          if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) continue
          const X = (x + 0.5) / S, Y = (y + 0.5) / S, Z = (z + 0.5) / S
          const r = Math.hypot(X - xm, Y - wheelY)
          const out = left ? Z - z0 : z1 - Z
          const shoulder = Math.min(out, tyreW - out)
          if (r > R - 0.032 + Math.min(0.032, shoulder * 0.65) || r > R) continue
          const i = x + w * (z + d * y), a = Math.atan2(Y - wheelY, X - xm)
          let kind: number
          if (r > R * 0.70) kind = K.tyre
          else if (out < 0.028) {
            // Modern EV 5-blade directional aero turbine rim with center cap!
            const blade = Math.cos(5 * a + r * 3.0) > 0.35
            kind = r > R * 0.62 ? K.rim : r < R * 0.16 ? (r < R * 0.08 ? K.chrome : K.barrel) : blade ? K.rim : 0
          } else if (out < 0.065) {
            const toward = xm < L / 2 ? Math.cos(a) > 0.55 : Math.cos(a) < -0.55
            kind = r > R * 0.30 && r < R * 0.56 && toward && Math.sin(a) > -0.2 ? K.caliper : r < R * 0.56 ? K.alloy : K.barrel
          } else {
            kind = K.barrel
          }
          kinds[i] = kind
        }
      }
    }
  }

  // ── 7. Spacious flat-floor Ojai lounge interior (visible through panoramic glass: NO driver, glowing ride screens!) ──
  const fill = (x0: number, x1: number, y0: number, y1: number, test: (X: number, Y: number, u: number, zs: number) => number) => {
    for (let y = Math.max(0, Math.floor(y0 * S)); y < Math.min(h, Math.ceil(y1 * S)); y++) {
      for (let z = 0; z < d; z++) {
        for (let x = Math.max(0, Math.floor(x0 * S)); x < Math.min(w, Math.ceil(x1 * S)); x++) {
          const i = x + w * (z + d * y)
          if (kinds[i] || outside[i]) continue
          const Z = (z + 0.5) / S
          const kk = test((x + 0.5) / S, (y + 0.5) / S, Math.abs(Z - zc), Z - zc)
          if (kk) kinds[i] = kk
        }
      }
    }
  }
  // Completely flat skateboard EV lounge floor.
  fill(0.95, 3.65, 0.34, 0.40, () => K.dash)
  // Front twin minimalist autonomous lounge seats (empty — no driver!).
  for (const sz of [-0.42, 0.42]) {
    fill(2.40, 3.12, 0.40, 1.24, (X, Y, _u, zs) => {
      const q = Math.abs(zs - sz)
      if (q > 0.27) return 0
      if (X > 2.55 && X < 3.08 && Y < 0.60) return q > 0.18 ? K.seat : K.cushion
      const lean = 2.55 - (Y - 0.58) * 0.24
      if (Y >= 0.52 && Y < 1.12 && X > lean - 0.04 && X < lean + 0.13) return q > 0.19 ? K.seat : K.cushion
      if (Y >= 1.10 && Y < 1.24 && q < 0.13 && X > lean - 0.03 && X < lean + 0.10) return K.seat
      return 0
    })
  }
  // Wide rear lounge sofa bench.
  fill(1.05, 1.80, 0.40, 1.26, (X, Y, u) => {
    if (u > 0.72) return 0
    if (X > 1.24 && X < 1.78 && Y < 0.60) return K.cushion
    const lean = 1.24 - (Y - 0.58) * 0.22
    if (Y >= 0.52 && Y < 1.24 && X > lean - 0.04 && X < lean + 0.14) return K.seat
    return 0
  })
  // Minimalist floating EV dashboard, compact steering column (empty!), front & rear glowing autonomous ride tablets!
  fill(3.26, 3.74, 0.72, 0.96, (_X, Y, u) => (u < 0.78 && Y < 0.94 ? K.dash : 0))
  fill(3.12, 3.24, 0.94, 1.16, (X, Y, u) => {
    if (u > 0.24) return 0
    return X < 3.18 && u < 0.21 && Y > 0.97 && Y < 1.13 ? liv.accentLamp : K.gloss
  })
  fill(2.26, 2.34, 0.88, 1.10, (X, Y, u) => {
    if (u > 0.22) return 0
    return X < 2.30 && u < 0.19 && Y > 0.91 && Y < 1.07 ? liv.accentLamp : K.gloss
  })

  sealLeaks(kinds, [w, h, d], (kk) => kk === liv.body || kk === liv.roof)
  return { cells: kinds, size: [w, h, d] }
}
