// Claude Code transcript → ai-session/1 (unredacted; the caller redacts before writing).
//
// Claude Code keeps each session at ~/.claude/projects/<project>/<session-id>.jsonl, one JSON
// row per line, and each subagent's own transcript at <session-id>/subagents/agent-*.jsonl with
// a .meta.json naming the tool call that started it.
//
// Kept: prompts, replies, decisions (AskUserQuestion with the answers), tool calls by name and a
// one-line label, subagents (task, model, tools, the report they returned), slash commands,
// interruptions and compactions as markers.
// Left out: thinking, tool output, attached images (counted only), the compaction summary,
// background-task results and peer hand-backs. Those restate earlier turns, so a turn the author
// cuts could come back through them.
import fs from "node:fs";
import path from "node:path";
import { FORMAT, makerOf, modelName } from "./format.mjs";

export function readJsonl(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // a half-written last line while the session is live
    }
  }
  return rows;
}

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n") : "";

const SYSTEM_PREFIXES = ["<local-command", "<system-reminder", "<task-notification", "Caveat:", "<bash-stdout", "<bash-stderr"];

/** A short label for a tool call: what it did, never its output. */
export function toolLabel(block, rel) {
  const n = block.name ?? "";
  const i = block.input ?? {};
  if (n === "Bash") return ["Shell", i.description || "Ran a command"];
  if (["Read", "Edit", "Write", "NotebookEdit", "MultiEdit"].includes(n)) return [n, rel(i.file_path || i.notebook_path || "")];
  if (n === "Grep" || n === "Glob") return [n, String(i.pattern ?? "")];
  if (n === "Workflow") return ["Workflow", (/description:\s*(['"`])(.*?)\1/s.exec(i.script ?? "") ?? [])[2] ?? i.name ?? ""];
  const simple = {
    Skill: ["Skill", "skill"],
    WebFetch: ["Web fetch", "url"],
    WebSearch: ["Web search", "query"],
    ToolSearch: ["Load tools", "query"],
    TaskStop: ["Stop task", ""],
    Artifact: ["Artifact", "action"],
    SendMessage: ["Message agent", ""],
    TodoWrite: ["Plan", ""],
  };
  if (simple[n]) return [simple[n][0], simple[n][1] ? String(i[simple[n][1]] ?? "") : ""];
  if (n.startsWith("mcp__")) {
    const parts = n.split("__");
    const server = parts[1].replace(/^claude_ai_|^plugin_[^_]+_/, "").replace(/_/g, " ");
    return [server || "MCP", parts.at(-1).replace(/_/g, " ")];
  }
  if (n === "advisor") return ["Advisor", "asked a stronger model for review"];
  return [n, ""];
}

/**
 * @param {string} file            path to <session-id>.jsonl
 * @param {object} [opts]
 * @param {string} [opts.as]       the person's display name in the session
 * @returns {object} an ai-session/1 object, not yet redacted
 */
export function importClaudeCode(file, { as = "Author" } = {}) {
  const rows = readJsonl(file);
  const main = rows.filter((r) => !r.isSidechain);
  const cwd = main.find((r) => r.cwd)?.cwd ?? "";
  const root = cwd.replace(/\/\.claude\/worktrees\/[^/]+.*$/, "");
  const rel = (p) => (p && root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p);

  // Agents, one per model id.
  const agents = [];
  const agentFor = (modelId, role = "main", task = undefined) => {
    const id = `a${agents.length + 1}`;
    const existing = role === "main" ? agents.find((a) => a.modelId === modelId && a.role === "main") : null;
    if (existing) return existing.id;
    const maker = makerOf(modelId);
    agents.push({
      id,
      name: maker === "Anthropic" ? "Claude" : modelName(modelId),
      model: modelName(modelId),
      modelId: modelId || "unknown",
      maker,
      role,
      ...(task ? { task } : {}),
    });
    return id;
  };

  // Decisions: pair each AskUserQuestion call with its answers.
  const answers = new Map();
  // Subagent reports: what each Agent/Task call returned.
  const results = new Map();
  for (const r of main) {
    const content = r.message?.content;
    if (r.type !== "user" || !Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== "tool_result") continue;
      const t = r.toolUseResult && typeof r.toolUseResult === "object" ? r.toolUseResult : {};
      answers.set(b.tool_use_id, { answers: t.answers ?? {}, annotations: t.annotations ?? {} });
      results.set(b.tool_use_id, { text: textOf(b.content), error: Boolean(b.is_error) });
    }
  }
  const subagents = loadSubagents(file);

  const turns = [];
  let n = 0;
  const push = (t) => turns.push({ id: `t${++n}`, ...t });
  let activity = null;
  let lastMain = null;
  const flush = () => {
    if (activity?.tools.length) push(activity);
    activity = null;
  };

  for (const r of main) {
    const at = r.timestamp;
    if (r.type === "assistant") {
      const modelId = r.message?.model;
      if (!modelId || modelId === "<synthetic>") continue;
      const by = agentFor(modelId);
      if (lastMain && lastMain !== by) {
        flush();
        push({ type: "event", event: "model-switch", at, text: `Switched to ${agents.find((a) => a.id === by).model}` });
      }
      lastMain = by;
      for (const b of r.message.content ?? []) {
        if (b?.type === "text" && b.text?.trim()) {
          flush();
          const prev = turns.at(-1);
          // One answer is often split across rows; join text that nothing else interrupted.
          if (prev?.type === "reply" && prev.by === by) prev.text += "\n\n" + b.text.trim();
          else push({ type: "reply", by, at, text: b.text.trim() });
        } else if (b?.type === "tool_use") {
          if (b.name === "AskUserQuestion") {
            flush();
            push({ type: "decision", by, at, questions: decisionQuestions(b.input?.questions ?? [], answers.get(b.id)) });
          } else if (b.name === "Agent" || b.name === "Task") {
            flush();
            const sub = subagents.get(b.id);
            const subModel = sub?.model ?? modelFromAlias(b.input?.model) ?? modelId;
            const agent = agentFor(subModel, "subagent", b.input?.description);
            const res = results.get(b.id);
            push({
              type: "subagent",
              by,
              agent,
              at,
              task: b.input?.description || "Subagent",
              kind: b.input?.subagent_type || undefined,
              tools: sub?.tools ?? [],
              report: cleanReport(res?.text ?? ""),
              status: res ? (res.error ? "failed" : "completed") : "unknown",
            });
          } else {
            activity ??= { type: "activity", by, at, tools: [] };
            const [tool, label] = toolLabel(b, rel);
            activity.tools.push(label ? { tool, label } : { tool });
          }
        }
      }
    } else if (r.type === "user") {
      if (r.isMeta) continue;
      const content = r.message?.content;
      if (Array.isArray(content) && content.length && content.every((b) => b?.type === "tool_result")) continue;
      const origin = r.origin ?? {};
      if (origin.kind && origin.kind !== "human") continue; // task notifications, peers
      const text = textOf(content);
      const s = text.trim();
      if (r.isCompactSummary) {
        flush();
        push({ type: "event", event: "compacted", at, text: "The context was summarized and the session continued." });
        continue;
      }
      const cmd = /<command-name>(.*?)<\/command-name>/.exec(s);
      if (cmd) {
        flush();
        push({ type: "event", event: "command", at, text: cmd[1].trim() });
        continue;
      }
      if (s.startsWith("[Request interrupted")) {
        flush();
        push({ type: "event", event: "interrupted", at, text: "The person stopped the agent." });
        continue;
      }
      if (!s || SYSTEM_PREFIXES.some((p) => s.startsWith(p)) || s.startsWith("<bash-input>")) continue;
      // A delegated task finishing, as T3 Code reports it: a result, not something typed.
      if (/^Delegated task \S+ \(/.test(s)) continue;
      const images = Array.isArray(content) ? content.filter((b) => b?.type === "image").length : 0;
      flush();
      push({
        type: "prompt",
        by: "h",
        at,
        text: s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim(),
        ...(images ? { images } : {}),
        ...(r.promptSource === "queued" ? { queued: true } : {}),
      });
    }
  }
  flush();

  const title = [...rows].reverse().find((r) => r.type === "custom-title" && r.customTitle)?.customTitle ?? [...rows].reverse().find((r) => r.type === "ai-title")?.aiTitle ?? "AI session";
  const version = main.find((r) => r.version)?.version;
  return {
    format: FORMAT,
    title,
    source: { app: "Claude Code", ...(version ? { version } : {}) },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    people: [{ id: "h", name: as, role: "author" }],
    agents: agents.filter((a) => turns.some((t) => t.by === a.id || t.agent === a.id)),
    turns,
  };
}

/** A subagent's report without the harness frame around it, the agent id and the usage footer. */
export function cleanReport(text) {
  let s = text;
  const i = s.indexOf("The report follows:\n");
  if (i >= 0) s = s.slice(i + "The report follows:\n".length);
  s = s.replace(/<usage>[\s\S]*?<\/usage>/g, "").replace(/^agentId: .*$/m, "");
  const lines = s.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n").trim();
}

function decisionQuestions(questions, result) {
  return questions.map((q) => {
    const answer = result?.answers?.[q.question];
    const options = (q.options ?? []).map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}) }));
    const given = Array.isArray(answer) ? answer : typeof answer === "string" ? answer.split(/,\s*(?=[A-Z])/) : [];
    const picked = options.filter((o) => given.includes(o.label) || answer === o.label).map((o) => o.label);
    const typed = typeof answer === "string" && !picked.length ? answer : "";
    const note = result?.annotations?.[q.question]?.notes ?? "";
    return {
      header: q.header ?? "",
      question: q.question,
      multi: Boolean(q.multiSelect),
      options,
      picked,
      ...(typed ? { text: typed } : {}),
      ...(note ? { note } : {}),
      ...(answer == null ? { unanswered: true } : {}),
    };
  });
}

const ALIASES = { opus: "claude-opus", sonnet: "claude-sonnet", haiku: "claude-haiku", fable: "claude-fable" };
function modelFromAlias(alias) {
  return alias && ALIASES[alias] ? ALIASES[alias] : null;
}

/** toolUseId → { model, tools } for each subagent transcript beside the session. */
function loadSubagents(file) {
  const dir = path.join(path.dirname(file), path.basename(file, ".jsonl"), "subagents");
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".meta.json")) continue;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const jsonl = path.join(dir, name.replace(/\.meta\.json$/, ".jsonl"));
    if (!meta.toolUseId || !fs.existsSync(jsonl)) continue;
    const rows = readJsonl(jsonl);
    const model = rows.find((r) => r.type === "assistant" && r.message?.model && r.message.model !== "<synthetic>")?.message.model;
    const tools = [];
    for (const r of rows) {
      if (r.type !== "assistant") continue;
      for (const b of r.message?.content ?? []) {
        if (b?.type !== "tool_use") continue;
        const [tool, label] = toolLabel(b, (p) => p);
        tools.push(label ? { tool, label } : { tool });
      }
    }
    out.set(meta.toolUseId, { model, tools });
  }
  return out;
}
