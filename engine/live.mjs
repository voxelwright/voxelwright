// Puts what is on main where the owner's link looks (#144). The link (a tailnet-only
// `tailscale serve` to port 5740 on this machine) used to serve the working tree, so it broke
// whenever work was half done. Now it serves a checkout of its own, moved to origin/main by
// this script after each merge: the core built there, the server started again from there.
//
//   node live.mjs [--port 5740] [--at ~/.t3/worktrees/Village/engine-live]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const port = arg('port', '5740'), live = arg('at', join(homedir(), '.t3', 'worktrees', 'Village', 'engine-live'))
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

run('git', ['fetch', '-q', 'origin', 'main'], repo)
if (!existsSync(live)) run('git', ['worktree', 'add', '--detach', live, 'origin/main'], repo)
else run('git', ['checkout', '-q', '--detach', 'origin/main'], live)
const at = run('git', ['log', '--oneline', '-1'], live)
// What the server itself needs to run (the interpreter rules run in, #264): installed as the lock file has it.
run('npm', ['ci', '--omit=dev', '--silent'], join(live, 'engine'))
run('npm', ['run', '-s', 'core'], join(live, 'engine'))

// Whatever of ours is listening there now makes way. Anything else on the port is left alone and said.
let old = ''
try { old = run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']) } catch { /* nothing listening */ }
for (const pid of old.split('\n').filter(Boolean)) {
  const what = run('ps', ['-o', 'command=', '-p', pid])
  if (!/node .*serve\.mjs/.test(what)) { console.error(`port ${port} is held by something else (${what}); left alone`); process.exit(1) }
  process.kill(Number(pid))
}
const logs = join(homedir(), '.village', 'engine')
mkdirSync(logs, { recursive: true })
const log = openSync(join(logs, 'serve.log'), 'a')
// The link keeps one shared world (`?shared=1` on the address), in a file that outlives each merge.
spawn('node', ['serve.mjs', '--port', port, '--world', join(logs, 'world', 'main.log')], { cwd: join(live, 'engine'), detached: true, stdio: ['ignore', log, log] }).unref()
console.log(`the link now serves ${at} from ${live}`)
