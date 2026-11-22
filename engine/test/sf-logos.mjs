// The SF realm's logos read at every detail the realm draws them at (#450): the X keeps its two strokes, Twitch its
// eyes, LinkedIn's "in" its letters. The folder `node sf/build.mjs` writes, served as plain files, in Chrome with WebGPU.
//
//   node test/sf-logos.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/logos/after] [--only desktop,phone,night]
//
// The picture is drawn at a share of the page's pixels (main.ts `scale`, 0.3 to 1, which the frame rate steers) and
// then spread over the page. Each logo is read at that share's own pixels (the target's): what the picture is with the
// logos and without them says which pixels are the logo (within its own quad), and two means over those pixels (from
// its whitest and its most coloured or darkest) split them into its white and its colour (the X's black, Twitch's
// purple, LinkedIn's blue; by day Twitch's purple is lit nearly as bright as its white): on how coloured a pixel is
// where the mark has a colour, on how light where it has not. It is held to:
//   - its shape: it overlaps the mark drawn smooth from page/logos.ts over the same four corners at the same pixels
//     (a pixel the mark covers a quarter of or more is its; IoU, the best within 2 px either way) by IOU or more: it
//     is there and in its place. (Its colours' overlaps are said, not held to: the mark drawn smooth at 12 px has
//     lost Twitch's eyes and the "in" itself, so it is no measure of whether they are there.)
//   - what makes it that mark, on two rows or more of the target's pixels where the mark has it: Twitch's two eyes (white,
//     purple, white, purple, white across its face); the "in"'s strokes (white, blue, white, blue, white across the
//     n); the X's two strokes (a row of its top quarter crossing two runs of black, or three where it crosses the
//     hollow of its broad stroke, and a row of its bottom quarter two or more), and no row above its crossing a
//     speckle (more than three runs of black; from its crossing down, where its thin stroke's halves meet the broad
//     one and its tower's spire shows through, more than five; its frame's beam at its foot is no part of it).
//   A logo under SMALLEST px (9 tall, 8 wide) is said, not held to: its mark has no room for a pixel a stem.
// Where:
//   - desktop (1280 x 720): the park's camera at full detail on a clear afternoon, and overcast at every scale the
//     frame rate may choose (the look check's overcast picture was one of them); flying free 550 m from the towers,
//     and 40 degrees round them from the park's way (the signs face the park: from there each is seen at most 0.9 as
//     wide for its height as its mark, which is said and held to); every logo in the picture;
//   - phone (390 x 844, three pixels to a point): the first view as the page opens, at a phone's first scale (0.5) and the least,
//     and flying free in the realm; in the first view all three (its upright frame holds them, sf/realm.json: about 19 px tall), flying free two or more;
//   - night (said, not held to: the X's black on the night sky is no change to read it by).
// Pictures: each case's frame, and the three logos at the target's pixels eight times over beside the mark they are held to.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'logos', 'after'))
const only = new Set(arg('only', 'desktop,phone,night').split(','))
const IOU = 0.45
/** How tall and how wide a logo must be for its mark to have a pixel each for its stems and the gaps between (Twitch and the "in": seven across, five up and their sides). */
const SMALLEST = [9, 8]
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const PARK = { x: 51646.7, y: 85.98, z: 66402.3, yaw: 2.09798, pitch: -0.00916 }

