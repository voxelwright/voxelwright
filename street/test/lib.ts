// What the street's checks share (#118): starting the world process and the page's server on
// ports of their own, and a browser that draws with WebGPU.
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser } from 'playwright'

export const here = new URL('..', import.meta.url).pathname
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Starts a command in street/ and waits until it has said `ready`. */
export function start(command: string, argv: string[], ready: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(command, argv, { cwd: here, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let seen = ''
    const on = (chunk: Buffer) => { seen += chunk; if (seen.includes(ready)) resolve(child) }
    child.stdout!.on('data', on)
    child.stderr!.on('data', on)
    child.on('exit', (code) => reject(new Error(`${command} ${argv.join(' ')} ended (${code}):\n${seen}`)))
    setTimeout(() => reject(new Error(`${command} was not ready in 20 s:\n${seen}`)), 20_000)
  })
}
/** The world process on `port` (its /where and /stats on the next one). */
export const startWorld = (port: number, ...argv: string[]) => start('node', ['run.mjs', '--port', String(port), '--http', String(port + 1), ...argv], '/where')
/** The page's server on `port`, passing /where on to the world on `worldPort`. */
export const startPage = (port: number, worldPort: number) => start('npx', ['vite', '--port', String(port)], 'Local', { STREET_HTTP: String(worldPort + 1) })
/** Stops a process and waits until it has gone, so the next one can have its ports. */
export const stop = (child: ChildProcess) => new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill() })
export const browser = (headed = false): Promise<Browser> => chromium.launch({ channel: 'chrome', headless: !headed, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
