// A thing made by a program (#372): the model replies with JavaScript that lays the thing cell by cell, and the
// program is run here, in QuickJS, with nothing bound into it. Why a program: a list of parts spends 20 to 35 cells
// across a thing whatever a cell is (#254, #259); loops and sums give spokes, feathers, a curved hull, tiles, at
// cells of 2.5 or 1.25 cm.
//
// The program is text a model wrote, so it is given nothing: no host function, no timers, no files, no network.
// It fills a grid of its own inside the interpreter and one string comes out: the grid as runs, with the names of
// the materials and colours it used. That string is data, read here as any reply is (form.mjs): a kind is built
// from a named material and a named colour, never taken as a number. What holds a program: a memory of its own
// with a maximum (the platform refuses to grow it), a count of the interpreter's steps, and a clock that ends the
// whole thread (what the count does not see: a native fill, a regex).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { FONT, MATERIALS, colour, drivesOf } from './form.mjs'

/** The most a thing may be along a side, in its own cells, and the cells a thing may be made of, in cm. */
export const SIDE_MOST = 256, GRAINS = [10, 2.5, 1.25]
/** The interpreter's memory, in pages of 64 KB: what it starts with, and the most it may grow to (192 MB). */
const PAGES = 256, PAGES_MOST = 3072
/** How long a program may run, by the clock, and how long before its whole thread is ended. */
const RUN_MS = 20_000, END_MS = 30_000
/** The most text a program may answer with. */
const ANSWER_MOST = 48 << 20

