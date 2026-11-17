// What every check and tool here needs (#144): the page server and the installed Chrome with
// WebGPU. Run by itself a script starts its own; under `node test/all.mjs` they all share the
// one server and the one browser that it started (ENGINE_KIT says where).
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
// number of the process that has it; one whose process is gone is free. Whoever holds a turn says so to what it
// starts (ENGINE_TURN), so a check that runs other checks does not wait on itself.
const TURNS = Number(process.env.ENGINE_TURNS ?? 2), PLACES = join(homedir(), '.village', 'engine', 'turns')
const running = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
/** Clears a place away. Two processes may clear the same abandoned place at once, or one may take it again while another clears it (ENOTEMPTY, ENOENT): then it is simply tried for again. */
const clear = (place) => { try { rmSync(place, { recursive: true, force: true }) } catch { /* someone else's doing: tried again */ } }
/** Waits for a turn on the GPU and takes it. Returns how to give it back (done anyway when the process ends). `mine: false` takes it for a process about to be started, which is then told it has one. */
export async function turn({ mine = true } = {}) {
  if (process.env.ENGINE_TURN) return () => {}
  mkdirSync(PLACES, { recursive: true })
  for (let waited = 0; ; waited++) {
    for (let n = 0; n < TURNS; n++) {
      const place = join(PLACES, String(n)), holder = join(place, 'pid')
      try { mkdirSync(place) } catch {
        // Taken: unless whoever took it is gone (or was stopped before it could say who it was).
        let pid = NaN
        try { pid = Number(readFileSync(holder, 'utf8')) } catch { /* not said yet */ }
        if (Number.isInteger(pid) ? !running(pid) : waited > 20) clear(place)
        continue
      }
      // (Between making the place and saying who has it, someone who took it for abandoned may clear it away: then it is not had, and is tried for again.)
      try { writeFileSync(holder, String(process.pid)) } catch { continue }
      let held = true
      const back = () => { if (held) { held = false; clear(place); if (mine) delete process.env.ENGINE_TURN } }
      process.on('exit', back)
      if (mine) process.env.ENGINE_TURN = '1'
      return back
    }
    if (waited === 4) console.log('  waiting for a turn on the GPU: other checks are drawing')
    await new Promise((r) => setTimeout(r, 500))
  }
}
/**
 * Every turn on the GPU at once (#367), for a timing that no other thread's check may draw beside. It takes one turn
 * and watches for the rest for two minutes (most checks are done in less); if whoever holds them is at something
 * long, it gives its own back for a while, so that nobody waits behind both, and tries again. Returns how to give
 * them all back.
 */
export async function quiet() {
  /** One try at a place nobody has (or whose holder is gone): how to give it back, or null. */
  const tryOne = () => {
    for (let n = 0; n < TURNS; n++) {
      const place = join(PLACES, String(n)), holder = join(place, 'pid')
      try { mkdirSync(place) } catch {
        let pid = NaN
        try { pid = Number(readFileSync(holder, 'utf8')) } catch { /* not said yet */ }
        if (Number.isInteger(pid) && !running(pid)) clear(place)
        continue
      }
      // (Between making the place and saying who has it, someone who took it for abandoned may clear it away: then it is not had, and is tried for again.)
      try { writeFileSync(holder, String(process.pid)) } catch { continue }
      let held = true
      const back = () => { if (held) { held = false; clear(place) } }
      process.on('exit', back)
      return back
    }
    return null
  }
  for (let tries = 0; ; tries++) {
    const mine = [await turn({ mine: false })]
    for (const until = Date.now() + 120_000; mine.length < TURNS && Date.now() < until;) {
      const more = tryOne()
      if (more) mine.push(more)
      else await new Promise((r) => setTimeout(r, 200))
    }
    if (mine.length === TURNS) {
      process.env.ENGINE_TURN = '1'
      return () => { for (const back of mine) back(); delete process.env.ENGINE_TURN }
    }
    for (const back of mine) back()
    if (tries === 0) console.log('  waiting for the GPU to be quiet: other checks are drawing')
    await new Promise((r) => setTimeout(r, 8000 + Math.random() * 8000))
  }
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
