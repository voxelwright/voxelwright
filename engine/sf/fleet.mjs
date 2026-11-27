// The SF realm's hand-built vehicles (#450): what runs the city's streets and rails that no kept record has. Each
// is written here as shapes in metres, laid in cells of 2.5 or 5 cm: a streetcar of the F's kind, a city bus, a
// trolleybus under its poles, a delivery van, a box truck, and the cable car. Nothing says whose: no operator's
// name or wordmark, only the colours a street has.
//
// Each builder returns { name, kind, per, cells, size, motor?, seats?, paint, tyre }: `cells` the look's kinds (x along
// its length, front at +x, then z across, then y up), `per` its cells to a body cell (10 cm), `paint` and `tyre` the
// kinds that are its paint and its tyres (sf/cars.mjs `roles`: hubs, poles, brass and lining are trim). The van and the truck
// have a motor and seats and are driven as any kept car is; the rest are too long for a living body (96 cells) and
// are driven by the street (page/street.ts).

import { COUPE_KINDS, GT_COUPE, sculptCoupe } from '../page/car-sculpt.ts'

const STEEL = 12, GLASS = 11, PLASTER = 9, WOOD = 10, ROOFING = 14, LAMP = 15
const k = (material, colour = 0) => material | (colour << 8)
/** A hue (0 red, 3 orange-yellow, 8 green, 16 blue) in a tone (0 palest .. 6 dark, 7 to 9 dusty). */
const hue = (h, tone) => 16 + h * 10 + tone
/** A grey: 0 white to 14 black. */
const grey = (step) => 1 + step

function grid(lengthM, heightM, widthM, per) {
  const s = per * 10, W = Math.ceil(lengthM * s), H = Math.ceil(heightM * s), D = Math.ceil(widthM * s), cells = new Uint16Array(W * H * D)
  const c = (m) => Math.round(m * s)
  const set = (x, y, z, v) => { if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v }
  const get = (x, y, z) => (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D ? cells[x + W * (z + D * y)] : 0)
  /** A box in metres: [x0, x1) along, [y0, y1) up, [z0, z1) across. */
  const box = (x0, x1, y0, y1, z0, z1, v) => { for (let y = c(y0); y < c(y1); y++) for (let z = c(z0); z < c(z1); z++) for (let x = c(x0); x < c(x1); x++) set(x, y, z, v) }
  /** A box with its four upright edges rounded by `r` metres in plan. */
  const rounded = (x0, x1, y0, y1, z0, z1, r, v) => {
    const R = r * s
    for (let y = c(y0); y < c(y1); y++) for (let z = c(z0); z < c(z1); z++) for (let x = c(x0); x < c(x1); x++) {
      const dx = Math.max(c(x0) + R - x - 0.5, 0, x + 0.5 - (c(x1) - R)), dz = Math.max(c(z0) + R - z - 0.5, 0, z + 0.5 - (c(z1) - R))
      if (Math.hypot(dx, dz) <= R) set(x, y, z, v)
    }
  }
  /**
   * A wheel: its middle along and up, across from z0 to z1, its radius; a tyre round a hub. With `cap`, the hub's
   * outer faces have a lip round the rim, five nuts and a cap in the middle in it.
   */
  const wheel = (xm, ym, z0, z1, r, tyre, hub, cap = 0) => {
    for (let y = c(ym - r); y <= c(ym + r); y++) for (let x = c(xm - r); x <= c(xm + r); x++) {
      const d = Math.hypot(x - c(xm), y - c(ym)), R = r * s
      if (d > R) continue
      const a = Math.atan2(y - c(ym), x - c(xm)), nut = Math.hypot(d * Math.cos(a) - 0.32 * R * Math.cos(Math.round(a / (Math.PI * 0.4)) * Math.PI * 0.4), d * Math.sin(a) - 0.32 * R * Math.sin(Math.round(a / (Math.PI * 0.4)) * Math.PI * 0.4)) < 0.07 * R
      const face = cap && d < R * 0.55 && (d > R * 0.48 || d < R * 0.14 || nut)
      for (let z = c(z0); z < c(z1); z++) set(x, y, z, d >= R * 0.55 ? tyre : face && (z === c(z0) || z === c(z1) - 1) ? cap : hub)
    }
  }
  /** Keeps only what has air beside it: a hollow shell, so a look is its outside (and what shows through glass). */
  const hollow = () => {
    const out = cells.slice()
    for (let y = 1; y < H - 1; y++) for (let z = 1; z < D - 1; z++) for (let x = 1; x < W - 1; x++) {
      const i = x + W * (z + D * y)
      if (cells[i] && get(x + 1, y, z) && get(x - 1, y, z) && get(x, y + 1, z) && get(x, y - 1, z) && get(x, y, z + 1) && get(x, y, z - 1)) out[i] = 0
    }
    cells.set(out)
  }
  return { W, H, D, cells, c, s, set, get, box, rounded, wheel, hollow }
}

/**
 * A long box on wheels with windows down its sides: a bus's or a streetcar's body. Below the belt one colour, above
 * another, windows in a band with pillars between, doors where `doors` says (metres along), a roof, seats inside.
 */
function coach(g, o) {
  const { L, Wd, floor, roof, lower, upper, belt, beltAt, win0, win1, pitch, doors, nose = 0.6, glass = k(GLASS), seat } = o
  // The shell, its ends rounded.
  g.rounded(0, L, floor, roof, 0, Wd, nose, lower)
  g.rounded(0, L, beltAt, roof, 0, Wd, nose, upper)
  if (belt) g.rounded(0, L, beltAt - 0.12, beltAt, 0, Wd, nose, belt)
  // Windows down both sides, pillars between; the ends glazed too.
  for (let x = 0.5; x < L - 0.6; x += pitch) {
    const x0 = x + 0.08, x1 = Math.min(x + pitch - 0.08, L - 0.5)
    for (const [z0, z1] of [[0, 0.06], [Wd - 0.06, Wd]]) g.box(x0, x1, win0, win1, z0, z1, glass)
  }
  g.box(0, 0.08, win0 - 0.3, win1, 0.35, Wd - 0.35, glass)
  g.box(L - 0.08, L, win0, win1, 0.35, Wd - 0.35, glass)
  for (const [d0, d1] of doors) g.box(d0, d1, floor + 0.15, win1, Wd - 0.08, Wd, glass)
  g.hollow()
  // Inside: a floor and rows of seats, seen through the glass.
  g.box(0.3, L - 0.3, floor, floor + 0.12, 0.1, Wd - 0.1, k(ROOFING, grey(11)))
  for (let x = 1.5; x < L - 1.5; x += 0.9) for (const [z0, z1] of [[0.15, 0.9], [Wd - 0.9, Wd - 0.15]]) {
    g.box(x, x + 0.45, floor + 0.12, floor + 0.55, z0, z1, seat)
    g.box(x + 0.4, x + 0.5, floor + 0.55, floor + 1.0, z0, z1, seat)
  }
}

