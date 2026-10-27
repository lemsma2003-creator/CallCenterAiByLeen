import { STRINGS } from "./i18n.js";
import { VoiceClient } from "./webrtc.js";
import { LevelMeter } from "./levels.js";
import { Orb } from "./orb.js";
import { Transcript } from "./transcript.js";

const $ = (id) => document.getElementById(id);
const els = {
  html: document.documentElement,
  langBtn: $("langBtn"),
  themeBtn: $("themeBtn"),
  status: $("status"),
  muteBtn: $("muteBtn"),
  callBtn: $("callBtn"),
  callLabel: $("callLabel"),
  settingsBtn: $("settingsBtn"),
  menu: $("settingsMenu"),
  micSelect: $("micSelect"),
  micHint: $("micHint"),
  alert: $("alert"),
  transcript: $("transcript"),
  empty: $("transcriptEmpty"),
  audio: $("botAudio"),
  canvas: $("orb"),
};

// ---------- persisted preferences (localStorage can throw: private mode, blocked storage) ----------
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const state = {
  lang: store.get("va-lang") === "en" ? "en" : "ar",
  theme: null, // "dark" | "light"
  call: "idle", // idle | connecting | connected
  botSpeaking: false,
  muted: false,
  micId: "",
  sawUserTranscription: false,
  ended: false,
};

const t = (key) => STRINGS[state.lang][key] ?? key;

// ---------- theme ----------
function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function applyTheme(theme, save) {
  state.theme = theme;
  els.html.dataset.theme = theme;
  if (save) store.set("va-theme", theme);
  const label = theme === "dark" ? t("themeToLight") : t("themeToDark");
  els.themeBtn.setAttribute("aria-label", label);
  els.themeBtn.title = label;
  orb && orb.readColors();
}

// ---------- language ----------
function applyLang(lang, save) {
  state.lang = lang;
  els.html.lang = lang;
  els.html.dir = lang === "ar" ? "rtl" : "ltr";
  if (save) store.set("va-lang", lang);
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
  els.langBtn.textContent = t("langSwitch");
  els.langBtn.setAttribute("aria-label", t("langSwitchLabel"));
  els.langBtn.lang = lang === "ar" ? "en" : "ar";
  els.settingsBtn.setAttribute("aria-label", t("settings"));
  els.settingsBtn.title = t("settings");
  applyTheme(state.theme, false);
  transcript.relabel();
  if (lastError) showError(lastError);
  fillMics();
  render();
}

// ---------- UI rendering ----------
function currentMode() {
  if (state.call === "connecting") return "connecting";
  if (state.call !== "connected") return "idle";
  if (state.botSpeaking) return "speaking";
  if (state.muted) return "muted";
  return "listening";
}

function render() {
  const mode = currentMode();
  orb && orb.setMode(mode);
  els.html.dataset.mode = mode;

  const statusKey = {
    idle: state.ended ? "statusEnded" : "statusIdle",
    connecting: "statusConnecting",
    listening: "statusListening",
    speaking: "statusSpeaking",
    muted: "statusMuted",
  }[mode];
  els.status.textContent = t(statusKey);

  const callState = state.call;
  els.callBtn.dataset.state = callState;
  els.callLabel.textContent = t(callState === "idle" ? "start" : callState === "connecting" ? "connecting" : "end");
  els.callBtn.disabled = callState === "connecting";
  els.callBtn.setAttribute("aria-busy", String(callState === "connecting"));

  els.muteBtn.disabled = callState !== "connected";
  els.muteBtn.setAttribute("aria-pressed", String(state.muted));
  els.muteBtn.dataset.muted = String(state.muted);
  const muteLabel = state.muted ? t("unmute") : t("mute");
  els.muteBtn.setAttribute("aria-label", muteLabel);
  els.muteBtn.title = muteLabel;
}

let lastError = null;
function showError(code) {
  lastError = code;
  const key = {
    "mic-denied": "errMicDenied",
    "mic-missing": "errMicMissing",
    "server-down": "errServerDown",
    "ice-failed": "errIce",
  }[code] || "errGeneric";
  els.alert.textContent = t(key);
  els.alert.hidden = false;
}
function clearError() {
  lastError = null;
  els.alert.hidden = true;
  els.alert.textContent = "";
}

// ---------- microphones ----------
async function fillMics() {
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  } catch {}
  const sel = els.micSelect;
  sel.textContent = "";
  const def = new Option(t("defaultMic"), "");
  sel.append(def);
  let named = false;
  let n = 0;
  for (const d of devices) {
    if (!d.deviceId || d.deviceId === "default" || d.deviceId === "communications") continue;
    n++;
    if (d.label) named = true;
    sel.append(new Option(d.label || `${t("micNumbered")} ${n}`, d.deviceId));
  }
  sel.value = [...sel.options].some((o) => o.value === state.micId) ? state.micId : "";
  els.micHint.hidden = named;
}

