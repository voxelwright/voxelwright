// A ghost keeps up with its person (#264, the bodies lane): no page, no server, under a second.
// Someone at a page says where they are ten times a second. A ghost put only where they were last said to be is up
// to 45 cm behind a runner, and a shot that would have hit them passes behind. `rules/blows.mjs` carries each ghost
// on between tellings as its person was going; this measures how far the ghost is from where the person really is,
// with a core that only writes down where it is told to put things.
//
//   node test/ghost.mjs
import { blows } from '../rules/blows.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
/** Runs someone along a way for some seconds, told of ten times a second (a little unevenly), the ghost looked at sixty times a second. Returns the furthest the ghost was from them, carried on and not. */
function run(where, seconds) {
  let put = null
  const core = { living_ghost: () => 7, living_place: (id, x, y, z) => { put = [x, y - 8.5, z] }, living_vanish: () => {} }
  const folk = new Map(), p = { by: 'runner', name: 'Runner', at: where(0), yaw: 0, seat: false }
  folk.set(p.by, p)
  const blow = blows({ core, folk, tell: () => {}, post: () => {}, told: () => {}, happen: () => {}, hear: () => {}, thing: () => undefined })
  let carried = 0, left = 0, told = where(0), next = 0
  for (let ms = 0; ms < seconds * 1000; ms += 1000 / 60) {
    if (ms >= next) { p.at = where(ms / 1000); told = p.at; blow.seen(p, ms); next = ms + 90 + ((ms * 7) % 20) }
    blow.track(ms)
    const truth = where(ms / 1000), far = (a) => Math.hypot(a[0] - truth[0], a[1] - truth[1], a[2] - truth[2])
    if (ms > 500) { carried = Math.max(carried, far(put)); left = Math.max(left, far(told)) }
  }
  return { carried, left }
}
// A run along the street at 4.5 m/s; round a ring 6 m across at the same pace; standing; and gone from one place to another at once.
const straight = run((t) => [700 + 45 * t, 157, 4083], 6)
check(straight.left > 3.5 && straight.carried < 0.6, `a runner at 4.5 m/s: a ghost left where they were last said to be is up to ${(straight.left * 10).toFixed(0)} cm behind; carried on, ${(straight.carried * 10).toFixed(0)} cm`)
const ring = run((t) => [700 + 30 * Math.cos(1.5 * t), 157, 4083 + 30 * Math.sin(1.5 * t)], 6)
check(ring.carried < ring.left * 0.5 && ring.carried < 2, `running a ring six metres across: ${(ring.left * 10).toFixed(0)} cm behind left, ${(ring.carried * 10).toFixed(0)} cm carried on`)
const stood = run(() => [700, 157, 4083], 3)
check(stood.carried === 0, 'someone standing: the ghost stands where they are')
const leapt = run((t) => (t < 2 ? [700, 157, 4083] : [1700, 157, 4083]), 4)
check(leapt.carried <= 1000.01, `put somewhere else at once (a hundred metres off), the ghost is not thrown past them (${leapt.carried.toFixed(0)} cells at most, the leap itself)`)
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('ghost: ok')
