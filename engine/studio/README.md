# Voxelwright Studio & Game-Use Control Plane

Native in-game T3 Code IDE, one-gesture bug-to-thread capture, live worktree verification, extensible Game-Dev IDE (`StudioExtension`), and native Game-Use MCP server (`voxelwright-game`) for both live user browser tabs and headless Chrome sessions (#98).

Public `voxelwright.world` static builds (`sf/build.mjs`, `deploy/`) never include Studio code or UI.

## Run it

```sh
# Single-command local dev (page server on :5740 + Studio Bridge & MCP on :5764):
npm run dev       # from repo root (or `cd engine && npm run dev`)
# Then open http://127.0.0.1:5740/city — Studio loads and connects automatically via /studio/bootstrap.

# Or run the page server and Studio Bridge in separate terminals:
cd engine
npm run serve    # game page server on http://127.0.0.1:5740
npm run studio   # Studio Bridge + MCP HTTP endpoint on http://127.0.0.1:5764
```

`npm run studio` also prints a ready-to-open link containing a per-launch secret in the hash (`#studio=...&secret=...`). On boot, `engine/page/studio/index.ts` stores the session secret in `sessionStorage` and immediately strips it from `location.hash`, or discovers a live local bridge via loopback-only `GET /studio/bootstrap`.

`node studio/bridge.mjs` accepts:

| Flag | Default | What it sets |
| --- | --- | --- |
| `--port` | `5764` | Loopback port on `127.0.0.1` |
| `--game` | `http://127.0.0.1:5740` | Default game page URL for the printed link and headless spawns |
| `--secret` | random 24-char token | Required `X-Studio-Secret` header / `?secret=` WebSocket token |
| `--no-auto-t3` | off | Skip automatic local T3 Code discovery and CLI pairing |

## In-game hotkeys

| Key | Action |
| --- | --- |
| `F2` or `Cmd/Ctrl+Shift+I` | Toggle the dockable Studio IDE drawer (Drawer / Wide / Bottom) |
| `F9` | **Bug in View** — freeze frame, annotate with Pin/Box/Pen, 3D ray-pick voxel/building/street, and fire a T3 fix thread |
| `F10` | **What Just Happened?** — attach the last 30 s `engine.recorder` trace, anomalies, and rolling WebM video clip to a T3 fix thread |
| `Esc` | Close the Studio drawer or immediately take human control back from a driving AI agent |

## Native T3 Code protocol

`studio/t3-client.mjs` and `page/studio/transport.ts` speak T3 Code's wire protocol directly (both via the local Bridge and directly from standalone browsers via WebCrypto ES256 DPoP):

- Local server discovery (`~/.t3/userdata/server-runtime.json`) and one-click local CLI pairing (`t3 auth pairing create --json`), plus multi-environment pairing by URL or code persisted in `~/.village/engine/studio/environments.json`.
- RFC 9449 ES256 DPoP keypair & proof signing (`studio/dpop.mjs`) across `/oauth/token`, `/api/auth/websocket-ticket/rpc`, HTTP APIs, and WebSocket upgrade.
- Effect RPC JSON over `/ws?orchestrationProtocol=2&frameParts=1` with `\u001e` multi-part frame reassembly, stream `Ack`, heartbeat `Ping`/`Pong`, and automatic reconnect.
- Structured `UnknownContextRecord` attachments (`game-frame`, `game-pick`, `game-timeline`, `game-perf`, plus custom extension collectors) alongside uploaded PNG/WebM attachments and CORP-safe `/studio/api/t3/asset` proxying under COEP.

## Game-Use MCP (`voxelwright-game`)

The repository enables `voxelwright-game` (`node engine/studio/mcp.mjs`) by default across Claude Code (`.mcp.json` + `.claude/settings.json`), Antigravity (`.agents/plugins/voxelwright-game/mcp_config.json`), and Codex (`.codex/config.toml`). It runs over stdio (proxying to an active Studio Bridge or booting an embedded one automatically) and over Streamable HTTP at `POST http://127.0.0.1:5764/mcp`.

Core tools exposed to AI agents:

- Sessions: `game_session_list`, `game_session_spawn` (headless WebGPU Chrome), `game_session_close`
- Observe: `game_status`, `game_snapshot`, `game_frame` (`color`, `heat`, `farIds`), `game_pick`, `game_perf`, `game_flight_recorder`, `game_assert`
- Act & debug: `game_camera`, `game_act`, `game_world`, `game_debug` (pause/step/flags/`recoreUrl`), `game_wait_for`, `game_record_start`, `game_record_stop`, `game_eval`, `game_worktree_verify`
- Dynamic extension tools: any `gameTools` registered on `engine.studio.registerExtension(...)` are advertised live as `game_ext_<ext>_<tool>`.

`studio/session-control.mjs` enforces shared human/agent control on live tabs: agents may always `observe` while a person plays, while mutating actions require the human to release control (`Let Agent Drive`). Any live keyboard/pointer input or `Esc` immediately returns control to the human and invalidates in-flight agent epochs.

## Extending Studio (`StudioExtension`)

Built-in extensions (`voxel-inspector`, `render-lab`, `city-tiles`, `sound-lab`, `workshop-plus`) and engine plugins (`engine/plugins/*/page.ts`) register panels, context collectors, dynamic MCP tools, and quick-launch playbooks via `engine.studio?.registerExtension(...)`.

## Security

- Studio Bridge binds strictly to `127.0.0.1`, refuses foreign `Host` and `Origin` headers (`403`), and requires `X-Studio-Secret` (`401`).
- `/studio/api/worktree/core.wasm` serves only registered `git worktree list` paths of this repository.
- `engine/page/main.ts` imports Studio lazily with a computed specifier gated by `!LOCAL`, so `sf/build.mjs` bundles zero Studio bytes into public deployments.

## Check

```sh
cd engine
npm run typecheck
node test/studio.mjs
```