/** A streetcar of the F's kind (a 1940s car, still run on Market and the Embarcadero): cream and green, a pole to the wire. */
export function streetcar() {
  const per = 2, L = 14.2, Wd = 2.7, g = grid(L, 3.9, Wd, per)
  coach(g, { L, Wd, floor: 0.75, roof: 3.05, lower: k(STEEL, hue(8, 6)), upper: k(PLASTER, hue(3, 0)), belt: k(STEEL, hue(3, 4)), beltAt: 1.55, win0: 1.6, win1: 2.5, pitch: 0.95, doors: [[2.0, 3.1], [10.9, 12.0]], nose: 1.2, seat: k(WOOD, hue(2, 8)) })
  // A domed roof, the pole and its rope, headlamp, bumpers.
  g.rounded(0.6, L - 0.6, 3.05, 3.2, 0.3, Wd - 0.3, 1.0, k(ROOFING, grey(9)))
  for (let i = 0; i < 160; i++) { const t = i / 160; g.box(4 + t * 5.5, 4.08 + t * 5.5, 3.2 + t * 0.65, 3.27 + t * 0.65, Wd / 2 - 0.03, Wd / 2 + 0.03, k(STEEL, grey(12))) }
  g.box(L - 0.05, L, 1.0, 1.25, Wd / 2 - 0.15, Wd / 2 + 0.15, k(LAMP, 1))
  for (const x of [0, L - 0.1]) g.box(x, x + 0.1, 0.55, 0.75, 0.2, Wd - 0.2, k(STEEL, grey(12)))
  // Two bogies, four wheels each, under the floor.
  for (const xm of [3.0, L - 3.0]) { g.box(xm - 1.2, xm + 1.2, 0.35, 0.75, 0.35, Wd - 0.35, k(STEEL, grey(13))); for (const dx of [-0.8, 0.8]) for (const [z0, z1] of [[0.3, 0.45], [Wd - 0.45, Wd - 0.3]]) g.wheel(xm + dx, 0.33, z0, z1, 0.33, k(STEEL, grey(12)), k(STEEL, grey(8))) }
  // A destination board over each end's windows, and vents along the roof.
  for (const x of [0.02, L - 0.08]) { g.box(x, x + 0.06, 2.6, 2.9, Wd / 2 - 0.6, Wd / 2 + 0.6, k(STEEL, grey(13))); g.box(x - 0.01, x + 0.07, 2.66, 2.84, Wd / 2 - 0.52, Wd / 2 + 0.52, k(LAMP, hue(3, 4))) }
  for (let x = 1.6; x < L - 1.6; x += 1.4) g.box(x, x + 0.5, 3.2, 3.3, Wd / 2 - 0.35, Wd / 2 + 0.35, k(ROOFING, grey(7)))
  return { name: 'streetcar', kind: 'tram', per, cells: g.cells, size: [g.W, g.H, g.D], paint: [k(STEEL, hue(8, 6)), k(PLASTER, hue(3, 0)), k(STEEL, hue(3, 4))], tyre: [] }
}

/** A city bus: 12 m, low floor, red below and white above, black glass in a band. */
function bus(name, kind, poles) {
  const per = 2, L = 12.2, Wd = 2.6, g = grid(L, poles ? 4.6 : 3.3, Wd, per)
  coach(g, { L, Wd, floor: 0.35, roof: 3.0, lower: k(STEEL, hue(0, 5)), upper: k(STEEL, grey(0)), belt: k(STEEL, grey(13)), beltAt: 1.05, win0: 1.1, win1: 2.35, pitch: 1.35, doors: [[0.7, 1.9], [5.6, 6.8]], nose: 0.35, glass: k(GLASS, grey(13)), seat: k(ROOFING, hue(16, 6)) })
  // Windscreen down to the bumper, a destination board, lamps, the roof's boxes.
  g.box(L - 0.06, L, 0.9, 2.6, 0.25, Wd - 0.25, k(GLASS, grey(13)))
  g.box(L - 0.07, L, 2.62, 2.9, 0.4, Wd - 0.4, k(LAMP, hue(3, 4)))
  for (const z of [0.3, Wd - 0.6]) g.box(L - 0.05, L, 0.5, 0.7, z, z + 0.3, k(LAMP, 1))
  for (const z of [0.3, Wd - 0.6]) g.box(0, 0.05, 0.6, 0.85, z, z + 0.3, k(LAMP, hue(0, 4)))
  g.box(3.5, 8.5, 3.0, 3.25, 0.5, Wd - 0.5, k(STEEL, grey(2)))
  // Bumpers at both ends, a louvred engine grille low at the back, a mirror on an arm at each front corner, a rail
  // along the roof's edges.
  for (const x of [L - 0.1, 0]) g.box(x, x + 0.1, 0.3, 0.6, 0.08, Wd - 0.08, k(ROOFING, grey(12)))
  for (let y = 0.7; y < 1.0; y += 0.07) g.box(0, 0.03, y, y + 0.03, 0.5, Wd - 0.5, k(STEEL, grey(11)))
  for (const z of [0, Wd - 0.06]) { g.box(L - 0.35, L - 0.05, 2.25, 2.3, z, z + 0.06, k(STEEL, grey(12))); g.box(L - 0.12, L - 0.04, 1.75, 2.3, z, z + 0.06, k(STEEL, grey(13))) }
  for (const z of [0.12, Wd - 0.17]) g.box(0.5, L - 0.5, 3.0, 3.05, z, z + 0.05, k(STEEL, grey(9)))
  for (const xm of [2.6, L - 3.6]) {
    // The arch over each wheel lined dark in the side.
    for (let y = g.c(0.5); y <= g.c(1.1); y++) for (let x = g.c(xm - 0.62); x <= g.c(xm + 0.62); x++) { const d = Math.hypot(x - g.c(xm), y - g.c(0.5)); if (d > 0.5 * g.s && d < 0.6 * g.s) for (let z = 0; z < g.D; z++) if (g.get(x, y, z)) g.set(x, y, z, k(ROOFING, grey(12))) }
    for (const [z0, z1] of [[0, 0.3], [Wd - 0.3, Wd]]) g.wheel(xm, 0.5, z0, z1, 0.5, k(ROOFING, grey(13)), k(STEEL, grey(6)), k(STEEL, grey(10)))
  }
  if (poles) {
    // Two poles from the roof back to the wires, and the frame they stand on.
    g.box(6.5, 8.5, 3.25, 3.4, 0.6, Wd - 0.6, k(STEEL, grey(10)))
    for (const z of [0.9, Wd - 0.9]) for (let i = 0; i < 240; i++) { const t = i / 240; g.box(7.5 - t * 6.0, 7.56 - t * 6.0, 3.4 + t * 1.15, 3.46 + t * 1.15, z - 0.03, z + 0.03, k(STEEL, grey(13))) }
  }
  return { name, kind, per, cells: g.cells, size: [g.W, g.H, g.D], paint: [k(STEEL, hue(0, 5)), k(STEEL, grey(0))], tyre: [k(ROOFING, grey(13))] }
}
export const cityBus = () => bus('city bus', 'bus', false)
export const trolleybus = () => bus('trolleybus', 'trolley', true)

