// Live transcript. Bot text arrives more than once per segment_id (first queued, then
// spoken/completed), so each segment owns ONE <span> that gets updated in place.
// Text that hasn't been spoken yet is rendered dimmed.

export class Transcript {
  constructor(root, emptyEl, labels) {
    this.root = root;
    this.emptyEl = emptyEl;
    this.labels = labels; // () => ({ you, bot })
    this.segments = new Map(); // segment_id -> { spoken, pending }
    this.botBody = null; // body of the current bot bubble
    this.userPending = null; // body of a user bubble still receiving interim text
  }

  clear() {
    this.root.querySelectorAll(".msg").forEach((n) => n.remove());
    this.segments.clear();
    this.botBody = null;
    this.userPending = null;
    this.emptyEl.hidden = false;
  }

  relabel() {
    const { you, bot } = this.labels();
    this.root.querySelectorAll(".msg").forEach((m) => {
      m.querySelector(".msg-role").textContent = m.dataset.role === "user" ? you : bot;
    });
  }

  _bubble(role) {
    this.emptyEl.hidden = true;
    const el = document.createElement("article");
    el.className = `msg msg-${role}`;
    el.dataset.role = role;
    const who = document.createElement("p");
    who.className = "msg-role";
    const { you, bot } = this.labels();
    who.textContent = role === "user" ? you : bot;
    const body = document.createElement("p");
    body.className = "msg-body";
    body.dir = "auto";
    el.append(who, body);
    this.root.append(el);
    this._scroll();
    return body;
  }

  _scroll() {
    // Follow new text unless the user scrolled up to read something older.
    const r = this.root;
    const nearBottom = r.scrollHeight - r.scrollTop - r.clientHeight < 160;
    if (nearBottom) r.scrollTop = r.scrollHeight;
  }

  // The user started talking. Reserve a (hidden) bubble at this point in the conversation:
  // speech-to-speech models (OpenAI Realtime) send the user's transcript late, often after
  // the bot has already started answering, and it must still land BEFORE that answer.
  userTurnStarted() {
    if (this.userPending && !this.userPending.final && !this.userPending.interim) {
      this.userPending.el.remove(); // previous turn never produced text (noise): drop it
    }
    this.userPending = this._userBubble();
    this.botBody = null; // the bot's next words start a new bubble after this one
  }

  _userBubble() {
    const body = this._bubble("user");
    const el = body.parentElement;
    el.classList.add("is-empty");
    const finalSpan = document.createElement("span");
    const interimSpan = document.createElement("span");
    interimSpan.className = "user-interim";
    body.append(finalSpan, interimSpan);
    return { el, body, finalSpan, interimSpan, final: "", interim: "" };
  }

  // Interim text may be cumulative ("شو سا" -> "شو ساعات") or deltas ("يا" + "مرحبا" pieces);
  // final text replaces the interim for that utterance. All of it goes into ONE bubble per turn.
  userText(text, final) {
    if (!text || !text.trim()) return;
    // A finished user message the bot already answered is closed: new words start a new bubble.
    if (this.userPending && this.userPending.final && this.userPending.answered) this.userPending = null;
    if (!this.userPending) {
      this.userPending = this._userBubble();
      this.botBody = null;
    }
    const u = this.userPending;
    if (final) {
      const t = text.trim();
      u.final = u.final ? `${u.final} ${t}` : t;
      u.interim = "";
    } else if (!u.interim || text.startsWith(u.interim) || text.trim().startsWith(u.interim.trim())) {
      u.interim = text;
    } else {
      u.interim += text;
    }
    u.finalSpan.textContent = u.final;
    u.interimSpan.textContent = u.interim.trim() ? (u.final ? " " : "") + u.interim.trimStart() : "";
    u.el.classList.toggle("is-empty", !u.final && !u.interim.trim());
    this._scroll();
  }

  // accumulated: already spoken; remaining: queued but not yet spoken.
  botSegment(segmentId, { text, accumulated, remaining, spokenStatus, willBeSpoken }) {
    const key = segmentId ?? `anon-${this.segments.size}`;
    let seg = this.segments.get(key);
    if (!seg) {
      if (!this.botBody) {
        this.botBody = this._bubble("bot");
        if (this.userPending) this.userPending.answered = true;
      }
      const wrap = document.createElement("span");
      wrap.className = "seg";
      const spoken = document.createElement("span");
      spoken.className = "seg-spoken";
      const pending = document.createElement("span");
      pending.className = "seg-pending";
      wrap.append(spoken, pending);
      // Segments can be whole sentences (cascade STT/LLM/TTS) or raw text deltas that
      // already carry their own spaces (speech-to-speech models such as OpenAI Realtime).
      // Only add a space after finished sentences, never inside a word.
      const prevText = this.botBody.textContent;
      const nextText = text || `${accumulated || ""}${remaining || ""}`;
      if (prevText && !/\s$/.test(prevText) && !/^\s/.test(nextText) && /[.!?؟…:؛،,]$/.test(prevText)) {
        this.botBody.append(document.createTextNode(" "));
      }
      this.botBody.append(wrap);
      seg = { spoken, pending };
      this.segments.set(key, seg);
    }

    let done;
    let left;
    if (willBeSpoken === false) {
      done = text || "";
      left = "";
    } else if (spokenStatus === "completed") {
      done = accumulated || text || "";
      left = "";
    } else if (accumulated != null || remaining != null) {
      done = accumulated || "";
      left = remaining || "";
    } else {
      done = "";
      left = text || "";
    }
    seg.spoken.textContent = done;
    const gap = done && left && !/\s$/.test(done) && !/^\s/.test(left) ? " " : "";
    seg.pending.textContent = gap + left;
    this._scroll();
  }

  // A new bot bubble starts only after the user speaks; anything still dim was cut off.
  botTurnEnded() {}
}