const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { console.error(`stopped by ${signal}`); back(); process.exit(1) })
const browser = await chromium.launch(CHROME)
const site = await plain(dist, '127.0.0.1')
const open = async (context) => {
  const page = await context.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  await page.goto(`${site.url}/sf/index.html`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards, null, { timeout: 300_000 })
  // Whatever the page lays over the picture is not the picture (the controls are drawn on a canvas of their own,
  // blocks/stage.ts): hidden while it is read, the engine's canvas (the page's first) alone shown.
  await page.addStyleTag({ content: 'html.reading body * { visibility: hidden !important } html.reading canvas.picture { visibility: visible !important }' })
  await page.evaluate(() => { const e = globalThis.engine; document.querySelector('canvas').classList.add('picture'); e.hour = 15; if (e.boards.plane) e.boards.plane.hold = 0.52 })
  return page
}
const settle = (page) => page.waitForFunction(() => { const e = globalThis.engine, s = e.world.stats; return s.wanted === 0 && s.stale === 0 && e.march.sun.undrawn === 0 }, null, { timeout: 90_000, polling: 250 }).catch(() => null)
const frames = (page, n = 4) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }), n)
/** The eye between the park and the towers, 550 m short of their middle and over their roofs, turned to them; `aside` degrees round them from the park's way (the signs face the park: aside, they are seen from one side). */
const roam = (page, fov, aside = 0) => page.evaluate(({ fov, aside, park }) => {
  const e = globalThis.engine, logos = e.boards.records.filter((b) => b.type === 'logo')
  const mid = [0, 1, 2].map((k) => logos.reduce((n, b) => n + b.at[k], 0) / logos.length / 10)
  const way = [park.x - mid[0], park.z - mid[2]], a = (aside * Math.PI) / 180, from = [way[0] * Math.cos(a) - way[1] * Math.sin(a), way[0] * Math.sin(a) + way[1] * Math.cos(a)], d = Math.hypot(...from)
  const at = { x: mid[0] + (from[0] / d) * 550, y: mid[1] + 60, z: mid[2] + (from[1] / d) * 550 }
  const to = [mid[0] - at.x, mid[1] + 12 - at.y, mid[2] - at.z]
  Object.assign(e.pose, at, { yaw: Math.atan2(to[0], -to[2]), pitch: Math.atan2(to[1], Math.hypot(to[0], to[2])) })
  e.fov = fov
}, { fov, aside, park: PARK })

