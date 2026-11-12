// A street made of cells, drawn (#138). Every thing of cells is a few meshes: its faces that
// look at air, cells of one kind in one flat run drawn as one rectangle, a block's worth of
// chunks to a mesh. A cell's colour and shine are its material's (materials.ts) under its paint,
// and every cell is a shade its own, so a wall is not one flat colour. A blow remeshes only the
// chunks it touched. What a blow knocks out flies off as crumbs.
import * as THREE from 'three/webgpu'
import { attribute, dot, float, floor, fract, normalLocal, normalView, positionLocal, uniform, vec3 } from 'three/tsl'
import type { Vec3 } from '../../../home/src/engine/core.ts'
import { material as facts } from '../../../home/src/engine/materials.ts'
import type { Box, Voxels } from '../../../home/src/engine/voxels.ts'

/** Cells a side of a chunk (meshed as one), and chunks a side of what is drawn as one mesh. */
const CHUNK = 32, SECTOR = 4
/** How much a cell's own shade wanders, by what it is made of: 255 is a fifth either way. */
const WANDER: Record<string, number> = { plaster: 70, stone: 110, asphalt: 120, cork: 110, foam: 60, maple: 85, walnut: 85, lacquer: 30, steel: 28, brass: 28, glass: 10, rubber: 45, plastic: 28, felt: 110, fur: 130, ice: 30, jelly: 22, paper: 50, ceramic: 30, wax: 30, fruit: 60 }

type V3 = THREE.Node<'vec3'>

/** What is not glass: lit by what each cell says of itself. Positions are in cells (the mesh is scaled by a cell's edge), so the cell under a point is a floor away. */
function solidLook() {
  const look = new THREE.MeshStandardNodeMaterial()
  const tone = attribute('tone', 'vec4'), surf = attribute('surf', 'vec4')
  const cell = floor(positionLocal.sub(normalLocal.mul(0.5)).add(0.0005)) as V3
  // A number between 0 and 1 for each cell, the same every frame.
  const p = fract(cell.mul(vec3(0.1031, 0.103, 0.0973))) as V3
  const q = p.add(dot(p, p.yzx.add(33.33)))
  const own = fract(q.x.add(q.y).mul(q.z))
  // And one for each run of four cells, so a wall has patches as well as grain.
  const p4 = fract(floor(cell.div(4)).mul(vec3(0.0973, 0.1031, 0.103))) as V3
  const q4 = p4.add(dot(p4, p4.yzx.add(19.19)))
  const patch = fract(q4.x.add(q4.z).mul(q4.y))
  const paint = tone.rgb.pow(2.2) as V3
  const shade = float(1).add(own.sub(0.5).mul(tone.a).mul(0.4)).add(patch.sub(0.5).mul(tone.a).mul(0.16))
  look.colorNode = paint.mul(shade)
  look.roughnessNode = surf.x.add(own.sub(0.5).mul(0.12)).clamp(0.04, 1)
  look.metalnessNode = surf.y
  look.emissiveNode = paint.mul(surf.z.mul(6))
  return look
}
function glassLook() {
  const look = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false })
  const tone = attribute('tone', 'vec4')
  look.colorNode = (tone.rgb.pow(2.2) as V3).mul(0.5)
  look.roughnessNode = float(0.06)
  look.metalnessNode = float(0.35)
  look.opacityNode = float(0.72)
  return look
}
let SOLID: THREE.MeshStandardNodeMaterial | null = null, GLASS: THREE.MeshStandardNodeMaterial | null = null

/** A growing run of numbers of one type. */
class Run<T extends Float32Array | Uint8Array> {
  n = 0
  constructor(public a: T) {}
  room(more: number) {
    if (this.n + more <= this.a.length) return
    const next = new (this.a.constructor as new (n: number) => T)(Math.max(this.a.length * 2, this.n + more))
    next.set(this.a)
    this.a = next
  }
  cut(): T { return this.a.slice(0, this.n) as T }
}
interface Faces { position: Float32Array; normal: Float32Array; tone: Uint8Array; surf: Uint8Array }
const scratch = { position: new Run(new Float32Array(1 << 15)), normal: new Run(new Float32Array(1 << 15)), tone: new Run(new Uint8Array(1 << 15)), surf: new Run(new Uint8Array(1 << 15)) }
const scratchGlass = { position: new Run(new Float32Array(1 << 12)), normal: new Run(new Float32Array(1 << 12)), tone: new Run(new Uint8Array(1 << 12)), surf: new Run(new Uint8Array(1 << 12)) }
const mask = new Uint8Array(CHUNK * CHUNK)

