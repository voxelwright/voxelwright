// The board against the reference (#144). The owner's bar is the two films in the Fable 5.2
// review he linked: a town of cells being broken, and the same engine as the Earth. Each row
// here is one thing a viewer sees in them, with a frame of theirs and a repeatable shot of
// ours beside it, taken as the page shows it by itself: at the picture size it holds its frames
// at, stamped with both. The films are not in the repo; --fetch gets them.
//
//   node test/versus.mjs --out dir [--only key,key] [--fetch]
//
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, has, start, still } from './kit.mjs'
import { from, ROWS } from './rows.mjs'

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
    await still(page)
    await from(page, ...row.stand)
    await page.waitForTimeout(400)
    await still(page, { sun: true })
    const early = await row.act?.(page)
    if (!early) { await page.waitForTimeout(400); await still(page, { sun: true }); await page.waitForTimeout(2500) }
    const live = await page.evaluate(() => ({ fps: Math.round(1000 / globalThis.engine.frameMs), scale: globalThis.engine.scale, ms: globalThis.engine.gpuMs }))
    await writeFile(join(out, `${row.key}-ours.png`), early || await page.screenshot())
    row.our = `${row.key}-ours.png`
    row.stamp = `${live.fps} frames a second with the picture at ${live.scale.toFixed(2)} of 2560 x 1440 (march ${live.ms.toFixed(1)} ms)`
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
} catch (e) {
  failures.push(String(e))
}
const count = (state) => ROWS.filter((r) => r.state === state).length
console.log(`\n${ROWS.map((r) => `  ${r.state.padEnd(6)} ${r.key.padEnd(7)} ${r.what}`).join('\n')}`)
console.log(`\nnone ${count('none')}, behind ${count('behind')}, level ${count('level')}, ahead ${count('ahead')} of ${ROWS.length} rows; pictures in ${out}`)
await finish('versus')
