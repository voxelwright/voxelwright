// Regroup S3 (#50): the theme redecorates. With ?redecorate=1, a theme in REDECORATED
// gets its own versions of the five most visible kitchen props and a headwear piece
// for each felt villager, written by the host's prop maker in the theme's style
// (POST /people/:id/props with `style`), run in the prop sandbox, checked and rebuilt.
// Each new piece stands where its original stood, scaled to the original's box, so
// footprints, the table top and seat heights hold; the original is hidden under it.
//
// On a theme change the originals show at once and each theme piece fades in as it
// is ready ("redecorated over time"). Made pieces are kept in the person's library
// (named "<theme> redecoration, <key>: ..."), so a later visit or switch back finds
// them with no model call. The home's look restores every original. A failed or
// refused piece leaves its original in place. Dev builds only, like the sandbox.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { releaseGpu } from '../../kernel'
import { chosen, presetId } from '../index'
import type { Theme } from '../tokens'
import { call, keepItem, library, libraryItem } from '../../villager'
import { ACCESSORIES, FELT, heads, PROPS, type Slot, type Target } from './targets'

/** The looks this prototype redecorates; any other look keeps the originals (and costs no model call). */
const REDECORATED = new Set(['neon-night', 'comic'])
const params = new URLSearchParams(location.search)
const PERSON = params.get('person') ?? 'alex'
const FADE_MS = 700
const RESCAN = 20
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

export interface ItemStatus {
  theme: string
  key: string
  state: 'waiting' | 'making' | 'ready' | 'failed'
  source?: 'made' | 'library'
  /** The host's make call, ms (the model's time plus the host's). */
  hostMs?: number
  /** Sandbox run, check and rebuild, ms. */
  sandboxMs?: number
  /** From the theme change until it stood in the room, ms. */
  readyMs?: number
  costUsd?: number | null
  why?: string
  tries?: number
  /** Why earlier takes were refused (sandbox, check or rebuild). */
  refused?: string[]
}

/** A theme's piece once built: kept hidden while another look is on. */
interface Built { object: THREE.Group; status: ItemStatus }

const prefix = (t: Theme, key: string) => `${t.id} redecoration, ${key}:`
/** The host's prop maker with the theme's style guide in place of the house one. */
const makeProp = (person: string, what: string, size: number[], variant: number, style: string) =>
  call<{ item: string; name: string; module: string; costUsd: number | null }>(`/people/${person}/props`, { what, size, variant, style })
const styleOf = (t: Theme, part: 'props' | 'costumes') =>
  `${t.label}. ${t.about} ${part === 'props' ? `Props: ${t.props.hint}` : `Villager accessories: ${t.costumes.hint}`}`.slice(0, 400)

/** Scale `object` to fill `box` (frame space) exactly, standing in it: footprint, height and seat line follow. */
/**
 * A surface's top: the top of its widest part (a table's slab). Whatever the model stood on
 * that top (a centrepiece) is dropped, so the home's own things on the table stay in view.
 */
function clearTop(object: THREE.Object3D): number | undefined {
  const parts: { mesh: THREE.Mesh; box: THREE.Box3 }[] = []
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) parts.push({ mesh: o as THREE.Mesh, box: new THREE.Box3().setFromObject(o) })
  })
  const area = (b: THREE.Box3) => (b.max.x - b.min.x) * (b.max.z - b.min.z)
  const widest = parts.reduce((a, p) => (area(p.box) > area(a.box) ? p : a), parts[0])
  if (!widest) return undefined
  const top = widest.box.max.y
  // Thin insets and inlays lying on the top stay; anything standing up off it, or floating above it, goes.
  for (const p of parts) if (p.box.min.y >= top - 0.01 && (p.box.max.y - p.box.min.y > 0.03 || p.box.min.y > top + 0.02)) p.mesh.removeFromParent()
  return top
}

/** `top` (a surface): the height in the object that lands on the box's top, in place of its highest point. */
function fit(object: THREE.Object3D, box: THREE.Box3, uniform = false, top?: number): THREE.Group {
  const b = new THREE.Box3().setFromObject(object)
  const s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3())
  if (!Number.isFinite(s.x + s.y + s.z) || s.x * s.y * s.z === 0) throw new Error('it came out with no size')
  const t = box.getSize(new THREE.Vector3()), tc = box.getCenter(new THREE.Vector3())
  object.position.set(-c.x, -b.min.y, -c.z)
  const holder = new THREE.Group()
  holder.add(object)
  const k = (a: number, b: number) => Math.min(3, Math.max(1 / 3, a / b))
  // Uniform (an accessory): the model's own proportions, as wide as the box allows.
  if (uniform) holder.scale.setScalar(Math.min(t.x / s.x, t.z / s.z))
  else holder.scale.set(k(t.x, s.x), k(t.y, top === undefined ? s.y : top - b.min.y), k(t.z, s.z))
  holder.position.set(tc.x, box.min.y, tc.z)
  return holder
}

