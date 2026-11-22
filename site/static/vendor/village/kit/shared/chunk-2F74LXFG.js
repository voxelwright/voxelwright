async function Ue(e,u,y){let n=e.createShaderModule({label:u,code:y}),f=(await n.getCompilationInfo()).messages.filter(w=>w.type==="error");if(f.length)throw new Error(`${u}: ${f.map(w=>`${w.lineNum}:${w.linePos} ${w.message}`).join("; ")}`);return n}var j="depth24plus",ye=.8;var xe=512,L=256,Y=2,ve=[{n:[1,0,0],a:[0,1,0],b:[0,0,1]},{n:[-1,0,0],a:[0,1,0],b:[0,0,1]},{n:[0,1,0],a:[1,0,0],b:[0,0,1]},{n:[0,-1,0],a:[1,0,0],b:[0,0,1]},{n:[0,0,1],a:[1,0,0],b:[0,1,0]},{n:[0,0,-1],a:[1,0,0],b:[0,1,0]}],ze=e=>`
struct Part {
  clip: mat4x4f,    // from a place among the part's cubes to where it is seen
  view: vec4f,      // ground filter radius (-1: inherited), finish and normal flags, px a cube, halo strength
  area: vec4f,      // the part of the page that is this part's picture, in cubes: x0, y0, x1, y1
  sun: vec4f,       // towards the light, its strength
  ambient: vec4f,   // top, front, side, under
  tint: vec4f,      // what shadowed faces lean to, how strong a cube's edges are
  gleam: vec4f,     // what faces lit past 1 lean to, how much glowing cubes glow
  well: vec4f,      // the hole in the page
  shade: vec4f,     // the shadow on the page
  fall: vec4f,      // how far a shadow travels a cube of height (x, y), the penumbra, a halo's reach
  lrect: vec4f,     // the light's view of this part: corner, 1 / size, in cubes
  region: vec4f,    // where that view is kept in the map of depths: corner and size, 0 to 1
  eye: vec4f,       // towards the viewer (w = 0) or position of the viewer in the part's coordinates (w = 1)
}
@group(0) @binding(0) var<uniform> part: Part;
@group(0) @binding(1) var depths: texture_depth_2d;
@group(0) @binding(2) var nearer: sampler_comparison;

fn turned(v: vec3f, q: vec4f) -> vec3f { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
fn lightUv(p: vec3f) -> vec2f { return (p.xy + part.fall.xy * p.z - part.lrect.xy) * part.lrect.zw; }

// How much of the light reaches a point: looks into the map of depths, a penumbra's width across.
fn lit(p: vec3f, n: vec3f, soft: f32) -> f32 {
  let q = p + n * 0.08;
  let uv = lightUv(q);
  let depth = 0.5 - (q.z + 0.06) / ${2*xe}.0;
  let r = soft * part.lrect.zw / ${Y}.0;
  var s = 0.0;
  for (var i = -${Y}; i <= ${Y}; i++) {
    for (var j = -${Y}; j <= ${Y}; j++) {
      s += textureSampleCompareLevel(depths, nearer, part.region.xy + (uv + vec2f(f32(i), f32(j)) * r) * part.region.zw, depth);
    }
  }
  return s / ${(2*Y+1)**2}.0;
}

struct Cube {
  @location(0) pos: vec3f, @location(1) normal: vec3f, @location(2) face: vec2f, @location(3) uv: vec2f,
  @location(4) at: vec4f, @location(5) quat: vec4f, @location(6) color: vec4f, @location(7) ao: vec2u, @location(8) mould: vec4f,
}
struct Face {
  @builtin(position) at: vec4f,
  @location(0) n: vec3f, @location(1) p: vec3f, @location(2) uv: vec2f, @location(3) ao: f32, @location(4) color: vec4f,
  // How far the face's two axes lean to the light: the one \`uv.x\` runs along, and the one \`uv.y\` does.
  @location(5) lean: vec2f,
  @location(6) @interpolate(flat) finish: vec2f,
  @location(7) @interpolate(flat) normalBias: f32,
}
@vertex fn cube(i: Cube) -> Face {
  const ALONG = array(${ve.map(u=>`vec3f(${u.a})`).join(", ")});
  const ACROSS = array(${ve.map(u=>`vec3f(${u.b})`).join(", ")});
  let p = i.at.xyz + turned(i.pos * i.at.w, i.quat);
  let f = u32(i.face.x);
  let c = u32(i.face.y);
  var bits = i.ao.y >> ((f - 4u) * 8u + c * 2u);
  if (f < 4u) { bits = i.ao.x >> (f * 8u + c * 2u); }
  var o: Face;
  // The shadow caster remains the cube. A normal bias avoids striping where
  // the moulded finish spans the neighbouring tread and riser.
  o.normalBias = select(0.0, i.mould.w, part.view.y >= 2.0);
  o.n = turned(mix(i.normal, i.mould.xyz, o.normalBias), i.quat);
  o.p = p;
  o.uv = i.uv;
  o.ao = f32(bits & 3u) * (1.0 - o.normalBias * 0.8);
  o.color = i.color;
  o.finish = select(vec2f(1.0, 0.0), vec2f(vec2u(i.ao.y >> 16u, i.ao.y >> 24u) & vec2u(255u)) / 255.0, (u32(part.view.y) & 1u) != 0u);
  o.lean = vec2f(dot(turned(ALONG[f], i.quat), part.sun.xyz), dot(turned(ACROSS[f], i.quat), part.sun.xyz));
  o.at = part.clip * vec4f(p, 1.0);
  return o;
}
@fragment fn face(i: Face) -> @location(0) vec4f {
${e?`  // The page hides whatever sinks into it, except through a well cut for it. (In a page that is the page's own
  // depth: see \`page\`. Here the world's depth is not the part's to write a page into.)
  if (i.p.z < -0.001 && (i.p.x < part.well.x || i.p.y < part.well.y || i.p.x > part.well.z || i.p.y > part.well.w)) { discard; }
