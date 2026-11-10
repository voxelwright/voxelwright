// The person's own looks, kept in this browser (`village.themes`), and what is kept
// with them: the last chosen look and which villagers keep their costume.
import type { Hex, Shift, Surface, Surfaces, Theme } from './tokens'
import { shape } from './blend'

const KEY = 'village.themes'
const LAST = 'village.theme.last'
const COSTUMES = 'village.theme.costumes'

/** One saved look: `from` is the built-in it was made from, `theme` its tokens as they were. */
export interface Saved { id: string; label: string; from: string; theme: unknown }

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const ID = /^mine-[a-z0-9-]{1,48}$/
export function readSaved(): Saved[] {
  const list = read(KEY)
  if (!Array.isArray(list)) return []
  return list.filter((r): r is Saved => Boolean(r) && typeof r === 'object'
    && typeof r.id === 'string' && ID.test(r.id)
    && typeof r.label === 'string' && r.label.length > 0 && r.label.length <= 40
    && typeof r.from === 'string')
}
export const writeSaved = (list: Saved[]) => write(KEY, list)

export function readLast(): string | null {
  const id = read(LAST)
  return typeof id === 'string' ? id : null
}
export const writeLast = (id: string) => write(LAST, id)

export function readCostumes(): Record<string, boolean> {
  const map = read(COSTUMES)
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {}
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v === true))
}
export const writeCostumes = (map: Record<string, boolean>) => write(COSTUMES, map)

/**
 * The narrow way back for a look saved here, while `check()` is not built: only colours
 * (#rrggbb) and clamped numbers are taken from storage; everything structural (stages and
 * their palettes, paint names, vetoes, reflections, sky, hints) comes from the built-in
 * the look was made from, and the stored look must have had that built-in's shape.
 */
export function revive(record: Saved, base: Theme): Theme | null {
  const data = record.theme as Theme
  if (!data || typeof data !== 'object' || !data.light || !data.surfaces || !data.post || !data.fog) return null
  try {
    // Vetoes come from the built-in (below), so a look saved before its built-in vetoed a new feature still comes back.
    if (shape({ ...data, post: { ...data.post, veto: base.post.veto } }) !== shape(base)) return null
  } catch {
    return null
  }
  const hex = (v: unknown): Hex | undefined => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined)
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
  const opt = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined)
  const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
  const shift = (s: Shift | undefined): Shift => clean({ color: hex(s?.color), tint: opt(s?.tint, 0, 1), gain: opt(s?.gain, 0, 4) })
  const surface = (s: Surface | undefined, b: Surface | undefined): Surface => clean({
    ...shift(s), roughness: opt(s?.roughness, 0, 1), metalness: opt(s?.metalness, 0, 1),
    emissive: hex(s?.emissive), glow: opt(s?.glow, 0, 8), paint: b?.paint,
  })
  const surfaces = {} as Surfaces
  for (const role of ['wall', 'floor', 'view', 'beam', 'glow', 'other', 'trim', 'backdrop'] as const) {
    const s = data.surfaces[role]
    if (s || base.surfaces[role]) surfaces[role] = surface(s, base.surfaces[role])
  }
  const p = data.post, b = base.post
  const three = (v: unknown, lo: number, hi: number, fb: [number, number, number]) =>
    [0, 1, 2].map((i) => num(Array.isArray(v) ? v[i] : undefined, lo, hi, fb[i])) as [number, number, number]
  return {
    ...base,
    id: record.id,
    label: record.label,
    light: {
      key: shift(data.light.key), rim: shift(data.light.rim), practical: shift(data.light.practical),
      fill: clean({ ...shift(data.light.fill), ground: hex(data.light.fill?.ground) }),
      exposure: num(data.light.exposure, 0.1, 4, base.light.exposure),
    },
    surfaces,
    fog: shift(data.fog),
    post: {
      ...b,
      bloom: { strength: num(p.bloom?.strength, 0, 3, b.bloom.strength), radius: num(p.bloom?.radius, 0, 1, b.bloom.radius), threshold: num(p.bloom?.threshold, 0, 2, b.bloom.threshold) },
      vignette: { amount: num(p.vignette?.amount, 0, 1, b.vignette.amount), inner: num(p.vignette?.inner, 0, 2, b.vignette.inner), outer: num(p.vignette?.outer, 0, 2, b.vignette.outer) },
      warm: three(p.warm, 0, 2, b.warm),
      grain: num(p.grain, 0, 1, b.grain),
      grade: { saturation: num(p.grade?.saturation, 0, 3, b.grade.saturation), contrast: num(p.grade?.contrast, 0.2, 3, b.grade.contrast), lift: three(p.grade?.lift, -0.2, 0.2, b.grade.lift) },
      ...(b.sky ? { sky: hex(p.sky) ?? b.sky } : {}),
      ...(b.reflect ? {
        reflect: {
          ...b.reflect,
          maxDistance: num(p.reflect?.maxDistance, 0, 20, b.reflect.maxDistance),
          thickness: num(p.reflect?.thickness, 0, 2, b.reflect.thickness),
          strength: num(p.reflect?.strength, 0, 4, b.reflect.strength),
        },
      } : {}),
    },
  }
}
