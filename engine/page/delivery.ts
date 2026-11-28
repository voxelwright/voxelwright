// DoorSmash Food Delivery Game Engine for San Francisco:
// - Real SF orders from places.json + map.bin (restaurants, pizzerias, cafes, supermarkets)
// - Multi-order stacking & min-maxing with Apple/Google Maps–style reorderable multi-stop GPS
// - Obnoxious restaurants (order delays + waiting NPC courier lines) & supermarket aisle checklists
// - Obnoxious customers (live chat follow-up asks, ignore option, Eat Food, and send 🖕)
// - Death Stranding–style cargo bay physics (vertical pizza ruins, unsealed soup spills & ruins neighbors,
//   heavy-on-fragile crushing, collision damage by impact force & vehicle location)
// - Double-parking style bonus when an open curb spot is nearby + automatic hazard flashers
// - Flat pay + time/condition/responsiveness/style bonuses + upfront/post tips + Stars & Death Stranding Likes
// - Hangout spots with clusters of NPC delivery guys & parked scooters/mopeds
// - Garage: Electric Scooter, Moped, Prius Hybrid, Turbo Hatch + visual & practical upgrades
import { CargoBay, type CargoImpactReport, type CargoItem, type FoodItemKind } from './delivery-cargo.ts'
import { playDeliverySfx, type DeliverySfx } from './delivery-sound.ts'
import {
  buildDeliveryVehicle,
  DELIVERY_LIGHTING,
  DELIVERY_PAINTS,
  DELIVERY_VEHICLES,
  defaultUpgrades,
  emitDeliveryVehicleLights,
  getLightingDef,
  getPaintDef,
  getVehicleDef,
  PRACTICAL_UPGRADES,
  type DeliveryVehicleId,
  type LightingId,
  type PaintId,
  type VehicleUpgrades,
} from './delivery-vehicles.ts'
import { faces as facesOf } from './fine.ts'
import { snapToRoad, type GpsStop } from './gps.ts'
import type { Hud } from './hud.ts'
import {
  isSupermarketCategory,
  type ActiveShoppingTask,
  type InteriorSystem,
  type StorePlaceMeta,
} from './interiors.ts'
import type { Living, Thing } from './living.ts'
import { LIGHT_EXTRA, type LocalLightSink } from './lights.ts'
import type { View } from './march.ts'
import type { MapSystem, MapWaypoint } from './minimap.ts'
import { NAMED } from './moves.ts'
import type { PlacesPayload, RawShop } from './neighborhood.ts'
import type { Person } from './people.ts'
import type { PhoneNotification, PhoneOS } from './phone.ts'
import type { Piece, Pieces } from './pieces.ts'
import type { Sound } from './sound/sound.ts'
import type { Street } from './street.ts'
import type { Born } from './told.ts'

const M = 10 // 10 world cells per metre
const STORAGE_KEY = 'vw.doorsmash.v1'
const MAX_ACTIVE_ORDERS = 4
const MAX_OFFERS = 4
const FOOD_CATEGORIES = new Set([
  'pizza', 'burger', 'coffee', 'bakery', 'restaurant', 'ice_cream', 'bar',
  'supermarket', 'grocery', 'corner_store', 'market',
])

export type CustomerPersonality = 'chill' | 'generous' | 'obnoxious' | 'picky' | 'hangry' | 'techbro'
export type RestaurantPersonality = 'fast' | 'busy' | 'obnoxious'
export type OrderStatus = 'offered' | 'accepted' | 'shopping' | 'waiting_delay' | 'in_transit' | 'delivered' | 'cancelled'
export type ShiftFocus = 'citywide' | 'restaurants' | 'supermarkets'

export interface ShiftState {
  active: boolean
  focus: ShiftFocus
  startedAt: number
  endedAt: number
  completed: number
  earnings: number
  likes: number
}

export interface ShiftSummary {
  focus: ShiftFocus
  durationS: number
  completed: number
  earnings: number
  likes: number
  endedAt: number
}

export interface ChatMessage {
  id: string
  from: 'customer' | 'driver' | 'system'
  text: string
  atMs: number
}

export interface ShoppingItem {
  id: string
  name: string
  price: number
  aisleNumber: number
  aisleName: string
  category: 'produce' | 'bakery' | 'dairy' | 'pantry' | 'snacks'
  collected: boolean
  heavy?: boolean
  fragile?: boolean
}

export interface DeliveryOrder {
  id: string
  code: string
  status: OrderStatus
  isSupermarket: boolean
  store: StorePlaceMeta
  restaurantTrait: RestaurantPersonality
  /** Delay seconds triggered at obnoxious/busy restaurants upon arrival. */
  delaySeconds: number
  delayRemaining: number
  delayExtensions: number
  delayReason: string
  customerName: string
  customerTrait: CustomerPersonality
  dropoff: {
    x: number
    z: number
    address: string
    seed: number
    roadNx?: number
    roadNz?: number
    curbVerified?: boolean
  }
  /** Template cargo items generated for this order. */
  itemSpecs: {
    name: string
    emoji: string
    kind: FoodItemKind
    baseW: number
    baseH: number
    weight: number
    fragile: boolean
    isLiquid: boolean
    hot: boolean
    cold: boolean
  }[]
  /** Supermarket shopping checklist (populated for supermarket/grocery orders). */
  shoppingList: ShoppingItem[]
  distanceM: number
  basePay: number
  upfrontTip: number
  tipMode: 'upfront' | 'after' | 'both'
  etaSeconds: number
  acceptedAt: number
  pickedUpAt: number
  deadlineAt: number
  offerExpiresAt: number
  /** Customer chat log. */
  chat: ChatMessage[]
  unreadChat: number
  followUpSent: boolean
  followUpText: string
  followUpAskedAt: number
  repliedCount: number
  ignoredFollowUp: boolean
  middleFingerSent: boolean
  ateCustomerFood: boolean
  doubleParkedPickup: boolean
  doubleParkedDropoff: boolean
  stylePoints: number
  styleNotes: string[]
}

export interface DeliveryReceipt {
  orderId: string
  storeName: string
  customerName: string
  basePay: number
  timeBonus: number
  conditionBonus: number
  responsivenessBonus: number
  styleBonus: number
  tip: number
  totalPay: number
  starsEarned: number
  likesEarned: number
  score: number // 0..100
  review: string
  flags: string[]
  atMs: number
}

export interface HangoutSpot {
  id: string
  name: string
  neighborhood: string
  x: number
  z: number
  hotTip: string
  surgeCategory: string
  driverCount: number
  seed: number
}

export interface DriverProfile {
  cash: number
  stars: number
  ratingCount: number
  likes: number
  completed: number
  doubleParks: number
  eatenCount: number
  middleFingersSent: number
  ownedVehicles: DeliveryVehicleId[]
  activeVehicle: DeliveryVehicleId
  upgrades: Record<DeliveryVehicleId, VehicleUpgrades>
  recentReceipts: DeliveryReceipt[]
}

export interface DeliveryLand {
  ground_at(x: number, z: number): number
  feet_at(x: number, z: number): number
  top_at(x: number, z: number): number
  world_kind(x: number, y: number, z: number): number
}

export interface DeliveryEngineOptions {
  land: DeliveryLand
  alive: Living
  hud: Hud
  pieces: Pieces
  phone: PhoneOS
  interiors: InteriorSystem
  map: () => MapSystem | null
  street: () => Street | null
  places: () => PlacesPayload | null
  player: () => { x: number; y: number; z: number; yaw: number; driving: boolean; onFoot: boolean }
  engaged: () => boolean
  sound: () => Sound | null
  hour: () => number
  /** Optional hook to bake vehicle smooth faces off-thread. */
  onVehiclePrebake?: (kinds: Uint16Array, size: [number, number, number]) => void
}

export interface DeliveryController {
  readonly profile: DriverProfile
  readonly rank: string
  readonly onShift: boolean
  readonly shift: Readonly<ShiftState>
  readonly lastShiftSummary: ShiftSummary | null
  readonly offers: readonly DeliveryOrder[]
  readonly activeOrders: readonly DeliveryOrder[]
  readonly routeStops: readonly GpsStop[]
  readonly cargo: CargoBay
  readonly hangouts: readonly HangoutSpot[]
  readonly interiors: InteriorSystem
  readonly phone: PhoneOS
  readonly activeVehicleThing: Thing | null
  readonly doubleParked: boolean
  readonly nearbyStore: StorePlaceMeta | null
  readonly lastReceipt: DeliveryReceipt | null
  subscribe(listener: () => void): () => void
  /** Signs up / clocks into a DoorSmash delivery shift so incoming offers & phone notifications turn on. */
  startShift(opts?: { focus?: ShiftFocus }): boolean
  /** Signs off the active shift, clearing pending offers and silencing DoorSmash notifications. */
  endShift(): ShiftSummary | null
  /** Generates a fresh offer near the player (useful for surge boost & tests). */
  generateOffer(opts?: { supermarket?: boolean; obnoxious?: boolean; pizza?: boolean; soup?: boolean }): DeliveryOrder
  acceptOffer(orderId: string): boolean
  declineOffer(orderId: string): void
  cancelOrder(orderId: string): void
  reorderStop(fromIndex: number, toIndex: number): boolean
  /** Enters the closest food/grocery store (or the specified store) into its modular 3D interior. */
  enterStore(place?: StorePlaceMeta): boolean
  /** Picks up a ready restaurant order (or finishes supermarket checkout) and loads items into CargoBay. */
  collectOrder(orderId: string): boolean
  /** Auto-buys a supermarket checklist item (called when pressing E at the aisle shelf). */
  collectShoppingItem(orderId: string, itemId: string): boolean
  /** Completes delivery at the customer drop-off and computes full payout, tip, stars & Likes! */
  deliverOrder(orderId: string): DeliveryReceipt | null
  replyToOrder(orderId: string, text: string): boolean
  sendMiddleFinger(orderId: string): boolean
  eatCargoItem(itemId: string): boolean
  sealCargoItem(itemId: string): boolean
  rotateCargoItem(itemId: string): boolean
  moveCargoItem(itemId: string, x: number, y: number): boolean
  /** Buys or equips a vehicle from the DoorSmash garage. */
  selectOrBuyVehicle(id: DeliveryVehicleId): { ok: boolean; message: string }
  buyPaint(paint: PaintId): { ok: boolean; message: string }
  buyLighting(lighting: LightingId): { ok: boolean; message: string }
  buyUpgrade(kind: keyof typeof PRACTICAL_UPGRADES): { ok: boolean; message: string }
  /** Summons the player's customized active delivery vehicle cleanly to the nearest street curb. */
  spawnActiveVehicle(): Promise<Thing | null>
  /** Evaluates parking style near a stop (awards double-park bonus + activates hazard lights!). */
  checkParkingStyle(forceDoublePark?: boolean): { doubleParked: boolean; bonus: number }
  /** Interacts with a nearby delivery driver hangout spot (Death Stranding Likes + surge tip). */
  interactHangout(spotId?: string): { likes: number; tip: string } | null
  frame(dt: number, seconds: number): void
  lights(sink: LocalLightSink, seconds: number): void
  folk(view: View, seconds: number): readonly Person[]
  resetProgress(): void
}

// ── Curated Names, Dialogue & Hangout Data ──────────────────────────────────

const CUSTOMER_NAMES = [
  'Maya K.', 'Devon R.', 'Chloe T.', 'Brandon S.', 'Priya N.', 'Kyle M.', 'Sofia G.',
  'Marcus L.', 'Tiffany W.', 'Raj P.', 'Elena V.', 'Trevor B.', 'Hana C.', 'Liam D.',
]

const OBNOXIOUS_FOLLOWUPS = [
  'WAIT!! Ask them for 14 packets of spicy mayo and NO ice in my drink!!',
  'Do NOT ring the bell my dog has a podcast. Knock twice then whisper "DoorSmash".',
  'Actually deliver to the side alley gate code #4921, NOT the front door!!',
  'Why did your dot stop moving for 4 seconds?! Is my food getting cold??',
  'Can you swing by the corner store and grab me oat milk? I\'ll totally tip in the app',
  'Leave it on the third step from the left, NOT the doormat, thankssss',
]

