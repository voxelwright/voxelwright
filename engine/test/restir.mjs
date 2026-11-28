// Real headless Chrome WebGPU verification for engine/page/restir.ts (#165).
//
// Verifies Voxelwright's standalone 3-pass WebGPU ReSTIR-DI compute engine against an exact
// GPU ray-vs-AABB voxel/box scene with 128 dynamic point & spot lights:
//   - Test 1 (Unbiased Convergence vs 128-Light Brute-Force Ground Truth & Zero Wall Bleed):
//       1A: 128 lights on right side of a solid central wall -> zero light bleed (< 1e-4) behind wall.
//       1B: 128 lights across both chambers + occluding wall & pillars -> ReSTIR-DI (16 frames)
//           RMSE drops > 60% vs raw 1-candidate RIS (and vs 16-candidate 1-spp RIS), and mean
//           energy matches 128-light brute-force ground truth within < 10% (unbiased MIS).
//       1C: Optional 3D frustum cluster-grid path executes cleanly with 0 faults / 0 NaN/Inf.
//   - Test 2 (Soft Area-Light Penumbra, Moving Lights + Moving Camera, reset: true):
//       2A: Area light (sourceRadius = 9 cells) past a pillar produces smooth monotonic penumbra.
//       2B: 32 moving lights + moving camera with analytic rg16float motion vectors over 10 frames
//           tracks shadows without stuck ghosts; reset: true clears history immediately; 0 NaN/Inf.
//   - Test 3 (Dynamic Resolution Zero-Realloc & GPU Perf):
//       Cycles renderSize across 0.50x, 0.75x, 1.00x -> reallocs === 0, 0 faults; measures
//       timestamp-query GPU ms (ris + temporal + spatial_shade) at 640x360 and 1280x720 (128 lights).
//
//   node engine/test/restir.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [640, 360], dpr: 1 })
  await page.route('**/probe-restir', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  )
  await page.goto(`${url}/probe-restir`)

  const result = await page.evaluate(async () => {
    const { openGpu, shader, camera, depthFor, NEAR, FAR } = await import('/probe/gpu.ts')
    const {
      createRestirDI,
      createRestirLightBuffer,
      RESTIR_STRUCTS_WGSL,
    } = await import('/page/restir.ts')

    const gpu = await openGpu()
    const { device } = gpu

    // Decode IEEE 754 binary16 -> JS float64 (preserving NaN / Infinity detection).
    const f16ToF32 = (bits) => {
      const sign = (bits & 0x8000) ? -1 : 1
      const exp = (bits >> 10) & 0x1f
      const frac = bits & 0x03ff
      if (exp === 0) return sign * (frac / 1024) * 6.103515625e-5
      if (exp === 31) return frac ? Number.NaN : sign * Number.POSITIVE_INFINITY
      return sign * (1 + frac / 1024) * Math.pow(2, exp - 15)
    }

    const readRgba16 = async (tex, width, height) => {
      const bytesPerRow = Math.ceil((width * 8) / 256) * 256
      const staging = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: staging, bytesPerRow }, [width, height, 1])
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      await staging.mapAsync(GPUMapMode.READ)
      const u16 = new Uint16Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      const rowU16 = bytesPerRow >> 1
      const out = new Float32Array(width * height * 4)
      let nonFinite = 0
      for (let y = 0; y < height; y++) {
        const sRow = y * rowU16
        const dRow = y * width * 4
        for (let x = 0; x < width; x++) {
          const s = sRow + x * 4
          const d = dRow + x * 4
          for (let c = 0; c < 4; c++) {
            const v = f16ToF32(u16[s + c])
            if (!Number.isFinite(v)) nonFinite++
            out[d + c] = v
          }
        }
      }
      return { data: out, nonFinite }
    }

    const readRgba32 = async (tex, width, height) => {
      const bytesPerRow = Math.ceil((width * 16) / 256) * 256
      const staging = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: staging, bytesPerRow }, [width, height, 1])
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      await staging.mapAsync(GPUMapMode.READ)
      const raw = new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      const rowF32 = bytesPerRow >> 2
      const out = new Float32Array(width * height * 4)
      let nonFinite = 0
      for (let y = 0; y < height; y++) {
        const sRow = y * rowF32
        const dRow = y * width * 4
        for (let x = 0; x < width * 4; x++) {
          const v = raw[sRow + x]
          if (!Number.isFinite(v)) nonFinite++
          out[dRow + x] = v
        }
      }
      return { data: out, nonFinite }
    }

    // ── Shared 3D Box / Voxel Occluder Scene (@group(1)) ────────────────────
    // 5 axis-aligned boxes: floor, back wall, solid dividing central wall, left & right pillars.
    // Box layout: 4 x vec4f = 64 bytes: bMin(xyz, rough), bMax(xyz, metal), albedo(rgb, pad)
    const SCENE_BOXES = [
      // 0: Floor (top at y = 0)
      { min: [-220, -4, -220], max: [220, 0, 220], albedo: [0.64, 0.62, 0.60], rough: 0.58, metal: 0.05 },
      // 1: Back wall (front face at z = -132)
      { min: [-220, 0, -140], max: [220, 95, -132], albedo: [0.56, 0.55, 0.58], rough: 0.72, metal: 0.0 },
      // 2: Solid central dividing wall (x in [-4, 4], y in [0, 85], z in [-132, 160])
      { min: [-4, 0, -132], max: [4, 85, 160], albedo: [0.58, 0.54, 0.50], rough: 0.68, metal: 0.0 },
      // 3: Left pillar (casts crisp shadows onto left floor)
      { min: [-54, 0, -46], max: [-42, 60, -34], albedo: [0.50, 0.54, 0.60], rough: 0.45, metal: 0.12 },
      // 4: Right pillar (casts crisp shadows onto right floor)
      { min: [42, 0, -46], max: [54, 60, -34], albedo: [0.60, 0.50, 0.48], rough: 0.45, metal: 0.12 },
    ]
    const BOX_FLOATS = 12 // 3 x vec4f = 48 bytes per box
    const sceneRaw = new ArrayBuffer(16 + SCENE_BOXES.length * BOX_FLOATS * 4)
    const sceneU32 = new Uint32Array(sceneRaw)
    const sceneF32 = new Float32Array(sceneRaw)
    sceneU32[0] = SCENE_BOXES.length
    for (let i = 0; i < SCENE_BOXES.length; i++) {
      const b = SCENE_BOXES[i]
      const o = 4 + i * BOX_FLOATS
      sceneF32[o + 0] = b.min[0]; sceneF32[o + 1] = b.min[1]; sceneF32[o + 2] = b.min[2]; sceneF32[o + 3] = b.rough
      sceneF32[o + 4] = b.max[0]; sceneF32[o + 5] = b.max[1]; sceneF32[o + 6] = b.max[2]; sceneF32[o + 7] = b.metal
      sceneF32[o + 8] = b.albedo[0]; sceneF32[o + 9] = b.albedo[1]; sceneF32[o + 10] = b.albedo[2]; sceneF32[o + 11] = 0
    }
    const sceneBoxBuf = device.createBuffer({
      label: 'restir-test-boxes',
      size: sceneRaw.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(sceneBoxBuf, 0, sceneRaw)

    const occBgl = device.createBindGroupLayout({
      label: 'restir-test-occ-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    })
    const occBg = device.createBindGroup({
      label: 'restir-test-occ-bg',
      layout: occBgl,
      entries: [{ binding: 0, resource: { buffer: sceneBoxBuf } }],
    })

    // Exact ray-vs-AABB shadow ray occlusion snippet injected into ReSTIR-DI via `occlusionWgsl`.
    const OCCLUSION_WGSL = /* wgsl */ `
struct SceneBox {
  bMinRough: vec4f,
  bMaxMetal: vec4f,
  albedoPad: vec4f,
}
struct SceneBoxBuffer {
  info: vec4u,
  boxes: array<SceneBox>,
}
@group(1) @binding(0) var<storage, read> sceneBoxes: SceneBoxBuffer;

fn safeInvDir(d: vec3f) -> vec3f {
  let sx = select(d.x, select(-1e-6, 1e-6, d.x >= 0.0), abs(d.x) < 1e-6);
  let sy = select(d.y, select(-1e-6, 1e-6, d.y >= 0.0), abs(d.y) < 1e-6);
  let sz = select(d.z, select(-1e-6, 1e-6, d.z >= 0.0), abs(d.z) < 1e-6);
  return 1.0 / vec3f(sx, sy, sz);
}

fn traceShadowRay(origin: vec3f, dir: vec3f, maxDist: f32) -> f32 {
  let invD = safeInvDir(dir);
  let count = sceneBoxes.info.x;
  for (var i = 0u; i < count; i++) {
    let b = sceneBoxes.boxes[i];
    let t0 = (b.bMinRough.xyz - origin) * invD;
    let t1 = (b.bMaxMetal.xyz - origin) * invD;
    let tMin = min(t0, t1);
    let tMax = max(t0, t1);
    let tEnter = max(max(tMin.x, tMin.y), tMin.z);
    let tExit = min(min(tMax.x, tMax.y), tMax.z);
    if (tExit > max(tEnter, 1e-3) && tEnter < maxDist) {
      return 0.0;
    }
  }
  return 1.0;
}
`

    // ── Exact GPU G-Buffer Raycaster (writes depth24plus + normal + albedo + material + velocity) ──
    const GBUF_WGSL = /* wgsl */ `
struct GbufUniforms {
  eyeTanHalf: vec4f,
  fwdAspect: vec4f,
  rightNear: vec4f,
  upFar: vec4f,
  prevEyeTanHalf: vec4f,
  prevFwdAspect: vec4f,
  prevRightNear: vec4f,
  prevUpFar: vec4f,
  renderInfo: vec4f,
}
struct SceneBox {
  bMinRough: vec4f,
  bMaxMetal: vec4f,
  albedoPad: vec4f,
}
struct SceneBoxBuffer {
  info: vec4u,
  boxes: array<SceneBox>,
}
@group(0) @binding(0) var<uniform> u: GbufUniforms;
@group(1) @binding(0) var<storage, read> sceneBoxes: SceneBoxBuffer;

struct VsOut {
  @builtin(position) pos: vec4f,
}
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> VsOut {
  let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return VsOut(vec4f(xy[vi], 0.0, 1.0));
}

struct GbufOut {
  @location(0) normal: vec4f,
  @location(1) albedo: vec4f,
  @location(2) material: vec4f,
  @location(3) velocity: vec2f,
  @builtin(frag_depth) depth: f32,
}

fn safeInv3(d: vec3f) -> vec3f {
  let sx = select(d.x, select(-1e-6, 1e-6, d.x >= 0.0), abs(d.x) < 1e-6);
  let sy = select(d.y, select(-1e-6, 1e-6, d.y >= 0.0), abs(d.y) < 1e-6);
  let sz = select(d.z, select(-1e-6, 1e-6, d.z >= 0.0), abs(d.z) < 1e-6);
  return 1.0 / vec3f(sx, sy, sz);
}

@fragment fn fs_gbuf(@builtin(position) fragPos: vec4f) -> GbufOut {
  let uv = fragPos.xy * u.renderInfo.zw;
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  let tanH = u.eyeTanHalf.w;
  let aspect = u.fwdAspect.w;
  let rd = normalize(
    u.fwdAspect.xyz
    + u.rightNear.xyz * (ndcX * tanH * aspect)
    + u.upFar.xyz * (ndcY * tanH)
  );
  let invD = safeInv3(rd);
  let eye = u.eyeTanHalf.xyz;

  var bestT = 1e20;
  var bestN = vec3f(0.0);
  var bestAlb = vec3f(0.0);
  var bestRough = 0.6;
  var bestMetal = 0.0;
  let count = sceneBoxes.info.x;

  for (var i = 0u; i < count; i++) {
    let b = sceneBoxes.boxes[i];
    let t0 = (b.bMinRough.xyz - eye) * invD;
    let t1 = (b.bMaxMetal.xyz - eye) * invD;
    let tMin = min(t0, t1);
    let tMax = max(t0, t1);
    let tEnter = max(max(tMin.x, tMin.y), tMin.z);
    let tExit = min(min(tMax.x, tMax.y), tMax.z);
    if (tExit > max(tEnter, 1e-3) && tEnter > 1e-3 && tEnter < bestT) {
      bestT = tEnter;
      let hitP = eye + rd * tEnter;
      let bC = (b.bMinRough.xyz + b.bMaxMetal.xyz) * 0.5;
      let bE = (b.bMaxMetal.xyz - b.bMinRough.xyz) * 0.5;
      let rel = (hitP - bC) / max(bE, vec3f(1e-4));
      let a = abs(rel);
      if (a.x >= a.y && a.x >= a.z) {
        bestN = vec3f(sign(rel.x), 0.0, 0.0);
      } else if (a.y >= a.x && a.y >= a.z) {
        bestN = vec3f(0.0, sign(rel.y), 0.0);
      } else {
        bestN = vec3f(0.0, 0.0, sign(rel.z));
      }
      bestAlb = b.albedoPad.rgb;
      bestRough = b.bMinRough.w;
      bestMetal = b.bMaxMetal.w;
    }
  }

  if (bestT > 1e10) {
    return GbufOut(vec4f(0.0), vec4f(0.0), vec4f(0.5, 0.0, 0.0, 1.0), vec2f(0.0), 1.0);
  }

  let worldPos = eye + rd * bestT;
  let linearZ = dot(worldPos - eye, u.fwdAspect.xyz);
  let zNear = u.rightNear.w;
  let zFar = u.upFar.w;
  let depthVal = clamp((zFar / (zFar - zNear)) * (1.0 - zNear / max(linearZ, zNear)), 0.0, 0.99998);

  // Exact analytic screen-space motion vector: vel = prevUV - curUV.
  let prevRel = worldPos - u.prevEyeTanHalf.xyz;
  let prevZ = dot(prevRel, u.prevFwdAspect.xyz);
  var vel = vec2f(0.0);
  if (prevZ > 1e-3) {
    let pTan = u.prevEyeTanHalf.w;
    let pAsp = u.prevFwdAspect.w;
    let pNdcX = dot(prevRel, u.prevRightNear.xyz) / (prevZ * pTan * pAsp);
    let pNdcY = dot(prevRel, u.prevUpFar.xyz) / (prevZ * pTan);
    let prevUV = vec2f(pNdcX * 0.5 + 0.5, 0.5 - pNdcY * 0.5);
    vel = prevUV - uv;
  }

  return GbufOut(
    vec4f(bestN, 1.0),
    vec4f(bestAlb, 1.0),
    vec4f(bestRough, bestMetal, 0.0, 1.0),
    vel,
    depthVal,
  );
}
`

    // ── Exact Brute-Force 128-Light Reference Compute Shader ────────────────
    const REF_WGSL = /* wgsl */ `
${RESTIR_STRUCTS_WGSL}
${OCCLUSION_WGSL}

struct RefUniforms {
  eyeTanHalf: vec4f,
  fwdAspect: vec4f,
  rightNear: vec4f,
  upFar: vec4f,
  renderInfo: vec4f,
  counts: vec4u,
  tuning: vec4f,
}

@group(0) @binding(0) var<uniform> u: RefUniforms;
@group(0) @binding(1) var<storage, read> lights: array<ClusterLight>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var albedoTex: texture_2d<f32>;
@group(0) @binding(5) var materialTex: texture_2d<f32>;
@group(0) @binding(6) var outTex: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8, 1)
fn cs_bruteforce_ref(@builtin(global_invocation_id) gid: vec3u) {
  let w = u.counts.x;
  let h = u.counts.y;
  if (gid.x >= w || gid.y >= h) { return; }
  let px = vec2i(i32(gid.x), i32(gid.y));
  let rawD = textureLoad(depthTex, px, 0);
  if (rawD >= 0.99999) {
    textureStore(outTex, px, vec4f(0.0, 0.0, 0.0, 0.0));
    return;
  }
  let zNear = u.rightNear.w;
  let zFar = u.upFar.w;
  let linearZ = zNear / max(1.0 - rawD * ((zFar - zNear) / zFar), 1e-7);
  let uv = (vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5)) * u.renderInfo.zw;
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  let worldPos = u.eyeTanHalf.xyz
    + u.fwdAspect.xyz * linearZ
    + u.rightNear.xyz * (ndcX * linearZ * u.eyeTanHalf.w * u.fwdAspect.w)
    + u.upFar.xyz * (ndcY * linearZ * u.eyeTanHalf.w);
  let rawN = textureLoad(normalTex, px, 0).xyz;
  let nLen = length(rawN);
  if (nLen <= 1e-4) {
    textureStore(outTex, px, vec4f(0.0, 0.0, 0.0, 0.0));
    return;
  }
  let N = rawN / nLen;
  let V = normalize(u.eyeTanHalf.xyz - worldPos);
  let albedo = max(textureLoad(albedoTex, px, 0).rgb, vec3f(0.0));
  let mat = textureLoad(materialTex, px, 0);
  let rough = clamp(mat.r, 0.045, 1.0);
  let metal = clamp(mat.g, 0.0, 1.0);
  let bias = u.tuning.x;

  let lightCount = u.counts.z;
  var sum = vec3f(0.0);
  for (var i = 0u; i < lightCount; i++) {
    let l = lights[i];
    let shaded = evalRestirLightGGX(l, worldPos, N, V, albedo, rough, metal);
    if (restirLuma(shaded) <= 1e-7) { continue; }
    let orig = worldPos + N * bias;
    let toL = l.posRange.xyz - orig;
    let dist = length(toL);
    let maxDist = dist - max(bias * 0.5, 0.02);
    var vis = 1.0;
    if (maxDist > 1e-4) {
      vis = traceShadowRay(orig, toL / dist, maxDist);
    }
    sum += shaded * vis;
  }
  // Store worldPos.x in .a so JS can distinguish left vs right chamber pixels cleanly.
  textureStore(outTex, px, vec4f(sum, worldPos.x));
}
`

    const [gbufMod, refMod] = await Promise.all([
      shader(device, 'restir-test-gbuf', GBUF_WGSL),
      shader(device, 'restir-test-ref', REF_WGSL),
    ])

    const gbufBgl = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    const gbufPipe = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [gbufBgl, occBgl] }),
      vertex: { module: gbufMod, entryPoint: 'vs_full' },
      fragment: {
        module: gbufMod,
        entryPoint: 'fs_gbuf',
        targets: [
          { format: 'rgba16float' },
          { format: 'rgba16float' },
          { format: 'rgba8unorm' },
          { format: 'rg16float' },
        ],
      },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
    })

    const refBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' } },
      ],
    })
    const refPipe = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [refBgl, occBgl] }),
      compute: { module: refMod, entryPoint: 'cs_bruteforce_ref' },
    })

    // Allocate persistent 1280x720 G-buffer textures (reused at 640x360, 960x540, 1280x720).
    const MAX_W = 1280, MAX_H = 720
    const gDepthTex = depthFor(device, [MAX_W, MAX_H])
    const gNormTex = device.createTexture({ size: [MAX_W, MAX_H], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const gAlbTex = device.createTexture({ size: [MAX_W, MAX_H], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const gMatTex = device.createTexture({ size: [MAX_W, MAX_H], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const gVelTex = device.createTexture({ size: [MAX_W, MAX_H], format: 'rg16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const refTex = device.createTexture({ size: [MAX_W, MAX_H], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC })

    const gDepthView = gDepthTex.createView()
    const gNormView = gNormTex.createView()
    const gAlbView = gAlbTex.createView()
    const gMatView = gMatTex.createView()
    const gVelView = gVelTex.createView()
    const refView = refTex.createView()

    const gbufUBuf = device.createBuffer({ size: 9 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const gbufBg = device.createBindGroup({ layout: gbufBgl, entries: [{ binding: 0, resource: { buffer: gbufUBuf } }] })
    const refUBuf = device.createBuffer({ size: 7 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

    const renderGBuffer = (enc, cam, prevCam, w, h) => {
      const f = new Float32Array(36)
      f[0] = cam.eye[0]; f[1] = cam.eye[1]; f[2] = cam.eye[2]; f[3] = cam.tanHalf
      f[4] = cam.forward[0]; f[5] = cam.forward[1]; f[6] = cam.forward[2]; f[7] = cam.aspect
      f[8] = cam.right[0]; f[9] = cam.right[1]; f[10] = cam.right[2]; f[11] = NEAR
      f[12] = cam.up[0]; f[13] = cam.up[1]; f[14] = cam.up[2]; f[15] = FAR
      f[16] = prevCam.eye[0]; f[17] = prevCam.eye[1]; f[18] = prevCam.eye[2]; f[19] = prevCam.tanHalf
      f[20] = prevCam.forward[0]; f[21] = prevCam.forward[1]; f[22] = prevCam.forward[2]; f[23] = prevCam.aspect
      f[24] = prevCam.right[0]; f[25] = prevCam.right[1]; f[26] = prevCam.right[2]; f[27] = NEAR
      f[28] = prevCam.up[0]; f[29] = prevCam.up[1]; f[30] = prevCam.up[2]; f[31] = FAR
      f[32] = w; f[33] = h; f[34] = 1 / w; f[35] = 1 / h
      device.queue.writeBuffer(gbufUBuf, 0, f)
      const rp = enc.beginRenderPass({
        colorAttachments: [
          { view: gNormView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          { view: gAlbView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          { view: gMatView, loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 0, 0, 1] },
          { view: gVelView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ],
        depthStencilAttachment: { view: gDepthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      })
      rp.setViewport(0, 0, w, h, 0, 1)
      rp.setScissorRect(0, 0, w, h)
      rp.setPipeline(gbufPipe)
      rp.setBindGroup(0, gbufBg)
      rp.setBindGroup(1, occBg)
      rp.draw(3)
      rp.end()
    }

    const computeBruteForceRef = async (cam, lightBufObj, w, h) => {
      const raw = new ArrayBuffer(7 * 16)
      const f = new Float32Array(raw)
      const u = new Uint32Array(raw)
      f[0] = cam.eye[0]; f[1] = cam.eye[1]; f[2] = cam.eye[2]; f[3] = cam.tanHalf
      f[4] = cam.forward[0]; f[5] = cam.forward[1]; f[6] = cam.forward[2]; f[7] = cam.aspect
      f[8] = cam.right[0]; f[9] = cam.right[1]; f[10] = cam.right[2]; f[11] = NEAR
      f[12] = cam.up[0]; f[13] = cam.up[1]; f[14] = cam.up[2]; f[15] = FAR
      f[16] = w; f[17] = h; f[18] = 1 / w; f[19] = 1 / h
      u[20] = w; u[21] = h; u[22] = lightBufObj.count; u[23] = 0
      f[24] = 0.15
      device.queue.writeBuffer(refUBuf, 0, raw)
      const bg = device.createBindGroup({
        layout: refBgl,
        entries: [
          { binding: 0, resource: { buffer: refUBuf } },
          { binding: 1, resource: { buffer: lightBufObj.lightsBuffer } },
          { binding: 2, resource: gDepthView },
          { binding: 3, resource: gNormView },
          { binding: 4, resource: gAlbView },
          { binding: 5, resource: gMatView },
          { binding: 6, resource: refView },
        ],
      })
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, cam, cam, w, h)
      const cp = enc.beginComputePass()
      cp.setPipeline(refPipe)
      cp.setBindGroup(0, bg)
      cp.setBindGroup(1, occBg)
      cp.dispatchWorkgroups((w + 7) >> 3, (h + 7) >> 3)
      cp.end()
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      return readRgba32(refTex, w, h)
    }

    // Deterministic PRNG (Mulberry32) for reproducible 128-light layout.
    let rngSeed = 0x165b3301
    const rand = () => {
      rngSeed = (rngSeed + 0x6d2b79f5) >>> 0
      let t = Math.imul(rngSeed ^ (rngSeed >>> 15), 1 | rngSeed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    const makeCam = (eye, target, aspect = 16 / 9) => ({ ...camera(eye, target, 58), aspect })

    const restir = await createRestirDI(device, {
      maxSize: [MAX_W, MAX_H],
      initialCandidates: 16,
      maxTemporalM: 20,
      spatialNeighbors: 4,
      spatialRadius: 18,
      shadowBias: 0.15,
      occlusionWgsl: OCCLUSION_WGSL,
      occlusionBindGroupLayout: occBgl,
    })

    const lightStore = createRestirLightBuffer(device, 256)
    const W1 = 640, H1 = 360
    const mainCam = makeCam([0, 74, 128], [0, 8, -28], W1 / H1)

    // ── Test 1A: Strict Zero Wall Light Bleed (128 lights ONLY on Right side x > 18) ──
    lightStore.beginFrame()
    for (let i = 0; i < 128; i++) {
      const px = 20 + rand() * 110
      const py = 10 + rand() * 38
      const pz = -115 + rand() * 145
      const r = 900 + rand() * 1200
      const g = 600 + rand() * 1100
      const b = 350 + rand() * 900
      const range = 140 + rand() * 140
      if (i % 3 === 0) {
        lightStore.addSpot(px, py, pz, -0.35 + rand() * 0.7, -1.0, -0.35 + rand() * 0.7, r * 1.4, g * 1.4, b * 1.4, range, 0.35, 0.78)
      } else {
        lightStore.addPoint(px, py, pz, r, g, b, range)
      }
    }
    lightStore.upload()

    const bleedRef = await computeBruteForceRef(mainCam, lightStore, W1, H1)
    for (let f = 0; f < 16; f++) {
      const enc = device.createCommandEncoder()
      if (f === 0) renderGBuffer(enc, mainCam, mainCam, W1, H1)
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        aliasBuffer: lightStore.aliasBuffer,
        lightCount: lightStore.count,
        occlusionBindGroup: occBg,
        camera: mainCam,
        renderSize: [W1, H1],
        reset: f === 0,
        frameIndex: f,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const bleedOut = await readRgba16(restir.outputTexture, W1, H1)
    let leftChamberPixels = 0
    let rightLitPixels = 0
    let maxWallBleed = 0
    for (let i = 0; i < W1 * H1; i++) {
      const o = i * 4
      const worldX = bleedRef.data[o + 3]
      const refL = bleedRef.data[o] * 0.2126 + bleedRef.data[o + 1] * 0.7152 + bleedRef.data[o + 2] * 0.0722
      const outL = bleedOut.data[o] * 0.2126 + bleedOut.data[o + 1] * 0.7152 + bleedOut.data[o + 2] * 0.0722
      // Left chamber (strictly behind the solid wall x in [-4, 4]): refL == 0.
      if (worldX < -6.0 && refL < 1e-6) {
        leftChamberPixels++
        maxWallBleed = Math.max(maxWallBleed, outL, bleedOut.data[o], bleedOut.data[o + 1], bleedOut.data[o + 2])
      }
      if (worldX > 8.0 && outL > 0.02) rightLitPixels++
    }

    // ── Test 1B: 128-Light Unbiased Convergence vs Brute-Force Reference ─────
    lightStore.beginFrame()
    for (let i = 0; i < 128; i++) {
      const side = i < 64 ? -1 : 1
      const px = side * (16 + rand() * 105)
      const py = 10 + rand() * 38
      const pz = -118 + rand() * 150
      const warm = (i & 1) === 0
      const power = 650 + rand() * 950
      const r = warm ? power : power * 0.45
      const g = warm ? power * 0.78 : power * 0.76
      const b = warm ? power * 0.42 : power * 1.15
      const range = 110 + rand() * 130
      if (i % 4 === 0) {
        lightStore.addSpot(px, py, pz, (rand() - 0.5) * 0.5, -1.0, (rand() - 0.5) * 0.5, r * 1.5, g * 1.5, b * 1.5, range, 0.4, 0.8)
      } else {
        lightStore.addPoint(px, py, pz, r, g, b, range)
      }
    }
    lightStore.upload()

    const ref128 = await computeBruteForceRef(mainCam, lightStore, W1, H1)

    // Raw 1-candidate RIS (no temporal, no spatial)
    {
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, mainCam, mainCam, W1, H1)
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        aliasBuffer: lightStore.aliasBuffer,
        lightCount: lightStore.count,
        occlusionBindGroup: occBg,
        camera: mainCam,
        renderSize: [W1, H1],
        initialCandidates: 1,
        enableTemporal: false,
        enableSpatial: false,
        reset: true,
        frameIndex: 100,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const raw1Out = await readRgba16(restir.outputTexture, W1, H1)

    // 16-candidate 1-spp RIS (no temporal, no spatial)
    {
      const enc = device.createCommandEncoder()
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        aliasBuffer: lightStore.aliasBuffer,
        lightCount: lightStore.count,
        occlusionBindGroup: occBg,
        camera: mainCam,
        renderSize: [W1, H1],
        initialCandidates: 16,
        enableTemporal: false,
        enableSpatial: false,
        reset: true,
        frameIndex: 101,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const ris16Out = await readRgba16(restir.outputTexture, W1, H1)

    // Full ReSTIR-DI (16-candidate RIS + temporal + spatial reuse over 16 frames)
    for (let f = 0; f < 16; f++) {
      const enc = device.createCommandEncoder()
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        aliasBuffer: lightStore.aliasBuffer,
        lightCount: lightStore.count,
        occlusionBindGroup: occBg,
        camera: mainCam,
        renderSize: [W1, H1],
        initialCandidates: 16,
        enableTemporal: true,
        enableSpatial: true,
        reset: f === 0,
        frameIndex: 200 + f,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const restir16Out = await readRgba16(restir.outputTexture, W1, H1)

    const evalStats = (est, ref) => {
      let sqErr = 0, sumEst = 0, sumRef = 0, count = 0
      for (let i = 0; i < W1 * H1; i++) {
        const o = i * 4
        const rr = ref[o], rg = ref[o + 1], rb = ref[o + 2]
        const refL = rr * 0.2126 + rg * 0.7152 + rb * 0.0722
        if (refL <= 1e-4) continue
        const er = est[o], eg = est[o + 1], eb = est[o + 2]
        const dr = er - rr, dg = eg - rg, db = eb - rb
        sqErr += (dr * dr + dg * dg + db * db) / 3
        sumEst += er * 0.2126 + eg * 0.7152 + eb * 0.0722
        sumRef += refL
        count++
      }
      return {
        litPixels: count,
        rmse: Math.sqrt(sqErr / Math.max(count, 1)),
        meanEst: sumEst / Math.max(count, 1),
        meanRef: sumRef / Math.max(count, 1),
        energyRatio: sumEst / Math.max(sumRef, 1e-9),
      }
    }
    const statsRaw1 = evalStats(raw1Out.data, ref128.data)
    const statsRis16 = evalStats(ris16Out.data, ref128.data)
    const statsRestir = evalStats(restir16Out.data, ref128.data)
    const rmseDropVsRaw1 = 1 - statsRestir.rmse / Math.max(statsRaw1.rmse, 1e-9)
    const rmseDropVsRis16 = 1 - statsRestir.rmse / Math.max(statsRis16.rmse, 1e-9)

    // ── Test 1C: Optional 3D Cluster Grid Path Verification ──────────────────
    const clusterGridData = new Uint32Array(16 * 9 * 24 * 2)
    const clusterIdxData = new Uint32Array(128)
    for (let i = 0; i < 128; i++) clusterIdxData[i] = i
    for (let c = 0; c < 16 * 9 * 24; c++) {
      clusterGridData[c * 2] = 0
      clusterGridData[c * 2 + 1] = 128
    }
    const clusterGridBuf = device.createBuffer({ size: clusterGridData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    const clusterIdxBuf = device.createBuffer({ size: clusterIdxData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(clusterGridBuf, 0, clusterGridData)
    device.queue.writeBuffer(clusterIdxBuf, 0, clusterIdxData)
    {
      const enc = device.createCommandEncoder()
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        lightCount: lightStore.count,
        cluster: { gridBuffer: clusterGridBuf, indexBuffer: clusterIdxBuf, indexPoolCapacity: 128 },
        occlusionBindGroup: occBg,
        camera: mainCam,
        renderSize: [W1, H1],
        reset: true,
        frameIndex: 250,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const clusterOut = await readRgba16(restir.outputTexture, W1, H1)
    let clusterMeanL = 0
    for (let i = 0; i < W1 * H1; i++) {
      const o = i * 4
      clusterMeanL += clusterOut.data[o] * 0.2126 + clusterOut.data[o + 1] * 0.7152 + clusterOut.data[o + 2] * 0.0722
    }
    clusterMeanL /= W1 * H1
    clusterGridBuf.destroy()
    clusterIdxBuf.destroy()

    // ── Test 2A: Soft Penumbra from Area Light (`sourceRadius = 9 cells`) ────
    // Camera looks straight down-ish at the left pillar's shadow edge on the floor.
    // Pillar spans x in [-54, -42], z in [-46, -34], y in [0, 60].
    // Area light at (-92, 26, -40) with sourceRadius = 9.0 casts shadow across x in [-40, -10], z ~ -40:
    //   z in [-44, -36] is deep umbra; z transitions across penumbra around z = -34..-24 and z = -46..-56;
    //   z > -16 is fully lit open floor!
    const penumbraCam = makeCam([-26, 65, -20], [-28, 0, -40], W1 / H1)
    lightStore.beginFrame()
    lightStore.addPoint(-92, 26, -40, 26000, 22000, 17000, 260, 9.0)
    lightStore.upload()
    for (let f = 0; f < 16; f++) {
      const enc = device.createCommandEncoder()
      if (f === 0) renderGBuffer(enc, penumbraCam, penumbraCam, W1, H1)
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        aliasBuffer: lightStore.aliasBuffer,
        lightCount: lightStore.count,
        occlusionBindGroup: occBg,
        camera: penumbraCam,
        renderSize: [W1, H1],
        spatialRadius: 12,
        reset: f === 0,
        frameIndex: 300 + f,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const penOut = await readRgba16(restir.outputTexture, W1, H1)

    // Sample vertical scanline at x = W1 / 2 (center column along floor at world x ~ -27)
    // going from y = 140 (behind pillar, umbra) toward y = 330 (toward camera, open lit floor).
    const samplePatchL = (buf, cx, cy, r = 3) => {
      let s = 0, n = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = Math.max(0, Math.min(W1 - 1, cx + dx))
          const py = Math.max(0, Math.min(H1 - 1, cy + dy))
          const o = (py * W1 + px) * 4
          s += buf[o] * 0.2126 + buf[o + 1] * 0.7152 + buf[o + 2] * 0.0722
          n++
        }
      }
      return s / n
    }
    const scanY = []
    for (let y = 120; y <= 340; y += 8) {
      scanY.push({ y, l: samplePatchL(penOut.data, W1 >> 1, y, 2) })
    }
    const penMin = Math.min(...scanY.map((s) => s.l))
    const penMax = Math.max(...scanY.map((s) => s.l))
    const penMidCount = scanY.filter((s) => s.l > penMax * 0.12 && s.l < penMax * 0.88).length

    // ── Test 2B: Moving Lights + Moving Camera (10 frames) + reset: true ────
    const buildMovingLights = (step) => {
      const t = step / 9 // 0 -> 1 over 10 frames
      lightStore.beginFrame()
      // Primary moving bright light sweeping Z from -70 to -10 past left pillar ([-54..-42, -46..-34])
      // so the pillar's shadow sweeps cleanly across the left floor!
      const primaryZ = -70 + t * 60
      lightStore.addPoint(-95, 24, primaryZ, 24000, 19500, 13500, 240, 2.0)
      // 31 additional moving/orbiting dynamic lights across both chambers
      for (let i = 1; i < 32; i++) {
        const side = i < 16 ? -1 : 1
        const ang = i * 0.85 + t * 1.1
        const px = side * (28 + ((i * 19) % 75)) + Math.cos(ang) * 14
        const py = 12 + ((i * 11) % 30)
        const pz = -95 + ((i * 23) % 120) + Math.sin(ang) * 16
        lightStore.addPoint(px, py, pz, 900, 720, 520, 130, 0)
      }
      lightStore.upload()
    }
    const movingCamFor = (step) => {
      const t = step / 9
      const eye = [-4 + t * 18, 70 - t * 6, 122 - t * 18]
      const target = [-12 + t * 8, 8, -32]
      return makeCam(eye, target, W1 / H1)
    }

    let motionNonFinite = 0
    let prevCamM = movingCamFor(0)
    for (let step = 0; step < 10; step++) {
      const curCamM = movingCamFor(step)
      buildMovingLights(step)
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, curCamM, prevCamM, W1, H1)
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        aliasBuffer: lightStore.aliasBuffer,
        lightCount: lightStore.count,
        occlusionBindGroup: occBg,
        camera: curCamM,
        renderSize: [W1, H1],
        reset: step === 0,
        frameIndex: 400 + step,
      })
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      prevCamM = curCamM
      if (step === 4 || step === 9) {
        const snap = await readRgba16(restir.outputTexture, W1, H1)
        motionNonFinite += snap.nonFinite
      }
    }
    const frame9Out = await readRgba16(restir.outputTexture, W1, H1)
    motionNonFinite += frame9Out.nonFinite
    const cam9 = movingCamFor(9)
    // Compare frame 9 against exact frame-9 brute-force reference (with the primary light alone + all 32)
    const refFrame9 = await computeBruteForceRef(cam9, lightStore, W1, H1)
    const statsMove9 = evalStats(frame9Out.data, refFrame9.data)

    // Specifically verify no stuck ghost shadow on a pure 1-moving-light sweep across the pillar:
    // Step 0..9 moves 1 bright light from z=-75 to z=-5; compare shadow pixels at frame 9 vs ref!
    let ghostShadowDarkness = 1
    let newShadowDarkness = 1
    {
      const sweepCam = makeCam([-18, 68, 45], [-28, 0, -40], W1 / H1)
      const setSweepLight = (step) => {
        lightStore.beginFrame()
        lightStore.addPoint(-95, 22, -75 + (step / 9) * 70, 26000, 22000, 16000, 260, 0)
        lightStore.upload()
      }
      // Compute frame-0 reference to find pixels that WERE in shadow at frame 0.
      setSweepLight(0)
      const sweepRef0 = await computeBruteForceRef(sweepCam, lightStore, W1, H1)
      // Run 10 frames of ReSTIR-DI as light sweeps from z=-75 to z=-5.
      for (let step = 0; step < 10; step++) {
        setSweepLight(step)
        const enc = device.createCommandEncoder()
        if (step === 0) renderGBuffer(enc, sweepCam, sweepCam, W1, H1)
        restir.dispatch(enc, {
          depth: gDepthView,
          normal: gNormView,
          albedo: gAlbView,
          material: gMatView,
          velocity: gVelView,
          lightsBuffer: lightStore.lightsBuffer,
          aliasBuffer: lightStore.aliasBuffer,
          lightCount: lightStore.count,
          occlusionBindGroup: occBg,
          camera: sweepCam,
          renderSize: [W1, H1],
          reset: step === 0,
          frameIndex: 500 + step,
        })
        device.queue.submit([enc.finish()])
      }
      await device.queue.onSubmittedWorkDone()
      const sweepOut9 = await readRgba16(restir.outputTexture, W1, H1)
      motionNonFinite += sweepOut9.nonFinite
      // Compute frame-9 reference (light at z=-5).
      const sweepRef9 = await computeBruteForceRef(sweepCam, lightStore, W1, H1)

      let oldShadowNowLitSum = 0, oldShadowNowLitRef = 0
      let newShadowSum = 0, newShadowCount = 0
      let litMax = 0
      for (let i = 0; i < W1 * H1; i++) {
        const o = i * 4
        const r0 = sweepRef0.data[o] * 0.2126 + sweepRef0.data[o + 1] * 0.7152 + sweepRef0.data[o + 2] * 0.0722
        const r9 = sweepRef9.data[o] * 0.2126 + sweepRef9.data[o + 1] * 0.7152 + sweepRef9.data[o + 2] * 0.0722
        const e9 = sweepOut9.data[o] * 0.2126 + sweepOut9.data[o + 1] * 0.7152 + sweepOut9.data[o + 2] * 0.0722
        const worldX = sweepRef9.data[o + 3]
        if (worldX >= -6.0) continue // only inspect left chamber floor
        if (r9 > litMax) litMax = r9
        // Region that was shadowed at frame 0 (r0 < 0.01) and is now brightly lit at frame 9 (r9 > 0.25)
        if (r0 < 0.01 && r9 > 0.25) {
          oldShadowNowLitSum += e9
          oldShadowNowLitRef += r9
        }
        // Region that was brightly lit at frame 0 (r0 > 0.25) and is now shadowed at frame 9 (r9 < 0.005)
        if (r0 > 0.25 && r9 < 0.005) {
          newShadowSum += e9
          newShadowCount++
        }
      }
      ghostShadowDarkness = oldShadowNowLitSum / Math.max(oldShadowNowLitRef, 1e-6)
      newShadowDarkness = (newShadowSum / Math.max(newShadowCount, 1)) / Math.max(litMax, 1e-6)
    }

    // Verify `reset: true` clears temporal history immediately.
    const resetsBefore = restir.stats().resets
    {
      const enc = device.createCommandEncoder()
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        lightCount: 0,
        occlusionBindGroup: occBg,
        camera: cam9,
        renderSize: [W1, H1],
        reset: true,
        frameIndex: 600,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const resetOut = await readRgba16(restir.outputTexture, W1, H1)
    let resetMaxVal = 0
    for (let i = 0; i < W1 * H1; i++) {
      const o = i * 4
      resetMaxVal = Math.max(resetMaxVal, Math.abs(resetOut.data[o]), Math.abs(resetOut.data[o + 1]), Math.abs(resetOut.data[o + 2]))
    }
    const resetsAfter = restir.stats().resets

    // ── Test 3: Dynamic Resolution (0.50x, 0.75x, 1.00x -> 0 reallocs) & GPU Timing ──
    // Repopulate 128 lights for realistic dynamic-res & GPU perf benchmarking.
    lightStore.beginFrame()
    for (let i = 0; i < 128; i++) {
      const side = i < 64 ? -1 : 1
      const px = side * (16 + rand() * 105)
      const py = 10 + rand() * 38
      const pz = -118 + rand() * 150
      const power = 700 + rand() * 900
      if (i % 4 === 0) {
        lightStore.addSpot(px, py, pz, (rand() - 0.5) * 0.4, -1.0, (rand() - 0.5) * 0.4, power, power * 0.85, power * 0.6, 170, 0.4, 0.8)
      } else {
        lightStore.addPoint(px, py, pz, power, power * 0.82, power * 0.58, 160)
      }
    }
    lightStore.upload()

    const scales = [
      [640, 360],
      [960, 540],
      [1280, 720],
      [960, 540],
      [640, 360],
    ]
    let dynNonFinite = 0
    for (let s = 0; s < scales.length; s++) {
      const [sw, sh] = scales[s]
      const c = makeCam([0, 74, 128], [0, 8, -28], sw / sh)
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, c, c, sw, sh)
      restir.dispatch(enc, {
        depth: gDepthView,
        normal: gNormView,
        albedo: gAlbView,
        material: gMatView,
        velocity: gVelView,
        lightsBuffer: lightStore.lightsBuffer,
        aliasBuffer: lightStore.aliasBuffer,
        lightCount: lightStore.count,
        occlusionBindGroup: occBg,
        camera: c,
        renderSize: [sw, sh],
        reset: s === 0,
        frameIndex: 700 + s,
      })
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      const snap = await readRgba16(restir.outputTexture, sw, sh)
      dynNonFinite += snap.nonFinite
    }
    const reallocsAfterDyn = restir.stats().reallocs

    const measureGpuTime = async (w, h) => {
      const c = makeCam([0, 74, 128], [0, 8, -28], w / h)
      // Render G-Buffer once and warm up 4 frames
      {
        const enc = device.createCommandEncoder()
        renderGBuffer(enc, c, c, w, h)
        device.queue.submit([enc.finish()])
      }
      for (let i = 0; i < 4; i++) {
        const enc = device.createCommandEncoder()
        restir.dispatch(enc, {
          depth: gDepthView,
          normal: gNormView,
          albedo: gAlbView,
          material: gMatView,
          velocity: gVelView,
          lightsBuffer: lightStore.lightsBuffer,
          aliasBuffer: lightStore.aliasBuffer,
          lightCount: lightStore.count,
          occlusionBindGroup: occBg,
          camera: c,
          renderSize: [w, h],
          reset: i === 0,
          frameIndex: 800 + i,
        })
        device.queue.submit([enc.finish()])
      }
      await device.queue.onSubmittedWorkDone()

      if (!gpu.canTime) return null
      const qs = device.createQuerySet({ type: 'timestamp', count: 6 })
      const resolved = device.createBuffer({ size: 48, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const qRead = device.createBuffer({ size: 48, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const risSamples = [], tempSamples = [], spatSamples = [], totSamples = []
      for (let i = 0; i < 15; i++) {
        const enc = device.createCommandEncoder()
        restir.dispatch(
          enc,
          {
            depth: gDepthView,
            normal: gNormView,
            albedo: gAlbView,
            material: gMatView,
            velocity: gVelView,
            lightsBuffer: lightStore.lightsBuffer,
            aliasBuffer: lightStore.aliasBuffer,
            lightCount: lightStore.count,
            occlusionBindGroup: occBg,
            camera: c,
            renderSize: [w, h],
            frameIndex: 900 + i,
          },
          {
            ris: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
            temporal: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
            spatialShade: { querySet: qs, beginningOfPassWriteIndex: 4, endOfPassWriteIndex: 5 },
          },
        )
        enc.resolveQuerySet(qs, 0, 6, resolved, 0)
        enc.copyBufferToBuffer(resolved, 0, qRead, 0, 48)
        device.queue.submit([enc.finish()])
        await qRead.mapAsync(GPUMapMode.READ)
        const ts = new BigUint64Array(qRead.getMappedRange().slice(0))
        qRead.unmap()
        if (ts[1] > ts[0] && ts[3] > ts[2] && ts[5] > ts[4]) {
          const rMs = Number(ts[1] - ts[0]) / 1e6
          const tMs = Number(ts[3] - ts[2]) / 1e6
          const sMs = Number(ts[5] - ts[4]) / 1e6
          risSamples.push(rMs)
          tempSamples.push(tMs)
          spatSamples.push(sMs)
          totSamples.push(rMs + tMs + sMs)
        }
      }
      qs.destroy(); resolved.destroy(); qRead.destroy()
      const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null }
      return {
        risMs: med(risSamples),
        temporalMs: med(tempSamples),
        spatialMs: med(spatSamples),
        totalMs: med(totSamples),
      }
    }

    const perf360 = await measureGpuTime(640, 360)
    const perf720 = await measureGpuTime(1280, 720)
    const finalStats = restir.stats()
    const faults = [...gpu.faults]

    // Cleanup GPU resources
    restir.destroy()
    lightStore.destroy()
    sceneBoxBuf.destroy()
    gbufUBuf.destroy()
    refUBuf.destroy()
    gDepthTex.destroy()
    gNormTex.destroy()
    gAlbTex.destroy()
    gMatTex.destroy()
    gVelTex.destroy()
    refTex.destroy()

    return {
      adapter: gpu.adapter.info ? `${gpu.adapter.info.vendor} ${gpu.adapter.info.architecture}` : 'unknown',
      canTime: gpu.canTime,
      faults,
      finalStats,
      test1A: {
        nonFinite: bleedOut.nonFinite,
        leftChamberPixels,
        rightLitPixels,
        maxWallBleed,
      },
      test1B: {
        nonFinite: raw1Out.nonFinite + ris16Out.nonFinite + restir16Out.nonFinite + ref128.nonFinite,
        statsRaw1,
        statsRis16,
        statsRestir,
        rmseDropVsRaw1,
        rmseDropVsRis16,
      },
      test1C: {
        nonFinite: clusterOut.nonFinite,
        clusterMeanL,
      },
      test2: {
        penNonFinite: penOut.nonFinite,
        penMin,
        penMax,
        penMidCount,
        motionNonFinite,
        move9EnergyRatio: statsMove9.energyRatio,
        ghostShadowRecovery: ghostShadowDarkness,
        newShadowDarkness,
        resetNonFinite: resetOut.nonFinite,
        resetMaxVal,
        resetsDelta: resetsAfter - resetsBefore,
      },
      test3: {
        dynNonFinite,
        reallocsAfterDyn,
        perf360,
        perf720,
      },
    }
  })

  console.log(`GPU: ${result.adapter} · capacity ${result.finalStats.capacity.join('x')} · reservoirPool ${(result.finalStats.reservoirBytes / (1024 * 1024)).toFixed(2)} MiB`)
  check(result.faults.length === 0, `zero WebGPU uncaptured errors (${result.faults.join('; ') || 'clean'})`)

  // Test 1A: Zero wall light bleed
  const t1a = result.test1A
  check(
    t1a.nonFinite === 0 && t1a.leftChamberPixels > 10000 && t1a.rightLitPixels > 10000 && t1a.maxWallBleed < 1e-4,
    `Test 1A zero wall light bleed (${t1a.leftChamberPixels} occluded px, ${t1a.rightLitPixels} lit px): maxBleed=${t1a.maxWallBleed.toExponential(2)} (< 1e-4)`,
  )

  // Test 1B: 128-light unbiased convergence vs brute-force reference
  const t1b = result.test1B
  check(
    t1b.nonFinite === 0 && t1b.statsRestir.litPixels > 30000,
    `Test 1B 128-light scene finite (${t1b.statsRestir.litPixels} lit px, nonFinite=${t1b.nonFinite})`,
  )
  check(
    t1b.rmseDropVsRaw1 > 0.60 && t1b.rmseDropVsRis16 > 0.60,
    `Test 1B RMSE convergence (16f ReSTIR-DI=${t1b.statsRestir.rmse.toFixed(4)} vs 1-cand RIS=${t1b.statsRaw1.rmse.toFixed(4)} [-${(t1b.rmseDropVsRaw1 * 100).toFixed(1)}%], vs 16-cand 1-spp=${t1b.statsRis16.rmse.toFixed(4)} [-${(t1b.rmseDropVsRis16 * 100).toFixed(1)}%])`,
  )
  check(
    Math.abs(t1b.statsRestir.energyRatio - 1.0) < 0.10,
    `Test 1B unbiased MIS energy ratio vs 128-light brute force: ${t1b.statsRestir.energyRatio.toFixed(4)} (mean est=${t1b.statsRestir.meanEst.toFixed(4)} vs ref=${t1b.statsRestir.meanRef.toFixed(4)}, err=${(Math.abs(t1b.statsRestir.energyRatio - 1) * 100).toFixed(2)}% < 10%)`,
  )

  // Test 1C: 3D cluster grid path
  check(
    result.test1C.nonFinite === 0 && result.test1C.clusterMeanL > 0.01,
    `Test 1C optional 3D cluster grid path: meanL=${result.test1C.clusterMeanL.toFixed(4)}, nonFinite=${result.test1C.nonFinite}`,
  )

  // Test 2: Soft penumbra, moving lights + camera motion vectors, reset: true
  const t2 = result.test2
  check(
    t2.penNonFinite === 0 && t2.penMax > 0.05 && t2.penMin < t2.penMax * 0.03 && t2.penMidCount >= 2,
    `Test 2A soft area-light penumbra (sourceRadius=9 cells): umbra=${t2.penMin.toFixed(4)}, lit=${t2.penMax.toFixed(4)}, penumbraSamples=${t2.penMidCount}`,
  )
  check(
    t2.motionNonFinite === 0 && Math.abs(t2.move9EnergyRatio - 1.0) < 0.25 && t2.ghostShadowRecovery > 0.55 && t2.newShadowDarkness < 0.05,
    `Test 2B moving lights + camera motion (10 frames): newShadow=${(t2.newShadowDarkness * 100).toFixed(2)}% (< 5%), oldShadowRecovery=${(t2.ghostShadowRecovery * 100).toFixed(1)}% (> 55%), move9Energy=${t2.move9EnergyRatio.toFixed(3)}, nonFinite=${t2.motionNonFinite}`,
  )
  check(
    t2.resetNonFinite === 0 && t2.resetMaxVal === 0 && t2.resetsDelta === 1,
    `Test 2C reset: true clears temporal reservoirs immediately (maxVal=${t2.resetMaxVal}, resetsDelta=${t2.resetsDelta})`,
  )

  // Test 3: Dynamic resolution zero reallocs & GPU perf
  const t3 = result.test3
  check(
    t3.dynNonFinite === 0 && t3.reallocsAfterDyn === 0 && result.finalStats.reallocs === 0,
    `Test 3A dynamic resolution (0.50x/0.75x/1.00x): reallocs=${result.finalStats.reallocs}, nonFinite=${t3.dynNonFinite}`,
  )
  const fmtPerf = (p) =>
    p ? `${p.totalMs.toFixed(3)} ms (ris=${p.risMs.toFixed(3)} + temporal=${p.temporalMs.toFixed(3)} + spatial=${p.spatialMs.toFixed(3)})` : 'n/a'
  check(
    result.canTime && t3.perf360 !== null && t3.perf720 !== null && t3.perf360.totalMs > 0 && t3.perf720.totalMs > 0,
    `Test 3B GPU timestamp-query (128 lights): 640x360=${fmtPerf(t3.perf360)}; 1280x720=${fmtPerf(t3.perf720)}`,
  )
} catch (e) {
  failures.push(String(e?.stack ?? e))
}

await finish('restir')
