// The outline of a room being added (#48): the room staked out on the lawn, the way
// one is marked out on grass. A flour line runs round the walls to be built (the far
// wall as an arc when it bends) and along the shared wall, broken where the door goes,
// with the doorway standing in the shared wall as a felt ghost; stakes stand at its corners on the
// flour line, which is the one outline; the room's first pieces stand inside as soft felt ghosts; wooden pegs sit on
// the walls they move, and handwritten tags give the sizes and the choice. Trusted code
// draws it from a draft (resolve.ts); the person adjusts it directly: drag a peg or a
// wall, pull the sage peg to bend the far wall, slide the door, or click a size and
// type a number. Enter builds it, Escape lets it go. Nothing here touches the plan:
// applying is the caller's commit.
import * as THREE from 'three/webgpu'
import { releaseGpu, type Stage } from '../kernel'
import { canvas, toTexture } from '../paint'
import { CHALK_RED, HAND, tagCss } from './sketch'
import { BEND_SNAP, curveOf, outline as ringOf, pointAt, roomArea, roomsOf, type Furniture, type P, type Plan } from './plan'
import { SNAP, blockerOf, draftGeometry, fit, placeDoor, type Draft } from './resolve'
import { KINDS, obstacles, poseOf, seat, setPose, type Obstacle } from './mount'
import { firstPieces } from './firstroom'
import { YARD_TOP } from '../diorama'

/** Flour poured round the walls to be, the way a room is marked out on grass. */
const FLOUR = 'rgba(252, 248, 238, 0.96)'
/** The drawing and the pegs lie on the lawn. */
const GROUND = YARD_TOP + 0.006
/** The stakes' height. */
const STAKE_H = 0.3

const MIN = 1.5
const PX = 1024

export type Handle = 'far' | 'from' | 'to' | 'bend' | 'door'
type Side = 'left' | 'right' | 'above' | 'below'

export interface OutlineHooks {
  /** The plan the draft hangs on: the house as it stands. */
  base(): Plan
  apply(draft: Draft): void
  /** One short line in the person's villager's voice. */
  say(text: string): void
  /** The camera's view direction on the floor. */
  view(): P
  /** The staked-out room's footprint on the ground (null when it is let go): the lot grows round it. */
  yard(footprint: P[] | null): void
}

const snap = (v: number, step = SNAP) => Math.round(Math.round(v / step) * step * 1e6) / 1e6
const fmt = (v: number) => v.toFixed(1)
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k]

