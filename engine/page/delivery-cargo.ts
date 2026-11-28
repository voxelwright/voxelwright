// Death Stranding–style Delivery Cargo Bay: spatial stacking, orientation rules, lid sealing,
// liquid spill cross-contamination, weight crushing, and directional vehicle collision physics.
import { cargoGridSizeFor, getVehicleDef, type DeliveryVehicleId, type VehicleUpgrades } from './delivery-vehicles.ts'

export type FoodItemKind =
  | 'pizza'
  | 'soup'
  | 'drink'
  | 'burger'
  | 'sushi'
  | 'tacos'
  | 'pastry'
  | 'ice_cream'
  | 'groceries_heavy'
  | 'groceries_fragile'

export type SlotRole = 'normal' | 'liquid' | 'thermal'

export interface CargoItem {
  id: string
  orderId: string
  orderLabel: string
  name: string
  emoji: string
  kind: FoodItemKind
  /** Footprint when flat/upright: pizza is 2x1, heavy groceries 2x1, soup/drink 1x1, etc. */
  baseW: number
  baseH: number
  /** Rotated 90°: for pizza, rotated=true means VERTICAL (1x2) -> ruins pizza! For soup/drink, rotated=true means TIPPED ON SIDE! */
  rotated: boolean
  /** Grid position in cargo bay (null = loose/unpacked tray!). Row 0 is TOP of stack, row (rows-1) is FLOOR. */
  x: number | null
  y: number | null
  /** Weight 1 (light) .. 5 (heavy water case). Heavy items above fragile items crush them! */
  weight: number
  fragile: boolean
  isLiquid: boolean
  /** Soups & drinks start unsealed at pickup — driver must seal them or risk spilling & ruining other orders! */
  sealed: boolean
  hot: boolean
  cold: boolean
  /** 0..100 food quality/condition. */
  integrity: number
  /** 0..100 thermal score (100 = piping hot or frozen cold; drops over time). */
  temp: number
  /** 0 = untouched, 0.5 = half eaten, 1 = completely devoured by the driver! */
  eaten: number
  /** True if ruined by a neighboring spilled soup/drink. */
  contaminated: boolean
  /** True if a pizza was rotated vertical. */
  verticalRuined: boolean
  /** Name of heavy item currently crushing this item from above, if any. */
  crushedBy: string | null
  /** Human-readable warning note if currently packed unsafely. */
  hazard: string | null
}

export interface CargoImpactEvent {
  /** Local impact vector normalized to vehicle half-extents: fwd (+front/-rear), right (+right/-left), up. */
  localFwd: number
  localRight: number
  localUp: number
  /** Closing speed in world cells/sec (10 cells/s = 1 m/s). */
  speedCells: number
}

export interface CargoImpactReport {
  severity: 'bump' | 'hard' | 'wreck'
  zone: 'front' | 'rear' | 'left' | 'right' | 'bottom'
  damagedItems: { id: string; name: string; delta: number; integrity: number }[]
  spilledIds: string[]
  contaminatedIds: string[]
  totalDamage: number
}

export interface CargoBayState {
  cols: number
  rows: number
  slots: SlotRole[]
  items: CargoItem[]
  warnings: string[]
  looseCount: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export function itemDims(item: Pick<CargoItem, 'baseW' | 'baseH' | 'rotated'>): [number, number] {
  return item.rotated ? [item.baseH, item.baseW] : [item.baseW, item.baseH]
}

export class CargoBay {
  cols = 2
  rows = 2
  slots: SlotRole[] = []
  items: CargoItem[] = []
  private vehicleId: DeliveryVehicleId = 'scooter'
  private upgrades: VehicleUpgrades = {
    paint: 'crimson', lighting: 'stock', cargoRack: 0, pizzaWarmer: 0, liquidMount: 0, fragileShock: 0,
  }

  constructor(vehicleId: DeliveryVehicleId, up: VehicleUpgrades) {
    this.configure(vehicleId, up)
  }

