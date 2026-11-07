// The outline of a room being added (#48): a pencil sketch on paper laid on the
// ground, the door's swing drawn in, wooden pegs on the walls they move, and
// handwritten paper tags for the sizes and the choice. Trusted code draws it from
// a draft (resolve.ts); the person adjusts it directly: drag a peg or a wall, pull
// the sage peg to bend the far wall, slide the door, or click a size and type a
// number. Enter builds it, Escape lets it go. Nothing here touches the plan:
// applying is the caller's commit.
import * as THREE from 'three/webgpu'
import type { Stage } from '../kernel'
import { canvas, toTexture } from '../paint'
import { CHALK_RED, HAND, drawPencil, drawTape, drawTapeMeasure, paintSoil, paperGrain, tagCss } from './sketch'
import { BEND_SNAP, curveOf, outline as ringOf, pointAt, roomArea, type P, type Plan } from './plan'
import { SNAP, blockerOf, draftGeometry, fit, placeDoor, type Draft } from './resolve'
import { LOOK } from './look'
import { YARD_TOP } from '../diorama'

/** ?look=lot: the room is staked out on the lawn (stakes, string, a flour line), not sketched on paper. */
const LOT = LOOK === 'lot'
/** Flour poured along the string, the way a room is marked out on grass. */
const FLOUR = 'rgba(252, 248, 238, 0.96)'
/** Where the drawing and pegs lie: on the paper over the floor, or on the lawn itself. */
const GROUND = LOT ? YARD_TOP + 0.006 : 0.012

const MIN = 1.5
/** How high the unbuilt walls stand while sketched. */
const PX = 1024
const INK = 'rgba(78, 52, 34, 0.95)'
/** Carpenter's red pencil, for the measurements. */
const PENCIL = 'rgba(96, 62, 40, 0.8)'
// Darker than it looks: the scene's exposure and bloom lift it to a warm tracing-paper cream.
const PAPER = 'rgba(246, 236, 212, 0.9)'
/** Soft graphite, for the walls drawn on the paper. */
const GRAPHITE = 'rgba(62, 56, 52, 0.92)'

export type Handle = 'far' | 'from' | 'to' | 'bend' | 'door'

export interface OutlineHooks {
  /** The plan the draft hangs on: the house as it stands. */
  base(): Plan
  apply(draft: Draft): void
  /** One short line in the person's villager's voice. */
  say(text: string): void
  /** The camera's view direction on the floor. */
  view(): P
  /** The paper's outline on the ground (null when it is put away): the yard steps aside under it. */
  yard(paper: P[] | null): void
}

const snap = (v: number, step = SNAP) => Math.round(Math.round(v / step) * step * 1e6) / 1e6
const fmt = (v: number) => v.toFixed(1)
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k]

/** Distance from p to the polyline. */
function toPath(p: P, path: P[]): number {
  let best = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = [path[i], path[i + 1]]
    const ab: P = [b[0] - a[0], b[1] - a[1]]
    const t = Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1]], ab) / (dot(ab, ab) || 1)))
    best = Math.min(best, Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t))
  }
  return best
}

/** The polyline moved sideways by d (left of travel is positive), mitred at the joints. */
function offsetPath(path: P[], d: number): P[] {
  const normal = (a: P, b: P): P => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]
  }
  return path.map((p, i) => {
    const n0 = i > 0 ? normal(path[i - 1], p) : null, n1 = i < path.length - 1 ? normal(p, path[i + 1]) : null
    if (!n0) return add(p, n1!, d)
    if (!n1) return add(p, n0, d)
    const m: P = [n0[0] + n1[0], n0[1] + n1[1]]
    // A sharp joint (a side wall meeting a deep bay) would spike; the mitre stops at twice the offset.
    const k = Math.max(0.5, dot(m, n0) || 1)
    return add(p, m, d / k)
  })
}

