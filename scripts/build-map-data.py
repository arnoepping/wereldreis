"""Build the globe's map data from Natural Earth. Run once; outputs are committed.

    python3 -m venv .venv && .venv/bin/pip install pillow numpy
    .venv/bin/python scripts/build-map-data.py
"""
import io, json, os, urllib.request, zipfile
import numpy as np
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", ".cache")
DATA = os.path.join(ROOT, "app", "data")
TILES = os.path.join(ROOT, "app", "tiles")
GEOJSON = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NE2 = "https://naciscdn.org/naturalearth/50m/raster/NE2_50M_SR_W.zip"


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("downloading", url)
        urllib.request.urlretrieve(url, path)
    return path


def load(name):
    return json.load(open(fetch(GEOJSON + name + ".geojson", name + ".geojson")))


def rnd(c, p):
    if isinstance(c[0], (int, float)):
        return [round(c[0], p), round(c[1], p)]
    return [rnd(x, p) for x in c]


def write(path, features):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"type": "FeatureCollection", "features": features}, open(path, "w"), separators=(",", ":"))


def area(ring):
    return abs(sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1))) / 2


def bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return [min(xs), min(ys), max(xs), max(ys)]


def countries():
    out = []
    for f in load("ne_50m_admin_0_countries")["features"]:
        p, g = f["properties"], f["geometry"]
        if p["CONTINENT"] == "Antarctica":
            continue
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        big = max(polys, key=lambda q: area(q[0]))
        bb, ba = bbox(big[0]), area(big[0])
        for q in polys:  # keep nearby large islands, drop overseas territories
            b = bbox(q[0])
            if area(q[0]) >= 0.15 * ba and abs((b[0] + b[2]) / 2 - (bb[0] + bb[2]) / 2) < 40:
                bb = [min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3])]
        out.append({"type": "Feature",
                    "properties": {"name": p["NAME"], "iso": p["ADM0_A3"], "cont": p["CONTINENT"], "bbox": [round(x, 2) for x in bb]},
                    "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"], 2)}})
    write(os.path.join(DATA, "countries.json"), out)


def borders():
    feats = [{"type": "Feature", "properties": {}, "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"], 3)}}
             for f in load("ne_10m_admin_0_boundary_lines_land")["features"]]
    write(os.path.join(DATA, "borders.json"), feats)


def lakes():
    feats = [{"type": "Feature", "properties": {}, "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"], 3)}}
             for f in load("ne_10m_lakes")["features"] if (f["properties"].get("scalerank") or 0) <= 6]
    write(os.path.join(DATA, "lakes.json"), feats)


def regions():
    by_iso = {}
    for f in load("ne_10m_admin_1_states_provinces")["features"]:
        iso = f["properties"]["adm0_a3"]
        by_iso.setdefault(iso, []).append({"type": "Feature", "properties": {"name": f["properties"]["name"]},
                                           "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"], 3)}})
    for iso, feats in by_iso.items():
        write(os.path.join(DATA, "regions", iso + ".json"), feats)


def tiles():
    Image.MAX_IMAGE_PIXELS = None
    path = fetch(NE2, "NE2_50M_SR_W.zip")
    with zipfile.ZipFile(path) as z:
        tif = next(n for n in z.namelist() if n.endswith(".tif"))
        src = Image.open(io.BytesIO(z.read(tif))).convert("RGB")
    src = ImageEnhance.Contrast(ImageEnhance.Color(src).enhance(1.4)).enhance(1.08)
    n = 8192
    src = src.resize((n, src.height), Image.LANCZOS)
    a = np.asarray(src).astype(np.float32)
    h = a.shape[0]
    ys = np.arange(n) + 0.5
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * ys / n))))
    r = (90 - lat) / 180 * h - 0.5
    r0 = np.clip(np.floor(r).astype(int), 0, h - 1)
    r1 = np.clip(r0 + 1, 0, h - 1)
    t = (r - np.floor(r))[:, None, None]
    out = np.empty((n, n, 3), np.uint8)
    for s in range(0, n, 1024):
        sl = slice(s, s + 1024)
        out[sl] = np.clip(a[r0[sl]] * (1 - t[sl]) + a[r1[sl]] * t[sl], 0, 255).astype(np.uint8)
    merc = Image.fromarray(out)
    for zoom in range(5):
        k = 2 ** zoom
        img = merc if zoom == 4 else merc.resize((512 * k, 512 * k), Image.LANCZOS)
        for x in range(k):
            os.makedirs(os.path.join(TILES, str(zoom), str(x)), exist_ok=True)
            for y in range(k):
                img.crop((x * 512, y * 512, x * 512 + 512, y * 512 + 512)).save(
                    os.path.join(TILES, str(zoom), str(x), f"{y}.jpg"), quality=80, optimize=True, progressive=True)


if __name__ == "__main__":
    countries(); borders(); lakes(); regions(); tiles()
    print("done")
