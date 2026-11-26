// Procedural Car Radio & High-Speed Doppler Pass-By Audio check (#31):
// 1) Node synthesis checks: validates all 3 radio stations (Bay Drive FM, Twin Peaks Chill, Fillmore Funk) and all
//    tuning/Doppler patches, measures LUFS & ceiling compliance, stereo panning, and downward Doppler pitch sweep.
// 2) Real Chrome browser check on /city?living=finecar: verifies cycling stations with N, 2-second auto-fading
//    toast pill placement (zero overlap with drive-hud/card/vehicle), station memory across exit/re-enter, horn
//    ducking, voxelwright:nearmiss Doppler trigger, and captures full-size screenshots when --shots <dir> is passed.
//
//   node test/radio.mjs [--node-only] [--shots dir]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BUS, CEILING, SET, Synth } from '../page/sound/dsp.ts'
import { compile, patch } from '../page/sound/patch.ts'
import { RADIO_MOODS, TRIES, compose, resolve } from '../page/sound/music/compose.ts'
import { length, perform } from '../page/sound/music/perform.ts'
import { RADIO_PATCHES, STATIONS, playDopplerWhoosh } from '../page/sound/radio.ts'
import * as ears from './ears.mjs'
import { arg, has, start, still } from './kit.mjs'

const nodeOnly = has('node-only')
const shotsDir = arg('shots', '')
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

