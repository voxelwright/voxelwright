// #47 round 7: the round-7 mark measures (board and brim width over the head, face margin, place, owner px) on saved
// results, to calibrate the checks against an earlier round. Usage: node scripts/villagers/measure-marks.mjs <prefix> [base-url]
// (dev server running). The trusted felt kit makes the mark by default; --no-kit measures the model's own; the sewn skin is on, --no-skin leaves it off. Reads home/generated/villagers/<prefix>*/; prints one row per villager, from the file the run kept (the repair when there was one).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../generated/villagers')
const prefix = process.argv[2] ?? 'r6-'
const base = process.argv[3]?.startsWith('http') ? process.argv[3] : 'http://localhost:5332/'
/** The trusted felt kit (gen/kit.ts) makes the face and the mark; --no-kit measures the model's own. */
const kit = !process.argv.includes('--no-kit')
/** The sewn skin and hats around the ears (gen/skin.ts) by default; --no-skin for round 8's separate parts. */
const skin = !process.argv.includes('--no-skin')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  await page.goto(`${base}?plugins=renderer,camera&q=low&villager=gen&gen=none`)
  await page.waitForFunction(() => window.villagerGen, null, { timeout: 30000 })
  for (const id of readdirSync(dir).filter((d) => d.startsWith(prefix)).sort()) {
    const meta = JSON.parse(readFileSync(join(dir, id, 'meta.json'), 'utf8'))
    const code = readFileSync(join(dir, id, meta.file ?? 'villager.code.txt'), 'utf8')
    const r = await page.evaluate(([c, o]) => window.villagerGen.trial(c, o), [code, { mark: true, species: true, accent: meta.accent, kit, role: meta.role, skin }])
    console.log(JSON.stringify({ id, role: meta.role, fixes: r.fixes?.filter((f) => /^(role|kit: held|kit: hat)/.test(f)), ok: r.ok, loose: r.measures?.loose?.length, mark: r.measures?.mark, place: r.measures?.place, faceMargin: r.measures?.faceMargin, eyeRays: r.measures?.eyeRays, ownerPx: r.measures?.ownerPx, reason: r.ok ? undefined : r.reason.slice(0, 300) }))
  }
} finally {
  await browser.close()
}
