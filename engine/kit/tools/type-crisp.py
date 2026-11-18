# Score the probes: of the pixels that are mostly ink, what share is solid ink. 100 means every edge lands on a
# pixel. The faint fringe macOS adds beside every stroke (lighter than 67% grey) is left out: it is the same for all.
import sys, glob, os
from PIL import Image
rows = {}
for f in sorted(glob.glob('shots/type/probe/*.png')):
    face, size = os.path.basename(f)[:-4].rsplit('-', 1)
    px = Image.open(f).convert('L').getdata()
    ink = sum(1 for v in px if v < 170); hard = sum(1 for v in px if v < 40)
    rows.setdefault(face, {})[int(size)] = round(100 * hard / max(1, ink))
sizes = sorted({s for r in rows.values() for s in r})
print('face'.ljust(12), *[str(s).rjust(4) for s in sizes])
for face, r in rows.items(): print(face.ljust(12), *[str(r.get(s, '')).rjust(4) for s in sizes])