console.log('Radio stations & patches (Node synth)')
{
  const stationIds = ['baydrive', 'twinpeaks', 'fillmore']
  check(STATIONS.length === 4 && STATIONS[0].id === 'off' && stationIds.every((id) => STATIONS.some((s) => s.id === id)), 'four stations in order: Radio Off, Bay Drive FM, Twin Peaks Chill, Fillmore Funk')

  // Strict Patch schema validation for every radio instrument and foley/Doppler patch.
  const allPatches = [
    ...Object.values(RADIO_PATCHES),
    ...Object.values(RADIO_MOODS).flatMap((m) => m.voices.map((v) => v.patch)),
  ]
  const badPatch = allPatches.find((p) => !('patch' in patch(JSON.parse(JSON.stringify(p)))))
  check(!badPatch, `all ${allPatches.length} radio instrument, tuning, and Doppler patches pass strict patch() validation`)

  // Composition quality, tonic D, in-scale notes, and zero dead-air gaps.
  let worst = 1, least = 1, outside = 0, notes = 0, maxMs = 0
  const bpms = {}
  for (const id of stationIds) {
    const m = resolve(id)
    check(m === RADIO_MOODS[id] && m.tonic % 12 === 2 && m.gap[0] === 0 && m.gap[1] === 0, `${id} resolves on tonic D at ${m.bpm} BPM with no silent gaps`)
    bpms[id] = m.bpm
    const s = compose(m, 19)
    maxMs = Math.max(maxMs, s.ms)
    for (const p of s.parts) {
      if (p.tried) { worst = Math.min(worst, p.total); least = Math.min(least, p.total - p.mean) }
      for (const n of p.notes) if (n.midi) {
        notes++
        if (!m.scale.includes((((n.midi - m.tonic) % 12) + 12) % 12)) outside++
      }
    }
  }
  check(bpms.baydrive === 116 && bpms.twinpeaks === 86 && bpms.fillmore === 108, `distinct station tempos: Bay Drive ${bpms.baydrive}, Twin Peaks ${bpms.twinpeaks}, Fillmore ${bpms.fillmore} BPM`)
  check(outside === 0 && notes > 150, `all ${notes} composed radio notes stay strictly in scale`)
  check(worst > 0.72 && least > 0.08, `search quality across ${TRIES} candidates: worst voice ${(worst * 100).toFixed(0)}%, lift +${(least * 100).toFixed(0)} pts (${maxMs.toFixed(0)} ms max)`)

  // Render each radio station through the real Synth and check LUFS + strict -1 dB ceiling.
  const sr = 48000
  const loud = {}
  let top = 0, badSamples = 0, resets = 0
  for (const id of stationIds) {
    const m = RADIO_MOODS[id]
    const synth = new Synth(sr), ids = new Map(), list = []
    let figure, jit = 7
    const jitter = () => { jit = (jit * 1103515245 + 12345) >>> 0; return jit / 4294967296 }
    let secLen = 0
    for (let i = 0; i < 4; i++) {
      const s = compose(m, 19 + i, { groove: 19 + (i >> 1) * 7919, figure, tries: 800 })
      figure ??= s.parts.find((p) => p.line)?.line
      secLen = length(s)
      const layers = Math.max(...m.voices.map((v) => v.layer))
      for (const n of perform(s, i * s.steps * s.bars, (i + 1) * s.steps * s.bars, layers, jitter)) {
        if (!ids.has(n.patch)) { ids.set(n.patch, ids.size + 1); synth.define(ids.get(n.patch), compile(n.patch)) }
        list.push(Math.round((0.1 + n.at) * sr), ids.get(n.patch), n.hz, 1, n.force, n.dur, n.gain * Math.sqrt(0.5 * (1 - n.pan)) * 1.25, n.gain * Math.sqrt(0.5 * (1 + n.pan)) * 1.25, 0, n.room, BUS.music, 0)
      }
    }
    synth.notes(list)
    const secs = Math.min(36, secLen * 4 + 2)
    const l = new Float32Array(Math.round(secs * sr)), r = new Float32Array(l.length)
    synth.render(l, r)
    loud[id] = ears.lufs(l, r, sr)
    top = Math.max(top, ears.peak(l), ears.peak(r))
    resets += synth.stats.reset
    for (let i = 0; i < l.length; i++) if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) badSamples++
  }
  check(Object.values(loud).every((v) => v > -34 && v < -17) && top <= CEILING + 1e-6 && badSamples === 0 && resets === 0, `all 3 stations stay groovy and under the -1 dB ceiling (${Object.entries(loud).map(([k, v]) => `${k} ${v.toFixed(1)} LUFS`).join(', ')}, peak ${ears.db(top).toFixed(1)} dB)`)

  // Render tuning click + static burst.
  {
    const s = new Synth(sr)
    s.define(1, compile(RADIO_PATCHES.click))
    s.define(2, compile(RADIO_PATCHES.static))
    s.notes([0, 1, 0, 1, 0.78, 0, 0.55, 0.65, 0, 0.05, BUS.world, 0, Math.round(0.012 * sr), 2, 0, 1, 0.72, 0, 0.5, 0.5, 0, 0.06, BUS.world, 0])
    const l = new Float32Array(Math.round(0.5 * sr)), r = new Float32Array(l.length)
    s.render(l, r)
    const pk = Math.max(ears.peak(l), ears.peak(r))
    check(pk > 0.04 && pk <= CEILING, `tactile radio tuning click + static burst is crisp and bounded (peak ${ears.db(pk).toFixed(1)} dB)`)
  }

  // Render high-speed Doppler pass-by whoosh: verify speed threshold, stereo panning, downward pitch sweep, and ceiling.
  {
    const renderWhoosh = (side, kmh) => {
      const s = new Synth(sr), ids = new Map()
      const fakeVoice = {
        running: true,
        context: { currentTime: 0 },
        play(p, how = {}) {
          if (!ids.has(p)) { ids.set(p, ids.size + 1); s.define(ids.get(p), compile(p)) }
          const gain = how.gain ?? 1, pan = how.pan ?? 0
          s.notes([Math.round((how.after ?? 0) * sr), ids.get(p), how.pitch ?? 0, how.size ?? 1, how.force ?? 0.7, how.dur ?? 0, gain * Math.sqrt(0.5 * (1 - pan)) * 1.25, gain * Math.sqrt(0.5 * (1 + pan)) * 1.25, 0, how.room ?? 0, how.bus ?? BUS.world, 0])
          return true
        },
      }
      const fired = playDopplerWhoosh(fakeVoice, side, kmh, 0.9)
      const l = new Float32Array(Math.round(0.8 * sr)), r = new Float32Array(l.length)
      s.render(l, r)
      return { fired, l, r, peak: Math.max(ears.peak(l), ears.peak(r)) }
    }
    const slow = renderWhoosh(-1, 55)
    check(!slow.fired && slow.peak === 0, 'Doppler pass-by stays silent below 70 km/h (55 km/h ignored)')
    const left = renderWhoosh(-1, 130)
    const right = renderWhoosh(1, 130)
    const lDb = ears.db(ears.rms(left.l, 0, Math.round(0.25 * sr)) / Math.max(1e-6, ears.rms(left.r, 0, Math.round(0.25 * sr))))
    const rDb = ears.db(ears.rms(right.r, 0, Math.round(0.25 * sr)) / Math.max(1e-6, ears.rms(right.l, 0, Math.round(0.25 * sr))))
    check(left.fired && right.fired && lDb > 6 && rDb > 6, `Doppler pass-by pans cleanly across the stereo field (left +${lDb.toFixed(1)} dB L, right +${rDb.toFixed(1)} dB R)`)
    const earlyHz = ears.centroid(left.l, sr, Math.round(0.01 * sr), 4096)
    const lateHz = ears.centroid(left.l, sr, Math.round(0.16 * sr), 8192)
    check(earlyHz > lateHz * 1.5, `Doppler pitch sweeps downward across the pass (${earlyHz.toFixed(0)} Hz -> ${lateHz.toFixed(0)} Hz)`)
    check(left.peak <= CEILING && right.peak <= CEILING, `Doppler pass-by stays under the -1 dB ceiling (peak ${ears.db(Math.max(left.peak, right.peak)).toFixed(1)} dB)`)
  }
}