function openMenu(open) {
  els.menu.hidden = !open;
  els.settingsBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    fillMics();
    els.micSelect.focus();
  }
}

// ---------- call ----------
const meter = new LevelMeter();
const transcript = new Transcript(els.transcript, els.empty, () => ({ you: t("you"), bot: t("bot") }));
let orb = null;
let client = null;

async function startCall() {
  clearError();
  meter.unlock();
  state.call = "connecting";
  state.ended = false;
  state.botSpeaking = false;
  state.sawUserTranscription = false;
  transcript.clear();
  render();

  client = new VoiceClient({ audioEl: els.audio });
  client.muted = state.muted;
  client.addEventListener("connected", () => {
    meter.setMic(client.micStream);
    fillMics();
  });
  client.addEventListener("bot-audio", (e) => meter.setBot(e.detail));
  client.addEventListener("mic-changed", (e) => meter.setMic(e.detail));
  client.addEventListener("rtvi", (e) => onRTVI(e.detail));
  client.addEventListener("error", (e) => showError(e.detail.code));
  client.addEventListener("disconnected", (e) => {
    meter.setMic(null);
    meter.setBot(null);
    state.call = "idle";
    state.botSpeaking = false;
    state.muted = false; // every new call starts unmuted
    state.ended = !!(e.detail && e.detail.wasConnected);
    transcript.botTurnEnded();
    render();
  });

  try {
    await client.connect({ micDeviceId: state.micId || undefined });
  } catch (err) {
    state.call = "idle";
    showError(err.code || "generic");
    render();
    client = null;
    return;
  }
  if (client && state.call === "connecting") {
    // Audio path is up; the UI says "listening" once the bot reports ready (or the link connects).
    client.addEventListener("connected", () => markConnected(), { once: true });
    if (client.connected) markConnected();
  }
}

function markConnected() {
  if (state.call !== "connecting") return;
  state.call = "connected";
  render();
}

function endCall() {
  if (client) client.disconnect();
  client = null;
}

function onRTVI(msg) {
  const d = msg.data || {};
  switch (msg.type) {
    case "bot-ready":
      markConnected();
      break;
    case "bot-started-speaking":
      state.botSpeaking = true;
      markConnected();
      render();
      break;
    case "bot-stopped-speaking":
      state.botSpeaking = false;
      transcript.botTurnEnded();
      render();
      break;
    case "user-started-speaking":
      // Reserve the user's bubble now; the transcript may arrive after the bot starts replying.
      transcript.userTurnStarted();
      break;
    case "user-transcription":
      state.sawUserTranscription = true;
      transcript.userText(d.text, !!d.final);
      break;
    case "user-input":
      // Newer servers send both; only use user-input when user-transcription isn't coming.
      if (d.input_type === "backchannel") break;
      if (d.input_type === "transcription" && state.sawUserTranscription) break;
      transcript.userText(d.text, d.final !== false);
      break;
    case "bot-output": {
      const p = d.spoken_progress || {};
      transcript.botSegment(d.segment_id, {
        text: d.text,
        accumulated: p.accumulated_text,
        remaining: p.remaining_text,
        spokenStatus: d.spoken_status || (d.spoken ? "completed" : "new"),
        willBeSpoken: d.will_be_spoken,
      });
      break;
    }
    case "error":
      if (d.fatal) showError("generic");
      break;
  }
}

// ---------- events ----------
els.callBtn.addEventListener("click", () => {
  if (state.call === "idle") startCall();
  else if (state.call === "connected") endCall();
});

els.muteBtn.addEventListener("click", () => {
  state.muted = !state.muted;
  client && client.setMuted(state.muted);
  render();
});

els.langBtn.addEventListener("click", () => applyLang(state.lang === "ar" ? "en" : "ar", true));
els.themeBtn.addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark", true));

els.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openMenu(els.menu.hidden);
});
document.addEventListener("click", (e) => {
  if (!els.menu.hidden && !els.menu.contains(e.target) && e.target !== els.settingsBtn) openMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.menu.hidden) {
    openMenu(false);
    els.settingsBtn.focus();
  }
});
els.micSelect.addEventListener("change", async () => {
  state.micId = els.micSelect.value;
  if (client && state.call === "connected") {
    try {
      await client.switchMic(state.micId || undefined);
      clearError();
    } catch (err) {
      showError(err.code || "generic");
    }
  }
});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", fillMics);
}

// Hang up when the page goes away (tab closed, reload, navigation, mobile background).
window.addEventListener("pagehide", () => endCall());

// ---------- boot ----------
const savedTheme = store.get("va-theme");
state.theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : systemTheme();
orb = new Orb(els.canvas, { getLevels: () => ({ mic: state.muted ? 0 : meter.micLevel(), bot: meter.botLevel() }) });
applyTheme(state.theme, false);
applyLang(state.lang, false);
