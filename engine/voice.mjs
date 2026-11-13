// Asks a model for a thing's sounds (#247): your own Claude Code, run once with no tools (make/model.mjs, the
// maker's own runner), told the brief in page/sound/brief.ts and the thing's name. The reply is data: it is read by
// `sounds()` and one that is refused is sent back with the reason, up to three times. Nothing in it is run.
//
//   node voice.mjs "a kalimba" [--model sonnet] [--out file.json]          prints or keeps the sounds
//   node voice.mjs "a kalimba" --world http://127.0.0.1:5764 --id thing-id   and gives them to a thing that is there
import { writeFileSync } from 'node:fs'
import { reply } from './make/model.mjs'
import { SOUND_BRIEF, again, asked, parse } from './page/sound/brief.ts'
import { sounds } from './page/sound/patch.ts'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const wish = process.argv[2]
if (!wish || wish.startsWith('--')) { console.error('node voice.mjs "a thing" [--model sonnet] [--out file.json] [--world url --id thing-id]'); process.exit(1) }

let prompt = asked(wish), kept = null
const tries = []
for (let n = 1; n <= 3 && !kept; n++) {
  const got = await reply({ system: SOUND_BRIEF, prompt, model: arg('model', 'opus') })
  let why
  try {
    const data = parse(got.text), read = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 1 && 'sounds' in data ? sounds(data.sounds) : { refused: 'the reply is {"sounds": {...}} and nothing else' }
    if ('sounds' in read) kept = read.sounds
    else why = read.refused
  } catch { why = 'it is not JSON' }
  tries.push({ n, ms: got.ms, cost: got.cost, model: got.model, refused: why ?? null })
  console.error(`try ${n}: ${(got.ms / 1000).toFixed(1)} s${why ? `, refused: ${why}` : ', taken'}`)
  if (why) prompt = again(wish, got.text, why)
}
if (!kept) { console.error('no reply could be used'); process.exit(1) }
const out = { wish, tries, sounds: kept }
if (arg('out', '')) writeFileSync(arg('out'), JSON.stringify(out, null, 1) + '\n')
else console.log(JSON.stringify(out, null, 1))
if (arg('world', '') && arg('id', '')) {
  const r = await fetch(`${arg('world')}/world/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'sound', thing: { id: arg('id'), sounds: kept } }) })
  console.error(r.status < 300 ? `${arg('id')} has its sounds` : `the world did not take them: ${r.status} ${await r.text()}`)
}
