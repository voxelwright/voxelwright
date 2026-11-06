import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

export interface ProcResult {
  code: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  durationMs: number
}

export interface ProcOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** stdout and stderr are also appended here. */
  logFile?: string
}

/**
 * Run a command in its own process group. On timeout the whole group gets
 * SIGTERM, then SIGKILL five seconds later, so agent subprocesses stop too.
 */
export function exec(cmd: string, args: string[], options: ProcOptions): Promise<ProcResult> {
  const started = performance.now()
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    const log = options.logFile ? createWriteStream(options.logFile, { flags: 'a' }) : undefined
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk
      log?.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk
      log?.write(chunk)
    })
    let timedOut = false
    let killer: NodeJS.Timeout | undefined
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          signal(child.pid, 'SIGTERM')
          killer = setTimeout(() => signal(child.pid, 'SIGKILL'), 5000)
        }, options.timeoutMs)
      : undefined
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      clearTimeout(killer)
      log?.end()
      resolve({ code, timedOut, stdout, stderr, durationMs: Math.round(performance.now() - started) })
    })
  })
}

function signal(pid: number | undefined, name: NodeJS.Signals): void {
  if (!pid) return
  try {
    process.kill(-pid, name)
  } catch {
    // The group has already exited.
  }
}

/** Run a command that must succeed, and return its trimmed stdout. */
export async function must(cmd: string, args: string[], cwd: string): Promise<string> {
  const result = await exec(cmd, args, { cwd })
  if (result.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${result.code}): ${result.stderr.trim()}`)
  return result.stdout.trim()
}
