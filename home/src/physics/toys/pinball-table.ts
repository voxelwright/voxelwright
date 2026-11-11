// A pinball table in the living room, as a parts list only (#74). It plays because of what
// it is made of: a steel ball on a slick lacquered playfield, rubber posts whose impact
// sensors are wired to kicks and to a score counter, two maple flippers on motor hinges,
// a plunger piston, and a drain zone along the bottom.
// It is a game because of what is wired to what (#108), again with no pinball code:
// - A round: pulling the plunger starts one, three balls, the last one lost ends it, and the
//   next pull starts another. Three lamps on the backbox are the balls left, a red one the end.
// - A ball is lost when none is left in play: `live` counts balls served and released against
//   balls that reached the drain. A drained ball lies in the gutter until it is served again.
// - Worth: bumpers and slingshots 10, a top lane 50, a side target 30.
// - Two missions: roll through all three top lanes for 500 and a multiball (the two spare
//   balls in the gutter are released at the top); hit all four side targets for 1000 and,
//   the first time in a round, another ball.
// - A ball lost within twelve seconds of a round starting, or of the last ball being used,
//   comes back free: a timer, and a blue lamp lit while it counts. A ball that came back
//   free does not start the timer again.
// - The best score is a part too (`record`), on its own card over the scoreboard; the home
//   keeps it between visits (physics/best.ts).
// - What a hit feels like is parts too: each bumper has its own bell (C, E, G), lanes and
//   targets theirs, a prize rings a run up and a lost ball a run down; bumpers nudge the
//   view and a prize jolts it and holds the world for a beat.
// Played, it runs under its own mode: two collision steps a frame, so a fast flipper meets
// the ball instead of passing it (a flip then reaches the top of the table).
import { LIVING_X } from '../../layout'
import type { GameMode } from '../../engine/mode'
import type { GadgetSpec, PartSpec, ToySpec, Wire } from '../../engine/toy'

const AT: [number, number, number] = [LIVING_X + 0.9, 0.92, 1.0]
const TILT = 0.113 // 6.5 degrees, a real table's lean
const W = 0.26, L = 0.52 // half width and half length of the playfield
const WALL_H = 0.025
const BALL = 0.0135
/** Where a ball waits to be shot: in the lane, against the plunger. */
const SERVE: [number, number, number] = [W - 0.0195, BALL, L - 0.05 - 0.02 - BALL - 0.002]

const wall = (id: string, x: number, z: number, hx: number, hz: number, yaw = 0, material: PartSpec['material'] = 'walnut', paint?: string): PartSpec =>
  ({ id, shape: { kind: 'box', half: [hx, WALL_H, hz] }, material, at: [x, WALL_H, z], turn: [0, yaw, 0], ...(paint ? { paint } : {}) })
/** A lamp's lens on the backbox, facing the player. */
const lens = (id: string, x: number, paint: string): PartSpec =>
  ({ id, shape: { kind: 'cylinder', halfHeight: 0.005, radius: 0.017 }, material: 'glass', paint, at: [x, 0.085, -L - 0.037], turn: [Math.PI / 2, 0, 0] })
const post = (id: string, x: number, z: number, r: number, paint: string): PartSpec =>
  ({ id, shape: { kind: 'cylinder', halfHeight: 0.02, radius: r }, material: 'rubber', paint, at: [x, 0.02, z] })
/** A light set into the playfield that knows when a ball rolls over it: a trigger volume, drawn. */
const insert = (id: string, x: number, z: number, paint: string): PartSpec =>
  ({ id, shape: { kind: 'cylinder', halfHeight: 0.0015, radius: 0.022 }, material: 'glass', paint, at: [x, 0.0016, z], sensor: true })
/** A standing target on a side wall. */
const target = (id: string, x: number, z: number, paint: string): PartSpec =>
  ({ id, shape: { kind: 'box', half: [0.006, 0.02, 0.022] }, material: 'rubber', paint, at: [x, 0.02, z] })
const ball = (id: string, at: [number, number, number]): PartSpec => ({ id, shape: { kind: 'sphere', radius: BALL }, material: 'steel', motion: 'dynamic', at })

const BUMPERS = ['a', 'b', 'c']
const SLINGS = ['left', 'right']
const POSTS = ['left', 'right']
const LANES = ['a', 'b', 'c']
const TARGETS = ['a', 'b', 'c', 'd']
/** The top lanes' centres across the table, between their dividers. */
const LANE_X = [-0.1325, -0.0475, 0.0375]
const LANE_Z = -0.39
/** The flippers' pivots (x) and their line (z): bats 75 mm long, their tips a ball and a third apart at rest. */
const FLIP = [-0.108, 0.058], FLIP_Z = 0.405

