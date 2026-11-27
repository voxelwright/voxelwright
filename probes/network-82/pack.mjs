// SPIKE PROTOTYPE (#82, network optimizations).
//
// The pack: "VXPK", the index's length (u32, little-endian), a JSON index { name: [offset, length] }, then the files'
// bytes end to end. engine/page/far.ts reads the same layout behind `?farpacks=`.
/** The pack of some files, in the order given. */
export function pack(entries) {
  const index = {}
  let at = 0
  for (const [name, bytes] of entries) { index[name] = [at, bytes.length]; at += bytes.length }
  const head = Buffer.from(JSON.stringify(index)), lead = Buffer.alloc(8)
  lead.write('VXPK', 0, 'latin1'); lead.writeUInt32LE(head.length, 4)
  return Buffer.concat([lead, head, ...entries.map(([, b]) => b)])
}
/** A pack read back: name -> bytes (views, no copies). */
export function unpack(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'VXPK') throw Error('not a pack')
  const length = bytes.readUInt32LE(4), index = JSON.parse(bytes.toString('utf8', 8, 8 + length)), from = 8 + length
  return new Map(Object.entries(index).map(([name, [at, n]]) => [name, bytes.subarray(from + at, from + at + n)]))
}