/** How big a room is next to another, in words. */
export function sizeWords(area: number, than: number, label: string): string {
  const r = area / (than || 1)
  const the = `the ${label.toLowerCase()}`
  if (r < 0.35) return `much smaller than ${the}`
  if (r < 0.6) return `about half the size of ${the}`
  if (r < 0.88) return `a bit smaller than ${the}`
  if (r <= 1.14) return `about as big as ${the}`
  if (r < 1.6) return `a bit bigger than ${the}`
  if (r < 2.5) return `about twice ${the}`
  return `much bigger than ${the}`
}

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
  group.userData.body = false // a proposal drawn on the floor, not a thing (src/physics/home.ts)

  // The flour: one canvas on a plane laid on the lawn, moved and scaled to fit the room.
  const [sheetCanvas, g] = canvas(PX, PX)
  const sheetMap = toTexture(sheetCanvas)
  // Lit like the lawn, so the house and the stakes cast their shadows across it.
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
    map: sheetMap, roughness: 1, metalness: 0, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }))
  sheet.receiveShadow = true
  sheet.rotation.x = -Math.PI / 2
  sheet.renderOrder = 3
  sheet.name = 'build outline sheet'
  // A proposal is marked out, not built: only "Build it" raises real walls (plugins/build.ts).
  group.add(sheet)
  // Where the door will be cut, taped out on the face of the shared wall the camera sees.
  const DOOR_PX = [256, 512] as const
  const [markCanvas, mg] = canvas(DOOR_PX[0], DOOR_PX[1])
  const markMap = toTexture(markCanvas)
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
    map: markMap, roughness: 0.9, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }))
  mark.name = 'build outline door mark'
  mark.renderOrder = 3
  group.add(mark)
  /** The doorway to be: a warm shade where the wall will open, masking tape round it, a line where two leaves would meet. */
  const paintMark = (w: number, h: number, leaves: number) => {
    const [W, H] = DOOR_PX
    const sx = W / w, sy = H / h
    mg.clearRect(0, 0, W, H)
    const tape = 0.075
    // A doorway with its head's corners eased, the shape the casing will have once it is cut.
    const rise = Math.min(0.14, w * 0.12), spring = rise
    const arch = (inset: number) => {
      mg.beginPath()
      mg.moveTo(inset * sx, h * sy)
      mg.lineTo(inset * sx, spring * sy)
      mg.bezierCurveTo(inset * sx, (inset * 0.6) * sy, (w - inset) * sx, (inset * 0.6) * sy, (w - inset) * sx, spring * sy)
      mg.lineTo((w - inset) * sx, h * sy)
    }
    arch(tape / 2)
    mg.closePath()
    mg.fillStyle = 'rgba(132, 82, 46, 0.34)'
    mg.fill()
    // Hand-laid tape: a strong strip with a lighter edge where it catches the light.
    for (const [colour, width] of [['rgba(229, 116, 56, 0.95)', tape], ['rgba(255, 226, 190, 0.35)', tape * 0.28]] as const) {
      mg.save()
      mg.strokeStyle = colour
      mg.lineWidth = width * sx
      mg.lineJoin = 'round'
      arch(tape / 2)
      mg.stroke()
      mg.restore()
    }
    if (leaves === 2) {
      mg.save()
      mg.strokeStyle = 'rgba(229, 116, 56, 0.85)'
      mg.lineWidth = 0.022 * sx
      mg.setLineDash([0.07 * sy, 0.05 * sy])
      mg.beginPath()
      mg.moveTo((w / 2) * sx, (tape + 0.06) * sy)
      mg.lineTo((w / 2) * sx, h * sy)
      mg.stroke()
      mg.restore()
    }
    markMap.needsUpdate = true
  }
  /** Wooden pegs standing on the walls they move: a turned body and a lighter head; the bend peg's head is sage. */
  const pegBody = new THREE.CylinderGeometry(0.11, 0.13, 0.1, 24)
  pegBody.translate(0, 0.05, 0)
  const pegHead = new THREE.CylinderGeometry(0.1, 0.11, 0.035, 24)
  pegHead.translate(0, 0.115, 0)
  const pegWood = new THREE.MeshStandardMaterial({ color: '#6e4429', roughness: 0.6 })
  const pegTop = new THREE.MeshStandardMaterial({ color: '#f4dcb2', roughness: 0.55, emissive: '#5a3a1e', emissiveIntensity: 0.12 })
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
  // Stakes at the corners of the walls to be built, standing on the flour line (no string: one outline, not two).
  const stakeGeo = new THREE.BoxGeometry(0.06, STAKE_H, 0.06)
  stakeGeo.translate(0, STAKE_H / 2, 0)
  const stakeTip = new THREE.ConeGeometry(0.05, 0.05, 4)
  stakeTip.rotateY(Math.PI / 4)
  stakeTip.translate(0, STAKE_H + 0.025, 0)
  const stakeWood = new THREE.MeshStandardMaterial({ color: '#d2a873', roughness: 0.8 })
  const stakes: THREE.Group[] = []
  const stakeGroup = new THREE.Group()
  stakeGroup.name = 'build outline stakes'
  group.add(stakeGroup)
  /** Stakes at the given points. */
  const stakeOut = (at: P[]) => {
    at.forEach((p, i) => {
      if (!stakes[i]) {
        const s = new THREE.Group()
        const post = new THREE.Mesh(stakeGeo, stakeWood), tip = new THREE.Mesh(stakeTip, stakeWood)
        post.castShadow = tip.castShadow = true
        s.add(post, tip)
        stakeGroup.add(stakes[i] = s)
      }
      const m = stakes[i]
      m.visible = true
      m.position.set(p[0], YARD_TOP, p[1])
      m.rotation.set((i % 2 ? 1 : -1) * 0.03, i * 0.7, (i % 3 ? 1 : -1) * 0.025)
    })
    for (let i = at.length; i < stakes.length; i++) stakes[i].visible = false
  }

  // ── The first pieces, as soft felt ghosts inside the flour ────────────────
  const ghosts = new THREE.Group()
  ghosts.name = 'build outline ghosts'
  group.add(ghosts)
  // Warm felt, half there, with a soft pencil rim, so the pieces read on grass in sun or shade.
  const ghostFelt = new THREE.MeshStandardMaterial({ color: '#d99a62', emissive: '#7a4220', emissiveIntensity: 0.18, roughness: 1, transparent: true, opacity: 0.62 })
  const ghostRug = new THREE.MeshStandardMaterial({ color: '#d99a62', emissive: '#7a4220', emissiveIntensity: 0.18, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false })
  const ghostRim = new THREE.MeshBasicMaterial({ color: '#5c3a22', side: THREE.BackSide, transparent: true, opacity: 0.6, fog: false })
  /** The doorway to be, as a felt ghost standing in the shared wall: two posts and a lintel (placed by layout below). */
  const DOOR_POST = 0.1
  const doorBox = new THREE.BoxGeometry(1, 1, 1)
  const doorGhost = new THREE.Group()
  doorGhost.name = 'build outline door ghost'
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(doorBox, ghostFelt)
    m.renderOrder = 3
    m.raycast = () => {}
    doorGhost.add(m)
  }
  ghosts.add(doorGhost)
  /** One ghost per kind, built on first need and kept while the outline lives. */
  const ghostOf = new Map<string, THREE.Group>()
  const ghost = (kind: string) => {
    let h = ghostOf.get(kind)
    if (!h) {
      const k = KINDS[kind]
      const made = seat(k.build(), k.mount)
      h = made.holder
      h.name = `build outline ghost ${kind}`
      const rims: Array<[THREE.Mesh, THREE.Mesh]> = []
      h.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const was = m.material as THREE.MeshStandardMaterial
        // A piece's own contact shadow stays off the lawn: the flour already marks the floor.
        if (m.userData.contact) {
          m.visible = false
          return
        }
        // A rug is a flat amber patch, as faint as the felt; everything else is plain felt with a rim.
        if (kind.endsWith('rug')) {
          was.map?.dispose()
          m.material = ghostRug
        } else {
          was.map?.dispose()
          m.material = ghostFelt
          m.renderOrder = 3
          // The rim: the same shape a little larger, its inside showing only round the outline.
          m.geometry.computeBoundingBox()
          const size = m.geometry.boundingBox!.getSize(new THREE.Vector3())
          const rim = new THREE.Mesh(m.geometry, ghostRim)
          rim.scale.set(1 + 0.045 / Math.max(size.x, 0.02), 1 + 0.045 / Math.max(size.y, 0.02), 1 + 0.045 / Math.max(size.z, 0.02))
          rim.renderOrder = 4
          rim.raycast = () => {}
          rims.push([m, rim])
        }
        if (m.material !== was) was.dispose()
        m.castShadow = m.receiveShadow = false
        m.raycast = () => {}
      })
      for (const [m, rim] of rims) m.add(rim)
      ghostOf.set(kind, h)
      ghosts.add(h)
    }
    return h
  }
  /** What is already in the house, looked at once per outline. */
  let seen: Obstacle[] | null = null
  let pieces: Furniture[] = []
  const showGhosts = (base: Plan, made: Plan, d: Draft) => {
    seen ??= obstacles(stage.scene, [group])
    pieces = firstPieces(base, made, d, null, [], seen)
    const shown = new Set<string>()
    for (const f of pieces) {
      // No walls stand yet, so nothing hangs: only what stands on the floor.
      if (f.at.mount !== 'floor' || !('kind' in f.item)) continue
      const h = ghost(f.item.kind)
      const pose = poseOf(made, f.at)
      if (!pose) continue
      setPose(h, pose)
      h.position.y = GROUND + 0.002
      h.visible = true
      shown.add(f.item.kind)
    }
    for (const [kind, h] of ghostOf) if (!shown.has(kind)) h.visible = false
  }

  let ghostsDue = false
  /** A refused drag flashes the walls chalk red for a moment. */
  let refusedAt = -Infinity

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
  /** A small paper label over the taped doorway, saying what will be cut there. */
  const doorTag = document.createElement('div')
  doorTag.className = 'build-door'
  doorTag.setAttribute('aria-hidden', 'true')
  document.body.append(doorTag)
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
  const anchors = { w: new THREE.Vector3(), d: new THREE.Vector3(), door: new THREE.Vector3() }
  let paths: { far: P[]; from: P[]; to: P[]; door: P[]; knob: P; pegs?: Array<[Handle, P]> } | null = null
  /** The staked-out room's points on the ground, for keeping the card off it. */
  let plot: P[] = []
  /** The side of the room the choice card stands on, kept while it still fits there. */
  let cardSide: Side | null = null

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

  /** The room's size next to the room it opens from, in words. */
  const sizeLine = (base: Plan, m: Plan, d: Draft) => {
    const host = roomsOf(base, d.wallId)[0]
    return host ? sizeWords(roomArea(m, d.roomId), roomArea(base, host.id), host.label) : `${roomArea(m, d.roomId).toFixed(1)} m²`
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
    // The outer line starts and ends on the host wall's outer face, where the new walls meet it.
    wallOut[0] = add(wallOut[0], geo.out, T / 2)
    wallOut[wallOut.length - 1] = add(wallOut[wallOut.length - 1], geo.out, T / 2)
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
    // What the choice card must keep clear of: the staked-out room, its stakes and its pegs.
    plot = [...wallOut, ...wallIn, knobAt]

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
    // Poured by hand: each run bows a little and wanders slowly, overshoots its ends, and is gone over twice.
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
    const flour = (path: P[], width: number, alpha = 1, colour = FLOUR, dash: number[] = [], over = 0) => {
      g.setLineDash(dash.map((v) => v * k))
      for (let pass = 0; pass < 2; pass++) {
        g.save()
        g.globalAlpha = alpha * (pass ? 0.45 : 0.85)
        g.strokeStyle = refused && colour === FLOUR ? CHALK_RED : colour
        g.lineWidth = width * k * (pass ? 0.55 : 1)
        if (pass) g.translate(0.006 * k, 0.004 * k)
        trace(wander(path, over * (pass ? 0.6 : 1)))
        g.stroke()
        g.restore()
      }
      g.setLineDash([])
    }

    hooks.yard(ringOf(made, room, -T / 2 - 0.08))
    // Stakes at the outer corners (and along a bend), on the outer flour line.
    {
      const corners: P[] = [wallOut[0], wallOut[1], ...(n > 1 ? [wallOut[1 + n / 2]] : []), wallOut[wallOut.length - 2], wallOut[wallOut.length - 1]]
      stakeOut(corners)
    }

    // The walls to be built: a light band of flour between their two faces, a firm line on each.
    g.save()
    g.beginPath()
    ;[...wallOut, ...[...wallIn].reverse()].forEach((p, i) => (i ? g.lineTo(...px(p)) : g.moveTo(...px(p))))
    g.closePath()
    g.fillStyle = refused ? 'rgba(214, 120, 96, 0.35)' : 'rgba(252, 248, 238, 0.42)'
    g.fill()
    g.restore()
    flour(wallOut, 0.06, 1, FLOUR, [], 0.1)
    flour(wallIn, 0.05, 0.9, FLOUR, [], 0.08)
    // Along the shared wall's new face, broken where the door goes, so the footprint closes.
    const face = (t: number) => geo.at(t, T / 2 + 0.03)
    if (d.door.from - d.from > T / 2 + 0.05) flour([face(d.from + T / 2), face(d.door.from)], 0.045, 0.9)
    if (d.to - d.door.to > T / 2 + 0.05) flour([face(d.door.to), face(d.to - T / 2)], 0.045, 0.9)

    // The door: jambs across the shared wall in flour, and the doorway itself standing in the wall as a felt ghost
    // like the pieces' (two posts and a lintel, the door's width and height), so footprint, door and pieces read as one proposal.
    for (const t of [d.door.from, d.door.to]) flour([geo.at(t, -T / 2 - 0.06), geo.at(t, T / 2 + 0.1)], 0.045, 1)
    const dw = d.door.to - d.door.from
    {
      const head = made.walls.flatMap((w) => w.openings).find((o) => o.id === `${d.roomId}.door`)?.head ?? 2.05
      const yaw = Math.atan2(geo.dir[0], geo.dir[1]) - Math.PI / 2
      const parts: Array<[number, number, number, number]> = [
        // [middle along the wall, width along it, bottom, top]
        [d.door.from + DOOR_POST / 2, DOOR_POST, 0, head],
        [d.door.to - DOOR_POST / 2, DOOR_POST, 0, head],
        [(d.door.from + d.door.to) / 2, dw, head - DOOR_POST, head],
      ]
      parts.forEach(([t, w, y0, y1], i) => {
        const m = doorGhost.children[i] as THREE.Mesh
        const [x, z] = geo.at(t, 0)
        m.position.set(x, (y0 + y1) / 2, z)
        m.scale.set(w, y1 - y0, T + 0.08)
        m.rotation.set(0, yaw, 0)
      })
    }
    {
      // The same doorway taped out on the shared wall, on whichever face the camera sees.
      const head = made.walls.flatMap((w) => w.openings).find((o) => o.id === `${d.roomId}.door`)?.head ?? 2.05
      const facing = dot(geo.out, hooks.view()) < 0 ? 1 : -1
      const mw = dw + 0.1, mh = head + 0.05
      paintMark(mw, mh, d.door.leaves ?? 0)
      const c = geo.at((d.door.from + d.door.to) / 2, facing * (T / 2 + 0.006))
      mark.position.set(c[0], mh / 2, c[1])
      mark.scale.set(mw, mh, 1)
      mark.rotation.set(0, Math.atan2(geo.out[0] * facing, geo.out[1] * facing), 0)
      anchors.door.set(c[0], mh + 0.12, c[1])
      doorTag.textContent = d.door.leaves === 2 ? 'double doors here' : d.door.leaves === 1 ? 'a door here' : 'an opening here'
    }

    // Grips: a wooden peg standing on each wall it moves (and on the door), with arrows in flour beside it
    // for the way it goes. The sage peg bends the far wall: a dashed curve runs from that wall's ends through it.
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
      g.strokeStyle = live ? '#b8641e' : FLOUR
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
      flour(guide, 0.022, active === 'bend' ? 0.9 : 0.55, active === 'bend' ? '#6f8a55' : FLOUR, [0.08, 0.07])
      arrows(knobAt, geo.out, active === 'bend')
    }
    for (const [h, at] of [...pegs.map(([h, p]) => [h, p] as [Handle, P]), ['door', doorAt] as [Handle, P], ['bend', knobAt] as [Handle, P]]) {
      const m = pegMeshes.get(h)!
      m.group.position.set(at[0], GROUND, at[1])
      const live = active === h
      m.head.material = live ? pegLive : m.top
      m.group.scale.setScalar(live ? 1.18 : 1)
    }
    sheetMap.needsUpdate = true
    // The ghosts follow on the next frame, so the outline itself is up at once.
    ghostsDue = true

    // Tags.
    anchors.w.set((wA[0] + wB[0]) / 2, 0.05, (wA[1] + wB[1]) / 2)
    anchors.d.set((dA[0] + dB[0]) / 2, 0.05, (dA[1] + dB[1]) / 2)
    if (editing !== 'w') tags.w.textContent = `${fmt(d.to - d.from)} m`
    if (editing !== 'd') tags.d.textContent = `${fmt(d.depth)} m`
    titleName.textContent = /^New room( \d+)?$/.test(d.label) ? 'A new room' : `The new ${d.label.toLowerCase()}`
    titleArea.textContent = ` · ${sizeLine(base, made, d)}`
  }


  // ── Opening, closing, applying ────────────────────────────────────────────
  const open = (next: Draft) => {
    draft = null
    if (!accept(next)) return false
    if (!group.parent) stage.scene.add(group)
    for (const el of [tags.w, tags.d, choice, doorTag]) el.classList.add('shown')
    cardSide = null
    shownAt = performance.now()
    place()
    return true
  }
  const close = () => {
    draft = made = null
    seen = null
    pieces = []
    drag = null
    hover = null
    editing = null
    group.removeFromParent()
    hooks.yard(null)
    for (const el of [tags.w, tags.d, choice, field, doorTag]) el.classList.remove('shown')
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
        titleArea.textContent = wanted ? ` · the ${wanted.name} is in the way` : ` · ${sizeLine(hooks.base(), made!, draft)}`
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
  const v = new THREE.Vector3(), v3 = new THREE.Vector3()
  const screen = (p: THREE.Vector3): [number, number] => {
    v.copy(p).project(stage.camera)
    const r = stage.renderer.domElement.getBoundingClientRect()
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]
  }
  const at = (el: HTMLElement, x: number, y: number, ax = '-50%', ay = '-50%') => {
    const t = `calc(${Math.round(x)}px + ${ax}) calc(${Math.round(y)}px + ${ay})`
    if (el.style.translate !== t) el.style.translate = t
  }
  /** A screen box: left, top, right, bottom (CSS px). */
  type Box = { l: number; t: number; r: number; b: number }
  const meets = (a: Box, b: Box, gap = 10) => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap
  const boxOf = (el: Element): Box => {
    const r = el.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom }
  }
  const place = () => {
    if (!draft) return
    const [wx, wy] = screen(anchors.w), [dx, dy] = screen(anchors.d)
    // Tags stay on screen, whole, however the room sits in the view.
    const inX = (x: number) => Math.min(innerWidth - 60, Math.max(60, x)), inY = (y: number) => Math.min(innerHeight - 24, Math.max(24, y))
    at(tags.w, inX(wx), inY(wy))
    at(tags.d, inX(dx), inY(dy))
    const [ox, oy] = screen(anchors.door)
    at(doorTag, inX(ox), inY(oy), '-50%', '-100%')
    // On a phone the choice docks to the bottom, in reach of a thumb, as placing's tag does.
    const docked = innerWidth < 700 && innerHeight > innerWidth
    choice.classList.toggle('docked', docked)
    if (docked) choice.style.translate = ''
    else placeCard()
    if (editing) {
      const [ex, ey] = editing === 'w' ? [wx, wy] : [dx, dy]
      at(field, ex, ey)
    }
  }
  /**
   * The choice card stands beside the staked-out room, never over it: on open lawn or the
   * table, its tail pointing at the room. It keeps clear of the size tags and of anything a
   * villager is saying, and keeps its side while that side still has room.
   */
  const placeCard = () => {
    const pts = plot.flatMap((p) => [screen(v3.set(p[0], 0, p[1])), screen(v3.set(p[0], STAKE_H, p[1]))])
    if (!pts.length) return
    const room: Box = { l: Math.min(...pts.map((p) => p[0])), t: Math.min(...pts.map((p) => p[1])), r: Math.max(...pts.map((p) => p[0])), b: Math.max(...pts.map((p) => p[1])) }
    const keep: Box[] = [room, boxOf(tags.w), boxOf(tags.d), boxOf(doorTag)]
    for (const el of document.querySelectorAll('.talk-card')) {
      const b = boxOf(el)
      if (b.r - b.l > 0 && getComputedStyle(el).opacity !== '0') keep.push(b)
    }
    const w = choice.offsetWidth, h = choice.offsetHeight, cy = (room.t + room.b) / 2, cx = (room.l + room.r) / 2
    const E = 16, GAP = 26
    const clampY = (t: number) => Math.min(innerHeight - E - h, Math.max(E, t))
    const clampX = (l: number) => Math.min(innerWidth - E - w, Math.max(E, l))
    const spot = (side: Side): Box & { side: Side } => {
      const l = side === 'left' ? room.l - GAP - w : side === 'right' ? room.r + GAP : clampX(cx - w / 2)
      const t = side === 'above' ? room.t - GAP - h : side === 'below' ? room.b + GAP : clampY(cy - h / 2)
      return { l, t, r: l + w, b: t + h, side }
    }
    const fits = (o: Box) => o.l >= E && o.t >= E && o.r <= innerWidth - E && o.b <= innerHeight - E && !keep.some((k) => meets(o, k))
    const order: Side[] = ['left', 'right', 'above', 'below']
    if (cardSide) order.unshift(cardSide)
    // Where it fits clear of everything; failing that, clear of the room at least; failing that, the left, on screen.
    const o = order.map(spot).find(fits)
      ?? order.map(spot).find((c) => c.l >= E && c.t >= E && c.r <= innerWidth - E && c.b <= innerHeight - E && !meets(c, room))
      ?? { ...spot('left'), l: clampX(room.l - GAP - w) }
    cardSide = o.side
    choice.dataset.tail = { left: 'right', right: 'left', above: 'down', below: 'up' }[o.side]
    const along = o.side === 'left' || o.side === 'right' ? Math.min(h - 22, Math.max(22, cy - o.t)) : Math.min(w - 26, Math.max(26, cx - o.l))
    choice.style.setProperty('--tail', `${Math.round(along)}px`)
    at(choice, o.l, o.t, '0px', '0px')
  }

  const dispose = () => {
    close()
    listening.abort()
    for (const el of [tags.w, tags.d, field, choice, doorTag, style]) el.remove()
    sheet.geometry.dispose()
    mark.geometry.dispose()
    ;(mark.material as THREE.Material).dispose()
    markMap.dispose()
    ;(sheet.material as THREE.Material).dispose()
    sheetMap.dispose()
    for (const x of [pegBody, pegHead, pegWood, pegTop, pegSage, pegLive, stakeGeo, stakeTip, stakeWood]) x.dispose()
    for (const h of ghostOf.values()) releaseGpu(h)
    for (const m of [ghostFelt, ghostRug, ghostRim]) m.dispose()
    doorBox.dispose()
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
    frame: () => {
      if (!draft) return
      place()
      if (ghostsDue && made) {
        ghostsDue = false
        showGhosts(hooks.base(), made, draft)
      }
    },
    dragging: () => drag !== null,
    draft: () => draft,
    made: () => made,
    shownAt: () => shownAt,
    /** The first pieces the room would arrive with, as the ghosts show them. */
    pieces: () => pieces,
    /** The first pieces for a draft, laid against the same scan of the house the ghosts were (the caller's commit). */
    piecesFor: (base: Plan, made: Plan, d: Draft) => firstPieces(base, made, d, null, [], seen ??= obstacles(stage.scene, [group])),
    grips,
    dispose,
  }
}



