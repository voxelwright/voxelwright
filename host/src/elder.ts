// The Elder's kernel is Cordis, as in the home. The `elder` service holds two
// registries: executors (which agent edits a candidate) and checks (which the
// controller runs afterwards). Each plugin adds itself through a Cordis effect,
// so disposing the plugin's fiber removes it again.
import type { Context } from 'cordis'

export interface Candidate {
  id: string
  /** Holds repo/, result.json, logs and the screenshot. Outside the running checkout. */
  runDir: string
  repo: string
  baseCommit: string
  branch: string
}

export interface ExecutorTask {
  dir: string
  prompt: string
  timeoutMs: number
  logFile: string
}

export interface ExecutorOutcome {
  status: 'completed' | 'failed' | 'timeout'
  exitCode: number | null
  /** The model the executor reported it ran with, or the one requested when it reported none. */
  model: string
  durationMs: number
  detail?: string
}

export interface Executor {
  run(task: ExecutorTask): Promise<ExecutorOutcome>
}

export interface CheckResult {
  pass: boolean
  /** false when the check was skipped because the executor did not complete. */
  ran?: boolean
  durationMs: number
  detail?: unknown
}

export interface Check {
  run(candidate: Candidate): Promise<Omit<CheckResult, 'durationMs'>>
}

export class Elder {
  readonly executors = new Map<string, Executor>()
  /** Run in insertion order. */
  readonly checks = new Map<string, Check>()
}

declare module 'cordis' {
  interface Context {
    elder: Elder
  }
}

export const core = {
  name: 'elder',
  apply(ctx: Context) {
    ctx.provide('elder', new Elder())
  },
}

/** Add an entry to one of the Elder's registries for the lifetime of ctx. */
export function register<T>(ctx: Context, registry: Map<string, T>, name: string, value: T): void {
  ctx.effect(() => {
    registry.set(name, value)
    return () => registry.delete(name)
  }, name)
}
