import type { Shock } from './page/residents.ts'

export const REACH: number
export const WALK_MOST: number
export const STRIDE: number
export const CYCLE: number
export const GREEN: number
export const AMBER: number
export const WALK: number
export const RING1_RADIUS: number
export const RING2_RADIUS: number
export const RING3_RADIUS: number
export const DEFAULT_RING_CAPS: Readonly<{ 1: number; 2: number; 3: number }>

export type Archetype = 'commuter' | 'shopkeeper' | 'tourist' | 'runner' | 'night_owl' | 'resident'
export type SchedulePhase = 'morning_commute' | 'work_day' | 'evening_commute' | 'nightlife' | 'late_quiet'
export type DestinationBias = 'balanced' | 'transit_hub' | 'commercial' | 'residential' | 'scenic' | 'nightlife' | 'covered_storefront'
export type LodRing = 0 | 1 | 2 | 3

export const ARCHETYPES: readonly Archetype[]
export const HOME_HOURS: readonly number[]
export const SHOPS: readonly number[]

export interface RoutineInfo {
  archetype: Archetype
  phase: SchedulePhase
  activity: string
  shelter: boolean
  umbrella: boolean
  speedScale: number
  dwellScale: number
  destinationBias: DestinationBias
  presence: number
}

export interface WalkJunction {
  x: number
  z: number
  ax: number
  az: number
  offset: number
  lights: boolean
}

export interface WalkEdge {
  a: number
  b: number
  kind: number
  busy: number
  signal: number
  p: Float64Array
  cum: Float64Array
  len: number
  homes: number
  seed: number
  mx: number
  mz: number
}

export interface WalkSquareData {
  walk?: number[][]
  roads?: (number | number[])[][]
}

export interface EvaluatedPedestrian {
  seed: number
  id: string
  x: number
  z: number
  hx: number
  hz: number
  yaw: number
  speed: number
  s: number
  stride: number
  walking: number
  still: boolean
  far: boolean
  stood: number
  pause: number
  waiting: boolean
  crossing: boolean
  kind: number
  sig: number
  cdx: number
  cdz: number
  phase: SchedulePhase
  archetype: Archetype
  activity: string
  shelter: boolean
  umbrella: boolean
  destinationBias: DestinationBias
  originX: number
  originZ: number
  destX: number
  destZ: number
  round: number
  at: [number, number, number]
  home: [number, number, number]
  wi: number
  dist: number
  lod: 1 | 2 | 3
  down: number
  flinch: number
  towards: number
  turned: number
  frozen: boolean
  routeTime: number
}

export interface LodStats {
  ring1: number
  ring2: number
  ring3: number
  total: number
  capped: number
  suppressedTaken: number
  caps: { 1: number; 2: number; 3: number }
}

export interface QueryOptions {
  reach?: number
  t?: number
  hour?: number
  rain?: number
  taken?: { has(seed: number): boolean }
  shocks?: readonly Shock[]
  crashShocks?: readonly Shock[]
  feetAt?: (x: number, z: number) => number
  timeOf?: (seed: number, baseTime: number, shockState: { when: number; down: number; flinch: number; towards: number; turned: number; frozen: boolean }) => number
  caps?: Partial<{ 1: number; 2: number; 3: number }>
  applyCaps?: boolean
  ring3Feet?: boolean
}

export interface WhereaboutsResult {
  seed: number
  id: string
  x: number
  z: number
  hx: number
  hz: number
  yaw: number
  speed: number
  s: number
  stride: number
  walking: number
  still: boolean
  far: boolean
  stood: number
  pause: number
  waiting: boolean
  crossing: boolean
  kind: number
  sig: number
  cdx: number
  cdz: number
  phase: SchedulePhase
  archetype: Archetype
  activity: string
  shelter: boolean
  umbrella: boolean
  destinationBias: DestinationBias
  originX: number
  originZ: number
  destX: number
  destZ: number
  round: number
  at: [number, number, number]
  home: [number, number, number]
  down: number
  flinch: number
  frozen: boolean
}

export interface WalkGraph {
  addSquare(name: string, data: WalkSquareData): boolean
  hasSquare(name: string): boolean
  readonly squareCount: number
  readonly walkCount: number
  readonly residentCount: number
  readonly walks: readonly WalkEdge[]
  junctionOf(node: number): WalkJunction
  placeOf(wi: number, seed: number, t: number, hour?: number, rain?: number, out?: Partial<EvaluatedPedestrian>): EvaluatedPedestrian
  whereabouts(seed: number, home: readonly [number, number, number] | undefined, t: number, hour?: number, rain?: number, opts?: { shocks?: readonly Shock[]; crashShocks?: readonly Shock[]; feetAt?: (x: number, z: number) => number }): WhereaboutsResult | null
  findResident(seed: number, home?: readonly [number, number, number]): { wi: number; h: number } | null
  query(eye: readonly [number, number], opts?: QueryOptions): { people: EvaluatedPedestrian[]; stats: LodStats }
  trace(seed: number, times: readonly number[], hour?: number, rain?: number): Array<{ t: number; x: number; z: number; s: number; still: boolean; far: boolean; waiting: boolean; crossing: boolean; kind: number; walking: number; archetype: Archetype; phase: SchedulePhase; activity: string }> | null
}

export function chance(seed: number, ask: number): number
export function mix(a: number, b: number): number
export function idSeed(n: number): number
export function residentId(seed: number): string
export function ease(v: number): number
export function hourly(table: readonly number[], hour: number): number
export function homeHours(hour: number): number
export function squareBounds(name: string): [number, number, number, number]
export function classifyLod(distCells: number): LodRing
export function schedulePhase(hour: number): SchedulePhase
export function archetypeOf(seed: number, busy?: number): Archetype
export function routineOf(seed: number, busy: number, hour: number, rain?: number): RoutineInfo
export function along(p: ArrayLike<number>, cum: ArrayLike<number>, s: number, into: { x: number; z: number; tx: number; tz: number }): number
export function phaseOf(j: WalkJunction, dx: number, dz: number): 0 | 1
export function cycleAt(j: WalkJunction, t: number): number
export function lightFor(j: WalkJunction, dx: number, dz: number, t: number): 'green' | 'amber' | 'red'
export function createWalkGraph(): WalkGraph
