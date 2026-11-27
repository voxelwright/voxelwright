// Thin zero-dependency bridge to the Rust/Wasm fine-voxel operations in `core.wasm` (#139):
// face meshing (`fine.ts`), smooth corner normals (`fine.ts`), base64/LEB128 RLE decode/encode (`runs.ts`,
// `robotaxi.ts`), shell-preserving coarsening (`car-sculpt.ts`), and procedural vehicle sculptors
// (`car-sculpt.ts`, `ojai-sculpt.ts`).
//
// Works on the main page (reusing `main.ts`'s already-instantiated `core.wasm` via `useFineCore`), in Web Workers
// (`loadFineCore` fetching `./core.wasm`), and synchronously in Node (`getFineCore` via `process.getBuiltinModule`
// so `sf/build.mjs` browser bundling stays free of Node imports). When `core.wasm` is not available, every helper
// returns `null` so callers fall back cleanly to their TypeScript implementations.

export interface FineCore {
  memory: WebAssembly.Memory
  fine_cells_room(n: number): number
  fine_cells_ptr(): number
  fine_out_cells_ptr(): number
  fine_bytes_room(n: number): number
  fine_bytes_ptr(): number
  fine_bytes_len(): number
  fine_palette_room(n: number): number
  fine_palette_ptr(): number
  fine_palette_len(): number
  fine_params_room(n: number): number
  fine_faces_ptr(): number
  fine_smooth_ptr(): number
  fine_filled(): number
  fine_swap_out_to_cells(): void
  fine_unrun_b64(n: number): number
  fine_encode_runs(n: number, fromOut: number): number
  fine_faces(w: number, h: number, d: number): number
  fine_faces_smooth(w: number, h: number, d: number, reach: number): number
  fine_coarser(w: number, h: number, d: number, by: number): number
  fine_sculpt_coupe(): number
  fine_sculpt_kart(paint: number, per: number): number
  fine_sculpt_ojai(): number
}

export interface FineCoupeParams {
  L: number
  H: number
  W: number
  per: number
  wheels: readonly [number, number]
  wheelY: number
  wheelR: number
  tyreW: number
  eye: readonly [number, number, number]
  paint: number
}

export interface FineOjaiParams {
  livery: { body: number; roof: number; accent: number; text: number; trim: number }
  badge?: string
  spec: {
    L: number
    H: number
    W: number
    per: number
    wheels: readonly [number, number]
    wheelY: number
    wheelR: number
    tyreW: number
    domeOffset: readonly [number, number, number]
  }
}

let active: FineCore | null = null
let loading: Promise<FineCore | null> | null = null
let nodeTried = false
const asciiDecoder = new TextDecoder('ascii')

function hasFineExports(x: unknown): x is FineCore {
  const c = x as Partial<FineCore> | null | undefined
  return !!c && typeof c.fine_faces === 'function' && typeof c.fine_sculpt_ojai === 'function' && c.memory instanceof WebAssembly.Memory
}

/** Registers an already-instantiated `core.wasm` exports object (e.g. from `main.ts`) for fine-voxel operations. */
export function useFineCore(exports: unknown): void {
  if (hasFineExports(exports)) active = exports
}

/** Synchronously returns the active `FineCore` (in Node, lazily loads `./core.wasm` once without static Node imports). */
export function getFineCore(): FineCore | null {
  if (active) return active
  if (nodeTried) return null
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => Record<string, unknown> } }).process
  if (typeof proc?.getBuiltinModule !== 'function') return null
  nodeTried = true
  try {
    const fs = proc.getBuiltinModule('node:fs') as { readFileSync(p: URL): Uint8Array }
    const bytes = fs.readFileSync(new URL('./core.wasm', import.meta.url))
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource))
    if (hasFineExports(inst.exports)) active = inst.exports
  } catch {
    // Missing or unreadable wasm: fall back to pure TypeScript implementations.
  }
  return active
}

