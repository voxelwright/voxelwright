// The street's problems on the real world, with no page (#118): each one's test is run by the
// world on real bodies. Otis's ball stays in its tray until something knocks it out, and then
// he has it; Ines has her parcel when it lies by her; after the rest both are put back as they
// began. Usage: node test/problems.mjs
import { createServer } from 'vite'

const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const bad = []
const check = (what, ok, seen) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || seen === undefined ? '' : ` ${JSON.stringify(seen).slice(0, 400)}`}`); if (!ok) bad.push(what) }
try {
  const { Block } = await server.ssrLoadModule('/src/block.ts')
  const { Problems, PROBLEMS } = await server.ssrLoadModule('/src/problems.ts')
  const { planeAt } = await server.ssrLoadModule('/src/ground.ts')
  const sim = await Block.make({ crates: 0, balls: 0 })
  const said = [], solved = [], wanted = new Map()
  const problems = new Problems({
    join: (name, plush, scarf, at) => sim.cast(name, plush, scarf, at),
    stand: (id, at) => sim.stand(id, at),
    self: (id) => sim.self(id),
    drive: (id, to) => sim.drive(id, to),
    say: (id, words) => said.push([sim.nameOf(id), words]),
    others: () => [],
    made: () => sim.madeNow(),
    sweep: (ids) => ids.forEach((id) => sim.take(id)),
    prop: (toy) => void sim.prop(toy),
    where: (key) => sim.where(key),
    wants: (by, who, text) => wanted.set(who, text),
    solved: (by, entry) => solved.push(entry),
  }, 3000)
  let now = 0
  const run = (seconds) => { for (let i = 0; i < seconds * 60; i++) { now += 1000 / 60; problems.tick(now); sim.step() } }
  const height = (key) => { const p = sim.where(key); return p[1] - planeAt(p[2]) }
  const ines = PROBLEMS.find((p) => p.id === 'parcel').who.at, start = sim.where('parcel/box')

  run(3)
  check('left alone for three seconds, nothing is solved', solved.length === 0, solved)
  check('the ball is still in its tray on the post', height('post/ball') > 2.6, height('post/ball'))
  check('the parcel lies where it was left, up the street', Math.hypot(sim.where('parcel/box')[0] - start[0], sim.where('parcel/box')[2] - start[2]) < 0.3, sim.where('parcel/box'))
  check('all three want something', problems.wanted().map((w) => w.who).sort().join() === 'Ines,Mabel,Otis')

  // Something knocks the ball out of its tray.
  sim.world.applyImpulse('post/ball', [1.4, 0.9, 0.3])
  run(3)
  check('knocked out of its tray, the ball comes down and Otis has it', solved.length === 1 && solved[0].problem === 'ball' && solved[0].who === 'Otis' && height('post/ball') < 0.9, { solved, height: height('post/ball') })
  check('he thanks whoever it was, and wants nothing now', said.some(([who, words]) => who === 'Otis' && /Thanks/.test(words)) && wanted.get('Otis') === '', { said, wants: wanted.get('Otis') })

  // The parcel is set down by Ines's door.
  sim.world.moveTo('parcel/box', [ines[0] - 1.2, ines[1] + 0.4, ines[2]], [0, 0, 0])
  run(1)
  check('set down by her door, the parcel is Ines\'s', solved.length === 2 && solved[1].problem === 'parcel' && solved[1].who === 'Ines', solved)

  run(4)
  check('after the rest the ball is back in its tray and Otis wants it again', height('post/ball') > 2.6 && wanted.get('Otis'), { height: height('post/ball'), wants: wanted.get('Otis') })
  const again = sim.where('parcel/box')
  check('and the parcel is back up the street, wanted again', Math.hypot(again[0] - start[0], again[2] - start[2]) < 0.4 && wanted.get('Ines'), { again, start })
  check('nothing was solved twice by being put back', solved.length === 2, solved)
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
if (bad.length) { console.log(`FAILED: ${bad.join('; ')}`); process.exitCode = 1 }
await server.close()
