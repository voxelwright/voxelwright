// The controls in play kept off the body (#450, page/play-hud.ts): every way of having them (`?hud=`), at 1280 x 720,
// on an upright phone of 390 x 844 and on one on its side (844 x 390), each with an iPhone's safe area (59 px at the top
// and 34 at the bottom upright; 59 at each side and 21 at the bottom on its side), set through Chrome's own override so
// `env()` is what a phone has. Chrome with WebGPU; one GPU is shared, so it waits its turn.
//
//   node test/sf-hud.mjs [--no-build] [--dist dist-sf] [--modes default,context,quiet,classic] [--sizes wide,phone,side]
//                        [--shots ~/.village/engine/sf/hud-default] [--reduced]
//
// `default` is the page with no switch, which has the wheel; `wheel` is the same asked for by name. `classic` is the
// realm's controls as they were before the wheel (`?hud=classic`).
//
// For each, it goes onto the roof (the host's `explore`) and takes a picture standing, choosing a tool, falling, under
// the canopy and, on a phone, with a thumb down on the body and in the corner. At each it measures:
//   - the body's box (`engine.playHud.body()`: a box round the figure's every corner, arms out in a fall, the canopy
//     over it), and every element of the page that is seen over the picture: the kit's own canvases too, which draw a
//     key's solid past its box. None may meet the body's box.
//   - on a phone, none may reach into the safe area.
// By touch it also fails where a thumb's key is larger than the touch guidance asks (game-hud rule 16), where the wheel's
// pie is not whole and in the middle of the safe area or shows the tool twice, and where the body is
// so placed that the stick has no room where the left thumb rests.
// The realm's old controls (`classic`) are measured and said, not failed: they are what the owner asked to change.
// With the wheel (#75) it also fails where the first view's keys are not slim voxel keys, where the Settings panel is not
// in its sections or any two of its controls meet (in the first view and in play), where the gameplay HUD has a Back key
// of its own or the driving keys a Seat key, and where the Make bar opened does not go away again (its × key, a press on
// the picture, Escape), the input given back to the world and the keys of play shown again.
// Street life is switched off for it (`engine.street.enabled`, kept off as the first view is left): a car that stops
// beside the body offers E to take it over the body, and took the E that opens the wheel.
// A picture with the boxes drawn on (red the body, green what is over the picture) is kept beside each, in `boxes/`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'hud-default'))
const modes = arg('modes', 'default,context,quiet,classic').split(','), sizes = arg('sizes', 'wide,phone,side').split(',')
// (`--ride-only`: only standing and riding, for a quick look at the keys of a thing ridden.)
const rideOnly = has('ride-only')
const SAFES = { wide: { top: 0, bottom: 0, left: 0, right: 0 }, phone: { top: 59, bottom: 34, left: 0, right: 0 }, side: { top: 0, bottom: 21, left: 59, right: 59 } }
const NAMED = { wide: '1280x720', phone: '390x844', side: '844x390' }
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
const SIZES = { wide: { viewport: { width: 1280, height: 720 }, ...less }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...less }, side: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...less } }
const until = (page, what, ms = 60_000) => page.waitForFunction(what, null, { timeout: ms }).then(() => true, () => false)

