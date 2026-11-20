// Encodes the two video eggs for the window screen from source files kept outside
// the repo. Only what the windows need ships: 160 × 120 frames (the window screen
// is about 110 panes tall) and the audio, in one small MP4 each, H.264 Main and
// HE-AAC so every browser with WebGPU can decode it.
//
//   node scripts/landing/encode-eggs.mjs --rick <file> --apple <file>
//
// Sources (see scripts/landing/README.md, "Video on the windows"):
//   rick   https://youtu.be/dQw4w9WgXcQ  854×480 at 25 fps, the 4:3 picture pillarboxed
//   apple  https://youtu.be/FtutLA63Cp8  480×360 at 30 fps
// Fetch with `uvx yt-dlp -f "bv*[height<=480]+ba" -o "%(id)s.%(ext)s" <url>` into a
// folder outside the repo, never into static/.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { rick: { type: "string" }, apple: { type: "string" } } });
const out = resolve(import.meta.dirname, "../../static/landing/eggs");
const LIMIT = 25 * 1024 * 1024; // Cloudflare static assets, per file.

const eggs = {
  // Crop the pillarbox to the 4:3 picture; keep the source's 25 fps.
  rick: { file: "rick.mp4", vf: "crop=640:480:107:0,scale=160:120:flags=area", fps: 25, crf: 27, tune: "film" },
  // Shadow art: flat black and white shapes compress very well.
  apple: { file: "bad-apple.mp4", vf: "scale=160:120:flags=area,format=gray,format=yuv420p", fps: 30, crf: 26, tune: "animation" },
};

if (!values.rick && !values.apple) {
  console.error("Usage: node scripts/landing/encode-eggs.mjs --rick <source> --apple <source>");
  process.exit(1);
}
for (const [name, egg] of Object.entries(eggs)) {
  const source = values[name];
  if (!source) continue;
  const target = resolve(out, egg.file);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-map", "0:v:0", "-map", "0:a:0", "-map_metadata", "-1",
    "-vf", egg.vf, "-r", String(egg.fps),
    "-c:v", "libx264", "-profile:v", "main", "-preset", "veryslow", "-tune", egg.tune, "-crf", String(egg.crf),
    "-pix_fmt", "yuv420p", "-g", String(egg.fps * 4),
    // Both at one loudness (EBU R128, -16 LUFS): Bad Apple's master is about 8 dB
    // hotter than Rick's, and a phone ignores a page's volume.
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    // Profile 4 is HE-AAC.
    "-c:a", "aac_at", "-profile:a", "4", "-b:a", "48k", "-ac", "2", "-ar", "44100",
    // The index first, so a partial download can start.
    "-movflags", "+faststart", target,
  ];
  const run = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (run.status) process.exit(run.status);
  const size = statSync(target).size;
  if (size > LIMIT) throw Error(`${egg.file} is over the 25 MiB asset limit`);
  console.log(`${egg.file}: ${(size / 1024 / 1024).toFixed(2)} MiB`);
}
