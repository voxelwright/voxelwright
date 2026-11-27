// SPIKE PROTOTYPE (#82, network optimizations). Not a check, not part of `npm run check`, not the release's own tool
// (that is engine/sf/release.py: packs would be made there and named in the manifest).
//
// Writes an OVERLAY folder to lay over a built engine/dist-sf (measure.mjs --overlay): the far model's small objects
// as packs, the index that says which pack holds which object, and page/far.js from this checkout (it reads
// `?farpacks=`). The built folder is not touched.
//
//   node probes/network-82/pack-release.mjs --dist <engine/dist-sf> --out <overlay dir> [--squares 8]
//
// Packs: the landing's cut in one; band 0 (the faces of 4 m and up, 15 KB a tile) by squares of `--squares` tiles a
// side (8 = 4 km). Then open sf/index.html?farpacks=releases/<hash>/packs/index.json
import { stripTypeScriptTypes } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as Z } from 'node:zlib'
import { pack } from './pack.mjs'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const dist = resolve(arg('dist', '')), out = resolve(arg('out', '')), k = Number(arg('squares', '8'))
const engine = resolve(dirname(fileURLToPath(import.meta.url)), '../../engine')
const pin = JSON.parse(readFileSync(join(dist, 'sf/current.json'), 'utf8')), release = join(dist, 'sf', dirname(pin.manifest))
const manifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8')), far = manifest.far
const to = join(out, 'sf', dirname(pin.manifest), 'packs')
mkdirSync(to, { recursive: true })
const br = (b) => brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } })

const index = {}, sets = new Map([['landing', Object.values(far.landing.tiles).map((t) => t.path)]])
for (const [key, recs] of Object.entries(far.tiles)) {
  if (!recs[0]) continue
  const [x, z] = key.split('_').map(Number), name = `far0-${Math.floor(x / k)}_${Math.floor(z / k)}`
  if (!sets.has(name)) sets.set(name, [])
  sets.get(name).push(recs[0].path)
}
let files = 0, bytes = 0, before = 0
for (const [name, paths] of sets) {
  const packed = pack(paths.sort().map((p) => [p, readFileSync(join(release, p))])), squeezed = br(packed)
  writeFileSync(join(to, `${name}.pack`), packed); writeFileSync(join(to, `${name}.pack.br`), squeezed)
  for (const p of paths) { index[p] = `${name}.pack`; before += readFileSync(join(release, `${p}.br`)).length }
  files += paths.length; bytes += squeezed.length
}
writeFileSync(join(to, 'index.json'), JSON.stringify(index))
// The page's far.js, as sf/build.mjs writes a module: types off, `.ts` addresses written `.js`.
const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.(ts|mjs)\b/g
mkdirSync(join(out, 'page'), { recursive: true })
process.removeAllListeners('warning')
writeFileSync(join(out, 'page/far.js'), stripTypeScriptTypes(readFileSync(join(engine, 'page/far.ts'), 'utf8')).replace(NAMED, '$1$2$3.js'))
console.log(`${files} objects (${(before / 1048576).toFixed(2)} MB as .br each) in ${sets.size} packs (${(bytes / 1048576).toFixed(2)} MB as .br), index ${(JSON.stringify(index).length / 1024).toFixed(0)} KB`)
console.log(`open sf/index.html?farpacks=${dirname(pin.manifest)}/packs/index.json`)
