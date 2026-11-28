// Unit tests for the driving camera suite (engine/page/drive-cam.ts): verifies close chase low stance
// without pitch-height compounding, far/hood/bumper/cinema contrast, dynamic drift swing + lateral blur,
// speed energy ramping, elastic longitudinal pull/lean-in, and strict prefers-reduced-motion compliance.
import { createDriveCam, DRIVE_CAM_MODES, nextDriveCam } from '../page/drive-cam.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

globalThis.innerWidth = 1280
globalThis.innerHeight = 720

const baseCtx = (over = {}) => ({
  dt: 1 / 60,
  at: [1000, 7.5, 1000],
  rot: [0, 0, 0, 1],
  front: [0, 0, -1],
  size: [19, 13, 45],
  visualBox: [0, 0, 0, 19.2, 12.8, 45],
  frontAxis: 3,
  topSpeed: 590,
  place: (local) => [1000 + local[0] - 9.5, 7.5 + local[1] - 6.5, 1000 + local[2] - 22.5],
  vel: [0, 0, 0],
  fwdSpeed: 0,
  latSpeed: 0,
  horizSpeed: 0,
  longAcc: 0,
  steer: 0,
  drifting: false,
  feet: 4,
  turn: [0, 0],
  lookBack: false,
  reducedMotion: false,
  ...over,
})

const makeHarness = () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }
  let lens = { fovAdd: 0, rollAdd: 0, energy: 0, driftBlur: 0 }
  const cam = createDriveCam({
    pose,
    ground: () => 0,
    stands: () => false,
    lens: (fovAdd, rollAdd, energy, driftBlur = 0) => { lens = { fovAdd, rollAdd, energy, driftBlur } },
  })
  cam.sync(0, 0, true)
  return { cam, pose, lens: () => lens }
}

// 1. Close chase low heroic stance (no pitch-compounding drone height)
{
  const { cam, pose } = makeHarness()
  for (let i = 0; i < 60; i++) cam.frame(baseCtx())
  const carY = 0.75, roofY = carY + 0.65
  const distBehindCenter = pose.z - 100
  const eyeAboveRoof = pose.y - roofY
  check(eyeAboveRoof > 0.70 && eyeAboveRoof < 1.10, `close chase eye sits low just over the roofline (${eyeAboveRoof.toFixed(2)} m above roof, eye y=${pose.y.toFixed(2)} m)`)
  check(distBehindCenter > 6.0 && distBehindCenter < 7.0, `close chase sits tight behind the car (${distBehindCenter.toFixed(2)} m behind center, ${(distBehindCenter - 2.25).toFixed(2)} m behind bumper)`)
  check(pose.pitch < -0.08 && pose.pitch > -0.13, `close chase keeps a nearly level forward sightline over the roof (pitch=${pose.pitch.toFixed(3)} rad)`)

  // Far chase gives clear wider & higher contrast
  cam.setMode('far')
  for (let i = 0; i < 90; i++) cam.frame(baseCtx())
  const farDist = pose.z - 100
  const farAboveRoof = pose.y - roofY
  check(farDist > distBehindCenter + 0.6 && farAboveRoof > eyeAboveRoof + 0.12, `far chase gives clear wider & higher contrast (dist=${farDist.toFixed(2)} m, +${farAboveRoof.toFixed(2)} m over roof)`)
}

// 2. Portrait phone framing pulls back & pitches to protect bottom-right touch keypad clearance
{
  globalThis.innerWidth = 390
  globalThis.innerHeight = 844
  const { cam, pose } = makeHarness()
  for (let i = 0; i < 60; i++) cam.frame(baseCtx())
  const portDist = pose.z - 100
  check(portDist > 7.8 && portDist < 9.0 && pose.pitch < -0.10, `portrait phone close chase scales back cleanly (dist=${portDist.toFixed(2)} m, pitch=${pose.pitch.toFixed(3)} rad)`)
  globalThis.innerWidth = 1280
  globalThis.innerHeight = 720
}

// 2b. A phone on its side (iPhone 17 Pro Max, 956x440) brings the chase in, so the car keeps a 16:9 desktop's share of the width
{
  const { cam, pose } = makeHarness()
  for (let i = 0; i < 60; i++) cam.frame(baseCtx())
  const deskDist = pose.z - 100
  globalThis.innerWidth = 956
  globalThis.innerHeight = 440
  const wide = makeHarness()
  for (let i = 0; i < 60; i++) wide.cam.frame(baseCtx())
  const wideDist = wide.pose.z - 100
  check(wideDist < deskDist - 0.6 && wideDist > deskDist * 0.75, `landscape phone close chase sits closer than desktop (${wideDist.toFixed(2)} m vs ${deskDist.toFixed(2)} m)`)
  globalThis.innerWidth = 1280
  globalThis.innerHeight = 720
}

