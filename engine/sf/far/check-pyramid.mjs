// Read the released lidar faces through the registered skyline camera. Run with the release directory.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { place } from '../../page/bay.ts'
import { striker } from './strike.mjs'

const name = 'Transamerica Pyramid'
const views = JSON.parse(readFileSync(new URL('../landmark-views.json', import.meta.url)))
const hero = JSON.parse(readFileSync(new URL('../heroes.json', import.meta.url))).find((h) => h.name === name)
const eye = views[name].skyline.slice(0, 3).map((m) => m * 10)
const centre = place(...hero.at)
const strike = striker(process.argv[2])
assert.equal(hero.only, 'night')
const tip = strike([centre.x, 3000, centre.z], [0, -1, 0], 1000)
assert.ok(tip?.layer === 'far' && Math.abs(tip.top - 2635) < 35, 'missing surveyed Pyramid tip')
for (const height of [140, 180, 235, 251]) {
  const delta = [centre.x - eye[0], height * 10 - eye[1], centre.z - eye[2]]
  const distance = Math.hypot(...delta)
  const hit = strike(eye, delta.map((v) => v / distance), distance + 50)
  assert.ok(hit?.layer === 'far' && hit.id === tip.id && Math.abs(hit.t - distance) < 250,
    `the camera meets another surface at ${height} m`)
  assert.ok(hit.pyramid, `the surveyed face at ${height} m lacks the Pyramid finish`)
}
console.log(`Pyramid lidar tip ${tip.top / 10} m, finish on four skyline rays, footprint ${tip.id}`)
