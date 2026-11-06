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
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()))
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
    // The projected centre can fall between parts (between shelves); search nearby for the object.
    let hover = null
    for (const [dx, dy] of [[0, 0], [0, -30], [0, 30], [-30, 0], [30, 0], [0, -60], [0, 60], [-60, -30], [60, 30]]) {
      await page.mouse.move(e.x + dx, e.y + dy)
      await page.waitForTimeout(250)
      hover = await state(page)
      if (hover.hovered === e.id) {
        e.x += dx
        e.y += dy
        break
      }
    }
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
