// Sketching on the held notepad (#42 prototype). The same paper you write on takes
// drawings: tap the pencil tucked on the pad, or just draw on the raised paper,
// and the pad grows to drawing size. Ink strokes sit on a layer over the paper,
// so typed words ("blue glaze", "about 30 cm") and drawing live on one page.
//
// A finished page goes one of two ways:
//   Make it   the drawing (a bounded PNG) and your words go to the host, where a
//             vision model writes a prop module; it runs in the prop sandbox like
//             any other, so only checked data reaches the home. While it is made,
//             the page stands pinned beside the ghost.
//   Give      the page is torn off and flies to whoever the pad is addressed to,
//             who holds it up and answers in character. It is sent as an image with
//             no route, so nothing drawn on it can steer where lines go.
// Every drawing is kept on the host under the person who drew it, for the journal.
import * as THREE from 'three/webgpu'
import { releaseGpu, type Stage } from '../kernel'
import { canvas, toTexture } from '../paint'
import { authorized, call, type Outcome } from '../villager'
import type { AlwaysOn } from './input'
import type { Furnisher } from './furnish'

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
/** Your ink: blue-black, the same as your writing. */
const INK = '#23395a'
/** The ink layer's canvas, the paper's aspect (1.0 x 0.6). */
const IW = 1280, IH = 768
/** The PNG sent to the host: bounded, never bigger than this. */
const OUT_W = 768, OUT_H = 461
/** The client's own cap on the PNG, base64 characters (the host checks again). */
const MAX_PNG = 1_000_000

type Pt = { x: number; y: number; p: number }
interface Stroke { pts: Pt[]; erase: boolean; size: number }
/** One step of the page's history: a stroke, or a clear (which undo puts back). */
type Step = { kind: 'stroke'; stroke: Stroke } | { kind: 'clear' }
export interface SketchRef { from: string; id: string }

export interface SketchHooks {
  /** Whose drawings these are (the person holding the pad). */
  person: string
  /** Your own villager, who makes things. */
  maker: string
  /** Whom the pad is addressed to now: a villager's person id and name. */
  to(): { person: string; name: string; colour: string }
  /** Give the drawing to a villager: they turn to you, hold it up and answer. False if it could not be said. */
  give(person: string, text: string, sketch: SketchRef): Promise<boolean>
  /** Where a given page flies and is held: that villager's figure root. */
  figure(person: string): THREE.Object3D | null
  /** A short line from your own villager. */
  say(text: string): void
  /** Something else has the screen (the open journal). */
  blocked(): boolean
}

// ── The host's side: /people/:id/sketches ─────────────────────────────────
export const saveSketch = (person: string, png: string, words: string) =>
  call<{ id: string; w: number; h: number }>(`/people/${person}/sketches`, { png, ...(words ? { words } : {}) })
export const listSketches = (person: string) =>
  call<{ sketches: { id: string; at: string; words?: string; given?: string[]; made?: string[] }[] }>(`/people/${person}/sketches`)
export async function sketchImage(person: string, id: string): Promise<ImageBitmap | null> {
  const res = await authorized(`/people/${person}/sketches/${id}`)
  if (!res?.ok || res.headers.get('content-type') !== 'image/png') return null
  return createImageBitmap(await res.blob()).catch(() => null)
}
/** A prop from a drawing: the same maker endpoint, with the stored sketch. */
const makeFromSketch = (person: string, sketch: string, what: string, size: number[], variant: number) =>
  call<{ item: string; name: string; module: string; costUsd: number | null }>(`/people/${person}/props`, { what, sketch, size, variant })

