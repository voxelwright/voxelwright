// Headless proof of placing things (#48, ?build=1&cam=iso): src/build/place.ts,
// mount.ts and plugins/place.ts. First the plan ops (page-free), then a stub villager
// host (stub maker, no model) and a dev server on a throwaway VILLAGE_ROOT, both
// stopped at the end. Synthetic data only.
// Usage: node scripts/check-place.mjs [--dev=5362] [--host=5363]
//   --look: screenshots/build/place-*.jpg (each mount mid-placement and a red one,
//           1440x900 and 390x844) and screenshots/build/place.mp4.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const look = args.includes('--look')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const OUT = join(homeDir, 'screenshots', 'build')
mkdirSync(OUT, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'check-place-'))
const hostPort = Number(opt('host') ?? 5363)
const devPort = Number(opt('dev') ?? 5362)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)?.slice(0, 500)}`}`)
}
const near = (a, b, e = 0.06) => Math.abs(a - b) <= e

// ---------------------------------------------------------------- plan ops, no page
{
  const vite = await createServer({ root: homeDir, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } })
  const P = await vite.ssrLoadModule('/src/build/plan.ts')
  const { KITCHEN, apply, validate, PlanError } = P
  const refused = (fn) => {
    try {
      fn()
      return null
    } catch (e) {
      return e instanceof PlanError ? e.reasons.join('; ') : String(e)
    }
  }
  const crate = { id: 'f.crate', item: { kind: 'crate' }, at: { mount: 'floor', x: 0, z: 1.5, yaw: 0.3 } }
  const pic = { id: 'f.pic', item: { library: 'a1b2c3d4e5f6', person: 'alex' }, at: { mount: 'wall', wallId: 'kitchen.back', roomId: 'kitchen', along: 4, height: 1.5, spin: 0 } }
  const p1 = apply(KITCHEN, { op: 'placeItem', furniture: { ...crate, extra: 1, at: { ...crate.at, junk: 2 } } })
  check('plan: placeItem adds the thing, rebuilt from its known fields', JSON.stringify(p1.furniture) === JSON.stringify([crate]) && !validate(p1).length, p1.furniture)
  const p2 = apply(p1, { op: 'placeItem', furniture: pic })
  check('plan: a wall thing on a wall of its room is placed', p2.furniture.length === 2)
  check('plan: a used id is refused', /is used/.test(refused(() => apply(p2, { op: 'placeItem', furniture: { ...crate, id: 'kitchen.back' } })) ?? ''))
  check('plan: a dangling wall is refused', /does not exist/.test(refused(() => apply(p1, { op: 'placeItem', furniture: { ...pic, at: { ...pic.at, wallId: 'kitchen.nope' } } })) ?? ''))
  check('plan: a dangling room is refused', /does not exist/.test(refused(() => apply(p1, { op: 'placeItem', furniture: { ...pic, at: { ...pic.at, roomId: 'attic' } } })) ?? ''))
  check('plan: a wall anchor past its wall’s end is refused', /long/.test(refused(() => apply(p1, { op: 'placeItem', furniture: { ...pic, at: { ...pic.at, along: 9 } } })) ?? ''))
  check('plan: a wall anchor above the wall is refused', /wall/.test(refused(() => apply(p1, { op: 'placeItem', furniture: { ...pic, at: { ...pic.at, height: 3.5 } } })) ?? ''))
  check('plan: a floor thing outside every room is refused', /not in a room/.test(refused(() => apply(p1, { op: 'placeItem', furniture: { ...crate, id: 'f.x', at: { ...crate.at, x: 9 } } })) ?? ''))
  check('plan: a library item that is not 12 hex is refused', /12 hex/.test(refused(() => apply(p1, { op: 'placeItem', furniture: { ...pic, item: { library: 'nope', person: 'alex' } } })) ?? ''))
  const p3 = apply(p2, { op: 'moveItem', furnitureId: 'f.crate', at: { mount: 'floor', x: 1, z: 1, yaw: 0 } })
  check('plan: moveItem moves only that thing', p3.furniture[0].at.x === 1 && JSON.stringify(p3.furniture[1]) === JSON.stringify(p2.furniture[1]))
  check('plan: moveItem cannot change the mount', /mounted on the floor/.test(refused(() => apply(p2, { op: 'moveItem', furnitureId: 'f.crate', at: { mount: 'ceiling', x: 1, z: 1, yaw: 0 } })) ?? ''))
  check('plan: moveItem of a missing thing is refused', /does not exist/.test(refused(() => apply(p2, { op: 'moveItem', furnitureId: 'f.nope', at: crate.at })) ?? ''))
  const p4 = apply(p3, { op: 'removeItem', furnitureId: 'f.pic' })
  check('plan: removeItem removes it', p4.furniture.length === 1 && p4.furniture[0].id === 'f.crate')
  check('plan: removeItem of a missing thing is refused', /does not exist/.test(refused(() => apply(p4, { op: 'removeItem', furnitureId: 'f.pic' })) ?? ''))
  const dangling = { ...p2, walls: p2.walls.map((w) => (w.id === 'kitchen.back' ? { ...w, id: 'kitchen.back2' } : w)) }
  check('plan: validate reports a thing hung on a wall that is gone', validate(dangling).some((r) => /hangs on wall kitchen.back/.test(r)))
  await vite.close()
}

