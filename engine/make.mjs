// Making (#220): say what you want and where, and a model makes it in a shared world, out of the world's own cells.
//
//   node make.mjs "a market stall with a striped awning" --world http://127.0.0.1:5741 --at 700,3990
//   node make.mjs "a red phone box" --world URL --from 700,172,4060 --toward 0,-0.2,-1    where an eye there looks
//   node make.mjs "a fountain" --world URL --me              in front of you, if you alone have that world open in a page (--me name if not: the name over your head)
//   node make.mjs --undo --world URL                         takes the last one out again
//
//   --fill 100,120,100 --grow cap|scale   a space to fill, in cells (wide, high, deep), and how a thing past 6.4 m is come by
//   --facing south|north|east|west   which way its front faces (default: towards --from, or south)
//   --model opus                     which of your models makes it (sonnet is about twice as fast and plainer)
//   --program                        the reply is a program that lays the thing in cells as fine as 1.25 cm (minutes, far more detail)
//   --cells                          the reply is cells (make/cells.mjs): what a picture was carved into, or a thing kept once made
//   --reply file                     a reply kept in a file stands in for the model (no model is run)
//   --dry                            make and check it, send nothing
//   --fresh                          ask the model even if the wish was made before and is kept (make/library.mjs; --library dir)
//   --times                          say how long each stage took
//   --by name  --journal file  --claude path
//
// The model is your own Claude Code, run on this machine with no tools, and its reply is data: a list of boxes
// (make/form.mjs), checked, turned into cells here, and sent to the world as one ordinary edit that the world
// takes whole or not at all. The world's server never runs a model.
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fieldKeys } from './make/form.mjs'
import { LIBRARY, library, recalled } from './make/library.mjs'
import { made as programmed, refused as stopped } from './make/program.mjs'
import { reply as ask } from './make/model.mjs'
import * as maker from './make/maker.mjs'
import { gaze, people, served } from './make/served.mjs'

// What the maker is handed here (make/maker.mjs): a world's server by its address, a journal that is a file on this
// machine, the model that is the asker's own binary, and the box a reply that is a program runs in.
maker.useProgram({ made: programmed, refused: stopped })
export const JOURNAL = join(homedir(), '.village', 'engine', 'made.jsonl')
/** A journal file of lines of JSON, one for each time something made is written down. */
const journalAt = (file) => ({
  async note(line) { await mkdir(dirname(file), { recursive: true }); await appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n') },
  async lines() { try { return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
})
/** A world as an address is the server there; one handed in whole (make/maker.mjs `World`) is taken as it is. */
const worldOf = (world) => (typeof world === 'string' ? served(world) : world)
const handed = (o) => ({ ...o, world: worldOf(o.world), journal: typeof o.journal === 'object' ? o.journal : journalAt(o.journal ?? JOURNAL) })

export const ground = (world, where) => maker.ground(worldOf(world), where)
export const placing = (o) => maker.placing({ ...o, world: worldOf(o.world) })
export const kept = maker.kept
export const make = (o) => maker.make({ ...handed(o), model: o.model ?? ((q) => ask(q)) })
export const put = (o) => maker.put(handed(o))
export const undo = (o) => maker.undo(handed(o))
export const enliven = (o) => maker.enliven(handed(o))
export const aimed = (o) => maker.aimed({ ...o, world: worldOf(o.world) })
export const cellsOf = (world, id) => maker.cellsOf(worldOf(world), id)

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }, has = (name) => args.includes(`--${name}`)
  const numbers = (name, n) => { const v = flag(name)?.split(',').map(Number); if (v && (v.length !== n || !v.every(Number.isFinite))) { console.error(`--${name} is ${n} numbers with commas between`); process.exit(2) } return v }
  const world = flag('world')?.replace(/\/$/, ''), journal = flag('journal') ?? JOURNAL, by = flag('by') ?? 'maker'
  if (!world) { console.error('say which world: --world http://127.0.0.1:port (a server started with --world file)'); process.exit(2) }
  if (has('undo')) {
    const r = await undo({ world, id: flag('undo')?.startsWith('--') ? undefined : flag('undo'), by, journal })
    console.log(r.state === 'undone' ? `took out ${r.name}` : `not undone (${r.state}): ${r.why}`)
    process.exit(r.state === 'undone' ? 0 : 1)
  }
  const wish = args[0]?.startsWith('--') ? '' : args[0]
  const spotAt = numbers('at', 2), from = numbers('from', 3), toward = numbers('toward', 3), fill = numbers('fill', 3)
  let where = spotAt ? { at: spotAt } : from && toward ? { from: from.map(Math.round), toward } : null
  if (wish && has('me')) {
    const name = flag('me')?.startsWith('--') ? undefined : flag('me'), there = (await people(world)).filter((p) => !p.seat)
    const who = name ? there.find((p) => p.name === name || p.by === name) : there.length === 1 ? there[0] : null
    if (!who) { console.error(there.length ? `${there.length} have that world open: say which with --me name (${there.map((p) => p.name ?? p.by).join(', ')})` : 'nobody has that world open in a page: open /city?shared=1 there, or say where with --at or --from'); process.exit(2) }
    where = gaze(who)
  }
  if (!wish || !where) { console.error('node make.mjs "what to make" --world URL (--me | --at x,z | --from x,y,z --toward dx,dy,dz)'); process.exit(2) }
  const canned = flag('reply')
  const model = canned ? async () => ({ text: await readFile(canned, 'utf8'), model: `a reply kept in ${canned} (no model was run)`, ms: 0, cost: 0 }) : (q) => ask({ ...q, model: flag('model') ?? 'opus', effort: flag('effort'), binary: flag('claude') ?? 'claude', limit: has('program') ? 1_200_000 : undefined })
  // Made before (make/library.mjs): a wish kept on this machine or with the engine is made from what was kept, with no model.
  const known = !canned && !fill && !has('fresh') ? await library(flag('library') ?? LIBRARY).find(wish, '', fieldKeys()) : null
  if (known) console.log(`  made before as ${known.name}: no model is asked`)
  const r = await make({ wish, world, where, fill, grow: flag('grow') ?? 'cap', facing: flag('facing'), by, journal, model, how: has('program') ? 'program' : has('cells') ? 'cells' : 'parts', dry: has('dry'), say: (s) => console.log(`  ${s}`), ...(known ? recalled(known) : {}) })
  const what = r.origin ? `${r.name}: ${r.cells} cells in ${r.rows} runs, ${r.size.join(' x ')}, facing ${r.facing} at ${r.origin.join(', ')}` : ''
  if (r.left) console.log(`  about ${r.left} in a hundred of what the model described could not be used and was left out`)
  if (r.moved) console.log(`  the place itself was taken: it stands ${(r.moved / 10).toFixed(1)} m from it`)
  if (has('times')) console.log(`  stages: ${r.times.map(([n, ms]) => `${n} ${ms} ms`).join(', ')}; all ${r.times.reduce((a, [, ms]) => a + ms, 0)} ms`)
  if (r.state === 'there') console.log(`made ${what}\n  by ${r.model} in ${(r.ms / 1000).toFixed(1)} s${r.tries > 1 ? ` (asked ${r.tries} times)` : ''}; undo with --undo ${r.id}`)
  else if (r.state === 'dry') console.log(`would make ${what} (nothing was sent)`)
  else if (r.state === 'held') console.log(`made ${r.name}, and no place near there will take it (${r.why}): say another place with --at or --from`)
  else console.log(`not made (${r.state}): ${r.why}${what ? `\n  ${what}` : ''}`)
  process.exit(r.state === 'there' || r.state === 'dry' ? 0 : 1)
}
