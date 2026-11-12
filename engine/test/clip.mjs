// Films a row of the board as the page shows it, in real time (#144): a film, a strip of its
// frames to look at, and the gaps between the page's frames while it was filmed.
//
//   node test/clip.mjs --row tumble --out dir [--seconds 5]
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { arg, film, start } from './kit.mjs'
import { aimed, place, ROWS } from './rows.mjs'

const row = ROWS.find((r) => r.key === arg('row', '')), out = resolve(arg('out', '.')), seconds = Number(arg('seconds', '5'))
if (!row?.stand) { console.error(`no shot of ours for the row "${arg('row', '')}"; rows with one: ${ROWS.filter((r) => r.stand).map((r) => r.key).join(' ')}`); process.exit(2) }
await mkdir(out, { recursive: true })
const { city, failures, finish } = await start()
try {
  const page = await city('', { size: [1280, 720], dpr: 2 })
  await page.addStyleTag({ content: '#aim, #boom, #tools { display: none }' })
  await place(page, row)
  const wrong = await aimed(page, row)
  if (wrong) throw new Error(wrong)
  // A still taken mid-way would stall the page it is filming.
  page.screenshot = async () => null
  const took = await film(page, seconds, async () => { await row.act?.(page) })
  const live = await page.evaluate(() => ({ scale: globalThis.engine.scale, fell: { ...globalThis.engine.fell } }))
  const webm = join(out, `${row.key}.webm`), mp4 = join(out, `${row.key}.mp4`), strip = join(out, `${row.key}-strip.jpg`)
  await writeFile(webm, took.webm)
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-vf', 'scale=1280:-2', mp4])
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-vf', `fps=${(20 / took.seconds).toFixed(3)},scale=480:-1,tile=4x5`, '-frames:v', '1', strip])
  console.log(`${row.key}: ${took.frames} frames in ${took.seconds.toFixed(1)} s, gaps p50 ${took.p50.toFixed(1)} p95 ${took.p95.toFixed(1)} worst ${took.worst.toFixed(1)} ms, ${took.long.length} over 25 ms${took.long.length ? ` (${took.long.join(', ')})` : ''}; picture at ${live.scale.toFixed(2)} of full size while filmed\n  ${live.fell.pieces} bodies in all (${live.fell.cells} cells), ${live.fell.most} at once at most; a blast worked out in ${live.fell.ms.toFixed(0)} ms, the solver's longest frame ${live.fell.worstMs.toFixed(1)} ms\n  ${mp4}\n  ${strip}`)
} catch (e) {
  failures.push(String(e))
}
await finish('clip')
