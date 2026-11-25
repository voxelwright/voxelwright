// The San Francisco realm as a static folder (#450, stage 1): the engine's own page (page/main.ts) run alone, with
// the realm's record (sf/realm.json) in the page, a pinned release of the city's tiles beside it (sf/release.md), and
// its kept living things. Any host of plain files serves it: no page server, no world's process, no helper.
//
//   node sf/build.mjs [--out dist-sf] [--from <full_run.py output>] [--far <far.json>] [--staged <a staged sf folder>] [--street-manifest <a release manifest>] [--car <shelf record>] [--quality 11]
//
// By default the page takes the combined release the data lane staged (`450-city-paint/sf`: tiles, names, graphs,
// street life, cars and the far model), copying its pointer and the one release it names; that release must be the one
// pinned in sf/pilot/current.json. `--staged` takes another staged folder, so the page follows whichever release its
// pointer names. `--from` (with `--far`) makes one with sf/release.py, the data lane's one owner of its layout, from
// the verified output of bay/full_run.py. Every file a host sends is also written Brotli-compressed beside itself
// (`<file>.br`), for a host to send with `Content-Encoding: br` (player/serve.mjs does, as R2 objects stored with that
// encoding would). A host that does not send the plain file, which is the same release: nothing is lost but bytes.
//
// Modules are written as player/build.mjs writes them: Node's own stripper over each module the page reaches, with
// `.ts` addresses written `.js`, nothing bundled. The tiles, the car and this folder never go in git.
import { stripTypeScriptTypes } from 'node:module'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { eggOverlay, landingVideos } from '../../site/lib/egg-overlay.mjs'
import { memes } from './add-egg.mjs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { brotliCompressSync, constants } from 'node:zlib'
import { marksBytes, marksIn, said, squaresBytes } from './marks.mjs'
import { seated } from './boards.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const out = resolve(root, arg('out', 'dist-sf'))
const VILLAGE = join(homedir(), '.village', 'engine')
const PUBLICATION = join(VILLAGE, 'bay', '450-accuracy', 'publication')
// The combined pilot release (far, street life, cars, graphs, names) as the data lane staged it: the pin.
const STAGED = join(VILLAGE, 'bay', '450-city-paint', 'sf')
const from = resolve(arg('from', PUBLICATION)), far = arg('far', null), staged = arg('staged', arg('from', null) || far ? null : STAGED)
const SHELF = join(VILLAGE, 'kept-cars', 'shelf')
const PYTHON = join(VILLAGE, 'bay', 'venv', 'bin', 'python')
const quality = Number(arg('quality', '11'))
const realm = JSON.parse(readFileSync(join(root, 'sf', 'realm.json'), 'utf8'))
// Its billboards and banner (sf/boards.json, edited with sf/boards.mjs): in the page's own record, so nothing more is asked for.
realm.signs = seated(JSON.parse(readFileSync(join(root, 'sf', 'boards.json'), 'utf8')))

// A module the page reaches is TypeScript (stripped) or the engine's own JavaScript shared with Node (make/*.mjs: the
// maker, page/maker.ts): both are written `.js`, which every host sends as a script.
const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.(ts|mjs)\b/g
const js = (text) => text.replace(NAMED, '$1$2$3.js')
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
const put = (path, body) => { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), body) }
const fail = (why) => { console.error(why); process.exit(1) }
rmSync(out, { recursive: true, force: true })

// The release pins both the producer indexes and every file they name. Keep their relative URLs.
const streetManifest = arg('street-manifest', '')
if (streetManifest) {
  const source = resolve(streetManifest), bytes = readFileSync(source)
  const hash = (b) => createHash('sha256').update(b).digest('hex')
  const pin = hash(bytes), manifest = JSON.parse(bytes)
  if (basename(dirname(source)) !== pin) throw new Error('street manifest differs from its pin')
  for (const kind of ['life', 'cars']) {
    const lib = manifest[kind]
    if (!lib || lib.index.path !== kind + '/index.json') throw new Error('missing ' + kind + ' index')
    for (const obj of [lib.index, ...Object.values(lib.objects)]) {
      if (!new RegExp('^' + kind + '/[a-zA-Z0-9_.-]+\\.json$').test(obj.path)) throw new Error('invalid library path')
      const body = readFileSync(join(dirname(source), obj.path))
      if (body.length !== obj.bytes || hash(body) !== obj.sha256) throw new Error('changed object ' + obj.path)
      put('sf/releases/' + pin + '/' + obj.path, body)
    }
    realm.street[kind] = 'releases/' + pin + '/' + kind + '/'
  }
}

