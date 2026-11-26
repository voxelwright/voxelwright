// `npm run lobby` (#526): every check of playing in someone else's server, in one run, on ports of its own. The realm
// is built once (into `--dist`, dist-sf-lobby unless said: not dist-sf, which something may be serving) and each check
// that draws takes its turn on the GPU (test/kit.mjs).
//
//   npm run lobby [-- --ports 6500] [--dist dist-sf-lobby] [--no-build] [--only door-silent,sf-lobbies] [--list]
//
// What runs, in order (the quick ones that need no page first):
//   arrival            where someone who joins is set down, and a host's place read as a stranger's (no page)
//   door-silent        joins that say nothing cannot shut a door (no page)
//   door               the door and two pages on the generated town
//   door-make          making in a lobby: a thing is its maker's
//   sf-lobbies         the list, joining, arriving, admins, on the SF realm
//   sf-lobbies-phone   the same on a phone's page
// Ports: --ports and the 50 after it (each check has ten). It ends 1 if any failed, and says which.
import { spawnSync } from 'node:child_process'
import { arg, has, here } from './kit.mjs'

const BASE = Number(arg('ports', '6500')), dist = arg('dist', 'dist-sf-lobby')
const ALL = [
  ['arrival', 'test/arrival.mjs', []],
  ['door-silent', 'test/door-silent.mjs', ['--ports', String(BASE)]],
  ['door', 'test/door.mjs', ['--ports', String(BASE + 10), '--release', dist]],
  ['door-make', 'test/door-make.mjs', ['--ports', String(BASE + 20), '--release', dist]],
  ['sf-lobbies', 'test/sf-lobbies.mjs', ['--ports', String(BASE + 30), '--release', dist]],
  ['sf-lobbies-phone', 'test/sf-lobbies.mjs', ['--ports', String(BASE + 40), '--release', dist, '--phone']],
]
const only = arg('only', '').split(',').filter(Boolean)
const unknown = only.filter((n) => !ALL.some(([name]) => name === n))
if (unknown.length) { console.error(`no such check: ${unknown.join(', ')} (there are: ${ALL.map(([n]) => n).join(', ')})`); process.exit(2) }
const run = ALL.filter(([name]) => !only.length || only.includes(name))
if (has('list')) { console.log(run.map(([n]) => n).join(', ')); process.exit(0) }

// (The door's checks read the release from the built realm too: in a checkout with no dist-sf they did not start.)
if (run.some(([, , args]) => args.includes('--release')) && !has('no-build')) {
  console.log(`· the realm, built into ${dist}`)
  const built = spawnSync(process.execPath, ['sf/build.mjs', '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(`${built.stdout ?? ''}${built.stderr ?? ''}`.slice(-2000)); console.error('the realm did not build'); process.exit(1) }
}
const failed = []
for (const [name, script, args] of run) {
  console.log(`\n· ${name}`)
  const from = Date.now(), status = spawnSync(process.execPath, [script, ...args], { cwd: here, stdio: 'inherit' }).status ?? 1
  console.log(`· ${name}: ${status === 0 ? 'passed' : 'FAILED'} in ${Math.round((Date.now() - from) / 1000)} s`)
  if (status !== 0) failed.push(name)
}
console.log(`\nlobby: ${run.length - failed.length} passed, ${failed.length} failed${failed.length ? ` (${failed.join(', ')})` : ''}`)
process.exit(failed.length ? 1 : 0)
