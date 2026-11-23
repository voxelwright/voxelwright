// The SF realm's billboards and its banner plane, checked (#450): the folder `node sf/build.mjs` writes, served as
// plain files and held in a frame by a host page, as the site will hold it. Chrome with WebGPU; one GPU is shared, so a
// failed run is worth one more before it is believed.
//
//   node test/sf-boards.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/boards/r2] [--mbit 25] [--seconds 8] [--hud wheel|context|quiet]
//   (`--hud`: the realm with that way of having its controls in play, play-hud.ts: its own keys are the controls measured.)
//
// It fails unless:
//   - the park is shown within 8 MB over the wire on a cold cache, the boards' code among it, the editor's not;
//   - the host is told `ready` with every board, and every board is a link with its name in the frame;
//   - the first view is clean: until the visitor is in the realm, nothing is over the picture but the credits key
//     (which holds every credit), and no key pressed ends it; the controls come when the visitor is in (the way in
//     is the EXPLORE board's, test/sf-explore.mjs);
//   - from the park's camera every board is in the picture and none over another, nothing stands between the eye and
//     it, a letter is 9 px tall or more, the picture itself is brighter where a letter's lamp is than where its panel
//     is, and where a logo is the picture has its brand's colours;
//   - a logo can be read from the park (READABLE below says how big that is and why), at 1280 x 720 and on the phone;
//     a roof sign stands on its tower's roof as the release's far tiles have it and no tower is before any of it;
//   - with the controls shown at 1280 x 720 no logo is under any of them (the hour's panel, the tools); on a phone,
//     where the tools are a column over the right of the skyline, what is under them is said;
//   - by night, before a tower's lit windows from where a flight to a logo ends, under 2% of the picture is burnt out
//     to white (it was 12.6% when a pane's light was spread as a lamp's);
//   - by night from the park, at the first view's own scale: the towers' lit windows are rows (their light changes a
//     quarter more up a wall than along it, or more: round 4's chessboard of blocks was 0.56), Salesforce
//     Tower's crown is lit (its mean light 110 of 255 or more, and twice the sky's beside it), and BLOG reads as by
//     day (lamp against panel, nine squares in ten right), at 1280 x 720 and on the phone;
//   - by night Salesforce Tower's shaft is lit as the towers round it are (sf-towers.mjs: as much of it lit window as
//     of the towers under the logos, from three quarters of the least to four thirds of the most, and as warm, within a
//     tenth), at 1280 x 720 and on the phone: it was 8.6% lit against their 20%, and cold;
//   - a roof sign is no wider than its tower: under both ends of its foot the tower is there, as seen from the park;
//   - on an upright phone with the controls shown (390 x 844), no board is under any of them: the fold, the tools,
//     the stick, the keys to fly and to use, the street's name;
//   - a click on a board or a logo flies the eye to it and tells the host `navigate` with where it leads (a logo: the
//     owner's page on that network); so does Enter on its link, the host's own `open`, and O flying free in front of it;
//   - on an upright phone the lettering and a logo are in the park's picture, a tap on the logo navigates, and every
//     logo is as big as READABLE asks when the eye is turned to it;
//   - realm.signs sets words on a lettering board (and refuses a picture there), an image and a video on the banner
//     (and on a digital board, if the file has one), from the page and from the host;
//   - a charge breaks a letter and leaves the others (by night the broken one gives no light, the others do), and reset puts every board back;
//   - the plane goes round far off, past the towers: its banner whole in the park's picture, small (the cloth 26 px
//     tall at most) and its words 10 px tall or more; with something to say it comes in to its near round, words 20 px,
//     and goes back out; on the phone its words are 11 px or more;
//   - the park holds 60 fps at picture scale 0.7 with the boards in view.
// Pictures are kept: the first view at both sizes, the controls coming, the park before and after, by night, a
// flight to a board and to each logo, a broken board, the banner passing at both sizes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, timed, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { seated } from '../sf/boards.mjs'
import { TOWERS, framed, lit as litTower } from './sf-towers.mjs'

const hud = arg('hud', ''), withHud = (path) => (hud ? `${path}${path.includes('?') ? '&' : '?'}hud=${hud}` : path)
const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'boards', 'r4')), mbit = Number(arg('mbit', '25')), seconds = Number(arg('seconds', '8'))
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const file = seated(JSON.parse(readFileSync(join(here, 'sf/boards.json'), 'utf8')))
/** The boards that are cells of the world (a logo is a face alone), and the logos. */
const built = file.boards.filter((b) => b.type !== 'logo'), logos = file.boards.filter((b) => b.type === 'logo')
/** Each mark's two colours as its sign shows them (page/logos.ts). */
/** How much of a logo's box in a picture is each of its brand's two colours: [the mark's, what it stands on]. `w` is where the logo is (boards.where), `within` how near a colour counts (from near, by day, a lit mark spreads into a glow that pales its colour: a wider measure there). */
const brandShare = (picture, w, logo, within = 90) => {
  const scale = 1
  const brand = BRAND[logo], near = [0, 0]
  let n = 0
  for (let y = Math.round((w.y - w.tall / 2) * scale); y <= (w.y + w.tall / 2) * scale; y++) for (let x = Math.round((w.x - w.wide / 2) * scale); x <= (w.x + w.wide / 2) * scale; x++) { const i = (y * picture.w + x) * 4; n++; brand.forEach((c, k) => { if (Math.hypot(picture.data[i] - c[0], picture.data[i + 1] - c[1], picture.data[i + 2] - c[2]) < within) near[k]++ }) }
  return [near[0] / Math.max(1, n), near[1] / Math.max(1, n)]
}
/**
 * How big a logo must be on the picture from the park, CSS px. Round 3's were 24 px (X) and 58 x 16 px (LinkedIn's
 * wordmark, its letters 11 px), and the owner could not read them; round 4's marks were 45 px, which he read and
 * then asked to have about 30% smaller (Nov 21): 31 px at 1280 x 720, and the phone's to match (37 px).
 *   - A mark (X, Twitch, LinkedIn's square) is 28 px or more each way at 1280 x 720 and no more than 35: his size,
 *     a tenth either way.
 *   - On a phone, the owner's 47 degree lens for an upright phone (Nov 22: it holds the Pyramid, the three logos,
 *     EXPLORE, BLOG and the banner) draws them about 19 px: 17 px or more and no more than 21, a tenth either way.
 *     sf-logos.mjs reads each mark at that size. A tap is taken 20 px round a sign under a thumb (boards.ts `under`),
 *     over the 44 px a touch target should be (Apple's guidelines; WCAG 2.5.5), and each is a link by name too.
 */
const READABLE = { wide: { mark: 28, most: 35 }, phone: { mark: 17, most: 21 } }
/** Whether a logo `tall` by `wide` px is as big as `bounds` asks, each way. */
const readable = (logo, tall, wide, bounds) => Math.min(tall, wide) >= bounds.mark && Math.max(tall, wide) <= bounds.most
/** In a page with its controls shown: each board's box against what the page lays over the picture (the hour's panel, the tools, the line of numbers, the street's name; a phone's fold, its stick where it rests, its keys to fly and to use). `logos` are the logos' boxes, `boards` every board's. */
const COVERED = () => {
  const b = globalThis.engine.boards, laid = [...document.querySelectorAll('#realm .sky, #realm .fold, #realm .tools, #realm .stick, #realm .fly, #realm .use, #hud, #where, #realm .act :is(.up, .down, .walks, .toolkey), #realm .held, #realm .cue.on, #realm .float.on, [data-panel="wand-take"]')].filter((el) => el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true).map((el) => ({ name: el.className || el.id, r: el.getBoundingClientRect() })).filter((l) => l.r.width > 0 && l.r.height > 0)
  const out = []
  for (const rec of b.records) { const w = b.where(rec.id); if (!w) continue; for (const l of laid) if (w.x - w.wide / 2 < l.r.right && w.x + w.wide / 2 > l.r.left && w.y - w.high / 2 < l.r.bottom && w.y + w.high / 2 > l.r.top) out.push(`${rec.id} under ${l.name}`) }
  return { under: out, laid: laid.map((l) => `${l.name} ${Math.round(l.r.left)},${Math.round(l.r.top)} to ${Math.round(l.r.right)},${Math.round(l.r.bottom)}`), ...Object.fromEntries([['logos', (r) => r.type === 'logo'], ['boards', () => true]].map(([name, which]) => [name, b.records.filter(which).map((r) => { const w = b.where(r.id); return w && `${r.id} ${Math.round(w.x - w.wide / 2)},${Math.round(w.y - w.high / 2)} to ${Math.round(w.x + w.wide / 2)},${Math.round(w.y + w.high / 2)}` })])) }
}
// (A mark alone, cut out, no plate behind it: X's near-black face and its lit edge, LinkedIn's white word and its blue square, Twitch's purple and its white face.)
const BRAND = { x: [[13, 13, 13], [255, 255, 255]], linkedin: [[255, 255, 255], [10, 102, 194]], twitch: [[145, 70, 255], [255, 255, 255]] }
/** In a page at its first view: watches it for some seconds and says what it shows (each board in the picture, the banner's cloth whole and readable, the keys' boxes) and what lies over what. */
const COMPOSED = async (ms) => {
  const e = globalThis.engine, b = e.boards, box = (el) => { const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } }
  const keys = { credits: box(document.querySelector('#first .credits')) }
  const boards = b.records.map((r) => { const w = b.where(r.id); return { id: r.id, type: r.type, box: w && { x0: w.x - w.wide / 2, y0: w.y - w.high / 2, x1: w.x + w.wide / 2, y1: w.y + w.high / 2 } } })
  const inside = (k) => !!k && k.x0 >= 0 && k.y0 >= 0 && k.x1 <= innerWidth && k.y1 <= innerHeight, meet = (a, c, by = 0) => a.x0 < c.x1 + by && a.x1 > c.x0 - by && a.y0 < c.y1 + by && a.y1 > c.y0 - by
  // The banner, every 200 ms: whole in the picture and readable, and whether a key was ever over it.
  let looks = 0, some = 0, whole = 0, read = 0, under = 0
  for (const until = performance.now() + ms; performance.now() < until; ) { const c = b.plane.box; looks++; if (c && c.x1 > 0 && c.y1 > 0 && c.x0 < innerWidth && c.y0 < innerHeight) some++; if (inside(c)) whole++; if (b.plane.readable) read++; if (c && Object.values(keys).some((k) => meet(c, k))) under++; await new Promise((r) => setTimeout(r, 200)) }
  // And its whole round, a 120th at a time, as it would be flown with nobody calling it back: how much of it the cloth is whole in the picture for.
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
  let round = 0
  for (let i = 0; i < 120; i++) { b.plane.hold = i / 120; await frame(); if (inside(b.plane.box)) round++ }
  b.plane.hold = null
  const atop = []
  for (const [name, k] of Object.entries(keys)) for (const s of boards) if (s.box && meet(k, s.box, 4)) atop.push(name + ' over ' + s.id)
  return { size: [innerWidth, innerHeight], keys, keysInside: Object.values(keys).every(inside), creditsIn: Math.round(Math.min(keys.credits.x0, keys.credits.y0, innerWidth - keys.credits.x1, innerHeight - keys.credits.y1)), shown: boards.filter((s) => inside(s.box)).map((s) => s.id), logos: boards.filter((s) => s.type === 'logo' && inside(s.box)).length, lettering: boards.some((s) => s.type === 'lettering' && inside(s.box)), banner: { looks, some, whole, read, under, round }, atop }
}
/** In a page with its controls shown: the banner's cloth at every 120th of its round, against what the page lays over the picture there (the hour's panel, or a phone's fold). How much of the round it can be read on, and where it passes under a control. */
const CLEAR = async () => {
  const p = globalThis.engine.boards.plane, frame = () => new Promise((r) => requestAnimationFrame(() => r()))
  const laid = [...document.querySelectorAll('#realm .sky, #realm .fold')].filter((el) => el.checkVisibility({ visibilityProperty: true })).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
  let read = 0; const under = []
  for (let i = 0; i < 120; i++) { p.hold = i / 120; await frame(); const c = p.box; if (p.readable) read++; if (c && c.x1 > 0 && c.y1 > 0 && c.x0 < innerWidth && c.y0 < innerHeight && laid.some((r) => c.x0 < r.right && c.x1 > r.left && c.y0 < r.bottom && c.y1 > r.top)) under.push(i) }
  p.hold = null
  return { read, of: 120, under, laid: laid.map((r) => [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]) }
}

