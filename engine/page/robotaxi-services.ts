// Declarative registry of San Francisco autonomous robotaxi services (#57).
// Core street/traffic/depot/crowd mechanics read from `ROBOTAXI_SERVICES` with zero hardcoded service names,
// so renaming a brand or adding competing robotaxi services is a single-file config change here.
import type { OjaiLivery } from './ojai-sculpt.ts'

const STEEL = 12, ROOFING = 14, LAMP = 15
const k = (material: number, colour = 0) => material | (colour << 8)
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const grey = (step: number) => 1 + Math.max(0, Math.min(14, step))

/** Smooth electric AWD Ojai robotaxi handling archetype (10 cm cells/s; 1 cell/s = 0.36 km/h -> 158 km/h top). */
export const ROBOTAXI_HANDLING = { power: 108, top: 440, grip: 1.52, steer: 0.58, tough: 400 } as const

export interface StationBay {
  id: number
  /** Bay center in local station metres (u along road frontage, w into depot forecourt). */
  u: number
  w: number
  /** Heading of a robotaxi parked/charging in this bay (radians in world x/z). */
  heading: number
  /** Side of the forecourt ('north' or 'south'). */
  row: 'north' | 'south'
}

export interface RobotaxiStationSpec {
  name: string
  gantryTitle: string
  depotTitle: string
  lat: number
  lon: number
  cx: number
  cz: number
  /** Orthonormal street-aligned frame in world x/z: u along frontage, w into forecourt. */
  ux: number
  uz: number
  wx: number
  wz: number
  /** High local spawn boost radius (cells). */
  boostCore?: number
  boostOuter?: number
  /** Draw distance for depot structures (cells). */
  drawReach?: number
}

export interface RobotaxiStation {
  name: string
  gantryTitle: string
  depotTitle: string
  lat: number
  lon: number
  cx: number
  cz: number
  ux: number
  uz: number
  wx: number
  wz: number
  eastHeading: number
  boostCore: number
  boostOuter: number
  drawReach: number
  bays: readonly StationBay[]
  inRoad: readonly [number, number]
  inGate: readonly [number, number]
  outGate: readonly [number, number]
  outRoad: readonly [number, number]
  visit: readonly [number, number]
  toWorld(uM: number, wM: number): [number, number]
  dirAngle(du: number, dw: number): number
}

export interface RobotaxiService {
  /** Stable lowercase key used as vehicle model id and station key (never hardcoded in core mechanics). */
  readonly id: string
  /** Display name shown in driving cues, UI, map descriptions, and dynamic bystander lines. */
  readonly name: string
  /** Short uppercase badge painted onto both sliding doors of the Ojai. */
  readonly badge: string
  /** Base citywide share of traffic cars (0..1). */
  readonly share: number
  /** Additional local spawn share around this service's station (0..1). */
  readonly stationBoost: number
  /** Livery palette shared between the Ojai bodywork, roof LiDAR accent, and charging station trim. */
  readonly livery: OjaiLivery
  /** Secondary bright LED accent for station gantry wings & active charging halos. */
  readonly stationGlow: number
  /** Dedicated charging & dispatch station geometry and map pin. */
  readonly station: RobotaxiStation
  /** Punchy single-line yells & filming captions when one of this service's cars freezes in traffic. */
  readonly yellLines: readonly string[]
  readonly filmLines: readonly string[]
}

