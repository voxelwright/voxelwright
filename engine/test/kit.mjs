// What every check and tool here needs (#144): the page server and the installed Chrome with
// WebGPU. Run by itself a script starts its own; under `node test/all.mjs` they all share the
// one server and the one browser that it started (ENGINE_KIT says where).
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright'

export const here = new URL('..', import.meta.url).pathname
export const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
export const has = (name) => process.argv.includes(`--${name}`)
export const CHROME = { channel: 'chrome', headless: !has('headed'), args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }

/** The browsers a check may draw with, by name. Take a turn first (`turn`, `quiet`). */
export const browsers = { chrome: () => chromium.launch(CHROME), webkit: () => webkit.launch({ headless: CHROME.headless }) }

// One GPU, and every thread's checks draw on it. Whatever opens a browser to draw takes a turn first: one of a few
// places, for this whole machine, held until the process ends. Without it four lanes' checks at once took 90 s to
// bring a page up and failed for that alone (November 13). A place is a folder (made or not, at once) holding the
// number of the process that has it, and nothing else, so processes started before a change here still read it; one
// whose process is gone, or that nobody said they had for ten seconds, is free. Whoever holds a turn says so to what
// it starts (ENGINE_TURN), and whoever holds every turn says which processes hold them (ENGINE_QUIET), so a check
// that runs other checks, or a wrapper that holds the GPU for a command, is not waited on by what it started (#450: a
// check under a private wrapper once waited 90 minutes on its own parent). A wait names who holds the turns and
// fails after twenty minutes (ENGINE_TURN_WAIT, in seconds), rather than hang.
const TURNS = Number(process.env.ENGINE_TURNS ?? 2), PLACES = join(homedir(), '.village', 'engine', 'turns')
/** Who wants every turn and waits for them (`quiet`): a file each, named by its process, saying since when. */
const WANTING = join(homedir(), '.village', 'engine', 'turns-wanted')
const WAIT = Number(process.env.ENGINE_TURN_WAIT ?? 1200) * 1000
/** How long one taking a single turn stands aside for one that wants every turn, at most. */
const YIELD = 10 * 60_000
/** How long `quiet` holds what it has before it stands aside for a while (ENGINE_TURN_WATCH, seconds: shorter in test/turns.mjs). */
const WATCH = Number(process.env.ENGINE_TURN_WATCH ?? 120) * 1000
const running = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Clears a place away. Two processes may clear the same abandoned place at once, or one may take it again while another clears it (ENOTEMPTY, ENOENT): then it is simply tried for again. */
const clear = (place) => { try { rmSync(place, { recursive: true, force: true }) } catch { /* someone else's doing: tried again */ } }
/** Who has a place: their process number, or NaN where nobody has said yet. */
const holderOf = (place) => { try { return Number(readFileSync(join(place, 'pid'), 'utf8')) } catch { return NaN } }
const placeOf = (n) => join(PLACES, String(n))
/** When a process started (ms since 1970), asked of `ps` at most every half minute; NaN where it cannot say. */
const startedAt = new Map()
const started = (pid) => {
  const was = startedAt.get(pid)
  if (was && Date.now() - was.asked < 30_000) return was.at
  const said = (spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).stdout ?? '').trim()
  const at = said ? Date.parse(said) : NaN
  startedAt.set(pid, { at, asked: Date.now() })
  return at
}
/** Whether the process that said something at `since` (ms) is still there: alive, and not another that has its number since (started after it said so). */
const alive = (pid, since) => running(pid) && !(started(pid) > since + 1000)
/** Frees a taken place whose holder is gone, or that nobody said they had for ten seconds (stopped between taking it and saying so). */
const reclaim = (place) => {
  const pid = holderOf(place)
  let said = NaN
  try { said = statSync(join(place, 'pid')).mtimeMs } catch { /* not said yet */ }
  if (Number.isInteger(pid) && pid > 0) { if (!alive(pid, said)) clear(place); return }
  try { if (Date.now() - statSync(place).mtimeMs > 10_000) clear(place) } catch { /* gone already */ }
}
/** Every place this process holds, and its wish for every turn, given back however it ends. */
const holding = new Set()
process.on('exit', () => { for (const back of holding) back() })
/** One try at a place nobody has (or whose holder is gone): how to give it back, or null. */
const take = () => {
  mkdirSync(PLACES, { recursive: true })
  for (let n = 0; n < TURNS; n++) {
    const place = placeOf(n)
    try { mkdirSync(place) } catch { reclaim(place); continue }
    // (Between making the place and saying who has it, someone who took it for abandoned may clear it away: then it is not had, and is tried for again.)
    try { writeFileSync(join(place, 'pid'), String(process.pid)) } catch { continue }
    let held = true
    // Given back only while it is still this process's (someone may have taken it for abandoned meanwhile).
    const back = () => { if (held) { held = false; holding.delete(back); if (holderOf(place) === process.pid) clear(place) } }
    holding.add(back)
    return back
  }
  return null
}
/** Who holds the turns now: each place's process, what it runs and since when (the place's pid file, for holders of any version). */
export function holders() {
  return Array.from({ length: TURNS }, (_, n) => {
    const place = placeOf(n), pid = holderOf(place)
    let since = null, what = '?'
    try { since = statSync(join(place, 'pid')).mtime } catch { /* not said yet, or free */ }
    if (Number.isInteger(pid) && pid > 0) {
      const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
      what = (ps.stdout ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'gone'
    }
    return { place: String(n), pid, what, since }
  }).filter((h) => h.since || Number.isInteger(h.pid))
}
const told = () => holders().map((h) => `pid ${h.pid} (${h.what}) since ${h.since ? h.since.toTimeString().slice(0, 8) : '?'}`).join('; ') || 'nobody'
/** Says, while a wait goes on, who it waits on: after two seconds, and every five minutes. Throws once `limit` is past, or returns false where the caller would rather have nothing (`soft`). */
const waiter = (what, limit, soft) => {
  const began = Date.now()
  let said = 0
  return () => {
    const now = Date.now(), waited = now - began
    if (waited > limit) {
      if (soft) return false
      throw new Error(`waited ${waited < 120_000 ? `${Math.round(waited / 1000)} s` : `${Math.round(waited / 60_000)} min`} for ${what} on the GPU, and gave up: held by ${told()}`)
    }
    if (waited > 2000 && now - said > 5 * 60_000) { said = now; console.log(`  waiting for ${what} on the GPU${said - began > 60_000 ? ` (${Math.round(waited / 60_000)} min so far)` : ''}: held by ${told()}`) }
    return true
  }
}
/** Who holds each place now (its process's number, NaN for none), place by place. */
const held = () => Array.from({ length: TURNS }, (_, n) => holderOf(placeOf(n)))
/**
 * The live wishes for every turn but this process's own, oldest first: [since, pid]. One whose process is gone, or
 * that is older than any wait goes on (a process stopped by a signal says nothing as it goes), is cleared away.
 */
const wishes = () => {
  let names = []
  try { names = readdirSync(WANTING).filter((n) => /^\d+$/.test(n)) } catch { return [] }
  const live = []
  for (const n of names) {
    const pid = Number(n), file = join(WANTING, n)
    let since = NaN
    try { since = Number(readFileSync(file, 'utf8')) } catch { continue }
    if (pid === process.pid) continue
    if (!(since > 0) || Date.now() - since > WAIT + 60_000 || !alive(pid, since)) rmSync(file, { force: true })
    else live.push([since, pid])
  }
  return live.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}
/** Says this process waits for every turn, until the returned function is called. */
const wish = () => {
  mkdirSync(WANTING, { recursive: true })
  const file = join(WANTING, String(process.pid)), since = Date.now()
  // (Written whole and then named, so that nobody reads it half written.)
  writeFileSync(`${file}.new`, String(since))
  renameSync(`${file}.new`, file)
  let on = true
  const done = () => { if (on) { on = false; holding.delete(done); rmSync(file, { force: true }) } }
  holding.add(done)
  return { since, done }
}
/**
 * Whether every turn is this process's already: taken by its own `quiet`, or by processes that started it and still
 * hold every one of them (ENGINE_QUIET: the holders `quiet` had, by number). Only `quiet` says so: a run of checks
 * that holds two turns for two checks (test/all.mjs) does not make either of them alone.
 */
export const hasEveryTurn = () => {
  const by = (process.env.ENGINE_QUIET ?? '').split(',').map(Number).filter((pid) => Number.isInteger(pid) && pid > 0)
  return by.length > 0 && held().every((pid) => by.includes(pid) && running(pid))
}
/** The turn this process took for itself (`turn()`): `back` gives it back, or is null while `quiet` has given it back to wait (owed, and taken again before `quiet` returns). */
let own = null
/**
 * Waits for a turn on the GPU and takes it. Returns how to give it back (done anyway when the process ends). `mine:
 * false` takes it for a process about to be started, which is then told it has one. While another process waits for
 * every turn (`quiet`), it stands aside for up to ten minutes of that wait, so that a timing is not starved by checks
 * that hand turns on to each other.
 */
export async function turn({ mine = true } = {}) {
  if (process.env.ENGINE_TURN || hasEveryTurn()) return () => {}
  const wait = waiter('a turn', WAIT, false)
  for (;;) {
    const back = wishes().some(([since]) => Date.now() - since < YIELD) ? null : take()
    if (back) {
      if (!mine) return back
      own = { back }
      process.env.ENGINE_TURN = '1'
      return () => { own?.back?.(); own = null; delete process.env.ENGINE_TURN }
    }
    wait()
    await sleep(500)
  }
}
/**
 * Every turn on the GPU at once (#367), for a timing that no other thread's check may draw beside. It says it waits
 * (so that `turn` stands aside), takes each turn as it comes free and keeps it. A turn the process that started this
 * one holds for it (ENGINE_TURN) counts as one of them. Where two each hold a turn of their own and want every turn,
 * the one that asked later gives its own back to the other and waits (`idle(true)` first, so that its page stops
 * drawing; `idle(false)` once it has its turn again); and one that has held what it has for two minutes gives it all
 * back and stands aside for a while (another may be at the same, from a kit before this one, which says nothing of
 * it). Returns how to give back what it took, keeping the process's own turn. Waits twenty minutes and throws; with
 * `within` (ms) it gives up after that and returns null, never having given its own turn back. Either way it keeps
 * nothing it took, and has its own turn again.
 */
export async function quiet({ within, idle = async () => {} } = {}) {
  if (hasEveryTurn()) return () => {}
  const lent = !!process.env.ENGINE_TURN && !own, need = TURNS - (lent ? 1 : 0)
  const wait = waiter('every turn', within ?? WAIT, within !== undefined)
  /** What this has taken beyond the process's own turn; how many places it has with that. */
  const mine = [], count = () => mine.length + (own?.back ? 1 : 0)
  const release = () => { for (const back of mine.splice(0)) back() }
  const me = wish()
  let idled = false, asideUntil = 0, standAt = Date.now() + WATCH
  /** The process's own turn, if it gave it back, taken again: first, or at any cost on the way out. */
  const refill = async (more) => { own.back = more; if (idled) { idled = false; await idle(false) } }
  try {
    for (;;) {
      if (count() >= need) {
        const said = held().join(',')
        process.env.ENGINE_TURN = '1'
        process.env.ENGINE_QUIET = said
        const taken = mine.splice(0)
        return () => {
          if (process.env.ENGINE_QUIET === said) delete process.env.ENGINE_QUIET
          for (const back of taken) back()
          if (!own && !lent) delete process.env.ENGINE_TURN
        }
      }
      // One that asked first is let through: what this holds is given back to it, and nothing taken. Not by one on a
      // turn lent to it (ENGINE_TURN), which cannot give that back, nor by one that gives up (`within`) with a turn of
      // its own, which it keeps: those go on taking, and the other's standing aside lets them through.
      const first = (within === undefined || !own) && (!!own || !lent) && wishes().some(([since, pid]) => since < me.since || (since === me.since && pid < process.pid))
      if (first) release()
      if (within === undefined && Date.now() > standAt) {
        release()
        asideUntil = Date.now() + (WATCH / 15) * (1 + Math.random()); standAt = asideUntil + WATCH
        if (own?.back) { idled = true; await idle(true); own.back(); own.back = null }
      }
      if (first && within === undefined && own?.back) { idled = true; await idle(true); own.back(); own.back = null }
      const more = first || Date.now() < asideUntil ? null : take()
      if (more && own && !own.back) await refill(more)
      else if (more) mine.push(more)
      else { if (!wait()) { release(); return null } await sleep(200) }
    }
  } catch (e) {
    release()
    while (own && !own.back) { const back = take(); if (back) await refill(back); else await sleep(500) }
    throw e
  } finally { me.done() }
}
/**
 * A timed bound (#450): how soon a first visit shows the place, a frame time, what a part costs the GPU. Other lanes
 * draw on this GPU too, so a bound missed beside them is measured once more with every turn on it held (`quiet`),
 * and fails only if it is missed again, or if the GPU cannot be had alone in twenty minutes; the line says what each
 * try gave. Only for what a busy GPU slows: not ratios, not looks, not bytes. `check(ok, line)` is the script's own;
 * `measure()` gives a result, `passes(result)` says whether it is within the bound and `say(result)` the line.
 * `first`: a result already measured, in place of measuring it here; `firstAlone`: that it was measured with every
 * turn held already (then a miss fails at once). `again()` is called as the second try begins (a script's own clock,
 * say); `idle(on)` stops and starts the script's drawing while it waits without a turn (`quiet`). Returns the result
 * the check went by.
 */
export async function timed({ check, measure, passes, say, first, firstAlone = false, again = () => {}, idle }) {
  const once = first ?? await measure()
  if (passes(once)) { check(true, say(once)); return once }
  if (firstAlone) { check(false, `${say(once)}, measured with every turn on the GPU held`); return once }
  console.log(`  slow ${say(once)}: measured again with every turn on the GPU held`)
  again()
  let give
  try { give = await quiet({ idle }) } catch (e) { check(false, `${say(once)}, and it could not be measured alone: ${e.message}`); return once }
  try {
    const alone = await measure()
    check(passes(alone), `${say(alone)}, measured alone (beside other checks: ${say(once)})`)
    return alone
  } finally { give() }
}
/** A browser to draw with: the one a run of all the checks shares, or one of its own. Either way after a turn. */
export async function chrome() {
  await turn()
  const shared = process.env.ENGINE_KIT ? JSON.parse(process.env.ENGINE_KIT) : null
  return shared ? chromium.connect(shared.ws) : chromium.launch(CHROME)
}

/** Starts the page server on a port of its own; reports it is sent are thrown away unless a file is named. */
export async function serve(reports = '/dev/null', more = []) {
  const server = spawn('node', ['serve.mjs', '--port', '0', '--reports', reports, ...more], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { const m = /engine page on http:\/\/127\.0\.0\.1:(\d+)/.exec(String(chunk)); if (m) resolve(Number(m[1])) })
    server.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
  })
  return { url: `http://127.0.0.1:${port}`, stop: () => server.kill() }
}

