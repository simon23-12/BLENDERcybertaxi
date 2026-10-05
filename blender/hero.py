"""Cover render: the taxi banking through a neon canyon (Cycles, volumetrics, the same facade tiles as the game).

usage: Blender -b -P blender/hero.py -- [width=1170] [spp=256] [out=build/hero.png]
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import farcity as fc
import vehicles as vh

a = args()
RW = int(a[0]) if a else 1170
SPP = int(a[1]) if len(a) > 1 else 256
RH = int(round(RW * 2532 / 1170))
OUTP = a[2] if len(a) > 2 else os.path.join(BUILD, "hero.png")

scene = reset()
setup_cycles(scene, RW, RH, spp=SPP, denoise=True)
c = scene.cycles
c.volume_max_steps = 512
c.volume_step_rate = 1.2
c.volume_bounces = 2
c.max_bounces = 7
c.transparent_max_bounces = 8
c.sample_clamp_indirect = 12
c.light_sampling_threshold = 0.005
scene.view_settings.view_transform = "AgX" if "AgX" in [t.identifier for t in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = -0.3

rng = random.Random(21)
TEX = os.path.join(BUILD, "facades")


# ------------------------------------------------------------------------------------------------ facade materials
def img(path, srgb):
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    return im


def facade_mat(t, emit_gain=5.0, tint=(1, 1, 1)):
    base = os.path.join(TEX, f"f{t}")
    mat = bpy.data.materials.new(f"hf{t}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    bsdf = N("ShaderNodeBsdfPrincipled")
    geo = N("ShaderNodeNewGeometry")
    mp = N("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / 32.0,) * 3
    mp.inputs["Location"].default_value = (rng.random(), rng.random(), rng.random())
    L(geo.outputs["Position"], mp.inputs["Vector"])

    def tex(path, srgb):
        n = N("ShaderNodeTexImage")
        n.image = img(path, srgb)
        n.projection = "BOX"
        n.projection_blend = 0.05
        n.extension = "REPEAT"
        n.interpolation = "Cubic"
        L(mp.outputs["Vector"], n.inputs["Vector"])
        return n

    ta = tex(base + "_albedo.png", True)
    tr = tex(base + "_rough.png", False)
    te = tex(base + "_emit.png", True)
    th = tex(base + "_height.png", False)
    tm = tex(base + "_meta.png", False)
    mul = N("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
    L(ta.outputs["Color"], mul.inputs["A"]); mul.inputs["B"].default_value = (*tint, 1)
    L(mul.outputs["Result"], bsdf.inputs["Base Color"])
    L(tr.outputs["Color"], bsdf.inputs["Roughness"])
    sep = N("ShaderNodeSeparateColor"); L(tm.outputs["Color"], sep.inputs[0])
    L(sep.outputs["Green"], bsdf.inputs["Metallic"])
    bump = N("ShaderNodeBump"); bump.inputs["Strength"].default_value = 1.0; bump.inputs["Distance"].default_value = 0.4
    L(th.outputs["Color"], bump.inputs["Height"])
    L(bump.outputs["Normal"], bsdf.inputs["Normal"])
    # patchy lit regions so not every window glows
    noi = N("ShaderNodeTexNoise"); noi.noise_dimensions = "3D"; noi.inputs["Scale"].default_value = 0.035; noi.inputs["Detail"].default_value = 3
    L(geo.outputs["Position"], noi.inputs["Vector"])
    mr = N("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = 0.38; mr.inputs["From Max"].default_value = 0.62
    L(noi.outputs["Fac"], mr.inputs["Value"])
    wmask = N("ShaderNodeMath"); wmask.operation = "MULTIPLY"
    L(mr.outputs["Result"], wmask.inputs[0]); wmask.inputs[1].default_value = emit_gain
    L(te.outputs["Color"], bsdf.inputs["Emission Color"])
    L(wmask.outputs[0], bsdf.inputs["Emission Strength"])
    L(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# ------------------------------------------------------------------------------------------------ world: the game panorama
sky_npy = os.path.join(BUILD, "sky_hdr.npy")
w = bpy.data.worlds.new("w")
scene.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
N, L = nt.nodes.new, nt.links.new
out = N("ShaderNodeOutputWorld")
bg = N("ShaderNodeBackground")
if os.path.exists(sky_npy):
    px = np.load(sky_npy).astype(np.float32)
    H_, W_ = px.shape[:2]
    im = bpy.data.images.new("sky", W_, H_, alpha=False, float_buffer=True)
    rgba = np.concatenate([px[::-1], np.ones((H_, W_, 1), np.float32)], axis=2)
    im.pixels.foreach_set(rgba.ravel())
    im.colorspace_settings.name = "Non-Color"
    env = N("ShaderNodeTexEnvironment"); env.image = im
    # panorama was rendered with the camera looking down +Y; the canyon runs along -Y -> look at the glowing horizon
    mp = N("ShaderNodeMapping"); mp.inputs["Rotation"].default_value = (0, 0, math.radians(-30))
    tc = N("ShaderNodeTexCoord")
    L(tc.outputs["Generated"], mp.inputs["Vector"]); L(mp.outputs[0], env.inputs["Vector"])
    L(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.22
else:
    bg.inputs["Color"].default_value = (0.05, 0.05, 0.1, 1)
L(bg.outputs["Background"], out.inputs["Surface"])

# ------------------------------------------------------------------------------------------------ canyon geometry
ground_z = 0.0
CAM_Z = 300.0
groups = {t: [] for t in range(7)}
rows = []
y = 120.0
GAP = 33.0                    # half street width
while y > -2600:
    for side in (-1, 1):
        wdt = rng.choice([80, 120, 168, 168])
        dpt = rng.choice([90, 168, 168])
        hgt = rng.uniform(320, 980) * (1.0 + 0.5 * min(1, max(0, (-y) / 1500)))
        x0 = side * GAP if side > 0 else -GAP - wdt
        x1 = x0 + wdt
        t = rng.choice([0, 0, 1, 3, 3, 4, 5, 2])
        # podium + tower with setbacks
        groups[rng.choice([1, 2, 3])].append((x0, x1, y - dpt, y, 0, 90))
        inset = rng.choice([0, 0, 8, 16])
        xa, xb = (x0 + (inset if side < 0 else 0), x1 - (0 if side < 0 else inset))
        groups[t].append((xa, xb, y - dpt, y, 90, hgt * 0.6))
        if rng.random() < 0.7:
            ins2 = 16 + rng.choice([0, 8, 16])
            xa2, xb2 = (xa + (ins2 if side < 0 else 0), xb - (0 if side < 0 else ins2))
            groups[rng.choice([5, 0, 4])].append((xa2, xb2, y - dpt + 8, y - 8, hgt * 0.6, hgt))
        if rng.random() < 0.5:
            groups[2].append((xa, xb, y - dpt, y, hgt * 0.6, hgt * 0.6))
        rows.append((y, side, wdt, dpt, hgt, x0, x1))
    y -= rng.choice([168 + 24, 168 + 24, 168 + 48])
    if rng.random() < 0.25:
        y -= 72                                            # cross street

for t, lst in groups.items():
    if not lst:
        continue
    b = np.array([(x0, x1, y0, y1, z0, z1) for (x0, x1, y0, y1, z0, z1) in lst], dtype=np.float64)
    ob = fc.boxes_mesh(f"tw{t}", b, [(1, 1, 1)] * len(lst), facade_mat(t, emit_gain=2.2 if t not in (5, 2) else 1.6))
    ob.location.z = 0

# a few hanging neon signs and big boards (they light the fog and the opposite wall)
sign_b, sign_c = [], []
cols = [fc.srgb(x) for x in (0xFF2BD6, 0x18F0FF, 0xFF6A1F, 0xFF2060, 0x7B5CFF, 0x39FF9A, 0xFFE070)]
for (y, side, wdt, dpt, hgt, x0, x1) in rows:
    if hgt < 300 or rng.random() > 0.55:
        continue
    face_x = x0 if side > 0 else x1
    sign_h = rng.uniform(40, 170)
    sz0 = rng.uniform(70, max(80, hgt * 0.7 - sign_h))
    col = rng.choice(cols)
    sy = y - dpt + rng.uniform(10, dpt - 10)
    d = -side
    sign_b.append((face_x + d * 1.0 - 0.0 if d < 0 else face_x, face_x + d * 2.0 if d > 0 else face_x - 2.0, sy - 6, sy + 6, sz0, sz0 + sign_h))
    sign_c.append(col)
    if rng.random() < 0.4:                                # big flat board
        bw = rng.uniform(30, 70)
        sign_b.append((face_x - side * 0.2 - (0.8 if side < 0 else 0) , face_x + (0.8 if side > 0 else 0), sy - bw / 2, sy + bw / 2, sz0 + 10, sz0 + 10 + rng.uniform(40, 110)))
        sign_c.append(rng.choice(cols))
fc.boxes_mesh("signs", sign_b, sign_c, fc.emissive_material("sign", 7.0))

# skybridges
bridge_b = []
for k in range(7):
    yb = -rng.uniform(150, 2200)
    zb = rng.uniform(110, 520)
    bridge_b.append((-GAP - 2, GAP + 2, yb - 8, yb + 8, zb, zb + 12))
fc.boxes_mesh("bridges", bridge_b, [(1, 1, 1)] * len(bridge_b), facade_mat(0, emit_gain=3.0))

# ground
fc.ground_plane(20000, 0.0)
fc.fog_volume(zmax=1800, half=6500, z0=-20, dens=0.0012, scale_h=380.0, haze=0.00018, aniso=0.45, tint=(0.62, 0.68, 0.9))

# distant traffic: lines of tiny headlights / taillights with volume glow
tr_b, tr_c = [], []
for i in range(260):
    yy = -rng.uniform(80, 2000)
    xx = rng.uniform(-GAP + 4, GAP - 4)
    zz = rng.uniform(120, 560)
    dirn = 1 if xx > 0 else -1
    col = fc.srgb(0xFFF0D8) if dirn > 0 else fc.srgb(0xFF2018)
    tr_b.append((xx - 0.5, xx + 0.5, yy - 1.2, yy + 1.2, zz, zz + 0.5)); tr_c.append(col)
fc.boxes_mesh("traffic", tr_b, tr_c, fc.emissive_material("trl", 12.0))

# ------------------------------------------------------------------------------------------------ the taxi
ALL_MATS.clear()
M = vh.mk_materials(0xF4B400)
v = vh.V()
vh.build_taxi(v, M, rng)
tax = vh.make_object(v, "taxi")
set_all_modes("beauty")
for m in ALL_MATS:
    if m.emit_color is not None:
        m.bsdf.inputs["Emission Strength"].default_value = 1.0
for m in ("red", "white", "cyan", "amber", "blue"):
    pass
tax.location = (2.0, 0.0, CAM_Z - 2)
tax.rotation_euler = (math.radians(6), math.radians(-13), math.radians(5))      # banking, slightly nose down
bpy.context.view_layer.objects.active = tax
for p in tax.data.polygons:
    p.use_smooth = p.use_smooth

# lights on the taxi
tail = bpy.data.lights.new("tail", "AREA"); tail.energy = 700; tail.color = (1, 0.1, 0.06); tail.size = 3.0
to = bpy.data.objects.new("tail", tail); scene.collection.objects.link(to)
to.location = (2.0, 7.0, CAM_Z - 1.2); to.rotation_euler = (math.radians(-90), 0, 0)
th = bpy.data.lights.new("thr", "POINT"); th.energy = 9000; th.color = (0.2, 0.5, 1.0); th.shadow_soft_size = 1.2
tho = bpy.data.objects.new("thr", th); scene.collection.objects.link(tho); tho.location = (2.0, 7.4, CAM_Z - 1.2)
hl = bpy.data.lights.new("head", "SPOT"); hl.energy = 2.5e5; hl.spot_size = math.radians(30); hl.spot_blend = 0.6; hl.color = (0.85, 0.93, 1.0)
hl.shadow_soft_size = 0.4
hlo = bpy.data.objects.new("head", hl); scene.collection.objects.link(hlo)
hlo.location = (2.0, -7.8, CAM_Z - 1.0); hlo.rotation_euler = (math.radians(90 + 4), 0, 0)
# rim lights from the signs
for k, (loc, col, e) in enumerate((((50, -300, 330), (0.1, 0.8, 1.0), 4e6), ((-45, -700, 380), (1.0, 0.5, 0.15), 6e6))):
    ld = bpy.data.lights.new(f"rim{k}", "POINT"); ld.energy = e; ld.color = col; ld.shadow_soft_size = 30
    lo = bpy.data.objects.new(f"rim{k}", ld); scene.collection.objects.link(lo); lo.location = loc

# camera
cd = bpy.data.cameras.new("cam")
cd.lens = 24
cd.sensor_width = 24
cd.clip_end = 20000
cam = bpy.data.objects.new("cam", cd)
scene.collection.objects.link(cam)
cam.location = (2.4, 20.5, CAM_Z + 2.4)
tgt = Vector((-1.0, -80.0, CAM_Z + 3.0))
from mathutils import Quaternion
cam.rotation_mode = "QUATERNION"
cam.rotation_quaternion = (tgt - cam.location).to_track_quat("-Z", "Y") @ Quaternion((0, 0, 1), math.radians(-7))   # slight dutch
scene.camera = cam

scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "8"
scene.render.filepath = OUTP
bpy.ops.render.render(write_still=True)
print("[hero] done", OUTP)
