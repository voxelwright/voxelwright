// The landing's easter eggs in the San Francisco realm (#450, page/eggs.ts), from the static folder, in Chrome with
// WebGPU. Sound is refused by a simulated browser rule (Playwright's evaluate counts as a press, so a real refusal
// cannot be had in a check): the egg plays muted, and Unmute, a real click, brings the sound.
//
//   node test/sf-eggs.mjs [--no-build] [--things | --first] [--shots ~/.village/engine/sf/eggs] [--headed]
//
// `--first`: only the eggs from the first view (page/eggs-first.ts), nobody gone in: the banner's lines and the
// towers' lamps, each started and stopped by a real tap at 390 x 844 and a click at 1440 x 900, the visitor never
// engaged, and EXPLORE still going in on its two asks after them; where each spot is at 844 x 390 too. Pictures and a
// phone clip in `first/`.
//
// For each egg: its trigger as a visitor makes it (keys typed, the line, a tool used), what it does to the picture
// (read from the canvas: the windows, the sky, the moon, against the picture before), that it is undone (Esc, a
// phrase, reset) and the sky comes back, and the frame gaps while it runs, beside the same sky without the window
// screen (what the screen itself costs). A video's windows are checked against the frame held on them: the light of
// the windows follows the picture's light and dark. Its sound: refused (simulated: it plays muted, and Unmute brings
// it), and decoded when a typed line started it.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, timed, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { TOWERS } from './sf-towers.mjs'

const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'eggs'))
const round = (n, to = 2) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
  console.log(built.stdout.trim())
}
mkdirSync(shots, { recursive: true })
const site = await plain(join(here, 'dist-sf'), '127.0.0.1')
const back = await turn()
// The browser's rule for sound as a visitor's browser has it: no sound until the page has had a press or a tap.
const browser = await chromium.launch({ ...CHROME, args: [...CHROME.args, '--autoplay-policy=document-user-activation-required'] })
const results = {}

/** A page of the realm, up with the world round the park whole. */
const open = async (context) => {
  const page = await context.newPage()
  // A browser's refusal of sound, simulated: Playwright's evaluate counts as a press, so a check's page always may
  // play sound. While `refuseSound` is set, an unmuted video's play() is refused as a browser refuses it.
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () { return globalThis.refuseSound && !this.muted && this.src ? Promise.reject(new DOMException('refused (simulated)', 'NotAllowedError')) : play.call(this) }
  })
  page.errors = []
  page.said = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => { page.said.push(m.text()); if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) page.errors.push(m.text()) })
  await page.goto(`${site.url}/sf/index.html`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.eggs, null, { timeout: 180_000 })
  // The visitor has engaged (first.ts): the realm's controls, which the eggs' line and player join, are shown.
  await page.evaluate(() => { globalThis.engine.scale = 1; globalThis.engine.first?.engage() })
  return page
}
const settle = (page) => page.waitForFunction(() => { const e = globalThis.engine, s = e.world.stats; return s.wanted === 0 && s.stale === 0 && e.march.sun.undrawn === 0 }, null, { timeout: 60_000, polling: 250 }).catch(() => null)
/** Until the sky has come round to what was asked (the hour's glide, the weather's change, the fog's front) and the screen is all the way up or down. */
const still = async (page) => {
  await page.waitForFunction(() => { const e = globalThis.engine; return !e.realmControls.sky.moving && [0, 1].includes(e.march.screen.up) }, null, { timeout: 40_000, polling: 200 }).catch(() => null)
  await settle(page)
  await page.waitForTimeout(600)
}
const state = (page) => page.evaluate(() => ({ ...globalThis.engine.eggs.state, status: document.querySelector('.egg-status')?.textContent, hour: globalThis.engine.hour, weather: globalThis.engine.realmControls.sky.weather, signs: Object.fromEntries(globalThis.engine.signs.list().map((s) => [s.id, s.own || !s.content ? null : 'text' in s.content ? s.content.text : 'video' in s.content ? 'video' : 'image'])) }))
/**
 * Until the banner's plane has brought what an egg says into the picture (boards.ts `plane.call`): the cloth's middle
 * and both its ends in front of the eye and inside the canvas. Resolves with how long that took, ms, and where it is.
 */
const bannerSeen = (page, ms = 12_000) => page.evaluate(async (ms) => {
  const e = globalThis.engine, p = e.boards?.plane, rect = document.querySelector('canvas').getBoundingClientRect(), from = performance.now()
  if (!p) return { seen: false, why: 'no plane' }
  const on = (c) => { const v = e.view(), d = [c[0] - v.eye[0], c[1] - v.eye[1], c[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]; return far > 1 && { x: (d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (rect.width / rect.height) * far), y: (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far), far } }
  for (;;) {
    const c = p.cloth, pts = [-1, 0, 1].map((k) => on([c.at[0] + c.hu[0] * k, c.at[1] + c.hu[1] * k, c.at[2] + c.hu[2] * k]))
    if (pts.every((q) => q && Math.abs(q.x) < 1 && Math.abs(q.y) < 1)) return { seen: true, ms: Math.round(performance.now() - from), metres: Math.round(pts[1].far / 10), x: Math.round(((pts[1].x + 1) / 2) * rect.width), y: Math.round(((1 - pts[1].y) / 2) * rect.height), called: p.called }
    if (performance.now() - from > ms) return { seen: false, ms, called: p.called, phase: p.phase }
    await new Promise((r) => requestAnimationFrame(r))
  }
}, ms)
/** Until an egg is running (a picture or a video is fetched when it starts). */
const started = (page, egg) => page.waitForFunction((egg) => globalThis.engine.eggs.state.running === egg, egg, { timeout: 30_000 }).catch(() => null)
/** Says something on the line, as a visitor does: Enter, the words, Enter. */
const sayTo = async (page, words) => { await page.keyboard.press('Enter'); await page.keyboard.type(words, { delay: 25 }); await page.keyboard.press('Enter') }

/** The canvas as a grid of 64 x 36 cells, each its mean linear-ish rgb (0 to 255); saved as a picture too. */
const grid = async (page, name) => {
  const png = await page.locator('canvas').first().screenshot(name ? { path: join(shots, `${name}.png`) } : {})
  return page.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, img.width, img.height).data, W = 64, H = 36, out = new Float32Array(W * H * 3), n = new Float32Array(W * H)
    for (let y = 0; y < img.height; y++) for (let x0 = 0; x0 < img.width; x0++) {
      const i = (y * img.width + x0) * 4, k = Math.floor((y * H) / img.height) * W + Math.floor((x0 * W) / img.width)
      out[k * 3] += d[i]; out[k * 3 + 1] += d[i + 1]; out[k * 3 + 2] += d[i + 2]; n[k]++
    }
    for (let k = 0; k < W * H; k++) for (let c3 = 0; c3 < 3; c3++) out[k * 3 + c3] /= n[k]
    return [...out]
  }, `data:image/png;base64,${png.toString('base64')}`)
}
/** Cells of a grid in a box of the view (fractions: left, top, right, bottom): the city below the sky, clear of the controls. */
const CITY = [0.03, 0.2, 0.72, 0.85], SKY = [0.03, 0.02, 0.72, 0.12]
const cells = (g, [l, t, r, b]) => { const out = []; for (let y = Math.floor(t * 36); y < Math.ceil(b * 36); y++) for (let x = Math.floor(l * 64); x < Math.ceil(r * 64); x++) out.push([g[(y * 64 + x) * 3], g[(y * 64 + x) * 3 + 1], g[(y * 64 + x) * 3 + 2], x, y]); return out }
const mean = (cs, f) => cs.reduce((s, c) => s + f(c), 0) / cs.length
const light = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
const corr = (a, b) => { const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2 } return ab / Math.sqrt(aa * bb || 1) }

/**
 * The green of each tower's box in the picture now (sf-towers.mjs TOWERS: `towers`), read in the page, since carrying a
 * whole picture out of it takes over a second. Pixels under a sign are -1. A picture of the towers is one screenshot of
 * the box that holds them all.
 */
const greens = async (page, towers) => {
  const boxes = { ...towers.landmarks, ...towers.ordinary }, all = Object.values(boxes), size = page.viewportSize()
  const clip = { x: Math.max(0, Math.min(...all.map((b) => b.x0)) - 2), y: Math.max(0, Math.min(...all.map((b) => b.y0)) - 2) }
  clip.width = Math.min(size.width, Math.max(...all.map((b) => b.x1)) + 2) - clip.x; clip.height = Math.min(size.height, Math.max(...all.map((b) => b.y1)) + 2) - clip.y
  const png = await page.screenshot({ clip })
  return page.evaluate(async ({ b64, boxes, signs, clip }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d')
    g.drawImage(bitmap, 0, 0)
    const px = g.getImageData(0, 0, bitmap.width, bitmap.height).data, out = {}
    for (const [k, b] of Object.entries(boxes)) {
      const list = []
      for (let y = Math.max(0, b.y0 - clip.y); y < Math.min(bitmap.height, b.y1 - clip.y); y++) for (let x = Math.max(0, b.x0 - clip.x); x < Math.min(bitmap.width, b.x1 - clip.x); x++) {
        list.push(signs.some((s) => x >= s.x0 - clip.x && x < s.x1 - clip.x && y >= s.y0 - clip.y && y < s.y1 - clip.y) ? -1 : px[(y * bitmap.width + x) * 4 + 1])
      }
      out[k] = list
    }
    return out
  }, { b64: png.toString('base64'), boxes, signs: towers.signs, clip })
}

