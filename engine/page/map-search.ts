// Apple Maps-style POI search index, category catalog, location-ranked autocomplete,
// recent searches persistence, screen-space pin clustering, and vector category icons.
import type { MapData } from './nav-data.ts'
import type { PlacesPayload } from './neighborhood.ts'

export type SearchIconId =
  | 'coffee'
  | 'utensils'
  | 'burger'
  | 'scissors'
  | 'tree'
  | 'star'
  | 'cross'
  | 'fuel'
  | 'martini'
  | 'bag'
  | 'pill'
  | 'dumbbell'
  | 'croissant'
  | 'book'
  | 'film'
  | 'bank'
  | 'shop'
  | 'road'
  | 'pin'

export interface SearchCategory {
  readonly id: string
  readonly label: string
  readonly singular: string
  readonly color: string
  readonly icon: SearchIconId
  /** Show in the default horizontal quick-suggestion pill strip. */
  readonly pill: boolean
  /** Normalized words/phrases that directly trigger this category. */
  readonly aliases: readonly string[]
  /** Predicate matching a normalized SearchPoi into this category. */
  readonly match: (poi: SearchPoi) => boolean
}

export interface SearchPoi {
  readonly id: string
  /** Primary display name (e.g. "Hi-Way", "Coit Tower", "Alex's Barber Shop"). */
  readonly name: string
  /** World metres (x east, z south). */
  readonly x: number
  readonly z: number
  /** Primary resolved SearchCategory id (e.g. "barbershop", "coffee", "hospitals", "parks"). */
  readonly categoryId: string
  /** Human-readable type label (e.g. "Barber Shop", "Burgers", "Hospital", "Park"). */
  readonly categoryLabel: string
  /** Raw source kind/category (e.g. "burger", "salon", "landmark", "hospital", "park", "hood", "street"). */
  readonly rawCategory: string
  /** Street address or street name if available (e.g. "3853 24th Street"). */
  readonly address: string
  /** Nearest San Francisco neighborhood if available (e.g. "Noe Valley"). */
  readonly neighborhood: string
  /** Tagline from storefront rules (e.g. "BURGERS", "GAS STATION"). */
  readonly tagline: string
  /** Origin source for priority & dedup. */
  readonly source: 'shop' | 'plaza' | 'landmark' | 'park' | 'hospital' | 'hood' | 'street'
  /** Pin color hex. */
  readonly color: string
  /** Icon key. */
  readonly icon: SearchIconId
  /** Search boost (higher for curated landmarks/hospitals/plazas/parody anchors). */
  readonly priority: number
  /** Pre-normalized search fields. */
  readonly nameNorm: string
  readonly hayNorm: string
}

export interface SearchResultItem {
  readonly poi: SearchPoi
  readonly distM: number
  readonly score: number
}

export interface SearchSuggestion {
  readonly kind: 'category' | 'poi'
  readonly category?: SearchCategory
  readonly categoryCount?: number
  readonly poi?: SearchPoi
  readonly distM?: number
  readonly score: number
}

export interface SearchRecent {
  readonly kind: 'category' | 'poi' | 'query'
  readonly label: string
  readonly subtitle: string
  readonly query: string
  readonly categoryId?: string
  readonly x?: number
  readonly z?: number
  readonly icon: SearchIconId
  readonly color: string
}

export interface PinClusterItem {
  readonly kind: 'single' | 'cluster'
  readonly lead: SearchResultItem
  readonly members: readonly SearchResultItem[]
  readonly count: number
  /** Screen coordinates in CSS pixels. */
  readonly x: number
  readonly y: number
  /** Average world metres for cluster zoom-in. */
  readonly cx: number
  readonly cz: number
}

const BARBER_RE = /\bbarber/i
const GAS_NAME_RE = /\b(gas|fuel|chevron|chev run|clam fuel|shell|arco|valero|mobil|exxon|76)\b/i
const HOSPITAL_RE = /\b(hospital|medical center|urgent care|clinic|kaiser|ucsf|cpmc|va medical|health center)\b/i
const FAST_FOOD_RE = /\b(burger|burgers|pizza|pizzeria|taco|tacos|taqueria|sandwich|burrito|hot dog|fried chicken|fast food|deli|kebab|wing|wings|subway|mcdonald|wendy|in n out|shake shack|chipotle)\b/i