  configure(vehicleId: DeliveryVehicleId, up: VehicleUpgrades): void {
    this.vehicleId = vehicleId
    this.upgrades = { ...up }
    const [cols, rows] = cargoGridSizeFor(vehicleId, up)
    this.cols = cols
    this.rows = rows
    this.slots = new Array<SlotRole>(cols * rows).fill('normal')
    if (up.pizzaWarmer > 0) {
      // Top shelf becomes the heated flat thermal pizza deck.
      for (let x = 0; x < cols; x++) this.slots[x] = 'thermal'
    }
    if (up.liquidMount > 0) {
      // Bottom-right cells become gimballed spill-proof drink/soup holders.
      const bottomY = rows - 1
      this.slots[bottomY * cols + (cols - 1)] = 'liquid'
      if (cols >= 3) this.slots[bottomY * cols + (cols - 2)] = 'liquid'
    }
    // Any item that no longer fits after downgrading/switching to a smaller vehicle goes to loose tray.
    for (const item of this.items) {
      if (item.x === null || item.y === null) continue
      const [w, h] = itemDims(item)
      if (item.x < 0 || item.y < 0 || item.x + w > cols || item.y + h > rows) {
        item.x = null
        item.y = null
      }
    }
    this.recomputeHazards()
  }

  slotRole(x: number, y: number): SlotRole {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return 'normal'
    return this.slots[y * this.cols + x] ?? 'normal'
  }

  getItem(id: string): CargoItem | undefined {
    return this.items.find((i) => i.id === id)
  }

  itemsForOrder(orderId: string): CargoItem[] {
    return this.items.filter((i) => i.orderId === orderId)
  }

  removeOrder(orderId: string): CargoItem[] {
    const removed = this.items.filter((i) => i.orderId === orderId)
    this.items = this.items.filter((i) => i.orderId !== orderId)
    this.recomputeHazards()
    return removed
  }

  canPlace(itemId: string | null, x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0 || x + w > this.cols || y + h > this.rows) return false
    for (const other of this.items) {
      if (other.id === itemId || other.x === null || other.y === null) continue
      const [ow, oh] = itemDims(other)
      const overlap = x < other.x + ow && x + w > other.x && y < other.y + oh && y + h > other.y
      if (overlap) return false
    }
    return true
  }

  /**
   * Adds an item to the bay, placing it safely in the best open slot when possible (e.g., flat pizza on thermal deck,
   * liquids in liquid mount, heavy bags on bottom floor). If the bay is packed full, leaves it in the loose tray
   * so the player can Tetris/rotate/manage space!
   */
  addItem(item: CargoItem, preferAutoPack = true): boolean {
    this.items.push(item)
    if (preferAutoPack) {
      this.autoPlaceItem(item)
    }
    this.recomputeHazards()
    return item.x !== null
  }

  autoPlaceItem(item: CargoItem): boolean {
    const [w, h] = itemDims(item)
    let best: { x: number; y: number; score: number } | null = null
    for (let y = 0; y <= this.rows - h; y++) {
      for (let x = 0; x <= this.cols - w; x++) {
        if (!this.canPlace(item.id, x, y, w, h)) continue
        let score = 0
        const role = this.slotRole(x, y)
        if (item.isLiquid && role === 'liquid') score += 50
        if (item.kind === 'pizza' && !item.rotated && role === 'thermal') score += 50
        if (item.hot && role === 'thermal') score += 18
        // Heavy items strongly prefer bottom row (high y) so they don't crush fragile items!
        if (item.weight >= 3) score += y * 15
        // Fragile items prefer top rows (low y) so heavy items aren't above them!
        if (item.fragile) score += (this.rows - 1 - y) * 14
        if (!best || score > best.score) best = { x, y, score }
      }
    }
    if (best) {
      item.x = best.x
      item.y = best.y
      this.recomputeHazards()
      return true
    }
    item.x = null
    item.y = null
    this.recomputeHazards()
    return false
  }

  moveItem(itemId: string, x: number, y: number): boolean {
    const item = this.getItem(itemId)
    if (!item) return false
    const [w, h] = itemDims(item)
    if (!this.canPlace(item.id, x, y, w, h)) return false
    item.x = x
    item.y = y
    this.recomputeHazards()
    return true
  }

