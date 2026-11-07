// Five synthetic ground-truth plans plus render hints. All data is invented.
// Coordinates follow geom.mjs: x right, z down, metres.

function build({ corners, walls, openings = [], rooms }) {
  return {
    version: 1, units: 'm',
    corners: Object.entries(corners).map(([id, [x, z]]) => ({ id, x, z })),
    walls: walls.map(([a, b, thickness = 0.3, sagitta = 0], i) => ({ id: `w${i + 1}`, a, b, thickness, sagitta })),
    openings: openings.map(([wi, kind, from, to], i) => ({
      id: `o${i + 1}`, wall: `w${wi}`, kind, from, to,
      ...(kind === 'window' ? { sill: 0.9, head: 2.1 } : {}),
    })),
    rooms: rooms.map(([label, loop], i) => ({ id: `r${i + 1}`, label, loop })),
    furniture: [],
  }
}

const I = 0.12 // interior wall thickness

// (a) Clean line drawing: 10 x 7 rectangle, kitchen/living split, dimensions.
const a = build({
  corners: { A: [0, 0], B: [4.5, 0], C: [10, 0], D: [10, 7], E: [4.5, 7], F: [0, 7] },
  walls: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'A'], ['B', 'E', I]],
  openings: [[1, 'window', 1.2, 3.0], [2, 'window', 1.5, 4.0], [3, 'window', 2.0, 5.0], [5, 'door', 1.5, 2.4], [7, 'door', 4.0, 4.9]],
  rooms: [['Kitchen', ['A', 'B', 'E', 'F']], ['Living room', ['B', 'C', 'D', 'E']]],
})

// (b) Estate agent: filled walls, sized labels, door swings, scale bar, L-shaped living room.
const b = build({
  corners: { A: [0, 0], B: [4.2, 0], C: [7, 0], D: [12, 0], E: [12, 5], F: [7, 5], G: [7, 9], H: [0, 9], I: [0, 3.6], J: [4.2, 3.6] },
  walls: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'I'], ['I', 'A'],
    ['I', 'J', I], ['J', 'B', I], ['C', 'F', I]],
  openings: [[1, 'window', 1.0, 3.0], [3, 'window', 1.5, 3.5], [4, 'window', 1.5, 3.5], [7, 'door', 3.0, 4.0], [8, 'window', 1.5, 3.8],
    [10, 'door', 2.6, 3.5], [12, 'door', 3.6, 4.5]],
  rooms: [['Kitchen', ['A', 'B', 'J', 'I']], ['Bedroom', ['C', 'D', 'E', 'F']], ['Living room', ['B', 'C', 'F', 'G', 'H', 'I', 'J']]],
})

// (c) Hand sketch: 8 x 6 house, one written dimension.
const c = build({
  corners: { A: [0, 0], B: [5, 0], C: [8, 0], D: [8, 6], E: [5, 6], F: [0, 6] },
  walls: [['A', 'B', 0.2], ['B', 'C', 0.2], ['C', 'D', 0.2], ['D', 'E', 0.2], ['E', 'F', 0.2], ['F', 'A', 0.2], ['B', 'E', I]],
  openings: [[1, 'window', 1.5, 3.5], [5, 'door', 2.0, 3.0], [7, 'door', 1.0, 1.9], [3, 'window', 2.0, 4.0]],
  rooms: [['Lounge', ['A', 'B', 'E', 'F']], ['Kitchen', ['B', 'C', 'D', 'E']]],
})

// (d) Curved bay on the living room's south wall and a round tower at the north-east corner.
// Tower circle: centre (10, 0), r 1.5, three 90 degree arcs outside the rectangle.
const tw = 1.5 * (1 - Math.SQRT1_2) // sagitta of a 90 degree arc, r 1.5
const d = build({
  corners: { A: [0, 0], B: [6, 0], C: [8.5, 0], T1: [10, -1.5], T2: [11.5, 0], T3: [10, 1.5], D: [10, 8], E: [6, 8], F: [4.5, 8], G: [1.5, 8], H: [0, 8] },
  walls: [['A', 'B'], ['B', 'C'], ['C', 'T1', 0.3, tw], ['T1', 'T2', 0.3, tw], ['T2', 'T3', 0.3, tw], ['T3', 'D'], ['D', 'E'], ['E', 'F'],
    ['F', 'G', 0.3, 1.2], ['G', 'H'], ['H', 'A'], ['B', 'E', I]],
  openings: [[9, 'window', 0.8, 3.0], [4, 'window', 0.6, 1.6], [7, 'window', 1.0, 3.0], [11, 'door', 3.5, 4.5], [12, 'door', 5.0, 5.9]],
  rooms: [['Living room', ['A', 'B', 'E', 'F', 'G', 'H']], ['Study', ['B', 'C', 'T1', 'T2', 'T3', 'D', 'E']]],
})

