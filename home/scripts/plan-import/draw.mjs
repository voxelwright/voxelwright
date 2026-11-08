// Browser-side drawing: synthetic source plans in several styles, and overlays.
import { arcInfo, pointAlong, wallPolyline, indexPlan, openingEnds } from './geom.mjs'

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// World window -> pixel transform, with optional rotation and keystone for the sketch.
export function makeView(hint, width = 1600) {
  const pts = []
  for (const w of hint.plan.walls) {
    const { corner } = indexPlan(hint.plan)
    pts.push(...wallPolyline(corner.get(w.a), corner.get(w.b), w.sagitta))
  }
  let minX = Math.min(...pts.map((p) => p.x)) - 2.5, maxX = Math.max(...pts.map((p) => p.x)) + 2.5
  let minZ = Math.min(...pts.map((p) => p.z)) - 2.5, maxZ = Math.max(...pts.map((p) => p.z)) + 2.5
  if (hint.legend || hint.compass) maxX += 2.5
  if (hint.scaleBar) maxZ += 1
  const ppm = width / (maxX - minX)
  const height = Math.round((maxZ - minZ) * ppm)
  const rot = ((hint.rotate || 0) * Math.PI) / 180, warp = hint.warp || 0
  const cx = width / 2, cy = height / 2
  const toPx = (x, z) => {
    let px = (x - minX) * ppm, py = (z - minZ) * ppm
    const dx = px - cx, dy = py - cy
    px = cx + dx * Math.cos(rot) - dy * Math.sin(rot)
    py = cy + dx * Math.sin(rot) + dy * Math.cos(rot)
    const k = 1 - warp * (0.5 - py / height) // keystone: top edge narrower
    return [cx + (px - cx) * k, py]
  }
  return { width, height, ppm, toPx, params: { minX, minZ, ppm, rotateDeg: hint.rotate || 0, warp, width, height } }
}

function polyPath(ctx, view, pts, wobble) {
  ctx.beginPath()
  pts.forEach((p, i) => {
    let [x, y] = view.toPx(p.x, p.z)
    if (wobble) { const [ox, oy] = wobble(p); x += ox; y += oy }
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
  })
}

function spanPoints(a, b, s, from, to, step = 0.05) {
  const n = Math.max(2, Math.ceil((to - from) / step))
  return Array.from({ length: n + 1 }, (_, i) => pointAlong(a, b, s, from + ((to - from) * i) / n))
}

function offsetPts(pts, off) {
  return pts.map((p) => ({ x: p.x + p.tz * off, z: p.z - p.tx * off, tx: p.tx, tz: p.tz }))
}

