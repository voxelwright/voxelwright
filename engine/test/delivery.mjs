// Automated proof for DoorSmash Food Delivery Game, extensible Phone OS, multi-stop GPS,
// sculpted fleet vehicles + upgrades, Death Stranding cargo physics, and modular 3D store interiors.
//
//   node test/delivery.mjs [--unit-only] [--shots /path/to/dir]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CargoBay } from '../page/delivery-cargo.ts'
import { findSidewalkDropoff, isSidewalkGround } from '../page/delivery.ts'
import { buildDeliveryVehicle, cargoGridSizeFor, defaultUpgrades, DELIVERY_VEHICLES } from '../page/delivery-vehicles.ts'
import { DEFAULTS as DRIVE_TOUCH_DEFAULTS, layout as driveTouchLayout } from '../page/drive-touch.ts'
import { computeMultiStopRoute } from '../page/gps.ts'
import { buildRoomShellAsset, buildShoppingCartAsset, getInteriorModuleKit } from '../page/interior-modules.ts'
import { synthesizeInteriorBlueprint } from '../page/interiors.ts'
import { computeMobileDriveDock } from '../page/phone.ts'
import { arg, has, start } from './kit.mjs'

const unitOnly = has('unit-only')
const shotsDir = arg('shots', '')
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

console.log('1. Cargo stacking, vertical pizza ruin, unsealed soup spill & directional impact physics')
{
  const up = defaultUpgrades()
  const bay = new CargoBay('prius', up)
  check(bay.cols === 4 && bay.rows === 3, `prius base cargo grid is 4x3 (${bay.cols}x${bay.rows})`)

  const pizza = {
    id: 'p1', orderId: 'o1', orderLabel: '#1', name: 'XL Pepperoni Pizza', emoji: '🍕', kind: 'pizza',
    baseW: 2, baseH: 1, rotated: false, x: null, y: null, weight: 2, fragile: true, isLiquid: false,
    sealed: true, hot: true, cold: false, integrity: 100, temp: 100, eaten: 0,
    contaminated: false, verticalRuined: false, crushedBy: null, hazard: null,
  }
  const soup = {
    id: 's1', orderId: 'o2', orderLabel: '#2', name: 'Spicy Ramen', emoji: '🍜', kind: 'soup',
    baseW: 1, baseH: 1, rotated: false, x: null, y: null, weight: 2, fragile: false, isLiquid: true,
    sealed: false, hot: true, cold: false, integrity: 100, temp: 100, eaten: 0,
    contaminated: false, verticalRuined: false, crushedBy: null, hazard: null,
  }
  const waterCase = {
    id: 'w1', orderId: 'o3', orderLabel: '#3', name: 'Sparkling Water 12-Pack', emoji: '🛒', kind: 'groceries_heavy',
    baseW: 2, baseH: 1, rotated: false, x: null, y: null, weight: 5, fragile: false, isLiquid: false,
    sealed: true, hot: false, cold: false, integrity: 100, temp: 100, eaten: 0,
    contaminated: false, verticalRuined: false, crushedBy: null, hazard: null,
  }
  bay.addItem(pizza, false)
  bay.addItem(soup, false)
  bay.addItem(waterCase, false)
  // Place pizza at (0,1), unsealed soup directly adjacent at (2,1), heavy water directly ABOVE pizza at (0,0)!
  check(bay.moveItem('p1', 0, 1) && bay.moveItem('s1', 2, 1) && bay.moveItem('w1', 0, 0), 'placed items into adjacent & stacked grid cells')
  bay.recomputeHazards()
  check(bay.getItem('p1').crushedBy === 'Sparkling Water 12-Pack', 'heavy item above fragile pizza triggers crushing hazard')
  check(bay.getItem('s1').hazard?.includes('UNSEALED'), 'unsealed soup warns driver to seal lid')

  // Rear impact on Prius trunk spills unsealed soup AND contaminates neighboring pizza!
  const rep = bay.applyImpact({ localFwd: -0.9, localRight: 0.1, localUp: 0, speedCells: 65 })
  check(!!rep && rep.zone === 'rear' && rep.spilledIds.includes('s1') && rep.contaminatedIds.includes('p1'),
    `rear impact spills unsealed soup & contaminates adjacent delivery (${JSON.stringify(rep && { zone: rep.zone, spilled: rep.spilledIds, contam: rep.contaminatedIds })})`)

  // Rotating pizza vertical ruins it immediately!
  const bay2 = new CargoBay('prius', up)
  bay2.addItem({ ...pizza, id: 'p2', integrity: 100, contaminated: false, verticalRuined: false, x: null, y: null }, true)
  bay2.rotateItem('p2')
  check(bay2.getItem('p2').rotated === true && bay2.getItem('p2').verticalRuined === true && bay2.getItem('p2').integrity < 70,
    `vertical pizza gets ruined (integrity=${bay2.getItem('p2').integrity})`)

  // Sealed soup inside Gimbal Liquid Mount + Fragile Shock Lv.2 survives hard impact with minimal damage and zero spill!
  const upMax = { ...defaultUpgrades(), liquidMount: 1, fragileShock: 2, cargoRack: 1 }
  const bayPro = new CargoBay('prius', upMax)
  check(bayPro.cols === 5 && bayPro.rows === 3, `cargoRack expands prius grid to 5x3 (${bayPro.cols}x${bayPro.rows})`)
  bayPro.addItem({ ...soup, id: 's2', sealed: false, integrity: 100, x: null, y: null }, true)
  bayPro.sealItem('s2')
  const proRep = bayPro.applyImpact({ localFwd: -0.9, localRight: 0.2, localUp: 0, speedCells: 55 })
  check(!!proRep && proRep.spilledIds.length === 0 && bayPro.getItem('s2').integrity > 88,
    `sealed soup in gimbal liquid mount + shock dampers resists crash spill (integrity=${bayPro.getItem('s2').integrity})`)
}

