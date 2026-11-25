// A visitor's own AI, connected (#526, page/connect.ts), checked in the folder `node sf/build.mjs` writes, served as
// plain files, with every provider's host answered by this check itself (Playwright routes the four hosts in
// models.ts `AT`): a list of models, then a stream that spells a small thing in the maker's form. No provider is asked
// and no model is run: this proves the page, the panel and the wiring, never that a provider takes the request.
//
//   node test/sf-connect.mjs [--no-build] [--dist dist-sf] [--port 6010] [--shots ~/.village/engine/sf/connect/check] [--headed]
//
// The realm runs in a frame of a host page of the check's own (as the landing holds it), so that every message it
// posts to its host is heard. It fails unless:
//   - without `?making=1`: no panel, no key in the settings, and neither connect.js nor models.js is asked for;
//   - with it: nothing of them is asked for before the bar is used; a new wish with nothing connected asks to connect,
//     and the panel opens; for each provider in turn a made-up key shows its models, the first one chosen is a strong
//     one, and connecting makes the same wish, which stands (its cells in the page's core), with the cost line; the
//     first by keyboard alone; forgetting leaves nothing under `village.ai`, and the next new wish asks again;
//   - a stream cut part way says so and makes nothing; Stop stops and makes nothing; a limit whose words quote the key
//     is shown without it; a key the provider refuses leads back to the panel with the reason;
//   - a second tab follows a connection made in the first, and its forgetting;
//   - a host page's messages open no panel and reach no model;
//   - the key is only in requests to its own provider's host, in the password field and under `village.ai`: not in any
//     other request, console line, the address or its history, the DOM's text, another key of storage, a message to the
//     host, or anything `engine` holds.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { FIRST, HOSTS, KEYS, PROVIDERS, ROUTES, providers } from './providers.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'connect', 'check'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })

// ── The host page: the realm in a frame, and every message it posts kept ──
const HOST = `<!doctype html><meta charset="utf-8"><title>host</title><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100vw;height:100vh;display:block}</style>
<iframe src="/sf/index.html?making=1" allow="fullscreen"></iframe>
<script>window.heard = []; addEventListener('message', (e) => window.heard.push(JSON.stringify(e.data)))</script>`
// A second tab of the same site: connect.js alone, with a bar that answers "Not now" to whatever it is asked (two whole
// realms in one browser starve each other here; what a tab follows is this origin's storage, the same either way).
const TAB = `<!doctype html><meta charset="utf-8"><title>tab</title><div id="ask"></div><script type="module">
import { connect } from '/page/connect.js'
window.offered = []
window.conn = connect({ hud: { choose: async (text) => { window.offered.push(text); return 1 } }, input: { push: () => () => {} }, wish: { on: () => () => {} }, asking: () => null })
</script>`
const PAGES = { '/host.html': HOST, '/tab.html': TAB }
const site = await plain(dist, '127.0.0.1', Number(arg('port', '6010')), { extra: (req, res) => { const page = PAGES[req.url.split('?')[0]]; if (!page) return false; res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return true } })
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
// Should anything not be routed, no provider is reached: their names lead nowhere in this browser.
const NOWHERE = `--host-resolver-rules=${['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'openrouter.ai'].map((h) => `MAP ${h} 127.0.0.1:9`).join(', ')}`
const browser = await chromium.launch({ ...CHROME, args: [...CHROME.args, NOWHERE], headless: !has('headed') })
const errors = []

