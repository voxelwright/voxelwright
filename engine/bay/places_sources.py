"""Extract San Francisco neighborhood storefronts, plazas, and street furniture from compliant open data.

Sources (see DATA-LICENSES.md and .agents/skills/bay-sources/SKILL.md):
  - Overture Maps Places (2026-11-18.0/places.pmtiles): CDLA-Permissive-2.0 / Apache-2.0
  - OpenStreetMap (plazas, squares, parks, benches, bookcases, fountains, shops): ODbL 1.0
  - DataSF Recreation & Parks Properties (gtr9-ntp6): PDDL 1.0
  - Local DataSF Building Footprints + Street Graphs (inputs/*.zip, packs/graph/*.json)
    for snapping storefront signs onto exact street-facing building walls and recording
    interior keep-out footprints inside plazas.

Outputs a compact Brotli-compressed raw catalog (`engine/sf/places-raw.json.br`) that
`engine/sf/places.mjs` compiles with user-editable `engine/sf/brands.json` and
`engine/sf/plazas.json` during every build and deploy.

Usage:
  ~/.village/engine/bay/venv/bin/python3 engine/bay/places_sources.py [--out engine/sf/places-raw.json.br]
"""

import argparse
import concurrent.futures
import gzip
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import mapbox_vector_tile
from pmtiles.reader import Reader
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
BAY_DIR = Path(__file__).resolve().parent
SF_SQUARES = BAY_DIR / "sf-squares.json"
DEFAULT_OUT = ROOT / "engine" / "sf" / "places-raw.json.br"
DEFAULT_INPUTS = Path.home() / ".village" / "engine" / "bay" / "sf-450-city" / "inputs"
DEFAULT_GRAPHS = Path.home() / ".village" / "engine" / "bay" / "sf-450-city" / "packs" / "graph"
DEFAULT_CACHE = Path.home() / ".village" / "engine" / "bay" / "places-cache"

OVERTURE_RELEASE = "2026-11-18.0"
CACHE_VERSION = 2
OVERTURE_PLACES_URL = f"https://tiles.overturemaps.org/{OVERTURE_RELEASE}/places.pmtiles"
DATASF_PARKS_URL = "https://data.sfgov.org/resource/gtr9-ntp6.json?$limit=1000"
OVERPASS_MIRRORS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "Voxelwright/1.0 (https://voxelwright.world)"

# UTM Zone 10N -> Voxelwright 10n4250 world metres: x = E - 500_000, z = 4_250_000 - N
TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32610", always_xy=True)
FROM_UTM = Transformer.from_crs("EPSG:32610", "EPSG:4326", always_xy=True)


def lonlat_to_world_m(lon: float, lat: float) -> tuple[float, float]:
    e, n = TO_UTM.transform(lon, lat)
    return (e - 500_000.0, 4_250_000.0 - n)


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    x = int((lon + 180.0) / 360.0 * (1 << z))
    lat_r = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * (1 << z))
    return x, y


def tile_to_lonlat(z: int, tx: int, ty: int, px: float, py: float, ext: int = 4096) -> tuple[float, float]:
    n = 1 << z
    lon = (tx + px / ext) / n * 360.0 - 180.0
    lat_r = math.atan(math.sinh(math.pi * (1.0 - 2.0 * (ty + (ext - py) / ext) / n)))
    return lon, math.degrees(lat_r)


