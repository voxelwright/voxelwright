// Runs candidate-influenced Node tools (npm ci, tsc, vite build, vite preview)
// under Anthropic's sandbox runtime (`srt`, Seatbelt on macOS). The policy:
// reads denied under the home directory and the user temp directory except the
// candidate, the Node install and a per-run temp directory; secrets and .env
// files denied even there; writes only to the candidate's home/ (not its
// node_modules) and the temp directory; no network except loopback, or the npm
// registry for the install; an allowlisted environment with HOME set to the
// temp directory.
//
// Chrome does not run under srt: its profile has no mach-register, and Chrome
// aborts when bootstrap_check_in is denied. home-checks.ts relies on Chrome's
// own renderer sandbox instead (see there).
import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec, type ProcResult } from './proc.ts'

const srt = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'srt')
/** The Node install running the controller: …/bin/node → … */
const nodePrefix = dirname(dirname(process.execPath))
/**
 * The controller's real home and temp directories, as absolute paths. srt
 * expands `~` with its own os.homedir(), which reads the HOME this module sets
 * to the per-run temp directory, so a `~` rule would deny only that.
 */
export const deniedRoots = [realpathSync(homedir()), realpathSync(tmpdir())]
/** The Elder's own npm cache. The trusted lockfile's integrity hashes guard what comes out of it. */
export const npmCache = join(homedir(), '.village', 'npm-cache')

export interface SandboxPolicy {
  /** The candidate's repo/. Readable; only its home/ is writable. */
  repo: string
  network: 'none' | 'loopback' | 'npm'
}

export interface Sandbox {
  tmp: string
  run(cmd: string, args: string[], options: { cwd: string; timeoutMs: number; logFile?: string }): Promise<ProcResult>
  /** Start a long-running sandboxed server (vite preview) in its own process group. Stop it with killGroup. */
  start(cmd: string, args: string[], cwd: string): ChildProcess
  dispose(): Promise<void>
}

export async function createSandbox(policy: SandboxPolicy): Promise<Sandbox> {
  // Short path on purpose: srt puts its proxy's Unix socket here, and macOS caps socket paths at 104 bytes.
  const tmp = await mkdtemp(join(tmpdir(), 'elder-'))
  const home = join(policy.repo, 'home')
  const settings = {
    network: {
      allowedDomains: policy.network === 'npm' ? ['registry.npmjs.org'] : [],
      deniedDomains: [],
      allowLocalBinding: policy.network === 'loopback',
    },
    filesystem: {
      denyRead: [...deniedRoots, '/Library/Keychains', '**/.env', '**/.env.*'],
      allowRead: [policy.repo, nodePrefix, tmp, ...(policy.network === 'npm' ? [npmCache] : [])],
      allowWrite: [home, tmp, ...(policy.network === 'npm' ? [npmCache] : [])],
      denyWrite: policy.network === 'npm' ? [] : [join(home, 'node_modules')],
    },
  }
  const settingsPath = join(tmp, 'srt-settings.json')
  await writeFile(settingsPath, JSON.stringify(settings, null, 2))
  // The whole environment of every sandboxed process. Nothing is inherited from the controller.
  const env = {
    PATH: `${join(nodePrefix, 'bin')}:/usr/bin:/bin`,
    HOME: tmp,
    TMPDIR: tmp,
    LANG: 'en_US.UTF-8',
    npm_config_cache: npmCache,
    npm_config_update_notifier: 'false',
  }
  return {
    tmp,
    start: (cmd, args, cwd) => spawn(srt, ['--settings', settingsPath, '--', cmd, ...args], { cwd, env, stdio: 'ignore', detached: true }),
    run: (cmd, args, options) => exec(srt, ['--settings', settingsPath, '--', cmd, ...args], { ...options, env }),
    dispose: () => rm(tmp, { recursive: true, force: true }),
  }
}
