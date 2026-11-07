// Renders the six synthetic plans to out/plans/<id>.png with <id>.truth.json beside them.
// Usage: node scripts/plan-import/render.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLANS } from './plans.mjs'
import { openDrawPage } from './browser.mjs'

const out = join(dirname(fileURLToPath(import.meta.url)), 'out', 'plans')
await mkdir(out, { recursive: true })
const { browser, page, png } = await openDrawPage()
for (const [id, hint] of Object.entries(PLANS)) {
  const view = await page.evaluate((h) => window.draw.drawSource(document.getElementById('c'), h), hint)
  await writeFile(join(out, `${id}.png`), await png())
  await writeFile(join(out, `${id}.truth.json`), JSON.stringify({ plan: hint.plan, view }, null, 1))
  console.log(id, `${view.width}x${view.height}`, `${hint.plan.walls.length} walls`)
}
await browser.close()