// ── The providers, answered here (test/providers.mjs) ──
const { state, answer } = providers()
const asked = state.asked
/** Every request the page made, with all its headers and its body. */
const requests = []
/** A context whose every request is kept, the providers answered here, and every console line kept. */
const context = async (viewport = { width: 1280, height: 720 }) => {
  const c = await browser.newContext({ viewport })
  await c.route(PROVIDERS, answer)
  c.on('request', async (r) => { const entry = { url: r.url(), method: r.method(), headers: {}, body: r.postData() ?? '' }; requests.push(entry); try { entry.headers = await r.allHeaders() } catch { /* gone */ } })
  return c
}
const consoled = []
const watch = (page) => { page.on('console', (m) => consoled.push(m.text())); page.on('pageerror', (e) => errors.push(e.message)) }
/** Waits for the park, takes the visitor in by the host's way (explore.ts `go`), and stands them on the street looking along it (as test/sf-make.mjs does). */
const enter = async (frame) => {
  await frame.waitForFunction(() => globalThis.engine?.explore && globalThis.engine.seen?.whole > 0, null, { timeout: 300_000 })
  await frame.evaluate(() => globalThis.engine.explore.go())
  await frame.waitForFunction(() => globalThis.engine.first.engaged && globalThis.engine.explore.state === 'in', null, { timeout: 60_000 })
  const stand = () => frame.evaluate(() => {
    const e = globalThis.engine, k = e.local.kept[0].at, x = k[0] + 80, z = k[2] + 2
    let y = 1500
    for (; y > 0 && !e.kind(x, y, z); y--);
    e.me.walk(false)
    Object.assign(e.pose, { x: x / 10, y: (y + 18) / 10, z: z / 10, yaw: -Math.PI / 2, pitch: -0.3 })
  })
  await stand(); await frame.waitForTimeout(3000); await stand()
  await frame.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 }, null, { timeout: 120_000 }).catch(() => {})
  await frame.waitForTimeout(1000)
}
const ours = (from = 0) => site.asked.filter((a) => a.at >= from && /\/page\/(connect|models)\.js$/.test(a.path)).map((a) => a.path)
/** Bytes on the wire and files asked for, from `from` until the park was shown (`engine.seen.near`, as the host is told `ready`). */
const until = async (frame, from) => {
  await frame.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 300_000 })
  const shown = Date.now(), got = site.asked.filter((a) => a.at >= from && a.at <= shown)
  return { files: got.length, bytes: got.reduce((n, a) => n + (a.wire ?? 0), 0) }
}

// ── Without ?making=1 ──
{
  const c = await context(), page = await c.newPage()
  watch(page)
  const from = Date.now()
  await page.goto(`${site.url}/sf/index.html`)
  const shown = await until(page, from)
  console.log(`  without ?making=1: ${shown.files} files, ${(shown.bytes / 1e6).toFixed(2)} MB on the wire until the park is shown`)
  await enter(page)
  const off = await page.evaluate(() => ({ making: typeof globalThis.engine.making, panel: !!document.querySelector('#connect'), key: !!document.querySelector('#realm button.ai'), line: !!document.querySelector('#ai-line') }))
  check(off.making === 'undefined' && !off.panel && !off.key && !off.line, `without ?making=1: no seam (${off.making}), no panel, no key in the settings, no line`)
  check(ours(from).length === 0, `without ?making=1: connect.js and models.js are never asked for (${ours(from).join(', ') || 'none'})`)
  await c.close()
}

// ── With ?making=1, in a host's frame ──
const c = await context()
const page = await c.newPage()
watch(page)
const from = Date.now()
await page.goto(`${site.url}/host.html`)
const realm = await (async () => { for (;;) { const f = page.frames().find((f) => f.url().includes('/sf/index.html')); if (f) return f; await page.waitForTimeout(100) } })()
const shownWith = await until(realm, from)
console.log(`  with ?making=1: ${shownWith.files} files, ${(shownWith.bytes / 1e6).toFixed(2)} MB on the wire until the park is shown`)
await enter(realm)
check(ours(from).length === 0, `with ?making=1, in the realm: nothing of connect.js or models.js asked for before a wish needs it (${ours(from).join(', ') || 'none'})`)
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) })

// A host page's words open nothing and reach no model.
await page.evaluate(() => { const w = document.querySelector('iframe').contentWindow; for (const m of [{ village: 'realm', type: 'ask', wish: 'a host wish' }, { village: 'realm', type: 'connect', route: 'openai', key: 'sk-host-given-key-000000' }, { village: 'realm', type: 'signs.set', id: 'nope', content: { text: 'a host wish' } }]) w.postMessage(m, '*') })
await realm.waitForTimeout(800)
check(ours(from).length === 0 && !(await realm.evaluate(() => document.querySelector('#connect')?.open ?? false)), 'a host page\'s messages open no panel and fetch nothing of it')