/** The Settings panel (#75): its sections there, in order, and no two of its controls meeting, nor any outside the panel or the screen. */
const panelLaid = (page) => page.evaluate(() => {
  const sky = document.querySelector('#realm .sky'), seen = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 2
  const parts = [...sky.querySelectorAll(':scope > .part')].filter((p) => getComputedStyle(p).display !== 'none' && [...p.children].some(seen)).map((p) => p.classList[1])
  const ctl = [...sky.querySelectorAll('header, .vx-toggle-group > label, .vx-slider, .res-auto, .foot > .vx-button')].filter(seen)
  const box = (el) => el.getBoundingClientRect(), p = box(sky), name = (el) => (el.textContent.trim() || el.className).slice(0, 24)
  const meet = [], out = []
  for (let i = 0; i < ctl.length; i++) {
    const a = box(ctl[i])
    if (a.left < p.left - 0.5 || a.right > p.right + 0.5 || a.top < p.top - 0.5 || a.bottom > p.bottom + 0.5 || a.right > innerWidth || a.bottom > innerHeight) out.push(name(ctl[i]))
    for (let j = i + 1; j < ctl.length; j++) { const b = box(ctl[j]); if (ctl[i].contains(ctl[j]) || ctl[j].contains(ctl[i])) continue; if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) meet.push(`${name(ctl[i])} on ${name(ctl[j])}`) }
  }
  return { parts, controls: ctl.length, meet, out, bottom: Math.round(p.bottom), height: innerHeight }
})
/** Whether a kit control is built in the slim look: its look, its voxels drawn, and its low cap (3 courses, SPEC). */
const slimKey = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el), cv = el.querySelector(':scope > .vx-canvas'); return { look: cs.getPropertyValue('--vx-look').trim(), live: el.hasAttribute('data-vx-live') && !!cv?.checkVisibility(), faceZ: Number(el.style.getPropertyValue('--vx-face-z')) } }, sel)
/** The first view, before going in (default only): its keys in the slim look, and its Settings panel in sections with no control on another. */
const firstView = async (page, phone) => {
  await page.waitForFunction(() => document.querySelector('#first .credits')?.hasAttribute('data-vx-live') && document.querySelector('#realm .fold')?.hasAttribute('data-vx-live'), null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(800)
  for (const [what, sel] of [['the credits key', '#first .credits'], ['the settings key', '#realm .fold']]) {
    const k = await slimKey(page, sel)
    check(!!k && k.look === 'slim' && k.live && k.faceZ > 0 && k.faceZ <= 3, `first view: ${what} is a slim voxel key (${JSON.stringify(k)})`)
  }
  const r = await page.evaluate(() => { const b = document.querySelector('#realm .fold').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })
  if (phone) await page.touchscreen.tap(r[0], r[1]); else await page.mouse.click(r[0], r[1])
  await page.waitForTimeout(700)
  const laid = await panelLaid(page)
  check(laid.parts.slice(0, 2).join() === 'world,gfx' && !laid.parts.includes('acts') && laid.meet.length === 0 && laid.out.length === 0, `first view: the Settings panel is in its sections (${laid.parts.join(', ')}), ${laid.controls} controls, none on another${laid.meet.length ? `: ${laid.meet.join('; ')}` : ''}${laid.out.length ? `, outside: ${laid.out.join(', ')}` : ''}`)
  const panel = await slimKey(page, '#realm .sky')
  check(panel?.look === 'slim' && panel.live && panel.faceZ > 0 && panel.faceZ <= 4, `first view: the Settings panel is built in the slim look, a low enclosure (${JSON.stringify(panel)})`)
  await page.screenshot({ path: join(shots, `default-first-sky-${NAMED[phone ? (page.viewportSize().width > page.viewportSize().height ? 'side' : 'phone') : 'wide']}.png`) })
  if (phone) await page.touchscreen.tap(r[0], r[1]); else await page.mouse.click(r[0], r[1])
  await page.waitForTimeout(400)
}
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
    // A kit part drawn in voxels stands up and to the left of its face by half its height (SPEC: --vx-face-z, SHEAR 0.5), and a voxel past it all round — only when its voxel canvas is actually visible.
    const cv = el.hasAttribute('data-vx-live') ? el.querySelector(':scope > .vx-canvas') : null
    const liveKit = !!cv && cv.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    const cs0 = getComputedStyle(el), lift = liveKit ? (parseFloat(cs0.getPropertyValue('--vx-face-z')) || 0) * 0.5 * (parseFloat(cs0.getPropertyValue('--vx')) || 4) : 0
    const v1 = liveKit ? parseFloat(cs0.getPropertyValue('--vx')) || 4 : 0
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
  // Controls against each other, by their visible bounds (including voxel overhang only where a voxel canvas is drawn).
  const solid = (el) => { const b = el.getBoundingClientRect(), cs = getComputedStyle(el), vx = parseFloat(cs.getPropertyValue('--vx')) || 4, cv = el.hasAttribute('data-vx-live') ? el.querySelector(':scope > .vx-canvas') : null, live = !!cv && cv.checkVisibility({ visibilityProperty: true, opacityProperty: true }), lift = live ? (parseFloat(cs.getPropertyValue('--vx-face-z')) || 0) * 0.5 * vx : 0; return { left: b.left - lift, top: b.top - lift, right: b.right, bottom: b.bottom } }
  const controls = [...document.querySelectorAll('#realm .cue.on, #realm .act :is(.use, .up, .down, .walks, .toolkey), #realm .held, #realm .fold, #realm .sky, #realm .egg-line, #realm .lobbies, #first .credits, #first .corner a, #realm .wheel .slot, [data-panel="wand-take"] button, [data-panel="living"] button, #card, #where, #minimap, #ask-row')].filter((el) => !el.closest('[hidden]') && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 2)
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
    // (`phone`: by touch, upright or on its side.)
    const phone = size !== 'wide', upright = size === 'phone', safe = SAFES[size], { width: vw, height: vh } = SIZES[size].viewport
    const context = await browser.newContext(SIZES[size])
    for (const mode of modes) {
      console.log(`\n${mode} at ${size}`)
      const page = await context.newPage(), errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      // (One session: the override is the session's, and a second one opened after it was found to leave env() at 0.)
      const cdp = await context.newCDPSession(page)
      if (phone) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: safe })
      await page.goto(`${site.url}/sf/index.html${mode === 'default' ? '' : `?hud=${mode}`}`)
      // (The page with no switch has the wheel.)
      const wheel = mode === 'default' || mode === 'wheel'
      await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.explore && globalThis.engine.playHud, null, { timeout: 300_000 })
      if (mode === 'default') await firstView(page, phone)
      // (Off, and kept off: leaving the first view wakes street life, main.ts `leaveLanding`.)
      await page.evaluate(() => { const st = globalThis.engine.street; if (st) { globalThis.__stEnabledDesc = Object.getOwnPropertyDescriptor(st, 'enabled'); st.enabled = false; Object.defineProperty(st, 'enabled', { get: () => false, set() {}, configurable: true }) } globalThis.engine.scale = 0.75; void globalThis.engine.explore.go() })
      const inside = await until(page, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, 90_000)
      check(inside, 'on the roof, the eye behind the body')
      const gate = mode !== 'classic', at = {}
      // (`menu`: the Sky panel open is a menu, which the game-hud rules leave out: what is under it is said, not failed.)
      const look = async (name, what, menu = false, seated = false) => {
        const file = join(shots, `${mode}${reduced ? '-less' : ''}-${name}-${NAMED[size]}.png`)
        await page.screenshot({ path: file })
        const m = await measure(page, safe)
        at[name] = { body: m.body && Object.fromEntries(Object.entries(m.body).map(([k, v]) => [k, Math.round(v)])), over: m.over.map((s) => s.id), unsafe: m.unsafe.map((s) => s.id), state: m.state }
        await drawn(page, m, join(shots, 'boxes', `${mode}${reduced ? '-less' : ''}-${name}-${NAMED[size]}.png`))
        check(!!m.body || seated, `${name}: the body is seen (${what})`, gate)
        check((m.body || seated) && m.over.length === 0, `${name}: nothing over the body${m.over.length ? `: ${[...new Set(m.over.map((s) => s.path || s.id))].join(', ')}` : ''} (${m.seen} things over the picture)`, gate && !menu)
        check(m.clash.length === 0, `${name}: no control on another${m.clash.length ? `: ${m.clash.join(', ')}` : ''}`, gate)
        if (phone) check(m.unsafe.length === 0, `${name}: nothing in the safe area${m.unsafe.length ? `: ${[...new Set(m.unsafe.map((s) => s.path || s.id))].join(', ')}` : ''}`, gate)
      }
      // The wheel is a pie over the middle of the picture (owner, November 24: over the body too, as a game's buy wheel is):
      // whole within the safe area and in its middle, every tool's picture and name inside the disc, and the held tool
      // said once (the tool's key is not shown beside it).
      const pie = async () => {
        const p = await page.evaluate((safe) => {
          const tool = globalThis.engine.tool, seen = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
          const disc = document.querySelector('#realm .wheel .pie').getBoundingClientRect(), r = disc.width / 2, cx = disc.left + r, cy = disc.top + r
          const slots = [...document.querySelectorAll('#realm .wheel .slot')].filter(seen).map((el) => { const b = el.getBoundingClientRect(); return Math.max(...[[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].map(([x, y]) => Math.hypot(x - cx, y - cy))) / r })
          const midX = (safe.left + innerWidth - safe.right) / 2, midY = (safe.top + innerHeight - safe.bottom) / 2
          return { r, off: Math.hypot(cx - midX, cy - midY), within: disc.left >= safe.left - 0.5 && disc.top >= safe.top - 0.5 && disc.right <= innerWidth - safe.right + 0.5 && disc.bottom <= innerHeight - safe.bottom + 0.5, slots, twice: [...document.querySelectorAll('#realm .act .toolkey, #realm .held')].filter((el) => seen(el) && el.textContent.includes(tool)).length }
        }, safe)
        check(p.within && p.off < 2, `the pie (radius ${Math.round(p.r)} px) is whole in the safe area and in its middle (${p.off.toFixed(1)} px off)`)
        check(p.r >= 140, `the pie is large enough to read (radius ${Math.round(p.r)} px)`)
        check(p.slots.length === 8 && p.slots.every((d) => d <= 1.0), `every tool's picture and name is inside the disc (farthest corner ${Math.max(...p.slots).toFixed(2)} of the radius)`)
        // (By touch: on a desk the held key in the corner, the one E opens it from, still says the tool.)
        if (phone) check(p.twice === 0, `the held tool is said once while the wheel is open (${p.twice} keys besides it say it)`)
      }
      // (The body as it is in play: where it arrives the eye stands off from it, until it walks (explore.ts, sf-explore.mjs).)
      await page.evaluate(() => { globalThis.engine.me.standOff = 0 })
      await page.waitForTimeout(3500)
      await look('stand', 'standing on the roof')
      // Riding (#11): a car got into beside the body on the roof, and then the same as a thing that rises (hover: five keys,
      // the most a scheme has). While riding the keys of one on foot are not shown, the thing's own keys are, each a kit key
      // 44 px a side or more that a touch at its middle reaches; by touch the card of the keyboard's keys is not shown; and
      // nothing meets the thing, another control or the safe area (`look`). Seat puts the eye in the seat and back (V on a
      // desk), and Get off sets the body down (E on a desk, which does not open the wheel).
      const ride = async (scheme) => {
        // (On a desk the servers key has the top left corner where a master is known, as on the live site: one stands in for it here.)
        if (!phone) await page.evaluate(() => { const r = document.querySelector('div#realm'); if (r && !r.querySelector('.lobbies')) { const b = Object.assign(document.createElement('button'), { className: 'vx-button lobbies stand-in', type: 'button', textContent: 'Servers' }); r.append(b) } })
        const got = await page.evaluate(async (scheme) => {
          const e = globalThis.engine
          // (Off whatever was ridden before, where getting off failed.)
          if (e.alive.riding) { e.alive.mount(null); await new Promise((r) => setTimeout(r, 500)) }
          for (const t of e.alive.things) if (t.alive) e.alive.vanish(t)
          // (Set down 4 m north of where the body first stood, on the open roof: the same place each time, a little over it.)
          const f = (globalThis.__rideAt ??= e.me.feet.at.map(Math.round)), made = e.car([f[0], f[1] + 5, f[2] - 40])
          const thing = await e.alive.spawn(scheme === 'drive' ? made : { ...made, controls: scheme })
          if (!thing.alive) return false
          e.alive.mount(thing)
          return e.alive.riding === thing
        }, scheme)
        check(got, `${scheme}: a car got into on the roof`)
        if (!got) return
        await page.waitForTimeout(2500)
        await look(`ride-${scheme}`, `riding (${scheme})`)
        const shown = await page.evaluate(() => {
          const seen = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
          const keys = [...document.querySelectorAll('[data-panel="living"] [data-act]')].filter(seen).map((el) => { const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y); return { act: el.dataset.act, w: Math.round(r.width), h: Math.round(r.height), x, y, reached: !!hit && el.contains(hit), kit: el.hasAttribute('data-vx-live') } })
          return { servers: seen(document.querySelector('#realm .lobbies')), keys, afoot: [...document.querySelectorAll('#realm .act :is(.use, .up, .down, .walks, .toolkey), #realm .held')].filter(seen).map((el) => el.className), card: seen(document.querySelector('#card')) }
        })
        check(shown.afoot.length === 0, `${scheme}: the keys of one on foot are not shown while riding${shown.afoot.length ? ` (${shown.afoot.join(', ')})` : ''}`)
        if (phone) {
          const want = scheme === 'hover' ? ['down', 'up', 'roll', 'seat', 'leave'] : ['drift', 'boost', 'horn', 'cam', 'radio', 'leave'], acts = shown.keys.map((k) => k.act)
          check(want.every((a) => acts.includes(a)), `${scheme}: the thing's keys are shown (${acts.join(', ')})`)
          // (Driving, Cam goes round the views, the seat among them, #74/#75: no Seat key of its own.)
          if (scheme === 'drive') check(!acts.includes('seat'), `drive: no Seat key beside Cam (${acts.join(', ')})`)
          const bad = shown.keys.filter((k) => !k.reached || k.w < 44 || k.h < 44)
          check(bad.length === 0, `${scheme}: each of its keys is 44 px a side or more, and a touch at its middle reaches it${bad.length ? `: not ${bad.map((k) => `${k.act} ${k.w}x${k.h}${k.reached ? '' : ' (under something)'}`).join(', ')}` : ''}`)
          check(shown.keys.every((k) => k.kit), `${scheme}: its keys are live Voxelmorphism controls`, gate)
          check(!shown.card, `${scheme}: the card of keyboard keys is not shown by touch`)
          const tap = async (act) => { const k = shown.keys.find((k) => k.act === act); if (k) { await page.touchscreen.tap(k.x, k.y); await page.waitForTimeout(500) } return !!k }
          if (scheme === 'drive') {
            await tap('radio')
            const opened = await until(page, () => document.querySelector('#radio-picker')?.open, 5000)
            check(opened, 'tapping Radio opens the media picker')
            if (opened) await page.locator('#radio-picker .rp-close').tap()
          }
          if (scheme === 'hover') {
            await tap('seat')
            const inSeat = await page.evaluate(() => globalThis.engine.alive.inside)
            await look('ride-seat', 'riding, the eye in the seat', false, true)
            await tap('seat')
            const behind = await page.evaluate(() => !globalThis.engine.alive.inside)
            check(inSeat && behind, `${scheme}: Seat puts the eye in the seat, and again behind (${inSeat}, ${behind})`)
          }
          await tap('leave')
        } else {
          check(shown.keys.length === 0 && shown.card, `${scheme}: on a desk the card says the keys, and no keys are shown`)
          check(shown.servers, `${scheme}: the servers key is shown beside the card (measured against it above)`)
          await page.keyboard.press('KeyV'); await page.waitForTimeout(400)
          const inSeat = await page.evaluate(() => globalThis.engine.alive.inside)
          await page.keyboard.press('KeyV'); await page.waitForTimeout(400)
          check(inSeat && await page.evaluate(() => !globalThis.engine.alive.inside), `${scheme}: V puts the eye in the seat, and again behind`)
          await page.keyboard.press('KeyE')
        }
        const off = await until(page, () => !globalThis.engine.alive.riding, 3000)
        await page.waitForTimeout(600)
        const after = await page.evaluate(() => ({ choosing: globalThis.engine.playHud.choosing, ask: !!document.querySelector('#ask-row')?.checkVisibility({ visibilityProperty: true }), afoot: [...document.querySelectorAll(matchMedia('(pointer: coarse)').matches ? '#realm .act .use' : '#realm .held')].some((el) => el.checkVisibility({ visibilityProperty: true })) }))
        check(off && !after.choosing && after.afoot && after.ask, `${scheme}: ${phone ? 'Get off' : 'E'} sets the body down, the wheel not opened, and the keys of one on foot and the ask bar are back (${JSON.stringify({ off, ...after })})`)
        await page.evaluate(() => { const e = globalThis.engine; for (const t of e.alive.things) if (t.alive) e.alive.vanish(t); document.querySelector('#realm .lobbies.stand-in')?.remove() })
      }
      if (mode === 'default') { await ride('drive'); await ride('hover'); await page.waitForTimeout(1500) }
      if (rideOnly) {
        check(errors.length === 0, `no errors${errors.length ? `: ${errors.slice(0, 2).join(' | ')}` : ''}`)
        results[`${mode}-${size}`] = at
        await page.close()
        continue
      }
      // That the controls are there, where each way has them: a control missing meets nothing, and the measures above would pass.
      const seen = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { on: el.checkVisibility({ visibilityProperty: true, opacityProperty: true }), left: r.left, right: r.right, top: r.top, bottom: r.bottom, wide: r.width, tall: r.height } }, sel)
      if (mode !== 'classic') {
        const keyOf = await seen(phone ? '#realm .toolkey' : '#realm .held'), bank = await seen('#realm .tools')
        if (phone || wheel) check(!!keyOf?.on, `the tool's key is shown (${phone ? 'at the top' : 'in the corner'})`)
        if (!phone && mode === 'context') check(!!bank?.on && bank.tall > bank.wide && bank.right > 1280 - 40, 'the tools stand in a column at the right edge')
        // (The wheel has no bank; quiet's is put away only while the picture holds the pointer, which a check cannot take.)
        if (!phone && wheel) check(!bank?.on, 'the tools\' bank is put away')
        if (phone) check(!!(await seen('#realm .act .use'))?.on && (await seen('#realm .act .use')).right > vw - safe.right - 40, 'Use is in the right corner')
        // By touch, the keys are sized by the touch guidance (game-hud rule 16): 44 px a side or more to hit, and no larger
        // than a key needs (Use 64, the others 48 tall). Main's wheel had Use at 84 and Jump and Fly at 76 by 52.
        if (phone) {
          const sized = await page.evaluate(() => Object.fromEntries(Object.entries({ use: '#realm .act .use', up: '#realm .act .up', walks: '#realm .act .walks', tool: '#realm .toolkey', sky: '#realm .fold', credits: '#first .credits', wand: '[data-panel="wand-take"] button' }).map(([k, sel]) => { const el = document.querySelector(sel), r = el?.getBoundingClientRect(); return [k, r && el.checkVisibility() ? [Math.round(r.width), Math.round(r.height)] : null] })))
          const most = { use: [64, 64], up: [72, 48], walks: [72, 48], tool: [120, 48], sky: [80, 48], credits: [120, 48], wand: [120, 48] }
          const wrong = Object.entries(sized).filter(([k, b]) => b && (b[0] < 44 || b[1] < 44 || b[0] > most[k][0] || b[1] > most[k][1])).map(([k]) => k)
          check(wrong.length === 0 && !!sized.use && !!sized.up && !!sized.walks, `the keys are 44 px a side or more and no larger than they need${wrong.length ? `: not ${wrong.join(', ')}` : ''} (${Object.entries(sized).filter(([, b]) => b).map(([k, b]) => `${k} ${b.join('x')}`).join(', ')})`)
        }
        // The wand: with the wheel it is chosen among the tools and has no key of its own; else its key is a key of the kit
        // as the others are (main's was a dark pill of its own).
        const wandKey = await page.evaluate(() => { const el = document.querySelector('[data-panel="wand-take"] button'); return el && { styled: el.classList.contains('vx-button'), shown: el.checkVisibility(), words: el.textContent.trim() } })
        if (wheel) check(!!wandKey && !wandKey.shown, `with the wheel the wand has no key of its own (${JSON.stringify(wandKey)})`)
        else check(!!wandKey?.styled, `the wand's key is styled in the HUD (${JSON.stringify(wandKey)})`)
        // On desktop a brief [B] Fly cue appears beside the body; on mobile the Fly touch button is already on screen so no redundant floating banner clutters the center.
        const cueShown = await page.evaluate(() => { const c = document.querySelector('#realm .cue[data-cue="fly"]'); return !!c?.classList.contains('on') && c.checkVisibility({ visibilityProperty: true }) })
        if (phone) check(!cueShown, 'on mobile no redundant floating Fly banner clutters the center')
        else check(cueShown, 'on desktop the brief cue to fly is shown beside the body')
        // Credits stays on the first view and inside Settings rather than cluttering gameplay corners.
        const creditsInPlay = await page.evaluate(() => !!document.querySelector('#first .corner')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
        check(!creditsInPlay, 'Credits corner does not clutter active gameplay')
        // No Back key of its own over the picture (#75): Back to the view is in the Settings panel.
        check(await page.evaluate(() => !document.querySelector('#realm .home-key, #realm > button.home')), 'the gameplay HUD has no Back key of its own')
      }
      // The Make bar (#75): opened by its key, it goes away again by its × key, a press on the picture and Escape, each time
      // giving the keys back to the world (no line being typed on) and the keys of play shown again.
      if (wheel) {
        const playing = () => page.evaluate((phone) => ({ open: !!document.querySelector('#ask')?.classList.contains('open'), typing: !globalThis.engine.input.live('moving'), keys: !!document.querySelector(phone ? '#realm .act .use' : '#realm .held')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }), trigger: !!document.querySelector('#ask-row')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }) }), phone)
        const press = async (x, y) => { if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await page.waitForTimeout(400) }
        const at = (sel) => page.evaluate((sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b && b.width ? [b.left + b.width / 2, b.top + b.height / 2] : null }, sel)
        const tool = await page.evaluate(() => globalThis.engine.tool)
        for (const how of ['×', 'a press on the picture', 'Escape']) {
          const k = await at('#ask-row')
          if (k) await press(...k)
          const opened = await playing()
          const close = await at('#ask-close')
          if (how === '×' && close) await press(...close)
          else if (how === 'Escape') { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }
          else await press(vw / 2, vh * 0.3)
          const after = await playing(), still = await page.evaluate(() => ({ tool: globalThis.engine.tool, riding: !!globalThis.engine.alive.riding, choosing: globalThis.engine.playHud.choosing }))
          check(opened.open && opened.typing && (!phone || !opened.keys) && !!close && !after.open && !after.typing && after.keys && after.trigger && still.tool === tool && !still.riding && !still.choosing, `the Make bar opens and ${how} puts it away, the keys of play back (${JSON.stringify({ opened, after })})`)
          if (how === '×') await look('ask-closed', 'the Make bar put away')
        }
        if (!phone) await page.evaluate(() => document.exitPointerLock())
      }
      // Choosing a tool: E (by touch the tool's key) as a person would; the default has its bank.
      if (mode !== 'classic') {
        const before = await page.evaluate(() => globalThis.engine.tool)
        if (phone) {
          const k = await page.evaluate(() => { const r = document.querySelector('#realm .toolkey')?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2] })
          check(!!k, 'the tool\'s key is there to press')
          if (k) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: k[0], y: k[1] }] }); await page.waitForTimeout(350) }
          await look('choose', 'the tool\'s key down', wheel)
          if (wheel) await pie()
          if (k) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        } else {
          await page.keyboard.down('KeyE'); await page.waitForTimeout(350)
          await look('choose', 'E held', wheel)
          if (wheel) await pie()
          // (Held on, the key repeats: a repeat is not another press, and the wheel stays open to aim.)
          if (wheel) { await page.keyboard.down('KeyE'); await page.waitForTimeout(100); check(await page.evaluate(() => globalThis.engine.playHud.choosing), 'E held until it repeats keeps the wheel open') }
        }
        // (Read while E is still held: letting it go is a choice, below.)
        const after = await page.evaluate(() => ({ tool: globalThis.engine.wand?.held ? 'Wand' : globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing, slots: [...document.querySelectorAll('#realm .wheel .slot')].filter((s) => s.checkVisibility()).length }))
        if (!phone) await page.keyboard.up('KeyE')
        if (wheel) check(after.choosing && after.slots === 8, `the wheel is open with its 7 tools and the wand (${after.slots} seen)`)
        else check(after.tool !== before, `the next tool is taken (${before} to ${after.tool})`)
        await page.waitForTimeout(200)
        // The ways to choose on a desk, each read back: let go of E after holding it, a tap and the arrows, Tab and Enter.
        if (wheel && !phone) {
          const now = () => page.evaluate(() => ({ tool: globalThis.engine.wand?.held ? 'Wand' : globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
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
          const aimed = await slot((heldAt + 3) % 8); await page.mouse.move(aimed.x, aimed.y, { steps: 4 }); await page.waitForTimeout(250)
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
          const keyed = await page.evaluate(() => ({ choosing: globalThis.engine.playHud.choosing, tool: globalThis.engine.wand?.held ? 'Wand' : globalThis.engine.tool, back: document.activeElement?.classList.contains('held') }))
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
        // By touch (wheel): a slide from the tool's key onto a wedge picks where it is let go; a tap leaves it open for a tap
        // on a wedge, and a tap away from the disc puts it away as it was.
        if (wheel && phone) {
          const now = () => page.evaluate(() => ({ tool: globalThis.engine.wand?.held ? 'Wand' : globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
          const slot = (i) => page.evaluate((i) => { const el = document.querySelectorAll('#realm .wheel .slot')[i], r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: el.textContent.replace(/^\d+/, '').trim() } }, i)
          await page.evaluate(() => globalThis.engine.playHud.choose(false))
          const k = await page.evaluate(() => { const r = document.querySelector('#realm .toolkey').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: k[0], y: k[1] }] }); await page.waitForTimeout(150)
          const to = await slot(4)
          for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: k[0] + ((to.x - k[0]) * i) / 8, y: k[1] + ((to.y - k[1]) * i) / 8 }] }); await page.waitForTimeout(30) }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(200)
          check(!(await now()).choosing && (await now()).tool === to.name, `a slide onto ${to.name} and let go picks it (${(await now()).tool})`)
          await page.touchscreen.tap(k[0], k[1]); await page.waitForTimeout(200)
          const tapped = (await now()).choosing, six = await slot(5)
          await page.touchscreen.tap(six.x, six.y); await page.waitForTimeout(200)
          check(tapped && !(await now()).choosing && (await now()).tool === six.name, `a tap opens it and a tap on ${six.name} picks it (${(await now()).tool})`)
          // A tap away from the disc: in the bottom left corner, where the left thumb steers.
          await page.touchscreen.tap(k[0], k[1]); await page.waitForTimeout(200)
          const away = (await now()).choosing
          await page.touchscreen.tap(safe.left + 30, vh - safe.bottom - 30); await page.waitForTimeout(200)
          check(away && !(await now()).choosing && (await now()).tool === six.name, `a tap away from the disc puts it away as it was (${(await now()).tool})`)
        }
        // The wand is the wheel's last choice: chosen, it is in hand, the tool's key says so, and its bar is not over the
        // body; another choice puts it away.
        if (wheel) {
          await page.evaluate(() => globalThis.engine.playHud.choose(false))
          const pickAt = async (i) => {
            if (phone) {
              const k = await page.evaluate(() => { const r = document.querySelector('#realm .toolkey').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
              await page.touchscreen.tap(k[0], k[1]); await page.waitForTimeout(200)
              const at = await page.evaluate((i) => { const r = document.querySelectorAll('#realm .wheel .slot')[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }, i)
              await page.touchscreen.tap(at[0], at[1])
            } else { await page.keyboard.press('KeyE'); await page.keyboard.press(`Digit${i + 1}`) }
            await page.waitForTimeout(300)
          }
          await pickAt(7)
          const inHand = await page.evaluate(() => ({ held: globalThis.engine.wand.held, says: document.querySelector(matchMedia('(pointer: coarse)').matches ? '#realm .toolkey' : '#realm .held')?.textContent.trim() }))
          await look('wand', 'the wand in hand')
          await pickAt(0)
          const away = await page.evaluate(() => ({ held: globalThis.engine.wand.held, tool: globalThis.engine.wand?.held ? 'Wand' : globalThis.engine.tool }))
          check(inHand.held && /Wand/.test(inHand.says) && !away.held && away.tool === 'Hammer', `the wand is chosen from the wheel (${inHand.says}), and choosing a tool puts it away (${away.tool})`)
        }
        await page.evaluate(() => globalThis.engine.playHud.choose(false))
      }
      // On a desk, in play: the picture holds the pointer (a click on it takes it, as sf-explore checks). What each way puts away then, and the wheel picked by the mouse's direction and by a click.
      if (!phone && mode !== 'classic') {
        await page.mouse.move(640, 200); await page.mouse.click(640, 200); await page.waitForTimeout(400)
        const locked = await page.evaluate(() => globalThis.engine.input.locked)
        check(locked, 'a click on the picture takes the pointer')
        if (locked) {
          await page.waitForTimeout(600)
          await look('play', 'in play, the pointer held')
          const shown = await page.evaluate(() => Object.fromEntries(Object.entries({ sky: '#realm .fold', ask: '#ask', held: '#realm .held', bank: '#realm .tools' }).map(([k, sel]) => [k, !!document.querySelector(sel)?.checkVisibility({ visibilityProperty: true, opacityProperty: true })])))
          if (wheel) check(!shown.sky && !shown.ask && shown.held, `in play secondary chrome and collapsed ask pill step away while the tool pill stays (${JSON.stringify(shown)})`)
          if (mode === 'quiet') check(!shown.sky && !shown.ask && !shown.bank, `in play everything is put away (${JSON.stringify(shown)})`)
          if (mode === 'context') check(shown.sky && shown.bank, `in play nothing hides itself (${JSON.stringify(shown)})`)
          if (wheel) {
            const tools = await page.evaluate(() => [...document.querySelectorAll('#realm .wheel .slot')].map((el) => el.textContent.replace(/^\d+/, '').trim()))
            // Held E, the mouse moved right: the tool to the right of the ring (third, Big charge, at about -13 degrees); let go, it is taken.
            await page.evaluate(() => globalThis.engine.pickTool(0)); await page.waitForTimeout(100)
            await page.keyboard.down('KeyE'); await page.waitForTimeout(120)
            await page.mouse.move(820, 200, { steps: 6 }); await page.waitForTimeout(150)
            await page.keyboard.up('KeyE'); await page.waitForTimeout(150)
            const right = await page.evaluate(() => ({ tool: globalThis.engine.wand?.held ? 'Wand' : globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
            check(!right.choosing && right.tool === tools[2], `held E and the mouse moved right picks ${tools[2]} (${right.tool})`)
            // A tap of E, the mouse moved up, a click: the top tool.
            await page.keyboard.press('KeyE'); await page.waitForTimeout(120)
            await page.mouse.move(820, 20, { steps: 6 }); await page.waitForTimeout(150)
            await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(150)
            const up = await page.evaluate(() => ({ tool: globalThis.engine.wand?.held ? 'Wand' : globalThis.engine.tool, choosing: globalThis.engine.playHud.choosing }))
            check(!up.choosing && up.tool === tools[0], `a tap of E, the mouse moved up and a click picks ${tools[0]} (${up.tool})`)
          }
          await page.evaluate(() => document.exitPointerLock()); await page.waitForTimeout(600)
          if (mode !== 'context') check(await page.evaluate(() => !!document.querySelector('#realm .fold')?.checkVisibility({ opacityProperty: true })), 'the pointer let go, the corner controls come back')
        }
      }
      // A phone, mid-move: a thumb down on the body (the stick must not be drawn there), then in the corner.
      if (phone) {
        const b = await page.evaluate(() => globalThis.engine.playHud.body())
        // In the corner: the lowest place in the left half where the stick's well (62 px round the thumb) is clear of the body by 40 px, as it walks and bobs.
        const clear = await page.evaluate(({ safe }) => {
          const parts = globalThis.engine.playHud.parts(), r = 62, meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
          for (let y = innerHeight - safe.bottom - r; y > innerHeight / 3; y -= 8) for (let x = safe.left + r + 8; x < innerWidth / 2; x += 8) { const w = { left: x - r - 40, top: y - r - 40, right: x + r + 40, bottom: y + r + 40 }; if (!parts.some((p) => meets(w, p))) return [x, y] }
          return null
        }, { safe })
        check(!!clear, `there is room for the stick in the left half, clear of the body${clear ? ` (at ${clear.map(Math.round).join(', ')})` : ''}`, gate)
        // And where the left thumb rests, low in the picture: main's eye, close behind the shoulder, left room only above the body (at 70, 348 of 844).
        check(!!clear && clear[1] >= vh * 0.6, `the body stands clear of where the left thumb rests: the stick has room in the lower part of the picture${clear ? ` (${Math.round((clear[1] / vh) * 100)}% down)` : ''}`, gate)
        // (Clear of the body first: a thumb moving walks the body, and the place found was for where it stood.)
        for (const [name, x, y] of [['move', ...(clear ?? [80, 720])], ['move-body', (b.left + b.right) / 2, (b.top + b.bottom) / 2]]) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
          // (Back, a walk: the roof's edge is a few metres ahead, and a fall is another picture.)
          for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i, y: y + i * 3 }] }); await page.waitForTimeout(40) }
          await page.waitForTimeout(250)
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
      // The Sky panel (the page with no switch), after the fall and the canopy (what the line hears is said over the picture a while): the line to say something to the city on, opened by its Say key (a phone
      // has no Enter or slash), and the graphics presets, kept in this browser.
      if (mode === 'default') {
        const press = async (sel) => { const r = await page.evaluate((sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b && b.width > 0 ? [b.left + b.width / 2, b.top + b.height / 2] : null }, sel); if (!r) return false; if (phone) await page.touchscreen.tap(r[0], r[1]); else await page.mouse.click(r[0], r[1]); await page.waitForTimeout(400); return true }
        const opened = await press('#realm .fold')
        await look('sky', 'the Sky panel open', true)
        const laid = await panelLaid(page)
        check(laid.parts.join() === 'world,gfx,res,acts' && laid.meet.length === 0 && laid.out.length === 0, `in play the Settings panel is in its sections (${laid.parts.join(', ')}), ${laid.controls} controls, none on another${laid.meet.length ? `: ${laid.meet.join('; ')}` : ''}${laid.out.length ? `, outside: ${laid.out.join(', ')}` : ''}`)
        const keys = await page.evaluate(() => ({
          say: !!document.querySelector('#realm .sky .say')?.checkVisibility(),
          graphics: [...document.querySelectorAll('#realm .sky input[name=realm-graphics]')].map((el) => el.value),
          chosen: document.querySelector('#realm .sky input[name=realm-graphics]:checked')?.value,
          rates: [...document.querySelectorAll('#realm .sky .rates label')].map((el) => el.textContent.trim()),
        }))
        check(opened && keys.say && keys.graphics.join() === 'low,medium,high' && keys.chosen === 'high', `the Sky panel has a Say key and the graphics, High chosen (${JSON.stringify(keys)})`)
        // Graphics presets change shadows/mirrors only and never change resolution (scale or dynamic resolution state).
        const beforeLow = await page.evaluate(() => ({ scale: globalThis.engine.scale, res: globalThis.engine.graphics.resolution }))
        await press('#realm .sky label:has(input[value=low])')
        const set = await page.evaluate(() => { const e = globalThis.engine; let kept = null; try { kept = localStorage.getItem('village.graphics') } catch {} return { preset: e.graphics.preset, scale: e.scale, pinned: e.graphics.pinned, res: e.graphics.resolution, flags: e.flags, kept } })
        check(set.preset === 'low' && set.scale === beforeLow.scale && set.res.auto === beforeLow.res.auto && (set.flags & 3) === 0 && set.kept === 'low', `Low is chosen by a press: shadows and mirrors off, resolution untouched, written to storage (${JSON.stringify(set)})`)
        await press('#realm .sky label:has(input[value=high])')
        const high = await page.evaluate(() => ({ preset: globalThis.engine.graphics.preset, scale: globalThis.engine.scale, res: globalThis.engine.graphics.resolution, flags: globalThis.engine.flags }))
        check(high.preset === 'high' && high.scale === beforeLow.scale && high.res.auto === beforeLow.res.auto && (high.flags & 3) === 3, `High again: shadows and mirrors back, resolution untouched (${JSON.stringify(high)})`)
        // Dynamic resolution On/Off: On shows Target FPS toggles (clearly labeled FPS) and hides the slider; Off shows the slider and hides Target FPS.
        await press('#realm .sky label.res-auto')
        const dynOn = await page.evaluate(() => ({
          res: globalThis.engine.graphics.resolution,
          fpsShown: !!document.querySelector('#realm .sky .res-fps')?.checkVisibility(),
          sliderShown: !!document.querySelector('#realm .sky .res-manual')?.checkVisibility(),
          rates: [...document.querySelectorAll('#realm .sky .rates label')].map((el) => el.textContent.trim()),
        }))
        check(dynOn.res.auto && dynOn.fpsShown && !dynOn.sliderShown && dynOn.rates.some((t) => /FPS/.test(t)), `Dynamic resolution On shows Target FPS toggles and hides the resolution slider (${JSON.stringify(dynOn)})`)
        await press('#realm .sky .rates label:has(input[value="30"])')
        const fps30 = await page.evaluate(() => ({ res: globalThis.engine.graphics.resolution, preset: globalThis.engine.graphics.preset }))
        check(fps30.res.auto && fps30.res.target === 30 && fps30.preset === 'high', `Target FPS 30 selected without changing graphics preset (${JSON.stringify(fps30)})`)
        await press('#realm .sky label.res-auto')
        const dynOff = await page.evaluate(() => ({
          res: globalThis.engine.graphics.resolution,
          fpsShown: !!document.querySelector('#realm .sky .res-fps')?.checkVisibility(),
          sliderShown: !!document.querySelector('#realm .sky .res-manual')?.checkVisibility(),
        }))
        check(!dynOff.res.auto && !dynOff.fpsShown && dynOff.sliderShown, `Dynamic resolution Off hides Target FPS and shows the resolution slider (${JSON.stringify(dynOff)})`)
        // (Pinned again for the pictures that follow, as at the start.)
        await page.evaluate(() => { globalThis.engine.scale = 0.75; try { localStorage.removeItem('village.resolution') } catch {} })
        // Say: the line opens with the focus in it (a phone's keyboard comes up for that), stays, and takes what is typed.
        await press('#realm .sky .say')
        const line = await page.evaluate(() => { const f = document.querySelector('#realm .egg-line input'); return { open: !!f?.closest('.egg-line')?.checkVisibility(), focused: document.activeElement === f, folded: !document.querySelector('#realm .sky')?.checkVisibility() } })
        await look('say', 'the line to say something on')
        await page.keyboard.type('iddqd'); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
        const heard = await page.evaluate(() => globalThis.engine.eggs.state)
        check(line.open && line.focused && (!phone || line.folded) && heard.shield && !heard.typing, `the Say key opens the line with the focus in it${phone ? ' and the panel folded' : ''}, and what is typed is heard (${JSON.stringify({ ...line, shield: heard.shield })})`)
        await page.evaluate(() => globalThis.engine.eggs.undo())
        if (!phone) await page.evaluate(() => globalThis.engine.realmControls.fold(true))
      }
      // Back to the view, by touch: from the Settings panel (the HUD has no key of its own for it, #75). One tap on the gear
      // and one on Back go back, and the first view has its credits key (the wheel had put it away in play, play-hud.ts `away`).
      if (mode === 'default' && phone) {
        const at = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel), r = el?.getBoundingClientRect(); return el && r && r.width && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) ? [r.left + r.width / 2, r.top + r.height / 2] : null }, sel)
        const gear = await at('#realm .fold')
        if (gear) { await page.touchscreen.tap(...gear); await page.waitForTimeout(500) }
        const key = await at('#realm .sky .home')
        check(!!key, 'by touch the Settings panel has Back to the view')
        if (key) {
          await page.touchscreen.tap(...key)
          const backed = await until(page, () => !globalThis.engine.first.engaged && document.documentElement.classList.contains('first') && globalThis.engine.explore.state !== 'leaving', 20_000)
          const after = await page.evaluate(() => ({ credits: !!document.querySelector('#first .credits')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }), state: globalThis.engine.explore.state }))
          check(backed && after.credits, `Back to the view in the panel goes back to the view, the credits key there (${JSON.stringify(after)})`)
        }
      }
      // Desktop E prompt vs tool wheel (#75): beside a stopped live traffic car, the prompt binds F (not E), avoids
      // overlapping the player's body, KeyE still opens the radial wheel, and disabling street life clears the cue.
      if (mode === 'default' && size === 'wide') {
        const reEnabled = await page.evaluate(async () => {
          const e = globalThis.engine, st = e.street
          if (!st || !globalThis.__stEnabledDesc) return { skipped: true }
          Object.defineProperty(st, 'enabled', globalThis.__stEnabledDesc)
          st.enabled = true
          // Move down to a street (Taylor St) and wait for a traffic car to stop beside the player (via triggerStuck).
          const x = 515900, z = 663000
          e.me.walk(false)
          Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + 1.8, pitch: -0.08 })
          e.me.walk(true)
          for (let i = 0; i < 40 && !st.ready; i++) await new Promise((r) => setTimeout(r, 150))
          await new Promise((r) => setTimeout(r, 1200))
          const stuck = st.robotaxis.triggerStuck('intersection') || st.robotaxis.triggerStuck('narrow')
          if (!stuck) return { skipped: false, ok: false, why: 'no stopped traffic car spawned' }
          // Stand 1.8 m beside the stopped traffic car (closer than 2.8 m offer reach, on foot, facing it).
          const sx = stuck.x + Math.cos(stuck.heading + Math.PI / 2) * 18
          const sz = stuck.z + Math.sin(stuck.heading + Math.PI / 2) * 18
          e.me.walk(false)
          Object.assign(e.pose, { x: sx / 10, z: sz / 10, y: e.ground(sx / 10, sz / 10) + 1.8, yaw: Math.atan2(-(stuck.x - sx), stuck.z - sz), pitch: -0.05 })
          e.me.walk(true)
          let cueText = ''
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 100))
            const p = document.querySelector('#over > #cues p:not([hidden])')
            if (p?.textContent?.includes('Take the')) { cueText = p.textContent.trim(); break }
          }
          return { skipped: false, ok: !!cueText, cueText }
        })
        if (!reEnabled.skipped) {
          check(reEnabled.ok && reEnabled.cueText.startsWith('F  Take the '), `stopped nearby traffic car prompts F instead of stealing E (${JSON.stringify(reEnabled)})`)
          const m = await measure(page, safe)
          const cueOver = m.over.filter((s) => s.path.includes('cues'))
          check(cueOver.length === 0, `traffic car cue does not overlap the body (${cueOver.length})`)
          await page.keyboard.press('KeyE')
          await page.waitForTimeout(200)
          const afterE = await page.evaluate(() => ({ choosing: globalThis.engine.playHud.choosing, riding: !!globalThis.engine.alive.riding, cueHidden: [...document.querySelectorAll('#over > #cues p')].every((p) => !p.checkVisibility({ visibilityProperty: true, opacityProperty: true })) }))
          check(afterE.choosing && !afterE.riding && afterE.cueHidden, `beside a stopped traffic car, E opens the radial tool wheel and hides world cues (${JSON.stringify(afterE)})`)
          await page.keyboard.press('Escape')
          await page.waitForTimeout(150)
          await page.evaluate(() => { globalThis.engine.street.enabled = false })
          await page.waitForTimeout(150)
          const afterDisable = await page.evaluate(() => document.querySelectorAll('#over > #cues p').length)
          check(afterDisable === 0, `disabling street life clears any active traffic cue (${afterDisable})`)
        }
      }
      // A preset and resolution setting chosen are there again when the page is opened again (once: a load is long), and an address's ?shadows=0 is kept over it.
      if (mode === 'default' && size === 'wide') {
        await page.evaluate(() => { globalThis.engine.graphics.preset = 'high'; globalThis.engine.graphics.resolution = { auto: false, scale: 0.6 } })
        await page.goto(`${site.url}/sf/index.html?shadows=0`)
        await page.waitForFunction(() => globalThis.engine?.graphics, null, { timeout: 300_000 })
        const again = await page.evaluate(() => ({ preset: globalThis.engine.graphics.preset, scale: globalThis.engine.scale, res: globalThis.engine.graphics.resolution, flags: globalThis.engine.flags }))
        check(again.preset === 'high' && again.scale === 0.6 && !again.res.auto && (again.flags & 3) === 2, `opened again, the page has High and manual 0.6 resolution as chosen, and the address's ?shadows=0 over it (${JSON.stringify(again)})`)
        await page.evaluate(() => { globalThis.engine.graphics.preset = 'high'; globalThis.engine.graphics.resolution = { auto: true, target: 60 }; try { localStorage.removeItem('village.graphics'); localStorage.removeItem('village.resolution') } catch {} })
      }
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
if (said.length) console.log(`\nmeasured and said, not failed (the classic controls, and the Sky panel open, a menu):\n${said.map((f) => `  - ${f}`).join('\n')}`)
console.log(failures.length ? `\nsf-hud: ${failures.length} failed\n${failures.map((f) => `  - ${f}`).join('\n')}` : '\nsf-hud: passed')
process.exit(failures.length ? 1 : 0)
