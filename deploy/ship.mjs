// One-command local deploy for both Cloudflare Workers:
//   npm --prefix deploy run ship [-- --world-only | --site-only] [--public] [--skip-build] [--skip-live] [--allow-dirty] [--dry-run]
//
// Automatically picks up ~/.village/engine/sf/eggs/media when present (pass --public for procedural eggs only),
// verifies local `cf` auth up front, builds engine/site/assemble, deploys with the HEAD commit SHA message, and
// checks live endpoints plus engine/test/sf-live.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)), repo = dirname(here)
const DEFAULT_EGG_MEDIA = join(homedir(), '.village', 'engine', 'sf', 'eggs', 'media')

export function parseShipArgs(argv) {
  const flags = new Set(argv)
  const known = new Set(['--world-only', '--site-only', '--public', '--skip-build', '--skip-live', '--allow-dirty', '--dry-run', '--help', '-h'])
  const unknown = argv.filter((a) => !known.has(a))
  if (unknown.length) throw new Error(`unknown argument: ${unknown.join(', ')}`)
  if (flags.has('--world-only') && flags.has('--site-only')) throw new Error('pass at most one of --world-only and --site-only')
  return {
    help: flags.has('--help') || flags.has('-h'),
    world: !flags.has('--site-only'),
    site: !flags.has('--world-only'),
    publicOnly: flags.has('--public'),
    skipBuild: flags.has('--skip-build'),
    skipLive: flags.has('--skip-live'),
    allowDirty: flags.has('--allow-dirty'),
    dryRun: flags.has('--dry-run'),
  }
}

export function resolveEggMedia({ publicOnly, env = process.env, defaultDir = DEFAULT_EGG_MEDIA, exists = existsSync }) {
  if (publicOnly) return null
  if (env.VOXELWRIGHT_EGG_MEDIA) return env.VOXELWRIGHT_EGG_MEDIA
  return exists(defaultDir) ? defaultDir : null
}

export function buildPlan(opts, sha) {
  const steps = []
  if (!opts.skipBuild) {
    steps.push({ label: 'build core wasm', cmd: 'npm', args: ['--prefix', 'engine', 'run', 'core'], cwd: repo })
    steps.push({ label: 'build SF realm', cmd: process.execPath, args: ['engine/sf/build.mjs'], cwd: repo })
    steps.push({ label: 'build personal site & blog', cmd: 'npm', args: ['--prefix', 'site', 'run', 'build'], cwd: repo })
    steps.push({ label: 'assemble deploy folders', cmd: process.execPath, args: ['deploy/assemble.mjs'], cwd: repo })
  }
  if (opts.world) {
    steps.push({ label: 'deploy voxelwright.world', cmd: 'npx', args: ['cf', 'deploy', '--mode', 'world', '--message', sha], cwd: here })
  }
  if (opts.site) {
    steps.push({ label: 'deploy zahynailo.dev', cmd: 'npx', args: ['cf', 'deploy', '--message', sha], cwd: here })
  }
  return steps
}

async function verifyLive(opts) {
  if (opts.world) {
    const pinned = JSON.parse(readFileSync(join(repo, 'engine/sf/pilot/current.json'), 'utf8'))
    const ptrRes = await fetch('https://voxelwright.world/current.json', { cache: 'no-store' })
    if (!ptrRes.ok) throw new Error(`https://voxelwright.world/current.json returned HTTP ${ptrRes.status}`)
    const livePtr = await ptrRes.json()
    if (livePtr.release !== pinned.release) {
      throw new Error(`live release ${livePtr.release} differs from pinned ${pinned.release}`)
    }
    const mapRes = await fetch('https://voxelwright.world/bay/map.bin', { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } })
    if (!mapRes.ok) throw new Error(`https://voxelwright.world/bay/map.bin returned HTTP ${mapRes.status}`)
    const weatherRes = await fetch('https://voxelwright.world/weather')
    if (!weatherRes.ok) throw new Error(`https://voxelwright.world/weather returned HTTP ${weatherRes.status}`)
    console.log(`live ok: voxelwright.world pinned to ${livePtr.release.slice(0, 12)}, /bay/map.bin 200, /weather 200`)
    execFileSync(process.execPath, ['test/sf-live.mjs', '--url', 'https://voxelwright.world/'], { cwd: join(repo, 'engine'), stdio: 'inherit' })
  }
  if (opts.site) {
    for (const url of ['https://zahynailo.dev/', 'https://zahynailo.dev/blog/']) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
    }
    console.log('live ok: zahynailo.dev/ and zahynailo.dev/blog/ returned 200')
  }
}

async function main() {
  const opts = parseShipArgs(process.argv.slice(2))
  if (opts.help) {
    console.log('usage: npm --prefix deploy run ship [-- --world-only | --site-only] [--public] [--skip-build] [--skip-live] [--allow-dirty] [--dry-run]')
    return
  }
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()
  if (dirty && !opts.allowDirty && !opts.dryRun) {
    throw new Error('working tree has uncommitted changes (commit first, or pass --allow-dirty)')
  }
  const eggMedia = resolveEggMedia(opts)
  console.log(`ship ${sha.slice(0, 8)}: targets=${[opts.world && 'voxelwright.world', opts.site && 'zahynailo.dev'].filter(Boolean).join(', ')}, egg media=${eggMedia ? 'included' : 'procedural-only'}`)
  const steps = buildPlan(opts, sha)
  if (opts.dryRun) {
    for (const s of steps) console.log(`  [dry-run] (${s.cwd === here ? 'deploy' : 'repo'}) ${s.cmd} ${s.args.join(' ')}`)
    if (!opts.skipLive) console.log('  [dry-run] verify live endpoints & sf-live.mjs')
    return
  }
  // Fail fast before building if `cf` CLI is not logged in locally.
  try {
    execFileSync('npx', ['cf', 'accounts', 'list'], { cwd: here, stdio: ['ignore', 'ignore', 'pipe'] })
  } catch {
    throw new Error('local `cf` CLI is not authenticated: run `(cd deploy && npx cf auth login)` or set CLOUDFLARE_API_TOKEN')
  }
  const env = { ...process.env }
  if (eggMedia) env.VOXELWRIGHT_EGG_MEDIA = eggMedia
  else delete env.VOXELWRIGHT_EGG_MEDIA
  for (const s of steps) {
    console.log(`\n==> ${s.label}`)
    execFileSync(s.cmd, s.args, { cwd: s.cwd, env, stdio: 'inherit' })
  }
  if (!opts.skipLive) {
    console.log('\n==> live verification')
    await verifyLive(opts)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`ship: ${err.message}`); process.exit(1) })
}