const CHILL_FOLLOWUPS = [
  'No rush at all! Front porch is fine, appreciate you 🙏',
  'Gate is unlocked, thanks so much for delivering in SF traffic!',
  'Heads up parking is tight on my block, feel free to double park 👍',
]

const DELAY_EXCUSES = [
  'Just 2 more minutes, bro.',
  'Kitchen is bagging it right now...',
  'Oh wait, we didn\'t start the fries yet.',
  'Tablet was offline — putting it in now!',
  'Chef is plating it, hang tight 3 mins.',
]

const HANGOUT_TIPS = [
  'North Beach pizzerias are surging right now — huge upfront tips!',
  'Avoid parking near Union Square — double park with hazards on!',
  'Whole Moods Market orders pay big if you know Aisles 1–4 by heart.',
  'Seal every ramen lid before hitting California St hills — learned the hard way.',
  'Never stack a pizza vertically in a scooter basket. Instant 1-star.',
  'Prius + Gimbal Liquid Mount prints money on dinner peak stacks!',
]

/** Default SF Hangout Hubs near iconic restaurant corridors (world metres, matching bay/places.json frame). */
const DEFAULT_SF_HANGOUTS: readonly HangoutSpot[] = [
  { id: 'hang-north-beach', name: 'Columbus Ave Courier Corner', neighborhood: 'North Beach', x: 51920, z: 66090, hotTip: HANGOUT_TIPS[0], surgeCategory: 'pizza', driverCount: 4, seed: 4101 },
  { id: 'hang-union-sq', name: 'Powell & Geary Wait Line', neighborhood: 'Union Square', x: 52040, z: 67210, hotTip: HANGOUT_TIPS[1], surgeCategory: 'coffee', driverCount: 5, seed: 4102 },
  { id: 'hang-mission', name: 'Valencia St Moped Row', neighborhood: 'Mission', x: 51260, z: 69480, hotTip: HANGOUT_TIPS[3], surgeCategory: 'restaurant', driverCount: 5, seed: 4103 },
  { id: 'hang-hayes', name: 'Hayes Valley Scooter Hub', neighborhood: 'Hayes Valley', x: 51060, z: 67980, hotTip: HANGOUT_TIPS[2], surgeCategory: 'supermarket', driverCount: 4, seed: 4104 },
  { id: 'hang-marina', name: 'Chestnut St Courier Spot', neighborhood: 'Marina', x: 50020, z: 65640, hotTip: HANGOUT_TIPS[4], surgeCategory: 'burger', driverCount: 3, seed: 4105 },
  { id: 'hang-fidi', name: 'Market & Battery Lunch Stand', neighborhood: 'Financial District', x: 52890, z: 66890, hotTip: HANGOUT_TIPS[5], surgeCategory: 'restaurant', driverCount: 4, seed: 4106 },
]

function hashStr(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function defaultProfile(): DriverProfile {
  return {
    cash: 75,
    stars: 4.85,
    ratingCount: 6,
    likes: 18,
    completed: 0,
    doubleParks: 0,
    eatenCount: 0,
    middleFingersSent: 0,
    ownedVehicles: ['scooter'],
    activeVehicle: 'scooter',
    upgrades: {
      scooter: defaultUpgrades(),
      moped: defaultUpgrades(),
      prius: defaultUpgrades(),
      turbo: defaultUpgrades(),
    },
    recentReceipts: [],
  }
}

function loadProfile(): DriverProfile {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!raw) return defaultProfile()
    const p = JSON.parse(raw) as Partial<DriverProfile>
    const base = defaultProfile()
    return {
      ...base,
      ...p,
      ownedVehicles: Array.isArray(p.ownedVehicles) && p.ownedVehicles.length ? p.ownedVehicles : base.ownedVehicles,
      activeVehicle: p.activeVehicle && DELIVERY_VEHICLES.some((v) => v.id === p.activeVehicle) ? p.activeVehicle : 'scooter',
      upgrades: {
        scooter: { ...defaultUpgrades(), ...p.upgrades?.scooter },
        moped: { ...defaultUpgrades(), ...p.upgrades?.moped },
        prius: { ...defaultUpgrades(), ...p.upgrades?.prius },
        turbo: { ...defaultUpgrades(), ...p.upgrades?.turbo },
      },
      recentReceipts: Array.isArray(p.recentReceipts) ? p.recentReceipts.slice(0, 12) : [],
    }
  } catch {
    return defaultProfile()
  }
}

function saveProfile(p: DriverProfile): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch { /* quota / private mode */ }
}

export function driverRankFor(likes: number, completed: number): string {
  const score = likes + completed * 25
  if (score >= 1200) return 'Great Deliverer (S+)'
  if (score >= 600) return 'Mission Legend (S)'
  if (score >= 280) return 'Bay Area Courier (A)'
  if (score >= 90) return 'Curbside Hustler (B)'
  return 'Rookie Runner (C)'
}

/** Tiny 3D parked moped prop for hangout spots & restaurant driver lines. */
let cachedPropMoped: Born | null = null
let cachedBeacon: Born | null = null

function parkedMopedBorn(): Born {
  if (cachedPropMoped) return cachedPropMoped
  const W = 20, H = 13, D = 8
  const cells = new Uint16Array(W * H * D)
  const set = (x: number, y: number, z: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D) cells[x + W * (z + D * y)] = v
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) set(x, y, z, v)
  }
  const body = 12 | ((16 + 0 * 10 + 4) << 8)
  const dark = 14 | (14 << 8)
  const boxRed = 9 | ((16 + 0 * 10 + 4) << 8)
  const lamp = 15 | (1 << 8)
  box(3, 6, 0, 4, 3, 5, dark)
  box(14, 17, 0, 4, 3, 5, dark)
  box(4, 16, 2, 4, 2, 6, dark)
  box(4, 10, 4, 8, 2, 6, body)
  box(13, 16, 4, 10, 2, 6, body)
  box(14, 16, 9, 11, 1, 7, dark)
  box(16, 17, 8, 10, 3, 5, lamp)
  // Rear delivery thermal top-box
  box(1, 6, 7, 12, 1, 7, boxRed)
  let filled = 0
  for (let i = 0; i < cells.length; i++) if (cells[i]) filled++
  cachedPropMoped = { id: 0, cells: filled, size: [W, H, D], com: [W / 2, 0, D / 2], low: [0, 0, 0], faces: facesOf(cells, [W, H, D]) }
  return cachedPropMoped
}

function dropoffBeaconBorn(): Born {
  if (cachedBeacon) return cachedBeacon
  const W = 6, H = 36, D = 6
  const cells = new Uint16Array(W * H * D)
  const emerald = 15 | ((16 + 9 * 10 + 3) << 8)
  for (let y = 0; y < H; y++) {
    for (let z = 2; z < 4; z++) for (let x = 2; x < 4; x++) cells[x + W * (z + D * y)] = emerald
  }
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) cells[x + W * (z + D * 0)] = emerald
  let filled = 0
  for (let i = 0; i < cells.length; i++) if (cells[i]) filled++
  cachedBeacon = { id: 0, cells: filled, size: [W, H, D], com: [W / 2, 0, D / 2], low: [0, 0, 0], faces: facesOf(cells, [W, H, D]) }
  return cachedBeacon
}

// Materials that must NEVER be chosen as a customer drop-off spot: air/unloaded (0), water (5), asphalt road (6), steel rails/bridges (12), building roofs (14).
const NON_SIDEWALK_MATS = new Set([0, 5, 6, 12, 14])

/** True when (xM, zM) sits on walkable non-road ground (sidewalk/plaza/yard) with clear headroom and street-level grade. */
export function isSidewalkGround(land: DeliveryLand, xM: number, zM: number, refY?: number): boolean {
  const cx = Math.round(xM * M)
  const cz = Math.round(zM * M)
  const mat = land.top_at(cx, cz) & 15
  if (NON_SIDEWALK_MATS.has(mat)) return false
  const g = land.ground_at(cx, cz)
  if (!Number.isFinite(g) || g <= -200 || g > 5000) return false
  const f = land.feet_at(cx, cz)
  if (f - g > 20) return false
  if (refY !== undefined && Math.abs(g - refY) > 35) return false
  for (const dy of [4, 10, 16]) {
    const wk = land.world_kind(cx, g + dy, cz) & 15
    if (wk !== 0 && wk !== 13) return false
  }
  return true
}

function hasCurbBuffer(land: DeliveryLand, xM: number, zM: number, bufM = 0.6): boolean {
  for (const [dx, dz] of [[bufM, 0], [-bufM, 0], [0, bufM], [0, -bufM]]) {
    const m = land.top_at(Math.round((xM + dx) * M), Math.round((zM + dz) * M)) & 15
    if (m === 6 || m === 12 || m === 5) return false
  }
  return true
}

/**
 * Resolves a customer drop-off point off the asphalt carriageway onto a verified walkable sidewalk/curb.
 * Returns null if the underlying terrain tile is not loaded yet so the caller can retry once streamed.
 */
export function findSidewalkDropoff(
  land: DeliveryLand,
  xM: number,
  zM: number,
  perpX = 1,
  perpZ = 0,
): { x: number; z: number; snapped: boolean } | null {
  const cx = Math.round(xM * M)
  const cz = Math.round(zM * M)
  const g0 = land.ground_at(cx, cz)
  const m0 = land.top_at(cx, cz) & 15
  if (!Number.isFinite(g0) || g0 <= -200 || (g0 === 0 && m0 === 0)) return null

  const refY = g0
  if (isSidewalkGround(land, xM, zM, refY) && hasCurbBuffer(land, xM, zM, 0.5)) {
    return { x: Math.round(xM * 10) / 10, z: Math.round(zM * 10) / 10, snapped: false }
  }

  const pLen = Math.hypot(perpX, perpZ)
  const nx = pLen > 1e-4 ? perpX / pLen : 1
  const nz = pLen > 1e-4 ? perpZ / pLen : 0
  const tx = -nz, tz = nx

  let fallbackX: number | null = null
  let fallbackZ: number | null = null
  const tryPoint = (px: number, pz: number, stepDirX = 0, stepDirZ = 0): { x: number; z: number; snapped: boolean } | null => {
    if (!isSidewalkGround(land, px, pz, refY)) return null
    if (fallbackX === null) { fallbackX = px; fallbackZ = pz }
    if (hasCurbBuffer(land, px, pz, 0.6)) {
      // Step slightly deeper onto the sidewalk if still clear so customer stands comfortably off the curb lip
      const deeperX = px + stepDirX * 0.6
      const deeperZ = pz + stepDirZ * 0.6
      if ((stepDirX || stepDirZ) && isSidewalkGround(land, deeperX, deeperZ, refY) && hasCurbBuffer(land, deeperX, deeperZ, 0.6)) {
        return { x: Math.round(deeperX * 10) / 10, z: Math.round(deeperZ * 10) / 10, snapped: true }
      }
      return { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10, snapped: true }
    }
    return null
  }

  // 1. Step laterally away from the road centerline along perpendicular (with small along-street offsets if a driveway/pole blocks)
  for (const along of [0, 3.0, -3.0, 6.0, -6.0]) {
    for (let dist = 0.8; dist <= 16.0; dist += 0.6) {
      for (const side of [1, -1]) {
        const hit = tryPoint(xM + tx * along + nx * side * dist, zM + tz * along + nz * side * dist, nx * side, nz * side)
        if (hit) return hit
      }
    }
  }

  // 2. Radial fallback search up to 22 m for wide avenues / plazas / intersections
  for (let rad = 1.2; rad <= 22.0; rad += 1.0) {
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI * 2) / 16
      const dx = Math.cos(ang), dz = Math.sin(ang)
      const hit = tryPoint(xM + dx * rad, zM + dz * rad, dx, dz)
      if (hit) return hit
    }
  }

  if (fallbackX !== null && fallbackZ !== null) {
    return { x: Math.round(fallbackX * 10) / 10, z: Math.round(fallbackZ * 10) / 10, snapped: true }
  }
  return { x: Math.round(xM * 10) / 10, z: Math.round(zM * 10) / 10, snapped: false }
}

