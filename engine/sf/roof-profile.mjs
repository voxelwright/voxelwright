// Used by bay/roof_samples.py to measure the upward faces emitted by a compiled landmark.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Highest upward face at one surveyed point, in metres above the landmark datum. */
export function roofAt(core, sort, step, u, w) {
  const cell = step / 10
  const bottom = Math.floor(core.hero_reach(sort, 1) / cell)
  const end = Math.ceil(core.hero_reach(sort, 4) / cell)
  if (!Number.isFinite(bottom) || !Number.isFinite(end)) throw Error(`No compiled landmark for sort ${sort}`)
  const column = Math.floor(u / cell), row = Math.floor(w / cell)
  for (let high = end; high > bottom; high -= 1023) {
    const low = Math.max(bottom, high - 1023)
    const length = core.hero_faces(sort, step, column, low, row, 1, high - low, 1)
    const faces = new Uint32Array(core.memory.buffer, core.hero_faces_at(), length)
    let top = null
    for (let n = 0; n < length; n += 2) {
      const position = faces[n], face = faces[n + 1]
      if (((face >> 8) & 7) !== 5) continue // y-axis, positive side
      const elevation = (low + ((position >> 10) & 1023) + 1) * cell
      if (top === null || elevation > top) top = elevation
    }
    if (top !== null) return top
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { wasm, sort, step, us, ws } = JSON.parse(readFileSync(0, 'utf8'))
  const core = (await WebAssembly.instantiate(readFileSync(wasm))).instance.exports
  console.log(JSON.stringify(ws.map(w => us.map(u => roofAt(core, sort, step, u, w)))))
}