console.log('2. Sculpted delivery fleet (E-Scooter, Moped, Prius, Turbo) & visual/practical upgrades')
{
  for (const v of DELIVERY_VEHICLES) {
    const base = buildDeliveryVehicle(v.id, defaultUpgrades())
    const upgraded = buildDeliveryVehicle(v.id, { ...defaultUpgrades(), paint: 'mint', lighting: 'cyber', cargoRack: 2, pizzaWarmer: 1, liquidMount: 1 })
    const countFilled = (arr) => { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i]) n++; return n }
    const fBase = countFilled(base.fine[0].cells)
    const fUp = countFilled(upgraded.fine[0].cells)
    check(fBase > 1500 && base.motor.feet.length === 4 && base.eye?.length === 3 && fUp !== fBase,
      `${v.name}: sculpted (${fBase} fine cells -> ${fUp} upgraded), 4 motor feet, eye [${base.eye.map((n) => n.toFixed(1)).join(',')}]`)
  }
  const [c0] = cargoGridSizeFor('scooter', defaultUpgrades())
  const [c2] = cargoGridSizeFor('scooter', { ...defaultUpgrades(), cargoRack: 2 })
  check(c2 === c0 + 2, `scooter cargo rack upgrade adds 2 columns (${c0} -> ${c2})`)
}