/**
 * Tuned SF vehicle handling archetypes (lengths in 10 cm cells; speeds in cells/s where 1 cell/s = 0.36 km/h).
 * Shared by `sf/cars.mjs` and `sf/fleet.mjs` so every vehicle class has distinct, responsive San Francisco feel:
 *   - coupe:  blistering acceleration & drift-happy rear balance (212 km/h)
 *   - saloon: punchy, planted, nimble executive saloon (171 km/h)
 *   - hatch:  nimble city saloon & SF taxi (160 km/h)
 *   - suv:    confident, high-grip hill climber (151 km/h)
 *   - van:    weighty, torquey urban delivery van (124 km/h)
 *   - truck:  heavy, torquey, unstoppable freight hauler (106 km/h)
 *   - bus:    heavy transit reference spec (kept ready if >96-cell living bodies are enabled)
 */
export const HANDLING = {
  coupe:  { power: 142, top: 590, grip: 1.24, steer: 0.62, tough: 220 },
  saloon: { power: 112, top: 475, grip: 1.38, steer: 0.58, tough: 210 },
  hatch:  { power: 100, top: 445, grip: 1.42, steer: 0.60, tough: 200 },
  suv:    { power: 96,  top: 420, grip: 1.48, steer: 0.54, tough: 280 },
  waitwhat: { power: 108, top: 440, grip: 1.52, steer: 0.58, tough: 270 },
  van:    { power: 84,  top: 345, grip: 1.32, steer: 0.48, tough: 360 },
  truck:  { power: 76,  top: 295, grip: 1.28, steer: 0.42, tough: 500 },
  bus:    { power: 70,  top: 265, grip: 1.35, steer: 0.38, tough: 620 },
}

/** A motor for something driven on four wheels, its feet at the wheels' middles (body cells), front two steering. */
const motorOf = (length, width, wheelX, spec, opts = {}) => ({
  front: 0,
  grip: spec.grip,
  power: spec.power,
  top: spec.top,
  steer: spec.steer,
  hover: 0, lift: 0, upright: 0, turns: 0, jump: 0,
  tough: spec.tough,
  feet: [[wheelX[0], 1], [wheelX[0], width - 1], [wheelX[1], 1], [wheelX[1], width - 1]].map(([x, z], i) => ({
    at: [x, opts.footY ?? 3.2, z],
    reach: opts.reach ?? 6,
    steers: i >= 2,
    drives: opts.awd ? true : i < 2,
  })),
})

/**
 * The GT coupe (#39): 4.5 m long, 1.28 m high, 1.92 m wide at 2.5 cm, sculpted from continuous shapes (page/car-sculpt.ts,
 * the same coupe G brings and the hand-written car wears): a low nose with recessed lamps and a honeycomb intake, fenders
 * over the wheels and haunches over the back ones, a fastback roof over a glasshouse that leans in, a full-width tail
 * lamp, a diffuser and twin exhausts; bucket seats, a dash and a wheel inside.
 */
export function sportsCoupe() {
  const PAINT = k(STEEL, hue(0, 4)), { cells, size } = sculptCoupe({ ...GT_COUPE, paint: PAINT })
  const [x0, x1] = GT_COUPE.wheels, body = [Math.ceil(size[0] / 4), Math.ceil(size[1] / 4), Math.ceil(size[2] / 4)], [ex, ey, ez] = GT_COUPE.eye
  return {
    name: 'sports coupe', kind: 'car', per: GT_COUPE.per, cells, size, body,
    motor: motorOf(body[0], body[2], [x0 * 10, x1 * 10], HANDLING.coupe, { footY: 3.0, reach: 5.5 }),
    seats: [[ex * 10 + 0.5, -1.2, ez * 10], [ex * 10 + 0.5, -1.2, body[2] - ez * 10]],
    eye: [ex * 10, ey * 10, ez * 10],
    paint: [PAINT], tyre: [COUPE_KINDS.tyre],
  }
}

