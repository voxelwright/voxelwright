// Builds the two static asset folders from one realm and one site build:
//   - deploy/dist (zahynailo.dev): the site alone (site/dist, from `npm run build` in site/): the personal page at "/",
//     the blog under "/blog/", robots.txt, 404.html and the site's own _headers. No realm files and no alpha notice.
//   - deploy/dist-world (voxelwright.world): the SF realm (engine/dist-sf, from `node engine/sf/build.mjs`) at the root:
//     its sf/ folder (the page, the release pointer, the release, kept things, eggs, credits) becomes "/", beside the
//     engine's page/, kit/, blocks/ and bay/, with the alpha notice, the world's own share card (og-world.png at
//     /og.png), the site's favicon, social metadata, a dark 404 and security headers whose CSP names each inline
//     script of the pages by its SHA-256 (worker.mjs holds the policy). The release's street graphs stay out: the
//     page never asks for them (sf/build.mjs reads them from ~/.village to draw the road's marks).
// The Brotli copies are kept only where worker.mjs sends them (releases/, bay/); the platform compresses the rest.
//
//   node deploy/assemble.mjs [--realm engine/dist-sf] [--site site/dist]
import { createHash } from 'node:crypto'
import { constants as fsConstants, copyFileSync, cpSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withNotice } from './notice.mjs'
import { securityHeaders } from './worker.mjs'

const here = dirname(fileURLToPath(import.meta.url)), repo = dirname(here)
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return resolve(repo, at > 0 ? process.argv[at + 1] : fallback) }
const realm = arg('realm', 'engine/dist-sf'), site = arg('site', 'site/dist')
const fail = (why) => { console.error(`assemble: ${why}`); process.exit(1) }
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))

if (!existsSync(join(realm, 'sf', 'index.html'))) fail(`${relative(repo, realm)} holds no realm: node engine/sf/build.mjs`)
if (!existsSync(join(site, 'index.html'))) fail(`${relative(repo, site)} holds no personal page at /: cd site && npm run build`)
if (!existsSync(join(site, 'blog', 'index.html'))) fail(`${relative(repo, site)} holds no blog at blog/: cd site && npm run build`)

const SENT_BY_WORKER = (path) => path.startsWith('releases/') || path.startsWith('bay/')
// Binary city tiles, far faces and road/map tables are only read by WebGPU browsers (all of which send
// Accept-Encoding: br): drop their uncompressed copies when a quality-11 .br sibling exists so dist-world stays
// compact (~800 MB / ~6,800 files instead of ~6.7 GB / ~12,400 files). Text and JSON keep both plain and .br.
const BROTLI_ONLY_BINARY = (path) => SENT_BY_WORKER(path) && /\.(bay|far|bin)$/.test(path)
// releases/<pin>/graph/: the street graphs, plain and .br. No page code reads them (engine/page has no reference).
const UNUSED = (path) => /^releases\/[^/]+\/graph\//.test(path)
const worldFiles = new Map()
const placeWorld = (from, path) => {
  if (worldFiles.has(path)) fail(`/${path} comes from both ${relative(repo, worldFiles.get(path))} and ${relative(repo, from)}`)
  worldFiles.set(path, from)
}
for (const file of files(realm)) {
  let path = relative(realm, file).split(sep).join('/')
  if (path.startsWith('sf/')) path = path.slice(3)
  if (path.endsWith('.br') && !SENT_BY_WORKER(path)) continue
  if (BROTLI_ONLY_BINARY(path) && existsSync(`${file}.br`)) continue
  if (UNUSED(path)) continue
  placeWorld(file, path)
}
placeWorld(join(here, 'alpha.js'), 'alpha.js')
placeWorld(join(here, 'og-world.png'), 'og.png')

