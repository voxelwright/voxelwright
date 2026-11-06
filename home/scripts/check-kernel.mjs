// Headless proof of the kernel's failure and draw-pass rules.
// Usage: node scripts/check-kernel.mjs [base-url]   (dev server running)
// Exits non-zero when any check fails.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5181/'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const settle = () => page.waitForTimeout(300)

// 1 and 2: a plugin that registers effects and then throws, named in the page's plugin list.
await page.goto(`${base}?plugins=renderer,room,probe`)
const failed = await page.evaluate(async () => {
  const kernel = window.village.kernel
  const events = []
  kernel.root.on('village/plugin-error', (name, error) => events.push([name, String(error)]))
  const hooksBefore = () => window.village.snapshot().frameHooks
  await new Promise((r) => setTimeout(r, 500))
  const baselineHooks = hooksBefore()
  kernel.load({
    name: 'probe',
    inject: ['stage'],
    apply(ctx) {
      ctx.effect(() => {
        window.probeEffect = 'broken'
        return () => delete window.probeEffect
      })
      ctx.on('village/frame', () => {})
      throw new Error('probe is broken')
    },
  })
  const readiness = await window.village.ready(5000)
  await new Promise((r) => setTimeout(r, 200))
  const afterFailure = window.village.snapshot()
  const effectLeft = 'probeEffect' in window ? 'yes' : 'no'
  kernel.load({
    name: 'probe',
    inject: ['stage'],
    apply(ctx) {
      ctx.effect(() => {
        window.probeEffect = 'fixed'
        return () => delete window.probeEffect
      })
    },
  })
  const readinessFixed = await window.village.ready(5000)
  const afterFix = window.village.snapshot()
  return {
    events,
    readiness,
    readinessFixed,
    baselineHooks,
    afterFailure: { plugins: afterFailure.plugins, frameHooks: afterFailure.frameHooks, effectLeft },
    afterFix: { plugins: afterFix.plugins, effect: window.probeEffect },
  }
})
check('failure emits village/plugin-error', failed.events.length === 1 && failed.events[0][0] === 'probe', failed.events)
check('failure is logged to the console', consoleErrors.some((e) => e.includes('probe') && e.includes('failed to load')), consoleErrors.filter((e) => e.includes('probe')))
check('failed plugin is not registered', !failed.afterFailure.plugins.registered.includes('probe') && failed.afterFailure.plugins.failed.probe?.includes('probe is broken'), failed.afterFailure.plugins)
check('effects registered before the throw are released', failed.afterFailure.effectLeft === 'no' && failed.afterFailure.frameHooks === failed.baselineHooks, failed.afterFailure)
check('ready() reports the failure', failed.readiness.ok === false && failed.readiness.problems.probe?.state === 'failed', failed.readiness)
check('a fixed plugin under the same name loads', failed.afterFix.plugins.active.includes('probe') && !('probe' in failed.afterFix.plugins.failed) && failed.afterFix.effect === 'fixed', failed.afterFix)
check('ready() is ok after the fix', failed.readinessFixed.ok === true, failed.readinessFixed)

// 3: two draw passes unloaded out of order.
await page.goto(`${base}?plugins=renderer,room`)
const passes = await page.evaluate(async () => {
  const kernel = window.village.kernel
  await window.village.ready()
  const drawn = []
  const wrapper = (name) => ({
    name,
    inject: ['stage'],
    apply(ctx) {
      const { renderer, scene, camera } = ctx.stage
      ctx.effect(() => ctx.stage.addDrawPass(() => { drawn.push(name); renderer.render(scene, camera) }))
    },
  })
  const frame = () => new Promise((r) => setTimeout(r, 150))
  const last = async () => { drawn.length = 0; await frame(); return [drawn.at(-1) ?? 'plain', window.village.snapshot().drawPasses] }
  const log = {}
  kernel.load(wrapper('wrapA'))
  kernel.load(wrapper('wrapB'))
  await window.village.ready()
  log.bothLoaded = await last()
  await kernel.unload('wrapA')
  log.afterUnloadA = await last()
  await kernel.unload('wrapB')
  log.afterUnloadB = await last()
  return log
})
check('newest pass draws while both are loaded', passes.bothLoaded[0] === 'wrapB' && passes.bothLoaded[1] === 2, passes.bothLoaded)
check('unloading the older pass keeps the newer one', passes.afterUnloadA[0] === 'wrapB' && passes.afterUnloadA[1] === 1, passes.afterUnloadA)
check('unloading both restores the plain render', passes.afterUnloadB[0] === 'plain' && passes.afterUnloadB[1] === 0, passes.afterUnloadB)

await settle()
await browser.close()
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failures = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failures}/${checks.length} checks passed`)
if (failures) process.exitCode = 1
