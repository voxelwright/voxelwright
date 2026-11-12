// What every check and tool here needs (#144): the page server and the installed Chrome with
// WebGPU. Run by itself a script starts its own; under `node test/all.mjs` they all share the
// one server and the one browser that it started (ENGINE_KIT says where).
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

export const here = new URL('..', import.meta.url).pathname
export const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
export const has = (name) => process.argv.includes(`--${name}`)
export const CHROME = { channel: 'chrome', headless: !has('headed'), args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }

/** Starts the page server on a port of its own; reports it is sent are thrown away unless a file is named. */
export async function serve(reports = '/dev/null') {
  const server = spawn('node', ['serve.mjs', '--port', '0', '--reports', reports], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { const m = /engine page on http:\/\/127\.0\.0\.1:(\d+)/.exec(String(chunk)); if (m) resolve(Number(m[1])) })
    server.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
  })
  return { url: `http://127.0.0.1:${port}`, stop: () => server.kill() }
}

/**
 * A server and a browser, a list of failures and how to finish. `check` prints and keeps what failed;
 * `finish(name)` closes what this script started and ends the process, failed if anything did.
 */
export async function start() {
  const shared = process.env.ENGINE_KIT ? JSON.parse(process.env.ENGINE_KIT) : null
  const server = shared ? null : await serve()
  const browser = shared ? await chromium.connect(shared.ws) : await chromium.launch(CHROME)
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
    await p.goto(`${url}/city?fly=0&${query}`)
    // Beside other checks on one GPU the engine can take a while to come up.
    await p.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
    return p
  }
  const url = shared ? shared.url : server.url
  const finish = async (name) => {
    if (shared) await browser.close().catch(() => {})   // a connection: closing it leaves the shared browser running
    else { await browser.close(); server.stop() }
    if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
    console.log(`${name}: ok`)
    process.exit(0)
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
