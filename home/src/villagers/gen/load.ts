// #47 experiment, dev only: ?villager=gen&gen=<run-id>[,<run-id>] places generated
// villagers from home/generated/villagers/<run-id>/ (git-ignored) in the kitchen,
// walking the villagers.ts routines, or idle in a row with &lineup=1 (&close=1 frames
// them). main.ts imports this only in dev builds with the flag; it lives outside
// plugins/ because main.ts bundles everything in plugins/ into every build.
//
// Arm "spec": JSON from the model, checked and built by trusted code (./build.ts).
// Arm "code": a model-written module run in the prop sandbox; only checked wire data
// comes back, and ./assemble.ts makes the Figure. Ids `hand:<key>` and `spec:<key>`
// place a hand-made plush and its coverage spec (./originals.ts).
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, releaseGpu } from '../../kernel'
import { ROUTINES, SCALE } from '../../plugins/villagers'
import { validate } from '../../props/rebuild'
import { PropBox } from '../../props/sandbox'
import * as profiles from '../../voice/profiles'
import { contactShadows, stepCrowd } from '../cast'
import { KINDS, PLUSH } from '../kinds'
import { Villager } from '../rig'
import type { Figure } from '../rig'
import { assemble } from './assemble'
import { build, check } from './build'
import { inspect, type Measures } from './checks'
import { COVERAGE } from './originals'
import type { Persona, VoiceSpec } from './spec'

export interface Meta {
  arm: 'spec' | 'code'; file: string; accent: string; owner?: string; description?: string
  /** The personality pattern the runner asked for (an id from host/src/persona.ts TEMPLATES); provenance only. */
  template?: string
}
interface Made { fig: Figure; name: string; role?: string; bark: string; voice: VoiceSpec | null; persona?: Persona; fixes: string[]; measures?: Measures; timing?: Record<string, number> }

/** Where captures look from: the iso camera's heading, so a figure at this yaw shows three quarters. */
const CAMERA_YAW = 0.6
const FACE_YAW = 0.25
/** The middle of the lineup, on the open floor in front of the table. */
const LINE = { x: -0.25, z: 1.15 }
let box: PropBox | null = null
/** `&checks=off` shows a villager the checks would refuse, to look at what they caught. */
const enforce = new URLSearchParams(location.search).get('checks') !== 'off'

async function fromCode(code: string, phys: boolean, accent: string, seed: number, species = true, mark = true): Promise<Made> {
  box ??= new PropBox()
  const t0 = performance.now()
  const result = await box.run(code)
  if (!result.ok) throw new Error(`sandbox: ${result.reason}`)
  const t1 = performance.now()
  const checked = validate(result.data)
  if ('reason' in checked) throw new Error(`rejected: ${checked.reason}`)
  const a = assemble(checked.prop, result.data, phys, accent, seed, enforce, species, mark)
  return { fig: a.fig, name: a.about.name, role: a.about.role, bark: a.about.bark, voice: a.about.voice, persona: a.about.persona, fixes: a.fixes, measures: a.measures, timing: { sandboxMs: t1 - t0, runMs: result.timing.runMs, assembleMs: performance.now() - t1 } }
}

function fromSpec(raw: unknown, phys: boolean, accent: string, seed: number): Made {
  const { spec, fixes } = check(raw)
  return { fig: build(spec, phys, { accent }, seed), name: spec.name, role: spec.role, bark: spec.bark, voice: spec.voice, persona: spec.persona, fixes }
}

async function make(id: string, phys: boolean, seed: number, meta?: Meta, base?: string): Promise<Made> {
  const [kind, key] = id.split(':')
  const coverage = COVERAGE.find((c) => c.key === key)
  if (kind === 'hand' && coverage) {
    const p = PLUSH[coverage.index]
    return { fig: KINDS.b.build(coverage.index, phys, { accent: coverage.accent }), name: p.name.split(',')[0], bark: p.bark, voice: null, fixes: [] }
  }
  if (kind === 'spec' && coverage) return fromSpec(coverage.spec, phys, coverage.accent, seed)
  base ??= `/generated/villagers/${id}`
  meta ??= await (await fetch(`${base}/meta.json`)).json() as Meta
  const res = await fetch(`${base}/${meta.file}`)
  if (!res.ok) throw new Error(`could not read ${meta.file}: ${res.status}`)
  const text = await res.text()
  // A saved result's persona is shown as written (the spec arm's, in the persona.json shape); the host's
  // checkPersona decides what a live villager becomes, and humour is never decided here.
  return fromFile(text, meta, phys, seed)
}

async function fromFile(text: string, meta: Meta, phys: boolean, seed: number): Promise<Made> {
  if (meta.arm === 'spec') {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (e) {
      throw new Error(`JSON.parse: ${String(e).slice(0, 200)}`)
    }
    return fromSpec(raw, phys, meta.accent, seed)
  }
  return fromCode(text, phys, meta.accent, seed)
}

function measure(root: THREE.Object3D) {
  let triangles = 0, meshes = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    meshes++
    triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3
  })
  return { triangles, meshes }
}

