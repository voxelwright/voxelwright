// The sound plugin's check: what rules sound reaches pages as it should, and what no rule should send is left.
// The real server; no page (test/sounded.mjs plays it in one and measures what is heard, test/inrealm.mjs does so
// in a realm that is not home). Two rules that are not alike and are no game: a gatehouse bell and a tinker.
//
//   node plugins/sound/check.mjs
import { readFileSync } from 'node:fs'
import { guideFor } from '../../make/rules.mjs'
import { LIKES } from '../../page/sound/likes.ts'
import { until, wait, world } from '../../test/plugkit.mjs'
import { EVERY, FOLLOW_ALL, FOLLOW_MOST, HELD_MOST, NOTES_MOST, SOUNDS_A_SECOND } from './world.mjs'

const w = await world(), { check } = w
/** Every sound pages have been told of. */
const sounds = () => w.said.filter((m) => m.plugin === 'sound' && m.once).map((m) => m.once)
/** The sounds that follow someone, as pages were last told. */
const follows = () => w.said.filter((m) => m.plugin === 'sound' && m.state).at(-1)?.state.follows ?? []
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text()), own = readFileSync(new URL('./guide.txt', import.meta.url), 'utf8')
  check(guide.includes('world.sound({like, at, on,') && guide.includes('patch: a sound of your own'), 'the guide a model writes rules from has world.sound and the form of a patch')
  check(Object.entries(LIKES).every(([k, v]) => own.includes(`${k} (${v.says})`)), `the guide names each of the ${Object.keys(LIKES).length} kept sounds as the code has them`)
  check(own.includes(`notes is up to ${NOTES_MOST} notes`) && own.includes(`(0.05 to ${HELD_MOST})`) && own.includes(`at most ${SOUNDS_A_SECOND} sounds a second`), 'and the limits the code keeps')
  check(own.includes('as: a sound that stays on someone') && own.includes(`at most ${FOLLOW_MOST} at a time, a realm ${FOLLOW_ALL}`) && own.includes(`${EVERY[0]} to ${EVERY[1]} ms`) && guide.includes('stop: true'), 'and a sound that follows, with its limits')
  await w.post('join', { by: 'ada', at: [700, 4012] })
  // A gatehouse: its bell tolls on the tick, placed where the rule says.
  await w.rule('gate', `on('tick', (world) => world.sound({ like: 'bell', at: [800, 4012], size: 2, reach: 60 }))`)
  const bell = await until('the bell', () => sounds().find((s) => s.like === 'bell'))
  check(bell.at[0] === 800 && bell.at[2] === 4012 && bell.size === 2 && bell.reach === 60 && bell.force === 0.7, `a gatehouse bell is told to pages where the rule put it (${JSON.stringify(bell)})`)
  await w.post('ask', { by: 'tester', unrule: 'gate' })
  // A tinker: a patch of the rule's own, on its actor, three notes one after another.
  await w.rule('tinker', `
on('start', (world) => world.actor('tinker', { name: 'Bram', at: [720, 4012] }))
on('said', (world, e) => { if (/mend/.test(e.text)) world.sound({ on: 'tinker', patch: { how: 'struck', hard: 0.9, rough: 0.1, shape: 'cup', pitch: 900, ring: 0.4, damp: 0.2, gain: 0.6 }, notes: [72, 76, 79], gap: 120 }) })`)
  await until('the tinker is there', async () => (await w.how('tinker'))?.actors === 1)
  await w.post('say', { by: 'ada', text: 'mend this' })
  const pot = await until('the pot', () => sounds().find((s) => s.patch))
  check(pot.patch.shape === 'cup' && pot.hz.length === 3 && pot.gap === 120 && Math.abs(pot.at[0] - 720) < 20, `a tinker's own patch sounds on him, three notes 120 ms apart (${pot.at})`)
  // What no rule should send.
  await w.rule('rot', `on('said', (world, e) => { if (e.text !== 'rot') return
  world.sound({ like: 'kazoo', at: [700, 4012] }); world.sound({ like: 'bell' }); world.sound({ like: 'bell', on: 'nobody' }); world.sound({ like: 'bell', at: [700, 4012], src: 'http://example.com/a.mp3' })
  world.sound({ at: [700, 4012], patch: { how: 'struck', run: 'alert(1)' } }); world.sound({ like: 'bell', at: [700, 4012], patch: {} })
  for (let i = 0; i < 40; i++) world.sound({ like: 'click', at: [700, 4012] }) })`)
  await until('rot runs', async () => (await w.how('rot'))?.running)
  const before = sounds().length
  await w.post('say', { by: 'ada', text: 'rot' })
  const why = await until('the rule is told', async () => (await w.how('rot'))?.error)
  await wait(500)
  const after = sounds().slice(before)
  check(after.length === SOUNDS_A_SECOND && after.every((s) => s.like === 'click'), `a sound like nothing kept, at no place, on nobody, with a stray field, a patch that is not one, and both at once are left; of forty clicks ${after.length} are made; the rule is told ("${why}")`)
  await w.post('ask', { by: 'tester', unrule: 'rot' })
  await w.post('ask', { by: 'tester', unrule: 'tinker' })

  // Sounds that follow: a ferryman's horn held on him, changed by name, stopped; a drum beaten on whoever joined.
  await w.rule('ferry', `
on('start', (world) => { world.actor('ferryman', { name: 'Nils', at: [740, 4012] }); world.sound({ as: 'horn', on: 'ferryman', like: 'horn', note: 50 }) })
on('tick', (world) => { if (!world.keep.off) world.sound({ as: 'horn', on: 'ferryman', like: 'horn', note: world.keep.note || 50 }) })
on('said', (world, e) => {
  if (/higher/.test(e.text)) world.keep.note = 62
  if (/drum/.test(e.text)) world.sound({ as: 'drum', on: e.by, like: 'drum', every: 500 })
  if (/enough/.test(e.text)) { world.keep.off = true; world.sound({ as: 'horn', stop: true }) }
  if (/wrong/.test(e.text)) { world.sound({ as: 'a b', on: 'ferryman', like: 'horn' }); world.sound({ as: 'x', on: 'ferryman', like: 'bell' }); world.sound({ as: 'x', on: 'nobody', like: 'horn' }); world.sound({ as: 'x', on: 'ferryman', like: 'horn', at: [1, 2] }); world.sound({ as: 'x', on: 'ferryman', like: 'horn', notes: [60, 62] }); world.sound({ like: 'bell', at: [700, 4012], every: 300 }); world.sound({ as: 'x', on: 'ferryman', like: 'drum', every: 5 }); world.sound({ as: 'x', on: 'ferryman', patch: { how: 'rubbed', hard: 1, rough: 0.04, shape: 'cup', pitch: 880, ring: 2, damp: 0.1, gain: 0.5 } }) }
  if (/many/.test(e.text)) for (let i = 0; i < 9; i++) world.sound({ as: 'h' + i, on: 'ferryman', like: 'pipe', note: 60 + i })
})`)
  const horn = await until('the horn', () => follows().find((f) => f.key === 'ferry/horn'))
  const told = () => w.said.filter((m) => m.plugin === 'sound' && m.state).length
  const once = told()
  await wait(1600)
  check(horn.on === 'ferry/ferryman' && horn.like === 'horn' && Math.abs(horn.hz - 146.83) < 0.1 && horn.every === 0 && told() === once, `a ferryman's horn stays on him: pages are told who it is on, and a rule that says the same on every tick tells them nothing more (${JSON.stringify(horn)})`)
  await w.post('say', { by: 'ada', text: 'higher' })
  const up = await until('higher', () => follows().find((f) => f.key === 'ferry/horn' && f.hz > 290))
  check(Math.abs(up.hz - 293.66) < 0.1 && follows().length === 1, 'said again by the same name with another note, it is the same sound at a new pitch')
  await w.post('say', { by: 'ada', text: 'drum' })
  const drum = await until('a drum', () => follows().find((f) => f.key === 'ferry/drum'))
  check(drum.on === 'ada' && drum.every === 500, 'what is struck follows by being made again: a drum on whoever asked, every 500 ms')
  const kept = JSON.stringify(follows())
  await w.post('say', { by: 'ada', text: 'wrong' })
  const said = await until('the rule is told', async () => (await w.how('ferry'))?.error)
  await wait(300)
  check(JSON.stringify(follows()) === kept, `a name with a space, a bell with no "every", on nobody, with a place, with several notes, "every" with no name, one too quick, and a rubbed glass with no "every" are all left ("${said}")`)
  // A patch said with a reach, then said again as the same patch without one, keeps its reach.
  await w.rule('reed', `const P = { how: 'blown', hard: 0.5, rough: 0.2, shape: 'tube', pitch: 300, ring: 0.1, damp: 0.4, gain: 0.5 }
on('start', (world) => { world.actor('reed', { at: [730, 4012] }); world.sound({ as: 'reed', on: 'reed', patch: P, reach: 40 }) })
on('tick', (world) => world.sound({ as: 'reed', patch: P, note: 60 }))`)
  const reed = await until('the reed', () => follows().find((f) => f.key === 'reed/reed' && f.hz > 0))
  check(reed.reach === 40, `a patch said again without its reach keeps the reach it had (${reed.reach})`)
  await w.post('ask', { by: 'tester', unrule: 'reed' })
  await until('the reed gone', () => !follows().some((f) => f.key === 'reed/reed'))
  await w.post('say', { by: 'ada', text: 'many' })
  await wait(1200)
  check(follows().filter((f) => f.key.startsWith('ferry/')).length === FOLLOW_MOST, `nine more asked for: a rule has ${FOLLOW_MOST} at a time`)
  // Looked at again (the plugin changed while the game runs), they are all still so.
  await w.look()
  await wait(400)
  check(follows().length === FOLLOW_MOST, 'told to look at its plugins again, the sounds that follow are still there')
  await w.post('say', { by: 'ada', text: 'enough' })
  await until('the horn stops', () => !follows().some((f) => f.key === 'ferry/horn'))
  // Who it is on goes: it goes with them. The rule goes: so do the rest.
  await w.post('leave', { by: 'ada' })
  await until('the drum goes with whoever it was on', () => !follows().some((f) => f.key === 'ferry/drum'), 4000)
  check(follows().length === FOLLOW_MOST - 2, 'stopped by the rule it is gone; and when whoever it is on leaves, it goes with them')
  await w.post('ask', { by: 'tester', unrule: 'ferry' })
  await until('none', () => follows().length === 0)
  check(true, 'the rule taken out, its sounds go with it')
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
w.finish('sound plugin')
