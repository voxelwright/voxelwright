// A toy written as data by someone outside the page (#88: a model, from a sentence), checked
// field by field before the world sees it. Only what the registries know: a registered material,
// a registered gadget kind, the settings that kind declares (gadgets.ts `settings`), ports it
// has. Sizes, masses and knobs are clamped and listed; anything that cannot be made sense of,
// a wire to nowhere, or a part outside the surface it stands on refuses the whole toy with one
// plain reason. The answer is data: nothing in it runs, and it gets no keys.
import * as THREE from 'three/webgpu'
import type { Shape, Vec3 } from './core'
import { gadgetKind } from './gadgets'
import { isMaterial } from './materials'
import { MADE_KINDS } from './made-kinds'
import type { GadgetSpec, PartSpec, ToySpec, Wire } from './toy'

/** Where a made toy stands: a surface's top centre, its turn about y, and the room above it (m). */
export interface Surface {
  id: string
  label: string
  at: Vec3
  yaw: number
  /** Half its width (x) and depth (z) in its own frame, and the height a toy may rise to (y). */
  half: [number, number]
  height: number
}

export const MADE = {
  parts: 40,
  /** Moving parts cost every step; ten pins and a ball is 11. */
  moving: 16,
  /** A game is a couple of dozen: a sensor a pin, counters, a round, lamps, a bell (#108). */
  gadgets: 32,
  wires: 64,
  /** Half extents and radii, m. */
  size: [0.004, 0.5] as const,
  /** kg. */
  mass: [0.005, 10] as const,
  /** A part may sink this far into the surface (m) and still be on it. */
  slack: 0.01,
}

/** Materials a made toy may not use: people are not parts. */
const NOT_FOR_TOYS = new Set(['villager'])
const ID = /^[A-Za-z0-9_-]{1,48}$/
const obj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
/** Text from data as plain words: no control characters or angle brackets, at most n characters. */
export const plain = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '')

export type Checked = { toy: ToySpec; clamped: string[] } | { reason: string }

/**
 * A toy from untrusted data, to stand on `surface` with id `id`, or the reason it cannot be made.
 * Parts are in the surface's frame: x across, z along, y up from its top.
 */
