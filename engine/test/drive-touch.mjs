// Touch driving schemes (#140), the parts that need no page: what is kept is read back in range, tilt read from the
// phone's angles for poses a hand makes, the wheel, and every scheme's layout on a phone on its side and upright.
//
//   node test/drive-touch.mjs
import { DEFAULTS, GASES, STEERS, TILT_LOCK, WHEEL_LOCK, layout, parseSettings, swept, tiltOf, tiltSteer, upOfPhone, upOnScreen, wheelSteer, wheelTurn } from '../page/drive-touch.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const deg = (r) => r * 180 / Math.PI
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps

// What is kept: anything wrong is the default, anything out of range is brought in.
check(JSON.stringify(parseSettings(null)) === JSON.stringify(DEFAULTS), 'nothing kept is the default scheme')
check(JSON.stringify(parseSettings('{bad')) === JSON.stringify(DEFAULTS), 'a kept string that is not a record is the default')
const odd = parseSettings({ steer: 'joystick', gas: 'nitro', hand: 'both', size: 9, opacity: -1, sens: 'fast', tiltZero: 3 })
check(odd.steer === 'arrows' && odd.gas === 'pedals' && odd.hand === 'right' && odd.size === 1.25 && odd.opacity === 0.3 && odd.sens === 1 && odd.tiltZero === 0.6,
  `unknown or out-of-range fields come back in range (${JSON.stringify(odd)})`)
check(parseSettings({ steer: 'tilt', gas: 'auto', hand: 'left' }).steer === 'tilt' && parseSettings({ steer: 'tilt', gas: 'auto', hand: 'left' }).hand === 'left', 'a good record is read as it is')
check(DEFAULTS.steer === 'arrows' && DEFAULTS.gas === 'pedals' && DEFAULTS.hand === 'right', 'the default is arrows under the left thumb and pedals under the right')

// Tilt, from poses: the angles a phone reports held in a hand, and what the screen shows the player.
// (The phone's frame: x its right edge, y its top, z out of the screen. beta lifts the top edge; on its side the
// screen is turned 90 with the phone's top to the left, 270 with it to the right.)
const pose = (beta, gamma, angle) => { const t = tiltOf(beta, gamma, angle); return { turn: deg(t.turn), upright: t.upright } }
const cases = [
  ['on its side (top left), held up, level', 0, -90, 90, 0, 1],
  ['on its side (top left), turned 20 degrees clockwise', 20, -90, 90, 20, 1],
  ['on its side (top left), turned 20 degrees anticlockwise', -20, -90, 90, -20, 1],
  ['the same pose as another set of angles a browser may give near gamma 90', 160, 90, 90, 20, 1],
  ['on its side (top left), leaned back 45 degrees, level', 0, -45, 90, 0, Math.SQRT1_2],
  ['on its side (top right), held up, level', 0, 90, 270, 0, 1],
  ['on its side (top right), turned 20 degrees clockwise', -20, 90, 270, 20, 1],
  ['upright, held up, level', 90, 0, 0, 0, 1],
  ['upright, turned 20 degrees clockwise', 70, 90, 0, 20, 1],
]
for (const [what, b, g, a, turn, upright] of cases) {
  const p = pose(b, g, a)
  check(near(p.turn, turn, 0.5) && near(p.upright, upright, 0.02), `${what}: turn ${p.turn.toFixed(1)} (want ${turn}), upright ${p.upright.toFixed(2)}`)
}
const flat = pose(2, 1, 90)
check(flat.upright < 0.1, `lying flat it is not upright (${flat.upright.toFixed(2)}): its turn means nothing, and the steering lets go`)
const up = upOfPhone(37, -61), [sx, sy] = upOnScreen(up, 90), [px, py] = upOnScreen(up, 0)
check(near(Math.hypot(...up), 1, 1e-9) && near(Math.hypot(sx, sy), Math.hypot(px, py), 1e-9), 'up is a unit vector, and turning the screen keeps its length')

// Tilt to steering.
const r = (d) => d * Math.PI / 180
check(tiltSteer(0, 0, 1) === 0 && tiltSteer(r(1), 0, 1) === 0, 'level, and within a degree and a half of it, is straight ahead')
check(near(tiltSteer(r(TILT_LOCK), 0, 1), 1, 1e-6) && near(tiltSteer(r(-TILT_LOCK - 10), 0, 1), -1, 1e-6), `${TILT_LOCK} degrees is full lock, and past it stays there`)
const half = tiltSteer(r(TILT_LOCK / 2), 0, 1)
check(half > 0.3 && half < 0.5, `half the tilt is less than half the lock (${half.toFixed(2)}): fine near the middle`)
check(near(tiltSteer(r(TILT_LOCK / 2), 0, 2), 1, 1e-6), 'at sensitivity 2, half the tilt is full lock')
check(tiltSteer(r(10), r(10), 1) === 0 && tiltSteer(r(10 + TILT_LOCK), r(10), 1) > 0.99, 'the tilt that is straight ahead (Center tilt) is measured from')
check(Math.abs(tiltSteer(r(179), r(-179), 1)) < 0.05, 'across the half turn it is measured the short way round (two degrees, not 358)')

