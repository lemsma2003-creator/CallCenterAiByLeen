// Minimal Pipecat SmallWebRTC + RTVI client (no dependencies).
// Protocol taken from pipecat/runner/run.py, transports/smallwebrtc and processors/frameworks/rtvi.
//
// Flow: POST /start -> sessionId + iceConfig
//       POST /sessions/{id}/api/offer {sdp, type, pc_id} -> answer
//       data channel: "ping" keep-alive every second, RTVI JSON messages both ways.

const RTVI_VERSION = "2.2.0";
const RTVI_LABEL = "rtvi-ai";

export class VoiceError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code; // mic-denied | mic-missing | server-down | ice-failed | generic
    this.cause = cause;
  }
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export class VoiceClient extends EventTarget {
  constructor({ audioEl, baseUrl = "" }) {
    super();
    this.audioEl = audioEl;
    this.baseUrl = baseUrl;
    this.pc = null;
    this.dc = null;
    this.micStream = null;
    this.remoteStream = null;
    this.sessionId = null;
    this.pcId = null;
    this.muted = false;
    this.connected = false;
    this._pingTimer = null;
    this._closing = false;
    this._lateCandidates = [];
    this._answered = false;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _url(path) {
    return `${this.baseUrl}${path}`;
  }

  static async getMic(deviceId) {
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      const name = err && err.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new VoiceError("mic-denied", err);
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new VoiceError("mic-missing", err);
      throw new VoiceError("generic", err);
    }
  }

  async connect({ micDeviceId } = {}) {
    this._closing = false;
    this.micStream = await VoiceClient.getMic(micDeviceId);

    let start;
    try {
      const res = await fetch(this._url("/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transport: "webrtc", enableDefaultIceServers: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      start = await res.json();
    } catch (err) {
      this._stopMic();
      throw new VoiceError("server-down", err);
    }

    this.sessionId = start.sessionId;
    const iceServers = (start.iceConfig && start.iceConfig.iceServers) || [];
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    // Transceiver order matters: the bot reads audio at index 0, camera at 1, screen at 2.
    const micTrack = this.micStream.getAudioTracks()[0];
    pc.addTransceiver(micTrack, { direction: "sendrecv", streams: [this.micStream] });
    pc.addTransceiver("video", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });

    pc.ontrack = (ev) => {
      if (ev.track.kind !== "audio") return;
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      this.remoteStream = stream;
      this.audioEl.srcObject = stream;
      this.audioEl.play().catch(() => {});
      this._emit("bot-audio", stream);
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !this._answered) return;
      this._lateCandidates.push(ev.candidate);
      clearTimeout(this._patchTimer);
      this._patchTimer = setTimeout(() => this._sendLateCandidates(), 150);
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        this.connected = true;
        this._emit("connected");
      } else if (s === "failed") {
        this._fail(new VoiceError(this.connected ? "generic" : "ice-failed"));
      } else if (s === "closed" || (s === "disconnected" && this.connected)) {
        // "disconnected" can recover; give it a moment before giving up.
        if (s === "disconnected") {
          setTimeout(() => {
            if (this.pc === pc && pc.connectionState === "disconnected") this._fail(new VoiceError("generic"));
          }, 4000);
        } else if (!this._closing) {
          this._fail(new VoiceError("generic"));
        }
      }
    };

    const dc = pc.createDataChannel("rtvi", { ordered: true });
    this.dc = dc;
    dc.onopen = () => {
      this._pingTimer = setInterval(() => this._sendRaw(`ping: ${Date.now()}`), 1000);
      this.sendRTVI("client-ready", {
        version: RTVI_VERSION,
        about: { library: "voice-agent-ui", library_version: "1.0.0", platform: "browser", platform_version: navigator.userAgent },
      });
      if (this.muted) this._sendTrackStatus(false);
    };
    dc.onmessage = (ev) => this._onMessage(ev.data);

    try {
      await this._negotiate(false);
    } catch (err) {
      this.disconnect();
      throw err instanceof VoiceError ? err : new VoiceError("server-down", err);
    }
  }

  async _negotiate(isRenegotiation) {
    const pc = this.pc;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, 2500);
    this._answered = false;

    const res = await fetch(this._url(`/sessions/${encodeURIComponent(this.sessionId)}/api/offer`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type,
        pc_id: this.pcId,
        restart_pc: false,
        requestData: {},
      }),
    });
    if (!res.ok) throw new VoiceError(isRenegotiation ? "generic" : "server-down", new Error(`HTTP ${res.status}`));
    const answer = await res.json();
    this.pcId = answer.pc_id || this.pcId;
    await pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
    this._answered = true;
  }

  async _sendLateCandidates() {
    if (!this.pcId || !this._lateCandidates.length) return;
    const candidates = this._lateCandidates.splice(0).map((c) => ({
      candidate: c.candidate,
      sdp_mid: c.sdpMid,
      sdp_mline_index: c.sdpMLineIndex,
    }));
    try {
      await fetch(this._url(`/sessions/${encodeURIComponent(this.sessionId)}/api/offer`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pc_id: this.pcId, candidates }),
      });
    } catch {
      /* best effort */
    }
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "signalling" && msg.message) {
      const t = msg.message.type;
      if (t === "renegotiate") this._negotiate(true).catch((e) => this._fail(e));
      else if (t === "peerLeft") this._fail(new VoiceError("generic"));
      return;
    }
    if (msg.label === RTVI_LABEL) this._emit("rtvi", msg);
  }

  _sendRaw(text) {
    if (this.dc && this.dc.readyState === "open") {
      try {
        this.dc.send(text);
      } catch {
        /* channel closing */
      }
    }
  }

  sendRTVI(type, data) {
    this._sendRaw(JSON.stringify({ label: RTVI_LABEL, type, id: newId(), data }));
  }

  _sendTrackStatus(enabled) {
    this._sendRaw(JSON.stringify({ type: "signalling", message: { type: "trackStatus", receiver_index: 0, enabled } }));
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.micStream) this.micStream.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    this._sendTrackStatus(!this.muted);
  }

  async switchMic(deviceId) {
    if (!this.pc) return;
    const stream = await VoiceClient.getMic(deviceId);
    const track = stream.getAudioTracks()[0];
    track.enabled = !this.muted;
    const sender = this.pc.getTransceivers()[0].sender;
    await sender.replaceTrack(track);
    this._stopMic();
    this.micStream = stream;
    this._emit("mic-changed", stream);
  }

  _stopMic() {
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  _fail(err) {
    if (this._closing) return;
    this.disconnect();
    this._emit("error", err);
  }

  disconnect() {
    if (this._closing && !this.pc) return;
    this._closing = true;
    this.sendRTVI("disconnect-bot", {});
    clearInterval(this._pingTimer);
    clearTimeout(this._patchTimer);
    this._pingTimer = null;
    try {
      this.dc && this.dc.close();
    } catch {}
    try {
      this.pc && this.pc.close();
    } catch {}
    this.dc = null;
    this.pc = null;
    this.pcId = null;
    this.sessionId = null;
    this._stopMic();
    this.remoteStream = null;
    if (this.audioEl) this.audioEl.srcObject = null;
    const was = this.connected;
    this.connected = false;
    this._emit("disconnected", { wasConnected: was });
  }
}

function waitForIceGathering(pc, timeoutMs) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}