export function normalizeQuery(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export const SEARCH_CATEGORIES: readonly SearchCategory[] = [
  {
    id: 'coffee',
    label: 'Coffee Shops',
    singular: 'Coffee Shop',
    color: '#c97b38',
    icon: 'coffee',
    pill: true,
    aliases: ['coffee', 'coffee shop', 'coffee shops', 'cafe', 'cafes', 'espresso', 'latte', 'tea', 'boba', 'roaster', 'roasters'],
    match: (p) => p.rawCategory === 'coffee',
  },
  {
    id: 'restaurants',
    label: 'Restaurants',
    singular: 'Restaurant',
    color: '#f27c24',
    icon: 'utensils',
    pill: true,
    aliases: ['restaurant', 'restaurants', 'food', 'dining', 'dinner', 'lunch', 'eat', 'kitchen', 'sushi', 'ramen', 'thai', 'italian', 'mexican', 'chinese', 'indian'],
    match: (p) => p.rawCategory === 'restaurant' || p.rawCategory === 'pizza' || p.rawCategory === 'burger',
  },
  {
    id: 'fast_food',
    label: 'Fast Food',
    singular: 'Fast Food',
    color: '#eb9428',
    icon: 'burger',
    pill: true,
    aliases: ['fast food', 'burger', 'burgers', 'pizza', 'pizzeria', 'taco', 'tacos', 'taqueria', 'sandwich', 'burrito', 'quick bite'],
    match: (p) => p.rawCategory === 'burger' || p.rawCategory === 'pizza' || (p.source === 'shop' && FAST_FOOD_RE.test(`${p.nameNorm} ${p.tagline}`)),
  },
  {
    id: 'barbershop',
    label: 'Barbershops',
    singular: 'Barber Shop',
    color: '#d9a432',
    icon: 'scissors',
    pill: true,
    aliases: ['barbershop', 'barbershops', 'barber', 'barbers', 'barber shop', 'barber shops', 'haircut', 'haircuts', 'fade', 'shave'],
    match: (p) => p.source === 'shop' && BARBER_RE.test(p.nameNorm),
  },
  {
    id: 'parks',
    label: 'Parks',
    singular: 'Park',
    color: '#32b866',
    icon: 'tree',
    pill: true,
    aliases: ['park', 'parks', 'plaza', 'plazas', 'square', 'garden', 'gardens', 'hike', 'hikes', 'trail', 'beach', 'overlook', 'green'],
    match: (p) => p.source === 'park' || p.source === 'plaza',
  },
  {
    id: 'landmarks',
    label: 'Landmarks',
    singular: 'Landmark',
    color: '#8e62f5',
    icon: 'star',
    pill: true,
    aliases: ['landmark', 'landmarks', 'sights', 'sightseeing', 'attraction', 'attractions', 'museum', 'museums', 'bridge', 'tower', 'pier', 'monument'],
    match: (p) => p.source === 'landmark',
  },
  {
    id: 'hospitals',
    label: 'Hospitals',
    singular: 'Hospital',
    color: '#e64757',
    icon: 'cross',
    pill: true,
    aliases: ['hospital', 'hospitals', 'medical', 'medical center', 'clinic', 'clinics', 'urgent care', 'emergency', 'er', 'doctor', 'health', 'walk in'],
    match: (p) =>
      p.source === 'hospital' ||
      p.rawCategory === 'urgent_care' ||
      (p.source === 'shop' && HOSPITAL_RE.test(p.nameNorm) && !/\bhospitality\b/i.test(p.nameNorm)),
  },
  {
    id: 'gas',
    label: 'Gas Stations',
    singular: 'Gas Station',
    color: '#3a98fa',
    icon: 'fuel',
    pill: true,
    aliases: ['gas', 'gas station', 'gas stations', 'fuel', 'petrol', 'chevron', 'shell'],
    match: (p) =>
      p.source === 'shop' &&
      (p.tagline.toLowerCase().includes('gas') ||
        p.tagline.toLowerCase().includes('fuel') ||
        (p.rawCategory === 'service' && GAS_NAME_RE.test(p.nameNorm)) ||
        /\b(gas station|fuel|76)\b/i.test(p.nameNorm)),
  },
  {
    id: 'bars',
    label: 'Bars',
    singular: 'Bar & Tavern',
    color: '#b05cf0',
    icon: 'martini',
    pill: true,
    aliases: ['bar', 'bars', 'pub', 'pubs', 'tavern', 'cocktail', 'cocktails', 'drinks', 'nightlife', 'brewery', 'lounge', 'wine bar'],
    match: (p) => p.rawCategory === 'bar' && !BARBER_RE.test(p.nameNorm),
  },
  {
    id: 'groceries',
    label: 'Groceries',
    singular: 'Grocery',
    color: '#29b69c',
    icon: 'bag',
    pill: true,
    aliases: ['grocery', 'groceries', 'supermarket', 'supermarkets', 'market', 'markets', 'corner store', 'deli', 'farmers market', 'convenience'],
    match: (p) => p.rawCategory === 'supermarket' || p.rawCategory === 'grocery' || p.rawCategory === 'corner_store' || p.rawCategory === 'market',
  },
  {
    id: 'pharmacies',
    label: 'Pharmacies',
    singular: 'Pharmacy',
    color: '#de546d',
    icon: 'pill',
    pill: true,
    aliases: ['pharmacy', 'pharmacies', 'drugstore', 'drugstores', 'medicine', 'rx', 'walgreens', 'cvs'],
    match: (p) => p.rawCategory === 'pharmacy',
  },
  {
    id: 'gyms',
    label: 'Gyms',
    singular: 'Fitness Studio',
    color: '#33b3d6',
    icon: 'dumbbell',
    pill: true,
    aliases: ['gym', 'gyms', 'fitness', 'workout', 'yoga', 'pilates', 'studio', 'athletic'],
    match: (p) => p.rawCategory === 'fitness',
  },
  {
    id: 'salons',
    label: 'Salons',
    singular: 'Hair & Beauty',
    color: '#d98a4a',
    icon: 'scissors',
    pill: false,
    aliases: ['salon', 'salons', 'hair salon', 'beauty', 'spa', 'nails', 'nail salon'],
    match: (p) => p.rawCategory === 'salon',
  },
  {
    id: 'bakeries',
    label: 'Bakeries',
    singular: 'Bakery',
    color: '#de8254',
    icon: 'croissant',
    pill: false,
    aliases: ['bakery', 'bakeries', 'pastry', 'pastries', 'bread', 'donut', 'donuts', 'cake', 'ice cream', 'dessert', 'gelato'],
    match: (p) => p.rawCategory === 'bakery' || p.rawCategory === 'ice_cream',
  },
  {
    id: 'bookstores',
    label: 'Bookstores',
    singular: 'Bookstore',
    color: '#5b7bf5',
    icon: 'book',
    pill: false,
    aliases: ['book', 'books', 'bookstore', 'bookstores', 'bookshop', 'library'],
    match: (p) => p.rawCategory === 'books',
  },
  {
    id: 'cinemas',
    label: 'Cinemas',
    singular: 'Cinema & Arts',
    color: '#e3528c',
    icon: 'film',
    pill: false,
    aliases: ['cinema', 'cinemas', 'movie', 'movies', 'theater', 'theatre', 'theaters', 'film'],
    match: (p) => p.rawCategory === 'cinema',
  },
  {
    id: 'banks',
    label: 'Banks',
    singular: 'Bank',
    color: '#6382a6',
    icon: 'bank',
    pill: false,
    aliases: ['bank', 'banks', 'atm', 'credit union', 'vault'],
    match: (p) => p.rawCategory === 'bank',
  },
  {
    id: 'shopping',
    label: 'Shopping',
    singular: 'Shop',
    color: '#e36498',
    icon: 'shop',
    pill: false,
    aliases: ['shop', 'shops', 'shopping', 'boutique', 'store', 'stores', 'florist', 'flowers', 'hardware', 'clothing', 'retail'],
    match: (p) => p.rawCategory === 'boutique' || p.rawCategory === 'florist' || p.rawCategory === 'hardware',
  },
]

const CATEGORY_BY_ID = new Map<string, SearchCategory>(SEARCH_CATEGORIES.map((c) => [c.id, c]))

export function getCategory(id: string): SearchCategory | undefined {
  return CATEGORY_BY_ID.get(id)
}

/** Maps a raw shop category + name + tagline to a primary visual category & human label. */
function classifyShop(rawCat: string, nameNorm: string, tagline: string): { categoryId: string; label: string; color: string; icon: SearchIconId } {
  if (BARBER_RE.test(nameNorm)) {
    const c = CATEGORY_BY_ID.get('barbershop')!
    return { categoryId: c.id, label: 'Barber Shop', color: c.color, icon: c.icon }
  }
  if (rawCat === 'urgent_care') {
    const c = CATEGORY_BY_ID.get('hospitals')!
    return { categoryId: c.id, label: 'Urgent Care', color: c.color, icon: c.icon }
  }
  if (HOSPITAL_RE.test(nameNorm) && !/\bhospitality\b/i.test(nameNorm)) {
    const c = CATEGORY_BY_ID.get('hospitals')!
    return { categoryId: c.id, label: 'Medical Clinic', color: c.color, icon: c.icon }
  }
  const tl = tagline.toLowerCase()
  if (tl.includes('gas') || tl.includes('fuel') || (rawCat === 'service' && GAS_NAME_RE.test(nameNorm)) || /\b(gas station|76)\b/i.test(nameNorm)) {
    const c = CATEGORY_BY_ID.get('gas')!
    return { categoryId: c.id, label: 'Gas Station', color: c.color, icon: c.icon }
  }
  switch (rawCat) {
    case 'coffee': return { categoryId: 'coffee', label: 'Coffee Shop', color: '#c97b38', icon: 'coffee' }
    case 'burger': return { categoryId: 'fast_food', label: 'Burgers', color: '#eb9428', icon: 'burger' }
    case 'pizza': return { categoryId: 'fast_food', label: 'Pizzeria', color: '#f27c24', icon: 'utensils' }
    case 'restaurant': return { categoryId: 'restaurants', label: 'Restaurant', color: '#f27c24', icon: 'utensils' }
    case 'bar': return { categoryId: 'bars', label: 'Bar & Tavern', color: '#b05cf0', icon: 'martini' }
    case 'salon': return { categoryId: 'salons', label: 'Hair & Salon', color: '#d98a4a', icon: 'scissors' }
    case 'bakery': return { categoryId: 'bakeries', label: 'Bakery', color: '#de8254', icon: 'croissant' }
    case 'ice_cream': return { categoryId: 'bakeries', label: 'Ice Cream', color: '#e46b8c', icon: 'croissant' }
    case 'supermarket': return { categoryId: 'groceries', label: 'Supermarket', color: '#29b69c', icon: 'bag' }
    case 'grocery': return { categoryId: 'groceries', label: 'Grocery', color: '#29b69c', icon: 'bag' }
    case 'corner_store': return { categoryId: 'groceries', label: 'Corner Market', color: '#29b69c', icon: 'bag' }
    case 'market': return { categoryId: 'groceries', label: 'Farmers Market', color: '#29b69c', icon: 'bag' }
    case 'pharmacy': return { categoryId: 'pharmacies', label: 'Pharmacy', color: '#de546d', icon: 'pill' }
    case 'fitness': return { categoryId: 'gyms', label: 'Fitness Studio', color: '#33b3d6', icon: 'dumbbell' }
    case 'books': return { categoryId: 'bookstores', label: 'Bookstore', color: '#5b7bf5', icon: 'book' }
    case 'cinema': return { categoryId: 'cinemas', label: 'Cinema & Arts', color: '#e3528c', icon: 'film' }
    case 'bank': return { categoryId: 'banks', label: 'Bank', color: '#6382a6', icon: 'bank' }
    case 'florist': return { categoryId: 'shopping', label: 'Florist', color: '#45b57c', icon: 'tree' }
    case 'hardware': return { categoryId: 'shopping', label: 'Hardware', color: '#c47b47', icon: 'shop' }
    case 'service': return { categoryId: 'shopping', label: 'Services', color: '#6c8aa8', icon: 'shop' }
    default: return { categoryId: 'shopping', label: 'Shop', color: '#e36498', icon: 'shop' }
  }
}

/** Resolves a normalized user query to a matching category (if exact alias or strong prefix). */
export function matchCategoryQuery(queryNorm: string): SearchCategory | null {
  if (!queryNorm || queryNorm.length < 2) return null
  for (const cat of SEARCH_CATEGORIES) {
    if (cat.aliases.includes(queryNorm) || normalizeQuery(cat.label) === queryNorm) return cat
  }
  if (queryNorm.length >= 3) {
    for (const cat of SEARCH_CATEGORIES) {
      if (normalizeQuery(cat.label).startsWith(queryNorm)) return cat
      if (cat.aliases.some((a) => a.startsWith(queryNorm) && queryNorm.length >= Math.min(4, a.length))) return cat
    }
  }
  return null
}

/** Finds all categories whose label/aliases match a partial query (for autocomplete category rows). */
export function suggestCategories(queryNorm: string, max = 2): SearchCategory[] {
  if (!queryNorm || queryNorm.length < 2) return []
  const exact: SearchCategory[] = []
  const prefix: SearchCategory[] = []
  for (const cat of SEARCH_CATEGORIES) {
    const lbl = normalizeQuery(cat.label)
    if (lbl === queryNorm || cat.aliases.includes(queryNorm)) {
      exact.push(cat)
    } else if (lbl.startsWith(queryNorm) || cat.aliases.some((a) => a.startsWith(queryNorm))) {
      prefix.push(cat)
    }
  }
  return [...exact, ...prefix].slice(0, max)
}

export interface SearchIndex {
  readonly pois: readonly SearchPoi[]
  readonly categoryCounts: ReadonlyMap<string, number>
  /** Fast category pill counts for rendering & filtering. */
  countForCategory(categoryId: string): number
  /** Nearest neighborhood name for any world coordinate `(x, z)` in metres. */
  nearestNeighborhood(x: number, z: number): string
  /** Autocomplete suggestions while typing (categories + specific location-ranked POIs). */
  suggest(query: string, anchorX: number, anchorZ: number, limit?: number): SearchSuggestion[]
  /** Full category or text search returning all distance/relevance-ranked matches for map plotting & list view. */
  search(
    opts: {
      query?: string
      categoryId?: string | null
      anchorX: number
      anchorZ: number
      /** Optional viewport bounds in world metres when filtering to "In View". */
      bounds?: { x0: number; x1: number; z0: number; z1: number } | null
      limit?: number
    },
  ): { items: SearchResultItem[]; total: number; resolvedCategory: SearchCategory | null }
  /** Nearby curated/diverse suggested places when search opens with an empty query. */
  suggestedNearby(anchorX: number, anchorZ: number, limit?: number): SearchResultItem[]
}

/** Builds the unified searchable POI index from `MapData` + optional `PlacesPayload` (`bay/places.json`). */
export function buildSearchIndex(map: MapData | null, places: PlacesPayload | null): SearchIndex {
  const hoods: { name: string; x: number; z: number }[] = []
  if (map) {
    for (const p of map.places) {
      if (p.kind === 'hood') hoods.push({ name: p.name, x: p.x, z: p.z })
    }
  }
  const nearestNeighborhood = (x: number, z: number): string => {
    let best = '', bestD2 = 1800 * 1800
    for (const h of hoods) {
      const d2 = (h.x - x) * (h.x - x) + (h.z - z) * (h.z - z)
      if (d2 < bestD2) { bestD2 = d2; best = h.name }
    }
    return best
  }

  const pois: SearchPoi[] = []
  const dedup = new Map<string, number>() // "normName_cellX_cellZ" -> index

  const pushPoi = (poi: SearchPoi) => {
    const dedupName = poi.nameNorm.replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim()
    const key = `${dedupName}_${Math.round(poi.x / 60)}_${Math.round(poi.z / 60)}`
    const prevIdx = dedup.get(key)
    if (prevIdx !== undefined) {
      // Keep higher-priority or richer-address record when overlapping
      const prev = pois[prevIdx]
      if (poi.priority > prev.priority || (!prev.address && poi.address)) {
        pois[prevIdx] = poi
      }
      return
    }
    dedup.set(key, pois.length)
    pois.push(poi)
  }

  // 1. Curated landmarks, hospitals, parks & neighborhoods from `map.bin`
  if (map) {
    for (let i = 0; i < map.places.length; i++) {
      const p = map.places[i]
      const nameNorm = normalizeQuery(p.name)
      if (!nameNorm) continue
      const hood = p.kind === 'hood' ? '' : nearestNeighborhood(p.x, p.z)
      if (p.kind === 'hospital') {
        pushPoi({
          id: `map:h:${i}`,
          name: p.name,
          x: p.x,
          z: p.z,
          categoryId: 'hospitals',
          categoryLabel: 'Hospital',
          rawCategory: 'hospital',
          address: '',
          neighborhood: hood,
          tagline: 'HOSPITAL MEDICAL CENTER',
          source: 'hospital',
          color: '#e64757',
          icon: 'cross',
          priority: 18,
          nameNorm,
          hayNorm: normalizeQuery(`${p.name} hospital medical center clinic emergency ${hood}`),
        })
      } else if (p.kind === 'park') {
        pushPoi({
          id: `map:p:${i}`,
          name: p.name,
          x: p.x,
          z: p.z,
          categoryId: 'parks',
          categoryLabel: 'Park',
          rawCategory: 'park',
          address: '',
          neighborhood: hood,
          tagline: 'PARK',
          source: 'park',
          color: '#32b866',
          icon: 'tree',
          priority: 16,
          nameNorm,
          hayNorm: normalizeQuery(`${p.name} park outdoor nature ${hood}`),
        })
      } else if (p.kind === 'landmark') {
        pushPoi({
          id: `map:l:${i}`,
          name: p.name,
          x: p.x,
          z: p.z,
          categoryId: 'landmarks',
          categoryLabel: 'Landmark',
          rawCategory: 'landmark',
          address: '',
          neighborhood: hood,
          tagline: 'LANDMARK',
          source: 'landmark',
          color: '#8e62f5',
          icon: 'star',
          priority: 20,
          nameNorm,
          hayNorm: normalizeQuery(`${p.name} landmark sight ${hood}`),
        })
      } else if (p.kind === 'hood') {
        pushPoi({
          id: `map:n:${i}`,
          name: p.name,
          x: p.x,
          z: p.z,
          categoryId: 'landmarks',
          categoryLabel: 'Neighborhood',
          rawCategory: 'hood',
          address: '',
          neighborhood: 'San Francisco',
          tagline: 'NEIGHBORHOOD',
          source: 'hood',
          color: '#6b94c7',
          icon: 'pin',
          priority: 12,
          nameNorm,
          hayNorm: normalizeQuery(`${p.name} neighborhood district san francisco`),
        })
      }
    }
  }

  // 2. Plazas & neighborhood parks from `bay/places.json`
  if (places) {
    for (let i = 0; i < places.plazas.length; i++) {
      const pl = places.plazas[i]
      const displayName = (pl.label || pl.n || '').trim()
      const nameNorm = normalizeQuery(displayName)
      if (!nameNorm) continue
      const hood = nearestNeighborhood(pl.x, pl.z)
      const label = pl.t === 'town_square' ? 'Town Square' : pl.t === 'civic_plaza' || pl.t === 'market_plaza' ? 'Civic Plaza' : 'Park'
      pushPoi({
        id: `plaza:${pl.id || i}`,
        name: displayName,
        x: pl.x,
        z: pl.z,
        categoryId: 'parks',
        categoryLabel: label,
        rawCategory: pl.t || 'park',
        address: pl.sub && pl.sub !== 'SAN FRANCISCO' ? titleCaseIfUpper(pl.sub) : '',
        neighborhood: hood,
        tagline: label.toUpperCase(),
        source: 'plaza',
        color: '#32b866',
        icon: 'tree',
        priority: pl.hero ? 17 : 11,
        nameNorm,
        hayNorm: normalizeQuery(`${displayName} ${label} park plaza ${pl.sub ?? ''} ${hood}`),
      })
    }

    // 3. All SF businesses & storefronts from `bay/places.json`
    for (let i = 0; i < places.shops.length; i++) {
      const sh = places.shops[i]
      const rawDisplay = (sh.fn || sh.n || '').trim()
      const displayName = sh.po ? titleCaseIfUpper(rawDisplay) : rawDisplay
      const nameNorm = normalizeQuery(displayName)
      if (!nameNorm) continue
      const cls = classifyShop(sh.c, nameNorm, sh.t || '')
      const hood = nearestNeighborhood(sh.x, sh.z)
      const addr = (sh.a || '').trim()
      const extraTag = sh.t || ''
      const hay = normalizeQuery(`${displayName} ${sh.n !== displayName ? sh.n : ''} ${cls.label} ${sh.c} ${extraTag} ${addr} ${hood}`)
      pushPoi({
        id: `shop:${i}`,
        name: displayName,
        x: sh.x,
        z: sh.z,
        categoryId: cls.categoryId,
        categoryLabel: cls.label,
        rawCategory: sh.c,
        address: addr,
        neighborhood: hood,
        tagline: extraTag,
        source: 'shop',
        color: cls.color,
        icon: cls.icon,
        priority: sh.br ? 9 : 6,
        nameNorm,
        hayNorm: hay,
      })
    }
  }

  // 4. Representative named streets from `map.bin` (one anchor point per unique street name)
  if (map && map.names.length > 0) {
    const streetAcc = new Map<number, { sx: number; sz: number; count: number; maxTier: number }>()
    for (let i = 0; i < map.nEdges; i++) {
      const ni = map.edgeName[i]
      if (ni >= map.names.length || !map.names[ni]) continue
      const a = map.edgeA[i], b = map.edgeB[i]
      const mx = (map.nodes[a * 2] + map.nodes[b * 2]) * 0.5
      const mz = (map.nodes[a * 2 + 1] + map.nodes[b * 2 + 1]) * 0.5
      const tier = (map.edgeFlags[i] >> 2) & 3
      let acc = streetAcc.get(ni)
      if (!acc) streetAcc.set(ni, (acc = { sx: 0, sz: 0, count: 0, maxTier: 0 }))
      acc.sx += mx; acc.sz += mz; acc.count++
      if (tier > acc.maxTier) acc.maxTier = tier
    }
    for (const [ni, acc] of streetAcc) {
      const nm = map.names[ni]
      const nameNorm = normalizeQuery(nm)
      if (!nameNorm || nameNorm.length < 3) continue
      const cx = acc.sx / acc.count, cz = acc.sz / acc.count
      const hood = nearestNeighborhood(cx, cz)
      pushPoi({
        id: `street:${ni}`,
        name: nm,
        x: cx,
        z: cz,
        categoryId: 'landmarks',
        categoryLabel: 'Street',
        rawCategory: 'street',
        address: '',
        neighborhood: hood,
        tagline: 'STREET',
        source: 'street',
        color: '#6b94c7',
        icon: 'road',
        priority: acc.maxTier >= 2 ? 5 : 2,
        nameNorm,
        hayNorm: normalizeQuery(`${nm} street ${hood}`),
      })
    }
  }

  // Pre-bucket POIs by category for instant O(K) category pill taps & counts!
  const byCategory = new Map<string, SearchPoi[]>()
  const categoryCounts = new Map<string, number>()
  for (const cat of SEARCH_CATEGORIES) {
    const list: SearchPoi[] = []
    for (const p of pois) {
      if (cat.match(p)) list.push(p)
    }
    // Fallback: if barbershop has 0 explicit barber-named POIs (e.g. non-SF town), fall back to salons
    if (cat.id === 'barbershop' && list.length === 0) {
      for (const p of pois) if (p.rawCategory === 'salon') list.push(p)
    }
    byCategory.set(cat.id, list)
    categoryCounts.set(cat.id, list.length)
  }

  /** Word-start match for short tokens (<= 3 chars) so "hi" never hits "chinatown" or "way" hits "broadway". */
  const hasToken = (hay: string, tok: string): boolean => {
    const idx = hay.indexOf(tok)
    if (idx < 0) return false
    if (tok.length >= 4) return true
    let pos = idx
    while (pos >= 0) {
      if (pos === 0 || hay.charCodeAt(pos - 1) === 32) return true
      pos = hay.indexOf(tok, pos + 1)
    }
    return false
  }

  /** Scores one POI against a normalized query & token list relative to `(anchorX, anchorZ)`. */
  const scorePoi = (p: SearchPoi, qNorm: string, tokens: string[], anchorX: number, anchorZ: number): { score: number; distM: number } | null => {
    // Fast reject: every token must match on a word start (or substring for >=4-char tokens) in hayNorm
    for (let i = 0; i < tokens.length; i++) {
      if (!hasToken(p.hayNorm, tokens[i])) return null
    }
    const distM = Math.hypot(p.x - anchorX, p.z - anchorZ)
    let score = 0
    if (p.nameNorm === qNorm) {
      score += 140
    } else if (p.nameNorm.startsWith(qNorm)) {
      score += 105
    } else if (p.nameNorm.includes(qNorm)) {
      score += 82
    } else {
      let nameHits = 0
      let prefixHits = 0
      const nameWords = p.nameNorm.split(' ')
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]
        if (nameWords.some((w) => w.startsWith(tok))) {
          nameHits++
          prefixHits++
        } else if (p.nameNorm.includes(tok)) {
          nameHits++
        }
      }
      if (nameHits === 0) {
        // Only matched category/address/neighborhood — keep lower than direct name matches
        score += 18
      } else if (nameHits === tokens.length) {
        score += 78 + prefixHits * 8
      } else {
        // Hybrid name + category/location query like "hi way burger" or "coffee 24th"
        score += 56 + nameHits * 14 + prefixHits * 6
        if (p.nameNorm.startsWith(tokens[0])) score += 16
      }
    }
    // Slight preference for actual places over raw street segments when names tie
    if (p.source === 'street') score -= 14
    score += p.priority * 0.65
    // Location proximity score (strong tie-breaker so nearby branches ALWAYS rank first!)
    score += 24 / (1 + distM / 850)
    return { score, distM }
  }

  const search: SearchIndex['search'] = ({ query = '', categoryId = null, anchorX, anchorZ, bounds = null, limit = 160 }) => {
    const qNorm = normalizeQuery(query)
    let cat: SearchCategory | null = categoryId ? (CATEGORY_BY_ID.get(categoryId) ?? null) : null
    if (!cat && qNorm) {
      cat = matchCategoryQuery(qNorm)
    }

    const inBounds = (p: SearchPoi) => !bounds || (p.x >= bounds.x0 && p.x <= bounds.x1 && p.z >= bounds.z0 && p.z <= bounds.z1)

    // 1. Category search mode (e.g. tapped "Barbershops" pill or typed "barbershop")
    if (cat && (!qNorm || categoryId || matchCategoryQuery(qNorm)?.id === cat.id)) {
      const list = byCategory.get(cat.id) ?? []
      const matched: SearchResultItem[] = []
      for (const p of list) {
        if (!inBounds(p)) continue
        const distM = Math.hypot(p.x - anchorX, p.z - anchorZ)
        matched.push({ poi: p, distM, score: 1000 - distM * 0.01 + p.priority * 0.1 })
      }
      matched.sort((a, b) => a.distM - b.distM)
      return { items: matched.slice(0, limit), total: matched.length, resolvedCategory: cat }
    }

    // 2. Free-text / specific place / multi-token location search (e.g. "hi way burger")
    if (!qNorm) return { items: [], total: 0, resolvedCategory: null }
    const tokens = qNorm.split(' ').filter(Boolean)
    const matched: SearchResultItem[] = []
    for (const p of pois) {
      if (!inBounds(p)) continue
      const res = scorePoi(p, qNorm, tokens, anchorX, anchorZ)
      if (res) matched.push({ poi: p, distM: res.distM, score: res.score })
    }
    matched.sort((a, b) => (b.score - a.score) || (a.distM - b.distM))
    return { items: matched.slice(0, limit), total: matched.length, resolvedCategory: null }
  }

  const suggest: SearchIndex['suggest'] = (query, anchorX, anchorZ, limit = 8) => {
    const qNorm = normalizeQuery(query)
    if (!qNorm) return []
    const out: SearchSuggestion[] = []
    const cats = suggestCategories(qNorm, 2)
    for (const c of cats) {
      const cnt = categoryCounts.get(c.id) ?? 0
      if (cnt > 0) out.push({ kind: 'category', category: c, categoryCount: cnt, score: 500 })
    }
    const tokens = qNorm.split(' ').filter(Boolean)
    const hits: SearchResultItem[] = []
    for (const p of pois) {
      const res = scorePoi(p, qNorm, tokens, anchorX, anchorZ)
      if (res) hits.push({ poi: p, distM: res.distM, score: res.score })
    }
    hits.sort((a, b) => (b.score - a.score) || (a.distM - b.distM))
    const need = Math.max(1, limit - out.length)
    for (const h of hits.slice(0, need)) {
      out.push({ kind: 'poi', poi: h.poi, distM: h.distM, score: h.score })
    }
    return out
  }

  const suggestedNearby: SearchIndex['suggestedNearby'] = (anchorX, anchorZ, limit = 6) => {
    // Pick a diverse mix of nearby highlights (1 landmark/hospital, 1 park/plaza, and top nearby local spots)
    const scored: SearchResultItem[] = []
    for (const p of pois) {
      if (p.source === 'street' || p.source === 'hood') continue
      const distM = Math.hypot(p.x - anchorX, p.z - anchorZ)
      if (distM > 4500) continue
      const score = p.priority * 3.5 + 80 / (1 + distM / 350)
      scored.push({ poi: p, distM, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const out: SearchResultItem[] = []
    const seenCats = new Map<string, number>()
    const seenNames = new Set<string>()
    for (const item of scored) {
      if (seenNames.has(item.poi.nameNorm)) continue
      const cCount = seenCats.get(item.poi.categoryId) ?? 0
      if (cCount >= 2 && out.length < limit - 1) continue
      seenNames.add(item.poi.nameNorm)
      seenCats.set(item.poi.categoryId, cCount + 1)
      out.push(item)
      if (out.length >= limit) break
    }
    return out
  }

  return {
    pois,
    categoryCounts,
    countForCategory: (id) => categoryCounts.get(id) ?? 0,
    nearestNeighborhood,
    suggest,
    search,
    suggestedNearby,
  }
}

function titleCaseIfUpper(s: string): string {
  const t = s.trim()
  if (!t || t !== t.toUpperCase() || t.length <= 3) return t
  return t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

/**
 * Greedily clusters projected screen-space search pins within `radiusPx` so dense areas (like downtown SF
 * barbershops or coffee shops) stay legible with Apple Maps-style numbered cluster badges ("2", "3", "4" + "+N more").
 */
export function clusterSearchPins(
  projected: readonly { item: SearchResultItem; x: number; y: number }[],
  radiusPx = 36,
  maxPins = 60,
): { items: PinClusterItem[]; dots: { x: number; y: number; color: string }[] } {
  const r2 = radiusPx * radiusPx
  const groups: { lead: SearchResultItem; members: SearchResultItem[]; sumX: number; sumY: number; sumWx: number; sumWz: number }[] = []
  const dots: { x: number; y: number; color: string }[] = []

  for (let i = 0; i < projected.length; i++) {
    const p = projected[i]
    let joined = false
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g]
      const gx = grp.sumX / grp.members.length
      const gy = grp.sumY / grp.members.length
      const dx = p.x - gx, dy = p.y - gy
      if (dx * dx + dy * dy <= r2) {
        grp.members.push(p.item)
        grp.sumX += p.x
        grp.sumY += p.y
        grp.sumWx += p.item.poi.x
        grp.sumWz += p.item.poi.z
        joined = true
        break
      }
    }
    if (!joined) {
      if (groups.length < maxPins) {
        groups.push({
          lead: p.item,
          members: [p.item],
          sumX: p.x,
          sumY: p.y,
          sumWx: p.item.poi.x,
          sumWz: p.item.poi.z,
        })
      } else {
        dots.push({ x: p.x, y: p.y, color: p.item.poi.color })
      }
    }
  }

  const items: PinClusterItem[] = groups.map((g) => {
    const n = g.members.length
    return {
      kind: n > 1 ? 'cluster' : 'single',
      lead: g.lead,
      members: g.members,
      count: n,
      x: g.sumX / n,
      y: g.sumY / n,
      cx: g.sumWx / n,
      cz: g.sumWz / n,
    }
  })
  return { items, dots }
}

// ── Recents persistence (bounded, privacy-safe localStorage) ──
const RECENTS_KEY = 'voxelwright.map.recents.v1'
const MAX_RECENTS = 6

export function loadRecents(): SearchRecent[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r): r is SearchRecent => Boolean(r && typeof r.label === 'string' && typeof r.query === 'string'))
      .slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

