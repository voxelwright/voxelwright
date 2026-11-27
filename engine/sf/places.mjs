// Compiles San Francisco's neighborhood storefronts & civic plazas (`bay/places.json`) and
// map POIs (`bay/map.bin` additions) from:
//   1. `sf/places-raw.json.br` (open-data extract: Overture Maps Places + OpenStreetMap + DataSF)
//   2. `sf/brands.json`        (user-editable GTA-style parody brand names, sign themes & per-place overrides)
//   3. `sf/plazas.json`        (user-editable neighborhood town square & plaza archetypes / hero profiles)
//
// Editing `sf/brands.json` or `sf/plazas.json` and running `node engine/sf/build.mjs` (or deploy)
// deterministically regenerates every storefront signboard, blade sign, plaza kit, and map POI label.
//
//   node engine/sf/places.mjs [--out dist-sf/bay/places.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_RAW = join(HERE, 'places-raw.json.br')
export const DEFAULT_BRANDS = join(HERE, 'brands.json')
export const DEFAULT_PLAZAS = join(HERE, 'plazas.json')
export const DEFAULT_HEROES = join(HERE, 'heroes.json')

/** Horizontal footprints [u0, w0, u1, w1] in metres matching non-bridge landmarks in `engine/core/src/heroes.rs`.
 * Elevated bridge spans (2 Golden Gate, 4 Bay Bridge) are omitted so real waterfront shops below them stay intact. */
const HERO_FOOTPRINTS = {
  1: [-34, -34, 34, 34],       // Salesforce Tower
  3: [-29, -29, 29, 29],       // Transamerica Pyramid
  5: [-104, -29, 103, 33],     // Ferry Building
  7: [-40, -40, 40, 40],       // Sutro Tower
  8: [-66, -57.3, 66, 57.3],   // City Hall
  9: [-38, -114, 54, 109],     // Palace of Fine Arts
  10: [-54, -34, 54, 34],      // Fort Point
  11: [-81, -66.5, 81, 36.5],  // California Academy of Sciences
  12: [-66, -66, 66, 66],      // Japanese Tea Garden
  13: [-80, -60, 80, 60],      // San Francisco Botanical Garden
  14: [-50, -22, 61, 96],      // Conservatory of Flowers
  15: [-28.5, -11.5, 27, 13],  // Painted Ladies
  16: [-80, -40, 78, 44],      // de Young Museum
}

/** Loads oriented horizontal exclusion boxes for authored ground-level landmarks from `heroes.json` (#60 x #93). */
export function loadHeroExclusions(heroesPath = DEFAULT_HEROES) {
  if (!heroesPath || !existsSync(heroesPath)) return []
  const list = JSON.parse(readFileSync(heroesPath, 'utf8'))
  const boxes = []
  for (const h of list) {
    const r = HERO_FOOTPRINTS[h.sort]
    if (!r || !Array.isArray(h.at) || !Array.isArray(h.toward)) continue
    const [hx, hz] = latLonToWorldM(h.at[0], h.at[1])
    const [tx, tz] = latLonToWorldM(h.toward[0], h.toward[1])
    const len = Math.hypot(tx - hx, tz - hz) || 1
    boxes.push({ name: h.name, sort: h.sort, hx, hz, ax: (tx - hx) / len, az: (tz - hz) / len, r })
  }
  return boxes
}

/** True when world-metre point `(x, z)` lies inside any authored ground-level landmark footprint (padded by `pad` m). */
export function insideHero(boxes, x, z, pad = 0) {
  for (const h of boxes) {
    const dx = x - h.hx, dz = z - h.hz
    const u = dx * h.ax + dz * h.az
    const w = dz * h.ax - dx * h.az
    const [u0, w0, u1, w1] = h.r
    if (u >= u0 - pad && u <= u1 + pad && w >= w0 - pad && w <= w1 + pad) return h
  }
  return null
}

/** Lat/lon -> UTM 10N frame 10n4250 in world metres (matches page/bay.ts `place` / 10). */
export function latLonToWorldM(lat, lon) {
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
  return [Math.round(E * 10) / 10, Math.round((4_250_000 - N) * 10) / 10]
}

export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Word-boundary matcher so short tokens like "gap" or "amc" never accidentally match inside longer words. */
function matchesPattern(haystack, pattern) {
  const p = normalizeName(pattern)
  if (!p || !haystack) return false
  if (haystack === p) return true
  if (p.length <= 4) return new RegExp(`(?:^| )${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$| )`).test(haystack)
  return haystack.includes(p)
}

