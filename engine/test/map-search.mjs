// Verifies the Apple Maps-style quick POI search engine (page/map-search.ts, sf/places.mjs, sf/map.mjs):
//   1. Full SF catalog indexing combines storefronts, plazas, curated landmarks, parks, hospitals, neighborhoods & streets.
//   2. Category search ("barbershop", "coffee", "hospitals", "parks", "gas", "fast_food", etc.) returns real SF POIs
//      strictly ranked by proximity and fixes the raw "barber" -> "bar" misclassification.
//   3. Specific place queries ("hi way burger") normalize hyphens/punctuation, match across name + category/tagline,
//      and rank multiple branches by proximity to the user's location (Noe Valley vs North Beach).
//   4. Autocomplete suggests both category searches and location-ranked individual places.
//   5. Screen-space pin clustering merges nearby pins into numbered clusters with lead labels and preserves isolated pins.
import assert from 'node:assert/strict'
import { buildPlaces, latLonToWorldM } from '../sf/places.mjs'
import {
  SEARCH_CATEGORIES,
  buildSearchIndex,
  clusterSearchPins,
  matchCategoryQuery,
  normalizeQuery,
} from '../page/map-search.ts'

// Build real SF places payload from committed open-data catalog
const built = buildPlaces()
const placesPayload = built.data

// Synthesize representative MapData with SF neighborhoods, landmarks, hospitals, parks & named streets
const mkPlace = (name, lat, lon, kind) => {
  const [x, z] = latLonToWorldM(lat, lon)
  return { name, x, z, kind }
}
const mockMap = {
  x0: 42000,
  z0: 62000,
  spanX: 16000,
  spanZ: 18000,
  rw: 1,
  rh: 1,
  raster: new Uint8Array(2),
  nNodes: 4,
  nodes: Float32Array.from([50290, 71590, 50360, 71590, 52080, 66330, 52140, 66360]),
  nEdges: 2,
  edgeA: Uint32Array.from([0, 2]),
  edgeB: Uint32Array.from([1, 3]),
  edgeName: Uint16Array.from([0, 1]),
  edgeFlags: Uint8Array.from([3 | (2 << 2), 3 | (2 << 2)]),
  adjOff: Uint32Array.from([0, 1, 2, 3, 4]),
  adjTo: Uint32Array.from([1, 0, 3, 2]),
  adjEdge: Uint32Array.from([0, 0, 1, 1]),
  adjDir: Uint8Array.from([1, 1, 1, 1]),
  names: ['24th Street', 'Columbus Avenue'],
  roadGrid: { cell: 80, gx0: 0, gz0: 0, nx: 1, nz: 1, off: new Uint32Array(2), list: new Uint32Array(0) },
  nBldgs: 0,
  bldgFirst: new Uint32Array(0),
  bldgCount: new Uint8Array(0),
  bldgColor: new Uint8Array(0),
  bldgFlags: new Uint16Array(0),
  bldgBase: new Float32Array(0),
  bldgHeight: new Float32Array(0),
  bldgVerts: new Float32Array(0),
  places: [
    mkPlace('Coit Tower', 37.80241, -122.40582, 'landmark'),
    mkPlace('Ferry Building', 37.7955, -122.3937, 'landmark'),
    mkPlace('Golden Gate Bridge', 37.8078, -122.4748, 'landmark'),
    mkPlace('Mission Dolores Park', 37.7596, -122.4269, 'park'),
    mkPlace('UCSF Medical Center (Parnassus)', 37.7631, -122.4586, 'hospital'),
    mkPlace('Zuckerberg SF General Hospital', 37.7555, -122.4044, 'hospital'),
    mkPlace('Kaiser Permanente SF Medical Center', 37.7827, -122.4426, 'hospital'),
    mkPlace('Noe Valley', 37.7502, -122.4337, 'hood'),
    mkPlace('North Beach', 37.8035, -122.4095, 'hood'),
    mkPlace('Mission District', 37.7599, -122.4148, 'hood'),
    mkPlace('Castro', 37.7609, -122.4350, 'hood'),
  ],
  title: 'San Francisco',
}

const idx = buildSearchIndex(mockMap, placesPayload)
assert.ok(idx.pois.length >= 13_000, `expected >= 13,000 indexed SF POIs, got ${idx.pois.length}`)

// 1. Normalization & category alias detection
assert.equal(normalizeQuery("Hi-Way Burger's!"), 'hi way burgers')
assert.equal(matchCategoryQuery('barbershop')?.id, 'barbershop')
assert.equal(matchCategoryQuery('barber')?.id, 'barbershop')
assert.equal(matchCategoryQuery('coffee')?.id, 'coffee')
assert.equal(matchCategoryQuery('hospital')?.id, 'hospitals')
assert.equal(matchCategoryQuery('fast food')?.id, 'fast_food')
assert.equal(matchCategoryQuery('gas station')?.id, 'gas')
assert.equal(matchCategoryQuery('hi way burger'), null)