`:""}  let n = normalize(i.n);
  let n2 = n * n;
  let amb = n2.x * part.ambient.z + n2.y * select(part.ambient.w, part.ambient.x, n.y < 0.0) + n2.z * select(part.ambient.w, part.ambient.y, n.z > 0.0);
  let ndl = max(dot(n, part.sun.xyz), 0.0);
  var sh = 0.0;
  if (ndl > 0.0) { sh = lit(i.p + n * i.normalBias * 0.65, n, part.fall.z); }
  let ao = 1.0 - i.ao * 0.17;
  let direct = part.sun.w * ndl * sh;
  let l = amb * ao + direct;
  // Faces in shadow lean to the ambient tint; faces lit past 1 lean to the highlight.
  let base = i.color.rgb;
  var c = base * min(l, 1.0);
  c = mix(c * part.tint.rgb, c, clamp(direct / max(part.sun.w * 0.6, 0.0001), 0.0, 1.0));
  // Diffuse PBT keeps its pigment in bright light. The glossier resin can
  // approach the highlight colour along the same moulded shoulder.
  let shoulder = mix(1.0, i.finish.y, i.normalBias);
  c = mix(c, part.gleam.rgb, shoulder * clamp((l - 1.0) * 1.5, 0.0, 0.55));
  // Simulate a chamfer by lighting opposite edges differently. Page widths are measured on a full-size front face;
  // the cabinet projection foreshortens the sides. In the world use the projected width of each face instead.
  let px = ${e?"1.0 / max(fwidth(i.uv), vec2f(0.0001))":"vec2f(part.view.z)"};
  let d0 = i.uv * px;
  let d1 = (1.0 - i.uv) * px;
  var seam = 0.0;
  var relief = 0.0;
  if (i.color.a >= 0.0) {
    let e = min(d0, d1);
    seam = 1.0 - smoothstep(0.0, 1.0, min(e.x, e.y));
    let band = max(vec2f(${e?"1.5":"1.0"}), px * 0.2);
    let w0 = 1.0 - smoothstep(vec2f(0.0), band, d0);
    let w1 = 1.0 - smoothstep(vec2f(0.0), band, d1);
    relief = dot(w1 - w0, i.lean);
${e?`    // The world's picture has one sample a pixel and cubes of any size: as a cube comes down to a few pixels its
    // edges would beat against the pixels, so they fade out, and are gone by the time it is three across.
    let visibility = smoothstep(3.0, 8.0, min(px.x, px.y));
    relief *= visibility;
    seam *= visibility;
