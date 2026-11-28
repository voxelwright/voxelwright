// Water that flows (#140, #165), as the core tells it (water.rs): how high its top stands over each
// column of a window of the world. It is drawn as a surface over the marched picture while reading
// the scene depth buffer (`to.depth`) for true water-column thickness, Beer-Lambert depth absorption,
// animated shoreline/obstacle contact foam, dual-layer normal ripples, Schlick Fresnel (F0 = 0.02),
// GGX sun specular glints, and sky/horizon reflection in linear HDR.
import { FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import { AIR, GLOBALS, MAX_LEVELS, SUNLIT, type Marcher, type View } from './march.ts'
import { LIGHTS_BYTES, LOCAL_LIGHTS_STRUCT, localLightsEval } from './lights.ts'

const GLOBALS_BYTES = 144 + MAX_LEVELS * 128 + 192 + 512 + 16

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, time: f32,
  forward: vec3f, day: f32,
  sun: vec3f, col: f32,
  // Where the window's low corner is from the anchor the eye is measured from (its height is the base the tops are over).
  origin: vec3f, resX: f32,
  // The box round the wet columns: its low corner, how many across.
  box: vec4u,
  sky: vec3f, resY: f32,
  hasWorld: u32, pad0: u32, pad1: u32, pad2: u32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var heights: texture_2d<u32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
${GLOBALS}
${LOCAL_LIGHTS_STRUCT}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
@group(1) @binding(2) var<uniform> localLights: LocalLights;
${SUNLIT}
${AIR}
${localLightsEval()}

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) seen: vec3f,
  @location(1) plan: vec2f,
  // How deep, how fast, and interior-ness (0 along outer perimeter touching dry columns, 1 interior).
  @location(2) more: vec3f,
  // How high its top is over the base.
  @location(3) high: f32,
}
const NEAR = ${NEAR.toFixed(1)};
const FAR = ${FAR.toFixed(1)};
fn word(c: vec2i) -> u32 {
  let size = vec2i(textureDimensions(heights));
  if (any(c < vec2i(0)) || any(c >= size)) { return 0u; }
  return textureLoad(heights, c, 0).r;
}
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let column = vec2i(i32(u.box.x + i % u.box.z), i32(u.box.y + i / u.box.z));
  let corner = vec2i(i32(v & 1u), i32((v >> 1u) & 1u));
  var out: Out;
  if ((word(column) >> 18u) == 0u) {
    // A dry column: nothing of it is drawn.
    out.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }
  // The corner's height, depth and speed: the mean of the wet columns round it.
  var top = 0.0; var deep = 0.0; var fast = 0.0; var n = 0.0; var dry = 0.0;
  for (var k = 0; k < 4; k++) {
    let w = word(column + corner - vec2i(k & 1, k >> 1u));
    if ((w >> 18u) == 0u) { dry += 1.0; continue; }
    top += f32(w & 0x3ffffu) / 8.0;
    deep += f32((w >> 18u) & 255u) / 16.0;
    fast += f32(w >> 26u) * 2.0;
    n += 1.0;
  }
  top /= n;
  // At the water's edge it thins to nothing; edge reaches 0 on every outer boundary vertex (dry >= 2)
  // so jagged grid-aligned column edges melt organically into the ground.
  deep = deep / n * (1.0 - dry / 4.0);
  let edge = clamp((2.0 - dry) * 0.5, 0.0, 1.0);
  let at = vec2f(column + corner) * u.col;
  // Drawn a little over where it is: thin water an inch over a road would fight the road for each pixel.
  let world = u.origin + vec3f(at.x, top + 0.25, at.y) - u.eye;
  let d = dot(world, u.forward);
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.seen = world;
  out.plan = at;
  out.more = vec3f(deep, fast / n, edge);
  out.high = top;
  return out;
}
fn lump(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn noise1(p: vec2f) -> f32 {
  let c = vec2i(floor(p));
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(mix(lump(c), lump(c + vec2i(1, 0)), e.x), mix(lump(c + vec2i(0, 1)), lump(c + vec2i(1, 1)), e.x), e.y);
}
// Dual-layer animated wave heightfield (broad directional swells + rotated cross ripples + capillary detail).
fn waveHeight(p: vec2f, run: f32, fineFade: f32) -> f32 {
  let a = noise1(p * 0.36 + vec2f(run * 0.85, run * 0.52));
  let rot = vec2f(p.x * 0.80 - p.y * 0.60, p.x * 0.60 + p.y * 0.80);
  let b = noise1(rot * 0.78 + vec2f(-run * 1.15, run * 0.92) + vec2f(a * 0.45, -a * 0.35));
  let c = noise1(p * 1.95 - vec2f(run * 1.8, -run * 1.45));
  return a * 0.54 + b * 0.34 + c * 0.12 * fineFade;
}
// Cellular/FBM lacy foam field animated with surface flow.
fn foamField(p: vec2f, run: f32) -> f32 {
  let n1 = noise1(p * 0.85 - vec2f(run * 1.65, run * 1.1));
  let warp = vec2f(n1 - 0.5, noise1(p.yx * 0.95 + vec2f(run * 1.2, -run * 0.9)) - 0.5);
  let n2 = noise1(p * 2.15 + warp * 1.35 + vec2f(run * 1.4, -run * 0.8));
  let n3 = noise1(p * 4.6 - warp * 1.1 + vec2f(-run * 2.1, run * 1.5));
  return n1 * 0.42 + n2 * 0.38 + n3 * 0.20;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  // Manual depth test against scene depth (to.depth bound as texture_depth_2d -> no attachment conflict).
  let maxCoord = vec2i(max(i32(u.resX) - 1, 0), max(i32(u.resY) - 1, 0));
  let px = clamp(vec2i(in.pos.xy), vec2i(0), maxCoord);
  let sceneD = textureLoad(depthTex, px, 0);
  let sceneLinearZ = select(FAR, NEAR / max(1.0 - sceneD * ((FAR - NEAR) / FAR), 1e-6), sceneD < 1.0);
  let waterLinearZ = dot(in.seen, u.forward);
  if (waterLinearZ <= NEAR || waterLinearZ >= sceneLinearZ) { discard; }

  let deep = in.more.x;
  let fast = in.more.y;
  let edge = in.more.z;
  let dist = length(in.seen);
  let rd = in.seen / max(dist, 1e-4);
  let look = -rd;
  let cosEye = max(dot(rd, u.forward), 0.12);
  // True water column depth along the view ray (in finest cells, 10 cells = 1 m).
  let waterDepth = max(sceneLinearZ - waterLinearZ, 0.0) / cosEye;

  // Geometric surface normal from screen derivatives, perturbed by animated dual-layer normal ripples.
  var geomN = normalize(cross(dpdx(in.seen), dpdy(in.seen)));
  if (geomN.y < 0.0) { geomN = -geomN; }
  let steep = 1.0 - geomN.y;
  let run = u.time * (1.1 + fast * 0.16);
  let fineFade = 1.0 / (1.0 + dist * 0.0045);
  let eps = 0.22;
  let h0 = waveHeight(in.plan, run, fineFade);
  let hx = waveHeight(in.plan + vec2f(eps, 0.0), run, fineFade);
  let hz = waveHeight(in.plan + vec2f(0.0, eps), run, fineFade);
  let rippleAmp = mix(0.30, 0.50, clamp(fast * 0.12, 0.0, 1.0)) * (0.45 + 0.55 * fineFade);
  let n = normalize(geomN + vec3f((h0 - hx) / eps, 0.0, (h0 - hz) / eps) * rippleAmp);

  let NdotV = max(dot(n, look), 0.001);
  // Schlick Fresnel with physical water F0 = 0.02.
  let fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

  // World lighting: sun radiance, sky fill, sky/horizon reflection, directional shadow reception, and local lights.
  let worldP = in.seen + u.eye;
  var worldSun = 1.0;
  var sunCol = vec3f(1.0, 0.94, 0.82) * mix(0.05, 1.45, u.day);
  var skyFill = u.sky * mix(0.05, 1.0, u.day);
  let reflDir = reflect(rd, n);
  var envRefl = mix(u.sky * 0.72, u.sky * 1.15, pow(clamp(reflDir.y, 0.0, 1.0), 0.55)) * mix(0.05, 1.0, u.day);
  if (u.hasWorld != 0u && g.levels > 0u) {
    let sunny = sunlit(worldP, geomN, 0u);
    if (sunny >= 0.0) { worldSun = sunny; }
    sunCol = g.lightSun.rgb * 2.6;
    skyFill = g.lightFill.rgb * 1.45;
    let skyDir = vec3f(reflDir.x, max(reflDir.y, 0.015), reflDir.z);
    let skySample = skyBase(skyDir);
    let horizonBand = g.skyHorizon.rgb * 0.55;
    envRefl = mix(horizonBand * 0.25, skySample, smoothstep(-0.08, 0.22, reflDir.y)) * mix(0.46, 0.78, worldSun);
  }

  // Beer-Lambert exponential depth absorption: shallow puddles stay crystal clear, deeper pools shift to rich teal-blue.
  let absorb = exp(-waterDepth * vec3f(0.14, 0.045, 0.025));
  let bgKeep = dot(absorb, vec3f(0.299, 0.587, 0.114));
  let bodyAlpha = clamp(1.0 - bgKeep, 0.0, 0.92);
  let NdotL = max(dot(n, u.sun), 0.0);
  let waterLight = skyFill * 1.15 + vec3f(0.14, 0.17, 0.19) * mix(0.04, 1.0, u.day) + sunCol * (NdotL * worldSun * 0.85 + 0.15 * worldSun);
  let shallowCol = vec3f(0.045, 0.42, 0.40);
  let deepCol = vec3f(0.005, 0.105, 0.195);
  let bodyTint = mix(deepCol, shallowCol, absorb);
  let waterBody = bodyTint * waterLight;

  // Crisp GGX microfacet sun specular glint in linear HDR.
  let H = normalize(u.sun + look);
  let NdotH = max(dot(n, H), 0.0);
  let VdotH = max(dot(look, H), 0.0);
  let rough = mix(0.05, 0.14, clamp(fast * 0.08, 0.0, 1.0));
  let a = rough * rough;
  let a2 = a * a;
  let denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  let D = a2 / max(3.14159265 * denom * denom, 1e-5);
  let k = (rough + 1.0) * (rough + 1.0) * 0.125;
  let G = (NdotV / (NdotV * (1.0 - k) + k)) * (max(NdotL, 0.001) / (max(NdotL, 0.001) * (1.0 - k) + k));
  let Fspec = 0.02 + 0.98 * pow(1.0 - VdotH, 5.0);
  let ggx = min((D * G * Fspec) / max(4.0 * NdotV * max(NdotL, 0.001), 0.001) * NdotL, 10.0);
  var specCol = sunCol * (ggx * worldSun * 1.45);

  if (u.hasWorld != 0u && localLights.info.x > 0u) {
    specCol += evalLocalLights(worldP, n, rd, bodyTint * 0.8, 0.12, 0.0, 0.0);
  }

  // Premultiplied liquid layer: energy-conserving refracted body + Fresnel sky reflection + GGX sun glint.
  var premulRgb = waterBody * (bodyAlpha * (1.0 - fresnel)) + envRefl * fresnel + specCol;
  var outAlpha = clamp(1.0 - bgKeep * (1.0 - fresnel), 0.0, 0.96);

  // Shoreline & obstacle contact foam where waterDepth is shallow, plus turbulent fast-flow churn foam.
  let foamTex = foamField(in.plan, run);
  // Organic wet shoreline feather eliminates jagged column-grid stairs while preserving obstacle contact collars.
  let shoreEdge = smoothstep(0.04, 0.58, edge + (foamTex - 0.5) * 0.34);
  let edgeFeather = shoreEdge * smoothstep(0.0, 0.12, deep);
  // Contact depth catches both vertical obstacles (waterDepth -> 0) and thin spreading shorelines (edge/deep -> 0).
  let obsContact = smoothstep(0.55, 0.0, waterDepth);
  let shoreBand = smoothstep(0.6, 0.0, min(waterDepth * max(abs(rd.y), 0.35), edge * 1.1));
  let contactBand = max(obsContact * 0.85, shoreBand * smoothstep(0.05, 0.30, edge));
  let lapWave = 0.5 + 0.5 * sin(waterDepth * 9.0 - u.time * 4.2 + foamTex * 4.5);
  let shoreFoam = contactBand * smoothstep(0.46, 0.78, foamTex + contactBand * 0.24 + lapWave * 0.14);
  let churn = clamp((fast - 3.6) / 7.5, 0.0, 1.35);
  let churnFoam = clamp(churn, 0.0, 1.0) * smoothstep(0.62 - 0.32 * clamp(churn, 0.0, 1.0), 0.82, foamTex + 0.18 * clamp(churn - 1.0, 0.0, 1.0));
  let foam = clamp(max(shoreFoam * 0.88, churnFoam), 0.0, 1.0);
  let foamLight = skyFill * 0.95 + vec3f(0.14, 0.15, 0.16) * mix(0.04, 1.0, u.day) + sunCol * (0.18 + 0.82 * NdotL) * worldSun;
  let foamCol = vec3f(0.92, 0.97, 1.02) * foamLight;
  let foamAlpha = foam * 0.76;
  premulRgb = foamCol * foamAlpha + premulRgb * (1.0 - foamAlpha);
  outAlpha = foamAlpha + outAlpha * (1.0 - foamAlpha);

  premulRgb *= edgeFeather;
  outAlpha *= edgeFeather;

  // Waterfall sheet: steep drops break into aerated whitewater streaks with transparency between them.
  let fall = clamp(steep * 2.4 - 0.3, 0.0, 1.0);
  if (fall > 0.001) {
    let streak = noise1(vec2f((in.plan.x + in.plan.y) * 1.1, in.high * 0.16 + u.time * 9.0)) * 0.6 + noise1(vec2f((in.plan.x - in.plan.y) * 2.7, in.high * 0.45 + u.time * 15.0)) * 0.4;
    let white = smoothstep(0.30, 0.70, streak);
    let fallCol = mix(vec3f(0.10, 0.38, 0.46), vec3f(0.94, 0.99, 1.05), white) * foamLight;
    let fallAlpha = 0.26 + 0.62 * white;
    premulRgb = mix(premulRgb, fallCol * fallAlpha, fall);
    outAlpha = mix(outAlpha, fallAlpha, fall);
  }
  return vec4f(max(premulRgb, vec3f(0.0)), clamp(outAlpha, 0.0, 1.0));
}
`

export interface Flowing {
  /** What the core told of the water (the words of a FLOW record). */
  set(words: Uint32Array<ArrayBuffer>): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View, time: number): void
  /** Where the light comes from, how much of the day it is, and the colour of the sky it mirrors (as the screen shows it). */
  light(sun: readonly number[], day: number): void
  /** How many columns the last word of it covered: for the checks. */
  readonly columns: number
  /** Places where it lands after a fall (the world's finest cells), a few of them: mist rises there. */
  readonly landings: readonly [number, number, number][]
}

export async function flowing(device: GPUDevice, format: GPUTextureFormat, march?: Marcher): Promise<Flowing> {
  const module = await shader(device, 'water', CODE)
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const ownLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: both, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'uint' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  const worldLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [ownLayout, worldLayout] })
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
  const pipeline = await device.createRenderPipelineAsync({
    label: 'water', layout,
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
  })
  const uniforms = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const dummyGlobals = device.createBuffer({ size: GLOBALS_BYTES, usage: GPUBufferUsage.UNIFORM })
  const dummySun = device.createTexture({ size: [1, 1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING })
  const dummyLights = device.createBuffer({ size: LIGHTS_BYTES, usage: GPUBufferUsage.UNIFORM })
  const fallbackWorldBind = device.createBindGroup({
    layout: worldLayout,
    entries: [
      { binding: 0, resource: { buffer: dummyGlobals } },
      { binding: 1, resource: dummySun.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: { buffer: dummyLights } },
    ],
  })
  let texture: GPUTexture | null = null, heightsView: GPUTextureView | null = null
  let ownBind: { heights: GPUTextureView; depth: GPUTextureView; group: GPUBindGroup } | null = null
  const ownFor = (depth: GPUTextureView) => {
    if (!heightsView) return null
    if (ownBind?.heights !== heightsView || ownBind?.depth !== depth) {
      ownBind = {
        heights: heightsView,
        depth,
        group: device.createBindGroup({
          layout: ownLayout,
          entries: [
            { binding: 0, resource: { buffer: uniforms } },
            { binding: 1, resource: heightsView },
            { binding: 2, resource: depth },
          ],
        }),
      }
    }
    return ownBind.group
  }
  let worldBind: { march: Marcher; group: GPUBindGroup } | null = null
  const worldFor = () => {
    const active = march ?? (globalThis as { engine?: { march?: Marcher } }).engine?.march
    if (!active) return { group: fallbackWorldBind, hasWorld: 0 }
    if (worldBind?.march !== active) {
      worldBind = {
        march: active,
        group: device.createBindGroup({
          layout: worldLayout,
          entries: [
            { binding: 0, resource: { buffer: active.globals } },
            { binding: 1, resource: active.sun.all },
            { binding: 2, resource: { buffer: active.localLights.buffer } },
          ],
        }),
      }
    }
    return { group: worldBind.group, hasWorld: 1 }
  }
  let cells = new Uint32Array(0), side = 0
  // The window as last told: its low corner in the world, the base its tops are over, a column's width, the box of wet ones.
  let low = [0, 0], base = 0, col = 2, box = [0, 0, 0, 0], wet = 0
  let landings: [number, number, number][] = []
  let sun: readonly number[] = [0.52, 0.62, 0.59], day = 1
  const block = new ArrayBuffer(144), f = new Float32Array(block), u = new Uint32Array(block)
  return {
    get columns() { return wet },
    get landings() { return landings },
    light(from, isDay) { sun = from; day = isDay },
    set(words) {
      const i32 = new Int32Array(words.buffer, words.byteOffset, words.length), n = words[3]
      if (n !== side) {
        texture?.destroy()
        side = n
        cells = new Uint32Array(n * n)
        texture = device.createTexture({ size: [n, n], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
        heightsView = texture.createView()
        ownBind = null
      }
      // What was wet is dry unless told again.
      for (let z = box[1]; z < box[1] + box[3]; z++) cells.fill(0, box[0] + side * z, box[0] + box[2] + side * z)
      low = [i32[0], i32[1]]; col = words[2]; base = i32[4]
      box = [words[5], words[6], words[7], words[8]]
      wet = 0
      for (let z = 0; z < box[3]; z++) {
        const row = words.subarray(9 + z * box[2], 9 + (z + 1) * box[2])
        cells.set(row, box[0] + side * (box[1] + z))
        for (const w of row) if (w) wet++
      }
      device.queue.writeTexture({ texture: texture! }, cells, { bytesPerRow: side * 4 }, [side, side])
      // Where it lands: a wet column three metres or more under a wet one beside it. Every seventh, two dozen at most.
      landings = []
      for (let z = box[1] + 1, k = 0; z < box[1] + box[3] - 1 && landings.length < 40; z++) for (let x = box[0] + 1; x < box[0] + box[2] - 1; x++) {
        const w = cells[x + side * z]
        if (!w) continue
        const top = (w & 0x3ffff) / 8, over = Math.max(...[cells[x + 1 + side * z], cells[x - 1 + side * z], cells[x + side * (z + 1)], cells[x + side * (z - 1)]].map((n) => (n ? (n & 0x3ffff) / 8 : 0)))
        if (over - top > 30 && k++ % 7 === 0 && landings.length < 24) landings.push([low[0] + x * col, base + top, low[1] + z * col])
      }
    },
    draw(encoder, to, view, time) {
      if (!wet) return
      const oGroup = ownFor(to.depth)
      if (!oGroup) return
      const { group: wGroup, hasWorld } = worldFor()
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      const sunLength = Math.hypot(sun[0], sun[1], sun[2])
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf], 0)
      f.set([view.right[0], view.right[1], view.right[2], to.size[0] / to.size[1]], 4)
      f.set([view.up[0], view.up[1], view.up[2], time], 8)
      f.set([view.forward[0], view.forward[1], view.forward[2], day], 12)
      f.set([sun[0] / sunLength, sun[1] / sunLength, sun[2] / sunLength, col], 16)
      f.set([low[0] - anchor[0], base - anchor[1], low[1] - anchor[2], to.size[0]], 20)
      u.set(box, 24)
      // Fallback sky colour (linear HDR by day) when no Marcher is bound.
      f.set([0.38, 0.56, 0.82, to.size[1]], 28)
      u[32] = hasWorld; u[33] = 0; u[34] = 0; u[35] = 0
      device.queue.writeBuffer(uniforms, 0, block)
      // No depthStencilAttachment: to.depth is bound as texture_depth_2d for Beer-Lambert depth absorption & contact foam.
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, oGroup)
      pass.setBindGroup(1, wGroup)
      pass.draw(4, box[2] * box[3])
      pass.end()
    },
  }
}
