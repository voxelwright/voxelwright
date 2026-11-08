// What a material is, read from what can be inspected, so a theme can shade it by kind
// (regroup S2, #50). Roles in ../plugin.ts say where a surface is; a class says what it is.
import type * as THREE from 'three/webgpu'

export type MaterialClass = 'metal' | 'glass' | 'emissive' | 'fabric' | 'wood' | 'painted' | 'ceramic' | 'unknown'
export const CLASSES: readonly MaterialClass[] = ['metal', 'glass', 'emissive', 'fabric', 'wood', 'painted', 'ceramic', 'unknown']

type Inspectable = THREE.Material & {
  isMeshStandardMaterial?: boolean
  color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number
  roughness?: number; metalness?: number; transmission?: number; sheen?: number; clearcoat?: number
  map?: THREE.Texture | null; vertexColors?: boolean
}

/** Names that say the surface is wood, from the mesh or a group above it (a chair's pine, the table's slab). */
const WOODY = /\b(table|chair|chairs|pine|wood|plank|shelf|shelves|stool|highchair|door|frame|crate|spoon)\b/i

/** True for anything inside a villager's figure. */
export function inVillager(o: THREE.Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (p.userData.villagerId !== undefined || p.name.startsWith('villager ')) return true
  return false
}

function named(o: THREE.Object3D | null, re: RegExp, depth = 4): boolean {
  for (let p = o, i = 0; p && i < depth; p = p.parent, i++) if (re.test(p.name)) return true
  return false
}

/**
 * The class of a lit (standard or physical) material, or null for anything else (unlit
 * cards, additive glows, toon and lambert materials that already have a look of their own).
 * A plugin can say what its material is with `userData.materialClass` on the material or mesh.
 */
export function classify(m: Inspectable, mesh: THREE.Object3D): MaterialClass | null {
  const tagged = m.userData.materialClass ?? mesh.userData.materialClass
  if (typeof tagged === 'string' && (CLASSES as readonly string[]).includes(tagged)) return tagged as MaterialClass
  if (!m.isMeshStandardMaterial) return null
  const role = m.userData.themeRole
  if (role === 'view' || role === 'beam') return null
  const rough = m.roughness ?? 1, metal = m.metalness ?? 0
  if ((m.transmission ?? 0) > 0 || (m.transparent && m.opacity < 0.6)) return 'glass'
  const e = m.emissive
  if (e && (e.r + e.g + e.b) * (m.emissiveIntensity ?? 1) > 0.15) return 'emissive'
  if (metal >= 0.5) return 'metal'
  if (inVillager(mesh)) return (m.sheen ?? 0) > 0 || rough >= 0.9 ? 'fabric' : rough <= 0.45 ? 'ceramic' : 'fabric'
  if (role === 'wall' || role === 'trim') return 'painted'
  if (role === 'floor') return 'wood'
  if ((m.clearcoat ?? 0) > 0) return 'ceramic'
  if ((m.sheen ?? 0) > 0 || rough >= 0.93) return 'fabric'
  if (m.map && named(mesh, WOODY, 2)) return 'wood'
  if (rough <= 0.45) return 'ceramic'
  if (m.vertexColors || rough >= 0.5) return 'painted'
  return 'unknown'
}
