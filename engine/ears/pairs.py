"""Blind pairs (#410): for each clip, before and after side by side with the sides shuffled and no names, plus pairs
of a clean reference against the same reference damaged, to see whether a judge can tell at all.

    uv run python pairs.py <before> <after> <refs> <out> [--seed 3]
"""
import argparse, json, os, random, tempfile
import numpy as np, soundfile as sf
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import librosa.display  # noqa: F401
import look, measures as M
from damage import DAMAGE

CLIPS = ["step-hard", "step-soft", "hit-wood", "hit-steel", "break-glass", "like-bell", "like-shot", "bed-rain", "bed-fire", "bed-undersea", "play-piano", "play-guitar", "music-town-a", "music-coast-a", "music-sea-a", "music-snow-a", "music-night-a", "music-danger-a", "music-making-a", "mix-town-walk"]
CAL = [("music/Funkorama.mp3", "thin", "music"), ("music/Gymnopedie_No_1.mp3", "hiss", "music"), ("music/Pixelland.mp3", "quiet", "music"), ("sfx/footstep_concrete_001.ogg", "cut_tail", "oneshot"), ("beds/oga_amb_rain_loop_1.wav", "harsh", "bed"), ("music/Frozen_Star.mp3", "clip", "music")]

def sheet(pa, pb, out, what, seconds, start=0.0):
    fig, ax = plt.subplots(3, 2, figsize=(11, 6.2), gridspec_kw={"height_ratios": [1, 3, 1]}, squeeze=False)
    for i, (p, name) in enumerate(((pa, "A"), (pb, "B"))):
        look.panel(ax[:, i], p, seconds, name, start)
    fig.suptitle(what, fontsize=10); fig.tight_layout(); fig.savefig(out, dpi=80); plt.close(fig)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("before"); ap.add_argument("after"); ap.add_argument("refs"); ap.add_argument("out"); ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); r = random.Random(a.seed); key = {}
    kinds = {m["name"]: m["kind"] for m in json.load(open(os.path.join(a.after, "manifest.json")))}
    jobs = [("engine", c) for c in CLIPS] + [("cal", c) for c in CAL]
    r.shuffle(jobs)
    with tempfile.TemporaryDirectory() as tmp:
        for n, (sort, c) in enumerate(jobs, 1):
            if sort == "engine":
                x, y, kind = os.path.join(a.before, c + ".wav"), os.path.join(a.after, c + ".wav"), kinds[c]
                secs = {"oneshot": 3.0, "bed": 8.0, "instrument": 8.0}.get(kind, 24.0); start = 14.0 if kind in ("music", "mix") else 0.0
                good = "after"
            else:
                path, dmg, kind = c
                yy = M.load(os.path.join(a.refs, path), seconds=24.0, skip=0.25 if kind == "music" else 0.0)
                x, y = os.path.join(tmp, f"{n}-d.wav"), os.path.join(tmp, f"{n}-c.wav")
                sf.write(x, DAMAGE[dmg][0](yy).T, M.SR, subtype="FLOAT"); sf.write(y, yy.T, M.SR, subtype="FLOAT")
                secs = 2.0 if kind == "oneshot" else 8.0 if kind == "bed" else 24.0; start = 0.0; good = "clean"
            flip = r.random() < 0.5
            what = {"oneshot": "a short sound effect (a blow, a step, a break)", "bed": "an ambience that goes on (rain, fire, sea)", "instrument": "an instrument played", "music": "game music", "mix": "game music with footsteps and blows over it"}[kind]
            sheet(y if flip else x, x if flip else y, os.path.join(a.out, f"pair-{n:02d}.png"), f"Pair {n}: {what}", secs, start)
            key[f"pair-{n:02d}"] = {"sort": sort, "clip": c if sort == "engine" else f"{c[0]} / {c[1]}", "better": "A" if flip else "B", "why": good}
    json.dump(key, open(os.path.join(a.out, "KEY.json"), "w"), indent=1); print(len(key), "pairs")
