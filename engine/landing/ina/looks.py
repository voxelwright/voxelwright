"""What each building's walls look like (#423): a colour and a way its windows go. Nothing in the lidar or the
city's outlines says either. Where nothing is known of a building they follow from its height and its number: low
buildings here are painted wood and plaster, whites and creams most; tall ones are concrete, stone and glass.
Where something is known (a named tower's stone, its glass), it is said in KNOWN with where it is known from.

No pixel or colour of the photograph is in here: what is written by hand below is from what these buildings are
publicly known to be faced with, as remembered. The colours are where fitcolours.py starts from, and what a
building keeps that the photograph's eye never saw; the place itself is baked with the fitted ones (matte.py).
The styles stay as they are here: how a building's windows go is not fitted.
"""
import zlib
import numpy as np

# How windows go, by number (page/matte.ts draws them): metres a storey, metres a bay, how much of a bay's width
# and of a storey's height is glass, and the glass's own colour (it shows the sky, darker).
STYLES = [
    {'name': 'none', 'storey': 0, 'bay': 0, 'wide': 0, 'tall': 0, 'glass': [0, 0, 0]},
    {'name': 'house', 'storey': 3.0, 'bay': 1.4, 'wide': 0.42, 'tall': 0.5, 'glass': [58, 66, 78]},
    {'name': 'flats', 'storey': 3.1, 'bay': 1.6, 'wide': 0.5, 'tall': 0.52, 'glass': [54, 62, 74]},
    {'name': 'offices', 'storey': 3.9, 'bay': 1.7, 'wide': 0.62, 'tall': 0.5, 'glass': [46, 56, 70]},
    {'name': 'tower', 'storey': 4.0, 'bay': 1.5, 'wide': 0.7, 'tall': 0.55, 'glass': [44, 54, 68]},
    {'name': 'glass', 'storey': 4.0, 'bay': 1.5, 'wide': 0.9, 'tall': 0.82, 'glass': [52, 70, 92]},
    {'name': 'bands', 'storey': 3.9, 'bay': 1.5, 'wide': 1.0, 'tall': 0.5, 'glass': [40, 48, 60]},
    {'name': 'grid', 'storey': 3.8, 'bay': 1.9, 'wide': 0.6, 'tall': 0.6, 'glass': [36, 42, 52]},
]
BY_NAME = {s['name']: n for n, s in enumerate(STYLES)}

# Painted fronts of low buildings: whites and creams most, then the pale colours a street here is known for.
LOW = [(236, 232, 222), (236, 232, 222), (230, 224, 208), (226, 218, 198), (214, 208, 198), (198, 194, 188), (220, 204, 178), (206, 186, 168), (190, 200, 204), (214, 214, 196), (232, 226, 214), (176, 170, 164)]
# Taller ones: concrete, stone, a few of dark glass.
TALL = [(196, 190, 180), (182, 178, 170), (210, 204, 192), (168, 162, 154), (150, 146, 142), (120, 112, 106), (214, 208, 198), (88, 92, 100)]

# What is known of a building by name (names.json says which outline each is): its facing and how its windows go.
KNOWN = {
    'Transamerica Pyramid': ((226, 222, 212), 'bands', 'white precast quartz aggregate; windows in bands a storey apart'),
    '555 California Street': ((92, 62, 54), 'tower', 'carnelian granite, dark red-brown, with bays of bronze glass'),
    'Hartford Building': ((236, 236, 232), 'grid', 'white precast concrete grid, a window in each square'),
    'One Maritime Plaza': ((40, 42, 46), 'glass', 'dark glass behind an outer frame of crossed braces'),
    '101 California Street': ((70, 84, 100), 'glass', 'a round tower of grey-blue glass'),
    '345 California Center': ((196, 190, 180), 'tower', 'pale granite with square windows'),
    'Embarcadero Center 1': ((176, 170, 160), 'offices', 'ribbed precast concrete slabs with slit windows'),
    'Embarcadero Center 2': ((176, 170, 160), 'offices', 'ribbed precast concrete slabs with slit windows'),
    'Embarcadero Center 3': ((176, 170, 160), 'offices', 'ribbed precast concrete slabs with slit windows'),
    'Embarcadero Center 4': ((176, 170, 160), 'offices', 'ribbed precast concrete slabs with slit windows'),
    '333 Bush Street': ((188, 150, 140), 'tower', 'pink-grey granite with stepped setbacks'),
    'Salesforce Tower': ((150, 176, 200), 'glass', 'clear glass with pale metal sunshades'),
    'The long white slab': ((238, 238, 232), 'flats', 'a white housing slab with open galleries'),
    'Our Lady of Guadalupe Church': ((240, 240, 236), 'none', 'white-painted towers and walls'),
    'The colonnaded building': ((198, 180, 148), 'none', 'tan concrete with a deep cornice'),
    '181 Fremont': ((110, 132, 156), 'glass', 'blue-grey glass in a steel exoskeleton'),
}


def evidence(folder=None):
    """What the photographs say of each building (bay/facade_evidence.py records), by the city's building number.
    Nothing unless a records folder is named (VILLAGE_FACADE_EVIDENCE), so a bake without one is as it was."""
    import json, os
    from pathlib import Path
    folder = folder or os.environ.get('VILLAGE_FACADE_EVIDENCE')
    out = {}
    for path in sorted(Path(folder).rglob('*.json')) if folder else []:
        if path.name != 'draw.json':
            out.update({r['city']: r for r in json.loads(path.read_text()).values() if r.get('city')})
    return out


def walls(table, most, measured=None):
    """Each building's wall colour (24 bits) and style, by its number: arrays of length most + 1; 0 is no building.

    `measured` (from `evidence`) overrides a building that is not in KNOWN: a wall colour its photographs agree on
    (wall.srgb where wall.trusted) is its colour, and a glass curtain wall (material.cls 'glass', confidence 0.6 or
    more) takes the 'glass' style. Window shares stay with the style: the far styles do not read one yet."""
    colour = np.zeros(most + 1, np.int64)
    style = np.zeros(most + 1, np.int64)
    pack = lambda c: (c[0] << 16) | (c[1] << 8) | c[2]
    colour[0], style[0] = pack((190, 186, 178)), 0
    for b in table:
        i = b['id']
        if i > most:
            continue
        seed = zlib.crc32(b['city'].encode())
        tall = b.get('stands') or b.get('tall') or 12.0
        known = KNOWN.get(b.get('name', ''))
        if known:
            colour[i], style[i] = pack(known[0]), BY_NAME[known[1]]
        elif tall < 13:
            colour[i], style[i] = pack(LOW[seed % len(LOW)]), BY_NAME['house']
        elif tall < 40:
            colour[i], style[i] = pack(LOW[(seed >> 4) % len(LOW)] if (seed >> 8) % 3 else TALL[(seed >> 4) % 5]), BY_NAME['flats']
        elif tall < 110:
            colour[i], style[i] = pack(TALL[(seed >> 4) % len(TALL)]), BY_NAME['offices'] if (seed >> 9) % 4 else BY_NAME['bands']
        else:
            colour[i], style[i] = pack(TALL[(seed >> 4) % len(TALL)]), BY_NAME['tower']
        rec = None if known else (measured or {}).get(b['city'])
        if rec:
            if rec.get('wall', {}).get('trusted'):
                colour[i] = pack(tuple(rec['wall']['srgb']))
            m = rec.get('material')
            if m and m['cls'] == 'glass' and m['confidence'] >= 0.6:
                style[i] = BY_NAME['glass']
    return colour, style
