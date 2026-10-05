"""Shared helpers for the CYBERTAXI Blender pipeline (Blender 5.x, Cycles/Metal).

Everything is driven from the command line:
    Blender -b -P blender/<script>.py -- [args]

Design notes
------------
* Flat "channel" renders: every material keeps its PBR channels as node sockets
  (albedo / roughness / emission / normal / ao / metal / window-mask).  A render pass
  simply re-links the material output to an Emission shader reading one channel, so we
  get perfectly clean, noise-free data maps out of Cycles without the compositor.
* Facade tiles are periodic: geometry wraps across the tile border (Builder replicates
  anything that crosses an edge) and all grunge textures are FFT-generated periodic noise.
"""
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
os.makedirs(BUILD, exist_ok=True)

EMIT_MAX = 8.0   # emissive maps store strength / EMIT_MAX


def args():
    a = sys.argv
    return a[a.index("--") + 1:] if "--" in a else []


def srgb(r, g=None, b=None):
    """sRGB (0..1 floats or 0xRRGGBB int / tuple) -> linear tuple."""
    if g is None:
        if isinstance(r, int):
            r, g, b = ((r >> 16) & 255) / 255, ((r >> 8) & 255) / 255, (r & 255) / 255
        else:
            r, g, b = r
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


# --------------------------------------------------------------------------------------
# scene / cycles setup
# --------------------------------------------------------------------------------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _GRUNGE.clear()
    ALL_MATS.clear()
    return bpy.context.scene


def setup_cycles(scene, w, h, spp=32, denoise=False, gpu=True):
    scene.render.engine = "CYCLES"
    c = scene.cycles
    if gpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = d.type == "METAL"
        c.device = "GPU"
    c.samples = spp
    c.use_adaptive_sampling = False
    c.use_denoising = denoise
    if denoise:
        c.denoiser = "OPENIMAGEDENOISE"
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.use_persistent_data = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.display_settings.display_device = "sRGB"


def render_png(scene, path, transform="Standard", depth="8", mode="RGB"):
    scene.view_settings.view_transform = transform
    s = scene.render.image_settings
    s.file_format = "PNG"
    s.color_mode = mode
    s.color_depth = depth
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


# --------------------------------------------------------------------------------------
# periodic procedural grunge textures (numpy, FFT based)
# --------------------------------------------------------------------------------------
def pnoise(n, beta=2.0, seed=0, ky=1.0, kx=1.0):
    """Periodic fractal noise in [0,1]. beta = spectral slope. ky/kx stretch the spectrum
    (ky<1 -> features elongated vertically)."""
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(n)[:, None] * n * ky
    fx = np.fft.fftfreq(n)[None, :] * n * kx
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / (f ** (beta / 2))
    spec[0, 0] = 0
    a = np.fft.ifft2(spec).real
    lo, hi = np.percentile(a, [1, 99])
    return np.clip((a - lo) / (hi - lo), 0, 1).astype(np.float32)


def make_image(name, arr):
    """arr: (n,n) float -> Non-Color generated image"""
    n = arr.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=False, float_buffer=False)
    rgba = np.dstack([arr, arr, arr, np.ones_like(arr)]).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.colorspace_settings.name = "Non-Color"
    img.update()
    return img


_GRUNGE = {}


def grunge_images():
    if _GRUNGE:
        return _GRUNGE
    n = 1024
    c = 0.55 * pnoise(n, 2.4, 1) + 0.3 * pnoise(n, 1.2, 2) + 0.15 * pnoise(n, 0.4, 3)
    _GRUNGE["fine"] = make_image("g_fine", np.clip(c, 0, 1))
    s = pnoise(n, 2.2, 4, ky=0.07, kx=1.0)           # vertical streaks (rain stains)
    s = np.clip((s - 0.35) * 2.0, 0, 1) * (0.5 + 0.5 * pnoise(n, 2.0, 5))
    _GRUNGE["streak"] = make_image("g_streak", np.clip(s, 0, 1))
    b = pnoise(n, 3.2, 6)
    _GRUNGE["blotch"] = make_image("g_blotch", b)
    return _GRUNGE


