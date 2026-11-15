"""Controlled damage (#410): a good clip broken one way at a time, to see that each measure moves for its own fault
and for no other. Every damaged clip is brought back to the loudness it had, so only the fault differs.

    from damage import DAMAGE; y2 = DAMAGE["mud"](y)        # y is float [2, n] at 48 kHz
"""
import numpy as np
import scipy.signal as sig
import librosa
import measures as M

SR = M.SR


def same_loudness(fn):
    def wrapped(y, *a):
        out = fn(y.astype(np.float64), *a).astype(np.float32)
        a0, a1 = M.lufs(y), M.lufs(out)
        if a0 > -100 and a1 > -100:
            out = out * 10 ** ((a0 - a1) / 20)
        return out
    return wrapped


def peaking(y, f0, gain_db, q=0.7):
    A, w = 10 ** (gain_db / 40), 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return sig.lfilter(np.array(b) / a[0], np.array(a) / a[0], y, axis=1)


def rng(y):
    return np.random.default_rng(int(abs(float(y[0, : SR].sum())) * 1e6) % (2 ** 31))


def clip(y):  # driven 14 dB into a hard stop, then turned down again
    top = np.max(np.abs(y)) + 1e-9
    return np.clip(y / top * 5, -1, 1) * top


def click(y):  # a 4 ms piece cut out about every second and a half: a loop that does not meet, a voice cut off
    r, out, at = rng(y), [], 0
    while at < y.shape[1]:
        nxt = at + int((1.0 + r.random()) * SR)
        out.append(y[:, at:nxt])
        at = nxt + int(0.004 * SR)
    return np.hstack(out)


def dropout(y):  # 128 samples of nothing about every second and a half: a block the audio thread did not fill
    r, out, at = rng(y), y.copy(), int(0.7 * SR)
    while at < y.shape[1] - 256:
        out[:, at : at + 128] = 0
        at += int((1.0 + r.random()) * SR)
    return out


def detune(y):  # the same again a third of a semitone sharp and half as loud: two players out of tune
    up = np.vstack([librosa.effects.pitch_shift(c.astype(np.float32), sr=SR, n_steps=0.35) for c in y])
    return y + 0.5 * up[:, : y.shape[1]]


def mud(y):
    return peaking(y, 320, 12)


def harsh(y):
    return peaking(y, 3200, 12)


def thin(y):
    return sig.sosfilt(sig.butter(2, 500, "high", fs=SR, output="sos"), y, axis=1)


def dull(y):
    return sig.sosfilt(sig.butter(2, 2000, "low", fs=SR, output="sos"), y, axis=1)


def hiss(y):  # white noise 25 dB under it
    r = rng(y)
    return y + r.standard_normal(y.shape) * np.sqrt(np.mean(y ** 2)) * 10 ** (-25 / 20)


def mono(y):
    m = y.mean(axis=0)
    return np.vstack([m, m])


def antiphase(y):
    return np.vstack([y[0], -y[1]])


def quiet(y):
    return y * 10 ** (-20 / 20)


def squash(y):  # every 5 ms brought to one level: no blow stands out, nothing breathes
    h = int(0.005 * SR)
    env = np.sqrt(sig.fftconvolve((y ** 2).mean(axis=0), np.ones(h) / h, mode="same") + 1e-9)
    floor = np.percentile(env, 90) * 0.03
    return y / np.maximum(env, floor)


def jitter(y):  # cut where it is struck and each piece moved up to 60 ms early or late: players not together
    r = rng(y)
    mono_ = y.mean(axis=0).astype(np.float32)
    on = librosa.onset.onset_detect(y=mono_, sr=SR, hop_length=512, units="samples", backtrack=True)
    on = [0] + [int(o) for o in on if o > SR // 10] + [y.shape[1]]
    out = np.zeros((2, y.shape[1] + SR))
    for a, b in zip(on[:-1], on[1:]):
        if b - a < 64:
            continue
        seg = y[:, a:b].copy()
        f = min(96, (b - a) // 4)
        seg[:, :f] *= np.linspace(0, 1, f); seg[:, -f:] *= np.linspace(1, 0, f)
        at = max(0, a + int((r.random() - 0.5) * 0.12 * SR))
        out[:, at : at + seg.shape[1]] += seg
    return out[:, : y.shape[1]]


def gap(y):  # three seconds of nothing in the middle
    out = y.copy()
    a = y.shape[1] // 2
    out[:, a : a + 3 * SR] = 0
    return out


def loop(y):  # its first two seconds over and over
    n = min(2 * SR, y.shape[1] // 3)
    seg = y[:, SR : SR + n].copy()
    f = 480
    seg[:, :f] *= np.linspace(0, 1, f); seg[:, -f:] *= np.linspace(1, 0, f)
    return np.tile(seg, int(np.ceil(y.shape[1] / n)))[:, : y.shape[1]]


def offset(y):
    return y + 0.25 * np.sqrt(np.mean(y ** 2))


def slow_attack(y):  # faded in over 40 ms from where it begins: a blow with no front
    e = np.abs(y).max(axis=0)
    at = int(np.argmax(e > e.max() * 0.02))
    n = int(0.04 * SR)
    g = np.ones(y.shape[1]); g[:at] = 0
    g[at : at + n] = np.linspace(0, 1, n)[: len(g[at : at + n])] ** 2
    return y * g


def cut_tail(y):  # stopped dead a third of the way through what is heard of it
    e = np.abs(y).max(axis=0)
    on = np.where(e > e.max() * 0.01)[0]
    end = on[0] + max(256, (on[-1] - on[0]) // 3)
    out = y.copy(); f = 96
    out[:, end:] = 0; out[:, end - f : end] *= np.linspace(1, 0, f)
    return out


def flat(y):  # levelled over 2 s windows: no swell, nothing coming or going
    h = 2 * SR
    env = np.sqrt(sig.fftconvolve((y ** 2).mean(axis=0), np.ones(h) / h, mode="same") + 1e-9)
    return y / np.maximum(env, np.percentile(env, 90) * 0.1)


# name -> (what is done, the measures that should move, the kinds it is tried on)
DAMAGE = {
    "clip": (clip, ["clip_ppm", "plr"], "all"),
    "click": (click, ["clicks"], "long"),
    "dropout": (dropout, ["clicks"], "long"),
    "offset": (offset, ["dc"], "all"),
    "gap": (gap, ["silent_longest"], "music"),
    "quiet": (quiet, ["lufs"], "all"),
    "mono": (mono, ["width"], "music"),
    "antiphase": (antiphase, ["phase"], "all"),
    "detune": (detune, ["rough", "beats"], "music"),
    "mud": (mud, ["mud"], "all"),
    "harsh": (harsh, ["harsh", "sharp"], "all"),
    "thin": (thin, ["bass", "tilt", "sub", "body"], "all"),
    "dull": (dull, ["air", "tilt", "sharp", "bright"], "all"),
    "hiss": (hiss, ["floor", "noisy"], "all"),
    "squash": (squash, ["crest", "plr"], "all"),
    "flat": (flat, ["lra", "swell"], "long"),
    "jitter": (jitter, ["pulse"], "music"),
    "loop": (loop, ["sameness", "comes_back"], "music"),
    "slow_attack": (slow_attack, ["attack_ms"], "oneshot"),
    "cut_tail": (cut_tail, ["len40_ms", "len20_ms"], "oneshot"),
}
for k, (fn, moves, kinds) in list(DAMAGE.items()):
    DAMAGE[k] = (fn if k == "quiet" else same_loudness(fn), moves, kinds)
