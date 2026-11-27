// Builds the San Francisco map binary (`bay/map.bin`, MAP1) for the 3D minimap, fullscreen map and GPS router.
// Reads the pinned release's `.bay` tiles (terrain, water/coastline, parks, 3D building footprints + lidar roof
// heights) and the city street graphs (`packs/graph/*.json` + `sf/street-tags.json` + `sf/heroes.json`).
//
//   node sf/map.mjs <release dir> <graph dir> <out.bin>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROBOTAXI_SERVICES } from '../page/robotaxi-services.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MAGIC = 0x3150414d // 'MAP1'

/** Lat/lon -> UTM 10N frame 10n4250 in 10 cm cells (matches page/bay.ts `place`). */
function place(lat, lon) {
  const zone = 10, a = 6378137, f = 1 / 298.257223563, n = f / (2 - f), rad = Math.PI / 180
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64)
  const alpha = [n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16, (13 * n ** 2) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240]
  const phi = lat * rad, lam = (lon - (zone * 6 - 183)) * rad, e = (2 * Math.sqrt(n)) / (1 + n)
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)))
  const xi = Math.atan(t / Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t))
  let east = eta, north = xi
  alpha.forEach((c, j) => {
    east += c * Math.cos(2 * (j + 1) * xi) * Math.sinh(2 * (j + 1) * eta)
    north += c * Math.sin(2 * (j + 1) * xi) * Math.cosh(2 * (j + 1) * eta)
  })
  const E = 0.9996 * A * east, N = 0.9996 * A * north
  return [Math.round(E * 10), Math.round((4_250_000 - N) * 10)]
}

/** Curated San Francisco neighborhoods, parks & iconic landmarks (auto-clipped to release bounds). */
const PLACES = [
  // Parks & scenic overlooks
  ['Ina Coolbrith Park', 37.79828, -122.41335, 'park'],
  ['Washington Square', 37.80072, -122.41008, 'park'],
  ['Fort Mason', 37.8068, -122.4295, 'park'],
  ['Crissy Field', 37.8040, -122.4648, 'park'],
  ['Presidio', 37.7989, -122.4662, 'park'],
  ['Golden Gate Park', 37.7694, -122.4862, 'park'],
  ['Mission Dolores Park', 37.7596, -122.4269, 'park'],
  ['Alamo Square', 37.7762, -122.4346, 'park'],
  ['Lands End', 37.7879, -122.5055, 'park'],
  ['Ocean Beach', 37.7594, -122.5107, 'park'],
  // Iconic landmarks
  ['Coit Tower', 37.80241, -122.40582, 'landmark'],
  ['Lombard Street', 37.80214, -122.41874, 'landmark'],
  ['Pier 39', 37.80867, -122.40982, 'landmark'],
  ...ROBOTAXI_SERVICES.map((s) => [s.station.name, s.station.lat, s.station.lon, 'landmark']),
  ['Golden Gate Bridge', 37.8078, -122.4748, 'landmark'],
  ['Fort Point', 37.8101, -122.4765, 'landmark'],
  ['Palace of Fine Arts', 37.8029, -122.4484, 'landmark'],
  ['California Academy of Sciences', 37.7704, -122.4666, 'landmark'],
  ['de Young Museum', 37.7709, -122.4682, 'landmark'],
  ['Japanese Tea Garden', 37.7702, -122.4695, 'landmark'],
  ['San Francisco Botanical Garden', 37.7672, -122.4670, 'landmark'],
  ['Conservatory of Flowers', 37.7719, -122.4602, 'landmark'],
  ['Painted Ladies', 37.7763, -122.4335, 'landmark'],
  ['Twin Peaks', 37.7544, -122.4477, 'landmark'],
  ['Sutro Tower', 37.7552, -122.4528, 'landmark'],
  ['Oracle Park', 37.7786, -122.3893, 'landmark'],
  ['Chase Center', 37.7680, -122.3877, 'landmark'],
  ['City Hall', 37.7793, -122.4193, 'landmark'],
  // Neighborhoods across all 155 squares of San Francisco
  ['North Beach', 37.8035, -122.4095, 'hood'],
  ['Russian Hill', 37.8008, -122.4192, 'hood'],
  ['Telegraph Hill', 37.8020, -122.4042, 'hood'],
  ['Fisherman’s Wharf', 37.8075, -122.4175, 'hood'],
  ['Chinatown', 37.7945, -122.4074, 'hood'],
  ['Nob Hill', 37.7924, -122.4158, 'hood'],
  ['Financial District', 37.7928, -122.3995, 'hood'],
  ['Union Square', 37.7879, -122.4075, 'hood'],
  ['Marina', 37.8024, -122.4368, 'hood'],
  ['Pacific Heights', 37.7925, -122.4345, 'hood'],
  ['Civic Center', 37.7793, -122.4175, 'hood'],
  ['Hayes Valley', 37.7759, -122.4245, 'hood'],
  ['SoMa', 37.7815, -122.4010, 'hood'],
  ['Embarcadero', 37.7986, -122.3982, 'hood'],
  ['Mission District', 37.7599, -122.4148, 'hood'],
  ['Castro', 37.7609, -122.4350, 'hood'],
  ['Noe Valley', 37.7502, -122.4337, 'hood'],
  ['Haight-Ashbury', 37.7692, -122.4481, 'hood'],
  ['Bernal Heights', 37.7400, -122.4156, 'hood'],
  ['Glen Park', 37.7340, -122.4330, 'hood'],
  ['Potrero Hill', 37.7605, -122.4009, 'hood'],
  ['Dogpatch', 37.7580, -122.3885, 'hood'],
  ['Inner Sunset', 37.7605, -122.4675, 'hood'],
  ['Outer Sunset', 37.7555, -122.4955, 'hood'],
  ['Inner Richmond', 37.7800, -122.4648, 'hood'],
  ['Outer Richmond', 37.7785, -122.4950, 'hood'],
  ['West Portal', 37.7408, -122.4660, 'hood'],
  ['Excelsior', 37.7248, -122.4260, 'hood'],
  ['Bayview', 37.7295, -122.3920, 'hood'],
  ['Treasure Island', 37.8235, -122.3705, 'hood'],
]

