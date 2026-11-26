// The archives a host runs (#526): the master server (master/) and a dedicated server (engine/server.mjs with a
// Node of its own), for macOS on Apple silicon and Linux x86-64 (glibc), written under dist-packages/. It builds and
// never publishes: no registry, no release, no tag. What a host reads is guide/hosting.md, put in every archive as
// README.md.
//
//   node scripts/packages.mjs [--platforms darwin-arm64,linux-x64] [--only master|server]
//
// Needs: cargo with the rustup targets aarch64-apple-darwin and x86_64-unknown-linux-musl (the musl one links with
// rust-lld, which rustup ships: no C toolchain), npm, the network (Node's archive, npm's registry, licence texts).
// Downloads are pinned by SHA-256 and kept in dist-packages/.cache. Every archive is ustar with sorted names, the
// commit's time on every entry, owner 0 and gzip without a name or time, so two builds of one commit on this Mac
// give the same bytes; it prints each archive's size and SHA-256 and writes them to dist-packages/SHA256SUMS.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = fileURLToPath(new URL('..', import.meta.url)), ENGINE = join(ROOT, 'engine'), OUT = join(ROOT, 'dist-packages'), CACHE = join(OUT, '.cache')
const { values: args } = parseArgs({ options: { platforms: { type: 'string', default: 'darwin-arm64,linux-x64' }, only: { type: 'string' } } })
const run = (cmd, argv, opts = {}) => (execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }) ?? '').trim()
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Node's own build for each platform, checked against the hashes in its SHASUMS256.txt for this version. */
const NODE = { version: '24.22.3', 'darwin-arm64': '1d64136c8a43d648d1b3bad10797a4c995b1ca032d2bde8799de43b37f058fe5', 'linux-x64': '4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb' }
const PLATFORMS = {
  'darwin-arm64': { rust: 'aarch64-apple-darwin', npm: ['--os=darwin', '--cpu=arm64'], datachannel: 'darwin-arm64' },
  'linux-x64': { rust: 'x86_64-unknown-linux-musl', linker: 'rust-lld', npm: ['--os=linux', '--cpu=x64'], datachannel: 'linux-x64-gnu' },
}
/**
 * What node-datachannel's prebuilt library has inside it (its CMakeLists.txt fetches libdatachannel at this tag, whose
 * .gitmodules pins the rest; OpenSSL is linked in statically and its version is read out of the library below).
 * nlohmann/json is a submodule there too, built only with libdatachannel's examples.
 */
const NATIVE = [
  { name: 'libdatachannel 0.24.6', licence: 'MPL-2.0', source: 'https://github.com/paullouisageneau/libdatachannel/tree/v0.24.6', text: 'https://raw.githubusercontent.com/paullouisageneau/libdatachannel/v0.24.6/LICENSE', sha256: 'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85' },
  { name: 'libjuice (libdatachannel 0.24.6 submodule b89c792e)', licence: 'MPL-2.0', source: 'https://github.com/paullouisageneau/libjuice/tree/b89c792e3612faf2f12cf35bcc56857313a06be3', text: 'https://raw.githubusercontent.com/paullouisageneau/libjuice/b89c792e3612faf2f12cf35bcc56857313a06be3/LICENSE', sha256: 'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85' },
  { name: 'usrsctp (libdatachannel 0.24.6 submodule fec583d5)', licence: 'BSD-3-Clause', source: 'https://github.com/paullouisageneau/usrsctp/tree/fec583d54493f879d2ae44a743423bf8a04371ab', text: 'https://raw.githubusercontent.com/paullouisageneau/usrsctp/fec583d54493f879d2ae44a743423bf8a04371ab/LICENSE.md', sha256: 'fa53711b25af4b9a9b8dadfea3cb38166ec4b96760c8d62b284055554537d9ef' },
  { name: 'libsrtp 2.8.0 (libdatachannel 0.24.6 submodule 24b3bf8f)', licence: 'BSD-3-Clause', source: 'https://github.com/cisco/libsrtp/tree/24b3bf8f19b6f5ab4cd2bcceb4f4064efca86fd5', text: 'https://raw.githubusercontent.com/cisco/libsrtp/24b3bf8f19b6f5ab4cd2bcceb4f4064efca86fd5/LICENSE', sha256: '8e19d42a1eec9561f3f347253ddf2e385c55f392f025bb0fd41b88dbf38db5ae' },
  { name: 'plog (libdatachannel 0.24.6 submodule 94899e0b)', licence: 'MIT', source: 'https://github.com/SergiusTheBest/plog/tree/94899e0b926ac1b0f4750bfbd495167b4a6ae9ef', text: 'https://raw.githubusercontent.com/SergiusTheBest/plog/94899e0b926ac1b0f4750bfbd495167b4a6ae9ef/LICENSE', sha256: 'e4d01796524cbc13b1571a1f0914823c6a23b316ba039e7014f47a4eef7fd4c3' },
]

