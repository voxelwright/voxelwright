Write a TypeScript module with no imports that exports exactly:

export function build(api) { ... return group }

`api` holds everything you may use:
- api.THREE: the three.js namespace (r187, `three/webgpu`). Use MeshStandardMaterial (color, map, roughness, metalness), BoxGeometry, CylinderGeometry, SphereGeometry, LatheGeometry, ExtrudeGeometry, Shape, TorusGeometry, Group, Mesh, Vector2, Color.
- api.RoundedBoxGeometry(width, height, depth, segments, radius): a rounded box geometry class (use `new`).
- api.paint: textures painted in code, all return a THREE texture unless noted:
  - paintWood({ seed, planks, light: [r,g,b], dark: [r,g,b], knots, w: 256, h: 256 }) grain runs along x. Always pass w: 256, h: 256.
  - paintFabric(seed, base: [r,g,b], pattern: 'plain'|'stripes'|'check'|'velvet', accent: [r,g,b])
  - paintWallpaper(seed, pattern: 'plain'|'stripes'|'floral'|'trellis', ground: [r,g,b], ink: [r,g,b], stripeWidthFraction)  (texture repeats; set .repeat yourself)
  - paintPlaster(seed, base: [r,g,b], 256, 256, 0.3) a soft painted surface
  - paintBrushed(seed) brushed steel

Return a THREE.Group of meshes. Set castShadow and receiveShadow on meshes. Keep it under about 60 meshes. Do not touch the scene, renderer, DOM, network or timers.

Example in the house style (an existing chair):

export function build(api) {
  const { THREE, RoundedBoxGeometry, paint } = api
  const pine = new THREE.MeshStandardMaterial({ map: paint.paintWood({ seed: 13, planks: 1, light: [232, 190, 132], dark: [196, 150, 98], knots: 1, w: 256, h: 256 }), roughness: 0.5 })
  const cushion = new THREE.MeshStandardMaterial({ color: '#e3dccf', roughness: 0.95 })
  const chair = new THREE.Group()
  const seatY = 0.45, w = 0.42, d = 0.42
  const part = (geo, x, y, z, mat = pine) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = m.receiveShadow = true
    chair.add(m)
    return m
  }
  part(new THREE.BoxGeometry(w, 0.03, d), 0, seatY, 0)
  for (const x of [-1, 1]) part(new THREE.BoxGeometry(0.035, seatY, 0.035), x * (w / 2 - 0.02), seatY / 2, d / 2 - 0.02)
  for (const x of [-1, 1]) part(new THREE.BoxGeometry(0.035, 0.95, 0.035), x * (w / 2 - 0.02), 0.475, -d / 2 + 0.02)
  part(new THREE.BoxGeometry(w, 0.07, 0.025), 0, 0.9, -d / 2 + 0.02)
  for (let i = 0; i < 4; i++) part(new THREE.BoxGeometry(0.03, 0.29, 0.016), -0.12 + i * 0.08, 0.735, -d / 2 + 0.02)
  part(new RoundedBoxGeometry(w - 0.04, 0.05, d - 0.04, 3, 0.02), 0, seatY + 0.04, 0.01, cushion)
  return chair
}

Fence the answer as ```ts.
