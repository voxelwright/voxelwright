// Real wasm, synthetic brick walls and parked cars. No model/provider or physics mocks.
// node engine/test/crash-perf.mjs [--browser] [--wasm /path/to/core.wasm] [--report-only]
// Browser mode measures physics on requestAnimationFrame, NOT the city's GPU rendering budget.
// Run timing checks alone; --report-only is for measuring the unchanged baseline.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const bytes = [...await readFile(args.includes('--wasm') ? args[args.indexOf('--wasm') + 1] : new URL('../page/core.wasm', import.meta.url))]

// Self-contained so exactly the same fixture runs in Node and Chromium.
async function exercise({ bytes, paced = false, module }) {
  // A module's first calls pay for compiling it, which no crash causes: run the fixture once untimed, then measure
  // a fresh instance of the same compiled module. The cold first step is reported beside the budgeted ones.
  if (!module) {
    module = await WebAssembly.compile(new Uint8Array(bytes))
    const { firstStepMs: coldFirstStepMs } = await exercise({ module })
    return { coldFirstStepMs, ...await exercise({ module, paced }) }
  }
  const { exports: core } = await WebAssembly.instantiate(module, {})
  const write = (values, floats = false) => {
    const ptr = core.edits_room(values.length)
    new (floats ? Float32Array : Int32Array)(core.memory.buffer, ptr, values.length).set(values)
  }
  const edit = rows => { write([1, rows.length / 5, ...rows]); core.world_edit(-1) }
  let bodies = new Set(), hits = 0, broke = 0, wallHits = 0, carHits = 0, peak = 0
  const speeds = new Map(), broken = new Set()
  const read = n => {
    const words = new Uint32Array(core.memory.buffer, core.bodies_words(), n)
    const f = new Float32Array(words.buffer, words.byteOffset, n)
    for (let i = 0; i < n;) {
      const tag = words[i], at = i + 2, end = at + words[i + 1], id = words[at]
      if (tag === 2) bodies.add(id)
      if (tag === 3 || tag === 6) bodies.delete(id)
      if (tag === 6) { broke++; broken.add(id) }
      if (tag === 10) { hits++; if (words[at + 1] === 0) wallHits++; else carHits++ }
      if (tag === 11) for (let k = at; k < end; k += 12) speeds.set(words[k], f[k + 1])
      i = end
    }
    peak = Math.max(peak, bodies.size)
  }
  const car = (x = 760, z = 4055) => {
    // Same 42 x 10 x 18 steel shell/cabin/wheels as the native living fixture.
    const cells = new Int32Array(42 * 10 * 18)
    const set = (x, y, z, kind) => { cells[x + 42 * (z + 18 * y)] = kind }
    for (let y = 2; y < 10; y++) for (let z = 1; z < 17; z++) for (let x = 0; x < 42; x++) {
      const cabin = y >= 6
      if (cabin && (x < 10 || x >= 31)) continue
      if (x === (cabin ? 10 : 0) || x === (cabin ? 30 : 41) || z === 1 || z === 16 || y === (cabin ? 6 : 2) || y === (cabin ? 9 : 5)) set(x, y, z, cabin && y > 6 && y < 9 ? 11 : 12)
    }
    for (const z of [3, 4, 13, 14]) for (const y of [3, 4]) set(41, y, z, 15)
    for (const x0 of [4, 32]) for (const z of [0, 17]) for (let x = x0; x < x0 + 6; x++) for (let y = 0; y < 6; y++) {
      if (!((x === x0 || x === x0 + 5) && (y === 0 || y === 5))) set(x, y, z, 12)
    }
    write(cells); read(core.living_spawn(42, 10, 18, x, 2403, z, 0))
    const id = core.living_last()
    const motor = [0, 1.3, 60, 200, 0.55, 0, 0, 0, 0, 0, 120]
    for (const [x, z, front] of [[7, 1, false], [7, 17, false], [35, 1, true], [35, 17, true]]) motor.push(x, 3, z, 6, +front, +!front)
    write(motor, true)
    if (!id || !core.living_motor(id, motor.length)) throw Error('car spawn/motor failed')
    return id
  }
  const reset = () => {
    core.world_forget(); bodies = new Set(); speeds.clear(); broken.clear()
    const rows = []
    for (let y = 2398; y < 2400; y++) for (let z = 3900; z < 4250; z++) rows.push(0, 30000, y, z, 6)
    edit(rows)
  }
  const times = [], gaps = []
  let lastFrame
  const step = async id => {
    if (paced) {
      const now = await new Promise(requestAnimationFrame)
      if (lastFrame !== undefined) gaps.push(now - lastFrame)
      lastFrame = now
    }
    core.living_drive(id, 1, 0, 0, 0, 0)
    const start = performance.now(), n = core.bodies_advance(1 / 60)
    times.push(performance.now() - start)
    read(n)
  }
  const survival = []
  for (const glance of [true, false]) {
    reset()
    if (glance) {
      const rows = []
      for (let y = 2400; y < 2432; y++) rows.push(740, 960, y, 4077, 12)
      edit(rows)
    } else car(812)
    const id = car(), beforeHits = hits
    core.living_kick(id, glance ? 195 : 150, 0, glance ? 80 : 0)
    for (let i = 0; i < 15; i++) await step(id)
    survival.push({ scenario: glance ? '76 km/h glance' : '54 km/h parked-car bump', alive: bodies.has(id) && !broken.has(id), hits: hits - beforeHits, forwardCellsPerSecond: speeds.get(id) })
  }
  reset()
  let survivedRams = 0
  for (let crash = 0; crash < 12; crash++) {
    const rows = []
    for (let y = 2399; y < 2432; y++) for (let z = 4047; z < 4085; z++) rows.push(870, 872, y, z, 8)
    edit(rows)
    if (crash % 2) car(820)
    const id = car()
    core.living_kick(id, crash % 3 === 0 ? 110 : 220, 0, 0)
    for (let i = 0; i < 90; i++) await step(id)
    survivedRams += +(!broken.has(id) && bodies.has(id))
    read(core.living_vanish(id))
  }
  const stats = values => {
    values.sort((a, b) => a - b)
    return { samples: values.length, p50: values[Math.floor(values.length * 0.5)], p95: values[Math.floor(values.length * 0.95)], max: values.at(-1) }
  }
  return { firstStepMs: times[0], stepMs: stats(times), ...(paced ? { frameGapMs: stats(gaps) } : {}), peakBodies: peak, hits, wallHits, carHits, broke, survivedRams, survival }
}