`:""}  }
  let edge = part.tint.a * i.finish.x;
  let seamLight = 1.0 - seam * edge * 0.5;
  c *= 1.0 + relief * edge * 5.0;
  c *= seamLight;
  if (i.finish.y > 0.0 && direct > 0.0) {
    let towardEye = part.eye.xyz - i.p * part.eye.w;
    let halfway = part.sun.xyz + towardEye / max(length(towardEye), 0.0001);
    let cosine = max(dot(n, halfway) / max(length(halfway), 0.0001), 0.0);
    c += part.gleam.rgb * (i.finish.y * direct * pow(cosine, 6.0));
  }
  // Cubes that glow keep their colour whatever the light does.
  let g = max(i.color.a, 0.0) * part.gleam.a;
  c = mix(c, base * (0.86 + 0.14 * min(l, 1.15)) * seamLight, g * 0.36);
  ${e?`// The world's last pass makes whatever is over ${ye} of full glow (glow.ts): the kit's white is kept under it.
  return vec4f(c * ${ye}, 1.0);`:`let through = clamp(-1.0 - i.color.a, 0.0, 1.0);
  let facing = abs(dot(n, normalize(part.eye.xyz)));
  let grazing = pow(1.0 - min(facing, 1.0), 3.0) * through;
  let opacity = 1.0 - through + grazing * 0.65;
  return vec4f(mix(c, part.gleam.rgb, grazing * 0.45) * opacity, opacity);`}
}

// Depth as the light sees it.
@vertex fn shadow(@location(0) pos: vec3f, @location(4) at: vec4f, @location(5) quat: vec4f) -> @builtin(position) vec4f {
  let p = at.xyz + turned(pos * at.w, quat);
  let uv = lightUv(p);
  return vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.5 - p.z / ${2*xe}.0, 1.0);
}

// The page hides whatever sinks into it, except through a well cut for it: the page is drawn into the depth alone,
// all of the part's area but the well, as four bands round the well. Throwing the hidden pixels away in \`face\`
// gives the same picture at rest and costs Safari 70 ms for a dialog where this costs 6: a shader that may throw
// a pixel away cannot skip the pixels behind another cube, and each pixel has four samples.
@vertex fn page(@builtin(vertex_index) v: u32, @builtin(instance_index) band: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32(v & 1u), f32(v >> 1u));
  var a = part.area.xy;
  var b = part.area.zw;
  if (band == 0u) { b.x = part.well.x; } else if (band == 1u) { a.x = part.well.z; } else { a.x = part.well.x; b.x = part.well.z; }
  if (band == 2u) { b.y = part.well.y; }
  if (band == 3u) { a.y = part.well.w; }
  return part.clip * vec4f(a + corner * (b - a), -0.001, 1.0);
}
@fragment fn nothing() -> @location(0) vec4f { return vec4f(0.0); }

// The page itself: nothing, but it takes shadow.
struct Ground { @builtin(position) at: vec4f, @location(0) p: vec3f }
@vertex fn ground(@builtin(vertex_index) v: u32) -> Ground {
  let corner = vec2f(f32(v & 1u), f32(v >> 1u));
  var o: Ground;
  // (In the world a part may stand on another's face: its page is drawn a little proud of that face.)
  o.p = vec3f(part.area.xy + corner * (part.area.zw - part.area.xy), ${e?"0.03":"0.0"});
  o.at = part.clip * vec4f(o.p, 1.0);
  return o;
}
@fragment fn shaded(i: Ground) -> @location(0) vec4f {
  let radius = select(part.view.x, part.fall.z * 1.25, part.view.x < 0.0);
  let a = (1.0 - lit(i.p, vec3f(0.0, 0.0, 1.0), radius)) * part.shade.a;
  return vec4f(part.shade.rgb * a, a);
}

// A soft halo round every cube that glows. Night only.
struct Halo { @builtin(position) at: vec4f, @location(0) c: vec2f, @location(1) color: vec4f }
@vertex fn halo(@builtin(vertex_index) v: u32, @location(4) at: vec4f, @location(6) color: vec4f) -> Halo {
  const corners = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[v];
  let r = select(0.0, part.fall.w * at.w, color.a > 0.0);
  var o: Halo;
  o.c = corner;
  o.color = color;
  // The halo lies flat to the page round its cube's middle, and counts as a little nearer than it.
  let here = part.clip * vec4f(at.xy + corner * r, at.z, 1.0);
  let ahead = part.clip * vec4f(at.xy + corner * r, at.z + 0.6, 1.0);
  o.at = vec4f(here.xy, ahead.z / ahead.w * here.w, here.w);
  return o;
}
@fragment fn haloed(i: Halo) -> @location(0) vec4f {
  let d = dot(i.c, i.c);
  let g = exp(-d * 3.2) * (1.0 - smoothstep(0.7, 1.0, d)) * part.view.w * i.color.a;
  return vec4f(i.color.rgb * g, g * 0.35);
}
`;function Re(){let e=[[-1,-1],[1,-1],[1,1],[-1,1]],u=[];return ve.forEach((y,n)=>{for(let i of[0,1,2,0,2,3]){let[f,w]=e[i];for(let g=0;g<3;g++)u.push(.5*(y.n[g]+y.a[g]*f+y.b[g]*w));u.push(y.n[0],y.n[1],y.n[2],n,i,(f+1)/2,(w+1)/2)}}),new Float32Array(u)}async function Ge(e,u,y={}){let n=y.world??!1,i=n?1:4,f=2048,w=64,g=n?6:12,E=await Ue(e,"blocks",ze(n)),X={binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform",hasDynamicOffset:!0,minBindingSize:L}},ae=e.createBindGroupLayout({entries:[X]}),x=e.createBindGroupLayout({entries:[X,{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"depth"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"comparison"}}]}),v=t=>e.createPipelineLayout({bindGroupLayouts:[t]}),C={arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x2"},{shaderLocation:3,offset:32,format:"float32x2"}]},V={arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]},D={arrayStride:32,stepMode:"instance",attributes:[{shaderLocation:4,offset:0,format:"float32x4"},{shaderLocation:5,offset:16,format:"float32x4"}]},O={arrayStride:32,stepMode:"instance",attributes:[{shaderLocation:4,offset:0,format:"float32x4"}]},k={arrayStride:16,stepMode:"instance",attributes:[{shaderLocation:6,offset:0,format:"float32x4"}]},Q={arrayStride:8,stepMode:"instance",attributes:[{shaderLocation:7,offset:0,format:"uint32x2"}]},F={arrayStride:4,stepMode:"instance",attributes:[{shaderLocation:8,offset:0,format:"snorm8x4"}]},N={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha"}},a={count:i},[d,l,c,o,P]=await Promise.all([e.createRenderPipelineAsync({label:"blocks: depth from the light",layout:v(ae),vertex:{module:E,entryPoint:"shadow",buffers:[V,D]},depthStencil:{format:"depth32float",depthWriteEnabled:!0,depthCompare:"less-equal"}}),e.createRenderPipelineAsync({label:"blocks: cubes",layout:v(x),vertex:{module:E,entryPoint:"cube",buffers:[C,D,k,Q,F]},fragment:{module:E,entryPoint:"face",targets:[{format:u}]},depthStencil:{format:j,depthWriteEnabled:!0,depthCompare:"less-equal"},multisample:a}),e.createRenderPipelineAsync({label:"blocks: the shadow on the page",layout:v(x),vertex:{module:E,entryPoint:"ground"},fragment:{module:E,entryPoint:"shaded",targets:[{format:u,blend:N}]},depthStencil:{format:j,depthWriteEnabled:!1,depthCompare:n?"less-equal":"always"},primitive:{topology:"triangle-strip"},multisample:a}),e.createRenderPipelineAsync({label:"blocks: halos",layout:v(x),vertex:{module:E,entryPoint:"halo",buffers:[O,k]},fragment:{module:E,entryPoint:"haloed",targets:[{format:u,blend:N}]},depthStencil:{format:j,depthWriteEnabled:!1,depthCompare:"less-equal"},multisample:a}),e.createRenderPipelineAsync({label:"blocks: the page, in depth alone",layout:v(x),vertex:{module:E,entryPoint:"page"},fragment:{module:E,entryPoint:"nothing",targets:[{format:u,writeMask:0}]},depthStencil:{format:j,depthWriteEnabled:!0,depthCompare:"always"},primitive:{topology:"triangle-strip"},multisample:a})]),T=e.createBuffer({size:1440,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});e.queue.writeBuffer(T,0,Re());let B=e.createBuffer({size:L*w,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),oe=new Float32Array(new ArrayBuffer(L*w)),Be=e.createBindGroup({layout:ae,entries:[{binding:0,resource:{buffer:B,size:L}}]}),Me=e.createSampler({compare:"less-equal",magFilter:"linear",minFilter:"linear"}),H=null,Ae=()=>{if(H)return H;let t=e.createTexture({size:[f,f],format:"depth32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),h=t.createView();return H={texture:t,view:h,group:e.createBindGroup({layout:x,entries:[{binding:0,resource:{buffer:B,size:L}},{binding:1,resource:h},{binding:2,resource:Me}]})}},K=0,p=null,z=0,he=t=>{p?.pos.destroy(),p?.col.destroy(),p?.ao.destroy(),p?.normals.destroy(),K=t;let h=GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST;p={pos:e.createBuffer({size:t*32,usage:h}),col:e.createBuffer({size:t*16,usage:h}),ao:e.createBuffer({size:t*8,usage:h}),normals:e.createBuffer({size:t*4,usage:h})}};he(16384);let M=[],Ce=t=>{let h=M.findIndex(s=>s.size[0]===t[0]&&s.size[1]===t[1]);if(h>=0){let[s]=M.splice(h,1);return M.push(s),s}if(M.length===4){let s=M.shift();s.color?.destroy(),s.depth.destroy()}let b={size:[t[0],t[1]],color:i>1?e.createTexture({size:[t[0],t[1]],format:u,sampleCount:i,usage:GPUTextureUsage.RENDER_ATTACHMENT}):null,depth:e.createTexture({size:[t[0],t[1]],format:j,sampleCount:i,usage:GPUTextureUsage.RENDER_ATTACHMENT})};return M.push(b),b},Pe=()=>{for(let t of M)t.color?.destroy(),t.depth.destroy();M.length=0,H?.texture.destroy(),H=null},G=[],Z=0,ne=0,J=0,Te=8,se=L/4;return{lay(t,h){let{count:b,light:s}=t;if(G.length===w)return!1;let S=s.toLight,$=-S[0]/S[2],ie=-S[1]/S[2],U=6,[_,ee,m,r]=t.bounds,R=_-U,q=ee-U,A=m-_+U*2,W=r-ee+U*2,te=Math.min(f/A,f/W,g),pe=Math.max(1,Math.round(A*te)),me=Math.max(1,Math.round(W*te));if(Z+pe>f&&(Z=0,ne+=J+Te,J=0),ne+me>f)return G.length===0?de("a part too large for the map of depths"):!1;if(b>K){if(G.length)return!1;he(2**Math.ceil(Math.log2(b)))}if(z+b>K)return!1;let re=[Z,ne,pe,me];Z+=pe+Te,J=Math.max(J,me),b&&(e.queue.writeBuffer(p.pos,z*32,t.pos,0,b*8),e.queue.writeBuffer(p.col,z*16,t.col,0,b*4),t.normals&&e.queue.writeBuffer(p.normals,z*4,t.normals,0,b*4),e.queue.writeBuffer(p.ao,z*8,t.ao,0,b*2));let le=t.well??[0,0,-1,-1],ue=s.ambient,{ox:ge,oy:be,s:I}=t,ce="clip"in h?h.area:[-ge/I,-be/I,(t.wpx-ge)/I,(t.hpx-be)/I],fe="clip"in h?h.eye:void 0,{groundSoft:we}=t;return oe.set([we!==void 0&&Number.isFinite(we)?Math.min(2,Math.max(0,we)):-1,+(t.surfaceBytes===!0)+(t.normals?2:0),I,s.glow*(t.glowStrength??.11),ce[0],ce[1],ce[2],ce[3],S[0],S[1],S[2],s.sun,ue.top,ue.front,ue.side,ue.under,s.ambientTint[0],s.ambientTint[1],s.ambientTint[2],s.seam,s.highlight[0],s.highlight[1],s.highlight[2],s.glow,le[0],le[1],le[2],le[3],s.shadow[0],s.shadow[1],s.shadow[2],s.shadow[3]*(t.groundShadow??1),$,ie,t.soft??.22,t.glowRadius??2.4,R,q,1/A,1/W,re[0]/f,re[1]/f,re[2]/f,re[3]/f,fe?.[0]??(n?0:-t.shear[0]),fe?.[1]??(n?0:-t.shear[1]),fe?.[2]??1,fe?1:0],G.length*se+16),G.push({first:z,count:b,at:h,ox:ge,oy:be,s:I,shear:t.shear,w:t.wpx,h:t.hpx,region:re,glows:s.glow>0&&!!t.glows}),z+=b,!0},draw(t,h,b,s={}){if(!G.length)return;let[S,$]=b;G.forEach((r,R)=>{if("clip"in r.at)return oe.set(r.at.clip,R*se);let q=r.ox+r.at.x,A=r.oy+r.at.y;oe.set([2*r.s/S,0,0,0,0,-2*r.s/$,0,0,2*r.s*r.shear[0]/S,-2*r.s*r.shear[1]/$,-1/(2*xe),0,2*q/S-1,1-2*A/$,.5,1],R*se)}),e.queue.writeBuffer(B,0,oe,0,G.length*se);let ie=Ae(),U=t.beginRenderPass({label:"blocks: depth from the light",colorAttachments:[],depthStencilAttachment:{view:ie.view,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});U.setPipeline(d),U.setVertexBuffer(0,T),U.setVertexBuffer(1,p.pos),G.forEach((r,R)=>{r.count&&(U.setViewport(r.region[0],r.region[1],r.region[2],r.region[3],0,1),U.setScissorRect(r.region[0],r.region[1],r.region[2],r.region[3]),U.setBindGroup(0,Be,[R*L]),U.draw(36,r.count,0,r.first))}),U.end();let _=s.depth?null:Ce(b),ee=s.depth?"load":"clear",m=t.beginRenderPass({label:"blocks: the pictures",colorAttachments:[_?.color?{view:_.color.createView(),resolveTarget:h,loadOp:ee,storeOp:"discard"}:{view:h,loadOp:ee,storeOp:"store"}],depthStencilAttachment:s.depth?{view:s.depth,depthLoadOp:"load",depthStoreOp:"store"}:{view:_.depth.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});G.forEach((r,R)=>{if(!("clip"in r.at)){let q=Math.max(0,r.at.x),A=Math.max(0,r.at.y),W=Math.min(S,r.at.x+r.w),te=Math.min($,r.at.y+r.h);if(W<=q||te<=A)return;m.setScissorRect(q,A,W-q,te-A)}m.setBindGroup(0,ie.group,[R*L]),n||(m.setPipeline(P),m.draw(4,4)),m.setPipeline(c),m.draw(4),r.count&&(m.setPipeline(l),m.setVertexBuffer(0,T),m.setVertexBuffer(1,p.pos),m.setVertexBuffer(2,p.col),m.setVertexBuffer(3,p.ao),m.setVertexBuffer(4,p.normals),m.draw(36,r.count,0,r.first),r.glows&&(m.setPipeline(o),m.setVertexBuffer(0,p.pos),m.setVertexBuffer(1,p.col),m.draw(6,r.count,0,r.first)))}),m.end(),G.length=0,z=0,Z=ne=J=0},reserve(t){t>K&&!G.length&&he(2**Math.ceil(Math.log2(t)))},rest:Pe,bytes(){let t=M.reduce((h,b)=>h+b.size[0]*b.size[1],0);return(H?f*f*4:0)+K*60+t*4*i*(i>1?2:1)},destroy(){Pe(),p?.pos.destroy(),p?.col.destroy(),p?.ao.destroy(),p?.normals.destroy(),B.destroy(),T.destroy()}}}function de(e){throw new Error(`blocks: ${e}`)}var Se=e=>Math.ceil(e/256)*256;async function Le(){if(!navigator.gpu)return null;let e=await navigator.gpu.requestAdapter();if(!e)return null;let u=e.limits.maxTextureDimension2D;return{device:await e.requestDevice({requiredLimits:{maxTextureDimension2D:u}}),format:navigator.gpu.getPreferredCanvasFormat(),most:u}}async function Ee(){let e=performance.now(),u=1024,y=4e3,n={draws:0,drawMs:0,flushes:0,flushMs:0,first:0,opened:0,ready:0,lost:0,faults:[]},i=null,f=!1,w=async()=>{let a=await Le();if(!a)return null;n.opened||=performance.now()-e;let{device:d}=a;d.addEventListener("uncapturederror",c=>n.faults.push(c.error.message));let l={...a,pass:await Ge(d,a.format)};return d.lost.then(async c=>{if(!(f||i!==l)){i=null,n.lost++,n.faults.push(`lost: ${c.reason??""} ${c.message}`),x.length=0,g.length=0;for(let o=0;o<3&&!i&&!f;o++)o&&await new Promise(P=>setTimeout(P,1e3*o)),i=await w().catch(P=>(n.faults.push(`not opened again: ${P instanceof Error?P.message:String(P)}`),null));i?N.onrestore?.():(n.faults.push("no device could be opened again"),N.onfail?.())}}),l};if(i=await w(),!i)return null;n.ready=performance.now()-e;let g=[],E=(a,d,l)=>{let c=Math.min(a.most,Se(d)),o=Math.min(a.most,Se(l)),P=g.findIndex(B=>B.width===c&&B.height===o);if(P>=0){let[B]=g.splice(P,1);return g.push(B),B}g.length===4&&g.shift().destroy();let T=a.device.createTexture({size:[c,o],format:a.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});return g.push(T),T},X=new WeakMap,ae=(a,d)=>{let l=X.get(d);return l||X.set(d,l={context:d.getContext("webgpu"),w:0,h:0,device:a.device}),(l.w!==d.width||l.h!==d.height||l.device!==a.device)&&(l.w=d.width,l.h=d.height,l.device=a.device,l.context.configure({device:a.device,format:a.format,alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST})),l.context},x=[],v=0,C=0,V=0,D=0,O=0,k=!1,Q,F=()=>{k=!1;let a=i;if(!x.length||!a)return;let d=performance.now(),l=a.device.createCommandEncoder(),c=E(a,D,O);a.pass.draw(l,c.createView(),[c.width,c.height]);for(let o of x){if(!o.w||!o.canvas.isConnected||o.canvas.width<1||o.canvas.height<1)continue;let P=Math.min(o.w,o.canvas.width,c.width-o.x),T=Math.min(o.h,o.canvas.height,c.height-o.y);l.copyTextureToTexture({texture:c,origin:[o.x,o.y]},{texture:ae(a,o.canvas).getCurrentTexture()},[P,T])}a.device.queue.submit([l.finish()]),x.length=0,v=C=V=D=O=0,n.flushes++,n.flushMs+=performance.now()-d,n.first||(n.first=performance.now()),clearTimeout(Q),Q=setTimeout(()=>{if(!(x.length||!i)){i.pass.rest();for(let o of g)o.destroy();g.length=0}},y)},N={get device(){return i?.device??de("the device is lost")},stats:n,onrestore:null,onfail:null,put(a,d){let l=i,c=a.wpx,o=a.hpx;if(f||c<1||o<1)return!1;if(!l)return!0;let P=performance.now();(c>l.most||o>l.most)&&(n.faults.some(T=>T.startsWith("a part larger"))||n.faults.push(`a part larger than the device's largest texture (${c} x ${o}, ${l.most}) is cut off`)),v+c>u&&v>0&&(v=0,C+=V,V=0),C+o>u&&x.length&&F(),l.pass.lay(a,{x:v,y:C})||(F(),l.pass.lay(a,{x:0,y:0})||de("a part that cannot be laid alone"));for(let T of x)T.canvas===d&&(T.w=0);return x.push({canvas:d,x:v,y:C,w:c,h:o}),D=Math.max(D,v+c),O=Math.max(O,C+o),v+=c,V=Math.max(V,o),k||(k=!0,queueMicrotask(F)),n.draws++,n.drawMs+=performance.now()-P,!0},settle(){return F(),i?i.device.queue.onSubmittedWorkDone():Promise.resolve()},bytes(){return(i?.pass.bytes()??0)+g.reduce((a,d)=>a+d.width*d.height*4,0)},destroy(){f=!0,clearTimeout(Q),i?.pass.destroy();for(let a of g)a.destroy();i?.device.destroy(),i=null}};return N}async function Ne(){let e=await Ee();if(!e)return null;let u={ownsCanvas:!0,stage:e,draw:(y,n)=>e.put(y,n)};return e.onrestore=()=>u.onrestore?.(),e.onfail=()=>u.onfail?.(),u}export{Ne as a};
