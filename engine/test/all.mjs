// Every check with one command (#144): the core's tests, the types, and each check of the real
// page in the installed Chrome, the phone-shaped flight among them. The page checks share one
// server and one browser and run a few at a time, so the times they print are not for quoting:
// `node test/bench.mjs` measures.
//
//   node test/all.mjs [--only falls,blast] [--jobs 3]
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, here, serve } from './kit.mjs'

const only = arg('only', '').split(',').filter(Boolean), jobs = Number(arg('jobs', '3'))
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
  ['flight', 'node', ['test/flight.mjs'], true],
  ['phone', 'node', ['test/flight.mjs', '--phone'], true],
  ['probe', 'node', ['test/probe.mjs', '--heat', '2'], true],
].filter((c) => !only.length || only.includes(c[0]))

const run = ([name, command, args, , cwd = here]) => new Promise((resolve) => {
  const began = Date.now(), child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.on('exit', (code) => {
    const ok = code === 0
    console.log(`${ok ? 'ok    ' : 'FAILED'} ${name.padEnd(8)} ${((Date.now() - began) / 1000).toFixed(0)} s`)
    if (!ok) console.log(out.split('\n').slice(-40).map((l) => `    ${l}`).join('\n'))
    resolve(ok)
  })
})
// What does not draw runs beside what does; what draws takes turns, a few at a time.
const drawing = checks.filter((c) => c[3]), results = checks.filter((c) => !c[3]).map(run)
let next = 0
const lane = async () => { const mine = []; while (next < drawing.length) mine.push(await run(drawing[next++])); return mine }
const lanes = await Promise.all(Array.from({ length: jobs }, lane))
const all = [...(await Promise.all(results)), ...lanes.flat()]
await browser.close()
server.stop()
const failed = all.filter((ok) => !ok).length
console.log(`${failed ? `FAILED: ${failed} of ${all.length}` : `all ${all.length} ok`} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
process.exit(failed ? 1 : 0)
