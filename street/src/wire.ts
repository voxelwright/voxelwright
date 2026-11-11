// The street's wire format (#118 spike): small binary datagrams for what changes every tick
// and may be lost, and lines of JSON on a reliable stream for what must arrive. It knows
// nothing of the transport that carries it.
import type { Quat, Vec3 } from '../../home/src/engine/core.ts'
import type { ToySpec } from '../../home/src/engine/toy.ts'
import type { Input } from './walk.ts'

export const INPUT = 1, SNAP = 2, PING = 3, SELF = 4, DELAY = 5

/**
 * A toy as the page needs it to draw: the toy as the world process built it, less its gadgets
 * and wires (the page simulates nothing), the wire's number for each moving part, and where
 * those parts are now (they may have moved since they were made).
 */
export interface Drawn {
  toy: ToySpec
  ids: Record<string, number>
  poses: Record<string, { p: Vec3; q: Quat }>
}
export type Line =
  | { t: 'hello'; you: number; tickHz: number; snapHz: number; tick: number; floor: number; drawn: Drawn[] }
  | { t: 'add'; drawn: Drawn }
  | { t: 'remove'; toy: string }
  /** Someone asked for a thing: it is on its way to this spot. */
  | { t: 'making'; by: number; text: string; at: Vec3 }
  /** The asking ended: with a thing (its toy was added just before), with only a word, or (`ok` false) with why not. */
  | { t: 'made'; by: number; ok: boolean; say: string; toy?: string }
  | { t: 'said'; by: number; text: string }

/** What a page asks of the world, as lines of JSON on its own reliable stream. */
export type Ask =
  /** Make a thing from a sentence, on the ground in front of the asker, who faces `yaw`. */
  | { t: 'make'; text: string; yaw: number }
  | { t: 'say'; text: string }
  /** Take back the last thing this seat made. */
  | { t: 'unmake' }
  /** Back to where residents arrive. */
  | { t: 'top' }

/** Positions travel as 2 mm steps in 16 bits: 65 m either way. */
const STEP = 0.002
const q16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v / STEP)))

/** A turn in 32 bits: which part is largest (it is made positive and left out), and the other three in 10 bits each. */
export function packQuat(q: Quat): number {
  let big = 0
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[big])) big = i
  const sign = q[big] < 0 ? -1 : 1
  let out = big, shift = 0
  for (let i = 0; i < 4; i++) {
    if (i === big) continue
    const n = Math.max(0, Math.min(1023, Math.round((q[i] * sign * Math.SQRT1_2 + 0.5) * 1023)))
    out += n * 4 ** (1 + shift * 5)
    shift++
  }
  return out >>> 0
}
export function unpackQuat(n: number): Quat {
  const big = n & 3, q: Quat = [0, 0, 0, 0]
  let rest = Math.floor(n / 4), sum = 0
  for (let i = 0; i < 4; i++) {
    if (i === big) continue
    q[i] = ((rest & 1023) / 1023 - 0.5) / Math.SQRT1_2
    rest = Math.floor(rest / 1024)
    sum += q[i] * q[i]
  }
  q[big] = Math.sqrt(Math.max(0, 1 - sum))
  return q
}

/** The newest inputs, newest first, so one lost datagram loses nothing. */
export function packInputs(inputs: Input[]): Uint8Array {
  const out = new Uint8Array(6 + inputs.length * 3), v = new DataView(out.buffer)
  v.setUint8(0, INPUT)
  v.setUint32(1, inputs[0].seq)
  v.setUint8(5, inputs.length)
  inputs.forEach((input, i) => {
    v.setInt8(6 + i * 3, Math.round(Math.max(-1, Math.min(1, input.x)) * 127))
    v.setInt8(7 + i * 3, Math.round(Math.max(-1, Math.min(1, input.z)) * 127))
    v.setUint8(8 + i * 3, input.jump ? 1 : 0)
  })
  return out
}
export function unpackInputs(data: Uint8Array): Input[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.byteLength < 6) return []
  const newest = v.getUint32(1), n = Math.min(v.getUint8(5), Math.floor((data.byteLength - 6) / 3))
  const out: Input[] = []
  for (let i = 0; i < n; i++) out.push({ seq: newest - i, x: v.getInt8(6 + i * 3) / 127, z: v.getInt8(7 + i * 3) / 127, jump: v.getUint8(8 + i * 3) === 1 })
  return out
}
/** What the page sends is rounded on the way; it predicts with the same rounded input. */
export const rounded = (input: Input): Input => unpackInputs(packInputs([input]))[0]