  /** Rotates an item 90°. Rotating a pizza vertical (1x2) or tipping a liquid sideways is allowed — and dangerous! */
  rotateItem(itemId: string): boolean {
    const item = this.getItem(itemId)
    if (!item) return false
    const nextRot = !item.rotated
    const [nw, nh] = itemDims({ baseW: item.baseW, baseH: item.baseH, rotated: nextRot })
    if (item.x !== null && item.y !== null) {
      if (this.canPlace(item.id, item.x, item.y, nw, nh)) {
        item.rotated = nextRot
        if (item.kind === 'pizza' && item.rotated) {
          item.verticalRuined = true
          item.integrity = Math.max(15, item.integrity - 38)
        }
        this.recomputeHazards()
        return true
      }
      // Try finding any valid slot in the rotated orientation
      for (let y = 0; y <= this.rows - nh; y++) {
        for (let x = 0; x <= this.cols - nw; x++) {
          if (this.canPlace(item.id, x, y, nw, nh)) {
            item.rotated = nextRot
            item.x = x
            item.y = y
            if (item.kind === 'pizza' && item.rotated) {
              item.verticalRuined = true
              item.integrity = Math.max(15, item.integrity - 38)
            }
            this.recomputeHazards()
            return true
          }
        }
      }
      return false
    }
    item.rotated = nextRot
    if (item.kind === 'pizza' && item.rotated) {
      item.verticalRuined = true
      item.integrity = Math.max(15, item.integrity - 38)
    }
    this.recomputeHazards()
    return true
  }

  /** Seals a soup/drink lid tightly. */
  sealItem(itemId: string): boolean {
    const item = this.getItem(itemId)
    if (!item || !item.isLiquid || item.sealed) return false
    item.sealed = true
    this.recomputeHazards()
    return true
  }

  /** Driver eats the customer's food! Returns true if eaten. */
  eatItem(itemId: string): boolean {
    const item = this.getItem(itemId)
    if (!item || item.eaten >= 1) return false
    item.eaten = item.eaten < 0.5 ? 0.5 : 1
    item.integrity = item.eaten >= 1 ? 0 : Math.min(item.integrity, 25)
    this.recomputeHazards()
    return true
  }

  /** Finds all items sharing an edge (orthogonally adjacent) or overlapping in the loose tray. */
  private neighborsOf(src: CargoItem): CargoItem[] {
    if (src.x === null || src.y === null) {
      // Loose items sit piled together — a loose spill ruins other loose items!
      return this.items.filter((o) => o.id !== src.id && (o.x === null || o.y === null))
    }
    const [sw, sh] = itemDims(src)
    const out: CargoItem[] = []
    for (const o of this.items) {
      if (o.id === src.id || o.x === null || o.y === null) continue
      const [ow, oh] = itemDims(o)
      const xTouch = src.x <= o.x + ow && src.x + sw >= o.x
      const yTouch = src.y <= o.y + oh && src.y + sh >= o.y
      const cornerOnly = (src.x === o.x + ow || o.x === src.x + sw) && (src.y === o.y + oh || o.y === src.y + sh)
      if (xTouch && yTouch && !cornerOnly) out.push(o)
    }
    return out
  }

  recomputeHazards(): string[] {
    const warnings: string[] = []
    for (const item of this.items) {
      item.crushedBy = null
      item.hazard = null
    }

    // Check heavy-on-fragile vertical crushing (row 0 is top, larger y is lower).
    for (const top of this.items) {
      if (top.x === null || top.y === null || top.weight < 3) continue
      const [tw, th] = itemDims(top)
      for (const bot of this.items) {
        if (bot.id === top.id || bot.x === null || bot.y === null || !bot.fragile) continue
        const [bw] = itemDims(bot)
        const colOverlap = top.x < bot.x + bw && top.x + tw > bot.x
        const directlyAbove = top.y + th <= bot.y
        if (colOverlap && directlyAbove) {
          bot.crushedBy = top.name
        }
      }
    }

    for (const item of this.items) {
      if (item.eaten >= 1) {
        item.hazard = 'Eaten by you!'
      } else if (item.eaten > 0) {
        item.hazard = 'Half eaten!'
      } else if (item.kind === 'pizza' && item.rotated) {
        item.verticalRuined = true
        item.hazard = 'VERTICAL PIZZA — cheese ruined!'
        warnings.push(`${item.name} is vertical — rotate flat!`)
      } else if (item.isLiquid && item.rotated) {
        item.hazard = 'TIPPED SIDEWAYS — spilling!'
        warnings.push(`${item.name} is sideways — upright it!`)
      } else if (item.isLiquid && !item.sealed) {
        item.hazard = 'UNSEALED LID — tap Seal!'
        warnings.push(`${item.name} lid is unsealed!`)
      } else if (item.crushedBy) {
        item.hazard = `Crushed under ${item.crushedBy}`
        warnings.push(`${item.name} is being crushed under ${item.crushedBy}!`)
      } else if (item.x === null || item.y === null) {
        item.hazard = 'Unsecured loose item'
        warnings.push(`${item.name} is loose — pack it into your cargo bay!`)
      } else if (item.contaminated) {
        item.hazard = 'Soaked by spilled liquid'
      }
    }
    return warnings
  }

