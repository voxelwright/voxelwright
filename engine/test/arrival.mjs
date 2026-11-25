// Where someone who joins a server stands (#526, page/arrival.ts), with no browser: a host's place read as a
// stranger's data, and the places found on a ground made up here. It fails unless:
//   - a place that is not {at: [x, z] or [x, y, z] of finite numbers in reach, yaw} is no place (NaN, Infinity, 1e308,
//     strings, arrays, four numbers), and the height a host gives is never taken;
//   - a host's place under the ground, kilometres up, inside a building, in the sea or past the release's edge never
//     puts anyone there: they stand on top of what is there, or round the realm's own place;
//   - eight people let in together (door numbers 0 to 7) stand in eight places at least 3 m apart, none within 2.5 m of
//     anyone already standing;
//   - nobody is turned to a wall a metre off: the facing turns until 20 m ahead is clear.
//
//   node test/arrival.mjs
import { LANES, said, stand } from '../page/arrival.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

// The ground: level at 100 cells, the release holds |x|, |z| < 2000; a block 20 m high at x 200 to 400, z -100 to 100;
// the sea west of x -600; a wall 2 m high at z -40, x -40 to 40 (in front of whoever looks north from the middle).
const within = (x, z) => Math.abs(x) < 2000 && Math.abs(z) < 2000
const block = (x, z) => x >= 200 && x < 400 && z >= -100 && z < 100
const kind = (x, y, z) => {
  if (!within(x, z)) return 0
  if (x < -600) return y < 100 ? 5 : 0
  if (block(x, z)) return y < 300 ? 8 : 0
  if (z >= -45 && z < -40 && x >= -40 && x < 40 && y < 120) return 8
  return y < 100 ? 7 : 0
}
const feet = (x, z) => (block(x, z) ? 300 : z >= -45 && z < -40 && x >= -40 && x < 40 ? 120 : 100)
const ground = { within, feet, kind }
const own = { x: -300, z: 600, yaw: 0 }
const at = (r) => (r ? `${r.at.join(', ')} facing ${r.yaw.toFixed(2)} (${r.round}'s)` : 'nowhere')

// ── A host's place, read ──
const bad = [null, 'x', 7, [], [1, 2], { at: 'x' }, { at: [NaN, 0] }, { at: [Infinity, 0, 0] }, { at: [1e308, 0, 0] }, { at: [1, 2, 3, 4] }, { at: [1] }, { at: ['1', 2] }, { at: [1, 2], yaw: '1' }, { at: [1, 2], yaw: NaN }, { at: [1, 2], yaw: 1e300 }]
const refused = bad.filter((a) => said(a) === null).length
check(refused === bad.length, `a place that is not finite numbers in reach is no place (${refused} of ${bad.length} refused)`)
const read = said({ at: [10.4, 99999, -20.6], yaw: Math.PI * 3, pitch: 9 })
check(read && read.x === 10 && read.z === -21 && Math.abs(Math.abs(read.yaw) - Math.PI) < 1e-9 && !('y' in read) && !('pitch' in read), `a good one is its column and facing, without its height or pitch (${JSON.stringify(read)})`)

// ── Where a host's place puts someone ──
const host = (a) => stand({ host: said(a), own, spot: 0, ground, others: [] })
const under = host({ at: [0, -5000, 300], yaw: 0 }), up = host({ at: [0, 50000, 300], yaw: 0 })
check(under?.round === 'host' && under.at[1] === 100 && up?.round === 'host' && up.at[1] === 100, `a host's place under the ground or kilometres up stands them on the ground there (${at(under)}; ${at(up)})`)
const inBlock = host({ at: [300, 200, 0], yaw: Math.PI / 2 })
check(inBlock !== null && !(block(inBlock.at[0], inBlock.at[2]) && inBlock.at[1] < 300) && kind(inBlock.at[0], inBlock.at[1] + 5, inBlock.at[2]) === 0, `inside a building: on its roof or beside it, never in it (${at(inBlock)})`)
const sea = host({ at: [-900, 0, 0], yaw: 0 }), off = host({ at: [9000, 0, 0], yaw: 0 })
check(sea?.round === 'own' && off?.round === 'own', `in the sea or past the release's edge: round the realm's own place instead (${at(sea)}; ${at(off)})`)
const none = stand({ host: null, own, spot: 0, ground, others: [] })
check(none?.round === 'own' && Math.hypot(none.at[0] - own.x, none.at[2] - own.z) < 1, `a host that names no place: the realm's own (${at(none)})`)

// ── Together ──
const eight = [...Array(LANES).keys()].map((spot) => stand({ host: null, own, spot, ground, others: [] }))
let closest = Infinity
for (let i = 0; i < eight.length; i++) for (let j = i + 1; j < eight.length; j++) closest = Math.min(closest, Math.hypot(eight[i].at[0] - eight[j].at[0], eight[i].at[2] - eight[j].at[2]) / 10)
check(eight.every(Boolean) && closest >= 3, `${LANES} let in together, seeing nobody yet, stand ${closest.toFixed(1)} m apart at the closest`)
const there = [[own.x, 116, own.z], [own.x + 30, 116, own.z + 30]]
const third = stand({ host: null, own, spot: 0, ground, others: there })
check(!!third && there.every((p) => Math.hypot(p[0] - third.at[0], p[2] - third.at[2]) >= 25), `someone standing in the first places: the next stands clear of them (${at(third)})`)
const second = eight[1], first = eight[0]
const bearing = Math.atan2(first.at[0] - second.at[0], -(first.at[2] - second.at[2])) - second.yaw
check(Math.abs(Math.atan2(Math.sin(bearing), Math.cos(bearing))) < 0.9, `the second has the first in sight, ${((bearing * 180) / Math.PI).toFixed(0)} degrees off where they look`)

// ── Facing ──
const walled = host({ at: [0, 100, 0], yaw: 0 })
check(walled?.round === 'host' && Math.abs(walled.yaw) > 0.1, `a wall a few metres ahead: turned away from it (${at(walled)})`)
check([under, up, inBlock, sea, off, none, third, walled, ...eight].every((r) => r && r.pitch <= 0.05 && r.pitch >= -0.45), 'each looks a little down, at the ground ahead')

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
