#!/usr/bin/env node
// One command that runs every stub check once: node scripts/check.mjs (npm run check).
//   --list                 print the manifest and exit
//   --only a b c           run just these (names from scripts/checks.mjs), even ones the manifest skips
//   --ci                   skip the checks the manifest marks local-only
//   --webgl                run Chrome without WebGPU, software WebGL2 (what CI does; see scripts/chrome-webgl.mjs)
//   --jobs N               checks at once (default 4); --jobs 1 is the serial run
//   --timeout S            kill a check after S seconds (default 900)
// Ports: the runner picks free ports for every check and starts one shared dev server for the
// checks that open a page on one, so nothing depends on a fixed port. Full logs: .check/<name>.log.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { CHECKS } from './checks.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: 'boolean', default: false },
    only: { type: 'boolean', default: false },
    ci: { type: 'boolean', default: false },
    webgl: { type: 'boolean', default: false },
    jobs: { type: 'string', default: String(Math.min(4, cpus().length)) },
    timeout: { type: 'string', default: '900' },
  },
})

const names = new Set(CHECKS.map((c) => c.name))
const wanted = values.only ? positionals : null
if (wanted) {
  const unknown = wanted.filter((n) => !names.has(n))
  if (unknown.length || !wanted.length) {
    console.error(`${wanted.length ? 'unknown' : 'no'} check${unknown.length ? ': ' + unknown.join(', ') : ' names after --only'}. Try --list.`)
    process.exit(2)
  }
} else if (positionals.length) {
  console.error('names go after --only: npm run check -- --only kernel notebook')
  process.exit(2)
}

const status = (c) => (wanted?.includes(c.name) && !c.needsFile ? null : c.needsFile && !existsSync(join(root, c.needsFile)) ? `skip (${c.needsFile} is not in the repo)` : c.skip ? `skip (${c.skip})` : values.ci && c.local ? `skip (local only: ${c.local})` : null)

if (values.list) {
  const w = Math.max(...CHECKS.map((c) => c.name.length))
  for (const c of CHECKS) console.log(`${c.name.padEnd(w)}  ${c.cwd.padEnd(4)}  ${c.skip ? 'skip: ' + c.skip : c.local ? 'local-only: ' + c.local : 'ci'}${c.serial ? '  (alone)' : ''}${c.needs ? '  (dev server)' : ''}`)
  process.exit(0)
}

// A free port from the OS, never one of the ports a play server may hold.
const RESERVED = new Set([5181, 5190, 5296, 10000])
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => (RESERVED.has(port) ? resolve(freePort()) : resolve(port)))
    })
  })

const logDir = join(root, '.check')
rmSync(logDir, { recursive: true, force: true })
mkdirSync(logDir, { recursive: true })

const children = new Set()
// Everything below a process, found while it is still alive: a check may start its own dev server
// or stub host in a new process group, which a signal to the check's own group never reaches.
const below = (pid) => {
  let rows
  try { rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)) } catch { return [] }
  const found = new Set([pid])
  for (let grew = true; grew; ) { grew = false; for (const [p, parent] of rows) if (found.has(parent) && !found.has(p)) { found.add(p); grew = true } }
  found.delete(pid)
  return [...found]
}
const signal = (pid, sig) => { try { process.kill(pid, sig) } catch { /* gone */ } }
const killTree = (child, sig = 'SIGTERM') => {
  const rest = below(child.pid)
  signal(-child.pid, sig)
  for (const pid of rest) { signal(-pid, sig); signal(pid, sig) }
}
const stopAll = () => { for (const c of children) killTree(c, 'SIGKILL') }
process.on('exit', stopAll)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.error(`check: got ${sig}, stopping`); stopAll(); process.exit(130) })

