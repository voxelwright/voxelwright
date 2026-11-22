// The overlook's sound, all synthesised: wind over the hill, the city's low hum,
// a foghorn out on the Bay, a cable car bell, the tow plane's propeller, a
// clack under each press on the park directory and a shutter for a postcard.
// Silent until the visitor asks.
export function soundscape(ctx) {
  const out = ctx.createGain();
  out.gain.value = 0;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -18;
  limit.ratio.value = 6;
  out.connect(limit).connect(ctx.destination);

  const noise = (seconds, brown) => {
    const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = brown ? (last + 0.02 * white) / 1.02 : white;
      data[i] = brown ? last * 3.5 : white;
    }
    return buffer;
  };
  const loop = (buffer) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  };
  // A long, smooth tail so the horn and bell carry across the water.
  const hall = ctx.createConvolver();
  {
    const length = Math.round(ctx.sampleRate * 3.6);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    hall.buffer = ir;
  }
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  hall.connect(wet).connect(out);

  // Wind and hum share one brown-noise bed with a slow swell.
  const bed = ctx.createGain();
  bed.gain.value = 0.11;
  bed.connect(out);
  const brown = noise(4, true);
  const wind = ctx.createBiquadFilter();
  wind.type = "lowpass";
  wind.frequency.value = 380;
  loop(brown).connect(wind).connect(bed);
  const hum = ctx.createBiquadFilter();
  hum.type = "bandpass";
  hum.frequency.value = 120;
  hum.Q.value = 0.8;
  const humLevel = ctx.createGain();
  humLevel.gain.value = 0.55;
  loop(noise(3, false)).connect(hum).connect(humLevel).connect(bed);
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.06;
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = 0.04;
  swell.connect(swellDepth).connect(bed.gain);
  swell.start();
  const gust = ctx.createOscillator();
  gust.frequency.value = 0.11;
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 140;
  gust.connect(gustDepth).connect(wind.frequency);
  gust.start();

  // The tow plane: a two-blade propeller buzz panned to where it is on screen.
  const plane = ctx.createGain();
  plane.gain.value = 0;
  const pan = ctx.createStereoPanner();
  const prop = ctx.createBiquadFilter();
  prop.type = "lowpass";
  prop.frequency.value = 760;
  const engine = ctx.createOscillator();
  engine.type = "sawtooth";
  engine.frequency.value = 92;
  const beat = ctx.createOscillator();
  beat.frequency.value = 23;
  const beatDepth = ctx.createGain();
  beatDepth.gain.value = 0.35;
  const throb = ctx.createGain();
  throb.gain.value = 0.65;
  beat.connect(beatDepth).connect(throb.gain);
  engine.connect(prop).connect(throb).connect(plane).connect(pan).connect(out);
  engine.start();
  beat.start();

  function tone(at, f, type, level, attack, hold, release, filter = 900) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, at);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = filter;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + attack);
    env.gain.setValueAtTime(level, at + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
    osc.connect(lp).connect(env);
    env.connect(hall);
    env.connect(out);
    osc.start(at);
    osc.stop(at + attack + hold + release + 0.05);
    return osc;
  }
  // A two-tone diaphone, far off: a long high note that drops at the end.
  function foghorn() {
    const at = ctx.currentTime + 0.05;
    for (const [mult, type, level] of [
      [1, "sawtooth", 0.05],
      [2, "square", 0.012],
    ]) {
      const osc = tone(at, 176 * mult, type, level, 0.35, 1.7, 1.1, 520);
      osc.frequency.setValueAtTime(176 * mult, at + 1.6);
      osc.frequency.exponentialRampToValueAtTime(132 * mult, at + 1.95);
    }
  }
  function bell() {
    const at = ctx.currentTime + 0.05;
    for (const strike of [0, 0.32]) {
      const f = 1180 * (1 + (Math.random() - 0.5) * 0.01);
      for (const [ratio, level] of [
        [1, 0.022],
        [2.76, 0.01],
        [5.4, 0.004],
      ])
        tone(at + strike, f * ratio, "sine", level, 0.004, 0, 1.4, 6000);
    }
  }
  const clackNoise = noise(0.2, false);
  function clack(strong = false) {
    const at = ctx.currentTime;
    const jitter = 1 + (Math.random() - 0.5) * 0.16;
    const src = ctx.createBufferSource();
    src.buffer = clackNoise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = (strong ? 1300 : 2100) * jitter;
    band.Q.value = 2.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(strong ? 0.3 : 0.18, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(band).connect(env).connect(out);
    src.start(at);
    src.stop(at + 0.06);
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(150 * jitter, at);
    thump.frequency.exponentialRampToValueAtTime(70, at + 0.07);
    const body = ctx.createGain();
    body.gain.setValueAtTime(strong ? 0.14 : 0.08, at);
    body.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    thump.connect(body).connect(out);
    thump.start(at);
    thump.stop(at + 0.09);
  }
  // A rush of air for the trip into a sign.
  function depart() {
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = brown;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(300, at);
    band.frequency.exponentialRampToValueAtTime(2400, at + 0.45);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.5, at + 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
    src.connect(band).connect(env).connect(out);
    src.start(at);
    src.stop(at + 0.6);
  }

  // A camera shutter for the postcard: the mirror slaps up, the curtain runs, the mirror
  // returns. Three filtered ticks of the clack's noise, each slightly varied.
  function shutter() {
    const at = ctx.currentTime;
    for (const [delay, f, level, length] of [
      [0, 3200, 0.22, 0.025],
      [0.045, 1700, 0.14, 0.04],
      [0.11, 2600, 0.17, 0.03],
    ]) {
      const t = at + delay * (1 + (Math.random() - 0.5) * 0.1);
      const src = ctx.createBufferSource();
      src.buffer = clackNoise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = f * (1 + (Math.random() - 0.5) * 0.12);
      band.Q.value = 3.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(level, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + length);
      src.connect(band).connect(env).connect(out);
      src.start(t);
      src.stop(t + length + 0.01);
    }
    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(210, at);
    body.frequency.exponentialRampToValueAtTime(90, at + 0.06);
    const thud = ctx.createGain();
    thud.gain.setValueAtTime(0.06, at);
    thud.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    body.connect(thud).connect(out);
    body.start(at);
    body.stop(at + 0.08);
  }

  let timers = [];
  function every(first, low, high, play) {
    const next = (delay) => {
      timers.push(
        setTimeout(() => {
          play();
          next(low + Math.random() * (high - low));
        }, delay * 1000),
      );
    };
    next(first);
  }
  let on = false;
  return {
    start() {
      if (on) return;
      on = true;
      ctx.resume();
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0.7, ctx.currentTime, 0.6);
      every(5, 30, 48, foghorn);
      every(17, 45, 90, bell);
    },
    stop() {
      if (!on) return;
      on = false;
      timers.forEach(clearTimeout);
      timers = [];
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      // Let the fade finish, then stop the whole graph until the next start.
      setTimeout(() => on || ctx.suspend(), 700);
    },
    get on() {
      return on;
    },
    night(dark) {
      // Fewer gusts and a quieter street after dark.
      humLevel.gain.setTargetAtTime(dark ? 0.35 : 0.55, ctx.currentTime, 1.5);
      wind.frequency.setTargetAtTime(dark ? 300 : 380, ctx.currentTime, 1.5);
    },
    plane(position, level) {
      pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, position)), ctx.currentTime, 0.1);
      plane.gain.setTargetAtTime(level * 0.05, ctx.currentTime, 0.25);
    },
    clack,
    depart,
    shutter,
  };
}
