// Has a running game pick up the engine's plugins as they now are (#264, plugins.mjs), with nothing started again.
//
//   node plug.mjs --port 5800                    the server on that port looks at its own plugins folder again
//   node plug.mjs --port 5800 --at <checkout>    first moves that checkout (the one the server runs from) to
//                                                origin/main, if what main has since changed is plugins and no more
//
// What a game runs is what is on main: a plugin is merged first, and then this is run. If main has also changed
// something that is not a plugin (the server, the world's process, the page), only the plugins folder is brought
// to main and this says what waits for the server to be started again (`node live.mjs` does that for the owner's
// link). A core built again is taken with `POST /core/look`.
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
  const plugins = changed.length - other.length
  if (other.length) {
    // Main has moved on in more than plugins: those wait for the server to be started again. The plugins are taken
    // now, as main has them, into this checkout as it stands. One that needs something newer than the running
    // server has is refused by it in words, and the version that was in goes on.
    if (plugins) git('checkout', 'origin/main', '--', 'engine/plugins')
    console.log(`main has also changed ${other.length} files that are not plugins (${other.slice(0, 4).join(', ')}${other.length > 4 ? ', ...' : ''}): those wait until the server is started again. ${plugins ? `The plugins are taken now (${plugins} files, ${(performance.now() - began).toFixed(0)} ms)` : 'No plugin has changed'}`)
  } else if (changed.length) { git('checkout', '-q', '--detach', 'origin/main'); console.log(`the checkout is at ${git('log', '--oneline', '-1')} (${changed.length} files of plugins changed, ${(performance.now() - began).toFixed(0)} ms)`) }
  else console.log('main has nothing new for this checkout')
}
const t0 = performance.now(), res = await fetch(`http://127.0.0.1:${port}/plugins/look`, { method: 'POST' })
if (!res.ok) { console.error(`the server would not look: ${res.status} ${await res.text()}`); process.exit(1) }
const r = await res.json()
for (const p of r.plugins) console.log(`  ${p.name.padEnd(12)} ${p.error ? `NOT IN: ${p.error}` : `${p.does.length ? `rules can ${p.does.join(', ')}` : 'nothing for rules'}${p.page ? '; has a page side' : ''}`}`)
for (const w of r.worlds) console.log(`  the world ${w.realm} took ${w.loads.length ? w.loads.map((l) => `${l.name} in ${l.ms} ms`).join(', ') : 'nothing new'}`)
console.log(`picked up in ${(performance.now() - t0).toFixed(0)} ms, with nothing started again`)
if (r.plugins.some((p) => p.error)) process.exit(1)