/** A thing that scores when struck: its sensor, and its own lamp flashing. */
const struck = (part: string, threshold: number, seconds = 0.18): GadgetSpec[] => [
  { id: `${part}-sensor`, kind: 'sensor', part, knobs: { threshold } },
  { id: `${part}-lamp`, kind: 'lamp', part, knobs: { seconds } },
]
const kicks = (part: string, strength: number): GadgetSpec => ({ id: `${part}-kick`, kind: 'kick', part, knobs: { strength } })
const wires = (from: string, ...to: string[]): Wire[] => to.map((t) => ({ from, to: t }))

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
    { id: 'best', shape: { kind: 'box', half: [0.11, 0.026, 0.004] }, material: 'maple', paint: '#f6ead2', at: [0, 0.306, -L - 0.036] },
    lens('life-1', -0.15, '#f2b34a'),
    lens('life-2', -0.09, '#f2b34a'),
    lens('life-3', -0.03, '#f2b34a'),
    lens('save', 0.06, '#6fa8d6'),
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
    // Three lanes across the top, a light in each.
    ...[-0.175, -0.09, -0.005, 0.08].map((x, i) => wall(`divider-${i + 1}`, x, LANE_Z, 0.004, 0.035, 0, 'maple')),
    ...LANES.map((k, i) => insert(`lane-${k}`, LANE_X[i], LANE_Z, '#7fb4c9')),
    post('bumper-a', -0.16, -0.27, 0.03, '#d9573f'),
    post('bumper-b', 0.03, -0.28, 0.03, '#e6b85a'),
    post('bumper-c', -0.065, -0.17, 0.03, '#7fa37a'),
    // Standing targets: two on the left rail, two on the lane's wall.
    target('target-a', -W + 0.006, -0.06, '#e6b85a'),
    target('target-b', -W + 0.006, 0.05, '#e6b85a'),
    target('target-c', W - 0.056, -0.1, '#e6b85a'),
    target('target-d', W - 0.056, 0.02, '#e6b85a'),
    post('peg-left', -0.13, 0.1, 0.012, '#f3ede0'),
    post('peg-right', 0.08, 0.1, 0.012, '#f3ede0'),
    // On the centre line above the gap: a ball falling straight down the middle is turned onto a flipper.
    post('peg-middle', -0.025, 0.27, 0.012, '#f3ede0'),
    // Inlane guides down to the flippers, each ending a ball's drop above its flipper's pivot (lower, and a slow ball
    // rests in the corner between them). They stop short of the walls: past their top ends a ball is lost down the side.
    wall('guide-left', -0.164, 0.35, 0.065, 0.005, -0.666, 'maple'),
    wall('guide-right', 0.114, 0.35, 0.065, 0.005, 0.666, 'maple'),
    // A live post on each wall above the side lane: it knocks a ball running down the wall back into the field, so only
    // one that bounces into the gap between post and slingshot is lost.
    post('post-left', -W + 0.01, 0.27, 0.01, '#e6b85a'),
    post('post-right', W - 0.06, 0.27, 0.01, '#e6b85a'),
    // Slingshots: a rubber band along the top half of each guide, which throws back what lands on it hard.
    wall('sling-left', -0.181, 0.323, 0.032, 0.006, -0.666, 'rubber', '#d9573f'),
    wall('sling-right', 0.131, 0.323, 0.032, 0.006, 0.666, 'rubber', '#d9573f'),
    // Flippers: maple bats on motor hinges, resting 30 degrees down toward the drain.
    { id: 'flipper-left', shape: { kind: 'box', half: [0.0375, 0.012, 0.009] }, material: 'maple', paint: '#f3ede0', motion: 'dynamic', at: [FLIP[0] + 0.866 * 0.0375, 0.013, FLIP_Z + 0.5 * 0.0375], turn: [0, -0.5236, 0] },
    { id: 'flipper-right', shape: { kind: 'box', half: [0.0375, 0.012, 0.009] }, material: 'maple', paint: '#f3ede0', motion: 'dynamic', at: [FLIP[1] - 0.866 * 0.0375, 0.013, FLIP_Z + 0.5 * 0.0375], turn: [0, 0.5236, 0] },
    { id: 'plunger', shape: { kind: 'box', half: [0.014, 0.014, 0.02] }, material: 'brass', motion: 'dynamic', at: [W - 0.0195, 0.014, L - 0.05] },
    ball('ball', SERVE),
    // Two spare balls, lying in the gutter until a multiball releases them.
    ball('ball-2', [-0.2, BALL, L - BALL - 0.001]),
    ball('ball-3', [-0.165, BALL, L - BALL - 0.001]),
    // The drain: the whole bottom of the table, under the flippers and both side lanes.
    { id: 'drain', shape: { kind: 'box', half: [0.2315, 0.02, 0.015] }, material: 'glass', at: [-0.0235, 0.02, L - 0.017], hidden: true, sensor: true },
  ],
  gadgets: [
    { id: 'plunger-spring', kind: 'piston', part: 'plunger', axis: [0, 0, -1], input: 'plunger', knobs: { strength: 4.5, travel: 0.025, charge: 0.8 } },
    { id: 'left-flipper', kind: 'hinge', part: 'flipper-left', anchor: [FLIP[0], 0.013, FLIP_Z], axis: [0, 1, 0], input: 'left', knobs: { speed: 60, torque: 5, swing: 1.0 } },
    { id: 'right-flipper', kind: 'hinge', part: 'flipper-right', anchor: [FLIP[1], 0.013, FLIP_Z], axis: [0, -1, 0], input: 'right', knobs: { speed: 60, torque: 5, swing: 1.0 } },
    ...BUMPERS.flatMap((k) => [...struck(`bumper-${k}`, 0.002), kicks(`bumper-${k}`, 1.2)]),
    ...SLINGS.flatMap((k) => [...struck(`sling-${k}`, 0.02), kicks(`sling-${k}`, 0.9)]),
    ...POSTS.flatMap((k) => [...struck(`post-${k}`, 0.0005), kicks(`post-${k}`, 0.7)]),
    ...TARGETS.flatMap((k) => struck(`target-${k}`, 0.004)),
    ...LANES.flatMap((k): GadgetSpec[] => [{ id: `lane-${k}-zone`, kind: 'zone', part: `lane-${k}` }, { id: `lane-${k}-lamp`, kind: 'lamp', part: `lane-${k}` }]),
    { id: 'score', kind: 'counter', display: 'scoreboard', knobs: { step: 10 } },
    { id: 'lane-worth', kind: 'points', knobs: { value: 50 } },
    { id: 'target-worth', kind: 'points', knobs: { value: 30 } },
    { id: 'lanes-worth', kind: 'points', knobs: { value: 500 } },
    { id: 'targets-worth', kind: 'points', knobs: { value: 1000 } },
    // What a hit feels like: bells (semitones above middle C), the view's jump, and a held beat.
    { id: 'bumper-a-bell', kind: 'bell', part: 'bumper-a', knobs: { note: 12 } },
    { id: 'bumper-b-bell', kind: 'bell', part: 'bumper-b', knobs: { note: 16 } },
    { id: 'bumper-c-bell', kind: 'bell', part: 'bumper-c', knobs: { note: 19 } },
    { id: 'sling-bell', kind: 'bell', knobs: { note: 7 } },
    { id: 'lane-bell', kind: 'bell', knobs: { note: 24 } },
    { id: 'target-bell', kind: 'bell', knobs: { note: 21 } },
    { id: 'prize-bell', kind: 'bell', knobs: { note: 12, rings: 5, step: 5 } },
    { id: 'start-bell', kind: 'bell', knobs: { note: 12, rings: 2, step: 7 } },
    { id: 'lost-bell', kind: 'bell', knobs: { note: 7, rings: 2, step: -7 } },
    { id: 'over-bell', kind: 'bell', knobs: { note: 12, rings: 4, step: -5 } },
    { id: 'bump', kind: 'shake', knobs: { strength: 0.14 } },
    { id: 'jolt', kind: 'shake', knobs: { strength: 0.8 } },
    { id: 'beat', kind: 'freeze', knobs: { seconds: 0.09 } },
    { id: 'best', kind: 'record', display: 'best' },
    // The missions.
    { id: 'lanes', kind: 'collect', knobs: { count: 3 } },
    { id: 'targets', kind: 'collect', knobs: { count: 4 } },
    // The round: three balls, and a ball is used when none is left in play.
    { id: 'game', kind: 'game' },
    { id: 'balls', kind: 'counter', knobs: { step: 1, start: 3, target: 0 } },
    { id: 'live', kind: 'counter', knobs: { step: 1, start: 1, target: 0 } },
    // One more ball to win a round: counted down once, so only the first set of targets gives it.
    { id: 'bonus-ball', kind: 'counter', knobs: { step: 1, start: 1, target: 0 } },
    { id: 'life-1-lamp', kind: 'lamp', part: 'life-1', knobs: { level: 1, lit: 1 } },
    { id: 'life-2-lamp', kind: 'lamp', part: 'life-2', knobs: { level: 2, lit: 1 } },
    { id: 'life-3-lamp', kind: 'lamp', part: 'life-3', knobs: { level: 3, lit: 1 } },
    { id: 'over-lamp', kind: 'lamp', part: 'over' },
    // A grace period for each of a round's balls: one lost while it counts comes back and costs nothing.
    { id: 'saver', kind: 'timer', knobs: { seconds: 12 } },
    { id: 'save-lamp', kind: 'lamp', part: 'save' },
    { id: 'save-bell', kind: 'bell', knobs: { note: 19, rings: 2, step: 5 } },
    { id: 'drain-zone', kind: 'zone', part: 'drain' },
    // The ball in the lane is in play from the start; the spares come out at the top, rolling down.
    { id: 'serve', kind: 'spawner', part: 'ball', at: SERVE, knobs: { out: 1 } },
    { id: 'release-2', kind: 'spawner', part: 'ball-2', at: [LANE_X[0], BALL, -0.33], toward: [0, 0, 1], knobs: { speed: 0.4 } },
    { id: 'release-3', kind: 'spawner', part: 'ball-3', at: [LANE_X[2], BALL, -0.33], toward: [0, 0, 1], knobs: { speed: 0.4 } },
  ],
  wires: [
    ...BUMPERS.flatMap((k) => wires(`bumper-${k}-sensor.hit`, `bumper-${k}-kick.fire`, 'score.add', `bumper-${k}-lamp.flash`, `bumper-${k}-bell.ring`, 'bump.hit')),
    ...SLINGS.flatMap((k) => wires(`sling-${k}-sensor.hit`, `sling-${k}-kick.fire`, 'score.add', `sling-${k}-lamp.flash`, 'sling-bell.ring', 'bump.hit')),
    ...POSTS.flatMap((k) => wires(`post-${k}-sensor.hit`, `post-${k}-kick.fire`, `post-${k}-lamp.flash`)),
    // A target stays lit once hit; all four pay out and go dark again.
    ...TARGETS.flatMap((k) => wires(`target-${k}-sensor.hit`, `target-${k}-lamp.on`, `targets.${k}`, 'target-worth.in', 'target-bell.ring')),
    ...wires('targets.all', ...TARGETS.map((k) => `target-${k}-lamp.off`), 'targets-worth.in', 'bonus-ball.sub', 'prize-bell.ring', 'jolt.hit', 'beat.hit'),
    ...wires('bonus-ball.reached', 'balls.add'),
    // A lane stays lit once rolled through; all three pay out, go dark and release the spare balls.
    ...LANES.flatMap((k) => wires(`lane-${k}-zone.enter`, `lane-${k}-lamp.on`, `lanes.${k}`, 'lane-worth.in', 'lane-bell.ring')),
    ...wires('lanes.all', ...LANES.map((k) => `lane-${k}-lamp.off`), 'lanes-worth.in', 'release-2.spawn', 'release-3.spawn', 'prize-bell.ring', 'jolt.hit', 'beat.hit'),
    ...['lane-worth', 'target-worth', 'lanes-worth', 'targets-worth'].flatMap((id) => wires(`${id}.out`, 'score.plus')),
    // A round starts with a pull of the plunger (it does nothing while one runs) and clears the board.
    ...wires('plunger-spring.fired', 'game.start'),
    ...wires('game.started', 'saver.start', 'start-bell.ring', 'score.reset', 'balls.reset', 'bonus-ball.reset', 'over-lamp.off', 'lanes.reset', 'targets.reset', ...LANES.map((k) => `lane-${k}-lamp.off`), ...TARGETS.map((k) => `target-${k}-lamp.off`)),
    ...wires('score.changed', 'game.score'),
    // Balls in play: one more for each served or released, one fewer for each that reaches the drain.
    ...wires('drain-zone.enter', 'serve.back', 'release-2.back', 'release-3.back'),
    ...['serve', 'release-2', 'release-3'].flatMap((id) => [...wires(`${id}.spawned`, 'live.add'), ...wires(`${id}.back`, 'live.sub')]),
    // None left in play: within the grace period the ball comes straight back; after it, in a round that is a ball
    // used, and outside one the ball is just served again.
    ...wires('saver.started', 'save-lamp.on'),
    ...wires('saver.done', 'save-lamp.off'),
    ...wires('live.reached', 'saver.pass'),
    ...wires('saver.running', 'serve.spawn', 'save-bell.ring'),
    ...wires('saver.idle', 'game.during'),
    ...wires('game.during', 'balls.sub', 'lost-bell.ring'),
    ...wires('game.idle', 'serve.spawn'),
    ...wires('balls.changed', 'life-1-lamp.set', 'life-2-lamp.set', 'life-3-lamp.set'),
    ...wires('balls.counting', 'serve.spawn'),
    ...wires('game.during', 'saver.start'),
    ...wires('balls.reached', 'game.lose'),
    ...wires('best.beaten', 'prize-bell.ring'),
    ...wires('game.lost', 'best.in', 'over-lamp.on', 'serve.spawn', 'over-bell.ring', 'saver.stop', 'save-lamp.off'),
  ],
}

/** How the table is played: under its own rules while it is chosen (mode.ts puts them back after). */
export const PINBALL_MODE: GameMode = { id: 'pinball', label: 'Pinball', rules: { substeps: 2, rest: 0.004 } }

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
