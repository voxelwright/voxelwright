// A pinball table in the living room, as a parts list only (#74). It plays because of what
// it is made of: a steel ball on a slick lacquered playfield, rubber posts whose impact
// sensors are wired to kicks and to a score counter, two maple flippers on motor hinges,
// a plunger piston, and a drain zone wired to an emitter that puts the ball back.
// It is a game because of what is wired to what (#108), again with no pinball code: pulling the
// plunger starts a round, each ball put back counts one off three, the last one loses the round,
// and the next pull starts another. Three lamps on the backbox are the balls left, a red one is
// the end, and each bumper's own lamp flashes when it is hit.
import { LIVING_X } from '../../layout'
import type { PartSpec, ToySpec } from '../../engine/toy'

const AT: [number, number, number] = [LIVING_X + 0.9, 0.92, 1.0]
const TILT = 0.113 // 6.5 degrees, a real table's lean
const W = 0.26, L = 0.52 // half width and half length of the playfield
const WALL_H = 0.025
const BALL = 0.0135

const wall = (id: string, x: number, z: number, hx: number, hz: number, yaw = 0, material: PartSpec['material'] = 'walnut'): PartSpec =>
  ({ id, shape: { kind: 'box', half: [hx, WALL_H, hz] }, material, at: [x, WALL_H, z], turn: [0, yaw, 0] })
/** A lamp's lens on the backbox, facing the player. */
const lens = (id: string, x: number, paint: string): PartSpec =>
  ({ id, shape: { kind: 'cylinder', halfHeight: 0.005, radius: 0.017 }, material: 'glass', paint, at: [x, 0.085, -L - 0.037], turn: [Math.PI / 2, 0, 0] })
const post = (id: string, x: number, z: number, r: number, paint: string): PartSpec =>
  ({ id, shape: { kind: 'cylinder', halfHeight: 0.02, radius: r }, material: 'rubber', paint, at: [x, 0.02, z] })

