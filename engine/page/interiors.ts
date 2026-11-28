// Modular, non-cookie-cutter Store & Restaurant Interior System for San Francisco.
// Synthesizes unique walkable 3D voxel interiors from real map/brand metadata (places.json + brands.json),
// supports a 1:1 custom override registry (ready for real-life photo/video interior blueprints),
// populates NPC workers, diners/shoppers & queued delivery drivers, and powers supermarket aisle shopping!
import type { Target } from '../probe/gpu.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import { LIGHT_EXTRA, type LocalLightSink } from './lights.ts'
import type { View } from './march.ts'
import { NAMED } from './moves.ts'
import type { Person } from './people.ts'
import type { Piece, Pieces } from './pieces.ts'
import { createStorefrontSigns, type SignSpec, type SignStyle, type StorefrontSigns } from './storefront-signs.ts'
import {
  buildRoomShellAsset,
  buildShoppingCartAsset,
  getInteriorModuleKit,
  grey,
  hue,
  k,
  type FloorStyle,
  type InteriorBlueprint,
  type InteriorModulePlacement,
  type InteriorNpcPlacement,
  type InteriorSignPlacement,
  type ModuleKind,
  type ShoppingAisleZone,
} from './interior-modules.ts'

const M = 10 // 10 world cells per metre
const INTERIOR_ALT_CELLS = 4200 // 420 m elevation: above every SF skyscraper, zero world-voxel edits or occlusion
const WALL_PAD = 0.55 // metres player collision radius inside room

const CONCRETE = 7, BRICK = 8, PLASTER = 9, WOOD = 10, STEEL = 12

export interface StorePlaceMeta {
  id: string
  name: string
  category: string
  brandId?: string | null
  x: number
  z: number
  widthM?: number
  heightM?: number
  address?: string
  style?: SignStyle
}

export interface ActiveShoppingTask {
  orderId: string
  items: { id: string; name: string; aisleNumber: number; aisleName: string; category: ShoppingAisleZone['category']; collected: boolean }[]
  onCollect: (itemId: string) => void
}

export interface InteriorEnterOptions {
  place: StorePlaceMeta
  /** Return pose on the street outside when the player exits. */
  returnPose: { x: number; y: number; z: number; yaw: number }
  /** Active pickup order info if the player is picking up at this store. */
  pickupOrder?: {
    orderId: string
    label: string
    ready: boolean
    delayReason?: string
    delayRemainingS?: number
    onPickup: () => void
    onNudge?: () => void
  }
  /** Active supermarket shopping task if this is a Shop & Deliver order. */
  shopping?: ActiveShoppingTask
  /** Number of extra NPC delivery drivers waiting in line at the pickup counter. */
  driverQueueCount?: number
  onExit?: () => void
}

export interface InteriorSystemOptions {
  device: GPUDevice
  format: GPUTextureFormat
  pieces: Pieces
  hud: Hud
  input: Input
  pose: { x: number; y: number; z: number; yaw: number; pitch: number; tilt?: [number, number, number, number] }
  onEnterChanged?: (inside: boolean, place: StorePlaceMeta | null) => void
  onSfx?: (kind: 'door' | 'scan' | 'tap') => void
}

export interface InteriorSystem {
  readonly active: boolean
  readonly currentBlueprint: InteriorBlueprint | null
  readonly currentPlace: StorePlaceMeta | null
  /** Street-level anchor [x, y, z] in world cells so world streaming stays hot outside while indoors. */
  readonly streetAnchor: readonly [number, number, number] | null
  /** Synthesizes or retrieves a 1:1 override blueprint for any store/restaurant without entering it. */
  blueprintFor(place: StorePlaceMeta): InteriorBlueprint
  /** Registers a custom 1:1 interior blueprint (by place id, brand id, or lowercased name). */
  registerOverride(key: string, blueprint: InteriorBlueprint): void
  listOverrides(): string[]
  exportBlueprint(place: StorePlaceMeta): string
  importBlueprint(key: string, json: string): InteriorBlueprint
  enter(opts: InteriorEnterOptions): InteriorBlueprint
  updatePickup(info: InteriorEnterOptions['pickupOrder']): void
  updateShopping(task: ActiveShoppingTask | null): void
  exit(): void
  /** Steps 3D first-person walking & module collisions inside the room; returns true while indoors. */
  frame(dt: number): boolean
  lights(sink: LocalLightSink): void
  prepareSigns(to: Target, view: View, sun: readonly [number, number, number], day: number, dull: number): boolean
  recordSigns(pass: GPURenderPassEncoder): void
  folk(view: View, seconds: number): readonly Person[]
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hash01(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35) >>> 0
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

function yawQuat(yaw: number): [number, number, number, number] {
  return [0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5)]
}

const DEFAULT_STYLE: SignStyle = {
  bg: '#1c2432', ink: '#f8f5ec', accent: '#f59e0b', trim: '#0f141d', font: 'bold', glow: true,
}

const SUPERMARKET_AISLES: readonly { num: number; name: string; category: ShoppingAisleZone['category']; module: ModuleKind; items: string[] }[] = [
  { num: 1, name: 'PRODUCE', category: 'produce', module: 'aisle_produce', items: ['Organic Avocados', 'Honeycrisp Apples', 'Baby Spinach', 'Heirloom Tomatoes', 'Bananas'] },
  { num: 2, name: 'BAKERY', category: 'bakery', module: 'aisle_bakery', items: ['SF Sourdough Loaf', 'Almond Croissants', 'Everything Bagels', 'Blueberry Muffins'] },
  { num: 3, name: 'DAIRY & COLD', category: 'dairy', module: 'aisle_dairy', items: ['Oat Milk Half-Gal', 'Pasture Eggs (Fragile)', 'Greek Yogurt', 'Aged Cheddar'] },
  { num: 4, name: 'PANTRY & DRINKS', category: 'pantry', module: 'aisle_pantry', items: ['Sparkling Water 12-Pack', 'Spicy Ramen 4-Pack', 'Olive Oil', 'Espresso Beans'] },
  { num: 5, name: 'SNACKS', category: 'snacks', module: 'aisle_snacks', items: ['Kettle Chips', 'Dark Chocolate Bar', 'Trail Mix', 'Tortilla Chips'] },
]

