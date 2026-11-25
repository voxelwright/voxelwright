import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

let ts
try {
  ts = createRequire(new URL('../home/package.json', import.meta.url))('typescript')
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error
  console.error('Install the docs parser with npm ci --prefix home')
  process.exit(1)
}
export { ts }

// Read declarations without loading or executing the documented program.
export function options(file, source, fs) {
  if (file.endsWith('.rs')) {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    const rows = [...code.matchAll(/#\[arg\(long(?:\s*=\s*"([^"]+)")?([^\]]*)\)\]\s*pub (\w+):/g)]
    const flags = rows.map(([, name, attrs, field]) => [
      name ?? field.replaceAll('_', '-'), attrs.match(/value_name = "(.*?)"/)?.[1] ?? 'VALUE',
    ])
    if (code.includes('derive(Parser')) flags.push(['help', 'switch'])
    if (/#\[command\([^\]]*\bversion\b/.test(code)) flags.push(['version', 'switch'])
    return flags
  }
  if (file.endsWith('.py') || source.startsWith('#!/usr/bin/env python')) {
    const parser = fileURLToPath(new URL('./doc-python-options.py', import.meta.url))
    return JSON.parse(execFileSync('python3', ['-I', parser], {input: source, encoding: 'utf8'}))
  }
  if (file.endsWith('.sh')) {
    return [...source.matchAll(/^\s*--([\w-]+)\)/gm)].map(m => [m[1], 'switch'])
  }
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const declarations = new Map(), imports = new Map(), parsed = new Map(), manual = new Map()
  for (const statement of tree.statements) {
    for (const decl of statement.declarationList?.declarations ?? []) declarations.set(decl.name.text, decl.initializer)
    if (statement.moduleSpecifier?.text?.startsWith('.')) {
      for (const item of statement.importClause?.namedBindings?.elements ?? []) {
        imports.set(item.name.text, join(dirname(file),statement.moduleSpecifier.text))
      }
    }
  }
  function table(node, seen = new Set()) {
    if (!node || seen.has(node)) return
    seen.add(node)
    if (ts.isIdentifier(node)) {
      table(declarations.get(node.text), seen)
      const path = imports.get(node.text)
      if (path && fs?.file(path)) {
        const other = ts.createSourceFile(path, fs.read(path), ts.ScriptTarget.Latest, true)
        for (const statement of other.statements) for (const decl of statement.declarationList?.declarations ?? []) {
          if (decl.name.text === node.text) table(decl.initializer, seen)
        }
      }
    } else if (ts.isAsExpression(node)) table(node.expression, seen)
    else for (const prop of node.properties ?? []) {
      if (ts.isSpreadAssignment(prop)) table(prop.expression, seen)
      else {
        const fields = prop.initializer?.properties ?? []
        const value = key => fields.find(f => f.name?.text === key)?.initializer?.text
        const kind = value('type') === 'boolean' ? 'switch' : 'value'
        const def = fields.find(f => f.name?.text === 'default')?.initializer
        parsed.set(prop.name.text, [
          value('description') ?? '', kind, def ? String(def.text ?? def.getText()) : '',
        ])
      }
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const fn = node.expression.getText(tree), first = node.arguments[0]
      if (fn === 'parseArgs') {
        const prop = first?.properties?.find(p => p.name?.text === 'options')
        table(prop?.initializer ?? prop?.name)
      }
      if (first && ts.isStringLiteral(first)) {
        if (/^(arg|opt|has|flag|all|one|numbers|text1)$/.test(fn)) manual.set(first.text.replace(/^--/, ''), 'option')
        if (/\.(indexOf|includes|has|startsWith)$/.test(fn) && first.text.startsWith('--')) manual.set(first.text.slice(2).split('=')[0], 'option')
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(tree) === 'flags') manual.set(node.name.text, 'option')
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) {
      for (const side of [node.left,node.right]) if (ts.isStringLiteral(side) && side.text.startsWith('--')) manual.set(side.text.slice(2), 'option')
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return parsed.size ? [...parsed].map(([name, detail]) => [name, ...detail]) : [...manual]
}
