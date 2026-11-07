// #42 prop sandbox, worker side. Bundled on its own by the `prop-box` Vite plugin
// (three/webgpu aliased to three core) and started from a blob inside the sealed
// iframe, so it inherits that frame's CSP: no network, no eval, no storage.
// One worker runs one module and is then terminated by the relay.
//
// The module is model output. It may export build(api) returning an object
// (the experiment's contract) or default(prop, api); either way it gets three.js,
// the painters and `prop`. Nothing here is trusted by the home: the relay and the
// page check whatever this posts, including anything the module posts itself.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import * as paint from '../../paint'
import { material, type Material } from '../spec'
import { serialize } from '../wire'

// The DOM lib types self as a window; in a dedicated worker postMessage takes (message, transfer).
const post = self.postMessage.bind(self) as (message: unknown, transfer?: Transferable[]) => void
const now = () => performance.now()

// Narrow the worker before any model code runs. The CSP has no say over the GPU or
// nested workers, so: 2D canvases only (no WebGL, so no GPU work from the box), and
// no nested workers (a nested worker would start with fresh, unnarrowed globals).
// WebGPU is already absent here (navigator.gpu is undefined in the sealed worker).
const getContext = OffscreenCanvas.prototype.getContext as (this: OffscreenCanvas, ...args: unknown[]) => unknown
Object.defineProperty(OffscreenCanvas.prototype, 'getContext', {
  value(this: OffscreenCanvas, type: unknown, ...rest: unknown[]) {
    if (type !== '2d') throw new Error('only 2d canvases are available in the prop sandbox')
    return getContext.call(this, type, ...rest)
  },
  writable: false,
  configurable: false,
})
for (const name of ['Worker', 'SharedWorker']) delete (self as unknown as Record<string, unknown>)[name]

self.onmessage = async (event: MessageEvent<{ id: number; code: string }>) => {
  const { id, code } = event.data
  const notes: string[] = []
  try {
    const root = new THREE.Group()
    const prop = {
      add: (object: unknown) => {
        if (!(object instanceof THREE.Object3D)) throw new Error('prop.add() takes a three.js object')
        root.add(object)
      },
      /** A preset from the spec arm: wood, fabric, painted, metal, ceramic, wallpaper. */
      material: (preset: Material['preset'], options: Omit<Material, 'preset'> = {}, seed = 1) => material({ ...options, preset }, seed),
      note: (text: unknown) => void (notes.length < 20 && notes.push(String(text).slice(0, 200))),
    }
    const api = { THREE, RoundedBoxGeometry, paint, prop }
    const t0 = now()
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const mod = await import(/* @vite-ignore */ url)
    URL.revokeObjectURL(url)
    if (typeof mod.build === 'function') {
      const made = await mod.build(api)
      if (made !== undefined) prop.add(made)
    } else if (typeof mod.default === 'function') await mod.default(prop, api)
    else throw new Error('the module exports neither build(api) nor a default function')
    if (root.children.length === 0) throw new Error('the module added nothing (call prop.add or return an object from build)')
    const t1 = now()
    const { data, transfer } = await serialize(root)
    data.notes.push(...notes)
    const t2 = now()
    post({ type: 'result', id, data, timing: { runMs: t1 - t0, serializeMs: t2 - t1, sentAt: performance.timeOrigin + now() } }, transfer)
  } catch (error) {
    post({ type: 'error', id, reason: String(error instanceof Error ? error.message : error).slice(0, 500), notes })
  }
}
post({ type: 'ready' })
