// The way into the SF realm, checked (#450, page/explore.ts): the folder `node sf/build.mjs` writes, served as plain
// files and held in a frame by a host page, as the site holds it. Chrome with WebGPU; one GPU is shared, so a failed
// run is worth one more before it is believed.
//
//   node test/sf-explore.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/explore/check] [--mbit 25]
//
// It fails unless:
//   - the park is shown within 8 MB over the wire on a cold cache (25 Mbit/s, 40 ms), and the way in is none of it;
//   - the first view has no Explore key, and the EXPLORE board is in it at 1280 x 720 and on an upright phone, under
//     nothing, over no other board, and read from the picture's own pixels (brighter where a letter's lamp is);
//   - the board reads and is easy to hit from the park, wide and on a phone (its face's size, and how far round it a
//     pointer is on it);
//   - nothing done by chance enters: keys (none means what it means in the realm), a drag, a click on the picture
//     that is on no board; a double click and a key held until it repeats are one ask; Enter and the slash open the
//     eggs' line and nothing else, and no Enter said on it, however quick, asks for the way in;
//   - one click on the board does not enter: it lights the letters (the picture is brighter there), says how to go
//     on, and starts the roof's tiles coming; Esc, a click elsewhere, the pointer taken away and a few seconds each
//     put it back, the eye where it was;
//   - two clicks enter: the host is told `engaged`, the eye ends behind the visitor's own body on the roof, in 6 to 10 s,
//     seen from off the roof with the board's face read beside it (50 degrees from face-on at most, 60% of its
//     letters in the picture) and a drop in the picture, the controls come, the hour's panel is folded
//     and the card says the two keys;
//   - on the throttled link everything asked for after the first click has come, and every box of the world round the
//     roof is made, when the eye settles (or the round was drawn out for it, which is said);
//   - a step off the roof is a fall that gathers speed; Space in the air opens a canopy that sinks slowly, is steered
//     and lands; B flies; then the card goes;
//   - the host's `explore` enters with nothing asked twice, sent before `ready` too; a click in the flight cuts to
//     the end and opens no board; Enter twice on the board's button enters, and a key in the flight cuts to the end
//     and does nothing else (Backspace does not put the world back); where motion is not wanted there is no flight;
//   - a realm with no board that leads in (`?boards=0`) still lets a key end its first view;
//   - on a phone two taps enter, and a thumb has keys for the same.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { TOWERS } from './sf-towers.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'explore', 'check')), mbit = Number(arg('mbit', '25'))
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const pointer = JSON.parse(readFileSync(join(dist, 'sf/current.json'), 'utf8')), releaseAt = `/sf/${pointer.manifest.replace(/manifest\.json$/, '')}`
// The host: a page with the realm in a frame over the whole of it, keeping what the realm tells it.
const HOST = `<!doctype html><meta charset="utf-8"><title>host</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
<iframe id="realm" src="/sf/index.html?knock=0" allow="autoplay"></iframe><script>window.told=[];addEventListener('message',(e)=>{if(e.data&&e.data.village==='realm')told.push(e.data)});window.ask=(m)=>document.getElementById('realm').contentWindow.postMessage({village:'realm',...m},'*')</script>`
// A host that does not wait: it says `explore` once, when its frame has loaded, long before it is told `ready` (the
// realm has no GPU, no core and no tile yet), and never again.
const EARLY = HOST.replace('</script>', ';document.getElementById(\'realm\').addEventListener(\'load\',()=>ask({type:\'explore\'}))</script>')
const site = await plain(dist, '127.0.0.1', 0, { extra: (req, res) => { const path = new URL(req.url, 'http://x').pathname; if (path !== '/host.html' && path !== '/host-early.html') return false; res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(path === '/host.html' ? HOST : EARLY); return true } })
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const results = {}, errors = []
const mb = (n) => round(n / 1048576, 2)
const WIDE = { viewport: { width: 1280, height: 720 } }, PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
/** What was sent between two moments (ms since 1970): how many requests, the bytes on the wire, and of what. */
const sent = (from, to) => {
  const all = { requests: 0, wire: 0 }, kinds = {}
  for (const a of site.asked) {
    if (a.status !== 200 || a.at < from || a.at > to) continue
    all.requests++; all.wire += a.wire
    const kind = a.path.startsWith(releaseAt + 'tiles/') ? 'tiles' : a.path.startsWith(releaseAt) ? a.path.slice(releaseAt.length).split('/')[0] : a.path.startsWith('/page/') || a.path.startsWith('/kit/') || a.path.startsWith('/blocks/') ? 'code' : 'other'
    kinds[kind] = (kinds[kind] ?? 0) + a.wire
  }
  return { requests: all.requests, wireMB: mb(all.wire), of: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, mb(v)])) }
}
/** A page of the realm: in the host's frame or by itself, throttled or not. Returns the page, the realm's frame and what lifts the throttle. */
const open = async (options, { hosted = false, slow = false, early = false, query = '' } = {}) => {
  const context = await browser.newContext(options), page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  let lift = async () => {}
  if (slow) { const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 }); lift = () => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }) }
  const from = Date.now()
  await page.goto(hosted ? `${site.url}/${early ? 'host-early' : 'host'}.html` : `${site.url}/sf/index.html?knock=0${query}`)
  const realm = hosted ? page.frames().find((f) => f.url().includes('/sf/index.html')) : page.mainFrame()
  await realm.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 240_000 })
  const shown = await realm.evaluate(() => performance.timeOrigin + globalThis.engine.seen.near)
  await realm.waitForFunction(() => globalThis.engine.seen.whole > 0 && globalThis.engine.boards && globalThis.engine.far.whole && globalThis.engine.explore, null, { timeout: 300_000 })
  return { context, page, realm, lift, from, shown }
}
const at = (realm) => realm.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return w && { x: w.x, y: w.y, wide: w.wide, high: w.high, tall: w.tall } })
/** What of the first view is wholly in the picture (4 px in from its edges): BLOG, the three logos, EXPLORE, the banner's cloth and the Pyramid from 120 m up to its spire's tip, 30 m across (sf-towers.mjs); and whether BLOG is clear of the credits' key. */
const framed = async (realm) => realm.evaluate(({ towers }) => {
  const b = globalThis.engine.boards, p = b.plane?.box, key = document.querySelector('#first .credits')?.getBoundingClientRect(), t = towers.landmarks
  const box = (id) => { const w = b.where(id); return w && { x0: w.x - w.wide / 2, y0: w.y - w.high / 2, x1: w.x + w.wide / 2, y1: w.y + w.high / 2 } }
  const whole = (r) => !!r && r.x0 >= 4 && r.y0 >= 4 && r.x1 <= innerWidth - 4 && r.y1 <= innerHeight - 4
  // (TOWERS' box is the middle 10 m of its body, for its windows' light; the body is about 30 m across 120 m up.)
  const pyramid = t.pyramid && t["pyramid's spire"] && { x0: t.pyramid.x0 - (t.pyramid.x1 - t.pyramid.x0), y0: t["pyramid's spire"].y0, x1: t.pyramid.x1 + (t.pyramid.x1 - t.pyramid.x0), y1: t.pyramid.y1 }
  const all = { blog: box('blog'), x: box('x'), linkedin: box('linkedin'), twitch: box('twitch'), explore: box('explore'), banner: p && { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 }, pyramid }
  const out = Object.entries(all).filter(([, r]) => !whole(r)).map(([id, r]) => (r ? `${id} at ${Math.round(r.x0)},${Math.round(r.y0)} to ${Math.round(r.x1)},${Math.round(r.y1)}` : `${id} not seen`))
  const blog = all.blog, under = !!blog && !!key && blog.x0 < key.right && blog.x1 > key.left && blog.y0 < key.bottom && blog.y1 > key.top
  return { out, under }
}, { towers: await realm.evaluate(TOWERS) })
const state = (realm) => realm.evaluate(() => globalThis.engine.explore.state)
const eye = (realm) => realm.evaluate(() => { const e = globalThis.engine, p = e.pose; return { at: [p.x, p.y, p.z], yaw: p.yaw, pitch: p.pitch, fov: e.fov, engaged: e.first.engaged, locked: e.input.locked, top: e.input.top } })
const same = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]) < 0.01 && Math.abs(a.yaw - b.yaw) < 1e-4 && Math.abs(a.pitch - b.pitch) < 1e-4 && Math.abs(a.fov - b.fov) < 1e-3
/** How much brighter the picture is where the board's letters are lamp than where they are panel (0 to 255), from a screenshot of the page. */
const read = async (page, realm) => {
  const marks = await realm.evaluate(() => globalThis.engine.boards.marks('explore')), w = await at(realm)
  const clip = { x: Math.max(0, Math.floor(w.x - w.wide / 2 - 4)), y: Math.max(0, Math.floor(w.y - w.high / 2 - 4)), width: Math.ceil(w.wide + 8), height: Math.ceil(w.high + 8) }
  const png = await page.screenshot({ clip }), scale = (await page.evaluate(() => devicePixelRatio)) || 1
  const picture = await page.evaluate(async ({ data, wide, high }) => { const image = await createImageBitmap(await (await fetch(data)).blob()), c = new OffscreenCanvas(image.width, image.height), g = c.getContext('2d'); g.drawImage(image, 0, 0); return { w: image.width, data: [...g.getImageData(0, 0, image.width, image.height).data], wide, high } }, { data: `data:image/png;base64,${png.toString('base64')}`, wide: clip.width, high: clip.height })
  const lum = (m) => { const x = Math.floor((m.x - clip.x) * scale), y = Math.floor((m.y - clip.y) * scale), i = (y * picture.w + x) * 4; return i >= 0 && i + 2 < picture.data.length ? 0.2126 * picture.data[i] + 0.7152 * picture.data[i + 1] + 0.0722 * picture.data[i + 2] : null }
  const mean = (list) => { const v = list.map(lum).filter((n) => n !== null); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length) }
  return { lamp: round(mean(marks.filter((m) => m.lit))), panel: round(mean(marks.filter((m) => !m.lit))), marks: marks.length }
}
/** How far round the board's middle a pointer is on it, as the page's own hand says (boards.ts: the picture's cursor over a board): px across and down. */
const target = async (page, realm) => {
  const w = await at(realm), on = async (x, y) => { await page.mouse.move(x, y); return realm.evaluate(() => document.querySelector('canvas').style.cursor === 'pointer') }
  // (No further than the picture's edge: off it the pointer is on nothing.)
  const size = await page.evaluate(() => [innerWidth, innerHeight])
  const reach = async (dx, dy) => { let n = 0; const inside = (k) => { const x = w.x + dx * k, y = w.y + dy * k; return x >= 0 && x < size[0] && y >= 0 && y < size[1] }; while (n < 200 && inside(n + 2) && (await on(w.x + dx * (n + 2), w.y + dy * (n + 2)))) n += 2; return n }
  const sides = [await reach(-1, 0), await reach(1, 0), await reach(0, -1), await reach(0, 1)]
  await page.mouse.move(5, 5)
  return { wide: sides[0] + sides[1], high: sides[2] + sides[3] }
}
/**
 * In the page, once the visitor is in: what the settled picture shows. How far off face-on the board is seen (the look
 * against its face's normal, degrees); how much of it is in the picture (percent of `all` its letters' squares, as many
 * as the park sees) and how much of that is clear of the controls; whether the body is in it whole, from its feet to the
 * top of its head, and clear of them; and whether a drop is in it: among rays across the picture's lower half,
 * one that meets something 20 m or more under the feet, or nothing at all (the near world is behind it) going down.
 */