/** Types words on the bar as a person would, and sends them; resolves to a promise of how that wish ended. */
const wishFor = async (words) => {
  await realm.evaluate(() => { globalThis.__done = new Promise((done) => { const off = globalThis.engine.wish.on((s) => { if (s.stage === 'done') { off(); done(s) } }) }) })
  await realm.evaluate(() => globalThis.engine.hud.line.show())
  await realm.fill('#line', '')
  await realm.type('#line', words, { delay: 25 })
  await page.keyboard.press('Enter')
}
const ended = () => realm.evaluate(() => globalThis.__done)
const offered = () => realm.waitForFunction(() => { const c = document.querySelector('#choice'); return c && !c.hidden && /Connect your AI/.test(c.textContent) }, null, { timeout: 60_000 }).then(() => true, () => false)
const panel = () => realm.waitForFunction(() => document.querySelector('#connect')?.open, null, { timeout: 15_000 }).then(() => true, () => false)
const stands = (done) => realm.evaluate((id) => {
  const e = globalThis.engine, t = id && e.things.all.get(id)
  if (!t) return { sampled: 0, held: 0 }
  const g = t.grain ?? 1, cells = []
  for (let i = 0; i + 4 < t.cells.length; i += 5 * Math.max(1, Math.floor(t.cells.length / 5 / 24))) cells.push([Math.floor(t.cells[i] / g), Math.floor(t.cells[i + 2] / g), Math.floor(t.cells[i + 3] / g)])
  return { sampled: cells.length, held: cells.filter(([x, y, z]) => e.kind(x, y, z) !== 0).length }
}, done.id)
const lineSays = () => realm.evaluate(() => { const l = document.querySelector('#ai-line'); return l && !l.hidden ? l.textContent : '' })
/** The realm's settings, opened where they are folded, and its key for the visitor's own AI pressed. */
const settingsKey = async () => { await realm.evaluate(() => globalThis.engine.realmControls.fold(false)); await realm.click('#realm button.ai') }
const stored = () => realm.evaluate(() => localStorage.getItem('village.ai'))

// A second tab of the same browser, its connector fetched before anything is connected: asked, it offers to connect.
const second = await c.newPage()
watch(second)
await second.goto(`${site.url}/tab.html`)
await second.waitForFunction(() => globalThis.conn, null, { timeout: 30_000, polling: 250 })
const tabAsk = () => second.evaluate(() => globalThis.conn.ask({ system: 'a brief', prompt: 'a test wish', pictures: [] }).then((r) => ({ text: r.text.length }), (e) => ({ why: e.message, offered: globalThis.offered.length })))
{
  const r = await tabAsk()
  check(r.why === 'let go' && r.offered === 1, `the second tab, nothing connected: it offers to connect, and Not now lets the wish go (${r.why}, offered ${r.offered})`)
}

