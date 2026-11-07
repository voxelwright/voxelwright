// #47 experiment: capture every generated villager in ?cam=iso (alone at the lineup spot)
// and a close view, record draw calls and triangles against a no-villager baseline,
// shoot both arms and the schema-coverage pairs in rows, render flat silhouettes and
// their pairwise IoU, and write <out>/results.md.
// Usage: node scripts/villagers/capture.mjs <out-dir> [base-url] [--compare=<earlier-out-dir>]   (dev server running)
// --compare adds the earlier run's code row to the lineup sheet (round 2 against round 1, like for like);
// several runs, comma-separated, add a row each. --labels=<a>,<b>,... names the rows, earlier runs first.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const out = resolve(args[0])
const base = args.find((a, i) => i > 0 && /^https?:/.test(a)) ?? 'http://localhost:5330/'
const compare = args.find((a) => a.startsWith('--compare='))?.slice(10).split(',') ?? []
const labels = args.find((a) => a.startsWith('--labels='))?.slice(9).split(',')
const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
const shots = join(out, 'shots')
mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`${base}?cam=iso&q=high&villager=gen&${query}`)
  await page.waitForFunction(() => window.village && window.villagerGen, null, { timeout: 30000 })
  await page.evaluate(() => window.village.ready())
  const report = await page.evaluate(() => window.villagerGen.loaded)
  // Long enough for the camera to settle and the idle pose to breathe; the same wait for every shot.
  await page.waitForTimeout(3000)
  return { page, report }
}
async function shoot(query, file) {
  const { page, report } = await open(query)
  const render = await page.evaluate(() => window.village.snapshot().render)
  if (file) await page.screenshot({ path: join(shots, file), type: 'jpeg', quality: 86 })
  await page.close()
  return { report, render }
}

const ids = Object.keys(results).sort()
const usable = ids.filter((id) => (results[id].repair ?? results[id].first).check.ok)
const baseline = await shoot('gen=none', 'baseline-iso.jpg')
let next = 0
await Promise.all([0, 1].map(async () => {
  while (next < usable.length) {
    const id = usable[next++]
    const iso = await shoot(`gen=${id}&lineup=1`, `${id}-iso.jpg`)
    await shoot(`gen=${id}&lineup=1&close=1`, `${id}-close.jpg`)
    const r = iso.report[id]
    results[id].capture = {
      ok: r.ok, error: r.error, name: r.name, triangles: r.triangles, meshes: r.meshes, buildMs: r.buildMs, timing: r.timing, fixes: r.fixes,
      drawCalls: iso.render.drawCalls - baseline.render.drawCalls,
      frameTriangles: iso.render.triangles - baseline.render.triangles,
    }
    console.log(id, JSON.stringify({ name: r.name, tris: r.triangles, draws: results[id].capture.drawCalls, buildMs: Math.round(r.buildMs) }))
  }
}))

// Rows: each arm side by side, and the hand-made plush beside their coverage specs.
const NS = [...new Set(ids.map((id) => String(results[id].n)))].sort()
const ARMS = ['spec', 'code'].filter((arm) => ids.some((id) => results[id].arm === arm))
const idOf = (rs, arm, n) => Object.keys(rs).find((id) => rs[id].arm === arm && String(rs[id].n) === n)
const row = (arm) => NS.map((n) => idOf(results, arm, n)).filter((id) => usable.includes(id)).join(',')
for (const arm of ARMS) await shoot(`gen=${row(arm)}&lineup=1&close=1`, `row-${arm}.jpg`)
await shoot('gen=hand:dumpling,spec:dumpling,hand:tuft,spec:tuft,hand:moss,spec:moss&lineup=1&close=1', 'coverage.jpg')

// Silhouettes: every result plus the three hand-made plush, flat black on white from the dollhouse heading.
const HAND = ['hand:dumpling', 'hand:tuft', 'hand:moss']
const { page: sp } = await open(`gen=${[...usable, ...HAND].join(',')}&lineup=1`)
const masks = await sp.evaluate(() => window.villagerGen.silhouettes(128))
await sp.close()

