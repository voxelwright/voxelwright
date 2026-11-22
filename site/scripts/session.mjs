// npm run session -- <command>
//
//   find "text the session starts with"         newest Claude Code sessions whose prompts contain it
//   import <transcript> --post <slug> [--name file] [options]
//                                               parse, trim, redact, check, then write
//                                               posts/<slug>/<file>.session.json
//   review <session.json>                       one line per turn, to choose what to cut
//   cut <session.json> t4,t9-t12                drop turns (ids never change)
//
// import options:
//   --as "Name"            how you appear in the session (default: site author, else "Author")
//   --prompts 1-3,5        keep only these exchanges, by prompt number
//   --cut t4,t9-t12        drop turns
//   --rename Real=Fake     replace a name everywhere (repeatable)
//   --private <file>       a file outside the repo with one private string per line, all removed
//   --title "…"  --summary "…"
//   --source claude-code|codex|chatgpt   (detected from the file)
//   --pick "title or id"   which conversation, for a ChatGPT export
//
// Nothing is written until redaction and the leak check have passed. Values that were removed
// are never printed; the report shows counts per rule.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importSession, reviewLines, trim } from "../lib/session/pipeline.mjs";
import { validateSession } from "../lib/session/format.mjs";
import { findLeaks } from "../lib/session/redact.mjs";
import { readJsonl } from "../lib/session/claude-code.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
    (flags[key] ??= []).push(value);
  } else args.push(rest[i]);
}
const flag = (k) => flags[k]?.at(-1);

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (cmd === "find") {
  const needle = args.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  const base = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");
  const hits = [];
  for (const project of fs.readdirSync(base)) {
    const dir = path.join(base, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
      const file = path.join(dir, f);
      const rows = readJsonl(file);
      const prompts = rows.filter((r) => r.type === "user" && !r.isSidechain && !r.isMeta && typeof r.message?.content === "string").map((r) => r.message.content);
      const i = prompts.findIndex((p) => p.toLowerCase().replace(/\s+/g, " ").includes(needle));
      if (needle && i < 0) continue;
      const title = [...rows].reverse().find((r) => r.customTitle)?.customTitle ?? "";
      hits.push({ file, mtime: fs.statSync(file).mtimeMs, title, prompts: prompts.length, at: i });
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  for (const h of hits.slice(0, Number(flag("limit") ?? 10))) {
    console.log(`${new Date(h.mtime).toISOString().slice(0, 16)}  ${String(h.prompts).padStart(3)} prompts  ${h.title}\n    ${h.file}`);
  }
} else if (cmd === "import") {
  const file = args[0];
  if (!file || !fs.existsSync(file)) die("usage: npm run session -- import <transcript> --post <slug> [--name <file>]");
  const slug = flag("post");
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) die("--post <slug> is required: the post folder under posts/");
  const name = (flag("name") ?? "session").replace(/\.session\.json$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) die("--name must be a lowercase slug");
  const site = (await import(path.join(ROOT, "site.config.mjs"))).default;
  const as = flag("as") ?? (site.author && !site.author.startsWith("TODO") ? site.author : "Author");
  const names = Object.fromEntries((flags.rename ?? []).map((r) => r.split("=")).filter((p) => p.length === 2));
  const literals = flag("private") ? fs.readFileSync(flag("private"), "utf8").split("\n") : [];
  if (flag("private") && path.resolve(flag("private")).startsWith(ROOT)) die("--private must point outside the repo, so the list is never published");
  let result;
  try {
    result = importSession({ file, source: flag("source"), as, names, literals, prompts: flag("prompts"), cut: flag("cut"), title: flag("title"), summary: flag("summary"), pick: flag("pick") });
  } catch (e) {
    die(e.message);
  }
  const dir = path.join(ROOT, "posts", slug);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${name}.session.json`);
  fs.writeFileSync(out, JSON.stringify(result.session, null, 1) + "\n");
  const counts = Object.entries(result.report.counts).map(([k, v]) => `${k} ${v}`).join(", ") || "nothing";
  console.log(`Wrote ${path.relative(ROOT, out)}: ${result.report.turns} turns from ${result.report.source}.`);
  console.log(`Redacted: ${counts}.`);
  console.log(`Next: npm run session -- review ${path.relative(ROOT, out)}, then add <ai-session src="${name}.session.json"> to the post.`);
} else if (cmd === "review" || cmd === "cut") {
  const file = args[0];
  if (!file || !fs.existsSync(file)) die(`usage: npm run session -- ${cmd} <session.json>${cmd === "cut" ? " t4,t9-t12" : ""}`);
  let session = JSON.parse(fs.readFileSync(file, "utf8"));
  if (cmd === "cut") {
    if (!args[1]) die("which turns? e.g. t4,t9-t12");
    session = trim(session, { cut: args[1] });
    const problems = [...validateSession(session), ...findLeaks(session).map((l) => `leak: ${l}`)];
    if (problems.length) die(problems.join("\n"));
    fs.writeFileSync(file, JSON.stringify(session, null, 1) + "\n");
    console.log(`Kept ${session.turns.length} turns.`);
  }
  for (const line of reviewLines(session)) console.log(line);
  const leaks = findLeaks(session);
  if (leaks.length) console.log(`\nStill secret-shaped: ${leaks.join(", ")}. The build will refuse this file.`);
} else {
  console.log(fs.readFileSync(import.meta.filename, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
}
