// A model writes rules (#264): a reply becomes a rule only after it was tried in a world of its own, one that
// fails is sent back with what went wrong, and what the model said it could not do is kept.
//
// NO MODEL IS RUN HERE. Replies kept in this file stand in for one. The worlds are real: the server and world
// process of this build, one the rule is tried in and one it is put into. No page, no GPU.
//
//   node test/rulewrite.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRIEF, guideFor, read, scratch, write } from '../make/rules.mjs'
import { serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-rulewrite-')), cannot = join(dir, 'cannot.jsonl')
const server = await serve('/dev/null', ['--world', join(dir, 'world.log')]), world = server.url
const trial = await scratch()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (path) => (await fetch(`${world}/world/${path}`)).json()
const where = { at: [700, 155, 4060], facing: 'north' }
const reply = (source, { name = 'Someone who waves', cannot = ['Wave: an actor has no moves, so it says "waves" instead.'] } = {}) => `NAME: ${name}\nCANNOT:\n${cannot.length ? cannot.map((c) => `- ${c}`).join('\n') : 'nothing'}\nRULE:\n\`\`\`js\n${source}\n\`\`\``
const kept = (...texts) => { let n = 0; const seen = []; return Object.assign(async (q) => { seen.push(q); return { text: texts[Math.min(n++, texts.length - 1)], model: 'a kept reply', ms: 0, cost: 0 } }, { seen }) }

const WAVER = `
on('start', (world) => { if (!world.people.some((p) => p.mine && p.id === 'waver')) world.actor('waver', { name: 'Pim', at: [700, 4010] }) })
on('said', (world, e) => { world.keep.heard = (world.keep.heard || 0) + 1; if (/hello|wave/i.test(e.text)) world.actor('waver', { face: e.at, say: '*waves* hello, ' + e.name }) })`
try {
  // ── The reply's form ──
  const r = read(reply(WAVER))
  check(r.name === 'Someone who waves' && r.cannot.length === 1 && r.source.includes("on('said'"), 'a reply is read: a name, what it could not do, the rule')
  check(read(reply(WAVER, { cannot: [] })).cannot.length === 0, '"nothing" under CANNOT is nothing')
  for (const [what, text] of [['no rule', 'NAME: x\nCANNOT:\nnothing'], ['a rule that listens for nothing', reply('const a = 1')], ['an empty rule', reply('')]]) { let why = ''; try { read(text) } catch (e) { why = e.message } check(why !== '', `refused as a reply: ${what} (${why.slice(0, 60)})`) }
  const guide = guideFor(await (await fetch(`${world}/world/`)).text())
  check(/world\.actor\(id/.test(guide) && /WHERE THINGS ARE/.test(guide) && !/POST \/world/.test(guide) && !/Replies are JSON/.test(guide), 'the model is told what a rule can hear and do in the server\'s own words, and nothing of what only a request can ask')
  check(BRIEF(guide).includes(guide) && !/village|\/Users\//i.test(BRIEF('')), 'the brief holds that guide, and names no project and no place on a disk')

  // ── A rule that works: tried, then put ──
  const good = kept(reply(WAVER))
  const made = await write({ wish: 'someone who waves when you say hello', world, where, model: good, trial: trial.url, cannot })
  check(made.state === 'there' && made.tries === 1 && made.did.actors === 1 && made.did.spoke >= 1, `a rule that works is tried and put in: the trial saw it make ${made.did?.actors} actor, be called ${made.did?.calls} times and speak ${made.did?.spoke} times (${made.state}${made.why ? `: ${made.why}` : ''})`)
  check(good.seen[0].prompt.includes('someone who waves') && good.seen[0].prompt.includes('[700, 4060]') && good.seen[0].system.includes('world.actor(id'), 'the model was given the ask, where the asker stands, and the guide')
  await wait(800)
  const there = (await get('rules')).find((x) => x.id === made.id)
  check(there?.running && there.actors === 1 && there.error === '', 'in the world it was asked for, the rule runs and its actor stands')
  check((await get('rules')).length === 1 && (await (await fetch(`${trial.url}/world/rules`)).json()).length === 0, 'the trial\'s world is left with no rule in it')
  const noted = readFileSync(cannot, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  check(noted.length === 1 && noted[0].cannot[0].startsWith('Wave:') && noted[0].wish.includes('waves'), 'what it said it could not do is kept, with what was asked')

  // ── Ones that fail are sent back, told why ──
  const SYNTAX = "on('start', (world) => { world.actor('a', { name: 'A', at: [700, 4010] }"
  const THROWS = "on('start', (world) => { world.actor('a', { name: 'A', at: [700, 4010] }) })\non('tick', (world) => { world.people.find((p) => p.id === 'nobody').at[0] })"
  const FAR = "on('start', (world) => { world.actor('a', { name: 'A', at: [9000, 9000] }) })"
  const SLOW = "on('start', (world) => { world.actor('a', { name: 'A', at: [700, 4010] }) })\non('tick', () => { for (;;) {} })"
  for (const [what, source, told] of [['does not parse', SYNTAX, /did not start/], ['throws when the clock runs', THROWS, /world said|stopped/], ['puts its actor far from the asker', FAR, /from the asker/], ['never returns from a call', SLOW, /stopped|world said|interrupted/]]) {
    const model = kept(reply(source), reply(WAVER))
    const fixed = await write({ wish: 'someone who waves', world, where, model, trial: trial.url, cannot })
    check(fixed.state === 'there' && fixed.tries === 2 && told.test(model.seen[1].prompt) && !fixed.rough, `a rule that ${what} is not put in: the model is told (${(/did not work: (.{0,70})/.exec(model.seen[1].prompt) ?? [])[1]}...) and its second is`)
  }
  // Never right: the best that ran is put in, and said to be rough. Never even a rule: refused.
  const rough = await write({ wish: 'someone who waves', world, where, model: kept(reply(THROWS)), trial: trial.url, cannot })
  check(rough.state === 'there' && rough.tries === 3 && /world said|stopped/.test(rough.rough ?? ''), `asked three times and never right, the one that ran is put in and said to be rough (${rough.state}, ${(rough.rough ?? rough.why ?? '').slice(0, 60)})`)
  const never = await write({ wish: 'someone who waves', world, where, model: kept('I would rather not.'), trial: trial.url, cannot })
  check(never.state === 'refused' && never.tries === 3, 'three replies with no rule in them: refused')
  const before = (await get('rules')).length
  const dead = await write({ wish: 'someone who waves', world, where, model: kept(reply(SYNTAX)), trial: trial.url, cannot })
  check(dead.state === 'refused' && (await get('rules')).length === before, 'a rule that never once started is not put in at all')

  // ── A rule changed by asking: its actor stays where it stands, and what it kept stays ──
  await fetch(`${world}/world/join`, { method: 'POST', body: JSON.stringify({ by: 'wren', at: [700, 4040] }) })
  await fetch(`${world}/world/say`, { method: 'POST', body: JSON.stringify({ by: 'wren', text: 'hello' }) })
  await wait(700)
  const change = kept(reply(WAVER.replace("'*waves* hello, '", "'*bows* good day, '") + "\non('said', (world, e) => { if (/count/i.test(e.text)) world.actor('waver', { say: 'heard ' + world.keep.heard }) })", { name: 'Someone who bows' }))
  const changed = await write({ wish: 'make them bow instead of wave', world, where, change: made.id, model: change, trial: trial.url, cannot })
  check(changed.state === 'there' && changed.id === made.id && change.seen[0].prompt.includes('The rule as it stands') && change.seen[0].prompt.includes('*waves*'), 'asked to change a rule, the model is given the rule as it stands, and the change is put under the same id')
  await wait(600)
  await fetch(`${world}/world/say`, { method: 'POST', body: JSON.stringify({ by: 'wren', text: 'count' }) })
  await wait(900)
  const heard = (await get('around?by=wren&within=1200')).heard.map((h) => h.text)
  check(heard.some((t) => /^heard [1-9]/.test(t)) && (await get('rules')).find((x) => x.id === made.id).actors === 1, `changed, it still has its one actor and what it kept (${heard.filter((t) => t.startsWith('heard')).join(', ')})`)
} catch (e) { failures.push(`the check did not run to its end: ${e.stack ?? e}`) } finally {
  await trial.stop(); server.stop(); rmSync(dir, { recursive: true, force: true })
}
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('rulewrite: ok (kept replies stood in for the model: none was run)')
process.exit(0)
