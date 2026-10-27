// Canvas orb that reacts to audio. Modes: idle, connecting, listening, speaking, muted.
// Hardened against NaN/Infinity (bad sizes, bad levels, huge frame gaps) and the glow
// is sized so it always stays inside the canvas.
import { clamp01, finite } from "./levels.js";

const TAU = Math.PI * 2;
const POINTS = 96;

export class Orb {
  constructor(canvas, { getLevels }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getLevels = getLevels;
    this.mode = "idle";
    this.level = 0; // smoothed level, 0..1
    this.t = 0;
    this.spin = 0;
    this.last = performance.now();
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.colors = null;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.readColors();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  setMode(mode) {
    this.mode = mode;
  }

  // Colors come from CSS tokens so the orb follows the theme.
  readColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n, fb) => (cs.getPropertyValue(n).trim() || fb);
    this.colors = {
      a: get("--orb-a", "#7c5cff"),
      b: get("--orb-b", "#c084fc"),
      c: get("--orb-c", "#22d3ee"),
      glow: get("--orb-glow", "rgba(124,92,255,0.55)"),
      glowFade: get("--orb-glow-fade", "rgba(124,92,255,0)"),
      muted: get("--orb-muted", "#6b6585"),
      ring: get("--orb-ring", "rgba(255,255,255,0.35)"),
    };
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, Math.max(1, finite(window.devicePixelRatio, 1)));
    const w = Math.max(1, Math.round(finite(rect.width, 1)));
    const h = Math.max(1, Math.round(finite(rect.height, 1)));
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  _frame(now) {
    try {
      this._step(now);
    } catch (err) {
      // Never let one bad frame stop the animation loop.
      if (!this._warned) {
        console.warn("orb frame error", err);
        this._warned = true;
      }
    }
    requestAnimationFrame(this._frame);
  }

  _step(now) {
    let dt = (finite(now, this.last) - this.last) / 1000;
    this.last = finite(now, this.last);
    if (!(dt > 0) || dt > 0.1) dt = 1 / 60; // tab was hidden, or clock jumped

    const slow = this.reduced.matches ? 0.35 : 1;
    this.t = finite(this.t + dt * slow, 0) % 1e4;
    this.spin = finite(this.spin + dt * 2.4 * slow, 0) % TAU;

    const { mic, bot } = this.getLevels();
    let target = 0;
    if (this.mode === "listening") target = clamp01(mic);
    else if (this.mode === "speaking") target = Math.max(clamp01(bot), 0.12);
    const k = target > this.level ? 0.35 : 0.08; // fast attack, slow release
    this.level = clamp01(this.level + (target - this.level) * k);

    this._draw();
  }

  _draw() {
    const { ctx, w, h, dpr, colors } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const half = Math.min(w, h) / 2;
    // Budget: base radius + wobble + glow must fit inside `half`.
    const base = half * 0.52;
    const lvl = this.level;
    const mode = this.mode;

    let wobble;
    let swell;
    if (mode === "idle") {
      wobble = 0.025;
      swell = 0.02 * Math.sin(this.t * 1.4);
    } else if (mode === "connecting") {
      wobble = 0.035;
      swell = 0.03 * Math.sin(this.t * 4);
    } else if (mode === "muted") {
      wobble = 0.01;
      swell = -0.06;
    } else {
      wobble = 0.03 + lvl * 0.12;
      swell = lvl * 0.14;
    }
    if (this.reduced.matches) wobble *= 0.5;

    const r = base * (1 + swell);
    const maxR = r * (1 + wobble * 1.6);
    const glowR = Math.min(half - 1, maxR * 1.55);

    // Glow (radial gradient clipped to the canvas by construction: glowR <= half).
    const glowAlpha = mode === "muted" ? 0.18 : 0.45 + lvl * 0.5;
    const g = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, Math.max(r * 0.41, glowR));
    g.addColorStop(0, colors.glow);
    g.addColorStop(1, colors.glowFade);
    ctx.globalAlpha = clamp01(glowAlpha);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Organic blob body.
    ctx.beginPath();
    for (let i = 0; i <= POINTS; i++) {
      const a = (i / POINTS) * TAU;
      const n =
        Math.sin(a * 3 + this.t * 1.7) * 0.5 +
        Math.sin(a * 5 - this.t * 2.3 + 1.3) * 0.3 +
        Math.sin(a * 2 + this.t * 0.9 + 2.1) * 0.2;
      const rr = finite(r * (1 + wobble * n), r);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    if (mode === "muted") {
      ctx.fillStyle = colors.muted;
    } else {
      const ang = this.t * 0.6;
      const fill = ctx.createLinearGradient(
        cx + Math.cos(ang) * r, cy + Math.sin(ang) * r,
        cx - Math.cos(ang) * r, cy - Math.sin(ang) * r
      );
      fill.addColorStop(0, colors.a);
      fill.addColorStop(0.55, colors.b);
      fill.addColorStop(1, mode === "listening" || mode === "speaking" ? colors.c : colors.b);
      ctx.fillStyle = fill;
    }
    ctx.fill();

    // Soft inner highlight.
    const hl = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.4, r * 0.9);
    hl.addColorStop(0, "rgba(255,255,255,0.35)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fill();

    // Connecting: a rotating arc around the orb.
    if (mode === "connecting") {
      ctx.strokeStyle = colors.ring;
      ctx.lineWidth = Math.max(1.5, half * 0.018);
      ctx.lineCap = "round";
      const ringR = Math.min(half - ctx.lineWidth, maxR * 1.18);
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, this.spin, this.spin + TAU * 0.28);
      ctx.stroke();
    }
  }
}
