// Headless proof of mechanics invented from a sentence (#106). "make a magnet" goes through the
// physics ask (the host's ruler, the page's checks, the sandbox, the engine's registry) and the
// magnet then works in the running world: steel marbles are pulled in, the felt ball is not, its
// count lives in the gadget's state and comes back with a snapshot. Undo takes everything away
// (toy, kind, frame) and puts back what the mechanic moved, also while its code is looping.
// Hostile code (loops, memory, deep calls, a forged answer, reaching for the page) is refused or
// stopped with no long task over 200 ms on the page, and what it says is held by the page's checks.
// With --agent=claude: each sentence in --asks goes to the real model (--invent-model) --trials
// times; latency, cost, and whether the mechanic built and acted are reported as they are.
// Usage: node scripts/check-invent.mjs [--dev=5430] [--host=5431] [--agent=claude] [--invent-model=sonnet] [--trials=1] [--asks="a|b"] [--shots-dir=dir] [--video-dir=dir] [--out=file.json]
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { pairLink } from './pairing.mjs'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const model = opt('invent-model') ?? 'sonnet'
const trials = Number(opt('trials') ?? 1)
const shotsDir = opt('shots-dir')
const videoDir = opt('video-dir')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(process.env.VILLAGE_SCRATCH ?? tmpdir(), 'invent-'))
const hostPort = Number(opt('host') ?? 5431)
const devPort = Number(opt('dev') ?? 5430)
const base = `http://localhost:${devPort}/`
const checks = []
const report = { agent, model: agent === 'stub' ? 'stub' : model, trials: [] }
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.error(pass ? 'pass' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 700) ?? '')
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
const q = (list, p) => (list.length ? +[...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))].toFixed(3) : null)

