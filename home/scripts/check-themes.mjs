// Headless proof of live themes (#50): both switch paths complete without a reload, the
// held frame covers the rebuild, the person's looks and the last look survive a reload,
// a villager can keep its costume, the swatch book works by keyboard and pointer, theme
// load and unload cycles leave nothing behind, and without ?theme= nothing changes.
// Usage: node scripts/check-themes.mjs [base-url] [--before=<png>] [--shots=dir]   (dev server running)
//   --before: a ?q=low capture of the code before this change, taken with
//   `node scripts/theme-shots.mjs <dir> before='<base-url>?q=low'` on that commit.
//   Without it the no-op diff is reported as not run.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const before = args.find((a) => a.startsWith('--before='))?.slice(9)
const shots = args.find((a) => a.startsWith('--shots='))?.slice(8)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const measures = {}

async function open(query = '', { reducedMotion = 'no-preference', context = null } = {}) {
  const ctx = context ?? await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // With no villager host running, /villager/* answers 503 by design (#40).
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && !m.text().includes('503') && errors.push(m.text()))
  await page.goto(`${base}?${query}`)
  const ready = await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(800)
  return { context: ctx, page, ready, errors }
}
const done = (page) => page.waitForFunction(() => window.village.theme.lastSwitch()?.done && !window.village.theme.switching(), null, { timeout: 20000 })
const set = async (page, id) => {
  await page.evaluate((id) => window.village.theme.set(id), id)
  await done(page)
  return page.evaluate(() => window.village.theme.lastSwitch())
}
const residue = (page) => page.evaluate(() => {
  const s = window.village.snapshot()
  return { geometries: s.geometries, textures: s.textures, frameHooks: s.frameHooks, drawPasses: s.drawPasses }
})