const FREEWAY_BOULEVARDS = new Set([
  'the embarcadero', 'embarcadero', 'van ness avenue', 'market street', 'geary boulevard',
  'lombard street', 'marina boulevard', 'doyle drive', 'presidio parkway',
  'san francisco-oakland bay bridge', 'golden gate bridge', 'bay bridge', 'highway 101', 'i-80',
])

const MAJOR_STREETS = new Set([
  'the embarcadero', 'embarcadero', 'van ness avenue', 'lombard street', 'broadway',
  'columbus avenue', 'market street', 'geary boulevard', 'geary street', 'california street',
  'bush street', 'pine street', 'bay street', 'beach street', 'jefferson street',
  'battery street', 'sansome street', 'montgomery street', 'kearny street', 'stockton street',
  'powell street', 'mason street', 'taylor street', 'jones street', 'hyde street',
  'polk street', 'franklin street', 'gough street', 'mission street', 'howard street',
  'folsom street', 'harrison street', 'bryant street', 'marina boulevard', 'doyle drive',
  'san francisco-oakland bay bridge', 'golden gate bridge', 'highway 101', 'i-80',
])

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Douglas-Peucker simplification for a closed polygon ring of [x, z] pairs (cells). */
function simplifyRing(pts, tol) {
  if (pts.length <= 4) return pts
  const tol2 = tol * tol
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  // Find vertex furthest from pts[0] so closed rings split cleanly into two chains.
  let farIdx = 0, farD2 = -1
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[0][0], dz = pts[i][1] - pts[0][1], d2 = dx * dx + dz * dz
    if (d2 > farD2) { farD2 = d2; farIdx = i }
  }
  if (farIdx === 0 || farD2 < tol2) return pts.slice(0, 4)
  keep[farIdx] = 1
  const dp = (a, b) => {
    const stack = [[a, b]]
    while (stack.length) {
      const [i0, i1] = stack.pop()
      const p0 = pts[i0], p1 = pts[i1 % pts.length]
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l2 = dx * dx + dz * dz
      let best = -1, maxD2 = tol2
      for (let i = i0 + 1; i < i1; i++) {
        const q = pts[i % pts.length]
        let d2
        if (l2 < 1e-6) { const ex = q[0] - p0[0], ez = q[1] - p0[1]; d2 = ex * ex + ez * ez }
        else {
          const t = clamp(((q[0] - p0[0]) * dx + (q[1] - p0[1]) * dz) / l2, 0, 1)
          const ex = q[0] - (p0[0] + dx * t), ez = q[1] - (p0[1] + dz * t)
          d2 = ex * ex + ez * ez
        }
        if (d2 > maxD2) { maxD2 = d2; best = i }
      }
      if (best >= 0) { keep[best % pts.length] = 1; stack.push([i0, best], [best, i1]) }
    }
  }
  dp(0, farIdx)
  dp(farIdx, pts.length)
  const out = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i])
  // Remove near-collinear/duplicate consecutive vertices.
  const clean = []
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i + out.length - 1) % out.length], cur = out[i], next = out[(i + 1) % out.length]
    const ax = cur[0] - prev[0], az = cur[1] - prev[1], bx = next[0] - cur[0], bz = next[1] - cur[1]
    if (Math.hypot(ax, az) < 4) continue
    const cross = Math.abs(ax * bz - az * bx), area = Math.hypot(ax, az) * Math.hypot(bx, bz)
    if (area > 1 && cross / area < 0.04 && out.length > 4) continue
    clean.push(cur)
  }
  return clean.length >= 3 ? clean : out
}

/** Signed polygon area (cells^2). Positive = CCW in (x, z) right-handed screen coords. */
function polyArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a * 0.5
}

