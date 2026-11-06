// A candidate is a physical copy of the running checkout's current commit,
// made outside it. Uncommitted changes in the checkout are not included. The
// inode check below proves no file is shared with the source repository.
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import type { Candidate } from './elder.ts'
import { must } from './proc.ts'

export async function createCandidate(source: string, candidatesRoot: string, id: string): Promise<Candidate & { inodesShared: number }> {
  const top = await must('git', ['rev-parse', '--show-toplevel'], source)
  const root = resolve(candidatesRoot)
  const inside = relative(top, root)
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error(`Candidates must live outside the running checkout: ${root}`)

  const baseCommit = await must('git', ['rev-parse', 'HEAD'], top)
  const runDir = join(root, id)
  const repo = join(runDir, 'repo')
  const branch = `candidate/${id}`
  await mkdir(runDir, { recursive: true })
  // Fetch only the current commit's history into a fresh repository. Unlike a
  // full clone, this skips the source's other refs (one of them can be stale),
  // and the transfer always writes new pack files rather than linking.
  await must('git', ['init', '--quiet', repo], runDir)
  await must('git', ['fetch', '--quiet', '--no-tags', top, baseCommit], repo)
  await must('git', ['checkout', '--quiet', '-b', branch, baseCommit], repo)

  const sourceObjects = resolve(top, await must('git', ['rev-parse', '--git-common-dir'], top), 'objects')
  const sourceInodes = await inodes(sourceObjects)
  sourceInodes.add((await stat(join(top, 'home', 'package.json'))).ino)
  const copied = [...(await inodes(join(repo, '.git', 'objects'))), (await stat(join(repo, 'home', 'package.json'))).ino]
  const inodesShared = copied.filter((ino) => sourceInodes.has(ino)).length
  if (inodesShared > 0) throw new Error(`Candidate shares ${inodesShared} inodes with the source repository`)
  return { id, runDir, repo, baseCommit, branch, inodesShared }
}

async function inodes(dir: string): Promise<Set<number>> {
  const found = new Set<number>()
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) found.add((await stat(join(entry.parentPath, entry.name))).ino)
  }
  return found
}
