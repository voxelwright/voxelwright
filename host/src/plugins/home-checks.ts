// Checks the controller runs on a candidate home. The browser script lives
// here in host/, not in the candidate, so the model cannot rewrite the check.
// It still reads `window.village`, which the candidate's main.ts defines; the
// run records any diff to main.ts, kernel.ts or scripts/ so tampering shows.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Context } from 'cordis'
import { chromium, type Page } from 'playwright'
import { register, type Candidate } from '../elder.ts'
import { exec, must } from '../proc.ts'

const home = (c: Candidate) => join(c.repo, 'home')
const bin = (c: Candidate, name: string) => join(home(c), 'node_modules', '.bin', name)

export default {
  name: 'home-checks',
  inject: ['elder'],
  apply(ctx: Context) {
    const { checks } = ctx.elder

    register(ctx, checks, 'build', {
      async run(c) {
        // Call the tools directly rather than `npm run build`: the model may have edited package.json.
        for (const [tool, args] of [['tsc', ['--noEmit']], ['vite', ['build']]] as const) {
          const result = await exec(bin(c, tool), [...args], { cwd: home(c), timeoutMs: 120_000 })
          if (result.code !== 0) return { pass: false, detail: { step: tool, output: (result.stdout + result.stderr).slice(-3000) } }
        }
        return { pass: true }
      },
    })

    register(ctx, checks, 'screenshot', {
      async run(c) {
        return withPage(c, '', async (page, errors) => {
          const path = join(c.runDir, 'screenshot.png')
          await page.screenshot({ path })
          const { backend } = await snapshot(page)
          return { pass: errors.length === 0, detail: { path, backend, consoleErrors: errors } }
        })
      },
    })

    register(ctx, checks, 'plugin-lifecycle', {
      async run(c) {
        const added = await addedPlugins(c)
        if (!added.length) return { pass: false, detail: 'No new plugin file under home/src/plugins/' }
        const proof: Record<string, unknown> = {}
        let pass = true
        for (const name of added) {
          const result = await withPage(c, '', async (page, errors) => {
            const before = await snapshot(page)
            if (!before.plugins.includes(name)) return { pass: false, detail: `Plugin ${name} is not loaded by main.ts` }
            await page.evaluate((n) => (window as any).village.unload(n), name)
            await page.waitForTimeout(300)
            const unloaded = await snapshot(page)
            await page.evaluate((n) => (window as any).village.load(n), name)
            await page.waitForTimeout(300)
            const reloaded = await snapshot(page)
            const others = before.plugins.filter((p) => p !== name).join(',')
            const baseline = await withPage(c, `?plugins=${others}`, async (p) => ({ pass: true, detail: await snapshot(p) }))
            const unloadMatchesBaseline = same(unloaded, baseline.detail as Snap)
            const reloadMatchesBefore = same(reloaded, before)
            return {
              pass: unloadMatchesBaseline && reloadMatchesBefore && errors.length === 0,
              detail: { unloadMatchesBaseline, reloadMatchesBefore, consoleErrors: errors, before: brief(before), unloaded: brief(unloaded), reloaded: brief(reloaded) },
            }
          })
          proof[name] = result.detail
          pass &&= result.pass
        }
        return { pass, detail: proof }
      },
    })
  },
}

interface Snap {
  plugins: string[]
  objects: string[]
  sceneObjects: number
  frameHooks: number
  geometries: number
  fog: boolean
  drawSwapped: boolean
  backend: string
}

const snapshot = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).village.snapshot())
const brief = ({ objects: _, ...rest }: Snap) => rest
/** Same scene graph, frame listeners, geometry count, fog and draw function. Plugin lists may differ. */
const same = (a: Snap, b: Snap) =>
  a.objects.join('|') === b.objects.join('|') &&
  a.frameHooks === b.frameHooks &&
  a.geometries === b.geometries &&
  a.fog === b.fog &&
  a.drawSwapped === b.drawSwapped

/** Plugin names declared in files the candidate added under home/src/plugins/. */
async function addedPlugins(c: Candidate): Promise<string[]> {
  const untracked = await must('git', ['ls-files', '--others', '--exclude-standard', 'home/src/plugins'], c.repo)
  const committed = await must('git', ['diff', '--name-only', '--diff-filter=A', c.baseCommit, '--', 'home/src/plugins'], c.repo)
  const files = [...new Set([...untracked.split('\n'), ...committed.split('\n')].filter(Boolean))]
  const names: string[] = []
  for (const file of files) {
    const name = /\bname:\s*['"]([^'"]+)['"]/.exec(await readFile(join(c.repo, file), 'utf8'))?.[1]
    if (name) names.push(name)
  }
  return names
}

type PageResult = { pass: boolean; detail?: unknown }

/** Serve the built candidate with vite preview, open it in headless Chrome and wait for every plugin. */
async function withPage(c: Candidate, query: string, fn: (page: Page, errors: string[]) => Promise<PageResult>): Promise<PageResult> {
  if (!existsSync(join(home(c), 'dist', 'index.html'))) return { pass: false, detail: 'No build output to serve' }
  const port = await freePort()
  const server = spawn(bin(c, 'vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: home(c),
    stdio: 'ignore',
    detached: true,
  })
  const browser = await chromium.launch({
    channel: 'chrome',
    // Headless only: the owner works on this Mac and a visible window steals focus.
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
  })
  try {
    const url = `http://127.0.0.1:${port}/${query}`
    await waitForServer(url)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const errors: string[] = []
    page.on('console', (m) => {
      // The home ships no favicon; Chrome's own request for one is not an error in the candidate.
      if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`${m.text()} (${m.location().url})`)
    })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(url)
    const ready = await page
      .waitForFunction(() => (window as any).village?.ready(), undefined, { timeout: 20_000 })
      .then(() => true, () => false)
    if (!ready) return { pass: false, detail: { error: 'Home did not report ready within 20 s', consoleErrors: errors } }
    await page.waitForTimeout(2000)
    return await fn(page, errors)
  } finally {
    await browser.close()
    try {
      process.kill(-server.pid!, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`vite preview did not start at ${url}`)
}
