// Sky-gap animated drone formation + atmospheric fog projection for Easter eggs (eggs.ts, march.ts SCREEN).
// Runs right after farModel.draw() in a single WebGPU render pass (fog halo + instanced GPU drone quads) and masks
// strictly to open sky pixels (marched depth == 1.0 && far depth == 0.0).
//
// - Takeoff / land: drones lift off in staggered curved waves from launch pods behind the skyline as march.screen.up
//   ramps 0 -> 1 (with warm/cool nav lights crossfading into the video's pixels), and break formation when stopping.
// - Camera-chase: when the visitor turns or moves in the 3D world, a cascaded quaternion spring lags ~1 s behind the
//   live camera; per-drone agility and banking make the swarm peel away and re-form organically behind the skyscrapers.
// - Performance: 0 CPU per-drone work (only 3 quaternion slerps/frame), 1 render pass, degenerate-triangle culling for
//   offscreen/dark drones, and zero GPU work when march.screen.up <= 0 || !march.screen.sky.
import { shader, type Target } from '../probe/gpu.ts'
import { GLOBALS, type Marcher, type View } from './march.ts'

const CODE = /* wgsl */ `
${GLOBALS}
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var marched: texture_depth_2d;
@group(0) @binding(2) var faced: texture_depth_2d;
@group(0) @binding(3) var screenTex: texture_2d<f32>;
@group(0) @binding(4) var smooth_: sampler;
struct SkyEgg {
  liveFwd: vec3f, liveTan: f32,
  liveRight: vec3f, liveAspect: f32,
  liveUp: vec3f, time: f32,
  lagFwd: vec3f, lagTan: f32,
  lagRight: vec3f, lagAspect: f32,
  lagUp: vec3f, up: f32,
  tailFwd: vec3f, settled: f32,
  tailRight: vec3f, cols: f32,
  tailUp: vec3f, rows: f32,
  rect: vec4f,
  lagRect: vec4f,
  size: vec2f, radiusPx: f32, motion: f32,
}
@group(0) @binding(5) var<uniform> u: SkyEgg;

fn hash2(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}

fn noise2(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let t = fract(p);
  let s = t * t * (3.0 - 2.0 * t);
  return mix(
    mix(hash2(i), hash2(i + vec2i(1, 0)), s.x),
    mix(hash2(i + vec2i(0, 1)), hash2(i + vec2i(1, 1)), s.x),
    s.y
  );
}

fn isSky(px: vec2i) -> bool {
  let z = textureLoad(marched, px, 0);
  if (z < 1.0) { return false; }
  let fsize = textureDimensions(faced);
  if (fsize.x > 1u) {
    let w = textureLoad(faced, min(px, vec2i(fsize) - 1), 0);
    if (w > 0.0) { return false; }
  }
  return true;
}

fn uvToDir(uv: vec2f, fwd: vec3f, right: vec3f, up: vec3f, tanHalf: f32, aspect: f32) -> vec3f {
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return normalize(fwd + right * (ndc.x * tanHalf * aspect) + up * (ndc.y * tanHalf));
}

// ── Pass 1: Atmospheric fog / cloud projection halo (fullscreen triangle, masked to open sky) ──
@vertex fn fogVs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fogFs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  if (!isSky(vec2i(at.xy))) { return vec4f(0.0); }
  let night = smoothstep(0.68, 0.12, g.day);
  // Fog halo swells in warmly as the drones lock into formation and softens while they are sweeping across the sky.
  let presence = smoothstep(0.35, 1.0, u.up) * night * (0.28 + 0.72 * u.settled);
  if (presence <= 0.001) { return vec4f(0.0); }

  let uv = at.xy / u.size;
  let full = u.rect.x <= 0.001 && u.rect.y <= 0.001 && u.rect.z >= 0.999 && u.rect.w >= 0.999;
  let feather = vec2f(0.022, 0.022);
  let edgeX = select(smoothstep(u.rect.x - feather.x, u.rect.x + feather.x, uv.x) * (1.0 - smoothstep(u.rect.z - feather.x, u.rect.z + feather.x, uv.x)), 1.0, full);
  let edgeY = select(smoothstep(u.rect.y - feather.y, u.rect.y + feather.y, uv.y) * (1.0 - smoothstep(u.rect.w - feather.y, u.rect.w + feather.y, uv.y)), smoothstep(0.0, 0.05, uv.y), full);
  let inRect = edgeX * edgeY;
  if (inRect <= 0.001) { return vec4f(0.0); }

  let blurStep = vec2f(0.015, 0.015);
  let c0 = textureSampleLevel(screenTex, smooth_, clamp(uv, u.rect.xy, u.rect.zw), 0.0).rgb;
  let c1 = textureSampleLevel(screenTex, smooth_, clamp(uv + vec2f(blurStep.x, blurStep.y), u.rect.xy, u.rect.zw), 0.0).rgb;
  let c2 = textureSampleLevel(screenTex, smooth_, clamp(uv + vec2f(-blurStep.x, blurStep.y), u.rect.xy, u.rect.zw), 0.0).rgb;
  let c3 = textureSampleLevel(screenTex, smooth_, clamp(uv + vec2f(blurStep.x, -blurStep.y), u.rect.xy, u.rect.zw), 0.0).rgb;
  let c4 = textureSampleLevel(screenTex, smooth_, clamp(uv + vec2f(-blurStep.x, -blurStep.y), u.rect.xy, u.rect.zw), 0.0).rgb;
  let softCol = c0 * 0.36 + (c1 + c2 + c3 + c4) * 0.16;
  let softLuma = max(softCol.r, max(softCol.g, softCol.b));

  let drift = vec2f(u.time * 0.035, -u.time * 0.012);
  let cloud = noise2(uv * vec2f(4.5, 3.2) + drift) * 0.62 + noise2(uv * vec2f(10.5, 7.8) - drift * 1.4) * 0.38;
  let fogMask = smoothstep(0.03, 0.16, softLuma) * inRect * presence;
  let fogLight = softCol * (0.12 + 0.19 * cloud) * fogMask;
  let fogAlpha = (0.12 + 0.16 * cloud) * fogMask;

  // Subtle dark veil behind active video pixels once settled so silhouettes like Bad Apple pop over stars.
  let veil = select(0.28 * inRect * presence * u.settled, 0.0, full);
  return vec4f(fogLight, clamp(max(veil, fogAlpha), 0.0, 0.90));
}

// ── Pass 2: Instanced GPU drone swarm (staggered takeoff, curved arcs, spring-lagged camera chase) ──
struct DroneOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) col: vec3f,
  @location(2) alpha: f32,
}

@vertex fn droneVs(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) iIdx: u32) -> DroneOut {
  var dead: DroneOut;
  dead.pos = vec4f(2.0, 2.0, 0.0, 1.0);
  dead.local = vec2f(0.0);
  dead.col = vec3f(0.0);
  dead.alpha = 0.0;

  let night = smoothstep(0.68, 0.12, g.day);
  if (night <= 0.001 || u.up <= 0.001) { return dead; }

  let colsU = max(1u, u32(u.cols));
  let col = iIdx % colsU;
  let row = iIdx / colsU;
  let cell = vec2i(i32(col), i32(row));
  let uNorm = (f32(col) + 0.5) / u.cols;
  let vNorm = (f32(row) + 0.5) / u.rows;

  let rnd1 = hash2(cell);
  let rnd2 = hash2(cell + vec2i(37, 91));
  let rnd3 = hash2(cell + vec2i(113, 19));

  // Sample this drone's assigned video pixel (constant per drone even while flying into formation).
  let videoUv = vec2f(mix(u.rect.x, u.rect.z, uNorm), mix(u.rect.y, u.rect.w, vNorm));
  let videoCol = textureSampleLevel(screenTex, smooth_, clamp(videoUv, u.rect.xy, u.rect.zw), 0.0).rgb;
  let videoLuma = max(videoCol.r, max(videoCol.g, videoCol.b));

  // Staggered takeoff: bottom rows lift off first from launch pods behind the skyline, locking by up ~0.92.
  let delay = (1.0 - vNorm) * 0.20 + rnd1 * 0.16;
  let tFly = select(u.up, clamp((u.up - delay) / 0.56, 0.0, 1.0), u.motion > 0.5);
  if (tFly <= 0.001) { return dead; }
  let ease = 1.0 - pow(1.0 - tFly, 3.0);
  let inFlight = sin(tFly * 3.14159265) * u.motion;

  // World-space target directions in live, primary-lagged, and trailing formation frames.
  let lagUv = vec2f(mix(u.lagRect.x, u.lagRect.z, uNorm), mix(u.lagRect.y, u.lagRect.w, vNorm));
  let dLive = uvToDir(videoUv, u.liveFwd, u.liveRight, u.liveUp, u.liveTan, u.liveAspect);
  let dLag = uvToDir(lagUv, u.lagFwd, u.lagRight, u.lagUp, u.lagTan, u.lagAspect);
  let dTail = uvToDir(lagUv, u.tailFwd, u.tailRight, u.tailUp, u.lagTan, u.lagAspect);

  // Per-drone agility during camera turns: nimble leaders break first, outer/trailing drones sweep in smoothly behind.
  let radial = length(vec2f(uNorm, vNorm) - 0.5);
  let agility = clamp(0.12 + rnd1 * 0.88 - radial * 0.24, 0.0, 1.0);
  let dMid = normalize(mix(dTail, dLag, agility));
  let dChase = normalize(mix(dMid, dLive, max(0.0, agility - 0.62) * 0.65));

  // Organic 3D bank/fan-out while chasing a camera turn (collapses to 0 as drones lock into position).
  let moveGap = length(dLive - dChase) * u.motion;
  let bank = u.liveUp * (moveGap * (0.05 + 0.11 * sin(rnd2 * 6.2831))) + u.liveRight * (moveGap * 0.09 * cos(rnd3 * 6.2831));

  // Staging pods behind the skyline for takeoff/disperse arcs.
  let pod = floor(rnd3 * 5.0);
  let podU = mix(u.lagRect.x + 0.06, u.lagRect.z - 0.06, (pod + 0.5) / 5.0) + (rnd2 - 0.5) * 0.09;
  let podV = min(0.96, u.lagRect.w + 0.14 + rnd1 * 0.14);
  let dOrigin = uvToDir(vec2f(podU, podV), u.lagFwd, u.lagRight, u.lagUp, u.lagTan, u.lagAspect);
  let swoopX = (uNorm - 0.5) * 0.18 + (rnd2 - 0.5) * 0.15;
  let swoopY = 0.07 + rnd1 * 0.10;
  let dFly = normalize(mix(dOrigin, dChase, ease) + (u.lagRight * swoopX + u.lagUp * swoopY) * inFlight + bank);

  // Project flying drone into live camera clip space.
  let depthFwd = dot(dFly, u.liveFwd);
  if (depthFwd <= 0.05) { return dead; }
  let ndcX = dot(dFly, u.liveRight) / (depthFwd * u.liveTan * u.liveAspect);
  let ndcY = dot(dFly, u.liveUp) / (depthFwd * u.liveTan);
  if (abs(ndcX) > 1.12 || abs(ndcY) > 1.12) { return dead; }

  // Nav-light transition: drones glow faintly with warm/cool nav LEDs while flying, then crossfade to exact video pixels.
  let videoLit = smoothstep(0.035, 0.14, videoLuma);
  let transit = clamp(inFlight * 0.95 + smoothstep(0.025, 0.22, moveGap) * 0.72, 0.0, 1.0);
  let brightness = max(videoLit, transit * 0.44) * smoothstep(0.0, 0.12, tFly) * night;
  if (brightness <= 0.005) { return dead; }

  let navCol = mix(vec3f(1.0, 0.78, 0.48), vec3f(0.55, 0.88, 1.0), step(0.5, rnd3));
  let finalCol = mix(videoCol, mix(videoCol, navCol, 0.58), transit * 0.65);
  let shimmer = 0.92 + 0.08 * sin(u.time * (3.0 + rnd1 * 4.0) + rnd2 * 6.2831);

  // Two-triangle quad corners (-1..1).
  var corner = vec2f(-1.0, -1.0);
  if (vIdx == 1u || vIdx == 3u) { corner = vec2f(1.0, -1.0); }
  else if (vIdx == 2u || vIdx == 5u) { corner = vec2f(-1.0, 1.0); }
  else if (vIdx == 4u) { corner = vec2f(1.0, 1.0); }

  let hoverPx = vec2f(
    sin(u.time * (1.2 + rnd1 * 1.4) + rnd1 * 6.2831),
    cos(u.time * (1.0 + rnd2 * 1.3) + rnd2 * 6.2831)
  ) * (u.radiusPx * 0.13 * u.motion);
  let halfPx = u.radiusPx * (1.0 + transit * 0.22);
  let clip = vec2f(ndcX, ndcY) + (hoverPx + corner * halfPx) * (2.0 / u.size);

  var out: DroneOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.local = corner;
  out.col = finalCol * shimmer;
  out.alpha = brightness;
  return out;
}

@fragment fn droneFs(in: DroneOut) -> @location(0) vec4f {
  if (!isSky(vec2i(in.pos.xy))) { return vec4f(0.0); }
  let d = length(in.local);
  if (d >= 1.0) { return vec4f(0.0); }
  let core = 1.0 - smoothstep(0.20, 0.54, d);
  let halo = exp(-d * d * 4.2) * (1.0 - smoothstep(0.72, 1.0, d)) * 0.36;
  let rgb = in.col * (core * 1.10 + halo * 0.56) * in.alpha;
  // Only the solid core occludes behind it; the optical halo adds softly when flying drones cross paths.
  let a = core * 0.76 * in.alpha;
  return vec4f(rgb, a);
}
`

