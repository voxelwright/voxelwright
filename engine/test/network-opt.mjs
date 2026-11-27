// Network optimization checks (#82): verifies VXPK pack encoding/decoding & bounds validation, built release pack
// integrity (byte-for-byte + SHA-256 against the untouched manifest pin), embedded Bay metadata, content-hashed
// immutable JS/WASM/CSS bundles with zero unresolved asset tokens, and deploy/_headers immutable + CSP rules.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unpack, squarePackName } from '../page/pack.ts'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const repo = dirname(here)
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

let passed = 0
const check = (name, fn) => { fn(); console.log(`  ok  ${name}`); passed++ }

// 1. VXPK pack reader unit checks
check('pack.ts unpack round-trips valid VXPK buffers and isolates member slices', () => {
  const a = Buffer.from('hello world'), b = Buffer.from([1, 2, 3, 4, 5])
  const head = Buffer.from(JSON.stringify({ 'a.txt': [0, a.length], 'b.bin': [a.length, b.length] }))
  const lead = Buffer.alloc(8)
  lead.write('VXPK', 0, 'latin1')
  lead.writeUInt32LE(head.length, 4)
  const buf = Buffer.concat([lead, head, a, b])
  const map = unpack(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
  assert.equal(map.size, 2)
  assert.equal(Buffer.from(map.get('a.txt')).toString('utf8'), 'hello world')
  assert.deepEqual([...map.get('b.bin')], [1, 2, 3, 4, 5])
})

check('pack.ts unpack rejects bad magic, truncated header, and out-of-range member offsets', () => {
  assert.throws(() => unpack(new Uint8Array([0, 1, 2, 3, 0, 0, 0, 0])), /not a VXPK pack/)
  const trunc = Buffer.alloc(8)
  trunc.write('VXPK', 0, 'latin1')
  trunc.writeUInt32LE(999, 4)
  assert.throws(() => unpack(new Uint8Array(trunc)), /truncated/)
  const badHead = Buffer.from(JSON.stringify({ 'x': [0, 50] }))
  const badLead = Buffer.alloc(8)
  badLead.write('VXPK', 0, 'latin1')
  badLead.writeUInt32LE(badHead.length, 4)
  const oob = Buffer.concat([badLead, badHead, Buffer.from('short')])
  assert.throws(() => unpack(new Uint8Array(oob)), /out of range/)
})

check('pack.ts squarePackName maps UTM squares into 4 km buckets cleanly', () => {
  assert.equal(squarePackName('life', '551.7_4183.5', 4), 'life-137_1045.pack')
  assert.equal(squarePackName('names', '552.0_4184.0', 4), 'names-138_1046.pack')
  assert.equal(squarePackName('life', 'bad', 4), null)
})

// 2. Built dist-sf verification (when built)
const dist = join(here, 'dist-sf')
if (existsSync(join(dist, 'sf', 'index.html'))) {
  const html = readFileSync(join(dist, 'sf', 'index.html'), 'utf8')
  const realmMatch = html.match(/<script type="application\/json" id="realm">([\s\S]*?)<\/script>/)
  assert.ok(realmMatch, 'realm JSON tag present in sf/index.html')
  const realm = JSON.parse(realmMatch[1])

  check('sf/build.mjs embeds bay.heroes and bay.marksSquares in the page record', () => {
    assert.ok(Array.isArray(realm.bay?.heroes) && realm.bay.heroes.length > 0)
    assert.equal(typeof realm.bay?.marksSquares, 'string')
    const decoded = Buffer.from(realm.bay.marksSquares, 'base64')
    assert.equal(decoded.subarray(0, 4).toString('latin1'), 'MARK')
  })

  check('sf/build.mjs emits content-hashed immutable bundles under assets/ with zero unresolved tokens', () => {
    const mainMatch = html.match(/src="\.\.\/assets\/(main-[0-9a-f]{8}\.js)"/)
    assert.ok(mainMatch, 'index.html loads content-hashed ../assets/main-<hash>.js')
    const assetDir = join(dist, 'assets')
    const files = readdirSync(assetDir)
    assert.ok(files.some((f) => /^core-[0-9a-f]{8}\.wasm$/.test(f)), 'hashed core.wasm present')
    assert.ok(files.some((f) => /^dsp-[0-9a-f]{8}\.js$/.test(f)), 'hashed AudioWorklet dsp bundle present')
    assert.ok(files.some((f) => /^worker-[0-9a-f]{8}\.js$/.test(f)), 'hashed worker bundle present')
    assert.ok(files.some((f) => /^mover-[0-9a-f]{8}\.js$/.test(f)), 'hashed mover bundle present')
    assert.ok(files.some((f) => /^kit-[0-9a-f]{8}\.js$/.test(f)), 'hashed kit bundle present')
    for (const f of files.filter((x) => x.endsWith('.js'))) {
      const text = readFileSync(join(assetDir, f), 'utf8')
      assert.equal(text.includes('__VW_ASSET_'), false, `${f} has no unresolved asset tokens`)
      assert.match(f, /^.+-[0-9a-f]{8}\.js$/, `${f} has an 8-hex content hash`)
      for (const [, ref] of text.matchAll(/["'`]\.\/([a-zA-Z0-9_.-]+-[0-9a-f]{8}\.(?:js|wasm))(?=["'`?$])/g)) {
        assert.ok(files.includes(ref), `${f} references existing asset ./${ref}`)
      }
    }
  })

  check('sf/build.mjs writes verified VXPK release packs without mutating manifest.json', () => {
    const pointer = JSON.parse(readFileSync(join(dist, 'sf', 'current.json'), 'utf8'))
    const manifestPath = join(dist, 'sf', pointer.manifest)
    const manifestBytes = readFileSync(manifestPath)
    assert.equal(sha(manifestBytes), pointer.release, 'manifest SHA-256 still matches pinned release')
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    const relDir = dirname(manifestPath)
    assert.equal(realm.packs?.landing, 'packs/landing.pack')
    assert.equal(realm.packs?.far0, 4)
    const landingBuf = readFileSync(join(relDir, 'packs', 'landing.pack'))
    const landingMap = unpack(new Uint8Array(landingBuf.buffer, landingBuf.byteOffset, landingBuf.byteLength))
    const landingTiles = Object.values(manifest.far.landing.tiles)
    assert.equal(landingMap.size, landingTiles.length, 'landing.pack contains every landing tile')
    for (const rec of landingTiles) {
      const slice = landingMap.get(rec.path)
      assert.ok(slice, `landing.pack contains ${rec.path}`)
      assert.equal(slice.byteLength, rec.bytes)
      assert.equal(sha(slice), rec.sha256)
    }
    const carsBuf = readFileSync(join(relDir, 'packs', 'cars.pack'))
    const carsMap = unpack(new Uint8Array(carsBuf.buffer, carsBuf.byteOffset, carsBuf.byteLength))
    assert.ok(carsMap.has('cars/index.json'), 'cars.pack contains cars/index.json')
    for (const rec of Object.values(manifest.cars.objects)) {
      const slice = carsMap.get(rec.path)
      assert.ok(slice && slice.byteLength === rec.bytes && sha(slice) === rec.sha256, `cars.pack verified ${rec.path}`)
    }
  })
}

const distWorldHeaders = join(repo, 'deploy', 'dist-world', '_headers')
if (existsSync(distWorldHeaders)) {
  check('deploy/dist-world/_headers sets immutable cache for /assets/* and strict SHA-256 CSP', () => {
    const h = readFileSync(distWorldHeaders, 'utf8')
    assert.match(h, /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/)
    assert.match(h, /\/kit\/voxelmorphism-\*\.css\n {2}Cache-Control: public, max-age=31536000, immutable/)
    const scriptSrc = h.match(/script-src [^;\n]+/)?.[0] ?? ''
    assert.ok(scriptSrc.includes("'sha256-"), 'script-src uses SHA-256 hashes')
    assert.equal(scriptSrc.includes('unsafe-inline'), false, 'script-src forbids unsafe-inline')
  })
}

console.log(`\n${passed} network optimization checks passed.`)