/** A delivery van: 6 m, a tall white box with a sloped nose, sliding door, back doors. Driven like a car. */
export function van() {
  const per = 4, L = 6.0, Wd = 2.05, H = 2.6, g = grid(L, H, Wd, per), WHITE = k(STEEL, grey(1)), BLACK = k(ROOFING, grey(13)), TYRE = k(ROOFING, grey(14))
  g.rounded(0, L - 1.5, 0.35, H, 0, Wd, 0.15, WHITE)
  // The nose, a cell's row at a time so that nothing steps more than a cell: the grille's face, the bonnet's front
  // rounded over, the bonnet rising gently to the windscreen, the windscreen raked back, the roof's front rounded down.
  const cell = 1 / g.s
  const nose = (y) => y < 0.9 ? L : y < 1.12 ? L - 0.25 * (1 - Math.sqrt(Math.max(0, 1 - ((y - 0.9) / 0.22) ** 2))) : y < 1.2 ? L - 0.25 - ((y - 1.12) / 0.08) * 0.73 : y < 2.42 ? L - 0.98 - ((y - 1.2) / 1.22) * 0.5 : L - 1.48 - 0.16 * (1 - Math.sqrt(Math.max(0, 1 - ((y - 2.42) / 0.18) ** 2)))
  for (let y = 0.35; y < H; y += cell) g.rounded(0, nose(y + cell / 2), y, y + cell, 0, Wd, y < 1.2 ? 0.2 : 0.15, WHITE)
  for (let y = 1.25; y < 2.36; y += cell) { const x = nose(y + cell / 2); g.box(x - 2 * cell, x, y, y + cell, 0.12, Wd - 0.12, k(GLASS, grey(12))) }
  // Cab side windows, the sliding door with its window, seams and handles, a rubbing strip along each side, wheel
  // arches, marker lamps; the back doors with their windows, handles and seam, a plate, tall lamp clusters, a step.
  const SEAM = k(STEEL, grey(11)), TRIM = k(ROOFING, grey(12)), DARK_GLASS = k(GLASS, grey(13))
  for (const [z0, z1] of [[0, 0.04], [Wd - 0.04, Wd]]) {
    for (let y = 1.25; y < 2.0; y += cell) g.box(L - 1.75, nose(y + cell / 2) - 0.08, y, y + cell, z0, z1, k(GLASS, grey(12)))
    g.box(L - 2.85, L - 2.05, 1.35, 1.95, z0, z1, DARK_GLASS)
    for (const x of [L - 1.82, L - 2.95, 1.6]) g.box(x, x + 0.06, 0.45, 2.35, z0, z1, SEAM)
    g.box(L - 2.85, L - 1.85, 2.35, 2.4, z0, z1, SEAM)
    g.box(L - 3.15, L - 2.98, 1.2, 1.27, z0, z1, BLACK); g.box(L - 1.98, L - 1.85, 1.2, 1.27, z0, z1, BLACK)
    g.box(0.05, L - 0.9, 0.62, 0.72, z0, z1, TRIM)
    g.box(0.3, 0.42, 1.0, 1.08, z0, z1, k(LAMP, hue(3, 4))); g.box(L - 1.15, L - 1.05, 0.95, 1.03, z0, z1, k(LAMP, hue(3, 4)))
  }
  // The back: two doors, each with a window, the seam between, handles, a plate, the lamp clusters, a step under.
  g.box(0, 0.04, 0.45, 2.45, Wd / 2 - 0.02, Wd / 2 + 0.02, SEAM)
  for (const [z0, z1] of [[0.18, Wd / 2 - 0.1], [Wd / 2 + 0.1, Wd - 0.18]]) g.box(0, 0.04, 1.5, 2.2, z0, z1, DARK_GLASS)
  g.box(0, 0.05, 1.15, 1.22, Wd / 2 - 0.2, Wd / 2 - 0.06, BLACK); g.box(0, 0.05, 1.15, 1.22, Wd / 2 + 0.06, Wd / 2 + 0.2, BLACK)
  g.box(0, 0.05, 0.62, 0.78, Wd / 2 - 0.26, Wd / 2 + 0.26, k(PLASTER, grey(1))); g.box(0, 0.06, 0.66, 0.74, Wd / 2 - 0.2, Wd / 2 + 0.2, k(STEEL, hue(16, 5)))
  for (const z of [0.0, Wd - 0.14]) { g.box(0, 0.05, 1.3, 1.9, z, z + 0.14, k(LAMP, hue(0, 4))); g.box(0, 0.05, 1.12, 1.3, z, z + 0.14, k(LAMP, hue(3, 4))); g.box(0, 0.05, 0.98, 1.12, z, z + 0.14, k(LAMP, 1)) }
  // Headlamps set a cell into the nose in dark bezels, and a grille of bars recessed between them.
  for (const z of [0.15, Wd - 0.45]) { g.box(L - 0.05, L, 0.73, 0.97, z - 0.02, z + 0.32, BLACK); g.box(L - 0.05, L - 0.025, 0.75, 0.95, z, z + 0.3, k(LAMP, 1)); g.box(L - 0.025, L, 0.75, 0.95, z, z + 0.3, 0) }
  g.box(L - 0.04, L, 0.55, 0.72, 0.5, Wd - 0.5, TRIM)
  g.box(L - 0.05, L, 0.74, 1.0, 0.48, Wd - 0.48, BLACK)
  g.box(L - 0.025, L, 0.76, 0.98, 0.5, Wd - 0.5, 0)
  for (let y = 0.77; y < 0.98; y += 0.07) g.box(L - 0.05, L - 0.01, y, y + 0.025, 0.5, Wd - 0.5, k(STEEL, grey(6)))
  g.box(L - 0.08, L, 0.3, 0.5, 0.05, Wd - 0.05, BLACK); g.box(0, 0.08, 0.3, 0.5, 0.05, Wd - 0.05, BLACK); g.box(-0.0, 0.25, 0.28, 0.33, 0.3, Wd - 0.3, BLACK)
  for (const z of [-0.12, Wd]) g.box(L - 1.2, L - 1.1, 1.6, 1.85, Math.max(0, z), Math.min(Wd, z + 0.12), BLACK)
  // The wheel arches: a round well cut in from each side over the wheel, before the shell is hollowed so its walls stay.
  const arch = (x, y, xm) => Math.hypot(x - g.c(xm), y - g.c(0.36))
  for (const xm of [1.1, L - 1.3]) for (let y = 0; y <= g.c(0.85); y++) for (let x = g.c(xm - 0.5); x <= g.c(xm + 0.5); x++) if (arch(x, y, xm) < 0.43 * g.s) for (let z = 0; z < g.c(0.3); z++) { g.set(x, y, z, 0); g.set(x, y, g.D - 1 - z, 0) }
  g.hollow()
  // Two seats in the cab, seen through the glass.
  for (const z of [0.3, Wd - 0.85]) { g.box(L - 2.1, L - 1.6, 0.45, 0.95, z, z + 0.55, BLACK); g.box(L - 2.2, L - 2.05, 0.95, 1.6, z, z + 0.55, BLACK) }
  for (const xm of [1.1, L - 1.3]) {
    // The wells lined dark, a flare of dark trim round each one's lip on the body's sides.
    for (let y = 0; y <= g.c(0.92); y++) for (let x = g.c(xm - 0.56); x <= g.c(xm + 0.56); x++) for (let z = 0; z < g.D; z++) {
      const r = arch(x, y, xm), out = Math.min(z, g.D - 1 - z)
      if (g.get(x, y, z) && ((r < 0.47 * g.s && out < g.c(0.34)) || (r < 0.5 * g.s && out < 2))) g.set(x, y, z, TRIM)
    }
    for (const [z0, z1] of [[0, 0.22], [Wd - 0.22, Wd]]) g.wheel(xm, 0.36, z0, z1, 0.36, TYRE, k(STEEL, grey(10)), k(STEEL, grey(6)))
  }
  const size = [Math.round(L * 10), Math.round(H * 10), Math.round(Wd * 10)]
  return { name: 'delivery van', kind: 'van', per, cells: g.cells, size: [g.W, g.H, g.D], body: size, motor: motorOf(size[0], size[2], [11, 47], HANDLING.van), seats: [[42, 4.5, 6.5], [42, 4.5, 14]], paint: [WHITE], tyre: [TYRE] }
}

