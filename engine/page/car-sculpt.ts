// A sports coupe sculpted from continuous shapes (#39), not stacked boxes: the hand-written car's look
// (living.ts `fineCar`), the SF library's coupe (sf/fleet.mjs `sportsCoupe`) and the one G brings (summon.ts) are all
// this one shape at their own sizes. Its body is a solid said by smooth profiles along its length (the plan's width
// with haunches over the wheels, the side's tuck and tumblehome, a hood that falls from the cowl with a dome and
// fenders standing proud of it, a fastback roof), cut by the wheel arches and by recesses for the lamps, the grille,
// the plate and the diffuser, then hollowed to a skin two cells thick: thick enough that no ray finds a gap between
// two cells that meet only at an edge, and that a look made coarser keeps its shell (`coarser`). Inside: two bucket
// seats, a tunnel, a dash with its gauge hood, and a wheel low enough that the driver's eye (V) sees over it.
//
// Lengths are metres; cells are laid `cells[x + w * (z + d * y)]`, x along the car from its back (its front is +x),
// z across, y up. No imports: Node reads this file too (sf/fleet.mjs, the tests), and the page draws what it makes.

const GLASS = 11, STEEL = 12, ROOFING = 14, LAMP = 15, PLASTER = 9
const k = (material: number, colour = 0) => material | (colour << 8)
/** A hue (0 red, 3 orange-yellow, 8 green, 16 blue) in a tone (0 palest .. 6 dark). */
const hue = (h: number, tone: number) => 16 + h * 10 + tone
/** A grey: 0 white to 14 black. */
const grey = (step: number) => 1 + step

/** What a coupe is made of, but its paint. */
export const COUPE_KINDS = {
  glass: k(GLASS, grey(12)), screen: k(GLASS, grey(11)), gloss: k(STEEL, grey(13)), carbon: k(ROOFING, grey(12)),
  liner: k(ROOFING, grey(13)), grille: k(STEEL, grey(10)), tyre: k(ROOFING, grey(14)), rim: k(STEEL, grey(3)),
  barrel: k(STEEL, grey(11)), caliper: k(STEEL, hue(4, 3)), chrome: k(STEEL, grey(4)), head: k(LAMP, grey(0)),
  amber: k(LAMP, hue(3, 4)), tail: k(LAMP, hue(0, 4)), reverse: k(LAMP, grey(0)), plate: k(PLASTER, grey(1)),
  seat: k(ROOFING, grey(12)), insert: k(ROOFING, grey(10)), dash: k(ROOFING, grey(11)), alloy: k(STEEL, grey(6)),
} as const

export interface CoupeSpec {
  /** Length, height and width of the look, metres. */
  L: number; H: number; W: number
  /** Cells to a metre are 10 x per. */
  per: number
  /** The back and front wheels' middles along the car, metres from its back; their middles' height and radius, the tyre's width. */
  wheels: readonly [number, number]; wheelY: number; wheelR: number; tyreW: number
  /** The driver's eye: along, up, across (metres from the back, the ground, the left side). */
  eye: readonly [number, number, number]
  /** The kind its paint is (it may carry the polish bit, kinds.rs POLISHED). */
  paint: number
}

/** The SF library's coupe and the one G brings: 4.5 m long, 1.28 m high, 1.92 m wide. */
export const GT_COUPE: Omit<CoupeSpec, 'paint'> = { L: 4.5, H: 1.28, W: 1.92, per: 4, wheels: [0.95, 3.55], wheelY: 0.34, wheelR: 0.34, tyreW: 0.25, eye: [1.95, 0.98, 0.55] }

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const bump = (v: number, at: number, wide: number) => Math.exp(-(((v - at) / wide) ** 2))
/** A smooth curve through points [s, y] (s rising): cosine between each pair. */
const through = (pts: readonly (readonly [number, number])[]) => (s: number) => {
  if (s <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) if (s <= pts[i][0]) { const [s0, y0] = pts[i - 1], [s1, y1] = pts[i], t = (s - s0) / (s1 - s0); return y0 + (y1 - y0) * (1 - Math.cos(Math.PI * t)) / 2 }
  return pts[pts.length - 1][1]
}

