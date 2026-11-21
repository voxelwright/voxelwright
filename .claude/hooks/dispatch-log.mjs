#!/usr/bin/env node
// PostToolUse hook (#465): appends one row to .agents/dispatch-log.jsonl for
// every mcp__t3-code__delegate_task and mcp__t3-code__t3_thread_launch call.
// Input is the hook payload on stdin (https://code.claude.com/docs/en/hooks).
// A logging failure never blocks the session: it prints to stderr and exits 0.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The MCP result may arrive as a JSON string, a content-block array, or an
// object with `content`; return the parsed object in every case.
function parseResponse(r) {
  if (typeof r === "string") {
    try { return JSON.parse(r); } catch { return {}; }
  }
  const blocks = Array.isArray(r) ? r : Array.isArray(r?.content) ? r.content : null;
  if (blocks) return parseResponse(blocks.filter((b) => b?.type === "text").map((b) => b.text).join(""));
  return r ?? {};
}

// Options come as {effort: "high"} or [{id: "effort", value: "high"}].
function effortOf(options) {
  const list = Array.isArray(options)
    ? options
    : Object.entries(options ?? {}).map(([id, value]) => ({ id, value }));
  return list.find((o) => /effort/i.test(o.id))?.value ?? null;
}

// "codex_2440..." -> "codex"; "claudeAgent" stays as it is.
const providerOf = (instance) => (instance ? String(instance).split("_")[0] : null);

try {
  const hook = JSON.parse(readFileSync(0, "utf8"));
  const input = hook.tool_input ?? {};
  const out = parseResponse(hook.tool_response);
  const tool = hook.tool_name.replace(/^mcp__t3-code__/, "");
  const title = input.title ?? null;
  const issue = Number(/#(\d+)/.exec(title ?? "")?.[1]) || null;
  const row = { ts: new Date().toISOString(), via: tool, role: input.role ?? null, issue, task: title };

  if (tool === "delegate_task") {
    const t = input.target ?? {};
    Object.assign(row, {
      provider: t.driverKind ?? providerOf(t.providerInstanceId ?? out.providerInstanceId),
      model: t.model ?? out.model ?? null,
      effort: effortOf(t.options) ?? effortOf(out.options),
      taskId: out.taskId ?? null,
    });
  } else {
    const m = input.modelSelection ?? out.modelSelection ?? {};
    Object.assign(row, {
      provider: m.provider ?? m.instanceId ?? null,
      model: m.model ?? null,
      effort: effortOf(m.options),
      threadId: out.threadId ?? null,
    });
  }
  row.link = out.link ?? null;
  row.session = hook.session_id ?? null;

  const dir = process.env.CLAUDE_PROJECT_DIR || hook.cwd;
  appendFileSync(join(dir, ".agents", "dispatch-log.jsonl"), JSON.stringify(row) + "\n");
} catch (err) {
  console.error(`dispatch-log hook: ${err.message}`);
}
