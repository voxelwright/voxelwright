// The page stage (#430), checked: blocks/stage.ts and blocks/pass.ts in the installed Chrome with WebGPU, nothing
// stubbed, on parts made by hand (blocks/proof/check.html), so that no other checkout is needed. It holds the stage
// to what the Voxelmorphism kit is promised:
//
//   a material's front face comes out as the colour it was given, and the picture is clear where nothing is
//   every cube shows as a cube: its edges towards the light are lit, those away from it shaded
//   parts drawn together in one turn are the parts drawn each alone
//   the page hides what is under it, except through a well
//   at rest nothing is drawn, and the textures parts are drawn through are let go
//   a lost device is opened again, whoever put the parts is told, and the picture is the same
//
//   node test/blocks.mjs
import { chrome } from './kit.mjs'
import { serve } from '../blocks/serve.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const site = await serve(0), browser = await chrome()
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${site.url}/blocks/proof/check.html`)
  await page.waitForFunction(() => globalThis.check)
  const said = await page.evaluate(() => globalThis.check())
  if (said.none) failures.push('this browser gave no WebGPU device')
  else {
    check(Math.max(...[14, 34, 255, 255].map((v, i) => Math.abs(v - said.front[i]))) <= 1, `enamel's front face is #0e22ff (${said.front})`)
    check(said.corner.every((v) => v === 0), `the picture is clear where nothing is (${said.corner})`)
    const expected = { middle: 200, left: 216, right: 180, top: 223, bottom: 172 }
    check(Object.entries(expected).every(([side, value]) => Math.abs(said.cube[side] - value) <= 2), `a cube keeps its face colour and its chamfer follows the light (${JSON.stringify(said.cube)})`)
    check(said.turnedApart.every(delta => delta <= 2), `quarter turns about x, y and z leave the lit edges in place (differences ${said.turnedApart})`)
    check(said.flatFace.every(delta => delta <= 1), `a no-seam cube or a zero-seam light leaves the whole face flat (differences ${said.flatFace})`)
    const [left, middle, right] = said.worldEdges
    check(said.worldSmall === 0 && Math.abs(said.worldMiddle - 160) <= 2 && left > middle + 5 && right < middle - 5, `world edges disappear at 3 px (middle ${said.worldMiddle}, difference ${said.worldSmall}) and face the light at 8 px (${said.worldEdges})`)
    const [legacy, matte, muted, shiny] = said.finishes, spread = values => Math.max(...values) - Math.min(...values)
    check(said.spareIgnored === 0 && said.occludedApart[0] > 5 && said.occludedApart[1] === 0 && legacy.every((value, index) => value === said.oldEdge[index]), 'old frames ignore the finish bytes; 255/0 retains the old edge and corner occlusion')
    check(spread(matte) <= 1 && spread(muted) > spread(matte) && spread(muted) < spread(legacy), `at 4 px the green-channel range responds to the chamfer byte: ${[matte, muted, legacy].map(spread)}`)
    check(Math.min(...shiny) > Math.max(...matte) + 5 && said.unlitApart === 0 && said.worldSpec[0] > said.worldSpec[1] + 12, `specular needs direct light and follows the world camera: page matte/gloss ${matte[1]}/${shiny[1]}, world ${said.worldSpec}`)
    const [hard, soft] = said.shadows
    check(soft.fringe > hard.fringe && soft.core > 0 && hard.faceDiff === 0 && soft.faceDiff === 0 && said.shadowOmitted === 0 && said.shadowOff === 0, `ground softness widens the fringe, keeps a contact shadow and leaves faces, legacy radius and shadow-off intact: ${JSON.stringify(said.shadows)}`)
    check(said.filled && said.aloneApart <= 2, `40 parts drawn in one turn, on ${said.sheets} sheet${said.sheets === 1 ? '' : 's'}, are the same drawn each alone (apart by ${said.aloneApart} of 255 at most)`)
    check(said.underPage === 0 && said.throughWell === 255, `a slab under the page is not seen (${said.underPage}), and is seen through a well (${said.throughWell})`)
    check(said.drawnAtRest.every((n) => n === 0) && said.heldAtRest < said.heldDrawing / 4, `at rest nothing is drawn (${said.drawnAtRest}), and ${(said.heldDrawing / 2 ** 20).toFixed(1)} MB held while drawing is ${(said.heldAtRest / 2 ** 20).toFixed(1)} MB`)
    check(said.lost.times === 1 && said.lost.told === 1 && said.lost.apart >= 0 && said.lost.apart <= 2, `a lost device is opened again, the parts are asked for once, and the picture is the same (${JSON.stringify(said.lost)})`)
    check(said.faults.length === 0, `the device reported no fault (${said.faults.join('; ')})`)
  }
} catch (e) {
  failures.push(String(e))
}
await browser.close()
site.stop()
if (failures.length) { console.error(`FAILED:\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('PASSED')
