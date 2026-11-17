// The renderer. One WebGL2 context for the whole page, however many components there are.
// Each component is drawn into a corner of this context's canvas and copied to the
// component's own 2D canvas, so components need no context of their own and cost nothing at rest.
//
// The view is a cabinet projection, not a camera: the front face of every voxel lands on the
// pixel grid, and depth shows as a shift down and to the right (the viewer is up and to the left).
// Shadows come from a depth map drawn from the light, so they follow anything that moves.

const Z_RANGE = 512;
const SHADOW_SIZE = 2048;

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aFace;   // face index, corner index
layout(location=3) in vec2 aUv;
layout(location=4) in vec4 iPos;    // centre xyz, scale
layout(location=5) in vec4 iQuat;
layout(location=6) in vec4 iColor;  // rgb, glow
layout(location=7) in uvec2 iAo;
uniform vec4 uView;   // origin x, origin y (device px), px per voxel, 0
uniform vec2 uShear;
uniform vec2 uSize;
out vec3 vN; out vec3 vP; out vec2 vUv; out float vAo; out vec4 vColor;
vec3 rot(vec3 v, vec4 q) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 p = iPos.xyz + rot(aPos * iPos.w, iQuat);
  vN = rot(aNormal, iQuat);
  vP = p; vUv = aUv; vColor = iColor;
  int f = int(aFace.x); int c = int(aFace.y);
  uint bits = f < 4 ? (iAo.x >> uint(f * 8 + c * 2)) : (iAo.y >> uint((f - 4) * 8 + c * 2));
  vAo = float(bits & 3u);
  float px = uView.x + (p.x + uShear.x * p.z) * uView.z;
  float py = uView.y + (p.y + uShear.y * p.z) * uView.z;
  gl_Position = vec4(px / uSize.x * 2.0 - 1.0, 1.0 - py / uSize.y * 2.0, -p.z / ${Z_RANGE}.0, 1.0);
}`;

const SHADOW_FN = `
uniform highp sampler2DShadow uShadow;
uniform vec2 uLShear;   // how far a shadow travels per voxel of height
uniform vec4 uLRect;    // u0, v0, 1/width, 1/height of the shadow map, in voxels
uniform float uSoft;    // penumbra radius, voxels
float lit(vec3 p, vec3 n) {
  vec3 q = p + n * 0.08;
  vec2 uv = (vec2(q.x + uLShear.x * q.z, q.y + uLShear.y * q.z) - uLRect.xy) * uLRect.zw;
  float ref = 0.5 - (q.z + 0.06) / ${2 * Z_RANGE}.0;
  vec2 r = uSoft * uLRect.zw;
  float s = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++)
    s += texture(uShadow, vec3(uv + vec2(float(i), float(j)) * r * 0.5, ref));
  return s / 25.0;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vP; in vec2 vUv; in float vAo; in vec4 vColor;