// (e) Busy: six rooms and a hallway, many openings, furniture, compass and legend.
const e = build({
  corners: {
    A: [0, 0], B: [5, 0], C: [9, 0], D: [14, 0],
    E: [0, 4.2], F: [5, 4.2], G: [9, 4.2], H: [14, 4.2],
    J: [0, 5.6], K: [4.5, 5.6], L: [7, 5.6], M: [14, 5.6],
    N: [0, 10], O: [4.5, 10], P: [7, 10], Q: [14, 10],
  },
  walls: [
    ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'H'], ['H', 'M'], ['M', 'Q'], ['Q', 'P'], ['P', 'O'], ['O', 'N'], ['N', 'J'], ['J', 'E'], ['E', 'A'],
    ['E', 'F', I], ['F', 'G', I], ['G', 'H', I], ['B', 'F', I], ['C', 'G', I],
    ['J', 'K', I], ['K', 'L', I], ['L', 'M', I], ['K', 'O', I], ['L', 'P', I],
  ],
  openings: [
    [1, 'window', 1.2, 3.2], [2, 'window', 1.0, 3.0], [3, 'window', 1.0, 4.0], [4, 'window', 1.0, 3.0], [6, 'window', 1.2, 3.2],
    [7, 'window', 2.0, 5.0], [9, 'window', 1.0, 3.0], [10, 'window', 1.0, 3.0], [11, 'door', 0.3, 1.2],
    [13, 'door', 3.6, 4.5], [14, 'door', 1.5, 2.4], [15, 'door', 0.5, 1.4], [18, 'door', 3.3, 4.2], [19, 'door', 0.8, 1.6], [20, 'door', 1.0, 1.9],
  ],
  rooms: [
    ['Kitchen', ['A', 'B', 'F', 'E']], ['Dining', ['B', 'C', 'G', 'F']], ['Living room', ['C', 'D', 'H', 'G']],
    ['Hallway', ['E', 'F', 'G', 'H', 'M', 'L', 'K', 'J']],
    ['Bedroom 1', ['J', 'K', 'O', 'N']], ['Bathroom', ['K', 'L', 'P', 'O']], ['Bedroom 2', ['L', 'M', 'Q', 'P']],
  ],
})

// Render hints: style and distractors. Dimension text is what a reader can measure from.
export const PLANS = {
  a: { plan: a, style: 'line', dims: [[[0, 0], [10, 0], -1.2, '10.00'], [[10, 0], [10, 7], -1.2, '7.00'], [[0, 0], [4.5, 0], -0.6, '4.50']] },
  b: {
    plan: b, style: 'agent', scaleBar: { at: [8, 10.2], len: 4 },
    labels: { r1: ['Kitchen', '4.2 × 3.6 m'], r2: ['Bedroom', '5.0 × 5.0 m'], r3: ['Living room', '7.0 × 9.0 m (max)'] },
    labelAt: { r3: [3.2, 6.4] },
  },
  c: { plan: c, style: 'sketch', dims: [[[0, 0], [8, 0], -0.9, '8 m']], rotate: 4, warp: 0.06 },
  d: { plan: d, style: 'agent', dims: [[[0, 8], [10, 8], 2.4, '10.0 m'], [[0, 0], [0, 8], 1.8, '8.0 m']], labelAt: { r1: [3, 4], r2: [8, 4] } },
  e: {
    plan: e, style: 'agent', scaleBar: { at: [0, 11.2], len: 5 }, compass: [16.2, 1.2],
    legend: [15.3, 6.5], furniture: true,
    labels: { r1: ['Kitchen'], r2: ['Dining'], r3: ['Living room'], r4: ['Hallway'], r5: ['Bedroom 1'], r6: ['Bathroom'], r7: ['Bedroom 2'] },
    labelAt: { r4: [11.5, 4.9] },
  },
}

// (f) Control for snapping: plan (b) scaled by 1.087 so nothing lands on round decimetres,
// only a scale bar to measure from, labels without sizes.
const k = 1.087, r2 = (v) => Math.round(v * 1000) / 1000
const f = structuredClone(b)
for (const c of f.corners) { c.x = r2(c.x * k); c.z = r2(c.z * k) }
for (const o of f.openings) { o.from = r2(o.from * k); o.to = r2(o.to * k) }
PLANS.f = { plan: f, style: 'agent', scaleBar: { at: [8.7, 11], len: 4 }, labelAt: { r3: [3.5, 7] } }
