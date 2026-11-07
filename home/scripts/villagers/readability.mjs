// #47 round 2: can you read a villager's role and owner from across the room? For every usable
// result in <out>/results.json (run.mjs --set readability):
// - a colour tile cropped from ?cam=iso at native size (dollhouse distance, nothing scaled), as one sheet;
// - flat-black silhouettes from the dollhouse heading, pairwise IoU, and role readability: is each
//   villager's closest silhouette one of the same role? Within-role against between-role mean IoU;
// - the owner's accent: the same render with accent parts red, counting the accent pixels that show;
// - a blind sheet for model scorers (black, numbered in a shuffled order, no labels) and its key.
// - round 3, species: mean pairwise IoU over all villagers (lower is more varied), and how many are the
//   default round template by gen/checks.ts speciesFeatures (no feature at or over SPECIES).
// Usage: node scripts/villagers/readability.mjs <out-dir> [base-url] [--checks=off] [--seed=47]   (dev server running)
// --checks=off places villagers the checks would refuse, to measure an earlier round with today's checks.
// --seed shuffles the blind sheet's numbering (47 gave round 3's order; round 4 used 48).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const out = resolve(process.argv[2])
const base = process.argv[3]?.startsWith('http') ? process.argv[3] : 'http://localhost:5332/'
const checksOff = process.argv.includes('--checks=off')
const seedArg = Number(process.argv.find((a) => a.startsWith('--seed='))?.slice(7) ?? 47)
const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
const shots = join(out, 'shots')
mkdirSync(shots, { recursive: true })
const ids = Object.keys(results).sort().filter((id) => (results[id].repair ?? results[id].first).check.ok)
const failed = Object.keys(results).filter((id) => !ids.includes(id))
/** Silhouette render size: 128 px framing 1.4 m (about 91 px a metre), close to ?cam=iso at 1280x800. */
const SIZE = 128
/** Colour tiles: a fixed square of the iso frame around each villager, CSS px, not scaled. */
const TILE = 150

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`${base}?cam=iso&q=high&villager=gen&${query}${checksOff ? '&checks=off' : ''}`)
  await page.waitForFunction(() => window.village && window.villagerGen, null, { timeout: 30000 })
  await page.evaluate(() => window.village.ready())
  await page.evaluate(() => window.villagerGen.loaded)
  await page.waitForTimeout(3000)
  return page
}

// Colour tiles: each villager alone at the lineup spot in the dollhouse view.
const screenH = {}
let next = 0
await Promise.all([0, 1].map(async () => {
  while (next < ids.length) {
    const id = ids[next++]
    const page = await open(`gen=${id}&lineup=1`)
    const [b] = await page.evaluate(() => window.villagerGen.screen())
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
    screenH[id] = Math.round(b.y1 - b.y0)
    await page.screenshot({ path: join(shots, `${id}-tile.png`), clip: { x: Math.round(cx - TILE / 2), y: Math.round(cy - TILE / 2), width: TILE, height: TILE } })
    await page.close()
  }
}))

// Silhouettes and accent masks, every villager alone at the origin.
const page = await open(`gen=${ids.join(',')}&lineup=1`)
const black = await page.evaluate((s) => window.villagerGen.silhouettes(s), SIZE)
const accent = await page.evaluate((s) => window.villagerGen.silhouettes(s, true), SIZE)
const report = await page.evaluate(() => window.villagerGen.report)
const SPECIES = await page.evaluate(async () => (await import('/src/villagers/gen/checks.ts')).SPECIES)
await page.close()
/** The default round template: no species feature at or over its threshold. */
const isTemplate = (f) => !!f && !Object.keys(SPECIES).some((k) => f[k] >= SPECIES[k])

function aligned({ w, h, mask }) {
  let x0 = w, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] !== '0') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const cx = (x0 + x1) / 2
  const set = new Set()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] !== '0') set.add(`${Math.round(x - cx)},${y - y1}`)
  return set
}
const sets = black.map(aligned)
const iou = sets.map((a, i) => sets.map((b, j) => {
  if (i === j) return 1
  let inter = 0
  for (const p of a) if (b.has(p)) inter++
  return inter / (a.size + b.size - inter)
}))
const role = (i) => results[black[i].id].role
const rows = black.map((m, i) => {
  const others = iou[i].map((v, j) => ({ j, v })).filter(({ j }) => j !== i).sort((p, q) => q.v - p.v)
  const nearest = others[0]
  const a = accent[i].mask
  const accentPx = [...a].filter((c) => c === '2').length
  const figurePx = [...a].filter((c) => c !== '0').length
  const r = results[m.id]
  return {
    id: m.id, name: m.name, role: r.role, declaredRole: report[m.id]?.role ?? null, owner: r.owner, accent: r.accent, description: r.description,
    nearest: black[nearest.j].id, nearestRole: role(nearest.j), nearestIoU: +nearest.v.toFixed(3), sameRole: role(nearest.j) === r.role,
    accentPx, figurePx, accentShare: +(accentPx / figurePx).toFixed(3), screenH: screenH[m.id],
    species: report[m.id]?.measures?.species ?? null, template: isTemplate(report[m.id]?.measures?.species),
  }
})
const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length
const within = [], between = []
for (let i = 0; i < black.length; i++) for (let j = i + 1; j < black.length; j++) (role(i) === role(j) ? within : between).push(iou[i][j])
const summary = {
  villagers: rows.length, failed,
  roleReadability: +(rows.filter((r) => r.sameRole).length / rows.length).toFixed(3),
  chance: +mean(rows.map((r) => (rows.filter((o) => o.role === r.role).length - 1) / (rows.length - 1))).toFixed(3),
  withinRoleIoU: +mean(within).toFixed(3), betweenRoleIoU: +mean(between).toFixed(3),
  meanIoU: +mean([...within, ...between]).toFixed(3), roundTemplate: rows.filter((r) => r.template).length,
  declaredRoleAgrees: rows.filter((r) => r.declaredRole === r.role).length,
  minAccentPx: Math.min(...rows.map((r) => r.accentPx)), medianAccentPx: rows.map((r) => r.accentPx).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  minAccentShare: Math.min(...rows.map((r) => r.accentShare)),
  medianScreenH: Object.values(screenH).sort((a, b) => a - b)[Math.floor(ids.length / 2)],
}
writeFileSync(join(out, 'readability.json'), JSON.stringify({ summary, rows, ids: black.map((m) => m.id), iou }, null, 1))

