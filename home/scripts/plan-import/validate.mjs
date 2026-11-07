// Trusted validation of model output. The model's JSON is data: nothing here trusts it.
import { arcInfo } from './geom.mjs'

// Pull the first top-level JSON object out of a reply (tolerates code fences and prose).
export function extractJson(text) {
  const start = text.indexOf('{')
  if (start < 0) throw new Error('no JSON object in reply')
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1))
  }
  throw new Error('unterminated JSON object')
}

const num = (v) => typeof v === 'number' && Number.isFinite(v)

export function validate(data) {
  const reasons = []
  const fail = (r) => { reasons.push(r); return { ok: false, reasons } }
  if (!data || typeof data !== 'object') return fail('top level is not an object')
  if (data.version !== 1) reasons.push('version must be 1')
  if (data.units !== 'm') reasons.push('units must be "m"')
  for (const k of ['corners', 'walls', 'openings', 'rooms']) if (!Array.isArray(data[k])) return fail(`${k} must be an array`)

  const ids = new Set()
  const uniq = (id, what) => { if (typeof id !== 'string' || !id) reasons.push(`${what} has a missing id`); else if (ids.has(id)) reasons.push(`duplicate id ${id}`); else ids.add(id) }
  const corner = new Map()
  for (const c of data.corners) { uniq(c.id, 'corner'); if (!num(c.x) || !num(c.z)) reasons.push(`corner ${c.id} needs numeric x and z`); corner.set(c.id, c) }
  const wall = new Map(), lengths = new Map(), edges = new Set()
  for (const w of data.walls) {
    uniq(w.id, 'wall'); wall.set(w.id, w)
    const a = corner.get(w.a), b = corner.get(w.b)
    if (!a || !b) { reasons.push(`wall ${w.id} references unknown corner ${!a ? w.a : w.b}`); continue }
    if (w.a === w.b) { reasons.push(`wall ${w.id} starts and ends at the same corner`); continue }
    if (!num(w.thickness) || w.thickness < 0.05 || w.thickness > 1) reasons.push(`wall ${w.id} thickness ${w.thickness} is outside 0.05-1 m`)
    if (!num(w.sagitta)) { reasons.push(`wall ${w.id} sagitta must be a number (0 for straight)`); continue }
    const chord = Math.hypot(b.x - a.x, b.z - a.z)
    if (Math.abs(w.sagitta) > chord / 2 + 1e-9) reasons.push(`wall ${w.id} sagitta ${w.sagitta} exceeds half its chord ${chord.toFixed(2)} (more than a half circle); split it`)
    const L = arcInfo(a, b, w.sagitta).length
    lengths.set(w.id, L)
    if (L < 0.5 || L > 30) reasons.push(`wall ${w.id} is ${L.toFixed(2)} m long; walls must be 0.5-30 m`)
    edges.add(`${w.a}|${w.b}`); edges.add(`${w.b}|${w.a}`)
  }
  for (const o of data.openings) {
    uniq(o.id, 'opening')
    if (o.kind !== 'door' && o.kind !== 'window') reasons.push(`opening ${o.id} kind must be door or window`)
    if (!wall.has(o.wall)) { reasons.push(`opening ${o.id} references unknown wall ${o.wall}`); continue }
    const L = lengths.get(o.wall)
    if (!num(o.from) || !num(o.to) || !(o.from < o.to)) { reasons.push(`opening ${o.id} needs numeric from < to`); continue }
    if (L != null && (o.from < -0.01 || o.to > L + 0.01)) reasons.push(`opening ${o.id} spans ${o.from}-${o.to} m but wall ${o.wall} is ${L.toFixed(2)} m long`)
  }
  for (const r of data.rooms) {
    uniq(r.id, 'room')
    if (typeof r.label !== 'string') reasons.push(`room ${r.id} needs a label`)
    if (!Array.isArray(r.loop) || r.loop.length < 3) { reasons.push(`room ${r.id} loop needs at least 3 corners`); continue }
    const bad = r.loop.filter((id) => !corner.has(id))
    if (bad.length) { reasons.push(`room ${r.id} references unknown corners ${bad.join(', ')}`); continue }
    const gaps = r.loop.map((id, i) => [id, r.loop[(i + 1) % r.loop.length]]).filter(([p, q]) => !edges.has(`${p}|${q}`))
    if (gaps.length) reasons.push(`room ${r.id} is not closed: no wall joins ${gaps.map(([p, q]) => `${p}-${q}`).join(', ')}`)
  }
  return { ok: reasons.length === 0, reasons }
}
