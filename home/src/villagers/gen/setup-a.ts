// #47 regroup, strategy A: one tool at a time. The villager stands big on the mat; the tools
// wait in an open sewing tin on the table, each compartment's name stitched on its felt. Picking
// one up (a click, or Enter on its name) holds that one tool up close, big, with its two ends
// written plainly beside it and one line on how it moves, while the villager changes live. Put it
// back to pick another. At most one control is out at once.
import * as THREE from 'three/webgpu'
import { feltTexture } from '../kinds'
import { HAND, MAT, TOP } from './workshop'
import type { Key } from './sliders'
import type { Scene, Strategy } from './setup-strategy'

const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
type Item = 'size' | 'hue' | 'pitch' | 'pace' | 'energy' | 'manner' | 'humour'
const ITEMS: Item[] = ['hue', 'pitch', 'manner', 'humour', 'size', 'pace', 'energy']
const KEYS_OF: Record<Item, Key[]> = { size: ['size'], hue: ['hue'], pitch: ['pitch'], pace: ['pace'], energy: ['energy'], manner: ['warmth', 'playful', 'chatty'], humour: ['humour'] }
const ITEM_OF = (key: Key): Item => (key === 'warmth' || key === 'playful' || key === 'chatty' ? 'manner' : key)
/** What it is, what it changes and how it moves, said once on the card that comes out with it. */
const ABOUT: Record<Item, { name: string; label: string; how: string; ends: [string, string] | null }> = {
  size: { name: 'Tape measure', label: 'size', how: 'Pull the tape out, or push it back in.', ends: ['smaller', 'bigger'] },
  hue: { name: 'Thread spools', label: 'colour', how: 'Slide the pin along, or tap a spool.', ends: null },
  pitch: { name: 'Xylophone', label: 'pitch', how: 'Slide the mallet, or tap a bar.', ends: ['lower voice', 'higher voice'] },
  pace: { name: 'Metronome', label: 'pace', how: 'Slide the weight: up is slower.', ends: ['slower', 'quicker'] },
  energy: { name: 'Wind-up key', label: 'energy', how: 'Turn the key: drag left or right.', ends: ['calmer', 'livelier'] },
  manner: { name: 'Three ribbons', label: 'manner', how: 'Slide each button along its ribbon.', ends: null },
  humour: { name: 'Stitch dial', label: 'jokes', how: 'Turn the dial: drag left or right.', ends: ['clean', 'cheeky'] },
}
/** How it is held: from above (flat things) or from the front (things that stand). */
const VIEW: Record<Item, number> = { size: 0.85, hue: 0.62, pitch: 0.85, pace: 0.08, energy: 0.3, manner: 0.92, humour: 0.85 }