// What a program sees. It shares the interpreter with the program, which can replace any of it: no check lives here.
const GUEST = (font) => `
const __P = [], __I = Object.create(null), __FONT = ${JSON.stringify(font)}
let __W = 0, __H = 0, __D = 0, __G = null, __name = 'a thing', __drives = null, __cm = 10, __lm = null, __lc = null, __li = 0, __seed = 2463534242
const __pal = (m, c) => {
  if (m === __lm && c === __lc) return __li
  let i = 0
  if (m !== 'air') { const k = m + '|' + c; i = __I[k]; if (i === undefined) { if (__P.length >= 255) throw new Error('more than 255 different pairs of material and colour'); __P.push([String(m), String(c)]); i = __I[k] = __P.length } }
  __lm = m; __lc = c; __li = i
  return i
}
function rng() { __seed ^= __seed << 13; __seed ^= __seed >>> 17; __seed ^= __seed << 5; return (__seed >>> 0) / 4294967296 }
function name(s) { __name = String(s).slice(0, 60) }
function drives(o) { __drives = o === undefined ? {} : JSON.parse(JSON.stringify(o)) }
function size(w, h, d, cm) {
  if (__G) throw new Error('size is called once')
  w = Math.round(w); h = Math.round(h); d = Math.round(d)
  if (!(w >= 1 && h >= 1 && d >= 1 && w <= ${SIDE_MOST} && h <= ${SIDE_MOST} && d <= ${SIDE_MOST})) throw new Error('size is at most ${SIDE_MOST} cells a side')
  if (cm !== undefined) __cm = Number(cm)
  __W = w; __H = h; __D = d; __G = new Uint8Array(w * h * d)
}
function put(m, c, x, y, z) {
  x = Math.round(x); y = Math.round(y); z = Math.round(z)
  if (x < 0 || y < 0 || z < 0 || x >= __W || y >= __H || z >= __D) return
  __G[(y * __D + z) * __W + x] = __pal(m, c)
}
function at(x, y, z) {
  x = Math.round(x); y = Math.round(y); z = Math.round(z)
  if (x < 0 || y < 0 || z < 0 || x >= __W || y >= __H || z >= __D) return null
  const i = __G[(y * __D + z) * __W + x]
  return i ? __P[i - 1][0] : null
}
function box(m, c, x0, y0, z0, x1, y1, z1) {
  const i = __pal(m, c)
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); z0 = Math.max(0, Math.round(z0))
  x1 = Math.min(__W, Math.round(x1)); y1 = Math.min(__H, Math.round(y1)); z1 = Math.min(__D, Math.round(z1))
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) { const r = (y * __D + z) * __W; __G.fill(i, r + x0, Math.max(r + x0, r + x1)) }
}
function ball(m, c, cx, cy, cz, rx, ry, rz) {
  if (ry === undefined) ry = rx
  if (rz === undefined) rz = rx
  const i = __pal(m, c)
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(__H - 1, Math.ceil(cy + ry)), z0 = Math.max(0, Math.floor(cz - rz)), z1 = Math.min(__D - 1, Math.ceil(cz + rz))
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    const a = (y + 0.5 - cy) / ry, b = (z + 0.5 - cz) / rz, left = 1 - a * a - b * b
    if (left < 0) continue
    const half = rx * Math.sqrt(left), x0 = Math.max(0, Math.round(cx - half)), x1 = Math.min(__W, Math.round(cx + half))
    if (x1 > x0) { const r = (y * __D + z) * __W; __G.fill(i, r + x0, r + x1) }
  }
}
function tube(m, c, x0, y0, z0, x1, y1, z1, r, r1) {
  if (r === undefined) r = 0.5
  if (r1 === undefined) r1 = r
  const i = __pal(m, c), dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len2 = dx * dx + dy * dy + dz * dz || 1, big = Math.max(r, r1)
  const ya = Math.max(0, Math.floor(Math.min(y0, y1) - big)), yb = Math.min(__H - 1, Math.ceil(Math.max(y0, y1) + big))
  const za = Math.max(0, Math.floor(Math.min(z0, z1) - big)), zb = Math.min(__D - 1, Math.ceil(Math.max(z0, z1) + big))
  const xa = Math.max(0, Math.floor(Math.min(x0, x1) - big)), xb = Math.min(__W - 1, Math.ceil(Math.max(x0, x1) + big))
  for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) {
    const row = (y * __D + z) * __W
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0, pz = z + 0.5 - z0
      let t = (px * dx + py * dy + pz * dz) / len2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t, rr = r + (r1 - r) * t
      if (ex * ex + ey * ey + ez * ez <= rr * rr) __G[row + x] = i
    }
  }
}
function text(m, c, x, y, z, words, big, axis) {
  big = Math.max(1, Math.round(big || 1))
  const i = __pal(m, c); words = String(words).toUpperCase()
  x = Math.round(x); y = Math.round(y); z = Math.round(z)
  for (let n = 0; n < words.length; n++) {
    const g = __FONT[words[n]]
    if (!g) continue
    const rows = g.split(' ')
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if (rows[row][col] === '1')
      for (let a = 0; a < big; a++) for (let b = 0; b < big; b++) {
        const u = (n * 6 + col) * big + a, v = (6 - row) * big + b
        const px = axis === 'z' ? x : x + u, pz = axis === 'z' ? z + u : z, py = y + v
        if (px >= 0 && py >= 0 && pz >= 0 && px < __W && py < __H && pz < __D) __G[(py * __D + pz) * __W + px] = i
      }
  }
}
globalThis.__done = () => {
  if (!__G) throw new Error('size(wide, high, deep, cm) was never called')
  const runs = []
  let last = __G[0], n = 0
  for (let k = 0; k < __G.length; k++) { const v = __G[k]; if (v === last) n++; else { runs.push(n, last); last = v; n = 1 } }
  runs.push(n, last)
  return JSON.stringify({ name: __name, size: [__W, __H, __D], cm: __cm, palette: __P, runs, ...(__drives ? { drives: __drives } : {}) })
}
`

