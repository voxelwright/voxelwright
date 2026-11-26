import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import cloudflareConfig from './cloudflare.config.ts'

test('assemble separates zahynailo.dev (site only, no alpha notice) from voxelwright.world (realm only)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'world-assembly-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const read = (path) => readFileSync(join(root, path), 'utf8')
  const realm = '<html><head></head><body><script type="application/json">{"to":"/blog/"}</script></body></html>'
  put('realm/sf/index.html', realm)
  put('realm/sf/eggs/clip.mp4', 'clip')
  put('realm/sf/releases/p/manifest.json.br', 'compressed release')
  put('site/index.html', '<html><body>Personal</body></html>')
  put('site/index.md', '# Personal\n')
  put('site/blog/index.html', '<html><body>Blog</body></html>')
  put('site/404.html', '<html><body>Not found</body></html>')
  put('site/robots.txt', 'personal robots')
  put('site/_headers', '/blog/*\n  Example: personal\n')
  for (const file of ['assemble.mjs', 'alpha.js', 'notice.mjs']) {
    cpSync(new URL(file, import.meta.url), join(root, file))
  }
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
  assert.equal(read('dist-world/releases/p/manifest.json.br'), 'compressed release')
  assert.equal(existsSync(join(root, 'dist-world/alpha.js')), true)
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
  for (const file of ['assemble.mjs', 'alpha.js', 'notice.mjs']) {
    cpSync(new URL(file, import.meta.url), join(root, file))
  }
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
})

test('zahynailo-realm-rule.json uses only Free-plan constructs and redirects only realm queries at /', () => {
  const rule = JSON.parse(readFileSync(new URL('./zahynailo-realm-rule.json', import.meta.url), 'utf8'))
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
