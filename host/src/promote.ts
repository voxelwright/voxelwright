// Promotion puts a checked candidate's plugin files into the live installation;
// rollback takes them out again. Both refuse rather than guess, and every
// attempt, refused or not, appends an entry to <live>/results.jsonl (not in
// git). Promotions and rollbacks are also entries in promotions.jsonl, which is
// committed with the files it describes.
//
// Approval is the human's --approve flag and nothing else: no field in a
// candidate, its result.json or model output is read as approval.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { CANDIDATE_OWNED, sha256 } from './candidate.ts'
import { ELDER_IDENTITY } from './live.ts'
import { git, mustGit } from './proc.ts'

type Hash = string | null

export interface PromotionEntry {
  type: 'promotion'
  id: string
  candidate: string
  candidateCommit: string
  /** The live commit before this promotion; previous contents are read from it on rollback. */
  liveBefore: string
  files: Record<string, { before: Hash; after: Hash }>
  at: string
}

export interface RollbackEntry {
  type: 'rollback'
  id: string
  promotion: string
  files: Record<string, { before: Hash; after: Hash }>
  at: string
}

export type Outcome = { result: 'promoted' | 'rolled-back' | 'refused'; reason?: string; message: string; [key: string]: unknown }

class Refusal extends Error {
  readonly reason: string
  readonly extra: Record<string, unknown>
  constructor(reason: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.reason = reason
    this.extra = extra
  }
}

const refuse = (reason: string, message: string, extra?: Record<string, unknown>): never => {
  throw new Refusal(reason, message, extra)
}

/** The only paths a promotion may write: a plugin file directly in home/src/plugins/. */
const PROMOTABLE = /^home\/src\/plugins\/[\w-]+\.ts$/

const hashText = (text: string) => createHash('sha256').update(text).digest('hex')
const hashOf = (path: string): Promise<Hash> => sha256(path).catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)))

async function record(live: string, action: string, outcome: Outcome): Promise<Outcome> {
  if (existsSync(live)) await appendFile(join(live, 'results.jsonl'), JSON.stringify({ at: new Date().toISOString(), action, ...outcome }) + '\n')
  return outcome
}

/**
 * Runs one promotion or rollback while holding <live>/.git/village-promote.lock,
 * so two never interleave. The lock is inside .git, so it never counts as an
 * uncommitted change. A lock left by a crashed run names its pid.
 */
async function attempt(live: string, action: string, work: () => Promise<Outcome>): Promise<Outcome> {
  const lock = join(live, '.git', 'village-promote.lock')
  let locked = false
  try {
    if (existsSync(join(live, '.git'))) {
      try {
        await writeFile(lock, String(process.pid), { flag: 'wx' })
        locked = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const holder = (await readFile(lock, 'utf8').catch(() => '')).trim()
        refuse('live-busy', `Another promotion or rollback is changing the home right now (process ${holder || 'unknown'}). Try again when it's done. If no such process is running, it stopped partway: check the home with "npm run live -- status", then delete ${lock}.`, { lock, holder })
      }
    }
    return await record(live, action, await work())
  } catch (error) {
    if (error instanceof Refusal) return record(live, action, { result: 'refused', reason: error.reason, message: error.message, ...error.extra })
    throw error
  } finally {
    if (locked) await rm(lock, { force: true })
  }
}

/**
 * Writes each file (null deletes it), checks it against its expected hash and
 * commits it with the entry. If anything fails, puts the live tree back at head
 * and refuses, so live is either fully changed and recorded or unchanged.
 */
async function applyToLive(live: string, head: string, contents: Record<string, string | null>, expected: Record<string, Hash>, entry: PromotionEntry | RollbackEntry, subject: string): Promise<string> {
  try {
    for (const [path, text] of Object.entries(contents)) {
      const target = join(live, path)
      if (text === null) await rm(target, { force: true })
      else {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, text)
      }
      if ((await hashOf(target)) !== expected[path]) throw new Error(`${path} does not match its recorded hash after writing`)
    }
    return await commitEntry(live, entry, subject)
  } catch (error) {
    await mustGit(['reset', '--hard', '--quiet', head], live)
    await mustGit(['clean', '-fdq', '--', ...Object.keys(contents)], live)
    return refuse('write-failed', `Something went wrong while changing the home (${(error as Error).message}). I put everything back as it was.`, { paths: Object.keys(contents) })
  }
}

