// Which checks cover a change (#450), for iterating: `npm run check -- --changed` and `npm run sf -- --changed` run
// only those. The change is what the branch changed against origin/main (`--base <ref>` for a branch stacked on
// another), with what is not committed yet (new files too). The whole suite stays the rule on the head that is reported.
//
// Each file goes by the first rule it matches. A file no rule matches runs everything, as does any rule that is not
// sure: every module of the page comes in through page/main.ts, so a change to one can break any check that opens it.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const here = new URL('..', import.meta.url).pathname
export const EVERY = '*'
/** The SF realm as `npm run sf` checks it, and the scripts that check one part of it more closely. */
const REALM = ['sf', 'sf-look']
/** [what a path matches, what it is, the checks that cover it: names, EVERY, or from the match]. In order. */
export const RULES = [
  [/(^|\/)[^/]+\.mdx?$|^docs\/|^\.agents\/|^\.claude\/|^CREDITS|^DESIGN/, 'words', []],
  [/^(?!engine\/)/, 'outside the engine', []],
  [/^engine\/test\/(kit|all|changed|sf-suite)\.mjs$/, "the checks' own kit", EVERY],
  [/^engine\/test\/plugkit\.mjs$/, "the plugins' checks' kit (plugins/*/check.mjs, which plugged runs)", ['plugkit', 'plugins', 'swap', 'plugged']],
  [/^engine\/test\/([a-z0-9-]+)\.mjs$/, "a check's own script, or a helper of the checks that import it", (m) => script(m[1])],
  [/^engine\/test\/(.+)$/, "data a check reads", (m) => readers(m[1])],
  [/^engine\/page\/(boards|boards-edit|eggs|eggs-pictures|logos|first|explore)\.ts$/, 'a module only the SF realm runs (the city page imports it, so it must still come up)', (m) => ['types', 'city', ...REALM, PART[m[1]]]],
  [/^engine\/sf\/marks\.mjs$/, "the road's marks, which the page server makes", EVERY],
  [/^engine\/sf\/(boards|heroes|street|cars|life|pilot-life|far|landmark)/, "the SF realm's build and data", (m) => ['street', ...REALM, PART[m[1]]]],
  [/^engine\/sf\//, "the SF realm's build and data", ['street', ...REALM]],
  [/^engine\/player\//, 'the static host and player', ['types', ...REALM]],
  [/^engine\/(blocks|kit)\//, 'the Voxelmorphism kit and its stage, which the SF realm carries', ['types', 'blocks', ...REALM]],
  [/^engine\/landing\//, 'the landing', ['types']],
  [/^engine\/bay\/[^/]+\.py$/, "the Bay's bake, run outside the checks", []],
  [/^engine\/page\//, 'the page, which every check that opens it runs', EVERY],
  [/^engine\/(package(-lock)?|tsconfig)\.json$/, "the engine's packages and settings", EVERY],
  [/^engine\/core\//, 'the core, under everything', EVERY],
]
/** The script that checks one part of the SF realm more closely, by what the part is called. Not part of `npm run sf`. */
const PART = { boards: 'sf-boards', 'boards-edit': 'sf-boards', eggs: 'sf-eggs', 'eggs-pictures': 'sf-eggs', logos: 'sf-boards', first: 'sf-explore', explore: 'sf-explore', heroes: 'sf-towers', landmark: 'sf-towers', far: 'sf-towers', street: 'sf-life', cars: 'sf-life', life: 'sf-life', 'pilot-life': 'sf-life' }
const tests = join(here, 'test'), KIT = ['all.mjs', 'changed.mjs']
/** The scripts directly under test/ whose text names `what`, the runners and this map aside. */
const naming = (what, but = '') => readdirSync(tests).filter((f) => f.endsWith('.mjs') && f !== but && !KIT.includes(f) && readFileSync(join(tests, f), 'utf8').includes(what))
/** A script under test/: the check it is; and if other scripts there import it (a helper), their checks too. */
const script = (name, seen = new Set()) => {
  if (seen.has(name)) return []
  seen.add(name)
  return [name, ...naming(`'./${name}.mjs'`, `${name}.mjs`).flatMap((f) => script(f.slice(0, -4), seen))]
}
/** A file under test/ that is not a script there (made-cars/hatchback.json, mind-kept.json): the checks of the scripts that name it; everything if none does. */
const readers = (path) => { const by = naming(path); return by.length ? [...new Set(by.flatMap((f) => script(f.slice(0, -4))))] : EVERY }

/** The files changed against `base`, committed or not, from the repo's root; null where git cannot say. */
export function changedFiles(base = 'origin/main') {
  // (Paths as they are, not quoted where they are not ASCII.)
  const git = (...a) => spawnSync('git', ['-c', 'core.quotePath=false', ...a], { cwd: here, encoding: 'utf8' })
  const root = git('rev-parse', '--show-toplevel').stdout.trim()
  // (Without rename detection, so that a file moved away is named where it was as well as where it went.)
  const asked = [['diff', '--name-only', '--no-renames', `${base}...HEAD`], ['diff', '--name-only', '--no-renames', 'HEAD'], ['ls-files', '--others', '--exclude-standard']].map((a) => spawnSync('git', ['-c', 'core.quotePath=false', ...a], { cwd: root, encoding: 'utf8' }))
  if (!root || asked.some((r) => r.status !== 0)) return null
  return [...new Set(asked.flatMap((r) => r.stdout.split('\n').filter(Boolean)))].sort()
}

/** For each file, the rule it went by and the checks it names; and every check named (EVERY among them if any file is unsure). */
export function covering(files) {
  const why = files.map((file) => {
    for (const [pattern, what, checks] of RULES) {
      const m = pattern.exec(file)
      if (m) return { file, what, checks: typeof checks === 'function' ? [checks(m)].flat().filter(Boolean) : checks === EVERY ? [EVERY] : checks }
    }
    return { file, what: 'no rule says', checks: [EVERY] }
  })
  return { why, names: new Set(why.flatMap((w) => w.checks)) }
}

/**
 * Which of a runner's checks to run for `--changed`, said as it goes: every file, its rule and its checks; then what
 * runs. `checks` are the runner's, each a name or [name, the test/ script it runs] where the two differ (all.mjs's
 * `phone` runs flight.mjs). Returns the names to run (all of them where unsure, or where git cannot say) and the
 * names of checks elsewhere that the change also concerns.
 */
export function pick(checks, base = 'origin/main', files = changedFiles(base)) {
  const pairs = checks.map((c) => (Array.isArray(c) ? c : [c, c])), names = pairs.map(([n]) => n)
  if (!files) { console.log(`--changed: git could not say what changed against ${base}; running everything`); return { run: names, elsewhere: [] } }
  const { why, names: wanted } = covering(files)
  console.log(`--changed: ${files.length} file${files.length === 1 ? '' : 's'} changed against ${base}, uncommitted ones included`)
  for (const w of why) console.log(`  ${w.file}: ${w.what} -> ${w.checks.includes(EVERY) ? 'everything' : w.checks.join(', ') || 'nothing'}`)
  const run = wanted.has(EVERY) ? names : pairs.filter(([n, s]) => wanted.has(n) || wanted.has(s)).map(([n]) => n)
  const elsewhere = [...wanted].filter((n) => n !== EVERY && !pairs.some(([name, s]) => n === name || n === s))
  console.log(`--changed: ${run.length === names.length ? `all ${run.length}` : `${run.length} of ${names.length}`} to run${run.length && run.length < names.length ? `: ${run.join(', ')}` : ''}. Run everything once on the head you report.`)
  return { run, elsewhere }
}
