// npm run dev: build with drafts into .dev/, watch, serve with live reload.
// Serves through `cf dev` (the real Workers runtime, with Markdown negotiation) when it starts;
// otherwise, or with --node, through scripts/serve.mjs, which mimics it.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer } from "./serve.mjs";
import { outName } from "../generator/looks.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEV_DIR = outName(".dev");
const PORT = Number(process.env.PORT ?? 4321);
const RELOAD_PORT = PORT + 1; // the dev pages listen here (see generator/pages.mjs)
const WATCH = ["designs", "posts", "static", "generator", "lib", "src", "site.config.mjs"];

const rebuild = () => spawnSync(process.execPath, ["scripts/build.mjs", "--dev"], { cwd: ROOT, stdio: "inherit" }).status === 0;

if (!rebuild()) console.error("First build failed; fix the content and save to retry.");

// Live reload over server-sent events.
const clients = new Set();
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
  })
  .listen(RELOAD_PORT);

let timer;
for (const target of WATCH) {
  fs.watch(path.join(ROOT, target), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (rebuild()) for (const c of clients) c.write("data: reload\n\n");
    }, 120);
  });
}

let child;
const useNode = process.argv.includes("--node") || !(await startCf());
if (useNode) {
  await startServer({ root: path.join(ROOT, DEV_DIR), port: PORT });
  console.log(`Serving .dev/ with the Node fallback (negotiation mimicked) at http://localhost:${PORT}/`);
}

async function startCf() {
  const bin = path.join(ROOT, "node_modules", ".bin", "cf");
  if (!fs.existsSync(bin)) return false;
  child = spawn(bin, ["dev", "--mode", "development", "--port", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SITE_ASSETS_DIR: DEV_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!ok) child.kill();
      resolve(ok);
    };
    const timeout = setTimeout(() => done(false), 60_000);
    const onData = (chunk) => {
      process.stdout.write(chunk);
      if (/Ready on http/.test(String(chunk))) {
        console.log(`Serving .dev/ through cf dev (Workers runtime, negotiation on) at http://localhost:${PORT}/`);
        done(true);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", () => done(false));
  });
}

const stop = () => {
  child?.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
