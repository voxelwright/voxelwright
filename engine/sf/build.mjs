// The San Francisco realm as a static folder (#450, stage 1): the engine's own page (page/main.ts) run alone, with
// the realm's record (sf/realm.json) in the page, the Bay's tiles round where it begins copied in as plain files, and
// its kept living things. Any host of plain files serves it: no page server, no world's process, no helper.
//
//   node sf/build.mjs [--out dist-sf] [--near 6,2,2] [--car <shelf record>] [--far <dir sf/far/pack.mjs wrote>]
//
// `--near` is how many tiles each way of the realm's start are copied at each level of the Bay's tiles (bay/tiles.py:
// 250 m, 1 km, 4 km): the baked squares' tiles always, and the planet's (bay/earth.py, a cache on this machine) within
// that reach. A tile that is not there is sea (bay.ts). The tiles, the cars and this folder never go in git.
//
// Modules are written as player/build.mjs writes them: Node's own stripper over each module the page reaches, with
// `.ts` addresses written `.js`, nothing bundled.
import { stripTypeScriptTypes } from 'node:module'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { landmarkTiles } from './landmark-tiles.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const out = resolve(root, arg('out', 'dist-sf'))
const reach = arg('near', '6,2,2').split(',').map(Number)
const BAY = join(homedir(), '.village', 'engine', 'bay')
const SHELF = join(homedir(), '.village', 'engine', 'kept-cars', 'shelf')
const realm = JSON.parse(readFileSync(join(root, 'sf', 'realm.json'), 'utf8'))

const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.ts\b/g
const js = (text) => text.replace(NAMED, '$1$2$3.js')
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
const put = (path, body) => { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), body) }
rmSync(out, { recursive: true, force: true })

// ── The page and every module it reaches ──
const modules = new Set(), todo = []
const reachOf = (from, text) => { for (const [, , , path] of text.matchAll(NAMED)) { const to = relative(root, resolve(root, dirname(from), `${path}.ts`)); if (!modules.has(to)) { modules.add(to); todo.push(to) } } }
modules.add('page/main.ts'); todo.push('page/main.ts')
while (todo.length) {
  const path = todo.pop(), text = stripTypeScriptTypes(readFileSync(join(root, path), 'utf8'))
  reachOf(path, text)
  put(path.replace(/\.ts$/, '.js'), js(text))
}
if (!existsSync(join(root, 'page/core.wasm'))) { console.error('page/core.wasm is not built: npm run core'); process.exit(1) }
cpSync(join(root, 'page/core.wasm'), join(out, 'page/core.wasm'))
// The engine's page with the realm's record in it, and its script beside it.
const page = readFileSync(join(root, 'page/index.html'), 'utf8')
if (!page.includes('src="/page/main.ts"')) { console.error('page/index.html no longer loads /page/main.ts: change the build'); process.exit(1) }
const record = `<script type="application/json" id="realm">${JSON.stringify(realm).replace(/</g, '\\u003c')}</script>\n`
put('sf/index.html', page.replace('<title>Village engine</title>', `<title>${realm.name}</title>`).replace('<script type="module" src="/page/main.ts">', `${record}<script type="module" src="../page/main.js">`))

