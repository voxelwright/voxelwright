// Headless proof of moving around the one-house dollhouse (#42): keyboard pan and turn,
// drag to turn, right-drag to pan, wheel to zoom, double-click to glide, clamping to the
// house and yard, reduced motion, the always-on input still taking typed letters, and a
// frame-to-frame flicker check on the doorway and window trim with the camera still.
// Usage: node scripts/check-navigation.mjs [base-url] [--shots=dir]   (dev server running)
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const shots = args.find((a) => a.startsWith('--shots='))?.slice(8)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.error(`${pass ? 'pass' : 'FAIL'}  ${name}`)
}
// The house's outer footprint plus the view's margin (layout.ts HOUSE, camera.ts BOUNDS).
const BOUNDS = { x0: -3.49 - 1, x1: 8.56 + 1, z0: -2.38 - 1.5, z1: 3.98 + 1.5 }
/** Flicker bar: share of trim pixels that change by more than 20 levels over 8 still frames. */
const FLICKER_MAX = 0.5

async function open(query, reducedMotion = 'no-preference', scale = 1) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale, reducedMotion })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}?${query}`)
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(1500)
  return { context, page, errors }
}
const frame = (page) => page.evaluate(() => ({ ...window.village.kernel.root.get('view').frame }))
const text = (page) => page.evaluate(() => window.village.talk.state().input?.text ?? null)
const settle = (page, ms = 900) => page.waitForTimeout(ms)
const hold = async (page, key, ms) => {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
  await settle(page)
}
/** A floor point's place on screen. */
const onScreen = (page, x, z) => page.evaluate(async ([x, z]) => {
  const { camera, renderer } = window.village.kernel.root.get('stage')
  const p = camera.position.clone().set(x, 0, z).project(camera)
  const rect = renderer.domElement.getBoundingClientRect()
  return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
}, [x, z])

// ── Keyboard, and the always-on input ────────────────────────────────────────
{
  const { context, page, errors } = await open('talk=npc&input=held&q=low')
  let a = await frame(page)
  await hold(page, 'ArrowRight', 600)
  let b = await frame(page)
  const right = (b.x - a.x) * Math.cos(a.yaw) - (b.z - a.z) * Math.sin(a.yaw)
  check('ArrowRight pans the view right', right > 0.8, { a, b, right })
  a = b
  await hold(page, 'ArrowUp', 600)
  b = await frame(page)
  const away = -(b.x - a.x) * Math.sin(a.yaw) - (b.z - a.z) * Math.cos(a.yaw)
  check('ArrowUp pans the view away from you', away > 0.8, { a, b, away })
  a = b
  await hold(page, 'a', 600)
  b = await frame(page)
  const left = -((b.x - a.x) * Math.cos(a.yaw) - (b.z - a.z) * Math.sin(a.yaw))
  check('holding A pans left and writes nothing', left > 0.5 && (await text(page)) === '', { a, b, left, text: await text(page) })
  a = b
  await hold(page, 'e', 700)
  b = await frame(page)
  check('holding E turns the view and writes nothing', b.yaw - a.yaw > 0.4 && (await text(page)) === '', { a: a.yaw, b: b.yaw })
  a = b
  await hold(page, 'q', 700)
  b = await frame(page)
  check('holding Q turns it back', a.yaw - b.yaw > 0.4, { a: a.yaw, b: b.yaw })

  // Typing: a tapped letter writes, even a navigation letter; fast typing keeps every letter in order.
  await page.keyboard.press('w')
  await page.waitForTimeout(300)
  const one = await text(page)
  await page.keyboard.type('hat a day', { delay: 40 })
  await page.waitForTimeout(200)
  const line = await text(page)
  check('a tapped W starts a line in the always-on input', one === 'w', one)
  check('typing goes on into the line, letters in order', line === 'what a day', line)
  a = await frame(page)
  await hold(page, 'ArrowLeft', 500)
  await hold(page, 'd', 500)
  b = await frame(page)
  const written = await text(page)
  // ArrowLeft moves the caret in the line, so the d lands one letter early.
  check('while a line is being written, arrows and WASD edit it and do not move the view', Math.hypot(b.x - a.x, b.z - a.z) < 0.05 && written.length === 'what a day'.length + 1 && written.includes('d'), { a, b, written })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('keyboard: no page errors', errors.length === 0, errors)
  await context.close()
}

// ── A delayed key event must not turn a tap into a hold ──────────────────────
// When the main thread stalls (or the keyup is slow to arrive), the 170 ms hold timer fires
// before the queued keyup or next keydown is handled, so only the events' own timeStamps
// tell a tap from a hold. "add a lamp" once became "dd a lamp". A busy loop in the page does
// not reproduce it (Chrome runs the queued input before the expired timer), so each event
// goes in through CDP with the time the key really went down, and the late one is sent 300 ms on.
{
  const drift = (a, b) => Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.yaw - a.yaw)
  const keys = { a: ['KeyA', 65], d: ['KeyD', 68] }
  const press = async (cdp, type, key, ms) => {
    const [code, windowsVirtualKeyCode] = keys[key]
    await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, ...(type === 'keyDown' && { text: key }), timestamp: ms / 1000 })
  }
  {
    const { context, page } = await open('talk=npc&input=held&q=low')
    const cdp = await context.newCDPSession(page)
    const t0 = Date.now()
    await press(cdp, 'keyDown', 'a', t0)
    await page.waitForTimeout(300) // the hold timer fires; the keyup, stamped 40 ms after the keydown, is not here yet
    await press(cdp, 'keyUp', 'a', t0 + 40)
    const first = await text(page)
    await settle(page) // the view eases to a stop; a little nudge from the 130 ms of "hold" is fine
    const a = await frame(page)
    await page.keyboard.type('dd a lamp', { delay: 40 })
    await page.waitForTimeout(200)
    const line = await text(page)
    await settle(page)
    const b = await frame(page)
    check('a tap whose keyup is 300 ms late still writes its letter', first === 'a' && line === 'add a lamp', { first, line })
    check('and the view does not keep moving after it', drift(a, b) < 0.01, { a, b })
    await context.close()
  }
  {
    const { context, page } = await open('talk=npc&input=held&q=low')
    const cdp = await context.newCDPSession(page)
    const t0 = Date.now()
    await press(cdp, 'keyDown', 'a', t0)
    await page.waitForTimeout(300)
    await press(cdp, 'keyDown', 'd', t0 + 50) // pressed 50 ms after A, handled 300 ms later
    await press(cdp, 'keyUp', 'a', t0 + 90)
    await press(cdp, 'keyUp', 'd', t0 + 100)
    const line = await text(page)
    await settle(page)
    const a = await frame(page)
    await settle(page)
    const b = await frame(page)
    check('a second key that was pressed 50 ms after A but arrives late types both, in order', line === 'ad', line)
    check('and neither key leaves the view moving', drift(a, b) < 0.01, { a, b })
    await context.close()
  }
}

// ── Pointer ──────────────────────────────────────────────────────────────────
{
  const { context, page } = await open('talk=npc&q=low')
  const cx = 720, cy = 330
  let a = await frame(page)
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 25, cy, { steps: 2 })
  await page.mouse.up()
  await settle(page)
  let b = await frame(page)
  const chosen = await page.evaluate(() => window.village.kernel.root.get('entries').active)
  check('left drag turns the view (and chooses nothing)', Math.abs(b.yaw - a.yaw) > 0.8 && chosen === null, { a: a.yaw, b: b.yaw, chosen })
  a = b
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'right' })
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx - i * 20, cy + i * 8, { steps: 2 })
  await page.mouse.up({ button: 'right' })
  await settle(page)
  b = await frame(page)
  check('right drag pans the view', Math.hypot(b.x - a.x, b.z - a.z) > 1 && Math.abs(b.yaw - a.yaw) < 0.01, { a, b })
  a = b
  await page.mouse.move(cx, cy)
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120)
  await settle(page)
  b = await frame(page)
  check('the wheel zooms in', b.zoom - a.zoom > 0.5, { a: a.zoom, b: b.zoom })
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 2000)
  await settle(page)
  const out = await frame(page)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -2000)
  await settle(page)
  const inn = await frame(page)
  check('zoom stays between the whole house (0) and close up (1)', out.zoom >= 0 && out.zoom < 0.01 && inn.zoom <= 1 && inn.zoom > 0.99, { out: out.zoom, in: inn.zoom })

  // Double-click the living room's floor: the view glides there.
  await page.evaluate(() => window.village.kernel.root.get('view').glide({ x: 2.5, z: 1, zoom: 0, yaw: 0.42 }, 0))
  await settle(page, 500)
  const target = { x: 6.6, z: 1.6 }
  const p = await onScreen(page, target.x, target.z)
  await page.mouse.dblclick(p.x, p.y)
  await page.waitForTimeout(300)
  const mid = await frame(page)
  await settle(page, 1200)
  const there = await frame(page)
  check('double-clicking the floor glides there and comes closer', Math.hypot(there.x - target.x, there.z - target.z) < 0.25 && there.zoom >= 0.5 && mid.x > 2.6 && mid.x < there.x, { mid, there })
  if (shots) await page.screenshot({ path: `${shots}/after-double-click.png` })

  // Clamping: hold an arrow for a long time each way; the view stops at the yard's edge.
  const far = []
  for (const key of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']) {
    await hold(page, key, 3500)
    far.push(await frame(page))
  }
  check('panning stops at the house and yard', far.every((f) => f.x >= BOUNDS.x0 - 0.01 && f.x <= BOUNDS.x1 + 0.01 && f.z >= BOUNDS.z0 - 0.01 && f.z <= BOUNDS.z1 + 0.01) && far.some((f) => Math.abs(f.x - BOUNDS.x1) < 0.05 || Math.abs(f.z - BOUNDS.z0) < 0.05), far)
  await context.close()
}

// ── Reduced motion: every move is instant ────────────────────────────────────
{
  const { context, page } = await open('talk=npc&q=low', 'reduce')
  const p = await onScreen(page, 6.6, 1.6)
  await page.mouse.dblclick(p.x, p.y)
  await page.waitForTimeout(80)
  const glide = await frame(page)
  await page.mouse.move(720, 330)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(80)
  const z1 = await frame(page)
  await page.evaluate(() => void window.village.kernel.root.get('rooms').go('kitchen'))
  await page.waitForTimeout(80)
  const room = await page.evaluate(() => ({ move: window.village.kernel.root.get('rooms').lastMove, current: window.village.kernel.root.get('rooms').current }))
  check('reduced motion: double-click, zoom and room moves land at once', Math.hypot(glide.x - 6.6, glide.z - 1.6) < 0.05 && z1.zoom < glide.zoom - 0.2 && room.move.glide < 100 && room.current === 'kitchen', { glide, zoom: [glide.zoom, z1.zoom], room })
  await context.close()
}

// ── Flicker: the camera still on the doorway and on the window, moving things hidden ──
{
  const { context, page } = await open('talk=npc&input=held&q=high', 'no-preference', 2)
  const poses = {
    doorway: { p: [1.2, 2.0, 4.6], l: [3.45, 1.1, 2.8], object: 'kitchen doorway' },
    window: { p: [0.6, 2.6, 1.2], l: [-0.85, 1.6, -2.2], object: 'window' },
  }
  for (const [name, pose] of Object.entries(poses)) {
    // Hold the camera on a focus pose (no drift, no bob), and hide what moves on its own:
    // villagers, motes, the always-on input's notepad, and the dust of the sunbeam.
    const crop = await page.evaluate(async ({ pose }) => {
      const root = window.village.kernel.root
      const { scene, camera, renderer } = root.get('stage')
      const V = camera.position.constructor
      root.get('view').focus({ position: new V(...pose.p), look: new V(...pose.l) }, 60)
      scene.traverse((o) => { if (/villager|motes|talk|felt|babble/i.test(o.name) && o !== scene) o.visible = false })
      for (const el of document.querySelectorAll('.talk-input-field, .talk-hud, .talk-mine')) el.style.visibility = 'hidden'
      await new Promise((r) => setTimeout(r, 2500))
      const THREE = await import(performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/deps/three_webgpu.js')))
      const box = new THREE.Box3().setFromObject(scene.getObjectByName(pose.object))
      const rect = renderer.domElement.getBoundingClientRect()
      const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new V(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera))
      const xs = pts.map((q) => rect.left + ((q.x + 1) / 2) * rect.width), ys = pts.map((q) => rect.top + ((1 - q.y) / 2) * rect.height)
      const clampX = (v) => Math.max(0, Math.min(innerWidth, v)), clampY = (v) => Math.max(0, Math.min(innerHeight * 0.74, v))
      return { x: clampX(Math.min(...xs)), y: clampY(Math.min(...ys)), width: clampX(Math.max(...xs)) - clampX(Math.min(...xs)), height: clampY(Math.max(...ys)) - clampY(Math.min(...ys)) }
    }, { pose })
    const frames = []
    for (let i = 0; i < 8; i++) {
      frames.push((await page.screenshot({ clip: crop })).toString('base64'))
      await page.waitForTimeout(60)
    }
    const share = await page.evaluate(async (b64s) => {
      const imgs = await Promise.all(b64s.map((b) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b })))
      const w = imgs[0].width, h = imgs[0].height
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const g = c.getContext('2d', { willReadFrequently: true })
      const data = imgs.map((i) => { g.drawImage(i, 0, 0); return g.getImageData(0, 0, w, h).data })
      let changed = 0
      for (let p = 0; p < w * h; p++) {
        let max = 0
        for (let k = 1; k < data.length; k++) for (let ch = 0; ch < 3; ch++) max = Math.max(max, Math.abs(data[k][p * 4 + ch] - data[k - 1][p * 4 + ch]))
        if (max > 20) changed++
      }
      return (changed / (w * h)) * 100
    }, frames)
    if (shots) writeFileSync(`${shots}/still-${name}.png`, Buffer.from(frames[0], 'base64'))
    check(`flicker: the ${name} trim holds still (${share.toFixed(2)}% of pixels change by >20 levels over 8 frames, bar ${FLICKER_MAX}%)`, share < FLICKER_MAX, { crop, share })
    await page.evaluate(() => window.village.kernel.root.get('view').focus(null))
  }
  await context.close()
}

await browser.close()
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