const WISHES = { anthropic: 'a purple submarine', openai: 'a glass greenhouse', gemini: 'a wooden windmill', openrouter: 'a copper weathervane' }
for (const route of ROUTES) {
  console.log(`  (${route})`)
  const n0 = await realm.evaluate(() => globalThis.engine.things.all.size), answers0 = asked.answers
  await wishFor(WISHES[route])
  const asks = await offered()
  if (route === ROUTES[0]) await shot('offered')
  // The first provider by keyboard alone: 1 for the bar's first answer, the key typed into the field that has the focus, Enter.
  if (route === 'anthropic') await page.keyboard.press('Digit1'); else await realm.click('#choice button >> nth=0')
  const opened = await panel()
  const focus = await realm.evaluate(() => document.activeElement?.id)
  check(asks && opened, `${route}: a new wish with nothing connected asks to connect, and the panel opens${route === 'anthropic' ? ` (by keyboard; the focus on ${focus})` : ''}`)
  if (route === 'anthropic') {
    check(focus === 'connect-key', `the key's field has the focus as the panel opens (${focus})`)
    await shot('choosing')
    await page.keyboard.type(KEYS[route], { delay: 20 })
    await page.keyboard.press('Enter')
  } else {
    await realm.click(`#connect label:has(input[value=${route}])`)
    await realm.fill('#connect-key', KEYS[route]); await realm.press('#connect-key', 'Enter')
  }
  const models = await realm.waitForFunction(() => { const s = document.querySelector('#connect select'); return s && !s.closest('label').hidden && s.options.length ? [...s.options].map((o) => o.value).concat(s.value) : null }, null, { timeout: 15_000 }).then((h) => h.jsonValue(), () => null)
  check(!!models && models.at(-1) === FIRST[route], `${route}: the key is tried and shows its models (${models?.slice(0, -1).join(', ')}), ${FIRST[route]} chosen first (${models?.at(-1)})`)
  if (route === 'anthropic') {
    await shot('models')
    const named = await realm.evaluate(() => [...document.querySelectorAll('#connect input, #connect select, #connect button, #connect a')].filter((e) => !e.closest('[hidden]')).map((e) => ({ tag: e.tagName, name: e.labels?.[0]?.textContent?.trim() || e.getAttribute('aria-label') || e.textContent.trim() })))
    check(named.every((n) => n.name), `every control in the panel has a name a screen reader says (${named.map((n) => n.name).join(' | ')})`)
    const link = await realm.evaluate(() => { const a = document.querySelector('#connect .get'); return { target: a.target, rel: a.rel, href: a.href } })
    check(link.target === '_blank' && /noopener/.test(link.rel) && /noreferrer/.test(link.rel) && link.href.startsWith('https://'), `the way to the provider's keys opens a new tab with no opener and no referrer (${link.href})`)
    await page.keyboard.press('Enter')
  } else await realm.click('#connect .go')
  const done = await ended()
  const there = done.state === 'there' ? await stands(done) : { sampled: 0, held: 0 }
  check(done.state === 'there' && asked.answers === answers0 + 1 && there.sampled > 0 && there.held === there.sampled, `${route}: connected, the same wish is made and stands (${done.state}${done.why ? `: ${done.why}` : ''}, ${done.name}; ${there.held} of ${there.sampled} cells in the core; asked ${asked.answers - answers0} time)`)
  const cost = await realm.waitForFunction(() => { const l = document.querySelector('#ai-line'); return l && !l.hidden && /tokens/.test(l.textContent) ? l.textContent : null }, null, { timeout: 5000 }).then((h) => h.jsonValue(), () => null)
  check(!!cost && /2,000 tokens/.test(cost), `${route}: the cost line shows (${cost})`)
  if (route === 'anthropic') await shot('made')
  check((await realm.evaluate(() => globalThis.engine.things.all.size)) === n0 + 1, `${route}: one thing more`)
  const kept = JSON.parse((await stored()) ?? 'null')
  check(kept?.route === route && kept.model === FIRST[route], `${route}: what is connected is kept under village.ai (${kept?.route}, ${kept?.model})`)
  await realm.evaluate(() => globalThis.engine.unmake())

  if (route === 'anthropic') {
    // The second tab follows: what was connected here answers there.
    const r = await tabAsk()
    check(r.text > 0, `the second tab follows a connection made in the first: its model answers (${r.text ?? r.why})`)
    // The failures, each with what to do next.
    const things = () => realm.evaluate(() => globalThis.engine.things.all.size)
    const t0 = await things()
    state.mode = 'cut'
    await wishFor('a stone birdbath')
    const cut = await ended(), cutSays = await lineSays()
    check(cut.state === 'refused' && (await things()) === t0 && /part way/.test(cutSays), `a stream cut part way says so and makes nothing (${cutSays})`)
    await shot('cut')
    state.mode = 'slow'
    await wishFor('a stone birdbath')
    await realm.waitForFunction(() => /Stop/.test(document.querySelector('#ai-line button')?.textContent ?? '') && !document.querySelector('#ai-line').hidden, null, { timeout: 30_000 })
    await realm.waitForTimeout(400)
    await shot('making')
    const tStop = Date.now()
    await realm.click('#ai-line button')
    const stopped = await ended(), stopSays = await lineSays()
    check(stopped.state === 'refused' && Date.now() - tStop < 5000 && (await things()) === t0 && /Stopped/.test(stopSays), `Stop stops at once and makes nothing (${Date.now() - tStop} ms: ${stopSays})`)
    state.mode = 'echo'
    await wishFor('a stone birdbath')
    await ended()
    const limitSays = await lineSays()
    check(/limit/.test(limitSays) && !limitSays.includes(KEYS.anthropic), `a limit says so, without the key it quoted (${limitSays})`)
    await shot('limit')
    state.mode = 'refuse'
    await wishFor('a stone birdbath')
    const back = await panel(), reason = await realm.evaluate(() => document.querySelector('#connect .said')?.textContent)
    check(back && /did not take/.test(reason ?? ''), `a key the provider refuses leads back to the panel, with the reason (${reason})`)
    await shot('refused')
    await page.keyboard.press('Escape')
    const refusedDone = await ended()
    check(refusedDone.state === 'refused' && (await things()) === t0 && (await stored()) === null, `let go, nothing is made, and the refused key is not kept (${refusedDone.why})`)
    state.mode = 'ok'
    // Connected again, by the settings key this time, to forget it there.
    await settingsKey()
    await panel()
    await realm.fill('#connect-key', KEYS.anthropic); await realm.press('#connect-key', 'Enter')
    await realm.waitForFunction(() => document.querySelector('#connect select')?.options.length, null, { timeout: 15_000 })
    await realm.click('#connect .go')
    await realm.waitForFunction(() => /Your own AI/.test(document.querySelector('#connect-h')?.textContent ?? ''), null, { timeout: 5000 }).catch(async (e) => { await shot('failed'); console.log(await realm.evaluate(() => [document.querySelector('#connect')?.open, document.querySelector('#connect-h')?.textContent, document.querySelector('#connect .said')?.textContent, localStorage.getItem('village.ai') ? 'kept' : 'none'].join(' | '))); throw e })
    await shot('connected')
  } else {
    await settingsKey()
    await panel()
  }
  // Forgotten: one press, and it is gone from this browser.
  const shown = await realm.evaluate(() => document.querySelector('#connect .on')?.textContent ?? '')
  check(/Connected/.test(shown) && /Ending in/.test(shown), `${route}: the panel says what is connected, by name (${shown.replace(/\s+/g, ' ').trim()})`)
  await realm.click('#connect .forget')
  check((await stored()) === null, `${route}: forget, and nothing is kept under village.ai`)
  await page.keyboard.press('Escape')
  if (route === 'anthropic') {
    const r = await tabAsk()
    check(r.why === 'let go' && r.offered === 2, `the second tab follows the forgetting: it offers to connect again (offered ${r.offered})`)
  }
}
// And the next new wish asks again.
await wishFor('a brass telescope')
check(await offered(), 'after forgetting, the next new wish asks to connect again')
await page.keyboard.press('Escape')
await ended()
check(!asked.prompts.some((p) => /host wish/.test(p)) && asked.prompts.every((p) => !/sk-host-given/.test(p)), `nothing a host page said reached a model (${asked.prompts.length} questions asked)`)

