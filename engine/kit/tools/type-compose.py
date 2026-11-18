# Put screens side by side. Usage: python3 tools/type-compose.py <out.png> <top> <bottom> <file> [<file> ...]
# top and bottom are in screenshot pixels; pass 0 0 for the whole height of the shortest.
import sys
from PIL import Image
out, top, bottom, files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
if not bottom: bottom = min(i.size[1] for i in ims)
gap = 24
w = sum(i.size[0] for i in ims) + gap * (len(ims) - 1)
sheet = Image.new('RGB', (w, bottom - top), ims[0].getpixel((2, 2)))
x = 0
for i in ims:
    sheet.paste(i.crop((0, top, i.size[0], min(bottom, i.size[1]))), (x, 0))
    x += i.size[0] + gap
sheet.save(out)
print(out, sheet.size)
