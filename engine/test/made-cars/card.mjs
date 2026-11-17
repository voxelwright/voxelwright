// What a made car's record and card must say (test/made-cars.mjs), as functions test/drivable.mjs also holds to
// wrong figures and to nothing measured.

/** Its record says as measured only what was measured (0 to 100), and something was. */
export const measuredOnly = (facts) => { const k = Object.keys(facts?.measured ?? {}); return k.length > 0 && k.every((x) => x === 'zero_to_100_s') }

/**
 * Whether a card's line says the top speed the stand-in's reply asked for (`top_kmh`, a figure of the check's own;
 * none: the card says none) and a 0 to 100 within `near` seconds of the time asked (`zero_to_100_s`: the power is
 * tried until it is reached), and that time is the one measured (`measured`).
 */
export function cardSays(note, { top_kmh, zero_to_100_s }, measured, near = 0.6) {
  const m = /^(?:(\d+) km\/h, )?0 to 100 in (\d+\.\d) s$/.exec(note ?? '')
  if (!m || (top_kmh === undefined) !== (m[1] === undefined) || (top_kmh !== undefined && Number(m[1]) !== top_kmh)) return false
  return Math.abs(Number(m[2]) - zero_to_100_s) <= near && typeof measured === 'number' && m[2] === measured.toFixed(1)
}