def norm_name(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"['’`]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


# ── Storefront category classification (filters out upstairs offices, dentists, realtors, etc.) ──

CATEGORY_PRIORITY = {
    "pizza": 100,
    "burger": 100,
    "ice_cream": 98,
    "coffee": 96,
    "bakery": 94,
    "books": 94,
    "florist": 92,
    "supermarket": 92,
    "grocery": 88,
    "urgent_care": 86,
    "corner_store": 84,
    "bar": 82,
    "restaurant": 80,
    "cinema": 78,
    "hardware": 74,
    "pharmacy": 72,
    "boutique": 64,
    "bank": 58,
    "salon": 50,
    "fitness": 48,
    "market": 90,
    "service": 42,
}

# Street-level walk-in urgent care clinics (kept before skipping upstairs doctors/dentists/specialty clinics)
URGENT_CARE_OVERTURE_PRIMARIES = {"urgent_care_clinic", "walk_in_clinic"}
URGENT_CARE_NAME_TOKENS = (
    "urgent care",
    "walk-in clinic",
    "walk in clinic",
    "walk-in care",
    "walk in care",
    "express care",
    "immediate care",
    "gohealth",
    "minuteclinic",
    "citymd",
)
URGENT_CARE_BRAND_TOKENS = (
    "carbon health",
    "gohealth",
    "concentra",
    "action urgent care",
    "golden gate urgent care",
    "city bay urgent care",
    "sutter urgent care",
    "sutter walk-in",
    "sutter walk in",
    "minuteclinic",
    "citymd",
)
URGENT_CARE_EXCLUDE_NAME_TOKENS = (
    "ambulance",
    "laparoscopy",
    "surgery",
    "surgical",
    "dialysis",
    "imaging",
    "radiology",
    "fertility",
)
DOCTOR_TITLE_RE = re.compile(
    r"(?:^|\b)(?:dr\.?|m\.?d\.?|d\.?o\.?|d\.?d\.?s\.?|d\.?m\.?d\.?|n\.?p\.?|p\.?a\.?-?c\.?)(?:\b|$)",
    re.I,
)

# Overture primary/hierarchy keywords -> Voxelwright neighborhood category (None = skip non-storefront)
SKIP_TAXONOMY_TOKENS = {
    "dental", "dentist", "doctor", "physician", "medical", "clinic", "hospital", "chiropractor",
    "optometrist", "therapist", "psycholog", "counsel", "acupunct", "real_estate", "lawyer",
    "attorney", "legal", "accountant", "tax_service", "insurance", "consulting", "software",
    "marketing", "advertising", "recruiting", "staffing", "notary", "architect", "engineering",
    "contractor", "plumber", "electrician", "roofing", "hvac", "cleaning_service", "moving_service",
    "food_delivery_service", "catering", "atm", "parking", "bus_stop", "ev_charging", "church",
    "religious", "school", "preschool", "daycare", "government", "courthouse", "police", "fire_station",
    "apartment", "condominium", "residential", "storage", "warehouse", "wholesale", "funeral",
    "veterinar", "animal_hospital", "post_office_box",
}


def classify_overture(primary: str, hierarchy: list[str], basic: str, name: str, conf: float = 1.0) -> str | None:
    primary_l = (primary or "").lower()
    basic_l = (basic or "").lower()
    joined = " ".join([primary_l, basic_l, *(h.lower() for h in hierarchy)])
    nl = (name or "").lower()
    is_health = any(
        tok in joined
        for tok in ("health_care", "urgent_care", "walk_in_clinic", "outpatient", "hospital", "emergency_or_urgent", "clinic", "medical")
    )
    not_non_urgent_med = (
        not any(tok in joined for tok in ("veterinar", "animal_hospital", "dental", "dentist", "ambulance"))
        and not any(tok in nl for tok in URGENT_CARE_EXCLUDE_NAME_TOKENS)
        and not DOCTOR_TITLE_RE.search(nl)
    )
    if is_health and not_non_urgent_med:
        if primary_l in URGENT_CARE_OVERTURE_PRIMARIES or basic_l in URGENT_CARE_OVERTURE_PRIMARIES:
            return "urgent_care"
        if any(tok in nl for tok in URGENT_CARE_NAME_TOKENS) and (primary_l != "hospital" or conf >= 0.75):
            return "urgent_care"
    if any(tok in joined for tok in SKIP_TAXONOMY_TOKENS):
        return None
    if "pizza" in joined or "pizzeria" in nl or "pizza" in nl:
        return "pizza"
    if "burger" in joined or "hamburger" in nl or "burger" in nl:
        return "burger"
    if any(k in joined for k in ("ice_cream", "gelato", "frozen_yogurt", "dessert", "smoothie", "juice_bar", "bubble_tea", "boba")) or any(k in nl for k in ("ice cream", "creamery", "gelato", "boba", "banan")):
        return "ice_cream"
    if any(k in joined for k in ("coffee", "cafe", "tea_room", "espresso", "roaster")) or any(k in nl for k in ("coffee", "cafe", "café", "espresso", "roasters")):
        return "coffee"
    if any(k in joined for k in ("bakery", "bagel", "donut", "doughnut", "patisserie", "pastry")) or any(k in nl for k in ("bakery", "bagel", "boulangerie", "donut", "pastry", "tartine")):
        return "bakery"
    if any(k in joined for k in ("book_store", "bookstore", "comic_book", "newsstand")) or "books" in nl or "bookstore" in nl:
        return "books"
    if any(k in joined for k in ("florist", "flower", "plant_nursery", "garden_center", "plant_shop")) or any(k in nl for k in ("flower", "florist", "plant ", "plants", "nursery", "botanical")):
        return "florist"
    if any(k in joined for k in ("supermarket", "hypermarket", "organic_grocery")):
        return "supermarket"
    if any(k in joined for k in ("farmers_market", "public_market")) or "farmers market" in nl or "farmer's market" in nl:
        return "market"
    if any(k in joined for k in ("grocery", "butcher", "cheese_shop", "seafood_market", "produce", "delicatessen", "health_food_store", "specialty_food", "wine_shop", "liquor_store")):
        return "grocery"
    if any(k in joined for k in ("convenience_store", "bodega", "mini_mart")) or ("market" in nl and any(w in joined for w in ("shopping", "food", "retail"))):
        return "corner_store"
    if any(k in joined for k in ("bar", "pub", "tavern", "brewery", "cocktail", "wine_bar", "nightclub", "lounge", "beer_garden")):
        return "bar"
    if any(k in joined for k in ("restaurant", "diner", "bistro", "eatery", "sandwich", "taco", "sushi", "ramen", "noodle", "thai", "mexican", "italian", "chinese", "japanese", "indian", "vietnamese", "korean", "mediterranean", "french", "seafood", "steakhouse", "bbq", "fast_food", "food_court", "food_stand", "eat_and_drink")):
        return "restaurant"
    if any(k in joined for k in ("pharmacy", "drugstore")):
        return "pharmacy"
    if any(k in joined for k in ("bank", "credit_union")) and "food_bank" not in joined:
        return "bank"
    if any(k in joined for k in ("hardware_store", "home_improvement", "paint_store")):
        return "hardware"
    if any(k in joined for k in ("cinema", "movie_theater", "performing_arts", "music_venue", "comedy_club", "art_gallery", "museum")):
        return "cinema"
    if any(k in joined for k in ("gym", "fitness", "yoga", "pilates", "climbing")):
        return "fitness"
    if any(k in joined for k in ("hair_salon", "barber", "beauty_salon", "nail_salon", "spa")):
        return "salon"
    if any(k in joined for k in ("shipping", "courier", "dry_clean", "laundromat", "tailor", "shoe_repair", "print_shop", "telecommunications", "mobile_phone_store", "gas_station")):
        return "service"
    if any(k in joined for k in (
        "clothing", "apparel", "shoe_store", "boutique", "gift_shop", "toy_store", "jewelry",
        "record_store", "music_store", "bicycle_shop", "sporting_goods", "thrift", "vintage",
        "antique", "home_goods", "furniture_store", "kitchenware", "stationery", "art_supply",
        "pet_store", "cosmetics", "eyewear", "department_store", "electronics_store",
        "computer_store", "shopping", "specialty_store",
    )):
        return "boutique"
    return None


def classify_osm(tags: dict) -> str | None:
    am = (tags.get("amenity") or "").lower()
    hc = (tags.get("healthcare") or "").lower()
    spec = (tags.get("healthcare:speciality") or "").lower()
    sh = (tags.get("shop") or "").lower()
    cu = (tags.get("cuisine") or "").lower()
    nl = (tags.get("name") or "").lower()
    br = (tags.get("brand") or tags.get("operator") or "").lower()
    if am.startswith("disused:") or hc.startswith("disused:"):
        return None
    if am == "clinic" or hc in ("clinic", "urgent_care"):
        spec_tokens = {s.strip() for s in re.split(r"[;,]", spec) if s.strip()}
        is_urgent_spec = "urgent" in spec_tokens and len(spec_tokens) <= 3
        combined = f"{nl} {br}"
        if (
            not any(tok in nl for tok in URGENT_CARE_EXCLUDE_NAME_TOKENS)
            and not DOCTOR_TITLE_RE.search(nl)
            and (
                hc == "urgent_care"
                or is_urgent_spec
                or any(tok in combined for tok in URGENT_CARE_NAME_TOKENS)
                or any(tok in combined for tok in URGENT_CARE_BRAND_TOKENS)
            )
        ):
            return "urgent_care"
    if "pizza" in cu or "pizza" in nl:
        return "pizza"
    if "burger" in cu or "burger" in nl or "hamburger" in nl:
        return "burger"
    if am == "ice_cream" or "ice_cream" in cu or "gelato" in cu or "bubble_tea" in cu:
        return "ice_cream"
    if am == "cafe" or sh in ("coffee", "tea") or "coffee" in cu:
        return "coffee"
    if sh in ("bakery", "pastry", "confectionery") or "bagel" in cu or "donut" in cu:
        return "bakery"
    if sh in ("books", "comics", "stationery") or "books" in nl:
        return "books"
    if sh in ("florist", "garden_centre", "plants"):
        return "florist"
    if sh in ("supermarket", "department_store"):
        return "supermarket"
    if am == "marketplace":
        return "market"
    if sh in ("greengrocer", "butcher", "cheese", "seafood", "deli", "organic", "health_food", "wine", "alcohol", "beverages", "grocery"):
        return "grocery"
    if sh in ("convenience", "kiosk", "variety_store"):
        return "corner_store"
    if am in ("bar", "pub", "biergarten", "nightclub"):
        return "bar"
    if am in ("restaurant", "fast_food", "food_court"):
        return "restaurant"
    if am == "pharmacy" or sh in ("chemist", "medical_supply"):
        return "pharmacy"
    if am == "bank":
        return "bank"
    if sh in ("hardware", "doityourself", "paint"):
        return "hardware"
    if am in ("cinema", "theatre", "arts_centre") or tags.get("tourism") in ("gallery", "museum"):
        return "cinema"
    if sh in ("hairdresser", "beauty", "barber"):
        return "salon"
    if tags.get("leisure") in ("fitness_centre", "sports_centre"):
        return "fitness"
    if sh in ("dry_cleaning", "laundry", "tailor", "copyshop", "mobile_phone") or am in ("fuel",):
        return "service"
    if sh:
        return "boutique"
    return None


# ── HTTP + PMTiles Fetching ──

class CachedHttpRange:
    def __init__(self, url: str):
        self.url = url
        self.head_cache: dict[tuple[int, int], bytes] = {}

    def __call__(self, offset: int, length: int) -> bytes:
        key = (offset, length)
        if key in self.head_cache:
            return self.head_cache[key]
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    self.url,
                    headers={"Range": f"bytes={offset}-{offset + length - 1}", "User-Agent": USER_AGENT},
                )
                with urllib.request.urlopen(req, timeout=25) as r:
                    data = r.read()
                if length <= 262_144:
                    self.head_cache[key] = data
                return data
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(0.5 * (attempt + 1))
        return b""