const beside_ = async (all) => {
  const e = globalThis.engine, m = e.boards.marks('explore'), f = e.me.feet, v = e.view(), l = e.boards.letters('explore'), a = innerWidth / innerHeight
  const proj = (p) => { const d = [p[0] - v.eye[0], p[1] - v.eye[1], p[2] - v.eye[2]], z = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]; if (z < 1) return null; return [innerWidth / 2 * (1 + (d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (z * v.tanHalf * a)), innerHeight / 2 * (1 - (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (z * v.tanHalf))] }
  const laid = [...document.querySelectorAll('#realm > *, #realm .act > *, #first > .credits')].filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.width < innerWidth * 0.95)
  const inside = (p) => !!p && p[0] > 0 && p[0] < innerWidth && p[1] > 0 && p[1] < innerHeight, clear = (p) => !laid.some((r) => p[0] > r.left && p[0] < r.right && p[1] > r.top && p[1] < r.bottom)
  const shown = m.filter((p) => inside([p.x, p.y])), body = [0, 4, 9, 14, 18].map((up) => proj([f.at[0], f.at[1] + up, f.at[2]]))
  const n = l.normal, level = Math.hypot(v.forward[0], v.forward[2]), off = (Math.acos(Math.max(-1, Math.min(1, -(v.forward[0] * n[0] + v.forward[2] * n[2]) / level))) * 180) / Math.PI
  let drop = false
  for (let i = -3; i <= 3 && !drop; i++) for (let j = -2; j <= 0.01 && !drop; j += 0.5) {
    const x = (i / 3.5) * v.tanHalf * a, y = (j / 2) * v.tanHalf, d = [0, 1, 2].map((k) => v.forward[k] + v.right[k] * x + v.up[k] * y), len = Math.hypot(...d), dir = d.map((c) => c / len)
    const hit = await e.march.pick({ ...v, forward: dir })
    if ((hit && v.eye[1] + dir[1] * hit.t < f.at[1] - 200) || (!hit && dir[1] < -0.15)) drop = true
  }
  return { off: Math.round(off), board: Math.round((100 * shown.length) / Math.max(1, all, m.length)), clear: Math.round((100 * shown.filter((p) => clear([p.x, p.y])).length) / Math.max(1, all, m.length)), body: body.every((p) => inside(p) && clear(p)), drop }
}
const click = (page, phone, x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y))
const until = (realm, what, ms = 60_000, arg = null) => realm.waitForFunction(what, arg, { timeout: ms }).then(() => true, () => false)