console.log('3. Modular non-cookie-cutter store & restaurant interiors + 1:1 blueprint schema')
{
  const places = [
    { id: '1', name: 'Dominoes Pizza', category: 'pizza', brandId: 'dominos', x: 51900, z: 66100, widthM: 9.5, heightM: 10 },
    { id: '2', name: 'Whole Moods Market', category: 'supermarket', brandId: 'whole-foods', x: 51500, z: 67200, widthM: 15, heightM: 12 },
    { id: '3', name: 'In-N-About Burger', category: 'burger', brandId: 'in-n-out', x: 51800, z: 65500, widthM: 10.5, heightM: 8 },
    { id: '4', name: 'Starbuxx Coffee', category: 'coffee', brandId: 'starbucks', x: 52100, z: 66800, widthM: 7.5, heightM: 9 },
    { id: '5', name: 'Fog City Ramen', category: 'restaurant', brandId: null, x: 51300, z: 68100, widthM: 8.8, heightM: 10 },
  ]
  const bps = places.map((p) => synthesizeInteriorBlueprint(p, 3))
  const archetypes = new Set(bps.map((b) => b.archetype))
  const floors = new Set(bps.map((b) => b.theme.floor))
  check(archetypes.size >= 4 && floors.size >= 3, `synthesized distinct non-cookie-cutter interiors (${[...archetypes].join(', ')}; floors: ${[...floors].join(', ')})`)
  const marketBp = bps[1]
  const bodegaBp = synthesizeInteriorBlueprint({ id: '6', name: 'Corner Bodega', category: 'corner_store', x: 51400, z: 67500, widthM: 9.6, heightM: 8 }, 2)
  const kitMods = getInteriorModuleKit()
  const aisleCounts = new Set([
    kitMods.aisle_produce.born.cells,
    kitMods.aisle_bakery.born.cells,
    kitMods.aisle_pantry.born.cells,
    kitMods.aisle_snacks.born.cells,
    kitMods.aisle_dairy.born.cells,
  ])
  check(aisleCounts.size === 5, `all 5 supermarket departments have distinct sculpted voxel silhouettes (cell counts: ${[...aisleCounts].join(', ')})`)
  const neededCats = ['produce', 'bakery', 'pantry', 'snacks', 'dairy']
  const marketHasAll = neededCats.every((c) => marketBp.shoppingZones.some((z) => z.category === c && z.shelfAt?.length === 3))
  const bodegaHasAll = neededCats.every((c) => bodegaBp.shoppingZones.some((z) => z.category === c && z.shelfAt?.length === 3))
  check(marketBp.shoppingZones.length >= 5 && marketHasAll && bodegaHasAll && marketBp.npcs.some((n) => n.role === 'worker') && marketBp.npcs.some((n) => n.role === 'delivery_driver'),
    `both supermarkets and compact bodegas expose all 5 department shelf zones with 3D shelf coordinates, NPC workers & couriers`)
  const shell = buildRoomShellAsset(marketBp)
  const cart0 = buildShoppingCartAsset(0)
  const cart4 = buildShoppingCartAsset(4)
  check(shell.born.cells > 5000 && cart4.born.cells > cart0.born.cells,
    `3D voxel room shell (${shell.born.cells} cells) & shopping cart visually fills (${cart0.born.cells} -> ${cart4.born.cells} cells)`)

  // Regression gate: no standing NPC inside any solid fixture (e.g. Staff/Chef inside pizza oven),
  // no NPC clipping walls, and no solid modules overlapping each other across all categories & sizes.
  const kit = getInteriorModuleKit()
  const allCats = ['pizza', 'supermarket', 'grocery', 'corner_store', 'market', 'burger', 'coffee', 'bakery', 'ice_cream', 'bar', 'restaurant']
  const testWidths = [7.2, 8.2, 9.5, 12.0]
  const npcRadius = 0.28
  const overlapErrors = []
  const modBox = (m) => {
    const asset = kit[m.kind]
    if (!asset?.solid) return null
    const rot = Math.abs(Math.sin(m.yaw ?? 0)) > 0.5
    const hx = m.collider ? m.collider[0] : (rot ? asset.halfZ : asset.halfX)
    const hz = m.collider ? m.collider[1] : (rot ? asset.halfX : asset.halfZ)
    return { x0: m.x - hx, x1: m.x + hx, z0: m.z - hz, z1: m.z + hz, id: m.id, kind: m.kind }
  }
  const auditPlace = (place) => {
    const bp = synthesizeInteriorBlueprint(place, 4)
    const boxes = bp.modules.map(modBox).filter(Boolean)
    for (const npc of bp.npcs) {
      if (npc.role === 'patron_sit') continue
      for (const b of boxes) {
        if (npc.x + npcRadius > b.x0 && npc.x - npcRadius < b.x1 && npc.z + npcRadius > b.z0 && npc.z - npcRadius < b.z1) {
          overlapErrors.push(`${place.category}:${place.name} NPC ${npc.id} inside ${b.id}(${b.kind})`)
        }
      }
      if (npc.x < 0.35 || npc.x > bp.room.widthM - 0.35 || npc.z < 0.35 || npc.z > bp.room.depthM - 0.35) {
        overlapErrors.push(`${place.category}:${place.name} NPC ${npc.id} clips wall`)
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (a.x0 < b.x1 - 0.02 && a.x1 > b.x0 + 0.02 && a.z0 < b.z1 - 0.02 && a.z1 > b.z0 + 0.02) {
          overlapErrors.push(`${place.category}:${place.name} module ${a.id}(${a.kind}) overlaps ${b.id}(${b.kind})`)
        }
      }
    }
  }
  auditPlace({ id: 'calzones', name: "Calzone's Pizza Cucina", category: 'pizza', x: 52106, z: 66325, widthM: 9.0, heightM: 9 })
  for (const cat of allCats) {
    for (const w of testWidths) {
      for (let s = 0; s < 4; s++) {
        auditPlace({ id: `${cat}-${w}-${s}`, name: `Shop ${cat} ${s}`, category: cat, x: 52000 + s * 13, z: 66000 + s * 17, widthM: w, heightM: 9 })
      }
    }
  }
  check(overlapErrors.length === 0,
    overlapErrors.length === 0
      ? `zero NPC/module or module/module overlaps across ${1 + allCats.length * testWidths.length * 4} interior blueprints`
      : `${overlapErrors.length} interior overlaps (first: ${overlapErrors[0]})`)
}