/** Frame gaps for a few seconds: p50 and p99, ms, with the march's own GPU time. */
const frames = async (page, seconds = 4) => {
  const w = await page.evaluate(async (ms) => { const e = globalThis.engine, gaps = []; const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ms)); stop(); return { gaps, gpuMs: e.gpuMs } }, seconds * 1000)
  const g = w.gaps.filter((x) => x >= 2).sort((a, b) => a - b), q = (p) => round(g[Math.min(g.length - 1, Math.floor(g.length * p))], 1)
  return { frames: g.length, p50: q(0.5), p99: q(0.99), marchMs: round(w.gpuMs, 1) }
}
/**
 * What an egg costs: the frames with it up, against the same sky with the window screen down (the picture still drawn, the
 * windows not asking it). Three rounds of one then the other, and the mean gap over each three: another lane's check
 * drawing on this GPU slows whichever one it lands on (the median gap is a step of the display's 16.7 ms and jumped
 * between them). A miss is measured again with every turn on the GPU held (kit.mjs `timed`).
 */
const cost = (page, name, what) => timed({
  check,
  idle: (on) => page.evaluate((on) => { globalThis.engine.resting = on }, on),
  measure: async () => {
    const ROUNDS = 3, SECONDS = 2, on = [], off = []
    for (let round = 0; round < ROUNDS; round++) {
      on.push(await frames(page, SECONDS))
      await page.evaluate(() => { const e = globalThis.engine; e.eggsKeep = e.watch(() => { e.march.screen.up = 0 }) })
      await page.waitForTimeout(500)
      off.push(await frames(page, SECONDS))
      await page.evaluate(() => { globalThis.engine.eggsKeep(); delete globalThis.engine.eggsKeep })
      // (The screen comes back up over a second.)
      await page.waitForTimeout(1200)
    }
    const gap = (list) => round((ROUNDS * SECONDS * 1000) / list.reduce((sum, f) => sum + f.frames, 0), 1)
    results[name] = { ...(results[name] ?? {}), frames: on, sameSkyNoScreen: off }
    return { with: gap(on), without: gap(off) }
  },
  // Only a gross cost fails (the screen is a texel read per window pixel).
  passes: (r) => r.with <= r.without * 1.25 + 2,
  say: (r) => `${what} costs no more than a quarter more than its sky without the screen: mean frame gap ${r.with} ms with it, ${r.without} ms without`,
})

/**
 * Each thing that starts an egg (page/eggs-things.ts), found as a visitor finds it: the body set down on its feet a step
 * in front of it, facing it; its cue comes (hud.ts), and a tap on it (a phone, a real touch) or a click (a desk) starts
 * the egg. A picture of the thing as found, cue and all, and of its egg running, in `things/`. The cue is measured: a
 * thumb's size on a phone, and over none of the body's parts (play-hud.ts `parts`).
 */
const THINGS = {
  payphone: { egg: (s) => s.running === 'matrix', again: (s) => s.running === null, then: 'hangs up', shot: 'city' },
  jukebox: { egg: (s) => s.running === 'rickroll' && s.playing && !s.muted && s.sound > 0, again: (s) => s.running === null, then: 'stops it', shot: 'city' },
  cart: { egg: (s) => s.running === 'apple', again: (s) => s.running === null, then: 'puts it back', shot: 'city' },
  arcade: { egg: (s) => s.signs.banner === '+30 lives', shot: 'banner' },
  viewer: { egg: (s) => s.hour > 23, again: (s) => s.moon === 1, then: 'brings the moon closer', shot: 'moon' },
  plane: { egg: (s) => s.spin > 0.2, shot: 'now' },
  shield: { egg: (s) => s.shield && s.signs.banner === 'God mode', again: (s) => !s.shield, then: 'lets go', shot: 'banner' },
}
const things = async (page, kind) => {
  const dir = join(shots, 'things'), touch = kind === 'phone'
  mkdirSync(dir, { recursive: true })
  // The lens of play (explore.ts LENS): the realm's own is the first view's long one, which the way in opens.
  await page.evaluate(() => { globalThis.engine.fov = innerHeight > innerWidth ? 80 : 58 })
  const at = await page.evaluate(() => globalThis.engine.eggs.things.list)
  check(at.length === Object.keys(THINGS).length, `${at.length} things stand in the city: ${at.map((t) => t.id).join(', ')}`)
  // (The cue the thing offers, by its words: a car's or a ride's may be up too.) `by`: a tap or click on it, or E.
  const tapCue = async (id, by = touch ? 'tap' : 'click') => {
    const cue = await page.evaluate((id) => {
      const words = globalThis.engine.eggs.things.words, el = [...document.querySelectorAll('#cues p.tap')].find((p) => !p.hidden && p.textContent === words), r = el?.getBoundingClientRect()
      if (!r) return null
      const x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y)
      return { x, y, w: r.width, h: r.height, text: el.textContent, onTop: top === el, over: top === el ? null : `${top?.tagName}.${top?.className}`, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, parts: globalThis.engine.playHud?.parts?.() ?? [], near: globalThis.engine.eggs.things.near === id }
    }, id)
    if (!cue) return null
    if (by === 'tap') await page.touchscreen.tap(cue.x, cue.y)
    else if (by === 'click') await page.mouse.click(cue.x, cue.y)
    else await page.keyboard.press('e')
    return cue
  }
  const thingState = () => page.evaluate(() => ({ ...globalThis.engine.eggs.state, spin: globalThis.engine.eggs.things.spin, hour: globalThis.engine.realmControls.sky.hour, banner: globalThis.realm.signs.list().find((x) => x.id === 'banner')?.content?.text ?? null, signs: Object.fromEntries(globalThis.engine.signs.list().map((s) => [s.id, s.own || !s.content ? null : 'text' in s.content ? s.content.text : null])) }))
  for (const t of at) {
    const want = THINGS[t.id]
    // Down on the feet a step from it, off to one side of its front (so that the body is not between the eye and it),
    // the thing a little right of where the body looks: the eye up over the place, then the body let fall there.
    const stand = async () => {
      await page.evaluate((t) => {
        const e = globalThis.engine, f = ((t.facing + (t.behind ? 180 : 0) - 55) * Math.PI) / 180, away = Math.max(t.size[0], t.size[2]) / 2 + 16
        const x = t.at[0] + Math.sin(f) * away, z = t.at[2] - Math.cos(f) * away
        if (e.me.on) e.me.walk(false)
        Object.assign(e.pose, { x: x / 10, y: (t.at[1] + 40) / 10, z: z / 10, yaw: f + Math.PI - 0.3, pitch: -0.12 })
      }, t)
      await settle(page)
      await page.evaluate(() => globalThis.engine.me.walk(true))
      const near = await page.waitForFunction((id) => globalThis.engine.me.feet && globalThis.engine.eggs.things.near === id && [...document.querySelectorAll('#cues p.tap')].some((p) => !p.hidden), t.id, { timeout: 20_000 }).then(() => true, () => false)
      // (Until the eye behind the body has come all the way out, and what an egg before said has gone.)
      await page.waitForFunction(() => { const b = globalThis.engine.me.back, w = globalThis.backWas ?? -1; globalThis.backWas = b; return b > 0 && Math.abs(b - w) < 0.05 && ![...document.querySelectorAll('#notices > *')].some((n) => n.checkVisibility()) }, null, { timeout: 9000, polling: 400 }).catch(() => null)
      await settle(page)
      await page.waitForTimeout(400)
      return near
    }
    const near = await stand()
    await page.screenshot({ path: join(dir, `${kind}-${t.id}-found.png`) })
    if (!near) { check(false, `${t.id}: found on foot, its cue comes (${JSON.stringify(await page.evaluate(() => ({ feet: globalThis.engine.me.feet?.at, near: globalThis.engine.eggs.things.near, list: globalThis.engine.eggs.things.list })))})`); continue }
    const before = await thingState()
    // (On a desk the arcade is played with E, the key a thing beside takes.)
    const by = touch ? 'tap' : t.id === 'arcade' ? 'E' : 'click'
    const cue = await tapCue(t.id, by)
    check(cue?.near, `${t.id}: the cue is the ${t.id}'s`)
    check(cue?.onTop, `${t.id}: its cue "${cue?.text}" is on top where it is ${touch ? 'tapped' : 'clicked'}${cue?.onTop ? '' : ` (under ${cue?.over} at ${cue && Math.round(cue.x)}, ${cue && Math.round(cue.y)})`}`)
    const meets = (cue?.parts ?? []).filter((p) => cue.box.left < p.right && cue.box.right > p.left && cue.box.top < p.bottom && cue.box.bottom > p.top)
    if (touch) check(cue && cue.h >= 43.5 && cue.w >= 43.5, `${t.id}: its cue is a thumb's size, ${cue && Math.round(cue.w)} x ${cue && Math.round(cue.h)} px (asked: 44 at least)`)
    check(meets.length === 0, `${t.id}: its cue is over none of the body's ${cue?.parts.length ?? 0} parts`)
    const started = await page.waitForFunction((code) => { const s = { ...globalThis.engine.eggs.state, spin: globalThis.engine.eggs.things.spin, hour: globalThis.engine.realmControls.sky.hour, signs: { banner: globalThis.realm.signs.list().find((x) => x.id === 'banner')?.content?.text ?? null } }; return new Function('s', `return (${code})(s)`)(s) }, want.egg.toString(), { timeout: 30_000, polling: 50 }).then(() => true, () => false)
    const s = await thingState()
    check(started, `${t.id}: ${by === 'E' ? 'E' : by === 'tap' ? 'a tap' : 'a click'} on "${cue?.text}" starts its egg (${JSON.stringify({ running: s.running, shield: s.shield, moon: s.moon, hour: s.hour && round(s.hour), spin: round(s.spin), banner: s.signs.banner, playing: s.playing, muted: s.muted, sound: s.sound, before: before.running })})`)
    // The egg as it shows: on the city's windows (the eye over the thing, looking at downtown), at the moon, on the
    // banner its plane brings, or the barrel roll itself as it turns.
    if (want.shot === 'now') await page.waitForTimeout(150)
    else {
      if (want.shot !== 'banner') await still(page)
      await page.evaluate((t) => {
        const e = globalThis.engine, [x, y, z] = e.march.sun.s
        e.me.walk(false)
        Object.assign(e.pose, { x: t.at[0] / 10, y: (t.at[1] + 30) / 10, z: t.at[2] / 10 }, t.shot === 'moon' ? { yaw: Math.atan2(x, -z), pitch: Math.asin(y / Math.hypot(x, y, z)) } : { yaw: 2.1, pitch: -0.02 })
      }, { ...t, shot: want.shot })
      await page.waitForTimeout(800)
      await settle(page)
      if (want.shot === 'banner') check((await bannerSeen(page)).seen, `${t.id}: what it says comes into the picture on the banner`)
    }
    await page.screenshot({ path: join(dir, `${kind}-${t.id}-running.png`) })
    if (want.shot !== 'now') await stand()
    if (want.again) {
      await page.waitForFunction(() => [...document.querySelectorAll('#cues p.tap')].some((p) => !p.hidden), null, { timeout: 5000 }).catch(() => null)
      const second = await tapCue(t.id)
      const ok = await page.waitForFunction((code) => { const s = globalThis.engine.eggs.state; return new Function('s', `return (${code})(s)`)(s) }, want.again.toString(), { timeout: 15_000, polling: 50 }).then(() => true, () => false)
      check(ok, `${t.id}: used again ("${second?.text}") it ${want.then}${ok ? '' : ` (${JSON.stringify({ onTop: second?.onTop, over: second?.over, at: second && [Math.round(second.x), Math.round(second.y)], near: second?.near, state: await page.evaluate(() => globalThis.engine.eggs.state) })})`}`)
    }
    // On a desk, the shield by the aim: the eye 4 m before it looking at its middle, and the Use key (a click held by the picture).
    if (!touch && t.id === 'shield') {
      const on = await page.evaluate(async (t) => {
        const e = globalThis.engine, f = (t.facing * Math.PI) / 180, x = t.at[0] + Math.sin(f) * 40, z = t.at[2] - Math.cos(f) * 40, y = t.at[1] + t.size[1] / 2
        e.me.walk(false)
        Object.assign(e.pose, { x: x / 10, y: y / 10, z: z / 10, yaw: f + Math.PI, pitch: 0 })
        await new Promise((r) => setTimeout(r, 300))
        e.input.use()
        return e.eggs.state.shield
      }, t)
      check(on, 'shield: the Use key with the aim on it starts IDDQD')
    }
    await page.evaluate(() => globalThis.engine.eggs.undo(true))
    await still(page)
  }
  if (await page.evaluate(() => globalThis.engine.me.on)) await page.evaluate(() => globalThis.engine.me.walk(false))
}