export function checkMadeToy(raw: unknown, surface: Surface, id: string): Checked {
  if (!obj(raw)) return { reason: 'there was no toy in the answer' }
  const clamped: string[] = []
  const lists = ['parts', 'gadgets', 'wires'].map((k) => (raw[k] === undefined && k !== 'parts' ? [] : raw[k]))
  if (!lists.every(Array.isArray)) return { reason: 'its parts, gadgets and wires were not lists' }
  const [rawParts, rawGadgets, rawWires] = lists as unknown[][]
  if (!rawParts.length) return { reason: 'it had no parts' }
  if (rawParts.length > MADE.parts) return { reason: `it had ${rawParts.length} parts and a toy may have ${MADE.parts}` }
  if (rawGadgets.length > MADE.gadgets) return { reason: `it had ${rawGadgets.length} gadgets and a toy may have ${MADE.gadgets}` }
  if (rawWires.length > MADE.wires) return { reason: `it had ${rawWires.length} wires and a toy may have ${MADE.wires}` }

  const parts: PartSpec[] = []
  for (const p of rawParts) {
    const part = checkPart(p, surface, clamped)
    if (typeof part === 'string') return { reason: part }
    if (parts.some((q) => q.id === part.id)) return { reason: `two parts were both called ${part.id}` }
    parts.push(part)
  }
  const moving = parts.filter((p) => p.motion === 'dynamic').length
  if (moving > MADE.moving) return { reason: `it had ${moving} moving parts and a toy may have ${MADE.moving}` }

  const ids = new Set(parts.map((p) => p.id))
  const gadgets: GadgetSpec[] = []
  for (const g of rawGadgets) {
    if (!obj(g) || typeof g.id !== 'string' || !ID.test(g.id)) return { reason: 'a gadget had no plain name' }
    if (gadgets.some((o) => o.id === g.id)) return { reason: `two gadgets were both called ${g.id}` }
    const kind = typeof g.kind === 'string' ? gadgetKind(g.kind) : undefined
    if (!kind) return { reason: `there is no gadget called ${plain(g.kind, 32) || 'that'}` }
    // Only the made kit: fire comes from asking for it, and keys are not handed to made toys.
    if (!(MADE_KINDS as readonly string[]).includes(kind.kind)) return { reason: `a made toy can't have a ${kind.kind} in it` }
    const spec: GadgetSpec = { id: g.id, kind: kind.kind }
    if (g.part !== undefined) {
      if (typeof g.part !== 'string' || !ids.has(g.part)) return { reason: `the ${g.id} gadget names a part that is not there` }
      spec.part = g.part
    }
    const needs = kind.needs ?? {}
    if (needs.part && !spec.part) return { reason: `the ${g.id} gadget has no part to work on` }
    if (needs.part === 'moving' && parts.find((p) => p.id === spec.part)?.motion !== 'dynamic') return { reason: `the ${spec.part} can't move, so the ${g.id} gadget can't work it` }
    if (needs.part === 'sensor' && !parts.find((p) => p.id === spec.part)?.sensor) return { reason: `the ${spec.part} is solid, so the ${g.id} gadget can't tell what passes through it` }
    for (const name of needs.settings ?? []) if (g[name] === undefined) return { reason: `the ${g.id} gadget has no ${name}` }
    if (g.knobs !== undefined) {
      if (!obj(g.knobs)) return { reason: `the ${g.id} gadget's knobs were not numbers` }
      const knobs: Record<string, number> = {}
      for (const [name, v] of Object.entries(g.knobs)) {
        const k = Object.hasOwn(kind.knobs, name) ? kind.knobs[name] : undefined
        if (!k || typeof v !== 'number' || !Number.isFinite(v)) {
          clamped.push(`${g.id}.${name}`)
          continue
        }
        knobs[name] = Math.min(k.max, Math.max(k.min, v))
        if (knobs[name] !== v) clamped.push(`${g.id}.${name}`)
      }
      spec.knobs = knobs
    }
    for (const [name, type] of Object.entries(kind.settings ?? {})) {
      const v = g[name]
      if (v === undefined) continue
      if (type === 'input') {
        // A made toy gets no keys: its hinges and pistons rest.
        clamped.push(`${g.id}.${name}`)
        continue
      }
      if (type === 'part') {
        if (typeof v !== 'string' || !ids.has(v)) return { reason: `the ${g.id} gadget names a part that is not there` }
        spec[name] = v
      } else if (type === 'point') {
        if (!vec(v) || !within(v, 0, surface)) return { reason: `the ${g.id} gadget's ${name} is off ${surface.label}` }
        spec[name] = [...v]
      } else {
        const d = vec(v) ? v : null
        const n = d ? Math.hypot(...d) : 0
        if (!d || !(n > 1e-6)) return { reason: `the ${g.id} gadget's ${name} is not a direction` }
        spec[name] = d.map((x) => x / n)
      }
    }
    gadgets.push(spec)
  }

  const wires: Wire[] = []
  const end = (s: unknown, side: 'inputs' | 'outputs') => {
    if (typeof s !== 'string') return null
    const dot = s.lastIndexOf('.')
    const g = gadgets.find((o) => o.id === s.slice(0, dot))
    const port = s.slice(dot + 1)
    return g && gadgetKind(g.kind)![side].includes(port) ? s : null
  }
  for (const w of rawWires) {
    const from = obj(w) ? end(w.from, 'outputs') : null
    const to = obj(w) ? end(w.to, 'inputs') : null
    if (!from || !to) return { reason: `a wire ran ${obj(w) ? `from ${plain(w.from, 40) || 'nowhere'} to ${plain(w.to, 40) || 'nowhere'}` : 'nowhere'}, and one end is not there` }
    if (wires.some((o) => o.from === from && o.to === to)) return { reason: `the wire from ${from} to ${to} was there twice` }
    wires.push({ from, to })
  }
  // No signal may come back round to where it started in one chain: that loop feeds itself every step. Followed port by
  // port (#108): a wire into an input goes on only through the outputs that input can fire at once (the kind's `causes`),
  // so a game's own rings are fine (a round resets its score, whose change the round only remembers; a timer's `done`
  // restarts the toy that started the timer) and a counter wired back into its own `add` is still refused.
  const next = new Map<string, string[]>()
  for (const w of wires) {
    const dot = w.to.lastIndexOf('.')
    const to = w.to.slice(0, dot), kind = gadgetKind(gadgets.find((g) => g.id === to)!.kind)!
    const fired = Object.hasOwn(kind.causes ?? {}, w.to.slice(dot + 1)) ? kind.causes![w.to.slice(dot + 1)] : kind.outputs
    next.set(w.from, [...(next.get(w.from) ?? []), ...fired.map((port) => `${to}.${port}`)])
  }
  const state = new Map<string, 1 | 2>()
  const loops = (out: string): boolean => {
    if (state.get(out) === 1) return true
    if (state.get(out) === 2) return false
    state.set(out, 1)
    if ((next.get(out) ?? []).some(loops)) return true
    state.set(out, 2)
    return false
  }
  const looped = [...next.keys()].find(loops)
  if (looped) return { reason: `its wires run in a loop through the ${looped.slice(0, looped.lastIndexOf('.'))} gadget` }

  const toy: ToySpec = {
    id,
    label: plain(raw.label, 40) || 'Toy',
    frame: { at: [...surface.at], yaw: surface.yaw, tilt: 0 },
    parts, gadgets, wires, inputs: {},
  }
  return { toy, clamped }
}

