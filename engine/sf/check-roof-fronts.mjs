// Run with the folder of level-0 BAY1 tiles after building the release core.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const folder = process.argv[2]
if (!folder) throw Error('usage: node engine/sf/check-roof-fronts.mjs /path/to/tiles/0')
const core = await WebAssembly.compile(readFileSync(new URL('../page/core.wasm', import.meta.url)))

async function heights(key) {
  const api = (await WebAssembly.instantiate(core)).exports
  const bytes = readFileSync(join(folder, key + '.bay'))
  const ptr = api.bay_room(bytes.length)
  new Uint8Array(api.memory.buffer, ptr, bytes.length).set(bytes)
  assert.equal(api.bay_load(), 1, key)
  return (x, z) => api.feet_at(x, z) - 1
}

const sunset = await heights('178_284')
const west = await heights('177_284')
const mission = await heights('203_282')
// The earlier fitter put 4–6 m posts at these low returns and a ridge on the flat Mission roof.
assert.equal(west(442797, 712392), 480, 'western Sunset porch')
assert.equal(sunset(446282, 711917), 722, 'eastern Sunset porch')
assert.equal(mission(508787, 706102), 182, 'Mission stoop')
for (const z of [707277, 707282, 707287, 707292, 707297]) {
  assert.equal(mission(509822, z), 216, 'Mission flat')
}

const failures = []
for (const [house, x0, x1, z0, z1] of [
  ['beige', 445053, 445070, 710803, 710823],
  ['white', 445057, 445075, 710883, 710905],
]) {
  let highestStep = 0, leastRise = Infinity
  for (let z = z0; z <= z1; z++) {
    leastRise = Math.min(leastRise, sunset(x1, z) - sunset(x0, z))
    for (let x = x0; x < x1; x++) highestStep = Math.max(highestStep, sunset(x + 1, z) - sunset(x, z))
  }
  console.log(`${house} front rises at least ${leastRise} cells, largest step ${highestStep} cells`)
  if (highestStep > 4 || leastRise < 12) failures.push(house)
}
assert.deepEqual(failures, [], 'a measured front lost its pitch or acquired a vertical step')
