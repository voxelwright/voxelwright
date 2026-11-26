// Builds the two static asset folders from one realm and one site build:
//   - deploy/dist (zahynailo.dev): the site alone (site/dist, from `npm run build` in site/): the personal page at "/",
//     the blog under "/blog/", robots.txt, 404.html and the site's own _headers. No realm files and no alpha notice.
//   - deploy/dist-world (voxelwright.world): the SF realm (engine/dist-sf, from `node engine/sf/build.mjs`) at the root:
//     its sf/ folder (the page, the release pointer, the release, kept things, eggs, credits) becomes "/", beside the
//     engine's page/, kit/, blocks/ and bay/, with the alpha notice and world canonical/social metadata.
// The Brotli copies are kept only where worker.mjs sends them (releases/, bay/); the platform compresses the rest.
//
//   node deploy/assemble.mjs [--realm engine/dist-sf] [--site site/dist]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withNotice } from './notice.mjs'

const here = dirname(fileURLToPath(import.meta.url)), repo = dirname(here)
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return resolve(repo, at > 0 ? process.argv[at + 1] : fallback) }
const realm = arg('realm', 'engine/dist-sf'), site = arg('site', 'site/dist')
const fail = (why) => { console.error(`assemble: ${why}`); process.exit(1) }
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))

if (!existsSync(join(realm, 'sf', 'index.html'))) fail(`${relative(repo, realm)} holds no realm: node engine/sf/build.mjs`)
if (!existsSync(join(site, 'index.html'))) fail(`${relative(repo, site)} holds no personal page at /: cd site && npm run build`)
if (!existsSync(join(site, 'blog', 'index.html'))) fail(`${relative(repo, site)} holds no blog at blog/: cd site && npm run build`)

const SENT_BY_WORKER = (path) => path.startsWith('releases/') || path.startsWith('bay/')
const worldFiles = new Map()
const placeWorld = (from, path) => {
  if (worldFiles.has(path)) fail(`/${path} comes from both ${relative(repo, worldFiles.get(path))} and ${relative(repo, from)}`)
  worldFiles.set(path, from)
}
for (const file of files(realm)) {
  let path = relative(realm, file).split(sep).join('/')
  if (path.startsWith('sf/')) path = path.slice(3)
  if (path.endsWith('.br') && !SENT_BY_WORKER(path)) continue
  placeWorld(file, path)
}
placeWorld(join(here, 'alpha.js'), 'alpha.js')

const siteFiles = new Map()
let siteHeaders = ''
for (const file of files(site)) {
  const path = relative(site, file).split(sep).join('/')
  if (path === '_headers') { siteHeaders = readFileSync(file, 'utf8'); continue }
  siteFiles.set(path, file)
}
const personal = 'https://zahynailo.dev'
const worldOrigin = 'https://voxelwright.world'
function worldPage(html) {
  // The built realm embeds its board destinations as JSON. Leave third-party and realm asset URLs alone.
  return html.replace(/(["'])\/blog\//g, `$1${personal}/blog/`).replace('</head>', `<link rel="canonical" href="${worldOrigin}/">
<meta property="og:type" content="website">
<meta property="og:title" content="San Francisco">
<meta property="og:url" content="${worldOrigin}/">
<meta property="og:image" content="${personal}/blog/og/home.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${personal}/blog/og/home.png">
</head>`)
}

function assemble(folder, entries, headers, world) {
  const out = join(here, folder)
  rmSync(out, { recursive: true, force: true })
  for (const [path, from] of entries) {
    mkdirSync(dirname(join(out, path)), { recursive: true })
    if (!world || !path.endsWith('.html')) { cpSync(from, join(out, path)); continue }
    let html = readFileSync(from, 'utf8')
    if (path === 'index.html') html = worldPage(html)
    writeFileSync(join(out, path), withNotice(html))
  }

  if (world) {
    writeFileSync(join(out, '_headers'), [
      '# The realm (engine/dist-sf). The release pointer is asked for every time, so a new pin shows at once; the release',
      '# itself and the binary files are sent by worker.mjs, which sets their headers.',
      '/current.json',
      '  Cache-Control: no-cache',
      '',
      headers,
    ].join('\n'))
    writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n')
    writeFileSync(join(out, '404.html'), withNotice(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found · San Francisco</title></head><body><main><h1>Page not found</h1><p><a href="/">Return to San Francisco</a> or visit <a href="${personal}/blog/">Pavlo’s blog</a>.</p></main></body></html>`))
  } else if (headers) {
    writeFileSync(join(out, '_headers'), headers)
  }
  const all = files(out), bytes = all.reduce((n, f) => n + statSync(f).size, 0), biggest = Math.max(...all.map((f) => statSync(f).size))
  console.log(`deploy/${folder}: ${all.length} files, ${(bytes / 1048576).toFixed(1)} MB, largest ${(biggest / 1048576).toFixed(1)} MB`)
  if (all.length > 20000) fail('more than 20,000 files: over the Workers Free plan limit for static assets')
  if (biggest > 25 * 1048576) fail('a file over 25 MiB: over the Workers limit for one static asset')
}

assemble('dist', siteFiles, siteHeaders, false)
assemble('dist-world', worldFiles, '', true)