/** What each kind of a block looks like, as bytes: its paint (or its material's colour), how much its shade wanders, how rough and how metal it is, whether it glows, whether it is glass. */
function palette(v: Voxels) {
  const n = v.kinds.length + 1, tone = new Uint8Array(n * 4), surf = new Uint8Array(n * 4), glass = new Uint8Array(n)
  v.kinds.forEach((kind, i) => {
    const fact = facts(kind.material), hex = kind.paint ?? fact?.look.color ?? '#888888', k = (i + 1) * 4
    tone[k] = parseInt(hex.slice(1, 3), 16); tone[k + 1] = parseInt(hex.slice(3, 5), 16); tone[k + 2] = parseInt(hex.slice(5, 7), 16)
    tone[k + 3] = WANDER[kind.material] ?? 50
    surf[k] = Math.round((fact?.look.roughness ?? 0.8) * 255)
    surf[k + 1] = Math.round((fact?.look.metalness ?? 0) * 255)
    // A lamp's pane: pale warm paint on glass or steel is a light.
    surf[k + 2] = kind.material === 'lamp' ? 255 : 0
    glass[i + 1] = kind.material === 'glass' ? 1 : 0
  })
  return { tone, surf, glass }
}

/** The faces of one chunk of a block: what is not glass, and what is. Null where there are none. */
function meshChunk(v: Voxels, cx: number, cy: number, cz: number, pal: ReturnType<typeof palette>): { solid: Faces | null; glass: Faces | null } {
  const [nx, ny, nz] = v.size, c = v.cells, size = [nx, ny, nz], stride = [1, nx * nz, nx]
  const lo = [cx * CHUNK, cy * CHUNK, cz * CHUNK], hi = [Math.min(nx, lo[0] + CHUNK), Math.min(ny, lo[1] + CHUNK), Math.min(nz, lo[2] + CHUNK)]
  for (const s of [scratch, scratchGlass]) s.position.n = s.normal.n = s.tone.n = s.surf.n = 0
  const corner = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, w = (a + 2) % 3, du = hi[u] - lo[u], dw = hi[w] - lo[w]
    for (let sign = -1; sign <= 1; sign += 2) {
      for (let s = lo[a]; s < hi[a]; s++) {
        const edge = sign > 0 ? s + 1 >= size[a] : s === 0
        let any = false
        const base = s * stride[a] + lo[u] * stride[u] + lo[w] * stride[w]
        for (let jw = 0; jw < dw; jw++) for (let ju = 0; ju < du; ju++) {
          const i = base + ju * stride[u] + jw * stride[w], k = c[i]
          let show = 0
          if (k) {
            const next = edge ? 0 : c[i + sign * stride[a]]
            if (!next || (pal.glass[next] && !pal.glass[k])) show = k
          }
          mask[ju + du * jw] = show
          if (show) any = true
        }
        if (!any) continue
        const plane = sign > 0 ? s + 1 : s
        for (let jw = 0; jw < dw; jw++) for (let ju = 0; ju < du; ju++) {
          const k = mask[ju + du * jw]
          if (!k) continue
          let wide = 1
          while (ju + wide < du && mask[ju + wide + du * jw] === k) wide++
          let tall = 1
          grow: for (; jw + tall < dw; tall++) for (let i = 0; i < wide; i++) if (mask[ju + i + du * (jw + tall)] !== k) break grow
          for (let j = 0; j < tall; j++) mask.fill(0, ju + du * (jw + j), ju + wide + du * (jw + j))
          const out = pal.glass[k] ? scratchGlass : scratch
          out.position.room(12); out.normal.room(12); out.tone.room(16); out.surf.room(16)
          const u0 = lo[u] + ju, u1 = u0 + wide, w0 = lo[w] + jw, w1 = w0 + tall
          // Four corners, anticlockwise seen from outside.
          const order = sign > 0 ? [u0, w0, u1, w0, u1, w1, u0, w1] : [u0, w0, u0, w1, u1, w1, u1, w0]
          for (let q = 0; q < 4; q++) {
            corner[a] = plane; corner[u] = order[q * 2]; corner[w] = order[q * 2 + 1]
            const P = out.position, N = out.normal, T = out.tone, S = out.surf
            P.a[P.n++] = corner[0]; P.a[P.n++] = corner[1]; P.a[P.n++] = corner[2]
            N.a[N.n + a] = sign; N.a[N.n + u] = 0; N.a[N.n + w] = 0; N.n += 3
            T.a[T.n++] = pal.tone[k * 4]; T.a[T.n++] = pal.tone[k * 4 + 1]; T.a[T.n++] = pal.tone[k * 4 + 2]; T.a[T.n++] = pal.tone[k * 4 + 3]
            S.a[S.n++] = pal.surf[k * 4]; S.a[S.n++] = pal.surf[k * 4 + 1]; S.a[S.n++] = pal.surf[k * 4 + 2]; S.a[S.n++] = 0
          }
        }
      }
    }
  }
  const take = (s: typeof scratch): Faces | null => (s.position.n ? { position: s.position.cut(), normal: s.normal.cut(), tone: s.tone.cut(), surf: s.surf.cut() } : null)
  return { solid: take(scratch), glass: take(scratchGlass) }
}

