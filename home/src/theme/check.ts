// Untrusted data to a Theme (#50). Everything that did not come from a preset module
// (a model, local storage, an edit) passes through here before setTheme. The output is
// built field by field from scratch: known keys only, read as own properties; numbers
// clamped; colours exactly #rrggbb; stage kinds and painters from fixed lists; strings
// one line and short. Missing fields come from HOME, so a partial theme works.
import type { Hex, Lighting, Post, Shift, Stage, Surface, Surfaces, Theme } from './tokens'
import { HOME } from './presets/home'
import { PAINTERS } from './paint'

type Obj = Record<string, unknown>

/** Features a theme may turn off (renderer.ts tiers plus the opt-in ?fx= ones). Vetoing only removes work. */
const VETOES = ['phys', 'traa', 'csm', 'gtao', 'ssgi']
const MAX_PALETTE = 64
const MAX_STAGES = 6
const HEX = /^#[0-9a-f]{6}$/
const ID = /^[a-z][a-z0-9-]{0,39}$/

const own = (o: unknown, key: string): unknown =>
  o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, key) ? (o as Obj)[key] : undefined
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Checks one theme, and says what it had to change. A refusal names why; nothing is half-made. */
export function checkTheme(data: unknown): { theme: Theme; clamped: string[] } | { reason: string } {
  if (!isObj(data)) return { reason: 'a theme is an object' }
  const clamped: string[] = []
  const note = (path: string) => clamped.push(path)

  /** A finite number within [lo, hi]; out of range is clamped and noted, anything else falls back. */
  const num = (v: unknown, path: string, lo: number, hi: number, fallback: number): number => {
    if (v === undefined) return fallback
    if (typeof v !== 'number' || !Number.isFinite(v)) return note(path), fallback
    if (v < lo || v > hi) return note(path), Math.min(hi, Math.max(lo, v))
    return v
  }
  const optNum = (v: unknown, path: string, lo: number, hi: number): number | undefined =>
    v === undefined ? undefined : typeof v === 'number' && Number.isFinite(v) ? num(v, path, lo, hi, 0) : (note(path), undefined)
  const color = (v: unknown, path: string): Hex | undefined => {
    if (v === undefined) return undefined
    const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (HEX.test(s)) return s
    return note(path), undefined
  }
  /** One plain line: no control characters, collapsed spaces, cut to max. */
  const text = (v: unknown, path: string, max: number, fallback: string): string => {
    if (typeof v !== 'string') return v === undefined ? fallback : (note(path), fallback)
    const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!s) return fallback
    if (s.length > max) note(path)
    return s.slice(0, max)
  }
  const triple = (v: unknown, path: string, lo: number, hi: number, fallback: readonly number[]): [number, number, number] => {
    if (v !== undefined && (!Array.isArray(v) || v.length !== 3)) note(path)
    const a = Array.isArray(v) && v.length === 3 ? v : fallback
    return [0, 1, 2].map((i) => num(a[i], `${path}[${i}]`, lo, hi, fallback[i])) as [number, number, number]
  }

  const shift = (v: unknown, path: string): Shift => {
    const out: Shift = {}
    if (v !== undefined && !isObj(v)) note(path)
    const c = color(own(v, 'color'), `${path}.color`)
    if (c) out.color = c
    const tint = optNum(own(v, 'tint'), `${path}.tint`, 0, 1)
    if (tint !== undefined) out.tint = tint
    const gain = optNum(own(v, 'gain'), `${path}.gain`, 0, 4)
    if (gain !== undefined) out.gain = gain
    return out
  }
  const surface = (v: unknown, path: string): Surface => {
    const out: Surface = shift(v, path)
    const roughness = optNum(own(v, 'roughness'), `${path}.roughness`, 0, 1)
    if (roughness !== undefined) out.roughness = roughness
    const metalness = optNum(own(v, 'metalness'), `${path}.metalness`, 0, 1)
    if (metalness !== undefined) out.metalness = metalness
    const emissive = color(own(v, 'emissive'), `${path}.emissive`)
    if (emissive) out.emissive = emissive
    const glow = optNum(own(v, 'glow'), `${path}.glow`, 0, 4)
    if (glow !== undefined) out.glow = glow
    const paint = own(v, 'paint')
    if (typeof paint === 'string' && Object.hasOwn(PAINTERS, paint)) out.paint = paint
    else if (paint !== undefined) note(`${path}.paint`)
    return out
  }

  const L = own(data, 'light')
  const fillIn = own(L, 'fill')
  const fill: Lighting['fill'] = shift(fillIn, 'light.fill')
  const ground = color(own(fillIn, 'ground'), 'light.fill.ground')
  if (ground) fill.ground = ground
  const light: Lighting = {
    key: shift(own(L, 'key'), 'light.key'),
    fill,
    rim: shift(own(L, 'rim'), 'light.rim'),
    practical: shift(own(L, 'practical'), 'light.practical'),
    exposure: num(own(L, 'exposure'), 'light.exposure', 0.3, 3, HOME.light.exposure),
  }

  const S = own(data, 'surfaces')
  const surfaces: Surfaces = {
    wall: surface(own(S, 'wall'), 'surfaces.wall'),
    floor: surface(own(S, 'floor'), 'surfaces.floor'),
    view: surface(own(S, 'view'), 'surfaces.view'),
    beam: surface(own(S, 'beam'), 'surfaces.beam'),
    glow: surface(own(S, 'glow'), 'surfaces.glow'),
    other: surface(own(S, 'other'), 'surfaces.other'),
  }
  for (const role of ['trim', 'backdrop'] as const) {
    const v = own(S, role)
    if (isObj(v)) surfaces[role] = surface(v, `surfaces.${role}`)
    else if (v !== undefined) note(`surfaces.${role}`)
  }

  const P = own(data, 'post')
  const h = HOME.post
  const bloom = own(P, 'bloom'), vignette = own(P, 'vignette'), grade = own(P, 'grade')
  const post: Post = {
    bloom: {
      strength: num(own(bloom, 'strength'), 'post.bloom.strength', 0, 2, h.bloom.strength),
      radius: num(own(bloom, 'radius'), 'post.bloom.radius', 0, 1, h.bloom.radius),
      threshold: num(own(bloom, 'threshold'), 'post.bloom.threshold', 0, 1.5, h.bloom.threshold),
    },
    vignette: {
      amount: num(own(vignette, 'amount'), 'post.vignette.amount', 0, 1, h.vignette.amount),
      inner: num(own(vignette, 'inner'), 'post.vignette.inner', 0, 1.5, h.vignette.inner),
      outer: num(own(vignette, 'outer'), 'post.vignette.outer', 0, 2, h.vignette.outer),
    },
    warm: triple(own(P, 'warm'), 'post.warm', 0.5, 1.5, h.warm),
    grain: num(own(P, 'grain'), 'post.grain', 0, 0.5, h.grain),
    grade: {
      saturation: num(own(grade, 'saturation'), 'post.grade.saturation', 0, 2.5, h.grade.saturation),
      contrast: num(own(grade, 'contrast'), 'post.grade.contrast', 0.5, 2, h.grade.contrast),
      lift: triple(own(grade, 'lift'), 'post.grade.lift', -0.1, 0.1, h.grade.lift),
    },
    veto: [],
    stages: [],
  }
  const sky = color(own(P, 'sky'), 'post.sky')
  if (sky) post.sky = sky
  const reflect = own(P, 'reflect')
  if (isObj(reflect)) post.reflect = {
    maxDistance: num(own(reflect, 'maxDistance'), 'post.reflect.maxDistance', 0, 10, 4),
    thickness: num(own(reflect, 'thickness'), 'post.reflect.thickness', 0.01, 1, 0.15),
    resolutionScale: num(own(reflect, 'resolutionScale'), 'post.reflect.resolutionScale', 0.25, 0.5, 0.33),
    strength: num(own(reflect, 'strength'), 'post.reflect.strength', 0, 3, 1),
  }
  else if (reflect !== undefined) note('post.reflect')
  const veto = own(P, 'veto')
  if (Array.isArray(veto)) {
    for (const f of veto.slice(0, VETOES.length * 2)) if (typeof f === 'string' && VETOES.includes(f) && !post.veto.includes(f)) post.veto.push(f)
    if (post.veto.length !== veto.length) note('post.veto')
  } else if (veto !== undefined) note('post.veto')
  const stages = own(P, 'stages')
  if (Array.isArray(stages)) {
    if (stages.length > MAX_STAGES) note('post.stages')
    stages.slice(0, MAX_STAGES).forEach((s, i) => {
      const made = stage(s, `post.stages[${i}]`)
      if (made) post.stages.push(made)
      else note(`post.stages[${i}]`)
    })
  } else if (stages !== undefined) note('post.stages')

  function stage(s: unknown, path: string): Stage | null {
    const k = own(s, 'kind')
    const n = (key: string, lo: number, hi: number, fallback: number) => num(own(s, key), `${path}.${key}`, lo, hi, fallback)
    const opt = (key: string, lo: number, hi: number) => optNum(own(s, key), `${path}.${key}`, lo, hi)
    const c = (key: string) => color(own(s, key), `${path}.${key}`)
    const extra = (base: Stage, add: Record<string, unknown>): Stage => {
      for (const [key, v] of Object.entries(add)) if (v !== undefined) (base as Obj)[key] = v
      return base
    }
    switch (k) {
      case 'pixel': {
        const raw = own(s, 'palette')
        const list = Array.isArray(raw) ? raw.slice(0, MAX_PALETTE) : []
        if (Array.isArray(raw) && raw.length > MAX_PALETTE) note(`${path}.palette`)
        const palette = [...new Set(list.map((p, j) => color(p, `${path}.palette[${j}]`)).filter((p): p is Hex => Boolean(p)))]
        if (palette.length < 2) return null
        return extra({ kind: 'pixel', height: Math.round(n('height', 64, 720, 225)), palette, dither: n('dither', 0, 0.5, 0.04) },
          { outline: opt('outline', 0, 1), crease: opt('crease', 0, 1), samples: own(s, 'samples') === undefined ? undefined : Math.round(n('samples', 0, 4, 0)) })
      }
      case 'halftone':
        return extra({ kind: 'halftone', cell: n('cell', 2, 32, 6), angle: n('angle', -180, 180, 45), strength: n('strength', 0, 1, 0.6) }, { ink: c('ink'), paper: c('paper') })
      case 'ink':
        return extra({ kind: 'ink', width: n('width', 0.5, 6, 1.5), depth: n('depth', 0, 1, 0.5), normal: n('normal', 0, 1, 0.5) }, { color: c('color') })
      case 'chroma':
        return extra({ kind: 'chroma', offset: n('offset', 0, 8, 1.5) }, { angle: opt('angle', -180, 180) })
      case 'brush':
        return { kind: 'brush', radius: n('radius', 1, 10, 4), strength: n('strength', 0, 1, 0.7) }
      case 'paper':
        return extra({ kind: 'paper', grain: n('grain', 0, 1, 0.4), edges: n('edges', 0, 1, 0.4) }, { tint: c('tint') })
      default:
        return null
    }
  }

  const label = text(own(data, 'label'), 'label', 40, 'A new look')
  const rawId = own(data, 'id')
  let id = typeof rawId === 'string' && ID.test(rawId) ? rawId : ''
  if (!id) {
    if (rawId !== undefined) note('id')
    id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 40) || 'written'
  }
  const fps = own(own(data, 'motion'), 'characterFps')
  const costumes = own(data, 'costumes'), props = own(data, 'props')
  const theme: Theme = {
    id,
    label,
    about: text(own(data, 'about'), 'about', 200, ''),
    light,
    surfaces,
    fog: shift(own(data, 'fog'), 'fog'),
    post,
    motion: fps === undefined ? {} : { characterFps: Math.round(num(fps, 'motion.characterFps', 4, 60, 12)) },
    costumes: {
      follow: own(costumes, 'follow') === false ? false : true,
      hint: text(own(costumes, 'hint'), 'costumes.hint', 200, HOME.costumes.hint),
    },
    props: { hint: text(own(props, 'hint'), 'props.hint', 200, HOME.props.hint) },
  }
  return { theme, clamped }
}

/** Untrusted data to a Theme, or the reason it was refused. */
export function check(data: unknown): Theme | string {
  const r = checkTheme(data)
  return 'reason' in r ? r.reason : r.theme
}
