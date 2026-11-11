// The street's problems on the real world, with no page (#118): each one's test is run by the
// world on real bodies. Otis climbs stairs made near him and is up; a tall box with no way up
// he tries from every side and gives up on. Ines is shaded by a made thing between her head
// and the sun, not by one beside her. After the rest what solved each is swept and each is
// wanted again. Usage: node test/problems.mjs
import { createServer } from 'vite'

const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const bad = []
const check = (what, ok, seen) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || seen === undefined ? '' : ` ${JSON.stringify(seen).slice(0, 400)}`}`); if (!ok) bad.push(what) }
try {
  const { Block } = await server.ssrLoadModule('/src/block.ts')
  const { Problems, PROBLEMS } = await server.ssrLoadModule('/src/problems.ts')
  const { piecesShape } = await server.ssrLoadModule('../home/src/engine/toy.ts')
  const { planeAt, GRADE } = await server.ssrLoadModule('/src/ground.ts')
  const { SUN } = await server.ssrLoadModule('/src/sun.ts')
  const sim = await Block.make({ crates: 0, balls: 6 })
  const said = [], solved = [], wanted = new Map(), seats = new Map()
  const problems = new Problems({
    join: (name, plush, scarf, at) => { const id = sim.cast(name, plush, scarf, at); seats.set(name, id); return id },
    stand: (id, at) => sim.stand(id, at),
    self: (id) => sim.self(id),
    drive: (id, to) => sim.drive(id, to),
    say: (id, words) => said.push([sim.nameOf(id), words]),
    others: () => [],
    made: () => sim.madeNow(),
    sweep: (ids) => ids.forEach((id) => sim.take(id)),
    meets: (from, along, not) => sim.meets(from, along, not),
    wants: (by, who, text) => wanted.set(who, text),
    solved: (by, entry) => solved.push(entry),
  }, 12_000)
  let now = 0
  /** Runs the world for some seconds, or until `until` is so. */
  const run = (seconds, until = () => false) => { for (let i = 0; i < seconds * 60 && !until(); i++) { now += 1000 / 60; problems.tick(now); sim.step() } }
  const where = (name) => sim.self(seats.get(name)).p
  const feet = (name) => where(name)[1] - 0.75 - planeAt(where(name)[2])
  const otis = PROBLEMS.find((p) => p.id === 'up').who.at, ines = PROBLEMS.find((p) => p.id === 'shade').who.at
  // Laid on the street as a made thing is: tilted with the hill, so a step is as high from the ground at either end.
  const made = (id, label, at, pieces) => ({ id, label, frame: { at, yaw: 0, tilt: Math.atan(GRADE) }, gadgets: [], wires: [], inputs: {}, parts: [{ id: 'body', material: 'maple', at: [0, 0, 0], shape: piecesShape(pieces), pieces }] })
  const box = (half, at) => ({ shape: { kind: 'box', half }, at })
  /** Five steps rising towards -z (up the hill), and a landing 1.8 m up. */
  const stairs = [...[0, 1, 2, 3, 4].map((i) => box([0.8, 0.15 * (i + 1), 0.25], [0, 0.15 * (i + 1), 1.5 - 0.5 * i])), box([0.8, 0.9, 0.6], [0, 0.9, -1.6])]

  run(3)
  check('left alone for three seconds, nothing is solved and all three want something', solved.length === 0 && problems.wanted().map((w) => w.who).sort().join() === 'Ines,Mabel,Otis', solved)

  // A tall box near Otis has no way up: he tries every side, says so, and still wants.
  sim.place(made('made-1', 'Tall box', [otis[0] - 3.5, planeAt(otis[2] + 1), otis[2] + 1], [box([0.7, 1, 0.7], [0, 1, 0])]), 'a tall box', 'Tester')
  run(30)
  check('a tall box with no way up: he tries it from every side, gives up and says so', solved.length === 0 && said.some(([who, words]) => who === 'Otis' && /cannot get up/.test(words)) && feet('Otis') < 0.5, { solved, said: said.filter(([who]) => who === 'Otis'), feet: feet('Otis') })

  // Stairs near him: he finds the side that goes up, climbs, and is up.
  sim.place(made('made-2', 'Stairs', [otis[0] + 0.5, planeAt(otis[2] - 4.5), otis[2] - 4.5], stairs), 'stairs', 'Tester')
  run(30, () => solved.length > 0)
  run(0.5)
  check('stairs: he climbs them himself and is up, and whoever made them is thanked', solved.length === 1 && solved[0].problem === 'up' && solved[0].solver === 'Tester' && solved[0].with === 'Stairs' && feet('Otis') >= 1.4, { solved, feet: feet('Otis'), at: where('Otis'), said: said.filter(([who]) => who === 'Otis') })
  check('he wants nothing now', wanted.get('Otis') === '')

  // A canopy far to one side of Ines is not shade. One whose shadow falls a few steps from her is: the sun is low, so it lies
  // well to one side of the canopy, and she walks into it herself.
  const spot = [ines[0] - 0.6, ines[2] - 2.4]
  const sunward = [spot[0] + (SUN[0] / SUN[1]) * 1.9, ines[1], spot[1] + (SUN[2] / SUN[1]) * 1.9]
  sim.place(made('made-3', 'Canopy', [ines[0] - 4.5, ines[1], ines[2] + 3], [box([1, 0.05, 1], [0, 2.6, 0])]), 'a canopy', 'Tester')
  run(1)
  check('a canopy that stands beside her does not shade her', solved.length === 1, solved)
  sim.place(made('made-4', 'Canopy', sunward, [box([1.3, 0.05, 1.3], [0, 3, 0])]), 'a canopy', 'Tester')
  run(8, () => solved.length === 2)
  check('she steps into the shade a canopy throws a few steps away', Math.hypot(where('Ines')[0] - spot[0], where('Ines')[2] - spot[1]) < 1.3 && said.some(([who, words]) => who === 'Ines' && /shade/.test(words)), { at: where('Ines'), spot, said: said.filter(([who]) => who === 'Ines') })
  check('standing in it she is shaded, and whoever made it is thanked', solved.length === 2 && solved[1].problem === 'shade' && solved[1].who === 'Ines' && solved[1].solver === 'Tester' && solved[1].with === 'Canopy', solved)

  // The canopy is changed while she rests: it is a new thing under a new name, and still what shades her.
  sim.take('made-4')
  sim.place(made('made-5', 'Canopy', sunward, [box([1.3, 0.05, 1.3], [0, 3, 0])]), 'a canopy, changed', 'Tester')
  run(14)
  check('after the rest the stairs and that canopy are swept, the rest left, and both want again', sim.madeNow().map((m) => m.id).join() === 'made-1,made-3' && wanted.get('Otis') && wanted.get('Ines'), { made: sim.madeNow().map((m) => m.id), otis: wanted.get('Otis'), ines: wanted.get('Ines') })
  check('Otis is down on the ground again', feet('Otis') < 0.3, { feet: feet('Otis'), at: where('Otis') })
  check('nothing was solved twice', solved.length === 2, solved)

  // Mabel is knocked into the trench while she only stands there: she is back at her place a moment later.
  const mabel = PROBLEMS.find((p) => p.id === 'across').who.at
  sim.world.moveTo(`${sim.toyOf(seats.get('Mabel'))}/body`, [mabel[0], planeAt(6) - 1.4, 6], [0, 0, 0])
  run(1)
  const down = feet('Mabel')
  run(4)
  check('knocked into the trench while standing, she is back at her place', down < -1.1 && feet('Mabel') > -0.2 && Math.hypot(where('Mabel')[0] - mabel[0], where('Mabel')[2] - mabel[2]) < 0.8, { down, feet: feet('Mabel'), at: where('Mabel') })

  // With nobody on the street but those the world walks, the balls stop where they roll to and the world rests. (The last
  // ball let go when the stairs were swept takes about a minute to roll down into the trench and knock two awake there.)
  run(80)
  const awake = sim.awake()
  check('with nobody here the balls come to rest: only the three the world walks are awake', awake <= 3, awake)
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
if (bad.length) { console.log(`FAILED: ${bad.join('; ')}`); process.exitCode = 1 }
await server.close()