const MARKET_CATALOG: Record<ShoppingItem['category'], readonly { name: string; price: number; aisleNumber: number; aisleName: string; heavy?: boolean; fragile?: boolean }[]> = {
  produce: [
    { name: 'Organic Avocados', price: 5, aisleNumber: 1, aisleName: 'PRODUCE' },
    { name: 'Honeycrisp Apples', price: 4, aisleNumber: 1, aisleName: 'PRODUCE' },
    { name: 'Heirloom Tomatoes', price: 5, aisleNumber: 1, aisleName: 'PRODUCE' },
    { name: 'Baby Spinach Box', price: 4, aisleNumber: 1, aisleName: 'PRODUCE' },
  ],
  bakery: [
    { name: 'SF Sourdough Loaf', price: 7, aisleNumber: 2, aisleName: 'BAKERY', fragile: true },
    { name: 'Almond Croissants', price: 6, aisleNumber: 2, aisleName: 'BAKERY', fragile: true },
    { name: 'Everything Bagels', price: 5, aisleNumber: 2, aisleName: 'BAKERY' },
    { name: 'Blueberry Muffins', price: 6, aisleNumber: 2, aisleName: 'BAKERY', fragile: true },
  ],
  pantry: [
    { name: 'Colonel Crunch Cereal', price: 6, aisleNumber: 3, aisleName: 'CEREAL & PANTRY' },
    { name: 'Spicy Ramen 4-Pack', price: 8, aisleNumber: 3, aisleName: 'CEREAL & PANTRY' },
    { name: 'Olive Oil Bottle', price: 11, aisleNumber: 3, aisleName: 'CEREAL & PANTRY', fragile: true },
    { name: 'Espresso Roast Beans', price: 12, aisleNumber: 3, aisleName: 'CEREAL & PANTRY' },
  ],
  snacks: [
    { name: 'Kettle Chips Bag', price: 4, aisleNumber: 4, aisleName: 'SNACKS & DRINKS' },
    { name: 'Sparkling Water 12-Pack', price: 9, aisleNumber: 4, aisleName: 'SNACKS & DRINKS', heavy: true },
    { name: 'Dark Chocolate Bar', price: 5, aisleNumber: 4, aisleName: 'SNACKS & DRINKS' },
    { name: 'Crispy Tortilla Chips', price: 5, aisleNumber: 4, aisleName: 'SNACKS & DRINKS' },
  ],
  dairy: [
    { name: 'Pasture Eggs (Fragile)', price: 7, aisleNumber: 5, aisleName: 'DAIRY & COLD', fragile: true },
    { name: 'Oat Milk Half-Gal', price: 5, aisleNumber: 5, aisleName: 'DAIRY & COLD' },
    { name: 'Greek Yogurt Cup', price: 6, aisleNumber: 5, aisleName: 'DAIRY & COLD' },
    { name: 'Aged Cheddar Block', price: 8, aisleNumber: 5, aisleName: 'DAIRY & COLD' },
  ],
}

function buildMenuSpecs(category: string, rng: () => number, forceOpts?: { pizza?: boolean; soup?: boolean; supermarket?: boolean }): {
  items: DeliveryOrder['itemSpecs']
  shoppingList: ShoppingItem[]
} {
  if (forceOpts?.supermarket || isSupermarketCategory(category)) {
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]
    const chosen: { cat: ShoppingItem['category']; spec: (typeof MARKET_CATALOG)['produce'][number] }[] = [
      { cat: 'produce', spec: pick(MARKET_CATALOG.produce) },
      { cat: 'bakery', spec: pick(MARKET_CATALOG.bakery) },
      { cat: 'pantry', spec: pick(MARKET_CATALOG.pantry) },
      { cat: 'dairy', spec: pick(MARKET_CATALOG.dairy) },
    ]
    if (rng() > 0.45) {
      chosen[2] = { cat: 'snacks', spec: pick(MARKET_CATALOG.snacks) }
    }
    const shoppingList: ShoppingItem[] = chosen.map((c, idx) => ({
      id: `sh-${idx + 1}`,
      name: c.spec.name,
      price: c.spec.price,
      aisleNumber: c.spec.aisleNumber,
      aisleName: c.spec.aisleName,
      category: c.cat,
      collected: false,
      heavy: c.spec.heavy,
      fragile: c.spec.fragile,
    }))
    return {
      shoppingList,
      items: [
        { name: `${shoppingList[2].name} & Pantry Bag`, emoji: '🛒', kind: 'groceries_heavy', baseW: 2, baseH: 1, weight: 5, fragile: false, isLiquid: false, hot: false, cold: false },
        { name: `${shoppingList[3].name}, ${shoppingList[1].name}`, emoji: '🥚', kind: 'groceries_fragile', baseW: 1, baseH: 1, weight: 1, fragile: true, isLiquid: false, hot: false, cold: true },
      ],
    }
  }
  if (forceOpts?.pizza || category === 'pizza') {
    const out: DeliveryOrder['itemSpecs'] = [
      { name: 'XL Pepperoni Pizza', emoji: '🍕', kind: 'pizza', baseW: 2, baseH: 1, weight: 2, fragile: true, isLiquid: false, hot: true, cold: false },
    ]
    if (forceOpts?.soup || rng() > 0.45) {
      out.push({ name: 'Hot Marinara Soup Cup', emoji: '🍲', kind: 'soup', baseW: 1, baseH: 1, weight: 2, fragile: false, isLiquid: true, hot: true, cold: false })
    }
    return { items: out, shoppingList: [] }
  }
  if (forceOpts?.soup) {
    return {
      items: [
        { name: 'Spicy Tonkotsu Ramen', emoji: '🍜', kind: 'soup', baseW: 1, baseH: 1, weight: 2, fragile: false, isLiquid: true, hot: true, cold: false },
        { name: 'Crispy Gyoza Box', emoji: '🥟', kind: 'tacos', baseW: 1, baseH: 1, weight: 1, fragile: true, isLiquid: false, hot: true, cold: false },
      ],
      shoppingList: [],
    }
  }
  if (category === 'coffee' || category === 'bakery') {
    return {
      items: [
        { name: 'Hot Oat Latte', emoji: '☕', kind: 'drink', baseW: 1, baseH: 1, weight: 1, fragile: false, isLiquid: true, hot: true, cold: false },
        { name: 'Almond Croissant Box', emoji: '🥐', kind: 'pastry', baseW: 1, baseH: 1, weight: 1, fragile: true, isLiquid: false, hot: false, cold: false },
      ],
      shoppingList: [],
    }
  }
  if (category === 'burger') {
    return {
      items: [
        { name: 'Double Smashburger Combo', emoji: '🍔', kind: 'burger', baseW: 1, baseH: 1, weight: 2, fragile: false, isLiquid: false, hot: true, cold: false },
        { name: 'Vanilla Milkshake', emoji: '🥤', kind: 'drink', baseW: 1, baseH: 1, weight: 1, fragile: false, isLiquid: true, hot: false, cold: true },
      ],
      shoppingList: [],
    }
  }
  if (category === 'ice_cream') {
    return {
      items: [
        { name: 'Artisan Gelato Pint', emoji: '🍨', kind: 'ice_cream', baseW: 1, baseH: 1, weight: 1, fragile: true, isLiquid: false, hot: false, cold: true },
      ],
      shoppingList: [],
    }
  }
  // Restaurant / Ramen / Sushi / Tacos mix
  const roll = rng()
  if (roll < 0.35) {
    return {
      items: [
        { name: 'Spicy Tonkotsu Ramen', emoji: '🍜', kind: 'soup', baseW: 1, baseH: 1, weight: 2, fragile: false, isLiquid: true, hot: true, cold: false },
        { name: 'Karaage Chicken Bowl', emoji: '🍗', kind: 'burger', baseW: 1, baseH: 1, weight: 2, fragile: false, isLiquid: false, hot: true, cold: false },
      ],
      shoppingList: [],
    }
  }
  if (roll < 0.68) {
    return {
      items: [
        { name: 'Super Carne Asada Burrito', emoji: '🌯', kind: 'tacos', baseW: 1, baseH: 1, weight: 2, fragile: false, isLiquid: false, hot: true, cold: false },
        { name: 'Horchata Cup', emoji: '🥤', kind: 'drink', baseW: 1, baseH: 1, weight: 1, fragile: false, isLiquid: true, hot: false, cold: true },
      ],
      shoppingList: [],
    }
  }
  return {
    items: [
      { name: 'Omakase Sushi Platter', emoji: '🍣', kind: 'sushi', baseW: 2, baseH: 1, weight: 1, fragile: true, isLiquid: false, hot: false, cold: true },
      { name: 'Miso Soup Cup', emoji: '🍲', kind: 'soup', baseW: 1, baseH: 1, weight: 1, fragile: false, isLiquid: true, hot: true, cold: false },
    ],
    shoppingList: [],
  }
}

