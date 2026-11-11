// The block on the engine's own World, headless (#118): built from toys, walked by the walker
// gadget, timed with everything awake. World is loaded through Vite's module runner, since it is
// written for a bundler. Usage: node test/on-world.mjs [crates] [balls] [seconds]
import { loadavg } from 'node:os'
import { createServer } from 'vite'

const crates = Number(process.argv[2] ?? 300), balls = Number(process.argv[3] ?? 40), seconds = Number(process.argv[4] ?? 20)
const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
try {
  const load = (path) => server.ssrLoadModule(path)
  const { loadJolt, createJolt } = await load('../home/src/engine/jolt.ts')
  const { World } = await load('../home/src/engine/world.ts')
  const { STREET, cargo, resident, registerBlock } = await load('/src/scene.ts')
  const { heightAt } = await load('/src/ground.ts')
  await loadJolt()
  registerBlock()
  const events = {}
  const world = new World(createJolt(), (e) => { events[e.kind] = (events[e.kind] ?? 0) + 1 }, undefined, -12)
  world.addToy(STREET)
  world.addToy(cargo(crates, balls))
  world.addToy(resident('seat-1', 0))
  world.addToy(resident('seat-2', 1))
  const moving = world.keys().filter((k) => world.thing(k)?.motion === 'dynamic')
  const start = world.thing('seat-1/body').position
  const ms = []
  for (let i = 0; i < seconds * 60; i++) {
    world.setKnob('seat-1/legs', 'z', 1)
    world.setKnob('seat-1/legs', 'jump', i % 90 === 0 ? 1 : 0)
    world.setKnob('seat-2/legs', 'x', Math.sin(i / 40)); world.setKnob('seat-2/legs', 'z', 0.6)
    // Everything kept awake, as test/tick.ts does: the worst case.
    for (const key of moving) world.applyImpulse(key, [0, 1e-9, 0])
    const t = performance.now()
    world.advance(1 / 60)
    ms.push(performance.now() - t)
    if (i === 119) console.log('after 2 s the first walker is at', world.thing('seat-1/body').position.map((x) => +x.toFixed(2)), 'from', start.map((x) => +x.toFixed(2)), 'ground there', +heightAt(world.thing('seat-1/body').position[2]).toFixed(2))
  }
  ms.sort((a, b) => a - b)
  const at = (q) => +ms[Math.min(ms.length - 1, Math.floor(q * ms.length))].toFixed(3)
  const low = moving.filter((k) => world.thing(k).position[1] < -1).length
  console.log(JSON.stringify({ crates, balls, walkers: 2, moving: moving.length, stepMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) }, events, belowMinusOne: low, load1: +loadavg()[0].toFixed(1) }))
  // As a check: the block builds, a resident walks down it, things fall below the home's floor and stay, and a step fits a tick.
  const walked = world.thing('seat-1/body').position[2] - start[2]
  const bad = [walked > 3 ? '' : `the first walker moved ${walked.toFixed(2)} m down the street`, events.impact > 0 ? '' : 'nothing hit anything', at(0.5) < 1000 / 60 ? '' : `a step took ${at(0.5)} ms`].filter(Boolean)
  if (bad.length) { console.log('FAILED:', bad.join('; ')); process.exitCode = 1 }
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
await server.close()
