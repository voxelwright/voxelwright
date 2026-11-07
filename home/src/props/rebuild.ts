// #42 prop sandbox, trusted side: check a prop's wire data and rebuild it with
// the home's own geometry and materials. The data may come from model code in
// the sandbox, so nothing in it is spread, assigned or called: every field is
// read by name from the object's own properties and copied into fresh values.
// Anything outside the limits rejects the whole prop with a reason; nothing is
// placed until the whole prop has been checked.
import * as THREE from 'three/webgpu'
import { MAX_RESULT_BYTES } from './sandbox'
import type { PropData, Side, WireGeometry, WireMaterial, WireMesh, WireTexture, Wrap } from './wire'

export const LIMITS = {
  meshes: 300,
  geometries: 300,
  materials: 64,
  textures: 16,
  /** Triangles drawn, counting every mesh that uses a geometry. */
  triangles: 200_000,
  vertices: 400_000,
  textureSide: 2048,
  texturePixels: 16 * 1024 * 1024,
  bytes: MAX_RESULT_BYTES,
  /** The prop's largest side, in metres, after every mesh's transform. */
  extent: 4,
  notes: 20,
}
const PRESETS = ['standard'] as const
const WRAPS: Wrap[] = ['repeat', 'clamp', 'mirror']
const SIDES: Side[] = ['front', 'back', 'double']

