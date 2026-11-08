// #47 the default way to tune (&setup=1): a cheval mirror in the room. A dressing mirror on its stand
// and a felt fitting stool in front of it stand at the table's left end; the villager stands on the
// stool, facing you, the pale silvered glass behind it. The controls are parts of the furniture, laid
// over their faces each frame from the camera: the tape measure up the frame's left rail (its brass
// marker rides the villager's head), the felt colour dots pinned down the right rail, the three dials
// on the stool's drawer, the manner ribbons tied across its legs and the jokes switch on its foot rail.
// Before there is a villager the pattern swatches are tucked into the glass and the slip lies against the
// stool; while the pattern is made the cutting happens on the stool's top. The kitchen stays round it as
// a warm, dimmed border.
import * as THREE from 'three/webgpu'
import { abs, float, length, mix, smoothstep, uv, vec2, vec3 } from 'three/tsl'
import { feltTexture } from '../kinds'
import { SCALE } from '../../plugins/villagers'
import { HAND, TOP } from './workshop'
import type { Key } from './sliders'
import type { Rect, Scene, Strategy } from './setup-strategy'
import { BOOK, el, fittingControls } from './setup-controls'

/** Where the mirror stands: the table's left end, square to the room. */
const AT = new THREE.Vector3(-0.8, TOP, 0.04)
/**
 * The furniture's measures (metres; x across, y up from the table, z toward the room), one set per layout. A phone is
 * narrow, so the furniture is as wide as the screen and has height to spare: there the stool stands taller (a dressing
 * table), so its drawer, legs and foot rail hold finger-sized controls. The mirror rides up on its posts to match.
 */
function dims(narrow: boolean) {
  /** The fitting stool: its top, the drawer's front, the legs (where the ribbons are tied) and the foot rail. */
  const S = narrow
    ? { w: 0.62, d: 0.26, z: 0.15, top: 0.57, board: 0.015, drawer: [0.352, 0.552], legs: [0.084, 0.346], foot: [0.006, 0.08], leg: 0.03 }
    : { w: 0.62, d: 0.26, z: 0.15, top: 0.32, board: 0.015, drawer: [0.172, 0.302], legs: [0.05, 0.168], foot: [0.004, 0.046], leg: 0.03 }
  const lift = S.top - 0.32
  // A phone's mirror is taller too (the room above it was empty wall): its right rail holds the seven colour dots 44 px
  // apart, and the glass holds the pattern swatches with the frame's outline still in view.
  const taller = narrow ? 0.1 : 0
  const bottom = 0.29 + lift, top = 0.91 + lift + taller
  const F = { w: 0.64, bottom, top, rail: 0.06, topRail: 0.055, bottomRail: 0.04, pivot: (bottom + top) / 2, tilt: 0.04, z: -0.02 }
  /** The glass, in the frame's space (its middle at the pivot). */
  const GLASS = { left: -F.w / 2 + F.rail, right: F.w / 2 - F.rail, bottom: F.bottom + F.bottomRail, top: F.top - F.topRail }
  return { S, F, GLASS, POST: F.w / 2 + 0.02, FRONT: S.z + S.d / 2, GW: GLASS.right - GLASS.left, GH: GLASS.top - GLASS.bottom, narrow }
}
type Dims = ReturnType<typeof dims>
const WIDE = dims(false), NARROW = dims(true)
/** How far the frame swings forward on its pivots while the pattern is drafted, so the paper in it faces the work. */
const WAIT_TILT = 0.34

function furniture(D: Dims) {
  const { S, F, GLASS, POST, FRONT, GW, GH } = D
  const g = new THREE.Group()
  g.name = 'workshop mirror'
  g.position.copy(AT)
  const wood = new THREE.MeshStandardMaterial({ color: '#b07a45', roughness: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: '#7d5230', roughness: 0.6 })
  const brass = new THREE.MeshStandardMaterial({ color: '#d2aa58', roughness: 0.32, metalness: 0.85 })
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    b.position.set(x, y, z)
    b.castShadow = b.receiveShadow = true
    parent.add(b)
    return b
  }
  // The stand: two posts on splayed feet, brass finials, a stretcher low between them.
  for (const s of [-1, 1]) {
    // The posts stand as tall as the frame (a phone's dressing-table mirror rides higher on longer posts).
    const postH = Math.max(0.93, F.top + 0.02)
    box(0.028, postH, 0.028, wood, s * POST, postH / 2, F.z)
    box(0.042, 0.022, 0.26, dark, s * POST, 0.011, F.z - 0.02)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 12), brass)
    ball.position.set(s * POST, postH + 0.02, F.z)
    g.add(ball)
    // The pivot's brass boss, where the frame swings.
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.024, 16), brass)
    boss.rotation.z = Math.PI / 2
    boss.position.set(s * (POST - 0.02), F.pivot, F.z)
    g.add(boss)
  }
  box(POST * 2, 0.02, 0.02, dark, 0, 0.1, F.z - 0.01)
  // The frame: four rails round the glass, swung a touch forward on its pivots.
  const frame = new THREE.Group()
  frame.position.set(0, F.pivot, F.z)
  frame.rotation.x = F.tilt
  g.add(frame)
  const fy = (y: number) => y - F.pivot
  const rail = (w: number, h: number, x: number, y: number) => box(w, h, 0.032, wood, x, y, 0, frame)
  rail(F.rail, F.top - F.bottom, -(F.w - F.rail) / 2, fy((F.top + F.bottom) / 2))
  rail(F.rail, F.top - F.bottom, (F.w - F.rail) / 2, fy((F.top + F.bottom) / 2))
  rail(F.w, F.topRail, 0, fy(F.top - F.topRail / 2))
  rail(F.w, F.bottomRail, 0, fy(F.bottom + F.bottomRail / 2))
  box(F.w - 0.01, F.top - F.bottom - 0.01, 0.01, dark, 0, fy((F.top + F.bottom) / 2), -0.014, frame)
  // The glass, painted rather than reflecting: a pale, warm silver, lighter at the top, a soft vignette at its
  // edges and two faint diagonal glints. The villager reads cleanly against it, and the room is drawn once.
  const glassMat = new THREE.MeshBasicNodeMaterial()
  const p = uv()
  // Warm silver, darker at the foot where the floor would show, lighter toward the top (linear values: the renderer
  // writes sRGB, so 0.4 here is a soft light grey on screen).
  const silver = mix(mix(vec3(0.17, 0.13, 0.1), vec3(0.27, 0.27, 0.25), smoothstep(float(0.05), float(0.3), p.y)), vec3(0.42, 0.42, 0.4), smoothstep(float(0.3), float(1), p.y))
  const edge = smoothstep(float(0.42), float(0.72), length(p.sub(0.5).mul(vec2(1.25, 1))))
  const glint = smoothstep(float(0.05), float(0), abs(p.x.add(p.y.mul(0.55)).sub(0.42))).mul(0.06)
    .add(smoothstep(float(0.025), float(0), abs(p.x.add(p.y.mul(0.55)).sub(0.56))).mul(0.04))
  // The room's window, faintly, as a painter would put it in: two soft panes high on the left.
  const pane = (x0: number, x1: number) => smoothstep(float(x0), float(x0 + 0.03), p.x).mul(smoothstep(float(x1), float(x1 - 0.03), p.x))
  const window_ = pane(0.1, 0.27).add(pane(0.3, 0.47)).mul(smoothstep(float(0.5), float(0.56), p.y)).mul(smoothstep(float(0.95), float(0.89), p.y)).mul(0.12)
  glassMat.colorNode = silver.mul(mix(float(1), float(0.68), edge)).add(glint).add(vec3(window_, window_, window_.mul(0.9)))
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), glassMat)
  glass.position.set(0, fy((GLASS.top + GLASS.bottom) / 2), 0.0005)
  frame.add(glass)
  // The fitting stool: a felt drawer under a wooden top, on four legs with a felt panel behind them (the
  // ribbons are tied across the front legs), a foot rail at the front, and a round felt pad to stand on.
  const feltTex = feltTexture('#56785f', 11, { band: false })
  feltTex.wrapS = feltTex.wrapT = THREE.RepeatWrapping
  feltTex.repeat.set(1.6, 1)
  const felt = new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95 })
  // The ribbons' ground: a warm tan felt, lifted a little so it doesn't sink into the stool's shadow.
  const backTex = feltTexture('#8a6646', 12, { band: false })
  const backFelt = new THREE.MeshStandardMaterial({ map: backTex, roughness: 1, emissive: '#3a2412', emissiveIntensity: 0.6 })
  box(S.w + 0.02, S.board, S.d + 0.02, wood, 0, S.top - S.board / 2, S.z)
  const [d0, d1] = S.drawer
  box(S.w, d1 - d0, S.d, felt, 0, (d0 + d1) / 2, S.z)
  box(S.w + 0.006, 0.01, 0.006, wood, 0, d0 + 0.004, FRONT + 0.002)
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(S.leg, d0, S.leg, wood, x * (S.w / 2 - S.leg / 2), d0 / 2, S.z + z * (S.d / 2 - S.leg / 2))
  // A felt panel just behind the front legs: the ribbons' ground, and it hides whatever is on the table under the stool.
  box(S.w - S.leg * 2, d0 - 0.01, 0.006, backFelt, 0, d0 / 2, FRONT - 0.03)
  box(S.w - S.leg * 2, S.foot[1] - S.foot[0], 0.018, dark, 0, (S.foot[0] + S.foot[1]) / 2, FRONT - 0.012)
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.135, 0.006, 40), new THREE.MeshStandardMaterial({ color: '#b6533f', roughness: 0.95 }))
  pad.position.set(0, S.top + 0.003, S.z)
  pad.receiveShadow = true
  g.add(pad)
  return {
    group: g,
    frame,
    dispose() {
      g.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.geometry.dispose()
      })
      for (const m of [wood, dark, brass, felt, backFelt, pad.material as THREE.Material, glassMat]) m.dispose()
      feltTex.dispose()
      backTex.dispose()
    },
  }
}

