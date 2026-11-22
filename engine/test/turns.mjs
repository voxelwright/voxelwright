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
/**
 * Runs `body` (a module's code, with `turn`, `quiet`, `within`, `places`, `ours`, `holders`, `begin`, `ready` and `last` in scope) in
 * a home of its own; what it prints, as JSON. `begin(code)` starts another such process in the same home (through a
 * shell, as npm starts a script) and `ready(child)` waits until it prints "ready".
 */
const run = (body, env = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'engine-turns-'))
  try {
    const head = `import { turn, quiet, holders } from ${JSON.stringify(kit)}
import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))])
const ours = () => holders().filter((h) => h.pid === process.pid).length
const places = () => { try { return readdirSync(${JSON.stringify(join(home, '.village', 'engine', 'turns'))}) } catch { return [] } }
const begin = (code, env = {}) => spawn('sh', ['-c', 'exec "$0" --input-type=module -e "$1"', process.execPath, HEAD + code], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
const last = (s) => { try { return JSON.parse(s.trim().split('\\n').at(-1)) } catch { return null } }
const ready = (child) => new Promise((done) => { let out = ''; child.stdout.on('data', (d) => { out += d; if (out.includes('ready')) done(out) }) })
`
    const code = `${head}const HEAD = ${JSON.stringify(head + 'const HEAD = "";\n')}\n${body}\nprocess.exit(0)`
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HOME: home, ENGINE_TURN: '', ENGINE_QUIET: '', ENGINE_TURNS: '2', ...env }, encoding: 'utf8', timeout: 60_000 })
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

// Nested: a process that has the GPU alone asks again (in itself, and in what it starts through a shell and another
// process, as a private wrapper round `npm run check` did on November 21 and then waited 90 minutes on itself).
const nested = run(`const outer = await within(quiet(), 5000)
const inner = await within(quiet(), 5000), during = places().length
inner?.()
const kept = places().length
const child = begin(\`const t = await within(turn(), 5000), q = await within(quiet(), 5000); console.log(JSON.stringify({ turn: !!t, quiet: !!q }))\`)
let said = ''; child.stdout.on('data', (d) => { said += d })
await new Promise((r) => child.on('exit', r))
outer?.()
console.log(JSON.stringify({ outer: !!outer, inner: !!inner, during, kept, child: last(said) ?? {}, after: places().length }))`)
check(nested.outer && nested.inner && nested.during === 2, 'quiet() inside quiet() in one process has the GPU alone at once')
check(nested.kept === 2, 'and giving the inner one back keeps the outer one whole')
check(nested.child.turn && nested.child.quiet, 'what a process that has the GPU alone starts, through a shell, has a turn and the GPU alone at once')
check(nested.after === 0, 'all given back after')

// Two checks run side by side by one run (test/all.mjs holds both places, each for one of them): neither has the GPU alone.
const siblings = run(`const a = await turn({ mine: false }), b = await turn({ mine: false })
const child = begin(\`const q = await quiet({ within: 2500 }); console.log(JSON.stringify({ alone: !!q }))\`, { ENGINE_TURN: '1' })
let said = ''; child.stdout.on('data', (d) => { said += d })
await new Promise((r) => child.on('exit', r))
a(); b()
console.log(JSON.stringify(last(said) ?? {}))`)
check(siblings.alone === false, 'a check given one of two turns its run holds does not have the GPU alone beside the other')

// Two processes that each hold a turn of their own and both ask for the GPU alone: once they waited on each other for good.
const pair = run(`const one = \`const t = await turn(); while (places().length < 2) await new Promise((r) => setTimeout(r, 50)); const idled = []; const q = await quiet({ idle: async (on) => { idled.push(on) } }); const at = Date.now(); await new Promise((r) => setTimeout(r, 300)); q(); console.log(JSON.stringify({ at, idled, kept: !!process.env.ENGINE_TURN })); t()\`
const a = begin(one), b = begin(one)
const out = await Promise.all([a, b].map((c) => new Promise((done) => { let s = ''; c.stdout.on('data', (d) => { s += d }); c.on('exit', () => done(s)) })))
console.log(JSON.stringify({ got: out.map(last), after: places().length }))`)
check(pair.got.every((g) => g?.kept), 'two that each hold a turn and want the GPU alone both have it, in turn, each its own turn kept after')
check(pair.got.every((g) => ['', 'true,false'].includes(String(g?.idled))) && pair.got.some((g) => g?.idled.length), `the one that gave its own turn back stopped drawing meanwhile (idle: ${pair.got.map((g) => JSON.stringify(g?.idled)).join(' and ')})`)
check(pair.after === 0, 'and nothing is left held')

