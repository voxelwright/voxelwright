// The board against the reference (#144). The owner's bar is the two films in the Fable 5.2
// review he linked: a town of cells being broken, and the same engine as the Earth. Each row
// here is one thing a viewer sees in them, with a frame of theirs and a repeatable shot of
// ours beside it, taken as the page shows it by itself: at the picture size it holds its frames
// at, stamped with both. The films are not in the repo; --fetch gets them.
//
//   node test/versus.mjs --out dir [--only key,key] [--fetch] [--blind]
//
// --blind also draws sheets for a judge who did not make ours, the sides unnamed: test/judge.md is what to ask.
//
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, has, start, still } from './kit.mjs'
import { aimed, place, ROWS, showed } from './rows.mjs'

const FILMS = join(homedir(), '.village', 'engine', 'ref')
const SOURCE = { engine: 'https://somethingbig.ai/assets/fable-5-2/media/voxel-film.mp4', earth: 'https://somethingbig.ai/assets/fable-5-2/media/earth-720.mp4' }
const out = resolve(arg('out', 'board')), only = arg('only', '').split(',').filter(Boolean)
await mkdir(out, { recursive: true })
if (has('fetch')) {
  await mkdir(FILMS, { recursive: true })
  for (const [name, url] of Object.entries(SOURCE)) if (!existsSync(join(FILMS, `${name}.mp4`))) spawnSync('curl', ['-sL', '-A', 'Mozilla/5.0', '-o', join(FILMS, `${name}.mp4`), url], { stdio: 'inherit' })
}
const { city, page: open, failures, finish } = await start()
const rows = ROWS.filter((r) => !only.length || only.includes(r.key))
try {
  for (const row of rows) {
    if (row.theirs) {
      const film = join(FILMS, `${row.theirs[0]}.mp4`)
      if (existsSync(film)) { spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(row.theirs[1]), '-i', film, '-frames:v', '1', '-vf', 'scale=960:-1', join(out, `${row.key}-theirs.jpg`)]); row.their = `${row.key}-theirs.jpg` }
    }
    if (!row.stand) continue
    // A fresh town for each row, at the size of the owner's screen, the picture's size left to the page.
    const page = await city('', { size: [1280, 720], dpr: 2 })
    await page.addStyleTag({ content: '#hud, #aim, #boom, #tools { display: none }' })
    await place(page, row)
    // A row whose shot does not face its thing, or whose act did not do it, is a failure, and has no picture.
    let wrong = await aimed(page, row), early
    if (!wrong) {
      const was = await page.evaluate(() => globalThis.engine.fell.pieces)
      try { early = await row.act?.(page) } catch (e) { wrong = `${row.key}: ${String(e).split('\n')[0]}` }
      wrong ??= await showed(page, row, was)
    }
    if (wrong) { failures.push(wrong); console.log(`  ${row.key.padEnd(7)} NOT SHOWN: ${wrong}`); await page.context().close(); continue }
    // The picture when all is still again; or, where fire keeps letting things go, after forty seconds of it.
    if (!early) { await page.waitForTimeout(400); await still(page, { sun: true, limit: 40_000 }).catch(() => {}); await page.waitForTimeout(2500) }
    // How fast the page is drawing here: its frames counted over a second, and the worst gap between two. The page's
    // own running figures are not used: taking a picture stalls it, and they then read 22 frames a second for a
    // row that a film shows holding 60, or a march time left over from another picture size.
    const live = await page.evaluate(() => new Promise((done) => {
      let frames = 0, worst = 0, last = performance.now()
      const began = last, tick = (now) => {
        frames++; worst = Math.max(worst, now - last); last = now
        if (now - began < 1000) requestAnimationFrame(tick); else done({ fps: Math.round((frames * 1000) / (now - began)), worst, scale: globalThis.engine.scale })
      }
      requestAnimationFrame(tick)
    }))
    await writeFile(join(out, `${row.key}-ours.png`), early || await page.screenshot())
    row.our = `${row.key}-ours.png`
    row.stamp = `${live.fps} frames a second (worst gap ${live.worst.toFixed(0)} ms) with the picture at ${live.scale.toFixed(2)} of 2560 x 1440`
    console.log(`  ${row.key.padEnd(7)} ${row.stamp}`)
    await page.context().close()
  }
  // The board itself: pages of four rows, theirs on the left, ours on the right.
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const cell = (file, none) => file ? `<img src="${file}">` : `<div class="none">${none}</div>`
  const sheet = await open({ size: [1960, 800], dpr: 1 })
  const shown = rows.filter((r) => r.theirs)
  for (let at = 0, n = 1; at < shown.length; at += 4, n++) {
    const body = shown.slice(at, at + 4).map((r) => `<section><h2><b class="${r.state}">${r.state}</b> ${esc(r.what)}</h2><div class="pair">${cell(r.their, 'film not fetched')}${cell(r.our, 'nothing to show')}</div><p>theirs: ${r.theirs[0]} film at ${r.theirs[1]} s &nbsp;·&nbsp; ours: ${r.stamp ?? 'not built'}</p></section>`).join('')
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:14px 20px;background:#14171c;color:#e8ecf1;font:15px/1.4 -apple-system,system-ui,sans-serif}h2{font-size:18px;margin:10px 0 6px}h2 b{display:inline-block;min-width:64px;padding:1px 8px;border-radius:6px;font-size:13px;text-align:center;background:#444}b.none{background:#7a2b2b}b.behind{background:#8a5a12}b.level{background:#2f6f8f}b.ahead{background:#2e7d46}.pair{display:flex;gap:12px}.pair>*{width:954px;height:537px;object-fit:cover;border-radius:6px}.none{display:flex;align-items:center;justify-content:center;background:#20242b;color:#8d96a3}p{margin:4px 0 0;color:#aab3bf;font-size:13px}</style>${body}`
    await writeFile(join(out, `board-${n}.html`), html)
    await sheet.goto(`file://${join(out, `board-${n}.html`)}`)
    await sheet.screenshot({ path: join(out, `board-${n}.jpg`), fullPage: true, type: 'jpeg', quality: 82 })
  }
  // For a judge who did not make ours: the rows that have both pictures, three a sheet, the two side by side with
  // no word of whose is whose, and which side is which decided by the row's name. The key is kept beside them.
  if (has('blind')) {
    const both = rows.filter((r) => r.their && r.our), key = {}
    for (let at = 0, n = 1; at < both.length; at += 3, n++) {
      const body = both.slice(at, at + 3).map((r) => {
        const oursLeft = [...r.key].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 2 === 0
        key[r.key] = oursLeft ? 'A' : 'B'
        const [a, b] = oursLeft ? [r.our, r.their] : [r.their, r.our]
        return `<section><h2>${esc(r.key)}: ${esc(r.what)}</h2><div class="pair"><figure><img src="${a}"><figcaption>A</figcaption></figure><figure><img src="${b}"><figcaption>B</figcaption></figure></div></section>`
      }).join('')
      const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:14px 20px;background:#14171c;color:#e8ecf1;font:15px/1.4 -apple-system,system-ui,sans-serif}h2{font-size:18px;margin:10px 0 6px}.pair{display:flex;gap:12px}figure{margin:0;position:relative}img{width:954px;height:537px;object-fit:cover;border-radius:6px;display:block}figcaption{position:absolute;left:10px;top:8px;font:700 22px -apple-system,system-ui,sans-serif;background:#000a;padding:2px 10px;border-radius:6px}</style>${body}`
      await writeFile(join(out, `judge-${n}.html`), html)
      await sheet.goto(`file://${join(out, `judge-${n}.html`)}`)
      await sheet.screenshot({ path: join(out, `judge-${n}.jpg`), fullPage: true, type: 'jpeg', quality: 84 })
    }
    await writeFile(join(out, 'judge-key.json'), JSON.stringify(key, null, 2) + '\n')
  }
} catch (e) {
  failures.push(String(e))
}
const count = (state) => ROWS.filter((r) => r.state === state).length
console.log(`\n${ROWS.map((r) => `  ${r.state.padEnd(6)} ${r.key.padEnd(7)} ${r.what}`).join('\n')}`)
console.log(`\nnone ${count('none')}, behind ${count('behind')}, level ${count('level')}, ahead ${count('ahead')} of ${ROWS.length} rows; pictures in ${out}`)
await finish('versus')
