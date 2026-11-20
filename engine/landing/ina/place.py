"""The place the landing looks at (#423): where the photographer stood, the wedge of the city in the frame, and where
this lane keeps what it fetches and makes. Every tool here reads these.

The frame is the Bay's (engine/bay/bake.py): UTM zone 10N, x east and z south in the engine counted from 500,000 m
east and 4,250,000 m north, y up from 1 m over NAVD88's zero.
"""
import os

LANE = os.path.expanduser('~/.village/engine/landing/ina')
# This lane's own copy of what the Bay's tools keep under a home (bay/fetch.py and the server read `~`): nothing of
# this lane is written under ~/.village/engine/bay/.
RAW = f'{LANE}/home/.village/engine/bay/raw/ina'
DATA = f'{LANE}/data'
REF = f'{LANE}/ref'
E0, N0, SEA = 500_000.0, 4_250_000.0, 1.0

# The photograph's geotag (37.79823, -122.413492) in UTM zone 10N: where the search for the eye starts, and the
# wedge's apex. The solved eye is in camera.json.
EYE = (551_634.8, 4_183_590.6)
# Compass bearings the wedge lies between (the frame is 54 degrees across about 120, with room to spare), how far
# it reaches, how far every lidar point is taken (`fine`), and the octree's depths taken far and near. Within
# `close` of the eye the octree's last depth is taken too (it has no deeper), for what is built in cells of 10 cm.
WEDGE = {'from': 87.0, 'to': 152.0, 'far': 3300.0, 'fine': 1300.0, 'close': 460.0, 'deep': 8, 'deepest': 9, 'last': 10}

# The streets north of Market Street lie 9.47 degrees off the compass (89% of the outlines' length within 1.5
# degrees of it): everything made here is laid out in a frame turned with them, so that walls run along its cells
# and are not stepped. u runs along bearing 80.53 (east, a little north), w along 170.53 (south, a little east),
# both in metres from the geotag.
TURN = 9.47


def turned(e, n):
    """(east, north) in UTM to (u, w) in the frame turned with the streets."""
    import numpy as np
    t = np.radians(TURN)
    de, ds = np.asarray(e) - EYE[0], EYE[1] - np.asarray(n)
    return de * np.cos(t) - ds * np.sin(t), de * np.sin(t) + ds * np.cos(t)


def unturned(u, w):
    """(u, w) back to (east, north)."""
    import numpy as np
    t = np.radians(TURN)
    de, ds = np.asarray(u) * np.cos(t) + np.asarray(w) * np.sin(t), -np.asarray(u) * np.sin(t) + np.asarray(w) * np.cos(t)
    return EYE[0] + de, EYE[1] - ds
