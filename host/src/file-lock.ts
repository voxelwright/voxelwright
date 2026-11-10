// One owner for locking a file between processes (two hosts on one root, the `link`
// command beside a running host) and within one: `withFileLock(file, fn)` runs `fn` while
// it holds `<file>.lock`, a file created exclusively that holds its owner's token.
//
// A lock whose file is older than the stale limit is a crashed owner's and is taken over: only
// the waiter holding <lock>.break removes it, after checking its age again, so a fresh lock is
// never moved or removed. Only the owner removes the lock, and only while it still holds its token.
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/** A change under a lock takes milliseconds; a lock this old was left by a writer that died. */
export const STALE_MS = 10_000
const POLL_MS = 20

export async function withFileLock<T>(file: string, fn: () => Promise<T>, { staleMs = STALE_MS } = {}): Promise<T> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const lock = `${file}.lock`
  const mine = `${process.pid}:${randomBytes(8).toString('hex')}`
  for (;;) {
    try {
      const handle = await open(lock, 'wx', 0o600)
      try {
        await handle.writeFile(mine)
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0)
      if (age > staleMs) {
        // Only the waiter holding <lock>.break removes a stale lock, after checking its age again under it,
        // so a fresh lock is never moved or removed. A breaker left by a waiter that died goes after the same limit.
        const breaker = `${lock}.break`
        const held = await open(breaker, 'wx').then((h) => h.close().then(() => true), () => false)
        if (held) {
          try {
            const again = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0)
            if (again > staleMs) await rm(lock, { force: true })
          } finally {
            await rm(breaker, { force: true })
          }
          continue
        }
        if (await stat(breaker).then((s) => Date.now() - s.mtimeMs > staleMs, () => false)) await rm(breaker, { force: true })
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }
  try {
    return await fn()
  } finally {
    if ((await readFile(lock, 'utf8').catch(() => '')) === mine) await rm(lock, { force: true })
  }
}
