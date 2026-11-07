// Headless proof of the home as a menu (#37, one house #42): every entry is
// reachable by keyboard and by pointer in each room, the doorway's two entries
// glide the view through the house with no fade, and going back and forth adds
// nothing (objects, plugins, frame hooks, geometries, textures, DOM, entries).
// Runs in the dollhouse (?cam=iso), and walks the seated view through the doorway from its own signs.
// Usage: node scripts/check-entries.mjs [base-url] [--shots=dir] [--build]   (dev server running)
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const shots = args.find((a) => a.startsWith('--shots='))?.slice(8)
// --build runs it on the house build mode generates from the plan (#53).
const extra = args.includes('--build') ? '&build=1' : ''
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const DOORS = { 'to-living': 'living', 'to-kitchen': 'kitchen' }

async function open(query = '', reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // With no villager host running, /villager/launch answers 503 by design (#40); the page copes.
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && !m.location().url.includes('/villager/') && errors.push(m.text()))
  await page.goto(`${base}?cam=iso&${query}${extra}`)
  const ready = await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(800)
  return { context, page, ready, errors }
}
const state = (page) => page.evaluate(() => {
  const root = window.village.kernel.root
  const e = root.get('entries')
  const rooms = root.get('rooms')
  return { active: e.active, hovered: e.hovered, focus: document.activeElement?.dataset?.entry ?? null, room: rooms.current, moving: rooms.moving, label: document.querySelector('.village-label.shown')?.textContent ?? null }
})
const entries = (page) => page.evaluate(() => window.village.snapshot().entries.filter((e) => e.onScreen))
const waitStill = async (page) => {
  await page.waitForFunction(() => !window.village.kernel.root.get('rooms').moving, null, { timeout: 15000 })
  await page.waitForTimeout(300)
}
// The projected centre of a box can fall between parts (between shelves) or on
// the wall beside a doorway; search outwards for a point on the object.
const hoverOn = async (page, e) => {
  let hover = null
  const near = [[0, 0]]
  for (let r = 15; r <= 120; r += 15) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]]) near.push([dx * r, dy * r])
  for (const [dx, dy] of near) {
    await page.mouse.move(e.x + dx, e.y + dy)
    await page.waitForTimeout(dx || dy ? 100 : 250)
    hover = await state(page)
    if (hover.hovered === e.id) {
      e.x += dx
      e.y += dy
      break
    }
  }
  return hover
}
const residue = (page) => page.evaluate(() => {
  const s = window.village.snapshot()
  return { objects: s.objects.join('|'), plugins: s.plugins.active.join(','), frameHooks: s.frameHooks, geometries: s.geometries, textures: s.textures, dom: s.dom, entries: s.entries.map((e) => e.id).sort().join(',') }
})
/** Watch the view through a move: the frame each animation frame, and anything covering the canvas. */
const watch = (page) => page.evaluate(() => new Promise((resolve) => {
  const view = window.village.kernel.root.get('view')
  const rooms = window.village.kernel.root.get('rooms')
  const { camera } = window.village.kernel.root.get('stage')
  const xs = []
  const fx = []
  const deltas = []
  let covered = 0
  let last = performance.now()
  const step = (now) => {
    deltas.push(now - last)
    last = now
    xs.push(+camera.position.x.toFixed(3))
    fx.push(+view.frame.x.toFixed(3))
    // A fade would put an element over the canvas centre.
    const top = document.elementFromPoint(innerWidth / 2, innerHeight * 0.4)
    if (top && top.tagName !== 'CANVAS' && getComputedStyle(top).opacity !== '0' && top.className?.includes?.('veil')) covered++
    if (rooms.moving || xs.length < 3) requestAnimationFrame(step)
    else resolve({ frames: xs.length, xs, fx, worstMs: +Math.max(...deltas).toFixed(1), covered, veil: document.querySelector('.village-veil') !== null, frame: view.frame })
  }
  requestAnimationFrame(step)
}))
/** Gap-free travel: no frame jumps more than `jump` metres. */
const smooth = (xs, jump) => xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1]) < jump)

