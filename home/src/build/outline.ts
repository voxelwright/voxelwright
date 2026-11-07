// The outline of a room being added (#48): a chalk blueprint on the ground,
// translucent wall ghosts, the door's swing drawn in, and handwritten paper tags
// for the sizes and the choice. Trusted code draws it from a draft (resolve.ts);
// the person adjusts it directly: drag a wall, pull the dot to bend the far wall,
// slide the door, or click a size and type a number. Enter builds it, Escape
// lets it go. Nothing here touches the plan: applying is the caller's commit.
import * as THREE from 'three/webgpu'
import type { Stage } from '../kernel'
import { canvas, paintGlow, toTexture } from '../paint'
import { BEND_SNAP, curveOf, outline as ringOf, pointAt, roomArea, type P, type Plan } from './plan'
import { SNAP, draftGeometry, fit, placeDoor, type Draft } from './resolve'

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const MIN = 1.5
const PX = 1024
const CHALK = 'rgba(255, 251, 242, 0.95)'
const PENCIL = 'rgba(92, 58, 36, 0.55)'

export type Handle = 'far' | 'from' | 'to' | 'bend' | 'door'

export interface OutlineHooks {
  /** The plan the draft hangs on: the house as it stands. */
  base(): Plan
  apply(draft: Draft): void
  cancel(): void
  /** One short line in the person's villager's voice. */
  say(text: string): void
  /** The camera's view direction on the floor. */
  view(): P
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
    const k = dot(m, n0) || 1
    return add(p, m, d / k)
  })
}

