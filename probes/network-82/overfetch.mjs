// SPIKE PROTOTYPE (#82, network optimizations). Not a check.
//
// Band 0's over-fetch by pack size: for the band-0 tiles a measured run asked for (measure.mjs), the requests and
// Brotli bytes of the packs that would hold them, for squares of 2, 4 and 8 tiles a side.
//
//   node probes/network-82/overfetch.mjs <built release dir> <measure.mjs output>
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants as Z } from 'node:zlib'
import { pack } from './pack.mjs'
const [release, logAt] = process.argv.slice(2)
const far = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8')).far, run = JSON.parse(readFileSync(logAt, 'utf8'))
const br = (b) => brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }).length
const all = Object.entries(far.tiles).filter(([, r]) => r[0]).map(([key]) => key)
const sizeOf = new Map()
const packSize = (k, g) => { const id = `${k}:${g}`; if (!sizeOf.has(id)) { const keys = all.filter((key) => { const [x, z] = key.split('_').map(Number); return `${Math.floor(x / k)}_${Math.floor(z / k)}` === g }).sort(); sizeOf.set(id, br(pack(keys.map((key) => [`far/0/${key}.far`, readFileSync(join(release, `far/0/${key}.far`))])))) } return sizeOf.get(id) }
const rows = []
for (const phases of [['cold-landing'], ['cold-landing', 'cold-explore']]) {
  const keys = new Set(run.log.filter((r) => phases.includes(r.phase) && !r.cached).map((r) => /\/far\/0\/(\d+_\d+)\.far/.exec(r.url)?.[1]).filter(Boolean))
  const each = [...keys].reduce((n, key) => n + statSync(join(release, `far/0/${key}.far.br`)).size, 0)
  const row = { 'band-0 tiles asked for by': phases.join(' + '), tiles: keys.size, 'as files now': `${keys.size} req, ${(each / 1048576).toFixed(2)} MB` }
  for (const k of [2, 4, 8]) { const groups = new Set([...keys].map((key) => { const [x, z] = key.split('_').map(Number); return `${Math.floor(x / k)}_${Math.floor(z / k)}` })); const bytes = [...groups].reduce((n, g) => n + packSize(k, g), 0); row[`${k}x${k} packs (${k / 2} km)`] = `${groups.size} req, ${(bytes / 1048576).toFixed(2)} MB` }
  rows.push(row)
}
console.table(rows)
