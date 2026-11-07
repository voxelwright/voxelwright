// A villager's private notes: flat Markdown files in one person's folder.
// Names are checked against a tight pattern before any path is built, and a
// file that is a symlink is refused, so no name can reach outside the folder.
import { lstat, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const NAME = /^[a-z0-9][a-z0-9-]{0,63}\.md$/
const MAX_BYTES = 16_000

export class NoteError extends Error {}

function pathFor(dir: string, name: string): string {
  if (typeof name !== 'string' || !NAME.test(name)) throw new NoteError(`A note name is lowercase letters, digits and dashes ending in .md, like "plants.md"; "${String(name).slice(0, 80)}" is not one.`)
  return join(dir, name)
}

async function refuseLink(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile()) throw new NoteError('That note is not a plain file.')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function listNotes(dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isFile() && NAME.test(e.name)).map((e) => e.name).sort()
}

export async function readNote(dir: string, name: string): Promise<string> {
  const path = pathFor(dir, name)
  if (!(await refuseLink(path))) throw new NoteError(`There is no note called ${name} yet.`)
  return readFile(path, 'utf8')
}

/** Replaces the whole note. Written to a temporary file first so a crash never leaves half a note. */
export async function writeNote(dir: string, name: string, content: string): Promise<void> {
  const path = pathFor(dir, name)
  if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES) throw new NoteError(`A note holds up to ${MAX_BYTES} bytes.`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await refuseLink(path)
  const temp = join(dir, `.${name}.${process.pid}.tmp`)
  await writeFile(temp, content, { mode: 0o600 })
  await rename(temp, path)
}