export function drawSource(canvas, hint) {
  const view = makeView(hint)
  canvas.width = view.width; canvas.height = view.height
  const ctx = canvas.getContext('2d')
  const plan = hint.plan, idx = indexPlan(plan), R = rng(7)
  const style = hint.style
  const paper = style === 'sketch' ? '#f3eedf' : '#ffffff'
  const ink = style === 'sketch' ? 'rgba(60,60,70,0.85)' : '#1d1d1f'
  ctx.fillStyle = paper; ctx.fillRect(0, 0, view.width, view.height)
  if (style === 'sketch') { // paper grain
    for (let i = 0; i < 6000; i++) { ctx.fillStyle = `rgba(120,110,90,${R() * 0.08})`; ctx.fillRect(R() * view.width, R() * view.height, 2, 2) }
  }
  const px = (m) => m * view.ppm
  const wob = style === 'sketch' ? (() => { const ph = [R() * 9, R() * 9, R() * 9, R() * 9]; return (p) => [2.2 * Math.sin(p.x * 1.7 + p.z * 0.9 + ph[0]) + 1.2 * Math.sin(p.z * 3.1 + ph[1]), 2.2 * Math.sin(p.z * 1.5 + p.x * 0.7 + ph[2]) + 1.2 * Math.sin(p.x * 2.9 + ph[3])] })() : null
  const wallPts = (w) => wallPolyline(idx.corner.get(w.a), idx.corner.get(w.b), w.sagitta, 0.05)

  // Walls.
  if (style === 'sketch') {
    ctx.strokeStyle = ink; ctx.lineCap = 'round'
    for (const w of plan.walls) {
      const a = idx.corner.get(w.a), b = idx.corner.get(w.b)
      const L = arcInfo(a, b, w.sagitta).length
      const pts = spanPoints(a, b, w.sagitta, -0.0, L) // overshoot added below for straight walls
      if (!w.sagitta) { const d = pts[0]; pts.unshift({ x: d.x - d.tx * 0.2, z: d.z - d.tz * 0.2, tx: d.tx, tz: d.tz }); const e = pts.at(-1); pts.push({ x: e.x + e.tx * 0.25, z: e.z + e.tz * 0.25, tx: e.tx, tz: e.tz }) }
      for (const off of w.thickness > 0.15 ? [-w.thickness / 2, w.thickness / 2] : [0]) {
        ctx.lineWidth = 2 + R(); polyPath(ctx, view, offsetPts(pts, off), wob); ctx.stroke()
      }
    }
  } else {
    for (const pass of style === 'line' ? [0, 1] : [0]) {
      for (const w of plan.walls) {
        ctx.lineCap = 'square'
        ctx.strokeStyle = pass ? paper : (style === 'agent' ? '#3a3a3c' : ink)
        ctx.lineWidth = px(w.thickness) - (pass ? 3 : 0)
        polyPath(ctx, view, wallPts(w)); ctx.stroke()
      }
    }
  }

  // Openings.
  for (const o of plan.openings) {
    const w = idx.wall.get(o.wall), a = idx.corner.get(w.a), b = idx.corner.get(w.b)
    const pts = spanPoints(a, b, w.sagitta, o.from, o.to)
    ctx.lineCap = 'butt'; ctx.strokeStyle = paper; ctx.lineWidth = px(w.thickness) + 6
    polyPath(ctx, view, pts, wob); ctx.stroke()
    ctx.strokeStyle = ink; ctx.lineWidth = style === 'sketch' ? 1.6 : 1.3
    if (o.kind === 'window') {
      for (const off of [-w.thickness / 2, 0, w.thickness / 2]) { polyPath(ctx, view, offsetPts(pts, off), wob); ctx.stroke() }
    } else {
      const h = pts[0], len = o.to - o.from
      const leaf = { x: h.x + h.tz * len, z: h.z - h.tx * len }
      polyPath(ctx, view, [h, leaf], wob); ctx.stroke()
      const arc = []
      for (let i = 0; i <= 24; i++) {
        const t = (i / 24) * (Math.PI / 2)
        arc.push({ x: h.x + (h.tz * Math.cos(t) + h.tx * Math.sin(t)) * len, z: h.z + (-h.tx * Math.cos(t) + h.tz * Math.sin(t)) * len })
      }
      ctx.setLineDash(style === 'sketch' ? [] : [6, 4]); polyPath(ctx, view, arc, wob); ctx.stroke(); ctx.setLineDash([])
    }
  }

  const text = (str, x, z, size, opts = {}) => {
    const [tx, ty] = view.toPx(x, z)
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(((hint.rotate || 0) * Math.PI) / 180 + (opts.angle || 0))
    ctx.font = `${opts.weight || ''} ${size}px ${style === 'sketch' ? '"Bradley Hand", "Comic Sans MS", cursive' : 'Helvetica, Arial, sans-serif'}`
    ctx.fillStyle = opts.color || ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(str, 0, 0); ctx.restore()
  }

  // Furniture distractors.
  if (hint.furniture) {
    ctx.strokeStyle = '#8e8e93'; ctx.lineWidth = 1.2
    const rect = (x, z, w, h) => { polyPath(ctx, view, [{ x, z }, { x: x + w, z }, { x: x + w, z: z + h }, { x, z: z + h }, { x, z }]); ctx.stroke() }
    const circ = (x, z, r) => { const p = []; for (let i = 0; i <= 32; i++) p.push({ x: x + r * Math.cos(i / 5.09), z: z + r * Math.sin(i / 5.09) }); polyPath(ctx, view, p); ctx.stroke() }
    rect(0.3, 0.3, 4.4, 0.6); circ(2.5, 0.6, 0.22) // kitchen counter + sink
    circ(7, 2.1, 0.8); for (const [dx, dz] of [[0, -1.15], [0, 1.15], [-1.15, 0], [1.15, 0]]) circ(7 + dx, 2.1 + dz, 0.22) // dining table
    rect(10, 3, 2.6, 0.9); rect(10, 2.75, 2.6, 0.25); rect(12.2, 1.2, 1.2, 1.2) // sofa + armchair
    rect(0.6, 6.4, 1.6, 2.1); rect(0.7, 6.5, 0.6, 0.4); rect(1.6, 6.5, 0.5, 0.4) // bed 1
    rect(9.5, 6.6, 1.8, 2.1); rect(9.6, 6.7, 1.6, 0.4) // bed 2
    rect(4.8, 8.2, 1.9, 0.75); circ(6.3, 6.3, 0.25) // bath + toilet
  }

  // Room labels.
  for (const r of plan.rooms) {
    const lab = hint.labels?.[r.id] || [r.label]
    let [lx, lz] = hint.labelAt?.[r.id] || (() => { const cs = r.loop.map((id) => idx.corner.get(id)); return [cs.reduce((s, c) => s + c.x, 0) / cs.length, cs.reduce((s, c) => s + c.z, 0) / cs.length] })()
    if (style === 'sketch') { text(lab[0].toLowerCase(), lx, lz, 40); continue }
    text(lab[0].toUpperCase(), lx, lz - (lab[1] ? 0.25 : 0), 24, { weight: 'bold' })
    if (lab[1]) text(lab[1], lx, lz + 0.25, 20)
  }

  // Dimension strings.
  for (const [[x0, z0], [x1, z1], off, label] of hint.dims || []) {
    const L = Math.hypot(x1 - x0, z1 - z0), tx = (x1 - x0) / L, tz = (z1 - z0) / L, nx = -tz, nz = tx
    const p0 = { x: x0 + nx * off, z: z0 + nz * off }, p1 = { x: x1 + nx * off, z: z1 + nz * off }
    ctx.strokeStyle = ink; ctx.lineWidth = style === 'sketch' ? 1.8 : 1
    polyPath(ctx, view, [p0, p1], wob); ctx.stroke()
    if (style === 'sketch') { // arrowheads
      for (const [p, s] of [[p0, 1], [p1, -1]]) { polyPath(ctx, view, [{ x: p.x + s * tx * 0.3 + nx * 0.15, z: p.z + s * tz * 0.3 + nz * 0.15 }, p, { x: p.x + s * tx * 0.3 - nx * 0.15, z: p.z + s * tz * 0.3 - nz * 0.15 }], wob); ctx.stroke() }
    } else {
      for (const [p, q] of [[{ x: x0, z: z0 }, p0], [{ x: x1, z: z1 }, p1]]) {
        polyPath(ctx, view, [{ x: p.x + nx * Math.sign(off) * 0.3, z: p.z + nz * Math.sign(off) * 0.3 }, { x: q.x + nx * Math.sign(off) * 0.2, z: q.z + nz * Math.sign(off) * 0.2 }]); ctx.stroke()
        polyPath(ctx, view, [{ x: q.x - (tx + nx) * 0.12, z: q.z - (tz + nz) * 0.12 }, { x: q.x + (tx + nx) * 0.12, z: q.z + (tz + nz) * 0.12 }]); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1
      }
    }
    const ang = Math.atan2(tz, tx)
    text(label, (p0.x + p1.x) / 2 + nx * Math.sign(off) * 0.32, (p0.z + p1.z) / 2 + nz * Math.sign(off) * 0.32, style === 'sketch' ? 38 : 22, { angle: Math.abs(ang) > 1 ? -Math.PI / 2 : 0 })
  }

  if (hint.scaleBar) {
    const { at: [x, z], len } = hint.scaleBar
    for (let i = 0; i < len; i++) {
      const [ax, ay] = view.toPx(x + i, z), [bx] = view.toPx(x + i + 1, z)
      ctx.fillStyle = i % 2 ? '#fff' : '#1d1d1f'; ctx.fillRect(ax, ay, bx - ax, 10); ctx.strokeStyle = '#1d1d1f'; ctx.lineWidth = 1; ctx.strokeRect(ax, ay, bx - ax, 10)
    }
    text('0', x, z + 0.45, 18); text(`${len} m`, x + len, z + 0.45, 18)
  }
  if (hint.compass) {
    const [x, z] = hint.compass
    const c = []; for (let i = 0; i <= 40; i++) c.push({ x: x + 0.8 * Math.cos(i / 6.37), z: z + 0.8 * Math.sin(i / 6.37) })
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5; polyPath(ctx, view, c); ctx.stroke()
    polyPath(ctx, view, [{ x: x - 0.3, z: z + 0.5 }, { x, z: z - 0.7 }, { x: x + 0.3, z: z + 0.5 }, { x, z: z + 0.25 }, { x: x - 0.3, z: z + 0.5 }]); ctx.fillStyle = ink; ctx.fill()
    text('N', x, z - 1.15, 22, { weight: 'bold' })
  }
  if (hint.legend) {
    const [x, z] = hint.legend
    ctx.strokeStyle = ink; ctx.lineWidth = 1; polyPath(ctx, view, [{ x, z }, { x: x + 3.6, z }, { x: x + 3.6, z: z + 3.4 }, { x, z: z + 3.4 }, { x, z }]); ctx.stroke()
    text('LEGEND', x + 1.8, z + 0.4, 18, { weight: 'bold' })
    ;['▭  Window', '◜  Door', '▢  Furniture', 'Ceiling 2.6 m', 'GIA 128 m²'].forEach((s, i) => { const [lx, ly] = view.toPx(x + 0.3, z + 1 + i * 0.5); ctx.font = '17px Helvetica'; ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText(s, lx, ly) })
  }
  return view.params
}

