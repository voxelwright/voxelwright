// Headless proof of the listening room (#52): /sound-lab.html loads with no errors, Start
// and a play button make sound at the master (tapped with an AudioWorklet, as in
// check-sound.mjs), a pick round-trips through POST and GET /sound-lab/picks into
// .sound-lab/picks.json, bad picks are refused, and every manifest video exists.
// Restores picks.json and history.jsonl as they were. Usage: node scripts/check-sound-lab.mjs [base-url]
// (dev server running, 5491 by default). Exits non-zero when a check fails.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5491/'
const lab = join(here, '../.sound-lab')
const keep = Object.fromEntries(['picks.json', 'history.jsonl'].map((f) => [f, existsSync(join(lab, f)) ? readFileSync(join(lab, f)) : null]))
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
try {
  await page.goto(`${base}sound-lab.html`)
  await page.click('#start')
  await page.waitForSelector('#lab:not([hidden]) section.cue')
  const layout = await page.evaluate(() => ({
    cues: [...document.querySelectorAll('section.cue')].map((s) => s.dataset.cue),
    overflow: document.documentElement.scrollWidth > innerWidth,
    smallest: Math.min(...[...document.querySelectorAll('section.cue button')].map((b) => b.getBoundingClientRect().height)),
  }))
  check('Every cue has a card, the six with variants first', layout.cues.length >= 25 && layout.cues.slice(0, 6).sort().join() === 'card,chose,news,page,placed,sent', layout.cues.slice(0, 7).join(' '))
  check('Phone width (390 px): no sideways scroll, tap targets at least 40 px', !layout.overflow && layout.smallest >= 40, `smallest button ${layout.smallest.toFixed(0)} px`)

  // Tap the master and play chose:b.
  await page.evaluate(async () => {
    const { audio, mix } = window.soundLab
    const code = `registerProcessor('lab-tap', class extends AudioWorkletProcessor { process(inputs) { let p = 0; for (const ch of inputs[0] ?? []) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i])); this.port.postMessage(p); return true } })`
    await audio.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
    const tap = new AudioWorkletNode(audio, 'lab-tap')
    mix.output.connect(tap).connect(new GainNode(audio, { gain: 0 })).connect(audio.destination)
    window.peak = 0
    tap.port.onmessage = (m) => (window.peak = Math.max(window.peak, m.data))
  })
  const quiet = await page.evaluate(() => new Promise((r) => setTimeout(() => r(window.peak), 300)))
  await page.click('section[data-cue="chose"] button.play[data-variant="b"]')
  await page.waitForTimeout(700)
  const loud = await page.evaluate(() => window.peak)
  check('Start, then Play B on "Choosing something" sounds at the master', quiet < 1e-5 && loud > 1e-3, `before ${quiet}, after ${(20 * Math.log10(loud)).toFixed(1)} dBFS, context ${await page.evaluate(() => window.soundLab.audio.state)}`)

  // A pick and a note round-trip through the server.
  await page.click('section[data-cue="sent"] .picks button[data-value="c"]')
  await page.click('section[data-cue="hover"] .picks button[data-value="change"]')
  await page.fill('section[data-cue="sent"] textarea', 'the run is lovely, a touch slower?')
  await page.click('#save')
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('saved'), null, { timeout: 5000 })
  const file = JSON.parse(readFileSync(join(lab, 'picks.json'), 'utf8'))
  const got = await page.evaluate(() => fetch('sound-lab/picks').then((r) => r.json()))
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem('village.sfx.picks')))
  check('A pick round-trips: POST writes picks.json, GET returns it, localStorage holds the variant only', file.picks.sent === 'c' && file.picks.hover === 'change' && got.notes.sent.startsWith('the run') && file.savedAt && local.sent === 'c' && !('hover' in local), JSON.stringify({ file: file.picks, local }))
  await page.reload()
  await page.click('#start')
  await page.waitForSelector('#lab:not([hidden]) section.cue')
  const restored = await page.evaluate(() => document.querySelector('section[data-cue="sent"] .picks button[data-value="c"]').getAttribute('aria-pressed') === 'true' && document.querySelector('section[data-cue="sent"] textarea').value.startsWith('the run'))
  check('After a reload the page shows the saved pick and note', restored)

  const post = (body, headers = {}) => page.evaluate(([body, headers]) => fetch('sound-lab/picks', { method: 'POST', headers, body }).then((r) => r.status), [body, headers])
  const refused = {
    unknownCue: await post(JSON.stringify({ picks: { nope: 'a' } })),
    unknownVariant: await post(JSON.stringify({ picks: { chose: 'z' } })),
    keepOnVariantCue: await post(JSON.stringify({ picks: { chose: 'keep' } })),
    longNote: await post(JSON.stringify({ notes: { chose: 'x'.repeat(2000) } })),
    notJson: await post('{'),
  }
  check('Bad picks are refused (422 or 400) and leave picks.json alone', Object.values(refused).every((s) => s === 422 || s === 400) && JSON.parse(readFileSync(join(lab, 'picks.json'), 'utf8')).picks.sent === 'c', JSON.stringify(refused))

  // The videos the page offers exist.
  const manifest = await page.evaluate(() => fetch('sound-lab/manifest.json').then((r) => (r.ok ? r.json() : null)))
  const videos = manifest ? manifest.clips.flatMap((c) => Object.values(c.videos)) : []
  const missing = []
  for (const v of videos) if (!(await page.evaluate((v) => fetch(v, { method: 'HEAD' }).then((r) => r.ok && r.headers.get('content-type')?.includes('mp4')), v))) missing.push(v)
  check('Every video in the manifest is served', manifest && videos.length > 0 && !missing.length, `${videos.length} videos; missing ${missing.join(', ') || 'none'}`)
  check('No page errors', !errors.length, errors.join(' | '))
} finally {
  await browser.close()
  for (const [f, data] of Object.entries(keep)) data ? writeFileSync(join(lab, f), data) : rmSync(join(lab, f), { force: true })
}
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`\n${checks.length - failed}/${checks.length} checks pass`)
process.exit(failed ? 1 : 0)
