// Pictures of what a model made (#118): takes test/make-lab.mjs's answers, stands each model's
// things along a street of their own, photographs every one, and lays the pictures out as one
// sheet: a row for each sentence, a column for each model. No model is called.
// Usage: node test/gallery.ts <lab.json> <out-dir>
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Vec3 } from '../../home/src/engine/core.ts'
import type { ToySpec } from '../../home/src/engine/toy.ts'
import { heightAt } from '../src/ground.ts'
import { browser, sleep, startPage, startWorld, stop } from './lib.ts'

const [lab, out] = process.argv.slice(2)
if (!lab || !out) throw new Error('Usage: node test/gallery.ts <lab.json> <out-dir>')
interface Row { model: string; text: string; seconds: number; ok: boolean; pieces?: number; reason?: string; toy?: ToySpec | null }
const rows = JSON.parse(readFileSync(lab, 'utf8')) as Row[]
const models = [...new Set(rows.map((r) => r.model))], sentences = [...new Set(rows.map((r) => r.text))]
mkdirSync(out, { recursive: true })
const WT = 5233, PAGE = 5388
// The tilt and roll of a frame turned half round, flat on the street (src/make.ts flatOn(Math.PI)).
const GRADE = Math.atan(0.14), FLAT = { tilt: -GRADE, roll: 0 }
/** How far a toy reaches from its frame's origin, to stand the camera off by. */
const reach = (toy: ToySpec) => Math.max(1, ...toy.parts.flatMap((p) => (p.pieces ?? [{ at: [0, 0, 0] as Vec3, shape: p.shape }]).map((piece) => {
  const s = piece.shape, size = s.kind === 'box' ? Math.hypot(...s.half) : s.kind === 'sphere' ? s.radius : s.kind === 'compound' ? 1 : Math.hypot(s.radius, s.halfHeight + s.radius)
  return Math.hypot(p.at[0] + piece.at[0], p.at[1] + piece.at[1], p.at[2] + piece.at[2]) + size
})))

const vite = await startPage(PAGE, WT)
const chrome = await browser()
/** Where along the street a thing is stood for its picture (world z): six metres apart, none over the trench. */
const PLACES = [-25, -19, -13, -7, -1, 13, 19, 25]
const shots: Record<string, string> = {}
try {
  for (const model of models) {
    const dir = mkdtempSync(join(tmpdir(), 'street-gallery-'))
    mkdirSync(join(dir, 'made'))
    const stood: { row: Row; at: Vec3; reach: number }[] = []
    rows.filter((r) => r.model === model && r.toy).forEach((row, i) => {
      // Two files down the roadway, clear of the trees and of the trench, each facing up the hill to where its asker would stand.
      const x = i % 2 ? 2.4 : -2.4, z = PLACES[Math.floor(i / 2) % PLACES.length]
      const at: Vec3 = [x, heightAt(z) + 0.03, z]
      const toy: ToySpec = { ...row.toy!, id: `made-${i + 1}`, frame: { at, yaw: Math.PI, ...FLAT } }
      writeFileSync(join(dir, 'made', `${toy.id}.json`), JSON.stringify({ toy, text: row.text, by: model, at: new Date().toISOString() }))
      stood.push({ row, at, reach: reach(toy) })
    })
    const world = await startWorld(WT, '--world', dir, '--crates', '0', '--balls', '0')
    try {
      const page = await chrome.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 })
      await page.goto(`http://localhost:${PAGE}/`)
      await page.waitForFunction('window.__street?.ready', undefined, { timeout: 20_000 })
      await page.addStyleTag({ content: '#ask, #more, #workshop, .bubble { display: none !important }' })
      await sleep(2500)
      for (const { row, at, reach: r } of stood) {
        const d = Math.max(3.2, r * 1.9)
        // From up the hill and towards the road's middle, so no tree or house front stands between.
        await page.evaluate(`window.__street.camera(${JSON.stringify([at[0] - Math.sign(at[0]) * d * 0.5, at[1] + d * 0.45 + 0.6, at[2] - d * 0.85])}, ${JSON.stringify([at[0], at[1] + Math.min(1.2, r * 0.4), at[2]])})`)
        await sleep(350)
        const file = join(out, `${model.replace(/\W+/g, '-')}-${sentences.indexOf(row.text)}.png`)
        await page.screenshot({ path: file })
        shots[`${model}|${row.text}`] = file
      }
      await page.close()
    } finally { await stop(world); rmSync(dir, { recursive: true, force: true }) }
  }
  // The sheet.
  const cell = (model: string, text: string) => {
    const row = rows.find((r) => r.model === model && r.text === text), shot = shots[`${model}|${text}`]
    return `<td>${shot ? `<img src="file://${shot}">` : `<div class="none">${row?.reason ?? 'no answer'}</div>`}<small>${row ? `${row.seconds} s${row.pieces ? ` · ${row.pieces} pieces` : ''}` : ''}</small></td>`
  }
  const html = `<meta charset="utf-8"><style>body{margin:16px;font:14px ui-rounded,system-ui,sans-serif;color:#1d2733;background:#f4f1ea}table{border-collapse:collapse}td,th{padding:6px;vertical-align:top;text-align:left}img{width:320px;display:block;border-radius:8px}th.s{max-width:150px;font-weight:600}small{color:#5b6673}.none{width:320px;height:240px;border-radius:8px;background:#e6e0d4;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}</style>
<table><tr><th></th>${models.map((m) => `<th>${m}</th>`).join('')}</tr>${sentences.map((text) => `<tr><th class="s">${text}</th>${models.map((m) => cell(m, text)).join('')}</tr>`).join('')}</table>`
  writeFileSync(join(out, 'sheet.html'), html)
  const sheet = await chrome.newPage({ viewport: { width: 200 + models.length * 340, height: 800 } })
  await sheet.goto(`file://${join(out, 'sheet.html')}`)
  await sheet.screenshot({ path: join(out, 'sheet.png'), fullPage: true })
  console.log(join(out, 'sheet.png'))
} finally {
  await chrome.close()
  vite.kill()
}
