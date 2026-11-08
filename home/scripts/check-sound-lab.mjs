// Headless proof of the listening room (#52): /sound-lab.html loads with no errors, round 3's
// news card comes first and rounds 2 and 1 sit folded below, Start and a play button make sound at
// the master (tapped with an AudioWorklet, as in check-sound.mjs), picks in every round
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
    round3: [...document.querySelectorAll('#cues > section.cue')].map((s) => s.dataset.cue),
    round2: [...document.querySelectorAll('details.round2 > section.cue')].map((s) => s.dataset.cue),
    open: [...document.querySelectorAll('details.round')].map((d) => d.open),
    news: [...document.querySelectorAll('section[data-cue="news"] button.play')].map((b) => b.dataset.variant).join(''),
    newsBefore: document.querySelector('section[data-cue="news"] .before')?.textContent ?? '',
    newsPick: document.querySelector('section[data-cue="news"] .picks button[aria-pressed="true"]')?.dataset.value ?? null,
    hoverPicks: [...document.querySelectorAll('section[data-cue="hover"] .picks button')].map((b) => b.dataset.value).join(','),
    before: document.querySelector('section[data-cue="farewell"] .before')?.textContent ?? '',
  }))
  check('Round 3 first: the news card with A and the bubble pops F to I, quoting round 2\'s note; rounds 2 and 1 folded below with their picks',
    folded.round3.join() === 'news' && folded.round2.join() === 'hover,farewell,turned,pad-up,pad-down' && folded.open.join() === 'false,false' && folded.news === 'afghi' &&
    folded.newsBefore.includes('bubble pop') && folded.hoverPicks === 'a,d,e,f,none' && folded.before.includes('kalimba'), JSON.stringify(folded))
  await page.click('details.round2 > summary')
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
    // The page's CSP takes worklets from its own origin only (#40); the dev server serves this file.
    await audio.audioWorklet.addModule('/scripts/sound-tap.js')
    const tap = new AudioWorkletNode(audio, 'sound-tap')
    mix.output.connect(tap).connect(new GainNode(audio, { gain: 0 })).connect(audio.destination)
    window.peak = 0
    tap.port.onmessage = (m) => (window.peak = Math.max(window.peak, m.data[1]))
  })
  const quiet = await page.evaluate(() => new Promise((r) => setTimeout(() => r(window.peak), 300)))
  await page.click('section[data-cue="news"] button.play[data-variant="f"]')
  await page.waitForTimeout(700)
  const loud = await page.evaluate(() => window.peak)
  check('Start, then Play F (a recorded bubble pop) on round 3\'s news card sounds at the master', quiet < 1e-5 && loud > 1e-3, `before ${quiet}, after ${(20 * Math.log10(loud)).toFixed(1)} dBFS, context ${await page.evaluate(() => window.soundLab.audio.state)}`)

  // Picks in every round and a note round-trip through the server. A pick button toggles, so each
  // cue gets the first of its values that the owner's saved picks have not already pressed.
  const choose = async (cue, values) => {
    const v = await page.evaluate(([cue, values]) => values.find((v) => document.querySelector(`section[data-cue="${cue}"] .picks button[data-value="${v}"]`).getAttribute('aria-pressed') !== 'true'), [cue, values])
    await page.click(`section[data-cue="${cue}"] .picks button[data-value="${v}"]`)
    return v
  }
  const want = { news: await choose('news', ['h', 'g']), farewell: await choose('farewell', ['d', 'c']), sent: await choose('sent', ['c', 'a']), walk: await choose('walk', ['change', 'keep']) }
  await page.fill('section[data-cue="farewell"] textarea', 'the steps are lovely, a touch slower?')
  await page.click('#save')
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('saved'), null, { timeout: 5000 })
  const file = JSON.parse(readFileSync(join(lab, 'picks.json'), 'utf8'))
  const got = await page.evaluate(() => fetch('sound-lab/picks').then((r) => r.json()))
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem('village.sfx.picks')))
  check('Picks round-trip: POST writes picks.json, GET returns it, localStorage holds variants only',
    Object.entries(want).every(([cue, v]) => file.picks[cue] === v) && got.notes.farewell.startsWith('the steps') && file.savedAt && local.news === want.news && local.farewell === want.farewell && !('walk' in local),
    JSON.stringify({ want, file: file.picks, local }))
  await page.reload()
  await page.click('#start')
  await page.waitForSelector('#lab:not([hidden]) section.cue')
  await page.click('details.round2 > summary')
  await page.click('details.round1 > summary')
  const restored = await page.evaluate((want) => {
    const pressed = (cue, v) => document.querySelector(`section[data-cue="${cue}"] .picks button[data-value="${v}"]`).getAttribute('aria-pressed') === 'true'
    return Object.entries(want).every(([cue, v]) => pressed(cue, v)) && document.querySelector('section[data-cue="farewell"] textarea').value.startsWith('the steps')
  }, want)
  check('After a reload the page shows the saved picks (rounds 1, 2 and 3) and note', restored)

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
  check('Bad picks are refused (422, 400, or 415 for a non-JSON type) and leave picks.json alone', Object.entries(refused).every(([k, s]) => (k === 'notJsonType' ? s === 415 : s === 422 || s === 400)) && JSON.parse(readFileSync(join(lab, 'picks.json'), 'utf8')).picks.farewell === want.farewell, JSON.stringify(refused))

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
