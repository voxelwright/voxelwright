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
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { brotliCompressSync, constants } from 'node:zlib'

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

const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.ts\b/g
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
const reachOf = (from, text) => { for (const [, , , path] of text.matchAll(NAMED)) { const to = relative(root, resolve(root, dirname(from), `${path}.ts`)); if (!modules.has(to)) { modules.add(to); todo.push(to) } } }
modules.add('page/main.ts'); todo.push('page/main.ts')
while (todo.length) {
  const path = todo.pop(), text = stripTypeScriptTypes(readFileSync(join(root, path), 'utf8'))
  reachOf(path, text)
  put(path.replace(/\.ts$/, '.js'), js(text))
}
if (!existsSync(join(root, 'page/core.wasm'))) fail('page/core.wasm is not built: npm run core')
cpSync(join(root, 'page/core.wasm'), join(out, 'page/core.wasm'))
// ── The realm's controls (page/realm-ui.ts): the Voxelmorphism kit beside the page ──
// The page asks for the kit by address, not by import, so the walk above does not reach it: its modules (the .js as
// they are, with .ts addresses written .js), the engine's renderer they draw with (blocks/renderer.ts and what it
// reaches), its stylesheet, and of its fonts only IBM Plex, which has a licence (OFL). The kit's own faces (Vox Text,
// and Vox Block and Vox Sign inlined in the stylesheet) have none yet: they stay out, and the controls set their
// legends in Plex.
{
  const kitTodo = []
  for (const file of files(join(root, 'kit/src')).map((f) => relative(root, f))) {
    const text = readFileSync(join(root, file), 'utf8')
    if (!file.endsWith('.js')) continue
    for (const [, , , path] of text.matchAll(NAMED)) { const to = relative(root, resolve(root, dirname(file), `${path}.ts`)); if (!modules.has(to)) { modules.add(to); kitTodo.push(to) } }
    put(file, js(text))
  }
  while (kitTodo.length) {
    const path = kitTodo.pop(), text = stripTypeScriptTypes(readFileSync(join(root, path), 'utf8'))
    for (const [, , , to] of text.matchAll(NAMED)) { const next = relative(root, resolve(root, dirname(path), `${to}.ts`)); if (!modules.has(next)) { modules.add(next); kitTodo.push(next) } }
    put(path.replace(/\.ts$/, '.js'), js(text))
  }
  // Every @font-face of a face with no licence is taken out of the stylesheet; Plex's files and licences go beside it.
  const sheet = readFileSync(join(root, 'kit/voxelmorphism.css'), 'utf8').replace(/@font-face\s*\{[^}]*font-family:\s*"Vox [^"]*"[^}]*\}\s*/g, '')
  put('kit/voxelmorphism.css', sheet)
  for (const [, font] of sheet.matchAll(/url\("?(fonts\/[^")]+)/g)) {
    if (!existsSync(join(root, 'kit', dirname(font), 'OFL.txt'))) { console.error(`kit font ${font} has no licence beside it: leave it out of the stylesheet`); process.exit(1) }
    mkdirSync(dirname(join(out, 'kit', font)), { recursive: true })
    copyFileSync(join(root, 'kit', font), join(out, 'kit', font))
    copyFileSync(join(root, 'kit', dirname(font), 'OFL.txt'), join(out, 'kit', dirname(font), 'OFL.txt'))
  }
  // What the controls need is there, and no face without a licence.
  for (const need of ['page/realm-ui.js', 'page/weather.js', 'kit/src/index.js', 'kit/src/engine.js', 'blocks/renderer.js', 'blocks/stage.js', 'kit/voxelmorphism.css', 'kit/fonts/ibm-plex-sans/ibm-plex-sans-latin-wght-normal.woff2', 'kit/fonts/ibm-plex-sans/OFL.txt']) {
    if (!existsSync(join(out, need))) { console.error(`${need} is not in ${relative(root, out)}: the realm's controls would not work`); process.exit(1) }
  }
  if (/@font-face\s*\{[^}]*"Vox /.test(sheet) || existsSync(join(out, 'kit/fonts/vox-text'))) { console.error('a kit face without a licence is in the folder'); process.exit(1) }
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
// The engine's page with the realm's record in it (as the release made it), and its script beside it.
put('sf/index.html', page.replace('<title>Village engine</title>', `<title>${realm.name}</title><link rel="icon" href="data:,">`).replace('<script type="module" src="/page/main.ts">', `<script type="application/json" id="realm">${JSON.stringify(realm).replace(/</g, '\\u003c')}</script>\n<script type="module" src="../page/main.js">`))

// ── The eggs' videos (#450, page/eggs.ts): fetched only when an egg starts. From the site's landing, which made them
// (its scripts/landing/encode-eggs.mjs, 160 x 120, -16 LUFS); kept on this machine, never in git. Without them the
// page is the same, and the two video eggs say they didn't load. ──
const eggsFrom = resolve(arg('eggs', join(VILLAGE, 'sf', 'eggs', 'media')))
const EGG_VIDEOS = ['rick.mp4', 'bad-apple.mp4'].filter((f) => existsSync(join(eggsFrom, f)))
for (const f of EGG_VIDEOS) { mkdirSync(join(out, 'sf', 'eggs'), { recursive: true }); copyFileSync(join(eggsFrom, f), join(out, 'sf', 'eggs', f)) }
if (EGG_VIDEOS.length < 2) console.log(`  the eggs' videos are not all at ${eggsFrom}: the video eggs will not load (copy the site's static/landing/eggs/*.mp4 there)`)

// ── Kept living things ──
for (const k of realm.kept ?? []) {
  mkdirSync(dirname(join(out, 'sf', k.file)), { recursive: true })
  const kept = spawnSync(process.execPath, [join(root, 'sf/kept.mjs'), arg('car', join(SHELF, '1cb43f52cfc96e74e974e0a7.json')), join(out, 'sf', k.file), '--name', 'grey saloon'], { encoding: 'utf8' })
  if (kept.status !== 0) fail(kept.stderr)
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
  ...(EGG_VIDEOS.length ? ['', 'The eggs\' videos (sf/eggs/), used as parody on the owner\'s ruling, for these two eggs only: "Never Gonna Give You Up", Rick Astley (1987), Stock Aitken Waterman, RCA Records / Sony Music, video by Simon West; "Bad Apple!! feat. nomico", Alstroemeria Records (Masayoshi Minoshima, after ZUN), shadow-art PV by Anira.'] : []),
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
  // Worth it only where it is smaller.
  if (squeezed.length < body.length) writeFileSync(`${file}.br`, squeezed)
  raw += body.length; br += Math.min(squeezed.length, body.length)
  if (!relative(out, file).startsWith(join('sf', 'releases'))) { code += body.length; codeBr += Math.min(squeezed.length, body.length) }
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
console.log(`${relative(process.cwd(), out)}: ${modules.size} modules, ${mb(raw)} in all, ${mb(br)} as Brotli (${compressed} compressed now)`)
console.log(`  page, code and kept things: ${mb(code)} (${mb(codeBr)} brotli)`)
console.log(`  release ${pointer.release.slice(0, 12)}${pointer.release === pinned.release ? ' (the pin)' : ''}: ${tiles} tiles, ${sea} sea keys, ${Object.keys(manifest.names).length} names, ${Object.keys(manifest.graph ?? {}).length} graphs, ${Object.keys(manifest.far?.tiles ?? {}).length} far keys; ${mb(raw - code)} (${mb(br - codeBr)} brotli)`)
console.log(`  open sf/index.html from any host of plain files (node player/serve.mjs --dir ${relative(root, out)})`)
