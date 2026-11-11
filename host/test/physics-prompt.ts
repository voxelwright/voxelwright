// The physics prompts (#88): the rules prompt stays short, the toy prompt quotes only the kinds a
// made toy may use, and a renamed anchor in an engine file breaks the prompt loudly instead of
// quoting a whole file. Usage: npm run check-physics-prompt
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineText, madeKit, rulesPrompt, toyPrompt } from '../src/villager-physics.ts'
import { checkInventReply, inventPrompt, mechanicAnswer, stubMechanic } from '../src/villager-invent.ts'
import { checkRouted, stubRoute } from '../src/villager-input.ts'
import { LIMITS } from '../../home/src/invent/limits.ts'

const ENGINE = join(import.meta.dirname, '..', '..', 'home', 'src', 'engine')
let failed = 0
const check = (name: string, pass: boolean, detail?: unknown) => {
  if (!pass) failed++
  console.log(pass ? 'pass' : 'FAIL', name, pass ? '' : JSON.stringify(detail)?.slice(0, 300))
}
const throws = async (f: () => Promise<unknown>) => f().then(() => null, (e: Error) => e.message)

const rules = await rulesPrompt(), toy = await toyPrompt()
check('the rules prompt has no toy kit', !rules.includes('Toys.') && !rules.includes('registerGadget'), rules.length)
check('the toy prompt quotes the made kinds and not flame, hinge or piston', ["kind: 'pivot'", "kind: 'sensor'", "kind: 'counter'"].every((k) => toy.includes(k)) && !["kind: 'flame'", "kind: 'hinge'", "kind: 'piston'"].some((k) => toy.includes(k)))
check('the toy prompt quotes the logic parts a made game is wired from, a game as a second example, and not the kinds that reach past the toy (#108)', ["kind: 'game'", "kind: 'tilt'", "kind: 'timer'", "kind: 'lamp'", "kind: 'bell'", "kind: 'restart'", '"label":"Skittles"'].every((k) => toy.includes(k)) && !["kind: 'spawner'", "kind: 'freeze'", "kind: 'shake'"].some((k) => toy.includes(k)), { length: toy.length })
check('the toy prompt is the rules prompt and more', toy.startsWith(rules) && toy.length > rules.length * 2, { rules: rules.length, toy: toy.length })

// #106: the invention prompt quotes the code's contract as the home has it, and the host lets a mechanic through by shape and size only.
const invent = await inventPrompt()
const contract = await readFile(join(ENGINE, '..', 'invent', 'contract.ts'), 'utf8')
check('the invention prompt quotes the contract file whole, the made kinds, and a worked example', invent.includes(contract) && invent.includes("kind: 'counter'") && !invent.includes("kind: 'flame'") && invent.includes('"kind":"invented"'), invent.length)
const table = [{ id: 'table', label: 'the kitchen table', half: [0.25, 0.17] as [number, number], height: 0.45 }]
const good = checkInventReply(stubMechanic('make a magnet', table))
check('a mechanic answer passes with its toy, kind and code', 'mechanic' in good && good.mechanic.toy.on === 'table' && good.mechanic.code.includes('function step') && typeof good.mechanic.kind === 'object', good)
const reason = (raw: string) => { const r = checkInventReply(raw); return 'reason' in r ? r.reason : '' }
const m = { kind: {}, toy: { label: 'X', parts: [{}], gadgets: [], wires: [] }, code: 'function step() {}' }
check('an answer with no code, no JSON, no kind, no toy, or too much code is refused', [
  reason('Sure! A magnet.'), reason('```json\n{"note": "x"}\n```'), reason('```js\nfunction step() {}\n```'), reason(mechanicAnswer('n', 'table', { ...m, kind: 'magnet' })),
  reason(mechanicAnswer('n', 'table', { ...m, toy: { label: 'X' } })), reason(mechanicAnswer('n', 'table', { ...m, code: 'x'.repeat(LIMITS.code + 1) })),
].every(Boolean))
const route = (text: string) => checkRouted(stubRoute({ text, primary: 'Pip', villagers: [], library: [] }), [], [])
const routed = route('make a magnet')
const odd = checkRouted('{"route": "physics", "make": "rocket", "say": "x"}', [], [])
check('"make a magnet" routes to physics to make a mechanic, and an unknown thing to make is dropped', 'routed' in routed && routed.routed.route === 'physics' && routed.routed.make === 'mechanic' && 'routed' in odd && odd.routed.make === undefined, { routed, odd })

const dir = await mkdtemp(join(tmpdir(), 'engine-'))
try {
  await cp(ENGINE, dir, { recursive: true })
  check('a missing start line throws', /no line matching/.test((await throws(() => engineText('toy.ts', /^nothing like this/, undefined, dir))) ?? ''))
  check('a missing end line throws', /no line matching/.test((await throws(() => engineText('toy.ts', /^import/, /^nothing like this/, dir))) ?? ''))
  const gadgets = await readFile(join(dir, 'gadgets.ts'), 'utf8')
  await writeFile(join(dir, 'gadgets.ts'), gadgets.replaceAll('registerGadget({', 'addGadget({'))
  check('a renamed registration call throws instead of quoting gadgets.ts whole', /no line matching/.test((await throws(() => madeKit(dir))) ?? ''))
  await writeFile(join(dir, 'gadgets.ts'), gadgets.replace("kind: 'pivot'", "kind: 'swivel'"))
  check('a made kind the kit no longer registers throws', /registers no pivot/.test((await throws(() => madeKit(dir))) ?? ''))
} finally {
  await rm(dir, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
