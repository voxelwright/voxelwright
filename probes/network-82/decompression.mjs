// SPIKE PROTOTYPE (#82, network optimizations). Not a check.
//
// Which codecs the installed Chrome's DecompressionStream takes, and how fast it reads the landing pack. No WebGPU, so
// no turn is taken.
//
//   node probes/network-82/decompression.mjs <dir with landing.pack and landing.pack.br, from pack-bench.mjs --write>
import { chromium } from '../../engine/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
import { gzipSync, zstdCompressSync, constants as Z } from 'node:zlib'
const dir = process.argv[2], raw = readFileSync(`${dir}/landing.pack`), br = readFileSync(`${dir}/landing.pack.br`)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.goto('about:blank')
const version = await browser.version()
const out = await page.evaluate(async ({ br, gz, zs, rawLen }) => {
  const res = {}
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  for (const [name, fmt, data] of [['br', 'br', br], ['brotli', 'brotli', br], ['gzip', 'gzip', gz], ['zstd', 'zstd', zs]]) {
    try {
      const bytes = b64(data), times = []
      let n = 0
      for (let i = 0; i < 7; i++) { const t = performance.now(); const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer(); times.push(performance.now() - t); n = buf.byteLength }
      times.sort((a, b) => a - b)
      res[name] = { ok: n === rawLen, in: bytes.length, out: n, medianMs: Math.round(times[3] * 10) / 10 }
    } catch (e) { res[name] = { ok: false, error: String(e.message ?? e).slice(0, 120) } }
  }
  return res
}, { br: br.toString('base64'), gz: gzipSync(raw, { level: 9 }).toString('base64'), zs: zstdCompressSync(raw, { params: { [Z.ZSTD_c_compressionLevel]: 19 } }).toString('base64'), rawLen: raw.length })
console.log('Chrome', version, JSON.stringify(out, null, 1))
await browser.close()
