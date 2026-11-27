// A preload for sf/build.mjs on a nearly full disk (#83), for measuring only:
//
//   node --import ./test/launch-perf/link-copies.mjs sf/build.mjs --staged <another checkout's dist-sf/sf>
//
// The build asks Node for a clone of every release file (COPYFILE_FICLONE) and of every kept Brotli copy. On this Mac
// (macOS 27.2, Node 25.1) Node copies the bytes instead: 600 files of 47 MB took 49 MB of disk, and a whole build
// 5.4 GB of the 7.5 GB that were free. With this, such a copy is a symbolic link to the file it would have copied, so
// a second built realm costs its code and nothing of its 6.6 GB of tiles. Nothing is written through a link: a link in
// the way of a write is taken away first.
//
// What it makes is for reading on this machine by test/launch-perf.mjs. It is not a folder to deploy, and it breaks
// when the folder it points into is built again (host.mjs `fingerprint` says so).
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const copy = fs.copyFileSync, write = fs.writeFileSync
const unlinkLink = (to) => { try { if (fs.lstatSync(to).isSymbolicLink()) fs.unlinkSync(to) } catch { /* nothing there */ } }
fs.copyFileSync = (from, to, mode = 0) => {
  unlinkLink(to)
  if (!(mode & fs.constants.COPYFILE_FICLONE)) return copy(from, to, mode)
  fs.rmSync(to, { force: true })
  fs.symlinkSync(fs.realpathSync(from), to)
}
fs.writeFileSync = (to, ...rest) => { if (typeof to === 'string') unlinkLink(to); return write(to, ...rest) }
syncBuiltinESMExports()
