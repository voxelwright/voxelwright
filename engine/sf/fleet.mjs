// The SF realm's hand-built vehicles (#450): what runs the city's streets and rails that no kept record has. Each
// is written here as shapes in metres, laid in cells of 2.5 or 5 cm: a streetcar of the F's kind, a city bus, a
// trolleybus under its poles, a delivery van, a box truck, and the cable car. Nothing says whose: no operator's
// name or wordmark, only the colours a street has.
//
// Each builder returns { name, kind, per, cells, size, motor?, seats? }: `cells` the look's kinds (x along its
// length, front at +x, then z across, then y up), `per` its cells to a body cell (10 cm). The van and the truck
// have a motor and seats and are driven as any kept car is; the rest are too long for a living body (96 cells) and
// are driven by the street (page/street.ts).

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
  /** A wheel: its middle along and up, across from z0 to z1, its radius; a tyre round a hub. */
  const wheel = (xm, ym, z0, z1, r, tyre, hub) => {
    for (let y = c(ym - r); y <= c(ym + r); y++) for (let x = c(xm - r); x <= c(xm + r); x++) {
      const d = Math.hypot(x - c(xm), y - c(ym))
      if (d > r * s) continue
      for (let z = c(z0); z < c(z1); z++) set(x, y, z, d < r * s * 0.55 ? hub : tyre)
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
  for (let i = 0; i < 40; i++) { const t = i / 40; g.box(4 + t * 5.5, 4.08 + t * 5.5, 3.2 + t * 0.65, 3.27 + t * 0.65, Wd / 2 - 0.03, Wd / 2 + 0.03, k(STEEL, grey(12))) }
  g.box(L - 0.05, L, 1.0, 1.25, Wd / 2 - 0.15, Wd / 2 + 0.15, k(LAMP, 1))
  for (const x of [0, L - 0.1]) g.box(x, x + 0.1, 0.55, 0.75, 0.2, Wd - 0.2, k(STEEL, grey(12)))
  // Two bogies, four wheels each, under the floor.
  for (const xm of [3.0, L - 3.0]) { g.box(xm - 1.2, xm + 1.2, 0.35, 0.75, 0.35, Wd - 0.35, k(STEEL, grey(13))); for (const dx of [-0.8, 0.8]) for (const [z0, z1] of [[0.3, 0.45], [Wd - 0.45, Wd - 0.3]]) g.wheel(xm + dx, 0.33, z0, z1, 0.33, k(STEEL, grey(12)), k(STEEL, grey(8))) }
  return { name: 'streetcar', kind: 'tram', per, cells: g.cells, size: [g.W, g.H, g.D] }
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
  for (const xm of [2.6, L - 3.6]) for (const [z0, z1] of [[0, 0.3], [Wd - 0.3, Wd]]) g.wheel(xm, 0.5, z0, z1, 0.5, k(ROOFING, grey(13)), k(STEEL, grey(6)))
  if (poles) {
    // Two poles from the roof back to the wires, and the frame they stand on.
    g.box(6.5, 8.5, 3.25, 3.4, 0.6, Wd - 0.6, k(STEEL, grey(10)))
    for (const z of [0.9, Wd - 0.9]) for (let i = 0; i < 60; i++) { const t = i / 60; g.box(7.5 - t * 6.0, 7.56 - t * 6.0, 3.4 + t * 1.15, 3.46 + t * 1.15, z - 0.03, z + 0.03, k(STEEL, grey(13))) }
  }
  return { name, kind, per, cells: g.cells, size: [g.W, g.H, g.D] }
}
export const cityBus = () => bus('city bus', 'bus', false)
export const trolleybus = () => bus('trolleybus', 'trolley', true)

/** A motor for something driven on four wheels, its feet at the wheels' middles (body cells), front two steering. */
const motorOf = (length, width, wheelX, top) => ({
  front: 0, grip: 1.25, power: 55, top, steer: 0.5, hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 160,
  feet: [[wheelX[0], 1], [wheelX[0], width - 1], [wheelX[1], 1], [wheelX[1], width - 1]].map(([x, z], i) => ({ at: [x, 3.2, z], reach: 6, steers: i >= 2, drives: i < 2 })),
})

/** A delivery van: 6 m, a tall white box with a sloped nose, sliding door, back doors. Driven like a car. */
export function van() {
  const per = 4, L = 6.0, Wd = 2.05, H = 2.6, g = grid(L, H, Wd, per), WHITE = k(STEEL, grey(1)), BLACK = k(ROOFING, grey(13))
  g.rounded(0, L - 0.9, 0.35, H, 0, Wd, 0.15, WHITE)
  // The nose: bonnet, then the windscreen sloping back.
  g.rounded(L - 1.2, L, 0.35, 1.1, 0, Wd, 0.2, WHITE)
  for (let i = 0; i < 20; i++) { const t = i / 20; g.box(L - 1.25 - t * 0.0, L - 0.9 - t * 0.5, 1.1 + t * 1.3, 1.1 + (t + 0.05) * 1.3, 0.05, Wd - 0.05, WHITE) }
  for (let i = 0; i < 20; i++) { const t = i / 20; g.box(L - 0.95 - t * 0.5, L - 0.88 - t * 0.5, 1.12 + t * 1.2, 1.12 + (t + 0.06) * 1.2, 0.12, Wd - 0.12, k(GLASS, grey(12))) }
  // Cab side windows, the sliding door with its window, seams and handles, a rubbing strip along each side, wheel
  // arches, marker lamps; the back doors with their windows, handles and seam, a plate, tall lamp clusters, a step.
  const SEAM = k(STEEL, grey(11)), TRIM = k(ROOFING, grey(12)), DARK_GLASS = k(GLASS, grey(13))
  for (const [z0, z1] of [[0, 0.04], [Wd - 0.04, Wd]]) {
    g.box(L - 1.75, L - 1.0, 1.25, 2.0, z0, z1, k(GLASS, grey(12)))
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
  for (const z of [0.15, Wd - 0.45]) g.box(L - 0.04, L, 0.75, 0.95, z, z + 0.3, k(LAMP, 1))
  g.box(L - 0.04, L, 0.55, 0.72, 0.5, Wd - 0.5, TRIM)
  g.box(L - 0.08, L, 0.3, 0.5, 0.05, Wd - 0.05, BLACK); g.box(0, 0.08, 0.3, 0.5, 0.05, Wd - 0.05, BLACK); g.box(-0.0, 0.25, 0.28, 0.33, 0.3, Wd - 0.3, BLACK)
  for (const z of [-0.12, Wd]) g.box(L - 1.2, L - 1.1, 1.6, 1.85, Math.max(0, z), Math.min(Wd, z + 0.12), BLACK)
  g.hollow()
  // Two seats in the cab, seen through the glass.
  for (const z of [0.3, Wd - 0.85]) { g.box(L - 2.1, L - 1.6, 0.45, 0.95, z, z + 0.55, BLACK); g.box(L - 2.2, L - 2.05, 0.95, 1.6, z, z + 0.55, BLACK) }
  for (const xm of [1.1, L - 1.3]) {
    // Arches: a dark band round each wheel's top on the body's sides.
    for (let y = g.c(0.35); y <= g.c(0.85); y++) for (let x = g.c(xm - 0.5); x <= g.c(xm + 0.5); x++) { const d = Math.hypot(x - g.c(xm), y - g.c(0.36)); if (d > 0.42 * g.s && d < 0.5 * g.s) for (const z of [0, 1, g.D - 2, g.D - 1]) if (g.get(x, y, z)) g.set(x, y, z, TRIM) }
    for (const [z0, z1] of [[0, 0.22], [Wd - 0.22, Wd]]) g.wheel(xm, 0.36, z0, z1, 0.36, BLACK, k(STEEL, grey(10)))
  }
  const size = [Math.round(L * 10), Math.round(H * 10), Math.round(Wd * 10)]
  return { name: 'delivery van', kind: 'van', per, cells: g.cells, size: [g.W, g.H, g.D], body: size, motor: motorOf(size[0], size[2], [11, 47], 140), seats: [[42, 4.5, 6.5], [42, 4.5, 14]] }
}

/** A box truck: 8 m, a cab and a tall box behind it on six wheels. Driven like a car, more slowly. */
export function boxTruck() {
  const per = 4, L = 8.0, Wd = 2.45, H = 3.5, g = grid(L, H, Wd, per), CAB = k(STEEL, grey(1)), BOX = k(STEEL, grey(3)), BLACK = k(ROOFING, grey(13))
  g.rounded(0, 5.8, 0.75, H, 0, Wd, 0.05, BOX)
  g.box(0, 0.05, 0.9, H - 0.1, Wd / 2 - 0.01, Wd / 2 + 0.01, k(STEEL, grey(6)))
  g.box(0, 0.06, 0.75, 0.9, 0.05, Wd - 0.05, k(STEEL, grey(10)))
  g.rounded(6.0, L, 0.5, 2.8, 0.05, Wd - 0.05, 0.25, CAB)
  g.box(L - 0.06, L, 1.75, 2.55, 0.2, Wd - 0.2, k(GLASS, grey(12)))
  for (const [z0, z1] of [[0.05, 0.09], [Wd - 0.09, Wd - 0.05]]) g.box(6.3, 7.5, 1.75, 2.5, z0, z1, k(GLASS, grey(12)))
  for (const z of [0.2, Wd - 0.5]) { g.box(L - 0.04, L, 0.8, 1.0, z, z + 0.3, k(LAMP, 1)); g.box(0, 0.04, 0.95, 1.2, z + 0.05, z + 0.25, k(LAMP, hue(0, 4))) }
  g.box(L - 0.1, L, 0.4, 0.6, 0.05, Wd - 0.05, BLACK)
  g.box(0.3, 7.8, 0.35, 0.75, 0.4, Wd - 0.4, k(STEEL, grey(12)))
  g.hollow()
  for (const z of [0.3, Wd - 0.85]) { g.box(6.4, 6.9, 0.9, 1.4, z, z + 0.55, BLACK); g.box(6.3, 6.45, 1.4, 2.1, z, z + 0.55, BLACK) }
  // The roll-up door's ribs, its handle, a plate and the bar under the back; a skirt along each side between the wheels.
  for (let y = 0.95; y < H - 0.2; y += 0.3) g.box(0, 0.03, y, y + 0.04, 0.12, Wd - 0.12, k(STEEL, grey(7)))
  g.box(0, 0.05, 0.95, 1.05, Wd / 2 - 0.2, Wd / 2 + 0.2, BLACK)
  g.box(0, 0.06, 0.55, 0.7, Wd / 2 - 0.26, Wd / 2 + 0.26, k(PLASTER, grey(1))); g.box(0, 0.07, 0.59, 0.66, Wd / 2 - 0.2, Wd / 2 + 0.2, k(STEEL, hue(16, 5)))
  g.box(0.1, 0.25, 0.3, 0.42, 0.1, Wd - 0.1, k(STEEL, grey(12)))
  for (const [z0, z1] of [[0.02, 0.06], [Wd - 0.06, Wd - 0.02]]) { g.box(2.8, 6.5, 0.4, 0.75, z0, z1, k(STEEL, grey(11))); g.box(0.2, 5.6, 1.0, 1.1, z0 - 0.02, z1 + 0.02, k(LAMP, hue(3, 4))) }
  for (const xm of [1.0, 2.2, L - 1.1]) for (const [z0, z1] of [[0, 0.3], [Wd - 0.3, Wd]]) g.wheel(xm, 0.48, z0, z1, 0.48, BLACK, k(STEEL, grey(10)))
  const size = [Math.round(L * 10), Math.round(H * 10), Math.round(Wd * 10)]
  return { name: 'box truck', kind: 'truck', per, cells: g.cells, size: [g.W, g.H, g.D], body: size, motor: motorOf(size[0], size[2], [16, 69], 110), seats: [[66, 9, 7], [66, 9, 17]] }
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
  return { name: 'cable car', kind: 'cable', per, cells: g.cells, size: [g.W, g.H, g.D] }
}