// ── The page and every module it reaches ──
const modules = new Set(), todo = []
const reachOf = (from, text) => { for (const [, , , path, ext] of text.matchAll(NAMED)) { const to = relative(root, resolve(root, dirname(from), `${path}.${ext}`)); if (!modules.has(to)) { modules.add(to); todo.push(to) } } }
modules.add('page/main.ts'); todo.push('page/main.ts')
while (todo.length) {
  const path = todo.pop(), source = readFileSync(join(root, path), 'utf8'), text = path.endsWith('.ts') ? stripTypeScriptTypes(source) : source
  reachOf(path, text)
  put(path.replace(/\.(ts|mjs)$/, '.js'), js(text))
}
// The maker in the page (page/maker.ts) must reach nothing of Node: a module that imports it would not load there.
for (const path of modules) if (path.endsWith('.mjs') && /\bfrom\s*['"]node:|\bimport\s*['"]node:/.test(readFileSync(join(root, path), 'utf8'))) fail(`${path} imports Node at its top, and the page reaches it`)
if (!existsSync(join(root, 'page/core.wasm'))) fail('page/core.wasm is not built: npm run core')
cpSync(join(root, 'page/core.wasm'), join(out, 'page/core.wasm'))
// ── The realm's controls (page/realm-ui.ts): the Voxelmorphism kit beside the page ──
// The page asks for the kit by address, not by import, so the walk above does not reach it: its modules (the .js as
// they are, with .ts addresses written .js), the engine's renderer they draw with (blocks/renderer.ts and what it
// reaches), its stylesheet, and every font it names: IBM Plex for text, and the kit's own faces (page/typeface.ts picks
// which of them sets the legends on the keys and the lettering on the boards).
{
  const kitTodo = []
  for (const file of files(join(root, 'kit/src')).map((f) => relative(root, f))) {
    const text = readFileSync(join(root, file), 'utf8')
    if (!file.endsWith('.js')) continue
    for (const [, , , path, ext] of text.matchAll(NAMED)) { const to = relative(root, resolve(root, dirname(file), `${path}.${ext}`)); if (!modules.has(to)) { modules.add(to); kitTodo.push(to) } }
    put(file, js(text))
  }
  while (kitTodo.length) {
    const path = kitTodo.pop(), text = stripTypeScriptTypes(readFileSync(join(root, path), 'utf8'))
    for (const [, , , to, ext] of text.matchAll(NAMED)) { const next = relative(root, resolve(root, dirname(path), `${to}.${ext}`)); if (!modules.has(next)) { modules.add(next); kitTodo.push(next) } }
    put(path.replace(/\.ts$/, '.js'), js(text))
  }
  // The stylesheet as it is, and each font file it names beside it (with Plex's OFL.txt).
  const sheet = readFileSync(join(root, 'kit/voxelmorphism.css'), 'utf8')
  put('kit/voxelmorphism.css', sheet)
  for (const [, font] of sheet.matchAll(/url\("?(fonts\/[^")]+)/g)) {
    mkdirSync(dirname(join(out, 'kit', font)), { recursive: true })
    copyFileSync(join(root, 'kit', font), join(out, 'kit', font))
    const ofl = join('kit', dirname(font), 'OFL.txt')
    if (existsSync(join(root, ofl))) copyFileSync(join(root, ofl), join(out, ofl))
  }
  // What the controls and the faces need is there.
  for (const need of ['page/realm-ui.js', 'page/weather.js', 'page/typeface.js', 'kit/src/index.js', 'kit/src/engine.js', 'kit/src/core/fonts/block.js', 'kit/src/core/fonts/zakon.js', 'blocks/renderer.js', 'blocks/stage.js', 'kit/voxelmorphism.css', 'kit/fonts/ibm-plex-sans/ibm-plex-sans-latin-wght-normal.woff2', 'kit/fonts/vox-text/vox-text-400-normal.woff2', 'kit/fonts/vox-zakon/vox-zakon-text-400-normal.woff2']) {
    if (!existsSync(join(out, need))) { console.error(`${need} is not in ${relative(root, out)}: the realm's controls would not work`); process.exit(1) }
  }
}
// The engine's page with the realm's record in it, and its script beside it.
const page = readFileSync(join(root, 'page/index.html'), 'utf8')
if (!page.includes('src="/page/main.ts"')) fail('page/index.html no longer loads /page/main.ts: change the build')