console.log('3b. Customer drop-off sidewalk snapping (never in the middle of asphalt roads)')
{
  // Synthetic street cross-section: x in [-40..40] cells (-4..4 m) = ASPHALT(6), [-80..-41] & [41..80] = CONCRETE(7) sidewalk, outside = building wall!
  const mockLand = {
    top_at(x, _z) {
      if (Math.abs(x) <= 40) return 6 // asphalt carriageway
      if (Math.abs(x) <= 80) return 7 // concrete sidewalk
      return 8 // brick building
    },
    ground_at(x, _z) {
      return Math.abs(x) <= 40 ? 100 : Math.abs(x) <= 80 ? 102 : 240
    },
    feet_at(x, _z) {
      return Math.abs(x) <= 40 ? 100 : Math.abs(x) <= 80 ? 102 : 240
    },
    world_kind(x, y, _z) {
      if (Math.abs(x) > 80 && y >= 100 && y <= 240) return 8
      return 0
    },
  }
  const snapped = findSidewalkDropoff(mockLand, 0, 0, 1, 0)
  check(!!snapped && snapped.snapped && Math.abs(snapped.x) >= 4.5 && Math.abs(snapped.x) <= 7.8 && isSidewalkGround(mockLand, snapped.x, snapped.z, 100),
    `road-center drop-off (0,0) snaps cleanly onto sidewalk (${JSON.stringify(snapped)})`)

  // Unloaded tile (ground=0, top_at=0) returns null so delivery waits for tile streaming
  const unloadedLand = { top_at: () => 0, ground_at: () => 0, feet_at: () => 0, world_kind: () => 0 }
  check(findSidewalkDropoff(unloadedLand, 10, 10, 1, 0) === null, 'unloaded tile returns null instead of committing road coordinates')
}

console.log('3c. Mobile touch dashboard phone dock geometry (portrait & landscape, both hands)')
{
  const overlaps = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
  const cases = [
    { name: 'portrait-right', vw: 390, vh: 844, portrait: true, safe: { top: 59, bottom: 34, left: 0, right: 0 }, topHudBottom: 175, hand: 'right' },
    { name: 'landscape-right', vw: 844, vh: 390, portrait: false, safe: { top: 0, bottom: 21, left: 59, right: 59 }, topHudBottom: 68, hand: 'right' },
    { name: 'landscape-left', vw: 844, vh: 390, portrait: false, safe: { top: 0, bottom: 21, left: 59, right: 59 }, topHudBottom: 68, hand: 'left' },
  ]
  for (const c of cases) {
    const placed = driveTouchLayout({ ...DRIVE_TOUCH_DEFAULTS, hand: c.hand }, 'arrows', { width: c.vw, height: c.vh, portrait: c.portrait })
    const rects = placed.map((p) => {
      const bottom = c.vh - c.safe.bottom - (14 + p.y)
      const top = bottom - p.h
      const left = p.side === 'left' ? c.safe.left + 14 + p.x : c.vw - c.safe.right - 14 - p.x - p.w
      return { left, top, right: left + p.w, bottom }
    })
    const dock = computeMobileDriveDock({ vw: c.vw, vh: c.vh, safe: c.safe, controls: rects, topHudBottom: c.topHudBottom })
    const box = { left: dock.left, top: dock.top, right: dock.left + dock.width, bottom: dock.top + dock.height }
    const hitsControl = rects.some((r) => overlaps(box, r))
    const inSafe = box.left >= c.safe.left && box.right <= c.vw - c.safe.right && box.top >= c.safe.top && box.bottom <= c.vh - c.safe.bottom
    const windshieldGap = box.top - c.topHudBottom
    check(!hitsControl && inSafe && dock.width >= 200 && dock.height >= 165 && windshieldGap >= 8,
      `${c.name}: dock ${dock.width}x${dock.height} at (${dock.left},${dock.top}), zero overlap with controls, windshield clear by ${Math.round(windshieldGap)}px`)
  }
}

