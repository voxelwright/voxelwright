// Cars that strike cars hard are not left inside each other, nor on each other (#72), in the real page with the real
// core in Chrome. A playtest on a phone left an SUV on another's roof and three cars wedged nose into tail: a drawn
// car came to life a frame or three after it was struck, with the car that struck it already a metre or two into
// it, and the solver could not part two hollow shells. Read from where the bodies are (`engine.alive.where`), by the
// telemetry's own measure of two outlines in each other (#64, page/recorder.ts `vehicle_overlap`: 0.4 m for 0.2 s,
// or 0.8 m at all).
//
//   node test/crash-stack.mjs [--sf <a built SF folder>] [--page <an engine folder whose page/ is served>] [--runs 3] [--fills 12] [--seconds 60] [--shots <dir>] [--ahead] [--headed]
//
// town   on the town's main street, four cars of the street's toughness: one at 150 km/h into the back of three
//        parked 0.8 m apart; then one that comes to life as the street's do (born out of the way, put where it was
//        drawn, pushed) with the car that struck it already in that place, and the next parked car just ahead. No
//        two are in each other for 0.2 s, none rises onto another, all rest apart on the road and drive away.
// sf     with a built San Francisco folder named (`--sf <folder>`: 6.6 GB, never made here), the street itself
//        (page/street.ts), this checkout's page and core served over the folder's: a car ridden at 150 km/h into
//        the first of a row of parked cars, watching every vehicle the solver moves and every one the street draws;
//        then the street filled again and again where the F line runs, and no car in a streetcar. `--page` serves
//        another checkout's page/ and core instead, to see it fail on the code before; `--shots` keeps a picture of
//        each pileup as it came to rest. Without `--sf` this part says it was not run: it does not pass.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, start, still, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const LASTS = 4, DEEP = 8, FOR = 0.2
// (The San Francisco part only where a built folder is named: a folder left in a checkout is not run by the gate.)
const parts = arg('parts', has('sf') ? 'town,sf' : 'town').split(',')
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to