try {
  // ── The first view on an ordinary link, in the host's frame ──
  console.log(`\nthe first view (cold cache, ${mbit} Mbit/s, 40 ms)`)
  const first = await open(WIDE, { hosted: true, slow: true })
  const { page, realm } = first
  const untilPark = sent(0, first.shown), parkCode = site.asked.filter((a) => a.at <= first.shown && /\/page\/explore\.js/.test(a.path)).length
  results.park = untilPark
  check(untilPark.wireMB < 8, `${untilPark.wireMB} MB over the wire until the park is shown (bound 8 MB): ${JSON.stringify(untilPark.of)}`)
  check(parkCode === 0, 'the way in (page/explore.js) is fetched after the park is shown, not before')
  const view = await realm.evaluate(() => {
    const b = globalThis.engine.boards, box = (id) => { const w = b.where(id); return w && { x0: w.x - w.wide / 2, y0: w.y - w.high / 2, x1: w.x + w.wide / 2, y1: w.y + w.high / 2 } }
    const meet = (p, q) => p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0, mine = box('explore')
    const laid = [...document.querySelectorAll('#first > button, #realm .sky, #realm .tools, #hud')].filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((el) => { const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } })
    return { key: !!document.querySelector('#first .explore'), mine, inside: mine && mine.x0 > 0 && mine.y0 > 0 && mine.x1 < innerWidth && mine.y1 < innerHeight, over: b.records.filter((r) => r.id !== 'explore').filter((r) => { const o = box(r.id); return o && meet(mine, o) }).map((r) => r.id), under: laid.filter((l) => meet(mine, l)).length, faced: b.faced('explore'), blogFaced: b.faced('blog'), button: document.querySelector('nav [data-board="explore"]')?.tagName, record: b.records.find((r) => r.id === 'explore'), tall: b.where('explore').tall, wide: b.where('explore').wide, blog: b.where('blog').tall, state: globalThis.engine.explore.state, engaged: globalThis.engine.first.engaged }
  })
  // (The picture's own scale held where a quiet machine has it: the GPU is shared with other checks, and at a third of the pixels no sign of 56 px is read.)
  await realm.evaluate(() => { globalThis.engine.scale = 0.75 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'first-1280x720.png') })
  check(!view.key && view.state === 'idle' && !view.engaged, 'the first view has no Explore key, and nobody is in the realm yet')
  check(view.record?.type === 'lettering' && view.record.does === 'explore' && view.button === 'BUTTON', `EXPLORE is a lettering board of the file that does "explore", and a button in the page for a keyboard (${view.button})`)
  check(view.inside && view.over.length === 0 && view.under === 0, `the board is in the picture at 1280 x 720, over no other board and under nothing${view.over.length ? ` (over ${view.over})` : ''}`)
  check(view.faced && !view.blogFaced, 'from the park EXPLORE is shown as its face and BLOG as its cells, as it always was')
  const hit = await target(page, realm)
  results.board = { wide: { face: [round(view.wide), round(view.tall)], target: hit } }
  check(view.tall >= 16 && view.wide >= 56 && hit.wide >= 70 && hit.high >= 40, `its face is ${round(view.wide)} px wide and ${round(view.tall)} tall (56 and 16 or more), and a click is on it ${hit.wide} x ${hit.high} px round its middle`)
  const idle = await read(page, realm)
  /** How many squares the board's letters have, all of them in front of the eye from the park. */
  const squares = idle.marks
  // (How far apart lamp and panel are asked to be goes by how big a square of its letters is on the picture: under
  // 2 px the one pixel read at a square's middle has its neighbours' light in it, as sf-boards.mjs asks of lettering.)
  const square = await realm.evaluate(() => { const b = globalThis.engine.boards, w = b.where('explore'), l = b.letters('explore'); return (w.tall / l.high) * l.px }), apart = square >= 2 ? 60 : 45
  check(idle.marks >= 100 && idle.lamp - idle.panel > apart, `read from the picture: where its letters are lamp the picture is ${idle.lamp}, where panel ${idle.panel} (${apart} or more apart, a square ${round(square, 2)} px; ${idle.marks} squares)`)
  const began = await eye(realm), told = () => page.evaluate(() => window.told.map((m) => m.type))
  check((await told()).includes('ready') && (await page.evaluate(() => window.told.find((m) => m.type === 'ready').boards.some((b) => b.id === 'explore'))), 'the host is told `ready` with the board')

  // ── Nothing done by chance ──
  console.log('\nnothing done by chance')
  await realm.evaluate(() => window.focus())
  // (B, which takes a body up or sets it down everywhere in the realm: each alone, and what has the keys looked at after each.)
  const keyed = []
  const writing = () => realm.evaluate(() => ({ on: globalThis.engine.me.on, writing: document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA', state: globalThis.engine.explore.state, line: (() => { const l = document.querySelector('.egg-line'); return !!l && !l.hidden && l.checkVisibility({ visibilityProperty: true, opacityProperty: true }) })() }))
  for (const key of ['KeyB', 'KeyW', 'Space', 'KeyO', 'Backspace', 'ArrowUp']) { await page.keyboard.press(key); await page.waitForTimeout(120); const e = await eye(realm), body = await writing(); if (!same(e, began) || e.engaged || e.top !== began.top || body.on || body.writing) keyed.push(key) }
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW')
  check(keyed.length === 0 && same(await eye(realm), began) && !(await eye(realm)).engaged, `keys move nothing, bring nothing and mean nothing: B, W, Space, O, Backspace, W held${keyed.length ? ` (${keyed.join(', ')} did something)` : ''}`)
  // Enter and the slash open the eggs' line, and do nothing else: what is typed shows on the banner, its Enter shuts
  // it, and however fast Enter is pressed after that it opens the line again and never asks for the way in.
  await realm.waitForFunction(() => globalThis.engine.eggs, null, { timeout: 30_000 })
  const lines = []
  for (const key of ['Enter', 'Slash']) { await page.keyboard.press(key); await page.waitForTimeout(200); lines.push({ key, ...(await writing()), eye: same(await eye(realm), began), engaged: (await eye(realm)).engaged }); await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
  check(lines.every((l) => l.writing && l.line && l.eye && !l.engaged && l.state === 'idle' && !l.on), `in the first view Enter and the slash open the eggs' line and nothing else: ${lines.map((l) => `${l.key} ${l.line ? 'line shown' : 'no line'}${l.writing ? ', writing' : ''}, ${l.state}${l.engaged ? ', ENGAGED' : ''}`).join('; ')}`)
  await page.keyboard.press('Enter'); await page.waitForTimeout(150)
  await page.keyboard.type('hello city', { delay: 30 })
  const echoed = await realm.evaluate(() => globalThis.engine.signs.list().find((x) => x.id === 'banner')?.content?.text ?? null).catch(() => null)
  await page.keyboard.press('Enter')
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(45) }
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  const afterLine = { ...(await writing()), eye: await eye(realm) }
  // A real egg said on that line works in the first view, and what it lays over the picture is seen there: the moon,
  // and a video's player with its keys. Esc puts each back; nobody is in the realm meanwhile.
  const eggSaid = async (words) => { await page.keyboard.press('Enter'); await page.waitForTimeout(150); await page.keyboard.type(words, { delay: 25 }); await page.keyboard.press('Enter'); await page.waitForTimeout(2500); return realm.evaluate(() => { const st = globalThis.engine.eggs.state, p = document.querySelector('.egg-player'), said = document.querySelector('.egg-status'); return { said: said?.textContent ?? '', saidHere: said?.parentElement?.id === 'first', hour: globalThis.engine.hour, running: st.running, player: !!p && !p.hidden && p.checkVisibility({ visibilityProperty: true, opacityProperty: true }), engaged: globalThis.engine.first.engaged, state: globalThis.engine.explore.state } }) }
  const mooned = await eggSaid('moon')
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  const rolled = await eggSaid('rickroll')
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500)
  check(/moon is up/.test(mooned.said) && mooned.saidHere && mooned.hour !== null && !mooned.engaged && mooned.state === 'idle' && (rolled.running !== 'rickroll' || rolled.player) && !rolled.engaged && rolled.state === 'idle', `eggs said on the line in the first view work there: "moon" brings the night ("${mooned.said}", said ${mooned.saidHere ? 'beside the first view\'s keys' : 'where it is hidden'}, the hour ${mooned.hour === null ? 'unset' : round(mooned.hour, 1)}); "rickroll" ${rolled.running === 'rickroll' ? `plays, its player ${rolled.player ? 'seen' : 'HIDDEN'}` : `did not start here (${rolled.running}), so its player was not looked at`}; nobody is in the realm`)
  await page.waitForTimeout(6500)
  check(/hello city/.test(echoed ?? '') && afterLine.state === 'idle' && !afterLine.eye.engaged && same(afterLine.eye, began) && !afterLine.writing && !(await told()).includes('engaged'), `a line typed and said, then Enter pressed six times fast: nobody is in the realm, the way in is not asked (${afterLine.state}), the eye where it was; as it was typed the banner said "${echoed}"`)
  await page.mouse.move(300, 200); await page.mouse.down(); await page.mouse.move(520, 260, { steps: 8 }); await page.mouse.up()
  await page.mouse.click(1000, 120)
  await page.waitForTimeout(400)
  const afterClicks = await eye(realm)
  check(same(afterClicks, began) && !afterClicks.engaged && !afterClicks.locked && (await state(realm)) === 'idle', 'a drag and a click on the sky move nothing, take no pointer and bring nothing')

  // ── Asked once ──
  console.log('\nasked once')
  const armAt = Date.now()
  let w = await at(realm)
  await page.mouse.click(w.x, w.y)
  await page.waitForTimeout(1100)
  const armed = await realm.evaluate(() => { const h = document.querySelector('#explore-hint'), r = h.getBoundingClientRect(), w = globalThis.engine.boards.where('explore'); return { state: globalThis.engine.explore.state, engaged: globalThis.engine.first.engaged, hint: h.textContent, on: h.classList.contains('on') && getComputedStyle(h).opacity > 0.9, under: r.top - (w.y + w.high / 2), across: Math.abs((r.left + r.right) / 2 - w.x), faced: globalThis.engine.boards.faced('explore') } })
  await page.screenshot({ path: join(shots, 'armed-1280x720.png') })
  const lit = await read(page, realm), leaned = await eye(realm)
  check(armed.state === 'armed' && !armed.engaged && !(await told()).includes('engaged'), 'one click does not enter: the board is asked, nobody is in the realm, the host is told nothing')
  check(armed.on && /Click again to explore/.test(armed.hint) && /Esc to stay/.test(armed.hint) && armed.under > 0 && armed.under < 30 && armed.across < 40, `a line under the board says how to go on: "${armed.hint}" (${round(armed.under)} px under it)`)
  // (Its lamp brighter by 25 of 255 or more, and further from its panel than before: a face 56 px wide lets a lit letter's light a little into the panel beside it.)
  check(lit.lamp - idle.lamp > (square >= 2 ? 25 : 18) && lit.lamp - lit.panel > idle.lamp - idle.panel + 10, `its letters light: the picture there is ${lit.lamp} from ${idle.lamp}, its panels ${lit.panel} from ${idle.panel}`)
  const turned = Math.hypot(leaned.yaw - began.yaw, leaned.pitch - began.pitch) * 180 / Math.PI
  check(turned > 0.02 && turned < 1.5 && leaned.fov < began.fov && leaned.fov > began.fov * 0.94, `the eye leans to it a little: ${round(turned, 2)} degrees, the lens ${round(began.fov, 2)} to ${round(leaned.fov, 2)}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const escaped = await realm.evaluate(() => ({ state: globalThis.engine.explore.state, on: document.querySelector('#explore-hint').classList.contains('on') }))
  await page.waitForTimeout(1600)
  check(escaped.state === 'idle' && !escaped.on && same(await eye(realm), began), 'Esc puts it back: no line, and the eye where it was')
  const back1 = await read(page, realm)
  check(Math.abs(back1.lamp - idle.lamp) < 12, `and its letters as they were (${back1.lamp} against ${idle.lamp})`)
  // A double click is one ask, and so is Enter held until it repeats: the line has to have been there to read.
  w = await at(realm)
  await page.mouse.click(w.x, w.y); await page.waitForTimeout(110); await page.mouse.click(w.x, w.y)
  await page.waitForTimeout(500)
  const doubled = await state(realm)
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500)
  await realm.evaluate(() => document.querySelector('nav [data-board="explore"]').focus())
  await page.keyboard.down('Enter'); await page.waitForTimeout(450); for (let i = 0; i < 6; i++) { await page.keyboard.down('Enter'); await page.waitForTimeout(40) } await page.keyboard.up('Enter')
  await page.waitForTimeout(300)
  const held = await state(realm)
  await page.keyboard.press('Escape'); await realm.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(1500)
  check(doubled === 'armed' && held === 'armed' && (await state(realm)) === 'idle' && !(await eye(realm)).engaged, `a double click asks once (${doubled}), and so does Enter held until it repeats (${held})`)
  // A click anywhere else; the pointer taken well away; a few seconds.
  w = await at(realm)
  await page.mouse.click(w.x, w.y); await page.waitForTimeout(300)
  await page.mouse.click(1000, 120); await page.waitForTimeout(300)
  check((await state(realm)) === 'idle' && !(await eye(realm)).engaged, 'asked once, then a click elsewhere: put back, and nobody is in')
  await page.mouse.click(w.x, w.y); await page.waitForTimeout(300)
  const stayed = await state(realm)
  await page.mouse.move(w.x + 60, w.y + 30, { steps: 4 }); await page.waitForTimeout(200)
  const near = await state(realm)
  await page.mouse.move(w.x + 420, w.y + 200, { steps: 6 }); await page.waitForTimeout(300)
  check(stayed === 'armed' && near === 'armed' && (await state(realm)) === 'idle', 'the pointer a little off the board leaves it asked; taken well away, it is put back')
  await page.mouse.move(w.x, w.y, { steps: 4 })
  await page.mouse.click(w.x, w.y)
  await page.waitForTimeout(5200)
  const late = await state(realm)
  await page.waitForTimeout(1500)
  check(late === 'armed' && (await state(realm)) === 'idle', 'left alone it stands for six seconds, then is put back')
  await page.waitForTimeout(1500)

  // ── Asked twice, on the throttled link ──
  console.log(`\nasked twice (${mbit} Mbit/s, 40 ms)`)
  w = await at(realm)
  await page.mouse.click(w.x, w.y)
  await page.waitForTimeout(800)
  w = await at(realm)
  const wentAt = Date.now()
  // In the page, every frame: when the eye settles, what the world still wants, and the eye's path (for whether it went round).
  const watching = realm.evaluate(() => new Promise((done) => {
    const e = globalThis.engine, path = []
    const stop = e.watch(() => {
      const s = e.explore.state, f = e.me.feet
      if (s === 'going' && f) path.push(Math.atan2(e.pose.x * 10 - f.at[0], -(e.pose.z * 10 - f.at[2])))
      if (s !== 'in') return
      stop()
      let turned = 0
      for (let i = 1; i < path.length; i++) { let d = path[i] - path[i - 1]; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; turned += d }
      done({ wanted: e.world.stats.wanted, stale: e.world.stats.stale, far: e.far.whole, times: e.explore.times, turned: Math.abs(turned), now: performance.timeOrigin + performance.now() })
    })
  }))
  await page.mouse.click(w.x, w.y)
  const settled = await Promise.race([watching, new Promise((r) => setTimeout(() => r(null), 60_000))])
  check(!!settled, 'two clicks enter')
  if (!settled) throw new Error('the flight did not end')
  await realm.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  const took = (settled.times.settled - settled.times.went) / 1000, fetched = sent(armAt, settled.now), late2 = site.asked.filter((a) => a.at > settled.now && a.at < settled.now + 2500 && a.status === 200 && a.path.startsWith(releaseAt + 'tiles/')).length
  results.flight = { seconds: round(took, 2), turned: round(settled.turned * 180 / Math.PI), waited: settled.times.waited ? round((settled.times.settled - settled.times.waited) / 1000, 2) : 0, loadedBeforeSettle: round((settled.times.settled - settled.times.loaded) / 1000, 2), sinceFirstClick: fetched, afterGo: sent(wentAt, settled.now) }
  console.log(JSON.stringify(results.flight, null, 1))
  check(took >= 6 && took <= (settled.times.waited ? 18 : 10), `from the second click to the eye settled: ${round(took, 1)} s (6 to 10${settled.times.waited ? '; the round was drawn out to wait for the roof' : ''})`)
  check(settled.turned > Math.PI, `the eye went round the body: ${round(settled.turned * 180 / Math.PI)} degrees in one sweep`)
  check(settled.times.loaded > 0 && settled.times.loaded <= settled.times.settled && settled.wanted === 0 && settled.stale === 0 && (settled.far || settled.times.waited > 0), `what the roof needs was in before the eye settled: its tiles ${round((settled.times.settled - settled.times.loaded) / 1000, 1)} s before, no box of the world still to make (${settled.wanted} wanted), the far model whole for the view: ${settled.far}`)
  check(late2 === 0, `no tile comes in the 2.5 s after it settles (${late2})`)
  check(fetched.requests > 0, `${fetched.wireMB} MB in ${fetched.requests} requests between the first click and the eye settled: ${JSON.stringify(fetched.of)}`)
  await first.lift()
  await page.waitForTimeout(2500)
  const inside = await realm.evaluate(() => {
    const e = globalThis.engine, f = e.me.feet, s = e.explore.stand, card = document.querySelector('#realm .help'), vis = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    const r = card?.getBoundingClientRect(), sky = document.querySelector('#realm .sky'), fold = document.querySelector('#realm .fold')?.getBoundingClientRect()
    return { engaged: e.first.engaged, first: document.documentElement.classList.contains('first'), on: e.me.on, view: e.me.view, back: e.me.back, off: f && Math.hypot(f.at[0] - s.x, f.at[2] - s.z), high: f && f.at[1] - e.feet(Math.round(f.at[0]), Math.round(f.at[2])), yaw: Math.abs(e.pose.yaw - s.yaw), fov: e.fov, card: vis(card), keys: [...(card?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent.trim()), words: card?.textContent, right: r && innerWidth - r.right, top: r?.top, sky: vis(sky), fold: fold && [fold.right, fold.bottom], tools: vis(document.querySelector('#realm .tools')), faced: e.boards.faced('explore'), mode: e.input.top }
  })
  await page.screenshot({ path: join(shots, 'third-1280x720.png') })
  const beside = await realm.evaluate(beside_, squares)
  check(beside.off <= 50 && beside.board >= 60 && beside.body && beside.drop, `settled, the board's face is read beside the body: seen ${beside.off} degrees off face-on (50 at most), ${beside.board}% of its letters in the picture (60 or more; ${beside.clear}% clear of the controls), the body whole and clear of them: ${beside.body}, a drop in the picture: ${beside.drop}`)
  check(inside.engaged && !inside.first && (await told()).filter((t) => t === 'engaged').length === 1, 'the visitor is in: the controls are shown, and the host is told `engaged` once')
  check(inside.on && inside.view === 'behind' && inside.back > 20 && inside.off < 15 && Math.abs(inside.high) < 4 && inside.yaw < 0.01, `the eye is behind their own body, which stands where the record says (${round(inside.off / 10, 2)} m off, the eye ${round(inside.back / 10, 1)} m back)`)
  check(inside.card && inside.keys.join() === 'Space,B' && /in the air to deploy a parachute/.test(inside.words) && /to fly/.test(inside.words) && inside.right < 40 && inside.top < 120, `the card at the top right says the two keys: ${inside.keys.join(' and ')}`)
  check(!inside.sky && inside.fold && inside.top >= inside.fold[1], 'the hour\'s panel is folded behind its key, and the card is under that key')
  check(!inside.faced, 'from the roof the board is its cells, not its face')

  // ── The fall, the canopy, flying ──
  console.log('\nthe fall and the canopy')
  const roof = await realm.evaluate(() => globalThis.engine.me.feet.at[1])
  const track = () => realm.evaluate(() => { const m = globalThis.engine.me, f = m.feet; return { t: performance.now(), y: f.at[1], x: f.at[0], z: f.at[2], aloft: m.aloft, canopy: m.canopy } })
  // (Turned first to the roof's north edge at the right of the picture, where the drop is: ahead of where it arrives is
  // the sign. The edge has a parapet a run stops at, and a jump takes the body over it.)
  await realm.evaluate(() => { globalThis.engine.pose.yaw = (300 * Math.PI) / 180 }); await page.waitForTimeout(300)
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW')
  await page.waitForTimeout(2000); await page.keyboard.press('Space')
  // (From aloft and 8 m under the roof: the roof has steps a body hops off, and the jump goes up before it comes down.)
  const offEdge = await until(realm, (roof) => globalThis.engine.me.aloft && globalThis.engine.me.feet.at[1] < roof - 8, 25_000, roof)
  const f0 = await track(); await page.waitForTimeout(700); const f1 = await track(); await page.waitForTimeout(300); const f2 = await track()
  await page.screenshot({ path: join(shots, 'fall-1280x720.png') })
  const early = (f0.y - f1.y) / (f1.t - f0.t) * 100, later = (f1.y - f2.y) / (f2.t - f1.t) * 100
  // (Timed from 8 m under the roof, so already falling: over 4 m/s by the second look and 2 m/s faster than at the
  // first (free fall gains about 5 between them). The body is stepped by the frame, and on a GPU shared with other
  // checks a second of the fall is fewer steps than a second.)
  check(offEdge && f2.aloft && later > early + 2 && later > 4, `a step off the edge is a fall that gathers speed: ${round(early)} then ${round(later)} m/s down`)
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')
  // Back over the roof for the canopy, in front of the board (behind the stand is the board itself).
  await realm.evaluate(() => { const e = globalThis.engine, s = e.explore.stand; e.me.walk(false); Object.assign(e.pose, { x: s.x / 10 + 4, y: e.pose.y + 60, z: s.z / 10 - 1.5, yaw: s.yaw }); e.me.walk(true) })
  await until(realm, () => globalThis.engine.me.aloft && globalThis.engine.me.feet, 10_000)
  await page.waitForTimeout(500)
  await page.keyboard.press('Space')
  await page.waitForTimeout(900)
  const c0 = await track()
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); const c1 = await track(); await page.keyboard.up('KeyW')
  await page.screenshot({ path: join(shots, 'canopy-1280x720.png') })
  const sink = (c0.y - c1.y) / (c1.t - c0.t) * 100, glide = Math.hypot(c1.x - c0.x, c1.z - c0.z) / (c1.t - c0.t) * 100
  check(c0.canopy && c1.canopy && sink > 2.5 && sink < 5.5, `Space in the air opens a canopy that sinks at ${round(sink)} m/s (4)`)
  check(glide > 3, `it is steered: ${round(glide)} m/s across with W held`)
  const landed = await until(realm, () => !globalThis.engine.me.aloft && !globalThis.engine.me.canopy, 40_000), down = await track()
  await page.screenshot({ path: join(shots, 'landed-1280x720.png') })
  check(landed && down.y < roof + 600, `it lands and the canopy is gone (${round((down.y) / 10)} m, on its feet: ${!down.aloft})`)
  await page.keyboard.press('KeyB')
  await page.waitForTimeout(400)
  check(!(await realm.evaluate(() => globalThis.engine.me.on)), 'B flies: the body is taken up')
  const gone = await until(realm, () => !document.querySelector('#realm .help'), 8000)
  check(gone, 'both done, the card goes')
  await first.context.close()

  // ── The host's word ──
  console.log('\nthe host\'s `explore`')
  {
    // Asked once, and the eye then taken to another board (the host's `fly`): the ask is over, and the lens as it was.
    const { context, page, realm } = await open(WIDE, { hosted: true })
    const calm = await eye(realm), w0 = await at(realm)
    await page.mouse.click(w0.x, w0.y); await page.waitForTimeout(900)
    const leant = await eye(realm)
    await page.evaluate(() => window.ask({ type: 'fly', board: 'blog' }))
    await page.waitForTimeout(3000)
    const flown = { state: await state(realm), eye: await eye(realm) }
    check(leant.fov < calm.fov && flown.state === 'idle' && Math.abs(flown.eye.fov - calm.fov) < 1e-3 && Math.hypot(flown.eye.at[0] - calm.at[0], flown.eye.at[2] - calm.at[2]) > 20, `asked once and then flown to BLOG by the host: the ask is over (${flown.state}) and the lens as it was (${round(calm.fov, 2)}, leant ${round(leant.fov, 2)}, then ${round(flown.eye.fov, 2)})`)
    await context.close()
  }
  {
    // From the park, as a host's visitor is.
    const { context, page, realm } = await open(WIDE, { hosted: true })
    await page.evaluate(() => window.ask({ type: 'explore' }))
    await page.waitForTimeout(300)
    const going = await state(realm)
    // A press in the flight on a board that leads somewhere (BLOG, or a logo on the towers flown past), while it is in the picture (seen frame by frame, from the moment a press cuts),
    // held until the visitor is in and let go only then: it cuts to the end, and the click that comes of it opens no
    // board and takes no pointer.
    const blog = await realm.evaluate(() => new Promise((done) => { const look = () => { const e = globalThis.engine; if (e.explore.state !== 'going') return done(null); if (performance.now() - e.explore.times.went > 380) for (const r of e.boards.records) { const w = r.to && e.boards.where(r.id); if (w && w.x > 10 && w.x < innerWidth - 10 && w.y > 10 && w.y < innerHeight - 10) return done([w.x, w.y, r.id]) } requestAnimationFrame(look) }; look() }))
    if (blog) { await page.mouse.move(blog[0], blog[1]); await page.mouse.down() }
    const cutting = await realm.evaluate(() => new Promise((done) => setTimeout(() => done(globalThis.engine.explore.state === 'in' || !!document.querySelector('#explore-still')), 350)))
    const in1 = await until(realm, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, 30_000)
    await page.waitForTimeout(500)
    await page.mouse.up()
    await page.waitForTimeout(2500)
    const after = await realm.evaluate(() => { const e = globalThis.engine, f = e.me.feet, s = e.explore.stand; return { off: f ? Math.hypot(f.at[0] - s.x, f.at[2] - s.z) : null, on: e.me.on, locked: !!document.pointerLockElement || e.input.locked } })
    const heard = await page.evaluate(() => window.told.map((m) => m.type))
    check(going === 'going' && in1 && heard.filter((t) => t === 'engaged').length === 1, 'it is meant: the flight at once, nothing asked twice, and `engaged` told')
    check(!!blog && cutting && !heard.includes('navigate') && !after.locked && after.on && after.off !== null && after.off < 30, `a press in the flight on ${blog ? blog[2] : 'a board that leads somewhere (none was in the picture)'} cuts to the end at once (${cutting}), and let go half a second after the visitor is in it does no more: no board is opened, the pointer is not taken (${after.locked ? 'taken' : 'free'}), the body stands on the roof (${after.off === null ? 'no body' : `${round(after.off / 10, 1)} m off`})`)
    // The next click is a click again: on the sign beside them too, which has nothing left to do once they are in.
    const sign = await realm.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return w && w.x > 20 && w.x < innerWidth - 20 && w.y > 20 && w.y < innerHeight - 20 ? [w.x, w.y] : null })
    if (sign) { await page.mouse.click(sign[0], sign[1]); await page.waitForTimeout(400) }
    const onSign = await realm.evaluate(() => ({ locked: !!document.pointerLockElement || globalThis.engine.input.locked, state: globalThis.engine.explore.state }))
    check(!!sign && onSign.locked && onSign.state === 'in' && !(await page.evaluate(() => window.told.map((m) => m.type))).includes('navigate'), `and the next click is heard as any click in the realm is, on the EXPLORE board beside them too${sign ? ` (at ${sign.map(Math.round).join(', ')})` : ' (it was not in the picture)'}: it takes the pointer (${onSign.locked ? 'taken' : 'free'}) and nothing else`)
    await realm.evaluate(() => document.exitPointerLock()); await page.waitForTimeout(400)
    await page.mouse.click(120, 300); await page.waitForTimeout(400)
    check(await realm.evaluate(() => !!document.pointerLockElement || globalThis.engine.input.locked), 'and off it: it takes the pointer')
    await context.close()
  }
  {
    // Said before `ready`, by a host that does not wait for it, on the throttled link from a cold cache: the tight
    // case, with no ask before the flight for the roof's tiles to come in. All of them cross the wire in the flight.
    const context = await browser.newContext(WIDE), page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 })
    const lift = () => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await page.goto(`${site.url}/host-early.html`)
    const realm = page.frames().find((f) => f.url().includes('/sf/index.html'))
    // (Watched from the frame the way in comes in: the flight begins with it.)
    await realm.waitForFunction(() => globalThis.engine?.explore && globalThis.engine.watch, null, { timeout: 240_000, polling: 'raf' })
    const settled = await realm.evaluate(() => new Promise((done) => { const e = globalThis.engine, stop = e.watch(() => { if (e.explore.state !== 'in') return; stop(); done({ wanted: e.world.stats.wanted, stale: e.world.stats.stale, far: e.far.whole, times: e.explore.times, feet: !!e.me.on, late: performance.now() - e.explore.times.settled, now: performance.timeOrigin + e.explore.times.settled }) }); setTimeout(() => { stop(); done(null) }, 90_000) }))
    await realm.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 }).catch(() => null)
    // Where its feet are a little after: on the roof it was to stand on, not through it.
    const place = () => realm.evaluate(() => { const e = globalThis.engine, f = e.me.feet, s = e.explore.stand, b = e.boards.records.find((r) => r.id === 'explore'); return f ? { off: Math.hypot(f.at[0] - s.x, f.at[2] - s.z), high: f.at[1] - b.at[1], aloft: e.me.aloft } : null })
    const stood = await place()
    const took = settled ? (settled.times.settled - settled.times.went) / 1000 : 0, waited = settled?.times.waited ? (settled.times.settled - settled.times.waited) / 1000 : 0
    const inFlight = settled ? sent(settled.now - took * 1000, settled.now) : null, afterIt = settled ? sent(settled.now, settled.now + 5000) : null
    await page.waitForTimeout(5200)
    const after5 = settled ? sent(settled.now, settled.now + 5000) : null, stays = await place()
    results.tight = { seconds: round(took, 2), waited: round(waited, 2), loadedBeforeSettle: settled ? round((settled.times.settled - settled.times.loaded) / 1000, 2) : null, inFlight, afterSettle5s: after5 }
    console.log(JSON.stringify(results.tight, null, 1))
    void afterIt
    await lift()
    check(!!settled && (await page.evaluate(() => window.told.filter((m) => m.type === 'engaged').length)) === 1, 'said before `ready` it is kept: the flight as soon as the way in has come')
    check(!!settled && settled.late < 100, `the eye's settling was watched as it happened (${Math.round(settled?.late ?? -1)} ms after)`)
    check(!!settled && settled.feet && settled.times.loaded > 0 && settled.times.loaded <= settled.times.settled && settled.wanted === 0 && settled.stale === 0 && (settled.far || waited > 0), `with no ask before it, on ${mbit} Mbit/s: ${inFlight?.wireMB} MB crossed in the flight (${JSON.stringify(inFlight?.of)}), the roof's tiles in ${round((settled?.times.settled - settled?.times.loaded) / 1000, 1)} s before the eye settled, no box of the world still to make, the far model whole: ${settled?.far}; ${round(took, 1)} s${waited ? `, the round drawn out ${round(waited, 1)} s` : ''}`)
    check(!!stood && !!stays && stood.off < 30 && stays.off < 30 && Math.abs(stood.high) < 30 && Math.abs(stays.high) < 30 && !stays.aloft, `its body stands on the roof by the sign, then and five seconds on: ${stood ? `${round(stood.off / 10, 1)} m from its place, ${round(stood.high / 10, 1)} m over the sign's foot` : 'no body'}; ${stays ? `${round(stays.off / 10, 1)} m, ${round(stays.high / 10, 1)} m${stays.aloft ? ', in the air' : ''}` : 'no body'}`)
    check(took >= 6 && took <= 18 && (after5?.of.tiles ?? 0) === 0, `it took ${round(took, 1)} s (6 to 10, or to 18 with the round drawn out), and in the 5 s after it no tile came: ${JSON.stringify(after5?.of)} (${after5?.wireMB} MB)`)
    await context.close()
  }

  // ── The keyboard; a key in the flight ──
  console.log('\nthe keyboard')
  {
    const { context, page, realm } = await open(WIDE)
    let focused = false
    for (let i = 0; i < 12 && !focused; i++) { await page.keyboard.press('Tab'); focused = await realm.evaluate(() => document.activeElement?.dataset?.board === 'explore') }
    const seen = focused && (await realm.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.width > 20 }))
    await page.keyboard.press('Enter'); await page.waitForTimeout(500)
    const once = await realm.evaluate(() => ({ state: globalThis.engine.explore.state, hint: document.querySelector('#explore-hint').textContent }))
    // The second Enter held down, saying itself again through the first second of the flight: it is the key that asked, and cuts nothing.
    await page.keyboard.down('Enter'); await page.waitForTimeout(500); await page.keyboard.down('Enter'); await page.waitForTimeout(400); await page.keyboard.down('Enter'); await page.waitForTimeout(150)
    const twice = await realm.evaluate(() => ({ state: globalThis.engine.explore.state, cut: !!document.querySelector('#explore-still') }))
    await page.keyboard.up('Enter')
    check(focused && seen && once.state === 'armed' && /Press Enter again/.test(once.hint) && twice.state === 'going' && !twice.cut, `Tab reaches the board's button, which is then seen; Enter asks ("${once.hint}"), Enter again goes; held on into the flight it cuts nothing (${twice.state}${twice.cut ? ', cut' : ''})`)
    // Late in the flight, when the roof is made and the cut is at once: Backspace, which in the realm puts the world back and the eye at the park.
    await page.waitForTimeout(4000)
    const pressed = Date.now()
    await page.keyboard.press('Backspace')
    const atOnce = await realm.evaluate(() => new Promise((done) => setTimeout(() => done(globalThis.engine.explore.state === 'in' ? 'in' : document.querySelector('#explore-still') ? 'fading' : null), 300)))
    const cut = await until(realm, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, 20_000), took = Date.now() - pressed
    await page.waitForTimeout(2000)
    const there = await realm.evaluate(() => { const e = globalThis.engine, f = e.me.feet, s = e.explore.stand; return { off: f ? Math.hypot(f.at[0] - s.x, f.at[2] - s.z) : null, eye: Math.hypot(e.pose.x * 10 - s.x, e.pose.z * 10 - s.z), on: e.me.on } })
    check(cut && !!atOnce && took < 12_000, `a key in the flight cuts to the end, at once: 0.3 s after it the visitor is ${atOnce ?? 'still flying'} (in and on its feet ${round(took / 1000, 1)} s after)`)
    check(there.on && there.off !== null && there.off < 30 && there.eye < 300, `and does no more: Backspace did not put the world back (the body ${there.off === null ? 'is gone' : `${round(there.off / 10, 1)} m from where it stands`}, the eye ${round(there.eye / 10)} m from it)`)
    await context.close()
  }

  // ── A realm with no board that leads in ──
  console.log('\nno way in')
  {
    const context = await browser.newContext(WIDE), page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${site.url}/sf/index.html?knock=0&boards=0`)
    await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.first, null, { timeout: 300_000 })
    await page.waitForTimeout(1500)
    const before = await page.evaluate(() => globalThis.engine.first.engaged)
    await page.keyboard.press('KeyW')
    await page.waitForTimeout(600)
    check(!before && (await page.evaluate(() => globalThis.engine.first.engaged)), 'with ?boards=0 nothing leads in: a key ends the first view, as it used to')
    await context.close()
  }
  {
    // The board is there and what it does could not be fetched: a click on the board itself ends the first view.
    const context = await browser.newContext(WIDE), page = await context.newPage()
    await page.route('**/page/explore.js', (route) => route.abort())
    await page.goto(`${site.url}/sf/index.html?knock=0`)
    await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.first && globalThis.engine.boards?.where('explore') && globalThis.engine.eggs, null, { timeout: 300_000 })
    await page.waitForTimeout(1500)
    const before = await page.evaluate(() => ({ engaged: globalThis.engine.first.engaged, way: !!globalThis.engine.explore }))
    const w = await at(page)
    await page.mouse.click(w.x, w.y)
    await page.waitForTimeout(600)
    check(!before.engaged && !before.way && (await page.evaluate(() => globalThis.engine.first.engaged)), 'with the board there and its flow not to be had (the fetch refused), a click on the board itself ends the first view')
    await context.close()
  }

  // ── Where motion is not wanted ──
  console.log('\nreduced motion')
  {
    const { context, page, realm } = await open({ ...WIDE, reducedMotion: 'reduce' })
    const w = await at(realm), before = await eye(realm)
    await page.mouse.click(w.x, w.y); await page.waitForTimeout(500)
    const once = await eye(realm)
    // Every frame from before the second click until it is in: how far the eye is from the park and from the roof. A flight passes between; a cut does not.
    const watching = realm.evaluate(() => new Promise((done) => { const e = globalThis.engine, s = e.explore.stand, from = [e.pose.x, e.pose.z], seen = []; const stop = e.watch(() => { seen.push([Math.hypot(e.pose.x - from[0], e.pose.z - from[1]), Math.hypot(e.pose.x - s.x / 10, e.pose.z - s.z / 10)]); if (e.explore.state === 'in') { stop(); done(seen) } }); setTimeout(() => { stop(); done(seen) }, 30_000) }))
    // And the still picture laid over the page meanwhile: that it is a picture (the first view, which has sky and city in it), not a blank.
    const laid = realm.evaluate(() => new Promise((done) => { const t0 = performance.now(), look = () => { const c = document.querySelector('#explore-still'); if (c) { const small = new OffscreenCanvas(64, 36), g = small.getContext('2d'); g.drawImage(c, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let sum = 0, squares = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; squares += l * l } const mean = sum / (d.length / 4); return done({ mean: Math.round(mean), spread: Math.round(Math.sqrt(squares / (d.length / 4) - mean * mean)) }) } if (performance.now() - t0 > 8000) return done(null); requestAnimationFrame(look) }; look() }))
    await page.waitForTimeout(200)
    await page.mouse.click(w.x, w.y)
    // While the still picture waits for the roof, the eye is on the roof already, under it: a click where a board
    // that leads somewhere stands in that view (unseen, under the still picture) opens nothing.
    // (Where no such board is in that view, as from a roof looking away from them all, a click on the middle of the
    // picture: what is checked then is that the press reaches nothing of the page's, on the canvas or past it.)
    const under = await realm.evaluate(() => new Promise((done) => { const t0 = performance.now(), look = () => { const e = globalThis.engine, b = e.boards; if (document.querySelector('#explore-still')) { for (const r of b.records) { const w = r.to && b.where(r.id); if (w && w.x > 20 && w.x < innerWidth - 20 && w.y > 20 && w.y < innerHeight - 20) return done({ id: r.id, x: w.x, y: w.y, state: e.explore.state }) } globalThis.heard = 0; const c = document.querySelector('canvas'); for (const t of ['pointerdown', 'click']) c.addEventListener(t, () => globalThis.heard++); return done({ id: null, x: innerWidth / 2, y: innerHeight / 2, state: e.explore.state }) } if (e.explore.state === 'in' || performance.now() - t0 > 8000) return done(null); requestAnimationFrame(look) }; look() }))
    const told = []
    // (What it would open is asked for and refused here: nothing leaves this machine, and the page stays to be looked at.)
    page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) told.push(r.url()) })
    await page.route((url) => !url.href.startsWith(site.url), (route) => route.abort())
    if (under) await page.mouse.click(under.x, under.y)
    const path = await watching, still = await laid
    await page.waitForTimeout(2600)
    const reached = await realm.evaluate(() => ({ heard: globalThis.heard ?? 0, locked: !!document.pointerLockElement || globalThis.engine.input.locked }))
    check(!!under && under.state === 'going' && told.length === 0 && page.url().includes('/sf/index.html') && (await state(realm)) === 'in' && (under.id || (reached.heard === 0 && !reached.locked)), `a click ${under?.id ? `where ${under.id} stands` : `on the picture (no board that leads anywhere is in the roof's view; the canvas heard ${reached.heard} of it, the pointer ${reached.locked ? 'taken' : 'free'})`} under the still picture, while the roof is waited for, opens nothing${told.length ? ` (it asked for ${told[0]})` : ''}: the page is where it was, and the visitor in`)
    const between = path.filter(([park, roof]) => park > 30 && roof > 30).length, started = path.length > 0 && path[0][0] < 1, ended = path.length > 0 && path.at(-1)[1] < 30
    await page.waitForTimeout(1200)
    check(same(once, before), 'asked once, the eye does not lean')
    check((await state(realm)) === 'in' && started && ended && between === 0 && !(await realm.evaluate(() => document.querySelector('#explore-still'))), `asked twice, no flight: the eye is at the park and then on the roof (${between} of ${path.length} frames between), the still picture faded away`)
    check(!!still && still.spread > 20 && still.mean > 40, `the still picture that fades is the first view, not a blank: its light ${still?.mean} of 255, spread ${still?.spread} (20 or more)`)
    await context.close()
  }

  // ── A phone opened on its side, then turned upright: framed as an upright phone is, the board in its picture ──
  console.log('\na phone turned upright')
  {
    const { context, page, realm } = await open({ ...PHONE, viewport: { width: 844, height: 390 } })
    const wide = await at(realm)
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1500)
    const w = await at(realm), fov = await realm.evaluate(() => globalThis.engine.fov)
    const lens = JSON.parse(readFileSync(join(here, 'sf/realm.json'), 'utf8')).upright.fov
    check(!!w && w.x - w.wide / 2 > 0 && w.x + w.wide / 2 < 390 && w.y > 0 && w.y < 844 && Math.abs(fov - lens) < 0.01, `opened on its side (the board at ${wide ? Math.round(wide.x) : 'none'} of 844 px) and turned upright, it is framed as an upright phone: the board at ${w ? `${Math.round(w.x - w.wide / 2)} to ${Math.round(w.x + w.wide / 2)}` : 'none'} of 390 px, the lens ${round(fov, 2)} degrees`)
    // On its side again, the board asked once, and turned upright while it is asked: when the ask is over (six
    // seconds) and the eye has leant back, it is framed as an upright phone, not as it was when it was asked.
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1200)
    const side = await at(realm)
    await page.touchscreen.tap(side.x, side.y); await page.waitForTimeout(600)
    const asked = await state(realm)
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(8000)
    const w2 = await at(realm), after = await realm.evaluate(() => ({ fov: globalThis.engine.fov, state: globalThis.engine.explore.state }))
    check(asked === 'armed' && after.state === 'idle' && !!w2 && w2.x - w2.wide / 2 > 0 && w2.x + w2.wide / 2 < 390 && Math.abs(after.fov - lens) < 0.01, `turned upright while the board was asked (${asked}), then left: ${after.state}, the board at ${w2 ? `${Math.round(w2.x - w2.wide / 2)} to ${Math.round(w2.x + w2.wide / 2)}` : 'none'} of 390 px, the lens ${round(after.fov, 2)} degrees`)
    await context.close()
  }

  // ── The controls kept off the body (`?hud=wheel`, play-hud.ts): the settled picture clear of them too, on a phone ──
  console.log('\nthe settled picture with ?hud=wheel')
  {
    const { context, page, realm } = await open(PHONE, { query: '&hud=wheel' })
    const all = (await realm.evaluate(() => globalThis.engine.boards.marks('explore'))).length
    await realm.evaluate(() => globalThis.engine.explore.go())
    await until(realm, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, 60_000)
    await page.waitForTimeout(2500)
    const w = await realm.evaluate(beside_, all)
    await page.screenshot({ path: join(shots, 'third-390x844-wheel.png') })
    check(w.off <= 50 && w.clear >= 60 && w.body && w.drop, `with ?hud=wheel on a phone, settled: the board ${w.off} degrees off face-on, ${w.board}% of its letters in the picture and ${w.clear}% clear of the controls (60 or more), the body whole and clear of them: ${w.body}, a drop in the picture: ${w.drop}`)
    await context.close()
  }

  // ── A phone ──
  console.log('\nan upright phone')
  {
    const { context, page, realm } = await open(PHONE)
    await realm.evaluate(() => { globalThis.engine.scale = 0.5 })
    await page.waitForTimeout(1500)
    const v = await realm.evaluate(() => { const b = globalThis.engine.boards, w = b.where('explore'), o = b.where('blog'); return { inside: w.x - w.wide / 2 > 0 && w.x + w.wide / 2 < innerWidth && w.y > 0 && w.y < innerHeight, wide: w.wide, tall: w.tall, blog: o.tall, faced: b.faced('explore'), blogFaced: b.faced('blog'), clear: Math.abs(w.y - o.y) > (w.high + o.high) / 2 } })
    await page.screenshot({ path: join(shots, 'first-390x844.png') })
    const idleP = await read(page, realm)
    const hitP = await target(page, realm)
    results.board.phone = { face: [round(v.wide), round(v.tall)], target: hitP }
    // (A thumb wants 44 px each way: Apple's least for a touch target. The owner's 47 degree lens on an upright phone draws
    // the face 40 px by 13 (Nov 22); that it reads is the picture's to say, just below.)
    check(v.inside && v.clear && v.tall >= 12 && v.wide >= 36 && hitP.wide >= 44 && hitP.high >= 44, `the board is in the phone's picture, ${round(v.wide)} px wide and ${round(v.tall)} tall, clear of BLOG; a tap is on it ${hitP.wide} x ${hitP.high} px round its middle (44 each way or more)`)
    check(v.faced && !v.blogFaced && idleP.lamp - idleP.panel > 60, `shown as its face there (BLOG as its cells, as it always was), and read from the picture: lamp ${idleP.lamp}, panel ${idleP.panel}`)
    // The whole first view on the phone, as it was asked for (#450: aa429ad8's cut BLOG at the left, and Twitch and the
    // Pyramid were out of it): BLOG, the three logos, EXPLORE, the banner and the Pyramid in the picture, and still when a tap leans
    // the eye to the board. (The banner's plane is kept in the picture on its round: waited for, a few seconds at most.)
    await until(realm, () => { const p = globalThis.engine.boards.plane?.box; return !!p && p.x0 >= 4 && p.x1 <= innerWidth - 4 }, 20_000)
    const restP = await framed(realm)
    let w = await at(realm)
    await page.touchscreen.tap(w.x, w.y); await page.waitForTimeout(900)
    const once = await realm.evaluate(() => ({ state: globalThis.engine.explore.state, hint: document.querySelector('#explore-hint').textContent, engaged: globalThis.engine.first.engaged }))
    const leanP = await framed(realm)
    await page.screenshot({ path: join(shots, 'armed-390x844.png') })
    check(!restP.out.length && !leanP.out.length && !restP.under && !leanP.under, `the phone's first view holds BLOG, X, LinkedIn, Twitch, EXPLORE, the banner and the Pyramid whole${restP.out.length ? `; out of it: ${restP.out.join(', ')}` : ''}${leanP.out.length ? `; leaning to the board, out of it: ${leanP.out.join(', ')}` : ', and so it does leaning to the board'}${restP.under || leanP.under ? '; BLOG is under the credits key' : ''}`)
    w = await at(realm)
    await page.touchscreen.tap(w.x, w.y)
    const in2 = await until(realm, () => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, 60_000)
    await page.waitForTimeout(3000)
    await page.screenshot({ path: join(shots, 'third-390x844.png') })
    // (Of the phone's own squares: a phone's board is set in the compact set, and has fewer of them.)
    const besideP = await realm.evaluate(beside_, idleP.marks)
    check(besideP.off <= 50 && besideP.board >= 60 && besideP.body && besideP.drop, `on the phone too, settled: the board seen ${besideP.off} degrees off face-on, ${besideP.board}% of its letters in the picture (${besideP.clear}% clear of the controls), the body whole and clear of them: ${besideP.body}, a drop in the picture: ${besideP.drop}`)
    const thumbs = await realm.evaluate(() => { const vis = (el) => !!el && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }), t = (s) => document.querySelector(s)?.textContent.trim(); return { walks: vis(document.querySelector('#realm .walks')) && t('#realm .walks'), up: vis(document.querySelector('#realm .act .up')) && t('#realm .act .up'), card: [...document.querySelectorAll('#realm .help kbd')].map((k) => k.textContent.trim()), fov: globalThis.engine.fov } })
    check(once.state === 'armed' && !once.engaged && /Tap again to explore/.test(once.hint) && in2, `one tap asks ("${once.hint}"), a second enters`)
    check(thumbs.walks === 'Fly' && thumbs.up === 'Jump' && thumbs.card.join() === 'Chute,Fly', `a thumb has the keys: ${thumbs.up} (in the air: Chute), ${thumbs.walks}; the card names ${thumbs.card.join(' and ')}`)
    // The key that rises opens the canopy in the air.
    await realm.evaluate(() => { const e = globalThis.engine; e.me.walk(false); e.pose.y += 60; e.me.walk(true) })
    await until(realm, () => globalThis.engine.me.aloft && globalThis.engine.me.feet, 10_000)
    await page.waitForTimeout(400)
    const label = await realm.evaluate(() => document.querySelector('#realm .act .up').textContent.trim()), key = await realm.evaluate(() => { const r = document.querySelector('#realm .act .up').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
    await page.touchscreen.tap(key[0], key[1])
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(shots, 'canopy-390x844.png') })
    check(label === 'Chute' && (await realm.evaluate(() => globalThis.engine.me.canopy)), 'in the air that key says Chute, and a tap on it opens the canopy')
    await context.close()
  }
  check(errors.length === 0, `no errors on any page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) {
  console.log(`  FAIL ${e.message.split('\n')[0]}`)
  failures.push(e.message.split('\n')[0])
} finally {
  await browser.close()
  site.stop()
  back()
}
writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1))
console.log(failures.length ? `\nsf-explore: ${failures.length} failed\n${failures.map((f) => `  - ${f}`).join('\n')}` : '\nsf-explore: passed')
process.exit(failures.length ? 1 : 0)
