// Scores every run in out/runs/<tag>/ against ground truth, draws contact sheets, writes out/results.md.
// Usage: node scripts/plan-import/score.mjs
// Alignment fits rotation + translation only (scale is not fitted, so scale error costs accuracy).
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PLANS } from './plans.mjs'
import { arcInfo, wallPolyline, indexPlan, openingEnds, dist } from './geom.mjs'
import { openDrawPage } from './browser.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const TOL = 0.3

const rot = (p, th, t) => ({ x: p.x * Math.cos(th) - p.z * Math.sin(th) + t.x, z: p.x * Math.sin(th) + p.z * Math.cos(th) + t.z })
const nearest = (p, pts) => Math.min(...pts.map((q) => dist(p, q)))

function align(M, G) {
  let best = { cost: Infinity }
  for (let deg = 0; deg < 360; deg += 5) {
    const th = (deg * Math.PI) / 180
    const RM = M.map((m) => rot(m, th, { x: 0, z: 0 }))
    for (const m of RM) for (const g of G) {
      const t = { x: g.x - m.x, z: g.z - m.z }
      const moved = RM.map((p) => ({ x: p.x + t.x, z: p.z + t.z }))
      const cost = G.reduce((s, q) => s + Math.min(1, nearest(q, moved)), 0)
      if (cost < best.cost) best = { cost, th, t }
    }
  }
  let { th, t } = best
  for (let it = 0; it < 8; it++) { // ICP with rigid 2D Kabsch on pairs within 1 m
    const moved = M.map((m) => rot(m, th, t))
    const pairs = G.map((g) => { let j = -1, d = Infinity; moved.forEach((p, i) => { const e = dist(p, g); if (e < d) { d = e; j = i } }); return d < 1 ? [M[j], g] : null }).filter(Boolean)
    if (pairs.length < 2) break
    const cm = { x: 0, z: 0 }, cg = { x: 0, z: 0 }
    for (const [m, g] of pairs) { cm.x += m.x; cm.z += m.z; cg.x += g.x; cg.z += g.z }
    cm.x /= pairs.length; cm.z /= pairs.length; cg.x /= pairs.length; cg.z /= pairs.length
    let sc = 0, sd = 0
    for (const [m, g] of pairs) { const a = { x: m.x - cm.x, z: m.z - cm.z }, b = { x: g.x - cg.x, z: g.z - cg.z }; sd += a.x * b.x + a.z * b.z; sc += a.x * b.z - a.z * b.x }
    th = Math.atan2(sc, sd)
    const r = rot(cm, th, { x: 0, z: 0 }); t = { x: cg.x - r.x, z: cg.z - r.z }
  }
  return { th, t }
}

const diameter = (pts) => { let d = 0; for (const p of pts) for (const q of pts) d = Math.max(d, dist(p, q)); return d }
const sgn = (s) => (Math.abs(s) < 0.1 ? 0 : Math.sign(s))
const segDist = (p, a, b) => { const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz; const u = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)) : 0; return Math.hypot(p.x - a.x - u * vx, p.z - a.z - u * vz) }
const normLabel = (s) => String(s).toLowerCase().replace(/[\d.]+\s*[×x]\s*[\d.]+.*$/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN }

