// Offline DSP verification for Lane 2 combat, lightsaber, ballistics, and tennis foley (#166).
// Renders every patch and controller flow directly through Voxelwright's actual `dsp.ts` Synth
// (zero mocks!) and checks strict patch compliance, non-silence, CEILING headroom, and acoustic
// spectral/envelope behavior.
//
//   node engine/test/sound-combat.mjs
import { BUS, CEILING, SET, Synth } from '../page/sound/dsp.ts'
import { compile, patch, toned } from '../page/sound/patch.ts'
import { COMBAT_PATCHES, combatSound } from '../page/sound/combat.ts'
import * as ears from './ears.mjs'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const REQUIRED_PATCHES = [
  'parryClash',
  'bluntHit',
  'bladeStab',
  'saberIgnite',
  'saberHum',
  'saberClash',
  'bulletCrack',
  'ricochet',
  'shockwaveBoom',
  'laserSizzle',
  'tennisPop',
  'tennisBounce',
]

/** Renders a single Patch directly through `dsp.ts` Synth with room off. */
function renderPatch(p, { sr = 48000, secs = 1.6, force = 0.85, size = 1, dur = 0, pitch = 0 } = {}) {
  const s = new Synth(sr)
  s.define(1, compile(p))
  s.set(SET.roomGain, 0)
  const holdDur = dur || (toned(p) || p.how === 'rubbed' ? 0.55 : 0)
  s.notes([0, 1, pitch, size, force, holdDur, 0.72, 0.72, 0, 0, BUS.world, 0])
  const l = new Float32Array(Math.round(sr * secs))
  const r = new Float32Array(l.length)
  s.render(l, r)
  return { l, r, sr, s }
}

/** Real offline `CombatVoice` backed directly by `dsp.ts` Synth (matches `sound.ts` math, zero mocks). */
function synthVoice(sr = 48000) {
  const synth = new Synth(sr)
  synth.set(SET.roomGain, 0)
  const ids = new Map()
  let nextPatch = 0
  let nextHeld = 1

  const idOf = (p) => {
    let id = ids.get(p)
    if (id === undefined) {
      id = ++nextPatch
      ids.set(p, id)
      synth.define(id, compile(p))
    }
    return id
  }

  const hear = (at, reach = 4) => {
    const dx = at[0] / 10, dy = at[1] / 10, dz = at[2] / 10
    const far = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz) || 1
    const most = reach * 60
    const gain = far >= most ? 0 : (reach / (reach + far)) * Math.min(1, (most - far) / (most * 0.2))
    const pan = (dx / flat) * Math.min(1, far / 1.5) * 0.9
    const lp = 400 + 19600 * Math.exp(-far / 90)
    return { gain, pan, lp, late: far / 343, far }
  }

  const play = (p, how = {}, name = 0) => {
    let gain = how.gain ?? 1, pan = how.pan ?? 0, lp = 0, late = 0, send = how.room ?? 0
    if (how.at) {
      const h = hear(how.at, how.reach)
      if (h.gain < 0.002) return false
      gain = h.gain; pan = h.pan; lp = h.lp; late = how.travels === false ? 0 : h.late
      send = Math.min(0.5, 0.08 + h.far / 120)
    }
    const when = synth.frame + Math.round(((how.after ?? 0) + late) * sr)
    const gl = gain * Math.sqrt(0.5 * (1 - pan)) * 1.25
    const gr = gain * Math.sqrt(0.5 * (1 + pan)) * 1.25
    synth.notes([when, idOf(p), how.pitch ?? 0, how.size ?? 1, how.force ?? 0.7, how.dur ?? 0, gl, gr, lp, send, how.bus ?? BUS.world, name])
    return true
  }

  const voice = {
    context: { get currentTime() { return synth.frame / sr } },
    play,
    hold(p, how = {}) {
      const name = ++nextHeld + 1
      return play(p, { bus: BUS.play, ...how }, name) ? name : 0
    },
    release(id) { if (id) synth.release(id) },
    glide(id, hz, level = -1) { if (id) synth.glide(id, hz, level) },
    place(id, at, reach, level = -1) {
      const h = hear(at, reach)
      if (id) synth.place(id, h.gain * Math.sqrt(0.5 * (1 - h.pan)) * 1.25, h.gain * Math.sqrt(0.5 * (1 + h.pan)) * 1.25, h.lp, Math.min(0.5, 0.08 + h.far / 120), level)
      return h.gain
    },
  }

  const render = (secs) => {
    const n = Math.round(sr * secs)
    const l = new Float32Array(n), r = new Float32Array(n)
    synth.render(l, r)
    return { l, r }
  }

  return { synth, voice, render, sr }
}

