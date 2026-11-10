// Close-up film strips of the home's villagers moving (#104): a camera rides beside one villager and a
// strip of frames is laid side by side, so motion (walk, turn, stop, idle) can be compared before and after.
// Frames are stamped with the page's own clock. Headless only; needs a dev server already running.
// Usage: node scripts/villagers/motion-shots.mjs <out-dir> [--dev=5410] [--query=a=b] [--who=Tuft] [--frames=8] [--every=110] [--wait=walk|idle|start|stop|none] [--name=strip] [--cam=0.9,1.1,2.0] [--hide=table,chairs,highchair]
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name, d) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d
const out = args.find((a) => !a.startsWith('--'))
if (!out) throw new Error('usage: motion-shots.mjs <out-dir> [--dev=5410] [--query=] [--who=] [--frames=8] [--every=110] [--wait=walk]')
const port = Number(opt('dev', 5410))
const who = opt('who', 'Tuft')
const frames = Number(opt('frames', 8))
const every = Number(opt('every', 110))
const wait = opt('wait', 'walk')
const name = opt('name', `${who.toLowerCase()}-${wait}`)
const size = Number(opt('size', 440))
const cam = opt('cam', '0.9,1.1,2.0').split(',').map(Number)
// Furniture that stands between this camera and the floor the villagers cross; hidden for the strip only.
const hide = opt('hide', 'table,chairs,highchair').split(',')
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(`http://localhost:${port}/?${opt('query', '')}`)
await page.waitForFunction(() => window.village?.ready)
const ready = await page.evaluate(() => window.village.ready())
if (!ready.ok) throw new Error(`page not ready: ${JSON.stringify(ready.problems)}`)

// Generated villagers are made after the page is ready: wait for the one asked for.
await page.waitForFunction((who) => {
  let found = false
  window.village.kernel.root.get('stage').scene.traverse((o) => { if (o.name?.startsWith(`villager ${who}`)) found = true })
  return found
}, who, { timeout: 60_000 })
// The camera rides beside the villager: set after the page's own camera each frame.
await page.evaluate(({ who, cam: off, hide }) => {
  const root = window.village.kernel.root
  const stage = root.get('stage')
  let target = null
  stage.scene.traverse((o) => { if (o.name?.startsWith(`villager ${who}`) && !o.name.endsWith('shadow')) target = o })
  if (!target) throw new Error(`no villager ${who}`)
  const cam = stage.camera
  for (const o of stage.scene.children) if (hide.includes(o.name)) o.visible = false
  const last = target.position.clone()
  const state = { speed: 0, t: 0, y: target.position.y, x: 0, z: 0 }
  let ax = target.position.x, az = target.position.z
  root.on('village/frame', (dt, t) => {
    const p = target.position
    const v = Math.hypot(p.x - last.x, p.z - last.z) / Math.max(dt, 1e-3)
    state.speed += (v - state.speed) * 0.2
    state.t = t; state.y = p.y; state.x = p.x; state.z = p.z
    last.copy(p)
    // A steady three-quarter view: the camera follows smoothly so the villager's own motion shows.
    ax += (p.x - ax) * Math.min(1, dt * 3); az += (p.z - az) * Math.min(1, dt * 3)
    cam.position.set(ax + off[0], off[1], az + off[2])
    cam.lookAt(ax, 0.4, az)
    cam.updateMatrixWorld()
  })
  document.querySelectorAll('body > :not(canvas)').forEach((e) => { if (!e.querySelector('canvas')) e.style.visibility = 'hidden' })
  window.__shots = state
}, { who, cam, hide })

// walk: mid-stride. idle: standing. start: the moment it sets off from standing. stop: as it arrives.
const state = () => page.evaluate(() => window.__shots)
const until = async (test, what) => {
  const deadline = Date.now() + 120_000
  while (!test(await state())) {
    if (Date.now() > deadline) throw new Error(`${who} never reached ${what}`)
    await page.waitForTimeout(wait === 'walk' || wait === 'idle' ? 80 : 16)
  }
}
const still = (s) => s.speed < 0.01 && s.y < 0.01
const moving = (s) => s.speed > 0.3 && s.y < 0.01
if (wait === 'walk') await until(moving, 'walk')
if (wait === 'idle') await until(still, 'idle')
if (wait === 'start') { await until(still, 'standing'); await page.waitForTimeout(600); await until((s) => !still(s) || s.gather, 'start') }
if (wait === 'stop') { await until(moving, 'walk'); await until((s) => s.speed < 0.25, 'stop') }
const shots = []
const t0 = await page.evaluate(() => window.__shots.t)
for (let i = 0; i < frames; i++) {
  const start = Date.now()
  const png = await page.screenshot()
  const s = await page.evaluate(() => window.__shots)
  shots.push({ png: png.toString('base64'), t: s.t - t0, speed: s.speed })
  await page.waitForTimeout(Math.max(0, every - (Date.now() - start)))
}
const sheet = await browser.newPage({ viewport: { width: Math.min(frames, 8) * 300, height: Math.ceil(frames / 8) * 322 } })
await sheet.setContent(`<body style="margin:0;background:#222;display:flex;flex-wrap:wrap;font:12px monospace;color:#ddd">${shots.map((s) => `<div style="width:300px"><img width=300 height=300 src="data:image/png;base64,${s.png}"><div style="padding:3px 6px">t=${s.t.toFixed(2)}s v=${s.speed.toFixed(2)}</div></div>`).join('')}</body>`)
await sheet.screenshot({ path: join(out, `${name}.png`) })
await writeFile(join(out, `${name}-last.png`), Buffer.from(shots.at(-1).png, 'base64'))
console.log(`${name}: ${shots.map((s) => s.t.toFixed(2)).join(' ')}`)
await browser.close()
