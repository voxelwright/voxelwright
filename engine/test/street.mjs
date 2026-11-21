// The SF realm's streets (#450), the faults a person saw at street level, each as a check that failed on the render
// or the data it was found in:
//
//   node test/street.mjs [--parts cars,marks,shots] [--no-build] [--dist dist-sf] [--shots <dir>] [--places "Powell,Castro"]
//
// cars   a repainted kept car keeps none of its own paint: in each colour of the library's that is not its own, the
//        cells of its finest outside look that are neither glass nor lamp and are within a hue of its own paint
//        (sf/cars.mjs `paintOf`). The grey saloon's silver and white kept streaks of red (6.5% of its cells).
// marks  the road's paint and rails the realm's folder holds (bay/marks.bin, sf/marks.mjs): every square of the
//        panel's places is covered (the release's graphs covered six, and every other street kept the bake's 50 cm
//        blocks of paint), centre lines are drawn, crossings OSM says are yellow are yellow, the streetcars' rails
//        (1435 mm) are there beside the cable cars' (1067 mm), and none is a way in a tunnel or on a bridge.
// shots  the realm's three streets, a yellow crossing and its panel views, and four of the panel's own views as the
//        page server draws them, as sf/street-shots.mjs draws them, measured by sf/street_checks.py (asphalt,
//        terraces of roads and pavements, markings, yellow, rails, aliasing). Needs the GPU, the city's packs and
//        graphs (~/.village/engine/bay): local only.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { arg, has, here } from './kit.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
if (!has('no-build') && arg('parts', 'cars,marks,shots').split(',').some((p) => p === 'marks' || p === 'shots')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}

const parts = arg('parts', 'cars,marks,shots').split(',')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const relativeDist = () => dist.startsWith(here) ? dist.slice(here.length).replace(/^\//, '') : dist
const run = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: here, encoding: 'utf8', maxBuffer: 1 << 28, ...opts })

/** A look's cells as runs (sf/cars.mjs `runsOf`): how many of each palette entry. */
function counts(runs, n) {
  const bytes = Buffer.from(runs, 'base64'), out = new Array(n).fill(0)
  let i = 0
  const leb = () => { let v = 0, s = 1, b; do { b = bytes[i++]; v += (b & 127) * s; s *= 128 } while (b & 128); return v }
  while (i < bytes.length) { const count = leb(), which = leb(); out[which] += count }
  return out
}
const colourOf = (k) => (k >> 8) & 255, material = (k) => k & 15
const hueOf = (c) => (c >= 16 ? Math.floor((c - 16) / 10) : -1)
const apart = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d) }