/** A box truck: 8 m, a cab and a dry-freight box behind it on six wheels. Driven like a car, more slowly. */
export function boxTruck() {
  const per = 4, L = 8.0, Wd = 2.45, H = 3.5, g = grid(L, H, Wd, per)
  const CAB = k(STEEL, grey(1)), BOX = k(STEEL, grey(3)), BLACK = k(ROOFING, grey(13)), TYRE = k(ROOFING, grey(14))
  const RAIL = k(STEEL, grey(5)), POST = k(STEEL, grey(4)), FRAME = k(STEEL, grey(12)), RIM = k(STEEL, grey(10)), SEAM = k(STEEL, grey(9))
  const GLASS_ = k(GLASS, grey(12)), AMBER = k(LAMP, hue(3, 4)), RED = k(LAMP, hue(0, 4)), WHITE = k(LAMP, 1)
  // ── The box: its floor 1.05 m up, aluminium panels between posts every 0.6 m, a rail along its top and its foot,
  // corner posts, and a strip of red and white tape along each side.
  const b0 = 0.05, b1 = 5.85, floor = 1.05
  g.box(b0, b1, floor, H, 0.03, Wd - 0.03, BOX)
  for (const [z0, z1] of [[0, 0.03], [Wd - 0.03, Wd]]) {
    for (let x = b0 + 0.6; x < b1 - 0.3; x += 0.6) g.box(x, x + 0.05, floor + 0.12, H - 0.12, z0, z1, POST)
    g.box(b0, b1, H - 0.12, H, z0, z1, RAIL); g.box(b0, b1, floor, floor + 0.15, z0, z1, RAIL)
    for (const x of [b0, b1 - 0.08]) g.box(x, x + 0.08, floor, H, z0, z1, RAIL)
    for (let x = b0 + 0.1, i = 0; x < b1 - 0.3; x += 0.3, i++) g.box(x, x + 0.3, floor + 0.2, floor + 0.28, z0, z1, k(PLASTER, i & 1 ? grey(0) : hue(0, 4)))
    // Marker lamps: amber at the front of the box, high and low; red at its back.
    g.box(b1 - 0.25, b1 - 0.15, H - 0.3, H - 0.2, z0, z1, AMBER); g.box(2.9, 3.0, floor + 0.35, floor + 0.43, z0, z1, AMBER); g.box(b0 + 0.15, b0 + 0.25, H - 0.3, H - 0.2, z0, z1, RED)
  }
  // The front of the box over the cab, its rail and the roof's edge.
  g.box(b0, b1, H - 0.04, H, 0.03, Wd - 0.03, RAIL)
  // The back: a roll-up door between its posts, ribbed, a handle and a latch bar, lamps in the rail over it, a plate,
  // and the bar against running under, on its brackets.
  g.box(0, b0, floor, H, 0.03, Wd - 0.03, RAIL)
  g.box(0, b0 + 0.02, floor + 0.1, H - 0.2, 0.15, Wd - 0.15, BOX)
  for (let y = floor + 0.18; y < H - 0.25; y += 0.24) g.box(0, b0 + 0.03, y, y + 0.03, 0.15, Wd - 0.15, SEAM)
  g.box(0, 0.06, floor + 0.12, floor + 0.2, Wd / 2 - 0.25, Wd / 2 + 0.25, BLACK)
  for (const z of [0.3, Wd / 2 - 0.1, Wd / 2 + 0.05, Wd - 0.35]) g.box(0, 0.04, H - 0.17, H - 0.12, z, z + 0.05, AMBER)
  // Tail lamps under the door, each a red brake lamp over an amber turn lamp and a white reversing lamp, big enough to read.
  for (const z of [0.06, Wd - 0.36]) { g.box(0, 0.04, floor - 0.3, floor - 0.02, z, z + 0.3, RED); g.box(0, 0.04, floor - 0.42, floor - 0.3, z, z + 0.18, AMBER); g.box(0, 0.04, floor - 0.42, floor - 0.3, z + 0.18, z + 0.3, WHITE) }
  g.box(0.05, 0.12, 0.62, 0.8, Wd / 2 - 0.26, Wd / 2 + 0.26, k(PLASTER, grey(1))); g.box(0.04, 0.11, 0.66, 0.76, Wd / 2 - 0.2, Wd / 2 + 0.2, k(STEEL, hue(16, 5)))
  g.box(0.08, 0.22, 0.42, 0.56, 0.12, Wd - 0.12, FRAME)
  for (const z of [0.5, Wd - 0.6]) g.box(0.15, 0.3, 0.56, floor, z, z + 0.1, FRAME)
  // ── Under the box: two frame rails and their cross members, a fuel tank and a step on the near side, a battery box on
  // the far, mud flaps behind the back wheels.
  for (const z of [0.55, Wd - 0.7]) g.box(0.2, 7.6, 0.62, 0.86, z, z + 0.15, FRAME)
  for (let x = 0.6; x < 5.6; x += 1.2) g.box(x, x + 0.1, 0.86, floor, 0.4, Wd - 0.4, FRAME)
  g.rounded(3.8, 5.2, 0.48, 0.95, 0.05, 0.55, 0.22, k(STEEL, grey(2)))
  for (const x of [4.05, 4.95]) g.box(x, x + 0.06, 0.46, 0.97, 0.04, 0.56, FRAME)
  g.box(3.3, 3.75, 0.5, 0.92, Wd - 0.55, Wd - 0.05, BLACK)
  for (const [z0, z1] of [[0.02, 0.32], [Wd - 0.32, Wd - 0.02]]) g.box(0.45, 0.5, 0.2, 0.75, z0, z1, BLACK)
  // ── The cab: its body squared off and rounded at the front corners, a short bonnet, a high windscreen.
  const c0 = 6.0
  g.rounded(c0, L - 0.25, 0.75, 2.85, 0.05, Wd - 0.05, 0.2, CAB)
  // The bonnet, a cell's row at a time: its front edge rounded over into its top.
  const cell = 1 / g.s, bonnet = (y) => (y < 1.3 ? L : L - 0.22 * (1 - Math.sqrt(Math.max(0, 1 - ((y - 1.3) / 0.25) ** 2))))
  for (let y = 0.55; y < 1.55; y += cell) g.rounded(c0 + 1.2, bonnet(y + cell / 2), y, y + cell, 0.08, Wd - 0.08, 0.25, CAB)
  g.box(c0, c0 + 0.08, 0.75, 2.85, 0.1, Wd - 0.1, FRAME)
  // A deflector over the cab's roof, up to the box's front.
  for (let i = 0; i < 16; i++) { const t = i / 16; g.box(c0 + 0.05, c0 + 0.9 - t * 0.85, 2.85 + t * 0.55, 2.85 + (t + 0.07) * 0.55, 0.15, Wd - 0.15, CAB) }
  // The windscreen in its frame, wipers, the side windows in the doors, door seams, handles and steps, a mirror on each door.
  g.box(L - 0.31, L - 0.25, 1.65, 2.6, 0.2, Wd - 0.2, GLASS_)
  g.box(L - 0.32, L - 0.25, 1.6, 1.65, 0.2, Wd - 0.2, BLACK)
  for (const z of [0.5, 1.3]) g.box(L - 0.33, L - 0.31, 1.66, 1.7, z, z + 0.55, BLACK)
  for (const [z0, z1] of [[0.05, 0.09], [Wd - 0.09, Wd - 0.05]]) {
    g.box(c0 + 0.35, L - 0.5, 1.7, 2.55, z0, z1, GLASS_)
    for (const x of [c0 + 0.22, L - 0.42]) g.box(x, x + 0.04, 0.75, 2.6, z0, z1, SEAM)
    g.box(c0 + 0.3, c0 + 0.5, 1.5, 1.56, z0, z1, BLACK)
    g.box(c0 + 0.3, L - 0.55, 0.45, 0.55, z0, z1, BLACK); g.box(c0 + 0.3, L - 0.55, 0.72, 0.78, z0, z1, BLACK)
    g.box(L - 0.6, L - 0.52, 1.75, 2.45, z0 < 1 ? 0 : Wd - 0.05, z0 < 1 ? 0.05 : Wd, BLACK)
  }
  // A grille of bars between the headlamps, the lamps, a bumper, the plate and amber lamps along the roof's front.
  // The grille's bars and the lamps set into the nose, each in a dark surround.
  g.box(L - 0.06, L, 0.7, 1.28, 0.55, Wd - 0.55, BLACK); g.box(L - 0.03, L, 0.73, 1.25, 0.58, Wd - 0.58, 0)
  for (let y = 0.76; y < 1.22; y += 0.1) g.box(L - 0.06, L - 0.01, y, y + 0.04, 0.58, Wd - 0.58, k(STEEL, grey(6)))
  for (const z of [0.15, Wd - 0.5]) {
    g.box(L - 0.06, L, 0.87, 1.32, z - 0.02, z + 0.37, BLACK)
    g.box(L - 0.06, L - 0.03, 1.05, 1.3, z, z + 0.35, WHITE); g.box(L - 0.06, L - 0.03, 0.9, 1.0, z, z + 0.35, AMBER); g.box(L - 0.03, L, 0.9, 1.3, z, z + 0.35, 0)
  }
  g.box(L - 0.12, L, 0.38, 0.62, 0.02, Wd - 0.02, k(STEEL, grey(8)))
  g.box(L - 0.01, L, 0.45, 0.58, Wd / 2 - 0.18, Wd / 2 + 0.18, k(PLASTER, grey(1)))
  for (const z of [0.5, 0.85, Wd / 2 - 0.05, Wd - 0.95, Wd - 0.6]) g.box(L - 0.5, L - 0.4, 2.85, 2.92, z, z + 0.1, AMBER)
  // The front wheels' wells, cut in from each side before the cab is hollowed so their walls stay.
  const well = (x, y) => Math.hypot(x - g.c(L - 1.1), y - g.c(0.48))
  for (let y = 0; y <= g.c(1.1); y++) for (let x = g.c(L - 1.7); x <= g.c(L - 0.5); x++) if (well(x, y) < 0.56 * g.s) for (let z = 0; z < g.c(0.36); z++) { g.set(x, y, z, 0); g.set(x, y, g.D - 1 - z, 0) }
  g.hollow()
  // Two seats and a wheel inside, seen through the glass.
  for (const z of [0.3, Wd - 0.85]) { g.box(c0 + 0.4, c0 + 0.9, 0.95, 1.45, z, z + 0.55, BLACK); g.box(c0 + 0.3, c0 + 0.45, 1.45, 2.2, z, z + 0.55, BLACK) }
  g.box(L - 0.75, L - 0.7, 1.4, 1.8, 0.4, 0.9, BLACK)
  for (const xm of [1.0, 2.2, L - 1.1]) for (const [z0, z1] of [[0, 0.3], [Wd - 0.3, Wd]]) g.wheel(xm, 0.48, z0, z1, 0.48, TYRE, RIM, FRAME)
  // The wells lined dark, and a dark flare round each one's lip in the cab's sides.
  for (let y = 0; y <= g.c(1.2); y++) for (let x = g.c(L - 1.8); x <= g.c(L - 0.4); x++) for (let z = 0; z < g.D; z++) {
    const r = well(x, y), out = Math.min(z, g.D - 1 - z)
    if (g.get(x, y, z) === CAB && ((r < 0.6 * g.s && out < g.c(0.4)) || (r < 0.64 * g.s && out < 2))) g.set(x, y, z, BLACK)
  }
  const size = [Math.round(L * 10), Math.round(H * 10), Math.round(Wd * 10)]
  return { name: 'box truck', kind: 'truck', per, cells: g.cells, size: [g.W, g.H, g.D], body: size, motor: motorOf(size[0], size[2], [16, 69], HANDLING.truck), seats: [[66, 9, 7], [66, 9, 17]], paint: [CAB, BOX], tyre: [TYRE] }
}