export const PINBALL: ToySpec = {
  id: 'pinball',
  label: 'Pinball',
  frame: { at: AT, yaw: 0, tilt: TILT },
  handle: 'playfield',
  inputs: {
    left: ['ShiftLeft', 'KeyZ', 'ArrowLeft'],
    right: ['ShiftRight', 'Slash', 'ArrowRight'],
    plunger: ['ArrowDown', 'Space'],
  },
  parts: [
    { id: 'playfield', shape: { kind: 'box', half: [W, 0.01, L] }, material: 'lacquer', paint: '#efdcb4', at: [0, -0.01, 0] },
    { id: 'cabinet', shape: { kind: 'box', half: [W + 0.03, 0.06, L + 0.04] }, material: 'walnut', at: [0, -0.08, 0] },
    { id: 'backbox', shape: { kind: 'box', half: [W + 0.03, 0.17, 0.03] }, material: 'walnut', at: [0, 0.17, -L - 0.07] },
    { id: 'scoreboard', shape: { kind: 'box', half: [0.2, 0.07, 0.004] }, material: 'maple', paint: '#f6ead2', at: [0, 0.2, -L - 0.036] },
    lens('life-1', -0.15, '#f2b34a'),
    lens('life-2', -0.09, '#f2b34a'),
    lens('life-3', -0.03, '#f2b34a'),
    lens('over', 0.15, '#d9573f'),
    // A glass lid: the ball stays on the table whatever the rules do to it.
    { id: 'lid', shape: { kind: 'box', half: [W + 0.02, 0.004, L + 0.02] }, material: 'glass', at: [0, 2 * WALL_H + 0.006, 0], hidden: true },
    wall('rail-left', -W - 0.006, 0, 0.006, L),
    wall('rail-right', W + 0.006, 0, 0.006, L),
    wall('rail-top', 0, -L - 0.006, W + 0.012, 0.006),
    wall('rail-bottom', 0, L + 0.006, W + 0.012, 0.006),
    // The shooter lane along the right rail, and the corner guides that turn a shot into the field.
    wall('lane', W - 0.045, 0.11, 0.005, 0.41, 0, 'maple'),
    wall('corner-right', W - 0.045, -L + 0.045, 0.07, 0.005, -Math.PI / 4, 'maple'),
    wall('corner-left', -W + 0.045, -L + 0.045, 0.07, 0.005, Math.PI / 4, 'maple'),
    // Inlane guides down to the flippers.
    wall('guide-left', -0.19, 0.335, 0.089, 0.005, -0.666, 'maple'),
    wall('guide-right', 0.14, 0.335, 0.089, 0.005, 0.666, 'maple'),
    post('bumper-a', -0.2, -0.3, 0.03, '#d9573f'),
    post('bumper-b', 0.06, -0.3, 0.03, '#e6b85a'),
    post('bumper-c', -0.1, -0.18, 0.03, '#7fa37a'),
    post('peg-left', -0.17, 0.0, 0.012, '#f3ede0'),
    post('peg-right', 0.12, 0.02, 0.012, '#f3ede0'),
    // Flippers: maple bats on motor hinges, resting 30 degrees down toward the drain.
    { id: 'flipper-left', shape: { kind: 'box', half: [0.0375, 0.012, 0.009] }, material: 'maple', paint: '#f3ede0', motion: 'dynamic', at: [-0.115 + 0.866 * 0.0375, 0.013, 0.405 + 0.5 * 0.0375], turn: [0, -0.5236, 0] },
    { id: 'flipper-right', shape: { kind: 'box', half: [0.0375, 0.012, 0.009] }, material: 'maple', paint: '#f3ede0', motion: 'dynamic', at: [0.065 - 0.866 * 0.0375, 0.013, 0.405 + 0.5 * 0.0375], turn: [0, 0.5236, 0] },
    { id: 'plunger', shape: { kind: 'box', half: [0.014, 0.014, 0.02] }, material: 'brass', motion: 'dynamic', at: [W - 0.0195, 0.014, L - 0.05] },
    { id: 'ball', shape: { kind: 'sphere', radius: BALL }, material: 'steel', motion: 'dynamic', at: [W - 0.0195, BALL, L - 0.05 - 0.02 - BALL - 0.002] },
    { id: 'drain', shape: { kind: 'box', half: [0.1, 0.02, 0.015] }, material: 'glass', at: [-0.025, 0.02, L - 0.017], hidden: true, sensor: true },
  ],
  gadgets: [
    { id: 'plunger-spring', kind: 'piston', part: 'plunger', axis: [0, 0, -1], input: 'plunger', knobs: { strength: 4.5, travel: 0.025, charge: 0.8 } },
    { id: 'left-flipper', kind: 'hinge', part: 'flipper-left', anchor: [-0.115, 0.013, 0.405], axis: [0, 1, 0], input: 'left', knobs: { speed: 25, torque: 3, swing: 1.0 } },
    { id: 'right-flipper', kind: 'hinge', part: 'flipper-right', anchor: [0.065, 0.013, 0.405], axis: [0, -1, 0], input: 'right', knobs: { speed: 25, torque: 3, swing: 1.0 } },
    { id: 'bumper-a-sensor', kind: 'sensor', part: 'bumper-a', knobs: { threshold: 0.002 } },
    { id: 'bumper-b-sensor', kind: 'sensor', part: 'bumper-b', knobs: { threshold: 0.002 } },
    { id: 'bumper-c-sensor', kind: 'sensor', part: 'bumper-c', knobs: { threshold: 0.002 } },
    { id: 'bumper-a-kick', kind: 'kick', part: 'bumper-a', knobs: { strength: 1.2 } },
    { id: 'bumper-b-kick', kind: 'kick', part: 'bumper-b', knobs: { strength: 1.2 } },
    { id: 'bumper-c-kick', kind: 'kick', part: 'bumper-c', knobs: { strength: 1.2 } },
    { id: 'drain-zone', kind: 'zone', part: 'drain' },
    { id: 'ball-return', kind: 'emitter', part: 'ball', knobs: { delay: 0.6 } },
    { id: 'score', kind: 'counter', display: 'scoreboard', knobs: { step: 10 } },
    // The game: three balls a round, counted down as each is put back.
    { id: 'game', kind: 'game' },
    { id: 'balls', kind: 'counter', knobs: { step: -1, start: 3, target: 0 } },
    { id: 'life-1-lamp', kind: 'lamp', part: 'life-1', knobs: { level: 1, lit: 1 } },
    { id: 'life-2-lamp', kind: 'lamp', part: 'life-2', knobs: { level: 2, lit: 1 } },
    { id: 'life-3-lamp', kind: 'lamp', part: 'life-3', knobs: { level: 3, lit: 1 } },
    { id: 'over-lamp', kind: 'lamp', part: 'over' },
    { id: 'bumper-a-lamp', kind: 'lamp', part: 'bumper-a', knobs: { seconds: 0.18 } },
    { id: 'bumper-b-lamp', kind: 'lamp', part: 'bumper-b', knobs: { seconds: 0.18 } },
    { id: 'bumper-c-lamp', kind: 'lamp', part: 'bumper-c', knobs: { seconds: 0.18 } },
  ],
  wires: [
    ...['a', 'b', 'c'].flatMap((k) => [
      { from: `bumper-${k}-sensor.hit`, to: `bumper-${k}-kick.fire` },
      { from: `bumper-${k}-sensor.hit`, to: 'score.add' },
      { from: `bumper-${k}-sensor.hit`, to: `bumper-${k}-lamp.flash` },
    ]),
    { from: 'drain-zone.enter', to: 'ball-return.spawn' },
    // A round starts with a pull of the plunger (it does nothing while one runs) and clears the board.
    { from: 'plunger-spring.fired', to: 'game.start' },
    { from: 'game.started', to: 'score.reset' },
    { from: 'game.started', to: 'balls.reset' },
    { from: 'game.started', to: 'over-lamp.off' },
    { from: 'score.changed', to: 'game.score' },
    // A ball put back is a ball used: `spawned` fires once a drain, however the ball bounces in it.
    { from: 'ball-return.spawned', to: 'balls.add' },
    ...[1, 2, 3].map((n) => ({ from: 'balls.changed', to: `life-${n}-lamp.set` })),
    { from: 'balls.reached', to: 'game.lose' },
    { from: 'game.lost', to: 'over-lamp.on' },
  ],
}

/** The table's stand: four walnut legs, upright under the tilted cabinet. Decoration only. */
const leg = (id: string, x: number, z: number, top: number): PartSpec =>
  ({ id, shape: { kind: 'cylinder', halfHeight: top / 2, radius: 0.02 }, material: 'walnut', at: [x, top / 2, z] })
const backTop = AT[1] - 0.139 + 0.48 * Math.sin(TILT), frontTop = AT[1] - 0.139 - 0.48 * Math.sin(TILT)
export const PINBALL_STAND: ToySpec = {
  id: 'pinball-stand',
  label: 'Pinball stand',
  frame: { at: [AT[0], 0, AT[2]], yaw: 0, tilt: 0 },
  inputs: {},
  parts: [leg('leg-1', -0.25, -0.48, backTop), leg('leg-2', 0.25, -0.48, backTop), leg('leg-3', -0.25, 0.48, frontTop), leg('leg-4', 0.25, 0.48, frontTop)],
  gadgets: [],
  wires: [],
}
