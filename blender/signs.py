"""Neon signs & hologram ads rendered with Cycles into one atlas (tools/pack_signs.py packs it).

usage: Blender -b -P blender/signs.py -- [spp=96]
Output: build/signs/<name>.png (+ build/signs/index.json)
"""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

OUT = os.path.join(BUILD, "signs")
os.makedirs(OUT, exist_ok=True)
SPP = int(args()[0]) if args() else 96
FONT_JP = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
FONT_EN = "/System/Library/Fonts/Avenir Next Condensed.ttc"

C = lambda h: srgb(h)
PINK, CYAN, ORANGE, RED, VIOLET, GREEN, YELLOW, WHITE = C(0xFF2BD6), C(0x18F0FF), C(0xFF7A1F), C(0xFF2848), C(0x8A5CFF), C(0x3DFF9A), C(0xFFE070), C(0xFFF2E0)

# name, width px, height px, lines [(text, size, colour, font)], board colour, border colour
SIGNS = [
    dict(name="taxi", w=1024, h=384, lines=[("TAXI", 1.0, YELLOW, "en")], border=ORANGE, shape="rect"),
    dict(name="ramen", w=1024, h=512, lines=[("RAMEN", 0.62, PINK, "en"), ("ラーメン", 0.5, CYAN, "jp")], border=PINK),
    dict(name="hotel_v", w=384, h=1024, lines=[("ホ", 0.5, PINK, "jp"), ("テ", 0.5, PINK, "jp"), ("ル", 0.5, PINK, "jp")], border=CYAN),
    dict(name="cyber_v", w=384, h=1024, lines=[("サ", 0.44, CYAN, "jp"), ("イ", 0.44, CYAN, "jp"), ("バ", 0.44, CYAN, "jp"), ("ー", 0.44, CYAN, "jp")], border=VIOLET),
    dict(name="bar", w=1024, h=384, lines=[("BAR", 1.1, PINK, "en")], border=CYAN),
    dict(name="open24", w=1024, h=384, lines=[("OPEN 24H", 0.78, ORANGE, "en")], border=ORANGE),
    dict(name="arcade", w=1024, h=512, lines=[("ARCADE", 0.8, CYAN, "en"), ("ゲーム", 0.45, YELLOW, "jp")], border=YELLOW),
    dict(name="denno_v", w=384, h=1024, lines=[("電", 0.6, GREEN, "jp"), ("脳", 0.6, GREEN, "jp")], border=GREEN),
    dict(name="sake_v", w=384, h=1024, lines=[("酒", 0.78, RED, "jp"), ("場", 0.78, RED, "jp")], border=RED),
    dict(name="noodle", w=1024, h=512, lines=[("NOODLE", 0.66, ORANGE, "en"), ("麺", 0.62, WHITE, "jp")], border=ORANGE),
    dict(name="lotus", w=1024, h=384, lines=[("LOTUS", 0.9, VIOLET, "en")], border=PINK),
    dict(name="zerog", w=1024, h=512, lines=[("ZERO-G", 0.82, CYAN, "en"), ("無重力", 0.48, PINK, "jp")], border=CYAN),
    dict(name="megacorp", w=1024, h=384, lines=[("MEGACORP", 0.76, WHITE, "en")], border=RED),
    dict(name="helix", w=1024, h=384, lines=[("HELIX", 1.0, GREEN, "en")], border=GREEN),
    dict(name="hotel2", w=1024, h=384, lines=[("HOTEL", 0.9, YELLOW, "en")], border=ORANGE),
    dict(name="sushi_v", w=384, h=1024, lines=[("寿", 0.6, RED, "jp"), ("司", 0.6, RED, "jp")], border=WHITE),
    dict(name="neon24", w=1024, h=384, lines=[("夜", 0.8, PINK, "jp"), ("NIGHT", 0.55, CYAN, "en")], border=PINK, row=True),
    dict(name="clinic", w=1024, h=384, lines=[("CLINIC +", 0.78, GREEN, "en")], border=WHITE),
]

_font_cache = {}


def font(kind):
    if kind not in _font_cache:
        p = FONT_JP if kind == "jp" else FONT_EN
        _font_cache[kind] = bpy.data.fonts.load(p) if os.path.exists(p) else bpy.data.fonts.load(FONT_JP)
    return _font_cache[kind]


def emit_mat(name, col, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*col, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return m


def board_mat():
    m = bpy.data.materials.new("board")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.025, 0.027, 0.034, 1)
    b.inputs["Roughness"].default_value = 0.42
    b.inputs["Metallic"].default_value = 0.6
    return m