// Overlay: dimmed source, ground truth in green, model plan (already aligned to ground-truth coordinates) in red.
export function drawOverlay(canvas, hint, img, model, caption) {
  const view = makeView(hint)
  canvas.width = view.width; canvas.height = view.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, view.width, view.height)
  ctx.globalAlpha = 0.3; ctx.drawImage(img, 0, 0); ctx.globalAlpha = 1
  const drawPlan = (plan, color, width) => {
    const idx = indexPlan(plan)
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'
    for (const w of plan.walls) {
      const a = idx.corner.get(w.a), b = idx.corner.get(w.b); if (!a || !b) continue
      polyPath(ctx, view, wallPolyline(a, b, w.sagitta || 0, 0.05)); ctx.stroke()
    }
    for (const o of plan.openings) {
      try {
        const [p, q] = openingEnds(plan, o, idx)
        ctx.lineWidth = width * 3; ctx.setLineDash(o.kind === 'window' ? [6, 4] : [])
        polyPath(ctx, view, [p, q]); ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([])
      } catch {}
    }
    ctx.fillStyle = color
    for (const c of plan.corners) { const [x, y] = view.toPx(c.x, c.z); ctx.beginPath(); ctx.arc(x, y, width + 2, 0, 7); ctx.fill() }
  }
  drawPlan(hint.plan, 'rgba(0,160,60,0.85)', 5)
  if (model) drawPlan(model, 'rgba(220,20,20,0.9)', 2)
  ctx.font = 'bold 34px Helvetica'; ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.fillText(caption, 20, 44)
}

window.draw = { drawSource, drawOverlay, makeView }