/** Asynchronously instantiates `./core.wasm` for Web Workers (or returns the already-registered instance). */
export function loadFineCore(): Promise<FineCore | null> {
  if (active) return Promise.resolve(active)
  const sync = getFineCore()
  if (sync) return Promise.resolve(sync)
  if (!loading) {
    loading = (async () => {
      try {
        const url = new URL('./core.wasm', import.meta.url)
        let inst: WebAssembly.Instance
        if (typeof WebAssembly.instantiateStreaming === 'function') {
          try {
            inst = (await WebAssembly.instantiateStreaming(fetch(url))).instance
          } catch {
            const bytes = await (await fetch(url)).arrayBuffer()
            inst = (await WebAssembly.instantiate(bytes)).instance
          }
        } else {
          const bytes = await (await fetch(url)).arrayBuffer()
          inst = (await WebAssembly.instantiate(bytes)).instance
        }
        if (hasFineExports(inst.exports)) active = inst.exports
      } catch {
        // Offline or unsupported: fall back cleanly to TypeScript.
      }
      return active
    })()
  }
  return loading
}

const unpackSize = (packed: number): [number, number, number] => [packed & 1023, (packed >>> 10) & 1023, (packed >>> 20) & 1023]

function writeCells(c: FineCore, cells: ArrayLike<number>, n: number): void {
  const ptr = c.fine_cells_room(n)
  const view = new Uint16Array(c.memory.buffer, ptr, n)
  if (cells instanceof Uint16Array && cells.length >= n) view.set(cells.length === n ? cells : cells.subarray(0, n))
  else for (let i = 0; i < n; i++) view[i] = cells[i]
}

function writeAscii(c: FineCore, text: string): void {
  const ptr = c.fine_bytes_room(text.length)
  const dst = new Uint8Array(c.memory.buffer, ptr, text.length)
  for (let i = 0; i < text.length; i++) dst[i] = text.charCodeAt(i)
}

function readEncodedRuns(c: FineCore, b64Len: number): { palette: number[]; runs: string } {
  const palLen = c.fine_palette_len()
  const palView = new Uint16Array(c.memory.buffer, c.fine_palette_ptr(), palLen)
  const palette = new Array<number>(palLen)
  for (let i = 0; i < palLen; i++) palette[i] = palView[i]
  const bytesView = new Uint8Array(c.memory.buffer, c.fine_bytes_ptr(), b64Len)
  const runs = asciiDecoder.decode(bytesView)
  return { palette, runs }
}

function writeCoupeParams(c: FineCore, o: FineCoupeParams): void {
  const ptr = c.fine_params_room(13)
  new Float64Array(c.memory.buffer, ptr, 13).set([
    o.L, o.H, o.W, o.per, o.wheels[0], o.wheels[1], o.wheelY, o.wheelR, o.tyreW, o.eye[0], o.eye[1], o.eye[2], o.paint,
  ])
}

function writeOjaiParams(c: FineCore, o: FineOjaiParams): void {
  const s = o.spec, l = o.livery
  const ptr = c.fine_params_room(16)
  new Float64Array(c.memory.buffer, ptr, 16).set([
    s.L, s.H, s.W, s.per, s.wheels[0], s.wheels[1], s.wheelY, s.wheelR, s.tyreW,
    s.domeOffset[0], s.domeOffset[1],
    l.body, l.roof, l.accent, l.text, l.trim,
  ])
  writeAscii(c, o.badge ?? '')
}

export function wasmFaces(cells: Uint16Array, [w, h, d]: readonly [number, number, number]): Uint32Array<ArrayBuffer> | null {
  const c = getFineCore()
  if (!c) return null
  const n = w * h * d
  writeCells(c, cells, n)
  const count = c.fine_faces(w, h, d)
  return new Uint32Array(c.memory.buffer, c.fine_faces_ptr(), count * 2).slice()
}

