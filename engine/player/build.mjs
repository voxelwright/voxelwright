// The player as static files (#419): everything player/index.html needs, in one folder that any host of plain
// files can serve.
//
//   node player/build.mjs [--out dist]
//
// The page server strips the types from each .ts as it is asked for (serve.mjs). A host of plain files cannot, and
// would send .ts as a video: so the same stripper (Node's own) is run here once, over every module the player
// reaches, and each address that ends in .ts is written with .js. Nothing is bundled or made smaller: what runs is
// what is in page/, file for file. The folder keeps the engine's own layout (player/, page/, probe/), so that the
// addresses modules ask for beside themselves (a worker, the core) are right wherever the folder is put.
import { stripTypeScriptTypes } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const out = resolve(root, arg('out', 'dist'))
/** An address beside the module that names it, ending in .ts: what is imported, and what a worker is started from. */
const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.ts\b/g
const js = (text) => text.replace(NAMED, '$1$2$3.js')

rmSync(out, { recursive: true, force: true })
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
const put = (path, body) => { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), body) }

// Every module the player's page reaches, each stripped once. Imports of types alone are gone with the types, so they bring nothing in.
// The landing world (#421) is built beside the player: its pages, and the plain files they ask for.
const pages = ['player/index.html', 'player/host.html', 'landing/index.html'], modules = new Set(), todo = []
const reach = (from, text) => { for (const [, , , path] of text.matchAll(NAMED)) { const to = relative(root, resolve(root, dirname(from), `${path}.ts`)); if (!modules.has(to)) { modules.add(to); todo.push(to) } } }
for (const page of pages) { const text = readFileSync(join(root, page), 'utf8'); reach(page, text); put(page, js(text)) }
// The Voxelmorphism kit's renderer (#430) is built beside them: a page that uses the kit imports blocks/renderer.js.
modules.add('blocks/renderer.ts'); todo.push('blocks/renderer.ts')
// The kit itself (#434) beside its renderer: its modules with their .ts addresses written .js (the renderer they import is
// reached above), and its stylesheet and fonts as they are. Its showcase, tools and notes stay out.
for (const file of files(join(root, 'kit/src')).map((f) => relative(root, f))) {
  const text = readFileSync(join(root, file), 'utf8')
  if (file.endsWith('.js')) { reach(file, text); put(file, js(text)) } else put(file, text)
}
// Of the fonts only the files the stylesheet names, with each family's licence where it has one. The kit's own faces
// (Vox Text, and Vox Block and Vox Sign inside the stylesheet) have no licence yet: this folder is for looking at on
// this machine, and goes to no host until the owner says so.
const sheet = readFileSync(join(root, 'kit/voxelmorphism.css'), 'utf8')
put('kit/voxelmorphism.css', sheet)
for (const [, font] of sheet.matchAll(/url\("?(fonts\/[^")]+)/g)) {
  cpSync(join(root, 'kit', font), join(out, 'kit', font))
  const licence = join('kit', dirname(font), 'OFL.txt')
  if (existsSync(join(root, licence))) cpSync(join(root, licence), join(out, licence))
}
while (todo.length) {
  const path = todo.pop(), text = stripTypeScriptTypes(readFileSync(join(root, path), 'utf8'))
  reach(path, text)
  put(path.replace(/\.ts$/, '.js'), js(text))
}
if (!existsSync(join(root, 'page/core.wasm'))) { console.error('page/core.wasm is not built: npm run core'); process.exit(1) }
cpSync(join(root, 'page/core.wasm'), join(out, 'page/core.wasm'))
cpSync(join(root, 'player/scenes'), join(out, 'player/scenes'), { recursive: true })
cpSync(join(root, 'landing/scenes'), join(out, 'landing/scenes'), { recursive: true })
if (existsSync(join(root, 'landing/site'))) cpSync(join(root, 'landing/site'), join(out, 'landing/site'), { recursive: true })

// What was written, and what it weighs as a host would send it.
let raw = 0, gz = 0, br = 0
for (const file of files(out)) { const body = readFileSync(file); raw += statSync(file).size; gz += gzipSync(body, { level: 9 }).length; br += brotliCompressSync(body).length }
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`${relative(process.cwd(), out) || '.'}: ${files(out).length} files, ${modules.size} modules (${[...modules].sort().join(' ')})`)
console.log(`${kb(raw)} as written, ${kb(gz)} gzip, ${kb(br)} brotli. Open player/index.html from any host of plain files.`)
