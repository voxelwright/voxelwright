// The cells a breakable thing is made of (#138, src/engine/voxels.ts): the quick search for
// loose pieces must find exactly what the slow one over the whole block finds, on thousands of
// random breaks; boxes must cover every solid cell once; a taken piece leaves nothing behind.
// Usage: node scripts/check-voxels.mjs [rounds]
import { createServer } from 'vite'

const rounds = Number(process.argv[2] ?? 400)
const server = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const bad = []
const fail = (why) => { if (bad.length < 12) bad.push(why) }
try {
  const V = await server.ssrLoadModule('/src/engine/voxels.ts')
  let seed = 12345
  const rnd = (k) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % k }
  const key = (cells) => cells.sort((a, b) => a - b).join(',')
  /** A block's pieces as sets of cell numbers, by the slow search. */
  const whole = (v, heldBelow) => {
    const { list, labels } = V.pieces(v, heldBelow)
    const sets = list.map(() => [])
    for (let i = 0; i < v.cells.length; i++) if (labels[i]) sets[labels[i] - 1].push(i)
    return list.map((p, k) => ({ held: p.held, cells: sets[k], n: p.cells }))
  }
  let breaks = 0, loose = 0, quiet = 0
  for (let round = 0; round < rounds; round++) {
    const size = [6 + rnd(22), 6 + rnd(22), 6 + rnd(22)]
    const v = V.voxels(size, 0.1)
    const a = V.kindOf(v, 'plaster'), b = V.kindOf(v, 'maple')
    const heldBelow = round % 3 === 0 ? 0 : 1
    // A frame of beams and slabs, so breaks do cut things off: a floor, posts, a few slabs and bars through them.
    V.fillBox(v, [0, 0, 0, size[0], 1 + rnd(2), size[2]], a)
    for (let i = 0; i < 3 + rnd(6); i++) { const x = rnd(size[0]), z = rnd(size[2]); V.fillBox(v, [x, 0, z, x + 1 + rnd(2), size[1], z + 1 + rnd(2)], a) }
    for (let i = 0; i < 1 + rnd(3); i++) { const y = 2 + rnd(size[1] - 2); V.fillBox(v, [0, y, 0, size[0], y + 1 + rnd(2), size[2]], b) }
    for (let i = 0; i < rnd(5); i++) { const y = rnd(size[1]), z = rnd(size[2]); V.fillBox(v, [0, y, z, size[0], y + 1, z + 1], b) }
    if (!heldBelow) {
      // A loose thing starts as one piece: keep the biggest.
      const { list, labels } = V.pieces(v, 0)
      const keep = list.reduce((p, q) => (q.cells > p.cells ? q : p))
      for (const p of list) if (p !== keep) V.drop(v, p, labels)
    } else {
      const { list, labels } = V.pieces(v, 1)
      for (const p of list) if (!p.held) V.drop(v, p, labels)
    }
    for (let k = 0; k < 14; k++) {
      const adding = rnd(5) === 0
      const hit = adding
        ? V.fillSphere(v, [rnd(size[0]), rnd(size[1]), rnd(size[2])], 1 + rnd(3), a, 'air')
        : V.fillSphere(v, [rnd(size[0]), rnd(size[1]), rnd(size[2])], 1 + rnd(5), 0)
      if (!hit) continue
      breaks++
      // Adding cells can join a floating bit of the new stuff to nothing: for a held block that bit is loose too, and the slow search says so.
      const before = whole(v, heldBelow)
      const expectLoose = heldBelow ? before.filter((p) => !p.held) : null
      const { list, labels } = V.loosened(v, hit.box, heldBelow, adding)
      const got = list.map((p) => { const cells = []; for (let i = 0; i < v.cells.length; i++) if (labels[i] === p.label && v.cells[i]) cells.push(i); return { p, cells } })
      for (const g of got) if (g.cells.length !== g.p.cells) fail(`round ${round}: a piece says ${g.p.cells} cells and its labels mark ${g.cells.length}`)
      for (const g of got) for (const i of g.cells) {
        const y = Math.floor(i / (size[0] * size[2])), rem = i - y * size[0] * size[2], z = Math.floor(rem / size[0]), x = rem - z * size[0]
        if (x < g.p.box[0] || x >= g.p.box[3] || y < g.p.box[1] || y >= g.p.box[4] || z < g.p.box[2] || z >= g.p.box[5]) { fail(`round ${round}: a piece's cell lies outside its box`); break }
      }
      if (heldBelow) {
        const want = expectLoose.map((p) => key(p.cells)).sort(), have = got.map((g) => key(g.cells)).sort()
        if (want.join('|') !== have.join('|')) fail(`round ${round} break ${k}: held block ${size}: the slow search finds ${want.length} loose pieces (${expectLoose.map((p) => p.n)}), the quick one ${have.length} (${got.map((g) => g.p.cells)})`)
      } else {
        // A loose thing: the quick search returns every piece but one, and that one is a piece too.
        const want = before.map((p) => key(p.cells)), have = got.map((g) => key(g.cells))
        const missing = want.filter((w) => !have.includes(w))
        if (before.length && (missing.length !== 1 || have.some((h) => !want.includes(h)))) fail(`round ${round} break ${k}: loose block ${size}: ${before.length} pieces by the slow search, the quick one returned ${have.length} and left ${missing.length} out`)
      }
      if (list.length) loose++; else quiet++
      // What the world does next: each loose piece becomes its own block (or is dropped), and the rest is whole again.
      let taken = 0
      const solidBefore = V.solidCells(v)
      for (const g of got) {
        if (g.p.cells % 2) { V.drop(v, g.p, labels); taken += g.p.cells; continue }
        const block = V.take(v, g.p, labels)
        taken += V.solidCells(block)
        if (V.solidCells(block) !== g.p.cells) fail(`round ${round}: a taken piece has ${V.solidCells(block)} cells of ${g.p.cells}`)
        const again = V.pieces(block, 0).list
        if (again.length !== 1) fail(`round ${round}: a taken piece is itself in ${again.length} pieces`)
        // Its boxes cover each solid cell exactly once.
        const boxes = V.boxesOf(block), cover = new Uint8Array(block.cells.length)
        for (let i = 0; i < boxes.length; i += 6) for (let y = boxes[i + 1]; y < boxes[i + 4]; y++) for (let z = boxes[i + 2]; z < boxes[i + 5]; z++) for (let x = boxes[i]; x < boxes[i + 3]; x++) cover[x + block.size[0] * (z + block.size[2] * y)]++
        for (let i = 0; i < cover.length; i++) if (cover[i] !== (block.cells[i] ? 1 : 0)) { fail(`round ${round}: boxes cover a cell ${cover[i]} times where ${block.cells[i] ? 'one is solid' : 'there is air'}`); break }
      }
      if (V.solidCells(v) !== solidBefore - taken) fail(`round ${round}: taking pieces removed ${solidBefore - V.solidCells(v)} cells, not ${taken}`)
      const after = whole(v, heldBelow)
      if (heldBelow ? after.some((p) => !p.held) : after.length > 1) fail(`round ${round} break ${k}: something loose was left in the block`)
    }
  }
  console.log(JSON.stringify({ rounds, breaks, cameLoose: loose, nothingLoose: quiet }))
  if (loose < rounds / 4) fail(`only ${loose} breaks cut something loose: the check is not testing much`)
} catch (e) { fail(e?.stack?.split('\n').slice(0, 6).join('\n')) }
await server.close()
if (bad.length) { console.log('FAILED:\n' + bad.join('\n')); process.exitCode = 1 } else console.log('ok')
