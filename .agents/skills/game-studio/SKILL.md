---
name: game-studio
description: How Voxelwright agents and developers use the native in-game T3 Studio IDE and `voxelwright-game` Game-Use MCP server (#98) during local development to inspect, drive, reproduce, and verify the WebGPU engine. Load before opening ad-hoc browser scripts for engine QA, adding a StudioExtension, or debugging local gameplay/rendering bugs.
---

# Voxelwright Studio & Game-Use MCP

Every Voxelwright checkout registers the **`voxelwright-game`** MCP server (`node engine/studio/mcp.mjs`) across Claude Code (`.mcp.json` + `.claude/settings.json`), Antigravity (`.agents/plugins/voxelwright-game/`), and Codex (`.codex/config.toml`).

## When to use `voxelwright-game` MCP

Prefer `voxelwright-game` MCP tools over hand-rolled Playwright scripts whenever you need to inspect a camera view, verify a visual or gameplay fix, inspect raymarch heatmaps / voxel picks, read the 30 s flight recorder, or drive a live or headless game session:

1. **Check active sessions first**: call `game_session_list`.
   - If a live developer tab is connected, read-only tools (`game_status`, `game_snapshot`, `game_frame`, `game_pick`, `game_perf`, `game_flight_recorder`, `game_assert`) work immediately without interrupting play.
   - Mutating tools (`game_camera`, `game_act`, `game_world`, `game_debug`, `game_eval`) require the developer to release control (`Let Agent Drive`), or you can spawn an isolated headless Chrome session instead.
2. **Spawn a headless WebGPU Chrome session**: call `game_session_spawn` (pass `worktreePath`, `at`, `look`, `hour`, `weather`, or `url`). If no Studio Bridge is running locally, `mcp.mjs` boots an embedded Bridge and private `serve.mjs` automatically and acquires a GPU turn from `engine/test/kit.mjs`.
3. **Inspect & verify**:
   - `game_snapshot(includeImage: true, save: true)` captures a full-size PNG and structured state (pose, crosshair 3D pick, nearby vehicles, HUD controls, anomalies, GPU faults). Open saved PNGs at full size before reporting.
   - `game_frame(mode: "color" | "heat" | "farIds")` captures normal color, raymarch step heatmap, or far-model building/face IDs.
   - `game_pick(u, v)` ray-picks 10 cm world cells, material, colour, street/tile geo metadata, and far building ID.
   - `game_perf(benchmark: true)` measures paced GPU frame timings and per-pass WebGPU breakdown.
   - `game_flight_recorder()` reads the 30 s `engine.recorder` trace, events, edits, and passive anomalies.
   - `game_assert(noGpuFaults: true, noCriticalAnomalies: true, maxFrameMs: ...)` validates invariants.
   - `game_worktree_verify(worktreePath)` hot-swaps `engine/page/core.wasm` via `engine.recore()` when only `engine/core/` changed, reloads plugins when only `engine/plugins/` changed, or boots a worktree preview server.
4. **Always close spawned sessions**: call `game_session_close(sessionId)` when done so the GPU turn is released immediately.

## Local interactive development

```sh
npm run dev          # from repo root (runs engine/serve.mjs --studio on :5740 + Studio Bridge on :5764)
```

Opening `http://127.0.0.1:5740/city` loads the native in-game T3 Studio IDE automatically (no query/hash parameters needed) and auto-connects to your local T3 Code server (`127.0.0.1:3773`):

- `F2` / `Cmd+Shift+I`: toggle the Studio IDE drawer
- `F9`: Bug in View (annotate frame + 3D ray-pick -> fire isolated T3 worktree fix thread)
- `F10`: What Just Happened? (30 s flight recorder trace + rolling clip -> T3 fix thread)
- `Esc`: collapse Studio or immediately take human control back from a driving agent

## Extending Studio from engine plugins

Plugins (`engine/plugins/*/page.ts`) may call `engine.studio?.registerExtension({ id, panels, collectors, gameTools, actions })` to add IDE Lab panels, extra `F9`/`F10` context records, and live `game_ext_<ext>_<tool>` MCP tools.

## Boundaries

- Public static builds (`engine/sf/build.mjs`, `./world`, `voxelwright.world`) never bundle Studio (`!LOCAL` + computed dynamic import).
- Automated checks (`engine/test/all.mjs`, `npm run check`) run `serve.mjs` without `--studio`, so Studio DOM never interferes with HUD or gameplay tests.