// Sheets. The blind one is shuffled with a fixed seed so the numbering does not give the roles away.
let seed = seedArg
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const order = black.map((_, i) => [i, rand()]).sort((a, b) => a[1] - b[1]).map(([i]) => i)
const key = order.map((i, k) => ({ number: k + 1, id: black[i].id, role: rows[i].role, owner: rows[i].owner, description: rows[i].description }))
writeFileSync(join(out, 'readability-key.json'), JSON.stringify(key, null, 1))
writeFileSync(join(out, 'readability-key.md'), ['| # | id | role | owner | description |', '| --- | --- | --- | --- | --- |', ...key.map((k) => `| ${k.number} | ${k.id} | ${k.role} | ${k.owner} | ${k.description} |`)].join('\n') + '\n')
const canvas = (list, colour) => `<script>const M = ${JSON.stringify(list.map((m) => ({ w: m.w, h: m.h, mask: m.mask })))}
M.forEach((m, i) => { const g = document.getElementById('c' + i).getContext('2d'); const img = g.createImageData(m.w, m.h)
  for (let k = 0; k < m.w * m.h; k++) img.data.set(${colour}[m.mask[k]], k * 4); g.putImageData(img, 0, 0) })</script>`
const page2 = await browser.newPage({ viewport: { width: 1000, height: 800 } })
async function sheet(file, html, width) {
  const path = join(out, file.replace(/\.jpg$/, '.html'))
  writeFileSync(path, html)
  await page2.setViewportSize({ width, height: 800 })
  await page2.goto(`file://${path}`)
  await page2.screenshot({ path: join(shots, file), type: 'jpeg', quality: 90, fullPage: true })
}
const css = 'body { margin: 0; padding: 16px; background: #fff; font: 14px/1.2 Georgia, serif; color: #222 } .g { display: grid; grid-template-columns: repeat(5, auto); gap: 14px 18px; justify-content: start } .c { text-align: center } canvas { display: block }'
await sheet('readability-silhouettes.jpg', `<html><head><style>${css}</style></head><body><div class="g">${order.map((i, k) => `<div class="c"><canvas id="c${k}" width="${SIZE}" height="${SIZE}"></canvas>${k + 1}</div>`).join('')}</div>
${canvas(order.map((i) => black[i]), "({ '0': [255, 255, 255, 255], '1': [0, 0, 0, 255], '2': [0, 0, 0, 255] })")}</body></html>`, 5 * (SIZE + 18) + 40)
await sheet('readability-accent.jpg', `<html><head><style>${css}</style></head><body><div class="g">${order.map((i, k) => `<div class="c"><canvas id="c${k}" width="${SIZE}" height="${SIZE}"></canvas>${k + 1} &middot; ${rows[i].accentPx} px</div>`).join('')}</div>
${canvas(order.map((i) => accent[i]), "({ '0': [255, 255, 255, 255], '1': [40, 40, 40, 255], '2': [255, 0, 0, 255] })")}</body></html>`, 5 * (SIZE + 18) + 40)
await sheet('readability-colour.jpg', `<html><head><style>${css} img { display: block; width: ${TILE}px; height: ${TILE}px }</style></head><body><div class="g">${order.map((i, k) => `<div class="c"><img src="file://${join(shots, `${black[i].id}-tile.png`)}">${k + 1}</div>`).join('')}</div></body></html>`, 5 * (TILE + 18) + 40)
await browser.close()

const md = [
  `# Readability, ${rows.length} generated villagers${failed.length ? ` (${failed.length} failed: ${failed.join(', ')})` : ''}`, '',
  `Silhouettes: ${SIZE} px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about ${summary.medianScreenH} px tall.`, '',
  `- Role readability (nearest silhouette has the same role): ${(summary.roleReadability * 100).toFixed(0)}% (chance about ${(summary.chance * 100).toFixed(0)}%)`,
  `- Mean IoU within a role ${summary.withinRoleIoU}, between roles ${summary.betweenRoleIoU}`,
  `- Species: mean pairwise IoU ${summary.meanIoU} (lower is more varied); ${summary.roundTemplate} of ${rows.length} are the default round template`,
  `- Model declared the requested role: ${summary.declaredRoleAgrees} of ${rows.length}`,
  `- Visible accent: min ${summary.minAccentPx} px, median ${summary.medianAccentPx} px of the ${SIZE} px render; min share of the figure ${(summary.minAccentShare * 100).toFixed(1)}%`, '',
  '| id | name | role | nearest | its role | IoU | accent px | accent share | owner | round template | species features |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.id} | ${r.name} | ${r.role} | ${r.nearest} | ${r.nearestRole} | ${r.nearestIoU.toFixed(2)} | ${r.accentPx} | ${(r.accentShare * 100).toFixed(1)}% | ${r.owner} | ${r.template ? 'yes' : ''} | ${r.species ? Object.entries(r.species).map(([k, v]) => `${k} ${v}`).join(', ') : ''} |`),
].join('\n')
writeFileSync(join(out, 'readability.md'), md + '\n')
console.log(md)
