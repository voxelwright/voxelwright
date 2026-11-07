// Probe for .agents/skills/tsl-stylised-post. Serve the repo root (python3 -m http.server 5375),
// open /.agents/skills/tsl-stylised-post/probe/index.html?look=pixel|pixelpass|comic|neon|paint|none
import * as THREE from 'three/webgpu'
import {
  pass, mrt, output, normalView, renderOutput, convertToTexture, uniform, uniformArray, vec2, vec3, vec4, float, int, uint,
  Fn, Loop, If, uvec2, uv, screenSize, screenCoordinate, textureSize, floor, fract, length, mix, step, smoothstep, sin, cos, min, max,
  velocity, dot, luminance, perspectiveDepthToViewZ, viewZToOrthographicDepth, cameraNear, cameraFar, sqrt, abs, metalness, roughness, time,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js'

const q = new URLSearchParams(location.search)
const look = q.get('look') ?? 'pixel'
const TARGET_H = Number(q.get('h') ?? 180)

const renderer = new THREE.WebGPURenderer({ antialias: false })
renderer.setPixelRatio(Number(q.get('dpr') ?? devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.append(renderer.domElement)
await renderer.init()

const scene = new THREE.Scene()
scene.background = new THREE.Color(look === 'neon' ? 0x05030a : 0x8fb4d8)
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 60)
camera.position.set(4, 3.2, 6); camera.lookAt(0, 0.6, 0)
const floorMat = new THREE.MeshStandardMaterial({ color: look === 'neon' ? 0x14121c : 0xc9b79a, roughness: look === 'neon' ? 0.12 : 0.8, metalness: look === 'neon' ? 0.6 : 0 })
const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat); floorMesh.rotation.x = -Math.PI / 2; scene.add(floorMesh)
const boxes = []
for (const [x, z, c] of [[-1.5, 0, 0xd2574a], [0.4, -1, 0x4a8fd2], [1.6, 0.8, 0x6bbf6a]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1 + Math.abs(x) * 0.3, 1), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }))
  m.position.set(x, 0.5 + Math.abs(x) * 0.15, z); scene.add(m); boxes.push(m)
}
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 16), new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.4 })); ball.position.set(-0.3, 0.6, 1.4); scene.add(ball)
if (look === 'neon') {
  for (const [x, c] of [[-2.4, 0xff2bd6], [2.4, 0x21f0ff]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 6 }))
    t.position.set(x, 1.3, -1.2); scene.add(t)
    const l = new THREE.PointLight(c, 40, 8); l.position.set(x, 1.3, -0.6); scene.add(l)
  }
} else {
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(3, 6, 2); scene.add(sun); scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x6a5a48, 0.8))
}

// ---- shared helpers -------------------------------------------------------------
const bayer4 = Fn(([p]) => { // p: integer pixel coords (uvec2) -> 0..15/16, ordered 4x4 Bayer
  const x = p.x.bitAnd(3), y = p.y.bitAnd(3), z = x.bitXor(y)
  const idx = z.bitAnd(1).shiftLeft(3).bitOr(y.bitAnd(1).shiftLeft(2)).bitOr(z.shiftRight(1).bitAnd(1).shiftLeft(1)).bitOr(y.shiftRight(1).bitAnd(1))
  return float(idx).add(0.5).div(16)
})
const PALETTE = [ // 16 colours, sRGB hex (display space)
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
].map((h) => new THREE.Color().setStyle(h, THREE.SRGBColorSpace)) // Color stores linear; read back as sRGB below
// getRGB with SRGBColorSpace returns display values:
const dispRGB = PALETTE.map((c) => { const o = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace); return new THREE.Vector3(o.r, o.g, o.b) })
const palette = uniformArray(dispRGB, 'vec3')
const nearestPalette = Fn(([c]) => {
  const best = vec3(0).toVar(), bestD = float(1e9).toVar()
  Loop(PALETTE.length, ({ i }) => {
    const p = palette.element(i), d = c.sub(p).dot(c.sub(p))
    If(d.lessThan(bestD), () => { bestD.assign(d); best.assign(p) })
  })
  return best
})

let finalNode, onResize = () => {}

