// What the realm's build reads from ~/.village and git does not hold (#450), carried to CI as one GitHub Release asset:
// the pinned release (engine/sf/pilot/current.json), the street graphs the road's marks come from, and the kept car.
// Every file is stored as Brotli: the release's as the quality-11 copies sf/build.mjs keeps in
// ~/.village/engine/sf/br (so CI writes them back there and compresses nothing again), the rest at quality 9.
//
//   node deploy/data.mjs pack    on the machine that has ~/.village, after the pin moves: bundles, uploads the bundle
//                                as release `sf-data-<digest>` (once: an existing one is left as it is) and writes
//                                deploy/data.json, which is committed with the pin
//   node deploy/data.mjs pack-local PIN DIRECTORY   writes DIRECTORY/TAG/data.tar and DIRECTORY/data.json for a staged release
//   node deploy/data.mjs fetch   in CI: downloads the bundle deploy/data.json names, checks it is for the pin and that
//                                every file is the one packed, and writes it all under $HOME/.village
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)), repo = dirname(here)
const VILLAGE = join(homedir(), '.village', 'engine'), CACHE = join(VILLAGE, 'sf', 'br'), RECORD = join(here, 'data.json')
const localPack = process.argv[2] === 'pack-local'
if (localPack && (process.argv.length !== 5 || !/^[0-9a-f]{64}$/.test(process.argv[3]))) throw new Error('usage: node deploy/data.mjs pack-local PIN DIRECTORY')
const pin = localPack ? process.argv[3] : JSON.parse(readFileSync(join(repo, 'engine/sf/pilot/current.json'), 'utf8')).release
const sha = (b) => createHash('sha256').update(b).digest('hex')
/** sf/build.mjs's name for a file's quality-11 copy in its cache. */
const cached = (body) => join(CACHE, `${createHash('sha256').update(body).update('q11').digest('hex')}.br`)
const fail = (why) => { console.error(`data: ${why}`); process.exit(1) }
// Links are followed: a staged release shares library folders between generations by linking them (sf/release.md).
const files = (dir) => readdirSync(dir).filter((name) => !name.startsWith('.')).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]))
// The bundle is a release of this repository, wherever the checkout's remote points.
const REPO = process.env.GITHUB_REPOSITORY ?? 'voxelwright/voxelwright'
const gh = (command, ...args) => execFileSync('gh', ['release', command, '--repo', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// macOS's default pax archive adds AppleDouble files and extended attributes for each member.
// ustar needs only file bodies and portable headers. Give them a neutral owner on BSD and GNU tar.
function archiveBundle(work, archive) {
  const owner = process.platform === 'darwin'
    ? ['--no-mac-metadata', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root']
    : ['--owner=0', '--group=0', '--numeric-owner']
  execFileSync('tar', [...owner, '--format', 'ustar', '-cf', archive, '-C', work, 'index.json', 'files'])
}

// Private Actions jobs already supply GH_TOKEN. Send it only to GitHub's API.
async function download(tag, archive) {
  const base = process.env.VOXELWRIGHT_DATA_URL
  let url = new URL(`${base ?? `https://github.com/${REPO}/releases/download`}/${tag}/data.tar`)
  let headers = {}
  if (!base && process.env.GH_TOKEN && process.env.GITHUB_REPOSITORY) {
    headers = { Authorization: `Bearer ${process.env.GH_TOKEN}` }
    const release = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers })
    if (!release.ok) throw new Error(`GitHub release lookup returned HTTP ${release.status}`)
    const asset = (await release.json()).assets.find(a => a.name === 'data.tar')
    if (!asset) throw new Error(`No data.tar in ${tag}`)
    url = new URL(`https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`)
    headers.Accept = 'application/octet-stream'
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('VOXELWRIGHT_DATA_URL requires HTTPS or a loopback mirror')
  }
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`Cannot download ${tag}/data.tar (HTTP ${response.status}). Check VOXELWRIGHT_DATA_URL.`)
  await pipeline(response.body, createWriteStream(archive))
}

// What the build reads, under ~/.village/engine (sf/build.mjs: STAGED, GRAPHS and SHELF).
const RELEASE = `bay/450-city-paint/sf/releases/${pin}`
const INPUTS = [RELEASE, 'bay/sf-450-city/packs/graph', 'kept-cars/shelf/1cb43f52cfc96e74e974e0a7.json']

if (localPack || process.argv[2] === 'pack') {
  if (sha(readFileSync(join(VILLAGE, RELEASE, 'manifest.json'))) !== pin) fail('staged manifest differs from pin')
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
  const archive = join(work, 'data.tar')
  const record = JSON.stringify({ pin, digest, tag }, null, 2) + '\n'
  try {
    if (localPack) {
      const directory = process.argv[4]
      mkdirSync(join(directory, tag), { recursive: true })
      archiveBundle(work, archive)
      copyFileSync(archive, join(directory, tag, 'data.tar'))
      writeFileSync(join(directory, 'data.json'), record)
      console.log(`${tag}: ${index.length} files, ${statSync(archive).size} bytes, index SHA-256 ${digest}`)
    } else {
      const there = (() => { try { gh('view', tag, '--json', 'tagName'); return true } catch { return false } })()
      if (there) console.log(`${tag} is uploaded already`)
      else {
        archiveBundle(work, archive)
        gh('create', tag, archive, '--title', `SF realm data ${pin.slice(0, 12)}`, '--notes', `The inputs the realm's build reads from ~/.village for pin ${pin} (deploy/data.mjs).`, '--latest=false')
        console.log(`uploaded ${tag}: ${index.length} files`)
      }
      writeFileSync(RECORD, record)
      console.log(`wrote deploy/data.json for pin ${pin.slice(0, 12)}: commit it with the pin`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
} else if (process.argv[2] === 'fetch') {
  const record = JSON.parse(readFileSync(RECORD, 'utf8'))
  if (record.pin !== pin) fail(`deploy/data.json is for pin ${record.pin.slice(0, 12)} but engine/sf/pilot/current.json pins ${pin.slice(0, 12)}: run node deploy/data.mjs pack and commit deploy/data.json`)
  const work = mkdtempSync(join(tmpdir(), 'sf-data-'))
  try {
    await download(record.tag, join(work, 'data.tar'))
    const archive = join(work, 'data.tar')
    const listing = execFileSync('tar', ['-xOf', archive, 'index.json'], { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    if (sha(listing) !== record.digest) throw new Error(`${record.tag} is not the bundle deploy/data.json names`)
    const { files: index } = JSON.parse(listing)
    // The pinned index determines which members tar can restore. Older archives also hold private clips.
    const publicFiles = index.filter(f => INPUTS.some(path => f.path === path || f.path.startsWith(path + '/')))
    const members = join(work, 'members')
    writeFileSync(members, publicFiles.map(f => `files/${f.path}.br\n`).join(''))
    execFileSync('tar', ['-xf', archive, '-C', work, '-T', members], { stdio: ['ignore', 'ignore', 'pipe'] })
    mkdirSync(CACHE, { recursive: true })
    for (const f of publicFiles) {
      const member = join(work, 'files', `${f.path}.br`)
      if (!lstatSync(member).isFile()) throw new Error(`${f.path} is not a regular file`)
      const brotli = readFileSync(member), body = brotliDecompressSync(brotli)
      if (body.length !== f.bytes || sha(body) !== f.sha256) throw new Error(`${f.path} is not the file that was packed`)
      mkdirSync(dirname(join(VILLAGE, f.path)), { recursive: true })
      writeFileSync(join(VILLAGE, f.path), body)
      if (f.q11) writeFileSync(cached(body), brotli)
    }
    console.log(`${record.tag}: ${publicFiles.length} files restored for pin ${pin.slice(0, 12)} under ${VILLAGE}`)
  } catch (error) {
    console.error(`data: ${error.message}`)
    process.exitCode = 1
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
} else fail('usage: node deploy/data.mjs pack|pack-local PIN DIRECTORY|fetch')