/** Builds a full 6-bay charging depot layout aligned to any flat San Francisco lot & street frontage. */
export function buildStationGeometry(spec: RobotaxiStationSpec): RobotaxiStation {
  const { cx, cz, ux, uz, wx, wz } = spec
  const toWorld = (uM: number, wM: number): [number, number] => [
    cx + (ux * uM + wx * wM) * 10,
    cz + (uz * uM + wz * wM) * 10,
  ]
  const dirAngle = (du: number, dw: number) => Math.atan2(uz * du + wz * dw, ux * du + wx * dw)
  const bays: StationBay[] = [
    { id: 0, u: -10.8, w: -5.5, heading: dirAngle(0.45, -0.89), row: 'north' },
    { id: 1, u: -10.8, w: 2.0, heading: dirAngle(0.45, -0.89), row: 'north' },
    { id: 2, u: -10.8, w: 9.5, heading: dirAngle(0.45, -0.89), row: 'north' },
    { id: 3, u: 10.8, w: -5.5, heading: dirAngle(-0.45, -0.89), row: 'south' },
    { id: 4, u: 10.8, w: 2.0, heading: dirAngle(-0.45, -0.89), row: 'south' },
    { id: 5, u: 10.8, w: 9.5, heading: dirAngle(-0.45, -0.89), row: 'south' },
  ]
  return {
    name: spec.name,
    gantryTitle: spec.gantryTitle,
    depotTitle: spec.depotTitle,
    lat: spec.lat,
    lon: spec.lon,
    cx,
    cz,
    ux,
    uz,
    wx,
    wz,
    eastHeading: Math.atan2(-wz, -wx),
    boostCore: spec.boostCore ?? 3400,
    boostOuter: spec.boostOuter ?? 7000,
    drawReach: spec.drawReach ?? 4200,
    bays,
    inRoad: toWorld(-5.0, -29.5),
    inGate: toWorld(-4.6, -18.5),
    outGate: toWorld(4.6, -18.5),
    outRoad: toWorld(5.2, -29.5),
    visit: toWorld(2.0, -34.0),
    toWorld,
    dirAngle,
  }
}

/** Default San Francisco bystander yells & filming lines parameterized by any robotaxi brand name. */
function defaultYellLines(brand: string): readonly string[] {
  const upper = brand.toUpperCase()
  return [
    `${upper}?! MOVE IT!`,
    'IT FROZE AGAIN!',
    'ANYBODY IN THERE?!',
    'TURN ALREADY!',
    'NOT HERE! MOVE!',
    'CALL SUPPORT!',
    'BLOCKING THE LANE!',
    'YOU CAN\'T PARK HERE!',
    'JUST GO AROUND!',
    'EVERY DAY WITH THIS!',
  ]
}

function defaultFilmLines(brand: string): readonly string[] {
  return [
    'Caught in 4K!',
    `Classic ${brand}`,
    'Going to reels!',
    'What is it doing?',
    'Staring contest!',
    'Peak San Francisco',
  ]
}

type ServiceSpec = Pick<RobotaxiService, 'id' | 'name' | 'livery' | 'share' | 'stationBoost' | 'stationGlow'> & {
  badge?: string
  station: Omit<RobotaxiStationSpec, 'name' | 'gantryTitle' | 'depotTitle'>
}

export function robotaxiService(spec: ServiceSpec): RobotaxiService {
  const badge = spec.badge ?? spec.name.toUpperCase()
  return {
    ...spec,
    badge,
    station: buildStationGeometry({ ...spec.station, name: `${spec.name} Station`, gantryTitle: badge, depotTitle: 'DEPOT' }),
    yellLines: defaultYellLines(spec.name),
    filmLines: defaultFilmLines(spec.name),
  }
}

export const ROBOTAXI_SERVICES: readonly RobotaxiService[] = [robotaxiService({
  id: 'paymo',
  name: 'PayMo',
  share: 0.18,
  stationBoost: 0.54,
  livery: {
    body: k(STEEL, grey(0)),       // glossy pearl white
    roof: k(STEEL, grey(1)),       // pearl roof cap above the dark glazing
    accent: k(STEEL, hue(10, 4)),  // crisp PayMo emerald-mint lower ribbon
    accentLamp: k(LAMP, hue(11, 4)), // electric cyan-mint visor & display LEDs
    text: k(STEEL, hue(15, 6)),    // high-contrast deep navy door badge
    trim: k(ROOFING, grey(13)),    // sleek dark wheel-arch & rocker cladding
  },
  stationGlow: k(LAMP, hue(10, 4)),
  // Flat open commercial lot on west side of Stockton St between Beach St & North Point St (inside 6-square pilot & 155-square full SF).
  station: {
    lat: 37.80745,
    lon: -122.41062,
    cx: 518520,
    cz: 653904,
    ux: 0.16364,
    uz: 0.98652,
    wx: -0.98652,
    wz: 0.16364,
  },
})]