  /** Triggers a liquid spill from `source`, damaging it and soaking neighboring deliveries! */
  triggerSpill(source: CargoItem, strength = 1): string[] {
    if (!source.isLiquid || source.eaten >= 1) return []
    const soaked: string[] = []
    source.integrity = clamp(source.integrity - (22 + 28 * strength), 0, 100)
    for (const other of this.neighborsOf(source)) {
      if (other.eaten >= 1) continue
      other.contaminated = true
      other.integrity = clamp(other.integrity - (20 + 20 * strength), 0, 100)
      soaked.push(other.id)
    }
    this.recomputeHazards()
    return soaked
  }

  /** Per-frame cargo simulation: cooling/warming, vertical pizza slide, crushing, and high-G lateral liquid slosh. */
  step(dt: number, motion: { moving: boolean; kmh: number; slip: number; drifting: boolean }): { spilled: string[] } {
    const spilled: string[] = []
    if (!this.items.length) return { spilled }
    const movingFactor = motion.moving ? 1 + Math.min(1.5, motion.kmh / 70) : 0.35
    const lateralG = Math.abs(motion.slip) + (motion.drifting ? 0.55 : 0)

    for (const item of this.items) {
      if (item.eaten >= 1) continue
      const inThermal = item.x !== null && item.y !== null && this.slotRole(item.x, item.y) === 'thermal'
      const inLiquidMount = item.x !== null && item.y !== null && this.slotRole(item.x, item.y) === 'liquid'

      // Thermal decay (hot food cools; ice cream melts)
      if (item.hot || item.cold) {
        const rate = (item.cold ? 0.42 : 0.28) * (inThermal && item.hot ? 0.35 : 1)
        item.temp = clamp(item.temp - rate * dt, 0, 100)
      }

      // Vertical pizza continues sliding into a soggy heap
      if (item.kind === 'pizza' && item.rotated) {
        item.verticalRuined = true
        item.integrity = clamp(item.integrity - 9.5 * movingFactor * dt, 5, 100)
      }

      // Heavy item crushing fragile item underneath
      if (item.crushedBy) {
        item.integrity = clamp(item.integrity - 4.8 * movingFactor * dt, 10, 100)
      }

      // Loose unsecured items rattle around at speed
      if ((item.x === null || item.y === null) && motion.kmh > 25) {
        item.integrity = clamp(item.integrity - (motion.kmh * 0.045) * dt, 15, 100)
      }

      // Unsealed or tipped liquids slosh and spill during turns/drifts!
      if (item.isLiquid) {
        const mountMul = inLiquidMount ? 0.25 : 1
        if (item.rotated) {
          item.integrity = clamp(item.integrity - 14 * dt, 0, 100)
          if (item.integrity < 82 && Math.random() < dt * 0.9) {
            const soaked = this.triggerSpill(item, 0.5)
            spilled.push(item.id, ...soaked)
          }
        } else if (!item.sealed && (lateralG > 0.32 || motion.kmh > 48)) {
          const slosh = (lateralG * 14 + Math.max(0, motion.kmh - 45) * 0.14) * mountMul
          item.integrity = clamp(item.integrity - slosh * dt, 0, 100)
          if (lateralG > 0.55 && mountMul > 0.5 && Math.random() < dt * 0.85) {
            const soaked = this.triggerSpill(item, 0.65)
            spilled.push(item.id, ...soaked)
          }
        }
      }
    }
    return { spilled }
  }

