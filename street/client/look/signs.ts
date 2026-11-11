// The street's signs (#136): a stop sign and two street names on the post the world stands at
// each end of the block, and the parking and street-cleaning plates that hang on every pole.
// Their words are painted once, on one sheet all the signs are cut from.
import * as THREE from 'three/webgpu'
import { texture, uv } from 'three/tsl'
import { Mesher, type P3 } from './mesher.ts'

/** The sheet: the stop sign, two street names, two plates and a patch of bare metal for backs. Each a rectangle of it: left, top, width, height, of 1024 by 512. */
const CUT = { stop: [0, 0, 512, 512], street: [512, 0, 512, 128], avenue: [512, 128, 512, 128], parking: [512, 256, 224, 256], cleaning: [736, 256, 224, 256], back: [968, 264, 48, 48] } as const

function sheet(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const g = canvas.getContext('2d')!
  g.fillStyle = '#8f949a'
  g.fillRect(0, 0, 1024, 512)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // Stop: white on red, a white line round it. (The sign's eight corners are cut by its shape.)
  g.fillStyle = '#f4f1ea'
  g.fillRect(0, 0, 512, 512)
  g.fillStyle = '#b3241c'
  g.beginPath()
  for (let i = 0; i < 8; i++) { const a = ((i + 0.5) / 8) * Math.PI * 2; g.lineTo(256 + Math.cos(a) * 252, 256 + Math.sin(a) * 252) }
  g.fill()
  g.fillStyle = '#f4f1ea'
  g.font = '700 168px "Helvetica Neue", Arial, sans-serif'
  g.fillText('STOP', 256, 266)
  // Street names: white on green.
  for (const [name, y] of [['VILLAGE ST', 0], ['ELDER AVE', 128]] as const) {
    g.fillStyle = '#1f6b45'
    g.fillRect(512, y, 512, 128)
    g.strokeStyle = '#f4f1ea'
    g.lineWidth = 6
    g.strokeRect(518, y + 6, 500, 116)
    g.fillStyle = '#f4f1ea'
    g.font = '700 74px "Helvetica Neue", Arial, sans-serif'
    g.fillText(name, 768, y + 68)
  }
  // Two hours' parking, in green on white; no parking for the sweeper, in red.
  const plate = (x: number, ink: string, lines: [string, number, number][]) => {
    g.fillStyle = '#f4f1ea'
    g.fillRect(x, 256, 224, 256)
    g.strokeStyle = ink
    g.lineWidth = 8
    g.strokeRect(x + 8, 264, 208, 240)
    g.fillStyle = ink
    for (const [text, y, size] of lines) { g.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`; g.fillText(text, x + 112, y) }
  }
  plate(512, '#1f6b45', [['2', 318, 96], ['HOUR', 380, 40], ['PARKING', 420, 36], ['9AM TO 6PM', 462, 24], ['MON THRU SAT', 486, 20]])
  plate(736, '#b3241c', [['NO', 300, 44], ['PARKING', 342, 38], ['STREET', 392, 30], ['CLEANING', 424, 30], ['TUE 9AM-11AM', 470, 22]])
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export interface Signs {
  /** A stop sign's post: where its foot is, and which way along the street its face looks (1 down the hill). */
  stops: { at: P3; faces: 1 | -1 }[]
  /** A pole that carries plates: where its foot is, and which side of the street it is on. */
  poles: { at: P3; side: number }[]
}

export function signs({ stops, poles }: Signs): THREE.Mesh {
  const m = new Mesher()
  // A rectangle of the sheet as the corners a face takes: left, bottom, right, top (a picture's top is the sheet's 0).
  const cut = ([x, y, w, h]: readonly [number, number, number, number]): [number, number, number, number] => [x / 1024, 1 - (y + h) / 512, (x + w) / 1024, 1 - y / 512]
  const bare = cut(CUT.back)
  /** A plate that stands upright, facing along `way` (a unit vector on the ground): its picture on the front, bare metal behind. */
  const plate = (at: P3, way: [number, number], wide: number, tall: number, of: readonly [number, number, number, number], backed = true, proud = 0.006) => {
    const [fx, fz] = way, rx = -fz, rz = fx, h = wide / 2
    const corner = (i: number, j: number, out: number): P3 => [at[0] + rx * i * h + fx * out, at[1] + j * tall / 2, at[2] + rz * i * h + fz * out]
    m.quad(corner(1, -1, proud), corner(-1, -1, proud), corner(-1, 1, proud), corner(1, 1, proud), undefined, cut(of))
    if (backed) m.quad(corner(-1, -1, -0.006), corner(1, -1, -0.006), corner(1, 1, -0.006), corner(-1, 1, -0.006), undefined, bare)
  }
  for (const s of stops) {
    const [x, y, z] = s.at, f = s.faces
    // The stop sign: eight sides, cut from the sheet's square.
    const [u0, v0, u1, v1] = cut(CUT.stop), r = 0.38, cy = y + 2.42
    const point = (i: number): { p: P3; t: [number, number] } => { const a = ((i + 0.5) / 8) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); return { p: [x + f * c * r, cy + sn * r, z + f * 0.035], t: [u0 + (u1 - u0) * (0.5 + c * 0.492), v0 + (v1 - v0) * (0.5 + sn * 0.492)] } }
    const mid: { p: P3; t: [number, number] } = { p: [x, cy, z + f * 0.035], t: [(u0 + u1) / 2, (v0 + v1) / 2] }
    for (let i = 0; i < 8; i++) {
      const a = point(i), b = point(i + 1)
      m.tri(mid.p, a.p, b.p, undefined, [mid.t, a.t, b.t])
      m.tri([mid.p[0], cy, z + f * 0.025], [b.p[0], b.p[1], z + f * 0.025], [a.p[0], a.p[1], z + f * 0.025], undefined, [[bare[0], bare[1]], [bare[2], bare[1]], [bare[2], bare[3]]])
    }
    // The two streets' names over it, one along each.
    plate([x, y + 3.02, z], [0, f], 0.86, 0.2, CUT.street, false, 0.036)
    plate([x, y + 3.02, z], [0, -f], 0.86, 0.2, CUT.street, false, 0.036)
    plate([x, y + 3.24, z], [1, 0], 0.86, 0.2, CUT.avenue, false)
    plate([x, y + 3.24, z], [-1, 0], 0.86, 0.2, CUT.avenue, false)
  }
  // On each pole, facing the road: parking above, the sweeper's days below.
  poles.forEach((p, i) => {
    const out: [number, number] = [-p.side, 0], at = (up: number): P3 => [p.at[0] - p.side * 0.19, p.at[1] + up, p.at[2]]
    plate(at(2.62), out, 0.34, 0.42, i % 2 ? CUT.cleaning : CUT.parking)
    if (i % 2 === 0) plate(at(2.14), out, 0.34, 0.42, CUT.cleaning)
  })
  const look = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.1 })
  look.colorNode = texture(sheet(), uv()).rgb
  const mesh = new THREE.Mesh(m.geometry(), look)
  mesh.name = 'the signs'
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}
