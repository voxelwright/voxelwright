import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { inputVariant } from '../talk/input'
import { own, replace } from '../kernel'
import { canvas, makeNoise, paintLinen, paintPageEdges, paintPaper, paintRibbon, rng, toTexture } from '../paint'
import { conversation, ME, say } from '../villager'
import { listSketches, sketchImage } from '../talk/sketch'

// The richer kitchen notebook (#42 prototype), only with ?talk=notebook. The
// table's notebook steps aside (notebook.ts returns early on the same flag and
// this plugin hides the table's book) and this one takes its place: a closed
// linen book that opens when chosen, a ribbon per villager, paper tabs for
// Talk and Tasks, and real page turns. Everything is painted on the paper; the
// only DOM is one off-screen input and one polite live region.

type RGB = [number, number, number]
type Section = 'talk' | 'tasks' | 'sketches'
type Mark = 'sprig' | 'sun' | 'moon'
interface Villager { id: string; name: string; awake: boolean; ribbon: RGB; mark: Mark }

// Synthetic people until family isolation is proven (AGENTS.md). Only alex has
// a villager on the host; June and Bram are painted placeholders that say so.
const query = new URLSearchParams(location.search)
/** With the always-on input (?talk=npc, held or speech, #42) this book is the journal: one ribbon per villager in the room, all awake. */
const JOURNAL = inputVariant(query) !== null
const VILLAGERS: Villager[] = JOURNAL ? [
  { id: 'alex', name: 'Dumpling', awake: true, ribbon: [178, 74, 54], mark: 'sprig' },
  { id: 'sam', name: 'Tuft', awake: true, ribbon: [196, 146, 40], mark: 'sun' },
  { id: 'mia', name: 'Moss', awake: true, ribbon: [112, 86, 160], mark: 'moon' },
] : [
  { id: 'alex', name: 'Alex', awake: true, ribbon: [46, 96, 66], mark: 'sprig' },
  { id: 'june', name: 'June', awake: false, ribbon: [190, 138, 44], mark: 'sun' },
  { id: 'bram', name: 'Bram', awake: false, ribbon: [64, 82, 138], mark: 'moon' },
]
// Synthetic sample tasks. Nothing reads or writes them but this page.
const TASKS: Record<string, { id: string; text: string }[]> = {
  alex: [
    { id: 'fern', text: 'Water the fern by the window' },
    { id: 'books', text: 'Return the library books' },
    { id: 'flour', text: 'Flour, eggs and lemons' },
    { id: 'tap', text: 'Ask about the dripping tap' },
    { id: 'pancakes', text: 'Pancakes on Saturday' },
    { id: 'gran', text: 'Call Gran on Sunday' },
  ],
}

const TASKS_KEY = 'village.talk.tasks'
const UNSENT_KEY = 'village.talk.unsent'
const AT_KEY = 'village.talk.at'
const LEARNED_KEY = 'village.talk.learned'

// Book-local metres; the book is scaled like the table's (1.3).
const W = 0.29, D = 0.4, BLOCK = 0.011, BOARD = 0.0035
// Page canvases: rules every ROW px from TOP; text sits just above a rule.
const PW = 1024, PH = 1412, TOP = 200, ROW = 70, ROWS = 15
const baseline = (row: number) => TOP + ROW * (row + 1) - 8
const PERSON_HAND = 'italic 58px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const VILLAGER_HAND = '600 italic 56px "Snell Roundhand", "Apple Chancery", "Segoe Script", cursive'
const PENCIL = '42px "Bradley Hand", "Segoe Print", cursive'
const SMALL_PENCIL = '34px "Bradley Hand", "Segoe Print", cursive'
const INK = 'rgba(28, 44, 100, 0.95)'
const VILLAGER_INK = 'rgba(30, 80, 50, 0.96)'
const PENCIL_INK = 'rgba(74, 68, 62, 0.88)'
const WRITE_RATE = 32 // characters a second, so chunky arrivals still read as writing
const AWAY = 'Alex\'s villager is out for a moment. Your line is kept here, not sent.'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

interface Said { from: 'person' | 'villager' | 'note'; text: string; unsent?: boolean; writing?: boolean }
interface Row { text: string; font: string; ink: string; x: number; nib?: boolean }

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const rgb = (c: RGB, k: number) => new THREE.Color().setRGB(...(c.map((v) => Math.min(1, (v * k) / 255)) as RGB), THREE.SRGBColorSpace)
const tint = (c: RGB, k: number, a = 1) => `rgba(${c.map((v) => Math.round(Math.min(255, v * k))).join(',')},${a})`

/** A villager's mark in watercolour: a wash, then the ink drawing. */
function paintMark(g: CanvasRenderingContext2D, mark: Mark, cx: number, cy: number, r: number, color: RGB, seed: number) {
  const rand = rng(seed)
  g.save()
  for (let i = 0; i < 7; i++) {
    g.fillStyle = tint(color, 1.35, 0.09)
    g.beginPath()
    g.ellipse(cx + (rand() - 0.5) * r * 0.2, cy + (rand() - 0.5) * r * 0.2, r * (0.86 + rand() * 0.16), r * (0.82 + rand() * 0.16), rand() * 3, 0, Math.PI * 2)
    g.fill()
  }
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const ink = tint(color, 0.7, 0.9)
  const wash = tint(color, 1.15, 0.55)
  if (mark === 'sprig') {
    g.strokeStyle = ink
    g.lineWidth = r * 0.05
    g.beginPath()
    g.moveTo(cx - r * 0.1, cy + r * 0.7)
    g.quadraticCurveTo(cx - r * 0.05, cy, cx + r * 0.12, cy - r * 0.62)
    g.stroke()
    for (const [t, side] of [[0.2, -1], [0.35, 1], [0.5, -1], [0.65, 1], [0.82, -1]] as const) {
      const x = cx - r * 0.1 + t * r * 0.22, y = cy + r * 0.7 - t * r * 1.32
      g.save()
      g.translate(x, y)
      g.rotate(side * 0.9 - 0.2)
      g.fillStyle = wash
      g.beginPath()
      g.ellipse(side * r * 0.2, 0, r * 0.22, r * 0.09, 0, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = ink
      g.lineWidth = r * 0.02
      g.stroke()
      g.restore()
    }
  } else if (mark === 'sun') {
    g.fillStyle = wash
    g.beginPath()
    g.arc(cx, cy, r * 0.36, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = ink
    g.lineWidth = r * 0.04
    g.stroke()
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.1
      const l = i % 2 ? 0.66 : 0.76
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * r * 0.48, cy + Math.sin(a) * r * 0.48)
      g.lineTo(cx + Math.cos(a) * r * l, cy + Math.sin(a) * r * l)
      g.stroke()
    }
  } else {
    g.fillStyle = wash
    g.beginPath()
    g.arc(cx - r * 0.06, cy, r * 0.5, Math.PI * 0.32, Math.PI * 1.68)
    g.arc(cx + r * 0.16, cy - r * 0.08, r * 0.42, Math.PI * 1.5, Math.PI * 0.5, true)
    g.closePath()
    g.fill()
    g.strokeStyle = ink
    g.lineWidth = r * 0.035
    g.stroke()
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2
      const l = i % 2 ? r * 0.06 : r * 0.15
      g.lineTo(cx + r * 0.5 + Math.cos(a) * l, cy - r * 0.38 + Math.sin(a) * l)
    }
    g.closePath()
    g.fillStyle = ink
    g.fill()
  }
  g.restore()
}

