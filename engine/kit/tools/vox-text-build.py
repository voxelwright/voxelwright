# Build a web font from a voxel glyph set: every cell becomes a square of outline.
# Needs fonttools and brotli. Usage: python tools/vox-text-build.py glyphs.json out-dir "Family Name" file-stem
# 10 cells to the em, so one cell is 2 px at 20 px and 4 px (one voxel) at 40 px.
import json, sys, os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

src, out = sys.argv[1], sys.argv[2]
FAMILY = sys.argv[3] if len(sys.argv) > 3 else 'Vox Text'
STEM = sys.argv[4] if len(sys.argv) > 4 else 'vox-text'
d = json.load(open(src))
U = 100                      # units per cell
cap = d['cap']
ASC, DESC = max(800, cap * U), 200   # room above the capitals where the set has it, two rows below the baseline

# Bold: every cell is smeared one cell to the right, the way bitmap bolds have always been made,
# so stems double and bars stay one cell. Glyphs whose strokes are one cell apart would close, so
# those are drawn by hand here.
BOLD = {
 'W': (0, ['##....##', '##....##', '##....##', '##....##', '##.##.##', '########', '.##..##.']),
 'M': (0, ['##....##', '###..###', '########', '##.##.##', '##....##', '##....##', '##....##']),
 'N': (0, ['##..##', '##..##', '###.##', '######', '##.###', '##..##', '##..##']),
 'Q': (0, ['.####.', '##..##', '##..##', '##..##', '##..##', '##.##.', '.##.##']),
 '0': (0, ['.####.', '##..##', '##..##', '##.###', '###.##', '##..##', '.####.']),
 'w': (2, ['##....##', '##....##', '##.##.##', '########', '.##..##.']),
 '"': (0, ['##.##', '##.##']),
 '“': (0, ['##.##', '##.##']),
 '”': (0, ['##.##', '##.##']),
 '#': (0, ['.##.##.', '.##.##.', '#######', '.##.##.', '#######', '.##.##.', '.##.##.']),
}

def cells(g, bold, ch=None):
    s = set()
    if bold and ch in BOLD:
        y, rows = BOLD[ch]
        return {(c, r + y) for r, row in enumerate(rows) for c, v in enumerate(row) if v == '#'}
    for r, row in enumerate(g['rows']):
        for c, ch in enumerate(row):
            if ch == '#':
                s.add((c, r + g['y']))
                if bold: s.add((c + 1, r + g['y']))
    return s

def outline(cs):
    # every cell gives four directed edges; an edge shared by two cells cancels; what is left is the outline
    edges = {}
    def add(a, b):
        if (b, a) in edges: del edges[(b, a)]
        else: edges[(a, b)] = True
    for (c, r) in cs:
        x0, x1 = c * U, (c + 1) * U
        y1, y0 = (cap - r) * U, (cap - r - 1) * U   # font units: y up, row 0 hangs from the cap line
        add((x0, y0), (x0, y1)); add((x0, y1), (x1, y1)); add((x1, y1), (x1, y0)); add((x1, y0), (x0, y0))  # clockwise
    nxt = {}
    for (a, b) in edges: nxt.setdefault(a, []).append(b)
    loops = []
    while nxt:
        start = next(iter(nxt)); pt = start; prev = None; loop = []
        while True:
            outs = nxt[pt]
            if len(outs) > 1 and prev is not None:
                # two cells meet at a point: keep turning right so each stays its own contour
                dx, dy = pt[0] - prev[0], pt[1] - prev[1]
                def turn(q):
                    ex, ey = q[0] - pt[0], q[1] - pt[1]
                    return dx * ey - dy * ex   # negative is a right turn
                outs.sort(key=turn)
            b = outs.pop(0)
            if not outs: del nxt[pt]
            loop.append(pt); prev = pt; pt = b
            if pt == start: break
        # drop points in the middle of a straight run
        clean = []
        n = len(loop)
        for i in range(n):
            a, b, c = loop[i - 1], loop[i], loop[(i + 1) % n]
            if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0: clean.append(b)
        loops.append(clean)
    return loops

NAMES = {' ': 'space'}
def gname(ch): return NAMES.get(ch) or ('uni%04X' % ord(ch))

def build(bold, path):
    order = ['.notdef'] + [gname(c) for c in d['glyphs']] + (['space'] if ' ' not in d['glyphs'] else [])
    order = list(dict.fromkeys(order))
    cmap = {ord(c): gname(c) for c in d['glyphs']}
    cmap[32] = 'space'; cmap[0xA0] = 'space'
    glyphs, metrics = {}, {}
    pen = TTGlyphPen(None)
    for x0, y0, x1, y1 in [(0, 0, 500, 700)]:
        pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
        pen.moveTo((100, 100)); pen.lineTo((400, 100)); pen.lineTo((400, 600)); pen.lineTo((100, 600)); pen.closePath()
    glyphs['.notdef'] = pen.glyph(); metrics['.notdef'] = (600, 0)
    glyphs['space'] = TTGlyphPen(None).glyph(); metrics['space'] = ((d['space'] + d['gap']) * U, 0)
    for ch, g in d['glyphs'].items():
        if ch == ' ': continue
        pen = TTGlyphPen(None)
        cs = cells(g, bold, ch)
        for loop in outline(cs):
            pen.moveTo(loop[0])
            for p in loop[1:]: pen.lineTo(p)
            pen.closePath()
        glyphs[gname(ch)] = pen.glyph()
        metrics[gname(ch)] = ((max(c for c, r in cs) + 1 + d['gap']) * U if cs else (g['w'] + d['gap']) * U, 0)
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASC, descent=-DESC, lineGap=0)
    style = 'Bold' if bold else 'Regular'
    fb.setupNameTable({'familyName': FAMILY, 'styleName': style})
    fb.setupOS2(sTypoAscender=ASC, sTypoDescender=-DESC, sTypoLineGap=0, usWinAscent=ASC, usWinDescent=DESC,
                sCapHeight=cap * U, sxHeight=d['xHeight'] * U, usWeightClass=700 if bold else 400, fsSelection=0x20 if bold else 0x40)
    fb.setupPost()
    if bold: fb.font['head'].macStyle = 1
    fea = 'languagesystem DFLT dflt;\nlanguagesystem latn dflt;\nfeature kern {\n'
    for a, b, k in d['pairs']:
        if a == ' ' or b == ' ': continue
        fea += '  pos %s %s %d;\n' % (gname(a), gname(b), k * U)
    fea += '} kern;\n'
    fb.addOpenTypeFeaturesFromString(fea) if hasattr(fb, 'addOpenTypeFeaturesFromString') else fb.addOpenTypeFeatures(fea)
    fb.font.flavor = 'woff2'
    fb.save(path)
    print(path, os.path.getsize(path), 'bytes,', len(order), 'glyphs')

os.makedirs(out, exist_ok=True)
build(False, os.path.join(out, STEM + '-400-normal.woff2'))
if '--bold' in sys.argv: build(True, os.path.join(out, STEM + '-700-normal.woff2'))
