import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

export interface ProcResult {
  /** null when the process was killed or never started. */
  code: number | null
  timedOut: boolean
  /** Set when the command could not be started (ENOENT, EACCES and so on). */
  spawnError?: string
  stdout: string
  stderr: string
  durationMs: number
}

export interface ProcOptions {
  cwd: string
  /** Passed as the whole environment. Callers build it from an allowlist; nothing is inherited. */
  env: NodeJS.ProcessEnv
  /** Required: a whole number of milliseconds from 1 to MAX_TIMEOUT_MS. */
  timeoutMs: number
  /** stdout and stderr are also appended here. */
  logFile?: string
}

/** How long output may keep arriving after the process exits, from descendants holding the pipes. */
const PIPE_GRACE_MS = 1000
/** How long SIGTERM gets before SIGKILL. */
const KILL_GRACE_MS = 5000

/** The longest deadline any command may get. */
export const MAX_TIMEOUT_MS = 60 * 60_000

/** Returns ms when it is a usable deadline; throws otherwise. NaN, 0, negatives, Infinity and fractions are refused. */
export function checkTimeoutMs(ms: number): number {
  if (!Number.isInteger(ms) || ms < 1 || ms > MAX_TIMEOUT_MS) throw new RangeError(`Timeout must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, got ${ms}`)
  return ms
}

/**
 * Run a command in its own process group. It rejects only for an invalid
 * timeout, before anything starts; a spawn error is returned as spawnError. On timeout the whole group gets SIGTERM, then
 * SIGKILL. The promise resolves at the deadline (plus the kill grace) or once
 * the process has exited, without waiting for a descendant that left the
 * group and still holds stdout or stderr open.
 */
export function exec(cmd: string, args: string[], options: ProcOptions): Promise<ProcResult> {
  const started = performance.now()
  try {
    checkTimeoutMs(options.timeoutMs)
  } catch (error) {
    return Promise.reject(error)
  }
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError: string | undefined
    let exitCode: number | null = null
    let settled = false
    const timers: NodeJS.Timeout[] = []
    const log = options.logFile ? createWriteStream(options.logFile, { flags: 'a' }) : undefined

    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const finish = () => {
      if (settled) return
      settled = true
      for (const t of timers) clearTimeout(t)
      child.stdout?.destroy()
      child.stderr?.destroy()
      log?.end()
      resolve({ code: exitCode, timedOut, spawnError, stdout, stderr, durationMs: Math.round(performance.now() - started) })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk
      log?.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk
      log?.write(chunk)
    })
    child.on('error', (error) => {
      spawnError = String(error)
      finish()
    })
    child.on('exit', (code) => {
      exitCode = code
      // Let buffered output drain, but do not wait on pipes an escaped descendant holds.
      timers.push(setTimeout(finish, PIPE_GRACE_MS))
    })
    child.on('close', finish)
    timers.push(
      setTimeout(() => {
        timedOut = true
        killGroup(child.pid, 'SIGTERM')
        timers.push(
          setTimeout(() => {
            killGroup(child.pid, 'SIGKILL')
            finish()
          }, KILL_GRACE_MS),
        )
      }, options.timeoutMs),
    )
  })
}

export function killGroup(pid: number | undefined, name: NodeJS.Signals): void {
  if (!pid) return
  try {
    process.kill(-pid, name)
  } catch {
    // The group has already exited.
  }
}

/** Environment variables a child may inherit from the controller. Everything else is dropped. */
const INHERITED = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR']

/** The controller's environment reduced to the allowlist, plus explicit additions. */
export function allowedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of INHERITED) if (process.env[name] !== undefined) env[name] = process.env[name]
  return { ...env, ...extra }
}

/**
 * git that ignores hooks, fsmonitor, global and system config. Use it for
 * every git call on a candidate: the executor can write the candidate's .git.
 */
export function git(args: string[], cwd: string): Promise<ProcResult> {
  const safe = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null']
  return exec('git', [...safe, ...args], {
    cwd,
    env: allowedEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }),
    timeoutMs: 60_000,
  })
}

/** Run git, require success, and return its trimmed stdout. */
export async function mustGit(args: string[], cwd: string): Promise<string> {
  const result = await git(args, cwd)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed (${result.code}${result.spawnError ? `, ${result.spawnError}` : ''}): ${result.stderr.trim()}`)
  return result.stdout.trim()
}
