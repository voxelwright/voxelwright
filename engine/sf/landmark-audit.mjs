// Automated structural fidelity gate for every city landmark in sf/heroes.json (#60).
// Samples the core's reach, lighting, ownership and face output at each landmark's bake resolution.
// With a release manifest, compare the planned ground coverage with the actual tile and surveyed sea records.
//
//   node engine/sf/landmark-audit.mjs [--manifest PATH]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { landmarkTiles } from './landmark-tiles.mjs'
import { roofAt } from './roof-profile.mjs'
import { place } from '../page/bay.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE = dirname(HERE)
const { values: { manifest, core: corePath } } = parseArgs({ options: { manifest: { type: 'string' }, core: { type: 'string' } } })

const wasm = readFileSync(corePath ?? join(ENGINE, 'page', 'core.wasm'))
const core = (await WebAssembly.instantiate(wasm, {})).instance.exports
const heroes = JSON.parse(readFileSync(join(HERE, 'heroes.json'), 'utf8'))
const cameras = JSON.parse(readFileSync(join(HERE, 'landmark-views.json'), 'utf8'))

const failures = []
const ok = (cond, msg) => { if (!cond) failures.push(msg) }

const seenSorts = new Set()
for (const h of heroes) {
  ok(typeof h.name === 'string' && h.name.length > 0, `landmark missing name: ${JSON.stringify(h)}`)
  const views = Object.values(cameras[h.name] ?? {})
  ok(views.length > 0 && views.every((v) => Array.isArray(v) && [5, 6].includes(v.length) && v.every(Number.isFinite) &&
    (v.length === 5 || (v[5] > 0 && v[5] < 180))),
    `${h.name}: missing a fixed review camera in landmark-views.json`)
  ok(Number.isInteger(h.sort) && !seenSorts.has(h.sort), `duplicate or invalid sort ${h.sort} (${h.name})`)
  seenSorts.add(h.sort)
  const reach = [0, 1, 2, 3, 4, 5].map((i) => core.hero_reach(h.sort, i))
  ok(reach.every(Number.isFinite) && reach[3] > reach[0] && reach[4] > reach[1] && reach[5] > reach[2], `${h.name}: invalid reach ${reach}`)
  const night = Array.from({ length: 12 }, (_, i) => core.hero_night(h.sort, i))
  ok(night.every(Number.isFinite), `${h.name}: missing hero_night rule`)
  const at = place(h.at[0], h.at[1]), toward = place(h.toward[0], h.toward[1])
  ok(Math.hypot(toward.x - at.x, toward.z - at.z) > 10, `${h.name}: degenerate toward vector`)
  if (h.only === 'night') continue

  // Sample a central block at the resolution used by the far baker.
  const step = Math.min(h.step ?? 8, 16)
  const s = step / 10
  const spanU = Math.min(180, reach[3] - reach[0])
  const spanY = Math.min(200, reach[4] - reach[1])
  const spanW = Math.min(180, reach[5] - reach[2])
  const u0 = (reach[0] + reach[3] - spanU) * 0.5
  const y0 = reach[1]
  const w0 = (reach[2] + reach[5] - spanW) * 0.5
  const from = [u0, y0, w0].map((v) => Math.round(v / s))
  const size = [spanU, spanY, spanW].map((v) => Math.max(2, Math.min(512, Math.ceil(v / s))))
  const words = core.hero_faces(h.sort, step, ...from, ...size)
  ok(words >= 40, `${h.name} (sort ${h.sort}): emitted only ${words / 2} faces at step ${step}`)
}

// Independent lidar returns at the exact centres of emitted cells. Local metres above each registry foot.
const surveys = JSON.parse(readFileSync(join(HERE, 'landmark-roof-surveys.json'), 'utf8'))
let measured = 0
for (const { landmark, square, tolerance, points } of surveys) {
  const h = heroes.find(entry => entry.name === landmark)
  if (!h || !Number.isFinite(tolerance) || tolerance <= 0 || !points?.length) throw Error(`Invalid roof survey for ${landmark}`)
  for (const point of points) {
    if (point.length !== 3 || !point.every(Number.isFinite)) throw Error(`Invalid roof point for ${landmark}`)
    const [u, w, height] = point
    const drawn = roofAt(core, h.sort, h.step ?? 8, u, w)
    ok(drawn !== null && Math.abs(drawn - height) <= tolerance,
      `${landmark} at (${u}, ${w}): ${square} measured ${height} m, drew ${drawn ?? 'no face'} (tolerance ${tolerance} m)`)
    measured++
  }
}

// Golden Gate Bridge structural ownership checks (#60):
// 1. South anchorage building at u=-1149, w=-3 is cleared (owned).
// 2. South tower pier fender lidar spike at u=-640, w=44 is cleared (owned).
// 3. Fort Point under the south arch is preserved by Golden Gate and owned by Fort Point.
ok(core.hero_owns(2, -1149, -3) === 1, 'Golden Gate Bridge must own south anchorage footprint (u=-1149, w=-3)')
ok(core.hero_owns(2, -640, 44) === 1, 'Golden Gate Bridge must own south pier fender ring (u=-640, w=44)')
ok(core.hero_owns(10, 0, 0) === 1, 'Fort Point (sort 10) must own its footprint')

// Bridge-end tile coverage check: both ends of Golden Gate Bridge (Presidio + Marin Headlands) must be tiled.
const tileKeys = new Set(landmarkTiles().map(([l, x, z]) => `${l}/${x}_${z}`))
const marin = place(37.8325, -122.4798)
const marinL0 = `0/${Math.floor(marin.x / 2500)}_${Math.floor(marin.z / 2500)}`
ok(tileKeys.has(marinL0), `landmark-tiles.mjs missing Marin Headlands north bridge end tile ${marinL0}`)
if (manifest) {
  const release = JSON.parse(readFileSync(manifest, 'utf8'))
  const surveyed = new Set()
  for (const { level, tiles, sea } of release.levels) {
    for (const key of [...Object.keys(tiles), ...sea]) surveyed.add(`${level}/${key}`)
  }
  for (const key of tileKeys) ok(surveyed.has(key), `release lacks landmark terrain coverage at ${key}`)
  ok(release.levels[0].tiles[marinL0.slice(2)], 'north bridge approach needs a level-0 land tile')
}

if (failures.length) {
  console.error(`landmark-audit FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`landmark-audit OK: ${heroes.length} landmark rules, ${measured} measured roof heights, ${tileKeys.size} terrain tiles ${manifest ? 'checked against release' : 'planned'}`)
