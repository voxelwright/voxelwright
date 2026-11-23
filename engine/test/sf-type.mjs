// The SF realm's words are set in the kit's own faces (#450, page/typeface.ts): the folder `node sf/build.mjs` writes,
// served as plain files. Chrome with WebGPU; one GPU is shared, so a failed run is worth one more before it is believed.
//
//   node test/sf-type.mjs [--no-build] [--dist dist-sf]
//
// For each face (Vox Zakon, the default with no `?face=`, and Vox Block with `?face=block`) it fails unless:
//   - the BLOG board's lamp is the kit's glyph set, cell for cell: each letter's lamp, read from the world's cells on
//     its panel, is the glyph the kit draws for that character at the board's cells a cell (kit/src/core/fonts): the
//     face's display set at 1280 x 720, its compact set on the phone (typeface.ts, boards.ts);
//   - every key of the first view and of explore mode (Credits, the tools, the weather, Reset, the hour's fold)
//     is set in the face's key font, and that font is loaded (its file came, and the browser took it), at 1280 x 720
//     and on an upright phone (390 x 844), with no key's words wider or taller than its key and every key on screen;
//   - only the chosen face is fetched: the other face's key font is not asked for, nor are Zakon's glyph sets with Block
//     (Block's is the kit's own: its lettering part, kit/src/components/lettering.js, imports it whatever the face);
//   - what the face costs before the park is shown is said (the switch, the glyph set, the key font, as sent);
//   - a glyph set that does not come leaves out the lettering boards alone: the logos and the banner stand;
//   - BLOG is unlit by day, and by night its letters strike a beat apart and are all lit within four seconds.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { voxels } from '../kit/src/core/fonts/index.js'
import { block } from '../kit/src/core/fonts/block.js'
import { zakon } from '../kit/src/core/fonts/zakon.js'
import { zakoncaps } from '../kit/src/core/fonts/zakon-text.js'
import { sign } from '../kit/src/core/fonts/sign.js'