/** How tall the words on the banner are in a picture of it, px of that picture: the run of ink down a column, at the ninth tenth of the columns that have any (a letter's stem; a stray pixel of the plane's red is left out). The cloth's ink is red on a pale ground. */
const inkTall = (picture, box) => {
  const runs = [], rows = picture.data.length / 4 / picture.w
  for (let x = Math.max(0, Math.floor(box.x0)); x < Math.min(picture.w, box.x1); x++) {
    let top = -1, bottom = -1
    for (let y = Math.max(0, Math.floor(box.y0)); y < Math.min(rows, box.y1); y++) { const i = (y * picture.w + x) * 4, r = picture.data[i], g = picture.data[i + 1], b = picture.data[i + 2]; if (r > 105 && g < r * 0.55 && b < r * 0.55) { if (top < 0) top = y; bottom = y } }
    if (top >= 0) runs.push(bottom - top + 1)
  }
  runs.sort((a, b) => a - b)
  return runs.length ? runs[Math.floor(runs.length * 0.9)] : 0
}
/**
 * How much the light of lit windows changes up a wall against along it, in a box of a night picture: the sum of the
 * steps in brightness from each pixel to the one under it over the sum to the one beside it, wherever one of them is
 * a lit window (brighter than 90 of 255 and warm: a lamp's, not the sky's or a sign's blue). Rows of windows change
 * from floor to floor and little along one: well over one. Blocks change both ways alike or more along: round 4's
 * chessboard was 0.56.
 */
const windowRows = (picture, box) => {
  const at = (x, y) => { const i = (y * picture.w + x) * 4, r = picture.data[i], g = picture.data[i + 1], b = picture.data[i + 2], l = (r + g + b) / 3; return [l, l > 90 && r > b * 1.15] }
  let up = 0, along = 0, lit = 0
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const [l, w] = at(x, y), [under, wu] = at(x, y + 1), [beside, wb] = at(x + 1, y)
    if (w) lit++
    if (w || wu || wb) { up += Math.abs(under - l); along += Math.abs(beside - l) }
  }
  return { ratio: round(up / Math.max(1, along), 2), litPct: round((lit / ((box.x1 - box.x0) * (box.y1 - box.y0))) * 100, 1) }
}
/** A lettering board as a picture has it: the mean light where its letters' lamp is and where its panel is, and how many squares of its letters are on the right side of half way between. `marks` are boards.marks (client px), `scale` the picture's pixels to one of those, `off` the picture's corner. */
const lettersRead = (picture, marks, scale = 1, off = [0, 0]) => {
  // (The pixel a point is in is its floor: rounded, half the points were read from the pixel beside theirs, and with a
  // square 1.5 px wide that put a column of samples off a letter's stroke, #450.)
  const light = (m) => { const i = (Math.floor((m.y - off[1]) * scale) * picture.w + Math.floor((m.x - off[0]) * scale)) * 4; return (picture.data[i] + picture.data[i + 1] + picture.data[i + 2]) / 3 }
  const lit = marks.filter((m) => m.lit).map(light), dark = marks.filter((m) => !m.lit).map(light), mean = (a) => a.reduce((n, v) => n + v, 0) / Math.max(1, a.length)
  const cut = (mean(lit) + mean(dark)) / 2, ok = (m) => (m.lit ? light(m) > cut : light(m) <= cut)
  return { lamp: Math.round(mean(lit)), panel: Math.round(mean(dark)), right: lit.filter((v) => v > cut).length + dark.filter((v) => v <= cut).length, of: marks.length, worst: worstLetter(marks, ok) }
}
/**
 * The letter read worst, and how much of it is read right: a board read well on the whole can still lose a stroke of
 * one letter (#450: by night from the park EXPLORE's O lost its right side and the board said EXPLCRE).
 */
