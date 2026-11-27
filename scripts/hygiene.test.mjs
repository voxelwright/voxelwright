// node --test scripts/hygiene.test.mjs
// Runs hygiene.sh on a throwaway origin, checkout and worktrees, with its own HOME.
// HYGIENE_SCRIPT points the same cases at another copy of the script.
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = process.env.HYGIENE_SCRIPT ?? fileURLToPath(new URL('hygiene.sh', import.meta.url))
const HOUR = 3600
const DAY = 24 * HOUR

function fixture(t) {
  // The real path: on macOS the temp directory sits behind the /var symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hygiene-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const [bin, home, repo, trees] = ['bin', 'home', 'repo', 'worktrees'].map((name) => join(root, name))
  for (const dir of [bin, home, trees]) mkdirSync(dir)
  const stub = (name, body) => writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  // No notification on the real desktop, and the same free space on every machine.
  stub('osascript', 'exit 0')
  stub('df', 'printf "head\\ndisk 1000000000 0 900000000\\n"')

  const env = {
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    // Far from UTC, so a reference time built in the wrong zone shows.
    TZ: 'Pacific/Kiritimati',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    VILLAGE_REPO: repo,
    VILLAGE_WORKTREES: trees,
  }
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const commit = (cwd, file) => {
    writeFileSync(join(cwd, file), `${file}\n`)
    git(cwd, 'add', file)
    git(cwd, 'commit', '-qm', file)
  }
  git(root, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  git(root, 'clone', '-q', 'origin.git', 'repo')
  commit(repo, 'first')
  git(repo, 'push', '-q', 'origin', 'HEAD:main')

  return {
    root, trees, env, git, stub,
    // A new branch at origin/main, so already merged.
    merged(name, parent = trees) {
      const path = join(parent, name)
      git(repo, 'worktree', 'add', '-q', '--no-track', '-b', name, path, 'origin/main')
      return path
    },
    // One commit ahead of main, pushed: finished only once it has been left alone.
    pushed(name) {
      const path = this.merged(name)
      commit(path, name)
      git(path, 'push', '-q', '-u', 'origin', name)
      return path
    },
    listed: () => git(repo, 'worktree', 'list', '--porcelain'),
    run(args = [], extra = {}) {
      const r = spawnSync('/bin/bash', [script, ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' })
      assert.equal(r.status, 0, r.stdout + r.stderr)
      return r.stdout + r.stderr
    },
  }
}

// Sets the modification time of a directory and everything in it.
function backdate(path, seconds) {
  const when = new Date(Date.now() - seconds * 1000)
  for (const entry of readdirSync(path, { recursive: true })) utimesSync(join(path, entry), when, when)
  utimesSync(path, when, when)
}

test('a worktree changed in the last 2 hours is kept', (t) => {
  const f = fixture(t)
  const fresh = f.merged('fresh')
  const recent = f.merged('recent')
  backdate(recent, HOUR)
  for (const args of [['--dry-run'], []]) {
    const out = f.run(args)
    assert.match(out, /^keep fresh: changed in the last 2h$/m)
    assert.match(out, /^keep recent: changed in the last 2h$/m)
  }
  assert.ok(existsSync(fresh) && existsSync(recent))
})

test('an old merged worktree is listed by a dry run and removed by a real run', (t) => {
  const f = fixture(t)
  const old = f.merged('old')
  backdate(old, 3 * HOUR)
  // Build output does not count as a change.
  mkdirSync(join(old, 'node_modules'))
  writeFileSync(join(old, 'node_modules', 'fresh'), '')
  const when = new Date(Date.now() - 3 * HOUR * 1000)
  utimesSync(old, when, when)

  const dry = f.run(['--dry-run'])
  assert.match(dry, /^would remove old \(merged into origin\/main\)$/m)
  assert.match(dry, /^dry run: would remove 1, keep 0$/m)
  assert.ok(existsSync(old))

  assert.match(f.run(), /removed .*\/old \(merged into origin\/main, /)
  assert.ok(!existsSync(old))
  assert.doesNotMatch(f.listed(), /\/old$/m)
})

test('a pushed, unmerged worktree is removed only after 3 days untouched', (t) => {
  const f = fixture(t)
  const day = f.pushed('one-day')
  const four = f.pushed('four-days')
  backdate(day, DAY)
  backdate(four, 4 * DAY)

  const dry = f.run(['--dry-run'])
  assert.match(dry, /^keep one-day: one-day not finished$/m)
  assert.match(dry, /^would remove four-days \(untouched 3d, pushed as origin\/four-days\)$/m)

  f.run()
  assert.ok(existsSync(day))
  assert.ok(!existsSync(four))
})

test('uncommitted and untracked files keep an old worktree', (t) => {
  const f = fixture(t)
  const edited = f.merged('edited')
  const untracked = f.merged('untracked')
  appendFileSync(join(edited, 'first'), 'edit\n')
  writeFileSync(join(untracked, 'notes'), '')
  backdate(edited, 4 * DAY)
  backdate(untracked, 4 * DAY)

  const out = f.run()
  assert.match(out, /^keep edited: uncommitted or untracked files$/m)
  assert.match(out, /^keep untracked: uncommitted or untracked files$/m)
  assert.ok(existsSync(edited) && existsSync(untracked))
})

for (const tool of ['find', 'touch']) {
  test(`worktrees are kept when ${tool} fails`, (t) => {
    const f = fixture(t)
    const old = f.merged('old')
    const pushed = f.pushed('pushed')
    backdate(old, 4 * DAY)
    backdate(pushed, 4 * DAY)
    f.stub(tool, 'exit 1')

    const out = f.run()
    assert.match(out, /cannot check file times in .*\/old; treating it as changed/)
    assert.match(out, /^keep old: changed in the last 2h$/m)
    assert.match(out, /^keep pushed: pushed not finished$/m)
    assert.ok(existsSync(old) && existsSync(pushed))
  })
}

test('a root given through a symlink finds the worktrees', (t) => {
  const f = fixture(t)
  backdate(f.merged('old'), 3 * HOUR)
  const link = join(f.root, 'link')
  symlinkSync(f.trees, link)
  assert.match(f.run(['--dry-run'], { VILLAGE_WORKTREES: link }), /^would remove old /m)
})

test('the case of the root is ignored on macOS and significant elsewhere', (t) => {
  const f = fixture(t)
  const old = f.merged('old')
  backdate(old, 3 * HOUR)
  const upper = { VILLAGE_WORKTREES: join(f.root, 'WorkTrees') }
  if (process.platform !== 'darwin') {
    assert.match(f.run([], upper), /removed 0 worktrees, kept 0/)
    assert.ok(existsSync(old))
    return
  }
  assert.match(f.run(['--dry-run'], upper), /^would remove old /m)
  f.run([], upper)
  assert.ok(!existsSync(old))
})

test('a worktree a process is working in is kept', async (t) => {
  const f = fixture(t)
  // On macOS git records the case it was given, and lsof reports the case on disk.
  const typed = process.platform === 'darwin' ? join(f.root, 'WorkTrees') : f.trees
  const busy = f.merged('busy', typed)
  assert.ok(f.listed().includes(`worktree ${busy}\n`), f.listed())
  backdate(busy, 3 * HOUR)
  const child = spawn('/bin/sleep', ['60'], { cwd: join(f.trees, 'busy'), stdio: 'ignore' })
  t.after(() => child.kill())
  await once(child, 'spawn')

  assert.match(f.run(), /^keep busy: open in a running process$/m)
  assert.ok(existsSync(busy))

  // Once the process has gone it is removed, under the spelling git holds.
  child.kill()
  await once(child, 'exit')
  f.run()
  assert.ok(!existsSync(busy))
  assert.ok(!f.listed().includes(`worktree ${busy}\n`))
})
