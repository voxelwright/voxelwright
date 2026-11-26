// Build guide/ the way Mintlify will publish it: `mint validate` (MDX, config and a
// strict build) and `mint broken-links`. The CLI refuses Node 25, so npx supplies
// Node 22 for it. It runs on a copy, because the CLI writes build files beside the pages.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MINT = 'mint@4.3.96'
const guide = fileURLToPath(new URL('../guide', import.meta.url))
const copy = mkdtempSync(join(tmpdir(), 'guide-'))
try {
  cpSync(guide, copy, { recursive: true })
  execFileSync('npx', ['-y', '-p', 'node@22', '-p', MINT, '-c', 'mint validate && mint broken-links'],
    // The check runner's --webgl preload (NODE_OPTIONS) is for Chrome pages, not for the CLI.
    { cwd: copy, stdio: 'inherit', env: { ...process.env, CI: '1', NODE_OPTIONS: '' } })
} finally {
  rmSync(copy, { recursive: true, force: true })
}