// A holder killed outright (no way to give its turns back): what it held is free again.
const killed = run(`const holder = begin(\`await quiet(); console.log('ready'); setInterval(() => {}, 1000)\`)
await ready(holder)
const before = places().length
holder.kill('SIGKILL')
await new Promise((r) => holder.on('exit', r))
const all = await within(quiet(), 5000)
console.log(JSON.stringify({ before, had: !!all }))`)
check(killed.before === 2 && killed.had, 'turns held by a process that was killed are taken again')

// A wait on a live holder says who holds the turns, and fails after its limit (here 2 s; twenty minutes as it stands).
const stuck = run(`const holder = begin(\`await quiet(); console.log('ready'); setInterval(() => {}, 1000)\`)
await ready(holder)
const named = holders()
let error = null
try { await turn() } catch (e) { error = e.message }
const soft = await quiet({ within: 500 })
holder.kill()
console.log(JSON.stringify({ holder: holder.pid, named, error, soft }))`, { ENGINE_TURN_WAIT: '2' })
check(stuck.named.length === 2 && stuck.named.every((h) => h.pid === stuck.holder && /node/.test(h.what) && h.since), `the holders are named: pid, what it runs, since when (${JSON.stringify(stuck.named[0])})`)
check(!!stuck.error && stuck.error.includes(`pid ${stuck.holder}`), `a wait past its limit fails, naming the holder: ${stuck.error?.slice(0, 160)}`)
check(stuck.soft === null, 'quiet({ within }) gives up after that and returns nothing')

// Giving up keeps nothing taken on the way, and leaves the process's own turn held (taken again if it was given back
// while waiting), so that a later quiet() does not count one place short.
const gaveUp = run(`const holder = begin(\`await turn(); console.log('ready'); setInterval(() => {}, 1000)\`)
await ready(holder)
let threw = false
try { await quiet() } catch { threw = true }
const keptAfterThrow = ours()
const t = await turn()
const t0 = Date.now(), soft = await quiet({ within: 1500 }), took = Date.now() - t0
await new Promise((r) => setTimeout(r, 1500))
const ownAgain = ours(), said = process.env.ENGINE_TURN
const second = await quiet({ within: 1000 })
holder.kill(); await new Promise((r) => holder.on('exit', r))
const third = await within(quiet(), 5000), during = ours()
third?.()
console.log(JSON.stringify({ threw, keptAfterThrow, soft, took, ownAgain, said, second: !!second, third: !!third, during, after: ours() }))`, { ENGINE_TURN_WAIT: '2' })
check(gaveUp.threw && gaveUp.keptAfterThrow === 0, `a wait that fails at its limit keeps no place it took on the way (${gaveUp.keptAfterThrow} kept)`)
check(gaveUp.soft === null && gaveUp.took < 2500, `quiet({ within: 1500 }) gives up on time: ${gaveUp.took} ms`)
check(gaveUp.ownAgain === 1 && gaveUp.said === '1', 'and the own turn it gave back while waiting is held again')
check(!gaveUp.second, 'so a second quiet() with the other place still held is not alone')
check(gaveUp.third && gaveUp.during === 2 && gaveUp.after === 1, 'once that is given back, quiet() has both, and keeps its own turn after')

// One that wants every turn is not starved by checks handing turns on to each other: a single turn asked for after it
// waits until it has had them.
const fair = run(`const hold = (ms) => begin(\`const t = await turn(); console.log('ready'); await new Promise((r) => setTimeout(r, \${ms})); t()\`)
const a = hold(1500), b = hold(3000)
await Promise.all([ready(a), ready(b)])
let alone = 0, single = 0
const asks = (async () => { const q = await quiet(); alone = Date.now(); await new Promise((r) => setTimeout(r, 500)); q() })()
await new Promise((r) => setTimeout(r, 300))
const later = begin(\`const t = await turn(); console.log(JSON.stringify({ at: Date.now() })); t()\`)
let said = ''; later.stdout.on('data', (d) => { said += d })
await asks; await new Promise((r) => later.on('exit', r))
single = last(said)?.at ?? 0
console.log(JSON.stringify({ alone, single }))`)
check(fair.alone > 0 && fair.single > fair.alone, `a turn asked for while another waits for every turn comes after it (${fair.single - fair.alone} ms after)`)

// A wait that gives up after giving its own turn to one that asked first has its own turn again before it throws.
const handed = run(`const first = begin(\`const t = await turn(); const q = await quiet(); console.log('ready'); await new Promise((r) => setTimeout(r, 3500)); q(); setInterval(() => {}, 1000)\`)
const t = await turn()
const { existsSync } = await import('node:fs')
while (!existsSync(process.env.HOME + '/.village/engine/turns-wanted/' + first.pid)) await new Promise((r) => setTimeout(r, 50))
const idled = []
let threw = false
try { await quiet({ idle: async (on) => { idled.push(on) } }) } catch { threw = true }
const own = ours()
first.kill()
console.log(JSON.stringify({ threw, own, idled }))`, { ENGINE_TURN_WAIT: '2' })
check(handed.threw && handed.own === 1 && String(handed.idled) === 'true,false', `a wait that gave its own turn to an earlier one and then gave up has its turn again, drawing again after (${JSON.stringify(handed)})`)

