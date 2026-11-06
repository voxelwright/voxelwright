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
import { appendFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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

const hashText = (text: string) => createHash('sha256').update(text).digest('hex')
const hashOf = (path: string): Promise<Hash> => sha256(path).catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)))

async function record(live: string, action: string, outcome: Outcome): Promise<Outcome> {
  if (existsSync(live)) await appendFile(join(live, 'results.jsonl'), JSON.stringify({ at: new Date().toISOString(), action, ...outcome }) + '\n')
  return outcome
}

async function attempt(live: string, action: string, work: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await record(live, action, await work())
  } catch (error) {
    if (error instanceof Refusal) return record(live, action, { result: 'refused', reason: error.reason, message: error.message, ...error.extra })
    throw error
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
  await mustGit(['add', '-A'], live)
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
      const failing = Object.entries((checked.checks ?? {}) as Record<string, string>).filter(([, v]) => v !== 'pass').map(([k, v]) => `${k} ${v}`)
      refuse('not-passed', `${id} didn't pass its checks${failing.length ? ` (${failing.join(', ')})` : checked.error ? ` (${checked.error})` : ''}, so it stays out of the home.`, { candidate: id, status: checked.status })
    }
    const files = checked.files as Record<string, Hash> | undefined
    const commit = checked.commit as string | undefined
    const base = checked.baseCommit as string | undefined
    if ((checked.checks as Record<string, string> | undefined)?.['controller-files'] !== 'pass' || !files || !commit || !base)
      refuse('unchecked-files', `${id} has no record of which files were checked, so I can't be sure what I'd be copying. It stays out of the home.`, { candidate: id })
    const paths = Object.keys(files!).sort()
    if (!paths.length) refuse('nothing-to-promote', `${id} didn't change any plugin files, so there's nothing to put into the home.`, { candidate: id })
    const outside = paths.filter((p) => !p.startsWith(CANDIDATE_OWNED) || p.includes('..'))
    if (outside.length) refuse('controller-owned', `${id} touches files outside the plugins folder (${outside.join(', ')}). Only plugins can be promoted.`, { candidate: id, paths: outside })

    // The candidate is untrusted: recheck its commit and working tree against what was recorded at check time.
    const repo = join(runDir, 'repo')
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
      if (recorded === null) continue
      const entry = await mustGit(['ls-tree', commit!, '--', path], repo)
      const isRegular = entry.startsWith('100644 blob ') && (await lstat(full)).isFile()
      if (!isRegular || hashText(await blobAt(repo, commit!, path)) !== recorded) mismatched.push(path)
    }
    if (mismatched.length)
      refuse('changed-since-check', `${id}'s files have changed since they were checked (${[...new Set(mismatched)].join(', ')}). I'll only put in exactly what passed, so please run the request again.`, { candidate: id, paths: [...new Set(mismatched)] })

    await requireCleanLive(live)
    const liveBefore = await mustGit(['rev-parse', 'HEAD'], live)
    const changes: PromotionEntry['files'] = {}
    for (const path of paths) {
      const target = join(live, path)
      changes[path] = { before: await hashOf(target), after: files![path] }
      if (files![path] === null) await rm(target, { force: true })
      else {
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, await readFile(join(repo, path)))
      }
      if ((await hashOf(target)) !== files![path]) throw new Error(`Copied ${path} does not match its checked hash`)
    }
    const entry: PromotionEntry = {
      type: 'promotion',
      id: `p-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${randomBytes(3).toString('hex')}`,
      candidate: id,
      candidateCommit: commit!,
      liveBefore,
      files: changes,
      at: new Date().toISOString(),
    }
    const liveCommit = await commitEntry(live, entry, `Promote ${id} (${entry.id})`)
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
    for (const [path, { before, after }] of Object.entries(promotion.files)) {
      const full = join(live, path)
      if (before === null) await rm(full, { force: true })
      else {
        const text = await blobAt(live, promotion.liveBefore, path)
        if (hashText(text) !== before) throw new Error(`The recorded previous version of ${path} does not match its hash`)
        await writeFile(full, text)
      }
      const now = await hashOf(full)
      if (now !== before) throw new Error(`Restored ${path} does not match its previous hash`)
      changes[path] = { before: after, after: now }
    }
    const entry: RollbackEntry = {
      type: 'rollback',
      id: `r-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${randomBytes(3).toString('hex')}`,
      promotion: promotion.id,
      files: changes,
      at: new Date().toISOString(),
    }
    const liveCommit = await commitEntry(live, entry, `Roll back ${promotion.id} (${promotion.candidate})`)
    return { result: 'rolled-back', message: `${promotion.candidate} is out of the home again; everything it changed is back as it was.`, rollback: entry, liveCommit }
  })
}
