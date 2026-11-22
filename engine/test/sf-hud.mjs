// The controls in play kept off the body (#450, page/play-hud.ts): every way of having them (`?hud=`), at 1280 x 720
// and on an upright phone of 390 x 844 with an iPhone's safe area (59 px at the top, 34 at the bottom, set through
// Chrome's own override so `env()` is what a phone has). Chrome with WebGPU; one GPU is shared, so it waits its turn.
//
//   node test/sf-hud.mjs [--no-build] [--dist dist-sf] [--modes default,wheel,context,quiet] [--sizes wide,phone]
//                        [--shots ~/.village/engine/sf/hud] [--reduced]
//
// For each, it goes onto the roof (the host's `explore`) and takes a picture standing, choosing a tool, falling, under
// the canopy and, on a phone, with a thumb down on the body and in the corner. At each it measures:
//   - the body's box (`engine.playHud.body()`: a box round the figure's every corner, arms out in a fall, the canopy
//     over it), and every element of the page that is seen over the picture: the kit's own canvases too, which draw a
//     key's solid past its box. None may meet the body's box.
//   - on a phone, none may reach into the safe area.
// The realm's own controls (`default`) are measured and said, not failed: they are what the owner asked to change.
// A picture with the boxes drawn on (red the body, green what is over the picture) is kept beside each, in `boxes/`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'hud'))
const modes = arg('modes', 'default,wheel,context,quiet').split(','), sizes = arg('sizes', 'wide,phone').split(',')
const SAFE = { top: 59, bottom: 34, left: 0, right: 0 }
const failures = [], said = []
const check = (ok, what, gate = true) => { console.log(`  ${ok ? 'ok  ' : gate ? 'FAIL' : 'was '} ${what}`); if (!ok && gate) failures.push(what); if (!ok && !gate) said.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(join(shots, 'boxes'), { recursive: true })
const site = await plain(dist, '127.0.0.1', 0)
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
// (`--reduced`: the same where less motion is wanted, and the pictures named so.)
const reduced = has('reduced'), less = reduced ? { reducedMotion: 'reduce' } : {}
const SIZES = { wide: { viewport: { width: 1280, height: 720 }, ...less }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...less } }
const until = (page, what, ms = 60_000) => page.waitForFunction(what, null, { timeout: ms }).then(() => true, () => false)