// 3. Elastic accel pull-back & brake lean-in + speed energy threshold (~35 km/h)
{
  const { cam, pose, lens } = makeHarness()
  for (let i = 0; i < 40; i++) cam.frame(baseCtx())
  const restDist = pose.z - 100

  // Hard acceleration at 50 km/h (139 cells/s) — should already produce speed energy (> 0) and pull back
  for (let i = 0; i < 60; i++) cam.frame(baseCtx({ vel: [0, 0, -140], fwdSpeed: 140, horizSpeed: 140, longAcc: 120 }))
  const accelDist = pose.z - 100
  const e50 = lens().energy
  check(accelDist > restDist + 0.35, `hard acceleration pulls close chase back (+${(accelDist - restDist).toFixed(2)} m)`)
  check(e50 > 0.08 && lens().fovAdd > 1.0, `50 km/h cruising already ramps speed energy (${e50.toFixed(2)}) and FOV (+${lens().fovAdd.toFixed(1)} deg)`)

  // Hard braking leans camera subtly closer
  for (let i = 0; i < 60; i++) cam.frame(baseCtx({ vel: [0, 0, -60], fwdSpeed: 60, horizSpeed: 60, longAcc: -140 }))
  const brakeDist = pose.z - 100
  check(brakeDist < restDist - 0.15, `hard braking leans close chase subtly closer (${(brakeDist - restDist).toFixed(2)} m)`)
}

// 4. Dynamic drift swing & tangential drift motion blur
{
  const { cam, pose, lens } = makeHarness()
  for (let i = 0; i < 30; i++) cam.frame(baseCtx({ vel: [0, 0, -250], fwdSpeed: 250, horizSpeed: 250 }))
  // Active right drift: car heading right (+0.35 rad) while sliding left-lateral
  const driftYaw = 0.35
  for (let i = 0; i < 60; i++) {
    cam.frame(baseCtx({
      front: [Math.sin(driftYaw), 0, -Math.cos(driftYaw)],
      vel: [Math.sin(0.05) * 260, 0, -Math.cos(0.05) * 260],
      fwdSpeed: 245,
      latSpeed: -82,
      horizSpeed: 260,
      steer: 0.9,
      drifting: true,
    }))
  }
  const ex = pose.x - 100, ez = pose.z - 100
  const carRightX = Math.cos(driftYaw), carRightZ = Math.sin(driftYaw)
  const camRightX = Math.cos(pose.yaw), camRightZ = Math.sin(pose.yaw)
  const flankReveal = ex * carRightX + ez * carRightZ
  const carScreenShift = (-ex) * camRightX + (-ez) * camRightZ
  const driftBlur = Math.abs(lens().driftBlur)
  check(flankReveal > 1.2 && carScreenShift < -0.4, `active drift reveals car rear-quarter flank (+${flankReveal.toFixed(2)} m) and opens turn ahead (car shifted ${carScreenShift.toFixed(2)} m)`)
  check(driftBlur > 0.35, `active drift drives strong tangential drift motion blur (|driftBlur|=${driftBlur.toFixed(2)})`)
}

// 5. prefers-reduced-motion strictly zeroes speed streaks, drift blur, and dynamic FOV
{
  const { cam, lens } = makeHarness()
  for (let i = 0; i < 60; i++) {
    cam.frame(baseCtx({
      vel: [-60, 0, -400],
      fwdSpeed: 400,
      latSpeed: -80,
      horizSpeed: 405,
      longAcc: 140,
      steer: 1,
      drifting: true,
      reducedMotion: true,
    }))
  }
  const l = lens()
  check(l.energy === 0 && l.driftBlur === 0 && l.fovAdd === 0 && l.rollAdd === 0, `prefers-reduced-motion strictly zeroes motion blur & dynamic lens (${JSON.stringify(l)})`)
}

// 6. Mode cycle order includes all 6 modes and wraps cleanly
{
  const seen = []
  let m = DRIVE_CAM_MODES[0]
  for (let i = 0; i < DRIVE_CAM_MODES.length; i++) { seen.push(m); m = nextDriveCam(m) }
  check(seen.join() === DRIVE_CAM_MODES.join() && m === DRIVE_CAM_MODES[0], `mode cycle covers all 6 modes cleanly (${seen.join(' -> ')})`)
}

if (failures.length) {
  console.error(`FAILED\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('drive-cam: ok')
