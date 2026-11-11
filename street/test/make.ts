// Making by talking, end to end, with a stand-in for the model (#118): a sentence typed on one
// page becomes a thing both pages see; an answer that cannot be used is asked for once more; a
// sentence that asks for nothing gets a word and no thing; undo takes the thing back; and what
// was made is there again after the world restarts. No model is called.
// Usage: node test/make.ts
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { browser, sleep, startPage, startWorld, stop } from './lib.ts'

const WT = 5033, PAGE = 5368
const dir = mkdtempSync(join(tmpdir(), 'street-make-'))
const checks: boolean[] = []
const check = (name: string, pass: unknown, detail?: unknown) => { checks.push(Boolean(pass)); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`) }
const call = <T>(page: Page, body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
const until = async <T>(read: () => Promise<T>, good: (v: T) => boolean, ms = 8000) => { for (const t0 = Date.now(); ;) { const v = await read(); if (good(v) || Date.now() - t0 > ms) return v; await sleep(100) } }
const open = async (b: Awaited<ReturnType<typeof browser>>) => {
  const page = await b.newPage({ viewport: { width: 900, height: 600 } })
  await page.goto(`http://localhost:${PAGE}/`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 20_000 })
  return page
}

const vite = await startPage(PAGE, WT)
const chrome = await browser()
let world = await startWorld(WT, '--maker', 'stub', '--world', dir, '--crates', '0', '--balls', '0')
try {
  const a = await open(chrome), b = await open(chrome)
  await call(a, `s.make('a crate of apples')`)
  const toys = await until(() => call<string[]>(b, 's.toys()'), (t) => t.includes('made-1'))
  check('a sentence on one page is a thing on the other', toys.includes('made-1'), toys)
  const said = await until(() => call<{ text: string; kind: string }[]>(b, 's.bubbles()'), (x) => x.some((y) => y.kind.includes('made')))
  check('and everyone is told what appeared', said.some((x) => x.kind.includes('made') && /crate/i.test(x.text)), said)
  check('it is kept in a file of its own', readdirSync(join(dir, 'made')).join() === 'made-1.json', readdirSync(join(dir, 'made')))
  const first = JSON.parse(readFileSync(join(dir, 'made', 'made-1.json'), 'utf8'))
  await sleep(2100)
  await call(a, `s.make('some junk')`)
  const second = await until(() => call<string[]>(a, 's.toys()'), (t) => t.includes('made-2'))
  check('an answer that cannot be used is asked for once more', second.includes('made-2'), second)
  await sleep(2100)
  await call(a, `s.make('nothing at all')`)
  const word = await until(() => call<{ text: string; kind: string }[]>(a, 's.bubbles()'), (x) => x.some((y) => /nothing to make/.test(y.text)))
  check('a sentence that asks for no thing gets a word and no thing', word.some((x) => /nothing to make/.test(x.text)) && !(await call<string[]>(a, 's.toys()')).includes('made-3'), word)
  await call(a, `s.make('too soon')`)
  const soon = await until(() => call<{ text: string; kind: string }[]>(a, 's.bubbles()'), (x) => x.some((y) => y.kind.includes('sorry')))
  check('a second sentence straight after the first waits its turn', soon.some((x) => x.kind.includes('sorry')), soon)
  await call(a, `s.say('hello there')`)
  const heard = await until(() => call<{ text: string; kind: string }[]>(b, 's.bubbles()'), (x) => x.some((y) => y.text === 'hello there'))
  check('what one says the other reads over their head', heard.some((x) => x.text === 'hello there' && x.kind.includes('said')), heard)
  await call(a, 's.unmake()')
  const fewer = await until(() => call<string[]>(b, 's.toys()'), (t) => !t.includes('made-2'))
  check('undo takes back the last thing you made, for everyone', !fewer.includes('made-2') && fewer.includes('made-1') && readdirSync(join(dir, 'made')).join() === 'made-1.json', fewer)
  // The second verb: a sentence about the thing you face changes it where it stands.
  await sleep(2100)
  await call(a, `s.change('turn it into ice, and bigger')`)
  const changed = await until(() => call<string[]>(b, 's.toys()'), (t) => t.includes('made-3') && !t.includes('made-1'))
  const now = existsSync(join(dir, 'made', 'made-3.json')) ? JSON.parse(readFileSync(join(dir, 'made', 'made-3.json'), 'utf8')) : null
  const was = 0.4, half = now?.toy.parts[0].pieces[0].shape.half[0]
  check('a sentence about a made thing changes it for everyone: the crate is ice and half as big again, under a new name', changed.includes('made-3') && !changed.includes('made-1') && now?.toy.parts[0].material === 'ice' && Math.abs(half - was * 1.5) < 1e-6 && readdirSync(join(dir, 'made')).join() === 'made-3.json', { changed, material: now?.toy.parts[0].material, half, files: readdirSync(join(dir, 'made')) })
  check('and it is told as a change', /Now it is ice/.test((await until(() => call<{ text: string; kind: string }[]>(b, 's.bubbles()'), (x) => x.some((y) => /ice/.test(y.text)))).map((x) => x.text).join(' ')))
  check('it stands where the crate stood', Math.hypot(now.toy.frame.at[0] - first.toy.frame.at[0], now.toy.frame.at[2] - first.toy.frame.at[2]) < 0.5, { now: now.toy.frame.at, first: first.toy.frame.at })
  await a.close(); await b.close()
  await stop(world)
  world = await startWorld(WT, '--maker', 'stub', '--world', dir, '--crates', '0', '--balls', '0')
  const c = await open(chrome)
  const kept = await call<string[]>(c, 's.toys()')
  check('what was made is there again after the world restarts', kept.includes('made-3') && !kept.includes('made-1'), kept)
  await call(c, `s.make('one more')`)
  const next = await until(() => call<string[]>(c, 's.toys()'), (t) => t.includes('made-4'))
  check('and the next thing made does not take a kept thing\'s name', next.includes('made-4') && next.includes('made-3'), next)
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3))
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${checks.filter(Boolean).length}/${checks.length} passed`)
process.exit(checks.every(Boolean) ? 0 : 1)
