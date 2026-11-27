// The cars' shapes and shells (#39), without a page:
//
//   - `cleanShell` (sf/sculpt-cars.mjs) on a box of a car's skin made with each fault on purpose: a pinhole in its
//     roof is sealed, a speck beside it taken off, a sloped sheet whose steps meet only at their edges sealed from
//     inside, a nub on its roof smoothed; and what is meant stays: a window, an aerial, a pair of mirrors, a pinhole
//     among the tyres' rows, a diagonal pole;
//   - `coarser` (page/car-sculpt.ts) keeps a skin one cell thick shut at every coarseness: the rule it replaced (a
//     coarse cell where a third of its cells are) opened it, and is run here to show it still would;
//   - the hand-written car (page/living.ts `fineCar`): within what a look may be, its paint polished, no specks, holes,
//     leaks or pimples, and nothing but glass between the driver's eye and the road ahead;
//   - the SF library (sf/cars.mjs, made afresh): the coupe repainted in each of its colours keeps none of its red, its
//     looks and those of the kept cars on this machine are shut at every coarseness, with no leaks.
//
//   node test/sculpt-cars.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { coarser, GT_COUPE, leaksOf, outsideAir, sculptCoupe } from '../page/car-sculpt.ts'
import { FINE_FILLED, fineCar } from '../page/living.ts'
import { cleanShell } from '../sf/sculpt-cars.mjs'
import { here } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const STEEL = 12, GLASS = 11, PAINT = STEEL | (20 << 8), TRIM = STEEL | (12 << 8), GLASS_ = GLASS | (13 << 8)
const shut = (kinds, size) => { const o = outsideAir(kinds, size); let n = 0; for (let i = 0; i < kinds.length; i++) if (!kinds[i] && !o[i]) n++; return n }

