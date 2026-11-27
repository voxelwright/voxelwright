import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import cloudflareConfig from './cloudflare.config.ts'
import { securityHeaders } from './worker.mjs'

const DEPLOY_FILES = ['assemble.mjs', 'alpha.js', 'notice.mjs', 'worker.mjs', 'encoding.mjs', 'og-world.png', 'manifest.webmanifest', 'sw.js', 'icons']

test('assemble separates zahynailo.dev (site only, no alpha notice) from voxelwright.world (realm only)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'world-assembly-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const read = (path) => readFileSync(join(root, path), 'utf8')
  const loader = '\n(() => { document.title = "loading" })()\n'
  const realm = `<html><head><title>San Francisco</title><link rel="icon" href="data:,"></head><body><script>${loader}</script><script type="application/json">{"to":"/blog/"}</script><script type="module" src="../page/main.js"></script></body></html>`
  put('realm/sf/index.html', realm)
  put('realm/sf/eggs/clip.mp4', 'clip')
  put('realm/sf/releases/p/manifest.json', '{"version":1}')
  put('realm/sf/releases/p/manifest.json.br', 'compressed release')
  put('realm/sf/releases/p/tiles/0/1_2.bay', 'uncompressed tile')
  put('realm/sf/releases/p/tiles/0/1_2.bay.br', 'compressed tile')
  put('realm/sf/releases/p/far/0/1_2.far', 'uncompressed far')
  put('realm/sf/releases/p/far/0/1_2.far.br', 'compressed far')
  put('realm/sf/releases/p/graph/1_2.json', '{"graph":1}')
  put('realm/sf/releases/p/graph/1_2.json.br', 'compressed graph')
  put('realm/sf/loading-wide-0123456789ab.webp', 'picture')
  put('realm/bay/map.bin', 'uncompressed map')
  put('realm/bay/map.bin.br', 'compressed map')
  put('realm/bay/plain-only.bin', 'plain only')
  put('site/index.html', '<html><body>Personal</body></html>')
  put('site/index.md', '# Personal\n')
  put('site/blog/index.html', '<html><body>Blog</body></html>')
  put('site/blog/favicon.svg', '<svg/>')
  put('site/404.html', '<html><body>Not found</body></html>')
  put('site/robots.txt', 'personal robots')
  put('site/_headers', '/blog/*\n  Example: personal\n')
  for (const file of DEPLOY_FILES) cpSync(new URL(file, import.meta.url), join(root, file), { recursive: true })
  execFileSync(process.execPath, [join(root, 'assemble.mjs'), '--realm', join(root, 'realm'), '--site', join(root, 'site')])

  // deploy/dist: site alone, no realm files, no alpha notice
  assert.equal(read('dist/index.html'), '<html><body>Personal</body></html>')
  assert.equal(read('dist/index.md'), '# Personal\n')
  assert.equal(read('dist/blog/index.html'), '<html><body>Blog</body></html>')
  assert.equal(read('dist/404.html'), '<html><body>Not found</body></html>')
  assert.equal(read('dist/robots.txt'), 'personal robots')
  assert.equal(read('dist/_headers'), '/blog/*\n  Example: personal\n')
  for (const absent of ['dist/alpha.js', 'dist/eggs', 'dist/releases']) {
    assert.equal(existsSync(join(root, absent)), false, `${absent} must not be in dist`)
  }
  for (const html of ['dist/index.html', 'dist/blog/index.html', 'dist/404.html']) {
    assert.doesNotMatch(read(html), /alpha\.js/, `${html} must not get the realm alpha notice`)
  }

  // deploy/dist-world: realm alone, with alpha notice and world metadata
  assert.equal(existsSync(join(root, 'dist-world/blog')), false)
  assert.doesNotMatch(read('dist-world/_headers'), /Example: personal/)
  assert.match(read('dist-world/_headers'), /\/current\.json/)
  assert.match(read('dist-world/index.html'), /"to":"https:\/\/zahynailo\.dev\/blog\/"/)
  assert.match(read('dist-world/index.html'), /rel="canonical" href="https:\/\/voxelwright\.world\/"/)
  assert.match(read('dist-world/index.html'), /<script src="\/alpha\.js" defer><\/script>/)
  assert.match(read('dist-world/404.html'), /href="https:\/\/zahynailo\.dev\/blog\/"/)
  assert.match(read('dist-world/404.html'), /<script src="\/alpha\.js" defer><\/script>/)
  assert.equal(read('dist-world/eggs/clip.mp4'), 'clip')
  assert.equal(read('dist-world/releases/p/manifest.json'), '{"version":1}')
  assert.equal(read('dist-world/releases/p/manifest.json.br'), 'compressed release')
  assert.equal(existsSync(join(root, 'dist-world/releases/p/tiles/0/1_2.bay')), false, 'plain .bay skipped when .br exists')
  assert.equal(read('dist-world/releases/p/tiles/0/1_2.bay.br'), 'compressed tile')
  assert.equal(existsSync(join(root, 'dist-world/releases/p/far/0/1_2.far')), false, 'plain .far skipped when .br exists')
  assert.equal(read('dist-world/releases/p/far/0/1_2.far.br'), 'compressed far')
  assert.equal(existsSync(join(root, 'dist-world/bay/map.bin')), false, 'plain .bin skipped when .br exists')
  assert.equal(read('dist-world/bay/map.bin.br'), 'compressed map')
  assert.equal(read('dist-world/bay/plain-only.bin'), 'plain only')
  assert.equal(existsSync(join(root, 'dist-world/alpha.js')), true)

  // the street graphs stay out, plain and Brotli
  assert.equal(existsSync(join(root, 'dist-world/releases/p/graph')), false)

  // its own share card, favicon, title and social metadata
  assert.deepEqual(readFileSync(join(root, 'dist-world/og.png')), readFileSync(new URL('og-world.png', import.meta.url)))
  assert.equal(read('dist-world/favicon.svg'), '<svg/>')
  const index = read('dist-world/index.html')
  assert.match(index, /<title>Voxelwright — San Francisco<\/title>/)
  assert.match(index, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/)
  assert.doesNotMatch(index, /href="data:,"/)
  for (const [key, value] of [
    ['og:site_name', 'Voxelwright'], ['og:title', 'Voxelwright — San Francisco'], ['og:image', 'https://voxelwright.world/og.png'],
    ['og:image:type', 'image/png'], ['og:image:width', '1200'], ['og:image:height', '630'],
    ['twitter:card', 'summary_large_image'], ['twitter:title', 'Voxelwright — San Francisco'], ['twitter:image', 'https://voxelwright.world/og.png'],
  ]) assert.ok(index.includes(`="${key}" content="${value}"`), `${key} is ${value}`)
  for (const key of ['description', 'og:description', 'og:image:alt', 'twitter:description', 'twitter:image:alt']) {
    assert.match(index, new RegExp(`="${key}" content="[^"]{20,}"`), `${key} is set`)
  }
  assert.doesNotMatch(index, /zahynailo\.dev\/blog\/og/, 'the world no longer borrows the blog\'s card')

  // a dark 404 with no inline script
  const missing = read('dist-world/404.html')
  assert.match(missing, /background: #10141a/)
  assert.doesNotMatch(missing, /<script>/)

  // security headers on everything; the CSP allows the page's inline scripts by hash and nothing inline otherwise
  const headers = read('dist-world/_headers')
  const all = headers.slice(headers.indexOf('/*\n'), headers.indexOf('/current.json'))
  const sha = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
  const csp = all.match(/^ {2}Content-Security-Policy: (.+)$/m)[1]
  assert.ok(csp.includes(sha(loader)), 'the loader script is allowed by its hash')
  assert.ok(csp.includes(sha('{"to":"https://zahynailo.dev/blog/"}')), 'hashes are of the published bytes, after the blog links move')
  const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))
  assert.match(scriptSrc, /^script-src 'self' 'wasm-unsafe-eval' 'sha256-/)
  assert.doesNotMatch(scriptSrc, /unsafe-inline/)
  assert.match(csp, /frame-ancestors 'self' https:\/\/zahynailo\.dev/)
  for (const [name, value] of Object.entries(securityHeaders())) {
    if (name !== 'Content-Security-Policy') assert.ok(all.includes(`  ${name}: ${value}\n`), `${name} on /*`)
  }
  assert.match(headers, /\/sw\.js\n {2}Cache-Control: no-cache/)
  assert.match(headers, /\/manifest\.webmanifest\n {2}Content-Type: application\/manifest\+json; charset=utf-8\n {2}Cache-Control: public, max-age=3600/)
  assert.match(headers, /\/icons\/\*\n {2}Cache-Control: public, max-age=604800, stale-while-revalidate=2592000/)
  assert.match(headers, /\/loading-\*\.webp\n {2}Cache-Control: public, max-age=31536000, immutable/)
  assert.match(headers, /\/kit\/fonts\/\*\n {2}Cache-Control: public, max-age=604800, stale-while-revalidate=2592000/)
  assert.match(csp, /manifest-src 'self'/)
  assert.doesNotMatch(read('dist/_headers'), /Content-Security-Policy: script-src/, 'zahynailo.dev keeps its own headers')

  // PWA assets, manifest, service worker and iOS/mobile meta tags live on voxelwright.world only
  assert.equal(existsSync(join(root, 'dist/manifest.webmanifest')), false)
  assert.equal(existsSync(join(root, 'dist/sw.js')), false)
  const manifest = JSON.parse(read('dist-world/manifest.webmanifest'))
  assert.equal(manifest.display, 'fullscreen')
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone'])
  assert.deepEqual(manifest.launch_handler, { client_mode: ['focus-existing', 'auto'] })
  assert.ok(manifest.shortcuts.length >= 3)
  for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
    assert.equal(existsSync(join(root, `dist-world/icons/${icon}`)), true, `icons/${icon} present`)
  }
  assert.match(index, /<meta name="theme-color" content="#10141a">/)
  assert.match(index, /<link rel="manifest" href="\/manifest\.webmanifest">/)
  assert.match(index, /<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon\.png">/)
  assert.match(index, /<meta name="apple-mobile-web-app-capable" content="yes">/)
  assert.match(index, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/)
  const sw = read('dist-world/sw.js')
  assert.match(sw, /const SHELL_VERSION = "[0-9a-f]{12}"/)
  assert.ok(sw.includes('"/loading-wide-0123456789ab.webp"'), 'sw precaches assembled loader images')
  assert.ok(sw.includes('"/manifest.webmanifest"'), 'sw precaches manifest')
  assert.doesNotMatch(sw, /clip\.mp4/, 'sw never precaches egg video clips')
})

