// Has a running game pick up the engine's plugins as they now are (#264, plugins.mjs), with nothing started again.
//
//   node plug.mjs --port 5800                    the server on that port looks at its own plugins folder again
//   node plug.mjs --port 5800 --at <checkout>    first moves that checkout (the one the server runs from) to
//                                                origin/main, if what main has since changed is plugins and no more
//
// What a game runs is what is on main: a plugin is merged first, and then this is run. If main has also changed
// something that is not a plugin (the server, the world's process, the page, the core), the checkout is left where
// it is and this says what needs the server started again (`node live.mjs` does that for the owner's link).
import { execFileSync } from 'node:child_process'

const arg = (name) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined }
const port = arg('port'), at = arg('at')
if (!port) { console.error('say which game: --port <the port its server listens on>'); process.exit(2) }
const git = (...args) => execFileSync('git', args, { cwd: at, encoding: 'utf8' }).trim()
const began = performance.now()
if (at) {
  git('fetch', '-q', 'origin', 'main')
  const changed = git('diff', '--name-only', 'HEAD', 'origin/main').split('\n').filter(Boolean)
  const other = changed.filter((f) => !f.startsWith('engine/plugins/'))
  if (other.length) { console.error(`main has changed more than plugins since ${git('log', '--oneline', '-1')}: the server must be started again for\n  ${other.slice(0, 20).join('\n  ')}${other.length > 20 ? `\n  and ${other.length - 20} more` : ''}`); process.exit(3) }
  if (changed.length) { git('checkout', '-q', '--detach', 'origin/main'); console.log(`the checkout is at ${git('log', '--oneline', '-1')} (${changed.length} files of plugins changed, ${(performance.now() - began).toFixed(0)} ms)`) }
  else console.log('main has nothing new for this checkout')
}
const t0 = performance.now(), res = await fetch(`http://127.0.0.1:${port}/plugins/look`, { method: 'POST' })
if (!res.ok) { console.error(`the server would not look: ${res.status} ${await res.text()}`); process.exit(1) }
const r = await res.json()
for (const p of r.plugins) console.log(`  ${p.name.padEnd(12)} ${p.error ? `NOT IN: ${p.error}` : `${p.does.length ? `rules can ${p.does.join(', ')}` : 'nothing for rules'}${p.page ? '; has a page side' : ''}`}`)
for (const w of r.worlds) console.log(`  the world ${w.realm} took ${w.loads.length ? w.loads.map((l) => `${l.name} in ${l.ms} ms`).join(', ') : 'nothing new'}`)
console.log(`picked up in ${(performance.now() - t0).toFixed(0)} ms, with nothing started again`)
if (r.plugins.some((p) => p.error)) process.exit(1)
