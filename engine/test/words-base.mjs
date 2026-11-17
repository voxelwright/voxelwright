// Records what the base (70f526e9, make/library.mjs `guess`) answers for every phrasing test/words.mjs reads
// (test/phrasings.mjs), on what comes with the engine alone and with the made-up shelf beside it, into
// test/words-base.json. Run once; again only if make/kept/ or the phrasings change (the check then says so).
//
//   node test/words-base.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHIPPED } from '../make/library.mjs'
import { called, entriesOf, texts, writeMadeUp } from './phrasings.mjs'
import { here } from './kit.mjs'

export const BASE = '70f526e9'
const dir = mkdtempSync(join(tmpdir(), 'engine-words-base-')), mine = join(dir, 'mine'), empty = join(dir, 'empty')
mkdirSync(mine); mkdirSync(empty)
try {
  // The base's library, loaded from a file of its own: its shelves are named here, not found beside it.
  writeFileSync(join(dir, 'library.mjs'), execFileSync('git', ['show', `${BASE}:engine/make/library.mjs`], { cwd: here }))
  const { library } = await import(join(dir, 'library.mjs'))
  writeMadeUp(mine)
  const out = { base: BASE, shelves: {} }
  for (const [name, own] of [['shipped', empty], ['made up', mine]]) {
    const shelf = library(own, [SHIPPED]), { every } = texts([...entriesOf(own), ...entriesOf(SHIPPED)])
    const answers = {}
    for (const t of every.sort()) answers[t] = called((await shelf.guess(t))?.entry)
    out.shelves[name] = answers
    console.log(`${name}: ${every.length} texts, ${Object.values(answers).filter(Boolean).length} answered`)
  }
  writeFileSync(join(here, 'test', 'words-base.json'), JSON.stringify(out, null, 1) + '\n')
} finally { rmSync(dir, { recursive: true, force: true }) }
