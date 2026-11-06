// Headless proof of the home as a menu (#37): every entry is reachable by
// keyboard and by pointer, rooms change through doorways, and leaving a room
// leaves nothing of it behind.
// Usage: node scripts/check-entries.mjs [base-url] [--shots=dir]   (dev server running)
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const shots = args.find((a) => a.startsWith('--shots='))?.slice(8)
// The room walks run with ?rooms=unload to prove leaving a room leaves nothing
// behind; --keep runs them with the default, neighbouring rooms kept loaded.
const keepMode = args.includes('--keep')
const keep = keepMode ? '' : 'rooms=unload'
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
  await page.goto(`${base}?${query}`)
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
// the wall in front of a doorway's reveal; search outwards for a point on the object.
const hoverOn = async (page, e) => {
  let hover = null
  const near = [[0, 0]]
  for (let r = 30; r <= 120; r += 30) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]]) near.push([dx * r, dy * r])
  for (const [dx, dy] of near) {
    await page.mouse.move(e.x + dx, e.y + dy)
    await page.waitForTimeout(dx || dy ? 120 : 250)
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

// Keyboard: in each room, Tab visits every on-screen entry in screen order and
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

// Pointer: hover each entry for its label, click to choose, click empty floor to back out.
for (const room of ['kitchen', 'living']) {
  const { context, page } = await open(`room=${room}`, 'reduce')
  for (const e of (await entries(page)).filter((e) => !DOORS[e.id])) {
    const hover = await hoverOn(page, e)
    if (shots && e.id === 'fridge') await page.screenshot({ path: `${shots}/hover-fridge.png` })
    if (shots && e.id === 'idea-garden') await page.screenshot({ path: `${shots}/hover-idea-garden.png` })
    await page.mouse.click(e.x, e.y)
    await page.waitForTimeout(150)
    const chosen = await state(page)
    if (shots && e.id === 'fridge') await page.screenshot({ path: `${shots}/fridge-chosen.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const left = await state(page)
    check(`${room}: pointer hovers, labels and chooses ${e.id}`, hover.hovered === e.id && hover.label === e.label && chosen.active === e.id && left.active === null, { hover, chosen, left })
  }
  await context.close()
}

// Occlusion: furniture in front of an entry blocks it. Find a point where the
// high chair is the nearest thing hit and the kitchen doorway lies behind it;
// hovering there shows no label and clicking there stays in the kitchen.
{
  const { context, page } = await open('', 'reduce')
  const spot = await page.evaluate(async () => {
    // The same three.js module the page runs, so its Raycaster works on the scene.
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/deps/three_webgpu.js'))
    const THREE = await import(url)
    const { scene, camera, renderer } = window.village.kernel.root.get('stage')
    const chair = scene.getObjectByName('highchair')
    const door = scene.getObjectByName('kitchen doorway')
    const rect = renderer.domElement.getBoundingClientRect()
    const rc = new THREE.Raycaster()
    const box = new THREE.Box3().setFromObject(chair)
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera))
    const [x0, x1] = [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x))]
    const [y0, y1] = [Math.min(...corners.map((c) => c.y)), Math.max(...corners.map((c) => c.y))]
    for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
      const ndc = new THREE.Vector2(x0 + ((x1 - x0) * i) / 24, y0 + ((y1 - y0) * j) / 24)
      rc.setFromCamera(ndc, camera)
      const behind = rc.intersectObject(door, true)[0]
      const first = rc.intersectObject(scene, true).find((h) => h.object.isMesh && h.object.material.depthWrite !== false)
      let o = first?.object
      while (o && o !== chair) o = o.parent
      if (behind && o === chair && first.distance < behind.distance) return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height }
    }
    return null
  })
  check('occlusion: a point exists where the high chair stands in front of the kitchen doorway', spot, spot)
  if (spot) {
    await page.mouse.move(spot.x, spot.y)
    await page.waitForTimeout(250)
    const hover = await state(page)
    await page.mouse.click(spot.x, spot.y)
    await page.waitForTimeout(400)
    const after = await state(page)
    check('occlusion: the high chair blocks the doorway behind it (no label, the click stays in the kitchen)', hover.hovered === null && after.room === 'kitchen' && !after.moving, { spot, hover, after })
  }
  await context.close()
}

// Rooms: walk kitchen -> living -> kitchen twice through the doorways by pointer
// and keyboard; nothing of a room remains after leaving it.
{
  const { context, page } = await open(keep)
  const fresh = await residue(page)
  const fps = () => page.evaluate(() => new Promise((resolve) => {
    const deltas = []
    let last = performance.now()
    const step = (now) => {
      deltas.push(now - last)
      last = now
      if (window.village.kernel.root.get('rooms').moving) requestAnimationFrame(step)
      else resolve({ worstMs: +Math.max(...deltas).toFixed(1), over20ms: deltas.filter((d) => d > 20).length, frames: deltas.length })
    }
    requestAnimationFrame(step)
  }))
  const moves = []
  const textures = []
  for (let cycle = 0; cycle < 2; cycle++) {
    const door = (await entries(page)).find((e) => e.id === 'to-living')
    await hoverOn(page, door)
    await page.mouse.click(door.x, door.y)
    await page.waitForTimeout(50)
    const frames = fps()
    if (shots && cycle === 0) {
      await page.waitForTimeout(420)
      await page.screenshot({ path: `${shots}/mid-transition.png` })
    }
    await waitStill(page)
    const living = await page.evaluate(() => ({ s: window.village.snapshot(), move: window.village.kernel.root.get('rooms').lastMove }))
    moves.push({ to: 'living', ...living.move, ...(await frames) })
    check(`cycle ${cycle + 1}: pointer on the doorway walks to the living room`, living.s.room === 'living' && (keepMode || !living.s.plugins.active.includes('fridge')) && living.s.plugins.active.includes('growshelves'), living.s.plugins.active)
    if (cycle === 0) {
      const { context: c2, page: p2 } = await open(`room=living&${keep}`)
      const direct = await residue(p2)
      await c2.close()
      const here = await residue(page)
      check('living room after a walk matches a fresh living-room page (objects, plugins, frame hooks, entries)', here.objects === direct.objects && here.plugins === direct.plugins && here.frameHooks === direct.frameHooks && here.entries === direct.entries, { here: { ...here, objects: here.objects.length }, direct: { ...direct, objects: direct.objects.length } })
    }
    // Back to the kitchen by keyboard.
    await page.evaluate(() => document.querySelector('[data-entry="to-kitchen"]').focus())
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const back = fps()
    await waitStill(page)
    moves.push({ to: 'kitchen', ...(await page.evaluate(() => window.village.kernel.root.get('rooms').lastMove)), ...(await back) })
    const again = await residue(page)
    textures.push([again.textures, again.geometries])
    check(`cycle ${cycle + 1}: back in the kitchen, objects, plugins, frame hooks, geometries, DOM and entries match the first visit`,
      again.objects === fresh.objects && again.plugins === fresh.plugins && again.frameHooks === fresh.frameHooks && (keepMode || again.geometries === fresh.geometries) && again.dom === fresh.dom && again.entries === fresh.entries,
      Object.fromEntries(Object.keys(fresh).filter((k) => fresh[k] !== again[k]).map((k) => [k, k === 'objects' ? 'differ' : [fresh[k], again[k]]])))
  }
  // With rooms kept loaded, GPU memory gains the other room once it is first seen; it must not keep growing.
  check('GPU textures and geometries do not grow across room cycles', textures[1][0] <= textures[0][0] && textures[1][1] <= textures[0][1], { first: [fresh.textures, fresh.geometries], textures })
  console.log(JSON.stringify({ moves }))
  await context.close()
}

// Reduced motion: the walk happens without camera easing.
{
  const { context, page } = await open('', 'reduce')
  await page.evaluate(() => document.querySelector('[data-entry="to-living"]').focus())
  await page.keyboard.press('Enter')
  await waitStill(page)
  const move = await page.evaluate(() => window.village.kernel.root.get('rooms').lastMove)
  check('reduced motion: the walk to the living room skips the eased camera (walks under 300 ms)', (await state(page)).room === 'living' && move.walkOut < 300 && move.walkIn < 300, move)
  await context.close()
}

await browser.close()
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
