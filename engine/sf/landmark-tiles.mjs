// The cell tiles round the realm's landmarks (#450, sf/heroes.json), so that a visitor who walks to one stands on
// ground and not in the sea: the planet's tiles (bay/earth.py) within `REACH` tiles of each landmark at each level.
// coverage.py uses --json to include outlying tiles in the city bake. --make warms the local planet cache.
//
//   node sf/landmark-tiles.mjs [--json | --make]
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { place } from '../page/bay.ts'

const root = new URL('..', import.meta.url).pathname
/** How many tiles each way of a landmark at each level (250 m, 1 km, 4 km). */
export const REACH = [2, 1, 1]
const SIZES = [2500, 10000, 40000]
export const FRAME = '10n4250'
export const EARTH = join(homedir(), '.village', 'engine', 'bay', 'earth', 'tiles', FRAME)

/** Every tile round the landmarks: [level, x, z]. Include BOTH ends of bridges so no bridge ever ends in open water (#60). */
export function landmarkTiles() {
  const listed = JSON.parse(readFileSync(join(root, 'sf', 'heroes.json'), 'utf8'))
  const bridgeEnds = [
    [37.8107, -122.4776], // Golden Gate Bridge south end (Fort Point / Presidio)
    [37.8325, -122.4798], // Golden Gate Bridge north end (Marin Headlands)
    [37.7897, -122.3882], // Bay Bridge west anchorage (Rincon Hill)
    [37.8105, -122.3655], // Bay Bridge east end (Yerba Buena Island)
  ]
  const at = [...listed.filter((h) => h.only !== 'night').map((h) => h.at), ...bridgeEnds]
  const out = new Map()
  for (const [lat, lon] of at) {
    const p = place(lat, lon)
    SIZES.forEach((s, level) => {
      const cx = Math.floor(p.x / s), cz = Math.floor(p.z / s)
      for (let dx = -REACH[level]; dx <= REACH[level]; dx++) for (let dz = -REACH[level]; dz <= REACH[level]; dz++) out.set(`${level}/${cx + dx}_${cz + dz}`, [level, cx + dx, cz + dz])
    })
  }
  return [...out.values()]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = landmarkTiles()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(all))
    process.exit(0)
  }
  const missing = all.filter(([l, x, z]) => !existsSync(join(EARTH, String(l), `${x}_${z}.bay`)))
  console.log(`${all.length} tiles round the landmarks, ${missing.length} not made yet`)
  if (process.argv.includes('--make') && missing.length) {
    // The planet's maker, asked a tile a line (bay/earth.py `serve`), six at once.
    const py = join(homedir(), '.village', 'engine', 'bay', 'venv', 'bin', 'python')
    const maker = spawn(py, ['-I', join(root, 'bay', 'earth.py'), 'serve', '6'], { stdio: ['pipe', 'pipe', 'inherit'], cwd: join(root, 'bay') })
    let done = 0
    maker.stdout.on('data', (d) => { done += String(d).split('\n').filter(Boolean).length; if (done % 20 === 0 || done === missing.length) console.log(`  ${done} of ${missing.length}`); if (done >= missing.length) maker.stdin.end() })
    for (const [l, x, z] of missing) maker.stdin.write(`${FRAME} ${l} ${x} ${z}\n`)
    await new Promise((r) => maker.on('close', r))
  }
}
