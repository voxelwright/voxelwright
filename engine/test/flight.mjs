// Runs the measuring flight for real (#140): the page in the installed Chrome drawing with
// WebGPU, and every report it posts read off the wire. Nothing is stubbed: the numbers printed
// are this machine's.
//
//   node test/flight.mjs [--seconds 8] [--query "grid=8,8,8&levels=8&pool=128"] [--size 1280,720] [--dpr 2] [--shot picture.png]
//   --phone  a phone's screen with touch, so the page takes the settings and the handlers it would on one
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, has, here, start } from './kit.mjs'

const seconds = arg('seconds', '8'), shot = arg('shot', ''), phone = has('phone')
const { url, page: open, check, failures, finish } = await start()
// What the page posts is read off the wire, so the server's own file is not needed.
const all = []
try {
  const page = await open({ size: arg('size', phone ? '852,393' : '1280,720').split(',').map(Number), dpr: Number(arg('dpr', phone ? '3' : '2')), phone })
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/report')) all.push({ at: new Date().toISOString(), ...r.postDataJSON() }) })
  await page.goto(`${url}/?seconds=${seconds}&${arg('query', '')}`)
  const t0 = Date.now()
  let last
  for (;;) {
    await page.waitForTimeout(500)
    last = all.at(-1)
    if (last?.stage === 'breaks' || last?.stage === 'error' || Date.now() - t0 > 240_000) break
  }
  if (shot) await page.screenshot({ path: shot })
  for (const stage of ['start', 'made', 'places', 'flight', 'breaks']) check(all.some((r) => r.stage === stage), `no "${stage}" report was kept`)
  check(last?.stage !== 'error', `the page failed: ${last?.notes?.join(' | ')}`)
  check(!last?.faults?.length, `the device reported: ${last?.faults?.join(' | ')}`)
  check(last?.places?.length === 5 && last.places.every((p) => p.rays > 0 && p.shadows > 0 && p.all > 0), 'a place has no timings')
  check(last?.world?.full === 0 && last?.full === 0, `${last?.world?.full} sectors did not fit`)
  if (phone) check(last?.env?.touch > 0 && last?.world?.grid?.join() === '8,8,8' && last?.world?.levels === 8, `the page did not take a phone's settings (touch ${last?.env?.touch}, grid ${last?.world?.grid})`)
  check(last?.places?.every((p) => p.undrawn === 0), `sun maps were not all drawn at a place: ${last?.places?.map((p) => p.undrawn).join(' ')}`)
  const tree = last?.breaks?.find((b) => b.name === 'tree'), fronts = last?.breaks?.filter((b) => b.name === 'front') ?? []
  check(tree?.hit && tree.cells > 3000, `the cut tree did not come down (${tree?.cells} cells)`)
  check(fronts.length === 5 && fronts.every((b) => b.hit) && fronts.reduce((n, b) => n + b.cells, 0) > 300, `the house front did not come down (${fronts.map((b) => b.cells).join(' ')} cells)`)
  check(fronts.every((b) => b.off < 20), `a charge meant for the house front across the street struck something else (${fronts.map((b) => b.off).join(' ')} m off)`)
  check(last?.breaks?.every((b) => !b.late), 'a break was not over in 15 s')
  check(!last?.notes?.some((n) => n.startsWith('settl')), `settling failed: ${last?.notes?.join(' | ')}`)
  check(last?.world?.whole === last?.world?.levels, `only ${last?.world?.whole} of ${last?.world?.levels} boxes were whole`)
} catch (e) {
  failures.push(String(e))
}
const kept = join(await mkdtemp(join(tmpdir(), 'engine-flight-')), 'reports.jsonl')
await writeFile(kept, all.map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log(spawnSync('node', ['test/read.mjs', kept], { cwd: here, encoding: 'utf8' }).stdout)
await finish('flight')