// ── The secret ──
const keys = Object.values(KEYS)
const leaks = []
for (const r of requests) {
  const said = JSON.stringify([r.url, r.headers, r.body]), own = ROUTES.find((k) => HOSTS[k] === new URL(r.url).hostname)
  for (const [route, key] of Object.entries(KEYS)) if (said.includes(key) && own !== route) leaks.push(`request to ${r.url}`)
  if (keys.some((k) => r.url.includes(k))) leaks.push(`in an address: ${r.url}`)
}
for (const line of consoled) if (keys.some((k) => line.includes(k))) leaks.push(`console: ${line.slice(0, 80)}`)
for (const [name, p] of [['realm', realm], ['second tab', second]]) {
  if (p === second) await p.evaluate(() => { globalThis.engine = globalThis.conn })
  const seen = await p.evaluate(() => {
    const out = { address: location.href + ' ' + history.length, dom: document.documentElement.outerHTML + ' ' + document.body.innerText, storage: {}, engine: [] }
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== 'village.ai') out.storage[k] = localStorage.getItem(k) }
    // Everything `engine` holds that can be reached in a few steps, without calling anything.
    const seen = new Set(), walk = (v, depth) => {
      if (v === null || v === undefined || depth > 4) return
      if (typeof v === 'string') { out.engine.push(v); return }
      if (typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v) || v instanceof Node) return
      seen.add(v)
      for (const k of Object.keys(v).slice(0, 400)) { const d = Object.getOwnPropertyDescriptor(v, k); if (d && 'value' in d) walk(d.value, depth + 1) }
    }
    walk(globalThis.engine, 0)
    return out
  })
  // The password field's value is a property, never markup: it is in none of these.
  for (const [where, text] of [['address', seen.address], ['DOM', seen.dom], ['storage', JSON.stringify(seen.storage)], ['engine', seen.engine.join('\n')]]) if (keys.some((k) => text.includes(k))) leaks.push(`${name} ${where}`)
}
const heard = await page.evaluate(() => window.heard)
if (heard.some((m) => keys.some((k) => m.includes(k)))) leaks.push('a message to the host')
check(leaks.length === 0, `the key went nowhere but its own provider, the field and village.ai (${requests.length} requests, ${consoled.length} console lines, ${heard.length} messages to the host${leaks.length ? `; LEAKED: ${leaks.slice(0, 4).join(' | ')}` : ''})`)
const fetched = ours(from)
check(fetched.length >= 2, `connect.js and models.js came once needed (${[...new Set(fetched)].join(', ')})`)

check(!errors.length, `no errors on the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
back()
console.log(failures.length ? `sf-connect: ${failures.length} failed` : 'sf-connect: ok (no provider was asked and no model was run)')
process.exit(failures.length ? 1 : 0)
