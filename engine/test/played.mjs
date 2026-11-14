// Instruments played, for real (#247): the listening page in the installed Chrome, real key presses and pointer
// touches, the sound tapped as it leaves the synthesiser. What is checked: the kept instruments are data in the
// form; a key sounds the right note and soon; a held note lasts as long as the key; a piano key let go is damped;
// a chord changes what a strum sounds. What is not: whether it feels good under the fingers, and nothing here
// includes the device's own delay (the page reports that; a Bluetooth speaker adds its own).
//
//   node test/played.mjs
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { here, serve, start } from './kit.mjs'
import * as ears from './ears.mjs'

const { page, url, check, finish } = await start()
try {
  const lab = await page({ size: [900, 1200], dpr: 1 })
  await lab.goto(`${url}/page/sound/lab.html`)
  await lab.waitForFunction(() => globalThis.lab)
  await lab.mouse.click(300, 20)
  await lab.waitForFunction(() => globalThis.lab.voice.running)
  const forms = await lab.evaluate(() => globalThis.lab.INSTRUMENTS.map((i) => ({ name: i.name, ok: 'surface' in globalThis.lab.surface(JSON.parse(JSON.stringify(i.sounds.surface))), parts: i.sounds.surface.parts.length })))
  check(forms.length === 3 && forms.every((f) => f.ok), `the kept instruments are surfaces in the form (${forms.map((f) => `${f.name}: ${f.parts} parts`).join(', ')})`)
  const refused = await lab.evaluate(() => { const s = globalThis.lab.surface, good = globalThis.lab.INSTRUMENTS[1].sounds.surface; return [{ ...good, onclick: 'x' }, { ...good, parts: [{ ...good.parts[2], label: '<b>x</b>' }] }, { ...good, parts: [{ ...good.parts[2], key: 'Escape' }] }, { ...good, parts: [{ ...good.parts[2], colour: 'url(x)' }] }, { ...good, parts: [{ shape: 'rect', at: [0, 0, 99, 1], note: 60 }] }, { ...good, parts: good.parts.slice(0, 2) }, 'x'].map((v) => 'refused' in s(v)) })
  check(refused.every(Boolean), 'a surface with a stray key, markup in a label, a key that is not a letter, a colour that is not a name, a part off its edge, or nothing that sounds is refused')
  await lab.evaluate(async () => {
    const v = globalThis.lab.voice, ctx = v.context
    await ctx.audioWorklet.addModule('/page/sound/tap.ts')
    const tap = new AudioWorkletNode(ctx, 'village-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    v.out.connect(tap)
    globalThis.heard = { parts: [], sr: ctx.sampleRate }
    tap.port.onmessage = (e) => globalThis.heard.parts.push(e.data)
    // When a key or a touch arrived, on the audio clock and on the page's.
    globalThis.at = []
    for (const type of ['keydown', 'pointerdown']) addEventListener(type, (e) => globalThis.at.push({ clock: ctx.currentTime, late: performance.now() - e.timeStamp }), { capture: true })
  })
  const take = async (from, to) => {
    const got = await lab.evaluate(([from, to]) => {
      const h = globalThis.heard, a = Math.round(from * h.sr), b = Math.round(to * h.sr), l = new Float32Array(b - a)
      for (const p of h.parts) for (let i = Math.max(0, a - p.from); i < p.l.length && p.from + i < b; i++) l[p.from + i - a] = p.l[i] + p.r[i]
      const u = new Uint8Array(l.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
      return { l: btoa(s), sr: h.sr }
    }, [from, to])
    const b = Buffer.from(got.l, 'base64')
    return { l: new Float32Array(b.buffer, b.byteOffset, b.length / 4), sr: got.sr }
  }
  const out = async (name) => { await lab.evaluate((name) => { globalThis.at.length = 0; const l = globalThis.lab; l.take(l.INSTRUMENTS.find((i) => i.name === name)) }, name); await lab.locator('.stage').scrollIntoViewIfNeeded() }
  const last = () => lab.evaluate(() => globalThis.at.at(-1))
  const wait = (ms) => lab.waitForTimeout(ms)
  const loudest = (x, sr, from = 0) => ears.peaks(x, sr, { from, size: 16384, most: 1 })[0]?.hz ?? 0

  // The piano: Z is middle C, heard at once, damped when the key comes up.
  await out('piano'); await wait(300)
  const delays = []
  for (const key of ['z', 'x', 'c', 'v', 'b']) {
    await lab.keyboard.down(key); await wait(260); await lab.keyboard.up(key); await wait(240)
    const t = await last(), got = await take(t.clock, t.clock + 0.45), began = ears.onset(got.l, got.sr, 0.004)
    delays.push({ began, late: t.late, hz: loudest(got.l, got.sr, Math.round(began * got.sr)), after: ears.rms(got.l, Math.round(0.4 * got.sr), Math.round(0.45 * got.sr)), during: ears.rms(got.l, Math.round(0.15 * got.sr), Math.round(0.25 * got.sr)) })
  }
  const worst = Math.max(...delays.map((d) => d.began)), mean = delays.reduce((s, d) => s + d.began, 0) / delays.length
  check(delays.every((d) => d.began >= 0) && worst < 0.03, `a piano key is heard ${(mean * 1000).toFixed(1)} ms after the audio clock's reading at the key press, ${(worst * 1000).toFixed(1)} at worst of five (the page got the key ${Math.max(...delays.map((d) => d.late)).toFixed(1)} ms after it was pressed, at most)`)
  const want = [261.63, 293.66, 329.63, 349.23, 392]
  check(delays.every((d, i) => Math.abs(1200 * Math.log2(d.hz / want[i])) < 15), `Z X C V B are C D E F G (${delays.map((d) => d.hz.toFixed(0)).join(', ')} Hz)`)
  check(delays.every((d) => d.after < d.during * 0.15), `a key let go is damped (${ears.db(delays[0].after / delays[0].during).toFixed(0)} dB a seventh of a second after)`)
  const latency = await lab.evaluate(() => { const c = globalThis.lab.voice.context; return { base: c.baseLatency, out: c.outputLatency, sr: c.sampleRate } })
  console.log(`  beyond that, the device: ${(latency.base * 1000).toFixed(1)} ms the browser says it holds, ${(latency.out * 1000).toFixed(1)} ms it says the output takes here (headless; a real device and a Bluetooth speaker differ)`)

  // The ocarina: a hole sounds as long as its key is down, and no longer.
  await out('ocarina'); await wait(300)
  await lab.keyboard.down('a'); await wait(700)
  const blown = await last(), held = await lab.evaluate(() => globalThis.lab.out.sounding)
  await lab.keyboard.up('a'); await wait(500)
  const tone = await take(blown.clock, blown.clock + 1.1), hole = loudest(tone.l, tone.sr, Math.round(0.2 * tone.sr))
  const on = ears.rms(tone.l, Math.round(0.5 * tone.sr), Math.round(0.65 * tone.sr)), off = ears.rms(tone.l, Math.round(1 * tone.sr), Math.round(1.1 * tone.sr))
  check(held === 1 && Math.abs(1200 * Math.log2(hole / 293.66)) < 15 && on > 0.01 && off < on * 0.02, `the ocarina's first hole is D (${hole.toFixed(0)} Hz), sounds while its key is held (${ears.db(on).toFixed(0)} dB, ${held} held) and stops when it is let go (${ears.db(off).toFixed(0)} dB)`)
  // By touch: a finger on the middle hole, drawn up it, bends the note up.
  const box = await lab.evaluate(() => { const r = [...document.querySelectorAll('.stage ellipse')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height } })
  await lab.mouse.move(box.x, box.y); await lab.mouse.down(); await wait(400)
  const touched = await last()
  const moved = await lab.evaluate(() => globalThis.lab.voice.context.currentTime)
  await lab.mouse.move(box.x, box.y - box.h * 0.42, { steps: 4 }); await wait(900)
  const stayed = await lab.evaluate(() => globalThis.lab.voice.context.currentTime)
  await lab.mouse.up(); await wait(200)
  const bent = await take(touched.clock, stayed), before = loudest(bent.l, bent.sr, Math.round(0.05 * bent.sr)), after = loudest(bent.l, bent.sr, Math.round((stayed - touched.clock - 0.4) * bent.sr))
  check(Math.abs(1200 * Math.log2(before / 440)) < 25 && after > before * 1.05 && moved > touched.clock, `touched in its middle the third hole is A (${before.toFixed(0)} Hz); a finger drawn up it bends it up (${after.toFixed(0)} Hz)`)

  // The guitar: a strum sounds six strings; another chord, other notes.
  await out('guitar'); await wait(300)
  await lab.keyboard.press('1'); await lab.keyboard.press('Space'); await wait(1500)
  const d = await last(), strumD = await take(d.clock, d.clock + 1.2)
  await lab.keyboard.press('5'); await lab.keyboard.press('Space'); await wait(1500)
  const e = await last(), strumE = await take(e.clock, e.clock + 1.2)
  const has = (x, sr, hz) => ears.peaks(x, sr, { from: Math.round(0.3 * sr), size: 32768, most: 60, floor: 1e-6 }).some((p) => Math.abs(1200 * Math.log2(p.hz / hz)) < 30)
  const dHas = [110, 146.83, 220].map((f) => has(strumD.l, strumD.sr, f)), eHas = [82.41, 123.47, 164.81].map((f) => has(strumE.l, strumE.sr, f))
  check(dHas.every(Boolean) && eHas.every(Boolean) && !has(strumD.l, strumD.sr, 82.41), `a strum of D sounds A, D and A at the bottom (${dHas.join(' ')}) and no low E; a strum of E minor sounds E, B and E (${eHas.join(' ')})`)
  const stat = await lab.evaluate(() => globalThis.lab.voice.told)
  check(stat.dropped === 0 && stat.reset === 0, `nothing was dropped (the audio thread at ${((stat.ms / (128000 / latency.sr)) * 100).toFixed(1)}% of its time)`)
  await lab.close()

  // In the world: a piano stood in a shared world is a thing with a record; walked up to, it offers itself, E takes
  // it up, its keys play it, Escape puts it away.
  const own = await serve('/dev/null', ['--world', join(tmpdir(), `engine-played-${process.pid}.log`)])
  try {
    const stood = spawnSync('node', ['instrument.mjs', 'piano', '--world', own.url, '--at', '706,4012'], { cwd: here, encoding: 'utf8' })
    const id = /(piano-\w+) stands/.exec(stood.stdout)?.[1]
    check(!!id, `a piano is stood in a shared world, its sounds in its record (${id})`)
    const p = await page()
    await p.goto(`${own.url}/city?fly=0&shared=1&scale=0.5&people=0&music=0&at=70.6,17.7,404.2&look=0,-10`)
    await p.waitForFunction(() => globalThis.engine?.ears?.things, null, { timeout: 90_000 })
    await p.mouse.click(640, 200)
    await p.waitForFunction(() => globalThis.engine.ears.voice.running)
    await p.waitForFunction(() => globalThis.engine.ears.things.near, null, { timeout: 30_000 }).catch(() => {})
    const near = await p.evaluate(() => ({ near: globalThis.engine.ears.things.near, offer: document.querySelector('[data-panel="play-take"] button')?.textContent }))
    check(near.near === id && /Play the piano/.test(near.offer ?? ''), `standing by it, the page offers it ("${near.offer}")`)
    await p.keyboard.press('e')
    await p.waitForTimeout(300)
    const taken = await p.evaluate(() => ({ playing: globalThis.engine.ears.things.playing, top: globalThis.engine.input.top, keys: document.querySelectorAll('[data-panel="play"] rect').length }))
    check(taken.playing === id && taken.top === 'playing' && taken.keys === 25, `E takes it up: its surface is over the picture (${taken.keys} parts) and the keys are its own (${taken.top})`)
    const was = await p.evaluate(() => ({ ...globalThis.engine.pose }))
    await p.keyboard.down('z'); await p.waitForTimeout(250)
    const during = await p.evaluate(() => ({ sounding: globalThis.engine.ears.things.instrument.sounding, played: globalThis.engine.ears.things.instrument.played }))
    await p.keyboard.up('z'); await p.keyboard.press('w'); await p.keyboard.press('q'); await p.waitForTimeout(250)
    const after = await p.evaluate(() => ({ sounding: globalThis.engine.ears.things.instrument.sounding, played: globalThis.engine.ears.things.instrument.played, pose: { ...globalThis.engine.pose }, voices: globalThis.engine.ears.voice.told?.voices }))
    const wand = await p.evaluate(() => globalThis.engine.wand.held)
    check(during.sounding === 1 && after.sounding === 0 && after.played === 3 && !wand && Math.hypot(after.pose.x - was.x, after.pose.z - was.z) < 0.01, `a key sounds while it is down and is let go when it comes up; W and Q are notes here: W does not walk and Q does not take the wand out (${after.played} notes, moved ${Math.hypot(after.pose.x - was.x, after.pose.z - was.z).toFixed(2)} m)`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(200)
    const put = await p.evaluate(() => ({ playing: globalThis.engine.ears.things.playing, top: globalThis.engine.input.top }))
    check(put.playing === null && put.top !== 'playing', `Escape puts it away and the keys are the world's again (${put.top})`)
    await p.close()

    // As a phone, by touch alone: a tap starts sound, a tap takes the piano up, two fingers sound two notes, a tap
    // puts it away. This is Chrome's touch path. Safari's on an iPhone is not proved by it.
    const phone = await page({ size: [844, 390], dpr: 2, phone: true })
    await phone.goto(`${own.url}/city?fly=0&shared=1&scale=0.5&people=0&music=0&at=70.6,17.7,404.2&look=0,-10`)
    await phone.waitForFunction(() => globalThis.engine?.ears?.things, null, { timeout: 90_000 })
    // This browser has already let the address play, so the context is stopped by hand to stand for one that waits.
    const before = await phone.evaluate(async () => { const c = globalThis.engine.ears.voice.context; await c.suspend(); return c.state })
    await phone.touchscreen.tap(600, 120)
    await phone.waitForFunction(() => globalThis.engine.ears.voice.running, null, { timeout: 5000 }).catch(() => {})
    check(before === 'suspended' && await phone.evaluate(() => globalThis.engine.ears.voice.running), `on a phone a stopped context (${before}) is started by one tap on the picture: the finger lifting is what does it`)
    await phone.waitForFunction(() => globalThis.engine.ears.things.near, null, { timeout: 30_000 }).catch(() => {})
    const offer = await phone.evaluate(() => document.querySelector('[data-panel="play-take"] button')?.textContent)
    await phone.tap('[data-panel="play-take"] button')
    await phone.waitForTimeout(300)
    const keys = await phone.evaluate(() => [...document.querySelectorAll('[data-panel="play"] rect')].slice(1, 15).filter((_, i) => i === 0 || i === 4).map((r) => { const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height * 0.85 } }))
    const cdp = await phone.context().newCDPSession(phone)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: keys.map((k, id) => ({ x: k.x, y: k.y, id })) })
    await phone.waitForTimeout(250)
    const two = await phone.evaluate(() => ({ sounding: globalThis.engine.ears.things.instrument?.sounding, voices: globalThis.engine.ears.voice.told?.voices, playing: globalThis.engine.ears.things.playing }))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await phone.waitForTimeout(200)
    const none = await phone.evaluate(() => globalThis.engine.ears.things.instrument?.sounding)
    check(two.playing === id && two.sounding === 2 && none === 0 && !/\(E\)/.test(offer ?? ''), `a tap on "${offer}" takes it up; two fingers on two keys sound two notes, and none when they lift`)
    await phone.tap('[data-panel="play"] [data-away]')
    await phone.waitForTimeout(200)
    const gone = await phone.evaluate(() => ({ playing: globalThis.engine.ears.things.playing, top: globalThis.engine.input.top }))
    check(gone.playing === null && gone.top !== 'playing', 'a tap on its round button puts it away: no key is needed')
  } finally { own.stop() }
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
await finish('played')
