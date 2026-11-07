// Types for gpu-time.js, which stays plain JavaScript so scripts/perf-gate.mjs can inject it.
export interface GpuFrame {
  /** Union of the frame's pass intervals: time at least one pass ran. */
  busyMs: number
  /** First pass begin to last pass end, gaps between submits included. */
  spanMs: number
  /** Summed pass durations; passes overlap, so this overcounts. */
  sumMs: number
  /** In encode order: each pass's label (or 'render' / 'compute') and the ms it adds to busyMs; they sum to busyMs. */
  passes: Array<[string, number]>
}
export interface GpuPassTimer {
  listeners: Set<(frame: GpuFrame) => void>
  endFrame: () => void
  skipped: number
}
/** One timer per WebGPU device; null when the device lacks 'timestamp-query'. */
export function gpuPassTimer(device: object): GpuPassTimer | null
