// Fire, smoke and dust (#151): soft lumps that face the eye, drawn over the picture and tested
// against its depth. A puff is hot or it is not: hot, it glows and adds its light; as it cools
// it turns to smoke, which covers what is behind it, swells, rises and thins. They are only
// for the eye. What burns, and what that does to the world, is the core's (fire.rs).
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const MOST = 3072
/** A puff that lives longer than this many seconds is one of the first KEPT. */
const LASTS = 8, KEPT = 384
/** Numbers a puff as the GPU is told it: where (finest cells from the anchor) and how big; its colour and how much it covers; how hot, its own number, how far through its life. */
const EACH = 12

const CODE = /* wgsl */ `
struct U { eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, pad0: f32, forward: vec3f, pad1: f32, sun: vec3f, day: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) colour: vec4f,
  @location(2) @interpolate(flat) more: vec4f,
}
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) at: vec4f, @location(1) colour: vec4f, @location(2) more: vec4f) -> Out {
  let corner = vec2f(f32(v & 1u), f32((v >> 1u) & 1u)) * 2.0 - 1.0;
  let world = at.xyz - u.eye + (u.right * corner.x + u.up * corner.y) * at.w;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = corner;
  out.colour = colour;
  out.more = more;
  return out;
}
fn lump(c: vec2i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
// Lumps with soft sides: the hash at the corners of a square, eased between them.
fn cloud(p: vec2f, seed: u32) -> f32 {
  let c = vec2i(floor(p));
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(mix(lump(c, seed), lump(c + vec2i(1, 0), seed), e.x), mix(lump(c + vec2i(0, 1), seed), lump(c + vec2i(1, 1), seed), e.x), e.y);
}
fn billowAt(uv: vec2f, drift: vec2f, seed: u32) -> f32 {
  return cloud(uv * 2.2 + drift, seed) * 0.62 + cloud(uv * 4.8 + drift * 1.7, seed + 7u) * 0.38;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let heat = in.more.x;
  let age = in.more.z;
  let seed = u32(in.more.y);
  // A puff is a sculpted curling billow lit with warm sunlight on its sunward folds and cool sky
  // fill in its shadowed undersides, so smoke reads with 3D volume instead of a flat grey smudge.
  let r = length(in.uv);
  if (r >= 1.0) { discard; }
  let drift = vec2f(f32(seed & 15u), age * 2.4 + f32((seed >> 4u) & 15u));
  let billow = billowAt(in.uv, drift, seed);
  let body = smoothstep(0.96, 0.42, r + (billow - 0.5) * 0.82) * (1.0 - r * r * r);
  if (body <= 0.004) { discard; }
  // The smoke a blast leaves comes late (more.w): it shows as the ball of fire goes out, not in front of it.
  let fade = smoothstep(in.more.w, in.more.w + 0.06, age) * (1.0 - smoothstep(0.55, 1.0, age));
  // While it burns it is fire and not smoke: its smoke shows as it cools. Covered by its own smoke from the first, a
  // ball of fire was a dark smudge with a little orange a third of a second after it went off.
  let cover = in.colour.a * body * fade * (1.0 - 0.92 * smoothstep(0.05, 0.6, heat));
  // Directional billow self-shadowing: sample slightly toward the sun in screen space so each lobe
  // has a bright sunlit crest and a cool shadowed underside matching the world's daylight.
  let round = vec3f(in.uv.x, -in.uv.y, sqrt(max(1.0 - r * r, 0.0)));
  let towards = vec3f(dot(u.sun, u.right), dot(u.sun, u.up), -dot(u.sun, u.forward));
  let sunStep = normalize(vec2f(towards.x, -towards.y) + vec2f(0.001, 0.001)) * 0.14;
  let billowSun = billowAt(in.uv + sunStep, drift, seed);
  let foldRelief = clamp((billow - billowSun) * 2.2, -0.45, 0.65);
  let sunFace = clamp(dot(round, towards) * 0.65 + 0.35 + foldRelief * 0.55, 0.0, 1.25);
  let topLight = 0.5 + 0.5 * round.y;
  let rim = pow(1.0 - max(round.z, 0.0), 2.2) * (0.25 + 0.55 * max(dot(towards, vec3f(0.0, 0.0, 1.0)), 0.0));
  // Pale steam scatters light internally (never dark grey in its core); dark oil smoke keeps deep shadowed undersides.
  let lum = dot(in.colour.rgb, vec3f(0.333));
  let scatter = smoothstep(0.45, 0.82, lum);
  let shadowTint = mix(mix(vec3f(0.16, 0.20, 0.28), vec3f(0.30, 0.37, 0.48), topLight), vec3f(0.52, 0.56, 0.62), scatter * 0.65);
  let sunTint = vec3f(0.76, 0.72, 0.64) * (sunFace * 0.82 + rim * 0.26);
  let lightCol = (shadowTint + sunTint) * mix(0.08, 1.0, u.day);
  // Keep non-emissive smoke strictly below glow.ts's 0.80 bloom threshold so bright steam never blooms into a glowing orb.
  let rawSmoke = in.colour.rgb * lightCol;
  let smoke = rawSmoke / (vec3f(1.0) + rawSmoke * 0.62);
  // Fire: white-yellow at its heart and when hottest, then yellow, orange for most of its life, and a dull red only
  // as it goes out. Blue-white plasma flame for nitrous boost when colour encodes cool blue with zero smoke cover.
  let core = body * body;
  let hot = clamp(heat * (0.5 + core * 0.95), 0.0, 1.0);
  let warm = mix(mix(vec3f(0.7, 0.06, 0.01), vec3f(1.0, 0.4, 0.05), smoothstep(0.06, 0.36, hot)), vec3f(1.0, 0.9, 0.55), smoothstep(0.42, 0.95, hot));
  let coolFlame = mix(mix(vec3f(0.06, 0.36, 1.0), vec3f(0.32, 0.8, 1.0), smoothstep(0.06, 0.36, hot)), vec3f(0.9, 0.98, 1.0), smoothstep(0.42, 0.95, hot));
  let isBlue = step(0.5, in.colour.b - in.colour.r) * step(in.colour.a, 0.05);
  let flame = mix(warm, coolFlame, isBlue);
  let glow = flame * smoothstep(0.0, 0.22, heat) * (0.3 + billow * 1.15) * body * fade * 0.9;
  return vec4f(smoke * cover + glow, cover);
}
`

