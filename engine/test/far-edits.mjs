// Looks at what edits put in the world from on foot, from 100 m and from 400 m up (#140): a ribbon of road one cell
// thick, a path one cell wide and two walls one cell thick, laid as ordinary edits on the plain east of the town,
// then one wall taken away again. A tool for the hand, not a check: it keeps pictures.
//   node test/far-edits.mjs --name before [--port 5821] [--out ~/.village/engine/far] [--ruin]
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, here, still } from './kit.mjs'

const port = Number(arg('port', '5821')), name = arg('name', 'look'), out = arg('out', join(homedir(), '.village', 'engine', 'far'))
mkdirSync(out, { recursive: true })
const file = join(tmpdir(), `engine-far-edits-${process.pid}.log`)
const server = spawn('node', ['serve.mjs', '--port', String(port), '--reports', '/dev/null', '--world', file], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve, reject) => { server.stdout.on('data', (c) => { if (/engine page on/.test(String(c))) resolve() }); server.on('exit', (code) => reject(new Error(`the server ended (${code})`))) })
const url = `http://127.0.0.1:${port}`
const { instance } = await WebAssembly.instantiate(readFileSync(here + 'page/core.wasm'), {})
const feet = (x, z) => instance.exports.feet_at(x, z)

const ASPHALT = 6, BRICK = 8, X0 = 43000, X1 = 47000, Z = 4300
// Rows along x on the ground under each column: `high` cells up from where feet stand, `lift` cells above that.
const along = (x0, x1, z, high, kind) => {
  const rows = []
  for (let x = x0; x < x1;) {
    const g = feet(x, z)
    let to = x + 1
    while (to < x1 && feet(to, z) === g) to++
    for (let y = g; y < g + high; y++) rows.push([x, to, y, z, kind])
    x = to
  }
  return rows
}
const across = (x, z0, z1, high, kind) => { const rows = []; for (let z = z0; z < z1; z++) { const g = feet(x, z); for (let y = g; y < g + high; y++) rows.push([x, x + 1, y, z, kind]) } return rows }
const ask = async (rows) => {
  rows.sort((a, b) => a[2] - b[2] || a[3] - b[3] || a[0] - b[0])
  for (let i = 0; i < rows.length; i += 12000) {
    const part = rows.slice(i, i + 12000)
    const r = await fetch(`${url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'Far', edit: [1, part.length, ...part.flat()], release: [part[0][0], part[0][2], part[0][3]] }) })
    if (!r.ok) throw new Error(`the edit was refused: ${r.status} ${await r.text()}`)
  }
  return rows.length
}
// --ruin: nothing is built; houses by the street are blasted, left to come to rest, and looked at from above.
if (process.argv.includes('--ruin')) {
  const browser = await chrome()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  const [x0, z0] = [640, 3940], tops = await (await fetch(`${url}/world/tops?x0=${x0}&z0=${z0}&x1=${x0 + 256}&z1=${z0 + 256}&y=700`)).json()
  // The columns where something stands 4 m or more over the ground: charges go in among them, spread out.
  const built = []
  for (let i = 0; i < 65536; i += 7) { const x = x0 + i % 256, z = z0 + (i >> 8); if (tops.high[i] !== null && tops.high[i] - instance.exports.ground_at(x, z) > 40) built.push([x, instance.exports.ground_at(x, z) + 15, z]) }
  const at = built.reduce((a, b) => [a[0] + b[0] / built.length, a[1] + b[1] / built.length, a[2] + b[2] / built.length], [0, 0, 0]).map((v) => v / 10)
  await page.goto(`${url}/city?fly=0&shared=1&at=${at[0]},${at[1] + 100},${at[2]}&look=90,-89`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  for (let i = 0; i < 6; i++) await fetch(`${url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'Far', blast: built[Math.floor((i + 0.5) * built.length / 6)], radius: 40 }) })
  await page.waitForTimeout(20_000)
  await still(page, { limit: 300_000 })
  for (const [as, up, pitch, back] of [['100m', 100, -89, 0], ['400m', 400, -89, 0], ['aslant', 150, -30, 250]]) {
    await page.evaluate(([x, y, z, pitch]) => Object.assign(globalThis.engine.pose, { x, y, z, yaw: Math.PI / 2, pitch: pitch * Math.PI / 180 }), [at[0] - back, at[1] + up, at[2], pitch])
    await page.waitForTimeout(600)
    await still(page)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(out, `${name}-ruin-${as}.png`) })
    console.log(`  ${join(out, `${name}-ruin-${as}.png`)}`)
  }
  await browser.close()
  server.kill()
  rmSync(file, { force: true })
  process.exit(0)
}
const road = []
for (let z = Z; z < Z + 40; z++) road.push(...along(X0, X1, z, 1, ASPHALT))
const path = along(X0, X1, Z + 140, 1, ASPHALT)
const wall = along(X0, X1, Z + 240, 20, BRICK)
const cross = across(45400, Z - 600, Z + 900, 20, BRICK + 256 * 3)
console.log(`laid: a road 4 m wide ${await ask(road)} rows, a path one cell wide ${await ask(path)}, a wall along it ${await ask(wall)}, a wall across ${await ask(cross)}`)

const browser = await chrome()
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
const page = await context.newPage()
page.on('pageerror', (e) => console.log(`  page error: ${e.message}`))
const g = feet(45000, Z + 120) / 10
const views = { foot: [4496, g + 1.7, Z / 10 + 6, 90, -6], '100m': [4500, g + 100, Z / 10 + 12, 90, -89], '400m': [4500, g + 400, Z / 10 + 12, 90, -89], aslant: [4250, g + 150, Z / 10 + 6, 90, -30] }
await page.goto(`${url}/city?fly=0&shared=1&at=${views.foot.slice(0, 3)}&look=${views.foot.slice(3)}`)
await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
const shoot = async (view, as) => {
  const [x, y, z, yaw, pitch] = views[view]
  await page.evaluate(([x, y, z, yaw, pitch]) => Object.assign(globalThis.engine.pose, { x, y, z, yaw: yaw * Math.PI / 180, pitch: pitch * Math.PI / 180 }), [x, y, z, yaw, pitch])
  await page.waitForTimeout(600)
  await still(page)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(out, `${name}-${as}.png`) })
  console.log(`  ${join(out, `${name}-${as}.png`)}`)
}
try {
  for (const view of Object.keys(views)) await shoot(view, view)
  // The wall across is taken away again, cell for cell: it must be gone from every copy.
  await ask(cross.map((r) => [r[0], r[1], r[2], r[3], 0]))
  await page.waitForTimeout(1500)
  await shoot('400m', '400m-wall-taken')
  await shoot('100m', '100m-wall-taken')
} finally {
  await browser.close()
  server.kill()
  rmSync(file, { force: true })
}
process.exit(0)
