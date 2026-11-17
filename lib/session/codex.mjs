// Codex CLI rollout → ai-session/1 (unredacted; the caller redacts before writing).
//
// Codex keeps each session at ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl. Rows are
// { timestamp, type, payload }. The ones used here:
//   turn_context / event_msg.thread_settings_applied   the model in effect
//   response_item.message (role user | assistant)      prompts and replies
//   response_item.function_call | custom_tool_call | local_shell_call | web_search_call   tool calls
// Reasoning (encrypted anyway), tool output, developer messages and the injected environment and
// AGENTS.md context are left out. Checked against one real rollout on the owner's machine
// (November 2026); the format is not documented by OpenAI, so treat it as best effort.
import { FORMAT, makerOf, modelName } from "./format.mjs";
import { readJsonl } from "./claude-code.mjs";

const INJECTED = /^\s*(<environment_context>|<user_instructions>|<permissions|# AGENTS\.md|<turn_aborted>)/;

export function importCodex(file, { as = "Author" } = {}) {
  const rows = readJsonl(file);
  const agents = [];
  const agentFor = (modelId) => {
    const found = agents.find((a) => a.modelId === modelId);
    if (found) return found.id;
    const id = `a${agents.length + 1}`;
    agents.push({ id, name: "Codex", model: modelName(modelId), modelId: modelId || "unknown", maker: makerOf(modelId), role: "main" });
    return id;
  };
  let model = null;
  const turns = [];
  let n = 0;
  const push = (t) => turns.push({ id: `t${++n}`, ...t });
  let activity = null;
  const flush = () => {
    if (activity?.tools.length) push(activity);
    activity = null;
  };

  for (const r of rows) {
    const p = r.payload ?? {};
    const at = r.timestamp;
    if (r.type === "turn_context" && p.model) model = p.model;
    if (r.type === "event_msg" && p.type === "thread_settings_applied" && p.thread_settings?.model) model = p.thread_settings.model;
    if (r.type !== "response_item") continue;
    if (p.type === "message") {
      const text = (p.content ?? []).filter((c) => c?.type === "input_text" || c?.type === "output_text").map((c) => c.text ?? "").join("\n").trim();
      if (!text) continue;
      if (p.role === "user") {
        if (INJECTED.test(text)) continue;
        flush();
        push({ type: "prompt", by: "h", at, text });
      } else if (p.role === "assistant") {
        flush();
        const by = agentFor(model);
        const prev = turns.at(-1);
        if (prev?.type === "reply" && prev.by === by) prev.text += "\n\n" + text;
        else push({ type: "reply", by, at, text });
      }
    } else if (["function_call", "custom_tool_call", "local_shell_call", "web_search_call"].includes(p.type)) {
      activity ??= { type: "activity", by: agentFor(model), at, tools: [] };
      activity.tools.push(codexTool(p));
    }
  }
  flush();
  const meta = rows.find((r) => r.type === "session_meta")?.payload ?? {};
  return {
    format: FORMAT,
    title: "Codex session",
    source: { app: "Codex", ...(meta.cli_version ? { version: meta.cli_version } : {}) },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    people: [{ id: "h", name: as, role: "author" }],
    agents,
    turns,
  };
}

function codexTool(p) {
  if (p.type === "web_search_call") return { tool: "Web search", label: p.action?.query ?? "" };
  if (p.type === "local_shell_call") return { tool: "Shell", label: firstLine((p.action?.command ?? []).join(" ")) };
  let args = p.arguments ?? p.input ?? "";
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      // custom tools take free text
    }
  }
  const name = p.name ?? "tool";
  if (name === "shell" || name === "exec_command") return { tool: "Shell", label: firstLine([].concat(args?.command ?? args?.cmd ?? "").join(" ")) };
  if (name === "apply_patch") return { tool: "Edit", label: (/\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(typeof args === "string" ? args : args?.input ?? "") ?? [])[1] ?? "" };
  if (name === "exec") return { tool: "Script", label: "" };
  return { tool: name, label: "" };
}

const firstLine = (s) => {
  const line = String(s).split("\n")[0];
  return line.length > 80 ? line.slice(0, 79) + "…" : line;
};
