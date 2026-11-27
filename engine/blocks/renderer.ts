// The Voxelmorphism kit's renderer on the engine's page stage (#430). The kit (engine/kit)
// is handed it with `use()`:
//
//   import { use, adopt } from 'voxelmorphism'
//   import { renderer } from './blocks/renderer.js'
//   use(renderer())      // a promise: the page is plain CSS until it settles, and for good if it settles on null
//   adopt()
//
// The kit then calls `draw(frame, canvas)` once for a part whenever that part changes, and never at rest. `canvas`
// is the part's own, with no context taken on it (`ownsCanvas`).
import { pageStage, type PageStage } from './stage.ts'
import type { Frame } from './pass.ts'

export interface Renderer {
  readonly ownsCanvas: true
  draw(frame: Frame, canvas: HTMLCanvasElement): boolean
  /** Set by the kit: called when every part must be drawn again. */
  onrestore?: () => void
  /** Set by the kit: called when the device is lost for good. The kit then gives every part back to plain CSS. */
  onfail?: () => void
  readonly stage: PageStage
}

/** The renderer, or null where there is no WebGPU or no adapter: the kit then stays plain. */
export async function renderer(): Promise<Renderer | null> {
  const stage = await pageStage()
  if (!stage) return null
  const self: Renderer = { ownsCanvas: true, stage, draw: (frame, canvas) => stage.put(frame, canvas) }
  stage.onrestore = () => self.onrestore?.()
  stage.onfail = () => self.onfail?.()
  return self
}