// Keyboard: framed on each room, Tab visits every on-screen entry in screen order and
// wraps; Enter chooses; Escape backs out and returns focus.
for (const room of ['kitchen', 'living']) {
  const { context, page, ready, errors } = await open(`room=${room}`)
  check(`${room}: page ready`, ready.ok, ready)
  const list = await entries(page)
  const visited = []
  for (let i = 0; i < list.length + 1; i++) {
    await page.keyboard.press('Tab')
    visited.push((await state(page)).focus)
  }
  const expected = [...list].sort((a, b) => a.x - b.x).map((e) => e.id)
  check(`${room}: Tab visits ${expected.join(', ')} left to right and wraps`, visited.slice(0, -1).join() === expected.join() && visited.at(-1) === expected[0], { visited, expected })
  for (const id of expected.filter((id) => !DOORS[id])) {
    await page.evaluate((id) => document.querySelector(`[data-entry="${id}"]`).focus(), id)
    const focused = await state(page)
    check(`${room}: focus on ${id} shows its label`, focused.hovered === id && focused.label !== null, focused)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    const chosen = await state(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const left = await state(page)
    check(`${room}: Enter chooses ${id}, Escape backs out to it`, chosen.active === id && left.active === null && left.focus === id, { chosen, left })
  }
  check(`${room}: no page errors`, errors.length === 0, errors)
  await context.close()
}

// Pointer: hover each entry for its label, click to choose, Escape to back out.
for (const room of ['kitchen', 'living']) {
  const { context, page } = await open(`room=${room}`, 'reduce')
  for (const e of (await entries(page)).filter((e) => !DOORS[e.id])) {
    const hover = await hoverOn(page, e)
    await page.mouse.click(e.x, e.y)
    await page.waitForTimeout(150)
    const chosen = await state(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const left = await state(page)
    check(`${room}: pointer hovers, labels and chooses ${e.id}`, hover.hovered === e.id && hover.label === e.label && chosen.active === e.id && left.active === null, { hover, chosen, left })
  }
  await context.close()
}

// Occlusion: something solid in front of an entry blocks it. Find a point where a
// non-entry mesh is the nearest thing hit and the kitchen doorway lies behind it;
// hovering there shows no label and clicking there starts no glide.
{
  const { context, page } = await open('', 'reduce')
  const spot = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/deps/three_webgpu.js'))
    const THREE = await import(url)
    const { scene, camera, renderer } = window.village.kernel.root.get('stage')
    const door = scene.getObjectByName('kitchen doorway')
    const rect = renderer.domElement.getBoundingClientRect()
    const rc = new THREE.Raycaster()
    const view = window.village.kernel.root.get('view')
    const frames = [{ x: 2.5, z: 1, zoom: 0, yaw: 0.42 }, { x: 2.5, z: 1, zoom: 0.2, yaw: -0.9 }, { x: 3, z: 2.5, zoom: 0.3, yaw: 1.4 }, { x: 5, z: 2, zoom: 0.35, yaw: -1.2 }]
    for (const f of frames) {
    await view.glide(f, 0)
    await new Promise((r) => setTimeout(r, 400))
    const seen = (o) => o.isMesh && !o.userData.pick && o.material.visible !== false && o.material.depthWrite !== false && o.layers.test(camera.layers)
    for (let i = 1; i < 60; i++) for (let j = 1; j < 40; j++) {
      const ndc = new THREE.Vector2(-1 + (2 * i) / 60, -1 + (2 * j) / 40)
      rc.setFromCamera(ndc, camera)
      const behind = rc.intersectObject(door, true)[0]
      if (!behind) continue
      const first = rc.intersectObject(scene, true).find((h) => seen(h.object))
      let o = first?.object
      while (o && o !== door) o = o.parent
      if (first && !o && first.distance < behind.distance - 0.3) return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height, blocker: first.object.name || first.object.parent?.name || 'a mesh', frame: f }
    }
    }
    return null
  })
  check('occlusion: a point exists where something stands in front of the kitchen doorway', spot, spot)
  if (spot) {
    await page.mouse.move(spot.x, spot.y)
    await page.waitForTimeout(250)
    const hover = await state(page)
    await page.mouse.click(spot.x, spot.y)
    await page.waitForTimeout(400)
    const after = await state(page)
    check(`occlusion: ${spot.blocker} blocks the doorway behind it (no doorway label, no glide)`, !DOORS[hover.hovered] && !after.moving && (await page.evaluate(() => window.village.kernel.root.get('rooms').lastMove)) === null, { spot, hover, after })
  }
  await context.close()
}