if (!isMainThread && workerData?.program !== undefined) {
  const { newQuickJSWASMModuleFromVariant, newVariant } = await import('quickjs-emscripten-core')
  const variant = (await import('@jitl/quickjs-wasmfile-release-sync')).default
  let answer
  try {
    const QuickJS = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: new WebAssembly.Memory({ initial: PAGES, maximum: PAGES_MOST }) }))
    const runtime = QuickJS.newRuntime()
    runtime.setMaxStackSize(96 << 10)
    const until = Date.now() + RUN_MS
    runtime.setInterruptHandler(() => Date.now() > until)
    const vm = runtime.newContext()
    const why = (handle) => { const e = vm.dump(handle); handle.dispose(); return (typeof e === 'object' && e ? `${e.name ?? 'Error'}: ${e.message ?? ''}${typeof e.stack === 'string' ? ` (${e.stack.split('\n')[0].trim().slice(0, 80)})` : ''}` : String(e)).slice(0, 400) }
    const run = vm.evalCode(`${GUEST(workerData.font)}\n;(function () {\n${workerData.program}\n})();\n__done()`, 'thing.js')
    if (run.error) answer = { error: why(run.error) }
    else { const text = vm.typeof(run.value) === 'string' ? vm.getString(run.value) : null; run.value.dispose(); answer = text === null ? { error: 'the program did not end with a thing' } : text.length > ANSWER_MOST ? { error: 'the thing is too broken up to send: fewer changes of colour along a row' } : { text } }
  } catch (e) { answer = { error: `the interpreter broke: ${String(e).slice(0, 200)}` } }
  parentPort.postMessage(answer)
}

class Refused extends Error {}
export const refused = (e) => e instanceof Refused
const no = (why) => { throw new Refused(why) }

/** A reply that should be a program, with a code fence or a few words round it taken off. */
export const unfenced = (reply) => { const text = String(reply).trim(), m = /```(?:\w+)?\s*\n([\s\S]*?)\n```/.exec(text); return m ? m[1] : text }

/** Runs a program in a thread and an interpreter of its own. Resolves to the one string it answers with; throws `Refused` with why not, in words the model can be told. */
export function ran(program) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { program: String(program).slice(0, 400_000), font: FONT }, resourceLimits: { maxOldGenerationSizeMb: 512 } })
    const timer = setTimeout(() => { worker.terminate(); reject(new Refused(`the program ran for over ${END_MS / 1000} s and was stopped: do less work a cell`)) }, END_MS)
    worker.once('message', (m) => { clearTimeout(timer); worker.terminate(); m.error ? reject(new Refused(`the program stopped: ${m.error === 'InternalError: interrupted' || /interrupted/.test(m.error) ? `it ran for over ${RUN_MS / 1000} s` : m.error}`)) : resolve(m.text) })
    worker.once('error', (e) => { clearTimeout(timer); reject(new Refused(`the program could not be run: ${String(e.message).slice(0, 200)}`)) })
  })
}

/**
 * Reads what a program answered: the thing as kinds in a grid of its own cells, cut down to the box it fills.
 * Resolves to { name, size, cm, cells, filled, crumbs, left } or throws `Refused`. Cells that touch nothing that
 * reaches the ground are left out, as form.mjs `read` leaves them. Nothing here is taken on trust: every count,
 * size and name is checked, and a kind is built from the names.
 */