export interface Puffs {
  /** A blast `radius` cells across at `at` (the world's finest cells): a flash, a ball of fire, the smoke it leaves. */
  blast(at: readonly [number, number, number], radius: number): void
  /** Dust thrown up where something came down: `count` puffs of a colour (as the screen shows it) round `at`, spreading `radius` cells. */
  dust(at: readonly [number, number, number], radius: number, count: number, colour: readonly [number, number, number]): void
  /** One frame of a ball of fire in flight (a spell, #246): a white-hot heart, and flames and a little smoke left behind it. */
  ball(at: readonly [number, number, number], radius: number, dt: number): void
  /** A flash of a spell's own cool light, with no fire and no smoke. */
  glint(at: readonly [number, number, number], radius: number): void
  /** A burning cell, for one frame of `dt` seconds: flames, and now and then smoke. */
  flame(at: readonly [number, number, number], dt: number): void
  /** A place where falling water lands, for one frame of `dt` seconds: now and then mist. */
  spray(at: readonly [number, number, number], dt: number): void
  /** Tire smoke, dirt dust or wet road spray kicked up behind a sliding wheel (intensity 0 to 1). */
  tireSmoke(at: readonly [number, number, number], vel: readonly [number, number, number], intensity: number, colour?: readonly [number, number, number]): void
  /** Exhaust puff, backfire flame flash on upshift / overrun, or blue-white nitrous boost flame burst. */
  exhaust(at: readonly [number, number, number], dir: readonly [number, number, number], pop?: boolean, boost?: boolean): void
  /** A crash (#37): a little road dust and grit knocked up where two things met, `strength` 0 to 1; gone in two seconds. */
  crash(at: readonly [number, number, number], strength: number): void
  /** A struck engine under a vehicle's bonnet (#37), for one frame of `dt` seconds: white steam from `level` 0.35, thick dark smoke from 0.7, and flames in it from 0.92. */
  engine(at: readonly [number, number, number], level: number, dt: number): void
  step(dt: number): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View): void
  /** Where the light comes from and how much of the day it is: smoke is lit by it. */
  light(sun: readonly number[], day: number): void
  readonly live: number
}

