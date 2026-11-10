// The checks `npm run check` runs, and what is known about running them together.
//
// Fields
//   name      what you pass to --only
//   cwd       'home' or 'host'
//   run       argv. Any {name} other than {base} and {scratch} becomes a free port the runner picked (the same
//             port for the same name within a check), {base} the shared dev
//             server's URL (needs: 'devServer'), {scratch} a private empty folder.
//   needs     'devServer' = the check opens a page on an already running dev server.
//   serial    true = runs alone, after the others: it fails under load (measured: four at once on a 10-core Mac).
//   local     a reason string = never runs in CI (npm run check --ci); runs on a developer machine.
//   needsFile a path (from the repo root) that must exist, else the check is skipped; for generated assets.
//   skip      a reason string = cannot run at all from a clean clone; shown as skip.
//   seconds   rough wall time on the M-series dev Mac, used only to start the slow ones first.
//
// Facts measured on the dev Mac (see README, "Checks"): every self-starting check takes its ports
// from --dev/--host, so the runner hands each one its own pair and no default port is used (the
// defaults sit on ports a play server may own). Every page check launches its own Chrome with
// its own profile, so Chrome itself is not shared. Temp folders come from mkdtemp, never shared.
const MAC_SANDBOX = 'the Elder\'s gates run the candidate under the macOS Seatbelt sandbox (srt) and shoot a WebGPU page'
const SOFTWARE_GL = 'timeouts or time bounds on a hosted Linux runner, in software WebGL2 (3 CI runs, #89)'