export function makeOutline(stage: Stage, hooks: OutlineHooks) {
  const group = new THREE.Group()
  group.name = 'build outline'

  // The chalk sheet: one canvas on a plane laid on the floor, moved and scaled to fit the room.
  const [sheetCanvas, g] = canvas(PX, PX)
  const sheetMap = toTexture(sheetCanvas)
  // Lit like the floor, so the house and the wall stubs cast their shadows across the plot.
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
    map: sheetMap, roughness: 1, metalness: 0, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }))
  sheet.receiveShadow = true
  sheet.rotation.x = -Math.PI / 2
  sheet.renderOrder = 3
  sheet.name = 'build outline sheet'

  // A proposal is drawn, not built: the paper carries the walls, and only "Build it" raises real ones (plugins/build.ts).
  group.add(sheet)
  /** Wooden pegs standing on the walls they move: a turned body and a lighter head; the bend peg's head is sage. */
  const pegBody = new THREE.CylinderGeometry(0.11, 0.13, 0.1, 24)
  pegBody.translate(0, 0.05, 0)
  const pegHead = new THREE.CylinderGeometry(0.1, 0.11, 0.035, 24)
  pegHead.translate(0, 0.115, 0)
  const pegWood = new THREE.MeshStandardMaterial({ color: '#8f5f3c', roughness: 0.6 })
  const pegTop = new THREE.MeshStandardMaterial({ color: '#e1bb88', roughness: 0.55 })
  const pegSage = new THREE.MeshStandardMaterial({ color: '#9fb486', roughness: 0.55 })
  const pegLive = new THREE.MeshStandardMaterial({ color: '#f0a65c', roughness: 0.5, emissive: '#b8641e', emissiveIntensity: 0.25 })
  const pegMeshes = new Map<Handle, { group: THREE.Group; head: THREE.Mesh; top: THREE.Material }>()
  for (const h of ['far', 'from', 'to', 'door', 'bend'] as Handle[]) {
    const pg = new THREE.Group()
    pg.name = `build outline peg ${h}`
    const body = new THREE.Mesh(pegBody, pegWood)
    const top = h === 'bend' ? pegSage : pegTop
    const head = new THREE.Mesh(pegHead, top)
    body.castShadow = head.castShadow = true
    pg.add(body, head)
    pegMeshes.set(h, { group: pg, head, top })
    group.add(pg)
  }
  // ?look=lot: corner stakes and a taut mason's line round the walls to be built.
  const stakeGeo = new THREE.BoxGeometry(0.045, 0.5, 0.045)
  stakeGeo.translate(0, 0.25, 0)
  const stringGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5)
  const stakeWood = new THREE.MeshStandardMaterial({ color: '#c9a274', roughness: 0.8 })
  const stringMat = new THREE.MeshStandardMaterial({ color: '#f07a3e', roughness: 0.6, emissive: '#c04a14', emissiveIntensity: 0.35 })
  const stakes: THREE.Mesh[] = [], strings: THREE.Mesh[] = []
  const stakeGroup = new THREE.Group()
  stakeGroup.name = 'build outline stakes'
  if (LOT) group.add(stakeGroup)
  const stakeOut = (line: P[]) => {
    const yUp = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3()
    // A stake at each end and wherever the line turns; along a curve, one every so often.
    const at: P[] = []
    line.forEach((p, i) => {
      const prev = line[i - 1], next = line[i + 1]
      if (!prev || !next) return at.push(p)
      const u: P = [p[0] - prev[0], p[1] - prev[1]], v: P = [next[0] - p[0], next[1] - p[1]]
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(u, v) / ((Math.hypot(...u) * Math.hypot(...v)) || 1))))
      const last = at[at.length - 1]
      if (turn > 0.4 || (turn > 0.05 && Math.hypot(p[0] - last[0], p[1] - last[1]) > 1.1)) at.push(p)
    })
    at.forEach((p, i) => {
      if (!stakes[i]) stakeGroup.add(stakes[i] = new THREE.Mesh(stakeGeo, stakeWood))
      const m = stakes[i]
      m.castShadow = true
      m.visible = true
      m.position.set(p[0], YARD_TOP, p[1])
      m.rotation.set((i % 2 ? 1 : -1) * 0.04, i * 0.7, (i % 3 ? 1 : -1) * 0.035)
    })
    for (let i = at.length; i < stakes.length; i++) stakes[i].visible = false
    for (let i = 0; i < line.length - 1; i++) {
      if (!strings[i]) stakeGroup.add(strings[i] = new THREE.Mesh(stringGeo, stringMat))
      const m = strings[i]
      m.visible = true
      a.set(line[i][0], YARD_TOP + 0.36, line[i][1])
      b.set(line[i + 1][0], YARD_TOP + 0.36, line[i + 1][1])
      m.position.copy(a).add(b).multiplyScalar(0.5)
      m.scale.set(1, a.distanceTo(b), 1)
      m.quaternion.setFromUnitVectors(yUp, b.sub(a).normalize())
    }
    for (let i = line.length - 1; i < strings.length; i++) strings[i].visible = false
  }
  /** Tracing-paper grain, painted once and laid over the paper on every redraw. */
  const grain = paperGrain(512)
  /** The plot's turned earth under the paper, painted once. */
  const soil = paintSoil(256)
  /** A refused drag flashes the walls chalk red for a moment. */
  let refusedAt = -Infinity

  // The yard's fence and flowers step aside under the paper while it is out (the caller owns the yard: hooks.yard).

  // ── Paper tags: the two sizes, and the choice ────────────────────────────
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  const dimTag = (dim: 'w' | 'd') => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'build-dim'
    b.dataset.dim = dim
    b.setAttribute('aria-label', dim === 'w' ? 'Width along the wall, in metres' : 'Depth, in metres')
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      editNumber(dim)
    })
    document.body.append(b)
    return b
  }
  const tags = { w: dimTag('w'), d: dimTag('d') }
  const field = document.createElement('input')
  field.className = 'build-dim-field'
  field.inputMode = 'decimal'
  field.enterKeyHint = 'done'
  field.setAttribute('aria-label', 'Metres')
  document.body.append(field)
  const choice = document.createElement('div')
  choice.className = 'build-choice'
  choice.setAttribute('role', 'group')
  const title = document.createElement('div')
  title.className = 'title'
  const titleName = document.createElement('span')
  titleName.className = 'name'
  const titleArea = document.createElement('span')
  titleArea.className = 'area'
  title.append(titleName, titleArea)
  const button = (label: string, kind: string, act: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.dataset.choice = kind
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      act()
    })
    return b
  }
  const row = document.createElement('div')
  row.className = 'row'
  row.append(button('Not now', 'cancel', () => cancel()), button('Build it', 'apply', () => confirm()))
  const hintLine = document.createElement('span')
  hintLine.className = 'hint'
  hintLine.textContent = 'Drag the pegs to shape it'
  choice.append(title, hintLine, row)
  document.body.append(choice)

  // ── State ────────────────────────────────────────────────────────────────
  let draft: Draft | null = null
  /** The plan the draft makes, for drawing. */
  let made: Plan | null = null
  let editing: 'w' | 'd' | null = null
  let drag: { handle: Handle; start: Draft; off: number } | null = null
  let hover: Handle | null = null
  let shownAt = 0
  /** World points the tags hang from. */
  const anchors = { w: new THREE.Vector3(), d: new THREE.Vector3(), title: new THREE.Vector3() }
  let paths: { far: P[]; from: P[]; to: P[]; door: P[]; knob: P; pegs?: Array<[Handle, P]> } | null = null

  const accept = (next: Draft, quiet = true): boolean => {
    const fitted = fit(hooks.base(), next)
    if ('ask' in fitted) {
      if (!quiet) hooks.say(fitted.ask)
      if (drag) {
        refusedAt = performance.now()
        draw()
        setTimeout(() => draft && draw(), 650)
      }
      return false
    }
    draft = next
    made = fitted.plan
    draw()
    return true
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  const draw = () => {
    if (!draft || !made) return
    const base = hooks.base()
    const d = draft
    const geo = draftGeometry(base, d)
    const T = geo.thickness
    const far = curveOf(made, made.walls.find((w) => w.id === `${d.roomId}.w2`)!)
    const n = far.radius === Infinity ? 1 : 24
    const arc: P[] = Array.from({ length: n + 1 }, (_, i) => pointAt(far, (far.length * i) / n))
    const centre: P[] = [geo.p, ...arc, geo.q]
    const room = made.rooms.find((r) => r.id === d.roomId)!
    const bulge = Math.max(0, d.bend)
    const dimOff = T / 2 + 0.7
    // The new room's inside is to the right of p → pf → qf → q when the room is on the host's left of travel, and so on: pick by area sign.
    const side = Math.sign(dot([geo.out[0], geo.out[1]], [-geo.dir[1], geo.dir[0]])) || 1
    const wallIn = offsetPath(centre, (side > 0 ? -1 : 1) * T / 2)
    const wallOut = offsetPath(centre, (side > 0 ? 1 : -1) * T / 2)
    // Which side wall carries the depth: the one nearer the camera.
    const view = hooks.view()
    const depthAtTo = dot(geo.dir, view) < 0
    const tSide = depthAtTo ? d.to : d.from
    const sideDir: P = depthAtTo ? geo.dir : [-geo.dir[0], -geo.dir[1]]
    const wA = geo.at(d.from, d.depth + dimOff + bulge), wB = geo.at(d.to, d.depth + dimOff + bulge)
    const dA = add(geo.at(tSide, 0), sideDir, dimOff), dB = add(geo.at(tSide, d.depth), sideDir, dimOff)
    const doorA = geo.at(d.door.from), doorB = geo.at(d.door.to)
    const mid = pointAt(far, far.length / 2)
    // Inside the room, as the right wall's dot is, clear of the size tags outside.
    const knobAt = add(mid, geo.out, -0.55)
    paths = { far: arc, from: [geo.p, geo.pf], to: [geo.q, geo.qf], door: [doorA, doorB], knob: knobAt }

    // The sheet covers everything drawn, square, with a margin.
    const pts = [...wallOut, wA, wB, dA, dB, knobAt]
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const S = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 1.6
    const k = PX / S
    const px = (p: P): [number, number] => [(p[0] - cx + S / 2) * k, (p[1] - cz + S / 2) * k]
    sheet.position.set(cx, GROUND, cz)
    sheet.scale.set(S, S, 1)

    g.clearRect(0, 0, PX, PX)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    const trace = (path: P[], close = false) => {
      g.beginPath()
      path.forEach((p, i) => (i ? g.lineTo(...px(p)) : g.moveTo(...px(p))))
      if (close) g.closePath()
    }
    // A carpenter's pencil: each run bows a little and wanders slowly, overshoots its ends, and is gone over twice.
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
    const wander = (path: P[], over = 0): P[] => {
      const out: P[] = []
      path.forEach((p, i) => {
        if (i === 0) return
        const q = path[i - 1]
        const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1
        const u: P = [(p[0] - q[0]) / L, (p[1] - q[1]) / L], nrm: P = [-u[1], u[0]]
        const bow = rnd() * Math.min(0.03, L * 0.012)
        const a0 = i === 1 ? -over : 0, a1 = L + (i === path.length - 1 ? over : 0)
        const n = Math.max(2, Math.round((a1 - a0) / 0.12))
        const phase = rnd() * 6
        for (let s = 0; s <= n; s++) {
          if (s === 0 && out.length) continue
          const t = a0 + ((a1 - a0) * s) / n, f = t / L
          const off = Math.sin(Math.PI * Math.max(0, Math.min(1, f))) * bow + Math.sin(f * 7 + phase) * 0.004 + rnd() * 0.002
          out.push([q[0] + u[0] * t + nrm[0] * off, q[1] + u[1] * t + nrm[1] * off])
        }
      })
      return out
    }
    const refused = performance.now() - refusedAt < 600
    const chalk = (path: P[], width: number, alpha = 1, colour = INK, dash: number[] = [], over = 0) => {
      g.setLineDash(dash.map((v) => v * k))
      for (let pass = 0; pass < 2; pass++) {
        g.save()
        g.globalAlpha = alpha * (pass ? 0.45 : 0.85)
        g.strokeStyle = refused && (colour === INK || colour === GRAPHITE) ? CHALK_RED : colour
        g.lineWidth = width * k * (pass ? 0.55 : 1)
        if (pass) g.translate(0.006 * k, 0.004 * k)
        trace(wander(path, over * (pass ? 0.6 : 1)))
        g.stroke()
        g.restore()
      }
      g.setLineDash([])
    }
    /** Hatching by hand: uneven spacing, each stroke a little off the angle. */
    const hatch = (gap: number, alpha: number, width: number, dir: 1 | -1, colour = INK) => {
      g.strokeStyle = refused ? CHALK_RED : colour
      g.lineWidth = width * k
      for (let s = -PX; s < PX * 2; s += gap * k * (0.75 + Math.abs(rnd()))) {
        g.globalAlpha = alpha * (0.7 + rnd() * 0.6)
        const lean = rnd() * 0.08 * PX
        g.beginPath()
        g.moveTo(s, 0)
        g.lineTo(s + dir * PX + lean, PX)
        g.stroke()
      }
      g.globalAlpha = 1
    }

    // Tracing paper laid on the ground under the new room: a soft shadow, a slightly torn edge, and grain.
    const sheetRing = wander([...ringOf(made, room, -T / 2 - 0.4), ringOf(made, room, -T / 2 - 0.4)[0]])
    hooks.yard(offsetPath(sheetRing, 0.12))
    if (!LOT) {
    // The plot: a patch of turned earth staked out under the paper, its edge soft and tufted with grass.
    const plot = wander([...ringOf(made, room, -T / 2 - 0.62), ringOf(made, room, -T / 2 - 0.62)[0]])
    g.save()
    g.filter = `blur(${Math.round(0.12 * k)}px)`
    trace(plot, true)
    g.fillStyle = 'rgba(120, 84, 52, 0.22)'
    g.fill()
    g.restore()
    g.save()
    g.filter = `blur(${Math.max(1, Math.round(0.03 * k))}px)`
    trace(plot, true)
    g.clip()
    const soilPattern = g.createPattern(soil, 'repeat')!
    soilPattern.setTransform(new DOMMatrix().scale((k * 0.9) / 256))
    g.fillStyle = soilPattern
    g.globalAlpha = 0.4
    g.fillRect(0, 0, PX, PX)
    g.restore()
    {
      // Grass tufts along the plot's edge, leaning out.
      const tuft = (p: P, lean: number) => {
        const [x, y] = px(p)
        g.strokeStyle = rnd() > 0 ? 'rgba(104, 134, 64, 0.95)' : 'rgba(128, 156, 78, 0.95)'
        g.lineWidth = 0.012 * k
        for (let b = -2; b <= 2; b++) {
          g.beginPath()
          g.moveTo(x + b * 0.012 * k, y)
          g.quadraticCurveTo(x + (b * 0.02 + lean * 0.02) * k, y - 0.04 * k, x + (b * 0.035 + lean * 0.05) * k, y - (0.07 + Math.abs(rnd()) * 0.04) * k)
          g.stroke()
        }
      }
      for (let i = 0; i < plot.length; i += 2) tuft(plot[i], rnd() * 2)
    }
    g.save()
    g.filter = `blur(${Math.round(0.08 * k)}px)`
    g.translate(0.05 * k, 0.07 * k)
    trace(sheetRing, true)
    g.fillStyle = 'rgba(70, 40, 20, 0.3)'
    g.fill()
    g.restore()
    g.save()
    trace(sheetRing, true)
    g.fillStyle = PAPER
    g.fill()
    g.clip()
    g.globalCompositeOperation = 'multiply'
    g.globalAlpha = 0.45
    g.fillStyle = g.createPattern(grain, 'repeat')!
    g.fillRect(0, 0, PX, PX)
    g.restore()
    // Taped down at the corners, a pencil left lying by the far wall.
    const m = T / 2 + 0.4
    const corners: P[] = [
      add(add(geo.at(d.from, 0), geo.dir, -m), geo.out, m * 0.3), add(add(geo.at(d.from, d.depth), geo.dir, -m), geo.out, m),
      add(add(geo.at(d.to, d.depth), geo.dir, m), geo.out, m), add(add(geo.at(d.to, 0), geo.dir, m), geo.out, m * 0.3),
    ]
    const cc = corners.reduce((s, p) => [s[0] + p[0] / corners.length, s[1] + p[1] / corners.length], [0, 0] as P)
    const hues = ['#98ae74', '#d0805e', '#c39a46', '#7ea6b4']
    corners.forEach((p, i) => {
      const [x, y] = px(p), [cx2, cy2] = px(cc)
      drawTape(g, x, y, 0.5 * k, 0.16 * k, Math.atan2(y - cy2, x - cx2) + Math.PI / 2 + (i % 2 ? 0.15 : -0.12), hues[i % hues.length])
    })
    // The floor is bare paper: only two faint construction lines through the middle, as a sketch has.
    {
      const mA = geo.at((d.from + d.to) / 2, 0.15), mB = geo.at((d.from + d.to) / 2, d.depth - 0.15)
      const cA = geo.at(d.from + 0.15, d.depth / 2), cB = geo.at(d.to - 0.15, d.depth / 2)
      chalk([mA, mB], 0.008, 0.28, GRAPHITE, [0.18, 0.1])
      chalk([cA, cB], 0.008, 0.28, GRAPHITE, [0.18, 0.1])
    }

    }
    // A graphite smudge where the side of the pencil dragged along the walls.
    if (!LOT) g.save()
    if (LOT) {
      // The string runs just outside the walls to be built, a stake at each corner; the flour lies under it.
      const line = offsetPath(centre, (side > 0 ? 1 : -1) * (T / 2 + 0.2))
      line[0] = add(line[0], geo.out, T / 2 + 0.16)
      line[line.length - 1] = add(line[line.length - 1], geo.out, T / 2 + 0.16)
      stakeOut(line)
    } else {
    g.filter = `blur(${Math.round(0.07 * k)}px)`
    g.globalAlpha = 0.18
    g.strokeStyle = 'rgb(70, 52, 40)'
    g.lineWidth = T * 2.4 * k
    trace(offsetPath(centre, (side > 0 ? -1 : 1) * T * 0.9))
    g.stroke()
    g.restore()
    }

    // The new walls: both faces in pencil, the band between them hatched closer.
    g.save()
    g.beginPath()
    ;[...wallOut, ...[...wallIn].reverse()].forEach((p, i) => (i ? g.lineTo(...px(p)) : g.moveTo(...px(p))))
    g.closePath()
    g.fillStyle = refused ? 'rgba(214, 120, 96, 0.35)' : LOT ? 'rgba(252, 248, 238, 0.42)' : 'rgba(96, 88, 82, 0.16)'
    g.fill()
    g.clip()
    if (!LOT) hatch(0.045, 0.5, 0.009, -1, GRAPHITE)
    g.restore()
    // Height, the way a sketch shows it: a light hatched band falling outside the walls, as their shadow on the paper.
    if (!LOT) {
      const fall = offsetPath(centre, (side > 0 ? 1 : -1) * (T / 2 + 0.16))
      g.save()
      g.beginPath()
      ;[...fall, ...[...wallOut].reverse()].forEach((p, i) => (i ? g.lineTo(...px(p)) : g.moveTo(...px(p))))
      g.closePath()
      g.clip()
      hatch(0.035, 0.22, 0.007, 1, GRAPHITE)
      g.restore()
    }
    const ink = LOT ? FLOUR : INK
    chalk(wallOut, LOT ? 0.06 : 0.03, 1, LOT ? FLOUR : GRAPHITE, [], 0.1)
    chalk(wallIn, LOT ? 0.05 : 0.022, 0.9, LOT ? FLOUR : GRAPHITE, [], 0.08)

    // The door: jambs across the shared wall, and each leaf with its swing into the new room.
    for (const t of [d.door.from, d.door.to]) chalk([geo.at(t, -T / 2 - 0.04), geo.at(t, T / 2 + 0.04)], 0.03, 1, ink)
    const dw = d.door.to - d.door.from
    const hinges: Array<{ at: number; dir: 1 | -1; r: number }> = d.door.leaves === 2
      ? [{ at: d.door.from, dir: 1, r: dw / 2 }, { at: d.door.to, dir: -1, r: dw / 2 }]
      : d.door.leaves === 1 ? [{ at: d.door.from, dir: 1, r: dw }] : []
    for (const h of hinges) {
      const hinge = geo.at(h.at, T / 2)
      const open = add(hinge, geo.out, h.r)
      chalk([hinge, open], 0.024, 1, ink)
      const arcPts: P[] = Array.from({ length: 17 }, (_, i) => {
        const a = (i / 16) * Math.PI / 2
        return add(add(hinge, geo.dir, h.dir * h.r * Math.cos(a)), geo.out, h.r * Math.sin(a))
      })
      chalk(arcPts, LOT ? 0.03 : 0.013, 0.7, ink, [0.06, 0.07])
    }
    if (!d.door.leaves) chalk([geo.at(d.door.from, T / 2), geo.at(d.door.to, T / 2)], 0.013, 0.7, ink, [0.06, 0.07])

    // Sizes: a tape measure along each side; the number is the handwritten tag on it.
    const dimension = (a: P, b: P) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const u: P = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nrm: P = [-u[1], u[0]]
      // A cloth tape measure laid along the side, with a pencil tick on the paper at each end.
      drawTapeMeasure(g, px(a), px(b), 0.13 * k, k)
      for (const p of [a, b]) chalk([add(add(p, nrm, -0.12), u, -0.015), add(add(p, nrm, 0.12), u, 0.015)], 0.016, 0.9, PENCIL)
    }
    if (!LOT) {
      dimension(wA, wB)
      dimension(dA, dB)
    }

    // Grips: a wooden peg standing on each wall it moves (and on the door), with arrows pencilled on the paper
    // beside it for the way it goes. The sage peg bends the far wall: a dashed pencil curve runs from that wall's
    // ends through it, the wall it would make.
    const active = drag?.handle ?? hover
    const pegs: Array<[Handle, P, P]> = [
      ['far', pointAt(far, far.length * 0.3), geo.out],
      ['from', geo.at(d.from, d.depth / 2), geo.dir],
      ['to', geo.at(d.to, d.depth / 2), geo.dir],
    ]
    paths.pegs = pegs.map(([h, p]) => [h, p] as [Handle, P])
    const doorAt = geo.at((d.door.from + d.door.to) / 2, 0)
    const arrows = (p: P, u: P, live: boolean) => {
      const nrm: P = [-u[1], u[0]]
      g.save()
      g.globalAlpha = live ? 0.95 : 0.7
      g.strokeStyle = live ? '#b8641e' : LOT ? FLOUR : PENCIL
      g.lineWidth = 0.022 * k
      g.lineCap = g.lineJoin = 'round'
      for (const sgn of [1, -1]) {
        const tip = add(p, u, sgn * 0.34), base = add(p, u, sgn * 0.22)
        g.beginPath()
        g.moveTo(...px(add(base, nrm, 0.06)))
        g.lineTo(...px(tip))
        g.lineTo(...px(add(base, nrm, -0.06)))
        g.stroke()
      }
      g.restore()
      // A soft shadow under the peg.
      g.save()
      g.filter = `blur(${Math.max(1, Math.round(0.025 * k))}px)`
      g.fillStyle = 'rgba(60, 34, 16, 0.35)'
      g.beginPath()
      g.arc(...px(add(p, [0.6, 0.8], 0.04)), 0.14 * k, 0, Math.PI * 2)
      g.fill()
      g.restore()
    }
    for (const [h, p, u] of pegs) arrows(p, u, active === h)
    arrows(doorAt, geo.dir, active === 'door')
    {
      // The bend guide: from the far wall's ends through the sage peg.
      const a0 = arc[0], a1 = arc[arc.length - 1]
      const c: P = [2 * knobAt[0] - (a0[0] + a1[0]) / 2, 2 * knobAt[1] - (a0[1] + a1[1]) / 2]
      const guide: P[] = Array.from({ length: 25 }, (_, i) => {
        const t = i / 24
        return [(1 - t) ** 2 * a0[0] + 2 * (1 - t) * t * c[0] + t * t * a1[0], (1 - t) ** 2 * a0[1] + 2 * (1 - t) * t * c[1] + t * t * a1[1]]
      })
      chalk(guide, LOT ? 0.022 : 0.014, active === 'bend' ? 0.9 : 0.55, active === 'bend' ? '#6f8a55' : LOT ? FLOUR : PENCIL, [0.08, 0.07])
      arrows(knobAt, geo.out, active === 'bend')
    }
    for (const [h, at] of [...pegs.map(([h, p]) => [h, p] as [Handle, P]), ['door', doorAt] as [Handle, P], ['bend', knobAt] as [Handle, P]]) {
      const m = pegMeshes.get(h)!
      m.group.position.set(at[0], GROUND, at[1])
      const live = active === h
      m.head.material = live ? pegLive : m.top
      m.group.scale.setScalar(live ? 1.18 : 1)
    }
    // The pencil lies on the paper outside the walls, clear of every peg.
    const tOther = depthAtTo ? d.from : d.to
    const otherDir: P = depthAtTo ? [-geo.dir[0], -geo.dir[1]] : geo.dir
    if (!LOT) drawPencil(g, ...px(add(geo.at(tOther, Math.min(d.depth * 0.75, d.depth - 0.5)), otherDir, T / 2 + 0.26)), 0.62 * k, Math.atan2(geo.out[1], geo.out[0]) + 0.12)
    sheetMap.needsUpdate = true

    // Tags.
    anchors.w.set((wA[0] + wB[0]) / 2, 0.05, (wA[1] + wB[1]) / 2)
    anchors.d.set((dA[0] + dB[0]) / 2, 0.05, (dA[1] + dB[1]) / 2)
    // Beyond the far wall, so the tag never sits over the sketch.
    const beyond = add(mid, geo.out, bulge + 1.1)
    anchors.title.set(beyond[0], 0.6, beyond[1])
    if (editing !== 'w') tags.w.textContent = `${fmt(d.to - d.from)} m`
    if (editing !== 'd') tags.d.textContent = `${fmt(d.depth)} m`
    titleName.textContent = /^New room( \d+)?$/.test(d.label) ? 'A new room' : `The new ${d.label.toLowerCase()}`
    titleArea.textContent = ` · ${roomArea(made, d.roomId).toFixed(1)} m²`
  }

  // ── Opening, closing, applying ────────────────────────────────────────────
  const open = (next: Draft) => {
    draft = null
    if (!accept(next)) return false
    if (!group.parent) stage.scene.add(group)
    for (const el of [tags.w, tags.d, choice]) el.classList.add('shown')
    shownAt = performance.now()
    place()
    return true
  }
  const close = () => {
    draft = made = null
    drag = null
    hover = null
    editing = null
    group.removeFromParent()
    hooks.yard(null)
    for (const el of [tags.w, tags.d, choice, field]) el.classList.remove('shown')
    stage.renderer.domElement.style.cursor = ''
  }
  const confirm = () => {
    if (!draft) return
    if (editing) commitNumber()
    hooks.apply(draft)
  }
  const cancel = () => {
    if (!draft) return
    close()
  }

  // ── Typing a size ────────────────────────────────────────────────────────
  const editNumber = (dim: 'w' | 'd') => {
    if (!draft) return
    editing = dim
    field.value = fmt(dim === 'w' ? draft.to - draft.from : draft.depth)
    field.classList.add('shown')
    tags[dim].classList.add('editing')
    place()
    field.focus({ preventScroll: true })
    field.select()
  }
  const endEdit = () => {
    if (editing) tags[editing].classList.remove('editing')
    editing = null
    field.classList.remove('shown')
    field.blur()
    draw()
  }
  const commitNumber = () => {
    if (!draft || !editing) return
    const v = Number(field.value.replace(',', '.').replace(/m$/i, '').trim())
    const dim = editing
    endEdit()
    if (!Number.isFinite(v) || v < MIN || v > 12) return hooks.say(`Somewhere between ${MIN} and 12 metres, please.`)
    setNumber(dim, v, false)
  }
  /** Width keeps the room centred where it is (inside the wall); depth grows away from the wall. */
  const setNumber = (dim: 'w' | 'd', v: number, quiet = true): boolean => {
    if (!draft) return false
    const d = draft
    if (dim === 'd') return accept({ ...d, depth: snap(v) }, quiet)
    const L = draftGeometry(hooks.base(), d).hostLength
    const w = snap(v)
    if (w > L + 1e-9) {
      if (!quiet) hooks.say(`That wall is only ${fmt(L)} m long.`)
      return false
    }
    const from = snap(Math.min(Math.floor((L - w) / SNAP) * SNAP, Math.max(0, (d.from + d.to) / 2 - w / 2)))
    const to = snap(from + w)
    const dw = d.door.to - d.door.from
    return accept({ ...d, from, to, door: { ...d.door, ...placeDoor(from, to, dw, (d.door.from + d.door.to) / 2) } }, quiet)
  }
  field.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commitNumber()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      endEdit()
    }
  })
  field.addEventListener('blur', () => editing && commitNumber())

  // ── Dragging ─────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()
  const ground = (e: PointerEvent): P | null => {
    const r = stage.renderer.domElement.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    return raycaster.ray.intersectPlane(floor, hit) ? [hit.x, hit.z] : null
  }
  const pick = (p: P): Handle | null => {
    if (!paths) return null
    if (Math.hypot(p[0] - paths.knob[0], p[1] - paths.knob[1]) < 0.32) return 'bend'
    for (const [h, q] of paths.pegs ?? []) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.24) return h
    if (toPath(p, paths.door) < 0.3) return 'door'
    if (toPath(p, paths.far) < 0.3) return 'far'
    if (toPath(p, paths.from) < 0.3) return 'from'
    if (toPath(p, paths.to) < 0.3) return 'to'
    return null
  }
  /** Metres along the host wall and away from it, for a floor point. */
  const frame = (p: P) => {
    const geo = draftGeometry(hooks.base(), draft!)
    const o = geo.at(0)
    const v: P = [p[0] - o[0], p[1] - o[1]]
    return { along: dot(v, geo.dir), across: dot(v, geo.out), L: geo.hostLength }
  }
  const dragTo = (p: P) => {
    if (!drag || !draft) return
    const s = drag.start
    const f = frame(p)
    const v = (h: Handle) => (h === 'far' || h === 'bend' ? f.across : f.along) - drag!.off
    const dw = s.door.to - s.door.from
    const doorAt = (s.door.from + s.door.to) / 2
    let next: Draft
    switch (drag.handle) {
      case 'far': next = { ...s, depth: Math.max(MIN, snap(v('far'))) }; break
      case 'bend': {
        // The dot sits 0.55 m in from the far wall's middle; pulling it moves the middle with it.
        const limit = Math.floor(((s.to - s.from) / 2) / BEND_SNAP) * BEND_SNAP
        const raw = v('bend') - s.depth + 0.55
        next = { ...s, bend: Math.max(-limit, Math.min(limit, snap(raw, BEND_SNAP))) }
        break
      }
      case 'from': {
        const from = Math.max(0, Math.min(s.to - MIN, snap(v('from'))))
        next = { ...s, from, door: { ...s.door, ...placeDoor(from, s.to, dw, doorAt) } }
        break
      }
      case 'to': {
        const to = Math.min(Math.floor(f.L / SNAP) * SNAP, Math.max(s.from + MIN, snap(v('to'))))
        next = { ...s, to, door: { ...s.door, ...placeDoor(s.from, to, dw, doorAt) } }
        break
      }
      case 'door': {
        // The door stops only where it keeps clear of the built-ins; over one, the tag says what is there.
        const wanted = blockerOf(placeDoor(s.from, s.to, dw, v('door')), s.keepOut)
        next = { ...s, door: { ...s.door, ...placeDoor(s.from, s.to, dw, v('door'), s.keepOut) } }
        if (JSON.stringify(next) !== JSON.stringify(draft)) accept(next)
        titleArea.textContent = wanted ? ` · the ${wanted.name} is in the way` : ` · ${roomArea(made!, draft.roomId).toFixed(1)} m²`
        return
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(draft)) accept(next)
  }
  const stop = (e: Event) => {
    e.stopImmediatePropagation()
    e.preventDefault()
  }
  const onDown = (e: PointerEvent) => {
    if (!draft || e.button !== 0 || e.target !== stage.renderer.domElement) return
    const p = ground(e)
    const h = p && pick(p)
    if (!h) return
    stop(e)
    const f = frame(p)
    // Remember where on the handle it was grabbed, so it does not jump to the pointer.
    const at = h === 'far' ? draft.depth : h === 'bend' ? draft.depth + draft.bend - 0.55 : h === 'from' ? draft.from : h === 'to' ? draft.to : (draft.door.from + draft.door.to) / 2
    drag = { handle: h, start: draft, off: (h === 'far' || h === 'bend' ? f.across : f.along) - at }
    draw()
  }
  const onMove = (e: PointerEvent) => {
    if (!draft) return
    // While dragging, the pointer may pass over a tag; the floor point still counts.
    const p = drag || e.target === stage.renderer.domElement ? ground(e) : null
    if (!drag) {
      const was = hover
      hover = p ? pick(p) : null
      if (hover !== was) {
        stage.renderer.domElement.style.cursor = hover ? 'grab' : ''
        draw()
      }
      if (hover && e.buttons === 0) e.stopImmediatePropagation()
      return
    }
    stop(e)
    stage.renderer.domElement.style.cursor = 'grabbing'
    if (p) dragTo(p)
  }
  const onUp = (e: PointerEvent) => {
    if (!drag) return
    stop(e)
    drag = null
    stage.renderer.domElement.style.cursor = hover ? 'grab' : ''
    draw()
  }
  const typing = () => {
    const a = document.activeElement
    return (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && a !== field && a.value.trim() !== ''
  }
  const onKey = (e: KeyboardEvent) => {
    if (!draft || editing || e.defaultPrevented || typing()) return
    if (e.key === 'Escape') {
      stop(e)
      if (drag) {
        accept(drag.start)
        drag = null
      } else cancel()
    } else if (e.key === 'Enter' && !drag) {
      stop(e)
      confirm()
    }
  }
  const listening = new AbortController()
  const listen = { capture: true, signal: listening.signal }
  addEventListener('pointerdown', onDown, listen)
  addEventListener('pointermove', onMove, listen)
  addEventListener('pointerup', onUp, listen)
  addEventListener('keydown', onKey, listen)

  // ── Each frame: hang the tags on their world points ──────────────────────
  const v = new THREE.Vector3()
  const screen = (p: THREE.Vector3): [number, number] => {
    v.copy(p).project(stage.camera)
    const r = stage.renderer.domElement.getBoundingClientRect()
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]
  }
  const at = (el: HTMLElement, x: number, y: number, ax = '-50%', ay = '-50%') => {
    const t = `calc(${Math.round(x)}px + ${ax}) calc(${Math.round(y)}px + ${ay})`
    if (el.style.translate !== t) el.style.translate = t
  }
  const place = () => {
    if (!draft) return
    const [wx, wy] = screen(anchors.w), [dx, dy] = screen(anchors.d)
    // Tags stay on screen, whole, however the room sits in the view.
    const inX = (x: number) => Math.min(innerWidth - 60, Math.max(60, x)), inY = (y: number) => Math.min(innerHeight - 24, Math.max(24, y))
    at(tags.w, inX(wx), inY(wy))
    at(tags.d, inX(dx), inY(dy))
    const [tx, ty] = screen(anchors.title)
    // On a phone the choice docks to the bottom, in reach of a thumb, as placing's tag does.
    const docked = innerWidth < 700 && innerHeight > innerWidth
    choice.classList.toggle('docked', docked)
    if (docked) choice.style.translate = ''
    else at(choice, Math.min(innerWidth - 150, Math.max(150, tx)), Math.max(16, ty), '-50%', '-100%')
    if (editing) {
      const [ex, ey] = editing === 'w' ? [wx, wy] : [dx, dy]
      at(field, ex, ey)
    }
  }

  const dispose = () => {
    close()
    listening.abort()
    for (const el of [tags.w, tags.d, field, choice, style]) el.remove()
    sheet.geometry.dispose()
    ;(sheet.material as THREE.Material).dispose()
    sheetMap.dispose()
    for (const x of [pegBody, pegHead, pegWood, pegTop, pegSage, pegLive, stakeGeo, stringGeo, stakeWood, stringMat]) x.dispose()
  }

  /** Screen points (CSS px) of each grip, for the checks. */
  const grips = () => {
    if (!paths || !draft) return null
    const s = (p: P, y = 0) => screen(new THREE.Vector3(p[0], y, p[1]))
    const mid = (path: P[]) => path[Math.floor(path.length / 2)]
    const geo = draftGeometry(hooks.base(), draft)
    return {
      far: s(paths.far.length > 2 ? mid(paths.far) : [(paths.far[0][0] + paths.far[1][0]) / 2, (paths.far[0][1] + paths.far[1][1]) / 2]),
      from: s(geo.at(draft.from, draft.depth / 2)), to: s(geo.at(draft.to, draft.depth / 2)),
      door: s(geo.at((draft.door.from + draft.door.to) / 2, 0)), bend: s(paths.knob),
      /** A floor point d metres along the host wall and a metres out from it. */
      at: (along: number, across: number) => s(geo.at(along, across)),
    }
  }

  return {
    open,
    close,
    confirm,
    cancel,
    setNumber,
    /** Re-fit against a changed house; closes and says why when it no longer fits. */
    refit: () => {
      if (!draft) return
      const fitted = fit(hooks.base(), draft)
      if ('ask' in fitted) {
        close()
        hooks.say(fitted.ask)
      } else accept(draft)
    },
    frame: () => draft && place(),
    dragging: () => drag !== null,
    draft: () => draft,
    made: () => made,
    shownAt: () => shownAt,
    grips,
    dispose,
  }
}