export function fitting(scene: Scene): Strategy {
  const { patterns, stage, shop } = scene
  const narrow = () => scene.layout() === 'narrow'
  const dimsNow = () => (narrow() ? NARROW : WIDE)
  let D = dimsNow()
  let room = furniture(D)
  scene.group.add(room.group)
  // While the pattern is made, the cutting happens on the stool's top.
  const benchAt = () => AT.clone().add(new THREE.Vector3(0, D.S.top, D.S.z))
  shop.bench(benchAt())
  /** A phone turned to a wide screen (or back): the furniture for that layout. */
  const rebuild = () => {
    const tilt = room.frame.rotation.x
    room.group.removeFromParent()
    room.dispose()
    D = dimsNow()
    room = furniture(D)
    room.frame.rotation.x = tilt
    scene.group.add(room.group)
    shop.bench(benchAt())
  }

  const root = el('div', 'vs-fit')
  const dim = el('div', 'dim', root)
  /** One layer per face of the furniture; each is laid over its face every frame. */
  const face = (name: string) => el('div', `face ${name}`, root)
  const topRail = face('top'), leftRail = face('left'), rightRail = face('right'), drawer = face('drawer'), legs = face('legs'), foot = face('foot'), glassFace = face('glass')
  // While the pattern is drafted, the person's own words on tissue paper, pinned in the glass as it tips toward the work.
  const paper = el('div', 'paper', root)
  paper.setAttribute('aria-hidden', 'true')
  el('small', 'paper-head', paper).textContent = 'your words'
  const words = el('p', 'paper-words', paper)
  // The two tags tied to the furniture with thread: the save tag to the left post, the send-off to the right.
  const strings = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  strings.setAttribute('class', 'strings')
  strings.setAttribute('aria-hidden', 'true')
  const thread = () => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    strings.append(p)
    return p
  }
  const saveString = thread(), doneString = thread()
  root.append(strings)
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  scene.mount(root)
  const kit = fittingControls(scene)

  // The top rail names its two rails; the tape up the left (its ends written along it), the colours down the right.
  el('b', 'tag height', topRail).textContent = 'height'
  el('b', 'tag colour', topRail).textContent = 'colour'
  const { tape, marker } = kit.tape(leftRail, ['short', 'tall'])
  const { dots } = kit.colours(rightRail)
  const knobs = kit.dials(drawer)
  // Before there is a villager the drawer's brass card holder names the pattern it will be cut from.
  const holder = el('div', 'holder', drawer)
  holder.setAttribute('aria-hidden', 'true')
  let holderText = ''
  const ribbons = kit.ribbons(legs)
  const jokes = el('div', 'jokes', foot)
  el('b', 'jokes-name', jokes).textContent = 'jokes'
  const steps = kit.jokes(jokes)
  const hang = el('div', 'hang', glassFace)
  const drawSwatches = kit.swatches(hang)
  // More patterns than the glass holds even sewn snug: a tab at the glass's foot says so, and scrolls on a click.
  const moreCue = el('span', 'more-cue', glassFace)
  moreCue.setAttribute('aria-hidden', 'true')
  moreCue.textContent = 'more patterns ↓'
  moreCue.addEventListener('click', () => hang.scrollBy({ top: hang.clientHeight * 0.8, behavior: 'smooth' }))
  /** How many swatches the snug fit was decided for. */
  let snugFor = -1
  const parts = { marker, tape, dots, knobs, ribbons, steps }

  // ── Projection: the furniture's faces on the page ──
  const v = new THREE.Vector3()
  const toPage = (p: THREE.Vector3, cam: THREE.Camera) => {
    p.project(cam)
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight }
  }
  /** A face of the furniture (corners in its own space) as a page rectangle through a camera. */
  const rectOf = (pts: [number, number, number][], cam: THREE.Camera, obj: THREE.Object3D = room.group): Rect => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    obj.updateMatrixWorld(true)
    for (const p of pts) {
      const q = toPage(v.set(...p).applyMatrix4(obj.matrixWorld), cam)
      left = Math.min(left, q.x); right = Math.max(right, q.x); top = Math.min(top, q.y); bottom = Math.max(bottom, q.y)
    }
    return { left, top, right, bottom }
  }
  const quad = (x0: number, x1: number, y0: number, y1: number, z: number): [number, number, number][] => [[x0, y0, z], [x1, y0, z], [x0, y1, z], [x1, y1, z]]
  const fy = (y: number) => y - D.F.pivot
  const FACES = {
    top: () => rectOf(quad(-D.F.w / 2, D.F.w / 2, fy(D.GLASS.top), fy(D.F.top), 0.016), stage.camera, room.frame),
    left: () => rectOf(quad(-D.F.w / 2, D.GLASS.left, fy(D.GLASS.bottom), fy(D.GLASS.top), 0.016), stage.camera, room.frame),
    // A phone's colour dots run on down over the bottom rail, so seven fit 44 px apart.
    right: () => rectOf(quad(D.GLASS.right, D.F.w / 2, fy(D.narrow ? D.F.bottom + 0.006 : D.GLASS.bottom), fy(D.GLASS.top), 0.016), stage.camera, room.frame),
    glass: () => rectOf(quad(D.GLASS.left, D.GLASS.right, fy(D.GLASS.bottom), fy(D.GLASS.top), 0.001), stage.camera, room.frame),
    drawer: () => rectOf(quad(-D.S.w / 2, D.S.w / 2, D.S.drawer[0] + 0.01, D.S.drawer[1], D.FRONT), stage.camera),
    legs: () => rectOf(quad(-(D.S.w / 2 - D.S.leg), D.S.w / 2 - D.S.leg, D.S.legs[0], D.S.legs[1], D.FRONT), stage.camera),
    foot: () => rectOf(quad(-(D.S.w / 2 - D.S.leg), D.S.w / 2 - D.S.leg, D.S.foot[0], D.S.foot[1], D.FRONT), stage.camera),
    all: () => rectOf(bounds(D), stage.camera),
  }
  /** A point on the furniture (its own space) on the page. */
  const pointAt = (x: number, y: number, z: number) => {
    room.group.updateMatrixWorld(true)
    return toPage(v.set(x, y, z).applyMatrix4(room.group.matrixWorld), stage.camera)
  }
  const lay = (e: HTMLElement, r: Rect) => {
    const at = `${Math.round(r.left)}px ${Math.round(r.top)}px`
    if (e.style.translate !== at) e.style.translate = at
    const w = `${Math.round(r.right - r.left)}px`, h = `${Math.round(r.bottom - r.top)}px`
    if (e.style.width !== w) e.style.width = w
    if (e.style.height !== h) e.style.height = h
  }
  /**
   * Lay a page layer exactly on a quad of the frame (corners in the frame's space), however the frame is tipped: the
   * square-to-quad projective map (Heckbert), written as a CSS matrix3d.
   */
  const layQuad = (e: HTMLElement, x0: number, x1: number, y0: number, y1: number) => {
    room.frame.updateMatrixWorld(true)
    const c = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]].map(([x, y]) => toPage(v.set(x, y, 0.003).applyMatrix4(room.frame.matrixWorld), stage.camera))
    const [p0, p1, p2, p3] = c
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y
    const den = dx1 * dy2 - dx2 * dy1
    const g = Math.abs(den) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / den
    const h = Math.abs(den) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / den
    const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, d = p1.y - p0.y + g * p1.y, ee = p3.y - p0.y + h * p3.y
    const w = e.offsetWidth || 1, hh = e.offsetHeight || 1
    const m = [a / w, d / w, 0, g / w, b / hh, ee / hh, 0, h / hh, 0, 0, 1, 0, p0.x, p0.y, 0, 1]
    e.style.transform = `matrix3d(${m.map((n) => +n.toFixed(6)).join(',')})`
  }

  // ── The camera: square on to the mirror, the whole of it and the stool in a page rectangle ──
  const fit = new THREE.PerspectiveCamera()
  const box = (x: number, y0: number, y1: number, z0: number, z1: number) => {
    const out: [number, number, number][] = []
    for (const xx of [-x, x]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([xx, y, z])
    return out
  }
  const bounds = (d: Dims) => box(d.POST + 0.022, 0, Math.max(0.93, d.F.top + 0.02) + 0.042, d.F.z - 0.02, d.FRONT)
  /**
   * The furniture's real silhouette (finials, the frame's top corners, the stool's front and the posts' feet), tighter
   * than its bounding box, whose phantom front-top and front-bottom corners leave a phone's screen part empty.
   */
  const outline = (d: Dims): [number, number, number][] => {
    const top = Math.max(0.93, d.F.top + 0.02) + 0.042, half = d.S.w / 2
    return [
      ...[-1, 1].flatMap((s): [number, number, number][] => [
        [s * (d.POST + 0.022), top, d.F.z], [s * (d.POST + 0.022), 0, d.F.z + 0.11], [s * (d.POST + 0.022), 0, d.F.z - 0.15],
        tipped(s * d.F.w / 2, d.F.top - d.F.pivot, 0.016, d.F.tilt),
        [s * (half + 0.01), d.S.top, d.FRONT + 0.01], [s * half, 0, d.FRONT],
      ]),
    ]
  }
  /** The frame's point (frame space y, z) in the furniture's space, tipped forward by `tilt`. */
  const tipped = (x: number, y: number, z: number, tilt: number): [number, number, number] =>
    [x, D.F.pivot + y * Math.cos(tilt) - z * Math.sin(tilt), D.F.z + y * Math.sin(tilt) + z * Math.cos(tilt)]
  /** The waiting: the stool's top, where the pattern is cut, and the tipped glass above it with the words. */
  const work = (): [number, number, number][] => [
    ...box(D.S.w / 2 + 0.01, D.S.top, D.S.top + 0.03, D.S.z - D.S.d / 2, D.FRONT),
    tipped(D.GLASS.left, fy(D.GLASS.top), 0, WAIT_TILT), tipped(D.GLASS.right, fy(D.GLASS.top), 0, WAIT_TILT),
  ]
  /** These bounds fitted between page rows and columns, by stepping back and panning. */
  const frameIt = (pts: [number, number, number][], o: { top: number; bottom: number; left: number; right: number; fov: number; slope: number; lookY: number }) => {
    scene.lens(o.fov)
    fit.fov = o.fov
    fit.aspect = innerWidth / innerHeight
    fit.near = 0.05
    fit.far = 60
    fit.updateProjectionMatrix()
    const dir = new THREE.Vector3(0, o.slope, 1).normalize()
    const look = AT.clone().add(new THREE.Vector3(0, o.lookY, D.S.z))
    const tan = Math.tan(THREE.MathUtils.degToRad(o.fov / 2))
    let dist = 0.5
    for (let n = 0; n < 90; n++, dist *= 1.03) {
      let r: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
      for (let i = 0; i < 30; i++) {
        fit.position.copy(look).addScaledVector(dir, dist)
        fit.lookAt(look)
        fit.updateMatrixWorld(true)
        r = rectOf(pts, fit)
        const wpp = (2 * dist * tan) / innerHeight
        const dx = (r.left + r.right) / 2 - (o.left + o.right) / 2, dy = (r.top + r.bottom) / 2 - (o.top + o.bottom) / 2
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break
        look.x += THREE.MathUtils.clamp(dx * wpp * 0.8, -0.05, 0.05)
        look.y -= THREE.MathUtils.clamp(dy * wpp * 0.8, -0.05, 0.05)
      }
      if (r.bottom - r.top <= o.bottom - o.top && r.right - r.left <= o.right - o.left) break
    }
    return { position: look.clone().addScaledVector(dir, dist), look }
  }
  // The rebuilt furniture must be the one the camera frames: the layout may have changed since the last frame.
  const fresh = () => {
    if (dimsNow() !== D) rebuild()
  }
  const at = () => {
    fresh()
    const s = scene.state()
    if (narrow() && (s === 'empty' || s === 'failed')) {
      // A phone before there is a villager: the whole mirror, its frame's outline and a little kitchen either side, the
      // swatches in its glass; below it the stool's top and its drawer with the pattern's label, then the slip.
      const t = D.F.tilt, half = D.F.w / 2
      const pts = [tipped(-half, fy(D.F.top), 0, t), tipped(half, fy(D.F.top), 0, t), tipped(-half, fy(D.F.bottom), 0, t), tipped(half, fy(D.F.bottom), 0, t),
        [-half, D.S.drawer[0], D.FRONT] as [number, number, number], [half, D.S.drawer[0], D.FRONT] as [number, number, number]]
      return frameIt(pts, { top: 30, bottom: innerHeight - scene.slip.offsetHeight - 22, left: 18, right: innerWidth - 18, fov: 46, slope: 0.1, lookY: D.F.pivot })
    }
    return narrow()
      // A phone: close, the furniture the width of the screen; room above for the name, below for the two tags.
      ? frameIt(outline(D), { top: 78, bottom: innerHeight - 84, left: 4, right: innerWidth - 4, fov: 46, slope: 0.1, lookY: 0.6 })
      // Wide or a tablet: the furniture the height of the screen, the kitchen a border round it.
      : frameIt(bounds(D), { top: 22, bottom: innerHeight - 14, left: 0, right: innerWidth, fov: 34, slope: 0.1, lookY: 0.5 })
  }
  // The waiting: looking down at the stool's top, where the pattern is cut, the glass tipped toward it with the words.
  const waitPose = () => {
    fresh()
    return frameIt(work(), narrow()
      // A phone crops the stool's ends a little, so the cutting and the words are bigger.
      ? { top: 70, bottom: innerHeight - 110, left: -34, right: innerWidth + 34, fov: 46, slope: 0.72, lookY: D.S.top + 0.2 }
      : { top: 40, bottom: innerHeight - 96, left: innerWidth * 0.14, right: innerWidth * 0.86, fov: 34, slope: 0.72, lookY: D.S.top + 0.2 })
  }

  const waiting = () => scene.state() === 'waiting'
  const showing = () => {
    const s = scene.state()
    // While it waves goodbye from the stool the furniture keeps its controls, resting.
    return !scene.watching() && (s === 'empty' || s === 'failed' || s === 'stitching' || s === 'tuning' || s === 'leaving')
  }
  const tuningNow = () => scene.state() === 'tuning' || scene.state() === 'stitching'
  const card = () => document.querySelector<HTMLElement>('.vs-card')
  const tagOf = (what: 'save' | 'done') => document.querySelector<HTMLElement>(what === 'save' ? '.vs-save' : '.vs-done')
  let revealTimer = 0
  let wordsShown = ''
  /** The paper's words at the biggest size that fits it. */
  const write = () => {
    const picked = patterns.picked?.template.name
    const text = scene.line.value.trim().replace(/\s+/g, ' ') || (picked ? `the ${picked.toLowerCase()} pattern` : '')
    if (text === wordsShown) return
    wordsShown = text
    words.textContent = text
    for (let size = 34; size >= 18; size -= 2) {
      words.style.fontSize = `${size}px`
      if (words.scrollHeight <= words.clientHeight + 1 && words.scrollWidth <= words.clientWidth + 1) break
    }
  }

  return {
    id: 'd',
    standAt: () => AT.clone().add(new THREE.Vector3(0, dimsNow().S.top + 0.007, dimsNow().S.z)),
    turn: () => 0.06,
    // The mirror is furniture, not resized to the villager. A villager is shown at the size that, at its biggest and
    // seen through the camera that will frame it, stands inside the glass clear of both rails (with room for a hop's
    // squash, 7% wider, as it hops on and off), with a band above its head
    // for what it says. Measured on the page, so a villager standing nearer the camera than the glass is allowed for.
    fit(body) {
      const pose = at()
      fit.position.copy(pose.position)
      fit.lookAt(pose.look)
      fit.updateMatrixWorld(true)
      const glass = rectOf(quad(D.GLASS.left, D.GLASS.right, fy(D.GLASS.bottom), fy(D.GLASS.top), 0.001), fit, room.frame)
      const gw = glass.right - glass.left, gh = glass.bottom - glass.top
      const m = new THREE.Matrix4()
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.06)
      const place = new THREE.Vector3(0, D.S.top + 0.007, D.S.z).add(AT)
      const corners = Array.from({ length: 8 }, (_, c) => new THREE.Vector3(c & 1 ? body.max.x : body.min.x, c & 2 ? body.max.y : body.min.y, c & 4 ? body.max.z : body.min.z))
      const fits = (k: number) => {
        m.compose(place, yaw, new THREE.Vector3(1, 1, 1).multiplyScalar(SCALE * 2 ** 0.32 * k))
        let left = Infinity, right = -Infinity, top = Infinity
        for (const p of corners) {
          const q = toPage(v.copy(p).applyMatrix4(m), fit)
          left = Math.min(left, q.x); right = Math.max(right, q.x); top = Math.min(top, q.y)
        }
        return left >= glass.left + gw * 0.045 && right <= glass.right - gw * 0.045 && top >= glass.top + gh * 0.12
      }
      let lo = 0.2, hi = 1.8
      for (let i = 0; i < 24; i++) {
        const k = (lo + hi) / 2
        if (fits(k)) lo = k
        else hi = k
      }
      return lo
    },
    toolsVisible: () => false,
    pose(state) {
      if (state === 'waiting') return waitPose()
      if (state === 'empty' || state === 'failed' || state === 'stitching' || state === 'tuning') return at()
      return null
    },
    tuning() {
      root.classList.add('tuning', 'reveal')
      // The first reveal: each control shows once how it moves.
      clearTimeout(revealTimer)
      revealTimer = window.setTimeout(() => root.classList.remove('reveal'), 2600)
      marker.focus({ preventScroll: true })
      // Jokes the host pins (crude, set by the household's admin): a short note says so as the controls come out.
      scene.explainHumour()
    },
    leaving() {
      root.classList.remove('reveal')
      kit.dispose()
      const c = card()
      if (c) c.style.maxWidth = ''
    },
    slip(w) {
      void w
      const h = scene.slip.offsetHeight
      if (waiting()) {
        // The progress tag lies on the table just in front of the stool.
        const f = FACES.drawer()
        if (scene.slip.style.width) scene.slip.style.width = ''
        return { x: (f.left + f.right) / 2, y: Math.min(innerHeight - h / 2 - 16, Math.max(f.top + h / 2 + 8, innerHeight - 70)) }
      }
      if (!showing()) return null
      // Against the stool's front (a phone: at the screen's foot), below the swatches in the glass, inside the screen.
      const g = FACES.glass(), base = FACES.foot()
      const width = `${Math.round(Math.min(innerWidth - 24, 440))}px`
      if (scene.slip.style.width !== width && !scene.slip.classList.contains('invite')) scene.slip.style.width = width
      return { x: (g.left + g.right) / 2, y: narrow() ? innerHeight - h / 2 - 16 : Math.min(innerHeight - h / 2 - 14, base.bottom - h / 2) }
    },
    place(what, w, h) {
      if (!showing()) return null
      if (what === 'card') {
        // In the glass above the head, never over the rails' controls.
        const g = FACES.glass(), r = scene.villager()
        const c = card()
        const max = `${Math.round(Math.min(300, g.right - g.left - 8))}px`
        if (c && c.style.maxWidth !== max) c.style.maxWidth = max
        if (!r) return null
        const x = THREE.MathUtils.clamp((r.left + r.right) / 2 - w / 2, g.left + 4, Math.max(g.left + 4, g.right - 4 - w))
        return { x, y: Math.max(8, r.top - h - 6) }
      }
      if (what === 'name') return null
      // The save tag and the send-off are tied to the furniture: beside the posts at the stool's height on a wide screen,
      // on a phone on the table under the stool's two front legs.
      const all = FACES.all(), dr = FACES.drawer(), ft = FACES.foot()
      if (narrow()) {
        const y = Math.min(innerHeight - 12 - h, ft.bottom + 22)
        return what === 'save' ? { x: 10, y } : { x: innerWidth - 10 - w, y }
      }
      const y = Math.min(innerHeight - 14 - h, dr.top + 26)
      return what === 'save' ? { x: Math.max(16, all.left - 18 - w), y } : { x: Math.min(innerWidth - 16 - w, all.right + 18), y }
    },
    frame(dt) {
      fresh()
      const on = showing(), wait = waiting() && !scene.watching()
      // The frame tips forward on its pivots while the pattern is drafted, and back upright for the fitting.
      const tilt = wait ? WAIT_TILT : D.F.tilt
      room.frame.rotation.x += (tilt - room.frame.rotation.x) * (1 - Math.exp(-dt * 3))
      root.classList.toggle('shown', on || wait)
      root.classList.toggle('waiting', wait)
      root.classList.toggle('tuning', tuningNow() || scene.state() === 'leaving')
      root.classList.toggle('leaving', scene.state() === 'leaving')
      patterns.group.visible = false
      if (wait) {
        write()
        layQuad(paper, D.GLASS.left + 0.035, D.GLASS.right - 0.035, fy(D.GLASS.bottom) + 0.04, fy(D.GLASS.top) - 0.03)
      }
      if (!on) {
        strings.classList.remove('shown')
        return
      }
      drawSwatches()
      const pattern = patterns.picked ? `${patterns.picked.template.name} pattern` : 'made to measure'
      if (pattern !== holderText) holder.textContent = holderText = pattern
      // Where the slip covers the drawer (a tablet, with a pattern's chip on it) the label is tucked away, not half hidden.
      if (!tuningNow()) {
        const dr = FACES.drawer()
        holder.classList.toggle('tucked', scene.slip.getBoundingClientRect().top - dr.top < (dr.bottom - dr.top) * 0.12 + holder.offsetHeight + 10)
      }
      lay(topRail, FACES.top())
      lay(leftRail, FACES.left())
      lay(rightRail, FACES.right())
      lay(glassFace, FACES.glass())
      lay(drawer, FACES.drawer())
      lay(legs, FACES.legs())
      lay(foot, FACES.foot())
      // The room is a border: dimmed and warmed away from the furniture.
      const all = FACES.all()
      dim.style.setProperty('--x', `${Math.round((all.left + all.right) / 2)}px`)
      dim.style.setProperty('--y', `${Math.round((all.top + all.bottom) / 2)}px`)
      dim.style.setProperty('--w', `${Math.round((all.right - all.left) * 0.95 + 60)}px`)
      dim.style.setProperty('--h', `${Math.round((all.bottom - all.top) * 0.78 + 60)}px`)
      // Before there is a villager, the swatches keep clear of the slip below them; more than the glass holds scroll.
      if (!tuningNow()) {
        const slipTop = scene.slip.getBoundingClientRect().top
        const g = glassFace.getBoundingClientRect()
        // Still more than the glass holds, sewn snug: the hang stops short of the glass's foot, where the "more" tab hangs.
        const cue = glassFace.classList.contains('more') ? 30 : 0
        hang.style.maxHeight = `${Math.max(60, Math.round(Math.min(g.bottom - 4, slipTop - 14) - hang.getBoundingClientRect().top - cue))}px`
        // Too many to show at their ease: sewn snug (tighter felt, smaller gaps) so all of them show without scrolling.
        if (hang.children.length !== snugFor) {
          snugFor = hang.children.length
          hang.classList.remove('snug')
        } else if (!hang.classList.contains('snug') && hang.scrollHeight > hang.clientHeight + 2) hang.classList.add('snug')
        // The tab only when they would not fit even without the room kept for it (else it would hold itself open).
        glassFace.classList.toggle('more', hang.classList.contains('snug') && hang.scrollHeight > hang.clientHeight + cue + 2)
        hang.classList.toggle('more', hang.scrollTop + hang.clientHeight < hang.scrollHeight - 2)
      }
      // The tags' threads: from each tag's eyelet up to where it is tied.
      const tied = tuningNow()
      strings.classList.toggle('shown', tied)
      if (tied) {
        const knot = (what: 'save' | 'done', p: SVGPathElement) => {
          const tag = tagOf(what)
          if (!tag || !tag.classList.contains('shown')) return p.setAttribute('d', '')
          const r = tag.getBoundingClientRect()
          const s = what === 'save' ? -1 : 1
          const eye = { x: what === 'save' ? r.right - 9 : r.left + 9, y: r.top + r.height / 2 }
          // Wide: round the post at the drawer's top; a phone: up to the stool's front leg, above the foot rail.
          const to = narrow()
            ? pointAt(s * (D.S.w / 2 - D.S.leg / 2), D.S.foot[1] + 0.01, D.FRONT)
            : pointAt(s * D.POST, D.S.drawer[1] + 0.02, D.F.z + 0.016)
          const sag = Math.max(10, Math.abs(to.x - eye.x) * 0.35)
          p.setAttribute('d', `M${eye.x.toFixed(1)} ${eye.y.toFixed(1)} Q${((eye.x + to.x) / 2).toFixed(1)} ${(Math.max(eye.y, to.y) + sag).toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`)
        }
        knot('save', saveString)
        knot('done', doneString)
      }
      // Waving goodbye: the controls rest as tuning left them (the marker at its head, not where the size would put it).
      if (scene.state() !== 'leaving') kit.sync(parts)
    },
    api: {
      /** A control's middle on the page, to click or drag it. */
      control: (key: Key) => kit.control(parts, key),
      glass: () => glassFace.getBoundingClientRect().toJSON(),
      /** The whole furniture on the page. */
      furniture: () => FACES.all(),
      /** The paper in the glass while waiting: its words, their size on the page, and whether they fit it whole. */
      paper: () => {
        const r = paper.getBoundingClientRect(), g = rectOf(quad(D.GLASS.left, D.GLASS.right, fy(D.GLASS.bottom), fy(D.GLASS.top), 0.001), stage.camera, room.frame)
        const scale = r.height / Math.max(1, paper.offsetHeight)
        return {
          text: words.textContent, shown: getComputedStyle(paper).display !== 'none' && root.classList.contains('shown'),
          px: parseFloat(getComputedStyle(words).fontSize) * scale, whole: words.scrollHeight <= words.clientHeight + 1 && words.scrollWidth <= words.clientWidth + 1,
          inGlass: r.left >= g.left - 2 && r.right <= g.right + 2 && r.top >= g.top - 2 && r.bottom <= g.bottom + 2,
          onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        }
      },
      /** Each face's content against its face (page px): content that spills out of its face is a layout defect. */
      spill: () => [topRail, leftRail, rightRail, drawer, legs, foot].flatMap((f) => {
        const r = f.getBoundingClientRect()
        return [...f.querySelectorAll<HTMLElement>(':scope > *, .dial, .ribbon-row, .step')].filter((c) => getComputedStyle(c).visibility !== 'hidden' && c.getClientRects().length).map((c) => {
          const b = c.getBoundingClientRect()
          const out = Math.max(r.left - b.left, b.right - r.right, r.top - b.top, b.bottom - r.bottom)
          return out > 2 ? `${f.classList[1]} ${c.className || c.tagName}: ${Math.round(out)} px` : ''
        }).filter(Boolean)
      }),
    },
    dispose() {
      clearTimeout(revealTimer)
      kit.dispose()
      shop.bench(null)
      patterns.group.visible = true
      room.group.removeFromParent()
      room.dispose()
      const c = card()
      if (c) c.style.maxWidth = ''
      root.remove()
      style.remove()
    },
  }
}