export function shaped(answer) {
  let got
  try { got = JSON.parse(answer) } catch { no('the program did not answer with a thing') }
  const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
  if (!got || typeof got !== 'object' || !Array.isArray(got.size) || got.size.length !== 3 || !got.size.every((v) => whole(v, 1, SIDE_MOST))) no(`size is at most ${SIDE_MOST} cells a side`)
  if (!GRAINS.includes(got.cm)) no(`the cell given to size is one of ${GRAINS.join(', ')} (cm)`)
  if (!Array.isArray(got.palette) || got.palette.length > 255 || !Array.isArray(got.runs) || got.runs.length % 2) no('the program did not answer with a thing')
  const kinds = [0]
  for (const pair of got.palette) {
    const [material, tint] = Array.isArray(pair) ? pair : []
    if (!Object.hasOwn(MATERIALS, material) || material === 'air') no(`"${String(material).slice(0, 20)}" is not a material: ${Object.keys(MATERIALS).filter((m) => m !== 'air').join(', ')}`)
    const c = colour(tint)
    if (c < 0) no(`"${String(tint).slice(0, 20)}" is not a colour: "own", "white", "black", "grey:0" to "grey:14", or "hue:tone" with hue 0 to 23 and tone 0 to 9`)
    kinds.push(MATERIALS[material] | (c << 8))
  }
  const [w, h, d] = got.size, all = new Uint16Array(w * h * d)
  let k = 0
  for (let i = 0; i < got.runs.length; i += 2) {
    const n = got.runs[i], v = got.runs[i + 1]
    if (!whole(n, 0, all.length - k) || !whole(v, 0, kinds.length - 1)) no('the program did not answer with a thing')
    if (v) all.fill(kinds[v], k, k + n)
    k += n
  }
  if (k !== all.length) no('the program did not answer with a thing')
  // What reaches the ground, face to face: the rest would only fall as crumbs.
  const seen = new Uint8Array(all.length), stack = new Int32Array(all.length)
  let top = 0, filled = 0
  for (let i = 0; i < all.length; i++) if (all[i]) filled++
  if (!filled) no('nothing was laid: every cell is air')
  for (let i = 0; i < w * d; i++) if (all[i]) { seen[i] = 1; stack[top++] = i }
  if (!top) no('nothing of it touches the ground: something must reach y 0')
  const layer = w * d
  let stands = 0
  while (top) {
    const i = stack[--top], x = i % w, z = Math.floor(i / w) % d
    stands++
    const go = (j) => { if (all[j] && !seen[j]) { seen[j] = 1; stack[top++] = j } }
    if (x > 0) go(i - 1)
    if (x < w - 1) go(i + 1)
    if (z > 0) go(i - w)
    if (z < d - 1) go(i + w)
    if (i >= layer) go(i - layer)
    if (i + layer < all.length) go(i + layer)
  }
  const crumbs = filled - stands, left = []
  if (crumbs) { for (let i = 0; i < all.length; i++) if (all[i] && !seen[i]) all[i] = 0 }
  if (crumbs > Math.max(40, filled / 50)) left.push(`${crumbs} of its ${filled} cells touch nothing that reaches the ground and were left out: every part must share a face with what holds it`)
  // Cut down to the box it fills.
  const lo = [w, h, d], hi = [0, 0, 0]
  for (let y = 0, i = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++, i++) if (all[i]) { if (x < lo[0]) lo[0] = x; if (x >= hi[0]) hi[0] = x + 1; if (y >= hi[1]) hi[1] = y + 1; if (z < lo[2]) lo[2] = z; if (z >= hi[2]) hi[2] = z + 1 }
  lo[1] = 0
  const size = [hi[0] - lo[0], hi[1], hi[2] - lo[2]], cells = new Uint16Array(size[0] * size[1] * size[2])
  for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) { const from = ((y * d + z + lo[2]) * w) + lo[0]; cells.set(all.subarray(from, from + size[0]), (y * size[2] + z) * size[0]) }
  // Meant to be driven (make/drivable.mjs): what it said of itself, checked. One that does not say so validly (drives("no"), drives(false)) is not driven: left out, and said.
  let drives
  if (got.drives !== undefined) { try { drives = drivesOf(got.drives) } catch (e) { left.push(`drives() left out: ${e.message}`) } }
  return { name: typeof got.name === 'string' && got.name ? got.name.slice(0, 60) : 'a thing', size, cm: got.cm, cells, filled: stands, crumbs, left, kept: stands / filled, ...(drives ? { drives } : {}) }
}

/** A reply that is a program, as a thing: run, then read. Throws `Refused` with what the model can be told. */
export const made = async (reply) => shaped(await ran(unfenced(reply)))
