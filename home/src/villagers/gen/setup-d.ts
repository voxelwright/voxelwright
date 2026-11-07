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
/** Its measures (metres, in its own space: x across, y up from the table, z toward the room). */
const F = { w: 0.58, bottom: 0.29, top: 0.91, rail: 0.06, topRail: 0.055, bottomRail: 0.04, pivot: 0.6, tilt: 0.04, z: -0.02 }
const POST = 0.31
/** The fitting stool: its top, the drawer's front, the legs (where the ribbons are tied) and the foot rail. */
const S = { w: 0.56, d: 0.26, z: 0.15, top: 0.32, board: 0.015, drawer: [0.172, 0.302], legs: [0.05, 0.168], foot: [0.004, 0.046], leg: 0.03 }
const FRONT = S.z + S.d / 2
/** The glass, in the frame's space (its middle at the pivot). */
const GLASS = { left: -F.w / 2 + F.rail, right: F.w / 2 - F.rail, bottom: F.bottom + F.bottomRail, top: F.top - F.topRail }
const GW = GLASS.right - GLASS.left, GH = GLASS.top - GLASS.bottom
/** How much bigger the villager looks than the glass behind it (across, and up): it stands on the stool, in front of the frame. */
const NEARER = { w: 1.22, h: 1.12 }

