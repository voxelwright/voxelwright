// The music plugin's check: what rules say the realm's music is like reaches pages as it should, a field at a
// time, and what no rule should say is left. The real server; no page (test/tuned.mjs plays it in one and measures
// what is heard). Two rules that are not alike and are no game: a lighthouse and a dancing class.
//
//   node plugins/music/check.mjs
import { guideFor } from '../../make/rules.mjs'
import { MODES, MOODS, PACE } from '../../page/sound/music/compose.ts'
import { until, wait, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
/** What pages were last told the realm's music is: undefined if nothing was ever said. */
const playing = () => w.said.filter((m) => m.plugin === 'music' && 'state' in m).at(-1)?.state
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.music({like, pace, mode, drive, now})') && Object.values(MOODS).every((m) => guide.includes(`${m.name} (${m.idiom}, ${m.bpm} beats a minute)`)) && Object.keys(MODES).every((m) => guide.includes(m)) && guide.includes(`pace ${PACE[0]} to ${PACE[1]}`), 'a model writing rules is shown world.music, and every mood, its pace, every mode and the range of pace are as the code has them')
  await w.post('join', { by: 'ada', at: [700, 4012] })
  await wait(300)
  check(playing() === undefined, 'a realm with no word about music says nothing of it: it keeps the place’s')
  // A lighthouse: more of the coast's music as the rule's wind rises, alarm in a gale, the place's own when calm.
  await w.rule('light', `
on('start', (world) => { world.keep.wind = 0; world.music({ like: 'coast', drive: 0 }) })
on('said', (world, e) => { if (/storm/.test(e.text)) world.keep.rising = true; if (/calm/.test(e.text)) { world.keep.rising = false; world.keep.wind = 0; world.music({ like: null }) } })
on('tick', (world) => {
  if (!world.keep.rising) return
  world.keep.wind = Math.min(12, world.keep.wind + 1)
  if (world.keep.wind >= 8) world.music({ like: 'danger', pace: 150, drive: 1, now: true })
  else world.music({ like: 'coast', drive: world.keep.wind / 8 })
})`)
  const first = await until('the lighthouse sets its music', () => playing()?.like === 'coast' && playing())
  await w.post('say', { by: 'ada', text: 'a storm is coming' })
  const rising = await until('the wind rises', () => { const p = playing(); return p?.like === 'coast' && p.drive >= 0.35 ? p : null })
  const gale = await until('a gale', () => playing()?.like === 'danger' && playing())
  check(first.drive === 0 && rising.drive < 1 && gale.pace === 150 && gale.drive === 1 && gale.now === true, `a lighthouse's music is the coast's, more of it in as the rule's wind rises (drive ${first.drive}, then ${rising.drive}), and alarm at 150 beats a minute in a gale, on the beat`)
  await w.post('say', { by: 'ada', text: 'calm now' })
  await until('calm', () => playing() === null)
  check(true, 'said "calm", the rule gives the music back to the place')
  // A dancing class: pace and mode by what is said, a field at a time.
  await w.rule('dance', `
on('start', (world) => { world.keep.pace = 100; world.music({ like: 'town', pace: 100, mode: 'major', drive: 0.3 }) })
on('said', (world, e) => { if (/faster/.test(e.text)) world.music({ pace: world.keep.pace += 30 }); if (/sad/.test(e.text)) world.music({ mode: 'minor' }) })`)
  await until('the class starts', () => playing()?.like === 'town')
  await w.post('say', { by: 'ada', text: 'faster, and something sad' })
  const sad = await until('faster and sad', () => { const p = playing(); return p?.pace === 130 && p.mode === 'minor' ? p : null })
  check(sad.like === 'town' && sad.drive === 0.3, `a dancing class changes pace and mode and nothing else (${JSON.stringify(sad)})`)
  // What no rule should say.
  await w.rule('rot', `
on('said', (world, e) => {
  if (e.text !== 'rot') return
  world.music({ like: 'polka' })
  world.music({ like: 'town', pace: 9000, mode: 'x', drive: 7, now: 'yes' })
  world.music({ like: 'town', track: 'http://example.com/a.mp3' })
})`)
  await until('rot runs', async () => (await w.how('rot'))?.running)
  const before = w.said.length
  await w.post('say', { by: 'ada', text: 'rot' })
  const why = await until('the rule is told', async () => (await w.how('rot'))?.error)
  check(w.said.length === before && JSON.stringify(playing()) === JSON.stringify(sad), `a mood that is not kept, a pace, mode and drive out of range, and a track by address are all left, pages are told nothing, and the rule is told why ("${why}")`)
  // The rule whose words were all refused does not have the music: taking it out changes nothing. Taking out the one that has it gives the music back.
  await w.post('ask', { by: 'tester', unrule: 'rot' })
  await wait(400)
  const still = playing()
  await w.post('ask', { by: 'tester', unrule: 'dance' })
  await until('the place has its music again', () => playing() === null)
  check(still?.pace === 130, 'the music is the rule’s that changed it last: taking out a rule that changed nothing leaves it, taking out the one that has it gives it back to the place')
  // Looked at again (as when the plugin is changed while the game runs), what is so is still so.
  await w.rule('dance', `on('start', (world) => world.music({ like: 'snow', drive: 0.5 }))`)
  await until('snow', () => playing()?.like === 'snow')
  await w.look()
  await wait(300)
  check(playing()?.like === 'snow' && playing().drive === 0.5, 'told to look at its plugins again, the game keeps the music it had')
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
w.finish('music plugin')
