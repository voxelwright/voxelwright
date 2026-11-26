---
name: claude-agent-sdk
description: Versions, verified options and limits for the Claude Agent SDK as Village's villager uses it (host/src/villager-agent.ts). Load before changing how a villager runs Claude Code, its tools, sessions or usage accounting.
---

# Claude Agent SDK

Pinned in `host/package.json` (verified November 6, 2026):
`@anthropic-ai/claude-agent-sdk` 0.3.319, which installs the official native
Claude Code binary 2.1.319 as `@anthropic-ai/claude-agent-sdk-darwin-arm64`.
Peer dependency `zod` 4.6.7. The source is the installed `sdk.d.ts` and
`README.md`. Docs: https://platform.claude.com/docs/en/agent-sdk/overview.

## Options Village uses (read from `sdk.d.ts`)

- `query({ prompt, options })` returns an async iterator of `SDKMessage`;
  `close()` ends the subprocess.
- `resume: sessionId` loads a stored session. `continue` resumes the latest
  in the cwd and is mutually exclusive with `resume`. Sessions persist under
  the operator's `~/.claude/projects/` unless `persistSession: false`.
- `includePartialMessages: true` emits `stream_event` messages carrying raw
  Messages API events. Village streams `content_block_delta` with
  `delta.type === 'text_delta'` and `parent_tool_use_id === null`.
- `tools: []` removes every built-in tool. `allowedTools` only auto-approves;
  with `permissionMode: 'dontAsk'` anything not listed is denied.
- `strictMcpConfig: true` uses only `mcpServers` from the options (CLI
  `--strict-mcp-config`). An in-process `createSdkMcpServer` server with
  `tool(name, description, zodShape, handler)` still appears in
  `init.mcp_servers` with `source: 'sdk'`, so the villager's init guard allows
  exactly the `notes` server and its three `mcp__notes__*` tools.
- `settingSources: []` loads no user, project or local settings (and no
  CLAUDE.md).
- `systemPrompt: { type: 'custom', prompt }` replaces Claude Code's coding
  persona; the preset form would keep it.
- `env` replaces the subprocess environment entirely. Village passes the
  allowlist from `host/src/proc.ts`; the login comes from the keychain.

## Results

- `init` (`type: 'system', subtype: 'init'`): `apiKeySource`, `tools`,
  `mcp_servers[{name,status,source}]`, `model`, `session_id`.
- `result`: `session_id`, `usage` (main loop only), `modelUsage` per model
  with `costUSD`, `total_cost_usd`. `total_cost_usd` is cumulative and
  carries over on `resume`, so the villager logs the difference from the
  stored running total as the turn's cost.

## Probes (November 6, 2026, M1 Pro)

- A one-turn `query()` with the bundled binary, `tools: []`,
  `settingSources: []`, `strictMcpConfig: true` and the allowlisted env:
  `apiKeySource: 'none'` (the operator's claude.ai login), no keychain prompt,
  version 2.1.319, model `claude-sonnet-5-5`, 2.3 s, $0.0027. A Haiku helper
  call appears in `modelUsage` even then.
- The real villager turn is recorded in `home/README.md` (Villager).

## Warm sessions (#42, November 7, 2026, read from `sdk.d.ts` and measured)

- Streaming input: `query({ prompt: asyncIterable<SDKUserMessage> })` keeps one
  process; push `{ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }`
  per line and read until each `result`. An `init` event comes with every
  turn. `maxTurns` counts per user message (eight turns ran in one process
  with `maxTurns: 6`).
- Waiting on `stream.next()` before the first line deadlocks: nothing is
  emitted until a message arrives. `await q.initializationResult()` starts
  the process without a line.
- `thinking: { type: 'disabled' }` removed thinking from Haiku turns without
  tools, but thinking blocks still came on some turns with the notes tools,
  and on Sonnet.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` in `env` removes the Haiku
  helper call from `modelUsage`.
- `prewarm()` and `startup()` exist (alpha) but were not used; a warm
  streaming query per person was enough.
- First text, warm Haiku, thinking off: p50 0.41 s against 0.86 s per-turn
  (`host/test/turn-bench.ts`; full table in `host/README.md`).

## Known limits

- Every session transcript lands in the operator's `~/.claude/projects/`,
  keyed by the notes folder, not in the person's folder. Moving it with
  `CLAUDE_CONFIG_DIR` was not tried; it would also move the login.
- `sessionStore`, `sandbox` and `canUseTool` were not used or verified.
- The release is from November 6, 2026. Refresh this file when the pinned
  version changes or a probe contradicts it.