/** The tin's floor: felt, with a stitched line round each compartment and its name. */
function paintFloor(cols: number, rows: number, names: string[][]) {
  const W = 1200, H = 520
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  const felt = feltTexture('#8f3a32', 7, { band: false })
  g.drawImage(felt.image as HTMLCanvasElement, 0, 0, W, H)
  felt.dispose()
  g.fillStyle = 'rgba(80, 20, 15, 0.25)'
  g.fillRect(0, 0, W, H)
  for (let r = 0; r < rows; r++) {
    const n = names[r].length
    for (let c = 0; c < n; c++) {
      const w = W / n, h = H / rows, x = c * w, y = r * h
      g.strokeStyle = 'rgba(255, 236, 205, 0.55)'
      g.lineWidth = 4
      g.setLineDash([16, 11])
      g.strokeRect(x + 14, y + 14, w - 28, h - 28)
      g.setLineDash([])
      g.fillStyle = '#fff1d8'
      g.strokeStyle = 'rgba(60, 15, 10, 0.8)'
      g.lineWidth = 8
      g.font = `700 78px ${HAND}`
      g.textAlign = 'center'
      g.textBaseline = 'alphabetic'
      g.strokeText(names[r][c], x + w / 2, y + h - 30)
      g.fillText(names[r][c], x + w / 2, y + h - 30)
    }
  }
  void cols
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function tin(scene: Scene): Strategy {
  const { tools, stage } = scene
  // ── The tin: a shallow painted tin with a felt floor, two rows of compartments ──
  const TW = 0.62, TD = 0.28, TH = 0.05
  const rows: Item[][] = [['hue', 'pitch', 'manner', 'humour'], ['size', 'pace', 'energy']]
  const box = new THREE.Group()
  box.name = 'villager workshop tin'
  const paint = new THREE.MeshStandardMaterial({ color: '#2f5f6b', roughness: 0.45, metalness: 0.35 })
  const rim = new THREE.MeshStandardMaterial({ color: '#d9b07a', roughness: 0.35, metalness: 0.55 })
  const floorTex = paintFloor(4, 2, rows.map((r) => r.map((i) => ABOUT[i].label)))
  const floor = new THREE.Mesh(new THREE.BoxGeometry(TW, 0.006, TD), [paint, paint, new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1 }), paint, paint, paint])
  floor.position.y = 0.003
  box.add(floor)
  for (const [w, d, x, z] of [[TW + 0.016, 0.008, 0, -TD / 2], [TW + 0.016, 0.008, 0, TD / 2], [0.008, TD, -TW / 2, 0], [0.008, TD, TW / 2, 0]] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, TH, d), paint)
    wall.position.set(x, TH / 2, z)
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.004, 0.006, d + 0.004), rim)
    lip.position.set(x, TH, z)
    box.add(wall, lip)
  }
  const divider = new THREE.Mesh(new THREE.BoxGeometry(TW, TH * 0.6, 0.004), paint)
  divider.position.set(0, TH * 0.3, 0)
  box.add(divider)
  box.traverse((o) => { o.castShadow = o.receiveShadow = true })
  box.visible = false
  scene.group.add(box)
  /** Each item's compartment centre in the tin's own space (the back half of it; its name is at the front). */
  const slot = (item: Item) => {
    const r = rows.findIndex((row) => row.includes(item)), row = rows[r], c = row.indexOf(item)
    return new THREE.Vector3((c - (row.length - 1) / 2) * (TW / row.length), 0.008, (r - 0.5) * (TD / 2) - 0.03)
  }

  // ── The page: one card for the tool that is out, its two end words, and a keyboard list of the tin ──
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  const held = document.createElement('div')
  held.className = 'vs-held'
  const heldName = document.createElement('b')
  const heldHow = document.createElement('span')
  const back = document.createElement('button')
  back.type = 'button'
  back.textContent = 'Put it back'
  held.append(heldName, heldHow, back)
  const endL = document.createElement('div'), endR = document.createElement('div')
  endL.className = endR.className = 'vs-heldend'
  const lid = document.createElement('div')
  lid.className = 'vs-tinlist'
  lid.setAttribute('role', 'group')
  lid.setAttribute('aria-label', 'The sewing tin')
  const pickButtons = ITEMS.map((item) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = `Pick up the ${ABOUT[item].name.toLowerCase()} (${ABOUT[item].label})`
    b.addEventListener('click', () => pick(item))
    lid.append(b)
    return b
  })
  const hint = document.createElement('div')
  hint.className = 'vs-tinhint'
  hint.textContent = 'Pick a tool out of the tin'
  document.body.append(held, endL, endR, lid, hint)

  let out: Item | null = null
  let tuning = false
  const narrow = () => scene.layout() === 'narrow'
  /** Each tool's own bounds at scale 1, laid flat at the origin. */
  const local = new Map<Key, THREE.Box3>()
  const measure = () => {
    for (const key of Object.values(KEYS_OF).flat()) {
      tools.override(key, { pos: new THREE.Vector3(), turn: 0, scale: 1 })
      const g = tools.group.getObjectByName(`workshop ${key}`)!
      g.updateMatrixWorld(true)
      local.set(key, new THREE.Box3().setFromObject(g))
    }
  }

  // ── Placing: the tin on the table and the held tool in front of the camera, both from the pose the camera is going to ──
  const ndc = new THREE.Vector3()
  const ray = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP)
  const onTable = (cam: THREE.PerspectiveCamera, sx: number, sy: number) => {
    ray.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), cam)
    const p = new THREE.Vector3()
    if (!ray.ray.intersectPlane(plane, p)) p.set(MAT.x, TOP, 0.5)
    p.z = Math.min(p.z, 0.6)
    return p
  }
  /** Metres per page pixel at a point. */
  const perPx = (cam: THREE.PerspectiveCamera, p: THREE.Vector3) => {
    const d = p.clone().applyMatrix4(cam.matrixWorldInverse).z
    return (2 * Math.abs(d) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / innerHeight
  }
  let sig = ''
  const layoutAll = (force = false) => {
    const cam = scene.target()
    const s = `${cam.position.toArray().map((v) => v.toFixed(3))}|${out}|${innerWidth}x${innerHeight}`
    if (!force && s === sig) return
    sig = s
    // The tin: wide, at the lower right of the table; narrow, across the bottom.
    // The held tool: up in front of the camera, at about half the villager's distance.
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
    const toward = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2)
    const far = cam.position.distanceTo(new THREE.Vector3(MAT.x, TOP + 0.1, MAT.z)) * 0.55
    const heldAt = (sx: number, sy: number, d = far) => {
      ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(cam)
      return cam.position.clone().add(ndc.sub(cam.position).normalize().multiplyScalar(d))
    }
    const facing = (a: number) => {
      const y = up.clone().multiplyScalar(1 - a).addScaledVector(toward, a).normalize()
      const z = new THREE.Vector3().crossVectors(right, y).normalize()
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, y, z))
    }
    // The tin: wide, on the table to the right of the mat; a phone has no table below the villager, so it is held low
    // in front, like a tray on your lap.
    const tinAt = narrow() ? heldAt(innerWidth * 0.5, innerHeight * 0.8, far * 1.1) : onTable(cam, innerWidth * 0.76, innerHeight * 0.71)
    const tinPx = narrow() ? innerWidth * 0.88 : Math.min(innerWidth * 0.3, 450)
    const k = (tinPx * perPx(cam, tinAt)) / TW
    box.position.copy(tinAt)
    box.quaternion.copy(narrow() ? facing(0.62) : new THREE.Quaternion())
    box.scale.setScalar(k)
    box.updateMatrixWorld(true)
    for (const item of ITEMS) {
      const keys = KEYS_OF[item]
      keys.forEach((key, i) => {
        const b = local.get(key)!
        const size = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3())
        let at: THREE.Vector3, q: THREE.Quaternion, scale: number
        if (item === out) {
          // Held: its top toward you (flat things) or its front (standing things), as big as a hand would hold it up.
          const a = VIEW[item]
          q = facing(a)
          // The tape is measured half out: leave room for it pulled all the way.
          const pull = item === 'size' ? 0.6 : 1
          const wide = (narrow() ? innerWidth * 0.7 : Math.min(innerWidth * 0.22, 330)) * pull
          const tall = narrow() ? innerHeight * 0.1 : innerHeight * 0.2
          const sx = (narrow() ? innerWidth / 2 : innerWidth * 0.74) - (item === 'size' ? wide * 0.35 : 0)
          const rowGap = keys.length > 1 ? (narrow() ? 40 : 64) : 0
          const sy = (narrow() ? innerHeight * 0.56 : innerHeight * 0.47) + (i - (keys.length - 1) / 2) * rowGap
          const c = heldAt(sx, sy)
          const px = perPx(cam, c)
          const deep = a > 0.5 ? size.z : size.y
          scale = Math.min((wide * px) / size.x, ((keys.length > 1 ? rowGap * 0.7 : tall) * px) / deep)
          at = c.sub(mid.clone().multiplyScalar(scale).applyQuaternion(q))
        } else {
          // In its compartment, small enough to fit, standing on the felt.
          const cell = box.localToWorld(slot(item).add(new THREE.Vector3(0, 0, keys.length > 1 ? (i - 1) * 0.034 : 0)))
          const fit = Math.min((TW / 4 - 0.02) / size.x, (TD / 2 - 0.04) / Math.max(size.z, keys.length > 1 ? 0.12 : 0), 0.09 / Math.max(size.y, 0.001), 0.6) * k
          scale = keys.length > 1 ? fit * 0.95 : fit
          q = box.quaternion.clone()
          at = cell.sub(new THREE.Vector3(mid.x, b.min.y, mid.z).multiplyScalar(scale).applyQuaternion(q))
        }
        tools.override(key, { pos: at, turn: 0, scale, quat: q })
      })
    }
  }

  const pick = (item: Item) => {
    if (!tuning) return
    out = item
    tools.only(KEYS_OF[item])
    const about = ABOUT[item]
    heldName.textContent = `${about.name}: ${about.label}`
    heldHow.textContent = about.how
    held.classList.add('shown')
    endL.textContent = about.ends?.[0] ?? ''
    endR.textContent = about.ends?.[1] ?? ''
    if (item === 'hue') {
      endL.textContent = endR.textContent = ''
      endL.style.setProperty('--sw', scene.hueAt(0) ?? '#c88')
      endR.style.setProperty('--sw', scene.hueAt(1) ?? '#8c8')
    }
    endL.classList.toggle('swatch', item === 'hue')
    endR.classList.toggle('swatch', item === 'hue')
    for (const b of pickButtons) b.hidden = true
    hint.classList.remove('shown')
    layoutAll(true)
    tools.focus(KEYS_OF[item][0])
  }
  const putBack = () => {
    if (!out) return
    const was = out
    out = null
    tools.only([])
    held.classList.remove('shown')
    endL.classList.remove('shown')
    endR.classList.remove('shown')
    for (const b of pickButtons) b.hidden = false
    hint.classList.add('shown')
    layoutAll(true)
    pickButtons[ITEMS.indexOf(was)].focus({ preventScroll: true })
  }
  back.addEventListener('click', putBack)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && out) putBack()
  }
  addEventListener('keydown', onKey)

  return {
    id: 'a',
    standAt: () => new THREE.Vector3(MAT.x - (narrow() ? 0 : 0.06), TOP + 0.006, MAT.z - (narrow() ? 0.1 : 0.04)),
    turn: () => (narrow() ? 0.15 : 0.3),
    toolsVisible: () => scene.state() === 'tuning' || scene.state() === 'stitching',
    pose(state) {
      if (state === 'waiting') return scene.overMat()
      if (state !== 'stitching' && state !== 'tuning') return null
      return narrow()
        ? scene.front({ top: 178, bottom: innerHeight * 0.47, slope: 0.5, fov: 54 })
        : scene.front({ top: 150, bottom: innerHeight - 110, left: 40, right: innerWidth * 0.58, slope: 0.58 })
    },
    tuning() {
      tuning = true
      if (!local.size) measure()
      tools.mode('on')
      tools.only([])
      box.visible = true
      out = null
      layoutAll(true)
      hint.classList.add('shown')
      lid.classList.add('shown')
      for (const b of pickButtons) b.hidden = false
      pickButtons[0].focus({ preventScroll: true })
    },
    leaving() {
      tuning = false
      out = null
      tools.only(null)
      box.visible = false
      held.classList.remove('shown')
      endL.classList.remove('shown')
      endR.classList.remove('shown')
      hint.classList.remove('shown')
      lid.classList.remove('shown')
    },
    grab(key) {
      const item = ITEM_OF(key)
      if (item === out) return false
      pick(item)
      return true
    },
    place(what, w, h) {
      // The tin has the lower right; the send-off tag goes to the top right, the save tag stays bottom left.
      if (what === 'done' && !narrow()) return { x: innerWidth - 24 - w, y: 24 }
      void h
      return null
    },
    frame() {
      const s = scene.state()
      box.visible = s === 'tuning' || s === 'stitching'
      if (!box.visible) return
      if (!local.size) measure()
      layoutAll()
      // The tin's hint sits just under the tin; the held card above the tool that is out, its end words at the tool's ends.
      tools.group.updateMatrixWorld(true)
      const cam = stage.camera
      const p = box.position.clone().add(new THREE.Vector3(0, 0, (TD / 2) * box.scale.x)).project(cam)
      const hx = ((p.x + 1) / 2) * innerWidth, hy = ((1 - p.y) / 2) * innerHeight
      hint.style.translate = `calc(${Math.round(hx)}px - 50%) ${Math.round(Math.min(hy + 6, innerHeight - 40))}px`
      if (!out) return
      const keys = KEYS_OF[out]
      let top = Infinity, left = Infinity, right = -Infinity
      for (const r of tools.rects().filter((r) => keys.includes(r.key))) {
        top = Math.min(top, r.top)
        left = Math.min(left, r.left)
        right = Math.max(right, r.right)
      }
      let bottom = -Infinity
      for (const r of tools.rects().filter((r) => keys.includes(r.key))) bottom = Math.max(bottom, r.bottom)
      held.style.translate = narrow()
        ? `calc(${Math.round(innerWidth / 2)}px - 50%) ${Math.round(bottom + 12)}px`
        : `calc(${Math.round((left + right) / 2)}px - 50%) calc(${Math.round(top - 12)}px - 100%)`
      if (out !== 'manner') {
        const [a, b] = tools.ends(keys[0])
        // Each end word sits just beyond its end, along the tool; an upright tool's words go to its side.
        const upright = Math.abs(b.y - a.y) > Math.abs(b.x - a.x)
        if (upright) {
          endL.style.translate = `${Math.round(right + 14)}px calc(${Math.round(a.y)}px - 50%)`
          endR.style.translate = `${Math.round(right + 14)}px calc(${Math.round(b.y)}px - 50%)`
        } else {
          endL.style.translate = `calc(${Math.round(Math.min(a.x, b.x) - 14)}px - 100%) calc(${Math.round(a.y)}px - 50%)`
          endR.style.translate = `${Math.round(Math.max(a.x, b.x) + 14)}px calc(${Math.round(b.y)}px - 50%)`
        }
        endL.classList.add('shown')
        endR.classList.add('shown')
      }
    },
    api: {
      pick: (item: Item) => pick(item),
      putBack: () => putBack(),
      out: () => out,
      /** Where an item lies in the tin on the page, to click it. */
      tinAt: (item: Item) => {
        const p = box.localToWorld(slot(item)).project(stage.camera)
        return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight }
      },
    },
    dispose() {
      removeEventListener('keydown', onKey)
      box.removeFromParent()
      box.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) m.geometry.dispose()
      })
      paint.dispose()
      rim.dispose()
      floorTex.dispose()
      held.remove()
      endL.remove()
      endR.remove()
      lid.remove()
      hint.remove()
      style.remove()
    },
  }
}

