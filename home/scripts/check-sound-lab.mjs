// Headless proof of the listening room (#52): /sound-lab.html loads with no errors, round 2's
// six cards come first and round 1's sit folded below, Start and a play button make sound at
// the master (tapped with an AudioWorklet, as in check-sound.mjs), picks in both rounds
// round-trip through POST and GET /sound-lab/picks into .sound-lab/picks.json, bad picks are
// refused, and every manifest video exists.
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
const skip = (name, detail) => checks.push({ name, pass: true, skipped: true, detail })

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()))
// Failed requests by URL; the deliberate bad POSTs below are not errors.
page.on('response', (r) => r.status() >= 400 && !(r.request().method() === 'POST' && r.url().endsWith('/sound-lab/picks')) && errors.push(`${r.status()} ${r.url()}`))
try {
  await page.goto(`${base}sound-lab.html`)
  await page.click('#start')
  await page.waitForSelector('#lab:not([hidden]) section.cue')
  const folded = await page.evaluate(() => ({
    round2: [...document.querySelectorAll('#cues > section.cue')].map((s) => s.dataset.cue),
    round1Open: document.querySelector('details.round1').open,
    news: [...document.querySelectorAll('section[data-cue="news"] button.play')].map((b) => b.dataset.variant).join(''),
    hoverPicks: [...document.querySelectorAll('section[data-cue="hover"] .picks button')].map((b) => b.dataset.value).join(','),
    before: document.querySelector('section[data-cue="farewell"] .before')?.textContent ?? '',
  }))
  check('Round 2 first: news, hover, farewell, turned, pad-up, pad-down, with their versions and what was said in round 1; round 1 folded below',
    folded.round2.join() === 'news,hover,farewell,turned,pad-up,pad-down' && !folded.round1Open && folded.news === 'ade' && folded.hoverPicks === 'a,d,e,f,none' && folded.before.includes('kalimba'), JSON.stringify(folded))
  await page.click('details.round1 > summary')
  const layout = await page.evaluate(() => ({
    cues: [...document.querySelectorAll('section.cue')].map((s) => s.dataset.cue),
    overflow: document.documentElement.scrollWidth > innerWidth,
    smallest: Math.min(...[...document.querySelectorAll('section.cue button, summary')].map((b) => b.getBoundingClientRect().height)),
  }))
  check('Every cue has exactly one card', layout.cues.length >= 25 && new Set(layout.cues).size === layout.cues.length, `${layout.cues.length} cards`)
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
  await page.click('section[data-cue="news"] button.play[data-variant="d"]')
  await page.waitForTimeout(700)
  const loud = await page.evaluate(() => window.peak)
  check('Start, then Play D on round 2\'s news card sounds at the master', quiet < 1e-5 && loud > 1e-3, `before ${quiet}, after ${(20 * Math.log10(loud)).toFixed(1)} dBFS, context ${await page.evaluate(() => window.soundLab.audio.state)}`)

  // Picks in both rounds and a note round-trip through the server.
  await page.click('section[data-cue="farewell"] .picks button[data-value="c"]')
  await page.click('section[data-cue="sent"] .picks button[data-value="c"]')
  await page.click('section[data-cue="walk"] .picks button[data-value="change"]')
  await page.fill('section[data-cue="farewell"] textarea', 'the steps are lovely, a touch slower?')
  await page.click('#save')
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('saved'), null, { timeout: 5000 })
  const file = JSON.parse(readFileSync(join(lab, 'picks.json'), 'utf8'))
  const got = await page.evaluate(() => fetch('sound-lab/picks').then((r) => r.json()))
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem('village.sfx.picks')))
  check('Picks round-trip: POST writes picks.json, GET returns it, localStorage holds variants only',
    file.picks.farewell === 'c' && file.picks.sent === 'c' && file.picks.walk === 'change' && got.notes.farewell.startsWith('the steps') && file.savedAt && local.farewell === 'c' && local.sent === 'c' && !('walk' in local),
    JSON.stringify({ file: file.picks, local }))
  await page.reload()
  await page.click('#start')
  await page.waitForSelector('#lab:not([hidden]) section.cue')
  const restored = await page.evaluate(() => {
    const pressed = (cue, v) => document.querySelector(`section[data-cue="${cue}"] .picks button[data-value="${v}"]`).getAttribute('aria-pressed') === 'true'
    return pressed('farewell', 'c') && pressed('sent', 'c') && pressed('walk', 'change') && document.querySelector('section[data-cue="farewell"] textarea').value.startsWith('the steps')
  })
  check('After a reload the page shows the saved picks (round 1 and 2) and note', restored)

  const post = (body, headers = { 'content-type': 'application/json' }) => page.evaluate(([body, headers]) => fetch('sound-lab/picks', { method: 'POST', headers, body }).then((r) => r.status), [body, headers])
  const refused = {
    unknownCue: await post(JSON.stringify({ picks: { nope: 'a' } })),
    unknownVariant: await post(JSON.stringify({ picks: { chose: 'z' } })),
    keepOnVariantCue: await post(JSON.stringify({ picks: { chose: 'keep' } })),
    changeOnRound2Cue: await post(JSON.stringify({ picks: { hover: 'change' } })),
    longNote: await post(JSON.stringify({ notes: { chose: 'x'.repeat(2000) } })),
    notJson: await post('{'),
    inherited: await post('{"picks":{"__proto__":"keep"},"notes":{"constructor":"x"}}'),
    empty: await post('{}'),
    array: await post('[]'),
    notJsonType: await post(JSON.stringify({ picks: { chose: 'a' } }), { 'content-type': 'text/plain' }),
  }
  check('Bad picks are refused (422, 400, or 415 for a non-JSON type) and leave picks.json alone', Object.entries(refused).every(([k, s]) => (k === 'notJsonType' ? s === 415 : s === 422 || s === 400)) && JSON.parse(readFileSync(join(lab, 'picks.json'), 'utf8')).picks.farewell === 'c', JSON.stringify(refused))

  // The videos the page offers exist. They live in public/sound-lab/ (gitignored, made
  // locally), so a fresh worktree has no manifest: then the check is skipped, not failed. The
  // dev server answers a missing file with index.html, so a manifest is only one that parses.
  const manifest = await page.evaluate(() => fetch('sound-lab/manifest.json').then((r) => r.text()).then((t) => { try { return JSON.parse(t) } catch { return null } }))
  if (!existsSync(join(here, '../public/sound-lab/manifest.json')) && !manifest) {
    skip('Every video in the manifest is served', 'public/sound-lab/manifest.json is not here (gitignored; the videos are made locally), so there are no videos to check')
  } else {
    const videos = manifest ? manifest.clips.flatMap((c) => Object.values(c.videos)) : []
    const missing = []
    for (const v of videos) if (!(await page.evaluate((v) => fetch(v, { method: 'HEAD' }).then((r) => r.ok && r.headers.get('content-type')?.includes('mp4')), v))) missing.push(v)
    check('Every video in the manifest is served', manifest && videos.length > 0 && !missing.length, `${videos.length} videos; missing ${missing.join(', ') || 'none'}`)
  }
  check('No page errors', !errors.length, errors.join(' | '))
} finally {
  await browser.close()
  for (const [f, data] of Object.entries(keep)) data ? writeFileSync(join(lab, f), data) : rmSync(join(lab, f), { force: true })
}
for (const c of checks) console.log(`${c.skipped ? 'SKIP' : c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
const failed = checks.filter((c) => !c.pass).length
const skipped = checks.filter((c) => c.skipped).length
console.log(`\n${checks.length - failed - skipped}/${checks.length - skipped} checks pass${skipped ? `, ${skipped} skipped` : ''}`)
process.exit(failed ? 1 : 0)
