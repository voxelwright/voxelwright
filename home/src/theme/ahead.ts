// The scene as the look a switch is heading to will draw it, for the post chain's compile
// ahead (../plugins/postfx.ts). While `asNext` runs, the theme plugin stands the next look's
// world in place of the current one and routes each material to the next look's shading
// twin, so the next chain's pipelines are built for what it will really draw. Without
// that, the swap frame built every new world material and twin synchronously: 200 ms on a
// warm GPU, and 6 to 8 s for the first comic switch of a session, while cold Metal
// compiles blocked the main thread. Without the theme plugin, `asNext` just runs.
import type { Theme } from './tokens'

type Preview = (next: Theme, on: boolean) => void
const previews = new Set<Preview>()

/** The theme plugin's hook; returns its removal. */
export function onPreview(p: Preview) {
  previews.add(p)
  return () => void previews.delete(p)
}

/** Run `work` with the scene standing as `next` will draw it; synchronous work only. */
export function asNext<T>(next: Theme, work: () => T): T {
  for (const p of previews) p(next, true)
  try {
    return work()
  } finally {
    for (const p of previews) p(next, false)
  }
}
