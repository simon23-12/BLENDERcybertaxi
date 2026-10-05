"""Flying cabs & traffic: procedural modelling (lofted squircle bodies + greebles), Cycles bake of
albedo / AO / normal / roughness+metal / emission into one atlas per vehicle, GLB export (mesh only).

usage: Blender -b -P blender/vehicles.py -- <kind|all> [res] [--no-bake]
kinds: taxi sedan sport van truck bus
Outputs build/veh/<kind>_*.png and assets/models/<kind>.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

OUT = os.path.join(BUILD, "veh")
MODELS = os.path.join(ROOT, "assets", "models")
os.makedirs(OUT, exist_ok=True)
os.makedirs(MODELS, exist_ok=True)


def sup(n, t):
    return math.copysign(abs(t) ** (2.0 / n), t)


class V:
    """vehicle mesh collector (one bmesh per material)"""

    def __init__(self):
        self.bms = {}
        self.empties = []

    def bm(self, mat):
        if mat not in self.bms:
            self.bms[mat] = bmesh.new()
        return self.bms[mat]

    # ---- lofted squircle body --------------------------------------------------------------
    def loft(self, mat, stations, seg=28, n=4.5, cap=True, pick=None):
        """stations: dicts y,hw,zb,zt[,n]. Returns faces. pick(face_centre, normal)->material or None."""
        bm = self.bm(mat)
        rings = []
        for st in stations:
            nn = st.get("n", n)
            zc, hh = (st["zb"] + st["zt"]) / 2, (st["zt"] - st["zb"]) / 2
            xo = st.get("xo", 0.0)
            ring = []
            for k in range(seg):
                a = math.tau * k / seg
                c, s = math.cos(a), math.sin(a)
                ring.append(bm.verts.new((xo + st["hw"] * sup(nn, c), st["y"], zc + hh * sup(nn, s))))
            rings.append(ring)
        faces = []
        for i in range(len(rings) - 1):
            for k in range(seg):
                a, b = rings[i][k], rings[i][(k + 1) % seg]
                c, d = rings[i + 1][(k + 1) % seg], rings[i + 1][k]
                faces.append(bm.faces.new((a, b, c, d)))
        if cap:
            faces.append(bm.faces.new(rings[0][::-1]))
            faces.append(bm.faces.new(rings[-1]))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        for f in faces:
            f.smooth = True
        if pick:
            for f in faces:
                m = pick(f.calc_center_median(), f.normal)
                if m is not None and m is not mat:
                    # move face to other mesh
                    bm2 = self.bm(m)
                    vs = [bm2.verts.new(v.co) for v in f.verts]
                    nf = bm2.faces.new(vs)
                    nf.smooth = True
                    bm.faces.remove(f)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        return faces

    # ---- box with chamfered edges -----------------------------------------------------------
    def box(self, mat, cx, cy, cz, sx, sy, sz, bevel=0.025, rotz=0.0, rotx=0.0, roty=0.0):
        bm = self.bm(mat)
        M = (Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rotz, 4, "Z") @ Matrix.Rotation(rotx, 4, "X")
             @ Matrix.Rotation(roty, 4, "Y") @ Matrix.Diagonal((sx, sy, sz, 1.0)))
        res = bmesh.ops.create_cube(bm, size=1.0, matrix=M)
        b = min(bevel, min(sx, sy, sz) * 0.45)
        if b > 0.002:
            edges = list({e for v in res["verts"] for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=edges, offset=b, segments=2, affect="EDGES")

    def cyl(self, mat, cx, cy, cz, r, depth, axis="y", seg=20, r2=None, rot=(0, 0, 0)):
        bm = self.bm(mat)
        M = Matrix.Translation((cx, cy, cz))
        if axis == "y":
            M = M @ Matrix.Rotation(math.radians(90), 4, "X")
        elif axis == "x":
            M = M @ Matrix.Rotation(math.radians(90), 4, "Y")
        M = M @ Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[0], 4, "X")
        res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2,
                                    depth=depth, matrix=M)
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.smooth = True

    def tube(self, mat, cx, cy, cz, r, depth, seg=32, wall=0.025):
        """open duct along Y with an outer and an inward-facing inner wall"""
        bm = self.bm(mat)
        M = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(math.radians(90), 4, "X")
        for rad, flip in ((r, False), (r - wall, True)):
            res = bmesh.ops.create_cone(bm, cap_ends=False, segments=seg, radius1=rad, radius2=rad, depth=depth, matrix=M)
            faces = list({f for v in res["verts"] for f in v.link_faces})
            if flip:
                bmesh.ops.reverse_faces(bm, faces=faces)
            for f in faces:
                f.smooth = True

    def empty(self, name, loc):
        self.empties.append((name, loc))


def turbine(v, M, cx, cy, cz, r, d, blades=9):
    """ducted fan seen from outside: chrome lip, blades in front of a glowing plenum, chrome hub.
    cy = mouth plane, d = +1 if the mouth faces +Y (rear), -1 if -Y (front)."""
    v.tube(M["chrome"], cx, cy - d * 0.02, cz, r * 1.12, 0.06, wall=r * 0.14)
    v.cyl(M["blue"], cx, cy - d * 0.20, cz, r * 0.96, 0.02, "y", seg=32)
    v.cyl(M["inner"], cx, cy - d * 0.23, cz, r * 1.0, 0.03, "y", seg=32)
    for k in range(blades):
        a = k * math.tau / blades
        rr = r * 0.52
        v.box(M["steel"], cx + math.sin(a) * rr, cy - d * 0.11, cz + math.cos(a) * rr, r * 0.16, 0.025, r * 0.78, 0.0, roty=a + 0.35)
    v.cyl(M["chrome"], cx, cy - d * 0.08, cz, r * 0.22, 0.08, "y", seg=20)
    v.cyl(M["cyan"], cx, cy - d * 0.035, cz, r * 0.07, 0.02, "y", seg=12)


def mk_materials(paint_rgb, paint_rough=0.28):
    M = {}
    M["paint"] = PBR("paint", paint_rgb, paint_rough, 0.45, tile=(1, 1))
    M["glass"] = PBR("glass", 0x06121A, 0.04, 0.9, tile=(1, 1))
    M["trim"] = PBR("trim", 0x08090B, 0.55, 0.1, tile=(1, 1))
    M["chrome"] = PBR("chrome", 0xB8BDC4, 0.14, 1.0, tile=(1, 1))
    M["steel"] = PBR("steel", 0x30343A, 0.4, 0.9, tile=(1, 1))
    M["inner"] = PBR("inner", 0x040405, 0.9, 0.0, tile=(1, 1))
    M["red"] = PBR("red", 0x000000, 0.4, 0.0, emit=9.0, emit_color=(1.0, 0.04, 0.03), tile=(1, 1))
    M["white"] = PBR("white", 0x000000, 0.3, 0.0, emit=8.0, emit_color=(1.0, 0.95, 0.85), tile=(1, 1))
    M["cyan"] = PBR("cyan", 0x000000, 0.3, 0.0, emit=7.0, emit_color=(0.1, 0.9, 1.0), tile=(1, 1))
    M["amber"] = PBR("amber", 0x000000, 0.3, 0.0, emit=5.0, emit_color=(1.0, 0.55, 0.08), tile=(1, 1))
    M["blue"] = PBR("blue", 0x000000, 0.3, 0.0, emit=8.0, emit_color=(0.15, 0.45, 1.0), tile=(1, 1))
    M["checker"] = PBR("checker", 0xEEEEEE, 0.35, 0.3, tile=(1, 1))
    # checker colour from a procedural texture
    nt = M["checker"].nt
    ck = nt.nodes.new("ShaderNodeTexChecker")
    ck.inputs["Scale"].default_value = 9.0
    ck.inputs["Color1"].default_value = (0.9, 0.9, 0.9, 1)
    ck.inputs["Color2"].default_value = (0.012, 0.012, 0.014, 1)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nt.links.new(geo.outputs["Position"], ck.inputs["Vector"])
    nt.links.new(ck.outputs["Color"], M["checker"].bsdf.inputs["Base Color"])
    M["checker"].color = ck.outputs["Color"]
    return M


# ------------------------------------------------------------------------------------------------
# vehicle definitions (front = -Y, up = +Z, metres)
# ------------------------------------------------------------------------------------------------
def build_taxi(v, M, rng):
    P, G = M["paint"], M["glass"]
    L = 2.9
    body = [
        dict(y=-2.82, hw=0.70, zb=0.55, zt=0.92), dict(y=-2.62, hw=0.98, zb=0.46, zt=1.04),
        dict(y=-2.20, hw=1.14, zb=0.40, zt=1.15), dict(y=-1.50, hw=1.22, zb=0.38, zt=1.27),
        dict(y=-0.60, hw=1.26, zb=0.38, zt=1.38), dict(y=0.60, hw=1.26, zb=0.38, zt=1.43),
        dict(y=1.80, hw=1.25, zb=0.38, zt=1.45), dict(y=2.52, hw=1.21, zb=0.40, zt=1.41),
        dict(y=2.84, hw=1.13, zb=0.44, zt=1.32),
    ]
    v.loft(P, body, seg=32, n=5.0)
    cabin = [
        dict(y=-1.10, hw=0.98, zb=1.30, zt=1.46), dict(y=-0.62, hw=1.05, zb=1.30, zt=1.93),
        dict(y=-0.28, hw=1.08, zb=1.30, zt=2.08), dict(y=1.25, hw=1.08, zb=1.30, zt=2.10),
        dict(y=1.78, hw=1.03, zb=1.30, zt=1.92), dict(y=2.22, hw=0.97, zb=1.30, zt=1.56),
    ]

    def pick(c, n):
        if n.z > 0.72 and c.z > 1.98:
            return P
        for lo, hi in ((-0.70, -0.52), (0.52, 0.72), (1.55, 1.78)):   # pillars
            if lo < c.y < hi and abs(n.x) > 0.3:
                return P
        return None
    v.loft(G, cabin, seg=28, n=3.4, pick=pick)
    # belly + skids
    v.box(M["steel"], 0, 0, 0.36, 2.2, 5.0, 0.12, 0.03)
    for sx in (-0.85, 0.85):
        v.box(M["steel"], sx, 0, 0.22, 0.12, 4.4, 0.12, 0.04)
        for sy in (-1.6, 1.6):
            v.box(M["steel"], sx, sy, 0.3, 0.1, 0.12, 0.25, 0.02)
    v.box(M["cyan"], 0, 0, 0.30, 1.4, 3.6, 0.03, 0.0)               # underglow
    # checker bands on both flanks
    for sx in (-1.265, 1.265):
        v.box(M["checker"], sx, 0.1, 0.98, 0.03, 4.6, 0.20, 0.0)
    # door seams
    for sx in (-1.275, 1.275):
        for y in (-0.55, 0.60, 1.75):
            v.box(M["trim"], sx, y, 0.95, 0.02, 0.025, 0.7, 0.0)
        v.box(M["trim"], sx, 0.0, 0.58, 0.02, 4.8, 0.03, 0.0)
        for y in (-0.15, 1.1):
            v.box(M["chrome"], sx * 1.005, y, 1.18, 0.04, 0.22, 0.04, 0.01)   # handles
    # mirrors
    for sx in (-1.0, 1.0):
        v.box(M["trim"], sx * 1.22, -0.78, 1.32, 0.22, 0.12, 0.12, 0.03)
        v.box(M["chrome"], sx * 1.33, -0.78, 1.34, 0.04, 0.10, 0.10, 0.01)
    # front: grille, headlights, DRL, bumper
    v.box(M["trim"], 0, -2.78, 0.68, 1.15, 0.12, 0.22, 0.03)
    for k in range(6):
        v.box(M["chrome"], 0, -2.845, 0.60 + k * 0.035, 1.0, 0.02, 0.012, 0.0)
    for sx in (-1, 1):
        v.box(M["trim"], sx * 0.84, -2.62, 0.90, 0.46, 0.20, 0.24, 0.04, rotz=sx * 0.18)
        v.box(M["white"], sx * 0.86, -2.70, 0.92, 0.34, 0.06, 0.15, 0.03, rotz=sx * 0.18)
        v.box(M["cyan"], sx * 0.70, -2.73, 0.77, 0.7, 0.04, 0.025, 0.0, rotz=sx * 0.12)
    v.box(M["chrome"], 0, -2.86, 0.47, 1.5, 0.08, 0.07, 0.03)
    # hood vents
    for sx in (-0.5, 0.5):
        for k in range(4):
            v.box(M["trim"], sx, -1.85 + k * 0.12, 1.255 + k * 0.012, 0.5, 0.045, 0.02, 0.0)
    # roof sign
    v.box(M["trim"], 0, 0.1, 2.12, 1.0, 0.52, 0.06, 0.02)
    v.box(M["amber"], 0, 0.1, 2.24, 0.94, 0.46, 0.18, 0.03)
    v.box(M["white"], 0, 0.1, 2.34, 0.96, 0.48, 0.02, 0.01)
    v.box(M["trim"], 0, -0.14, 2.24, 0.78, 0.02, 0.10, 0.0)          # front glyph slot
    v.box(M["trim"], 0, 0.34, 2.24, 0.78, 0.02, 0.10, 0.0)
    # rear: light bar + corner lights + plate + bumper
    v.box(M["red"], 0, 2.86, 1.06, 2.12, 0.07, 0.11, 0.025)
    for sx in (-1, 1):
        v.box(M["red"], sx * 1.1, 2.84, 0.80, 0.14, 0.06, 0.42, 0.03)
        v.box(M["amber"], sx * 0.92, 2.86, 0.62, 0.16, 0.05, 0.10, 0.02)
    v.box(M["trim"], 0, 2.84, 0.76, 0.58, 0.05, 0.22, 0.02)
    v.box(M["white"], 0, 2.875, 0.76, 0.5, 0.012, 0.15, 0.0)
    v.box(M["chrome"], 0, 2.86, 0.48, 1.9, 0.08, 0.07, 0.03)
    v.box(M["checker"], 0, 2.865, 1.22, 1.9, 0.02, 0.10, 0.0)
    # rear fins
    for sx in (-1, 1):
        v.box(P, sx * 1.14, 2.42, 1.52, 0.07, 1.0, 0.2, 0.025, rotx=0.42)
        v.box(M["red"], sx * 1.14, 2.88, 1.74, 0.075, 0.08, 0.05, 0.01, rotx=0.42)
    # thrusters: two big ducts at the rear, two pods at the front
    for sx in (-1, 1):
        v.cyl(M["steel"], sx * 1.02, 2.75, 0.66, 0.40, 0.70, "y", seg=28)
        v.tube(M["steel"], sx * 1.02, 3.23, 0.66, 0.40, 0.26)
        turbine(v, M, sx * 1.02, 3.36, 0.66, 0.37, 1)
        v.cyl(M["steel"], sx * 0.96, -1.98, 0.50, 0.30, 0.34, "y", seg=22)
        v.tube(M["steel"], sx * 0.96, -2.27, 0.50, 0.30, 0.24, seg=22)
        turbine(v, M, sx * 0.96, -2.39, 0.50, 0.27, -1, blades=7)
        v.box(M["steel"], sx * 1.35, 0.9, 0.52, 0.35, 1.6, 0.10, 0.03)          # side sponsons
        v.cyl(M["blue"], sx * 1.35, 0.9, 0.44, 0.19, 0.03, "x" if False else "y", seg=16, rot=(math.radians(90), 0, 0))
    v.empty("thr_rl", (-1.02, 3.40, 0.66)); v.empty("thr_rr", (1.02, 3.40, 0.66))
    v.empty("thr_fl", (-0.96, -2.43, 0.50)); v.empty("thr_fr", (0.96, -2.43, 0.50))
    v.empty("head_l", (-0.86, -2.75, 0.92)); v.empty("head_r", (0.86, -2.75, 0.92))
    v.empty("tail", (0, 2.9, 1.06))
    # antenna
    v.cyl(M["trim"], 0.7, 2.0, 1.75, 0.012, 0.6, "y", seg=6, rot=(0, 0, 0))
    v.cyl(M["trim"], 0.7, 2.0, 1.78, 0.012, 0.8, "x", seg=6)
    v.box(M["red"], 0.7, 2.0, 2.1, 0.04, 0.04, 0.04, 0.01)


def build_sedan(v, M, rng):
    P, G = M["paint"], M["glass"]
    body = [
        dict(y=-2.35, hw=0.60, zb=0.50, zt=0.82), dict(y=-2.15, hw=0.92, zb=0.42, zt=0.95),
        dict(y=-1.50, hw=1.12, zb=0.36, zt=1.06), dict(y=-0.40, hw=1.18, zb=0.36, zt=1.15),
        dict(y=1.20, hw=1.18, zb=0.36, zt=1.17), dict(y=2.05, hw=1.12, zb=0.38, zt=1.12), dict(y=2.35, hw=1.0, zb=0.42, zt=1.02),
    ]
    v.loft(P, body, seg=28, n=4.2)
    cabin = [dict(y=-0.9, hw=0.94, zb=1.05, zt=1.18), dict(y=-0.35, hw=1.0, zb=1.05, zt=1.70), dict(y=0.9, hw=1.0, zb=1.05, zt=1.72),
             dict(y=1.55, hw=0.95, zb=1.05, zt=1.40), dict(y=1.85, hw=0.9, zb=1.05, zt=1.14)]
    v.loft(G, cabin, seg=24, n=3.2, pick=lambda c, n: P if (n.z > 0.7 and c.z > 1.6) else None)
    v.box(M["steel"], 0, 0, 0.33, 1.9, 4.2, 0.1, 0.03)
    v.box(M["cyan"], 0, 0, 0.27, 1.2, 3.2, 0.03, 0.0)
    for sx in (-1, 1):
        v.box(M["white"], sx * 0.78, -2.26, 0.72, 0.40, 0.05, 0.10, 0.03, rotz=sx * 0.2)
        v.box(M["red"], sx * 0.86, 2.34, 0.88, 0.40, 0.05, 0.10, 0.03)
        v.cyl(M["steel"], sx * 0.85, 2.45, 0.55, 0.38, 0.5, "y", seg=22)
        v.cyl(M["blue"], sx * 0.85, 2.72, 0.55, 0.30, 0.03, "y", seg=22)
        v.box(M["trim"], sx * 1.2, -0.7, 1.12, 0.18, 0.10, 0.10, 0.03)
    v.box(M["red"], 0, 2.36, 0.97, 1.8, 0.05, 0.06, 0.02)
    v.box(M["trim"], 0, 2.34, 0.70, 0.5, 0.04, 0.16, 0.02)
    v.box(M["white"], 0, -2.34, 0.62, 1.0, 0.04, 0.04, 0.0)
    v.box(M["trim"], 0, -2.3, 0.56, 1.1, 0.06, 0.12, 0.03)


def build_sport(v, M, rng):
    P, G = M["paint"], M["glass"]
    body = [
        dict(y=-2.45, hw=0.55, zb=0.40, zt=0.62), dict(y=-2.2, hw=0.95, zb=0.32, zt=0.76), dict(y=-1.2, hw=1.18, zb=0.30, zt=0.92),
        dict(y=0.4, hw=1.22, zb=0.30, zt=0.98), dict(y=1.6, hw=1.2, zb=0.30, zt=1.0), dict(y=2.3, hw=1.1, zb=0.34, zt=0.94), dict(y=2.5, hw=0.95, zb=0.38, zt=0.86),
    ]
    v.loft(P, body, seg=28, n=3.6)
    cabin = [dict(y=-0.9, hw=0.82, zb=0.88, zt=0.98), dict(y=-0.2, hw=0.9, zb=0.88, zt=1.38), dict(y=0.7, hw=0.9, zb=0.88, zt=1.38), dict(y=1.5, hw=0.84, zb=0.88, zt=0.98)]
    v.loft(G, cabin, seg=22, n=3.0, pick=lambda c, n: P if (n.z > 0.6 and c.z > 1.28) else None)
    v.box(M["steel"], 0, 0, 0.27, 1.8, 4.3, 0.08, 0.03)
    v.box(M["cyan"], 0, 0, 0.22, 1.2, 3.0, 0.03, 0.0)
    v.box(M["red"], 0, 2.5, 0.78, 1.7, 0.05, 0.06, 0.02)
    for sx in (-1, 1):
        v.box(M["white"], sx * 0.8, -2.28, 0.62, 0.44, 0.04, 0.07, 0.02, rotz=sx * 0.3)
        v.cyl(M["steel"], sx * 0.7, 2.5, 0.52, 0.30, 0.45, "y", seg=22)
        v.cyl(M["blue"], sx * 0.7, 2.74, 0.52, 0.25, 0.03, "y", seg=22)
        v.box(P, sx * 0.9, 2.22, 1.12, 0.10, 0.5, 0.22, 0.02)
    v.box(P, 0, 2.2, 1.24, 2.0, 0.34, 0.03, 0.01)


def build_van(v, M, rng):
    P, G = M["paint"], M["glass"]
    body = [dict(y=-2.4, hw=0.8, zb=0.45, zt=1.2), dict(y=-2.1, hw=1.12, zb=0.40, zt=1.5), dict(y=-1.2, hw=1.25, zb=0.38, zt=2.2),
            dict(y=0.5, hw=1.27, zb=0.38, zt=2.45), dict(y=2.6, hw=1.25, zb=0.38, zt=2.45), dict(y=3.0, hw=1.18, zb=0.40, zt=2.3)]
    v.loft(P, body, seg=28, n=5.2)
    ws = [dict(y=-2.1, hw=1.0, zb=1.35, zt=1.55), dict(y=-1.45, hw=1.1, zb=1.35, zt=2.15), dict(y=-0.85, hw=1.16, zb=1.35, zt=2.2), dict(y=-0.7, hw=1.16, zb=1.35, zt=2.2)]
    v.loft(G, ws, seg=20, n=3.0, pick=lambda c, n: P if (n.z > 0.6 and c.z > 2.1) else None)
    v.box(M["steel"], 0, 0.3, 0.34, 2.2, 5.3, 0.1, 0.03)
    v.box(M["cyan"], 0, 0.3, 0.28, 1.4, 4.0, 0.03, 0.0)
    for sx in (-1, 1):
        v.box(M["white"], sx * 0.86, -2.2, 0.95, 0.4, 0.05, 0.14, 0.03)
        v.box(M["red"], sx * 1.12, 3.0, 1.6, 0.14, 0.05, 1.1, 0.03)
        v.cyl(M["steel"], sx * 0.95, 3.2, 0.7, 0.5, 0.7, "y", seg=24)
        v.cyl(M["blue"], sx * 0.95, 3.55, 0.7, 0.42, 0.03, "y", seg=24)
        v.box(M["trim"], sx * 1.3, 0.3, 1.3, 0.04, 4.4, 0.05, 0.0)
    v.box(M["trim"], 0, 3.0, 1.2, 0.04, 0.04, 2.3, 0.0)
    v.box(M["white"], 0, -2.35, 0.7, 1.3, 0.04, 0.06, 0.0)
    for k in range(5):
        v.box(M["amber"], -0.8 + k * 0.4, -0.2, 2.47, 0.2, 0.12, 0.04, 0.01)


def build_truck(v, M, rng):
    P, G = M["paint"], M["glass"]
    cab = [dict(y=-5.0, hw=0.9, zb=0.5, zt=1.4), dict(y=-4.7, hw=1.3, zb=0.4, zt=1.9), dict(y=-3.8, hw=1.38, zb=0.38, zt=2.7),
           dict(y=-3.0, hw=1.4, zb=0.38, zt=2.9), dict(y=-2.4, hw=1.4, zb=0.38, zt=2.8)]
    v.loft(P, cab, seg=24, n=5.0)
    ws = [dict(y=-4.72, hw=1.15, zb=1.7, zt=1.95), dict(y=-3.95, hw=1.3, zb=1.7, zt=2.65), dict(y=-3.7, hw=1.31, zb=1.7, zt=2.7)]
    v.loft(G, ws, seg=18, n=3.0, pick=lambda c, n: P if (n.z > 0.6 and c.z > 2.6) else None)
    # container
    v.box(M["steel"], 0, 1.6, 2.1, 2.9, 8.6, 3.3, 0.08)
    for k in range(14):
        v.box(M["trim"], 0, 1.6 - 4.1 + k * 0.63, 2.1, 2.98, 0.07, 3.3, 0.0)
    v.box(M["amber"], 0, 1.6, 3.8, 2.4, 0.2, 0.06, 0.02)
    v.box(M["steel"], 0, -0.2, 0.42, 2.4, 9.8, 0.14, 0.04)
    v.box(M["cyan"], 0, -0.2, 0.34, 1.6, 8.0, 0.03, 0.0)
    for sx in (-1, 1):
        v.box(M["white"], sx * 1.0, -4.78, 0.9, 0.4, 0.05, 0.14, 0.03)
        v.box(M["red"], sx * 1.2, 5.92, 1.0, 0.14, 0.05, 1.2, 0.03)
        v.cyl(M["steel"], sx * 1.0, 6.15, 0.95, 0.6, 0.7, "y", seg=24)
        v.cyl(M["blue"], sx * 1.0, 6.5, 0.95, 0.5, 0.03, "y", seg=24)
        v.cyl(M["steel"], sx * 1.35, -1.6, 0.6, 0.4, 0.5, "y", seg=20)
        v.cyl(M["blue"], sx * 1.35, -1.9, 0.6, 0.33, 0.03, "y", seg=20)
    v.box(M["red"], 0, 5.93, 1.25, 2.6, 0.05, 0.08, 0.02)


def build_bus(v, M, rng):
    P, G = M["paint"], M["glass"]
    body = [dict(y=-4.9, hw=0.9, zb=0.45, zt=1.5), dict(y=-4.6, hw=1.3, zb=0.4, zt=2.2), dict(y=-3.6, hw=1.4, zb=0.38, zt=2.9),
            dict(y=3.6, hw=1.4, zb=0.38, zt=2.9), dict(y=4.7, hw=1.3, zb=0.4, zt=2.7), dict(y=4.95, hw=1.1, zb=0.45, zt=2.4)]
    v.loft(P, body, seg=28, n=6.0)
    # window band
    v.box(M["glass"], 0, 0.0, 2.15, 2.83, 8.2, 0.7, 0.04)
    v.box(M["glass"], 0, -4.6, 2.0, 2.2, 0.3, 1.0, 0.04)
    v.box(M["steel"], 0, 0, 0.34, 2.4, 9.6, 0.12, 0.03)
    v.box(M["cyan"], 0, 0, 0.28, 1.6, 8.0, 0.03, 0.0)
    for k in range(10):
        v.box(M["trim"], 0, -3.6 + k * 0.82, 2.15, 2.9, 0.05, 0.72, 0.0)
    v.box(M["amber"], 0, -4.62, 2.78, 1.8, 0.1, 0.14, 0.02)
    v.box(M["red"], 0, 4.97, 1.6, 2.2, 0.05, 0.08, 0.02)
    for sx in (-1, 1):
        v.box(M["white"], sx * 0.98, -4.72, 0.95, 0.4, 0.05, 0.14, 0.03)
        v.cyl(M["steel"], sx * 1.0, 5.2, 0.8, 0.55, 0.6, "y", seg=24)
        v.cyl(M["blue"], sx * 1.0, 5.5, 0.8, 0.45, 0.03, "y", seg=24)
        v.cyl(M["steel"], sx * 1.0, -4.3, 0.6, 0.35, 0.5, "y", seg=20)
        v.cyl(M["blue"], sx * 1.0, -4.58, 0.6, 0.29, 0.03, "y", seg=20)
        v.box(M["checker"], sx * 1.405, 0, 1.0, 0.03, 9.0, 0.2, 0.0)


KINDS = {
    "taxi":  dict(fn=build_taxi, paint=0xF4B400, res=2048, margin=10),
    "sedan": dict(fn=build_sedan, paint=0xCFCFCF, res=1024, margin=6),
    "sport": dict(fn=build_sport, paint=0xCFCFCF, res=1024, margin=6),
    "van":   dict(fn=build_van, paint=0xCFCFCF, res=1024, margin=6),
    "truck": dict(fn=build_truck, paint=0xCFCFCF, res=1024, margin=6),
    "bus":   dict(fn=build_bus, paint=0xCFCFCF, res=1024, margin=6),
}


def make_object(v, name):
    bm_all = bmesh.new()
    me = bpy.data.meshes.new(name)
    mats = list(v.bms.keys())
    for i, m in enumerate(mats):
        bm = v.bms[m]
        for f in bm.faces:
            f.material_index = i
        tmp = bpy.data.meshes.new("tmp")
        bm.to_mesh(tmp)
        bm.free()
        bm_all.from_mesh(tmp)
        for f in bm_all.faces:
            pass
        # reassign material index for the newly appended faces
        n_prev = len(bm_all.faces) - len(tmp.polygons)
        for f in list(bm_all.faces)[n_prev:]:
            f.material_index = i
        bpy.data.meshes.remove(tmp)
    bmesh.ops.remove_doubles(bm_all, verts=bm_all.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm_all, faces=bm_all.faces)
    bm_all.to_mesh(me)
    bm_all.free()
    for m in mats:
        me.materials.append(m.mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def unwrap(ob, margin=0.004):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=margin, area_weight=0.6)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_channels(ob, name, res, margin, samples_ao=96):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    bk = scene.render.bake
    bk.margin = margin
    bk.margin_type = "EXTEND"
    bk.use_clear = True
    # image node in every material
    mats = [m for m in ob.data.materials]
    img0 = bpy.data.images.new("bake_tmp", res, res, alpha=False)
    nodes = []
    for mat in mats:
        nt = mat.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img0
        nt.nodes.active = n
        n.select = True
        nodes.append(n)

    def run(ch, bake_type, mode, srgb_space, **kw):
        img = bpy.data.images.new(f"{name}_{ch}", res, res, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "sRGB" if srgb_space else "Non-Color"
        for n in nodes:
            n.image = img
        for mt in mats:
            pass
        set_all_modes(mode)
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type=bake_type, margin=margin, margin_type="EXTEND", use_clear=True, **kw)
        path = os.path.join(OUT, f"{name}_{ch}.png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        print("[bake]", ch, path)

    run("albedo", "EMIT", "albedo", True)
    run("rough", "EMIT", "rough", False)
    run("meta", "EMIT", "meta", False)
    run("emit", "EMIT", "emit", True)
    scene.cycles.samples = samples_ao
    run("ao", "AO", "beauty", False)
    scene.cycles.samples = 24
    run("normal", "NORMAL", "beauty", False, normal_space="TANGENT")


def export_glb(ob, empties, path):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    for e in empties:
        e.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_materials="NONE", export_texcoords=True, export_normals=True, export_cameras=False, export_lights=False)
    print("[glb]", path, os.path.getsize(path))


def render_preview(ob, name, res=900):
    scene = bpy.context.scene
    setup_cycles(scene, res, int(res * 0.62), spp=48, denoise=True)
    set_all_modes("beauty")
    w = bpy.data.worlds.new("w")
    scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.08, 0.1, 0.16, 1)
    bg.inputs["Strength"].default_value = 1.0
    for i, (loc, col, e) in enumerate((((6, -6, 6), (1, 0.8, 0.6), 600), ((-6, 6, 3), (0.4, 0.6, 1.0), 400), ((0, 7, 2), (1, 0.2, 0.3), 300))):
        ld = bpy.data.lights.new(f"l{i}", "AREA")
        ld.energy = e
        ld.color = col
        ld.size = 4
        lo = bpy.data.objects.new(f"l{i}", ld)
        scene.collection.objects.link(lo)
        lo.location = loc
        d = Vector((0, 0, 1)) - Vector(loc)
        lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("c")
    cd.lens = 45
    co = bpy.data.objects.new("c", cd)
    scene.collection.objects.link(co)
    co.location = (7.5, 8.5, 4.2)
    co.rotation_euler = (Vector((0, 0, 1.0)) - Vector(co.location)).to_track_quat("-Z", "Y").to_euler()
    scene.camera = co
    for suffix, loc in (("rear", (-5.5, 9.5, 3.4)), ("front", (6.5, -9.5, 2.6))):
        co.location = loc
        co.rotation_euler = (Vector((0, 0, 1.0)) - Vector(co.location)).to_track_quat("-Z", "Y").to_euler()
        render_png(scene, os.path.join(OUT, f"{name}_prev_{suffix}.png"))


def build_kind(kind, bake=True, res=None, preview=True):
    cfg = KINDS[kind]
    scene = reset()
    setup_cycles(scene, 512, 512, spp=16)
    ALL_MATS.clear()
    rng = random.Random(hash(kind) & 0xffff)
    M = mk_materials(cfg["paint"])
    v = V()
    cfg["fn"](v, M, rng)
    ob = make_object(v, kind)
    empties = []
    for nm, loc in v.empties:
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "PLAIN_AXES"
        e.location = loc
        scene.collection.objects.link(e)
        empties.append(e)
    unwrap(ob)
    print(f"[{kind}] tris", sum(len(p.vertices) - 2 for p in ob.data.polygons), "mats", len(ob.data.materials))
    if bake:
        bake_channels(ob, kind, res or cfg["res"], cfg["margin"])
    export_glb(ob, empties, os.path.join(MODELS, f"{kind}.glb"))
    if preview:
        # preview after bake uses beauty materials
        render_preview(ob, kind)


if __name__ == "__main__":
    a = [x for x in args() if not x.startswith("--")]
    flags = [x for x in args() if x.startswith("--")]
    kinds = list(KINDS) if a[0] == "all" else [a[0]]
    res = int(a[1]) if len(a) > 1 else None
    for k in kinds:
        build_kind(k, bake="--no-bake" not in flags, res=res, preview="--no-preview" not in flags)