/**
 * The cable car, at 2.5 cm: the Powell car's 8.3 m with open benches at each end where riders face out, the closed
 * saloon between with its windows framed, a clerestory roof, running boards, brass poles to hold, the grip man's
 * lever and the maroon, cream and blue it is painted in, with gold lining.
 */
export function cableCar() {
  const per = 4, L = 8.3, Wd = 2.4, H = 3.25, g = grid(L, H, Wd, per)
  const MAROON = k(STEEL, hue(0, 6)), CREAM = k(PLASTER, hue(3, 0)), BLUE = k(STEEL, hue(16, 5)), GOLD = k(STEEL, hue(3, 4)), RED = k(STEEL, hue(0, 5))
  const TEAK = k(WOOD, hue(2, 8)), DARK = k(STEEL, grey(13)), ROOF = k(ROOFING, grey(12)), GLASS = k(11), LAMP_ = k(LAMP, 1), FLOOR = k(WOOD, hue(2, 9)), BRASS = k(STEEL, hue(3, 5))
  // Trucks and wheels under each end.
  for (const xm of [1.3, L - 1.3]) { g.box(xm - 0.7, xm + 0.7, 0.2, 0.45, 0.3, Wd - 0.3, DARK); for (const dx of [-0.45, 0.45]) for (const [z0, z1] of [[0.25, 0.35], [Wd - 0.35, Wd - 0.25]]) g.wheel(xm + dx, 0.24, z0, z1, 0.24, DARK, k(STEEL, grey(8))) }
  // Floor, running boards along both sides.
  g.box(0, L, 0.45, 0.6, 0.1, Wd - 0.1, FLOOR)
  for (const [z0, z1] of [[0, 0.12], [Wd - 0.12, Wd]]) g.box(0.1, L - 0.1, 0.4, 0.5, z0, z1, TEAK)
  // The saloon: maroon panels lined in gold below, cream above, windows in frames, doors' glass.
  const s0 = 2.5, s1 = L - 2.5
  for (const [z0, z1] of [[0.1, 0.2], [Wd - 0.2, Wd - 0.1]]) {
    g.box(s0, s1, 0.6, 1.3, z0, z1, MAROON); g.box(s0, s1, 1.3, 1.4, z0, z1, GOLD); g.box(s0, s1, 1.4, 2.6, z0, z1, CREAM)
    for (let x = s0 + 0.1; x < s1 - 0.5; x += 0.55) g.box(x + 0.06, x + 0.5, 1.55, 2.3, z0 + (z0 < 1 ? -0.01 : 0.03), z1 + (z0 < 1 ? -0.03 : 0.01), GLASS)
    for (let x = s0; x < s1; x += 0.55) g.box(x, x + 0.03, 0.65, 1.25, z0 - 0.01, z1 + 0.01, GOLD)
  }
  for (const x of [s0, s1 - 0.1]) { g.box(x, x + 0.1, 0.6, 2.6, 0.1, Wd - 0.1, CREAM); g.box(x, x + 0.1, 0.8, 2.3, Wd / 2 - 0.35, Wd / 2 + 0.35, GLASS) }
  // Open ends: benches along each side facing out, their backs, brass poles, a low wall at the very end.
  for (const [a, b] of [[0.15, s0], [s1, L - 0.15]]) {
    for (const [z0, z1] of [[0.15, 0.5], [Wd - 0.5, Wd - 0.15]]) g.box(a, b, 0.6, 0.85, z0, z1, TEAK)
    for (const [z0, z1] of [[0.45, 0.55], [Wd - 0.55, Wd - 0.45]]) g.box(a, b, 0.85, 1.25, z0, z1, TEAK)
    for (let x = a + 0.25; x < b - 0.1; x += 0.6) for (const z of [0.12, Wd - 0.15]) g.box(x, x + 0.04, 0.6, 2.6, z, z + 0.04, BRASS)
  }
  for (const x of [0, L - 0.1]) { g.box(x, x + 0.1, 0.6, 1.25, 0.1, Wd - 0.1, MAROON); g.box(x, x + 0.1, 1.25, 1.3, 0.1, Wd - 0.1, GOLD); g.box(x, x + 0.1, 1.3, 1.7, Wd / 2 - 0.55, Wd / 2 + 0.55, BLUE); g.box(x, x + 0.04, 1.4, 1.55, Wd / 2 - 0.1, Wd / 2 + 0.1, LAMP_) }
  // The grip man's lever in the front well, red and brass.
  g.box(1.9, 1.95, 0.6, 1.7, Wd / 2 - 0.03, Wd / 2 + 0.03, RED); g.box(1.85, 2.0, 1.65, 1.75, Wd / 2 - 0.05, Wd / 2 + 0.05, BRASS)
  // Roof over all of it, the clerestory along its middle with small windows, and boards at each end.
  g.box(0, L, 2.6, 2.75, 0, Wd, ROOF)
  g.box(0.3, L - 0.3, 2.75, 2.95, 0.5, Wd - 0.5, CREAM)
  for (let x = 0.5; x < L - 0.5; x += 0.3) for (const z of [0.49, Wd - 0.53]) g.box(x, x + 0.16, 2.8, 2.9, z, z + 0.04, GLASS)
  g.box(0.3, L - 0.3, 2.95, 3.05, 0.4, Wd - 0.4, ROOF)
  for (const x of [0.1, L - 0.2]) { g.box(x, x + 0.1, 2.75, 3.15, 0.7, Wd - 0.7, BLUE); g.box(x - 0.01, x + 0.11, 2.85, 3.05, 0.85, Wd - 0.85, k(PLASTER, grey(0))) }
  return { name: 'cable car', kind: 'cable', per, cells: g.cells, size: [g.W, g.H, g.D], paint: [MAROON, CREAM, BLUE], tyre: [] }
}