// ── Strokes: streamlined, Catmull-Rom smoothed, variable width ──────────────
/** Points pulled a little toward the previous one, which steadies a shaky hand without lag at the end. */
function streamline(pts: Pt[], k = 0.38): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const q = out.at(-1)
    out.push(q ? { x: q.x + (p.x - q.x) * (1 - k), y: q.y + (p.y - q.y) * (1 - k), p: q.p + (p.p - q.p) * 0.5 } : { ...p })
  }
  if (pts.length > 1) out.push({ ...pts.at(-1)! })
  return out
}
/** A centripetal Catmull-Rom curve through the points, a few samples per span. */
function smooth(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts
  const out: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    const n = Math.max(2, Math.min(10, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 3)))
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), p: p1.p + (p2.p - p1.p) * t })
    }
  }
  out.push(pts.at(-1)!)
  return out
}
/** Radius along the stroke: pressure, a little thinning with speed, and soft tapers at both ends. */
function radii(pts: Pt[], size: number): number[] {
  const n = pts.length
  let run = 0
  const total = pts.reduce((s, p, i) => s + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0)
  const taper = Math.min(18, total / 3)
  return pts.map((p, i) => {
    if (i) run += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)
    const speed = i ? Math.min(1, Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) / (size * 2.5)) : 0
    const ends = taper > 0 ? Math.min(1, 0.45 + 0.55 * Math.min(run, total - run) / taper) : 1
    return Math.max(0.6, (size / 2) * (0.35 + 0.75 * p.p) * (1 - 0.25 * speed) * (n > 1 ? ends : 1))
  })
}
/** One stroke as opaque ink: discs joined by quads, all in one colour, so the stroke has no seams. */
function drawStroke(g: CanvasRenderingContext2D, s: Stroke, scale = 1) {
  const pts = smooth(streamline(s.pts)).map((p) => ({ ...p, x: p.x * scale, y: p.y * scale }))
  const r = radii(pts, s.size * scale)
  g.save()
  g.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
  g.fillStyle = s.erase ? '#000' : INK
  g.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    g.moveTo(p.x + r[i], p.y)
    g.arc(p.x, p.y, r[i], 0, Math.PI * 2)
    if (i) {
      const q = pts[i - 1]
      const dx = p.x - q.x, dy = p.y - q.y, len = Math.hypot(dx, dy) || 1
      const nx = -dy / len, ny = dx / len
      // The same turning as the discs (clockwise on screen), so nonzero filling never cuts holes.
      g.moveTo(q.x - nx * r[i - 1], q.y - ny * r[i - 1])
      g.lineTo(q.x + nx * r[i - 1], q.y + ny * r[i - 1])
      g.lineTo(p.x + nx * r[i], p.y + ny * r[i])
      g.lineTo(p.x - nx * r[i], p.y - ny * r[i])
      g.closePath()
    }
  }
  g.fill('nonzero')
  g.restore()
}

/** A pencil: hexagonal ochre body, brass ferrule, pink rubber, a sharpened tip. Its origin is at the point. */
function makePencil() {
  const g = new THREE.Group()
  g.name = 'talk sketch pencil'
  const body = new THREE.MeshStandardMaterial({ color: '#e2a93e', roughness: 0.55, emissive: '#3a2408', emissiveIntensity: 0.25 })
  const wood = new THREE.MeshStandardMaterial({ color: '#efcf9e', roughness: 0.85, emissive: '#2a1c0c', emissiveIntensity: 0.2 })
  const lead = new THREE.MeshStandardMaterial({ color: '#3a3a44', roughness: 0.5 })
  const brass = new THREE.MeshStandardMaterial({ color: '#c2a060', roughness: 0.4, metalness: 0.35, emissive: '#2a2010', emissiveIntensity: 0.3 })
  const rubber = new THREE.MeshStandardMaterial({ color: '#e48f86', roughness: 0.9, emissive: '#3a1a16', emissiveIntensity: 0.2 })
  const L = 0.34, R = 0.017
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.y = y
    g.add(m)
    return m
  }
  add(new THREE.ConeGeometry(0.0055, 0.018, 12), lead, 0.009).rotation.x = Math.PI
  add(new THREE.CylinderGeometry(R * 0.96, 0.0055, 0.05, 6), wood, 0.018 + 0.025)
  add(new THREE.CylinderGeometry(R, R, L, 6), body, 0.068 + L / 2)
  add(new THREE.CylinderGeometry(R * 1.06, R * 1.06, 0.032, 16), brass, 0.068 + L + 0.016)
  const top = add(new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.03, 16), rubber, 0.068 + L + 0.032 + 0.015)
  top.scale.y = 1
  return { group: g, length: 0.068 + L + 0.062 }
}