// ── From the first view (`--first`, page/eggs-first.ts) ──
/** A page of the realm at its first view, nobody gone in: the world round the park whole, the eggs and the way in come. */
const openFirst = async (context) => {
  const page = await context.newPage()
  // Which event each play() of a video is called inside: a phone's browser gives sound only to one started in the tap's own handler.
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    globalThis.playedIn = []
    // (And a browser that holds the sound back, simulated while `refuseSound` is set, as `open` does.)
    HTMLMediaElement.prototype.play = function () { globalThis.playedIn.push(globalThis.event?.type ?? null); return globalThis.refuseSound && !this.muted && this.src ? Promise.reject(new DOMException('refused (simulated)', 'NotAllowedError')) : play.call(this) }
  })
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) page.errors.push(m.text()) })
  await page.goto(`${site.url}/sf/index.html`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.eggs?.first && globalThis.engine.explore && globalThis.engine.boards?.where('explore'), null, { timeout: 180_000 })
  await settle(page)
  return page
}
/** What the first view is now: still the first view, the eye, the spots, the eggs. */
const firstLook = (page) => page.evaluate(() => {
  const e = globalThis.engine, b = globalThis.realm.signs.list().find((x) => x.id === 'banner')
  return { engaged: e.first.engaged, html: document.documentElement.classList.contains('first'), way: e.explore.state, eye: [e.pose.x, e.pose.y, e.pose.z], yaw: e.pose.yaw, spin: e.eggs.things.spin, spots: e.eggs.first.spots, eggs: e.eggs.state, banner: b?.own ? null : b?.content?.text ?? null, called: e.boards.plane.called, loud: e.boards.plane.loud, readable: e.boards.plane.readable }
})
/** How far the eye turns about the vertical over some time, radians, frame by frame (a whole roll is 2π; a roll undone by another setting the eye adds nothing). */
const watchTurn = (page) => page.evaluate(() => { const g = globalThis; g.turnTotal = 0; g.turnOn = true; let last = g.engine.pose.yaw; const step = () => { const y = g.engine.pose.yaw; g.turnTotal += y - last; last = y; if (g.turnOn) requestAnimationFrame(step) }; requestAnimationFrame(step); return last })
/** What `watchTurn` has added up after `ms` more, and it stops. */
const turned = async (page, ms) => { await page.waitForTimeout(ms); return page.evaluate(() => { globalThis.turnOn = false; return globalThis.turnTotal }) }
/** The boards' targets on the page (boards.ts `under`: a face grown, by 20 px all round under a thumb). */
const boardBoxes = (page, touch) => page.evaluate((touch) => globalThis.engine.boards.records.map((r) => { const w = globalThis.engine.boards.where(r.id), g = touch ? 20 : 6; return w && { id: r.id, x0: w.x - w.wide / 2 - g, y0: w.y - w.high / 2 - g, x1: w.x + w.wide / 2 + g, y1: w.y + w.high / 2 + g } }).filter(Boolean), touch)
/** How far apart two boxes are, px (0 where they meet). */
const apart = (a, b) => Math.round(Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1)))
const boxOf = (s) => ({ x0: s.x - s.w / 2, y0: s.y - s.h / 2, x1: s.x + s.w / 2, y1: s.y + s.h / 2 })
const firstSizes = [['desk', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true], ['landscape', { width: 844, height: 390 }, true]]

