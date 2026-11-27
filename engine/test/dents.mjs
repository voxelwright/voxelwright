// A car struck hard is dented where it was struck (#37, page/deform.ts): the fine car of `?living=finecar`, driven
// into a block of concrete by the real core in real Chrome. Its look takes a dent at the corner it struck, the
// driver's head room stays clear, the picture of that corner changes (read from the screen, against the same view
// repaired), repair makes it as it was made, and a car taken away leaves no dents behind for the next.
//
//   node test/dents.mjs [--out dir]     with --out: the struck corner, dented and repaired
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { arg, start, still } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const { city, check, finish } = await start()
const page = await city('fire=0&people=0&hour=11', { size: [1280, 720], dpr: 1 })
await still(page)
await page.evaluate(async () => {
  const e = globalThis.engine, x = 600, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
  const add = e.falling.add.bind(e.falling)
  globalThis.parts = []
  e.falling.add = (...args) => {
    const part = add(...args)
    globalThis.parts.push(part)
    return part
  }
  globalThis.car = await e.alive.spawn(e.car([x, ground + 5, z]))
})
await page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.where(globalThis.car), null, { timeout: 20_000 })
const drive = async (go, ms) => { const end = Date.now() + ms; while (Date.now() < end) { await page.evaluate((go) => globalThis.engine.alive.drive(globalThis.car, go, 0, 0), go); await page.waitForTimeout(100) } }
// A block ahead and to its right: struck on its front corner at about 16 km/h.
const faces = await page.evaluate(() => {
  const e = globalThis.engine, w = e.alive.where(globalThis.car)
  for (let k = 0; k < 4; k++) e.set([Math.round(w.at[0]) + 75, Math.round(w.at[1]) + k * 6, Math.round(w.at[2]) + 9], 9, 7)
  return e.falling.faces
})
await page.waitForTimeout(1500)
// The picture's size held, so two pictures of one view differ only in what changed in it.
await page.evaluate(() => { globalThis.engine.scale = 0.75 })
check(await page.evaluate(() => globalThis.engine.alive.damage(globalThis.car) === null && globalThis.engine.alive.look(globalThis.car).parts.length === 1), 'a car() wears a fine look and has no dents before impact')
const wheelsBefore = await page.evaluate(() => [...(globalThis.engine.wheels.state.get(globalThis.car.id)?.wheels ?? [])].map((w) => ({ off: Math.hypot(...w.offset), tilt: w.tilt })))
check(wheelsBefore.length === 4 && wheelsBefore.every((w) => w.off === 0 && w.tilt === 0), 'undamaged wheels have zero deformation offset and tilt')
await drive(1, 2600); await drive(0, 1200); await drive(-1, 1100); await drive(0, 1500)
const struck = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, d = e.alive.damage(t)
  if (!d) return null
  const dents = d.dents.slice(0, d.dentCount).map((x) => ({ center: [...x.center], radius: x.radius, depth: x.depth }))
  // The driver's eye in the look's own cells (its look is one part of 4 cells to the body's, from its low corner).
  const eye = t.eye.map((v) => v * 4), box = [...d.cabin]
  const outside = (p) => Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[3]), Math.max(box[1] - p[1], 0, p[1] - box[4]), Math.max(box[2] - p[2], 0, p[2] - box[5]))
  const wheels = [...(e.wheels.state.get(t.id)?.wheels ?? [])].map((w) => ({ offset: [...w.offset], mag: Math.hypot(...w.offset), tilt: w.tilt }))
  return { dents, hood: d.hoodDamage, scuff: d.scuff, eyeInside: outside(eye) === 0, clear: dents.every((x) => x.depth === 0 || x.radius + 1.18 * x.depth <= outside(x.center) + 1e-6), faces: e.falling.faces, wheels }
})
check(!!struck && struck.dents.some((x) => x.depth > 2), `struck at the corner, its look is dented (${JSON.stringify(struck?.dents.map((x) => [+x.depth.toFixed(1), +x.radius.toFixed(1)]))} fine cells deep and round)`)
check(!!struck && struck.scuff > 0, `its paint is scuffed there (${struck?.scuff.toFixed(2)})`)
check(!!struck && struck.eyeInside && struck.clear, 'the driver\'s eye is in the room kept clear, and no dent reaches into it')
check(!!struck && struck.faces > faces, `a dented look is drawn a cell at a time so that bent faces still meet (${faces} faces, ${struck?.faces} dented)`)
// #61: wheels near the crushed front-right corner move/bend with their dent, while the undamaged rear-left wheel stays put.
const fr = struck?.wheels?.[3], rl = struck?.wheels?.[0]
check(!!fr && !!rl && (fr.mag > 0.15 || fr.tilt > 0.02) && rl.mag < 0.05, `front-right wheel bends with its crushed corner (offset ${fr?.offset.map((v) => v.toFixed(2)).join(', ')}, tilt ${fr?.tilt.toFixed(3)} rad; rear-left ${rl?.mag.toFixed(2)})`)
// #61: per-window crack origins — striking the front windshield then the rear window keeps two distinct origins.
const hit = (local, normal) => page.evaluate(([local, normal]) => {
  const e = globalThis.engine, t = globalThis.car, w = e.alive.where(t)
  const turn = (v) => {
    const [x,y,z,s] = w.rot, tx = 2*(y*v[2]-z*v[1]), ty = 2*(z*v[0]-x*v[2]), tz = 2*(x*v[1]-y*v[0])
    return [v[0]+s*tx+y*tz-z*ty, v[1]+s*ty+z*tx-x*tz, v[2]+s*tz+x*ty-y*tx]
  }
  e.alive.hit(t, turn(local).map((v,i) => v+w.at[i]), turn(normal), 115, 9000)
  return e.alive.look(t).parts[0]?.cracks
}, [local, normal])
const first = (await hit([12,5,0], [1,0.3,0]))?.[0]
const both = await hit([-14,5,0], [-1,0.3,0])
const apart = first && both?.[1] ? Math.hypot(...both[1].map((v,i) => v-first[i])) : 0
check(first && both?.[0]?.every((v,i) => v === first[i]) && apart > 20, `per-window crack origins stay distinct (${apart.toFixed(1)} fine cells apart)`)
// The same view of the struck corner, dented and repaired via KeyF while riding, read from the screen.
const camPose = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, p = e.alive.look(t).parts[0], d = e.alive.damage(t), k = d.dents.slice(0, d.dentCount).reduce((a, x, i) => (x.depth > d.dents[a].depth ? i : a), 0), dent = d.dents[k]
  const turn = (q, v) => { const [x, y, z, s] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)] }
  const c = turn(p.rot, [...dent.center].map((v) => v * p.cell)).map((v, i) => v + p.pos[i]), n = turn(p.rot, [...dent.dir]), a = Math.atan2(n[2], n[0]) + 0.5
  const cam = [c[0] - Math.cos(a) * 20, c[1] + 8, c[2] - Math.sin(a) * 20], v = [c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]]
  return { x: cam[0] / 10, y: cam[1] / 10, z: cam[2] / 10, yaw: Math.atan2(v[0], -v[2]), pitch: Math.atan2(v[1], Math.hypot(v[0], v[2])) }
})
const aim = () => page.evaluate((p) => { Object.assign(globalThis.engine.pose, p) }, camPose)
const clip = { x: 440, y: 210, width: 400, height: 300 }
const shoot = async (name) => { await page.waitForTimeout(700); const png = await page.screenshot({ clip }); if (out) await page.screenshot({ path: join(out, `${name}.png`) }); return png }
const compare = (a, b) => page.evaluate(async ([a,b]) => {
  const read = async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const g = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
    g.drawImage(bitmap, 0, 0)
    return g.getImageData(0, 0, bitmap.width, bitmap.height)
  }
  const x = await read(a), y = await read(b)
  let sum = 0
  const rows = []
  for (let row = 0; row < x.height; row++) {
    let bright = 0
    for (let col = 0; col < x.width; col++) {
      const i = (row*x.width+col)*4
      const r = x.data[i]-y.data[i], g = x.data[i+1]-y.data[i+1], b = x.data[i+2]-y.data[i+2]
      sum += (Math.abs(r)+Math.abs(g)+Math.abs(b))/3
      if ((r+g+b)/3 > 24) bright++
    }
    rows.push(bright/x.width)
  }
  const rowBand = Math.max(...rows.slice(3,-3).map((v,i) => v - (rows[i]+rows[i+6])/2))
  return {mean: sum/(x.width*x.height), rowBand}
}, [a.toString('base64'), b.toString('base64')])
const differ = async (a,b) => (await compare(a,b)).mean
await aim()
const dented = await shoot('dented')
const kept = await page.evaluate(() => { const d = globalThis.engine.alive.damage(globalThis.car); return d.dentCount })
// #61, #62: mount into the first-person seat, check the drive card lists F repair, verify the central
// forward driving sightline stays clear through cracked glass (vs repaired from the exact same seat view),
// and repair via KeyF.
await page.evaluate(() => globalThis.engine.alive.mount(globalThis.car))
await page.waitForTimeout(150)
const card = await page.evaluate(() => document.querySelector('#card')?.textContent ?? '')
check(/F\s*repair/i.test(card), `drive card lists F repair ("${card}")`)
await page.evaluate(() => globalThis.engine.alive.view(true))
await page.waitForTimeout(500)
const seatClip = { x: 540, y: 210, width: 200, height: 150 }
const seatDamaged = await page.screenshot({ clip: seatClip })
if (out) await page.screenshot({ path: join(out, 'seat-dented.png') })
await page.keyboard.down('KeyF'); await page.waitForTimeout(80); await page.keyboard.up('KeyF')
await page.waitForTimeout(450)
const seatRepaired = await page.screenshot({ clip: seatClip })
if (out) await page.screenshot({ path: join(out, 'seat-repaired.png') })
const seatDrift = await differ(seatDamaged, seatRepaired)
check(seatDrift < 22, `first-person central road sightline stays clear with a cracked windshield (${seatDrift.toFixed(2)} levels/px diff vs repaired)`)
await page.evaluate(() => { globalThis.engine.alive.view(false); globalThis.engine.alive.mount(null) })
await aim()
const repaired = await shoot('repaired'), again = await shoot('repaired-again')
const change = await differ(dented, repaired), noise = await differ(repaired, again)
check(kept > 0 && change > Math.max(4, noise * 3), `the struck corner looks clearly different dented (${change.toFixed(2)} levels a pixel on average from the same view repaired; ${noise.toFixed(2)} between two pictures of it repaired)`)
const mended = await page.evaluate(() => {
  const e = globalThis.engine, d = e.alive.damage(globalThis.car)
  const wheels = [...(e.wheels.state.get(globalThis.car.id)?.wheels ?? [])].map((w) => ({ off: Math.hypot(...w.offset), tilt: w.tilt }))
  return { dents: d.dentCount, hood: d.hoodDamage, scuff: d.scuff, cracks: e.alive.look(globalThis.car).parts[0]?.cracks ?? null, faces: e.falling.faces, wheels }
})
check(mended.dents === 0 && mended.hood === 0 && mended.scuff === 0 && mended.cracks === null && mended.faces === faces && mended.wheels.every((w) => w.off === 0 && w.tilt === 0), `KeyF repairs dents, cracks, faces and wheels (${JSON.stringify({ dents: mended.dents, hood: mended.hood, scuff: mended.scuff, cracks: mended.cracks, faces: mended.faces })})`)
// A lateral strike near the windshield used to project its fractures edge-on across
// the glass. Switch just the fractures off from the same seat and measure horizontal
// bands on the passenger side, away from the central sightline checked above.
await hit([16,4,8], [0,0,1])
await page.evaluate(() => {
  const e = globalThis.engine
  e.alive.mount(globalThis.car); e.alive.view(true); e.off.add('puffs')
})
await page.waitForTimeout(750)
const passengerGlass = {x: 730, y: 248, width: 440, height: 150}
const cracked = await page.screenshot({clip: passengerGlass})
const strength = await page.evaluate(() => {
  const cracks = globalThis.engine.alive.damage(globalThis.car).glassCrack
  const strength = Math.max(...cracks); cracks.fill(0); return strength
})
await page.waitForTimeout(200)
const clear = await page.screenshot({clip: passengerGlass})
const glass = await compare(cracked, clear)
check(strength > 0 && glass.rowBand < 0.5, `side impact leaves no bright scanlines across the windshield (row contrast ${glass.rowBand.toFixed(2)})`)
await page.evaluate(() => { const e = globalThis.engine; e.off.delete('puffs'); e.alive.view(false); e.alive.mount(null) })
// Listen at the smoke system's real entry point. A burning front corner must vent
// into air on that side, even after the car has turned. Map the point back into the
// undeformed fine cells to check the actual occupancy at the source.
await page.evaluate(() => {
  const e = globalThis.engine, emit = e.smoke.engine.bind(e.smoke)
  e.alive.repair(globalThis.car)
  // Read the hot instances actually submitted to the renderer. Detached burning puffs
  // used to drift up even when their spawn position was correct.
  globalThis.flameDraws = []
  // Isolate a small steam emission in empty air beside the car. Read the first
  // visible billows at their drawn size and age to catch a puff painted on the metal.
  const steamAt = e.alive.where(globalThis.car).at.map((v,i) => v + (i === 1 ? 100 : 0))
  globalThis.steamClearance = []
  globalThis.woodChips = []
  // Wood from struck scenery used to leave hand-sized boxes among the paint chips.
  e.debris.dust(steamAt, 10, 4, [0.49,0.26,0.10])
  for (let i=0; i<16; i++) emit(steamAt, 0.50, 1)
  const draw = e.smoke.draw.bind(e.smoke)
  const write = GPUQueue.prototype.writeBuffer
  e.smoke.draw = (encoder, target, view) => {
    globalThis.puffAnchor = view.eye.map(x => Math.floor(x / 64) * 64)
    draw(encoder, target, view)
  }
  const drawCrumbs = e.debris.draw.bind(e.debris)
  e.debris.draw = (encoder, target, view) => {
    globalThis.puffAnchor = view.eye.map(x => Math.floor(x / 64) * 64)
    drawCrumbs(encoder, target, view)
  }
  GPUQueue.prototype.writeBuffer = function(buffer, offset, data, start, count) {
    if (buffer.label === 'crumb instances' && globalThis.woodChips.length < 4) {
      for (let i=0; i<count; i+=8) {
        if (Math.hypot(...steamAt.map((v,j) => data[i+j] + globalThis.puffAnchor[j] - v)) > 5) continue
        if (data[i+4] > data[i+5] && data[i+5] > data[i+6]) globalThis.woodChips.push([data[i+3], data[i+7]])
      }
    }
    if (buffer.label === 'puff instances') {
      for (let i = 0; i < count; i += 12) {
        const age = data[i+10], visibleFrom = data[i+11]
        const height = data[i+1] + globalThis.puffAnchor[1] - steamAt[1]
        if (height >= 0 && height < 35 && age >= visibleFrom + 0.02 && age < 0.45 && data[i+4] > 0.80) {
          globalThis.steamClearance.push(height - data[i+3])
        }
      }
    }
    if (buffer.label === 'torn body mesh') globalThis.brokenNose = data.slice()
    if (buffer.label === 'puff instances' && globalThis.burningVent && globalThis.flameDraws.length < 24) {
      const errors = []
      for (let i = 0; i < count; i += 12) {
        if (data[i+8] <= 0 || Math.abs(data[i+7] - 0.22) > 0.001) continue
        const delta = globalThis.burningVent.map((p,j) => data[i+j] + globalThis.puffAnchor[j] - p)
        errors.push(Math.hypot(...delta))
      }
      globalThis.flameDraws.push(errors)
    }
    return write.apply(this, arguments)
  }
  e.smoke.engine = (at, level, dt) => {
    if (level > 0.92) globalThis.burningVent = [...at]
    emit(at, level, dt)
  }
})
for (let i=0; i<4; i++) await hit([19,4,7], [1,0,0.25])
await page.waitForFunction(() => globalThis.burningVent, null, {timeout: 5000})
const ventInBody = () => page.evaluate(async () => {
  const {deformPointCpu} = await import('/page/deform.ts')
  const e = globalThis.engine, t = globalThis.car, part=e.alive.look(t).parts[0]
  const v = globalThis.burningVent.map((x,i) => (x-part.pos[i])/part.cell)
  const [x,y,z,w] = part.rot
  const tx=2*(y*v[2]-z*v[1]), ty=2*(z*v[0]-x*v[2]), tz=2*(x*v[1]-y*v[0])
  const bent = [v[0]-w*tx+y*tz-z*ty,v[1]-w*ty+z*tx-x*tz,v[2]-w*tz+x*ty-y*tx]
  let rest=[...bent]
  const d=e.alive.damage(t)
  for (let i=0; i<20; i++) {
    const warped=deformPointCpu(rest,[1,0,0],d).pos
    rest=rest.map((p,j)=>p+bent[j]-warped[j])
  }
  const [a,b,c]=rest.map(Math.floor), {size,cells}=t.fine[0]
  const opening = globalThis.parts.find(p => p.deform === d)?.opening
  const inSocket = opening?.removed.has(a | (b << 10) | (c << 20)) ?? false
  const recess = opening ? (opening.face[opening.axis] - rest[opening.axis]) * opening.sign * part.cell : 0
  const inside=!inSocket && a>=0 && a<size[0] && b>=0 && b<size[1] && c>=0 && c<size[2] && cells[a+size[0]*(c+size[2]*b)]!==0
  return {rest,inside,inSocket,recess,front:rest[0]/size[0],side:rest[2]/size[2]}
})
await page.waitForFunction(() => globalThis.flameDraws.length >= 24, null, {timeout: 8000})
const flames = await page.evaluate(() => globalThis.flameDraws)
check(flames.every(frame => frame.length === 1 && frame[0] < 0.015), 'each burning frame draws one flame attached to the vent')
const socket = await page.evaluate(async () => {
  const { COUPE_KINDS } = await import('/page/car-sculpt.ts')
  const damage = globalThis.engine.alive.damage(globalThis.car)
  const opening = globalThis.parts.find(p => p.deform === damage)?.opening, drawn = globalThis.brokenNose
  if (!opening || !drawn) return null
  const walls = new Set()
  for (let w = 0; w < opening.walls.length; w += 2) walls.add(opening.walls[w] + ':' + opening.walls[w+1])
  let closed = 0, interior = 0, looseAmber = 0, otherAmber = 0
  for (let i = 0; i < drawn.length; i += 6) {
    if (!drawn[i+1]) continue
    if (opening.removed.has(drawn[i])) closed++
    if (walls.has(drawn[i] + ':' + drawn[i+1])) interior++
    if ((drawn[i+1] >>> 16) === COUPE_KINDS.amber) {
      const z = drawn[i] >>> 20
      if (z > globalThis.car.fine[0].size[2] / 2) looseAmber++
      else otherAmber++
    }
  }
  return { removed: opening.removed.size, closed, interior, looseAmber, otherAmber }
})
check(socket && socket.removed >= 8 && socket.closed === 0 && socket.interior >= 4, `the rendered vent has missing outer skin and recessed inner faces (${JSON.stringify(socket)})`)
check(socket?.looseAmber === 0 && socket.otherAmber > 0, 'breaking the lamp takes its amber lens tip with it and preserves the opposite indicator')
const vent = await ventInBody()
check(vent.inSocket && vent.recess > 0.35, `the flame root sits behind the torn lip in an actual open cell (${vent.recess.toFixed(2)} cells deep)`)
check(!vent.inside && vent.front>0.88 && vent.side>0.58, `flame starts in air at the struck nose opening (length ${vent.front.toFixed(2)}, width ${vent.side.toFixed(2)}, inside skin ${vent.inside})`)
await page.evaluate(() => {
  const e=globalThis.engine, t=globalThis.car, p=e.alive.where(t)
  e.alive.place(t,p.at,[0,Math.SQRT1_2,0,Math.SQRT1_2])
})
await page.waitForFunction(() => Math.abs(globalThis.engine.alive.where(globalThis.car).rot[1]) > 0.64)
await page.waitForTimeout(180)
const wood = await page.evaluate(() => globalThis.woodChips)
check(wood.length >= 4 && wood.every(([size, spin]) => size < 0.38 && spin <= -2), 'wood dust draws small matte splinters')
const steam = await page.evaluate(() => ({ samples: globalThis.steamClearance.length, low: Math.min(...globalThis.steamClearance) }))
check(steam.samples > 0 && steam.low > 0.6, `visible steam clears the emitting surface (${steam.low?.toFixed(2)} cells)`)
const turnedVent = await ventInBody()
check(!turnedVent.inside && Math.hypot(...turnedVent.rest.map((v,i)=>v-vent.rest[i]))<0.25, 'the vent follows the same open cells when the damaged car turns')
// #92: engine smoke must rise clear of the hood from every heading (including facing -x into the wind)
// and connect to the flame without a visible gap.
await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, p = e.alive.where(t)
  // Face -x (180° yaw) so the +x world wind blows toward the hood and windscreen.
  e.alive.place(t, p.at, [0, 1, 0, 0])
  globalThis.smokeSamples = []
})
await page.waitForFunction(() => Math.abs(globalThis.engine.alive.where(globalThis.car).rot[1]) > 0.95, null, { timeout: 5000 })
await page.waitForTimeout(1400)
const smokeCheck = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, d = e.alive.damage(t)
  const part = globalThis.parts.find((p) => p.deform === d)
  const vent = globalThis.burningVent
  if (!part || !vent) return null
  const [qx, qy, qz, qw] = part.rot
  const invRot = (v) => {
    const tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0])
    return [v[0] - qw * tx + qy * tz - qz * ty, v[1] - qw * ty + qz * tx - qx * tz, v[2] - qw * tz + qx * ty - qy * tx]
  }
  const { size, com } = part.born, cell = part.cell
  const roofTop = (size[1] - com[1]) * cell
  const ventLocal = invRot([vent[0] - part.pos[0], vent[1] - part.pos[1], vent[2] - part.pos[2]])
  const halfWide = (size[2] * 0.58) * cell
  return new Promise((resolve) => {
    const write = GPUQueue.prototype.writeBuffer
    let frames = 0, hoodOverlaps = 0, totalVisible = 0, flameConnectedFrames = 0, flameFrames = 0, maxGap = -Infinity
    GPUQueue.prototype.writeBuffer = function(buffer, offset, data, start, count) {
      if (buffer.label === 'puff instances' && frames < 30) {
        frames++
        let flameTop = -Infinity
        const darkSmoke = []
        for (let i = 0; i < count; i += 12) {
          const px = data[i] + globalThis.puffAnchor[0], py = data[i + 1] + globalThis.puffAnchor[1], pz = data[i + 2] + globalThis.puffAnchor[2]
          const sz = data[i + 3], lum = data[i + 4], heat = data[i + 8], age = data[i + 10], late = data[i + 11]
          if (Math.hypot(px - vent[0], py - vent[1], pz - vent[2]) > 35) continue
          if (late < 0 && heat > 0) {
            flameTop = Math.max(flameTop, py + sz * 1.96)
            continue
          }
          // Only count smoke puffs once they have substantially faded in.
          if (heat > 0 || age < late + 0.04) continue
          totalVisible++
          const rel = invRot([px - part.pos[0], py - part.pos[1], pz - part.pos[2]])
          // Any visible smoke whose billboard drifts back behind the nose vent over the hood/windscreen fails.
          if (rel[0] - sz * 0.85 < ventLocal[0] - 1.0 && Math.abs(rel[2]) < halfWide && rel[1] < roofTop + 6) hoodOverlaps++
          // Dark oil smoke (lum < 0.55) must emerge directly from the upper flame with no visible gap.
          if (lum < 0.55 && Math.hypot(px - vent[0], pz - vent[2]) < 5.0) darkSmoke.push(py - sz * 0.35)
        }
        if (flameTop > -Infinity) {
          flameFrames++
          const gap = darkSmoke.length ? Math.min(...darkSmoke) - flameTop : 99
          maxGap = Math.max(maxGap, gap)
          if (gap <= 0.25) flameConnectedFrames++
        }
        if (frames >= 30) {
          GPUQueue.prototype.writeBuffer = write
          resolve({ totalVisible, hoodOverlaps, flameFrames, flameConnectedFrames, maxGap: +maxGap.toFixed(2) })
        }
      }
      return write.apply(this, arguments)
    }
  })
})
check(!!smokeCheck && smokeCheck.totalVisible >= 10 && smokeCheck.hoodOverlaps === 0, `engine smoke stays off the hood when facing into the wind (${JSON.stringify(smokeCheck)})`)
check(!!smokeCheck && smokeCheck.flameFrames > 0 && smokeCheck.flameConnectedFrames / smokeCheck.flameFrames >= 0.9, `engine smoke connects to the flame without a gap (${JSON.stringify(smokeCheck)})`)
// #92: a hard side strike over the rear wheel arch must not carve a stepped unsmoothed voxel staircase into the painted fender.
await page.evaluate(() => { globalThis.engine.alive.repair(globalThis.car) })
for (let i = 0; i < 4; i++) await hit([-13, -2, 9], [0, 0, 1])
await page.waitForTimeout(250)
const archCheck = await page.evaluate(() => {
  const e = globalThis.engine, t = globalThis.car, d = e.alive.damage(t)
  const part = globalThis.parts.find((p) => p.deform === d)
  const dent = d?.dents?.[0]
  return {
    dents: d?.dentCount ?? 0,
    depth: dent ? +(dent.depth * part.cell).toFixed(2) : 0,
    ratio: dent ? +(dent.depth / dent.radius).toFixed(3) : 0,
    // A stepped voxel cutout on the side fender creates unsmoothed dark cap walls (piece.tear.opening).
    fenderCutoutRemoved: part?.tear?.opening?.removed?.size ?? 0,
    fenderCutoutWalls: (part?.tear?.opening?.walls?.length ?? 0) / 2,
  }
})
check(archCheck.dents > 0 && archCheck.depth > 0.8 && archCheck.ratio >= 0.13 && archCheck.fenderCutoutRemoved === 0 && archCheck.fenderCutoutWalls === 0, `side wheel-arch impact produces no stepped voxel cutout (${JSON.stringify(archCheck)})`)
// Taken away, its dents go with it: a body's id may be another thing's later.
const gone = await page.evaluate(() => { const e = globalThis.engine, t = globalThis.car; e.alive.vanish(t); return e.alive.damage(t) })
check(gone === null, 'a car taken away leaves no dents behind')
await finish('dents')
