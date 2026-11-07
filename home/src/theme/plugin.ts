import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace } from '../kernel'
import { costumeVersion, theme, tick } from './index'
import { PAINTERS } from './paint'
import type { Shift, Surface, Surfaces, Theme } from './tokens'

type LightRole = 'key' | 'fill' | 'rim' | 'practical'
type SurfaceRole = keyof Surfaces
const SURFACE_ROLES: ReadonlySet<string> = new Set<SurfaceRole>(['wall', 'floor', 'view', 'beam', 'glow', 'other', 'trim', 'backdrop'])

interface LightBase { role: LightRole; color: THREE.Color; ground?: THREE.Color }
interface MaterialBase { role: SurfaceRole; color?: THREE.Color; emissive?: THREE.Color; roughness?: number; metalness?: number; map?: THREE.Texture | null }

type Lit = THREE.Light & { groundColor?: THREE.Color; castShadow: boolean }
type Painted = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number; roughness?: number; metalness?: number; map?: THREE.Texture | null }

/** How often (frames) the scene is walked for lights and materials added since. */
const RESCAN = 15

/** A light's role: tagged by its plugin with `userData.themeRole`, or read from its kind. */
function lightRole(light: Lit): LightRole | null {
  const tagged = light.userData.themeRole
  if (tagged === 'key' || tagged === 'fill' || tagged === 'rim' || tagged === 'practical') return tagged
  if ((light as THREE.HemisphereLight).isHemisphereLight || (light as THREE.AmbientLight).isAmbientLight) return 'fill'
  if ((light as THREE.DirectionalLight).isDirectionalLight) return light.castShadow ? 'key' : 'rim'
  if ((light as THREE.PointLight).isPointLight || (light as THREE.SpotLight).isSpotLight) return 'practical'
  return null
}

function surfaceRole(material: Painted): SurfaceRole {
  const tagged = material.userData.themeRole
  if (typeof tagged === 'string' && SURFACE_ROLES.has(tagged)) return tagged as SurfaceRole
  const e = material.emissive
  if (e && (e.r + e.g + e.b) > 0.01 && (material.emissiveIntensity ?? 1) > 0) return 'glow'
  return 'other'
}

const target = new THREE.Color()
function shifted(base: THREE.Color, shift: Shift, out: THREE.Color): THREE.Color {
  out.copy(base)
  if (shift.color && shift.tint) out.lerp(target.set(shift.color), shift.tint)
  if (shift.gain !== undefined) out.multiplyScalar(shift.gain)
  return out
}

/**
 * Shifts what plugins made towards the current theme, by role, without the
 * plugins knowing: light colours (a light's level is folded into its colour,
 * because some plugins animate intensity every frame), material colour,
 * emissive, roughness and metalness, the fog's colour and the exposure. Each
 * object's own values are kept the first time it is seen, so a theme is always
 * applied from the plugin's original, and unloading restores them.
 */
