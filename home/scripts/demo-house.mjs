// Records a ~30 s headless clip of the one-house dollhouse (#42) with real input:
// orbit the whole house, glide kitchen -> living room -> kitchen by the doorway,
// pan with the keyboard, zoom into the living room, and a villager walking through
// the doorway. Writes a WebM with Playwright and an H.264 MP4 with ffmpeg.
// Usage: node scripts/demo-house.mjs <out.mp4> [base-url]   (dev server running)
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2]
const base = process.argv[3] ?? 'http://localhost:5181/'
if (!out) throw new Error('usage: demo-house.mjs <out.mp4> [base-url]')
const size = { width: 1280, height: 800 }
const dir = mkdtempSync(join(tmpdir(), 'house-video-'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
// Warm the page once outside the recording, so shader compiles do not land in the clip.
{
  const warm = await browser.newPage({ viewport: size })
  await warm.goto(`${base}?talk=npc&input=held&q=high`)
  await warm.evaluate(() => window.village.ready())
  await warm.waitForTimeout(3000)
  await warm.close()
}
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir, size } })
const page = await context.newPage()
const t0 = Date.now()
await page.goto(`${base}?talk=npc&input=held&q=high`)
await page.evaluate(() => window.village.ready())
await page.waitForTimeout(1500)
// The clip starts here: the page load before it is cut.
const start = (Date.now() - t0) / 1000
const still = () => page.waitForFunction(() => !window.village.kernel.root.get('rooms').moving, null, { timeout: 15000 })
const step = (what) => console.error(`${((Date.now() - t0) / 1000).toFixed(1)} s  ${what}`)

step('orbit')
// Orbit the whole house: hold E, then a short drag back with the mouse.
// (Headless input is slow, about a second per mouse move with WebGPU busy, so moves are few.)
await page.keyboard.down('e')
await page.waitForTimeout(3200)
await page.keyboard.up('e')
await page.mouse.move(640, 300)
await page.mouse.down()
for (let i = 1; i <= 4; i++) await page.mouse.move(640 + i * 60, 300)
await page.mouse.up()
await page.waitForTimeout(1200)
step('mia')
// Mia heads for the living room's plants, through the doorway.
await page.evaluate(() => window.village.talk.walk('mia', 'loungePlants'))

step('doorway glides')
// Into the kitchen, then through the doorway to the living room and back, by pointer.
await page.evaluate(() => window.village.kernel.root.get('rooms').go('kitchen'))
await still()
await page.waitForTimeout(700)
for (const id of ['to-living', 'to-kitchen']) {
  // High in the opening, above the furniture on either side, on that face's pick slab.
  const at = await page.evaluate((x) => {
    const { camera, renderer } = window.village.kernel.root.get('stage')
    const p = camera.position.clone().set(x, 1.75, 2.8).project(camera)
    const rect = renderer.domElement.getBoundingClientRect()
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
  }, id === 'to-living' ? 3.445 : 3.535)
  await page.mouse.move(at.x, at.y)
  await page.waitForTimeout(500)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(200)
  await still()
  await page.waitForTimeout(900)
}

step('keyboard')
// Keyboard: pan right along the house, then a touch back.
await page.keyboard.down('ArrowRight')
await page.waitForTimeout(1600)
await page.keyboard.up('ArrowRight')
await page.waitForTimeout(500)
await page.keyboard.down('ArrowLeft')
await page.waitForTimeout(500)
await page.keyboard.up('ArrowLeft')
await page.waitForTimeout(600)

step('zoom')
// Zoom into the living room with the wheel, where Mia is tending the plants.
const living = await page.evaluate(async () => {
  const { camera, renderer } = window.village.kernel.root.get('stage')
  const p = camera.position.clone().set(6.6, 0, 0.2).project(camera)
  const rect = renderer.domElement.getBoundingClientRect()
  return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
})
await page.mouse.dblclick(living.x, living.y)
await page.waitForTimeout(1200)
await page.mouse.move(640, 380)
for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -180)
await page.waitForTimeout(3000)
step('out')
// And out to the whole house again.
for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 500)
await page.waitForTimeout(1800)
const video = page.video()
await context.close()
await browser.close()
const webm = await video.path()
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', start.toFixed(2), '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out])
for (const f of readdirSync(dir)) rmSync(join(dir, f))
rmSync(dir, { recursive: true })
console.log(out)
