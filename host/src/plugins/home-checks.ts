// Checks the controller runs on a candidate home, in order. A run passes only
// on the out-of-page gates:
//
// - controller-files: every path outside home/src/plugins/ (kernel, main.ts,
//   configs, package files, scripts, node_modules, .git) is byte-identical to
//   the candidate's state before the executor ran, and plugins/ holds only
//   regular files. So the kernel, main.ts and the in-page helpers that later
//   checks call are the trusted base versions.
// - build: tsc and vite build exit 0, run under srt.
// - screenshot: no page errors seen through CDP, the screenshot is not blank,
//   and it differs from the base render taken before the executor ran.
//
// plugin-lifecycle calls window.village, which candidate plugin code shares a
// page with and can replace. Its result is in-page evidence: a failure is a
// warning in result.json, and neither a pass nor a failure changes the status.
//
// Browser: Playwright's headless Chrome with Chrome's own renderer sandbox on
// (Playwright turns it off by default). srt cannot host Chrome on macOS; see
// sandbox.ts. The page's network goes to a dead proxy except for the preview
// server on loopback.
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { chromium, type Page } from 'playwright'
import { PNG } from 'pngjs'
import { diffManifests, manifest, type Manifest } from '../candidate.ts'
import { register, type Candidate } from '../elder.ts'
import { killGroup } from '../proc.ts'
import { createSandbox } from '../sandbox.ts'

const home = (c: Candidate) => join(c.repo, 'home')
const bin = (c: Candidate, name: string) => join(home(c), 'node_modules', '.bin', name)

/**
 * Vite's default config loader bundles vite.config.ts into node_modules/.vite-temp,
 * which the sandbox keeps read-only; since the villager proxy (#40) the config
 * imports node modules and every build failed with EPERM. The runner loader
 * evaluates the config in memory instead.
 */
const VITE_CONFIG_LOADER = ['--configLoader', 'runner']
/** One page visit, preview server and browser included, must finish within this. */
export const PAGE_DEADLINE_MS = 60_000
/** A pixel counts as changed when a channel moves by more than this (0 to 255). */
const PIXEL_DELTA = 40
/** The screenshot must differ from the base render in more than this share of pixels. */
export const MIN_CHANGED_SHARE = 0.0005
/** Below this luminance standard deviation the screenshot counts as blank. */
const MIN_LUMA_STDDEV = 4

/** For tests: replace the Chrome launch, e.g. to simulate a launch failure. */
export const browserLauncher = { launch: launchChrome }