function geometryOf(parts: Faces[]): THREE.BufferGeometry {
  const verts = parts.reduce((n, p) => n + p.position.length / 3, 0)
  const position = new Float32Array(verts * 3), normal = new Float32Array(verts * 3), tone = new Uint8Array(verts * 4), surf = new Uint8Array(verts * 4)
  let at = 0
  for (const p of parts) { position.set(p.position, at * 3); normal.set(p.normal, at * 3); tone.set(p.tone, at * 4); surf.set(p.surf, at * 4); at += p.position.length / 3 }
  const index = new Uint32Array((verts / 4) * 6)
  for (let q = 0, i = 0; q < verts; q += 4) { index[i++] = q; index[i++] = q + 1; index[i++] = q + 2; index[i++] = q; index[i++] = q + 2; index[i++] = q + 3 }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  g.setAttribute('tone', new THREE.BufferAttribute(tone, 4, true))
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

/** How much has been meshed and drawn, for the numbers panel and the checks. */
export const cellStats = { chunks: 0, meshMs: 0, quads: 0, meshes: 0 }

/** One thing of cells as it is drawn: `group` stands where the thing's part does. */
export class CellsView {
  readonly group = new THREE.Group()
  private inner = new THREE.Group()
  private pal: ReturnType<typeof palette>
  private chunks = new Map<number, { solid: Faces | null; glass: Faces | null }>()
  private sectors = new Map<number, THREE.Mesh[]>()
  private across: number
  private deep: number

  constructor(readonly key: string, private v: Voxels, low: Vec3) {
    SOLID ??= solidLook()
    GLASS ??= glassLook()
    this.pal = palette(v)
    this.across = Math.ceil(v.size[0] / CHUNK)
    this.deep = Math.ceil(v.size[2] / CHUNK)
    this.inner.position.set(low[0], low[1], low[2])
    this.inner.scale.setScalar(v.cell)
    this.group.add(this.inner)
    this.group.name = key
    this.changed([0, 0, 0, v.size[0], v.size[1], v.size[2]])
  }

  /** The cells of a box changed: mesh again the chunks it reaches (and the ones beside it, whose faces looked at those cells). */
  changed(box: Box) {
    const t0 = performance.now(), [nx, ny, nz] = this.v.size
    const b = [Math.max(0, box[0] - 1), Math.max(0, box[1] - 1), Math.max(0, box[2] - 1), Math.min(nx, box[3] + 1), Math.min(ny, box[4] + 1), Math.min(nz, box[5] + 1)]
    const stale = new Set<number>()
    for (let cy = Math.floor(b[1] / CHUNK); cy * CHUNK < b[4]; cy++) for (let cz = Math.floor(b[2] / CHUNK); cz * CHUNK < b[5]; cz++) for (let cx = Math.floor(b[0] / CHUNK); cx * CHUNK < b[3]; cx++) {
      const n = cx + this.across * (cz + this.deep * cy), faces = meshChunk(this.v, cx, cy, cz, this.pal)
      if (faces.solid || faces.glass) this.chunks.set(n, faces)
      else this.chunks.delete(n)
      cellStats.chunks++
      stale.add(Math.floor(cx / SECTOR) + 64 * (Math.floor(cz / SECTOR) + 64 * Math.floor(cy / SECTOR)))
    }
    for (const sector of stale) this.draw(sector)
    cellStats.meshMs += performance.now() - t0
  }

  private draw(sector: number) {
    for (const mesh of this.sectors.get(sector) ?? []) { this.inner.remove(mesh); cellStats.quads -= mesh.geometry.getAttribute('position').count / 4; cellStats.meshes--; mesh.geometry.dispose() }
    const sx = sector % 64, sz = Math.floor(sector / 64) % 64, sy = Math.floor(sector / 4096)
    const solid: Faces[] = [], glass: Faces[] = []
    for (let cy = sy * SECTOR; cy < (sy + 1) * SECTOR; cy++) for (let cz = sz * SECTOR; cz < Math.min(this.deep, (sz + 1) * SECTOR); cz++) for (let cx = sx * SECTOR; cx < Math.min(this.across, (sx + 1) * SECTOR); cx++) {
      const faces = this.chunks.get(cx + this.across * (cz + this.deep * cy))
      if (faces?.solid) solid.push(faces.solid)
      if (faces?.glass) glass.push(faces.glass)
    }
    const meshes: THREE.Mesh[] = []
    for (const [parts, look] of [[solid, SOLID!], [glass, GLASS!]] as const) {
      if (!parts.length) continue
      const mesh = new THREE.Mesh(geometryOf(parts), look)
      mesh.castShadow = look === SOLID
      mesh.receiveShadow = true
      mesh.name = this.key
      mesh.userData.cells = this.key
      if (look === GLASS) mesh.renderOrder = 1
      this.inner.add(mesh)
      meshes.push(mesh)
      cellStats.quads += mesh.geometry.getAttribute('position').count / 4
      cellStats.meshes++
    }
    if (meshes.length) this.sectors.set(sector, meshes)
    else this.sectors.delete(sector)
  }

  dispose() {
    for (const meshes of this.sectors.values()) for (const mesh of meshes) { cellStats.quads -= mesh.geometry.getAttribute('position').count / 4; cellStats.meshes--; mesh.geometry.dispose() }
    this.sectors.clear()
    this.chunks.clear()
    this.group.removeFromParent()
  }
}

/** What a blow knocks out: small cubes that fly, fall, bounce once or twice and are gone. One instanced mesh for all of them. */
export class Crumbs {
  readonly mesh: THREE.InstancedMesh
  private p: Float32Array
  private v: Float32Array
  private life: Float32Array
  private size: Float32Array
  private spin: Float32Array
  private next = 0
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private s = new THREE.Vector3()
  private at = new THREE.Vector3()
  private c = new THREE.Color()

  constructor(readonly most: number, private ground: (x: number, z: number) => number) {
    const look = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 })
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), look, most)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.castShadow = true
    this.mesh.frustumCulled = false
    this.mesh.name = 'crumbs'
    this.p = new Float32Array(most * 3); this.v = new Float32Array(most * 3); this.life = new Float32Array(most); this.size = new Float32Array(most); this.spin = new Float32Array(most * 3)
    this.m.makeScale(0, 0, 0)
    for (let i = 0; i < most; i++) { this.mesh.setMatrixAt(i, this.m); this.mesh.setColorAt(i, this.c.set('#888888')) }
  }

  /** A crumb at a point, thrown away from `from` at about `speed` m/s. */
  throw(point: Vec3, from: Vec3, speed: number, size: number, hex: string) {
    const i = this.next++ % this.most
    const dx = point[0] - from[0], dy = point[1] - from[1], dz = point[2] - from[2], far = Math.hypot(dx, dy, dz) || 1
    const k = (speed * (0.45 + Math.random() * 0.9)) / far
    this.p.set(point, i * 3)
    this.v[i * 3] = dx * k + (Math.random() - 0.5) * speed * 0.5
    this.v[i * 3 + 1] = dy * k + speed * (0.25 + Math.random() * 0.5)
    this.v[i * 3 + 2] = dz * k + (Math.random() - 0.5) * speed * 0.5
    this.life[i] = 1.6 + Math.random() * 1.6
    this.size[i] = size * (0.55 + Math.random() * 0.6)
    for (let a = 0; a < 3; a++) this.spin[i * 3 + a] = (Math.random() - 0.5) * 14
    // An ember is told as 'ember': brighter than white, so it glows.
    if (hex === 'ember') this.c.setRGB(5, 1.8 + Math.random(), 0.3)
    else this.c.set(hex).multiplyScalar(0.8 + Math.random() * 0.3)
    this.mesh.setColorAt(i, this.c)
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  update(dt: number) {
    let any = false
    for (let i = 0; i < this.most; i++) {
      if (this.life[i] <= 0) continue
      any = true
      this.life[i] -= dt
      const o = i * 3
      this.v[o + 1] -= 9.81 * dt
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt
      const floor = this.ground(this.p[o], this.p[o + 2]) + this.size[i] / 2
      if (this.p[o + 1] < floor) {
        this.p[o + 1] = floor
        this.v[o + 1] = Math.abs(this.v[o + 1]) * 0.28
        this.v[o] *= 0.55; this.v[o + 2] *= 0.55
        for (let a = 0; a < 3; a++) this.spin[o + a] *= 0.4
      }
      const size = this.life[i] <= 0 ? 0 : this.size[i] * Math.min(1, this.life[i] / 0.35)
      this.e.set(this.spin[o] * this.life[i], this.spin[o + 1] * this.life[i], this.spin[o + 2] * this.life[i])
      this.m.compose(this.at.set(this.p[o], this.p[o + 1], this.p[o + 2]), this.q.setFromEuler(this.e), this.s.setScalar(size))
      this.mesh.setMatrixAt(i, this.m)
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true
  }
}

/** The flash, the ball of fire and the smoke of a blast, and the puff of dust of a hammer blow. Each is a ball that is thick in the middle and thins to nothing at its edge. */
export class Bursts {
  readonly group = new THREE.Group()
  private live: { mesh: THREE.Mesh; thick: { value: number }; age: number; life: number; from: number; to: number; rise: number; fade: number }[] = []
  private ball = new THREE.SphereGeometry(1, 24, 16)
  private light = new THREE.PointLight('#ffb060', 0, 30, 1.6)
  private lit = 0

  constructor() {
    this.group.name = 'bursts'
    this.group.add(this.light)
  }

  private puff(at: Vec3, color: [number, number, number], opacity: number, from: number, to: number, life: number, rise: number, glow = false) {
    const look = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, ...(glow ? { blending: THREE.AdditiveBlending } : {}) })
    const thick = uniform(opacity)
    look.colorNode = vec3(...color)
    // Seen through its middle a ball of smoke is deep; at its edge there is almost none of it.
    look.opacityNode = thick.mul(normalView.z.abs().pow(glow ? 1.4 : 2.2))
    const mesh = new THREE.Mesh(this.ball, look)
    mesh.position.set(at[0], at[1], at[2])
    mesh.scale.setScalar(from)
    mesh.renderOrder = 3
    this.group.add(mesh)
    this.live.push({ mesh, thick, age: 0, life, from, to, rise, fade: opacity })
  }

  /** A blast: a white flash, fire, then smoke that rises. */
  boom(at: Vec3, radius: number) {
    this.puff(at, [6, 5, 3.2], 1, radius * 0.5, radius * 1.7, 0.12, 0, true)
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * Math.random() * 0.5
      this.puff([at[0] + Math.cos(a) * r, at[1] + (Math.random() - 0.3) * radius * 0.5, at[2] + Math.sin(a) * r], [3.2, 1.25 + Math.random() * 0.5, 0.25], 0.9, radius * 0.35, radius * (0.8 + Math.random() * 0.5), 0.3 + Math.random() * 0.25, 1.5, true)
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random(), r = radius * (0.2 + Math.random() * 0.7), grey = 0.05 + Math.random() * 0.09
      this.puff([at[0] + Math.cos(a) * r, at[1] + Math.random() * radius * 0.7, at[2] + Math.sin(a) * r], [grey, grey * 0.97, grey * 0.93], 0.85, radius * 0.5, radius * (1.2 + Math.random() * 0.9), 1.6 + Math.random() * 1.6, 0.9 + Math.random() * 1.2)
    }
    this.light.position.set(at[0], at[1] + 0.3, at[2])
    this.light.intensity = 420
    this.lit = 0.22
  }

  /** A hammer blow: a little dust. */
  knock(at: Vec3, radius: number) {
    for (let i = 0; i < 3; i++) this.puff([at[0] + (Math.random() - 0.5) * radius, at[1] + (Math.random() - 0.5) * radius, at[2] + (Math.random() - 0.5) * radius], [0.5, 0.47, 0.42], 0.5, radius * 0.6, radius * 2, 0.55 + Math.random() * 0.3, 0.5)
  }

  update(dt: number) {
    if (this.lit > 0) { this.lit -= dt; this.light.intensity = this.lit > 0 ? 420 * (this.lit / 0.22) ** 2 : 0 }
    for (const b of this.live) {
      b.age += dt
      const k = Math.min(1, b.age / b.life), ease = 1 - (1 - k) * (1 - k)
      b.mesh.scale.setScalar(b.from + (b.to - b.from) * ease)
      b.mesh.position.y += b.rise * dt
      b.thick.value = b.fade * (1 - k) * (1 - k * k)
      if (k >= 1) { this.group.remove(b.mesh); (b.mesh.material as THREE.Material).dispose() }
    }
    this.live = this.live.filter((b) => b.age < b.life)
  }
}