function css() {
  const word = `font: 700 15px/1 ${HAND}; color: #ffe9c4;`
  return `
  [data-vs-strategy=d] .vs-rack, [data-vs-strategy=d] .vs-saved { display: none !important; }
  .vs-fit { position: fixed; inset: 0; z-index: 4; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 320ms ease, visibility 0s linear 320ms; }
  .vs-fit.shown { opacity: 1; visibility: visible; transition: opacity 320ms ease; }
  /* The room as a border: warm and a little dim away from the furniture. */
  .vs-fit .dim { position: absolute; inset: 0; background: radial-gradient(var(--w, 600px) var(--h, 900px) at var(--x, 50%) var(--y, 50%), transparent 52%, rgba(60, 34, 14, 0.34) 100%); }
  .vs-fit .face { position: absolute; left: 0; top: 0; box-sizing: border-box; display: flex; }
  .vs-fit .face > * { pointer-events: auto; }
  /* Controls come out with the villager; before that the glass holds the swatches. */
  .vs-fit:not(.tuning) :is(.top, .left, .right, .drawer, .legs, .foot) > * { visibility: hidden; }
  .vs-fit.tuning .hang { display: none; }
  /* The top rail names the rails below it, in pokerwork on the wood. */
  .vs-fit .top { justify-content: space-between; align-items: center; padding: 0 4px; }
  .vs-fit .tag { font: 700 15px/1 ${HAND}; color: #fff1d6; text-shadow: 0 1px 0 rgba(60, 30, 10, 0.55); white-space: nowrap; }
  /* The tape measure up the left rail, its two ends written along it. */
  .vs-fit .left { justify-content: center; padding: 4px 0; }
  .vs-fit .tape { position: relative; width: min(26px, 76%); border-radius: 2px; cursor: ns-resize; touch-action: none;
    background: repeating-linear-gradient(0deg, #5a3f22 0 1.5px, transparent 1.5px 8px) right / 7px 100% no-repeat, repeating-linear-gradient(0deg, #5a3f22 0 2px, transparent 2px 32px) right / 11px 100% no-repeat, #e9c45a;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(90, 60, 30, 0.4); }
  .vs-fit .tape .end { position: absolute; left: 1px; writing-mode: vertical-rl; rotate: 180deg; font: 700 14px/14px ${HAND}; color: #2e1f12; pointer-events: none;
    padding: 3px 1px; border-radius: 2px; background: #edca62; }
  .vs-fit .tape .end.top { top: 6px; } .vs-fit .tape .end.bottom { bottom: 6px; }
  .vs-fit .marker { position: absolute; z-index: 1; left: -9px; width: 46px; height: 20px; margin-top: -10px; border-radius: 3px 10px 10px 3px; background: linear-gradient(180deg, #e2bd6a, #b88a3a);
    box-shadow: 0 2px 5px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255, 240, 200, 0.6); transition: top 120ms ease; cursor: ns-resize; }
  .vs-fit .marker::after { content: '↕'; position: absolute; right: 6px; top: 0; font: 700 15px/20px ${HAND}; color: #3d2a1c; }
  .vs-fit .marker:focus-visible { outline: 3px solid #fffaf0; outline-offset: 2px; }
  /* The colour dots pinned down the right rail. */
  .vs-fit .right { justify-content: center; padding: 8px 0; }
  .vs-fit .colours { display: flex; flex-direction: column; justify-content: space-evenly; align-items: center; }
  .vs-fit .dot { width: 26px; height: 26px; border: 0; padding: 0; border-radius: 50%; cursor: pointer; background: #d9a35f; position: relative;
    background-image: radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1.4px); background-size: 4px 4px;
    box-shadow: inset 0 0 0 2px rgba(255, 245, 225, 0.35), 0 2px 4px rgba(0,0,0,0.4); transition: scale 120ms ease; }
  .vs-fit .dot::before { content: ''; position: absolute; left: 50%; top: 3px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: #e9dcc0; box-shadow: 0 1px 1px rgba(0,0,0,0.4); }
  .vs-fit .dot.at { scale: 1.2; box-shadow: inset 0 0 0 2px rgba(255, 245, 225, 0.5), 0 0 0 3px #fff3dc, 0 4px 8px rgba(0,0,0,0.45); }
  .vs-fit .dot:hover { scale: 1.12; }
  .vs-fit .dot:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 3px; }
  /* The drawer: three brass dials, each with its name above and its two ends below. */
  .vs-fit .drawer { container-type: size; justify-content: space-evenly; align-items: center; padding: 0 8px; }
  .vs-fit .dial { display: grid; grid-template-columns: auto auto; grid-template-areas: 'name name' 'knob knob' 'lo hi'; align-items: center; column-gap: 12px; row-gap: 2px; }
  .vs-fit .dial-name { grid-area: name; justify-self: center; ${word} }
  .vs-fit .knob { grid-area: knob; position: relative; --k: clamp(26px, calc(100cqh - 40px), 60px); justify-self: center; width: var(--k); height: var(--k); border-radius: 50%; cursor: grab; touch-action: none;
    background: radial-gradient(circle at 35% 30%, #e6c578, #a07832 70%); box-shadow: 0 3px 6px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255, 235, 190, 0.45); }
  .vs-fit .knob::before { content: ''; position: absolute; inset: -5px; border-radius: 50%; border: 2px dotted rgba(255, 240, 210, 0.6); clip-path: polygon(50% 50%, 0 100%, 0 0, 100% 0, 100% 100%); }
  .vs-fit .notch { position: absolute; left: 50%; top: 8%; width: 3px; height: 34%; margin-left: -1.5px; border-radius: 2px; background: #3d2a1c; transform-origin: 50% 123%; rotate: var(--turn, 0deg); }
  .vs-fit .knob:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 6px; }
  .vs-fit .dial-ends { display: contents; }
  .vs-fit .dial-ends span { ${word} font-size: 14px; line-height: 14px; }
  .vs-fit .dial-ends span:first-child { grid-area: lo; } .vs-fit .dial-ends span:last-child { grid-area: hi; text-align: right; }
  /* The ribbons tied across the stool's legs, their two ends written beside them. */
  .vs-fit .legs { flex-direction: column; justify-content: space-evenly; padding: 2px 0; }
  .vs-fit .ribbon-row { display: grid; grid-template-columns: 58px 1fr 58px; align-items: center; gap: 6px; ${word} font-size: 14px; color: #fff3dc; text-shadow: 0 1px 2px rgba(30, 20, 10, 0.8); }
  .vs-fit .ribbon-row .end:first-child { text-align: right; }
  .vs-fit .ribbon { --b: 20px; position: relative; height: 14px; border-radius: 2px; cursor: pointer; touch-action: none; background: var(--ground);
    background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 2px, rgba(0,0,0,0.06) 2px 4px); box-shadow: 0 2px 3px rgba(0,0,0,0.35); }
  .vs-fit .ribbon::after { content: ''; position: absolute; inset: 3px 0; border-top: 1.2px dashed rgba(255, 248, 232, 0.6); border-bottom: 1.2px dashed rgba(255, 248, 232, 0.6); }
  .vs-fit .ribbon .button { position: absolute; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; background: #e9dcc0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.4), inset 0 0 0 2px rgba(120, 80, 50, 0.35); z-index: 1; }
  .vs-fit .ribbon .button::after { content: '⁘'; position: absolute; inset: 0; font: 13px/20px serif; text-align: center; color: #5a3d27; }
  .vs-fit .ribbon:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 3px; }
  /* The jokes switch on the foot rail. */
  .vs-fit .foot { justify-content: center; align-items: center; }
  .vs-fit .jokes { display: flex; align-items: center; gap: 5px; }
  .vs-fit .jokes-name { ${word} margin-right: 3px; }
  .vs-fit .step { white-space: nowrap; padding: 3px 10px 4px; border: 0; border-radius: 4px 9px 9px 4px; cursor: pointer; background: rgba(255, 243, 220, 0.18); color: #fff3dc; font: 700 15px/1.05 ${HAND}; }
  .vs-fit .step.at { background: #fffaf0; color: #23395a; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
  .vs-fit .step:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 2px; }
  /* Gesture cues: on hover, on focus and once as the controls come out, each shows how it moves. */
  .vs-fit .knob::after { content: '↻'; position: absolute; right: -15px; top: -12px; font: 700 16px/1 ${HAND}; color: #fff3dc; text-shadow: 0 1px 2px rgba(30, 20, 10, 0.8); opacity: 0; transition: opacity 160ms ease; }
  .vs-fit .knob:hover::after, .vs-fit .knob:focus-visible::after, .vs-fit.reveal .knob::after { opacity: 1; }
  .vs-fit .ribbon:hover .button::after, .vs-fit .ribbon:focus-visible .button::after, .vs-fit.reveal .ribbon .button::after { content: '↔'; font: 700 14px/20px ${HAND}; }
  .vs-fit.reveal .marker { animation: vs-fit-bob 0.9s ease-in-out 2; }
  .vs-fit.reveal .knob { animation: vs-fit-turn 1s ease-in-out 2; }
  .vs-fit.reveal .dial:nth-child(2) .knob { animation-delay: 0.15s; } .vs-fit.reveal .dial:nth-child(3) .knob { animation-delay: 0.3s; }
  .vs-fit.reveal .ribbon .button { animation: vs-fit-slide 1s ease-in-out 2; }
  .vs-fit.reveal .ribbon-row:nth-child(2) .button { animation-delay: 0.15s; } .vs-fit.reveal .ribbon-row:nth-child(3) .button { animation-delay: 0.3s; }
  .vs-fit.reveal .dot { animation: vs-fit-pop 0.5s ease-in-out 1; }
  .vs-fit.reveal .step.at { animation: vs-fit-pop 0.6s ease-in-out 0.7s 2; }
  .vs-fit .step:not(.at):hover { background: rgba(255, 243, 220, 0.32); }
  ${Array.from({ length: 7 }, (_, i) => `.vs-fit.reveal .dot:nth-child(${i + 1}) { animation-delay: ${(i * 0.08).toFixed(2)}s; }`).join(' ')}
  @keyframes vs-fit-bob { 50% { translate: 0 -6px; } }
  @keyframes vs-fit-turn { 25% { rotate: -14deg; } 75% { rotate: 14deg; } }
  @keyframes vs-fit-slide { 25% { translate: -7px 0; } 75% { translate: 7px 0; } }
  @keyframes vs-fit-pop { 50% { scale: 1.25; } }
  /* The swatches tucked into the glass: felt samples with pinked edges. */
  .vs-fit .glass { padding: 12px; }
  .vs-fit .hang { display: flex; flex-wrap: wrap; align-content: flex-start; justify-content: center; gap: 12px 10px; overflow: hidden auto; width: 100%; box-sizing: border-box; padding: 12px 8px 8px;
    overscroll-behavior: contain; scrollbar-width: none; }
  .vs-fit .hang::-webkit-scrollbar { display: none; }
  /* More patterns than the glass holds: the last row fades out, so it reads as more below. */
  .vs-fit .hang.more { mask-image: linear-gradient(180deg, #000 calc(100% - 34px), transparent); }
  /* Many patterns: sewn snug, so they all show at once. */
  .vs-fit .hang.snug { gap: 6px 8px; padding-top: 10px; padding-bottom: 4px; }
  .vs-fit .hang.snug .vs-swatch .felt { min-height: 0; padding: 9px 4px 12px; }
  .vs-fit .hang.snug .vs-swatch b { font-size: 16px; line-height: 1.05; }
  .vs-fit .hang.snug .vs-swatch small { font-size: 14px; line-height: 1.1; margin-top: 1px; }
  .vs-fit .hang.snug .vs-swatch .felt::after { inset: 3px 3px 10px; }
  /* Still more than the glass holds: a paper tab at its foot. */
  .vs-fit .more-cue { display: none; position: absolute; left: 50%; bottom: 6px; translate: -50% 0; padding: 3px 10px 4px; border-radius: 3px; cursor: pointer; pointer-events: auto;
    font: italic 14px/1 ${BOOK}; color: #2e1f12; background: #f1e4c8; box-shadow: 0 2px 5px rgba(20, 10, 4, 0.35); }
  .vs-fit:not(.tuning) .glass.more .more-cue { display: block; }
  /* The card itself lifts, tilts and glows; its felt (pinked by a clip) is a layer inside it, so the glow isn't clipped. */
  .vs-fit .vs-swatch { position: relative; width: calc(50% - 6px); max-width: 150px; padding: 0; border: 0; cursor: pointer; background: none; color: var(--ink, #fffaf0);
    transform-origin: 50% 0; transition: rotate 200ms ease, translate 200ms ease, scale 200ms ease, transform 220ms ease, filter 220ms ease;
    filter: drop-shadow(0 2px 2px rgba(40, 25, 10, 0.28)); }
  .vs-fit .vs-swatch .felt { position: relative; display: block; box-sizing: border-box; min-height: 64px; padding: 12px 6px 14px; background: var(--felt, #55724a); text-align: center;
    clip-path: polygon(0 0, 100% 0, 100% 88%, 95% 100%, 90% 88%, 85% 100%, 80% 88%, 75% 100%, 70% 88%, 65% 100%, 60% 88%, 55% 100%, 50% 88%, 45% 100%, 40% 88%, 35% 100%, 30% 88%, 25% 100%, 20% 88%, 15% 100%, 10% 88%, 5% 100%, 0 88%);
  }
  /* A stitched outline round the chosen one's words. */
  .vs-fit .vs-swatch .felt::after { content: ''; position: absolute; inset: 7px 6px 13px; border: 1.8px dashed currentColor; border-radius: 3px; opacity: 0; transition: opacity 200ms ease; }
  .vs-fit .vs-swatch::before { content: ''; position: absolute; z-index: 1; left: 50%; top: 3px; width: 7px; height: 7px; margin-left: -3.5px; border-radius: 50%; background: #e9dcc0; box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .vs-fit .vs-swatch b { display: block; font: 700 16px/1.1 ${HAND}; }
  .vs-fit .vs-swatch small { display: block; margin-top: 3px; font: italic 14px/1.2 ${BOOK}; }
  /* The drawer's brass card holder, before there is a villager: the pattern it will be cut from. */
  .vs-fit .holder { position: absolute; left: 50%; top: 12%; translate: -50% 0; max-width: 70%; padding: 4px 12px 5px; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font: 700 16px/1.1 ${HAND}; color: #2e1f12; background: #f1e4c8; border-radius: 2px;
    box-shadow: 0 0 0 2px #c9a24e, 0 0 0 3px #7a5a22, 0 2px 5px 3px rgba(20, 10, 4, 0.35); }
  .vs-fit:not(.tuning) .drawer > .holder { visibility: visible; }
  .vs-fit:not(.tuning) .drawer > .holder.tucked { visibility: hidden; }
  .vs-fit.tuning .holder { display: none; }
  .vs-fit .vs-swatch:nth-child(odd) { rotate: -1.5deg; } .vs-fit .vs-swatch:nth-child(even) { rotate: 1.2deg; }
  .vs-fit .vs-swatch:hover { translate: 0 2px; }
  /* The chosen one is lifted off the glass on its pin: it tips its foot toward you, glows warm and is stitched round. */
  .vs-fit .vs-swatch[aria-pressed=true] { z-index: 1; translate: 0 -2px; rotate: 0deg; scale: 1.05; transform: perspective(360px) rotateX(18deg);
    filter: drop-shadow(0 0 4px #fff6df) drop-shadow(0 0 14px rgba(255, 222, 150, 0.95)) drop-shadow(0 10px 8px rgba(40, 25, 10, 0.4)); }
  /* The others settle back against the glass. */
  .vs-fit .hang:has([aria-pressed=true]) .vs-swatch:not([aria-pressed=true]) { scale: 0.95; }
  .vs-fit .vs-swatch[aria-pressed=true] .felt::after { opacity: 0.8; }
  .vs-fit .vs-swatch:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 2px; }
  /* Finger-sized hit areas round the small felt parts (the parts stay their size; the pseudo-element takes the touch). */
  .vs-fit .dot::after { content: ''; position: absolute; inset: -9px -12px; }
  .vs-fit .ribbon::before { content: ''; position: absolute; inset: -15px 0; }
  .vs-fit .marker::before { content: ''; position: absolute; inset: -12px -4px; }
  /* The tags tied to the furniture: thread from each eyelet to the post (a phone: to the stool's front leg). */
  .vs-fit .strings { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; opacity: 0; transition: opacity 320ms ease; }
  .vs-fit .strings.shown { opacity: 1; }
  .vs-fit .strings path { fill: none; stroke: #c9b48c; stroke-width: 1.6; stroke-linecap: round; filter: drop-shadow(0 1px 1px rgba(40, 25, 10, 0.5)); }
  [data-vs-strategy=d] .vs-save { padding: 8px 20px 8px 14px; }
  [data-vs-strategy=d] .vs-save::before { left: auto; right: 6px; }
  /* The paper pinned in the glass while the pattern is drafted: the person's own words, in their ink. */
  .vs-fit .paper { display: none; position: absolute; left: 0; top: 0; width: 360px; height: 340px; box-sizing: border-box; transform-origin: 0 0; padding: 26px 26px 20px;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 340'%3E%3Cg fill='none' stroke='%23964632' stroke-opacity='0.32' stroke-width='2' stroke-dasharray='9 6'%3E%3Cellipse cx='292' cy='252' rx='52' ry='66'/%3E%3Cellipse cx='292' cy='150' rx='38' ry='32'/%3E%3Cellipse cx='236' cy='292' rx='26' ry='20'/%3E%3C/g%3E%3C/svg%3E") no-repeat, #f3e7cf;
    box-shadow: 0 6px 14px rgba(40, 25, 10, 0.35); clip-path: polygon(0 1%, 100% 0, 99% 100%, 1% 99%); }
  .vs-fit.waiting .paper { display: flex; flex-direction: column; }
  .vs-fit .paper::before, .vs-fit .paper::after { content: ''; position: absolute; top: 9px; width: 9px; height: 9px; border-radius: 50%; background: #c4553f; box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .vs-fit .paper::before { left: 14px; } .vs-fit .paper::after { right: 14px; }
  .vs-fit .paper-head { font: italic 15px/1 ${BOOK}; color: #8a3b2a; letter-spacing: 0.04em; margin-bottom: 8px; }
  .vs-fit .paper-words { flex: 1; min-height: 0; margin: 0; overflow: hidden; overflow-wrap: anywhere; font: 34px/1.28 ${HAND}; color: #2b3f60; }
  .vs-fit.waiting .face, .vs-fit.waiting .dim { display: none; }
  /* Waving goodbye: the controls rest, untouchable. */
  .vs-fit.leaving .face > * { pointer-events: none; opacity: 0.6; transition: opacity 300ms ease; }
  /* A tablet: the tuning words and the ribbons' buttons a size up, for a finger at arm's length. */
  @media (min-aspect-ratio: 9/10) and (max-width: 1299px) {
    .vs-fit .tag, .vs-fit .dial-name, .vs-fit .jokes-name, .vs-fit .step { font-size: 17px; }
    .vs-fit .dial-ends span, .vs-fit .tape .end { font-size: 16px; line-height: 16px; }
    .vs-fit .tape .end { padding: 3px 2px; }
    .vs-fit .tape { width: min(28px, 82%); }
    .vs-fit .ribbon-row { grid-template-columns: 64px 1fr 64px; font-size: 16px; }
    .vs-fit .ribbon { height: 15px; --b: 26px; }
    .vs-fit .ribbon .button { width: 26px; height: 26px; margin: -13px 0 0 -13px; }
    .vs-fit .ribbon .button::after { line-height: 26px; }
    .vs-fit .marker { height: 24px; margin-top: -12px; }
    .vs-fit .marker::after { line-height: 24px; }
  }
  /* A phone: the stool is a dressing table, so the controls have room to be finger-sized and the words bigger. */
  @media (max-aspect-ratio: 9/10) {
    .vs-fit .ribbon-row { grid-template-columns: 64px 1fr 64px; gap: 6px; font-size: 16px; }
    .vs-fit .ribbon { height: 16px; --b: 26px; }
    .vs-fit .ribbon .button { width: 26px; height: 26px; margin: -13px 0 0 -13px; }
    .vs-fit .ribbon .button::after { line-height: 26px; }
    .vs-fit .step { padding: 0 12px; min-height: 38px; font-size: 17px; }
    .vs-fit .step::before { content: ''; position: absolute; inset: 0 -2px -6px; }
    .vs-fit .step { position: relative; }
    .vs-fit .dot { width: 28px; height: 28px; }
    .vs-fit .tag, .vs-fit .dial-name, .vs-fit .jokes-name { font-size: 17px; }
    .vs-fit .dial-ends span { font-size: 16px; line-height: 16px; }
    .vs-fit .dial { column-gap: 14px; row-gap: 3px; }
    .vs-fit .knob { --k: clamp(44px, calc(100cqh - 46px), 64px); }
    .vs-fit .tape .end { font-size: 16px; line-height: 16px; }
    .vs-fit .tape { width: min(28px, 82%); }
    .vs-fit .legs { justify-content: stretch; padding: 0; }
    .vs-fit .legs .ribbon-row { flex: 1; }
    .vs-fit .ribbon::before { inset: -14px 0; }
    .vs-fit .dot::after { inset: -8px -12px; }
    .vs-fit .marker { height: 26px; margin-top: -13px; width: 50px; }
    .vs-fit .marker::after { line-height: 26px; }
    .vs-fit .glass { padding: 6px 4px; }
    .vs-fit .right { padding: 2px 0; }
    .vs-fit .colours { justify-content: space-between; }
    .vs-fit .hang { gap: 12px 10px; }
    .vs-fit .vs-swatch .felt { min-height: 60px; padding: 13px 5px 15px; }
    .vs-fit .vs-swatch b { font-size: 18px; }
    .vs-fit .vs-swatch small { font-size: 15px; }
  }
  @media (prefers-reduced-motion: reduce) { .vs-fit, .vs-fit .marker, .vs-fit .vs-swatch, .vs-fit .vs-swatch .felt::after, .vs-fit .dot { transition: none; } .vs-fit.reveal * { animation: none !important; } }
  `
}