const worstLetter = (marks, ok) => {
  const by = new Map()
  for (const m of marks) { const l = by.get(m.letter) ?? { right: 0, of: 0 }; l.of++; if (ok(m)) l.right++; by.set(m.letter, l) }
  let worst = { letter: -1, share: 1 }
  for (const [letter, l] of by) if (l.right / l.of < worst.share) worst = { letter, share: round(l.right / l.of, 2) }
  return worst
}
/** How much of each letter a board's squares must read right, as its letters' whole share is asked (`asked`): a little less, as one letter's squares are few. */
const LETTER_SHARE = 0.75
/** In a page: where Salesforce Tower's crown is on the picture (client px), from its light's own numbers (march.beacons, heroes.rs `night`): the box of its middle three fifths, and a box of sky beside it. */
const CROWN = () => {
  const e = globalThis.engine, rect = document.querySelector('canvas').getBoundingClientRect(), v = e.view()
  const on = (c) => { const d = [c[0] - v.eye[0], c[1] - v.eye[1], c[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]; return { x: (((d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (rect.width / rect.height) * far) + 1) / 2) * rect.width, y: ((1 - (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far)) / 2) * rect.height, far } }
  // (The one whose lit part has rings: the crown's screen.)
  const b = e.march.beacons.find((b) => b.night[8] > 0)
  if (!b) return null
  const [y0, y1, , half] = b.night, low = on([b.at[0], b.at[1] + (y0 + (y1 - y0) * 0.2) * 10, b.at[2]]), high = on([b.at[0], b.at[1] + (y0 + (y1 - y0) * 0.8) * 10, b.at[2]]), wide = ((half * 10) / low.far / v.tanHalf / 2) * rect.height
  return { x0: Math.round(low.x - wide), x1: Math.round(low.x + wide), y0: Math.round(high.y), y1: Math.round(low.y), sky: Math.round(wide * 8) }
}
// The host: a page with the realm in a frame over the whole of it, keeping what the realm tells it.
const HOST = `<!doctype html><meta charset="utf-8"><title>host</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
<iframe id="realm" src="${withHud('/sf/index.html')}" allow="autoplay"></iframe><script>window.told=[];addEventListener('message',(e)=>{if(e.data&&e.data.village==='realm')told.push(e.data)});window.ask=(m)=>document.getElementById('realm').contentWindow.postMessage({village:'realm',...m},'*')</script>`
const site = await plain(dist, '127.0.0.1', 0, { extra: (req, res) => { if (new URL(req.url, 'http://x').pathname !== '/host.html') return false; res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HOST); return true } })
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const results = { boards: file.boards.map((b) => b.id) }
const errors = []
const mb = (n) => round(n / 1048576, 2)
try {
  // ── Before: the park with no boards, for the picture ──
  const link = async (context, page) => { const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 }); return () => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }) }
  /** What crossed the wire from `from` until the place was shown in `frame`. */
  const untilShown = async (frame, from) => { const t = await frame.evaluate(() => ({ origin: performance.timeOrigin, near: globalThis.engine.seen.near })); return { ms: Math.round(t.near), wireMB: mb(site.asked.filter((a) => a.status === 200 && a.at >= from && a.at <= t.origin + t.near).reduce((n, a) => n + a.wire, 0)) } }
  /** Frame gaps at the park with the picture at 0.7 of its size, the best of up to three tries short of 60 fps (other lanes draw on this GPU). */
  const framesAt = async (target, wait) => {
    await target.evaluate(() => { globalThis.engine.scale = 0.7 }); await wait(4000)
    const take = () => target.evaluate(async (ms) => { const e = globalThis.engine, gaps = []; const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ms)); stop(); const g = gaps.filter((x) => x >= 2).sort((a, b) => a - b); return { frames: g.length, p50: g[Math.floor(g.length * 0.5)], p99: g[Math.min(g.length - 1, Math.floor(g.length * 0.99))], marchMs: e.gpuMs, cpuMs: e.cpuMs } }, seconds * 1000)
    let f = await take()
    for (let again = 0; again < 2 && f.p50 > 17.5; again++) { await wait(8000); const next = await take(); if (next.p50 < f.p50) f = next }
    return { p50: round(f.p50), p99: round(f.p99), marchMs: round(f.marchMs), cpuMs: round(f.cpuMs) }
  }
  const plainContext = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const bare = await plainContext.newPage()
  const unlink = await link(plainContext, bare), bareFrom = Date.now()
  await bare.goto(`${site.url}${withHud('/sf/index.html?boards=0&debug=1')}`)
  await bare.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 300_000 })
  const without = await untilShown(bare, bareFrom)
  await unlink()
  await bare.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 300_000 })
  const framesWithout = await framesAt(bare, (ms) => bare.waitForTimeout(ms))
  await bare.evaluate(() => { globalThis.engine.scale = 1 }); await bare.waitForTimeout(4000)
  await bare.screenshot({ path: join(shots, 'park-before.png') })
  check(await bare.evaluate(() => globalThis.engine.boards === null && globalThis.engine.world.done().length === 0), '?boards=0 leaves the boards out: no board, no edit in the world')
  // The line of numbers is `?debug=1`'s: asked for here, it comes with the controls (the page in the host's frame, below, does not ask).
  const numbers = await bare.evaluate(async () => { globalThis.engine.first.engage(); await new Promise((r) => setTimeout(r, 1200)); const h = document.querySelector('#hud'), c = getComputedStyle(h); return { shown: c.display !== 'none' && c.visibility !== 'hidden' && Number(c.opacity) > 0.5, text: h.textContent } })
  check(numbers.shown && /fps/.test(numbers.text), `with ?debug=1 the line of numbers comes with the controls ("${numbers.text.slice(0, 44)}…")`)
  // (It rests, not drawing, until its turn in the timing below: the next page loads as a visitor's would, alone.)
  await bare.evaluate(() => { globalThis.engine.resting = true })
  // Each board's foot is on its roof as this release has it: the file was made against a release, and the pin moves.
  const roofs = await bare.evaluate((boards) => boards.filter((b) => b.type !== 'logo').map((b) => ({ id: b.id, at: b.at[1], roof: globalThis.engine.feet(b.at[0], b.at[2]), ground: Math.round(globalThis.engine.ground(b.at[0] / 10, b.at[2] / 10) * 10) })), file.boards)
  // (A roof whose tiles the park does not hold, as a tower of the skyline's is not, is read from the far model's own: its roof as files.)
  {
    const { striker } = await import('../sf/far/strike.mjs'), pointer = JSON.parse(readFileSync(join(dist, 'sf', 'current.json'), 'utf8')), strike = striker(join(dist, 'sf', dirname(pointer.manifest)))
    for (const r of roofs) if (r.roof - r.ground < 60) { const b = file.boards.find((b) => b.id === r.id), hit = strike([b.at[0], 60000, b.at[2]], [0, -1, 0], 60000); if (hit) Object.assign(r, { roof: Math.round(hit.at[1]), far: true }) }
  }
  check(roofs.every((r) => Math.abs(r.roof - r.at) <= (r.far ? 15 : 2) && r.roof - r.ground >= 60), `every board's foot is on a roof of this release: ${roofs.map((r) => `${r.id} at ${r.at / 10} m on a roof at ${r.roof / 10} m${r.far ? ' (the far model\'s, within 1.5 m)' : ''}, ${round((r.roof - r.ground) / 10)} m over the ground`).join('; ')}`)

  // ── The first visit, cold, in the host's frame ──
  console.log(`\nfirst visit (cold cache, ${mbit} Mbit/s, 40 ms), in a host's frame`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  const unlinked = await link(context, page)
  const from = Date.now()
  await page.goto(`${site.url}/host.html`)
  const frame = () => page.frames().find((f) => f.url().includes('/sf/index.html'))
  await page.waitForFunction(() => window.told.some((m) => m.type === 'ready'), null, { timeout: 300_000 })
  const realm = frame()
  const shown = await untilShown(realm, from)
  const code = site.asked.filter((a) => a.at >= from && /\/page\/(boards|signs|screens|logos|host)\.js$/.test(a.path) && a.status === 200)
  const own = code.reduce((n, a) => n + a.wire, 0) + Buffer.byteLength(JSON.stringify(file))
  results.load = { placeShownMs: shown.ms, wireMB: shown.wireMB, without, boardsOwnKB: round(own / 1024), boardsCodeRawKB: round(code.reduce((n, a) => n + a.bytes, 0) / 1024) }
  await unlinked()
  // What the boards themselves add is exact: their five modules as sent, and their data in the page's record. The
  // whole (which stops at a moment, so it moves by a tile or two from run to run) is held to the realm's 8 MB where
  // the realm without boards is within it; where that is over already, it is said and the boards' own share is the check.
  check(own < 33 * 1024, `the boards add ${results.load.boardsOwnKB} KB before the park is shown: five modules as sent (${results.load.boardsCodeRawKB} KB unpacked) and their data in the page's record (bound 33 KB: 24 until the plane had two rounds, its own far off and a near one to speak on; 25 until a lettering board had a face to be read by from further off than its cells show it, 1.6 KB of boards.js, and the EXPLORE board its record; 27 until the letters were laid from the kit's glyph sets and lit of themselves, 1.2 KB more; 29 until the logos were drawn at the size they are seen, as pixel art when small, 2.6 KB more; 33 when a logo on another site got its card and the flight back to the view, 0.5 KB, the card itself in leaving.js and not counted; the face's glyph set, which sf-type says, and letterlight.js, 4.8 KB as sent, are modules of their own and not counted here)`)
  const whole = `${shown.wireMB} MB over the wire until the park is shown in ${shown.ms} ms; without boards ${without.wireMB} MB in ${without.ms} ms (the realm's bound 8 MB)`
  if (without.wireMB >= 8) console.log(`  WARN ${whole}: the realm is over its bound before any board`); else check(shown.wireMB < 8, whole)
  check(code.length === 5 && !site.asked.some((a) => a.path.endsWith('boards-edit.js')), `the boards' code is asked for (${code.length} modules) and the editor's is not`)
  const ready = await page.evaluate(() => window.told.find((m) => m.type === 'ready'))
  check(ready.boards.length === file.boards.length && file.boards.every((b) => ready.boards.some((r) => r.id === b.id && r.to === (b.to ?? null) && r.name === b.name)) && ready.signs.some((s) => s.id === 'banner'), `the host is told ready with ${ready.boards.length} boards (${ready.boards.map((b) => `${b.id} to ${b.to}`).join(', ')}) and ${ready.signs.length} signs`)
  const links = await realm.evaluate(() => [...document.querySelectorAll('nav[aria-label="Billboards"] a')].map((a) => ({ name: a.textContent, to: a.getAttribute('href'), focusable: a.tabIndex === 0 })))
  check(links.length === file.boards.filter((b) => b.to).length && links.every((l, i) => l.name === file.boards[i].name && l.to === file.boards[i].to && l.focusable), `every board is a link of the page by its name: ${links.map((l) => l.name).join(', ')}`)
  await realm.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 300_000 })
  // ── The first view: the picture and the credits key, and nothing else ──
  console.log('\nthe first view')
  /** What of the page is over the picture now: each thing that is seen and has a box, by what it is. */
  const over = (target) => target.evaluate(() => {
    const seen = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) }
    const one = (q) => seen(document.querySelector(q))
    const credits = document.querySelector('#first .credits').getBoundingClientRect()
    return { first: document.documentElement.classList.contains('first'), engaged: globalThis.engine.first.engaged, hud: one('#hud'), aim: one('#aim'), sky: one('#realm .sky'), tools: one('#realm .tools') || one('#realm .toolkey') || one('#realm .held'), fold: one('#realm .fold'), thumbs: one('#realm .use'), where: one('#where'), explore: one('#first .explore'), credits: one('#first .credits'), creditsBox: [Math.round(credits.width), Math.round(credits.height)], focus: document.activeElement?.tagName ?? '', wall: [...document.querySelectorAll('body *')].filter((el) => !el.closest('#first, nav, [popover]') && seen(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 40)).length, sources: [...document.querySelectorAll('#first-credits li')].map((li) => li.textContent) }
  })
  const firstView = await over(realm)
  await page.screenshot({ path: join(shots, 'first-desktop.png') })
  results.first = { desktop: firstView }
  // What the first view shows, over twelve seconds of it (its plane is kept in the picture until the visitor engages): the BLOG board, the banner and two logos or more, and the keys over none of them.
  const composedCheck = (c, name) => {
    // (A wide picture's round leaves it on one side and is brought back: some eight seconds of a lap of thirty-six the cloth is going or coming.)
    check(c.lettering && c.logos >= 2 && c.banner.round >= 66 && c.banner.some >= c.banner.looks * 0.6 && c.banner.whole >= c.banner.looks * 0.25, `${name}'s first view (${c.size.join(' x ')}) shows ${c.shown.join(', ')}; the banner's cloth is whole in the picture for ${c.banner.round} of 120 places on its round, and over twelve seconds some of it was in the picture at ${c.banner.some} of ${c.banner.looks} looks, the whole of it at ${c.banner.whole}, readable at ${c.banner.read} (asked: the lettering, two logos, the cloth whole for 66 places, in the picture three looks in five and whole at one in four)`)
    check(c.atop.length === 0 && c.banner.under === 0 && c.keysInside && c.creditsIn >= 12, `${name}: the credits key is over no board and never over the banner${c.atop.length ? ` (${c.atop.join(', ')})` : ''}, and the credits key is ${c.creditsIn} px in from the picture's edge (bound 12: its voxel body stands out past its box)`)
  }
  results.first.composed = await realm.evaluate(COMPOSED, 12000)
  composedCheck(results.first.composed, 'the desktop')
  check(firstView.first && !firstView.engaged && !firstView.hud && !firstView.aim && !firstView.sky && !firstView.tools && !firstView.where && firstView.wall === 0 && firstView.focus !== 'A', `before the visitor engages nothing is over the picture: no line of numbers, no aim, no hour and weather, no tools, no street name, no focus on a link, no wall of words (${JSON.stringify({ hud: firstView.hud, aim: firstView.aim, sky: firstView.sky, tools: firstView.tools, where: firstView.where, wall: firstView.wall })})`)
  check(!firstView.explore && firstView.credits && firstView.creditsBox[0] <= 96 && firstView.creditsBox[1] <= 40 && firstView.sources.length >= 3 && firstView.sources.some((c) => /OpenStreetMap/.test(c)), `no Explore key (a board is the way in), and a credits key of ${firstView.creditsBox.join(' x ')} px are there, and the credits key holds ${firstView.sources.length} sources (${firstView.sources.map((c) => c.slice(0, 28)).join(' | ')})`)
  const settle = () => realm.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 60_000, polling: 250 }).catch(() => null)
  await settle(); await page.waitForTimeout(3000)
  const park = await realm.evaluate(() => ({ ...globalThis.engine.pose }))
  const toPark = async () => { await realm.evaluate((p) => { const e = globalThis.engine; Object.assign(e.pose, p) }, park); await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(1500) }

  // ── Frames at the park, the boards and the plane in view: taken as the bare page's were, just after the world came whole ──
  console.log('\nframes at the park')
  // The bound is the realm's own; where the realm without boards misses it in this same run (other lanes draw on this
  // GPU), the boards are held to what that page did, and a margin of a tenth and a millisecond. Missed, it is measured
  // again with every turn on the GPU held (kit.mjs `timed`).
  // Measured again alone, the realm's own bound holds.
  const bound = Math.max(17.5, framesWithout.p50 * 1.1 + 1), resting = (on) => realm.evaluate((on) => { globalThis.engine.resting = on }, on)
  const f = await timed({
    check, first: { ...(await framesAt(realm, (ms) => page.waitForTimeout(ms))), bound }, idle: resting,
    measure: async () => ({ ...(await framesAt(realm, (ms) => page.waitForTimeout(ms))), bound: 17.5 }), passes: (f) => f.p50 <= f.bound,
    say: (f) => `the park at picture scale 0.7 with the boards and the plane: p50 ${f.p50} ms, p99 ${f.p99} ms, march ${f.marchMs} ms; without boards in this run p50 ${framesWithout.p50} ms, march ${framesWithout.marchMs} ms (bound ${round(f.bound)} ms)`,
  })
  results.frames = { ...f, without: framesWithout }

  // What the boards cost the GPU, which a frame gap held to 60 Hz cannot say: this page and the one without boards
  // turn about, each resting while the other is timed (the march and the far model at the canvas's full size, at
  // the GPU's own pace), and in this page the pass that draws the screens beside them. With every turn on the GPU
  // where they can be had in three minutes; where they cannot, and the bound is missed, measured again once they are
  // (kit.mjs `timed`).
  const boardsCost = async () => {
    const give = await quiet({ within: 180_000 })
    const rest = (target, on) => target.evaluate((on) => { globalThis.engine.resting = on }, on)
    // The least of the turns: whatever else draws on this GPU only ever adds to a turn.
    const least = (xs) => Math.min(...xs)
    const without = [], withBoards = [], screensMs = []
    try {
      for (let turnAbout = 0; turnAbout < 5; turnAbout++) {
        await rest(realm, true); await rest(bare, false); await bare.waitForTimeout(500)
        without.push((await bare.evaluate(() => globalThis.engine.farPasses(3))).withFar ?? 0)
        await rest(bare, true); await rest(realm, false); await page.waitForTimeout(500)
        const s = await realm.evaluate(() => globalThis.engine.signPasses(3))
        withBoards.push(s.world); screensMs.push(s.withSigns - s.world)
      }
    } finally { await rest(realm, false); give?.() }
    const c = (results.cost = { worldWithoutMs: round(least(without), 2), worldWithMs: round(least(withBoards), 2), screensMs: round(least(screensMs.filter((v) => v > 0).concat(Math.max(...screensMs))), 2), alone: !!give, tries: { without: without.map((v) => round(v, 2)), with: withBoards.map((v) => round(v, 2)) } })
    c.addedMs = round(c.worldWithMs - c.worldWithoutMs + c.screensMs, 2)
    return c
  }
  const cost = await boardsCost()
  results.cost = await timed({
    check, first: cost, firstAlone: cost.alone, idle: resting, measure: boardsCost, passes: (c) => c.addedMs <= 1.5,
    say: (c) => `the boards add ${c.addedMs} ms a frame on the GPU at the park, every pixel drawn: the world ${c.worldWithoutMs} ms without them and ${c.worldWithMs} ms with their cells, their screens and the banner ${c.screensMs} ms (bound 1.5 ms${c.alone ? '' : ', beside other checks'})`,
  })
  await plainContext.close()

  // ── From the park: present, in the picture, seen, read ──
  console.log('\nfrom the park')
  /** A PNG's pixels, read in a page of its own. */
  /** In a page: holds the plane where its banner is nearest the middle of the picture on its near pass, and says where the cloth and the plane are on the picture (client px). */
  const PASS = async () => {
    const e = globalThis.engine, p = e.boards.plane, rect = document.querySelector('canvas').getBoundingClientRect()
    const on = (c) => { const v = e.view(), d = [c[0] - v.eye[0], c[1] - v.eye[1], c[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]; return { x: (((d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (rect.width / rect.height) * far) + 1) / 2) * rect.width, y: ((1 - (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far)) / 2) * rect.height, far } }
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    let best = null
    for (let i = 0; i < 400; i++) { p.hold = i / 400; await frame(); const c = on(p.cloth.at); if (c.far > 0 && (!best || Math.abs(c.x - rect.width / 2) + c.far / 10 < best.score)) best = { phase: i / 400, score: Math.abs(c.x - rect.width / 2) + c.far / 10 } }
    p.hold = best.phase; await frame()
    const c = p.cloth, ends = [-1, 1].map((k) => on([c.at[0] + c.hu[0] * k, c.at[1] + c.hu[1] * k, c.at[2] + c.hu[2] * k])), mid = on(c.at), top = on([c.at[0], c.at[1] + c.hv[1], c.at[2]]), nose = on(p.at)
    const high = Math.abs(top.y - mid.y)
    // (The plane: 42 of its cells long, whatever size they are on the round it is flying.)
    return { phase: best.phase, metres: Math.round(mid.far / 10), box: { x0: Math.min(ends[0].x, ends[1].x), x1: Math.max(ends[0].x, ends[1].x), y0: mid.y - high - 2, y1: mid.y + high + 2 }, clothPx: Math.round(high * 2), planePx: Math.round((((42 * p.piece.cell) / nose.far) / e.view().tanHalf / 2) * rect.height), showing: c.showing }
  }
  const reader = await context.newPage()
  /** Salesforce Tower's shaft by night against the towers under the logos (sf-towers.mjs): as much of it lit window, and as warm. `frame` is the realm's, `shown` the page a picture is taken of. */
  const shaftLit = async (frame, shown, scale, where) => {
    const t = await framed(shown, await frame.evaluate(TOWERS)), of = (k) => litTower(t.picture, t.boxes[k], t.signs, scale)
    const tower = t.boxes.salesforce ? of('salesforce') : null, round_ = Object.keys(t.boxes).filter((k) => k.endsWith('tower')).map((k) => ({ name: k, ...of(k) }))
    const lo = Math.min(...round_.map((r) => r.litPct)), hi = Math.max(...round_.map((r) => r.litPct)), cool = Math.min(...round_.map((r) => r.warmth)), warm = Math.max(...round_.map((r) => r.warmth))
    check(!!tower && round_.length >= 2 && tower.litPct >= lo * 0.75 && tower.litPct <= hi * 1.35 && tower.warmth >= cool - 0.1 && tower.warmth <= warm + 0.1, `by night ${where} Salesforce Tower's shaft is lit as the towers round it are: ${tower?.litPct}% of it lit window, red over blue ${tower?.warmth}; ${round_.map((r) => `${r.name} ${r.litPct}%, ${r.warmth}`).join('; ')} (asked: ${round(lo * 0.75)}% to ${round(hi * 1.35)}%, and ${round(cool - 0.1, 2)} to ${round(warm + 0.1, 2)})`)
    return { salesforce: tower, round: round_ }
  }
  const pixelsOf = (png) => reader.evaluate(async (b64) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d'); g.drawImage(bitmap, 0, 0); return { w: bitmap.width, data: Array.from(g.getImageData(0, 0, bitmap.width, bitmap.height).data) } }, png.toString('base64'))
  // The realm's own panels are over the picture's edges; a board is read where they are not.
  await realm.evaluate(() => { globalThis.engine.scale = 0.7 }); await page.waitForTimeout(2500)
  const seen = await realm.evaluate(() => {
    const e = globalThis.engine, b = e.boards, eye = [e.pose.x * 10, e.pose.y * 10, e.pose.z * 10]
    return b.records.map((r) => {
      const w = b.where(r.id), marks = b.marks(r.id), s = b.standing(r.id)
      // Nothing between the eye and its face: the line to its middle, stopped two metres short of it.
      const to = [r.at[0], r.at[1] + (r.lift ?? (r.type === 'logo' ? 0 : 1.6)) * 10 + 28, r.at[2]], far = Math.hypot(to[0] - eye[0], to[1] - eye[1], to[2] - eye[2])
      // (A logo stands past the cells' reach, on a tower the far model draws: whether it is seen is read from the picture below.)
      let clear = true
      if (r.type === 'logo') return { id: r.id, type: r.type, logo: r.logo, where: w, clear, standing: s, marks }
      for (let d = 20; d < far - 20 && clear; d += 2) if (e.kind(eye[0] + ((to[0] - eye[0]) * d) / far, eye[1] + ((to[1] - eye[1]) * d) / far, eye[2] + ((to[2] - eye[2]) * d) / far)) clear = false
      return { id: r.id, type: r.type, logo: r.logo, where: w, clear, standing: s, marks, letters: b.letters(r.id) }
    })
  })
  const picture = await pixelsOf(await page.screenshot())
  // How many of a lettering board's squares are read right is asked of it by how big a square is on the picture: nine in
  // ten from 2 px; under that four in five, where the one pixel read at a square's middle has its neighbours' light in it
  // (EXPLORE's squares are 1.5 px from the park in the kit's faces of 7 and 11 rows, where the 5 rows of the bitmap
  // they were set in before #450 made them 3; read by eye it says EXPLORE, ~/.village/engine/sf/type).
  // (The square's narrower side: a board seen from one side, as EXPLORE on its tower is from 51 degrees, has squares
  // narrower than they are tall, by how much narrower its whole face is on the picture than it is tall for its size.)
  const asked = (s) => { const px = s.where && s.letters ? Math.min(s.where.tall / s.letters.high, s.where.wide / s.letters.wide) * s.letters.px : 0; return px >= 2 ? { px: round(px, 2), share: 0.9, says: `nine squares in ten, a square ${round(px, 2)} px` } : { px: round(px, 2), share: 0.8, says: `four squares in five, a square ${round(px, 2)} px, under 2` } }
  const light = (x, y) => { const i = (Math.floor(y) * picture.w + Math.floor(x)) * 4; return (picture.data[i] + picture.data[i + 1] + picture.data[i + 2]) / 3 }
  results.park = {}
  for (const s of seen) {
    const w = s.where, inside = !!w && w.x - w.wide / 2 > 0 && w.x + w.wide / 2 < 1280 && w.y - w.high / 2 > 0 && w.y + w.high / 2 < 720
    // A capital of lamp is the share of its panel its face says (boards.letters); a logo's mark is its whole face; a screen's words about half of it.
    const letter = w ? (s.type === 'lettering' ? w.tall * s.letters.capShare : s.type === 'logo' ? w.tall : w.tall * 0.5) : 0
    const r = (results.park[s.id] = { metres: w && round(w.far), at: w && [Math.round(w.x), Math.round(w.y)], widePx: w && Math.round(w.wide), letterPx: round(letter), clear: s.clear, standing: s.standing.letters })
    check(inside && s.clear && s.standing.whole && (s.type === 'logo' ? readable(s.logo, w.tall, w.wide, READABLE.wide) : letter >= 9), `${s.id}: whole, in the picture at ${r.at} from ${r.metres} m, ${r.widePx} px wide, ${s.type === 'logo' ? 'its sign' : 'a letter'} ${r.letterPx} px tall${s.type === 'logo' ? ` (asked: a mark ${READABLE.wide.mark} to ${READABLE.wide.most} px each way)` : ''}, nothing between the eye and it`)
    if (s.type === 'logo') {
      // The picture where its mark is: how much of it is one of its brand's two colours, and whether both are there.
      const share = brandShare(picture, w, s.logo), near = share, n = 1
      r.read = { ink: round(near[0] / n, 2), ground: round(near[1] / n, 2) }
      check(near[0] / n > 0.03 && near[1] / n > 0.03 && (near[0] + near[1]) / n > 0.2, `${s.id} reads in the picture at scale 0.7: ${Math.round((near[0] / n) * 100)}% of its sign's box is its mark's first colour and ${Math.round((near[1] / n) * 100)}% its second (cut out, the wall shows between: bounds 3% each, 20% together)`)
    }
    if (s.type === 'lettering') {
      const lit = s.marks.filter((m) => m.lit).map((m) => light(m.x, m.y)), dark = s.marks.filter((m) => !m.lit).map((m) => light(m.x, m.y)), mean = (a) => a.reduce((n, v) => n + v, 0) / a.length
      // Each square of each letter as the picture has it: lamp where the letter is, panel where it is not.
      const cut = (mean(lit) + mean(dark)) / 2, right = lit.filter((v) => v > cut).length + dark.filter((v) => v <= cut).length
      const ask = asked(s), worst = worstLetter(s.marks, (m) => (m.lit ? light(m.x, m.y) > cut : light(m.x, m.y) <= cut)), text = s.standing.letters
      r.read = { lamp: Math.round(mean(lit)), panel: Math.round(mean(dark)), squaresRight: `${right}/${s.marks.length}`, squarePx: ask.px, worst }
      check(mean(lit) - mean(dark) > 40 && right >= s.marks.length * ask.share && worst.share >= LETTER_SHARE, `${s.id} reads in the picture at scale 0.7: lamp ${r.read.lamp} against panel ${r.read.panel} of 255, ${r.read.squaresRight} squares of its letters as they should be (${ask.says}), and its worst letter, ${text[worst.letter] ?? '-'}, ${Math.round(worst.share * 100)}% (${LETTER_SHARE * 100}% or more)`)
    }
  }
  // No board over another on the picture.
  const boxes = seen.filter((s) => s.where).map((s) => ({ id: s.id, ...s.where })), atop = []
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) if (Math.abs(a.x - b.x) < (a.wide + b.wide) / 2 && Math.abs(a.y - b.y) < (a.high + b.high) / 2) atop.push(`${a.id} and ${b.id}`)
  check(atop.length === 0, `no board is over another in the park's picture${atop.length ? `: ${atop.join(', ')}` : ''}`)
  // Each logo lies on its tower's wall as the far model draws it from the park: read from this release's own far tiles
  // (sf/far/strike.mjs), at points all over the sign. None of the wall is before the sign, and none of it further behind than 2.5 m.
  {
    const { striker, lies } = await import('../sf/far/strike.mjs'), { MARKS } = await import('../page/logos.ts')
    const pointer = JSON.parse(readFileSync(join(dist, 'sf', 'current.json'), 'utf8')), strike = striker(join(dist, 'sf', dirname(pointer.manifest)))
    results.flush = {}
    for (const l of logos) {
      if (l.mount === 'roof') {
        // A roof sign: the far model's roof is under its foot (its legs go 3 m into it), and from the park no tower is before any of it.
        const roof = strike([l.at[0], 60000, l.at[2]], [0, -1, 0], 60000)?.at[1] ?? null, eye = JSON.parse(readFileSync(join(here, 'sf/realm.json'), 'utf8')).arrive.at
        const t = (l.turn * Math.PI) / 180, right = [-Math.cos(t), 0, -Math.sin(t)], high = l.size * 10, wide = high * MARKS[l.logo].wide, foot = l.at[1] + high * 0.16
        let hidden = 0, points = 0
        for (let u = -0.45; u <= 0.451; u += 0.15) for (let v = 0.08; v <= 0.951; v += 0.145) {
          const to = [l.at[0] + right[0] * u * wide, foot + v * high, l.at[2] + right[2] * u * wide], d = to.map((c, i) => c - eye[i]), far = Math.hypot(...d), h = strike(eye, d.map((c) => c / far), far)
          points++
          if (h && h.t < far - 20) hidden++
        }
        // And it is no wider than its tower: 6 m under the roof (under any parapet or step of it), a look from the park at each end of the sign's foot meets the tower there.
        const ends = [-0.5, 0.5].map((u) => { const to = [l.at[0] + right[0] * u * wide, l.at[1] - 60, l.at[2] + right[2] * u * wide], d = to.map((c, i) => c - eye[i]), far = Math.hypot(...d), h = strike(eye, d.map((c) => c / far), far + 3000); return !!h && Math.abs(h.t - far) < 900 })
        results.flush[l.id] = { roofM: roof === null ? null : round((roof - l.at[1]) / 10, 2), points, hidden, wideM: round(wide / 10, 1), endsOverTower: ends }
        check(ends.every(Boolean), `${l.id}'s sign, ${round(wide / 10, 1)} m wide, is no wider than its tower: the tower is under ${ends.filter(Boolean).length} of the 2 ends of its foot as seen from the park`)
        check(roof !== null && Math.abs(roof - l.at[1]) <= 15 && hidden === 0, `${l.id} stands on its tower's roof as the far model has it (the roof is ${roof === null ? 'not there' : `${round((roof - l.at[1]) / 10, 2)} m from its foot`}; asked within 1.5 m), and from the park ${hidden} of ${points} points of the sign are behind a tower (asked: none)`)
        continue
      }
      const g = lies(strike, l.at, l.turn, l.size, l.size * MARKS[l.logo].wide)
      results.flush[l.id] = { leastM: round(g.least / 10, 2), mostM: round(g.most / 10, 2), points: g.all, off: g.off }
      check(g.off === 0 && g.least >= 0 && g.most <= 25, `${l.id} lies flush on its tower's wall as the far model has it: at ${g.all} points of the sign the wall is ${round(g.least / 10, 2)} to ${round(g.most / 10, 2)} m behind it (asked: none before it, none past 2.5 m, none off the wall: ${g.off})`)
    }
  }
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(3000)
  await page.screenshot({ path: join(shots, 'park-after.png') })
  await realm.evaluate(() => { globalThis.engine.hour = 21 }); await page.waitForTimeout(3500)
  await page.screenshot({ path: join(shots, 'park-night.png') })
  // ── By night from the park, at the scale a first view is drawn at (0.75 of the page's pixels) ──
  console.log('\nby night from the park')
  {
    await realm.evaluate(() => { globalThis.engine.hour = 21.5; globalThis.engine.scale = 0.75 }); await page.waitForTimeout(6000)
    const night = await pixelsOf(await page.screenshot({ path: join(shots, 'park-night-first.png') }))
    // The towers: the band of the picture under the logos' feet, 80 px of it, across the skyline.
    const feet = Math.round(Math.max(...seen.filter((s) => s.type === 'logo' && s.where).map((s) => s.where.y + s.where.high / 2))), band = { x0: 240, x1: 1000, y0: feet + 5, y1: feet + 85 }
    const rows = windowRows(night, band)
    results.night = { band, windows: rows }
    check(rows.litPct >= 2 && rows.ratio >= 1.25, `the towers' lit windows from the park are rows: their light changes ${rows.ratio} times as much up a wall as along it (bound 1.25; round 4's blocks were 0.56), ${rows.litPct}% of the band lit (band ${band.x0},${band.y0} to ${band.x1},${band.y1})`)
    // Salesforce Tower's crown, where its own light's numbers say it is, against the sky beside it.
    const crown = await realm.evaluate(CROWN)
    const meanLight = (x0, y0, x1, y1) => { let n = 0, sum = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * night.w + x) * 4; sum += 0.2126 * night.data[i] + 0.7152 * night.data[i + 1] + 0.0722 * night.data[i + 2]; n++ } return sum / Math.max(1, n) }
    const lit = crown ? meanLight(crown.x0, crown.y0, crown.x1, crown.y1) : 0, sky = crown ? meanLight(crown.x0 + crown.sky, crown.y0, crown.x1 + crown.sky, crown.y1) : 0
    results.night.crown = { box: crown, light: round(lit), sky: round(sky) }
    check(!!crown && lit >= 110 && lit >= sky * 2, `Salesforce Tower's crown is lit: its mean light ${round(lit)} of 255 against the sky's ${round(sky)} beside it (bound 110, and twice the sky; unlit it was 38)${crown ? `, at ${crown.x0},${crown.y0} to ${crown.x1},${crown.y1}` : ': the page has no light for it'}`)
    results.night.towers = await shaftLit(realm, page, 1, 'at 1280 x 720')
    // BLOG, as by day: lamp against panel in the picture's own pixels.
    for (const s of seen.filter((s) => s.type === 'lettering')) {
      const r = lettersRead(night, s.marks)
      results.night[s.id] = r
      const ask = asked(s)
      check(r.lamp - r.panel > 40 && r.right >= r.of * ask.share && r.worst.share >= LETTER_SHARE, `${s.id} reads by night from the park: lamp ${r.lamp} against panel ${r.panel} of 255, ${r.right}/${r.of} squares of its letters as they should be (bounds: 40 apart, ${ask.says}), and its worst letter, ${s.standing.letters[r.worst.letter] ?? '-'}, ${Math.round(r.worst.share * 100)}% (${LETTER_SHARE * 100}% or more)`)
    }
  }
  await realm.evaluate(() => { globalThis.engine.hour = 15; globalThis.engine.scale = 0.7 }); await page.waitForTimeout(1500)

  // ── The visitor is in the realm (as the way in ends, explore.ts): the controls come. A key pressed before that brings nothing. ──
  console.log('\nthe controls come')
  {
    const still = await over(realm)
    await page.mouse.move(400, 300); await page.mouse.move(700, 420)
    const hovered = await over(realm)
    await page.keyboard.press('KeyW')
    await page.waitForTimeout(300)
    const keyed = await over(realm)
    await realm.evaluate(() => globalThis.engine.first.engage())
    await page.waitForTimeout(160)
    await page.screenshot({ path: join(shots, 'reveal-desktop.png') })
    await page.waitForTimeout(1400)
    const after = await over(realm), toldEngaged = await page.evaluate(() => window.told.filter((m) => m.type === 'engaged').length)
    await page.screenshot({ path: join(shots, 'engaged-desktop.png') })
    results.first.engaged = after
    check(still.first && hovered.first && !hovered.sky && keyed.first && !keyed.sky, 'the first view holds through every check until here, and neither a mouse moved over the picture nor a key pressed ends it')
    check(!after.first && after.engaged && !after.hud && after.aim && after.sky && after.tools && after.where && !after.explore && after.credits && toldEngaged === 1, `in the realm, the aim, the hour and weather, the tools and the street's name are there, and no line of numbers (that is ?debug=1's); the credits key stayed, and the host was told once (${toldEngaged})`)
    // With the controls there, the banner's whole round against the hour's panel: it passes under it nowhere, and can be read on a good part of the round.
    results.first.clear = await realm.evaluate(CLEAR)
    check(results.first.clear.under.length === 0 && results.first.clear.read >= 40, `with the controls shown, the banner passes under the hour's panel (${results.first.clear.laid.map((r) => r.join(' ')).join('; ')}) at ${results.first.clear.under.length} of 120 places on its round, and can be read at ${results.first.clear.read} (asked: none, and a third of the round)`)
    await toPark()
    await page.waitForTimeout(600)
    // And no logo is under any of them.
    results.first.covered = await realm.evaluate(COVERED)
    check(results.first.covered.under.length === 0 && results.first.covered.logos.every(Boolean), `with the controls shown at 1280 x 720, no board is under one (${results.first.covered.under.join(', ') || 'none'}): ${results.first.covered.logos.join('; ')} against ${results.first.covered.laid.join('; ')}`)
  }
  // ── Navigation ──
  console.log('\nnavigation')
  /** After a flight to a logo: whether the picture before the eye has its mark, by its brand's colours (a mark sunk in its wall, or hidden by it, has none). */
  const markSeen = async (logo) => {
    await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(2500)
    const w = await realm.evaluate((id) => globalThis.engine.boards.where(id), logo.id), share = brandShare(await pixelsOf(await page.screenshot({ path: join(shots, `fly-to-${logo.id}.png`) })), w, logo.logo, 130)
    check(share[0] > 0.04 && share[1] > 0.04 && share[0] + share[1] > 0.25, `before the ${logo.id} logo after the flight, its mark is in the picture: ${Math.round(share[0] * 100)}% of its sign's box is its first colour and ${Math.round(share[1] * 100)}% its second (${Math.round(w.tall)} px tall; a mark sunk in its wall has none, a mark alone has the wall between: bound 25% together)`)
  }
  const told = (type) => page.evaluate((type) => window.told.filter((m) => m.type === type), type)
  /** Whether the eye is before a board, looking at it. */
  const before = (id) => realm.evaluate((id) => { const e = globalThis.engine, w = e.boards.where(id), rect = document.querySelector('canvas').getBoundingClientRect(); return w && { metres: Math.round(w.far), share: Math.round((w.wide / rect.width) * 100) / 100, centred: Math.abs(w.x - rect.width / 2) < rect.width * 0.1 && Math.abs(w.y - rect.height / 2) < rect.height * 0.15 } }, id)
  const first = file.boards[0], at = seen.find((s) => s.id === first.id).where
  let n = (await told('navigate')).length
  await page.mouse.click(at.x, at.y)
  await page.waitForFunction((n) => window.told.filter((m) => m.type === 'navigate').length > n, n, { timeout: 15_000 }).catch(() => null)
  let nav = (await told('navigate')).at(-1), there = await before(first.id)
  await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(1500)
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'fly-to.png') })
  await realm.evaluate(() => { globalThis.engine.scale = 0.7 })
  results.click = { nav, there }
  check(first.type !== 'logo' && (await told('navigate')).length === n + 1 && nav?.board === first.id && nav.to === first.to && there?.centred && there.share > 0.3 && there.metres < 100, `a click on ${first.id} in the park's picture flew the eye to ${there?.metres} m before it (${there?.share} of the picture's width) and told the host to go to ${nav?.to}`)
  check(await realm.evaluate(() => document.pointerLockElement === null), 'that click did not take the pointer for the realm')
  // Enter on a board's link.
  const second = file.boards[1]
  await toPark()
  n = (await told('navigate')).length
  await realm.locator(`nav[aria-label="Billboards"] a[data-board="${second.id}"]`).focus()
  const shownLink = await realm.locator(`nav[aria-label="Billboards"] a[data-board="${second.id}"]`).evaluate((a) => { const r = a.getBoundingClientRect(); return r.left >= 0 && r.width > 0 })
  await page.keyboard.press('Enter')
  await page.waitForFunction((n) => window.told.filter((m) => m.type === 'navigate').length > n, n, { timeout: 15_000 }).catch(() => null)
  nav = (await told('navigate')).at(-1); there = await before(second.id)
  await markSeen(second)
  check(second.type === 'logo' && /^https:/.test(second.to) && shownLink && (await told('navigate')).length === n + 1 && nav?.board === second.id && nav.to === second.to && there?.centred, `Enter on the link "${second.name}" (seen while it has the focus) flew to the logo, ${there?.metres} m before it, and told the host to go to ${nav?.to}`)
  // The host's own ask.
  const third = file.boards[2]
  n = (await told('navigate')).length
  await page.evaluate((id) => window.ask({ type: 'open', board: id }), third.id)
  await page.waitForFunction((n) => window.told.filter((m) => m.type === 'navigate').length > n, n, { timeout: 15_000 }).catch(() => null)
  nav = (await told('navigate')).at(-1); there = await before(third.id)
  check(nav?.board === third.id && nav.to === third.to && there?.centred, `the host's "open" flew to ${third.id} and was told to go to ${nav?.to}`)
  if (third.type === 'logo') await markSeen(third)
  // A click on each of the other logos, from the park.
  for (const logo of logos.filter((l) => l.id !== second.id && l.id !== third.id)) {
    await toPark()
    const w = await realm.evaluate((id) => globalThis.engine.boards.where(id), logo.id)
    n = (await told('navigate')).length
    // With the controls shown, the hour's panel is over the right of the skyline: a logo under it is not the picture's to click, and is opened by its link (as the host's own `open` does).
    const covered = await realm.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName !== 'CANVAS', [w.x, w.y])
    if (covered) await page.evaluate((id) => window.ask({ type: 'open', board: id }), logo.id); else await page.mouse.click(w.x, w.y)
    await page.waitForFunction((n) => window.told.filter((m) => m.type === 'navigate').length > n, n, { timeout: 15_000 }).catch(() => null)
    nav = (await told('navigate')).at(-1)
    check((await told('navigate')).length === n + 1 && nav?.board === logo.id && nav.to === logo.to, `${covered ? `the ${logo.id} logo is under the hour's panel in the park's picture (said, not failed): the host's open` : `a click on the ${logo.id} logo in the park's picture`} flew to it and told the host to go to ${nav?.to}`)
    await markSeen(logo)
  }
  // By night from where a flight to a logo ends, the tower's lit windows before the eye: a city at night, not white
  // blots. How much of the picture is burnt out (every colour at 235 of 255 or more): 12.6% when a pane a dozen
  // pixels wide was spread by the last pass as five times its light (round 3's close-up), about 0.2% now.
  {
    const logo = logos.find((l) => l.id === 'linkedin') ?? logos[0]
    await realm.evaluate((id) => { globalThis.engine.hour = 21.5; return globalThis.engine.boards.fly(id) }, logo.id)
    // (A roof sign is over the tower: the eye is turned down from it to the tower's own windows.)
    await realm.evaluate(() => { globalThis.engine.pose.pitch -= 0.14 })
    await page.waitForTimeout(5000)
    const night = await pixelsOf(await page.screenshot({ path: join(shots, 'night-close.png') }))
    let burnt = 0
    for (let i = 0; i < night.data.length; i += 4) if (Math.min(night.data[i], night.data[i + 1], night.data[i + 2]) >= 235) burnt++
    results.bloom = { burntPct: round((burnt / (night.data.length / 4)) * 100, 2) }
    check(results.bloom.burntPct < 2, `by night before the ${logo.id} tower's windows, ${results.bloom.burntPct}% of the picture is burnt out to white (bound 2%; 12.6% before)`)
    await realm.evaluate(() => { globalThis.engine.hour = 15 })
    await page.waitForTimeout(1500)
  }
  // Flying free: from the park by the keys towards a board, then O.
  const last = built.filter((b) => b.to).at(-1)
  await toPark()
  const free = await realm.evaluate(async (id) => {
    const e = globalThis.engine, b = e.boards, r = b.records.find((r) => r.id === id), to = [r.at[0] / 10, (r.at[1] + 44) / 10, r.at[2] / 10]
    // Turned to it, then W held until it is 50 m off: the page's own flying.
    const start = { ...e.pose }, d0 = Math.hypot(to[0] - e.pose.x, to[2] - e.pose.z)
    Object.assign(e.pose, { yaw: Math.atan2(to[0] - e.pose.x, -(to[2] - e.pose.z)), pitch: Math.atan2(to[1] - e.pose.y, d0) })
    e.input.hold('KeyW', true); e.input.hold('ShiftLeft', true)
    for (let i = 0; i < 600 && Math.hypot(to[0] - e.pose.x, to[1] - e.pose.y, to[2] - e.pose.z) > 50; i++) await new Promise((r) => setTimeout(r, 50))
    e.input.hold('KeyW', false); e.input.hold('ShiftLeft', false)
    return { flown: Math.round(Math.hypot(e.pose.x - start.x, e.pose.z - start.z)), left: Math.round(Math.hypot(to[0] - e.pose.x, to[1] - e.pose.y, to[2] - e.pose.z)) }
  }, last.id)
  n = (await told('navigate')).length
  await page.keyboard.press('KeyO')
  await page.waitForTimeout(500)
  nav = (await told('navigate')).at(-1)
  results.free = free
  check(free.left <= 55 && free.flown > 50 && (await told('navigate')).length === n + 1 && nav?.board === last.id && nav.to === last.to, `flying free: W flew ${free.flown} m from the park to ${free.left} m before ${last.id}, and O told the host to go to ${nav?.to}`)

  // ── A phone: a tap ──
  console.log('\na phone (390 x 844, touch)')
  {
    // The desktop page rests meanwhile: a visitor has one realm open, and two drawing in one browser starve the one that is loading.
    await realm.evaluate(() => { globalThis.engine.resting = true })
    const handheld = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    const small = await handheld.newPage()
    small.on('pageerror', (e) => errors.push(`phone: ${e.message}`))
    await small.goto(`${site.url}/host.html`)
    await small.waitForFunction(() => window.told.some((m) => m.type === 'ready'), null, { timeout: 300_000 })
    const held = small.frames().find((f) => f.url().includes('/sf/index.html'))
    await held.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 300_000 })
    await small.waitForTimeout(4000)
    // (The phone's own first view: an upright phone is framed as the realm says it is, sf/realm.json `upright`.)
    const phonePark = await held.evaluate(() => ({ ...globalThis.engine.pose }))
    const firstPhone = await over(held)
    await small.screenshot({ path: join(shots, 'first-phone.png') })
    results.first.phone = firstPhone
    check(firstPhone.first && !firstPhone.hud && !firstPhone.sky && !firstPhone.tools && !firstPhone.fold && !firstPhone.thumbs && !firstPhone.where && firstPhone.wall === 0 && !firstPhone.explore && firstPhone.credits, `a phone's first view is the picture and the credits key (${firstPhone.creditsBox.join(' x ')} px): no fold, no thumbs, no tools`)
    const inView = await held.evaluate(() => { const b = globalThis.engine.boards; return b.records.map((r) => ({ id: r.id, type: r.type, to: r.to, w: b.where(r.id), standing: b.standing(r.id) })).map((r) => ({ ...r, inside: !!r.w && r.w.x - r.w.wide / 2 > 0 && r.w.x + r.w.wide / 2 < innerWidth && r.w.y - r.w.high / 2 > 0 && r.w.y + r.w.high / 2 < innerHeight })) })
    const across = round((Math.atan(Math.tan(((await held.evaluate(() => globalThis.engine.fov)) * Math.PI) / 360) * (390 / 844)) * 360) / Math.PI)
    results.phone = { inPicture: inView.filter((r) => r.inside).map((r) => r.id), of: inView.length }
    const target = inView.find((r) => r.inside && r.type === 'logo')
    check(inView.some((r) => r.inside && r.type === 'lettering') && inView.filter((r) => r.inside && r.type === 'logo').length >= 2, `in an upright phone's picture from the park (${across} degrees across): ${results.phone.inPicture.join(', ') || 'no board'}, of ${inView.length} (the lettering board and two logos are asked for; the rest are a turn of the eye away)`)
    results.phone.composed = await held.evaluate(COMPOSED, 12000)
    composedCheck(results.phone.composed, 'the phone')
    // The banner on its near pass, as the phone's own pixels have it.
    {
      await held.evaluate(() => { globalThis.realm.signs.set('banner', { text: 'NEW POST' }); globalThis.engine.scale = 1 })
      const pass = await held.evaluate(PASS)
      await small.waitForTimeout(3000)
      await small.screenshot({ path: join(shots, 'banner-phone.png') })
      // (Only the cloth's part of the picture is read: the whole of it at three device pixels a px is more than a page takes back in one answer.)
      const dpr = 3, clip = { x: Math.max(0, Math.floor(pass.box.x0)), y: Math.max(0, Math.floor(pass.box.y0)), width: Math.ceil(Math.min(390, pass.box.x1) - Math.max(0, pass.box.x0)), height: Math.ceil(pass.box.y1 - pass.box.y0) }
      const shot = await pixelsOf(await small.screenshot({ clip }))
      const tall = inkTall(shot, { x0: 0, x1: clip.width * dpr, y0: 0, y1: clip.height * dpr }) / dpr
      results.phone.banner = { ...pass, wordsPx: round(tall) }
      // (A phone's own round is past the towers too, and as small as words can be and be read there: 11 px.)
      check(pass.box.x0 >= 0 && pass.box.x1 <= 390 && pass.metres >= 2000 && tall >= 11, `on the phone the banner's pass is whole in the picture (${Math.round(pass.box.x0)} to ${Math.round(pass.box.x1)} of 390 px, ${pass.metres} m off) and its words are ${round(tall)} px tall as the picture has them (CSS px, three of the phone's own to each; bound 11)`)
      await held.evaluate(() => { globalThis.engine.boards.plane.hold = null })
    }
    if (target) {
      await small.touchscreen.tap(target.w.x, target.w.y)
      await small.waitForFunction(() => window.told.some((m) => m.type === 'navigate'), null, { timeout: 15_000 }).catch(() => null)
      const nav = await small.evaluate(() => window.told.find((m) => m.type === 'navigate'))
      await small.waitForTimeout(2500)
      await small.screenshot({ path: join(shots, 'phone-tapped.png') })
      check(nav?.board === target.id && nav.to === target.to && (await over(held)).first, `a tap on the ${target.id} logo on a phone flew to it and told the host to go to ${nav?.to}; the first view held`)
    }
    // Every logo with the eye turned to it from the park: how tall its mark is on the phone.
    const turned = await held.evaluate(async ({ ids, park }) => {
      const e = globalThis.engine, out = []
      for (const id of ids) {
        const r = e.boards.records.find((r) => r.id === id), to = [r.at[0] / 10, r.at[1] / 10 + r.size / 2, r.at[2] / 10]
        Object.assign(e.pose, park, { yaw: Math.atan2(to[0] - park.x, -(to[2] - park.z)), pitch: Math.atan2(to[1] - park.y, Math.hypot(to[0] - park.x, to[2] - park.z)) })
        await new Promise((r) => setTimeout(r, 400))
        const w = e.boards.where(id)
        out.push({ id, markPx: w ? Math.round(w.tall * 10) / 10 : 0, widePx: w ? Math.round(w.wide * 10) / 10 : 0, longPx: w ? Math.round(Math.max(w.tall, w.wide) * 10) / 10 : 0 })
      }
      Object.assign(e.pose, park)
      return out
    }, { ids: logos.map((l) => l.id), park: phonePark })
    results.phone.logos = turned
    check(turned.every((t) => readable(logos.find((l) => l.id === t.id).logo, t.markPx, t.widePx, READABLE.phone)), `on the phone, the eye turned to each logo from the park: ${turned.map((t) => `${t.id} ${t.widePx} x ${t.markPx} px`).join(', ')} (asked: a mark ${READABLE.phone.mark} to ${READABLE.phone.most} px each way)`)
    // BLOG by night on the phone, as its own pixels have it (three to a px). A phone is shown the board in cells of
    // 1.6 m, two of its letters' squares to a cell, so its squares are not where the letters' own are (they are read,
    // not measured square by square): the lamp's light against the panel's, as the brightest and the darkest fifths
    // of the board's face in the picture, and how much of the face is lamp (BLOG's own letters are 37% of its panels).
    {
      const blog = await held.evaluate(async (park) => { const e = globalThis.engine; Object.assign(e.pose, park); e.hour = 21.5; await new Promise((r) => setTimeout(r, 6000)); const id = e.boards.records.find((r) => r.type === 'lettering').id; return { id, w: e.boards.where(id) } }, phonePark)
      const clip = { x: Math.round(blog.w.x - blog.w.wide * 0.42), y: Math.round(blog.w.y - blog.w.tall * 0.36), width: Math.round(blog.w.wide * 0.84), height: Math.round(blog.w.tall * 0.72) }
      await small.screenshot({ path: join(shots, 'night-phone.png') })
      results.phone.towers = await shaftLit(held, small, 3, 'on the phone')
      const face = await pixelsOf(await small.screenshot({ clip })), lights = []
      for (let i = 0; i < face.data.length; i += 4) lights.push((face.data[i] + face.data[i + 1] + face.data[i + 2]) / 3)
      lights.sort((a, b) => a - b)
      const fifth = Math.floor(lights.length / 5), mean = (a) => a.reduce((n, v) => n + v, 0) / Math.max(1, a.length), panel = mean(lights.slice(0, fifth)), lamp = mean(lights.slice(-fifth)), share = lights.filter((v) => v > (panel + lamp) / 2).length / lights.length
      results.phone.night = { lamp: Math.round(lamp), panel: Math.round(panel), lampShare: round(share, 2) }
      check(lamp - panel > 80 && lamp < 235 && share > 0.2 && share < 0.6, `${blog.id} reads by night on the phone: lamp ${Math.round(lamp)} against panel ${Math.round(panel)} of 255 (the brightest and darkest fifths of its face; bound 80 apart, and the lamp not burnt out past 235), ${Math.round(share * 100)}% of the face lamp (bounds 20% to 60%)`)
      await held.evaluate(() => { globalThis.engine.hour = 15 }); await small.waitForTimeout(1500)
    }
    // In the realm (as the way in ends, explore.ts), a thumb's controls come.
    await held.evaluate(() => globalThis.engine.first.engage())
    await small.waitForTimeout(1500)
    const afterPhone = await over(held)
    await small.screenshot({ path: join(shots, 'engaged-phone.png') })
    check(!afterPhone.first && afterPhone.fold && afterPhone.thumbs && afterPhone.tools && !afterPhone.explore && afterPhone.credits, 'in the realm the phone has its fold, its thumbs and its tools; the credits key stayed')
    results.phone.covered = await held.evaluate(COVERED)
    // (The tools were a column over the LinkedIn sign until round 5, and the keys to fly and the resting stick over BLOG.)
    check(results.phone.covered.under.length === 0 && results.phone.covered.boards.filter(Boolean).length >= 3, `on the phone with the controls shown (390 x 844), no board is under one (${results.phone.covered.under.join(', ') || 'none'}): ${results.phone.covered.boards.filter(Boolean).join('; ')} against ${results.phone.covered.laid.join('; ')}`)
    results.phone.clear = await held.evaluate(CLEAR)
    check(results.phone.clear.under.length === 0 && results.phone.clear.read >= 40, `on the phone, with the controls shown, the banner passes under the fold (${results.phone.clear.laid.map((r) => r.join(' ')).join('; ')}) at ${results.phone.clear.under.length} of 120 places on its round, and can be read at ${results.phone.clear.read}`)
    await handheld.close()
    await realm.evaluate(() => { globalThis.engine.resting = false })
  }

  // ── What the signs say ──
  console.log('\nrealm.signs')
  const lettering = file.boards.find((b) => b.type === 'lettering'), digital = file.boards.find((b) => b.type === 'digital')
  const said = await realm.evaluate(async ({ lettering, digital }) => {
    const e = globalThis.engine, signs = globalThis.realm.signs, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {}
    const edits = e.boards.edits
    signs.set(lettering, { text: 'now' })
    out.lettered = { letters: e.boards.standing(lettering).letters, edits: e.boards.edits - edits, listed: signs.list().find((s) => s.id === lettering) }
    try { signs.set(lettering, { image: 'x.png' }); out.refused = false } catch (x) { out.refused = x instanceof TypeError }
    signs.set(lettering, null)
    out.back = { letters: e.boards.standing(lettering).letters, own: signs.list().find((s) => s.id === lettering).own }
    // A picture of the page's own making, and a video of a canvas that changes.
    const c = document.createElement('canvas'); c.width = 320; c.height = 120
    const g = c.getContext('2d'); g.fillStyle = '#d22'; g.fillRect(0, 0, 320, 120); g.fillStyle = '#fff'; g.font = '700 80px sans-serif'; g.fillText('EGG', 70, 90)
    if (digital) signs.set(digital, { image: c.toDataURL() })
    signs.set('banner', { image: c.toDataURL() })
    await wait(800)
    out.image = signs.list().filter((s) => s.id === digital || s.id === 'banner').map((s) => 'image' in s.content)
    out.bannerReady = globalThis.engine.boards.plane.cloth.showing
    const video = document.createElement('video'); video.muted = true; video.srcObject = c.captureStream(15)
    const tick = setInterval(() => { g.fillStyle = `hsl(${(performance.now() / 5) % 360} 80% 45%)`; g.fillRect(0, 0, 320, 120); g.fillStyle = '#fff'; g.fillText('LIVE', 60, 90) }, 60)
    await video.play().catch(() => {})
    signs.set(digital ?? 'banner', { video })
    await wait(1500)
    clearInterval(tick)
    out.video = { state: video.readyState, time: video.currentTime }
    out.unknown = (() => { try { signs.set('later', { text: 'kept for a sign that comes later' }); return true } catch { return false } })()
    return out
  }, { lettering: lettering.id, digital: digital?.id ?? null })
  results.signs = said
  check(said.lettered.letters === 'NOW' && said.lettered.edits === 2 && said.lettered.listed.content.text === 'now' && said.back.letters === lettered(lettering.content.text) && said.back.own, `realm.signs.set("${lettering.id}", { text: "now" }) laid NOW in cells (${said.lettered.edits} edits: the old taken away, the new laid), and null put back ${said.back.letters}`)
  check(said.refused === true, 'a lettering board refuses an image with a TypeError')
  check(said.image.length === (digital ? 2 : 1) && said.image.every(Boolean) && said.bannerReady.kind === 'image' && said.bannerReady.ready && said.video.state >= 2 && said.unknown, `the banner${digital ? ' and a digital board' : ''} took an image (its picture came), then ${digital ? 'the board' : 'the banner'} a video (readyState ${said.video.state}); a sign not there yet is kept for`)
  // And from the host.
  await page.evaluate(() => { window.ask({ type: 'signs.set', id: 'banner', content: { text: 'FROM THE HOST' } }); window.ask({ type: 'signs.set', id: 'blog', content: { image: 'x.png' } }) })
  await page.waitForTimeout(600)
  const hosted = await realm.evaluate(() => globalThis.realm.signs.list().find((s) => s.id === 'banner').content), refusedHost = (await told('error')).at(-1)
  check(hosted.text === 'FROM THE HOST' && file.banner.content.text !== 'FROM THE HOST' && refusedHost?.fatal === false, `the host set the banner to "${hosted.text}", and was told its picture for a lettering board was refused`)
  if (digital) await realm.evaluate((id) => { globalThis.realm.signs.set(id, null) }, digital.id)

  // ── The plane ──
  console.log('\nthe plane')
  await toPark()
  // (The plane may have been called in by now (an egg, or the first view keeping it): it is sent back out to its own
  // round, which is what is measured first.)
  await realm.evaluate(async () => { const p = globalThis.engine.boards.plane; p.call(false); p.loud = false; for (const until = performance.now() + 12000; p.come > 0 && performance.now() < until; ) await new Promise((r) => setTimeout(r, 100)) })
  const moved = await realm.evaluate(async () => { const p = globalThis.engine.boards.plane, a = [...p.at]; await new Promise((r) => setTimeout(r, 1000)); return Math.round(Math.hypot(p.at[0] - a[0], p.at[2] - a[2]) / 10) })
  await realm.evaluate(() => { globalThis.realm.signs.set('banner', { text: 'NEW POST' }); globalThis.engine.scale = 1 })
  let pass = await realm.evaluate(PASS)
  await page.waitForTimeout(3000)
  const sky = await pixelsOf(await page.screenshot({ path: join(shots, 'banner.png') }))
  const tall = inkTall(sky, pass.box)
  results.plane = { movedIn1s: moved, ...pass, wordsPx: tall }
  check(moved > 30 && moved < 80, `the plane flew ${moved} m in a second (far off: a degree a second on the picture)`)
  // Its own round is a signature in a corner of the sky: past the towers (2 km and more), small (the cloth 26 px tall
  // at most, where it was 43), and its words still read (10 px and more: the 14 px words on the page's keys are read at once).
  check(pass.box.x0 >= 0 && pass.box.x1 <= 1280 && pass.box.y0 >= 0 && pass.box.y1 <= 720 && pass.metres >= 2000 && pass.clothPx <= 26 && pass.planePx >= 12 && tall >= 10 && pass.showing.kind === 'text', `on its own round the banner is whole in the park's picture (${Math.round(pass.box.x0)} to ${Math.round(pass.box.x1)} px across, ${Math.round(pass.box.y0)} to ${Math.round(pass.box.y1)} down), ${pass.metres} m off (bound 2000), the plane ${pass.planePx} px long (bound 12), the cloth ${pass.clothPx} px tall (26 at most) and "NEW POST" ${tall} px tall as the picture's pixels have it (bound 10)`)
  // With something to say that must be read (an egg's line, `loud`), it comes in to its near round: as big as it was.
  {
    await realm.evaluate(async () => { const p = globalThis.engine.boards.plane; p.hold = null; p.loud = true; for (const until = performance.now() + 12000; p.come < 1 && performance.now() < until; ) await new Promise((r) => setTimeout(r, 100)) })
    const near = await realm.evaluate(PASS)
    await page.waitForTimeout(2000)
    const nearTall = inkTall(await pixelsOf(await page.screenshot({ path: join(shots, 'banner-near.png') })), near.box)
    results.plane.near = { ...near, wordsPx: nearTall }
    check(near.box.x0 >= 0 && near.box.x1 <= 1280 && near.box.y0 >= 0 && near.box.y1 <= 720 && near.planePx >= 40 && nearTall >= 20, `with something to say it comes in: on its near pass the banner is whole in the picture (${Math.round(near.box.x0)} to ${Math.round(near.box.x1)} px across, ${near.metres} m off), the plane ${near.planePx} px long, and "NEW POST" ${nearTall} px tall (the cloth ${near.clothPx} px; bounds 40 and 20)`)
    await realm.evaluate(async () => { const p = globalThis.engine.boards.plane; p.hold = null; p.loud = false; for (const until = performance.now() + 12000; p.come > 0 && performance.now() < until; ) await new Promise((r) => setTimeout(r, 100)) })
    check((await realm.evaluate(() => globalThis.engine.boards.plane.come)) === 0, 'and goes back out to its own round when it has said it')
    pass = await realm.evaluate(PASS)
    await page.waitForTimeout(1500)
  }
  // A picture on it: the page's own, red with white words. Where the cloth is, the picture is red.
  {
    await realm.evaluate(async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 104; const g = c.getContext('2d'); g.fillStyle = '#d22'; g.fillRect(0, 0, 640, 104); g.fillStyle = '#fff'; g.font = '700 84px sans-serif'; g.fillText('PICTURE', 150, 82); globalThis.realm.signs.set('banner', { image: c.toDataURL() }); await new Promise((r) => setTimeout(r, 1200)) })
    const shot = await pixelsOf(await page.screenshot({ path: join(shots, 'banner-image.png') }))
    let red = 0, n = 0
    for (let y = Math.round(pass.box.y0 + 6); y < pass.box.y1 - 6; y += 2) for (let x = Math.round(pass.box.x0 + 6); x < pass.box.x1 - 6; x += 2) { const i = (y * shot.w + x) * 4; n++; if (shot.data[i] > 110 && shot.data[i + 1] < 80) red++ }
    check(red / n > 0.5, `a picture set on the banner is seen from the park: ${Math.round((red / n) * 100)}% of the cloth is the picture's red`)
    await realm.evaluate(() => { globalThis.realm.signs.set('banner', { text: 'NEW POST' }) })
  }
  await realm.evaluate(() => { globalThis.engine.boards.plane.hold = null; globalThis.engine.scale = 0.7 })

  // ── Broken, and put back ──
  console.log('\nbroken and put back')
  const blog = built.find((b) => b.type === 'lettering')
  await realm.evaluate((id) => globalThis.engine.boards.fly(id), blog.id)
  await page.waitForTimeout(1500); await settle()
  const broke = await realm.evaluate(async ({ id, digital }) => {
    const e = globalThis.engine, b = e.boards, wait = (ms) => new Promise((r) => setTimeout(r, ms)), r = b.records.find((r) => r.id === id)
    // Charges across the last letter, at its middle and a quarter of its width and height from it each way: where a
    // visitor would aim. (One column of them took a third of the lamp of a glyph as wide as Vox Zakon's G.)
    const laid = b.letters(id), last = laid.middles.at(-1), snap = (v) => Math.round(v / 8) * 8
    for (const [u, v] of [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) { e.strike([last.at[0] + laid.right[0] * u * last.wide, last.at[1] + v * laid.cap, last.at[2] + laid.right[2] * u * last.wide], 12); await wait(2500) }
    await wait(2500)
    if (digital) {
      const d = b.records.find((r) => r.id === digital), dn = [[-1, 0], [0, -1], [1, 0], [0, 1]][d.facing]
      e.strike([snap(d.at[0]) - dn[0], Math.ceil((d.at[1] + (d.lift ?? 3.2) * 10) / 8) * 8 + 28, snap(d.at[2]) - dn[1]], 32)
      await wait(4000)
    }
    return { lettering: b.standing(id), digital: digital ? b.standing(digital) : null, edits: e.world.done().length, laid: b.edits }
  }, { id: blog.id, digital: digital?.id ?? null })
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'broken.png') })
  results.broken = broke
  const text = lettered(blog.content.text)
  check(broke.lettering.letters === text.slice(0, -1) && (!digital || !broke.digital.whole), `five charges at the ${text.at(-1)} of ${text} left ${broke.lettering.letters} standing${digital ? `; a big charge at ${digital.id} left ${broke.digital.letters} of its screen lit` : ''}`)
  // By night the broken board's lit letters strike and its broken one gives no light: no face, no halo (letterlight.ts).
  const dark = await realm.evaluate(async (id) => {
    const e = globalThis.engine, was = e.hour
    e.hour = 21.5
    // (The lights come on over some frames: first the letters' strike, then all of them settled.)
    for (let i = 0; i < 100 && e.boards.glow.power[id].every((v) => v === 0); i++) await new Promise((r) => setTimeout(r, 100))
    for (let i = 0; i < 100 && !e.boards.glow.settled; i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 1200))
    const power = e.boards.glow.power[id]
    e.hour = was
    return power.map((v) => Math.round(v * 100) / 100)
  }, blog.id)
  results.brokenByNight = dark
  check(dark.at(-1) === 0 && dark.slice(0, -1).every((v) => v > 0.8), `by night the broken ${text.at(-1)} gives no light and the letters left are lit: ${dark.join(', ')}`)
  const reset = await realm.evaluate(async () => {
    const e = globalThis.engine
    await e.reset()
    for (let i = 0; i < 300 && (e.world.stats.wanted || e.world.stats.stale); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 1500))
    return { boards: e.boards.records.map((r) => [r.id, e.boards.standing(r.id)]), edits: e.world.done().length, laid: e.boards.edits }
  })
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(3500)
  await page.screenshot({ path: join(shots, 'reset.png') })
  results.reset = reset
  check(reset.boards.every(([, s]) => s.whole) && reset.edits === reset.laid && reset.laid === built.length, `reset put every board back whole (${reset.boards.map(([id, s]) => `${id} ${s.letters}`).join(', ')}): the world holds ${reset.edits} edits, the ${reset.laid} that lay the boards`)

  results.errors = errors
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) {
  console.log(`  FAIL ${String(e?.stack ?? e).split('\n').slice(0, 3).join(' ')}`)
  failures.push(String(e?.message ?? e).split('\n')[0])
} finally {
  await browser.close().catch(() => {})
  site.stop()
  back()
}
function lettered(text) { return text.toUpperCase() }
writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1))
console.log('\n' + JSON.stringify(results))
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
