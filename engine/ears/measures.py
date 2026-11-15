"""The measures of the judge (#410): numbers taken from audio, each standing for something an ear would say.

Every measure is a function of samples and returns plain numbers. Nothing here knows the engine. A clip is read at
48 kHz; level is measured on the clip as it is, and everything about timbre and music on the clip brought to
-23 LUFS, so that no measure is loudness in disguise.

Which of these are believed, and why, is not decided here: see validate.py and the sound-judge skill.
"""
from __future__ import annotations

import warnings
import numpy as np
import scipy.signal as sig
import soundfile as sf
import librosa
import pyloudnorm

SR = 48000
warnings.filterwarnings("ignore")
EPS = 1e-12


def db(v):
    return 10 * np.log10(np.maximum(v, EPS))


def load(path, seconds=60.0, skip=0.0):
    """Stereo float32 [2, n] at 48 kHz: at most `seconds` of it, from `skip` (a share of its length) in."""
    info = sf.info(path)
    start = int(skip * info.frames) if info.frames / info.samplerate > seconds * 1.3 else 0
    y, sr = sf.read(path, start=start, frames=int(seconds * info.samplerate), always_2d=True, dtype="float32")
    y = y.T
    if y.shape[0] == 1:
        y = np.vstack([y, y])
    y = y[:2]
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR, res_type="soxr_hq")
    return np.ascontiguousarray(y)


# ── Level: on the clip as it is ───────────────────────────────────────────
def lufs(y):
    x = y.T
    if x.shape[0] < SR:
        x = np.vstack([x, np.zeros((SR - x.shape[0], 2), dtype=x.dtype)])
    v = pyloudnorm.Meter(SR).integrated_loudness(x)
    return float(v) if np.isfinite(v) else -120.0


def true_peak(y):
    return float(20 * np.log10(max(np.max(np.abs(sig.resample_poly(y, 4, 1, axis=1))), EPS)))


def kweighted(y):
    m = pyloudnorm.Meter(SR)
    out = y.astype(np.float64).copy()
    for f in m._filters.values():
        out = sig.lfilter(f.b, f.a, out, axis=1)
    return out


def short_term(y, window=3.0, hop=0.5):
    """Loudness in windows (LUFS), K-weighted."""
    k = kweighted(y)
    p = (k ** 2).sum(axis=0)
    n, h = int(window * SR), int(hop * SR)
    if len(p) < n:
        return np.array([-0.691 + db(p.mean())])
    c = np.concatenate([[0], np.cumsum(p)])
    idx = np.arange(0, len(p) - n + 1, h)
    return -0.691 + db((c[idx + n] - c[idx]) / n)


def loudness_range(y):
    """EBU Tech 3342: the spread between the 10th and 95th percentile of 3 s loudness, gated."""
    st = short_term(y)
    st = st[st > -70]
    if len(st) < 4:
        return 0.0
    gate = db(np.mean(10 ** (st / 10))) - 20
    st = st[st > gate]
    return float(np.percentile(st, 95) - np.percentile(st, 10)) if len(st) > 3 else 0.0


def level(y):
    L = lufs(y)
    tp = true_peak(y)
    mono = y.mean(axis=0)
    return {
        "lufs": L,
        "true_peak": tp,
        "plr": tp - L,
        "lra": loudness_range(y),
        "dc": float(abs(mono.mean()) / (np.sqrt(np.mean(mono ** 2)) + EPS)),
    }


# ── Hard faults: on the clip as it is ─────────────────────────────────────
def clipping(y):
    """Samples held flat at the top, per million: those within 0.2% of the peak and next to another such."""
    worst = 0.0
    for ch in y:
        top = np.max(np.abs(ch))
        if top < 0.02:
            continue
        at = np.abs(ch) >= top * 0.998
        runs = at[1:] & at[:-1]
        worst = max(worst, float(runs.sum()) / len(ch))
    return worst * 1e6


