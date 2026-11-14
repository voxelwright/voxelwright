// Shape finer than a cell (#259): the experiment's own tool, not a check. It stands kept things of 2.5 cm cells in
// the street at the bench's `street` place, takes pictures, and times with and without them turn about, with the
// GPU's own idle figure beside every round (this Mac's GPU is shared).
//
//   node test/finer.mjs --beside --out dir [--thing a-grand-piano] [--rounds 6]
//
// Things are read from ~/.village/engine/finer/things/<name>.json: { size: [w, h, d], cells: base64 of 16-bit kinds }.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { arg, has, start, still } from './kit.mjs'
import { from } from './rows.mjs'

const out = arg('out', `${homedir()}/.village/engine/finer`), rounds = Number(arg('rounds', '6'))
const kept = async (name) => JSON.parse(await readFile(`${homedir()}/.village/engine/finer/things/${name}.json`, 'utf8'))
const least = (xs) => Math.min(...xs), middle = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
const say = (name, xs) => `${name} least ${least(xs).toFixed(2)} middle ${middle(xs).toFixed(2)} ms`
/** With over without, round by round: the middle of the ratios, and the quarter marks either side. A busy GPU slows both of a pair alike. */
const ratio = (t) => { const r = t.a.map((a, i) => t.b[i] / a).sort((x, y) => x - y); return `with/without, middle of ${r.length} pairs ${r[r.length >> 1].toFixed(3)} (quarters ${r[r.length >> 2].toFixed(3)} to ${r[(r.length * 3) >> 2].toFixed(3)})` }
await mkdir(out, { recursive: true })
const { city, failures, finish } = await start()
const lines = []
const note = (text) => { console.log(text); lines.push(text) }
/** The top of whatever is under a place (metres), in the world's cells: a look straight down from 6 m over the land. */
const top = (page, x, z) => page.evaluate(async ([x, z]) => {
  const e = globalThis.engine, was = { ...e.pose }, y = e.ground(x, z) + 6
  Object.assign(e.pose, { x, y, z, yaw: 0, pitch: -Math.PI / 2 + 0.001 })
  const hit = await e.pick()
  Object.assign(e.pose, was)
  return Math.round(y * 10 - (hit ? hit.t : 60))
}, [x, z])
/** Times two ways of drawing turn about: each round is a, b, and the fixed work that is none of the engine's. */
const pairs = async (page, a, b) => {
  const times = { a: [], b: [], quiet: [] }
  for (let round = 0; round < rounds; round++) {
    times.a.push(await page.evaluate(a))
    times.b.push(await page.evaluate(b))
    times.quiet.push(await page.evaluate(() => globalThis.engine.quiet()))
  }
  return times
}
/** Each pass by the GPU's own clock: the least of many frames says most nearly what a pass costs when the GPU is shared. */
const clocked = async (page, flags = 3) => {
  const p = await page.evaluate((f) => globalThis.engine.passes(f, 60), flags)
  return `GPU clock, least (middle) of 60: march ${p.march.least.toFixed(2)} (${p.march.middle.toFixed(2)}) ms${p.bodies ? `, the things' pass ${p.bodies.least.toFixed(3)} (${p.bodies.middle.toFixed(3)}) ms` : ''}`
}
try {
  if (has('beside')) {
    const page = await city('scale=1&people=0', { size: [1280, 720], dpr: 2 })
    await still(page)
    await from(page, 0, 1.8, 0, 90, -2)
    await page.waitForTimeout(300)
    await still(page, { sun: true })
    const home = await page.evaluate(() => ({ ...globalThis.engine.home }))
    await page.screenshot({ path: `${out}/beside-before.png` })
    const name = arg('thing', 'a-grand-piano'), thing = await kept(name)
    // Five metres ahead of the eye, in the middle of the street, turned to face it.
    const at = [home.x + 5, home.z + 0.3], y = await top(page, at[0], at[1])
    const faces = await page.evaluate(([cells, size, at]) => { const p = globalThis.engine.fine(cells, size, at, 4, -Math.PI / 2); return globalThis.engine.falling.faces }, [thing.cells, thing.size, [at[0] * 10, y, at[1] * 10]])
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${out}/beside-${name}.png` })
    note(`${name} ${thing.size.join(' x ')} cells of 2.5 cm, ${faces} faces, at ${at[0].toFixed(1)}, ${(y / 10).toFixed(1)}, ${at[1].toFixed(1)} m`)
    await still(page, { sun: true })
    await page.screenshot({ path: `${out}/beside-${name}.png` })
    const one = await pairs(page, () => globalThis.engine.paced(3), () => globalThis.engine.paced(3, false, false, true))
    note(`  street, all on, 2560 x 1440: ${ratio(one)}; ${say('without', one.a)}; ${say('with', one.b)}; fixed work ${least(one.quiet).toFixed(2)} to ${Math.max(...one.quiet).toFixed(2)} ms`)
    // The worst kept thing, many times: phone boxes in rows down the street.
    const box = await kept('a-red-phone-box')
    let stood = 1
    for (const many of [10, 100, 1000]) {
      for (; stood < many + 1; stood++) {
        const row = Math.floor((stood - 1) / 5), x = home.x + 4 + (row % 40) * 2.5, z = home.z - 3 + ((stood - 1) % 5) * 1.5 + Math.floor(row / 40) * 0.2
        const y = stood <= 101 ? await top(page, x, z) : Math.round((await page.evaluate(([x, z]) => globalThis.engine.ground(x, z), [x, z])) * 10) + 1
        await page.evaluate(([cells, size, at]) => { globalThis.engine.fine(cells, size, at, 4, -Math.PI / 2) }, [box.cells, box.size, [x * 10, y, z * 10]])
      }
      const facesNow = await page.evaluate(() => globalThis.engine.falling.faces)
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${out}/beside-${many}-phone-boxes.png` })
      const t = await pairs(page, () => globalThis.engine.paced(3), () => globalThis.engine.paced(3, false, false, true))
      note(`  with ${many} phone boxes more (${facesNow} faces): ${ratio(t)}; ${say('without', t.a)}; ${say('with', t.b)}; fixed work ${least(t.quiet).toFixed(2)} to ${Math.max(...t.quiet).toFixed(2)} ms`)
    }
    const cpu = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 3000)); return { cpuMs: globalThis.engine.cpuMs, draw: globalThis.engine.spent.draw, frameMs: globalThis.engine.frameMs, scale: globalThis.engine.scale } })
    note(`  the page's own frame with all of them: ${cpu.frameMs.toFixed(1)} ms a frame, this thread ${cpu.cpuMs.toFixed(2)} ms of which drawing ${cpu.draw.toFixed(2)} ms`)
  }
  if (has('boxes')) {
    // One or two more boxes of finer cells round the eye, holding the world's own cells written out finer: three
    // pages (10, 5, 2.5 cm), each stopped while another is timed.
    const PLACES = [['street', 0, 1.8, 0, 90, -2], ['fronts', 0, 1.8, 0, 60, 5], ['roofs', 0, 12, 0, 20, -8], ['high', 0, 130, 0, 30, -22]]
    const fines = (arg('fines', '0,1,2')).split(',').map(Number), pages = []
    for (const fine of fines) {
      const page = await city(`scale=1&people=0&fine=${fine}&pool=${arg('pool', '512')}`, { size: [1280, 720], dpr: 2 })
      await still(page, { limit: 600_000 })
      const s = await page.evaluate(() => { const s = globalThis.engine.world.stats; globalThis.engine.pause(true); return { boxes: s.boxes, full: s.full, used: s.poolUsed, words: s.poolWords } })
      note(`fine ${fine} (${10 / (1 << fine)} cm): trees ${(s.used * 4 / 1048576).toFixed(0)} MB of ${(s.words * 4 / 1048576).toFixed(0)}, ${s.full} sectors did not fit`)
      s.boxes.forEach((b, i) => note(`  box ${i} (cells of ${(10 * 2 ** (i - fine)).toFixed(1)} cm): ${(b.words * 4 / 1048576).toFixed(1)} MB, ${b.made} sectors made in ${b.ms.toFixed(0)} ms of workers' time (${(b.ms / Math.max(1, b.made)).toFixed(2)} ms a sector)`))
      pages.push(page)
    }
    for (const [name, ...at] of PLACES) {
      const steps = []
      for (const [i, page] of pages.entries()) {
        await page.evaluate(() => globalThis.engine.pause(false))
        await from(page, ...at)
        await page.waitForTimeout(400)
        await still(page, { sun: true, limit: 600_000 })
        await page.screenshot({ path: `${out}/boxes-${name}-fine${fines[i]}.png` })
        const s = await page.evaluate(async () => { const e = globalThis.engine, r = { rays: (await e.steps(0)).mean, all: (await e.steps(3)).mean, full: e.world.stats.full, mb: e.world.stats.boxes.map((b) => b.words * 4 / 1048576), used: e.world.stats.poolUsed * 4 / 1048576 }; e.pause(true); return r })
        steps.push(s)
      }
      note(`${name}: steps a pixel ${steps.map((s, i) => `fine ${fines[i]}: rays ${s.rays.toFixed(2)}, all ${s.all.toFixed(2)}${s.full ? ` (${s.full} DID NOT FIT)` : ''}`).join('; ')}`)
      note(`  trees there: ${steps.map((s, i) => `fine ${fines[i]}: ${s.used.toFixed(0)} MB, the finest boxes ${s.mb.slice(0, fines[i] + 1).map((m) => m.toFixed(1)).join(', ')} MB`).join('; ')}`)
      for (const [way, flags] of [['rays', 0], ['all', 3]]) {
        const times = pages.map(() => []), quiet = []
        for (let round = 0; round < rounds; round++) {
          for (const [i, page] of pages.entries()) times[i].push(await page.evaluate(async (f) => { const e = globalThis.engine, ms = await e.paced(f); e.pause(true); return ms }, flags))
          quiet.push(await pages[0].evaluate(async () => { const e = globalThis.engine, ms = await e.quiet(); e.pause(true); return ms }))
        }
        const ratios = (i) => times[i].map((t, r) => t / times[0][r]).sort((x, y) => x - y)
        note(`  ${way}: ${pages.map((_, i) => `fine ${fines[i]} least ${least(times[i]).toFixed(1)} middle ${middle(times[i]).toFixed(1)} ms${i ? `, over fine ${fines[0]} round by round ${middle(ratios(i)).toFixed(2)} (quarters ${ratios(i)[rounds >> 2].toFixed(2)} to ${ratios(i)[(rounds * 3) >> 2].toFixed(2)})` : ''}`).join('; ')}; fixed work ${least(quiet).toFixed(2)} to ${Math.max(...quiet).toFixed(2)} ms`)
      }
    }
  }
  if (has('bricks')) {
    // A cell of the world that holds 4 x 4 x 4 cells a quarter its size: a page as things are, and one whose marcher
    // walks such cells, each stopped while the other is timed.
    const size = arg('size', '1280,720').split(',').map(Number), dpr = Number(arg('dpr', '2'))
    const both = []
    for (const query of ['scale=1&people=0', `scale=1&people=0&bricks=1${arg('query', '') ? `&${arg('query')}` : ''}`]) {
      const p = await city(query, { size, dpr })
      await still(p); await from(p, 0, 1.8, 0, 90, -2); await p.waitForTimeout(300); await still(p, { sun: true })
      await p.evaluate(() => { globalThis.engine.home ??= { ...globalThis.engine.pose }; globalThis.engine.pause(true) })
      both.push(p)
    }
    const [plain, page] = both
    const home = await page.evaluate(() => ({ ...globalThis.engine.home }))
    const compare = async (what) => {
      const steps = []
      for (const p of both) steps.push(await p.evaluate(async () => { const e = globalThis.engine, r = { rays: (await e.steps(0)).mean, all: (await e.steps(3)).mean }; e.pause(true); return r }))
      note(`${what}: steps a pixel as things are rays ${steps[0].rays.toFixed(2)}, all ${steps[0].all.toFixed(2)}; with fine cells walked rays ${steps[1].rays.toFixed(2)}, all ${steps[1].all.toFixed(2)}`)
      for (const [way, flags] of [['rays', 0], ['all', 3]]) {
        const times = [[], []], quiet = []
        for (let round = 0; round < rounds; round++) {
          // Which page goes first turns about: the plain page always first read the other 2% high where there was nothing to tell.
          for (let j = 0; j < 2; j++) { const i = (j + round) % 2; times[i].push(await both[i].evaluate(async (f) => { const e = globalThis.engine, ms = await e.paced(f); e.pause(true); return ms }, flags)) }
          quiet.push(await plain.evaluate(async () => { const e = globalThis.engine, ms = await e.quiet(); e.pause(true); return ms }))
        }
        const r = times[1].map((t, i) => t / times[0][i]).sort((x, y) => x - y)
        note(`  ${way}: as things are least ${least(times[0]).toFixed(1)} middle ${middle(times[0]).toFixed(1)} ms; walked least ${least(times[1]).toFixed(1)} middle ${middle(times[1]).toFixed(1)} ms; walked over plain round by round ${middle(r).toFixed(3)} (quarters ${r[rounds >> 2].toFixed(3)} to ${r[(rounds * 3) >> 2].toFixed(3)}); fixed work ${least(quiet).toFixed(2)} to ${Math.max(...quiet).toFixed(2)} ms`)
      }
    }
    await compare('nothing fine in the world')
    const stats = () => page.evaluate(() => { const b = globalThis.engine.world.stats.boxes; return { words: b.map((x) => x.words), made: b.map((x) => x.made), ms: b.map((x) => x.ms) } })
    const stand = async (things, name) => {
      const before = await stats()
      await page.evaluate(() => globalThis.engine.pause(false))
      let rows = 0, refused = 0
      for (const [thing, at] of things) { const n = await page.evaluate(([cells, size, at]) => globalThis.engine.fineEdit(cells, size, at, 1), [thing.cells, thing.size, at]); rows += n; refused += n ? 0 : 1 }
      await page.waitForTimeout(600)
      await still(page, { sun: true })
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${out}/bricks-${name}.png` })
      const after = await stats()
      await page.evaluate(() => globalThis.engine.pause(true))
      const words = after.words.map((w, i) => w - before.words[i]), made = after.made.map((m, i) => m - before.made[i]), ms = after.ms.map((m, i) => m - before.ms[i])
      const told = await page.evaluate(() => globalThis.engine.world.stats.refused)
      note(`${name}: ${rows} rows sent, ${refused} of ${things.length} things refused whole by the page, sectors that refused an edit ${told}; trees grew ${words.map((w) => (w * 4 / 1024).toFixed(0)).join(', ')} kB (box 0 first); sectors made again ${made.join(', ')} in ${ms.map((m) => m.toFixed(0)).join(', ')} ms of workers' time`)
    }
    const name = arg('thing', 'a-grand-piano'), thing = await kept(name), box = await kept('a-red-phone-box')
    // Every place is looked for before anything stands: a look down would meet the things themselves.
    const at = [home.x + 5, home.z + 0.3], spots = [[thing, [Math.round(at[0] * 10), await top(plain, at[0], at[1]), Math.round(at[1] * 10)]]], boxes = []
    for (let i = 0; i < 100; i++) {
      const row = Math.floor(i / 5), x = home.x + 4 + row * 2.5, z = home.z - 3 + (i % 5) * 1.5
      boxes.push([box, [Math.round(x * 10), await top(plain, x, z), Math.round(z * 10)]])
    }
    await plain.evaluate(() => globalThis.engine.pause(true))
    await stand(spots, name)
    await compare(`the ${name} in view`)
    if (has('strike')) {
      // A hammer blow on the thing where the eye looks: what is made again, and the picture.
      const before = await stats()
      await page.evaluate(() => globalThis.engine.pause(false))
      const hit = await page.evaluate(async () => { const e = globalThis.engine; for (let p = -0.04; p > -0.3; p -= 0.01) { e.pose.pitch = p; const at = await e.pick(); if (at && at.t < 62 && at.material !== 6) break } await new Promise((r) => setTimeout(r, 200)); const h = await e.blast(5, false); return { ...h, pitch: e.pose.pitch } })
      await page.waitForTimeout(1500)
      await still(page, { sun: true })
      await page.waitForTimeout(600)
      const fell = await page.evaluate(() => ({ ...globalThis.engine.fell }))
      await page.screenshot({ path: `${out}/bricks-${name}-struck.png` })
      const after = await stats()
      note(`a hammer blow (5 cells) on it: met ${JSON.stringify(hit)}; pieces ${fell.pieces}, cells in them ${fell.cells}; sectors of box 0 made again ${after.made[0] - before.made[0]} in ${(after.ms[0] - before.ms[0]).toFixed(0)} ms`)
    }
    if (!has('one')) {
      await stand(boxes, '100-phone-boxes')
      await compare('100 phone boxes more in view')
    }
  }
  if (has('free')) {
    // Whether the fine level costs anything where nothing is fine (#259): three pages, one as things are, one more
    // the same (what two pages that should not differ read: the floor under any figure here) and one whose shader
    // looks into cells of finer cells. Every bench place, rays only and all on; each page is stopped while another is
    // timed, and which goes first turns about from round to round.
    const PLACES = [['street', 0, 1.8, 0, 90, -2], ['fronts', 0, 1.8, 0, 60, 5], ['roofs', 0, 12, 0, 20, -8], ['high', 0, 130, 0, 30, -22], ['far', 0, 730, 0, 200, -30]]
    const more = arg('query', ''), size = arg('size', '1280,720').split(',').map(Number), dpr = Number(arg('dpr', '2')), phone = has('phone')
    const pages = []
    for (const query of ['', '', `&bricks=1${arg('grain', '') ? `&grain=${arg('grain')}` : ''}`]) {
      const p = await city(`people=0${phone ? '' : '&scale=1'}${more ? `&${more}` : ''}${query}`, { size, dpr, phone })
      await still(p)
      await p.evaluate(() => globalThis.engine.pause(true))
      pages.push(p)
    }
    const mid = (r) => { const s = [...r].sort((x, y) => x - y); return `${s[s.length >> 1].toFixed(3)} (${s[s.length >> 2].toFixed(3)} to ${s[(s.length * 3) >> 2].toFixed(3)})` }
    const wanted = arg('places', '').split(',').filter(Boolean)
    const measure = async (name) => {
      for (const [way, flags] of [['rays', 0], ['all', 3]]) {
        const times = pages.map(() => []), quiet = []
        for (let round = 0; round < rounds; round++) {
          for (let j = 0; j < pages.length; j++) { const i = (j + round) % pages.length; times[i].push(await pages[i].evaluate(async (f) => { const e = globalThis.engine, ms = await e.paced(f); e.pause(true); return ms }, flags)) }
          quiet.push(await pages[0].evaluate(async () => { const e = globalThis.engine, ms = await e.quiet(); e.pause(true); return ms }))
        }
        note(`| ${name} | ${way} | ${middle(times[0]).toFixed(2)} | ${mid(times[2].map((t, r) => t / times[0][r]))} | ${mid(times[2].map((t, r) => t / times[1][r]))} | ${mid(times[1].map((t, r) => t / times[0][r]))} | ${least(quiet).toFixed(2)} to ${Math.max(...quiet).toFixed(2)} |`)
      }
    }
    note(`| place | way | as things are, ms | switch on / as things are | switch on / the second plain page | second plain page / the first | fixed work, ms |`)
    note(`|---|---|---|---|---|---|---|`)
    for (const [name, ...at] of PLACES) {
      if (wanted.length && !wanted.includes(name)) continue
      const steps = []
      for (const p of pages) {
        await p.evaluate(() => globalThis.engine.pause(false))
        await from(p, ...at)
        await p.waitForTimeout(400)
        await still(p, { sun: true })
        steps.push(await p.evaluate(async () => { const e = globalThis.engine, r = [(await e.steps(0)).mean, (await e.steps(3)).mean]; e.pause(true); return r }))
      }
      note(`${name}: steps a pixel, rays and all: ${steps.map((s) => s.map((v) => v.toFixed(2)).join(' ')).join('; ')}`)
      await measure(name)
    }
    if (arg('thing', '')) {
      // Then a fine thing 5 m ahead in the street, on the page that can hold one: what it costs in view.
      const page = pages[2], thing = await kept(arg('thing')), grain = Number(arg('grain', '4'))
      for (const p of pages) { await p.evaluate(() => globalThis.engine.pause(false)); await from(p, 0, 1.8, 0, 90, -2); await p.waitForTimeout(400); await still(p, { sun: true }); await p.evaluate(() => globalThis.engine.pause(true)) }
      const home = await page.evaluate(() => ({ ...globalThis.engine.pose }))
      const far = Number(arg('ahead', '5')), at = [home.x + far, home.z + 0.3], y = await top(pages[0], at[0], at[1])
      await pages[0].evaluate(() => globalThis.engine.pause(true))
      await page.evaluate(() => globalThis.engine.pause(false))
      const rows = await page.evaluate(([cells, size, at, grain]) => globalThis.engine.fineEdit(cells, size, at, 1, grain), [thing.cells, thing.size, [Math.round(at[0] * 10), y, Math.round(at[1] * 10)], grain])
      await page.waitForTimeout(600); await still(page, { sun: true }); await page.waitForTimeout(600)
      await page.screenshot({ path: `${out}/free-${arg('thing')}.png` })
      const steps = await page.evaluate(async () => { const e = globalThis.engine, r = [(await e.steps(0)).mean, (await e.steps(3)).mean]; e.pause(true); return r })
      note(`${arg('thing')} ${far} m ahead (${rows} rows): steps a pixel with it, rays and all: ${steps.map((v) => v.toFixed(2)).join(' ')}`)
      await measure(`street, ${arg('thing')} ${far} m ahead`)
    }
  }
  if (has('small')) {
    // Small things at their own grain (#259): the kept things of 1.25 cm cells (things/k8) as cells of the world, 8 to
    // a cell each way. A picture from standing and one from close, what the trees grew by, rows sent, steps, and the
    // time against a page as things are, turn about.
    const both = []
    for (const query of ['scale=1&people=0', `scale=1&people=0&bricks=1${arg('query', '') ? `&${arg('query')}` : ''}`]) {
      const p = await city(query, { size: [1280, 720], dpr: 2 })
      await still(p); await from(p, 0, 1.8, 0, 90, -2); await p.waitForTimeout(300); await still(p, { sun: true })
      await p.evaluate(() => { globalThis.engine.home ??= { ...globalThis.engine.pose }; globalThis.engine.pause(true) })
      both.push(p)
    }
    const [plain, page] = both
    const home = await page.evaluate(() => ({ ...globalThis.engine.home }))
    const names = arg('things', 'a-pair-of-red-sneakers,a-teddy-bear').split(',')
    const spots = []
    for (const [i, name] of names.entries()) { const x = home.x + Number(arg('ahead', '1.6')), z = home.z - 0.3 + i * 0.6; spots.push([name, await kept(`k8/${name}`), [Math.round(x * 10), await top(plain, x, z), Math.round(z * 10)]]) }
    await plain.evaluate(() => globalThis.engine.pause(true))
    const stats = () => page.evaluate(() => { const b = globalThis.engine.world.stats.boxes; return { words: b.map((x) => x.words), made: b.map((x) => x.made), ms: b.map((x) => x.ms) } })
    await page.evaluate(() => globalThis.engine.pause(false))
    for (const [name, thing, at] of spots) {
      const before = await stats()
      const rows = await page.evaluate(([cells, size, at]) => globalThis.engine.fineEdit(cells, size, at, 1, 8), [thing.cells, thing.size, at])
      await page.waitForTimeout(600); await still(page, { sun: true }); await page.waitForTimeout(400)
      const after = await stats()
      note(`${name} (${thing.size.join(' x ')} cells of 1.25 cm): ${rows} rows sent; trees grew ${after.words.map((w, i) => ((w - before.words[i]) * 4 / 1024).toFixed(1)).join(', ')} kB (box 0 first); sectors made again ${after.made.map((m, i) => m - before.made[i]).join(', ')} in ${after.ms.map((m, i) => (m - before.ms[i]).toFixed(0)).join(', ')} ms of workers' time`)
    }
    await page.evaluate(() => globalThis.engine.pause(true))
    const views = [['standing', 0, 1.8, 0, 90, -38], ['close', 0.6, 0.55, 0, 90, -24]]
    for (const [view, ...at] of views) {
      const steps = []
      for (const p of both) {
        await p.evaluate(() => globalThis.engine.pause(false))
        await from(p, ...at); await p.waitForTimeout(400); await still(p, { sun: true }); await p.waitForTimeout(300)
        if (p === page) await p.screenshot({ path: `${out}/small-${view}${arg('tag', '')}.png` })
        steps.push(await p.evaluate(async () => { const e = globalThis.engine, r = [(await e.steps(0)).mean, (await e.steps(3)).mean]; e.pause(true); return r }))
      }
      note(`${view}: steps a pixel, rays and all: as things are ${steps[0].map((v) => v.toFixed(2)).join(' ')}; with the small things ${steps[1].map((v) => v.toFixed(2)).join(' ')}`)
      if (has('timed')) for (const [way, flags] of [['rays', 0], ['all', 3]]) {
        const times = [[], []], quiet = []
        for (let round = 0; round < rounds; round++) {
          for (let j = 0; j < 2; j++) { const i = (j + round) % 2; times[i].push(await both[i].evaluate(async (f) => { const e = globalThis.engine, ms = await e.paced(f); e.pause(true); return ms }, flags)) }
          quiet.push(await plain.evaluate(async () => { const e = globalThis.engine, ms = await e.quiet(); e.pause(true); return ms }))
        }
        const r = times[1].map((t, i) => t / times[0][i]).sort((x, y) => x - y)
        note(`| ${view} | ${way} | ${middle(times[0]).toFixed(2)} | ${middle(times[1]).toFixed(2)} | ${middle(r).toFixed(3)} (${r[rounds >> 2].toFixed(3)} to ${r[(rounds * 3) >> 2].toFixed(3)}) | ${least(quiet).toFixed(2)} to ${Math.max(...quiet).toFixed(2)} |`)
      }
    }
  }
  if (has('handover')) {
    // The handover (#259): a thing of finer cells lying turned beside the world (a picture, pieces.ts) becomes finer
    // cells of the world where it lies. A picture before and after, and what the two are.
    const page = await city('scale=1&people=0&bricks=1&finesun=1', { size: [1280, 720], dpr: 2 })
    await still(page); await from(page, 0, 1.8, 0, 90, -14); await page.waitForTimeout(300); await still(page, { sun: true })
    const home = await page.evaluate(() => ({ ...globalThis.engine.pose }))
    const name = arg('thing', 'a-grand-piano'), thing = await kept(name), per = Number(arg('per', '4'))
    const x = home.x + 4.5, z = home.z + 0.2, ground = await top(page, x, z)
    // Tipped over and turned: about an axis that lies along the street and a little across, most of a quarter turn and more.
    const angle = Number(arg('angle', '112')) * Math.PI / 180, axis = [0.92, 0.18, 0.35], len = Math.hypot(...axis)
    const rot = [...axis.map((a) => a / len * Math.sin(angle / 2)), Math.cos(angle / 2)]
    const placed = await page.evaluate(([cells, size, at, per, rot]) => {
      // Lifted so that its lowest corner is on the ground.
      const [qx, qy, qz, qw] = rot, row = [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)]
      let low = Infinity
      for (let c = 0; c < 8; c++) low = Math.min(low, (row[0] * ((c & 1 ? size[0] : 0) - size[0] / 2) + row[1] * (c & 2 ? size[1] : 0) + row[2] * ((c & 4 ? size[2] : 0) - size[2] / 2)) / per)
      const piece = globalThis.engine.fine(cells, size, [at[0], at[1] - low, at[2]], per, rot)
      return { faces: globalThis.engine.falling.faces, pos: piece.pos }
    }, [thing.cells, thing.size, [x * 10, ground, z * 10], per, rot])
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${out}/handover-before.png` })
    const before = await page.evaluate(async () => { const e = globalThis.engine, b = e.world.stats.boxes; return { words: b[0].words, hit: await e.pick() } })
    const t0 = Date.now()
    const done = await page.evaluate((grain) => globalThis.engine.fineRest(grain), Number(arg('grain', '4')))
    await page.waitForTimeout(600); await still(page, { sun: true }); await page.waitForTimeout(600)
    await page.screenshot({ path: `${out}/handover-after.png` })
    const after = await page.evaluate(async () => { const e = globalThis.engine, b = e.world.stats.boxes; return { words: b[0].words, hit: await e.pick(), faces: e.falling.faces } })
    let cells = 0
    for (const c of new Uint16Array(Uint8Array.from(Buffer.from(thing.cells, 'base64')).buffer)) if (c) cells++
    note(`${name} (${thing.size.join(' x ')} cells, ${cells} of them) lying turned ${arg('angle', '112')} degrees, beside the world: ${placed.faces} rows of faces; a look at it meets ${before.hit ? `material ${before.hit.material} at ${(before.hit.t / 10).toFixed(2)} m` : 'nothing'}`)
    note(`handed over: ${done.rows} rows sent, ${done.cells} finer cells of the world (${(done.cells / cells).toFixed(3)} of the thing's); the tree grew ${((after.words - before.words) * 4 / 1024).toFixed(0)} kB; rows of faces left beside the world ${after.faces}; a look at it meets ${after.hit ? `material ${after.hit.material} at ${(after.hit.t / 10).toFixed(2)} m` : 'nothing'}; ${Date.now() - t0} ms to the picture being still, waits included`)
  }
  await writeFile(`${out}/finer-${Date.now()}.txt`, lines.join('\n') + '\n')
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
await finish('finer')
