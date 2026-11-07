import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace } from '../kernel'
import { costumeVersion, theme, tick } from './index'
import { PAINTERS } from './paint'
import { worlds } from './world'
import type { Shift, Surface, Surfaces, Theme } from './tokens'
import { shade } from './shade/apply'

type LightRole = 'key' | 'fill' | 'rim' | 'practical'
type SurfaceRole = keyof Surfaces
const SURFACE_ROLES: ReadonlySet<string> = new Set<SurfaceRole>(['wall', 'floor', 'view', 'beam', 'glow', 'other', 'trim', 'backdrop', 'foliage', 'contact'])

/**
 * The painted sky stands on the worktable around the dollhouse's yard (x -6.2 to 6.2,
 * z -8.6 to 6.6 in ../plugins/diorama.ts), just outside its corners. It is a card, not a
 * horizon: the dollhouse camera looks down at about 30 degrees and sees its lowest few
 * metres, so the painter lays the hills and clouds low.
 */
const SKY = { x: 0, z: -1, radius: 10.2, height: 3.5, base: -0.345 }

interface LightBase { role: LightRole; color: THREE.Color; ground?: THREE.Color; radius?: number }
interface MaterialBase { role: SurfaceRole; color?: THREE.Color; emissive?: THREE.Color; roughness?: number; metalness?: number; map?: THREE.Texture | null }
/** A painter's texture as one material wears it: its own copy, with that material's repeat, offset, rotation and wrap. */
interface Worn { painter: string; map: THREE.Texture }

