"""Offline synthesis of the CYBERTAXI soundtrack: a seamless ~3 minute dark-synthwave / Vangelis-style loop.

python3 tools/make_music.py  ->  assets/audio/cyberpunk.mp3  (needs numpy, scipy, ffmpeg)

All synthesis is done here with numpy (band-limited saws, pads, arps, bass, drums, convolution reverb, ping-pong
delay, sidechain pump) so the game ships one small mp3 and needs no licensed music.
"""
import os, subprocess, sys
import numpy as np
from scipy import signal

SR = 44100
BPM = 92.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
NBARS = 64
N = int(round(NBARS * BAR * SR))
TAIL = int(5.0 * SR)
rng = np.random.default_rng(7)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "audio")
os.makedirs(OUT, exist_ok=True)

L = np.zeros(N + TAIL, dtype=np.float64)
R = np.zeros(N + TAIL, dtype=np.float64)
send_rev = np.zeros((2, N + TAIL))     # reverb send bus
send_dly = np.zeros((2, N + TAIL))     # ping-pong delay send bus
duck = np.ones(N + TAIL)               # sidechain curve (multiplies pad/bass/arp)


def mtof(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=np.float64) - 69) / 12.0)


def tsec(bar, beat=0.0):
    return (bar * 4 + beat) * BEAT


def poly_blep(t, dt):
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt
    out[m] = x + x - x * x - 1.0
    m = t > 1.0 - dt
    x = (t[m] - 1.0) / dt
    out[m] = x * x + x + x + 1.0
    return out


def saw(f, n, ph0=0.0):
    dt = f / SR
    t = (ph0 + np.arange(n) * dt) % 1.0
    return 2.0 * t - 1.0 - poly_blep(t, dt)


def pulse(f, n, w=0.5, ph0=0.0):
    dt = f / SR
    t = (ph0 + np.arange(n) * dt) % 1.0
    s1 = 2.0 * t - 1.0 - poly_blep(t, dt)
    t2 = (t + w) % 1.0
    s2 = 2.0 * t2 - 1.0 - poly_blep(t2, dt)
    return (s1 - s2) * 0.5


def sine(f, n, ph0=0.0):
    return np.sin(2 * np.pi * (ph0 + np.arange(n) * f / SR))


def env(n, a, d, s, r, sr_=SR):
    """ADSR where the note length n includes the release."""
    e = np.zeros(n)
    na, nd, nr = int(a * sr_), int(d * sr_), int(r * sr_)
    na = min(na, n)
    if na > 0:
        e[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, n - na)
    if nd > 0:
        e[na:na + nd] = np.linspace(1, s, nd, endpoint=False)
    hold_end = max(na + nd, n - nr)
    e[na + nd:hold_end] = s
    nr = n - hold_end
    if nr > 0:
        e[hold_end:] = np.linspace(s, 0, nr)
    return e


def lowpass(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR * 0.45) / (SR / 2), "low", output="sos")
    return signal.sosfilt(sos, x)


def highpass(x, fc, order=2):
    sos = signal.butter(order, fc / (SR / 2), "high", output="sos")
    return signal.sosfilt(sos, x)


def bandpass(x, lo, hi, order=2):
    sos = signal.butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], "band", output="sos")
    return signal.sosfilt(sos, x)


def place(buf, x, t0, pan=0.0, gain=1.0, rev=0.0, dly=0.0, duck_amt=0.0):
    i0 = int(t0 * SR)
    n = len(x)
    if i0 + n > len(L):
        x = x[:len(L) - i0]
        n = len(x)
    if n <= 0:
        return
    gl = np.cos((pan + 1) * np.pi / 4) * gain
    gr = np.sin((pan + 1) * np.pi / 4) * gain
    seg = x
    if duck_amt > 0:
        seg = x * (1 - duck_amt * (1 - duck[i0:i0 + n]))
    L[i0:i0 + n] += seg * gl
    R[i0:i0 + n] += seg * gr
    if rev:
        send_rev[0, i0:i0 + n] += seg * gl * rev
        send_rev[1, i0:i0 + n] += seg * gr * rev
    if dly:
        send_dly[0, i0:i0 + n] += seg * gl * dly
        send_dly[1, i0:i0 + n] += seg * gr * dly