// The wheel.
check(near(swept(r(170), r(-170)), 20, 1e-6) && near(swept(r(-170), r(170)), -20, 1e-6), 'the thumb going round past the bottom of the wheel is a small turn, not a whole one')
check(wheelTurn(100, 50, 1) === WHEEL_LOCK && wheelTurn(-100, -50, 1) === -WHEEL_LOCK, `the wheel stops at its lock (${WHEEL_LOCK} degrees)`)
check(wheelSteer(WHEEL_LOCK / 2, 1) === 0.5 && wheelSteer(1, 1) === 0 && near(wheelSteer(WHEEL_LOCK / 2, 2), 1, 1e-9), 'half a turn is half lock, a degree is nothing, and sensitivity shortens the lock')

// Every scheme's keys on a phone on its side (844 x 390, 59 px safe at each side, 21 at the bottom) and upright
// (390 x 844, 34 at the bottom), and on a small phone (667 x 375, as an iPhone SE): 44 px a side or more, on the screen
// within its safe area, none on another, the two thumbs' keys apart, the driving thumb's in the lower half (sf-hud's
// gate; Large may reach to 58%), each on its own thumb's side, and the keys each scheme needs.
const screens = { side: { w: 844, h: 390, safe: { left: 59, right: 59, bottom: 21 } }, 'small side': { w: 667, h: 375, safe: { left: 0, right: 0, bottom: 0 } }, upright: { w: 390, h: 844, safe: { left: 0, right: 0, bottom: 34 } }, 'small upright': { w: 375, h: 667, safe: { left: 0, right: 0, bottom: 0 } } }
let laid = 0, bad = 0
for (const [name, s] of Object.entries(screens)) {
  for (const steer of STEERS) for (const gas of GASES) for (const hand of ['right', 'left']) for (const size of [0.85, 1, 1.2]) for (const ask of [false, true]) {
    if (ask && steer !== 'arrows') continue
    const set = { ...DEFAULTS, steer, gas, hand, size }
    const keys = layout(set, steer, { width: s.w, height: s.h, portrait: name.endsWith('upright') }, ask)
    const rect = (k) => { const left = k.side === 'left' ? s.safe.left + 14 + k.x : s.w - s.safe.right - 14 - k.x - k.w, bottom = s.h - s.safe.bottom - 14 - k.y; return { act: k.act, side: k.side, left, right: left + k.w, top: bottom - k.h, bottom } }
    const rs = keys.map(rect), tag = `${name} ${steer}+${gas} ${hand}-handed ${size}${ask ? ' asking for tilt' : ''}`
    const small = rs.filter((k) => k.right - k.left < 44 || k.bottom - k.top < 44)
    const out = rs.filter((k) => k.left < s.safe.left || k.right > s.w - s.safe.right || k.top < s.h * 0.3 || k.bottom > s.h - s.safe.bottom)
    const meet = []
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) meet.push(`${a.act}/${b.act}`) }
    const L = rs.filter((k) => k.side === 'left'), R = rs.filter((k) => k.side === 'right')
    const apart = !L.length || !R.length ? Infinity : Math.min(...R.map((k) => k.left)) - Math.max(...L.map((k) => k.right))
    const acts = new Set(rs.map((k) => k.act)), drive = hand, steerSide = hand === 'right' ? 'left' : 'right'
    const need = ['brake', 'drift', 'boost', ...(gas === 'pedals' ? ['gas'] : []), ...(steer === 'arrows' ? ['left', 'right'] : []), ...(steer === 'wheel' ? ['wheel'] : [])]
    const sides = rs.every((k) => ['left', 'right', 'wheel', 'tilt-on'].includes(k.act) || (k.act === 'brake' && steer === 'tilt' && gas === 'pedals') ? k.side === steerSide : k.side === drive)
    const high = rs.filter((k) => k.side === drive).filter((k) => k.top <= s.h * (size > 1 ? 0.42 : 0.5))
    const ok = !high.length && !small.length && !out.length && !meet.length && apart >= 24 && need.every((a) => acts.has(a)) && sides && (gas === 'auto') === !acts.has('gas')
    if (!ok) bad++
    if (!ok) check(false, `${tag}: ${JSON.stringify({ high: high.map((k) => k.act), small: small.map((k) => k.act), out: out.map((k) => k.act), meet, apart, missing: need.filter((a) => !acts.has(a)), sides })}`)
    laid++
  }
}
check(bad === 0, `${laid} layouts (4 steerings, 2 gases, 2 hands, 3 sizes, 4 screens, and tilt waiting): keys 44 px or more, in the safe area, none on another, the two thumbs 24 px or more apart, the driving thumb's in the lower half`)

// Each size is its own size on every screen (on a phone on its side the height once made Large the same as Medium).
const gasOf = (size, sc) => layout({ ...DEFAULTS, size }, 'arrows', { width: sc.w, height: sc.h, portrait: sc.h > sc.w }).find((k) => k.act === 'gas').h
const grows = Object.entries(screens).map(([name, sc]) => [name, gasOf(0.85, sc), gasOf(1, sc), gasOf(1.2, sc)])
check(grows.every(([, a, b, c]) => a < b && b < c), `Small, Medium and Large Gas pedals grow on every screen (${grows.map(([n, a, b, c]) => `${n} ${a}/${b}/${c}`).join(', ')})`)

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('drive-touch: ok')