console.log('4. Multi-stop GPS route calculation & stop reordering')
{
  // Minimal road graph square: (0,0) - (100,0) - (100,100) - (0,100)
  const nodes = new Float32Array([0, 0, 100, 0, 100, 100, 0, 100])
  const edgeA = new Uint32Array([0, 1, 2, 3])
  const edgeB = new Uint32Array([1, 2, 3, 0])
  const edgeFlags = new Uint8Array([4, 4, 4, 4])
  const edgeName = new Uint16Array([0, 1, 2, 3])
  const names = ['Columbus Ave', 'Broadway', 'Stockton St', 'Green St']
  const adjOff = new Uint32Array([0, 2, 4, 6, 8])
  const adjTo = new Uint32Array([1, 3, 0, 2, 1, 3, 2, 0])
  const adjEdge = new Uint32Array([0, 3, 0, 1, 1, 2, 2, 3])
  const adjDir = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1])
  const roadGrid = { cell: 200, gx0: 0, gz0: 0, nx: 1, nz: 1, off: new Uint32Array([0, 4]), list: new Uint32Array([0, 1, 2, 3]) }
  const mockMap = {
    title: 'Test', x0: 0, z0: 0, spanX: 100, spanZ: 100, nNodes: 4, nEdges: 4, nBldgs: 0,
    nodes, edgeA, edgeB, edgeFlags, edgeName, names, adjOff, adjTo, adjEdge, adjDir,
    roadGrid, buildings: [], places: [],
  }
  const stops = [
    { id: 'a', x: 100, z: 0, name: 'Pickup Pizza', kind: 'pickup' },
    { id: 'b', x: 100, z: 100, name: 'Shop Market', kind: 'shop' },
    { id: 'c', x: 0, z: 100, name: 'Deliver Customer', kind: 'dropoff' },
  ]
  const mr1 = computeMultiStopRoute(mockMap, 0, 0, stops)
  const mr2 = computeMultiStopRoute(mockMap, 0, 0, [stops[2], stops[0], stops[1]])
  check(!!mr1 && mr1.legs.length === 3 && Math.round(mr1.totalM) === 300 && mr1.combined.destName.includes('+2 stops'),
    `multi-stop GPS chains 3 legs cleanly (${Math.round(mr1.totalM)} m, label="${mr1.combined.destName}")`)
  check(!!mr2 && mr2.stops[0].id === 'c' && mr2.combined.destX === 0 && mr2.combined.destZ === 100,
    `reordered multi-stop GPS updates active first leg immediately`)
}