const dist = join(here, arg('dist', 'dist-sf'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
const FACES = [
  { name: 'Vox Zakon', query: '', set: zakon, compact: zakoncaps, glyphs: '/kit/src/core/fonts/zakon.js', compactGlyphs: '/kit/src/core/fonts/zakon-text.js', key: 'Vox Zakon Text', keyFile: '/kit/fonts/vox-zakon/vox-zakon-text-', not: ['/kit/fonts/vox-text/'] },
  { name: 'Vox Block', query: 'face=block', set: block, compact: sign, glyphs: '/kit/src/core/fonts/block.js', compactGlyphs: '/kit/src/core/fonts/sign.js', key: 'Vox Text', keyFile: '/kit/fonts/vox-text/vox-text-', not: ['/kit/src/core/fonts/zakon', '/kit/fonts/vox-zakon/'] },
]
const site = await plain(dist, '127.0.0.1', 0, {})
const back = await turn()
const browser = await chromium.launch(CHROME)
const kb = (n) => `${(n / 1024).toFixed(1)} KB`
/** A glyph's cells as a set of "x,y" from its own top left. */
const shapeOf = (cells) => { const x0 = Math.min(...cells.map((c) => c[0])), y0 = Math.min(...cells.map((c) => c[1])); return new Set(cells.map(([x, y]) => `${x - x0},${y - y0}`)) }
const same = (a, b) => a.size === b.size && [...a].every((k) => b.has(k))
/** Every kit key shown on the page: its words, the family it is set in, and whether its words stay inside it and it on screen. */
const KEYS = () => [...document.querySelectorAll('#first .vx-button, #realm .vx-button, #realm .vx-toggle-group > label')].filter((el) => el.getBoundingClientRect().width > 0 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((el) => {
  const r = el.getBoundingClientRect(), words = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }; for (let n = words.nextNode(); n; n = words.nextNode()) { if (!n.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(n); /* (the kit moves a key's words with its face as it rises and sinks, by a transform on what holds them: taken out, the words against the key at rest) */ let dx = 0, dy = 0; for (let a = n.parentElement; a && a !== el; a = a.parentElement) { const tf = getComputedStyle(a).transform; if (tf !== 'none') { const m = new DOMMatrix(tf); dx += m.m41; dy += m.m42 } } for (const q of range.getClientRects()) { t.left = Math.min(t.left, q.left - dx); t.top = Math.min(t.top, q.top - dy); t.right = Math.max(t.right, q.right - dx); t.bottom = Math.max(t.bottom, q.bottom - dy) } }; if (t.left === Infinity) Object.assign(t, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  // (`clear`, in the key's cells: how far its words stand from its sides, where the kit draws its caps over the padding.)
  const vx = parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4
  return { words: el.textContent.trim() || el.getAttribute('aria-label'), family: getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '').trim(), over: Math.max(0, r.left - t.left, t.right - r.right, r.top - t.top, t.bottom - r.bottom), on: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tool: !!el.closest('#realm .tools'), clear: [(t.left - r.left) / vx, (r.right - t.right) / vx] }
})
/** Whether the bank of tools covers the place's name in the corner (bay.ts, #where): the overlap of the two, px. */
const COVERS = () => {
  const bank = document.querySelector('#realm .tools')?.getBoundingClientRect(), line = document.querySelector('#where > div'), name = line?.textContent ? (() => { const r = document.createRange(); r.selectNodeContents(line); return r.getBoundingClientRect() })() : null
  if (!bank?.width || !name?.width) return { px: -1, bank: bank ? [Math.round(bank.left), Math.round(bank.top)] : null, name: line?.textContent ?? null }
  // (Over it, or nearer it than three of the bank's cells: the kit draws the bank's body out past its box.)
  const vx = parseFloat(getComputedStyle(document.querySelector('#realm .tools')).getPropertyValue('--vx')) || 4, side = Math.min(bank.bottom, name.bottom) > Math.max(bank.top, name.top)
  return { px: side ? Math.max(0, Math.min(bank.right, name.right) - Math.max(bank.left, name.left) + 3 * vx) : 0, bank: [Math.round(bank.left), Math.round(bank.top), Math.round(bank.right), Math.round(bank.bottom)], name: [line.textContent, Math.round(name.left), Math.round(name.top), Math.round(name.right), Math.round(name.bottom)] }
}
try {
  for (const face of FACES) {
    for (const [size, options] of [['1280x720', { viewport: { width: 1280, height: 720 } }], ['390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
      console.log(`\n${face.name}${face.query ? ` (?${face.query})` : ' (no ?face=)'}, ${size}`)
      const context = await browser.newContext(options), page = await context.newPage(), from = Date.now()
      // (The realm's controls as a bank, `?hud=classic`, where every key is shown at once: the page with no switch has the
      // wheel, whose keys sf-hud measures.)
      await page.goto(`${site.url}/sf/index.html?hud=classic${face.query ? `&${face.query}` : ''}`)
      await page.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 300_000 })
      const near = await page.evaluate(() => performance.timeOrigin + globalThis.engine.seen.near)
      await page.waitForFunction(() => globalThis.engine.seen.whole > 0 && globalThis.engine.boards, null, { timeout: 300_000 })
      await page.evaluate(() => { globalThis.engine.first.engage(); return new Promise((r) => setTimeout(r, 2500)) })
      await page.evaluate(() => document.fonts.ready)
      const asked = site.asked.filter((a) => a.at >= from)
      {
        // ── BLOG's lamp, cell for cell, against the kit's own glyphs: the display set, or on a phone the compact ──
        const set = options.hasTouch ? face.compact : face.set
        const readBoard = (id = 'blog') => page.evaluate((id) => {
          const e = globalThis.engine, l = e.boards.letters?.(id)
          if (!l) return null
          // The panel's front layer, column by column from its left edge, row by row from its top: 1 lamp, 2 panel, 0
          // anything else (a board's own kinds, boards.ts LETTER and PANEL: a wall behind a wide board is not its panel).
          const LETTER = 15 | (6 << 8), PANEL = 10 | (14 << 8), rows = []
          for (let y = l.high - 1; y >= 0; y--) {
            let row = ''
            for (let k = 0; k < l.wide; k++) {
              const along = k + 0.5 - l.wide / 2, kind = e.kind(l.middle[0] + l.right[0] * along - l.normal[0] * 0.5, l.middle[1] - l.high / 2 + y + 0.5, l.middle[2] + l.right[2] * along - l.normal[2] * 0.5)
              row += kind === LETTER ? '1' : kind === PANEL ? '2' : '0'
            }
            rows.push(row)
          }
          return { face: l.face, px: l.px, chars: l.middles.map((m) => m.ch).join(''), rows }
        }, id)
        /** A board's panels as read: runs of columns with something in them, a column of nothing between two. */
        const panelsOf = (board) => { const filled = [...board.rows[0]].map((_, k) => board.rows.some((r) => r[k] !== '0')), out = []; for (let k = 0; k < filled.length; k++) if (filled[k] && !filled[k - 1]) out.push([k, k]); else if (filled[k]) out.at(-1)[1] = k; return out }
        const board = await readBoard()
        if (!board) { check(false, 'the boards say where BLOG\'s letters are (boards.letters)'); await context.close(); continue }
        // (The compact sets alias capitals they share with Latin: a letter is looked up as the board's face has it.)
        const panels = panelsOf(board)
        const read = panels.map(([a, b]) => { const cells = []; board.rows.forEach((r, y) => { for (let k = a; k <= b; k++) if (r[k] === '1') cells.push([k, y]) }); return cells })
        const right = [...board.chars].filter((ch, i) => read[i]?.length && same(shapeOf(read[i]), shapeOf(voxels(set.glyphs[ch], board.px, true))))
        check(board.face === set.name && panels.length === board.chars.length && right.length === board.chars.length, `BLOG is set in ${board.face} at ${board.px} cells a cell: ${panels.length} panels for "${board.chars}", ${right.length} of them lamp exactly as the kit's ${set.name} draws the letter`)
        // EXPLORE (sf/boards.json), the way in, on a far roof: its cells in the same face, which its far face is painted
        // from (boards.ts); and at 3 m too small for the display set's cells to be four of the world's, so in the compact
        // set wherever the picture is.
        const explore = await readBoard('explore'), xPanels = explore ? panelsOf(explore) : [], xSet = face.compact
        const xRead = xPanels.map(([a, b]) => { const cells = []; explore.rows.forEach((r, y) => { for (let k = a; k <= b; k++) if (r[k] === '1') cells.push([k, y]) }); return cells })
        const xRight = explore ? [...explore.chars].filter((ch, i) => xRead[i]?.length && same(shapeOf(xRead[i]), shapeOf(voxels(xSet.glyphs[ch], explore.px, true)))) : []
        check(explore?.face === xSet.name && explore.chars === 'EXPLORE' && xRight.length === 7 && (options.hasTouch ? Math.abs(explore.px * xSet.cap - 30) <= xSet.cap / 2 : explore.px * xSet.cap >= 30), `EXPLORE is set in ${explore?.face} at ${explore?.px} cells a cell (a capital ${explore ? (explore.px * xSet.cap) / 10 : '?'} m, its record asks 3: ${options.hasTouch ? 'as near as whole cells allow' : 'at least that'}): ${xPanels.length} panels for "${explore?.chars}", ${xRight.length} of them lamp exactly as the kit's ${xSet.name} draws the letter`)
        // By day its letters are painted; by night they strike, not all at once, and are all lit within four seconds.
        const strike = await page.evaluate(async () => {
          const e = globalThis.engine, l = e.boards.glow, wait = (ms) => new Promise((r) => setTimeout(r, ms))
          e.hour = 13; await wait(800)
          const day = [...l.power.blog]
          e.hour = 21.5
          for (let i = 0; i < 40 && l.power.blog.every((v) => v === 0); i++) await wait(50)
          l.hold = 0.45; await wait(300)
          const early = [...l.power.blog]
          l.hold = null
          const began = performance.now()
          for (let i = 0; i < 80 && !l.settled; i++) await wait(50)
          const night = [...l.power.blog], took = Math.round(performance.now() - began)
          e.hour = 13; await wait(800)
          return { day, early, night, took }
        })
        const r2 = (a) => a.map((v) => Math.round(v * 100) / 100).join(' ')
        check(strike.day.every((v) => v === 0) && strike.early.some((v) => v === 0) && strike.early.some((v) => v > 0) && strike.night.every((v) => v > 0.8) && strike.took < 4000, `BLOG unlit by day (${r2(strike.day)}), by night 0.45 s into its strike some letters lit and some not (${r2(strike.early)}), all lit ${strike.took} ms later (${r2(strike.night)})`)
        // Two words in the display set, whose spacing tucks letters closer than their boxes (A after Y, A after W): each
        // letter on a panel of its own, and the word space kept between R and W.
        if (!options.hasTouch) {
          await page.evaluate(() => globalThis.realm.signs.set('blog', { text: 'TAYLOR WAY' }))
          await page.waitForTimeout(1500)
          const two = await readBoard(), parts = panelsOf(two), gap = parts[6] && parts[5] ? parts[6][0] - parts[5][1] - 1 : -1
          check(two.chars === 'TAYLORWAY' && parts.length === 9 && gap >= 2 * two.px, `"TAYLOR WAY" is laid as ${parts.length} panels for ${two.chars.length} letters, ${gap} cells clear between R and W (at least two of the face's cells, ${2 * two.px})`)
          await page.evaluate(() => globalThis.realm.signs.set('blog', null))
          await page.waitForTimeout(1500)
        }
      }
      // ── The keys ──
      const keys = await page.evaluate(KEYS)
      // (On a phone the hour's panel is folded behind its key: unfolded, its keys are measured too.)
      if (options.hasTouch) { await page.locator('#realm .fold').tap(); await page.waitForTimeout(1500); keys.push(...(await page.evaluate(KEYS)).filter((k) => !keys.some((o) => o.words === k.words))) }
      const loaded = await page.evaluate((family) => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === family).map((f) => `${f.weight} ${f.status}`), face.key)
      const wrong = keys.filter((k) => k.family !== face.key), over = keys.filter((k) => k.over > 0.5 || !k.on)
      check(keys.length >= 13 && !wrong.length && loaded.some((s) => s.endsWith('loaded')), `${keys.length} keys set in ${face.key} (${loaded.join(', ') || 'no such font'})${wrong.length ? `; not: ${wrong.map((k) => `${k.words} in ${k.family}`).join(', ')}` : ''}`)
      check(!over.length, `every key's words inside it and every key on screen${over.length ? `; not: ${over.map((k) => `${k.words} (${Math.round(k.over)} px over${k.on ? '' : ', off screen'})`).join(', ')}` : ''}`)
      // A tool's first figure stood under its key's side wall (3 Big charge on a phone, #450: 4 cells from its box's left,
      // where the kit draws the wall over the padding): its words 5.4 cells from its box's left and 3.5 from its right.
      const tools = keys.filter((k) => k.tool), tight = tools.filter((k) => k.clear[0] < 5.4 || k.clear[1] < 3.5), say = (k) => `${k.words} ${k.clear.map((v) => Math.round(v * 10) / 10).join(' and ')}`
      check(tools.length && !tight.length, `every tool's words clear of its key's side walls (5.4 cells from its box's left, 3.5 from its right; the tightest ${tools.length ? say(tools.reduce((a, k) => (k.clear[0] < a.clear[0] ? k : a))) : '-'})${tight.length ? `; not: ${tight.map(say).join(', ')}` : ''}`)
      if (!options.hasTouch) {
        // (The name is that of the street the eye is over, which it is told a beat after it stands still.)
        await page.waitForFunction(() => document.querySelector('#where > div')?.textContent, null, { timeout: 15_000 }).catch(() => null)
        const c = await page.evaluate(COVERS)
        check(c.px === 0, `the bank of tools stands clear of the place's name in the corner: ${c.px < 0 ? 'no name shown' : `${Math.round(c.px)} px over it or within three cells`} (the bank ${JSON.stringify(c.bank)}, the name ${JSON.stringify(c.name)})`)
      }
      // ── What was fetched ──
      const glyphs = options.hasTouch ? face.compactGlyphs : face.glyphs
      const mine = asked.filter((a) => a.status === 200 && (a.path === glyphs || a.path.startsWith(face.keyFile)))
      const others = asked.filter((a) => face.not.some((p) => a.path.startsWith(p)))
      check(mine.some((a) => a.path === glyphs) && mine.some((a) => a.path.startsWith(face.keyFile)) && !others.length, `${glyphs} and ${face.key}'s file are fetched${others.length ? `; and so is the other face's: ${others.map((a) => a.path).join(', ')}` : ', the other face is not'}`)
      const before = asked.filter((a) => a.status === 200 && a.at <= near && (/\/page\/typeface\.js$/.test(a.path) || a.path.startsWith('/kit/src/core/fonts/') || a.path.startsWith('/kit/fonts/vox-')))
      console.log(`  (report) before the park is shown the face costs ${kb(before.reduce((n, a) => n + a.wire, 0))} as sent (${kb(before.reduce((n, a) => n + a.bytes, 0))} unpacked): ${before.map((a) => a.path.split('/').pop()).join(', ')}`)
      await context.close()
    }
  }
  // ── A face asked for that is none: said, and the default is used ──
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage(), said = []
  page.on('console', (m) => { if (m.type() === 'error') said.push(m.text()) })
  await page.goto(`${site.url}/sf/index.html?hud=classic&face=comic`)
  await page.waitForFunction(() => globalThis.engine?.boards, null, { timeout: 300_000 })
  const set = await page.evaluate(() => globalThis.engine.boards.letters?.('blog')?.face)
  check(set === 'Vox Zakon' && said.some((t) => t.includes('?face=comic is no face')), `?face=comic is said on the console ("${said.find((t) => t.includes('face=comic'))?.slice(0, 70)}…") and BLOG is set in ${set}`)
  await context.close()
  // ── A face that does not come: the lettering boards are left out and said, and the other signs stand ──
  const failing = await plain(dist, '127.0.0.1', 0, { fail: (path) => (path === '/kit/src/core/fonts/zakon.js' ? 503 : 0) })
  const lost = await browser.newContext({ viewport: { width: 1280, height: 720 } }), torn = await lost.newPage(), warned = []
  torn.on('console', (m) => { if (m.type() === 'warning') warned.push(m.text()) })
  await torn.goto(`${failing.url}/sf/index.html?hud=classic`)
  await torn.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && 'boards' in globalThis.engine, null, { timeout: 300_000 })
  const left = await torn.evaluate(() => { const b = globalThis.engine.boards; return b && { blog: b.letters('blog'), logos: b.records.filter((r) => r.type === 'logo').map((r) => !!b.where(r.id)).filter(Boolean).length, plane: !!b.plane } })
  check(!!left && left.blog === null && left.logos > 0 && left.plane && warned.some((t) => t.includes('no lettering boards')), `with its glyph set refused (503) the page says so ("${warned.find((t) => t.includes('lettering'))?.slice(0, 60)}…"), lays no BLOG, and keeps ${left?.logos} logos on the picture and the banner's plane`)
  await lost.close(); failing.stop()
} finally { await browser.close(); site.stop(); back() }
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1) }
console.log('\nall ok')