if (look === 'pixel') {
  const sp = pass(scene, camera, { samples: 0, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
  onResize = () => { const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y; sp.setResolutionScale(Math.min(1, TARGET_H / h)) }
  const tex = sp.getTextureNode()
  const lowSize = vec2(textureSize(tex))
  const px = uv().mul(lowSize).floor()                        // pixel-art pixel grid, DPR independent
  const disp = renderOutput(tex).rgb                          // tone map + sRGB, display space
  const spread = uniform(0.12)
  const dithered = disp.add(bayer4(uvec2(px)).sub(0.5).mul(spread))
  finalNode = vec4(nearestPalette(dithered), 1)
} else if (look === 'pixelpass') {
  const pp = pixelationPass(scene, camera, 6, 0.3, 0.4)
  onResize = () => { /* pixelSize is in drawing-buffer pixels; to target a height: pp.pixelSize = drawingH / TARGET_H */
    const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y; pp.pixelSize = h / TARGET_H }
  finalNode = renderOutput(pp)
} else if (look === 'pixelbloom') {
  // pixelationPass + velocity MRT + bloom + custom ink from its own depth/normal textures
  const pp = pixelationPass(scene, camera, 6, 0, 1)             // strength 1 on depth edges so the edge shading is obvious
  pp.setMRT(mrt({ output, normal: normalView, velocity }))
  onResize = () => { pp.pixelSize = renderer.getDrawingBufferSize(new THREE.Vector2()).y / TARGET_H }
  const hasVel = !!pp.getTextureNode('velocity'), hasDepth = !!pp.getTextureNode('depth'), hasNormal = !!pp.getTextureNode('normal')
  window.__has = { hasVel, hasDepth, hasNormal }
  const glow = bloom(q.get('direct') ? pp.getTextureNode() : pp, 0.5, 0.4, 0.8)
  finalNode = renderOutput(pp.add(glow))
} else if (look === 'comic') {
  const sp = pass(scene, camera, { samples: 0 })
  sp.setMRT(mrt({ output, normal: normalView }))
  const tex = sp.getTextureNode(), nrm = sp.getTextureNode('normal'), dep = sp.getTextureNode('depth')
  const inv = vec2(1).div(screenSize)                          // one drawing-buffer pixel
  const th = uniform(1.5)                                      // line width in CSS-independent "rows/360"
  const w = inv.mul(screenSize.y.div(360).mul(th).max(1))
  const uvn = uv()
  // depth texture is non-linear: linearise each tap (getLinearDepthNode() cannot be sampled at an offset)
  const dN = (o) => viewZToOrthographicDepth(perspectiveDepthToViewZ(dep.sample(uvn.add(o)).r, cameraNear, cameraFar), cameraNear, cameraFar)
  const nN = (o) => nrm.sample(uvn.add(o)).rgb
  const d0 = dN(vec2(0)), n0 = nrm.sample(uvn).rgb
  const dDiff = abs(dN(vec2(w.x, 0)).sub(d0)).add(abs(dN(vec2(w.x.negate(), 0)).sub(d0))).add(abs(dN(vec2(0, w.y)).sub(d0))).add(abs(dN(vec2(0, w.y.negate())).sub(d0)))
  const nDiff = length(nN(vec2(w.x, 0)).sub(n0)).add(length(nN(vec2(0, w.y)).sub(n0))).add(length(nN(vec2(w.x.negate(), 0)).sub(n0))).add(length(nN(vec2(0, w.y.negate())).sub(n0)))
  const ink = max(step(0.02, dDiff.div(d0.max(0.05))), step(0.9, nDiff)) // depth jump relative to distance, or normal crease
  const sh = float(0.0025)                                      // chromatic offset in uv
  const col = vec3(renderOutput(vec4(tex.sample(uvn.add(vec2(sh, 0))).r, tex.sample(uvn).g, tex.sample(uvn.sub(vec2(sh, 0))).b, 1)).rgb)
  // single-ink halftone on luminance, cell size tied to screen height so DPR does not matter
  const cell = screenSize.y.div(70)
  const ang = float(0.785398)
  const p = screenCoordinate.xy
  const r = vec2(p.x.mul(cos(ang)).add(p.y.mul(sin(ang))), p.y.mul(cos(ang)).sub(p.x.mul(sin(ang)))).div(cell)
  const dist = length(fract(r).sub(0.5))
  const lum = luminance(col)
  const rad = sqrt(float(1).sub(lum)).mul(0.72)
  const dots = smoothstep(rad.add(0.08), rad.sub(0.08), dist)  // 1 where ink
  const paper = vec3(0.97, 0.93, 0.82), inkC = vec3(0.1, 0.07, 0.16)
  const toned = mix(col, mix(paper, inkC, dots), 0.7)
  finalNode = vec4(mix(toned, vec3(0.04, 0.03, 0.08), ink.clamp(0, 1)), 1)
} else if (look === 'neon') {
  const sp = pass(scene, camera, { samples: 0 })
  sp.setMRT(mrt({ output, normal: normalView, metalness, roughness }))
  const tex = sp.getTextureNode()
  const refl = ssr(tex, sp.getTextureNode('depth'), sp.getTextureNode('normal'), { metalnessNode: sp.getTextureNode('metalness').r, roughnessNode: sp.getTextureNode('roughness').r, reflectNonMetals: true, camera })
  refl.resolutionScale = 0.5; refl.maxDistance.value = 6; refl.thickness.value = 0.3
  const lit = tex.add(refl.getTextureNode())
  const glow = bloom(lit, 0.7, 0.4, 0.8)
  finalNode = renderOutput(lit.add(glow))
} else if (look === 'paint') {
  const sp = pass(scene, camera, { samples: 0 })
  sp.setMRT(mrt({ output, normal: normalView }))
  const disp = convertToTexture(renderOutput(sp.getTextureNode()))   // tone-mapped RTT so the 4*(R+1)^2 taps are cheap
  const inv = vec2(1).div(screenSize), R = 3
  const rscale = screenSize.y.div(540)                               // radius in "540p" pixels: DPR independent
  const uvn = uv()
  const sector = (sx, sy) => {
    let mean = vec3(0), sq = vec3(0)
    for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
      const c = disp.sample(uvn.add(vec2(i * sx, j * sy).mul(inv).mul(rscale))).rgb
      mean = mean.add(c); sq = sq.add(c.mul(c))
    }
    const n = (R + 1) * (R + 1); mean = mean.div(n)
    const v = sq.div(n).sub(mean.mul(mean))
    return { mean, v: v.x.add(v.y).add(v.z) }
  }
  const s = [sector(1, 1), sector(-1, 1), sector(1, -1), sector(-1, -1)]
  let best = s[0].mean, bv = s[0].v
  for (let k = 1; k < 4; k++) { const less = s[k].v.lessThan(bv); best = less.select(s[k].mean, best); bv = less.select(s[k].v, bv) }
  const dep = sp.getTextureNode('depth')
  const lz = (o) => viewZToOrthographicDepth(perspectiveDepthToViewZ(dep.sample(uvn.add(o)).r, cameraNear, cameraFar), cameraNear, cameraFar)
  const e = inv.mul(rscale)
  const edge = abs(lz(vec2(e.x, 0)).sub(lz(vec2(e.x.negate(), 0)))).add(abs(lz(vec2(0, e.y)).sub(lz(vec2(0, e.y.negate())))))
  const paperN = fract(sin(dot(floor(screenCoordinate.xy.div(screenSize.y.div(540))), vec2(12.9898, 78.233))).mul(43758.5453))
  const grain = paperN.sub(0.5).mul(0.06)
  const darkened = best.mul(float(1).sub(smoothstep(0.004, 0.02, edge).mul(0.45)))
  finalNode = vec4(darkened.mul(vec3(1.0, 0.97, 0.9)).add(grain), 1)
} else {
  finalNode = renderOutput(pass(scene, camera).getTextureNode())
}

const pipeline = new THREE.RenderPipeline(renderer, finalNode)
if (look !== 'none') pipeline.outputColorTransform = false
if (look === 'neon') pipeline.outputColorTransform = false
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); onResize() })
onResize()
let frames = 0
renderer.setAnimationLoop((t) => {
  ball.position.x = -0.3 + Math.sin(t / 1000) * 0.6; boxes[1].rotation.y = t / 2000
  pipeline.render(); frames++
})
window.probe = { look, frames: () => frames, has: window.__has, backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2', size: () => renderer.getDrawingBufferSize(new THREE.Vector2()).toArray() }
