// Every check with one command (#144): the core's tests, the types, and each check of the real
// page in the installed Chrome, the phone-shaped flight among them. The page checks share one
// server and one browser and run two at a time, so the times they print are not for quoting:
// `node test/bench.mjs` measures.
//
//   node test/all.mjs [--only falls,blast] [--jobs 2]
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, here, serve, turn } from './kit.mjs'

const only = arg('only', '').split(',').filter(Boolean), jobs = Number(arg('jobs', '2'))
const t0 = Date.now()
const built = spawnSync('npm', ['run', '-s', 'core'], { cwd: here, encoding: 'utf8' })
if (built.status !== 0) { console.error(built.stdout + built.stderr); console.error('FAILED: the core did not build'); process.exit(1) }

const server = await serve(), browser = await chromium.launchServer(CHROME)
const env = { ...process.env, ENGINE_KIT: JSON.stringify({ url: server.url, ws: browser.wsEndpoint() }) }
/** [name, command, arguments, whether it draws]. */
const checks = [
  ['core', 'cargo', ['test', '--release', '--quiet'], false, `${here}core`],
  ['types', 'npx', ['tsc', '--noEmit'], false],
  ['city', 'node', ['test/city.mjs'], true],
  ['blast', 'node', ['test/blast.mjs'], true],
  ['shadows', 'node', ['test/shadows.mjs'], true],
  ['falls', 'node', ['test/falls.mjs'], true],
  ['tools', 'node', ['test/tools.mjs'], true],
  ['chain', 'node', ['test/chain.mjs'], true],
  ['wand', 'node', ['test/wand.mjs'], true],
  ['spells', 'node', ['test/spells.mjs'], true],
  ['hands', 'node', ['test/hands.mjs'], true],
  ['sounded', 'node', ['test/sounded.mjs'], true],
  ['tuned', 'node', ['test/tuned.mjs'], true],
  ['aims', 'node', ['test/aims.mjs'], true],
  ['skips', 'node', ['test/skips.mjs'], true],
  ['hours', 'node', ['test/hours.mjs'], true],
  ['sea', 'node', ['test/sea.mjs'], true],
  ['water', 'node', ['test/water.mjs'], true],
  ['space', 'node', ['test/space.mjs'], true],
  ['far', 'node', ['test/far.mjs'], true],
  ['shared', 'node', ['test/shared.mjs'], true],
  ['people', 'node', ['test/people.mjs'], true],
  ['living', 'node', ['test/living.mjs'], true],
  ['driven', 'node', ['test/driven.mjs'], true],
  ['person', 'node', ['test/person.mjs'], true],
  ['powers', 'node', ['test/powers.mjs'], true],
  ['rules', 'node', ['test/rules.mjs'], true],
  ['realms', 'node', ['test/realms.mjs'], false],
  ['plugged', 'node', ['test/plugged.mjs'], false],
  ['plugins', 'node', ['test/plugins.mjs'], true],
  ['taken', 'node', ['test/taken.mjs'], true],
  ['moves', 'node', ['test/moves.mjs'], true],
  ['step', 'node', ['test/step.mjs'], true],
  ['about', 'node', ['test/about.mjs'], false],
  ['make', 'node', ['test/make.mjs'], false],
  ['helper', 'node', ['test/helper.mjs'], true],
  ['rulewrite', 'node', ['test/rulewrite.mjs'], false],
  ['sound', 'node', ['test/sound.mjs'], false],
  ['music', 'node', ['test/music.mjs'], false],
  ['heard', 'node', ['test/heard.mjs'], true],
  ['played', 'node', ['test/played.mjs'], true],
  ['flight', 'node', ['test/flight.mjs'], true],
  ['phone', 'node', ['test/flight.mjs', '--phone'], true],
  ['probe', 'node', ['test/probe.mjs', '--heat', '2'], true],
].filter((c) => !only.length || only.includes(c[0]))

const run = async ([name, command, args, draws, cwd = here]) => {
  // What draws waits its turn on the GPU with every other thread's checks (kit.mjs `turn`), and is told it has one.
  const back = draws ? await turn({ mine: false }) : () => {}
  return new Promise((resolve) => {
  const began = Date.now(), child = spawn(command, args, { cwd, env: draws ? { ...env, ENGINE_TURN: '1' } : env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.on('exit', (code) => {
    const ok = code === 0
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name.padEnd(8)} ${((Date.now() - began) / 1000).toFixed(0)} s`)
    if (!ok) {
      console.log(out.split('\n').slice(-40).map((l) => `    ${l}`).join('\n'))
      // All of what it said is kept: a check that fails beside the others and passes alone leaves nothing else to go on.
      const kept = join(tmpdir(), `engine-check-${name}-${Date.now()}.log`)
      writeFileSync(kept, out)
      console.log(`    all of it: ${kept}`)
    }
    back()
    resolve(ok)
  })
  })
}
// What does not draw runs beside what does; what draws takes turns, a few at a time.
const drawing = checks.filter((c) => c[3]), results = checks.filter((c) => !c[3]).map(run)
let next = 0
const lane = async () => { const mine = []; while (next < drawing.length) { const i = next++; mine.push([i, await run(drawing[i])]) } return mine }
const lanes = (await Promise.all(Array.from({ length: jobs }, lane))).flat().sort((a, b) => a[0] - b[0]).map((r) => r[1])
// A check that draws and failed beside others is run once more with the GPU to itself: some of them time things.
for (const [i, ok] of lanes.entries()) {
  if (ok) continue
  console.log(`again, alone: ${drawing[i][0]}`)
  lanes[i] = await run(drawing[i])
}
const all = [...(await Promise.all(results)), ...lanes]
await browser.close()
server.stop()
const failed = all.filter((ok) => !ok).length
console.log(`${failed ? `FAILED: ${failed} of ${all.length}` : `all ${all.length} ok`} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
process.exit(failed ? 1 : 0)
