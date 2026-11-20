"""Where the sun stood when the photograph was taken (#423): 2021-07-15 15:37:30 Pacific Daylight Time at the park.
The engine's `?hour=` is an arc drawn by hand; the place's light is the sun's true bearing and height that minute.

    python sun.py         prints bearing and height in degrees, and the engine's vector (x east, y up, z south)
"""
import math
from datetime import datetime, timezone

# The photograph's own clock (its EXIF says -07:00) and the park.
WHEN = datetime(2021, 7, 15, 22, 37, 30, tzinfo=timezone.utc)
LAT, LON = 37.79823, -122.413492


def sun(when=WHEN, lat=LAT, lon=LON):
    """Bearing (from north towards east) and height over the horizon, in degrees: NOAA's solar position equations."""
    jd = when.timestamp() / 86400.0 + 2440587.5
    t = (jd - 2451545.0) / 36525.0
    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
    m = math.radians(357.52911 + t * (35999.05029 - 0.0001537 * t))
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    c = (1.914602 - t * (0.004817 + 0.000014 * t)) * math.sin(m) + (0.019993 - 0.000101 * t) * math.sin(2 * m) + 0.000289 * math.sin(3 * m)
    omega = math.radians(125.04 - 1934.136 * t)
    lam = math.radians(l0 + c - 0.00569 - 0.00478 * math.sin(omega))
    eps = math.radians(23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(eps) * math.sin(lam))
    y = math.tan(eps / 2) ** 2
    l0r = math.radians(l0)
    eqt = 4 * math.degrees(y * math.sin(2 * l0r) - 2 * e * math.sin(m) + 4 * e * y * math.sin(m) * math.cos(2 * l0r) - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * m))
    minutes = (when.hour * 60 + when.minute + when.second / 60 + eqt + 4 * lon) % 1440
    ha = math.radians(minutes / 4 - 180)
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    height = 90 - math.degrees(math.acos(cz))
    bearing = (math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(decl) * math.cos(la))) + 180) % 360
    return bearing, height


def vector(bearing, height):
    """The way to the sun in the engine's frame: x east, y up, z south."""
    b, h = math.radians(bearing), math.radians(height)
    return [math.sin(b) * math.cos(h), math.sin(h), -math.cos(b) * math.cos(h)]


if __name__ == '__main__':
    b, h = sun()
    print(f'bearing {b:.2f}, height {h:.2f}; engine vector {[round(v, 4) for v in vector(b, h)]}')
