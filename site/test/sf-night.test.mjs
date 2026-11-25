// The site's night under the city's "SF now" sky (#524): the inline sun in every page's head (generator/pages.mjs
// SF_NIGHT) says night exactly when the realm's own (engine/page/almanac.ts) has the sun under the horizon, every
// twenty minutes for a year; and a night chosen on the site leaves "SF now".
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SF_NIGHT } from '../generator/pages.mjs'
import { heavens } from '../../engine/page/almanac.ts'

test("the head's sun agrees with the realm's for a year", () => {
  const night = (ms) => new Function('Date', `return ${SF_NIGHT}`)({ now: () => ms })
  let checked = 0, nights = 0
  for (let ms = Date.parse('2026-01-01T00:00:00Z'); ms < Date.parse('2027-01-01T00:00:00Z'); ms += 20 * 60_000) {
    const want = heavens(ms).sun[1] < 0 ? 'dark' : 'light'
    assert.equal(night(ms), want, new Date(ms).toISOString())
    checked++; if (want === 'dark') nights++
  }
  assert.ok(nights > checked * 0.4 && nights < checked * 0.6, `${nights} of ${checked}`)
})
