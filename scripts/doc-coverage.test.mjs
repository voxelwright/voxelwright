import assert from 'node:assert/strict'
import { test } from 'node:test'
import { component, uncovered } from './doc-coverage.mjs'
import { navigation, pageProblems, site } from './doc-site.mjs'
import { mentions } from './doc-mentions.mjs'
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))

const bindings = {
  'guide/engine-page.md': {'engine/page/march.ts': 'lines:^export'},
  'engine/kit/README.md': {'engine/kit/package.json': ['exports']},
  'master/README.md': {'master/src/config.rs': 'lines:^pub'},
}

test('engine parts are components of their own', () => {
  assert.equal(component('engine/page/march.ts'), 'engine/page')
  assert.equal(component('engine/serve.mjs'), 'engine')
  assert.equal(component('master/src/lib.rs'), 'master')
  assert.equal(component('package.json'), null)
})

test('a source change with no page touched fails and names the pages', () => {
  assert.deepEqual(uncovered(['engine/page/sky.ts'], bindings, new Set()), [
    {name: 'engine/page', files: ['engine/page/sky.ts'], pages: ['guide/engine-page.md']},
  ])
})

test('touching a page or its stamp covers the component', () => {
  assert.deepEqual(uncovered(['engine/page/sky.ts'], bindings, new Set(['guide/engine-page.md'])), [])
  assert.deepEqual(uncovered(['engine/kit/src/x.js', 'engine/kit/README.md'], bindings, new Set(['engine/kit/README.md'])), [])
})

test('tests, assets and lockfiles ask for no review; an undocumented component is named', () => {
  const quiet = ['engine/page/sky.test.ts', 'master/tests/limits.rs', 'engine/kit/fonts/a.woff2', 'master/Cargo.lock']
  assert.deepEqual(uncovered(quiet, bindings, new Set()), [])
  assert.deepEqual(uncovered(['engine/mind/brain.ts'], bindings, new Set()), [
    {name: 'engine/mind', files: ['engine/mind/brain.ts'], pages: []},
  ])
})

test('a guide page needs frontmatter, MDX comments and no H1', () => {
  assert.deepEqual(pageProblems('guide/a.md', '# A\n\nText.\n'), ['guide/a.md: start with YAML frontmatter holding a title and a description'])
  assert.deepEqual(pageProblems('guide/a.md', '---\ntitle: A\ndescription: The A: b\n---\n\n# A\n\n<!-- x -->\n'), [
    'guide/a.md: quote the frontmatter description, or drop its colon',
    'guide/a.md: Mintlify reads pages as MDX; use {/* comment */}, not <!-- comment -->',
    'guide/a.md: the frontmatter title is the page heading; start sections at ##',
  ])
  assert.deepEqual(pageProblems('guide/a.md', '---\ntitle: A\ndescription: "The A: b"\n---\n\nUse `<!-- x -->`.\n\n```sh\n# a comment\n```\n'), [])
})

test('every guide page is in the navigation once, and every listed page exists', () => {
  const docs = JSON.stringify({navigation: {groups: [{group: 'A', pages: ['a', {group: 'B', pages: ['b', 'gone']}]}, {group: 'C', pages: ['a']}]}})
  assert.deepEqual(navigation(JSON.parse(docs)), ['a', 'b', 'gone', 'a'])
  assert.deepEqual(site(['guide/a.md', 'guide/b.md', 'guide/new.md', 'README.md'], docs), [
    'guide/new.md is missing from the navigation in guide/docs.json',
    'guide/docs.json lists gone, which has no page',
    'guide/docs.json lists a twice',
  ])
})

test('a guide page links pages as /slug and repository files by GitHub URL', () => {
  const content = [
    '[ok](/engine) [ok](/engine#frames) [ok](https://github.com/voxelwright/voxelwright/blob/main/engine/README.md)',
    '[relative](engine.md) [up](../AGENTS.md)',
    '[gone](/no-such-page) [gone](https://github.com/voxelwright/voxelwright/blob/main/no/such.md)',
  ].join('\n')
  assert.deepEqual(mentions('guide/x.md', content), [
    'guide/x.md:2: link engine.md: link a guide page as /slug and a repository file by its https://github.com/voxelwright/voxelwright URL',
    'guide/x.md:2: link ../AGENTS.md: link a guide page as /slug and a repository file by its https://github.com/voxelwright/voxelwright URL',
    'guide/x.md:3: missing page /no-such-page',
    'guide/x.md:3: missing link no/such.md',
  ])
})