/**
 * Compiles matchers once from `brands.json` for fast city-wide storefront resolution.
 * Supports:
 *   - `overrides`: explicit per-place rename/restyle by exact name, address, or nearby coordinates
 *   - `brands`:    GTA-style parody replacement for trademarked big chains
 *   - `categories`: default sign palettes & sidewalk prop kits
 */
export function compileBrandRules(config) {
  const policy = {
    parodyBigChains: config?.policy?.parodyBigChains !== false,
    keepIndependentNames: config?.policy?.keepIndependentNames !== false,
  }
  const brands = (config?.brands ?? []).map((b) => ({
    ...b,
    patterns: (b.match ?? []).map(normalizeName).filter(Boolean),
  }))
  const overrides = (config?.overrides ?? []).map((o) => ({
    ...o,
    matchNorm: o.match ? normalizeName(o.match) : '',
    addrNorm: o.address ? normalizeName(o.address) : '',
  }))
  const categories = config?.categories ?? {}

  function resolve(poi) {
    const rawName = String(poi.n ?? poi.name ?? '').trim()
    const rawBrand = String(poi.b ?? poi.brand ?? '').trim()
    const rawAddr = String(poi.a ?? poi.addr ?? '').trim()
    let rawCat = String(poi.c ?? poi.cat ?? 'boutique')
    // Fix raw extract misclassification where "barber" matched "bar" substring.
    if (rawCat === 'bar' && /\bbarber/i.test(`${rawName} ${rawBrand}`)) rawCat = 'salon'
    const nameNorm = normalizeName(rawName)
    const brandNorm = normalizeName(rawBrand)
    const addrNorm = normalizeName(rawAddr)

    // 1. Per-place explicit override (highest priority)
    for (const ov of overrides) {
      const nameHit = !ov.matchNorm || matchesPattern(nameNorm, ov.matchNorm)
      const addrHit = !ov.addrNorm || (addrNorm && addrNorm.includes(ov.addrNorm))
      let nearHit = true
      if (typeof ov.lat === 'number' && typeof ov.lon === 'number' && typeof poi.x === 'number' && typeof poi.z === 'number') {
        const [ox, oz] = latLonToWorldM(ov.lat, ov.lon)
        nearHit = Math.hypot(poi.x - ox, poi.z - oz) <= (ov.radiusM ?? 60)
      }
      if ((ov.matchNorm || ov.addrNorm) && nameHit && addrHit && nearHit) {
        const cat = ov.category ?? rawCat
        const catDef = categories[cat] ?? categories.boutique ?? {}
        const name = ov.name ?? ov.parody ?? rawName
        return {
          name,
          short: ov.short ?? shortLabel(name),
          tagline: ov.tagline ?? catDef.label ?? '',
          category: cat,
          brandId: ov.id ?? null,
          parodyOf: name !== rawName ? rawName : null,
          style: {
            bg: ov.style?.bg ?? catDef.bg ?? '#24303c',
            ink: ov.style?.ink ?? catDef.ink ?? '#f8f2e4',
            accent: ov.style?.accent ?? catDef.accent ?? '#e09c48',
            trim: ov.style?.trim ?? catDef.trim ?? '#141b22',
            font: ov.style?.font ?? catDef.font ?? 'clean',
            glow: ov.style?.glow ?? Boolean(catDef.glow),
          },
          blade: ov.blade ?? Boolean(catDef.blade),
          prop: ov.prop ?? (catDef.prop ?? 'none'),
        }
      }
    }

    // 2. Configurable GTA-style big-chain parody rules
    if (policy.parodyBigChains) {
      for (const br of brands) {
        const hit = br.patterns.some((p) =>
          (brandNorm && matchesPattern(brandNorm, p)) || matchesPattern(nameNorm, p),
        )
        if (!hit) continue
        const cat = br.category ?? rawCat
        const catDef = categories[cat] ?? categories.boutique ?? {}
        return {
          name: br.parody,
          short: br.short ?? shortLabel(br.parody),
          tagline: br.tagline ?? catDef.label ?? '',
          category: cat,
          brandId: br.id,
          parodyOf: rawName,
          style: {
            bg: br.style?.bg ?? catDef.bg ?? '#24303c',
            ink: br.style?.ink ?? catDef.ink ?? '#ffffff',
            accent: br.style?.accent ?? catDef.accent ?? '#e09c48',
            trim: br.style?.trim ?? catDef.trim ?? '#141b22',
            font: br.style?.font ?? catDef.font ?? 'bold',
            glow: br.style?.glow ?? Boolean(catDef.glow),
          },
          blade: br.blade ?? Boolean(catDef.blade),
          prop: br.prop ?? (catDef.prop ?? 'none'),
        }
      }
    }

    // 3. Independent local neighborhood business (authentic name + category craft palette)
    const catDef = categories[rawCat] ?? categories.boutique ?? {}
    const displayName = policy.keepIndependentNames ? rawName : (catDef.label ?? 'LOCAL SHOP')
    return {
      name: displayName,
      short: shortLabel(displayName),
      tagline: catDef.label ?? '',
      category: rawCat,
      brandId: null,
      parodyOf: null,
      style: {
        bg: catDef.bg ?? '#24303c',
        ink: catDef.ink ?? '#f8f2e4',
        accent: catDef.accent ?? '#e09c48',
        trim: catDef.trim ?? '#141b22',
        font: catDef.font ?? 'clean',
        glow: Boolean(catDef.glow),
      },
      blade: Boolean(catDef.blade),
      prop: catDef.prop ?? 'none',
    }
  }

  return { resolve, policy, brands, overrides, categories }
}

