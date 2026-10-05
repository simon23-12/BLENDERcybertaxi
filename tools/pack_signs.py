"""Pack build/signs/*.png into assets/ui/signs.webp (+ signs.json with pixel rects)."""
import os, json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "signs")
DST = os.path.join(ROOT, "assets", "ui")
AW, AH, PAD = 4096, 2048, 8

idx = json.load(open(os.path.join(SRC, "index.json")))
items = []
for s in idx:
    p = os.path.join(SRC, s["name"] + ".png")
    if os.path.exists(p):
        im = Image.open(p).convert("RGB")
        im = im.resize((int(im.width * 0.72) // 2 * 2, int(im.height * 0.72) // 2 * 2), Image.LANCZOS)
        items.append((s["name"], im))
items.sort(key=lambda t: -t[1].height)
atlas = Image.new("RGB", (AW, AH), (0, 0, 0))
x = y = PAD
row_h = 0
out = []
for name, im in items:
    w, h = im.size
    if x + w + PAD > AW:
        x = PAD; y += row_h + PAD; row_h = 0
    if y + h + PAD > AH:
        raise SystemExit("atlas full")
    atlas.paste(im, (x, y))
    import numpy as np
    a = np.asarray(im).astype(np.float32) / 255.0
    lin = a ** 2.2
    lum = lin.mean(axis=2)
    m = lum > np.percentile(lum, 85)
    col = (lin[m].mean(axis=0) if m.any() else lin.reshape(-1, 3).mean(axis=0))
    col = col / max(col.max(), 1e-3)
    out.append({"name": name, "x": x, "y": y, "w": w, "h": h, "color": [round(float(c), 3) for c in col]})
    x += w + PAD; row_h = max(row_h, h)
atlas.save(os.path.join(DST, "signs.webp"), quality=90, method=5)
json.dump({"atlas": [AW, AH], "signs": out}, open(os.path.join(DST, "signs.json"), "w"), indent=1)
print("packed", len(out), "signs; used height", y + row_h, "of", AH)