function score(gt, raw) {
  const { th, t } = align(raw.corners, gt.corners)
  const model = { ...raw, corners: raw.corners.map((c) => ({ ...c, ...rot(c, th, t) })) }
  const gi = indexPlan(gt), mi = indexPlan(model)
  const scaleErr = (diameter(raw.corners) / diameter(gt.corners) - 1) * 100

  // Walls: both ends within TOL (either direction) and the same curve sign.
  const used = new Set(); let wallHits = 0
  for (const w of gt.walls) {
    const a = gi.corner.get(w.a), b = gi.corner.get(w.b)
    const hit = model.walls.find((m) => {
      if (used.has(m.id)) return false
      const ma = mi.corner.get(m.a), mb = mi.corner.get(m.b)
      if (dist(a, ma) <= TOL && dist(b, mb) <= TOL) return sgn(m.sagitta) === sgn(w.sagitta)
      if (dist(a, mb) <= TOL && dist(b, ma) <= TOL) return sgn(-m.sagitta) === sgn(w.sagitta)
      return false
    })
    if (hit) { used.add(hit.id); wallHits++ }
  }
  // Coverage: share of ground-truth wall length within TOL of some model wall (insensitive to how walls are split).
  const mSegs = model.walls.flatMap((m) => { const p = wallPolyline(mi.corner.get(m.a), mi.corner.get(m.b), m.sagitta, 0.05); return p.slice(1).map((q, i) => [p[i], q]) })
  const samples = gt.walls.flatMap((w) => wallPolyline(gi.corner.get(w.a), gi.corner.get(w.b), w.sagitta, 0.1))
  const covered = samples.filter((p) => mSegs.some(([a, b]) => segDist(p, a, b) <= TOL)).length

  const cornerErr = median(gt.corners.map((c) => nearest(c, model.corners)))

  const mOpen = model.openings.map((o) => ({ o, ends: openingEnds(model, o, mi) }))
  const usedO = new Set(); let openHits = 0
  for (const o of gt.openings) {
    const [p, q] = openingEnds(gt, o, gi)
    const hit = mOpen.find(({ o: m, ends: [mp, mq] }) => !usedO.has(m.id) && m.kind === o.kind &&
      ((dist(p, mp) <= TOL && dist(q, mq) <= TOL) || (dist(p, mq) <= TOL && dist(q, mp) <= TOL)))
    if (hit) { usedO.add(hit.o.id); openHits++ }
  }

  const mLabels = model.rooms.map((r) => normLabel(r.label)); const usedL = new Set(); let labelHits = 0
  for (const r of gt.rooms) {
    const g = normLabel(r.label)
    let j = mLabels.findIndex((m, i) => !usedL.has(i) && m === g)
    if (j < 0) j = mLabels.findIndex((m, i) => !usedL.has(i) && (m.includes(g) || g.includes(m)) && m)
    if (j >= 0) { usedL.add(j); labelHits++ }
  }

  const curvedGt = gt.walls.filter((w) => w.sagitta)
  const curvedHits = curvedGt.filter((w) => {
    const top = arcInfo(gi.corner.get(w.a), gi.corner.get(w.b), w.sagitta).top
    return model.walls.some((m) => Math.abs(m.sagitta) > 0.1 && dist(top, arcInfo(mi.corner.get(m.a), mi.corner.get(m.b), m.sagitta).top) <= 0.5)
  }).length

  return {
    model, rotationDeg: ((th * 180) / Math.PI).toFixed(1),
    wallRecall: wallHits / gt.walls.length, wallPrecision: model.walls.length ? wallHits / model.walls.length : 0,
    wallCounts: `${wallHits}/${gt.walls.length} gt, ${model.walls.length} out`,
    coverage: covered / samples.length, cornerErr, openings: `${openHits}/${gt.openings.length}`,
    labels: `${labelHits}/${gt.rooms.length}`, scaleErr, curved: curvedGt.length ? `${curvedHits}/${curvedGt.length}` : '-',
  }
}

const runsDir = join(here, 'out', 'runs')
const tags = (await readdir(runsDir)).sort()
const rows = {}, aligned = {}
for (const tag of tags) for (const f of (await readdir(join(runsDir, tag))).filter((f) => f.endsWith('.json'))) {
  const id = f.replace('.json', ''), rec = JSON.parse(await readFile(join(runsDir, tag, f), 'utf8'))
  const base = { tag, first: rec.validFirstTry ? 'yes' : 'no', valid: rec.valid ? 'yes' : 'no', secs: rec.wallMs / 1000, cost: rec.cost,
    scaleSource: rec.result?.scale?.source ?? '?', reasons: rec.attempts?.[0]?.reasons ?? [], error: rec.error }
  let s = null
  if (rec.result?.corners?.length) { try { s = score(PLANS[id].plan, rec.result) } catch (e) { base.error = `score: ${e.message}` } }
  ;(rows[id] ||= []).push({ ...base, s })
  if (s) (aligned[id] ||= {})[tag] = s.model
}