export default {
  name: 'redecorate',
  inject: ['stage'],
  apply(ctx: Context) {
    const { scene } = ctx.stage
    const tools = Promise.all([import('../../props/sandbox'), import('../../props/rebuild')])
    let box: import('../../props/sandbox').PropBox | null = null
    /** theme id -> key -> built piece (or a promise of one). */
    const built = new Map<string, Map<string, Promise<Built | null>>>()
    const statuses: ItemStatus[] = []
    /** Placed instances: one per slot (chairs have four), toggled with the look. */
    const placed: { theme: string; key: string; holder: THREE.Object3D; hide: THREE.Object3D[]; fade: number }[] = []
    /** Originals hidden by a theme piece, with how they were. */
    const hidden = new Map<THREE.Object3D, boolean>()
    let current = ''
    let switchedAt = 0
    /** Set on unload: a piece still being made is never added after it. */
    let cancelled = false
    let libraryList: Promise<{ id: string; name: string }[]> | null = null

    const fromModule = async (module: string) => {
      const [{ PropBox }, { validate, rebuild }] = await tools
      box ??= new PropBox()
      const result = await box.run(module)
      if (!result.ok) throw new Error(`sandbox: ${result.reason}`)
      const checked = validate(result.data)
      if ('reason' in checked) throw new Error(`rejected: ${checked.reason}`)
      return rebuild(checked.prop)
    }

    /** From the library if this look's piece was made before, else from the maker; one retry with another take. */
    const make = async (t: Theme, target: Omit<Target, 'find'>, size: number[], part: 'props' | 'costumes'): Promise<Built | null> => {
      const status: ItemStatus = { theme: t.id, key: target.key, state: 'waiting', tries: 0 }
      statuses.push(status)
      const name = prefix(t, target.key)
      libraryList ??= library(PERSON).then((r) => (r.ok ? r.items : []))
      const saved = (await libraryList).find((i) => i.name.startsWith(name))
      for (let variant = 0; variant < 2; variant++) {
        status.state = 'making'
        status.tries = variant + 1
        let module: string
        let item: string | null = null
        const t0 = performance.now()
        if (saved && variant === 0) {
          const item = await libraryItem(PERSON, saved.id)
          if (!item.ok) continue
          module = item.module
          status.source = 'library'
          status.costUsd = 0
        } else {
          let made = await makeProp(PERSON, `${name} ${target.what}`, size, variant, styleOf(t, part))
          // One make at a time per person: wait out another one rather than fail.
          for (let wait = 0; !made.ok && made.why === 'busy' && wait < 60; wait++) {
            await new Promise((r) => setTimeout(r, 2000))
            made = await makeProp(PERSON, `${name} ${target.what}`, size, variant, styleOf(t, part))
          }
          if (!made.ok) {
            status.why = `maker: ${made.why}`
            continue
          }
          status.source = 'made'
          status.hostMs = Math.round(made.ms)
          status.costUsd = made.costUsd
          module = made.module
          item = made.item
        }
        try {
          const t1 = performance.now()
          const object = await fromModule(module)
          status.sandboxMs = Math.round(performance.now() - t1)
          if (status.source === 'library') status.hostMs = Math.round(t1 - t0)
          object.userData.themeOwned = true
          object.name = `redecorate ${t.id} ${target.key}`
          // Kept in the library only once it passed the sandbox, so a refused take is never found again.
          if (item) void keepItem(PERSON, item)
          status.state = 'ready'
          status.why = undefined
          return { object, status }
        } catch (error) {
          status.why = String((error as Error).message ?? error).slice(0, 200)
          ;(status.refused ??= []).push(status.why)
        }
      }
      status.state = 'failed'
      return null
    }

    const piece = (t: Theme, target: Omit<Target, 'find'>, size: number[], part: 'props' | 'costumes') => {
      let own = built.get(t.id)
      if (!own) built.set(t.id, (own = new Map()))
      let p = own.get(target.key)
      if (!p) own.set(target.key, (p = make(t, target, size, part)))
      return p
    }

    // ── Placing and fading ───────────────────────────────────────────────────
    const fadeMats = (holder: THREE.Object3D) => {
      const mats = new Set<THREE.Material>()
      holder.traverse((o) => {
        const m = (o as THREE.Mesh).material
        if (m) for (const x of ([] as THREE.Material[]).concat(m)) mats.add(x)
      })
      return [...mats]
    }
    /** Each material's own transparency, kept while it fades. */
    const own = new WeakMap<THREE.Material, { transparent: boolean; opacity: number; depthWrite: boolean }>()
    const setFade = (holder: THREE.Object3D, k: number) => {
      for (const m of fadeMats(holder)) {
        let o = own.get(m)
        if (!o) own.set(m, (o = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }))
        const fading = k < 1
        if (m.transparent !== (fading || o.transparent)) {
          m.transparent = fading || o.transparent
          m.needsUpdate = true
        }
        m.opacity = o.opacity * k
        m.depthWrite = fading ? false : o.depthWrite
      }
    }
    const hideOriginals = (list: THREE.Object3D[]) => {
      for (const o of list) {
        if (!hidden.has(o)) hidden.set(o, o.visible)
        o.visible = false
      }
    }
    const restoreAll = () => {
      for (const [o, was] of hidden) o.visible = was
      hidden.clear()
      for (const p of placed) p.holder.visible = false
    }

    /** Stand a theme piece in every slot, fading in; the originals go when it is solid. */
    const standIn = (t: Theme, key: string, object: THREE.Group, slots: Slot[], surface?: boolean) => {
      const top = surface ? clearTop(object) : undefined
      // Every slot is fitted before any is added, so a piece that cannot be fitted adds nothing.
      const holders = slots.map((slot, i) => fit(i === 0 ? object : object.clone(true), slot.box, false, top))
      slots.forEach((slot, i) => {
        const holder = holders[i]
        holder.userData.themeOwned = true
        holder.name = `redecorate ${t.id} ${key}`
        holder.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true
        })
        slot.frame.add(holder)
        placed.push({ theme: t.id, key, holder, hide: slot.hide, fade: reducedMotion.matches ? 1 : 0 })
      })
      if (reducedMotion.matches) for (const s of slots) hideOriginals(s.hide)
    }

    /** Accessories: one per felt villager's head, in turn. Kept costumes get none. */
    const dress = (t: Theme, pieces: (Built | null)[]) => {
      if (!FELT || cancelled) return
      heads(scene).forEach(({ root, head, skull }, i) => {
        const key = `${t.id} head ${String(root.userData.villagerId)}`
        let p = placed.find((x) => x.key === key)
        const keep = root.userData.keepCostume === true
        if (p) {
          p.holder.visible = !keep && current === t.id
          return
        }
        const made = pieces[i % pieces.length]
        if (!made || keep) return
        // The skull's box in the head's space: the accessory sits down over its crown.
        // From the skull's own transform, not world matrices: a villager may be mid-animation (or still popping in) when dressed.
        const geo = (skull as THREE.Mesh).geometry
        if (!geo.boundingBox) geo.computeBoundingBox()
        skull.updateMatrix()
        const sb = geo.boundingBox!.clone().applyMatrix4(skull.matrix)
        const s = sb.getSize(new THREE.Vector3())
        // Crown-sized and set down a little over the top, clear of the eyes.
        const target = new THREE.Box3(
          new THREE.Vector3(-s.x * 0.4, sb.max.y - s.y * 0.12, -s.z * 0.4),
          new THREE.Vector3(s.x * 0.4, sb.max.y + s.y * 0.3, s.z * 0.4),
        )
        let holder: THREE.Group
        try {
          holder = fit(made.object.clone(true), target, true)
        } catch (error) {
          console.warn(`redecorate: ${key} could not be fitted, the villager keeps its own look:`, error)
          return
        }
        holder.userData.themeOwned = true
        holder.name = key
        head.add(holder)
        p = { theme: t.id, key, holder, hide: [], fade: reducedMotion.matches ? 1 : 0 }
        placed.push(p)
      })
    }

    // ── A theme change ───────────────────────────────────────────────────────
    const accessoriesFor = new Map<string, Promise<(Built | null)[]>>()
    const redecorate = (t: Theme) => {
      restoreAll()
      current = t.id
      switchedAt = performance.now()
      // Only the real built-ins: a written or saved look may carry any id.
      if (!REDECORATED.has(presetId(t) ?? '')) return
      // Pieces already standing for this look come back at once.
      for (const p of placed) if (p.theme === t.id) {
        p.holder.visible = true
        p.fade = 1
        setFade(p.holder, 1)
        hideOriginals(p.hide)
      }
      void (async () => {
        // Most visible first; each one stands as soon as it is ready.
        for (const target of PROPS) {
          if (cancelled || current !== t.id) return
          if (placed.some((p) => p.theme === t.id && p.key === target.key)) continue
          let slots = target.find(scene)
          for (let n = 0; !slots && n < 50 && current === t.id; n++) {
            await new Promise((r) => setTimeout(r, 200))
            slots = target.find(scene)
          }
          if (!slots) continue
          const size = slots[0].box.getSize(new THREE.Vector3()).toArray().map((n) => +Math.max(0.05, n).toFixed(2))
          const made = await piece(t, target, size, 'props')
          if (!made) continue
          if (made.status.readyMs === undefined) made.status.readyMs = Math.round(performance.now() - switchedAt)
          if (cancelled) return
          if (current !== t.id || placed.some((p) => p.theme === t.id && p.key === target.key)) continue
          // One piece that cannot be placed leaves its original and skips only itself.
          try {
            standIn(t, target.key, made.object, slots, target.surface)
          } catch (error) {
            made.status.state = 'failed'
            made.status.why = `placing: ${String((error as Error)?.message ?? error).slice(0, 160)}`
          }
        }
        if (!FELT) return
        let acc = accessoriesFor.get(t.id)
        if (!acc) accessoriesFor.set(t.id, (acc = (async () => {
          const out: (Built | null)[] = []
          for (const a of ACCESSORIES) out.push(await piece(t, a, [0.3, 0.14, 0.3], 'costumes'))
          return out
        })()))
        const pieces = await acc
        if (cancelled) return
        for (const p of pieces) if (p && p.status.readyMs === undefined) p.status.readyMs = Math.round(performance.now() - switchedAt)
        if (current === t.id) dress(t, pieces)
      })()
    }

    let frame = 0
    let last = performance.now()
    ctx.on('village/frame', () => {
      const now = performance.now()
      const dt = now - last
      last = now
      for (const p of placed) {
        if (p.fade >= 1 || !p.holder.visible) continue
        p.fade = Math.min(1, p.fade + dt / FADE_MS)
        setFade(p.holder, p.fade * p.fade * (3 - 2 * p.fade))
        if (p.fade >= 1) hideOriginals(p.hide)
      }
      if (++frame % RESCAN) return
      const t = chosen()
      if (t.id !== current) redecorate(t)
      // New villagers, or one asked to keep its costume.
      else if (FELT && REDECORATED.has(presetId(t) ?? '')) {
        const acc = accessoriesFor.get(t.id)
        if (acc) void acc.then((pieces) => !cancelled && current === t.id && dress(t, pieces))
      }
    })

    const status = () => {
      const t = current
      const mine = statuses.filter((s) => s.theme === t)
      const expected = REDECORATED.has(t) ? PROPS.length + (FELT ? ACCESSORIES.length : 0) : 0
      const settled = mine.filter((s) => s.state === 'ready' || s.state === 'failed')
      return {
        theme: t,
        done: t !== '' && t === chosen().id && settled.length >= expected && placed.filter((p) => p.theme === t).every((p) => p.fade >= 1),
        sinceSwitchMs: Math.round(performance.now() - switchedAt),
        items: statuses.map((s) => ({ ...s })),
        costUsd: +statuses.reduce((n, s) => n + (s.source === 'made' ? s.costUsd ?? 0 : 0), 0).toFixed(4),
      }
    }
    const village = (window as unknown as { village?: Record<string, unknown> }).village
    if (village) village.redecorate = { status }

    ctx.effect(() => () => {
      cancelled = true
      restoreAll()
      for (const p of placed) p.holder.removeFromParent()
      for (const own of built.values()) for (const p of own.values()) void p.then((b) => b && releaseGpu(b.object))
      scene.getObjectByName('redecorate armchair frame')?.removeFromParent()
      box?.dispose()
      if (village) delete village.redecorate
    }, 'redecorate')
  },
}