type Quat = [number, number, number, number]

/** Orthonormal camera basis [right, up, -forward] -> unit quaternion (singularity-free, even at zenith or barrel roll). */
function basisToQuat(r: readonly number[], u: readonly number[], f: readonly number[]): Quat {
  const m00 = r[0], m01 = u[0], m02 = -f[0]
  const m10 = r[1], m11 = u[1], m12 = -f[1]
  const m20 = r[2], m21 = u[2], m22 = -f[2]
  const tr = m00 + m11 + m22
  let x: number, y: number, z: number, w: number
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s
  }
  const len = Math.hypot(x, y, z, w) || 1
  return [x / len, y / len, z / len, w / len]
}

/** Unit quaternion -> camera basis { right, up, forward }. */
function quatToBasis(q: Quat): { right: [number, number, number]; up: [number, number, number]; forward: [number, number, number] } {
  const [x, y, z, w] = q
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z
  return {
    right: [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy)],
    up: [2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx)],
    forward: [-(2 * (xz + wy)), -(2 * (yz - wx)), -(1 - 2 * (xx + yy))],
  }
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  let bx = b[0], by = b[1], bz = b[2], bw = b[3]
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw }
  if (dot > 0.9995) {
    const x = a[0] + (bx - a[0]) * t, y = a[1] + (by - a[1]) * t, z = a[2] + (bz - a[2]) * t, w = a[3] + (bw - a[3]) * t
    const len = Math.hypot(x, y, z, w) || 1
    return [x / len, y / len, z / len, w / len]
  }
  const theta = Math.acos(Math.min(1, dot)), sinT = Math.sin(theta)
  const w0 = Math.sin((1 - t) * theta) / sinT, w1 = Math.sin(t * theta) / sinT
  return [a[0] * w0 + bx * w1, a[1] * w0 + by * w1, a[2] * w0 + bz * w1, a[3] * w0 + bw * w1]
}