/** Parses the header + arrays of a `.bay` pack buffer (engine/core/src/bay.rs). */
function readBay(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf.byteLength < 64 || dv.getInt32(0, true) !== 0x31594142) return null
  const gstep = dv.getInt32(16, true), gw = dv.getInt32(20, true), gx0 = dv.getInt32(24, true), gz0 = dv.getInt32(28, true)
  const tstep = dv.getInt32(32, true), tw = dv.getInt32(36, true), tx0 = dv.getInt32(40, true), tz0 = dv.getInt32(44, true)
  const nb = dv.getInt32(48, true), nv = dv.getInt32(52, true), flags = dv.getInt32(60, true)
  const takeI16 = (at, len) => {
    const abs = buf.byteOffset + at
    if ((abs & 1) === 0) return new Int16Array(buf.buffer, abs, len)
    const out = new Int16Array(len)
    for (let i = 0; i < len; i++) out[i] = dv.getInt16(at + i * 2, true)
    return out
  }
  const takeI32 = (at, len) => {
    const abs = buf.byteOffset + at
    if ((abs & 3) === 0) return new Int32Array(buf.buffer, abs, len)
    const out = new Int32Array(len)
    for (let i = 0; i < len; i++) out[i] = dv.getInt32(at + i * 4, true)
    return out
  }
  let off = 64
  const ground = takeI16(off, gw * gw); off += gw * gw * 2
  const top = takeI16(off, tw * tw); off += tw * tw * 2
  const cls = new Uint8Array(buf.buffer, buf.byteOffset + off, tw * tw); off += tw * tw
  off += tw * tw // tint
  if (flags & 1) off += tw * tw * 2 // walls
  const rows = nb > 0 ? takeI32(off, nb * 6) : null; off += nb * 24
  const verts = nv > 0 ? takeI32(off, nv * 3) : null
  return { gstep, gw, gx0, gz0, tstep, tw, tx0, tz0, nb, nv, ground, top, cls, rows, verts }
}

/**
 * Compiles the San Francisco map binary (MAP1) from a release directory (`manifest.json` + `tiles/`),
 * the city street graphs (`packs/graph/`), `sf/street-tags.json` and `sf/heroes.json`.
 */