/** Reads the three logos off the picture as it is now (see the top). */
const read = async (page, name) => {
  const shoot = async () => (await page.locator('canvas').first().screenshot()).toString('base64')
  await page.evaluate(() => document.documentElement.classList.add('reading'))
  await frames(page)
  const on = await shoot()
  await page.evaluate(() => { globalThis.engine.boards.logos = false })
  await frames(page)
  const off = await shoot()
  await page.evaluate(() => { globalThis.engine.boards.logos = true; document.documentElement.classList.remove('reading') })
  writeFileSync(join(shots, `${name}.png`), Buffer.from(on, 'base64'))
  const got = await page.evaluate(async ({ on, off }) => {
    const { MARKS, sign } = await import('/page/logos.js')
    const e = globalThis.engine, canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect(), v = e.view()
    const pixels = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0); return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data } }
    const [A, B] = [await pixels(on), await pixels(off)]
    // The target's pixels (main.ts `fit`), and where each is on the screenshot.
    const tw = Math.max(1, Math.round(canvas.width * e.scale)), th = Math.max(1, Math.round(canvas.height * e.scale)), fx = tw / rect.width, fy = th / rect.height
    // (The screenshot's pixel whose middle is nearest the target pixel's: the page spreads the target over itself smoothly, so one further off is a blend of two.)
    const at = (p, i, j) => { const x = Math.max(0, Math.min(p.w - 1, Math.round(((i + 0.5) * p.w) / tw - 0.5))), y = Math.max(0, Math.min(p.h - 1, Math.round(((j + 0.5) * p.h) / th - 0.5))); return (y * p.w + x) * 4 }
    const lum = (d, k) => 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]
    const project = (p) => { const d = [p[0] - v.eye[0], p[1] - v.eye[1], p[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2], x = (d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (rect.width / rect.height) * far), y = (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far); return [((x + 1) / 2) * tw, ((1 - y) / 2) * th] }
    const out = []
    for (const b of e.boards.records.filter((r) => r.type === 'logo')) {
      const mark = MARKS[b.logo], t = (b.turn * Math.PI) / 180, n = [Math.sin(t), 0, -Math.cos(t)], right = [n[2], 0, -n[0]], high = b.size * 10, wide = high * mark.wide
      const y0 = b.at[1] + (b.lift ?? 0) * 10 + (b.mount === 'roof' ? high * 0.16 : 0), corner = (u, up) => project([b.at[0] + right[0] * u * wide, y0 + up * high, b.at[2] + right[2] * u * wide])
      const tl = corner(-0.5, 1), tr = corner(0.5, 1), bl = corner(-0.5, 0), br = corner(0.5, 0)
      const xs = [tl[0], tr[0], bl[0], br[0]], ys = [tl[1], tr[1], bl[1], br[1]]
      const x0 = Math.floor(Math.min(...xs)) - 3, y0p = Math.floor(Math.min(...ys)) - 3, cw = Math.ceil(Math.max(...xs)) + 3 - x0, ch = Math.ceil(Math.max(...ys)) + 3 - y0p
      if (x0 < 0 || y0p < 0 || x0 + cw > tw || y0p + ch > th || cw > 400) { out.push({ id: b.id, logo: b.logo, missing: true }); continue }
      // The mark over the same corners, at the target's pixels: 0 nothing, 1 dark, 2 bright.
      const P = 256, PW = Math.round(P * mark.wide), ref = new OffscreenCanvas(cw, ch), pen = ref.getContext('2d')
      pen.setTransform((tr[0] - tl[0]) / PW, (tr[1] - tl[1]) / PW, (bl[0] - tl[0]) / P, (bl[1] - tl[1]) / P, tl[0] - x0, tl[1] - y0p)
      sign(pen, mark, PW, P)
      const rd = pen.getImageData(0, 0, cw, ch).data, want = new Uint8Array(cw * ch)
      // (A pixel its halo covers a quarter of is its: drawn in whole pixels, a halo under one is a pixel.)
      for (let k = 0; k < cw * ch; k++) if (rd[k * 4 + 3] >= 64) want[k] = lum(rd, k * 4) > 150 ? 2 : 1
      // The picture's: the logo where it changed the picture, bright against 0.6 of its brightest.
      const crop = new Uint8Array(cw * ch * 3), logo = new Uint8Array(cw * ch), ls = []
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
        const ka = at(A, x0 + i, y0p + j), kb = at(B, x0 + i, y0p + j), k = j * cw + i
        crop.set([A.d[ka], A.d[ka + 1], A.d[ka + 2]], k * 3)
        if (Math.abs(A.d[ka] - B.d[kb]) + Math.abs(A.d[ka + 1] - B.d[kb + 1]) + Math.abs(A.d[ka + 2] - B.d[kb + 2]) > 40) { logo[k] = 1; ls.push(lum(A.d, ka)) }
      }
      // (Only within its quad, a pixel grown but at its foot: under it is its roof frame, and round it no part of the mark.)
      const q = [tl, tr, br, bl], turning = Math.sign(q.reduce((n, a, k) => { const c = q[(k + 1) % 4]; return n + a[0] * c[1] - c[0] * a[1] }, 0)) || 1
      const inside = (i, j) => q.every((a, k) => { const c = q[(k + 1) % 4], px = i + x0 + 0.5, py = j + y0p + 0.5; return (turning * ((c[0] - a[0]) * (py - a[1]) - (c[1] - a[1]) * (px - a[0]))) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1) >= (k === 2 ? 0 : -1) })
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (!inside(i, j)) logo[j * cw + i] = 0
      ls.length = 0; for (let k = 0; k < cw * ch; k++) if (logo[k]) ls.push(lum(crop, k * 3))
      // Its two colours as the picture has them (the day lifts Twitch's purple near its white): two means over its
      // pixels, from its whitest and its most coloured or darkest; the brighter and greyer of them is its white.
      const ks = []; for (let k = 0; k < cw * ch; k++) if (logo[k]) ks.push(k)
      // (Measured as how coloured and how light each is, the colour counted twice: a 1 px eye is a paler purple than the outline.)
      const tone = (k) => { const c = [crop[k * 3], crop[k * 3 + 1], crop[k * 3 + 2]], most = Math.max(...c); return [(most ? (most - Math.min(...c)) / most : 0) * 510, lum(c, 0), 0, c] }, white = (f) => f[1] - f[0]
      const far2 = (a, c) => (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2, got = new Uint8Array(cw * ch)
      if (ks.length) {
        let m = [ks.map(tone).reduce((a, c) => (white(c) > white(a) ? c : a))]
        const colour = (f) => f[0] + 255 - f[1]
        m.push(ks.map(tone).reduce((a, c) => (colour(c) > colour(a) ? c : a)))
        for (let round = 0; round < 8; round++) {
          const sum = [[0, 0, 0, 0], [0, 0, 0, 0]]
          for (const k of ks) { const c = tone(k), n = far2(c, m[0]) <= far2(c, m[1]) ? 0 : 1; sum[n][0] += c[0]; sum[n][1] += c[1]; sum[n][2] += c[2]; sum[n][3]++ }
          m = sum.map((t, n) => (t[3] ? [t[0] / t[3], t[1] / t[3], t[2] / t[3]] : m[n]))
        }
        // Then split on how coloured a pixel is where its colour is a colour (a 1 px eye is a paler purple, nearer the
        // white than the outline is), and on how light for the X (black and white; its halo over the sky is blue).
        const axis = b.logo === 'x' ? 1 : 0, cut = (m[0][axis] + m[1][axis]) / 2, whiteSide = m[0][axis] < cut === (white(m[0]) >= white(m[1]))
        for (const k of ks) got[k] = tone(k)[axis] < cut === whiteSide ? 2 : 1
      }
      // The best overlap of the shape within 2 px, and there the bright's and the dark's.
      const iou = (dx, dy, which) => { let both = 0, either = 0; for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) { const gi = i + dx, gj = j + dy, g = gi >= 0 && gj >= 0 && gi < cw && gj < ch ? got[gj * cw + gi] : 0, w = want[j * cw + i], a = which ? w === which : w > 0, c = which ? g === which : g > 0; if (a && c) both++; if (a || c) either++ } return either ? both / either : 0 }
      let best = { dx: 0, dy: 0, shape: -1 }
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const s = iou(dx, dy, 0); if (s > best.shape) best = { dx, dy, shape: s } }
      // What makes it its mark, on a row of the picture where the mark has it: the runs across the row, as classes.
      const runs = (j, tone) => { const r = []; for (let i = 0; i < cw; i++) { const gj = j + best.dy, gi = i + best.dx, g = gi >= 0 && gj >= 0 && gi < cw && gj < ch ? got[gj * cw + gi] : 0, c = tone ? g : g > 0 ? 1 : 0; if (r.at(-1) !== c) r.push(c) } return r.join('') }
      const rowsAt = (v0, v1) => { const a = Math.floor(tl[1] + (bl[1] - tl[1]) * v0 - y0p), c = Math.ceil(tl[1] + (bl[1] - tl[1]) * v1 - y0p); return Array.from({ length: Math.max(1, c - a + 1) }, (_, k) => a + k).filter((j) => j >= 0 && j < ch) }
      const has = (v0, v1, tone, pattern) => rowsAt(v0, v1).filter((j) => runs(j, tone).includes(pattern)).length >= 2
      // (Each band where the mark draws its feature, as a share of its height down from its top: logos.ts.)
      const side = 0.93, eye = [(1 - side) / 2 + (side * 4.714) / 24, (1 - side) / 2 + (side * 9.857) / 24]
      // (Above its crossing an X's row crosses two strokes, three runs of black where it crosses the hollow of its broad
      // one: more is a speckle of black and white. From its crossing down the halves of its thin stroke meet the broad
      // one's edges, and its feet stand over its tower's spire, which shows through: up to five.)
      const darkRuns = (j) => runs(j, true).split('').filter((c) => c === '1').length, strokes = (v0, v1, least, most) => rowsAt(v0, v1).some((j) => darkRuns(j) >= least && darkRuns(j) <= most)
      const feature = b.logo === 'twitch' ? has(eye[0], eye[1], true, '21212') : b.logo === 'x' ? strokes(0.15, 0.32, 2, 3) && strokes(0.68, 0.85, 2, Infinity) && rowsAt(0.05, 0.45).every((j) => darkRuns(j) <= 3) && rowsAt(0.45, 0.85).every((j) => darkRuns(j) <= 5) : has(0.6, 0.8, true, '21212')
      out.push({ rows: rowsAt(0, 1).map((j) => runs(j, true)), id: b.id, logo: b.logo, px: Math.round(Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) * 10) / 10, narrow: Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) / Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) / mark.wide, wide: Math.round(Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) * 10) / 10, shape: best.shape, bright: iou(best.dx, best.dy, 2), dark: iou(best.dx, best.dy, 1), feature, cw, ch, crop: Array.from(crop), want: Array.from(want), got: Array.from(got) })
    }
    return { scale: e.scale, target: [tw, th], logos: out }
  }, { on, off })
  // The crops eight times over: the picture's, then what was read off it, then the mark it is held to.
  const Z = 8, strips = got.logos.filter((l) => !l.missing)
  if (strips.length) {
    const w = strips.reduce((n, l) => n + l.cw * 3 * Z + 24, 0), h = Math.max(...strips.map((l) => l.ch)) * Z
    const png = await page.evaluate(async ({ strips, w, h, Z }) => {
      const c = new OffscreenCanvas(w, h), x = c.getContext('2d'), tones = [[128, 140, 150], [40, 20, 120], [255, 255, 255]]
      x.fillStyle = '#222'; x.fillRect(0, 0, w, h)
      let left = 0
      for (const l of strips) {
        for (let part = 0; part < 3; part++) {
          for (let j = 0; j < l.ch; j++) for (let i = 0; i < l.cw; i++) { const k = j * l.cw + i, rgb = part === 0 ? l.crop.slice(k * 3, k * 3 + 3) : tones[(part === 1 ? l.got : l.want)[k]]; x.fillStyle = `rgb(${rgb.join(',')})`; x.fillRect(left + i * Z, j * Z, Z, Z) }
          left += l.cw * Z + (part === 2 ? 24 : 0)
        }
      }
      const blob = await c.convertToBlob(), buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const v of buf) s += String.fromCharCode(v); return btoa(s)
    }, { strips, w, h, Z })
    writeFileSync(join(shots, `${name}-crops.png`), Buffer.from(png, 'base64'))
  }
  return got
}
const r2 = (n) => Math.round(n * 100) / 100
/** Holds each logo of a reading to its mark, or only says it (`said`). */
const judge = (name, got, said = false, need = got.logos.length, narrowed = 0) => {
  const read = got.logos.filter((l) => !l.missing).length
  if (narrowed) check(got.logos.every((l) => !l.missing && l.narrow <= narrowed), `${name}: each logo is seen narrowed, as wide for its height as its mark at most ${narrowed} times (${got.logos.map((l) => `${l.id} ${l.missing ? 'not in the picture' : r2(l.narrow)}`).join(', ')})`)
  if (!said) check(read >= need, `${name} (scale ${got.scale}): ${read} of ${got.logos.length} logos wholly in the picture (asked: ${need} or more)`)
  for (const l of got.logos) {
    if (l.missing) { console.log(`  said ${name}: ${l.id} is not wholly in the picture`); continue }
    // (Smaller than SMALLEST, a mark has no room for a pixel to each of its stems and the gaps between: said.)
    const small = l.px < SMALLEST[0] || l.wide < SMALLEST[1]
    const ok = l.shape >= IOU && l.feature, what = l.logo === 'twitch' ? 'its eyes' : l.logo === 'x' ? 'its two strokes' : 'the strokes of its "in"'
    const line = `${name} (scale ${got.scale}, target ${got.target.join(' x ')}): ${l.id} ${l.px} px tall, overlap with its mark: shape ${r2(l.shape)} (white ${r2(l.bright)}, colour ${r2(l.dark)}); ${what} ${l.feature ? 'there' : 'lost'}`
    if (said || small) console.log(`  said ${line}${small ? ` (under ${SMALLEST.join(' x ')} px: said, not held to)` : ''}`)
    else check(ok, line)
    if (!said && !small && !ok) console.log(`       its rows top to bottom, as runs (0 none, 1 colour, 2 white): ${l.rows.join(' ')}`)
  }
}