function shortLabel(name) {
  let clean = String(name ?? '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length <= 22) return clean
  // Trim trailing corporate/city/generic suffixes gracefully so real shop names read crisply on signboards
  clean = clean
    .replace(/\s+(?:of|de|in|at)?\s*(?:san francisco|sf|llc|inc\.?|co\.?|company|corporation)$/i, '')
    .replace(/\s+(?:italian|mexican|thai|chinese|japanese|indian|french|american)?\s*(?:restaurant|eatery|kitchen & bar)$/i, '')
    .replace(/\s+(?:de|of|the|and|&|-)$/i, '')
    .trim()
  if (clean.length <= 24) return clean
  // Break cleanly on word boundary instead of mid-word truncation
  const cut = clean.slice(0, 23)
  const sp = cut.lastIndexOf(' ')
  return (sp >= 12 ? cut.slice(0, sp) : cut).trimEnd()
}

export function loadRawPlaces(rawPath = DEFAULT_RAW) {
  if (!existsSync(rawPath)) return { version: 1, frame: '10n4250', sources: {}, shops: [], plazas: [] }
  const bytes = readFileSync(rawPath)
  const text = rawPath.endsWith('.br') ? brotliDecompressSync(bytes).toString('utf8') : bytes.toString('utf8')
  return JSON.parse(text)
}

/**
 * Compiles raw open-data POIs + plazas with `brands.json` and `plazas.json`.
 * Returns `{ data, bytes, mapPlaces, stats, summary }`.
 */
export function buildPlaces({ rawPath = DEFAULT_RAW, brandsPath = DEFAULT_BRANDS, plazasPath = DEFAULT_PLAZAS, heroesPath = DEFAULT_HEROES } = {}) {
  const raw = loadRawPlaces(rawPath)
  const brandsCfg = existsSync(brandsPath) ? JSON.parse(readFileSync(brandsPath, 'utf8')) : { brands: [], overrides: [], categories: {} }
  const plazasCfg = existsSync(plazasPath) ? JSON.parse(readFileSync(plazasPath, 'utf8')) : { archetypes: {}, heroes: [] }
  const heroBoxes = loadHeroExclusions(heroesPath)
  const rules = compileBrandRules(brandsCfg)

  // Deduplicated style palette table so bay/places.json stays super compact.
  const styles = []
  const styleIdx = new Map()
  const internStyle = (s) => {
    const key = `${s.bg}|${s.ink}|${s.accent}|${s.trim}|${s.font}|${s.glow ? 1 : 0}`
    let i = styleIdx.get(key)
    if (i === undefined) {
      i = styles.length
      styleIdx.set(key, i)
      styles.push([s.bg, s.ink, s.accent, s.trim, s.font, s.glow ? 1 : 0])
    }
    return i
  }

  let parodyCount = 0, skippedHeroShops = 0
  const brandHits = new Map()
  const shops = []
  for (const r of raw.shops ?? []) {
    if (insideHero(heroBoxes, r.x, r.z, 2)) {
      skippedHeroShops++
      continue
    }
    const res = rules.resolve(r)
    if (res.parodyOf) {
      parodyCount++
      if (res.brandId) brandHits.set(res.brandId, (brandHits.get(res.brandId) ?? 0) + 1)
    }
    const prop = r.out && (res.prop === 'none' || res.prop === 'aframe' || res.prop === 'planter') ? 'patio' : res.prop
    const item = {
      n: res.short,
      c: res.category,
      t: res.tagline,
      x: r.x,
      z: r.z,
      nx: r.nx,
      nz: r.nz,
      w: r.w,
      sw: r.sw,
      h: r.h,
      s: internStyle(res.style),
      p: prop,
      bl: res.blade ? 1 : 0,
    }
    if (res.brandId) item.br = res.brandId
    if (res.parodyOf) item.po = 1
    if (r.out) item.out = 1
    const addr = String(r.a || r.st || '').trim()
    if (addr) item.a = addr
    if (res.name && res.name !== res.short) item.fn = res.name
    shops.push(item)
  }

  // Merge plazas with configurable archetypes + hero plaza profiles
  const archetypes = plazasCfg.archetypes ?? {}
  const heroes = (plazasCfg.heroes ?? []).map((h) => {
    const [hx, hz] = latLonToWorldM(h.lat, h.lon)
    return { ...h, norm: normalizeName(h.match ?? h.title), hx, hz, matched: false }
  })

  const plazas = []
  let benchCount = 0
  const makePlazaRecord = (rawP, hero) => {
    const archKey = hero?.archetype ?? rawP.t ?? 'neighborhood_park'
    const arch = archetypes[archKey] ?? archetypes.neighborhood_park ?? {}
    const cfg = { ...arch, ...(hero ?? {}) }
    const benches = rawP.bn ?? []
    benchCount += benches.length
    return {
      id: hero?.id ?? normalizeName(rawP.n).replace(/\s+/g, '-'),
      n: hero?.title ?? rawP.n.toUpperCase(),
      label: hero?.match ?? rawP.n,
      sub: hero?.subtitle ?? (rawP.h ? rawP.h.toUpperCase() : rawP.st ? rawP.st.toUpperCase() : 'SAN FRANCISCO'),
      t: archKey,
      x: rawP.x,
      z: rawP.z,
      ex: rawP.ex,
      ez: rawP.ez,
      nx: rawP.nx,
      nz: rawP.nz,
      lu: rawP.lu,
      lv: rawP.lv,
      a: rawP.a,
      p: rawP.p,
      ...(rawP.k?.length ? { k: rawP.k } : {}),
      ...(benches.length ? { bn: benches } : {}),
      ...(rawP.bk?.length ? { bk: rawP.bk } : {}),
      ...(rawP.fn?.length ? { fn: rawP.fn } : {}),
      ...(rawP.wt?.length ? { wt: rawP.wt } : {}),
      ...(rawP.mk ? { mk: 1 } : {}),
      cfg: {
        pav: cfg.pavilion ? 1 : 0,
        arch: cfg.archway ? 1 : 0,
        lit: cfg.stringLights ? 1 : 0,
        deck: cfg.deckPaving ? 1 : 0,
        stalls: Number(cfg.marketStalls ?? 0),
        tables: Number(cfg.picnicTables ?? 0),
        planters: Number(cfg.planters ?? 4),
        bollards: cfg.bollards ? 1 : 0,
        lib: cfg.littleLibrary ? 1 : 0,
        fnt: cfg.fountain ? 1 : 0,
        crowd: Number(cfg.crowd ?? 8),
        perf: cfg.performer ? 1 : 0,
        acc: cfg.accent ?? '#2e5e3d',
        bg: cfg.signBg ?? '#1d3324',
        ink: cfg.signInk ?? '#f5f4ea',
      },
      hero: hero ? 1 : 0,
      mapFeatured: hero?.mapFeatured ? 1 : 0,
    }
  }

  let skippedHeroPlazas = 0
  const overlapsLandmarkPlaza = (rp) => {
    if (insideHero(heroBoxes, rp.x, rp.z, 4)) return true
    if (rp.ex != null && rp.ez != null && insideHero(heroBoxes, rp.ex, rp.ez, 4)) return true
    // Skip raw plazas whose OSM polygon or benches fall inside an authored landscape/building landmark
    // (keep neighboring parks like Transamerica Redwood Park whose center/entrance/benches sit cleanly outside).
    const hitBench = (rp.bn ?? []).some(([bx, bz]) => insideHero(heroBoxes, bx, bz, 0))
    if (hitBench) return true
    const hitPoly = (rp.p ?? []).find(([px, pz]) => {
      const h = insideHero(heroBoxes, px, pz, 0)
      return h && h.sort !== 3
    })
    return Boolean(hitPoly)
  }

  for (const rp of raw.plazas ?? []) {
    const rn = normalizeName(rp.n)
    let hit = null
    for (const h of heroes) {
      if (h.matched) continue
      const d = Math.hypot(rp.x - h.hx, rp.z - h.hz)
      if ((rn === h.norm || rn.includes(h.norm) || h.norm.includes(rn)) && d < 220) {
        hit = h
        break
      }
      if (d < 45) {
        hit = h
        break
      }
    }
    if (!hit && overlapsLandmarkPlaza(rp)) {
      skippedHeroPlazas++
      continue
    }
    if (hit) hit.matched = true
    const cleanRaw = heroBoxes.length && (rp.bn?.length || rp.k?.length)
      ? {
          ...rp,
          ...(rp.bn?.length ? { bn: rp.bn.filter(([bx, bz]) => !insideHero(heroBoxes, bx, bz, 1)) } : {}),
          ...(rp.k?.length ? { k: rp.k.filter(([kx, kz]) => !insideHero(heroBoxes, kx, kz, 1)) } : {}),
        }
      : rp
    plazas.push(makePlazaRecord(cleanRaw, hit))
  }

  // Synthesize compact square polygon for any configured hero plaza missing from raw open-data extracts
  for (const h of heroes) {
    if (h.matched) continue
    const halfU = 16, halfV = 12
    const synth = {
      n: h.match ?? h.title,
      t: h.archetype ?? 'town_square',
      x: h.hx,
      z: h.hz,
      ex: h.hx,
      ez: h.hz + halfV,
      nx: 0,
      nz: 1,
      lu: halfU * 2,
      lv: halfV * 2,
      a: halfU * halfV * 4,
      p: [
        [h.hx - halfU, h.hz - halfV],
        [h.hx + halfU, h.hz - halfV],
        [h.hx + halfU, h.hz + halfV],
        [h.hx - halfU, h.hz + halfV],
      ],
      h: h.neighborhood ?? '',
    }
    plazas.push(makePlazaRecord(synth, h))
  }

  // Build map POI additions for bay/map.bin (featured neighborhood plazas + major parody anchors)
  const mapPlaces = []
  const seenMap = new Set()
  for (const pl of plazas) {
    if (pl.mapFeatured || pl.t === 'town_square' || pl.t === 'civic_plaza') {
      const key = normalizeName(pl.label)
      if (!seenMap.has(key)) {
        seenMap.add(key)
        mapPlaces.push({ name: pl.label, x: Math.round(pl.x * 10), z: Math.round(pl.z * 10), kind: 'park' })
      }
    }
  }
  // Surface flagship parody grocery/retail anchors in map search & GPS (e.g. Whole Moods Market, Bullseye Mart)
  const MAP_BRAND_ANCHORS = new Set(['whole-foods', 'target', 'trader-joes', 'apple-store', 'ikea', 'costco'])
  const brandSeenNear = []
  for (const sh of shops) {
    if (!sh.br || !MAP_BRAND_ANCHORS.has(sh.br)) continue
    if (brandSeenNear.some((b) => b.br === sh.br && Math.hypot(b.x - sh.x, b.z - sh.z) < 400)) continue
    brandSeenNear.push({ br: sh.br, x: sh.x, z: sh.z })
    mapPlaces.push({ name: sh.n, x: Math.round(sh.x * 10), z: Math.round(sh.z * 10), kind: 'landmark' })
  }

  const data = {
    version: 1,
    frame: raw.frame ?? '10n4250',
    sources: raw.sources ?? {},
    credits: 'Places: Overture Maps Foundation (CDLA-Permissive-2.0); Plazas & POIs: OpenStreetMap contributors (ODbL 1.0) & DataSF (PDDL 1.0)',
    styles,
    shops,
    plazas,
  }
  const bytes = Buffer.from(JSON.stringify(data), 'utf8')
  const stats = {
    shops: shops.length,
    parodyShops: parodyCount,
    parodyBrandsMatched: brandHits.size,
    plazas: plazas.length,
    benches: benchCount,
    mapPlaces: mapPlaces.length,
    skippedHeroShops,
    skippedHeroPlazas,
    bytes: bytes.length,
  }
  const summary = `${stats.shops} storefronts (${stats.parodyShops} parody across ${stats.parodyBrandsMatched} chains), ${stats.plazas} plazas (${stats.benches} OSM benches), ${stats.mapPlaces} map POIs, ${(bytes.length / 1024).toFixed(0)} KB`
  return { data, bytes, mapPlaces, stats, summary }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const outIdx = process.argv.indexOf('--out')
  const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null
  const built = buildPlaces()
  if (outFile) writeFileSync(outFile, built.bytes)
  console.log(`  neighborhoods: ${built.summary}`)
}
