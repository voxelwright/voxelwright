// Mechanical press/release recordings; other cues are synthesized with Web Audio.
// The output context opens on user activation. Restored consent can warm the recordings silently. Sounds are short, a little different each time, and quieter than speech.

let ctx = null, master = null, switchFilter = null, on = false;
let treble = 0;

// Voice the recorded impact for the enclosure. Keep the attack time and the
// two different strokes in the recording. A change never starts audio.
export function switchTreble(db) {
  if (treble === db) return;
  treble = db;
  if (switchFilter) switchFilter.gain.setTargetAtTime(db, ctx.currentTime, .012);
}
const samples = new Map();
let loading = null;
let resuming = null;
let muteRevision = 0;
function loadSamples(decoder) {
  if (loading) return loading;
  loading = Promise.all(['press', 'release'].map(async (name) => {
    const response = await fetch(new URL(`./audio/${name}.wav`, import.meta.url));
    if (!response.ok) throw new Error(`Switch audio: ${response.status}`);
    samples.set(name, await decoder.decodeAudioData(await response.arrayBuffer()));
  })).catch(() => { loading = null; });
  return loading;
}
// Decode before the first gesture in a new showcase document, without opening an output device.
export function prepareSwitchSound() {
  if (loading || samples.size === 2) return;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (Offline) void loadSamples(new Offline(1, 1, 44100));
}

function mechanical(name, at) {
  const buffer = samples.get(name);
  if (!buffer) {
    // Contact is immediate even during a cold load. Never replay it when the buffer arrives.
    tock(at, name === 'press' ? 175 : 320, .03, .18);
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(switchFilter);
  source.onended = () => source.disconnect();
  source.start(at);
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: 'interactive' });
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  switchFilter = ctx.createBiquadFilter();
  switchFilter.type = 'highshelf';
  switchFilter.frequency.value = 2450;
  switchFilter.gain.value = treble;
  switchFilter.connect(master);
  return ctx;
}

// one block knocking on another
function tock(at, freq, dur = 0.07, gain = 0.5, drop = 0.7) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  const f = freq * (0.94 + Math.random() * 0.12);
  o.type = 'sine';
  o.frequency.setValueAtTime(f, at);
  o.frequency.exponentialRampToValueAtTime(f * drop, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at); o.stop(at + dur + 0.02);
}

function grit(at, dur = 0.12, gain = 0.2) {
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 500; f.Q.value = 0.8; g.gain.value = gain;
  s.connect(f).connect(g).connect(master);
  s.start(at);
}

const CUES = {
  press: (t) => mechanical('press', t),
  release: (t) => mechanical('release', t),
  slide: (t) => { tock(t, 240, 0.05, 0.35, 0.7); tock(t + 0.11, 330, 0.05, 0.3, 0.8); },
  tick: (t) => tock(t, 760, 0.025, 0.14, 0.9),
  detent: (t) => samples.has('release') ? mechanical('release', t) : CUES.tick(t),
  build: (t) => { for (let i = 0; i < 9; i++) tock(t + 0.03 + i * 0.04 * (1 - i * 0.04), 420 + i * 55, 0.035, 0.16, 0.85); },
  break: (t) => { grit(t, 0.22, 0.3); for (let i = 0; i < 6; i++) tock(t + i * 0.03, 520 - i * 50, 0.04, 0.16, 0.7); },
  poke: (t) => { grit(t, 0.1, 0.22); tock(t, 150, 0.09, 0.5, 0.5); },
  done: (t) => { tock(t, 520, 0.09, 0.3, 0.98); tock(t + 0.1, 780, 0.14, 0.3, 0.98); },
  failed: (t) => { tock(t, 300, 0.12, 0.3, 0.7); tock(t + 0.13, 210, 0.18, 0.3, 0.7); },
};

/** Turn sound on or off. Call it from a click or key handler: browsers need the gesture. */
export function sound(enable) {
  if (enable === undefined) return on;
  on = !!enable;
  if (on && ensure()) {
    master.gain.setValueAtTime(0.32, ctx.currentTime);
    if (ctx.state === 'suspended') resuming = ctx.resume().catch(() => {});
    void loadSamples(ctx);
  } else {
    muteRevision++;
    if (master) master.gain.setValueAtTime(0, ctx.currentTime);
  }
  return on;
}

/** Play a cue: press, release, slide, tick, build, break, poke, done, failed. Silent unless on. */
export function cue(name) {
  const fn = CUES[name];
  if (!on || !ctx || !fn || document.hidden) return;
  if (ctx.state === 'running') return fn(ctx.currentTime + 0.001);
  if (ctx.state !== 'suspended' || !resuming) return;
  // WebKit can unlock output just after dispatching the first tap.
  const contact = performance.now(), revision = muteRevision;
  resuming.then(() => {
    if (ctx.state === 'running' && on && revision === muteRevision && !document.hidden && performance.now() - contact < 120)
      fn(ctx.currentTime + 0.001);
  });
}