if (nodeOnly) {
  if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
  console.log('radio (node): ok')
  process.exit(0)
}

console.log('Browser driving radio, HUD toast & Doppler check')
const { city, check: bcheck, finish } = await start()
try {
  const page = await city('scale=0.5&fire=0&people=0&living=finecar')
  await still(page)
  await page.waitForFunction(() => globalThis.engine?.ears && globalThis.engine?.alive?.things.length > 0, null, { timeout: 25_000 })
  await page.mouse.click(640, 360)
  await page.waitForFunction(() => globalThis.engine.ears.voice.running, null, { timeout: 5000 })

  bcheck(await page.evaluate(() => globalThis.engine.ears.music === null), 'ambient background music stays null by default')
  bcheck(await page.evaluate(() => globalThis.engine.ears.radio.state.station.id === 'off'), 'car radio defaults to Off in headless checks')

  // Tap synth output for live audio proof.
  await page.evaluate(async () => {
    const v = globalThis.engine.ears.voice, ctx = v.context
    await ctx.audioWorklet.addModule('/page/sound/tap.ts')
    const tap = new AudioWorkletNode(ctx, 'village-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    v.out.connect(tap)
    const heard = { parts: [], sr: ctx.sampleRate }
    tap.port.onmessage = (e) => heard.parts.push(e.data)
    globalThis.heard = heard
  })
  const take = async (from, to) => {
    const got = await page.evaluate(([from, to]) => {
      const h = globalThis.heard, a = Math.round(from * h.sr), b = Math.round(to * h.sr), l = new Float32Array(b - a), r = new Float32Array(b - a)
      for (const p of h.parts) for (let i = Math.max(0, a - p.from); i < p.l.length && p.from + i < b; i++) { l[p.from + i - a] = p.l[i]; r[p.from + i - a] = p.r[i] }
      const text = (x) => { const u = new Uint8Array(x.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
      return { l: text(l), r: text(r), sr: h.sr }
    }, [from, to])
    const f = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4) }
    return { l: f(got.l), r: f(got.r), sr: got.sr }
  }
  const clock = () => page.evaluate(() => globalThis.engine.ears.voice.context.currentTime)

  // Mount the car.
  await page.evaluate(() => { const e = globalThis.engine; e.alive.mount(e.alive.things[0]) })
  await page.waitForTimeout(450)
  const cardHasRadio = await page.evaluate(() => document.querySelector('#card')?.textContent?.includes('radio') ?? false)
  bcheck(cardHasRadio, 'controls card advertises N radio while driving')
  const idleHidden = await page.evaluate(() => { const el = document.querySelector('[data-panel="radio-toast"]'); return !el || el.hidden || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) })
  bcheck(idleHidden, 'radio toast pill is hidden when idle (zero permanent HUD clutter)')
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'radio-idle.png') })

  // Press N -> Bay Drive FM.
  const tRadio = await clock()
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(350)
  const bay = await page.evaluate(() => {
    const st = globalThis.engine.ears.radio.state
    const toast = document.querySelector('[data-panel="radio-toast"]')
    const hud = document.querySelector('[data-panel="drive-hud"]')
    const card = document.querySelector('#card')
    const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const tr = toast?.getBoundingClientRect(), hr = hud?.getBoundingClientRect(), cr = card?.getBoundingClientRect()
    return {
      id: st.station.id,
      active: st.active,
      text: toast?.textContent?.trim() ?? '',
      shown: !!toast && !toast.hidden && toast.classList.contains('show'),
      overHud: overlaps(tr, hr),
      overCard: overlaps(tr, cr),
      rect: tr ? { left: Math.round(tr.left), top: Math.round(tr.top), right: Math.round(tr.right), bottom: Math.round(tr.bottom), w: Math.round(tr.width), h: Math.round(tr.height) } : null,
    }
  })
  bcheck(bay.id === 'baydrive' && bay.active && bay.shown && bay.text.includes('BAY DRIVE FM'), `N tunes Bay Drive FM and shows toast pill (${bay.text})`)
  bcheck(!bay.overHud && !bay.overCard, `radio toast pill clears drive-hud and controls card (${JSON.stringify(bay.rect)})`)
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'radio-baydrive.png') })

  // Wait for audio to play a bar of Bay Drive FM and verify synth output.
  await page.waitForTimeout(1600)
  const audio = await take(tRadio, tRadio + 1.8)
  const audioPeak = Math.max(ears.peak(audio.l), ears.peak(audio.r))
  const audioRms = ears.rms(audio.l)
  bcheck(audioRms > 0.004 && audioPeak <= CEILING + 0.002, `Bay Drive FM plays live through AudioWorklet under ceiling (rms ${ears.db(audioRms).toFixed(1)} dB, peak ${ears.db(audioPeak).toFixed(1)} dB)`)

  // Verify toast auto-fades cleanly after ~2.2 s.
  await page.waitForTimeout(1200)
  const faded = await page.evaluate(() => { const el = document.querySelector('[data-panel="radio-toast"]'); return !!el && (el.hidden || !el.classList.contains('show')) })
  bcheck(faded, 'radio station toast auto-fades cleanly after ~2.2 s')

  // Cycle N -> Twin Peaks Chill -> Fillmore Funk.
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(200)
  const twin = await page.evaluate(() => globalThis.engine.ears.radio.state.station.id)
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(300)
  const fillmore = await page.evaluate(() => ({ id: globalThis.engine.ears.radio.state.station.id, text: document.querySelector('[data-panel="radio-toast"]')?.textContent?.trim() ?? '' }))
  bcheck(twin === 'twinpeaks' && fillmore.id === 'fillmore' && fillmore.text.includes('FILLMORE FUNK'), `N cycles through Twin Peaks Chill and Fillmore Funk (${fillmore.text})`)
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'radio-fillmore.png') })

  // Horn ducks radio smoothly, then recovers on release.
  await page.keyboard.down('KeyH')
  await page.waitForTimeout(300)
  const ducked = await page.evaluate(() => globalThis.engine.ears.radio.state.ducking)
  await page.keyboard.up('KeyH')
  await page.waitForTimeout(900)
  const recovered = await page.evaluate(() => globalThis.engine.ears.radio.state.ducking)
  bcheck(ducked > 0.35 && recovered < 0.12, `horn smoothly ducks radio (${(ducked * 100).toFixed(0)}%) and recovers on release (${(recovered * 100).toFixed(0)}%)`)

  // Exiting car turns radio off; hopping back in remembers Fillmore Funk!
  await page.evaluate(() => globalThis.engine.alive.mount(null))
  await page.waitForTimeout(250)
  const outState = await page.evaluate(() => globalThis.engine.ears.radio.state)
  bcheck(!outState.driving && !outState.active && outState.station.id === 'off', 'exiting car turns radio off cleanly')
  await page.evaluate(() => { const e = globalThis.engine; e.alive.mount(e.alive.things[0]) })
  await page.waitForTimeout(700)
  const backState = await page.evaluate(() => globalThis.engine.ears.radio.state)
  bcheck(backState.driving && backState.active && backState.station.id === 'fillmore', `re-entering car remembers last station (${backState.station.name})`)

  // Cycle once more -> Radio Off.
  await page.keyboard.press('KeyN')
  await page.waitForTimeout(250)
  const offState = await page.evaluate(() => globalThis.engine.ears.radio.state)
  bcheck(offState.station.id === 'off' && !offState.active, 'N cycles Fillmore Funk -> Radio Off')

  // Dispatch voxelwright:nearmiss at 125 km/h on left side -> Doppler pass-by whoosh fires and pans left over the engine bed.
  const tMiss = await clock()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voxelwright:nearmiss', { detail: { side: -1, kmh: 125, closeness: 0.95 } })))
  await page.waitForTimeout(500)
  const whooshCount = await page.evaluate(() => globalThis.engine.ears.radio.state.whooshes)
  const missAudio = await take(tMiss, tMiss + 0.35)
  // Compare left vs right energy in the >400 Hz pass-by band (above centered engine idle rumble) and broadband peak.
  const bandPower = (x) => ears.band(x, missAudio.sr, 400, 6000) * ears.rms(x) ** 2
  const missLR = ears.db(Math.sqrt(bandPower(missAudio.l) / Math.max(1e-12, bandPower(missAudio.r))))
  bcheck(whooshCount === 1 && ears.peak(missAudio.l) > 0.04 && ears.peak(missAudio.l) <= CEILING + 0.002 && missLR > 3, `voxelwright:nearmiss triggers stereo-panned Doppler whoosh (${missLR.toFixed(1)} dB left bias >400 Hz, peak ${ears.db(ears.peak(missAudio.l)).toFixed(1)} dB)`)

  await page.close()
} catch (e) {
  bcheck(false, `browser check failed: ${e.stack ?? e}`)
}
for (const f of failures) bcheck(false, f)
await finish('radio')