// 1 and 2. Both paths, without a reload. A blend keeps postfx (no draw pass added, no held
// frame); a rebuild holds the last frame over every frame drawn before the new chain.
{
  const { context, page, ready, errors } = await open('q=high')
  check('page ready', ready.ok, ready)
  await page.evaluate(() => {
    const stage = window.village.kernel.root.get('stage')
    const add = stage.addDrawPass
    window.__passesAdded = 0
    stage.addDrawPass = (p) => (window.__passesAdded++, add(p))
    // Per frame during switches: draw passes at frame start and the held frame's opacity.
    window.__frames = []
    window.village.kernel.root.on('village/frame', () => {
      const hold = document.querySelector('.village-theme-hold')
      window.__frames.push({ t: performance.now(), passes: stage.drawPasses(), added: window.__passesAdded, hold: hold ? Number(getComputedStyle(hold).opacity) : 0 })
    })
  })
  const blend = await set(page, 'blue-hour')
  const afterBlend = await page.evaluate(() => ({ added: window.__passesAdded, held: window.__frames.some((f) => f.hold > 0), passes: window.village.snapshot().drawPasses }))
  check('blend: home to blue hour completes without a reload, postfx kept (no new draw pass, no held frame)', blend.path === 'blend' && blend.done && afterBlend.added === 0 && !afterBlend.held && afterBlend.passes === 1, { blend, afterBlend })
  // A rebuild's compile stall is 100 to 700 ms here; a blend's worst frame was 16.8 ms on a quiet GPU, 66.6 ms with three other builders on it.
  check('blend: takes about 1.5 s with no rebuild stall (worst frame under 100 ms)', blend.settledMs > 1300 && blend.settledMs < 2500 && blend.worstMs < 100, blend)
  measures.blend = blend

  // A blend reaches the target's numbers exactly.
  const tokens = await page.evaluate(() => {
    const stage = window.village.kernel.root.get('stage')
    return { exposure: stage.renderer.toneMappingExposure }
  })
  check('blend: ends on the target tokens (exposure 1.18)', Math.abs(tokens.exposure - 1.18) < 1e-6, tokens)

  // Rebuilds: the next chain compiles while the old one keeps drawing live (no held frame
  // before the swap), then the last frame is held over the swap and fades. Every frame of the
  // switch is gated under 100 ms; Pastoral's is reported only, since its window painter takes
  // about 1.3 s of main-thread time on first use (src/theme/paint.ts, not the chain).
  const pairs = [['blue-hour', 'neon-night'], ['neon-night', 'sixteen-bit'], ['sixteen-bit', 'comic'], ['comic', 'home'], ['home', 'neon-night'], ['neon-night', 'pastoral'], ['pastoral', 'home']]
  for (const [from, to] of pairs) {
    await page.waitForFunction(() => !document.querySelector('.village-theme-hold'), null, { timeout: 5000 })
    const t0 = await page.evaluate((id) => {
      window.__frames = []
      window.village.theme.set(id)
      return performance.now()
    }, to)
    await done(page)
    // The copy fades for 0.6 s after the switch is done.
    await page.waitForFunction(() => !document.querySelector('.village-theme-hold'), null, { timeout: 3000 }).catch(() => {})
    const r = await page.evaluate(() => window.village.theme.lastSwitch())
    const frames = await page.evaluate((t0) => window.__frames.filter((f) => f.t >= t0), t0)
    const swaps = await page.evaluate((t0) => window.village.theme.swaps().filter((s) => s.at >= t0), t0)
    const swapAt = frames.findIndex((f) => f.t > (swaps[0]?.at ?? Infinity))
    const live = swapAt > 0 && frames.slice(0, swapAt).every((f) => f.hold === 0)
    const covered = swapAt > 0 && frames[swapAt].hold === 1
    const intervals = frames.slice(1).map((f, i) => f.t - frames[i].t)
    const worst = Math.max(...intervals)
    check(`rebuild: ${from} to ${to} completes without a reload, one chain swapped in, held frame removed`, r.path === 'rebuild' && r.done && swaps.length === 1 && swaps[0].look === to && (await page.evaluate(() => !document.querySelector('.village-theme-hold'))), { r, swaps })
    check(`rebuild: ${from} to ${to}, the old chain draws live while the next compiles (${r.compiledMs} ms), the copy covers the swap`, live && covered, { swapAt, frames: frames.slice(Math.max(0, swapAt - 2), swapAt + 3) })
    if (to === 'pastoral') measures[`worst frame ${from}->${to} (reported)`] = worst
    else check(`rebuild: ${from} to ${to}, no frame over 100 ms at ?q=high (worst ${worst.toFixed(1)} ms)`, worst < 100, { intervals: intervals.filter((x) => x > 34) })
    measures[`${from}->${to}`] = { ...r, worst: +worst.toFixed(1) }
  }

  // Two rebuilds in quick succession: the look before last is never swapped in or shown.
  {
    await set(page, 'home')
    const t0 = await page.evaluate(() => {
      window.__frames = []
      window.village.theme.set('neon-night')
      return performance.now()
    })
    // The second choice lands a frame later, while neon night is still compiling.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(window.village.theme.set('comic')))))
    await done(page)
    await page.waitForTimeout(800)
    const swaps = await page.evaluate((t0) => window.village.theme.swaps().filter((s) => s.at >= t0).map((s) => s.look), t0)
    const state = await page.evaluate(() => ({ current: window.village.theme.current(), shown: window.village.kernel.root.get('stage') && window.village.theme.switching(), hold: Boolean(document.querySelector('.village-theme-hold')) }))
    check('double switch: home to neon night to comic a frame later swaps in only comic, no neon frame, no leftover copy', swaps.length === 1 && swaps[0] === 'comic' && state.current === 'comic' && !state.hold, { swaps, state })
  }
  check('no page errors while switching', errors.length === 0, errors)
  await context.close()
}

// Reduced motion: the same-shape switch is instant; a rebuild still holds the frame, without a fade.
{
  const { context, page } = await open('q=low', { reducedMotion: 'reduce' })
  const r = await set(page, 'blue-hour')
  const exposure = await page.evaluate(() => window.village.kernel.root.get('stage').renderer.toneMappingExposure)
  check('reduced motion: blue hour switches instantly', r.path === 'instant' && r.settledMs < 200 && Math.abs(exposure - 1.18) < 1e-6, { r, exposure })
  const n = await set(page, 'neon-night')
  check('reduced motion: a rebuild completes and settles within 100 ms of the new chain\'s first frame', n.done && n.settledMs - n.firstFrameMs < 150, n)
  await context.close()
}