/** What both parts measure with, set up in a page: outlines on the road, how far two are into each other, and a watch over a set of them. */
const measures = (drawnAhead) => {
  /** How far two outlines are into each other (cells; under 0 apart): each is { x, z, fx, fz, long, wide }, long and wide halved. */
  const into = (a, b) => {
    let gap = -Infinity
    for (const [ux, uz] of [[a.fx, a.fz], [-a.fz, a.fx], [b.fx, b.fz], [-b.fz, b.fx]]) {
      const reach = (o) => o.long * Math.abs(o.fx * ux + o.fz * uz) + o.wide * Math.abs(-o.fz * ux + o.fx * uz)
      gap = Math.max(gap, Math.abs((b.x - a.x) * ux + (b.z - a.z) * uz) - reach(a) - reach(b))
    }
    return -gap
  }
  /**
   * Watches what `outlines()` gives each frame (each with an `id`, a `y`, how high it is over its own road `h`, and
   * whether two of its kind may be asked about each other: `asks(a, b)`) for some seconds: the deepest any two were,
   * the longest any two stayed over `lasts` in, which two and how they stood then (`note`); and for how many frames
   * one was over another (their outlines 2 cells in each other, one 6 cells or more higher over its road than the
   * other over its own: on its roof, a car being 10 to 16 high).
   */
  const watch = (outlines, seconds, { lasts, each = () => {}, asks = () => true }) => new Promise((done) => {
    const seen = { deepest: 0, longest: 0, pair: '', deepPair: '', note: '', frames: 0, over: 0, overPair: '' }, since = new Map(), t0 = performance.now()
    const r1 = (v) => Math.round(v * 10) / 10, say = (o) => `${o.name} at ${Math.round(o.x)},${Math.round(o.z)} heading ${r1(Math.atan2(o.fz, o.fx))}${o.say ? ` ${o.say}` : ''}`
    const frame = () => {
      const now = performance.now(), all = outlines()
      each(all, now)
      seen.frames++
      const inNow = new Set()
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j]
        if (!asks(a, b) || Math.abs(a.x - b.x) > 200 || Math.abs(a.z - b.z) > 200 || Math.abs(a.y - b.y) > 14) continue
        const deep = into(a, b)
        if (deep > seen.deepest) { seen.deepest = deep; seen.deepPair = `${a.name} & ${b.name}` }
        if (deep > 2 && Math.abs(a.h - b.h) >= 6) { seen.over++; seen.overPair = `${a.name} & ${b.name}` }
        if (deep < lasts) continue
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`
        inNow.add(key)
        if (!since.has(key)) since.set(key, now)
        const long = (now - since.get(key)) / 1000
        if (long > seen.longest) { seen.longest = long; seen.pair = `${a.name} & ${b.name}`; if (!seen.noted || seen.noted !== key) { seen.noted = key; seen.note = `${r1(deep)} cells in, ${r1((now - t0) / 1000)} s into the watch: ${say(a)}; ${say(b)}` } }
      }
      for (const k of since.keys()) if (!inNow.has(k)) since.delete(k)
      if (now - t0 < seconds * 1000) requestAnimationFrame(frame); else done(seen)
    }
    requestAnimationFrame(frame)
  })
  // Where things are is read as the solver last said it, not as the page draws them on to the frame's time (#73,
  // main.ts `drawAhead`: up to 0.1 s further along the way they went): a car the solver has stopped is drawn, and
  // would be read, some cells into what stopped it for a frame or two. `--ahead` leaves the drawing on.
  if (!drawnAhead && 'ahead' in globalThis.engine) globalThis.engine.ahead = false
  globalThis.M = { into, watch }
}

// ── The town: the solver and the page's own calls ──
const { city, check, failures, finish } = await start()
if (parts.includes('town')) {
  console.log('town: cars of the street\'s toughness on the main street')
  const page = await city('fire=0&people=0&hour=11', { size: [1280, 720], dpr: 1 })
  await still(page)
  await page.evaluate(measures, has('ahead'))
  await page.evaluate(() => {
    const e = globalThis.engine, M = globalThis.M
    const T = globalThis.T = { cars: [], stands: [] }
    const floor = (x, z) => e.ground(x / 10, z / 10) * 10
    /** The engine's car (4.2 m, a glass cabin on a steel shell) as tough and fast as the street's SUV. Its middle goes at x, z. */
    T.making = (x, y, z) => { const m = e.car([Math.round(x) - 21, Math.round(y), Math.round(z) - 9]); m.motor = { ...m.motor, tough: 280, top: 420 }; return m }
    T.stand = async (x, z) => { T.cars.push(await e.alive.spawn(T.making(x, floor(x, z) + 5, z))); return T.cars.length - 1 }
    T.outline = (t, i) => { const w = e.alive.where(t); return w && { id: i, name: `car ${i}`, x: w.at[0], y: w.at[1], h: w.at[1] - floor(w.at[0], w.at[2]) - (T.stands[i] ?? 0), z: w.at[2], fx: w.front[0], fz: w.front[2], long: 21, wide: 9 } }
    T.outlines = () => T.cars.map(T.outline).filter(Boolean)
    /** Left to stand: how high each one's middle is over the road under it. */
    T.settled = () => { T.stands = T.cars.map((t) => { const w = e.alive.where(t); return w.at[1] - floor(w.at[0], w.at[2]) }) }
    /** Watches them all for some seconds, the first told to go so: what `M.watch` says, how fast the first went at most, and whether any broke. */
    T.watch = async (seconds, go) => {
      let fastest = 0, told = 0
      const seen = await M.watch(T.outlines, seconds, { lasts: 4, each: (all, now) => {
        if (now - told > 100) { told = now; e.alive.drive(T.cars[0], go, 0, 0) }
        fastest = Math.max(fastest, Math.abs(T.cars[0].state?.speed ?? 0))
      } })
      return { ...seen, fastest, broke: T.cars.filter((t) => !t.alive).length }
    }
    /** At rest: how far each is off where a car stands, the deepest any two are, and how far each goes when told to (forward 1.5 s, then back). */
    T.rest = async () => {
      const all = T.outlines(), off = all.map((a) => a.y - floor(a.x, a.z) - T.stands[a.id])
      let deepest = -Infinity
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) deepest = Math.max(deepest, M.into(all[i], all[j]))
      const went = []
      for (const t of T.cars) {
        const from = e.alive.where(t).at.slice()
        let far = 0
        for (const go of [1, -1]) {
          for (let k = 0; k < 15; k++) { e.alive.drive(t, go, 0, 0); await new Promise((r) => setTimeout(r, 100)) }
          const at = e.alive.where(t).at
          far = Math.max(far, Math.hypot(at[0] - from[0], at[2] - from[2]))
        }
        e.alive.drive(t, 0, 0, 0)
        went.push(far)
      }
      return { off, deepest, went }
    }
    T.clear = () => { for (const t of T.cars) e.alive.vanish(t); T.cars = []; T.stands = [] }
  })
  const judge = async (what, struck, { real }) => {
    const coast = await page.evaluate(() => globalThis.T.watch(3.5, 0))
    const seen = { deepest: Math.max(struck.deepest, coast.deepest), longest: Math.max(struck.longest, coast.longest), pair: struck.longest >= coast.longest ? struck.pair : coast.pair, over: struck.over + coast.over, overPair: struck.overPair || coast.overPair, broke: coast.broke }
    check(seen.broke === 0, `${what}: every car is whole`)
    // (Struck by a body the solver already has, they are never deep in each other; one put down in another is, until it is put clear.)
    if (real) check(seen.deepest < DEEP, `${what}: no two were ${DEEP} cells into each other (${round(seen.deepest)} at the deepest)`)
    check(seen.longest < FOR, `${what}: no two stayed ${LASTS} cells into each other for ${FOR} s (${round(seen.longest, 2)} s${seen.pair ? `, ${seen.pair}` : ''})`)
    check(seen.over === 0, `${what}: none was ever over another (${seen.over} frames${seen.overPair ? `, ${seen.overPair}` : ''})`)
    if (seen.broke) return
    const rest = await page.evaluate(() => globalThis.T.rest())
    check(rest.off.every((v) => Math.abs(v) < 2), `${what}: each rests on the road (${rest.off.map((v) => round(v)).join(', ')} cells off where a car stands)`)
    check(rest.deepest < 1.5, `${what}: at rest no two are in each other (${round(rest.deepest)} cells)`)
    check(rest.went.every((v) => v > 20), `${what}: each drives away when told (${rest.went.map((v) => round(v, 0)).join(', ')} cells in 1.5 s each way)`)
  }

  // One at 150 km/h into the back of three parked nose to tail, 0.8 m apart.
  await page.evaluate(async () => { const T = globalThis.T; for (const x of [800, 1100, 1150, 1200]) await T.stand(x, 4070) })
  await page.waitForTimeout(2500)
  const struck = await page.evaluate(async () => {
    const T = globalThis.T, e = globalThis.engine
    T.settled()
    e.alive.kick(T.cars[0], [420, 0, 0])
    return T.watch(3.5, 1)
  })
  check(struck.fastest >= 389, `the striker went ${round(struck.fastest * 0.36, 0)} km/h (140 or more)`)
  await judge('150 km/h into three', struck, { real: true })

  // One that comes to life as the street's cars do, the striker already where it was drawn.
  await page.evaluate(() => globalThis.T.clear())
  await page.evaluate(async () => { const T = globalThis.T; await T.stand(2000, 4070); await T.stand(2350, 4070) })
  await page.waitForTimeout(2500)
  const woken = await page.evaluate(async () => {
    const T = globalThis.T, e = globalThis.engine, spot = [2300, 4070]
    T.settled()
    e.alive.kick(T.cars[0], [420, 0, 0])
    // Until the striker's nose is at the drawn car's tail: then the street asks for it to live, and it does a frame or three on.
    await new Promise((done) => { const tick = () => { e.alive.drive(T.cars[0], 1, 0, 0); if (e.alive.where(T.cars[0]).at[0] + 21 >= spot[0] - 21) done(); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    const floor = e.ground(spot[0] / 10, spot[1] / 10) * 10, making = T.making(spot[0], floor + 3000, spot[1])
    const thing = await e.alive.spawn(making), born = e.alive.where(thing).at, into = e.alive.where(T.cars[0]).at[0] + 21 - (spot[0] - 21)
    e.alive.place(thing, [spot[0] + born[0] - making.low[0] - 21, floor + 1 + born[1] - making.low[1], spot[1] + born[2] - making.low[2] - 9], [0, 0, 0, 1])
    e.alive.kick(thing, [340, 6, 0])
    T.cars.splice(1, 0, thing)
    T.stands.splice(1, 0, T.stands[0])
    // (Two frames for the page to hear where the solver put it.)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return { ...(await T.watch(3.5, 1)), into }
  })
  console.log(`  the striker was ${round(woken.into)} cells into the drawn car's place when it came to life`)
  await judge('woken with the striker in its place', woken, { real: false })
  await page.context().close()
}

// ── San Francisco: the street's own waking, and its streetcars ──
const dist = resolve(arg('sf', join(here, 'dist-sf')))
if (!parts.includes('sf')) {
  console.log('sf: NOT RUN (pass --sf <a built San Francisco folder>): the street\'s own waking (page/street.ts) and its streetcars were not checked.')
} else if (!existsSync(join(dist, 'sf', 'index.html'))) {
  failures.push(`sf: no built San Francisco folder at ${dist}`)
} else {
  // Another checkout's page and core over the built folder's, each module stripped as sf/build.mjs strips it.
  const from = resolve(arg('page', here)), NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.(ts|mjs)\b/g
  const extra = (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path === '/sf/index.html') {
      const html = readFileSync(join(dist, 'sf/index.html'), 'utf8').replace(/\.\.\/assets\/main-[^"]+\.js/g, '../page/main.js')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(html)
      return true
    }
    const m = /^\/(page|make|blocks)\/([\w./-]+)\.(js|wasm)$/.exec(path)
    if (!m || m[2].includes('..')) return false
    const source = m[3] === 'wasm' ? join(from, m[1], `${m[2]}.wasm`) : [join(from, m[1], `${m[2]}.ts`), join(from, m[1], `${m[2]}.mjs`)].find((f) => existsSync(f) && statSync(f).isFile())
    if (!source || !existsSync(source)) return false
    const body = m[3] === 'wasm' ? readFileSync(source) : (source.endsWith('.ts') ? stripTypeScriptTypes(readFileSync(source, 'utf8'), { mode: 'strip' }) : readFileSync(source, 'utf8')).replace(NAMED, '$1$2$3.js')
    res.writeHead(200, { 'Content-Type': m[3] === 'wasm' ? 'application/wasm' : 'text/javascript', 'Cache-Control': 'no-store' })
    res.end(body)
    return true
  }
  const site = await plain(dist, '127.0.0.1', 0, { extra })
  const back = await turn()
  const browser = await chromium.launch(CHROME)
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  page.on('pageerror', (e) => failures.push(`sf page error: ${e.message}`))
  try {
    console.log(`sf: the street's own cars (${from === resolve(here) ? 'this checkout' : from} over ${dist})`)
    await page.goto(`${site.url}/sf/index.html?hour=12.5&people=0`)
    await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 180_000 })
    await page.evaluate(measures, has('ahead'))
    const settle = () => page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 120_000, polling: 250 }).catch(() => null)
    const go = async ([x, z], up = 1.7) => {
      await page.evaluate(([x, z, up]) => { const e = globalThis.engine; Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + up, pitch: up > 5 ? -0.6 : -0.1 }) }, [x, z, up])
      await page.waitForFunction(() => globalThis.engine.street?.ready, null, { timeout: 180_000 })
      // (The realm's first view is a still picture where no key means anything and street life sleeps: left for good once the eye has gone.)
      await page.evaluate(() => globalThis.engine.first?.engage())
      await settle()
    }
    // Each kept vehicle's half length and width by its base and variant-painted names (#74), from the library the page itself reads.
    const realm = JSON.parse(readFileSync(join(dist, 'sf/index.html'), 'utf8').match(/<script type="application\/json" id="realm">([^<]+)<\/script>/)[1])
    const COLOUR_PREFIX = /^(grey|gray|blue|red|white|black|silver|green|beige|navy|yellow|orange|brown|gold|tan)\s+/i
    const sizes = {}
    for (const c of JSON.parse(readFileSync(join(dist, 'sf', realm.street.cars, 'index.json'), 'utf8')).cars) {
      const dim = (c.front ?? 0) < 2 ? [c.size[0] / 2, c.size[2] / 2] : [c.size[2] / 2, c.size[0] / 2]
      sizes[c.name] = dim
      for (const v of c.variants ?? []) {
        const vn = v === 'taxi' ? 'yellow taxi' : COLOUR_PREFIX.test(c.name) ? c.name.replace(COLOUR_PREFIX, `${v} `) : `${v} ${c.name}`
        sizes[vn] ??= dim
      }
    }
    await page.evaluate((sizes) => {
      const e = globalThis.engine
      /** Every vehicle near a place as an outline: the solver's (alive), by where they are, and the street's drawn ones by their kind. */
      globalThis.S = { outlines: (x, z, r, since = 0) => {
        const all = []
        // (The solver's: those made since the striker, it among them. What the realm set down itself is not this check's.)
        for (const t of e.alive.things) { const w = t.alive && t.id >= since && e.alive.where(t); if (w && Math.hypot(w.at[0] - x, w.at[2] - z) < r) { const y = w.at[1] - t.size[1] / 2; all.push({ id: `t${t.id}`, name: `${t.name} (alive)`, kind: 'alive', x: w.at[0], y, h: y - e.feet(Math.round(w.at[0]), Math.round(w.at[2])), z: w.at[2], fx: w.front[0], fz: w.front[2], long: (t.motor.front < 2 ? t.size[0] : t.size[2]) / 2, wide: (t.motor.front < 2 ? t.size[2] : t.size[0]) / 2, say: `going ${Math.round(t.state?.speed ?? 0)}` }) } }
        const met = new Map()
        for (const c of e.street.cars(x, z, r)) {
          if (c.living || !sizes[c.name]) continue
          // (By its own number; in a checkout that gives none, a parked car by where it stands and the rest by their order.)
          const key = c.id !== undefined ? `c${c.id}` : c.kind === 'parked' ? `p${Math.round(c.x / 30)}_${Math.round(c.z / 30)}` : `${c.kind}${met.get(c.kind) ?? 0}`
          met.set(c.kind, (met.get(c.kind) ?? 0) + 1)
          all.push({ id: key, name: `${c.name} (${c.kind})`, kind: c.kind, x: c.x, y: c.y, h: 0, z: c.z, fx: Math.cos(c.heading), fz: Math.sin(c.heading), long: sizes[c.name][0], wide: sizes[c.name][1], say: `going ${Math.round(c.v)}${c.wait ? `, waits for ${c.wait}` : ''}${c.stuck > 1 ? `, stuck ${Math.round(c.stuck)} s` : ''}` })
        }
        return all
      } }
    }, sizes)

    // A parked car at the start of a row (the junction behind it, two or more parked beyond it in line), struck from
    // 30 m back along the row's own line at 150 km/h by a car ridden as any is.
    const worst = { deepest: 0, longest: 0, pair: '', deepPair: '', fastest: 0, woke: 0, stacked: 0, restDeep: 0, runs: 0, lost: 0, broke: 0 }
    const shots = arg('shots', '') && resolve(arg('shots', ''))
    if (shots) mkdirSync(shots, { recursive: true })
    const spots = [[529467, 662580], [522628, 664243], [519580, 668046], [515700, 663500], [533794, 667234]]
    for (let n = 0; n < spots.length && worst.runs < Number(arg('runs', '3')); n++) {
      await go(spots[n])
      await page.waitForTimeout(1500)
      const plan = await page.evaluate(([x, z]) => {
        const e = globalThis.engine, all = e.street.cars(x, z, 1800).filter((c) => c.kind === 'parked' && !c.living)
        let best = null
        for (const c of all) {
          if (c.model !== 'car') continue
          const fx = Math.cos(c.heading), fz = Math.sin(c.heading)
          for (const way of [1, -1]) {
            const rel = (o) => [((o.x - c.x) * fx + (o.z - c.z) * fz) * way, Math.abs((o.x - c.x) * fz - (o.z - c.z) * fx)]
            const on = all.filter((o) => { const [a, s] = rel(o); return o !== c && a > 30 && a < 200 && s < 25 }).length
            const behind = all.filter((o) => { const [a, s] = rel(o); return o !== c && a < -15 && a > -420 && s < 45 }).length
            if (on < 2 || behind) continue
            // The run-up: the road as level as it is at the car, and nothing built on it.
            let clear = true
            for (let d = 40; d <= 400 && clear; d += 15) for (const side of [-10, 0, 10]) { const px = c.x - fx * way * d - fz * side, pz = c.z - fz * way * d + fx * side, f = e.feet(Math.round(px), Math.round(pz)); if (Math.abs(f - c.y) > 10 || e.kind(px, f + 5, pz) || e.kind(px, f + 12, pz)) { clear = false; break } }
            if (clear && (!best || on > best.on)) best = { x: c.x, y: c.y, z: c.z, fx: fx * way, fz: fz * way, on, name: c.name }
          }
        }
        return best
      }, spots[n])
      if (!plan) { console.log(`  no row of parked cars with a clear run-up near ${spots[n]}: the next place`); continue }
      const result = await page.evaluate(async (p) => {
        const e = globalThis.engine, S = globalThis.S, M = globalThis.M
        const sx = p.x - p.fx * 300, sz = p.z - p.fz * 300, floor = e.feet(Math.round(sx), Math.round(sz))
        // The engine's own car, as tough and fast as the street's SUV, turned along the row and let down onto the road.
        const making = e.car([Math.round(sx) - 21, floor + 5, Math.round(sz) - 9])
        making.motor = { ...making.motor, tough: 280, top: 430 }
        const mine = await e.alive.spawn(making), born = e.alive.where(mine).at, turn = -Math.atan2(p.fz, p.fx)
        e.alive.place(mine, [sx, floor + born[1] - making.low[1] + 2, sz], [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)])
        await new Promise((r) => setTimeout(r, 900))
        e.alive.mount(mine)
        await new Promise((r) => setTimeout(r, 300))
        const before = e.street.debug.reactive.crashes, t0 = performance.now()
        e.alive.kick(mine, [p.fx * 430, 0, p.fz * 430])
        let told = 0, fastest = 0, most = 0
        // Every living thing made since the striker, whatever becomes of it: one that is no more passes every other check.
        const made = new Set([mine.id]), was = { sentAway: e.street.debug.reactive.sentAway ?? 0, broke: e.street.debug.reactive.broke ?? 0 }
        // Each car as the page first sees it on the road, alive: how far it then is from the nearest other (cells; under 0, that far into it).
        const landed = [], met = new Set([`t${mine.id}`])
        const seen = await M.watch(() => S.outlines(p.x, p.z, 1200, mine.id), 7, { lasts: 4, asks: (a, b) => a.kind === 'alive' || b.kind === 'alive', each: (all, now) => {
          if (now - told > 100) { told = now; if (mine.alive) e.alive.drive(mine, now - t0 < 2000 ? 1 : 0, 0, 0) }
          fastest = Math.max(fastest, Math.abs(mine.state?.speed ?? 0))
          for (const t of e.alive.things) if (t.id >= mine.id) made.add(t.id)
          const alive = all.filter((o) => o.kind === 'alive' && o.h < 100)
          most = Math.max(most, alive.length)
          for (const a of alive) { if (met.has(a.id)) continue; met.add(a.id); landed.push(Math.round(Math.min(...alive.filter((b) => b !== a).map((b) => -M.into(a, b))) * 10) / 10) }
        } })
        // At rest: how many of the solver's stand on something other than the road, and the deepest any two of them are.
        const alive = S.outlines(p.x, p.z, 6000, mine.id).filter((o) => o.kind === 'alive')
        let restDeep = -Infinity
        for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) restDeep = Math.max(restDeep, M.into(alive[i], alive[j]))
        const high = alive.map((o) => o.h)
        const laps = e.street.debug.laps
        const r = { ...seen, fastest, woke: e.street.debug.reactive.crashes - before, alive: alive.length, most, landed, made: made.size - 1, left: e.alive.things.filter((t) => t.alive && t.id > mine.id).length, sentAway: e.street.debug.reactive.sentAway === undefined ? null : e.street.debug.reactive.sentAway - was.sentAway, broke: e.street.debug.reactive.broke === undefined ? null : e.street.debug.reactive.broke - was.broke, laps: { reactive: laps.reactive, drive: laps.drive, trams: laps.trams }, stacked: high.filter((h) => h > 7).length + (seen.over > 0 ? 1 : 0), high: high.map((h) => Math.round(h * 10) / 10), restDeep, whole: mine.alive, lag: e.street.debug.wakeLag }
        // On foot again, the eye 9 m back along the row from the middle of where they lie and 5 m up: for a picture of them at rest.
        e.alive.mount(null)
        e.me?.walk?.(false)
        const mx = alive.reduce((n, o) => n + o.x, 0) / Math.max(1, alive.length), mz = alive.reduce((n, o) => n + o.z, 0) / Math.max(1, alive.length)
        const ex = mx - p.fx * 90 + p.fz * 45, ez = mz - p.fz * 90 - p.fx * 45
        // (Over the road they lie on, not over whatever the eye's own spot is: twice that was a roof, and the picture was of the roof.)
        Object.assign(e.pose, { x: ex / 10, z: ez / 10, y: e.feet(Math.round(mx), Math.round(mz)) / 10 + 5, yaw: Math.atan2(mx - ex, -(mz - ez)), pitch: -0.42 })
        return r
      }, plan).catch((e) => ({ failed: String(e) }))
      if (shots && !result.failed) { await page.waitForTimeout(1500); await page.screenshot({ path: join(shots, `rest-${worst.runs + 1}.png`) }) }
      await page.evaluate(() => { const e = globalThis.engine; for (const t of [...e.alive.things]) if (t.name === 'car') e.alive.vanish(t) })
      if (result.failed) { failures.push(`sf: the run at ${spots[n]} could not be driven (${result.failed})`); continue }
      console.log(`  into the ${plan.name} and ${plan.on} beyond it: ${round(result.fastest * 0.36, 0)} km/h, ${result.woke} woken (${result.most} alive at once, each ${JSON.stringify(result.landed)} cells from the nearest as it landed), deepest ${round(result.deepest)} cells (${result.deepPair}), longest over ${LASTS} cells ${round(result.longest, 2)} s${result.note ? ` (${result.note})` : ''}; at rest ${result.alive} alive ${JSON.stringify(result.high)} cells over the road, ${round(result.restDeep)} into each other, ${result.over} frames one over another${result.lag ? `; waking takes ${round(result.lag * 1000, 0)} ms` : ''}`)
      console.log(`    of ${result.made} cars that came to life ${result.left} are there at rest${result.sentAway === null ? '' : ` (${result.sentAway} sent away for room, ${result.broke} broke)`}, the striker ${result.whole ? 'whole' : 'broken'}; the street's frame: reactive ${result.laps.reactive} ms, drive ${result.laps.drive} ms, streetcars ${result.laps.trams} ms`)
      worst.lost += result.made - result.left - (result.sentAway ?? 0) - (result.broke ?? 0); worst.broke += (result.broke ?? 0) + (result.whole ? 0 : 1)
      worst.runs++
      worst.woke += result.woke
      worst.stacked += result.stacked
      for (const k of ['deepest', 'longest', 'fastest', 'restDeep']) if (result[k] > worst[k]) { worst[k] = result[k]; if (k === 'longest') worst.pair = result.pair }
      await page.evaluate(() => globalThis.engine.reset?.())
      await page.waitForTimeout(800)
    }
    check(worst.runs > 0 && worst.woke >= 2 * worst.runs, `sf: in ${worst.runs} runs the driven car struck rows of the street's parked cars and they woke (${worst.woke} woken)`)
    check(worst.fastest >= 389, `sf: it went ${round(worst.fastest * 0.36, 0)} km/h at the most (140 or more)`)
    check(worst.longest < FOR, `sf: no vehicle stayed ${LASTS} cells into another, alive or drawn, for ${FOR} s (${round(worst.longest, 2)} s${worst.pair ? `, ${worst.pair}` : ''})`)
    check(worst.stacked === 0, `sf: none was over another, nor came to rest off the road (${worst.stacked})`)
    check(worst.restDeep < LASTS, `sf: at rest no two living vehicles are ${LASTS} cells in each other (${round(worst.restDeep)})`)
    // (A car sent away to make room for a seventh is the street's rule, and one that broke in the pile was worn out by
    // its blows, which is the core's (`tough`): said, not failed. One that is neither there, nor sent away, nor broken, is lost.)
    check(worst.lost === 0, `sf: every car that came to life is there at rest, was sent away for room or broke (${worst.lost} unaccounted for; ${worst.broke} broke, the striker among them or not)`)

    // On foot beside a parked car: it comes to life where it stands, a living thing within reach, and E gets in.
    console.log('sf: a parked car woken by someone on foot')
    {
      await go(spots[1])
      await page.waitForTimeout(1200)
      const car = await page.evaluate(([x, z]) => { const e = globalThis.engine, all = e.street.cars(x, z, 1500).filter((c) => c.kind === 'parked' && !c.living), alive = e.alive.things.map((t) => e.alive.where(t)).filter(Boolean).map((w) => w.at); return all.filter((c) => c.model === 'car' && all.every((o) => o === c || Math.hypot(o.x - c.x, o.z - c.z) > 160) && alive.every((a) => Math.hypot(a[0] - c.x, a[2] - c.z) > 300)).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null }, spots[1])
      check(!!car, `sf: a parked car standing alone to walk up to${car ? ` (${car.name})` : ''}`)
      if (car) {
        await page.evaluate((c) => { const e = globalThis.engine; e.me.walk(false); const side = c.heading + Math.PI / 2, x = c.x + Math.cos(side) * 30, z = c.z + Math.sin(side) * 30; Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + 2, yaw: Math.atan2(-Math.cos(side), Math.sin(side)), pitch: -0.1 }); e.me.walk(true) }, car)
        const woke = await page.waitForFunction(() => globalThis.engine.alive.near !== null, null, { timeout: 30_000 }).then(() => true, () => false)
        // Watch the waking car's body over 1.5 s on rAF to verify it stays planted at its drawn stance with no jump (#147).
        const motion = woke ? await page.evaluate((c) => new Promise((resolve) => {
          const e = globalThis.engine
          const rot = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x] }
          let samples = 0, maxAbsDy = 0, cornerDrift = 0, baseCorners = null
          const t0 = performance.now()
          const sample = () => {
            const t = e.alive.near
            const w = t?.alive ? e.alive.where(t) : null
            if (t && w && Math.hypot(w.at[0] - c.x, w.at[2] - c.z) < 25 && Math.abs(w.at[1] - c.y) < 100) {
              const com = t.parts?.[0]?.born?.com ?? [t.size[0] / 2, t.size[1] / 3, t.size[2] / 2]
              const foot = rot(w.rot, [t.size[0] / 2 - com[0], -com[1], t.size[2] / 2 - com[2]])
              const fy = w.at[1] + foot[1]
              maxAbsDy = Math.max(maxAbsDy, Math.abs(fy - c.y))
              const corners = [[0, 0, 0], [t.size[0], 0, 0], [0, 0, t.size[2]], [t.size[0], 0, t.size[2]]].map(([lx, ly, lz]) => {
                const o = rot(w.rot, [lx - com[0], ly - com[1], lz - com[2]])
                return [w.at[0] + o[0], w.at[1] + o[1], w.at[2] + o[2]]
              })
              if (!baseCorners) baseCorners = corners
              else for (let k = 0; k < 4; k++) cornerDrift = Math.max(cornerDrift, Math.hypot(corners[k][0] - baseCorners[k][0], corners[k][1] - baseCorners[k][1], corners[k][2] - baseCorners[k][2]))
              samples++
            }
            if (performance.now() - t0 < 1500) requestAnimationFrame(sample)
            else resolve({ samples, maxAbsDy, cornerDrift })
          }
          requestAnimationFrame(sample)
        }), car) : { samples: 0, maxAbsDy: Infinity, cornerDrift: Infinity }
        // Where the living thing nearest its place stands: its middle of mass, which is within a few cells of the middle of where it was drawn, and its floor on the road.
        const stood = await page.evaluate((c) => { const e = globalThis.engine; let best = null; for (const t of e.alive.things) { const w = t.alive && e.alive.where(t); if (!w) continue; const d = Math.hypot(w.at[0] - c.x, w.at[2] - c.z); if (!best || d < best.d) best = { d, name: t.name, high: w.at[1] - t.size[1] / 2 - e.feet(Math.round(w.at[0]), Math.round(w.at[2])), near: e.alive.near === t } } return best }, car)
        check(woke && !!stood && stood.d < 6 && Math.abs(stood.high) < 4, `sf: it came to life where it stood (${stood ? `${round(stood.d)} cells from the middle of where it was drawn, its floor ${round(stood.high)} cells over the road` : 'nothing alive there'})`)
        check(motion.samples > 5 && motion.maxAbsDy < 0.25 && motion.cornerDrift < 0.5, `sf: waking parked car stays planted with no visible jump (max |dy|=${round(motion.maxAbsDy, 3)} cells, corner drift=${round(motion.cornerDrift, 2)} cells across ${motion.samples} frames)`)
        if (woke && stood?.near) {
          await page.keyboard.press('KeyE')
          const riding = await page.waitForFunction(() => globalThis.engine.alive.riding !== null, null, { timeout: 10_000 }).then(() => true, () => false)
          check(riding, 'sf: E gets in')
          await page.evaluate(() => globalThis.engine.alive.mount(null))
        } else check(false, `sf: the car woken is the one within reach (${stood?.name ?? 'none'})`)
      }
      await page.evaluate(() => { globalThis.engine.me.walk(false); globalThis.engine.reset?.() })
      await page.waitForTimeout(800)
    }

    // Streetcars and traffic: the street filled again and again where the F line runs (each time the eye comes from
    // far off, everything near is set down at once), then left to run. No car in a streetcar, nor two streetcars.
    const lines = [[533794, 667234], [529467, 662580], [497564, 703743]], fills = Number(arg('fills', '12')), each = Number(arg('seconds', '60')) / Math.max(1, fills)
    if (fills) console.log('sf: streetcars among the traffic')
    const trams = { seen: 0, traffic: 0, buses: 0, deepest: 0, longest: 0, pair: '', deepPair: '', note: '' }
    for (let k = 0; k < fills; k++) {
      // (Away and back: gone 150 m or more at once, the street forgets its traffic and streetcars and sets them down anew.)
      const at = lines[k % lines.length], look = ([x, z]) => page.evaluate(([x, z]) => { const e = globalThis.engine; Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + 30, pitch: -0.6 }) }, [x, z])
      if (k < lines.length) await go(at, 30)
      await look([at[0] + 6000, at[1] + 6000])
      await page.waitForTimeout(500)
      await look(at)
      await page.waitForFunction(() => { const e = globalThis.engine; return e.street.count(e.view(), 2600).traffic > 3 }, null, { timeout: 30_000 }).catch(() => null)
      const seen = await page.evaluate(([[x, z], seconds]) => {
        const S = globalThis.S, M = globalThis.M
        let most = 0, cars = 0, buses = 0
        // (Streetcars and what drives: not what is parked, nor the cable cars, which run to their clock and stop for nothing.)
        return M.watch(() => S.outlines(x, z, 2600, Infinity).filter((o) => o.kind === 'tram' || o.kind === 'traffic'), seconds, { lasts: 4, asks: (a, b) => a.kind === 'tram' || b.kind === 'tram', each: (all) => { most = Math.max(most, all.filter((o) => o.kind === 'tram').length); cars = Math.max(cars, all.filter((o) => o.kind === 'traffic').length); buses = Math.max(buses, all.filter((o) => o.long > 50 && o.kind === 'traffic').length) } }).then((r) => ({ ...r, most, cars, buses }))
      }, [lines[k % lines.length], each])
      trams.seen += seen.most; trams.traffic = Math.max(trams.traffic, seen.cars); trams.buses = Math.max(trams.buses, seen.buses)
      if (seen.deepest > trams.deepest) { trams.deepest = seen.deepest; trams.deepPair = seen.deepPair }
      if (seen.longest > trams.longest) { trams.longest = seen.longest; trams.pair = seen.pair; trams.note = seen.note }
      if (seen.longest >= 0.2) console.log(`  filling ${k + 1}: ${seen.note}`)
      const laps = await page.evaluate(() => globalThis.engine.street.debug.laps)
      for (const n of ['drive', 'trams']) trams[n] = Math.max(trams[n] ?? 0, laps[n] ?? 0)
    }
    if (fills) check(trams.seen >= fills / 2 && trams.traffic >= 5, `sf: streetcars ran among traffic (${trams.seen} streetcars over ${fills} fillings of the street, up to ${trams.traffic} vehicles driving, ${trams.buses} of them buses; the street's frame at most: drive ${trams.drive} ms, streetcars ${trams.trams} ms)`)
    if (fills) check(trams.longest < FOR, `sf: no car was ${LASTS} cells into a streetcar for ${FOR} s (${round(trams.longest, 2)} s${trams.pair ? `, ${trams.pair}` : ''}; the deepest ${round(trams.deepest)} cells${trams.deepPair ? `, ${trams.deepPair}` : ''})`)
  } finally {
    await browser.close()
    back()
    site.stop()
  }
}
await finish('crash-stack')
