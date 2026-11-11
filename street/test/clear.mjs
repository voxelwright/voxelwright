// Where a made thing may stand (#118): asked for at the worst places (facing a house front from a
// step away, on a tree, on a lamp, at the street's end, on top of whoever asked), a thing is stood in
// the open street and settles there, in a world that has the houses, lamps and trees in it.
// Usage: node test/clear.mjs [lab.json]   (a lab file from test/make-lab.mjs adds a model's own things)
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const bad = []
try {
  const load = (path) => server.ssrLoadModule(path)
  const { loadJolt, createJolt } = await load('../home/src/engine/jolt.ts')
  const { World } = await load('../home/src/engine/world.ts')
  const { boxOf } = await load('../home/src/engine/made.ts')
  const { STREET, FURNITURE, STANDING, registerBlock } = await load('/src/scene.ts')
  const { HOUSES, FRONT } = await load('/src/houses.ts')
  const { checkMade, plotFor } = await load('/src/make.ts')
  const { HALF_L, GRADE, planeAt } = await load('/src/ground.ts')
  await loadJolt()
  registerBlock()
  const END = HALF_L / Math.hypot(1, GRADE)
  const part = (pieces, more = {}) => ({ id: 'body', material: 'maple', motion: 'dynamic', mass: 40, at: [0, 0.02, 0], pieces, ...more })
  const box = (half, at, paint = '#c98d5a') => ({ shape: { kind: 'box', half }, at, paint })
  const things = [
    ['a crate', { label: 'Crate', parts: [part([box([0.4, 0.4, 0.4], [0, 0.4, 0])])] }],
    ['a long plank', { label: 'Plank', parts: [part([box([0.5, 0.06, 3.6], [0, 0.06, 0])], { mass: 120 })] }],
    ['a wide table', { label: 'Table', parts: [part([box([1.8, 0.05, 0.9], [0, 0.9, 0]), ...[-1, 1].flatMap((x) => [-1, 1].map((z) => box([0.06, 0.45, 0.06], [x * 1.6, 0.45, z * 0.7])))])] }],
    ['a tall post', { label: 'Post', parts: [part([box([0.5, 0.05, 0.5], [0, 0.05, 0]), box([0.1, 2.6, 0.1], [0, 2.7, 0])], { mass: 200 })] }],
  ]
  if (process.argv[2]) for (const row of JSON.parse(readFileSync(process.argv[2], 'utf8'))) if (row.toy && row.model?.startsWith('sonnet')) things.push([row.text, { label: row.toy.label, parts: row.toy.parts, gadgets: row.toy.gadgets ?? [], wires: row.toy.wires ?? [] }])
  const tree = STANDING.find((o) => o.from > 0), lamp = STANDING.find((o) => o.r === 0.2 && !STANDING.some((t) => t.from > 0 && t.x === o.x && t.z === o.z))
  // Who asks, from where, looking which way (yaw 0 looks down the hill, a quarter turn looks at the east fronts).
  const asks = [
    ['facing the east fronts from a step away', [FRONT - 1.2, -8], Math.PI / 2],
    ['facing the west fronts from a step away', [-FRONT + 1.2, 11], -Math.PI / 2],
    ['a tree 4.5 m ahead', [tree.x, tree.z - 4.5], 0],
    ['a lamp 4.5 m ahead', [lamp.x, lamp.z - 4.5], 0],
    ['the bottom end 2 m ahead', [1, END - 2], 0],
    ['the top end behind a turn', [-2, -END + 1.5], Math.PI],
  ]
  let n = 0, worst = 0
  for (const [name, toy] of things) for (const [where, [x, z], yaw] of asks) {
    const asker = [x, planeAt(z) + 0.75, z]
    const result = checkMade(JSON.stringify({ say: name, toy: { gadgets: [], wires: [], ...toy } }), plotFor(asker, yaw), `made-${++n}`, [asker])
    const tag = `${name}, ${where}`
    if (!('toy' in result)) { bad.push(`${tag}: refused, ${result.reason ?? result.say}`); continue }
    const { lo, hi } = boxOf(result.toy), f = result.toy.frame, c = Math.cos(f.yaw), s = Math.sin(f.yaw)
    const xs = [lo[0], hi[0]].flatMap((px) => [lo[2], hi[2]].map((pz) => f.at[0] + px * c + pz * s)), zs = [lo[0], hi[0]].flatMap((px) => [lo[2], hi[2]].map((pz) => f.at[2] - px * s + pz * c))
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
    if (x0 < -FRONT || x1 > FRONT) bad.push(`${tag}: stands from x ${x0.toFixed(2)} to ${x1.toFixed(2)}, past a front at ${FRONT}`)
    if (z0 < -END || z1 > END) bad.push(`${tag}: stands from z ${z0.toFixed(2)} to ${z1.toFixed(2)}, past an end at ${END.toFixed(2)}`)
    const over = (o) => x0 < o.x + o.r && x1 > o.x - o.r && z0 < o.z + o.r && z1 > o.z - o.r
    const on = STANDING.find((o) => hi[1] > o.from && over(o))
    if (on) bad.push(`${tag}: stands on what is at ${on.x.toFixed(1)}, ${on.z.toFixed(1)}`)
    if (over({ x, z, r: 0.3 })) bad.push(`${tag}: stands on whoever asked`)
    // Then the thing itself, in a world with the street's still things: two seconds, and it has not been thrown.
    const world = new World(createJolt(), () => {}, undefined, -40)
    world.addToy(STREET)
    for (const house of HOUSES) world.addToy(house)
    world.addToy(FURNITURE)
    world.addToy(result.toy)
    const keys = result.toy.parts.filter((p) => p.motion === 'dynamic').map((p) => `${result.toy.id}/${p.id}`)
    const from = keys.map((k) => world.thing(k).position)
    world.advance(2)
    keys.forEach((k, i) => {
      const p = world.thing(k).position, moved = Math.hypot(p[0] - from[i][0], p[2] - from[i][2])
      worst = Math.max(worst, p[1] - from[i][1])
      if (p[1] > from[i][1] + 1.5 || moved > 6 || Math.abs(p[0]) > FRONT + 0.5) bad.push(`${tag}: ${k} was thrown (${moved.toFixed(1)} m along the ground, ${(p[1] - from[i][1]).toFixed(1)} m up, x ${p[0].toFixed(1)})`)
    })
    world.dispose()
  }
  console.log(JSON.stringify({ things: things.length, asks: asks.length, placed: n, highestRiseM: +worst.toFixed(2), bad: bad.length }))
  for (const line of bad.slice(0, 20)) console.log('FAILED:', line)
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
if (bad.length) process.exitCode = 1
await server.close()