export function sketcher(stage: Stage, input: AlwaysOn, furnish: Furnisher, hooks: SketchHooks) {
  const { camera, scene, renderer } = stage
  const { pad, PADW, PADH } = input.parts()

  // ── The ink layer over the paper ─────────────────────────────────────────
  const [inkCanvas, ink] = canvas(IW, IH)
  /** Every stroke so far, drawn once; the live stroke is drawn over it each move. */
  const [doneCanvas, done] = canvas(IW, IH)
  const inkTex = toTexture(inkCanvas)
  const inkMat = new THREE.MeshStandardMaterial({ map: inkTex, transparent: true, depthWrite: false, roughness: 0.6, emissive: '#ffffff', emissiveMap: inkTex, emissiveIntensity: 0.12 })
  const layer = new THREE.Mesh(new THREE.PlaneGeometry(PADW, PADH), inkMat)
  layer.name = 'talk sketch ink'
  layer.position.z = 0.0015
  layer.renderOrder = 2
  const pencil = makePencil()
  pencil.group.scale.setScalar(0.9)
  const mark = (o: THREE.Object3D) => o.traverse((n) => {
    n.userData.hud = true
    if ((n as THREE.Mesh).isMesh) n.castShadow = n.receiveShadow = false
  })
  mark(layer)
  mark(pencil.group)
  pad.add(layer, pencil.group)

  let steps: Step[] = []
  let live: Stroke | null = null
  let tool: 'pen' | 'rubber' = 'pen'
  let sketching = false
  let dirty = true
  /** Seconds the page has had ink, for the hint. */
  const strokes = () => {
    // Strokes since the last clear that are still on the page.
    let at = steps.length - 1
    while (at >= 0 && steps[at].kind !== 'clear') at--
    return steps.slice(at + 1).filter((s): s is Extract<Step, { kind: 'stroke' }> => s.kind === 'stroke').map((s) => s.stroke)
  }
  const redrawDone = () => {
    done.clearRect(0, 0, IW, IH)
    for (const s of strokes()) drawStroke(done, s)
    dirty = true
  }
  const paintInk = () => {
    ink.clearRect(0, 0, IW, IH)
    ink.drawImage(doneCanvas, 0, 0)
    if (live) drawStroke(ink, live)
    inkTex.needsUpdate = true
  }
  const inked = () => strokes().some((s) => !s.erase)

  // ── The DOM: a drawing surface over the paper, the pencil's button, the tool tags ──
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  const surface = document.createElement('div')
  surface.className = 'sketch-surface'
  surface.setAttribute('aria-hidden', 'true')
  surface.hidden = true
  const pencilButton = document.createElement('button')
  pencilButton.type = 'button'
  pencilButton.className = 'sketch-pencil'
  pencilButton.setAttribute('aria-label', 'Draw on the notepad')
  pencilButton.title = 'Draw'
  const tools = document.createElement('div')
  tools.className = 'sketch-tools'
  tools.setAttribute('role', 'toolbar')
  tools.setAttribute('aria-label', 'Drawing')
  const tag = (label: string, kind: string, act: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.dataset.tool = kind
    b.addEventListener('pointerdown', (e) => e.stopPropagation())
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      act()
    })
    return b
  }
  const penTag = tag('pen', 'pen', () => setTool('pen'))
  const rubberTag = tag('rubber', 'rubber', () => setTool('rubber'))
  const undoTag = tag('undo', 'undo', () => undo())
  const clearTag = tag('clear', 'clear', () => clear())
  const makeTag = tag('Make it', 'make', () => void make())
  const giveTag = tag('Give', 'give', () => void give())
  const group1 = document.createElement('span')
  group1.className = 'group'
  group1.append(penTag, rubberTag, undoTag, clearTag)
  const group2 = document.createElement('span')
  group2.className = 'group act'
  group2.append(makeTag, giveTag)
  tools.append(group1, group2)
  document.body.append(surface, pencilButton, tools)

  const setTool = (t: 'pen' | 'rubber') => {
    tool = t
    penTag.classList.toggle('on', t === 'pen')
    rubberTag.classList.toggle('on', t === 'rubber')
  }
  setTool('pen')

  const open = (on: boolean) => {
    if (sketching === on) return
    sketching = on
    input.setSketching(on, on && !inked() ? 'draw here, or write a few words' : '')
    tools.classList.toggle('shown', on)
    pencilButton.setAttribute('aria-pressed', String(on))
    if (!on) live = null
  }
  const undo = () => {
    if (live) return
    if (steps.pop()) redrawDone()
    input.setSketching(sketching, sketching && !inked() ? 'draw here, or write a few words' : '')
  }
  const clear = () => {
    if (!strokes().length) return
    steps.push({ kind: 'clear' })
    redrawDone()
    input.setSketching(sketching, sketching ? 'draw here, or write a few words' : '')
  }
  /** The page is on its way: a fresh one under it. */
  const fresh = () => {
    steps = []
    live = null
    redrawDone()
    input.clearText()
  }

  // ── Pointer: drawing with a mouse, a finger or a pencil ───────────────────
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  /** Where a pointer is on the page, in ink pixels, or null off the paper. */
  const onPage = (x: number, y: number) => {
    const r = renderer.domElement.getBoundingClientRect()
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    layer.updateWorldMatrix(true, false)
    const hit = raycaster.intersectObject(layer, false)[0]
    if (!hit?.uv) return null
    return { x: hit.uv.x * IW, y: (1 - hit.uv.y) * IH, local: layer.worldToLocal(hit.point.clone()) }
  }
  /** Pressure: a pen's own; a mouse or a finger that reports none or only 0 and 1 gets a steady middle. */
  const pressure = (e: PointerEvent) => e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5
  let down: { id: number; x: number; y: number; started: boolean } | null = null
  /** The pencil's tip on the page, in the layer's own space, while a pointer is over it. */
  let tip: THREE.Vector3 | null = null
  const addPoints = (e: PointerEvent) => {
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const ev of events.length ? events : [e]) {
      const at = onPage(ev.clientX, ev.clientY)
      if (!at) continue
      tip = at.local
      live?.pts.push({ x: at.x, y: at.y, p: pressure(ev) })
    }
  }
  const begin = (e: PointerEvent) => {
    const at = onPage(e.clientX, e.clientY)
    if (!at) return
    if (!sketching) open(true)
    live = { pts: [{ x: at.x, y: at.y, p: pressure(e) }], erase: tool === 'rubber', size: tool === 'rubber' ? 34 : e.pointerType === 'touch' ? 9 : 8 }
    tip = at.local
    dirty = true
  }
  const onDown = (e: PointerEvent) => {
    if (e.button > 0) return
    e.preventDefault()
    e.stopPropagation()
    surface.setPointerCapture(e.pointerId)
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, started: false }
    // Already drawing: the stroke starts at once. Raised for writing: a drag draws, a tap writes.
    if (sketching) {
      down.started = true
      begin(e)
    }
  }
  const onMove = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) {
      if (sketching && e.pointerType !== 'touch') tip = onPage(e.clientX, e.clientY)?.local ?? null
      return
    }
    e.preventDefault()
    if (!down.started && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      down.started = true
      const first = new PointerEvent('pointerdown', { clientX: down.x, clientY: down.y, pointerType: e.pointerType, pressure: e.pressure })
      begin(first)
    }
    if (down.started) {
      addPoints(e)
      dirty = true
    }
  }
  const onUp = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return
    e.preventDefault()
    const was = down
    down = null
    if (!was.started) {
      // A tap on the raised paper, not drawing: it is for writing.
      if (!sketching) input.focus()
      else {
        // A tap while drawing is a dot.
        begin(e)
      }
    }
    if (live) {
      if (live.pts.length === 1) live.pts.push({ ...live.pts[0], x: live.pts[0].x + 0.5 })
      steps.push({ kind: 'stroke', stroke: live })
      drawStroke(done, live)
      live = null
      dirty = true
      input.setSketching(sketching, '')
    }
    if (e.pointerType === 'touch') tip = null
  }
  const onCancel = (e: PointerEvent) => {
    if (down?.id !== e.pointerId) return
    down = null
    live = null
    dirty = true
  }
  surface.addEventListener('pointerdown', onDown)
  surface.addEventListener('pointermove', onMove)
  surface.addEventListener('pointerup', onUp)
  surface.addEventListener('pointercancel', onCancel)
  surface.addEventListener('pointerleave', () => {
    if (!down) tip = null
  })
  pencilButton.addEventListener('click', () => {
    if (!sketching) open(true)
    else if (tool === 'rubber') setTool('pen')
    else open(false)
  })
  const onKey = (e: KeyboardEvent) => {
    if (!sketching || hooks.blocked()) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !input.text) {
      e.preventDefault()
      undo()
    } else if (e.key === 'Escape' && !input.text) {
      e.preventDefault()
      e.stopPropagation()
      open(false)
    }
  }
  addEventListener('keydown', onKey, true)

  // ── The page as a PNG: paper, your words, your drawing ────────────────────
  const words = () => input.text.trim()
  const toPng = () => {
    const [c, g] = canvas(OUT_W, OUT_H)
    g.fillStyle = '#fbf3e1'
    g.fillRect(0, 0, OUT_W, OUT_H)
    // The words where the pad shows them, in the same hand.
    const k = OUT_W / 1024
    g.fillStyle = INK
    g.font = `${56 * k}px ${HAND}`
    const lines: string[] = []
    let line = ''
    for (const w of words().split(/(\s+)/)) {
      if (g.measureText(line + w).width > (1024 - 190) * k && line.trim()) {
        lines.push(line.trimEnd())
        line = w.trimStart()
      } else line += w
    }
    if (line.trim()) lines.push(line)
    lines.slice(-4).forEach((l, i) => g.fillText(l, 120 * k, (180 + i * 92) * k))
    g.drawImage(doneCanvas, 0, 0, OUT_W, OUT_H)
    const png = c.toDataURL('image/png').split(',')[1]
    return png.length <= MAX_PNG ? png : null
  }
  /** The drawing's own shape: its inked box on the page, for the ghost's proportions. */
  const inkBox = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const s of strokes()) if (!s.erase) for (const p of s.pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
    }
    return x1 > x0 ? { w: x1 - x0, h: y1 - y0 } : null
  }
  /** A size from the words ("about 30 cm", "1.2 m tall"), as the largest side, in metres. */
  const sizeFromWords = (text: string) => {
    const m = /(\d+(?:[.,]\d+)?)\s*(cm|centimet(?:re|er)s?|m|met(?:re|er)s?)\b/i.exec(text)
    if (!m) return null
    const n = Number(m[1].replace(',', '.')) * (/^c/i.test(m[2]) ? 0.01 : 1)
    return n > 0.03 && n <= 3 ? n : null
  }

  // ── Make it: the drawing becomes the thing ───────────────────────────────
  type Pin = { card: THREE.Group; mat: THREE.MeshStandardMaterial; state: 'flying' | 'pinned' | 'melting' | 'falling'; t: number; from: THREE.Matrix4; to: THREE.Vector3; into?: THREE.Vector3; held?: THREE.Object3D }
  const pins: Pin[] = []
  const world = new THREE.Group()
  world.name = 'talk sketches'
  scene.add(world)
  let making = false
  const results: { id: string; ok: boolean; why?: string; ms: number; item?: string }[] = []
  /** A paper card with the drawing on it, a felt pin at its top and, when pinned, a little stake to stand on. */
  const card = (png: HTMLCanvasElement, stake: boolean) => {
    const g = new THREE.Group()
    const tex = toTexture(png)
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, side: THREE.DoubleSide, transparent: true, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.22 })
    const W = 0.5, H = W * (OUT_H / OUT_W)
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat)
    sheet.position.y = H / 2
    g.add(sheet)
    const pinMat = new THREE.MeshStandardMaterial({ color: '#c4503a', roughness: 0.9 })
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), pinMat)
    pin.position.set(0, H - 0.03, 0.012)
    g.add(pin)
    if (stake) {
      const wood = new THREE.MeshStandardMaterial({ color: '#a77c52', roughness: 0.9 })
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), wood)
      stick.name = 'stake'
      stick.position.set(0, 0, -0.012)
      g.add(stick)
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    return { g, mat }
  }
  const pageCanvas = () => {
    const [c, g] = canvas(OUT_W, OUT_H)
    g.fillStyle = '#fbf3e1'
    g.fillRect(0, 0, OUT_W, OUT_H)
    const png = toPng()
    if (!png) return c
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    // Same-document data URL: decoded before the next frame in practice; repainted when it is.
    img.decode().then(() => {
      g.drawImage(img, 0, 0)
      for (const p of pins) if (p.mat.map?.image === c) p.mat.map.needsUpdate = true
    }).catch(() => {})
    return c
  }
  /** The page leaves the pad as a card, from where the paper is now. */
  const tearOff = (stake: boolean) => {
    const { g, mat } = card(pageCanvas(), stake)
    g.name = 'talk sketch card'
    layer.updateWorldMatrix(true, false)
    const from = layer.matrixWorld.clone()
    world.add(g)
    const pin: Pin = { card: g, mat, state: 'flying', t: 0, from, to: new THREE.Vector3() }
    pins.push(pin)
    return pin
  }

  const make = async () => {
    if (making || !inked()) {
      if (!inked()) hooks.say('Draw it on the pad first, then I can make it.')
      return
    }
    const t0 = performance.now()
    const png = toPng()
    const text = words()
    if (!png) return hooks.say("That drawing is too big for me to read. Could you simplify it?")
    making = true
    const box = inkBox()!
    // The ghost takes the drawing's proportions at the size the words give (or about 60 cm).
    const longest = sizeFromWords(text) ?? 0.6
    const aspect = box.h / box.w
    const size: [number, number, number] = aspect >= 1 ? [longest / aspect, longest, longest / aspect] : [longest, longest * aspect, longest * Math.min(1, 0.6 + aspect * 0.4)]
    const saved = await saveSketch(hooks.person, png, text)
    if (!saved.ok) {
      making = false
      results.push({ id: '', ok: false, why: `save ${saved.why}`, ms: performance.now() - t0 })
      return hooks.say(saved.why === 'away' ? "I'm out for a moment, so I couldn't take your drawing. It's still on your pad." : "I couldn't keep that drawing just now. It's still on your pad.")
    }
    const pin = tearOff(true)
    fresh()
    open(false)
    const what = 'your drawing'
    const where = text
    const job = furnish.furnish({ route: 'furnish', what, where, size }, text || what, t0, null, (variant) => makeFromSketch(hooks.person, saved.id, text ? `${text}`.slice(0, 200) : 'the thing in my drawing', size, variant))
    // Pin the page beside the ghost as soon as the ghost stands.
    const placeNow = () => {
      const s = furnish.state()
      const p = s.job?.places[0]
      if (!p) return false
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize()
      pin.to.set(p.x, p.y, p.z).addScaledVector(right, size[0] / 2 + 0.38)
      pin.to.y = p.y + Math.max(0.25, size[1] * 0.45)
      return true
    }
    if (!placeNow()) pin.to.set(0, 0.6, 0.8)
    await job
    making = false
    const s = furnish.state()
    const ok = s.job?.state === 'placed'
    results.push({ id: saved.id, ok, ms: performance.now() - t0, item: s.job?.item, ...(ok ? {} : { why: s.timings.at(-1)?.why ?? 'not placed' }) })
    if (ok && s.job) {
      const at = s.job.places[0]
      pin.into = new THREE.Vector3(at.x, at.y + size[1] * 0.4, at.z)
      pin.state = 'melting'
      pin.t = 0
    } else {
      pin.state = 'falling'
      pin.t = 0
    }
  }

  // ── Give: the page flies to whoever the pad is addressed to ──────────────
  let giving = false
  const give = async () => {
    if (giving || !inked()) {
      if (!inked()) hooks.say('Draw something first, then you can give it.')
      return
    }
    const to = hooks.to()
    const png = toPng()
    if (!png) return hooks.say("That drawing is too big to carry. Could you simplify it?")
    giving = true
    const text = words()
    const saved = await saveSketch(hooks.person, png, text)
    if (!saved.ok) {
      giving = false
      results.push({ id: '', ok: false, why: `save ${saved.why}`, ms: 0 })
      return hooks.say(saved.why === 'away' ? "I'm out for a moment. Your drawing is still on your pad." : "I couldn't take that drawing just now. It's still on your pad.")
    }
    const pin = tearOff(false)
    pin.held = hooks.figure(to.person) ?? undefined
    fresh()
    open(false)
    // Your words go with it as your line; with none, only a plain note that you handed it over.
    const ok = await hooks.give(to.person, text || '(hands you a drawing)', { from: hooks.person, id: saved.id })
    giving = false
    results.push({ id: saved.id, ok, ms: 0 })
    // Held a while after the answer, then put down.
    setTimeout(() => {
      if (pin.state === 'pinned' && pins.includes(pin)) {
        pin.state = 'falling'
        pin.t = 0
      }
    }, ok ? 5000 : 1500)
  }

  // ── Each frame ───────────────────────────────────────────────────────────
  const tmp = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const rest = new THREE.Vector3(PADW / 2 + 0.05, -PADH * 0.15, 0.02)
  const tipAt = new THREE.Vector3().copy(rest)
  const place = (el: HTMLElement, x0: number, y0: number, x1: number, y1: number) => {
    el.style.left = `${Math.round(x0)}px`
    el.style.top = `${Math.round(y0)}px`
    el.style.width = `${Math.max(24, Math.round(x1 - x0))}px`
    el.style.height = `${Math.max(24, Math.round(y1 - y0))}px`
  }
  const screenOf = (o: THREE.Object3D) => {
    o.updateWorldMatrix(true, true)
    const b = new THREE.Box3().setFromObject(o)
    const r = renderer.domElement.getBoundingClientRect()
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const p = tmp.set(x, y, z).project(camera)
      const sx = r.left + ((p.x + 1) / 2) * r.width, sy = r.top + ((1 - p.y) / 2) * r.height
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    return { x0, y0, x1, y1 }
  }
  const frame = (dt: number, t: number) => {
    const away = hooks.blocked() || !input.state().padVisible
    if (away && sketching) open(false)
    const raised = input.state().raise > 0.6
    // The surface covers the paper whenever it is raised: a drag draws, a tap writes.
    surface.hidden = away || !(sketching || raised)
    surface.classList.toggle('drawing', sketching)
    if (!surface.hidden) {
      const r = input.padRect()
      place(surface, r.left, r.top, r.left + r.width, r.top + r.height)
    }
    if (dirty) {
      dirty = false
      paintInk()
    }
    // The pencil: tucked along the pad's right edge, or in your hand on the page while you draw.
    const goal = sketching && tip ? tmp.copy(tip).setZ(0.004) : rest
    const k = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * (sketching && tip ? 30 : 10))
    tipAt.lerp(goal, k)
    pencil.group.position.copy(tipAt)
    const inHand = sketching && tip ? 1 : 0
    const flip = tool === 'rubber' ? Math.PI : 0
    pencil.group.rotation.set(-0.5 * inHand + (1 - inHand) * 0.0, 0, (1 - inHand) * 0.08 - inHand * 0.5 + flip)
    if (tool === 'rubber' && inHand) pencil.group.position.addScaledVector(new THREE.Vector3(0, 1, 0).applyEuler(pencil.group.rotation), -pencil.length * 0.9)
    pencil.group.visible = !away
    const pb = screenOf(pencil.group)
    place(pencilButton, pb.x0 - 6, pb.y0 - 6, pb.x1 + 6, pb.y1 + 6)
    pencilButton.hidden = away || (sketching && Boolean(tip))
    // Tools sit on the pad's top edge while drawing.
    if (sketching) {
      const r = input.padRect()
      tools.style.translate = `${Math.round(r.left + r.width / 2)}px ${Math.round(Math.max(8, r.top - 12))}px`
    }
    const to = hooks.to()
    giveTag.textContent = `Give to ${to.name}`
    giveTag.style.setProperty('--c', to.colour)
    const own = to.name === hooks.maker
    makeTag.classList.toggle('primary', own)
    giveTag.classList.toggle('primary', !own)
    makeTag.disabled = making
    giveTag.disabled = giving

    // Cards: flying from the pad, pinned beside the ghost or held up, then into the thing or put down.
    camera.getWorldPosition(camPos)
    for (const p of [...pins]) {
      p.t += dt
      if (p.state === 'flying') {
        const k = Math.min(1, p.t / (reducedMotion.matches ? 0.01 : 0.9))
        const e = 1 - (1 - k) ** 3
        p.from.decompose(tmp, q, scl)
        let end = p.to
        if (p.held) {
          // Held up in front of the villager, at its chest.
          end = p.held.localToWorld(new THREE.Vector3(0, 0.34, 0.16))
        }
        const pos = tmp.clone().lerp(end, e)
        pos.y += Math.sin(k * Math.PI) * 0.35
        p.card.position.copy(pos)
        const faceCam = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(camPos.x - pos.x, camPos.z - pos.z), 0))
        p.card.quaternion.copy(q).slerp(faceCam, e)
        p.card.rotateZ(Math.sin(k * 7) * 0.15 * (1 - k))
        const s0 = scl.x * PADW / 0.5
        p.card.scale.setScalar(THREE.MathUtils.lerp(s0, p.held ? 0.55 : 1, e))
        if (k >= 1) {
          p.state = 'pinned'
          p.t = 0
          if (p.held) {
            p.held.add(p.card)
            p.card.position.set(0, 0.2, 0.16)
            p.card.rotation.set(-0.15, 0, 0)
            p.card.scale.setScalar(0.55 / p.held.getWorldScale(scl).x)
          }
        }
      }
      if (p.state === 'pinned' && !p.held) {
        // Stands on its stake beside the ghost, turned to you, breathing a little.
        p.card.position.copy(p.to)
        p.card.rotation.set(0, Math.atan2(camPos.x - p.to.x, camPos.z - p.to.z), reducedMotion.matches ? 0 : Math.sin(t * 1.4) * 0.02)
        const stake = p.card.getObjectByName('stake')
        if (stake) {
          stake.scale.y = Math.max(0.01, p.to.y)
          stake.position.y = -p.to.y / 2
        }
      }
      if (p.state === 'melting' && p.into) {
        // The drawing goes into the thing it became.
        const k = Math.min(1, p.t / (reducedMotion.matches ? 0.01 : 0.7))
        p.card.position.lerpVectors(p.to, p.into, k * k)
        p.card.scale.setScalar(1 - 0.9 * k)
        p.mat.opacity = 1 - k
        if (k >= 1) drop(p)
      }
      if (p.state === 'falling') {
        const k = Math.min(1, p.t / (reducedMotion.matches ? 0.01 : 0.6))
        p.mat.opacity = 1 - k
        p.card.position.y -= dt * 0.3
        if (k >= 1) drop(p)
      }
    }
  }
  const drop = (p: Pin) => {
    pins.splice(pins.indexOf(p), 1)
    p.card.removeFromParent()
    releaseGpu(p.card)
  }

  const dispose = () => {
    removeEventListener('keydown', onKey, true)
    for (const p of [...pins]) drop(p)
    world.removeFromParent()
    layer.removeFromParent()
    pencil.group.removeFromParent()
    releaseGpu(layer)
    releaseGpu(pencil.group)
    surface.remove()
    pencilButton.remove()
    tools.remove()
    style.remove()
  }

  return {
    frame,
    dispose,
    /** Enter while drawing: make it when the pad is to your own villager, give it otherwise. True when it took the key. */
    enter: () => {
      if (!sketching || !inked()) return false
      if (hooks.to().name === hooks.maker) void make()
      else void give()
      return true
    },
    get sketching() {
      return sketching
    },
    /** For the checks. */
    state: () => ({
      sketching,
      tool,
      strokes: strokes().length,
      inked: inked(),
      steps: steps.length,
      live: Boolean(live),
      making,
      giving,
      pins: pins.map((p) => ({ state: p.state, held: Boolean(p.held) })),
      results: results.slice(),
      surface: surface.hidden ? null : surface.getBoundingClientRect().toJSON(),
      pencil: pencilButton.hidden ? null : pencilButton.getBoundingClientRect().toJSON(),
      tools: tools.classList.contains('shown') ? tools.getBoundingClientRect().toJSON() : null,
      png: toPng()?.length ?? null,
      inkPixels: (() => {
        const d = done.getImageData(0, 0, IW, IH).data
        let n = 0
        for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++
        return n
      })(),
    }),
    open,
    undo,
    clear,
    setTool,
    make,
    give,
    /** Where a page point (0 to 1 across, 0 to 1 down) is on screen, for the checks' strokes. */
    screenAt: (u: number, v: number) => {
      layer.updateWorldMatrix(true, false)
      const p = layer.localToWorld(new THREE.Vector3((u - 0.5) * PADW, (0.5 - v) * PADH, 0)).project(camera)
      const r = renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
    },
  }
}