# ------------------------------------------------------------------------------------------------
# harmony
# ------------------------------------------------------------------------------------------------
D, Bb, F, C, G, A, E = 2, 10, 5, 0, 7, 9, 4
CH = {  # name -> (root midi (bass), voicing midi notes)
    "Dm9":   (38, [50, 57, 60, 64, 65]),
    "Bbmaj9": (34, [46, 53, 57, 60, 62]),
    "Fmaj7": (41, [53, 57, 60, 64, 69]),
    "Cadd9": (36, [52, 55, 60, 62, 67]),
    "Gm9":   (43, [50, 55, 58, 62, 65]),
    "A7sus": (33, [52, 55, 57, 62, 64]),
    "A7":    (33, [49, 55, 57, 61, 64]),
}
P1 = ["Dm9", "Bbmaj9", "Fmaj7", "Cadd9"]
P2 = ["Dm9", "Gm9", "Bbmaj9", "A7sus"]
P2b = ["Dm9", "Gm9", "Bbmaj9", "A7"]
prog = []
prog += ["Dm9", "Dm9", "Bbmaj9", "Bbmaj9", "Fmaj7", "Fmaj7", "Gm9", "A7sus"]          # intro 0-7
prog += P1 * 4                                                                          # A 8-23
prog += (P2 + P2 + P2 + P2b)                                                            # B 24-39
prog += ["Bbmaj9", "Bbmaj9", "Fmaj7", "Fmaj7", "Gm9", "Gm9", "A7sus", "A7"]              # break 40-47
prog += (P1 + P1 + P2 + ["Dm9", "Gm9", "Bbmaj9", "Dm9"])                                # A' 48-63
assert len(prog) == NBARS, len(prog)

# sections (bar index)
def sec(b):
    if b < 8: return "intro"
    if b < 24: return "A"
    if b < 40: return "B"
    if b < 48: return "break"
    if b < 60: return "A2"
    return "outro"


# ------------------------------------------------------------------------------------------------
# sidechain curve from the kick pattern (4 on the floor from bar 8, thinning at the end)
# ------------------------------------------------------------------------------------------------
kick_times = []
for b in range(NBARS):
    s = sec(b)
    if s in ("A", "A2"):
        beats = [0, 2, 2.5] if b % 2 == 0 else [0, 1.5, 2]
    elif s == "B":
        beats = [0, 1, 2, 3]
    elif s == "break":
        beats = [0] if b % 2 == 0 else []
    else:
        beats = []
    for bt in beats:
        kick_times.append(tsec(b, bt))
for kt in kick_times:
    i0 = int(kt * SR)
    n = int(0.42 * SR)
    seg = 1 - np.exp(-np.arange(n) / (0.09 * SR))
    j1 = min(i0 + n, len(duck))
    duck[i0:j1] = np.minimum(duck[i0:j1], seg[:j1 - i0] * 0.8 + 0.2 * 0)

# ------------------------------------------------------------------------------------------------
# PAD (detuned saw unison, slow filter) -- one chord per bar, legato
# ------------------------------------------------------------------------------------------------
pad_L = np.zeros(N + TAIL); pad_R = np.zeros(N + TAIL)
for b in range(NBARS):
    root, notes = CH[prog[b]]
    s = sec(b)
    t0 = tsec(b) - 0.25
    dur = BAR + 1.6
    n = int(dur * SR)
    amp = {"intro": 0.55, "A": 0.42, "B": 0.5, "break": 0.7, "A2": 0.45, "outro": 0.6}[s]
    if b < 2: amp *= (0.35 + 0.65 * b / 2)
    for k, m in enumerate(notes):
        for d_c, pn in ((-7, -0.8), (-2, -0.3), (3, 0.25), (8, 0.75)):
            f = mtof(m) * 2 ** (d_c / 1200)
            x = saw(f, n, rng.random()) * 0.22
            x *= env(n, 1.1, 0.5, 0.9, 1.5)
            i0 = int(max(t0, 0) * SR)
            gl = np.cos((pn + 1) * np.pi / 4); gr = np.sin((pn + 1) * np.pi / 4)
            seg = x[:len(pad_L) - i0]
            pad_L[i0:i0 + len(seg)] += seg * gl * amp / 4
            pad_R[i0:i0 + len(seg)] += seg * gr * amp / 4
