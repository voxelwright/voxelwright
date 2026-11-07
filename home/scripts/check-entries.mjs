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
// TRAA keeps a renderer-internal geometry that comes and goes between visits (measured:
// 213 or 214, then back) without being a scene object. A room left behind is dozens of geometries.
const SLACK = 1
const DOORS = { 'to-living': 'living', 'to-kitchen': 'kitchen' }

// The villager host is not running here, so its launch request answers 503 on
// purpose. That exact console error is the only one a section may show.
const hostDown = (m) => m.text() === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' && new URL(m.location().url).pathname === '/villager/launch'
const opened = []
async function open(query = '', reducedMotion = 'no-preference', { init, settle = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !hostDown(m) && errors.push(`${m.text()} @ ${m.location().url}`))
  const warnings = []
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()))
  if (init) await page.addInitScript(init)
  await page.goto(`${base}?${query}`)
  opened.push({ query, errors })
  if (!settle) return { context, page, errors, warnings }
  const ready = await page.evaluate(() => window.village.ready())
  // Quality calibration may step the tier down and rebuild postfx; wait until it has settled.
  await page.waitForFunction(() => window.village.snapshot().tierSettled, null, { timeout: 30000 })
  await page.waitForTimeout(800)
  return { context, page, ready, errors, warnings }
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
  for (let i = 0; i < list.length + 2; i++) {
    await page.keyboard.press('Tab')
    visited.push((await state(page)).focus)
  }
  const expected = [...list].sort((a, b) => a.x - b.x).map((e) => e.id)
  // Past the last entry Tab leaves the canvas (no keyboard trap); the next Tab comes back to the first.
  check(`${room}: Tab visits ${expected.join(', ')} left to right, then leaves the entries, then returns`, visited.slice(0, expected.length).join() === expected.join() && visited[expected.length] === null && visited.at(-1) === expected[0], { visited, expected })
  // Headless Chrome has no browser UI to move to, so it wraps focus inside the page; what
  // matters is that the page lets the browser handle Tab at both ends.
  const passedOn = (id, key) => page.evaluate(async ([id, key]) => {
    document.querySelector(`[data-entry="${id}"]`).focus()
    let prevented = null
    addEventListener('keydown', (e) => (prevented = e.defaultPrevented), { once: true })
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: key === 'Shift+Tab', bubbles: true, cancelable: true }))
    return prevented === false
  }, [id, key])
  const ends = { lastTab: await passedOn(expected.at(-1), 'Tab'), firstShiftTab: await passedOn(expected[0], 'Shift+Tab'), middleTab: !(await passedOn(expected[0], 'Tab')) }
  check(`${room}: Tab on the last entry and Shift+Tab on the first are left to the browser; Tab inside stays spatial`, ends.lastTab && ends.firstShiftTab && ends.middleTab, ends)
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
      again.objects === fresh.objects && again.plugins === fresh.plugins && again.frameHooks === fresh.frameHooks && (keepMode || Math.abs(again.geometries - fresh.geometries) <= SLACK) && again.dom === fresh.dom && again.entries === fresh.entries,
      Object.fromEntries(Object.keys(fresh).filter((k) => fresh[k] !== again[k]).map((k) => [k, k === 'objects' ? 'differ' : [fresh[k], again[k]]])))
  }
  // With rooms kept loaded, GPU memory gains the other room once it is first seen; it must not keep growing.
  check('GPU textures and geometries do not grow across room cycles', textures[1][0] <= textures[0][0] && textures[1][1] <= textures[0][1] + SLACK, { first: [fresh.textures, fresh.geometries], textures })
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

// Room hiding follows ownership: an object a plugin adds after its room loaded is
// hidden while another room is current (neighbouring rooms kept loaded).
{
  const { context, page } = await open('', 'reduce')
  const visibleAfterReload = (name, object) => page.evaluate(async ([name, object]) => {
    await window.village.unload(name)
    window.village.load(name)
    await new Promise((r) => setTimeout(r, 600))
    const o = window.village.kernel.root.get('stage').scene.getObjectByName(object)
    return o ? o.visible : 'missing'
  }, [name, object])
  const sideboard = await visibleAfterReload('sideboard', 'sideboard')
  check('kept rooms: a living-room object added later stays hidden in the kitchen', sideboard === false, { sideboard })
  await page.evaluate(() => document.querySelector('[data-entry="to-living"]').focus())
  await page.keyboard.press('Enter')
  await waitStill(page)
  const table = await visibleAfterReload('table', 'table')
  const lounge = await page.evaluate(() => window.village.kernel.root.get('stage').scene.getObjectByName('lounge')?.visible)
  check('kept rooms: a kitchen object added later stays hidden in the living room, the living room shows', table === false && lounge === true, { table, lounge })
  await context.close()
}

// A room plugin waiting forever for a missing service does not hold the walk:
// the room opens without it and the page names it.
{
  const { context, page, warnings } = await open('rooms=unload', 'reduce')
  await page.evaluate(() => window.village.kernel.load({ name: 'plantstand', inject: ['no-such-service'], apply() {} }))
  const t0 = Date.now()
  await page.evaluate(() => document.querySelector('[data-entry="to-living"]').focus())
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.village.kernel.root.get('rooms').moving, null, { timeout: 30000, polling: 100 })
  const ms = Date.now() - t0
  const after = await page.evaluate(() => ({ room: window.village.kernel.root.get('rooms').current, lounge: window.village.snapshot().plugins.active.includes('lounge') }))
  check('a plugin waiting forever does not hold the walk (living room within 3 s) and is named', ms < 3000 && after.room === 'living' && after.lounge && warnings.some((w) => w.includes('plantstand')), { ms, after, warnings })
  await context.close()
}

// Unloading the rooms service while a room is still loading cancels it: no room
// plugin comes back afterwards. A kitchen plugin that takes 2 s holds the first load.
{
  const init = () => {
    Object.defineProperty(window, 'village', {
      configurable: true,
      set(v) {
        Object.defineProperty(window, 'village', { value: v, configurable: true, writable: true })
        v.kernel.load({ name: 'toyshelf', inject: ['stage'], apply: () => new Promise((r) => setTimeout(r, 2000)) })
      },
    })
  }
  const { context, page } = await open('', 'reduce', { init, settle: false })
  await page.waitForFunction(() => window.village?.snapshot().plugins.active.includes('rooms'), null, { timeout: 30000, polling: 50 })
  await page.evaluate(() => window.village.unload('rooms'))
  // Past the old 15 s settle deadline, after which a stale load used to resume.
  await page.waitForTimeout(16500)
  const left = await page.evaluate(() => window.village.snapshot().plugins.registered)
  const rooms = ['lounge', 'sideboard', 'growshelves', 'plantstand', 'loungedoors', 'room', 'table', 'fridge', 'notebook']
  check('unloading rooms mid-load leaves no room plugin loaded afterwards', !left.some((n) => rooms.includes(n)), left)
  await context.close()
}

for (const [i, { query, errors }] of opened.entries()) check(`no page errors on page ${i + 1} (?${query})`, errors.length === 0, errors)
await browser.close()
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
