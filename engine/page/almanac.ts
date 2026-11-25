// San Francisco's own sky (#524): where the sun and the moon stand over the city at an instant, how much of the moon
// is lit, what the clock on its walls says, and its weather as the weather service tells it. Pure: no page, no GPU.
//
// The sun and the moon by the low-precision formulas of Astronomical Algorithms (Meeus) as suncalc has them
// (github.com/mourner/suncalc, BSD-2-Clause): the sun to about a hundredth of a degree, the moon to about a degree,
// which is a third of the disc the sky draws. Directions are the world's: x east, y up, z south (bay.ts `utm`, whose
// grid at San Francisco is a third of a degree off true north: not corrected).
import type { Weather } from './weather.ts'

export type Vec3 = readonly [number, number, number]

/** The city's middle (Market and Van Ness): where its sky is reckoned from. */
export const SF = { lat: 37.7749, lon: -122.4194, zone: 'America/Los_Angeles' } as const

const RAD = Math.PI / 180, TILT = RAD * 23.4397
/** Days since the start of 2000 (J2000.0) at an instant. */
const days = (ms: number) => ms / 86_400_000 - 0.5 + 2_440_588 - 2_451_545
const ra = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(TILT) - Math.tan(b) * Math.sin(TILT), Math.cos(l))
const dec = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(TILT) + Math.cos(b) * Math.sin(TILT) * Math.sin(l))
const sidereal = (d: number, west: number) => RAD * (280.16 + 360.9856235 * d) - west

function sunCoords(d: number) {
  const m = RAD * (357.5291 + 0.98560028 * d)
  const l = m + RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) + RAD * 102.9372 + Math.PI
  return { ra: ra(l, 0), dec: dec(l, 0) }
}
function moonCoords(d: number) {
  const l0 = RAD * (218.316 + 13.176396 * d), m = RAD * (134.963 + 13.064993 * d), f = RAD * (93.272 + 13.22935 * d)
  const l = l0 + RAD * 6.289 * Math.sin(m), b = RAD * 5.128 * Math.sin(f)
  return { ra: ra(l, b), dec: dec(l, b), km: 385_001 - 20_905 * Math.cos(m) }
}
/** Where a body at (ra, dec) is seen from (lat, lon) at day `d`: a unit direction, x east, y up, z south. */
function seen(d: number, at: { lat: number; lon: number }, body: { ra: number; dec: number }, refract: boolean): Vec3 {
  const phi = RAD * at.lat, h = sidereal(d, RAD * -at.lon) - body.ra
  let alt = Math.asin(Math.sin(phi) * Math.sin(body.dec) + Math.cos(phi) * Math.cos(body.dec) * Math.cos(h))
  // (The air lifts what is low: half a degree at the horizon.)
  if (refract) { const a = Math.max(alt, 0); alt += 0.0002967 / Math.tan(a + 0.00312536 / (a + 0.08901179)) }
  // From the south, westward (suncalc's): east is its sine's negative, north its cosine's.
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(body.dec) * Math.cos(phi))
  const flat = Math.cos(alt)
  return [-Math.sin(az) * flat, Math.sin(alt), Math.cos(az) * flat]
}

export interface Heavens {
  /** Towards the sun. */
  sun: Vec3
  /** Towards the moon. */
  moon: Vec3
  /** How much of the moon's face is lit, 0 (new) to 1 (full). */
  lit: number
  /** Whether the moon is waxing (growing towards full). */
  waxing: boolean
}

/** The sun and the moon over a place (San Francisco's middle unless told) at an instant (ms since 1970). */
export function heavens(ms: number, at: { lat: number; lon: number } = SF): Heavens {
  const d = days(ms), s = sunCoords(d), m = moonCoords(d)
  // The angle at the earth between them, then at the moon between the earth and the sun.
  const apart = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra))
  const phase = Math.atan2(149_598_000 * Math.sin(apart), m.km - 149_598_000 * Math.cos(apart))
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra))
  return { sun: seen(d, at, s, false), moon: seen(d, at, m, true), lit: (1 + Math.cos(phase)) / 2, waxing: angle < 0 }
}

/** What the clocks in San Francisco say at an instant, as an hour of the day (0 to 24, minutes as its fraction). */
export function sfHour(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SF.zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return (n('hour') % 24) + n('minute') / 60 + n('second') / 3600
}

/** What the weather station saw (the Worker's /weather, from the National Weather Service's latest observation). */
export interface Observed {
  /** When it was seen (ISO 8601). */
  time?: string
  /** What fell or hung in the air, as the report codes it: `-RA`, `DZ`, `TSRA`, `FG`, `BR`... */
  present?: string[]
  /** The cloud layers' amounts, lowest first: `FEW`, `SCT`, `BKN`, `OVC`, `VV` (sky hidden), `CLR`, `SKC`. */
  clouds?: string[]
  /** The lowest broken or overcast layer's base (or the hidden sky's), m: null when there is none. */
  ceiling?: number | null
  /** How far one sees, m (null when not measured). */
  visibility?: number | null
}

/**
 * The weather the city's sky can show, from what the station saw. Rain is any drizzle, rain, shower or storm; fog is
 * fog itself, less than a mile seen, or a sky covered lower than the towers' tops and the hills (300 m): the marine
 * layer, which the airport sees as a low ceiling over a clear runway and the city lives inside; overcast is a sky more
 * than half covered (broken, overcast or hidden). Snow the city has not had in fifty years, and is shown as the cloud
 * it comes from.
 */
export function weatherOf(seen: Observed): Weather {
  // (What is only near the station, `VCSH`, `VCTS`, `VCFG`, is not over the city.)
  const present = (seen.present ?? []).filter((p) => !p.startsWith('VC')).join(' '), clouds = seen.clouds ?? [], see = seen.visibility ?? Infinity
  if (/DZ|RA|SH|TS|UP/.test(present)) return 'rain'
  if (/FG/.test(present) || see < 1600 || (seen.ceiling ?? Infinity) < 300) return 'fog'
  if (/SN|SG|PL|GR|GS/.test(present) || clouds.some((c) => c === 'BKN' || c === 'OVC' || c === 'VV')) return 'overcast'
  return 'clear'
}

/** Whether an observation is recent enough to stand for now: an hourly report, or one a little late. */
export const fresh = (seen: Observed, ms: number) => !!seen.time && ms - Date.parse(seen.time) < 3 * 3600_000
