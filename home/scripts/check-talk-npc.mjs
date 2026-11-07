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
const chip = (page, name) => page.locator('.talk-slip .chip', { hasText: name }).click()
/** Record every text the person sees on a villager's card, to prove words are revealed whole. */
const recordWords = (page, person) => page.evaluate((who) => {
  const el = document.querySelector(`[data-talk-card="${who}"] .words`)
  window.__seen = []
  new MutationObserver(() => window.__seen.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true })
}, person)

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: video, size: { width: 1280, height: 800 } } } : {}) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  if (agent === 'claude') {
    // One real talk and one two-villager table exchange, recorded if asked.
    await open(page, '?talk=npc&q=high')
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
    await open(page, '?talk=npc&q=low')
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
    check('hover shows the villager\'s name tag', hover.hovered === 'villager-sam' && hover.tags.join() === "TuftSam's", hover)
    await clickVillager(page, 'sam')
    const talking = await until(page, (s) => s.mode === 'talk' && s.cards.sam, 3000)
    await page.waitForTimeout(300)
    const focus = await page.evaluate(() => document.activeElement?.classList.contains('line'))
    check('a click starts a talk: the villager stops, the camera comes close, a card and the line appear', talking.partner === 'sam' && talking.focused && talking.cards.sam && focus, { talking: talking.partner, focused: talking.focused, card: talking.cards.sam, focus })
    await page.waitForTimeout(800)
    const hello = (await state(page)).cards.sam?.text ?? ''
    await recordWords(page, 'sam')
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
    const sized = await page.evaluate(() => {
      const card = document.querySelector('[data-talk-card="sam"]')
      return { cue: card.querySelector('.cue').hidden, sizer: card.querySelector('.sizer').textContent, words: card.querySelector('.words').textContent }
    })
    check('replies are revealed in whole words, with a "still talking" cue until done, on a card sized for the page', seen.length >= 3 && !broken.length && cued && sized.cue && sized.sizer === sized.words, { seen: seen.length, broken, cued, sized })
    const page1 = await page.evaluate(() => document.querySelector('[data-talk-card="sam"] .words')?.textContent)
    check('the card shows at most two sentences, with "go on" for more', page1 && (page1.match(/[.!?](\s|$)/g)?.length ?? 0) <= 2, page1)

    // Escape: back to chores and the room.
    await page.keyboard.press('Escape')
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

    // Starting with a name addresses only that villager, with last round as marked context.
    const named = { alex: (await jsonl('alex', 'conversation.jsonl')).length, sam: (await jsonl('sam', 'conversation.jsonl')).length }
    await typeLine(page, 'Tuft, can you tidy the counter after?')
    const one = await watchTurn(page, 30_000)
    const samLines = (await jsonl('sam', 'conversation.jsonl')).slice(named.sam)
    const alexLines = (await jsonl('alex', 'conversation.jsonl')).slice(named.alex)
    check('starting with a name asks only that villager', alexLines.length === 0 && samLines.length === 2 && [...new Set(one.filter((s) => s.speaker).map((s) => s.speaker))].join() === 'sam', { alexLines, samLines })
    const heard = await readFile(join(root, 'people', 'sam', 'stub-last-context.txt'), 'utf8').catch(() => '')
    const samAll = await jsonl('sam', 'conversation.jsonl')
    check("the other villager's last words reach it only as context, never stored as the person's line", samLines[0]?.text === 'Tuft, can you tidy the counter after?' && /Dumpling said "/.test(heard) && !samAll.some((l) => /Context|Dumpling said/.test(l.text ?? '')), { stored: samLines[0]?.text, heard })

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
    let m = await page.evaluate(() => window.village.talk.screen('mia', 0.75))
    await page.mouse.move(m.x, m.y)
    await page.waitForTimeout(400)
    m = await page.evaluate(() => window.village.talk.screen('mia', 0.75))
    await page.mouse.move(m.x, m.y)
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
    check('?slip=always: the slip stays in the room addressed to your own villager, re-addresses to whoever you turn to, and a line goes to your villager', idle.shown && idle.to === 'alex' && idle.tab === "DumplingAlex's" && /Write to Alex's villager/.test(idle.placeholder) && toSam.to === 'sam' && toSam.tab === "TuftSam's" && backIdle.shown && backIdle.to === 'alex' && direct.mode === 'talk' && toAlex[0]?.text === 'Remind me what we said about dinner?' && toAlex[1]?.from === 'villager', { idle, toSam, backIdle, toAlex: toAlex.map((l) => l.from) })
    await page2.close()

    // Clean unload: the same as a page that never had the flag, three times over.
    const counts = []
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.village.unload('talk'))
      await page.waitForTimeout(300)
      counts.push(await page.evaluate(() => ({ ...window.village.snapshot(), talk: 'talk' in window.village, talkDom: document.querySelectorAll('.talk-card, .talk-slip, .talk-tag, .talk-voice').length })))
      if (i < 2) {
        await page.evaluate(() => window.village.load('talk'))
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
