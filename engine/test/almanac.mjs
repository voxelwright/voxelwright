// San Francisco's own sky (#524, page/almanac.ts) against sources that are not its own formulas:
//   - the landing's photograph: its sun (sf/realm.json `air.sun`, fitted to the picture taken at Ina Coolbrith Park on
//     2021-07-15 at 15:37 PDT), which also proves the world's axes (x east, y up, z south);
//   - sunrise and sunset on 2026-11-24 as Open-Meteo gives them for the city (06:59 and 16:53 PST);
//   - the new and full moons of November 2026 (07:02 UTC on the 9th, 14:53 UTC on the 24th: USNO, as published);
//   - the clock on the city's walls across a change of daylight saving;
//   - the weather station's reports (METAR codes, as the National Weather Service gives them) taken to the four weathers.
//
//   node test/almanac.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fresh, heavens, sfHour, weatherOf } from '../page/almanac.ts'

const degrees = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l) }

test("the photograph's sun: within a degree of the sun the picture was fitted to", () => {
  const realm = JSON.parse(readFileSync(new URL('../sf/realm.json', import.meta.url), 'utf8'))
  const { sun } = heavens(Date.parse('2021-07-15T22:37:00Z'), { lat: 37.7983, lon: -122.4148 })
  const off = degrees(sun, norm(realm.air.sun))
  console.log(`  photograph's sun ${off.toFixed(2)} degrees off`)
  assert.ok(off < 1, `${off} degrees`)
})

test('sunrise and sunset on 2026-11-24 are within two minutes of the published ones', () => {
  // The sun's middle is 0.833 degrees under the horizon at sunrise and sunset (refraction and its half-width).
  const crossing = (from, to) => {
    const up = (ms) => Math.asin(heavens(ms, { lat: 37.763283, lon: -122.41286 }).sun[1]) * 180 / Math.PI + 0.833
    let a = Date.parse(from), b = Date.parse(to)
    for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (Math.sign(up(m)) === Math.sign(up(a))) a = m; else b = m }
    return a
  }
  const rise = crossing('2026-11-24T14:00:00Z', '2026-11-24T16:00:00Z'), set = crossing('2026-11-25T00:00:00Z', '2026-11-25T01:30:00Z')
  const minutes = (ms, at) => Math.abs(ms - Date.parse(at)) / 60_000
  console.log(`  sunrise ${new Date(rise).toISOString()}, sunset ${new Date(set).toISOString()}`)
  assert.ok(minutes(rise, '2026-11-24T14:59:00Z') < 2)
  assert.ok(minutes(set, '2026-11-25T00:53:00Z') < 2)
})

test('the moon is new on 9 November 2026 and full on the 24th, waxing between', () => {
  const nu = heavens(Date.parse('2026-11-09T07:02:00Z')), full = heavens(Date.parse('2026-11-24T14:53:00Z'))
  console.log(`  lit at the new moon ${nu.lit.toFixed(4)}, at the full ${full.lit.toFixed(4)}`)
  assert.ok(nu.lit < 0.01)
  assert.ok(full.lit > 0.99)
  const quarter = heavens(Date.parse('2026-11-17T00:00:00Z'))
  assert.ok(quarter.lit > 0.35 && quarter.lit < 0.75 && quarter.waxing, JSON.stringify(quarter))
  assert.ok(!heavens(Date.parse('2026-12-01T00:00:00Z')).waxing)
  // A full moon stands opposite the sun, but for the five degrees its path leans off the sun's.
  assert.ok(degrees(full.sun, full.moon) > 170, `${degrees(full.sun, full.moon)}`)
})

test("the clock is San Francisco's, whatever the machine's, across daylight saving", () => {
  assert.equal(sfHour(Date.parse('2026-11-25T04:45:00Z')), 20.75)
  assert.equal(sfHour(Date.parse('2026-07-15T19:30:00Z')), 12.5)
  assert.equal(sfHour(Date.parse('2026-11-01T08:30:00Z')), 1.5)
  assert.equal(sfHour(Date.parse('2026-11-01T09:30:00Z')), 1.5)
})

test("the station's report becomes the four weathers", () => {
  const cases = [
    [{ present: [], clouds: ['CLR'], visibility: 16093 }, 'clear'],
    [{ present: [], clouds: ['FEW', 'SCT'], visibility: 16093 }, 'clear'],
    [{ present: [], clouds: ['FEW', 'BKN', 'OVC'], visibility: 16093 }, 'overcast'],
    [{ present: [], clouds: ['VV'], visibility: 2000 }, 'overcast'],
    [{ present: ['FG'], clouds: ['VV'], visibility: 400 }, 'fog'],
    [{ present: ['BR'], clouds: ['OVC'], visibility: 1200 }, 'fog'],
    [{ present: ['BR'], clouds: ['OVC'], ceiling: 900, visibility: 4800 }, 'overcast'],
    [{ present: [], clouds: ['FEW', 'OVC'], ceiling: 180, visibility: 16093 }, 'fog'],
    [{ present: [], clouds: ['SCT'], ceiling: null, visibility: 16093 }, 'clear'],
    [{ present: ['-DZ', 'BR'], clouds: ['OVC'], visibility: 3200 }, 'rain'],
    [{ present: ['-RA'], clouds: ['BKN'] }, 'rain'],
    [{ present: ['+TSRA'] }, 'rain'],
    [{ present: ['VCSH'], clouds: ['SCT'] }, 'clear'],
    [{ present: ['VCTS', '-SHRA'] }, 'rain'],
    [{ present: ['-SN'], clouds: ['OVC'] }, 'overcast'],
    [{ present: ['HZ'], clouds: ['SCT'], visibility: null }, 'clear'],
    [{}, 'clear'],
  ]
  for (const [seen, want] of cases) assert.equal(weatherOf(seen), want, JSON.stringify(seen))
})

test('a report from more than three hours ago does not stand for now', () => {
  const at = Date.parse('2026-11-25T06:00:00Z')
  assert.ok(fresh({ time: '2026-11-25T05:56:00+00:00' }, at))
  assert.ok(!fresh({ time: '2026-11-25T02:00:00+00:00' }, at))
  assert.ok(!fresh({}, at))
})
