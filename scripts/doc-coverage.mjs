// A change to a component's source reaches main with its documentation reviewed.
// The stamps catch a change to a bound surface. This catches the rest: when a pull
// request changes source in a component and touches none of the pages that document
// it, the check fails and names those pages. A page counts as touched when its file
// or its stamp in guide/stamps.json changed. When no page needs to change, say why
// in a `Docs-unchanged: <reason>` line in a commit message or the pull request body.
//
//   node scripts/doc-coverage.mjs [BASE]     BASE defaults to origin/main
//
// In a GitHub pull_request run it compares the merge commit with the base branch.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// engine/ holds many parts, each with its own pages: engine/kit, engine/page, engine/core...
export const component = path => {
  const parts = path.split('/')
  if (parts.length < 2) return null
  return parts[0] === 'engine' && parts.length > 2 ? `engine/${parts[1]}` : parts[0]
}

// Paths whose change never asks for a documentation review.
const quiet = [
  /\.(?:md|png|jpe?g|webp|gif|svg|wav|ogg|mp3|glb|bin|br|woff2?|ttf|otf)$/i,
  /(?:^|\/)(?:test|tests|__tests__|fixtures)\//,
  /(?:^|[./_-])test\.[cm]?[jt]s$|(?:^|\/)test_[\w-]+\.py$|_test\.(?:py|rs)$/,
  /(?:^|\/)(?:package-lock\.json|Cargo\.lock)$/,
  /^(?:guide|\.github|\.agents|\.claude)\//,
]

export function uncovered(changed, bindings, touched) {
  const pages = Object.keys(bindings)
  const docs = name => pages.filter(page => page.startsWith(name + '/')
    || Object.keys(bindings[page]).some(source => component(source) === name))
  const byComponent = new Map()
  for (const path of changed) {
    const name = component(path)
    if (!name || pages.includes(path) || quiet.some(pattern => pattern.test(path))) continue
    byComponent.set(name, [...byComponent.get(name) ?? [], path])
  }
  return [...byComponent].map(([name, files]) => ({name, files, pages: docs(name)}))
    .filter(({pages}) => !pages.some(page => touched.has(page)))
}

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 32e6, stdio: ['ignore', 'pipe', 'pipe']}).trimEnd()
const lines = text => text.split('\n').filter(Boolean)

function main() {
  process.chdir(fileURLToPath(new URL('..', import.meta.url)))
  let base, reasons = ''
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    // The checkout is the merge commit, one commit deep. Its diff with the base tip is the pull request.
    git('fetch', '--no-tags', '--depth=1', 'origin', process.env.GITHUB_BASE_REF)
    base = git('rev-parse', 'FETCH_HEAD')
    reasons = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.body ?? ''
  } else {
    const ref = process.argv[2] ?? 'origin/main'
    try { git('rev-parse', '--verify', '--quiet', ref + '^{commit}') } catch {
      console.log(`Docs coverage skipped: no ${ref} in this checkout.`)
      return
    }
    base = git('merge-base', ref, 'HEAD')
    reasons = git('log', '--format=%B', `${base}..HEAD`)
  }
  const changed = [...lines(git('diff', '--name-only', base)), ...lines(git('ls-files', '--others', '--exclude-standard'))]
  const bindings = JSON.parse(readFileSync('guide/bindings.json', 'utf8'))
  let before = {}
  try { before = JSON.parse(git('show', `${base}:guide/stamps.json`)) } catch {}
  const now = existsSync('guide/stamps.json') ? JSON.parse(readFileSync('guide/stamps.json', 'utf8')) : {}
  const touched = new Set([...changed, ...Object.keys(now).filter(page => JSON.stringify(now[page]) !== JSON.stringify(before[page]))])
  const missing = uncovered(changed, bindings, touched)
  const excuse = reasons.match(/^Docs-unchanged:[ \t]*(\S.*)$/m)?.[1]
  if (!missing.length) return console.log(`Docs coverage: every changed component has a reviewed page (${changed.length} files since ${base.slice(0, 12)}).`)
  for (const {name, files, pages} of missing) {
    console.error(`${name}: ${files.length} source file(s) changed (${files.slice(0, 3).join(', ')}${files.length > 3 ? ', ...' : ''})`)
    console.error(pages.length ? `  and none of its pages changed or was re-verified: ${pages.join(', ')}`
      : '  and no page documents it: bind a page to its source in guide/bindings.json')
  }
  if (excuse) return console.log(`Docs-unchanged: ${excuse}`)
  console.error('Update those pages, or add a line "Docs-unchanged: <why no page changes>" to a commit message or the pull request body.')
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