/** A WaitWhat autonomous electric crossover robotaxi (#57): pearl white, mint livery, perimeter LiDAR pods & clean sculpted hood. */
export function waitwhat() {
  const per = 4, L = 4.68, Wd = 1.98, H = 1.78, g = grid(L, H, Wd, per), midZ = Wd / 2
  const WHITE = k(STEEL, grey(0)), SILVER = k(STEEL, grey(4)), SLATE = k(STEEL, grey(11))
  const OBSIDIAN = k(ROOFING, grey(13)), TYRE = k(ROOFING, grey(14)), MINT = k(STEEL, hue(10, 4))
  const NAVY = k(STEEL, hue(15, 6)), GLASS_ = k(GLASS, grey(12)), HEAD = k(LAMP, 1)
  const TAIL = k(LAMP, hue(0, 4)), AMBER = k(LAMP, hue(2, 4)), CYAN = k(LAMP, hue(11, 4))
  const SEAT = k(ROOFING, grey(11)), WHITE_LAMP = k(LAMP, grey(0))
  g.rounded(0.10, L - 0.14, 0.30, 0.62, 0.04, Wd - 0.04, 0.24, WHITE)
  g.rounded(0.05, 0.45, 0.33, 0.62, 0.09, Wd - 0.09, 0.18, WHITE)
  g.rounded(L - 0.34, L - 0.04, 0.27, 0.35, 0.12, Wd - 0.12, 0.14, OBSIDIAN)
  g.rounded(0.06, 0.30, 0.27, 0.41, 0.12, Wd - 0.12, 0.12, OBSIDIAN)
  g.rounded(0.12, L - 0.22, 0.31, 0.88, 0.04, Wd - 0.04, 0.20, WHITE)
  g.rounded(0.18, L - 0.62, 0.88, 0.93, 0.07, Wd - 0.07, 0.20, WHITE)
  g.rounded(0.18, L - 1.24, 0.93, 1.00, 0.08, Wd - 0.08, 0.20, WHITE)
  g.rounded(L - 0.36, L - 0.08, 0.31, 0.82, 0.08, Wd - 0.08, 0.20, WHITE)
  g.rounded(L - 0.18, L - 0.03, 0.33, 0.72, 0.12, Wd - 0.12, 0.16, WHITE)
  for (let i = 0; i < 20; i++) {
    const t = i / 19, y0 = 0.98 + t * 0.56, y1 = y0 + 0.045, x0 = 0.36 + t * 0.58, x1 = 3.40 - t * 0.66, inset = 0.10 + t * 0.18
    g.rounded(x0, x1, y0, y1, inset, Wd - inset, 0.16, t > 0.86 ? WHITE : GLASS_)
    g.box(x1 - 0.08, x1, y0, y1, inset, inset + 0.08, OBSIDIAN)
    g.box(x1 - 0.08, x1, y0, y1, Wd - inset - 0.08, Wd - inset, OBSIDIAN)
    g.box(1.98, 2.12, y0, y1, inset, inset + 0.06, OBSIDIAN)
    g.box(1.98, 2.12, y0, y1, Wd - inset - 0.06, Wd - inset, OBSIDIAN)
  }
  g.rounded(0.92, 2.78, 1.50, 1.58, 0.26, Wd - 0.26, 0.14, WHITE)
  for (const [z0, z1] of [[0.03, 0.07], [Wd - 0.07, Wd - 0.03]]) {
    g.box(0.32, L - 0.34, 0.29, 0.39, z0, z1, OBSIDIAN)
    g.box(1.14, L - 1.22, 0.41, 0.48, z0, z1, MINT)
    g.box(1.14, L - 1.22, 0.48, 0.52, z0, z1, NAVY)
  }
  g.box(L - 0.14, L - 0.02, 0.37, 0.64, 0.50, Wd - 0.50, OBSIDIAN)
  g.rounded(L - 0.09, L, 0.47, 0.60, midZ - 0.18, midZ + 0.18, 0.05, OBSIDIAN)
  g.box(L - 0.03, L, 0.51, 0.57, midZ - 0.11, midZ + 0.11, CYAN)
  for (const z of [0.28, Wd - 0.58]) { g.box(L - 0.16, L - 0.02, 0.62, 0.78, z - 0.04, z + 0.34, OBSIDIAN); g.box(L - 0.10, L - 0.01, 0.65, 0.75, z, z + 0.30, HEAD); g.box(L - 0.10, L - 0.01, 0.73, 0.76, z, z + 0.30, WHITE_LAMP) }
  for (const z of [0.06, Wd - 0.26]) g.box(L - 0.32, L - 0.04, 0.64, 0.77, z, z + 0.20, AMBER)
  g.box(0.12, 0.20, 0.80, 0.90, 0.28, Wd - 0.28, TAIL)
  for (const z of [0.04, Wd - 0.28]) g.box(0.10, 0.34, 0.76, 0.92, z, z + 0.24, AMBER)
  for (const [z0, z1, s0, s1] of [[0.0, 0.12, 0.06, 0.24], [Wd - 0.12, Wd, Wd - 0.24, Wd - 0.06]]) { g.rounded(3.18, 3.44, 0.82, 0.96, z0, z1, 0.05, OBSIDIAN); g.box(2.98, 3.10, 0.95, 1.04, s0, s1, OBSIDIAN); g.box(2.96, 3.12, 0.98, 1.12, z0, z1, OBSIDIAN); g.box(3.02, 3.12, 1.02, 1.08, z0, z1, AMBER) }
  g.hollow()
  g.box(1.05, 3.12, 0.36, 0.42, 0.18, Wd - 0.18, OBSIDIAN)
  for (const z of [0.28, Wd - 0.80]) { g.box(2.12, 2.66, 0.42, 0.60, z, z + 0.52, SEAT); g.box(2.02, 2.18, 0.60, 1.14, z, z + 0.52, SEAT) }
  g.box(1.94, 2.00, 0.86, 1.08, midZ - 0.20, midZ + 0.20, CYAN)
  g.box(2.74, 2.82, 0.94, 1.14, midZ - 0.22, midZ + 0.22, OBSIDIAN)
  g.box(2.72, 2.78, 0.96, 1.12, midZ - 0.19, midZ + 0.19, CYAN)
  g.rounded(1.52, 2.38, 1.56, 1.66, 0.36, Wd - 0.36, 0.14, WHITE)
  g.rounded(1.66, 2.24, 1.64, 1.72, 0.56, Wd - 0.56, 0.12, OBSIDIAN)
  g.rounded(1.74, 2.14, 1.68, 1.77, midZ - 0.20, midZ + 0.20, 0.18, OBSIDIAN)
  for (const xm of [0.90, L - 0.88]) {
    for (let y = g.c(0.26); y <= g.c(0.88); y++) for (let x = g.c(xm - 0.46); x <= g.c(xm + 0.46); x++) {
      const d = Math.hypot(x - g.c(xm), y - g.c(0.43))
      if (d < 0.39 * g.s) for (const z of [0, 1, 2, 3, g.D - 4, g.D - 3, g.D - 2, g.D - 1]) g.set(x, y, z, 0)
      else if (d < 0.46 * g.s) for (const z of [0, 1, g.D - 2, g.D - 1]) if (g.get(x, y, z)) g.set(x, y, z, OBSIDIAN)
    }
    for (const [z0, z1] of [[0, 0.24], [Wd - 0.24, Wd]]) g.wheel(xm, 0.43, z0, z1, 0.36, TYRE, SILVER, SLATE)
  }
  const size = [Math.ceil(L * 10), Math.ceil(H * 10), Math.ceil(Wd * 10)]
  return { name: 'WaitWhat', kind: 'waitwhat', per, cells: g.cells, size: [g.W, g.H, g.D], body: size, motor: motorOf(size[0], size[2], [10, size[0] - 10], HANDLING.waitwhat, { awd: true, footY: 3.4, reach: 6.2 }), seats: [[23, 0.2, 5.5], [23, 0.2, 14.3], [14, 0.2, 5.5], [14, 0.2, 14.3]], eye: [22.5, 11.8, 5.5], paint: [WHITE, MINT], tyre: [TYRE] }
}
