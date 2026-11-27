// The Ojai silhouette as delivered by the SF fleet (#57). Run with node test/robotaxi-shape.mjs.
import { ROBOTAXI_SERVICES } from '../page/robotaxi-services.ts'
import { robotaxi } from '../sf/fleet.mjs'

const { cells, per, size: [width, height, depth] } = robotaxi(ROBOTAXI_SERVICES[0])
const cellsPerMetre = per * 10
const centre = Math.floor(depth / 2)
const row = (metres) => Math.floor(metres * cellsPerMetre)
const cm = (distance) => Math.round(100 * distance / cellsPerMetre)
const at = (x, y) => cells[x + width * (centre + depth * y)]
const front = Array.from({ length: height }, (_, y) => {
  for (let x = width - 1; x >= 0; x--) {
    if (at(x, y)) return x
  }
  return -1
})

function check(ok, message) {
  console.log(`${ok ? 'ok' : 'FAIL'} ${message}`)
  if (!ok) process.exitCode = 1
}

// The reference has a near-vertical bumper below the short sloping hood.
const [chin, tip, brow] = [0.34, 0.55, 0.81].map((y) => front[row(y)])
const chinInset = cm(tip - chin)
const browInset = cm(tip - brow)
check(chin >= 0 && tip >= 0 && brow >= 0 && chinInset >= 5 && browInset >= 0 && browInset <= 8,
  `upright bumper and tucked chin (chin ${chinInset} cm, brow ${browInset} cm)`)

// Trace the hood into the swept windshield on the centre plane, away from mirrors and wheels.
// A separate hood and cabin leave a single large setback between neighbouring rows.
const sweep = front.slice(row(0.78), row(1.49) + 1)
const setback = cm(sweep[0] - sweep.at(-1))
const largestStep = cm(Math.max(...sweep.slice(1).map((x, i) => Math.abs(sweep[i] - x))))
check(sweep.every((x) => x >= 0) && setback >= 80 && setback <= 115 && largestStep <= 18,
  `hood flows up into the windshield (${setback} cm total sweep, ${largestStep} cm largest step)`)

// Head-on rays at each height should reach glass on the outside, through the centre of the windshield.
const GLASS = 11
let glassRows = 0, longestGlass = 0
for (let y = row(1.04); y <= row(1.54); y++) {
  glassRows = front[y] >= 0 && (at(front[y], y) & 15) === GLASS ? glassRows + 1 : 0
  longestGlass = Math.max(longestGlass, glassRows)
}
check(cm(longestGlass) >= 40, `windshield has a continuous exterior glass span (${cm(longestGlass)} cm)`)

// In the side photo the fender sensor is a dark housing roughly half a metre
// long, directly above the front tyre. It stands proud of the door skin on both sides.
const radius = (x, y, dir) => {
  for (let z = dir < 0 ? 0 : depth - 1; z !== centre; z -= dir) {
    const kind = cells[x + width * (z + depth * y)]
    if (kind) return { kind, distance: Math.abs(z - centre) }
  }
  return { kind: 0, distance: 0 }
}
for (const dir of [-1, 1]) {
  const door = radius(row(2.8), row(0.96), dir)
  let run = 0, longest = 0
  for (let x = row(3.45); x < row(4.35); x++) {
    const sensor = radius(x, row(0.96), dir)
    run = sensor.kind !== ROBOTAXI_SERVICES[0].livery.body && cm(sensor.distance - door.distance) >= 7 ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  check(cm(longest) >= 45, `fender sensor above wheel projects at least 7 cm for ${cm(longest)} cm (side ${dir})`)
}

// Viewed head-on, the front roof array occupies most of the windshield width.
const sensorRow = row(1.74)
let roofWidth = 0
for (let z = 0; z < depth; z++) {
  for (let x = row(2.95); x <= row(3.47); x++) {
    if (cells[x + width * (z + depth * sensorRow)]) { roofWidth++; break }
  }
}
check(cm(roofWidth) >= 120, `front roof sensor pack spans ${cm(roofWidth)} cm`)

// Rays down onto the rear half of the cabin should find a light painted cap.
let paint = 0, samples = 0
for (let x = row(0.90); x < row(2.35); x += 4) for (let z = centre - row(0.65); z <= centre + row(0.65); z += 4) {
  for (let y = height - 1; y >= 0; y--) {
    const surface = cells[x + width * (z + depth * y)]
    if (!surface) continue
    const swatch = surface >> 8
    if ((surface & 15) === 12 && swatch >= 1 && swatch <= 4) paint++
    samples++
    break
  }
}
check(paint >= 0.85 * samples, `light paint covers ${paint}/${samples} roof samples behind the array`)
