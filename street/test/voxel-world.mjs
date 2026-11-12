// The whole block as cells on the engine's World, headless (#138): how long it takes to build,
// what a tick costs with two walkers on it, and what blows cost while pieces fall.
// Usage: node test/voxel-world.mjs [cell metres] [crates] [balls]
import { loadavg } from 'node:os'
import { createServer } from 'vite'

const CELL = Number(process.argv[2] ?? 0.1), crates = Number(process.argv[3] ?? 60), balls = Number(process.argv[4] ?? 12)
const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const round = (x) => +x.toFixed(2)
try {
  const load = (path) => server.ssrLoadModule(path)
  const { loadJolt, createJolt } = await load('../home/src/engine/jolt.ts')
  const { World, bitToy } = await load('../home/src/engine/world.ts')
  const { cellsToy } = await load('../home/src/engine/cells.ts')
  const { STREET, FURNITURE, BINS, CARS, cargo, resident, registerBlock } = await load('/src/scene.ts')
  const { HOUSES } = await load('/src/houses.ts')
  const { heightAt, onStreet } = await load('/src/ground.ts')
  await loadJolt()
  registerBlock()
  const world = new World(createJolt(), () => {}, undefined, -12)
  world.setRules({ maxSpeed: 25, drag: 0 }, 'code')
  const t0 = performance.now()
  const { houseCells } = await load('/src/house-cells.ts')
  const { houseAt, LOTS } = await load('/src/houses.ts')
  const toys = [STREET, ...Array.from({ length: LOTS }, (_, lot) => [houseCells(houseAt(lot, -1), CELL), houseCells(houseAt(lot, 1), CELL)]).flat(), FURNITURE, CARS, cargo(crates, balls), BINS]
  let chars = 0, cells = 0
  const built = {}
  for (const toy of toys) {
    const t = performance.now()
    const as = cellsToy(toy, CELL)
    const made = performance.now() - t
    world.addToy(as)
    for (const part of as.parts) if (part.cells) { chars += part.cells.data.length; cells += part.cells.size[0] * part.cells.size[1] * part.cells.size[2] }
    const kind = toy.id.startsWith('house') ? 'houses' : toy.id
    built[kind] = round((built[kind] ?? 0) + performance.now() - t)
    if (toy.id === 'street' || toy.id === 'house-101') console.log(toy.id, 'cells', as.parts.filter((p) => p.cells).map((p) => p.cells.size.join('x')).join(' '), 'packed', as.parts.reduce((n, p) => n + (p.cells?.data.length ?? 0), 0), 'chars; made in', round(made), 'ms')
  }
  world.addToy(resident('seat-1', 0))
  world.addToy(resident('seat-2', 1))
  console.log(JSON.stringify({ cell: CELL, buildMs: round(performance.now() - t0), built, cellsInAll: cells, packedChars: chars, things: world.keys().length, heapMB: round(process.memoryUsage().heapUsed / 1e6), rssMB: round(process.memoryUsage().rss / 1e6) }))
  const start = world.thing('seat-1/body').position
  const run = (seconds, label) => {
    const ms = []
    for (let i = 0; i < seconds * 60; i++) {
      world.setKnob('seat-1/legs', 'z', 1)
      world.setKnob('seat-2/legs', 'x', Math.sin(i / 40)); world.setKnob('seat-2/legs', 'z', 0.6)
      const t = performance.now()
      world.advance(1 / 60)
      ms.push(performance.now() - t)
    }
    ms.sort((a, b) => a - b)
    const q = (p) => round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))])
    console.log(label, JSON.stringify({ p50: q(0.5), p95: q(0.95), max: q(1), awake: world.poses().length }))
  }
  run(4, 'walking the block, tick ms')
  const walked = world.thing('seat-1/body').position
  console.log('the first walker went from', start.map(round), 'to', walked.map(round), '; ground there', round(heightAt(walked[2])))
  // Blows: at a house front, in the road, on a car, at a crate wall.
  let bits = 0
  const blow = (label, point, radius) => {
    const t = performance.now()
    const did = world.blast(point, radius, 40)
    let n = 0, cellsOut = 0
    for (const d of did) { cellsOut += d.changed; for (const bit of d.bits) { world.addToy(bitToy(`bit-${++bits}`, 'a piece', bit)); n++ } }
    if (label || n) console.log(label, JSON.stringify({ ms: round(performance.now() - t), things: did.length, cellsOut, newBits: n, dust: did.reduce((a, d) => a + d.record.gone.length, 0), bits: did.flatMap((d) => d.bits.map((b) => `${d.record.thing} ${b.cells.size.join('x')} ${b.material}`)) }))
  }
  const front = HOUSES[2].frame.at
  blow('a blow at a house front (1.2 m)', [front[0], front[1] + 4, front[2]], 1.2)
  blow('a blow in the road (1.5 m)', onStreet(0, -10, 0.2), 1.5)
  blow('a blow on a parked car (1 m)', onStreet(-3.96, -11.9, 0.8), 1)
  blow('a blow at the crates (1 m)', onStreet(0, -22, 0.6), 1)
  blow('a blow at a lamp post foot (0.5 m)', onStreet(-5.5, -24, 0.4), 0.5)
  blow('a blow at a tree trunk (0.4 m)', onStreet(5.7, -19, 1), 0.4)
  run(4, 'after the blows, tick ms')
  for (let i = 0; i < 30; i++) blow(i === 29 ? 'the last of 30 more blows up a house front' : '', [front[0] + 0.3, front[1] + 1 + (i % 10), front[2] - 3 + (i % 7)], 0.8), i < 29 && process.stdout.write('')
  run(4, 'after 30 more, tick ms')
  console.log(JSON.stringify({ bits, things: world.keys().length, heapMB: round(process.memoryUsage().heapUsed / 1e6), load1: round(loadavg()[0]) }))
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 10).join('\n')); process.exitCode = 1 }
await server.close()