function furniture() {
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
    box(0.028, 0.93, 0.028, wood, s * POST, 0.465, F.z)
    box(0.042, 0.022, 0.26, dark, s * POST, 0.011, F.z - 0.02)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 12), brass)
    ball.position.set(s * POST, 0.95, F.z)
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
  const room = furniture()
  scene.group.add(room.group)
  // While the pattern is made, the cutting happens on the stool's top.
  shop.bench(AT.clone().add(new THREE.Vector3(0, S.top, S.z)))

  const root = el('div', 'vs-fit')
  const dim = el('div', 'dim', root)
  /** One layer per face of the furniture; each is laid over its face every frame. */
  const face = (name: string) => el('div', `face ${name}`, root)
  const topRail = face('top'), leftRail = face('left'), rightRail = face('right'), drawer = face('drawer'), legs = face('legs'), foot = face('foot'), glassFace = face('glass')
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
  const ribbons = kit.ribbons(legs)
  const jokes = el('div', 'jokes', foot)
  el('b', 'jokes-name', jokes).textContent = 'jokes'
  const steps = kit.jokes(jokes)
  const hang = el('div', 'hang', glassFace)
  const drawSwatches = kit.swatches(hang)
  const parts = { marker, tape, dots, knobs, ribbons, steps }

  // ── Projection: the furniture's faces on the page ──
  const v = new THREE.Vector3()
  /** A face of the furniture (corners in its own space) as a page rectangle through a camera. */
  const rectOf = (pts: [number, number, number][], cam: THREE.Camera, obj: THREE.Object3D = room.group): Rect => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    obj.updateMatrixWorld(true)
    for (const p of pts) {
      v.set(...p).applyMatrix4(obj.matrixWorld).project(cam)
      const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    return { left, top, right, bottom }
  }
  const quad = (x0: number, x1: number, y0: number, y1: number, z: number): [number, number, number][] => [[x0, y0, z], [x1, y0, z], [x0, y1, z], [x1, y1, z]]
  const fy = (y: number) => y - F.pivot
  const inner = S.w / 2 - S.leg
  const FACES = {
    top: () => rectOf(quad(-F.w / 2, F.w / 2, fy(GLASS.top), fy(F.top), 0.016), stage.camera, room.frame),
    left: () => rectOf(quad(-F.w / 2, GLASS.left, fy(GLASS.bottom), fy(GLASS.top), 0.016), stage.camera, room.frame),
    right: () => rectOf(quad(GLASS.right, F.w / 2, fy(GLASS.bottom), fy(GLASS.top), 0.016), stage.camera, room.frame),
    glass: () => rectOf(quad(GLASS.left, GLASS.right, fy(GLASS.bottom), fy(GLASS.top), 0.001), stage.camera, room.frame),
    drawer: () => rectOf(quad(-S.w / 2, S.w / 2, S.drawer[0] + 0.01, S.drawer[1], FRONT), stage.camera),
    legs: () => rectOf(quad(-inner, inner, S.legs[0], S.legs[1], FRONT), stage.camera),
    foot: () => rectOf(quad(-inner, inner, S.foot[0], S.foot[1], FRONT), stage.camera),
    all: () => rectOf(BOUNDS, stage.camera),
  }
  const lay = (e: HTMLElement, r: Rect) => {
    const at = `${Math.round(r.left)}px ${Math.round(r.top)}px`
    if (e.style.translate !== at) e.style.translate = at
    const w = `${Math.round(r.right - r.left)}px`, h = `${Math.round(r.bottom - r.top)}px`
    if (e.style.width !== w) e.style.width = w
    if (e.style.height !== h) e.style.height = h
  }

  // ── The camera: square on to the mirror, the whole of it and the stool in a page rectangle ──
  const fit = new THREE.PerspectiveCamera()
  const box = (x: number, y0: number, y1: number, z0: number, z1: number) => {
    const out: [number, number, number][] = []
    for (const xx of [-x, x]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([xx, y, z])
    return out
  }
  const BOUNDS = box(POST + 0.022, 0, 0.972, F.z - 0.02, FRONT)
  /** The stool's top and the glass's lower half, for the waiting. */
  const WORK = box(S.w / 2 + 0.01, S.top, S.top + 0.05, S.z - S.d / 2, FRONT)
  const narrow = () => scene.layout() === 'narrow'
  /** These bounds fitted between page rows and columns, by stepping back and panning. */
  const frameIt = (pts: [number, number, number][], o: { top: number; bottom: number; left: number; right: number; fov: number; slope: number; lookY: number }) => {
    scene.lens(o.fov)
    fit.fov = o.fov
    fit.aspect = innerWidth / innerHeight
    fit.near = 0.05
    fit.far = 60
    fit.updateProjectionMatrix()
    const dir = new THREE.Vector3(0, o.slope, 1).normalize()
    const look = AT.clone().add(new THREE.Vector3(0, o.lookY, S.z))
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
  const at = () => (narrow()
    // A phone: close, the furniture the width of the screen; room above for the name, below for the two tags.
    ? frameIt(BOUNDS, { top: 120, bottom: innerHeight - 86, left: 4, right: innerWidth - 4, fov: 46, slope: 0.1, lookY: 0.5 })
    // Wide or a tablet: the furniture the height of the screen, the kitchen a border round it.
    : frameIt(BOUNDS, { top: 22, bottom: innerHeight - 14, left: 0, right: innerWidth, fov: 34, slope: 0.1, lookY: 0.5 }))
  // The waiting: down at the stool's top, where the pattern is cut; the glass behind it.
  const work = () => frameIt(WORK, narrow()
    ? { top: 200, bottom: innerHeight - 150, left: 8, right: innerWidth - 8, fov: 46, slope: 1.5, lookY: S.top }
    : { top: 170, bottom: innerHeight - 110, left: innerWidth * 0.18, right: innerWidth * 0.82, fov: 34, slope: 1.5, lookY: S.top })

  const showing = () => {
    const s = scene.state()
    return !scene.watching() && (s === 'empty' || s === 'failed' || s === 'stitching' || s === 'tuning')
  }
  const tuningNow = () => scene.state() === 'tuning' || scene.state() === 'stitching'
  const card = () => document.querySelector<HTMLElement>('.vs-card')
  let revealTimer = 0

  return {
    id: 'd',
    standAt: () => AT.clone().add(new THREE.Vector3(0, S.top + 0.007, S.z)),
    turn: () => 0.06,
    // The mirror is furniture, not resized to the villager: a villager is shown at the size that, at its biggest,
    // stands inside the glass clear of both rails, with room above its head for what it says.
    fit(body) {
      const big = SCALE * 2 ** 0.32
      const w = Math.max(body.max.x - body.min.x, (body.max.z - body.min.z) * 0.7) * big
      const h = (body.max.y - Math.min(0, body.min.y)) * big
      return Math.min(1.6, (GW - 0.03) / NEARER.w / w, (GH * 0.84) / NEARER.h / h)
    },
    toolsVisible: () => false,
    pose(state) {
      if (state === 'waiting') return work()
      if (state === 'empty' || state === 'failed' || state === 'stitching' || state === 'tuning') return at()
      return null
    },
    tuning() {
      root.classList.add('tuning', 'reveal')
      // The first reveal: each control shows once how it moves.
      clearTimeout(revealTimer)
      revealTimer = window.setTimeout(() => root.classList.remove('reveal'), 2600)
      marker.focus({ preventScroll: true })
    },
    leaving() {
      root.classList.remove('tuning', 'reveal')
      const c = card()
      if (c) c.style.maxWidth = ''
    },
    slip(w) {
      void w
      const h = scene.slip.offsetHeight
      if (scene.state() === 'waiting') {
        // The progress tag lies on the table just in front of the stool.
        const f = FACES.foot()
        if (scene.slip.style.width) scene.slip.style.width = ''
        return { x: (f.left + f.right) / 2, y: Math.min(innerHeight - h / 2 - 16, f.bottom + h / 2 + 14) }
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
      if (narrow() || what === 'name') return null
      // Wide or a tablet: the save tag and the send-off stand on the table either side of the stool.
      const s = FACES.legs(), all = FACES.all()
      const y = Math.min(innerHeight - 14 - h, s.bottom - h)
      return what === 'save' ? { x: Math.max(16, all.left - 28 - w), y } : { x: Math.min(innerWidth - 16 - w, all.right + 28), y }
    },
    frame() {
      const on = showing()
      root.classList.toggle('shown', on)
      root.classList.toggle('tuning', tuningNow())
      patterns.group.visible = false
      if (!on) return
      drawSwatches()
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
      // Before there is a villager, the swatches keep clear of the slip below them.
      if (!tuningNow()) {
        const slipTop = scene.slip.getBoundingClientRect().top
        const g = glassFace.getBoundingClientRect()
        hang.style.maxHeight = `${Math.max(60, Math.round(slipTop - g.top - 14))}px`
        // A swatch the glass can't hold whole is put away, not shown cut off.
        for (const b of hang.children as HTMLCollectionOf<HTMLElement>) b.style.visibility = b.offsetTop - hang.offsetTop + b.offsetHeight > hang.clientHeight + 1 ? 'hidden' : ''
      }
      kit.sync(parts)
    },
    api: {
      /** A control's middle on the page, to click or drag it. */
      control: (key: Key) => kit.control(parts, key),
      glass: () => glassFace.getBoundingClientRect().toJSON(),
      /** Each face's content against its face (page px): content that spills out of its face is a layout defect. */
      spill: () => [topRail, leftRail, rightRail, drawer, legs, foot].flatMap((f) => {
        const r = f.getBoundingClientRect()
        return [...f.querySelectorAll<HTMLElement>(':scope > *, .dial, .ribbon-row, .step')].filter((c) => getComputedStyle(c).visibility !== 'hidden').map((c) => {
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
  .vs-fit .tape .end { position: absolute; left: 1px; writing-mode: vertical-rl; rotate: 180deg; font: 700 14px/14px ${HAND}; color: #4a3220; pointer-events: none; }
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
  .vs-fit .ribbon { position: relative; height: 14px; border-radius: 2px; cursor: pointer; touch-action: none; background: var(--ground);
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
  .vs-fit .step.locked { opacity: 0.6; text-decoration: line-through 1px; }
  .vs-fit .step.locked::after { content: ' 🔒'; font-size: 11px; text-decoration: none; }
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
  .vs-fit .step:not(.at):not(.locked):hover { background: rgba(255, 243, 220, 0.32); }
  ${Array.from({ length: 7 }, (_, i) => `.vs-fit.reveal .dot:nth-child(${i + 1}) { animation-delay: ${(i * 0.08).toFixed(2)}s; }`).join(' ')}
  @keyframes vs-fit-bob { 50% { translate: 0 -6px; } }
  @keyframes vs-fit-turn { 25% { rotate: -14deg; } 75% { rotate: 14deg; } }
  @keyframes vs-fit-slide { 25% { translate: -7px 0; } 75% { translate: 7px 0; } }
  @keyframes vs-fit-pop { 50% { scale: 1.25; } }
  /* The swatches tucked into the glass: felt samples with pinked edges. */
  .vs-fit .glass { padding: 12px; }
  .vs-fit .hang { display: flex; flex-wrap: wrap; align-content: flex-start; justify-content: center; gap: 12px 10px; overflow: hidden; width: 100%; }
  .vs-fit .vs-swatch { position: relative; width: calc(50% - 6px); max-width: 150px; min-height: 64px; padding: 12px 6px 14px; border: 0; cursor: pointer; background: var(--felt, #7b9a6e); color: #fffaf0;
    clip-path: polygon(0 0, 100% 0, 100% 88%, 95% 100%, 90% 88%, 85% 100%, 80% 88%, 75% 100%, 70% 88%, 65% 100%, 60% 88%, 55% 100%, 50% 88%, 45% 100%, 40% 88%, 35% 100%, 30% 88%, 25% 100%, 20% 88%, 15% 100%, 10% 88%, 5% 100%, 0 88%);
    text-align: center; text-shadow: 0 1px 0 rgba(40, 20, 8, 0.35); transform-origin: 50% 0; transition: rotate 200ms ease, translate 200ms ease; }
  .vs-fit .vs-swatch::before { content: ''; position: absolute; left: 50%; top: 3px; width: 7px; height: 7px; margin-left: -3.5px; border-radius: 50%; background: #e9dcc0; box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .vs-fit .vs-swatch b { display: block; font: 700 16px/1.1 ${HAND}; }
  .vs-fit .vs-swatch small { display: block; margin-top: 3px; font: italic 14px/1.2 ${BOOK}; opacity: 0.92; }
  .vs-fit .vs-swatch:nth-child(odd) { rotate: -1.5deg; } .vs-fit .vs-swatch:nth-child(even) { rotate: 1.2deg; }
  .vs-fit .vs-swatch:hover { translate: 0 2px; }
  .vs-fit .vs-swatch[aria-pressed=true] { translate: 0 5px; rotate: 0deg; filter: brightness(1.08); }
  .vs-fit .vs-swatch[aria-pressed=true] b { text-decoration: underline 1.5px; text-underline-offset: 3px; }
  .vs-fit .vs-swatch:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 2px; }
  /* A phone: tighter rows on the narrower faces. */
  @media (max-aspect-ratio: 9/10) {
    .vs-fit .ribbon-row { grid-template-columns: 54px 1fr 54px; gap: 4px; }
    .vs-fit .ribbon { height: 12px; }
    .vs-fit .ribbon .button { width: 18px; height: 18px; margin: -9px 0 0 -9px; }
    .vs-fit .ribbon .button::after { line-height: 18px; }
    .vs-fit .step { padding: 2px 8px 3px; font-size: 14px; }
    .vs-fit .dot { width: 22px; height: 22px; }
    .vs-fit .tag, .vs-fit .dial-name, .vs-fit .jokes-name { font-size: 14px; }
    .vs-fit .dial { column-gap: 8px; row-gap: 1px; }
    .vs-fit .knob { --k: clamp(26px, calc(100cqh - 34px), 44px); }
    .vs-fit .glass { padding: 8px; }
    .vs-fit .hang { gap: 8px 8px; }
    .vs-fit .vs-swatch { min-height: 50px; padding: 9px 4px 11px; }
    .vs-fit .vs-swatch b { font-size: 15px; }
  }
  @media (prefers-reduced-motion: reduce) { .vs-fit, .vs-fit .marker, .vs-fit .vs-swatch, .vs-fit .dot { transition: none; } .vs-fit.reveal * { animation: none !important; } }
  `
}
