// Every engine plugin's own check (#264, plugins.mjs), one after another: `plugins/<name>/check.mjs` for each
// folder that has one. A plugin with a world side and no check fails here: nothing goes in unchecked.
//
//   node test/plugged.mjs [--only look,gone]
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { found } from '../plugins.mjs'
import { arg, here } from './kit.mjs'

const only = arg('only', '').split(',').filter(Boolean), failed = []
for (const p of found(join(here, 'plugins'))) {
  if (only.length && !only.includes(p.name)) continue
  const check = join(here, 'plugins', p.name, 'check.mjs')
  if (p.error) { console.log(`FAILED ${p.name}: ${p.error}`); failed.push(p.name); continue }
  if (!existsSync(check)) { console.log(`FAILED ${p.name}: it has no check.mjs`); failed.push(p.name); continue }
  if (p.world && !p.guide) { console.log(`FAILED ${p.name}: it has no guide.txt, so no model would ever use it`); failed.push(p.name); continue }
  const r = spawnSync('node', [check], { cwd: here, encoding: 'utf8', timeout: 300_000 })
  console.log(r.stdout.split('\n').filter((l) => l.trim()).map((l) => `  ${l}`).join('\n'))
  if (r.status !== 0) { console.log(r.stderr.split('\n').slice(-12).join('\n')); failed.push(p.name) }
}
if (failed.length) { console.error(`FAILED: ${failed.join(', ')}`); process.exit(1) }
console.log('plugged: ok')
