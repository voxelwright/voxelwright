"""Contact sheets of the far view's checks (#450): each view of one or more runs of sf/far/check.mjs side by side,
with what each costs written under it, and the park beside the photograph.

    $PY engine/sf/far/sheet.py <out.jpg> <run> [<run> ...] [--views park,downtown,pyramid,street] [--photo]
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

SHOTS = os.path.expanduser('~/.village/engine/sf/far/shots')
PHOTO = os.path.expanduser('~/.village/engine/landing/ina/ref/ina-full.jpg')
WIDE = 960


def font(size):
    for path in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    out, runs = sys.argv[1], [a for i, a in enumerate(sys.argv[2:], 2) if not a.startswith('--') and sys.argv[i - 1] != '--views']
    views = arg('--views', 'park,downtown,pyramid,street').split(',')
    cells = []
    for view in views:
        row = []
        if view == 'park' and '--photo' in sys.argv:
            row.append((Image.open(PHOTO).convert('RGB'), 'The photograph (Frank Schulenburg, CC BY-SA 4.0)'))
        for run in runs:
            path = f'{SHOTS}/{run}-{view}.png'
            if not os.path.exists(path):
                continue
            said = json.load(open(f'{SHOTS}/{run}.json')).get(view, {})
            text = f"{run} {view}: far {said.get('faces', 0) / 1e6:.2f}M faces, {said.get('heldMB', 0)} MB held; march {said.get('march', 0):.1f} ms, +far {said.get('farMs', 0):.1f} ms at {said.get('size', [0, 0])[0]}x{said.get('size', [0, 0])[1]}"
            measured = f'{SHOTS}/{run}-{view}-measure.json'
            if os.path.exists(measured):
                s = json.load(open(measured))['skyline']
                text += f"; skyline {s['median']} / {s['p90']} px"
            row.append((Image.open(path).convert('RGB'), text))
        if row:
            cells.append(row)
    cols = max(len(r) for r in cells)
    tiles = []
    for r in cells:
        line = []
        for im, text in r:
            h = round(im.height * WIDE / im.width)
            line.append((im.resize((WIDE, h), Image.LANCZOS), text))
        tiles.append(line)
    heights = [max(im.height for im, _ in line) + 34 for line in tiles]
    sheet = Image.new('RGB', (cols * WIDE + (cols - 1) * 8, sum(heights) + 8 * (len(tiles) - 1)), (18, 18, 20))
    draw, f, y = ImageDraw.Draw(sheet), font(15), 0
    for line, h in zip(tiles, heights):
        for c, (im, text) in enumerate(line):
            x = c * (WIDE + 8)
            sheet.paste(im, (x, y))
            draw.text((x + 6, y + im.height + 8), text, fill=(230, 230, 230), font=f)
        y += h + 8
    sheet.save(out, quality=88)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
