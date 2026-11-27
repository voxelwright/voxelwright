// SPIKE PROTOTYPE (#82, network optimizations). Not a check, not part of `npm run check`, and its output does not run:
// it measures what bundling would weigh, it does not rewrite the addresses a bundle would need rewritten (workers,
// core.wasm, the kit's sheet: all `new URL(..., import.meta.url)`).
//
// Bundles the realm's page from source (engine/page/main.ts and what it starts by address: its workers, the sound's
// worklet, the kit) into content-hashed chunks with esbuild, and compares with what sf/build.mjs ships now: one file
// a module. esbuild is not a dependency of the repo: pass where it is installed.
//
//   node probes/network-82/bundle-bench.mjs --esbuild <dir with node_modules/esbuild> [--landing <measure.mjs output>] [--out <dir>]
//
// With --landing (a measure.mjs log), "landing" rows count only the chunks that hold a module the landing really asked for.
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as Z, gzipSync, zstdCompressSync } from 'node:zlib'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), engine = join(repo, 'engine')
const esbuild = createRequire(join(resolve(arg('esbuild', '.')), 'x.js'))('esbuild')
const outBase = resolve(arg('out', join(repo, 'probes/network-82/.bundle')))
const br = (b, q = 11) => brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: q, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }).length
// What the live edge sends scripts as, to Chrome (measured: `content-encoding: zstd`); level 3 comes within 4% of the live bytes.
const zs = (b) => zstdCompressSync(b, { params: { [Z.ZSTD_c_compressionLevel]: 3 } }).length
const kb = (n) => Math.round(n / 102.4) / 10
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))

// What the page starts by address, which no bundler follows from main.ts: each is its own entry.
const entries = ['page/main.ts', 'page/worker.ts', 'page/mover.ts', 'page/streetfaces.ts', 'page/sound/music/worker.ts', 'page/sound/dsp.ts', 'kit/src/index.js']
// The modules a landing asked for (measure.mjs): "/page/far.js" is engine/page/far.ts, or .mjs, or .js.
const landingLog = arg('landing', null)
const asked = landingLog ? new Set(JSON.parse(readFileSync(landingLog, 'utf8')).log.filter((r) => r.phase === 'cold-landing' && /\.js$/.test(new URL(r.url).pathname)).map((r) => new URL(r.url).pathname.replace(/^\//, '').replace(/\.js$/, ''))) : null
const wasAsked = (input) => asked?.has(input.replace(/\.(ts|mjs|js)$/, ''))

// Types come off with Node's own stripper, as sf/build.mjs takes them off now (esbuild 0.25's own TypeScript parser
// stops at `out: Edit[]` in page/world.ts, reading `out` as a variance modifier). make/core.mjs reaches for Node only
// when it is in Node.
const stripped = { name: 'node-strip', setup(build) { build.onLoad({ filter: /\.ts$/ }, (a) => ({ contents: stripTypeScriptTypes(readFileSync(a.path, 'utf8')), loader: 'js' })) } }
process.removeAllListeners('warning')

const rows = []
if (asked) {
  // Now: one file a module, each compressed alone.
  let raw = 0, gz = 0, b11 = 0, b5 = 0, n = 0
  for (const stem of asked) {
    const path = ['.ts', '.mjs', '.js'].map((e) => join(engine, stem + e)).find((p) => { try { return statSync(p).isFile() } catch { return false } })
    if (!path) continue
    const text = Buffer.from(path.endsWith('.ts') ? stripTypeScriptTypes(readFileSync(path, 'utf8')) : readFileSync(path, 'utf8'))
    n++; raw += text.length; gz += gzipSync(text, { level: 9 }).length; b11 += br(text); b5 += zs(text)
  }
  rows.push({ build: 'now: one file a module (landing)', files: n, 'raw KB': kb(raw), 'gzip KB': kb(gz), 'zstd 3 KB (edge-like)': kb(b5), 'br q11 KB': kb(b11) })
}
for (const [label, options] of [['bundled, split, not minified', {}], ['bundled, split, minified', { minify: true }], ['bundled, split, minified, names kept', { minifyWhitespace: true, minifySyntax: true }]]) {
  const outdir = join(outBase, label.replace(/\W+/g, '-'))
  rmSync(outdir, { recursive: true, force: true })
  const t0 = performance.now()
  const result = await esbuild.build({
    absWorkingDir: engine, entryPoints: entries, outdir, bundle: true, splitting: true, format: 'esm', target: 'es2022', platform: 'browser',
    entryNames: '[dir]/[name]-[hash]', chunkNames: 'chunks/[name]-[hash]', metafile: true, logLevel: 'error', plugins: [stripped], external: ['node:*'], ...options,
  })
  const ms = performance.now() - t0
  const outs = Object.entries(result.metafile.outputs).filter(([p]) => p.endsWith('.js'))
  const weigh = (list) => { let raw = 0, gz = 0, b11 = 0, b5 = 0; for (const [p] of list) { const b = readFileSync(join(engine, p)); raw += b.length; gz += gzipSync(b, { level: 9 }).length; b11 += br(b); b5 += zs(b) } return { files: list.length, 'raw KB': kb(raw), 'gzip KB': kb(gz), 'zstd 3 KB (edge-like)': kb(b5), 'br q11 KB': kb(b11) } }
  rows.push({ build: `${label} (everything)`, ...weigh(outs), 'build ms': Math.round(ms) })
  if (asked) {
    const needed = outs.filter(([, o]) => Object.keys(o.inputs).some(wasAsked))
    rows.push({ build: `${label} (landing)`, ...weigh(needed) })
    if (label.includes('not minified')) console.log('landing chunks:', needed.map(([p, o]) => `${relative(relative(engine, outdir), p)} ${kb(o.bytes)} KB, ${Object.keys(o.inputs).length} modules`).join('\n  '))
  }
}
console.log(`modules a landing asked for: ${asked?.size ?? 'not given'}; source modules reached from the entries: ${new Set(files(join(engine, 'page')).filter((f) => f.endsWith('.ts'))).size} .ts under page/`)
console.table(rows)
