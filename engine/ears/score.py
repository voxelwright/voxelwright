"""The score (#410): each clip's measures against the range well-made audio of its kind lies in.

A measure inside its range costs nothing. Outside, it costs by how far, in widths of the range, up to one whole
width. A clip's score is 100 less the mean cost over the measures that apply to it, less 25 for each hard fault.
The ranges come from the references (~/.village/engine/ears/refs, never in the repo) and are kept in ranges.json,
which is in the repo: the checks need no reference audio.

    uv run python score.py ranges <refs folder>                 # writes ranges.json from measures.json and SOURCES.tsv
    uv run python score.py clips <folder> [--json out.json]     # scores a measured folder; prints the table and the faults
"""
import argparse, csv, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

# What is judged for each kind of clip. Measures not named here are kept in the JSON but cost nothing.
# Which of these stay is decided by validate.py: see KEPT below, written from its results.
TIMBRE = ["tilt", "bass", "mud", "harsh", "air", "sharp", "rough", "beats", "crest", "floor", "flutter"]
APPLIES = {
    "music": ["lufs", "plr", "lra", "width"] + TIMBRE + ["sub", "key_clarity", "pulse", "onsets", "moves", "comes_back", "sameness", "spread_oct", "silent_share"],
    "mix": ["lufs"],  # with `heard` and the hard faults: no recording of a game's whole mix was gathered to read its colour against
    "oneshot": ["plr"] + TIMBRE + ["attack_ms", "len20_ms", "len40_ms", "bright", "bright_fall", "body", "parts", "noisy"],
    "bed": ["plr", "lra"] + TIMBRE + ["events", "swell", "width"],
    "tone": [],
    "instrument": ["plr"] + TIMBRE + ["attack_ms", "len20_ms", "body", "parts", "noisy"],
}
# Level counts for music and mixes only, against what games aim at (ASWG-R001: -24 LUFS at home; music alone may lie
# a little under). A single effect's file is not judged on level: reference effects are assets at full scale, to be
# turned down in a mix, so their level says nothing; whether an effect is heard is judged in the mixes (`heard`).
# A held tone (a horn, a whistle, a motor) is judged for hard faults only: no reference of its kind was gathered.
LEVEL = {"music": (-27.0, -14.0), "mix": (-26.0, -14.0)}

