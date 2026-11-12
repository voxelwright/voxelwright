// What breaking a house of cells costs the world process (#138), headless, on the solver core:
// carving, finding the pieces that came loose, rebuilding what the solver collides with, and
// the step while the loose pieces fall. Usage: node test/voxel-tick.mjs [cell metres] [chunk cells]
import { loadavg } from 'node:os'
import { createServer } from 'vite'

const CELL = Number(process.argv[2] ?? 0.1), CHUNK = Number(process.argv[3] ?? 32)
const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const ms = (f) => { const t = performance.now(); const out = f(); return [performance.now() - t, out] }
const round = (x) => +x.toFixed(2)
try {
  const load = (path) => server.ssrLoadModule(path)
  const { loadJolt, createJolt } = await load('../home/src/engine/jolt.ts')
  const V = await load('../home/src/engine/voxels.ts')
  await loadJolt()
  const core = createJolt()
  core.setGravity([0, -9.81, 0])
  core.setCombine(() => [0.6, 0.05])
  const n = (m) => Math.round(m / CELL)

  // A house as a shell: outer walls, a floor at each storey, two walls inside, window holes with glass, a flat roof.
  const W = n(7.4), D = n(10), H = n(11.5), wall = Math.max(1, n(0.3)), slab = Math.max(1, n(0.2))
  const house = V.voxels([W, H, D], CELL)
  const plaster = V.kindOf(house, 'plaster'), wood = V.kindOf(house, 'maple'), glass = V.kindOf(house, 'glass')
  V.fillBox(house, [0, 0, 0, W, H, D], plaster)
  V.fillBox(house, [wall, 0, wall, W - wall, H - wall, D - wall], 0)
  for (const y of [0, n(2.9), n(5.9), n(8.9)]) V.fillBox(house, [0, y, 0, W, y + slab, D], wood)
  V.fillBox(house, [n(3.6), 0, 0, n(3.6) + slab, H, D], plaster)
  V.fillBox(house, [0, 0, n(5), W, H, n(5) + slab], plaster)
  for (const y of [n(0.9), n(3.8), n(6.8), n(9.6)]) for (const x of [n(0.8), n(3), n(5.3)]) for (const z of [0, D - wall]) {
    V.fillBox(house, [x, y, z, x + n(1), y + n(1.6), z + wall], 0)
    V.fillBox(house, [x, y, z + (wall >> 1), x + n(1), y + n(1.6), z + (wall >> 1) + 1], glass)
  }
  for (const y of [n(0.2), n(3.1), n(6.1)]) { V.fillBox(house, [n(3.6), y, n(2), n(3.6) + slab, y + n(2), n(3)], 0); V.fillBox(house, [n(1.5), y, n(5), n(2.5), y + n(2), n(5) + slab], 0) }
  const solid = V.solidCells(house)

  // What the solver collides with: one still body for each chunk of the house, so a hole rebuilds only the chunks it touched.
  const compound = (boxes, origin = [0, 0, 0]) => ({ kind: 'compound', boxes: Array.from({ length: boxes.length / 6 }, (_, i) => {
    const b = boxes.subarray(i * 6, i * 6 + 6)
    return { half: [(b[3] - b[0]) * CELL / 2, (b[4] - b[1]) * CELL / 2, (b[5] - b[2]) * CELL / 2], at: [((b[0] + b[3]) / 2 - origin[0]) * CELL, ((b[1] + b[4]) / 2 - origin[1]) * CELL, ((b[2] + b[5]) / 2 - origin[2]) * CELL], rotation: [0, 0, 0, 1] }
  }) })
  const at = [0, 0, 0]
  const chunks = new Map()
  let boxCount = 0
  const chunkBox = (cx, cy, cz) => [cx * CHUNK, cy * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cy + 1) * CHUNK, (cz + 1) * CHUNK]
  const rebuild = (cx, cy, cz) => {
    const key = `${cx},${cy},${cz}`, old = chunks.get(key)
    if (old !== undefined) { core.removeBody(old.id); boxCount -= old.boxes }
    const boxes = V.boxesOf(house, chunkBox(cx, cy, cz))
    if (!boxes.length) { chunks.delete(key); return 0 }
    chunks.set(key, { id: core.addBody({ shape: compound(boxes), motion: 'static', position: at, density: 1000, friction: 0.6, restitution: 0.05 }), boxes: boxes.length / 6 })
    boxCount += boxes.length / 6
    return boxes.length / 6
  }
  const [buildMs] = ms(() => { for (let cy = 0; cy * CHUNK < H; cy++) for (let cz = 0; cz * CHUNK < D; cz++) for (let cx = 0; cx * CHUNK < W; cx++) rebuild(cx, cy, cz) })
  core.addBody({ shape: { kind: 'box', half: [60, 1, 60] }, motion: 'static', position: [0, -1, 0], density: 1000, friction: 0.7, restitution: 0.05 })
  const [wholeBoxesMs, whole] = ms(() => V.boxesOf(house))
  console.log(JSON.stringify({ cell: CELL, chunk: CHUNK, house: { cells: [W, H, D], solid, chunks: chunks.size, boxes: boxCount, buildMs: round(buildMs), asOneBody: { boxes: whole.length / 6, ms: round(wholeBoxesMs) } } }))

  const density = (k) => ({ plaster: 1100, maple: 700, glass: 2500 })[k.material]
  const loose = []
  /** A carve, as the world would do it: the hole, the pieces, the colliders, the new bodies. Returns what each part cost. */
  const carve = (c, r, crumb = 8) => {
    const [carveMs, hit] = ms(() => V.fillSphere(house, c, r, 0))
    if (!hit) return null
    const [piecesMs, found] = ms(() => V.loosened(house, hit.box, 1))
    const off = found.list
    let boxes = 0, biggest = 0, crumbs = 0
    const dirty = new Set()
    const touch = (b) => { for (let cy = Math.floor(b[1] / CHUNK); cy * CHUNK < b[4]; cy++) for (let cz = Math.floor(b[2] / CHUNK); cz * CHUNK < b[5]; cz++) for (let cx = Math.floor(b[0] / CHUNK); cx * CHUNK < b[3]; cx++) dirty.add(`${cx},${cy},${cz}`) }
    touch(hit.box)
    const [takeMs] = ms(() => {
      for (const piece of off) {
        touch(piece.box)
        if (piece.cells < crumb) { V.drop(house, piece, found.labels); crumbs++; continue }
        const block = V.take(house, piece, found.labels), b = V.boxesOf(block), w = V.weigh(block, density)
        boxes += b.length / 6
        biggest = Math.max(biggest, piece.cells)
        loose.push(core.addBody({ shape: compound(b), motion: 'dynamic', position: [at[0] + piece.box[0] * CELL, at[1] + piece.box[1] * CELL, at[2] + piece.box[2] * CELL], density: 1000, mass: w.mass, friction: 0.6, restitution: 0.05 }))
      }
    })
    const [rebuildMs] = ms(() => { for (const key of dirty) rebuild(...key.split(',').map(Number)) })
    return { removed: hit.changed, carveMs: round(carveMs), piecesMs: round(piecesMs), loose: off.length - crumbs, crumbs, looseBoxes: boxes, biggestCells: biggest, takeMs: round(takeMs), chunksRebuilt: dirty.size, rebuildMs: round(rebuildMs), totalMs: round(carveMs + piecesMs + takeMs + rebuildMs) }
  }
  const run = (seconds) => {
    const t = []
    for (let i = 0; i < seconds * 60; i++) { const [m] = ms(() => core.step(1 / 60, 1)); t.push(m); core.contacts(); core.activity() }
    t.sort((a, b) => a - b)
    const q = (p) => round(t[Math.min(t.length - 1, Math.floor(p * t.length))])
    return { p50: q(0.5), p95: q(0.95), max: q(1), awake: loose.filter((id) => !core.sleeping(id)).length }
  }

  console.log('idle step', JSON.stringify(run(1)))
  // A hole in the front wall at head height: nothing comes loose but the wall round the hole is rebuilt.
  console.log('a hole (0.6 m)', JSON.stringify(carve([n(2), n(1.5), 1], n(0.6))))
  console.log('a blast (1.5 m)', JSON.stringify(carve([n(4.5), n(1.6), 1], n(1.5))))
  console.log('step after', JSON.stringify(run(3)))
  // Cut the top storey loose: a row of blasts through every wall at one height, outside and in.
  const cut = [], cy = n(6.6), r = n(0.9)
  for (let x = 0; x <= W; x += n(1)) for (const z of [n(0.1), n(5.1), D - 2]) cut.push(carve([x, cy, z], r))
  for (let z = 0; z <= D; z += n(1)) for (const x of [n(0.1), n(3.7), W - 2]) cut.push(carve([x, cy, z], r))
  const did = cut.filter(Boolean), worst = did.reduce((a, b) => (b.totalMs > a.totalMs ? b : a))
  const big = did.reduce((a, b) => (b.biggestCells > a.biggestCells ? b : a))
  console.log('cutting a storey loose:', did.length, 'blasts; the costliest', JSON.stringify(worst), '; the one that freed the most', JSON.stringify(big), '; loose bodies now', loose.length)
  console.log('step while it falls', JSON.stringify(run(4)))
  // Many blasts at once all over the house, as a street fight would.
  let seed = 7
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % k }
  const many = []
  for (let i = 0; i < 40; i++) many.push(carve([rnd(W), rnd(H), rnd(D)], n(0.5) + rnd(n(0.8))))
  const mdid = many.filter(Boolean)
  mdid.sort((a, b) => a.totalMs - b.totalMs)
  console.log('40 more blasts:', JSON.stringify({ hit: mdid.length, medianMs: mdid[mdid.length >> 1]?.totalMs, worst: mdid[mdid.length - 1], looseBodies: loose.length }))
  console.log('step with all of it', JSON.stringify(run(5)), 'load', round(loadavg()[0]))
  core.dispose()
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
await server.close()