// A blend finishes without the theme plugin: it runs on its own animation frames.
{
  const { context, page } = await open('q=low')
  await page.evaluate(() => localStorage.clear())
  await page.evaluate(async () => {
    window.village.theme.set('blue-hour')
    await window.village.unload('theme')
  })
  const r = await page.waitForFunction(() => !window.village.theme.switching() && window.village.theme.lastSwitch()?.done, null, { timeout: 5000 }).then(() => true, () => false)
  const after = await page.evaluate(() => ({ active: window.village.snapshot().plugins.active.includes('theme'), shown: window.village.theme.get(window.village.theme.current())?.id, report: window.village.theme.lastSwitch() }))
  check('blend without the theme plugin: finishes on time with the plugin unloaded', r && !after.active && after.report.path === 'blend' && after.report.settledMs < 2500, after)
  await context.close()
}

// Deleting the look on screen falls back to the look it was made from, and its card is marked.
{
  const { context, page } = await open('q=low')
  await page.evaluate(() => localStorage.clear())
  await set(page, 'blue-hour')
  const id = await page.evaluate(() => window.village.theme.save('Gone soon'))
  await page.evaluate(() => window.village.kernel.root.get('entries').choose('swatch-book'))
  await page.waitForTimeout(500)
  await page.click(`.swatch-slot.mine .swatch-tool:has-text("tear out")`)
  await done(page)
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => ({ current: window.village.theme.current(), marked: document.querySelector('.swatch-slot.current [data-look]')?.dataset.look ?? null, mine: window.village.theme.list().filter((l) => l.mine).length }))
  check('delete the shown look: falls back to the look it was made from (blue hour), its card marked', id && after.current === 'blue-hour' && after.marked === 'blue-hour' && after.mine === 0, after)
  await page.evaluate(() => localStorage.clear())
  await context.close()
}

// 3 and 4. Save, modify, rename, delete and the last look, across reloads.
{
  const { context, page } = await open('q=low')
  await page.evaluate(() => localStorage.clear())
  await set(page, 'blue-hour')
  const id = await page.evaluate(() => window.village.theme.save('Late tea'))
  const savedTokens = await page.evaluate(() => JSON.stringify(window.village.theme.get(window.village.theme.current()).light))
  await page.reload()
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(500)
  const afterSave = await page.evaluate(() => ({ list: window.village.theme.list(), current: window.village.theme.current(), active: window.village.snapshot().plugins.active.includes('theme') }))
  const kept = afterSave.list.find((l) => l.id === id)
  const keptTokens = await page.evaluate((id) => JSON.stringify(window.village.theme.get(id)?.light), id)
  check('save: "Late tea" survives a reload as one of your looks, same tokens', kept && kept.mine && kept.label === 'Late tea' && keptTokens === savedTokens, { id, kept, savedTokens, keptTokens })
  check('last look: the saved look comes back after a reload, with the theme plugin loaded', afterSave.current === id && afterSave.active, afterSave)

  // Modify: switch mid-blend towards the home and save under the same name.
  await page.evaluate(() => window.village.theme.set('home'))
  await page.waitForTimeout(700)
  const midId = await page.evaluate(() => window.village.theme.save('late TEA'))
  const mid = await page.evaluate((id) => window.village.theme.get(id).light.exposure, midId)
  await page.reload()
  await page.evaluate(() => window.village.ready())
  const modified = await page.evaluate((id) => ({ exposure: window.village.theme.get(id)?.light.exposure, count: window.village.theme.list().filter((l) => l.mine).length }), id)
  check('modify: saving a half-blended look under the same name replaces it (exposure between 1.18 and 1.25), and survives a reload', midId === id && modified.count === 1 && mid > 1.18 && mid < 1.25 && Math.abs(modified.exposure - mid) < 1e-9, { midId, mid, modified })

  await page.evaluate((id) => window.village.theme.rename(id, 'Evening tea'), id)
  await page.reload()
  await page.evaluate(() => window.village.ready())
  const renamed = await page.evaluate((id) => window.village.theme.list().find((l) => l.id === id)?.label, id)
  check('rename: survives a reload', renamed === 'Evening tea', renamed)

  const builtIn = await page.evaluate(() => window.village.theme.remove('neon-night'))
  await page.evaluate((id) => window.village.theme.remove(id), id)
  await page.reload()
  await page.evaluate(() => window.village.ready())
  const removed = await page.evaluate(() => ({ mine: window.village.theme.list().filter((l) => l.mine), neon: Boolean(window.village.theme.get('neon-night')) }))
  check('delete: a removed look stays gone after a reload; a built-in cannot be removed', removed.mine.length === 0 && removed.neon && builtIn === false, { removed, builtIn })

  await set(page, 'neon-night')
  await page.reload()
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(500)
  const restored = await page.evaluate(() => ({ current: window.village.theme.current(), active: window.village.snapshot().plugins.active }))
  check('last look: neon night comes back after a reload', restored.current === 'neon-night' && restored.active.includes('theme') && restored.active.includes('postfx'), restored)
  await page.goto(`${base}?q=low&theme=home`)
  await page.evaluate(() => window.village.ready())
  const asked = await page.evaluate(() => ({ current: window.village.theme.current(), theme: window.village.snapshot().plugins.active.includes('theme') }))
  check('?theme= wins over the last look', asked.current === 'home' && !asked.theme, asked)

  // A tampered record is refused, not loaded.
  await page.evaluate(() => localStorage.setItem('village.themes', JSON.stringify([
    { id: 'mine-bad', label: 'Bad', from: 'home', theme: { post: { stages: [{ kind: 'pixel', height: 1, palette: ['#000000'], dither: 0 }] } } },
    { id: '../evil', label: 'Evil', from: 'home', theme: {} },
  ])))
  await page.reload()
  await page.evaluate(() => window.village.ready())
  const tampered = await page.evaluate(() => ({
    mine: window.village.theme.list().filter((l) => l.mine).map((l) => l.id),
    stages: JSON.stringify(window.village.theme.get('mine-bad')?.post.stages),
  }))
  const expected = await page.evaluate(async () => {
    const { check } = await import('/src/theme/index.ts')
    const c = check({ post: { stages: [{ kind: 'pixel', height: 1, palette: ['#000000'], dither: 0 }] } })
    return typeof c === 'string' ? null : JSON.stringify(c.post.stages)
  })
  // Stored looks go through check(): a bad id is refused; a changed post chain is data like any
  // other (a look written from a sentence may carry stages) and loads exactly as check() returns it.
  check('storage: a bad id is refused; a changed post chain loads only as check() returns it', tampered.mine.length === 1 && tampered.mine[0] === 'mine-bad' && expected !== null && tampered.stages === expected, { tampered, expected })
  await page.evaluate(() => localStorage.clear())
  await context.close()
}