// ── The Bay's tiles ──
const index = JSON.parse(readFileSync(join(BAY, 'packs/tiles/index.json'), 'utf8'))
const [ax, , az] = realm.arrive.at, sizes = index.levels.map((l) => l.size)
const centre = sizes.map((s) => [Math.floor(ax / s), Math.floor(az / s)])
// And round each landmark (#450, sf/landmark-tiles.mjs), so that one stands on ground when one goes to it.
const roundLandmarks = new Set(landmarkTiles().map(([l, x, z]) => `${l}/${x}_${z}`))
// Not where the Bay's own baked tiles already hold the ground at that level or a coarser one: a finer planet tile
// would stand in front of them (a planet tree's flat canopy over the park's eye).
const bakedAt = index.tiles.map((t) => new Set(t.map(([x, z]) => `${x}_${z}`)))
const bakedOver = (level, x, z) => sizes.some((s, l) => l >= level && l < 3 && bakedAt[l].has(`${Math.floor((x * sizes[level]) / s)}_${Math.floor((z * sizes[level]) / s)}`))
const within = (level, x, z) => (Math.abs(x - centre[level][0]) <= reach[level] && Math.abs(z - centre[level][1]) <= reach[level]) || (roundLandmarks.has(`${level}/${x}_${z}`) && !bakedOver(level, x, z))
let baked = 0, earth = 0, sea = 0
put('bay/tiles/index.json', JSON.stringify(index))
for (let level = 0; level < 3; level++) for (const [x, z] of index.tiles[level]) { const name = `${level}/${x}_${z}.bay`; mkdirSync(join(out, 'bay/tiles', String(level)), { recursive: true }); copyFileSync(join(BAY, 'packs/tiles', name), join(out, 'bay/tiles', name)); baked += statSync(join(BAY, 'packs/tiles', name)).size }
const frame = 'bay/earth/10n4250'
for (let level = 0; level < 3; level++) {
  const from = join(BAY, 'earth/tiles/10n4250', String(level))
  if (!existsSync(from)) continue
  const bakedHere = new Set(index.tiles[level].map(([x, z]) => `${x}_${z}`))
  for (const file of readdirSync(from)) {
    const [x, z] = file.slice(0, -4).split('_').map(Number), size = statSync(join(from, file)).size
    if (!within(level, x, z) || bakedHere.has(`${x}_${z}`)) continue
    // An empty tile is all sea: left out, it is sea all the same (bay.ts), and costs a 404 instead of a request.
    if (!size) { sea++; continue }
    mkdirSync(join(out, frame, String(level)), { recursive: true })
    copyFileSync(join(from, file), join(out, frame, String(level), file))
    earth += size
  }
}
// ── The far model (#450, page/far.ts): far.json and its tiles beside the page, as sf/far/pack.mjs wrote them ──
const farFrom = arg('far', join(homedir(), '.village', 'engine', 'sf', 'far', 'release'))
let farBytes = 0
if (realm.far && existsSync(join(farFrom, 'far.json'))) {
  cpSync(join(farFrom, 'far.json'), join(out, 'sf', 'far.json'))
  cpSync(join(farFrom, 'far'), join(out, 'sf', 'far'), { recursive: true })
  for (const file of files(join(out, 'sf', 'far'))) farBytes += statSync(file).size
} else if (realm.far) console.log(`  no far model at ${farFrom}: the realm draws cells all the way (sf/far/pack.mjs makes one)`)
// Landmarks by rule (#450, core/src/heroes.rs): where each stands, read by every core (bay.ts `open`).
mkdirSync(join(out, 'bay'), { recursive: true })
copyFileSync(join(root, 'sf/heroes.json'), join(out, 'bay/heroes.json'))
// Street names and addresses of the squares (bay.ts `whereabouts`).
for (const square of index.squares) copyFileSync(join(BAY, 'packs', `${square}.json`), join(out, 'bay', `${square}.json`))

// ── Kept living things ──
for (const k of realm.kept ?? []) {
  mkdirSync(dirname(join(out, 'sf', k.file)), { recursive: true })
  const made = spawnSync(process.execPath, [join(root, 'sf/kept.mjs'), arg('car', join(SHELF, '1cb43f52cfc96e74e974e0a7.json')), join(out, 'sf', k.file), '--name', 'grey saloon'], { encoding: 'utf8' })
  if (made.status !== 0) { console.error(made.stderr); process.exit(1) }
}

// ── Street life (#450, page/street.ts): each square's graph to walk and drive (sf/life.py), and the kept vehicles (sf/cars.mjs) ──
if (realm.street) {
  cpSync(join(root, 'sf/pilot-life'), join(out, 'sf', realm.street.life), { recursive: true })
  const cars = spawnSync(process.execPath, [join(root, 'sf/cars.mjs'), join(out, 'sf', realm.street.cars)], { encoding: 'utf8' })
  if (cars.status !== 0) { console.error(cars.stderr); process.exit(1) }
  console.log(cars.stdout.trimEnd())
}

// ── Whose data it is: shown on the page by bay.ts, and written beside it ──
put('sf/CREDITS.txt', [
  'Ground, buildings and trees in the baked squares: U.S. Geological Survey 3DEP; USDA NAIP; City and County of San Francisco (DataSF). Public domain (DataSF: PDDL).',
  'Everywhere else: © OpenStreetMap contributors, Overture Maps Foundation (ODbL 1.0; these tiles are a derived database under the same licence); terrain: Mapterhorn (https://mapterhorn.com/attribution).',
  ...(realm.far && existsSync(join(farFrom, 'far.json')) ? [`The far model (sf/far.json, far/): ${JSON.parse(readFileSync(join(farFrom, 'far.json'), 'utf8')).credit}.`] : []),
  '',
].join('\n'))

// ── What it weighs ──
let raw = 0, gz = 0, br = 0, code = 0
const all = files(out)
for (const file of all) {
  const body = readFileSync(file), rel = relative(out, file)
  raw += body.length
  if (rel.startsWith('bay/') || rel.startsWith('sf/far')) continue
  code += body.length; gz += gzipSync(body, { level: 9 }).length; br += brotliCompressSync(body).length
}
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
console.log(`${relative(process.cwd(), out)}: ${all.length} files, ${modules.size} modules, ${mb(raw)} in all`)
console.log(`  page, code and kept things: ${mb(code)} (${mb(gz)} gzip, ${mb(br)} brotli)`)
console.log(`  far model: ${mb(farBytes)} from ${farFrom}`)
console.log(`  tiles: baked ${mb(baked)}, the planet's ${mb(earth)} (${sea} all-sea tiles left out); reach ${reach.join(',')} tiles round ${centre.map((c) => c.join('_')).join(', ')}`)
console.log(`  open sf/index.html from any host of plain files (node player/serve.mjs --dir ${relative(root, out)})`)