export function makeOutline(stage: Stage, hooks: OutlineHooks) {
  const group = new THREE.Group()
  group.name = 'build outline'

  // The chalk sheet: one canvas on a plane laid on the floor, moved and scaled to fit the room.
  const [sheetCanvas, g] = canvas(PX, PX)
  const sheetMap = toTexture(sheetCanvas)
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: sheetMap, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }))
  sheet.rotation.x = -Math.PI / 2
  sheet.renderOrder = 3
  sheet.name = 'build outline sheet'

  // Translucent wall ghosts, warm like furnishing's.
  const ghostMat = new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: '#ffd9a6', emissiveIntensity: 0.25, roughness: 1, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide })
  const ghosts = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat)
  ghosts.name = 'build outline walls'
  ghosts.renderOrder = 2

  // The bend dot, as the right wall's.
  const knobMat = new THREE.MeshBasicMaterial({ map: paintGlow(), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  const knob = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), knobMat)
  knob.rotation.x = -Math.PI / 2
  knob.renderOrder = 4
  knob.name = 'build outline bend'
  group.add(sheet, ghosts, knob)

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
  row.append(button('Build it', 'apply', () => confirm()), button('Not now', 'cancel', () => cancel()))
  choice.append(title, row)
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
  let paths: { far: P[]; from: P[]; to: P[]; door: P[]; knob: P } | null = null

  const accept = (next: Draft, quiet = true): boolean => {
    const fitted = fit(hooks.base(), next)
    if ('ask' in fitted) {
      if (!quiet) hooks.say(fitted.ask)
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
    const inner = ringOf(made, room, T / 2)
    const bulge = Math.max(0, d.bend)
    const dimOff = T / 2 + 1.0
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
    sheet.position.set(cx, 0.012, cz)
    sheet.scale.set(S, S, 1)

    g.clearRect(0, 0, PX, PX)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    const trace = (path: P[], close = false) => {
      g.beginPath()
      path.forEach((p, i) => (i ? g.lineTo(...px(p)) : g.moveTo(...px(p))))
      if (close) g.closePath()
    }
    // A chalk stroke: a soft shadow for contrast on pale boards, then three passes that wobble a little.
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
    const chalk = (path: P[], width: number, alpha = 1, colour = CHALK, dash: number[] = []) => {
      g.setLineDash(dash.map((v) => v * k))
      g.save()
      g.strokeStyle = 'rgba(80, 48, 26, 0.22)'
      g.lineWidth = width * k * 1.9
      g.translate(0, 0.012 * k)
      trace(path)
      g.stroke()
      g.restore()
      for (let pass = 0; pass < 3; pass++) {
        g.save()
        g.globalAlpha = alpha * (pass ? 0.45 : 0.85)
        g.strokeStyle = colour
        g.lineWidth = width * k * (pass ? 0.7 : 1)
        g.translate(rnd() * 0.012 * k, rnd() * 0.012 * k)
        trace(path)
        g.stroke()
        g.restore()
      }
      g.setLineDash([])
    }

    // The building site: a patch of packed sand under the new room, feathered at its edge, so the chalk has ground to sit on.
    g.save()
    g.filter = `blur(${Math.round(0.18 * k)}px)`
    trace(ringOf(made, room, -T / 2 - 0.35), true)
    g.fillStyle = 'rgba(206, 172, 128, 0.78)'
    g.fill()
    g.restore()
    // A light wash on the new floor, with loose hatching like a sketch.
    g.save()
    trace(inner, true)
    g.fillStyle = 'rgba(255, 246, 228, 0.22)'
    g.fill()
    g.clip()
    g.strokeStyle = 'rgba(255, 252, 244, 0.26)'
    g.lineWidth = 0.018 * k
    for (let s = -PX; s < PX * 2; s += 0.32 * k) {
      g.beginPath()
      g.moveTo(s, 0)
      g.lineTo(s + PX, PX)
      g.stroke()
    }
    g.restore()

    // The new walls: both faces in chalk, the band between them hatched closer.
    g.save()
    g.beginPath()
    ;[...wallOut, ...[...wallIn].reverse()].forEach((p, i) => (i ? g.lineTo(...px(p)) : g.moveTo(...px(p))))
    g.closePath()
    g.fillStyle = 'rgba(255, 248, 236, 0.32)'
    g.fill()
    g.clip()
    g.strokeStyle = 'rgba(255, 252, 244, 0.6)'
    g.lineWidth = 0.014 * k
    for (let s = -PX; s < PX * 2; s += 0.07 * k) {
      g.beginPath()
      g.moveTo(s, 0)
      g.lineTo(s - PX, PX)
      g.stroke()
    }
    g.restore()
    chalk(wallOut, 0.03)
    chalk(wallIn, 0.024, 0.9)

    // The door: jambs across the shared wall, and each leaf with its swing into the new room.
    for (const t of [d.door.from, d.door.to]) chalk([geo.at(t, -T / 2 - 0.04), geo.at(t, T / 2 + 0.04)], 0.03)
    const dw = d.door.to - d.door.from
    const hinges: Array<{ at: number; dir: 1 | -1; r: number }> = d.door.leaves === 2
      ? [{ at: d.door.from, dir: 1, r: dw / 2 }, { at: d.door.to, dir: -1, r: dw / 2 }]
      : d.door.leaves === 1 ? [{ at: d.door.from, dir: 1, r: dw }] : []
    for (const h of hinges) {
      const hinge = geo.at(h.at, T / 2)
      const open = add(hinge, geo.out, h.r)
      chalk([hinge, open], 0.028)
      const arcPts: P[] = Array.from({ length: 17 }, (_, i) => {
        const a = (i / 16) * Math.PI / 2
        return add(add(hinge, geo.dir, h.dir * h.r * Math.cos(a)), geo.out, h.r * Math.sin(a))
      })
      chalk(arcPts, 0.016, 0.85, CHALK, [0.07, 0.06])
    }
    if (!d.door.leaves) chalk([geo.at(d.door.from, T / 2), geo.at(d.door.to, T / 2)], 0.016, 0.8, CHALK, [0.07, 0.06])

    // Dimension lines in carpenter's pencil: extension lines, the run, and slashed ends.
    const dimension = (a: P, b: P, from: P, to: P) => {
      chalk([from, a], 0.012, 0.8, PENCIL)
      chalk([to, b], 0.012, 0.8, PENCIL)
      chalk([a, b], 0.016, 0.9, PENCIL)
      const u: P = [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])]
      const slash: P = [(u[0] - u[1]) * 0.09, (u[1] + u[0]) * 0.09]
      for (const p of [a, b]) chalk([add(p, slash, -1), add(p, slash)], 0.022, 1, PENCIL)
    }
    dimension(wA, wB, geo.at(d.from, d.depth + T / 2 + 0.1), geo.at(d.to, d.depth + T / 2 + 0.1))
    dimension(dA, dB, add(geo.at(tSide, 0), sideDir, T / 2 + 0.1), add(geo.at(tSide, d.depth), sideDir, T / 2 + 0.1))

    // Grips: small rings at the middle of each wall that moves, and a diamond on the door.
    const ring = (p: P, r: number, live: boolean) => {
      g.beginPath()
      g.arc(...px(p), r * k, 0, Math.PI * 2)
      g.fillStyle = live ? 'rgba(255, 214, 150, 0.95)' : 'rgba(255, 249, 236, 0.9)'
      g.fill()
      g.lineWidth = 0.02 * k
      g.strokeStyle = 'rgba(110, 70, 40, 0.55)'
      g.stroke()
    }
    const active = drag?.handle ?? hover
    ring(mid, 0.075, active === 'far')
    ring(geo.at(d.from, d.depth / 2), 0.075, active === 'from')
    ring(geo.at(d.to, d.depth / 2), 0.075, active === 'to')
    const dc = geo.at((d.door.from + d.door.to) / 2, T / 2 + 0.22)
    g.save()
    g.translate(...px(dc))
    g.rotate(Math.PI / 4)
    g.fillStyle = active === 'door' ? 'rgba(255, 214, 150, 0.95)' : 'rgba(255, 249, 236, 0.9)'
    g.fillRect(-0.06 * k, -0.06 * k, 0.12 * k, 0.12 * k)
    g.strokeStyle = 'rgba(110, 70, 40, 0.55)'
    g.lineWidth = 0.02 * k
    g.strokeRect(-0.06 * k, -0.06 * k, 0.12 * k, 0.12 * k)
    g.restore()
    sheetMap.needsUpdate = true

    knob.position.set(knobAt[0], 0.03, knobAt[1])
    knobMat.opacity = active === 'bend' ? 1 : 0.7

    // Ghost walls: both faces and the top of each new wall.
    const H = geo.height
    const position: number[] = []
    const quad = (a: P, b: P, y0: number, y1: number) => position.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1])
    for (let i = 0; i < wallIn.length - 1; i++) {
      quad(wallIn[i], wallIn[i + 1], 0, H)
      quad(wallOut[i], wallOut[i + 1], 0, H)
      const [a, b, c, e] = [wallIn[i], wallIn[i + 1], wallOut[i + 1], wallOut[i]]
      position.push(a[0], H, a[1], b[0], H, b[1], c[0], H, c[1], a[0], H, a[1], c[0], H, c[1], e[0], H, e[1])
    }
    const ghostGeo = new THREE.BufferGeometry()
    ghostGeo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    ghostGeo.computeVertexNormals()
    ghosts.geometry.dispose()
    ghosts.geometry = ghostGeo

    // Tags.
    anchors.w.set((wA[0] + wB[0]) / 2, 0.05, (wA[1] + wB[1]) / 2)
    anchors.d.set((dA[0] + dB[0]) / 2, 0.05, (dA[1] + dB[1]) / 2)
    const c = inner.reduce((s, p) => [s[0] + p[0] / inner.length, s[1] + p[1] / inner.length], [0, 0])
    anchors.title.set(c[0], H + 0.35, c[1])
    if (editing !== 'w') tags.w.textContent = `${fmt(d.to - d.from)} m`
    if (editing !== 'd') tags.d.textContent = `${fmt(d.depth)} m`
    title.textContent = `${d.label === 'New room' ? 'A new room' : `The ${d.label.toLowerCase()}`} · ${roomArea(made, d.roomId).toFixed(1)} m²`
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
    ghosts.geometry.dispose()
    ghosts.geometry = new THREE.BufferGeometry()
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
    hooks.cancel()
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
      case 'door': next = { ...s, door: { ...s.door, ...placeDoor(s.from, s.to, dw, v('door')) } }; break
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
  addEventListener('pointerdown', onDown, true)
  addEventListener('pointermove', onMove, true)
  addEventListener('pointerup', onUp, true)
  addEventListener('keydown', onKey, true)

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
    at(tags.w, wx, wy)
    at(tags.d, dx, dy)
    const [tx, ty] = screen(anchors.title)
    at(choice, Math.min(innerWidth - 130, Math.max(130, tx)), Math.max(16, ty), '-50%', '-100%')
    if (editing) {
      const [ex, ey] = editing === 'w' ? [wx, wy] : [dx, dy]
      at(field, ex, ey)
    }
  }

  const dispose = () => {
    close()
    removeEventListener('pointerdown', onDown, true)
    removeEventListener('pointermove', onMove, true)
    removeEventListener('pointerup', onUp, true)
    removeEventListener('keydown', onKey, true)
    for (const el of [tags.w, tags.d, field, choice, style]) el.remove()
    sheet.geometry.dispose()
    ;(sheet.material as THREE.Material).dispose()
    sheetMap.dispose()
    ghostMat.dispose()
    knob.geometry.dispose()
    knobMat.map?.dispose()
    knobMat.dispose()
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

export type Outline = ReturnType<typeof makeOutline>

function css() {
  return `
  .build-dim, .build-choice, .build-dim-field { position: fixed; z-index: 6; left: 0; top: 0; opacity: 0; pointer-events: none; transition: opacity 160ms ease, scale 200ms cubic-bezier(.2, 1.4, .4, 1); scale: 0.9; }
  .build-dim { padding: 3px 11px 5px; border: 0; border-radius: 9px; cursor: text; rotate: -2deg;
    background: radial-gradient(120% 100% at 20% 0%, #fffaf0 0%, #f8ecd4 100%); color: #4a3428; font: 700 20px ${HAND};
    box-shadow: 0 6px 14px rgba(60, 30, 10, 0.22), 0 1px 0 rgba(255, 255, 255, 0.7) inset; }
  .build-dim[data-dim='d'] { rotate: 2deg; }
  .build-dim::after { content: '✎'; margin-left: 6px; font-size: 14px; opacity: 0.45; }
  .build-dim:hover, .build-dim:focus-visible { outline: none; text-decoration: underline wavy rgba(120, 80, 50, 0.5); }
  .build-dim.shown, .build-choice.shown, .build-dim-field.shown { opacity: 1; scale: 1; pointer-events: auto; }
  .build-dim.editing { opacity: 0; pointer-events: none; }
  .build-dim-field { width: 92px; padding: 3px 10px 5px; border: 1.5px dashed rgba(150, 100, 60, 0.5); border-radius: 9px; text-align: center;
    background: #fffaf0; color: #4a3428; font: 700 20px ${HAND}; box-shadow: 0 6px 14px rgba(60, 30, 10, 0.22); outline: none; }
  .build-choice { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 9px 14px 10px; border-radius: 14px; transform-origin: 50% 100%;
    background: radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 60%, #f3e3c4 100%); color: #46301f;
    box-shadow: 0 10px 24px rgba(60, 30, 10, 0.24), 0 2px 0 rgba(255, 255, 255, 0.7) inset; }
  .build-choice::before { content: ''; position: absolute; inset: 5px; border: 1.5px dashed rgba(150, 100, 60, 0.36); border-radius: 10px; pointer-events: none; }
  .build-choice::after { content: ''; position: absolute; left: 50%; bottom: -8px; width: 16px; height: 16px; margin-left: -8px; rotate: 45deg;
    background: #f5e7cb; border-radius: 0 0 4px 0; box-shadow: 3px 3px 5px rgba(60, 30, 10, 0.12); }
  .build-choice .title { font: italic 18px ${HAND}; color: #6a4a34; padding: 0 6px; white-space: nowrap; }
  .build-choice .row { display: flex; gap: 6px; }
  .build-choice button { position: relative; padding: 2px 8px 4px; border: 0; background: none; cursor: pointer; color: #6a4a34; font: 700 21px ${HAND};
    transition: translate 120ms ease; }
  .build-choice button + button::before { content: '·'; position: absolute; left: -7px; color: rgba(120, 80, 50, 0.5); }
  .build-choice button[data-choice='apply'] { color: #3f6a35; }
  .build-choice button:hover, .build-choice button:focus-visible { translate: 0 -1px; outline: none; text-decoration: underline wavy rgba(120, 80, 50, 0.5); }
  @media (prefers-reduced-motion: reduce) { .build-dim, .build-choice, .build-dim-field { transition: none; } }
  `
}
