// A thing that lives and is driven (#245): the city page in the installed Chrome with WebGPU, nothing stubbed.
// A car written by hand is brought to life in the street; it stands on its feet and sleeps; with E the eye gets on,
// the scheme is shown, and the keys drive it up the street, round, and into something built, which breaks and is
// told as an impact; let go, it stops and sleeps again.
//
//   node test/living.mjs [--out dir]     with --out: pictures, and a film of the drive
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { arg, film, start, still } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) await mkdir(out, { recursive: true })
const { city, check, failures, finish } = await start()
try {
  const page = await city('fire=0', { size: [1280, 720], dpr: 1 })
  await still(page)
  const tap = async (code) => { await page.keyboard.down(code); await page.waitForTimeout(80); await page.keyboard.up(code) }
  const shot = async (name) => { if (out) await page.screenshot({ path: join(out, `${name}.png`) }) }
  // The car, in the street the page starts over.
  const made = await page.evaluate(async () => {
    const e = globalThis.engine, x = 760, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
    const thing = await e.alive.spawn(e.car([x, ground + 5, z]))
    globalThis.thing = thing
    e.pose.x = x / 10 - 2.5; e.pose.y = ground / 10 + 2.2; e.pose.z = z / 10 + 4.5; e.pose.yaw = 1.0; e.pose.pitch = -0.25
    return { id: thing.id, ground }
  })
  check(made.id > 0, `a car is brought to life (body ${made.id})`)
  const where = () => page.evaluate(() => { const e = globalThis.engine, w = e.alive.where(globalThis.thing); return w && { at: w.at, front: w.front, up: 1 - 2 * (w.rot[0] ** 2 + w.rot[2] ** 2), bodies: e.bodies, riding: !!e.alive.riding, alive: globalThis.thing.alive } })
  await page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.where(globalThis.thing), null, { timeout: 20_000 })
  const parked = await where()
  check(parked.at[1] - made.ground > 4 && parked.up > 0.98, `it stands on its feet in the street and sleeps (${((parked.at[1] - made.ground) / 10).toFixed(2)} m over it, no body is being moved)`)
  await page.waitForTimeout(400)
  const cue = await page.evaluate(() => { const c = document.querySelector('#cues p'); return c && !c.hidden ? c.textContent : '' })
  check(/drive the car/.test(cue), `near it a cue says how to get on ("${cue}")`)
  await shot('parked')
  // On, and up the street.
  await tap('KeyE')
  await page.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 5000 })
  const card = await page.evaluate(() => document.querySelector('#card').textContent)
  check(/car.*W S.*drive.*A D.*steer.*E.*get off/.test(card), `riding, the scheme is shown ("${card}")`)
  const drive = async () => {
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(2000)
    const straight = await where()
    await shot('driving')
    await page.keyboard.up('KeyW')
    return { straight }
  }
  let took = null, driven
  if (out) { page.screenshot = async () => null; took = await film(page, 4, async () => { driven = await drive() }) } else driven = await drive()
  const { straight } = driven
  if (took && out) {
    const webm = join(out, 'drive.webm'), mp4 = join(out, 'drive.mp4')
    await writeFile(webm, took.webm)
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-vf', 'scale=1280:-2', mp4])
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-vf', `fps=${(12 / took.seconds).toFixed(3)},scale=480:-1,tile=4x3`, '-frames:v', '1', join(out, 'drive-strip.jpg')])
    console.log(`  filmed: ${took.frames} frames in ${took.seconds.toFixed(1)} s, gaps p50 ${took.p50.toFixed(1)} p95 ${took.p95.toFixed(1)} worst ${took.worst.toFixed(1)} ms\n  ${mp4}`)
  }
  const went = Math.hypot(straight.at[0] - parked.at[0], straight.at[2] - parked.at[2])
  check(went > 45 && straight.up > 0.97, `W for two seconds takes it ${(went / 10).toFixed(1)} m up the street, upright`)
  // Let go: it stops, and sleeps.
  const asleep = () => page.waitForFunction(() => globalThis.engine.bodies === 0, null, { timeout: 15_000 }).catch(() => {})
  await asleep()
  const stopped = await where()
  check(stopped.bodies === 0 && stopped.alive, 'let go, it stops and sleeps: no body is being moved')
  // Something built in its way: a block of brick ahead of it, half in the ground so that it stands. It is struck,
  // broken, and that is told.
  const before = await page.evaluate(() => {
    const e = globalThis.engine, w = e.alive.where(globalThis.thing)
    const x = w.at[0] + w.front[0] * 90, z = w.at[2] + w.front[2] * 90
    e.set([Math.round(x), Math.round(e.ground(x / 10, z / 10) * 10) + 4, Math.round(z)], 10, 8)
    return { fell: e.fell.pieces }
  })
  await page.waitForTimeout(500)
  await page.keyboard.down('KeyW')
  await page.waitForFunction(() => globalThis.engine.alive.struck.some((s) => s.a === globalThis.thing.id && (s.kindB & 15) === 8), null, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(500)
  await page.keyboard.up('KeyW')
  const hit = await page.evaluate(() => { const e = globalThis.engine; return { struck: e.alive.struck.filter((s) => (s.kindB & 15) === 8 && s.a === globalThis.thing.id), fell: e.fell.pieces } })
  if (!hit.struck.length) console.log('  not told: the car is at', JSON.stringify(await where()), 'and what it struck was', JSON.stringify(await page.evaluate(() => globalThis.engine.alive.struck.filter((s) => s.a === globalThis.thing.id || s.b === globalThis.thing.id).map((s) => [s.a, s.b, Math.round(s.speed), s.kindA & 15, s.kindB & 15, s.flags]))))
  const hardest = hit.struck.reduce((most, s) => Math.max(most, s.speed), 0)
  check(hit.struck.length > 0 && (hit.struck[0].flags & 1) === 1, `driven into brick, the core says the car struck brick (${hit.struck.length} told, the fastest at ${(hardest / 10).toFixed(1)} m/s)`)
  check(hit.fell > before.fell, `and the brick is broken by it (${hit.fell - before.fell} pieces came loose)`)
  await shot('struck')
  // Back off it.
  const wall = await where()
  await page.keyboard.down('KeyS')
  await page.waitForTimeout(1500)
  await page.keyboard.up('KeyS')
  const backed = await where()
  const back = (wall.at[0] - backed.at[0]) * wall.front[0] + (wall.at[2] - backed.at[2]) * wall.front[2]
  if (back <= 10) console.log('  held back:', JSON.stringify(await page.evaluate(() => ({ state: globalThis.thing.state, held: globalThis.engine.input.held('KeyS'), top: globalThis.engine.input.top, bodies: globalThis.engine.bodies }))))
  check(back > 10, `S backs it off (${(back / 10).toFixed(1)} m)`)
  await asleep()
  // And round, still going back, the way it came: the street behind it is known to be clear.
  const slowed = await where()
  await page.keyboard.down('KeyA')
  await page.keyboard.down('KeyS')
  // Until it has come round a good way: how long that takes depends on how busy the machine is.
  await page.waitForFunction((from) => { const w = globalThis.engine.alive.where(globalThis.thing); return !w || Math.abs(from - Math.atan2(w.front[2], w.front[0])) > 0.25 }, Math.atan2(slowed.front[2], slowed.front[0]), { timeout: 6000 }).catch(() => {})
  await page.keyboard.up('KeyS')
  await page.keyboard.up('KeyA')
  const round = await where()
  const turned = round ? Math.abs(Math.atan2(slowed.front[2], slowed.front[0]) - Math.atan2(round.front[2], round.front[0])) : 0
  check(round && turned > 0.2 && round.up > 0.9, `with A as well it comes round (${(turned * 180 / Math.PI).toFixed(0)} degrees) without going over`)
  // Off again.
  await tap('KeyE')
  await page.waitForTimeout(300)
  const off = await page.evaluate(() => ({ riding: !!globalThis.engine.alive.riding, card: document.querySelector('#card').hidden }))
  check(!off.riding && off.card === true, 'E gets off, and the scheme is put away')
  // On a phone, with no keys: `?living=car` stands a car in the street, the cue is touched to get on, and a button gets off.
  const phone = await city('fire=0&people=0&living=car', { size: [844, 390], dpr: 1, phone: true })
  await phone.waitForFunction(() => globalThis.engine.alive.things.length === 1 && globalThis.engine.alive.where(globalThis.engine.alive.things[0]), null, { timeout: 30_000 })
  await phone.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); e.pose.x = w.at[0] / 10 - 3; e.pose.y = w.at[1] / 10 + 1.2; e.pose.z = w.at[2] / 10 + 3.5; e.pose.yaw = 0.7; e.pose.pitch = -0.2 })
  await phone.waitForFunction(() => { const c = document.querySelector('#cues p'); return c && !c.hidden }, null, { timeout: 5000 })
  const words = await phone.evaluate(() => document.querySelector('#cues p').textContent)
  await phone.tap('#cues p')
  await phone.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 5000 }).catch(() => {})
  const on = await phone.evaluate(() => ({ riding: !!globalThis.engine.alive.riding, buttons: [...document.querySelectorAll('[data-panel="living"] button')].map((b) => b.textContent) }))
  check(on.riding && on.buttons.includes('get off'), `on a phone, a car asked for in the address is got on by touching its cue ("${words}"), and there is a button to get off (${on.buttons.join(', ')})`)
  await phone.tap('[data-panel="living"] button')
  await phone.waitForTimeout(300)
  check(!(await phone.evaluate(() => !!globalThis.engine.alive.riding)), 'touched, it gets off')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await finish('living')