const finiteStats = (l, r) => {
  let maxPeak = 0, bad = 0
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = r[i]
    if (!Number.isFinite(a) || !Number.isFinite(b)) bad++
    const m = Math.max(Math.abs(a), Math.abs(b))
    if (m > maxPeak) maxPeak = m
  }
  return { peak: maxPeak, rms: ears.rms(l), bad }
}

console.log('1. Patch schema validation')
{
  const names = Object.keys(COMBAT_PATCHES)
  check(REQUIRED_PATCHES.every((k) => Object.hasOwn(COMBAT_PATCHES, k)), `all ${REQUIRED_PATCHES.length} required combat patch names are exported`)
  const bad = []
  for (const name of names) {
    const res = patch(JSON.parse(JSON.stringify(COMBAT_PATCHES[name])))
    if ('refused' in res) bad.push(`${name}: ${res.refused}`)
  }
  check(bad.length === 0, `every patch in COMBAT_PATCHES (${names.length}) passes strict patch() JSON validation${bad.length ? ` (${bad.join('; ')})` : ''}`)
}

console.log('2. Per-patch offline DSP render (non-silent, <= CEILING, zero NaN/Inf)')
const metrics = {}
{
  let maxOverall = 0
  for (const [name, p] of Object.entries(COMBAT_PATCHES)) {
    const out = renderPatch(p, { sr: 48000, secs: 1.5, force: 0.88 })
    const st = finiteStats(out.l, out.r)
    const cent = ears.centroid(out.l, out.sr, 128, 8192)
    const activeRms = ears.rms(out.l, 0, Math.round(0.45 * out.sr))
    metrics[name] = { peak: st.peak, rms: activeRms, centroid: cent, decay: ears.decay(out.l, out.sr, 40) }
    maxOverall = Math.max(maxOverall, st.peak)
    check(
      st.bad === 0 && out.s.stats.reset === 0 && st.peak <= CEILING + 1e-6 && activeRms > 0.005,
      `${name.padEnd(18)} peak=${st.peak.toFixed(3)} (${ears.db(st.peak).toFixed(1)} dB) rms=${activeRms.toFixed(4)} centroid=${cent.toFixed(0)} Hz`,
    )
  }
  // Also verify 44.1 kHz parity on a core subset.
  let bad441 = 0, peak441 = 0
  for (const name of REQUIRED_PATCHES) {
    const out = renderPatch(COMBAT_PATCHES[name], { sr: 44100, secs: 1.0, force: 0.9 })
    const st = finiteStats(out.l, out.r)
    if (st.bad > 0 || out.s.stats.reset > 0 || st.rms <= 0.004) bad441++
    peak441 = Math.max(peak441, st.peak)
  }
  check(bad441 === 0 && peak441 <= CEILING + 1e-6, `all ${REQUIRED_PATCHES.length} core patches render cleanly at 44.1 kHz (max peak ${peak441.toFixed(3)} <= ${CEILING})`)
  check(maxOverall <= CEILING + 1e-6, `overall single-patch ceiling holds (max peak ${maxOverall.toFixed(3)} <= ${CEILING})`)
}