function css() {
  return `
  .build-dim, .build-choice, .build-dim-field { position: fixed; z-index: 6; left: 0; top: 0; opacity: 0; pointer-events: none; visibility: hidden; transition: opacity 160ms ease, scale 200ms cubic-bezier(.2, 1.4, .4, 1), visibility 0s 160ms; scale: 0.9; }
  .build-dim { min-height: 36px; min-width: 44px; padding: 3px 12px 5px; border: 0; border-radius: 9px; cursor: text; rotate: -3deg; color: #4a3428; font: 700 18px ${HAND};
    background: linear-gradient(170deg, #fffaf0, #f6e8cf); box-shadow: 0 5px 12px rgba(70, 40, 20, 0.24), 0 1px 0 rgba(255, 255, 255, 0.7) inset; }
  .build-dim[data-dim='d'] { rotate: 4deg; }
  .build-door { position: fixed; z-index: 6; left: 0; top: 0; padding: 2px 10px 4px; border-radius: 8px; pointer-events: none; opacity: 0; transition: opacity 160ms ease;
    rotate: -2deg; white-space: nowrap; color: #fff6ea; font: 700 15px ${HAND}; background: #d9703a; box-shadow: 0 4px 10px rgba(70, 40, 20, 0.25); }
  .build-door::after { content: ''; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px; margin-left: -5px; rotate: 45deg; background: #d9703a; }
  .build-door.shown { opacity: 1; }
  .build-dim::after { content: ''; position: absolute; inset: 3px; border: 1.2px dashed rgba(150, 110, 80, 0.4); border-radius: 7px; pointer-events: none; }
  .build-dim:hover::after, .build-dim:focus-visible::after { border-color: rgba(150, 100, 60, 0.85); }
  .build-dim:focus-visible { outline: 3px solid #e7a35c; outline-offset: 2px; border-radius: 8px; }
  /* Hidden, they are out of the Tab order too (visibility), and they still fade. */
  .build-dim.shown, .build-choice.shown, .build-dim-field.shown { opacity: 1; scale: 1; pointer-events: auto; visibility: visible; transition-delay: 0s; }
  .build-dim.shown:hover, .build-dim.shown:focus-visible { opacity: 1; }
  .build-dim.editing { opacity: 0; pointer-events: none; }
  .build-dim-field { width: 92px; padding: 3px 10px 5px; border: 1.5px dashed rgba(150, 100, 60, 0.5); border-radius: 9px; text-align: center;
    background: #fffaf0; color: #4a3428; font: 700 20px ${HAND}; box-shadow: 0 6px 14px rgba(60, 30, 10, 0.22); outline: none; }
  .build-choice { display: grid; gap: 6px; min-width: 220px; padding: 14px 18px 12px 20px; rotate: -1.2deg; }
  ${tagCss('.build-choice', ".build-choice button[data-choice='apply']", ".build-choice button[data-choice='cancel']", '[aria-disabled=true]')}
  .build-choice::after { content: ''; position: absolute; width: 16px; height: 16px; rotate: 45deg; background: #f4e6cb; box-shadow: 3px 3px 5px rgba(60, 30, 10, 0.12); }
  .build-choice[data-tail='down']::after { left: var(--tail, 50%); bottom: -8px; margin-left: -8px; border-radius: 0 0 4px 0; }
  .build-choice[data-tail='up']::after { left: var(--tail, 50%); top: -8px; margin-left: -8px; border-radius: 4px 0 0 0; box-shadow: none; background: #fdf6e8; }
  .build-choice[data-tail='right']::after { right: -8px; top: var(--tail, 50%); margin-top: -8px; border-radius: 0 4px 0 0; box-shadow: 3px -3px 5px rgba(60, 30, 10, 0.1); }
  .build-choice[data-tail='left']::after { left: -8px; top: var(--tail, 50%); margin-top: -8px; border-radius: 0 0 0 4px; box-shadow: -3px 3px 5px rgba(60, 30, 10, 0.1); background: #fbf1df; }
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