def make_text(scene, body, size, col, kind, y, width_limit, x=0.0, z=0.0, strength=11.0):
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = body
    cu.font = font(kind)
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = 0.012
    cu.offset = 0.0
    ob = bpy.data.objects.new("t", cu)
    scene.collection.objects.link(ob)
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.location = (x, y, z)
    # fit to width
    bpy.context.view_layer.update()
    bb = ob.dimensions
    if bb.x > width_limit:
        cu.size *= width_limit / bb.x
    ob.data.materials.append(emit_mat("neon_core", tuple(min(1.0, v * 0.9 + 0.06) for v in col), 2.2))
    # tube outline
    cu2 = bpy.data.curves.new("o", "FONT")
    cu2.body = body
    cu2.font = font(kind)
    cu2.size = cu.size
    cu2.align_x = "CENTER"
    cu2.align_y = "CENTER"
    cu2.fill_mode = "NONE"
    cu2.bevel_depth = 0.014
    cu2.bevel_resolution = 3
    ob2 = bpy.data.objects.new("o", cu2)
    scene.collection.objects.link(ob2)
    ob2.rotation_euler = (math.radians(90), 0, 0)
    ob2.location = (x, y - 0.03, z)
    cu2.size = cu.size
    ob2.data.materials.append(emit_mat("neon_tube", col, strength))
    return ob


def render_sign(s):
    scene = reset()
    _font_cache.clear()
    setup_cycles(scene, s["w"], s["h"], spp=SPP, denoise=True)
    c = scene.cycles
    c.max_bounces = 4
    scene.view_settings.view_transform = "Standard"
    black_world(scene)
    wd, ht = s["w"] / 256.0, s["h"] / 256.0          # board size in metres (256 px / m)
    # board
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * wd, v.co.y * 0.12, v.co.z * ht))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.025, segments=3, affect="EDGES")
    me = bpy.data.meshes.new("board")
    bm.to_mesh(me); bm.free()
    me.materials.append(board_mat())
    bo = bpy.data.objects.new("board", me)
    scene.collection.objects.link(bo)
    bo.location = (0, 0.07, 0)
    # border tube (rounded rectangle)
    bw, bh = wd * 0.5 - 0.09, ht * 0.5 - 0.09
    cu = bpy.data.curves.new("border", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.016
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    pts = [(-bw, -bh), (bw, -bh), (bw, bh), (-bw, bh)]
    sp.points.add(len(pts) - 1)
    for i, (px, pz) in enumerate(pts):
        sp.points[i].co = (px, -0.0, pz, 1)
    sp.use_cyclic_u = True
    cu.materials.append(emit_mat("border", s["border"], 9.0))
    co = bpy.data.objects.new("border", cu)
    scene.collection.objects.link(co)
    co.location = (0, -0.02, 0)
    # text lines
    lines = s["lines"]
    row = s.get("row")
    vertical = ht > wd
    n = len(lines)
    if vertical:
        step = ht / n
        for i, (txt, sz, col, kind) in enumerate(lines):
            make_text(scene, txt, sz * 1.75, col, kind, -0.05, wd * 0.82, 0.0, ht / 2 - step * (i + 0.5))
    elif row:
        for (txt, sz, col, kind), x in zip(lines, (-wd * 0.28, wd * 0.2)):
            make_text(scene, txt, sz, col, kind, -0.05, wd * 0.4, x, 0.0)
    elif n == 1:
        make_text(scene, lines[0][0], lines[0][1], lines[0][2], lines[0][3], -0.05, wd * 0.84, 0.0, 0.0)
    else:
        step = ht * 0.8 / n
        for i, (txt, sz, col, kind) in enumerate(lines):
            make_text(scene, txt, sz, col, kind, -0.05, wd * 0.84, 0.0, ht * 0.4 - step * (i + 0.5))
    # camera
    cd = bpy.data.cameras.new("c")
    cd.type = "ORTHO"
    cd.ortho_scale = wd
    cd.sensor_fit = "HORIZONTAL"
    cam = bpy.data.objects.new("c", cd)
    scene.collection.objects.link(cam)
    cam.location = (0, -6, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    render_png(scene, os.path.join(OUT, s["name"] + ".png"), transform="Standard")
    print("[sign]", s["name"])


if __name__ == "__main__":
    which = [x for x in args()[1:]] or [s["name"] for s in SIGNS]
    for s in SIGNS:
        if s["name"] in which:
            render_sign(s)
    json.dump([{"name": s["name"], "w": s["w"], "h": s["h"]} for s in SIGNS], open(os.path.join(OUT, "index.json"), "w"))
