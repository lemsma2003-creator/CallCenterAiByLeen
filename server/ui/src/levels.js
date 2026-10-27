// Audio level meters for the mic and the bot, via Web Audio analysers.
// Every value is clamped to a finite 0..1 number so the orb can never receive NaN or Infinity.

export const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
export const clamp01 = (v) => Math.min(1, Math.max(0, finite(v)));

export class LevelMeter {
  constructor() {
    this.ctx = null;
    this.mic = null;
    this.bot = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // Call from a click handler so the browser lets the AudioContext start.
  unlock() {
    this._ensureCtx();
  }

  _attach(stream) {
    const ctx = this._ensureCtx();
    if (!ctx || !stream || !stream.getAudioTracks().length) return null;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser); // not connected to destination: playback is the <audio> element's job
    return { source, analyser, buf: new Float32Array(analyser.fftSize) };
  }

  _detach(node) {
    if (!node) return;
    try {
      node.source.disconnect();
    } catch {}
  }

  setMic(stream) {
    this._detach(this.mic);
    this.mic = stream ? this._attach(stream) : null;
  }

  setBot(stream) {
    this._detach(this.bot);
    this.bot = stream ? this._attach(stream) : null;
  }

  _rms(node) {
    if (!node) return 0;
    try {
      node.analyser.getFloatTimeDomainData(node.buf);
    } catch {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < node.buf.length; i++) {
      const s = finite(node.buf[i]);
      sum += s * s;
    }
    const rms = Math.sqrt(sum / node.buf.length);
    // Speech RMS is roughly 0.01..0.3; map it onto 0..1 with a soft curve.
    return clamp01(Math.pow(clamp01(rms * 4.5), 0.7));
  }

  micLevel() {
    return this._rms(this.mic);
  }

  botLevel() {
    return this._rms(this.bot);
  }
}
