import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

test('one realm build publishes two origins and only the personal origin mounts the blog', (t) => {
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
  put('site/blog/index.html', '<body>Blog</body>')
  put('site/robots.txt', 'personal robots')
  put('site/_headers', '/blog/*\n  Example: personal')
  for (const file of ['assemble.mjs', 'alpha.js', 'notice.mjs']) {
    cpSync(new URL(file, import.meta.url), join(root, file))
  }
  execFileSync(process.execPath, [join(root, 'assemble.mjs'), '--realm', join(root, 'realm'), '--site', join(root, 'site')])
  assert.match(read('dist/index.html'), /"to":"\/blog\/"/)
  assert.match(read('dist/blog/index.html'), /Blog/)
  assert.equal(read('dist/robots.txt'), 'personal robots')
  assert.match(read('dist/_headers'), /Example: personal/)
  assert.equal(existsSync(join(root, 'dist-world/blog')), false)
  assert.doesNotMatch(read('dist-world/_headers'), /Example: personal/)
  assert.match(read('dist-world/index.html'), /"to":"https:\/\/zahynailo\.dev\/blog\/"/)
  assert.match(read('dist-world/index.html'), /rel="canonical" href="https:\/\/voxelwright\.world\/"/)
  assert.match(read('dist-world/404.html'), /href="https:\/\/zahynailo\.dev\/blog\/"/)
  for (const folder of ['dist', 'dist-world']) {
    assert.equal(read(folder + '/eggs/clip.mp4'), 'clip')
    assert.equal(read(folder + '/releases/p/manifest.json.br'), 'compressed release')
  }
})
