import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mentions, workingTree } from './doc-mentions.mjs'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))

test('renaming only leaves a diagnostic at the documented command, even with a stale comment', () => {
  const page = 'README.md'
  const content = workingTree.read(page)
  const line = content.split('\n').findIndex(line => line.startsWith('npm run check -- --only ')) + 1
  assert.ok(line)
  const fs = {
    ...workingTree,
    read(path) {
      const source = workingTree.read(path)
      return path === 'scripts/check.mjs' ? source.replace('    only:', '    // --only\n    selected:') : source
    },
  }
  const ignores = JSON.parse(workingTree.read('guide/mention-ignores.json'))
  assert.deepEqual(mentions(page, content, fs, ignores[page]), [
    `${page}:${line}: unknown --only in scripts/check.mjs`,
  ])
})

test('look up scripts, paths, and flags in the documented package', () => {
  const content = [
    '`npm --prefix home run missing-script`',
    '```sh', 'cd home', 'node missing-entry', '```',
    '[missing link](guide/missing-page.md)',
    '`python engine/sf/street_sheet.py --not-an-option`',
    '`./target/release/village-master --not-an-option`',
  ].join('\n')
  assert.deepEqual(mentions('README.md', content), [
    'README.md:1: missing npm script missing-script in home/package.json',
    'README.md:4: missing command file missing-entry',
    'README.md:6: missing link guide/missing-page.md',
    'README.md:7: unknown --not-an-option in engine/sf/street_sheet.py',
    'README.md:8: unknown --not-an-option in master/src/config.rs',
  ])
})

test('read parser declarations despite stale comments', () => {
  const snippets = {
    'engine/sf/street_sheet.py': '#!/usr/bin/env python3\n# parser.add_argument("--gone")\nparser.add_argument("--kept")',
    'master/src/config.rs': '// #[arg(long = "gone")] pub gone: bool,\n#[arg(long)] pub kept: bool,',
  }
  const fs = {...workingTree, read: path => snippets[path] ?? workingTree.read(path)}
  assert.deepEqual(mentions('README.md', [
    '`engine/sf/street_sheet.py --gone --kept`',
    '`./target/release/village-master --gone --kept`',
  ].join('\n'), fs), [
    'README.md:1: unknown --gone in engine/sf/street_sheet.py',
    'README.md:2: unknown --gone in master/src/config.rs',
  ])
})
