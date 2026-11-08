// Page-free proof (#48) that a villager leaves a build-mode room through its doorway only when standing in
// that room: src/villagers/world.ts's routeFrom with a spot that carries its room's floor outline.
// Usage: node scripts/check-route-inside.mjs   Vite loads the TypeScript in-process (no port, no browser). Synthetic data only.
import { createServer } from 'vite'

const vite = await createServer({ root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } })
let failed = 0, total = 0
const check = (name, ok, detail) => {
  total++
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`)
}
try {
  const W = await vite.ssrLoadModule('/src/villagers/world.ts')
  // A synthetic room built on the kitchen's left wall (x = -3.4): floor from x -6.4 to -3.4, z 0 to 2, its door at z = 1.
  const floor = [[-6.4, 0], [-3.4, 0], [-3.4, 2], [-6.4, 2]]
  const through = [[-2.95, 1], [-3.85, 1]]
  const spot = { at: [-4.2, 1], face: 0, via: W.nearestNode(-2.95, 1, 'open') ?? 'f0', through }
  const usesDoor = (curve) => curve.points.some((p) => Math.hypot(p.x - through[1][0], p.z - through[1][1]) < 0.05)
  const route = (x, z) => W.routeFrom(x, z, 'sink', 'open')

  W.setSpot('check-room', { ...spot, floor })
  // Just outside the room's front wall (z = 2), 1.3 m from the spot: not in the room, so not led back through its door.
  check('a villager just outside the new room\'s wall, within 1.5 m of its spot, is not routed through its doorway', !usesDoor(route(-4.2, 2.3)), route(-4.2, 2.3).points)
  check('a villager standing in the new room leaves through its doorway', usesDoor(route(-4.2, 1.4)), route(-4.2, 1.4).points)
  // A spot without a floor outline keeps the distance rule.
  W.setSpot('check-room', spot)
  check('a spot without a floor outline still treats anyone within 1.5 m as inside', usesDoor(route(-4.2, 2.3)), route(-4.2, 2.3).points)
} finally {
  await vite.close()
}
console.log(`${total - failed}/${total} checks pass`)
process.exit(failed ? 1 : 0)