// ── The city: a release, written by its owner, or as a run staged it ──
if (realm.release !== 'current.json') fail('sf/realm.json must name its release pointer: "release": "current.json"')
if (staged) {
  // As a run staged it: a pointer and the one release it names. The data lane's folder keeps releases side by side, so
  // from it the page takes the one this checkout pins (sf/pilot/current.json), and moving one checkout's pin leaves
  // every other checkout's build as it was. Another staged folder: the release its own pointer names.
  const pointerAt = staged === STAGED ? join(root, 'sf', 'pilot', 'current.json') : join(staged, 'current.json')
  if (!existsSync(pointerAt)) fail(`${pointerAt} is missing`)
  const named = JSON.parse(readFileSync(pointerAt, 'utf8'))
  if (!existsSync(join(staged, named.manifest))) fail(`${staged} holds no release ${named.release}: stage it (sf/release.md)`)
  cpSync(pointerAt, join(out, 'sf', 'current.json'))
  // Not what a run keeps beside it for itself (`.bay-store`, a link to its store of objects): only the release's files.
  cpSync(join(staged, dirname(named.manifest)), join(out, 'sf', dirname(named.manifest)), { recursive: true, filter: (path) => !basename(path).startsWith('.') })
} else {
  if (!existsSync(PYTHON)) fail(`${PYTHON} is missing: the Bay's Python environment (bay/README.md)`)
  const made = spawnSync(PYTHON, [join(root, 'sf', 'release.py'), from, join(out, 'sf'), ...(far ? ['--far', far] : [])], { encoding: 'utf8' })
  if (made.status !== 0) fail(`sf/release.py failed:\n${made.stdout}${made.stderr}`)
}
const pointer = JSON.parse(readFileSync(join(out, 'sf', 'current.json'), 'utf8'))
const pinned = JSON.parse(readFileSync(join(root, 'sf', 'pilot', 'current.json'), 'utf8'))
if (staged === STAGED && pointer.release !== pinned.release) fail(`${STAGED} names release ${pointer.release}, not the pinned ${pinned.release} (sf/pilot/current.json)`)
const manifest = JSON.parse(readFileSync(join(out, 'sf', pointer.manifest), 'utf8'))
const tiles = manifest.levels.reduce((n, l) => n + Object.keys(l.tiles).length, 0), sea = manifest.levels.reduce((n, l) => n + l.sea.length, 0)
// Street life and its vehicles from the release where it has them (page/street.ts reads their indexes).
if (realm.street && manifest.life && manifest.cars && !streetManifest) for (const kind of ['life', 'cars']) realm.street[kind] = `${dirname(pointer.manifest)}/${kind}/`
// The far model: in the release where it has one (main.ts gives far.ts the pinned manifest), else beside the page as
// sf/far/pack.mjs wrote it.
const farFrom = arg('far-folder', join(VILLAGE, 'sf', 'far', 'release'))
const farApart = realm.far && !manifest.far && existsSync(join(farFrom, 'far.json'))
if (farApart) { cpSync(join(farFrom, 'far.json'), join(out, 'sf', 'far.json')); cpSync(join(farFrom, 'far'), join(out, 'sf', 'far'), { recursive: true }) }
else if (realm.far && !manifest.far) console.log(`  no far model in the release or at ${farFrom}: the realm draws cells all the way`)
// Landmarks by rule (#450, core/src/heroes.rs): where each stands, read by every core (bay.ts `open`).
mkdirSync(join(out, 'bay'), { recursive: true })
copyFileSync(join(root, 'sf/heroes.json'), join(out, 'bay/heroes.json'))
// The road's paint and rails for the whole city (#450, sf/marks.mjs), from the city run's street graphs (the release
// holds the pilot's six), drawn by the march (page/marks.ts). Without them every street but the pilot's kept the bake's
// 50 cm blocks of paint, so a build without them fails.
const GRAPHS = arg('graphs', join(VILLAGE, 'bay', 'sf-450-city', 'packs', 'graph'))
if (!existsSync(GRAPHS)) fail(`no street graphs for the road's marks at ${GRAPHS} (--graphs <the city run's packs/graph>)`)
const marksMade = marksIn(GRAPHS), marks = marksBytes(marksMade)
writeFileSync(join(out, 'bay/marks.bin'), marks)
// The squares they cover alone, for every core at once (page/bay.ts); the marks come after the first picture.
writeFileSync(join(out, 'bay/marks-squares.bin'), squaresBytes(marksMade))
console.log(`  road marks: ${said(marks)}`)
// The loader (page/loading.html): the realm's name and its first view under fog, there from the first byte (just after
// the engine's canvas, which main.ts takes as the page's first). Its pictures are sf/loading.json (sf/loading.mjs),
// each written beside the page under a name of its bytes; the loader asks for the one its window frames, and lays its
// fog from what the page carries of them (their size, sky and skyline) before it comes. Without them its fog lies over
// the sky's colours alone. The page's script is asked for from the head (modulepreload), so that the loader's bytes
// before its tag do not hold its request back on a slow link.
const loadingAt = join(root, 'sf/loading.json'), shots = existsSync(loadingAt) ? JSON.parse(readFileSync(loadingAt, 'utf8')) : null
if (!shots) console.log('  no sf/loading.json: the loader shows no picture (node sf/loading.mjs)')
else if (shots.release !== pointer.release) console.log(`  sf/loading.json was taken from release ${shots.release.slice(0, 12)}, not this build's ${pointer.release.slice(0, 12)}: take it again if the first view changed (node sf/loading.mjs)`)
const escaped = realm.name.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const pictures = shots && Object.fromEntries(['wide', 'upright'].map((k) => {
  const bytes = Buffer.from(shots[k].picture.slice(shots[k].picture.indexOf(',') + 1), 'base64'), file = `loading-${k}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.webp`
  put(`sf/${file}`, bytes)
  return [k, { file, size: shots[k].size, sky: shots[k].sky, skyline: shots[k].skyline }]
}))
const loader = readFileSync(join(root, 'page/loading.html'), 'utf8').replaceAll('{{name}}', () => escaped).replace('/*pictures*/null', () => JSON.stringify(pictures))
// The engine's page with the realm's record in it (as the release made it), and its script beside it.
if (!page.includes('<body>\n<canvas></canvas>\n')) fail('page/index.html no longer opens its body with its canvas: change where the loader goes')
put('sf/index.html', page.replace('<title>Village engine</title>', `<title>${realm.name}</title><link rel="icon" href="data:,"><link rel="modulepreload" href="../page/main.js">`).replace('<body>\n<canvas></canvas>\n', () => `<body${eggOverlay ? ' data-egg-media' : ''}>\n<canvas></canvas>\n${loader}\n`).replace('<script type="module" src="/page/main.ts">', `<script type="application/json" id="realm">${JSON.stringify(realm).replace(/</g, '\\u003c')}</script>\n<script type="module" src="../page/main.js">`))

