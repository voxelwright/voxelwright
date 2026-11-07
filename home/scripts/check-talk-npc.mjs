// Headless proof of talking to villagers NPC-style (?talk=npc, #42).
// Starts its own villager host for three synthetic people and its own dev
// server, both on a throwaway VILLAGE_ROOT, and stops them at the end.
// Usage: node scripts/check-talk-npc.mjs [--agent=claude] [--video=dir] [--dev=5295] [--host=5296]
//   default: the stub agent (no model is called) and the checks below.
//   --agent=claude: one real talk and one two-villager table exchange; prints timings and usage.
//   --video=dir records the run (1280x800) into dir.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const video = opt('video')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(tmpdir(), 'villager-talk-'))
const hostPort = Number(opt('host') ?? 5296)
const devPort = Number(opt('dev') ?? 5295)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const children = new Set()

function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.slice(-400)}`)), 30_000)
    const onData = (d) => {
      out += d
      if (ready.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${out.slice(-400)}`)))
  })
}
const startHost = () => run('node', ['src/villager-cli.ts', '--agent', agent, '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
const stop = (child) => new Promise((resolve) => {
  if (!children.has(child)) return resolve()
  child.once('exit', resolve)
  process.kill(-child.pid, 'SIGTERM')
})
const jsonl = (person, file) => readFile(join(root, 'people', person, file), 'utf8').then((s) => s.trim().split('\n').map((l) => JSON.parse(l)), () => [])

let host = await startHost()
const dev = await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

const state = (page) => page.evaluate(() => window.village.talk.state())
/** Poll the talk state until `test` holds, or give up after `ms`. Returns the last state. */
async function until(page, test, ms = 20_000, every = 100) {
  const end = Date.now() + ms
  let s
  do {
    s = await state(page)
    if (test(s)) return s
    await page.waitForTimeout(every)
  } while (Date.now() < end)
  return s
}
async function open(page, query) {
  await page.goto(base + query)
  await page.evaluate(() => window.village.ready())
}
/** Hover a villager (it pauses), then click where it is now. */
async function clickVillager(page, person) {
  let p = await page.evaluate((who) => window.village.talk.screen(who), person)
  await page.mouse.move(p.x, p.y)
  await page.waitForTimeout(500)
  p = await page.evaluate((who) => window.village.talk.screen(who), person)
  await page.mouse.move(p.x, p.y)
  await page.waitForTimeout(150)
  await page.mouse.click(p.x, p.y)
}
async function typeLine(page, text) {
  await page.keyboard.type(text, { delay: agent === 'claude' ? 35 : 0 })
  await page.keyboard.press('Enter')
}
/** Wait out one turn: from sending until nobody is waiting or speaking, sampling the cards. */
async function watchTurn(page, ms = 240_000) {
  const samples = []
  const started = Date.now()
  let s
  do {
    await page.waitForTimeout(80)
    s = await state(page)
    samples.push({ at: Date.now() - started, ...s })
  } while ((s.pending || Object.values(s.cast).some((c) => c.speaking || c.thinking)) && Date.now() - started < ms)
  return samples
}
/** Click a suggestion, opening the folded "…" first if the suggestions are folded away. */
async function chip(page, name) {
  if (await page.locator('.talk-slip .chip.ideas').count()) await page.locator('.talk-slip .chip.ideas').click()
  await page.locator('.talk-slip .chip', { hasText: name }).click()
}
/** The suggestions on the slip as shown, and all of them once the "…" is opened. */
async function chipsOf(page) {
  const shown = await page.locator('.talk-slip .chip').allTextContents()
  if (shown.join() === '…') await page.locator('.talk-slip .chip.ideas').click()
  const all = await page.locator('.talk-slip .chip').allTextContents()
  await page.locator('.talk-slip .line').focus()
  return { shown, all }
}
/** Record every text the person sees on a villager's card, to prove words are revealed whole. */
const recordWords = (page, person) => page.evaluate((who) => {
  const el = document.querySelector(`[data-talk-card="${who}"] .words`)
  const card = el.closest('.talk-card')
  window.__seen = []
  window.__heights = []
  new MutationObserver(() => {
    window.__seen.push(el.textContent)
    window.__heights.push({ words: el.textContent.length, h: card.offsetHeight })
  }).observe(el, { childList: true, characterData: true, subtree: true })
}, person)

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: video, size: { width: 1280, height: 800 } } } : {}) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  if (agent === 'claude') {
    // One real talk and one two-villager table exchange, recorded if asked.
    await open(page, '?talk=npc&input=slip&q=high')
    await page.waitForTimeout(7000)
    await clickVillager(page, 'alex')
    await until(page, (s) => s.mode === 'talk')
    await page.waitForTimeout(1200)
    await typeLine(page, "What should we cook for dinner tonight? We have eggs and spinach.")
    const single = await watchTurn(page)
    await page.waitForTimeout(2500)
    await chip(page, 'Come sit with me')
    await page.waitForTimeout(1500)
    await page.focus('[data-entry="villager-mia"]')
    await page.keyboard.press('Enter')
    await until(page, (s) => s.mode === 'talk' && s.partner === 'mia')
    await page.waitForTimeout(1500)
    await chip(page, 'Come sit with me')
    await until(page, (s) => s.cast.alex.seated && s.cast.mia.seated, 30_000)
    await page.waitForTimeout(800)
    await typeLine(page, 'Shall we plant some herbs this weekend?')
    const group = await watchTurn(page)
    await page.waitForTimeout(3000)
    await typeLine(page, 'Thanks, everyone')
    await watchTurn(page, 20_000)
    await until(page, (s) => s.mode === 'room', 6000)
    await page.waitForTimeout(6000)
    const usage = { alex: await jsonl('alex', 'usage.jsonl'), mia: await jsonl('mia', 'usage.jsonl') }
    const order = [...new Set(group.filter((s) => s.speaker).map((s) => s.speaker))]
    console.log(JSON.stringify({
      single: { reply: (await jsonl('alex', 'conversation.jsonl')).at(-1), firstWordsOnCardMs: single.find((s) => s.cards.alex?.text && s.cast.alex.speaking)?.at },
      group: { order, replies: { alex: (await jsonl('alex', 'conversation.jsonl')).at(-1), mia: (await jsonl('mia', 'conversation.jsonl')).at(-1) } },
      usage: Object.fromEntries(Object.entries(usage).map(([p, u]) => [p, u.map((x) => ({ models: x.models, ttftMs: x.ttftMs, totalMs: x.totalMs, costUsd: x.costUsd, failed: x.failed }))])),
      errors,
    }, null, 2))
  } else {
    // No flag: the home is as before.
    await open(page, '')
    const plain = await page.evaluate(() => ({ talk: 'talk' in window.village, cards: document.querySelectorAll('.talk-card, .talk-slip, .talk-tag').length, entries: window.village.snapshot().entries.map((e) => e.id).filter((id) => id.startsWith('villager')), fov: window.village.kernel.root.get('stage').camera.fov }))
    check('without ?talk= nothing is added and the seated view is unchanged', !plain.talk && plain.cards === 0 && plain.entries.length === 0 && plain.fov === 40, plain)
    const isoBaseline = await (async () => {
      await open(page, '?cam=iso&q=low')
      await page.waitForTimeout(1500)
      return page.evaluate(() => window.village.snapshot())
    })()

    // Life: three felt villagers doing chores in the room view.
    // The slip variant (?input=slip): these checks drive its form field; the held notepad has its own check.
    await open(page, '?talk=npc&input=slip&q=low')
    const start = await state(page)
    const fov = await page.evaluate(() => window.village.kernel.root.get('stage').camera.fov)
    check('?talk=npc shows three villagers in the room view', Object.keys(start.cast).join() === 'alex,sam,mia' && fov === 20 && start.mode === 'room', { fov, cast: Object.keys(start.cast) })
    await page.waitForTimeout(9000)
    const later = await state(page)
    const moved = Object.keys(start.cast).filter((p) => Math.hypot(later.cast[p].x - start.cast[p].x, later.cast[p].z - start.cast[p].z) > 0.4)
    check('every villager walks between its chores', moved.length === 3, { moved, spots: Object.fromEntries(Object.entries(later.cast).map(([p, c]) => [p, c.spot])) })

    // Pointer: hover glows and names, click starts a talk in one step.
    let p = await page.evaluate(() => window.village.talk.screen('sam'))
    await page.mouse.move(p.x, p.y)
    await page.waitForTimeout(500)
    const hover = await page.evaluate(() => ({ hovered: window.village.kernel.root.get('entries').hovered, tags: [...document.querySelectorAll('.talk-tag.shown')].map((t) => t.textContent) }))
    const tagAt = await page.evaluate(() => {
      const r = document.querySelector('.talk-tag.shown').getBoundingClientRect()
      const head = window.village.talk.screen('sam', 1)
      return { x: r.left + r.width / 2, bottom: r.bottom, top: r.top, left: r.left, right: r.right, headX: head.x, headTop: head.y, w: innerWidth, glow: window.village.talk.state().cast.sam.glow }
    })
    const overHead = Math.abs(tagAt.x - tagAt.headX) < 40 && tagAt.bottom <= tagAt.headTop + 16 && tagAt.bottom >= tagAt.headTop - 40 && tagAt.top >= 0 && tagAt.left >= 0 && tagAt.right <= tagAt.w
    check('hover shows "Sam\'s Tuft" just over Tuft\'s own head, inside the window, and outlines Tuft', hover.hovered === 'villager-sam' && hover.tags.join() === "Sam'sTuft" && overHead && tagAt.glow > 0.5, { hover, tagAt })
    await clickVillager(page, 'sam')
    const talking = await until(page, (s) => s.mode === 'talk' && s.cards.sam, 3000)
    await page.waitForTimeout(300)
    const focus = await page.evaluate(() => document.activeElement?.classList.contains('line'))
    check('a click starts a talk: the villager stops, the camera comes close, a card and the line appear', talking.partner === 'sam' && talking.focused && talking.cards.sam && focus, { talking: talking.partner, focused: talking.focused, card: talking.cards.sam, focus })
    await page.waitForTimeout(800)
    const hello = (await state(page)).cards.sam?.text ?? ''
    await recordWords(page, 'sam')
    // The voice hook: every word as it appears, and a stop when a reply is cut short.
    await page.evaluate(() => {
      window.__said = []
      const root = window.village.kernel.root
      root.on('village/said', (e) => window.__said.push({ ...e }))
      root.on('village/said-stop', (e) => window.__said.push({ stop: e.villager }))
    })
    await typeLine(page, 'Could you help me find my keys?')
    const turn = await watchTurn(page, 20_000)
    const cued = turn.some((s) => s.cast.sam.speaking && s.cards.sam?.cue && !s.cards.sam.finished)
    const lengths = new Set(turn.map((s) => s.cards.sam?.text?.length ?? 0))
    const thought = turn.some((s) => s.cast.sam.thinking && !s.cards.sam)
    const reply = (await jsonl('sam', 'conversation.jsonl')).at(-1)
    const final = turn.at(-1).cards.sam
    check('the villager thinks with its body, then its reply streams onto the card', thought && lengths.size >= 3 && final?.text === reply?.text && reply?.from === 'villager', { thought, lengths: lengths.size, card: final?.text, reply })
    const seen = (await page.evaluate(() => window.__seen)).filter((t) => t.trim())
    const whole = (t, of) => {
      const i = of.indexOf(t)
      return i >= 0 && (i + t.length === of.length || /\s/.test(of[i + t.length]))
    }
    const broken = seen.filter((t) => !whole(t, reply.text) && !whole(t, hello))
    const ended = await page.evaluate(() => {
      const card = document.querySelector('[data-talk-card="sam"]')
      return { cue: card.querySelector('.cue').hidden, sizer: Boolean(card.querySelector('.sizer')), words: card.querySelector('.words').textContent, more: !card.querySelector('.more').hidden, kept: window.village.talk.state().cards.sam?.kept }
    })
    check('replies are revealed in whole words, with a "still talking" cue until done', seen.length >= 3 && !broken.length && cued && ended.cue, { seen: seen.length, broken, cued, ended })
    // The card grows with the words: no hidden sizer, short at the first words and taller as lines arrive, never shrinking within a page.
    const heights = (await page.evaluate(() => window.__heights)).filter((x) => x.words > 0)
    const replyHeights = heights.slice(heights.findIndex((x, i) => i > 0 && x.words < heights[i - 1].words) + 1)
    const grows = replyHeights.length >= 3 && replyHeights.at(-1).h > replyHeights[0].h + 20 && replyHeights.every((x, i) => i === 0 || x.h >= replyHeights[i - 1].h)
    check('the card grows as words arrive, with no empty pre-sized card', !ended.sizer && grows, { first: replyHeights[0], last: replyHeights.at(-1), samples: replyHeights.length })
    check('a short reply stays whole on one page, with no "go on"', ended.words === reply.text && !ended.more && ended.kept === '', ended)

    // A long reply turns its page only when the next sentence would overflow, keeping the first page as a dimmed line above.
    const long = 'The first thing is the soup, which wants another hour on the stove. Then the bread needs shaping, and the oven needs to be warm before that. After that we could set the table together, with the blue plates. The candles are in the second drawer, by the matches. And someone should call Grandma to say dinner is at seven. She likes to know early so she can bring the pie.'
    await page.evaluate((t) => window.village.talk.say('sam', t), long)
    await page.waitForFunction(() => !document.querySelector('[data-talk-card="sam"] .more').hidden, null, { timeout: 8000, polling: 50 })
    const firstPage = await state(page)
    const shown1 = await page.evaluate(() => {
      const card = document.querySelector('[data-talk-card="sam"]')
      const words = card.querySelector('.words')
      return { text: words.textContent, lines: Math.round(words.getBoundingClientRect().height / (19 * 1.42)), more: !card.querySelector('.more').hidden }
    })
    // "go on" turns the page (the card is still gliding, so the click is dispatched rather than aimed).
    await page.evaluate(() => document.querySelector('[data-talk-card="sam"] .more').click())
    await page.waitForTimeout(300)
    const shown2 = await page.evaluate(() => ({ kept: window.village.talk.state().cards.sam.kept, before: getComputedStyle(document.querySelector('[data-talk-card="sam"] .before')).opacity, words: document.querySelector('[data-talk-card="sam"] .words').textContent }))
    check('a long reply turns its page only when it would overflow, and keeps the first page as a dimmed line above', firstPage.cards.sam && shown1.more && shown1.lines <= 7 && shown1.lines >= 5 && /[.!?]$/.test(shown1.text) && long.startsWith(shown1.text) && shown2.kept === shown1.text && Number(shown2.before) < 0.9 && shown2.words.trim().length > 0 && long.includes(shown2.words.trim()), { shown1, shown2 })

    // Escape: back to chores and the room.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    const heardWords = await page.evaluate(() => window.__said)
    const replyWords = heardWords.filter((e) => e.villager === 'sam').slice(0, reply.text.split(/\s+/).length)
    const inOrder = replyWords.map((e) => e.word).join(' ') === reply.text.trim().split(/\s+/).join(' ') && replyWords.every((e, i) => e.index === i && e.last === (i === replyWords.length - 1))
    check('each word fires "village/said" as it appears, in order, with "last" on the final word; Escape mid-reply fires "village/said-stop"', inOrder && heardWords.at(-1)?.stop === 'sam', { words: replyWords.length, inOrder, end: heardWords.slice(-2) })
    const back = await until(page, (s) => s.mode === 'room', 2000)
    const was = back.cast.sam
    await page.waitForTimeout(8000)
    const after = await state(page)
    check('Escape returns the villager to its chores and the camera to the room', back.mode === 'room' && !back.focused && !Object.keys(back.cards).length && (after.cast.sam.spot !== was.spot || Math.hypot(after.cast.sam.x - was.x, after.cast.sam.z - was.z) > 0.3), { back: back.mode, focused: back.focused, before: was.spot, after: after.cast.sam.spot })

    // Keyboard: Tab to a villager, Enter talks; the reply comes back.
    await page.focus('[data-entry="villager-alex"]')
    await page.keyboard.press('Enter')
    const kb = await until(page, (s) => s.mode === 'talk' && s.partner === 'alex', 3000)
    await page.waitForTimeout(500)
    await typeLine(page, 'What is for dinner?')
    await watchTurn(page, 20_000)
    const alexReply = (await jsonl('alex', 'conversation.jsonl')).at(-1)
    check('Tab and Enter start a talk, and typing and Enter get a reply', kb.partner === 'alex' && alexReply?.from === 'villager' && (await state(page)).cards.alex?.text === alexReply.text, { partner: kb.partner, alexReply })
    const afterDinner = await chipsOf(page)
    check('after the first exchange the suggestions fold behind "…", and a typed dinner question drops "What\'s for dinner?"', afterDinner.shown.join() === '…' && !afterDinner.all.includes("What's for dinner?") && afterDinner.all.includes('Come sit with me'), afterDinner)

    // Invite two to the table.
    await chip(page, 'Come sit with me')
    await until(page, (s) => s.mode === 'table', 3000)
    await page.focus('[data-entry="villager-sam"]')
    await page.keyboard.press('Enter')
    await until(page, (s) => s.mode === 'talk' && s.partner === 'sam', 3000)
    await chip(page, 'Come sit with me')
    const seated = await until(page, (s) => s.cast.alex.seated && s.cast.sam.seated, 30_000)
    check('"Come sit with me" walks each villager to a chair and seats them', seated.mode === 'table' && seated.seated.length === 2 && seated.cast.alex.seated && seated.cast.sam.seated, { mode: seated.mode, seated: seated.seated, seats: [seated.cast.alex.seat, seated.cast.sam.seat] })

    // A line to the table: both answer, one at a time, the speaker's tag lit.
    await page.locator('.talk-slip .line').focus()
    const before = { alex: (await jsonl('alex', 'conversation.jsonl')).length, sam: (await jsonl('sam', 'conversation.jsonl')).length }
    await typeLine(page, 'What should we cook this weekend?')
    const round = await watchTurn(page, 30_000)
    const order = [...new Set(round.filter((s) => s.speaker).map((s) => s.speaker))]
    const overlap = round.some((s) => s.cast.alex.speaking && s.cast.sam.speaking)
    const litRight = round.filter((s) => s.speaker && s.lit.length).every((s) => s.lit.length === 1 && s.lit[0] === s.speaker)
    const answered = { alex: (await jsonl('alex', 'conversation.jsonl')).slice(before.alex), sam: (await jsonl('sam', 'conversation.jsonl')).slice(before.sam) }
    check('a line to the table is answered by both in turn, one speaker at a time with a lit name tag', order.length === 2 && !overlap && litRight && answered.alex.length === 2 && answered.sam.length === 2, { order, overlap, litRight, answered })
    const tableChips = await chipsOf(page)
    check('at the table a line about the weekend drops "What\'s everyone up to?"; the rest fold behind "…"', tableChips.shown.join() === '…' && tableChips.all.join() === 'Thanks, everyone', tableChips)
    // Every card and tag on screen sits inside the window, and each tail points at its own villager's head.
    const layout = await page.evaluate(() => [...document.querySelectorAll('.talk-card.shown, .talk-tag.shown')].map((el) => {
      const r = el.getBoundingClientRect()
      const who = el.dataset.talkCard
      const head = who ? window.village.talk.screen(who, 0.85) : null
      const tail = el.dataset.tail === 'down' ? r.left + parseFloat(getComputedStyle(el).getPropertyValue('--tail')) : null
      return { who, inside: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, tailOff: tail === null || !head ? 0 : Math.abs(tail - head.x) }
    }))
    check('at the table every card and tag is inside the window, with each tail over its own villager', layout.length >= 1 && layout.every((l) => l.inside && l.tailOff < 40), layout)

    // A walker brought close to the camera in the table shot fades out, and comes back once it leaves.
    await page.evaluate(() => window.village.talk.walk('mia', 'seatNear'))
    const crowded = await until(page, (s) => s.cast.mia.crowding && s.cast.mia.fade < 0.05, 25_000)
    await page.evaluate(() => window.village.talk.walk('mia', null))
    const returned = await until(page, (s) => !s.cast.mia.crowding && s.cast.mia.fade > 0.95, 25_000)
    check('a walker that comes between the camera and the table fades out, then back in once clear', crowded.cast.mia.crowding && crowded.cast.mia.fade < 0.05 && returned.cast.mia.fade > 0.95, { crowded: crowded.cast.mia, returned: { fade: returned.cast.mia.fade, crowding: returned.cast.mia.crowding } })

    // A round (#42): whoever is named first speaks first, the next hears the round so far as context, a villager with nothing to add nods.
    // The "village/said" listener added above is still on: start its record afresh.
    await page.evaluate(() => (window.__said = []))
    const named = { alex: (await jsonl('alex', 'conversation.jsonl')).length, sam: (await jsonl('sam', 'conversation.jsonl')).length }
    await typeLine(page, 'Tuft, can you tidy the counter after? [stub-pass:Alex]')
    const one = await watchTurn(page, 30_000)
    const samLines = (await jsonl('sam', 'conversation.jsonl')).slice(named.sam)
    const alexLines = (await jsonl('alex', 'conversation.jsonl')).slice(named.alex)
    const firstRound = (await state(page)).round
    const nodded = one.find((s) => s.speaker === 'alex' && s.cards.alex)
    const saidWords = await page.evaluate(() => window.__said)
    check('a line naming Tuft makes Tuft speak first, then the round goes on', firstRound.map((r) => r.speaker).join() === 'sam,alex' && samLines.length === 2 && alexLines.length === 2, { round: firstRound.map((r) => r.speaker), samLines, alexLines })
    check('a villager with nothing to add passes with a nod, not words, and no voice', firstRound[1]?.pass === true && nodded?.cards.alex.text === '(nods)' && !saidWords.some((e) => e.villager === 'alex' && e.word), { pass: firstRound[1], card: nodded?.cards.alex, alexWords: saidWords.filter((e) => e.villager === 'alex').length })
    const samHeard = firstRound[0]?.context ?? ''
    const alexHeard = firstRound[1]?.context ?? ''
    check("the second speaker hears the person's line and the first reply as context", alexHeard.includes('The round so far: Alex said "Tuft, can you tidy') && alexHeard.includes(`Tuft said "${samLines[1]?.text.slice(0, 40)}`) && samHeard.includes('Before that: Dumpling said "'), { samHeard, alexHeard })
    const samAll = await jsonl('sam', 'conversation.jsonl')
    const alexAll = await jsonl('alex', 'conversation.jsonl')
    check("in-round replies are never stored as the person's line", samLines[0]?.text === 'Tuft, can you tidy the counter after? [stub-pass:Alex]' && alexLines[0]?.text === samLines[0]?.text && ![...samAll, ...alexAll].some((l) => l.from === 'person' && /Context|said "/.test(l.text ?? '')), { stored: samLines[0]?.text })
    const hostHeard = await readFile(join(root, 'people', 'alex', 'stub-last-context.txt'), 'utf8').catch(() => '')
    check('the in-round context the page sent is what the villager heard', hostHeard === alexHeard, { hostHeard })

    // Turning to each other by name: they hand the line back and forth, then stop at four turns and wait for you.
    await page.evaluate(() => (window.__said = []))
    await typeLine(page, 'Who goes next? [stub-handoff:Alex>Tuft] [stub-handoff:Sam>Dumpling]')
    const handed = await watchTurn(page, 40_000)
    const longRound = (await state(page)).round
    const speakers = longRound.map((r) => r.speaker)
    check('a villager turned to by name speaks next, and a round stops at four turns', speakers.length === 4 && speakers.every((p, i) => i === 0 || p !== speakers[i - 1]) && !handed.at(-1).pending, speakers)
    const lastHeard = longRound.at(-1)?.context ?? ''
    check('each later speaker hears every reply so far in the round', (lastHeard.match(/ said "/g) ?? []).length >= 4, lastHeard)
    // Prefetch: the next speaker is asked the moment the previous reply is complete, while its card is still being revealed.
    const gaps = longRound.slice(1).map((r, i) => ({ askAfterDone: Math.round(r.asked - longRound[i].done), askBeforeCardEnd: Math.round(longRound[i].finished - r.asked), wait: Math.round(r.card - longRound[i].finished) }))
    check('the next speaker is asked as soon as the reply before is complete, before its card finishes', gaps.every((g) => g.askAfterDone < 150 && g.askBeforeCardEnd > 0), gaps)
    // Words still fire in order, one speaker after another, never interleaved.
    const words = await page.evaluate(() => window.__said)
    const runs = words.reduce((acc, e) => (acc.at(-1)?.v === e.villager ? acc.at(-1).n++ : acc.push({ v: e.villager, n: 1 }), acc), [])
    const ordered = words.every((e, i) => i === 0 || e.villager !== words[i - 1].villager ? e.index === 0 : e.index === words[i - 1].index + 1)
    check('"village/said" words come in order, one speaker at a time, never interleaved', runs.length === 4 && runs.map((r) => r.v).join() === speakers.join() && ordered, { runs, ordered, words: words.map((e) => `${e.villager}:${e.index}:${e.word}`).join(" ") })

    // Host down: the villager says so in character and the line is kept.
    await stop(host)
    await typeLine(page, 'Tuft, are you there?')
    const away = await watchTurn(page, 20_000)
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('village.talk.kept') ?? '[]'))
    const line = await page.locator('.talk-slip .line').inputValue()
    check('with the host down the villager says so in character', /out for a moment/.test(away.at(-1).cards.sam?.text ?? ''), away.at(-1).cards.sam)
    check('with the host down the line is kept, in storage and on the slip', kept.at(-1)?.text === 'Tuft, are you there?' && kept.at(-1)?.person === 'sam' && line === 'Tuft, are you there?', { kept: kept.at(-1), line })
    host = await startHost()

    // A typed farewell: each says a short goodbye in turn, nothing is sent, and they go back to chores.
    await page.locator('.talk-slip .line').fill('')
    const quiet = { alex: (await jsonl('alex', 'conversation.jsonl')).length, sam: (await jsonl('sam', 'conversation.jsonl')).length }
    await typeLine(page, 'thanks, bye!')
    const byes = await watchTurn(page, 20_000)
    const said = [...new Set(byes.filter((s) => s.speaker).map((s) => `${s.speaker}: ${s.cards[s.speaker]?.text}`))]
    const gone = await until(page, (s) => s.mode === 'room', 4000)
    const up = await until(page, (s) => !s.cast.alex.seated && !s.cast.sam.seated, 8000)
    const sent = { alex: (await jsonl('alex', 'conversation.jsonl')).length - quiet.alex, sam: (await jsonl('sam', 'conversation.jsonl')).length - quiet.sam }
    check('a typed farewell at the table: each says goodbye in turn, nothing is sent, all go back to chores', said.length === 2 && said.every((l) => /bye|see you/i.test(l)) && sent.alex === 0 && sent.sam === 0 && gone.mode === 'room' && !gone.focused && !up.cast.alex.seated && !up.cast.sam.seated, { said, sent, mode: gone.mode })

    // Escape at the table: everyone back to chores at once.
    await page.focus('[data-entry="villager-alex"]')
    await page.keyboard.press('Enter')
    await until(page, (s) => s.mode === 'talk' && s.partner === 'alex', 3000)
    await chip(page, 'Come sit with me')
    await until(page, (s) => s.mode === 'table', 3000)
    await page.waitForTimeout(600)
    await page.keyboard.press('Escape')
    const left = await until(page, (s) => s.mode === 'room', 2000)
    check('Escape at the table sends everyone back to chores', left.mode === 'room' && !left.focused && left.seated.length === 0, { mode: left.mode, seated: left.seated })

    // The "!" glyph: shows, fades after a second of looking, never comes back.
    await page.mouse.move(5, 5)
    await page.waitForTimeout(2500) // the camera settles back over the room
    await page.evaluate(() => window.village.talk.notify('mia'))
    const shown = await until(page, (s) => s.cast.mia.glyph > 0.8, 3000)
    // Moss may be behind the plant's leaves for a moment, which rightly blocks the pointer: keep following it until it is hovered.
    for (let tries = 0; tries < 50; tries++) {
      const m = await page.evaluate(() => window.village.talk.screen('mia', 0.75))
      await page.mouse.move(m.x, m.y)
      await page.waitForTimeout(150)
      if (await page.evaluate(() => window.village.kernel.root.get('entries').hovered === 'villager-mia')) break
    }
    const faded = await until(page, (s) => s.cast.mia.glyph === 0 && !s.cast.mia.news, 4000)
    await page.evaluate(() => window.village.talk.notify('mia'))
    await page.waitForTimeout(600)
    const again = await state(page)
    check('the "!" glyph shows, fades after about a second of looking, and never escalates', shown.cast.mia.glyph > 0.8 && faded.cast.mia.glyph === 0 && !again.cast.mia.news && again.cast.mia.glyph === 0, { shown: shown.cast.mia.glyph, faded: faded.cast.mia, again: again.cast.mia.glyph })
    await page.mouse.move(5, 5)

    // ?slip=always: the slip stays on screen with no talk open, addressed to your own villager, and re-addresses itself.
    const roomSlip = await page.evaluate(() => document.querySelector('.talk-slip').classList.contains('shown'))
    const page2 = await context.newPage()
    page2.on('pageerror', (e) => errors.push(String(e)))
    await open(page2, '?talk=npc&slip=always&q=low')
    await page2.waitForTimeout(500)
    const slipOf = () => page2.evaluate(() => {
      const el = document.querySelector('.talk-slip')
      return { shown: el.classList.contains('shown'), to: el.dataset.to, tab: el.querySelector('.tab')?.textContent, placeholder: el.querySelector('.line').placeholder }
    })
    const idle = await slipOf()
    await page2.locator('.talk-slip .line').focus()
    const marked = await until(page2, (s) => s.cast.alex.glow > 0.5 && s.cast.alex.attending, 3000)
    check('?slip=always marks the villager written to: a soft outline, and it turns to you while you write', marked.cast.alex.glow > 0.5 && marked.cast.alex.attending && marked.cast.sam.glow < 0.1, { alex: marked.cast.alex, sam: marked.cast.sam.glow })
    await page2.locator('.talk-slip .line').blur()
    await page2.focus('[data-entry="villager-sam"]')
    await page2.keyboard.press('Enter')
    await until(page2, (s) => s.mode === 'talk' && s.partner === 'sam', 3000)
    const toSam = await slipOf()
    await page2.keyboard.press('Escape')
    await until(page2, (s) => s.mode === 'room', 2000)
    const backIdle = await slipOf()
    const before2 = (await jsonl('alex', 'conversation.jsonl')).length
    await page2.locator('.talk-slip .line').focus()
    await typeLine(page2, 'Remind me what we said about dinner?')
    const direct = await until(page2, (s) => s.mode === 'talk' && s.partner === 'alex' && !s.pending && s.cards.alex?.finished, 20_000)
    const toAlex = (await jsonl('alex', 'conversation.jsonl')).slice(before2)
    check('without ?slip=always the slip is hidden in the room', !roomSlip, roomSlip)
    check('?slip=always: the slip stays in the room addressed to your own villager, re-addresses to whoever you turn to, and a line goes to your villager', idle.shown && idle.to === 'alex' && idle.tab === 'toDumpling' && idle.placeholder === 'Write to Dumpling…' && toSam.to === 'sam' && toSam.tab === 'toTuft' && backIdle.shown && backIdle.to === 'alex' && direct.mode === 'talk' && toAlex[0]?.text === 'Remind me what we said about dinner?' && toAlex[1]?.from === 'villager', { idle, toSam, backIdle, toAlex: toAlex.map((l) => l.from) })
    await page2.close()

    // Clean unload: the same as a page that never had the flag, three times over.
    // ?talk=npc also turns on the babble voices and the music (babble.ts, music.ts), so all three go.
    const counts = []
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.village.unload('talk'); window.village.unload('babble'); window.village.unload('music') })
      await page.waitForTimeout(300)
      counts.push(await page.evaluate(() => ({ ...window.village.snapshot(), talk: 'talk' in window.village, talkDom: document.querySelectorAll('.talk-card, .talk-slip, .talk-tag, .talk-voice').length })))
      if (i < 2) {
        await page.evaluate(() => { window.village.load('talk'); window.village.load('babble'); window.village.load('music') })
        await page.waitForTimeout(800)
      }
    }
    const same = (a) => ['sceneObjects', 'geometries', 'textures', 'frameHooks', 'dom'].every((k) => a[k] === isoBaseline[k]) && a.entries.length === isoBaseline.entries.length
    check('unloading leaves exactly what a page without ?talk= has, every time', counts.every((c) => same(c) && !c.talk && c.talkDom === 0), counts.map((c) => ({ objects: c.sceneObjects, geometries: c.geometries, textures: c.textures, hooks: c.frameHooks, dom: c.dom, entries: c.entries.length })).concat([{ baseline: true, objects: isoBaseline.sceneObjects, geometries: isoBaseline.geometries, textures: isoBaseline.textures, hooks: isoBaseline.frameHooks, dom: isoBaseline.dom, entries: isoBaseline.entries.length }]))
    check('no page errors', errors.length === 0, errors)
  }
  await context.close()
} finally {
  await browser.close()
  for (const child of [...children]) await stop(child)
  check('host and dev server stopped', children.size === 0 && !existsSync(join(root, 'villager', 'launch.json')))
  await rm(root, { recursive: true, force: true })
}

if (agent !== 'claude') {
  for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
  const failed = checks.filter((c) => !c.pass).length
  console.log(`${checks.length - failed} of ${checks.length} passed`)
  process.exitCode = failed ? 1 : 0
}
