// A candle on the kitchen table (#74): fire as a part, not code. A wax candle in a brass dish with
// a `flame` gadget on it. "Light a candle" on the notepad lights it; wired to a sensor or a key, so
// could anything else. It burns for hours (wax's burn rate) and its small flame is enough to light
// paper held over it, as heat in the field, by the same rules as everything else.
import type { ToySpec } from '../../engine/toy'

export const CANDLE: ToySpec = {
  id: 'candles',
  label: 'Candle',
  frame: { at: [-0.3, 0.762, -0.17], yaw: 0, tilt: 0 },
  inputs: {},
  parts: [
    { id: 'dish', shape: { kind: 'cylinder', halfHeight: 0.006, radius: 0.05 }, material: 'brass', at: [0, 0.006, 0] },
    { id: 'candle', shape: { kind: 'cylinder', halfHeight: 0.065, radius: 0.019 }, material: 'wax', paint: '#f3ead6', motion: 'dynamic', mass: 0.12, at: [0, 0.078, 0] },
  ],
  gadgets: [{ id: 'flame', kind: 'flame', part: 'candle', knobs: { lit: 0 } }],
  wires: [],
}