/** The coupe's cells: `{ cells, size }`. */
export function sculptCoupe(o: CoupeSpec): { cells: Uint16Array; size: [number, number, number] } {
  const { L, H, W, per, wheels: [xr, xf], wheelY, wheelR: R, tyreW, paint } = o, K = COUPE_KINDS
  const S = per * 10, w = Math.ceil(L * S), h = Math.ceil(H * S), d = Math.ceil(W * S), zc = d / (2 * S)
  const n = w * h * d, kinds = new Uint16Array(n)
  const hw = W / 2 - 0.005, Hroof = H - 0.02

  // ── Profiles along the car (s = x / L, 0 its back, 1 its front) ──
  // Where the windscreen meets the cowl and the roof, where the roof turns down into the fastback, where that meets the deck.
  const sC = 0.635, sH = 0.525, sR = 0.335, sT = 0.075
  const cowlY = 0.785, deckY = 0.835
  /** The body's half width in plan: fuller over each wheel, narrower at the doors, rounded in at the nose and the tail. */
  const B = (X: number) => {
    const s = X / L
    let b = Math.min(hw, hw - 0.042 + 0.042 * bump(X, xr, 0.5) + 0.032 * bump(X, xf, 0.45))
    if (s > 0.8) b *= 1 - 0.2 * ((s - 0.8) / 0.2) ** 2.2
    if (s < 0.1) b *= 1 - 0.09 * ((0.1 - s) / 0.1) ** 2
    return b
  }
  /** The body's top along its middle before fenders: the tail's deck, the shoulder, the cowl, the hood falling to the nose. */
  const top = through([[0, deckY - 0.035], [0.05, deckY], [0.2, 0.81], [0.38, 0.745], [0.58, 0.755], [0.645, cowlY], [0.8, 0.705], [0.93, 0.625], [1, 0.55]])
  /** The bottom: low between the wheels, up a little at the nose and more at the tail, where the diffuser kicks up. */
  const bottom = (X: number) => { const s = X / L; return 0.145 + 0.03 * smooth(0.94, 1, s) + 0.06 * smooth(0.1, 0, s) }
  /** The top at a distance `u` from the middle: the hood's dome and crease, fenders and haunches, rolled over at the shoulder. */
  const lowerTop = (X: number, u: number, b: number) => {
    const s = X / L, q = u / b
    let y = top(s)
    // The hood: a low power dome down its middle, between the cowl and the nose.
    y += 0.018 * (1 - smooth(0, 0.45, q)) * smooth(0.63, 0.72, s) * (1 - smooth(0.88, 0.98, s))
    // Front fenders standing over the front wheels, the haunches over the back ones.
    y += 0.065 * bump(X, xf, 0.5) * smooth(0.4, 0.8, q) * smooth(0.6, 0.7, s)
    y += 0.06 * bump(X, xr, 0.55) * smooth(0.45, 0.85, q)
    // Rolled over at the shoulder: a quarter circle of 9 cm.
    const r = 0.09, e = q * b - (b - r)
    if (e > 0) y -= r - Math.sqrt(Math.max(0, r * r - e * e))
    return y
  }
  /** The side's half width at a height: tucked under at the sill, drawn in a little towards the shoulder. */
  const side = (X: number, Y: number) => {
    const b = B(X), yb = bottom(X), rb = 0.1
    let u = b - 0.028 * smooth(0.46, 0.78, Y)
    if (Y < yb + rb) u -= rb - Math.sqrt(Math.max(0, rb * rb - (yb + rb - Y) ** 2))
    // A shoulder line along the whole side: a cell's step in below it.
    const line = 0.615 + 0.045 * bump(X, xr, 0.6) + 0.02 * bump(X, xf, 0.5)
    if (Y < line && Y > yb + 0.06) u -= 1 / S
    return u
  }
  /** Where the nose and the tail end, at a height and a distance from the middle. */
  const front = (Y: number, u: number) => L - 0.012 - 0.2 * (u / hw) ** 3 - (Y < 0.26 ? 0.06 * ((0.26 - Y) / 0.11) ** 2 : 0) - (Y > 0.44 ? 0.1 * ((Math.min(Y, 0.62) - 0.44) / 0.12) ** 2 : 0)
  const back = (Y: number, u: number) => 0.012 + 0.11 * (u / hw) ** 3 + (Y < 0.32 ? 0.07 * ((0.32 - Y) / 0.17) ** 2 : 0) + (Y > 0.6 ? 0.07 * ((Math.min(Y, 0.86) - 0.6) / 0.26) ** 2 : 0)
  /** The roof along its middle: the windscreen from the cowl, the roof, the fastback falling to the deck. */
  const roof = (s: number) => {
    if (s >= sH) { const t = clamp((sC - s) / (sC - sH)); return cowlY + (Hroof - 0.012 - cowlY) * Math.sin((t * Math.PI) / 2) ** 0.85 }
    if (s >= sR) return Hroof - 0.012 * ((s - 0.45) / 0.075) ** 2
    const t = clamp((sR - s) / (sR - sT)); return Hroof - 0.0045 - (Hroof - 0.0045 - deckY) * t ** 1.55
  }
  /** The shoulder's height under the glass. */
  const belt = (X: number) => 0.735 + 0.045 * bump(X, xr, 0.55)
  /** The glasshouse's half width at a height: in from the shoulder by a ledge, drawn in towards the roof (tumblehome). */
  const glasshouse = (X: number, Y: number) => {
    const s = X / L, b = B(X), yb = belt(X), g0 = b - 0.075 - 0.07 * smooth(0.55, sC + 0.02, s) - 0.06 * smooth(0.2, sT, s)
    return g0 - 0.17 * clamp((Y - yb) / (Hroof - yb)) ** 1.25
  }
  const roofAt = (X: number, u: number, g: number) => roof(X / L) - 0.065 * clamp(u / Math.max(g, 0.05)) ** 2.4
  const inCabin = (X: number, Y: number, u: number) => {
    const s = X / L
    if (s < sT - 0.01 || s > sC + 0.005 || Y < belt(X) - 0.06) return false
    const g = glasshouse(X, Y)
    return u <= g && Y <= roofAt(X, u, g)
  }

  // ── Recesses: lamps, grille and intakes, the plate, the diffuser (a part of the skin taken in) ──
  const lampLow = (q: number) => 0.452 + 0.04 * clamp((q - 0.5) / 0.45)
  const lampZone = (Y: number, u: number, b: number) => { const q = u / b, hi = 0.512 + 0.035 * clamp((q - 0.5) / 0.45); return q > 0.47 && q < 0.95 && Y > lampLow(q) && Y < hi - 0.03 * clamp((0.62 - q) / 0.15) }
  const grilleZone = (Y: number, u: number, b: number) => Y > 0.215 && Y < 0.41 && u < b * (0.36 + 0.16 * (0.41 - Y) / 0.195)
  const intakeZone = (Y: number, u: number, b: number) => Y > 0.2 && Y < 0.34 && u > b * 0.62 && u < b * 0.88
  const tailZone = (Y: number, u: number, b: number) => Y > 0.66 && Y < 0.705 && u < b * 0.97
  const plateZone = (Y: number, u: number) => Y > 0.4 && Y < 0.52 && u < 0.26
  const diffuserZone = (Y: number, u: number, b: number) => Y < 0.3 && u < b * 0.78
  const strake = (u: number) => [0.08, 0.24, 0.4, 0.56].some((c) => Math.abs(u - c) < 0.013)
  /** How deep the recess at a point of the nose or the tail is (metres in from the skin), or 0. */
  const recess = (atFront: boolean, Y: number, u: number) => {
    const b = B(atFront ? L - 0.1 : 0.1)
    if (atFront) return lampZone(Y, u, b) ? 0.045 : grilleZone(Y, u, b) ? 0.06 : intakeZone(Y, u, b) ? 0.045 : 0
    return tailZone(Y, u, b) ? 0.028 : plateZone(Y, u) ? 0.03 : diffuserZone(Y, u, b) && !strake(u) ? 0.12 * clamp((0.3 - Y) / 0.16) : 0
  }

  // ── The solid ──
  const solid = new Uint8Array(n)
  const archR = R + 0.045, inner = W / 2 - tyreW - 0.09
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const X = (x + 0.5) / S, Y = (y + 0.5) / S, u = Math.abs((z + 0.5) / S - zc)
    const f = front(Y, u), r0 = back(Y, u)
    if (X > f || X < r0) continue
    // The wheel arches: a round hole from the side in to the wheel well's inner wall.
    if ((Math.hypot(X - xr, Y - wheelY) < archR || Math.hypot(X - xf, Y - wheelY) < archR) && u > inner) continue
    const lower = Y >= bottom(X) && u <= side(X, Y) && Y <= lowerTop(X, u, B(X))
    if (!lower && !inCabin(X, Y, u)) continue
    // Recesses in the nose and the tail.
    if (X > f - 0.07 && X > f - recess(true, Y, u)) continue
    if (X < r0 + 0.13 && X < r0 + recess(false, Y, u)) continue
    solid[x + w * (z + d * y)] = 1
  }
  // Added on: the splitter under the nose, the side blades, the ducktail lip, the mirrors on their arms, the exhausts.
  const add = (x0: number, x1: number, y0: number, y1: number, test: (X: number, Y: number, u: number) => boolean) => {
    for (let y = Math.max(0, Math.floor(y0 * S)); y < Math.min(h, Math.ceil(y1 * S)); y++) for (let z = 0; z < d; z++) for (let x = Math.max(0, Math.floor(x0 * S)); x < Math.min(w, Math.ceil(x1 * S)); x++) {
      const X = (x + 0.5) / S, Y = (y + 0.5) / S, u = Math.abs((z + 0.5) / S - zc)
      if (test(X, Y, u)) solid[x + w * (z + d * y)] = 2
    }
  }
  const splitter = (X: number, Y: number, u: number) => Y >= 0.125 && Y < 0.16 && u < B(X) * 0.94 && X < L - 0.004 - 0.16 * (u / hw) ** 3 && X > L - 0.2
  add(L - 0.2, L, 0.12, 0.17, splitter)
  const blade = (X: number, Y: number, u: number) => X > xr + R + 0.1 && X < xf - R - 0.1 && Y > 0.15 && Y < 0.205 && u <= B(X) - 0.03 + 0.0125 && u > B(X) - 0.09
  add(xr, xf, 0.14, 0.21, blade)
  const lip = (X: number, Y: number, u: number) => X > back(Y, u) - 0.012 && X < 0.13 && Y > deckY - 0.01 && Y < deckY + 0.032 - 0.02 * (X / 0.13) && u < B(0.1) * 0.9
  add(0, 0.14, deckY - 0.02, deckY + 0.04, lip)
  const mx = sC * L - 0.16, my = 0.88, mu = (X: number) => glasshouse(X, my) + 0.075
  const mirror = (X: number, Y: number, u: number) => {
    const c = mu(mx)
    return ((X - mx) / 0.075) ** 2 + ((Y - my) / 0.045) ** 2 + ((u - c) / 0.065) ** 2 <= 1 || (Math.abs(X - mx - 0.02) < 0.014 && Math.abs(Y - (my - 0.035)) < 0.014 && u > c - 0.11 && u < c)
  }
  add(mx - 0.1, mx + 0.1, my - 0.07, my + 0.06, mirror)
  const pipeU = B(0.1) * 0.6, pipeY = 0.235, pipe = (X: number, Y: number, u: number) => X > back(Y, u) - 0.035 && X < back(Y, u) + 0.12 && Math.hypot(Y - pipeY, u - pipeU) < 0.044
  add(0, 0.25, pipeY - 0.05, pipeY + 0.05, pipe)

  // ── The skin: what is within two cells of the outside air (by edges and corners too), so it holds when made coarser ──
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
      if (near) depth[i] = layer + 8 // marked this layer; turned into its number once the layer is done
    }
    for (let i = 0; i < n; i++) if (depth[i] > 8) depth[i] -= 8
  }

  // ── What each cell of the skin is ──
  /** Where the windscreen is at a height, along the car (s): the A-pillar's line. */
  const screenAt = (Y: number) => sC - (sC - sH) * (2 / Math.PI) * Math.asin(clamp((Y - cowlY) / (Hroof - 0.012 - cowlY)) ** (1 / 0.85))
  const sideGlass = (X: number, Y: number) => {
    const s = X / L, yb = belt(X) + 0.035, t = clamp((Y - yb) / (Hroof - yb))
    // The opening runs from just behind the windscreen back to a kick-up at the C-pillar, with a thin B-pillar at the door's end.
    const fwd = screenAt(Y) - 0.045 / L, aft = 0.205 + 0.14 * t ** 0.8
    return Y > yb && Y < roof(s) - 0.115 && s < fwd && s > aft && !(s > 0.4 && s < 0.416)
  }
  /** Which way the skin faces at a cell, from what is solid round it (five cells a side): up, or out to the side. */
  const facing = (x: number, y: number, z: number) => {
    let gy = 0, gz = 0, gx = 0
    for (let c = -2; c <= 2; c++) for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
      const X = x + a, Y = y + b, Z = z + c
      if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d || !solid[X + w * (Z + d * Y)]) continue
      gx += a; gy += b; gz += c
    }
    const l = Math.hypot(gx, gy, gz) || 1
    return { up: -gy / l, out: Math.abs(gz) / l, ahead: -gx / l }
  }
  const nearArch = (X: number, Y: number, extra: number) => Math.min(Math.hypot(X - xr, Y - wheelY), Math.hypot(X - xf, Y - wheelY)) < archR + extra
  const kindAt = (x: number, y: number, z: number, added: boolean) => {
    const X = (x + 0.5) / S, Y = (y + 0.5) / S, u = Math.abs((z + 0.5) / S - zc), s = X / L, b = B(X)
    if (added) {
      if (Y < 0.21) return K.carbon
      if (Math.hypot(Y - pipeY, u - pipeU) < 0.05 && X < 0.3) return Math.hypot(Y - pipeY, u - pipeU) < 0.028 ? K.liner : K.chrome
      if (X < 0.15) return K.carbon
      // A mirror: its cap painted, its glass dark at its back, its arm gloss black.
      const cap = ((X - mx) / 0.075) ** 2 + ((Y - my) / 0.045) ** 2 + ((u - mu(mx)) / 0.065) ** 2 <= 1
      return !cap ? K.gloss : X < mx - 0.045 ? K.gloss : paint
    }
    // The wheel wells, lined dark: the cells round the arch's cut, in from the side.
    if (u > inner - 1 / S && nearArch(X, Y, 1.6 / S)) { const f = facing(x, y, z); if (f.out < 0.6 && f.up < 0.3) return K.liner }
    // The nose.
    if (X > front(Y, u) - 0.11) {
      const bf = B(L - 0.1), q = u / bf
      if (lampZone(Y, u, bf)) return q > 0.85 ? K.amber : Y < lampLow(q) + 0.012 ? K.gloss : K.head
      if (grilleZone(Y, u, bf)) return (y + (Math.floor(z / 2) & 1)) % 3 === 0 ? K.grille : K.liner
      if (intakeZone(Y, u, bf)) return Math.abs(q - 0.75) < 0.02 ? K.carbon : K.liner
      if (Y < 0.2) return K.carbon
    }
    // The tail.
    if (X < back(Y, u) + 0.15) {
      const bt = B(0.1)
      if (tailZone(Y, u, bt)) return u > bt * 0.14 && u < bt * 0.28 ? K.reverse : K.tail
      if (plateZone(Y, u)) return u > 0.235 || Y < 0.415 || Y > 0.505 ? K.liner : K.plate
      if (diffuserZone(Y, u, bt)) return K.carbon
    }
    // The tail lamps wrap round onto the sides a little.
    if (X < 0.16 && Y > 0.66 && Y < 0.705 && u > b - 0.04) return K.tail
    const lower = Y >= bottom(X) && u <= side(X, Y) && Y <= lowerTop(X, u, b)
    if (!lower && Y > belt(X) - 0.01 && s > sT - 0.012 && s < sC + 0.01) {
      // The glasshouse, by which way its skin faces: the windscreen, the roof and the rear glass on top; the side glass on its sides.
      const f = facing(x, y, z), g = glasshouse(X, Y)
      if (f.up + Math.max(0, f.ahead) > f.out * 1.1) {
        if (s > sH - 0.004) return Y < cowlY + 0.025 || u > g - 0.04 ? K.gloss : K.screen
        if (s < sR - 0.01 && s > 0.13 && s < 0.315 && u < g - 0.07) return K.glass
        return paint
      }
      if (sideGlass(X, Y)) return K.glass
      // The A-pillars and the B-pillar gloss black; above and behind the glass, paint.
      return s > screenAt(Y) - 0.045 / L || (s > 0.395 && s < 0.421 && Y > belt(X) + 0.03 && Y < roof(s) - 0.04) ? K.gloss : paint
    }
    // Door handles: flush, dark, under the shoulder line.
    if (s > 0.468 && s < 0.49 && Y > 0.6 && Y < 0.625 && u > side(X, Y) - 0.03) return K.gloss
    return paint
  }
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const i = x + w * (z + d * y)
    if (depth[i] === 1) kinds[i] = kindAt(x, y, z, solid[i] === 2)
  }
  // The skin's inner layer is what its outer layer is beside it (glass wherever any of it is glass), so nothing of
  // another kind shows through a pane.
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
      else if (!first || (Math.abs(a) + Math.abs(b) + Math.abs(c) === 1)) first = kinds[j]
    }
    kinds[i] = glass || first || kindAt(x, y, z, solid[i] === 2)
  }

  // Notches the shapes leave where they meet (a splitter's end against a corner): air between two opposite pairs of the skin, filled.
  for (let y = 1; y < h - 1; y++) for (let z = 1; z < d - 1; z++) for (let x = 1; x < w - 1; x++) {
    const i = x + w * (z + d * y)
    if (kinds[i]) continue
    const pairs = (kinds[i - 1] && kinds[i + 1] ? 1 : 0) + (kinds[i - w] && kinds[i + w] ? 1 : 0) + (kinds[i - w * d] && kinds[i + w * d] ? 1 : 0)
    if (pairs >= 2) kinds[i] = mostAround(kinds, [w, h, d], i, (k) => k === paint)
  }

  // ── The wheels: tyres with rounded shoulders, ten-spoke rims over dark barrels and yellow calipers ──
  for (const xm of [xr, xf]) for (const left of [true, false]) {
    const z0 = left ? zc - (W / 2 - 0.005) : zc + (W / 2 - 0.005) - tyreW, z1 = z0 + tyreW
    for (let y = Math.floor((wheelY - R) * S); y <= Math.ceil((wheelY + R) * S); y++) for (let z = Math.floor(z0 * S); z < Math.ceil(z1 * S); z++) for (let x = Math.floor((xm - R) * S); x <= Math.ceil((xm + R) * S); x++) {
      if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) continue
      const X = (x + 0.5) / S, Y = (y + 0.5) / S, Z = (z + 0.5) / S, r = Math.hypot(X - xm, Y - wheelY)
      const out = left ? Z - z0 : z1 - Z // depth in from the outer face
      // Rounded shoulders: the tread's corners pulled in.
      const shoulder = Math.min(out, tyreW - out)
      if (r > R - 0.03 + Math.min(0.03, shoulder * 0.6) || r > R) continue
      const i = x + w * (z + d * y), a = Math.atan2(Y - wheelY, X - xm)
      let kind: number
      if (r > R * 0.7) kind = K.tyre
      else if (out < 0.025) {
        // The face: a lip round the rim, ten spokes in pairs, a centre cap; between the spokes, nothing: the barrel shows.
        const spoke = Math.cos(5 * a) > 0.62 || Math.cos(5 * a + 0.55) > 0.86
        kind = r > R * 0.62 ? K.rim : r < R * 0.16 ? (r < R * 0.07 ? K.chrome : K.barrel) : spoke ? K.rim : 0
      } else if (out < 0.06) {
        // Behind the spokes: a caliper over the disc, towards the car's middle.
        const toward = xm < L / 2 ? Math.cos(a) > 0.55 : Math.cos(a) < -0.55
        kind = r > R * 0.3 && r < R * 0.56 && toward && Math.sin(a) > -0.2 ? K.caliper : r < R * 0.56 ? K.alloy : K.barrel
      } else kind = K.barrel
      kinds[i] = kind
    }
  }

  // ── Inside: a floor, a tunnel, two bucket seats, a dash and its gauge hood, a wheel on its column ──
  const [ex, ey, ez] = o.eye, dz = Math.abs(ez - zc)
  const fill = (x0: number, x1: number, y0: number, y1: number, test: (X: number, Y: number, u: number, zs: number) => number) => {
    for (let y = Math.max(0, Math.floor(y0 * S)); y < Math.min(h, Math.ceil(y1 * S)); y++) for (let z = 0; z < d; z++) for (let x = Math.max(0, Math.floor(x0 * S)); x < Math.min(w, Math.ceil(x1 * S)); x++) {
      const i = x + w * (z + d * y)
      if (kinds[i] || outside[i]) continue
      const Z = (z + 0.5) / S, kind = test((x + 0.5) / S, (y + 0.5) / S, Math.abs(Z - zc), Z - zc)
      if (kind) kinds[i] = kind
    }
  }
  const cab0 = ex - 0.55, cab1 = sC * L
  fill(cab0 - 0.4, cab1, 0.17, 0.23, () => K.dash)
  fill(cab0, cab1, 0.23, 0.44, (X, Y, u) => u < 0.1 - (Y > 0.4 ? 0.02 : 0) ? (Y > 0.42 && X > ex + 0.1 && X < ex + 0.2 && u < 0.03 ? K.alloy : K.dash) : 0)
  for (const sz of [-dz, dz]) {
    const cx = ex + 0.06
    fill(cx - 0.5, cx + 0.3, 0.22, ey + 0.02, (X, Y, _u, zs) => {
      const q = Math.abs(zs - sz)
      if (q > 0.25) return 0
      const bolster = q > 0.16
      // The cushion, raised at its sides.
      if (X > cx - 0.24 && X < cx + 0.26 && Y < 0.36 + (bolster ? 0.06 : 0) - 0.04 * clamp((X - cx) / 0.26)) return bolster ? K.seat : K.insert
      // The back, leaning back, its sides forward round the shoulders; the headrest narrower above it.
      const lean = cx - 0.24 - (Y - 0.36) * 0.28, thick = bolster ? 0.15 : 0.1
      if (Y > 0.3 && Y < ey - 0.1 && X < lean + thick && X > lean - 0.03) return bolster ? K.seat : K.insert
      if (Y >= ey - 0.12 && Y < ey + 0.02 && q < 0.13 && X < lean + 0.08 && X > lean - 0.03) return K.seat
      return 0
    })
  }
  // The dash: a slab under the windscreen, its top falling towards the seats, a hood over the driver's gauges.
  const dashBack = ex + 0.42
  fill(dashBack, cab1 + 0.05, 0.5, cowlY + 0.02, (X, Y, u, zs) => {
    if (u > glasshouse(X, Y) - 0.005 && Y > belt(X) - 0.02) return 0
    const lid = 0.775 + 0.03 * clamp((X - dashBack) / 0.3)
    if (Y < lid) return Y > lid - 0.025 && X < dashBack + 0.03 ? K.alloy : K.dash
    return Math.abs(zs + (ez < zc ? dz : -dz)) < 0.14 && X < dashBack + 0.14 && Y < lid + 0.05 ? K.dash : 0
  })
  // The wheel: a ring leaning back towards the driver, its middle low, three spokes and a hub, on a column into the dash.
  const wx = dashBack - 0.16, wy = ey - 0.25, wr = 0.155, lean = 0.36
  const e1 = [-Math.sin(lean), Math.cos(lean)], nrm = [Math.cos(lean), Math.sin(lean)]
  fill(wx - 0.25, wx + 0.35, wy - 0.2, wy + 0.2, (X, Y, _u, zs) => {
    const vx = X - wx, vy = Y - wy, vz = zs - (ez - zc), a = vx * e1[0] + vy * e1[1], c = vx * nrm[0] + vy * nrm[1], r = Math.hypot(a, vz)
    if (Math.abs(c) < 0.022 && Math.abs(r - wr) < 0.02) return K.gloss
    if (Math.abs(c) < 0.018 && r < wr && (r < 0.045 || Math.abs(vz) < 0.016 && a < 0 || Math.abs(a + 0.01) < 0.016)) return r < 0.045 ? K.dash : K.alloy
    // The column: from the hub forward and down into the dash.
    const t = c, along = [vx - t * nrm[0], vy - t * nrm[1]]
    return t > 0 && t < 0.32 && Math.hypot(along[0] + t * 0.3 * Math.sin(lean), along[1] + t * 0.3, vz) < 0.028 ? K.dash : 0
  })
  return { cells: kinds, size: [w, h, d] }
}

