// The world heard, for real (#247): the city page in the installed Chrome, its sound tapped as it leaves the
// synthesiser and measured here. What is checked is that the things the page does make the sound they should, when
// they should, as loud as they should, and what that costs. Whether a hammer on brick sounds like one is not
// checked by anything: that is for ears (the page /page/sound/lab.html).
//
//   node test/heard.mjs [--clip file.webm]
import { writeFileSync } from 'node:fs'
import { arg, start, still } from './kit.mjs'
import * as ears from './ears.mjs'

const { city, check, finish } = await start()
try {
  const page = await city('scale=0.5&fire=0&people=0&music=0')
  await still(page)
  await page.waitForFunction(() => globalThis.engine.ears, null, { timeout: 20_000 })
  const state = () => page.evaluate(() => globalThis.engine.ears?.voice.context.state)
  check(await state() === 'suspended' || await state() === 'running', `the page has sound, waiting for a touch (${await state()})`)
  // A touch going down is not enough to start sound; its coming up is.
  await page.mouse.click(640, 360)
  await page.waitForFunction(() => globalThis.engine.ears.voice.running, null, { timeout: 5000 })
  check(true, 'one click and sound runs')
  // Tap what leaves the synthesiser.
  await page.evaluate(async () => {
    const v = globalThis.engine.ears.voice, ctx = v.context
    await ctx.audioWorklet.addModule('/page/sound/tap.ts')
    const tap = new AudioWorkletNode(ctx, 'village-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    v.out.connect(tap)
    const heard = { parts: [], sr: ctx.sampleRate }
    tap.port.onmessage = (e) => heard.parts.push(e.data)
    globalThis.heard = heard
  })
  /** What was heard between two moments of the audio clock (seconds), as left and right. */
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
  const told = () => page.evaluate(() => globalThis.engine.ears.voice.told)
  const wait = (ms) => page.waitForTimeout(ms)

  // In the street, facing a house front.
  await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 9; p.yaw = 0; p.pitch = 0.2 })
  await wait(1500)
  let t0 = await clock()
  await wait(1200)
  const calm = await take(t0, t0 + 1)
  check(ears.peak(calm.l) < 0.1 && ears.peak(calm.l) > 0, `a still street is quiet but not dead: a little wind (${ears.db(ears.rms(calm.l)).toFixed(0)} dB)`)

  // The hammer, by the page's own button: heard at once.
  await page.evaluate(() => globalThis.engine.pickTool(0))
  t0 = await page.evaluate(() => { document.querySelector('#boom').click(); return globalThis.engine.ears.voice.context.currentTime })
  await wait(1300)
  const blow = await take(t0, t0 + 1.2), began = ears.onset(blow.l.map((v, i) => v + blow.r[i]), blow.sr, 0.02)
  check(began >= 0 && began < 0.45, `a hammer blow is heard ${(began * 1000).toFixed(0)} ms after the button (the page first asks the GPU what is ahead: a frame or two, more on a busy machine)`)
  check(ears.peak(blow.l) > 0.05, `and it is not faint (peak ${ears.db(ears.peak(blow.l)).toFixed(0)} dB)`)
  await still(page)

  // A charge 170 m off: seen at once, heard after sound has crossed the distance.
  await wait(2500)
  const far = 1700
  t0 = await page.evaluate((far) => { const e = globalThis.engine, p = e.pose; e.strike([Math.round(p.x * 10), Math.round(p.y * 10) + 300, Math.round(p.z * 10) - far], 12, false); return e.ears.voice.context.currentTime }, far)
  await wait(2600)
  const boom = await take(t0, t0 + 2.4), mono = boom.l.map((v, i) => v + boom.r[i])
  const quiet = ears.rms(mono, 0, Math.round(0.3 * boom.sr)), arrived = ears.onset(mono, boom.sr, Math.max(0.01, quiet * 6))
  const due = Math.hypot(far, 300) / 10 / 343
  check(Math.abs(arrived - due) < 0.04, `a blast ${(Math.hypot(far, 300) / 10).toFixed(0)} m off is heard ${arrived.toFixed(2)} s after it is seen (sound takes ${due.toFixed(2)} s)`)
  const near = ears.centroid(blow.l, blow.sr, Math.round(began * blow.sr), 8192), distant = ears.centroid(mono, boom.sr, Math.round(arrived * boom.sr), 8192)
  check(distant < near * 0.7, `and it has lost its top on the way (its weight is at ${distant.toFixed(0)} Hz; the hammer close by, ${near.toFixed(0)})`)
  await still(page)

  // A charge on the house front: the blast, then what it loosened landing for seconds after.
  await wait(1000)
  t0 = await clock()
  const frames0 = await page.evaluate(() => { globalThis.gaps = []; let last = performance.now(); const tick = (now) => { globalThis.gaps.push(now - last); last = now; if (globalThis.gaps.length < 2000) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  await page.evaluate(() => { globalThis.engine.pickTool(1); document.querySelector('#boom').click() })
  let most = 0, worst = 0, mean = 0, n = 0, stolen = 0
  for (let i = 0; i < 6; i++) { await wait(1000); const t = await told(); if (t) { most = Math.max(most, t.voices); worst = Math.max(worst, t.worst); mean += t.ms; n++; stolen = t.stolen } }
  const fall = await take(t0, t0 + 5.5), fm = fall.l.map((v, i) => v + fall.r[i])
  const env = ears.envelope(fm, fall.sr, 250)
  check(ears.peak(fall.l) > 0.3, `a charge on a house front is loud (peak ${ears.db(Math.max(ears.peak(fall.l), ears.peak(fall.r))).toFixed(1)} dB, never over the ceiling of -1)`)
  check(Math.max(ears.peak(fall.l), ears.peak(fall.r)) <= 0.891, 'nothing left louder than the ceiling')
  // A hammer is a blow, not a blast: quieter than the charge, and with no boom under it.
  const blowLow = ears.band(blow.l.subarray(Math.round(began * blow.sr)), blow.sr, 20, 120), chargeLow = ears.band(fall.l, fall.sr, 20, 120)
  check(ears.rms(blow.l, Math.round(began * blow.sr), Math.round((began + 0.3) * blow.sr)) < ears.rms(fall.l, 0, Math.round(0.4 * fall.sr)) * 0.6 && blowLow < chargeLow * 0.5, `a hammer blow is no explosion: ${ears.db(ears.rms(blow.l, Math.round(began * blow.sr), Math.round((began + 0.3) * blow.sr)) / ears.rms(fall.l, 0, Math.round(0.4 * fall.sr))).toFixed(0)} dB against the charge, and ${(blowLow * 100).toFixed(0)}% of it under 120 Hz where the charge has ${(chargeLow * 100).toFixed(0)}%`)
  const later = env.slice(4, 14).filter((e) => e > 0.004).length
  check(later >= 3, `what it loosened is heard landing afterwards (${later} of the ten quarter-seconds from 1 s to 3.5 s have sound)`)
  const block = (128 / fall.sr) * 1000
  check(mean / n < block * 0.25, `the audio thread spent ${((mean / n / block) * 100).toFixed(1)}% of its time while the front came down (worst block ${worst.toFixed(1)} ms of ${block.toFixed(1)}; ${most} voices at most, ${stolen} cut short)`)
  const gaps = await page.evaluate(() => globalThis.gaps.slice(2).sort((a, b) => a - b))
  console.log(`  blows: ${JSON.stringify(await page.evaluate(() => globalThis.engine.ears.count))}`)
  console.log(`  frames while it fell: ${gaps.length}, half within ${gaps[gaps.length >> 1].toFixed(1)} ms, 95% within ${gaps[Math.floor(gaps.length * 0.95)].toFixed(1)} ms; this thread spent ${(await page.evaluate(() => globalThis.engine.ears.voice.spent)).toFixed(3)} ms a note`)
  await still(page)

  // Rain.
  await page.evaluate(() => { globalThis.engine.rain = 1 })
  await wait(2500)
  t0 = await clock()
  await wait(1300)
  const wet = await take(t0 - 1.2, t0)
  check(ears.rms(wet.l) > ears.rms(calm.l) * 2 && ears.band(wet.l, wet.sr, 1500, 12000) > 0.3, `rain is heard, and it is a hiss (${ears.db(ears.rms(wet.l)).toFixed(0)} dB, ${(ears.band(wet.l, wet.sr, 1500, 12000) * 100).toFixed(0)}% of it over 1.5 kHz)`)
  await page.evaluate(() => { globalThis.engine.rain = 0 })

  // Under the sea everything loses its top.
  await page.evaluate(() => { const e = globalThis.engine, p = e.pose; let x = p.x; while (e.ground(x, p.z) > -6 && x > -4000) x -= 20; globalThis.was = { ...p }; p.x = x - 30; p.y = -3 })
  await wait(3000)
  t0 = await clock()
  await page.evaluate(() => { const e = globalThis.engine, p = e.pose; e.strike([Math.round(p.x * 10), Math.round(p.y * 10), Math.round(p.z * 10) - 150], 5, false) })
  await wait(1300)
  const deep = await take(t0, t0 + 1.2)
  check(ears.band(deep.l, deep.sr, 3000, 20000) < 0.02, `under the sea a blast near by has no top left (${(ears.band(deep.l, deep.sr, 3000, 20000) * 100).toFixed(1)}% of it over 3 kHz)`)

  // The music follows the place: the town's own in the street, and danger's at once when a charge goes off near by.
  const sr = fall.sr
  await page.close()
  const tuned = await city('scale=0.5&fire=0&people=0')
  await still(tuned)
  await tuned.waitForFunction(() => globalThis.engine.ears, null, { timeout: 20_000 })
  await tuned.mouse.click(640, 360)
  await tuned.evaluate(() => { const q = globalThis.engine.pose; q.y -= 9; q.yaw = 0; q.pitch = 0.2 })
  const playing = () => tuned.evaluate(() => { const e = globalThis.engine.ears; return { place: e.place, mood: e.music.state.mood, composed: e.music.state.composed, ms: e.music.state.ms } })
  await tuned.waitForFunction(() => globalThis.engine.ears.music.state.mood === 'town', null, { timeout: 20_000 }).catch(() => {})
  const street = await playing()
  check(street.place === 'town' && street.mood === 'town', `in the street the town's music plays (${street.composed} sections composed, the last in ${street.ms.toFixed(0)} ms on a thread of its own)`)
  const from = Date.now()
  await tuned.evaluate(() => { globalThis.engine.pickTool(1); globalThis.engine.input.use() })
  await tuned.waitForFunction(() => globalThis.engine.ears.music.state.mood === 'danger', null, { timeout: 10_000 }).catch(() => {})
  const alarm = await playing()
  check(alarm.mood === 'danger', `a charge near by and the music is danger's ${((Date.now() - from) / 1000).toFixed(1)} s later (it hands over on a beat)`)
  await tuned.close()

  const clip = arg('wav', '')
  if (clip) { ears.wav(clip, fall.l, fall.r, sr); ears.spectrogram(clip.replace(/\.wav$/, '.png'), fm, sr, { tick: 1 }); console.log(`  kept ${clip} and its picture`) }
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
await finish('heard')