/** A pressed flower taped onto the page: flattened petals, a stem, two strips of paper tape. */
function paintPressedFlower(g: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  const rand = rng(seed)
  g.save()
  g.strokeStyle = 'rgba(96, 112, 64, 0.75)'
  g.lineWidth = 6
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(cx, cy + 40)
  g.bezierCurveTo(cx + 20, cy + 140, cx - 30, cy + 220, cx + 10, cy + 320)
  g.stroke()
  for (const [y, side] of [[150, -1], [230, 1]] as const) {
    g.save()
    g.translate(cx + side * 6, cy + y)
    g.rotate(side * 0.7)
    g.fillStyle = 'rgba(120, 136, 76, 0.55)'
    g.beginPath()
    g.ellipse(side * 44, 0, 52, 16, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.2
    g.save()
    g.translate(cx, cy)
    g.rotate(a)
    g.fillStyle = `rgba(${196 + rand() * 20}, ${150 + rand() * 20}, ${196 + rand() * 20}, 0.5)`
    g.beginPath()
    g.ellipse(0, -52, 22 + rand() * 6, 50, 0, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(140, 96, 120, 0.35)'
    g.lineWidth = 2
    g.stroke()
    g.restore()
  }
  g.fillStyle = 'rgba(214, 168, 70, 0.85)'
  g.beginPath()
  g.arc(cx, cy, 20, 0, Math.PI * 2)
  g.fill()
  for (let i = 0; i < 24; i++) {
    g.fillStyle = 'rgba(150, 100, 40, 0.5)'
    g.fillRect(cx + (rand() - 0.5) * 30, cy + (rand() - 0.5) * 30, 3, 3)
  }
  for (const [x, y, a] of [[cx - 10, cy + 180, -0.35], [cx + 20, cy + 300, 0.25]] as const) {
    g.save()
    g.translate(x, y)
    g.rotate(a)
    g.fillStyle = 'rgba(226, 190, 168, 0.6)'
    g.beginPath()
    g.moveTo(-90, -22)
    for (let k = 0; k <= 6; k++) g.lineTo(-90 + k * 30, -22 + (k % 2 ? 4 : 0))
    for (let k = 6; k >= 0; k--) g.lineTo(90 - (6 - k) * 30, 22 - (k % 2 ? 4 : 0))
    g.closePath()
    g.fill()
    g.restore()
  }
  g.restore()
}

/** Write a line in ink that bleeds a little into the paper. */
function inkText(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, ink: string, maxWidth?: number) {
  g.font = font
  g.fillStyle = ink
  g.shadowColor = ink.replace(/[\d.]+\)$/, '0.35)')
  g.shadowBlur = 2.5
  g.fillText(text, x, y, maxWidth)
  g.shadowBlur = 0
}

const measure = canvas(8, 8)[1]
function wrap(text: string, font: string, width: number): string[] {
  measure.font = font
  const rows: string[] = []
  for (const paragraph of text.split('\n')) {
    let row = ''
    for (const word of paragraph.split(' ')) {
      const next = row ? `${row} ${word}` : word
      if (row && measure.measureText(next).width > width) {
        rows.push(row)
        row = word
      } else row = next
    }
    rows.push(row)
  }
  return rows
}

/** A page that dips into the gutter and lifts gently beside it. s is 0 at the spine, 1 at the outer edge. */
const lift = (s: number) => Math.sin((Math.min(s, 0.35) / 0.35) * Math.PI / 2) * 0.0068 - s * 0.0034 - (1 - Math.min(s * 8, 1)) * 0.003

function pageGeometry(side: 1 | -1) {
  const g = new THREE.PlaneGeometry(W, D, 28, 1)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (side * W) / 2
    pos.setXYZ(i, x, lift(Math.abs(x) / W), -pos.getY(i))
  }
  g.computeVertexNormals()
  return g
}

function boxWith(w: number, h: number, d: number, materials: THREE.Material[]) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials)
}