// Glides: kitchen -> living by pointer on the doorway, back by keyboard, twice. No fade,
// the camera travels smoothly, and the house is unchanged after each round trip.
{
  const { context, page } = await open('room=kitchen')
  const fresh = await residue(page)
  const moves = []
  const memory = []
  for (let cycle = 0; cycle < 2; cycle++) {
    const door = (await entries(page)).find((e) => e.id === 'to-living')
    const hover = await hoverOn(page, door)
    await page.mouse.click(door.x, door.y)
    await page.waitForTimeout(30)
    const there = watch(page)
    if (shots && cycle === 0) {
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${shots}/mid-glide.png` })
    }
    const w = await there
    await waitStill(page)
    const s = await state(page)
    moves.push({ to: 'living', frames: w.frames, worstMs: w.worstMs, glideMs: (await page.evaluate(() => window.village.kernel.root.get('rooms').lastMove)).glide })
    check(`cycle ${cycle + 1}: the doorway (pointer) glides to the living room with no fade`, hover.hovered === 'to-living' && s.room === 'living' && !w.veil && w.covered === 0 && w.frames > 20 && smooth(w.fx, 0.4) && smooth(w.xs, 0.8) && w.fx.at(-1) > w.fx[0] + 3, { hover: hover.hovered, room: s.room, veil: w.veil, covered: w.covered, frames: w.frames, from: w.fx[0], to: w.fx.at(-1) })
    await page.evaluate(() => document.querySelector('[data-entry="to-kitchen"]').focus())
    await page.keyboard.press('Enter')
    await page.waitForTimeout(30)
    const back = await watch(page)
    await waitStill(page)
    const s2 = await state(page)
    moves.push({ to: 'kitchen', frames: back.frames, worstMs: back.worstMs })
    check(`cycle ${cycle + 1}: the doorway (keyboard) glides back to the kitchen with no fade`, s2.room === 'kitchen' && back.covered === 0 && back.frames > 20 && smooth(back.fx, 0.4) && smooth(back.xs, 0.8) && back.fx.at(-1) < back.fx[0] - 3, { room: s2.room, frames: back.frames, from: back.fx[0], to: back.fx.at(-1) })
    const again = await residue(page)
    memory.push([again.textures, again.geometries])
    check(`cycle ${cycle + 1}: back in the kitchen, objects, plugins, frame hooks, DOM and entries match the start`,
      again.objects === fresh.objects && again.plugins === fresh.plugins && again.frameHooks === fresh.frameHooks && again.dom === fresh.dom && again.entries === fresh.entries,
      Object.fromEntries(Object.keys(fresh).filter((k) => fresh[k] !== again[k]).map((k) => [k, k === 'objects' ? 'differ' : [fresh[k], again[k]]])))
  }
  // GPU memory may gain what is first drawn close up on the first trip; it must not grow after that.
  check('no geometry or texture growth across glides (second round trip adds nothing)', memory[1][0] === memory[0][0] && memory[1][1] === memory[0][1], { start: [fresh.textures, fresh.geometries], memory })
  check('both rooms are loaded and drawn the whole time (no swap)', fresh.plugins.includes('growshelves') && fresh.plugins.includes('fridge'), fresh.plugins)
  console.log(JSON.stringify({ moves, memory }))
  await context.close()
}

// The seated view walks through the real doorway. The seat faces the back wall and the
// doorway is beside it, off screen, so a sign on the back wall is the doorway's entry
// there: from the default seat, the pointer chooses "Living room" and the camera
// crosses the shared wall; from the living room's seat, Tab and Enter on "Kitchen" walk back.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}?${extra.slice(1)}`)
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(800)
  const seen = await entries(page)
  const sign = seen.find((e) => e.id === 'sign-living')
  check('seated view: the "Living room" sign is on screen from the default seat', sign && sign.label === 'Living room', seen.map((e) => e.id))
  if (sign) {
    const hover = await hoverOn(page, sign)
    await page.mouse.click(sign.x, sign.y)
    await page.waitForTimeout(30)
    const w = await watch(page)
    await waitStill(page)
    const s = await state(page)
    check('seated view: pointing at the sign labels it, and clicking walks through the doorway into the living room, smoothly, with no fade',
      hover.hovered === 'sign-living' && hover.label === 'Living room' && s.room === 'living' && w.covered === 0 && !w.veil && smooth(w.xs, 0.4) && w.xs[0] < 3.4 && w.xs.at(-1) > 3.58,
      { hover: [hover.hovered, hover.label], room: s.room, from: w.xs[0], to: w.xs.at(-1), frames: w.frames })
    const list = await entries(page)
    const visited = []
    for (let i = 0; i < list.length && visited.at(-1) !== 'sign-kitchen'; i++) {
      await page.keyboard.press('Tab')
      visited.push((await state(page)).focus)
    }
    await page.keyboard.press('Enter')
    await page.waitForTimeout(30)
    const back = await watch(page)
    await waitStill(page)
    const s2 = await state(page)
    check('seated view: Tab reaches the "Kitchen" sign in the living room, and Enter walks back through the doorway', visited.includes('sign-kitchen') && s2.room === 'kitchen' && back.covered === 0 && smooth(back.xs, 0.4) && back.xs[0] > 3.58 && back.xs.at(-1) < 3.4,
      { visited, room: s2.room, from: back.xs[0], to: back.xs.at(-1) })
  }
  check('seated view: no page errors', errors.length === 0, errors)
  await context.close()
}

// Reduced motion: the glide is instant.
{
  const { context, page } = await open('room=kitchen', 'reduce')
  await page.evaluate(() => document.querySelector('[data-entry="to-living"]').focus())
  await page.keyboard.press('Enter')
  await waitStill(page)
  const move = await page.evaluate(() => window.village.kernel.root.get('rooms').lastMove)
  check('reduced motion: the glide to the living room is instant (under 300 ms)', (await state(page)).room === 'living' && move.glide < 300, move)
  await context.close()
}

await browser.close()
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
