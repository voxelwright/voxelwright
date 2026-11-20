// The faces of the street's vehicles (#450, street.ts), made off the page's thread: a car's look in 2.5 cm cells is
// a million cells, and its faces took a frame's worth of time and more to make. Each ask is a look as runs and the
// palette to read them with; the answer is its outside faces (fine.ts `faces`), handed back without a copy.
import { faces } from './fine.ts'
import { unrun } from './runs.ts'

self.onmessage = (e: MessageEvent<{ key: string; runs: string; kinds: number[]; size: [number, number, number] }>) => {
  const { key, runs, kinds, size } = e.data
  const cells = unrun(runs, size[0] * size[1] * size[2], kinds)
  let filled = 0
  for (let i = 0; i < cells.length; i++) if (cells[i]) filled++
  const made = faces(cells, size)
  ;(self as unknown as Worker).postMessage({ key, faces: made, filled }, [made.buffer])
}