/** Bottom-aligned, centre-aligned masks; IoU of every pair. */
function aligned(m) {
  const { w, h, mask } = m
  let x0 = w, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] === '1') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const cx = (x0 + x1) / 2
  const set = new Set()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] === '1') set.add(`${Math.round(x - cx)},${y - y1}`)
  return set
}
const sets = masks.map(aligned)
const iou = masks.map((_, i) => masks.map((__, j) => {
  if (i === j) return 1
  let inter = 0
  for (const p of sets[i]) if (sets[j].has(p)) inter++
  return inter / (sets[i].size + sets[j].size - inter)
}))
const label = (m) => (m.id.startsWith('hand:') ? `${m.name} (hand-made)` : `${m.id} ${m.name}`)
const pairs = []
for (let i = 0; i < masks.length; i++) for (let j = i + 1; j < masks.length; j++) pairs.push({ a: label(masks[i]), b: label(masks[j]), iou: iou[i][j] })
pairs.sort((p, q) => q.iou - p.iou)
for (const [i, m] of masks.entries()) if (results[m.id]) results[m.id].maxIoU = Math.max(...iou[i].filter((_, j) => j !== i))
writeFileSync(join(out, 'silhouettes.json'), JSON.stringify({ ids: masks.map((m) => m.id), names: masks.map((m) => m.name), iou, pairs: pairs.slice(0, 12) }, null, 1))

// The silhouette sheet: each mask, then the IoU matrix.
const cell = (v) => `<td style="background: rgba(184, 58, 58, ${Math.max(0, (v - 0.4) / 0.6).toFixed(2)})">${v.toFixed(2)}</td>`
const html = `<html><head><style>
  body { margin: 0; padding: 20px; background: #f4ece0; font: 14px/1.3 Georgia, serif; color: #3a2a1e; width: 1360px }
  .masks { display: flex; flex-wrap: wrap; gap: 10px } .m { text-align: center; width: 128px; font-size: 12px } canvas { background: #fff; border: 1px solid #d8c8b0 }
  table { border-collapse: collapse; margin-top: 16px; font-size: 12px } td, th { border: 1px solid #d8c8b0; padding: 3px 5px; text-align: center } th { font-weight: normal; max-width: 70px }
  h1 { font-size: 20px; margin: 0 0 10px }
</style></head><body><h1>Silhouettes from the dollhouse heading (bottom- and centre-aligned IoU; 1 = identical outline)</h1>
<div class="masks">${masks.map((m, i) => `<div class="m"><canvas id="c${i}" width="${m.w}" height="${m.h}"></canvas><br>${label(m)}</div>`).join('')}</div>
<table><tr><th></th>${masks.map((m) => `<th>${m.name}</th>`).join('')}</tr>${masks.map((m, i) => `<tr><th>${label(m)}</th>${iou[i].map((v, j) => (i === j ? '<td>-</td>' : cell(v))).join('')}</tr>`).join('')}</table>
<script>const M = ${JSON.stringify(masks.map((m) => ({ w: m.w, h: m.h, mask: m.mask })))}
M.forEach((m, i) => { const g = document.getElementById('c' + i).getContext('2d'); const img = g.createImageData(m.w, m.h)
  for (let k = 0; k < m.w * m.h; k++) { const v = m.mask[k] === '1' ? 0 : 255; img.data.set([v, v, v, 255], k * 4) } g.putImageData(img, 0, 0) })</script></body></html>`
writeFileSync(join(out, 'silhouettes.html'), html)
const hp = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await hp.goto(`file://${join(out, 'silhouettes.html')}`)
await hp.screenshot({ path: join(shots, 'silhouettes.jpg'), type: 'jpeg', quality: 88, fullPage: true })