console.log('3. Spectral & envelope sanity')
{
  // Melee parryClash vs bluntHit / shockwaveBoom
  check(
    metrics.parryClash.centroid > metrics.bluntHit.centroid * 3 && metrics.parryClash.centroid > metrics.shockwaveBoom.centroid * 3,
    `parryClash is far brighter than bluntHit and shockwaveBoom (${metrics.parryClash.centroid.toFixed(0)} Hz vs blunt ${metrics.bluntHit.centroid.toFixed(0)} Hz, boom ${metrics.shockwaveBoom.centroid.toFixed(0)} Hz)`,
  )
  check(
    metrics.parryClash.decay > metrics.bluntHit.decay * 2,
    `parryClash rings longer than damped bluntHit (${metrics.parryClash.decay.toFixed(2)} s vs ${metrics.bluntHit.decay.toFixed(2)} s to -40 dB)`,
  )

  // Ricochet downward pitch chirp
  const rico = renderPatch(COMBAT_PATCHES.ricochet, { sr: 48000, secs: 0.8, force: 0.9 })
  const ricoEarly = ears.centroid(rico.l, 48000, 128, 2048)
  const ricoLate = ears.centroid(rico.l, 48000, 8192, 4096)
  check(
    ricoEarly > ricoLate * 1.4,
    `ricochet chirps sharply downward (${ricoEarly.toFixed(0)} Hz early -> ${ricoLate.toFixed(0)} Hz late)`,
  )

  // Open vs occluded shockwaveBoom via controller
  const openH = synthVoice(48000)
  const openC = combatSound(openH.voice, { jitter: false })
  openC.shockwaveBoom({ force: 0.95, radius: 14, occluded: false })
  const openBuf = openH.render(1.5)
  const openCent = ears.centroid(openBuf.l, 48000, 128, 8192)
  const openSt = finiteStats(openBuf.l, openBuf.r)

  const occH = synthVoice(48000)
  const occC = combatSound(occH.voice, { jitter: false })
  occC.shockwaveBoom({ force: 0.95, radius: 14, occluded: true })
  const occBuf = occH.render(1.5)
  const occCent = ears.centroid(occBuf.l, 48000, 128, 8192)
  const occSt = finiteStats(occBuf.l, occBuf.r)

  check(
    openCent > occCent * 2.2 && openSt.peak <= CEILING + 1e-6 && occSt.peak <= CEILING + 1e-6 && occSt.rms > 0.01,
    `shockwaveBoom is crisp when open (${openCent.toFixed(0)} Hz) and low-pass muffled when occluded (${occCent.toFixed(0)} Hz)`,
  )

  // Lightsaber ignition, idle hum, velocity-driven Doppler swing modulation, clash crackle, retraction
  const sh = synthVoice(48000)
  const sc = combatSound(sh.voice, { jitter: false })
  const ignited = sc.saberIgnite({ force: 0.88 })
  const segIgnite = sh.render(0.5)
  sc.saberUpdate(0, 0, false)
  const segIdle = sh.render(0.6)
  sc.saberUpdate(12, 9, false)
  const segSwing = sh.render(0.6)
  sc.updateSaber(7, 5, true)
  const segClash = sh.render(0.45)
  sc.saberRetract({ force: 0.85 })
  const segRetract = sh.render(0.9)

  const idlePeakHz = ears.peaks(segIdle.l, 48000, { from: 4096, size: 16384, most: 1 })[0]?.hz ?? 0
  const swingPeakHz = ears.peaks(segSwing.l, 48000, { from: 4096, size: 16384, most: 1 })[0]?.hz ?? 0
  const idleCent = ears.centroid(segIdle.l, 48000, 4096, 16384)
  const swingCent = ears.centroid(segSwing.l, 48000, 4096, 16384)
  const clashHi = ears.band(segClash.l, 48000, 2000, 14000)
  const idleHi = ears.band(segIdle.l, 48000, 2000, 14000)
  const afterRetractRms = ears.rms(segRetract.l, Math.round(0.6 * 48000), segRetract.l.length)
  const saberMax = Math.max(
    finiteStats(segIgnite.l, segIgnite.r).peak,
    finiteStats(segIdle.l, segIdle.r).peak,
    finiteStats(segSwing.l, segSwing.r).peak,
    finiteStats(segClash.l, segClash.r).peak,
    finiteStats(segRetract.l, segRetract.r).peak,
  )

  check(ignited && !sc.saberActive, 'saberIgnite activates dual-oscillator hum and saberRetract releases it')
  check(
    swingPeakHz > idlePeakHz * 1.25 && swingCent > idleCent * 1.25,
    `saberUpdate modulates Doppler pitch (${idlePeakHz.toFixed(1)} -> ${swingPeakHz.toFixed(1)} Hz) and brightness (${idleCent.toFixed(0)} -> ${swingCent.toFixed(0)} Hz)`,
  )
  check(
    clashHi > idleHi * 2 && saberMax <= CEILING + 1e-6 && sh.synth.stats.reset === 0,
    `saber clash adds high-voltage crackle (${(clashHi * 100).toFixed(1)}% > 2 kHz vs idle ${(idleHi * 100).toFixed(1)}%), peak ${saberMax.toFixed(3)} <= ${CEILING}`,
  )
  check(
    afterRetractRms < ears.rms(segIdle.l) * 0.05,
    `saberRetract silences the plasma hum after collapse (${ears.db(afterRetractRms).toFixed(1)} dB tail)`,
  )

  // Tennis sweet-spot vs rim/frame hit
  const sweetH = synthVoice(48000)
  combatSound(sweetH.voice, { jitter: false }).tennisPop({ velocity: 0.9, sweetSpot: 1.0 })
  const sweetBuf = sweetH.render(0.6)
  const sweetCent = ears.centroid(sweetBuf.l, 48000, 128, 8192)
  const sweetPeak = ears.peaks(sweetBuf.l, 48000, { from: 128, size: 8192, most: 1 })[0]?.hz ?? 0

  const rimH = synthVoice(48000)
  combatSound(rimH.voice, { jitter: false }).tennisPop({ velocity: 0.9, sweetSpot: 0.0 })
  const rimBuf = rimH.render(0.6)
  const rimCent = ears.centroid(rimBuf.l, 48000, 128, 8192)
  const rimPeak = ears.peaks(rimBuf.l, 48000, { from: 128, size: 8192, most: 1 })[0]?.hz ?? 0

  check(
    sweetCent > rimCent * 1.6 && sweetPeak > rimPeak * 1.5,
    `tennisPop sweet-spot (${sweetCent.toFixed(0)} Hz centroid, ${sweetPeak.toFixed(0)} Hz peak) vs rim-hit (${rimCent.toFixed(0)} Hz centroid, ${rimPeak.toFixed(0)} Hz peak) are distinct`,
  )

  // Tennis court surface pitch ordering (Hard > Clay > Grass) + net snap
  const bouncePeak = {}
  for (const surface of ['hard', 'clay', 'grass']) {
    const bh = synthVoice(48000)
    combatSound(bh.voice, { jitter: false }).tennisBounce({ surface, velocity: 0.85 })
    const bb = bh.render(0.5)
    bouncePeak[surface] = ears.peaks(bb.l, 48000, { from: 128, size: 8192, most: 1 })[0]?.hz ?? 0
  }
  check(
    bouncePeak.hard > bouncePeak.clay && bouncePeak.clay > bouncePeak.grass,
    `tennisBounce pitches by surface: hard ${bouncePeak.hard.toFixed(0)} Hz > clay ${bouncePeak.clay.toFixed(0)} Hz > grass ${bouncePeak.grass.toFixed(0)} Hz`,
  )

  // Continuous thermal laser start & stop
  const lh = synthVoice(48000)
  const lc = combatSound(lh.voice, { jitter: false })
  lc.laserSizzle({ active: true, force: 0.85, heat: 0.7 })
  const laserOn = lh.render(0.45)
  lc.laserSizzle({ active: false })
  const laserOff = lh.render(0.75)
  const laserTail = ears.rms(laserOff.l, Math.round(0.45 * 48000), laserOff.l.length)
  check(
    ears.rms(laserOn.l) > 0.02 && laserTail < ears.rms(laserOn.l) * 0.05 && !lc.laserActive,
    `continuous laserSizzle sustains while active (rms ${ears.rms(laserOn.l).toFixed(4)}) and stops cleanly when released`,
  )
}

