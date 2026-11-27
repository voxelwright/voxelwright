// The SF realm's kept vehicles (#450): a small library of things that drive or run, each a plain file a static page
// reads. Nothing in it is made on a visitor's asking: the cars are the shelf's kept records (made once from words in
// the fast-voxels bench), and the cable car is written here by hand.
//
//   node sf/cars.mjs <out dir> [--shelf ~/.village/engine/kept-cars/shelf]
//
// Each file is a record's own cells as runs (make/cells.mjs), with its palette as the core's kinds so the page needs
// no table of names:
//
//   { name, kind, size, body: { palette, roles, runs }, motor?, controls?, seats?, eye?, looks, variants }
//
// (the shape sf/kept.mjs writes, #459). size is the body in 10 cm cells; palette [0, k1, ...] and runs (base64 of LEB128 count and palette index pairs, x
// fastest, then z, then y) are its cells; roles say what each palette entry is on the vehicle (`rolesOf`). `looks` are its look in finer cells, finest first: the record's own (4 or 8
// to a body cell, the inside of a car as well as its outside) and then its outside made coarser (2 and 1 to a body
// cell) for drawing it far off. `variants` are colours it is also seen in: for each, the palette of the body and of
// every look with its paint changed. A thing with no motor (the cable car) is drawn, not driven.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { read } from '../make/cells.mjs'
import { coarser } from '../page/car-sculpt.ts'
import { ROBOTAXI_SERVICES } from '../page/robotaxi-services.ts'
import { boxTruck, cableCar, cityBus, HANDLING, robotaxi, sportsCoupe, streetcar, trolleybus, van } from './fleet.mjs'
import { cleanInterior, cleanShell, polishHatch } from './sculpt-cars.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const out = process.argv[2]
if (!out) { console.error('node sf/cars.mjs <out dir> [--shelf dir]'); process.exit(1) }
const shelf = arg('shelf', join(homedir(), '.village', 'engine', 'kept-cars', 'shelf'))

// ── Runs ──
const leb = (bytes, v) => { do { let b = v & 127; v = Math.floor(v / 128); if (v) b |= 128; bytes.push(b) } while (v) }
/** A grid of kinds as a palette and runs. */
function runsOf(cells) {
  const kinds = [0], index = new Map([[0, 0]]), bytes = []
  for (let i = 0; i < cells.length;) {
    const k = cells[i]
    let j = i + 1
    while (j < cells.length && cells[j] === k) j++
    if (!index.has(k)) { index.set(k, kinds.length); kinds.push(k) }
    leb(bytes, j - i); leb(bytes, index.get(k))
    i = j
  }
  if (kinds.length > 256) throw new Error(`${kinds.length} kinds: a palette holds 255`)
  return { palette: kinds, runs: Buffer.from(bytes).toString('base64') }
}

// ── Paint ──
const STEEL = 12, PLASTER = 9, ROOFING_ = 14
const material = (k) => k & 15, colourOf = (k) => (k >> 8) & 255
/** The hue of a colour of the palette (0 to 23 round the wheel), or -1 for a grey. */
const hueOf = (c) => (c >= 16 ? Math.floor((c - 16) / 10) : -1)
/** How far apart two hues are round the wheel of 24. */
const hueApart = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d) }
/**
 * Which kinds of a look are its paint: steel of the colour most of its steel is, a range of greys or one hue. A hue's
 * paint is that hue and the two beside it round the wheel, in steel, plaster or roofing: the kept saloon's red is hue 0
 * in its sun and hue 23 in its shade (steel 250 to 252), and its sills and bumpers are red plaster and roofing. Only
 * hue 0 in steel was repainted, so a silver or white saloon kept streaks of red (#450).
 */
