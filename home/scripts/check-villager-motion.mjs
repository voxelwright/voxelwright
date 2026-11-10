// Headless proof of the soft body (#104, src/villagers/soft.ts and rig.ts): the hand-made plush and generated
// villagers are skinned to a spine and flop bones by the same code, skinning moves nothing at rest, a walking
// villager still plants its feet, its spine, arms and floppy parts really move and settle again, it gathers itself
// before setting off, and long frames keep every number finite. The rig is stepped by hand with a fixed dt, so
// nothing here depends on the machine's frame rate.
// Usage: node scripts/check-villager-motion.mjs [base-url]   (dev server running; default http://localhost:5410/)
// Exits non-zero when any check fails.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5410/'
const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'villagers/fixtures', name), 'utf8')
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `: ${JSON.stringify(detail)}`}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  await page.goto(`${base}?plugins=renderer,camera&q=low&villager=gen&gen=none`)
  await page.waitForFunction(() => window.villagerGen, null, { timeout: 30000 })

  const plush = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three_webgpu.js').catch(() => import('three/webgpu'))
    const { KINDS } = await import('/src/villagers/kinds.ts')
    const { Villager } = await import('/src/villagers/rig.ts')
    const { softReport } = await import('/src/villagers/soft.ts')
    const eye = new THREE.Vector3(3, 2, 4)
    const out = []
    for (let i = 0; i < 3; i++) {
      const fig = KINDS.b.build(i, false, { accent: '#c8553d' })
      fig.root.scale.setScalar(1.3)
      const report = softReport(fig)
      const v = new Villager(fig, [{ spot: 'fridge', stay: 3 }, { spot: 'shelf', stay: 3 }], { start: 'window', wait: 0.5, paths: 'open' })
      const run = (seconds, dt, each) => { for (let n = Math.round(seconds / dt); n > 0; n--) { v.update(dt, (run.t += dt), eye); each?.() } }
      run.t = 0
      const world = new THREE.Vector3()
      const flopAngle = () => Math.max(0, ...fig.soft.flops.map((f) => 2 * Math.acos(Math.min(1, Math.abs(f.bone.quaternion.w)))))
      const finite = () => { let ok = true; fig.root.updateMatrixWorld(true); fig.root.traverse((o) => { if (!o.matrixWorld.elements.every(Number.isFinite)) ok = false }); return ok }
      // Standing, before the first walk.
      run(0.4, 1 / 60)
      const start = v.pos.clone()
      // Setting off: it gathers itself (a crouch, hardly moving), then goes.
      let dip = 1, gatherMove = 0, t0 = null
      run(1.2, 1 / 60, () => {
        if (v.state !== 'walk') return
        t0 ??= run.t
        if (run.t - t0 < 0.15) gatherMove = v.pos.distanceTo(start), dip = Math.min(dip, fig.pose.scale.y)
      })
      // Walking: planted feet stay put, the spine twists, parts flop.
      let slide = 0, twist = 0, chest = 0, flop = 0, arm = 0, steps = 0
      const last = [new THREE.Vector3(), new THREE.Vector3()], down = [false, false]
      run(3, 1 / 60, () => {
        if (v.state !== 'walk' || v.walk < 0.9) return void (down[0] = down[1] = false)
        fig.feet.forEach((f, k) => {
          f.getWorldPosition(world)
          const planted = world.y < 1e-5
          if (planted && down[k]) slide = Math.max(slide, Math.hypot(world.x - last[k].x, world.z - last[k].z))
          if (planted && !down[k]) steps++
          down[k] = planted
          last[k].copy(world)
        })
        twist = Math.max(twist, Math.abs(fig.pose.rotation.y))
        chest = Math.max(chest, Math.abs(fig.soft.chest.rotation.y))
        flop = Math.max(flop, flopAngle())
        arm = Math.max(arm, Math.abs(fig.hands[0].position.z - fig.hands[0].userData.rest.z))
      })
      const walkedFinite = finite()
      // Arrived and standing a while: everything settles.
      while (v.state === 'walk' && run.t < 60) run(0.5, 1 / 60)
      run(2.5, 1 / 60)
      const settled = { state: v.state, flop: flopAngle(), spine: Math.abs(fig.soft.waist.rotation.x) + Math.abs(fig.soft.chest.rotation.y), twist: Math.abs(fig.pose.rotation.y) }
      // Long frames (a busy machine), through another walk: nothing blows up, and no flop folds back on itself.
      let wild = 0
      run(12, 0.05, () => (wild = Math.max(wild, flopAngle())))
      out.push({ name: fig.root.name, report, dip, gatherMove, slide, steps, twist, chest, flop, arm, settled, wild, finite: walkedFinite && finite() })
    }
    return out
  })
  for (const p of plush) {
    const r = p.report
    check(`${p.name}: the felt is skinned to hips, waist, chest, head, two hands and at least one flop bone`, r && r.skinned >= 3 && r.flops >= 1 && r.bones === 6 + r.flops, r)
    check(`${p.name}: every vertex's weights sum to 1, and skinning moves no vertex at rest`, r && r.weightError < 1e-5 && r.restError < 1e-5, r)
    check(`${p.name}: setting off, it gathers first (squashes below 0.97 while moving under 1 cm in the first 0.15 s)`, p.dip < 0.97 && p.gatherMove < 0.01, { dip: p.dip, move: p.gatherMove })
    check(`${p.name}: walking, a planted foot never slides (under 0.1 mm a frame over ${p.steps} steps)`, p.steps >= 4 && p.slide < 1e-4, { slide: p.slide, steps: p.steps })
    check(`${p.name}: walking, the hips twist, the chest answers, the arms swing and the floppy parts trail`, p.twist > 0.1 && p.chest > 0.05 && p.arm > 0.04 && p.flop > 0.03, { twist: p.twist, chest: p.chest, arm: p.arm, flop: p.flop })
    check(`${p.name}: at its chore 2.5 s after arriving, the walk's twist is gone and the floppy parts only sway with the work (under 0.12 rad)`, p.settled.state !== 'walk' && p.settled.flop < 0.12 && p.settled.twist < 0.01, p.settled)
    check(`${p.name}: at 20 frames a second everything stays finite and no flop bends past 0.8 rad`, p.finite && p.wild < 0.8, { finite: p.finite, wild: p.wild })
  }

  // Generated villagers (#47): a model-written body, the trusted kit and the sewn skin, softened by the same code.
  for (const [name, file, opts] of [['round 3 heron', 'round3-heron.code.txt', { species: true, accent: '#e0b53a' }], ['round 1 tortoise', 'round1-tortoise.code.txt', { species: true }], ['round 1 frog', 'round1-frog.code.txt', { species: true, accent: '#3d7cc8' }]]) {
    for (const skin of [true, false]) {
      const r = await page.evaluate(([c, o]) => window.villagerGen.trial(c, o), [fixture(file), { kit: false, ...opts, skin }])
      const s = r.soft
      check(`${name}, ${skin ? 'sewn skin' : 'separate parts'}: passes its checks and is skinned (weights sum to 1, nothing moves at rest)`, r.ok && s && s.skinned >= 1 && s.weightError < 1e-5 && s.restError < 1e-5, r.ok ? s : r.reason)
    }
  }
  check('no page errors', errors.length === 0, errors)
} finally {
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length} of ${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
