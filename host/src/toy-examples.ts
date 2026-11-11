// Toys as data (#88), written by hand for a surface the page offers: the worked example the
// physics prompt quotes (a marble run) and the stub ruler's answers for the checks (a marble
// run, a seesaw, ten pins and a ball). The same shape a model writes: parts in the surface's
// frame (origin at its top centre, x along its long side, z across, y up), gadgets and wires.

export interface OfferedSurface { id: string; label: string; half: [number, number]; height: number }
type V = [number, number, number]
/** A toy as data, the shape a model writes. */
export interface ToyData { label: string; parts: Record<string, unknown>[]; gadgets: Record<string, unknown>[]; wires: { from: string; to: string }[] }
export const r3 = (v: number) => Math.round(v * 1000) / 1000
const v3 = (x: number, y: number, z: number): V => [r3(x), r3(y), r3(z)]

/**
 * Three lacquered ramps zig-zagging down a walnut backboard, with rails, a stop at each low
 * end that drops the marble onto the next ramp, and a steel marble at the top.
 */
export function marbleRun(s: Pick<OfferedSurface, 'half'>): ToyData {
  const L = Math.min(0.3, s.half[0] - 0.06) // half a ramp's length
  const slope = 0.12
  const levels = [0.27, 0.165, 0.06]
  const parts: Record<string, unknown>[] = [
    { id: 'backboard', shape: { kind: 'box', half: v3(L + 0.05, 0.17, 0.006) }, material: 'walnut', at: v3(0, 0.17, -0.062) },
  ]
  levels.forEach((y, i) => {
    const dir = i % 2 === 0 ? 1 : -1 // descends toward +x on even levels
    // The high end reaches the stop above it, so a dropped marble cannot wedge between them.
    const cx = -dir * 0.032
    const turn = v3(0, 0, -dir * slope)
    parts.push({ id: `ramp-${i + 1}`, shape: { kind: 'box', half: v3(L, 0.005, 0.035) }, material: 'lacquer', paint: ['#e6b85a', '#d9876a', '#9fb58f'][i], at: v3(cx, y, 0), turn })
    for (const side of [-1, 1]) parts.push({ id: `rail-${i + 1}${side < 0 ? 'a' : 'b'}`, shape: { kind: 'box', half: v3(L, 0.012, 0.004) }, material: 'maple', at: v3(cx, y + 0.016, side * 0.04), turn })
    const lower = levels[i + 1] ?? 0
    // The stop at the low end: from the next ramp (or the surface) to above this one.
    const bottom = Math.max(0, lower - 0.01), stopTop = y + 0.05
    parts.push({ id: `stop-${i + 1}`, shape: { kind: 'box', half: v3(0.005, (stopTop - bottom) / 2, 0.044) }, material: 'maple', at: v3(dir * (L + 0.035), (stopTop + bottom) / 2, 0) })
  })
  const top = levels[0] + (L - 0.052) * Math.tan(slope)
  parts.push({ id: 'marble', shape: { kind: 'sphere', radius: 0.0125 }, material: 'steel', motion: 'dynamic', at: v3(-L + 0.02, top + 0.005 + 0.0125 + 0.004, 0) })
  return { label: 'Marble run', parts, gadgets: [], wires: [] }
}

/** A maple plank on a free pivot over a walnut log, a felt seat at each end. */
export function seesaw(s: Pick<OfferedSurface, 'half'>): ToyData {
  const L = Math.min(0.22, s.half[0] - 0.03)
  const swing = Math.min(0.3, Math.asin(0.085 / L))
  return {
    label: 'Seesaw',
    parts: [
      { id: 'log', shape: { kind: 'cylinder', halfHeight: 0.07, radius: 0.04 }, material: 'walnut', at: v3(0, 0.04, 0), turn: v3(Math.PI / 2, 0, 0) },
      { id: 'plank', shape: { kind: 'box', half: v3(L, 0.01, 0.06) }, material: 'maple', paint: '#e6b85a', motion: 'dynamic', at: v3(0, 0.092, 0) },
    ],
    gadgets: [{ id: 'pivot', kind: 'pivot', part: 'plank', anchor: v3(0, 0.082, 0), axis: [0, 0, 1], knobs: { swing: r3(swing), friction: 0.02 } }],
    wires: [],
  }
}

/** Ten plaster pins in a close triangle at the far end of a lacquered lane with gutters, and a heavy steel ball at the near end. */
export function pins(s: Pick<OfferedSurface, 'half'>): ToyData {
  const L = Math.min(0.42, s.half[0] - 0.02)
  const parts: Record<string, unknown>[] = [
    { id: 'lane', shape: { kind: 'box', half: v3(L, 0.004, 0.12) }, material: 'lacquer', paint: '#efdcb4', at: v3(0, 0.004, 0) },
    { id: 'gutter-a', shape: { kind: 'box', half: v3(L, 0.015, 0.006) }, material: 'walnut', at: v3(0, 0.015, -0.128) },
    { id: 'gutter-b', shape: { kind: 'box', half: v3(L, 0.015, 0.006) }, material: 'walnut', at: v3(0, 0.015, 0.128) },
  ]
  let n = 0
  for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) {
    n++
    parts.push({ id: `pin-${n}`, shape: { kind: 'cylinder', halfHeight: 0.05, radius: 0.016 }, material: 'plaster', paint: '#f6f0e4', motion: 'dynamic', at: v3(-L + 0.25 - row * 0.042, 0.008 + 0.05, (k - row / 2) * 0.046) })
  }
  parts.push({ id: 'ball', shape: { kind: 'sphere', radius: 0.035 }, material: 'steel', paint: '#4f7896', motion: 'dynamic', at: v3(L - 0.06, 0.008 + 0.035, 0) })
  return { label: 'Ten pins', parts, gadgets: [], wires: [] }
}

/** The worked example the prompt quotes: a marble run on a sample surface. */
export const EXAMPLE_SURFACE: OfferedSurface = { id: 'table', label: 'the kitchen table', half: [0.4, 0.22], height: 0.45 }