export function createDeliveryEngine(opts: DeliveryEngineOptions): DeliveryController {
  let profile = loadProfile()
  const cargo = new CargoBay(profile.activeVehicle, profile.upgrades[profile.activeVehicle])
  const listeners = new Set<() => void>()
  let shift: ShiftState = { active: false, focus: 'citywide', startedAt: 0, endedAt: 0, completed: 0, earnings: 0, likes: 0 }
  let lastShiftSummary: ShiftSummary | null = null

  const emit = () => {
    opts.phone.setStatusChip(shift.active ? `● $${profile.cash.toFixed(0)}` : `$${profile.cash.toFixed(0)}`)
    for (const fn of listeners) fn()
  }

  /** DoorSmash notifications ONLY fire while the driver is signed into an active shift. */
  const notifyDriver = (n: PhoneNotification) => {
    if (!shift.active || !opts.engaged()) return
    opts.phone.notify(n)
  }

  let offers: DeliveryOrder[] = []
  let activeOrders: DeliveryOrder[] = []
  let routeStops: GpsStop[] = []
  let lastReceipt: DeliveryReceipt | null = null
  let orderSeq = 1
  let offerSpawnTimer = 2.0
  let activeVehicleThing: Thing | null = null
  let doubleParked = false
  let wasRiding = false
  let lastStruckLen = 0
  let lastImpactAt = 0
  let nearbyStore: StorePlaceMeta | null = null

  // World cues & 3D beacons/props
  let worldCue: { key: string; remove(): void; act(): void } | null = null
  const beaconPieces = new Map<string, Piece>()
  const hangoutPieces = new Map<string, Piece[]>()
  const folkBuf: Person[] = []

  // Local deterministic-friendly RNG
  let rngState = 0x2f6e2b1 ^ (Date.now() & 0xffff)
  const rand = () => {
    let s = rngState
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    rngState = s
    return (s >>> 0) / 4294967296
  }

  const sfx = (k: DeliverySfx) => playDeliverySfx(opts.sound(), k)

  // Build hangout list (real SF hubs + guaranteed local hangout when playing in procedural /city!)
  const hangouts: HangoutSpot[] = DEFAULT_SF_HANGOUTS.map((h) => ({ ...h }))
  let cityHangoutEnsured = false
  const ensureLocalHangout = () => {
    if (cityHangoutEnsured) return
    const p = opts.player()
    const nearest = hangouts.reduce((best, h) => Math.min(best, Math.hypot(h.x - p.x, h.z - p.z)), Infinity)
    if (nearest > 2500) {
      hangouts.push({
        id: 'hang-local-hub',
        name: 'Downtown Courier Corner',
        neighborhood: 'City Center',
        x: Math.round(p.x + 28),
        z: Math.round(p.z + 18),
        hotTip: HANGOUT_TIPS[0],
        surgeCategory: 'pizza',
        driverCount: 4,
        seed: 4199,
      })
    }
    cityHangoutEnsured = true
  }

  const rawShopToMeta = (s: RawShop, payload: PlacesPayload): StorePlaceMeta => {
    const st = payload.styles[s.s]
    return {
      id: `shop:${s.n}:${s.x.toFixed(1)},${s.z.toFixed(1)}`,
      name: s.fn || s.n,
      category: s.c,
      brandId: s.br ?? null,
      x: s.x,
      z: s.z,
      widthM: s.w,
      heightM: s.h,
      address: s.a,
      style: st ? { bg: st[0], ink: st[1], accent: st[2], trim: st[3], font: st[4], glow: !!st[5] } : undefined,
    }
  }

  const fallbackStoresNear = (px: number, pz: number): StorePlaceMeta[] => [
    { id: 'syn-pizza', name: 'Tony\'s North Beach Slice', category: 'pizza', brandId: 'dominos', x: px + 65, z: pz - 55, widthM: 9.5, heightM: 9, address: '1540 Stockton St' },
    { id: 'syn-market', name: 'Whole Moods Market', category: 'supermarket', brandId: 'whole-foods', x: px - 85, z: pz - 40, widthM: 15, heightM: 12, address: '2001 Market St' },
    { id: 'syn-ramen', name: 'Fog City Ramen House', category: 'restaurant', brandId: null, x: px + 45, z: pz + 85, widthM: 8.5, heightM: 10, address: '712 Columbus Ave' },
    { id: 'syn-burger', name: 'In-N-About Burger', category: 'burger', brandId: 'in-n-out', x: px - 60, z: pz + 95, widthM: 10.5, heightM: 8, address: '333 Jefferson St' },
    { id: 'syn-coffee', name: 'Starbuxx Coffee', category: 'coffee', brandId: 'starbucks', x: px + 95, z: pz + 20, widthM: 7.5, heightM: 9, address: '555 California St' },
  ]

  const pickStoreNear = (px: number, pz: number, wantSupermarket?: boolean, wantPizza?: boolean): StorePlaceMeta => {
    const payload = opts.places()
    if (payload?.shops.length) {
      const candidates: { shop: RawShop; d: number }[] = []
      for (const s of payload.shops) {
        if (!FOOD_CATEGORIES.has(s.c)) continue
        if (wantSupermarket === true && !isSupermarketCategory(s.c)) continue
        if (wantSupermarket === false && isSupermarketCategory(s.c)) continue
        if (wantPizza && s.c !== 'pizza') continue
        const d = Math.hypot(s.x - px, s.z - pz)
        if (d >= 45 && d <= 1150) candidates.push({ shop: s, d })
      }
      if (candidates.length) {
        candidates.sort((a, b) => a.d - b.d)
        const pool = candidates.slice(0, Math.min(28, candidates.length))
        const picked = pool[Math.floor(rand() * pool.length)]
        return rawShopToMeta(picked.shop, payload)
      }
    }
    const fb = fallbackStoresNear(px, pz)
    if (wantSupermarket) return fb[1]
    if (wantPizza) return fb[0]
    return fb[Math.floor(rand() * fb.length)]
  }

  const pickDropoffFrom = (sx: number, sz: number): DeliveryOrder['dropoff'] => {
    // 1. Prefer real building storefronts / entrances from SF places.json (stepped 1.4 m onto their front sidewalk!)
    const payload = opts.places()
    if (payload?.shops.length && rand() < 0.62) {
      const candidates: RawShop[] = []
      for (const s of payload.shops) {
        const d = Math.hypot(s.x - sx, s.z - sz)
        if (d >= 190 && d <= 760) candidates.push(s)
      }
      if (candidates.length) {
        const picked = candidates[Math.floor(rand() * candidates.length)]
        const nx = picked.nx || 1
        const nz = picked.nz || 0
        let tx = picked.x + nx * 1.45
        let tz = picked.z + nz * 1.45
        let curbVerified = false
        const verified = findSidewalkDropoff(opts.land, tx, tz, nx, nz)
        if (verified) {
          tx = verified.x
          tz = verified.z
          curbVerified = true
        }
        const streetName = picked.a || (opts.map()?.data ? snapToRoad(opts.map()!.data!, tx, tz, 80)?.street : '') || 'Columbus Ave'
        const address = /^\d/.test(streetName) ? streetName : `${100 + Math.floor(rand() * 2600)} ${streetName}`
        return {
          x: Math.round(tx * 10) / 10,
          z: Math.round(tz * 10) / 10,
          address,
          seed: Math.floor(rand() * 100_000),
          roadNx: nx,
          roadNz: nz,
          curbVerified,
        }
      }
    }

    // 2. Road-graph dropoff: snap to nearest street, then step OFF the road centerline onto the sidewalk!
    const angle = rand() * Math.PI * 2
    const dist = 210 + rand() * 580
    let tx = sx + Math.cos(angle) * dist
    let tz = sz + Math.sin(angle) * dist
    let address = `${100 + Math.floor(rand() * 2400)} Bay St`
    let roadNx = Math.cos(angle + Math.PI * 0.5)
    let roadNz = Math.sin(angle + Math.PI * 0.5)
    const mapData = opts.map()?.data
    if (mapData) {
      const snap = snapToRoad(mapData, tx, tz, 420)
      if (snap) {
        const ea = mapData.edgeA[snap.edge], eb = mapData.edgeB[snap.edge]
        const dx = mapData.nodes[eb * 2] - mapData.nodes[ea * 2]
        const dz = mapData.nodes[eb * 2 + 1] - mapData.nodes[ea * 2 + 1]
        const elen = Math.hypot(dx, dz) || 1
        const sign = rand() > 0.5 ? 1 : -1
        roadNx = (-dz / elen) * sign
        roadNz = (dx / elen) * sign
        const cls = (mapData.edgeFlags[snap.edge] >> 2) & 3
        // Offset laterally past the asphalt lanes onto the sidewalk (residential ~6 m, collector ~7.2 m, arterial ~8.8 m)
        const curbOffset = cls === 0 ? 6.0 : cls === 1 ? 7.2 : 8.8
        tx = snap.x + roadNx * curbOffset
        tz = snap.z + roadNz * curbOffset
        address = `${100 + Math.floor(rand() * 2800)} ${snap.street || 'Columbus Ave'}`
      }
    }
    let curbVerified = false
    const verified = findSidewalkDropoff(opts.land, tx, tz, roadNx, roadNz)
    if (verified) {
      tx = verified.x
      tz = verified.z
      curbVerified = true
    }
    return {
      x: Math.round(tx * 10) / 10,
      z: Math.round(tz * 10) / 10,
      address,
      seed: Math.floor(rand() * 100_000),
      roadNx,
      roadNz,
      curbVerified,
    }
  }

  const syncGpsFromStops = () => {
    const m = opts.map()
    if (!m) return
    if (!routeStops.length) {
      m.clearWaypoints()
      return
    }
    m.setWaypoints(routeStops, {
      onReorder: (next) => {
        routeStops = next.map((s) => ({ ...s }))
        emit()
      },
    })
  }

  const rebuildStopsForOrder = (order: DeliveryOrder) => {
    // Append pickup/shop stop then dropoff stop at the tail so user's existing stop order stays intact!
    const pickStop: GpsStop = {
      id: `stop:pick:${order.id}`,
      x: order.store.x,
      z: order.store.z,
      name: `${order.isSupermarket ? 'Shop' : 'Pickup'}: ${order.store.name}`,
      subtitle: order.store.address || (order.isSupermarket ? 'Supermarket Checklist' : 'Restaurant Counter'),
      kind: order.isSupermarket ? 'shop' : 'pickup',
      orderId: order.id,
      accent: order.isSupermarket ? '#38bdf8' : '#ff4d3d',
    }
    const dropStop: GpsStop = {
      id: `stop:drop:${order.id}`,
      x: order.dropoff.x,
      z: order.dropoff.z,
      name: `Deliver: ${order.customerName}`,
      subtitle: order.dropoff.address,
      kind: 'dropoff',
      orderId: order.id,
      accent: '#10b981',
    }
    routeStops.push(pickStop, dropStop)
    syncGpsFromStops()
  }

  const removeStopsForOrder = (orderId: string, kind?: 'pickup' | 'dropoff') => {
    routeStops = routeStops.filter((s) => {
      if (s.orderId !== orderId) return true
      if (!kind) return false
      if (kind === 'pickup') return s.kind !== 'pickup' && s.kind !== 'shop'
      return s.kind !== 'dropoff'
    })
    syncGpsFromStops()
  }

  const generateOffer = (gOpts?: { supermarket?: boolean; obnoxious?: boolean; pizza?: boolean; soup?: boolean }): DeliveryOrder => {
    const p = opts.player()
    const wantMarket = gOpts?.supermarket ?? (rand() < 0.24)
    const store = pickStoreNear(p.x, p.z, wantMarket, gOpts?.pizza)
    const dropoff = pickDropoffFrom(store.x, store.z)
    const distToStore = Math.hypot(store.x - p.x, store.z - p.z)
    const distTrip = Math.hypot(dropoff.x - store.x, dropoff.z - store.z)
    const totalDist = Math.round(distToStore + distTrip)
    const { items, shoppingList } = buildMenuSpecs(store.category, rand, gOpts)

    const traits: CustomerPersonality[] = ['chill', 'generous', 'obnoxious', 'picky', 'hangry', 'techbro']
    const customerTrait: CustomerPersonality = gOpts?.obnoxious ? 'obnoxious' : traits[Math.floor(rand() * traits.length)]
    const rRoll = rand()
    const restaurantTrait: RestaurantPersonality =
      gOpts?.obnoxious ? 'obnoxious' : (isSupermarketCategory(store.category) ? 'fast' : rRoll < 0.34 ? 'obnoxious' : rRoll < 0.65 ? 'busy' : 'fast')

    const tipMode: DeliveryOrder['tipMode'] =
      customerTrait === 'generous' ? 'both'
      : customerTrait === 'obnoxious' ? 'after'
      : rand() < 0.45 ? 'upfront' : 'after'
    const basePay = Math.round((4.5 + (totalDist / 1000) * 5.2 + (shoppingList.length ? 4.5 : 0)) * 100) / 100
    const upfrontTip = tipMode === 'upfront' || tipMode === 'both'
      ? Math.round((2 + rand() * (customerTrait === 'generous' ? 9 : 4.5)) * 100) / 100
      : 0

    const id = `ord-${orderSeq++}`
    const code = `#DS-${100 + ((orderSeq * 37) % 899)}`
    const customerName = CUSTOMER_NAMES[Math.floor(rand() * CUSTOMER_NAMES.length)]
    const delaySeconds = restaurantTrait === 'obnoxious' ? 14 : restaurantTrait === 'busy' ? 6 : 0
    const followUpText = (customerTrait === 'obnoxious' || customerTrait === 'picky' || customerTrait === 'hangry')
      ? OBNOXIOUS_FOLLOWUPS[Math.floor(rand() * OBNOXIOUS_FOLLOWUPS.length)]
      : CHILL_FOLLOWUPS[Math.floor(rand() * CHILL_FOLLOWUPS.length)]

    const now = performance.now()
    const etaSeconds = Math.max(75, Math.round(totalDist / 7.2 + (shoppingList.length ? 45 : 22) + delaySeconds))

    const order: DeliveryOrder = {
      id,
      code,
      status: 'offered',
      isSupermarket: shoppingList.length > 0,
      store,
      restaurantTrait,
      delaySeconds,
      delayRemaining: delaySeconds,
      delayExtensions: 0,
      delayReason: DELAY_EXCUSES[Math.floor(rand() * DELAY_EXCUSES.length)],
      customerName,
      customerTrait,
      dropoff,
      itemSpecs: items,
      shoppingList,
      distanceM: totalDist,
      basePay,
      upfrontTip,
      tipMode,
      etaSeconds,
      acceptedAt: 0,
      pickedUpAt: 0,
      deadlineAt: 0,
      offerExpiresAt: now + 55_000,
      chat: [],
      unreadChat: 0,
      followUpSent: false,
      followUpText,
      followUpAskedAt: 0,
      repliedCount: 0,
      ignoredFollowUp: false,
      middleFingerSent: false,
      ateCustomerFood: false,
      doubleParkedPickup: false,
      doubleParkedDropoff: false,
      stylePoints: 0,
      styleNotes: [],
    }
    offers = [order, ...offers].slice(0, MAX_OFFERS)
    notifyDriver({
      appId: 'doorsmash',
      title: `New ${order.isSupermarket ? 'Shop & Deliver' : 'Order'} · $${(order.basePay + order.upfrontTip).toFixed(2)}`,
      body: `${order.store.name} → ${order.dropoff.address}${order.upfrontTip > 0 ? ` (+$${order.upfrontTip.toFixed(0)} tip)` : ' (tip after)'}`,
      accent: order.isSupermarket ? '#38bdf8' : '#ff4d3d',
      sound: 'order',
    })
    emit()
    return order
  }

  const startShift = (sOpts?: { focus?: ShiftFocus }): boolean => {
    const focus = sOpts?.focus ?? shift.focus ?? 'citywide'
    if (shift.active) {
      if (shift.focus !== focus) { shift = { ...shift, focus }; emit() }
      return true
    }
    shift = {
      active: true,
      focus,
      startedAt: performance.now(),
      endedAt: 0,
      completed: 0,
      earnings: 0,
      likes: 0,
    }
    lastShiftSummary = null
    offerSpawnTimer = 6.0
    sfx('tap')
    opts.hud.notice('DoorSmash shift started — now receiving offers!', 3000)
    // Queue an initial offer right away so the driver has immediate work on clock-in
    const initOpts = focus === 'supermarkets' ? { supermarket: true } : focus === 'restaurants' ? { supermarket: false } : undefined
    generateOffer(initOpts)
    emit()
    return true
  }

  const endShift = (): ShiftSummary | null => {
    if (!shift.active) return null
    const now = performance.now()
    const summary: ShiftSummary = {
      focus: shift.focus,
      durationS: Math.max(1, Math.round((now - shift.startedAt) / 1000)),
      completed: shift.completed,
      earnings: Math.round(shift.earnings * 100) / 100,
      likes: shift.likes,
      endedAt: now,
    }
    shift = { ...shift, active: false, endedAt: now }
    lastShiftSummary = summary
    offers = []
    opts.phone.dismissNotification?.()
    sfx('tap')
    opts.hud.notice('Signed off DoorSmash shift — notifications silenced', 2800)
    emit()
    return summary
  }

  const acceptOffer = (orderId: string): boolean => {
    const idx = offers.findIndex((o) => o.id === orderId)
    if (idx < 0 || activeOrders.length >= MAX_ACTIVE_ORDERS) return false
    const [order] = offers.splice(idx, 1)
    const now = performance.now()
    order.status = order.isSupermarket ? 'shopping' : 'accepted'
    order.acceptedAt = now
    order.deadlineAt = now + order.etaSeconds * 1000
    order.chat.push({
      id: `msg-${now}-0`,
      from: 'system',
      text: `Accepted ${order.code} at ${order.store.name}. ${order.isSupermarket ? `Shop ${order.shoppingList.length} aisle items.` : 'Head to pickup counter.'}`,
      atMs: now,
    })
    activeOrders.push(order)
    rebuildStopsForOrder(order)
    sfx('tap')
    emit()
    return true
  }

  const declineOffer = (orderId: string) => {
    offers = offers.filter((o) => o.id !== orderId)
    emit()
  }

  const cancelOrder = (orderId: string) => {
    const idx = activeOrders.findIndex((o) => o.id === orderId)
    if (idx < 0) return
    const [ord] = activeOrders.splice(idx, 1)
    ord.status = 'cancelled'
    cargo.removeOrder(orderId)
    removeStopsForOrder(orderId)
    const b = beaconPieces.get(orderId)
    if (b) { b.destroy(); beaconPieces.delete(orderId) }
    opts.hud.notice(`Cancelled ${ord.store.name} order`, 2600)
    emit()
  }

  const reorderStop = (fromIndex: number, toIndex: number): boolean => {
    if (fromIndex < 0 || fromIndex >= routeStops.length || toIndex < 0 || toIndex >= routeStops.length || fromIndex === toIndex) return false
    const next = [...routeStops]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    routeStops = next
    syncGpsFromStops()
    sfx('tap')
    emit()
    return true
  }

  const checkParkingStyle = (forceDoublePark = false): { doubleParked: boolean; bonus: number } => {
    const v = activeVehicleThing ?? opts.alive.riding
    if (!v || !v.alive) { doubleParked = false; return { doubleParked: false, bonus: 0 } }
    const w = opts.alive.where(v)
    if (!w) return { doubleParked: false, bonus: 0 }
    const nearOrder = activeOrders.find((o) =>
      Math.hypot(o.store.x - w.at[0] / M, o.store.z - w.at[2] / M) < 55
      || Math.hypot(o.dropoff.x - w.at[0] / M, o.dropoff.z - w.at[2] / M) < 55
    )
    if (!nearOrder && !forceDoublePark) { doubleParked = false; return { doubleParked: false, bonus: 0 } }

    // Check if vehicle sits on asphalt (`mat === 6`) away from curb edge while a clear curb spot exists right next to it!
    const px = Math.round(w.at[0]), pz = Math.round(w.at[2])
    const onAsphalt = (opts.land.top_at(px, pz) & 15) === 6
    const rx = -w.front[2], rz = w.front[0]
    let distCurbR = 0, distCurbL = 0
    for (let d = 5; d <= 75; d += 5) {
      if (!distCurbR && (opts.land.top_at(Math.round(px + rx * d), Math.round(pz + rz * d)) & 15) !== 6) distCurbR = d
      if (!distCurbL && (opts.land.top_at(Math.round(px - rx * d), Math.round(pz - rz * d)) & 15) !== 6) distCurbL = d
    }
    // Parked out in the travel lane (>2.6 m from curb) while open curb exists right beside it = iconic SF double park!
    const curbOpen = (distCurbR >= 26 && distCurbR <= 70) || (distCurbL >= 26 && distCurbL <= 70)
    const isDouble = forceDoublePark || (onAsphalt && curbOpen)
    doubleParked = isDouble
    if (isDouble && nearOrder) {
      const atPickup = Math.hypot(nearOrder.store.x - w.at[0] / M, nearOrder.store.z - w.at[2] / M) < 55
      const already = atPickup ? nearOrder.doubleParkedPickup : nearOrder.doubleParkedDropoff
      if (!already) {
        if (atPickup) nearOrder.doubleParkedPickup = true
        else nearOrder.doubleParkedDropoff = true
        nearOrder.stylePoints += 180
        nearOrder.styleNotes.push('Double-parked beside open spot (+180 style)')
        profile.doubleParks++
        saveProfile(profile)
        opts.hud.notice('🚨 DOUBLE PARKED WITH OPEN SPOT RIGHT THERE! +180 STYLE · Hazards ON', 4200)
        sfx('likes')
        emit()
        return { doubleParked: true, bonus: 180 }
      }
    }
    return { doubleParked: isDouble, bonus: 0 }
  }

  const collectShoppingItem = (orderId: string, itemId: string): boolean => {
    const order = activeOrders.find((o) => o.id === orderId)
    if (!order || !order.isSupermarket) return false
    const item = order.shoppingList.find((i) => i.id === itemId)
    if (!item || item.collected) return false
    item.collected = true
    const done = order.shoppingList.filter((i) => i.collected).length
    const total = order.shoppingList.length
    if (done === total) {
      notifyDriver({
        appId: 'doorsmash',
        title: `Cart Complete (${done}/${total})`,
        body: 'Head to Checkout (E) or exit to load your vehicle!',
        accent: '#10b981',
        durationMs: 3600,
      })
      sfx('cash')
    } else {
      notifyDriver({
        appId: 'doorsmash',
        title: `Auto-Bought (${done}/${total})`,
        body: `${item.name} added to cart`,
        accent: '#38bdf8',
        durationMs: 2200,
      })
      sfx('scan')
    }
    syncInteriorTask(order)
    emit()
    return true
  }

  const collectOrder = (orderId: string): boolean => {
    const order = activeOrders.find((o) => o.id === orderId)
    if (!order) return false
    if (order.isSupermarket && order.shoppingList.some((i) => !i.collected)) {
      opts.hud.notice('Finish your aisle checklist first!', 2400)
      return false
    }
    if (order.delayRemaining > 0.2) {
      opts.hud.notice(`${order.store.name}: "${order.delayReason}" (${Math.ceil(order.delayRemaining)}s)`, 2800)
      return false
    }
    order.status = 'in_transit'
    order.pickedUpAt = performance.now()
    // Load physical CargoItems into the player's CargoBay (liquids start unsealed — player must seal them!)
    let idx = 0
    for (const sp of order.itemSpecs) {
      const ci: CargoItem = {
        id: `${order.id}-it-${idx++}`,
        orderId: order.id,
        orderLabel: order.code,
        name: sp.name,
        emoji: sp.emoji,
        kind: sp.kind,
        baseW: sp.baseW,
        baseH: sp.baseH,
        rotated: false,
        x: null,
        y: null,
        weight: sp.weight,
        fragile: sp.fragile,
        isLiquid: sp.isLiquid,
        sealed: !sp.isLiquid, // Liquids MUST be sealed by player or risk spilling!
        hot: sp.hot,
        cold: sp.cold,
        integrity: 100,
        temp: 100,
        eaten: 0,
        contaminated: false,
        verticalRuined: false,
        crushedBy: null,
        hazard: null,
      }
      cargo.addItem(ci, true)
    }
    removeStopsForOrder(order.id, 'pickup')
    const hasUnsealed = cargo.itemsForOrder(order.id).some((i) => i.isLiquid && !i.sealed)
    const hasLoose = cargo.itemsForOrder(order.id).some((i) => i.x === null)
    const warn = hasUnsealed ? 'Seal soup/drink lids in Cargo!' : hasLoose ? 'Cargo full — pack loose items!' : 'Follow GPS to drop-off'
    notifyDriver({
      appId: 'doorsmash',
      title: `Picked Up · ${order.store.name} (${order.code})`,
      body: warn,
      accent: hasUnsealed ? '#f59e0b' : '#10b981',
      durationMs: 3800,
    })
    sfx('cash')
    if (opts.interiors.active) opts.interiors.updatePickup(undefined)
    emit()
    return true
  }

  const syncInteriorTask = (order: DeliveryOrder) => {
    if (!opts.interiors.active) return
    if (order.isSupermarket) {
      const task: ActiveShoppingTask = {
        orderId: order.id,
        items: order.shoppingList.map((i) => ({ ...i })),
        onCollect: (itemId) => collectShoppingItem(order.id, itemId),
      }
      opts.interiors.updateShopping(task)
    }
    opts.interiors.updatePickup({
      orderId: order.id,
      label: `${order.store.name} (${order.code})`,
      ready: order.delayRemaining <= 0 && (!order.isSupermarket || order.shoppingList.every((i) => i.collected)),
      delayReason: order.delayReason,
      delayRemainingS: order.delayRemaining,
      onPickup: () => {
        if (collectOrder(order.id)) {
          opts.interiors.exit()
          opts.phone.openPhone('doorsmash')
        }
      },
      onNudge: () => {
        if (order.restaurantTrait === 'obnoxious' && order.delayExtensions === 0) {
          order.delayExtensions = 1
          order.delayRemaining += 5
          order.delayReason = DELAY_EXCUSES[(order.delayExtensions + 2) % DELAY_EXCUSES.length]
          opts.hud.notice(`Staff: "${order.delayReason}" (+5s delay!)`, 3000)
        } else {
          order.delayRemaining = Math.max(0, order.delayRemaining - 2.5)
          opts.hud.notice(`Staff hurried up! ${Math.ceil(order.delayRemaining)}s left`, 2200)
        }
        syncInteriorTask(order)
        emit()
      },
    })
  }

  const enterStore = (place?: StorePlaceMeta): boolean => {
    const target = place ?? nearbyStore
    if (!target) return false
    const p = opts.player()
    const matchingOrder = activeOrders.find((o) =>
      (o.status === 'accepted' || o.status === 'shopping' || o.status === 'waiting_delay')
      && (o.store.id === target.id || Math.hypot(o.store.x - target.x, o.store.z - target.z) < 18)
    )
    if (matchingOrder && matchingOrder.delayRemaining > 0) {
      matchingOrder.status = 'waiting_delay'
    }
    const queueCount = matchingOrder?.restaurantTrait === 'obnoxious' ? 4 : matchingOrder?.restaurantTrait === 'busy' ? 3 : 2
    opts.interiors.enter({
      place: target,
      returnPose: { x: p.x, y: p.y, z: p.z, yaw: p.yaw },
      driverQueueCount: queueCount,
      onExit: () => {
        emit()
      },
    })
    if (matchingOrder) syncInteriorTask(matchingOrder)
    emit()
    return true
  }

  const deliverOrder = (orderId: string): DeliveryReceipt | null => {
    const idx = activeOrders.findIndex((o) => o.id === orderId)
    if (idx < 0) return null
    const order = activeOrders[idx]
    if (order.status !== 'in_transit') return null
    activeOrders.splice(idx, 1)
    removeStopsForOrder(order.id)
    const b = beaconPieces.get(order.id)
    if (b) { b.destroy(); beaconPieces.delete(order.id) }

    const items = cargo.removeOrder(order.id)
    const avgIntegrity = items.length ? items.reduce((s, i) => s + i.integrity, 0) / items.length : 100
    const avgTemp = items.length ? items.reduce((s, i) => s + i.temp, 0) / items.length : 100
    const anyVertical = items.some((i) => i.verticalRuined)
    const anyContam = items.some((i) => i.contaminated)
    const anyEaten = order.ateCustomerFood || items.some((i) => i.eaten > 0)

    const now = performance.now()
    const secEarly = (order.deadlineAt - now) / 1000
    const timeBonus = secEarly > 0 ? Math.round(Math.min(5.5, secEarly * 0.08) * 100) / 100 : 0
    const conditionScore = Math.max(0, Math.min(100, avgIntegrity * 0.78 + avgTemp * 0.22 - (anyVertical ? 30 : 0) - (anyContam ? 22 : 0) - (anyEaten ? 65 : 0)))
    const conditionBonus = conditionScore >= 85 ? Math.round(((conditionScore - 70) / 30) * 3.5 * 100) / 100 : 0
    const responsivenessBonus = order.repliedCount > 0 && !order.middleFingerSent ? 1.75 : 0
    const styleBonus = Math.round((order.stylePoints / 60) * 100) / 100

    let score = Math.round(
      conditionScore * 0.55
      + (secEarly >= 0 ? 25 : Math.max(0, 25 + secEarly * 0.4))
      + (order.repliedCount > 0 ? 12 : order.ignoredFollowUp && order.customerTrait === 'obnoxious' ? 2 : 8)
      + Math.min(15, order.stylePoints / 25)
    )
    if (order.middleFingerSent) score = Math.min(score, 8)
    if (anyEaten) score = Math.min(score, 12)
    score = Math.max(0, Math.min(100, score))

    // Tips: upfront tip stays (unless middle finger/eaten triggers chargeback!), post-delivery tip scales with score + driver rating!
    let tip = order.upfrontTip
    if (order.tipMode === 'after' || order.tipMode === 'both') {
      const ratingMult = 0.65 + (profile.stars / 5) * 0.65
      const traitMult = order.customerTrait === 'generous' ? 1.65 : order.customerTrait === 'obnoxious' ? 0.55 : 1.0
      const postTip = score >= 55 ? ((score - 40) / 60) * 7.5 * ratingMult * traitMult : 0
      tip += Math.round(postTip * 100) / 100
    }
    if (order.middleFingerSent || anyEaten) tip = 0
    tip = Math.round(tip * 100) / 100

    const totalPay = Math.round((order.basePay + timeBonus + conditionBonus + responsivenessBonus + styleBonus + tip) * 100) / 100
    const starsEarned = order.middleFingerSent || anyEaten
      ? 1.0
      : Math.max(1.0, Math.min(5.0, Math.round((1.5 + (score / 100) * 3.5) * 10) / 10))
    const likesEarned = order.middleFingerSent || anyEaten
      ? 0
      : Math.max(5, Math.round(score * 0.45 + (order.stylePoints > 0 ? 15 : 0) + (conditionScore >= 92 ? 12 : 0)))

    const flags: string[] = []
    if (anyEaten) flags.push('Driver ate customer food!')
    if (order.middleFingerSent) flags.push('Sent 🖕 in chat')
    if (anyVertical) flags.push('Vertical pizza (-score)')
    if (anyContam) flags.push('Soup spill soaked cargo')
    if (order.doubleParkedPickup || order.doubleParkedDropoff) flags.push('Double-park style bonus')
    if (secEarly > 15) flags.push('Fast delivery bonus')

    const review = order.middleFingerSent
      ? '"Driver flipped me off in the app?! Uninstalling immediately!!"'
      : anyEaten
      ? '"Half my food was MISSING and there were crumbs on the bag!!"'
      : anyVertical
      ? '"Why is my pizza folded into a calzone at the bottom of the box?!"'
      : anyContam
      ? '"Everything is soaked in ramen broth 😭"'
      : score >= 88
      ? `"Lightning fast & piping hot! +${likesEarned} 👍"`
      : score >= 68
      ? '"Solid SF delivery, thanks!"'
      : '"Took a while and a bit banged up."'

    const receipt: DeliveryReceipt = {
      orderId: order.id,
      storeName: order.store.name,
      customerName: order.customerName,
      basePay: order.basePay,
      timeBonus,
      conditionBonus,
      responsivenessBonus,
      styleBonus,
      tip,
      totalPay,
      starsEarned,
      likesEarned,
      score,
      review,
      flags,
      atMs: now,
    }

    order.status = 'delivered'
    profile.cash = Math.round((profile.cash + totalPay) * 100) / 100
    profile.stars = Math.round(((profile.stars * profile.ratingCount + starsEarned) / (profile.ratingCount + 1)) * 100) / 100
    profile.ratingCount++
    profile.likes += likesEarned
    profile.completed++
    if (shift.active) {
      shift = {
        ...shift,
        completed: shift.completed + 1,
        earnings: Math.round((shift.earnings + totalPay) * 100) / 100,
        likes: shift.likes + likesEarned,
      }
    }
    profile.recentReceipts = [receipt, ...profile.recentReceipts].slice(0, 12)
    lastReceipt = receipt
    saveProfile(profile)

    sfx(likesEarned > 0 ? 'likes' : 'finger')
    if (totalPay > 0) sfx('cash')
    notifyDriver({
      appId: 'doorsmash',
      title: `Delivered! +$${totalPay.toFixed(2)} · ${starsEarned.toFixed(1)}★`,
      body: likesEarned > 0 ? `+${likesEarned} 👍 Likes from ${order.customerName}! ${review}` : review,
      accent: likesEarned > 0 ? '#10b981' : '#ef4444',
    })
    emit()
    return receipt
  }

  const replyToOrder = (orderId: string, text: string): boolean => {
    const order = activeOrders.find((o) => o.id === orderId)
    const clean = text.trim()
    if (!order || !clean) return false
    const now = performance.now()
    order.chat.push({ id: `d-${now}`, from: 'driver', text: clean, atMs: now })
    order.unreadChat = 0
    order.repliedCount++
    sfx('tap')
    // Trigger quick customer acknowledgement
    const ack = order.customerTrait === 'obnoxious'
      ? 'Okay well HURRY UP pls'
      : order.customerTrait === 'generous'
      ? 'You\'re the best! Adding extra tip after 🙌'
      : 'Awesome, thanks!'
    order.chat.push({ id: `c-${now + 1}`, from: 'customer', text: ack, atMs: now + 500 })
    emit()
    return true
  }

  const sendMiddleFinger = (orderId: string): boolean => {
    const order = activeOrders.find((o) => o.id === orderId)
    if (!order) return false
    const now = performance.now()
    order.middleFingerSent = true
    order.unreadChat = 0
    profile.middleFingersSent++
    saveProfile(profile)
    order.chat.push({ id: `mf-${now}`, from: 'driver', text: '🖕', atMs: now })
    order.chat.push({
      id: `mf-r-${now}`,
      from: 'customer',
      text: order.customerTrait === 'obnoxious'
        ? 'EXCUSE ME?!?! I AM SCREENCAPPING THIS FOR DOORSMASH SUPPORT!! 0 TIP!!'
        : 'Bro seriously?! What did I even do?? 😭',
      atMs: now + 200,
    })
    sfx('finger')
    opts.hud.notice(`Sent 🖕 to ${order.customerName} — tip nuked!`, 3200)
    emit()
    return true
  }

  const eatCargoItem = (itemId: string): boolean => {
    const item = cargo.getItem(itemId)
    if (!item) return false
    if (!cargo.eatItem(itemId)) return false
    const order = activeOrders.find((o) => o.id === item.orderId)
    profile.eatenCount++
    saveProfile(profile)
    sfx('eat')
    if (order) {
      order.ateCustomerFood = true
      const now = performance.now()
      order.chat.push({
        id: `eat-${now}`,
        from: 'customer',
        text: item.eaten >= 1
          ? `WAIT DID YOU JUST EAT MY ENTIRE ${item.name.toUpperCase()}?!`
          : `Uh why does the bag weight alert say you're snacking on my ${item.name}?!`,
        atMs: now,
      })
      order.unreadChat++
      notifyDriver({
        appId: 'doorsmash',
        title: `${order.customerName} is furious!`,
        body: `You ate their ${item.name}! Send 🖕 or deliver the crumbs?`,
        accent: '#f59e0b',
      })
    }
    opts.hud.notice(`Munched ${item.name}! 😋`, 2400)
    emit()
    return true
  }

  const selectOrBuyVehicle = (id: DeliveryVehicleId): { ok: boolean; message: string } => {
    const def = getVehicleDef(id)
    if (!profile.ownedVehicles.includes(id)) {
      if (profile.cash < def.cost) return { ok: false, message: `Need $${def.cost} (you have $${profile.cash.toFixed(0)})` }
      profile.cash = Math.round((profile.cash - def.cost) * 100) / 100
      profile.ownedVehicles.push(id)
      sfx('cash')
    } else {
      sfx('tap')
    }
    profile.activeVehicle = id
    cargo.configure(id, profile.upgrades[id])
    saveProfile(profile)
    emit()
    return { ok: true, message: `${def.name} ready in Garage!` }
  }

  const buyPaint = (paintId: PaintId): { ok: boolean; message: string } => {
    const def = getPaintDef(paintId)
    const up = profile.upgrades[profile.activeVehicle]
    if (up.paint === paintId) return { ok: true, message: 'Already applied' }
    if (profile.cash < def.cost) return { ok: false, message: `Need $${def.cost}` }
    profile.cash = Math.round((profile.cash - def.cost) * 100) / 100
    up.paint = paintId
    saveProfile(profile)
    sfx('cash')
    emit()
    return { ok: true, message: `Painted ${def.name}!` }
  }

  const buyLighting = (lightingId: LightingId): { ok: boolean; message: string } => {
    const def = getLightingDef(lightingId)
    const up = profile.upgrades[profile.activeVehicle]
    if (up.lighting === lightingId) return { ok: true, message: 'Already installed' }
    if (profile.cash < def.cost) return { ok: false, message: `Need $${def.cost}` }
    profile.cash = Math.round((profile.cash - def.cost) * 100) / 100
    up.lighting = lightingId
    saveProfile(profile)
    sfx('cash')
    emit()
    return { ok: true, message: `Installed ${def.name}!` }
  }

  const buyUpgrade = (kind: keyof typeof PRACTICAL_UPGRADES): { ok: boolean; message: string } => {
    const spec = PRACTICAL_UPGRADES[kind]
    const up = profile.upgrades[profile.activeVehicle]
    const cur = up[kind]
    if (cur >= spec.max) return { ok: false, message: 'Max level installed' }
    const cost = spec.costs[cur]
    if (profile.cash < cost) return { ok: false, message: `Need $${cost}` }
    profile.cash = Math.round((profile.cash - cost) * 100) / 100
    up[kind] = cur + 1
    cargo.configure(profile.activeVehicle, up)
    saveProfile(profile)
    sfx('cash')
    emit()
    return { ok: true, message: `Upgraded ${spec.name} Lv.${up[kind]}!` }
  }

  /** Spawns the player's customized delivery vehicle cleanly on clear street asphalt near them! */
  const spawnActiveVehicle = async (): Promise<Thing | null> => {
    if (opts.interiors.active) opts.interiors.exit()
    if (opts.alive.riding) opts.alive.mount(null)
    const data = buildDeliveryVehicle(profile.activeVehicle, profile.upgrades[profile.activeVehicle])
    const f0 = data.fine?.[0]
    if (f0 && f0.cells instanceof Uint16Array) opts.onVehiclePrebake?.(f0.cells, f0.size)

    const p = opts.player()
    const ox = Math.round(p.x * M), oz = Math.round(p.z * M)
    const isAsphalt = (x: number, z: number) => (opts.land.top_at(Math.round(x), Math.round(z)) & 15) === 6
    let spotX = ox + Math.round(Math.sin(p.yaw) * 45)
    let spotZ = oz - Math.round(Math.cos(p.yaw) * 45)
    let spotY = opts.land.ground_at(spotX, spotZ)
    let found = false
    for (let rad = 35; rad <= 320 && !found; rad += 20) {
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI * 2) / 16
        const tx = Math.round(ox + Math.cos(a) * rad)
        const tz = Math.round(oz + Math.sin(a) * rad)
        if (!isAsphalt(tx, tz)) continue
        const g = opts.land.ground_at(tx, tz)
        if (opts.land.feet_at(tx, tz) - g > 12) continue
        spotX = tx; spotZ = tz; spotY = g; found = true
        break
      }
    }
    if (activeVehicleThing && activeVehicleThing.alive && opts.alive.riding !== activeVehicleThing) {
      opts.alive.vanish(activeVehicleThing)
    }
    const low: [number, number, number] = [
      Math.round(spotX - data.size[0] / 2),
      spotY + 3,
      Math.round(spotZ - data.size[2] / 2),
    ]
    const thing = await opts.alive.spawn({ ...data, low })
    if (!thing.alive) {
      opts.hud.notice('Could not summon delivery vehicle right here', 2800)
      return null
    }
    activeVehicleThing = thing
    doubleParked = false
    const yawQ = -p.yaw + Math.PI * 0.5
    const q: [number, number, number, number] = [0, Math.sin(yawQ * 0.5), 0, Math.cos(yawQ * 0.5)]
    const at = opts.alive.where(thing)
    const comY = at ? at.at[1] - low[1] : data.size[1] * 0.45
    opts.alive.place(thing, [spotX, spotY + comY + 1, spotZ], q)
    opts.hud.notice(`${data.name} delivered to the curb! Press E to ride`, 3800)
    sfx('cash')
    emit()
    return thing
  }

  const interactHangout = (spotId?: string): { likes: number; tip: string } | null => {
    ensureLocalHangout()
    const p = opts.player()
    const spot = spotId
      ? hangouts.find((h) => h.id === spotId)
      : hangouts.find((h) => Math.hypot(h.x - p.x, h.z - p.z) < 28)
    if (!spot) return null
    const bonusLikes = 14 + Math.floor(rand() * 12)
    profile.likes += bonusLikes
    saveProfile(profile)
    const tip = HANGOUT_TIPS[Math.floor(rand() * HANGOUT_TIPS.length)]
    sfx('likes')
    opts.hud.notice(`👍 +${bonusLikes} Likes with fellow couriers! "${tip}"`, 4800)
    if (shift.active && offers.length < MAX_OFFERS) generateOffer()
    emit()
    return { likes: bonusLikes, tip }
  }

  // Listen for street crash events as a secondary impact source
  const onCrashEvent = (ev: Event) => {
    if (!opts.alive.riding || !cargo.items.length) return
    const det = (ev as CustomEvent<{ speed?: number; force?: number; at?: [number, number, number] }>).detail
    const now = performance.now()
    if (now - lastImpactAt < 350) return
    lastImpactAt = now
    const speedCells = Math.max(22, (det?.speed ?? 4) * 10)
    const report = cargo.applyImpact({ localFwd: 0.9, localRight: (rand() - 0.5) * 0.6, localUp: 0, speedCells })
    handleImpactReport(report)
  }
  if (typeof window !== 'undefined') window.addEventListener('voxelwright:crash', onCrashEvent)

  const handleImpactReport = (report: CargoImpactReport | null) => {
    if (!report || report.totalDamage <= 0) return
    sfx(report.spilledIds.length ? 'spill' : 'thud')
    const spillNote = report.contaminatedIds.length
      ? ` · SOUP SPILLED onto ${report.contaminatedIds.length} other item(s)!`
      : report.spilledIds.length
      ? ' · Liquid spilled!'
      : ''
    opts.hud.notice(`💥 ${report.zone.toUpperCase()} impact damaged cargo (-${report.totalDamage}%)${spillNote}`, 3800)
    // Alert any customer whose food dropped below 55%
    for (const d of report.damagedItems) {
      if (d.integrity >= 55) continue
      const ci = cargo.getItem(d.id)
      const ord = ci ? activeOrders.find((o) => o.id === ci.orderId) : undefined
      if (ord && ord.chat.length < 6) {
        ord.chat.push({ id: `imp-${performance.now()}`, from: 'customer', text: 'Did you just crash?! Please tell me my food survived 😭', atMs: performance.now() })
        ord.unreadChat++
      }
    }
    emit()
  }

  const clearWorldCue = () => {
    worldCue?.remove()
    worldCue = null
  }

  // Frame loop: offer dispatch, restaurant delays, customer texts, cargo physics, impacts, beacons, and world cues!
  const frame = (dt: number, seconds: number) => {
    if (!opts.engaged()) { clearWorldCue(); return }
    ensureLocalHangout()
    const now = performance.now()
    const p = opts.player()

    // 1. Auto-dispatch new offers periodically ONLY while signed into an active shift!
    if (shift.active) {
      offers = offers.filter((o) => o.offerExpiresAt > now)
      offerSpawnTimer -= dt
      if (offerSpawnTimer <= 0 && offers.length < 3) {
        const focusOpts = shift.focus === 'supermarkets' ? { supermarket: true } : shift.focus === 'restaurants' ? { supermarket: false } : undefined
        generateOffer(focusOpts)
        offerSpawnTimer = 14 + rand() * 12
      }
    } else if (offers.length) {
      offers = []
    }

    // 2. Step active orders: live sidewalk curb-verification once terrain tiles stream in, delay countdowns & follow-up texts!
    let changed = false
    let stopsMoved = false
    for (const ord of activeOrders) {
      // Once near the dropoff (tiles loaded), verify the customer stands on a real sidewalk — NEVER in the middle of the road!
      if (!ord.dropoff.curbVerified && Math.hypot(ord.dropoff.x - p.x, ord.dropoff.z - p.z) < 165) {
        const verified = findSidewalkDropoff(opts.land, ord.dropoff.x, ord.dropoff.z, ord.dropoff.roadNx ?? 1, ord.dropoff.roadNz ?? 0)
        if (verified) {
          const movedM = Math.hypot(verified.x - ord.dropoff.x, verified.z - ord.dropoff.z)
          ord.dropoff.x = verified.x
          ord.dropoff.z = verified.z
          ord.dropoff.curbVerified = true
          const existingBeacon = beaconPieces.get(ord.id)
          if (existingBeacon) {
            const gy = opts.land.ground_at(Math.round(verified.x * M), Math.round(verified.z * M))
            existingBeacon.pos = [verified.x * M, gy, verified.z * M]
          }
          if (movedM > 1.5) {
            for (const st of routeStops) {
              if (st.orderId === ord.id && st.kind === 'dropoff') {
                st.x = verified.x
                st.z = verified.z
                stopsMoved = true
              }
            }
          }
        }
      }
      if ((ord.status === 'accepted' || ord.status === 'waiting_delay') && ord.delayRemaining > 0) {
        const nearStore = opts.interiors.active
          ? opts.interiors.currentPlace?.id === ord.store.id
          : Math.hypot(ord.store.x - p.x, ord.store.z - p.z) < 28
        if (nearStore) {
          ord.delayRemaining = Math.max(0, ord.delayRemaining - dt)
          if (ord.delayRemaining <= 0) {
            ord.status = 'accepted'
            opts.hud.notice(`${ord.store.name}: Order ${ord.code} is finally ready!`, 3200)
            sfx('order')
            changed = true
          }
          if (opts.interiors.active) syncInteriorTask(ord)
        }
      }
      if (ord.status === 'in_transit' && !ord.followUpSent && now - ord.pickedUpAt > 7500) {
        ord.followUpSent = true
        ord.followUpAskedAt = now
        ord.chat.push({ id: `fu-${now}`, from: 'customer', text: ord.followUpText, atMs: now })
        ord.unreadChat++
        notifyDriver({
          appId: 'doorsmash',
          title: `Message from ${ord.customerName}`,
          body: ord.followUpText,
          accent: ord.customerTrait === 'obnoxious' ? '#f59e0b' : '#38bdf8',
          sound: 'chat',
        })
        changed = true
      }
      if (ord.followUpSent && !ord.ignoredFollowUp && ord.repliedCount === 0 && now - ord.followUpAskedAt > 22_000) {
        ord.ignoredFollowUp = true
        if (ord.customerTrait === 'obnoxious' || ord.customerTrait === 'hangry') {
          ord.chat.push({ id: `ign-${now}`, from: 'customer', text: 'HELLO??? Are you ignoring me?!', atMs: now })
          ord.unreadChat++
          changed = true
        }
      }
    }
    if (stopsMoved) syncGpsFromStops()

    // 3. Detect vehicle dismount -> check double-parking style bonus!
    const ridingNow = !!opts.alive.riding
    if (ridingNow) {
      doubleParked = false
      if (!activeVehicleThing || opts.alive.riding === activeVehicleThing) activeVehicleThing = opts.alive.riding
    } else if (wasRiding && !ridingNow) {
      checkParkingStyle()
    }
    wasRiding = ridingNow

    // 4. Step CargoBay continuous physics + check real vehicle collision impacts from alive.struck!
    const tel = opts.alive.telemetry
    const stepRes = cargo.step(dt, {
      moving: ridingNow && (tel?.kmh ?? 0) > 2,
      kmh: tel?.kmh ?? 0,
      slip: tel?.slip ?? 0,
      drifting: tel?.drifting ?? false,
    })
    if (stepRes.spilled.length) {
      sfx('spill')
      opts.hud.notice('💦 Unsealed liquid spilled into adjacent cargo!', 3400)
      changed = true
    }

    const struck = opts.alive.struck
    if (struck.length < lastStruckLen) lastStruckLen = 0
    if (ridingNow && opts.alive.riding && cargo.items.length && struck.length > lastStruckLen) {
      const rThing = opts.alive.riding
      const w = opts.alive.where(rThing)
      for (let i = lastStruckLen; i < struck.length; i++) {
        const s = struck[i]
        if ((s.a !== rThing.id && s.b !== rThing.id) || s.speed < 18) continue
        if (now - lastImpactAt < 350) continue
        lastImpactAt = now
        let localFwd = 0.6, localRight = 0, localUp = 0
        if (w) {
          const dx = s.at[0] - w.at[0], dy = s.at[1] - w.at[1], dz = s.at[2] - w.at[2]
          const fx = w.front[0], fz = w.front[2]
          const rx = -fz, rz = fx
          localFwd = (dx * fx + dz * fz) / Math.max(4, rThing.size[0] * 0.5)
          localRight = (dx * rx + dz * rz) / Math.max(4, rThing.size[2] * 0.5)
          localUp = dy / Math.max(4, rThing.size[1] * 0.5)
        }
        handleImpactReport(cargo.applyImpact({ localFwd, localRight, localUp, speedCells: s.speed }))
        changed = true
      }
    }
    lastStruckLen = struck.length

    // 5. Manage 3D dropoff beacons & hangout parked mopeds outside
    const activeDropIds = new Set<string>()
    for (const ord of activeOrders) {
      if (ord.status !== 'in_transit') continue
      activeDropIds.add(ord.id)
      if (!beaconPieces.has(ord.id)) {
        const pc = opts.pieces.add(dropoffBeaconBorn(), true)
        const gy = opts.land.ground_at(Math.round(ord.dropoff.x * M), Math.round(ord.dropoff.z * M))
        pc.pos = [ord.dropoff.x * M, gy, ord.dropoff.z * M]
        pc.rot = [0, 0, 0, 1]
        pc.cell = 1
        beaconPieces.set(ord.id, pc)
      }
    }
    for (const [id, pc] of beaconPieces) {
      if (!activeDropIds.has(id)) { pc.destroy(); beaconPieces.delete(id) }
    }

    // Stream parked courier mopeds at nearby hangout spots
    for (const h of hangouts) {
      const dist = Math.hypot(h.x - p.x, h.z - p.z)
      if (dist < 130 && !hangoutPieces.has(h.id)) {
        const list: Piece[] = []
        for (let i = 0; i < 2; i++) {
          const mx = h.x + (i === 0 ? -2.2 : 2.4)
          const mz = h.z + (i === 0 ? 1.8 : -1.5)
          const gy = opts.land.ground_at(Math.round(mx * M), Math.round(mz * M))
          const pc = opts.pieces.add(parkedMopedBorn(), true)
          pc.pos = [mx * M, gy, mz * M]
          const yaw = (h.seed % 6) * 0.5 + i * 0.9
          pc.rot = [0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5)]
          pc.cell = 0.5
          list.push(pc)
        }
        hangoutPieces.set(h.id, list)
      } else if (dist > 175 && hangoutPieces.has(h.id)) {
        for (const pc of hangoutPieces.get(h.id)!) pc.destroy()
        hangoutPieces.delete(h.id)
      }
    }

    // 6. Outside street contextual cues (Enter store, Deliver to customer, or Hang out with drivers!)
    nearbyStore = null
    if (!opts.interiors.active && !ridingNow) {
      let bestKey = ''
      let bestText = ''
      let bestAt: [number, number, number] = [0, 0, 0]
      let bestAct: (() => void) | null = null

      // Priority 1: Active order dropoff within 12 m
      for (const ord of activeOrders) {
        if (ord.status !== 'in_transit') continue
        const d = Math.hypot(ord.dropoff.x - p.x, ord.dropoff.z - p.z)
        if (d < 12) {
          const gy = opts.land.ground_at(Math.round(ord.dropoff.x * M), Math.round(ord.dropoff.z * M))
          bestKey = `drop:${ord.id}`
          bestText = `E  Deliver to ${ord.customerName} (${ord.code})`
          bestAt = [ord.dropoff.x * M, gy + 22, ord.dropoff.z * M]
          bestAct = () => { deliverOrder(ord.id) }
          break
        }
      }

      // Priority 2: Active order pickup store within 12 m
      if (!bestKey) {
        for (const ord of activeOrders) {
          if (ord.status === 'in_transit') continue
          const d = Math.hypot(ord.store.x - p.x, ord.store.z - p.z)
          if (d < 12) {
            nearbyStore = ord.store
            const gy = opts.land.ground_at(Math.round(ord.store.x * M), Math.round(ord.store.z * M))
            bestKey = `enter:${ord.store.id}`
            bestText = `E  Enter ${ord.store.name} (${ord.isSupermarket ? 'Shop' : 'Pickup'})`
            bestAt = [ord.store.x * M, gy + 22, ord.store.z * M]
            bestAct = () => { enterStore(ord.store) }
            break
          }
        }
      }

      // Priority 3: Any food/grocery storefront in places.json within 7.5 m!
      if (!bestKey) {
        const payload = opts.places()
        if (payload?.shops.length) {
          let bestD = 7.5
          let bestShop: RawShop | null = null
          for (const s of payload.shops) {
            if (!FOOD_CATEGORIES.has(s.c)) continue
            const d = Math.hypot(s.x - p.x, s.z - p.z)
            if (d < bestD) { bestD = d; bestShop = s }
          }
          if (bestShop) {
            const meta = rawShopToMeta(bestShop, payload)
            nearbyStore = meta
            const gy = opts.land.ground_at(Math.round(meta.x * M), Math.round(meta.z * M))
            bestKey = `enter:${meta.id}`
            bestText = `E  Enter ${meta.name}`
            bestAt = [meta.x * M, gy + 22, meta.z * M]
            bestAct = () => { enterStore(meta) }
          }
        }
      }

      // Priority 4: Nearby courier hangout spot within 10 m
      if (!bestKey) {
        for (const h of hangouts) {
          const d = Math.hypot(h.x - p.x, h.z - p.z)
          if (d < 10) {
            const gy = opts.land.ground_at(Math.round(h.x * M), Math.round(h.z * M))
            bestKey = `hang:${h.id}`
            bestText = `E  Hang out · 👍 Send Likes (${h.name})`
            bestAt = [h.x * M, gy + 20, h.z * M]
            bestAct = () => { interactHangout(h.id) }
            break
          }
        }
      }

      if (bestKey !== (worldCue?.key ?? '')) {
        clearWorldCue()
        if (bestKey && bestAct) {
          const pos = bestAt
          const act = bestAct
          const cue = opts.hud.cue(bestText, () => pos, act)
          worldCue = { key: bestKey, remove: cue.remove, act }
        }
      }
    } else {
      clearWorldCue()
    }

    if (changed) emit()
    void seconds
  }

  // Listen for E when standing by a delivery cue outside
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE' || e.repeat || opts.interiors.active || opts.alive.riding || !worldCue) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (opts.alive.near) return // Never steal E from getting into a car right beside you
      worldCue.act()
    })
  }

  const lights = (sink: LocalLightSink, seconds: number) => {
    opts.interiors.lights(sink)
    if (activeVehicleThing && activeVehicleThing.alive) {
      emitDeliveryVehicleLights(
        sink,
        activeVehicleThing,
        opts.alive.where(activeVehicleThing),
        profile.upgrades[profile.activeVehicle],
        doubleParked && opts.alive.riding !== activeVehicleThing,
        seconds,
      )
    }
    // Soft emerald light pools at active customer drop-off beacons
    for (const pc of beaconPieces.values()) {
      sink.addPoint(pc.pos[0], pc.pos[1] + 18, pc.pos[2], 0.25, 1.85, 0.95, 55, 22, 0.8, 86, LIGHT_EXTRA)
    }
  }

  const folk = (view: View, seconds: number): readonly Person[] => {
    folkBuf.length = 0
    if (!opts.engaged()) return folkBuf
    if (opts.interiors.active) return opts.interiors.folk(view, seconds)
    const eyeXM = view.eye[0] / M, eyeZM = view.eye[2] / M

    // 1. Clusters of NPC delivery guys at SF Hangout Spots (thermal backpacks + helmets + phones!)
    for (const h of hangouts) {
      if (Math.hypot(h.x - eyeXM, h.z - eyeZM) > 125) continue
      for (let i = 0; i < h.driverCount; i++) {
        const ang = (i / h.driverCount) * Math.PI * 2 + 0.4
        const px = h.x + Math.cos(ang) * 2.1
        const pz = h.z + Math.sin(ang) * 2.1
        const gy = opts.land.ground_at(Math.round(px * M), Math.round(pz * M))
        const packCol = i % 3 === 0 ? '#e63946' : i % 3 === 1 ? '#f59e0b' : '#2ec4b6'
        folkBuf.push({
          at: [px * M, gy, pz * M],
          yaw: Math.atan2(h.x - px, -(h.z - pz)),
          seed: h.seed + i * 37,
          time: seconds + i * 1.7,
          reading: i % 2 === 0 ? 0.9 : 0,
          glance: Math.sin(seconds * 0.6 + i) * 0.35,
          name: i === 0 ? 'DoorSmash Crew' : undefined,
          says: i === 0 && Math.hypot(h.x - eyeXM, h.z - eyeZM) < 16 ? '👍 Keep on keeping on!' : undefined,
          look: {
            coat: '#1e293b',
            wear: ['jacket', i % 2 === 0 ? 'helmet #111827' : 'cap #e63946', 'vest #eab308'],
            carry: i % 2 === 0 ? 'phone' : undefined,
            extra: [{ on: 'chest', at: [0, 2.7, 2.25], size: [3.6, 4.4, 2.4], colour: packCol, shiny: true }],
          },
        })
      }
    }

    // 2. Lines of waiting NPC delivery guys outside active pickup restaurants + waiting customers at dropoffs!
    for (const ord of activeOrders) {
      if (ord.status !== 'in_transit' && Math.hypot(ord.store.x - eyeXM, ord.store.z - eyeZM) < 110) {
        const lineCount = ord.restaurantTrait === 'obnoxious' ? 4 : 2
        for (let i = 0; i < lineCount; i++) {
          const px = ord.store.x + 1.8 + i * 1.15
          const pz = ord.store.z + 1.4
          const gy = opts.land.ground_at(Math.round(px * M), Math.round(pz * M))
          folkBuf.push({
            at: [px * M, gy, pz * M],
            yaw: -Math.PI * 0.5,
            seed: hashStr(ord.id) + i * 29,
            time: seconds + i,
            reading: 0.92,
            says: i === 0 && ord.restaurantTrait === 'obnoxious' ? 'Still waiting on this kitchen...' : undefined,
            look: {
              coat: '#262c38',
              wear: ['jacket', 'helmet #1f2937'],
              carry: 'phone',
              extra: [{ on: 'chest', at: [0, 2.7, 2.25], size: [3.6, 4.4, 2.4], colour: i % 2 ? '#f59e0b' : '#e63946', shiny: true }],
            },
          })
        }
      }
      if (ord.status === 'in_transit' && Math.hypot(ord.dropoff.x - eyeXM, ord.dropoff.z - eyeZM) < 110) {
        const cx = Math.round(ord.dropoff.x * M), cz = Math.round(ord.dropoff.z * M)
        const g = opts.land.ground_at(cx, cz)
        const f = opts.land.feet_at(cx, cz)
        const gy = f - g > 20 ? g : Math.max(g, f)
        folkBuf.push({
          at: [ord.dropoff.x * M, gy, ord.dropoff.z * M],
          yaw: Math.atan2(eyeXM - ord.dropoff.x, -(eyeZM - ord.dropoff.z)),
          seed: ord.dropoff.seed,
          time: seconds,
          move: { move: NAMED.wave, t: seconds * 0.7 },
          name: ord.customerName,
          says: ord.middleFingerSent ? '😡 YOU BETTER NOT!' : ord.ateCustomerFood ? '😡 WHERE IS MY FOOD?!' : 'Over here!',
        })
      }
    }
    return folkBuf
  }

  opts.phone.setStatusChip(`$${profile.cash.toFixed(0)}`)

  return {
    get profile() { return profile },
    get rank() { return driverRankFor(profile.likes, profile.completed) },
    get onShift() { return shift.active },
    get shift() { return shift },
    get lastShiftSummary() { return lastShiftSummary },
    get offers() { return offers },
    get activeOrders() { return activeOrders },
    get routeStops() { return routeStops },
    cargo,
    get hangouts() { return hangouts },
    interiors: opts.interiors,
    phone: opts.phone,
    get activeVehicleThing() { return activeVehicleThing && activeVehicleThing.alive ? activeVehicleThing : null },
    get doubleParked() { return doubleParked },
    get nearbyStore() { return nearbyStore },
    get lastReceipt() { return lastReceipt },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    startShift,
    endShift,
    generateOffer,
    acceptOffer,
    declineOffer,
    cancelOrder,
    reorderStop,
    enterStore,
    collectOrder,
    collectShoppingItem,
    deliverOrder,
    replyToOrder,
    sendMiddleFinger,
    eatCargoItem,
    sealCargoItem(id) {
      const ok = cargo.sealItem(id)
      if (ok) { sfx('seal'); emit() }
      return ok
    },
    rotateCargoItem(id) {
      const ok = cargo.rotateItem(id)
      if (ok) { sfx('tap'); emit() }
      return ok
    },
    moveCargoItem(id, x, y) {
      const ok = cargo.moveItem(id, x, y)
      if (ok) { sfx('tap'); emit() }
      return ok
    },
    selectOrBuyVehicle,
    buyPaint,
    buyLighting,
    buyUpgrade,
    spawnActiveVehicle,
    checkParkingStyle,
    interactHangout,
    frame,
    lights,
    folk,
    resetProgress() {
      profile = defaultProfile()
      saveProfile(profile)
      shift = { active: false, focus: 'citywide', startedAt: 0, endedAt: 0, completed: 0, earnings: 0, likes: 0 }
      lastShiftSummary = null
      offers = []
      activeOrders = []
      routeStops = []
      cargo.items = []
      cargo.configure(profile.activeVehicle, profile.upgrades[profile.activeVehicle])
      syncGpsFromStops()
      opts.phone.dismissNotification?.()
      emit()
    },
  }
}
