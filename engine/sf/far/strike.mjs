// Where a line of sight meets the far model (#450): the nearest face of a release's far tiles along a ray, worked out
// from the tiles as files, with no GPU. For seating a sign on a tower the far model draws (sf/boards.mjs `seat`) and
// for the check that it lies on that wall (test/sf-boards.mjs).
//
//   import { striker } from './far/strike.mjs'
//   const strike = striker('<release folder with manifest.json>')
//   strike([x, y, z], [dx, dy, dz])   // cells and a unit vector -> { t, at, normal, id, top } or null
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function striker(release) {
  const far = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8')).far
  const held = new Map()
  /** A tile's faces, every band: the words of each object and its sections (pack.mjs says the layout). */
  const tile = (key) => {
    if (held.has(key)) return held.get(key)
    const objects = []
    for (const rec of far.tiles[key] ?? []) {
      if (!rec) continue
      const b = readFileSync(join(release, rec.path)), length = b.readUInt32LE(4), head = JSON.parse(b.subarray(8, 8 + length).toString())
      const g = b.subarray(8 + length), n = g.length / 20, flat = Buffer.alloc(g.length)
      if (head.grouped) for (let j = 0; j < 20; j++) for (let i = 0; i < n; i++) flat[i * 20 + j] = g[j * n + i]
      else g.copy(flat)
      objects.push({ head, words: new Uint32Array(flat.buffer, flat.byteOffset, flat.length / 4) })
    }
    held.set(key, objects)
    return objects
  }
  return (from, dir, most = 60000) => {
    // The tiles the ray crosses, on the ground.
    const keys = new Set()
    for (let t = 0; t <= most + far.size / 8; t += far.size / 8) keys.add(`${Math.floor((from[0] + dir[0] * t) / far.size)}_${Math.floor((from[2] + dir[2] * t) / far.size)}`)
    let best = null
    for (const key of keys) for (const { head, words: w } of tile(key)) for (const s of head.sections) {
      const { pos, cell, c0, c2 } = s
      // A section the ray passes by (its box in the world's cells) is not looked into.
      let t0 = 0, t1 = best ? best.t : most
      for (let a = 0; a < 3 && t0 <= t1; a++) {
        if (Math.abs(dir[a]) < 1e-9) { if (from[a] < s.lo[a] - 1 || from[a] > s.hi[a] + 1) t0 = Infinity; continue }
        const a0 = (s.lo[a] - 1 - from[a]) / dir[a], a1 = (s.hi[a] + 1 - from[a]) / dir[a]
        t0 = Math.max(t0, Math.min(a0, a1)); t1 = Math.min(t1, Math.max(a0, a1))
      }
      if (t0 > t1) continue
      // The ray in the section's own frame: along c0, up, along c2, in its cells across and the world's cells up.
      const rel = [from[0] - pos[0], from[1] - pos[1], from[2] - pos[2]]
      const o = [(rel[0] * c0[0] + rel[2] * c0[2]) / cell, rel[1], (rel[0] * c2[0] + rel[2] * c2[2]) / cell], d = [(dir[0] * c0[0] + dir[2] * c0[2]) / cell, dir[1], (dir[0] * c2[0] + dir[2] * c2[2]) / cell]
      for (let i = s.start; i < s.start + s.count; i++) {
        const w0 = w[i * 5], w1 = w[i * 5 + 1], w2 = w[i * 5 + 2]
        const x = w0 & 0x7ff, z = (w0 >>> 11) & 0x7ff, lu = w0 >>> 22, y0 = w1 & 0xffff, y1 = w1 >>> 16, lw = w2 & 0x3ff, axis = (w2 >>> 10) & 3, side = (w2 >>> 12) & 1
        let t, n
        if (axis === 0) {
          if (d[1] >= 0) continue
          t = (y1 - o[1]) / d[1]
          const px = o[0] + d[0] * t, pz = o[2] + d[2] * t
          if (px < x || px > x + lu || pz < z || pz > z + lw) continue
          n = [0, 1, 0]
        } else if (axis === 1) {
          const out = side * 2 - 1
          if (d[0] * out >= 0) continue
          t = (x + side - o[0]) / d[0]
          const py = o[1] + d[1] * t, pz = o[2] + d[2] * t
          if (py < y0 || py > y1 || pz < z || pz > z + lw) continue
          n = c0.map((c) => c * out)
        } else {
          const out = side * 2 - 1
          if (d[2] * out >= 0) continue
          t = (z + side - o[2]) / d[2]
          const py = o[1] + d[1] * t, px = o[0] + d[0] * t
          if (py < y0 || py > y1 || px < x || px > x + lu) continue
          n = c2.map((c) => c * out)
        }
        if (t > 1 && t <= most && (!best || t < best.t)) best = { t, at: [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t], normal: n, id: w[i * 5 + 4], pyramid: (w2 & (1 << 29)) !== 0, top: pos[1] + y1, foot: pos[1] + y0, layer: s.layer }
      }
    }
    return best
  }
}