export function isSupermarketCategory(cat: string): boolean {
  return cat === 'supermarket' || cat === 'grocery' || cat === 'corner_store' || cat === 'market'
}

/** Synthesizes a distinct, non-cookie-cutter interior blueprint from real SF place metadata + brand theme. */
export function synthesizeInteriorBlueprint(place: StorePlaceMeta, driverQueueCount = 2): InteriorBlueprint {
  const seed = hashStr(`${place.id}|${place.name}|${place.x.toFixed(1)},${place.z.toFixed(1)}`)
  const cat = place.category || 'restaurant'
  const style = place.style ?? DEFAULT_STYLE
  const mirror = hash01(seed, 1) > 0.5
  const variant = Math.floor(hash01(seed, 2) * 3)
  const rawW = place.widthM && place.widthM > 4 ? place.widthM : (isSupermarketCategory(cat) ? 13.5 : 8.5)
  const isMarket = isSupermarketCategory(cat)

  // Determine unique architectural archetype, room size, and material palette
  let archetype = 'sf_bistro'
  let widthM = Math.max(7.2, Math.min(12.2, rawW * 0.9 + (hash01(seed, 3) - 0.5) * 1.4))
  let depthM = Math.max(8.5, Math.min(13.5, 9.5 + hash01(seed, 4) * 3.2))
  let heightM = Math.max(3.5, Math.min(4.6, (place.heightM ? Math.min(4.5, place.heightM * 0.42) : 3.8)))

  let floor: FloorStyle = 'wood'
  let wallKind = k(PLASTER, hue(3, 1))
  let wainscotKind = k(WOOD, hue(2, 6))
  let floorKindA = k(WOOD, hue(3, 5))
  let floorKindB = k(WOOD, hue(2, 7))
  let ceilingKind = k(PLASTER, grey(2))
  let accentKind = k(BRICK, hue(1, 5))
  let trimKind = k(STEEL, grey(12))
  let lightColor: [number, number, number] = [1.0, 0.86, 0.66]
  let lightIntensity = 1.4

  const brand = (place.brandId ?? '').toLowerCase()
  if (cat === 'supermarket' || brand === 'whole-foods' || brand === 'target' || brand === 'safeway' || brand === 'trader-joes' || brand === 'costco') {
    archetype = brand === 'whole-foods' ? 'organic_market' : brand === 'trader-joes' ? 'neighborhood_grocer' : brand === 'target' ? 'bright_megamart' : 'city_supermarket'
    widthM = Math.max(12.5, Math.min(16.0, rawW + 2.5))
    depthM = Math.max(13.5, Math.min(16.5, 14.5 + hash01(seed, 5) * 1.8))
    heightM = 4.4
    floor = brand === 'whole-foods' ? 'concrete' : brand === 'trader-joes' ? 'wood' : 'tile'
    wallKind = brand === 'whole-foods' ? k(PLASTER, hue(10, 0)) : brand === 'target' ? k(PLASTER, grey(0)) : k(PLASTER, hue(3, 0))
    wainscotKind = brand === 'whole-foods' ? k(WOOD, hue(2, 5)) : brand === 'target' ? k(PLASTER, hue(0, 5)) : brand === 'trader-joes' ? k(WOOD, hue(1, 6)) : k(CONCRETE, grey(5))
    floorKindA = floor === 'concrete' ? k(CONCRETE, grey(4)) : floor === 'wood' ? k(WOOD, hue(3, 4)) : k(PLASTER, grey(1))
    floorKindB = floor === 'concrete' ? k(CONCRETE, grey(5)) : floor === 'wood' ? k(WOOD, hue(2, 6)) : k(CONCRETE, grey(3))
    accentKind = brand === 'target' || brand === 'safeway' ? k(PLASTER, hue(0, 5)) : k(WOOD, hue(9, 6))
    lightColor = brand === 'whole-foods' || brand === 'trader-joes' ? [1.0, 0.93, 0.80] : [0.94, 0.97, 1.0]
    lightIntensity = 1.75
  } else if (cat === 'grocery' || cat === 'corner_store' || cat === 'market') {
    archetype = 'sf_corner_bodega'
    widthM = Math.max(9.2, Math.min(12.0, rawW))
    depthM = Math.max(10.5, Math.min(13.0, 11.2 + hash01(seed, 5) * 1.5))
    heightM = 3.6
    floor = 'checker'
    wallKind = k(PLASTER, hue(4, 0))
    wainscotKind = k(BRICK, hue(14, 5))
    floorKindA = k(PLASTER, grey(1))
    floorKindB = k(CONCRETE, grey(6))
    accentKind = k(PLASTER, hue(9, 5))
    lightColor = [0.96, 0.96, 0.92]
    lightIntensity = 1.55
  } else if (cat === 'pizza') {
    archetype = variant === 0 ? 'north_beach_pizzeria' : variant === 1 ? 'brick_oven_trattoria' : 'late_night_slice_shop'
    floor = variant === 2 ? 'checker' : 'terrazzo'
    wallKind = k(BRICK, hue(1, 5))
    wainscotKind = k(WOOD, hue(2, 7))
    floorKindA = floor === 'checker' ? k(PLASTER, grey(1)) : k(CONCRETE, hue(3, 2))
    floorKindB = floor === 'checker' ? k(CONCRETE, grey(12)) : k(BRICK, hue(1, 6))
    accentKind = k(PLASTER, hue(0, 5))
    lightColor = [1.0, 0.80, 0.56]
    lightIntensity = 1.55
  } else if (cat === 'burger') {
    archetype = variant === 0 ? 'retro_california_diner' : 'smashburger_counter'
    floor = 'checker'
    wallKind = k(PLASTER, hue(3, 0))
    wainscotKind = k(PLASTER, hue(0, 5))
    floorKindA = k(PLASTER, grey(0))
    floorKindB = k(STEEL, grey(13))
    accentKind = k(PLASTER, hue(4, 3))
    lightColor = [1.0, 0.92, 0.78]
    lightIntensity = 1.65
  } else if (cat === 'coffee' || cat === 'bakery') {
    archetype = cat === 'bakery' ? 'sf_sourdough_bakery' : (variant === 0 ? 'third_wave_roastery' : 'cozy_espresso_lounge')
    floor = variant === 1 ? 'terrazzo' : 'wood'
    wallKind = variant === 0 ? k(PLASTER, hue(3, 0)) : k(PLASTER, hue(10, 1))
    wainscotKind = k(WOOD, hue(2, 5))
    floorKindA = k(WOOD, hue(3, 4))
    floorKindB = k(WOOD, hue(2, 6))
    accentKind = brand === 'starbucks' ? k(PLASTER, hue(10, 6)) : k(WOOD, hue(3, 3))
    lightColor = [1.0, 0.87, 0.68]
    lightIntensity = 1.48
  } else if (cat === 'ice_cream') {
    archetype = 'artisan_gelateria'
    floor = 'tile'
    wallKind = k(PLASTER, hue(22, 0))
    wainscotKind = k(PLASTER, hue(13, 1))
    floorKindA = k(PLASTER, grey(0))
    floorKindB = k(PLASTER, hue(22, 1))
    accentKind = k(PLASTER, hue(22, 4))
    lightColor = [1.0, 0.94, 0.92]
    lightIntensity = 1.65
  } else if (cat === 'bar') {
    archetype = 'sf_neighborhood_tavern'
    floor = 'wood'
    wallKind = k(BRICK, hue(0, 7))
    wainscotKind = k(WOOD, hue(2, 8))
    floorKindA = k(WOOD, hue(2, 8))
    floorKindB = k(WOOD, hue(1, 9))
    accentKind = k(STEEL, hue(3, 5))
    lightColor = [1.0, 0.74, 0.45]
    lightIntensity = 1.35
  } else {
    // Varied SF restaurants: Mission taqueria, Japantown ramen bar, modern California bistro
    const restKinds = ['noodle_ramen_house', 'mission_taqueria', 'modern_sf_bistro'] as const
    archetype = restKinds[variant % restKinds.length]
    floor = archetype === 'modern_sf_bistro' ? 'wood' : archetype === 'mission_taqueria' ? 'tile' : 'concrete'
    wallKind = archetype === 'noodle_ramen_house' ? k(WOOD, hue(2, 7)) : archetype === 'mission_taqueria' ? k(PLASTER, hue(3, 1)) : k(PLASTER, grey(1))
    wainscotKind = archetype === 'mission_taqueria' ? k(BRICK, hue(1, 4)) : k(WOOD, hue(2, 6))
    floorKindA = floor === 'wood' ? k(WOOD, hue(3, 5)) : floor === 'tile' ? k(BRICK, hue(2, 3)) : k(CONCRETE, grey(5))
    floorKindB = floor === 'wood' ? k(WOOD, hue(2, 7)) : floor === 'tile' ? k(PLASTER, hue(3, 1)) : k(CONCRETE, grey(7))
    accentKind = archetype === 'noodle_ramen_house' ? k(PLASTER, hue(0, 5)) : archetype === 'mission_taqueria' ? k(PLASTER, hue(12, 5)) : k(WOOD, hue(9, 6))
    lightColor = archetype === 'noodle_ramen_house' ? [1.0, 0.76, 0.48] : [1.0, 0.88, 0.70]
    lightIntensity = 1.48
  }

  const modules: InteriorModulePlacement[] = []
  const signs: InteriorSignPlacement[] = []
  const npcs: InteriorNpcPlacement[] = []
  const shoppingZones: ShoppingAisleZone[] = []

  const exitPoint: [number, number] = [widthM * 0.5, 1.2]
  let pickupPoint: [number, number] = [widthM * 0.5, depthM - 2.6]

  // Helper to mirror x horizontally so layouts vary organically from shop to shop!
  const mx = (x: number) => (mirror ? widthM - x : x)

  if (isMarket) {
    // ── Functional Multi-Aisle Supermarket / Grocery Layout ──
    const aisleCount = widthM >= 13 ? 4 : 3
    const aisleSpacing = (widthM - 2.8) / aisleCount
    const aisleZ = depthM * 0.54
    for (let i = 0; i < aisleCount; i++) {
      const def = SUPERMARKET_AISLES[i]
      // Viewer entering facing +z sees +x on their LEFT, so start Aisle 1 on the high-x (left) side for natural 1..4 L->R order!
      const ax = widthM - (1.55 + i * aisleSpacing + aisleSpacing * 0.35)
      modules.push({ id: `aisle-${def.num}`, kind: def.module, x: ax, z: aisleZ, yaw: Math.PI * 0.5 })
      // Crisp overhead aisle sign hanging cleanly below ceiling beams
      signs.push({
        id: `aisle-sign-${def.num}`,
        title: `AISLE ${def.num}`,
        subtitle: def.name,
        category: cat,
        x: ax,
        y: heightM - 1.28,
        z: aisleZ - 1.35,
        widthM: 2.05,
        heightM: 0.64,
        yaw: 0,
        both: true,
        style,
      })
      shoppingZones.push({
        id: `zone-${def.num}`,
        aisleNumber: def.num,
        aisleName: def.name,
        category: def.category,
        x: Math.max(1.2, Math.min(widthM - 1.2, ax - 1.05)),
        z: aisleZ,
        items: [...def.items],
      })
    }
    // Produce island right inside the entrance
    modules.push({ id: 'produce-front', kind: 'produce_island', x: mx(widthM * 0.72), z: 3.1, yaw: 0 })
    // Illuminated cold dairy & beverage fridge wall along the back!
    for (let fx = 2.4; fx < widthM - 1.6; fx += 3.2) {
      modules.push({ id: `fridge-${fx.toFixed(1)}`, kind: 'fridge_wall', x: fx, z: depthM - 0.7, yaw: 0 })
    }
    // Checkout lanes near the front left
    const chkX = mx(2.4)
    modules.push({ id: 'checkout-1', kind: 'checkout_lane', x: chkX, z: 3.0, yaw: Math.PI * 0.5 })
    pickupPoint = [chkX + (mirror ? -1.45 : 1.45), 3.0]
    signs.push({
      id: 'market-banner',
      title: place.name.toUpperCase(),
      subtitle: 'AUTO-BUY CHECKOUT · PICKUP',
      category: cat,
      x: widthM * 0.5,
      y: heightM - 0.92,
      z: depthM - 0.36,
      widthM: Math.min(6.2, widthM * 0.50),
      heightM: 1.08,
      yaw: 0,
      style,
    })
    // Supermarket NPCs: cashier worker, stock clerk, browsing shoppers, and fellow DoorSmash shoppers!
    npcs.push({ id: 'worker-cashier', role: 'worker', x: chkX + (mirror ? 0.95 : -0.95), z: 3.1, yaw: mirror ? -Math.PI * 0.5 : Math.PI * 0.5, seed: seed + 11, label: 'Cashier', apronColor: style.bg })
    npcs.push({ id: 'worker-stock', role: 'worker', x: widthM * 0.52, z: depthM - 1.8, yaw: 0, seed: seed + 22, label: 'Clerk', apronColor: style.bg })
    for (let s = 0; s < 3; s++) {
      // Place browsing shoppers along the open aisle corridors so they never spawn inside gondola shelves.
      const zone = shoppingZones[s % shoppingZones.length]
      const sz = zone
        ? Math.max(4.4, Math.min(depthM - 2.4, zone.z + (hash01(seed, 40 + s) - 0.5) * 2.0))
        : 4.5 + hash01(seed, 40 + s) * (depthM - 6.8)
      npcs.push({
        id: `shopper-${s}`,
        role: 'shopper',
        x: zone ? zone.x : 2.0 + hash01(seed, 30 + s) * (widthM - 4.0),
        z: sz,
        yaw: hash01(seed, 50 + s) * Math.PI * 2,
        seed: seed + 100 + s * 17,
      })
    }
    for (let d = 0; d < Math.min(2, driverQueueCount); d++) {
      npcs.push({
        id: `driver-mkt-${d}`,
        role: 'delivery_driver',
        x: Math.max(1.4, Math.min(widthM - 1.4, pickupPoint[0] + (mirror ? -0.15 : 0.15) * d)),
        z: 2.35 + d * 0.95,
        yaw: mirror ? Math.PI * 0.5 : -Math.PI * 0.5,
        seed: seed + 300 + d * 29,
        label: 'Courier',
        packColor: d % 2 === 0 ? '#e63946' : '#2ec4b6',
      })
    }
  } else {
    // ── Non-Cookie-Cutter Restaurant / Pizzeria / Diner / Cafe / Bakery / Gelato Layout ──
    // Leave a full walkable kitchen aisle behind the counter (deeper for the 1.9 m wood-fired pizza oven).
    const counterZ = cat === 'pizza' ? depthM - 3.35 : depthM - 2.65
    const counterKind: ModuleKind =
      cat === 'coffee' ? 'espresso_bar'
      : cat === 'burger' ? 'counter_steel'
      : cat === 'pizza' ? 'counter_tile'
      : cat === 'bakery' ? 'bakery_case'
      : cat === 'ice_cream' ? 'ice_cream_case'
      : variant === 0 ? 'counter_wood' : 'counter_marble'

    modules.push({ id: 'main-counter', kind: counterKind, x: mx(widthM * 0.42), z: counterZ, yaw: 0 })
    // Dedicated DoorSmash pickup rack beside the main counter
    const shelfX = mx(widthM - 1.65)
    modules.push({ id: 'pickup-rack', kind: 'pickup_shelf', x: shelfX, z: counterZ - 0.1, yaw: 0 })
    pickupPoint = [shelfX, counterZ - 1.35]

    // Signature kitchen centerpiece behind the counter!
    if (cat === 'pizza') {
      modules.push({ id: 'hero-oven', kind: 'pizza_oven', x: mx(widthM * 0.34), z: depthM - 1.10, yaw: 0 })
      modules.push({ id: 'wine-wall', kind: 'wine_rack', x: mx(widthM - 1.2), z: depthM - 0.55, yaw: 0 })
    } else if (cat === 'coffee' || cat === 'bakery') {
      modules.push({ id: 'back-case', kind: cat === 'coffee' ? 'bakery_case' : 'espresso_bar', x: mx(widthM * 0.72), z: depthM - 0.90, yaw: 0 })
      modules.push({ id: 'plant-1', kind: 'planter_indoor', x: mx(0.85), z: 1.35, yaw: 0 })
    } else {
      modules.push({ id: 'kitchen-pass', kind: 'kitchen_pass', x: mx(widthM * 0.46), z: depthM - 0.80, yaw: 0 })
      modules.push({ id: 'plant-1', kind: 'planter_indoor', x: mx(0.85), z: 1.35, yaw: 0 })
    }

    // Distinct seating arrangement by archetype (booths vs bistro tables vs window bar!)
    const boothKind: ModuleKind = cat === 'burger' ? 'booth_red' : archetype === 'mission_taqueria' ? 'booth_teal' : 'booth_tan'
    const seatWallX = mx(1.35)
    if (cat === 'burger' || cat === 'pizza' || variant === 1) {
      for (let b = 0; b < 2; b++) {
        const bz = 3.2 + b * 2.55
        if (bz < counterZ - 1.8) {
          modules.push({ id: `booth-${b}`, kind: boothKind, x: seatWallX, z: bz, yaw: 0 })
          npcs.push({
            id: `patron-booth-${b}`,
            role: 'patron_sit',
            x: seatWallX,
            z: bz - 0.65,
            yaw: Math.PI,
            seed: seed + 50 + b * 23,
          })
        }
      }
    } else {
      for (let t = 0; t < 2; t++) {
        const tz = 3.0 + t * 2.4
        if (tz < counterZ - 1.8) {
          modules.push({ id: `bistro-${t}`, kind: 'table_bistro', x: mx(1.85), z: tz, yaw: 0 })
          npcs.push({
            id: `patron-bistro-${t}`,
            role: 'patron_sit',
            x: mx(1.25),
            z: tz,
            yaw: mirror ? -Math.PI * 0.5 : Math.PI * 0.5,
            seed: seed + 70 + t * 19,
          })
        }
      }
    }
    // Window stool bar near the front storefront glass
    if (widthM >= 8.2) {
      modules.push({ id: 'window-bar', kind: 'stool_bar', x: mx(widthM - 2.0), z: 1.3, yaw: 0 })
    }

    // Hanging overhead lighting fixtures (lanterns for ramen/noodle/taco spots, industrial pendants elsewhere)
    const lampKind: ModuleKind = archetype === 'noodle_ramen_house' ? 'lantern_cluster' : 'pendant_lamp'
    for (const lx of [widthM * 0.30, widthM * 0.68]) {
      modules.push({ id: `lamp-${lx.toFixed(1)}`, kind: lampKind, x: lx, y: heightM - 1.05, z: depthM * 0.45, yaw: 0 })
    }

    // Crisp 3D Menu Board + DoorSmash Pickup Sign
    signs.push({
      id: 'menu-board',
      title: place.name.toUpperCase(),
      subtitle: cat === 'pizza' ? 'WOOD-FIRED PIES · SLICES' : cat === 'burger' ? 'SMASHBURGERS · FRIES · SHAKES' : cat === 'coffee' ? 'ESPRESSO · POUR OVER · PASTRIES' : 'FRESH KITCHEN · ORDER HERE',
      category: cat,
      x: mx(widthM * 0.42),
      y: heightM - 1.02,
      z: depthM - 0.34,
      widthM: Math.min(4.4, widthM * 0.52),
      heightM: 0.96,
      yaw: 0,
      style,
    })
    signs.push({
      id: 'pickup-banner',
      title: 'DOORSMASH PICKUP',
      subtitle: 'MOBILE ORDERS',
      category: cat,
      x: shelfX,
      y: 2.68,
      z: counterZ - 0.15,
      widthM: 1.95,
      heightM: 0.54,
      yaw: 0,
      style: { bg: '#c81928', ink: '#ffffff', accent: '#ffd166', trim: '#7a0d16', font: 'bold', glow: true },
    })

    // NPC Workers behind the counter (yaw 0 faces -z toward customers at the entrance)
    npcs.push({ id: 'worker-main', role: 'worker', x: mx(widthM * 0.42), z: counterZ + 0.80, yaw: 0, seed: seed + 9, label: 'Staff', apronColor: style.bg })
    if (widthM >= 8.2) {
      npcs.push({ id: 'worker-cook', role: 'worker', x: mx(widthM * 0.28), z: counterZ + 0.86, yaw: 0, seed: seed + 17, label: 'Chef', apronColor: '#f3f4f6' })
    }

    // Line of waiting NPC delivery drivers holding phones beside the pickup rack (staggered so labels stay crisp!)
    const qCount = Math.max(1, Math.min(4, driverQueueCount))
    for (let d = 0; d < qCount; d++) {
      const qx = Math.max(1.2, Math.min(widthM - 1.2, shelfX + (mirror ? 0.55 : -0.55) + (d % 2 === 0 ? 0.35 : -0.35)))
      const qz = Math.max(2.3, counterZ - 1.35 - d * 0.95)
      npcs.push({
        id: `queue-driver-${d}`,
        role: 'delivery_driver',
        x: qx,
        z: qz,
        yaw: Math.PI,
        seed: seed + 200 + d * 31,
        label: d === 0 ? 'Driver' : undefined,
        packColor: d % 3 === 0 ? '#e63946' : d % 3 === 1 ? '#f59e0b' : '#2ec4b6',
      })
    }
  }

  // Exit sign over the glass front door (faces inward +z)
  signs.push({
    id: 'exit-sign',
    title: 'EXIT TO STREET',
    subtitle: 'PRESS E AT DOOR',
    category: 'service',
    x: exitPoint[0],
    y: 2.62,
    z: 0.28,
    widthM: 1.5,
    heightM: 0.36,
    yaw: Math.PI,
    style: { bg: '#111827', ink: '#6ee7b7', accent: '#10b981', trim: '#064e3b', font: 'bold', glow: true },
  })

  return {
    id: `proc:${place.id}`,
    version: 1,
    source: 'procedural',
    archetype,
    name: place.name,
    category: cat,
    brandId: place.brandId ?? null,
    room: { widthM: Math.round(widthM * 10) / 10, depthM: Math.round(depthM * 10) / 10, heightM: Math.round(heightM * 10) / 10 },
    theme: { floor, wallKind, wainscotKind, floorKindA, floorKindB, ceilingKind, accentKind, trimKind, lightColor, lightIntensity },
    modules,
    signs,
    npcs,
    shoppingZones,
    pickupPoint,
    exitPoint,
  }
}