const pct = (x) => `${Math.round(x * 100)}%`
let md = `# Floor-plan import experiment (issue #48)

Synthetic plans only, rendered by \`render.mjs\`. Each run is one \`claude -p\` turn with the image, no tools, plus at most one repair turn with validator reasons.
Scoring aligns rotation + translation only; scale is not fitted, so scale error shows up in every distance metric.
Wall match: both ends within 0.3 m and same curve sign. Coverage: share of ground-truth wall length within 0.3 m of any model wall (ignores how walls are split).
Openings match by kind and both ends within 0.3 m in world space. Latency is wall clock for all turns of that plan; cost is what the CLI reports.
Plan f is plan b scaled by 1.087, so no coordinate lands on a round decimetre and only a scale bar gives scale: a control for snapping to round numbers.

Reproduce (from home/): \`node scripts/plan-import/render.mjs\`, \`node scripts/plan-import/run.mjs sonnet sonnet\`, \`node scripts/plan-import/run.mjs opus opus\`, \`node scripts/plan-import/run.mjs opus opus-rerun c d e\`, \`node scripts/plan-import/score.mjs\`.

Findings (Nov 6 run, models claude-sonnet-5-5 and claude-opus-5-5): every output was valid on the first try, so the repair pass never ran. Clean drawings (a, b, d, e, f) came back near exact, curved bay and three-arc tower included.
The only geometric error is the rotated, keystoned hand sketch (c): corners 0.11-0.14 m off and scale 1-3% off from the single written dimension. The other misses are window extents: Sonnet put one end of 3 windows 0.2-1.0 m off (worst: the sketch window, read 1 m short); Opus missed none.
Caveat: these are clean synthetic renders with scale given; real estate-agent scans, photos of paper and plans without dimensions are untested here.

Caveats: Sonnet and Opus ran concurrently (each sequential over its plans), so latencies are comparable, not absolute. The repair path never ran because nothing failed. The CLI's cost includes a small claude-haiku-5-5 side call.

Shape vs home/src/build/plan.ts (landed during this run): plan.ts nests openings inside each wall (here a top-level list with a wall field); requires wall height and opening sill/head (optional leaves), which the prompt does not ask for; has no units field. Its validate() also checks room winding (positive shoelace area), opening overlap and at most two rooms per wall. All 49 model room loops wound positive, but the importer should normalise winding, nest openings and fill height/sill/head defaults in trusted code. Sagitta sign and the half-circle bound match.

`
const summary = {}
for (const id of Object.keys(PLANS)) {
  md += `## Plan ${id} (${PLANS[id].style}${id === 'd' ? ', curved' : ''})\n\n| run | valid 1st/after repair | walls R / P | coverage | corner err (median m) | openings | labels | scale err (source) | curved | time s | cost $ |\n|---|---|---|---|---|---|---|---|---|---|---|\n`
  for (const r of rows[id] || []) {
    const s = r.s
    md += s
      ? `| ${r.tag} | ${r.first} / ${r.valid} | ${pct(s.wallRecall)} / ${pct(s.wallPrecision)} | ${pct(s.coverage)} | ${s.cornerErr.toFixed(2)} | ${s.openings} | ${s.labels} | ${s.scaleErr >= 0 ? '+' : ''}${s.scaleErr.toFixed(1)}% (${r.scaleSource}) | ${s.curved} | ${r.secs.toFixed(0)} | ${r.cost.toFixed(3)} |\n`
      : `| ${r.tag} | ${r.first} / ${r.valid} | ${r.error || 'no result'} |||||||| ${r.secs.toFixed(0)} | ${r.cost.toFixed(3)} |\n`
    if (r.reasons.length) md += `| | first-try rejects: ${r.reasons.slice(0, 3).join('; ').replace(/\|/g, '/')} |||||||||\n`
    const m = (summary[r.tag] ||= { n: 0, rec: 0, cov: 0, corner: [], scale: [], secs: 0, cost: 0, first: 0, valid: 0 })
    m.n++; m.secs += r.secs; m.cost += r.cost; m.first += r.first === 'yes'; m.valid += r.valid === 'yes'
    if (s) { m.rec += s.wallRecall; m.cov += s.coverage; m.corner.push(s.cornerErr); m.scale.push(Math.abs(s.scaleErr)) }
  }
  md += `\n![plan ${id}](sheet-${id}.jpg)\n\n`
}
let head = `## Summary per run\n\n| run | plans | valid 1st | valid | mean wall recall | mean coverage | median corner err m | median abs scale err | mean time s | total cost $ |\n|---|---|---|---|---|---|---|---|---|---|\n`
for (const [tag, m] of Object.entries(summary)) head += `| ${tag} | ${m.n} | ${m.first} | ${m.valid} | ${pct(m.rec / m.n)} | ${pct(m.cov / m.n)} | ${median(m.corner).toFixed(2)} | ${median(m.scale).toFixed(1)}% | ${(m.secs / m.n).toFixed(0)} | ${m.cost.toFixed(2)} |\n`
md = md.replace('\n## Plan a', `\n${head}\n## Plan a`)
await writeFile(join(here, 'out', 'results.md'), md)
await writeFile(join(here, 'out', 'scores.json'), JSON.stringify(rows, (k, v) => (k === 'model' ? undefined : v), 1))

// Contact sheets: source | one overlay per run (green truth, red model).
const { browser, page } = await openDrawPage()
for (const id of Object.keys(PLANS)) {
  const panels = [['source', null], ...Object.entries(aligned[id] || {})]
  const jpg = await page.evaluate(async ({ hint, panels, id }) => {
    const img = new Image(); img.src = `/out/plans/${id}.png`; await img.decode()
    const s = 0.5, sheet = document.createElement('canvas')
    sheet.width = Math.round(img.width * s * panels.length); sheet.height = Math.round(img.height * s)
    const ctx = sheet.getContext('2d')
    panels.forEach(([tag, model], i) => {
      const c = document.createElement('canvas')
      if (model) window.draw.drawOverlay(c, hint, img, model, tag)
      else { c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); x.font = 'bold 34px Helvetica'; x.fillText(`plan ${id}`, 20, 44) }
      ctx.drawImage(c, i * img.width * s, 0, img.width * s, img.height * s)
      ctx.fillStyle = '#999'; ctx.fillRect(i * img.width * s, 0, 2, sheet.height)
    })
    return sheet.toDataURL('image/jpeg', 0.8)
  }, { hint: PLANS[id], panels, id })
  await writeFile(join(here, 'out', `sheet-${id}.jpg`), Buffer.from(jpg.split(',')[1], 'base64'))
}
await browser.close()
console.log(md)