# slow-moving filter on the pad bus (cutoff opens in B sections)
def swept_lp(x, curve_fn, block=1024):
    out = np.zeros_like(x)
    zi = None
    prev_fc = None
    for i0 in range(0, len(x), block):
        t = i0 / SR
        fc = curve_fn(t)
        sos = signal.butter(2, fc / (SR / 2), "low", output="sos")
        if zi is None or prev_fc is None:
            zi = np.zeros((sos.shape[0], 2))
        out[i0:i0 + block], zi = signal.sosfilt(sos, x[i0:i0 + block], zi=zi)
        prev_fc = fc
    return out
def pad_cut(t):
    b = t / BAR
    base = 900 + 700 * (0.5 + 0.5 * np.sin(t * 0.35))
    s = sec(int(b) % NBARS)
    if s == "B": base += 900
    if s == "break": base += 500
    if b > 59: base *= max(0.3, 1.0 - (b - 59) * 0.15)
    return min(base, 6000)
pad_L = swept_lp(pad_L, pad_cut); pad_R = swept_lp(pad_R, pad_cut)
pad_duck = 1 - 0.55 * (1 - duck)
L += pad_L * pad_duck; R += pad_R * pad_duck
send_rev[0] += pad_L * 0.55; send_rev[1] += pad_R * 0.55

# ------------------------------------------------------------------------------------------------
# SUB DRONE (intro + break)
# ------------------------------------------------------------------------------------------------
for b in list(range(0, 8)) + list(range(40, 48)) + list(range(60, 64)):
    root, _ = CH[prog[b]]
    n = int((BAR + 0.3) * SR)
    x = (sine(mtof(root - 12), n) * 0.3 + sine(mtof(root), n) * 0.12) * env(n, 0.6, 0.2, 0.9, 0.8)
    place(L, x, tsec(b), 0, 0.55, rev=0.1)

# ------------------------------------------------------------------------------------------------
# BASS (8th-note pulse, saw+square, low-passed, ducked)
# ------------------------------------------------------------------------------------------------
BASS_PAT = [0, 0, 12, 0, 0, 0, 7, 0]      # semitone offsets per 8th
BASS_PAT2 = [0, 0, 0, 12, 0, 7, 0, 5]
for b in range(8, NBARS):
    s = sec(b)
    if s in ("break", "outro") or (s == "intro"):
        continue
    root, _ = CH[prog[b]]
    pat = BASS_PAT if (b % 2 == 0) else BASS_PAT2
    for i, off in enumerate(pat):
        if s == "A" and b < 12 and i % 2 == 1 and off == 0:
            continue
        m = root + off
        f = mtof(m)
        n = int(BEAT * 0.5 * SR * 0.95)
        x = (saw(f, n) * 0.6 + pulse(f, n, 0.5) * 0.4)
        x = lowpass(x, 320 + 700 * (0.5 + 0.5 * np.sin(b * 0.9 + i)), 2) * env(n, 0.004, 0.08, 0.7, 0.05)
        place(L, x, tsec(b, i * 0.5), 0.0, 0.36, rev=0.04, duck_amt=0.9)


