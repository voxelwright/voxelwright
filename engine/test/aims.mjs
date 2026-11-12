// Every shot of the board still faces its thing (#144): each row's place is stood at and what is
// ahead is asked of the page. Nothing is broken and no picture is taken. A change to the town's
// rules that moves a house or a yard out from under a shot fails here, not on the board.
//
//   node test/aims.mjs
import { start } from './kit.mjs'
import { aimed, place, ROWS } from './rows.mjs'

const { city, check, failures, finish } = await start()
try {
  const page = await city('scale=0.4&fire=0')
  const rows = ROWS.filter((r) => r.stand)
  check(rows.filter((r) => r.act).every((r) => r.near), 'a row that acts does not say what it must face')
  for (const row of rows) {
    await place(page, row)
    const wrong = await aimed(page, row)
    check(!wrong, wrong ?? `${row.key} faces its thing`)
  }
  console.log(`       ${rows.length} shots stood at, ${rows.filter((r) => r.near).length} asked what they face`)
} catch (e) {
  failures.push(String(e))
}
await finish('aims')