if (!unitOnly) {
  console.log('5. Real WebGPU page integration: Phone OS, first-person driving, DoorSmash loop, Prius & 3D Supermarket Interior')
  const kit = await start()
  const page = await kit.city(shotsDir ? 'walk=1&sound=0&people=1&scale=1' : 'walk=1&sound=0&people=1')
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.waitForFunction(() => Boolean(globalThis.engine?.phone && globalThis.engine?.delivery && globalThis.engine?.interiors), null, { timeout: 30_000 })
    await page.waitForTimeout(800)

    // A. Shift sign-up / sign-off & shift-only notifications + Phone OS extensibility
    const shiftOffCheck = await page.evaluate(() => {
      const e = globalThis.engine
      e.delivery.resetProgress()
      const offInitially = !e.delivery.onShift
      // Generating an offer while off shift must NOT show a phone notification toast!
      e.delivery.generateOffer({ pizza: true })
      const toastWhileOff = document.querySelector('[data-panel="phone-toast"]')?.classList.contains('show') ?? false
      e.phone.openPhone('doorsmash')
      const hasStartBtn = !!document.querySelector('.ds-start-shift')
      return { offInitially, toastWhileOff, hasStartBtn }
    })
    check(shiftOffCheck.offInitially && !shiftOffCheck.toastWhileOff && shiftOffCheck.hasStartBtn,
      `starts off shift with notifications silenced and Sign Up UI visible (${JSON.stringify(shiftOffCheck)})`)

    await page.waitForTimeout(450)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, '00-shift-signup.png') })

    const phoneCheck = await page.evaluate(() => {
      const e = globalThis.engine
      e.delivery.resetProgress()
      e.phone.closePhone()
      // Sign up for shift -> now notifications fire!
      const started = e.delivery.startShift({ focus: 'citywide' })
      const toastOnShift = document.querySelector('[data-panel="phone-toast"]')?.classList.contains('show') ?? false
      e.delivery.generateOffer({ pizza: true, soup: true, obnoxious: true })
      e.delivery.generateOffer({ supermarket: true })
      // Sign off -> clears offers, dismisses toast, silences notifications
      const summary = e.delivery.endShift()
      const toastAfterSignoff = document.querySelector('[data-panel="phone-toast"]')?.classList.contains('show') ?? false
      const offersAfterSignoff = e.delivery.offers.length
      // Sign back on for the rest of the playtest
      e.delivery.startShift({ focus: 'citywide' })
      e.delivery.generateOffer({ pizza: true, soup: true, obnoxious: true })
      e.delivery.generateOffer({ supermarket: true })
      e.phone.registerApp({
        id: 'test-ext',
        name: 'BayRadio',
        accent: '#2563eb',
        iconSvg: '<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="6" fill="#fff"/></svg>',
        mount(el) { el.textContent = 'Extensible app works!'; return {} },
      })
      const count = e.phone.apps.length
      e.phone.openPhone('doorsmash')
      const openState = { open: e.phone.open, app: e.phone.activeAppId, reading: e.me.phoneReading, onShift: e.delivery.onShift }
      const hasSignoffBtn = !!document.querySelector('.ds-signoff')
      e.phone.unregisterApp('test-ext')
      return { started, toastOnShift, summaryOk: !!summary, toastAfterSignoff, offersAfterSignoff, count, openState, hasSignoffBtn }
    })
    check(
      phoneCheck.started && phoneCheck.toastOnShift && phoneCheck.summaryOk && !phoneCheck.toastAfterSignoff && phoneCheck.offersAfterSignoff === 0
      && phoneCheck.count >= 2 && phoneCheck.openState.open && phoneCheck.openState.app === 'doorsmash' && phoneCheck.hasSignoffBtn,
      `shift sign-up/sign-off controls offers & notifications cleanly + extensible Phone OS (${JSON.stringify(phoneCheck)})`,
    )

    await page.waitForTimeout(450)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, '01-phone-doorsmash-onfoot.png') })

    // B. Full DoorSmash gameplay flow: generate pizza+soup + supermarket orders, accept both, reorder GPS stops!
    const orderFlow = await page.evaluate(() => {
      const d = globalThis.engine.delivery
      d.resetProgress()
      d.startShift({ focus: 'citywide' })
      const oPizza = d.generateOffer({ pizza: true, soup: true, obnoxious: true })
      const oMarket = d.generateOffer({ supermarket: true })
      const acc1 = d.acceptOffer(oPizza.id)
      const acc2 = d.acceptOffer(oMarket.id)
      const stopsBefore = d.routeStops.map((s) => s.id)
      const reordered = d.reorderStop(1, 0)
      const stopsAfter = d.routeStops.map((s) => s.id)
      return {
        acc1, acc2,
        activeCount: d.activeOrders.length,
        stopsBefore: stopsBefore.length,
        reordered,
        swapped: stopsAfter[0] === stopsBefore[1],
        oPizzaId: oPizza.id,
        oMarketId: oMarket.id,
        marketStore: oMarket.store,
        pizzaStore: oPizza.store,
      }
    })
    check(orderFlow.acc1 && orderFlow.acc2 && orderFlow.activeCount === 2 && orderFlow.reordered && orderFlow.swapped,
      `stacked 2 orders & reordered multi-stop GPS (${JSON.stringify({ active: orderFlow.activeCount, stops: orderFlow.stopsBefore, swapped: orderFlow.swapped })})`)

    // C. Enter modular 3D Supermarket Interior: verify HUD checklist, GTA 6 pink markers, indoor floorplan radar, cart & checkout!
    await page.evaluate((store) => {
      globalThis.engine.phone.closePhone()
      globalThis.engine.delivery.enterStore(store)
    }, orderFlow.marketStore)
    await page.waitForTimeout(900)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, '02-supermarket-interior.png') })

    const marketHud = await page.evaluate(() => {
      const int = globalThis.engine.interiors
      const checklistEl = document.querySelector('[data-panel="store-checklist"]')
      const itemsCount = checklistEl ? checklistEl.querySelectorAll('.sc-item').length : 0
      const markersCount = document.querySelectorAll('[data-panel="store-markers"] .sm-pin').length
      const radar = int.indoorMapState()
      const mmVisible = !!document.querySelector('#minimap') && !document.querySelector('#minimap').hidden
      return {
        checklistVisible: !!checklistEl && !checklistEl.hidden,
        itemsCount,
        markersCount,
        radarFixtures: radar?.fixtures.length ?? 0,
        radarTargets: radar?.targets.length ?? 0,
        mmVisible,
      }
    })
    check(
      marketHud.checklistVisible && marketHud.itemsCount >= 4 && marketHud.markersCount >= 1
      && marketHud.radarFixtures >= 5 && marketHud.radarTargets >= 4 && marketHud.mmVisible,
      `supermarket HUD checklist, GTA 6 pink markers & indoor radar minimap active (${JSON.stringify(marketHud)})`,
    )

    const marketResult = await page.evaluate((marketOrderId) => {
      const d = globalThis.engine.delivery
      const int = globalThis.engine.interiors
      const bp = int.currentBlueprint
      const ord = d.activeOrders.find((o) => o.id === marketOrderId)
      for (const it of ord.shoppingList) d.collectShoppingItem(ord.id, it.id)
      const doneText = document.querySelector('[data-panel="store-checklist"] .sc-count')?.textContent ?? ''
      const picked = d.collectOrder(ord.id)
      // Also pick up the pizza+soup order (skip delay for test) and verify cargo items loaded
      const ordP = d.activeOrders.find((o) => o.id !== marketOrderId)
      ordP.delayRemaining = 0
      const pickedP = d.collectOrder(ordP.id)
      int.exit()
      const checklistHiddenAfterExit = document.querySelector('[data-panel="store-checklist"]')?.hidden === true
      return {
        bpArchetype: bp?.archetype,
        aisles: bp?.shoppingZones.length ?? 0,
        npcs: bp?.npcs.length ?? 0,
        doneText,
        picked,
        pickedP,
        cargoItems: d.cargo.items.length,
        exited: !int.active,
        checklistHiddenAfterExit,
      }
    }, orderFlow.oMarketId)
    check(
      marketResult.aisles >= 5 && marketResult.npcs >= 4 && marketResult.doneText === 'CHECKOUT'
      && marketResult.picked && marketResult.pickedP && marketResult.cargoItems >= 3 && marketResult.exited && marketResult.checklistHiddenAfterExit,
      `walkable 3D supermarket interior shopping + checklist completion + checkout + exit (${JSON.stringify(marketResult)})`,
    )

    // Also capture a Pizzeria interior screenshot so we visually verify non-cookie-cutter interior variety!
    if (shotsDir) {
      await page.evaluate((store) => { globalThis.engine.delivery.enterStore(store) }, orderFlow.pizzaStore)
      await page.waitForTimeout(900)
      await page.screenshot({ path: join(shotsDir, '02b-pizzeria-interior.png') })
      await page.evaluate(() => { globalThis.engine.interiors.exit() })
      await page.waitForTimeout(400)
    }

    // D. Spawn customized Prius (unlocking via cash + paint + cyber lighting), mount it, open Phone -> auto first-person driving view!
    const drivePhone = await page.evaluate(async () => {
      const e = globalThis.engine
      const d = e.delivery
      d.profile.cash = 1500
      const buyV = d.selectOrBuyVehicle('prius')
      const buyL = d.buyLighting('cyber')
      const buyU = d.buyUpgrade('liquidMount')
      const thing = await d.spawnActiveVehicle()
      if (!thing) return { spawned: false }
      e.alive.mount(thing)
      const beforeInside = e.alive.inside
      e.phone.openPhone('doorsmash')
      const duringInside = e.alive.inside
      return {
        spawned: true,
        buyOk: buyV.ok && buyL.ok && buyU.ok,
        vehicleName: thing.name,
        beforeInside,
        duringInside,
      }
    })
    await page.waitForTimeout(900)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, '03-first-person-driving-phone.png') })
    if (shotsDir) {
      // Also capture the Death Stranding Cargo stacking tab while sitting in the Prius!
      await page.click('.ds-tab[data-tab="cargo"]').catch(() => {})
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(shotsDir, '05-cargo-stacking-ui.png') })
    }

    const afterClose = await page.evaluate(() => {
      const e = globalThis.engine
      e.phone.closePhone()
      return { afterInside: e.alive.inside, stillRiding: !!e.alive.riding }
    })
    await page.waitForTimeout(600)
    if (shotsDir) await page.screenshot({ path: join(shotsDir, '04-prius-cyber-exterior.png') })

    check(drivePhone.spawned && drivePhone.buyOk && !drivePhone.beforeInside && drivePhone.duringInside && !afterClose.afterInside && afterClose.stillRiding,
      `Prius spawned & Phone while driving switches automatically to first-person seat & restores on stow (${JSON.stringify({ ...drivePhone, ...afterClose })})`)

    // E. Chat + Eat food + Send 🖕 + Double-Park Style + Deliver & Hangout Likes!
    const chaosAndPay = await page.evaluate((ids) => {
      const e = globalThis.engine
      const d = e.delivery
      e.alive.mount(null)
      const dp = d.checkParkingStyle(true)
      // On the pizza order: eat one item and send 🖕!
      const pizzaItem = d.cargo.items.find((i) => i.orderId === ids.oPizzaId)
      const ate = pizzaItem ? d.eatCargoItem(pizzaItem.id) : false
      const mf = d.sendMiddleFinger(ids.oPizzaId)
      const recChaos = d.deliverOrder(ids.oPizzaId)
      // On the market order: reply nicely and deliver cleanly!
      d.replyToOrder(ids.oMarketId, 'On my way with your groceries!')
      const recGood = d.deliverOrder(ids.oMarketId)
      const hang = d.interactHangout(d.hangouts[0].id)
      return {
        doubleParked: dp.doubleParked,
        ate,
        mf,
        chaosTip: recChaos?.tip,
        chaosStars: recChaos?.starsEarned,
        goodPay: recGood?.totalPay,
        goodLikes: recGood?.likesEarned,
        hangLikes: hang?.likes ?? 0,
        totalLikes: d.profile.likes,
      }
    }, { oPizzaId: orderFlow.oPizzaId, oMarketId: orderFlow.oMarketId })
    check(
      chaosAndPay.doubleParked && chaosAndPay.ate && chaosAndPay.mf
      && chaosAndPay.chaosTip === 0 && chaosAndPay.chaosStars === 1
      && chaosAndPay.goodPay > 6 && chaosAndPay.goodLikes > 0 && chaosAndPay.hangLikes > 0,
      `eat food + 🖕 nukes tip/stars; clean delivery + double-park + hangout pays cash & Death Stranding Likes (${JSON.stringify(chaosAndPay)})`,
    )

    // Close desktop page before opening mobile WebGPU contexts so only one WebGPU context draws at once.
    await page.close()

    // F. Mobile touch portrait & landscape driving + open phone layout check!
    console.log('6. Mobile portrait & landscape driving with open smartphone (zero control overlap)')
    {
      const mobileViews = [
        { id: 'portrait', size: [390, 844], safe: { top: 59, bottom: 34, left: 0, right: 0 } },
        { id: 'landscape', size: [844, 390], safe: { top: 0, bottom: 21, left: 59, right: 59 } },
      ]
      for (const mv of mobileViews) {
        const mp = await kit.page({ size: mv.size, dpr: 2, phone: true })
        const ctx = mp.context()
        mp.on('pageerror', (e) => errors.push(`[${mv.id}] ${e.message}`))
        const cdp = await ctx.newCDPSession(mp)
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: mv.safe })
        await mp.goto(`${kit.url}/city?fly=0&walk=1&sound=0&people=0&scale=0.5`)
        await mp.waitForFunction(() => Boolean(globalThis.engine?.phone && globalThis.engine?.delivery), null, { timeout: 60_000 })
        await mp.waitForTimeout(800)
        await mp.evaluate(async () => {
          const e = globalThis.engine
          e.delivery.resetProgress()
          e.delivery.startShift({ focus: 'citywide' })
          e.delivery.profile.cash = 1500
          e.delivery.selectOrBuyVehicle('prius')
          const thing = await e.delivery.spawnActiveVehicle()
          if (thing) e.alive.mount(thing)
          e.phone.openPhone('doorsmash')
        })
        await mp.waitForTimeout(800)
        if (shotsDir) await mp.screenshot({ path: join(shotsDir, `06-mobile-${mv.id}-drive-phone.png`) })
        const layoutCheck = await mp.evaluate((safe) => {
          const panel = document.querySelector('[data-panel="phone"]')
          const chassis = panel?.querySelector('.ph-chassis')
          const pRect = chassis?.getBoundingClientRect()
          const controls = [...document.querySelectorAll('[data-panel="living"] .dt-cluster > *')]
            .filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
            .map((el) => {
              const r = el.getBoundingClientRect()
              const cx = r.left + r.width / 2, cy = r.top + r.height / 2
              const hit = document.elementFromPoint(cx, cy)
              return { act: el.dataset.act, left: r.left, top: r.top, right: r.right, bottom: r.bottom, reachable: !!hit && el.contains(hit) }
            })
          const meets = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
          const overlapped = pRect ? controls.filter((c) => meets(pRect, c)).map((c) => c.act) : ['missing']
          const unreachable = controls.filter((c) => !c.reachable).map((c) => c.act)
          const inSafe = !!pRect && pRect.left >= safe.left - 1 && pRect.right <= innerWidth - safe.right + 1 && pRect.top >= safe.top - 1 && pRect.bottom <= innerHeight - safe.bottom + 1
          return {
            docked: panel?.classList.contains('mobile-drive-dock') ?? false,
            rect: pRect ? { l: Math.round(pRect.left), t: Math.round(pRect.top), w: Math.round(pRect.width), h: Math.round(pRect.height) } : null,
            controlCount: controls.length,
            overlapped,
            unreachable,
            inSafe,
          }
        }, mv.safe)
        check(
          layoutCheck.docked && layoutCheck.controlCount >= 5 && layoutCheck.overlapped.length === 0
          && layoutCheck.unreachable.length === 0 && layoutCheck.inSafe,
          `mobile ${mv.id} driving + open phone: dashboard dock clear of all ${layoutCheck.controlCount} driving controls & safe areas (${JSON.stringify(layoutCheck)})`,
        )
        await ctx.close()
      }
    }

    check(errors.length === 0, `zero uncaught page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  } catch (err) {
    check(false, `uncaught test exception: ${err?.message ?? err}`)
    console.error(err)
  } finally {
    kit.failures.push(...failures)
    await kit.finish('delivery')
  }
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\npassed')