# Hard faults: limits that are not a matter of what references do. [measure, worst allowed, which side, what an ear would say]
HARD = [
    ("clip_ppm", 100, "over", "clipped: samples held flat at the top; it will crackle and sound crushed"),
    ("clicks", 0.1, "over", "clicks: breaks between two samples with the same sound either side (a seam, a voice cut off)"),
    ("dc", 0.08, "over", "lopsided: the wave sits off centre (DC), which eats headroom and thumps when it starts and stops"),
    ("phase", -0.2, "under", "out of phase: left and right cancel; it vanishes on one speaker"),
    ("true_peak", -0.5, "over", "over the ceiling: peaks above -0.5 dBTP will distort on conversion"),
    ("heard_median", 0.0, "under", "buried: events of the world cannot be made out over the music at the moment they happen"),
]
WORDS = {
    "lufs": ("too quiet for its kind: it will be lost or need the volume turned up", "too loud for its kind: it will jump out of the mix"),
    "plr": ("flattened: little between its loudness and its peaks", "spiky: peaks far over its loudness, so it reads quiet and still eats headroom"),
    "lra": ("one level throughout: nothing swells or falls away", "lurches in level: quiet stretches and loud ones far apart"),
    "width": ("narrow: nearly mono, no space left to right", "too wide: mostly difference between the sides, hollow on one speaker"),
    "tilt": ("dark and woolly: it falls away too fast toward the top", "bright and hissy: too much top against its low end, tiring"),
    "sub": ("no weight under 60 Hz", "boomy under 60 Hz"),
    "bass": ("thin: no low end (60 to 250 Hz), no warmth or weight", "bass-heavy: the low end crowds everything else"),
    "mud": ("hollow in the low mids (250 to 500 Hz)", "muddy: too much at 250 to 500 Hz, boxy and clouded"),
    "harsh": ("recessed at 2 to 5 kHz: nothing cuts through", "harsh: too much at 2 to 5 kHz, where the ear is most tender"),
    "air": ("closed in: nothing above 8 kHz, as through a blanket", "hissy: too much above 8 kHz; a bed like this reads as white noise"),
    "sharp": ("dull: no edge or sparkle", "sharp: piercing, the top dominates"),
    "rough": ("glassy: no grain at all in the sound", "rough: it grates and buzzes (partials crowded together, or a harsh wave)"),
    "beats": ("", "beating: slow wobble between partials, as of strings out of tune with each other"),
    "crest": ("squashed: blows do not stand out of the body", "all spikes: clicks with nothing sustaining under them"),
    "floor": ("noisy or smeared: nothing clean between its partials", "sterile: dead black between partials; no room, no body, no breath: a test tone"),
    "flutter": ("frozen: its partials hold dead still while they sound, like a bare oscillator", "unsteady: its partials flutter more than any played thing"),
    "events": ("featureless: a steady hiss with nothing happening in it", "crackly: isolated spikes stand far out of the bed"),
    "swell": ("static: its loudness never moves", "pumping: its loudness heaves"),
    "attack_ms": ("clicky: it begins faster than a real thing does", "soft-fronted: no attack, it fades in"),
    "len20_ms": ("too short: a tick with no body after it", "rings on too long for what it is"),
    "len40_ms": ("no tail: it stops dead, with no decay or space after it", "its tail hangs on too long"),
    "bright": ("dull at the moment it is struck", "all top at the moment it is struck: a click or a spit"),
    "bright_fall": ("its tone does not darken as it dies, as struck things do", "it loses its top at once"),
    "body": ("no body: nothing under 250 Hz, so no weight to the blow", "all thump: only low end"),
    "parts": ("bare: too few partials ring; a beep", "cluttered: a wash of partials, noise-like"),
    "noisy": ("too pure: a bare tone with no grit of contact in it", "too noisy: a burst of hiss with no pitch or body"),
    "key_clarity": ("no tonal centre: the notes do not agree on a key", "locked to one chord: so plainly one key that nothing happens harmonically"),
    "pulse": ("no pulse: onsets do not come round at any pace", "mechanical: every onset on a rigid grid"),
    "onsets": ("almost nothing is played: long held notes with few beginnings", "frantic: too many notes a second"),
    "moves": ("a drone: the sound barely changes from one moment to the next", "restless: its colour changes all the time"),
    "comes_back": ("never returns to anything: no motif or pattern to hold on to", "loops: the same few seconds again and again"),
    "sameness": ("disjointed: its moments have nothing in common", "monotonous: every moment like every other"),
    "spread_oct": ("cramped register: everything sits in one narrow band of pitch", "scattered across registers with nothing in the middle"),
    "silent_share": ("", "full of holes: long stretches of silence inside the piece"),
    "people": ("listeners would rate it under well-made music (a fit of pulse, return, key, balance and motion to 413 expert-rated clips)", ""),
}


def group_of(name, kind, cat=""):
    """Which references a clip is read against."""
    if kind != "oneshot":
        return "mix" if kind == "mix" else kind
    n = (cat or name).lower()
    if "step" in n: return "step"
    if any(w in n for w in ("break", "smash", "splash", "cheer")): return "break"
    if any(w in n for w in ("explosion", "blast", "gunshot", "cannon", "shot")): return "blast"
    if any(w in n for w in ("impact", "hit-", "bell", "clang", "knock", "drum")): return "impact"
    return "oneshot"


def ranges_from(refs):
    rows = json.load(open(os.path.join(refs, "measures.json")))
    if os.path.exists(os.path.join(HERE, "people-model.json")):
        import people
        for m in rows.values():
            if m.get("kind") == "music" and "pulse" in m: m["people"] = round(people.predict(m), 2)
    cats = {r["path"]: r["kind"] for r in csv.DictReader(open(os.path.join(refs, "SOURCES.tsv")), delimiter="\t")}
    groups = {}
    for name, m in rows.items():
        if "error" in m: continue
        gs = [group_of(name, m["kind"], cats.get(name, ""))]
        if m["kind"] == "oneshot" and gs[0] != "oneshot": gs.append("oneshot")
        if m["kind"] == "music": gs += ["mix"]
        if m["kind"] == "instrument": gs += ["tone"]
        for g in gs: groups.setdefault(g, []).append(m)
    out = {}
    for g, ms in groups.items():
        out[g] = {"n": len(ms)}
        for k in sorted({k for m in ms for k in m if k != "kind"}):
            v = np.array([m[k] for m in ms if k in m and isinstance(m[k], (int, float))], dtype=float)
            if len(v) < 3: continue
            lo, hi = (np.percentile(v, 5), np.percentile(v, 95)) if len(v) >= 8 else (v.min(), v.max())
            out[g][k] = [round(float(lo), 4), round(float(hi), 4), round(float(np.median(v)), 4)]
    return out


