// Sources and selectors are repository-relative. The gate reads the working tree.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ts, options } from './doc-options.mjs'
import { mentions } from './doc-mentions.mjs'
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const ignores = JSON.parse(readFileSync('guide/mention-ignores.json', 'utf8'))
const usage = 'node scripts/docs.mjs [mentions | verify PAGE | generate PAGE]'
const [action, target] = process.argv.slice(2)
const read = path => readFileSync(path, 'utf8')
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trimEnd()
const bindings = JSON.parse(read('guide/bindings.json'))
const marker = /^<!-- docs-verified (?:([0-9a-f]{40}) )?(\{.*\}) -->$/m
function cli(title, command, fields, row) {
  return rows => [
    `# ${title}`, '', `Run \`${command}\` with the following options.`, '',
    `| Option | ${fields.join(' | ')} |`, `| --- | ${fields.map(() => '---').join(' | ')} |`,
    ...rows.map(([name, ...values]) => `| \`--${name}\` | ${row(...values).join(' | ')} |`),
  ]
}
const generators = {
  'guide/check-cli.md': cli('Check runner', 'npm run check --', ['Type', 'Default', 'Purpose'],
    (purpose, type, value) => [type, `\`${value}\``, purpose]),
  'guide/checks.md': rows => [
    '# Repository checks', '',
    'Use a name with `npm run check -- --only NAME`. The default CI run excludes local and skipped checks. A file prerequisite must exist even for a named run.', '',
    '| Name | Default run | Required file |', '| --- | --- | --- |',
    ...rows.map(([name, mode, file]) => `| \`${name}\` | ${mode} | ${file ? '\`' + file + '\`' : ''} |`),
  ],
  'guide/plugin-types.md': declarations => [
    '# Page plugin types', '',
    'Local type declarations exported by the [page plugin registry](../engine/page/plugins.ts). See [Drawing from a page plugin](render-passes.md) for a render pass example.', '',
    '```ts', declarations.join('\n\n'), '```',
  ],
}

async function project(file, selector) {
  if (selector === 'file') return readFileSync(file)
  if (selector === 'options') return options(file, read(file))
  if (selector === 'checks') {
    const { CHECKS } = await import(new URL('../' + file, import.meta.url))
    return CHECKS.map(c => [c.name, c.skip ? 'skip' : c.local ? 'local' : 'ci', c.needsFile ?? ''])
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  }
  const source = read(file)
  if (selector === 'types' || selector.startsWith?.('types:')) {
    return declarations(file, source, selector === 'types' ? null : selector.slice(6).split(','))
  }
  if (Array.isArray(selector)) {
    const json = JSON.parse(source)
    return selector.map(path => {
      const value = path.split('.').reduce((obj, key) => obj?.[key], json)
      if (value === undefined) throw Error(`missing JSON field ${path}`)
      return value
    })
  }
  if (!selector.startsWith('lines:')) throw Error(`unknown selector ${selector}`)
  const pattern = new RegExp(selector.slice('lines:'.length))
  const lines = source.split('\n').map(line => line.trim()).filter(line => pattern.test(line))
  if (!lines.length) throw Error(`no lines match ${pattern}`)
  return lines
}

function declarations(file, source, names) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  if (tree.parseDiagnostics.length) throw Error('TypeScript parse failed')
  const printer = ts.createPrinter({removeComments: true})
  const found = tree.statements.filter(s => s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    && (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)))
    .filter(s => !names || names.includes(s.name.text))
  if (names && found.length !== names.length) throw Error(`missing named type in ${file}: ${names.join(',')}`)
  return found.map(s => printer.printNode(ts.EmitHint.Unspecified, s, tree))
}

// A hand-written page shows a schema as the source declares it: the ts fence after
// `<!-- schema PATH Name,Name -->` is printed from those exported declarations.
const schema = /^<!-- schema (\S+) ([\w,]+) -->\n```ts\n[\s\S]*?^```$/gm
const schemas = body => body.replace(schema, (_, file, names) =>
  `<!-- schema ${file} ${names} -->\n\`\`\`ts\n${declarations(file, read(file), names.split(',')).join('\n\n')}\n\`\`\``)

function inventory() {
  const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '--', '*README.md', '.agents/skills/*/SKILL.md', 'guide/*.md').split('\n')
  for (const page of paths) {
    if (!Object.hasOwn(bindings, page)) {
      throw Error(`${page} needs a source in guide/bindings.json`)
    }
  }
}

// Keep the runnable specimen in reviewed code. Compare its body with the visible
// fence before running it so a Markdown edit cannot introduce a CI command.
function renderPassExample(passes) {
  const draws = passes()
  const calls = []
  draws.add('trail', () => calls.push('old'))
  draws.add('trail', () => calls.push('new'))
  draws.draw()
  assert.deepEqual(calls, ['new'])
  draws.remove('trail')
  draws.draw()
  assert.deepEqual(calls, ['new'])
}

