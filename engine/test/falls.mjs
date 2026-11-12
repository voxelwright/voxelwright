// What is no longer held falls, for real (#140): the city page in the installed Chrome with
// WebGPU. A street tree's trunk is cut through; its crown must come down (it goes over, as a body) and lie on the
// ground as cells of the world.
//
//   node test/falls.mjs [--out dir]
import { mkdir } from 'node:fs/promises'
import { arg, start, still as rest } from './kit.mjs'

const out = arg('out', '')
if (out) await mkdir(out, { recursive: true })
const { city, check, failures, finish } = await start()
const WOOD = 10, LEAVES = 13, TRUNK = 45
try {
  // A phone's boxes: cells twice as big beyond 25 m, four times beyond 51 m, so the far look is at a coarse copy.
  const page = await city('scale=1&grid=8,8,8&levels=8&fire=0')
  const still = () => rest(page)
  await still()
  await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 10.2 })
  await page.waitForTimeout(300)
  await still()
  const pick = (right = 0, up = 0) => page.evaluate(([r, u]) => globalThis.engine.pick(r, u), [right, up])
  const dir = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]
  const pose = () => page.evaluate(() => ({ ...globalThis.engine.pose }))
  /** Turns the head to look at a point of the world (metres). */
  const lookAt = async (at) => {
    const p = await pose(), d = [at[0] - p.x, at[1] - p.y, at[2] - p.z]
    await page.evaluate(([y, pt]) => { globalThis.engine.pose.yaw = y; globalThis.engine.pose.pitch = pt }, [Math.atan2(d[0], -d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))])
  }
  // Look round for the nearest tree trunk.
  let trunk = null
  for (let pitch = 0.02; pitch < 0.2; pitch += 0.04) for (let yaw = -3.1; yaw < 3.1; yaw += 0.02) {
    await page.evaluate(([y, p]) => { globalThis.engine.pose.yaw = y; globalThis.engine.pose.pitch = p }, [yaw, pitch])
    const hit = await pick()
    if (hit && hit.material === WOOD && hit.colour === TRUNK && hit.t < 400 && (!trunk || hit.t < trunk.hit.t)) trunk = { yaw, pitch, hit }
  }
  check(!!trunk, `found a tree trunk ${trunk ? (trunk.hit.t / 10).toFixed(1) : '?'} m away`)
  if (trunk) {
    // Where the trunk is, and a place to stand 7 m from it.
    const from = await pose(), d = dir(trunk.yaw, trunk.pitch), t = trunk.hit.t / 10
    const at = [from.x + d[0] * t, from.y + d[1] * t, from.z + d[2] * t]
    const flat = Math.hypot(d[0], d[2])
    await page.evaluate(([x, z]) => { globalThis.engine.pose.x = x; globalThis.engine.pose.z = z }, [at[0] - (d[0] / flat) * 7, at[2] - (d[2] / flat) * 7])
    await lookAt([at[0], from.y - 0.6, at[2]])
    await page.waitForTimeout(300)
    await still()
    const near = await pick()
    check(near?.material === WOOD && near.colour === TRUNK, `standing 7 m from it, the trunk is ahead (material ${near?.material} at ${near?.t.toFixed(0)} cells)`)
    // What is above the trunk: the crown, and its top. A cut tree comes straight down on its stump, so it is the top that must be empty after.
    let crown = null
    for (let up = 0.1; up < 1.45; up += 0.03) { const hit = await pick(0, up); if (hit?.material === LEAVES && hit.t < 160) crown = { up, hit } }
    check(!!crown, 'its crown is above it')
    const stand = await pose()
    const crownAt = crown && (() => { const c = dir(stand.yaw, stand.pitch + crown.up), ct = crown.hit.t / 10 + 0.15; return [stand.x + c[0] * ct, stand.y + c[1] * ct, stand.z + c[2] * ct] })()
    // Step back to see the whole tree, and cut it from there.
    await page.evaluate(() => { globalThis.engine.pose.pitch += 0.28 })
    if (out) await page.screenshot({ path: `${out}/tree-before.png` })
    await page.evaluate(() => { globalThis.engine.pose.pitch -= 0.28 })
    const before = await page.evaluate(() => ({ ...globalThis.engine.fell }))
    await page.evaluate(() => globalThis.engine.blast(6))
    await page.evaluate(() => { globalThis.engine.pose.pitch += 0.28 })
    // While it is in the air.
    await page.waitForFunction(() => globalThis.engine.dropping > 0, null, { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(260)
    if (out) await page.screenshot({ path: `${out}/tree-falling.png` })
    await still()
    await page.waitForTimeout(700)
    if (out) await page.screenshot({ path: `${out}/tree-after.png` })
    await page.evaluate(() => { globalThis.engine.pose.pitch -= 0.28 })
    const after = await page.evaluate(() => ({ ...globalThis.engine.fell }))
    console.log(`       ${after.pieces - before.pieces} pieces, ${after.cells - before.cells} cells fell, ${after.dust - before.dust} crumbs; worked out in ${after.ms.toFixed(0)} ms`)
    check(after.cells - before.cells > 3000, 'the crown fell: more than 3,000 cells came down')
    if (crown) {
      const now = await pick(0, crown.up)
      check(!now || now.material !== LEAVES || Math.abs(now.t - crown.hit.t) > 5, `where the top of the crown was there is no crown (now ${now ? `material ${now.material} at ${now.t.toFixed(0)}` : 'sky'})`)
    }
    // It lies on the ground, whichever way it went over: leaves low down, within 12 m, where there were none.
    let low = null
    for (let right = -1.4; right <= 1.4 && !low; right += 0.14) for (let down = 0.05; down > -0.45 && !low; down -= 0.05) { const hit = await pick(right, down); if (hit?.material === LEAVES && hit.t < 120) low = hit }
    check(!!low, 'leaves lie on the ground')
    const differ = await page.evaluate(() => globalThis.engine.shadowsDiffer())
    check(differ < 0.05, `mapped and traced shadows agree after the fall (${(differ * 100).toFixed(2)}% differ)`)

    // From 75 m down the street the same must be true: far copies of the world are coarser, and the crown must be gone from them too.
    if (crownAt) {
      await page.evaluate(([x, y, z]) => Object.assign(globalThis.engine.pose, { x, y, z }), [from.x - 75 * Math.sign(d[0] || 1) , from.y + 3, from.z])
      await lookAt(crownAt)
      await page.waitForTimeout(300)
      await still()
      const far = await pick(), away = Math.hypot(crownAt[0] - (from.x - 75 * Math.sign(d[0] || 1)), crownAt[2] - from.z) * 10
      check(!far || far.material !== LEAVES || Math.abs(far.t - away) > 25, `from ${(away / 10).toFixed(0)} m, where the top of the crown was there is no crown (now ${far ? `material ${far.material} at ${far.t.toFixed(0)} cells` : 'sky'})`)
      if (out) await page.screenshot({ path: `${out}/tree-from-far.png` })
    }
    const stats = await page.evaluate(() => globalThis.engine.world.stats)
    check(stats.full === 0, 'every sector made again fitted the pool')
  }
} catch (e) {
  failures.push(String(e))
}
await finish('falls')
