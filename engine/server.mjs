// A dedicated server (#526): one world, kept in a file, that strangers' pages join through a door (door.mjs) found
// through a master server. The world's own server (serve.mjs) runs in this same process, bound to this machine only;
// nothing reaches it from outside but what the door passes.
//
//   node server.mjs --world file --release <folder or address> --master <address> --name "..." --about "..."
//                   --most 8 [--private] [--password-file f] [--admin-password-file f] [--port 5747] [--ice-ports a-b]
//                   [--asks 30] [--up-mb 24] [--columns 65536] [--backlog-mb 32]
//                   [--things-minute 6] [--changes-minute 30] [--things 40] [--cells 4000000] [--reach 1200]
//                   [--release-cache dir] [--arrive=x,y,z,yaw] [--reports file] [--tiles-most 16] [--ground-wait 3000]
//
// --release is a built static realm (node sf/build.mjs) or the address of its current.json: pages join only a
// world on their own release. Without it the world is the generated town (pin "town"). --private keeps the lobby off
// the master's list: it is joined by its code. What one person who is not an admin may make: things a minute, changes
// to things a minute, things standing and their cells all told, and how far from where their page says they are (cells
// of 10 cm); admins are held to none of it. Passwords are read from their files, never from the command line.
// --most, and the last five, go to serve.mjs as they are (a value that starts with "-" is given with "=").
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { door } from './door.mjs'

const string = { type: 'string' }
const { values: a } = parseArgs({ options: {
  world: string, port: { type: 'string', default: '5747' }, release: string, 'release-cache': string, arrive: string, reports: string,
  master: string, name: string, about: string, most: string, private: { type: 'boolean' }, 'password-file': string, 'admin-password-file': string,
  'ice-ports': string, asks: string, 'up-mb': string, columns: string, 'backlog-mb': string, 'tiles-most': string, 'ground-wait': string,
  'things-minute': string, 'changes-minute': string, things: string, cells: string, reach: string,
} })
if (!a.world) { console.error('a server keeps a world: --world <file>'); process.exit(1) }
const secret = (name) => { const f = a[name]; if (!f) return null; const v = readFileSync(f, 'utf8').replace(/\r?\n$/, ''); if (!v) { console.error(`--${name} names an empty file`); process.exit(1) } return v }
const password = secret('password-file'), admin = secret('admin-password-file')
const ports = a['ice-ports']?.split('-').map(Number)

// The world's server, in this process: what it reads from the command line is set here, so one process is all
// there is to stop.
process.argv = [process.argv[0], new URL('./serve.mjs', import.meta.url).pathname, '--world', a.world, '--port', a.port,
  // The most players is the door's and the world's alike: the world holds the ground of that many (world.mjs `owners`).
  ...['release', 'release-cache', 'arrive', 'reports', 'most', 'tiles-most', 'ground-wait'].flatMap((name) => (a[name] ? [`--${name}`, a[name]] : []))]
await import('./serve.mjs')
const at = `http://127.0.0.1:${a.port}`
let ground = null
for (let i = 0; !ground; i++) {
  try { const r = await fetch(`${at}/world/ground`); if (r.ok) ground = await r.json() } catch { /* not listening yet */ }
  if (!ground) { if (i > 600) { console.error('the world did not start'); process.exit(1) } await new Promise((r) => setTimeout(r, 100)) }
}
const pin = ground.release ?? 'town'
const master = a.master?.replace(/\/$/, '') || null
let opened
try {
  opened = door({
  world: at, master, pin, keep: `${a.world}.door.json`, password, admin,
  name: a.name, about: a.about, most: Number(a.most) || 0, listed: !a.private,
  ports: ports?.length === 2 && ports.every(Number.isInteger) ? ports : null,
  limits: {
    ...(a.asks ? { asks: Number(a.asks) } : {}),
    ...(a['up-mb'] ? { upMinute: Number(a['up-mb']) << 20 } : {}),
    ...(a.columns ? { columns: Number(a.columns) } : {}),
    ...(a['backlog-mb'] ? { backlog: Number(a['backlog-mb']) << 20 } : {}),
    ...Object.fromEntries([['things-minute', 'thingsMinute'], ['changes-minute', 'changesMinute'], ['things', 'things'], ['cells', 'cells'], ['reach', 'reach']].filter(([flag]) => a[flag] !== undefined).map(([flag, key]) => [key, Number(a[flag])])),
  },
  })
} catch (e) { console.error(e.message); process.exit(1) }
console.log(`a dedicated server on ${pin === 'town' ? 'the generated town' : `San Francisco release ${pin.slice(0, 12)}`}`)
if (!master) console.log('no --master: nobody can find this server. A page joins a lobby the master lists; give the address of one (node server.mjs ... --master https://<a master>).')
else void opened.lobby.then(({ id, code }) => console.log(`lobby ${id}, code ${code}: a page joins with ?master=${encodeURIComponent(master)}&lobby=${a.private ? code : id}`))
const stop = () => { opened.close(); setTimeout(() => process.exit(0), 500) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