export function wasmFacesWithSmooth(cells: Uint16Array, [w, h, d]: readonly [number, number, number], reach = 5): { faces: Uint32Array<ArrayBuffer>; smooth: Uint32Array<ArrayBuffer>; filled: number } | null {
  const c = getFineCore()
  if (!c) return null
  const n = w * h * d
  writeCells(c, cells, n)
  const count = c.fine_faces_smooth(w, h, d, reach)
  const faces = new Uint32Array(c.memory.buffer, c.fine_faces_ptr(), count * 2).slice()
  const smooth = new Uint32Array(c.memory.buffer, c.fine_smooth_ptr(), count * 4).slice()
  return { faces, smooth, filled: c.fine_filled() }
}

export function wasmUnrun(runs: string, n: number, kinds: readonly number[]): Uint16Array<ArrayBuffer> | null {
  const c = getFineCore()
  if (!c) return null
  writeAscii(c, runs)
  const pPtr = c.fine_palette_room(kinds.length)
  const pView = new Uint16Array(c.memory.buffer, pPtr, kinds.length)
  for (let i = 0; i < kinds.length; i++) pView[i] = kinds[i]
  const filled = c.fine_unrun_b64(n)
  if (filled < 0) throw new Error('the runs do not fit the size and the palette')
  return new Uint16Array(c.memory.buffer, c.fine_cells_ptr(), n).slice()
}

/** Worker fast-path: decodes base64 RLE directly inside Wasm and meshes faces (square or smooth) with zero intermediate copies. */
export function wasmUnrunAndFaces(runs: string, [w, h, d]: readonly [number, number, number], kinds: readonly number[], reach?: number): { faces: Uint32Array<ArrayBuffer>; smooth?: Uint32Array<ArrayBuffer>; filled: number } | null {
  const c = getFineCore()
  if (!c) return null
  const n = w * h * d
  writeAscii(c, runs)
  const pPtr = c.fine_palette_room(kinds.length)
  const pView = new Uint16Array(c.memory.buffer, pPtr, kinds.length)
  for (let i = 0; i < kinds.length; i++) pView[i] = kinds[i]
  const filled = c.fine_unrun_b64(n)
  if (filled < 0) throw new Error('the runs do not fit the size and the palette')
  if (reach) {
    const count = c.fine_faces_smooth(w, h, d, reach)
    const faces = new Uint32Array(c.memory.buffer, c.fine_faces_ptr(), count * 2).slice()
    const smooth = new Uint32Array(c.memory.buffer, c.fine_smooth_ptr(), count * 4).slice()
    return { faces, smooth, filled: c.fine_filled() }
  }
  const count = c.fine_faces(w, h, d)
  const faces = new Uint32Array(c.memory.buffer, c.fine_faces_ptr(), count * 2).slice()
  return { faces, filled: c.fine_filled() }
}

export function wasmEncodeRuns(cells: Uint16Array): { palette: number[]; runs: string } | null {
  const c = getFineCore()
  if (!c) return null
  writeCells(c, cells, cells.length)
  const b64Len = c.fine_encode_runs(cells.length, 0)
  return readEncodedRuns(c, b64Len)
}

export function wasmCoarser(kinds: ArrayLike<number>, [w, h, d]: readonly [number, number, number], by: number): { kinds: Uint16Array<ArrayBuffer>; size: [number, number, number] } | null {
  const c = getFineCore()
  if (!c) return null
  writeCells(c, kinds, w * h * d)
  const packed = c.fine_coarser(w, h, d, by)
  const size = unpackSize(packed)
  const out = new Uint16Array(c.memory.buffer, c.fine_out_cells_ptr(), size[0] * size[1] * size[2]).slice()
  return { kinds: out, size }
}

export function wasmSculptCoupe(o: FineCoupeParams): { cells: Uint16Array<ArrayBuffer>; size: [number, number, number] } | null {
  const c = getFineCore()
  if (!c) return null
  writeCoupeParams(c, o)
  const packed = c.fine_sculpt_coupe()
  if (!packed) return null
  const size = unpackSize(packed)
  const cells = new Uint16Array(c.memory.buffer, c.fine_cells_ptr(), size[0] * size[1] * size[2]).slice()
  return { cells, size }
}

