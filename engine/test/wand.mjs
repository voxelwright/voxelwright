// The wand's aim, for real (#246): the city page in the installed Chrome with WebGPU. With the wand in hand a look
// at a street tree gives the tree and nothing of the street, its crown is a part of it, one side is fewer cells than
// the whole and all of them face one way; a house is too big to be one thing and is taken a part at a time; an
// area lies on the ground and is as big as it is asked to be; a point is where the look meets the world. A hole
// blown in a thing is not part of it afterwards. Keys, the wheel and a phone's buttons do what the bar says.
//
//   node test/wand.mjs
import { start, still } from './kit.mjs'

const { city, check, finish } = await start()
try {
  const page = await city('scale=0.5&fire=0&people=0')
  await still(page)
  // Down in the street.
  await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 10.3; p.pitch = 0 })
  await page.waitForTimeout(300)
  await still(page)
  /** Turns the head until the middle of the picture is on something of a material, near by. */
  const find = (material, most = 200) => page.evaluate(async ([material, most]) => {
    const e = globalThis.engine, p = e.pose
    for (let yaw = -3.14; yaw < 3.14; yaw += 0.06) for (const pitch of [-0.3, -0.12, 0.05, 0.15, 0.35]) {
      p.yaw = yaw; p.pitch = pitch
      const hit = await e.pick(0, 0)
      if (hit && hit.material === material && hit.t < most && hit.t > 40) return true
    }
    return false
  }, [material, most])
  /** The aim from where the eye looks now, as the wand gives it. */
  const aim = (set = {}) => page.evaluate(async (set) => {
    const e = globalThis.engine, w = e.wand
    Object.assign(w, set)
    const t = await w.aim(e.view())
    if (!t) return null
    const out = { how: t.how, says: w.says, box: t.box && [...t.box], at: t.at && [...t.at], cell: t.cell && [...t.cell], normal: t.normal && [...t.normal], share: t.share, partial: t.partial, n: t.kinds?.length }
    if (t.how === 'thing') {
      // What of it is under where someone would stand, what is air, and what does not show a face the pointed way.
      let low = 0, air = 0, hidden = 0
      const stuff = {}
      for (let i = 0; i < t.kinds.length; i++) {
        const x = t.cells[i * 3], y = t.cells[i * 3 + 1], z = t.cells[i * 3 + 2]
        if (y < e.feet(x, z)) low++
        if (!w.kind(x, y, z)) air++
        if (w.kind(x + t.normal[0], y + t.normal[1], z + t.normal[2])) hidden++
        stuff[t.kinds[i] & 15] = (stuff[t.kinds[i] & 15] ?? 0) + 1
      }
      Object.assign(out, { low, air, hidden, stuff, kinds: new Set(t.kinds).size })
    }
    return out
  }, set)
  const size = (t) => [t.box[3] - t.box[0], t.box[4] - t.box[1], t.box[5] - t.box[2]]

  await page.evaluate(() => { globalThis.engine.wand.held = true })
  check(await page.evaluate(() => document.body.classList.contains('wand') && getComputedStyle(document.querySelector('#tools')).display === 'none'), 'in hand, the wand\'s bar stands where the tools were')

  // A street tree (freestanding: wood trunk and leaves crown, not joined to the street).
  check(await find(13), 'a street tree is near')
  const point = await aim({ mode: 'point' })
  check(point?.how === 'point' && point.cell && Math.hypot(...point.at.map((v, a) => v - (point.cell[a] + 0.5))) < 1.5, `a point is on the cell the look meets (${point?.says})`)
  const tree = await aim({ mode: 'thing', share: 'whole' })
  const across = tree ? size(tree) : [0, 0, 0]
  check(tree?.how === 'thing' && tree.share === 'whole' && !tree.partial && tree.n > 1500 && tree.n < 15000, `the tree is one thing (${tree?.n} cells: ${tree?.says})`)
  check(tree && Math.max(across[0], across[2]) > 15 && Math.max(across[0], across[2]) < 55 && across[1] > 25 && across[1] < 80, `and is as big as a tree (${across.join(' by ')} cells)`)
  check(tree && tree.low === 0 && tree.air === 0 && (tree.stuff[13] ?? 0) > tree.n / 2 && !tree.stuff[6], `none of it is the street (${tree?.low} cells under foot, ${tree?.air} of air, ${tree?.stuff[6] ?? 0} of asphalt)`)
  const part = await aim({ share: 'part' })
  check(part?.share === 'part' && part.kinds === 1 && part.n < tree.n && part.n > 20, `a part of it is cells of one kind that touch (${part?.n} of ${tree?.n})`)
  const side = await aim({ share: 'side' })
  check(side?.share === 'side' && side.hidden === 0 && side.n > 20 && side.n < tree.n / 3, `a side of it is the cells that face one way (${side?.n} of ${tree?.n}, facing ${side?.normal})`)

  // The same aim, picked a second time, is not gathered again; a hole blown in the tree is not part of it afterwards.
  await aim({ share: 'whole' })
  await page.evaluate(() => globalThis.engine.blast(5, false))
  await still(page)
  const holed = await aim({ share: 'whole' })
  check(!holed || (holed.air === 0 && holed.n < tree.n), `after a hammer blow what is aimed at is what is left (${holed?.n ?? 'nothing'} cells, ${holed?.air ?? 0} of air; it was ${tree?.n})`)

  // A house is not one thing: a terrace is joined from end to end.
  check(await find(9, 300) || await find(8, 300), 'a house front is near')
  const house = await aim({ share: 'whole' })
  check(house?.share === 'part' && /too big/i.test(house.says), `a house is too big to be one thing, and is taken a part at a time (${house?.says})`)

  // The ground is not a thing.
  await page.evaluate(() => { const p = globalThis.engine.pose; p.yaw = 1.3; p.pitch = -0.5 })
  const ground = await aim({ share: 'whole' })
  check(ground === null, 'the street itself is not a thing')
  // An area lies on it, as big as asked.
  const area = await aim({ mode: 'area', area: [40, 60, 50] })
  const over = area && await page.evaluate((b) => { const w = globalThis.engine.wand; return [w.kind((b[0] + b[3]) >> 1, b[1] - 1, (b[2] + b[5]) >> 1), w.kind((b[0] + b[3]) >> 1, b[1], (b[2] + b[5]) >> 1)] }, area.box)
  check(area?.how === 'area' && size(area).join() === '40,50,60' && over[0] !== 0 && over[1] === 0, `an area is as big as asked and lies on the ground (${area?.says}; ${over})`)

  // Keys and the wheel: 1 to 3 pick how it aims and leave the tools alone, the wheel sizes the area, X and the wheel turn through whole, part and side, Q puts it away.
  const tool = await page.evaluate(() => globalThis.engine.tool)
  await page.keyboard.press('Digit3')
  check(await page.evaluate(() => globalThis.engine.wand.mode) === 'thing' && await page.evaluate(() => globalThis.engine.tool) === tool, 'in hand, 3 picks a thing and no tool')
  await page.keyboard.press('KeyX')
  check(await page.evaluate(() => globalThis.engine.wand.share) === 'part', 'X turns to a part')
  const speed = () => page.evaluate(() => document.querySelector('#hud').textContent.match(/(\d+) m\/s/)?.[1])
  const before = await speed()
  await page.keyboard.press('Digit2')
  await page.mouse.move(640, 360)
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(400)
  const grown = await page.evaluate(() => [...globalThis.engine.wand.area])
  check(grown[0] > 40 && grown[1] > 60 && await speed() === before, `the wheel makes the area bigger and the eye no faster (${grown})`)
  await page.keyboard.press('KeyQ')
  check(await page.evaluate(() => !globalThis.engine.wand.held && getComputedStyle(document.querySelector('#tools')).display !== 'none'), 'Q puts it away and the tools are back')
  await page.keyboard.press('Digit3')
  check(await page.evaluate(() => globalThis.engine.tool) !== tool || tool === 'Big charge', 'put away, 3 picks a tool again')

  // A phone: the wand is taken by its button, the bar's buttons pick the aim and size the area, the round button casts.
  const phone = await city('scale=0.5&fire=0&people=0', { size: [844, 390], dpr: 2, phone: true })
  await still(phone)
  await phone.evaluate(() => { const p = globalThis.engine.pose; p.y -= 10.3; p.yaw = 1.3; p.pitch = -0.5 })
  await phone.tap('[data-panel="wand-take"] button')
  await phone.tap('[data-panel="wand"] button:nth-of-type(2)')
  const was = await phone.evaluate(() => [...globalThis.engine.wand.area])
  await phone.tap('[data-panel="wand"] button:has-text("Bigger")')
  const now = await phone.evaluate(() => { const w = globalThis.engine.wand; return { held: w.held, mode: w.mode, area: [...w.area] } })
  check(now.held && now.mode === 'area' && now.area[0] > was[0], `on a phone the wand is taken by its button and the area sized by the bar (${was} to ${now.area})`)
  await phone.evaluate(() => { globalThis.cast = null; globalThis.engine.wand.oncast = (t) => { globalThis.cast = t } })
  await phone.waitForFunction(() => globalThis.engine.wand.target)
  const fellBefore = await phone.evaluate(() => globalThis.engine.fell.asks)
  await phone.tap('#boom')
  const cast = await phone.evaluate(() => ({ how: globalThis.cast?.how, asks: globalThis.engine.fell.asks }))
  check(cast.how === 'area' && cast.asks === fellBefore, 'the round button casts at the area, and uses no tool')
} catch (e) {
  check(false, `the check ran to its end (${e.message.split('\n')[0]})`)
}
await finish('wand')
