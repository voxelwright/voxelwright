// The judge, as a check (#410): the benchmark clips are rendered from the synthesiser as it now is, measured and
// scored (ears/judge.py, ears/score.py), and held against what they scored when last accepted (ears/baseline.json).
// It fails if any clip has a hard fault (clipping, DC, an event buried under the music), if a measure that was inside
// the range of well-made sound is now outside it, if any clip scores more than 1.5 under its accepted score, or if the
// mean falls by more than half a point. The render is the same every time, so a new fault is the change's own. Nobody listens: this is what stands
// in for it. To accept a change on purpose: node test/judged.mjs --accept
//
// It needs uv (https://docs.astral.sh/uv/) for the judge's Python; without it the check fails, it does not pass.
//
//   node test/judged.mjs [--accept] [--keep dir]
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, here } from './kit.mjs'

const ears = join(here, 'ears'), keep = arg('keep', ''), out = keep || mkdtempSync(join(tmpdir(), 'ears-'))
if (keep) mkdirSync(keep, { recursive: true })
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.status !== 0) { console.error((r.stdout ?? '') + (r.stderr ?? '') + (r.error ? String(r.error) : '')); const why = r.error?.code === 'ENOENT' ? 'was not found (the judge needs uv: see ears/pyproject.toml)' : `failed (${r.signal ? `signal ${r.signal}` : `exit ${r.status}`})`; console.error(`FAILED: ${cmd} ${args.slice(0, 3).join(' ')} ${why}`); process.exit(1) } return r.stdout }
run('node', ['ears/bench.mjs', '--out', out], here)
run('uv', ['run', '--quiet', 'python', 'judge.py', 'measure', out], ears)
run('uv', ['run', '--quiet', 'python', 'score.py', 'clips', out, '--json', join(out, 'score.json'), '--faults', '0'], ears)
const got = JSON.parse(readFileSync(join(out, 'score.json'), 'utf8')), file = join(ears, 'baseline.json')
const now = Object.fromEntries(Object.entries(got).map(([n, s]) => [n, { score: s.score, out: Object.keys(s.costs), hard: s.hard }]))
const mean = (o) => Object.values(o).reduce((a, s) => a + s.score, 0) / Object.keys(o).length
if (process.argv.includes('--accept')) { writeFileSync(file, JSON.stringify(now, null, 1) + '\n'); console.log(`accepted: ${Object.keys(now).length} clips, mean ${mean(now).toFixed(1)}`); process.exit(0) }
const was = JSON.parse(readFileSync(file, 'utf8')), failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const hard = Object.entries(now).filter(([, s]) => s.hard.length), worse = Object.entries(now).filter(([n, s]) => was[n] && s.score < was[n].score - 1.5), gone = Object.keys(was).filter((n) => !now[n])
check(!gone.length, `every benchmark clip is still rendered (${Object.keys(now).length} of ${Object.keys(was).length})${gone.length ? `: missing ${gone.join(', ')}` : ''}`)
check(!hard.length, `no clip has a hard fault${hard.length ? `: ${hard.map(([n, s]) => `${n} (${s.hard.join('; ')})`).join(' | ')}` : ''}`)
const fresh = Object.entries(now).map(([n, s]) => [n, s.out.filter((k) => was[n] && !was[n].out.includes(k))]).filter(([, k]) => k.length)
check(!fresh.length, `no measure has left the range of well-made sound since it was accepted${fresh.length ? `: ${fresh.map(([n, k]) => `${n} (${k.join(', ')}: ${got[n].faults.filter((f) => k.some((x) => f.includes(`(${x} `))).map((f) => f.split(' (')[0]).join('; ')})`).join(' | ')}` : ''}`)
check(!worse.length, `no clip scores more than 1.5 under what was accepted${worse.length ? `: ${worse.map(([n, s]) => `${n} ${was[n].score} -> ${s.score} (out: ${s.out.join(', ') || 'none'})`).join(' | ')}` : ''}`)
check(mean(now) >= mean(was) - 0.5, `the mean score is ${mean(now).toFixed(1)} (accepted ${mean(was).toFixed(1)}); ${Object.values(now).filter((s) => !s.out.length && !s.hard.length).length} of ${Object.keys(now).length} clips have nothing out of the range of well-made sound`)
if (!keep) rmSync(out, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('judged: ok')
