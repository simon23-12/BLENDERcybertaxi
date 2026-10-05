"""Combine the Cycles facade passes into the 4 game textures per facade type.

  <t>_a  albedo (AO baked in)            RGB  sRGB
  <t>_n  tangent normal xy + roughness   RGB  linear/data
  <t>_e  emissive (strength / 8)         RGB  sRGB
  <t>_m  meta: R window mask, G metal, B relief height   (data, half res)

usage: python3 tools/pack_facades.py
"""
import os, json, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "facades")
DST = os.path.join(ROOT, "assets", "tex")
os.makedirs(DST, exist_ok=True)

NAMES = ["glass", "brutal", "industrial", "neon", "deco", "monolith", "roof"]
CELLS = [[16, 8], [8, 8], [1, 1], [16, 16], [8, 4], [1, 1], [1, 1]]   # window cells (cols, rows) per tile
PX_PER_M = 64.0   # at 2048 px / 32 m


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055) * 255.0


def load(t, name, mode="RGB"):
    return Image.open(os.path.join(SRC, f"f{t}_{name}.png")).convert(mode) if mode else Image.open(os.path.join(SRC, f"f{t}_{name}.png"))


def blur(a, r):
    out = np.empty_like(a)
    im = Image.fromarray(np.clip(a * 65535, 0, 65535).astype(np.uint16))
    # PIL has no 16-bit gaussian: do separable box via numpy FFT-free approach (wrap-safe, tile is periodic)
    k = int(max(1, r))
    arr = a.copy()
    for _ in range(3):
        for ax in (0, 1):
            arr = (np.roll(arr, -k, ax) + arr + np.roll(arr, k, ax)) / 3.0
    return arr


def pack(t, sizes=(2048, 1024)):
    albedo = np.asarray(load(t, "albedo")).astype(np.float32)
    ao = np.asarray(load(t, "ao")).astype(np.float32)[..., 0] / 255.0
    ao = blur(ao, 1)
    rough = np.asarray(load(t, "rough")).astype(np.float32)[..., 0] / 255.0
    nrm = np.asarray(load(t, "normal")).astype(np.float32) / 255.0 * 2 - 1
    emit = np.asarray(load(t, "emit")).astype(np.float32)
    meta = np.asarray(load(t, "meta")).astype(np.float32) / 255.0
    h16 = np.asarray(Image.open(os.path.join(SRC, f"f{t}_height.png"))).astype(np.float32) / 65535.0
    if h16.ndim == 3:
        h16 = h16[..., 0]
    n = albedo.shape[0]

    # ---- albedo * AO (in linear space), slight cavity darkening
    aoc = 0.15 + 0.85 * np.clip(ao, 0, 1) ** 1.35
    al = lin(albedo) * aoc[..., None]
    A = srgb(al)

    # ---- normal: Blender (bump+bevel) + relief gradient from the height pass
    nz = np.maximum(nrm[..., 2], 0.2)
    pb = np.stack([nrm[..., 0] / nz, nrm[..., 1] / nz], -1)
    relief = (3.0 - 6.0 * h16)                        # metres towards the viewer
    relief = blur(relief, 1)
    ry = np.gradient(relief, axis=0)                  # rows go down -> up = -row
    rx = np.gradient(relief, axis=1)
    k = PX_PER_M * (n / 2048.0)                       # px per metre
    ph = np.stack([-rx * k, ry * k], -1)
    ph = np.clip(ph, -2.2, 2.2)
    p = pb + ph * 0.9
    nn = np.concatenate([p, np.ones_like(p[..., :1])], -1)
    nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
    N = np.dstack([nn[..., 0] * 0.5 + 0.5, nn[..., 1] * 0.5 + 0.5, rough]) * 255.0

    E = emit
    rel01 = np.clip((relief + 3.0) / 6.0, 0, 1)
    M = np.dstack([meta[..., 0], meta[..., 1], rel01]) * 255.0

    for s in sizes:
        def rs(a, res=s, resample=Image.LANCZOS):
            im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
            return im.resize((res, res), resample) if res != n else im
        # wrap-safe downscale: tile 3x3 then crop -> avoids edge seams
        def rs_wrap(a, res=s):
            if res == n:
                return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
            big = np.tile(a, (3, 3, 1))
            im = Image.fromarray(np.clip(big, 0, 255).astype(np.uint8)).resize((res * 3, res * 3), Image.LANCZOS)
            return im.crop((res, res, res * 2, res * 2))
        tag = "2k" if s == 2048 else "1k"
        rs_wrap(A).save(os.path.join(DST, f"f{t}_a_{tag}.webp"), quality=90, method=5)
        rs_wrap(N).save(os.path.join(DST, f"f{t}_n_{tag}.webp"), quality=92, method=5)
        rs_wrap(E).save(os.path.join(DST, f"f{t}_e_{tag}.webp"), quality=90, method=5)
        if s == 1024:
            rs_wrap(M, 512).save(os.path.join(DST, f"f{t}_m.webp"), quality=95, method=5)
    print("packed", t, NAMES[t])


if __name__ == "__main__":
    ts = [int(x) for x in sys.argv[1:]] or [t for t in range(7) if os.path.exists(os.path.join(SRC, f"f{t}_height.png"))]
    for t in ts:
        pack(t)
    meta = {"tile": 32.0, "emitMax": 8.0, "types": [{"name": NAMES[t], "cells": CELLS[t]} for t in range(7)]}
    json.dump(meta, open(os.path.join(DST, "facades.json"), "w"), indent=1)
