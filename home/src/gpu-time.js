// GPU busy time per frame from WebGPU timestamp queries (#42).
//
// Every render and compute pass encoded while someone listens gets a begin and an end
// timestamp. A frame's GPU ms is the union of its pass intervals: time during which at
// least one of its passes was running on the GPU. Under Metal, passes overlap and a
// pass's begin can be written while an earlier pass still runs, so summed durations
// overcount (60 to 70 ms per frame at a steady 60 fps); the union does not. It also
// leaves out main-thread delay, which the older submit-to-done wait counted.
//
// Plain JavaScript with no imports: renderer.ts imports it, and scripts/perf-gate.mjs
// injects its source before the app so that a base build without it is measured the
// same way. One timer per device; a second call returns the same timer.

/**
 * @typedef {{ busyMs: number, spanMs: number, sumMs: number, passes: Array<[string, number]> }} GpuFrame
 *   passes: in encode order, each pass's label and the ms it adds to busyMs (they sum to it).
 * @typedef {{ listeners: Set<(frame: GpuFrame) => void>, endFrame: () => void, skipped: number }} GpuPassTimer
 */

/**
 * @param {GPUDevice} device
 * @returns {GpuPassTimer | null} null when the device lacks 'timestamp-query'.
 */
export function gpuPassTimer(device) {
  const marked = /** @type {GPUDevice & { villageGpuTimer?: GpuPassTimer }} */ (device)
  if (marked.villageGpuTimer) return marked.villageGpuTimer
  if (!device.features.has('timestamp-query')) return null
  const MAX_PASSES = 512
  const BYTES = MAX_PASSES * 2 * 8
  const IN_FLIGHT = 8
  const querySet = device.createQuerySet({ type: 'timestamp', count: MAX_PASSES * 2 })
  const resolved = device.createBuffer({ size: BYTES, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
  /** @type {GPUBuffer[]} */
  const free = []
  let made = 0
  let next = 0
  let overflow = false
  /** @type {string[]} */
  let labels = []
  const create = device.createCommandEncoder.bind(device)

  /** @type {GpuPassTimer} */
  const timer = { listeners: new Set(), endFrame, skipped: 0 }
  marked.villageGpuTimer = timer

  // Three reuses its pass descriptors, so the writes are set for the call only.
  /** @param {any} desc @param {string} kind @param {(d: any) => any} begin */
  const timed = (desc, kind, begin) => {
    if (!timer.listeners.size || desc?.timestampWrites) return begin(desc)
    if (next + 2 > MAX_PASSES * 2) {
      overflow = true
      return begin(desc)
    }
    const d = desc ?? {}
    labels.push(d.label || kind)
    d.timestampWrites = { querySet, beginningOfPassWriteIndex: next, endOfPassWriteIndex: next + 1 }
    next += 2
    try {
      return begin(d)
    } finally {
      d.timestampWrites = undefined
    }
  }
  device.createCommandEncoder = (descriptor) => {
    const encoder = create(descriptor)
    const render = encoder.beginRenderPass.bind(encoder)
    const compute = encoder.beginComputePass.bind(encoder)
    encoder.beginRenderPass = (d) => timed(d, encoder.label || 'render', render)
    encoder.beginComputePass = (d) => timed(d, encoder.label || 'compute', compute)
    return encoder
  }

  /** Close the frame: resolve its queries after its submits. A no-op when it had no passes. */
  function endFrame() {
    if (!next) return
    const count = next
    const names = labels
    next = 0
    labels = []
    if (overflow) {
      overflow = false
      timer.skipped++
      return
    }
    let buffer = free.pop()
    if (!buffer && made < IN_FLIGHT) {
      made++
      buffer = device.createBuffer({ size: BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
    }
    if (!buffer) {
      timer.skipped++
      return
    }
    const target = buffer
    // Queue order makes reuse of the query indices safe: this resolve runs before the next frame's passes.
    const encoder = create()
    encoder.resolveQuerySet(querySet, 0, count, resolved, 0)
    encoder.copyBufferToBuffer(resolved, 0, target, 0, count * 8)
    device.queue.submit([encoder.finish()])
    target.mapAsync(GPUMapMode.READ, 0, count * 8).then(
      () => {
        const t = new BigUint64Array(target.getMappedRange(0, count * 8).slice(0))
        target.unmap()
        free.push(target)
        const frame = measure(t, names)
        if (frame) for (const listener of timer.listeners) listener(frame)
        else timer.skipped++
      },
      () => timer.skipped++,
    )
  }
  return timer
}

/**
 * @param {BigUint64Array} t begin and end per pass, in ns
 * @param {string[]} names
 * @returns {GpuFrame | null}
 */
function measure(t, names) {
  /** @type {Array<{ name: string, b: bigint, e: bigint }>} */
  const spans = []
  for (let i = 0; i + 1 < t.length; i += 2) {
    // An unwritten query resolves to 0; an end before its begin is not a usable pair.
    if (t[i] === 0n || t[i + 1] < t[i]) continue
    spans.push({ name: names[i / 2], b: t[i], e: t[i + 1] })
  }
  if (!spans.length) return null
  const sumMs = spans.reduce((s, p) => s + Number(p.e - p.b) / 1e6, 0)
  // Walk passes in begin order; each adds only the time past the latest end so far.
  const byBegin = [...spans].sort((x, y) => (x.b < y.b ? -1 : x.b > y.b ? 1 : 0))
  /** @type {Map<object, number>} */
  const added = new Map()
  let to = byBegin[0].b
  let busy = 0n
  for (const p of byBegin) {
    const from = p.b > to ? p.b : to
    const extra = p.e > from ? p.e - from : 0n
    added.set(p, Number(extra) / 1e6)
    busy += extra
    if (p.e > to) to = p.e
  }
  return {
    busyMs: Number(busy) / 1e6,
    spanMs: Number(to - byBegin[0].b) / 1e6,
    sumMs,
    passes: spans.map((p) => /** @type {[string, number]} */ ([p.name, added.get(p) ?? 0])),
  }
}
