"""Far-field megacity builder shared by the sky panorama and the hero render."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

PALETTE = [  # window tints (sRGB hex) with weights
    (0xFFB866, 6), (0xFFD9A8, 4), (0x9CD3FF, 3), (0xFF3FD0, 1.2), (0x24F0FF, 1.5), (0xFF7A2A, 2), (0xB48CFF, 0.6),
]


def desat(c, k=0.35):
    w = (1.0, 0.8, 0.6)
    return tuple(a * (1 - k) + b * k for a, b in zip(c, w))


def pal_pick(rng):
    tot = sum(w for _, w in PALETTE)
    r = rng.uniform(0, tot)
    for c, w in PALETTE:
        r -= w
        if r <= 0:
            return desat(srgb(c))
    return desat(srgb(PALETTE[0][0]))


def tower_material(win_strength=1.1, body=(0.012, 0.014, 0.02), pitch=(3.4, 4.2), name="far_tower"):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    bsdf = N("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*body, 1)
    bsdf.inputs["Roughness"].default_value = 0.35
    bsdf.inputs["Metallic"].default_value = 0.6
    geo = N("ShaderNodeNewGeometry")
    sep = N("ShaderNodeSeparateXYZ")
    L(geo.outputs["Position"], sep.inputs[0])

    def math_(op, a, b=None, clamp=False):
        m = N("ShaderNodeMath"); m.operation = op; m.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                L(v, m.inputs[i])
        return m.outputs[0]

    h = math_("ADD", sep.outputs["X"], sep.outputs["Y"])
    u = math_("DIVIDE", h, pitch[0])
    v = math_("DIVIDE", sep.outputs["Z"], pitch[1])
    fu, fv = math_("FRACT", u), math_("FRACT", v)
    mu = math_("MULTIPLY", math_("GREATER_THAN", fu, 0.15), math_("LESS_THAN", fu, 0.85))
    mv = math_("MULTIPLY", math_("GREATER_THAN", fv, 0.2), math_("LESS_THAN", fv, 0.8))
    attr = N("ShaderNodeAttribute"); attr.attribute_name = "Col"
    wn = N("ShaderNodeTexWhiteNoise"); wn.noise_dimensions = "3D"
    cmb = N("ShaderNodeCombineXYZ")
    L(math_("FLOOR", u), cmb.inputs["X"]); L(math_("FLOOR", v), cmb.inputs["Y"])
    sd = N("ShaderNodeSeparateColor"); L(attr.outputs["Color"], sd.inputs[0])
    L(math_("MULTIPLY", sd.outputs["Green"], 311.0), cmb.inputs["Z"])
    L(cmb.outputs[0], wn.inputs["Vector"])
    hv = wn.outputs["Value"]
    lit = math_("GREATER_THAN", hv, 0.62)
    bright = math_("ADD", math_("MULTIPLY", hv, 1.4), 0.2)
    # whole-floor bands (read as lit floors from far away)
    wn2 = N("ShaderNodeTexWhiteNoise"); wn2.noise_dimensions = "3D"
    c2 = N("ShaderNodeCombineXYZ")
    L(math_("FLOOR", math_("DIVIDE", sep.outputs["Z"], 8.0)), c2.inputs["X"])
    L(math_("MULTIPLY", sd.outputs["Blue"], 97.0), c2.inputs["Y"])
    L(c2.outputs[0], wn2.inputs["Vector"])
    band = math_("GREATER_THAN", wn2.outputs["Value"], 0.78)
    mask = math_("MULTIPLY", math_("MULTIPLY", mu, mv), math_("MAXIMUM", lit, math_("MULTIPLY", band, 0.35)))
    nz = N("ShaderNodeSeparateXYZ"); L(geo.outputs["Normal"], nz.inputs[0])
    vert = math_("SUBTRACT", 1.0, math_("ABSOLUTE", nz.outputs["Z"]), clamp=True)
    strength = math_("MULTIPLY", math_("MULTIPLY", math_("MULTIPLY", mask, bright), win_strength), math_("MULTIPLY", vert, vert))
    L(attr.outputs["Color"], bsdf.inputs["Emission Color"])
    L(strength, bsdf.inputs["Emission Strength"])
    L(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def emissive_material(name, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    em = N("ShaderNodeEmission")
    attr = N("ShaderNodeAttribute"); attr.attribute_name = "Col"
    L(attr.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = strength
    L(em.outputs["Emission"], out.inputs["Surface"])
    return mat



CUBE_V = np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]], dtype=np.float64)
CUBE_F = np.array([[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], dtype=np.int64)


def boxes_mesh(name, boxes, cols, mat, rot=None):
    """boxes: (n,6) x0,x1,y0,y1,z0,z1 ; cols: (n,3) linear ; rot: optional (n,) yaw about box centre."""
    b = np.asarray(boxes, dtype=np.float64)
    n = len(b)
    if n == 0:
        return None
    v = np.empty((n, 8, 3))
    for ax in range(3):
        lo, hi = b[:, ax * 2:ax * 2 + 1], b[:, ax * 2 + 1:ax * 2 + 2]
        v[:, :, ax] = lo + CUBE_V[None, :, ax] * (hi - lo)
    if rot is not None:
        r = np.asarray(rot)[:, None]
        cx = (b[:, 0:1] + b[:, 1:2]) / 2; cy = (b[:, 2:3] + b[:, 3:4]) / 2
        dx, dy = v[:, :, 0] - cx, v[:, :, 1] - cy
        v[:, :, 0] = cx + dx * np.cos(r) - dy * np.sin(r)
        v[:, :, 1] = cy + dx * np.sin(r) + dy * np.cos(r)
    f = (CUBE_F[None] + 8 * np.arange(n)[:, None, None]).reshape(-1, 4)
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.reshape(-1, 3).tolist(), [], f.tolist())
    att = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    c = np.repeat(np.asarray(cols, dtype=np.float32), 8, axis=0)
    att.data.foreach_set("color", np.hstack([c, np.ones((len(c), 1), dtype=np.float32)]).ravel())
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def smooth_field(n=96, seed=3):
    return pnoise(n, 2.6, seed)


def build_far_city(cx, cy, rmin=450, rmax=9000, seed=7, pitch=220.0, ground=0.0, hscale=1.0, max_h=1500.0):
    """Returns object list. Towers on a Manhattan grid centred so that (cx,cy) is a street crossing."""
    rng = random.Random(seed)
    field = smooth_field(128, seed)
    mat_t = tower_material()
    mat_beacon = emissive_material("beacon", 30.0)
    mat_neon = emissive_material("neon_far", 3.5)
    T, TC = [], []     # towers
    BC, BCC = [], []   # beacons
    NE, NEC = [], []   # neon

    def add_box(lst, clst, x0, x1, y0, y1, z0, z1, col):
        lst.append((x0, x1, y0, y1, z0, z1)); clst.append(col)

    nmax = int(rmax / pitch) + 1
    n_tw = 0
    for gx in range(-nmax, nmax + 1):
        for gy in range(-nmax, nmax + 1):
            bx, by = cx + gx * pitch, cy + gy * pitch
            d = math.hypot(bx - cx, by - cy)
            if d < rmin or d > rmax:
                continue
            fval = field[(gx + 64) % 128, (gy + 64) % 128]
            base_h = (60 + 1250 * (fval ** 2.4)) * hscale * (0.8 + 0.4 * rng.random())
            base_h *= 0.6 + min(1.0, d / 3500.0) * 0.9           # skyline grows with distance
            base_h = min(base_h, max_h)
            if rng.random() < 0.05:
                base_h *= 0.25                                    # plazas
            nsub = rng.choice([1, 1, 2, 4])
            bs = pitch - 70 if nsub < 4 else pitch - 70
            w = bs / (2 if nsub == 4 else 1)
            for si in range(nsub):
                if nsub == 4:
                    sx = bx - bs / 4 + (si % 2) * bs / 2
                    sy = by - bs / 4 + (si // 2) * bs / 2
                    ww = w - 6
                elif nsub == 2:
                    sx = bx; sy = by - bs / 4 + si * bs / 2
                    ww = bs - 6
                    wd = bs / 2 - 6
                else:
                    sx, sy, ww = bx, by, bs
                if nsub == 2:
                    hx, hy = ww / 2, (bs / 2 - 6) / 2
                else:
                    hx = hy = ww / 2
                h = base_h * rng.uniform(0.55, 1.15)
                tint = pal_pick(rng)
                col = (*tint,)
                # tiered: base block + 1..2 setbacks
                z = ground
                tiers = rng.choice([1, 2, 2, 3])
                cur_h = h
                shrink = 1.0
                for t in range(tiers):
                    th = cur_h * (0.55 if t < tiers - 1 else 1.0)
                    add_box(T, TC, sx - hx * shrink, sx + hx * shrink, sy - hy * shrink, sy + hy * shrink,
                            z, z + th, col)
                    z += th
                    cur_h -= th
                    shrink *= rng.uniform(0.55, 0.8)
                    if cur_h < 10:
                        break
                top = z
                n_tw += 1
                if top > 380 and rng.random() < 0.7:               # aviation beacon + antenna
                    add_box(T, TC, sx - 1.2, sx + 1.2, sy - 1.2, sy + 1.2, top, top + rng.uniform(40, 110), (0.02, 0.02, 0.025))
                    add_box(BC, BCC, sx - 2.5, sx + 2.5, sy - 2.5, sy + 2.5, top + 110, top + 114, (1.0, 0.05, 0.03))
                # vertical neon sign on the camera facing side
                if rng.random() < 0.22 and h > 150:
                    ang = math.atan2(cy - sy, cx - sx)
                    sgn_x = 1 if math.cos(ang) > 0 else -1
                    sgn_y = 1 if math.sin(ang) > 0 else -1
                    sh = rng.uniform(40, min(h * 0.6, 260))
                    sz0 = rng.uniform(ground + 40, top - sh - 5) if top - sh - 5 > ground + 40 else ground + 40
                    c = srgb(rng.choice([0xFF2BD6, 0x18F0FF, 0xFF6A1F, 0xFF2040, 0x7B5CFF, 0x3DFF9A]))
                    if rng.random() < 0.5:
                        px = sx + sgn_x * (hx + 1.0)
                        add_box(NE, NEC, px - 1.5, px + 1.5, sy - 8, sy + 8, sz0, sz0 + sh, c)
                    else:
                        py = sy + sgn_y * (hy + 1.0)
                        add_box(NE, NEC, sx - 8, sx + 8, py - 1.5, py + 1.5, sz0, sz0 + sh, c)
    objs = [boxes_mesh("towers", T, TC, mat_t), boxes_mesh("beacons", BC, BCC, mat_beacon), boxes_mesh("neon", NE, NEC, mat_neon)]
    print(f"[farcity] {n_tw} tower clusters")
    return objs


def ground_plane(size=40000, z=0.0):
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me); bm.free()
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.4
    mat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.42, 0.2, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.075
    me.materials.append(mat)
    ob = bpy.data.objects.new("ground", me)
    ob.location.z = z
    bpy.context.scene.collection.objects.link(ob)
    return ob


def fog_volume(zmax=3200.0, half=9500.0, z0=-50.0, dens=0.00055, scale_h=260.0, haze=0.00004, aniso=0.35,
               tint=(0.85, 0.88, 1.0)):
    """Big cube with height-exponential Principled Volume."""
    me = bpy.data.meshes.new("fog")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * half, v.co.y * 2 * half, z0 + (v.co.z + 0.5) * (zmax - z0)))
    bm.to_mesh(me); bm.free()
    mat = bpy.data.materials.new("fog")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    vol = N("ShaderNodeVolumePrincipled")
    geo = N("ShaderNodeNewGeometry")
    sep = N("ShaderNodeSeparateXYZ")
    L(geo.outputs["Position"], sep.inputs[0])

    def m(op, a, b=None):
        n = N("ShaderNodeMath"); n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    e = m("EXPONENT", m("MULTIPLY", sep.outputs["Z"], -1.0 / scale_h))
    d = m("ADD", m("MULTIPLY", e, dens), haze)
    L(d, vol.inputs["Density"])
    vol.inputs["Color"].default_value = (*tint, 1)
    vol.inputs["Anisotropy"].default_value = aniso
    L(vol.outputs["Volume"], out.inputs["Volume"])
    me.materials.append(mat)
    ob = bpy.data.objects.new("fog", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.visible_shadow = False
    return ob