function check(result) {
  console.log(JSON.stringify(result, null, 2))
  if (args.includes('--report-only')) return
  assert.ok(result.survival.every(s => s.alive && s.hits > 0), 'moderate/glancing collisions survive and emit STRUCK')
  assert.ok(result.survival[0].forwardCellsPerSecond > 160, 'glance retains momentum (old friction left 143)')
  assert.ok(result.wallHits > 0 && result.carHits > 0 && result.broke > 0, 'wall/car collisions and catastrophic breakage exercised')
  assert.ok(result.peakBodies <= 128, 'debris remains bounded')
  assert.ok(result.stepMs.p95 < 5 && result.stepMs.max < 16, 'physics step stays within the 60 FPS budget')
}

console.log('Node/wasm crash timings (milliseconds):')
check(await exercise({ bytes }))
if (args.includes('--browser')) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true, args: process.platform === 'linux'
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist']
    : ['--enable-unsafe-webgpu'] })
  try {
    const page = await browser.newPage()
    await page.route('https://crash.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Crash physics benchmark</title><p>Physics-only frame cadence; no city renderer.</p>' }))
    await page.goto('https://crash.test/')
    console.log('Chromium adapter:', await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter()
      return adapter ? { vendor: adapter.info.vendor, device: adapter.info.device, description: adapter.info.description } : 'unavailable; physics uses CPU wasm'
    }))
    console.log('Chromium/wasm crash timings and physics-only rAF gaps (milliseconds):')
    check(await page.evaluate(exercise, { bytes, paced: true }))
    await page.close()
  } finally { await browser.close() }
}