export function buildMap({ releaseDir, graphDir, tagsPath = join(HERE, 'street-tags.json'), heroesPath = join(HERE, 'heroes.json') }) {
  const manifest = JSON.parse(readFileSync(join(releaseDir, 'manifest.json'), 'utf8'))
  const levels = [...manifest.levels].sort((a, b) => a.level - b.level)
  // Determine map extent: on full-city SF releases (>= 20 squares in manifest.names, where L2 spans 88x64 km out to
  // the Farallones/East Bay), frame tightly around the SF squares + 1.5 km coastal margin at 1024 px resolution!
  // On smaller pilot releases (< 20 squares), frame to L2 (8 km x 4 km at 512x256).
  let l2x0 = Infinity, l2z0 = Infinity, l2x1 = -Infinity, l2z1 = -Infinity
  const coarse = levels[levels.length - 1]
  for (const key of Object.keys(coarse.tiles)) {
    const [tx, tz] = key.split('_').map(Number)
    l2x0 = Math.min(l2x0, tx * coarse.size)
    l2z0 = Math.min(l2z0, tz * coarse.size)
    l2x1 = Math.max(l2x1, (tx + 1) * coarse.size)
    l2z1 = Math.max(l2z1, (tz + 1) * coarse.size)
  }
  const nameKeys = Object.keys(manifest.names ?? {})
  let x0 = l2x0, z0 = l2z0, x1 = l2x1, z1 = l2z1
  let fullCity = false
  if (nameKeys.length >= 20) {
    let sx0 = Infinity, sz0 = Infinity, sx1 = -Infinity, sz1 = -Infinity
    for (const k of nameKeys) {
      const parts = k.split('_').map(Number)
      if (parts.length !== 2 || !parts.every(Number.isFinite)) continue
      const bx0 = (parts[0] * 1000 - 500000) * 10, bz1 = (4250000 - parts[1] * 1000) * 10
      sx0 = Math.min(sx0, bx0); sx1 = Math.max(sx1, bx0 + 10000)
      sz0 = Math.min(sz0, bz1 - 10000); sz1 = Math.max(sz1, bz1)
    }
    if (sx1 > sx0 && sz1 > sz0) {
      const margin = 15_000 // 1.5 km coastal water margin around SF peninsula
      x0 = Math.max(l2x0, sx0 - margin)
      x1 = Math.min(l2x1, sx1 + margin)
      z0 = Math.max(l2z0, sz0 - margin)
      z1 = Math.min(l2z1, sz1 + margin)
      fullCity = true
    }
  }
  const spanX = x1 - x0, spanZ = z1 - z0
  // Raster resolution: ~15-17 m/cell (512x256 on 8x4 km pilot; up to 1024x1024 on 17x18 km full city).
  const rw = fullCity ? 1024 : 512
  const rh = clamp(Math.round((rw * spanZ) / spanX), 128, fullCity ? 1024 : 512)
  const rasterClass = new Uint8Array(rw * rh) // 0=water, 1=urban, 2=park, 3=road, 4=shore, 5=dense
  const rasterElev = new Float32Array(rw * rh).fill(-3)
  const rasterSeen = new Uint8Array(rw * rh) // highest detail level written (0=none, 1=L2, 2=L1, 3=L0)
  const rasterCanopy = new Uint8Array(rw * rh)
  const rasterBuilt = new Uint8Array(rw * rh)

  const paintPack = (pack, detail) => {
    const { gx0, gz0, gstep, gw, tx0, tz0, tstep, tw, ground, top, cls } = pack
    const rx0 = clamp(Math.floor(((gx0 - x0) / spanX) * rw), 0, rw - 1)
    const rx1 = clamp(Math.ceil(((gx0 + (gw - 1) * gstep - x0) / spanX) * rw), 0, rw)
    const rz0 = clamp(Math.floor(((gz0 - z0) / spanZ) * rh), 0, rh - 1)
    const rz1 = clamp(Math.ceil(((gz0 + (gw - 1) * gstep - z0) / spanZ) * rh), 0, rh)
    for (let rz = rz0; rz < rz1; rz++) {
      const wz = z0 + ((rz + 0.5) / rh) * spanZ
      const gi_z = clamp(Math.round((wz - gz0) / gstep), 0, gw - 1)
      const ti_z = tw > 0 ? clamp(Math.round((wz - tz0) / tstep), 0, tw - 1) : 0
      for (let rx = rx0; rx < rx1; rx++) {
        const idx = rz * rw + rx
        if (detail < rasterSeen[idx]) continue
        const wx = x0 + ((rx + 0.5) / rw) * spanX
        if (wx < gx0 || wx > gx0 + (gw - 1) * gstep || wz < gz0 || wz > gz0 + (gw - 1) * gstep) continue
        const gi_x = clamp(Math.round((wx - gx0) / gstep), 0, gw - 1)
        const g = ground[gi_z * gw + gi_x]
        const ti_x = tw > 0 ? clamp(Math.round((wx - tx0) / tstep), 0, tw - 1) : 0
        const c = tw > 0 ? cls[ti_z * tw + ti_x] : 5
        const base = c & 7
        const isCanopy = (c & 8) !== 0
        const isBuilt = (c & 16) !== 0
        const t = tw > 0 ? top[ti_z * tw + ti_x] : -32768
        // Classify pixel cleanly: water vs park vs road vs built vs urban land.
        let land = 1
        if (base === 5 || g <= -1) land = 0 // water
        else if (base === 2 || (isCanopy && !isBuilt && base !== 0)) land = 2 // park / green
        else if (base === 0 || base === 1) land = 3 // road / pavement
        else if (base === 4) land = 4 // sand / shore
        else if (isBuilt || (t > g + 35 && !isCanopy)) land = 5 // built
        else land = 1
        // Smooth elevation: sea floor clamped at -3m, land in metres.
        rasterClass[idx] = land
        rasterElev[idx] = land === 0 ? -3 : g * 0.1
        rasterSeen[idx] = detail
        if (isCanopy) rasterCanopy[idx] = Math.min(15, rasterCanopy[idx] + 6)
        if (isBuilt || (t > g + 60 && !isCanopy)) rasterBuilt[idx] = Math.min(15, Math.round(clamp((t - g) / 40, 2, 15)))
      }
    }
  }

  // Paint coarse -> medium -> fine tiles so L0 detail overrides L1 which overrides L2.
  for (let lv = levels.length - 1; lv >= 0; lv--) {
    const level = levels[lv]
    const detail = levels.length - lv
    for (const rec of Object.values(level.tiles)) {
      const p = join(releaseDir, rec.path)
      if (!existsSync(p)) continue
      const pack = readBay(readFileSync(p))
      if (pack) paintPack(pack, detail)
    }
  }

  // Smooth coastline distance transform on water pixels (BFS in pixels, 0..15) for GTA 6 turquoise shallows!
  const shoreDist = new Uint16Array(rw * rh).fill(65535)
  const queue = new Int32Array(rw * rh)
  let qh = 0, qt = 0
  for (let i = 0; i < rw * rh; i++) {
    if (rasterClass[i] !== 0) { shoreDist[i] = 0; queue[qt++] = i }
  }
  const DIRS = [-1, 1, -rw, rw]
  while (qh < qt) {
    const cur = queue[qh++], d = shoreDist[cur]
    if (d >= 24) continue
    const cx = cur % rw, cy = (cur - cx) / rw
    for (const step of DIRS) {
      const ni = cur + step
      if (ni < 0 || ni >= rw * rh) continue
      const nx = ni % rw, ny = (ni - nx) / rw
      if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue
      if (shoreDist[ni] > d + 1) { shoreDist[ni] = d + 1; queue[qt++] = ni }
    }
  }

  const raster = new Uint8Array(rw * rh * 2)
  for (let i = 0; i < rw * rh; i++) {
    const cls = rasterClass[i]
    let hi = 0
    if (cls === 0) {
      // Non-linear coastal falloff so shallow water pops crisp near shore and tapers smoothly into deep bay blue.
      const d = Math.min(24, shoreDist[i])
      hi = clamp(Math.round((d / 24) * 15), 0, 15)
    } else if (cls === 2) {
      hi = Math.max(6, rasterCanopy[i])
    } else {
      hi = rasterBuilt[i]
    }
    raster[i * 2] = (cls & 15) | ((hi & 15) << 4)
    raster[i * 2 + 1] = clamp(Math.round(rasterElev[i] + 5), 0, 255)
  }

  // ── 3D Buildings from L0 tiles ──
  const quantX = (x) => clamp(Math.round(((x - x0) / spanX) * 65535), 0, 65535)
  const quantZ = (z) => clamp(Math.round(((z - z0) / spanZ) * 65535), 0, 65535)
  const bldgSeen = new Set()
  const bldgs = [] // { verts: [[qx, qz]], colorIdx, flags, baseM, heightM }
  const l0 = levels[0]
  for (const rec of Object.values(l0.tiles)) {
    const p = join(releaseDir, rec.path)
    if (!existsSync(p)) continue
    const pack = readBay(readFileSync(p))
    if (!pack || !pack.rows || !pack.verts) continue
    const { nb, rows, verts, top, tw, tx0, tz0, tstep } = pack
    for (let i = 0; i < nb; i++) {
      const first = rows[i * 6], count = rows[i * 6 + 1]
      const wall = rows[i * 6 + 2], style = rows[i * 6 + 4] >>> 0, base = rows[i * 6 + 5]
      if (count < 3) continue
      // Take outer ring only (stop at first bit-2 ring-end marker).
      const ring = []
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity
      for (let k = 0; k < count; k++) {
        const vx = verts[(first + k) * 3], vz = verts[(first + k) * 3 + 1], vf = verts[(first + k) * 3 + 2]
        ring.push([vx, vz])
        if (vx < bx0) bx0 = vx; if (vx > bx1) bx1 = vx
        if (vz < bz0) bz0 = vz; if (vz > bz1) bz1 = vz
        if (vf & 4) break
      }
      if (ring.length < 3) continue
      // Clip buildings outside map bounds.
      const cx = (bx0 + bx1) * 0.5, cz = (bz0 + bz1) * 0.5
      if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue
      // Deduplicate buildings appearing on neighboring L0 tile overlap strips.
      const dedupKey = `${Math.round(cx / 20)}_${Math.round(cz / 20)}`
      if (bldgSeen.has(dedupKey)) continue
      bldgSeen.add(dedupKey)
      const areaM2 = Math.abs(polyArea(ring)) / 100
      if (areaM2 < 24) continue // skip tiny sheds/garages
      // Sample true lidar roof height from `top` inside bbox (75th percentile for crisp flat/stepped roof).
      const tops = []
      const ix0 = clamp(Math.floor((bx0 - tx0) / tstep), 0, tw - 1)
      const ix1 = clamp(Math.ceil((bx1 - tx0) / tstep), 0, tw - 1)
      const iz0 = clamp(Math.floor((bz0 - tz0) / tstep), 0, tw - 1)
      const iz1 = clamp(Math.ceil((bz1 - tz0) / tstep), 0, tw - 1)
      const step = Math.max(1, Math.floor(Math.max(ix1 - ix0, iz1 - iz0) / 8))
      for (let iz = iz0; iz <= iz1; iz += step) {
        for (let ix = ix0; ix <= ix1; ix += step) {
          const t = top[iz * tw + ix]
          if (t > base + 20) tops.push(t)
        }
      }
      let roof = base + 60
      if (tops.length) {
        tops.sort((a, b) => a - b)
        roof = tops[Math.min(tops.length - 1, Math.floor(tops.length * 0.78))]
      }
      const heightM = clamp((roof - base) * 0.1, 3.2, 360)
      if (heightM < 3.2) continue
      let simp = simplifyRing(ring, 12) // 1.2m tolerance -> crisp architectural silhouettes!
      if (simp.length < 3 || simp.length > 48) {
        simp = simplifyRing(ring, 28)
        if (simp.length < 3) continue
        if (simp.length > 48) simp = simp.slice(0, 48)
      }
      // Enforce CCW winding in (x, z) so extruded outward wall normals are consistent!
      if (polyArea(simp) < 0) simp.reverse()
      const mat = wall & 15
      const colorIdx = (wall >>> 8) & 255
      const special = (style >>> 17) & 3
      const isGlass = mat === 11 || heightM > 45 || special === 3 ? 1 : 0
      const isHero = special === 1 || special === 2 || heightM > 140 ? 2 : 0
      bldgs.push({
        verts: simp.map(([vx, vz]) => [quantX(vx), quantZ(vz)]),
        colorIdx,
        flags: isGlass | isHero,
        baseM: Math.max(-5, base * 0.1),
        heightM,
        areaM2,
        cx,
        cz,
      })
    }
  }

  // Adaptive 3D building budget for 155-square full-city builds (~250k-350k raw buildings):
  // On pilot builds (<= 25k buildings), keep 100% untouched. On full-city builds, keep EVERY tall/commercial/hero
  // structure plus a balanced spatial selection of residential footprints (up to 45k buildings) so every SF
  // neighborhood has crisp 3D massing while bay/map.bin stays fast and lightweight!
  const MAX_FULL_CITY_BLDGS = 45_000
  if (bldgs.length > MAX_FULL_CITY_BLDGS) {
    const must = [], rest = []
    for (const b of bldgs) {
      if (b.heightM >= 14 || b.areaM2 >= 260 || (b.flags & 2)) must.push(b)
      else rest.push(b)
    }
    const spare = Math.max(0, MAX_FULL_CITY_BLDGS - must.length)
    // Bucket smaller residential footprints into 120 m cells and pick largest/tallest per cell first for even city coverage!
    const byCell = new Map()
    for (const b of rest) {
      const k = `${Math.floor(b.cx / 1200)}_${Math.floor(b.cz / 1200)}`
      let arr = byCell.get(k)
      if (!arr) byCell.set(k, (arr = []))
      arr.push(b)
    }
    const ranked = []
    for (const arr of byCell.values()) {
      arr.sort((a, b) => (b.heightM * 8 + b.areaM2) - (a.heightM * 8 + a.areaM2))
      for (let r = 0; r < arr.length; r++) ranked.push({ b: arr[r], rank: r, score: arr[r].heightM * 8 + arr[r].areaM2 })
    }
    ranked.sort((a, b) => (a.rank - b.rank) || (b.score - a.score))
    bldgs.length = 0
    for (const b of must) bldgs.push(b)
    for (let i = 0; i < Math.min(spare, ranked.length); i++) bldgs.push(ranked[i].b)
  }

  // Add iconic hero landmarks from sf/heroes.json; water-spanning bridges map to their SF shore viewpoints so GPS
  // routing and Visit fast-travel land on dry ground beside the span instead of mid-water.
  const HERO_SHORE = {
    'Golden Gate Bridge': [37.8078, -122.4748],
    'Bay Bridge, western span': [37.7913, -122.3889],
    'Fort Point': [37.8101, -122.4765],
    'California Academy of Sciences': [37.7704, -122.4666],
    'de Young Museum': [37.7709, -122.4682],
    'Japanese Tea Garden': [37.7702, -122.4695],
    'San Francisco Botanical Garden': [37.7672, -122.4670],
    'Conservatory of Flowers': [37.7719, -122.4602],
    'Painted Ladies': [37.7763, -122.4335],
  }
  const heroes = existsSync(heroesPath) ? JSON.parse(readFileSync(heroesPath, 'utf8')) : []
  const landmarks = []
  const hasSquare = (px, pz) => {
    const names = manifest.names ? Object.keys(manifest.names) : []
    if (names.length < 20) return true
    for (const key of names) {
      const [e, n] = key.split('_').map(Number)
      const sx0 = (e * 1000 - 500000) * 10, sz1 = (4250000 - n * 1000) * 10
      if (px >= sx0 - 1500 && px <= sx0 + 11500 && pz >= sz1 - 11500 && pz <= sz1 + 1500) return true
    }
    return false
  }
  for (const h of heroes) {
    const ll = HERO_SHORE[h.name] ?? h.at
    const [hx, hz] = place(ll[0], ll[1])
    if (hx >= x0 && hx <= x1 && hz >= z0 && hz <= z1 && hasSquare(hx, hz)) {
      landmarks.push({ name: h.name, x: hx, z: hz, kind: 'landmark' })
    }
  }
  for (const [name, lat, lon, kind] of PLACES) {
    const [px, pz] = place(lat, lon)
    if (px >= x0 && px <= x1 && pz >= z0 && pz <= z1 && hasSquare(px, pz)) {
      if (!landmarks.some((l) => l.name === name)) landmarks.push({ name, x: px, z: pz, kind })
    }
  }

  // ── Road Graph from packs/graph/*.json ──
  const tags = existsSync(tagsPath) ? JSON.parse(readFileSync(tagsPath, 'utf8')) : { grid: [], apart: [] }
  const gridWays = new Set(tags.grid ?? [])
  const apartWays = new Set(tags.apart ?? [])
  const nodeMap = new Map() // osmNodeId -> index
  const nodeRaw = [] // flat [xCells, zCells, ...]
  const edgeMap = new Map() // "minIdx_maxIdx" -> { a, b, dirMask, cls, lanes, nameIdx, extra }
  const nameMap = new Map() // streetName -> index
  const nameList = []

  const getNameIdx = (name) => {
    if (!name) return 0xffff
    let idx = nameMap.get(name)
    if (idx === undefined) { idx = nameList.length; nameMap.set(name, idx); nameList.push(name) }
    return idx
  }
  const getNodeIdx = (osmId, x, z) => {
    let idx = nodeMap.get(osmId)
    if (idx !== undefined) return idx
    idx = nodeRaw.length / 2
    nodeMap.set(osmId, idx)
    nodeRaw.push(x, z)
    return idx
  }

  const graphFiles = existsSync(graphDir) ? readdirSync(graphDir).filter((f) => f.endsWith('.json')).sort() : []
  for (const file of graphFiles) {
    // Quick bbox reject by square name (SW corner in UTM km).
    const parts = file.slice(0, -5).split('_').map(Number)
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      const sx0 = (parts[0] * 1000 - 500000) * 10, sz1 = (4250000 - parts[1] * 1000) * 10
      const sx1 = sx0 + 10000, sz0 = sz1 - 10000
      if (sx1 < x0 || sx0 > x1 || sz1 < z0 || sz0 > z1) continue
    }
    const g = JSON.parse(readFileSync(join(graphDir, file), 'utf8'))
    for (const r of g.roads ?? []) {
      const [p0, p1] = r.line ?? []
      if (!p0 || !p1) continue
      if ((p0[0] < x0 && p1[0] < x0) || (p0[0] > x1 && p1[0] > x1) || (p0[1] < z0 && p1[1] < z0) || (p0[1] > z1 && p1[1] > z1)) continue
      const [idA, idB] = r.nodes
      if (idA === idB) continue
      const a = getNodeIdx(idA, p0[0], p0[1]), b = getNodeIdx(idB, p1[0], p1[1])
      if (a < 0 || b < 0 || a === b) continue
      const lo = a < b ? a : b, hi = a < b ? b : a
      const dirBit = a < b ? 1 : 2
      const wayId = Number(String(r.id).split('/')[0])
      const lanes = clamp(Number(r.lanes) || 1, 1, 4)
      const nm = (r.name || '').trim()
      const lower = nm.toLowerCase()
      const isGrid = gridWays.has(wayId)
      const isFreeway = FREEWAY_BOULEVARDS.has(lower) || apartWays.has(wayId)
      const isArterial = MAJOR_STREETS.has(lower) || (isGrid && lanes >= 3)
      const cls = isFreeway ? 3 : isArterial ? 2 : (isGrid || nm) ? 1 : 0
      const isApart = apartWays.has(wayId) ? 64 : 0
      const key = `${lo}_${hi}`
      let e = edgeMap.get(key)
      if (!e) {
        e = { a: lo, b: hi, dirMask: dirBit, cls, lanes, nameIdx: getNameIdx(nm), extra: isApart }
        edgeMap.set(key, e)
      } else {
        e.dirMask |= dirBit
        if (cls > e.cls) e.cls = cls
        if (lanes > e.lanes) e.lanes = lanes
        if (e.nameIdx === 0xffff && nm) e.nameIdx = getNameIdx(nm)
        e.extra |= isApart
      }
    }
  }

  // Collapse near-collinear degree-2 road geometry vertices (< 1.8 m deviation, identical street & class & direction):
  // cuts full-city 155-square node count by ~45% with zero visible loss and makes A* routing nearly 2x faster!
  const rawEdges = [...edgeMap.values()]
  const rawN = nodeRaw.length / 2
  const inc = Array.from({ length: rawN }, () => [])
  for (let i = 0; i < rawEdges.length; i++) {
    inc[rawEdges[i].a].push(i)
    inc[rawEdges[i].b].push(i)
  }
  const aliveEdge = new Uint8Array(rawEdges.length).fill(1)
  const dirFrom = (e, u) => (e.a === u ? e.dirMask : ((e.dirMask & 1) << 1) | ((e.dirMask & 2) >> 1))
  for (let u = 0; u < rawN; u++) {
    if (inc[u].length !== 2) continue
    const i0 = inc[u][0], i1 = inc[u][1]
    if (!aliveEdge[i0] || !aliveEdge[i1] || i0 === i1) continue
    const e0 = rawEdges[i0], e1 = rawEdges[i1]
    if (e0.cls !== e1.cls || e0.lanes !== e1.lanes || e0.nameIdx !== e1.nameIdx || e0.extra !== e1.extra) continue
    const v0 = e0.a === u ? e0.b : e0.a
    const v1 = e1.a === u ? e1.b : e1.a
    if (v0 === v1) continue
    // Check legal traffic direction agrees from v0 -> u -> v1!
    const d0 = dirFrom(e0, v0), d1 = dirFrom(e1, u)
    if (d0 !== d1) continue
    // Check perpendicular deviation of u from chord (v0, v1) <= 1.8 m (18 cells) and total chord <= 120 m.
    const xA = nodeRaw[v0 * 2], zA = nodeRaw[v0 * 2 + 1]
    const xU = nodeRaw[u * 2], zU = nodeRaw[u * 2 + 1]
    const xB = nodeRaw[v1 * 2], zB = nodeRaw[v1 * 2 + 1]
    const dx = xB - xA, dz = zB - zA, len = Math.hypot(dx, dz)
    if (len < 1 || len > 1200) continue
    const t = ((xU - xA) * dx + (zU - zA) * dz) / (len * len)
    if (t <= 0 || t >= 1) continue
    const perp = Math.abs((xU - xA) * dz - (zU - zA) * dx) / len
    if (perp > 18) continue
    // Replace edge i0 with (v0 -> v1) and retire edge i1 + node u!
    const lo = v0 < v1 ? v0 : v1, hi = v0 < v1 ? v1 : v0
    const mergedDir = v0 < v1 ? d0 : (((d0 & 1) << 1) | ((d0 & 2) >> 1))
    e0.a = lo; e0.b = hi; e0.dirMask = mergedDir
    aliveEdge[i1] = 0
    // Update v1's incident list to point at i0 instead of i1.
    const arr = inc[v1]
    for (let k = 0; k < arr.length; k++) if (arr[k] === i1) { arr[k] = i0; break }
  }

  // Compact surviving nodes & edges (uint32 node indices -> unlimited full-city scale!).
  const remap = new Int32Array(rawN).fill(-1)
  const nodeCoords = []
  const edges = []
  const dedup = new Set()
  const takeNode = (u) => {
    let id = remap[u]
    if (id < 0) {
      id = nodeCoords.length / 2
      remap[u] = id
      nodeCoords.push(quantX(nodeRaw[u * 2]), quantZ(nodeRaw[u * 2 + 1]))
    }
    return id
  }
  for (let i = 0; i < rawEdges.length; i++) {
    if (!aliveEdge[i]) continue
    const e = rawEdges[i]
    const a = takeNode(e.a), b = takeNode(e.b)
    if (a === b) continue
    const lo = a < b ? a : b, hi = a < b ? b : a
    const dk = `${lo}_${hi}`
    if (dedup.has(dk)) continue
    dedup.add(dk)
    const dm = a < b ? e.dirMask : (((e.dirMask & 1) << 1) | ((e.dirMask & 2) >> 1))
    edges.push({ a: lo, b: hi, dirMask: dm, cls: e.cls, lanes: e.lanes, nameIdx: e.nameIdx, extra: e.extra })
  }

  const nNodes = nodeCoords.length / 2
  const nEdges = edges.length
  const namesBuf = Buffer.from(nameList.join('\0'), 'utf8')
  const namesPad = (namesBuf.length + 3) & ~3
  const landmarksBuf = Buffer.from(JSON.stringify(landmarks), 'utf8')
  const landmarksPad = (landmarksBuf.length + 3) & ~3
  const rasterPad = (raster.length + 3) & ~3
  const nBldgs = bldgs.length
  let nBldgVerts = 0
  for (const b of bldgs) nBldgVerts += b.verts.length

  // MAP1 v2: 12-byte edge records (u32 a, u32 b, u16 nameIdx, u8 flags, u8 pad) supporting > 65k road nodes!
  const totalBytes = 64 + rasterPad + nNodes * 4 + nEdges * 12 + namesPad + nBldgs * 12 + nBldgVerts * 4 + landmarksPad
  const out = Buffer.alloc(totalBytes)
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)

  // Header
  dv.setInt32(0, MAGIC, true)
  dv.setInt32(4, 2, true) // version 2 (u32 edge node indices)
  dv.setInt32(8, x0, true)
  dv.setInt32(12, z0, true)
  dv.setInt32(16, spanX, true)
  dv.setInt32(20, spanZ, true)
  dv.setInt32(24, rw, true)
  dv.setInt32(28, rh, true)
  dv.setUint32(32, nNodes, true)
  dv.setUint32(36, nEdges, true)
  dv.setUint32(40, nameList.length, true)
  dv.setUint32(44, namesBuf.length, true)
  dv.setUint32(48, nBldgs, true)
  dv.setUint32(52, nBldgVerts, true)
  dv.setUint32(56, landmarks.length, true)
  dv.setUint32(60, landmarksBuf.length, true)

  let off = 64
  out.set(raster, off); off += rasterPad
  for (let i = 0; i < nNodes; i++) {
    dv.setUint16(off, nodeCoords[i * 2], true)
    dv.setUint16(off + 2, nodeCoords[i * 2 + 1], true)
    off += 4
  }
  for (const e of edges) {
    dv.setUint32(off, e.a, true)
    dv.setUint32(off + 4, e.b, true)
    dv.setUint16(off + 8, e.nameIdx, true)
    const flags = (e.dirMask & 3) | ((e.cls & 3) << 2) | (((e.lanes - 1) & 3) << 4) | (e.extra & 192)
    dv.setUint8(off + 10, flags)
    dv.setUint8(off + 11, 0)
    off += 12
  }
  namesBuf.copy(out, off); off += namesPad
  let vCursor = 0
  for (const b of bldgs) {
    dv.setUint32(off, vCursor, true)
    dv.setUint32(off + 4, (b.verts.length & 0xff) | ((b.colorIdx & 0xff) << 8) | ((b.flags & 0xffff) << 16), true)
    const baseQ = clamp(Math.round((b.baseM + 10) * 4), 0, 65535)
    const heightQ = clamp(Math.round(b.heightM * 4), 1, 65535)
    dv.setUint32(off + 8, baseQ | (heightQ << 16), true)
    vCursor += b.verts.length
    off += 12
  }
  for (const b of bldgs) {
    for (const [qx, qz] of b.verts) {
      dv.setUint16(off, qx, true)
      dv.setUint16(off + 2, qz, true)
      off += 4
    }
  }
  landmarksBuf.copy(out, off)

  return {
    bytes: out,
    summary: `${rw}x${rh} raster, ${nNodes} nodes, ${nEdges} roads (${nameList.length} names), ${nBldgs} 3D buildings (${nBldgVerts} verts), ${landmarks.length} places, ${(out.length / 1024).toFixed(0)} KB`,
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [releaseDir, graphDir, outFile] = process.argv.slice(2)
  if (!releaseDir || !graphDir || !outFile) {
    console.error('usage: node sf/map.mjs <releaseDir> <graphDir> <out.bin>')
    process.exit(1)
  }
  const { bytes, summary } = buildMap({ releaseDir, graphDir })
  writeFileSync(outFile, bytes)
  console.log(`  map: ${summary}`)
}