const fromFirst = async () => {
  const dir = join(shots, 'first')
  mkdirSync(dir, { recursive: true })
  results.first = {}
  for (const [kind, viewport, touch] of firstSizes) {
    console.log(`\nfrom the first view, ${kind} ${viewport.width} x ${viewport.height} (${touch ? 'taps' : 'clicks'})`)
    const page = await openFirst(await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch }))
    const press = (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y))
    const r = (results.first[kind] = { spots: {}, eggs: {} })
    /** Until the banner's cloth is whole in the picture and can be read (on a wide picture its own round crosses the left edge). */
    const bannerIn = () => page.waitForFunction(() => { const s = globalThis.engine.eggs.first.spots.banner; return !!s && s.x - s.w / 2 >= 0 && s.x + s.w / 2 <= innerWidth && s.y - s.h / 2 >= 0 && globalThis.engine.boards.plane.readable }, null, { timeout: 40_000, polling: 100 }).catch(() => null)
    await bannerIn()
    const began = await firstLook(page)
    const boards = await boardBoxes(page, touch)
    for (const id of ['banner', 'pyramid', 'crown']) {
      const s = began.spots[id]
      if (!s) { check(false, `${kind}: ${id} is on the picture`); continue }
      const nearest = boards.map((b) => ({ id: b.id, gap: apart(boxOf(s), b) })).sort((a, b) => a.gap - b.gap)[0]
      r.spots[id] = { ...s, nearest }
      check(s.x > 0 && s.x < viewport.width && s.y > 0 && s.y < viewport.height && (!touch || (s.w >= 44 && s.h >= 44)) && nearest.gap > 0, `${kind}: the ${id} at ${s.x}, ${s.y}, its target ${s.w} x ${s.h} px${touch ? ' (asked: 44 at least)' : ''}, ${nearest.gap} px from the nearest board's (${nearest.id})`)
    }
    check(began.spots.lamps && !began.engaged && began.called, `${kind}: the lamps are lit, the visitor not in, the banner's plane called`)
    // (The picture with the lamps steady, as under reduced motion: blinking, a picture may catch them between flashes.)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.screenshot({ path: join(dir, `${kind}-first.png`) })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    if (kind === 'landscape') {
      // Turned wide, a video's player stands clear of the spots and the boards too.
      const s = began.spots.pyramid
      await press(s.x, s.y)
      await page.waitForFunction(() => globalThis.engine.eggs.state.playing, null, { timeout: 30_000 }).catch(() => null)
      await page.waitForTimeout(1500)
      const p = await page.evaluate(() => { const p = document.querySelector('.egg-player').getBoundingClientRect(), s = globalThis.engine.eggs.first.spots, b = globalThis.engine.boards, over = (q) => q && p.left < q.x1 && p.right > q.x0 && p.top < q.y1 && p.bottom > q.y0
        return { box: [p.left, p.top, p.right, p.bottom].map(Math.round), under: [...['banner', 'pyramid', 'crown'].filter((id) => s[id] && over({ x0: s[id].x - s[id].w / 2, x1: s[id].x + s[id].w / 2, y0: s[id].y - s[id].h / 2, y1: s[id].y + s[id].h / 2 })), ...b.records.filter((r) => { const w = b.where(r.id); return w && over({ x0: w.x - w.wide / 2, x1: w.x + w.wide / 2, y0: w.y - w.high / 2, y1: w.y + w.high / 2 }) }).map((r) => r.id)], running: globalThis.engine.eggs.state.running } })
      check(p.running === 'apple' && !p.under.length, `${kind}: the Pyramid's lamp tapped starts Bad Apple!!, and its player at ${p.box.join(' ')} is over ${p.under.join(', ') || 'no spot and no board'}`)
      await page.screenshot({ path: join(dir, `${kind}-pyramid-apple.png`) })
      const t = (await firstLook(page)).spots.pyramid
      await press(t.x, t.y)
      await page.waitForTimeout(500)
      check((await firstLook(page)).eggs.running === null, `${kind}: the lamp tapped again ends it`)
      await page.close()
      continue
    }
    if (!touch) {
      // On a desk the pointer over a spot is a hand, and a lamp under it brightens; over a board, the board's.
      const hovered = []
      for (const id of ['pyramid', 'crown', 'banner']) {
        if (id === 'banner') await bannerIn()
        const s = (await firstLook(page)).spots[id]
        await page.mouse.move(s.x, s.y)
        await page.waitForTimeout(100)
        hovered.push(await page.evaluate((id) => ({ id, cursor: document.querySelector('canvas').style.cursor, hot: !!document.querySelector('#egg-lamps i.hot'), wave: globalThis.engine.boards.plane.cloth.wave }), id))
      }
      await page.mouse.move(viewport.width - 40, viewport.height - 40)
      await page.waitForTimeout(100)
      const off = await page.evaluate(() => ({ cursor: document.querySelector('canvas').style.cursor, hot: !!document.querySelector('#egg-lamps i.hot'), wave: globalThis.engine.boards.plane.cloth.wave }))
      check(hovered.every((h) => h.cursor === 'pointer' && (h.id === 'banner' ? h.wave > 5 : h.hot)) && off.cursor !== 'pointer' && !off.hot && off.wave === 5, `${kind}: the pointer over each spot is a hand and it answers (a lamp brightens, the banner waves): ${hovered.map((h) => `${h.id} ${h.cursor} ${h.id === 'banner' ? `wave ${h.wave}` : `hot ${h.hot}`}`).join('; ')}; away, ${off.cursor || 'the default'}`)
    }

    /** A spot tapped or clicked where it is now; then what the first view is. */
    const hit = async (id, wait = 600) => {
      if (id === 'banner') await bannerIn()
      const s = (await firstLook(page)).spots[id]
      if (!s) return null
      await press(s.x, s.y)
      await page.waitForTimeout(wait)
      return firstLook(page)
    }
    /** Still the first view: nobody in, the way in as it was, the eye where it was. */
    const stillFirst = (l, what) => check(l && !l.engaged && l.html && (l.way === 'idle') && Math.hypot(l.eye[0] - began.eye[0], l.eye[1] - began.eye[1], l.eye[2] - began.eye[2]) < 0.01, `${kind}: ${what}, and it is still the first view (engaged ${l?.engaged}, the way in ${l?.way}, the eye where it was)`)
    const until = (fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false)

    // The site's name (no line on the banner): a barrel roll, back where it began.
    const named = () => until(() => !globalThis.engine.eggs.first.spots.line, null, 20_000)
    await named()
    await bannerIn()
    await watchTurn(page)
    let l = await hit('banner', 0)
    // (Half way round, the eye looks away from the park's picture: what it shows there.)
    await page.waitForTimeout(380)
    await page.screenshot({ path: join(dir, `${kind}-roll-mid.png`) })
    const round1 = await turned(page, 1000)
    check(Math.abs(round1 - 2 * Math.PI) < 0.05, `${kind}: a ${touch ? 'tap' : 'click'} on the site's name turns the eye round once (${round(round1, 3)} rad)`)
    l = await firstLook(page)
    stillFirst(l, `the roll ends facing as it began (${round(((l.yaw - began.yaw) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) % (2 * Math.PI - 1e-6), 3)} rad off)`)
    check(Math.abs(Math.sin((l.yaw - began.yaw) / 2)) < 0.01 && l.spin === 0, `${kind}: the eye is turned round whole`)

    // The crown: the Matrix, and again out of it.
    l = await hit('crown')
    const matrix = await until(() => globalThis.engine.eggs.state.running === 'matrix', null)
    check(matrix, `${kind}: the Salesforce crown's lamp starts the Matrix`)
    await still(page)
    l = await firstLook(page)
    stillFirst(l, `the Matrix is on (banner "${l.banner}")`)
    await page.screenshot({ path: join(dir, `${kind}-crown-matrix.png`) })
    l = await hit('crown')
    check(l && l.eggs.running === null && l.called, `${kind}: the crown again ends it, and the plane is still called (${l?.called})`)
    await still(page)

    // The Pyramid: Bad Apple!!, its sound from the tap; the lamp again, the lights back.
    await page.evaluate(() => { globalThis.playedIn = [] })
    l = await hit('pyramid')
    const apple = await until(() => globalThis.engine.eggs.state.running === 'apple' && globalThis.engine.eggs.state.playing, null)
    await page.waitForTimeout(1500)
    l = await firstLook(page)
    const inClick = await page.evaluate(() => globalThis.playedIn)
    check(apple && !l.eggs.muted && l.eggs.sound > 0 && inClick[0] === 'click', `${kind}: the Pyramid's lamp starts Bad Apple!! with its sound, its video first played inside the ${touch ? 'tap' : 'click'}'s own handler (plays called in: ${inClick.join(', ')}; muted ${l.eggs.muted}, ${l.eggs.sound} bytes of sound decoded)`)
    stillFirst(l, 'Bad Apple!! is on')
    const lampFree = await page.evaluate(() => { const s = globalThis.engine.eggs.first.spots.pyramid, top = s && document.elementFromPoint(s.x, s.y); return top?.tagName === 'CANVAS' })
    check(lampFree, `${kind}: nothing lies over the Pyramid's lamp while it plays (the player stands clear of it)`)
    await still(page)
    await page.screenshot({ path: join(dir, `${kind}-pyramid-apple.png`) })
    l = await hit('pyramid')
    check(l && l.eggs.running === null && l.called, `${kind}: the Pyramid's lamp again ends it, the plane still in the picture`)
    await still(page)

    // The banner's lines, each in its turn: tapped, its egg; and the banner (or the player's Stop) ends it.
    const wants = { 'Wake up, Neo…': 'matrix', 'Never gonna…': 'rickroll', 'Barrel roll!': 'roll', 'Bad Apple!!': 'apple' }
    for (let i = 0; i < 4; i++) {
      const came = await until(() => { const e = globalThis.engine, s = e.eggs.first.spots, p = e.boards.plane; return !!s.line && p.readable && (!p.loud || p.come >= 1) }, null, 60_000)
      l = await firstLook(page)
      const line = l.spots.line, egg = wants[line]
      check(came && egg && l.banner === line, `${kind}: the banner says "${line}" (its cloth ${l.spots.banner?.w} x ${l.spots.banner?.h} px at ${l.spots.banner?.x}, ${l.spots.banner?.y}; the plane ${l.loud ? 'called in' : 'on its own round'})`)
      if (!came || !egg) break
      r.eggs[egg] = { line, cloth: l.spots.banner, loud: l.loud }
      await page.screenshot({ path: join(dir, `${kind}-line-${egg}.png`) })
      await page.evaluate(() => { globalThis.playedIn = [] })
      await watchTurn(page)
      l = await hit('banner', 0)
      if (egg === 'roll') {
        const t = await turned(page, 1400)
        check(Math.abs(t - 2 * Math.PI) < 0.05, `${kind}: "${line}" ${touch ? 'tapped' : 'clicked'} turns the eye round once (${round(t, 3)} rad)`)
        continue
      }
      await turned(page, 0)
      const on = await until((egg) => globalThis.engine.eggs.state.running === egg, egg)
      check(on, `${kind}: "${line}" ${touch ? 'tapped' : 'clicked'} starts ${egg}`)
      if (egg !== 'matrix') {
        // The player: in the first view, on top where it is, a thumb's size by touch, and the sound playing from the tap.
        await until(() => globalThis.engine.eggs.state.playing, null, 20_000)
        await page.waitForTimeout(1500)
        const player = await page.evaluate(() => {
          const keys = [...document.querySelectorAll('.egg-player button')].map((b) => { const q = b.getBoundingClientRect(), top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { text: b.textContent, x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2), w: Math.round(q.width), h: Math.round(q.height), onTop: top === b } })
          const c = document.querySelector('#first .credits').getBoundingClientRect(), p = document.querySelector('.egg-player').getBoundingClientRect()
          // (Nor over a spot that ends it, or a board.)
          const s = globalThis.engine.eggs.first.spots, b = globalThis.engine.boards, over = (q) => q && p.left < q.x1 && p.right > q.x0 && p.top < q.y1 && p.bottom > q.y0
          const under = [...['banner', 'pyramid', 'crown'].filter((id) => s[id] && over({ x0: s[id].x - s[id].w / 2, x1: s[id].x + s[id].w / 2, y0: s[id].y - s[id].h / 2, y1: s[id].y + s[id].h / 2 })), ...b.records.filter((r) => { const w = b.where(r.id); return w && over({ x0: w.x - w.wide / 2, x1: w.x + w.wide / 2, y0: w.y - w.high / 2, y1: w.y + w.high / 2 }) }).map((r) => r.id)]
          return { keys, under, shown: !document.querySelector('.egg-player').hidden, box: [p.left, p.top, p.right, p.bottom].map(Math.round), credits: [c.left, c.top, c.right, c.bottom].map(Math.round), meets: [c, ...[document.querySelector('#realm > .fold')].filter((g) => g?.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })).map((g) => g.getBoundingClientRect())].some((c) => p.left < c.right && p.right > c.left && p.top < c.bottom && p.bottom > c.top), ...globalThis.engine.eggs.state }
        })
        r.eggs[egg].player = player
        check(player.shown && player.keys.every((k) => k.onTop && (!touch || k.h >= 44)) && !player.meets && !player.under.length, `${kind}: its player is shown in the first view at ${player.box.join(' ')}, clear of the credits and settings keys${player.under.length ? ` but over ${player.under.join(', ')}` : ', the spots and the boards'}, its keys on top${touch ? ' and a thumb tall' : ''}: ${player.keys.map((k) => `${k.text} ${k.w} x ${k.h} at ${k.x}, ${k.y}`).join('; ')}`)
        const played = await page.evaluate(() => globalThis.playedIn)
        check(player.playing && !player.muted && player.sound > 0 && played[0] === 'click', `${kind}: ${egg} plays with its sound, its video first played inside the ${touch ? 'tap' : 'click'}'s own handler (plays called in: ${played.join(', ')}; muted ${player.muted}, ${player.sound} bytes of sound decoded; Chrome, not Safari)`)
        await page.screenshot({ path: join(dir, `${kind}-${egg}.png`) })
        if (egg === 'apple') {
          const stop = player.keys.find((k) => k.text === 'Stop')
          await press(stop.x, stop.y)
          await page.waitForTimeout(500)
          l = await firstLook(page)
          check(l.eggs.running === null, `${kind}: Stop on the player ${touch ? 'tapped' : 'clicked'} ends ${egg}`)
          stillFirst(l, `after ${egg}`)
          await still(page)
          continue
        }
      } else {
        await still(page)
        await page.screenshot({ path: join(dir, `${kind}-line-matrix-on.png`) })
      }
      l = await hit('banner')
      check(l && l.eggs.running === null && l.called, `${kind}: the banner ${touch ? 'tapped' : 'clicked'} again ends ${egg}, its plane still called`)
      stillFirst(l, `after ${egg}`)
      await still(page)
    }

    // EXPLORE asked once, then the crown: the ask is put back and the Matrix starts; the crown again ends it.
    const w = await page.evaluate(() => globalThis.engine.boards.where('explore'))
    await press(w.x, w.y)
    await page.waitForTimeout(400)
    const asked = await page.evaluate(() => globalThis.engine.explore.state)
    l = await hit('crown')
    const calmed = await until(() => globalThis.engine.eggs.state.running === 'matrix', null)
    l = await firstLook(page)
    check(asked === 'armed' && calmed && l.way === 'idle' && !l.engaged, `${kind}: EXPLORE asked once (${asked}), then the crown: the ask is put back (${l.way}) and the Matrix starts${touch ? '' : ' (on a desk the pointer going to the crown puts it back first, explore.ts away)'}`)
    await hit('crown')
    await still(page)
    // EXPLORE asked once and let go of, then the site's name while its eye leans back: the roll waits for it, and the eye comes round whole.
    await named()
    await bannerIn()
    // (The eye as the ask finds it: the rolls before have each turned it a whole turn on from where it began.)
    const asking = await page.evaluate(() => globalThis.engine.pose.yaw)
    await press(w.x, w.y)
    await page.waitForTimeout(400)
    await page.evaluate(() => globalThis.engine.explore.disarm())
    await page.waitForTimeout(250)
    const s = (await firstLook(page)).spots.banner
    // (Measured from the eye as the ask left it: its lean back is turned too, a little, and the roll on top of it.)
    const from = await watchTurn(page)
    await press(s.x, s.y)
    const leant = await turned(page, 3500)
    l = await firstLook(page)
    const net = leant + from - asking
    check(Math.abs(net - 2 * Math.PI) < 0.05 && l.way === 'idle', `${kind}: a barrel roll asked while the eye leans back from EXPLORE turns it round once all the same (${round(net, 3)} rad from where the ask found it)`)

    // Sound held back by the browser: the Pyramid's lamp plays it muted, and Unmute on the player, in the first view, is the tap that brings it.
    await page.evaluate(() => { globalThis.refuseSound = true })
    await hit('pyramid')
    const muted = await until(() => globalThis.engine.eggs.state.blocked && globalThis.engine.eggs.state.playing, null)
    const unmute = await page.evaluate(() => { const b = [...document.querySelectorAll('.egg-player button')].find((k) => k.textContent === 'Unmute'), q = b?.getBoundingClientRect(); return q && { x: q.left + q.width / 2, y: q.top + q.height / 2, w: Math.round(q.width), h: Math.round(q.height), onTop: document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2) === b } })
    await page.evaluate(() => { globalThis.refuseSound = false })
    if (unmute) await press(unmute.x, unmute.y)
    const sounded = await until(() => { const s = globalThis.engine.eggs.state; return !s.muted && s.playing && s.sound > 0 }, null, 10_000)
    check(muted && unmute?.onTop && (!touch || unmute.h >= 44) && sounded, `${kind}: with the sound held back the lamp plays Bad Apple!! muted, and Unmute (${unmute ? `${unmute.w} x ${unmute.h}, on top ${unmute.onTop}` : 'not shown'}) ${touch ? 'tapped' : 'clicked'} in the first view brings the sound`)
    await page.screenshot({ path: join(dir, `${kind}-unmuted.png`) })

    // And the way in, after it all, with the video still playing: EXPLORE asked twice goes, and the player is then where the realm lays it, clear of its controls.
    await press(w.x, w.y)
    await page.waitForTimeout(450)
    const armed = await page.evaluate(() => globalThis.engine.explore.state)
    await press(w.x, w.y)
    const went = await until(() => ['going', 'in'].includes(globalThis.engine.explore.state), null, 5000)
    check(armed === 'armed' && went, `${kind}: after the eggs EXPLORE is asked once (${armed}) and again goes in`)
    await page.waitForTimeout(800)
    l = await firstLook(page)
    check(!l.spots.lamps && !l.spots.still, `${kind}: on the way in the lamps are out and the first view's spots are off`)
    const playerIn = () => page.evaluate(() => {
      const p = document.querySelector('.egg-player'), r = p.getBoundingClientRect(), stop = p.querySelector('.stop').getBoundingClientRect()
      // (The thumbs' keys, the tools, the keys in the top corners (credits, settings, Back) and the street's name.)
      const parts = [...document.querySelectorAll('#realm .thumbs, #realm .tools, #realm .toolkey, #realm .held, #realm .home-key, #realm > .fold, #first .credits, #where')].filter((el) => el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })).map((el) => ({ name: el.className, q: el.getBoundingClientRect() }))
      const meets = parts.filter(({ q }) => q.width && r.left < q.right - 1 && r.right > q.left + 1 && r.top < q.bottom - 1 && r.bottom > q.top + 1).map((x) => x.name)
      return { box: [r.left, r.top, r.right, r.bottom].map(Math.round), meets, stopOnTop: !!document.elementFromPoint(stop.left + stop.width / 2, stop.top + stop.height / 2)?.closest('.stop'), running: globalThis.engine.eggs.state.running }
    })
    const inside = await until(() => globalThis.engine.first.engaged, null, 60_000)
    await page.waitForTimeout(1500)
    const inRealm = await playerIn()
    check(inside && inRealm.running === 'apple' && inRealm.stopOnTop && !inRealm.meets.length, `${kind}: gone in with Bad Apple!! playing, its player at ${inRealm.box.join(' ')} is over ${inRealm.meets.join(', ') || "none of the realm's controls"}, Stop on top ${inRealm.stopOnTop}`)
    await page.screenshot({ path: join(dir, `${kind}-in-with-player.png`) })
    if (touch) {
      // Turned wide once in, the same.
      await page.setViewportSize({ width: 844, height: 390 })
      await page.waitForTimeout(1500)
      const wide = await playerIn()
      check(wide.running === 'apple' && wide.stopOnTop && !wide.meets.length, `${kind}: turned wide in the realm, its player at ${wide.box.join(' ')} is over ${wide.meets.join(', ') || "none of the realm's controls"}, Stop on top ${wide.stopOnTop}`)
      await page.screenshot({ path: join(dir, `${kind}-in-wide-with-player.png`) })
    }
    check(page.errors.length === 0, `${kind}: no errors on the page${page.errors.length ? `: ${page.errors.slice(0, 3).join(' | ')}` : ''}`)
    await page.close()
  }

  // A short clip on a phone: the banner's first line tapped (the Matrix), the banner tapped to end it, the Pyramid's lamp (Bad Apple!!), the lamp again.
  if (!has('no-clip')) {
    const clips = join(dir, 'clip')
    mkdirSync(clips, { recursive: true })
    const opened = Date.now()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, recordVideo: { dir: clips, size: { width: 390, height: 844 } } })
    const page = await openFirst(context)
    const tapAt = async (id) => { const s = await page.evaluate((id) => globalThis.engine.eggs.first.spots[id], id); if (s) await page.touchscreen.tap(s.x, s.y) }
    await page.waitForFunction(() => { const p = globalThis.engine.boards.plane; return !!globalThis.engine.eggs.first.spots.line && p.readable && (!p.loud || p.come >= 1) }, null, { timeout: 120_000, polling: 100 }).catch(() => null)
    // (The recording began with the page: the clip is from two seconds before the line was readable.)
    const from = Math.max(0, (Date.now() - opened) / 1000 - 2)
    await page.waitForTimeout(1000)
    await tapAt('banner'); await page.waitForTimeout(6000)
    await tapAt('banner'); await page.waitForTimeout(4000)
    await tapAt('pyramid'); await page.waitForTimeout(7000)
    await tapAt('pyramid'); await page.waitForTimeout(4000)
    const video = page.video()
    await context.close()
    const out = join(clips, 'first-phone.mp4')
    const raw = await video.path()
    const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', from.toFixed(1), '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', out])
    if (made.status === 0) { rmSync(raw, { force: true }); console.log(`  clip: ${out}`) } else console.log(`  clip: not cut (ffmpeg ${made.error?.message ?? made.status}); the recording is ${raw}`)
  }
}

