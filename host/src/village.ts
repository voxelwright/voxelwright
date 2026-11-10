// Village, kept on (#85): the live home and the villagers on one origin, pairing, and a launchd agent.
//
//   npm run village                       start (installs the live home from this commit if missing)
//   npm run village -- link <person> [--add] [--url https://<mac>.<tailnet>.ts.net/]
//   npm run village -- unlink <person>     end every device and link of that person
//   npm run village -- status
//   npm run village -- service install|uninstall|status|plist [--label dev.village.home]   (plist: print what install writes)
//
// Options for start and service install: --root ~/.village, --live <root>/live, --port 5183, and the villager's
// own (--agent warm|claude|stub, --model haiku, …; see villager-cli.ts). VILLAGER_PEOPLE lists the people.
//
// The approval page (#87, approval-server.ts) is served by the villagers on 127.0.0.1:<port + 1>
// (--approval-port), its own origin: Keep and Undo for an Elder change happen only there.
// --approval-url names it as a phone reaches it (a second `tailscale serve` port); see host/README.md.
//
// One origin: the live home's Vite serves the page on 127.0.0.1:<port> and forwards /villager/api/* to the
// villagers, which listen on a loopback port of their own. Pairing cookies are per host name, so a device
// keeps using the address it was paired on (localhost, or the tailnet name behind `tailscale serve`).
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { Context } from 'cordis'
import villager from './villager.ts'
import { install, startLive, status as liveStatus } from './live.ts'
import { pairingStore, pairLink } from './pairing.ts'
import { announcePairing, homeHosts, listedPeople, startElder, villagerConfig, villagerOptions } from './villager-cli.ts'

const run = promisify(execFile)
/** Without VILLAGER_PEOPLE: the household the home's cast shows (Alex, Sam and Mia's villagers), so every line can route. */
const HOUSEHOLD = { alex: 'Alex', sam: 'Sam', mia: 'Mia' }
const HOST_DIR = resolve(import.meta.dirname, '..')
const COMMAND = 'npm run village --'
const DEFAULT_LABEL = 'dev.village.home'

const options = {
  ...villagerOptions,
  live: { type: 'string' },
  port: { type: 'string', default: '5183' },
  url: { type: 'string' },
  add: { type: 'boolean', default: false },
  label: { type: 'string', default: DEFAULT_LABEL },
} as const

const { values, positionals } = parseArgs({ options, allowPositionals: true })
const root = resolve(values.root)
const live = resolve(values.live ?? join(root, 'live'))
const port = Number(values.port)
/** The approval page's own port (#87): --approval-port, or the next one after the home's. */
const approvalPort = Number(values['approval-port'] ?? port + 1)
/** The address links are made for: --url, or this Mac's own. */
const homeUrl = values.url ?? `http://localhost:${port}/`

async function start() {
  if (!existsSync(join(live, '.git'))) {
    console.log(`Installing the live home in ${live} from this checkout's commit…`)
    const installed = await install(live, HOST_DIR, 'HEAD')
    console.log(`Installed ${installed.sourceCommit.slice(0, 12)} in ${Math.round(installed.installMs / 1000)} s.`)
  }
  const config = villagerConfig(values, 0, HOUSEHOLD)
  const ctx = new Context()
  // The Elder (#87) copies from this checkout and promotes into the same live copy this command serves.
  const elder = await startElder(ctx, values, Object.keys(config.people!), { source: resolve(HOST_DIR, '..'), live, approvalPort, liveIsHome: true })
  const fiber = ctx.plugin(villager, { ...config, elder: elder.elder, approvalPort, homeHosts: homeHosts(port, values.url) })
  await fiber.await()
  // The live home's own vite.config.ts reads this when it loads, and forwards /villager/api there.
  process.env.VILLAGER_PORT = String(ctx.villager.port)
  // Vite answers only this Mac's own names and the --url host (tailscale serve), never any other name.
  const home = await startLive(live, port, { allowedHosts: values.url ? [new URL(values.url).hostname] : [] })
  const people = Object.keys(config.people!)
  console.log(elder.describe(ctx.villager.approvalPort))
  console.log(`Village is open at http://localhost:${port}/ (villagers: ${values.agent}${values.agent === 'stub' ? '' : `, ${values.model}`}; live home ${live})`)
  await announcePairing(ctx.villager.pairing, people, homeUrl, COMMAND, homeHosts(port, values.url))
  console.log(`A new device: ${COMMAND} link <person> [--add] [--url https://<this mac>.<tailnet>.ts.net/]`)
  let stopping = false
  // Vite's dev server exits the process on SIGTERM by itself; this host owns the stop, so a Keep or Undo finishes first.
  process.removeAllListeners('SIGTERM')
  // `on`, not `once`: Ctrl+C reaches the whole process group and npm forwards it again, and a second signal must not kill a stop in progress.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      if (stopping) return
      stopping = true
      await home.close().catch(() => {})
      await fiber.dispose()
      await elder.dispose()
      process.exit(0)
    })
  }
}

async function link(person: string | undefined) {
  const people = Object.keys(listedPeople(HOUSEHOLD).people)
  if (!person || !people.includes(person)) throw new Error(`Name a listed person: ${COMMAND} link ${people.join('|')}`)
  const code = await pairingStore(root).mint(person, { keep: values.add, hosts: homeHosts(port, values.url) })
  console.log(values.add ? `A link for one more of ${person}'s devices.` : `A new link for ${person}. Every device paired as ${person} on this home before needs it again.`)
  console.log(`Open it once, on the device, within a day; it stops working after that:`)
  console.log(pairLink(homeUrl, code))
}

