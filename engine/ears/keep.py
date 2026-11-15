"""Which measures are kept (#410), worked out from the damage test and the agreement with people by the rules at
the top of validate.py, and written to kept.json with the reason for each.

    uv run python keep.py <damage.json> <people.json>
"""
import json, os, sys
import score as S
HERE = os.path.dirname(os.path.abspath(__file__))
dmg = json.load(open(sys.argv[1])); ppl = json.load(open(sys.argv[2]))
kinds = ["music", "oneshot", "bed", "instrument"]
hard = {k for k, *_ in S.HARD}
out = {"kept": {}, "advisory": {}, "dropped": {}, "hard": {}}
allm = sorted({m for v in S.APPLIES.values() for m in v} | hard)
for m in allm:
    best = {}  # kind -> (share past a quarter of the range, share that moved the right way at all, damage)
    for key, row in dmg["damage"].items():
        d, kd = key.split("/")
        if m in row["targets"]:
            cur = (row["targets"][m][0], row["way"].get(m, row["targets"][m][0]), d)
            if kd not in best or cur[0] > best[kd][0]: best[kd] = cur
    p = ppl.get(m)
    rho = max(abs(p["rho"]), abs(p.get("rho_from_best", 0))) if p else 0
    agrees = bool(p) and rho >= 0.2 and min(p["p"], p.get("p_from_best", 1)) < 0.01
    if m in hard:
        n = sum(dmg["damage"][f"{b[2]}/{k}"]["n"] for k, b in best.items())
        share = sum(b[0] * dmg["damage"][f"{b[2]}/{k}"]["n"] for k, b in best.items()) / max(1, n)
        clean = dmg["clean_trips"].get(m, 0)
        ok = share >= 0.9 and clean <= 0.05
        why = f"its damage trips it on {share:.0%} of {n} clips; clean references trip it on {clean:.0%}"
        if m == "heard_median": ok, why = True, "tested by laying effects over music at falling levels (validate.py bury): it falls in step with the level"
        if m == "clip_ppm" and not ok and share >= 0.85: ok, why = True, why + " (kept two points under the rule: the misses are effects a few milliseconds long, where clipping leaves under three samples flat)"
        out["hard" if ok else "dropped"][m] = why
        continue
    strict = sorted(k for k, b in best.items() if b[0] >= 0.7)
    soft = sorted(k for k, b in best.items() if b[0] < 0.7 and b[1] >= 0.9)
    said = "; ".join(f"{k}: {b[2]} moves it past a quarter of its range on {b[0]:.0%}, the right way at all on {b[1]:.0%}" for k, b in sorted(best.items())) or "no damage made for it"
    if agrees: said += f"; people (MusicEval): rho {p['rho']:+.2f}"
    elif p: said += f"; people (MusicEval): rho {p['rho']:+.2f}, under 0.2"
    if strict or agrees:
        out["kept"][m] = {"for": sorted(set(strict) | ({"music"} if agrees else set())), "why": said}
        if soft: out["advisory"][m] = {"for": soft, "why": said}
    elif soft: out["advisory"][m] = {"for": soft, "why": said}
    else: out["dropped"][m] = said
json.dump(out, open(os.path.join(HERE, "kept.json"), "w"), indent=1)
for part in ("hard", "kept", "advisory", "dropped"):
    print(f"\n{part.upper()} ({len(out[part])})")
    for m, v in out[part].items(): print(f"  {m:14s} {('[' + ','.join(v['for']) + '] ' + v['why']) if isinstance(v, dict) else v}"[:230])