// The lineup sheet: every close view, descriptions across, arms down.
const s = (ms) => (ms == null ? '' : (ms / 1000).toFixed(1))
const tile = (id, rs = results, dir = shots) => {
  const r = rs[id]
  if (!r || !(r.repair ?? r.first).check.ok) return '<div class="cell"><div class="fail">no usable result</div></div>'
  const c = r.capture ?? {}
  return `<div class="cell"><img src="file://${join(dir, `${id}-close.jpg`)}"><p><b>${c.name ?? ''}</b> &middot; ${id}<br>${s(r.first.wallMs + (r.repair?.wallMs ?? 0))} s &middot; ${r.repair ? 'repaired' : 'first try'} &middot; ${c.triangles ?? ''} tris &middot; ${c.drawCalls ?? ''} draws</p></div>`
}
const DESC = Object.fromEntries(ids.map((id) => [String(results[id].n), results[id].description]))
const earlier = compare.map((dir) => ({ dir: resolve(dir), rs: JSON.parse(readFileSync(join(resolve(dir), 'results.json'), 'utf8')) }))
const rowLabel = (k, fallback) => labels?.[k] ?? fallback
const sheetRows = [
  ...earlier.map(({ dir, rs }, k) => [rowLabel(k, `Round ${k + 1} code`), (n) => tile(idOf(rs, 'code', n), rs, join(dir, 'shots'))]),
  ...ARMS.map((arm, k) => [earlier.length ? rowLabel(earlier.length + k, `Round ${earlier.length + 1} ${arm}`) : arm === 'spec' ? 'Spec (JSON)' : 'Code (sandbox)', (n) => tile(idOf(results, arm, n))]),
]
const sheet = `<html><head><style>
  body { margin: 0; padding: 20px; background: #f4ece0; font: 14px/1.3 Georgia, serif; color: #3a2a1e; width: 2060px }
  .grid { display: grid; grid-template-columns: 90px repeat(5, 390px); gap: 10px; align-items: start } .cell { background: #fffaf2; padding: 6px; border-radius: 8px }
  img { width: 378px; display: block; border-radius: 4px } p { margin: 4px 0 0; font-size: 13px } .h { font-style: italic; font-size: 13px } .arm { font-weight: bold; padding-top: 90px }
  .fail { width: 378px; height: 236px; display: grid; place-items: center; background: #e8d9c6 }
</style></head><body><div class="grid"><div></div>${NS.map((n) => `<div class="h">${n}. ${DESC[n] ?? ''}</div>`).join('')}
${sheetRows.map(([label, cell]) => `<div class="arm">${label}</div>${NS.map(cell).join('')}`).join('\n')}</div></body></html>`
writeFileSync(join(out, 'lineup.html'), sheet)
await hp.setViewportSize({ width: 2100, height: 800 })
await hp.goto(`file://${join(out, 'lineup.html')}`)
await hp.screenshot({ path: join(shots, 'lineup-sheet.jpg'), type: 'jpeg', quality: 86, fullPage: true })
await hp.close()

// results.md
const lines = ['| # | Description | Arm | Name | Latency s | API s | First try | Out tokens | Cost $ | Triangles | Draw calls | Build ms | Fixes | Max IoU | Why repaired |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
for (const n of NS) for (const arm of ARMS) {
  const r = results[idOf(results, arm, n)]
  if (!r) continue
  const c = r.capture ?? {}
  const latency = r.first.wallMs + (r.repair?.wallMs ?? 0)
  const api = (r.first.apiMs ?? 0) + (r.repair?.apiMs ?? 0)
  const tokens = (r.first.outputTokens ?? 0) + (r.repair?.outputTokens ?? 0)
  const cost = (r.first.costUsd ?? 0) + (r.repair?.costUsd ?? 0)
  const first = r.first.check.ok ? 'yes' : r.repair?.check.ok ? 'no, repaired' : 'no, failed'
  lines.push(`| ${n} | ${r.description} | ${arm} | ${c.name ?? ''} | ${s(latency)} | ${s(api)} | ${first} | ${tokens} | ${cost.toFixed(3)} | ${c.triangles ?? ''} | ${c.drawCalls ?? ''} | ${c.buildMs == null ? '' : Math.round(c.buildMs)} | ${c.fixes?.length ?? ''} | ${r.maxIoU == null ? '' : r.maxIoU.toFixed(2)} | ${r.first.check.ok ? '' : String(r.first.check.error).replace(/\|/g, '/').slice(0, 160)} |`)
}
const median = (xs) => { const a = [...xs].sort((p, q) => p - q); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN }
lines.push('', '| Arm | Median latency s | Median API s | First try | Total cost $ | Median triangles | Median build ms |', '| --- | --- | --- | --- | --- | --- | --- |')
for (const arm of ARMS) {
  const rs = ids.filter((id) => results[id].arm === arm).map((id) => results[id])
  lines.push(`| ${arm} | ${s(median(rs.map((r) => r.first.wallMs + (r.repair?.wallMs ?? 0))))} | ${s(median(rs.map((r) => (r.first.apiMs ?? 0) + (r.repair?.apiMs ?? 0))))} | ${rs.filter((r) => r.first.check.ok).length} of ${rs.length} | ${rs.reduce((t, r) => t + (r.first.costUsd ?? 0) + (r.repair?.costUsd ?? 0), 0).toFixed(3)} | ${median(rs.map((r) => r.capture?.triangles ?? NaN).filter(Number.isFinite))} | ${Math.round(median(rs.map((r) => r.capture?.buildMs ?? NaN).filter(Number.isFinite)))} |`)
}
lines.push('', `Baseline frame (no villagers, ?cam=iso&q=high): ${baseline.render.drawCalls} draw calls, ${baseline.render.triangles} triangles.`, '', 'Most confusable silhouettes (IoU):', '', ...pairs.slice(0, 8).map((p) => `- ${p.a} / ${p.b}: ${p.iou.toFixed(2)}`))
writeFileSync(join(out, 'results.md'), lines.join('\n') + '\n')
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1))
await browser.close()
console.log(lines.join('\n'))
