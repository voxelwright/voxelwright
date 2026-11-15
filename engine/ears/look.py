"""Pictures of clips (#410): for each, its waveform, its spectrogram on a log pitch axis, and how loud it is over
time. Several clips go side by side so that one can be read against another.

    uv run python look.py a.wav b.wav ... --out picture.png [--seconds 12] [--names "today,reference"]
"""
import argparse
import numpy as np
import soundfile as sf
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def load(path, seconds=None, start=0.0):
    info = sf.info(path)
    y, sr = sf.read(path, start=int(start * info.samplerate), frames=int(seconds * info.samplerate) if seconds else -1, always_2d=True, dtype="float32")
    return y.T, sr


def panel(axes, path, seconds, name, start=0.0, norm=True):
    y, sr = load(path, seconds, start)
    mono = y.mean(axis=0)
    if sr != 48000:
        mono = librosa.resample(mono, orig_sr=sr, target_sr=48000); sr = 48000
    peak = float(np.max(np.abs(mono))) or 1.0
    t = np.arange(len(mono)) / sr
    axes[0].plot(t, mono, lw=0.3, color="#1f4e79")
    axes[0].set_ylim(-1, 1); axes[0].set_xlim(0, t[-1]); axes[0].set_title(f"{name}  (peak {20*np.log10(peak):.1f} dBFS)", fontsize=9)
    axes[0].tick_params(labelsize=6)
    # The spectrogram is of the clip brought to a common level, so that timbre is compared and not loudness.
    S = np.abs(librosa.stft(mono / peak if norm else mono, n_fft=4096, hop_length=512)) ** 2
    db = librosa.power_to_db(S, ref=1.0 if not norm else np.max(S), top_db=90)
    librosa.display.specshow(db, sr=sr, hop_length=512, x_axis="time", y_axis="log", ax=axes[1], cmap="magma", vmin=db.max() - 90, vmax=db.max(), fmin=20)
    axes[1].set_ylim(30, 20000); axes[1].tick_params(labelsize=6); axes[1].set_xlabel(""); axes[1].set_ylabel("Hz", fontsize=6)
    hop = int(0.05 * sr)
    frames = librosa.util.frame(np.pad(mono, (0, hop)), frame_length=int(0.4 * sr) if len(mono) > sr else hop, hop_length=hop)
    lv = 10 * np.log10(np.mean(frames ** 2, axis=0) + 1e-12)
    axes[2].plot(np.arange(len(lv)) * hop / sr, lv, color="#a33", lw=0.8)
    axes[2].set_ylim(-70, 0); axes[2].set_xlim(0, t[-1]); axes[2].set_ylabel("dB (400 ms)", fontsize=6); axes[2].tick_params(labelsize=6)


if __name__ == "__main__":
    import librosa.display  # noqa: F401
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+"); ap.add_argument("--out", required=True); ap.add_argument("--seconds", type=float, default=None)
    ap.add_argument("--start", type=float, default=0.0); ap.add_argument("--names", default="")
    a = ap.parse_args()
    names = a.names.split(",") if a.names else [f.split("/")[-1] for f in a.files]
    n = len(a.files)
    fig, ax = plt.subplots(3, n, figsize=(max(6, 5.2 * n), 6.4), gridspec_kw={"height_ratios": [1, 3, 1]}, squeeze=False)
    for i, f in enumerate(a.files):
        panel(ax[:, i], f, a.seconds, names[i], a.start)
    fig.tight_layout(); fig.savefig(a.out, dpi=110); print(a.out)