class Reject extends Error {}
const fail = (reason: string): never => { throw new Reject(reason) }
const own = (o: object, key: string): unknown => (Object.hasOwn(o, key) ? (o as Record<string, unknown>)[key] : undefined)
const obj = (v: unknown, what: string): object => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : fail(`${what} is not an object`))
const list = (v: unknown, what: string, max: number): unknown[] => {
  if (!Array.isArray(v)) fail(`${what} is not a list`)
  if ((v as unknown[]).length > max) fail(`${what} has ${(v as unknown[]).length} entries, more than ${max}`)
  return v as unknown[]
}
const finite = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} is not a finite number`))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(`${what} is not true or false`))
const oneOf = <T extends string>(v: unknown, options: readonly T[], what: string): T => (options.includes(v as T) ? (v as T) : fail(`${what} "${String(v).slice(0, 40)}" is not one of ${options.join(', ')}`))
const index = (v: unknown, size: number, what: string): number => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < size ? (v as number) : fail(`${what} does not point at an entry`))
const numbers = (v: unknown, n: number, what: string, lo: number, hi: number): number[] => {
  const a = list(v, what, n)
  if (a.length !== n) fail(`${what} needs ${n} numbers`)
  return a.map((x, i) => clamp(finite(x, `${what}[${i}]`), lo, hi))
}
function floats(v: unknown, what: string, required: boolean): Float32Array | null {
  if (v === null && !required) return null
  if (!(v instanceof Float32Array)) return fail(`${what} is not a Float32Array`)
  const out = new Float32Array(v) // a copy: never alias a buffer the sender chose
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) fail(`${what} has a value that is not finite`)
  return out
}

function geometry(v: unknown, i: number): WireGeometry {
  const g = obj(v, `geometry ${i}`)
  const position = floats(own(g, 'position'), `geometry ${i} position`, true)!
  if (position.length === 0 || position.length % 3) fail(`geometry ${i} position length is not a multiple of 3`)
  const count = position.length / 3
  const normal = floats(own(g, 'normal'), `geometry ${i} normal`, false)
  if (normal && normal.length !== position.length) fail(`geometry ${i} normal length does not match its positions`)
  const uv = floats(own(g, 'uv'), `geometry ${i} uv`, false)
  if (uv && uv.length !== count * 2) fail(`geometry ${i} uv length does not match its positions`)
  const raw = own(g, 'index')
  let idx: Uint16Array | Uint32Array | null = null
  if (raw !== null) {
    if (raw instanceof Uint16Array) idx = new Uint16Array(raw)
    else if (raw instanceof Uint32Array) idx = new Uint32Array(raw)
    else fail(`geometry ${i} index is not a Uint16Array or Uint32Array`)
    if (idx!.length % 3) fail(`geometry ${i} index length is not a multiple of 3`)
    for (let k = 0; k < idx!.length; k++) if (idx![k] >= count) fail(`geometry ${i} index points past its positions`)
  } else if (count % 3) fail(`geometry ${i} has no index and its vertex count is not a multiple of 3`)
  return { position, normal, uv, index: idx }
}

function material(v: unknown, i: number, textures: number): WireMaterial {
  const m = obj(v, `material ${i}`)
  const map = own(m, 'map')
  return {
    preset: oneOf(own(m, 'preset'), PRESETS, `material ${i} preset`),
    color: numbers(own(m, 'color'), 3, `material ${i} color`, 0, 1),
    emissive: numbers(own(m, 'emissive'), 3, `material ${i} emissive`, 0, 1),
    emissiveIntensity: clamp(finite(own(m, 'emissiveIntensity'), `material ${i} emissiveIntensity`), 0, 4),
    roughness: clamp(finite(own(m, 'roughness'), `material ${i} roughness`), 0, 1),
    metalness: clamp(finite(own(m, 'metalness'), `material ${i} metalness`), 0, 1),
    opacity: clamp(finite(own(m, 'opacity'), `material ${i} opacity`), 0, 1),
    transparent: bool(own(m, 'transparent'), `material ${i} transparent`),
    depthWrite: bool(own(m, 'depthWrite'), `material ${i} depthWrite`),
    flatShading: bool(own(m, 'flatShading'), `material ${i} flatShading`),
    side: oneOf(own(m, 'side'), SIDES, `material ${i} side`),
    map: map === null ? null : index(map, textures, `material ${i} map`),
  }
}

function texture(v: unknown, i: number): WireTexture {
  const t = obj(v, `texture ${i}`)
  const image = own(t, 'image')
  if (!(image instanceof ImageBitmap)) fail(`texture ${i} image is not an ImageBitmap`)
  const { width, height } = image as ImageBitmap
  if (width < 1 || height < 1 || width > LIMITS.textureSide || height > LIMITS.textureSide)
    fail(`texture ${i} is ${width}x${height}; the most is ${LIMITS.textureSide} a side`)
  return {
    image: image as ImageBitmap,
    srgb: bool(own(t, 'srgb'), `texture ${i} srgb`),
    flipY: bool(own(t, 'flipY'), `texture ${i} flipY`),
    wrapS: oneOf(own(t, 'wrapS'), WRAPS, `texture ${i} wrapS`),
    wrapT: oneOf(own(t, 'wrapT'), WRAPS, `texture ${i} wrapT`),
    repeat: numbers(own(t, 'repeat'), 2, `texture ${i} repeat`, -64, 64),
    offset: numbers(own(t, 'offset'), 2, `texture ${i} offset`, -64, 64),
    center: numbers(own(t, 'center'), 2, `texture ${i} center`, -64, 64),
    rotation: finite(own(t, 'rotation'), `texture ${i} rotation`),
    anisotropy: clamp(Math.round(finite(own(t, 'anisotropy'), `texture ${i} anisotropy`)), 1, 16),
  }
}

/** Check untrusted wire data. Returns a fresh PropData, or the first reason it cannot be placed. */
export function validate(input: unknown): { prop: PropData } | { reason: string } {
  try {
    const d = obj(input, 'the prop')
    const textures = list(own(d, 'textures'), 'textures', LIMITS.textures).map(texture)
    const pixels = textures.reduce((sum, t) => sum + t.image.width * t.image.height, 0)
    if (pixels > LIMITS.texturePixels) fail(`textures hold ${pixels} pixels, more than ${LIMITS.texturePixels}`)
    const rawGeometries = list(own(d, 'geometries'), 'geometries', LIMITS.geometries)
    // Byte budget before copying: count each distinct buffer once.
    const buffers = new Set<ArrayBufferLike>()
    let bytes = pixels * 4
    for (const g of rawGeometries) if (g && typeof g === 'object') for (const k of ['position', 'normal', 'uv', 'index']) {
      const a = own(g, k)
      if (ArrayBuffer.isView(a) && !buffers.has(a.buffer)) { buffers.add(a.buffer); bytes += a.buffer.byteLength }
    }
    if (bytes > LIMITS.bytes) fail(`the prop is ${Math.round(bytes / 1048576)} MB, more than ${LIMITS.bytes / 1048576} MB`)
    const geometries = rawGeometries.map(geometry)
    const vertices = geometries.reduce((sum, g) => sum + g.position.length / 3, 0)
    if (vertices > LIMITS.vertices) fail(`the prop has ${vertices} vertices, more than ${LIMITS.vertices}`)
    const materials = list(own(d, 'materials'), 'materials', LIMITS.materials).map((m, i) => material(m, i, textures.length))
    let triangles = 0, placed = 0
    const box = new THREE.Box3()
    const p = new THREE.Vector3()
    const meshes = list(own(d, 'meshes'), 'meshes', LIMITS.meshes).map((v, i): WireMesh => {
      const m = obj(v, `mesh ${i}`)
      const mesh = {
        geometry: index(own(m, 'geometry'), geometries.length, `mesh ${i} geometry`),
        material: index(own(m, 'material'), materials.length, `mesh ${i} material`),
        matrix: numbers(own(m, 'matrix'), 16, `mesh ${i} matrix`, -Infinity, Infinity),
      }
      const g = geometries[mesh.geometry]
      triangles += (g.index ? g.index.length : g.position.length / 3) / 3
      if (triangles > LIMITS.triangles) fail(`the prop has more than ${LIMITS.triangles} triangles`)
      placed += g.position.length / 3
      if (placed > 4 * LIMITS.vertices) fail('the prop places too many vertices')
      const matrix = new THREE.Matrix4().fromArray(mesh.matrix)
      for (let k = 0; k < g.position.length; k += 3) {
        p.set(g.position[k], g.position[k + 1], g.position[k + 2]).applyMatrix4(matrix)
        if (!Number.isFinite(p.x + p.y + p.z)) fail(`mesh ${i} has a point that is not finite once placed`)
        box.expandByPoint(p)
      }
      return mesh
    })
    if (meshes.length === 0) fail('the prop has no meshes')
    const size = box.getSize(new THREE.Vector3())
    if (Math.max(size.x, size.y, size.z) > LIMITS.extent) fail(`the prop is ${size.toArray().map((v) => v.toFixed(2)).join(' x ')} m; the most is ${LIMITS.extent} m a side`)
    const notes = list(own(d, 'notes'), 'notes', LIMITS.notes).map((n) => String(typeof n === 'string' ? n : '').slice(0, 200))
    return { prop: { meshes, geometries, materials, textures, notes } }
  } catch (error) {
    if (error instanceof Reject) return { reason: error.message }
    return { reason: `the prop could not be read: ${String(error).slice(0, 200)}` }
  }
}

const WRAP = { repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping }
const SIDE = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide }

/** Rebuild checked data with trusted three.js objects. Textures are drawn onto page canvases, as paint.ts makes them. */
export function rebuild(prop: PropData): THREE.Group {
  const textures = prop.textures.map((t) => {
    const canvas = document.createElement('canvas')
    canvas.width = t.image.width
    canvas.height = t.image.height
    canvas.getContext('2d')!.drawImage(t.image, 0, 0)
    t.image.close()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = t.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.flipY = t.flipY
    texture.wrapS = WRAP[t.wrapS]
    texture.wrapT = WRAP[t.wrapT]
    texture.repeat.fromArray(t.repeat)
    texture.offset.fromArray(t.offset)
    texture.center.fromArray(t.center)
    texture.rotation = t.rotation
    texture.anisotropy = t.anisotropy
    return texture
  })
  const materials = prop.materials.map((m) => new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]),
    emissive: new THREE.Color().setRGB(m.emissive[0], m.emissive[1], m.emissive[2]),
    emissiveIntensity: m.emissiveIntensity,
    roughness: m.roughness,
    metalness: m.metalness,
    opacity: m.opacity,
    transparent: m.transparent,
    depthWrite: m.depthWrite,
    flatShading: m.flatShading,
    side: SIDE[m.side],
    map: m.map === null ? null : textures[m.map],
  }))
  const geometries = prop.geometries.map((g) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3))
    if (g.normal) geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3))
    if (g.uv) geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2))
    if (g.index) geo.setIndex(new THREE.BufferAttribute(g.index, 1))
    if (!g.normal) geo.computeVertexNormals()
    return geo
  })
  const group = new THREE.Group()
  for (const m of prop.meshes) {
    const mesh = new THREE.Mesh(geometries[m.geometry], materials[m.material])
    mesh.matrixAutoUpdate = false
    mesh.matrix.fromArray(m.matrix)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
