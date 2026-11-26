import { dirname, isAbsolute, join, normalize } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { options } from './doc-options.mjs'

export const REPO = 'https://github.com/voxelwright/voxelwright'
const repoLink = new RegExp(`^${REPO.replaceAll('.', '\\.')}/(?:blob|tree)/main/?(.*)$`)

// A relative module name in prose can be abbreviated to its last few components.
let suffixes
export const workingTree = {
  named(name) {
    if (!suffixes) {
      suffixes = new Set()
      const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {encoding: 'utf8', maxBuffer: 32e6})
      for (const path of files.split('\0')) {
        if (!path || !existsSync(path)) continue
        for (let suffix = path;; suffix = suffix.slice(suffix.indexOf('/') + 1)) {
          suffixes.add(suffix)
          if (suffix.includes('/')) suffixes.add(suffix.slice(0, suffix.indexOf('/') + 1))
          if (!suffix.includes('/')) break
        }
      }
    }
    return suffixes.has(name)
  },
  exists: existsSync,
  file: path => statSync(path, {throwIfNoEntry: false})?.isFile(),
  read: path => readFileSync(path, 'utf8'),
}

const sourceFile = /\.(?:[cm]?js|jsx|tsx?|py|rs|sh|mdx?|toml|html|ya?ml|css|json|txt|lock|csv|svg|wasm)$/i
const generatedDir = /(?:^|\/)(?:screenshots|\.shots|dist(?:-[\w-]+)?|\.sound-lab|node_modules)(?:\/|$)/
const interpreter = /(?:^|[\s(])(?:node|python3?)\s+(?:--[\w-]+\s+)*['"]?([.\w/][.\w/-]*)['"]?(?=$|[\s)])/
// Git paths and shell tokens are treated as text. Never run commands from a page.
const repoPath = /(?:^|[\s`'"])((?:\.{1,2}\/|[\w.-]+\/)(?:[\w./-]*[\w/-])?)(?=$|[\s`'"])/g

function inlineExamples(line) {
  const spans = [...line.matchAll(/`([^`]+)`/g)].map(match => match[1])
  // Also recognize a literal invocation written in prose without Markdown delimiters.
  const prose = line.replace(/`[^`]*`/g, ' ')
  for (const match of prose.matchAll(/\bnpm (?:--prefix [\w./-]+ )?run [\w:-]+(?: --(?: --[\w=-]+)*)?|\b(?:node|python3?) [\w./-]+\.(?:[cm]?js|ts|py)\b/g)) {
    spans.push(match[0])
  }
  return spans
}

function ancestors(dir) {
  const dirs = [dir]
  while (dir !== '.') dirs.push(dir = dirname(dir))
  return dirs
}

export function mentions(page, content, fs = workingTree, ignores = {}) {
  const errors = []
  const site = /^guide\/[^/]+\.mdx?$/.test(page)
  const dirs = ancestors(dirname(page))
  const declared = content.match(/^Run commands from `([.\w/-]+)`/m)?.[1]
  if (declared) dirs.unshift(declared)
  else if (page.endsWith('/SKILL.md')) {
    // Skills sit outside their packages. An unambiguous package in the front
    // matter supplies the same context as a README inside that package.
    const scope = content.match(/^description: (.+)$/m)?.[1] ?? ''
    const packages = new Set([...scope.matchAll(/\b([\w-]+)\//g)]
      .map(match => match[1]).filter(dir => fs.file(join(dir, 'package.json'))))
    if (packages.size === 1) dirs.unshift(...packages)
  }
  const inside = path => !isAbsolute(path) && normalize(path).replace(/\/$/, '') !== '..' && !normalize(path).startsWith('../')
  const find = (name, bases, test = fs.exists) => bases.map(dir => join(dir, name)).find(path => inside(path) && test(path))
  let cwd, fence
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const i = index
    let line = lines[index]
    while (fence && line.endsWith('\\') && index + 1 < lines.length) line = line.slice(0, -1) + lines[++index]
    const delimiter = line.match(/^\s*(```|~~~)(\w*)/)
    if (delimiter) {
      fence = fence ? null : delimiter[2] || 'text'
      cwd = null
      continue
    }
    if (fence && line.trimStart().startsWith('#')) continue
    const fail = (token, message) => {
      if (!Object.hasOwn(ignores, token) || !ignores[token].trim()) errors.push(`${page}:${i+1}: ${message}`)
    }
    for (const [, target] of line.matchAll(/\]\(([^\s()]+)\)/g)) {
      const path = target.split(/[?#]/)[0]
      const tracked = path.match(repoLink)?.[1]
      if (tracked !== undefined) {
        if (!fs.exists(tracked.replace(/\/$/, '') || '.')) fail(target, 'missing link ' + tracked)
      } else if (!path || /^[a-z]+:/i.test(path)) {
        continue
      } else if (site) {
        // Mintlify publishes guide/ alone: a page is /slug, anything else is on GitHub.
        if (!path.startsWith('/')) fail(path, `link ${path}: link a guide page as /slug and a repository file by its ${REPO} URL`)
        else if (!fs.file(`guide${path === '/' ? '/index' : path}.md`) && !fs.file('guide' + path)) fail(path, 'missing page ' + path)
      } else if (!path.startsWith('/') && !find(path, [dirname(page)])) fail(path, 'missing link ' + path)
    }
    const spans = fence || /^ {4}\S/.test(line) ? [line] : inlineExamples(line)
    for (const span of spans) {
      if (!fence) {
        cwd = null
        const at = line.indexOf('`' + span + '`')
        const before = at < 0 ? '' : line.slice(0, at)
        const after = at < 0 ? '' : line.slice(at + span.length + 2)
        const hint = after.match(/^\s*\(?in `([\w./-]+)\/?`/)?.[1] ?? before.match(/\b([\w-]+) $/)?.[1]
        if (hint && fs.file(join(hint, 'package.json'))) cwd = hint
      }
      const prior = cwd
      if (sourceFile.test(span) && /^[\w-][\w.-]*$/.test(span) && !find(span, dirs) && !fs.named(span)) {
        fail(span, 'missing file ' + span)
      }
      for (const part of span.split(/\s+#[^\n]*$/)[0].split(/&&|\s[;|]\s/)) {
        const cd = part.match(/(?:^|\s|\()cd\s+([.\w/-]+)/)
        if (cd) {
          cwd = find(cd[1], cwd ? [cwd, '.', ...dirs] : ['.', ...dirs])
          if (!cwd) {
            fail(cd[1], 'missing command directory ' + cd[1])
            cwd = cd[1]
          }
        }
        const bases = cwd ? [cwd] : dirs
        const input = part.match(/(?:^|\s)(?:cat|less|source)\s+['"]?([\w.-]+)['"]?(?:$|\s)/)
        if (input && sourceFile.test(input[1]) && !find(input[1], bases, fs.file)) {
          fail(input[1], 'missing command input ' + input[1])
        }
        // npm accepts --prefix on either side of the run subcommand.
        const npm = part.match(/\bnpm\s+(?:--prefix\s+([.\w/-]+)\s+)?run\s+(?:--prefix\s+[.\w/-]+\s+)?(?:(?:-s|--silent)\s+)?([\w:-]+)/)
        let script
        if (npm) {
          const prefix = npm[1] ?? part.match(/--prefix\s+([.\w/-]+)/)?.[1]
          const pkg = find(join(prefix || '', 'package.json'), bases, fs.file)
          const scripts = pkg && JSON.parse(fs.read(pkg)).scripts
          const value = scripts && Object.hasOwn(scripts, npm[2]) ? scripts[npm[2]] : null
          if (typeof value !== 'string') fail(npm[2], `missing npm script ${npm[2]} in ${pkg || prefix || bases[0]}`)
          const entry = typeof value === 'string' && value.match(interpreter)
          if (entry) {
            script = join(dirname(pkg), entry[1])
            if (!inside(script) || !fs.file(script)) fail(npm[2], 'missing npm command file ' + script)
          }
        }
        const shell = !fence || /^(sh|bash|zsh|shell|console|text)$/.test(fence)
        const cmd = shell && part.match(interpreter)
        if (cmd) {
          script = find(cmd[1], bases, fs.file)
          if (!script) fail(cmd[1], 'missing command file ' + cmd[1])
        }
        const direct = part.trim().match(/^([.\w-]+\/[\w./-]+)(?:\s|$)/)
        if (direct && !script) script = find(direct[1], bases, fs.file)
        if (script === 'street/run.mjs' && fs.file(script) && fs.read(script).includes("ssrLoadModule('/src/server.ts')")) script = 'street/src/server.ts'
        if (/^(?:\.\/target\/(?:debug|release)\/)?village-master\b/.test(part.trim()) ||
            (/^cargo run\b/.test(part.trim()) && find('Cargo.toml', bases) === 'master/Cargo.toml')) {
          script = 'master/src/config.rs'
        }
        if (script && inside(script) && fs.file(script) && part.includes('--')) {
          const flags = options(script, fs.read(script), fs)
          const argv = (npm || /^cargo run\b/.test(part.trim())) && part.includes(' -- ') ? part.slice(part.indexOf(' -- ') + 4) : part
          for (const [, flag] of argv.matchAll(/(?:^|[\s\[])--([\w-]+)/g)) {
            if (npm && argv === part && flag === 'prefix') continue
            if (!flags.some(([name]) => name === flag)) fail('--' + flag, `unknown --${flag} in ${script}`)
          }
        }
        for (const [, path] of part.matchAll(repoPath)) {
          const root = path.split('/')[0]
          const hostname = /^[\w.-]+\.(?:com|de|org|ai|net)$/i.test(root)
          if (hostname || path.includes('...') || part.includes('Path.home() / "' + path + '"')) continue
          if (generatedDir.test(path) || path.startsWith('./target/')) continue
          if (find(path, [...bases, ...dirs])) continue
          if (!cwd && !fs.exists(root) && fs.named(path)) continue
          const looksLikePath = path.startsWith('.') || (span === path && path.endsWith('/')) ||
            /\.[a-z][a-z0-9]{0,7}$/i.test(path) || find(root, dirs)
          if (looksLikePath) fail(path, 'missing path ' + path)
        }
      }
      if (span.trimStart().startsWith('(')) cwd = prior
    }
  }
  return [...new Set(errors)]
}