// ── A box of skin with each fault, and each thing that is meant ──
console.log('cleanShell: what it takes off and seals, and what it leaves')
{
  const size = [40, 24, 20], [w, h, d] = size, cells = new Uint16Array(w * h * d), i = (x, y, z) => x + w * (z + d * y)
  const set = (x, y, z, k = PAINT) => { cells[i(x, y, z)] = k }
  // A shell one cell thick from x 4 to 35, y 2 to 15, z 3 to 16; its back third's roof a staircase down to x 4 whose
  // steps meet only at their edges.
  const roof = (x) => (x >= 12 ? 15 : 7 + x - 4)
  for (let y = 2; y <= 15; y++) for (let z = 3; z <= 16; z++) for (let x = 4; x <= 35; x++) {
    if (y > roof(x)) continue
    const skin = x === 4 || x === 35 || z === 3 || z === 16 || y === 2 || y === roof(x)
    if (skin) set(x, y, z)
  }
  // Glazed windows in both sides.
  for (let y = 10; y <= 13; y++) for (let x = 18; x <= 24; x++) { set(x, y, 3, GLASS_); set(x, y, 16, GLASS_) }
  // Faults: a pinhole in the roof, a speck a cell off the side, a nub on the roof.
  cells[i(28, 15, 9)] = 0
  set(30, 8, 0)
  set(26, 16, 6)
  // Meant: an aerial on the roof, a mirror each side, a flap by the tyres with a pinhole in its rows, a diagonal pole.
  for (let y = 16; y <= 19; y++) set(14, y, 10, TRIM)
  set(27, 12, 2); set(27, 12, 17)
  for (let y = 0; y <= 3; y++) for (let x = 6; x <= 12; x++) set(x, y, 1, TRIM)
  cells[i(8, 1, 1)] = 0
  for (let t = 0; t < 4; t++) set(36 + t, 15 + t, 10, TRIM)
  const c = cleanShell(cells, size, (k) => k === PAINT), at = (x, y, z) => c.kinds[i(x, y, z)]
  const sealed = Uint16Array.from(cells); sealed[i(28, 15, 9)] = PAINT
  const before = leaksOf(sealed, size).length, inside = outsideAir(sealed, size)
  check(before > 0 && leaksOf(c.kinds, size).length === 0 && c.leaks >= before, `the staircase's ${before} cells where a ray passes between edges are sealed from inside (${c.leaks} filled), none left`)
  check(at(28, 15, 9) === PAINT && c.holes === 1, `the pinhole in the roof is sealed with paint (${c.holes} hole)`)
  check(!at(30, 8, 0) && c.specks === 1, `the speck beside the side is taken off (${c.specks} speck)`)
  check(!at(26, 16, 6) && c.pimples === 1, `the nub on the roof is smoothed (${c.pimples} pimple)`)
  check([10, 13].every((y) => at(18, y, 3) === GLASS_ && at(24, y, 16) === GLASS_), 'the windows stay glass')
  check([16, 17, 18, 19].every((y) => at(14, y, 10) === TRIM), 'the aerial stays, to its tip')
  check(at(27, 12, 2) === PAINT && at(27, 12, 17) === PAINT, 'the pair of mirrors stays')
  check(!at(8, 1, 1), 'a pinhole among the tyres\' rows is left')
  check([0, 1, 2, 3].every((t) => at(36 + t, 15 + t, 10) === TRIM), 'the diagonal pole stays, to its tip')
  check(c.kinds.every((k, j) => k === cells[j] || [i(28, 15, 9), i(30, 8, 0), i(26, 16, 6)].includes(j) || (!cells[j] && !inside[j])), 'nothing else changes: what it seals for the staircase is shut inside')
  // A window left open stays open: the box opened on one side by a pane's width.
  const open = Uint16Array.from(c.kinds)
  for (let y = 10; y <= 13; y++) for (let x = 18; x <= 24; x++) open[i(x, y, 16)] = 0
  const o = cleanShell(open, size, (k) => k === PAINT)
  check([10, 11, 12, 13].every((y) => [18, 21, 24].every((x) => !o.kinds[i(x, y, 16)])) && o.holes === 0, 'an open window stays open')

  // ── Coarser keeps the skin shut ──
  console.log('coarser: a skin one cell thick stays shut at every coarseness')
  const whole = c.kinds, old = (kinds, by) => {
    const cs = size.map((v) => Math.ceil(v / by)), out = new Uint16Array(cs[0] * cs[1] * cs[2])
    for (let y = 0; y < cs[1]; y++) for (let z = 0; z < cs[2]; z++) for (let x = 0; x < cs[0]; x++) {
      let n = 0, k = 0
      for (let b = 0; b < by; b++) for (let e = 0; e < by; e++) for (let a = 0; a < by; a++) { const X = x * by + a, Y = y * by + b, Z = z * by + e; if (X < w && Y < h && Z < d && whole[i(X, Y, Z)]) { n++; k = whole[i(X, Y, Z)] } }
      if (n * 3 >= by ** 3) out[x + cs[0] * (z + cs[2] * y)] = k
    }
    return { kinds: out, size: cs }
  }
  for (const by of [2, 4]) {
    const now = coarser(whole, size, by), was = old(whole, by)
    check(shut(now.kinds, now.size) > 0 && leaksOf(now.kinds, now.size).length === 0, `by ${by}: shut (${shut(now.kinds, now.size)} cells of air inside), no leaks; the rule it replaced left ${shut(was.kinds, was.size)} shut`)
  }
}