test('assemble refuses a site build missing its personal page at /', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'world-assembly-missing-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  put('realm/sf/index.html', '<html><body>Realm</body></html>')
  put('site/blog/index.html', '<html><body>Blog</body></html>')
  for (const file of DEPLOY_FILES) cpSync(new URL(file, import.meta.url), join(root, file), { recursive: true })
  assert.throws(
    () => execFileSync(process.execPath, [join(root, 'assemble.mjs'), '--realm', join(root, 'realm'), '--site', join(root, 'site')], { stdio: 'pipe' }),
    /holds no personal page at \//,
  )
})

test('cloudflare.config.ts deploys zahynailo as assets-only and voxelwright with the realm Worker', async () => {
  const personal = (await cloudflareConfig({ mode: undefined, isPreview: false })).worker
  const world = (await cloudflareConfig({ mode: 'world', isPreview: false })).worker
  assert.equal(personal.name, 'zahynailo')
  assert.equal(personal.entrypoint, undefined)
  assert.equal(personal.env, undefined)
  assert.equal(personal.assets.runWorkerFirst, undefined)
  assert.equal(personal.assets.notFoundHandling, '404-page')
  assert.equal(world.name, 'voxelwright')
  assert.equal(world.entrypoint, './world-worker.mjs')
  assert.deepEqual(world.assets.runWorkerFirst, ['/releases/*', '/bay/*', '/weather'])
  assert.equal(personal.workersDev, false)
  assert.equal(world.workersDev, false)
})