/**
 * A look made coarser by `by` along each side, keeping its shell (#39): a coarse cell is filled where a third of its
 * fine cells are, and also wherever it holds some of the skin and touches by a face a coarse cell that holds air shut
 * inside (air no flood from the box's edge reaches). A skin one or two cells thick fills a third of no coarse cell,
 * so the old rule opened the saloon's roof and pillars at 5 and 10 cm; this one cannot open a way from outside to
 * what is shut in. Its kind is the one most of its fine cells are, glass counting for less.
 */
export function coarser(kinds: ArrayLike<number>, size: readonly [number, number, number], by: number): { kinds: Uint16Array; size: [number, number, number] } {
  const [w, h, d] = size, cs: [number, number, number] = [Math.ceil(w / by), Math.ceil(h / by), Math.ceil(d / by)]
  // The air shut inside: what a flood by faces from the box's edge does not reach.
  const outside = outsideAir(kinds, size)
  const cn = cs[0] * cs[1] * cs[2], out = new Uint16Array(cn), shut = new Uint8Array(cn), best = new Uint16Array(cn)
  const count = new Map<number, number>()
  for (let y = 0; y < cs[1]; y++) for (let z = 0; z < cs[2]; z++) for (let x = 0; x < cs[0]; x++) {
    count.clear()
    let filled = 0, inside = 0
    for (let dy = 0; dy < by; dy++) for (let dz = 0; dz < by; dz++) for (let dx = 0; dx < by; dx++) {
      const X = x * by + dx, Y = y * by + dy, Z = z * by + dz
      if (X >= w || Y >= h || Z >= d) continue
      const i = X + w * (Z + d * Y), k = kinds[i]
      if (!k) { if (!outside[i]) inside++; continue }
      filled++
      count.set(k, (count.get(k) ?? 0) + ((k & 15) === GLASS ? 0.6 : 1))
    }
    const c = x + cs[0] * (z + cs[2] * y)
    if (inside) shut[c] = 1
    let b = 0, m = 0
    for (const [kk, v] of [...count].sort((p, q) => p[0] - q[0])) if (v > m) { m = v; b = kk }
    best[c] = b
    if (filled * 3 >= by * by * by) out[c] = b
  }
  // The skin's cells beside air shut in: filled, so nothing shut in shows through.
  for (let y = 0; y < cs[1]; y++) for (let z = 0; z < cs[2]; z++) for (let x = 0; x < cs[0]; x++) {
    const c = x + cs[0] * (z + cs[2] * y)
    if (out[c] || !best[c]) continue
    const near = shut[c] || (x > 0 && shut[c - 1]) || (x < cs[0] - 1 && shut[c + 1]) || (z > 0 && shut[c - cs[0]]) || (z < cs[2] - 1 && shut[c + cs[0]]) || (y > 0 && shut[c - cs[0] * cs[2]]) || (y < cs[1] - 1 && shut[c + cs[0] * cs[2]])
    if (near) out[c] = best[c]
  }
  sealLeaks(out, cs)
  return { kinds: out, size: cs }
}

