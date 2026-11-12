// Breaks things for real (#140): the city page in the installed Chrome with WebGPU, a blast
// at a window and one at a wall, and what is there afterwards asked of the page's own picking.
// Glass must be gone further from the blast than the blast is wide; a wall must not be.
//
//   node test/blast.mjs [--out dir]
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const here = new URL('..', import.meta.url).pathname
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const port = Number(arg('port', '5745')), out = arg('out', '')
if (out) await mkdir(out, { recursive: true })
const server = spawn('node', ['serve.mjs', '--port', String(port), '--reports', '/dev/null'], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve) => server.stdout.on('data', (chunk) => { if (String(chunk).includes('engine page on')) resolve() }))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const GLASS = 11, WALLS = [8, 9, 10]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`http://127.0.0.1:${port}/city?fly=0&scale=1`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 30_000 })
  const made = () => page.waitForFunction(() => globalThis.engine.world.stats.wanted === 0 && globalThis.engine.world.stats.ready > 0, null, { timeout: 120_000 })
  await made()
  // Stand in the street and face the houses on one side.
  await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 10.2; p.yaw = 0; p.pitch = 0.12 })
  await page.waitForTimeout(300)
  await made()
  const pick = (right = 0, up = 0) => page.evaluate(([r, u]) => globalThis.engine.pick(r, u), [right, up])
  /** Turns the head until what is ahead is one of `materials` and so is the thing `aside` cells to its right. Returns how far it is and the angle to that second thing. */
  const face = async (materials, aside) => {
    for (let pitch = 0.05; pitch < 0.9; pitch += 0.04) for (let yaw = -1.0; yaw < 1.0; yaw += 0.05) {
      await page.evaluate(([y, p]) => { globalThis.engine.pose.yaw = y; globalThis.engine.pose.pitch = p }, [yaw, pitch])
      const hit = await pick()
      if (!hit || !materials.includes(hit.material) || hit.t > 250) continue
      const turn = Math.atan(aside / hit.t), beside = await pick(turn, 0)
      if (beside && materials.includes(beside.material) && Math.abs(beside.t - hit.t) < 6) return { hit, turn, beside }
    }
    return null
  }
  const blastAndWait = async (radius) => {
    const done = await page.evaluate((r) => globalThis.engine.blast(r), radius)
    await page.waitForTimeout(120)
    if (out) await page.screenshot({ path: `${out}/${radius}-${done?.material}-during.png` })
    // Until the sectors are made again, what the blast left unheld has been found, and all of it has landed.
    await page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 && !e.settling && e.dropping === 0 }, null, { timeout: 30_000 })
    await page.waitForTimeout(400)
    return done
  }

  // A window: glass ahead, and glass 12 cells to the side of it, further than a blast of 6 is wide.
  const pane = await face([GLASS], 12)
  check(!!pane, 'found a window with glass 12 cells aside of its middle')
  if (pane) {
    if (out) await page.screenshot({ path: `${out}/window-before.png` })
    const done = await blastAndWait(6)
    check(done?.material === GLASS, `the blast hit glass (material ${done?.material})`)
    const [middle, beside] = [await pick(), await pick(pane.turn, 0)]
    check(!middle || middle.t > pane.hit.t + 2, `the glass ahead is gone (was ${pane.hit.t.toFixed(1)} cells off, now ${middle ? middle.t.toFixed(1) : 'sky'})`)
    check(!beside || beside.material !== GLASS || beside.t > pane.beside.t + 2, `the glass 12 cells aside is gone too, twice the blast's radius away (now material ${beside?.material} at ${beside?.t.toFixed(1)})`)
    if (out) await page.screenshot({ path: `${out}/window-after.png` })
  }

  // A wall: wall ahead and wall 12 cells aside. The same blast must leave the wall aside standing.
  const wall = await face(WALLS, 12)
  check(!!wall, 'found a wall with wall 12 cells aside')
  if (wall) {
    if (out) await page.screenshot({ path: `${out}/wall-before.png` })
    const done = await blastAndWait(6)
    check(WALLS.includes(done?.material), `the blast hit a wall (material ${done?.material})`)
    const [middle, beside] = [await pick(), await pick(wall.turn, 0)]
    check(!middle || middle.t > wall.hit.t + 1, `the wall ahead is broken into (was ${wall.hit.t.toFixed(1)} cells off, now ${middle ? middle.t.toFixed(1) : 'sky'})`)
    check(!!beside && WALLS.includes(beside.material) && Math.abs(beside.t - wall.beside.t) < 1, `the wall 12 cells aside stands (material ${beside?.material} at ${beside?.t.toFixed(1)}, was ${wall.beside.t.toFixed(1)})`)
    if (out) await page.screenshot({ path: `${out}/wall-after.png` })
    // A big one, for the picture.
    await blastAndWait(16)
    if (out) await page.screenshot({ path: `${out}/wall-big.png` })
  }
  const stats = await page.evaluate(() => globalThis.engine.world.stats)
  check(stats.full === 0, 'every sector made again fitted the pool')
} catch (e) {
  failures.push(String(e))
} finally {
  await browser.close()
  server.kill()
}
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('blast: ok')
