// The physics prompts (#88): the rules prompt stays short, the toy prompt quotes only the kinds a
// made toy may use, and a renamed anchor in an engine file breaks the prompt loudly instead of
// quoting a whole file. Usage: npm run check-physics-prompt
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineText, madeKit, rulesPrompt, toyPrompt } from '../src/villager-physics.ts'

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
check('the toy prompt is the rules prompt and more', toy.startsWith(rules) && toy.length > rules.length * 2, { rules: rules.length, toy: toy.length })

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