/** Worker fast-path for `summon.ts`: sculpts the coupe, builds its coarse 10 cm body, and bakes smooth faces in one Wasm pass. */
export function wasmSculptCoupeBundle(o: FineCoupeParams, coarserBy: number, reach = 5): {
  cells: Uint16Array<ArrayBuffer>
  size: [number, number, number]
  coarseKinds: Uint16Array<ArrayBuffer>
  coarseSize: [number, number, number]
  faces: Uint32Array<ArrayBuffer>
  smooth: Uint32Array<ArrayBuffer>
  filled: number
} | null {
  const c = getFineCore()
  if (!c) return null
  writeCoupeParams(c, o)
  const packed = c.fine_sculpt_coupe()
  if (!packed) return null
  const size = unpackSize(packed)
  const cells = new Uint16Array(c.memory.buffer, c.fine_cells_ptr(), size[0] * size[1] * size[2]).slice()
  const cPacked = c.fine_coarser(size[0], size[1], size[2], coarserBy)
  const coarseSize = unpackSize(cPacked)
  const coarseKinds = new Uint16Array(c.memory.buffer, c.fine_out_cells_ptr(), coarseSize[0] * coarseSize[1] * coarseSize[2]).slice()
  const count = c.fine_faces_smooth(size[0], size[1], size[2], reach)
  const faces = new Uint32Array(c.memory.buffer, c.fine_faces_ptr(), count * 2).slice()
  const smooth = new Uint32Array(c.memory.buffer, c.fine_smooth_ptr(), count * 4).slice()
  return { cells, size, coarseKinds, coarseSize, faces, smooth, filled: c.fine_filled() }
}

export function wasmSculptKart(paint: number, per = 4): { cells: Uint16Array<ArrayBuffer>; size: [number, number, number] } | null {
  const c = getFineCore()
  if (!c) return null
  const packed = c.fine_sculpt_kart(paint, per)
  if (!packed) return null
  const size = unpackSize(packed)
  const cells = new Uint16Array(c.memory.buffer, c.fine_cells_ptr(), size[0] * size[1] * size[2]).slice()
  return { cells, size }
}

export function wasmSculptOjai(o: FineOjaiParams): { cells: Uint16Array<ArrayBuffer>; size: [number, number, number] } | null {
  const c = getFineCore()
  if (!c) return null
  writeOjaiParams(c, o)
  const packed = c.fine_sculpt_ojai()
  if (!packed) return null
  const size = unpackSize(packed)
  const cells = new Uint16Array(c.memory.buffer, c.fine_cells_ptr(), size[0] * size[1] * size[2]).slice()
  return { cells, size }
}

/** Zero-copy Wasm pipeline for `buildRobotaxiModel`: sculpts the Ojai and RLE-encodes all three LODs (per=4, 2, 1) in Wasm memory. */
export function wasmBuildOjaiLods(o: FineOjaiParams): {
  size4: [number, number, number]
  look4: { palette: number[]; runs: string }
  size2: [number, number, number]
  look2: { palette: number[]; runs: string }
  size1: [number, number, number]
  look1: { palette: number[]; runs: string }
} | null {
  const c = getFineCore()
  if (!c) return null
  writeOjaiParams(c, o)
  const p4 = c.fine_sculpt_ojai()
  if (!p4) return null
  const size4 = unpackSize(p4)
  const b4 = c.fine_encode_runs(size4[0] * size4[1] * size4[2], 0)
  const look4 = readEncodedRuns(c, b4)

  const p2 = c.fine_coarser(size4[0], size4[1], size4[2], 2)
  const size2 = unpackSize(p2)
  const b2 = c.fine_encode_runs(size2[0] * size2[1] * size2[2], 1)
  const look2 = readEncodedRuns(c, b2)

  const p1 = c.fine_coarser(size4[0], size4[1], size4[2], 4)
  const size1 = unpackSize(p1)
  const b1 = c.fine_encode_runs(size1[0] * size1[1] * size1[2], 1)
  const look1 = readEncodedRuns(c, b1)

  return { size4, look4, size2, look2, size1, look1 }
}
