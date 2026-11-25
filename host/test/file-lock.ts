// The file lock (file-lock.ts) between real processes, and the reminders store on it: two hosts on one root
// (a dev home and the live home) must not lose each other's writes. No model, no browser.
//
//   npm run check-file-lock
import { spawn } from 'node:child_process'
import { mkdtemp, open, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withFileLock } from '../src/file-lock.ts'
import { newReminder, reminderStore } from '../src/reminders.ts'

// A child: `node test/file-lock.ts child <kind> <path> <count> <tag>` does `count` locked read-modify-writes.
if (process.argv[2] === 'child') {
  const [, , , kind, path, count, tag] = process.argv
  for (let i = 0; i < Number(count); i++) {
    if (kind === 'counter') {
      await withFileLock(path, async () => {
        const n = Number(await readFile(path, 'utf8').catch(() => '0'))
        await new Promise((r) => setTimeout(r, Math.random() * 3))
        await writeFile(path, String(n + 1))
      })
    } else {
      const now = Date.now()
      await reminderStore(path).update(now, (list) => ({ list: [...list, newReminder(list, `${tag} ${i}`, now + 3_600_000, now)], result: null }))
    }
  }
  process.exit(0)
}

const checks: { name: string; pass: boolean }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => {
  checks.push({ name, pass: Boolean(pass) })
  if (!pass) console.log(`FAIL ${name} ${JSON.stringify(detail)}`)
}
const scratch = await mkdtemp(join(tmpdir(), 'file-lock-'))
const run = (...args: string[]) =>
  new Promise<number>((resolve) => spawn(process.execPath, [import.meta.filename, 'child', ...args], { stdio: 'inherit' }).on('exit', (code) => resolve(code ?? 1)))
try {
  // Two processes, 40 locked increments each, on one file.
  const counter = join(scratch, 'counter.txt')
  const codes = await Promise.all([run('counter', counter, '40', 'a'), run('counter', counter, '40', 'b')])
  check('two processes, 40 locked increments each: 80', codes.every((c) => c === 0) && (await readFile(counter, 'utf8')) === '80', await readFile(counter, 'utf8'))
  // The reminders store in two processes on one person's file (a dev host and the live host on one root): none lost.
  const person = join(scratch, 'people', 'alex')
  const both = await Promise.all([run('reminders', person, '20', 'dev'), run('reminders', person, '20', 'live')])
  const stored = JSON.parse(await readFile(join(person, 'reminders.json'), 'utf8')).reminders as { what: string }[]
  check('two hosts setting 20 reminders each on one file keep all 40', both.every((c) => c === 0) && stored.length === 40 && stored.filter((r) => r.what.startsWith('dev')).length === 20, stored.length)
  check('no lock is left behind', !existsSync(`${counter}.lock`) && !existsSync(join(person, 'reminders.json.lock')))

  // The owner rules, with a short stale limit.
  const file = join(scratch, 'owned.json')
  await writeFile(`${file}.lock`, 'someone-else')
  let ran = false
  const waiting = withFileLock(file, async () => void (ran = true), { staleMs: 60_000 })
  await new Promise((r) => setTimeout(r, 300))
  check("a fresh lock of another owner is waited for, not taken or removed", !ran && (await readFile(`${file}.lock`, 'utf8')) === 'someone-else')
  await rm(`${file}.lock`)
  await waiting
  check('the wait ends when that owner lets go, and the lock is then removed by its own owner', ran && !existsSync(`${file}.lock`))
  await writeFile(`${file}.lock`, 'crashed')
  const old = new Date(Date.now() - 5_000)
  await utimes(`${file}.lock`, old, old)
  const took = Date.now()
  await withFileLock(file, async () => {}, { staleMs: 1_000 })
  check("a lock older than the stale limit (a crashed owner's) is taken over", Date.now() - took < 1_000 && !existsSync(`${file}.lock`))
  // Backdate only the abandoned lock. Live holders keep a lease longer than the test
  // so a scheduler pause cannot turn this concurrency check into an expiry check.
  const abandoned = new Date(0)
  const liveLease = { staleMs: 3_600_000 }
  let overlaps = 0
  for (let round = 0; round < 50; round++) {
    await writeFile(`${file}.lock`, 'crashed')
    await utimes(`${file}.lock`, abandoned, abandoned)
    await Promise.all(Array.from({ length: 6 }, () => withFileLock(file, async () => {
      const inside = await open(`${file}.inside`, 'wx').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return null
        throw error
      })
      if (!inside) return void overlaps++
      await new Promise((r) => setTimeout(r, 2))
      await inside.close()
      await rm(`${file}.inside`)
    }, liveLease)))
  }
  check('six waiters on a stale lock, 50 rounds: never two holding it at once', overlaps === 0, { overlaps })
  // While we hold the lock, someone replaces it (a takeover after we stalled): we leave theirs alone.
  await withFileLock(file, async () => {
    await writeFile(`${file}.lock`, 'the-new-owner')
  })
  check('the owner removes the lock only while it still holds its token', (await readFile(`${file}.lock`, 'utf8')) === 'the-new-owner')
  await rm(`${file}.lock`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
const failed = checks.filter((c) => !c.pass)
console.log(`${checks.length - failed.length} of ${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