function css() {
  return `
  .vs-held { position: fixed; z-index: 6; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: min(340px, calc(100vw - 32px));
    padding: 9px 16px 10px; border-radius: 4px 10px 6px 9px; background: linear-gradient(180deg, #fffaf0, #f4e6c9); color: #4a3220; text-align: center;
    box-shadow: 0 8px 18px rgba(60, 30, 10, 0.22); rotate: -0.8deg; opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
  .vs-held::before { content: ''; position: absolute; inset: 4px; border: 1.5px dashed rgba(150, 100, 60, 0.32); border-radius: 3px 7px 4px 6px; pointer-events: none; }
  .vs-held.shown { opacity: 1; pointer-events: auto; }
  .vs-held b { font: 700 20px/1.15 ${HAND}; color: #7a3b2a; }
  .vs-held span { font: italic 15px/1.3 ${BOOK}; }
  .vs-held button { position: relative; margin-top: 3px; padding: 0 2px; border: 0; background: none; cursor: pointer; color: #23395a; font: 700 16px/1.2 ${HAND};
    text-decoration: underline 1.3px; text-underline-offset: 3px; }
  .vs-heldend { position: fixed; z-index: 5; left: 0; top: 0; padding: 3px 10px 4px; border-radius: 4px 9px 9px 4px; background: linear-gradient(180deg, #fffaf0, #f4e6c9);
    color: #23395a; font: 700 21px/1.1 ${HAND}; white-space: nowrap; box-shadow: 0 3px 8px rgba(60, 30, 10, 0.22); opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
  .vs-heldend.shown:not(:empty), .vs-heldend.shown.swatch { opacity: 1; }
  .vs-heldend.swatch { width: 26px; height: 26px; padding: 0; border-radius: 50%; background: var(--sw); box-shadow: inset 0 0 0 3px rgba(255, 250, 235, 0.7), 0 2px 5px rgba(60, 30, 10, 0.3); }
  .vs-tinhint { position: fixed; z-index: 5; left: 0; top: 0; font: 700 17px/1.1 ${HAND}; color: #fffaf0; text-shadow: 0 1px 2px rgba(40, 20, 8, 0.7);
    opacity: 0; pointer-events: none; transition: opacity 200ms ease; white-space: nowrap; }
  .vs-tinhint.shown { opacity: 1; }
  [data-vs-strategy=a] .vs-tools .vs-tool:not(.end) { opacity: 0 !important; }
  .vs-tinlist { position: fixed; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .vs-tinlist button:focus { outline: none; }
  [data-vs-layout=narrow] .vs-held b { font-size: 17px; }
  [data-vs-layout=narrow] .vs-held span { font-size: 13.5px; }
  [data-vs-layout=narrow] .vs-heldend { font-size: 17px; }
  @media (prefers-reduced-motion: reduce) { .vs-held, .vs-heldend, .vs-tinhint { transition: none; } }
  `
}