// ---------------------------------------------------------------- the page
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

await run('node', ['src/villager-cli.ts', '--agent', 'stub', '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam' }, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const QUERY = '?build=1&cam=iso&q=high'

const S = (page) => page.evaluate(() => window.villagePlace.state())
const versions = (page) => page.evaluate(async () => (await window.villageBuild.history()).versions().length)
const furniture = (page) => page.evaluate(() => window.villagePlace.plan().furniture)
const snap = (page) => page.evaluate(() => {
  const s = window.village.snapshot()
  return { objects: s.objects.join('\n'), dom: s.dom, geometries: s.geometries }
})
async function open(page) {
  await page.goto(base + QUERY)
  await page.evaluate(() => window.village.ready())
  await page.evaluate(() => window.villageBuild.history())
  await page.waitForFunction(() => window.villagePlace?.history() && window.villagePlace.building() === 0, null, { timeout: 20_000 })
  await page.waitForTimeout(1200)
}
/** The screen point of the pose's anchor (base, back or top of the thing). */
const anchorOnScreen = async (page) => {
  const s = await S(page)
  return page.evaluate((p) => window.villagePlace.project(p.x, p.y, p.z), s.pose)
}
const screenOf = (page, x, y, z) => page.evaluate(([x, y, z]) => window.villagePlace.project(x, y, z), [x, y, z])
/** Press on the thing's anchor and drag the mouse to a screen point in steps. */
async function dragTo(page, to, { steps = 12, alt = false } = {}) {
  const from = await anchorOnScreen(page)
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps)
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(120)
  return S(page)
}
const begin = (page, kind) => page.evaluate((k) => {
  window.__placing = window.villagePlace.begin(k)
  window.__done = null
  window.__placing.done.then((d) => (window.__done = d))
}, kind)
const done = (page) => page.waitForFunction(() => window.__done, null, { timeout: 15_000 }).then(() => page.evaluate(() => window.__done))
const shot = async (page, name) => look && page.screenshot({ path: join(OUT, `place-${name}.jpg`), quality: 86 })