export default {
  name: 'talkbook',
  inject: ['stage', 'view', 'entries'],
  apply(ctx: Context) {
    if (query.get('talk') !== 'notebook' && !JOURNAL) return
    const { scene, camera, renderer } = ctx.stage
    const { view, entries } = ctx
    const phys = ctx.stage.features().has('phys')

    // Where we are in the book, remembered between visits.
    const saved = readJson<{ villager?: string; section?: Section }>(AT_KEY, {})
    let vi = Math.max(0, VILLAGERS.findIndex((v) => v.id === saved.villager))
    let section: Section = saved.section === 'tasks' ? 'tasks' : saved.section === 'sketches' && JOURNAL ? 'sketches' : 'talk'
    let spread = -1 // talk spreads: -1 follows the latest
    const ticked = readJson<Record<string, boolean>>(TASKS_KEY, {})
    const unsent = readJson<{ person: string; text: string }[]>(UNSENT_KEY, [])
    /** What was said, per villager. */
    const saidBy = new Map<string, Said[]>()
    const saidOf = (id: string) => saidBy.get(id) ?? saidBy.set(id, []).get(id)!
    let hostAway = false
    let draft = ''
    let caretOn = true
    let open = false
    let openness = 0
    let focus = -1 // index into controls(), -1 is the pen on the page
    let talking = false
    let writing: Said | null = null
    let shown = 0
    let pen = 0
    let dirty = true
    let learned = readJson<boolean>(LEARNED_KEY, false)
    const learn = () => {
      if (learned) return
      learned = true
      writeJson(LEARNED_KEY, true)
    }

    // ---- materials and the book ----
    const linen = toTexture(paintLinen(42, [126, 62, 44]), { repeat: [3, 3] })
    const linenMat = new THREE.MeshStandardMaterial({ map: linen, roughness: 0.92 })
    const [labelCanvas, lg] = canvas(512, 512)
    lg.drawImage(paintLinen(43, [126, 62, 44]), 0, 0)
    {
      // A paper label pasted on the cover: "Kitchen notebook".
      lg.save()
      // The board is flipped over the spine when closed, so the label is drawn upside down.
      lg.translate(256, 300)
      lg.rotate(Math.PI)
      lg.fillStyle = 'rgba(60, 24, 14, 0.25)'
      lg.fillRect(-196, -86, 400, 184)
      lg.fillStyle = '#efe3c8'
      lg.fillRect(-200, -92, 396, 180)
      lg.strokeStyle = 'rgba(126, 62, 44, 0.7)'
      lg.lineWidth = 4
      lg.strokeRect(-186, -78, 368, 152)
      lg.textAlign = 'center'
      inkText(lg, 'Kitchen', -2, -10, 'italic 600 70px "Snell Roundhand", "Apple Chancery", cursive', 'rgba(60, 30, 22, 0.95)')
      inkText(lg, 'notebook', -2, 52, 'italic 600 58px "Bradley Hand", cursive', 'rgba(60, 30, 22, 0.9)')
      lg.restore()
    }
    const coverTop = new THREE.MeshStandardMaterial({ map: toTexture(labelCanvas), roughness: 0.9 })
    const edges = new THREE.MeshStandardMaterial({ map: toTexture(paintPageEdges(44)), roughness: 0.95 })
    const edgesAcross = new THREE.MeshStandardMaterial({ map: toTexture(paintPageEdges(45)), roughness: 0.95 })
    edgesAcross.map!.rotation = Math.PI / 2
    edgesAcross.map!.center.set(0.5, 0.5)
    const plain = new THREE.MeshStandardMaterial({ color: '#cfc3ad', roughness: 1 })

    const paperL = paintPaper(201, -1, PW, PH, TOP, ROW)
    const paperR = paintPaper(202, 1, PW, PH, TOP, ROW)
    const [leftCanvas] = canvas(PW, PH)
    const [rightCanvas] = canvas(PW, PH)
    const leftTex = toTexture(leftCanvas)
    const rightTex = toTexture(rightCanvas)
    // Paper a shade under white, so the afternoon sun and bloom don't wash the ink out.
    const pageMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, color: '#e4d9c6', roughness: 1 })

    const book = new THREE.Group()
    book.name = 'talk notebook'
    const coverW = W + 0.012, coverD = D + 0.02
    // Right half: cover board, page block, the right page.
    const coverR = boxWith(coverW, BOARD, coverD, [linenMat, linenMat, linenMat, linenMat, linenMat, linenMat])
    coverR.position.set(coverW / 2 - 0.002, BOARD / 2, 0)
    // The block stops short of the spine, where the pages dip into the gutter, so its top never shows.
    const GUTTER = 0.04
    const blockR = boxWith(W - GUTTER, BLOCK - BOARD, D - 0.004, [edges, plain, plain, plain, edgesAcross, edgesAcross])
    blockR.position.set(GUTTER + (W - GUTTER) / 2, BOARD + (BLOCK - BOARD) / 2, 0)
    const rightPage = new THREE.Mesh(pageGeometry(1), pageMat(rightTex))
    rightPage.name = 'talk right page'
    rightPage.position.y = BLOCK + 0.0003
    book.add(coverR, blockR, rightPage)
    // Left half pivots at the spine, so it can close over the right.
    const leftHalf = new THREE.Group()
    leftHalf.name = 'talk left half'
    leftHalf.position.y = BLOCK
    leftHalf.rotation.z = -Math.PI // closed until chosen
    const coverL = boxWith(coverW, BOARD, coverD, [linenMat, linenMat, linenMat, coverTop, linenMat, linenMat])
    coverL.position.set(-coverW / 2 + 0.002, BOARD / 2 - BLOCK, 0)
    const blockL = boxWith(W - GUTTER, BLOCK - BOARD, D - 0.004, [plain, edges, plain, plain, edgesAcross, edgesAcross])
    blockL.position.set(-GUTTER - (W - GUTTER) / 2, BOARD + (BLOCK - BOARD) / 2 - BLOCK, 0)
    const leftPage = new THREE.Mesh(pageGeometry(-1), pageMat(leftTex))
    leftPage.name = 'talk left page'
    leftPage.position.y = 0.0003
    leftHalf.add(coverL, blockL, leftPage)
    book.add(leftHalf)
    // A cloth spine joining the covers, seen while the book is closed or turning.
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(BLOCK + BOARD / 2, BLOCK + BOARD / 2, coverD, 16, 1, true, Math.PI, Math.PI), linenMat)
    spine.rotation.x = Math.PI / 2
    spine.position.set(-0.001, BLOCK, 0)
    book.add(spine)

    // Turning sheets: half-resolution paper that carries the old and new page while it turns.
    const SW = 512, SH = 706
    const [blankSheet, bg] = canvas(SW, SH)
    bg.drawImage(paperR, 0, 0, SW, SH)
    const blankTex = toTexture(blankSheet)
    const sheetFronts = [0, 1, 2, 3].map(() => canvas(SW, SH)[0])
    const sheetBacks = [0, 1, 2, 3].map(() => canvas(SW, SH)[0])
    const sheetGeoBase = new THREE.PlaneGeometry(W, D, 28, 6)
    const sheets = [0, 1, 2, 3].map((k) => {
      const geo = sheetGeoBase.clone()
      const frontTex = toTexture(sheetFronts[k])
      const backTex = toTexture(sheetBacks[k])
      const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: frontTex, color: '#e4d9c6', roughness: 1, side: THREE.FrontSide }))
      const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: backTex, color: '#e4d9c6', roughness: 1, side: THREE.BackSide }))
      const group = new THREE.Group()
      group.name = `talk sheet ${k}`
      group.add(front, back)
      group.visible = false
      group.position.y = BLOCK + 0.0009 + k * 0.0004
      book.add(group)
      return { group, geo, front, back, frontTex, backTex, theta: 0 }
    })
    const base = sheetGeoBase.attributes.position as THREE.BufferAttribute
    const bendSheet = (sheet: (typeof sheets)[number], theta: number) => {
      const pos = sheet.geo.attributes.position as THREE.BufferAttribute
      const cols = 29, rowsZ = 7
      for (let r = 0; r < rowsZ; r++) {
        const zIndex = r * cols
        const z = -base.getY(zIndex)
        const near = z / D + 0.5 // 1 at the near edge, where a hand lifts the corner
        // The outer edge curls ahead of the spine side, the near corner most, as when a hand turns it.
        const lead = Math.sin(theta) * 0.8 * (0.6 + 0.8 * near)
        let x = 0, y = 0
        for (let c = 0; c < cols; c++) {
          const s = c / (cols - 1)
          if (c > 0) {
            const phi = theta + lead * Math.pow(s, 1.5)
            const ds = W / (cols - 1)
            x += Math.cos(phi) * ds
            y += Math.sin(phi) * ds
          }
          pos.setXYZ(zIndex + c, x, Math.max(0, y) + lift(s) * Math.cos(theta) ** 2, z)
        }
      }
      pos.needsUpdate = true
      sheet.geo.computeVertexNormals()
    }

    // Ribbons: one per villager, from between the pages over the near edge onto the table, each ending in a sewn tag.
    const ribbons = VILLAGERS.map((v, i) => {
      const fan = (i - 1) * 0.085
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.012, BLOCK * 0.7, D / 2 - 0.02),
        new THREE.Vector3(0.012 + fan * 0.05, BLOCK * 0.55, D / 2 + 0.004),
        new THREE.Vector3(0.012 + fan * 0.25, 0.0006, D / 2 + 0.018),
        new THREE.Vector3(0.012 + fan * 0.7, -0.0006, D / 2 + 0.04),
        new THREE.Vector3(0.012 + fan, -0.0007, D / 2 + 0.06),
      ])
      const pts = curve.getPoints(48)
      const dir = new THREE.Vector3().subVectors(pts.at(-1)!, pts[0]).setY(0).normalize()
      const sideV = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(0.0085)
      const positions: number[] = [], uvs: number[] = [], index: number[] = []
      pts.forEach((p, k) => {
        positions.push(p.x - sideV.x, p.y + 0.0004 * (i % 2), p.z - sideV.z, p.x + sideV.x, p.y + 0.0004 * (i % 2), p.z + sideV.z)
        uvs.push(0, k / 48, 1, k / 48)
        if (k) index.push(2 * k - 2, 2 * k - 1, 2 * k, 2 * k - 1, 2 * k + 1, 2 * k)
      })
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geo.setIndex(index)
      geo.computeVertexNormals()
      const cloth = toTexture(paintRibbon(300 + i, v.ribbon))
      const ribbonMat = phys
        ? new THREE.MeshPhysicalMaterial({ map: cloth, roughness: 0.62, sheen: 0.8, sheenColor: rgb(v.ribbon, 1.8), sheenRoughness: 0.4, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.6, side: THREE.DoubleSide })
      const strip = new THREE.Mesh(geo, ribbonMat)
      strip.name = `talk ribbon ${v.id}`
      // The tag: cream cotton sewn on the end, with the villager's mark and name.
      const [tc, tg] = canvas(256, 320)
      const n = makeNoise(500 + i, 32)
      const img = tg.createImageData(256, 320)
      for (let p = 0; p < 256 * 320; p++) {
        const x = p % 256, y = Math.floor(p / 256)
        const t = 0.93 + (n(x / 10, y / 10, 3) - 0.5) * 0.08 + (((x + y) & 3) === 0 ? -0.025 : 0)
        img.data.set([248 * t, 240 * t, 222 * t, 255], p * 4)
      }
      tg.putImageData(img, 0, 0)
      tg.setLineDash([10, 8])
      tg.strokeStyle = tint(v.ribbon, 0.9, 0.85)
      tg.lineWidth = 5
      tg.strokeRect(16, 16, 224, 288)
      paintMark(tg, v.mark, 128, 122, 78, v.ribbon, 600 + i)
      tg.textAlign = 'center'
      inkText(tg, v.name, 128, 270, 'italic 68px "Snell Roundhand", "Apple Chancery", cursive', tint(v.ribbon, 0.55, 0.95))
      const tagFace = new THREE.MeshStandardMaterial({ map: toTexture(tc), color: '#e8ddcb', roughness: 0.95 })
      const tagSide = new THREE.MeshStandardMaterial({ color: rgb(v.ribbon, 1), roughness: 0.8 })
      const tag = boxWith(0.05, 0.0016, 0.0625, [tagSide, tagSide, tagFace, tagSide, tagSide, tagSide])
      tag.name = `talk tag ${v.id}`
      const end = pts.at(-1)!
      tag.position.set(end.x + dir.x * 0.026, -0.0002 + 0.0004 * (i % 2), end.z + dir.z * 0.026)
      tag.rotation.y = Math.atan2(dir.x, dir.z)
      const group = new THREE.Group()
      group.add(strip, tag)
      book.add(group)
      // The chosen villager's ribbon also lies down the gutter of the open spread: you are at their bookmark.
      const markerGeo = new THREE.PlaneGeometry(0.011, D - 0.014, 6, 1)
      const mp = markerGeo.attributes.position as THREE.BufferAttribute
      for (let k = 0; k < mp.count; k++) {
        const x = mp.getX(k) + 0.0085
        mp.setXYZ(k, x, BLOCK + 0.0011 + lift(x / W), -mp.getY(k))
      }
      markerGeo.computeVertexNormals()
      const marker = new THREE.Mesh(markerGeo, ribbonMat)
      marker.name = `talk bookmark ${v.id}`
      marker.position.z = 0.006
      marker.visible = false
      book.add(marker)
      return { group, strip, tag, marker, materials: [ribbonMat, tagFace, tagSide] as THREE.MeshStandardMaterial[], lifted: 0 }
    })

    // Paper index tabs on the right page's fore-edge.
    const SECTIONS: { id: Section; label: string }[] = [{ id: 'talk', label: 'Talk' }, { id: 'tasks', label: 'Tasks' }, ...(JOURNAL ? [{ id: 'sketches' as const, label: 'Sketches' }] : [])]
    const tabs = SECTIONS.map((s, i) => {
      const [c, g] = canvas(256, 160)
      g.drawImage(paperR, 300, 300, 256, 160, 0, 0, 256, 160)
      g.textAlign = 'center'
      inkText(g, s.label, 168, 104, 'italic 600 66px "Bradley Hand", "Segoe Print", cursive', 'rgba(36, 28, 22, 0.95)', 170)
      const face = new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.9 })
      const edge = new THREE.MeshStandardMaterial({ color: '#e6d6b6', roughness: 0.9 })
      const tab = boxWith(0.058, 0.0007, 0.075, [edge, edge, face, edge, edge, edge])
      tab.name = `talk tab ${s.id}`
      tab.position.set(W + 0.012, BLOCK - 0.0012 - i * 0.0006, -0.13 + i * 0.085)
      book.add(tab)
      return { tab, face, edge }
    })

    // ---- what is on the pages ----
    const v = () => VILLAGERS[vi]
    const tasks = () => TASKS[v().id] ?? []

    const talkRows = (): Row[] => {
      const rows: Row[] = []
      const width = PW - 220
      for (const line of saidOf(v().id)) {
        if (line.from === 'person') {
          for (const text of wrap(line.text, PERSON_HAND, width)) rows.push({ text, font: PERSON_HAND, ink: INK, x: 120 })
          if (line.unsent) rows.push({ text: 'kept here, not sent', font: SMALL_PENCIL, ink: PENCIL_INK, x: 600 })
        } else {
          const text = line === writing ? line.text.slice(0, shown) : line.text
          const font = line.from === 'villager' ? VILLAGER_HAND : PENCIL
          const ink = line.from === 'villager' ? VILLAGER_INK : PENCIL_INK
          const wrapped = text ? wrap(text, font, width - 40) : ['…']
          for (const t of wrapped) rows.push({ text: t, font, ink, x: 160 })
          rows.push({ text: '', font, ink, x: 160 })
        }
      }
      if (v().awake) rows.push({ text: draft, font: PERSON_HAND, ink: INK, x: 120, nib: open && focus < 0 })
      return rows
    }
    // Page 0 is the first right-hand page; spread s shows pages 2s-1 (left) and 2s (right).
    const talkPages = () => {
      const rows = talkRows()
      const pages: Row[][] = []
      for (let i = 0; i < Math.max(rows.length, 1); i += ROWS) pages.push(rows.slice(i, i + ROWS))
      return pages
    }
    const latestSpread = () => Math.ceil((talkPages().length - 1) / 2)
    const currentSpread = () => (spread < 0 ? latestSpread() : Math.min(spread, latestSpread()))

    type PageView = { kind: 'card' } | { kind: 'talk'; page: number; spread: number; last: number } | { kind: 'tasks' } | { kind: 'sketches' } | { kind: 'asleep' }
    const leftView = (): PageView => {
      if (section !== 'talk' || !v().awake) return { kind: 'card' }
      const s = currentSpread()
      return s === 0 ? { kind: 'card' } : { kind: 'talk', page: 2 * s - 1, spread: s, last: latestSpread() }
    }
    const rightView = (): PageView => {
      if (!v().awake) return { kind: 'asleep' }
      if (section === 'tasks') return { kind: 'tasks' }
      if (section === 'sketches') return { kind: 'sketches' }
      const s = currentSpread()
      return { kind: 'talk', page: 2 * s, spread: s, last: latestSpread() }
    }

    /** A page title in the person's hand with a wavy underline, the same on every section. */
    const title = (g: CanvasRenderingContext2D, text: string) => {
      g.textAlign = 'left'
      inkText(g, text, 120, 160, 'italic 600 80px "Bradley Hand", "Segoe Print", cursive', INK)
      measure.font = 'italic 600 80px "Bradley Hand", "Segoe Print", cursive'
      const end = 130 + measure.measureText(text).width
      g.strokeStyle = 'rgba(28, 44, 100, 0.45)'
      g.lineWidth = 3
      g.beginPath()
      for (let x = 120; x < end; x += 8) g.lineTo(x, 180 + Math.sin(x / 14) * 3)
      g.stroke()
    }

    const paintCard = (g: CanvasRenderingContext2D) => {
      const who = v()
      g.textAlign = 'center'
      paintMark(g, who.mark, 470, 420, 170, who.ribbon, 700 + vi)
      inkText(g, who.name, 470, 720, 'italic 120px "Snell Roundhand", "Apple Chancery", cursive', tint(who.ribbon, 0.6, 0.92))
      inkText(g, JOURNAL ? `${({ alex: 'Alex', sam: 'Sam', mia: 'Mia' } as Record<string, string>)[who.id] ?? ''}'s villager` : `${who.name}'s villager`, 470, 800, PENCIL, PENCIL_INK)
      if (who.awake) {
        inkText(g, 'Write on the right-hand page.', 470, 920, PENCIL, PENCIL_INK)
        inkText(g, 'Answers come back in green ink.', 470, 972, PENCIL, PENCIL_INK)
      } else {
        inkText(g, 'Not awake yet.', 470, 920, PENCIL, PENCIL_INK)
        inkText(g, 'Nothing on these pages is sent.', 470, 972, PENCIL, PENCIL_INK)
      }
      // A pencilled reminder of the keys, rubbed out once someone has used them.
      if (!learned) {
        inkText(g, '← → another villager   ↑ ↓ talk or tasks', 470, 1260, SMALL_PENCIL, 'rgba(86, 80, 74, 0.6)')
        inkText(g, 'PgUp PgDn earlier pages   Esc close the book', 470, 1306, SMALL_PENCIL, 'rgba(86, 80, 74, 0.6)')
      }
    }

    const paintTalk = (g: CanvasRenderingContext2D, side: 'left' | 'right', p: Extract<PageView, { kind: 'talk' }>) => {
      const page = talkPages()[p.page] ?? []
      g.textAlign = 'left'
      if (p.page === 0) title(g, 'Talk')
      else inkText(g, `Talk · ${v().name}'s villager`, side === 'left' ? 110 : 120, 150, SMALL_PENCIL, 'rgba(86, 80, 74, 0.55)')
      if (p.page === 0 && hostAway && saidOf(v().id).length === 0) inkText(g, AWAY.split('.')[0] + '.', 160, baseline(0), PENCIL, PENCIL_INK)
      page.forEach((row, i) => {
        inkText(g, row.text, row.x, baseline(i), row.font, row.ink, PW - row.x - 60)
        if (row.nib && !row.text) {
          // An empty line waits for you: a faint pencilled guide where the next words go.
          g.strokeStyle = 'rgba(86, 80, 74, 0.35)'
          g.lineWidth = 2
          g.setLineDash([14, 10])
          g.beginPath()
          g.moveTo(row.x + 24, baseline(i) + 4)
          g.lineTo(PW - 140, baseline(i) + 4)
          g.stroke()
          g.setLineDash([])
        }
        if (row.nib) {
          // The pen rests where the next word goes, with a little ink pooling at its tip.
          measure.font = row.font
          const x = row.x + Math.min(measure.measureText(row.text).width, PW - row.x - 60) + (row.text ? 14 : 0), y = baseline(i)
          g.fillStyle = `rgba(28, 44, 100, ${caretOn ? 0.55 : 0.3})`
          g.beginPath()
          g.ellipse(x + 2, y - 2, 5, 3.5, 0, 0, Math.PI * 2)
          g.fill()
          g.save()
          g.translate(x, y - 4)
          g.rotate(-0.75)
          g.fillStyle = 'rgba(70, 64, 60, 0.8)'
          g.beginPath()
          g.moveTo(0, 0)
          g.lineTo(-9, -34)
          g.quadraticCurveTo(0, -42, 9, -34)
          g.closePath()
          g.fill()
          g.strokeStyle = 'rgba(240, 230, 210, 0.8)'
          g.lineWidth = 1.5
          g.beginPath()
          g.moveTo(0, -4)
          g.lineTo(0, -26)
          g.stroke()
          g.restore()
        }
      })
      g.textAlign = 'center'
      inkText(g, String(p.page + 1), side === 'left' ? 140 : PW - 140, PH - 46, SMALL_PENCIL, 'rgba(86, 80, 74, 0.55)')
      if (side === 'left' && p.spread > 0) inkText(g, '↩ earlier', 470, PH - 46, SMALL_PENCIL, 'rgba(86, 80, 74, 0.7)')
      if (side === 'right' && p.spread < p.last) inkText(g, 'later ↪', 560, PH - 46, SMALL_PENCIL, 'rgba(86, 80, 74, 0.7)')
    }

    const taskTop = 1
    const paintTasks = (g: CanvasRenderingContext2D) => {
      g.textAlign = 'left'
      title(g, 'Tasks')
      const r = rng(900)
      tasks().forEach((task, i) => {
        const y = baseline(taskTop + i)
        const done = Boolean(ticked[`${v().id}.${task.id}`])
        // A hand-drawn box.
        g.strokeStyle = 'rgba(28, 44, 100, 0.8)'
        g.lineCap = 'round'
        const bx = 114, by = y - 42, s = 42
        for (let pass = 0; pass < 2; pass++) {
          g.lineWidth = pass ? 2 : 3.5
          g.beginPath()
          g.moveTo(bx + r() * 4 - 2, by + r() * 4 - 3)
          g.lineTo(bx + s + r() * 4, by + r() * 4 - 1)
          g.lineTo(bx + s + r() * 4 - 1, by + s + r() * 4)
          g.lineTo(bx + r() * 4 - 1, by + s + r() * 4 - 1)
          g.lineTo(bx + r() * 4 - 1, by + r() * 4 + 2)
          g.stroke()
        }
        if (done) {
          g.strokeStyle = 'rgba(40, 88, 60, 0.9)'
          g.lineWidth = 6
          g.lineCap = 'round'
          g.beginPath()
          g.moveTo(bx + 6, by + 18)
          g.lineTo(bx + 17, by + 34)
          g.lineTo(bx + s + 10, by - 12)
          g.stroke()
        }
        inkText(g, task.text, 190, y, PERSON_HAND, done ? 'rgba(36, 54, 108, 0.45)' : INK, PW - 260)
        if (done) {
          measure.font = PERSON_HAND
          const wdt = Math.min(measure.measureText(task.text).width, PW - 260)
          g.strokeStyle = 'rgba(36, 54, 108, 0.5)'
          g.lineWidth = 3
          g.beginPath()
          g.moveTo(186, y - 16)
          g.quadraticCurveTo(190 + wdt / 2, y - 22, 194 + wdt, y - 15)
          g.stroke()
        }
        const chosen = focus >= 0 ? controls()[focus] : null
        if (chosen?.kind === 'task' && chosen.index === i) {
          g.strokeStyle = 'rgba(150, 80, 34, 0.8)'
          g.lineWidth = 5
          g.beginPath()
          g.ellipse(PW / 2 + 20, y - 18, PW / 2 - 70, 36, -0.01, 0, Math.PI * 2)
          g.stroke()
        }
      })
      g.textAlign = 'left'
      inkText(g, 'A sample list for now.', 120, PH - 120, SMALL_PENCIL, 'rgba(86, 80, 74, 0.6)')
    }

    // ---- sketches (#42, src/talk/sketch.ts): the person's drawings, kept on the host under them ----
    type Kept = { id: string; words?: string; given: string[]; made: string[]; img: ImageBitmap | null }
    let drawings: Kept[] = []
    const loadSketches = async () => {
      const list = await listSketches(ME)
      if (!list.ok) return
      const known = new Map(drawings.map((d) => [d.id, d.img]))
      drawings = await Promise.all(list.sketches.slice(0, 6).map(async (d) => ({ ...d, img: known.get(d.id) ?? await sketchImage(ME, d.id) })))
      dirty = true
    }
    /** Your drawings on your own ribbon; on a villager's, the ones you gave them. Pinned on the page like cuttings. */
    const paintSketches = (g: CanvasRenderingContext2D) => {
      g.textAlign = 'left'
      title(g, 'Sketches')
      const mine = v().id === ME
      const shown = drawings.filter((d) => mine || d.given.includes(v().id))
      if (!shown.length) {
        g.textAlign = 'center'
        inkText(g, mine ? 'Draw on your notepad: tap the pencil.' : `Nothing given to ${v().name} yet.`, PW / 2, 420, PENCIL, PENCIL_INK)
        return
      }
      const r = rng(1300)
      shown.forEach((d, i) => {
        const col = i % 2, row = Math.floor(i / 2)
        const w = 380, h = Math.round(w * 461 / 768)
        const x = 110 + col * 430, y = 250 + row * 380
        g.save()
        g.translate(x + w / 2, y + h / 2)
        g.rotate((r() - 0.5) * 0.06)
        g.fillStyle = 'rgba(80, 50, 20, 0.16)'
        g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h)
        g.fillStyle = '#fbf3e1'
        g.fillRect(-w / 2, -h / 2, w, h)
        if (d.img) g.drawImage(d.img, -w / 2, -h / 2, w, h)
        // A strip of tape across the top.
        g.fillStyle = 'rgba(230, 214, 170, 0.75)'
        g.fillRect(-46, -h / 2 - 14, 92, 28)
        g.restore()
        const what = d.made.length ? 'made into a piece' : d.given.length ? `given to ${d.given.map((id) => VILLAGERS.find((x) => x.id === id)?.name ?? id).join(', ')}` : ''
        g.textAlign = 'left'
        if (what) inkText(g, what, x + 4, y + h + 52, SMALL_PENCIL, PENCIL_INK, w)
      })
    }

    const paintAsleep = (g: CanvasRenderingContext2D) => {
      const who = v()
      paintPressedFlower(g, 520, 380, 800 + vi)
      g.textAlign = 'center'
      const lines = section === 'talk'
        ? [`${who.name}'s villager`, 'is not awake yet.', '', 'When they wake,', 'you can write to them here.']
        : ['No tasks yet.', '', `They come when ${who.name}'s`, 'villager wakes.']
      lines.forEach((t, i) => inkText(g, t, 520, 860 + i * 60, 'italic 46px "Bradley Hand", "Segoe Print", cursive', PENCIL_INK))
    }

    const paintPage = (side: 'left' | 'right', target: HTMLCanvasElement) => {
      const g = target.getContext('2d')!
      g.save()
      g.scale(target.width / PW, target.height / PH)
      g.drawImage(side === 'left' ? paperL : paperR, 0, 0)
      const pv = side === 'left' ? leftView() : rightView()
      if (pv.kind === 'card') paintCard(g)
      else if (pv.kind === 'talk') paintTalk(g, side, pv)
      else if (pv.kind === 'tasks') paintTasks(g)
      else if (pv.kind === 'sketches') paintSketches(g)
      else paintAsleep(g)
      g.restore()
    }

    // ---- page turns ----
    let held: 'left' | 'right' | null = null
    let turn: { dir: 1 | -1; t: number; n: number } | null = null
    const TURN = 0.42, STAGGER = 0.075
    const mirrorInto = (src: HTMLCanvasElement, dst: HTMLCanvasElement) => {
      const g = dst.getContext('2d')!
      g.save()
      g.setTransform(-1, 0, 0, 1, dst.width, 0)
      g.drawImage(src, 0, 0, dst.width, dst.height)
      g.restore()
    }
    const copyInto = (src: HTMLCanvasElement, dst: HTMLCanvasElement) => dst.getContext('2d')!.drawImage(src, 0, 0, dst.width, dst.height)
    const [scratch] = canvas(PW, PH)

    /** Change what the book shows; `change` mutates the view. Turns forward (1) or back (-1) through n sheets. */
    const turnTo = (change: () => void, dir: 1 | -1, n: number) => {
      const before = { left: leftView(), right: rightView(), vi, section }
      if (turn) finishTurn()
      const oldLeft = canvas(SW, SH)[0], oldRight = canvas(SW, SH)[0]
      copyInto(leftCanvas, oldLeft)
      copyInto(rightCanvas, oldRight)
      change()
      writeJson(AT_KEY, { villager: v().id, section })
      focus = -1
      if (JSON.stringify([before.left, before.right, before.vi, before.section]) === JSON.stringify([leftView(), rightView(), vi, section])) return
      if (open) ctx.emit('village/page', { leaves: n, dir, seconds: reducedMotion.matches ? 0 : TURN + STAGGER * (n - 1) })
      if (reducedMotion.matches || !open) {
        dirty = true
        return
      }
      paintPage(dir === 1 ? 'left' : 'right', scratch)
      sheets.forEach((s, k) => {
        s.group.visible = k < n
        const frontMat = s.front.material as THREE.MeshStandardMaterial
        const backMat = s.back.material as THREE.MeshStandardMaterial
        frontMat.map = blankTex
        backMat.map = blankTex
        if (k >= n) return
        // The first leaf lifts the old page and the last one lands the new page; leaves between are blank paper.
        const lifts = k === 0, lands = k === n - 1
        if (dir === 1) {
          if (lifts) { copyInto(oldRight, sheetFronts[k]); frontMat.map = s.frontTex }
          if (lands) { mirrorInto(scratch, sheetBacks[k]); backMat.map = s.backTex }
        } else {
          if (lifts) { mirrorInto(oldLeft, sheetBacks[k]); backMat.map = s.backTex }
          if (lands) { copyInto(scratch, sheetFronts[k]); frontMat.map = s.frontTex }
        }
        frontMat.map.needsUpdate = true
        backMat.map.needsUpdate = true
        frontMat.needsUpdate = backMat.needsUpdate = true
        s.theta = dir === 1 ? 0 : Math.PI
        bendSheet(s, s.theta)
      })
      held = dir === 1 ? 'left' : 'right'
      turn = { dir, t: 0, n }
      dirty = true
    }
    const finishTurn = () => {
      for (const s of sheets) s.group.visible = false
      turn = null
      held = null
      dirty = true
    }

    // ---- controls: ribbons, tabs, tasks ----
    type Control = { kind: 'ribbon'; index: number } | { kind: 'tab'; section: Section } | { kind: 'task'; index: number }
    const controls = (): Control[] => [
      ...VILLAGERS.map((_, index) => ({ kind: 'ribbon' as const, index })),
      ...SECTIONS.map((s) => ({ kind: 'tab' as const, section: s.id })),
      ...(section === 'tasks' && v().awake ? tasks().map((_, index) => ({ kind: 'task' as const, index })) : []),
    ]
    const describe = (c: Control) =>
      c.kind === 'ribbon' ? `${VILLAGERS[c.index].name}'s ribbon` : c.kind === 'tab' ? `${SECTIONS.find((x) => x.id === c.section)?.label} tab` : `${tasks()[c.index].text}, ${ticked[`${v().id}.${tasks()[c.index].id}`] ? 'ticked' : 'not ticked'}`

    const voice = document.createElement('p')
    voice.className = 'village-offscreen'
    voice.setAttribute('aria-live', 'polite')
    voice.dataset.talk = 'quiet'
    const announce = (text: string) => (voice.textContent = text)

    const pickVillager = (index: number) => {
      const next = (index + VILLAGERS.length) % VILLAGERS.length
      if (next === vi) return
      const dir = next > vi ? 1 : -1
      turnTo(() => {
        vi = next
        spread = -1
      }, dir, 4)
      updateInput()
      announce(`${v().name}'s pages. ${v().awake ? (section === 'talk' ? 'Talk' : 'Tasks') : 'Not awake yet'}.`)
    }
    const pickSection = (next: Section) => {
      if (next === section) return
      const order = (x: Section) => SECTIONS.findIndex((y) => y.id === x)
      turnTo(() => {
        section = next
        spread = -1
      }, order(next) > order(section) ? 1 : -1, 1)
      updateInput()
      if (next === 'sketches') void loadSketches()
      announce(next === 'talk' ? `Talk with ${v().name}` : next === 'tasks' ? `${v().name}'s tasks` : 'Sketches')
    }
    const turnSpread = (dir: 1 | -1) => {
      if (section !== 'talk' || !v().awake) return
      const s = currentSpread() + dir
      if (s < 0 || s > latestSpread()) return
      turnTo(() => (spread = s === latestSpread() ? -1 : s), dir, 1)
      announce(s === latestSpread() ? 'The latest page' : `Earlier pages, ${2 * s} and ${2 * s + 1}`)
    }
    const tick = (index: number) => {
      const task = tasks()[index]
      if (!task) return
      const key = `${v().id}.${task.id}`
      if (ticked[key]) delete ticked[key]
      else ticked[key] = true
      const kept = writeJson(TASKS_KEY, ticked)
      announce(`${task.text}: ${ticked[key] ? 'ticked' : 'not ticked'}${kept ? '' : ', but this browser could not keep it'}`)
      dirty = true
    }
    const activate = (c: Control) => {
      if (c.kind === 'ribbon') pickVillager(c.index)
      else if (c.kind === 'tab') pickSection(c.section)
      else tick(c.index)
    }

    // ---- the one input ----
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = 300
    input.autocomplete = 'off'
    input.className = 'village-offscreen'
    const style = document.createElement('style')
    style.textContent = '.village-offscreen { position: fixed; left: 50%; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; font-size: 16px; }'
    const updateInput = () => {
      const who = v()
      input.setAttribute('aria-label', !who.awake
        ? `${who.name}'s pages. Their villager is not awake yet. Arrow keys change villager, Escape closes.`
        : section === 'talk'
          ? `A line for ${who.name}'s villager. Enter sends. Tab reaches ribbons and tabs, Escape closes.`
          : `${who.name}'s tasks. Tab to a task, Enter ticks it. Escape closes.`)
    }

    const send = async () => {
      const text = draft.trim()
      if (!text || !v().awake || section !== 'talk') return
      if (talking) return announce(`${v().name}'s villager is still writing`)
      const who = v()
      draft = ''
      input.value = ''
      const mine: Said = { from: 'person', text }
      const reply: Said = { from: 'villager', text: '', writing: true }
      saidOf(who.id).push(mine, reply)
      spread = -1
      writing = reply
      shown = 0
      talking = true
      voice.dataset.talk = 'writing'
      dirty = true
      const result = await say(who.id, text, (t) => {
        reply.text += t
        dirty = true
      })
      talking = false
      reply.writing = false
      if (result.ok) {
        reply.text = result.reply
        voice.dataset.talk = 'answered'
        if (reducedMotion.matches) shown = reply.text.length
        announce(result.reply)
      } else {
        writing = null
        reply.from = 'note'
        voice.dataset.talk = result.why
        if (result.why === 'failed') reply.text = 'No answer came that time. Your line is kept; try again in a moment.'
        // 403 (#40): the tab's token is someone else's, not this page's person's. Not kept to resend: it would be refused again.
        else if (result.why === 'refused') reply.text = 'This notebook was opened with someone else\'s link. Nothing was sent.'
        // 401 or no token: a link from an earlier launch. Not kept to resend: only the latest link will work.
        else if (result.why === 'link') reply.text = 'This notebook needs your latest link from the host. Nothing was sent; open it and write again.'
        else {
          reply.text = result.why === 'busy' ? `${who.name}'s villager is still writing another answer. Your line is kept here, not sent.` : AWAY
          mine.unsent = true
          unsent.push({ person: who.id, text })
          writeJson(UNSENT_KEY, unsent)
        }
        announce(reply.text)
      }
      dirty = true
    }

    const onInput = () => {
      if (!v().awake || section !== 'talk') {
        input.value = ''
        return
      }
      draft = input.value
      focus = -1
      caretOn = true
      dirty = true
    }
    const moveFocus = (step: number) => {
      const list = controls()
      // -1 (the pen) sits between the last control and the first.
      const at = focus + 1 + step
      const size = list.length + 1
      focus = ((at % size) + size) % size - 1
      announce(focus < 0 ? (v().awake && section === 'talk' ? 'Writing' : 'The page') : describe(list[focus]))
      dirty = true
    }
    const onKey = (e: KeyboardEvent) => {
      if (!open) return
      const textEditing = focus < 0 && section === 'talk' && v().awake && draft.length > 0
      if (e.key === 'Tab') {
        e.preventDefault()
        moveFocus(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Enter' || (e.key === ' ' && focus >= 0)) {
        e.preventDefault()
        if (focus >= 0) {
          const c = controls()[focus]
          activate(c)
          // Keep the pen on the same control after a turn, when it still exists.
          const again = controls().findIndex((k) => JSON.stringify(k) === JSON.stringify(c))
          focus = again
          dirty = true
        } else void send()
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !textEditing) {
        e.preventDefault()
        learn()
        pickVillager(vi + (e.key === 'ArrowRight' ? 1 : -1))
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        learn()
        const at = SECTIONS.findIndex((x) => x.id === section) + (e.key === 'ArrowDown' ? 1 : -1)
        pickSection(SECTIONS[Math.max(0, Math.min(SECTIONS.length - 1, at))].id)
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        turnSpread(e.key === 'PageDown' ? 1 : -1)
      }
      // Escape bubbles to the entries layer, which leaves and refocuses the notebook's entry.
    }

    // ---- opening, closing and the camera ----
    const tableBook = () => scene.getObjectByName('notebook')
    const focusPose = () => {
      book.updateWorldMatrix(true, false)
      const look = book.localToWorld(new THREE.Vector3(0.025, BLOCK, 0.11))
      const position = book.localToWorld(new THREE.Vector3(0.01, 0.6, 0.45))
      return { position, look }
    }
    const enter = () => {
      if (open) return
      open = true
      ctx.emit('village/book', { open: true, seconds: reducedMotion.matches ? 0 : 0.7 })
      if (JOURNAL && !talking) {
        saidBy.clear()
        void loadHistory()
      }
      focus = -1
      view.focus(focusPose())
      updateInput()
      input.value = draft
      input.focus({ preventScroll: true })
      dirty = true
      announce(`The notebook is open at ${v().name}'s pages.`)
    }
    const leave = () => {
      if (!open) return
      open = false
      ctx.emit('village/book', { open: false, seconds: reducedMotion.matches ? 0 : 0.7 })
      focus = -1
      input.blur()
      view.focus(null)
      dirty = true
    }

    // Pointer: ribbons, tabs, tasks and page corners. The entries layer still owns hover,
    // choosing the book and backing out when the click lands off it.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      if (!open || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return
      down = null
      // A click on the canvas takes focus from the pen; give it back so typing keeps writing.
      input.focus({ preventScroll: true })
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(book, true).find((h) => h.object.visible && h.object.parent?.visible !== false)
      if (!hit) return
      const name = hit.object.name
      const ribbon = ribbons.findIndex((r) => r.strip === hit.object || r.tag === hit.object)
      if (ribbon >= 0) return pickVillager(ribbon)
      const tab = tabs.findIndex((t) => t.tab === hit.object)
      if (tab >= 0) return pickSection(SECTIONS[tab].id)
      if (!hit.uv) return
      const x = hit.uv.x * PW, y = (1 - hit.uv.y) * PH
      if (name === 'talk right page') {
        if (section === 'tasks' && v().awake) {
          const row = Math.floor((y - TOP) / ROW) - taskTop
          if (row >= 0 && row < tasks().length) tick(row)
        } else if (y > PH - 130 && x > PW - 520) turnSpread(1)
        input.focus({ preventScroll: true })
      } else if (name === 'talk left page') {
        if (y > PH - 130 && x < 600) turnSpread(-1)
        input.focus({ preventScroll: true })
      }
    }

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(input, voice)
      input.addEventListener('input', onInput)
      input.addEventListener('keydown', onKey)
      renderer.domElement.addEventListener('pointerdown', onDown)
      renderer.domElement.addEventListener('pointerup', onUp)
      return () => {
        if (open) view.focus(null)
        renderer.domElement.removeEventListener('pointerdown', onDown)
        renderer.domElement.removeEventListener('pointerup', onUp)
        input.remove()
        voice.remove()
        style.remove()
        const old = tableBook()
        if (old) old.visible = true
        if (pencil && pencilWas) {
          pencil.position.copy(pencilWas.position)
          pencil.rotation.copy(pencilWas.rotation)
        }
      }
    }, 'talk notebook controls')

    // The always-on input opens the journal at a villager or section (#42).
    ctx.on('village/journal', ({ person, section: wanted }) => {
      if (JOURNAL) void loadSketches()
      const index = VILLAGERS.findIndex((x) => x.id === person)
      if (!open) {
        // Closed: go straight to the page, no leaves to turn behind a shut cover.
        if (index >= 0) vi = index
        if (wanted) section = wanted
        spread = -1
        dirty = true
      } else {
        if (index >= 0) pickVillager(index)
        if (wanted) pickSection(wanted)
      }
      if (!open) entries.choose('notebook')
    })

    let removeEntry: (() => void) | null = null
    ctx.effect(() => () => removeEntry?.(), 'talk notebook entry')

    // History: what was said with Alex, then lines this browser kept but could not send.
    const loadHistory = async () => {
      for (const who of VILLAGERS.filter((x) => x.awake)) {
        const lines = await conversation(who.id)
        if (who.id === ME) hostAway = lines === null
        const said = saidOf(who.id)
        for (const l of lines ?? []) {
          if (l.from === 'person' && l.text) said.push({ from: 'person', text: l.text })
          else if (l.from === 'villager') said.push(l.text ? { from: 'villager', text: l.text } : { from: 'note', text: 'No answer came that time.' })
        }
        for (const u of unsent) if (u.person === who.id) said.push({ from: 'person', text: u.text, unsent: true })
      }
      const last = saidOf(ME).filter((l) => l.from === 'villager').pop()
      if (last && voice.dataset.talk === 'quiet') {
        voice.dataset.talk = 'remembered'
        announce(last.text)
      }
      dirty = true
    }

    // The table's pencil lay across the old book's page; here it rests beside the book.
    let pencil: THREE.Object3D | undefined
    let pencilWas: { position: THREE.Vector3; rotation: THREE.Euler } | undefined
    let placed = false
    let blink = 0
    ctx.on('village/frame', (dt) => {
      const old = tableBook()
      if (!old) return
      if (!placed) {
        // Take the table book's place, then hide it.
        placed = true
        old.updateWorldMatrix(true, false)
        old.matrixWorld.decompose(book.position, book.quaternion, book.scale)
        book.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true
        })
        own(ctx, book)
        removeEntry = entries.add({ id: 'notebook', label: 'Notebook', object: book, select: enter, leave })
        pencil = old.parent?.children.find((o) => o.type === 'Group' && o !== old)
        if (pencil) {
          pencilWas = { position: pencil.position.clone(), rotation: pencil.rotation.clone() }
          pencil.position.set(old.position.x + 0.53, old.position.y + 0.006, old.position.z + 0.08)
          pencil.rotation.set(Math.PI / 2, 0, -0.25)
        }
        void loadHistory()
      }
      if (old.visible) old.visible = false

      // Open and close: the left half swings over the spine.
      const goal = open ? 1 : 0
      if (openness !== goal) {
        openness = reducedMotion.matches ? goal : Math.max(0, Math.min(1, openness + Math.sign(goal - openness) * dt / 0.7))
        const k = openness < 0.5 ? 4 * openness ** 3 : 1 - (-2 * openness + 2) ** 3 / 2
        leftHalf.rotation.z = -(1 - k) * Math.PI
        spine.visible = k < 0.98
      }

      if (turn) {
        turn.t += dt
        let done = true
        sheets.forEach((s, k) => {
          if (k >= turn!.n) return
          const u = Math.max(0, Math.min(1, (turn!.t - k * STAGGER) / TURN))
          if (u < 1) done = false
          const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2
          const theta = turn!.dir === 1 ? e * Math.PI : (1 - e) * Math.PI
          if (theta !== s.theta) {
            s.theta = theta
            bendSheet(s, theta)
          }
        })
        if (done) finishTurn()
      }

      // Ribbons: the chosen villager's tag sits a little proud; keyboard focus glows warm.
      const focused = focus >= 0 ? controls()[focus] : null
      ribbons.forEach((r, i) => {
        const goalLift = i === vi ? 1 : 0
        r.lifted += (goalLift - r.lifted) * Math.min(1, dt * 8)
        r.group.position.y = r.lifted * 0.0018
        r.group.position.z = r.lifted * 0.008
        r.marker.visible = i === vi && openness > 0.9
        const glow = focused?.kind === 'ribbon' && focused.index === i ? 0.22 : i === vi ? 0.05 : 0
        for (const m of r.materials) m.emissive.setRGB(glow, glow * 0.8, glow * 0.55)
      })
      tabs.forEach((t, i) => {
        const active = SECTIONS[i].id === section
        t.tab.position.y = BLOCK - 0.0012 - i * 0.0006 + (active ? 0.0009 : 0)
        t.tab.position.x += ((active ? W + 0.026 : W + 0.015) - t.tab.position.x) * Math.min(1, dt * 10)
        t.face.color.set(active ? '#e4d9c6' : '#b89c74')
        const glow = focused?.kind === 'tab' && focused.section === SECTIONS[i].id ? 0.2 : 0
        t.face.emissive.setRGB(glow, glow * 0.8, glow * 0.55)
      })

      // The villager's pen writes what has arrived so far.
      if (writing && shown < writing.text.length) {
        pen += WRITE_RATE * dt
        const step = Math.floor(pen)
        if (step > 0) {
          pen -= step
          shown = Math.min(writing.text.length, shown + step)
          dirty = true
        }
      } else if (writing && !writing.writing) writing = null

      if (open && focus < 0 && v().awake && section === 'talk') {
        blink += dt
        if (blink > 0.53) {
          blink = 0
          caretOn = !caretOn
          dirty = true
        }
      }
      if (dirty) {
        dirty = false
        if (held !== 'left') {
          paintPage('left', leftCanvas)
          leftTex.needsUpdate = true
        }
        if (held !== 'right') {
          paintPage('right', rightCanvas)
          rightTex.needsUpdate = true
        }
      }
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