def clicks(y):
    """Breaks a second: a sample or two far out of line with everything within a few milliseconds, with the same
    sound either side. A blow also begins with a jolt, but it is many samples long and energy stays up after it; a
    break (a loop that does not meet, a voice cut off, a block dropped) is a jolt alone.
    """
    n = 0
    B = 256
    for ch in y:
        x = ch.astype(np.float64)
        d2 = np.abs(np.diff(x, 2))
        if len(d2) < B * 4 or d2.max() < 1e-4:
            continue
        m = len(d2) // B
        med = np.median(d2[: m * B].reshape(m, B), axis=1)
        # What is usual hereabouts: the middle of this block's and its neighbours' medians.
        near = np.median(np.vstack([np.roll(med, 1), med, np.roll(med, -1)]), axis=0)
        scale = np.repeat(near, B) + 1e-6
        d = d2[: m * B]
        cand = np.where((d > 14 * scale) & (d > 0.004))[0]
        last = -SR
        w = int(0.004 * SR)
        for i in cand:
            if i - last < w or i < w or i + w >= len(x):
                continue
            # Alone: few samples near it are even half as far out.
            crowd = np.sum(d[i - 96 : i + 96] > 0.5 * d[i])
            before = np.sqrt(np.mean(x[i - w : i - 8] ** 2)) + 1e-6
            after = np.sqrt(np.mean(x[i + 8 : i + w] ** 2)) + 1e-6
            if crowd <= 6 and 0.5 < after / before < 2.0 and before > 0.002:
                n += 1
                last = i
    return n / (y.shape[1] / SR)


def silence(y):
    """The share of the clip under -60 dB against its own loudest second, and the longest such stretch in seconds."""
    mono = y.mean(axis=0)
    h = int(0.05 * SR)
    e = np.sqrt(np.mean(librosa.util.frame(np.pad(mono, (0, h)), frame_length=h, hop_length=h) ** 2, axis=0))
    if len(e) > 80:
        e = e[20:-20]  # a second at each end is its coming in and its dying away, not a hole in it
    ref = np.percentile(e, 99) + EPS
    quiet = e < ref * 1e-3
    longest = run = 0
    for q in quiet:
        run = run + 1 if q else 0
        longest = max(longest, run)
    return float(quiet.mean()), longest * 0.05


def stereo(y):
    l, r = y[0].astype(np.float64), y[1].astype(np.float64)
    mid, side = (l + r) / 2, (l - r) / 2
    pm, ps = np.mean(mid ** 2), np.mean(side ** 2)
    corr = float(np.sum(l * r) / (np.sqrt(np.sum(l * l) * np.sum(r * r)) + EPS))
    return {"width": float(db(ps + EPS) - db(pm + EPS)), "phase": corr}


def faults(y):
    s, longest = silence(y)
    st = stereo(y)
    return {"clip_ppm": clipping(y), "clicks": clicks(y), "silent_share": s, "silent_longest": longest, **st}


# ── Timbre: on the clip at -23 LUFS ───────────────────────────────────────
THIRDS = 1000 * 2 ** (np.arange(-16, 13) / 3)  # 25 Hz to 16 kHz


def normalise(y, target=-23.0):
    L = lufs(y)
    if L < -100:
        return y
    return y * 10 ** ((target - L) / 20)


def ltas(mono):
    """Power in third-octave bands, dB against the whole: its long-term spectrum."""
    f, p = sig.welch(mono, SR, nperseg=8192, noverlap=4096)
    out = np.zeros(len(THIRDS))
    for i, c in enumerate(THIRDS):
        lo, hi = c * 2 ** (-1 / 6), c * 2 ** (1 / 6)
        out[i] = p[(f >= lo) & (f < hi)].sum()
    return db(out / (out.sum() + EPS))


def balance(mono):
    b = ltas(mono)
    lin = 10 ** (b / 10)
    share = lambda lo, hi: float(db(lin[(THIRDS >= lo) & (THIRDS < hi)].sum()))
    use = (THIRDS >= 100) & (THIRDS <= 8000) & (b > -80)
    slope = float(np.polyfit(np.log2(THIRDS[use]), b[use], 1)[0]) if use.sum() > 4 else 0.0
    return {
        "tilt": slope,  # dB an octave against pink (pink is 0, white +3)
        "sub": share(20, 60), "bass": share(60, 250), "mud": share(250, 500), "mid": share(500, 2000),
        "harsh": share(2000, 5000), "air": share(8000, 14000),
    }


def bark(f):
    return 26.81 * f / (1960 + f) - 0.53


