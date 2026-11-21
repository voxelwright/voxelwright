// Builds the core as wasm into page/core.wasm (#465). The release build is one crate with LTO and one codegen unit,
// 27 to 54 s on this machine under the load of parallel agents, and every new worktree paid it before its first check.
// The wasm depends only on what git holds under core/ and on the compiler (the same tree built in two worktrees gave
// the same bytes), so a build is kept by that pair in ~/.village/engine/core-cache and copied (cloned on APFS, never
// linked) into a checkout whose core/ is committed and clean. A core/ with changes is always built and never kept.
//
//   npm run core            (node core/build.mjs [--no-cache])
import { execFileSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const engine = new URL('..', import.meta.url).pathname, core = join(engine, 'core'), out = join(engine, 'page', 'core.wasm')
const built = join(core, 'target', 'wasm32-unknown-unknown', 'release', 'village_core.wasm')
const cache = join(homedir(), '.village', 'engine', 'core-cache')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: core, encoding: 'utf8' }).trim()

/** A clone where the disk can (APFS), a copy elsewhere, written beside and renamed so a reader never sees half. */
const place = (from, to) => {
  const part = `${to}.${process.pid}.part`
  copyFileSync(from, part, constants.COPYFILE_FICLONE)
  renameSync(part, to)
}

/** The key of what is committed under core/ and the compiler, or null when core/ has changes or git cannot say. */
const key = () => {
  if (process.argv.includes('--no-cache')) return null
  try {
    if (run('git', ['status', '--porcelain', '--', '.']) !== '') return null
    const tree = run('git', ['rev-parse', 'HEAD:./'])
    const rustc = run('rustc', ['-V']).replace(/[^\w.-]+/g, '_')
    return `${tree}-${rustc}`
  } catch { return null }
}

const k = key(), kept = k && join(cache, `${k}.wasm`)
if (kept && existsSync(kept)) {
  place(kept, out)
  console.log(`core: kept build ${k.slice(0, 12)}`)
} else {
  execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: core, stdio: 'inherit' })
  place(built, out)
  if (kept) { mkdirSync(cache, { recursive: true }); place(built, kept) }
}