uniform vec3 uToLight;
uniform float uSun;
uniform vec4 uAmbient;      // top, front, side, under
uniform vec3 uAmbientTint;
uniform vec3 uHighlight;
uniform float uSeam;
uniform float uGlow;
uniform float uPx;          // device px per voxel
uniform vec4 uWell;         // the hole in the page, on the page plane: x0, y0, x1, y1 (voxels)
uniform vec2 uWellShear;
${SHADOW_FN}
out vec4 o;
void main() {
  if (vP.z < -0.001) { // the page hides whatever sinks into it, except through a well cut for it
    vec2 s = vP.xy + uWellShear * vP.z;
    if (s.x < uWell.x || s.y < uWell.y || s.x > uWell.z || s.y > uWell.w) discard;
  }
  vec3 n = normalize(vN);
  vec3 n2 = n * n;
  float amb = n2.x * uAmbient.z
            + n2.y * (n.y < 0.0 ? uAmbient.x : uAmbient.w)
            + n2.z * (n.z > 0.0 ? uAmbient.y : uAmbient.w);
  float ndl = max(dot(n, uToLight), 0.0);
  float sh = ndl > 0.0 ? lit(vP, n) : 0.0;
  float ao = 1.0 - vAo * 0.17;
  float direct = uSun * ndl * sh;
  float l = amb * ao + direct;
  // Shadowed faces lean toward the ambient tint; lit faces above 1 lean toward the highlight.
  vec3 base = vColor.rgb;
  vec3 c = base * min(l, 1.0);
  c = mix(c * uAmbientTint, c, clamp(direct / (uSun * 0.6), 0.0, 1.0));
  c = mix(c, uHighlight, clamp((l - 1.0) * 1.5, 0.0, 0.55));
  // Seams: one device pixel along every voxel edge, so the grid stays countable.
  vec2 e = min(vUv, 1.0 - vUv) * uPx;
  float seam = 1.0 - smoothstep(0.0, 1.0, min(e.x, e.y));
  c *= 1.0 - seam * uSeam;
  // Voxels that glow keep their colour whatever the light does.
  float g = vColor.a * uGlow;
  c = mix(c, base * (0.86 + 0.14 * min(l, 1.15)) * (1.0 - seam * uSeam * 0.5), g * 0.36);
  o = vec4(c, 1.0);
}`;

const SHADOW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=4) in vec4 iPos;
layout(location=5) in vec4 iQuat;
uniform vec2 uLShear; uniform vec4 uLRect;
vec3 rot(vec3 v, vec4 q) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 p = iPos.xyz + rot(aPos * iPos.w, iQuat);
  vec2 uv = (vec2(p.x + uLShear.x * p.z, p.y + uLShear.y * p.z) - uLRect.xy) * uLRect.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, -p.z / ${Z_RANGE}.0, 1.0);
}`;
const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}`;

// The page itself: transparent, but it receives shadow.
const GROUND_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner; // 0..1
uniform vec4 uView; uniform vec2 uSize;
out vec3 vP;
void main() {
  vec2 px = aCorner * uSize;
  vP = vec3((px - uView.xy) / uView.z, 0.0);
  gl_Position = vec4(aCorner.x * 2.0 - 1.0, 1.0 - aCorner.y * 2.0, 0.0, 1.0);
}`;
const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vP;
uniform vec4 uShadowColor;
${SHADOW_FN}
out vec4 o;
void main() {
  float a = (1.0 - lit(vP, vec3(0.0, 0.0, 1.0))) * uShadowColor.a;
  o = vec4(uShadowColor.rgb * a, a);
}`;

// Glow: a soft halo around every voxel that emits. Night only.
const GLOW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner; // -1..1
layout(location=4) in vec4 iPos;
layout(location=6) in vec4 iColor;
uniform vec4 uView; uniform vec2 uShear; uniform vec2 uSize; uniform float uRadius;
out vec2 vC; out vec4 vColor;
void main() {
  vC = aCorner; vColor = iColor;
  float r = iColor.a > 0.0 ? uRadius * iPos.w : 0.0;
  float px = uView.x + (iPos.x + uShear.x * iPos.z + aCorner.x * r) * uView.z;
  float py = uView.y + (iPos.y + uShear.y * iPos.z + aCorner.y * r) * uView.z;
  gl_Position = vec4(px / uSize.x * 2.0 - 1.0, 1.0 - py / uSize.y * 2.0, -(iPos.z + 0.6) / ${Z_RANGE}.0, 1.0);
}`;
const GLOW_FS = `#version 300 es
precision highp float;
in vec2 vC; in vec4 vColor;
uniform float uStrength;
out vec4 o;
void main() {
  float d = dot(vC, vC);
  float g = exp(-d * 3.2) * (1.0 - smoothstep(0.7, 1.0, d)) * uStrength * vColor.a;
  o = vec4(vColor.rgb * g, g * 0.35);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function cubeGeometry() {
  const faces = [
    { n: [1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
    { n: [-1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
    { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
    { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
    { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
    { n: [0, 0, -1], a: [1, 0, 0], b: [0, 1, 0] },
  ];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const order = [0, 1, 2, 0, 2, 3];
  const out = [];
  faces.forEach((F, f) => {
    for (const c of order) {
      const [sa, sb] = corners[c];
      out.push(
        0.5 * (F.n[0] + F.a[0] * sa + F.b[0] * sb), 0.5 * (F.n[1] + F.a[1] * sa + F.b[1] * sb), 0.5 * (F.n[2] + F.a[2] * sa + F.b[2] * sb),
        F.n[0], F.n[1], F.n[2], f, c, (sa + 1) / 2, (sb + 1) / 2,
      );
    }
  });
  return new Float32Array(out);
}

export class Renderer {
  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch { return false; }
  }

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 256;
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.lost = false;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.init(); this.onrestore?.(); });
    this.init();
  }

  init() {
    const gl = this.gl;
    this.main = program(gl, VS, FS);
    this.shadow = program(gl, SHADOW_VS, SHADOW_FS);
    this.ground = program(gl, GROUND_VS, GROUND_FS);
    this.glow = program(gl, GLOW_VS, GLOW_FS);

    this.bufPos = gl.createBuffer();   // per instance: xyz, scale, quat
    this.bufCol = gl.createBuffer();   // per instance: rgb, glow
    this.bufAo = gl.createBuffer();    // per instance: two uint32
    this.capacity = 0;

    // Cubes
    this.vaoCube = gl.createVertexArray();
    gl.bindVertexArray(this.vaoCube);
    const cube = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cube);
    gl.bufferData(gl.ARRAY_BUFFER, cubeGeometry(), gl.STATIC_DRAW);
    const S = 10 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, S, 32);
    this.bindInstances();

    // Quads (ground and glow share the unit quad; glow remaps it to -1..1)
    this.vaoGround = gl.createVertexArray();
    gl.bindVertexArray(this.vaoGround);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.vaoGlow = gl.createVertexArray();
    gl.bindVertexArray(this.vaoGlow);
    const quad2 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad2);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bindInstances();
    gl.bindVertexArray(null);

    // Shadow map
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bindInstances() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(5, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(6, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufAo);
    gl.enableVertexAttribArray(7); gl.vertexAttribIPointer(7, 2, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(7, 1);
  }

  /**
   * Draw one component and copy it to its canvas.
   * frame: { pos: Float32Array (8 per voxel), col: Float32Array (4), ao: Uint32Array (2), count,
   *          wpx, hpx (device px), ox, oy (device px of voxel 0,0), s (device px per voxel),
   *          bounds: [x0, y0, x1, y1] in voxels (the canvas area), light, shear: [kx, ky] }
   */
  draw(frame, ctx2d) {
    if (this.lost) return false;
    const gl = this.gl;
    const { wpx, hpx, count, light } = frame;
    if (wpx < 1 || hpx < 1) return false;
    if (this.canvas.width < wpx || this.canvas.height < hpx) {
      this.canvas.width = Math.max(this.canvas.width, Math.ceil(wpx / 256) * 256);
      this.canvas.height = Math.max(this.canvas.height, Math.ceil(hpx / 256) * 256);
    }
    const H = this.canvas.height;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, frame.pos.subarray(0, count * 8), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
    gl.bufferData(gl.ARRAY_BUFFER, frame.col.subarray(0, count * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufAo);
    gl.bufferData(gl.ARRAY_BUFFER, frame.ao.subarray(0, count * 2), gl.DYNAMIC_DRAW);

    // Light-space rectangle: the canvas area, grown by how far the tallest thing can throw.
    const L = light.toLight;
    const lsx = -L[0] / L[2], lsy = -L[1] / L[2]; // shadow travel per voxel of height
    const pad = 6;
    const [bx0, by0, bx1, by1] = frame.bounds;
    const u0 = bx0 - pad, v0 = by0 - pad;
    const uw = bx1 - bx0 + pad * 2, vh = by1 - by0 + pad * 2;
    // Keep texel density steady so the penumbra is the same width on every component.
    const texels = Math.min(SHADOW_SIZE / uw, SHADOW_SIZE / vh, 12);
    const sw = Math.max(1, Math.round(uw * texels)), shh = Math.max(1, Math.round(vh * texels));
    const lrect = [u0, v0, (sw / SHADOW_SIZE) / uw, (shh / SHADOW_SIZE) / vh];

    // 1. Depth from the light
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, sw, shh);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, Math.min(SHADOW_SIZE, sw + 8), Math.min(SHADOW_SIZE, shh + 8));
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.colorMask(false, false, false, false);
    if (count) {
      gl.useProgram(this.shadow.p);
      // In the shadow pass the map covers its own viewport, so the rect is in viewport units.
      gl.uniform2f(this.shadow.u.uLShear, lsx, lsy);
      gl.uniform4f(this.shadow.u.uLRect, u0, v0, 1 / uw, 1 / vh);
      gl.bindVertexArray(this.vaoCube);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);
    }
    gl.colorMask(true, true, true, true);

    // 2. The picture
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, wpx, hpx);
    gl.scissor(0, 0, wpx, hpx);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);

    const view = [frame.ox, frame.oy, frame.s, 0];
    const soft = frame.soft ?? 0.22;

    // page shadow
    gl.useProgram(this.ground.p);
    gl.uniform4fv(this.ground.u.uView, view);
    gl.uniform2f(this.ground.u.uSize, wpx, hpx);
    gl.uniform4f(this.ground.u.uShadowColor, light.shadow[0], light.shadow[1], light.shadow[2], light.shadow[3] * (frame.groundShadow ?? 1));
    gl.uniform1i(this.ground.u.uShadow, 0);
    gl.uniform2f(this.ground.u.uLShear, lsx, lsy);
    gl.uniform4fv(this.ground.u.uLRect, lrect);
    gl.uniform1f(this.ground.u.uSoft, soft * 1.25);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vaoGround);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (count) {
      // voxels
      gl.useProgram(this.main.p);
      const u = this.main.u;
      gl.uniform4fv(u.uView, view);
      gl.uniform2fv(u.uShear, frame.shear);
      gl.uniform2f(u.uSize, wpx, hpx);
      gl.uniform3fv(u.uToLight, L);
      gl.uniform1f(u.uSun, light.sun);
      gl.uniform4f(u.uAmbient, light.ambient.top, light.ambient.front, light.ambient.side, light.ambient.under);
      gl.uniform3fv(u.uAmbientTint, light.ambientTint);
      gl.uniform3fv(u.uHighlight, light.highlight);
      gl.uniform1f(u.uSeam, light.seam);
      gl.uniform1f(u.uGlow, light.glow);
      gl.uniform1f(u.uPx, frame.s);
      gl.uniform4fv(u.uWell, frame.well ?? [0, 0, -1, -1]);
      gl.uniform2fv(u.uWellShear, frame.shear);
      gl.uniform1i(u.uShadow, 0);
      gl.uniform2f(u.uLShear, lsx, lsy);
      gl.uniform4fv(u.uLRect, lrect);
      gl.uniform1f(u.uSoft, soft);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.vaoCube);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);

      // glow
      if (light.glow > 0 && frame.glows) {
        gl.useProgram(this.glow.p);
        const g = this.glow.u;
        gl.uniform4fv(g.uView, view);
        gl.uniform2fv(g.uShear, frame.shear);
        gl.uniform2f(g.uSize, wpx, hpx);
        gl.uniform1f(g.uRadius, frame.glowRadius ?? 2.4);
        gl.uniform1f(g.uStrength, light.glow * (frame.glowStrength ?? 0.11));
        gl.depthMask(false);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(this.vaoGlow);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        gl.depthMask(true);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);

    ctx2d.clearRect(0, 0, wpx, hpx);
    ctx2d.drawImage(this.canvas, 0, H - hpx, wpx, hpx, 0, 0, wpx, hpx);
    return true;
  }
}