// 2. Barbershop search: must find real SF barbershops (including the 62 previously misclassified as `bar`)
const [noeX, noeZ] = latLonToWorldM(37.7515, -122.4317)
const barbers = idx.search({ query: 'barbershop', anchorX: noeX, anchorZ: noeZ })
assert.equal(barbers.resolvedCategory?.id, 'barbershop')
assert.ok(barbers.total >= 90, `expected >= 90 SF barbershops, got ${barbers.total}`)
// Distances must be strictly non-decreasing (nearest first)
for (let i = 1; i < barbers.items.length; i++) {
  assert.ok(barbers.items[i].distM >= barbers.items[i - 1].distM - 1e-6, 'barbershop results must be sorted nearest-first')
}
// Every barbershop must NOT appear under Bars category!
const barsRes = idx.search({ categoryId: 'bars', anchorX: noeX, anchorZ: noeZ, limit: 2000 })
assert.ok(
  !barsRes.items.some((it) => /\bbarber/i.test(it.poi.name)),
  'barbershops must not leak into Bars category',
)

// 3. Specific multi-branch place query: "hi way burger" ranked by user location!
const [nbX, nbZ] = latLonToWorldM(37.8005, -122.4091) // North Beach / Columbus Ave
const hiWayFromNoe = idx.suggest('hi way burger', noeX, noeZ, 8)
const hiWayPoisNoe = hiWayFromNoe.filter((s) => s.kind === 'poi' && s.poi.name.toLowerCase().includes('hi-way'))
assert.ok(hiWayPoisNoe.length >= 2, `expected both SF Hi-Way branches for "hi way burger", got ${hiWayPoisNoe.length}`)
assert.ok(
  !hiWayFromNoe.some((s) => s.kind === 'poi' && s.poi.name === "Sam's"),
  'word-start matching must prevent "hi" in "Chinatown" + "way" in "Broadway" false positives',
)
assert.ok(
  hiWayPoisNoe[0].poi.address.includes('24th'),
  `from Noe Valley, 24th St Hi-Way should rank first (got: ${hiWayPoisNoe[0].poi.address})`,
)
assert.ok(
  hiWayPoisNoe[1].poi.address.includes('Columbus'),
  `from Noe Valley, Columbus Ave Hi-Way should rank second (got: ${hiWayPoisNoe[1].poi.address})`,
)

const hiWayFromNb = idx.suggest('hi way burger', nbX, nbZ, 8)
const hiWayPoisNb = hiWayFromNb.filter((s) => s.kind === 'poi' && s.poi.name.toLowerCase().includes('hi-way'))
assert.ok(hiWayPoisNb.length >= 2)
assert.ok(
  hiWayPoisNb[0].poi.address.includes('Columbus'),
  `from North Beach, Columbus Ave Hi-Way should rank first (got: ${hiWayPoisNb[0].poi.address})`,
)

// 4. Autocomplete for "barber" suggests both the Barbershops category AND specific barbershops
const barberSug = idx.suggest('barber', noeX, noeZ, 8)
assert.equal(barberSug[0]?.kind, 'category')
assert.equal(barberSug[0]?.category?.id, 'barbershop')
assert.ok(barberSug.some((s) => s.kind === 'poi'), 'barber autocomplete should also include specific nearby barbershops')

// 5. Every default quick-suggestion category pill has real SF POIs
for (const cat of SEARCH_CATEGORIES.filter((c) => c.pill)) {
  const c = idx.countForCategory(cat.id)
  assert.ok(c >= 3, `category pill "${cat.label}" (${cat.id}) should have >= 3 real SF POIs, got ${c}`)
}

// 6. Suggested nearby places returns diverse nearby highlights
const nearby = idx.suggestedNearby(noeX, noeZ, 6)
assert.equal(nearby.length, 6)
assert.ok(nearby.every((n) => n.distM < 4500))

// 7. Screen-space pin clustering merges nearby pins & preserves distant isolated pins
const dummyItem = (id, x, z) => ({
  poi: {
    id,
    name: id,
    x,
    z,
    categoryId: 'barbershop',
    categoryLabel: 'Barber Shop',
    rawCategory: 'salon',
    address: '',
    neighborhood: '',
    tagline: '',
    source: 'shop',
    color: '#d9a432',
    icon: 'scissors',
    priority: 6,
    nameNorm: id,
    hayNorm: id,
  },
  distM: 100,
  score: 100,
})
const clustered = clusterSearchPins(
  [
    { item: dummyItem('a', 10, 10), x: 100, y: 100 },
    { item: dummyItem('b', 20, 20), x: 112, y: 108 },
    { item: dummyItem('c', 30, 30), x: 105, y: 115 },
    { item: dummyItem('far', 500, 500), x: 420, y: 310 },
  ],
  36,
  50,
)
assert.equal(clustered.items.length, 2, '3 close pins + 1 far pin should form 1 cluster + 1 single')
assert.equal(clustered.items[0].kind, 'cluster')
assert.equal(clustered.items[0].count, 3)
assert.equal(clustered.items[0].lead.poi.id, 'a')
assert.equal(clustered.items[1].kind, 'single')
assert.equal(clustered.items[1].lead.poi.id, 'far')

console.log(
  `PASS map-search: ${idx.pois.length} SF POIs indexed (${barbers.total} barbershops, ${idx.countForCategory('coffee')} coffee, ${idx.countForCategory('hospitals')} hospitals, ${idx.countForCategory('parks')} parks, ${idx.countForCategory('gas')} gas stations)`,
)
