"""Cycles equirect panorama of the far megacity (volumetric fog, neon, searchlights).

usage: Blender -b -P blender/sky.py -- [res_w=4096] [spp=192]
Writes build/sky_hdr.npy (float16, h x w x 3 scene-linear, top row = zenith) + build/sky_preview.png
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
from farcity import *

a = args()
W = int(a[0]) if a else 4096
SPP = int(a[1]) if len(a) > 1 else 192
H = W // 2

scene = reset()
setup_cycles(scene, W, H, spp=SPP, denoise=True)
c = scene.cycles
c.volume_max_steps = 768
c.volume_step_rate = 1.4
c.volume_bounces = 2
c.max_bounces = 6
c.transparent_max_bounces = 8
c.sample_clamp_indirect = 20
scene.view_settings.view_transform = "Raw"

CAM_Z = 460.0
cd = bpy.data.cameras.new("pano")
cd.type = "PANO"
cd.panorama_type = "EQUIRECTANGULAR"
cd.clip_start = 1.0
cd.clip_end = 40000.0
cam = bpy.data.objects.new("pano", cd)
scene.collection.objects.link(cam)
cam.location = (0, 0, CAM_Z)
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam

# ------------------------------------------------------------------ world: smog sky
w = bpy.data.worlds.new("sky")
scene.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
N, L = nt.nodes.new, nt.links.new
out = N("ShaderNodeOutputWorld")
bg = N("ShaderNodeBackground")
tc = N("ShaderNodeTexCoord")
sep = N("ShaderNodeSeparateXYZ")
L(tc.outputs["Generated"], sep.inputs[0])
ramp = N("ShaderNodeValToRGB")
ramp.color_ramp.interpolation = "LINEAR"
els = ramp.color_ramp.elements
stops = [  # elevation (sin) remapped 0..1 : z*0.5+0.5
    (0.00, (0.09, 0.045, 0.035)),
    (0.38, (0.30, 0.12, 0.08)),
    (0.485, (1.00, 0.34, 0.26)),
    (0.52, (0.80, 0.22, 0.34)),
    (0.60, (0.16, 0.10, 0.24)),
    (0.78, (0.04, 0.07, 0.15)),
    (1.00, (0.008, 0.014, 0.035)),
]
els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
for p, col in stops[1:-1]:
    e = els.new(p)
    e.color = (*col, 1)
mz = N("ShaderNodeMath"); mz.operation = "MULTIPLY_ADD"
L(sep.outputs["Z"], mz.inputs[0]); mz.inputs[1].default_value = 0.5; mz.inputs[2].default_value = 0.5
L(mz.outputs[0], ramp.inputs["Fac"])
# cloud / smog modulation
mapn = N("ShaderNodeMapping"); mapn.inputs["Scale"].default_value = (2.2, 2.2, 5.5)
L(tc.outputs["Generated"], mapn.inputs["Vector"])
noi = N("ShaderNodeTexNoise"); noi.noise_dimensions = "3D"
noi.inputs["Scale"].default_value = 1.4; noi.inputs["Detail"].default_value = 9.0; noi.inputs["Roughness"].default_value = 0.62
L(mapn.outputs[0], noi.inputs["Vector"])
cr = N("ShaderNodeMapRange"); cr.inputs["From Min"].default_value = 0.3; cr.inputs["From Max"].default_value = 0.75
cr.inputs["To Min"].default_value = 0.35; cr.inputs["To Max"].default_value = 1.6
L(noi.outputs["Fac"], cr.inputs["Value"])
mulc = N("ShaderNodeMix"); mulc.data_type = "RGBA"; mulc.blend_type = "MULTIPLY"
mulc.inputs["Factor"].default_value = 1.0
L(ramp.outputs["Color"], mulc.inputs["A"])
gray = N("ShaderNodeCombineXYZ")
L(cr.outputs["Result"], gray.inputs["X"]); L(cr.outputs["Result"], gray.inputs["Y"]); L(cr.outputs["Result"], gray.inputs["Z"])
L(gray.outputs[0], mulc.inputs["B"])
L(mulc.outputs["Result"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.30
L(bg.outputs["Background"], out.inputs["Surface"])

# ------------------------------------------------------------------ geometry
build_far_city(0.0, 0.0, rmin=900, rmax=9500, seed=11)
ground_plane(60000, 0.0)
fog_volume(zmax=3400, half=11000, z0=-60, dens=0.0034, scale_h=330.0, haze=0.00015, aniso=0.4, tint=(0.55, 0.62, 0.85))

# big neon billboards floating in the haze (they colour the fog around them)
rng = random.Random(5)
BX, BCOL, BROT = [], [], []
for i in range(70):
    ang = rng.uniform(0, math.tau)
    dist = rng.uniform(700, 5200)
    z = rng.uniform(60, 900)
    wd, ht = rng.uniform(40, 220), rng.uniform(25, 140)
    col = srgb(rng.choice([0xFF2BD6, 0x18F0FF, 0xFF6A1F, 0xFF2060, 0x7B5CFF, 0x39FF9A, 0xFFE070]))
    cx, cy = math.cos(ang) * dist, math.sin(ang) * dist
    BX.append((cx - wd / 2, cx + wd / 2, cy - 1.5, cy + 1.5, z, z + ht))
    BCOL.append(col)
    BROT.append(ang + math.pi / 2)
# (floating billboards removed: they read as flat rectangles in game)

# searchlight beams
for i in range(9):
    ang = rng.uniform(0, math.tau)
    dist = rng.uniform(900, 3200)
    ld = bpy.data.lights.new(f"spot{i}", "SPOT")
    ld.energy = 6e6
    ld.spot_size = math.radians(rng.uniform(7, 14))
    ld.spot_blend = 0.45
    ld.color = rng.choice([(0.7, 0.9, 1.0), (1.0, 0.75, 0.5), (1.0, 0.4, 0.9), (0.4, 1.0, 1.0)])
    ld.shadow_soft_size = 4.0
    lo = bpy.data.objects.new(f"spot{i}", ld)
    scene.collection.objects.link(lo)
    lo.location = (math.cos(ang) * dist, math.sin(ang) * dist, rng.uniform(250, 700))
    tilt = math.radians(rng.uniform(5, 28))
    lo.rotation_euler = (tilt, 0, rng.uniform(0, math.tau))

# fill from below (warm city glow) – gives the fog its amber underside
for i in range(18):
    ang = rng.uniform(0, math.tau)
    dist = rng.uniform(1600, 5200)
    ld = bpy.data.lights.new(f"glow{i}", "POINT")
    ld.energy = rng.uniform(4e6, 1.4e7)
    ld.color = rng.choice([(1.0, 0.45, 0.2), (1.0, 0.25, 0.6), (0.2, 0.7, 1.0), (1.0, 0.7, 0.3)])
    ld.shadow_soft_size = 160
    lo = bpy.data.objects.new(f"glow{i}", ld)
    scene.collection.objects.link(lo)
    lo.location = (math.cos(ang) * dist, math.sin(ang) * dist, rng.uniform(40, 360))

# megastructures: tall tapered stacks that break the skyline
mat_mega = tower_material(win_strength=1.3, name="mega")
mb, mc = [], []
for i in range(16):
    ang = rng.uniform(0, math.tau)
    dist = rng.uniform(2200, 6500)
    cx, cy = math.cos(ang) * dist, math.sin(ang) * dist
    base_w = rng.uniform(160, 380)
    tint = pal_pick(rng)
    z = 0.0
    hh = rng.uniform(1300, 3000)
    w = base_w
    for t in range(4):
        th = hh * (0.4 if t < 3 else 0.2) if t else hh * 0.42
        mb.append((cx - w / 2, cx + w / 2, cy - w / 2, cy + w / 2, z, z + th)); mc.append(tint)
        z += th
        w *= rng.uniform(0.55, 0.8)
        if rng.random() < 0.3 and t > 0:
            break
    # spire + beacon
    mb.append((cx - 4, cx + 4, cy - 4, cy + 4, z, z + rng.uniform(150, 400))); mc.append(tint)
boxes_mesh("mega", mb, mc, mat_mega)
mat_beacon2 = emissive_material("beacon2", 30.0)
boxes_mesh("megabeacon", [(b[0] + (b[1]-b[0])/2 - 3, b[0] + (b[1]-b[0])/2 + 3, b[2] + (b[3]-b[2])/2 - 3, b[2] + (b[3]-b[2])/2 + 3, b[5] + 2, b[5] + 7) for b in mb[3::5] if True], [(1, 0.05, 0.03)] * len(mb[3::5]), mat_beacon2)

# street lights far below: sparse dashes along the street grid (seen through the fog)
lines, lcols = [], []
for k in range(-30, 31):
    pos = (k + 0.5) * 220.0
    for t in np.arange(-7000, 7000, 70.0):
        for axis in (0, 1):
            if rng.random() > 0.55:
                continue
            c = srgb(rng.choice([0xFFA040, 0xFFB866, 0xFFD9A8, 0x30D8FF, 0xFF40C8, 0xFF7A2A]))
            L = rng.uniform(10, 40)
            if axis == 0:
                lines.append((pos - 2.5, pos + 2.5, t, t + L, 0.5, 1.2))
            else:
                lines.append((t, t + L, pos - 2.5, pos + 2.5, 0.5, 1.2))
            lcols.append(c)
boxes_mesh("lattice", lines, lcols, emissive_material("lattice", 1.6))

# ------------------------------------------------------------------ render
exr = os.path.join(BUILD, "sky.exr")
s = scene.render.image_settings
s.file_format = "OPEN_EXR"
s.color_depth = "16"
s.color_mode = "RGB"
s.exr_codec = "ZIP"
scene.render.filepath = exr
bpy.ops.render.render(write_still=True)

img = bpy.data.images.load(exr)
img.colorspace_settings.name = "Non-Color"
px = np.empty(W * H * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)[::-1, :, :3]             # top row first
np.save(os.path.join(BUILD, "sky_hdr.npy"), px.astype(np.float16))
print("[sky] saved; mean", float(px.mean()), "max", float(px.max()))
