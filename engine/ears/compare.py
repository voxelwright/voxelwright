"""Before against after (#410): python compare.py <before folder> <after folder>. Each clip's score and what is out."""
import json, sys, os
a, b = (json.load(open(os.path.join(f, "score.json"))) for f in sys.argv[1:3])
ma, mb = (json.load(open(os.path.join(f, "measures.json"))) for f in sys.argv[1:3])
for n in b:
    x, y = a.get(n, {"score": 0, "costs": {}, "hard": []}), b[n]
    show = lambda s, m: " ".join(f"{k}={m[n].get(k, s.get('people') or 0):.1f}" for k in s["costs"]) + ("  HARD " + "; ".join(h.split(":")[0] for h in s["hard"]) if s["hard"] else "")
    mark = "  " if y["score"] >= x["score"] - 0.05 else "!!"
    print(f"{mark}{n:24s} {x['score']:5.1f} -> {y['score']:5.1f}   {show(y, mb) or 'nothing out'}")
ok = lambda s: sum(1 for v in s.values() if not v["out"] and not v["hard"])
mean = lambda s: sum(v["score"] for v in s.values()) / len(s)
print(f"mean {mean(a):.1f} -> {mean(b):.1f}; clean {ok(a)} -> {ok(b)} of {len(b)}; worse: {sum(1 for n in b if n in a and b[n]['score'] < a[n]['score'] - 0.05)}")