function start(argv, cwd, env = {}) {
  const childEnv = { ...process.env, NO_COLOR: '1', ...env }
  delete childEnv.FORCE_COLOR // colour codes break the checks' "Local:" match on the dev server's line
  if (values.webgl) childEnv.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${join(root, 'scripts/chrome-webgl.mjs')}`.trim()
  const child = spawn(argv[0], argv.slice(1), { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  let out = ''
  const take = (d) => { out += d; if (out.length > 4_000_000) out = out.slice(-2_000_000) }
  child.stdout.on('data', take)
  child.stderr.on('data', take)
  const done = new Promise((resolve) => {
    child.on('error', (e) => { out += `\n${e.message}`; children.delete(child); resolve(127) })
    child.on('close', (code, signal) => { children.delete(child); resolve(signal ? 128 : code ?? 1) })
  })
  return { child, done, output: () => out }
}

const whole = (name, least) => { const n = Number(values[name]); if (!Number.isInteger(n) || n < least) { console.error(`--${name} takes a whole number, ${least} or more`); process.exit(2) } return n }
const jobs = whole('jobs', 1)
const timeout = whole('timeout', 1)

const todo = CHECKS.filter((c) => !wanted || wanted.includes(c.name))
const results = new Map()
for (const c of todo) { const s = status(c); if (s) results.set(c.name, { c, state: 'skip', note: s.slice(6, -1), seconds: 0 }) }
const toRun = todo.filter((c) => !results.has(c.name))

let dev = null
let base = null
if (toRun.some((c) => c.needs === 'devServer')) {
  const port = await freePort()
  dev = start([join(root, 'home/node_modules/.bin/vite'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], join(root, 'home'), { VILLAGER_PORT: String(await freePort()) }) // a port with no host behind it, so the page's own host is away
  dev.done.then(() => { dev.gone = true })
  base = `http://127.0.0.1:${port}/`
  const t0 = Date.now()
  while (!(await fetch(base).then((r) => r.ok, () => false))) {
    if (Date.now() - t0 > 60_000) { console.error(`dev server did not start:\n${dev.output().split('\n').slice(-10).join('\n')}`); process.exit(1) }
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function runOne(c) {
  const scratch = mkdtempSync(join(tmpdir(), `check-${c.name}-`))
  const ports = { dev: await freePort(), host: await freePort(), away: await freePort() }
  const argv = c.run.map((a) => a.replace('{dev}', ports.dev).replace('{host}', ports.host).replace('{base}', base ?? '').replace('{scratch}', scratch))
  const t0 = Date.now()
  // VILLAGER_PORT: a port with no host behind it. A check that starts its own stub host sets its own; one that does not would otherwise reach 5190.
  const p = start(argv, join(root, c.cwd), { VILLAGE_SCRATCH: scratch, VILLAGER_PORT: String(ports.away) })
  const timer = setTimeout(() => { p.timedOut = true; killTree(p.child, 'SIGKILL') }, timeout * 1000)
  const code = await p.done
  clearTimeout(timer)
  killTree(p.child, 'SIGKILL') // anything the check left behind
  rmSync(scratch, { recursive: true, force: true })
  const out = p.output()
  writeFileSync(join(logDir, `${c.name}.log`), out)
  const seconds = (Date.now() - t0) / 1000
  const pass = code === 0 && !p.timedOut
  console.error(`  ${pass ? 'pass' : 'FAIL'} ${c.name} ${seconds.toFixed(0)}s`)
  if (!pass && process.env.CI) console.error(out.trimEnd().split('\n').slice(-12).join('\n')) // a hosted run may be cancelled before the final report
  results.set(c.name, { c, state: pass ? 'pass' : 'fail', note: p.timedOut ? `timed out after ${timeout}s` : pass ? '' : `exit ${code}`, seconds, tail: out.trimEnd().split('\n').slice(-15).join('\n') })
}

// Slowest first, so the long ones start early; "alone" checks run after everything else.
const queue = [...toRun].sort((a, b) => (a.serial ? 1 : 0) - (b.serial ? 1 : 0) || (b.seconds ?? 0) - (a.seconds ?? 0))
const t0 = Date.now()
async function worker() {
  while (queue.length) {
    const next = queue[0]
    if (next.serial && (running > 0 || queue.some((q) => !q.serial))) { await new Promise((r) => setTimeout(r, 100)); continue }
    queue.shift()
    running++
    try { await runOne(next) } finally { running-- }
  }
}
let running = 0
await Promise.all(Array.from({ length: jobs }, worker))
// The shared dev server must have lived through every check that used it.
const devDied = Boolean(dev?.gone)
if (dev) killTree(dev.child, 'SIGKILL')

const rows = todo.map((c) => results.get(c.name))
const w = Math.max(...rows.map((r) => r.c.name.length))
for (const r of rows) console.log(`${r.c.name.padEnd(w)}  ${r.state.padEnd(4)}  ${String(r.seconds.toFixed(1)).padStart(6)}s${r.note ? '  ' + r.note : ''}`)
const failed = rows.filter((r) => r.state === 'fail')
for (const r of failed) console.log(`\n--- ${r.c.name} (${r.note}), full log .check/${r.c.name}.log\n${r.tail}`)
const n = (s) => rows.filter((r) => r.state === s).length
console.log(`\n${n('pass')} passed, ${failed.length} failed, ${n('skip')} skipped in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
if (devDied) console.log(`the shared dev server stopped during the run:\n${dev.output().trimEnd().split('\n').slice(-10).join('\n')}`)
// A check asked for by name and skipped, or a run in which nothing ran, is not a pass.
const unrun = wanted ? rows.filter((r) => r.state === 'skip').map((r) => r.c.name) : []
if (unrun.length) console.log(`asked for but not run: ${unrun.join(', ')}`)
if (!n('pass') && !failed.length) console.log('no check ran')
process.exit(failed.length || devDied || unrun.length || !n('pass') ? 1 : 0)
