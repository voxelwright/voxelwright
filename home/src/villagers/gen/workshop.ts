// #47 setup, dev only: the kitchen table dressed as a felt workshop. A cutting mat,
// a tomato pin cushion, thread spools, a tissue pattern sheet with the description
// in handwriting, a needle and thread and a pair of scissors. While the model
// writes the villager the needle works a felt scrap and the scissors cut pattern
// pieces, one every few seconds: honest activity, never a percentage. When the
// villager is stitched, the same needle makes one pass per part.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { canvas, toTexture } from '../../paint'
import { TABLE_TOP } from '../../layout'
import { feltTexture } from '../kinds'

export const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
/** Where the villager stands on the mat, in world space. */
export const MAT = { x: -0.22, z: 0.12, w: 0.74, d: 0.44 }
export const TOP = TABLE_TOP

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

const mat = (color: string, roughness = 0.9, map: THREE.Texture | null = null) => new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, map, roughness })
const shadowed = <T extends THREE.Object3D>(o: T) => {
  o.traverse((n) => { n.castShadow = n.receiveShadow = true })
  return o
}

function paintMat() {
  const W = 1024, H = 640
  const [c, g] = canvas(W, H)
  g.fillStyle = '#3f6a58'
  g.fillRect(0, 0, W, H)
  // A faint mottle, so it reads as self-healing rubber, not a flat fill.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)'
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 2 + Math.random() * 5)
  }
  const step = W / 28
  for (let i = 0; i <= 28; i++) {
    g.strokeStyle = i % 4 === 0 ? 'rgba(236, 228, 200, 0.42)' : 'rgba(236, 228, 200, 0.17)'
    g.lineWidth = i % 4 === 0 ? 2 : 1
    g.beginPath()
    g.moveTo(i * step, 0)
    g.lineTo(i * step, H)
    g.stroke()
  }
  for (let j = 0; j * step <= H; j++) {
    g.strokeStyle = j % 4 === 0 ? 'rgba(236, 228, 200, 0.42)' : 'rgba(236, 228, 200, 0.17)'
    g.lineWidth = j % 4 === 0 ? 2 : 1
    g.beginPath()
    g.moveTo(0, j * step)
    g.lineTo(W, j * step)
    g.stroke()
  }
  // A 45-degree guide and the ruler numbers along the top, like a real quilter's mat.
  g.strokeStyle = 'rgba(236, 210, 150, 0.35)'
  g.setLineDash([10, 8])
  g.beginPath()
  g.moveTo(step * 2, H - step * 2)
  g.lineTo(step * 2 + (H - step * 4), step * 2)
  g.stroke()
  g.setLineDash([])
  g.fillStyle = 'rgba(240, 232, 205, 0.7)'
  g.font = '600 15px "Avenir Next", "Segoe UI", sans-serif'
  for (let i = 4; i < 28; i += 4) g.fillText(String(i / 4), i * step + 4, 16)
  // A worn border.
  g.strokeStyle = 'rgba(20, 40, 30, 0.6)'
  g.lineWidth = 10
  g.strokeRect(5, 5, W - 10, H - 10)
  return toTexture(c)
}