# ------------------------------------------------------------------------------------------------
# ARP (16th pulse arpeggio with ping-pong delay)
# ------------------------------------------------------------------------------------------------
ARP_IDX = [0, 2, 4, 3, 1, 3, 2, 4, 0, 2, 3, 4, 2, 3, 1, 2]
for b in range(4, NBARS):
    s = sec(b)
    if s == "outro":
        continue
    _, notes = CH[prog[b]]
    notes = [n_ + 12 for n_ in notes]
    notes_ext = notes + [n_ + 12 for n_ in notes[:2]]
    amp = {"intro": 0.10, "A": 0.18, "B": 0.22, "break": 0.12, "A2": 0.2}[s]
    steps = 16
    for i in range(steps):
        if s == "break" and i % 2 == 1:
            continue
        m = notes_ext[ARP_IDX[i] % len(notes_ext)]
        f = mtof(m)
        n = int(BEAT * 0.25 * SR * 1.8)
        x = pulse(f, n, 0.32 + 0.12 * np.sin(b + i * 0.4)) * 0.8
        fc = 1400 + 2600 * np.exp(-np.arange(n) / (0.12 * SR))
        # per-note filter sweep approximated by mixing two lowpassed versions
        x = 0.6 * lowpass(x, 1800) + 0.4 * lowpass(x, 4800) * np.exp(-np.arange(n) / (0.1 * SR))
        x *= env(n, 0.002, 0.1, 0.35, 0.12)
        vel = 0.75 + 0.25 * (i % 4 == 0)
        pan = -0.35 if i % 2 == 0 else 0.35
        place(L, x, tsec(b, i * 0.25), pan, amp * vel, rev=0.18, dly=0.5, duck_amt=0.6)

# ------------------------------------------------------------------------------------------------
# LEAD (Vangelis-like sustained melody with vibrato + portamento)
# ------------------------------------------------------------------------------------------------
# (bar_offset_in_phrase, beat, midi, beats)
PHR1 = [  # over P1 (Dm9 | Bbmaj9 | Fmaj7 | Cadd9)
    (0, 0, 69, 3), (0, 3, 72, 1), (1, 0, 74, 2), (1, 2, 72, 1), (1, 3, 69, 1), (2, 0, 72, 2.5), (2, 2.5, 69, 1.5),
    (3, 0, 67, 2), (3, 2, 64, 1), (3, 3, 67, 1),
]
PHR2 = [  # over P2 (Dm9 | Gm9 | Bbmaj9 | A7sus)
    (0, 0, 74, 2), (0, 2, 77, 2), (1, 0, 76, 3), (1, 3, 74, 1), (2, 0, 72, 2), (2, 2, 74, 2), (3, 0, 76, 2), (3, 2, 73, 1.5), (3, 3.5, 74, 0.5),
]
PHR3 = [  # break: slow and wide
    (0, 0, 81, 4), (1, 0, 79, 4), (2, 0, 77, 3), (2, 3, 76, 1), (3, 0, 74, 4),
]
def lead_note(m, beats, t0, amp=0.28, prev=None):
    n = int((beats * BEAT + 1.2) * SR)
    f0 = mtof(m)
    # portamento from previous note
    f = np.full(n, f0)
    if prev is not None:
        glide = int(0.09 * SR)
        f[:glide] = np.linspace(mtof(prev), f0, glide)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.4 * np.arange(n) / SR) * np.clip(np.arange(n) / (0.5 * SR), 0, 1)
    ph = np.cumsum(f * vib) / SR
    x = np.sin(2 * np.pi * ph) * 0.6 + (2 * ((ph % 1.0)) - 1) * 0.22 + np.sin(4 * np.pi * ph) * 0.12
    x = lowpass(x, 3200)
    x *= env(n, 0.04, 0.2, 0.8, 1.1 + 0.0)
    # cut to hold length + release by shaping env end
    hold = int(beats * BEAT * SR)
    e2 = np.ones(n); e2[hold:] = np.exp(-np.arange(n - hold) / (0.35 * SR))
    x *= e2
    place(L, x, t0, 0.05, amp, rev=0.75, dly=0.45)

def lead_phrase(phr, bar0, amp=0.28):
    prev = None
    for (bo, bt, m, bts) in phr:
        lead_note(m, bts, tsec(bar0 + bo, bt), amp, prev)
        prev = m

for b in range(16, 24, 4): lead_phrase(PHR1, b, 0.2)
for b in range(24, 40, 4): lead_phrase(PHR2, b, 0.3)
for b in range(40, 48, 4): lead_phrase(PHR3, b, 0.3)
for b in range(48, 56, 4): lead_phrase(PHR1, b, 0.28)
lead_phrase(PHR2, 56, 0.3)