export function saveRecent(entry: SearchRecent): SearchRecent[] {
  const prev = loadRecents()
  const key = `${entry.kind}:${normalizeQuery(entry.label)}:${entry.categoryId ?? ''}`
  const next = [entry, ...prev.filter((r) => `${r.kind}:${normalizeQuery(r.label)}:${r.categoryId ?? ''}` !== key)].slice(0, MAX_RECENTS)
  try {
    globalThis.localStorage?.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch { /* ignore storage quota/privacy mode */ }
  return next
}

export function clearRecents(): void {
  try {
    globalThis.localStorage?.removeItem(RECENTS_KEY)
  } catch { /* ignore */ }
}

// ── Crisp Minimalist Inline SVG Icons (for pills & search rows) ──
const SVG_PATHS: Record<SearchIconId, string> = {
  coffee: '<path d="M4 7h11v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V7Z"/><path d="M15 8h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M5 19h10"/>',
  utensils: '<path d="M6 3v7a2.5 2.5 0 0 0 5 0V3M8.5 3v18M16 3v8h3V3a3 3 0 0 0-3 0Zm3 8v10"/>',
  burger: '<path d="M4 11a8 6 0 0 1 16 0H4Z"/><path d="M3.5 14h17"/><path d="M4.5 17h15a1.5 1.5 0 0 1-1.5 2h-12a1.5 1.5 0 0 1-1.5-2Z"/>',
  scissors: '<circle cx="6.5" cy="17" r="2.5"/><circle cx="17.5" cy="17" r="2.5"/><path d="M8.5 15 17 5M15.5 15 7 5"/>',
  tree: '<path d="M12 3 6.5 11h3L5.5 17h13l-4-6h3L12 3Z"/><path d="M12 17v4"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.8-4.2 4.1 1 5.8L12 16.7 6.7 19.5l1-5.8-4.2-4.1 5.9-.8L12 3.5Z"/>',
  cross: '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5V4Z"/>',
  fuel: '<path d="M5 19V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14"/><path d="M3 19h15"/><path d="M8 7h5v4H8z"/><path d="M16 8h1.5a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 0 3 0V8.5L19.5 6"/>',
  martini: '<path d="M4 5h16l-8 8-8-8Z"/><path d="M12 13v7M8 20h8"/>',
  bag: '<path d="M5 8h14l-1.2 12H6.2L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  pill: '<path d="m10.5 4.5 9 9a4.2 4.2 0 0 1-6 6l-9-9a4.2 4.2 0 0 1 6-6Z"/><path d="m8 12 4-4"/>',
  dumbbell: '<path d="M6 7v10M18 7v10M3.5 9.5v5M20.5 9.5v5M6 12h12"/>',
  croissant: '<path d="M4 15c0-4.5 3.6-8 8-8s8 3.5 8 8c0 1.8-1.4 3-3.2 3H7.2C5.4 18 4 16.8 4 15Z"/><path d="M9 8v10M15 8v10"/>',
  book: '<path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h12.5v16.5H7A2.5 2.5 0 0 0 4.5 22V5.5Z"/><path d="M7 16.5h12.5"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5"/>',
  bank: '<path d="M3 9 12 4l9 5H3Z"/><path d="M5.5 9v8M10 9v8M14 9v8M18.5 9v8M3 17h18M2.5 20h19"/>',
  shop: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 6 0"/><path d="M5.5 12v8h13v-8"/>',
  road: '<path d="M8 4 5 20M16 4l3 16M12 5v3M12 11v3M12 17v3"/>',
  pin: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11Z"/><circle cx="12" cy="10" r="2.2"/>',
}

export function iconSvg(icon: SearchIconId, size = 14): string {
  const p = SVG_PATHS[icon] ?? SVG_PATHS.pin
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
}

/** Draws a razor-sharp miniature white category glyph centered at (0, 0) inside a map pin circle of radius ~r. */
export function drawPinGlyph(ctx: CanvasRenderingContext2D, icon: SearchIconId, r: number): void {
  const s = r * 0.56
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = Math.max(1.3, r * 0.145)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (icon) {
    case 'scissors':
      ctx.beginPath()
      ctx.moveTo(-s * 0.72, -s * 0.78); ctx.lineTo(s * 0.52, s * 0.45)
      ctx.moveTo(s * 0.72, -s * 0.78); ctx.lineTo(-s * 0.52, s * 0.45)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(-s * 0.55, s * 0.62, s * 0.28, 0, Math.PI * 2)
      ctx.arc(s * 0.55, s * 0.62, s * 0.28, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'coffee':
      ctx.beginPath()
      ctx.roundRect(-s * 0.78, -s * 0.52, s * 1.18, s * 1.05, s * 0.22)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(s * 0.44, -s * 0.02, s * 0.32, -Math.PI * 0.5, Math.PI * 0.5)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-s * 0.78, s * 0.78); ctx.lineTo(s * 0.55, s * 0.78)
      ctx.stroke()
      break
    case 'utensils':
      ctx.beginPath()
      ctx.moveTo(-s * 0.42, -s * 0.85); ctx.lineTo(-s * 0.42, s * 0.85)
      ctx.moveTo(-s * 0.68, -s * 0.85); ctx.lineTo(-s * 0.68, -s * 0.12)
      ctx.moveTo(-s * 0.16, -s * 0.85); ctx.lineTo(-s * 0.16, -s * 0.12)
      ctx.moveTo(-s * 0.68, -s * 0.12); ctx.lineTo(-s * 0.16, -s * 0.12)
      ctx.moveTo(s * 0.44, -s * 0.85); ctx.lineTo(s * 0.44, s * 0.85)
      ctx.moveTo(s * 0.44, -s * 0.85); ctx.lineTo(s * 0.72, -s * 0.2); ctx.lineTo(s * 0.44, -s * 0.05)
      ctx.stroke()
      break
    case 'burger':
      ctx.beginPath()
      ctx.arc(0, -s * 0.08, s * 0.82, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(-s * 0.85, s * 0.26); ctx.lineTo(s * 0.85, s * 0.26)
      ctx.moveTo(-s * 0.72, s * 0.66); ctx.lineTo(s * 0.72, s * 0.66)
      ctx.stroke()
      break
    case 'tree':
      ctx.beginPath()
      ctx.moveTo(0, -s * 0.92)
      ctx.lineTo(s * 0.78, s * 0.42)
      ctx.lineTo(-s * 0.78, s * 0.42)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(0, s * 0.42); ctx.lineTo(0, s * 0.9)
      ctx.stroke()
      break
    case 'cross':
      ctx.beginPath()
      ctx.rect(-s * 0.26, -s * 0.82, s * 0.52, s * 1.64)
      ctx.rect(-s * 0.82, -s * 0.26, s * 1.64, s * 0.52)
      ctx.fill()
      break
    case 'star':
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI * 0.5 + (i * Math.PI) / 5
        const rad = i % 2 === 0 ? s * 0.92 : s * 0.42
        const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
      break
    case 'fuel':
      ctx.beginPath()
      ctx.roundRect(-s * 0.68, -s * 0.75, s * 0.98, s * 1.5, s * 0.16)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(s * 0.34, -s * 0.32); ctx.lineTo(s * 0.74, -s * 0.12); ctx.lineTo(s * 0.74, s * 0.55)
      ctx.stroke()
      break
    case 'martini':
      ctx.beginPath()
      ctx.moveTo(-s * 0.78, -s * 0.72); ctx.lineTo(s * 0.78, -s * 0.72); ctx.lineTo(0, s * 0.1); ctx.closePath()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, s * 0.1); ctx.lineTo(0, s * 0.78)
      ctx.moveTo(-s * 0.44, s * 0.78); ctx.lineTo(s * 0.44, s * 0.78)
      ctx.stroke()
      break
    case 'bag':
      ctx.beginPath()
      ctx.roundRect(-s * 0.7, -s * 0.28, s * 1.4, s * 1.1, s * 0.16)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, -s * 0.3, s * 0.36, Math.PI, 0)
      ctx.stroke()
      break
    case 'pill':
      ctx.beginPath()
      ctx.moveTo(-s * 0.55, s * 0.55); ctx.lineTo(s * 0.55, -s * 0.55)
      ctx.lineWidth = Math.max(2.4, r * 0.34)
      ctx.stroke()
      break
    case 'dumbbell':
      ctx.beginPath()
      ctx.moveTo(-s * 0.72, 0); ctx.lineTo(s * 0.72, 0)
      ctx.moveTo(-s * 0.58, -s * 0.58); ctx.lineTo(-s * 0.58, s * 0.58)
      ctx.moveTo(s * 0.58, -s * 0.58); ctx.lineTo(s * 0.58, s * 0.58)
      ctx.stroke()
      break
    default:
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.44, 0, Math.PI * 2)
      ctx.fill()
      break
  }
  ctx.restore()
}
