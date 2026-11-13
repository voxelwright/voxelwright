---
name: claude-code-headless
description: How Village runs the official Claude Code binary once, without tools, for a single reply that is treated as data (engine/make/model.mjs, #220). Flags, what the binary adds to the context by itself, the result's form, measured times and costs, and limits. Load before changing how the maker runs a model, or before running `claude -p` from any other Village code.
---

# Claude Code, headless, for one reply

Verified November 12, 2026 on Claude Code 2.1.322 (native build, macOS arm64), signed in with a claude.ai
subscription. Sources: the installed binary's `claude --help`; https://code.claude.com/docs/en/headless.md and
https://code.claude.com/docs/en/cli-reference.md (read that day); and the probes below. The SDK route to the
same binary is `claude-agent-sdk`; the maker spawns the binary directly because it needs no SDK feature and
adds no dependency to `engine/`.

## The run (`engine/make/model.mjs`)

```
claude -p --model opus --system-prompt <brief> --tools "" --strict-mcp-config --setting-sources ""
       --disable-slash-commands --no-session-persistence --output-format stream-json --verbose
```

with the prompt on stdin, in a folder made for the run (`mkdtemp` under the system's temp folder, removed after),
and an environment of `HOME PATH USER LOGNAME TMPDIR LANG SHELL` plus
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.

| Flag | Why | Source |
| --- | --- | --- |
| `-p` | one reply, then exit | docs, help |
| `--system-prompt` | replaces the whole default prompt (`--append-system-prompt` would keep the coding persona) | docs: "Replaces the entire default prompt" |
| `--tools ""` | no built-in tool at all. `--allowedTools` only approves, it does not remove | docs: 'Use "" to disable all'; probe: `init.tools` is `[]` |
| `--strict-mcp-config` with no `--mcp-config` | no MCP server from any configuration. `--tools` does not touch MCP tools | docs; probe: `init.mcp_servers` is `[]` on a machine with dozens configured |
| `--setting-sources ""` | no user, project or local settings | help lists the sources; the empty value is undocumented. Probed: the model found no CLAUDE.md and no memory in its context. Whether hooks from settings are also off was not checked |
| `--disable-slash-commands` | no skills or commands | docs; probe: `init.slash_commands` is empty |
| `--no-session-persistence` | no transcript kept under `~/.claude/projects/` | docs |
| `--output-format stream-json --verbose` | the `init` event is in the stream, so the caller can check what the run was given | probe |

- **Not `--bare`**: it never reads the OAuth login or the keychain, so it cannot use a subscription (docs and help).
- **Not `--json-schema`**: it works with `--tools ""` and returns `structured_output`, but it does so by adding a
  tool (`init.tools` becomes `["StructuredOutput"]`). The maker wants a run with no tool and checks its own form
  far more strictly than a schema can (`engine/make/form.mjs`).
- `claude` in the owner's interactive shell is a function that unsets `NODE_OPTIONS`; a spawned process does not
  go through it. The maker does not pass `NODE_OPTIONS` at all.
- There is no timeout flag. The caller stops a slow run itself (SIGTERM; the docs give exit 143 and no result).

## A picture with the prompt (#244, November 13, 2026; 2.1.322)

Add `--input-format stream-json` and write one line of JSON to stdin in place of the plain prompt:

```
{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}},{"type":"text","text":"the prompt"}]}}
```

Probed with a made-up picture and Haiku, all other flags as above: `init.tools` is still `[]`, the reply named what
only the picture showed (a yellow triangle, the word on it, the purple ground), the run ended by itself when stdin
closed, and nothing holding the picture appeared under `~/.claude` (`find -newer`: one plugin-store file, without
it). With no tool the model cannot open a file, so this is the only way a picture reaches it. Each retry is a new
process and sends the picture again. Real runs through the page: a drawn wheelbarrow made on the second try in 75 s
(Opus 5.5); a link to a public page (its words and its picture) made a pillar box in 15 s.

## The guard

The reply is used only if the stream's `init` event lists no tools and no MCP servers, the process exits 0, and
the `result` event has `subtype: "success"`, `is_error: false` and a string `result`. Anything else is a failed
run, and nothing is made of it. `test/make.mjs` runs a script in the binary's place for each of those cases.

`result` also carries `total_cost_usd`, `usage` (`input_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`, `output_tokens`), `modelUsage` by model and `duration_ms`. Error subtypes per the
docs: `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`.
The docs do not promise that the CLI's JSON is the SDK's `SDKResultMessage`; the fields above were seen.

## What the binary adds to the context by itself

Asked to list everything in its context (Sonnet and Haiku, run as above):

- A line saying it is a Claude agent built on the Agent SDK.
- `# userEmail`: the email address of the signed-in account, with an instruction to keep it private.
- `# Environment`: the working directory's path, whether it is a git repository, platform, shell, OS version, a
  scratchpad path derived from the working directory, the model's name, the date.
- No CLAUDE.md, no memory, no git status, no agents' or skills' text.
- The `init` event still lists seven built-in agent types and four plugins by name with these flags. With no tools
  the model cannot start an agent, and nothing of theirs was in the context it listed; it is recorded, not explained.
- The first two probes of this were run from a session scratch folder under the checkout's name, so that path (the
  home folder's name and the project's name) went to the provider in those two requests. Every run since, and
  every run the maker makes, is from a neutral temp folder.

So the working directory matters: run from a checkout, its path (the home folder's name, the project's name)
goes to the provider. Run from a fresh folder in the system's temp folder, the path is `/private/tmp/thing-XXXX`
or `/var/folders/.../T/thing-XXXX` and names nobody. **The account's email cannot be turned off by any
documented flag** (searched the help and the two pages; `--exclude-dynamic-system-prompt-sections` applies only
to the default prompt). It is the address of the subscription the request is billed to, sent to that
subscription's own provider by its own official binary, and it is not something Village's code puts there. The
owner should know it is there.

Without `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` a second, small Haiku call appears in `modelUsage`
beside the model asked for. With it, only the model asked for is called.

Size: a six-word system prompt and a three-word message came to 648 input tokens with Haiku in a temp folder,
so the binary's own additions are about 640 tokens.

## Measured (M1 Pro, November 12, 2026; the maker's brief is about 1,900 tokens)

- Start to result for a trivial prompt: 2.4 s wall (Haiku, 0.7 s of it the model).
- A made thing, first reply usable: Sonnet 5.5 17 to 20 s and $0.02 to $0.03; Opus 5.5 22 to 30 s and $0.05 to
  $0.06 (`total_cost_usd` as the binary reports it; on a subscription it is usage, not a charge).
- Each further try after a refused reply costs about as much again.

## Limits and what is not verified

- One reply per process: each wish pays the binary's start (about 1.7 s). A warm process with
  `--input-format stream-json` was not tried.
- Whether the email line can be removed by a setting was not found, not proved impossible.
- Only macOS with a subscription login was run. API-key logins and other platforms were not.
- Refresh when the binary's major or minor version changes: run `node test/make.mjs`, one real
  `node make.mjs ... --dry`, and the context probe (ask it to list what is in its context) again.
