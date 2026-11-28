import assert from 'node:assert/strict'
import { test } from 'node:test'
import { probePlacedObjects, probeMadeRows } from '../make/qa-probes.mjs'
import { make } from '../make/maker.mjs'
import { probePlacement } from '../make/place.mjs'
import { computeReviewCameras, composeContactSheet, createCutawayController } from '../page/studio/cutaway.ts'

const floor = (_x, y) => y < 0 ? 1 : 0
const box = { id: 'bench', center: [0, 2, 0], halfExtents: [3, 2, 2] }
test('five rotated underside points measure contact, three empty cells, and a ledge', () => {
  assert.deepEqual(probePlacedObjects([box], floor), [])
  const [floating] = probePlacedObjects([{ ...box, center: [-11, 5, -4] }], floor)
  assert.equal(floating.type, 'floating')
  assert.equal(floating.floatCells, 3)
  assert.deepEqual(floating.unsupportedCorners, [0, 1, 2, 3])
  const [ledge] = probePlacedObjects([{ ...box, yaw: Math.PI / 2 }], (x, y) => x <= 0 && y < 0 ? 1 : 0)
  assert.equal(ledge.type, 'cantilevered')
  assert.deepEqual(ledge.unsupportedCorners, [2, 3])
  const [unseen] = probePlacedObjects([box], () => 0, { maxGap: 0 })
  assert.equal(unseen.floatCells, null)
})

test('wall occupies half of the interior samples, a flush bottom row is excluded', () => {
  const [wall] = probePlacedObjects([box], (x, y) => y < 0 || x < 0 ? 8 : 0)
  assert.equal(wall.type, 'wall_embedded')
  assert.equal(wall.embeddedFraction, .5)
  assert.ok(wall.sampleCells.length > 0 && wall.sampleCells.every(([x, y]) => x < 0 && y > 0))
  assert.deepEqual(probePlacedObjects([box], (_x, y) => Number(y <= 0)), [])
})

test('SAT measures penetration in cells and treats rotated face contact as clear', () => {
  const yaw = Math.PI / 4
  const a = { ...box, yaw }
  const b = distance => ({ ...box, id: 'crate', center: [Math.sin(yaw)*distance, 2, Math.cos(yaw)*distance],
    rot: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] })
  const [overlap] = probePlacedObjects([a, b(3.25)], floor)
  assert.equal(overlap.type, 'prop_overlap')
  assert.deepEqual(overlap.ids, ['bench', 'crate'])
  assert.ok(Math.abs(overlap.penetrationDepth - .75) < 1e-12)
  assert.deepEqual(probePlacedObjects([a, b(4)], floor), [])
  assert.deepEqual(probePlacedObjects([a, b(4.01)], floor), [])
})

test('skew rods separate on an edge cross product even though all six face projections overlap', () => {
  const a = { id: 'a', center: [0, 0, 0], halfExtents: [4, .5, .5] }
  const angle = Math.acos(1/Math.sqrt(3)) / 2
  const b = { ...a, id: 'b', center: [0, -1.5, 1.5], rot: [0, -Math.sin(angle)/Math.SQRT2, Math.sin(angle)/Math.SQRT2, Math.cos(angle)] }
  assert.ok(!probePlacedObjects([a, b], floor).some(d => d.type === 'prop_overlap'))
  assert.ok(probePlacedObjects([a, { ...b, center: a.center }], floor).some(d => d.type === 'prop_overlap'))
})

test('world-space runs use exclusive x1 and empty space between runs stays clear', () => {
  const rows = [[-4, -2, 0, -1, 3], [-4, -3, 1, -1, 3], [80, 81, 20, 30, 0]]
  assert.deepEqual(probeMadeRows(rows, (x, y) => y < 0 || x === -2 ? 1 : 0), [])
  assert.deepEqual(probePlacement([], floor), [])
  const result = probePlacement(rows, floor, { id: 'post', neighbors: [{ id: 'near', center: [-2, 1, -.5], halfExtents: [.5, 1, .5] }] })
  assert.deepEqual(result, [{ type: 'prop_overlap', ids: ['post', 'near'], penetrationDepth: .5 }])
})