function paintOf(kinds) {
  const n = new Map()
  const hueCount = new Map()
  let steelTotal = 0
  for (const k of kinds) {
    if (!k || material(k) !== STEEL) continue
    steelTotal++
    n.set(k, (n.get(k) ?? 0) + 1)
    const h = hueOf(colourOf(k))
    if (h >= 0) hueCount.set(h, (hueCount.get(h) ?? 0) + 1)
  }
  if (!steelTotal) return () => false
  // If a chromatic hue (plus its two neighbours) accounts for >= 10% of steel, treat it as the body's paint even when
  // dark-grey interior/underbody steel outnumbers the painted shell (e.g. the blue saloon `hatch`, 12.2% blue steel).
  let bestHue = -1, bestHueSum = 0
  for (const [h] of hueCount) {
    let sum = 0
    for (const [h2, cnt] of hueCount) if (hueApart(h2, h) <= 1) sum += cnt
    if (sum > bestHueSum) { bestHueSum = sum; bestHue = h }
  }
  if (bestHue >= 0 && bestHueSum >= steelTotal * 0.1) {
    const hue = bestHue
    return (k) => [STEEL, PLASTER, ROOFING_].includes(material(k)) && colourOf(k) >= 16 && hueApart(hueOf(colourOf(k)), hue) <= 1
  }
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (top === undefined) return () => false
  const c = colourOf(top)
  if (c >= 1 && c <= 15) return (k) => material(k) === STEEL && colourOf(k) >= 1 && colourOf(k) <= 15 && Math.abs(colourOf(k) - c) <= 4 && colourOf(k) <= 13
  const hue = hueOf(c)
  return (k) => [STEEL, PLASTER, ROOFING_].includes(material(k)) && colourOf(k) >= 16 && hueApart(hueOf(colourOf(k)), hue) <= 1
}
/** A paint colour for a step of grey (0 white to 14 black) or a tone of the hue it was: the same light in a new colour. */
const COLOURS = {
  white: (g) => 1 + Math.max(0, Math.min(14, g - 7)),
  silver: (g) => 1 + Math.max(0, Math.min(14, g - 3)),
  black: (g) => 1 + Math.min(14, g + 4),
  red: (g) => 16 + 0 * 10 + (g < 5 ? 3 : g < 9 ? 4 : g < 11 ? 5 : 6),
  navy: (g) => 16 + 16 * 10 + (g < 6 ? 5 : 6),
  green: (g) => 16 + 9 * 10 + (g < 6 ? 8 : 9),
  beige: (g) => 16 + 3 * 10 + (g < 6 ? 0 : g < 9 ? 7 : 8),
  blue: (g) => 16 + 15 * 10 + (g < 5 ? 3 : g < 9 ? 4 : 5),
  taxi: (g) => 16 + 4 * 10 + (g < 9 ? 4 : 5),
}
const greyOf = (k) => { const c = colourOf(k); if (c >= 1 && c <= 15) return c - 1; const tone = (c - 16) % 10; return [1, 3, 5, 7, 8, 10, 12, 4, 7, 10][tone] }
/**
 * What each entry of a palette is on a vehicle (the parts-and-kits report's roles, #450): paint (its body's colour,
 * drawn as car paint, page/pieces.ts), glass, lamp, tyre (and dark rubber), or trim (all else: hubs, poles, brass,
 * lining, seats). By material for glass and lamps; paint and tyres as the vehicle says, or as `paintOf` and dark
 * roofing find them on a kept record. Kept beside each palette, so a repainted variant keeps them.
 */
const GLASS = 11, LAMP = 15, ROOFING = 14
const rolesOf = (palette, paint, tyre) => palette.map((k) => !k ? '' : material(k) === GLASS ? 'glass' : material(k) === LAMP ? 'lamp' : paint(k) ? 'paint' : tyre(k) ? 'tyre' : 'trim')
const darkRubber = (k) => material(k) === ROOFING && colourOf(k) >= 13 && colourOf(k) <= 15
const repaint = (kinds, paint, name) => kinds.map((k) => (k && paint(k) ? material(k) | (COLOURS[name](greyOf(k)) << 8) : k))

