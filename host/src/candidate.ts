// A candidate is a physical copy of the running checkout's current commit,
// made outside it. Uncommitted changes in the checkout are not included. Every
// file in the candidate is checked against every file in the source for a
// shared inode.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, readlink, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Candidate } from './elder.ts'
import { mustGit } from './proc.ts'

export async function createCandidate(source: string, candidatesRoot: string, id: string): Promise<Candidate> {
  const top = await mustGit(['rev-parse', '--show-toplevel'], source)
  const root = resolve(candidatesRoot)
  const inside = relative(top, root)
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error(`Candidates must live outside the running checkout: ${root}`)

  const baseCommit = await mustGit(['rev-parse', 'HEAD'], top)
  const runDir = join(root, id)
  const repo = join(runDir, 'repo')
  const branch = `candidate/${id}`
  await mkdir(runDir, { recursive: true })
  // Fetch only the current commit's history into a fresh repository. Unlike a
  // full clone, this skips the source's other refs (one of them can be stale),
  // and the transfer always writes new pack files rather than linking.
  await mustGit(['init', '--quiet', repo], runDir)
  await mustGit(['fetch', '--quiet', '--no-tags', top, baseCommit], repo)
  await mustGit(['checkout', '--quiet', '-b', branch, baseCommit], repo)
  return { id, runDir, repo, baseCommit, branch }
}

/** Fails when any file in the candidate shares a device and inode with any file in the source checkout or its git objects. */
export async function assertNoSharedInodes(source: string, repo: string): Promise<{ candidateFiles: number; sourceFiles: number }> {
  const top = await mustGit(['rev-parse', '--show-toplevel'], source)
  const common = resolve(top, await mustGit(['rev-parse', '--git-common-dir'], top))
  const sourceInodes = new Set<string>()
  for (const dir of [top, common]) for (const key of await fileInodes(dir)) sourceInodes.add(key)
  const candidateInodes = await fileInodes(repo)
  const shared = [...candidateInodes].filter((key) => sourceInodes.has(key)).length
  if (shared > 0) throw new Error(`Candidate shares ${shared} inodes with the source checkout`)
  return { candidateFiles: candidateInodes.size, sourceFiles: sourceInodes.size }
}

async function fileInodes(dir: string): Promise<Set<string>> {
  const found = new Set<string>()
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const s = await lstat(join(entry.parentPath, entry.name))
    found.add(`${s.dev}:${s.ino}`)
  }
  return found
}

/** Path → content fingerprint for every entry in the candidate except build output. */
export type Manifest = Map<string, string>

/** Paths the candidate may change. Everything else, including .git and node_modules, is controller-owned. */
export const CANDIDATE_OWNED = 'home/src/plugins/'
/** Rebuilt by the controller before each check, so its contents are never compared. */
const BUILD_OUTPUT = 'home/dist/'

export async function manifest(repo: string): Promise<Manifest> {
  const result: Manifest = new Map()
  for (const entry of await readdir(repo, { recursive: true, withFileTypes: true })) {
    const full = join(entry.parentPath, entry.name)
    const path = relative(repo, full)
    if (path === 'home/dist' || path.startsWith(BUILD_OUTPUT)) continue
    if (entry.isDirectory()) continue
    if (entry.isSymbolicLink()) result.set(path, `link:${await readlink(full)}`)
    else if (entry.isFile()) result.set(path, `file:${(await lstat(full)).mode.toString(8)}:${await sha256(full)}`)
    else result.set(path, 'other')
  }
  return result
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

export interface ManifestDiff {
  added: string[]
  modified: string[]
  deleted: string[]
  /** Changed paths outside home/src/plugins/, or anything there that is not a regular file. */
  controllerOwned: string[]
}

export function diffManifests(before: Manifest, after: Manifest): ManifestDiff {
  const added = [...after.keys()].filter((p) => !before.has(p)).sort()
  const deleted = [...before.keys()].filter((p) => !after.has(p)).sort()
  const modified = [...after.keys()].filter((p) => before.has(p) && before.get(p) !== after.get(p)).sort()
  const controllerOwned = [...added, ...modified, ...deleted]
    .filter((p) => !p.startsWith(CANDIDATE_OWNED) || !(after.get(p) ?? 'file:').startsWith('file:'))
    .sort()
  return { added, modified, deleted, controllerOwned }
}

/** Keep the newest `keep` candidates and every candidate that did not pass; delete older passed ones. */
export async function pruneCandidates(candidatesRoot: string, keep = 5): Promise<string[]> {
  const ids = (await readdir(candidatesRoot, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
  const removed: string[] = []
  for (const id of ids.slice(keep)) {
    const status = await readFile(join(candidatesRoot, id, 'result.json'), 'utf8')
      .then((text) => (JSON.parse(text) as { status?: string }).status)
      .catch(() => undefined)
    if (status !== 'passed') continue
    await rm(join(candidatesRoot, id), { recursive: true, force: true })
    removed.push(id)
  }
  return removed
}