try {
  if (only.has('desktop')) {
    console.log('\ndesktop, 1280 x 720')
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const page = await open(context)
    await page.evaluate((p) => { const e = globalThis.engine; Object.assign(e.pose, p); e.fov = 25.05; e.scale = 1 }, PARK)
    await page.waitForTimeout(1500); await settle(page)
    judge('park, clear, full detail', await read(page, 'desktop-park-clear-1'))
    await page.evaluate(() => globalThis.engine.realmControls.sky.set('overcast'))
    await page.waitForFunction(() => !globalThis.engine.realmControls.sky.moving, null, { timeout: 30_000 }).catch(() => null)
    for (let s = 30; s <= 100; s += 5) {
      await page.evaluate((s) => { globalThis.engine.scale = s / 100 }, s)
      await frames(page, 6); await settle(page)
      judge('park, overcast', await read(page, `desktop-park-overcast-${s}`))
    }
    await page.evaluate(() => globalThis.engine.realmControls.sky.set('clear'))
    await page.evaluate(() => globalThis.engine.first?.engage())
    await roam(page, 70)
    await page.waitForTimeout(1500); await settle(page)
    for (const s of [0.75, 0.3]) { await page.evaluate((s) => { globalThis.engine.scale = s }, s); await frames(page, 6); await settle(page); judge('flying free 550 m off', await read(page, `desktop-roam-${s * 100}`)) }
    await roam(page, 70, 40)
    await page.waitForTimeout(1500); await settle(page)
    for (const s of [0.5, 0.3]) { await page.evaluate((s) => { globalThis.engine.scale = s }, s); await frames(page, 6); await settle(page); judge('flying free 550 m off, 40 degrees to one side of them', await read(page, `desktop-aside-${s * 100}`), false, 3, 0.9) }
    if (page.errors.length) check(false, `desktop page errors: ${page.errors.slice(0, 3).join(' | ')}`)
    await context.close()
  }
  if (only.has('phone')) {
    console.log('\nphone, 390 x 844')
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    const page = await open(context)
    await page.waitForTimeout(2000); await settle(page)
    for (const s of [0.5, 0.3]) { await page.evaluate((s) => { globalThis.engine.scale = s }, s); await frames(page, 6); await settle(page); judge('first view', await read(page, `phone-first-${Math.round(s * 100)}`), false, 3) }
    await page.evaluate(() => globalThis.engine.first?.engage())
    await roam(page, 70)
    await page.waitForTimeout(1500); await settle(page)
    for (const s of [0.5, 0.3]) { await page.evaluate((s) => { globalThis.engine.scale = s }, s); await frames(page, 6); await settle(page); judge('flying free 550 m off', await read(page, `phone-roam-${Math.round(s * 100)}`), false, 2) }
    if (page.errors.length) check(false, `phone page errors: ${page.errors.slice(0, 3).join(' | ')}`)
    await context.close()
  }
  if (only.has('night')) {
    console.log('\nnight at the park, 1280 x 720 (said, not held to)')
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const page = await open(context)
    await page.evaluate((p) => { const e = globalThis.engine; Object.assign(e.pose, p); e.fov = 25.05; e.hour = 22 }, PARK)
    await page.waitForTimeout(2500); await settle(page)
    for (const s of [1, 0.4]) { await page.evaluate((s) => { globalThis.engine.scale = s }, s); await frames(page, 6); await settle(page); judge('park by night', await read(page, `night-park-${s * 100}`), true) }
    await context.close()
  }
} finally {
  await browser.close()
  site.stop()
  back()
}
console.log(failures.length ? `\n${failures.length} failed (pictures in ${shots})` : `\nall passed (pictures in ${shots})`)
process.exit(failures.length ? 1 : 0)