def fetch_overture_places(bounds: tuple[float, float, float, float], cache_dir: Path, refresh: bool = False) -> list[dict]:
    W, S, E, N = bounds
    cache_file = cache_dir / f"overture-places-{OVERTURE_RELEASE}-v{CACHE_VERSION}.json.gz"
    if cache_file.exists() and not refresh:
        print(f"  [cache] {cache_file.name}", flush=True)
        return json.loads(gzip.decompress(cache_file.read_bytes()))

    x0, y1 = lonlat_to_tile(W, S, 14)
    x1, y0 = lonlat_to_tile(E, N, 14)
    coords = [(tx, ty) for tx in range(x0, x1 + 1) for ty in range(y0, y1 + 1)]
    print(f"  fetching Overture Places ({OVERTURE_RELEASE}): {len(coords)} z14 tiles...", flush=True)

    # Warm PMTiles header + root directory once, then read leaf tiles concurrently.
    src = CachedHttpRange(OVERTURE_PLACES_URL)
    reader = Reader(src)
    _ = reader.header()

    def read_tile(xy: tuple[int, int]) -> list[dict]:
        tx, ty = xy
        raw = reader.get(14, tx, ty)
        if not raw:
            return []
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        decoded = mapbox_vector_tile.decode(raw)
        layer = decoded.get("place")
        if not layer:
            return []
        ext = layer.get("extent", 4096)
        out = []
        for feat in layer["features"]:
            geom = feat.get("geometry", {})
            if geom.get("type") != "Point":
                continue
            px, py = geom["coordinates"]
            lon, lat = tile_to_lonlat(14, tx, ty, px, py, ext)
            if not (W <= lon <= E and S <= lat <= N):
                continue
            p = feat.get("properties", {})
            if p.get("operating_status") == "permanently_closed":
                continue
            conf = float(p.get("confidence") or 0.0)
            if conf < 0.42:
                continue
            name = (p.get("@name") or "").strip()
            if not name:
                try:
                    name = (json.loads(p.get("names") or "{}").get("primary") or "").strip()
                except Exception:
                    name = ""
            if not name or len(name) > 80:
                continue
            primary = ""
            hierarchy: list[str] = []
            try:
                tax = json.loads(p.get("taxonomy") or "{}")
                primary = tax.get("primary") or ""
                hierarchy = tax.get("hierarchy") or []
            except Exception:
                pass
            basic = p.get("basic_category") or ""
            cat = classify_overture(primary, hierarchy, basic, name, conf)
            if not cat:
                continue
            brand = ""
            try:
                bobj = json.loads(p.get("brand") or "{}")
                brand = ((bobj.get("names") or {}).get("primary") or "").strip()
            except Exception:
                pass
            addr = ""
            try:
                addrs = json.loads(p.get("addresses") or "[]")
                if addrs and isinstance(addrs, list):
                    addr = (addrs[0].get("freeform") or "").strip()
            except Exception:
                pass
            out.append({
                "src": "ov",
                "name": name,
                "brand": brand,
                "cat": cat,
                "conf": round(conf, 3),
                "addr": addr,
                "lon": round(lon, 6),
                "lat": round(lat, 6),
            })
        return out

    places: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for batch in pool.map(read_tile, coords):
            places.extend(batch)

    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file.write_bytes(gzip.compress(json.dumps(places, separators=(",", ":")).encode("utf-8")))
    print(f"  Overture Places: {len(places)} storefront candidates", flush=True)
    return places