if (parts.includes('cars')) {
  console.log('cars: a repainted car keeps none of its own paint')
  const dir = mkdtempSync(join(tmpdir(), 'street-cars-'))
  try {
    const made = run(['sf/cars.mjs', dir])
    if (made.status !== 0) throw new Error(made.stderr)
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
    for (const c of index.cars) {
      const car = JSON.parse(readFileSync(join(dir, c.path), 'utf8')), look = car.looks[0], n = counts(look.runs, look.palette.length)
      // Its own paint: the hue most of its paint cells are, where its paint is a hue (a grey car's greys are not asked).
      const byHue = new Map()
      look.palette.forEach((k, j) => { if (look.roles?.[j] === 'paint' && hueOf(colourOf(k)) >= 0) byHue.set(hueOf(colourOf(k)), (byHue.get(hueOf(colourOf(k))) ?? 0) + n[j]) })
      const own = [...byHue.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      if (own === undefined) continue
      const filled = n.reduce((a, b, j) => a + (look.palette[j] ? b : 0), 0)
      for (const v of car.variants) {
        const pal = v.looks[0]
        if (pal.some((k, j) => look.roles?.[j] === 'paint' && hueOf(colourOf(k)) >= 0 && apart(hueOf(colourOf(k)), own) <= 1)) continue // repainted in a colour near its own
        let left = 0
        pal.forEach((k, j) => { if (k && material(k) !== 11 && material(k) !== 15 && hueOf(colourOf(k)) >= 0 && apart(hueOf(colourOf(k)), own) <= 1) left += n[j] })
        check(left / filled < 0.003, `${c.name} in ${v.name}: ${(100 * left / filled).toFixed(2)}% of its cells still its own hue ${own} (under 0.3%)`)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

if (parts.includes('marks')) {
  console.log('marks: the whole city\'s paint and rails, from the graph')
  const w = new Int32Array(new Uint8Array(readFileSync(join(dist, 'bay/marks.bin'))).buffer), nc = w[1], ns = w[2]
  const covers = Array.from({ length: nc }, (_, i) => w.subarray(3 + i * 4, 7 + i * 4))
  const segs = Array.from({ length: ns }, (_, i) => w.subarray(3 + nc * 4 + i * 5, 8 + nc * 4 + i * 5))
  const squares = JSON.parse(readFileSync(join(here, 'bay', 'neighbourhoods.json'), 'utf8'))
  const covered = (sq) => { const [e, n] = sq.split('_').map(Number), x = Math.round((e * 1000 - 500000) * 10) + 5000, z = Math.round((4250000 - n * 1000) * 10) - 5000; return covers.some((c) => x >= c[0] && z >= c[1] && x < c[2] && z < c[3]) }
  const bare = squares.filter((r) => !covered(r.square)).map((r) => r.place)
  check(!bare.length && nc >= 150, `${nc} squares covered, the panel's ${squares.length} places among them${bare.length ? ` but for ${bare.join(', ')}` : ''}`)
  const count = (f) => segs.filter((s) => f(s[4] & 15, s[4] >> 4)).length
  check(count((k) => k === 3) > 5000, `${count((k) => k === 3)} segments of centre line (the city's grid, two ways)`)
  check(count((k, c) => k === 4 && c === 1) >= 50, `${count((k, c) => k === 4 && c === 1)} segments of yellow crossing`)
  check(count((k) => k === 7) > 1000 && count((k) => k === 6) > 500, `${count((k) => k === 7)} segments of streetcar rails, ${count((k) => k === 6)} of cable car rails`)
  // The F line at the Ferry Building (37.7953, -122.3937) and at Castro and Market (37.7626, -122.4351), in cells.
  for (const [name, P] of [['the Ferry Building', [533794, 667234]], ['Castro and Market', [497564, 703743]]]) {
    const n = segs.filter((s) => (s[4] & 15) === 7 && Math.hypot((s[0] + s[2]) / 2 - P[0], (s[1] + s[3]) / 2 - P[1]) < 600).length
    check(n > 0, `${n} segments of streetcar rails within 60 m of ${name}`)
  }
  // No centre line over rails: each yellow segment, every metre, more than 1.2 m from every rail's line (a way's middle
  // clear of them was enough, and a 123 m way kept its yellow along 37 m of track).
  {
    const rails = segs.filter((s) => (s[4] & 15) >= 6), near = new Map(), K = 200
    for (const r of rails) for (let gx = Math.floor(Math.min(r[0], r[2]) / K); gx <= Math.floor(Math.max(r[0], r[2]) / K); gx++) for (let gz = Math.floor(Math.min(r[1], r[3]) / K); gz <= Math.floor(Math.max(r[1], r[3]) / K); gz++) { const k = `${gx}_${gz}`; if (!near.has(k)) near.set(k, []); near.get(k).push(r) }
    const far = (p) => { let best = 1e9; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const r of near.get(`${Math.floor(p[0] / K) + i}_${Math.floor(p[1] / K) + j}`) ?? []) { const dx = r[2] - r[0], dz = r[3] - r[1], l2 = dx * dx + dz * dz, u = l2 ? Math.max(0, Math.min(1, ((p[0] - r[0]) * dx + (p[1] - r[1]) * dz) / l2)) : 0; best = Math.min(best, Math.hypot(p[0] - r[0] - dx * u, p[1] - r[1] - dz * u)) } return best }
    let over = 0
    for (const y of segs.filter((s) => (s[4] & 15) === 3)) { const l = Math.hypot(y[2] - y[0], y[3] - y[1]); let m = 0; for (let t = 0; t <= l; t += 10) if (far([y[0] + ((y[2] - y[0]) * t) / l, y[1] + ((y[3] - y[1]) * t) / l]) < 12) m++; if (m >= 5) over++ }
    check(over === 0, `no centre line runs 5 m or more within 1.2 m of rails (${over})`)
  }
  // The Muni Metro under Twin Peaks: OSM's ways pass 29 m from Forest Hill's station (37.7481, -122.4590), deep under
  // the hill; drawn, they were rails on the streets over the tunnel. Read from the marks themselves.
  const FH = [476605, 719955], overTunnel = segs.filter((s) => (s[4] & 15) >= 6 && Math.hypot((s[0] + s[2]) / 2 - FH[0], (s[1] + s[3]) / 2 - FH[1]) < 1500).length
  const apart = JSON.parse(readFileSync(join(here, 'sf/street-tags.json'), 'utf8')).apart.length
  check(overTunnel === 0 && apart > 500, `no rails within 150 m of Forest Hill's station, in the Twin Peaks tunnel (${overTunnel}; ${apart} ways in tunnels or on bridges known)`)
}

if (parts.includes('shots')) {
  console.log('shots: the streets as drawn, measured in the pictures')
  const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'street-check'))
  rmSync(shots, { recursive: true, force: true })
  const places = arg('places', 'Powell,California,Filbert,School crossing,realm-Nob Hill,realm-Telegraph Hill,realm-Russian Hill,realm-Chinatown,realm-Embarcadero,Castro,Haight-Ashbury,Mission,Telegraph Hill')
  const shot = run(['sf/street-shots.mjs', '--out', shots, '--no-build', '--dist', relativeDist(), '--places', places], { stdio: 'inherit' })
  check(shot.status === 0, 'every view drawn')
  if (shot.status === 0) {
    const py = join(homedir(), '.village', 'engine', 'bay', 'venv', 'bin', 'python')
    const judged = spawnSync(py, ['-I', join(here, 'sf/street_checks.py'), shots, '--marks', join(dist, 'bay/marks.bin'), '--json', join(shots, 'checks.json')], { encoding: 'utf8' })
    console.log(judged.stdout.split('\n').filter((l) => !/^(ERROR:root|Traceback|  File|    |ValueError)/.test(l)).join('\n'))
    check(judged.status === 0, `sf/street_checks.py over ${shots}`)
  }
}

if (failures.length) { console.log(`\n${failures.length} failed:\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('\nall street checks pass')