# ------------------------------------------------------------------------------------------------
# DRUMS
# ------------------------------------------------------------------------------------------------
def kick():
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 46 + 130 * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t * 7.5)
    x += np.sin(ph * 2) * np.exp(-t * 28) * 0.25
    click = rng.normal(size=n) * np.exp(-t * 400) * 0.25
    return np.tanh((x + click) * 1.6) * 0.9

def snare():
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (190 - 50 * t * 6) * t) * np.exp(-t * 22) * 0.5
    noise = bandpass(rng.normal(size=n), 1500, 9000) * np.exp(-t * 15) * 0.7
    return np.tanh((body + noise) * 1.3)

def hat(open_=False):
    n = int((0.35 if open_ else 0.09) * SR)
    t = np.arange(n) / SR
    x = highpass(rng.normal(size=n), 7000) * np.exp(-t * (14 if open_ else 60))
    return x * 0.5

def clap():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for d in (0, 0.012, 0.024):
        i = int(d * SR)
        seg = bandpass(rng.normal(size=n - i), 900, 3800) * np.exp(-t[:n - i] * 40)
        x[i:] += seg
    x += bandpass(rng.normal(size=n), 900, 3800) * np.exp(-t * 14) * 0.5
    return x * 0.5

KICK, SNARE, HAT, OHAT, CLAP = kick(), snare(), hat(), hat(True), clap()
for b in range(8, 64):
    s = sec(b)
    if s in ("intro", "outro"): continue
    if s == "break" and b % 2 == 1: continue
    if s == "break":
        place(L, KICK, tsec(b), 0, 0.5)
        place(L, HAT, tsec(b, 2), 0.2, 0.12)
        continue
    for bt in ([0, 2, 2.5] if (s in ("A", "A2") and b % 2 == 0) else [0, 1.5, 2] if s in ("A", "A2") else [0, 1, 2, 3]):
        place(L, KICK, tsec(b, bt), 0, 0.8)
    for bt in (1, 3):
        place(L, SNARE, tsec(b, bt), 0.05, 0.42, rev=0.5)
        if s == "B": place(L, CLAP, tsec(b, bt), -0.1, 0.35, rev=0.55)
    steps = 8 if s in ("A", "A2") else 16
    for i in range(steps):
        bt = i * (4.0 / steps)
        v = 0.34 if i % 2 == 0 else 0.2
        if s == "B" and i % 4 == 2:
            place(L, OHAT, tsec(b, bt), 0.3, 0.2)
        else:
            place(L, HAT, tsec(b, bt), -0.25 if (i % 2) else 0.25, v * (0.75 if steps == 16 else 1.0))
    if b % 8 == 7 and s in ("A", "B"):                               # fill
        for k in range(4):
            place(L, SNARE, tsec(b, 3 + k * 0.25), 0, 0.2 + k * 0.08, rev=0.4)

# ------------------------------------------------------------------------------------------------
# ATMOSPHERE: rain/wind bed, risers, reverse cymbal
# ------------------------------------------------------------------------------------------------
def noise_bed(n, seed):
    r = np.random.default_rng(seed).normal(size=n)
    r = bandpass(r, 800, 7000, 2)
    return r

bed_n = N + TAIL
for ch, seed in ((0, 11), (1, 12)):
    bed = noise_bed(bed_n, seed)
    tt = np.arange(bed_n) / SR
    mod = 0.55 + 0.45 * np.sin(2 * np.pi * tt / (BAR * 8) + ch) ** 2
    bed *= mod * 0.012
    (L if ch == 0 else R)[:] += bed