export async function puffs(device: GPUDevice, format: GPUTextureFormat): Promise<Puffs> {
  const module = await shader(device, 'puffs', CODE)
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
  const pipeline = await device.createRenderPipelineAsync({
    label: 'puffs', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: EACH * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const instances = device.createBuffer({ size: MOST * EACH * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  // Where each is in the world (as doubles: the world is big), how it moves, and how it changes as it ages.
  const p = new Float64Array(MOST * 3), v = new Float32Array(MOST * 3)
  const size = new Float32Array(MOST), grow = new Float32Array(MOST), life = new Float32Array(MOST), span = new Float32Array(MOST)
  const heat = new Float32Array(MOST), cool = new Float32Array(MOST), rise = new Float32Array(MOST), drag = new Float32Array(MOST)
  const tone = new Float32Array(MOST * 4), seed = new Float32Array(MOST), late = new Float32Array(MOST)
  const packed = new Float32Array(MOST * EACH), order = new Uint16Array(MOST), far = new Float32Array(MOST)
  let next = 0, lasting = 0, live = 0
  let sun: readonly number[] = [0.52, 0.62, 0.59], sunLength = Math.hypot(sun[0], sun[1], sun[2]), day = 1
  const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
  /** One puff. `out` is how fast it leaves `at`, in a direction of its own. */
  const puff = (at: readonly [number, number, number], spread: number, out: number, up: number, o: { size: number; grow: number; life: number; heat: number; cool: number; rise: number; drag: number; colour: readonly [number, number, number]; cover: number; /** How far through its life it has come before it shows at all. */ late?: number }) => {
    // What lasts has places of its own: a street on fire makes hundreds of flames a second, and they would take the
    // place of the smoke and dust over it within seconds.
    const i = o.life > LASTS ? lasting++ % KEPT : KEPT + (next++ % (MOST - KEPT))
    let dx = 0, dy = 0, dz = 0
    do { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; dz = Math.random() * 2 - 1 } while (dx * dx + dy * dy + dz * dz > 1)
    p[i * 3] = at[0] + dx * spread; p[i * 3 + 1] = at[1] + dy * spread; p[i * 3 + 2] = at[2] + dz * spread
    v[i * 3] = dx * out; v[i * 3 + 1] = dy * out + up; v[i * 3 + 2] = dz * out
    size[i] = o.size; grow[i] = o.grow; life[i] = span[i] = o.life; heat[i] = o.heat; cool[i] = o.cool; rise[i] = o.rise; drag[i] = o.drag
    tone.set([o.colour[0], o.colour[1], o.colour[2], o.cover], i * 4)
    seed[i] = Math.floor(Math.random() * 65536)
    late[i] = o.late ?? 0
  }
  return {
    get live() { return live },
    light(from, isDay) { sun = from; sunLength = Math.hypot(sun[0], sun[1], sun[2]); day = isDay },
    blast(at, r) {
      // The flash: one puff of light, gone in a tenth of a second.
      puff(at, 0, 0, 0, { size: r * 2.6, grow: r * 6, life: 0.12, heat: 1, cool: 0, rise: 0, drag: 0, colour: [0, 0, 0], cover: 0 })
      // Its light on what is round it, for as long as the ball of fire burns: a wide dull glow, added to the picture.
      puff(at, 0, 0, 0, { size: r * 4.2, grow: r * 1.5, life: 0.7, heat: 0.13, cool: 0.18, rise: 0, drag: 0, colour: [0, 0, 0], cover: 0 })
      // The heart of it stays white-hot longest.
      for (let k = 3; k > 0; k--) puff(at, r * 0.2, rnd(5, 20), 20, { size: r * rnd(0.35, 0.5), grow: r * 0.6, life: rnd(1.1, 1.5), heat: 0.95, cool: rnd(0.6, 0.75), rise: 50, drag: 3, colour: [0.13, 0.12, 0.11], cover: 0.5 })
      // The ball of fire: hot lumps thrown out, that swell and climb, and are black smoke in a second and a half.
      // Cooling in half a second, the ball was gone before it could be seen to be one.
      // A big blast's puffs are bigger, not many more: they are drawn over one another, and that is what costs.
      for (let k = Math.min(16, Math.max(6, Math.round(r * 0.8))); k > 0; k--) {
        puff(at, r * 0.5, r * rnd(2, 5.5), r * 2, { size: r * rnd(0.45, 0.9), grow: r * 1.2, life: rnd(1.2, 1.9), heat: rnd(0.6, 0.8), cool: rnd(0.42, 0.62), rise: 70, drag: 3.2, colour: [0.13, 0.12, 0.11], cover: 0.7 })
      }
      // Tongues of it: small, fast and soon out, so its edge is ragged and not a disc.
      for (let k = Math.min(10, Math.max(5, Math.round(r * 0.5))); k > 0; k--) {
        puff(at, r * 0.4, r * rnd(6, 11), r * 2.5, { size: r * rnd(0.18, 0.34), grow: r * 0.5, life: rnd(0.45, 0.8), heat: 0.85, cool: rnd(0.9, 1.3), rise: 40, drag: 3.6, colour: [0.1, 0.09, 0.08], cover: 0.3 })
      }
      // The smoke it leaves: grey, slow, rising for seconds.
      // Dark at first and thick, a column that stands for some seconds.
      for (let k = Math.min(18, Math.max(7, Math.round(r * 0.8))); k > 0; k--) {
        const grey = rnd(0.16, 0.42)
        puff(at, r * 0.7, rnd(8, 30), rnd(15, 45), { size: r * rnd(0.6, 1.1), grow: r * 0.6, life: rnd(3.5, 7.5), heat: 0, cool: 0, rise: 24, drag: 1.1, colour: [grey, grey, grey * 1.04], cover: 0.62, late: 0.16 })
      }
      // And the air it leaves: the dust of what it broke, wide and thin, that hangs over the place for a minute
      // and more. It is heavy in the air (the wind moves it a metre in ten seconds): lighter, it had left the
      // street it was made in before anyone looked. Two a blast, however big: they are wide, and wide things drawn over one another cost.
      if (r >= 12) for (let k = 2; k > 0; k--) {
        const pale = rnd(0.5, 0.62)
        puff(at, r * 1.2, rnd(4, 14), rnd(4, 10), { size: r * rnd(3, 4.4), grow: r * 0.12, life: rnd(70, 110), heat: 0, cool: 0, rise: 4, drag: 6, colour: [pale, pale * 0.97, pale * 0.92], cover: 0.3 })
      }
    },
    dust(at, radius, count, colour) {
      // Thrown out along the ground more than up, and slow to clear: it hangs over where a thing came down for
      // some seconds after all is still.
      for (let k = count; k > 0; k--) {
        puff(at, radius * 0.7, rnd(10, 34), rnd(1, 7), { size: rnd(5, 11) + radius * 0.45, grow: rnd(5, 11), life: rnd(4, 9), heat: 0, cool: 0, rise: 2, drag: 1.7, colour, cover: 0.36 })
      }
    },
    ball(at, r, dt) {
      puff(at, r * 0.15, 0, 0, { size: r * 0.8, grow: -r * 2, life: 0.1, heat: 0.8, cool: 0, rise: 0, drag: 0, colour: [0, 0, 0], cover: 0 })
      if (Math.random() < dt * 90) puff(at, r * 0.45, rnd(2, 9), rnd(0, 8), { size: r * rnd(0.7, 1.2), grow: r * 1.4, life: rnd(0.25, 0.5), heat: 0.82, cool: rnd(1.1, 1.7), rise: 30, drag: 2.5, colour: [0.1, 0.09, 0.08], cover: 0.3 })
      if (Math.random() < dt * 14) { const grey = rnd(0.2, 0.34); puff(at, r * 0.5, rnd(2, 6), rnd(4, 12), { size: r * rnd(0.9, 1.5), grow: r * 1.2, life: rnd(1.2, 2.4), heat: 0, cool: 0, rise: 16, drag: 1.2, colour: [grey, grey, grey], cover: 0.32, late: 0.1 }) }
    },
    glint(at, r) {
      puff(at, 0, 0, 0, { size: r * 2, grow: r * 9, life: 0.22, heat: 0.5, cool: 2, rise: 0, drag: 0, colour: [0, 0, 0], cover: 0 })
    },
    flame(at, dt) {
      // Not white-hot: with the fire's colours as a blast's are, a burning crown at heat 1 was a white blob.
      if (Math.random() < dt * 9) puff(at, 0.8, rnd(1, 5), rnd(18, 40), { size: rnd(1.6, 3.4), grow: rnd(1, 3), life: rnd(0.35, 0.7), heat: 0.62, cool: rnd(0.9, 1.5), rise: 60, drag: 1.5, colour: [0.05, 0.045, 0.04], cover: 0.25 })
      if (Math.random() < dt * 1.2) {
        const grey = rnd(0.2, 0.36)
        puff(at, 1.5, rnd(2, 8), rnd(25, 45), { size: rnd(3, 6), grow: rnd(3, 6), life: rnd(3, 6), heat: 0, cool: 0, rise: 30, drag: 0.9, colour: [grey, grey, grey], cover: 0.42 })
      }
      // Now and then a big dark billow that climbs high: a house on fire stands under a column of smoke.
      if (Math.random() < dt * 0.22) {
        const grey = rnd(0.17, 0.32)
        puff(at, 3, rnd(2, 8), rnd(30, 50), { size: rnd(10, 16), grow: rnd(5, 8), life: rnd(10, 18), heat: 0, cool: 0, rise: 26, drag: 0.7, colour: [grey, grey, grey * 1.03], cover: 0.44 })
      }
      // And its light on what is near: a dull glow round it, added to the picture.
      if (Math.random() < dt * 0.1) puff(at, 1, 0, 0, { size: rnd(14, 22), grow: 0, life: rnd(0.6, 1.0), heat: 0.11, cool: 0, rise: 0, drag: 0, colour: [0, 0, 0], cover: 0 })
    },
    spray(at, dt) {
      if (Math.random() < dt * 0.9) puff(at, 3, rnd(8, 22), rnd(6, 16), { size: rnd(6, 11), grow: rnd(6, 10), life: rnd(0.9, 1.8), heat: 0, cool: 0, rise: 3, drag: 1.6, colour: [0.86, 0.9, 0.94], cover: 0.3 })
    },
    tireSmoke(at, vel, intensity, colour = [0.84, 0.86, 0.9]) {
      const k = Math.max(0, Math.min(1, intensity))
      if (k <= 0.02) return
      const i = KEPT + (next++ % (MOST - KEPT))
      const dx = (Math.random() - 0.5) * 2.2, dy = Math.random() * 0.8, dz = (Math.random() - 0.5) * 2.2
      p[i * 3] = at[0] + dx; p[i * 3 + 1] = at[1] + dy + 0.6; p[i * 3 + 2] = at[2] + dz
      v[i * 3] = vel[0] * 0.22 + (Math.random() - 0.5) * 10
      v[i * 3 + 1] = 4 + 8 * k + Math.random() * 5
      v[i * 3 + 2] = vel[2] * 0.22 + (Math.random() - 0.5) * 10
      size[i] = 2.4 + 2.4 * k + Math.random() * 1.4
      grow[i] = 5.5 + 5.0 * k
      life[i] = span[i] = 0.75 + 0.85 * k + Math.random() * 0.45
      heat[i] = 0; cool[i] = 0; rise[i] = 6 + 4 * k; drag[i] = 2.2
      tone.set([colour[0], colour[1], colour[2], 0.24 + 0.32 * k], i * 4)
      seed[i] = Math.floor(Math.random() * 65536)
      late[i] = 0
    },
    exhaust(at, dir, pop = false, boost = false) {
      if (boost) {
        for (let k = 0; k < 2; k++) {
          const i = KEPT + (next++ % (MOST - KEPT))
          const step = k * 1.4
          p[i * 3] = at[0] + dir[0] * step; p[i * 3 + 1] = at[1] + dir[1] * step; p[i * 3 + 2] = at[2] + dir[2] * step
          v[i * 3] = dir[0] * (44 + k * 16) + (Math.random() - 0.5) * 3
          v[i * 3 + 1] = dir[1] * (44 + k * 16) + 1.5
          v[i * 3 + 2] = dir[2] * (44 + k * 16) + (Math.random() - 0.5) * 3
          size[i] = 1.5 + k * 0.45; grow[i] = 5.2; life[i] = span[i] = 0.11 + k * 0.03
          heat[i] = 0.98; cool[i] = 6.2; rise[i] = 3; drag[i] = 4.5
          tone.set([0.08, 0.65, 1.0, 0.0], i * 4)
          seed[i] = Math.floor(Math.random() * 65536)
          late[i] = 0
        }
        return
      }
      if (pop) {
        const i = KEPT + (next++ % (MOST - KEPT))
        p[i * 3] = at[0]; p[i * 3 + 1] = at[1]; p[i * 3 + 2] = at[2]
        v[i * 3] = dir[0] * 26; v[i * 3 + 1] = dir[1] * 26 + 2; v[i * 3 + 2] = dir[2] * 26
        size[i] = 1.4; grow[i] = 6.5; life[i] = span[i] = 0.13
        heat[i] = 0.92; cool[i] = 5.5; rise[i] = 6; drag[i] = 5
        tone.set([0.2, 0.18, 0.17, 0.28], i * 4)
        seed[i] = Math.floor(Math.random() * 65536)
        late[i] = 0
      }
      const j = KEPT + (next++ % (MOST - KEPT))
      p[j * 3] = at[0]; p[j * 3 + 1] = at[1]; p[j * 3 + 2] = at[2]
      v[j * 3] = dir[0] * 18 + (Math.random() - 0.5) * 4; v[j * 3 + 1] = dir[1] * 18 + 4; v[j * 3 + 2] = dir[2] * 18 + (Math.random() - 0.5) * 4
      size[j] = 1.6; grow[j] = 4.5; life[j] = span[j] = pop ? 0.55 : 0.42
      heat[j] = 0; cool[j] = 0; rise[j] = 8; drag[j] = 3.0
      tone.set([0.28, 0.29, 0.32, pop ? 0.36 : 0.22], j * 4)
      seed[j] = Math.floor(Math.random() * 65536)
      late[j] = 0
    },
    crash(at, strength) {
      for (let k = Math.round(3 + strength * 4); k > 0; k--) {
        const pale = rnd(0.54, 0.68)
        puff(at, 1.6, rnd(10, 24) * (0.5 + strength), rnd(3, 9), { size: rnd(1.3, 2.5), grow: rnd(2.8, 4.6), life: rnd(1.0, 1.8), heat: 0, cool: 0, rise: 4, drag: 2.6, colour: [pale, pale * 0.97, pale * 0.92], cover: 0.36 })
      }
    },
    engine(at, level, dt) {
      // Emit cleanly just above the buckled front hood ridge (never intersecting the hood mesh like a
      // dark painted stain): pale radiator steam at the base, thickening into sunlit charcoal smoke as it rises.
      const seam: [number, number, number] = [at[0], at[1] + 0.3, at[2]]
      if (level < 0.7) {
        const frac = (level - 0.35) / 0.35
        if (Math.random() < dt * (14 + 12 * frac)) {
          const w = rnd(0.84, 0.95)
          puff(seam, 0.75, rnd(0.6, 1.7), rnd(8, 14), { size: rnd(0.65, 1.0), grow: rnd(1.8, 2.8), life: rnd(0.95, 1.5), heat: 0, cool: 0, rise: 15, drag: 1.5, colour: [w, w * 1.01, Math.min(0.97, w * 1.02)], cover: 0.24 + 0.08 * frac, late: 0.0 })
        }
        return
      }
      // Pale warm-grey steam escaping cleanly off the buckled hood crest (no dark decal on the paint).
      if (Math.random() < dt * 15) {
        const wisp = rnd(0.56, 0.70)
        puff(seam, 0.85, rnd(0.7, 1.9), rnd(9, 15), { size: rnd(0.65, 1.0), grow: rnd(1.9, 2.9), life: rnd(1.05, 1.6), heat: 0, cool: 0, rise: 16, drag: 1.45, colour: [wisp, wisp, wisp * 1.02], cover: 0.20, late: 0.0 })
      }
      // Warm-charcoal engine smoke (clearly damaged-engine smoke rather than a pitch-black oil fire)
      // fading in softly off the hood crest and keeping the right driving lane readable from the seat.
      if (Math.random() < dt * 16) {
        const grey = rnd(0.34, 0.48)
        puff(seam, 0.85, rnd(0.8, 2.1), rnd(11, 17), { size: rnd(0.85, 1.25), grow: rnd(2.4, 3.6), life: rnd(1.6, 2.4), heat: 0, cool: 0, rise: 18, drag: 1.35, colour: [grey, grey, grey * 1.03], cover: 0.24, late: 0.03 })
      }
      // Burning: compact flickering orange tongues at the hood seam.
      if (level > 0.92 && Math.random() < dt * 12) puff(seam, 0.8, rnd(1, 2.2), rnd(10, 22), { size: rnd(0.95, 1.7), grow: rnd(0.8, 1.8), life: rnd(0.28, 0.55), heat: 0.72, cool: rnd(1.1, 1.6), rise: 42, drag: 1.5, colour: [0.06, 0.05, 0.04], cover: 0.22, late: 0.0 })
    },
    step(dt) {
      live = 0
      for (let i = 0; i < MOST; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt
        live++
        const slow = Math.max(0, 1 - drag[i] * dt)
        v[i * 3] = v[i * 3] * slow + 6 * dt // a light wind along x
        v[i * 3 + 1] = v[i * 3 + 1] * slow + rise[i] * dt
        v[i * 3 + 2] *= slow
        for (let a = 0; a < 3; a++) p[i * 3 + a] += v[i * 3 + a] * dt
        size[i] += grow[i] * dt
        heat[i] = Math.max(0, heat[i] - cool[i] * dt)
      }
    },
    draw(encoder, to, view) {
      if (!live) return
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      // The furthest first: each covers what is behind it.
      let n = 0
      for (let i = 0; i < MOST; i++) {
        if (life[i] <= 0) continue
        far[i] = (p[i * 3] - view.eye[0]) * view.forward[0] + (p[i * 3 + 1] - view.eye[1]) * view.forward[1] + (p[i * 3 + 2] - view.eye[2]) * view.forward[2]
        order[n++] = i
      }
      const sorted = order.subarray(0, n).sort((a, b) => far[b] - far[a])
      for (let k = 0; k < n; k++) {
        const i = sorted[k], o = k * EACH
        packed[o] = p[i * 3] - anchor[0]; packed[o + 1] = p[i * 3 + 1] - anchor[1]; packed[o + 2] = p[i * 3 + 2] - anchor[2]; packed[o + 3] = size[i]
        packed[o + 4] = tone[i * 4]; packed[o + 5] = tone[i * 4 + 1]; packed[o + 6] = tone[i * 4 + 2]; packed[o + 7] = tone[i * 4 + 3]
        packed[o + 8] = heat[i]; packed[o + 9] = seed[i]; packed[o + 10] = 1 - life[i] / span[i]; packed[o + 11] = late[i]
      }
      device.queue.writeBuffer(instances, 0, packed, 0, n * EACH)
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf,
        ...view.right, to.size[0] / to.size[1], ...view.up, 0, ...view.forward, 0, ...sun.map((s) => s / sunLength), day,
      ]))
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.setVertexBuffer(0, instances)
      pass.draw(4, n)
      pass.end()
    },
  }
}
