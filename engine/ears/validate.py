"""Proving the judge before trusting it (#410). Rules, fixed before any number was read:

  1. A hard-fault measure is kept if its own damage trips its limit on at least 90% of damaged clips and clean
     references trip it on at most 5%.
  2. A timbre or music measure is kept if (a) the damage that should move it moves it the right way, by at least a
     quarter of the width of its reference range, on at least 70% of damaged clips, or (b) it agrees with people:
     Spearman |rho| >= 0.2 against human ratings of quality on a public set, with p < 0.01.
  3. A measure that only tells today's engine from the references, and does neither, is a detector of where a
     sound came from and is dropped.
  4. Cross-talk is reported: for each damage, every other measure that moved as far.

    uv run python validate.py damage <refs> [--out damage.json]
    uv run python validate.py people <rated folder with measures.json and scores.csv> [--aes aes.json]
"""
import argparse, csv, json, os, sys, tempfile
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import soundfile as sf
import scipy.stats as st
import measures as M
import score as S
from damage import DAMAGE

HERE = os.path.dirname(os.path.abspath(__file__))


def pick(refs, kind, n):
    rows = json.load(open(os.path.join(refs, "measures.json")))
    names = sorted(k for k, v in rows.items() if v["kind"] == kind and "error" not in v)
    step = max(1, len(names) // n)
    return names[::step][:n]


def one(job):
    refs, name, kind, group, damages = job
    y = M.load(os.path.join(refs, name), seconds=24.0, skip=0.25 if kind == "music" else 0.0)
    out = {}
    with tempfile.TemporaryDirectory() as d:
        def run(yy, tag):
            p = os.path.join(d, tag + ".wav")
            sf.write(p, yy.T, M.SR, subtype="FLOAT")
            return M.measure(p, kind, skip=0.0)
        out["clean"] = run(y, "clean")
        for dn in damages:
            try:
                out[dn] = run(DAMAGE[dn][0](y), dn)
            except Exception as e:
                out[dn] = {"error": str(e)[:100]}
    return name, kind, group, out


def damage(refs, out):
    ranges = S.ranges_from(refs)
    cats = {r["path"]: r["kind"] for r in csv.DictReader(open(os.path.join(refs, "SOURCES.tsv")), delimiter="\t")}
    jobs = []
    for kind, n in (("music", 12), ("oneshot", 24), ("bed", 8), ("instrument", 6)):
        for name in pick(refs, kind, n):
            ds = [d for d, (_, _, on) in DAMAGE.items() if on == "all" or on == kind or (on == "long" and kind in ("music", "bed"))]
            jobs.append((refs, name, kind, S.group_of(name, kind, cats.get(name, "")), ds))
    with ProcessPoolExecutor(6) as ex:
        got = list(ex.map(one, jobs))
    hard = {k: (lim, side) for k, lim, side, _ in S.HARD}
    table = {}
    for dn, kd in [(d, k) for d in DAMAGE for k in ("music", "oneshot", "bed", "instrument")]:
        targets = DAMAGE[dn][1]
        moved, way, n = {}, {}, 0
        for name, kind, group, res in got:
            if kind != kd or dn not in res or "error" in res[dn]: continue
            n += 1
            R = ranges.get(group) or ranges["oneshot"]
            for k, v in res[dn].items():
                c = res["clean"].get(k)
                if not isinstance(v, (int, float)) or c is None: continue
                if k in hard:
                    lim, side = hard[k]
                    trip = v > lim if side == "over" else v < lim
                    was = c > lim if side == "over" else c < lim
                    if trip and not was: moved.setdefault(k, []).append(1.0)
                elif k in R:
                    if k in targets and abs(v - c) > 1e-9: way.setdefault(k, []).append(float(np.sign(v - c)))
                    w = max(R[k][1] - R[k][0], 1e-6)
                    if abs(v - c) / w >= 0.25: moved.setdefault(k, []).append(float(np.sign(v - c)))
        row = {"n": n, "targets": {}, "others": {}}
        for k, signs in moved.items():
            share = len(signs) / max(1, n)
            one_way = abs(np.mean(signs))
            (row["targets"] if k in targets else row["others"])[k] = [round(share, 2), round(float(np.mean(signs)), 2)]
        if not n: continue
        for k in targets: row["targets"].setdefault(k, [0.0, 0.0])
        # Whichever way most went: the share of damaged clips that went that way at all, however little.
        row["way"] = {k: round(max(s.count(1.0), s.count(-1.0)) / n, 2) for k, s in way.items()}
        table[f"{dn}/{kd}"] = row
    # Clean references that trip a hard limit.
    clean = {k: float(np.mean([(res["clean"].get(k, 0) > lim) if side == "over" else (res["clean"].get(k, 1) < lim) for _, _, _, res in got])) for k, (lim, side) in hard.items() if k != "heard_share"}
    json.dump({"damage": table, "clean_trips": clean}, open(out, "w"), indent=1)
    print(f"{'damage/kind':22s} {'n':>3s}  target measures: share moved (direction)        others that moved on >= 50%")
    for dn, row in table.items():
        t = "  ".join(f"{k} {v[0]:.0%} ({v[1]:+.1f}; any {row['way'].get(k, v[0]):.0%})" for k, v in row["targets"].items())
        o = ", ".join(f"{k} {v[0]:.0%}" for k, v in sorted(row["others"].items(), key=lambda kv: -kv[1][0]) if v[0] >= 0.5)
        print(f"{dn:22s} {row['n']:3d}  {t:52s} {o}")
    print("clean references tripping a hard limit:", {k: f"{v:.0%}" for k, v in clean.items()})


def people(folder, aes=None):
    rows = json.load(open(os.path.join(folder, "measures.json")))
    human = {r["file"]: float(r["overall"]) for r in csv.DictReader(open(os.path.join(folder, "scores.csv")))}
    names = [n for n in rows if n in human and "error" not in rows[n]]
    y = np.array([human[n] for n in names])
    out = {}
    keys = sorted({k for n in names for k in rows[n] if k != "kind"})
    for k in keys:
        x = np.array([rows[n].get(k, np.nan) for n in names], dtype=float)
        ok = np.isfinite(x)
        if ok.sum() < 50 or np.std(x[ok]) == 0: continue
        rho, p = st.spearmanr(x[ok], y[ok])
        # People may like the middle best: also how far it is from the value the best-rated third has.
        mid = np.median(x[ok][y[ok] >= np.percentile(y[ok], 67)])
        rho2, p2 = st.spearmanr(-np.abs(x[ok] - mid), y[ok])
        out[k] = {"rho": round(float(rho), 3), "p": float(p), "rho_from_best": round(float(rho2), 3), "p_from_best": float(p2), "best_third_median": round(float(mid), 3)}
    if aes:
        A = json.load(open(aes))
        for ax in ("PQ", "PC", "CE", "CU"):
            x = np.array([A.get(n, {}).get(ax, np.nan) for n in names], dtype=float); ok = np.isfinite(x)
            if ok.sum() > 50:
                rho, p = st.spearmanr(x[ok], y[ok]); out["audiobox_" + ax] = {"rho": round(float(rho), 3), "p": float(p)}
    # All the measures together, by ridge regression, scored on clips it was not fitted on (5 folds).
    use = [k for k in keys if k in out and not k.startswith("audiobox")]
    X = np.array([[rows[n].get(k, np.nan) for k in use] for n in names], dtype=float)
    X = np.where(np.isfinite(X), X, np.nanmedian(X, axis=0))
    X = np.hstack([X, X ** 2])
    X = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-9)
    idx = np.random.default_rng(1).permutation(len(y)); pred = np.zeros(len(y))
    for f in range(5):
        te = idx[f::5]; tr = np.setdiff1d(idx, te)
        w = np.linalg.solve(X[tr].T @ X[tr] + 30 * np.eye(X.shape[1]), X[tr].T @ (y[tr] - y[tr].mean()))
        pred[te] = X[te] @ w + y[tr].mean()
    rho, p = st.spearmanr(pred, y)
    out["all_measures_ridge_cv"] = {"rho": round(float(rho), 3), "p": float(p), "pearson": round(float(np.corrcoef(pred, y)[0, 1]), 3)}
    json.dump(out, open(os.path.join(folder, "people.json"), "w"), indent=1)
    print(f"{len(names)} rated clips")
    for k, v in sorted(out.items(), key=lambda kv: -max(abs(kv[1]["rho"]), abs(kv[1].get("rho_from_best", 0)))):
        print(f"  {k:24s} rho {v['rho']:+.3f} (p {v['p']:.1e})" + (f"   distance from the best third's value: {v['rho_from_best']:+.3f}" if "rho_from_best" in v else ""))


