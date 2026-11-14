// The sound plugin's check: what rules sound reaches pages as it should, and what no rule should send is left.
// The real server; no page (test/sounded.mjs plays it in one and measures what is heard, test/inrealm.mjs does so
// in a realm that is not home). Two rules that are not alike and are no game: a gatehouse bell and a tinker.
//
//   node plugins/sound/check.mjs
import { readFileSync } from 'node:fs'
import { guideFor } from '../../make/rules.mjs'
import { LIKES } from '../../page/sound/likes.ts'
import { until, wait, world } from '../../test/plugkit.mjs'
import { HELD_MOST, NOTES_MOST, SOUNDS_A_SECOND } from './world.mjs'

const w = await world(), { check } = w
/** Every sound pages have been told of. */
const sounds = () => w.said.filter((m) => m.plugin === 'sound' && m.once).map((m) => m.once)
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text()), own = readFileSync(new URL('./guide.txt', import.meta.url), 'utf8')
  check(guide.includes('world.sound({like, at, on,') && guide.includes('patch: a sound of your own'), 'the guide a model writes rules from has world.sound and the form of a patch')
  check(Object.entries(LIKES).every(([k, v]) => own.includes(`${k} (${v.says})`)), `the guide names each of the ${Object.keys(LIKES).length} kept sounds as the code has them`)
  check(own.includes(`notes is up to ${NOTES_MOST} notes`) && own.includes(`(0.05 to ${HELD_MOST})`) && own.includes(`at most ${SOUNDS_A_SECOND} sounds a second`), 'and the limits the code keeps')
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
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
w.finish('sound plugin')
