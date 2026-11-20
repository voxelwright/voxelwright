// A kept living thing as a plain file a static page reads (#450): the shelf's record (make/cells.mjs reads it, with
// its body, motor, seats and look in finer cells) written as living.ts `Making` has it, with its cells in base64.
// The page sets it down where the realm says (local.ts `kept`) and it is driven as any living thing is: in the page's
// own solver, with no world's process and no helper.
//
//   node sf/kept.mjs <record.json> <out.json> [--name "a grey saloon"]
import { readFileSync, writeFileSync } from 'node:fs'
import { read } from '../make/cells.mjs'

const [from, to] = process.argv.slice(2)
const at = process.argv.indexOf('--name'), named = at > 0 ? process.argv[at + 1] : null
if (!from || !to) { console.error('node sf/kept.mjs <record.json> <out.json> [--name words]'); process.exit(1) }
const record = JSON.parse(readFileSync(from, 'utf8'))
const t = read(record.made, { joined: true })
if (!t.living) { console.error(`${from} is not a living thing`); process.exit(1) }
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64')
const look = (t.living.look ?? []).map((f) => ({ size: f.size, per: f.per, low: f.low, cells: b64(Uint16Array.from(f.kinds)) }))
const making = {
  // A make's name is a trademark: a kept library for visitors says what it is, not whose.
  name: named ?? t.name,
  size: t.size,
  cells: b64(Int32Array.from(t.cells)),
  motor: t.living.motor,
  controls: t.living.scheme ?? 'drive',
  ...(t.living.seats ? { seats: t.living.seats } : {}),
  ...(t.living.eye ? { eye: t.living.eye } : {}),
  ...(look.length ? { fine: look } : {}),
}
writeFileSync(to, JSON.stringify(making))
console.log(`${to}: ${making.name}, body ${t.size.join('x')}, ${look.length} parts of look, ${(JSON.stringify(making).length / 1024).toFixed(0)} KB`)