const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const

/** Which empty cells of a grid outside air reaches by faces from the box's edge (1); the other empty ones are shut in. */
export function outsideAir(kinds: ArrayLike<number>, [w, h, d]: readonly [number, number, number]): Uint8Array {
  const outside = new Uint8Array(w * h * d), queue = new Int32Array(w * h * d)
  let head = 0, tail = 0
  const reach = (i: number) => { if (!kinds[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i } }
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!x || !y || !z || x === w - 1 || y === h - 1 || z === d - 1) reach(x + w * (z + d * y))
  while (head < tail) {
    const i = queue[head++], x = i % w, z = Math.floor(i / w) % d, y = Math.floor(i / (w * d))
    if (x > 0) reach(i - 1); if (x < w - 1) reach(i + 1)
    if (z > 0) reach(i - w); if (z < d - 1) reach(i + w)
    if (y > 0) reach(i - w * d); if (y < h - 1) reach(i + w * d)
  }
  return outside
}

/** The cells of air shut inside that touch outside air across an edge or a corner: where a ray passes between two cells. */
export function leaksOf(kinds: ArrayLike<number>, size: readonly [number, number, number]): number[] {
  const [w, h, d] = size, outside = outsideAir(kinds, size), found: number[] = []
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const i = x + w * (z + d * y)
    if (kinds[i] || outside[i]) continue
    let near = false
    for (let b = -1; b <= 1 && !near; b++) for (let c = -1; c <= 1 && !near; c++) for (let a = -1; a <= 1 && !near; a++) {
      const X = x + a, Y = y + b, Z = z + c
      if (X >= 0 && Y >= 0 && Z >= 0 && X < w && Y < h && Z < d && outside[X + w * (Z + d * Y)]) near = true
    }
    if (near) found.push(i)
  }
  return found
}

