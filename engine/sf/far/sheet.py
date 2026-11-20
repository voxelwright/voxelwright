"""Contact sheets of the far view's checks (#450): each view of one or more runs of sf/far/check.mjs side by side,
with what each costs written under it; or `--parity`, the park against the photograph and the landing.

    $PY engine/sf/far/sheet.py <out.jpg> <run> [<run> ...] [--views park,downtown,pyramid,street] [--photo]
    $PY engine/sf/far/sheet.py <out.jpg> --parity <with> <without>    the photograph, the landing (#423 round r12),
        the realm with and without the far model, and the landing and the realm over the photograph, with their skylines
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


def parity(out, run, cells_only):
    """The park: the photograph, the landing, the realm with the far model and with cells only, and two overlays."""
    lane = os.path.expanduser('~/.village/engine/landing/ina')
    here = os.path.dirname(os.path.abspath(__file__))
    landing = f'{SHOTS}/landing-park-measure.json'
    if not os.path.exists(landing):
        import subprocess
        subprocess.run([sys.executable, '-B', '-W', 'ignore', f'{here}/measure.py', f'{lane}/shots/r12-ids.rgba', '2018x864', '--leave', '1400,0,2000,130', '--json', landing, '--picture', f'{lane}/shots/r12-full.png', '--out', f'{SHOTS}/landing-park-overlay.jpg'], check=True, capture_output=True)
    m = lambda n: json.load(open(f'{SHOTS}/{n}-park-measure.json'))['skyline']
    crop = lambda p: Image.open(p).convert('RGB').crop((17, 0, 2017, 862))
    said = lambda n, what: f"{what}. Skyline {m(n)['median']} / {m(n)['p90']} px"
    cells = [(Image.open(PHOTO).convert('RGB').resize((2000, 862)), 'The photograph (Frank Schulenburg, CC BY-SA 4.0)'),
             (crop(f'{lane}/shots/r12-full.png'), said('landing', 'The landing today: ?place=ina, PR 433 round r12')),
             (crop(f'{SHOTS}/{run}-park.png'), said(run, 'The SF realm with the far model')),
             (crop(f'{SHOTS}/{cells_only}-park.png'), said(cells_only, 'The SF realm without it (cells only)')),
             (Image.open(f'{SHOTS}/landing-park-overlay.jpg').convert('RGB'), 'The landing over the photograph (yellow: its skyline, pink: ours)'),
             (Image.open(f'{SHOTS}/{run}-park-overlay.jpg').convert('RGB'), 'The realm over the photograph')]
    w, h = 1000, 431
    sheet = Image.new('RGB', (2 * w + 10, 3 * (h + 36)), (18, 18, 20))
    draw, f = ImageDraw.Draw(sheet), font(20)
    for i, (im, text) in enumerate(cells):
        x, y = (i % 2) * (w + 10), (i // 2) * (h + 36)
        sheet.paste(im.resize((w, h)), (x, y))
        draw.text((x + 8, y + h + 6), text, fill=(235, 235, 235), font=f)
    sheet.save(out, quality=88)
    print(out, sheet.size)


def main():
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    if '--parity' in sys.argv:
        at = sys.argv.index('--parity')
        return parity(sys.argv[1], sys.argv[at + 1], sys.argv[at + 2])
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
