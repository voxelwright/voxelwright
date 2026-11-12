// Looks at the city from one place with given settings (#140): node test/look.mjs --out file.png [--at x,y,z] [--look yaw,pitch] [--query "heat=1"] [--set "flags=5"] [--wait 1500]
// Prints the march time. A tool for the hand, not a check.
import { arg, start } from './kit.mjs'
const { url, page: open, failures, finish } = await start()
try {
  const page = await open({ size: arg('size', '1280,720').split(',').map(Number), dpr: Number(arg('dpr', '2')) })
  const q = new URLSearchParams(arg('query', ''))
  if (arg('at', '')) q.set('at', arg('at', ''))
  if (arg('look', '')) q.set('look', arg('look', ''))
  q.set('fly', '0')
  await page.goto(`${url}/city?${q}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 30_000 })
  await page.waitForFunction(() => globalThis.engine.world.stats.wanted === 0 && globalThis.engine.world.stats.ready > 0, null, { timeout: 120_000 })
  const views = arg('views', '').split(';').filter(Boolean)
  const shots = views.length ? views : ['']
  for (const [i, v] of shots.entries()) {
    if (v) {
      const [x, y, z, yaw, pitch] = v.split(',').map(Number)
      await page.evaluate(([x, y, z, yaw, pitch]) => Object.assign(globalThis.engine.pose, { x, y, z, yaw: yaw * Math.PI / 180, pitch: pitch * Math.PI / 180 }), [x, y, z, yaw, pitch])
      await page.waitForTimeout(400)
      await page.waitForFunction(() => globalThis.engine.world.stats.wanted === 0, null, { timeout: 120_000 })
    }
    for (const set of arg('set', '').split(';').filter(Boolean)) { const [k, val] = set.split('='); await page.evaluate(([k, val]) => { if (k.startsWith('march.')) globalThis.engine.march[k.slice(6)] = Number(val); else globalThis.engine[k] = Number(val) }, [k, val]) }
    await page.waitForTimeout(Number(arg('wait', '1500')))
    const m = await page.evaluate(() => ({ gpuMs: globalThis.engine.gpuMs, frameMs: globalThis.engine.frameMs, pose: { ...globalThis.engine.pose }, stats: globalThis.engine.world.stats }))
    console.log(`view ${i}: march ${m.gpuMs.toFixed(2)} ms, frame ${m.frameMs.toFixed(1)} ms, at ${m.pose.x.toFixed(0)},${m.pose.y.toFixed(0)},${m.pose.z.toFixed(0)}, pool ${(m.stats.poolUsed / 262144).toFixed(0)} MB`)
    // --ab "march.shade=0|march.shade=2": each setting paced in turn, three rounds, so a busy machine is as busy for one as the other.
    const ab = arg('ab', '').split('|').filter(Boolean)
    if (ab.length) {
      const sums = ab.map(() => [])
      for (let round = 0; round < 3; round++) for (const [j, setting] of ab.entries()) {
        const [k, val] = setting.split('=')
        sums[j].push(await page.evaluate(async ([k, val]) => { const e = globalThis.engine; if (k.startsWith('march.')) e.march[k.slice(6)] = Number(val); else e[k] = Number(val); return e.paced() }, [k, val]))
      }
      console.log(`  paced: ${ab.map((s, j) => `${s} ${sums[j].map((x) => x.toFixed(1)).join('/')} ms`).join('   ')}`)
    }
    const out = arg('out', '')
    if (out) await page.screenshot({ path: shots.length > 1 ? out.replace(/\.png$/, `-${i}.png`) : out })
  }
} catch (e) {
  failures.push(String(e))
}
await finish('look')
