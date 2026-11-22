// The button's sounds, all synthesized here with Web Audio: no samples, nothing recorded.
// Fetched by support-button.js after the visitor first presses the button, and given the
// audio context that press created. Everything is short, a little different each time, and
// quieter than speech.

export function createSound(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.42;
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -16; squash.knee.value = 12; squash.ratio.value = 6; squash.attack.value = 0.003; squash.release.value = 0.14;
  master.connect(squash).connect(ctx.destination);

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  { const d = noiseBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  const live = new Set();
  const keep = (node) => { live.add(node); node.onended = () => live.delete(node); return node; };
  const jitter = (v, amount = 0.06) => v * (1 + (Math.random() * 2 - 1) * amount);

  /** A pitched blip: f0 gliding to f1 over dur, with a quick attack and an exponential tail. */
  function tone(t, { type = "sine", f0, f1 = f0, dur = 0.1, gain = 0.3, attack = 0.004, out = master }) {
    const o = keep(ctx.createOscillator()), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  /** Filtered noise: a burst whose filter sweeps from f0 to f1. */
  function noise(t, { type = "bandpass", f0, f1 = f0, q = 1, dur = 0.1, gain = 0.3, attack = 0.003, out = master }) {
    const s = keep(ctx.createBufferSource()), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer; s.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.9); s.stop(t + dur + 0.02);
    return s;
  }
  /** One syllable of a voice that isn't one: a buzz through two vowel formants. */
  function syllable(t, { pitch, bend = 1, dur = 0.08, gain = 0.2, vowel = "a" }) {
    const formants = { a: [760, 1250], u: [330, 880], e: [480, 1900], o: [470, 900], i: [300, 2300] }[vowel];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    const o = keep(ctx.createOscillator());
    o.type = "sawtooth";
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.exponentialRampToValueAtTime(pitch * bend, t + dur);
    for (const [i, freq] of formants.entries()) {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 5;
      const fg = ctx.createGain(); fg.gain.value = i ? 0.6 : 1;
      o.connect(f).connect(fg).connect(g);
    }
    o.start(t); o.stop(t + dur + 0.02);
  }

  let lastPunch = 0;
  const sounds = {
    whoosh(t) { noise(t, { f0: jitter(700, 0.2), f1: jitter(2600, 0.2), q: 1.4, dur: 0.16, gain: 0.16, attack: 0.03 }); },
    press(t) { tone(t, { f0: 190, f1: 70, dur: 0.09, gain: 0.5 }); noise(t, { type: "highpass", f0: 2500, dur: 0.025, gain: 0.12 }); },
    hey(t) { syllable(t, { pitch: jitter(430), bend: 1.25, dur: 0.09, vowel: "e", gain: 0.2 }); syllable(t + 0.1, { pitch: jitter(520), bend: 0.8, dur: 0.15, vowel: "a", gain: 0.22 }); },
    mumble(t, count = 4) {
      const vowels = "aeuoi";
      for (let i = 0; i < count; i++) syllable(t + i * 0.074, { pitch: jitter(360 + (i % 3) * 30, 0.12), bend: jitter(1, 0.12), dur: 0.062, vowel: vowels[Math.floor(Math.random() * 5)], gain: 0.1 });
    },
    pant(t) { for (let i = 0; i < 3; i++) noise(t + i * 0.32, { f0: 900, f1: 500, q: 0.8, dur: 0.2, gain: 0.07, attack: 0.06 }); },
    zero(t) { tone(t, { type: "triangle", f0: jitter(1560, 0.03), dur: 0.12, gain: 0.07 }); },
    sting(t) {
      tone(t, { type: "sawtooth", f0: 82, f1: 41, dur: 0.7, gain: 0.3 });
      tone(t, { type: "square", f0: 116, f1: 58, dur: 0.7, gain: 0.12 });
      noise(t, { type: "lowpass", f0: 3000, f1: 200, dur: 0.4, gain: 0.3 });
    },
    thud(t, i = 0) { tone(t, { f0: 96 - i * 7, f1: 44, dur: 0.24, gain: 0.34 }); noise(t, { type: "lowpass", f0: 320, dur: 0.14, gain: 0.16 }); },
    /** The low drone under the menace. Returns a handle so the scene can cut it. */
    rumble(t, dur = 1.8) {
      const g = ctx.createGain(), lfo = keep(ctx.createOscillator()), depth = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.3); g.gain.setValueAtTime(0.16, t + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      lfo.frequency.value = 6.5; depth.gain.value = 0.09; lfo.connect(depth).connect(g.gain);
      const a = tone(t, { type: "sawtooth", f0: 55, dur: dur + 0.1, gain: 1, attack: 0.2, out: g });
      const b = tone(t, { type: "sawtooth", f0: 58.3, dur: dur + 0.1, gain: 0.8, attack: 0.2, out: g });
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260;
      g.connect(lp).connect(master);
      lfo.start(t); lfo.stop(t + dur + 0.1);
      return { stop() { for (const n of [a, b, lfo]) { try { n.stop(); } catch { /* already over */ } } } };
    },
    threat(t) {
      // Six syllables, low, ending on a rise: a question that isn't one.
      const shape = [["a", 150, 1], ["u", 160, 1], ["e", 176, 1.05], ["e", 168, 0.96], ["i", 188, 1.1], ["i", 240, 1.42]];
      shape.forEach(([vowel, pitch, bend], i) => syllable(t + i * 0.135, { pitch, bend, dur: i === 5 ? 0.3 : 0.11, vowel, gain: 0.26 }));
    },
    punch(t) {
      if (t - lastPunch < 0.055) return; // the eye takes twenty-six a second; the ear doesn't need them all
      lastPunch = t;
      tone(t, { f0: jitter(170, 0.18), f1: 52, dur: 0.07, gain: 0.34 });
      noise(t, { type: "lowpass", f0: jitter(1500, 0.3), f1: 300, dur: 0.05, gain: 0.2 });
    },
    /** The barrage's bark: mu-da, mu-da, faster and higher as it goes. */
    muda(t, count = 12) {
      let at = t;
      for (let i = 0; i < count; i++) {
        const k = i / count, step = 0.2 - 0.075 * k, pitch = jitter(205 + 70 * k, 0.04);
        syllable(at, { pitch, bend: 1.04, dur: step * 0.42, vowel: "u", gain: 0.2 });
        syllable(at + step * 0.46, { pitch: pitch * 1.14, bend: 0.92, dur: step * 0.5, vowel: "a", gain: 0.24 });
        at += step;
      }
    },
    /** The bulldozer: a low engine that can be pushed, then cut. */
    engine(t) {
      const g = ctx.createGain(), lp = ctx.createBiquadFilter(), o = keep(ctx.createOscillator()), o2 = keep(ctx.createOscillator()), chug = keep(ctx.createOscillator()), cg = ctx.createGain();
      o.type = "sawtooth"; o2.type = "square"; o.frequency.setValueAtTime(46, t); o2.frequency.setValueAtTime(69, t);
      o.frequency.exponentialRampToValueAtTime(78, t + 0.9); o2.frequency.exponentialRampToValueAtTime(117, t + 0.9);
      lp.type = "lowpass"; lp.frequency.value = 420;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.35);
      chug.frequency.value = 17; cg.gain.value = 0.1; chug.connect(cg).connect(g.gain);
      o.connect(lp); o2.connect(lp); lp.connect(g).connect(master);
      for (const n of [o, o2, chug]) n.start(t);
      let stopped = false;
      return {
        strain() { const now = ctx.currentTime; o.frequency.setTargetAtTime(104, now, 0.25); o2.frequency.setTargetAtTime(156, now, 0.25); chug.frequency.setTargetAtTime(27, now, 0.2); g.gain.setTargetAtTime(0.25, now, 0.2); },
        stop() {
          if (stopped) return; stopped = true;
          const now = ctx.currentTime;
          o.frequency.setTargetAtTime(24, now, 0.12); o2.frequency.setTargetAtTime(36, now, 0.12); g.gain.setTargetAtTime(0.0001, now, 0.1);
          for (const n of [o, o2, chug]) { try { n.stop(now + 0.6); } catch { /* already over */ } }
        },
      };
    },
    crash(t) {
      tone(t, { f0: 120, f1: 30, dur: 0.5, gain: 0.6 });
      noise(t, { type: "lowpass", f0: 5000, f1: 160, dur: 0.6, gain: 0.5 });
      for (const f of [523, 811, 1187, 1733]) tone(t + 0.01, { type: "square", f0: jitter(f, 0.03), dur: 0.32, gain: 0.05 });
    },
    sputter(t) { for (let i = 0; i < 5; i++) { const at = t + i * (0.09 + i * 0.035); tone(at, { type: "square", f0: 70 - i * 7, f1: 34, dur: 0.07, gain: 0.2 }); noise(at, { type: "lowpass", f0: 700, dur: 0.05, gain: 0.12 }); } },
    clank(t) { for (const f of [311, 467, 742]) tone(t, { type: "square", f0: jitter(f, 0.04), dur: 0.22, gain: 0.05 }); noise(t, { type: "highpass", f0: 1800, dur: 0.07, gain: 0.1 }); tone(t + 0.42, { f0: 90, f1: 40, dur: 0.2, gain: 0.3 }); },
    grief(t) {
      noise(t, { f0: 1100, f1: 380, q: 0.7, dur: 0.75, gain: 0.1, attack: 0.18 });
      syllable(t + 0.5, { pitch: 150, bend: 0.94, dur: 0.2, vowel: "u", gain: 0.2 });
      syllable(t + 0.78, { pitch: 132, bend: 0.82, dur: 0.36, vowel: "i", gain: 0.2 });
    },
    zip(t) { tone(t, { type: "triangle", f0: 260, f1: 1900, dur: 0.24, gain: 0.16, attack: 0.02 }); noise(t + 0.02, { f0: 900, f1: 4200, q: 1.2, dur: 0.24, gain: 0.12, attack: 0.04 }); tone(t + 0.3, { f0: 620, f1: 900, dur: 0.05, gain: 0.12 }); },
  };

  return {
    names: Object.keys(sounds),
    play(name, delay = 0, ...rest) { return sounds[name]?.(ctx.currentTime + 0.012 + delay, ...rest) ?? null; },
    stopAll() { for (const n of live) { try { n.stop(); } catch { /* already over */ } } live.clear(); },
  };
}
