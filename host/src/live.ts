// The live installation: the home a person actually uses, separate from every
// development checkout and candidate. It is a physical copy of home/ at a
// recorded commit with its own git repository, served by its own Vite dev
// server. Only promotions and rollbacks (src/promote.ts) change it.
//
//   npm run live -- install [--live DIR] [--commit REV]
//   npm run live -- serve [--live DIR] [--port 5183]
//   npm run live -- status [--live DIR]
import { existsSync, realpathSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertNoSharedInodes } from './candidate.ts'
import { liveReload } from './live-vite.ts'
import { allowedEnv, exec, mustGit } from './proc.ts'

export const DEFAULT_LIVE = join(homedir(), '.village', 'live')
/** Commits in the live repository carry this identity; global git config is never read. */
export const ELDER_IDENTITY = ['-c', 'user.name=Village Elder', '-c', 'user.email=elder@village.invalid']
/** Kept out of git, so they never count as uncommitted changes. */
const IGNORED = ['home/node_modules/', 'home/dist/', 'results.jsonl', 'server.json']

export async function install(live: string, source: string, rev = 'HEAD') {
  const target = resolve(live)
  if (existsSync(target)) throw new Error(`There is already a live installation at ${target}. Remove it first to reinstall.`)
  const top = await mustGit(['rev-parse', '--show-toplevel'], source)
  const commit = await mustGit(['rev-parse', '--verify', `${rev}^{commit}`], top)
  await mkdir(target, { recursive: true })
  // git archive writes new files: a physical copy, nothing linked to the checkout.
  const tmp = await mkdtemp(join(tmpdir(), 'village-live-'))
  try {
    const tar = join(tmp, 'home.tar')
    await mustGit(['archive', '--format=tar', '-o', tar, commit, 'home'], top)
    const untar = await exec('tar', ['-xf', tar, '-C', target], { cwd: target, env: allowedEnv(), timeoutMs: 60_000 })
    if (untar.code !== 0) throw new Error(`tar failed: ${untar.stderr}`)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  await writeFile(join(target, '.gitignore'), IGNORED.join('\n') + '\n')
  await writeFile(join(target, 'install.json'), JSON.stringify({ sourceCommit: commit, installedAt: new Date().toISOString() }, null, 2) + '\n')
  await writeFile(join(target, 'promotions.jsonl'), '')
  await mustGit(['init', '--quiet', '-b', 'live'], target)
  await mustGit(['add', '-A'], target)
  await mustGit([...ELDER_IDENTITY, 'commit', '--quiet', '--no-verify', '-m', `Install home at ${commit}`], target)
  const npm = await exec('npm', ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', '--cache', join(homedir(), '.village', 'npm-cache')], {
    cwd: join(target, 'home'),
    env: allowedEnv(),
    timeoutMs: 300_000,
    logFile: join(target, 'home', 'node_modules.install.log'),
  })
  await rm(join(target, 'home', 'node_modules.install.log'), { force: true })
  if (npm.code !== 0) throw new Error(`npm ci failed in the live install: ${npm.stderr.slice(-2000)}`)
  const inodes = await assertNoSharedInodes(top, target)
  return { live: target, sourceCommit: commit, inodes, installMs: npm.durationMs }
}

export async function status(live: string) {
  const target = resolve(live)
  if (!existsSync(join(target, '.git'))) return { live: target, installed: false }
  const installed = JSON.parse(await readFile(join(target, 'install.json'), 'utf8'))
  const lines = (await readFile(join(target, 'promotions.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const dirty = (await mustGit(['status', '--porcelain'], target)).split('\n').filter(Boolean)
  let server: Record<string, unknown> | null = null
  try {
    server = JSON.parse(await readFile(join(target, 'server.json'), 'utf8'))
    const res = await fetch(String(server!.url), { signal: AbortSignal.timeout(2000) }).catch(() => null)
    server!.responding = res?.ok ?? false
  } catch {}
  return {
    live: target,
    installed: true,
    sourceCommit: installed.sourceCommit,
    head: await mustGit(['rev-parse', 'HEAD'], target),
    uncommitted: dirty,
    entries: lines.length,
    last: lines.at(-1) ?? null,
    server,
  }
}

/** Runs the live home's own Vite (its config, its node_modules) with the live-reload plugin added. */
export async function serve(live: string, port: number) {
  // Vite reports watched files by real path (/var is /private/var on macOS).
  const home = join(realpathSync(resolve(live)), 'home')
  const vitePath = createRequire(join(home, 'package.json')).resolve('vite')
  // The host does not depend on vite; this is the live home's own copy.
  const vite = (await import(pathToFileURL(vitePath).href)) as { createServer: (config: object) => Promise<{ listen: () => Promise<unknown>; close: () => Promise<void> }> }
  const server = await vite.createServer({
    root: home,
    configFile: join(home, 'vite.config.ts'),
    plugins: [liveReload(join(home, 'src', 'plugins'))],
    server: { host: '127.0.0.1', port, strictPort: true },
    clearScreen: false,
  })
  await server.listen()
  const url = `http://127.0.0.1:${port}/`
  const info = join(resolve(live), 'server.json')
  await writeFile(info, JSON.stringify({ pid: process.pid, port, url, startedAt: new Date().toISOString() }) + '\n')
  // Vite exits the process on SIGTERM itself, so the record is removed on exit.
  process.on('exit', () => rmSync(info, { force: true }))
  const stop = () => void server.close().finally(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  console.log(JSON.stringify({ serving: url, live: resolve(live) }))
}

if (import.meta.main) {
  const { parseArgs } = await import('node:util')
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { live: { type: 'string', default: DEFAULT_LIVE }, commit: { type: 'string', default: 'HEAD' }, port: { type: 'string', default: '5183' } },
  })
  const command = positionals[0]
  try {
    if (command === 'install') console.log(JSON.stringify(await install(values.live, process.env.INIT_CWD ?? process.cwd(), values.commit), null, 2))
    else if (command === 'status') console.log(JSON.stringify(await status(values.live), null, 2))
    else if (command === 'serve') await serve(values.live, Number(values.port))
    else {
      console.error('Usage: npm run live -- install|serve|status [--live DIR] [--commit REV] [--port N]')
      process.exitCode = 2
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