  /**
   * Applies a real physics vehicle collision to cargo based on BOTH impact force AND vehicle hit location.
   * Rear hits hammer trunk/rear-rack cargo; side hits tip & slosh liquids; front hits slam scooter baskets.
   */
  applyImpact(ev: CargoImpactEvent): CargoImpactReport | null {
    if (!this.items.length || ev.speedCells < 14) return null
    const def = getVehicleDef(this.vehicleId)
    const speedMps = ev.speedCells / 10
    const rawForce = clamp((speedMps - 1.4) / 14, 0.12, 2.2)

    // Classify impact location on the vehicle body
    let zone: CargoImpactReport['zone'] = 'front'
    if (ev.localUp < -0.65 && Math.abs(ev.localFwd) < 0.5 && Math.abs(ev.localRight) < 0.5) zone = 'bottom'
    else if (Math.abs(ev.localFwd) >= Math.abs(ev.localRight)) zone = ev.localFwd >= 0 ? 'front' : 'rear'
    else zone = ev.localRight >= 0 ? 'right' : 'left'

    // Zone multiplier depends on where this vehicle carries its food!
    let zoneMul = 1.0
    if (def.cargoZone === 'front' && zone === 'front') zoneMul = 1.42
    else if ((def.cargoZone === 'rear' || def.cargoZone === 'trunk') && zone === 'rear') zoneMul = 1.48
    else if (zone === 'left' || zone === 'right') zoneMul = 1.24
    else if (zone === 'bottom') zoneMul = 1.18

    // Chassis + Shock Mount upgrades damp transmitted impulse
    const shockMul = this.upgrades.fragileShock >= 2 ? 0.32 : this.upgrades.fragileShock === 1 ? 0.60 : 1.0
    const effective = (rawForce * zoneMul * shockMul) / def.chassisProtection

    const severity: CargoImpactReport['severity'] =
      effective >= 0.85 ? 'wreck' : effective >= 0.40 ? 'hard' : 'bump'

    const damagedItems: CargoImpactReport['damagedItems'] = []
    const spilledIds: string[] = []
    const contaminatedSet = new Set<string>()
    let totalDamage = 0

    for (const item of this.items) {
      if (item.eaten >= 1) continue
      const loose = item.x === null || item.y === null
      const role = loose ? 'normal' : this.slotRole(item.x!, item.y!)
      let mult = loose ? 1.55 : 1.0
      if (item.fragile) mult *= 1.35
      if (item.kind === 'pizza' && role === 'thermal' && !item.rotated) mult *= 0.55
      if (item.isLiquid && role === 'liquid' && item.sealed && !item.rotated) mult *= 0.25
      if (item.isLiquid && (!item.sealed || item.rotated)) mult *= 1.65

      const dmg = Math.round(effective * 32 * mult)
      if (dmg <= 0) continue
      const prev = item.integrity
      item.integrity = clamp(item.integrity - dmg, 0, 100)
      const actual = Math.round(prev - item.integrity)
      if (actual > 0) {
        totalDamage += actual
        damagedItems.push({ id: item.id, name: item.name, delta: actual, integrity: Math.round(item.integrity) })
      }

      // Unsealed liquid or massive side/rear hit causes a spill onto adjacent deliveries!
      const spillThreshold = !item.sealed || item.rotated ? 0.22 : (role === 'liquid' ? 1.45 : 0.78)
      if (item.isLiquid && effective >= spillThreshold) {
        spilledIds.push(item.id)
        const soaked = this.triggerSpill(item, Math.min(1.2, effective))
        for (const sid of soaked) contaminatedSet.add(sid)
      }
    }

    this.recomputeHazards()
    return {
      severity,
      zone,
      damagedItems,
      spilledIds,
      contaminatedIds: [...contaminatedSet],
      totalDamage,
    }
  }

  snapshot(): CargoBayState {
    const warnings = this.recomputeHazards()
    const looseCount = this.items.filter((i) => i.x === null || i.y === null).length
    return {
      cols: this.cols,
      rows: this.rows,
      slots: [...this.slots],
      items: this.items.map((i) => ({ ...i })),
      warnings,
      looseCount,
    }
  }
}
