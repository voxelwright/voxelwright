// The street from fixed cameras (#118), to compare one look with the next: the top of the street,
// the trench with made things and two residents, a resident close up, and a phone's width.
// The made things are a model's answers from test/make-lab.mjs, stood at fixed spots; no model
// is called. Usage: node test/shots.ts <lab.json> <out-dir> [query, e.g. "q=low"]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Vec3 } from '../../home/src/engine/core.ts'
import type { ToySpec } from '../../home/src/engine/toy.ts'
import { TRENCH, heightAt, planeAt } from '../src/ground.ts'
import { browser, sleep, startPage, startWorld } from './lib.ts'

const [lab, out, query = ''] = process.argv.slice(2)
if (!lab || !out) throw new Error('Usage: node test/shots.ts <lab.json> <out-dir> [query]')
mkdirSync(out, { recursive: true })
const rows = JSON.parse(readFileSync(lab, 'utf8')) as { model: string; text: string; toy?: ToySpec | null }[]
const WT = 5633, PAGE = 5428
const GRADE = Math.atan(0.14), LEN = Math.hypot(1, 0.14)
/** What stands where: a sentence from the lab (the first model that made it), across and along the street, and its turn. */
const SET: [string, number, number, number][] = [
  ['a plank bridge to cross a gap six metres wide', 0, (TRENCH.from + TRENCH.to) / 2, Math.PI],
  ['a big red dog', 3.2, 0.5, Math.PI], ['a small car', -4.5, -4, Math.PI], ['a park bench', 5.5, -9, Math.PI / 2],
  ['a comically large rubber duck', -3.5, 15, Math.PI], ['stairs up to a platform one and a half metres high', 4.5, 16, Math.PI], ['a ladder', -5.5, 1.5, Math.PI],
]
const dir = mkdtempSync(join(tmpdir(), 'street-shots-'))
mkdirSync(join(dir, 'made'))
SET.forEach(([text, across, along, yaw], i) => {
  const row = rows.find((r) => r.text === text && r.toy && r.model.startsWith('sonnet')) ?? rows.find((r) => r.text === text && r.toy)
  if (!row?.toy) return
  const z = along / LEN, c = Math.cos(-yaw), s = Math.sin(-yaw), n = [0, Math.cos(GRADE), Math.sin(GRADE)]
  const frame = { at: [across, planeAt(z) + 0.03, z] as Vec3, yaw, tilt: Math.atan2(-s * n[0] + c * n[2], n[1]), roll: -Math.asin(c * n[0] + s * n[2]) }
  writeFileSync(join(dir, 'made', `made-${i + 1}.json`), JSON.stringify({ toy: { ...row.toy, id: `made-${i + 1}`, frame }, text, by: 'Pavlo', at: new Date().toISOString() }))
})
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--world', dir, '--crates', '48', '--balls', '10')
const chrome = await browser()
try {
  const open = async (name: string, width: number, height: number, scale = 1) => {
    const page = await chrome.newPage({ viewport: { width, height }, deviceScaleFactor: scale, hasTouch: width < 500, isMobile: width < 500 })
    const said: string[] = []
    page.on('pageerror', (e) => said.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) said.push(m.text().slice(0, 200)) })
    await page.goto(`http://localhost:${PAGE}/?name=${name}&${query}`)
    await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
    return { page, said, s: <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T> }
  }
  const a = await open('Pavlo', 1280, 720), b = await open('Juno', 640, 400)
  // What you see as you arrive, from the camera that follows you.
  await a.page.addStyleTag({ content: '#more { display: none !important }' })
  await sleep(1500)
  await a.page.screenshot({ path: join(out, 'arrive.png') })
  // Juno walks down to the trench's edge and stands there; Pavlo stays near the top.
  await b.s(`s.hold('KeyA', true)`); await sleep(700); await b.s(`s.hold('KeyA', false)`)
  await b.s(`s.hold('KeyW', true)`)
  for (const t0 = Date.now(); (await b.s<number[]>('s.shownOf(s.you)'))[2] < (TRENCH.from - 2.5) / LEN && Date.now() - t0 < 12_000;) await sleep(40)
  await b.s(`s.hold('KeyW', false)`)
  await b.s(`s.say('Who made the duck?')`)
  await sleep(2500)
  const juno = await b.s<number[]>('s.shownOf(s.you)')
  const cam = async (file: string, from: Vec3, to: Vec3) => { await a.s(`s.camera(${JSON.stringify(from)}, ${JSON.stringify(to)})`); await sleep(900); await a.page.screenshot({ path: join(out, file) }) }
  await cam('top.png', [0.5, heightAt(-29 / LEN) + 3.2, -29 / LEN], [0, planeAt(-8) + 0.5, -8])
  await cam('trench.png', [-7, planeAt(-2) + 6, -5], [1, planeAt(6) + 0.3, 6.5])
  await cam('close.png', [juno[0] + 1.6, juno[1] + 0.7, juno[2] + 3.2], [juno[0], juno[1] + 0.25, juno[2]])
  await cam('below.png', [3, planeAt(24) + 2.2, 24], [0, planeAt(10) + 1, 10])
  const phone = await open('Mo', 390, 844, 2)
  await sleep(1500)
  await phone.page.screenshot({ path: join(out, 'phone.png') })
  const stats = await a.s<Record<string, unknown>>('s.stats()')
  console.log(JSON.stringify({ frameMs: stats.frameMs, gpuMs: stats.gpuMs, cpuMs: stats.cpuMs, quality: stats.quality, backend: stats.backend, errors: [...a.said, ...b.said, ...phone.said].slice(0, 6) }))
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  rmSync(dir, { recursive: true, force: true })
}
