"""build/sky_hdr.npy (float16 HDR equirect) -> assets/sky/sky.webp (log encoded, see src/sky.js) + preview."""
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A, M = 0.02, 64.0
a = np.load(os.path.join(ROOT, "build", "sky_hdr.npy")).astype(np.float32)
a = np.nan_to_num(a, nan=0.0, posinf=M, neginf=0.0)
print("shape", a.shape, "mean", a.mean(), "max", a.max(), "p99", np.percentile(a, 99))
y = np.log1p(np.clip(a, 0, M) / A) / np.log1p(M / A)
rng = np.random.default_rng(1)
y8 = np.clip(y * 255 + rng.uniform(-0.5, 0.5, y.shape), 0, 255).astype(np.uint8)
q = int(sys.argv[1]) if len(sys.argv) > 1 else 92
Image.fromarray(y8).save(os.path.join(ROOT, "assets", "sky", "sky.webp"), quality=q, method=6)
print("webp bytes", os.path.getsize(os.path.join(ROOT, "assets", "sky", "sky.webp")))
# preview: simple filmic tonemap
t = a * 1.3
t = (t * (2.51 * t + 0.03)) / (t * (2.43 * t + 0.59) + 0.14)
t = np.clip(t, 0, 1) ** (1 / 2.2)
Image.fromarray((t * 255).astype(np.uint8)).save(os.path.join(ROOT, "build", "sky_preview.png"))
