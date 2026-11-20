// The SF realm's billboards as data (#450): sf/boards.json says where each board stands, what it is and what it shows
// (page/boards.ts `SignsFile`), and sf/build.mjs puts it in the page's record. This is the tool that file is made with.
//
//   node sf/boards.mjs edit [--port 5935] [--no-build] [--dist dist-sf]
//       Builds the realm, serves it and prints an address ending `?boards=edit`: the realm with a panel to add a
//       board on the roof one is looking at (or on the next roof the rule proposes), to move, turn, size and word it,
//       and to save. Every change is seen at once; `save` writes sf/boards.json here and into the served page, so a
//       reload shows the file as it is.
//   node sf/boards.mjs propose [--count 6] [--no-build]
//       Prints the roofs the rule proposes from the park's camera (level roof, at its edge, seen whole, facing the
//       eye), best first, as records without an id or content. An offer: nothing is written.
//   node sf/boards.mjs check
//       Says what is wrong with sf/boards.json, if anything.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const FILE = join(root, 'sf', 'boards.json')
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const has = (name) => process.argv.includes(`--${name}`)

/** What is wrong with a signs file, one line each: none if it can be laid. */
export function wrong(file) {
  const out = [], whole = (v) => Array.isArray(v) && v.every(Number.isFinite)
  if (file?.version !== 1 || !Array.isArray(file.boards)) return ['not a signs file: { "version": 1, "boards": [] }']
  const ids = new Set(['banner'])
  for (const [i, b] of file.boards.entries()) {
    const say = (what) => out.push(`board ${i} (${b?.id ?? 'no id'}): ${what}`)
    if (typeof b?.id !== 'string' || !/^[a-z0-9-]+$/.test(b.id)) say('its id is lower-case letters, digits and hyphens')
    else if (ids.has(b.id)) say('its id is taken')
    ids.add(b?.id)
    if (typeof b.name !== 'string' || !b.name.trim()) say('it has no name for a link to say')
    if (b.type !== 'lettering' && b.type !== 'digital') say('its type is lettering or digital')
    if (!whole(b.building) || b.building.length !== 2) say('its building is a point on a roof: [x, z] in cells')
    if (!whole(b.at) || b.at.length !== 3) say('it stands at [x, y, z] in cells')
    if (![0, 1, 2, 3].includes(b.facing)) say('it faces 0 west, 1 north, 2 east or 3 south')
    if (b.type === 'lettering' ? !(b.size > 0 && b.size <= 12) : !(whole(b.size) && b.size.length === 2 && b.size.every((v) => v >= 1.6 && v <= 40))) say('its size is a letter\'s height in metres (lettering) or [wide, high] in metres (digital)')
    if (b.type === 'lettering' ? typeof b.content?.text !== 'string' : typeof b.content?.text !== 'string' && typeof b.content?.image !== 'string') say('lettering shows { text }; a digital board { text } or { image }')
    if (b.to !== undefined && (typeof b.to !== 'string' || !b.to.startsWith('/'))) say('it leads to a path of the site, from /')
  }
  const t = file.banner
  if (t && !(whole(t.around) && t.radius > 0 && t.height > 0 && t.speed > 0 && whole(t.size) && (typeof t.content?.text === 'string' || typeof t.content?.image === 'string'))) out.push('the banner needs content, around [x, z], radius, height, speed and size [long, high]')
  return out
}

/** The realm's record in a built page, with these signs in it. Its Brotli copy would be the old page: taken away. */
function into(dist, file) {
  const page = join(dist, 'sf', 'index.html'), html = readFileSync(page, 'utf8'), tag = /(<script type="application\/json" id="realm">)([\s\S]*?)(<\/script>)/
  if (!tag.test(html)) throw new Error(`${page} has no realm record: build it (node sf/build.mjs)`)
  writeFileSync(page, html.replace(tag, (_, a, json, c) => a + JSON.stringify({ ...JSON.parse(json), signs: file }).replace(/</g, '\\u003c') + c))
  rmSync(`${page}.br`, { force: true })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [what] = process.argv.slice(2), dist = join(root, arg('dist', 'dist-sf'))
  if (what === 'check') {
    const said = wrong(JSON.parse(readFileSync(FILE, 'utf8')))
    console.log(said.length ? said.join('\n') : 'sf/boards.json can be laid')
    process.exit(said.length ? 1 : 0)
  }
  if (what !== 'edit' && what !== 'propose') { console.error('node sf/boards.mjs edit | propose | check'); process.exit(1) }
  if (!has('no-build')) {
    const built = spawnSync(process.execPath, [join(root, 'sf', 'build.mjs'), '--out', dist], { cwd: root, encoding: 'utf8' })
    if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
  }
  const { plain } = await import('../player/serve.mjs')
  if (what === 'edit') {
    // The page's save: PUT /sf/boards.json.
    const extra = (req, res) => {
      if (req.method !== 'PUT' || new URL(req.url, 'http://x').pathname !== '/sf/boards.json') return false
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const file = JSON.parse(body), said = wrong(file)
          if (said.length) { res.writeHead(422, { 'Content-Type': 'text/plain' }); return res.end(said.join('\n')) }
          writeFileSync(FILE, JSON.stringify(file, null, 2) + '\n')
          into(dist, file)
          console.log(`saved: ${file.boards.length} boards (${file.boards.map((b) => b.id).join(', ')})`)
          res.writeHead(204); res.end()
        } catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end(String(e.message)) }
      })
      return true
    }
    const site = await plain(dist, '127.0.0.1', Number(arg('port', '5935')), { extra })
    console.log(`edit the billboards at ${site.url}/sf/index.html?boards=edit   (^C to stop)`)
  } else {
    const { chromium } = await import('playwright'), { CHROME, turn } = await import('../test/kit.mjs')
    const site = await plain(dist, '127.0.0.1', 0, {}), back = await turn(), browser = await chromium.launch(CHROME)
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
      await page.goto(`${site.url}/sf/index.html`)
      await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards, null, { timeout: 300_000 })
      await page.waitForTimeout(3000)
      console.log(JSON.stringify(await page.evaluate((n) => globalThis.engine.boards.propose(n), Number(arg('count', '6'))), null, 1))
    } finally { await browser.close(); site.stop(); back() }
  }
}