// Only the private build installs media and gives its clips lockers.
const MEMES = eggOverlay ? memes() : []
const EGG_VIDEOS = eggOverlay ? [...landingVideos, 'matrix.m4a', ...MEMES.map((m) => `${m.id}.mp4`)] : []
const lockers = JSON.parse(readFileSync(join(root, 'sf/lockers.json'), 'utf8'))
put('sf/eggs/lockers.json', JSON.stringify(eggOverlay ? lockers : lockers.filter((l) => ['matrix', 'roll', 'lives'].includes(l.egg))))
put('sf/eggs/memes.json', JSON.stringify(MEMES))
for (const file of EGG_VIDEOS) copyFileSync(join(eggOverlay, file), join(out, 'sf/eggs', file))

// ── Kept living things ──
for (const k of realm.kept ?? []) {
  mkdirSync(dirname(join(out, 'sf', k.file)), { recursive: true })
  const kept = spawnSync(process.execPath, [join(root, 'sf/kept.mjs'), arg('car', join(SHELF, '1cb43f52cfc96e74e974e0a7.json')), join(out, 'sf', k.file), '--name', 'grey saloon'], { encoding: 'utf8' })
  if (kept.status !== 0) fail(kept.stderr)
}

// ── The shelf (#526, page/maker.ts): what came with the engine (make/kept), made in the page from its cells with no
// model where the realm's rules let a visitor make things. An index the word rule reads (make/meant.mjs), and a file a
// thing, fetched only once the bar is used. Not the asker's own shelf on this machine (~/.village/engine/library):
// what came with the engine only. Each is kept as cells (`made`): a page runs no program, so one without is no use.
// What a thing is called is what it is (a market stall, a saloon car): a make's name is a trademark, and a shelf for
// visitors names none (sf/kept.mjs).
if (realm.rules?.making) {
  const { library } = await import('../make/library.mjs')
  const entries = await library(join(out, '.no-shelf'), [join(root, 'make', 'kept')]).all()
  const index = []
  for (const e of entries.sort((a, b) => a.id.localeCompare(b.id))) {
    if (!e.made) fail(`make/kept/${basename(e.file)} has no cells (made): a page cannot make it`)
    index.push({ id: e.id, wish: e.wish, words: e.words, name: e.name, apart: e.apart ?? '', fields: e.fields ?? [] })
    put(`sf/shelf/${e.id}.json`, JSON.stringify({ wish: e.wish, words: e.words, name: e.name, apart: e.apart ?? '', fields: e.fields ?? [], form: e.form, made: e.made, proved: e.proved }))
  }
  put('sf/shelf/index.json', JSON.stringify(index))
  console.log(`  the shelf: ${index.length} kept things (${index.map((e) => e.name).join(', ')})`)
}

