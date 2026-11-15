// Whose each letter key is (#246), with no page: every letter key the page's code listens for is written in
// page/keys.ts as the page's own or as one it gives way to an offer, none of them is handed to an offer that asked
// for no key, and the world refuses a rule's offer the page's own and grants the rest.
//
//   node test/keys.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FREE, OWN, YIELDED } from '../page/keys.ts'
import { hands } from '../rules/hands.mjs'
import { here } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const own = new Set(Object.keys(OWN)), yielded = new Set(Object.keys(YIELDED)), free = new Set(FREE)

const letters = [...own, ...yielded, ...free]
check(letters.every((k) => /^Key[A-Z]$/.test(k)) && new Set(letters).size === letters.length, `each letter is in one list only (${own.size} the page's, ${yielded.size} given way, ${free.size} free)`)

// The page's code, read: a key it listens for is a 'KeyX' written in it. page/sound/ is left out: an instrument's
// keys are notes in a mode that is solid and takes every key while it is played, offers' and the page's alike.
const files = []
const walk = (dir) => { for (const e of readdirSync(join(here, dir), { withFileTypes: true })) { const rel = join(dir, e.name); if (e.isDirectory()) { if (rel !== join('page', 'sound')) walk(rel) } else if (e.name.endsWith('.ts') && rel !== join('page', 'keys.ts')) files.push(rel) } }
walk('page')
for (const p of readdirSync(join(here, 'plugins'), { withFileTypes: true })) if (p.isDirectory()) try { readFileSync(join(here, 'plugins', p.name, 'page.ts')); files.push(join('plugins', p.name, 'page.ts')) } catch { /* a plugin with no page side */ }
const heard = new Map()
for (const f of files) for (const [, k] of readFileSync(join(here, f), 'utf8').matchAll(/['"`](Key[A-Z])['"`]/g)) heard.set(k, [...(heard.get(k) ?? []), f])
const unwritten = [...heard].filter(([k]) => !own.has(k) && !yielded.has(k)).map(([k, f]) => `${k} in ${[...new Set(f)].join(', ')}`)
check(heard.size >= 15 && unwritten.length === 0, `every letter key the page listens for is written in keys.ts (${heard.size} keys in ${files.length} files${unwritten.length ? `; not written: ${unwritten.join('; ')}` : ''})`)
const handedOut = FREE.filter((k) => heard.has(k))
check(handedOut.length === 0, `no key handed to an offer is one the page listens for${handedOut.length ? ` (${handedOut.join(', ')})` : ''}`)

// The world's side: a rule asking for each key.
const told = []
const world = hands({ folk: new Map(), tall: 18, look: () => ({}), text: (t, n) => (typeof t === 'string' ? t.slice(0, n) : ''), tell: (m) => { if (m.offers) told.splice(0, told.length, ...m.offers) }, hear: () => {} })
const given = (key) => { const wrong = []; world.offer({ id: 'stall' }, { id: 'buy', word: 'Buy a pretzel', key }, 0, (w) => wrong.push(w)); return { key: told.find((o) => o.id === 'buy')?.key, wrong } }
const refused = [...own].filter((k) => { const g = given(k); return g.key !== '' || !/a key is/.test(g.wrong[0] ?? '') })
check(refused.length === 0, `the world gives no offer one of the page's own, and tells the rule (${refused.length ? `given: ${refused.join(', ')}` : [...own].map((k) => k.slice(3)).join(' ')})`)
const granted = [...yielded, ...free].filter((k) => { const g = given(k); return g.key === k && g.wrong.length === 0 })
check(granted.length === yielded.size + free.size, `and gives one it asks for of the rest (${granted.map((k) => k.slice(3)).join(' ')})`)

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('passed')
