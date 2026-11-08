// Headless proof of a theme written from a sentence (#50): check() against hostile
// data, village.theme.ask() applying a theme live, refusals and failures leaving the
// current theme, and the host's token. Starts its own villager host (stub themer, stub
// router) and dev server on a throwaway VILLAGE_ROOT, and stops both at the end.
// Usage: node scripts/check-theme-ask.mjs [--dev=5373] [--host=5377]
//   --agent=claude [--theme-model=sonnet|haiku] [--shots=dir]: five real sentences
//     at ?q=high instead, timed from the call to the applied frame.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(process.env.VILLAGE_SCRATCH ?? tmpdir(), 'theme-ask-'))
const hostPort = Number(opt('host') ?? 5377)
const devPort = Number(opt('dev') ?? 5373)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  if (process.env.LIVE) console.error(pass ? 'pass' : 'FAIL', name, pass ? '' : JSON.stringify(detail)?.slice(0, 600))
}
const children = new Set()

function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.slice(-400)}`)), 30_000)
    child.stdout.on('data', (d) => {
      out += d
      if (ready.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    })
    child.stderr.on('data', (d) => (out += d))
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${out.slice(-400)}`)))
  })
}
const stop = (child) => new Promise((resolve) => {
  if (!children.has(child)) return resolve()
  child.once('exit', resolve)
  process.kill(-child.pid, 'SIGTERM')
})