export default {
  name: 'home-checks',
  inject: ['elder'],
  apply(ctx: Context) {
    const { checks } = ctx.elder
    const baseManifests = new Map<string, Manifest>()
    const baseRenders = new Map<string, Buffer | string>()

    register(ctx, checks, 'controller-files', {
      async prepare(c) {
        baseManifests.set(c.id, await manifest(c.repo))
      },
      async run(c) {
        const before = baseManifests.get(c.id)
        if (!before) return { pass: false, detail: 'No manifest was taken before the executor ran' }
        const diff = diffManifests(before, await manifest(c.repo))
        return {
          pass: diff.controllerOwned.length === 0,
          detail: diff.controllerOwned.length ? { error: `Candidate changed controller-owned paths: ${diff.controllerOwned.join(', ')}`, ...diff } : diff,
        }
      },
    })

    register(ctx, checks, 'build', {
      async run(c) {
        const result = await build(c, join(c.runDir, 'build.log'))
        return result.ok ? { pass: true } : { pass: false, detail: result.detail }
      },
    })

    register(ctx, checks, 'screenshot', {
      async prepare(c) {
        // Base render: the unmodified home, built and shot before the executor runs.
        const built = await build(c, join(c.runDir, 'base-build.log'))
        if (!built.ok) return void baseRenders.set(c.id, `Base build failed: ${JSON.stringify(built.detail)}`)
        const shot = await withPage(c, '', async (page) => ({ pass: true, detail: await page.screenshot() }))
        if (!shot.pass || !Buffer.isBuffer(shot.detail)) return void baseRenders.set(c.id, `Base render failed: ${JSON.stringify(shot.detail)}`)
        await writeFile(join(c.runDir, 'base.png'), shot.detail)
        baseRenders.set(c.id, shot.detail)
      },
      async run(c) {
        const base = baseRenders.get(c.id)
        if (!Buffer.isBuffer(base)) return { pass: false, detail: base ?? 'No base render' }
        return withPage(c, '', async (page, pageErrors) => {
          const path = join(c.runDir, 'screenshot.png')
          const shot = await page.screenshot({ path })
          const image = PNG.sync.read(shot)
          const lumaStddev = Math.round(stddevLuma(image) * 10) / 10
          const changedShare = changedPixels(image, PNG.sync.read(base))
          const gates = {
            noPageErrors: pageErrors.length === 0,
            notBlank: lumaStddev >= MIN_LUMA_STDDEV,
            differsFromBase: changedShare > MIN_CHANGED_SHARE,
          }
          return {
            pass: Object.values(gates).every(Boolean),
            detail: { path, gates, pageErrors, lumaStddev, changedShare, minChangedShare: MIN_CHANGED_SHARE, basePath: join(c.runDir, 'base.png') },
          }
        })
      },
    })

    register(ctx, checks, 'plugin-lifecycle', {
      evidence: 'in-page',
      async run(c) {
        const added = await addedPlugins(c, baseManifests.get(c.id))
        if (!added.length) return { pass: false, detail: 'No new plugin file under home/src/plugins/' }
        const proof: Record<string, unknown> = {}
        let pass = true
        for (const name of added) {
          const result = await withPage(c, '', async (page, pageErrors) => {
            const before = await snapshot(page)
            if (!before.plugins.active.includes(name)) return { pass: false, detail: `Plugin ${name} is not active`, plugins: before.plugins }
            await page.evaluate((n) => (window as any).village.unload(n), name)
            await page.waitForTimeout(300)
            const unloaded = await snapshot(page)
            await page.evaluate((n) => (window as any).village.load(n), name)
            await page.waitForTimeout(300)
            const reloaded = await snapshot(page)
            const others = before.plugins.active.filter((p) => p !== name).join(',')
            const baseline = await withPage(c, `?plugins=${others}`, async (p) => ({ pass: true, detail: await snapshot(p) }))
            const unloadMatchesBaseline = baseline.pass && same(unloaded, baseline.detail as Snap)
            const reloadMatchesBefore = same(reloaded, before)
            return {
              pass: unloadMatchesBaseline && reloadMatchesBefore && pageErrors.length === 0,
              detail: { unloadMatchesBaseline, reloadMatchesBefore, pageErrors, before: brief(before), unloaded: brief(unloaded), reloaded: brief(reloaded) },
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

/** tsc then vite build under srt, with no network. Removes any earlier build output first. */
async function build(c: Candidate, logFile: string): Promise<{ ok: boolean; detail?: unknown }> {
  await rm(join(home(c), 'dist'), { recursive: true, force: true })
  const sandbox = await createSandbox({ repo: c.repo, network: 'none' })
  try {
    // Call the tools directly rather than `npm run build`, so package.json scripts never run.
    for (const [tool, args] of [['tsc', ['--noEmit']], ['vite', ['build', ...VITE_CONFIG_LOADER]]] as const) {
      const result = await sandbox.run(bin(c, tool), [...args], { cwd: home(c), timeoutMs: 120_000, logFile })
      if (result.code !== 0) return { ok: false, detail: { step: tool, exitCode: result.code, timedOut: result.timedOut, spawnError: result.spawnError, output: (result.stdout + result.stderr).slice(-3000) } }
    }
    return { ok: true }
  } finally {
    await sandbox.dispose()
  }
}

interface Snap {
  plugins: { registered: string[]; active: string[]; failed: Record<string, string> }
  objects: string[]
  sceneObjects: number
  frameHooks: number
  geometries: number
  fog: boolean
  backend: string
}

const snapshot = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).village.snapshot())
const brief = ({ objects: _, ...rest }: Snap) => rest
/** Same scene graph, frame listeners, geometry count and fog. Plugin lists may differ. */
const same = (a: Snap, b: Snap) =>
  a.objects.join('|') === b.objects.join('|') && a.frameHooks === b.frameHooks && a.geometries === b.geometries && a.fog === b.fog

/** Plugin names declared in files the candidate added under home/src/plugins/. */
async function addedPlugins(c: Candidate, before: Manifest | undefined): Promise<string[]> {
  if (!before) return []
  const { added } = diffManifests(before, await manifest(c.repo))
  const names: string[] = []
  for (const file of added.filter((p) => p.startsWith('home/src/plugins/') && p.endsWith('.ts'))) {
    const name = /\bname:\s*['"]([^'"]+)['"]/.exec(await readFile(join(c.repo, file), 'utf8'))?.[1]
    if (name) names.push(name)
  }
  return names
}

function stddevLuma({ data }: PNG): number {
  let sum = 0
  let sumSq = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += y
    sumSq += y * y
  }
  return Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2))
}

/** Share of pixels where any channel moved by more than PIXEL_DELTA. 1 when the sizes differ. */
function changedPixels(a: PNG, b: PNG): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let changed = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > PIXEL_DELTA || Math.abs(a.data[i + 1] - b.data[i + 1]) > PIXEL_DELTA || Math.abs(a.data[i + 2] - b.data[i + 2]) > PIXEL_DELTA) changed++
  }
  return Math.round((changed / (a.width * a.height)) * 1e5) / 1e5
}

type PageResult = { pass: boolean; detail?: unknown; [key: string]: unknown }

function launchChrome(proxyBypass: string, tmp: string) {
  return chromium.launch({
    channel: 'chrome',
    // Headless only: the owner works on this Mac and a visible window steals focus.
    headless: true,
    chromiumSandbox: true,
    env: { PATH: '/usr/bin:/bin', HOME: tmp, TMPDIR: tmp },
    args: [
      '--enable-unsafe-webgpu',
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      // Every request but the preview server goes to a closed port. <-loopback> drops
      // Chrome's implicit bypass for localhost, so other local servers are not reachable.
      '--proxy-server=http://127.0.0.1:9',
      `--proxy-bypass-list=<-loopback>;${proxyBypass}`,
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  })
}

/**
 * Serve the built candidate with vite preview under srt, open it in headless
 * Chrome and wait for the home. Preview and browser share one cleanup scope
 * and one deadline; both are stopped however fn ends.
 */
async function withPage(c: Candidate, query: string, fn: (page: Page, pageErrors: string[]) => Promise<PageResult>): Promise<PageResult> {
  if (!existsSync(join(home(c), 'dist', 'index.html'))) return { pass: false, detail: 'No build output to serve' }
  const sandbox = await createSandbox({ repo: c.repo, network: 'loopback' })
  let server: ReturnType<typeof sandbox.start> | undefined
  let launching: ReturnType<typeof launchChrome> | undefined
  let deadline: NodeJS.Timeout | undefined
  const visit = async (): Promise<PageResult> => {
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    server = sandbox.start(bin(c, 'vite'), ['preview', ...VITE_CONFIG_LOADER, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], home(c))
    launching = browserLauncher.launch(`127.0.0.1:${port}`, sandbox.tmp)
    const browser = await launching
    await waitForServer(`${origin}/`)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    page.on('crash', () => pageErrors.push('Page crashed'))
    page.on('console', (m) => {
      // The home ships no favicon; Chrome's own request for one is not an error in the candidate.
      if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) pageErrors.push(`${m.text()} (${m.location().url})`)
    })
    await page.goto(`${origin}/${query}`)
    // In-page signal, used only to know when to look. A home that never says ready still fails.
    const ready = await page
      .waitForFunction(() => (window as any).village?.ready(), undefined, { timeout: 20_000 })
      .then((h) => h.jsonValue() as Promise<{ ok: boolean }>, () => undefined)
    if (!ready?.ok) return { pass: false, detail: { error: 'Home did not report every plugin active within 20 s', ready, pageErrors } }
    await page.waitForTimeout(2000)
    return await fn(page, pageErrors)
  }
  try {
    return await Promise.race([
      visit(),
      new Promise<PageResult>((resolve) => {
        deadline = setTimeout(() => resolve({ pass: false, detail: `Page visit exceeded ${PAGE_DEADLINE_MS} ms` }), PAGE_DEADLINE_MS)
      }),
    ])
  } catch (error) {
    return { pass: false, detail: String(error) }
  } finally {
    clearTimeout(deadline)
    // A launch still in flight at the deadline is closed once it lands.
    const closing = launching?.then((b) => b.close()).catch(() => {})
    await Promise.race([closing, new Promise((r) => setTimeout(r, 5000))])
    killGroup(server?.pid, 'SIGKILL')
    await sandbox.dispose()
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
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`vite preview did not start at ${url}`)
}
