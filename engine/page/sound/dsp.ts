// The synthesiser (#247): every sound of the engine, computed a sample at a time from patches (patch.ts), with no
// samples made beforehand. This file is the whole of what runs on the audio thread. It imports nothing, so the same
// file is the page's AudioWorklet module and what the checks render with in Node (test/sound.mjs), where its output
// is measured because nobody there can hear it.
//
// What is in it:
//   struck and rubbed things   a bank of modes (two-pole resonators), set going by a touch of a length that goes with
//                              how hard the two are and how fast they meet, or by noise for as long as they rub
//   plucked strings            a delay line with a loss filter in its loop (Karplus and Strong; Jaffe and Smith)
//   blown and bowed tones      a sine and a saw through a low-pass, with breath
//   air                        noise through a band that sweeps: a crash, a whoosh, a blast's crack and boom
//   beds                       rain, wind, fire, surf, the sea over your head, rubble shifting: noise shaped slowly, and grains
//   a room                     four delay lines fed back through each other
//   the ceiling                a limiter that looks 3 ms ahead and then a hard stop: nothing leaves louder than CEILING,
//                              whatever a patch says, and a number that is not a number silences and resets everything
//
// Nothing is allocated after the constructor. Times are frames of the context's own clock.

import type { Compiled } from './patch.ts'

const TAU = Math.PI * 2
/** Nothing leaves louder than this (-1 dBFS); the limiter starts to hold at KNEE (-4.4 dBFS). */
export const CEILING = 0.89, KNEE = 0.6
/** Numbers in a note: when (frames), which patch, pitch (Hz, or 0 for the patch's own over size), size (1 is the patch's own), force 0 to 1, how long held (s), left and right gain, low-pass (Hz), how much goes to the room, bus, and last: 0, or 1 for a piece of something breaking, or from 2 up a name for a note that is held until it is let go (`release`) and can be bent meanwhile (`glide`). */
export const NOTE = 12
/** Things set from outside and eased to: the beds' levels and where they are, the room, the buses, and the driven vehicle. */
export const SET = { rain: 0, wind: 1, fire: 2, firePan: 3, fireLp: 4, surf: 5, surfPan: 6, under: 7, rumble: 8, rumblePan: 9, muffle: 10, roomTime: 11, roomGain: 12, world: 13, music: 14, play: 15, master: 16, cover: 17, engineRpm: 18, engineLoad: 19, engineTone: 20, tireSlip: 21, roadRoll: 22, roadRough: 23, turboBoost: 24 } as const
const SETS = 25
/** The least and the most each may be set to: a level is 0 to 1 whoever asks. */
const LEAST = [0, 0, 0, -1, 40, 0, -1, 0, 0, -1, 40, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], MOST = [1, 1, 1, 1, 20000, 1, 1, 1, 1, 1, 20000, 8, 1, 1.5, 1.5, 1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1]
export const BUS = { world: 0, music: 1, play: 2 } as const
const BLOCK = 128
const MV = 64, MM = 12, SV = 16, TV = 16, AV = 24, GV = 40, PENDING = 4096

