# The ai-session format (`ai-session/1`)

A session is one JSON file in the post folder, shown with `<ai-session src="name.session.json">`.
The format is ours, small and tool-neutral: Claude Code, Codex and ChatGPT sessions all map into
it, and the editor and the blog MCP server will write it through the same import path.

## What it keeps and what it never keeps

| Kept | Never kept |
|---|---|
| Every prompt, as typed | Thinking and reasoning |
| Every reply, with the agent, model and maker that wrote it | Tool output (file contents, command output, search results) |
| Decisions: the questions, every option, what was chosen or typed | Attached images (counted only) |
| Tool calls, by name and a one-line label | Compaction summaries, task-notification results, peer hand-backs |
| Subagents: task, model, tool calls, the report they returned | The transcript's path, session ids, account ids |
| Markers: slash command, compaction, interruption, model switch | |

The left-out items either leak by nature (tool output) or restate earlier turns, so a turn the
author cuts could come back through them.

## Shape

```json
{
  "format": "ai-session/1",
  "title": "Starting the site",
  "summary": "Optional one sentence.",
  "source": { "app": "Claude Code", "version": "2.x" },
  "timezone": "America/Los_Angeles",
  "people": [{ "id": "h", "name": "Mira", "role": "author" }],
  "agents": [
    { "id": "a1", "name": "Claude", "model": "Opus 5.5", "modelId": "claude-opus-5-5", "maker": "Anthropic", "role": "main" },
    { "id": "a2", "name": "Claude", "model": "Sonnet 5.5", "modelId": "claude-sonnet-5-5", "maker": "Anthropic", "role": "subagent", "task": "Survey sites" }
  ],
  "turns": [
    { "id": "t1", "type": "prompt", "by": "h", "at": "2026-11-16T20:25:37Z", "text": "Markdown as typed", "images": 1, "queued": true },
    { "id": "t2", "type": "activity", "by": "a1", "at": "…", "tools": [{ "tool": "Shell", "label": "List the posts" }] },
    { "id": "t3", "type": "reply", "by": "a1", "at": "…", "text": "Markdown" },
    { "id": "t4", "type": "decision", "by": "a1", "at": "…", "questions": [
      { "header": "Store", "question": "…?", "multi": false,
        "options": [{ "label": "Private git repo", "description": "…" }],
        "picked": ["Private git repo"], "text": "typed answer, when no option was picked", "note": "optional" } ] },
    { "id": "t5", "type": "subagent", "by": "a1", "agent": "a2", "at": "…", "task": "…", "tools": [], "report": "Markdown", "status": "completed" },
    { "id": "t6", "type": "event", "event": "compacted | command | interrupted | model-switch", "at": "…", "text": "…" }
  ],
  "redaction": { "rules": ["email", "home path"], "replaced": 7 }
}
```

- Turn ids are given at import and never renumbered, so `#s-founding-t10` keeps working after
  the author cuts other turns. On the page, anchors are `<block id>-<turn id>`, where the block
  id comes from the file name (`founding.session.json` → `s-founding`), suffixed when one file
  is shown twice.
- `maker` is derived from the model id (`claude-*` → Anthropic, `gpt-*`/`o*` → OpenAI,
  `gemini-*` → Google, …) and is `"unknown"` otherwise. Every reply names its agent, so a session
  that switched models or mixed makers says who wrote each turn.
- `lib/session/format.mjs` validates the shape; the build refuses a file that fails it.

## The pipeline

`npm run session -- import <file> --post <slug> --name <name>` runs, in order:

1. **Parse** (`lib/session/claude-code.mjs`, `codex.mjs`, `chatgpt.mjs`). Thinking, tool output and
   images are dropped here and never reach memory as session data.
2. **Trim**: `--prompts 1-3,7` keeps whole exchanges; `--cut t12` drops turns.
3. **Redact** (`lib/session/redact.mjs`): private keys, URL credentials, JWTs, API keys (Anthropic,
   OpenAI, GitHub, Slack, AWS, Stripe, Google, Hugging Face, fal), bearer tokens, `secret=…`
   assignments, emails, home paths (`/Users/x`, `/home/x`, `C:\Users\x`, and the dash-encoded
   `-Users-x-` form Claude Code uses for project folders), tailnet host names, machine names, IP
   addresses, phone numbers, UUIDs, long hashes, and high-entropy opaque tokens. Then this
   machine's user and host names, the git author's name mapped to `--as`, `--rename Real=Fake`
   pairs, and `--private <file>`: exact strings, kept in a file outside the repo.
4. **Check**: the shape is validated and the leak gate (`findLeaks`) must come back empty, or
   nothing is written.
5. **Write** `posts/<slug>/<name>.session.json`.

Then `npm run session -- review <file>` prints one line per turn and `cut <file> t4,t9-t12` drops
turns. Both work on the redacted file only. The build runs the leak gate again on every session.

## Sources

### Claude Code (tested)

`~/.claude/projects/<project>/<session-id>.jsonl`, with subagent transcripts in
`<session-id>/subagents/agent-*.jsonl` and `.meta.json` files naming the tool call that started
each one. `npm run session -- find "words from a prompt"` lists matching sessions.

### Codex CLI (tested on one real rollout and a synthetic one)

`~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. Rows are `{ timestamp, type, payload }`.
Used: `turn_context.model` and `event_msg.thread_settings_applied` for the model, `response_item`
messages with role `user` or `assistant`, and `function_call`, `custom_tool_call`,
`local_shell_call`, `web_search_call` for tool calls. Injected context (`<environment_context>`,
`AGENTS.md` instructions, developer messages) and encrypted reasoning are skipped. The format is
not documented by OpenAI, so a new Codex version may need the mapping adjusted.

```
npm run session -- import ~/.codex/sessions/2026/11/04/rollout-….jsonl --post my-post --name codex-run
```

### ChatGPT (untested on a real export)

Settings → Data controls → Export data mails a zip. Its `conversations.json` is a list of
conversation trees (`mapping`, `current_node`). The importer follows `current_node` back to the
root, so abandoned branches (regenerated answers, edited prompts) are left out. Code sent to a
tool and tool messages become activity; tool output is dropped.

```
npm run session -- import ~/Downloads/chatgpt-export/conversations.json --pick "part of the title" --post my-post
```

Checked only against a synthetic sample (`test/session.test.mjs`). Treat the first real import as
a test and read `review` before publishing.

## In a post

```html
<ai-session src="founding.session.json" open="1,3" caption="Optional title override">
```

- `open`: the exchanges shown unfolded, by prompt number, or `all`. Default: the first.
- Page: the block described in `static/ai-session.css`, on the Voxelmorphism kit's tokens, keys and grooves.
- Markdown twin and llms: a bold header line with the models and counts and a link to the JSON,
  then every prompt and reply as a labelled quote, tool calls as one italic line each.
- Feed: the same content as simple HTML with no folds or scripts.
