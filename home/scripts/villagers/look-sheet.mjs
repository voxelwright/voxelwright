// #47 look regroup: one sheet with the hard cases across strategies, each cell the dollhouse tile
// (native size, from readability.mjs) beside the close view (readability.mjs --close=...).
// Usage: node scripts/villagers/look-sheet.mjs <out.jpg> <label>=<out-dir>:<id-prefix> ... [--cases=15,05,18]
// e.g. round4=/tmp/look-r4:r4- a=/tmp/look-a:ga- b=/tmp/look-b:gb- c=/tmp/look-c:gc-
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const out = resolve(args[0])
const cases = args.find((a) => a.startsWith('--cases='))?.slice(8).split(',') ?? ['15', '05', '18']
const columns = args.slice(1).filter((a) => !a.startsWith('--')).map((a) => {
  const [label, rest] = a.split('=')
  const [dir, prefix] = rest.split(':')
  return { label, dir: resolve(dir), prefix, results: JSON.parse(readFileSync(join(resolve(dir), 'results.json'), 'utf8')) }
})
const cell = ({ dir, prefix, results }, n) => {
  const id = `${prefix}${n}`
  const tile = join(dir, 'shots', `${id}-tile.png`), near = join(dir, 'shots', `${id}-close.jpg`)
  if (!existsSync(tile)) return '<div class="cell miss">no usable result</div>'
  const r = results[id]
  return `<div class="cell"><img class="t" src="file://${tile}"><img class="c" src="file://${near}"><p>${id} &middot; ${r.owner} ${r.accent}${r.repair ? ' &middot; repaired' : ''}</p></div>`
}
const desc = (n) => Object.values(columns[0].results).find((r) => r.id === `${columns[0].prefix}${n}`)?.description ?? n
const html = `<html><head><style>
  body { margin: 0; padding: 16px; background: #f4ece0; font: 14px/1.3 Georgia, serif; color: #3a2a1e }
  .g { display: grid; grid-template-columns: 120px repeat(${columns.length}, 470px); gap: 10px; align-items: start }
  .cell { background: #fffaf2; padding: 6px; border-radius: 8px } .t { width: 150px; height: 150px; vertical-align: top } .c { width: 300px; vertical-align: top; margin-left: 6px }
  p { margin: 4px 0 0; font-size: 12px } .h { font-weight: bold; text-align: center } .d { font-style: italic; font-size: 13px; padding-top: 50px } .miss { height: 150px; display: grid; place-items: center }
</style></head><body><div class="g"><div></div>${columns.map((c) => `<div class="h">${c.label}</div>`).join('')}
${cases.map((n) => `<div class="d">${desc(n)}</div>${columns.map((c) => cell(c, n)).join('')}`).join('\n')}</div></body></html>`
const htmlPath = out.replace(/\.jpg$/, '.html')
writeFileSync(htmlPath, html)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 160 + columns.length * 480, height: 600 } })
await page.goto(`file://${htmlPath}`)
await page.screenshot({ path: out, type: 'jpeg', quality: 88, fullPage: true })
await browser.close()