def riser(b0, bars=1.0, amp=0.5):
    n = int(bars * BAR * SR)
    t = np.arange(n) / SR
    x = rng.normal(size=n)
    out = np.zeros(n)
    blocks = 40
    for k in range(blocks):
        i0, i1 = k * n // blocks, (k + 1) * n // blocks
        fc = 300 * (40 ** (k / blocks))
        out[i0:i1] = bandpass(x[i0:i1], fc * 0.7, fc * 1.4, 2)
    out *= (np.linspace(0, 1, n) ** 2.2) * amp
    place(L, out, tsec(b0), 0.0, 1.0, rev=0.4)

riser(23, 1.0, 0.18); riser(39, 1.0, 0.16); riser(47, 1.0, 0.16)

# ------------------------------------------------------------------------------------------------
# send buses: ping-pong delay + reverb (convolution), then master
# ------------------------------------------------------------------------------------------------
def pingpong(src_l, src_r, t_l=BEAT * 0.75, t_r=BEAT * 0.5 + BEAT * 0.25, fb=0.42, taps=6):
    out_l = np.zeros_like(src_l); out_r = np.zeros_like(src_r)
    dl, dr = int(t_l * SR), int(t_r * SR)
    cur_l, cur_r = src_l, src_r
    for k in range(1, taps + 1):
        g = fb ** k
        out_r[dl * k:] += cur_l[:len(cur_l) - dl * k] * g if dl * k < len(cur_l) else 0
        out_l[dr * k:] += cur_r[:len(cur_r) - dr * k] * g if dr * k < len(cur_r) else 0
    return lowpass(out_l, 3500, 1), lowpass(out_r, 3500, 1)

dl_l, dl_r = pingpong(send_dly[0], send_dly[1])
L += dl_l * 0.7; R += dl_r * 0.7
send_rev[0] += dl_l * 0.35; send_rev[1] += dl_r * 0.35

def make_ir(seconds=3.6, pre=0.03, damp=3800.0):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    irs = []
    for ch in range(2):
        r = np.random.default_rng(100 + ch).normal(size=n)
        r *= np.exp(-t * 1.9) * (1 - np.exp(-t * 60))
        r = lowpass(r, damp, 1)
        r[: int(pre * SR)] = 0
        irs.append(r)
    return irs

ir_l, ir_r = make_ir()
def conv(x, ir):
    return signal.fftconvolve(x, ir, mode="full")[:len(x)]
rev_l = conv(send_rev[0], ir_l) * 0.05 + conv(send_rev[1], ir_r) * 0.012
rev_r = conv(send_rev[1], ir_r) * 0.05 + conv(send_rev[0], ir_l) * 0.012
L += rev_l; R += rev_r

# centre the mono-ish bass/kick: copy L-only placements (kick, bass, drums) into R as well
# (place() pans with equal-power law, so pan=0 elements are already in both channels)

# ------------------------------------------------------------------------------------------------
# fold the tail back onto the beginning -> perfectly seamless loop
# ------------------------------------------------------------------------------------------------
outL = L[:N].copy(); outR = R[:N].copy()
outL[:TAIL] += L[N:N + TAIL]; outR[:TAIL] += R[N:N + TAIL]
# master: DC + sub rumble cut, gentle glue (tanh), loudness
outL = highpass(outL, 28, 2); outR = highpass(outR, 28, 2)
peak = max(np.abs(outL).max(), np.abs(outR).max())
drive = 1.0 / peak * 1.6
outL = np.tanh(outL * drive) ; outR = np.tanh(outR * drive)
peak = max(np.abs(outL).max(), np.abs(outR).max())
outL *= 0.89 / peak; outR *= 0.89 / peak
rms = np.sqrt((outL ** 2 + outR ** 2).mean() / 2)
print(f"bars {NBARS}, seconds {N / SR:.1f}, peak 0.89, rms {rms:.3f} ({20 * np.log10(rms):.1f} dBFS)")

pcm = (np.stack([outL, outR], 1) * 32767).astype("<i2")
wav = os.path.join(ROOT, "build", "music.wav")
import wave
os.makedirs(os.path.dirname(wav), exist_ok=True)
with wave.open(wav, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
mp3 = os.path.join(OUT, "cyberpunk.mp3")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "160k", mp3], check=True)
print("wrote", mp3, os.path.getsize(mp3) // 1024, "KB")