export function createInteriorSystem(opts: InteriorSystemOptions): InteriorSystem {
  const overrides = new Map<string, InteriorBlueprint>()
  let signsPass: StorefrontSigns | null = null
  let pendingSigns: SignSpec[] | null = null
  void createStorefrontSigns(opts.device, opts.format).then((sp) => {
    signsPass = sp
    if (pendingSigns) {
      sp.sync(pendingSigns)
      pendingSigns = null
    }
  }).catch(() => {})
  const moduleKit = getInteriorModuleKit()

  let active = false
  let currentBp: InteriorBlueprint | null = null
  let currentPlace: StorePlaceMeta | null = null
  let currentEnter: InteriorEnterOptions | null = null
  let roomOrigin: [number, number, number] = [0, INTERIOR_ALT_CELLS, 0] // world cells
  let streetAnchor: [number, number, number] | null = null
  let spawnedPieces: Piece[] = []
  let cartPiece: Piece | null = null
  let cartItemsShown = -1
  let colliders: { x0: number; x1: number; z0: number; z1: number }[] = []
  let localX = 4, localZ = 2
  let walkBob = 0
  let leaveInput: (() => void) | null = null
  let activeCue: { remove(): void; text: string } | null = null
  let cueKey = ''
  let lastAction: (() => void) | null = null
  const folkBuf: Person[] = []

  const keyVariants = (place: StorePlaceMeta): string[] => {
    const out = [place.id.toLowerCase(), place.name.toLowerCase()]
    if (place.brandId) out.push(`brand:${place.brandId.toLowerCase()}`)
    return out
  }

  const blueprintFor = (place: StorePlaceMeta, driverQueueCount = 2): InteriorBlueprint => {
    for (const kStr of keyVariants(place)) {
      const hit = overrides.get(kStr)
      if (hit) {
        const title = place.name.toUpperCase()
        return {
          ...hit,
          name: place.name,
          signs: hit.signs.map((s) => (s.id === 'menu-board' || s.id === 'market-banner') ? { ...s, title } : s),
        }
      }
    }
    return synthesizeInteriorBlueprint(place, driverQueueCount)
  }

  const clearCue = () => {
    activeCue?.remove()
    activeCue = null
    cueKey = ''
    lastAction = null
  }

  const clearScene = () => {
    clearCue()
    for (const pc of spawnedPieces) pc.destroy()
    spawnedPieces = []
    if (cartPiece) { cartPiece.destroy(); cartPiece = null }
    cartItemsShown = -1
    pendingSigns = null
    signsPass?.clear()
    colliders = []
  }

  const toWorldCells = (lx: number, ly: number, lz: number): [number, number, number] => [
    roomOrigin[0] + lx * M,
    roomOrigin[1] + ly * M,
    roomOrigin[2] + lz * M,
  ]

  const syncCartMesh = () => {
    if (!active || !currentEnter?.shopping) {
      if (cartPiece) { cartPiece.destroy(); cartPiece = null; cartItemsShown = -1 }
      return
    }
    const collected = currentEnter.shopping.items.filter((i) => i.collected).length
    if (cartPiece && cartItemsShown === collected) return
    if (cartPiece) cartPiece.destroy()
    const asset = buildShoppingCartAsset(collected)
    cartPiece = opts.pieces.add(asset.born, true)
    cartPiece.cell = asset.cell
    cartItemsShown = collected
  }

  const buildScene = (bp: InteriorBlueprint) => {
    clearScene()
    // 1. Room shell
    const shell = buildRoomShellAsset(bp)
    const shellPc = opts.pieces.add(shell.born, false)
    shellPc.pos = [...roomOrigin]
    shellPc.rot = [0, 0, 0, 1]
    shellPc.cell = shell.cell
    spawnedPieces.push(shellPc)

    // 2. Modular furniture & fixtures
    for (const m of bp.modules) {
      const asset = moduleKit[m.kind]
      if (!asset) continue
      const pc = opts.pieces.add(asset.born, true)
      const yaw = m.yaw ?? 0
      pc.pos = toWorldCells(m.x, m.y ?? 0.1, m.z)
      pc.rot = yawQuat(yaw)
      pc.cell = asset.cell
      spawnedPieces.push(pc)
      if (asset.solid) {
        const rotated = Math.abs(Math.sin(yaw)) > 0.5
        const hx = m.collider ? m.collider[0] : (rotated ? asset.halfZ : asset.halfX)
        const hz = m.collider ? m.collider[1] : (rotated ? asset.halfX : asset.halfZ)
        colliders.push({ x0: m.x - hx - 0.12, x1: m.x + hx + 0.12, z0: m.z - hz - 0.12, z1: m.z + hz + 0.12 })
      }
    }

    // 3. Crisp 3D signs (menu boards, aisle numbers, pickup banner, exit sign)
    const signSpecs: SignSpec[] = bp.signs.map((s) => {
      // Forward normal: yaw=0 faces -z (toward front entrance), yaw=PI faces +z.
      // Viewer looking at sign (viewDir = -normal): viewer's right = cross(-normal, up) = (nz, 0, -nx).
      const nx = Math.sin(s.yaw), nz = -Math.cos(s.yaw)
      const rx = nz, rz = -nx
      return {
        id: `int:${bp.id}:${s.id}`,
        title: s.title,
        subtitle: s.subtitle,
        category: s.category,
        kind: 'fascia',
        at: toWorldCells(s.x, s.y, s.z),
        hu: [rx * s.widthM * 0.5 * M, 0, rz * s.widthM * 0.5 * M],
        hv: [0, s.heightM * 0.5 * M, 0],
        normal: [nx, 0, nz],
        both: s.both ?? false,
        style: s.style,
      }
    })
    if (signsPass) signsPass.sync(signSpecs)
    else pendingSigns = signSpecs
    syncCartMesh()
  }

  const enter = (enterOpts: InteriorEnterOptions): InteriorBlueprint => {
    if (active) exit()
    const bp = blueprintFor(enterOpts.place, enterOpts.driverQueueCount ?? 2)
    currentBp = bp
    currentPlace = enterOpts.place
    currentEnter = enterOpts
    active = true
    roomOrigin = [Math.round(enterOpts.place.x * M), INTERIOR_ALT_CELLS, Math.round(enterOpts.place.z * M)]
    streetAnchor = [Math.round(enterOpts.returnPose.x * M), Math.round(enterOpts.returnPose.y * M), Math.round(enterOpts.returnPose.z * M)]
    localX = bp.exitPoint[0]
    localZ = Math.min(bp.room.depthM - 1.5, bp.exitPoint[1] + 0.55)
    walkBob = 0
    buildScene(bp)

    // Place camera smoothly inside the front door looking into the store
    opts.pose.x = (roomOrigin[0] + localX * M) / M
    opts.pose.y = (roomOrigin[1] + 17.5) / M
    opts.pose.z = (roomOrigin[2] + localZ * M) / M
    opts.pose.yaw = Math.PI // looking +z into the interior
    opts.pose.pitch = -0.04
    opts.pose.tilt = undefined

    leaveInput = opts.input.push({
      name: 'interior',
      solid: true,
      key: (code) => {
        if (code === 'KeyE') {
          lastAction?.()
          return true
        }
        if (code === 'Backspace') {
          exit()
          return true
        }
        return false
      },
    })
    opts.onSfx?.('door')
    opts.onEnterChanged?.(true, enterOpts.place)
    opts.hud.notice(`Entered ${bp.name} · walk with WASD · E to interact`, 3800)
    return bp
  }

  const exit = () => {
    if (!active) return
    const ret = currentEnter?.returnPose
    const cb = currentEnter?.onExit
    active = false
    leaveInput?.()
    leaveInput = null
    clearScene()
    currentBp = null
    currentPlace = null
    currentEnter = null
    streetAnchor = null
    if (ret) {
      opts.pose.x = ret.x
      opts.pose.y = ret.y
      opts.pose.z = ret.z
      opts.pose.yaw = ret.yaw
      opts.pose.pitch = -0.06
    }
    opts.onSfx?.('door')
    opts.onEnterChanged?.(false, null)
    cb?.()
  }

  const collides = (x: number, z: number): boolean => {
    if (!currentBp) return true
    if (x < WALL_PAD || x > currentBp.room.widthM - WALL_PAD || z < WALL_PAD || z > currentBp.room.depthM - WALL_PAD) return true
    for (const c of colliders) {
      if (x + 0.34 > c.x0 && x - 0.34 < c.x1 && z + 0.34 > c.z0 && z - 0.34 < c.z1) return true
    }
    return false
  }

  const frame = (dt: number): boolean => {
    if (!active || !currentBp) return false
    syncCartMesh()

    // 1. Mouse / touch look + WASD walk inside the 3D interior
    const [turnR, turnU] = opts.input.turn()
    opts.pose.yaw += turnR
    opts.pose.pitch = Math.max(-1.15, Math.min(1.15, opts.pose.pitch + turnU))

    const fwd = (opts.input.held('KeyW') ? 1 : 0) - (opts.input.held('KeyS') ? 1 : 0) - opts.input.stick[1]
    const side = (opts.input.held('KeyD') ? 1 : 0) - (opts.input.held('KeyA') ? 1 : 0) + opts.input.stick[0]
    const mag = Math.hypot(fwd, side)
    const speed = (opts.input.held('ShiftLeft') || opts.input.held('ShiftRight') ? 4.4 : 2.75) * dt
    if (mag > 0.05) {
      const nf = fwd / Math.max(1, mag), ns = side / Math.max(1, mag)
      const fx = Math.sin(opts.pose.yaw), fz = -Math.cos(opts.pose.yaw)
      const rx = Math.cos(opts.pose.yaw), rz = Math.sin(opts.pose.yaw)
      const dx = (fx * nf + rx * ns) * speed
      const dz = (fz * nf + rz * ns) * speed
      if (!collides(localX + dx, localZ)) localX += dx
      if (!collides(localX, localZ + dz)) localZ += dz
      walkBob += dt * 9.5
    }

    const bobY = mag > 0.05 ? Math.sin(walkBob) * 0.035 : 0
    opts.pose.x = (roomOrigin[0] + localX * M) / M
    opts.pose.y = (roomOrigin[1] + (1.72 + bobY) * M) / M
    opts.pose.z = (roomOrigin[2] + localZ * M) / M

    // Update rolling 3D shopping cart slightly ahead of the player in supermarkets!
    if (cartPiece) {
      const fx = Math.sin(opts.pose.yaw), fz = -Math.cos(opts.pose.yaw)
      const cx = Math.max(0.7, Math.min(currentBp.room.widthM - 0.7, localX + fx * 1.15))
      const cz = Math.max(0.7, Math.min(currentBp.room.depthM - 0.7, localZ + fz * 1.15))
      cartPiece.pos = toWorldCells(cx, 0.1, cz)
      cartPiece.rot = yawQuat(-opts.pose.yaw + Math.PI * 0.5)
    }

    // 2. Contextual interaction cues inside the room (exit door, shopping shelf auto-buy, or pickup counter)
    let wantKey = ''
    let wantText = ''
    let wantAt: [number, number, number] = toWorldCells(localX, 1.5, localZ)
    let wantAct: (() => void) | null = null

    const distExit = Math.hypot(localX - currentBp.exitPoint[0], localZ - currentBp.exitPoint[1])
    if (distExit < 1.95) {
      wantKey = 'exit'
      wantText = `E  Exit ${currentBp.name}`
      wantAt = toWorldCells(currentBp.exitPoint[0], 1.75, 0.45)
      wantAct = exit
    }

    // Check active supermarket aisle items first!
    const shopTask = currentEnter?.shopping
    if (shopTask) {
      let bestDist = 2.65
      for (const z of currentBp.shoppingZones) {
        const pending = shopTask.items.find((it) => !it.collected && it.aisleNumber === z.aisleNumber)
        if (!pending) continue
        const d = Math.hypot(localX - z.x, localZ - z.z)
        if (d < bestDist) {
          bestDist = d
          wantKey = `shop:${pending.id}`
          wantText = `E  Take ${pending.name} (Aisle ${z.aisleNumber} · Auto-Buy)`
          wantAt = toWorldCells(z.x, 1.45, z.z)
          wantAct = () => {
            opts.onSfx?.('scan')
            shopTask.onCollect(pending.id)
          }
        }
      }
    }

    // Check restaurant pickup counter (or supermarket checkout once all items are collected!)
    const pk = currentEnter?.pickupOrder
    if (pk && !wantKey.startsWith('shop:')) {
      const distPk = Math.hypot(localX - currentBp.pickupPoint[0], localZ - currentBp.pickupPoint[1])
      const shopDone = !shopTask || shopTask.items.every((i) => i.collected)
      if (distPk < 2.6 && shopDone) {
        if (pk.ready) {
          wantKey = `pickup:${pk.orderId}:ready`
          wantText = `E  Pick up ${pk.label}`
          wantAt = toWorldCells(currentBp.pickupPoint[0], 1.55, currentBp.pickupPoint[1] + 0.5)
          wantAct = pk.onPickup
        } else {
          const secs = Math.max(1, Math.ceil(pk.delayRemainingS ?? 5))
          wantKey = `pickup:${pk.orderId}:wait:${secs}`
          wantText = `E  Ask staff (${pk.delayReason ?? 'Still prepping'} · ${secs}s)`
          wantAt = toWorldCells(currentBp.pickupPoint[0], 1.55, currentBp.pickupPoint[1] + 0.5)
          wantAct = () => pk.onNudge?.()
        }
      }
    }

    if (wantKey !== cueKey) {
      clearCue()
      if (wantKey && wantAct) {
        cueKey = wantKey
        lastAction = wantAct
        const pos = wantAt
        const act = wantAct
        activeCue = opts.hud.cue(wantText, () => pos, act)
      }
    }
    return true
  }

  const lights = (sink: LocalLightSink) => {
    if (!active || !currentBp) return
    const { widthM, depthM, heightM } = currentBp.room
    const [r, g, b] = currentBp.theme.lightColor
    const str = currentBp.theme.lightIntensity
    const pts: [number, number][] = [
      [widthM * 0.30, depthM * 0.32],
      [widthM * 0.70, depthM * 0.32],
      [widthM * 0.30, depthM * 0.70],
      [widthM * 0.70, depthM * 0.70],
    ]
    for (const [lx, lz] of pts) {
      const [wx, wy, wz] = toWorldCells(lx, heightM - 0.75, lz)
      sink.addPoint(wx, wy, wz, r * str * 1.45, g * str * 1.45, b * str * 1.45, 95, 38, 0.85, 96, LIGHT_EXTRA)
    }
    // Warm glow from pizza oven if present!
    for (const m of currentBp.modules) {
      if (m.kind === 'pizza_oven') {
        const [wx, wy, wz] = toWorldCells(m.x, 1.3, m.z - 0.4)
        sink.addPoint(wx, wy, wz, 2.4, 0.92, 0.25, 55, 22, 0.65, 95, LIGHT_EXTRA)
      }
    }
  }

  const folk = (_view: View, seconds: number): readonly Person[] => {
    folkBuf.length = 0
    if (!active || !currentBp) return folkBuf
    for (const npc of currentBp.npcs) {
      const phase = hash01(npc.seed, 1) * 10
      const p: Person = {
        at: toWorldCells(npc.x, 0.1, npc.z),
        yaw: npc.yaw,
        seed: npc.seed,
        time: seconds + phase,
        glance: Math.sin(seconds * 0.7 + phase) * 0.35,
        name: npc.label,
      }
      if (npc.role === 'worker') {
        p.look = {
          wear: ['shirt #f4f4f0', `apron ${npc.apronColor ?? '#1f2937'}`, 'cap #111827'],
        }
        if (currentEnter?.pickupOrder && !currentEnter.pickupOrder.ready && npc.id === 'worker-main') {
          p.says = currentEnter.pickupOrder.delayReason ?? 'Just 2 more mins, bro!'
        }
      } else if (npc.role === 'delivery_driver') {
        p.reading = 0.92
        p.look = {
          coat: '#1e293b',
          wear: ['jacket', 'helmet #111827', 'vest #eab308'],
          carry: 'phone',
          extra: [
            // Oversized insulated DoorSmash thermal backpack!
            { on: 'chest', at: [0, 2.7, 2.25], size: [3.6, 4.4, 2.4], colour: npc.packColor ?? '#e63946', shiny: true },
          ],
        }
        if (currentEnter?.pickupOrder && !currentEnter.pickupOrder.ready && npc.id.endsWith('-0')) {
          p.says = 'Been waiting 10 mins...'
        }
      } else if (npc.role === 'patron_sit') {
        p.move = { move: NAMED.sit, t: 5 }
      } else if (npc.role === 'shopper') {
        p.reading = hash01(npc.seed, 3) > 0.5 ? 0.75 : 0
      }
      folkBuf.push(p)
    }
    return folkBuf
  }

  // Register 2 signature built-in brand blueprints showing exact 1:1 customizable interior power!
  overrides.set('brand:whole-foods', synthesizeInteriorBlueprint({
    id: 'sig:whole-foods', name: 'Whole Moods Market', category: 'supermarket', brandId: 'whole-foods', x: 0, z: 0, widthM: 15, heightM: 12,
    style: { bg: '#154734', ink: '#f5f7ef', accent: '#7bc143', trim: '#0c2b1f', font: 'serif', glow: true },
  }, 2))
  overrides.set('brand:dominos', synthesizeInteriorBlueprint({
    id: 'sig:dominos', name: 'Dominoes Pizza', category: 'pizza', brandId: 'dominos', x: 0, z: 0, widthM: 9.5, heightM: 9,
    style: { bg: '#006491', ink: '#ffffff', accent: '#e31837', trim: '#003f5c', font: 'bold', glow: true },
  }, 3))

  return {
    get active() { return active },
    get currentBlueprint() { return currentBp },
    get currentPlace() { return currentPlace },
    get streetAnchor() { return streetAnchor },
    blueprintFor,
    registerOverride(key, bp) {
      overrides.set(key.toLowerCase(), { ...bp, source: bp.source === 'procedural' ? 'custom-1to1' : bp.source })
    },
    listOverrides() {
      return [...overrides.keys()]
    },
    exportBlueprint(place) {
      return JSON.stringify(blueprintFor(place), null, 2)
    },
    importBlueprint(key, json) {
      const parsed = JSON.parse(json) as InteriorBlueprint
      if (!parsed || parsed.version !== 1 || !parsed.room || !Array.isArray(parsed.modules)) {
        throw new Error('Invalid InteriorBlueprint JSON (expected version 1 with room and modules)')
      }
      overrides.set(key.toLowerCase(), parsed)
      return parsed
    },
    enter,
    updatePickup(info) {
      if (currentEnter) currentEnter.pickupOrder = info
    },
    updateShopping(task) {
      if (currentEnter) {
        currentEnter.shopping = task ?? undefined
        syncCartMesh()
      }
    },
    exit,
    frame,
    lights,
    prepareSigns(to, view, sun, day, dull) {
      if (!active || !signsPass) return false
      return signsPass.prepare(to, view, sun, day, dull, null)
    },
    recordSigns(pass) {
      if (!active || !signsPass) return
      signsPass.record(pass)
    },
    folk,
  }
}
