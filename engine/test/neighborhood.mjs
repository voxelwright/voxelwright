// Verifies the systemic SF neighborhood character pipeline (#93):
//   1. Configurable GTA-style parody branding (`sf/brands.json`) replaces trademarked chains
//      (Whole Foods, Target, Starbucks, Walgreens, Chase, etc.) while preserving independent local shops.
//   2. Editing `brands.json` or adding a per-place override deterministically regenerates `bay/places.json`
//      and `bay/map.bin` POI labels with zero code edits.
//   3. Open-data raw catalog (`sf/places-raw.json.br`) covers Noe Valley Town Square + 24th Street
//      (pizzeria, burger joint, ice cream, coffee, books, florist, corner store, Whole Foods parody)
//      as well as major SF neighborhoods citywide (North Beach, Castro, Mission, Hayes Valley, Chinatown, Richmond).
//   4. Procedural 3D voxel prop kit (`page/neighborhood-props.ts`) builds valid non-empty meshes.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlaces, compileBrandRules, DEFAULT_BRANDS, DEFAULT_PLAZAS, DEFAULT_RAW } from '../sf/places.mjs'
import { neighborhoodPropKit } from '../page/neighborhood-props.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// 1. Unit checks on brand parody matcher & configurability
{
  const cfg = JSON.parse(readFileSync(DEFAULT_BRANDS, 'utf8'))
  const rules = compileBrandRules(cfg)

  const wf = rules.resolve({ n: 'Whole Foods Market', b: 'Whole Foods Market', c: 'supermarket', x: 50240, z: 71580 })
  assert.equal(wf.name, 'Whole Moods Market')
  assert.equal(wf.brandId, 'whole-foods')
  assert.equal(wf.parodyOf, 'Whole Foods Market')

  const tgt = rules.resolve({ n: 'Target', b: 'Target', c: 'supermarket', x: 51000, z: 70000 })
  assert.equal(tgt.name, 'Bullseye Mart')
  assert.equal(tgt.brandId, 'target')

  const sbux = rules.resolve({ n: 'Starbucks', b: 'Starbucks', c: 'coffee', x: 50200, z: 71600 })
  assert.equal(sbux.name, 'Starbuxx Coffee')

  const indep = rules.resolve({ n: 'Haystack Pizza', c: 'pizza', x: 50290, z: 71590 })
  assert.equal(indep.name, 'Haystack Pizza')
  assert.equal(indep.parodyOf, null)
  assert.equal(indep.brandId, null)

  // Word-boundary safety: short brand tokens like "gap" or "amc" must NOT match inside unrelated words
  const agave = rules.resolve({ n: 'Agave Cafe', c: 'coffee', x: 50100, z: 71500 })
  assert.equal(agave.name, 'Agave Cafe')
  assert.equal(agave.parodyOf, null)

  const scam = rules.resolve({ n: 'Camcorders Plus', c: 'boutique', x: 50100, z: 71500 })
  assert.equal(scam.parodyOf, null)
}

// 2. Full city build check on committed SF open-data catalog
const built = buildPlaces()
assert.ok(built.stats.shops >= 8000, `expected >= 8000 citywide storefronts, got ${built.stats.shops}`)
assert.ok(built.stats.plazas >= 200, `expected >= 200 SF plazas/parks, got ${built.stats.plazas}`)
assert.ok(built.stats.parodyShops >= 300, `expected >= 300 parody chain storefronts, got ${built.stats.parodyShops}`)
assert.ok(built.stats.parodyBrandsMatched >= 30, `expected >= 30 distinct chains matched, got ${built.stats.parodyBrandsMatched}`)
assert.ok(built.stats.mapPlaces >= 40, `expected >= 40 map POIs, got ${built.stats.mapPlaces}`)

// Every shop must have a valid outward unit normal and positive facade width
for (const s of built.data.shops) {
  const nLen = Math.hypot(s.nx, s.nz)
  assert.ok(Math.abs(nLen - 1) < 0.02, `non-unit wall normal on ${s.n}: (${s.nx}, ${s.nz})`)
  assert.ok(s.w >= 2.0, `degenerate facade width on ${s.n}: ${s.w}`)
  assert.ok(s.sw >= 0, `negative sidewalk clearance on ${s.n}: ${s.sw}`)
}

// 3. Showcase verification: Noe Valley Town Square + 24th Street corridor
const nvx = 50299.5, nvz = 71596.7
const nvPlaza = built.data.plazas.find((p) => p.id === 'noe-valley-town-square')
assert.ok(nvPlaza, 'Noe Valley Town Square must exist in compiled plazas')
assert.equal(nvPlaza.t, 'town_square')
assert.ok(Math.hypot(nvPlaza.x - nvx, nvPlaza.z - nvz) < 40, 'Noe Valley Town Square centroid should match real square')
assert.ok(nvPlaza.cfg.pav === 1 && nvPlaza.cfg.lit === 1 && nvPlaza.cfg.arch === 1 && nvPlaza.cfg.crowd >= 16, 'Noe Valley Town Square should have pavilion, string lights, archway & lively crowd')
assert.ok(built.mapPlaces.some((m) => m.name === 'Noe Valley Town Square'), 'Noe Valley Town Square must appear in map POIs')

