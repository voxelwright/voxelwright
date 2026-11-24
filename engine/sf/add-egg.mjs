// A meme egg from a YouTube link (#450, page/eggs.ts): fetched, its black bars found, encoded for the window screen
// and written into sf/memes.json, which the page reads. Then build (sf/build.mjs), pack (deploy/data.mjs pack) and commit
// sf/memes.json with deploy/data.json.
//
//   node sf/add-egg.mjs <link> [--says "i like trains, trains"] [--title "I Like Trains"] [--id trains]
//   node sf/add-egg.mjs --encode [trains,doom]      encodes again from the kept sources (all without names)
//
// Without --says the clip is said by its title's words; without --title it is called by its YouTube title. A phrase
// another egg already has is refused, as the page would never hear it. The encode is the site's video eggs'
// (site/scripts/landing/encode-eggs.mjs): 120 px tall at the clip's own shape, H.264 Main, HE-AAC, index first, the
// loudness two-pass to -16 LUFS (single-pass loudnorm drifts on a 5 s clip). Sources stay in
// ~/.village/engine/sf/eggs/src/memes, the encoded clips in ~/.village/engine/sf/eggs/media, never in git.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { phrases, words } from '../page/eggs-said.ts'

const EGGS = join(homedir(), '.village', 'engine', 'sf', 'eggs')
const SRC = join(EGGS, 'src', 'memes'), OUT = join(EGGS, 'media')
const LIST = join(import.meta.dirname, 'memes.json')
const LIMIT = 25 * 1024 * 1024 // Cloudflare static assets, per file.
const LOUD = 'I=-16:TP=-1.5:LRA=11'

/** The memes as the page reads them. */
export const memes = () => JSON.parse(readFileSync(LIST, 'utf8'))
const save = (list) => writeFileSync(LIST, '[\n' + list.map((m) => '  ' + JSON.stringify(m)).join(',\n') + '\n]\n')

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (r.status) throw Error(`${cmd}: ${r.stderr.slice(-2000)}`)
  return r
}
const ff = (args) => run('ffmpeg', ['-hide_banner', '-nostats', ...args]).stderr

/** The picture inside black bars baked into the clip, or undefined where it has none. */
function bars(source) {
  const said = ff(['-i', source, '-vf', 'cropdetect=limit=24:round=2:reset=0', '-an', '-f', 'null', '-'])
  const crop = said.match(/crop=(\d+):(\d+):(\d+):(\d+)/g)?.at(-1)?.slice(5)
  const [w, h] = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', source]).stdout.trim().split(',').map(Number)
  const [cw, ch] = crop?.split(':').map(Number) ?? [w, h]
  // (Only bars worth taking off: a few pixels of edge is the picture.)
  return crop && (w - cw > 8 || h - ch > 8) ? crop : undefined
}

/** The kept source of a clip, in whatever container yt-dlp merged it to (webm, or mkv where its streams don't fit one). */
const sourceOf = (youtube) => {
  const f = readdirSync(SRC).find((f) => f.startsWith(`${youtube}.`) && !f.endsWith('.part'))
  if (!f) throw Error(`no source for ${youtube} in ${SRC}`)
  return join(SRC, f)
}

/** The clip for the windows, and its loudness and size. */
export function encode(m) {
  const source = sourceOf(m.youtube), target = join(OUT, `${m.id}.mp4`)
  mkdirSync(OUT, { recursive: true })
  const said = ff(['-i', source, '-map', '0:a:0', '-af', `loudnorm=${LOUD}:print_format=json`, '-f', 'null', '-'])
  const l = JSON.parse(said.slice(said.lastIndexOf('{'), said.lastIndexOf('}') + 1))
  const loud = `loudnorm=${LOUD}:measured_I=${l.input_i}:measured_TP=${l.input_tp}:measured_LRA=${l.input_lra}:measured_thresh=${l.input_thresh}:offset=${l.target_offset}:linear=true`
  // (Every source so far is at 30 fps or under: its own rate is kept.)
  const vf = [m.crop && `crop=${m.crop}`, 'scale=-2:120:flags=area'].filter(Boolean).join(',')
  ff([
    '-loglevel', 'error', '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '-1', '-vf', vf,
    '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'veryslow', '-tune', 'film', '-crf', '27', '-pix_fmt', 'yuv420p', '-g', '120',
    '-af', loud, '-c:a', 'aac_at', '-profile:a', '4', '-b:a', '48k', '-ac', '2', '-ar', '44100',
    '-movflags', '+faststart', target,
  ])
  const heard = ff(['-i', target, '-map', '0:a:0', '-af', 'ebur128', '-f', 'null', '-'])
  const lufs = Number(heard.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold[\s\S]*$/)?.[1] ?? NaN)
  const size = statSync(target).size
  if (size > LIMIT) throw Error(`${m.id}.mp4 is over the 25 MiB asset limit`)
  console.log(`${`${m.id}.mp4`.padEnd(18)} ${(size / 1024).toFixed(0).padStart(5)} KiB  ${lufs} LUFS${m.crop ? `  (bars off: ${m.crop})` : ''}`)
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { says: { type: 'string' }, title: { type: 'string' }, id: { type: 'string' }, encode: { type: 'boolean' } } })
  const list = memes()
  if (values.encode) {
    const only = positionals[0]?.split(',')
    for (const m of list) if (!only || only.includes(m.id)) encode(m)
    process.exit(0)
  }
  const link = positionals[0]
  const youtube = link && (link.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1] ?? (/^[\w-]{11}$/.test(link) ? link : null))
  if (!youtube) { console.error('Usage: node sf/add-egg.mjs <youtube link> [--says "a, b"] [--title T] [--id x]'); process.exit(1) }
  const had = list.find((m) => m.youtube === youtube)
  if (had) { console.error(`${youtube} is already the meme “${had.id}” (says ${had.says.join(', ')})`); process.exit(1) }

  // Fetched as yt-dlp gives it, 480p at most, with its title and channel.
  mkdirSync(SRC, { recursive: true })
  const got = run('uvx', ['yt-dlp', '--no-warnings', '-q', '--no-simulate', '--print', '%(title)s\n%(channel)s', '-f', 'bv*[height<=480]+ba/b[height<=480]/b', '--merge-output-format', 'webm/mkv', '-P', SRC, '-o', '%(id)s.%(ext)s', `https://www.youtube.com/watch?v=${youtube}`])
  const [source, by] = got.stdout.trim().split('\n')

  const title = values.title ?? source
  const says = [...new Set((values.says ?? title).split(',').map(words).filter(Boolean))]
  let id = values.id ?? (words(title).split(' ').slice(0, 3).join('-') || youtube.toLowerCase())
  if (!/^[a-z0-9-]+$/.test(id)) throw Error(`the id “${id}” is not lower-case letters, digits and dashes`)
  if (!values.id) for (let n = 2; list.some((m) => m.id === id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
  else if (list.some((m) => m.id === id)) throw Error(`there is a meme “${id}” already`)
  const crop = bars(sourceOf(youtube))
  const m = { id, title, says, youtube, source, by, ...(crop ? { crop } : {}) }
  const { wrong } = phrases([...list, m])
  if (wrong.length) { console.error(`not added:\n  ${wrong.join('\n  ')}\n(choose other phrases with --says)`); process.exit(1) }
  encode(m)
  save([...list, m])
  console.log(`added “${title}” as ${id}: say ${says.map((s) => `“${s}”`).join(', ')}\nthen: node sf/build.mjs, and node ../deploy/data.mjs pack before it goes live`)
}
