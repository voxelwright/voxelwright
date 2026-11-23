// `npm run sf` (#450): the SF realm from static files (test/sf.mjs, which builds it), then its look and controls
// (test/sf-look.mjs) and its loader (test/sf-loader.mjs). Arguments go to test/sf.mjs; test/sf-look.mjs is given `--headed` alone (run it by itself for
// its own flags). `--changed` runs only what covers the branch's change against
// origin/main, uncommitted files too (test/changed.mjs says which and why; `--list` only says), and names the closer
// checks of the realm's parts it concerns (test/sf-boards.mjs and its kind), which this does not run. For iterating:
// run everything once on the head you report.
//
//   npm run sf [-- --changed [--base <ref>] [--list]] [-- <test/sf.mjs's own flags>]
import { spawnSync } from 'node:child_process'
import { arg, has, here } from './kit.mjs'
import { pick } from './changed.mjs'

const passed = process.argv.slice(2).filter((a, i, all) => a !== '--changed' && a !== '--list' && a !== '--base' && all[i - 1] !== '--base')
let run = ['sf', 'sf-look', 'sf-loader']
if (has('changed')) {
  const p = pick(run, arg('base', 'origin/main'))
  const closer = p.elsewhere.filter((n) => /^sf-/.test(n))
  if (closer.length) console.log(`--changed: it concerns ${closer.map((n) => `test/${n}.mjs`).join(', ')} too, which npm run sf does not run`)
  run = p.run
}
if (has('list')) { console.log(`${has('changed') ? '' : 'all: '}${run.join(', ') || 'nothing'}`); process.exit(0) }
if (!run.length) { console.log('nothing to run'); process.exit(0) }
const node = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: here, stdio: 'inherit' }).status ?? 1
if (run.includes('sf') && node('test/sf.mjs', passed) !== 0) process.exit(1)
// The look and the controls, on the folder test/sf.mjs has just built (dist-sf, the one sf-look reads); it builds its
// own where test/sf.mjs did not run or built another (`--dist`).
const built = (run.includes('sf') || passed.includes('--no-build')) && !passed.includes('--dist')
if (run.includes('sf-look') && node('test/sf-look.mjs', [...(built ? ['--no-build'] : []), '--only', 'look,controls', ...(passed.includes('--headed') ? ['--headed'] : [])]) !== 0) process.exit(1)
if (run.includes('sf-loader')) process.exit(node('test/sf-loader.mjs', [...(built || run.includes('sf-look') ? ['--no-build'] : []), ...(passed.includes('--headed') ? ['--headed'] : [])]))