def sharpness(mono):
    """After Zwicker and DIN 45692, with loudness in a band taken as its power to the 0.23: acum-like, not acum."""
    f, p = sig.welch(mono, SR, nperseg=4096)
    z = bark(np.maximum(f, 1))
    n = np.array([p[(z >= k) & (z < k + 1)].sum() for k in range(24)]) ** 0.23
    zc = np.arange(24) + 0.5
    g = np.where(zc < 15.8, 1.0, 0.15 * np.exp(0.42 * (zc - 15.8)) + 0.85)
    return float(0.11 * np.sum(n * g * zc) / (np.sum(n) + EPS))


def roughness(mono):
    """How much the sound beats and grates: how deep the level of each band moves at 20 to 150 times a second
    (`rough`, what Zwicker calls roughness, strongest near 70 Hz) and at 4 to 16 times a second (`beats`: two
    strings a little out of tune). Each is the modulation's size against the band's level, weighted by the band's power.
    """
    hop = 96  # 2 ms: the level of a band 500 times a second
    S = np.abs(librosa.stft(mono, n_fft=512, hop_length=hop)) ** 2
    f = np.fft.rfftfreq(512, 1 / SR)
    z = bark(np.maximum(f, 1))
    env = np.sqrt(np.array([S[(z >= k) & (z < k + 1)].sum(axis=0) for k in range(2, 22)]) + EPS)
    n = env.shape[1]
    if n < 512:
        return {"rough": 0.0, "beats": 0.0}
    seg = 512
    fr = np.fft.rfftfreq(seg, hop / SR)
    rough = beats = weight = 0.0
    for b in range(env.shape[0]):
        frames = librosa.util.frame(env[b], frame_length=seg, hop_length=seg // 2)
        mean = frames.mean(axis=0)
        loud = mean > env.max() * 0.02
        if not loud.any():
            continue
        X = np.abs(np.fft.rfft((frames - mean) * np.hanning(seg)[:, None], axis=0)) / (seg / 4)
        depth = lambda lo, hi: np.sqrt((X[(fr >= lo) & (fr < hi)] ** 2).sum(axis=0)) / (mean + EPS)
        w = (mean ** 2)[loud]
        rough += float((depth(20, 150)[loud] * w).sum()); beats += float((depth(4, 16)[loud] * w).sum()); weight += float(w.sum())
    return {"rough": rough / (weight + EPS), "beats": beats / (weight + EPS)}


def liveness(mono):
    """How much a sound's parts move while they sound.

    `flutter`: in each band that is sounding, how far its level strays (dB) from a straight line over 80 ms, median
    over bands and time. A sine that only dies away strays by nothing; a played string, a voice, a room do.
    `floor`: how far under its peaks the spectrum's valleys lie (dB): the black between partials that a recording
    never has, because a body, a room and other strings fill it.
    """
    S = librosa.feature.melspectrogram(y=mono, sr=SR, n_fft=2048, hop_length=480, n_mels=64, fmin=40, fmax=14000, power=2)
    D = db(S)
    top = D.max()
    w = 8
    out = []
    for b in range(D.shape[0]):
        row = D[b]
        if row.max() < top - 40 or len(row) < w * 2:
            continue
        fr = librosa.util.frame(row, frame_length=w, hop_length=w // 2)
        t = np.arange(w) - (w - 1) / 2
        slope = (fr * t[:, None]).sum(axis=0) / (t ** 2).sum()
        res = fr - fr.mean(axis=0) - slope * t[:, None]
        dev = np.sqrt((res ** 2).mean(axis=0))
        live = (fr.mean(axis=0) > top - 45) & (np.abs(slope) < 1.5)  # sounding, and not in an onset
        if live.sum() > 3:
            out.append(np.median(dev[live]))
    flutter = float(np.median(out)) if out else 0.0
    # Valleys: in loud frames, the 10th percentile of the fine spectrum under its 95th, 200 Hz to 8 kHz.
    F = np.abs(librosa.stft(mono, n_fft=4096, hop_length=2048)) ** 2
    fr = np.fft.rfftfreq(4096, 1 / SR)
    F = F[(fr > 200) & (fr < 8000)]
    e = F.sum(axis=0)
    loud = e > np.percentile(e, 60)
    Fd = db(F[:, loud])
    floor = float(np.median(np.percentile(Fd, 95, axis=0) - np.percentile(Fd, 10, axis=0))) if loud.sum() else 0.0
    return {"flutter": flutter, "floor": floor}


def texture(mono):
    """For what goes on all the while: whether anything happens in it.

    `events`: how heavy-tailed the level of its top (2 to 12 kHz) is in 5 ms steps (excess kurtosis): drops and
    cracks stand out of a hiss; a hiss alone has none. `swell`: how far its loudness moves over seconds (dB).
    """
    sos = sig.butter(4, [2000, 12000], btype="band", fs=SR, output="sos")
    hi = sig.sosfilt(sos, mono)
    h = int(0.005 * SR)
    e = np.sqrt(np.mean(librosa.util.frame(hi, frame_length=h, hop_length=h) ** 2, axis=0) + EPS)
    e = e / (np.median(e) + EPS)
    k = float(np.mean((e - e.mean()) ** 4) / (np.var(e) ** 2 + EPS) - 3)
    st = short_term(np.vstack([mono, mono]), window=1.0, hop=0.25)
    st = st[st > st.max() - 40]
    return {"events": k, "swell": float(np.std(st)) if len(st) > 2 else 0.0}


def crest(mono):
    """Peak over RMS (dB) of what is sounding: how much its blows stand out of its body."""
    h = int(0.05 * SR)
    fr = librosa.util.frame(np.pad(mono, (0, h)), frame_length=h, hop_length=h)
    e = np.sqrt(np.mean(fr ** 2, axis=0))
    on = e > np.max(e) * 0.01
    x = fr[:, on].ravel()
    return float(20 * np.log10(np.max(np.abs(x)) / (np.sqrt(np.mean(x ** 2)) + EPS))) if x.size else 0.0


def timbre(yn):
    mono = yn.mean(axis=0)
    return {**balance(mono), "sharp": sharpness(mono), **roughness(mono), **liveness(mono), **texture(mono), "crest": crest(mono)}


# ── A thing struck: each blow in a clip ───────────────────────────────────
def blows(mono, least=0.12):
    """Where each blow of a clip begins and ends (samples): a rise of 20 dB over what was, at least `least` s apart."""
    h = int(0.002 * SR)
    e = np.sqrt(np.mean(librosa.util.frame(np.pad(mono, (0, h)), frame_length=h * 2, hop_length=h) ** 2, axis=0))
    top = e.max()
    if top < 1e-5:
        return []
    floor = top * 10 ** (-45 / 20)
    out, i, n = [], 0, len(e)
    while i < n:
        if e[i] > max(floor, top * 0.05) and (i < 5 or e[i] > 4 * (np.min(e[max(0, i - 25) : i]) + floor * 0.1)):
            j = i
            peak = e[i]
            quiet = 0
            while j < n - 1:
                j += 1
                peak = max(peak, e[j])
                quiet = quiet + 1 if e[j] < max(floor, peak * 0.01) else 0
                if quiet > 15:
                    break
                # Another blow begins: a rise of 12 dB over the last 30 ms once it has fallen.
                if j - i > int(least / 0.002) and e[j] > 4 * np.min(e[j - 15 : j]) and e[j] > peak * 0.25:
                    break
            out.append((max(0, (i - 2) * h), j * h))
            i = max(j, i + 1)
        else:
            i += 1
    return out


def blow(x):
    """One blow: how fast it begins, how long it lasts, how its brightness falls, how much body it has, how many parts ring."""
    h = int(0.001 * SR)
    e = np.sqrt(np.mean(librosa.util.frame(np.pad(x, (h, h * 2)), frame_length=h * 2, hop_length=h) ** 2, axis=0) + EPS)
    at = int(np.argmax(e))
    top = e[at]
    rise = np.where(e[: at + 1] > top * 0.1)[0]
    attack = (at - rise[0]) if len(rise) else 0
    under = lambda by: next((i for i in range(at, len(e)) if np.all(e[i : i + 20] < top * 10 ** (-by / 20))), len(e)) - at
    n = 2048
    spec = lambda seg: np.abs(np.fft.rfft(np.pad(seg, (0, max(0, n - len(seg))))[:n] * np.hanning(n))) ** 2
    fr = np.fft.rfftfreq(n, 1 / SR)
    cen = lambda p: float((p * fr).sum() / (p.sum() + EPS))
    a0 = max(0, at * h - 256)
    first, later = spec(x[a0 : a0 + n]), spec(x[a0 + n // 2 + int(0.03 * SR) : a0 + n // 2 + int(0.03 * SR) + n])
    whole = np.abs(np.fft.rfft(x * np.hanning(len(x)), n=max(8192, 1 << int(np.ceil(np.log2(len(x))))))) ** 2
    fw = np.fft.rfftfreq((len(whole) - 1) * 2, 1 / SR)
    pk, _ = sig.find_peaks(db(whole), prominence=12, height=db(whole.max()) - 35)
    geo = np.exp(np.mean(np.log(whole[(fw > 100) & (fw < 10000)] + EPS)))
    return {
        "attack_ms": float(attack),
        "len20_ms": float(under(20)),
        "len40_ms": float(under(40)),
        "bright": cen(first),
        "bright_fall": float(np.log2((cen(first) + 1) / (cen(later) + 1))) if later.sum() > first.sum() * 1e-5 else 3.0,
        "body": float(db(whole[fw < 250].sum() / (whole.sum() + EPS))),
        "parts": float(len(pk)),
        "noisy": float(db(geo / (np.mean(whole[(fw > 100) & (fw < 10000)]) + EPS))),
    }


def struck(yn):
    mono = yn.mean(axis=0)
    found = blows(mono)
    if not found:
        return {}
    rows = [blow(mono[a:b]) for a, b in found if b - a > 256]
    if not rows:
        return {}
    out = {k: float(np.median([r[k] for r in rows])) for k in rows[0]}
    out["blows"] = float(len(rows))
    # No two blows alike: how far the loudest and the quietest are apart, and their brightness.
    if len(rows) >= 3:
        out["varies"] = float(np.std([np.log2(r["bright"] + 1) for r in rows]))
    return out


# ── Music: on the clip at -23 LUFS, mono at 22.05 kHz ─────────────────────
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def key_of(chroma):
    best, name = -1.0, 0
    for k in range(12):
        for m, prof in enumerate((KK_MAJOR, KK_MINOR)):
            r = np.corrcoef(np.roll(prof, k), chroma)[0, 1]
            if r > best:
                best, name = r, k + 12 * m
    return float(best), name


def music(yn):
    x = librosa.resample(yn.mean(axis=0), orig_sr=SR, target_sr=22050, res_type="soxr_mq")
    sr, hop = 22050, 512
    out = {}
    C = librosa.feature.chroma_cqt(y=x, sr=sr, hop_length=hop)
    e = librosa.feature.rms(y=x, hop_length=hop)[0][: C.shape[1]]
    C = C[:, : len(e)]
    on = e > np.max(e) * 0.03
    if on.sum() < 20:
        return out
    clarity, key = key_of((C[:, on] * e[on]).sum(axis=1))
    out["key_clarity"] = clarity
    # Does it stay where it is: the share of 8 s stretches whose key is the whole's, its relative or its fifth.
    near = {key, (key + 7) % 12 + 12 * (key // 12), (key + 5) % 12 + 12 * (key // 12), (key + 9) % 12 + 12 if key < 12 else (key - 12 + 3) % 12}
    w = int(8 * sr / hop)
    wins = [C[:, i : i + w] * e[i : i + w] for i in range(0, C.shape[1] - w + 1, w // 2)]
    keys = [key_of(c.sum(axis=1))[1] for c in wins if c.sum() > 0]
    out["key_holds"] = float(np.mean([k in near for k in keys])) if keys else 1.0
    # How much the harmony moves: the distance between the chroma of one 2 s and the next.
    w2 = int(2 * sr / hop)
    seg = np.array([(C[:, i : i + w2] * e[i : i + w2]).sum(axis=1) for i in range(0, C.shape[1] - w2 + 1, w2)])
    seg = seg[seg.sum(axis=1) > 0]
    if len(seg) > 2:
        segn = seg / (np.linalg.norm(seg, axis=1, keepdims=True) + EPS)
        out["harmony_moves"] = float(np.mean(1 - (segn[1:] * segn[:-1]).sum(axis=1)))
    # Pulse: how strongly its onsets come round at one pace.
    o = librosa.onset.onset_strength(y=x, sr=sr, hop_length=hop)
    ac = librosa.autocorrelate(o - o.mean(), max_size=int(4 * sr / hop))
    ac = ac / (ac[0] + EPS)
    lo, hi = int(0.25 * sr / hop), int(2.0 * sr / hop)
    out["pulse"] = float(np.max(ac[lo:hi])) if len(ac) > hi else 0.0
    out["onsets"] = float(len(librosa.onset.onset_detect(onset_envelope=o, sr=sr, hop_length=hop)) / (len(x) / sr))
    # Repetition against novelty, from timbre and harmony together in half-second steps.
    M = librosa.feature.mfcc(y=x, sr=sr, n_mfcc=13, hop_length=hop)[1:, : C.shape[1]]
    step = int(0.5 * sr / hop)
    n = C.shape[1] // step
    if n > 16:
        f = np.vstack([C[:, : n * step].reshape(12, n, step).mean(axis=2), (M[:, : n * step].reshape(12, n, step).mean(axis=2)) / 40])
        f = (f - f.mean(axis=1, keepdims=True))
        f = f / (np.linalg.norm(f, axis=0, keepdims=True) + EPS)
        S = f.T @ f
        far = np.abs(np.subtract.outer(np.arange(n), np.arange(n))) >= 8  # four seconds or more away
        best = np.where(far, S, -1).max(axis=1)
        out["comes_back"] = float(np.mean(best > 0.9))   # the share of it that is heard again later or earlier
        out["sameness"] = float(np.mean(S[far]))          # how alike any two moments of it are
    # How much happens: how far the spectrum's shape is from what it was a quarter of a second before (0 a held drone).
    Sm = db(librosa.feature.melspectrogram(y=x, sr=sr, n_fft=2048, hop_length=hop, n_mels=48, fmin=40) + 1e-9)
    q = int(0.25 * sr / hop)
    live = e[q:] > np.max(e) * 0.03
    if live.sum() > 10:
        a, b = Sm[:, q:][:, live[: Sm.shape[1] - q]], Sm[:, :-q][:, live[: Sm.shape[1] - q]]
        a, b = a - a.mean(axis=0), b - b.mean(axis=0)
        out["moves"] = float(np.mean(1 - (a * b).sum(axis=0) / (np.linalg.norm(a, axis=0) * np.linalg.norm(b, axis=0) + EPS)))
    # Register: how many octaves its power is spread over, and whether there is a bass.
    f, p = sig.welch(x, sr, nperseg=4096)
    use = (f > 30) & (f < 10000)
    lf = np.log2(f[use])
    mu = (p[use] * lf).sum() / (p[use].sum() + EPS)
    out["spread_oct"] = float(np.sqrt((p[use] * (lf - mu) ** 2).sum() / (p[use].sum() + EPS)))
    return out


# ── A mix: what the music hides ───────────────────────────────────────────
def band_power(x):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    p = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    z = bark(np.maximum(f, 1))
    return np.array([p[(z >= k) & (z < k + 1)].sum() for k in range(1, 23)])


def audible(world, rest, marks, window=0.12):
    """For each event (seconds), how far it stands over everything else at that moment, in its third-best critical band (dB).

    Over about -5 dB in one band a sound is made out of a masker; three bands make it plainly heard.
    """
    out = []
    w = int(window * SR)
    for t in marks:
        a = int(t * SR)
        if a + w > len(world):
            continue
        e, m = band_power(world[a : a + w]), band_power(rest[a : a + w])
        smr = db(e + 1e-14) - db(m + 1e-12)
        out.append(float(np.sort(smr)[-3]))
    return out


# ── All of it ─────────────────────────────────────────────────────────────
def measure(path, kind, marks=None, stems=None, skip=0.2):
    y = load(path, skip=skip if kind.startswith("music") else 0.0)
    # What is judged is the sound, not the quiet before it begins or after it has gone.
    e = np.abs(y).max(axis=0)
    on = np.where(e > e.max() * 1e-3)[0]
    if len(on) and on[-1] - on[0] > SR // 4:
        y = y[:, max(0, on[0] - 480) : on[-1] + 480]
    if kind == "oneshot":
        # A thing struck is measured over its blows alone, end to end, so that a clip of five blows and a file of one compare.
        found = blows(y.mean(axis=0))
        if found:
            y = np.hstack([y[:, a:b] for a, b in found])
    out = {**level(y), **faults(y)}
    yn = normalise(y)
    out.update(timbre(yn))
    if kind in ("oneshot", "sfx", "instrument"):
        out.update(struck(yn))
    if kind in ("music", "mix", "instrument"):
        out.update(music(yn))
    if stems and marks:
        w, m = load(stems[0])[:, : y.shape[1]].mean(axis=0), load(stems[1])[:, : y.shape[1]].mean(axis=0)
        a = audible(w, m, marks)
        if a:
            out["heard_median"] = float(np.median(a))
            out["heard_share"] = float(np.mean(np.array(a) > -5))
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}