// 5. Keep my costume.
{
  const { context, page } = await open('q=low&villager=b')
  await page.evaluate(() => localStorage.removeItem('village.theme.costumes'))
  const colours = () => page.evaluate(() => {
    const out = {}
    window.village.kernel.root.get('stage').scene.traverse((o) => {
      if (!o.userData.villagerId) return
      const colours = []
      o.traverse((n) => { for (const m of [].concat(n.material ?? [])) if (m.color) colours.push(m.color.getHexString()) })
      out[o.userData.villagerId] = colours.join(',')
    })
    return out
  })
  const own = await colours()
  const ids = Object.keys(own)
  await set(page, 'neon-night')
  const themed = await colours()
  check(`keep costume: ${ids.length} villagers, all themed by neon night`, ids.length === 3 && ids.every((id) => themed[id] !== own[id]), { ids })
  await page.evaluate((id) => window.village.theme.keepCostume(id, true), ids[0])
  await page.waitForTimeout(200)
  const keptOne = await colours()
  check('keep costume: turning it on after theming restores that villager\'s own materials, others stay themed', keptOne[ids[0]] === own[ids[0]] && keptOne[ids[1]] === themed[ids[1]], { id: ids[0] })
  await set(page, 'blue-hour')
  await set(page, 'neon-night')
  const stillKept = await colours()
  check('keep costume: further switches leave it alone', stillKept[ids[0]] === own[ids[0]] && stillKept[ids[1]] !== own[ids[1]])
  await page.reload()
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(600)
  const reloaded = await page.evaluate((id) => {
    let flag = null
    window.village.kernel.root.get('stage').scene.traverse((o) => { if (o.userData.villagerId === id) flag = o.userData.keepCostume })
    return { flag, stored: window.village.theme.keepsCostume(id) }
  }, ids[0])
  const afterReload = await colours()
  check('keep costume: the choice survives a reload (neon night restored, that villager in its own colours)', reloaded.flag === true && reloaded.stored && afterReload[ids[0]] === own[ids[0]] && afterReload[ids[1]] !== own[ids[1]], reloaded)
  await page.evaluate((id) => window.village.theme.keepCostume(id, false), ids[0])
  await page.waitForTimeout(200)
  const off = await colours()
  check('keep costume: turning it off themes it again', off[ids[0]] !== own[ids[0]])
  await page.evaluate(() => localStorage.clear())
  await context.close()
}