// A wish and a place left by processes that are gone, their numbers now another process's, hold nothing up.
const reused = run(`const { spawn: start } = await import('node:child_process')
const { mkdirSync, writeFileSync, utimesSync, existsSync } = await import('node:fs')
const other = start('sleep', ['30'])
await new Promise((r) => setTimeout(r, 300))
const engine = process.env.HOME + '/.village/engine'
mkdirSync(engine + '/turns-wanted', { recursive: true }); mkdirSync(engine + '/turns/0', { recursive: true })
writeFileSync(engine + '/turns-wanted/' + other.pid, String(Date.now() - 5000))
writeFileSync(engine + '/turns/0/pid', String(other.pid))
const hourAgo = new Date(Date.now() - 3600_000); utimesSync(engine + '/turns/0/pid', hourAgo, hourAgo)
const t = await within(turn(), 5000), q = await within(quiet(), 5000)
const cleared = !existsSync(engine + '/turns-wanted/' + other.pid)
q?.(); t?.(); other.kill()
console.log(JSON.stringify({ turn: !!t, alone: !!q, cleared }))`)
check(reused.turn && reused.alone && reused.cleared, `a wish and a place said before their process's number was taken by another are cleared, not waited on (${JSON.stringify(reused)})`)

// One waiting on a turn lent to it (ENGINE_TURN) cannot give it back: it is not held up for good by one that asked
// first and needs that very turn (this runner holds it for the child; the earlier one holds the other, its own).
const lentLater = run(`const lend = await turn({ mine: false }), t0 = Date.now()
const earlier = begin(\`const t = await turn(); const q = await quiet(); console.log(JSON.stringify({ at: Date.now() })); q(); t()\`)
const { existsSync } = await import('node:fs')
while (!existsSync(process.env.HOME + '/.village/engine/turns-wanted/' + earlier.pid)) await new Promise((r) => setTimeout(r, 50))
const child = begin(\`const q = await quiet(); console.log(JSON.stringify({ at: Date.now() })); q()\`, { ENGINE_TURN: '1' })
let childSaid = '', earlierSaid = ''
child.stdout.on('data', (d) => { childSaid += d }); earlier.stdout.on('data', (d) => { earlierSaid += d })
await new Promise((r) => child.on('exit', r)); lend()
await new Promise((r) => earlier.on('exit', r))
console.log(JSON.stringify({ child: (last(childSaid)?.at ?? 0) - t0, earlier: (last(earlierSaid)?.at ?? 0) - t0 }))`, { ENGINE_TURN_WATCH: '2', ENGINE_TURN_WAIT: '30' })
check(lentLater.child > 0 && lentLater.child < 8000 && lentLater.earlier > lentLater.child, `a check on a lent turn has the GPU alone ${lentLater.child} ms after asking behind an earlier one that needs that turn, which has it after (${lentLater.earlier} ms)`)

// One that asked first, holding a turn of its own, has a place that comes free before one that asked later with none.
const order = run(`const { existsSync } = await import('node:fs')
const wanted = (c) => existsSync(process.env.HOME + '/.village/engine/turns-wanted/' + c.pid)
const holder = begin(\`const t = await turn(); console.log('ready'); await new Promise((r) => setTimeout(r, 2500)); t()\`)
await ready(holder)
const t0 = Date.now(), times = {}
const earlier = begin(\`const t = await turn(); const q = await quiet(); console.log(JSON.stringify({ at: Date.now() })); await new Promise((r) => setTimeout(r, 300)); q(); t()\`)
while (!wanted(earlier)) await new Promise((r) => setTimeout(r, 20))
const later = begin(\`const q = await quiet(); console.log(JSON.stringify({ at: Date.now() })); q()\`)
for (const [name, c] of [['earlier', earlier], ['later', later]]) { let s = ''; c.stdout.on('data', (d) => { s += d }); times[name] = new Promise((r) => c.on('exit', () => r((last(s)?.at ?? 0) - t0))) }
console.log(JSON.stringify({ earlier: await times.earlier, later: await times.later }))`, { ENGINE_TURN_WATCH: '6' })
check(order.earlier > 0 && order.earlier < 5000 && order.later > order.earlier, `the earlier waiter with a turn of its own has the GPU alone first (${order.earlier} ms), the later one with none after (${order.later} ms)`)

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('turns: ok')