// ── Street life (#450, page/street.ts) not in the release: each square's graph (sf/life.py) and the kept vehicles (sf/cars.mjs) ──
if (realm.street && !(manifest.life && manifest.cars) && !streetManifest) {
  cpSync(join(root, 'sf/pilot-life'), join(out, 'sf', realm.street.life), { recursive: true })
  const cars = spawnSync(process.execPath, [join(root, 'sf/cars.mjs'), join(out, 'sf', realm.street.cars)], { encoding: 'utf8' })
  if (cars.status !== 0) fail(cars.stderr)
  console.log(cars.stdout.trimEnd())
}

// ── Whose data it is: shown on the page by bay.ts from the manifest, and written beside it ──
put('sf/CREDITS.txt', [
  ...manifest.credits,
  ...(farApart ? [`The far model (sf/far.json, far/): ${JSON.parse(readFileSync(join(farFrom, 'far.json'), 'utf8')).credit}.`] : []),
  ...(EGG_VIDEOS.length ? ['', 'The eggs\' videos and music (sf/eggs/), used as parody on the owner\'s ruling, for these eggs only: "Never Gonna Give You Up", Rick Astley (1987), Stock Aitken Waterman, RCA Records / Sony Music, video by Simon West; "Bad Apple!! feat. nomico", Alstroemeria Records (Masayoshi Minoshima, after ZUN), shadow-art PV by Anira; music from the soundtrack of "The Matrix" (1999, the Wachowskis, Warner Bros.), as WMG / The Orchard Music. The meme clips, each as its uploader posted it on YouTube, its rights its makers\': ' + MEMES.filter((m) => EGG_VIDEOS.includes(`${m.id}.mp4`)).map((m) => `"${m.source}" (${m.by}, youtu.be/${m.youtube})`).join('; ') + '.'] : []),
  '',
  'Ground, buildings and trees in the baked squares: public domain (DataSF: PDDL). Planet tiles: ODbL 1.0, a derived database under the same licence; terrain: https://mapterhorn.com/attribution. Street colours from Mapillary: CC BY-SA 4.0.',
  '',
].join('\n'))

// ── Brotli beside every file a host sends ──
// Tiles are immutable by their hash, so each is compressed once on this machine and kept by it (quality 11 takes
// about 0.4 s a tile).
const CACHE = join(VILLAGE, 'sf', 'br')
mkdirSync(CACHE, { recursive: true })
let raw = 0, br = 0, code = 0, codeBr = 0, compressed = 0
for (const file of files(out)) {
  if (file.endsWith('.br')) continue
  const body = readFileSync(file), sum = createHash('sha256').update(body).update(`q${quality}`).digest('hex'), cached = join(CACHE, `${sum}.br`)
  let squeezed
  if (existsSync(cached)) squeezed = readFileSync(cached)
  else {
    squeezed = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
    writeFileSync(cached, squeezed)
    compressed++
  }
  // Worth it only where it is smaller, and never for video or music (H.264 and AAC are squeezed already; the eggs').
  const media = /\.(mp4|m4a)$/.test(file)
  if (squeezed.length < body.length && !media) writeFileSync(`${file}.br`, squeezed)
  const sent = media ? body.length : Math.min(squeezed.length, body.length)
  raw += body.length; br += sent
  if (!relative(out, file).startsWith(join('sf', 'releases'))) { code += body.length; codeBr += sent }
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
console.log(`${relative(process.cwd(), out)}: ${modules.size} modules, ${mb(raw)} in all, ${mb(br)} as Brotli (${compressed} compressed now)`)
console.log(`  page, code and kept things: ${mb(code)} (${mb(codeBr)} brotli)`)
console.log(`  release ${pointer.release.slice(0, 12)}${pointer.release === pinned.release ? ' (the pin)' : ''}: ${tiles} tiles, ${sea} sea keys, ${Object.keys(manifest.names).length} names, ${Object.keys(manifest.graph ?? {}).length} graphs, ${Object.keys(manifest.far?.tiles ?? {}).length} far keys; ${mb(raw - code)} (${mb(br - codeBr)} brotli)`)
console.log(`  open sf/index.html from any host of plain files (node player/serve.mjs --dir ${relative(root, out)})`)
