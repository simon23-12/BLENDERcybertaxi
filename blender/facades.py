"""Render seamless PBR facade tiles with Cycles (one tile = 32 x 32 m, 2048 px).

usage: Blender -b -P blender/facades.py -- <type 0..6 | all> [res]
Outputs build/facades/f<type>_{albedo,normal,rough,emit,ao,meta}.png
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

TILE = 32.0
OUT = os.path.join(BUILD, "facades")
os.makedirs(OUT, exist_ok=True)

LIN = lambda h: srgb(h)
# emission palettes (linear), strength lives in the material
WARM = [LIN(0xFFC27A), LIN(0xFFD9A0), LIN(0xFFAA55), LIN(0xFFE6C8)]
COOL = [LIN(0x9CD3FF), LIN(0xBFE6FF), LIN(0x7FB5FF)]
NEON = [LIN(0xFF2BD6), LIN(0x18F0FF), LIN(0xFF6A1F), LIN(0x7B5CFF), LIN(0x3DFF9A)]


def pick(rng, pal):
    return rng.choice(pal)


def mats():
    M = {}
    M["concrete"] = PBR("concrete", 0x55555B, 0.88, 0.0, grunge=1.0, bump=0.35)
    M["concrete_d"] = PBR("concrete_d", 0x26272D, 0.85, 0.0, grunge=1.0, bump=0.3)
    M["concrete_w"] = PBR("concrete_w", 0x6E6A66, 0.9, 0.0, grunge=1.0, bump=0.35)
    M["steel"] = PBR("steel", 0x2A2D33, 0.38, 0.9, grunge=0.7, bump=0.1)
    M["steel_l"] = PBR("steel_l", 0x7C838C, 0.45, 0.9, grunge=0.8, bump=0.1)
    M["rust"] = PBR("rust", 0x6B3A22, 0.75, 0.5, grunge=1.0, bump=0.3)
    M["glass"] = PBR("glass", 0x0A141C, 0.06, 0.85, grunge=0.35, bump=0.02)
    M["glass_t"] = PBR("glass_t", 0x10303A, 0.05, 0.9, grunge=0.3, bump=0.02)
    M["gold"] = PBR("gold", 0xE0A650, 0.3, 1.0, grunge=0.4, bump=0.05)
    M["yellow"] = PBR("yellow", 0xD9A81A, 0.55, 0.2, grunge=0.9, bump=0.1)
    M["blue_p"] = PBR("blue_p", 0x2457A8, 0.5, 0.4, grunge=0.7, bump=0.1)
    M["red_p"] = PBR("red_p", 0xA02A1E, 0.55, 0.3, grunge=0.7, bump=0.1)
    M["black"] = PBR("black", 0x050507, 0.15, 0.85, grunge=0.25, bump=0.0)
    M["panel"] = PBR("panel", 0x0C0D12, 0.2, 0.8, grunge=0.5, bump=0.05)
    M["dark"] = PBR("dark", 0x0B0B0D, 0.9, 0.0)
    # emissive
    M["lamp"] = PBR("lamp", 0x000000, 0.4, 0.0, emit=2.0, emit_vc=True)
    M["lampw"] = PBR("lampw", 0x000000, 0.4, 0.0, emit=2.0, emit_vc=True, window=True)
    M["neon"] = PBR("neon", 0x000000, 0.4, 0.0, emit=6.0, emit_vc=True)
    return M


# ------------------------------------------------------------------------------------------------
# facade types
# ------------------------------------------------------------------------------------------------
def glass_tower(B, M, rng):
    """0: curtain wall, 16 x 8 panes (2 x 4 m), lit office floors."""
    W = TILE
    B.box(0, W, 0, W, 0.5, 1.0, M["glass"])
    for j in range(8):
        for i in range(16):
            x0, z0 = i * 2, j * 4
            glass = M["glass_t"] if rng.random() < 0.18 else None
            if glass:
                B.box(x0, x0 + 2, z0 + 0.5, z0 + 3.5, 0.45, 0.5, glass)
            if rng.random() < 0.85:                              # potentially lit
                c = pick(rng, WARM) if rng.random() < 0.78 else pick(rng, COOL)
                inten = rng.uniform(0.35, 1.0)
                col = tuple(v * inten for v in c)
                # soft fill + two ceiling strips + furniture
                B.box(x0 + 0.1, x0 + 1.9, z0 + 0.55, z0 + 3.45, 0.42, 0.45, M["lampw"], tuple(v * 0.3 for v in col))
                for sz in (z0 + 3.1, z0 + 2.0):
                    B.box(x0 + 0.25, x0 + 1.75, sz, sz + 0.1, 0.38, 0.42, M["lampw"], col)
                for _ in range(rng.randint(1, 3)):
                    fw, fh = rng.uniform(0.3, 0.9), rng.uniform(0.3, 1.1)
                    fx = x0 + rng.uniform(0.1, 1.9 - fw)
                    B.box(fx, fx + fw, z0 + 0.55, z0 + 0.55 + fh, 0.3, 0.42, M["dark"])
                if rng.random() < 0.25:                          # blinds
                    bh = rng.uniform(0.4, 2.2)
                    B.box(x0 + 0.05, x0 + 1.95, z0 + 3.45 - bh, z0 + 3.45, 0.3, 0.38, M["steel"])
        for i in range(16):                                      # mullions
            x = i * 2
            B.box(x - 0.07, x + 0.07, j * 4, j * 4 + 4, -0.3, 0.5, M["steel"])
    for j in range(8):                                           # spandrels / slabs
        z = j * 4
        B.box(0, W, z - 0.55, z + 0.55, -0.22, 0.5, M["panel"])
        B.box(0, W, z + 0.55, z + 0.62, -0.42, -0.22, M["steel_l"])
        B.box(0, W, z - 0.62, z - 0.55, -0.42, -0.22, M["steel_l"])
    for i in range(16):                                          # long thin fins every other mullion
        if i % 2 == 0:
            B.box(i * 2 - 0.03, i * 2 + 0.03, 0, W, -0.55, -0.3, M["steel"])


def brutal(B, M, rng):
    """1: concrete grid, recessed windows, balconies, AC units, drain pipes. 8x8 cells of 4 m."""
    W = TILE
    B.box(0, W, 0, W, 0.9, 1.8, M["concrete_d"])
    for j in range(8):
        for i in range(8):
            x0, z0 = i * 4, j * 4
            wx0, wx1, wz0, wz1 = x0 + 0.8, x0 + 3.2, z0 + 0.9, z0 + 3.1
            # wall frame around opening
            B.box(x0, x0 + 0.8, z0, z0 + 4, -0.1, 0.9, M["concrete"])
            B.box(x0 + 3.2, x0 + 4, z0, z0 + 4, -0.1, 0.9, M["concrete"])
            B.box(x0 + 0.8, x0 + 3.2, z0, z0 + 0.9, -0.1, 0.9, M["concrete"])
            B.box(x0 + 0.8, x0 + 3.2, z0 + 3.1, z0 + 4, -0.1, 0.9, M["concrete"])
            # window: glass at the back, frame, mullion
            B.box(wx0, wx1, wz0, wz1, 0.9, 1.0, M["glass"])
            for (a, b, c, d) in ((wx0, wx1, wz0, wz0 + 0.1), (wx0, wx1, wz1 - 0.1, wz1),
                                 (wx0, wx0 + 0.1, wz0, wz1), (wx1 - 0.1, wx1, wz0, wz1)):
                B.box(a, b, c, d, 0.35, 1.0, M["steel"])
            B.box((wx0 + wx1) / 2 - 0.05, (wx0 + wx1) / 2 + 0.05, wz0, wz1, 0.5, 1.0, M["steel"])
            if rng.random() < 0.8:
                c = pick(rng, WARM + COOL[:1] + NEON[:1] + NEON[2:3]) if rng.random() < 0.9 else pick(rng, NEON)
                inten = rng.uniform(0.3, 1.0)
                col = tuple(v * inten for v in c)
                B.box(wx0 + 0.1, wx1 - 0.1, wz0 + 0.1, wz1 - 0.1, 0.8, 0.88, M["lampw"], col)
                if rng.random() < 0.6:                           # curtains / silhouettes
                    cw = rng.uniform(0.3, 1.0)
                    cx = wx0 + 0.1 if rng.random() < 0.5 else wx1 - 0.1 - cw
                    B.box(cx, cx + cw, wz0 + 0.1, wz1 - 0.1 - rng.uniform(0, 0.8), 0.6, 0.8, M["dark"])
            # balcony slab + rails
            if rng.random() < 0.45:
                B.box(x0 + 0.5, x0 + 3.5, z0 + 0.5, z0 + 0.9, -0.9, 0.0, M["concrete_w"])
                B.box(x0 + 0.5, x0 + 3.5, z0 + 0.9, z0 + 1.0, -0.9, -0.82, M["steel"])
                B.box(x0 + 0.5, x0 + 3.5, z0 + 1.0, z0 + 1.9, -0.95, -0.9, M["steel"])
                for k in range(9):
                    px = x0 + 0.52 + k * 0.37
                    B.box(px, px + 0.05, z0 + 0.9, z0 + 1.9, -0.95, -0.82, M["steel"])
            # AC unit
            if rng.random() < 0.4:
                ax = x0 + rng.choice([0.0, 0.1, 3.0, 3.1])
                B.box(ax, ax + 0.9, z0 + 0.1, z0 + 0.7, -0.6, 0.0, M["steel_l"])
                B.cyl_y(ax + 0.45, z0 + 0.4, 0.22, -0.65, -0.55, M["black"])
            if rng.random() < 0.1:                               # little red/blue lamp
                B.box(x0 + 3.5, x0 + 3.62, z0 + 3.5, z0 + 3.62, -0.2, -0.1, M["lamp"],
                      pick(rng, [LIN(0xFF2020), LIN(0x3070FF)]))
    for x in (0.0, 16.0):                                        # drain pipes
        B.cyl_z(x, 0, TILE, -0.35, 0.14, M["steel"])
        for k in range(16):
            B.cyl_z(x, k * 2 - 0.05, k * 2 + 0.05, -0.35, 0.2, M["steel_l"])
    for j in range(8):                                           # horizontal cable
        B.cyl_x(0, TILE, j * 4 + 3.9, -0.25, 0.04, M["black"])


def industrial(B, M, rng):
    """2: pipes, ducts, vent fans, catwalks, hazard stripes."""
    W = TILE
    B.box(0, W, 0, W, 0.4, 1.2, M["steel"])
    for k in range(64):                                          # corrugation ribs
        B.box(0, W, k * 0.5, k * 0.5 + 0.22, -0.12, 0.4, M["steel_l"])
    # big ducts
    for z in (5.0, 13.5, 23.0):
        B.cyl_x(0, W, z, -1.2, 1.0, M["steel_l"], seg=20)
        for x in range(0, 32, 4):
            B.cyl_x(x - 0.1, x + 0.1, z, -1.2, 1.12, M["steel"], seg=20)
        for x in (3, 11, 19, 27):
            B.box(x - 0.2, x + 0.2, z - 2.2, z, -1.3, -0.5, M["steel"])
    # vertical pipe bundles
    pipe_x = [1.6, 2.2, 3.0, 9.5, 10.1, 17.0, 17.8, 18.4, 24.0, 24.9, 29.5]
    pm = [M["rust"], M["blue_p"], M["steel_l"], M["red_p"], M["yellow"]]
    for k, x in enumerate(pipe_x):
        m = pm[k % len(pm)]
        r = rng.uniform(0.14, 0.32)
        B.cyl_z(x, 0, W, -0.9 - rng.uniform(0, 0.5), r, m)
        for z in range(1, 32, 3):
            B.cyl_z(x, z - 0.12, z + 0.12, -0.9, r + 0.07, M["steel"])
    # vent fans
    for (x, z) in ((7.0, 9.0), (21.0, 9.0), (7.0, 27.5), (14.0, 18.5), (27.0, 17.0)):
        B.cyl_y(x, z, 1.5, -0.8, -0.2, M["steel_l"], seg=24)
        B.cyl_y(x, z, 1.25, -0.9, -0.5, M["black"], seg=24)
        for k in range(7):
            a = k * math.pi / 7
            B.box(x - 1.2, x + 1.2, z - 0.05, z + 0.05, -0.85, -0.6, M["steel"], rot=a)
        B.cyl_y(x, z, 0.25, -1.0, -0.6, M["steel_l"])
    # catwalk with rails
    cz = 16.0
    B.box(0, W, cz, cz + 0.12, -2.2, -0.4, M["steel"])
    B.box(0, W, cz + 1.0, cz + 1.08, -2.2, -2.12, M["steel_l"])
    for x in np.arange(0, W, 1.0):
        B.box(x, x + 0.06, cz, cz + 1.05, -2.2, -2.12, M["steel"])
    for x in np.arange(0, W, 2.0):
        B.box(x, x + 0.1, cz - 1.4, cz, -2.15, -0.4, M["steel"])
    # hazard stripe band (yellow / black blocks)
    for x in range(0, 32, 2):
        B.box(x, x + 1, 30.2, 31.0, -0.25, 0.0, M["yellow"] if (x // 2) % 2 == 0 else M["black"])
    # warning lights & slits
    for x in (4, 12, 20, 28):
        for z in (2.5, 11, 20.5, 29):
            B.box(x, x + 0.3, z, z + 0.3, -0.35, -0.2, M["lamp"], pick(rng, [LIN(0xFF7A18), LIN(0xFF2A18), LIN(0xFFD070)]))
    for (x, z, w) in ((12, 3.0, 5), (24, 21.5, 4), (3, 26.0, 3.5)):
        B.box(x, x + w, z, z + 0.45, -0.1, 0.35, M["lamp"], LIN(0xFFB060))


def neon_resid(B, M, rng):
    """3: dense residential megablock, 16x16 cells of 2 m."""
    W = TILE
    B.box(0, W, 0, W, 0.5, 1.2, M["concrete_d"])
    for j in range(16):
        for i in range(16):
            x0, z0 = i * 2, j * 2
            B.box(x0 + 0.38, x0 + 1.62, z0 + 0.55, z0 + 1.55, 0.3, 0.5, M["glass"])
            for (a, b, c, d) in ((x0 + 0.3, x0 + 1.7, z0 + 0.47, z0 + 0.58), (x0 + 0.3, x0 + 1.7, z0 + 1.52, z0 + 1.63),
                                 (x0 + 0.3, x0 + 0.4, z0 + 0.47, z0 + 1.63), (x0 + 1.6, x0 + 1.7, z0 + 0.47, z0 + 1.63)):
                B.box(a, b, c, d, -0.12, 0.5, M["concrete_w"])
            if rng.random() < 0.82:
                r = rng.random()
                c = pick(rng, WARM) if r < 0.5 else (pick(rng, NEON) if r < 0.75 else pick(rng, COOL))
                inten = rng.uniform(0.3, 1.0)
                col = tuple(v * inten for v in c)
                B.box(x0 + 0.42, x0 + 1.58, z0 + 0.58, z0 + 1.5, 0.22, 0.28, M["lampw"], col)
                if rng.random() < 0.5:
                    cw = rng.uniform(0.2, 0.7)
                    cx = x0 + 0.42 + rng.uniform(0, 1.16 - cw)
                    B.box(cx, cx + cw, z0 + 0.58, z0 + 0.58 + rng.uniform(0.3, 0.9), 0.15, 0.22, M["dark"])
            if rng.random() < 0.3:                               # AC unit
                ax = x0 + rng.choice([0.05, 1.05])
                B.box(ax, ax + 0.8, z0 + 0.05, z0 + 0.5, -0.5, -0.1, M["steel_l"])
                B.cyl_y(ax + 0.4, z0 + 0.28, 0.17, -0.55, -0.45, M["black"], seg=10)
            if rng.random() < 0.18:                              # small balcony rail
                B.box(x0 + 0.2, x0 + 1.8, z0 + 0.5, z0 + 0.58, -0.7, -0.1, M["steel"])
                B.box(x0 + 0.2, x0 + 1.8, z0 + 0.58, z0 + 1.1, -0.72, -0.68, M["steel"])
        B.box(0, W, j * 2 - 0.08, j * 2 + 0.1, -0.22, 0.0, M["concrete"])
    # neon tubes
    for _ in range(9):
        z = rng.uniform(1, 31)
        x = rng.uniform(0, 28)
        ln = rng.choice([4, 6, 8, 12, 16])
        c = pick(rng, NEON)
        B.box(x, x + ln, z, z + 0.1, -0.45, -0.32, M["neon"], c)
        for k in range(0, ln, 3):
            B.box(x + k, x + k + 0.08, z - 0.15, z + 0.1, -0.35, -0.22, M["steel"])
    # hanging neon signs (vertical boards)
    for _ in range(7):
        x = rng.uniform(1, 30)
        z = rng.uniform(3, 27)
        w, h = 0.5, rng.choice([2.0, 3.0, 4.0])
        c = pick(rng, NEON)
        B.box(x, x + w, z, z + h, -1.3, -1.0, M["black"])
        n = int(h / 0.5)
        for k in range(n):
            if rng.random() < 0.8:
                B.box(x + 0.08, x + w - 0.08, z + 0.1 + k * 0.5, z + 0.1 + k * 0.5 + 0.28, -1.38, -1.3, M["neon"], c)
        B.box(x + w / 2 - 0.03, x + w / 2 + 0.03, z + h, z + h + 0.5, -1.2, -0.0, M["steel"])


def deco(B, M, rng):
    """4: art-deco: tall fins, double height windows (8 cols x 4 rows of 4 x 8 m)."""
    W = TILE
    B.box(0, W, 0, W, 0.5, 1.4, M["concrete_d"])
    for i in range(8):
        x = i * 4
        B.box(x + 1.2, x + 2.8, 0, W, 0.3, 0.6, M["glass"])
        for j in range(4):
            z0 = j * 8
            B.box(x + 1.2, x + 2.8, z0 + 0.8, z0 + 7.2, 0.28, 0.3, M["glass_t"] if rng.random() < 0.3 else M["glass"])
            if rng.random() < 0.85:
                c = pick(rng, WARM)
                inten = rng.uniform(0.35, 1.0)
                col = tuple(v * inten for v in c)
                B.box(x + 1.25, x + 2.75, z0 + 0.9, z0 + 7.1, 0.2, 0.26, M["lampw"], tuple(v * 0.45 for v in col))
                for k in range(3):                               # chandelier strips
                    B.box(x + 1.4, x + 2.6, z0 + 6.2 - k * 0.07, z0 + 6.25 - k * 0.07 + 0.05, 0.1, 0.2, M["lampw"], col)
                for _ in range(rng.randint(0, 2)):
                    fw = rng.uniform(0.3, 0.8)
                    fx = x + 1.3 + rng.uniform(0, 1.3 - fw)
                    B.box(fx, fx + fw, z0 + 0.9, z0 + 0.9 + rng.uniform(0.4, 1.4), 0.05, 0.2, M["dark"])
            for k in range(1, 4):                                # horizontal glazing bars
                B.box(x + 1.2, x + 2.8, z0 + 0.8 + k * 1.6 - 0.04, z0 + 0.8 + k * 1.6 + 0.04, -0.1, 0.3, M["gold"])
        # piers
        B.box(x - 0.7, x + 0.7, 0, W, -1.3, 0.3, M["concrete_w"])
        B.box(x - 0.2, x + 0.2, 0, W, -1.55, -1.3, M["gold"])
        B.box(x - 0.04, x + 0.04, 0, W, -1.6, -1.55, M["lamp"], LIN(0xFFB050))
        B.box(x + 0.9, x + 1.05, 0, W, -0.5, 0.3, M["gold"])
        B.box(x + 2.95, x + 3.1, 0, W, -0.5, 0.3, M["gold"])
    for j in range(4):                                           # cornices with up-lights
        z = j * 8
        B.box(0, W, z - 0.45, z + 0.45, -1.7, -0.2, M["concrete_w"])
        B.box(0, W, z + 0.45, z + 0.6, -1.9, -1.7, M["gold"])
        B.box(0, W, z - 0.6, z - 0.45, -1.9, -1.7, M["gold"])
        B.box(0, W, z - 0.55, z - 0.5, -1.95, -1.9, M["lamp"], LIN(0xFFA040))
        for i in range(8):                                       # medallions
            B.cyl_y(i * 4 + 2.0, z, 0.3, -2.0, -1.7, M["gold"])


def monolith(B, M, rng):
    """5: sleek black panels with LED lines (4 x 8 m panels)."""
    W = TILE
    B.box(0, W, 0, W, 0.2, 1.0, M["panel"])
    for i in range(8):
        for j in range(4):
            x0, z0 = i * 4, j * 8
            B.box(x0 + 0.05, x0 + 3.95, z0 + 0.05, z0 + 7.95, -0.12, 0.2, M["black"])
            if rng.random() < 0.55:
                B.box(x0 + 0.5, x0 + 3.5, z0 + 0.5, z0 + 7.5, -0.15, -0.12, M["panel"])
                for r in range(rng.randint(3, 9)):               # micro vents
                    zz = z0 + 0.8 + r * 0.7
                    B.box(x0 + 0.8, x0 + 3.2, zz, zz + 0.09, -0.18, -0.15, M["dark"])
            if rng.random() < 0.3:                               # slit window
                sx = x0 + rng.uniform(0.6, 3.0)
                B.box(sx, sx + 0.4, z0 + 1.0, z0 + 7.0, -0.05, 0.0, M["lampw"], pick(rng, COOL))
    for j in range(4):                                           # seams
        B.box(0, W, j * 8 - 0.06, j * 8 + 0.06, -0.3, 0.0, M["steel"])
    for i in range(8):
        B.box(i * 4 - 0.05, i * 4 + 0.05, 0, W, -0.3, 0.0, M["steel"])
    # LED lines
    for _ in range(10):
        z = rng.uniform(1, 31)
        x = rng.uniform(0, 32)
        ln = rng.choice([6, 10, 14, 20, 28])
        c = pick(rng, [LIN(0x18F0FF), LIN(0xFF2BD6), LIN(0xE8F4FF), LIN(0xFF7A18)])
        B.box(x, x + ln, z, z + 0.14, -0.36, -0.28, M["neon"], c)
        if rng.random() < 0.5:
            B.box(x, x + ln, z + 0.5, z + 0.56, -0.36, -0.28, M["lamp"], tuple(v * 0.5 for v in c))
    for _ in range(4):                                           # vertical LED spines w/ dashes
        x = rng.uniform(0, 32)
        c = pick(rng, [LIN(0x18F0FF), LIN(0xFF2BD6)])
        for k in range(0, 32, 2):
            if rng.random() < 0.85:
                B.box(x, x + 0.12, k + 0.2, k + 1.5, -0.36, -0.28, M["neon"], c)


def roof(B, M, rng):
    """6: roof top (looking down): HVAC, tanks, pipes, skylights, markers."""
    W = TILE
    B.box(0, W, 0, W, 0.2, 1.0, M["concrete_d"])
    for k in range(8):                                           # roof panel seams
        B.box(k * 4 - 0.04, k * 4 + 0.04, 0, W, -0.08, 0.2, M["steel"])
        B.box(0, W, k * 4 - 0.04, k * 4 + 0.04, -0.08, 0.2, M["steel"])
    for _ in range(14):                                          # hvac boxes
        x, z = rng.uniform(0, 30), rng.uniform(0, 30)
        w, h = rng.uniform(1.5, 4.5), rng.uniform(1.5, 3.5)
        d = rng.uniform(0.8, 2.2)
        B.box(x, x + w, z, z + h, -d, 0.0, M["steel_l"] if rng.random() < 0.5 else M["concrete_w"])
        B.box(x + 0.1, x + w - 0.1, z + 0.1, z + h - 0.1, -d - 0.15, -d, M["steel"])
        if rng.random() < 0.7:
            B.cyl_y(x + w / 2, z + h / 2, min(w, h) * 0.35, -d - 0.3, -d - 0.1, M["black"], seg=16)
    for (x, z) in ((6, 8), (22, 22), (24, 6)):                   # water tanks
        B.cyl_y(x, z, 2.2, -3.0, 0.0, M["rust"], seg=24)
        B.cyl_y(x, z, 2.35, -3.1, -2.9, M["steel"], seg=24)
        B.cyl_y(x, z, 0.4, -3.4, -3.0, M["steel_l"])
    for _ in range(8):                                           # pipes
        if rng.random() < 0.5:
            B.cyl_x(rng.uniform(0, 10), rng.uniform(14, 32), rng.uniform(1, 31), -0.5, rng.uniform(0.12, 0.3),
                    pick(rng, [M["steel_l"], M["rust"], M["blue_p"]]))
        else:
            B.cyl_z(rng.uniform(1, 31), rng.uniform(0, 10), rng.uniform(14, 32), -0.5, rng.uniform(0.12, 0.3),
                    pick(rng, [M["steel_l"], M["rust"], M["yellow"]]))
    for _ in range(5):                                           # skylights
        x, z = rng.uniform(1, 28), rng.uniform(1, 28)
        w, h = rng.uniform(1.5, 3.5), rng.uniform(1.5, 3)
        B.box(x, x + w, z, z + h, -0.5, 0.0, M["steel"])
        c = pick(rng, [LIN(0xBFE6FF), LIN(0xFFD9A0), LIN(0xFF2BD6), LIN(0x18F0FF)])
        B.box(x + 0.15, x + w - 0.15, z + 0.15, z + h - 0.15, -0.55, -0.5, M["lamp"], tuple(v * 0.8 for v in c))
    for (x, z) in ((0.3, 0.3), (31.7, 0.3), (0.3, 31.7), (31.7, 31.7), (16, 0.3), (16, 31.7), (0.3, 16), (31.7, 16)):
        B.box(x - 0.2, x + 0.2, z - 0.2, z + 0.2, -0.8, 0.0, M["steel"])
        B.box(x - 0.14, x + 0.14, z - 0.14, z + 0.14, -1.0, -0.8, M["lamp"], LIN(0xFF1818))
    for k in range(0, 32, 2):                                    # blue edge guide lights
        B.box(k, k + 0.4, 0.2, 0.5, -0.2, -0.0, M["lamp"], LIN(0x2090FF))
        B.box(k, k + 0.4, 31.5, 31.8, -0.2, -0.0, M["lamp"], LIN(0x2090FF))


TYPES = [glass_tower, brutal, industrial, neon_resid, deco, monolith, roof]
NAMES = ["glass", "brutal", "industrial", "neon", "deco", "monolith", "roof"]


def render_type(t, res):
    scene = reset()
    setup_cycles(scene, res, res, spp=24)
    black_world(scene)
    ortho_camera(scene, TILE, TILE)
    ALL_MATS.clear()
    M = mats()
    rng = random.Random(1000 + t)
    B = Builder(tile=(TILE, TILE))
    TYPES[t](B, M, rng)
    objs = B.finish(name=NAMES[t])
    print(f"[facade {t}:{NAMES[t]}] {B.count} primitives")
    base = os.path.join(OUT, f"f{t}")
    # data passes first
    for mode, spp, tr in (("albedo", 24, "Standard"), ("rough", 8, "Raw"), ("normal", 12, "Raw"),
                          ("meta", 8, "Raw"), ("emit", 16, "Standard"), ("ao", 160, "Raw"), ("height", 6, "Raw")):
        set_all_modes(mode)
        scene.cycles.samples = spp
        if mode == "height":
            render_png(scene, f"{base}_{mode}.png", transform=tr, depth="16", mode="BW")
        else:
            render_png(scene, f"{base}_{mode}.png", transform=tr)
    # beauty preview with a simple light for sanity checks
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3
    so = bpy.data.objects.new("sun", sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(60), 0, math.radians(30))
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.1
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.4, 0.5, 0.7, 1)
    set_all_modes("beauty")
    scene.cycles.samples = 48
    scene.render.resolution_x = scene.render.resolution_y = min(res, 1024)
    render_png(scene, f"{base}_beauty.png", transform="Standard")


if __name__ == "__main__":
    a = args()
    res = int(a[1]) if len(a) > 1 else 2048
    which = range(len(TYPES)) if a[0] == "all" else [int(a[0])]
    for t in which:
        render_type(t, res)