function quatAngle(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  return 2 * Math.acos(Math.min(1, dot))
}

export interface EggSky {
  /** Draws the atmospheric fog halo and animated instanced drone swarm over open sky in `to`, after `march` and `farModel`. */
  draw(encoder: GPUCommandEncoder, to: Target, faced: GPUTextureView | null, view: View, time: number): void
}

export async function eggSky(device: GPUDevice, format: GPUTextureFormat, march: Marcher): Promise<EggSky> {
  const module = await shader(device, 'egg-sky', CODE)
  const groupLayout = device.createBindGroupLayout({
    label: 'egg-sky',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] })
  const blend: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    alpha: { srcFactor: 'zero', dstFactor: 'one' },
  }
  const [fogPipeline, dronePipeline] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'egg-sky-fog', layout: pipelineLayout,
      vertex: { module, entryPoint: 'fogVs' },
      fragment: { module, entryPoint: 'fogFs', targets: [{ format, blend }] },
    }),
    device.createRenderPipelineAsync({
      label: 'egg-sky-drones', layout: pipelineLayout,
      vertex: { module, entryPoint: 'droneVs' },
      fragment: { module, entryPoint: 'droneFs', targets: [{ format, blend }] },
    }),
  ])

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const uniforms = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const uniformData = new Float32Array(48)
  const nothing = device.createTexture({ size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT })
  const enc = device.createCommandEncoder()
  enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: nothing.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end()
  device.queue.submit([enc.finish()])
  const none = nothing.createView()

  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  let held: { a: GPUTextureView; b: GPUTextureView; bind: GPUBindGroup } | null = null
  let active = false
  let lastTime = 0
  let qMid: Quat = [0, 0, 0, 1]
  let qLag: Quat = [0, 0, 0, 1]
  let qTail: Quat = [0, 0, 0, 1]
  let lagRect: [number, number, number, number] = [0, 0, 1, 1]
  let lagTan = 0.5
  let lagAspect = 1

  return {
    draw(encoder, to, faced, view, time) {
      if (march.screen.up <= 0 || !march.screen.sky) { active = false; return }
      const b = faced ?? none
      if (!held || held.a !== to.depth || held.b !== b) {
        held = {
          a: to.depth,
          b,
          bind: device.createBindGroup({
            layout: groupLayout,
            entries: [
              { binding: 0, resource: { buffer: march.globals } },
              { binding: 1, resource: to.depth },
              { binding: 2, resource: b },
              { binding: 3, resource: march.screen.view },
              { binding: 4, resource: sampler },
              { binding: 5, resource: { buffer: uniforms } },
            ],
          }),
        }
      }

      const aspect = to.size[0] / to.size[1]
      const rect = march.screen.rect
      const qLive = basisToQuat(view.right, view.up, view.forward)
      const motion = reduced?.matches ? 0 : 1
      const dt = Math.max(0, Math.min(0.05, time - lastTime))
      lastTime = time

      if (!active || motion === 0) {
        active = true
        qMid = qLive; qLag = qLive; qTail = qLive
        lagRect = [rect[0], rect[1], rect[2], rect[3]]
        lagTan = view.tanHalf
        lagAspect = aspect
      } else if (dt > 0) {
        // Cascaded quaternion slerp: smooth acceleration + ~1 s deceleration into the new camera heading.
        qMid = slerp(qMid, qLive, 1 - Math.exp(-dt * 8.5))
        qLag = slerp(qLag, qMid, 1 - Math.exp(-dt * 6.2))
        qTail = slerp(qTail, qLag, 1 - Math.exp(-dt * 4.2))
        const kr = 1 - Math.exp(-dt * 6.5)
        for (let i = 0; i < 4; i++) lagRect[i] += (rect[i] - lagRect[i]) * kr
        lagTan += (view.tanHalf - lagTan) * kr
        lagAspect += (aspect - lagAspect) * kr
      }

      const lagBasis = quatToBasis(qLag)
      const tailBasis = quatToBasis(qTail)
      const angleGap = quatAngle(qLive, qTail)
      const rectGap = Math.max(
        Math.abs(rect[0] - lagRect[0]), Math.abs(rect[1] - lagRect[1]),
        Math.abs(rect[2] - lagRect[2]), Math.abs(rect[3] - lagRect[3]),
      )
      const settled = motion === 0 ? 1 : Math.max(0, Math.min(1, 1 - (angleGap / 0.18 + rectGap / 0.08)))

      // Adaptive square drone spacing in physical pixels, capped so vertex cost stays tiny even at 4K.
      const pitch = Math.max(4, Math.min(to.size[0], to.size[1]) / 92)
      const rectW = Math.max(1, (rect[2] - rect[0]) * to.size[0])
      const rectH = Math.max(1, (rect[3] - rect[1]) * to.size[1])
      const cols = Math.max(16, Math.min(120, Math.round(rectW / pitch)))
      const rows = Math.max(12, Math.min(80, Math.round(rectH / pitch)))
      const radiusPx = Math.max(rectW / cols, rectH / rows) * 0.64

      uniformData.set([
        view.forward[0], view.forward[1], view.forward[2], view.tanHalf,
        view.right[0], view.right[1], view.right[2], aspect,
        view.up[0], view.up[1], view.up[2], time,
        lagBasis.forward[0], lagBasis.forward[1], lagBasis.forward[2], lagTan,
        lagBasis.right[0], lagBasis.right[1], lagBasis.right[2], lagAspect,
        lagBasis.up[0], lagBasis.up[1], lagBasis.up[2], march.screen.up,
        tailBasis.forward[0], tailBasis.forward[1], tailBasis.forward[2], settled,
        tailBasis.right[0], tailBasis.right[1], tailBasis.right[2], cols,
        tailBasis.up[0], tailBasis.up[1], tailBasis.up[2], rows,
        rect[0], rect[1], rect[2], rect[3],
        lagRect[0], lagRect[1], lagRect[2], lagRect[3],
        to.size[0], to.size[1], radiusPx, motion,
      ])
      device.queue.writeBuffer(uniforms, 0, uniformData)

      const pass = encoder.beginRenderPass({ label: 'egg-sky', colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }] })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setBindGroup(0, held.bind)
      pass.setPipeline(fogPipeline)
      pass.draw(3)
      pass.setPipeline(dronePipeline)
      pass.draw(6, cols * rows)
      pass.end()
    },
  }
}