async function example(page, content) {
  if (page !== 'guide/render-passes.md') return
  const code = content.match(/^```js\n([\s\S]+?)\n```$/m)?.[1]
  const specimen = renderPassExample.toString().split('\n').slice(1, -1).map(line => line.slice(2)).join('\n')
  assert.ok(code === specimen, 'copy the runnable example from renderPassExample in scripts/docs.mjs')
  const { passes } = await import('../engine/page/plugins.ts')
  renderPassExample(passes)
}

function report(page, changed, reasons, sources, base) {
  // A stamp travels with its page through merges and squash merges. Look up
  // its introducing commit only on failure. Hash comparison needs no history.
  const shallow = git('rev-parse', '--is-shallow-repository') === 'true'
  const start = shallow ? '' : git('log', '-1', '--format=%H', '-G', '^<!-- docs-verified ', '--', page)
  const covered = [...new Set([...sources, ...changed])]
  const paths = [...new Set([...covered, page, 'guide/bindings.json', 'scripts/docs.mjs'])]
  if (start && covered.length) {
    const edited = git('diff', '--name-only', start, '--', ...covered).split('\n').filter(Boolean)
    reasons.push('Covered files edited since verification: ' + (edited.join(', ') || 'none'))
  }
  console.error(`STALE ${page}\n  ${reasons.join('\n  ')}\n  Changed covered surfaces: ${changed.join(', ') || 'none'}`)
  if (!start && !base) console.error('  No local verification commit. Read the bound sources and page in full.')
  if (shallow) {
    console.error('  Shallow history: deepen this checkout to recover the full verification range.')
  }
  const range = start || base || 'HEAD'
  console.error(`  Read verification through working tree: git diff ${range} -- ${paths.join(' ')}`)
  console.error(`  After review: node scripts/docs.mjs ${generators[page] ? 'generate' : 'verify'} ${page}`)
  process.exitCode = 1
}

async function checkPage(page) {
  const sources = bindings[page]
  const content = existsSync(page) ? read(page) : ''
  const stamp = content.match(marker)
  let previous = {}
  const reasons = []
  try {
    if (stamp) {
      const parsed = JSON.parse(stamp[2])
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error()
      previous = parsed
    }
  } catch { reasons.push('invalid verification stamp') }
  const hashes = {}, values = [], invalid = []
  for (const [file, selector] of Object.entries(sources)) {
    try {
      const value = await project(file, selector)
      hashes[file] = createHash('sha256').update(JSON.stringify(selector)).update('\0')
        .update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex').slice(0, 32)
      values.push(value)
    } catch (e) { invalid.push(file); reasons.push(`${file}: ${e.message}`) }
  }
  if (!Object.keys(sources).length) reasons.push('empty binding')
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(sources)])]
    .filter(file => previous[file] !== hashes[file] || invalid.includes(file))
  const generate = generators[page]
  let body = content.replace(marker, '').trimEnd()
  if (generate && !reasons.length) {
    assert.equal(values.length, 1, 'a reference page has one source')
    body = generate(values[0]).join('\n')
  } else if (!body.trim()) reasons.push('page missing or empty')
  else try {
    const printed = schemas(body)
    if (printed !== body && !action) reasons.push('a schema differs from its source declaration')
    body = printed
  } catch (e) { reasons.push(`schema: ${e.message}`) }
  reasons.push(...mentions(page, body, undefined, ignores[page]))
  try { await example(page, body) } catch (e) { reasons.push(`example failed: ${e.message}`) }
  const base = action && (!stamp?.[1] || changed.length) ? git('rev-parse', 'HEAD') : stamp?.[1]
  const output = body + '\n\n<!-- docs-verified ' + base + ' ' + JSON.stringify(hashes) + ' -->\n'
  if (action && !reasons.length) {
    if (output !== content) writeFileSync(page, output)
    return
  }
  if (!stamp?.[1]) reasons.push('missing verification stamp')
  if (changed.length) reasons.push('binding differs from its verified surface')
  if (generate && output !== content) reasons.push('generated page differs from source')
  if (reasons.length) report(page, changed, reasons, Object.keys(sources), base)
}

if (action === 'mentions' && !target) {
  inventory()
  const errors = Object.keys(bindings).flatMap(page => mentions(page, read(page), undefined, ignores[page]))
  if (errors.length) console.error(errors.join('\n'))
  else console.log(`Mentions current: ${Object.keys(bindings).length} pages.`)
  process.exit(errors.length ? 1 : 0)
}
if (process.argv.length > 2 && (process.argv.length !== 4 || !Object.hasOwn(bindings, target)
    || action !== (generators[target] ? 'generate' : 'verify'))) throw Error(usage)
inventory()
for (const page of target ? [target] : Object.keys(bindings)) await checkPage(page)
if (!process.exitCode) console.log(target ? `Verified ${target}` : `Docs current: ${Object.keys(bindings).length} pages, ${Object.keys(generators).length} generated, 1 example passed.`)