let failed = false
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(look ? { recordVideo: { dir: join(root, 'video'), size: { width: 1440, height: 900 } } } : {}) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await open(page)
  const v0 = await versions(page)

  // ---- floor: drag, snap, red over the fridge and through a wall, turn, confirm
  const before = await snap(page)
  await begin(page, 'crate')
  let s = await S(page)
  check('floor: a new crate shows at a free spot near the middle of the view', s && s.mount === 'floor' && s.ok && s.tint === 'ok', s)
  s = await dragTo(page, await screenOf(page, -1.6, 0, 1.6))
  check('floor: dragged across the floor, it follows on a 5 cm grid', near(s.at.x, -1.6, 0.1) && near(s.at.z, 1.6, 0.1) && near(s.at.x / 0.05, Math.round(s.at.x / 0.05), 1e-3) && s.ok, s.at)
  await shot(page, 'floor')
  s = await dragTo(page, await screenOf(page, 1.5, 0, -1.8))
  check('floor: over the fridge it turns red and says why', !s.ok && s.tint === 'bad' && /fridge/.test(s.why ?? ''), s)
  await shot(page, 'red')
  const vRed = await versions(page)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  s = await S(page)
  check('floor: confirm is refused there (no version, still placing)', s.state === 'placing' && (await versions(page)) === vRed)
  s = await dragTo(page, await screenOf(page, -3.9, 0, 0.5))
  check('floor: inside the left wall it is red', !s.ok && /wall|outside/.test(s.why ?? ''), s)
  s = await dragTo(page, await screenOf(page, -1.6, 0, 1.6))
  const y0 = s.at.yaw
  const pad = await page.evaluate(() => [...document.querySelectorAll('input, textarea')].map((e) => e.value).join(''))
  await page.keyboard.press('KeyQ')
  s = await S(page)
  check('Q turns 15°', near(s.at.yaw - y0, Math.PI / 12, 1e-3), s.at)
  await page.keyboard.press('KeyE')
  await page.keyboard.press('KeyE')
  s = await S(page)
  check('E turns back 15° a step', near(s.at.yaw - y0, -Math.PI / 12, 1e-3), s.at)
  await page.keyboard.press('Shift+KeyQ')
  s = await S(page)
  check('Shift+Q turns to the next 45°', near(s.at.yaw, 0, 1e-3) || near(s.at.yaw, Math.PI / 4, 1e-3), s.at)
  const y45 = s.at.yaw
  await page.keyboard.press('Alt+KeyQ')
  s = await S(page)
  check('Alt+Q turns 1° (free)', near(s.at.yaw - y45, Math.PI / 180, 1e-3), s.at)
  const padAfter = await page.evaluate(() => [...document.querySelectorAll('input, textarea')].map((e) => e.value).join(''))
  check('turning keys never reach the notepad', padAfter === pad, { pad, padAfter })
  // Alt drag: free position (off the 5 cm grid).
  const target = await screenOf(page, -1.537, 0, 1.613)
  s = await dragTo(page, target, { alt: true })
  check('Alt drag places freely, off the grid', Math.abs(s.at.x / 0.05 - Math.round(s.at.x / 0.05)) > 0.01 || Math.abs(s.at.z / 0.05 - Math.round(s.at.z / 0.05)) > 0.01, s.at)
  // The turn handle: drag a quarter circle around the thing.
  s = await S(page)
  const yh = s.at.yaw
  const [cx, cy] = s.centre
  const r = Math.hypot(s.turn.x - cx, s.turn.y - cy)
  await page.mouse.move(s.turn.x, s.turn.y)
  await page.mouse.down()
  const a0 = Math.atan2(s.turn.y - cy, s.turn.x - cx)
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + r * Math.cos(a0 + (i / 10) * Math.PI / 2), cy + r * Math.sin(a0 + (i / 10) * Math.PI / 2))
  await page.mouse.up()
  s = await S(page)
  check('the turn handle turns it in 15° steps', !near(s.at.yaw, yh, 0.01) && near((s.at.yaw / (Math.PI / 12)) % 1, Math.round((s.at.yaw / (Math.PI / 12)) % 1), 1e-3) && s.turn.w >= 44 && s.turn.h >= 44, { yh, at: s.at, turn: s.turn })
  // 100 drag moves keep geometry flat.
  const g0 = (await snap(page)).geometries
  const from = await anchorOnScreen(page)
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  for (let i = 0; i < 100; i++) await page.mouse.move(from[0] + Math.sin(i / 6) * 120, from[1] + Math.cos(i / 9) * 60)
  await page.mouse.up()
  await page.waitForTimeout(200)
  const g1 = (await snap(page)).geometries
  check('100 drag moves leave the geometry count flat', g1 === g0, { g0, g1 })
  s = await dragTo(page, await screenOf(page, -1.6, 0, 1.6))
  await page.keyboard.press('Enter')
  let d = await done(page)
  const f1 = await furniture(page)
  const hist = await page.evaluate(async () => (await window.villageBuild.history()).versions().at(-1))
  check('floor: confirm commits one version with the crate in the plan', d.status === 'confirmed' && (await versions(page)) === v0 + 1 && f1.some((f) => f.id === d.furnitureId && f.at.mount === 'floor' && f.item.kind === 'crate') && hist.note === 'Placed the apple crate', { d, f1, hist })
  check('floor: no tag or handle stays on screen', !(await page.evaluate(() => document.querySelector('.place-tag, .place-turn'))))
  const crateId = d.furnitureId

  // ---- surface: onto the table top; red over the floor
  await begin(page, 'vase')
  s = await S(page)
  check('surface: a new vase starts on a top', s.ok && s.at.y >= 0.3, s.at)
  s = await dragTo(page, await screenOf(page, -0.9, 0.76, 0.45))
  check('surface: dragged onto the table, it sits on the table top', s.ok && near(s.at.y, 0.76, 0.03) && near(s.at.x, -0.9, 0.15) && near(s.at.z, 0.45, 0.15), s.at)
  await shot(page, 'surface')
  s = await dragTo(page, await screenOf(page, -1.6, 0, 2.2))
  check('surface: over bare floor it is red', !s.ok && /table|counter|shelf|edge/.test(s.why ?? ''), s)
  s = await dragTo(page, await screenOf(page, -0.9, 0.76, 0.45))
  await page.keyboard.press('Enter')
  d = await done(page)
  check('surface: confirmed on the table', d.status === 'confirmed' && near(d.pose.y, 0.76, 0.03), d)

  // ---- wall: back wall, red over the window, then a curved wall
  await begin(page, 'picture')
  s = await S(page)
  check('wall: a new picture hangs on a wall at a sensible height', s.ok && s.at.mount === 'wall' && near(s.at.height, 1.5, 0.01), s.at)
  const back = await page.evaluate(() => window.villageBuild.wallPoint('kitchen.back', 3.7, 1.5, 0.1))
  s = await dragTo(page, back)
  check('wall: dragged along the back wall it stays on it', s.ok && s.at.wallId === 'kitchen.back' && near(s.at.along, 3.7, 0.15), s.at)
  await shot(page, 'wall')
  const win = await page.evaluate(() => window.villageBuild.wallPoint('kitchen.back', 2.7, 1.6, 0.1))
  s = await dragTo(page, win)
  check('wall: over the window it is red', !s.ok && /window/.test(s.why ?? ''), s)
  // The shelf over the dresser is built in (furnish.ts), not in the plan: its stretch of the left wall is taken.
  s = await dragTo(page, await page.evaluate(() => window.villageBuild.wallPoint('kitchen.left', 3.0, 1.5, 0.1)))
  check('wall: onto the shelf over the dresser it is red and names the shelf', !s.ok && s.at.wallId === 'kitchen.left' && /shelf/.test(s.why ?? ''), { at: s.at, why: s.why })
  s = await dragTo(page, await page.evaluate(() => window.villageBuild.wallPoint('kitchen.left', 4.3, 1.5, 0.1)))
  check('wall: along the left wall clear of the shelf it is fine', s.ok && s.at.wallId === 'kitchen.left' && near(s.at.along, 4.3, 0.15), { at: s.at, why: s.why })
  await page.keyboard.press('Escape')
  d = await done(page)
  check('wall: Escape cancels', d.status === 'cancelled')
  await page.evaluate(async () => (await window.villageBuild.history()).commit([{ op: 'bendWall', wallId: 'kitchen.left', sagitta: 0.6 }], 'Bent the wall'))
  await page.waitForTimeout(600)
  await begin(page, 'picture')
  // Clear of the shelf, which stays where furnish.ts put it when the wall bends out behind it.
  const curved = await page.evaluate(() => window.villageBuild.wallPoint('kitchen.left', 4.4, 1.5, 0.1))
  s = await dragTo(page, curved)
  const facing = await page.evaluate((at) => {
    const plan = window.villagePlace.plan()
    const w = plan.walls.find((k) => k.id === 'kitchen.left')
    return { sagitta: w.sagitta }
  }, s.at)
  check('wall: on the bent left wall it hangs there, facing the room', s.ok && s.at.wallId === 'kitchen.left' && facing.sagitta !== 0 && Math.sin(s.pose.yaw) > 0.5, { at: s.at, why: s.why, pose: s.pose, facing })
  await shot(page, 'wall-curved')
  await page.keyboard.press('KeyQ')
  s = await S(page)
  check('wall: Q spins it in the wall’s plane', near(s.at.spin, Math.PI / 12, 1e-3) && near(s.pose.spin, Math.PI / 12, 1e-3), s.at)
  await page.keyboard.press('KeyE')
  await page.keyboard.press('Enter')
  d = await done(page)
  check('wall: confirmed on the curved wall', d.status === 'confirmed' && d.pose.wallId === 'kitchen.left')

  // ---- ceiling
  await begin(page, 'pendant')
  s = await S(page)
  s = await dragTo(page, await screenOf(page, s.pose.x - 1.2, s.pose.y, s.pose.z + 1.2))
  check('ceiling: a lantern hangs a cord below the ceiling and drags across it', s.ok && near(s.pose.y, 3 - 0.75, 1e-3), s)
  await shot(page, 'ceiling')
  await page.keyboard.press('Enter')
  d = await done(page)
  check('ceiling: confirmed', d.status === 'confirmed')

  // ---- cancel leaves no trace
  const mid = await snap(page)
  const vMid = await versions(page)
  const fMid = JSON.stringify(await furniture(page))
  await begin(page, 'crate')
  await dragTo(page, await screenOf(page, 0.8, 0, 1.8))
  await page.keyboard.press('Escape')
  d = await done(page)
  const after = await snap(page)
  check('cancel: no version, no furniture, the same scene objects and DOM', d.status === 'cancelled' && (await versions(page)) === vMid && JSON.stringify(await furniture(page)) === fMid && after.objects === mid.objects && after.dom === mid.dom, { dom: [mid.dom, after.dom], objects: after.objects === mid.objects })
  void before

  // ---- a failed commit leaves nothing looking placed
  await begin(page, 'crate')
  await dragTo(page, await screenOf(page, 0.8, 0, 1.8))
  await page.evaluate(() => {
    const h = window.villagePlace.history()
    window.__commit = h.commit
    h.commit = () => Promise.reject(new Error('the host could not be reached'))
  })
  const drawnBefore = (await page.evaluate(() => window.villagePlace.drawn())).length
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  s = await S(page)
  check('a failed commit: still a ghost, says so, nothing new drawn', s.state === 'placing' && /Couldn/.test(s.hint) && (await page.evaluate(() => window.villagePlace.drawn())).length === drawnBefore && !(await page.evaluate(() => window.__done)), s)
  await page.evaluate(() => {
    window.villagePlace.history().commit = window.__commit
  })
  // F7: another page changes the house first (a real second history on the same host store): StaleHead, then the history has the new head.
  const otherHead = await page.evaluate(async () => {
    const H = await import('/src/build/history.ts')
    const { token } = await (await fetch('/villager/launch')).json()
    const other = await H.PlanHistory.open(H.hostStore({ base: '/villager/api', token }), window.villagePlace.plan())
    return (await other.commit([{ op: 'bendWall', wallId: 'kitchen.right', sagitta: 0.2 }], 'Bent the wall')).id
  })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  s = await S(page)
  const headNow = await page.evaluate(() => window.villagePlace.history().head)
  check('F7: when another page moved the house, the ghost stays, says so, and the page already has the new head', s.state === 'placing' && /house changed/.test(s.hint) && headNow === otherHead && (await page.evaluate(() => window.villagePlace.drawn())).length === drawnBefore, { s, headNow, otherHead })
  await page.keyboard.press('Enter')
  d = await done(page)
  check('after the failures, confirming again places it once, on the other page’s version', (await page.evaluate(() => window.villagePlace.history().versions().at(-1).parent)) === otherHead && d.status === 'confirmed' && (await page.evaluate(() => window.villagePlace.drawn())).length === drawnBefore + 1)

  // ---- a thing still being made: confirm waits, swap keeps the pose and names the library item
  await page.evaluate(() => {
    window.__placing = window.villagePlace.beginMaking('floor', 'reading lamp', [0.4, 1.5, 0.4])
    window.__done = null
    window.__placing.done.then((d) => (window.__done = d))
  })
  s = await dragTo(page, await screenOf(page, 2.3, 0, 1.3))
  const poseBefore = s.pose
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  s = await S(page)
  check('making: confirm before the prop exists waits (no version yet)', s.state === 'confirming' && !(await page.evaluate(() => window.__done)), s)
  const made = await page.evaluate(async () => {
    const { makeProp } = await import('/src/villager.ts')
    const res = await makeProp('alex', 'reading lamp', [0.4, 1.5, 0.4])
    if (!res.ok) return { ok: false }
    const object = await window.villagePlace.fromModule(res.module)
    window.__placing.swap(object, undefined, { library: res.item, person: 'alex' })
    return { ok: true, item: res.item }
  })
  d = await done(page)
  const kept = JSON.parse(await readFile(join(root, 'people', 'alex', 'library', `${made.item}.json`), 'utf8')).kept
  check('making: swap() keeps the pose, then it is kept on the host and committed', made.ok && d.status === 'confirmed' && near(d.pose.x, poseBefore.x, 1e-6) && near(d.pose.z, poseBefore.z, 1e-6) && kept === true && (await furniture(page)).some((f) => f.item.library === made.item), { d, poseBefore, kept })
  const lampId = d.furnitureId
  await page.evaluate(() => {
    window.__placing = window.villagePlace.beginMaking('floor', 'stool', [0.4, 0.5, 0.4])
    window.__done = null
    window.__placing.done.then((d) => (window.__done = d))
  })
  await page.evaluate(() => window.__placing.cancel())
  d = await done(page)
  check('cancel() from outside ends it as cancelled and removes the tag', d.status === 'cancelled' && !(await page.evaluate(() => document.querySelector('.place-tag'))))

  // ---- moving a placed thing
  await page.evaluate((id) => {
    window.__placing = window.villagePlace.move(id)
    window.__done = null
    window.__placing.done.then((d) => (window.__done = d))
  }, crateId)
  const vMove = await versions(page)
  s = await dragTo(page, await screenOf(page, -2.4, 0, 1.0))
  await page.keyboard.press('Enter')
  d = await done(page)
  const moved = (await furniture(page)).find((f) => f.id === crateId)
  const lastNote = await page.evaluate(async () => (await window.villageBuild.history()).versions().at(-1).note)
  check('move: a placed crate moves as one moveItem version', d.status === 'confirmed' && (await versions(page)) === vMove + 1 && near(moved.at.x, -2.4, 0.15) && lastNote === 'Moved the apple crate', { moved, lastNote })
  await page.evaluate(async () => (await window.villageBuild.history()).undo())
  await page.waitForTimeout(200)
  const undone = (await page.evaluate(() => window.villagePlace.drawn())).find((x) => x.id === crateId)
  check('undo puts the crate back where it was', near(undone.at[0], -1.6, 0.1), undone)
  await page.evaluate(async () => (await window.villageBuild.history()).redo())
  await page.waitForTimeout(200)

  // ---- reload: everything placed is back at its pose (host store)
  const placed = (await furniture(page)).map((f) => f.id).sort()
  const drawnBeforeReload = Object.fromEntries((await page.evaluate(() => window.villagePlace.drawn())).map((x) => [x.id, x]))
  check('no page errors', errors.length === 0, errors)
  const page2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await open(page2)
  const back2 = Object.fromEntries((await page2.evaluate(() => window.villagePlace.drawn())).map((x) => [x.id, x]))
  const same = placed.every((id) => back2[id] && back2[id].at.every((v, i) => near(v, drawnBeforeReload[id].at[i], 2e-3)) && near(back2[id].yaw, drawnBeforeReload[id].yaw, 2e-3))
  check('reload: every placed thing is back at its pose, the made lamp rebuilt from the library', same && Boolean(back2[lampId]) && (await page2.evaluate(() => window.villagePlace.failures().length)) === 0, { placed, back2, before: drawnBeforeReload, failures: await page2.evaluate(() => window.villagePlace.failures()) })

  // ---- touch: one finger drags, two fingers twist (phone size)
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
  const tp = await phone.newPage()
  await open(tp)
  await begin(tp, 'crate')
  s = await S(tp)
  check('phone: the turn handle and buttons are at least 44 px', s.turn.w >= 44 && s.turn.h >= 44 && s.confirm.h >= 44 && s.cancel.h >= 44, s)
  const touch = (type, id, x, y) => tp.evaluate(([type, id, x, y]) => {
    const target = type === 'pointerdown' ? document.elementFromPoint(x, y) : document.querySelector('canvas')
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true }))
  }, [type, id, x, y])
  const a = await anchorOnScreen(tp)
  const at0 = s.at
  const goal = await screenOf(tp, at0.x + 0.6, 0, at0.z + 0.3)
  await touch('pointerdown', 11, a[0], a[1])
  for (let i = 1; i <= 8; i++) await touch('pointermove', 11, a[0] + ((goal[0] - a[0]) * i) / 8, a[1] + ((goal[1] - a[1]) * i) / 8)
  s = await S(tp)
  check('phone: one finger drags the thing', Math.hypot(s.at.x - at0.x, s.at.z - at0.z) > 0.3, { at0, at: s.at })
  await tp.screenshot({ path: look ? join(OUT, 'place-phone-floor.jpg') : join(root, 'phone.jpg'), quality: 86 })
  const yawT = s.at.yaw
  await touch('pointerdown', 12, goal[0] + 80, goal[1])
  for (let i = 1; i <= 6; i++) await touch('pointermove', 12, goal[0] + 80 * Math.cos((i / 6) * Math.PI / 3), goal[1] + 80 * Math.sin((i / 6) * Math.PI / 3))
  await touch('pointerup', 12, goal[0], goal[1] + 80)
  await touch('pointerup', 11, goal[0], goal[1])
  s = await S(tp)
  check('phone: a two-finger twist turns it in 15° steps', !near(s.at.yaw, yawT, 0.01) && near((s.at.yaw / (Math.PI / 12)) % 1, 0, 1e-3), { yawT, yaw: s.at.yaw })
  if (look) {
    await tp.evaluate(() => window.__placing.cancel())
    await begin(tp, 'picture')
    await tp.waitForTimeout(300)
    await tp.screenshot({ path: join(OUT, 'place-phone-wall.jpg'), quality: 86 })
  }
  await phone.close()
  if (look) {
    await context.close()
    const video = readdirSync(join(root, 'video')).find((f) => f.endsWith('.webm'))
    const mp4 = join(OUT, 'place.mp4')
    rmSync(mp4, { force: true })
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(root, 'video', video), '-vf', 'fps=24,scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', mp4])
    console.log(`clip ${mp4} ${(statSync(mp4).size / 1e6).toFixed(2)} MB`)
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await browser.close()
  for (const c of [...children]) await stop(c)
  await rm(root, { recursive: true, force: true })
}
const bad = checks.filter((c) => !c.pass).length
console.log(`${checks.length - bad}/${checks.length} checks pass`)
process.exit(bad || failed ? 1 : 0)