// ── The library ──
const library = []
const wrote = (id, record) => {
  const body = JSON.stringify(record)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${id}.json`), body)
  library.push({ id, name: record.name, kind: record.kind, size: record.size, front: record.motor?.front ?? 0, variants: record.variants.map((v) => v.name), path: `${id}.json`, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') })
}
/** Applies the SF class handling archetype (`HANDLING[id]`) over a kept vehicle's base motor, keeping its geometry/feet intact. */
function tuneMotor(id, motor) {
  const spec = HANDLING[id]
  if (!motor || !spec) return motor
  return { ...motor, power: spec.power, top: spec.top, grip: spec.grip, steer: spec.steer, tough: spec.tough }
}

/** A kept record of the shelf, as a library entry. */
function kept(id, file, name, kind, colours) {
  if (!existsSync(file)) { console.error(`  ${id}: ${file} is not on this machine: left out`); return }
  const record = JSON.parse(readFileSync(file, 'utf8')), t = read(record.made, { joined: true })
  if (!t.living) throw new Error(`${file} is not a living thing`)
  // The outside look (the first part is the whole of the body, the others its inside), cleaned of what the bench left
  // in it (sf/sculpt-cars.mjs) before anything is made from it.
  const outside = t.living.look?.[0], paint = paintOf(outside?.kinds ?? t.cells)
  if (outside) {
    const c = cleanShell(outside.kinds, outside.size, paint)
    console.log(`  ${id}: cleaned its outside look: ${c.specks} specks taken off, ${c.holes} holes and ${c.leaks} leaks between edges sealed, ${c.pimples} pimples smoothed`)
    outside.kinds = c.kinds
    if (id === 'hatch') {
      const h = polishHatch(outside.kinds, outside.size)
      outside.kinds = h.kinds
      console.log(`  ${id}: polished cabin interior (${h.changed} voxels updated)`)
    }
  }
  for (let i = 1; i < (t.living.look?.length ?? 0); i++) {
    const l = t.living.look[i]
    const ci = cleanInterior(l.kinds, l.size)
    l.kinds = ci.kinds
    console.log(`  ${id}: cleaned interior look[${i}]: ${ci.specks} specks, ${ci.chromFixed} stray colours, ${ci.smoothed} speckles smoothed`)
  }
  let motor = tuneMotor(id, t.living.motor)
  let eye = t.living.eye
  if (id === 'hatch') {
    // Level stance (front wheels had reach 5.38 vs rear 6.10, pitching the hood and dash down) and clear driver eye.
    if (motor?.feet?.length) motor = { ...motor, feet: motor.feet.map((f) => ({ ...f, reach: 5.75 })) }
    eye = [23.0, 11.35, 13.75]
  }
  const body = runsOf(t.cells), looks = (t.living.look ?? []).map((l) => ({ size: l.size, per: l.per, low: l.low, ...runsOf(l.kinds) }))
  // The outside look, coarser, for drawing it further off.
  if (outside) for (const by of [2, 4]) { const c = coarser(outside.kinds, outside.size, by); looks.push({ size: c.size, per: outside.per / by, low: outside.low, ...runsOf(c.kinds) }) }
  body.roles = rolesOf(body.palette, paint, darkRubber)
  for (const l of looks) l.roles = rolesOf(l.palette, paint, darkRubber)
  const variants = colours.map((c) => ({ name: c, body: repaint(body.palette, paint, c), looks: looks.map((l) => repaint(l.palette, paint, c)) }))
  wrote(id, { name, kind, size: t.size, body, motor, controls: t.living.scheme ?? 'drive', ...(t.living.seats ? { seats: t.living.seats } : {}), ...(eye ? { eye } : {}), looks, variants })
}
kept('saloon', join(shelf, '1cb43f52cfc96e74e974e0a7.json'), 'grey saloon', 'car', ['white', 'black', 'red', 'navy', 'silver'])
kept('suv', join(shelf, '3fa7e950af55009f59480a4c.json'), 'grey SUV', 'car', ['white', 'black', 'green', 'beige', 'navy'])
kept('hatch', join(root, 'make/kept/0782ba87f3267813204077d0.json'), 'blue saloon', 'car', ['red', 'silver', 'white', 'taxi', 'green'])

// ── The fleet, written by hand (sf/fleet.mjs): what no kept record has ──
// Each look as written, then coarser by halves down to a cell of 10 cm, which is its body. The coupe, van and truck are
// driven like any kept car (a motor, seats); the rest are driven by the street.
for (const [id, make, colours] of [['coupe', sportsCoupe, ['white', 'black', 'silver', 'blue', 'green']], ...ROBOTAXI_SERVICES.map((s) => [s.id, () => robotaxi(s), []]), ['streetcar', streetcar, []], ['bus', cityBus, []], ['trolley', trolleybus, []], ['van', van, ['silver', 'black', 'navy', 'red']], ['truck', boxTruck, ['beige', 'white']], ['cable-car', cableCar, []]]) {
  const v = make(), clean = cleanShell(v.cells, v.size, (k) => v.paint.includes(k))
  if (clean.specks + clean.holes + clean.leaks + clean.pimples) console.log(`  ${id}: cleaned its look: ${clean.specks} specks, ${clean.holes} holes, ${clean.leaks} leaks, ${clean.pimples} pimples`)
  v.cells = clean.kinds
  const looks = [{ size: v.size, per: v.per, low: [0, 0, 0], ...runsOf(v.cells) }]
  for (let by = 2; v.per / by >= 1; by *= 2) { const c = coarser(v.cells, v.size, by); looks.push({ size: c.size, per: v.per / by, low: [0, 0, 0], ...runsOf(c.kinds) }) }
  const b = coarser(v.cells, v.size, v.per), body = runsOf(b.kinds), paint = (k) => v.paint.includes(k), tyre = (k) => v.tyre.includes(k)
  body.roles = rolesOf(body.palette, paint, tyre)
  for (const l of looks) l.roles = rolesOf(l.palette, paint, tyre)
  const variants = colours.map((c) => ({ name: c, body: repaint(body.palette, paint, c), looks: looks.map((l) => repaint(l.palette, paint, c)) }))
  wrote(id, { name: v.name, kind: v.kind, size: b.size, body, ...(v.motor ? { motor: v.motor, controls: 'drive', seats: v.seats, ...(v.eye ? { eye: v.eye } : {}) } : {}), looks, variants })
}

writeFileSync(join(out, 'index.json'), JSON.stringify({ version: 1, cars: library }, null, 1))
for (const c of library) console.log(`  ${c.id}: ${c.name}, ${c.size.join('x')}, ${(c.bytes / 1024).toFixed(0)} KB, colours ${c.variants.join(' ') || 'its own'}`)
