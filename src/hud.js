// DOM HUD helpers.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), fps: $('s-fps'), ms: $('s-ms'), draws: $('s-draws'), tris: $('s-tris'), res: $('s-res'),
      spd: $('sp-v'), alt: $('alt-v'), toast: $('toast'), mission: $('mission'), mTitle: $('m-title'), mSub: $('m-sub'), mBar: $('m-bar').firstElementChild,
      fare: $('fare-v'), marker: $('marker'), markerLabel: $('marker-label'), markerArrow: $('marker-arrow'), edge: $('edge-warn'), gpu: $('gpu-name'),
    };
    this._toastT = 0; this._sc = 0;
    $('deck-toggle').addEventListener('click', () => {
      const d = $('deck'); d.classList.toggle('collapsed');
      d.querySelector('b').textContent = d.classList.contains('collapsed') ? '+' : '−';
    });
  }
  show() { this.el.hud.classList.remove('hidden'); }
  stats(fps, ms, draws, tris, res) {
    this.el.fps.textContent = fps; this.el.ms.textContent = ms; this.el.draws.textContent = draws;
    this.el.tris.textContent = tris >= 1e6 ? (tris / 1e6).toFixed(2) + 'M' : (tris / 1e3).toFixed(0) + 'K'; this.el.res.textContent = res;
  }
  flight(speedMs, alt) {
    const kmh = Math.round(speedMs * 3.6);
    if (kmh !== this._kmh) { this.el.spd.textContent = kmh; this._kmh = kmh; }
    const a = Math.round(alt);
    if (a !== this._alt) { this.el.alt.textContent = `ALT ${a} M`; this._alt = a; }
  }
  setFare(n) { this.el.fare.textContent = '$' + n; }
  setMission(title, sub) {
    if (!title) { this.el.mission.classList.add('hidden'); return; }
    this.el.mission.classList.remove('hidden');
    if (title !== this._mt) { this.el.mTitle.textContent = title; this._mt = title; }
    if (sub != null && sub !== this._ms) { this.el.mSub.textContent = sub; this._ms = sub; }
  }
  setBoard(p, hint) {
    const m = this.el.mission;
    m.classList.toggle('boarding', p > 0.01);
    this.el.mBar.style.width = (p * 100).toFixed(0) + '%';
    if (hint) { this.el.mSub.textContent = hint; this._ms = hint; }
  }
  toast(text, ms = 2500) {
    const t = this.el.toast; t.textContent = text; t.classList.add('show');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
  marker(visible, x, y, edge, ang, label) {
    const m = this.el.marker;
    if (!visible) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    m.classList.toggle('edge', edge);
    this.el.markerArrow.style.transform = edge ? `rotate(${(ang * 180 / Math.PI + 45).toFixed(0)}deg)` : 'rotate(45deg)';
    if (label !== this._ml) { this.el.markerLabel.textContent = label; this._ml = label; }
    this.el.markerLabel.style.display = edge ? 'none' : '';
  }
  edgeWarn(on) { this.el.edge.classList.toggle('hidden', !on); }
}