try {
  if (has('first')) await fromFirst()
  else {
  // (`--things`: only the things in the city, on a phone and a desk.)
  if (!has('things')) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await open(context)
  check(page.said.some((t) => t.includes('General Kenobi') && t.includes('not hiring')), 'the console greets: Hello there, General Kenobi, the ASCII park and the resume line')
  await settle(page)
  const before = await grid(page, 'before')
  const day = await frames(page)
  results.arrival = { frames: day }
  console.log(`  arrival frames: ${JSON.stringify(day)}`)

  // ── Sound is the visitor's to start: an egg started with no press plays muted, and Unmute is the press ──
  console.log('\nsound refused (simulated)')
  await page.evaluate(() => { globalThis.refuseSound = true; globalThis.engine.eggs.say('bad apple') })
  /** Until the video really plays (its clock past a third of a second) or its sound was refused, or it ended. */
  const begun = () => page.waitForFunction(() => { const s = globalThis.engine.eggs.state; return s.blocked || s.time > 0.3 || !s.running }, null, { timeout: 30_000 }).catch(() => null)
  await begun()
  await page.waitForFunction(() => globalThis.engine.eggs.state.time > 0.3, null, { timeout: 10_000 }).catch(() => null)
  let s = await state(page)
  const player = () => page.evaluate(() => { const p = document.querySelector('.egg-player'), r = p.getBoundingClientRect(), m = globalThis.engine.eggs.media; return { hidden: p.hidden, display: getComputedStyle(p).display, box: [r.x, r.y, r.width, r.height].map(Math.round), media: m && { paused: m.paused, ended: m.ended, error: m.error?.code ?? null, src: !!m.src } } })
  check(s.running === 'apple' && s.time > 0 && s.muted && s.blocked, `refused its sound, Bad Apple!! plays muted (${JSON.stringify({ running: s.running, time: round(s.time), muted: s.muted, blocked: s.blocked, status: s.status })})`)
  if (!(s.muted && s.blocked)) console.log('   ', JSON.stringify(await player()), page.said.slice(-6).join(' | '))
  check(await page.locator('.egg-player .mute').textContent() === 'Unmute', 'the player offers Unmute')
  try {
    await page.evaluate(() => { globalThis.refuseSound = false })
    await page.click('.egg-player .mute', { timeout: 5000 })
    await page.waitForTimeout(2500)
    s = await state(page)
    check(s.playing && !s.muted && s.sound > 0, `Unmute (a press) brings the sound: playing, unmuted, ${s.sound} bytes of sound decoded`)
    await page.click('.egg-player .stop', { timeout: 5000 })
    await page.waitForTimeout(300)
    check((await state(page)).running === null, 'Stop on the player ends it')
  } catch (e) {
    check(false, `the player's keys: ${String(e.message).split('\n')[0]} ${JSON.stringify(await player())}`)
    await page.evaluate(() => globalThis.engine.eggs.undo(true))
  }
  await still(page)

  // ── The Matrix, from the line: the banner shows what is typed; code rain on the windows, a green night in fog ──
  console.log('\nthe Matrix')
  await page.keyboard.press('Enter')
  await page.keyboard.type('wake up', { delay: 25 })
  s = await state(page)
  check(s.typing && s.signs.banner === '> wake up_', `what is typed shows on the banner as it is typed ("${s.signs.banner}")`)
  const walked = await page.evaluate(() => globalThis.engine.pose.x)
  await page.keyboard.press('Enter')
  // From here until the banner's second line: how long its first could be read (boards.ts `readable`: the whole cloth
  // in the picture, seen from before it, under nothing the page lays over the picture). Watched in the page, every frame.
  const firstLine = page.evaluate(async () => {
    const p = globalThis.engine.boards.plane, text = () => globalThis.realm.signs.list().find((x) => x.id === 'banner')?.content?.text, from = performance.now()
    let read = 0, last = from
    while (text() !== 'Red pill or blue pill?' && performance.now() - from < 60_000) { await new Promise((r) => requestAnimationFrame(r)); const now = performance.now(); if (text() === 'The Matrix has you' && p.readable) read += now - last; last = now }
    return { readMs: Math.round(read), afterMs: Math.round(performance.now() - from), came: text() === 'Red pill or blue pill?' }
  })
  // The sky as it changes over, eight pictures a second for three seconds: none of them a day's sky in the night's green.
  const over = []
  for (let i = 0; i < 20; i++) { const g = await grid(page, i % 4 === 0 ? `matrix-over-${i}` : null), sky = cells(g, SKY); over.push({ light: Math.round(mean(sky, light)), green: Math.round(mean(sky, (c) => c[1] - (c[0] + c[2]) / 2)) }) }
  results.matrixOver = over
  const daySky = mean(cells(before, SKY), light), washed = over.filter((o) => o.light > daySky * 0.5 && o.green > 10)
  check(washed.length === 0, `as the Matrix comes over, no picture of twenty is a day's sky gone green (light over half the day's ${Math.round(daySky)} and green 10 over red and blue): light ${over.map((o) => o.light).join(' ')}; green ${over.map((o) => o.green).join(' ')}`)
  check(await page.evaluate((x) => globalThis.engine.pose.x === x, walked), 'typing on the line moves nobody (W, A, S and D were letters)')
  await started(page, 'matrix')
  s = await state(page)
  let seen = await bannerSeen(page)
  results.matrix = { banner: seen }
  check(s.signs.banner === 'The Matrix has you' && seen.seen, `the banner says "${s.signs.banner}" and its plane brings it into the picture: ${JSON.stringify(seen)}`)
  await still(page)
  // (Its second line once the first could be read for 8 s.)
  results.matrix.firstLine = await firstLine
  check(results.matrix.firstLine.came && results.matrix.firstLine.readMs >= 7500, `the banner's first line could be read for ${round(results.matrix.firstLine.readMs / 1000)} s before the second replaced it, ${round(results.matrix.firstLine.afterMs / 1000)} s after it was said (asked: 7.5 s of it readable)`)
  s = await state(page)
  check(s.running === 'matrix' && s.up === 1 && s.weather === 'fog' && s.hour > 22 && s.signs.banner === 'Red pill or blue pill?', `the Matrix is up: the screen ${s.up}, ${s.weather}, ${round(s.hour)} h; then the banner asks "${s.signs.banner}"`)
  const m1 = await grid(page, 'matrix'), m2 = (await page.waitForTimeout(400), await grid(page))
  const city0 = cells(before, CITY), city1 = cells(m1, CITY), city2 = cells(m2, CITY)
  const green = (cs) => mean(cs, (c) => c[1] - (c[0] + c[2]) / 2)
  check(green(city1) > green(city0) + 6, `the city's windows went green: green over red and blue ${round(green(city0), 1)} before, ${round(green(city1), 1)} in the Matrix`)
  const moved = mean(city1.map((c, i) => [c, city2[i]]), ([a, b]) => Math.abs(light(a) - light(b)))
  check(moved > 0.4, `the code falls: the city's light moved ${round(moved)} a cell in 0.4 s`)
  // The landmarks are in it as the towers round them are (sf-towers.mjs): how far each one's green moves from one
  // picture to the next, the mean of every step in 50 s (below). Salesforce Tower's shaft against the towers under the logos (from half
  // the least of them to twice the most); its crown against its shaft and the Pyramid's lit spire against the
  // Pyramid's own windows under it (a third to three times). With no window screen on a landmark's glass the shaft was still;
  // with the whole of it on its crown's lamps, the crown was the brightest thing in the Matrix.
  {
    // (The banner's plane is held meanwhile where it is furthest on the page from both landmarks: on its near round it
    // flies before the Pyramid's point, and a plane crossing a tower moves more of its picture than any rain.)
    await page.evaluate(async (TOWERS) => {
      const p = globalThis.engine.boards.plane, marks = Object.values(new Function(`return (${TOWERS})()`)().landmarks), frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      let best = null
      for (let i = 0; i < 60; i++) { p.hold = i / 60; await frame(); const c = p.box; if (!c) continue; const far = Math.min(...marks.map((m) => Math.hypot((c.x0 + c.x1) / 2 - (m.x0 + m.x1) / 2, (c.y0 + c.y1) / 2 - (m.y0 + m.y1) / 2))); if (!best || far > best.far) best = { phase: i / 60, far } }
      p.hold = best ? best.phase : null
      await frame()
    }, TOWERS.toString())
    await page.waitForTimeout(800)
    // The rain's columns stand where they are and a landmark is a few of them wide (the Pyramid's spire is eight pixels, one
    // or two columns), each with three drops of its own, one slower than the next: the slowest takes some 35 s to come
    // round (eggs-pictures.ts `codeRain`). In a few pictures a drop is on a part or it is not, and the middle of eleven
    // pairs of pictures came to anything from 0.06 to 6.8 times its body's, at one commit. So each picture is paired with
    // the one before it for longer than any drop takes to come round, and each pixel is counted once.
    const SECONDS = 50, sums = {}, counts = {}
    let last = null, pairs = 0
    const from = Date.now()
    while (!last || Date.now() - from < SECONDS * 1000) {
      const now = await greens(page, await page.evaluate(TOWERS))
      if (last) {
        pairs++
        for (const [k, was] of Object.entries(now)) {
          if (was.length !== last[k].length) continue
          for (let j = 0; j < was.length; j++) if (was[j] >= 0 && last[k][j] >= 0) { sums[k] = (sums[k] ?? 0) + Math.abs(was[j] - last[k][j]); counts[k] = (counts[k] ?? 0) + 1 }
        }
      }
      last = now
    }
    results.matrix.rainPairs = pairs
    // (How far the green moves a pixel from one picture to the next, of 255.)
    const of = (k) => round((sums[k] ?? 0) / Math.max(1, counts[k] ?? 0), 2), round_ = Object.keys(sums).filter((k) => k.endsWith('tower')).map(of), lo = Math.min(...round_), hi = Math.max(...round_)
    results.matrix.towers = Object.fromEntries(Object.keys(sums).map((k) => [k, of(k)]))
    await page.evaluate(() => { globalThis.engine.boards.plane.hold = null })
    const within = (v, a, b) => v >= a && v <= b
    check(round_.length >= 2 && within(of('salesforce'), lo * 0.5, hi * 2), `Salesforce Tower's shaft shows the rain as the towers round it do: its green moves ${of('salesforce')} a pixel from picture to picture, theirs ${round_.join(', ')} (asked: ${round(lo * 0.5, 2)} to ${round(hi * 2, 2)})`)
    check(within(of("salesforce's crown"), of('salesforce') / 3, of('salesforce') * 3) && within(of("pyramid's spire"), of('pyramid') / 3, of('pyramid') * 3), `the landmarks' own lamps show it as their windows do: Salesforce's crown ${of("salesforce's crown")} against its shaft's ${of('salesforce')} (${round(of("salesforce's crown") / of('salesforce'))} times), the Pyramid's spire ${of("pyramid's spire")} against its body's ${of('pyramid')} (${round(of("pyramid's spire") / of('pyramid'))} times) (asked: a third to three times, each the mean of ${pairs} pairs of pictures over ${SECONDS} s: which columns of the rain cross a part is luck, and over a full round of it that evens out)`)
  }
  await cost(page, 'matrix', 'the Matrix')
  await sayTo(page, 'blue pill')
  // On the way out too: the fog thins in the dark before the day is back, so no picture is a day washed pale under it
  // (as light as half the day's city and with under a third of its contrast).
  const spread = (cs) => { const m = mean(cs, light); return Math.sqrt(mean(cs, (c) => (light(c) - m) ** 2)) }
  const out = []
  for (let i = 0; i < 28; i++) { const g = await grid(page, i % 7 === 0 ? `matrix-out-${i}` : null), city = cells(g, CITY); out.push({ light: Math.round(mean(city, light)), spread: Math.round(spread(city)) }) }
  results.matrixOut = out
  const dayCity = cells(before, CITY), pale = out.filter((o) => o.light > mean(dayCity, light) * 0.5 && o.spread < spread(dayCity) / 3)
  check(pale.length === 0, `as the Matrix leaves, no picture of twenty-eight is the day washed pale under its fog (the day's city: light ${Math.round(mean(dayCity, light))}, spread ${Math.round(spread(dayCity))}): light ${out.map((o) => o.light).join(' ')}; spread ${out.map((o) => o.spread).join(' ')}`)
  await page.waitForTimeout(400)
  s = await state(page)
  check(s.running === null && s.signs.banner === null, `"blue pill" leaves it (${s.running}), the signs are their own again`)
  await still(page)
  await page.waitForFunction(() => globalThis.engine.hour === null, null, { timeout: 20_000 }).catch(() => null)
  s = await state(page)
  const after = await grid(page, 'after-matrix'), lit0 = mean(city0, light), lit1 = mean(cells(after, CITY), light)
  check(s.hour === null && s.weather === 'clear' && s.up === 0 && Math.abs(lit1 - lit0) < Math.max(4, lit0 * 0.06), `the park as it was: the realm's own light (hour ${s.hour}), ${s.weather}, the city's light ${round(lit0, 1)} then ${round(lit1, 1)}`)

  // ── Bad Apple!!, from the line, with sound: the windows follow the frame held on them ──
  console.log('\nBad Apple!!')
  await sayTo(page, 'bad apple')
  await started(page, 'apple')
  await begun()
  await page.waitForTimeout(2500)
  s = await state(page)
  check(s.running === 'apple' && s.playing && !s.muted && s.sound > 0, `typed, it plays with its sound: ${s.sound} bytes decoded`)
  await still(page)
  await cost(page, 'bad-apple', 'Bad Apple!!')
  const follows = async (at, name) => {
    await page.evaluate((t) => globalThis.engine.eggs.hold(t), at)
    await page.waitForFunction((t) => { const m = globalThis.engine.eggs.media; return m && !m.seeking && Math.abs(m.currentTime - t) < 0.2 }, at, { timeout: 10_000 }).catch(() => null)
    await page.waitForTimeout(700)
    // The picture the windows are given (march.screen), as the same grid.
    const pic = await page.evaluate(async () => {
      const e = globalThis.engine, d = e.gpu.device, t = e.march.screen.texture, b = d.createBuffer({ size: t.width * t.height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = d.createCommandEncoder(); enc.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: t.width * 4 }, [t.width, t.height]); d.queue.submit([enc.finish()])
      await b.mapAsync(GPUMapMode.READ); const px = new Uint8Array(b.getMappedRange()), out = new Float32Array(64 * 36), n = new Float32Array(64 * 36)
      for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const k = Math.floor((y * 36) / t.height) * 64 + Math.floor((x * 64) / t.width), i = (y * t.width + x) * 4; out[k] += px[i]; n[k]++ }
      b.unmap(); return [...out].map((v, k) => v / n[k])
    })
    const shot = cells(await grid(page, name), CITY)
    const r = corr(shot.map(light), shot.map((c) => pic[c[4] * 64 + c[3]]))
    return r
  }
  const r1 = await follows(62, 'bad-apple'), r2 = await follows(95, 'bad-apple-2')
  results['bad-apple'].follows = [round(r1), round(r2)]
  check(r1 > 0.25 && r2 > 0.25, `the windows' light follows the frame held on them: correlation ${round(r1)} at 62 s, ${round(r2)} at 95 s`)
  await page.evaluate(() => globalThis.engine.eggs.hold(null))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  s = await state(page)
  check(s.running === null && !s.playing, 'Esc ends it')
  await still(page)

  // ── The Rickroll, with sound, and its title on the banner ──
  console.log('\nthe Rickroll')
  await sayTo(page, 'never gonna give you up')
  await started(page, 'rickroll')
  await begun()
  seen = await bannerSeen(page)
  results.rickroll = { banner: seen }
  check(seen.seen, `the banner's plane brings "${(await state(page)).signs.banner}" into the picture: ${JSON.stringify(seen)}`)
  await page.waitForTimeout(2500)
  s = await state(page)
  check(s.running === 'rickroll' && s.playing && !s.muted && s.sound > 0, `Rick is on every window, with his sound (${s.sound} bytes decoded); banner "${s.signs.banner}"`)
  await still(page)
  await page.evaluate(() => globalThis.engine.eggs.hold(20))
  await page.waitForTimeout(1200)
  const rick = cells(await grid(page, 'rickroll'), CITY)
  check(mean(rick, light) > mean(city0, light) * 0.25, `the windows show him: the city's light ${round(mean(rick, light), 1)}`)
  await page.evaluate(() => globalThis.engine.eggs.hold(null))
  await cost(page, 'rickroll', 'the Rickroll')
  await sayTo(page, 'stop')
  await page.waitForTimeout(300)
  check((await state(page)).running === null, '"stop" ends it')
  await still(page)

  // ── The moon: night, and a tool used at it makes it grow ──
  console.log('\nthe moon')
  await sayTo(page, 'moon')
  await page.waitForFunction(() => globalThis.engine.realmControls.sky.hour > 23, null, { timeout: 10_000 }).catch(() => null)
  await still(page)
  // From 150 m over the park: from the park itself a tower stands between the eye and the moon.
  const aim = await page.evaluate(() => { const e = globalThis.engine, [x, y, z] = e.march.sun.s; const yaw = Math.atan2(x, -z), pitch = Math.asin(y / Math.hypot(x, y, z)); e.pose.y += 150; e.pose.yaw = yaw; e.pose.pitch = pitch; return { yaw, pitch } })
  await page.waitForTimeout(800)
  const disc = (g) => cells(g, [0.4, 0.38, 0.6, 0.62]).filter((c) => light(c) > 150).length
  const moon1 = disc(await grid(page, 'moon-1'))
  await page.evaluate(() => globalThis.engine.input.use())
  await page.waitForTimeout(600)
  const moon2 = disc(await grid(page, 'moon-2'))
  s = await state(page)
  check(s.moon === 1 && moon2 > moon1 * 1.8, `shot, the moon grows: ${moon1} bright cells, then ${moon2} (size ${s.moon + 1} of 3)`)
  results.moon = { aim, cells: [moon1, moon2] }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const moon3 = disc(await grid(page))
  check((await state(page)).moon === 0 && moon3 < moon2, `Esc and it is its own size (${moon3} bright cells)`)
  await page.evaluate(() => { const e = globalThis.engine; e.pose.y -= 150; e.pose.yaw = 2.097982; e.pose.pitch = -0.009161 })
  await still(page)

  // ── IDDQD: no tool breaks anything; again, and they do ──
  console.log('\nIDDQD')
  const edits = () => page.evaluate(() => globalThis.engine.world.done().length)
  await page.evaluate(() => globalThis.engine.pickTool(1))
  await sayTo(page, 'iddqd')
  const e0 = await edits()
  await page.evaluate(() => globalThis.engine.input.use())
  await page.waitForTimeout(2500)
  const e1 = await edits()
  s = await state(page)
  check(s.shield && e1 === e0 && s.signs.banner === 'God mode', `under IDDQD a charge breaks nothing (${e0} edits, then ${e1}); banner "${s.signs.banner}"`)
  await sayTo(page, 'iddqd')
  await page.evaluate(() => globalThis.engine.input.use())
  await page.waitForFunction((n) => globalThis.engine.world.done().length > n, e1, { timeout: 15_000 }).catch(() => null)
  const e2 = await edits()
  check(!(await state(page)).shield && e2 > e1, `said again, a charge breaks things (${e2} edits)`)

  // ── Reset ends an egg and puts the sky back ──
  console.log('\nreset')
  await sayTo(page, 'neo')
  await page.waitForTimeout(1500)
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(300)
  s = await state(page)
  check(s.running === null && s.weather === 'clear', `Backspace (reset) ends the Matrix and asks the weather back (${s.weather})`)
  // (As it was: what lays the boards, boards.ts, and nothing more.)
  const asWas = () => globalThis.engine.hour === null && globalThis.engine.world.done().length === (globalThis.engine.boards?.edits ?? 0)
  await page.waitForFunction(asWas, null, { timeout: 20_000 }).catch(() => null)
  check(await page.evaluate(asWas), 'the world is as it was and lit by its own light')
  await still(page)

  // ── The Konami code: +30 lives on the banner; its B does not put the eye on foot ──
  console.log('\nthe Konami code')
  const foot = await page.evaluate(() => globalThis.engine.me.on)
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k)
  s = await state(page)
  check(s.signs.banner === '+30 lives' && (await page.evaluate(() => globalThis.engine.me.on)) === foot, `↑↑↓↓←→←→BA: banner "${s.signs.banner}", still ${foot ? 'on foot' : 'flying'}`)
  await page.keyboard.press('Escape')
  check((await state(page)).signs.banner === null, 'Esc gives the banner back')

  // ── The hour swung across dusk four times in four seconds: Bad Apple!! ──
  console.log('\nfour swings of the hour')
  for (const h of [21, 12, 21, 12]) { await page.evaluate((v) => { globalThis.engine.hour = v }, h); await page.waitForTimeout(250) }
  s = await state(page)
  check(s.running === 'apple', `black and white and black and white: ${s.running}`)
  await page.keyboard.press('Escape')

  // ── A barrel roll, and a line the city does not know ──
  console.log('\nthe rest')
  const yaw0 = await page.evaluate(() => globalThis.engine.pose.yaw)
  await sayTo(page, 'do a barrel roll')
  await page.waitForTimeout(400)
  const yawMid = await page.evaluate(() => globalThis.engine.pose.yaw)
  await page.waitForTimeout(800)
  const yaw1 = await page.evaluate(() => globalThis.engine.pose.yaw)
  check(Math.abs(yawMid - yaw0) > 0.5 && Math.abs(yaw1 - yaw0 - Math.PI * 2) < 0.01, `a barrel roll: the eye turns round once (${round(yaw1 - yaw0)} rad)`)
  await page.evaluate((y) => { globalThis.engine.pose.yaw = y }, yaw0)
  await sayTo(page, 'open sesame')
  s = await state(page)
  check(s.running === null && /Not here/.test(s.signs.banner ?? ''), `a line it does not know is answered on the banner ("${s.signs.banner}")`)
  await sayTo(page, 'xyzzy')
  s = await state(page)
  check(/Try: wake up/.test(s.signs.banner ?? ''), `two misses and the banner gives a hint ("${s.signs.banner}")`)
  await page.keyboard.press('Escape')
  s = await state(page)
  const own = await page.evaluate(() => globalThis.realm.signs.list().find((x) => x.id === 'banner'))
  check(s.signs.banner === null && !(await page.evaluate(() => globalThis.engine.boards.plane.called)) && own.content.text === 'zahynailo.dev', `Esc gives the banner its own words back ("${own.content.text}") and lets its plane go round`)

  check(page.errors.length === 0, `no errors on the page${page.errors.length ? `: ${page.errors.slice(0, 3).join(' | ')}` : ''}`)
  await page.close()
  }

  // ── On a phone: what an egg says on the banner comes into a narrow picture too ──
  console.log('\non a phone, 390 x 844')
  const phone = await open(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }))
  if (!has('things')) {
  await phone.evaluate(() => globalThis.engine.eggs.say('wake up'))
  const onPhone = await bannerSeen(phone, 15_000)
  results.phone = { banner: onPhone }
  check(onPhone.seen, `the Matrix's banner comes into the phone's picture: ${JSON.stringify(onPhone)}`)
  if (onPhone.seen) await phone.screenshot({ path: join(shots, 'banner-phone.png') })
  await phone.evaluate(() => globalThis.engine.eggs.undo(true))
  await still(phone)
  }

  // ── The things in the city: each found on foot, and its cue tapped (a phone) or clicked (a desk), starts its egg ──
  console.log('\nthe things, tapped on a phone, 390 x 844')
  await things(phone, 'phone')
  check(phone.errors.length === 0, `no errors on the phone's page${phone.errors.length ? `: ${phone.errors.slice(0, 3).join(' | ')}` : ''}`)
  await phone.close()
  console.log('\nthe things, clicked on a desk, 1440 x 900')
  const desk = await open(await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }))
  await things(desk, 'desk')
  check(desk.errors.length === 0, `no errors on the desk's page${desk.errors.length ? `: ${desk.errors.slice(0, 3).join(' | ')}` : ''}`)
  }
} catch (e) {
  console.error(e)
  failures.push(String(e))
} finally {
  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1))
  await browser.close()
  back()
  site.close?.()
}
console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nall eggs ok')
process.exit(failures.length ? 1 : 0)