console.log('4. Full-intensity polyphonic combat ceiling stress test')
{
  for (const sr of [44100, 48000]) {
    const h = synthVoice(sr)
    const c = combatSound(h.voice, { jitter: false })
    c.saberIgnite({ force: 1 })
    c.laserSizzle({ active: true, force: 1, heat: 1 })
    c.parryClash({ impulse: 1 })
    c.bluntHit({ force: 1, material: 'wood' })
    c.bladeStab({ force: 1, dur: 0.4 })
    c.bladeScrape({ force: 1, dur: 0.4, speed: 2.5 })
    c.saberClash({ impulse: 1 })
    c.bulletCrack({ speed: 1200, force: 1 })
    c.ricochet({ force: 1 })
    c.shockwaveBoom({ force: 1, radius: 28, occluded: false })
    c.tennisPop({ velocity: 1, sweetSpot: 1 })
    c.tennisBounce({ surface: 'hard', velocity: 1 })
    c.tennisNet({ velocity: 1 })
    const seg1 = h.render(0.4)
    c.saberUpdate(18, 14, true)
    const seg2 = h.render(0.6)
    c.stopAll()
    const seg3 = h.render(0.4)
    const s1 = finiteStats(seg1.l, seg1.r), s2 = finiteStats(seg2.l, seg2.r), s3 = finiteStats(seg3.l, seg3.r)
    const maxP = Math.max(s1.peak, s2.peak, s3.peak)
    const bad = s1.bad + s2.bad + s3.bad
    check(
      bad === 0 && h.synth.stats.reset === 0 && maxP <= CEILING + 1e-6,
      `all combat systems fired at once at ${sr} Hz stay within CEILING (peak ${maxP.toFixed(3)} <= ${CEILING}, resets ${h.synth.stats.reset})`,
    )
  }
}

if (failures.length) {
  console.error(`FAILED\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('sound-combat: ok')