def fetch_datasf_parks(cache_dir: Path) -> list[dict]:
    cache_file = cache_dir / "datasf-parks-gtr9-ntp6.json.gz"
    if cache_file.exists():
        print(f"  [cache] {cache_file.name}", flush=True)
        return json.loads(gzip.decompress(cache_file.read_bytes()))
    print("  fetching DataSF Recreation & Parks Properties (gtr9-ntp6)...", flush=True)
    req = urllib.request.Request(DATASF_PARKS_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=40) as resp:
        rows = json.loads(resp.read().decode("utf-8"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file.write_bytes(gzip.compress(json.dumps(rows, separators=(",", ":")).encode("utf-8")))
    print(f"  DataSF parks/plazas: {len(rows)} properties", flush=True)
    return rows


def run_overpass(query: str, timeout: int = 60) -> dict | None:
    data = ("data=" + urllib.parse.quote(query)).encode("utf-8")
    for mirror in OVERPASS_MIRRORS:
        try:
            req = urllib.request.Request(mirror, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            print(f"    overpass {mirror.split('/')[2]} failed: {exc}", flush=True)
    return None


def fetch_osm_map_box(w: float, s: float, e: float, n: float) -> list[dict]:
    url = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w:.6f},{s:.6f},{e:.6f},{n:.6f}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw)["elements"]


def fetch_osm_sf(bounds: tuple[float, float, float, float], cache_dir: Path, refresh: bool = False) -> dict:
    W, S, E, N = bounds
    cache_file = cache_dir / f"osm-sf-places-plazas-v{CACHE_VERSION}.json.gz"
    if cache_file.exists() and not refresh:
        print(f"  [cache] {cache_file.name}", flush=True)
        return json.loads(gzip.decompress(cache_file.read_bytes()))

    print("  fetching OpenStreetMap SF plazas, furniture & POIs...", flush=True)
    bbox = f"{S:.5f},{W:.5f},{N:.5f},{E:.5f}"

    # 1. Plazas, town squares, pedestrian plazas & named parks (with full geometry)
    q_plazas = f"""[out:json][timeout:45];
(
  way["place"="square"]({bbox});
  way["highway"="pedestrian"]["area"="yes"]({bbox});
  way["leisure"~"^(park|garden|common)$"]["name"]({bbox});
);
out tags geom;"""
    res_plazas = run_overpass(q_plazas, timeout=55)

    # 2. Civic furniture (benches, Little Free Libraries, drinking water, fountains, farmers markets)
    q_furn = f"""[out:json][timeout:45];
(
  node["amenity"~"^(bench|public_bookcase|drinking_water|fountain|marketplace)$"]({bbox});
);
out body;"""
    res_furn = run_overpass(q_furn, timeout=55)

    # 3. OSM commercial POIs (adds outdoor_seating, cuisine, urgent care clinics & local independent shops!)
    q_pois = f"""[out:json][timeout:55];
(
  node["name"]["shop"]({bbox});
  node["name"]["amenity"~"^(restaurant|cafe|fast_food|ice_cream|bar|pub|pharmacy|clinic|bank|cinema|theatre|marketplace)$"]({bbox});
  node["name"]["healthcare"~"^(clinic|urgent_care)$"]({bbox});
  way["name"]["shop"]({bbox});
  way["name"]["amenity"~"^(restaurant|cafe|fast_food|ice_cream|bar|pub|pharmacy|clinic|bank|cinema|theatre|marketplace)$"]({bbox});
  way["name"]["healthcare"~"^(clinic|urgent_care)$"]({bbox});
);
out tags center;"""
    res_pois = run_overpass(q_pois, timeout=65)

    plazas_els = (res_plazas or {}).get("elements", [])
    furn_els = (res_furn or {}).get("elements", [])
    pois_els = (res_pois or {}).get("elements", [])

    # Always ensure key neighborhood corridors have direct OSM API coverage if Overpass dropped a query
    if not plazas_els or not pois_els:
        print("    Overpass partial/empty — falling back to direct OSM API on core neighborhood squares", flush=True)
        for (lat, lon, r) in [
            (37.7515, -122.4295, 0.0045),  # Noe Valley 24th St + Town Square
            (37.7765, -122.4243, 0.0035),  # Hayes Valley / Patricia's Green
            (37.7620, -122.4348, 0.0035),  # Castro / Jane Warner Plaza
            (37.7699, -122.4264, 0.0035),  # Market & Buchanan / Duboce Triangle
            (37.8007, -122.4100, 0.0040),  # North Beach / Washington Square
            (37.7596, -122.4220, 0.0040),  # Mission / Valencia & Dolores
            (37.7948, -122.4060, 0.0035),  # Chinatown / Portsmouth Square
            (37.7830, -122.4640, 0.0035),  # Inner Richmond / Clement St
            (37.7695, -122.4480, 0.0035),  # Haight-Ashbury
        ]:
            try:
                els = fetch_osm_map_box(lon - r, lat - r, lon + r, lat + r)
                nodes_by_id = {el["id"]: (el["lon"], el["lat"]) for el in els if el["type"] == "node"}
                for el in els:
                    tags = el.get("tags") or {}
                    is_poi_tag = (
                        tags.get("shop")
                        or tags.get("amenity") in ("restaurant", "cafe", "fast_food", "ice_cream", "bar", "pub", "pharmacy", "clinic", "bank", "cinema", "theatre", "marketplace")
                        or tags.get("healthcare") in ("clinic", "urgent_care")
                    )
                    if el["type"] == "node":
                        if tags.get("amenity") in ("bench", "public_bookcase", "drinking_water", "fountain", "marketplace"):
                            furn_els.append(el)
                        if tags.get("name") and is_poi_tag:
                            pois_els.append(el)
                    elif el["type"] == "way" and el.get("nodes"):
                        pts = [nodes_by_id[nid] for nid in el["nodes"] if nid in nodes_by_id]
                        if len(pts) >= 3:
                            if tags.get("place") == "square" or (tags.get("highway") == "pedestrian" and tags.get("area") == "yes") or (tags.get("leisure") in ("park", "garden", "common") and tags.get("name")):
                                plazas_els.append({"type": "way", "id": el["id"], "tags": tags, "geometry": [{"lon": p[0], "lat": p[1]} for p in pts]})
                            elif tags.get("name") and is_poi_tag:
                                cx = sum(p[0] for p in pts) / len(pts)
                                cy = sum(p[1] for p in pts) / len(pts)
                                pois_els.append({"type": "way", "id": el["id"], "tags": tags, "center": {"lon": cx, "lat": cy}})
            except Exception as exc:
                print(f"    fallback OSM box ({lat},{lon}) failed: {exc}", flush=True)

    bundle = {"plazas": plazas_els, "furniture": furn_els, "pois": pois_els}
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file.write_bytes(gzip.compress(json.dumps(bundle, separators=(",", ":")).encode("utf-8")))
    print(f"  OSM: {len(plazas_els)} plazas/parks, {len(furn_els)} furniture nodes, {len(pois_els)} POIs", flush=True)
    return bundle


# ── Geometry Helpers (world metres) ──

def poly_signed_area(ring: list[tuple[float, float]]) -> float:
    a = 0.0
    n = len(ring)
    for i in range(n):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % n]
        a += x0 * z1 - x1 * z0
    return 0.5 * a