/** Tissue pattern paper: pieces drawn in dashes, notches, and the description written across. */
function paintPattern(text: string, name: string, notes: string[] = []) {
  const W = 1024, H = 760
  const [c, g] = canvas(W, H)
  g.fillStyle = '#f3e7cf'
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(160,120,70,0.06)'
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 24, 1)
  }
  // Pattern pieces on the right: a body, a head and two ears, cut lines and fold notes.
  g.strokeStyle = 'rgba(150, 70, 50, 0.6)'
  g.lineWidth = 3
  g.setLineDash([14, 9])
  const piece = (draw: () => void) => {
    g.beginPath()
    draw()
    g.stroke()
  }
  piece(() => g.ellipse(790, 470, 150, 190, 0, 0, Math.PI * 2))
  piece(() => g.ellipse(790, 160, 110, 95, 0, 0, Math.PI * 2))
  piece(() => g.ellipse(610, 120, 34, 70, -0.4, 0, Math.PI * 2))
  piece(() => g.ellipse(970, 120, 34, 70, 0.4, 0, Math.PI * 2))
  g.setLineDash([])
  g.fillStyle = 'rgba(150, 70, 50, 0.6)'
  for (const [x, y] of [[640, 470], [940, 470], [790, 280], [790, 660]]) {
    g.beginPath()
    g.moveTo(x - 9, y)
    g.lineTo(x + 9, y)
    g.lineTo(x, y + 14)
    g.fill()
  }
  g.font = `italic 30px ${HAND}`
  g.fillText('body · cut 2', 712, 480)
  g.fillText('head', 760, 170)
  g.strokeStyle = 'rgba(150, 70, 50, 0.45)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(790, 320)
  g.lineTo(790, 620)
  g.stroke()
  // The words, in the person's ink, wrapped down the left half.
  g.fillStyle = '#2b3f60'
  g.font = `56px ${HAND}`
  const words = text.trim() ? text.trim().split(/\s+/) : []
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (g.measureText(next).width > 540 && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  if (!lines.length) {
    g.fillStyle = 'rgba(70, 50, 35, 0.45)'
    g.font = `italic 40px ${HAND}`
    lines.push('who shall we make?')
  }
  lines.slice(0, 8).forEach((l, i) => g.fillText(l, 40, 96 + i * 72))
  if (name) {
    // The name, signed under the words with a flourish.
    const y = Math.min(720, 96 + Math.min(lines.length, 8) * 72 + 24)
    g.fillStyle = '#8a3b2a'
    g.font = `700 60px ${HAND}`
    g.fillText(name, 40, y)
    const w = g.measureText(name).width
    g.strokeStyle = 'rgba(138, 59, 42, 0.6)'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(40, y + 14)
    g.quadraticCurveTo(40 + w / 2, y + 24, 40 + w + 20, y + 8)
    g.stroke()
  }
  if (notes.length) {
    // The persona, as a pencilled note pinned to the bottom right of the sheet.
    const nx = 560, ny = 560, nw = 440
    g.save()
    g.translate(nx, ny)
    g.rotate(-0.025)
    g.fillStyle = '#fbf6e8'
    g.shadowColor = 'rgba(80, 50, 20, 0.25)'
    g.shadowBlur = 8
    g.fillRect(0, 0, nw, 40 + notes.length * 40)
    g.shadowBlur = 0
    g.fillStyle = '#3d2a1c'
    g.font = `34px ${HAND}`
    notes.slice(0, 4).forEach((n, i) => {
      let t = n
      while (g.measureText(t).width > nw - 30 && t.length > 4) t = `${t.slice(0, -2)}…`
      g.fillText(t, 16, 44 + i * 40)
    })
    g.fillStyle = '#c4553f'
    g.beginPath()
    g.arc(nw / 2, 6, 7, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  return toTexture(c)
}

/** A thread spool: wooden flanges, a barrel wound with thread. Returns the group and its thread material. */
export function spool(thread: string, r = 0.022, h = 0.05) {
  const g = new THREE.Group()
  const wood = mat('#d9b07a', 0.6)
  const flange = new THREE.CylinderGeometry(r * 1.25, r * 1.25, h * 0.12, 20)
  for (const y of [h * 0.06, h * 0.94]) {
    const f = new THREE.Mesh(flange, wood)
    f.position.y = y
    g.add(f)
  }
  const threadMat = new THREE.MeshStandardMaterial({ color: thread, roughness: 0.85, map: woundTexture() })
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.78, 20), threadMat)
  barrel.position.y = h / 2
  g.add(barrel)
  return { group: shadowed(g), thread: threadMat }
}

