// What the realm's build reads from ~/.village and git does not hold (#450), carried to CI as one GitHub Release asset:
// the pinned release (engine/sf/pilot/current.json), the street graphs the road's marks come from, the kept car and
// the eggs' videos. Every file is stored as Brotli: the release's as the quality-11 copies sf/build.mjs keeps in
// ~/.village/engine/sf/br (so CI writes them back there and compresses nothing again), the rest at quality 9.
//
//   node deploy/data.mjs pack    on the machine that has ~/.village, after the pin moves: bundles, uploads the bundle
//                                as release `sf-data-<digest>` (once: an existing one is left as it is) and writes
//                                deploy/data.json, which is committed with the pin
//   node deploy/data.mjs fetch   in CI: downloads the bundle deploy/data.json names, checks it is for the pin and that
//                                every file is the one packed, and writes it all under $HOME/.village
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)), repo = dirname(here)
const VILLAGE = join(homedir(), '.village', 'engine'), CACHE = join(VILLAGE, 'sf', 'br'), RECORD = join(here, 'data.json')
const pin = JSON.parse(readFileSync(join(repo, 'engine/sf/pilot/current.json'), 'utf8')).release
const sha = (b) => createHash('sha256').update(b).digest('hex')
/** sf/build.mjs's name for a file's quality-11 copy in its cache. */
const cached = (body) => join(CACHE, `${createHash('sha256').update(body).update('q11').digest('hex')}.br`)
const fail = (why) => { console.error(`data: ${why}`); process.exit(1) }
// Links are followed: a staged release shares library folders between generations by linking them (sf/release.md).
const files = (dir) => readdirSync(dir).filter((name) => !name.startsWith('.')).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]))
// The bundle is a release of this repository, wherever the checkout's remote points.
const REPO = process.env.GITHUB_REPOSITORY ?? 'the private source repository'
const gh = (command, ...args) => execFileSync('gh', ['release', command, '--repo', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// What the build reads, under ~/.village/engine (sf/build.mjs: STAGED, GRAPHS, SHELF and the eggs' folder).
const RELEASE = `bay/450-city-paint/sf/releases/${pin}`
const INPUTS = [RELEASE, 'bay/sf-450-city/packs/graph', 'kept-cars/shelf/1cb43f52cfc96e74e974e0a7.json', 'sf/eggs/media']

if (process.argv[2] === 'pack') {
  const work = mkdtempSync(join(tmpdir(), 'sf-data-')), index = []
  for (const input of INPUTS) {
    const at = join(VILLAGE, input)
    if (!existsSync(at)) fail(`${at} is missing`)
    for (const file of statSync(at).isDirectory() ? files(at) : [at]) {
      const path = relative(VILLAGE, file).split(sep).join('/'), body = readFileSync(file)
      // The release's own quality-11 copy, which the build made; the rest made here, at quality 9. Without the build's
      // copies CI would compress the whole release again at quality 11, for longer than its run may take.
      if (path.startsWith(RELEASE) && !existsSync(cached(body))) fail(`${path} has no quality-11 copy in ${CACHE}: run node engine/sf/build.mjs first`)
      const brotli = path.startsWith(RELEASE) ? readFileSync(cached(body)) : brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
      mkdirSync(dirname(join(work, 'files', path)), { recursive: true })
      writeFileSync(join(work, 'files', `${path}.br`), brotli)
      index.push({ path, bytes: body.length, sha256: sha(body), q11: path.startsWith(RELEASE) })
    }
  }
  index.sort((a, b) => (a.path < b.path ? -1 : 1))
  const listing = JSON.stringify({ pin, files: index }), digest = sha(listing)
  writeFileSync(join(work, 'index.json'), listing)
  const tag = `sf-data-${digest.slice(0, 16)}`
  const there = (() => { try { gh('view', tag, '--json', 'tagName'); return true } catch { return false } })()
  if (there) console.log(`${tag} is uploaded already`)
  else {
    execFileSync('tar', ['-cf', join(work, 'data.tar'), '-C', work, 'index.json', 'files'])
    gh('create', tag, join(work, 'data.tar'), '--title', `SF realm data ${pin.slice(0, 12)}`, '--notes', `The inputs the realm's build reads from ~/.village for pin ${pin} (deploy/data.mjs). Not a release of the code.`, '--latest=false')
    console.log(`uploaded ${tag}: ${index.length} files`)
  }
  rmSync(work, { recursive: true, force: true })
  writeFileSync(RECORD, `${JSON.stringify({ pin, digest, tag }, null, 2)}\n`)
  console.log(`wrote deploy/data.json for pin ${pin.slice(0, 12)}: commit it with the pin`)
} else if (process.argv[2] === 'fetch') {
  const record = JSON.parse(readFileSync(RECORD, 'utf8'))
  if (record.pin !== pin) fail(`deploy/data.json is for pin ${record.pin.slice(0, 12)} but engine/sf/pilot/current.json pins ${pin.slice(0, 12)}: run node deploy/data.mjs pack and commit deploy/data.json`)
  const work = mkdtempSync(join(tmpdir(), 'sf-data-'))
  gh('download', record.tag, '--pattern', 'data.tar', '--dir', work)
  execFileSync('tar', ['-xf', join(work, 'data.tar'), '-C', work])
  const listing = readFileSync(join(work, 'index.json'), 'utf8')
  if (sha(listing) !== record.digest) fail(`${record.tag} is not the bundle deploy/data.json names`)
  const { files: index } = JSON.parse(listing)
  mkdirSync(CACHE, { recursive: true })
  for (const f of index) {
    const brotli = readFileSync(join(work, 'files', `${f.path}.br`)), body = brotliDecompressSync(brotli)
    if (body.length !== f.bytes || sha(body) !== f.sha256) fail(`${f.path} is not the file that was packed`)
    mkdirSync(dirname(join(VILLAGE, f.path)), { recursive: true })
    writeFileSync(join(VILLAGE, f.path), body)
    if (f.q11) writeFileSync(cached(body), brotli)
  }
  rmSync(work, { recursive: true, force: true })
  console.log(`${record.tag}: ${index.length} files for pin ${pin.slice(0, 12)} under ${VILLAGE}`)
} else fail('usage: node deploy/data.mjs pack|fetch')
