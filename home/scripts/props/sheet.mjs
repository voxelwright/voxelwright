// #42 experiment: one comparison sheet per prompt (arm x model, close and iso
// captures, numbers and scores) and a markdown table of every result.
// Usage: node scripts/props/sheet.mjs <out-dir>
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const out = resolve(process.argv[2])
const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
const PROMPTS = { 1: 'a round dining table in light oak for four', 2: 'two slatted pine chairs to go with it', 3: 'a cozy reading armchair in green velvet with a small side table', 4: 'striped wallpaper in warm cream and sage for the back wall', 5: 'a small tabletop pinball machine' }
const ARMS = { a: 'A free code', b: 'B JSON spec' }
const s = (ms) => (ms == null ? '' : (ms / 1000).toFixed(1))

function row(r) {
  const usable = r.repair ? r.repair.check.ok : r.first.check.ok
  const latency = r.first.wallMs + (r.repair?.wallMs ?? 0)
  return {
    first: r.first.check.ok ? 'yes' : 'no',
    repair: r.repair ? `${s(r.repair.wallMs)} s, ${r.repair.check.ok ? 'fixed' : 'still failing'}` : '',
    usable,
    latency: s(latency),
    tokens: (r.first.outputTokens ?? 0) + (r.repair?.outputTokens ?? 0),
    cost: (r.first.costUsd ?? 0) + (r.repair?.costUsd ?? 0),
    tris: r.capture?.triangles ?? '',
    draws: r.capture?.drawCalls ?? '',
    belongs: r.score?.belongs ?? '',
    asked: r.score?.asked ?? '',
    reason: r.score?.reason ?? (usable ? '' : (r.repair ?? r.first).check.error ?? ''),
  }
}

const lines = ['| Prompt | Arm | Model | Latency s | First try | Repair | Out tokens | Triangles | Draw calls | Belongs | Asked |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
let genCost = 0
for (const p of [1, 2, 3, 4, 5]) for (const arm of ['b', 'a']) for (const model of ['haiku', 'sonnet', 'opus']) {
  const r = results[`${arm}-${model}-p${p}`]
  if (!r) continue
  const x = row(r)
  genCost += x.cost
  lines.push(`| ${p} | ${arm.toUpperCase()} | ${model} | ${x.latency} | ${x.first} | ${x.repair} | ${x.tokens} | ${x.tris} | ${x.draws} | ${x.belongs} | ${x.asked} |`)
}
const scoreCost = Object.values(results).reduce((n, r) => n + (r.score?.costUsd ?? 0), 0)
lines.push('', `Generation cost (claude -p total_cost_usd): $${genCost.toFixed(2)}; scoring: $${scoreCost.toFixed(2)}`)
writeFileSync(join(out, 'results.md'), lines.join('\n') + '\n')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
for (const p of [1, 2, 3, 4, 5]) {
  const cells = []
  for (const arm of ['b', 'a']) for (const model of ['haiku', 'sonnet', 'opus']) {
    const id = `${arm}-${model}-p${p}`
    const r = results[id]
    if (!r) continue
    const x = row(r)
    const img = (k) => (x.usable ? `<img src="file://${join(out, 'shots', `${id}-${k}.jpg`)}">` : `<div class="fail">${k === 'close' ? 'no usable result' : ''}</div>`)
    cells.push(`<div class="cell"><h2>${ARMS[arm]} &middot; ${model}</h2>${img('close')}${img('iso')}
      <p><b>${x.latency} s</b> &middot; first try ${x.first}${x.repair ? ` &middot; repair ${x.repair}` : ''} &middot; ${x.tris} tris &middot; ${x.draws} draws</p>
      <p><b>belongs ${x.belongs} &middot; asked ${x.asked}</b> &mdash; ${String(x.reason).replace(/</g, '&lt;').slice(0, 260)}</p></div>`)
  }
  const html = `<html><head><style>
    body { margin: 0; padding: 24px; background: #f4ece0; font: 15px/1.35 Georgia, serif; color: #3a2a1e; width: 1872px }
    h1 { margin: 0 0 16px; font-size: 26px } .grid { display: grid; grid-template-columns: repeat(3, 600px); gap: 18px }
    .cell { background: #fffaf2; padding: 10px; border-radius: 8px } h2 { margin: 0 0 6px; font-size: 18px }
    img { width: 580px; display: block; margin-bottom: 4px; border-radius: 4px } img + img { width: 290px }
    .fail { width: 580px; height: 120px; display: grid; place-items: center; background: #e8d9c6; color: #7a4a32 } p { margin: 4px 0 }
  </style></head><body><h1>Prompt ${p}: “${PROMPTS[p]}” — rows: arm B (spec), arm A (code)</h1><div class="grid">${cells.join('')}</div></body></html>`
  const file = join(out, `sheet-p${p}.html`)
  writeFileSync(file, html)
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } })
  await page.goto(`file://${file}`)
  await page.screenshot({ path: join(out, `sheet-p${p}.jpg`), type: 'jpeg', quality: 82, fullPage: true })
  await page.close()
}
await browser.close()
console.log(lines.join('\n'))
