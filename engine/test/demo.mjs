// Pictures of a house front being broken (#140): three charges across it, what falls, what is left.
// A tool for the hand, not a check.   node test/demo.mjs --out dir
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const here = new URL('..', import.meta.url).pathname
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const port = 5748, out = arg('out', '.')
await mkdir(out, { recursive: true })
const server = spawn('node', ['serve.mjs', '--port', String(port), '--reports', '/dev/null'], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve) => server.stdout.on('data', (chunk) => { if (String(chunk).includes('engine page on')) resolve() }))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`page error: ${e.message}`))
  await page.goto(`http://127.0.0.1:${port}/city?fly=0&scale=1`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 30_000 })
  const still = () => page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 && e.world.stats.ready > 0 && !e.settling && e.dropping === 0 && e.march.sun.undrawn === 0 }, null, { timeout: 120_000 })
  await still()
  // Across the street from a house front, a little above the road.
  await page.evaluate(() => Object.assign(globalThis.engine.pose, { y: globalThis.engine.pose.y - 8.5, z: globalThis.engine.pose.z - 4, yaw: Number(new URLSearchParams(location.search).get('yaw') ?? 3.3), pitch: 0.2 }))
  await page.waitForTimeout(300)
  await still()
  await page.screenshot({ path: `${out}/front-before.png` })
  const base = await page.evaluate(() => ({ ...globalThis.engine.pose }))
  let n = 0
  for (const [turn, up] of JSON.parse(arg('aims', '[[-0.22,0.02],[0,0.02],[0.22,0.02],[-0.11,0.02],[0.11,0.02]]'))) {
    await page.evaluate(([b, t, u]) => Object.assign(globalThis.engine.pose, { yaw: b.yaw + t, pitch: b.pitch + u }), [base, turn, up])
    await page.waitForTimeout(80)
    await page.evaluate(() => globalThis.engine.blast(16))
    await page.evaluate((b) => Object.assign(globalThis.engine.pose, { yaw: b.yaw, pitch: b.pitch }), base)
    await page.waitForFunction(() => globalThis.engine.dropping > 0, null, { timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(220)
    await page.screenshot({ path: `${out}/front-during-${n++}.png` })
    await still()
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/front-after.png` })
  const fell = await page.evaluate(() => ({ ...globalThis.engine.fell }))
  console.log(`${fell.asks} blasts: ${fell.pieces} pieces, ${fell.cells} cells fell, ${fell.dust} crumbs; the last worked out in ${fell.ms.toFixed(0)} ms`)
} finally { await browser.close(); server.kill() }
