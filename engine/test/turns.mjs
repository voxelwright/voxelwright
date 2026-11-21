// The turns on the GPU (kit.mjs `turn`, `quiet`), with no browser and none of this machine's real turns (#465): each
// case runs in a process of its own whose home is a fresh folder, so its places are its own.
//
//   node test/turns.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const kit = new URL('./kit.mjs', import.meta.url).href
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
/** Runs `body` (a module's code, with `turn`, `quiet`, `within` and `places` in scope) in a home of its own; what it prints, as JSON. */
const run = (body) => {
  const home = mkdtempSync(join(tmpdir(), 'engine-turns-'))
  try {
    const code = `import { turn, quiet } from ${JSON.stringify(kit)}
import { readdirSync } from 'node:fs'
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))])
const places = () => readdirSync(${JSON.stringify(join(home, '.village', 'engine', 'turns'))})
${body}
process.exit(0)`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HOME: home, ENGINE_TURN: '', ENGINE_TURNS: '2' }, encoding: 'utf8', timeout: 30_000 })
    if (r.status !== 0) throw new Error(r.stderr || `ended ${r.status}`)
    return JSON.parse(r.stdout.trim().split('\n').at(-1))
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// A check that holds a turn and asks for the GPU alone twice (test/sf.mjs does, once per timing): it once waited out
// the second time, holding its own place and watching for it to be given back.
const twice = run(`await turn()
const first = await within(quiet(), 5000); first?.()
const kept = { said: process.env.ENGINE_TURN, places: places().length }
const second = await within(quiet(), 5000); second?.()
console.log(JSON.stringify({ first: !!first, kept, second: !!second, after: places().length }))`)
check(twice.first, 'a check holding a turn has the GPU alone')
check(twice.kept.said === '1' && twice.kept.places === 1, 'giving that back keeps its own turn, still said')
check(twice.second, 'and it has the GPU alone again')
check(twice.after === 1, 'with its own turn held through both')

// Asked for with no turn held, every place is had and all of them given back.
const bare = run(`const all = await within(quiet(), 5000)
const during = places().length
all?.()
console.log(JSON.stringify({ had: !!all, during, after: places().length, said: process.env.ENGINE_TURN ?? null }))`)
check(bare.had && bare.during === 2, 'with no turn held, the GPU alone is every place')
check(bare.after === 0 && bare.said === null, 'and giving it back leaves nothing held or said')

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('turns: ok')
