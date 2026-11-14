// Known spells, for real (#246): the city page in the installed Chrome with WebGPU. No model is run: every spell
// here is from the kept library. Words call the right spell; pink is the car's own cells in another colour and
// nothing else's; shiny is a mark on the kind that changes no material; steel is another material, and a tree of
// it does not burn; twice as large is about eight times the cells, standing where it stood; a fireball is seen on
// its way, then breaks and lights what it was sent at; a spell too big for one change is done as several.
//
//   node test/spells.mjs        (ENGINE_SHARED=1 for a shared world)
import { start, still } from './kit.mjs'

const { city, check, finish } = await start()
try {
  const page = await city('scale=0.5&people=0')
  await still(page)
  const words = await page.evaluate(async () => {
    const { known } = await import('/page/spells.ts')
    return ['FIREBALL!', 'make it pink', 'make it hot pink please', 'turn it to steel', 'make it shiny', 'make it twice as large', 'a great fireball', 'turn into a frog', 'pinkish'].map((w) => known(w)?.name ?? null)
  })
  check(words.join('|') === 'Fireball|Make it pink|Make it hot pink|Turn it to steel|Make it shiny|Twice as large|Great fireball||', `words call the spell they name, and no other (${words.join(', ')})`)

  await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 10.3; p.pitch = 0 })
  await page.waitForTimeout(300)
  await still(page)
  const find = (material, most = 200, from = -3.14) => page.evaluate(async ([material, most, from]) => {
    const e = globalThis.engine, p = e.pose
    for (let yaw = from; yaw < 3.14; yaw += 0.06) for (const pitch of [-0.3, -0.12, 0.05, 0.15, 0.35]) {
      p.yaw = yaw; p.pitch = pitch
      const hit = await e.pick(0, 0)
      if (hit && hit.material === material && hit.t < most && hit.t > 40) return true
    }
    return false
  }, [material, most, from])
  /** Aims, casts, waits for the world to have it, and says what the thing's cells were and are. */
  const cast = async (said, set) => {
    const before = await page.evaluate(async (set) => {
      const e = globalThis.engine, w = e.wand
      w.held = true
      Object.assign(w, set)
      const t = await w.aim(e.view())
      globalThis.aimed = t
      return t && { n: t.kinds?.length, box: t.box && [...t.box] }
    }, set)
    const why = await page.evaluate((said) => globalThis.engine.spell(said, globalThis.aimed), said)
    await page.waitForTimeout(700)
    await still(page)
    const after = await page.evaluate(() => {
      const e = globalThis.engine, t = globalThis.aimed, kinds = {}, colours = {}, stuff = {}
      let polished = 0, same = 0
      if (t?.kinds) for (let i = 0; i < t.kinds.length; i++) {
        const k = e.wand.kind(t.cells[i * 3], t.cells[i * 3 + 1], t.cells[i * 3 + 2])
        colours[k >> 8] = (colours[k >> 8] ?? 0) + 1
        stuff[k & 15] = (stuff[k & 15] ?? 0) + 1
        if (k & 64) polished++
        if ((k & 15) === (t.kinds[i] & 15)) same++
      }
      return { colours, stuff, polished, same, last: e.magic.last }
    })
    return { why, before, ...after }
  }
  const whole = { mode: 'thing', share: 'whole' }

  // Pink: the car's cells, and only they, in another colour; what they are made of is as it was.
  check(await find(12), 'a parked car is near')
  const beside = await page.evaluate(async () => { const e = globalThis.engine; e.wand.held = true; e.wand.mode = 'thing'; const t = await e.wand.aim(e.view()); const b = t.box; const at = [b[0] - 3, b[1] - 1, (b[2] + b[5]) >> 1]; globalThis.beside = at; return e.wand.kind(...at) })
  const pink = await cast('make it pink', whole)
  const PINK = 16 + 22 * 10 + 2
  check(pink.why === null && pink.colours[PINK] === pink.before.n && pink.same === pink.before.n, `pink: every cell of the car is pink and of what it was made of (${pink.colours[PINK]} of ${pink.before?.n}; ${pink.last?.rows} rows; ${pink.why ?? 'cast'})`)
  check(await page.evaluate(() => globalThis.engine.wand.kind(...globalThis.beside)) === beside, 'and the street beside it is as it was')
  // Shiny: a mark on the kind. Nothing is another material for it.
  const shiny = await cast('make it shiny', whole)
  check(shiny.why === null && shiny.polished === shiny.before.n && shiny.same === shiny.before.n && shiny.colours[PINK] === shiny.before.n, `shiny: every cell is marked polished, still pink, still its material (${shiny.polished} of ${shiny.before?.n})`)
  // Twice as large: about eight times the cells, from where it stood.
  const big = await cast('make it twice as large', whole)
  const grown = await page.evaluate(async () => { const e = globalThis.engine; const t = await e.wand.aim(e.view()); return t && { n: t.kinds.length, box: [...t.box], share: t.share } })
  const was = big.before.box, now = grown?.box
  check(big.why === null && grown && grown.n > big.before.n * 5 && now[3] - now[0] >= (was[3] - was[0]) * 1.8 && Math.abs(now[1] - was[1]) <= 1, `twice as large: ${big.before?.n} cells are ${grown?.n}, ${was?.[3] - was?.[0]} cells long are ${now?.[3] - now?.[0]}, its foot where it was`)

  // Steel: another material. A tree of steel does not burn; the tree next to it does.
  check(await find(13), 'a street tree is near')
  const steel = await cast('turn it to steel', whole)
  check(steel.why === null && steel.stuff[12] === steel.before.n, `steel: every cell of the tree is steel (${steel.stuff[12]} of ${steel.before?.n})`)
  await page.evaluate(() => globalThis.engine.ignite(6))
  await page.waitForTimeout(1500)
  const alight = await page.evaluate(() => globalThis.engine.burning)
  check(alight === 0, `a torch put to the steel tree lights nothing (${alight} cells burn)`)

  // More than one change holds: it is done all the same, as several changes sent together.
  check(await find(9, 300) || await find(8, 300), 'a house front is near')
  const house = await cast('make it black', { mode: 'thing', share: 'part' })
  check(house.why === null && house.colours[15] === house.before.n, `a part of a house is black, all of it (${house.before?.n} cells, ${house.last?.rows} rows in ${house.last?.edits} changes)`)

  // Fireball: seen on its way, then a blast where it was sent, and fire.
  check(await find(13, 500), 'another tree is near')
  const fire = await page.evaluate(async () => {
    const e = globalThis.engine
    e.wand.mode = 'point'
    const t = await e.wand.aim(e.view()), asks = e.fell.asks
    const why = e.spell('fireball', t)
    const flying = e.magic.flying, puffs = e.smoke.live
    await new Promise((done) => setTimeout(done, 60))
    return { why, flying, asksAtOnce: e.fell.asks - asks, puffsSoon: e.smoke.live - puffs, at: [...t.at] }
  })
  check(fire.why === null && fire.flying === 1 && fire.asksAtOnce === 0 && fire.puffsSoon > 0, `a fireball is on its way before anything breaks (${fire.puffsSoon} puffs of it in the air, ${fire.asksAtOnce} blasts yet)`)
  await page.waitForFunction(() => globalThis.engine.magic.flying === 0, null, { timeout: 10_000 })
  await page.waitForTimeout(1200)
  const burnt = await page.evaluate(() => ({ burning: globalThis.engine.burning, pieces: globalThis.engine.fell.pieces, asks: globalThis.engine.fell.asks }))
  check(burnt.pieces > 0 && burnt.burning > 0, `where it lands things break and burn (${burnt.pieces} bodies, ${burnt.burning} cells alight)`)

  // Words on the ask bar, with the wand in hand, cast: and a click casts the same again.
  await page.evaluate(() => { const p = globalThis.engine.pose; p.yaw = 1.3; p.pitch = -0.5; globalThis.engine.wand.mode = 'point' })
  await page.waitForFunction(() => globalThis.engine.wand.target?.how === 'point')
  await page.keyboard.press('Enter')
  await page.keyboard.type('make it red')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const red = await page.evaluate(() => ({ last: globalThis.engine.magic.last, label: globalThis.engine.wand.powers[globalThis.engine.wand.power]?.name }))
  check(red.last?.spell === 'Make it red' && red.last.cells > 0 && red.label === 'Make it red', `typed with the wand in hand, a spell is cast and stays in hand (${red.last?.spell}, ${red.last?.cells} cells)`)
} catch (e) {
  check(false, `the check ran to its end (${e.message.split('\n')[0]})`)
}
await finish('spells')
