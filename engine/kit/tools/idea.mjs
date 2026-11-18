// Idea pictures: quick generated illustrations of a direction, before anything is built.
//   node tools/idea.mjs <set.json> [--only name,name] [--quality medium] [--model openai/gpt-image-2]
// A set is { "out": "shots/ideas/<folder>", "size": [1536, 1024], "pictures": { "<name>": "<prompt>" } }.
// Each prompt is sent, as words only, to OpenAI's GPT Image model through fal.ai, and the picture
// is saved as <out>/<name>.png with the prompt beside it in prompts.json.
//
// What leaves the machine: the prompt text and nothing else. Never put a person's name, a project's
// name, a path or a picture of ours in a prompt. The fal key is read from the login Keychain
// (service "village-fal") inside this process, sent only to fal.run, and never printed.
// Generated pictures are ideas, not evidence: say GENERATED wherever one is shown.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const set = JSON.parse(await readFile(args[0], 'utf8'));
const only = flag('only', '')?.split(',').filter(Boolean);
const quality = flag('quality', 'medium');
const model = flag('model', 'openai/gpt-image-2');
const [width, height] = set.size || [1536, 1024];

let key;
try { key = execFileSync('security', ['find-generic-password', '-s', 'village-fal', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { key = ''; }
if (!key) { console.log('no key: the Keychain has no "village-fal" entry this process may read'); process.exit(2); }

await mkdir(set.out, { recursive: true });
const done = {};
const names = Object.keys(set.pictures).filter((n) => !only.length || only.includes(n));
// a few at a time: each takes a minute or so
const queue = [...names];
async function one(name) {
  const prompt = set.pictures[name];
  const t = Date.now();
  try {
    const res = await fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: { width, height }, quality, num_images: 1, output_format: 'png' }),
    });
    if (!res.ok) { console.log(`fail ${name}: ${res.status} ${(await res.text()).slice(0, 300)}`); return; }
    const url = (await res.json()).images?.[0]?.url;
    if (!url) { console.log(`fail ${name}: no picture in the answer`); return; }
    const img = await fetch(url);
    await writeFile(`${set.out}/${name}.png`, Buffer.from(await img.arrayBuffer()));
    done[name] = prompt;
    console.log(`ok   ${name}  ${Math.round((Date.now() - t) / 1000)} s`);
  } catch (e) { console.log(`fail ${name}: ${String(e).slice(0, 200)}`); }
}
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));
let kept = {};
try { kept = JSON.parse(await readFile(`${set.out}/prompts.json`, 'utf8')); } catch {}
await writeFile(`${set.out}/prompts.json`, JSON.stringify({ model, quality, size: [width, height], prompts: { ...kept.prompts, ...done } }, null, 2));
console.log(`${Object.keys(done).length} of ${names.length} saved in ${set.out} (GENERATED pictures: ideas, not evidence)`);
