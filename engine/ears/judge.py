"""Measures every clip of a folder (#410) and keeps them as JSON beside it.

    uv run python judge.py measure <folder> [--kind music] [--out measures.json]

A folder made by bench.mjs has a manifest (names, kinds, event times, stems). Any other folder is measured file by
file, the kind taken from --kind or from the name of the folder a file is in (music, sfx, beds, instruments).
"""
import argparse, json, os, sys, time
from concurrent.futures import ProcessPoolExecutor
import measures as M

KINDS = {"music": "music", "sfx": "oneshot", "beds": "bed", "instruments": "instrument"}
AUDIO = (".wav", ".ogg", ".flac", ".mp3", ".aif", ".aiff")


def one(job):
    path, kind, marks, stems = job
    try:
        return path, M.measure(path, kind, marks, stems)
    except Exception as e:  # a file that cannot be read is said, not hidden
        return path, {"error": f"{type(e).__name__}: {e}"}


def jobs(folder, kind=None):
    man = os.path.join(folder, "manifest.json")
    if os.path.exists(man):
        for row in json.load(open(man)):
            p = os.path.join(folder, row["name"] + ".wav")
            stems = [p.replace(".wav", ".world.wav"), p.replace(".wav", ".music.wav")] if row["kind"] == "mix" else None
            yield row["name"], (p, row["kind"], row.get("marks"), stems)
        return
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f.lower().endswith(AUDIO):
                k = kind or KINDS.get(os.path.relpath(root, folder).split(os.sep)[0], "music")
                yield os.path.relpath(os.path.join(root, f), folder), (os.path.join(root, f), k, None, None)


def measure_folder(folder, kind=None, out=None, workers=6):
    todo = list(jobs(folder, kind))
    t0 = time.time()
    with ProcessPoolExecutor(workers) as ex:
        got = list(ex.map(one, [j for _, j in todo]))
    rows = {name: {"kind": j[1], **res} for (name, j), (_, res) in zip(todo, got)}
    out = out or os.path.join(folder, "measures.json")
    json.dump(rows, open(out, "w"), indent=1)
    bad = [n for n, r in rows.items() if "error" in r]
    print(f"{len(rows)} clips measured in {time.time() - t0:.0f} s -> {out}" + (f"; could not read: {bad}" if bad else ""))
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("measure"); m.add_argument("folder"); m.add_argument("--kind"); m.add_argument("--out")
    a = ap.parse_args()
    if a.cmd == "measure":
        measure_folder(a.folder, a.kind, a.out)
