import * as THREE from 'three';
import { installFogChunks, fogU, makeSceneFog, enableSkyFog } from './fog.js';
import { Post } from './post.js';
import { Sky } from './sky.js';
import { loadFacades, makeBuildingMaterial } from './facades.js';
import { City, EXTENT, P } from './city.js';
import { loadVehicle, Traffic } from './vehicles.js';
import { Taxi, ChaseCam } from './flight.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { FX } from './fx.js';
import { AudioEngine } from './audio.js';
import { Missions } from './missions.js';
import { Props } from './props.js';
import { Signs } from './signs.js';
import { timeU, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

const TIERS = {
  low:    { name: 'low',    dpr: 1.0, msaa: 0, bloomLevels: 4, texRes: 512,  aniso: 2, skyW: 2048, traffic: 140, searchlights: 4, signs: 160, streaks: 120, vehTex: 512,  taxiTex: 1024 },
  medium: { name: 'medium', dpr: 1.5, msaa: 0, bloomLevels: 5, texRes: 1024, aniso: 4, skyW: 2048, traffic: 300, searchlights: 8, signs: 280, streaks: 200, vehTex: 512,  taxiTex: 1024 },
  high:   { name: 'high',   dpr: 2.0, msaa: 4, bloomLevels: 5, texRes: 1024, aniso: 4, skyW: 4096, traffic: 460, searchlights: 12, signs: 400, streaks: 280, vehTex: 1024, taxiTex: 2048 },
  ultra:  { name: 'ultra',  dpr: 3.0, msaa: 4, bloomLevels: 6, texRes: 1536, aniso: 8, skyW: 4096, traffic: 640, searchlights: 16, signs: 520, streaks: 360, vehTex: 1024, taxiTex: 2048 },
};

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isTouch = navigator.maxTouchPoints > 0;
const qs = new URLSearchParams(location.search);
let tierName = qs.get('q') || (() => { try { return localStorage.getItem('cybertaxi.q'); } catch (_) { return null; } })() || (isIOS ? 'ultra' : 'high');
if (!TIERS[tierName]) tierName = 'high';
const ORDER = ['low', 'medium', 'high', 'ultra'];
let downgraded = false;
try {
  if (localStorage.getItem('cybertaxi.boot') === '1' && !qs.get('q')) {
    const i = Math.max(0, ORDER.indexOf(tierName) - 1);
    if (i < ORDER.indexOf(tierName)) { tierName = ORDER[i]; downgraded = true; localStorage.setItem('cybertaxi.q', tierName); }
  }
  localStorage.setItem('cybertaxi.boot', '1');
  setTimeout(() => { try { localStorage.removeItem('cybertaxi.boot'); } catch (_) {} }, 12000);
} catch (_) {}
const tier = TIERS[tierName];
if (qs.get('msaa') === '0') tier.msaa = 0;
let gameMode = (() => { try { return localStorage.getItem('cybertaxi.mode'); } catch (_) { return null; } })() || 'taxi';

function fatal(msg) {
  const f = $('fatal'); f.classList.remove('hidden'); f.textContent = 'CYBERTAXI could not start.\n\n' + msg;
}
window.addEventListener('error', (e) => { if (!window.__booted) fatal(String(e.error?.stack || e.message)); });
window.addEventListener('unhandledrejection', (e) => { if (!window.__booted) fatal(String(e.reason?.stack || e.reason)); });

function setLoad(p, txt) { $('load-bar').firstElementChild.style.width = (p * 100).toFixed(0) + '%'; if (txt) $('load-txt').textContent = txt; }
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  const canvas = $('gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: false });
  } catch (e) { return fatal('WebGL 2 is not available on this device/browser.\n' + e.message); }
  if (!renderer.capabilities.isWebGL2) return fatal('WebGL 2 is required.');
  renderer.info.autoReset = false;
  renderer.setClearColor(0x04060b, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WEBGL2';
  $('gpu-name').textContent = 'WEBGL2 · ' + tier.name.toUpperCase();
  console.log('[cybertaxi]', tier.name, gpuName, 'maxTex', renderer.capabilities.maxTextureSize, 'aniso', renderer.capabilities.getMaxAnisotropy());
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    try { const i = Math.max(0, ORDER.indexOf(tier.name) - 1); localStorage.setItem('cybertaxi.q', ORDER[i]); } catch (_) {}
    fatal('The GPU ran out of memory (WebGL context lost). Reload the page – the graphics level was lowered automatically.');
  });
  const hdrOK = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  if (!hdrOK) return fatal('This device does not support half-float render targets (EXT_color_buffer_float).');

  installFogChunks();
  const scene = new THREE.Scene();
  scene.fog = makeSceneFog();
  const camera = new THREE.PerspectiveCamera(66, 1, 0.8, 9000);
  scene.add(camera);
  const post = new Post(renderer, { msaa: tier.msaa, bloomLevels: tier.bloomLevels });

  // ------------------------------------------------------------------ resolution handling
  const state = { scale: isIOS ? 0.82 : 1.0, minScale: 0.5, lock: 0, w: 0, h: 0 };
  function applySize(force = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dpr) * state.scale;
    const w = Math.max(64, Math.floor(window.innerWidth * dpr)), h = Math.max(64, Math.floor(window.innerHeight * dpr));
    if (!force && w === state.w && h === state.h) return;
    state.w = w; state.h = h;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    post.resize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fx && fx.setPointScale(h);
  }
  let fx = null;
  window.addEventListener('resize', () => { applySize(); checkOrientation(); });
  function checkOrientation() {
    const land = window.innerWidth > window.innerHeight * 1.15 && isTouch && window.innerWidth < 1000;
    $('rotate').classList.toggle('hidden', !land);
  }

  // ------------------------------------------------------------------ loading
  const prog = { sky: 0, tex: 0, veh: 0, audio: 0 };
  const W = { sky: 1.5, tex: 3, veh: 2.5, audio: 1.5 };
  const upd = (txt) => { let t = 0, d = 0; for (const k in W) { t += W[k]; d += W[k] * prog[k]; } setLoad(d / t, txt); };
  const audio = new AudioEngine();
  audio.prefetch('assets/audio/cyberpunk.mp3', (p) => { prog.audio = p; upd('MUSIC'); });

  const sky = new Sky(renderer, scene);
  applySize(true);
  upd('SKY');
  await sky.load('assets/sky/sky.webp', tier);
  prog.sky = 1; upd('FACADES');
  await frame();

  let done = 0;
  const fx_ = await loadFacades(renderer, tier, () => { done++; prog.tex = done / 28; upd('FACADES'); });
  const bmat = makeBuildingMaterial(fx_);
  const city = new City().generate(1337);
  const cityMesh = city.buildMesh(bmat);
  scene.add(cityMesh);
  prog.tex = 1; upd('VEHICLES');
  await frame();

  const props = new Props(scene, city, renderer);
  const ground = props.makeGround();
  scene.add(ground);
  let signs = null;
  try { signs = await new Signs(scene, city).load(renderer, tier.signs); } catch (e) { console.warn('signs', e); }

  // ------------------------------------------------------------------ vehicles
  const kinds = ['taxi', 'sedan', 'sport', 'van', 'truck', 'bus'];
  const vehicles = {};
  let vi = 0;
  await Promise.all(kinds.map(async (k) => {
    try { vehicles[k] = await loadVehicle(k, renderer, { size: k === 'taxi' ? tier.taxiTex : tier.vehTex, emissive: k === 'taxi' ? 2.0 : 2.2 }); }
    catch (e) { console.warn('vehicle', k, e); }
    vi++; prog.veh = vi / kinds.length; upd('VEHICLES');
  }));
  if (!vehicles.taxi) return fatal('taxi model failed to load');
  const taxiGroup = new THREE.Group();
  const taxiModel = new THREE.Mesh(vehicles.taxi.geometry, vehicles.taxi.material);
  taxiModel.frustumCulled = false;
  taxiGroup.add(taxiModel);
  scene.add(taxiGroup);
  const traffic = new Traffic(scene, vehicles, tier.traffic);
  fx = new FX(scene, taxiGroup, vehicles.taxi.marks, city, tier);
  fx.setPointScale(state.h);
  props.makePads(fx);

  // ------------------------------------------------------------------ game objects
  const input = new Input();
  input.sens = 1.0;
  const hud = new HUD();
  const taxi = new Taxi();
  const chase = new ChaseCam(camera);
  const missions = new Missions({ city, fx, hud, audio, scene });
  const spawn = () => { taxi.reset(city.spawn, 0); chase.init = false; };
  spawn();
  missions.mode = 'free'; missions.hasMarker = false;

  // attract-mode autopilot along the central street
  const auto = { steer: 0, pitchIn: 0, gas: 0, brake: 0 };
  function autopilot() {
    const targetX = -120;
    const ex = targetX - taxi.pos.x;
    const desiredYaw = clamp(ex * 0.012, -0.35, 0.35);
    let dy = desiredYaw - taxi.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    auto.steer = clamp(-dy * 2.2, -1, 1);
    auto.pitchIn = clamp((175 + Math.sin(performance.now() * 0.0003) * 40 - taxi.pos.y) * 0.012, -0.45, 0.45);
    auto.gas = taxi.speed < 38 ? 1 : 0; auto.brake = 0;
    if (taxi.pos.z > 1450) { taxi.pos.z = -1450; taxi.pos.x = -120; taxi.yaw = 0; chase.init = false; }
    return auto;
  }

  // ------------------------------------------------------------------ UI wiring
  let playing = false;
  const qChips = [...document.querySelectorAll('#t-q-chips button, #q-chips button')];
  const markTier = () => qChips.forEach((b) => b.classList.toggle('on', b.dataset.q === tier.name));
  markTier();
  qChips.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.q === tier.name) return;
    try { localStorage.setItem('cybertaxi.q', b.dataset.q); } catch (_) {}
    location.reload();
  }));
  const mChips = [...document.querySelectorAll('#t-m-chips button')];
  const markMode = () => { mChips.forEach((b) => b.classList.toggle('on', b.dataset.m === gameMode)); $('btn-mode').textContent = 'MODE: ' + (gameMode === 'taxi' ? 'TAXI' : 'FREE'); };
  markMode();
  const setMode = (m) => {
    gameMode = m; try { localStorage.setItem('cybertaxi.mode', m); } catch (_) {}
    markMode();
    if (playing) { missions.setMode(m); if (m === 'taxi') { $('fare').classList.remove('hidden'); } else $('fare').classList.add('hidden'); }
  };
  mChips.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
  $('btn-mode').addEventListener('click', () => { setMode(gameMode === 'taxi' ? 'free' : 'taxi'); audio.click(); });
  $('btn-reset').addEventListener('click', () => { spawn(); audio.click(); });
  $('btn-cal').addEventListener('click', () => { input.calibrate(); hud.toast('TILT RECENTERED', 1200); audio.click(); });
  $('btn-invert').addEventListener('click', () => { input.invert = !input.invert; $('btn-invert').textContent = 'INVERT PITCH: ' + (input.invert ? 'ON' : 'OFF'); audio.click(); });
  $('sens').addEventListener('input', (e) => { input.sens = +e.target.value; });
  $('vol-music').addEventListener('input', (e) => audio.setMusic(+e.target.value));
  $('vol-sfx').addEventListener('input', (e) => audio.setSfx(+e.target.value));

  $('start').addEventListener('click', async () => {
    if (playing) return;
    playing = true;
    const pm = input.requestMotion();
    const pa = audio.start();
    const granted = await pm;
    await pa;
    input.calibrate();
    $('title').classList.add('out');
    hud.show();
    setTimeout(() => $('title').classList.add('hidden'), 1000);
    if (!granted && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' && /iPhone|iPad/.test(navigator.userAgent)) hud.toast('MOTION ACCESS DENIED\nENABLE IN SETTINGS › SAFARI › MOTION', 5000);
    else if (!input.hasMotion && !isTouch) hud.toast('DESKTOP: ARROWS / WASD · SPACE = GAS · B = BRAKE', 5000);
    missions.setMode(gameMode);
    if (gameMode === 'taxi') $('fare').classList.remove('hidden'); else $('fare').classList.add('hidden');
    $('fare').classList.toggle('hidden', gameMode !== 'taxi');
    try { screen.orientation?.lock?.('portrait').catch(() => {}); } catch (_) {}
  });

  // ------------------------------------------------------------------ main loop
  const tmpN = new THREE.Vector3();
  const mv = new THREE.Vector3();
  let last = performance.now(), acc = 0, frames = 0, msAcc = 0, slow = 0, fast = 0, probeAt = 0, hudT = 0;
  let nearT = 0;
  let fpsShown = 60;
  checkOrientation();
  setLoad(1, 'READY');
  $('load').classList.add('hidden');
  $('t-menu').classList.remove('hidden');
  $('title').classList.add('live');
  window.__booted = true;
  if (downgraded) hud.toast('GRAPHICS LOWERED TO ' + tier.name.toUpperCase() + '\n(previous start did not finish)', 4500);
  window.__ct = { signs, fogU, taxi, input, city, camera, post, renderer, scene, traffic, missions, fx, state, tier, sky, audio };

  function loop(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25;
    const dtc = Math.min(dt, 1 / 20);
    timeU.value += dt;
    input.update(dtc);
    const rotated = !$('rotate').classList.contains('hidden');
    if (!rotated) {
      taxi.update(dtc, input, city, playing ? null : autopilot());
      const hit = traffic.collide(taxi.pos, 3.4, taxi.vel);
      if (hit && hit.impact > 3) { taxi.impact = Math.max(taxi.impact || 0, hit.impact); taxi.hit = 0; }
      traffic.update(dtc, taxi.pos);
      if (taxi.impact > 5 && playing) {
        audio.impact(taxi.impact);
        fx.spark(taxi.pos, 14 + Math.min(30, taxi.impact), 16 + taxi.impact * 0.6, [1.0, 0.65, 0.25]);
        if (playing && navigator.vibrate && isTouch) navigator.vibrate(Math.min(60, 10 + taxi.impact));
      }
      // sparks while scraping
      // taxi mesh transform with a tiny hover wobble
      taxiGroup.position.copy(taxi.pos);
      const bob = Math.sin(timeU.value * 2.1) * 0.12;
      taxiGroup.position.y += bob;
      taxiGroup.quaternion.copy(taxi.quat);
      chase.update(dtc, taxi, city);
      camera.updateMatrixWorld(true);
      sky.update(camera);
      fx.update(dtc, taxi, camera, playing ? input : { gasV: 1, brakeV: 0 });
      missions.update(dtc, taxi, camera);
      audio.update(taxi.speed, input.gasV, input.brakeV, taxi.boost);
      // near-miss whoosh with traffic
      nearT -= dtc;
      if (nearT <= 0 && taxi.speed > 25) {
        for (const c of traffic.cars) {
          const dx = c.x - taxi.pos.x, dy = c.y - taxi.pos.y, dz = c.z - taxi.pos.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 22 * 22 && d2 > 7 * 7) {
            mv.set(dx, dy, dz).applyQuaternion(camera.quaternion.clone().invert());
            audio.whoosh(clamp(mv.x / 25, -1, 1), clamp(taxi.speed / 80, 0.3, 1)); nearT = 0.35; break;
          }
        }
      }
      post.u.speed.value = clamp((taxi.speed - 40) / 80, 0, 1) * (0.5 + 0.5 * taxi.boost);
      post.u.time.value = timeU.value;
      post.u.flash.value = taxi.impact > 8 ? Math.min(0.12, taxi.impact * 0.003) : post.u.flash.value * 0.8;
      fogU.fogH.value.w = 1.0;
    }

    // ---- render
    renderer.info.reset();
    post.render(scene, camera);

    // ---- stats / adaptive resolution
    frames++; acc += dt; msAcc += dt * 1000;
    if (acc >= 0.5) {
      fpsShown = Math.round(frames / acc);
      hud.stats(fpsShown, (msAcc / frames).toFixed(1), post.sceneInfo.calls, post.sceneInfo.triangles, `${state.w}×${state.h}`);
      const avgMs = msAcc / frames;
      if (now > state.lock) {
        if (avgMs > 19.5 && state.scale > state.minScale) { state.scale = Math.max(state.minScale, state.scale - 0.08); applySize(); state.lock = now + 2500; state.upLock = (state.upLock || 0) + 1; }
        else if (avgMs < 17.6 && state.scale < 1 && now > probeAt) { state.scale = Math.min(1, state.scale + 0.04); applySize(); state.lock = now + 4000; probeAt = now + 6000 * (1 + (state.upLock || 0)); }
      }
      acc = 0; frames = 0; msAcc = 0;
    }
    if (playing) {
      hudT += dt;
      if (hudT > 0.05) { hudT = 0; hud.flight(taxi.speed, taxi.pos.y); }
      hud.edgeWarn(taxi.edge > 0.2);
      // mission marker projection
      if (missions.hasMarker) {
        mv.copy(missions.worldMarker).project(camera);
        const W2 = window.innerWidth, H2 = window.innerHeight;
        let x = (mv.x * 0.5 + 0.5) * W2, y = (-mv.y * 0.5 + 0.5) * H2;
        let behind = mv.z > 1;
        const m = 34;
        let edge = behind || x < m || x > W2 - m || y < m + 60 || y > H2 - 150;
        let ang = 0;
        if (edge) {
          let dx = mv.x, dy = -mv.y;
          if (behind) { dx = -dx; dy = -dy; }
          ang = Math.atan2(dy, dx);
          const cx = W2 / 2, cy = H2 / 2;
          const sx = (W2 / 2 - m) / (Math.abs(Math.cos(ang)) + 1e-4), sy = (H2 / 2 - 120) / (Math.abs(Math.sin(ang)) + 1e-4);
          const r = Math.min(sx, sy);
          x = cx + Math.cos(ang) * r; y = cy + Math.sin(ang) * r;
        }
        hud.marker(true, x, y, edge, ang, missions.markerText);
      } else hud.marker(false);
    }
  }
  renderer.setAnimationLoop(loop);
}

boot().catch((e) => fatal(String(e?.stack || e)));