/** Ends every session and unused link of a person, listed or not: their devices need a new link. */
async function unlink(person: string | undefined) {
  if (!person || !/^[a-z][a-z0-9-]{0,31}$/.test(person)) throw new Error(`Name a person: ${COMMAND} unlink <person>`)
  await pairingStore(root).revoke(person)
  console.log(`Unlinked ${person}: every device paired as ${person} must be paired again.`)
}

// ── launchd (macOS): a LaunchAgent in the person's own session, kept alive by launchd ───────────────────────────

const domain = () => `gui/${process.getuid!()}`
const plistPath = (label: string) => join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The LaunchAgent: runs `start` with this command's options, restarts it when it exits, and logs to <root>/logs.
 * Interactive: without a ProcessType launchd throttles the job's I/O, and the live install's git add timed out.
 */
export function plist(label: string, args: string[], env: Record<string, string>, log: string) {
  const strings = (list: string[]) => list.map((a) => `    <string>${xml(a)}</string>`).join('\n')
  const dict = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings(args)}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(HOST_DIR)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${dict}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`
}

async function serviceStatus(label: string) {
  const file = plistPath(label)
  const printed = await run('launchctl', ['print', `${domain()}/${label}`]).then((r) => r.stdout, () => null)
  return {
    label,
    plist: existsSync(file) ? file : null,
    loaded: printed !== null,
    state: printed ? /^\s*state = (.+)$/m.exec(printed)?.[1] ?? 'unknown' : null,
    pid: printed ? Number(/^\s*pid = (\d+)$/m.exec(printed)?.[1]) || null : null,
    runs: printed ? Number(/^\s*runs = (\d+)$/m.exec(printed)?.[1]) || 0 : 0,
  }
}

/** Options that are the service command's own, not the home's: never passed on to `start`. */
const SERVICE_ONLY = new Set(['add', 'label'])
/** Options that are paths: passed on resolved, since launchd starts in host/. */
const PATHS = new Set(['root', 'live', 'candidates'])

/** `start` with every option this command was given (so a new option needs no edit here), and the resolved places. */
function startArgs() {
  const args = [process.execPath, join(HOST_DIR, 'src', 'village.ts'), 'start']
  const given: Record<string, unknown> = { ...values, root, live, port: String(port), 'approval-port': String(approvalPort) }
  for (const [key, value] of Object.entries(given)) {
    if (SERVICE_ONLY.has(key) || value === undefined || value === false) continue
    if (value === true) args.push(`--${key}`)
    else args.push(`--${key}`, PATHS.has(key) ? resolve(String(value)) : String(value))
  }
  return args
}

async function service(action: string | undefined) {
  if (process.platform !== 'darwin') throw new Error('service uses launchd, so it runs on macOS only')
  const label = values.label
  if (!/^[\w.-]+$/.test(label)) throw new Error('--label is letters, digits, dots, dashes and underscores')
  const file = plistPath(label)
  const log = join(root, 'logs', 'village.log')
  const serviceEnv = () => {
    // The agent's own session: the same PATH and HOME as this terminal; the people, if listed.
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir() }
    for (const key of ['VILLAGER_PEOPLE', 'VILLAGER_PROFILES'] as const) if (process.env[key]) env[key] = key === 'VILLAGER_PROFILES' ? resolve(process.env[key]!) : process.env[key]!
    return env
  }
  if (action === 'plist') {
    // What install would write, without writing or loading it.
    process.stdout.write(plist(label, startArgs(), serviceEnv(), log))
  } else if (action === 'install') {
    if ((await serviceStatus(label)).loaded) throw new Error(`${label} is already loaded; uninstall it first`)
    await mkdir(dirname(log), { recursive: true, mode: 0o700 })
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, plist(label, startArgs(), serviceEnv(), log), { mode: 0o600 })
    await run('launchctl', ['bootstrap', domain(), file])
    console.log(`Installed ${label}: launchd starts Village at login and restarts it if it stops. Log: ${log}`)
    console.log(`Pair a device with: ${COMMAND} link <person>${values.root === villagerOptions.root.default ? '' : ` --root ${root}`}`)
  } else if (action === 'uninstall') {
    const was = await serviceStatus(label)
    if (was.loaded) await run('launchctl', ['bootout', `${domain()}/${label}`])
    await rm(file, { force: true })
    // bootout returns before launchd has let go of the job: wait until it is gone, so "Removed" is true.
    for (let i = 0; i < 100 && (await serviceStatus(label)).loaded; i++) await new Promise((r) => setTimeout(r, 100))
    if ((await serviceStatus(label)).loaded) throw new Error(`${label} is still loaded after 10 s; check \`launchctl print ${domain()}/${label}\``)
    console.log(was.loaded || was.plist ? `Removed ${label}.` : `${label} was not installed.`)
  } else if (action === 'status') {
    console.log(JSON.stringify(await serviceStatus(label), null, 2))
  } else throw new Error(`Usage: ${COMMAND} service install|uninstall|status|plist [--label ${DEFAULT_LABEL}]`)
}

async function status() {
  const pairing = await pairingStore(root).status(homeHosts(port, values.url))
  console.log(JSON.stringify({
    live: await liveStatus(live),
    people: Object.fromEntries(Object.keys(listedPeople(HOUSEHOLD).people).map((p) => [p, pairing[p] ?? { sessions: 0, codes: 0 }])),
    service: process.platform === 'darwin' ? await serviceStatus(values.label) : null,
  }, null, 2))
}

try {
  const [command = 'start', arg] = positionals
  if (command === 'start') await start()
  else if (command === 'link') await link(arg)
  else if (command === 'unlink') await unlink(arg)
  else if (command === 'status') await status()
  else if (command === 'service') await service(arg)
  else throw new Error(`Usage: ${COMMAND} [start|link <person>|unlink <person>|status|service install|uninstall|status|plist]`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