/** The body's box and every box over the picture that meets it or the safe area (CSS px). */
const measure = (page, safe) => page.evaluate((safe) => {
  const e = globalThis.engine, body = e.playHud.body(), parts = e.playHud.parts(), vw = innerWidth, vh = innerHeight
  const canvas = document.querySelector('body > canvas, canvas#view') ?? [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const seen = []
  for (const el of document.body.querySelectorAll('*')) {
    // (A kit part's own canvas is its box and a pad of 6 voxels all round, mostly empty: the part is measured by its solid below.)
    if (el === canvas || el.classList.contains('vx-canvas') || el.closest('[hidden]') || ['STYLE', 'SCRIPT', 'LINK', 'TEMPLATE'].includes(el.tagName)) continue
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue
    const b = el.getBoundingClientRect()
    // A kit part drawn in voxels stands up and to the left of its face by half its height (SPEC: --vx-face-z, SHEAR 0.5), and a voxel past it all round.
    const cs0 = getComputedStyle(el), lift = el.hasAttribute('data-vx-live') ? (parseFloat(cs0.getPropertyValue('--vx-face-z')) || 0) * 0.5 * (parseFloat(cs0.getPropertyValue('--vx')) || 4) : 0
    const v1 = el.hasAttribute('data-vx-live') ? parseFloat(cs0.getPropertyValue('--vx')) || 4 : 0
    const r = { left: b.left - lift - v1, top: b.top - lift - v1, right: b.right + v1, bottom: b.bottom + v1, width: b.width, height: b.height }
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue
    // A layer over the whole page (the realm's root, the thumbs' box) is not itself seen: what is in it is.
    if (r.width * r.height > vw * vh * 0.4) continue
    const cs = getComputedStyle(el)
    // A box with nothing of its own to show (no fill, no border, no text of its own, not a canvas or a picture) is only where its children are.
    const own = el.hasAttribute('data-vx-live') || el.tagName === 'CANVAS' || el.tagName === 'IMG' || el.tagName === 'svg' || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none'
    if (!own) continue
    const id = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`
    const path = [el.parentElement?.closest('[id]')?.id, el.closest('[class]:not(canvas)')?.className?.toString().split(' ')[0]].filter(Boolean).join(' ')
    seen.push({ id, path, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  }
  const meets = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
  const over = seen.filter((s) => parts.some((p) => meets(s, p)))
  const unsafe = seen.filter((s) => s.top < safe.top - 0.5 || s.bottom > vh - safe.bottom + 0.5 || s.left < safe.left - 0.5 || s.right > vw - safe.right + 0.5)
  // Controls against each other, by their solids: a cue on a key, a key on a key.
  const solid = (el) => { const b = el.getBoundingClientRect(), cs = getComputedStyle(el), vx = parseFloat(cs.getPropertyValue('--vx')) || 4, live = el.hasAttribute('data-vx-live'), lift = live ? (parseFloat(cs.getPropertyValue('--vx-face-z')) || 0) * 0.5 * vx : 0; return { left: b.left - lift, top: b.top - lift, right: b.right, bottom: b.bottom } }
  const controls = [...document.querySelectorAll('#realm .cue.on, #realm .act :is(.use, .up, .down, .walks, .toolkey), #realm .held, #realm .fold, #first .credits, #realm .wheel .slot, [data-panel="wand-take"] button, #where')].filter((el) => !el.closest('[hidden]') && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 2)
  const name = (el) => el.id ? `#${el.id}` : el.closest('[data-panel]') ? `[data-panel=${el.closest('[data-panel]').dataset.panel}]` : `.${[...el.classList].filter((c) => !c.startsWith('vx-')).join('.')}`
  const clash = []
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) { const a = controls[i], b = controls[j]; if (a.contains(b) || b.contains(a)) continue; if (meets(solid(a), solid(b))) clash.push(`${name(a)} on ${name(b)}`) }
  return { body, parts, seen: seen.length, over, unsafe, clash, boxes: seen, state: { on: e.me.on, aloft: e.me.aloft, canopy: e.me.canopy, view: e.me.view } }
}, safe)
/** A picture with the boxes drawn on, for a person to see that the boxes are where the body and the controls are. */
const drawn = async (page, m, file) => {
  await page.evaluate((m) => {
    const layer = document.createElement('div'); layer.id = 'hud-boxes'; layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99'
    const box = (b, colour) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;outline:2px solid ${colour}`; layer.append(d) }
    for (const s of m.boxes) box(s, 'rgba(40,220,90,.8)')
    for (const s of m.over) box(s, 'rgba(255,200,0,1)')
    for (const p of m.parts) box(p, 'rgba(255,40,40,1)')
    document.body.append(layer)
  }, m)
  await page.screenshot({ path: file })
  await page.evaluate(() => document.getElementById('hud-boxes')?.remove())
}
const results = {}
try {
  for (const size of sizes) {
    const phone = size === 'phone', safe = phone ? SAFE : { top: 0, bottom: 0, left: 0, right: 0 }
    const context = await browser.newContext(SIZES[size])
    for (const mode of modes) {
      console.log(`\n${mode} at ${size}`)
      const page = await context.newPage(), errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      // (One session: the override is the session's, and a second one opened after it was found to leave env() at 0.)
      const cdp = await context.newCDPSession(page)
      if (phone) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: safe })
      await page.goto(`${site.url}/sf/index.html?knock=0${mode === 'default' ? '' : `&hud=${mode}`}`)
      await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.explore && globalThis.engine.playHud, null, { timeout: 300_000 })
      await page.evaluate(() => { globalThis.engine.scale = 0.75; void globalThis.engine.explore.go() })
      const inside = await until(page, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, 90_000)
      check(inside, 'on the roof, the eye behind the body')
      const gate = mode !== 'default', at = {}
      const look = async (name, what) => {
        const file = join(shots, `${mode}${reduced ? '-less' : ''}-${name}-${size === 'wide' ? '1280x720' : '390x844'}.png`)
        await page.screenshot({ path: file })
        const m = await measure(page, safe)
        at[name] = { body: m.body && Object.fromEntries(Object.entries(m.body).map(([k, v]) => [k, Math.round(v)])), over: m.over.map((s) => s.id), unsafe: m.unsafe.map((s) => s.id), state: m.state }
        await drawn(page, m, join(shots, 'boxes', `${mode}${reduced ? '-less' : ''}-${name}-${size === 'wide' ? '1280x720' : '390x844'}.png`))
        check(!!m.body, `${name}: the body is seen (${what})`, gate)
        check(m.body && m.over.length === 0, `${name}: nothing over the body${m.over.length ? `: ${[...new Set(m.over.map((s) => s.path || s.id))].join(', ')}` : ''} (${m.seen} things over the picture)`, gate)
        check(m.clash.length === 0, `${name}: no control on another${m.clash.length ? `: ${m.clash.join(', ')}` : ''}`, gate)
        if (phone) check(m.unsafe.length === 0, `${name}: nothing in the safe area${m.unsafe.length ? `: ${[...new Set(m.unsafe.map((s) => s.path || s.id))].join(', ')}` : ''}`, gate)
      }
      // (The body as it is in play: where it arrives the eye stands off from it, until it walks (explore.ts, sf-explore.mjs).)
      await page.evaluate(() => { globalThis.engine.me.standOff = 0 })
      await page.waitForTimeout(3500)
      await look('stand', 'standing on the roof')
      // That the controls are there, where each way has them: a control missing meets nothing, and the measures above would pass.
      const seen = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { on: el.checkVisibility({ visibilityProperty: true, opacityProperty: true }), left: r.left, right: r.right, top: r.top, bottom: r.bottom, wide: r.width, tall: r.height } }, sel)
      if (mode !== 'default') {
        const keyOf = await seen(phone ? '#realm .toolkey' : '#realm .held'), bank = await seen('#realm .tools')
        if (phone || mode === 'wheel') check(!!keyOf?.on, `the tool's key is shown (${phone ? 'at the top' : 'in the corner'})`)
        if (!phone && mode === 'context') check(!!bank?.on && bank.tall > bank.wide && bank.right > 1280 - 40, 'the tools stand in a column at the right edge')
        // (The wheel has no bank; quiet's is put away only while the picture holds the pointer, which a check cannot take.)
        if (!phone && mode === 'wheel') check(!bank?.on, 'the tools\' bank is put away')
        if (phone) check(!!(await seen('#realm .act .use'))?.on && (await seen('#realm .act .use')).right > 390 - 40, 'Use is in the right corner')
      }
      // Choosing a tool: E (by touch the tool's key) as a person would; the default has its bank.
      if (mode !== 'default') {
        const before = await page.evaluate(() => globalThis.engine.tool)
        if (phone) {
          const k = await page.evaluate(() => { const r = document.querySelector('#realm .toolkey')?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2] })
          check(!!k, 'the tool\'s key is there to press')
          if (k) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: k[0], y: k[1] }] }); await page.waitForTimeout(350) }
          await look('choose', 'the tool\'s key down')
          if (k) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        } else {
          await page.keyboard.down('KeyE'); await page.waitForTimeout(350)
          await look('choose', 'E held')
          // (Held on, the key repeats: a repeat is not another press, and the wheel stays open to aim.)
          if (mode === 'wheel') { await page.keyboard.down('KeyE'); await page.waitForTimeout(100); check(await page.evaluate(() => globalThis.engine.playHud.choosing), 'E held until it repeats keeps the wheel open') }
        }
        // (Read while E is still held: letting it go is a choice, below.)
        const after = await page.evaluate(() => ({ tool: globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing, slots: [...document.querySelectorAll('#realm .wheel .slot')].filter((s) => s.checkVisibility()).length }))
        if (!phone) await page.keyboard.up('KeyE')
        if (mode === 'wheel') check(after.choosing && after.slots === 7, `the wheel is open with its 7 tools (${after.slots} seen)`)
        else check(after.tool !== before, `the next tool is taken (${before} to ${after.tool})`)
        await page.waitForTimeout(200)
        // The ways to choose on a desk, each read back: let go of E after holding it, a tap and the arrows, Tab and Enter.
        if (mode === 'wheel' && !phone) {
          const now = () => page.evaluate(() => ({ tool: globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
          const held = await now()
          check(!held.choosing, `holding E and letting it go closes the wheel with a choice (${held.tool})`)
          await page.keyboard.press('KeyE'); await page.waitForTimeout(150)
          const tapped = await now()
          await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(150)
          const arrowed = await now()
          check(tapped.choosing && !arrowed.choosing && arrowed.tool !== held.tool, `a tap of E leaves it open, and the arrow and Enter pick the next (${held.tool} to ${arrowed.tool})`)
          await page.keyboard.press('KeyE'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.waitForTimeout(150)
          const tabbed = await now()
          check(!tabbed.choosing && tabbed.tool !== arrowed.tool && !(await page.evaluate(() => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName))), `Tab goes round the wheel and Enter picks the one marked, not the line to ask on (${arrowed.tool} to ${tabbed.tool})`)
          await page.keyboard.press('Escape')
          const slot = (i) => page.evaluate((i) => { const el = document.querySelectorAll('#realm .wheel .slot')[i], r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: el.textContent.replace(/^\d+/, '').trim() } }, i)
          // Held, the mouse over a tool (the pointer free), let go: that tool, three round from the one held (the wheel opens marked at the one held).
          const heldAt = await page.evaluate(() => [...document.querySelectorAll('#realm .wheel .slot')].findIndex((el) => el.textContent.replace(/^\d+/, '').trim() === globalThis.engine.tool))
          await page.keyboard.down('KeyE'); await page.waitForTimeout(120)
          const aimed = await slot((heldAt + 3) % 7); await page.mouse.move(aimed.x, aimed.y, { steps: 4 }); await page.waitForTimeout(250)
          await page.keyboard.up('KeyE'); await page.waitForTimeout(150)
          check((await now()).tool === aimed.name && !(await now()).choosing, `holding E, pointing at ${aimed.name} and letting go picks it (${(await now()).tool})`)
          // A number; Escape leaves it as it was; a click on a tool.
          await page.keyboard.press('KeyE'); await page.keyboard.press('Digit2'); await page.waitForTimeout(120)
          const numbered = await now(), two = await slot(1)
          check(!numbered.choosing && numbered.tool === two.name, `2 picks ${two.name} (${numbered.tool})`)
          await page.keyboard.press('KeyE'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape'); await page.waitForTimeout(120)
          check(!(await now()).choosing && (await now()).tool === numbered.tool, 'Escape closes it with the tool as it was')
          await page.keyboard.press('KeyE'); await page.waitForTimeout(120)
          const first = await slot(0); await page.mouse.click(first.x, first.y); await page.waitForTimeout(150)
          check(!(await now()).choosing && (await now()).tool === first.name, `a click on ${first.name} picks it (${(await now()).tool})`)
          // The held key by the keyboard: Enter opens the wheel there, focus on a tool; the arrow and Enter pick; the focus comes back.
          await page.evaluate(() => document.querySelector('#realm .held').focus())
          await page.keyboard.press('Enter'); await page.waitForTimeout(120)
          const opened = await page.evaluate(() => ({ choosing: globalThis.engine.playHud.choosing, on: document.activeElement?.classList.contains('slot') }))
          await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(150)
          const keyed = await page.evaluate(() => ({ choosing: globalThis.engine.playHud.choosing, tool: globalThis.engine.tool, back: document.activeElement?.classList.contains('held') }))
          check(opened.choosing && opened.on && !keyed.choosing && keyed.tool !== first.name && keyed.back, `Enter on the held key opens the wheel with the focus on a tool, the arrow and Enter pick (${keyed.tool}), and the focus comes back to the key`)
          // Space on the focused key is still the world's: it jumps, and does not open the wheel.
          await page.evaluate(() => document.querySelector('#realm .held').focus())
          await page.keyboard.press('Space')
          const jumped = await until(page, () => globalThis.engine.me.aloft, 1500)
          await page.waitForTimeout(150)
          check(jumped && !(await now()).choosing, `Space on the focused key jumps (${jumped}) and does not open the wheel`)
          await until(page, () => !globalThis.engine.me.aloft, 3000)
          await page.evaluate(() => document.activeElement?.blur())
          // On a desk that came in by no roof the sky's panel is open from the start: E still opens the wheel, and it stays.
          // (A few frames after the class is set: set and E pressed in one frame is the panel opening over the wheel, which closes it.)
          await page.evaluate(() => document.querySelector('#realm').classList.add('open')); await page.waitForTimeout(200)
          await page.keyboard.press('KeyE'); await page.waitForTimeout(200)
          check((await now()).choosing, 'with the sky\'s panel already open, E opens the wheel and it stays open')
          await page.keyboard.press('Escape')
          await page.evaluate(() => document.querySelector('#realm').classList.remove('open'))
          // While it is open the body stands: W held does not walk it.
          const at0 = await page.evaluate(() => globalThis.engine.me.feet?.at)
          await page.keyboard.press('KeyE'); await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW')
          const at1 = await page.evaluate(() => globalThis.engine.me.feet?.at)
          check(at0 && at1 && Math.hypot(at1[0] - at0[0], at1[2] - at0[2]) < 2, `W held with the wheel open does not walk the body (${at0 && at1 ? (Math.hypot(at1[0] - at0[0], at1[2] - at0[2]) / 10).toFixed(2) : '?'} m)`)
          await page.keyboard.press('Escape')
        }
        // By touch (wheel): a slide down the column picks where it is let go; a tap leaves it open for a tap on a tool.
        if (mode === 'wheel' && phone) {
          const now = () => page.evaluate(() => ({ tool: globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
          const slot = (i) => page.evaluate((i) => { const el = document.querySelectorAll('#realm .wheel .slot')[i], r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: el.textContent.replace(/^\d+/, '').trim() } }, i)
          await page.evaluate(() => globalThis.engine.playHud.choose(false))
          const k = await page.evaluate(() => { const r = document.querySelector('#realm .toolkey').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: k[0], y: k[1] }] }); await page.waitForTimeout(150)
          const to = await slot(3)
          for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: k[0] + ((to.x - k[0]) * i) / 8, y: k[1] + ((to.y - k[1]) * i) / 8 }] }); await page.waitForTimeout(30) }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(200)
          check(!(await now()).choosing && (await now()).tool === to.name, `a slide down to ${to.name} and let go picks it (${(await now()).tool})`)
          await page.touchscreen.tap(k[0], k[1]); await page.waitForTimeout(200)
          const tapped = (await now()).choosing, six = await slot(5)
          await page.touchscreen.tap(six.x, six.y); await page.waitForTimeout(200)
          check(tapped && !(await now()).choosing && (await now()).tool === six.name, `a tap opens it and a tap on ${six.name} picks it (${(await now()).tool})`)
        }
        await page.evaluate(() => globalThis.engine.playHud.choose(false))
      }
      // On a desk, in play: the picture holds the pointer (a click on it takes it, as sf-explore checks). What each way puts away then, and the wheel picked by the mouse's direction and by a click.
      if (!phone && mode !== 'default') {
        await page.mouse.move(640, 200); await page.mouse.click(640, 200); await page.waitForTimeout(400)
        const locked = await page.evaluate(() => globalThis.engine.input.locked)
        check(locked, 'a click on the picture takes the pointer')
        if (locked) {
          await page.waitForTimeout(600)
          await look('play', 'in play, the pointer held')
          const shown = await page.evaluate(() => Object.fromEntries(Object.entries({ credits: '#first .credits', sky: '#realm .fold', held: '#realm .held', bank: '#realm .tools' }).map(([k, sel]) => [k, !!document.querySelector(sel)?.checkVisibility({ visibilityProperty: true, opacityProperty: true })])))
          if (mode === 'wheel') check(!shown.credits && !shown.sky && shown.held, `in play the corner keys step away and the tool's key stays (${JSON.stringify(shown)})`)
          if (mode === 'quiet') check(!shown.credits && !shown.sky && !shown.bank, `in play everything is put away (${JSON.stringify(shown)})`)
          if (mode === 'context') check(shown.credits && shown.sky && shown.bank, `in play nothing hides itself (${JSON.stringify(shown)})`)
          if (mode === 'wheel') {
            const tools = await page.evaluate(() => [...document.querySelectorAll('#realm .wheel .slot')].map((el) => el.textContent.replace(/^\d+/, '').trim()))
            // Held E, the mouse moved right: the tool to the right of the ring (third, Big charge, at about -13 degrees); let go, it is taken.
            await page.evaluate(() => globalThis.engine.pickTool(0)); await page.waitForTimeout(100)
            await page.keyboard.down('KeyE'); await page.waitForTimeout(120)
            await page.mouse.move(820, 200, { steps: 6 }); await page.waitForTimeout(150)
            await page.keyboard.up('KeyE'); await page.waitForTimeout(150)
            const right = await page.evaluate(() => ({ tool: globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
            check(!right.choosing && right.tool === tools[2], `held E and the mouse moved right picks ${tools[2]} (${right.tool})`)
            // A tap of E, the mouse moved up, a click: the top tool.
            await page.keyboard.press('KeyE'); await page.waitForTimeout(120)
            await page.mouse.move(820, 20, { steps: 6 }); await page.waitForTimeout(150)
            await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(150)
            const up = await page.evaluate(() => ({ tool: globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
            check(!up.choosing && up.tool === tools[0], `a tap of E, the mouse moved up and a click picks ${tools[0]} (${up.tool})`)
          }
          await page.evaluate(() => document.exitPointerLock()); await page.waitForTimeout(600)
          if (mode !== 'context') check(await page.evaluate(() => !!document.querySelector('#first .credits')?.checkVisibility({ opacityProperty: true })), 'the pointer let go, the corner keys come back')
        }
      }
      // A phone, mid-move: a thumb down on the body (the stick must not be drawn there), then in the corner.
      if (phone) {
        const b = await page.evaluate(() => globalThis.engine.playHud.body())
        // In the corner: the lowest place in the left half where the stick's well (62 px round the thumb) is clear of the body by 40 px, as it walks and bobs.
        const clear = await page.evaluate(({ safe }) => {
          const parts = globalThis.engine.playHud.parts(), r = 62, meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
          for (let y = innerHeight - safe.bottom - r; y > innerHeight / 3; y -= 8) for (let x = r + 8; x < innerWidth / 2; x += 8) { const w = { left: x - r - 40, top: y - r - 40, right: x + r + 40, bottom: y + r + 40 }; if (!parts.some((p) => meets(w, p))) return [x, y] }
          return null
        }, { safe })
        check(!!clear, `there is room for the stick in the left half, clear of the body${clear ? ` (at ${clear.map(Math.round).join(', ')})` : ''}`, gate)
        // (Clear of the body first: a thumb moving walks the body, and the place found was for where it stood.)
        for (const [name, x, y] of [['move', ...(clear ?? [80, 720])], ['move-body', (b.left + b.right) / 2, (b.top + b.bottom) / 2]]) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
          for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 2, y: y - i * 6 }] }); await page.waitForTimeout(40) }
          await page.waitForTimeout(500)
          await look(name, 'a thumb down and moving')
          if (name === 'move') check(await page.evaluate(() => (() => { const f = document.querySelector('#realm .float'); return !!f && f.classList.contains('on') && Number(getComputedStyle(f).opacity) > 0.9 })()), 'the stick is drawn under a thumb clear of the body', gate)
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await page.waitForTimeout(300)
        }
      }
      // Falling, then under the canopy: put up in the air over the roof.
      const up = () => page.evaluate(() => { const e = globalThis.engine, s = e.explore.stand; e.me.walk(false); Object.assign(e.pose, { x: s.x / 10 + 4, y: e.pose.y + 60, z: s.z / 10 + 2 }); e.me.walk(true) })
      await up()
      await until(page, () => globalThis.engine.me.aloft && globalThis.engine.me.feet, 10_000)
      await page.waitForTimeout(700)
      await look('fall', 'falling')
      if (phone) {
        const k = await page.evaluate(() => { const r = document.querySelector('#realm .act .up').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
        await page.touchscreen.tap(k[0], k[1])
      } else await page.keyboard.press('Space')
      await page.waitForTimeout(1400)
      const hung = await page.evaluate(() => globalThis.engine.me.canopy)
      check(hung, 'the canopy opens in the air')
      await look('canopy', 'under the canopy')
      check(errors.length === 0, `no errors${errors.length ? `: ${errors.slice(0, 2).join(' | ')}` : ''}`)
      results[`${mode}-${size}`] = at
      await page.close()
    }
    await context.close()
  }
} catch (e) {
  console.log(`  FAIL ${e.message.split('\n')[0]}`)
  failures.push(e.message.split('\n')[0])
} finally {
  await browser.close()
  site.stop()
  back()
}
writeFileSync(join(shots, reduced ? 'results-less.json' : 'results.json'), JSON.stringify(results, null, 1))
if (said.length) console.log(`\nthe realm's own controls, measured (not failed):\n${said.map((f) => `  - ${f}`).join('\n')}`)
console.log(failures.length ? `\nsf-hud: ${failures.length} failed\n${failures.map((f) => `  - ${f}`).join('\n')}` : '\nsf-hud: passed')
process.exit(failures.length ? 1 : 0)