const model = opt('theme-model') ?? 'sonnet'
await run('node', ['src/villager-cli.ts', '--agent', agent, '--theme-model', model, '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
// #40: each person has their own token; the page takes Alex's from the link the host prints (#token=…).
const { tokens } = JSON.parse(await readFile(join(root, 'villager', 'launch.json'), 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

async function open(page, query) {
  await page.goto(`${base}${query}${/talk=/.test(query) ? '' : (query ? '&' : '?') + 'talk=off&build=0'}#token=${tokens.alex}`)
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => typeof window.village?.theme?.ask === 'function')
  await page.waitForTimeout(500)
}
/** Asks in the page and waits two frames after setTheme, so the new look has rendered. */
const ask = (page, text) => page.evaluate(async (text) => {
  const t0 = performance.now()
  const r = await window.village.theme.ask(text)
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  // A switch blends in (1.5 s) or holds the last frame while postfx rebuilds; wait until it has landed.
  const until = performance.now() + 8000
  while (window.village.theme.switching?.() && performance.now() < until) await new Promise((done) => setTimeout(done, 50))
  return { ...r, appliedMs: Math.round(performance.now() - t0) }
}, text)
const current = (page) => page.evaluate(async () => {
  const { theme } = await import('/src/theme/index.ts')
  return theme()
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  if (agent === 'claude') {
    const shots = opt('shots')
    if (shots) await mkdir(shots, { recursive: true })
    await open(page, '?q=high')
    const sentences = ['make it cyberpunk', 'make it cozier, more autumn', 'a hand-painted pastoral summer afternoon', 'make it look like a comic book', 'go back to normal']
    const rows = []
    for (const text of sentences) {
      const r = await ask(page, text)
      await page.waitForTimeout(1500)
      const slug = text.replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
      if (shots) await page.screenshot({ path: join(shots, `ask-${model}-${slug}.jpg`), quality: 85 })
      rows.push({ text, ...r })
      console.error(JSON.stringify({ text, ...r }))
    }
    const t = await current(page)
    console.log(JSON.stringify({ model, rows, last: t.id, errors }, null, 1))
  } else {
    await open(page, '?q=low')

    // ── check() against hostile data, in the page (the painters need a browser) ──
    const unit = await page.evaluate(async () => {
      const { checkTheme, check } = await import('/src/theme/check.ts')
      const { HOME } = await import('/src/theme/presets/home.ts')
      const { NEON_NIGHT } = await import('/src/theme/presets/neon-night.ts')
      const { COMIC } = await import('/src/theme/presets/comic.ts')
      const { PASTORAL } = await import('/src/theme/presets/pastoral.ts')
      const { BLUE_HOUR } = await import('/src/theme/presets/blue-hour.ts')
      const { SIXTEEN_BIT } = await import('/src/theme/presets/sixteen-bit.ts')
      const out = {}
      const strip = (t) => ({ ...t, id: '', label: '', about: '' })
      const same = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k])))
      // JSON.parse makes __proto__ an own key, as a model's JSON would.
      const proto = checkTheme(JSON.parse('{"__proto__": {"polluted": true}, "light": {"__proto__": {"exposure": 9}, "exposure": 1.1}, "surfaces": {"constructor": {"prototype": {"bad": 1}}}}'))
      out.proto = { ok: 'theme' in proto, polluted: ({}).polluted, own: Object.keys(proto.theme ?? {}), protoOf: Object.getPrototypeOf(proto.theme) === Object.prototype, exposure: proto.theme?.light.exposure }
      const nan = checkTheme({ light: { exposure: NaN, key: { gain: Infinity, tint: -Infinity } }, post: { grain: 'NaN', bloom: { strength: null } } })
      out.nan = { exposure: nan.theme.light.exposure, key: nan.theme.light.key, grain: nan.theme.post.grain, bloom: nan.theme.post.bloom.strength, clamped: nan.clamped }
      const huge = checkTheme({ light: { exposure: 1e308, key: { gain: 1e9 } }, post: { grade: { saturation: 1e9, contrast: -1e9, lift: [1, 1, 1] } }, motion: { characterFps: 1e6 } })
      out.huge = { exposure: huge.theme.light.exposure, gain: huge.theme.light.key.gain, grade: huge.theme.post.grade, fps: huge.theme.motion.characterFps }
      const stages = checkTheme({ post: { stages: [{ kind: 'eval', code: 'alert(1)' }, { kind: 'halftone', cell: 1e5, angle: 30, strength: 0.5, ink: 'red' }, { kind: 'ink', width: 2, depth: 0.5, normal: 0.5, onload: 'x' }, ...Array(20).fill({ kind: 'brush', radius: 3, strength: 0.5 })] } })
      out.stages = { kinds: stages.theme.post.stages.map((s) => s.kind), halftone: stages.theme.post.stages[0], inkKeys: Object.keys(stages.theme.post.stages[1] ?? {}), clamped: stages.clamped }
      const palette = checkTheme({ post: { stages: [{ kind: 'pixel', height: 200, dither: 0.05, palette: Array.from({ length: 10_000 }, (_, i) => '#' + (i * 4099 % 0xffffff).toString(16).padStart(6, '0')) }] } })
      out.palette = palette.theme.post.stages[0]?.palette.length
      const words = checkTheme({ id: '../../etc/passwd', label: '<script>alert(1)</script>' + 'x'.repeat(500), about: 'fine\u0000\n\u2028<img src=x onerror=alert(1)>', costumes: { hint: 42 }, props: { hint: 'y'.repeat(5000) }, surfaces: { wall: { paint: 'javascript:alert(1)', color: '#ABCDEF' }, view: { paint: 'night-city' }, floor: { color: 'rgb(1,2,3)' } }, post: { veto: ['traa', 'everything', '__proto__'] } })
      out.words = { id: words.theme.id, label: words.theme.label, about: words.theme.about, costume: words.theme.costumes.hint === HOME.costumes.hint, props: words.theme.props.hint.length, wall: words.theme.surfaces.wall, view: words.theme.surfaces.view, floor: words.theme.surfaces.floor, veto: words.theme.post.veto }
      out.refuse = [check(null), check([1]), check('theme'), check(7)].map((r) => typeof r)
      const empty = checkTheme({})
      out.emptyIsHome = JSON.stringify(strip(empty.theme)) === JSON.stringify(strip(HOME)) && empty.clamped.length === 0
      out.fresh = empty.theme.post.warm !== HOME.post.warm && empty.theme.light !== HOME.light && empty.theme.post.stages !== HOME.post.stages
      const input = { light: { exposure: 1 } }
      const fromInput = check(input)
      out.notInput = fromInput !== input && fromInput.light !== input.light
      out.presets = [NEON_NIGHT, SIXTEEN_BIT, HOME, COMIC, PASTORAL, BLUE_HOUR].map((p) => { const r = checkTheme(p); return same(r.theme, p) && r.clamped.length === 0 })
      return out
    })
    check('check: __proto__ keys neither pollute nor survive', unit.proto.ok && unit.proto.polluted === undefined && unit.proto.protoOf && !unit.proto.own.includes('__proto__') && unit.proto.exposure === 1.1, unit.proto)
    check('check: NaN, Infinity, null and "NaN" fall back to the home and are noted', unit.nan.exposure === 1.25 && Object.keys(unit.nan.key).length === 0 && unit.nan.grain === 0.14 && unit.nan.bloom === 0.42 && unit.nan.clamped.length === 5, unit.nan)
    check('check: huge numbers clamp', unit.huge.exposure === 3 && unit.huge.gain === 4 && unit.huge.grade.saturation === 2.5 && unit.huge.grade.contrast === 0.5 && unit.huge.grade.lift.every((v) => v === 0.1) && unit.huge.fps === 60, unit.huge)
    check('check: unknown stage kinds and keys dropped, stages capped at 6 before checking', unit.stages.kinds.length === 5 && !unit.stages.kinds.includes('eval') && unit.stages.halftone.cell === 400 && !('ink' in unit.stages.halftone) && !unit.stages.inkKeys.includes('onload') && unit.stages.clamped.includes('post.stages[0]'), unit.stages)
    check('check: a 10,000-colour palette is cut to 64', unit.palette === 64, unit.palette)
    check('check: strings one line and short, ids slugged, painters and vetoes from lists', /^[a-z][a-z0-9-]*$/.test(unit.words.id) && unit.words.label.length === 40 && !/[\u0000-\u001f\u2028]/.test(unit.words.about) && unit.words.costume && unit.words.props === 200 && !('paint' in unit.words.wall) && unit.words.wall.color === '#abcdef' && unit.words.view.paint === 'night-city' && !('color' in unit.words.floor) && JSON.stringify(unit.words.veto) === '["traa"]', unit.words)
    check('check: non-objects are refused with a reason', unit.refuse.every((t) => t === 'string'), unit.refuse)
    check('check: {} is the home, with nothing clamped', unit.emptyIsHome, unit)
    check('check: the output is fresh, sharing nothing with the input or HOME', unit.fresh && unit.notInput, unit)
    check('check: every built-in look passes through unchanged', unit.presets.every(Boolean), unit.presets)

    // ── ask() in the page against the stub themer ──
    const before = await current(page)
    const cool = await ask(page, 'make it cyberpunk')
    const afterCool = await current(page)
    const snap = await page.evaluate(() => window.village.snapshot())
    check('ask: applies a theme live', cool.ok && /^written-stub-cool-[a-z0-9]+$/.test(afterCool.id) && cool.id === afterCool.id && afterCool.light.exposure === 1 && afterCool.surfaces.wall.color === '#304060' && snap.plugins.active.includes('theme'), { cool, id: afterCool.id, active: snap.plugins.active })
    check('ask: a partial theme is filled from the home', afterCool.post.bloom.strength === 0.42 && afterCool.surfaces.floor && typeof afterCool.fog === 'object', afterCool.post)
    check('ask: returns a note and the prop and costume hints', cool.note === 'Cooler light and deeper shadows.' && cool.hints.props === 'cool blue enamel' && cool.hints.costumes === 'blue wool', cool)

    const hostile = await ask(page, 'make it [stub-theme-hostile]')
    const afterHostile = await current(page)
    const polluted = await page.evaluate(() => ({}).polluted)
    check('ask: a hostile answer is clamped before it is applied', hostile.ok && hostile.clamped.length >= 10 && afterHostile.light.exposure === 3 && afterHostile.light.key.gain === 4 && !('color' in afterHostile.light.key) && afterHostile.post.stages.length === 1 && afterHostile.post.stages[0].palette.length === 64 && afterHostile.post.stages[0].height === 720 && afterHostile.label.length === 40 && afterHostile.motion.characterFps === 60 && polluted === undefined && !('paint' in afterHostile.surfaces.wall), { hostile, theme: afterHostile })

    const junk = await ask(page, 'make it [stub-theme-junk]')
    const afterJunk = await current(page)
    check('ask: an answer that is not a theme is refused and leaves the current theme', !junk.ok && junk.why === 'failed' && afterJunk.id === afterHostile.id && JSON.stringify(afterJunk) === JSON.stringify(afterHostile), junk)

    const failed = await ask(page, 'make it [stub-theme-fail]')
    const afterFail = await current(page)
    check('ask: a failed model call leaves the current theme', !failed.ok && failed.why === 'failed' && JSON.stringify(afterFail) === JSON.stringify(afterHostile), failed)

    // A written look that claims a built-in's id gets its own: it does not become neon night.
    const impostor = await ask(page, 'make it [stub-theme-impostor]')
    const afterImpostor = await page.evaluate(async () => {
      const { theme, PRESETS } = await import('/src/theme/index.ts')
      return { id: theme().id, isNeon: theme() === PRESETS['neon-night'], current: window.village.theme.current(), marked: window.village.theme.list().filter((l) => l.current).map((l) => l.id), last: JSON.parse(localStorage.getItem('village.theme.last') ?? 'null') }
    })
    check('ask: a written look claiming id "neon-night" gets its own id and is not neon night', impostor.ok && impostor.id.startsWith('written-neon-night-') && afterImpostor.id === impostor.id && !afterImpostor.isNeon && afterImpostor.current === impostor.id && afterImpostor.marked.length === 0 && afterImpostor.last !== 'neon-night', { impostor, afterImpostor })

    const normal = await ask(page, 'go back to normal')
    const afterNormal = await current(page)
    check('ask: back to normal is the home again', normal.ok && afterNormal.id === 'home' && afterNormal.post.stages.length === 0 && afterNormal.light.exposure === before.light.exposure, normal)

    // A checked look whose post chain cannot be built (the hostile answer's pixel stage, from
    // the home: a rebuild): ask() waits for the switch and reports it, and the home stays.
    await page.evaluate(() => window.village.kernel.failNextPrepare())
    const unbuilt = await ask(page, 'make it [stub-theme-hostile]')
    const afterUnbuilt = await page.evaluate(async () => {
      const { theme } = await import('/src/theme/index.ts')
      return { shown: theme().id, current: window.village.theme.current(), report: window.village.theme.lastSwitch(), last: window.village.theme.asked().at(-1) }
    })
    check('ask: a look whose chain cannot be built is reported as not built and leaves the home', !unbuilt.ok && unbuilt.why === 'unbuilt' && unbuilt.reason === 'the look could not be built' && afterUnbuilt.shown === 'home' && afterUnbuilt.current === 'home' && afterUnbuilt.report.failed && !afterUnbuilt.last.ok, { unbuilt, afterUnbuilt })

    // ── The host: token, person, shape ──
    const { port } = JSON.parse(await readFile(join(root, 'villager', 'launch.json'), 'utf8'))
    const token = tokens.alex
    const post = (path, body, auth) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }).then((r) => r.status)
    const statuses = {
      none: await post('/people/alex/theme', { text: 'make it cozier' }),
      wrong: await post('/people/alex/theme', { text: 'make it cozier' }, `Bearer ${'0'.repeat(64)}`),
      right: await post('/people/alex/theme', { text: 'make it cozier' }, `Bearer ${token}`),
      stranger: await post('/people/zed/theme', { text: 'make it cozier' }, `Bearer ${token}`),
      otherPerson: await post('/people/alex/theme', { text: 'make it cozier' }, `Bearer ${tokens.sam}`),
      empty: await post('/people/alex/theme', { text: '' }, `Bearer ${token}`),
      badCurrent: await post('/people/alex/theme', { text: 'cozier', current: [1] }, `Bearer ${token}`),
    }
    check('host: the token is required', statuses.none === 401 && statuses.wrong === 401 && statuses.right === 200, statuses)
    check('host: a token opens only its own person (#40), and a checked request shape', statuses.stranger === 403 && statuses.otherPerson === 403 && statuses.empty === 400 && statuses.badCurrent === 400, statuses)
    const log = (await readFile(join(root, 'people', 'alex', 'themes.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    check('host: each call is logged with its outcome', log.some((l) => l.refused) && log.some((l) => l.failed) && log.filter((l) => l.id).length >= 3, log.map((l) => l.id ?? l.refused ?? l.failed))

    // ── The always-on input: "make it cozier" goes to the theme route ──
    {
      await open(page, '?q=low&talk=npc')
      const t0 = await current(page)
      await page.keyboard.type('make it cozier', { delay: 0 })
      await page.keyboard.press('Enter')
      let s
      for (let i = 0; i < 100; i++) {
        s = await page.evaluate(() => ({ routes: window.village.talk.state().input.routes, asked: window.village.theme.asked() }))
        if (s.asked.length) break
        await page.waitForTimeout(100)
      }
      const t1 = await current(page)
      check('input: "make it cozier" is routed to the theme and applied', s.routes.at(-1)?.route === 'theme' && s.asked.at(-1)?.ok && t0.id === 'home' && t1.id.startsWith('written-stub-cool-'), s)
    }

    check('no page errors', errors.length === 0, errors)
  }
  await page.close()
} finally {
  await browser.close()
  for (const child of [...children]) await stop(child)
  await rm(root, { recursive: true, force: true })
}

if (agent !== 'claude') {
  for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)?.slice(0, 800)}`}`)
  const failed = checks.filter((c) => !c.pass).length
  console.log(`${checks.length - failed} of ${checks.length} passed`)
  process.exit(failed ? 1 : 0)
}