/** Fine wound lines (white, multiplied by the thread colour). */
function woundTexture() {
  const [c, g] = canvas(64, 128)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 64, 128)
  for (let y = 0; y < 128; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.08})`
    g.fillRect(0, y, 64, 1)
  }
  return toTexture(c)
}

export interface Workshop {
  group: THREE.Group
  /** Write the description (and later the name) on the pattern sheet. */
  pattern(text: string, name?: string, notes?: string[]): void
  /** 'idle' laid out, 'working' needle and scissors busy, 'tidy' everything back in place. */
  activity(state: 'idle' | 'working' | 'tidy'): void
  /** One needle pass across a world point, for the stitching. Resolves when done. */
  pass(at: THREE.Vector3, span: number, seconds: number): Promise<void>
  /** Pattern pieces cut so far while waiting (honest: one per few seconds, they are scenery). */
  readonly cut: number
  frame(dt: number, t: number): void
  /** Release the thread's last geometry (the rest goes with the group). */
  dispose(): void
}

export function workshop(): Workshop {
  const group = new THREE.Group()
  group.name = 'villager workshop'
  const y = TOP

  // The cutting mat.
  const matMesh = new THREE.Mesh(new RoundedBoxGeometry(MAT.w, 0.006, MAT.d, 2, 0.003), mat('#ffffff', 0.85, paintMat()))
  matMesh.position.set(MAT.x, y + 0.003, MAT.z)
  matMesh.rotation.y = -0.03
  matMesh.name = 'workshop mat'
  group.add(shadowed(matMesh))

  // The pattern sheet, back left, a little askew, with a pencil on it.
  const sheetMat = mat('#ffffff', 0.95, paintPattern('', ''))
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.371, 12, 1), sheetMat)
  {
    // A gentle curl along the far edge, like tissue paper that has been folded.
    const pos = sheet.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.max(0, pos.getY(i) - 0.11) * 0.12 + Math.sin(pos.getX(i) * 18) * 0.0012)
    sheet.geometry.computeVertexNormals()
  }
  sheet.rotation.set(-Math.PI / 2, 0, 0.1)
  sheet.position.set(-0.63, y + 0.0035, -0.16)
  sheet.name = 'workshop pattern'
  group.add(shadowed(sheet))
  const pencil = new THREE.Group()
  {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.15, 6), mat('#e0b23c', 0.5))
    body.rotation.z = Math.PI / 2
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.016, 6), mat('#e8cfa2', 0.8))
    tip.rotation.z = Math.PI / 2
    tip.position.x = 0.083
    pencil.add(body, tip)
    pencil.position.set(-0.4, y + 0.009, -0.02)
    pencil.rotation.y = 0.5
    group.add(shadowed(pencil))
  }

  // A tomato pin cushion with pins, behind the mat.
  {
    const cushion = new THREE.Group()
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', map: feltTexture('#c4553f', 7, { band: false }), roughness: 1 }))
    red.scale.set(1, 0.72, 1)
    red.position.y = 0.032
    cushion.add(red)
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.0018, 4, 20, Math.PI), mat('#8c3528', 1))
      seg.rotation.set(0, (i / 6) * Math.PI, 0)
      seg.rotation.x = Math.PI / 2
      seg.rotation.order = 'YXZ'
      seg.rotation.y = (i / 6) * Math.PI
      seg.scale.set(1, 1, 0.72)
      seg.position.y = 0.032
      cushion.add(seg)
    }
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.012, 5), mat('#5f7a3a', 0.9))
    leaf.position.y = 0.066
    cushion.add(leaf)
    const heads = ['#e8c547', '#6b8fb3', '#e9e2d4', '#b0563f', '#7a9a5a', '#e8c547', '#e9e2d4']
    heads.forEach((c, i) => {
      const a = i * 2.1, tilt = 0.35 + (i % 3) * 0.12
      const pin = new THREE.Group()
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, 0.045, 4), new THREE.MeshStandardMaterial({ color: '#c9c9c9', roughness: 0.3, metalness: 0.6 }))
      shaft.position.y = 0.0225
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }))
      head.position.y = 0.045
      pin.add(shaft, head)
      pin.position.set(Math.sin(a) * 0.026, 0.05, Math.cos(a) * 0.026)
      pin.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt)
      cushion.add(pin)
    })
    cushion.position.set(-0.24, y, -0.25)
    group.add(shadowed(cushion))
  }

  // A felt sheet being cut (right of the mat), with the scissors on it.
  const sheetFelt = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.004, 0.15, 2, 0.002), new THREE.MeshStandardMaterial({ color: '#ffffff', map: feltTexture('#d9a35f', 13, { band: false }), roughness: 1 }))
  sheetFelt.position.set(0.04, y + 0.009, 0.28)
  sheetFelt.rotation.y = 0.25
  group.add(shadowed(sheetFelt))

  // Cut pieces, laid on the mat one by one while waiting.
  const pieceColours = ['#d9a35f', '#e7d7b8', '#c97b63', '#9db08a', '#d9a35f', '#e7d7b8', '#c97b63', '#9db08a']
  const pieces = pieceColours.map((c, i) => {
    const shape = new THREE.Shape()
    const r = 0.026 + (i % 3) * 0.006
    if (i % 2) shape.absellipse(0, 0, r, r * 1.5, 0, Math.PI * 2, false, 0)
    else shape.absellipse(0, 0, r * 1.3, r, 0, Math.PI * 2, false, 0)
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false, curveSegments: 18 }).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff', map: feltTexture(c, 40 + i, { band: false }), roughness: 1 }))
    const col = i % 4, row = Math.floor(i / 4)
    m.position.set(MAT.x - 0.28 + col * 0.075, y + 0.007, MAT.z + 0.1 + row * 0.07)
    m.rotation.y = i * 0.7
    m.visible = false
    m.name = `workshop piece ${i}`
    group.add(shadowed(m))
    return m
  })

  // Scissors: two blades and finger loops about a pivot.
  const scissors = new THREE.Group()
  const blades: THREE.Group[] = []
  {
    const steel = new THREE.MeshStandardMaterial({ color: '#cfd2d4', roughness: 0.28, metalness: 0.75 })
    const handle = mat('#c4553f', 0.55)
    for (const s of [-1, 1]) {
      const half = new THREE.Group()
      const blade = new THREE.Shape()
      blade.moveTo(0, -0.004)
      blade.lineTo(0.085, -0.001)
      blade.lineTo(0.085, 0.002)
      blade.lineTo(0, 0.006)
      const b = new THREE.Mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.0018, bevelEnabled: false }).rotateX(-Math.PI / 2), steel)
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0045, 8, 18), handle)
      loop.rotation.x = Math.PI / 2
      loop.position.set(-0.026, 0, s * 0.006)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.006), handle)
      arm.position.set(-0.01, 0, s * 0.003)
      half.add(b, loop, arm)
      half.position.y = s > 0 ? 0.002 : 0
      scissors.add(half)
      blades.push(half)
    }
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.006, 10), steel)
    pivot.position.y = 0.002
    scissors.add(pivot)
    scissors.position.set(0.06, y + 0.015, 0.27)
    scissors.rotation.y = 0.6
    group.add(shadowed(scissors))
  }

  // The needle and its thread, running back to a spool.
  const needle = new THREE.Group()
  {
    const steel = new THREE.MeshStandardMaterial({ color: '#dfe2e4', roughness: 0.22, metalness: 0.8 })
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0016, 0.07, 6), steel)
    shaft.position.y = 0.035
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0009, 0.008, 6), steel)
    tip.rotation.x = Math.PI
    tip.position.y = -0.004
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.0007, 4, 10), steel)
    eye.position.y = 0.068
    needle.add(shaft, tip, eye)
    needle.name = 'workshop needle'
    group.add(needle)
  }
  const threadColour = '#c4553f'
  const threadMat = mat(threadColour, 0.9)
  const reel = spool(threadColour, 0.02, 0.046)
  reel.group.position.set(-0.1, y, -0.17)
  group.add(reel.group)
  const reelTop = new THREE.Vector3(-0.1, y + 0.03, -0.17)
  const thread = new THREE.Mesh(new THREE.BufferGeometry(), threadMat)
  thread.name = 'workshop thread'
  group.add(thread)

  // A felt scrap the needle works on while waiting.
  const scrap = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.004, 0.1, 2, 0.002), new THREE.MeshStandardMaterial({ color: '#ffffff', map: feltTexture('#e7d7b8', 21, { band: true }), roughness: 1 }))
  scrap.position.set(MAT.x + 0.22, y + 0.009, MAT.z - 0.06)
  scrap.rotation.y = -0.2
  group.add(shadowed(scrap))

  let state: 'idle' | 'working' | 'tidy' = 'idle'
  let since = 0
  let cut = 0
  let passing: { from: THREE.Vector3; to: THREE.Vector3; u: number; seconds: number; done: () => void } | null = null
  const rest = new THREE.Vector3(MAT.x + 0.26, y + 0.012, MAT.z - 0.04)
  const eyeAt = new THREE.Vector3()
  const mid = new THREE.Vector3()
  let tick = -1

  const rethread = () => {
    needle.updateMatrixWorld(true)
    eyeAt.set(0, 0.068, 0).applyMatrix4(needle.matrixWorld).sub(group.position)
    mid.lerpVectors(eyeAt, reelTop, 0.5)
    mid.y = Math.max(eyeAt.y, reelTop.y) + 0.035
    const curve = new THREE.QuadraticBezierCurve3(eyeAt.clone(), mid.clone(), reelTop)
    thread.geometry.dispose()
    thread.geometry = new THREE.TubeGeometry(curve, 24, 0.0011, 4, false)
  }

  const api: Workshop = {
    group,
    pattern(text, name = '', notes = []) {
      const old = sheetMat.map
      sheetMat.map = paintPattern(text, name, notes)
      sheetMat.needsUpdate = true
      old?.dispose()
    },
    activity(next) {
      state = next
      since = 0
      if (next !== 'working') {
        for (const p of pieces) p.visible = false
        cut = 0
      }
    },
    pass(at, span, seconds) {
      if (reducedMotion.matches) return Promise.resolve()
      passing?.done()
      return new Promise<void>((done) => {
        const from = at.clone().add(new THREE.Vector3(-span / 2, 0.02, 0.02))
        const to = at.clone().add(new THREE.Vector3(span / 2, 0.02, 0.02))
        passing = { from, to, u: 0, seconds, done }
      })
    },
    get cut() {
      return cut
    },
    frame(dt, t) {
      since += dt
      // On twos, like the villagers: twelve poses a second.
      const k = Math.floor(t * 12)
      const fresh = k !== tick
      tick = k
      const tt = k / 12
      const still = reducedMotion.matches
      if (passing) {
        passing.u = Math.min(1, passing.u + dt / passing.seconds)
        const u = passing.u
        const p = new THREE.Vector3().lerpVectors(passing.from, passing.to, u)
        // Dip in and out of the felt twice on the way across.
        p.y += -Math.abs(Math.sin(u * Math.PI * 2)) * 0.03 + 0.01
        needle.position.copy(p)
        needle.rotation.set(0.5, 0, -0.9 + u * 0.3)
        rethread()
        if (u >= 1) {
          const { done } = passing
          passing = null
          done()
        }
        return
      }
      if (state === 'working' && !still) {
        if (fresh) {
          // The needle goes down through the scrap and up again, a stitch about every 0.9 s.
          const c = (tt % 0.9) / 0.9
          const along = Math.floor(tt / 0.9) % 6
          needle.position.set(scrap.position.x - 0.04 + along * 0.014, y + 0.012 + Math.max(-0.02, Math.cos(c * Math.PI * 2) * 0.03), scrap.position.z + 0.01)
          needle.rotation.set(0.35, 0, -0.25)
          rethread()
          // Scissors snip along.
          const open = 0.32 * (0.5 + 0.5 * Math.cos(tt * 7))
          blades[0].rotation.y = open / 2
          blades[1].rotation.y = -open / 2
          scissors.position.x = 0.06 + Math.sin(tt * 0.6) * 0.03
        }
        const due = Math.min(pieces.length, Math.floor(since / 4.5))
        while (cut < due) pieces[cut++].visible = true
      } else if (fresh || still) {
        needle.position.copy(rest)
        needle.rotation.set(Math.PI / 2 - 0.05, 0.3, 0)
        blades[0].rotation.y = 0.06
        blades[1].rotation.y = -0.06
        scissors.position.x = 0.06
        rethread()
      }
    },
    dispose() {
      thread.geometry.dispose()
    },
  }
  api.frame(0, 0)
  return api
}
