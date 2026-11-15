// Pictures of the Bay (#373) from a page server that holds its packs, for looking at.
//   node serve.mjs --port 5920 &   then
//   node bay/shot.mjs --name first [--views "x,y,z,yaw,pitch;..."] [--hour 15] [--size 1280x720] [--where] [--query "&walk=1"]      (metres, degrees)
// A height written `+1.7` is that far over the ground there (read from the first square's pack).
// Pictures go to ~/.village/engine/bay/shots/<name>-<n>.png, with what the page said of each.
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, has } from '../test/kit.mjs'

const out = join(homedir(), '.village', 'engine', 'bay', 'shots')
mkdirSync(out, { recursive: true })
const pack = readFileSync(join(homedir(), '.village', 'engine', 'bay', 'packs', `${arg('square', '551.7_4183.5')}.bay`))
const head = new Int32Array(pack.buffer, pack.byteOffset, 16), heights = new Int16Array(pack.buffer, pack.byteOffset + 64, head[5] * head[5])
/** The ground at a place, in metres. */
const ground = (x, z) => heights[Math.round((z * 10 - head[7]) / head[4]) * head[5] + Math.round((x * 10 - head[6]) / head[4])] / 10
const views = arg('views', '51950,+1.7,66115,64,4').split(';').map((v) => v.split(',')).map((v) => [Number(v[0]), v[1].startsWith('+') ? Math.round((ground(Number(v[0]), Number(v[2])) + Number(v[1])) * 100) / 100 : Number(v[1]), Number(v[2]), Number(v[3]), Number(v[4])])
const browser = await chrome(), page = await (await browser.newContext({ viewport: { width: Number(arg('size', '1280x720').split('x')[0]), height: Number(arg('size', '1280x720').split('x')[1]) }, deviceScaleFactor: 1 })).newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)) })
for (const [n, v] of views.entries()) {
  await page.goto(`${arg('server', 'http://127.0.0.1:5920')}/city?bay=${arg('bay', '1')}&fly=0&sound=0&scale=1&hour=${arg('hour', '15')}&at=${v[0]},${v[1]},${v[2]}&look=${v[3]},${v[4]}${arg('query', '')}`)
  await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0, null, { timeout: 120_000 })
  const began = Date.now()
  await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 120_000 }).catch(() => console.log('not all made in two minutes'))
  const made = Date.now() - began
  await page.waitForTimeout(Number(arg('wait', '3000')))
  const said = await page.evaluate(() => { const s = engine.world.stats; return { sectors: s.made, makeMs: Math.round(s.makeMs), poolMb: Math.round(s.poolUsed * 4 / (1 << 20)), boxes: s.boxes.map((b) => `${b.made}:${Math.round(b.ms)}`).join(' ') } })
  await page.addStyleTag({ content: `#hud, #aim, #boom, #tools, #over${has('where') ? '' : ', #where'} { display: none }` })
  await page.screenshot({ path: join(out, `${arg('name', 'shot')}-${n}.png`) })
  console.log(`${arg('name', 'shot')}-${n}: ${v.join(',')}  made in ${made} ms`, JSON.stringify(said))
}
await browser.close()
process.exit(0)