# --------------------------------------------------------------------------------------
# PBR material that can flip between channel views
# --------------------------------------------------------------------------------------
MODES = ("beauty", "albedo", "rough", "emit", "normal", "ao", "meta")
ALL_MATS = []


class PBR:
    def __init__(self, name, base=(0.2, 0.2, 0.2), rough=0.6, metal=0.0, grunge=0.0,
                 emit=None, emit_color=(1, 1, 1), emit_vc=False, window=False, tile=(32.0, 32.0), bump=0.15,
                 streak=1.0, ao_dist=1.2, bevel=0.06, rough_var=0.25):
        """base / emit given in sRGB; emit = strength (float) -> uses `base`-independent colour from
        vertex colour attribute 'Col' when emit_vc else from `emit_color`."""
        self.name = name
        self.window = window
        self.metal = metal
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        N = nt.nodes.new
        L = nt.links.new
        self.mat = mat
        self.nt = nt
        out = N("ShaderNodeOutputMaterial")
        bsdf = N("ShaderNodeBsdfPrincipled")
        self.out, self.bsdf = out, bsdf
        W, H = tile

        # --- world-space planar UV (x,z) -> periodic over the tile
        geo = N("ShaderNodeNewGeometry")
        sep = N("ShaderNodeSeparateXYZ")
        L(geo.outputs["Position"], sep.inputs[0])

        def uv(k=1.0):
            mu = N("ShaderNodeMath"); mu.operation = "MULTIPLY"; mu.inputs[1].default_value = k / W
            mv = N("ShaderNodeMath"); mv.operation = "MULTIPLY"; mv.inputs[1].default_value = k / H
            L(sep.outputs["X"], mu.inputs[0]); L(sep.outputs["Z"], mv.inputs[0])
            cmb = N("ShaderNodeCombineXYZ")
            L(mu.outputs[0], cmb.inputs["X"]); L(mv.outputs[0], cmb.inputs["Y"])
            return cmb.outputs[0]

        def tex(img, k):
            t = N("ShaderNodeTexImage")
            t.image = img
            t.extension = "REPEAT"
            t.interpolation = "Linear"
            L(uv(k), t.inputs["Vector"])
            return t.outputs["Color"]

        def math(op, a, b=None, clamp=False):
            m = N("ShaderNodeMath"); m.operation = op; m.use_clamp = clamp
            for i, v in enumerate((a, b)):
                if v is None:
                    continue
                if isinstance(v, (int, float)):
                    m.inputs[i].default_value = v
                else:
                    L(v, m.inputs[i])
            return m.outputs[0]

        g = grunge_images() if grunge > 0 else None
        if g:
            fine = tex(g["fine"], 3)
            fine2 = tex(g["fine"], 11)
            streak = tex(g["streak"], 2)
            blotch = tex(g["blotch"], 1)
            # dirt mask: streaks + blotches
            dirt = math("ADD", math("MULTIPLY", streak, 0.9), math("MULTIPLY", blotch, 0.35))
            dirt = math("MULTIPLY", dirt, grunge, clamp=True)
            wear = math("ADD", math("MULTIPLY", fine, 0.6), math("MULTIPLY", fine2, 0.4))
        else:
            dirt = None
            wear = None

        # --- base colour
        if emit_vc and emit is not None:
            attr = N("ShaderNodeAttribute"); attr.attribute_name = "Col"
            vc = attr.outputs["Color"]
            # Col is stored as linear colour by the builder (callers pass linear tuples)
        if emit_vc:
            col_src = N("ShaderNodeRGB"); col_src.outputs[0].default_value = (0.01, 0.01, 0.012, 1)
            color = col_src.outputs[0]
        else:
            col_src = N("ShaderNodeRGB"); col_src.outputs[0].default_value = (*srgb(base), 1)
            color = col_src.outputs[0]
        if g:
            # multiply by (0.55 + 0.9*wear) and darken with dirt
            m1 = N("ShaderNodeMix"); m1.data_type = "RGBA"; m1.blend_type = "MULTIPLY"
            m1.inputs["Factor"].default_value = 1.0
            L(color, m1.inputs["A"])
            L(math("ADD", math("MULTIPLY", wear, 0.9), 0.55), m1.inputs["B"])
            m2 = N("ShaderNodeMix"); m2.data_type = "RGBA"; m2.blend_type = "MULTIPLY"
            L(math("MULTIPLY", dirt, 0.85), m2.inputs["Factor"])
            L(m1.outputs["Result"], m2.inputs["A"])
            dk = N("ShaderNodeRGB"); dk.outputs[0].default_value = (0.05, 0.045, 0.04, 1)
            L(dk.outputs[0], m2.inputs["B"])
            color = m2.outputs["Result"]
        self.color = color

        # --- roughness
        if g:
            r = math("ADD", rough, math("MULTIPLY", math("SUBTRACT", wear, 0.5), rough_var))
            r = math("ADD", r, math("MULTIPLY", dirt, 0.25), clamp=True)
        else:
            r = N("ShaderNodeValue"); r.outputs[0].default_value = rough
            r = r.outputs[0]
        self.rough = r

        # --- normal: bevel -> bump
        bev = N("ShaderNodeBevel"); bev.samples = 4; bev.inputs["Radius"].default_value = bevel
        bump_n = N("ShaderNodeBump")
        bump_n.inputs["Strength"].default_value = bump if g else 0.0
        bump_n.inputs["Distance"].default_value = 0.05
        L(bev.outputs["Normal"], bump_n.inputs["Normal"])
        if g:
            L(math("ADD", math("MULTIPLY", wear, 0.7), math("MULTIPLY", dirt, -0.4)), bump_n.inputs["Height"])
        self.normal = bump_n.outputs["Normal"]

        # --- emission
        if emit is not None:
            em = N("ShaderNodeMix"); em.data_type = "RGBA"; em.blend_type = "MULTIPLY"
            em.inputs["Factor"].default_value = 1.0
            if emit_vc:
                L(vc, em.inputs["A"])
            else:
                c = N("ShaderNodeRGB"); c.outputs[0].default_value = (*srgb(emit_color), 1)
                L(c.outputs[0], em.inputs["A"])
            s = N("ShaderNodeRGB"); s.outputs[0].default_value = (emit, emit, emit, 1)
            L(s.outputs[0], em.inputs["B"])
            self.emit_color = em.outputs["Result"]
            self.emit_strength = emit
        else:
            self.emit_color = None

        # --- principled
        L(color, bsdf.inputs["Base Color"])
        L(r, bsdf.inputs["Roughness"])
        bsdf.inputs["Metallic"].default_value = metal
        L(self.normal, bsdf.inputs["Normal"])
        if self.emit_color is not None:
            L(self.emit_color, bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
        L(bsdf.outputs["BSDF"], out.inputs["Surface"])

        # --- flat channel emitter
        self.flat = N("ShaderNodeEmission")
        self.flat.inputs["Strength"].default_value = 1.0
        ao = N("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = ao_dist
        ao.only_local = False
        L(self.normal, ao.inputs["Normal"])
        self.ao = ao.outputs["AO"]
        sx = N("ShaderNodeSeparateXYZ"); L(self.normal, sx.inputs[0])
        # tangent-space (nx, nz, -ny) * .5 + .5
        a = math("ADD", math("MULTIPLY", sx.outputs["X"], 0.5), 0.5)
        b = math("ADD", math("MULTIPLY", sx.outputs["Z"], 0.5), 0.5)
        c = math("ADD", math("MULTIPLY", sx.outputs["Y"], -0.5), 0.5)
        cn = N("ShaderNodeCombineXYZ")
        L(a, cn.inputs["X"]); L(b, cn.inputs["Y"]); L(c, cn.inputs["Z"])
        self.normal_col = cn.outputs[0]
        meta = N("ShaderNodeCombineXYZ")
        meta.inputs["X"].default_value = 1.0 if window else 0.0
        meta.inputs["Y"].default_value = metal
        self.meta_col = meta.outputs[0]
        # height: world y mapped (-3..3 m) -> 0..1  (camera looks along +y, y<0 = towards camera)
        hy = math("MULTIPLY", math("ADD", sep.outputs["Y"], 3.0), 1.0 / 6.0, clamp=True)
        hcmb = N("ShaderNodeCombineXYZ")
        L(hy, hcmb.inputs["X"]); L(hy, hcmb.inputs["Y"]); L(hy, hcmb.inputs["Z"])
        self.height_col = hcmb.outputs[0]
        if self.emit_color is not None:
            sc = N("ShaderNodeMix"); sc.data_type = "RGBA"; sc.blend_type = "MULTIPLY"
            sc.inputs["Factor"].default_value = 1.0
            L(self.emit_color, sc.inputs["A"])
            k = 1.0 / EMIT_MAX
            kc = N("ShaderNodeRGB"); kc.outputs[0].default_value = (k, k, k, 1)
            L(kc.outputs[0], sc.inputs["B"])
            self.emit_flat = sc.outputs["Result"]
        else:
            z = N("ShaderNodeRGB"); z.outputs[0].default_value = (0, 0, 0, 1)
            self.emit_flat = z.outputs[0]
        ALL_MATS.append(self)

    def set_mode(self, mode):
        nt = self.nt
        for l in list(self.out.inputs["Surface"].links):
            nt.links.remove(l)
        if mode == "beauty":
            nt.links.new(self.bsdf.outputs["BSDF"], self.out.inputs["Surface"])
            return
        src = {"albedo": self.color, "rough": self.rough, "emit": self.emit_flat,
               "normal": self.normal_col, "ao": self.ao, "meta": self.meta_col,
               "height": self.height_col}[mode]
        for l in list(self.flat.inputs["Color"].links):
            nt.links.remove(l)
        nt.links.new(src, self.flat.inputs["Color"])
        nt.links.new(self.flat.outputs["Emission"], self.out.inputs["Surface"])


def set_all_modes(mode):
    for m in ALL_MATS:
        m.set_mode(mode)


# --------------------------------------------------------------------------------------
# geometry builder (bmesh, one mesh per material, optional periodic wrapping)
# --------------------------------------------------------------------------------------
class Builder:
    def __init__(self, tile=None):
        self.tile = tile            # (W,H) -> wrap across borders (planar x,z)
        self.meshes = {}            # PBR -> (bm, colour layer)
        self.count = 0

    def _bm(self, mat):
        if mat not in self.meshes:
            bm = bmesh.new()
            lay = bm.verts.layers.float_color.new("Col")
            self.meshes[mat] = (bm, lay)
        return self.meshes[mat]

    def _emit(self, fn, ext, mat, color):
        """fn(dx,dz) adds geometry shifted by (dx,dz). ext=(x0,x1,z0,z1) bounding box."""
        if self.tile is None:
            fn(0, 0)
            return
        W, H = self.tile
        x0, x1, z0, z1 = ext
        for dx in (-W, 0, W):
            if x1 + dx < 0 or x0 + dx > W:
                continue
            for dz in (-H, 0, H):
                if z1 + dz < 0 or z0 + dz > H:
                    continue
                fn(dx, dz)

    def box(self, x0, x1, z0, z1, y0, y1, mat, color=(1, 1, 1), rot=0.0):
        """Axis aligned in (x,z) plane with depth y0..y1 (y<0 = towards camera). Optional rotation
        about the depth axis (around the box centre)."""
        if x1 < x0: x0, x1 = x1, x0
        if z1 < z0: z0, z1 = z1, z0
        if y1 < y0: y0, y1 = y1, y0
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        hw, hh = (x1 - x0) / 2, (z1 - z0) / 2
        r = abs(rot)
        if r:
            c, s = abs(math.cos(rot)), abs(math.sin(rot))
            ex, ez = hw * c + hh * s, hw * s + hh * c
        else:
            ex, ez = hw, hh
        ext = (cx - ex, cx + ex, cz - ez, cz + ez)
        bm, lay = self._bm(mat)

        def add(dx, dz):
            res = bmesh.ops.create_cube(bm, size=1.0)
            vs = res["verts"]
            for v in vs:
                lx, ly, lz = v.co.x * 2 * hw, v.co.y, v.co.z * 2 * hh
                if rot:
                    c, s = math.cos(rot), math.sin(rot)
                    lx, lz = lx * c - lz * s, lx * s + lz * c
                v.co = Vector((cx + dx + lx, (y0 + y1) / 2 + ly * (y1 - y0), cz + dz + lz))
                v[lay] = (*color, 1.0)
            self.count += 1

        self._emit(add, ext, mat, color)

    def cyl(self, axis, a, b, r, y0, y1, mat, color=(1, 1, 1), seg=12):
        """Cylinder. axis='y': centre (a=x, b=z) running y0..y1.
        axis='x': runs along x from a..b?? -> (a0,a1) at z=? ... use cylx / cylz helpers instead."""
        raise NotImplementedError

    def cyl_y(self, x, z, r, y0, y1, mat, color=(1, 1, 1), seg=14):
        ext = (x - r, x + r, z - r, z + r)
        bm, lay = self._bm(mat)

        def add(dx, dz):
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=abs(y1 - y0))
            for v in res["verts"]:
                # cone axis is Z -> rotate to Y
                v.co = Vector((x + dx + v.co.x, (y0 + y1) / 2 + v.co.z, z + dz + v.co.y))
                v[lay] = (*color, 1.0)
            self.count += 1

        self._emit(add, ext, mat, color)

    def cyl_x(self, x0, x1, z, y, r, mat, color=(1, 1, 1), seg=12):
        """horizontal pipe along x (wraps)."""
        ext = (x0, x1, z - r, z + r)
        bm, lay = self._bm(mat)
        ln = abs(x1 - x0)

        def add(dx, dz):
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=ln)
            for v in res["verts"]:
                v.co = Vector(((x0 + x1) / 2 + dx + v.co.z, y + v.co.y, z + dz + v.co.x))
                v[lay] = (*color, 1.0)
            self.count += 1

        self._emit(add, ext, mat, color)

    def cyl_z(self, x, z0, z1, y, r, mat, color=(1, 1, 1), seg=12):
        """vertical pipe along z (wraps)."""
        ext = (x - r, x + r, z0, z1)
        bm, lay = self._bm(mat)
        ln = abs(z1 - z0)

        def add(dx, dz):
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=ln)
            for v in res["verts"]:
                v.co = Vector((x + dx + v.co.x, y + v.co.y, (z0 + z1) / 2 + dz + v.co.z))
                v[lay] = (*color, 1.0)
            self.count += 1

        self._emit(add, ext, mat, color)

    def finish(self, collection=None, name="geo"):
        objs = []
        for mat, (bm, lay) in self.meshes.items():
            me = bpy.data.meshes.new(f"{name}_{mat.name}")
            bm.to_mesh(me)
            bm.free()
            me.materials.append(mat.mat)
            # smooth shading is not needed (boxes) but cylinders look better smooth
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(f"{name}_{mat.name}", me)
            (collection or bpy.context.scene.collection).objects.link(ob)
            objs.append(ob)
        self.meshes = {}
        return objs


def ortho_camera(scene, W, H, y=-60):
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = max(W, H)
    cd.clip_start = 1
    cd.clip_end = 400
    ob = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(ob)
    ob.location = (W / 2, y, H / 2)
    ob.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = ob
    return ob


def black_world(scene):
    w = bpy.data.worlds.new("w")
    scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
    bg.inputs["Strength"].default_value = 0.0