/**
 * The kind most of a cell's filled faces are: paint and glass first, a lamp only among lamps, a tie to the lower kind.
 * `paint` says which kinds are paint (steel, without it).
 */
export function mostAround(kinds: ArrayLike<number>, [w, h, d]: readonly [number, number, number], i: number, paint: (k: number) => boolean = (k) => (k & 15) === STEEL): number {
  const x = i % w, z = Math.floor(i / w) % d, y = Math.floor(i / (w * d)), tally = new Map<number, number>()
  for (const [a, b, c] of FACES) {
    const X = x + a, Y = y + b, Z = z + c
    if (X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d) continue
    const k = kinds[X + w * (Z + d * Y)]
    if (k) tally.set(k, (tally.get(k) ?? 0) + ((k & 15) === LAMP ? 0.25 : paint(k) || (k & 15) === GLASS ? 1.5 : 1))
  }
  let best = 0, top = -1
  for (const [k, v] of [...tally].sort((p, q) => p[0] - q[0])) if (v > top) { top = v; best = k }
  return best
}

/**
 * Seals a look where a ray would pass between two cells that meet only at an edge or a corner (#39): each cell of air
 * shut inside that touches outside air so is filled from inside, with `mostAround`, so the outside does not change.
 * In place; answers how many it filled.
 */
export function sealLeaks(kinds: Uint16Array, size: readonly [number, number, number], paint?: (k: number) => boolean): number {
  // A cell shut in that meets outside air only at a corner may have no filled face until the cells beside it are filled: again, then.
  let filled = 0
  for (let pass = 0; pass < 4; pass++) {
    const fill = leaksOf(kinds, size).map((i) => [i, mostAround(kinds, size, i, paint)]).filter(([, k]) => k)
    for (const [i, k] of fill) kinds[i] = k
    filled += fill.length
    if (!fill.length) break
  }
  return filled
}