function css() {
  return `
  .build-dim, .build-choice, .build-dim-field { position: fixed; z-index: 6; left: 0; top: 0; opacity: 0; pointer-events: none; transition: opacity 160ms ease, scale 200ms cubic-bezier(.2, 1.4, .4, 1); scale: 0.9; }
  .build-dim { min-height: 44px; padding: 4px 10px 6px; border: 0; background: none; cursor: text; rotate: -3deg; color: #4f3322; font: 700 23px ${HAND};
    text-shadow: 0 0 2px #fbf1dd, 0 0 5px #fbf1dd, 0 0 9px rgba(251, 241, 221, 0.9); }
  .build-dim[data-dim='d'] { rotate: 4deg; }
  .build-dim::after { content: ''; position: absolute; left: 12px; right: 12px; bottom: 8px; height: 2px; border-radius: 2px; opacity: 0.35;
    background: repeating-linear-gradient(90deg, #6a4630 0 6px, transparent 6px 10px); }
  .build-dim:hover::after, .build-dim:focus-visible::after { opacity: 0.8; }
  .build-dim:focus-visible { outline: 3px solid #e7a35c; outline-offset: 2px; border-radius: 8px; }
  .build-dim.shown, .build-choice.shown, .build-dim-field.shown { opacity: 1; scale: 1; pointer-events: auto; }
  .build-dim.editing { opacity: 0; pointer-events: none; }
  .build-dim-field { width: 92px; padding: 3px 10px 5px; border: 1.5px dashed rgba(150, 100, 60, 0.5); border-radius: 9px; text-align: center;
    background: #fffaf0; color: #4a3428; font: 700 20px ${HAND}; box-shadow: 0 6px 14px rgba(60, 30, 10, 0.22); outline: none; }
  .build-choice { display: grid; gap: 6px; min-width: 220px; padding: 14px 18px 12px 20px; transform-origin: 50% 100%; rotate: -1.2deg; }
  ${tagCss('.build-choice', ".build-choice button[data-choice='apply']", ".build-choice button[data-choice='cancel']", '[aria-disabled=true]')}
  .build-choice::after { content: ''; position: absolute; left: 50%; bottom: -8px; width: 16px; height: 16px; margin-left: -8px; rotate: 45deg;
    background: #f4e6cb; border-radius: 0 0 4px 0; box-shadow: 3px 3px 5px rgba(60, 30, 10, 0.12); }
  .build-choice .title { white-space: nowrap; color: #6a4a34; }
  .build-choice .title .name { font: 700 20px/1.1 ${HAND}; color: #4a3428; letter-spacing: 0.01em; }
  .build-choice .title .area { font: italic 600 17px ${HAND}; color: #5e4434; }
  .build-choice .hint { font: 500 15px/1.4 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; color: #5e4434; }
  .build-choice .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; position: relative; z-index: 1; }
  .build-choice.docked { z-index: 40; left: 12px; right: 12px; top: auto; bottom: calc(14px + env(safe-area-inset-bottom)); rotate: -0.6deg; transform-origin: 50% 100%; }
  .build-choice.docked::after { display: none; }
  .build-choice.docked .title { white-space: normal; }
  .build-choice.docked .row button { flex: 1; min-height: 48px; font-size: 18px; }
  @media (prefers-reduced-motion: reduce) { .build-dim, .build-choice, .build-dim-field { transition: none; } }
  `
}