function checkPart(p: unknown, surface: Surface, clamped: string[]): PartSpec | string {
  if (!obj(p) || typeof p.id !== 'string' || !ID.test(p.id)) return 'a part had no plain name'
  const id = p.id
  if (!isMaterial(p.material) || NOT_FOR_TOYS.has(p.material)) return `there is no material called ${plain(p.material, 32) || 'that'} for the ${id}`
  const motion = p.motion === undefined ? 'static' : p.motion
  if (motion !== 'static' && motion !== 'dynamic') return `the ${id} can stand still or move freely, nothing else`
  if (!vec(p.at)) return `the ${id} has no place`
  if (p.turn !== undefined && !vec(p.turn)) return `the ${id}'s turn is not three angles`
  const size = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return NaN
    const c = Math.min(MADE.size[1], Math.max(MADE.size[0], v))
    if (c !== v) clamped.push(`${id}.${name}`)
    return c
  }
  const s = p.shape
  let shape: Shape
  if (!obj(s)) return `the ${id} has no shape`
  if (s.kind === 'box' && vec(s.half)) shape = { kind: 'box', half: s.half.map((v, i) => size(v, `half[${i}]`)) as Vec3 }
  else if (s.kind === 'sphere') shape = { kind: 'sphere', radius: size(s.radius, 'radius') }
  else if (s.kind === 'cylinder' || s.kind === 'capsule') shape = { kind: s.kind, halfHeight: size(s.halfHeight, 'halfHeight'), radius: size(s.radius, 'radius') }
  else return `the ${id} is a box, a sphere, a cylinder or a capsule`
  if (Object.values(shape).flat().some((v) => typeof v === 'number' && Number.isNaN(v))) return `the ${id}'s sizes are not numbers`
  const part: PartSpec = { id, shape, material: p.material, at: [...p.at] }
  if (motion === 'dynamic') part.motion = 'dynamic'
  if (p.turn !== undefined) part.turn = (p.turn as Vec3).map((a) => Math.max(-Math.PI, Math.min(Math.PI, a))) as Vec3
  if (typeof p.paint === 'string' && /^#[0-9a-f]{6}$/i.test(p.paint)) part.paint = p.paint
  if (p.sensor === true) part.sensor = true
  // Only a trigger volume may go unseen (#108: the line a throw crosses): it never pushes, so nothing invisible is in anyone's way.
  if (p.sensor === true && p.hidden === true) part.hidden = true
  if (p.mass !== undefined && motion === 'dynamic') {
    if (typeof p.mass !== 'number' || !Number.isFinite(p.mass)) clamped.push(`${id}.mass`)
    else {
      part.mass = Math.min(MADE.mass[1], Math.max(MADE.mass[0], p.mass))
      if (part.mass !== p.mass) clamped.push(`${id}.mass`)
    }
  }
  if (!within(part.at, extent(part), surface)) return `the ${id} would stand off ${surface.label}`
  return part
}

/** Half the size of a part's box, in the surface's frame, turned as it is. */
function extent(part: PartSpec): Vec3 {
  const s = part.shape
  const local: Vec3 = s.kind === 'box' ? s.half : s.kind === 'sphere' ? [s.radius, s.radius, s.radius]
    : s.kind === 'cylinder' ? [s.radius, s.halfHeight, s.radius] : s.kind === 'capsule' ? [s.radius, s.halfHeight + s.radius, s.radius] : [0, 0, 0]
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(part.turn ?? [0, 0, 0]))).elements
  // Column-major: row i of |R| times the local half extents.
  return [0, 1, 2].map((i) => Math.abs(m[i]) * local[0] + Math.abs(m[i + 4]) * local[1] + Math.abs(m[i + 8]) * local[2]) as Vec3
}

/** Whether a box (centre, half extents) stays over the surface and under its height. */
function within(at: Vec3, half: Vec3 | 0, surface: Surface) {
  const h = half === 0 ? [0, 0, 0] : half
  return Math.abs(at[0]) + h[0] <= surface.half[0] + 1e-6 && Math.abs(at[2]) + h[2] <= surface.half[1] + 1e-6
    && at[1] - h[1] >= -MADE.slack && at[1] + h[1] <= surface.height + 1e-6
}