export interface Pose { id: number; p: Vec3; q: Quat }
export const POSE_BYTES = 12
/** As many poses as fit a datagram of `room` bytes. */
export const posesIn = (room: number) => Math.min(255, Math.floor((room - 6) / POSE_BYTES))
export function packSnap(tick: number, poses: Pose[]): Uint8Array {
  const out = new Uint8Array(6 + poses.length * POSE_BYTES), v = new DataView(out.buffer)
  v.setUint8(0, SNAP)
  v.setUint32(1, tick)
  v.setUint8(5, poses.length)
  poses.forEach((pose, i) => {
    const o = 6 + i * POSE_BYTES
    v.setUint16(o, pose.id)
    v.setInt16(o + 2, q16(pose.p[0]))
    v.setInt16(o + 4, q16(pose.p[1]))
    v.setInt16(o + 6, q16(pose.p[2]))
    v.setUint32(o + 8, packQuat(pose.q))
  })
  return out
}
export function unpackSnap(data: Uint8Array): { tick: number; poses: Pose[] } {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const tick = v.getUint32(1), n = Math.min(v.getUint8(5), Math.floor((data.byteLength - 6) / POSE_BYTES))
  const poses: Pose[] = []
  for (let i = 0; i < n; i++) {
    const o = 6 + i * POSE_BYTES
    poses.push({ id: v.getUint16(o), p: [v.getInt16(o + 2) * STEP, v.getInt16(o + 4) * STEP, v.getInt16(o + 6) * STEP], q: unpackQuat(v.getUint32(o + 8)) })
  }
  return { tick, poses }
}

/** The walker's own state in full precision, with the last input the world has applied. */
export interface Self { tick: number; ack: number; p: Vec3; v: Vec3; hop: number; grounded: boolean }
export function packSelf(s: Self): Uint8Array {
  const out = new Uint8Array(35), v = new DataView(out.buffer)
  v.setUint8(0, SELF)
  v.setUint32(1, s.tick)
  v.setUint32(5, s.ack)
  for (let i = 0; i < 3; i++) { v.setFloat32(9 + i * 4, s.p[i]); v.setFloat32(21 + i * 4, s.v[i]) }
  v.setUint8(33, s.hop)
  v.setUint8(34, s.grounded ? 1 : 0)
  return out
}
export function unpackSelf(data: Uint8Array): Self {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const f = (o: number): Vec3 => [v.getFloat32(o), v.getFloat32(o + 4), v.getFloat32(o + 8)]
  return { tick: v.getUint32(1), ack: v.getUint32(5), p: f(9), v: f(21), hop: v.getUint8(33), grounded: v.getUint8(34) === 1 }
}

/** A clock reading the world sends straight back, to time the round trip. */
export function packPing(t: number): Uint8Array {
  const out = new Uint8Array(9)
  new DataView(out.buffer).setUint8(0, PING)
  new DataView(out.buffer).setFloat64(1, t)
  return out
}
export const unpackPing = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(1)

/** A test knob: hold everything to and from this seat for `ms` each way, give or take `jitter`. */
export function packDelay(ms: number, jitter: number): Uint8Array {
  const out = new Uint8Array(5), v = new DataView(out.buffer)
  v.setUint8(0, DELAY)
  v.setUint16(1, ms)
  v.setUint16(3, jitter)
  return out
}
export function unpackDelay(data: Uint8Array) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { ms: Math.min(1000, v.getUint16(1)), jitter: Math.min(500, v.getUint16(3)) }
}