export default {
  name: 'theme',
  inject: ['stage'],
  apply(ctx: Context) {
    const { scene, renderer } = ctx.stage
    const lights = new WeakMap<THREE.Light, LightBase>()
    const materials = new WeakMap<THREE.Material, MaterialBase>()
    const fogs = new WeakMap<THREE.Fog, THREE.Color>()
    // Textures painted for a theme's `paint`, one per painter, disposed on unload.
    const painted = new Map<string, THREE.Texture>()
    const paint = (name: string) => {
      let tex = painted.get(name)
      if (!tex && Object.hasOwn(PAINTERS, name)) painted.set(name, (tex = PAINTERS[name]()))
      return tex
    }
    const exposure = renderer.toneMappingExposure
    let applied: Theme | null = null

    const light = (l: Lit, t: Theme, force: boolean) => {
      let base = lights.get(l)
      if (base && !force) return
      if (!base) {
        const role = lightRole(l)
        if (!role) return
        base = { role, color: l.color.clone(), ground: l.groundColor?.clone() }
        lights.set(l, base)
      }
      const shift = t.light[base.role]
      shifted(base.color, shift, l.color)
      if (l.groundColor && base.ground) {
        const fill = t.light.fill
        shifted(base.ground, { color: fill.ground ?? fill.color, tint: fill.tint, gain: fill.gain }, l.groundColor)
      }
    }

    const material = (m: Painted, t: Theme, force: boolean) => {
      let base = materials.get(m)
      if (base && !force) return
      if (!base) {
        base = { role: surfaceRole(m), color: m.color?.clone(), emissive: m.emissive?.clone(), roughness: m.roughness, metalness: m.metalness, map: m.map }
        materials.set(m, base)
      }
      // Optional roles (trim, backdrop) read as `other` in a theme that leaves them out.
      const s: Surface = t.surfaces[base.role] ?? t.surfaces.other
      if (base.role === 'glow') {
        if (base.emissive && m.emissive) shifted(base.emissive, s, m.emissive)
      } else {
        if (base.color && m.color) shifted(base.color, s, m.color)
        if (base.emissive && m.emissive) {
          if (s.emissive) m.emissive.set(s.emissive).multiplyScalar(s.glow ?? 1)
          else m.emissive.copy(base.emissive)
        }
      }
      if (base.roughness !== undefined) m.roughness = s.roughness ?? base.roughness
      if (base.metalness !== undefined) m.metalness = s.metalness ?? base.metalness
      if (base.map) {
        const map = (s.paint && paint(s.paint)) || base.map
        if (m.map !== map) {
          m.map = map
          m.needsUpdate = true
        }
      }
    }

    /** Put one light's or material's own values back and forget them, so a later theme starts from them again. */
    const restoreLight = (l: Lit) => {
      const lb = lights.get(l)
      if (!lb) return
      l.color.copy(lb.color)
      if (l.groundColor && lb.ground) l.groundColor.copy(lb.ground)
      lights.delete(l)
    }
    const restoreMaterial = (m: Painted) => {
      const mb = materials.get(m)
      if (!mb) return
      if (mb.color && m.color) m.color.copy(mb.color)
      if (mb.emissive && m.emissive) m.emissive.copy(mb.emissive)
      if (mb.roughness !== undefined) m.roughness = mb.roughness
      if (mb.metalness !== undefined) m.metalness = mb.metalness
      if (mb.map && m.map !== mb.map) {
        m.map = mb.map
        m.needsUpdate = true
      }
      materials.delete(m)
    }

    // A villager whose figure root carries userData.keepCostume keeps its own look: its
    // whole subtree is left out, and anything themed in it before is put back. A material
    // it shares with something else stays its own too, so the two never fight.
    const keptLights: Lit[] = [], keptMats = new Set<Painted>(), themedLights: Lit[] = [], themedMats: Painted[] = []
    const gather = (o: THREE.Object3D, keep: boolean) => {
      const k = keep || o.userData.keepCostume === true
      if ((o as THREE.Light).isLight) (k ? keptLights : themedLights).push(o as Lit)
      const mats = (o as THREE.Mesh).material
      if (mats) for (const m of ([] as Painted[]).concat(mats as Painted)) k ? keptMats.add(m) : themedMats.push(m)
      for (const child of o.children) gather(child, k)
    }
    const walk = (t: Theme, force: boolean) => {
      gather(scene, false)
      for (const l of keptLights) restoreLight(l)
      for (const m of keptMats) restoreMaterial(m)
      for (const l of themedLights) light(l, t, force)
      for (const m of themedMats) if (!keptMats.has(m)) material(m, t, force)
      keptLights.length = themedLights.length = themedMats.length = 0
      keptMats.clear()
      const fog = scene.fog
      if (fog instanceof THREE.Fog) {
        if (!fogs.has(fog)) fogs.set(fog, fog.color.clone())
        shifted(fogs.get(fog)!, t.fog, fog.color)
      }
      renderer.toneMappingExposure = t.light.exposure
    }

    let frame = 0
    let costumes = costumeVersion()
    ctx.on('village/frame', (dt) => {
      tick(dt)
      const t = theme()
      const changed = t !== applied || costumes !== costumeVersion()
      if (!changed && ++frame % RESCAN) return
      costumes = costumeVersion()
      walk(t, changed)
      applied = t
    })

    ctx.effect(() => () => {
      // Put every plugin's own values back.
      scene.traverse((o) => {
        if ((o as THREE.Light).isLight) restoreLight(o as Lit)
        const mats = (o as THREE.Mesh).material
        if (mats) for (const m of ([] as Painted[]).concat(mats as Painted)) restoreMaterial(m)
      })
      const fog = scene.fog
      if (fog instanceof THREE.Fog && fogs.has(fog)) fog.color.copy(fogs.get(fog)!)
      renderer.toneMappingExposure = exposure
      for (const tex of painted.values()) tex.dispose()
      painted.clear()
    }, 'theme')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