test('optional maker QA reads the selected placement on a dry run', async () => {
  const size = [8, 8, 8]
  const reply = { name: 'block', size, parts: [['box', 'wood', 'own', 0, 0, 0, ...size]] }
  const options = { dry: true, wish: 'block', proved: { stands: true }, where: { box: [-4, 0, -4, 4, 8, 4] },
    model: async () => ({ text: JSON.stringify(reply), ms: 0 }), world: {
      at: async ([, y]) => ({ ground: -1, material: Number(y < 0) }),
      tops: async ([x, z, X, Z]) => ({ high: Array((X-x)*(Z-z)).fill(-1), material: Array((X-x)*(Z-z)).fill(1) }),
    } }
  const normal = await make(options)
  assert.equal(normal.state, 'dry')
  assert.ok(!('qa' in normal))
  const reviewed = await make({ ...options, qa: { worldSampler: (x, y) => y < 0 || x < 0 ? 1 : 0 } })
  assert.equal(reviewed.state, 'dry')
  assert.deepEqual(reviewed.made, normal.made)
  assert.equal(reviewed.qa[0].type, 'wall_embedded')
})

test('cutaway uses eye height or the midpoint of a low prop', () => {
  const ctrl = createCutawayController()
  assert.equal(ctrl.state.backfaceDarken, .42)
  ctrl.toggle()
  assert.equal(ctrl.state.enabled, true)
  ctrl.setY(-10)
  assert.equal(ctrl.state.planeY, -10)
  assert.equal(ctrl.autoInteriorY([0, -20, 0, 5, 10, 8]), -6)
  assert.equal(ctrl.autoInteriorY([0, -20, 0, 5, -19, 8]), -19.5)
})

test('every box corner projects inside each portrait and landscape view', () => {
  const dot = (a, b) => a.reduce((v, x, i) => v+x*b[i], 0)
  for (const b of [[-8,-63,65,5,100,70], [-400,11,-80,401,16,83]]) for (const aspect of [.4, 1, 2.4]) {
    const cameras = computeReviewCameras(b, aspect)
    assert.deepEqual(cameras.map(v => v.name), ['hero34', 'front', 'side', 'interiorCutaway'])
    assert.ok(cameras[3].cutawayY > b[1] && cameras[3].cutawayY < b[4])
    for (const v of cameras) for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
      const ray = [x, y, z].map((p, i) => p - v.eye[i])
      const depth = dot(ray, v.forward)
      assert.ok(depth > 0)
      assert.ok(Math.abs(dot(ray, v.right)) < depth*v.tanHalf*aspect)
      assert.ok(Math.abs(dot(ray, v.up)) < depth*v.tanHalf)
    }
  }
})

test('contact sheet preserves each RGBA frame and captions it outside the image', () => {
  const w = 120, h = 3, gap = 2
  const tiles = Array.from({ length: 4 }, (_, i) => ({
    width: w, height: h, data: Uint8Array.from({ length: w*h*4 }, (_, j) => (i*21+j)%251),
  }))
  const sheet = composeContactSheet(tiles, { gap })
  assert.equal(sheet.width, 2*w+gap)
  assert.equal(sheet.height, 2*(h+7+4)+gap)
  assert.equal(sheet.data.length, 4*sheet.width*sheet.height)
  for (const [i, tile] of tiles.entries()) {
    const x = (i%2)*(w+gap), y = (i>>1)*(sheet.height+gap)/2
    for (let row = 0; row < h; row++) {
      const offset = 4*((y+row)*sheet.width+x)
      assert.deepEqual(sheet.data.slice(offset, offset+4*w), tile.data.slice(4*w*row, 4*w*(row+1)))
    }
    assert.ok(sheet.data.subarray(4*((y+h+2)*sheet.width+x), 4*((y+h+2)*sheet.width+x+w)).some((v, j) => j%4 === 0 && v === 255))
  }
  assert.throws(() => composeContactSheet(tiles.slice(1)), RangeError)
})
