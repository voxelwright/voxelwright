// Captures of fire, water and weather in the real home (#105), headless Chrome: lights a thing
// and takes a picture at each mark of real time, from a camera near it. Starts its own villager
// host and dev server on a throwaway VILLAGE_ROOT, or uses a running dev server with --base.
// Usage: node scripts/fire-shots.mjs <out-dir> [--thing=key] [--marks=1,4,10] [--q=high] [--dpr=2]
//          [--dev=5420] [--host=5421] [--eye=x,y,z] [--look=x,y,z] [--name=fire] [--list]
//          [--do=ignite|douse|rain|strike|snow] [--then=douse@6] [--query=extra=1] [--strip=6]
// Marks are simulated seconds.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { pairLink } from './pairing.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const out = resolve(args.find((a) => !a.startsWith('--')) ?? 'screenshots/fire')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(process.env.VILLAGE_SCRATCH ?? tmpdir(), 'fire-shots-'))
const devPort = Number(opt('dev', '5420')), hostPort = Number(opt('host', '5421'))
const base = `http://localhost:${devPort}/`
const vec = (s) => s?.split(',').map(Number)
const children = new Set()

function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((done, fail) => {
    let text = ''
    const timer = setTimeout(() => fail(new Error(`${cmd} did not start: ${text.slice(-400)}`)), 30_000)
    child.stdout.on('data', (d) => {
      text += d
      if (ready.test(text)) {
        clearTimeout(timer)
        done(child)
      }
    })
    child.stderr.on('data', (d) => (text += d))
    child.on('exit', (code) => fail(new Error(`${cmd} exited ${code}: ${text.slice(-400)}`)))
  })
}

await mkdir(out, { recursive: true })
await run('node', ['src/villager-cli.ts', '--agent', 'stub', '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(opt('dpr', '2')) })
  page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 300)))
  page.on('console', (m) => m.type() === 'error' && console.error('console', m.text().slice(0, 300)))
  const extra = opt('query')
  await page.goto(await pairLink(`${base}?talk=off&build=0&q=${opt('q', 'high')}${extra ? `&${extra}` : ''}`, root))
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => window.village?.physics?.fire, null, { timeout: 30_000 })
  await page.waitForTimeout(1500)
  if (args.includes('--list')) {
    console.log(JSON.stringify(await page.evaluate(() => window.village.physics.fire.list().map((p) => `${p.id} ${p.material} [${p.center.map((x) => x.toFixed(2))}] ±[${p.half.map((x) => x.toFixed(2))}]`)), null, 1))
  } else {
    const thing = opt('thing')
    const part = await page.evaluate((thing) => window.village.physics.fire.list().find((p) => p.id === thing || p.thing === thing), thing)
    if (!part) throw new Error(`no thing ${thing}; try --list`)
    const [x, y, z] = part.center
    const eye = vec(opt('eye')) ?? [x + 1.6, y + 1.3, z + 2.2], look = vec(opt('look')) ?? [x, y + 0.25, z]
    if (opt('eye') !== 'own') await page.evaluate(([eye, look]) => window.village.physics.look(eye, look), [eye, look])
    await page.waitForTimeout(1200)
    const name = opt('name', 'fire')
    const act = (what) => page.evaluate(([what, thing, part, id]) => {
      const f = window.village.physics.fire
      return what === 'rain' ? f.rain(20) : what === 'snow' ? f.snow?.(30) : f[what](thing, id === thing ? undefined : part)
    }, [what, part.thing, part.part, part.id])
    await page.screenshot({ path: join(out, `${name}-0.png`) })
    const first = await act(opt('do', 'ignite'))
    if (first) console.error('refused:', first)
    // Marks are simulated seconds (stepped at once, then a moment for the picture to follow), so two runs show the same fire.
    const then = opt('then')?.split('@')
    let at = 0
    const to = async (t) => {
      if (t > at) await page.evaluate((s) => window.village.physics.fire.run(s), t - at)
      at = Math.max(at, t)
    }
    for (const mark of (opt('marks', '1,4,10')).split(',').map(Number)) {
      if (then && Number(then[1]) < mark && Number(then[1]) >= at) {
        await to(Number(then[1]))
        await act(then[0])
      }
      await to(mark)
      await page.waitForTimeout(700)
      await page.screenshot({ path: join(out, `${name}-${mark}.png`) })
    }
    // A strip of frames 90 ms apart at the last mark: the motion.
    for (let i = 0; i < Number(opt('strip', '0')); i++) {
      await page.waitForTimeout(90)
      await page.screenshot({ path: join(out, `${name}-strip-${i}.png`) })
    }
    console.log(JSON.stringify(await page.evaluate(() => ({ fire: window.village.physics.fire.stats(), gpu: window.village.stage?.timing?.gpu?.slice(-60) }))))
  }
} finally {
  await browser.close()
  for (const c of children) try { process.kill(-c.pid) } catch { /* gone */ }
}
process.exit(0)