def point_in_poly(x: float, z: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if ((zi > z) != (zj > z)) and (x < (xj - xi) * (z - zi) / ((zj - zi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def project_to_seg(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> tuple[float, float, float, float]:
    """Returns (cx, cz, dist, t)."""
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    if l2 < 1e-9:
        return ax, az, math.hypot(px - ax, pz - az), 0.0
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    cx, cz = ax + dx * t, az + dz * t
    return cx, cz, math.hypot(px - cx, pz - cz), t


def simplify_ring(ring: list[tuple[float, float]], tol: float = 1.2, max_pts: int = 24) -> list[tuple[float, float]]:
    if len(ring) >= 2 and math.hypot(ring[0][0] - ring[-1][0], ring[0][1] - ring[-1][1]) < 0.2:
        ring = ring[:-1]
    if len(ring) <= 4:
        return ring
    out = [ring[0]]
    for p in ring[1:]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= tol:
            out.append(p)
    if len(out) > max_pts:
        step = len(out) / max_pts
        out = [out[int(i * step)] for i in range(max_pts)]
    return out if len(out) >= 3 else ring[:3]


# ── Local Building Footprints & Street Graph Spatial Index ──

def load_local_geometry(inputs_dir: Path, graphs_dir: Path):
    """Loads DataSF building footprints & street centerline segments into 50 m spatial grids."""
    CELL = 50.0
    bldg_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    bldgs: list[dict] = []
    seen_bldg = set()

    zips = sorted(inputs_dir.glob("*.zip")) if inputs_dir.exists() else []
    print(f"  indexing footprints from {len(zips)} local square zips...", flush=True)
    for zp in zips:
        try:
            with zipfile.ZipFile(zp) as zf:
                if "footprints.geojson" not in zf.namelist():
                    continue
                gj = json.loads(zf.read("footprints.geojson"))
        except Exception:
            continue
        for feat in gj.get("features", []):
            props = feat.get("properties") or {}
            bid = props.get("sf16_bldgid") or props.get("area_id") or props.get("globalid")
            if bid and bid in seen_bldg:
                continue
            geom = feat.get("geometry") or {}
            gtype = geom.get("type")
            coords = geom.get("coordinates")
            if not coords:
                continue
            rings = []
            if gtype == "Polygon":
                rings = [coords[0]]
            elif gtype == "MultiPolygon":
                rings = [poly[0] for poly in coords if poly]
            if not rings:
                continue
            # Use largest outer ring
            best_ring = None
            best_area = 0.0
            for raw_r in rings:
                if len(raw_r) < 4:
                    continue
                pts = [lonlat_to_world_m(pt[0], pt[1]) for pt in raw_r[:-1]]
                area = abs(poly_signed_area(pts))
                if area > best_area:
                    best_area = area
                    best_ring = pts
            if not best_ring or best_area < 12.0:
                continue
            # Enforce CCW winding in (x, z) so right-hand edge normal (dz, -dx) points OUTWARD!
            if poly_signed_area(best_ring) < 0:
                best_ring.reverse()
            xs = [p[0] for p in best_ring]
            zs = [p[1] for p in best_ring]
            x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
            if bid:
                seen_bldg.add(bid)
            else:
                k = (round((x0 + x1) * 0.5), round((z0 + z1) * 0.5))
                if k in seen_bldg:
                    continue
                seen_bldg.add(k)
            h_raw = props.get("hgt_median_m") or props.get("hgt_mediancm")
            h = 8.0
            try:
                fv = float(h_raw)
                h = fv / 100.0 if props.get("hgt_median_m") is None and fv > 60 else fv
            except Exception:
                h = 8.0
            h = max(3.2, min(320.0, h))
            idx = len(bldgs)
            bldgs.append({
                "ring": best_ring,
                "bbox": (x0, z0, x1, z1),
                "cx": (x0 + x1) * 0.5,
                "cz": (z0 + z1) * 0.5,
                "r": max(x1 - x0, z1 - z0) * 0.5,
                "h": round(h, 1),
            })
            for gx in range(int(math.floor(x0 / CELL)), int(math.floor(x1 / CELL)) + 1):
                for gz in range(int(math.floor(z0 / CELL)), int(math.floor(z1 / CELL)) + 1):
                    bldg_grid[(gx, gz)].append(idx)

    road_grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    roads: list[tuple[float, float, float, float, str, int]] = []
    gfiles = sorted(graphs_dir.glob("*.json")) if graphs_dir.exists() else []
    print(f"  indexing road segments from {len(gfiles)} street graphs...", flush=True)
    for gf in gfiles:
        try:
            g = json.loads(gf.read_text())
        except Exception:
            continue
        for r in g.get("roads") or []:
            line = r.get("line") or []
            if len(line) < 2:
                continue
            name = (r.get("name") or "").strip()
            lanes = int(r.get("lanes") or 1)
            for i in range(len(line) - 1):
                ax, az = line[i][0] * 0.1, line[i][1] * 0.1
                bx, bz = line[i + 1][0] * 0.1, line[i + 1][1] * 0.1
                if math.hypot(bx - ax, bz - az) < 0.5:
                    continue
                idx = len(roads)
                roads.append((ax, az, bx, bz, name, lanes))
                x0, x1 = min(ax, bx), max(ax, bx)
                z0, z1 = min(az, bz), max(az, bz)
                for gx in range(int(math.floor(x0 / CELL)), int(math.floor(x1 / CELL)) + 1):
                    for gz in range(int(math.floor(z0 / CELL)), int(math.floor(z1 / CELL)) + 1):
                        road_grid[(gx, gz)].append(idx)

    print(f"  indexed {len(bldgs)} footprints and {len(roads)} road segments", flush=True)
    return bldgs, bldg_grid, roads, road_grid, CELL


def nearest_road(x: float, z: float, roads, road_grid, cell: float, max_d: float = 42.0):
    gx, gz = int(math.floor(x / cell)), int(math.floor(z / cell))
    best = None
    best_d = max_d
    seen = set()
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for idx in road_grid.get((gx + dx, gz + dz), ()):
                if idx in seen:
                    continue
                seen.add(idx)
                ax, az, bx, bz, name, lanes = roads[idx]
                cx, cz, d, _ = project_to_seg(x, z, ax, az, bx, bz)
                if d < best_d:
                    best_d = d
                    best = (cx, cz, d, name, lanes, ax, az, bx, bz)
    return best


def snap_poi_to_facade(x: float, z: float, bldgs, bldg_grid, roads, road_grid, cell: float):
    """Snaps a POI (x, z) in world metres onto the street-facing wall edge of its building."""
    road = nearest_road(x, z, roads, road_grid, cell, max_d=40.0)
    if not road:
        return None
    rx, rz, road_d, street_name, lanes, _, _, _, _ = road
    # Find containing or closest building footprint within 16 m
    gx, gz = int(math.floor(x / cell)), int(math.floor(z / cell))
    cand_ids = set()
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            cand_ids.update(bldg_grid.get((gx + dx, gz + dz), ()))

    chosen = None
    best_bdist = 16.0
    for idx in cand_ids:
        b = bldgs[idx]
        x0, z0, x1, z1 = b["bbox"]
        if x < x0 - 16.0 or x > x1 + 16.0 or z < z0 - 16.0 or z > z1 + 16.0:
            continue
        if point_in_poly(x, z, b["ring"]):
            chosen = b
            best_bdist = 0.0
            break
        # Distance to polygon boundary
        ring = b["ring"]
        dmin = 999.0
        for i in range(len(ring)):
            a = ring[i]
            c = ring[(i + 1) % len(ring)]
            _, _, d, _ = project_to_seg(x, z, a[0], a[1], c[0], c[1])
            if d < dmin:
                dmin = d
        if dmin < best_bdist:
            best_bdist = dmin
            chosen = b

    if not chosen:
        return None

    # Pick the building exterior edge that best faces the nearest road!
    ring = chosen["ring"]
    # For CCW ring in (x, z) right-handed (x east, z south -> area > 0 means CCW in standard (x, y) coords),
    # outward normal of edge (ax, az)->(bx, bz) is (dz/L, -dx/L). Verify with centroid test!
    best_edge = None
    best_score = -1e9
    for i in range(len(ring)):
        ax, az = ring[i]
        bx, bz = ring[(i + 1) % len(ring)]
        dx, dz = bx - ax, bz - az
        elen = math.hypot(dx, dz)
        if elen < 2.4:
            continue
        # Outward unit normal: test which side is outside polygon
        nx, nz = dz / elen, -dx / elen
        mx, mz = (ax + bx) * 0.5, (az + bz) * 0.5
        if point_in_poly(mx + nx * 0.35, mz + nz * 0.35, ring):
            nx, nz = -nx, -nz
        # Project POI onto this wall edge (keeping 0.8 m margin from wall corners where edge is long enough)
        cx, cz, d_poi, t = project_to_seg(x, z, ax, az, bx, bz)
        if elen > 3.2:
            margin_t = min(0.28, 1.2 / elen)
            t = max(margin_t, min(1.0 - margin_t, t))
            cx, cz = ax + dx * t, az + dz * t
        # Nearest road point from this wall point
        r_edge = nearest_road(cx, cz, roads, road_grid, cell, max_d=36.0)
        if not r_edge:
            continue
        erx, erz, ed_road, estreet, elanes, _, _, _, _ = r_edge
        vx, vz = erx - cx, erz - cz
        vlen = math.hypot(vx, vz)
        if vlen < 2.2:
            continue  # wall overlapping road centerline — skip
        facing = (nx * vx + nz * vz) / vlen
        if facing < 0.35:
            continue  # edge faces away from street
        # Make sure the sidewalk point 1.4 m in front of wall isn't inside another building!
        fx, fz = cx + nx * 1.4, cz + nz * 1.4
        blocked = False
        for oidx in cand_ids:
            ob = bldgs[oidx]
            if ob is chosen:
                continue
            ox0, oz0, ox1, oz1 = ob["bbox"]
            if ox0 <= fx <= ox1 and oz0 <= fz <= oz1 and point_in_poly(fx, fz, ob["ring"]):
                blocked = True
                break
        if blocked:
            continue
        # Score: strongly reward facing the street, proximity to street & POI, and generous storefront edge width
        score = facing * 24.0 - ed_road * 1.15 - d_poi * 0.65 + min(elen, 12.0) * 0.45
        if score > best_score:
            best_score = score
            best_edge = (cx, cz, nx, nz, min(elen, 14.0), ed_road, chosen["h"], estreet or street_name, elanes)

    if not best_edge:
        return None
    cx, cz, nx, nz, span, ed_road, bh, st_name, lanes = best_edge
    # Estimate sidewalk clearance (wall to kerb): half-carriageway is ~3.0 m (1 lane) + 2.5 m parked car lane
    half_road = min(11.0, 2.2 + lanes * 1.75)
    sw_clear = max(0.0, ed_road - half_road)
    return {
        "x": round(cx, 1),
        "z": round(cz, 1),
        "nx": round(nx, 3),
        "nz": round(nz, 3),
        "w": round(span, 1),
        "sw": round(sw_clear, 1),
        "h": bh,
        "st": st_name,
    }


# ── Deduplication & Fusion ──

def fuse_storefronts(overture_raw: list[dict], osm_pois: list[dict], bldgs, bldg_grid, roads, road_grid, cell: float) -> list[dict]:
    # 1. Normalize OSM POIs
    merged: list[dict] = []
    osm_spatial: dict[tuple[int, int], list[int]] = defaultdict(list)

    for el in osm_pois:
        tags = el.get("tags") or {}
        name = (tags.get("name") or "").strip()
        if not name or len(name) > 80:
            continue
        cat = classify_osm(tags)
        if not cat:
            continue
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center") or {}
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None:
            continue
        x, z = lonlat_to_world_m(lon, lat)
        rec = {
            "name": name,
            "norm": norm_name(name),
            "brand": (tags.get("brand") or tags.get("operator") or "").strip(),
            "cat": cat,
            "conf": 0.96,  # OSM human-mapped ground truth
            "osm": True,
            "outdoor": (tags.get("outdoor_seating") or "").lower() in ("yes", "terrace", "sidewalk", "parklet", "garden"),
            "addr": " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")])).strip(),
            "raw_x": x,
            "raw_z": z,
        }
        idx = len(merged)
        merged.append(rec)
        osm_spatial[(int(x // 30), int(z // 30))].append(idx)

    # 2. Merge Overture Places (deduplicating against OSM within 32 m)
    ov_spatial: dict[tuple[int, int], list[int]] = defaultdict(list)
    for ov in overture_raw:
        x, z = lonlat_to_world_m(ov["lon"], ov["lat"])
        nn = norm_name(ov["name"])
        if not nn:
            continue
        gx, gz = int(x // 30), int(z // 30)
        dup = False
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for idx in osm_spatial.get((gx + dx, gz + dz), ()):
                    m = merged[idx]
                    d_osm = math.hypot(m["raw_x"] - x, m["raw_z"] - z)
                    same_clinic = m["cat"] == "urgent_care" and ov["cat"] == "urgent_care" and d_osm < 28.0
                    if d_osm < 32.0:
                        if same_clinic or m["norm"] == nn or (len(nn) >= 5 and (nn in m["norm"] or m["norm"] in nn)):
                            if not m["brand"] and ov["brand"]:
                                m["brand"] = ov["brand"]
                            if not m["addr"] and ov["addr"]:
                                m["addr"] = ov["addr"]
                            dup = True
                            break
                if dup:
                    break
        if dup:
            continue
        # Deduplicate duplicate Overture entries of same business within 22 m (or co-located urgent care rebrands within 28 m)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for idx in ov_spatial.get((gx + dx, gz + dz), ()):
                    m = merged[idx]
                    d_ov = math.hypot(m["raw_x"] - x, m["raw_z"] - z)
                    same_clinic = m["cat"] == "urgent_care" and ov["cat"] == "urgent_care" and d_ov < 28.0
                    if same_clinic or (d_ov < 22.0 and (m["norm"] == nn or (len(nn) >= 6 and (nn in m["norm"] or m["norm"] in nn)))):
                        if ov["conf"] > m["conf"]:
                            m["conf"] = ov["conf"]
                        if not m["brand"] and ov["brand"]:
                            m["brand"] = ov["brand"]
                        if not m["addr"] and ov["addr"]:
                            m["addr"] = ov["addr"]
                        dup = True
                        break
                if dup:
                    break
        if dup:
            continue
        idx = len(merged)
        merged.append({
            "name": ov["name"],
            "norm": nn,
            "brand": ov["brand"],
            "cat": ov["cat"],
            "conf": ov["conf"],
            "osm": False,
            "outdoor": False,
            "addr": ov["addr"],
            "raw_x": x,
            "raw_z": z,
        })
        ov_spatial[(gx, gz)].append(idx)

    print(f"  fused {len(merged)} unique storefront candidates; snapping to street-facing walls...", flush=True)

    # 3. Snap to building facades and rank by neighborhood character importance
    snapped: list[dict] = []
    for m in merged:
        snap = snap_poi_to_facade(m["raw_x"], m["raw_z"], bldgs, bldg_grid, roads, road_grid, cell)
        if not snap:
            continue
        score = CATEGORY_PRIORITY.get(m["cat"], 40) + (18.0 if m["osm"] else 0.0) + (8.0 if m["outdoor"] else 0.0) + m["conf"] * 12.0
        # Slight boost for branded chains so big corner anchors (Whole Foods, Walgreens, Target, Starbucks) aren't displaced by upstairs tenants
        if m["brand"]:
            score += 6.0
        snapped.append({
            "name": m["name"],
            "brand": m["brand"],
            "cat": m["cat"],
            "conf": round(m["conf"], 2),
            "outdoor": m["outdoor"],
            "addr": m["addr"],
            "score": score,
            **snap,
        })

    # 4. Enforce non-overlapping facade spacing (minimum 4.2 m between signs on same-facing walls!)
    snapped.sort(key=lambda r: (-r["score"], r["name"]))
    kept: list[dict] = []
    slot_grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for r in snapped:
        gx, gz = int(r["x"] // 10), int(r["z"] // 10)
        clash = False
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for prev in slot_grid.get((gx + dx, gz + dz), ()):
                    dist = math.hypot(prev["x"] - r["x"], prev["z"] - r["z"])
                    # Same-facing wall signs need >= 4.4 m clearance; opposite-facing corners need >= 2.2 m
                    same_face = (prev["nx"] * r["nx"] + prev["nz"] * r["nz"]) > 0.5
                    if dist < (4.4 if same_face else 2.2):
                        clash = True
                        break
                if clash:
                    break
        if clash:
            continue
        # Remove temporary ranking field and keep compact record
        rec = {
            "n": r["name"],
            "c": r["cat"],
            "x": r["x"],
            "z": r["z"],
            "nx": r["nx"],
            "nz": r["nz"],
            "w": r["w"],
            "sw": r["sw"],
            "h": r["h"],
        }
        if r["brand"]:
            rec["b"] = r["brand"]
        if r["addr"]:
            rec["a"] = r["addr"]
        if r["outdoor"]:
            rec["out"] = 1
        if r["st"]:
            rec["st"] = r["st"]
        kept.append(rec)
        slot_grid[(gx, gz)].append(r)

    kept.sort(key=lambda r: (r["x"], r["z"], r["n"]))
    print(f"  kept {len(kept)} street-snapped storefronts (from {len(snapped)} snapped)", flush=True)
    return kept


def fuse_plazas(datasf_parks: list[dict], osm_bundle: dict, bldgs, bldg_grid, roads, road_grid, cell: float) -> list[dict]:
    """Combines OSM plazas/town squares + DataSF parks, computes entrance orientation, keepouts & real OSM furniture."""
    raw_plazas: list[dict] = []

    def add_poly(name: str, ptype: str, hood: str, ring_lonlat: list[tuple[float, float]], src: str):
        if len(ring_lonlat) < 3:
            return
        ring = [lonlat_to_world_m(lon, lat) for lon, lat in ring_lonlat]
        ring = simplify_ring(ring, tol=1.0, max_pts=24)
        if len(ring) < 3:
            return
        if poly_signed_area(ring) < 0:
            ring.reverse()
        area = abs(poly_signed_area(ring))
        if area < 140.0 or area > 450_000.0:
            # Skip tiny traffic triangles (<140 m²) and giant regional lands like Golden Gate Park whole polygon (>45 ha)
            return
        cx = sum(p[0] for p in ring) / len(ring)
        cz = sum(p[1] for p in ring) / len(ring)
        raw_plazas.append({
            "name": name.strip(),
            "norm": norm_name(name),
            "ptype": ptype,
            "hood": hood,
            "ring": ring,
            "cx": cx,
            "cz": cz,
            "area": area,
            "src": src,
        })

    # 1. OSM plazas/squares/parks first (highest local fidelity for community squares like Noe Valley Town Square!)
    for el in osm_bundle.get("plazas", []):
        tags = el.get("tags") or {}
        name = (tags.get("name") or "").strip()
        if not name:
            continue
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        pts = [(g["lon"], g["lat"]) for g in geom if "lon" in g and "lat" in g]
        nl = name.lower()
        if tags.get("place") == "square" or (tags.get("highway") == "pedestrian" and tags.get("area") == "yes") or "town square" in nl or "plaza" in nl:
            ptype = "town_square" if "town square" in nl else "civic_plaza"
        elif tags.get("leisure") == "garden":
            ptype = "pocket_park"
        else:
            ptype = "neighborhood_park"
        add_poly(name, ptype, "", pts, "osm")

    # 2. DataSF Recreation & Parks Properties (fills in any park/plaza OSM missed or lacked polygon for)
    for row in datasf_parks:
        name = (row.get("property_name") or "").strip()
        if not name:
            continue
        shape = row.get("shape") or {}
        gtype = shape.get("type")
        coords = shape.get("coordinates")
        if not coords:
            continue
        rings = []
        if gtype == "Polygon":
            rings = [coords[0]]
        elif gtype == "MultiPolygon":
            rings = [poly[0] for poly in coords if poly]
        if not rings:
            continue
        best_r = max(rings, key=len)
        pts = [(pt[0], pt[1]) for pt in best_r]
        pt_str = (row.get("propertytype") or "").lower()
        nl = name.lower()
        if "civic plaza" in pt_str or "plaza" in nl or "square" in nl:
            ptype = "civic_plaza"
        elif "mini park" in pt_str or "garden" in pt_str:
            ptype = "pocket_park"
        else:
            ptype = "neighborhood_park"
        add_poly(name, ptype, (row.get("analysis_neighborhood") or "").strip(), pts, "datasf")

    # 3. Deduplicate overlapping plazas (prefer OSM when both exist, inherit DataSF neighborhood label)
    raw_plazas.sort(key=lambda p: (0 if p["src"] == "osm" else 1, -p["area"]))
    plazas: list[dict] = []
    for p in raw_plazas:
        dup = None
        for q in plazas:
            dist = math.hypot(q["cx"] - p["cx"], q["cz"] - p["cz"])
            if dist < 55.0 and (q["norm"] == p["norm"] or p["norm"] in q["norm"] or q["norm"] in p["norm"]):
                dup = q
                break
            if dist < 24.0 and point_in_poly(p["cx"], p["cz"], q["ring"]):
                dup = q
                break
        if dup:
            if not dup["hood"] and p["hood"]:
                dup["hood"] = p["hood"]
            continue
        plazas.append(p)

    # 4. Index OSM street furniture (benches, Little Free Libraries, fountains, drinking water, farmers markets)
    furn_grid: dict[tuple[int, int], list[tuple[str, float, float]]] = defaultdict(list)
    for el in osm_bundle.get("furniture", []):
        tags = el.get("tags") or {}
        am = tags.get("amenity")
        if am not in ("bench", "public_bookcase", "drinking_water", "fountain", "marketplace"):
            continue
        lon, lat = el.get("lon"), el.get("lat")
        if lon is None or lat is None:
            continue
        fx, fz = lonlat_to_world_m(lon, lat)
        furn_grid[(int(fx // 50), int(fz // 50))].append((am, fx, fz))

    # 5. Enrich each plaza with entrance orientation, oriented bounding frame, interior building keepouts, and OSM furniture
    out_plazas: list[dict] = []
    for p in plazas:
        ring = p["ring"]
        xs = [pt[0] for pt in ring]
        zs = [pt[1] for pt in ring]
        x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)

        # Find edge closest to a street -> plaza entrance & main orientation!
        best_ent = None
        best_d = 999.0
        for i in range(len(ring)):
            ax, az = ring[i]
            bx, bz = ring[(i + 1) % len(ring)]
            elen = math.hypot(bx - ax, bz - az)
            if elen < 3.0:
                continue
            mx, mz = (ax + bx) * 0.5, (az + bz) * 0.5
            rd = nearest_road(mx, mz, roads, road_grid, cell, max_d=38.0)
            if not rd:
                continue
            rx, rz, d_road, st_name, _, _, _, _, _ = rd
            if d_road < best_d:
                best_d = d_road
                # Edge tangent u along street frontage, inward normal v into plaza
                ux, uz = (bx - ax) / elen, (bz - az) / elen
                nx, nz = uz, -ux  # candidate normal
                # Make (nx, nz) point TOWARD the street (outward from plaza)
                if nx * (rx - mx) + nz * (rz - mz) < 0:
                    nx, nz = -nx, -nz
                    ux, uz = -ux, -uz
                best_ent = (mx, mz, nx, nz, ux, uz, st_name)

        if best_ent:
            ex, ez, enx, enz, ux, uz, st_name = best_ent
        else:
            ex, ez, enx, enz, ux, uz, st_name = p["cx"], z1, 0.0, 1.0, 1.0, 0.0, ""

        # Compute extents along (u, inward -n)
        vx, vz = -enx, -enz
        us = [(pt[0] - p["cx"]) * ux + (pt[1] - p["cz"]) * uz for pt in ring]
        vs = [(pt[0] - p["cx"]) * vx + (pt[1] - p["cz"]) * vz for pt in ring]
        lu = max(6.0, max(us) - min(us))
        lv = max(6.0, max(vs) - min(vs))

        # Interior building keep-outs (e.g., park restrooms, kiosks, fieldhouses) so procedural props never clip them!
        keepouts: list[list[float]] = []
        cand_b = set()
        for gx in range(int(math.floor(x0 / cell)), int(math.floor(x1 / cell)) + 1):
            for gz in range(int(math.floor(z0 / cell)), int(math.floor(z1 / cell)) + 1):
                cand_b.update(bldg_grid.get((gx, gz), ()))
        for bidx in cand_b:
            b = bldgs[bidx]
            if b["cx"] < x0 - 4 or b["cx"] > x1 + 4 or b["cz"] < z0 - 4 or b["cz"] > z1 + 4:
                continue
            if point_in_poly(b["cx"], b["cz"], ring):
                keepouts.append([round(b["cx"], 1), round(b["cz"], 1), round(b["r"] + 1.2, 1)])

        # Attach real OSM furniture inside/bordering this plaza
        benches: list[list[float]] = []
        bookcases: list[list[float]] = []
        fountains: list[list[float]] = []
        water: list[list[float]] = []
        has_market = False
        for gx in range(int(math.floor((x0 - 8) / 50)), int(math.floor((x1 + 8) / 50)) + 1):
            for gz in range(int(math.floor((z0 - 8) / 50)), int(math.floor((z1 + 8) / 50)) + 1):
                for am, fx, fz in furn_grid.get((gx, gz), ()):
                    if fx < x0 - 6 or fx > x1 + 6 or fz < z0 - 6 or fz > z1 + 6:
                        continue
                    inside = point_in_poly(fx, fz, ring)
                    if not inside:
                        # Accept within 4 m of plaza perimeter
                        near_edge = any(project_to_seg(fx, fz, ring[i][0], ring[i][1], ring[(i + 1) % len(ring)][0], ring[(i + 1) % len(ring)][1])[2] < 4.0 for i in range(len(ring)))
                        if not near_edge:
                            continue
                    if am == "bench" and len(benches) < 32:
                        benches.append([round(fx, 1), round(fz, 1)])
                    elif am == "public_bookcase" and len(bookcases) < 4:
                        bookcases.append([round(fx, 1), round(fz, 1)])
                    elif am == "fountain" and len(fountains) < 4:
                        fountains.append([round(fx, 1), round(fz, 1)])
                    elif am == "drinking_water" and len(water) < 6:
                        water.append([round(fx, 1), round(fz, 1)])
                    elif am == "marketplace":
                        has_market = True

        # Refine archetype for small squares/gardens
        ptype = p["ptype"]
        if ptype == "neighborhood_park" and p["area"] < 1400.0:
            ptype = "pocket_park"
        if has_market and ptype in ("civic_plaza", "neighborhood_park"):
            ptype = "market_plaza"

        rec = {
            "n": p["name"],
            "t": ptype,
            "x": round(p["cx"], 1),
            "z": round(p["cz"], 1),
            "ex": round(ex, 1),
            "ez": round(ez, 1),
            "nx": round(enx, 3),
            "nz": round(enz, 3),
            "lu": round(lu, 1),
            "lv": round(lv, 1),
            "a": round(p["area"]),
            "p": [[round(pt[0], 1), round(pt[1], 1)] for pt in ring],
        }
        if p["hood"]:
            rec["h"] = p["hood"]
        if st_name:
            rec["st"] = st_name
        if keepouts:
            rec["k"] = keepouts
        if benches:
            rec["bn"] = benches
        if bookcases:
            rec["bk"] = bookcases
        if fountains:
            rec["fn"] = fountains
        if water:
            rec["wt"] = water
        if has_market:
            rec["mk"] = 1
        out_plazas.append(rec)

    out_plazas.sort(key=lambda r: (r["x"], r["z"], r["n"]))
    print(f"  built {len(out_plazas)} SF plazas/parks with {sum(len(p.get('bn', [])) for p in out_plazas)} real OSM benches", flush=True)
    return out_plazas


def sf_bounds_from_squares() -> tuple[float, float, float, float]:
    sq = json.loads(SF_SQUARES.read_text())
    lons, lats = [], []
    for name in sq["lidar"]:
        ek, nk = map(float, name.split("_"))
        e, n = ek * 1000.0, nk * 1000.0
        for de, dn in ((0, 0), (1000, 0), (0, 1000), (1000, 1000)):
            lon, lat = FROM_UTM.transform(e + de, n + dn)
            lons.append(lon)
            lats.append(lat)
    return (min(lons), min(lats), max(lons), max(lats))


def write_brotli_json(path: Path, payload: dict):
    import subprocess

    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    # Use Node's built-in brotli (quality 11) so we need no extra Python brotli wheel!
    proc = subprocess.run(
        ["node", "-e", "const z=require('zlib'),fs=require('fs');const d=fs.readFileSync(0);fs.writeFileSync(process.argv[1],z.brotliCompressSync(d,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}));", str(path)],
        input=raw,
        check=True,
    )
    _ = proc
    print(f"  wrote {path} ({len(raw)/1024:.0f} KB JSON -> {path.stat().st_size/1024:.0f} KB .br)", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Extract SF storefronts & plazas from Overture Maps + OSM + DataSF")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--inputs", type=Path, default=DEFAULT_INPUTS)
    ap.add_argument("--graphs", type=Path, default=DEFAULT_GRAPHS)
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    ap.add_argument("--refresh", action="store_true", help="Re-fetch Overture and OSM source caches")
    args = ap.parse_args()

    t0 = time.time()
    bounds = sf_bounds_from_squares()
    print(f"SF lidar bounds: W={bounds[0]:.5f} S={bounds[1]:.5f} E={bounds[2]:.5f} N={bounds[3]:.5f}", flush=True)

    overture_raw = fetch_overture_places(bounds, args.cache, refresh=args.refresh)
    datasf_parks = fetch_datasf_parks(args.cache)
    osm_bundle = fetch_osm_sf(bounds, args.cache, refresh=args.refresh)

    bldgs, bldg_grid, roads, road_grid, cell = load_local_geometry(args.inputs, args.graphs)
    shops = fuse_storefronts(overture_raw, osm_bundle.get("pois", []), bldgs, bldg_grid, roads, road_grid, cell)
    plazas = fuse_plazas(datasf_parks, osm_bundle, bldgs, bldg_grid, roads, road_grid, cell)

    payload = {
        "version": 1,
        "frame": "10n4250",
        "sources": {
            "overture": OVERTURE_RELEASE,
            "osm": "ODbL-1.0",
            "datasf": "gtr9-ntp6 (PDDL-1.0)",
        },
        "shops": shops,
        "plazas": plazas,
    }
    write_brotli_json(args.out, payload)
    print(f"Done in {time.time() - t0:.1f}s.", flush=True)


if __name__ == "__main__":
    main()
