// Every check with one command (#144): the core's tests, the types, and each check of the real
// page in the installed Chrome, the phone-shaped flight among them. The page checks share one
// server and one browser and run two at a time, so the times they print are not for quoting:
// `node test/bench.mjs` measures. `--changed` runs only the checks that cover what the branch changed against
// origin/main, uncommitted files too (test/changed.mjs says which and why; `--list` only says): for iterating. Run
// everything once on the head you report.
//
//   node test/all.mjs [--only falls,blast] [--changed [--base <ref>] [--list]] [--jobs 2]
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, hasEveryTurn, here, serve, turn } from './kit.mjs'
import { pick } from './changed.mjs'

const only = arg('only', '').split(',').filter(Boolean)
// Run under a process that holds every turn on the GPU (a wrapper's `quiet`), checks that draw go one at a time: two
// side by side would each take the GPU for its own.
const jobs = hasEveryTurn() ? 1 : Number(arg('jobs', '2'))
if (hasEveryTurn()) console.log('every turn on the GPU is held for this run: checks that draw go one at a time')
const t0 = Date.now()
/** [name, command, arguments, whether it draws]. */
let checks = [
  ['core', 'cargo', ['test', '--release', '--quiet'], false, `${here}core`],
  ['types', 'npx', ['tsc', '--noEmit'], false],
  ['whole', 'node', ['test/whole.mjs'], false],
  ['place', 'node', ['test/place.mjs'], false],
  ['placed', 'node', ['test/placed.mjs'], true],
  ['director', 'node', ['test/director.mjs'], false],
  ['city', 'node', ['test/city.mjs'], true],
  ['blast', 'node', ['test/blast.mjs'], true],
  ['shadows', 'node', ['test/shadows.mjs'], true],
  ['glass', 'node', ['test/glass.mjs'], true],
  ['falls', 'node', ['test/falls.mjs'], true],
  ['tools', 'node', ['test/tools.mjs'], true],
  ['chain', 'node', ['test/chain.mjs'], true],
  ['wand', 'node', ['test/wand.mjs'], true],
  ['spells', 'node', ['test/spells.mjs'], true],
  ['keys', 'node', ['test/keys.mjs'], false],
  ['gamepad', 'node', ['test/gamepad.mjs'], false],
  ['pwa', 'node', ['test/pwa.mjs'], false],
  ['drive-cam', 'node', ['test/drive-cam.mjs'], false],
  ['turns', 'node', ['test/turns.mjs'], false],
  ['hands', 'node', ['test/hands.mjs'], true],
  ['hold', 'node', ['test/hold.mjs'], true],
  ['back', 'node', ['test/back.mjs'], true],
  ['chase', 'node', ['test/chase.mjs'], false],
  ['conjure', 'node', ['test/conjure.mjs'], true],
  ['judged', 'node', ['test/judged.mjs'], false],
  ['sounded', 'node', ['test/sounded.mjs'], true],
  ['tuned', 'node', ['test/tuned.mjs'], true],
  ['inrealm', 'node', ['test/inrealm.mjs'], true],
  ['follows', 'node', ['test/follows.mjs'], true],
  ['aims', 'node', ['test/aims.mjs'], true],
  ['skips', 'node', ['test/skips.mjs'], true],
  ['hours', 'node', ['test/hours.mjs'], true],
  ['sea', 'node', ['test/sea.mjs'], true],
  ['water', 'node', ['test/water.mjs'], true],
  ['space', 'node', ['test/space.mjs'], true],
  ['far', 'node', ['test/far.mjs'], true],
  ['city-glass', 'node', ['test/city-glass.mjs'], false],
  ['far-ground', 'node', ['test/far-ground.mjs'], false],
  ['tile-sharing', 'node', ['test/tile-sharing.mjs'], false],
  ['landmark-audit', 'node', ['sf/landmark-audit.mjs'], false],
  ['shared', 'node', ['test/shared.mjs'], true],
  ['people', 'node', ['test/people.mjs'], true],
  ['living', 'node', ['test/living.mjs'], true],
  ['driven', 'node', ['test/driven.mjs'], true],
  ['fine-living', 'node', ['test/fine-living.mjs'], true],
  ['seat-view', 'node', ['test/seat-view.mjs'], true],
  ['deform', 'node', ['test/deform.mjs'], true],
  ['dents', 'node', ['test/dents.mjs'], true],
  ['crash-stack', 'node', ['test/crash-stack.mjs'], true],
  ['robotaxi-shape', 'node', ['test/robotaxi-shape.mjs'], false],
  ['sculpt-cars', 'node', ['test/sculpt-cars.mjs'], false],
  ['drives', 'node', ['test/drives.mjs'], true],
  ['person', 'node', ['test/person.mjs'], true],
  ['powers', 'node', ['test/powers.mjs'], true],
  ['blows', 'node', ['test/blows.mjs'], true],
  ['ghost', 'node', ['test/ghost.mjs'], false],
  ['sees', 'node', ['test/sees.mjs'], false],
  ['brings', 'node', ['test/brings.mjs'], false],
  ['tough', 'node', ['test/tough.mjs'], false],
  ['course', 'node', ['test/course.mjs'], false],
  ['rules', 'node', ['test/rules.mjs'], true],
  ['realms', 'node', ['test/realms.mjs'], false],
  ['arrival', 'node', ['test/arrival.mjs'], false],
  ['plugged', 'node', ['test/plugged.mjs'], false],
  ['plugins', 'node', ['test/plugins.mjs'], true],
  ['swap', 'node', ['test/swap.mjs'], true],
  ['workshop', 'node', ['test/workshop.mjs'], true],
  ['telemetry', 'node', ['test/telemetry.mjs'], true],
  ['studio', 'node', ['test/studio.mjs'], true],
  ['worker-resilience', 'node', ['test/worker-resilience.mjs'], false],
  ['cable-overlap', 'node', ['test/cable-overlap.mjs'], false],
  ['taken', 'node', ['test/taken.mjs'], true],
  ['moves', 'node', ['test/moves.mjs'], true],
  ['step', 'node', ['test/step.mjs'], true],
  ['about', 'node', ['test/about.mjs'], false],
  ['apart', 'node', ['test/apart.mjs'], false],
  ['blocks', 'node', ['test/blocks.mjs'], true],
  ['upright', 'node', ['test/upright.mjs'], false],
  ['able', 'node', ['test/able.mjs'], false],
  ['mind', 'node', ['test/mind.mjs'], true],
  ['portal', 'node', ['test/portal.mjs'], true],
  ['wheel', 'node', ['test/wheel.mjs'], true],
  ['make', 'node', ['test/make.mjs'], false],
  ['fine', 'node', ['test/fine.mjs'], true],
  ['helper', 'node', ['test/helper.mjs'], true],
  ['kept', 'node', ['test/kept.mjs'], true],
  ['kept-car', 'node', ['test/kept-car.mjs'], true],
  ['smooth-cars', 'node', ['test/smooth-cars.mjs', '--page'], true],
  ['street', 'node', ['test/street.mjs'], true],
  ['neighborhood', 'node', ['test/neighborhood.mjs'], false],
  ['made-cars', 'node', ['test/made-cars.mjs'], true],
  ['drawn', 'node', ['test/drawn.mjs'], true],
  ['drivable', 'node', ['test/drivable.mjs'], false],
  ['keys-stay', 'node', ['test/keys-stay.mjs'], true],
  ['words', 'node', ['test/words.mjs'], false],
  ['models', 'node', ['test/models.mjs'], false],
  ['client-security', 'node', ['test/client-security.mjs'], false],
  ['said', 'node', ['test/said.mjs'], true],
  ['rulewrite', 'node', ['test/rulewrite.mjs'], false],
  ['sound', 'node', ['test/sound.mjs'], false],
  ['music', 'node', ['test/music.mjs'], false],
  ['radio', 'node', ['test/radio.mjs'], true],
  ['radio-providers', 'node', ['test/radio-providers.mjs'], true],
  ['heard', 'node', ['test/heard.mjs'], true],
  ['played', 'node', ['test/played.mjs'], true],
  ['drive-smooth', 'node', ['test/drive-smooth.mjs'], true],
  ['flight', 'node', ['test/flight.mjs'], true],
  ['phone', 'node', ['test/flight.mjs', '--phone'], true],
  ['probe', 'node', ['test/probe.mjs', '--heat', '2'], true],
].filter((c) => !only.length || only.includes(c[0]))
if (has('changed')) {
  const { run, elsewhere } = pick(checks.map(([name, , args]) => [name, /^test\/([a-z0-9-]+)\.mjs$/.exec(args[0])?.[1] ?? name]), arg('base', 'origin/main'))
  if (elsewhere.some((n) => /^sf(-|$)/.test(n))) console.log(`--changed: the SF realm's checks cover it too (npm run sf -- --changed)`)
  checks = checks.filter((c) => run.includes(c[0]))
}
if (has('list')) { console.log(`${has('changed') ? '' : `all ${checks.length}: `}${checks.map((c) => c[0]).join(', ') || 'nothing'}`); process.exit(0) }
if (!checks.length) { console.log('nothing to run'); process.exit(0) }

const built = spawnSync('npm', ['run', '-s', 'core'], { cwd: here, encoding: 'utf8' })
if (built.status !== 0) { console.error(built.stdout + built.stderr); console.error('FAILED: the core did not build'); process.exit(1) }
const server = await serve(), browser = await chromium.launchServer(CHROME)
const env = { ...process.env, ENGINE_KIT: JSON.stringify({ url: server.url, ws: browser.wsEndpoint() }) }

const run = async ([name, command, args, draws, cwd = here]) => {
  // What draws waits its turn on the GPU with every other thread's checks (kit.mjs `turn`), and is told it has one. A
  // wait that gives up (it names who held the turns) fails this check, and the run goes on to close what it started.
  let back = () => {}
  try { if (draws) back = await turn({ mine: false }) } catch (e) { console.log(`FAILED ${name.padEnd(8)} ${e.message}`); return false }
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
