// Writes deploy/dist, the one folder zahynailo.dev serves (#450):
//   - the SF realm (engine/dist-sf, from `node engine/sf/build.mjs`) at the root: its sf/ folder (the page, the
//     release pointer, the release, kept things, eggs, credits) becomes "/", beside the engine's page/, kit/, blocks/
//     and bay/, so every address the page makes from its own location (../page/main.js, current.json, kept/, eggs/)
//     resolves as it does locally;
//   - the site (site/dist, from `npm run build` in site/ with its base "/blog/") as it is: blog/, robots.txt, 404.html.
// The Brotli copies are kept only where worker.mjs sends them (releases/, bay/); the platform compresses the rest.
//
//   node deploy/assemble.mjs [--realm engine/dist-sf] [--site site/dist]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)), repo = dirname(here)
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return resolve(repo, at > 0 ? process.argv[at + 1] : fallback) }
const realm = arg('realm', 'engine/dist-sf'), site = arg('site', 'site/dist'), out = join(here, 'dist')
const fail = (why) => { console.error(`assemble: ${why}`); process.exit(1) }
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))

if (!existsSync(join(realm, 'sf', 'index.html'))) fail(`${relative(repo, realm)} holds no realm: node engine/sf/build.mjs`)
if (!existsSync(join(site, 'blog', 'index.html'))) fail(`${relative(repo, site)} holds no blog at blog/: cd site && npm run build`)
rmSync(out, { recursive: true, force: true })

/** Where each source file goes, by its published path; two sources for one path is an error. */
const placed = new Map()
const place = (from, path) => {
  if (placed.has(path)) fail(`/${path} comes from both ${relative(repo, placed.get(path))} and ${relative(repo, from)}`)
  placed.set(path, from)
}
const SENT_BY_WORKER = (path) => path.startsWith('releases/') || path.startsWith('bay/')
for (const file of files(realm)) {
  let path = relative(realm, file).split(sep).join('/')
  if (path.startsWith('sf/')) path = path.slice(3)
  if (path.endsWith('.br') && !SENT_BY_WORKER(path)) continue
  place(file, path)
}
let siteHeaders = ''
for (const file of files(site)) {
  const path = relative(site, file).split(sep).join('/')
  if (path === '_headers') { siteHeaders = readFileSync(file, 'utf8'); continue }
  place(file, path)
}
for (const [path, from] of placed) { mkdirSync(dirname(join(out, path)), { recursive: true }); cpSync(from, join(out, path)) }

// One _headers for the one folder: the realm's rules, then the site's (already written for /blog/).
writeFileSync(join(out, '_headers'), [
  '# The realm (engine/dist-sf). The release pointer is asked for every time, so a new pin shows at once; the release',
  '# itself and the binary files are sent by worker.mjs, which sets their headers.',
  '/current.json',
  '  Cache-Control: no-cache',
  '',
  siteHeaders,
].join('\n'))

const all = files(out), bytes = all.reduce((n, f) => n + statSync(f).size, 0), biggest = Math.max(...all.map((f) => statSync(f).size))
console.log(`deploy/dist: ${all.length} files, ${(bytes / 1048576).toFixed(1)} MB, largest ${(biggest / 1048576).toFixed(1)} MB`)
if (all.length > 20000) fail('more than 20,000 files: over the Workers Free plan limit for static assets')
if (biggest > 25 * 1048576) fail('a file over 25 MiB: over the Workers limit for one static asset')
