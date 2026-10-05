# CYBERTAXI

A flying-cab game in the spirit of *The Fifth Element*, built to push an iPhone's browser GPU to its limit.
Hold your phone **upright**, **tilt** to steer, hit **GAS** / **BRAKE** with your thumbs. Pick up passengers from lit
ledges and fly them to their destination – or just sightsee. Nothing can hurt you.

**Play:** https://simon23-12.github.io/BLENDERcybertaxi/ (open in Safari on iPhone; "Add to Home Screen" for fullscreen)

## What is rendered in Blender

Everything you see is baked/rendered offline with **Blender 5.2 + Cycles** (scripts in [`blender/`](blender)):

| asset | script | what |
|---|---|---|
| `assets/sky/sky.webp` | `blender/sky.py` | 4096×2048 HDR panorama of a megacity skyline in volumetric fog (log-encoded WebP) – used as sky, fog colour and image-based lighting |
| `assets/tex/f*_{a,n,e,m}.webp` | `blender/facades.py` + `tools/pack_facades.py` | 7 seamless 32 m facade tiles (glass tower, brutalist, industrial, neon block, art-deco, monolith, roof) with real geometry: albedo+AO, normal+roughness (from geometry relief), emission, window mask |
| `assets/models/*.glb` + textures | `blender/vehicles.py` + `tools/pack_vehicles.py` | the hero taxi and 5 traffic vehicle types, lofted/modelled procedurally, UV-unwrapped and baked (albedo, AO, normal, roughness/metal, emission) |
| `assets/ui/hero.jpg` | `blender/hero.py` | the cover render |
| `assets/audio/cyberpunk.mp3` | `tools/make_music.py` | original synthwave loop, synthesised with numpy |

## Real-time (three.js, WebGL 2)

* HDR pipeline (half-float, 4× MSAA), custom dual-filter bloom, ACES tone mapping, chromatic aberration, grain
* Texture-array facade shader with per-window lighting/flicker, hue shifts, altitude ambient and neon colour zones
* Analytic height fog that fades into the Blender panorama; parallax sky dome
* Instanced procedural megacity (~2k tower tiers, skybridges, ledges), instanced traffic, collision grid
* Adaptive resolution keeps the frame rate up on any device; GRAPHICS LOW / MED / HIGH / ULTRA in the menu

## Build

```bash
npm install
npm run build      # esbuild bundle -> dist/game.js
node tools/serve.mjs 8080
```

Re-render assets (needs Blender 5.x, Python with numpy/Pillow/scipy, ffmpeg):

```bash
Blender -b -P blender/facades.py -- all 2048 && python3 tools/pack_facades.py
Blender -b -P blender/vehicles.py -- all     && python3 tools/pack_vehicles.py
Blender -b -P blender/sky.py -- 4096 160     && python3 tools/pack_sky.py
python3 tools/make_music.py
```

## Controls

| | |
|---|---|
| tilt like a steering wheel | turn |
| lean top away / toward you | dive / climb |
| GAS (right) / BRAKE (left) | accelerate / brake & hover |
| desktop | arrows/WASD, Space = gas, B = brake |
