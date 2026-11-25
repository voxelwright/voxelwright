"""What people would say (#410): a fit of the measures to human ratings of music (MusicEval: 2,748 clips of
generated and real music rated 1 to 5 for overall quality by 14 experts; the public test split's 413 are used).

Only measures that do not depend on level, bandwidth or stereo are used, because the rated clips are 16 kHz mono
and the engine's are not. The fit is ridge regression on each measure and its square; its agreement with people is
measured on clips it was not fitted on.

    uv run python people.py fit <rated folder>      # writes people-model.json; prints the cross-validated agreement
    predict(measures) -> a rating from 1 to 5
"""
import csv, json, os, sys
import numpy as np
import scipy.stats as st

from score import MUSICEVAL
USE = ["pulse", "comes_back", "sameness", "key_clarity", "key_holds", "harmony_moves", "moves", "onsets", "bass", "sub", "mud", "mid", "harsh", "tilt", "spread_oct", "flutter", "floor", "lra", "swell", "crest", "rough", "beats", "events"]


def design(rows, names, model=None):
    X = np.array([[rows[n].get(k, np.nan) for k in USE] for n in names], dtype=float)
    med = np.array(model["median"]) if model else np.nanmedian(X, axis=0)
    X = np.where(np.isfinite(X), X, med)
    lo, hi = (np.array(model["lo"]), np.array(model["hi"])) if model else (np.percentile(X, 1, axis=0), np.percentile(X, 99, axis=0))
    X = np.clip(X, lo, hi)  # nothing is read further out than the rated clips went
    X = np.hstack([X, X ** 2])
    mu, sd = (np.array(model["mu"]), np.array(model["sd"])) if model else (X.mean(axis=0), X.std(axis=0) + 1e-9)
    return (X - mu) / sd, {"median": med.tolist(), "lo": lo.tolist(), "hi": hi.tolist(), "mu": mu.tolist(), "sd": sd.tolist()}


def ridge(X, y, lam=30.0):
    return np.linalg.solve(X.T @ X + lam * np.eye(X.shape[1]), X.T @ (y - y.mean()))


def fit(folder):
    rows = json.load(open(os.path.join(folder, "measures.json")))
    human = {r["file"]: float(r["overall"]) for r in csv.DictReader(open(os.path.join(folder, "scores.csv")))}
    names = [n for n in rows if n in human and "error" not in rows[n]]
    y = np.array([human[n] for n in names])
    idx = np.random.default_rng(1).permutation(len(y)); pred = np.zeros(len(y))
    for f in range(5):
        te = idx[f::5]; tr = np.setdiff1d(idx, te)
        Xtr, m = design(rows, [names[i] for i in tr]); Xte, _ = design(rows, [names[i] for i in te], m)
        pred[te] = Xte @ ridge(Xtr, y[tr]) + y[tr].mean()
    rho = st.spearmanr(pred, y)[0]; r = np.corrcoef(pred, y)[0, 1]
    X, m = design(rows, names)
    m.update({"use": USE, "w": ridge(X, y).tolist(), "mean": float(y.mean()), "n": len(y), "cv_spearman": round(float(rho), 3), "cv_pearson": round(float(r), 3), "fitted_on": "MusicEval test split (BAAI/MusicEval, CC BY-NC 4.0), overall quality"})
    MUSICEVAL.mkdir(parents=True, exist_ok=True)
    json.dump(m, open(MUSICEVAL / "people-model.json", "w"))
    print(f"{len(y)} clips; on clips it was not fitted on: Spearman {rho:.3f}, Pearson {r:.3f}")


_model = None
def predict(m):
    global _model
    _model = _model or json.load(open(MUSICEVAL / "people-model.json"))
    X, _ = design({"x": m}, ["x"], _model)
    return float(np.clip(X[0] @ np.array(_model["w"]) + _model["mean"], 1, 5))


if __name__ == "__main__":
    if sys.argv[1] == "fit": fit(sys.argv[2])
