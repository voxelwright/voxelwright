// The checks `npm run check` runs, and what is known about running them together.
//
// Fields
//   name      what you pass to --only
//   cwd       'home' or 'host'
//   run       argv. {dev} and {host} become free ports the runner picked, {base} the shared dev
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
const SOFTWARE_GL = 'timeouts or time bounds on a hosted Linux runner, in software WebGL2 (3 CI runs, #89)'

export const CHECKS = [
  // Static
  { name: 'host-typecheck', cwd: 'host', run: ['npm', 'run', 'typecheck'], seconds: 10 },
  { name: 'home-typecheck', cwd: 'home', run: ['npm', 'run', 'typecheck'], seconds: 10 },
  { name: 'home-build', cwd: 'home', run: ['npm', 'run', 'build'], seconds: 15 },

  // Host stub tests (no model calls)
  { name: 'host-regressions', cwd: 'host', run: ['npm', 'run', 'regressions'], skip: 'fails on main: fake-window-village, 23 of 24 cases (run it by name: --only host-regressions)', seconds: 400, local: 'uses the macOS Seatbelt sandbox' },
  { name: 'host-villager', cwd: 'host', run: ['npm', 'run', 'check-villager'], seconds: 30 },
  { name: 'host-plans', cwd: 'host', run: ['npm', 'run', 'check-plans'], seconds: 30 },
  { name: 'host-promote', cwd: 'host', run: ['npm', 'run', 'check-promote', '--', '--port', '{host}'], skip: 'fails on main (promote-gitignore-refused) and then hangs until the timeout', seconds: 120 },

  // Home, no browser
  { name: 'plan-history', cwd: 'home', run: ['node', 'scripts/check-plan-history.mjs'], skip: 'fails on main: 101 of 102 (the other person commits on the new head; no one is named)', seconds: 60 },
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
  { name: 'physics-touch', cwd: 'home', run: ['node', 'scripts/check-physics-touch.mjs', '--dev={dev}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'prop-sandbox', cwd: 'home', run: ['node', 'scripts/check-prop-sandbox.mjs', '--dev={dev}'], local: SOFTWARE_GL, seconds: 60 },
  { name: 'sketch', cwd: 'home', run: ['node', 'scripts/check-sketch.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'talk-input', cwd: 'home', run: ['node', 'scripts/check-talk-input.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'talk-notebook', cwd: 'home', run: ['node', 'scripts/check-talk-notebook.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'talk-npc', cwd: 'home', run: ['node', 'scripts/check-talk-npc.mjs', '--dev={dev}', '--host={host}'], serial: true, local: SOFTWARE_GL, seconds: 60 },
  { name: 'theme-ask', cwd: 'home', run: ['node', 'scripts/check-theme-ask.mjs', '--dev={dev}', '--host={host}'], local: SOFTWARE_GL, seconds: 60 },
  { name: 'villager', cwd: 'home', run: ['node', 'scripts/check-villager.mjs', '--dev={dev}', '--host={host}'], local: SOFTWARE_GL, seconds: 60 },
]