/** The licence text of each OpenSSL a prebuilt library has been seen to carry, by SHA-256. */
const OPENSSL_TEXTS = { '3.6.3': '7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a', '1.1.1w': 'c32913b33252e71190af2066f08115c69bc9fddadf3bf29296e20c835389841c' }

// ── What the dedicated server runs ──────────────────────────────────────
/** Files the server reads that no import names, each with why (paths in engine/). */
const DATA = {
  'page/core.wasm': 'the core every world\'s process runs (serve.mjs), built by `npm run core`',
  'sf/realm.json': 'San Francisco\'s arrival and meeting place (ground.mjs)',
  'sf/heroes.json': 'the engine\'s landmarks, where a release has none beside it (ground.mjs)',
  'sf/crossing-colours.json': 'read by sf/marks.mjs, which makes road marks for a staged release (serve.mjs)',
  'sf/street-tags.json': 'read by sf/marks.mjs, as above',
  'package.json': 'the production dependencies, installed by npm ci',
  'package-lock.json': 'their exact versions and hashes',
}
/** Every plugin folder's files a server reads (plugins.mjs `found`): its world side, its guide, and its page side, which only versions it here. */
const PLUGIN_FILES = ['world.mjs', 'guide.txt', 'page.ts']
/** Imports the walk cannot follow (a name made at run time), each with why it is safe to leave. Keyed by file. */
const UNFOLLOWED = {
  'plugins.mjs': 'imports each plugin\'s world.mjs by its folder\'s name: every plugin folder is shipped',
  'page/world.ts': 'starts page/worker.ts on a page\'s GPU (hire): never in the server',
}
/** Literal module names: a relative path, an import(), a side-effect import, a new URL beside this module. Type-only imports are erased by Node and skipped. */
const SPECIFIERS = [/^\s*(?:import|export)\s(?!type\s)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s*['"]([^'"]+)['"]/gm, /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g]
const MADE_AT_RUN = [/\bimport\s*\(\s*[^'"\s)]/, /new\s+URL\(\s*`[^`]*\$\{[^`]*`\s*,\s*import\.meta\.url/]

/** The engine's files a dedicated server needs: everything server.mjs and the plugins import, followed to the end, and DATA. Fails on anything it cannot account for. */
function serverFiles() {
  const tracked = new Set(run('git', ['ls-files', '-z', 'engine'], { cwd: ROOT }).split('\0').filter(Boolean).map((f) => f.slice('engine/'.length)))
  const plugins = readdirSync(join(ENGINE, 'plugins')).filter((p) => statSync(join(ENGINE, 'plugins', p)).isDirectory()).sort()
  const files = new Set(), packages = new Set(), wrong = []
  const todo = ['server.mjs', ...plugins.map((p) => `plugins/${p}/world.mjs`).filter((f) => tracked.has(f))]
  while (todo.length) {
    const file = todo.pop()
    if (files.has(file)) continue
    files.add(file)
    const source = readFileSync(join(ENGINE, file), 'utf8')
    if (!UNFOLLOWED[file] && MADE_AT_RUN.some((re) => re.test(source))) wrong.push(`${file} imports or opens a module by a name made at run time: account for it in UNFOLLOWED`)
    for (const re of SPECIFIERS) for (const [, spec] of source.matchAll(re)) {
      if (spec.startsWith('node:')) continue
      if (!spec.startsWith('.')) { packages.add(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')); continue }
      if (spec.endsWith('/')) continue
      const target = normalize(join(dirname(file), spec.split('?')[0]))
      if (target.startsWith('..') || !tracked.has(target)) { if (target !== 'page/core.wasm') wrong.push(`${file} names ${spec}, which git does not hold under engine/`); continue }
      if (/\.(mjs|js|ts)$/.test(target)) todo.push(target)
      else files.add(target)
    }
  }
  for (const p of plugins) for (const f of PLUGIN_FILES) if (tracked.has(`plugins/${p}/${f}`)) files.add(`plugins/${p}/${f}`)
  for (const f of Object.keys(DATA)) { if (f !== 'page/core.wasm' && !tracked.has(f)) wrong.push(`${f} is not held by git`); files.add(f) }
  const dependencies = Object.keys(JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8')).dependencies)
  for (const p of packages) if (!dependencies.includes(p)) wrong.push(`the server imports ${p}, which is not one of engine/package.json's dependencies`)
  if (wrong.length) throw new Error(`the server's files do not add up:\n  ${wrong.join('\n  ')}`)
  return [...files].sort()
}

// ── Downloads, pinned ───────────────────────────────────────────────────
async function fetched(url, expect) {
  mkdirSync(CACHE, { recursive: true })
  const kept = join(CACHE, sha256(url).slice(0, 16) + '-' + url.split('/').pop())
  if (existsSync(kept) && (!expect || sha256(readFileSync(kept)) === expect)) return readFileSync(kept)
  const answer = await fetch(url)
  if (!answer.ok) throw new Error(`${url}: ${answer.status}`)
  const bytes = Buffer.from(await answer.arrayBuffer())
  if (expect && sha256(bytes) !== expect) throw new Error(`${url} is not the file pinned here (SHA-256 ${sha256(bytes)})`)
  writeFileSync(kept, bytes)
  return bytes
}

// ── The archive ─────────────────────────────────────────────────────────
/** Every path under dir, folders first, sorted. */
const walk = (dir, at = '') => readdirSync(join(dir, at)).sort().flatMap((name) => {
  const rel = at ? `${at}/${name}` : name, st = lstatSync(join(dir, rel))
  if (st.isSymbolicLink()) throw new Error(`${rel} is a symbolic link: an archive here holds files and folders only`)
  return st.isDirectory() ? [rel, ...walk(dir, rel)] : [rel]
})
/** dir as name.tar.gz in OUT: modes 755 or 644, the commit's time, owner 0, sorted, gzip with no name or time. */
function archive(stage, name, epoch, executables) {
  const parent = dirname(stage), paths = [name, ...walk(stage).map((p) => `${name}/${p}`)]
  for (const p of paths.slice().reverse()) {
    const full = join(parent, p), dir = statSync(full).isDirectory()
    chmodSync(full, dir || executables.includes(relative(stage, full)) ? 0o755 : 0o644)
    utimesSync(full, epoch, epoch)
  }
  const list = join(parent, `${name}.list`), tar = join(OUT, `${name}.tar`)
  writeFileSync(list, paths.join('\n') + '\n')
  rmSync(tar, { force: true }); rmSync(`${tar}.gz`, { force: true })
  run('tar', ['-c', '-n', '--format', 'ustar', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root', '--no-mac-metadata', '--no-xattrs', '--no-acls', '--no-fflags', '-f', tar, '-C', parent, '-T', list], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  run('gzip', ['-n', '-9', tar])
  const bytes = readFileSync(`${tar}.gz`)
  return { file: `${name}.tar.gz`, size: bytes.length, sha256: sha256(bytes) }
}

// The guide page's Mintlify frontmatter becomes an ordinary heading in the archive.
const page = () => readFileSync(join(ROOT, 'guide', 'hosting.md'), 'utf8')
  .replace(/^---\n[\s\S]*?^title: (.+)$[\s\S]*?^---\n/m, '# $1\n')
const common = (stage) => {
  writeFileSync(join(stage, 'README.md'), page())
  for (const f of ['LICENSE', 'NOTICE']) copyFileSync(join(ROOT, f), join(stage, f))
}

// ── The master ──────────────────────────────────────────────────────────
function master(platform, version, epoch) {
  const { rust, linker } = PLATFORMS[platform], dir = join(ROOT, 'master')
  // Panic messages name source files: written as /cargo and /rustc, never this machine's home, so no user name is in the
  // binary and another machine builds the same bytes.
  const home = process.env.CARGO_HOME ?? join(homedir(), '.cargo'), sysroot = run('rustc', ['--print', 'sysroot'])
  const rustflags = [`--remap-path-prefix=${home}=/cargo`, `--remap-path-prefix=${sysroot}=/rustc`, `--remap-path-prefix=${dir}=/master`].join('\x1f')
  run('cargo', ['build', '--release', '--locked', '--target', rust, ...(linker ? ['--config', `target.${rust}.linker="${linker}"`] : [])], { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: rustflags } })
  const name = `voxelwright-master-${version}-${platform}`, stage = join(OUT, '.stage', name)
  rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true })
  copyFileSync(join(dir, 'target', rust, 'release', 'village-master'), join(stage, 'village-master'))
  common(stage)
  // The crates linked into the binary: what the root needs to build and run on this target, not to test or build scripts.
  const meta = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--locked', '--filter-platform', rust], { cwd: dir, maxBuffer: 64 << 20 }))
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n])), byId = new Map(meta.packages.map((p) => [p.id, p])), linked = new Set(), todo = [meta.resolve.root]
  while (todo.length) { const id = todo.pop(); if (linked.has(id)) continue; linked.add(id); for (const d of nodes.get(id).deps) if (d.dep_kinds.some((k) => k.kind === null)) todo.push(d.pkg) }
  linked.delete(meta.resolve.root)
  const rows = []
  for (const p of [...linked].map((id) => byId.get(id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    const from = dirname(p.manifest_path), texts = readdirSync(from).filter((f) => /^(licen[cs]e|copying|notice|unlicense)/i.test(f)).sort()
    const to = join(stage, 'licenses', `${p.name}-${p.version}`)
    if (texts.length) { mkdirSync(to, { recursive: true }); for (const t of texts) copyFileSync(join(from, t), join(to, t)) }
    rows.push(`| ${p.name} | ${p.version} | ${p.license ?? (p.license_file ? `see ${p.license_file.split(/[\\/]/).pop()}` : 'not stated')} | ${texts.length ? `licenses/${p.name}-${p.version}/` : 'none in the crate'} |`)
  }
  writeFileSync(join(stage, 'THIRD-PARTY.md'), [
    '# What else is in village-master', '',
    `village-master is Voxelwright's (Apache-2.0, LICENSE). Built with Rust for ${rust}; these ${rows.length} crates are linked into it.`,
    'Each crate\'s own licence files, as it ships them, are in licenses/.', '',
    `Rust's standard library is linked in too (MIT OR Apache-2.0, https://github.com/rust-lang/rust).${rust.includes('musl') ? ' So is musl libc, which Rust\'s musl target links in statically (MIT, https://musl.libc.org).' : ''}`, '',
    '| Crate | Version | Licence | Texts |', '| --- | --- | --- | --- |', ...rows, '',
  ].join('\n'))
  return archive(stage, name, epoch, ['village-master'])
}

// ── The dedicated server ────────────────────────────────────────────────
async function server(platform, version, epoch, files) {
  const { npm, datachannel } = PLATFORMS[platform]
  const name = `voxelwright-server-${version}-${platform}`, stage = join(OUT, '.stage', name), engine = join(stage, 'engine')
  rmSync(stage, { recursive: true, force: true }); mkdirSync(engine, { recursive: true })
  for (const f of files) { mkdirSync(dirname(join(engine, f)), { recursive: true }); copyFileSync(join(ENGINE, f), join(engine, f)) }
  // The production dependencies for that platform, from the lockfile: npm picks node-datachannel's prebuilt library by
  // the --os and --cpu given, so the Linux one comes from npm's registry with the lockfile's hash on this Mac. Its
  // glibc and musl builds say no libc in their package.json, so npm puts both in: the one node-datachannel loads on a
  // glibc system (its lib/node-datachannel.mjs, through detect-libc) is kept and any other taken out.
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', ...npm], { cwd: engine, stdio: ['ignore', 'inherit', 'inherit'] })
  rmSync(join(engine, 'node_modules', '.package-lock.json'), { force: true })
  const natives = join(engine, 'node_modules', '@node-datachannel')
  if (!existsSync(join(natives, datachannel))) throw new Error(`npm put no ${datachannel} in`)
  for (const other of readdirSync(natives)) if (other !== datachannel) rmSync(join(natives, other), { recursive: true })
  const library = readFileSync(join(engine, 'node_modules', '@node-datachannel', datachannel, 'node_datachannel.node'))
  // Which OpenSSL is linked in differs by platform (3.x on macOS, 1.1.1 on Linux for node-datachannel 0.33.6), and so does its licence.
  const openssl = /OpenSSL (\d+\.\d+\.\d+[a-z]?) /.exec(library.toString('latin1'))?.[1]
  if (!/^(3\.\d+\.\d+|1\.1\.1[a-z])$/.test(openssl ?? '')) throw new Error(`no OpenSSL this script knows the licence of in ${datachannel}'s library (${openssl ?? 'none found'})`)
  const ssl = openssl.startsWith('3.')
    ? { licence: 'Apache-2.0', tag: `openssl-${openssl}`, file: 'LICENSE.txt' }
    : { licence: 'OpenSSL License and SSLeay License', tag: `OpenSSL_${openssl.replaceAll('.', '_')}`, file: 'LICENSE' }
  if (!OPENSSL_TEXTS[openssl]) throw new Error(`OpenSSL ${openssl} is in ${datachannel}'s library: pin its licence text's SHA-256 in OPENSSL_TEXTS`)
  // Node, as nodejs.org builds it: the program and its licence (which lists what Node bundles).
  const nodeName = `node-v${NODE.version}-${platform}`, tarball = await fetched(`https://nodejs.org/dist/v${NODE.version}/${nodeName}.tar.xz`, NODE[platform])
  const unpack = join(OUT, '.stage', nodeName)
  rmSync(unpack, { recursive: true, force: true }); mkdirSync(unpack, { recursive: true })
  writeFileSync(join(unpack, 'node.tar.xz'), tarball)
  run('tar', ['-xJf', join(unpack, 'node.tar.xz'), '-C', unpack, `${nodeName}/bin/node`, `${nodeName}/LICENSE`])
  mkdirSync(join(stage, 'node', 'bin'), { recursive: true })
  copyFileSync(join(unpack, nodeName, 'bin', 'node'), join(stage, 'node', 'bin', 'node'))
  copyFileSync(join(unpack, nodeName, 'LICENSE'), join(stage, 'node', 'LICENSE'))
  rmSync(unpack, { recursive: true, force: true })
  mkdirSync(join(stage, 'bin'))
  writeFileSync(join(stage, 'bin', 'voxelwright-server'), [
    '#!/bin/sh',
    '# A Voxelwright dedicated server: engine/server.mjs run by the Node in this folder. Its flags: README.md.',
    '# Followed through any symbolic links to it, so a link in a folder on PATH works.',
    'self=$0',
    'while [ -L "$self" ]; do link=$(readlink "$self"); case $link in /*) self=$link ;; *) self=$(dirname "$self")/$link ;; esac; done',
    'here=$(cd "$(dirname "$self")/.." && pwd -P)',
    'exec "$here/node/bin/node" "$here/engine/server.mjs" "$@"', '',
  ].join('\n'))
  common(stage)
  // What else is in it: npm packages (each folder keeps its own licence file), Node, and the native library's parts.
  const packages = walk(join(engine, 'node_modules')).filter((p) => /(^|\/)package\.json$/.test(p) && p.split('/').filter((s) => s === 'node_modules').length === 0 && p.split('/').length === (p.startsWith('@') ? 3 : 2))
    .map((p) => JSON.parse(readFileSync(join(engine, 'node_modules', p), 'utf8'))).sort((a, b) => a.name.localeCompare(b.name))
  mkdirSync(join(stage, 'licenses'))
  const native = [...NATIVE, { name: `OpenSSL ${openssl} (linked in statically)`, licence: ssl.licence, source: `https://github.com/openssl/openssl/tree/${ssl.tag}`, text: `https://raw.githubusercontent.com/openssl/openssl/${ssl.tag}/${ssl.file}`, sha256: OPENSSL_TEXTS[openssl] }]
  for (const n of native) writeFileSync(join(stage, 'licenses', `${n.name.split(' ')[0].toLowerCase()}.txt`), await fetched(n.text, n.sha256))
  writeFileSync(join(stage, 'THIRD-PARTY.md'), [
    '# What else is in this server', '',
    'engine/ is Voxelwright\'s (Apache-2.0, LICENSE): the same files as engine/ in its repository at this commit, and only those the server runs.', '',
    `node/bin/node is Node.js ${NODE.version} as nodejs.org builds it for ${platform}: MIT, with what it bundles listed in node/LICENSE.`, '',
    'npm packages in engine/node_modules. Each keeps its licence file in its own folder, but for the prebuilt library\'s package, whose MPL-2.0 text is node-datachannel/LICENSE:', '',
    '| Package | Version | Licence |', '| --- | --- | --- |', ...packages.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`), '',
    `@node-datachannel/${datachannel}'s node_datachannel.node is built by node-datachannel's maintainers from these, linked in; their licence texts are in licenses/. node-datachannel and libdatachannel are MPL-2.0: their source, at the versions built, is at the addresses below.`, '',
    '| Library | Licence | Source |', '| --- | --- | --- |', ...native.map((n) => `| ${n.name} | ${n.licence} | ${n.source} |`),
    '| node-datachannel 0.33.6 | MPL-2.0 | https://github.com/murat-dogan/node-datachannel/tree/v0.33.6 |', '',
  ].join('\n'))
  return archive(stage, name, epoch, ['bin/voxelwright-server', 'node/bin/node'])
}

// ── Build ───────────────────────────────────────────────────────────────
const platforms = args.platforms.split(',')
for (const p of platforms) if (!PLATFORMS[p]) throw new Error(`no platform ${p}: ${Object.keys(PLATFORMS).join(', ')}`)
const commit = run('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT }), dirty = run('git', ['status', '--porcelain', '--', 'engine', 'master', 'guide/hosting.md', 'LICENSE', 'NOTICE'], { cwd: ROOT }) !== ''
const version = dirty ? `${commit}-dirty` : commit, epoch = Number(run('git', ['log', '-1', '--format=%ct'], { cwd: ROOT }))
if (dirty) console.warn(`engine/, master/ or the page have changes not committed: the archives are named ${version} and are not that commit`)
mkdirSync(OUT, { recursive: true })
const made = []
if (args.only !== 'server') for (const p of platforms) made.push(master(p, version, epoch))
if (args.only !== 'master') {
  run('node', ['core/build.mjs'], { cwd: ENGINE, stdio: ['ignore', 'inherit', 'inherit'] })
  const files = serverFiles()
  console.log(`the server's engine files: ${files.length}`)
  for (const p of platforms) made.push(await server(p, version, epoch, files))
}
rmSync(join(OUT, '.stage'), { recursive: true, force: true })
writeFileSync(join(OUT, 'SHA256SUMS'), made.map((m) => `${m.sha256}  ${m.file}\n`).join(''))
for (const m of made) console.log(`${m.file}  ${(m.size / 1e6).toFixed(1)} MB  sha256 ${m.sha256}`)
