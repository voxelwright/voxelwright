// #42 experiment, dev only: ?props=<run-id>[,<run-id>] loads generated props from
// home/generated/props/<run-id>/ (git-ignored) into the kitchen. main.ts loads this
// plugin only when the flag is present in a dev build; without it nothing changes.
// Arm "spec" files are JSON read by the trusted interpreter in spec.ts. Arm "code"
// files are model-written modules: they run here only as this experiment's control.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Context } from 'cordis'
import { own, releaseGpu } from '../kernel'
import { WALL_Z } from '../layout'
import * as paint from '../paint'
import { makeChair, pineMaterial } from '../plugins/chairs'
import { build as buildSpec, check as checkSpec } from './spec'

/** What a generated code module receives. It imports nothing itself. */
export const api = { THREE, RoundedBoxGeometry, paint }

interface Meta { arm: 'code' | 'spec'; prompt: number; file: string }

/** Where each prompt's result stands: base point, facing, and whether it hangs on the back wall. */
const ANCHORS: Record<number, { at: [number, number, number]; ry: number; wall?: boolean }> = {
  1: { at: [-1.6, 0, 1.9], ry: 0 },
  2: { at: [-1.6, 0, 1.9], ry: 0 },
  3: { at: [1.7, 0, 2.2], ry: -0.5 },
  4: { at: [0.45, 0, WALL_Z + 0.006], ry: 0, wall: true },
  5: { at: [2.75, 0.9, -1.85], ry: 0 },
}

async function make(meta: Meta, base: string): Promise<THREE.Object3D> {
  const url = `${base}/${meta.file}`
  if (meta.arm === 'spec') {
    const checked = checkSpec(JSON.parse(await (await fetch(url)).text()))
    if (!checked.spec) throw new Error(checked.errors.join('; '))
    return buildSpec(checked.spec, meta.prompt * 13)
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`transform failed: ${(await res.text()).slice(0, 600)}`)
  const mod = await import(/* @vite-ignore */ `${url}?t=${Date.now()}`)
  if (typeof mod.build !== 'function') throw new Error('module does not export build(api)')
  const object = mod.build(api)
  if (!(object instanceof THREE.Object3D)) throw new Error('build(api) did not return a THREE.Object3D from api.THREE')
  return object
}

/** Ground the object, centre it on its anchor (a wall piece sits against the wall), and measure it. */
function seat(object: THREE.Object3D, prompt: number) {
  const holder = new THREE.Group()
  holder.add(object)
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.x + size.y + size.z) || size.length() === 0) throw new Error('prop has no visible size')
  if (Math.max(size.x, size.y, size.z) > 4) throw new Error(`prop is ${size.toArray().map((v) => v.toFixed(2))} m, larger than 4 m`)
  const anchor = ANCHORS[prompt] ?? ANCHORS[1]
  const centre = box.getCenter(new THREE.Vector3())
  object.position.sub(new THREE.Vector3(centre.x, box.min.y, anchor.wall ? box.min.z : centre.z))
  holder.position.set(...anchor.at)
  holder.rotation.y = anchor.ry
  let triangles = 0, meshes = 0
  holder.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = mesh.receiveShadow = true
    meshes++
    const g = mesh.geometry
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
  })
  return { holder, triangles, meshes, size: size.toArray() }
}

export default {
  name: 'props',
  inject: ['stage', 'view'],
  apply(ctx: Context) {
    const params = new URLSearchParams(location.search)
    const ids = (params.get('props') ?? '').split(',').filter((id) => /^[\w-]+$/.test(id))
    const report: Record<string, unknown> = {}
    const placed: THREE.Object3D[] = []
    const loading = Promise.all(ids.map(async (id) => {
      const base = `/generated/props/${id}`
      try {
        const meta: Meta = await (await fetch(`${base}/meta.json`)).json()
        const t0 = performance.now()
        const { holder, triangles, meshes, size } = seat(await make(meta, base), meta.prompt)
        holder.name = `props ${id}`
        own(ctx, holder)
        placed.push(holder)
        report[id] = { ok: true, triangles, meshes, size, buildMs: performance.now() - t0 }
      } catch (error) {
        report[id] = { ok: false, error: String(error) }
      }
    })).then(() => {
      if (params.get('focus') && placed.length) {
        const box = new THREE.Box3()
        for (const o of placed) box.expandByObject(o)
        const centre = box.getCenter(new THREE.Vector3())
        const radius = Math.max(0.35, box.getSize(new THREE.Vector3()).length() / 2)
        const wall = placed.some((o) => o.position.z < WALL_Z + 0.1)
        const dir = new THREE.Vector3(wall ? 0.15 : 0.45, 0.5, 1).normalize()
        ctx.view.focus({ position: centre.clone().addScaledVector(dir, radius * 2.6 + 0.4), look: centre }, 60)
      }
      return report
    })

    /** Floor measurement: place a copy of an existing prop from a parsed command, no generation. */
    const SPOTS: Record<string, [number, number, number]> = { window: [-0.85, 0, -1.4], table: [-1.1, 0, 0.9], fridge: [0.9, 0, -1.0], door: [-2.6, 0, -1.3] }
    const place = async (command: string) => {
      const t0 = performance.now()
      const m = /^(?:put|place|add)\s+(?:a|an|another|one more)?\s*chair\s+(?:by|near|next to|at)\s+(?:the\s+)?(window|table|fridge|door)\b/i.exec(command.trim())
      const t1 = performance.now()
      if (!m) return { ok: false, parseMs: t1 - t0 }
      const chair = makeChair(pineMaterial(), new THREE.MeshStandardMaterial({ color: '#e3dccf', roughness: 0.95 }))
      chair.name = `props chair ${m[1]}`
      chair.position.set(...SPOTS[m[1].toLowerCase()])
      own(ctx, chair)
      const t2 = performance.now()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return { ok: true, parseMs: t1 - t0, buildMs: t2 - t1, toFrameMs: performance.now() - t0 }
    }

    /** Builds one generated file without placing it, for the runner's first-try and repair checks. */
    const checkFile = async (meta: Meta, base: string) => {
      try {
        const { holder, triangles, meshes, size } = seat(await make(meta, base), meta.prompt)
        releaseGpu(holder)
        return { ok: true, triangles, meshes, size }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    }

    ctx.effect(() => {
      Object.assign(window, { villageProps: { loaded: loading, place, check: checkFile } })
      return () => delete (window as { villageProps?: unknown }).villageProps
    })
  },
}
