// Every part, every check: the harness on each page under showcase/parts, then each part's own
// check under tools/parts. Prints one line a run and the failing lines under it.
//   PORT=5989 node tools/parts.mjs [name ...]      exit 1 if anything fails
// The right-to-left page's check lists faults in the kit on purpose; it is reported, not counted.
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const only = process.argv.slice(2);
const pages = (await readdir('showcase/parts')).filter((n) => n.endsWith('.html')).map((n) => n.slice(0, -5)).filter((n) => n !== 'index' && (!only.length || only.includes(n))).sort();
const checks = (await readdir('tools/parts')).filter((n) => n.endsWith('.mjs')).map((n) => n.slice(0, -4)).filter((n) => !only.length || only.includes(n)).sort();
const run = (args) => new Promise((res) => {
  const p = spawn('node', args, { env: process.env });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ code, out }));
});
let bad = 0;
const jobs = [...pages.map((n) => ['page ', n, ['tools/part.mjs', n]]), ...checks.map((n) => ['check', n, [`tools/parts/${n}.mjs`]])];
// three at a time: each opens its own browser
const queue = [...jobs];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const [kind, name, args] = queue.shift();
    const { code, out } = await run(args);
    const known = kind === 'check' && name === 'direction';
    if (name === 'message-scroller' && kind === 'check') console.log(out.split('\n').find((line) => line.includes('wheel after settling:')) ?? 'wheel measurement missing');
    if (code && !known) bad++;
    const fails = out.split('\n').filter((l) => /^FAIL|Error|error:/.test(l.trim())).slice(0, 8);
    console.log(`${code ? (known ? 'known' : 'FAIL ') : 'ok   '} ${kind} ${name}${code ? '\n      ' + (fails.join('\n      ') || out.trim().split('\n').slice(-3).join('\n      ')) : ''}`);
  }
}));
console.log(bad ? `${bad} of ${jobs.length} failed` : `all ${jobs.length} pass (${pages.length} pages, ${checks.length} checks)`);
process.exit(bad ? 1 : 0);
