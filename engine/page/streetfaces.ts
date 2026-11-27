// The faces of the street's vehicles (#450, street.ts), made off the page's thread: a car's look in 2.5 cm cells is
// a million cells, and its faces took a frame's worth of time and more to make. Each ask is a look as runs and the
// palette to read them with; the answer is its outside faces (fine.ts `faces`), handed back without a copy. Asked with
// `cells`, the answer is the look's cells themselves instead, for a car brought to life (decoding them on the page's
// thread cost a frame when someone got in). Asked with `reach`, its faces come with their smooth words too (#38,
// fine.ts `facesWithSmooth`): an outside look's, not the finer look of a car's inside, which stays as it was made.
import { coarser, sculptCoupe, type CoupeSpec } from './car-sculpt.ts'
import { faces, facesWithSmooth } from './fine.ts'
import { loadFineCore, wasmSculptCoupeBundle, wasmUnrunAndFaces } from './fine-core.ts'
import { unrun } from './runs.ts'

type AskMsg = {
  key: string | number
  runs?: string
  kinds?: number[]
  raw?: Uint16Array
  size?: [number, number, number]
  cells?: boolean
  reach?: number
  sculptCoupe?: CoupeSpec
  coarserBy?: number
}

const worker = self as unknown as Worker
let coreReady = false
const boot = loadFineCore().finally(() => { coreReady = true })
let chain: Promise<void> = boot.then(() => {})

function handle(data: AskMsg) {
  const { key } = data
  // Off-thread sports coupe sculpt + coarse body + smooth faces in one Wasm pass (#139, summon.ts).
  if (data.sculptCoupe) {
    const by = data.coarserBy ?? data.sculptCoupe.per
    const reach = data.reach ?? 5
    const fast = wasmSculptCoupeBundle(data.sculptCoupe, by, reach)
    if (fast) {
      worker.postMessage({ key, ...fast }, [fast.cells.buffer, fast.coarseKinds.buffer, fast.faces.buffer, fast.smooth.buffer])
      return
    }
    const { cells, size } = sculptCoupe(data.sculptCoupe)
    const body = coarser(cells, size, by)
    let filled = 0
    for (let i = 0; i < cells.length; i++) if (cells[i]) filled++
    const made = facesWithSmooth(cells, size, reach)
    const cBuf = (cells.buffer instanceof ArrayBuffer ? cells : cells.slice()).buffer
    const bBuf = (body.kinds.buffer instanceof ArrayBuffer ? body.kinds : body.kinds.slice()).buffer
    worker.postMessage({ key, cells, size, coarseKinds: body.kinds, coarseSize: body.size, faces: made.faces, smooth: made.smooth, filled }, [cBuf, bBuf, made.faces.buffer, made.smooth.buffer])
    return
  }

  const { runs, kinds, size } = data
  if (!size) return
  // Zero-copy Wasm decode + face meshing when runs are sent and raw cells aren't requested.
  if (!data.raw && !data.cells && runs !== undefined && kinds) {
    const fast = wasmUnrunAndFaces(runs, size, kinds, data.reach)
    if (fast) {
      if (fast.smooth) worker.postMessage({ key, faces: fast.faces, smooth: fast.smooth, filled: fast.filled }, [fast.faces.buffer, fast.smooth.buffer])
      else worker.postMessage({ key, faces: fast.faces, filled: fast.filled }, [fast.faces.buffer])
      return
    }
  }
  // (Or the cells themselves, `raw`: a look the page has already, carved for its wheels, main.ts `look`.)
  const cells = data.raw ?? unrun(runs!, size[0] * size[1] * size[2], kinds!)
  if (data.cells) { worker.postMessage({ key, cells }, [cells.buffer]); return }
  let filled = 0
  for (let i = 0; i < cells.length; i++) if (cells[i]) filled++
  if (data.reach) {
    const made = facesWithSmooth(cells, size, data.reach)
    worker.postMessage({ key, faces: made.faces, smooth: made.smooth, filled }, [made.faces.buffer, made.smooth.buffer])
    return
  }
  const made = faces(cells, size)
  worker.postMessage({ key, faces: made, filled }, [made.buffer])
}

self.onmessage = (e: MessageEvent<AskMsg>) => {
  if (coreReady) { handle(e.data); return }
  const data = e.data
  chain = chain.then(() => { handle(data) })
}