/** The ray through a pixel of the realm's first picture (sf/realm.json `arrive`, `fov`, `roll`; page/main.ts `view`), `size` across and down: [from, dir]. */
export function sight(realm, size, px, py) {
  const eye = realm.arrive.at, yaw = realm.arrive.yaw, pitch = realm.arrive.pitch, roll = ((realm.roll ?? 0) * Math.PI) / 180
  const cp = Math.cos(pitch), f = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp], level = [Math.cos(yaw), 0, Math.sin(yaw)]
  const plumb = [level[1] * f[2] - level[2] * f[1], level[2] * f[0] - level[0] * f[2], level[0] * f[1] - level[1] * f[0]]
  const cr = Math.cos(roll), sr = Math.sin(roll), r = [0, 1, 2].map((i) => level[i] * cr + plumb[i] * sr), u = [0, 1, 2].map((i) => plumb[i] * cr - level[i] * sr)
  const tanHalf = Math.tan((realm.fov * Math.PI) / 360), nx = ((px / size[0]) * 2 - 1) * tanHalf * (size[0] / size[1]), ny = (1 - (py / size[1]) * 2) * tanHalf
  const d = [0, 1, 2].map((i) => f[i] + r[i] * nx + u[i] * ny), n = Math.hypot(d[0], d[1], d[2])
  return [eye, d.map((v) => v / n)]
}

/**
 * The wall of the far model seen at a pixel of the first picture: the upright plane through what the rays round that
 * pixel meet (a wall that lies across the tiles' own grid is steps of it, and the plane is the wall), which way it
 * looks (degrees clockwise from north, as a logo's `turn`), and along it at each metre how high the wall stands and
 * how far it is from the plane (cells; null where no wall is within 4 m of it).
 */
export function wall(strike, realm, px, py, size = [1280, 720]) {
  const hits = []
  for (let dy = -4; dy <= 4; dy += 2) for (let dx = -8; dx <= 8; dx += 2) { const [from, dir] = sight(realm, size, px + dx, py + dy), h = strike(from, dir); if (h && Math.abs(h.normal[1]) < 0.5) hits.push(h) }
  if (hits.length < 8) return null
  // The nearest half are the wall in front; a plane through them by least squares, across the ground.
  hits.sort((a, b) => a.t - b.t)
  const near = hits.filter((h) => h.t < hits[Math.floor(hits.length / 3)].t + 60)
  const mx = near.reduce((n, h) => n + h.at[0], 0) / near.length, mz = near.reduce((n, h) => n + h.at[2], 0) / near.length
  let sxx = 0, sxz = 0, szz = 0
  for (const h of near) { const x = h.at[0] - mx, z = h.at[2] - mz; sxx += x * x; sxz += x * z; szz += z * z }
  const along = 0.5 * Math.atan2(2 * sxz, sxx - szz), run = [Math.cos(along), 0, Math.sin(along)]
  let n = [-run[2], 0, run[0]]
  const eye = realm.arrive.at
  if (n[0] * (eye[0] - mx) + n[2] * (eye[2] - mz) < 0) n = [-n[0], 0, -n[2]]
  // Along the wall, a metre at a time: rays straight in from 30 m out, at each height.
  const y0 = near.reduce((m, h) => Math.max(m, h.at[1]), 0)
  let right, profile
  const walk = () => {
    right = [n[2], 0, -n[0]]; profile = []
    for (let k = -60; k <= 60; k++) {
      let top = null, off = null
      for (let y = y0 + 300; y > y0 - 500; y -= 5) {
        const from = [mx + right[0] * k * 10 + n[0] * 300, y, mz + right[2] * k * 10 + n[2] * 300], h = strike(from, [-n[0], 0, -n[2]], 340)
        if (h && Math.abs(300 - h.t) < 40) { top = y; off = 300 - h.t; break }
      }
      profile.push({ k, top, off })
    }
  }
  walk()
  // The rays from the park met the wall's corner too, and the plane leant to it: turned to the wall as walked (the
  // run at the pixel's own height, without what stands a metre and a half off its middle), twice.
  for (let again = 0; again < 2; again++) {
    const here = profile.find((p) => p.k === 0)?.top
    if (here == null) break
    let lo = 0, hi = 0
    const same = (k) => profile.some((p) => p.k === k && p.top !== null && Math.abs(p.top - here) <= 15)
    while (same(lo - 1)) lo--
    while (same(hi + 1)) hi++
    const run = profile.filter((p) => p.k >= lo && p.k <= hi), mid = run.map((p) => p.off).sort((x, y) => x - y)[run.length >> 1]
    const on = run.filter((p) => Math.abs(p.off - mid) < 15 + 0.6 * Math.abs(p.k))
    if (on.length < 6) break
    const mk = on.reduce((t, p) => t + p.k, 0) / on.length, mo = on.reduce((t, p) => t + p.off, 0) / on.length
    const lean = Math.atan(on.reduce((t, p) => t + (p.k - mk) * (p.off - mo), 0) / Math.max(1e-9, on.reduce((t, p) => t + (p.k - mk) ** 2, 0)) / 10)
    if (Math.abs(lean) < 0.003) break
    const c = Math.cos(lean), sn = Math.sin(lean)
    n = [n[0] * c - right[0] * sn, 0, n[2] * c - right[2] * sn]
    walk()
  }
  return { middle: [mx, y0, mz], normal: n, right, turn: ((Math.atan2(n[0], -n[2]) * 180) / Math.PI + 360) % 360, profile, id: near[0].id }
}

