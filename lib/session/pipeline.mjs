// The one way a session reaches the site: parse → trim → redact → check. Nothing is written
// before redaction has run, and the result must pass the same leak gate the build uses.
// The CLI (scripts/session.mjs), and later the editor and the MCP server, all call this.
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { importClaudeCode } from "./claude-code.mjs";
import { importCodex } from "./codex.mjs";
import { importChatGPT } from "./chatgpt.mjs";
import { exchanges, parseTurnList, validateSession } from "./format.mjs";
import { makeRedactor, findLeaks } from "./redact.mjs";

export const SOURCES = {
  "claude-code": (file, o) => importClaudeCode(file, o),
  codex: (file, o) => importCodex(file, o),
  chatgpt: (file, o) => importChatGPT(JSON.parse(fs.readFileSync(file, "utf8")), o),
};

/** Guesses the source from the file: a ChatGPT export is one JSON array, Codex rows carry payloads. */
export function detectSource(file) {
  if (file.endsWith("conversations.json")) return "chatgpt";
  const first = fs.readFileSync(file, "utf8").split("\n", 1)[0];
  try {
    const row = JSON.parse(first);
    if (row && "payload" in row) return "codex";
  } catch {
    if (first.trim().startsWith("[")) return "chatgpt";
  }
  return "claude-code";
}

/** The real names to replace: the git author and the OS account, mapped to the display name. */
export function defaultNames(as) {
  const names = {};
  let gitName = "";
  try {
    gitName = execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim();
  } catch {
    // no git identity
  }
  const real = [gitName, ...gitName.split(/\s+/), os.userInfo().realname ?? ""].filter((x) => x && x.length >= 2);
  for (const r of real) if (r.toLowerCase() !== as.toLowerCase()) names[r] = as;
  return names;
}

/**
 * @param {object} o
 * @param {string} o.file                 transcript or export
 * @param {string} [o.source]             claude-code | codex | chatgpt (detected when absent)
 * @param {string} [o.as]                 the person's display name
 * @param {Record<string,string>} [o.names]  extra real → made-up names
 * @param {string[]} [o.literals]         exact private strings to remove
 * @param {string} [o.prompts]            keep only these exchanges, by prompt number ("1-3,5")
 * @param {string} [o.cut]                drop these turns ("t4,t9-t12")
 * @param {string} [o.title], [o.summary], [o.pick]
 * @returns {{ session: object, report: object }}
 */
export function importSession(o) {
  const source = o.source ?? detectSource(o.file);
  const parse = SOURCES[source];
  if (!parse) throw new Error(`unknown source "${source}"; use ${Object.keys(SOURCES).join(", ")}`);
  const as = o.as ?? "Author";
  let session = parse(o.file, { as, pick: o.pick });

  // Trim before redacting, so the report counts only what is kept.
  session = trim(session, { prompts: o.prompts, cut: o.cut });
  if (o.title) session.title = o.title;
  if (o.summary) session.summary = o.summary;

  const redactor = makeRedactor({ names: { ...defaultNames(as), ...(o.names ?? {}) }, literals: o.literals ?? [] });
  session = redactor.deep(session);
  // Names in people[] are the chosen display names; put them back if a rule touched them.
  session.people = session.people.map((p) => (p.id === "h" ? { ...p, name: as } : p));
  session.redaction = { rules: Object.keys(redactor.report).sort(), replaced: Object.values(redactor.report).reduce((a, b) => a + b, 0) };

  const problems = validateSession(session);
  const leaks = findLeaks(session);
  if (problems.length) throw new Error(`the imported session is not valid:\n  ${problems.join("\n  ")}`);
  if (leaks.length) throw new Error(`redaction left something behind (${leaks.join(", ")}); nothing was written`);
  return { session, report: { source, counts: redactor.report, turns: session.turns.length } };
}

/** Keeps the chosen exchanges and drops cut turns, keeping every remaining turn's id. */
export function trim(session, { prompts, cut } = {}) {
  let turns = session.turns;
  if (prompts) {
    const keep = parseTurnList(prompts); // "t1", "t2" … here mean prompt numbers
    let number = 0;
    turns = exchanges(session)
      .filter((g) => g.prompt && keep.has(`t${++number}`))
      .flatMap((g) => [g.prompt, ...g.rest]);
  }
  if (cut) {
    const drop = parseTurnList(cut);
    turns = turns.filter((t) => !drop.has(t.id));
  }
  // Markers and activity that no longer sit between kept turns read as noise; drop a leading one.
  while (turns[0] && turns[0].type !== "prompt") turns = turns.slice(1);
  const used = new Set(turns.flatMap((t) => [t.by, t.agent]));
  return { ...session, turns, agents: session.agents.filter((a) => used.has(a.id)) };
}

/** One line per turn, for the author to decide what to cut. Reads only redacted data. */
export function reviewLines(session) {
  const who = Object.fromEntries([...session.people, ...session.agents].map((x) => [x.id, x.model ? `${x.name} ${x.model}` : x.name]));
  return session.turns.map((t) => {
    const gist = (t.text ?? t.task ?? t.questions?.map((q) => q.question).join(" / ") ?? t.tools?.map((x) => x.tool).join(", ") ?? t.event ?? "").replace(/\s+/g, " ").trim();
    return `${t.id.padEnd(5)} ${t.type.padEnd(9)} ${(who[t.by] ?? "").padEnd(18)} ${gist.length > 90 ? gist.slice(0, 89) + "…" : gist}`;
  });
}