const nvShops = built.data.shops.filter((s) => Math.hypot(s.x - nvx, s.z - nvz) < 260)
const nvCats = new Set(nvShops.map((s) => s.c))
for (const want of ['pizza', 'burger', 'ice_cream', 'coffee', 'books', 'florist', 'supermarket']) {
  assert.ok(nvCats.has(want), `Noe Valley 24th St missing category "${want}" (found: ${[...nvCats].join(', ')})`)
}
assert.ok(
  nvShops.some((s) => s.br === 'whole-foods' && s.n === 'WHOLE MOODS'),
  'Whole Foods on 24th St must compile with configured GTA-style parody name',
)

// 4. Systemic citywide coverage across multiple SF neighborhoods
const hoods = [
  ['North Beach / Washington Sq', 51946, 66130],
  ['Hayes Valley / Patricia\'s Green', 50703, 68829],
  ['Castro / Jane Warner Plaza', 49780, 70396],
  ['Mission / Valencia St', 50976, 70698],
  ['Chinatown / Portsmouth Sq', 52365, 66797],
  ['Inner Richmond / Clement St', 47228, 68142],
]
for (const [label, hx, hz] of hoods) {
  const nearby = built.data.shops.filter((s) => Math.hypot(s.x - hx, s.z - hz) < 260)
  assert.ok(nearby.length >= 15, `${label} should have >= 15 storefronts within 260 m, got ${nearby.length}`)
}

// 5. Config-driven regeneration proof: editing brands.json updates BOTH places.json AND map.bin POIs!
const tmp = mkdtempSync(join(tmpdir(), 'vw-brands-'))
try {
  const customBrands = JSON.parse(readFileSync(DEFAULT_BRANDS, 'utf8'))
  const wfEntry = customBrands.brands.find((b) => b.id === 'whole-foods')
  wfEntry.parody = 'Organic Paycheck'
  wfEntry.short = 'ORGANIC PAYCHECK'
  customBrands.overrides.push({
    match: 'Haystack Pizza',
    name: 'Noe Crust Pizzeria',
    short: 'NOE CRUST',
  })
  const customBrandsPath = join(tmp, 'brands.json')
  writeFileSync(customBrandsPath, JSON.stringify(customBrands))

  const rebuilt = buildPlaces({ rawPath: DEFAULT_RAW, brandsPath: customBrandsPath, plazasPath: DEFAULT_PLAZAS })
  assert.ok(
    rebuilt.data.shops.some((s) => s.br === 'whole-foods' && s.n === 'ORGANIC PAYCHECK'),
    'changing brands.json must regenerate storefront sign titles',
  )
  assert.ok(
    !rebuilt.data.shops.some((s) => s.n === 'WHOLE MOODS'),
    'old parody name must disappear after config change',
  )
  assert.ok(
    rebuilt.mapPlaces.some((m) => m.name === 'ORGANIC PAYCHECK'),
    'changing brands.json must also regenerate map POI names',
  )
  assert.ok(
    rebuilt.data.shops.some((s) => s.n === 'NOE CRUST'),
    'per-place overrides in brands.json must take precedence',
  )
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// 6. Voxel prop kit integrity check (every prop builds valid non-empty merged face buffers)
const kit = neighborhoodPropKit()
const assets = [
  ['bench', kit.bench],
  ['pavilion', kit.pavilion],
  ['archway', kit.archway],
  ['festoon', kit.festoon],
  ['planter', kit.planter],
  ['littleLibrary', kit.littleLibrary],
  ['fountain', kit.fountain],
  ['waterFountain', kit.waterFountain],
  ['picnicTable', kit.picnicTable],
  ['bollard', kit.bollard],
  ['deckPad', kit.deckPad],
  ['aframe', kit.aframe],
  ['floristStand', kit.floristStand],
  ['bookCart', kit.bookCart],
  ['groceryCrates', kit.groceryCrates],
  ['bladeBracket', kit.bladeBracket],
  ...kit.marketStalls.map((a, i) => [`marketStall[${i}]`, a]),
  ...kit.cafePatios.map((a, i) => [`cafePatio[${i}]`, a]),
]
for (const [name, asset] of assets) {
  assert.ok(asset.born.cells > 0, `${name} has 0 voxels`)
  assert.ok(asset.born.faces.length > 0, `${name} has 0 merged faces`)
  assert.ok(asset.cell > 0 && asset.cell <= 1, `${name} has invalid cell scale ${asset.cell}`)
}

console.log(`PASS neighborhood: ${built.summary} (${assets.length} voxel prop kits verified)`)
void root