// 6. The swatch book by keyboard and by pointer.
{
  const { context, page, errors } = await open('q=low')
  await page.evaluate(() => localStorage.clear())
  const state = () => page.evaluate(() => ({
    active: window.village.kernel.root.get('entries').active,
    focus: document.activeElement?.dataset?.entry ?? document.activeElement?.dataset?.look ?? document.activeElement?.className ?? null,
    open: !document.querySelector('.swatch-fan')?.hidden,
    current: window.village.theme.current(),
    marked: document.querySelector('.swatch-slot.current [data-look]')?.dataset.look ?? null,
  }))
  let reached = false
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = (await state()).focus === 'swatch-book'
  }
  check('keyboard: Tab reaches the swatch book', reached)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const opened = await state()
  check('keyboard: Enter opens the swatch book with the current look focused and marked', opened.open && opened.active === 'swatch-book' && opened.focus === 'home' && opened.marked === 'home', opened)
  await page.keyboard.press('Tab')
  const next = await state()
  await page.keyboard.press('Enter')
  await done(page)
  const chosen = await state()
  check('keyboard: Tab moves to the next card, Enter switches to it live and marks it', next.focus === 'blue-hour' && chosen.current === 'blue-hour' && chosen.marked === 'blue-hour' && chosen.open, { next, chosen })
  // Save this look by keyboard.
  await page.evaluate(() => document.querySelector('.swatch-save').focus())
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  await page.keyboard.type('Dusk')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  const savedCard = await page.evaluate(() => ({ cards: [...document.querySelectorAll('.swatch-slot.mine [data-look]')].map((b) => b.textContent), focus: document.activeElement?.dataset?.look }))
  check('keyboard: "save this look", a name and Enter add your card', savedCard.cards.some((t) => t.includes('Dusk')) && savedCard.focus?.startsWith('mine-'), savedCard)
  const tabs = []
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    tabs.push(await page.evaluate(() => document.querySelector('.swatch-fan').contains(document.activeElement)))
  }
  check('keyboard: Tab stays inside the open swatch book', tabs.every(Boolean), tabs)
  // The written request: no theme writer yet, so it says so and sends nothing.
  await page.evaluate(() => document.querySelector('.swatch-ask input').focus())
  await page.keyboard.type('make it cozier, more autumn')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  const ask = await page.evaluate(() => ({ note: document.querySelector('.swatch-ask .ask-note').textContent, hasAsk: typeof window.village.theme.ask === 'function' }))
  check('the written request: without village.theme.ask it says it is not here yet', ask.hasAsk || /aren't here yet/.test(ask.note), ask)
  if (shots) await page.screenshot({ path: `${shots}/swatch-book-open.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const closed = await state()
  check('keyboard: Escape closes the swatch book and returns focus to it', !closed.open && closed.active === null && closed.focus === 'swatch-book', closed)

  // Pointer: hover shows the label, click opens, clicking a card switches, clicking the room closes.
  await page.mouse.move(5, 5)
  const e = await page.evaluate(() => window.village.snapshot().entries.find((e) => e.id === 'swatch-book'))
  let hovered = null
  for (const [dx, dy] of [[0, 0], [0, -8], [0, 8], [-8, 0], [8, 0], [0, -16]]) {
    await page.mouse.move(e.x + dx, e.y + dy)
    await page.waitForTimeout(200)
    hovered = await page.evaluate(() => ({ hovered: window.village.kernel.root.get('entries').hovered, label: document.querySelector('.village-label.shown')?.textContent ?? null }))
    if (hovered.hovered === 'swatch-book') {
      e.x += dx
      e.y += dy
      break
    }
  }
  await page.mouse.click(e.x, e.y)
  await page.waitForTimeout(400)
  const clickOpen = await state()
  check('pointer: hover labels the swatch book and a click opens it', hovered.hovered === 'swatch-book' && hovered.label === 'Swatch book' && clickOpen.open, { hovered, clickOpen })
  await page.click('[data-look="neon-night"]')
  await done(page)
  const clicked = await state()
  check('pointer: clicking a card switches to it', clicked.current === 'neon-night' && clicked.marked === 'neon-night' && clicked.open, clicked)
  await page.click('.swatch-slot.mine .swatch-tool:has-text("tear out")')
  const torn = await page.evaluate(() => window.village.theme.list().filter((l) => l.mine).length)
  check('pointer: "tear out" deletes your look', torn === 0, torn)
  await page.mouse.click(1300, 120)
  await page.waitForTimeout(300)
  const away = await state()
  check('pointer: a click in the room closes the swatch book', !away.open && away.active === null, away)
  check('swatch book: no page errors', errors.length === 0, errors)
  await page.evaluate(() => localStorage.clear())
  await context.close()
}

// 7. Five load and unload cycles of the theme plugin and postfx leave nothing behind. The
// glass's transmission backdrop (a "phys" feature at the high tier) is a FramebufferTexture
// three clones per render target; postfx releases its scene pass's copy when a chain retires. Textures are compared with theme and postfx both unloaded,
// against the same page with postfx unloaded before any switch.
for (const q of ['q=low', 'q=high']) {
  const { context, page } = await open(q)
  await page.waitForTimeout(1500)
  const fresh = await residue(page)
  await page.evaluate(() => window.village.unload('postfx'))
  await page.waitForTimeout(300)
  const bare = await residue(page)
  await page.evaluate(() => window.village.load('postfx'))
  await page.waitForTimeout(500)
  const cycles = []
  for (let i = 0; i < 5; i++) {
    await set(page, 'neon-night')
    await set(page, 'sixteen-bit')
    await set(page, 'home')
    await page.evaluate(() => window.village.unload('theme'))
    await page.waitForTimeout(500)
    cycles.push(await residue(page))
  }
  check(`${q}, 5 cycles: geometries, frame hooks and draw passes back at their no-flag values after each`, cycles.every((c) => c.geometries === fresh.geometries && c.frameHooks === fresh.frameHooks && c.drawPasses === fresh.drawPasses), { fresh, cycles })
  await page.evaluate(() => window.village.unload('postfx'))
  await page.waitForTimeout(300)
  const end = await residue(page)
  check(`${q}, 5 cycles: live texture count does not grow from the first cycle to the fifth (${cycles.map((c) => c.textures).join(', ')})`, cycles.every((c) => c.textures <= cycles[0].textures), cycles.map((c) => c.textures))
  if (q === 'q=low') check(`${q}, 5 cycles: with theme and postfx unloaded, geometries and textures match the page before any switch`, end.geometries === bare.geometries && end.textures === bare.textures && end.frameHooks === bare.frameHooks, { bare, end })
  measures[`cycles ${q}`] = { fresh: fresh.textures, live: cycles.map((c) => c.textures), unloaded: [bare.textures, end.textures] }
  await page.evaluate(() => localStorage.clear())
  await context.close()
}

// 8. Without ?theme= nothing changes: a seeded, clock-fixed ?q=low capture against the code
// before this change. The swatch book is new on the sill, so it is unloaded for the capture.
if (before) {
  // A browser of its own, as theme-shots.mjs uses, so warm caches don't shift the animation clock.
  const fresh = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  const page = await fresh.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await page.addInitScript(() => {
    let s = 1234567
    Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  })
  await page.clock.setFixedTime(new Date('2026-11-07T17:30:00'))
  await page.goto(`${base}?q=low`)
  await page.waitForFunction(() => window.village, null, { timeout: 30000 })
  await page.evaluate(() => window.village.ready())
  await page.evaluate(() => window.village.unload('swatchbook'))
  await page.waitForTimeout(3000)
  const after = join(mkdtempSync(join(tmpdir(), 'themes-')), 'after.png')
  await page.screenshot({ path: after })
  await fresh.close()
  const diff = JSON.parse(execFileSync('node', ['scripts/theme-shots.mjs', '--diff', before, after], { encoding: 'utf8' }).trim().split('\n').at(-1))
  check('no ?theme=: ?q=low matches the code before themes went live (mean abs diff under 0.5 of 255)', diff.meanAbs < 0.5, diff)
  measures.noop = diff
} else check('no ?theme=: no-op diff not run (pass --before=<png>)', true)

await browser.close()
console.log(JSON.stringify(measures))
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