/**
 * A server and a browser, a list of failures and how to finish. `check` prints and keeps what failed;
 * `finish(name)` closes what this script started and ends the process, failed if anything did (or with a code and
 * a word of its own, if nothing failed).
 */
export async function start() {
  // ENGINE_SHARED: the check is run in a shared world (world.mjs), on a server of its own that keeps one in a file
  // of its own, and every page it opens is in that world. The checks that break things are run this way too
  // (test/shared.mjs): what holds for the worker in the page must hold for the world behind the server.
  const world = process.env.ENGINE_SHARED ? join(tmpdir(), `engine-world-${process.pid}-${Date.now()}.log`) : null
  const shared = process.env.ENGINE_KIT && !world ? JSON.parse(process.env.ENGINE_KIT) : null
  const server = shared ? null : await serve('/dev/null', world ? ['--world', world] : [])
  const browser = await chrome()
  const failures = []
  const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
  /** A page that says what goes wrong on it: its errors fail the check, its warnings are printed. */
  const page = async ({ size = [1280, 720], dpr = 2, phone = false } = {}) => {
    const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dpr, ...(phone ? { hasTouch: true, isMobile: true, screen: { width: size[0], height: size[1] } } : {}) })
    const p = await context.newPage()
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  page ${m.type()}: ${m.text().slice(0, 600)}`) })
    p.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
    return p
  }
  /** The city page, not flying, once its engine is up. */
  const city = async (query = '', options) => {
    const p = await page(options)
    const broke = new Promise((_, reject) => {
      p.once('pageerror', (e) => reject(new Error(`the page failed as it started: ${e.message}`)))
      // A file of the page that the server could not give (one that does not parse, say).
      p.on('response', (r) => { if (r.status() >= 500) reject(new Error(`the page failed as it started: ${r.status()} for ${r.url()}`)) })
    })
    broke.catch(() => {})   // it may fail before anything waits on it
    await p.goto(`${url}/city?fly=0&${world ? 'shared=1&' : ''}${query}`)
    // Beside other checks on one GPU the engine can take a while to come up. A page that fails as it starts (a shader
    // that does not compile) will never have one: `broke` says so at once, not after the wait.
    await Promise.race([p.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 }), broke])
    return p
  }
  const url = shared ? shared.url : server.url
  const finish = async (name, code = 0, word = 'ok') => {
    if (shared) await browser.close().catch(() => {})   // a connection: closing it leaves the shared browser running
    else { await browser.close(); server.stop() }
    if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
    console.log(`${name}: ${word}`)
    process.exit(code)
  }
  return { url, browser, page, city, check, failures, finish }
}

/** Waits until the town round the eye is made, nothing waits to be made again, nothing is falling and (if asked) the sun's maps are drawn. */
export const still = (page, { sun = false, limit = 120_000 } = {}) => page.waitForFunction((sun) => {
  const e = globalThis.engine, s = e.world.stats
  return s.wanted === 0 && s.stale === 0 && s.ready > 0 && !e.settling && e.dropping === 0 && (!sun || (e.march.sun.undrawn === 0 && e.march.sun.spoiled === 0))
}, sun, { timeout: limit })

/**
 * Films what the page's canvas shows, as it shows it, for `seconds` while `act` runs: a WebM and every
 * gap between the page's own frames. The film is real time; nothing is slowed or stepped.
 */
export async function film(page, seconds, act = async () => {}) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas'), stream = canvas.captureStream(60)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 12_000_000 })
    const parts = [], gaps = []
    recorder.ondataavailable = (e) => parts.push(e.data)
    let last = performance.now(), on = true
    const tick = (now) => { gaps.push(now - last); last = now; if (on) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    recorder.start()
    globalThis.filming = { stop: () => new Promise((done) => {
      on = false
      recorder.onstop = async () => {
        const bytes = new Uint8Array(await new Blob(parts).arrayBuffer())
        let text = ''
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        done({ webm: btoa(text), gaps: gaps.slice(1) })
      }
      recorder.stop()
    }) }
  })
  const t0 = Date.now()
  await act()
  await page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - t0)))
  const { webm, gaps } = await page.evaluate(() => globalThis.filming.stop())
  // Where the long gaps were, seconds in: a hitch is worth knowing the moment of.
  let at = 0
  const long = []
  for (const g of gaps) { at += g; if (g > 25) long.push(`${g.toFixed(0)} ms at ${(at / 1000).toFixed(1)} s`) }
  gaps.sort((a, b) => a - b)
  return { webm: Buffer.from(webm, 'base64'), frames: gaps.length, p50: gaps[gaps.length >> 1], p95: gaps[Math.floor(gaps.length * 0.95)], worst: gaps.at(-1), long, seconds: at / 1000 }
}

/** The picture as it is on the screen, made small: how bright on the whole (0 to 1), what share of it is bright, and its mean red, green and blue. */
export async function seen(page) {
  const png = (await page.screenshot()).toString('base64')
  return page.evaluate(async (png) => {
    const picture = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
    const paper = new OffscreenCanvas(160, 90).getContext('2d')
    paper.drawImage(picture, 0, 0, 160, 90)
    const d = paper.getImageData(0, 0, 160, 90).data, n = d.length / 4
    let sum = 0, bright = 0
    const rgb = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 765
      sum += l
      if (l > 0.45) bright++
      for (let c = 0; c < 3; c++) rgb[c] += d[i + c] / 255 / n
    }
    return { mean: sum / n, bright: bright / n, rgb }
  }, png)
}