const siteFiles = new Map()
let siteHeaders = ''
for (const file of files(site)) {
  const path = relative(site, file).split(sep).join('/')
  if (path === '_headers') { siteHeaders = readFileSync(file, 'utf8'); continue }
  siteFiles.set(path, file)
}
// The site's favicon, as its build published it under the blog.
const favicon = siteFiles.get('blog/favicon.svg')
if (!favicon) fail(`${relative(repo, site)} holds no blog/favicon.svg: cd site && npm run build`)
placeWorld(favicon, 'favicon.svg')
const personal = 'https://zahynailo.dev'
const worldOrigin = 'https://voxelwright.world'
const TITLE = 'Voxelwright — San Francisco'
const DESCRIPTION = 'San Francisco at true size in 10 cm voxels, drawn live with WebGPU in the browser. Walk it, drive it, or make things in it by talking to your own AI.'
const CARD_ALT = 'The Voxelwright plate over San Francisco’s voxel skyline: “San Francisco in 10 cm WebGPU voxels”, voxelwright.world.'
const attr = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
function worldPage(html) {
  // The built realm embeds its board destinations as JSON. Leave third-party and realm asset URLs alone.
  const page = html.replace(/(["'])\/blog\//g, `$1${personal}/blog/`)
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(TITLE)}</title>`)
    .replace('<link rel="icon" href="data:,">', '<link rel="icon" href="/favicon.svg" type="image/svg+xml">')
  return page.replace('</head>', `<link rel="canonical" href="${worldOrigin}/">
<meta name="description" content="${attr(DESCRIPTION)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Voxelwright">
<meta property="og:title" content="${attr(TITLE)}">
<meta property="og:description" content="${attr(DESCRIPTION)}">
<meta property="og:url" content="${worldOrigin}/">
<meta property="og:image" content="${worldOrigin}/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${attr(CARD_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(TITLE)}">
<meta name="twitter:description" content="${attr(DESCRIPTION)}">
<meta name="twitter:image" content="${worldOrigin}/og.png">
<meta name="twitter:image:alt" content="${attr(CARD_ALT)}">
</head>`)
}

// The world's 404, in the realm's dark (#10141a) with the kit's plate colours. No inline script, so nothing to hash.
const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Voxelwright</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="robots" content="noindex">
<style>
:root { color-scheme: dark; }
html, body { margin: 0; min-height: 100%; background: #10141a; color: #e8ebf2; }
body { display: grid; place-items: center; min-height: 100vh; padding: 16px; box-sizing: border-box; font: 400 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { box-sizing: border-box; inline-size: min(30rem, 100%); padding: 28px 28px 28px 24px; background: #1a2029; border-inline-start: 8px solid #fff600; box-shadow: 4px 5px 0 rgb(0 0 0 / 0.45); }
p.code { margin: 0 0 8px; font: 600 0.75rem/1.4 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #fff600; }
h1 { margin: 0 0 12px; font-size: 1.5rem; line-height: 1.25; font-weight: 650; }
p { margin: 0; color: #b4bccb; text-wrap: pretty; }
a { color: #e8ebf2; text-underline-offset: 3px; }
a:hover, a:focus-visible { color: #fff600; }
a.home { display: inline-block; margin-top: 20px; padding: 10px 16px; background: #fff600; color: #0a0f3d; font-weight: 650; text-decoration: none; }
a.home:hover, a.home:focus-visible { background: #fbfcff; color: #0a0f3d; }
</style></head><body><main><p class="code">404</p><h1>Page not found</h1>
<p>Nothing lives at this address. The city is still here, and so is <a href="${personal}/blog/">Pavlo’s blog</a>.</p>
<a class="home" href="/">Return to San Francisco</a></main></body></html>`

/** `'sha256-…'` of each inline script (one with no src) in the page, its exact bytes between the tags. */
function inlineScriptHashes(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs))
    .map(([, , body]) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
}

const cloneOrCopy = (from, to) => {
  if (process.platform === 'linux') {
    try { linkSync(from, to); return } catch { /* cross-device or existing */ }
  }
  try { copyFileSync(from, to, fsConstants.COPYFILE_FICLONE) } catch { cpSync(from, to) }
}

function assemble(folder, entries, headers, world) {
  const out = join(here, folder)
  rmSync(out, { recursive: true, force: true })
  const hashes = new Set()
  const page = (path, html) => {
    const published = withNotice(html)
    for (const hash of inlineScriptHashes(published)) hashes.add(hash)
    writeFileSync(join(out, path), published)
  }
  for (const [path, from] of entries) {
    mkdirSync(dirname(join(out, path)), { recursive: true })
    if (!world || !path.endsWith('.html')) { cloneOrCopy(from, join(out, path)); continue }
    const html = readFileSync(from, 'utf8')
    page(path, path === 'index.html' ? worldPage(html) : html)
  }

  if (world) {
    page('404.html', NOT_FOUND)
    writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n')
    const security = Object.entries(securityHeaders([...hashes].sort())).map(([name, value]) => `  ${name}: ${value}`)
    // Workers static assets reads at most 2,000 characters a line.
    if (security.some((line) => line.length > 2000)) fail('a security header line is over 2,000 characters: too many inline scripts')
    writeFileSync(join(out, '_headers'), [
      '# The realm (engine/dist-sf). Security headers on everything (worker.mjs holds them; the CSP names the inline',
      '# scripts of the pages above by hash). The release pointer is asked for every time, so a new pin shows at once; the',
      '# release itself and the binary files are sent by worker.mjs, which sets their headers.',
      '/*',
      ...security,
      '/current.json',
      '  Cache-Control: no-cache',
      '# The loader\'s pictures are named by their content.',
      '/loading-*.webp',
      '  Cache-Control: public, max-age=31536000, immutable',
      '# Fonts keep their names but almost never change: a week, then checked in the background for a month.',
      '/kit/fonts/*',
      '  Cache-Control: public, max-age=604800, stale-while-revalidate=2592000',
      '',
      headers,
    ].join('\n'))
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
