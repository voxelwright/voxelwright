// Cells as runs (#450): a kept thing's grid as make/cells.mjs writes it, read on the page. `runs` is base64 of
// unsigned LEB128 numbers, a count and then which kind of the palette, for the grid in order (x fastest, then z,
// then y); `kinds` is the palette as the core's kinds, 0 first for air. A file that does not fit is refused, not
// guessed at.
export function unrun(runs: string, n: number, kinds: readonly number[]): Uint16Array {
  const bytes = Uint8Array.from(atob(runs), (c) => c.charCodeAt(0)), all = new Uint16Array(n)
  let at = 0, k = 0
  const number = () => { let v = 0, shift = 0; for (;;) { if (at >= bytes.length || shift > 28) throw new Error('the runs end in the middle of a number'); const b = bytes[at++]; v += (b & 127) * 2 ** shift; if (b < 128) return v; shift += 7 } }
  while (at < bytes.length) {
    const c = number(), v = number()
    if (c > n - k || v >= kinds.length) throw new Error('the runs do not fit the size and the palette')
    if (v) all.fill(kinds[v], k, k + c)
    k += c
  }
  if (k !== n) throw new Error(`the runs cover ${k} cells of ${n}`)
  return all
}