try {
  await run('node', ['src/villager-cli.ts', '--agent', agent, '--invent-model', model, '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
  await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
  if (shotsDir) await mkdir(shotsDir, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } } : {}) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  // Everything the sandbox frame asks the network for: its own document and nothing else.
  const boxRequests = []
  page.on('request', (r) => {
    const from = r.frame()?.url() ?? ''
    // A blob: URL is the worker script the relay made from text it was handed, not a fetch.
    if ((from.includes('mechanic-box') || (r.frame() && r.frame() !== page.mainFrame())) && !r.url().startsWith('blob:')) boxRequests.push(r.url())
  })
  await page.goto(await pairLink(base, root))
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => window.village?.physics?.made, null, { timeout: 30_000 })
  await page.evaluate(() => {
    window.longest = 0
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.longest = Math.max(window.longest, e.duration) }).observe({ entryTypes: ['longtask'] })
  })

  // What is built, registered and framed: Undo and every refusal must bring it back to this.
  const world = () => page.evaluate(() => {
    const p = window.village.physics
    return {
      census: { ...p.census(), draws: 0 }, kinds: p.engine.gadgetKinds().map((k) => k.kind).sort().join(), frames: document.querySelectorAll('iframe').length, mechanics: p.mechanics().length,
      rules: JSON.stringify(p.rules()), trial: p.made.state().trial?.id ?? null, kept: p.made.state().kept.join(), score: JSON.stringify(p.counters()), polluted: {}.polluted ?? null,
    }
  })
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const ask = (text) => page.evaluate((t) => window.village.physics.ask(t, { make: 'mechanic' }), text)
  const undo = () => page.evaluate(() => window.village.physics.made.undo())
  const mech = () => page.evaluate(() => window.village.physics.mechanics().at(-1) ?? null)
  const tag = () => page.evaluate(() => window.village.physics.made.state().tag)
  /** The trial toy's things by part id: position and speed. */
  const parts = () => page.evaluate(() => {
    const p = window.village.physics, id = p.made.state().trial?.id
    return Object.fromEntries(p.engine.world.keys().filter((k) => id && k.startsWith(`${id}/`)).map((k) => [k.slice(id.length + 1), p.thing(k)]).map(([k, t]) => [k, { p: t.position, speed: Math.hypot(...t.velocity) }]))
  })
  const dist = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2])
  const look = async (on) => {
    const s = (await page.evaluate(() => window.village.physics.made.surfaces())).find((x) => x.id === on)
    const at = s?.at ?? [0, 0, 0]
    const eye = s?.id === 'table' ? [at[0] + 0.5, at[1] + 0.55, at[2] + 0.8] : [at[0] + 0.3, at[1] + 1.1, at[2] + 1.6]
    await page.evaluate(([eye, at]) => window.village.physics.look(eye, at), [eye, [at[0], at[1] + 0.05, at[2]]])
  }
  const baseline = await world()

  if (agent === 'stub') {
    // ── The magnet, end to end ───────────────────────────────────────────────
    const stepBefore = await page.evaluate(async () => { const p = window.village.physics; p.clearStats(); await new Promise((r) => setTimeout(r, 2000)); return p.stats().stepMs })
    await page.evaluate(() => (window.longest = 0))
    const r = await ask('make a magnet')
    // The first invention fetches the sandbox chunk and the interpreter: its longest page task is reported, not judged (it varies with load).
    report.firstLongestTaskMs = await page.evaluate(() => window.longest)
    const built = await world()
    check('"make a magnet" builds a toy with a new kind of gadget, on trial with a tag', r.ok && r.toy?.mechanic && built.trial && (await tag()) !== null, { ok: r.ok, toy: r.toy, reason: r.reason })
    check('its kind is in the gadget registry and its code is in one sealed frame', built.kinds.includes(r.toy?.mechanic?.kind) && built.frames === baseline.frames + 1 && (await page.evaluate(() => { const f = document.querySelector('iframe[src="/mechanic-box.html"]'); return f?.getAttribute('sandbox') === 'allow-scripts' })), { kinds: built.kinds, frames: built.frames })
    const start = await parts()
    await look(r.toy?.on)
    // Read soon after it appears: the villagers walk about and may brush the table.
    await page.waitForTimeout(1500)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, 'magnet.png') })
    const pulled = await parts()
    const near = (set, id) => dist(set[id], set.magnet)
    const marbles = ['marble-1', 'marble-2', 'marble-3']
    // Laid at 0.17 to 0.23 m; the first reading already comes after some pull, so the test is where they end up.
    check('the steel marbles are pulled to the magnet and the felt ball is left alone', marbles.every((m) => near(pulled, m) < 0.08) && near(pulled, 'felt-ball') > 0.15, { start: [...marbles, 'felt-ball'].map((m) => +near(start, m).toFixed(3)), pulled: [...marbles, 'felt-ball'].map((m) => +near(pulled, m).toFixed(3)) })
    const gid = `${built.trial}/pull`
    const caught = () => page.evaluate((gid) => ({ state: window.village.physics.snapshot().gadgets[gid]?.state, fired: window.village.physics.signals()[`${gid}.caught`] ?? 0 }), gid)
    await page.waitForFunction((gid) => (window.village.physics.snapshot().gadgets[gid]?.state.caught ?? 0) >= 1, gid, { timeout: 10_000 }).catch(() => {})
    const c1 = await caught()
    check('its touch counts a catch in the gadget\'s own state and fires its output', c1.state?.caught >= 1 && c1.fired >= 1, c1)
    // The state is the world's, not the sandbox's: a snapshot from before brings it back.
    const restored = await page.evaluate(async (gid) => {
      const p = window.village.physics
      const snap = p.snapshot()
      snap.gadgets[gid].state = { caught: 41 }
      p.restore(snap)
      await new Promise((r) => setTimeout(r, 500))
      return p.snapshot().gadgets[gid].state
    }, gid)
    check('a restored snapshot sets the mechanic\'s state, and the code carries on from it', restored.caught >= 41 && restored.caught < 60, restored)
    // Short windows: long enough for the pull to show, short enough that a passing villager does not.
    const tuned = await page.evaluate(async (gid) => {
      const p = window.village.physics, key = gid.replace(/pull$/, 'marble-1')
      const drift = async (pull) => {
        const ok = p.setKnob(gid, 'pull', pull)
        await new Promise((r) => setTimeout(r, 100))
        p.place(key, [0.15, 0.0125, 0.1])
        await new Promise((r) => setTimeout(r, 300))
        const l = p.thing(key).local
        return { ok, moved: +Math.hypot(l[0] - 0.15, l[2] - 0.1).toFixed(4) }
      }
      return { off: await drift(0), on: await drift(0.5) }
    }, gid)
    check('its declared knob tunes it live like any gadget\'s (pull 0: a marble put down stays; pull 0.5: it rolls in)', tuned.off.ok && tuned.off.moved < 0.004 && tuned.on.moved > 0.02, tuned)
    const spend = await page.evaluate(async () => { const p = window.village.physics; p.clearStats(); await new Promise((r) => setTimeout(r, 2000)); return { step: p.stats().stepMs, m: p.mechanics().at(-1).stats } })
    report.spend = { stepMsBefore: stepBefore, stepMsWith: spend.step, pageMs: { median: q(spend.m.pageMs, 0.5), p95: q(spend.m.pageMs, 0.95) }, sandboxMs: { median: q(spend.m.boxMs, 0.5), p95: q(spend.m.boxMs, 0.95) }, asks: { median: q(spend.m.asks, 0.5), max: q(spend.m.asks, 1) }, views: spend.m.views, skipped: spend.m.skipped }
    check('the mechanic costs the page under 0.5 ms a step at the median, and its sandbox answers within a step', report.spend.pageMs.median < 0.5 && report.spend.sandboxMs.median < 8 && spend.m.views > spend.m.skipped * 2, report.spend)
    check('Undo takes it all away: toy, kind and frame, back to the baseline', (await undo()) && same(await world(), baseline), { baseline, after: await world() })

    // ── Undo puts back what the mechanic moved ──────────────────────────────
    {
      // `undo`: Undo first, and read in the same task, before the world steps again.
      const loose = (atRest, undo) => page.evaluate(([atRest, undo]) => { const p = window.village.physics; if (undo) p.made.undo(); return Object.fromEntries(p.engine.world.keys().filter((k) => !k.startsWith('made-')).map((k) => [k, p.thing(k)]).filter(([, t]) => t.motion === 'dynamic' && t.toy !== 'bound' && t.toy !== 'followers' && (!atRest || Math.hypot(...t.velocity) < 0.005)).map(([k, t]) => [k, t.position])) }, [atRest, undo])
      await page.evaluate(() => window.village.physics.reset())
      await page.waitForTimeout(1500)
      // Only what is at rest now: a ball a villager just kicked is somewhere else by the time the mechanic arrives.
      const before = await loose(true)
      const r = await ask('[stub-invent-fling] a magnet')
      await page.waitForTimeout(350)
      const flung = await loose()
      const moved = Object.keys(before).filter((k) => Math.hypot(...before[k].map((v, i) => v - flung[k][i])) > 0.02)
      const after = await loose(false, true)
      const astray = Object.keys(before).filter((k) => Math.hypot(...before[k].map((v, i) => v - after[k][i])) > 0.03)
      check('a mechanic that throws the home\'s loose things about: Undo puts each back where it was', r.ok && moved.length >= 5 && astray.length === 0 && same(await world(), baseline), { loose: Object.keys(before).length, moved: moved.length, astray: astray.map((k) => [k, before[k], after[k]]) })
    }

    // ── Hostile code ─────────────────────────────────────────────────────────
    // Refused before anything is built: the world is exactly as it was.
    for (const [marker, words] of [['top-loop', /too long/], ['syntax', /did not load/], ['nothing', /no step/], ['unused', /nothing in it used/], ['flame', /can't have a flame/], ['off', /stand off/], ['knob', /knob/], ['junk', /./]]) {
      await page.evaluate(() => (window.longest = 0))
      const r = await ask(`[stub-invent-${marker}] a magnet`)
      const after = await world()
      check(`refused with nothing left behind (${marker})`, !r.ok && (marker === 'junk' || (r.toy && words.test(r.reason ?? ''))) && !/[<>]/.test(r.reason ?? '') && same(after, baseline), { why: r.why, reason: r.reason, after: same(after, baseline) ? 'baseline' : after })
    }
    // Built, then it goes bad: the mechanic is stopped, the page never stalls, Undo works.
    for (const marker of ['loop', 'bomb', 'string', 'deep', 'throw', 'big', 'late-loop']) {
      await page.evaluate(() => (window.longest = 0))
      const r = await ask(`[stub-invent-${marker}] a magnet`)
      await page.waitForFunction(() => window.village.physics.mechanics().at(-1)?.stopped, null, { timeout: 15_000 }).catch(() => {})
      const m = await mech()
      const said = await tag()
      const longest = await page.evaluate(() => window.longest)
      const ball = await page.evaluate(() => window.village.physics.thing('pinball/ball')?.position.every(Number.isFinite))
      const undone = await undo()
      const after = await world()
      check(`stopped with no long task over 200 ms, said on its tag, and undone (${marker})`, r.ok && m?.stopped && /It stopped/.test(said ?? '') && !/[<>]/.test(said ?? '') && longest < 200 && ball && undone && same(after, baseline), { ok: r.ok, reason: r.reason, stopped: m?.stopped, said, longest, lastError: m?.stats.lastError, after: same(after, baseline) ? 'baseline' : after })
    }
    {
      const r = await ask('[stub-invent-flaky] a magnet')
      await page.waitForTimeout(2000)
      const m = await mech()
      await undo()
      check('a mechanic that fails now and then, never three times in a row, keeps running', r.ok && !m?.stopped && m?.stats.errors > 10, { stopped: m?.stopped, errors: m?.stats.errors })
    }
    // The page's own watchdog: the worker's answers are dropped in the relay, so nothing in the sandbox reports a thing.
    {
      const r = await ask('make a magnet')
      await page.waitForTimeout(300)
      await page.frames().find((f) => f.url().includes('mechanic-box')).evaluate(() => { worker.onmessage = null })
      await page.waitForFunction(() => window.village.physics.mechanics().at(-1)?.stopped, null, { timeout: 8000 }).catch(() => {})
      const m = await mech()
      const said = await tag()
      const undone = await undo()
      check('a sandbox that stops answering is closed, said on its tag, and undone', r.ok && /stopped answering/.test(m?.stopped ?? '') && /It stopped/.test(said ?? '') && undone && same(await world(), baseline), { stopped: m?.stopped, said })
    }
    // The frame's own policy, asked from inside the frame (the code in the interpreter cannot ask at all).
    {
      await ask('make a magnet')
      const frame = page.frames().find((f) => f.url().includes('mechanic-box'))
      const inside = await frame.evaluate(() => Promise.all([fetch('/', { mode: 'no-cors' }).then(() => 'fetched', () => 'refused'), new Promise((r) => { try { const q = indexedDB.open('probe'); q.onsuccess = () => r('opened'); q.onerror = () => r('denied') } catch { r('denied') } })]).then(([net, store]) => ({ net, store, origin: self.origin })))
      await undo()
      check("the sandbox frame's own policy refuses the network and storage, and its origin is opaque", inside.net === 'refused' && inside.store === 'denied' && inside.origin === 'null', inside)
    }
    // A snapshot from an earlier clock: the code is never told a call stands for no time or less.
    {
      const r = await ask('[stub-invent-h] a magnet')
      const gid = `${(await world()).trial}/pull`
      const minh = await page.evaluate(async (gid) => {
        const p = window.village.physics
        const snap = p.snapshot()
        await new Promise((r) => setTimeout(r, 1200))
        p.restore(snap)
        await new Promise((r) => setTimeout(r, 400))
        return p.snapshot().gadgets[gid]?.state.minh
      }, gid)
      await undo()
      check('after a snapshot from an earlier clock is restored, a call still stands for a positive time', r.ok && minh > 0.01, { minh })
    }
    // Undo while the code is looping, before anything has noticed.
    {
      const r = await ask('[stub-invent-loop] a magnet')
      const undone = await undo()
      const after = await world()
      check('Undo works at once while the code is still looping', r.ok && undone && same(after, baseline), { after: same(after, baseline) ? 'baseline' : after })
    }
    // Nothing of the page exists inside the interpreter.
    {
      const r = await ask('[stub-invent-reach] a magnet')
      const id = (await world()).trial
      await page.waitForFunction((gid) => window.village.physics.snapshot().gadgets[gid]?.state.reached !== undefined, `${id}/pull`, { timeout: 5000 }).catch(() => {})
      const state = await page.evaluate((gid) => window.village.physics.snapshot().gadgets[gid]?.state, `${id}/pull`)
      await undo()
      check('the code finds no window, document, fetch, storage, postMessage, timers or worker globals', r.ok && state?.reached === 0, state)
    }
    // A forged answer: everything in it is data, and the checks hold it.
    {
      await page.evaluate(() => window.village.physics.reset())
      const fridge = () => page.evaluate(() => { const p = window.village.physics; const k = p.engine.world.keys().find((k) => /fridge/.test(k)); return k ? p.thing(k).position : null })
      const f0 = await fridge()
      const r = await ask('[stub-invent-wild] a magnet')
      const id = (await world()).trial
      await page.waitForFunction(() => (window.village.physics.mechanics().at(-1)?.stats.refused ?? 0) > 1000, null, { timeout: 8000 }).catch(() => {})
      const seen = await page.evaluate((gid) => {
        const p = window.village.physics, w = p.engine.world
        const moving = w.keys().map((k) => p.thing(k)).filter((t) => t.motion === 'dynamic')
        return { state: p.snapshot().gadgets[gid]?.state, stats: p.mechanics().at(-1).stats, stopped: p.mechanics().at(-1).stopped, maxSpeed: p.rules().maxSpeed, fastest: Math.max(...moving.map((t) => Math.hypot(...t.velocity))), lowest: Math.min(...moving.map((t) => t.position[1])), widest: Math.max(...moving.map((t) => Math.abs(t.position[0]))), shown: [...document.querySelectorAll('img')].length }
      }, `${id}/pull`)
      const mid = await world()
      const f1 = await fridge()
      check('a forged answer: unknown and fixed things, wild numbers, other gadgets, rules and unknown commands are refused; state keeps numbers only', r.ok && same(seen.state, { ok: 1 }) && seen.stats.refused > 1000 && seen.stats.commands > 0 && seen.fastest <= seen.maxSpeed + 0.5 && seen.lowest > -1 && seen.widest < 50 && mid.rules === baseline.rules && mid.score === baseline.score && mid.polluted === null && same(f0, f1), { ...seen, stats: { ...seen.stats, pageMs: undefined, boxMs: undefined, asks: undefined }, rules: mid.rules === baseline.rules, score: mid.score === baseline.score, fridge: same(f0, f1) })
      await undo()
      await page.evaluate(() => window.village.physics.reset())
      check('and Undo leaves the baseline', same(await world(), baseline), await world())
    }
    {
      const r = await ask('[stub-invent-wild-once] a magnet')
      await page.waitForTimeout(1000)
      const m = await mech()
      await undo()
      await page.evaluate(() => window.village.physics.reset())
      check('each forged command is checked on its own: 2 of 17 applied, 15 refused', r.ok && m.stats.commands === 2 && m.stats.refused === 15, { commands: m.stats.commands, refused: m.stats.refused })
    }
    // Try another, then Undo: the home's things are where they were before the first mechanic, not where it threw them.
    {
      const at = (undo) => page.evaluate((undo) => { const p = window.village.physics; if (undo) p.made.undo(); return Object.fromEntries(p.engine.world.keys().filter((k) => !k.startsWith('made-')).map((k) => [k, p.thing(k)]).filter(([, t]) => t.motion === 'dynamic' && t.toy !== 'bound' && t.toy !== 'followers' && (undo || Math.hypot(...t.velocity) < 0.005)).map(([k, t]) => [k, t.position])) }, undo)
      await page.waitForTimeout(1500)
      const before = await at(false)
      await ask('[stub-invent-fling] a magnet')
      await page.waitForTimeout(350)
      await page.evaluate(() => window.village.physics.made.another())
      await page.waitForTimeout(350)
      const after = await at(true)
      const astray = Object.keys(before).filter((k) => Math.hypot(...before[k].map((v, i) => v - after[k][i])) > 0.03)
      check('Try another and then Undo puts back what both mechanics threw', Object.keys(before).length >= 5 && astray.length === 0 && same(await world(), baseline), { things: Object.keys(before).length, astray })
      await page.evaluate(() => window.village.physics.reset())
    }

    // ── Keep and Try another ────────────────────────────────────────────────
    {
      const first = await ask('make a magnet')
      const again = await page.evaluate(() => window.village.physics.made.another())
      const second = await world()
      check('Try another replaces a mechanic with a new one: one frame, one new kind, the old gone', first.ok && again?.ok && second.frames === baseline.frames + 1 && second.mechanics === 1 && second.trial !== first.toy.id && !second.kinds.includes(first.toy.mechanic.kind), { again, frames: second.frames, mechanics: second.mechanics, kinds: second.kinds })
      const views = (await mech()).stats.views
      const kept = await page.evaluate(() => window.village.physics.made.keep())
      await page.waitForTimeout(600)
      const m = await mech()
      check('Keep leaves it running with no tag', kept && (await tag()) === null && !m.stopped && m.stats.views > views + 10 && (await world()).census.toys === baseline.census.toys + 1, { kept, stopped: m.stopped, views: [views, m.stats.views] })
    }
    // From the notepad: the router's flag reaches the invent ask.
    {
      const n = await page.evaluate(() => window.village.physics.asked().length)
      await page.keyboard.press('Escape')
      await page.keyboard.type('make a magnet on the floor', { delay: 0 })
      await page.keyboard.press('Enter')
      let s
      for (let i = 0; i < 100; i++) {
        s = await page.evaluate((n) => ({ route: window.village.talk.state().input.routes.at(-1), asked: window.village.physics.asked().slice(n).at(-1) }), n)
        if (s.asked) break
        await page.waitForTimeout(100)
      }
      check('"make a magnet on the floor" typed on the notepad is invented', s.route?.route === 'physics' && s.asked?.as?.make === 'mechanic' && s.asked?.ok && s.asked?.toy?.mechanic, { route: s.route, asked: s.asked && { ok: s.asked.ok, as: s.asked.as, reason: s.asked.reason, toy: s.asked.toy } })
      await undo()
    }
    check('the sandbox frames asked the network for their own document and nothing else', boxRequests.length > 0 && boxRequests.every((u) => u === `${base}mechanic-box.html`), [...new Set(boxRequests)])
    // Last: the kept mechanic is still running, and unloading physics must close its sandbox.
    {
      const open = await page.evaluate(() => document.querySelectorAll('iframe').length)
      await page.evaluate(() => window.village.kernel.unload('physics'))
      const left = await page.evaluate(() => document.querySelectorAll('iframe').length)
      check('unloading physics closes every mechanic sandbox', open === baseline.frames + 1 && left === baseline.frames, { open, left })
    }
  } else {
    // ── A real model writes real mechanics ──────────────────────────────────
    const asks = (opt('asks') ?? 'make a magnet|a fan that blows things across the table|gravity that points at the candle|a pad that flings whatever lands on it').split('|')
    for (const text of asks) for (let i = 0; i < trials; i++) {
      await page.evaluate(() => { window.village.physics.reset(); window.longest = 0 })
      const r = await ask(text)
      const trial = { text, ok: r.ok, ms: r.ms, hostMs: r.hostMs, models: r.models, costUsd: r.costUsd, outputTokens: r.outputTokens, reason: r.reason, note: r.note, toy: r.toy && { label: r.toy.label, on: r.toy.on, parts: r.toy.parts, clamped: r.toy.clamped, mechanic: r.toy.mechanic } }
      if (r.ok) {
        await look(r.toy.on)
        await page.waitForTimeout(4000)
        const m = await mech()
        Object.assign(trial, { stopped: m.stopped, views: m.stats.views, skipped: m.stats.skipped, commands: m.stats.commands, refused: m.stats.refused, errors: m.stats.errors, lastError: m.stats.lastError, pageMs: { median: q(m.stats.pageMs, 0.5), p95: q(m.stats.pageMs, 0.95) }, sandboxMs: { median: q(m.stats.boxMs, 0.5), p95: q(m.stats.boxMs, 0.95) }, asks: { median: q(m.stats.asks, 0.5), max: q(m.stats.asks, 1) }, longest: await page.evaluate(() => window.longest) })
        if (shotsDir) await page.screenshot({ path: join(shotsDir, `${text.replace(/[^a-z]+/gi, '-').slice(0, 40)}-${i + 1}.png`) })
        await page.evaluate(() => window.village.physics.look(null))
        const undone = await undo()
        trial.undone = undone && same(await world(), baseline)
      }
      report.trials.push(trial)
      console.error(JSON.stringify(trial))
    }
    const built = report.trials.filter((t) => t.ok), acted = built.filter((t) => !t.stopped && t.commands > 0)
    report.summary = { asked: report.trials.length, built: built.length, acted: acted.length, medianMs: q(built.map((t) => t.ms), 0.5), costUsd: +report.trials.reduce((s, t) => s + (t.costUsd ?? 0), 0).toFixed(4) }
    check(`the real model (${model}) wrote a mechanic that built and acted on the world`, acted.length >= 1, report.summary)
    check('every built mechanic was undone back to the baseline', built.every((t) => t.undone), built.map((t) => t.undone))
  }
  check('no page errors', errors.length === 0, errors)
  await context.close()
  await browser.close()
} catch (error) {
  check('the check ran', false, String(error?.stack ?? error).slice(0, 800))
} finally {
  for (const child of children) try { process.kill(-child.pid) } catch {}
}
const out = opt('out')
if (out) await writeFile(out, JSON.stringify({ checks, report }, null, 2))
const failed = checks.filter((c) => !c.pass)
console.log(JSON.stringify({ agent, model: report.model, passed: checks.length - failed.length, failed: failed.map((f) => f.name), spend: report.spend, firstLongestTaskMs: report.firstLongestTaskMs, summary: report.summary }, null, 2))
process.exit(failed.length ? 1 : 0)