type Lit = THREE.Light & { groundColor?: THREE.Color; castShadow: boolean; shadow?: THREE.LightShadow }
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
    // A theme's `paint`: each painter paints once (`painted`), and every material that names it
    // wears its own clone (`worn`), so a floor tiled 8 times and a table tiled once can share a
    // painter. Clones go when a material stops wearing them; painters nothing wears go after
    // each theme change; both go on unload.
    const painted = new Map<string, THREE.Texture>()
    const worn = new Map<Painted, Worn>()
    const unwear = (m: Painted) => {
      const w = worn.get(m)
      if (!w) return
      w.map.dispose()
      worn.delete(m)
    }
    /** The painter's texture for this material, laid out as the material's own map was (none for a map it never had). */
    const wear = (m: Painted, painter: string, own: THREE.Texture | null): THREE.Texture | null => {
      const w = worn.get(m)
      if (w?.painter === painter) return w.map
      if (!Object.hasOwn(PAINTERS, painter)) return null
      let source = painted.get(painter)
      if (!source) painted.set(painter, (source = PAINTERS[painter]()))
      const map = source.clone()
      if (own) {
        map.wrapS = own.wrapS
        map.wrapT = own.wrapT
        map.repeat.copy(own.repeat)
        map.offset.copy(own.offset)
        map.center.copy(own.center)
        map.rotation = own.rotation
        map.channel = own.channel
        map.matrixAutoUpdate = own.matrixAutoUpdate
        if (!own.matrixAutoUpdate) map.matrix.copy(own.matrix)
      }
      unwear(m)
      worn.set(m, { painter, map })
      return map
    }
    /** Painters nothing wears any more (the sky's is its own). */
    const sweep = () => {
      const used = new Set([...worn.values()].map((w) => w.painter))
      for (const [name, tex] of painted) if (!used.has(name)) {
        tex.dispose()
        painted.delete(name)
      }
    }

    // The theme's painted sky: one open cylinder seen from inside, unlit and out of the fog,
    // which nothing picks or shadows. Released when a theme drops it and on unload.
    let sky: { painter: string; mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> } | null = null
    const dropSky = () => {
      if (!sky) return
      sky.mesh.removeFromParent()
      sky.mesh.geometry.dispose()
      sky.mesh.material.map?.dispose()
      sky.mesh.material.dispose()
      sky = null
    }
    const placeSky = (t: Theme) => {
      const painter = t.sky?.paint
      if (sky?.painter === painter) return
      dropSky()
      if (!painter || !Object.hasOwn(PAINTERS, painter)) return
      const geometry = new THREE.CylinderGeometry(SKY.radius, SKY.radius, SKY.height, 128, 1, true).translate(0, SKY.height / 2, 0)
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: PAINTERS[painter](), side: THREE.BackSide, fog: false }))
      mesh.position.set(SKY.x, SKY.base, SKY.z)
      mesh.name = 'theme sky'
      mesh.userData.themeOwned = true
      mesh.userData.exterior = true // a theme's world stands its own sky (./world)
      mesh.raycast = () => {}
      scene.add(mesh)
      sky = { painter, mesh }
    }
    const world = worlds(scene)
    const exposure = renderer.toneMappingExposure
    let applied: Theme | null = null
    shade(ctx)

    const light = (l: Lit, t: Theme, force: boolean) => {
      let base = lights.get(l)
      if (base && !force) return
      if (!base) {
        const role = lightRole(l)
        if (!role) return
        base = { role, color: l.color.clone(), ground: l.groundColor?.clone(), radius: l.shadow?.radius }
        lights.set(l, base)
      }
      const shift = t.light[base.role]
      shifted(base.color, shift, l.color)
      // The shadow's blur radius is a uniform, so a softer key costs no rebuild.
      if (base.role === 'key' && l.shadow && base.radius !== undefined) l.shadow.radius = base.radius * (t.light.key.soften ?? 1)
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
      // Optional roles (trim, backdrop) read as `other` in a theme that leaves them out; a contact shadow stays as it is.
      const s: Surface = t.surfaces[base.role] ?? (base.role === 'contact' ? {} : t.surfaces.other)
      if (base.role === 'glow') {
        if (base.emissive && m.emissive) shifted(base.emissive, s, m.emissive)
      } else {
        if (base.color && m.color) shifted(base.color, s, m.color)
        if (base.emissive && m.emissive) {
          if (s.emissive) m.emissive.set(s.emissive).multiplyScalar(s.glow ?? 1)
          else m.emissive.copy(base.emissive)
        }
      }
      // A theme's roughness never frosts glass: a transmissive pane keeps its own.
      if (base.roughness !== undefined) m.roughness = (m as { transmission?: number }).transmission ? base.roughness : s.roughness ?? base.roughness
      if (base.metalness !== undefined) m.metalness = s.metalness ?? base.metalness
      // A material with a map slot (`null` when empty) can wear a painter; without one, nothing to paint.
      if (base.map !== undefined) {
        const map = (s.paint && wear(m, s.paint, base.map)) || base.map
        if (m.map !== map) {
          m.map = map
          m.needsUpdate = true
        }
        if (map === base.map) unwear(m)
      }
    }

    /** Put one light's or material's own values back and forget them, so a later theme starts from them again. */
    const restoreLight = (l: Lit) => {
      const lb = lights.get(l)
      if (!lb) return
      l.color.copy(lb.color)
      if (l.groundColor && lb.ground) l.groundColor.copy(lb.ground)
      if (l.shadow && lb.radius !== undefined) l.shadow.radius = lb.radius
      lights.delete(l)
    }
    const restoreMaterial = (m: Painted) => {
      const mb = materials.get(m)
      if (!mb) return
      if (mb.color && m.color) m.color.copy(mb.color)
      if (mb.emissive && m.emissive) m.emissive.copy(mb.emissive)
      if (mb.roughness !== undefined) m.roughness = mb.roughness
      if (mb.metalness !== undefined) m.metalness = mb.metalness
      if (mb.map !== undefined && m.map !== mb.map) {
        m.map = mb.map
        m.needsUpdate = true
      }
      unwear(m)
      materials.delete(m)
    }

    // A villager whose figure root carries userData.keepCostume keeps its own look: its
    // whole subtree is left out, and anything themed in it before is put back. A material
    // it shares with something else stays its own too, so the two never fight.
    const keptLights: Lit[] = [], keptMats = new Set<Painted>(), themedLights: Lit[] = [], themedMats: Painted[] = []
    const gather = (o: THREE.Object3D, keep: boolean) => {
      if (o.userData.themeOwned) return
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
      // A material that left the scene (a room unloaded) gives back its painted copy.
      if (worn.size) {
        const seen = new Set(themedMats)
        for (const m of [...worn.keys()]) if (!seen.has(m)) restoreMaterial(m)
      }
      keptLights.length = themedLights.length = themedMats.length = 0
      keptMats.clear()
      const fog = scene.fog
      if (fog instanceof THREE.Fog) {
        if (!fogs.has(fog)) fogs.set(fog, fog.color.clone())
        shifted(fogs.get(fog)!, t.fog, fog.color)
      }
      renderer.toneMappingExposure = t.light.exposure
      placeSky(t)
      world.place(t)
      if (force) sweep()
    }

    let frame = 0
    let costumes = costumeVersion()
    ctx.on('village/frame', () => {
      tick()
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
      for (const m of [...worn.keys()]) unwear(m)
      sweep()
      dropSky()
      world.drop()
    }, 'theme')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
