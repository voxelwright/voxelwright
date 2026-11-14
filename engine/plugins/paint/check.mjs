// The paint plugin's check: a rule that is no game (a keeper who chalks out her stall's patch and a way to her door,
// and moves a ring to whoever asks) draws marks on the ground; pages are told them, a page draws them on the street
// (--out keeps the picture), and what is wrong is refused in words. The real server, and a real page.
//
//   node plugins/paint/check.mjs [--out picture.png]
import { guideFor } from '../../make/rules.mjs'
import { arg, chrome } from '../../test/kit.mjs'
import { until, wait, world } from '../../test/plugkit.mjs'
import { CHANGES_A_SECOND, MARKS_A_RULE } from './world.mjs'

const w = await world(), { check } = w
/** What pages were last told the marks are. */
const marks = () => w.said.filter((m) => m.plugin === 'paint' && 'state' in m).at(-1)?.state
let browser
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.paint(id, {at, within, line, closed, colour, wide, fill})') && guide.includes(`at most ${MARKS_A_RULE} marks`) && guide.includes(`${CHANGES_A_SECOND} times a second`), 'a model writing rules is shown world.paint, every field and the limits the code keeps')
  await w.post('join', { by: 'wren', at: [700, 4060] })
  await w.rule('stall', `
on('start', (world) => {
  world.actor('keeper', { name: 'Ines', at: [700, 4050] })
  world.paint('patch', { line: [[680, 4040], [720, 4040], [720, 4075], [680, 4075]], closed: true, colour: '#ffd23f', fill: 0.25 })
  world.paint('way', { line: [[700, 4040], [700, 4005]], wide: 2 })
})
on('said', (world, e) => {
  if (/here/.test(e.text)) world.paint('you', { at: [e.at[0], e.at[2]], within: 12, colour: '#3fa7ff', wide: 2 })
  if (/same/.test(e.text)) world.paint('you', { at: [e.at[0], e.at[2]], within: 12 })
  if (/red/.test(e.text)) world.paint('you', { colour: '#e0302a' })
  if (/rub/.test(e.text)) world.paint('way', { hide: true })
})`)
  const told = await until('pages are told the marks', () => marks()?.length === 2 && marks())
  const patch = told.find((m) => m.id === 'patch')
  check(patch.rule === 'stall' && patch.closed === true && patch.colour === '#ffd23f' && patch.fill === 0.25 && patch.wide === 3 && patch.line.length === 4 && told.find((m) => m.id === 'way').fill === 0, `a closed line and a line are told to pages, with what was left out as the guide says (${JSON.stringify(patch)})`)
  await w.post('say', { by: 'wren', text: 'stand here' })
  const ring = await until('a ring round whoever asked', () => marks()?.find((m) => m.id === 'you'))
  check(Math.abs(ring.at[0] - 700) < 2 && Math.abs(ring.at[1] - 4060) < 2 && ring.within === 12 && !ring.line, `a ring is drawn round whoever asked (${JSON.stringify(ring)})`)
  const before = w.said.length
  await w.post('say', { by: 'wren', text: 'the same' })
  await w.post('say', { by: 'wren', text: 'now red' })
  await until('the ring turns red', () => marks()?.find((m) => m.id === 'you')?.colour === '#e0302a')
  const tellings = w.said.slice(before).filter((m) => m.plugin === 'paint').length
  check(tellings === 1 && marks().find((m) => m.id === 'you').within === 12, `only what is given changes, and a mark drawn as it is is not told again (${tellings} telling for two asks)`)

  // A page draws them.
  browser = await chrome()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => w.failures.push(`page error: ${e.message}`))
  // Over the stall, looking down and north at the houses: the patch, the way to the door, and the wall behind.
  await page.goto(`${w.url}/city?shared=1&fly=1&at=70,21,411&look=0,-35`)
  await page.waitForFunction(() => globalThis.engine?.plugins?.of('paint')?.shown?.frames > 0, null, { timeout: 90_000 })
  const shown = await page.evaluate(() => globalThis.engine.plugins.of('paint').shown)
  const patchShown = shown.marks.find((m) => m.id === 'patch')
  check(shown.failed === '' && shown.marks.length === 3 && patchShown.low < 157 && patchShown.high > 154 && patchShown.high - patchShown.low < 10, `a page draws the three marks, each between the heights of the ground under it (the patch ${patchShown.low} to ${patchShown.high}), in ${shown.frames} frames`)
  await wait(1500)
  // What is painted is found by drawing the same picture with the marks and without: where they differ is chalk.
  const frame = async () => page.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const c = document.querySelector('canvas'); const g = document.createElement('canvas'); g.width = 128; g.height = 72; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 128, 72); return [...x.getImageData(0, 0, 128, 72).data] })
  const withMarks = await frame()
  if (arg('out', '')) await page.screenshot({ path: arg('out', '') })
  await w.post('ask', { by: 'tester', unrule: 'stall' })
  await until('the marks go with their rule', () => marks()?.length === 0)
  await page.waitForFunction(() => globalThis.engine.plugins.of('paint').shown.marks.length === 0, null, { timeout: 10_000 })
  await wait(500)
  const without = await frame()
  // Rows of the small picture (72 high) that changed: the lower part is the street, the top the house fronts.
  const changed = (y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 128; x++) { const i = (y * 128 + x) * 4; if (Math.abs(withMarks[i] - without[i]) + Math.abs(withMarks[i + 1] - without[i + 1]) + Math.abs(withMarks[i + 2] - without[i + 2]) > 40) n++ } return n }
  const ground = changed(36, 72)
  check(ground > 150, `the marks are on the picture where the ground is (${ground} of 4608 small pixels of the lower half changed) and gone when the rule is taken out`)

  // What no rule should send: each is refused in words, and the rule goes on.
  await w.rule('rot', `on('said', (world, e) => {
  const t = e.text
  if (t === 'odd') world.paint('a', { at: [700, 4060], within: 5, src: 'x.png' })
  if (t === 'none') world.paint('b', { colour: '#ffffff' })
  if (t === 'both') world.paint('c', { at: [700, 4060], within: 5, line: [[0, 0], [1, 1]] })
  if (t === 'far') world.paint('d', { at: [700, 4060], within: 9000 })
  if (t === 'long') world.paint('e', { line: [[0, 0], [5000, 0]] })
  if (t === 'colour') world.paint('f', { at: [700, 4060], within: 5, colour: 'red; background: url(x)' })
  if (t === 'many') for (let i = 0; i < ${MARKS_A_RULE + 1}; i++) world.paint('m' + i, { at: [700 + i, 4060], within: 3 })
  if (t === 'flood') for (let i = 0; i < ${CHANGES_A_SECOND + 5}; i++) world.paint('m0', { within: 3 + i })
})`)
  await until('rot runs', async () => (await w.how('rot'))?.running)
  for (const [say, why] of [['odd', /paint has no "src"/], ['none', /needs its shape/], ['both', /one of the two/], ['far', /within is how far/], ['long', /at most 4000 cells/], ['colour', /colour is "#rrggbb"/], ['many', /at most 16 marks/], ['flood', /at most 20 times a second/]]) {
    if (say === 'many' || say === 'flood') await wait(1100)
    await w.post('say', { by: 'wren', text: say })
    const how = await until(`refused: ${say}`, async () => { const r = await w.how('rot'); return why.test(r.error) && r })
    check(how.running, `"${say}" is refused in words and the rule goes on: ${how.error.slice(0, 80)}`)
  }
  const left = marks()
  check(left.length === MARKS_A_RULE && left.every((m) => m.rule === 'rot' && m.colour === '#f4f1e8') && !left.some((m) => /url/.test(m.colour)), `of what was refused nothing is drawn: ${left.length} rings of the rule's ${MARKS_A_RULE + 1}`)
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
await browser?.close().catch(() => {})
w.finish('plugin paint')