// ── The hand-written car ──
console.log('fineCar: its look')
{
  const car = fineCar([0, 0, 0]), look = car.fine[0], [w, h, d] = look.size, kinds = look.cells, per = look.per
  let filled = 0, polished = 0, paint = 0
  for (const k of kinds) if (k) { filled++; if (k & 128) polished++; if ((k & 15) === STEEL && ((k >> 8) & 255) === 20) paint++ }
  check(filled <= FINE_FILLED && look.size.join() === '168,52,72' && per === 4, `${filled} cells filled of ${look.size.join(' x ')} (at most ${FINE_FILLED})`)
  check(polished > 20000 && polished === paint, `its paint is polished: ${polished} cells, every one of its red steel`)
  const c = cleanShell(kinds, look.size, (k) => (k & 128) !== 0)
  check(c.specks + c.holes + c.leaks + c.pimples === 0, `no specks, holes, leaks or pimples (${c.specks}, ${c.holes}, ${c.leaks}, ${c.pimples})`)
  // From the driver's eye: rays ahead (20 degrees either way, 4 below to 15 above) meet nothing but glass before they
  // leave the car, and nothing is within 7.5 cm of the eye.
  const eye = car.eye.map((v) => v * per), at = (x, y, z) => { const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); return X < 0 || Y < 0 || Z < 0 || X >= w || Y >= h || Z >= d ? -1 : kinds[X + w * (Z + d * Y)] }
  let near = 0
  for (let c2 = -3; c2 <= 3; c2++) for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) if (Math.hypot(a, b, c2) <= 3 && at(eye[0] + a, eye[1] + b, eye[2] + c2) > 0) near++
  const blocked = []
  for (let yaw = -20; yaw <= 20; yaw += 4) for (let pitch = -4; pitch <= 15; pitch += 3) {
    const ya = (yaw * Math.PI) / 180, pa = (pitch * Math.PI) / 180, dir = [Math.cos(pa) * Math.cos(ya), Math.sin(pa), Math.cos(pa) * Math.sin(ya)]
    for (let t = 0; t < 400; t += 0.25) {
      const k = at(eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t)
      if (k < 0 || (k && (k & 15) === GLASS)) break
      if (k) { blocked.push(`${yaw},${pitch}`); break }
    }
  }
  check(near === 0, `nothing within 7.5 cm of the driver's eye (${near} cells)`)
  check(!blocked.length, `from the driver's seat ahead, nothing but glass before the road (${blocked.length ? `blocked at ${blocked.join(' ')}` : '88 rays'})`)
  const summonLike = sculptCoupe({ ...GT_COUPE, paint: PAINT })
  check(summonLike.size.join() === '180,52,77', `the GT coupe (the library's and G's) is ${summonLike.size.join(' x ')} cells at 2.5 cm`)
}

// ── The library ──
console.log('the SF library: repainted cleanly, shut at every coarseness')
{
  const dir = mkdtempSync(join(tmpdir(), 'sculpt-cars-'))
  try {
    const made = spawnSync(process.execPath, ['sf/cars.mjs', dir], { cwd: here, encoding: 'utf8' })
    if (made.status !== 0) throw new Error(made.stderr)
    const unrun = (runs, palette, n) => { const b = Buffer.from(runs, 'base64'), c = new Uint16Array(n); let i = 0, at = 0; const leb = () => { let v = 0, s = 1, x; do { x = b[i++]; v += (x & 127) * s; s *= 128 } while (x & 128); return v }; while (i < b.length) { const n2 = leb(), which = leb(); c.fill(palette[which], at, at + n2); at += n2 } return c }
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
    for (const entry of index.cars.filter((c) => ['coupe', 'saloon', 'suv', 'hatch', 'van', 'truck'].includes(c.id))) {
      const car = JSON.parse(readFileSync(join(dir, entry.path), 'utf8')), first = car.looks[0], n = (l) => l.size[0] * l.size[1] * l.size[2]
      const looks = car.looks.map((l) => ({ l, kinds: unrun(l.runs, l.palette, n(l)) })).filter(({ l }) => Math.abs(l.size[0] / l.per - first.size[0] / first.per) < 3)
      const said = looks.map(({ l, kinds }) => `${l.per}: ${shut(kinds, l.size)} shut, ${leaksOf(kinds, l.size).length} leaks`)
      check(looks.every(({ l, kinds }) => shut(kinds, l.size) > 0 && leaksOf(kinds, l.size).length === 0), `${car.name}, its outside at each coarseness (${said.join('; ')})`)
      if (entry.id !== 'coupe') continue
      // Repainted: none of its own red left in any colour it is also seen in (test/street.mjs asks under 0.3% of every car).
      const kinds = looks[0].kinds, count = new Map()
      for (const k of kinds) if (k) count.set(k, (count.get(k) ?? 0) + 1)
      for (const v of car.variants) {
        const pal = v.looks[0], hue = (k) => { const c = (k >> 8) & 255; return c >= 16 ? Math.floor((c - 16) / 10) : -1 }
        let left = 0
        first.palette.forEach((k, j) => { const to = pal[j]; if (to && (to & 15) !== GLASS && (to & 15) !== 15 && [23, 0, 1].includes(hue(to))) left += count.get(k) ?? 0 })
        check(left === 0, `the coupe in ${v.name}: ${left} cells still red (0.00%)`)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

if (failures.length) { console.log(`\n${failures.length} failed:\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('\nsculpt-cars: ok')
