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

// A shallow nose curves back above and below the tip in the side profile.
const [chin, tip, brow] = [0.34, 0.55, 0.81].map((y) => front[row(y)])
const chinInset = cm(tip - chin)
const browInset = cm(tip - brow)
check(chin >= 0 && tip >= 0 && brow >= 0 && chinInset >= 5 && browInset >= 12,
  `rounded nose rolls back from its tip (chin ${chinInset} cm, brow ${browInset} cm)`)

// Trace the hood into the swept windshield on the centre plane, away from mirrors and wheels.
// A separate hood and cabin leave a single large setback between neighbouring rows.
const sweep = front.slice(row(0.78), row(1.49) + 1)
const setback = cm(sweep[0] - sweep.at(-1))
const largestStep = cm(Math.max(...sweep.slice(1).map((x, i) => Math.abs(sweep[i] - x))))
check(sweep.every((x) => x >= 0) && setback >= 90 && largestStep <= 18,
  `hood flows up into the windshield (${setback} cm total sweep, ${largestStep} cm largest step)`)

// Head-on rays at each height should reach glass on the outside, through the centre of the windshield.
const GLASS = 11
let glassRows = 0, longestGlass = 0
for (let y = row(1.04); y <= row(1.54); y++) {
  glassRows = front[y] >= 0 && (at(front[y], y) & 15) === GLASS ? glassRows + 1 : 0
  longestGlass = Math.max(longestGlass, glassRows)
}
check(cm(longestGlass) >= 40, `windshield has a continuous exterior glass span (${cm(longestGlass)} cm)`)
