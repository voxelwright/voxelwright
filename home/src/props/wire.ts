// #42 prop sandbox: the only shape a prop takes between whoever made it and the home.
// A producer (model code in the sandbox worker, or the trusted spec interpreter)
// builds a three.js tree; serialize() turns it into plain arrays, numbers and
// ImageBitmaps. The home never receives objects, functions or shader code, and
// treats everything here as untrusted until rebuild.ts has checked it.
//
// Duck-typed on purpose: the worker uses `three` core and the page uses
// `three/webgpu`, so instanceof checks would not cross between them.
import type * as THREE from 'three'

export type Wrap = 'repeat' | 'clamp' | 'mirror'
export type Side = 'front' | 'back' | 'double'

export interface WireTexture {
  image: ImageBitmap
  srgb: boolean
  flipY: boolean
  wrapS: Wrap
  wrapT: Wrap
  repeat: number[]
  offset: number[]
  center: number[]
  rotation: number
  anisotropy: number
}

export interface WireMaterial {
  preset: string
  color: number[]
  emissive: number[]
  emissiveIntensity: number
  roughness: number
  metalness: number
  opacity: number
  transparent: boolean
  depthWrite: boolean
  flatShading: boolean
  side: Side
  map: number | null
}

export interface WireGeometry {
  position: Float32Array
  normal: Float32Array | null
  uv: Float32Array | null
  index: Uint16Array | Uint32Array | null
}

export interface WireMesh {
  geometry: number
  material: number
  /** Column-major 4x4 matrix relative to the prop's root. */
  matrix: number[]
}

export interface PropData {
  meshes: WireMesh[]
  geometries: WireGeometry[]
  materials: WireMaterial[]
  textures: WireTexture[]
  /** Short text from the producer (skipped objects, prop.note()). Shown as text only. */
  notes: string[]
}

const WRAPS: Record<number, Wrap> = { 1000: 'repeat', 1001: 'clamp', 1002: 'mirror' }
const SIDES: Record<number, Side> = { 0: 'front', 1: 'back', 2: 'double' }
const rgb = (c: THREE.Color | undefined) => (c ? [c.r, c.g, c.b] : [1, 1, 1])

type Image = HTMLCanvasElement | OffscreenCanvas | ImageBitmap | { width: number; height: number }

/**
 * Serialize every visible mesh under root. Textures become ImageBitmaps; anything
 * that cannot be expressed in the wire format is skipped with a note, or thrown
 * for what would make the prop wrong (a multi-material mesh, a texture with no image).
 */
export async function serialize(root: THREE.Object3D): Promise<{ data: PropData; transfer: Transferable[] }> {
  const data: PropData = { meshes: [], geometries: [], materials: [], textures: [], notes: [] }
  const transfer: Transferable[] = []
  const geometries = new Map<unknown, number>()
  const materials = new Map<unknown, number>()
  const textures = new Map<unknown, number>()
  root.updateMatrixWorld(true)
  const rootInverse = root.matrixWorld.clone().invert()

  const texture = async (t: THREE.Texture): Promise<number> => {
    if (textures.has(t)) return textures.get(t)!
    const image = t.image as Image | undefined
    if (!image || !(image.width > 0 && image.height > 0) || !('getContext' in image || 'close' in image))
      throw new Error('a texture has no painted image (only canvas textures are allowed)')
    const bitmap = await createImageBitmap(image as ImageBitmapSource)
    transfer.push(bitmap)
    data.textures.push({
      image: bitmap,
      srgb: t.colorSpace === 'srgb',
      flipY: t.flipY,
      wrapS: WRAPS[t.wrapS] ?? 'clamp',
      wrapT: WRAPS[t.wrapT] ?? 'clamp',
      repeat: [t.repeat.x, t.repeat.y],
      offset: [t.offset.x, t.offset.y],
      center: [t.center.x, t.center.y],
      rotation: t.rotation,
      anisotropy: t.anisotropy,
    })
    textures.set(t, data.textures.length - 1)
    return data.textures.length - 1
  }

  const material = async (m: THREE.Material): Promise<number> => {
    if (materials.has(m)) return materials.get(m)!
    const s = m as THREE.MeshStandardMaterial
    // Only the standard preset exists; the home rejects anything else by name.
    const preset = s.isMeshStandardMaterial ? 'standard' : String(m.type).slice(0, 40)
    data.materials.push({
      preset,
      color: rgb(s.color),
      emissive: s.emissive ? rgb(s.emissive) : [0, 0, 0],
      emissiveIntensity: s.emissiveIntensity ?? 1,
      roughness: s.roughness ?? 1,
      metalness: s.metalness ?? 0,
      opacity: m.opacity,
      transparent: m.transparent,
      depthWrite: m.depthWrite,
      flatShading: Boolean(s.flatShading),
      side: SIDES[m.side] ?? 'front',
      map: s.map ? await texture(s.map) : null,
    })
    materials.set(m, data.materials.length - 1)
    return data.materials.length - 1
  }

  const geometry = (g: THREE.BufferGeometry): number => {
    if (geometries.has(g)) return geometries.get(g)!
    const copy = (name: string) => {
      const a = g.attributes[name] as THREE.BufferAttribute | undefined
      if (!a) return null
      const out = new Float32Array(a.count * a.itemSize)
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k)
      transfer.push(out.buffer)
      return out
    }
    const position = copy('position')
    if (!position) throw new Error('a mesh has no positions')
    let index: Uint16Array | Uint32Array | null = null
    if (g.index) {
      const src = g.index.array
      index = position.length / 3 <= 65535 ? new Uint16Array(src.length) : new Uint32Array(src.length)
      index.set(src)
      transfer.push(index.buffer)
    }
    data.geometries.push({ position, normal: copy('normal'), uv: copy('uv'), index })
    geometries.set(g, data.geometries.length - 1)
    return data.geometries.length - 1
  }

  const meshes: THREE.Mesh[] = []
  const skipped = new Map<string, number>()
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
    else if (o !== root && !(o as THREE.Group).isGroup && o.type !== 'Object3D') {
      const type = String(o.type).slice(0, 40)
      skipped.set(type, (skipped.get(type) ?? 0) + 1)
    }
  })
  for (const [type, n] of skipped) data.notes.push(`skipped ${n} ${type}`)
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) throw new Error('a mesh has several materials; use one per mesh')
    const matrix = rootInverse.clone().multiply(mesh.matrixWorld)
    data.meshes.push({ geometry: geometry(mesh.geometry), material: await material(mesh.material), matrix: [...matrix.elements] })
  }
  return { data, transfer }
}