export default {
  name: 'villagergen',
  inject: ['stage', 'view'],
  apply(ctx: Context) {
    const params = new URLSearchParams(location.search)
    const ids = (params.get('gen') ?? '').split(',').filter((id) => /^[\w:-]+$/.test(id) && id !== 'none')
    const lineup = params.get('lineup') === '1'
    const phys = ctx.stage.features().has('phys')
    const report: Record<string, Record<string, unknown>> = {}
    const placed: { id: string; v: Villager; name: string }[] = []
    const group = new THREE.Group()
    group.name = 'villagergen'
    let crowd: Villager[] = []
    let blobs: THREE.Mesh[] = []

    const loading = (async () => {
      const made = await Promise.all(ids.map(async (id, i) => {
        const t0 = performance.now()
        try {
          const m = await make(id, phys, 31 + i * 17)
          report[id] = { ok: true, name: m.name, role: m.role, ...measure(m.fig.root), buildMs: performance.now() - t0, timing: m.timing, fixes: m.fixes, measures: m.measures, height: m.fig.height }
          return { id, m }
        } catch (error) {
          report[id] = { ok: false, error: String(error instanceof Error ? error.message : error) }
          return null
        }
      }))
      const ok = made.filter((x) => x !== null)
      const rows = ok.length > 6 ? Math.ceil(ok.length / 5) : 1
      const perRow = Math.ceil(ok.length / rows)
      ok.forEach(({ id, m }, i) => {
        m.fig.root.scale.setScalar(SCALE)
        let v: Villager
        if (lineup) {
          // A row across the camera's view on the open floor; a second row stands behind it.
          const row = Math.floor(i / perRow), k = i % perRow, n = Math.min(perRow, ok.length - row * perRow)
          const t = (k - (n - 1) / 2) * 0.58
          const back = row * 0.8
          const x = LINE.x + Math.cos(CAMERA_YAW) * t - Math.sin(CAMERA_YAW) * back
          const z = LINE.z - Math.sin(CAMERA_YAW) * t - Math.cos(CAMERA_YAW) * back
          v = new Villager(m.fig, [], { start: 'counter', idle: true, at: [x, z], yaw: FACE_YAW })
        } else {
          const r = ROUTINES[i % ROUTINES.length]
          v = new Villager(m.fig, r.tasks, { start: r.start, seated: r.seated && i < ROUTINES.length, wait: (r.wait ?? 0.4) + Math.floor(i / ROUTINES.length) * 3 })
        }
        placed.push({ id, v, name: m.name })
        // The voice builder's registry, when it exists (#47): each villager speaks in its own generated voice.
        const register = (profiles as unknown as Record<string, unknown>).registerVoice
        if (m.voice && typeof register === 'function') (register as (key: string, profile: VoiceSpec) => void)(`gen:${id}`, m.voice)
      })
      crowd = placed.map((p) => p.v)
      blobs = contactShadows(crowd)
      for (const v of crowd) group.add(v.fig.root)
      if (blobs.length) group.add(...blobs)
      own(ctx, group)
      if (params.get('close') === '1' && placed.length) {
        const c = new THREE.Vector3()
        for (const { v } of placed) c.add(v.pos)
        c.divideScalar(placed.length)
        // Width across the view: the spread along the row's direction.
        const ts = placed.map(({ v }) => v.pos.x * Math.cos(CAMERA_YAW) - v.pos.z * Math.sin(CAMERA_YAW))
        const width = Math.max(...ts) - Math.min(...ts) + 0.7
        const tall = Math.max(...placed.map(({ v }) => v.fig.height * SCALE))
        c.y = tall * 0.5
        const dist = placed.length === 1 ? 1.35 : Math.max(2.2, width / 0.6 + 0.6)
        const dir = new THREE.Vector3(Math.sin(CAMERA_YAW), 0.42, Math.cos(CAMERA_YAW)).normalize()
        ctx.view.focus({ position: c.clone().addScaledVector(dir, dist), look: c }, 60)
      }
      return report
    })()

    /** Builds one generated file without placing it, for the runner's first-try and repair checks. */
    const checkFile = async (meta: Meta, base: string) => {
      const t0 = performance.now()
      try {
        const m = await make('run', phys, 31, meta, base)
        const r = { ok: true, name: m.name, role: m.role, bark: m.bark, voice: m.voice, persona: m.persona, ...measure(m.fig.root), fixes: m.fixes, measures: m.measures, height: m.fig.height, buildMs: performance.now() - t0, timing: m.timing }
        releaseGpu(m.fig.root)
        return r
      } catch (error) {
        return { ok: false, error: String(error instanceof Error ? error.message : error) }
      }
    }

    /**
     * Module text through the sandbox and the assembler, for scripts/check-prop-sandbox.mjs and
     * check-villager-gen.mjs. The species and role-mark checks are off unless asked for: the sandbox's
     * plumbing probe is a plain round figure on purpose, and the round 1 to 3 fixtures predate villager.mark().
     */
    const trial = async (code: string, opts: { accent?: string; species?: boolean; mark?: boolean } = {}) => {
      try {
        const m = await fromCode(code, phys, opts.accent ?? '#c8553d', 31, opts.species ?? false, opts.mark ?? false)
        const r = { ok: true, name: m.name, persona: m.persona, measures: m.measures, ...measure(m.fig.root), slots: { eyes: m.fig.eyes.length, hands: m.fig.hands.length, feet: m.fig.feet.length }, side: m.fig.side, hip: m.fig.hip, height: m.fig.height }
        releaseGpu(m.fig.root)
        return r
      } catch (error) {
        return { ok: false, reason: String(error instanceof Error ? error.message : error) }
      }
    }

    /**
     * The trusted checks on a hand-made plush or a spec build (`hand:moss`, `spec:tuft`): they must pass the originals.
     * The species check is measured but not applied: the hand-made three are the round template it guards against.
     * They carry no tagged role mark, so the mark check is off.
     */
    const audit = async (id: string) => {
      const m = await make(id, phys, 31)
      const r = inspect(m.fig.root, m.fig.eyes, null, { head: m.fig.head, hands: m.fig.hands, species: false, mark: false })
      releaseGpu(m.fig.root)
      return r
    }

    /**
     * Each placed villager alone, flat black on white, from the dollhouse heading and pitch
     * (fov 20), framing 1.4 m: a row-major 0/1 mask of size x size, and its bounds.
     * With `accent`, parts in the owner's accent (assemble.ts flags them) render red and
     * the mask holds '2' where the accent shows, so its visible area can be counted.
     */
    const silhouettes = async (size = 128, accent = false) => {
      const { renderer } = ctx.stage
      const target = new THREE.RenderTarget(size, size)
      const camera = new THREE.PerspectiveCamera(20, 1, 0.5, 30)
      const black = new THREE.MeshBasicMaterial({ color: '#000000' })
      const red = new THREE.MeshBasicMaterial({ color: '#ff0000' })
      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#ffffff')
      const out: { id: string; name: string; mask: string; w: number; h: number }[] = []
      for (const { id, v, name } of placed) {
        const { root } = v.fig
        const parent = root.parent
        const keep = { p: root.position.clone(), r: root.rotation.y }
        const mats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
        root.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            mats.set(m, m.material)
            m.material = accent && m.userData.accent ? red : black
          }
        })
        scene.add(root)
        root.position.set(0, 0, 0)
        root.rotation.y = FACE_YAW
        root.updateMatrixWorld(true)
        const pitch = 0.58, dist = 0.7 / Math.tan(THREE.MathUtils.degToRad(10))
        const look = new THREE.Vector3(0, 0.62, 0)
        camera.position.set(Math.sin(CAMERA_YAW) * Math.cos(pitch), Math.sin(pitch), Math.cos(CAMERA_YAW) * Math.cos(pitch)).multiplyScalar(dist).add(look)
        camera.lookAt(look)
        camera.updateMatrixWorld(true)
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        const pending = renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size)
        renderer.setRenderTarget(null)
        // Put it back before anything else renders.
        for (const [m, mat] of mats) m.material = mat
        parent?.add(root)
        root.position.copy(keep.p)
        root.rotation.y = keep.r
        root.updateMatrixWorld(true)
        const px = await pending as Uint8Array
        let mask = ''
        // Render-target rows come bottom-up on WebGL and top-down on WebGPU; flip to top-down for WebGL.
        const topDown = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
        for (let y = 0; y < size; y++) {
          const row = topDown ? y : size - 1 - y
          for (let x = 0; x < size; x++) {
            const k = (row * size + x) * 4
            mask += px[k + 1] >= 128 ? '0' : px[k] >= 128 ? '2' : '1'
          }
        }
        out.push({ id, name, mask, w: size, h: size })
      }
      target.dispose()
      black.dispose()
      red.dispose()
      return out
    }

    /** Each placed villager's bounds on screen, in CSS pixels, for cropping dollhouse-distance tiles. */
    const screen = () => {
      const { camera, renderer } = ctx.stage
      const rect = renderer.domElement.getBoundingClientRect()
      return placed.map(({ id, v }) => {
        const b = new THREE.Box3().setFromObject(v.fig.root)
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (let i = 0; i < 8; i++) {
          const p = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera)
          const x = rect.left + (p.x + 1) / 2 * rect.width, y = rect.top + (1 - p.y) / 2 * rect.height
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
        }
        return { id, x0, y0, x1, y1 }
      })
    }

    ctx.effect(() => {
      Object.assign(window, { villagerGen: { loaded: loading, check: checkFile, trial, audit, silhouettes, screen, report, placed: () => placed.map(({ id, name, v }) => ({ id, name, x: v.pos.x, z: v.pos.z, height: v.fig.height })) } })
      return () => {
        delete (window as { villagerGen?: unknown }).villagerGen
        box?.dispose()
        box = null
      }
    }, 'villagergen api')

    const eye = new THREE.Vector3()
    ctx.on('village/frame', (dt, t) => {
      if (!crowd.length) return
      ctx.stage.camera.getWorldPosition(eye)
      stepCrowd(crowd, blobs, Math.min(dt, 0.05), t, eye, SCALE)
    })
  },
}