def kept():
    p = os.path.join(HERE, "kept.json")
    return json.load(open(p)) if os.path.exists(p) else None


AS = {"tone": "instrument", "mix": "music"}


def score_clip(name, m, ranges, keep=None, group=None):
    """keep: kept.json's content, or None to judge every measure that applies."""
    kind = m["kind"]
    g = group or group_of(name, kind)
    R = ranges.get(g) or ranges["oneshot"]
    costs, faults, notes, used = {}, [], [], []
    m = dict(m)
    if kind == "music" and "pulse" in m:  # fitted to music alone: a mix with rain and blasts over it is not what was rated
        import people
        m["people"] = round(people.predict(m), 2)
    for k in APPLIES.get(kind, []) + (["people"] if "people" in m else []):
        if k not in m or k not in R: continue
        counts = keep is None or k == "people" or AS.get(kind, kind) in keep["kept"].get(k, {}).get("for", [])
        advises = keep is not None and AS.get(kind, kind) in keep["advisory"].get(k, {}).get("for", [])
        if not counts and not advises: continue
        lo, hi, med = R[k]
        if k == "lufs": lo, hi = LEVEL[kind]
        if k == "people": hi = 5.0
        if counts: used.append(k)
        w = max(hi - lo, 1e-6)
        x = m[k]
        c = (lo - x) / w if x < lo else (x - hi) / w if x > hi else 0.0
        if c > 0:
            word = WORDS.get(k, ("low", "high"))[0 if x < lo else 1]
            line = f"{word or k} ({k} {x:.2f}; well-made {g} lies in {lo:.2f} to {hi:.2f})"
            if counts:
                costs[k] = min(1.0, c); faults.append((min(1.0, c), line))
            elif word: notes.append(line)
    hard = []
    for k, limit, side, word in HARD:
        if keep is not None and k not in keep["hard"]: continue
        if k in m and ((side == "over" and m[k] > limit) or (side == "under" and m[k] < limit)):
            hard.append(f"{word} ({k} {m[k]:.2f}, limit {limit})")
    s = 100 * (1 - sum(costs.values()) / max(1, len(used))) - 25 * len(hard)
    return {"score": round(max(0.0, s), 1), "group": g, "out": len(costs), "of": len(used), "hard": hard, "faults": [f for _, f in sorted(faults, reverse=True)], "notes": notes, "costs": costs, "people": m.get("people")}


def score_folder(folder, ranges=None, keep="file"):
    ranges = ranges or json.load(open(os.path.join(HERE, "ranges.json")))
    keep = kept() if keep == "file" else keep
    rows = json.load(open(os.path.join(folder, "measures.json")))
    return {n: score_clip(n, m, ranges, keep) for n, m in rows.items() if "error" not in m}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    a1 = sub.add_parser("ranges"); a1.add_argument("refs")
    a2 = sub.add_parser("clips"); a2.add_argument("folder"); a2.add_argument("--json"); a2.add_argument("--faults", type=int, default=3)
    a = ap.parse_args()
    if a.cmd == "ranges":
        r = ranges_from(a.refs)
        json.dump(r, open(os.path.join(HERE, "ranges.json"), "w"), indent=1)
        print({g: v["n"] for g, v in r.items()})
    else:
        got = score_folder(a.folder)
        for n, s in got.items():
            print(f"{s['score']:5.1f}  {n:26s} {s['group']:10s} out {s['out']:2d}/{s['of']:2d}" + (f"  people {s['people']:.2f}" if s["people"] else "") + (f"  HARD {len(s['hard'])}" if s["hard"] else ""))
            for f in (s["hard"] + s["faults"])[: a.faults]: print(f"         - {f}")
            for f in s["notes"][: max(0, a.faults - len(s["hard"]) - len(s["faults"]))]: print(f"         . {f}")
        sc = [s["score"] for s in got.values()]
        print(f"mean {np.mean(sc):.1f}  worst {np.min(sc):.1f}  clips with nothing wrong {sum(1 for s in got.values() if not s['out'] and not s['hard'])}/{len(sc)}")
        if a.json: json.dump(got, open(a.json, "w"), indent=1)