/**
 * How a sign `size` m tall and `wide` m across lies on a wall, where `at` is the middle of the sign's lower edge
 * (cells) and `turn` the way it looks: how far the far model's wall is behind the sign's plane at points all over
 * it, cells (least, middle, most), and at how many of them (`off` of `all`) no wall is within 6 m behind it or 3 m before.
 */
export function lies(strike, at, turn, size, wide) {
  const t = (turn * Math.PI) / 180, n = [Math.sin(t), 0, -Math.cos(t)], right = [n[2], 0, -n[0]], gaps = []
  let off = 0, all = 0
  // (Every metre across and every two up: a pier is half a metre wide.)
  for (let u = -0.48; u <= 0.481; u += Math.min(0.15, 1 / wide)) for (let v = 0.05; v <= 0.951; v += Math.min(0.3, 2 / size)) {
    const from = [at[0] + right[0] * u * wide * 10 + n[0] * 30, at[1] + v * size * 10, at[2] + right[2] * u * wide * 10 + n[2] * 30], h = strike(from, [-n[0], 0, -n[2]], 90)
    all++
    if (h) gaps.push(h.t - 30); else off++
  }
  gaps.sort((a, b) => a - b)
  return { least: gaps[0] ?? null, middle: gaps[Math.floor(gaps.length / 2)] ?? null, most: gaps[gaps.length - 1] ?? null, off, all }
}

/**
 * Where a sign `size` m tall and `wide` m across is seated on the wall seen at a pixel of the first picture: under the
 * wall's top by `under` m, in the middle of its level run (moved `along` m to the right), on the plane of the wall's
 * outermost part there and 30 cm proud of it. Where the run is shorter than the sign, how long it is.
 */
export function seat(strike, realm, px, py, size, wide, { under = 1.5, along = 0 } = {}) {
  const w = wall(strike, realm, px, py)
  if (!w) return null
  const here = w.profile.find((p) => p.k === 0)?.top
  if (here == null) return null
  // The run of the wall the pixel is on: as high as it is there, and in its plane within a metre and a half (past a corner cut off or a bay the wall is another's).
  const flat = w.profile.find((p) => p.k === 0).off, level = (p) => p.top !== null && Math.abs(p.top - here) <= 15 && Math.abs(p.off - flat) <= 15
  let a = 0, b = 0
  while (w.profile.some((p) => p.k === a - 1 && level(p))) a--
  while (w.profile.some((p) => p.k === b + 1 && level(p))) b++
  if (b - a + 1 < wide) return { short: b - a + 1, top: here / 10, turn: w.turn }
  const k = Math.max(a + wide / 2, Math.min(b - wide / 2, (a + b) / 2 + along)), y = Math.round(here - (under + size) * 10)
  const on = [w.middle[0] + w.right[0] * k * 10, y, w.middle[2] + w.right[2] * k * 10], turn = Math.round(w.turn * 10) / 10
  const first = lies(strike, on, turn, size, wide), t = (turn * Math.PI) / 180, n = [Math.sin(t), 0, -Math.cos(t)]
  const out = 3 - (first.least ?? 0), at = [Math.round(on[0] + n[0] * out), y, Math.round(on[2] + n[2] * out)]
  return { at, turn, run: b - a + 1, top: here / 10, id: w.id, lies: lies(strike, at, turn, size, wide) }
}

/**
 * Where a roof sign stands on the tower seen at a pixel of the first picture: on the far model's roof `back` m behind
 * the wall the pixel shows (along the look), `along` m to the right, turned to face the eye. `at` is the middle of its
 * frame's foot, cells; `level` is how far the roof under the sign's width is from that height, cells (least, most).
 */
export function stand(strike, realm, px, py, wide, { back = 5, along = 0 } = {}) {
  const [from, dir] = sight(realm, [1280, 720], px, py), h = strike(from, dir)
  if (!h) return null
  const far = Math.hypot(dir[0], dir[2]), ahead = [dir[0] / far, 0, dir[2] / far], right = [-ahead[2], 0, ahead[0]]
  const roof = (x, z) => strike([x, 60000, z], [0, -1, 0], 60000)?.at[1] ?? null
  const x = h.at[0] + ahead[0] * back * 10 + right[0] * along * 10, z = h.at[2] + ahead[2] * back * 10 + right[2] * along * 10, y = roof(x, z)
  if (y === null) return null
  const under = []
  for (let u = -0.5; u <= 0.501; u += 0.1) { const r = roof(x + right[0] * u * wide * 10, z + right[2] * u * wide * 10); under.push(r === null ? -Infinity : r - y) }
  return { at: [Math.round(x), Math.round(y), Math.round(z)], turn: Math.round((((Math.atan2(-ahead[0], ahead[2]) * 180) / Math.PI + 360) % 360) * 10) / 10, top: y / 10, far: h.t / 10, level: [Math.min(...under), Math.max(...under)] }
}
