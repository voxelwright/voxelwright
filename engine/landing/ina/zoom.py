"""A gridded crop of a picture, for reading where a point falls (#423). Places are said at the photograph's width of
2000 pixels, whatever the picture's own size, so the full-size original and a render can be read on one scale.

    python zoom.py <picture> <x0,y0,x1,y1> <out.png> [--grid 10] [--times 3]
"""
import sys
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None


def crop(path, box, out, grid=10, times=3.0):
    im = Image.open(path).convert('RGB')
    k = im.size[0] / 2000.0
    x0, y0, x1, y1 = box
    part = im.crop((round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))).resize((round((x1 - x0) * times), round((y1 - y0) * times)), Image.LANCZOS)
    d = ImageDraw.Draw(part)
    first = lambda v: (int(v) // grid + (1 if v % grid else 0)) * grid
    for x in range(first(x0), int(x1) + 1, grid):
        strong = x % (grid * 5) == 0
        d.line(((x - x0) * times, 0, (x - x0) * times, part.size[1]), fill=(255, 246, 0) if strong else (255, 255, 255), width=1)
        if strong:
            d.text(((x - x0) * times + 2, 2), str(x), fill=(255, 246, 0))
    for y in range(first(y0), int(y1) + 1, grid):
        strong = y % (grid * 5) == 0
        d.line((0, (y - y0) * times, part.size[0], (y - y0) * times), fill=(255, 246, 0) if strong else (255, 255, 255), width=1)
        if strong:
            d.text((2, (y - y0) * times + 2), str(y), fill=(255, 246, 0))
    part.save(out)


if __name__ == '__main__':
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    crop(sys.argv[1], [float(v) for v in sys.argv[2].split(',')], sys.argv[3], int(arg('--grid', 10)), float(arg('--times', 3)))