def bury(refs):
    """Effects laid over music at falling levels: does `heard` say when they can no longer be made out?"""
    music = [os.path.join(refs, n) for n in pick(refs, "music", 6)]
    sfx = [os.path.join(refs, n) for n in pick(refs, "oneshot", 12)]
    out = {}
    for rel in (0, -10, -20, -30, -40, -50):
        got = []
        for mp in music:
            m = M.normalise(M.load(mp, seconds=14, skip=0.3), -20).mean(axis=0)
            w = np.zeros_like(m); marks = []
            for i, sp in enumerate(sfx):
                s = M.load(sp, seconds=1.0).mean(axis=0)
                s = s / (np.sqrt(np.mean(s[: int(0.12 * M.SR)] ** 2)) + 1e-9) * np.sqrt(np.mean(m ** 2)) * 10 ** (rel / 20)
                at = int((1 + i) * M.SR); w[at : at + len(s)] += s[: len(w) - at]; marks.append((1 + i))
            got += M.audible(w, m, marks)
        out[rel] = {"heard_median": round(float(np.median(got)), 1), "heard_share": round(float(np.mean(np.array(got) > -5)), 2)}
        print(f"  effect {rel:+3d} dB against the music at that moment: third-best band stands {out[rel]['heard_median']:+6.1f} dB over it; counted as heard {out[rel]['heard_share']:.0%}")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    a1 = sub.add_parser("damage"); a1.add_argument("refs"); a1.add_argument("--out", default=os.path.join(HERE, "damage.json"))
    a2 = sub.add_parser("people"); a2.add_argument("folder"); a2.add_argument("--aes")
    a3 = sub.add_parser("bury"); a3.add_argument("refs")
    a = ap.parse_args()
    damage(a.refs, a.out) if a.cmd == "damage" else bury(a.refs) if a.cmd == "bury" else people(a.folder, a.aes)
