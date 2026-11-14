// A shared world (#140): one world process behind the page server (world.mjs) that everyone who
// opens the page with ?shared=1 is in. What any of them breaks, all of them see, in one order;
// a plain request from outside the browser does the same; it is kept across a reload and across
// a restart of the server; and an ask too big to do is refused without stopping it.
//
//   node test/shared.mjs [--suite]     --suite also runs blast, falls, tools, water and living in a shared world
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, has, here, serve, still } from './kit.mjs'
import { from } from './rows.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const file = join(tmpdir(), `engine-shared-${process.pid}.log`)
let server = await serve('/dev/null', ['--world', file])
const browser = await chrome()
const open = async () => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.5`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  return page
}
/** What twenty looks from one stand meet: how far, and what. */
const looks = async (page) => {
  await from(page, -2, 3.2, 1.5, 9, 12)
  await page.waitForTimeout(300)
  await still(page, { limit: 90_000 })
  return page.evaluate(async () => {
    const out = []
    for (let i = 0; i < 20; i++) { const hit = await globalThis.engine.pick(((i % 5) - 2) * 0.12, (Math.floor(i / 5) - 1.5) * 0.1); out.push(hit ? `${hit.material}@${Math.round(hit.t)}` : 'sky') }
    return out
  })
}
const same = (a, b) => a.filter((v, i) => v === b[i]).length
const ask = (body) => fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify(body) })
try {
  const a = await open(), b = await open()
  const whole = await looks(a)
  // Each breaks the house fronts across the street, a little apart, one after the other and at once.
  await from(a, -2, 3.2, 1.5, 4, 12); await from(b, -2, 3.2, 1.5, 16, 14)
  await a.waitForTimeout(300)
  const first = await a.evaluate(() => globalThis.engine.blast(16, false))
  const [, second] = await Promise.all([a.evaluate(() => globalThis.engine.blast(12, false)), b.evaluate(() => globalThis.engine.blast(16, false))])
  check(first && second, 'two pages each broke a house front across the street')
  await a.waitForTimeout(800)
  await still(a, { limit: 90_000 }); await still(b, { limit: 90_000 })
  const [onA, onB] = [await looks(a), await looks(b)]
  check(same(onA, whole) < 20, `the fronts are broken (${20 - same(onA, whole)} of twenty looks meet something else than before)`)
  check(same(onA, onB) === 20, `both pages see the same world (${same(onA, onB)} of twenty looks agree)`)
  // A request from outside any browser.
  const at = await a.evaluate(() => { const e = globalThis.engine; return [Math.round(e.pose.x * 10), Math.round((e.pose.y + 1) * 10), Math.round((e.pose.z - 10.5) * 10)] })
  const posted = await ask({ by: 'node', blast: at, radius: 14, spark: false })
  await a.waitForTimeout(1500)
  await still(a, { limit: 90_000 }); await still(b, { limit: 90_000 })
  const [afterA, afterB] = [await looks(a), await looks(b)]
  check(posted.status === 202 && same(afterA, onA) < 20 && same(afterA, afterB) === 20, `a blast asked by a plain request shows on both pages (${20 - same(afterA, onA)} looks changed, ${same(afterA, afterB)} agree)`)
  // The world itself says what is where, to anyone who asks, and it is what a page's look meets: five looks from
  // one page, each asked of the world a cell inside what it met and a cell and a half before it.
  const cell = async (c) => (await fetch(`${server.url}/world/at?x=${Math.floor(c[0])}&y=${Math.floor(c[1])}&z=${Math.floor(c[2])}`)).json()
  const met = await a.evaluate(async () => {
    const e = globalThis.engine, out = []
    for (const yaw of [-0.5, -0.2, 0.1, 0.4, 0.7]) {
      Object.assign(e.pose, { yaw, pitch: 0.12 })
      await new Promise((r) => setTimeout(r, 120))
      const hit = await e.pick(0, 0), f = [Math.sin(yaw) * Math.cos(0.12), Math.sin(0.12), -Math.cos(yaw) * Math.cos(0.12)], eye = [e.pose.x * 10, e.pose.y * 10, e.pose.z * 10]
      if (hit) out.push({ material: hit.material, inside: eye.map((v, k) => v + f[k] * (hit.t + 0.6)), before: eye.map((v, k) => v + f[k] * (hit.t - 1.6)) })
    }
    return out
  })
  let agree = 0
  for (const m of met) if ((await cell(m.inside)).material === m.material && (await cell(m.before)).material === 0) agree++
  const guide = await fetch(`${server.url}/world/`)
  check(met.length >= 4 && agree === met.length && guide.status === 200 && (await guide.text()).includes('/world/ask'), `asked what is where, the world says what a page's looks meet (${agree} of ${met.length}), and tells a stranger how to ask`)
  // Someone with no page has eyes too: a look north from over the street meets a house front, and it is the cell
  // the world says is there, with air before it. A look straight up meets nothing.
  const north = await (await fetch(`${server.url}/world/look?x=${at[0] - 60}&y=${at[1]}&z=${at[2] + 120}&dx=0&dy=0&dz=-1`)).json()
  const up = await (await fetch(`${server.url}/world/look?x=${at[0]}&y=${at[1] + 400}&z=${at[2]}&dx=0&dy=1&dz=0`)).json()
  const there = north.at ? await cell(north.at) : null, short = north.at ? await cell([north.at[0], north.at[1], north.at[2] + 1]) : null
  const cross = await fetch(`${server.url}/world/ask`, { method: 'POST', headers: { Origin: 'http://elsewhere.example' }, body: JSON.stringify({ blast: at, radius: 4 }) })
  check(north.material > 0 && there?.kind === north.kind && short?.material === 0 && up.at === null, `a look north meets a front ${north.far} cells off (material ${north.material}), the cell the world says is there; a look up meets nothing`)
  check(cross.status === 403, `an ask sent from a page of another site is refused (${cross.status})`)
  // Each sees the other is there.
  await a.waitForTimeout(400)
  const seen = [await a.evaluate(() => globalThis.engine.others), await b.evaluate(() => globalThis.engine.others)]
  check(seen[0] === 1 && seen[1] === 1, `each page sees one other in the world (${seen})`)
  // A seat (#218): a body the world moves for someone with no page. It walks where it is told at a walk, stops at a
  // house front and says why, is heard by who is near, and the pages see it there.
  const post = (path, body) => fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) })
  const told = async (path) => (await fetch(`${server.url}/world/${path}`)).json()
  const wren = (await (await post('join', { by: 'wren', at: [1000, 4009] })).json()).you
  await post('walk', { by: 'wren', to: [1050, 4009] })
  await a.waitForTimeout(5200)
  const walked = (await told('me?by=wren')).you
  await post('walk', { by: 'wren', to: [1050, 3920] })
  await a.waitForTimeout(6000)
  const stopped = (await told('me?by=wren')).you
  check(Math.abs(walked.at[0] - 1050) <= 1 && !walked.walking && stopped.at[2] > 3960 && /in the way/.test(stopped.stopped ?? ''), `a seat walks fifty cells east (to ${walked.at}), and walked at a house stops at its front and says why (${stopped.stopped})`)
  await post('join', { by: 'ada', at: [1062, 4009] })
  const said = await post('say', { by: 'wren', text: 'hello\u0007 <b>there</b>' })
  const around = await told('around?by=ada')
  check(said.status === 200 && around.heard.length === 1 && around.heard[0].text === 'hello  <b>there</b>' && around.heard[0].name === 'wren' && around.people.some((p) => p.name === 'wren' && p.far < 60) && around.sees.length === 8 && around.sees.some((s) => s.to === 'north' && s.meets !== 'nothing' && s.far < 40 && s.walk < 40) && around.sees.some((s) => s.to === 'east' && s.walk > 100), `who is near hears it as plain text and is told who is there and what stands round them (${around.people.map((p) => `${p.name} ${p.far} ${p.towards}`)}; north: ${around.sees[0].meets} at ${around.sees[0].far}, ${around.sees[0].walk} cells to walk; east ${around.sees[2].walk})`)
  const none = await told(`around?by=ada&since=${around.heard_up_to}`)
  await a.waitForTimeout(400)
  const [withSeats, nobody, nameless] = [await a.evaluate(() => globalThis.engine.others), await post('walk', { by: 'nobody', to: [1, 2] }), await post('join', {})]
  check(none.heard.length === 0 && withSeats === 3 && nobody.status === 409 && nameless.status === 400, `nothing is heard twice, a page sees both seats as well as the other page (${withSeats}), and a body nobody joined cannot be walked (${nobody.status}, ${nameless.status})`)
  // A blast beside a seat knocks it down for a few seconds; it is not hurt, and walks again after.
  await ask({ by: 'node', blast: [1062, stopped.at[1] + 6, 4020], radius: 6, spark: false })
  await a.waitForTimeout(300)
  const down = (await told('me?by=ada')).you, refused = await post('walk', { by: 'ada', to: [1075, 4009] })
  await a.waitForTimeout(4200)
  const risen = (await told('me?by=ada')).you, walks = await post('walk', { by: 'ada', to: [1075, 4009] })
  check(down.down && refused.status === 409 && !risen.down && walks.status === 200, `a blast beside a seat knocks it down (walk refused: ${refused.status}); four seconds on it is up and walks (${walks.status})`)
  const big = await ask({ blast: at, radius: 5000 }), long = await ask({ edit: new Array(20000).fill(0), release: at }), odd = await ask({ edit: [1, 9, 0], release: at })
  check(big.status === 400 && long.status === 400 && odd.status === 400, `a blast of radius 5000, an edit of 20,000 numbers and a malformed edit are refused (${big.status}, ${long.status}, ${odd.status})`)
  const still1 = await ask({ blast: [at[0] + 30, at[1], at[2]], radius: 6, spark: false })
  await a.waitForTimeout(1200)
  await still(a, { limit: 90_000 })
  const kept = await looks(a)
  check(still1.status === 202, 'and the world still answers')
  // A page that joins late, a reload, and a restart of the server on the same file.
  const c = await open()
  check(same(await looks(c), kept) === 20, 'a page that joins later sees it as it is')
  await a.reload()
  await a.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(a)
  check(same(await looks(a), kept) === 20, 'it is as it was after a reload')
  for (const page of [a, b, c]) await page.context().close()
  server.stop()
  await new Promise((r) => setTimeout(r, 500))
  server = await serve('/dev/null', ['--world', file])
  const d = await open()
  const back = await looks(d)
  check(same(back, kept) >= 19, `and after the server is started again on the same file (${same(back, kept)} of twenty looks agree)`)
  // The world that came back is a working one: it is asked to break something more, and does.
  const again = await ask({ by: 'node', blast: at, radius: 16, spark: false })
  await d.waitForTimeout(1500)
  await still(d, { limit: 90_000 })
  const more = await looks(d)
  check(again.status === 202 && same(more, back) < 20, `the world that came back does what it is asked (${again.status}; ${20 - same(more, back)} looks changed)`)
  await d.context().close()
} catch (e) {
  failures.push(String(e))
}
await browser.close()
server.stop()
rmSync(file, { force: true })
if (has('suite')) {
  // What holds for the worker in a page must hold for the world behind the server: the same checks, shared.
  for (const name of ['blast', 'falls', 'tools', 'water', 'living']) {
    const run = spawnSync('node', [`test/${name}.mjs`], { cwd: here, env: { ...process.env, ENGINE_SHARED: '1', ENGINE_KIT: '' }, encoding: 'utf8' })
    check(run.status === 0, `${name}, run in a shared world, passes`)
    if (run.status !== 0) console.log(run.stdout.split('\n').filter((l) => /FAIL|Error/.test(l)).map((l) => `      ${l.trim()}`).join('\n'))
  }
}
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('shared: ok')
