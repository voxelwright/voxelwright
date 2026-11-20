import { chromium } from 'playwright'
import { CHROME, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { join } from 'node:path'
const site = await plain(join(here, 'dist-sf'))
const back = await turn()
const b = await chromium.launch(CHROME), p = await b.newPage({ viewport: { width: 800, height: 450 } })
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto(`${site.url}/sf/index.html`)
await p.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 120000 })
await p.waitForTimeout(3000)
console.log(JSON.stringify(await p.evaluate(async () => {
  const e = globalThis.engine, log = []
  const thing = e.alive.things.find((t) => t.alive && t.name === 'grey saloon' && e.alive.where(t))
  if (!thing) return 'none'
  const at = e.alive.where(thing).at
  Object.assign(e.pose, { x: at[0] / 10 - 6, y: at[1] / 10 + 3, z: at[2] / 10, yaw: Math.PI / 2, pitch: -0.2 })
  e.alive.mount(thing)
  for (let i = 0; i < 25; i++) { const w = e.alive.where(thing); log.push(w ? w.at.map(Math.round).join(',') : `null alive=${thing.alive} riding=${e.alive.riding === thing} mended=${JSON.stringify(e.mended)} n=${e.alive.things.length}`); e.alive.drive(thing, 1, 0, 0); await new Promise((r) => setTimeout(r, 200)) }
  return log
})))
await b.close(); site.stop(); back()