function css() {
  const paper = 'radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 60%, #f3e3c4 100%)'
  return `
  .sketch-surface { position: fixed; z-index: 5; cursor: crosshair; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .sketch-surface:not(.drawing) { cursor: text; }
  .sketch-surface[hidden] { display: none; }
  .sketch-pencil { position: fixed; z-index: 6; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 10px; touch-action: manipulation; }
  .sketch-pencil:focus-visible { outline: 3px solid rgba(255, 236, 200, 0.9); outline-offset: 2px; }
  .sketch-pencil[hidden] { display: none; }
  .sketch-tools { position: fixed; z-index: 7; left: 0; top: 0; display: flex; gap: 10px; align-items: center; translate: -9999px 0; transform: translate(-50%, -100%);
    opacity: 0; scale: 0.94; pointer-events: none; transition: opacity 160ms ease, scale 200ms cubic-bezier(.2, 1.4, .4, 1); touch-action: manipulation; }
  .sketch-tools.shown { opacity: 1; scale: 1; pointer-events: auto; }
  .sketch-tools .group { position: relative; display: flex; gap: 2px; padding: 6px 8px 7px; border-radius: 13px; background: ${paper}; color: #46301f;
    box-shadow: 0 8px 20px rgba(60, 30, 10, 0.22), 0 2px 0 rgba(255, 255, 255, 0.7) inset; }
  .sketch-tools .group::before { content: ''; position: absolute; inset: 4px; border: 1.5px dashed rgba(150, 100, 60, 0.34); border-radius: 9px; pointer-events: none; }
  .sketch-tools button { position: relative; min-height: 36px; padding: 2px 9px 4px; border: 0; border-radius: 9px; background: none; cursor: pointer;
    color: #6a4a34; font: 700 20px ${HAND}; transition: translate 120ms ease, background 120ms ease; }
  .sketch-tools button.on { background: rgba(60, 90, 138, 0.13); color: ${INK}; }
  .sketch-tools button:hover, .sketch-tools button:focus-visible { translate: 0 -1px; outline: none; text-decoration: underline wavy rgba(120, 80, 50, 0.5); }
  .sketch-tools button[data-tool='make'] { color: #3f6a35; }
  .sketch-tools button[data-tool='give'] { color: color-mix(in oklab, var(--c, #8a6a48) 80%, #2a1608); }
  .sketch-tools button.primary { background: rgba(255, 255, 255, 0.55); box-shadow: inset 0 0 0 1.5px rgba(150, 100, 60, 0.3); }
  .sketch-tools button:disabled { opacity: 0.45; cursor: default; }
  @media (pointer: coarse) { .sketch-tools button { min-height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .sketch-tools { transition: none; } }
  `
}

export type Sketcher = ReturnType<typeof sketcher>