export class Synth {
  readonly sr: number
  frame = 0
  /** What it has done: voices sounding now, voices cut short for a newer one, the loudest sample out, the most the limiter held back (1 is none), notes dropped for want of room, blocks silenced for a bad number. */
  stats = { voices: 0, stolen: 0, peak: 0, held: 1, dropped: 0, reset: 0 }
  private patches: (Compiled | undefined)[] = []
  private seed = 0x9e3779b9
  private pending = new Float64Array(PENDING * NOTE)
  private waiting = 0
  private target = new Float32Array(SETS)
  private now = new Float32Array(SETS)
  // Work space for one block.
  private x = new Float32Array(BLOCK)
  private tmp = new Float32Array(BLOCK)
  private bus = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(BLOCK))
  private send = new Float32Array(BLOCK)
  // Struck and rubbed: MV voices of up to MM modes.
  private mOn = new Uint8Array(MV); private mWait = new Int32Array(MV); private mAge = new Int32Array(MV); private mLife = new Int32Array(MV); private mN = new Uint8Array(MV)
  private mY1 = new Float64Array(MV * MM); private mY2 = new Float64Array(MV * MM); private mA1 = new Float64Array(MV * MM); private mA2 = new Float64Array(MV * MM); private mB = new Float64Array(MV * MM); private mF = new Float32Array(MV * MM); private mR = new Float64Array(MV * MM)
  private mPulse = new Int32Array(MV); private mAt = new Int32Array(MV); private mAmp = new Float32Array(MV); private mRough = new Float32Array(MV); private mRub = new Int32Array(MV); private mRubAmp = new Float32Array(MV); private mRubEnv = new Float32Array(MV); private mRubLp = new Float32Array(MV); private mRubZ = new Float32Array(MV)
  private mBend = new Float32Array(MV); private mSettle = new Float32Array(MV); private mLoud = new Float32Array(MV)
  private mId = new Int32Array(MV); private mDamp = new Uint8Array(MV); private mGl = new Float32Array(MV); private mGr = new Float32Array(MV); private mLp = new Float32Array(MV); private mZ = new Float32Array(MV); private mSend = new Float32Array(MV); private mBus = new Uint8Array(MV)
  // Plucked strings.
  private sLen: number
  private sBuf: Float32Array
  private sOn = new Uint8Array(SV); private sWait = new Int32Array(SV); private sAge = new Int32Array(SV); private sLife = new Int32Array(SV); private sOff = new Int32Array(SV); private sN = new Int32Array(SV); private sRd = new Int32Array(SV)
  private sC = new Float32Array(SV); private sX1 = new Float32Array(SV); private sY1 = new Float32Array(SV); private sPrev = new Float32Array(SV); private sRho = new Float32Array(SV); private sRhoOff = new Float32Array(SV); private sS = new Float32Array(SV); private sLoud = new Float32Array(SV)
  private sId = new Int32Array(SV); private sGl = new Float32Array(SV); private sGr = new Float32Array(SV); private sLp = new Float32Array(SV); private sZ = new Float32Array(SV); private sSend = new Float32Array(SV); private sBus = new Uint8Array(SV)
  // Held tones.
  private tOn = new Uint8Array(TV); private tWait = new Int32Array(TV); private tAge = new Int32Array(TV); private tHold = new Int32Array(TV); private tStage = new Uint8Array(TV)
  private tPh = new Float64Array(TV); private tF = new Float32Array(TV); private tEnv = new Float32Array(TV); private tAtt = new Float32Array(TV); private tRel = new Float32Array(TV); private tAmp = new Float32Array(TV); private tTilt = new Float32Array(TV); private tRough = new Float32Array(TV); private tWaver = new Float32Array(TV)
  private tG = new Float32Array(TV); private t1 = new Float32Array(TV); private t2 = new Float32Array(TV); private tBg = new Float32Array(TV); private tB1 = new Float32Array(TV); private tB2 = new Float32Array(TV); private tChiff = new Float32Array(TV)
  private tGlTo = new Float32Array(TV); private tGrTo = new Float32Array(TV); private tAmp0 = new Float32Array(TV)
  private tId = new Int32Array(TV); private tTo = new Float32Array(TV); private tAmpTo = new Float32Array(TV); private tBright = new Float32Array(TV); private tGl = new Float32Array(TV); private tGr = new Float32Array(TV); private tLp = new Float32Array(TV); private tZ = new Float32Array(TV); private tSend = new Float32Array(TV); private tBus = new Uint8Array(TV)
  // Air.
  private aOn = new Uint8Array(AV); private aWait = new Int32Array(AV); private aAge = new Int32Array(AV); private aLife = new Int32Array(AV)
  private aFrom = new Float32Array(AV); private aTo = new Float32Array(AV); private aK = new Float32Array(AV); private aAmp = new Float32Array(AV); private a1 = new Float32Array(AV); private a2 = new Float32Array(AV)
  private aLp = new Float32Array(AV); private aZ = new Float32Array(AV); private aGl = new Float32Array(AV); private aGr = new Float32Array(AV); private aSend = new Float32Array(AV); private aBus = new Uint8Array(AV)
  // Grains: a drop of rain, a crack of the fire, a bubble.
  private gOn = new Uint8Array(GV); private gPh = new Float32Array(GV); private gInc = new Float32Array(GV); private gMul = new Float32Array(GV); private gAmp = new Float32Array(GV); private gDec = new Float32Array(GV); private gGl = new Float32Array(GV); private gGr = new Float32Array(GV)
  // Beds' own state.
  private bed = new Float64Array(96)
  // The room.
  private rLen: Int32Array; private rBuf: Float32Array[]; private rAt = new Int32Array(4); private rZ = new Float32Array(4); private rPre: Float32Array; private rPreAt = 0
  // Precomputed sample-rate constants (eliminates repeated Math.exp / Math.pow per 128-sample block, #139).
  private readonly c80: number; private readonly c300: number; private readonly c1200: number; private readonly c3500: number; private readonly c7000: number
  private readonly toneFade: number; private readonly limRelease: number; private readonly limAttack: number; private readonly duckEase: number; private readonly dcHold: number; private readonly glueDown: number
  private lastRoomTime = -1; private rG0 = 0; private rG1 = 0; private rG2 = 0; private rG3 = 0
  private lastMuffle = -1; private lastMuffleCut = 1
  // The ceiling.
  private look: number; private lBuf: Float32Array[]; private lAt = 0; private lEnv = 0; private lGain = 1; private mfl = new Float32Array(4); private duck = 0; private dc = new Float64Array(4); private glue = 0

  constructor(sr: number) {
    this.sr = sr
    this.c80 = 1 - Math.exp((-TAU * 80) / sr)
    this.c300 = 1 - Math.exp((-TAU * 300) / sr)
    this.c1200 = 1 - Math.exp((-TAU * 1200) / sr)
    this.c3500 = 1 - Math.exp((-TAU * 3500) / sr)
    this.c7000 = 1 - Math.exp((-TAU * 7000) / sr)
    this.toneFade = Math.exp(-1 / (0.06 * sr))
    this.limRelease = Math.exp(-1 / (0.12 * sr))
    this.limAttack = 1 - Math.exp(-1 / (0.0008 * sr))
    this.duckEase = Math.exp(-1 / (0.5 * sr))
    this.dcHold = 1 - (TAU * 20) / sr
    this.glueDown = Math.exp(-1 / (0.08 * sr))
    this.sLen = Math.ceil(sr / 25) + 8
    this.sBuf = new Float32Array(SV * this.sLen)
    this.rLen = Int32Array.from([0.0317, 0.0379, 0.0443, 0.0521].map((s) => Math.round(s * sr)))
    this.rBuf = [...this.rLen].map((n) => new Float32Array(n))
    this.rPre = new Float32Array(Math.round(0.012 * sr))
    this.look = Math.round(0.003 * sr)
    this.lBuf = [new Float32Array(this.look), new Float32Array(this.look)]
    this.target.set([0, 0, 0, 0, 20000, 0, 0, 0, 0, 0, 20000, 0.9, 0.5, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    this.now.set(this.target)
  }

  /** A patch under a number. Whatever it holds is kept within what is safe when a voice starts. */
  define(id: number, p: Compiled) { if (id >= 0 && id < 4096) this.patches[id] = p }
  /** Sets something eased to (SET): a bed's level, the room, a bus. */
  set(which: number, value: number) { if (which >= 0 && which < SETS && Number.isFinite(value)) this.target[which | 0] = Math.min(MOST[which | 0], Math.max(LEAST[which | 0], value)) }
  /** Notes to play, NOTE numbers each (the first is when, in frames of this clock; one already past plays now). */
  notes(list: Float64Array | number[]) {
    for (let i = 0; i + NOTE <= list.length; i += NOTE) {
      if (this.waiting === PENDING) { this.stats.dropped++; continue }
      for (let k = 0; k < NOTE; k++) this.pending[this.waiting * NOTE + k] = list[i + k]
      this.waiting++
    }
  }
  /** Stops every held note on a bus (an instrument put down, the music changing hands). */
  hush(bus: number) {
    for (let v = 0; v < TV; v++) if (this.tOn[v] && this.tBus[v] === bus) this.tStage[v] = 2
    for (let v = 0; v < SV; v++) if (this.sOn[v] && this.sBus[v] === bus) this.sOff[v] = this.sAge[v]
    for (let i = this.waiting - 1; i >= 0; i--) if (this.pending[i * NOTE + 10] === bus) this.pending.copyWithin(i * NOTE, --this.waiting * NOTE, this.waiting * NOTE + NOTE)
  }

  /** Lets go of a held note: a tone dies away by its patch, a string or a struck thing is damped as by a hand. One not yet begun is played short. */
  release(id: number) {
    if (!(id >= 2)) return
    for (let v = 0; v < TV; v++) if (this.tOn[v] && this.tId[v] === id) { this.tStage[v] = 2; this.tId[v] = 0 }
    for (let v = 0; v < SV; v++) if (this.sOn[v] && this.sId[v] === id) { this.sOff[v] = this.sAge[v]; this.sLife[v] = Math.min(this.sLife[v], this.sAge[v] + Math.round(0.3 * this.sr)); this.sId[v] = 0 }
    for (let v = 0; v < MV; v++) if (this.mOn[v] && this.mId[v] === id) { this.mDamp[v] = 1; this.mId[v] = 0 }
    for (let i = 0; i < this.waiting; i++) if (this.pending[i * NOTE + 11] === id) { this.pending[i * NOTE + 11] = 0; this.pending[i * NOTE + 5] = 0.08 }
  }
  /** Bends a held tone to a pitch (Hz) and a loudness (0 to 1 of its own), eased over a few milliseconds. */
  glide(id: number, hz: number, level: number) {
    if (!(id >= 2)) return
    for (let v = 0; v < TV; v++) if (this.tOn[v] && this.tId[v] === id) {
      if (hz > 0) this.tTo[v] = Math.min(0.45 * this.sr, Math.max(16, hz))
      if (level >= 0) this.tAmpTo[v] = Math.min(1, level)
    }
  }

  /**
   * Moves a held tone while it sounds: its left and right, how dull it is (Hz), how much goes to the room, and how
   * loud against how it began (0 to 2). For a sound that stays on something that moves.
   */
  place(id: number, gl: number, gr: number, lp: number, send: number, level: number) {
    if (!(id >= 2)) return
    const ok = (v: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : 0)
    for (let v = 0; v < TV; v++) if (this.tOn[v] && this.tId[v] === id) {
      this.tGlTo[v] = ok(gl, 1); this.tGrTo[v] = ok(gr, 1); this.tLp[v] = this.lpCoef(lp > 0 ? lp : 20000); this.tSend[v] = ok(send, 1)
      if (level >= 0) this.tAmpTo[v] = Math.min(1, this.tAmp0[v] * ok(level, 2))
    }
  }
  /** The names of the held tones that are sounding now: whoever holds one can tell that it is still there. */
  named(): number[] { const out: number[] = []; for (let v = 0; v < TV; v++) if (this.tOn[v] && this.tId[v] && this.tStage[v] < 2) out.push(this.tId[v]); return out }

  private rand() { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s; return (s >>> 0) / 4294967296 }
  private lpCoef(hz: number) { return hz >= 18000 ? 1 : 1 - Math.exp((-TAU * Math.max(40, hz)) / this.sr) }

  /** Fills `n` frames of left and right. */
  render(L: Float32Array, R: Float32Array, n = L.length) {
    for (let at = 0; at < n; at += BLOCK) this.block(L, R, at, Math.min(BLOCK, n - at))
  }

  private block(L: Float32Array, R: Float32Array, at: number, len: number) {
    const end = this.frame + len
    for (let i = this.waiting - 1; i >= 0; i--) {
      if (this.pending[i * NOTE] >= end) continue
      this.start(i * NOTE)
      // The last takes its place. A piece a note asked for went on the end and is looked at next time.
      this.pending.copyWithin(i * NOTE, (this.waiting - 1) * NOTE, this.waiting * NOTE)
      this.waiting--
    }
    for (let i = 0; i < SETS; i++) this.now[i] += (this.target[i] - this.now[i]) * 0.035
    for (const b of this.bus) b.fill(0, 0, len)
    this.send.fill(0, 0, len)
    let voices = 0
    for (let v = 0; v < MV; v++) if (this.mOn[v]) { voices++; this.modes(v, len) }
    for (let v = 0; v < SV; v++) if (this.sOn[v]) { voices++; this.string(v, len) }
    for (let v = 0; v < TV; v++) if (this.tOn[v]) { voices++; this.tone(v, len) }
    for (let v = 0; v < AV; v++) if (this.aOn[v]) { voices++; this.air(v, len) }
    this.beds(len)
    this.stats.voices = voices
    this.out(L, R, at, len)
    this.frame = end
  }

  // ── Starting a note ─────────────────────────────────────────────────────
  private start(i: number) {
    const q = this.pending, p = this.patches[q[i + 1]]
    if (!p) return
    const wait = Math.max(0, Math.round(q[i] - this.frame)), size = Math.min(8, Math.max(0.125, q[i + 3] || 1)), force = Math.min(1, Math.max(0.02, q[i + 4])), piece = q[i + 11] === 1, id = q[i + 11] >= 2 ? q[i + 11] | 0 : 0
    const pitch = Math.min(0.45 * this.sr, Math.max(16, q[i + 2] > 0 ? q[i + 2] : p.pitch / size))
    const gl = Math.min(1, Math.max(0, q[i + 6])), gr = Math.min(1, Math.max(0, q[i + 7])), lp = q[i + 8] > 0 ? q[i + 8] : 20000, send = Math.min(1, Math.max(0, q[i + 9])), bus = q[i + 10] === 1 ? 1 : q[i + 10] === 2 ? 2 : 0
    const gain = Math.min(1, Math.max(0, p.gain)) * force ** 1.2 * (piece ? 0.5 : 1)
    const v = p.strung ? this.pluck(p, wait, pitch, force, gain, id ? 0 : q[i + 5], gl, gr, lp, send, bus) : p.tone ? this.hold(p, wait, pitch, force, gain, id ? 1e6 : q[i + 5], gl, gr, lp, send, bus) : this.strike(p, wait, pitch, force, gain, p.how === 3 ? Math.max(0.02, id ? 30 : q[i + 5] || 0.3) : 0, piece, gl, gr, lp, send, bus)
    if (v < 0) { this.stats.dropped++; return }
    if (id) (p.strung ? this.sId : p.tone ? this.tId : this.mId)[v] = id
    if (piece) return
    if (p.airGain > 0 && p.airFor > 0) this.puff(wait, p.airFrom / size, p.airTo / size, p.airFor * Math.sqrt(size), p.airQ, p.airGain * gain, gl, gr, lp, send, bus)
    // What breaks goes on in pieces: each a small one of the same stuff, sooner rather than later, the small ones higher.
    const pieces = Math.min(40, p.pieces | 0)
    for (let k = 0; k < pieces && this.waiting < PENDING; k++) {
      const u = this.rand(), o = this.waiting++ * NOTE
      q.copyWithin(o, i, i + NOTE)
      q[o] = this.frame + wait + Math.round((-Math.log(1 - 0.95 * this.rand()) / 3) * Math.max(0.02, p.over) * this.sr)
      q[o + 2] = pitch * (1 + 3 * p.spread * u * u) * (0.9 + 0.2 * this.rand())
      q[o + 4] = force * (0.3 + 0.6 * this.rand()) * (1 - 0.5 * u)
      const pan = (this.rand() - 0.5) * 0.3
      q[o + 6] = gl * (1 - pan); q[o + 7] = gr * (1 + pan); q[o + 11] = 1
    }
  }

  /** The quietest voice of a pool, or a free one. */
  private free(on: Uint8Array, loud: Float32Array | null, n: number, buses: Uint8Array, bus: number) {
    let best = -1, least = Infinity
    for (let v = 0; v < n; v++) {
      if (!on[v]) return v
      // What is played by hand is never cut short for the world or the music.
      if (buses[v] === 2 && bus !== 2) continue
      const l = loud ? loud[v] : v
      if (l < least) { least = l; best = v }
    }
    if (best >= 0) this.stats.stolen++
    return best
  }

  private strike(p: Compiled, wait: number, pitch: number, force: number, gain: number, rub: number, piece: boolean, gl: number, gr: number, lp: number, send: number, bus: number) {
    const v = this.free(this.mOn, this.mLoud, MV, this.mBus, bus), sr = this.sr, at = v * MM
    if (v < 0) return -1
    let n = 0, longest = 0
    const most = piece ? 4 : MM
    for (let k = 0; k < p.ratios.length && n < most; k++) {
      const f = pitch * p.ratios[k]
      if (!(f >= 16 && f < 0.45 * sr) || !(p.gains[k] > 0)) continue
      // A mode dies the sooner the higher it is, by the stuff's own law (damp 0.5 is a loss that is the same every cycle);
      // and a bigger piece of it, being lower, rings longer, by the root of how much lower.
      const t60 = Math.min(20, Math.max(0.004, p.ring * Math.sqrt(p.pitch / pitch) * (pitch / f) ** (2 * p.damp) * (piece ? 0.6 : 1)))
      const r = Math.min(0.99999, Math.exp(-6.908 / (t60 * sr))), w = (TAU * f) / sr
      this.mF[at + n] = f; this.mR[at + n] = r
      this.mA1[at + n] = 2 * r * Math.cos(w); this.mA2[at + n] = -r * r
      // Struck, a mode's loudness is its own. Rubbed, noise goes in all the while, and a mode that rings long would grow without this.
      // A light blow leaves the upper modes nearly still; a hard one wakes them all.
      this.mB[at + n] = Math.min(1, p.gains[k]) * Math.sin(w) * (rub ? Math.sqrt(1 - r * r) * 2.5 : 1) * (pitch / f) ** (1 - force)
      this.mY1[at + n] = 0; this.mY2[at + n] = 0
      longest = Math.max(longest, t60)
      n++
    }
    if (!n) return -1
    // The body of a blow on a thing that rings: the two meeting push the air once, low and short, under the ring (the
    // thump of a hammer on steel, of a clapper in a bell). Without it a ringing thing is a tone with no weight. Dull
    // stuff is its own thump. In the world only: a played note has none.
    if (bus === 0 && !rub && !piece && !(p.pieces > 0) && p.ring > 0.2 && n < MM && this.mF[at] > 150) {
      const f = Math.min(150, Math.max(65, this.mF[at] * 0.3)), t60 = 0.09, r = Math.exp(-6.908 / (t60 * sr)), w = (TAU * f) / sr
      this.mF[at + n] = f; this.mR[at + n] = r; this.mA1[at + n] = 2 * r * Math.cos(w); this.mA2[at + n] = -r * r
      this.mB[at + n] = 0.4 * Math.sin(w); this.mY1[at + n] = 0; this.mY2[at + n] = 0
      n++
    }
    this.mId[v] = 0; this.mDamp[v] = 0
    this.mOn[v] = 1; this.mN[v] = n; this.mWait[v] = wait; this.mAge[v] = 0
    // How long they touch falls a little as they meet faster (Hertz: with speed to the power of minus a fifth).
    this.mPulse[v] = rub ? 0 : Math.max(1, Math.round(Math.min(0.02, Math.max(0.00002, p.tau)) * force ** -0.2 * sr))
    this.mAt[v] = 0; this.mAmp[v] = gain; this.mRough[v] = Math.min(1, Math.max(0, p.rough))
    this.mRub[v] = Math.round(rub * sr); this.mRubAmp[v] = gain; this.mRubEnv[v] = 0; this.mRubZ[v] = 0
    this.mRubLp[v] = this.lpCoef(300 + 12000 * p.rough * (0.3 + 0.7 * force))
    this.mLife[v] = Math.round((rub + longest * 1.2 + 0.05) * sr)
    this.mBend[v] = Math.min(2, Math.max(-2, p.bend)); this.mSettle[v] = (0.03 + 0.1 * Math.abs(p.bend)) * sr
    this.mLoud[v] = gain
    this.mGl[v] = gl; this.mGr[v] = gr; this.mLp[v] = this.lpCoef(lp); this.mZ[v] = 0; this.mSend[v] = send; this.mBus[v] = bus
    return v
  }

  private pluck(p: Compiled, wait: number, pitch: number, force: number, gain: number, dur: number, gl: number, gr: number, lp: number, send: number, bus: number) {
    const v = this.free(this.sOn, this.sLoud, SV, this.sBus, bus), sr = this.sr, base = v * this.sLen
    if (v < 0) return -1
    const f = Math.max(27, pitch), S = 0.15 + 0.85 * Math.min(1, Math.max(0, p.damp))
    const whole = sr / f - S * 0.5, N = Math.min(this.sLen - 2, Math.floor(whole - 0.1)), d = whole - N
    if (N < 2) return -1
    const t60 = Math.min(20, Math.max(0.02, p.ring * (p.pitch / f) ** (0.3 + 0.5 * p.damp)))
    // The string as it is let go: noise, duller for a soft pick and a light touch, with what a pluck at that place leaves out.
    const c = Math.min(1, 0.04 + 0.96 * p.hard ** 1.5 * (0.3 + 0.7 * force)), gap = Math.max(1, Math.round(N * Math.min(0.5, Math.max(0.03, p.where))))
    let z1 = 0, z2 = 0, mean = 0, peak = 0
    const b = this.sBuf
    for (let i = 0; i < N; i++) { z1 += c * (this.rand() * 2 - 1 - z1); z2 += c * (z1 - z2); b[base + i] = z2 }
    for (let i = N - 1; i >= gap; i--) b[base + i] -= 0.9 * b[base + i - gap]
    for (let i = 0; i < N; i++) mean += b[base + i]
    mean /= N
    for (let i = 0; i < N; i++) { b[base + i] -= mean; peak = Math.max(peak, Math.abs(b[base + i])) }
    const scale = (0.55 * gain) / (peak || 1)
    for (let i = 0; i < N; i++) b[base + i] *= scale
    this.sOn[v] = 1; this.sWait[v] = wait; this.sAge[v] = 0; this.sN[v] = N; this.sRd[v] = 0
    this.sC[v] = (1 - d) / (1 + d); this.sX1[v] = 0; this.sY1[v] = 0; this.sPrev[v] = 0; this.sS[v] = S
    this.sRho[v] = Math.min(0.99995, 10 ** (-3 / (t60 * f))); this.sRhoOff[v] = Math.min(this.sRho[v], 10 ** (-3 / (0.12 * f)))
    this.sOff[v] = dur > 0 ? Math.round(dur * sr) : 0x7fffffff
    this.sLife[v] = Math.round((dur > 0 ? Math.min(dur + 0.25, t60 * 1.2) : t60 * 1.2) * sr)
    this.sLoud[v] = gain
    this.sGl[v] = gl; this.sGr[v] = gr; this.sLp[v] = this.lpCoef(lp); this.sZ[v] = 0; this.sSend[v] = send; this.sBus[v] = bus; this.sId[v] = 0
    return v
  }

  private hold(p: Compiled, wait: number, pitch: number, force: number, gain: number, dur: number, gl: number, gr: number, lp: number, send: number, bus: number) {
    let v = -1, oldest = -1
    for (let k = 0; k < TV; k++) { if (!this.tOn[k]) { v = k; oldest = -1; break } if ((this.tBus[k] === 2 || this.tId[k]) && bus !== 2) continue; if (this.tAge[k] > oldest) { oldest = this.tAge[k]; v = k } }
    if (v < 0) return -1
    if (oldest >= 0) this.stats.stolen++
    const sr = this.sr
    this.tOn[v] = 1; this.tWait[v] = wait; this.tAge[v] = 0; this.tStage[v] = 0; this.tPh[v] = 0; this.tF[v] = pitch; this.tEnv[v] = 0
    this.tHold[v] = Math.round(Math.min(40000, Math.max(0.03, dur || 0.3)) * sr)
    this.tId[v] = 0; this.tTo[v] = pitch; this.tAmpTo[v] = 0.5 * gain; this.tAmp0[v] = 0.5 * gain
    this.tAtt[v] = 1 / ((0.003 + 0.3 * (1 - p.hard) ** 2) * sr)
    this.tRel[v] = Math.exp(-6.908 / (Math.min(12, Math.max(0.02, p.ring)) * sr))
    this.tAmp[v] = 0.5 * gain; this.tTilt[v] = Math.min(1, Math.max(0, p.tilt)); this.tRough[v] = Math.min(1, Math.max(0, p.rough)); this.tWaver[v] = Math.min(1, Math.max(0, p.waver))
    // How bright: a tone little damped keeps its upper part, more so blown hard.
    this.tBright[v] = 1.5 + 14 * (1 - Math.min(1, Math.max(0, p.damp))) * (0.4 + 0.6 * force)
    this.tG[v] = Math.tan(Math.PI * Math.min(0.45, (pitch * this.tBright[v]) / sr))
    this.tBg[v] = Math.tan(Math.PI * Math.min(0.45, (pitch * 2) / sr))
    this.t1[v] = 0; this.t2[v] = 0; this.tB1[v] = 0; this.tB2[v] = 0; this.tChiff[v] = 1
    this.tGl[v] = gl; this.tGr[v] = gr; this.tGlTo[v] = gl; this.tGrTo[v] = gr; this.tLp[v] = this.lpCoef(lp); this.tZ[v] = 0; this.tSend[v] = send; this.tBus[v] = bus
    return v
  }

  /** A rush of noise through a band that sweeps from one pitch to another: where a note starts in frames from now, for how long, how narrow, how loud. */
  private puff(wait: number, from: number, to: number, time: number, q: number, amp: number, gl: number, gr: number, lp: number, send: number, bus: number) {
    const v = this.free(this.aOn, null, AV, this.aBus, bus), top = 0.42 * this.sr
    if (v < 0) return
    this.aOn[v] = 1; this.aWait[v] = wait; this.aAge[v] = 0; this.aLife[v] = Math.round(Math.min(8, Math.max(0.01, time)) * this.sr)
    this.aFrom[v] = Math.min(top, Math.max(20, from)); this.aTo[v] = Math.min(top, Math.max(20, to)); this.aK[v] = 1 / Math.min(12, Math.max(0.3, q)); this.aAmp[v] = Math.min(1, amp)
    this.a1[v] = 0; this.a2[v] = 0; this.aLp[v] = this.lpCoef(lp); this.aZ[v] = 0
    this.aGl[v] = gl; this.aGr[v] = gr; this.aSend[v] = send; this.aBus[v] = bus
  }

  // ── Voices ──────────────────────────────────────────────────────────────
  /** Puts a voice's block (in tmp from `s`) on its bus through its own low-pass, and some of it to the room. Returns the loudest sample. */
  private mix(s: number, len: number, gl: number, gr: number, c: number, z: number, send: number, bus: number): number {
    const t = this.tmp, l = this.bus[bus * 2], r = this.bus[bus * 2 + 1], room = this.send
    let peak = 0
    if (c === 1) {
      if (send === 0) {
        for (let i = s; i < len; i++) {
          const v = t[i]
          const a = v < 0 ? -v : v
          if (a > peak) peak = a
          l[i] += v * gl; r[i] += v * gr
        }
      } else {
        for (let i = s; i < len; i++) {
          const v = t[i]
          const a = v < 0 ? -v : v
          if (a > peak) peak = a
          l[i] += v * gl; r[i] += v * gr; room[i] += v * send
        }
      }
      this.z = len > s ? t[len - 1] : z
      return peak
    }
    if (send === 0) {
      for (let i = s; i < len; i++) {
        z += c * (t[i] - z)
        const a = z < 0 ? -z : z
        if (a > peak) peak = a
        l[i] += z * gl; r[i] += z * gr
      }
    } else {
      for (let i = s; i < len; i++) {
        z += c * (t[i] - z)
        const a = z < 0 ? -z : z
        if (a > peak) peak = a
        l[i] += z * gl; r[i] += z * gr; room[i] += z * send
      }
    }
    this.z = z
    return peak
  }
  private z = 0

  private modes(v: number, len: number) {
    const s = Math.min(this.mWait[v], len)
    this.mWait[v] -= s
    if (s === len) return
    const x = this.x, t = this.tmp, at = v * MM, n = this.mN[v], sr = this.sr
    let driven = false
    // The touch: a rise and fall of the length the two are in contact, its area the blow, with grit in it.
    const N = this.mPulse[v]
    if (this.mAt[v] < N) {
      driven = true
      x.fill(0, 0, len)
      const amp = this.mAmp[v], rough = this.mRough[v]
      let k = this.mAt[v]
      for (let i = s; i < len && k < N; i++, k++) x[i] = amp * (N === 1 ? 1 : (1 - Math.cos((TAU * (k + 0.5)) / N)) / N) * (1 - rough + rough * 2 * this.rand())
      this.mAt[v] = k
    } else if (this.mRub[v] > 0) {
      // Rubbed: noise for as long as it lasts, coming in and going out over a few milliseconds.
      driven = true
      x.fill(0, 0, len)
      const up = 1 / (0.012 * sr), amp = this.mRubAmp[v], c = this.mRubLp[v]
      let left = this.mRub[v], env = this.mRubEnv[v], z = this.mRubZ[v]
      for (let i = s; i < len; i++) {
        env = left > 0 ? Math.min(1, env + up) : Math.max(0, env - up)
        left--
        z += c * (this.rand() * 2 - 1 - z)
        x[i] = z * env * amp
      }
      this.mRubEnv[v] = env; this.mRubZ[v] = z
      this.mRub[v] = env > 0 || left > 0 ? Math.max(left, 1) : 0
    }
    // Let go: a hand on it. Every mode now dies in a seventh of a second at most.
    if (this.mDamp[v]) {
      this.mDamp[v] = 0
      const stop = Math.exp(-6.908 / (0.15 * sr))
      for (let k = 0; k < n; k++) { const r = Math.min(this.mR[at + k], stop); this.mR[at + k] = r; this.mA1[at + k] = 2 * r * Math.cos((TAU * this.mF[at + k]) / sr); this.mA2[at + k] = -r * r }
      this.mLife[v] = Math.min(this.mLife[v], this.mAge[v] + Math.round(0.3 * sr)); this.mRub[v] = Math.min(this.mRub[v], 1)
    }
    // It starts off its pitch and settles: the modes are tuned again each block until it has.
    const bend = this.mBend[v]
    if (bend !== 0) {
      const off = bend * Math.exp(-this.mAge[v] / this.mSettle[v])
      if (Math.abs(off) < 0.004) this.mBend[v] = 0
      const up = 2 ** off
      for (let k = 0; k < n; k++) this.mA1[at + k] = 2 * this.mR[at + k] * Math.cos(Math.min(3, (TAU * this.mF[at + k] * up) / sr))
    }
    const mA1 = this.mA1, mA2 = this.mA2, mB = this.mB, mY1 = this.mY1, mY2 = this.mY2
    const end2 = len - 1
    for (let k = 0; k < n; k++) {
      const idx = at + k
      const a1 = mA1[idx], a2 = mA2[idx]
      let y1 = mY1[idx], y2 = mY2[idx]
      if (k === 0) {
        if (driven) {
          const b = mB[idx]
          for (let i = s; i < len; i++) { const y = b * x[i] + a1 * y1 + a2 * y2; y2 = y1; y1 = y; t[i] = y }
        } else {
          let i = s
          for (; i < end2; i += 2) {
            const ya = a1 * y1 + a2 * y2; t[i] = ya
            const yb = a1 * ya + a2 * y1; t[i + 1] = yb
            y2 = ya; y1 = yb
          }
          if (i < len) { const y = a1 * y1 + a2 * y2; y2 = y1; y1 = y; t[i] = y }
        }
      } else if (driven) {
        const b = mB[idx]
        for (let i = s; i < len; i++) { const y = b * x[i] + a1 * y1 + a2 * y2; y2 = y1; y1 = y; t[i] += y }
      } else {
        let i = s
        for (; i < end2; i += 2) {
          const ya = a1 * y1 + a2 * y2; t[i] += ya
          const yb = a1 * ya + a2 * y1; t[i + 1] += yb
          y2 = ya; y1 = yb
        }
        if (i < len) { const y = a1 * y1 + a2 * y2; y2 = y1; y1 = y; t[i] += y }
      }
      mY1[idx] = y1; mY2[idx] = y2
    }
    const peak = this.mix(s, len, this.mGl[v], this.mGr[v], this.mLp[v], this.mZ[v], this.mSend[v], this.mBus[v])
    this.mZ[v] = this.z
    this.mLoud[v] = peak
    this.mAge[v] += len - s
    if (this.mAge[v] > this.mLife[v] || (!driven && peak < 2e-5)) this.mOn[v] = 0
  }

  private string(v: number, len: number) {
    const s = Math.min(this.sWait[v], len)
    this.sWait[v] -= s
    if (s === len) return
    const b = this.sBuf, base = v * this.sLen, N = this.sN[v], C = this.sC[v], S = this.sS[v], t = this.tmp
    if (this.sAge[v] >= this.sOff[v]) this.sRho[v] = this.sRhoOff[v]
    const rho = this.sRho[v]
    let rd = this.sRd[v], x1 = this.sX1[v], y1 = this.sY1[v], prev = this.sPrev[v]
    for (let i = s; i < len; i++) {
      const x = b[base + rd]
      // A part of a sample's wait, to be in tune (an all-pass); then the loss of one trip along the string.
      const ap = C * x + x1 - C * y1
      x1 = x; y1 = ap
      b[base + rd] = rho * ((1 - S) * ap + S * 0.5 * (ap + prev))
      prev = ap
      if (++rd === N) rd = 0
      t[i] = ap
    }
    this.sRd[v] = rd; this.sX1[v] = x1; this.sY1[v] = y1; this.sPrev[v] = prev
    const peak = this.mix(s, len, this.sGl[v], this.sGr[v], this.sLp[v], this.sZ[v], this.sSend[v], this.sBus[v])
    this.sZ[v] = this.z
    this.sLoud[v] = peak
    this.sAge[v] += len - s
    if (this.sAge[v] > this.sLife[v] || (this.sAge[v] > 2048 && peak < 2e-5)) this.sOn[v] = 0
  }

  private tone(v: number, len: number) {
    const s = Math.min(this.tWait[v], len)
    this.tWait[v] -= s
    if (s === len) return
    const sr = this.sr, t = this.tmp, tilt = this.tTilt[v], rough = this.tRough[v]
    // Bent by hand: pitch and loudness go a third of the way to where they are wanted each block (about 8 ms to arrive).
    if (this.tTo[v] !== this.tF[v]) { this.tF[v] = Math.abs(this.tTo[v] / this.tF[v] - 1) < 0.0005 ? this.tTo[v] : this.tF[v] * (this.tTo[v] / this.tF[v]) ** 0.35; this.tG[v] = Math.tan(Math.PI * Math.min(0.45, (this.tF[v] * this.tBright[v]) / sr)); this.tBg[v] = Math.tan(Math.PI * Math.min(0.45, (this.tF[v] * 2) / sr)) }
    this.tAmp[v] += (this.tAmpTo[v] - this.tAmp[v]) * 0.35
    // Moved while it sounds (`place`): each side goes a fifth of the way to where it is wanted each block, so nothing steps.
    this.tGl[v] += (this.tGlTo[v] - this.tGl[v]) * 0.2; this.tGr[v] += (this.tGrTo[v] - this.tGr[v]) * 0.2
    const amp = this.tAmp[v], g = this.tG[v], bg = this.tBg[v]
    const age = this.tAge[v] / sr, waver = this.tWaver[v]
    // It trembles once it has been held a little.
    const dt = (this.tF[v] * (1 + waver * 0.012 * Math.sin(TAU * 5.2 * age) * Math.min(1, age * 4))) / sr
    // Breath is not steady: the loudness trembles with the pitch, a little, once the tone has been held.
    const swell = 1 + waver * 0.22 * Math.sin(TAU * 5.2 * age + 1.3) * Math.min(1, age * 4)
    const a = 1 / (1 + g * (g + 1.4)), ba = 1 / (1 + bg * (bg + 0.5)), att = this.tAtt[v], rel = this.tRel[v], fade = this.toneFade
    let ph = this.tPh[v], env = this.tEnv[v], stage = this.tStage[v], hold = this.tHold[v], z1 = this.t1[v], z2 = this.t2[v], b1 = this.tB1[v], b2 = this.tB2[v], chiff = this.tChiff[v]
    for (let i = s; i < len; i++) {
      if (stage === 0) { env += att; if (env >= 1) { env = 1; stage = 1 } }
      if (stage < 2 && --hold <= 0) stage = 2
      if (stage === 2) env *= rel
      ph += dt
      if (ph >= 1) ph -= 1
      // A saw with its step rounded off, so it does not ring false above half the rate.
      let saw = 2 * ph - 1
      if (ph < dt) { const u = ph / dt; saw -= u + u - u * u - 1 } else if (ph > 1 - dt) { const u = (ph - 1) / dt; saw -= u * u + u + u + 1 }
      const osc = (1 - tilt) * Math.sin(TAU * ph) + tilt * 0.7 * saw
      const v3 = osc - z2, v1 = a * (z1 + g * v3), v2 = z2 + g * v1
      z1 = 2 * v1 - z1; z2 = 2 * v2 - z2
      // Breath: noise through a band round twice the pitch, most of it as the tone begins.
      const nz = this.rand() * 2 - 1, w3 = nz - b2, w1 = ba * (b1 + bg * w3), w2 = b2 + bg * w1
      b1 = 2 * w1 - b1; b2 = 2 * w2 - b2
      chiff *= fade
      t[i] = (v2 + w1 * rough * (0.35 + 2.5 * chiff)) * env * amp * swell * (1 + 0.8 * chiff)
    }
    this.tPh[v] = ph; this.tEnv[v] = env; this.tStage[v] = stage; this.tHold[v] = hold; this.t1[v] = z1; this.t2[v] = z2; this.tB1[v] = b1; this.tB2[v] = b2; this.tChiff[v] = chiff
    this.mix(s, len, this.tGl[v], this.tGr[v], this.tLp[v], this.tZ[v], this.tSend[v], this.tBus[v])
    this.tZ[v] = this.z
    this.tAge[v] += len - s
    if (stage === 2 && env < 1e-4) this.tOn[v] = 0
  }

  private air(v: number, len: number) {
    const s = Math.min(this.aWait[v], len)
    this.aWait[v] -= s
    if (s === len) return
    const sr = this.sr, life = this.aLife[v], age = this.aAge[v], k = this.aK[v], amp = this.aAmp[v], t = this.tmp
    // Where the band is now, between its two ends, and how loud: up in two milliseconds and dying away to nothing at the end.
    const at = Math.min(1, age / life), f = this.aFrom[v] * (this.aTo[v] / this.aFrom[v]) ** at
    const g = Math.tan((Math.PI * f) / sr), a = 1 / (1 + g * (g + k)), up = 1 / (0.002 * sr), fall = Math.exp(-4.6 / life)
    let z1 = this.a1[v], z2 = this.a2[v], env = Math.exp((-4.6 * age) / life) * Math.min(1, age * up)
    for (let i = s; i < len; i++) {
      const v3 = this.rand() * 2 - 1 - z2, v1 = a * (z1 + g * v3), v2 = z2 + g * v1
      z1 = 2 * v1 - z1; z2 = 2 * v2 - z2
      env = age + i - s < 0.002 * sr ? Math.min(1, (age + i - s) * up) : env * fall
      // A wide band keeps its low part too; a narrow one is the band alone.
      t[i] = (v1 * k * 1.4 + (k > 1 ? v2 * 0.6 : 0)) * env * amp
    }
    this.a1[v] = z1; this.a2[v] = z2
    this.mix(s, len, this.aGl[v], this.aGr[v], this.aLp[v], this.aZ[v], this.aSend[v], this.aBus[v])
    this.aZ[v] = this.z
    this.aAge[v] += len - s
    if (this.aAge[v] > life * 1.5) this.aOn[v] = 0
  }

  // ── Beds ────────────────────────────────────────────────────────────────
  /** A grain: a short tone that dies in `time` seconds, its pitch going up or down by `chirp` octaves over that. */
  private grain(f: number, time: number, amp: number, chirp: number, pan: number) {
    for (let v = 0; v < GV; v++) {
      if (this.gOn[v]) continue
      const n = time * this.sr
      this.gOn[v] = 1; this.gPh[v] = 0; this.gInc[v] = Math.min(0.4, f / this.sr); this.gMul[v] = 2 ** (chirp / n); this.gAmp[v] = amp; this.gDec[v] = Math.exp(-6.9 / n)
      this.gGl[v] = Math.sqrt(0.5 * (1 - pan)); this.gGr[v] = Math.sqrt(0.5 * (1 + pan))
      return
    }
  }

  private beds(len: number) {
    const l = this.bus[0], r = this.bus[1], sr = this.sr, now = this.now, S = this.bed, dt = len / sr
    const rain = now[SET.rain], wind = now[SET.wind], fire = now[SET.fire], surf = now[SET.surf], under = now[SET.under], rumble = now[SET.rumble]
    // What is over your head keeps the weather out: under a roof, under the sea.
    const open = 1 - Math.min(1, Math.max(0, now[SET.cover]))
    // One-pole low-passes at fixed pitches, precomputed for this rate.
    const c80 = this.c80, c300 = this.c300, c1200 = this.c1200, c3500 = this.c3500, c7000 = this.c7000

    if (rain * open > 0.003) {
      // Rain is a hiss with its top and bottom off, a lower wash of it on the ground, and drops that can be told apart.
      const lv = rain * open, hiss = 0.05 * lv, wash = 0.09 * lv
      let a = S[0], b = S[1], c = S[2], d = S[3]
      for (let i = 0; i < len; i++) {
        const n1 = this.rand() * 2 - 1, n2 = this.rand() * 2 - 1
        a += c7000 * (n1 - a); b += c3500 * (a - b); c += c7000 * (n2 - c); d += c1200 * (c - d)
        const hi = a - b, lo = d
        l[i] += hi * hiss * 0.35 + lo * wash * 1.7; r[i] += (c - b * 0.2 - d) * hiss * 0.35 + lo * wash * 1.4 + hi * hiss * 0.15
      }
      S[0] = a; S[1] = b; S[2] = c; S[3] = d
      for (let k = (40 + 260 * lv) * dt; k > 0; k--) if (this.rand() < k) this.grain(350 + 2000 * this.rand() ** 2, 0.004 + 0.016 * this.rand(), 0.01 + 0.5 * lv * this.rand() ** 6, -0.3, this.rand() * 2 - 1)
    }
    if (wind * open > 0.003) {
      // Wind is noise through a band whose middle wanders, a gust that comes and goes, and a low push under it.
      S[8] -= dt
      if (S[8] <= 0) { S[8] = 0.8 + 2.5 * this.rand(); S[9] = this.rand(); S[10] = this.rand() }
      S[11] += (S[9] - S[11]) * dt * 0.8; S[12] += (S[10] - S[12]) * dt * 0.6
      const lv = wind * open, fc = 180 * 2 ** (2.2 * S[11] + lv), g = Math.tan((Math.PI * fc) / sr), k = 0.7, a = 1 / (1 + g * (g + k)), amp = 0.16 * lv * (0.35 + 0.65 * S[12])
      const g2 = Math.tan((Math.PI * fc * 1.31) / sr), a2 = 1 / (1 + g2 * (g2 + k))
      let z1 = S[13], z2 = S[14], y1 = S[15], y2 = S[16], low = S[17]
      for (let i = 0; i < len; i++) {
        const n1 = this.rand() * 2 - 1, n2 = this.rand() * 2 - 1
        const v3 = n1 - z2, v1 = a * (z1 + g * v3), v2 = z2 + g * v1
        z1 = 2 * v1 - z1; z2 = 2 * v2 - z2
        const w3 = n2 - y2, w1 = a2 * (y1 + g2 * w3), w2 = y2 + g2 * w1
        y1 = 2 * w1 - y1; y2 = 2 * w2 - y2
        low += c80 * (n1 + n2 - low)
        l[i] += (v1 * 0.8 + w1 * 0.3) * amp + low * amp * 1.5; r[i] += (w1 * 0.8 + v1 * 0.3) * amp + low * amp * 1.5
      }
      S[13] = z1; S[14] = z2; S[15] = y1; S[16] = y2; S[17] = low
    }
    if (fire > 0.003) {
      // Fire is a low roar that flickers, a little hiss, and cracks at no even pace, some of them loud.
      const pan = now[SET.firePan], gl = Math.sqrt(0.5 * (1 - pan)), gr = Math.sqrt(0.5 * (1 + pan)), cut = this.lpCoef(now[SET.fireLp])
      S[20] -= dt
      if (S[20] <= 0) { S[20] = 0.05 + 0.2 * this.rand(); S[21] = 0.4 + 0.6 * this.rand() }
      S[22] += (S[21] - S[22]) * Math.min(1, dt * 14)
      const roar = 0.5 * fire * S[22], hiss = 0.02 * fire
      let a = S[23], b = S[24], c = S[25], z = S[26]
      for (let i = 0; i < len; i++) {
        const n1 = this.rand() * 2 - 1
        a += c300 * (n1 - a); b += c300 * (a - b); c += c3500 * (n1 - c)
        const y = b * roar * 4 + (n1 - c) * hiss
        z += cut * (y - z)
        l[i] += z * gl; r[i] += z * gr
      }
      S[23] = a; S[24] = b; S[25] = c; S[26] = z
      const far = Math.min(1, now[SET.fireLp] / 6000)
      for (let k = (3 + 22 * fire) * dt; k > 0; k--) if (this.rand() < k) this.grain((700 + 4000 * this.rand()) * (0.4 + 0.6 * far), 0.001 + 0.006 * this.rand(), fire * far * (0.03 + 0.6 * this.rand() ** 4), -0.5, Math.max(-1, Math.min(1, pan + (this.rand() - 0.5) * 0.5)))
    }
    if (surf * open > 0.003) {
      // Surf is one wave after another, none the same length: it gathers, breaks bright, and draws back as a long hiss.
      const pan = now[SET.surfPan], gl = Math.sqrt(0.5 * (1 - pan)), gr = Math.sqrt(0.5 * (1 + pan)), lv = surf * open
      if (S[31] <= 0) S[31] = 8
      S[30] += dt / S[31]
      if (S[30] >= 1) { S[30] -= 1; S[31] = 6 + 6 * this.rand(); S[32] = 0.6 + 0.4 * this.rand() }
      const p = S[30], big = S[32] || 0.8
      const swell = p < 0.3 ? (p / 0.3) ** 2 : p < 0.38 ? 1 : Math.exp(-(p - 0.38) * 4.2)
      const fc = p < 0.3 ? 250 + 1400 * (p / 0.3) : p < 0.38 ? 3800 : 500 + 3300 * Math.exp(-(p - 0.38) * 5)
      const fizz = p < 0.38 ? 0 : Math.exp(-(p - 0.38) * 2.5) * (1 - Math.exp(-(p - 0.38) * 30))
      const cc = 1 - Math.exp((-TAU * fc) / sr), amp = 0.3 * lv * (0.12 + 0.88 * swell * big), fz = 0.05 * lv * fizz * big
      let a = S[33], b = S[34], c = S[35], d = S[36], e = S[37], low = S[38]
      for (let i = 0; i < len; i++) {
        const n1 = this.rand() * 2 - 1, n2 = this.rand() * 2 - 1
        a += cc * (n1 - a); b += cc * (a - b); c += cc * (n2 - c); d += cc * (c - d)
        e += c3500 * (n1 - e); low += c80 * (n2 - low)
        l[i] += (b * amp * 2 + (n1 - e) * fz + low * lv * 0.5) * gl * 1.4 + d * amp * 0.5; r[i] += (d * amp * 2 + (n2 - e) * fz + low * lv * 0.5) * gr * 1.4 + b * amp * 0.5
      }
      S[33] = a; S[34] = b; S[35] = c; S[36] = d; S[37] = e; S[38] = low
    }
    if (under > 0.003) {
      // Under the sea: a low press of water on the ears and a bubble now and then, rising.
      let a = S[40], b = S[41]
      for (let i = 0; i < len; i++) { const n1 = this.rand() * 2 - 1; a += c80 * (n1 - a); b += c80 * (a - b); l[i] += b * under * 2.2; r[i] += b * under * 2.2 }
      S[40] = a; S[41] = b
      if (this.rand() < 2.4 * under * dt) this.grain(300 + 900 * this.rand(), 0.03 + 0.06 * this.rand(), 0.06 + 0.6 * this.rand() ** 3, 0.6, this.rand() * 2 - 1)
    }
    if (rumble > 0.003) {
      // Rubble shifting: a low grinding with stones knocking in it.
      const pan = now[SET.rumblePan], gl = Math.sqrt(0.5 * (1 - pan)), gr = Math.sqrt(0.5 * (1 + pan))
      let a = S[44], b = S[45], c = S[46]
      for (let i = 0; i < len; i++) { const n1 = this.rand() * 2 - 1; a += c80 * (n1 - a); b += c300 * (n1 - b); c += c80 * (b - c); const y = (a * 3 + c * 1.5) * rumble; l[i] += y * gl; r[i] += y * gr }
      S[44] = a; S[45] = b; S[46] = c
      for (let k = 30 * rumble * dt; k > 0; k--) if (this.rand() < k) this.grain(180 + 1400 * this.rand() ** 2, 0.004 + 0.02 * this.rand(), rumble * (0.05 + 0.2 * this.rand() ** 2), -0.2, Math.max(-1, Math.min(1, pan + (this.rand() - 0.5) * 0.6)))
    }
    // Driven vehicle: multi-harmonic engine growl with load-driven intake filter and turbo whine, dual-formant tire
    // screech when sliding, and surface-aware road roll. Silent and zero cost whenever nobody drives.
    const rpm = now[SET.engineRpm], load = now[SET.engineLoad], tone = now[SET.engineTone], boost = now[SET.turboBoost]
    if (rpm > 0.004) {
      const fade = Math.min(1, rpm / 0.06)
      const f0 = (24 + 14 * tone) + (96 + 78 * tone) * (rpm * rpm * 0.55 + rpm * 0.45)
      const inc = Math.min(0.3, f0 / sr), subInc = inc * 0.5
      const turboOn = Math.max(0, tone - 0.4) * Math.max(0, rpm - 0.3) * load + boost * 0.85
      const turboInc = Math.min(0.4, (1400 + 2800 * rpm + 1800 * boost) / sr)
      const fc = Math.min(0.4 * sr, f0 * (2.5 + 6.5 * load + 2.4 * rpm + 2.2 * boost))
      const g = Math.tan((Math.PI * fc) / sr), k = 1.05 - 0.38 * load, a = 1 / (1 + g * (g + k))
      const drive = 1.15 + 1.75 * load + 0.45 * boost, amp = fade * (0.14 + 0.14 * load + 0.07 * rpm + 0.04 * boost)
      const lope = 0.24 - 0.13 * tone
      const h3 = 0.26 + 0.2 * load, h4 = 0.14 + 0.22 * load, h6 = 0.05 + 0.15 * load
      let ph = S[50], sub = S[51], tph = S[52], z1 = S[53], z2 = S[54], air = S[55]
      for (let i = 0; i < len; i++) {
        ph += inc; if (ph >= 1) ph -= 1
        sub += subInc; if (sub >= 1) sub -= 1
        tph += turboInc; if (tph >= 1) tph -= 1
        const p = TAU * ph
        const mod = 1 + lope * Math.sin(TAU * sub)
        const raw = (0.58 * Math.sin(p) + 0.42 * Math.sin(2 * p) + h3 * Math.sin(3 * p) + h4 * Math.sin(4 * p) + h6 * Math.sin(6 * p)) * mod
        const nz = this.rand() * 2 - 1
        air += c1200 * (nz - air)
        const sat = Math.tanh((raw + air * (0.12 + 0.22 * load + 0.24 * boost)) * drive)
        const v3 = sat - z2, v1 = a * (z1 + g * v3), v2 = z2 + g * v1
        z1 = 2 * v1 - z1; z2 = 2 * v2 - z2
        const spool = Math.sin(TAU * tph) * turboOn * 0.046 * fade + (boost > 0.01 ? (Math.sin(TAU * tph * 1.5) * 0.45 + air * 0.9) * boost * 0.055 * fade : 0)
        const y = (v2 * 0.85 + v1 * 0.22 * load) * amp + spool
        l[i] += y * 0.96; r[i] += y * 1.04
      }
      S[50] = ph; S[51] = sub; S[52] = tph; S[53] = z1; S[54] = z2; S[55] = air
    }
    const slip = now[SET.tireSlip], rough = now[SET.roadRough]
    if (slip > 0.008) {
      // Asphalt tire howl: two closely-spaced narrow resonances that warble with road grip, fading into gravel wash off-road.
      S[60] += dt * (7.5 + 5 * slip)
      const wob = Math.sin(S[60]) * 55 + Math.sin(S[60] * 2.13) * 28
      const asphalt = 1 - Math.min(1, rough * 1.2)
      const f1 = Math.min(0.4 * sr, 820 + 380 * slip + wob), f2 = Math.min(0.4 * sr, 1340 + 480 * slip - wob * 0.8)
      const g1 = Math.tan((Math.PI * f1) / sr), k1 = 0.09 + 0.06 * (1 - slip), a1 = 1 / (1 + g1 * (g1 + k1))
      const g2 = Math.tan((Math.PI * f2) / sr), k2 = 0.11 + 0.06 * (1 - slip), a2 = 1 / (1 + g2 * (g2 + k2))
      const sqAmp = slip * slip * 0.22 * asphalt, scrubAmp = slip * (0.09 + 0.14 * rough)
      let x1 = S[61], x2 = S[62], y1 = S[63], y2 = S[64], scL = S[65], scR = S[66]
      for (let i = 0; i < len; i++) {
        const n1 = this.rand() * 2 - 1, n2 = this.rand() * 2 - 1
        const v3 = n1 - x2, v1 = a1 * (x1 + g1 * v3), v2 = x2 + g1 * v1; x1 = 2 * v1 - x1; x2 = 2 * v2 - x2
        const w3 = n2 - y2, w1 = a2 * (y1 + g2 * w3), w2 = y2 + g2 * w1; y1 = 2 * w1 - y1; y2 = 2 * w2 - y2
        scL += c1200 * (n1 - scL); scR += c1200 * (n2 - scR)
        const sL = Math.tanh((v1 * 1.1 + w1 * 0.55) * 0.45) * sqAmp + scL * scrubAmp
        const sR = Math.tanh((w1 * 1.1 + v1 * 0.55) * 0.45) * sqAmp + scR * scrubAmp
        l[i] += sL; r[i] += sR
      }
      S[61] = x1; S[62] = x2; S[63] = y1; S[64] = y2; S[65] = scL; S[66] = scR
      if (rough > 0.25) for (let k = 45 * slip * rough * dt; k > 0; k--) if (this.rand() < k) this.grain(400 + 2400 * this.rand() ** 2, 0.003 + 0.012 * this.rand(), 0.08 * slip * rough, -0.35, this.rand() * 2 - 1)
    }
    const roll = now[SET.roadRoll]
    if (roll > 0.008) {
      const amp = roll * (0.09 + 0.05 * rough)
      let r1 = S[70], r2 = S[71], r3 = S[72]
      for (let i = 0; i < len; i++) {
        const n1 = this.rand() * 2 - 1, n2 = this.rand() * 2 - 1
        r1 += c80 * (n1 - r1); r2 += c300 * (n2 - r2); r3 += c1200 * (n1 - r3)
        const lo = r1 * 1.6 + r2 * 0.55, hi = (r3 - r2) * 0.22
        l[i] += (lo + hi) * amp; r[i] += (lo - hi * 0.6) * amp
      }
      S[70] = r1; S[71] = r2; S[72] = r3
      if (rough > 0.3) for (let k = 28 * roll * rough * dt; k > 0; k--) if (this.rand() < k) this.grain(260 + 1800 * this.rand() ** 2, 0.003 + 0.01 * this.rand(), 0.05 * roll * rough, -0.25, this.rand() * 2 - 1)
    }
    for (let v = 0; v < GV; v++) {
      if (!this.gOn[v]) continue
      let ph = this.gPh[v], inc = this.gInc[v], amp = this.gAmp[v]
      const mul = this.gMul[v], dec = this.gDec[v], gl = this.gGl[v], gr = this.gGr[v]
      for (let i = 0; i < len; i++) { ph += inc; if (ph >= 1) ph -= 1; inc *= mul; amp *= dec; const y = Math.sin(TAU * ph) * amp; l[i] += y * gl; r[i] += y * gr }
      this.gPh[v] = ph; this.gInc[v] = Math.min(0.45, inc); this.gAmp[v] = amp
      if (amp < 1e-4) this.gOn[v] = 0
    }
  }

  // ── The room, the buses, the ceiling ────────────────────────────────────
  private out(L: Float32Array, R: Float32Array, at: number, len: number) {
    const now = this.now, sr = this.sr, [wl, wr, ml, mr, pl, pr] = this.bus, send = this.send
    // The room: what was sent waits 12 ms, then goes round four lines that feed each other, losing their top as they go.
    const time = Math.min(8, Math.max(0.1, now[SET.roomTime])), back = now[SET.roomGain], pre = this.rPre, rb = this.rBuf, rl = this.rLen, rz = this.rZ, ra = this.rAt
    if (time !== this.lastRoomTime) {
      this.lastRoomTime = time
      this.rG0 = 10 ** ((-3 * rl[0]) / (time * sr))
      this.rG1 = 10 ** ((-3 * rl[1]) / (time * sr))
      this.rG2 = 10 ** ((-3 * rl[2]) / (time * sr))
      this.rG3 = 10 ** ((-3 * rl[3]) / (time * sr))
    }
    const g0 = this.rG0, g1 = this.rG1, g2 = this.rG2, g3 = this.rG3
    let pa = this.rPreAt
    const rb0 = rb[0], rb1 = rb[1], rb2 = rb[2], rb3 = rb[3]
    const rl0 = rl[0], rl1 = rl[1], rl2 = rl[2], rl3 = rl[3], preLen = pre.length
    let ra0 = ra[0], ra1 = ra[1], ra2 = ra[2], ra3 = ra[3]
    let rz0 = rz[0], rz1 = rz[1], rz2 = rz[2], rz3 = rz[3]
    for (let i = 0; i < len; i++) {
      const x = pre[pa]
      pre[pa] = send[i]
      if (++pa === preLen) pa = 0
      const a = rb0[ra0], b = rb1[ra1], c = rb2[ra2], d = rb3[ra3], half = 0.5 * (a + b + c + d)
      rz0 += 0.45 * ((a - half) * g0 - rz0); rz1 += 0.45 * ((b - half) * g1 - rz1); rz2 += 0.45 * ((c - half) * g2 - rz2); rz3 += 0.45 * ((d - half) * g3 - rz3)
      rb0[ra0] = x + rz0; rb1[ra1] = x + rz1; rb2[ra2] = x + rz2; rb3[ra3] = x + rz3
      if (++ra0 === rl0) ra0 = 0
      if (++ra1 === rl1) ra1 = 0
      if (++ra2 === rl2) ra2 = 0
      if (++ra3 === rl3) ra3 = 0
      wl[i] += (a - c) * back; wr[i] += (b - d) * back
    }
    ra[0] = ra0; ra[1] = ra1; ra[2] = ra2; ra[3] = ra3
    rz[0] = rz0; rz[1] = rz1; rz[2] = rz2; rz[3] = rz3
    this.rPreAt = pa
    // The music gives way to the world when the world is loud, and comes back slowly.
    const world = now[SET.world], music = now[SET.music], play = now[SET.play], master = now[SET.master]
    const muffleHz = now[SET.muffle]
    if (muffleHz !== this.lastMuffle) { this.lastMuffle = muffleHz; this.lastMuffleCut = this.lpCoef(muffleHz) }
    const cut = this.lastMuffleCut, m = this.mfl, la = this.lBuf, look = this.look, release = this.limRelease, attack = this.limAttack, ease = this.duckEase
    let duck = this.duck, env = this.lEnv, gain = this.lGain, lat = this.lAt, bad = false, peak = this.stats.peak, held = this.stats.held
    // A blow is a push one way, and what is left of it under 20 Hz is not heard: it only moves the cone and eats the room under the ceiling.
    const dc = this.dc, hold = this.dcHold
    // The music is held together as a mix is on its way out of a studio: what stands over -26 dB is brought back by
    // a little over half of how far it stands over, at once, and let go over 80 ms; and the whole is made up for it. (Slower
    // to take hold, it let each blow through and pulled down what rang after it: the blows stood out more, not less.)
    const glueDown = this.glueDown
    let glue = this.glue
    for (let i = 0; i < len; i++) {
      const w = Math.abs(wl[i]) + Math.abs(wr[i])
      duck = w > duck ? w : duck * ease
      const mb = Math.max(Math.abs(ml[i]), Math.abs(mr[i]))
      glue = mb > glue ? mb : glue * glueDown
      const under = (music / (1 + 2.5 * Math.min(1, duck))) * (glue > 0.05 ? (0.05 / glue) ** 0.55 : 1) * 2.4
      let l = (wl[i] * world + ml[i] * under + pl[i] * play) * master, r = (wr[i] * world + mr[i] * under + pr[i] * play) * master
      // Under water, or with a wall between, everything loses its top (two poles).
      m[0] += cut * (l - m[0]); m[1] += cut * (m[0] - m[1]); m[2] += cut * (r - m[2]); m[3] += cut * (m[2] - m[3])
      l = m[1] - dc[0] + hold * dc[1]; dc[0] = m[1]; dc[1] = l
      r = m[3] - dc[2] + hold * dc[3]; dc[2] = m[3]; dc[3] = r
      if (!(l - l === 0) || !(r - r === 0)) { bad = true; break }
      // The ceiling: what comes is seen 3 ms before it leaves, and the gain is down by then.
      const big = Math.max(Math.abs(l), Math.abs(r))
      env = big > env ? big : env * release
      const want = env > KNEE ? KNEE / env : 1
      gain += (want - gain) * (want < gain ? attack : 0.0005)
      let ol = la[0][lat] * gain, or = la[1][lat] * gain
      la[0][lat] = l; la[1][lat] = r
      if (++lat === look) lat = 0
      if (gain < held) held = gain
      ol = ol > CEILING ? CEILING : ol < -CEILING ? -CEILING : ol; or = or > CEILING ? CEILING : or < -CEILING ? -CEILING : or
      const o = Math.max(Math.abs(ol), Math.abs(or))
      if (o > peak) peak = o
      L[at + i] = ol; R[at + i] = or
    }
    this.glue = glue; this.duck = duck; this.lEnv = env; this.lGain = gain; this.lAt = lat; this.stats.peak = peak; this.stats.held = held
    if (bad) { this.silence(); L.fill(0, at, at + len); R.fill(0, at, at + len) }
  }

  /** Everything stops and is forgotten: after a number that is not a number, which nothing should ever make. */
  silence() {
    this.stats.reset++
    for (const on of [this.mOn, this.sOn, this.tOn, this.aOn, this.gOn]) on.fill(0)
    for (const b of [...this.rBuf, ...this.lBuf, this.rPre, this.rZ, this.mfl, this.sBuf]) b.fill(0)
    this.bed.fill(0); this.dc.fill(0); this.glue = 0; this.duck = 0; this.lEnv = 0; this.lGain = 1
  }
}

// ── In the page: the audio thread's end of it ─────────────────────────────
// Messages in: {define: [id, compiled]}, {notes: Float64Array}, {set: [which, value, ...]}, {hush: bus}, {release: id}, {glide: [id, hz, level]}, {place: [id, left, right, dull, room, level]}. Once a second
// it says what it has done and what a block cost it.
declare const AudioWorkletProcessor: { new (): { port: MessagePort } } | undefined
declare const registerProcessor: (name: string, ctor: unknown) => void
declare const sampleRate: number
declare const currentFrame: number
if (typeof AudioWorkletProcessor !== 'undefined') {
  const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now()
  class Voice extends AudioWorkletProcessor {
    synth = new Synth(sampleRate)
    told = 0; spent = 0; worst = 0; blocks = 0
    constructor() {
      super()
      this.port.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.define) this.synth.define(m.define[0], m.define[1])
        if (m.notes) this.synth.notes(m.notes)
        if (m.set) for (let i = 0; i + 1 < m.set.length; i += 2) this.synth.set(m.set[i], m.set[i + 1])
        if (m.hush !== undefined) this.synth.hush(m.hush)
        if (m.release !== undefined) this.synth.release(m.release)
        if (m.glide) this.synth.glide(m.glide[0], m.glide[1], m.glide[2])
        if (m.place) this.synth.place(m.place[0], m.place[1], m.place[2], m.place[3], m.place[4], m.place[5])
      }
    }
    process(_: Float32Array[][], outputs: Float32Array[][]) {
      const out = outputs[0], t0 = clock()
      this.synth.frame = currentFrame
      this.synth.render(out[0], out[1] ?? out[0], out[0].length)
      const ms = clock() - t0
      this.spent += ms; this.blocks++
      if (ms > this.worst) this.worst = ms
      if (currentFrame - this.told >= sampleRate) {
        this.port.postMessage({ ...this.synth.stats, named: this.synth.named(), frame: currentFrame, ms: this.spent / this.blocks, worst: this.worst, blocks: this.blocks })
        this.told = currentFrame; this.spent = 0; this.worst = 0; this.blocks = 0
        this.synth.stats.peak = 0; this.synth.stats.held = 1
      }
      return true
    }
  }
  registerProcessor('village-voice', Voice)
}