test('the two zahynailo-realm rules use only Free-plan constructs and redirect only realm queries at /', () => {
  // Two rules, not one: the cf CLI is killed when one --body carries all 69 keys. Together they are the whole list.
  const rules = ['a', 'b'].map((part) => JSON.parse(readFileSync(new URL(`./zahynailo-realm-rule-${part}.json`, import.meta.url), 'utf8')))
  const inner = (rule) => rule.expression.match(/any\(http\.request\.uri\.args\.names\[\*\] in \{([^}]+)\}\)/)[1]
  for (const other of rules) {
    assert.equal(other.expression.replace(inner(other), ''), rules[0].expression.replace(inner(rules[0]), ''), 'the rules differ only in their keys')
    assert.deepEqual(other.action_parameters, rules[0].action_parameters)
    assert.ok(JSON.stringify(other).length < 900, 'each body stays small enough for the cf CLI')
  }
  assert.notEqual(rules[0].ref, rules[1].ref)
  const rule = { ...rules[0], expression: rules[0].expression.replace(inner(rules[0]), rules.map(inner).join(' ')) }
  assert.equal(rule.action, 'redirect')
  assert.equal(rule.action_parameters.from_value.status_code, 301)
  assert.equal(rule.action_parameters.from_value.target_url.value, 'https://voxelwright.world/')
  assert.equal(rule.action_parameters.from_value.preserve_query_string, true)
  assert.ok(rule.expression.length <= 4096, `expression length ${rule.expression.length} exceeds 4096`)
  assert.doesNotMatch(rule.expression, /\bmatches\b|~/, 'Free plan forbids regex matching')

  // Parse the inline key set directly out of the rule expression and evaluate its exact Cloudflare semantics.
  const hostMatch = rule.expression.match(/http\.host in \{([^}]+)\}/)
  const keyMatch = rule.expression.match(/any\(http\.request\.uri\.args\.names\[\*\] in \{([^}]+)\}\)/)
  assert.ok(hostMatch && keyMatch, 'expression must match host set, path "/", and any(http.request.uri.args.names[*] in {...})')
  assert.match(rule.expression, /http\.request\.uri\.path eq "\/"/)
  const hosts = new Set([...hostMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]))
  const keys = new Set([...keyMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]))
  assert.equal(keys.size, 69)

  // Cloudflare http.request.uri.args.names: raw query parameter names (no decoding, case preserved).
  const evalRule = (rawUrl) => {
    const u = new URL(rawUrl)
    if (!hosts.has(u.hostname) || u.pathname !== '/') return null
    const rawQuery = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1).split('#')[0] : ''
    const names = rawQuery ? rawQuery.split('&').filter(Boolean).map((p) => p.split('=')[0]) : []
    if (!names.some((n) => keys.has(n))) return null
    return {
      status: rule.action_parameters.from_value.status_code,
      location: rule.action_parameters.from_value.target_url.value + (rawQuery ? `?${rawQuery}` : ''),
    }
  }

  assert.deepEqual(evalRule('https://zahynailo.dev/?lobbies=1&master=https://m.example'), {
    status: 301,
    location: 'https://voxelwright.world/?lobbies=1&master=https://m.example',
  })
  assert.deepEqual(evalRule('https://zahynailo.dev/?at=1,2,3'), {
    status: 301,
    location: 'https://voxelwright.world/?at=1,2,3',
  })
  assert.deepEqual(evalRule('https://www.zahynailo.dev/?lobby=abc&utm_source=x'), {
    status: 301,
    location: 'https://voxelwright.world/?lobby=abc&utm_source=x',
  })
  assert.equal(evalRule('https://zahynailo.dev/'), null)
  assert.equal(evalRule('https://zahynailo.dev/?utm_source=x'), null)
  assert.equal(evalRule('https://zahynailo.dev/?utm_source=at'), null)
  assert.equal(evalRule('https://zahynailo.dev/?view=2d'), null)
  assert.equal(evalRule('https://zahynailo.dev/blog/?at=1'), null)
})