export const CHECKS = [
  // Static
  { name: 'host-typecheck', cwd: 'host', run: ['npm', 'run', 'typecheck'], seconds: 10 },
  { name: 'home-typecheck', cwd: 'home', run: ['npm', 'run', 'typecheck'], seconds: 10 },
  { name: 'home-build', cwd: 'home', run: ['npm', 'run', 'build'], seconds: 15 },

  // Host stub tests (no model calls)
  { name: 'host-regressions', cwd: 'host', run: ['npm', 'run', 'regressions'], skip: 'flaky under load, on main too: fake-window-village (a plugin that draws nothing) passes the screenshot gate when the kitchen\'s own motion (tree, candle, leaves) differs between the base and candidate shots; failed 2 of 3 on main and on #85-87 at load 25-46 (run it by name: --only host-regressions)', seconds: 400, local: 'uses the macOS Seatbelt sandbox' },
  { name: 'host-villager', cwd: 'host', run: ['npm', 'run', 'check-villager'], seconds: 30 },
  { name: 'host-plans', cwd: 'host', run: ['npm', 'run', 'check-plans'], seconds: 30 },
  { name: 'host-promote', cwd: 'host', run: ['npm', 'run', 'check-promote', '--', '--port', '{host}'], serial: true, local: MAC_SANDBOX, seconds: 180 },
  { name: 'host-reminders', cwd: 'host', run: ['npm', 'run', 'check-reminders'], seconds: 5 },
  { name: 'host-file-lock', cwd: 'host', run: ['npm', 'run', 'check-file-lock'], seconds: 10 },
  { name: 'host-stop', cwd: 'host', run: ['node', 'test/stop.ts', '--host', '{host}', '--dev', '{dev}', '--approval', '{approval}'], serial: true, local: 'stops a real host 20 ms into a Keep; that timing is measured on the dev Mac only', seconds: 40 },
  { name: 'host-approval', cwd: 'host', run: ['npm', 'run', 'check-approval'], seconds: 5 },
  { name: 'host-physics-prompt', cwd: 'host', run: ['npm', 'run', 'check-physics-prompt'], seconds: 5 },
  { name: 'host-village', cwd: 'host', run: ['node', 'test/village.ts', '--port', '{host}', '--approval-port', '{approval}', '--evil-port', '{evil}'], local: SOFTWARE_GL, seconds: 60 },
  { name: 'host-elder-home', cwd: 'host', run: ['node', 'test/elder-home.ts', '--dev', '{dev}', '--host', '{host}', '--live-port', '{live}', '--approval', '{approval}'], serial: true, local: MAC_SANDBOX, seconds: 300 },
  { name: 'host-daily-home', cwd: 'host', run: ['node', 'test/daily-home.ts', '--port', '{host}', '--approval-port', '{approval}'], serial: true, local: MAC_SANDBOX, seconds: 200 },

  // Home, no browser
  { name: 'plan-history', cwd: 'home', run: ['node', 'scripts/check-plan-history.mjs'], seconds: 60 },
  { name: 'route-inside', cwd: 'home', run: ['node', 'scripts/check-route-inside.mjs'], seconds: 20 },

  // Home, a page on the shared dev server
  { name: 'kernel', cwd: 'home', run: ['node', 'scripts/check-kernel.mjs', '{base}'], needs: 'devServer', local: SOFTWARE_GL, seconds: 30 },
  { name: 'notebook', cwd: 'home', run: ['node', 'scripts/check-notebook.mjs', '{base}'], needs: 'devServer', local: SOFTWARE_GL, seconds: 30 },
  { name: 'entries', cwd: 'home', run: ['node', 'scripts/check-entries.mjs', '{base}'], needs: 'devServer', local: SOFTWARE_GL, seconds: 60 },
  { name: 'navigation', cwd: 'home', run: ['node', 'scripts/check-navigation.mjs', '{base}'], needs: 'devServer', local: SOFTWARE_GL, seconds: 60 },
  { name: 'build-plan', cwd: 'home', run: ['node', 'scripts/check-build-plan.mjs', '{base}'], needs: 'devServer', serial: true, local: SOFTWARE_GL, seconds: 90 },
  { name: 'babble', cwd: 'home', run: ['node', 'scripts/check-babble.mjs', '{base}'], needs: 'devServer', seconds: 40 },
  { name: 'themes', cwd: 'home', run: ['node', 'scripts/check-themes.mjs', '{base}'], needs: 'devServer', serial: true, skip: 'fails on main: texture count grows 83 to 91 over five q=high cycles', local: SOFTWARE_GL, seconds: 160 },
  { name: 'villager-gen', cwd: 'home', run: ['node', 'scripts/check-villager-gen.mjs', '{base}'], needs: 'devServer', local: 'its 50 ms bounds miss on a hosted Linux runner (53 ms in one CI run, #89)', seconds: 60 },
  { name: 'music', cwd: 'home', run: ['node', 'scripts/check-music.mjs', '{base}'], needs: 'devServer', serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'sound', cwd: 'home', run: ['node', 'scripts/check-sound.mjs', '{base}'], needs: 'devServer', local: SOFTWARE_GL, seconds: 60 },
  { name: 'sound-lab', cwd: 'home', run: ['node', 'scripts/check-sound-lab.mjs', '{base}'], needs: 'devServer', needsFile: 'home/.sound-lab/manifest.json', local: SOFTWARE_GL, seconds: 20 },

  // Home, a page with its own dev server and a stub host
  { name: 'build-addroom', cwd: 'home', run: ['node', 'scripts/check-build-addroom.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'place', cwd: 'home', run: ['node', 'scripts/check-place.mjs', '--dev={dev}', '--host={host}'], local: SOFTWARE_GL, seconds: 60 },
  { name: 'physics', cwd: 'home', run: ['node', 'scripts/check-physics.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 120 },
  { name: 'physics-fire', cwd: 'home', run: ['node', 'scripts/check-physics-fire.mjs', '--dev={dev}', '--host={host}'], local: SOFTWARE_GL, seconds: 120 },
  { name: 'physics-toys', cwd: 'home', run: ['node', 'scripts/check-physics-toys.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 120 },
  { name: 'reminders', cwd: 'home', run: ['node', 'scripts/check-reminders.mjs', '--dev={dev}', '--host={host}'], local: SOFTWARE_GL, seconds: 60 },
  { name: 'physics-touch', cwd: 'home', run: ['node', 'scripts/check-physics-touch.mjs', '--dev={dev}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'tactile', cwd: 'home', run: ['node', 'scripts/check-tactile.mjs', '--dev={dev}'], serial: true, local: SOFTWARE_GL, seconds: 90 },
  { name: 'prop-sandbox', cwd: 'home', run: ['node', 'scripts/check-prop-sandbox.mjs', '--dev={dev}'], local: SOFTWARE_GL, seconds: 60 },
  { name: 'sketch', cwd: 'home', run: ['node', 'scripts/check-sketch.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'talk-input', cwd: 'home', run: ['node', 'scripts/check-talk-input.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'talk-notebook', cwd: 'home', run: ['node', 'scripts/check-talk-notebook.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'talk-npc', cwd: 'home', run: ['node', 'scripts/check-talk-npc.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'theme-ask', cwd: 'home', run: ['node', 'scripts/check-theme-ask.mjs', '--dev={dev}', '--host={host}'], local: SOFTWARE_GL, seconds: 60 },
  { name: 'villager', cwd: 'home', run: ['node', 'scripts/check-villager.mjs', '--dev={dev}', '--host={host}'], local: SOFTWARE_GL, seconds: 60 },
]
