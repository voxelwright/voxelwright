# Cut a region out of a screenshot, optionally enlarged with hard pixels. Usage: type-crop.py in out x y w h [zoom]
import sys
from PIL import Image
i, o, x, y, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
z = int(sys.argv[7]) if len(sys.argv) > 7 else 1
im = Image.open(i).crop((x, y, x + w, y + h))
if z > 1: im = im.resize((w * z, h * z), Image.NEAREST)
im.save(o); print(o, im.size)
