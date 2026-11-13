// A clip of the page with its sound (#247): the picture as the canvas shows it and the sound as it leaves the
// synthesiser, recorded together in the page and written as one file. For showing someone who was not there; it
// measures nothing.
//
//   node test/listen.mjs --out file.webm [--seconds 14] [--query 'hour=15']
import { writeFileSync } from 'node:fs'
import { arg, start, still } from './kit.mjs'

const { city, finish } = await start()
const seconds = Number(arg('seconds', '14')), out = arg('out', 'heard.webm')
const page = await city(`scale=0.6&people=0&${arg('query', '')}`, { size: [960, 540], dpr: 1 })
await still(page)
await page.waitForFunction(() => globalThis.engine.ears)
await page.mouse.click(480, 270)
await page.waitForFunction(() => globalThis.engine.ears.voice.running)
await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 8.5; p.yaw = 0; p.pitch = 0.16 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const v = globalThis.engine.ears.voice, to = v.context.createMediaStreamDestination()
  v.out.connect(to)
  const stream = new MediaStream([...document.querySelector('canvas').captureStream(60).getVideoTracks(), ...to.stream.getAudioTracks()])
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 }), parts = []
  recorder.ondataavailable = (e) => parts.push(e.data)
  recorder.start()
  globalThis.clip = () => new Promise((done) => { recorder.onstop = async () => { const u = new Uint8Array(await new Blob(parts).arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); done(btoa(s)) }; recorder.stop() })
})
const use = (tool) => page.evaluate((tool) => { globalThis.engine.pickTool(tool); document.querySelector('#boom').click() }, tool)
const turn = (yaw) => page.evaluate((yaw) => { globalThis.engine.pose.yaw = yaw }, yaw)
const wait = (ms) => page.waitForTimeout(ms)
// Three hammer blows on a house front, a charge on it, then one on the next house heard from here.
await wait(800); await use(0); await wait(700); await turn(0.12); await use(0); await wait(700); await turn(-0.12); await use(0)
await wait(1200); await turn(0); await use(1)
await wait(5200); await turn(0.7); await use(2)
await wait(Math.max(0, seconds * 1000 - 9800))
writeFileSync(out, Buffer.from(await page.evaluate(() => globalThis.clip()), 'base64'))
console.log(`kept ${out}`)
await finish('listen')