async function requireCleanLive(live: string) {
  if (!existsSync(join(live, '.git'))) refuse('no-live-install', `There's no live home at ${live} yet. Run "npm run live -- install" first.`)
  const dirty = (await mustGit(['status', '--porcelain'], live)).split('\n').filter(Boolean)
  if (dirty.length)
    refuse('live-uncommitted', `The live home has changes nobody has recorded yet (${dirty.map((l) => l.slice(3)).join(', ')}). I'll leave it alone until those are committed or put back.`, { uncommitted: dirty })
}

async function readEntries(live: string): Promise<(PromotionEntry | RollbackEntry)[]> {
  return (await readFile(join(live, 'promotions.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function commitEntry(live: string, entry: PromotionEntry | RollbackEntry, subject: string): Promise<string> {
  await appendFile(join(live, 'promotions.jsonl'), JSON.stringify(entry) + '\n')
  await mustGit(['add', '--', ...Object.keys(entry.files), 'promotions.jsonl'], live)
  await mustGit([...ELDER_IDENTITY, 'commit', '--quiet', '--no-verify', '-m', subject], live)
  return mustGit(['rev-parse', 'HEAD'], live)
}

/** The exact bytes of path at rev, as git stores them (git() keeps stdout untrimmed). */
async function blobAt(repo: string, rev: string, path: string): Promise<string> {
  const shown = await git(['cat-file', 'blob', `${rev}:${path}`], repo)
  if (shown.code !== 0) throw new Error(`git cat-file ${rev}:${path} failed: ${shown.stderr.trim()}`)
  return shown.stdout
}

export interface PromoteOptions {
  candidate: string
  approve: boolean
  candidatesRoot: string
  live: string
}

export function promote(options: PromoteOptions): Promise<Outcome> {
  const live = resolve(options.live)
  const id = options.candidate
  return attempt(live, 'promote', async () => {
    if (!options.approve) refuse('not-approved', `Nothing has changed. Putting ${id || 'a candidate'} into the home needs your say-so: run it again with --approve when you're ready.`)
    if (!/^[\w.-]+$/.test(id)) refuse('missing-candidate', `I couldn't find a candidate called "${id}".`)
    const runDir = join(resolve(options.candidatesRoot), id)
    let checked: Record<string, unknown>
    try {
      checked = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8'))
    } catch {
      return refuse('missing-candidate', `I couldn't find a checked candidate called ${id}, so there's nothing to put into the home.`, { candidate: id })
    }
    if (checked.status !== 'passed') {
      const executor = (checked.executorOutcome as { status?: string } | undefined)?.status
      const failing =
        executor && executor !== 'completed'
          ? [`the change itself ${executor === 'timeout' ? 'ran out of time' : 'did not finish'}, so nothing was checked`]
          : Object.entries((checked.checks ?? {}) as Record<string, string>).filter(([, v]) => v !== 'pass').map(([k, v]) => `${k} ${v}`)
      refuse('not-passed', `${id} didn't pass its checks${failing.length ? ` (${failing.join(', ')})` : checked.error ? ` (${checked.error})` : ''}, so it stays out of the home.`, { candidate: id, status: checked.status })
    }
    const files = checked.files as Record<string, Hash> | undefined
    const commit = checked.commit as string | undefined
    const base = checked.baseCommit as string | undefined
    if ((checked.checks as Record<string, string> | undefined)?.['controller-files'] !== 'pass' || !files || !commit || !base)
      refuse('unchecked-files', `${id} has no record of which files were checked, so I can't be sure what I'd be copying. It stays out of the home.`, { candidate: id })
    const paths = Object.keys(files!).sort()
    if (!paths.length) refuse('nothing-to-promote', `${id} didn't change any plugin files, so there's nothing to put into the home.`, { candidate: id })
    const outside = paths.filter((p) => !PROMOTABLE.test(p))
    if (outside.length) refuse('controller-owned', `${id} touches files that aren't plugins (${outside.join(', ')}). Only plugin files in the plugins folder can be promoted.`, { candidate: id, paths: outside })

    // The candidate is untrusted: recheck its commit and working tree against what was recorded at check time.
    // What goes into the home is the committed blob, read once and hashed, never the working file, which can change at any moment.
    const repo = join(runDir, 'repo')
    const contents: Record<string, string | null> = {}
    const committed = (await mustGit(['diff', '--name-only', '--no-renames', '-z', base!, commit!], repo).catch(() => '')).split('\0').filter(Boolean).sort()
    const mismatched: string[] = []
    if (committed.join('\n') !== paths.join('\n')) mismatched.push(...new Set([...committed, ...paths].filter((p) => !committed.includes(p) || !paths.includes(p))))
    for (const path of paths) {
      const recorded = files![path]
      const full = join(repo, path)
      const now = await hashOf(full)
      if (now !== recorded) {
        mismatched.push(path)
        continue
      }
      if (recorded === null) {
        contents[path] = null
        continue
      }
      const entry = await mustGit(['ls-tree', commit!, '--', path], repo)
      const blob = entry.startsWith('100644 blob ') ? await blobAt(repo, commit!, path) : null
      if (blob === null || hashText(blob) !== recorded) mismatched.push(path)
      else contents[path] = blob
    }
    if (mismatched.length)
      refuse('changed-since-check', `${id}'s files have changed since they were checked (${[...new Set(mismatched)].join(', ')}). I'll only put in exactly what passed, so please run the request again.`, { candidate: id, paths: [...new Set(mismatched)] })

    await requireCleanLive(live)
    const liveBefore = await mustGit(['rev-parse', 'HEAD'], live)
    const changes: PromotionEntry['files'] = {}
    for (const path of paths) changes[path] = { before: await hashOf(join(live, path)), after: files![path] }
    const entry: PromotionEntry = {
      type: 'promotion',
      id: `p-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${randomBytes(3).toString('hex')}`,
      candidate: id,
      candidateCommit: commit!,
      liveBefore,
      files: changes,
      at: new Date().toISOString(),
    }
    const liveCommit = await applyToLive(live, liveBefore, contents, files!, entry, `Promote ${id} (${entry.id})`)
    return { result: 'promoted', message: `${id} is in the home now (${paths.map((p) => p.slice(CANDIDATE_OWNED.length)).join(', ')}). Roll it back any time with "npm run elder -- rollback ${entry.id}".`, promotion: entry, liveCommit }
  })
}

export function rollback(options: { target: string; live: string }): Promise<Outcome> {
  const live = resolve(options.live)
  return attempt(live, 'rollback', async () => {
    await requireCleanLive(live)
    const entries = await readEntries(live)
    const undone = new Set(entries.filter((e): e is RollbackEntry => e.type === 'rollback').map((e) => e.promotion))
    const open = entries.filter((e): e is PromotionEntry => e.type === 'promotion' && !undone.has(e.id))
    const target = options.target === 'last' ? open.at(-1) : open.find((e) => e.id === options.target)
    if (!target) {
      const known = entries.some((e) => e.id === options.target)
      refuse(known ? 'already-rolled-back' : 'no-promotion', known ? `${options.target} has already been rolled back.` : options.target === 'last' ? 'There are no promotions left to roll back.' : `I couldn't find a promotion called ${options.target}.`)
    }
    const promotion = target!
    // Every file must still be exactly what the promotion put there; anything else is someone's later edit.
    const edited: string[] = []
    for (const [path, { after }] of Object.entries(promotion.files)) if ((await hashOf(join(live, path))) !== after) edited.push(path)
    if (edited.length)
      refuse('manual-edit', `${edited.join(', ')} changed after ${promotion.id} put it in, so rolling back would undo someone else's work. I've left everything as it is.`, { promotion: promotion.id, paths: edited })

    const changes: RollbackEntry['files'] = {}
    const contents: Record<string, string | null> = {}
    const expected: Record<string, Hash> = {}
    for (const [path, { before, after }] of Object.entries(promotion.files)) {
      contents[path] = before === null ? null : await blobAt(live, promotion.liveBefore, path)
      if (contents[path] !== null && hashText(contents[path]) !== before)
        refuse('history-mismatch', `The earlier version of ${path} recorded for ${promotion.id} doesn't match its hash, so I can't restore it safely. I've left everything as it is.`, { promotion: promotion.id, path })
      expected[path] = before
      changes[path] = { before: after, after: before }
    }
    const entry: RollbackEntry = {
      type: 'rollback',
      id: `r-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${randomBytes(3).toString('hex')}`,
      promotion: promotion.id,
      files: changes,
      at: new Date().toISOString(),
    }
    const liveCommit = await applyToLive(live, await mustGit(['rev-parse', 'HEAD'], live), contents, expected, entry, `Roll back ${promotion.id} (${promotion.candidate})`)
    return { result: 'rolled-back', message: `${promotion.candidate} is out of the home again; everything it changed is back as it was.`, rollback: entry, liveCommit }
  })
}
