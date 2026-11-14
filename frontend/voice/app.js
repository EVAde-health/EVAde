// EVAde browser voice mode. Mic -> AudioWorklet (24 kHz PCM16) -> WS /voice/browser
// -> server-side bridge -> xAI Grok voice. Agent audio (PCM16 24 kHz) plays back here.
(() => {
  const RATE = 24000;
  const params = new URLSearchParams(location.search);
  // Access key: from ?token= (then remembered and stripped from the URL), else remembered, else ask once.
  const KEY_STORE = "evade_access_key";
  let TOKEN = params.get("token") || "";
  if (TOKEN) {
    try { localStorage.setItem(KEY_STORE, TOKEN); } catch {}
    params.delete("token");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  } else {
    try { TOKEN = localStorage.getItem(KEY_STORE) || ""; } catch {}
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    if (!TOKEN && !local) {
      TOKEN = (window.prompt("Enter the EVAde access key") || "").trim();
      if (TOKEN) { try { localStorage.setItem(KEY_STORE, TOKEN); } catch {} }
    }
  }
  const CREW = params.get("crew") || "browser-demo";
  const qs = (extra = {}) => {
    const p = new URLSearchParams({ crew_id: CREW, ...extra });
    if (TOKEN) p.set("token", TOKEN);
    return p.toString();
  };

  const $ = (id) => document.getElementById(id);
  const talkBtn = $("talk"), statusEl = $("status"), statusText = $("status-text");
  const transcriptEl = $("transcript"), checkinEl = $("checkin"), downlinkEl = $("downlink");

  let ws = null, ctx = null, stream = null, micNode = null;
  let nextPlayTime = 0;
  let idleTimer = null;
  const playing = new Set();
  const bubbles = new Map(); // transcript id -> element

  // ------------------------------------------------------------- UI helpers
  function setStatus(state, text) {
    statusEl.className = state;
    statusText.textContent = text;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");

  function clearEmpty(el) { const e = el.querySelector(".empty"); if (e) e.remove(); }
  function scrollDown() { transcriptEl.scrollTop = transcriptEl.scrollHeight; }

  function bubble(role, id) {
    const key = `${role}:${id || Math.random()}`;
    let el = bubbles.get(key);
    if (!el) {
      clearEmpty(transcriptEl);
      el = document.createElement("div");
      el.className = `msg ${role}`;
      el.innerHTML = `<span class="who">${role === "agent" ? "EVAde" : "You"}</span><span class="t"></span>`;
      transcriptEl.appendChild(el);
      bubbles.set(key, el);
    }
    return el;
  }
  function sysNote(text) {
    clearEmpty(transcriptEl);
    const el = document.createElement("div");
    el.className = "msg sys";
    el.textContent = text;
    transcriptEl.appendChild(el);
    scrollDown();
  }

  function renderCheckin(c) {
    if (!c) { checkinEl.innerHTML = '<div class="empty">No check-in yet.</div>'; return; }
    const lvl = esc(c.level);
    const vitals = [];
    if (c.sleep_hours != null) vitals.push(`Sleep ${c.sleep_hours} h`);
    if (c.mood != null) vitals.push(`Mood ${c.mood}/5`);
    if (c.systolic != null) vitals.push(`BP ${c.systolic}/${c.diastolic}`);
    if (c.temperature_c != null) vitals.push(`Temp ${c.temperature_c} °C`);
    if (c.blood_sugar_mg_dl != null) vitals.push(`Sugar ${c.blood_sugar_mg_dl} mg/dL`);
    checkinEl.innerHTML = `
      <div class="result ${lvl}">
        <span class="badge ${lvl}">${lvl}</span>
        ${vitals.length ? `<div class="meta">${esc(vitals.join(" · "))}</div>` : ""}
        <h3>Why</h3><ul>${(c.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        <h3>What to do</h3><ul>${(c.actions || []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <div class="meta">${c.created_at ? "Saved " + esc(when(c.created_at)) : ""}${c.crew_id ? " · " + esc(c.crew_id) : ""}</div>
      </div>`;
  }

  function renderDownlink(list) {
    if (!list || !list.length) { downlinkEl.innerHTML = '<div class="empty">Nothing queued.</div>'; return; }
    const label = { online: "Online (ISS)", mars: "Mars 20-min delay", blackout: "Blackout" };
    downlinkEl.innerHTML = list.map((m) => `
      <div class="dl">
        <div class="tags"><span class="${m.priority === "urgent" ? "urgent" : ""}">${esc(m.priority)}</span>
          · ${esc(label[m.comms_mode] || m.comms_mode)} · ${esc(m.status)} · ${esc(when(m.created_at))}</div>
        <div>${esc(m.message)}</div>
      </div>`).join("");
  }

  async function refreshData() {
    try {
      const [c, d] = await Promise.all([
        fetch(`/voice/api/checkins/latest?${qs()}`).then((r) => r.json()),
        fetch(`/voice/api/downlink?${qs({ limit: 5 })}`).then((r) => r.json()),
      ]);
      renderCheckin(c.checkin);
      renderDownlink(d.messages);
    } catch (e) { /* page still works without the side panels */ }
  }

  // ---------------------------------------------------------------- audio
  function b64FromBuffer(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function playPcm16(b64) {
    const bin = atob(b64);
    const n = bin.length >> 1;
    const audio = ctx.createBuffer(1, n, RATE); // browser resamples 24 kHz to the device rate
    const ch = audio.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      ch[i] = v / 0x8000;
    }
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);
    const start = Math.max(nextPlayTime, ctx.currentTime + 0.05);
    src.start(start);
    nextPlayTime = start + audio.duration;
    playing.add(src);
    src.onended = () => playing.delete(src);
  }

  function stopPlayback() { // barge-in
    for (const src of playing) { try { src.stop(); } catch (e) {} }
    playing.clear();
    nextPlayTime = 0;
  }

  function ackMarkWhenPlayed(name) {
    const wait = Math.max(0, nextPlayTime - ctx.currentTime);
    setTimeout(() => send({ type: "mark", name }), wait * 1000);
  }

  // ---------------------------------------------------------------- socket
  function send(msg) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

  function onServer(msg) {
    switch (msg.type) {
      case "status":
        if (msg.state === "connecting") setStatus("connecting", "Connecting to Grok…");
        else if (msg.state === "ready") setStatus("ready", "Listening. Just talk.");
        else if (msg.state === "ended") setStatus("", "Call ended");
        break;
      case "audio": playPcm16(msg.audio); break;
      case "clear": stopPlayback(); break;
      case "mark": ackMarkWhenPlayed(msg.name); break;
      case "transcript_done": {
        // back to "listening" once the agent's audio has finished playing
        const wait = ctx ? Math.max(0, nextPlayTime - ctx.currentTime) : 0;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { if (ws) setStatus("ready", "Listening. Just talk."); }, wait * 1000);
        break;
      }
      case "speech_started": clearTimeout(idleTimer); setStatus("ready", "Hearing you…"); break;
      case "speech_stopped": setStatus("ready", "Thinking…"); break;
      case "transcript": {
        const el = bubble(msg.role, msg.id);
        const t = el.querySelector(".t");
        if (msg.role === "agent") t.textContent += msg.delta || "";
        else { t.textContent = msg.text || ""; el.classList.toggle("partial", !msg.final); }
        if (msg.role === "agent") { clearTimeout(idleTimer); setStatus("ready", "EVAde is speaking…"); }
        scrollDown();
        break;
      }
      case "tool_result":
        if (msg.name === "save_checkin" && msg.result && msg.result.level) {
          renderCheckin(msg.result);
          sysNote(`Check-in saved: ${msg.result.level.toUpperCase()}`);
        } else if (msg.name === "queue_flight_surgeon_message") {
          sysNote(`Flight surgeon: ${msg.result.summary || msg.result.status}`);
        }
        refreshData();
        break;
      case "error":
        setStatus("error", msg.message || "Error");
        sysNote(`⚠️ ${msg.message || "Error"}`);
        break;
    }
  }

  async function start() {
    talkBtn.disabled = true;
    try {
      setStatus("connecting", "Asking for the microphone…");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule("/voice/mic-worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      micNode = new AudioWorkletNode(ctx, "mic-downsampler");
      const mute = ctx.createGain();
      mute.gain.value = 0; // keep the worklet pulled without hearing yourself
      source.connect(micNode).connect(mute).connect(ctx.destination);
      micNode.port.onmessage = (e) => {
        talkBtn.style.setProperty("--lvl", Math.min(1, e.data.level * 4).toFixed(2));
        send({ type: "audio", audio: b64FromBuffer(e.data.pcm) });
      };

      const proto = location.protocol === "https:" ? "wss" : "ws";
      const wsQs = new URLSearchParams({ crew: CREW });
      if (TOKEN) wsQs.set("token", TOKEN);
      ws = new WebSocket(`${proto}://${location.host}/voice/browser?${wsQs}`);
      ws.onmessage = (e) => onServer(JSON.parse(e.data));
      ws.onclose = () => { if (ctx) stop(false); };
      ws.onerror = () => setStatus("error", "Connection error");
      setStatus("connecting", "Connecting…");
      talkBtn.classList.add("live");
      talkBtn.textContent = "End check-in";
      talkBtn.setAttribute("aria-pressed", "true");
      sysNote("Check-in started");
    } catch (err) {
      setStatus("error", err && err.name === "NotAllowedError" ? "Microphone blocked. Allow it in the address bar." : `Could not start: ${err.message || err}`);
      stop(false);
    } finally {
      talkBtn.disabled = false;
    }
  }

  function stop(sendStop = true) {
    if (sendStop) send({ type: "stop" });
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    stopPlayback();
    if (micNode) { micNode.port.onmessage = null; micNode = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (ctx) { ctx.close(); ctx = null; }
    talkBtn.classList.remove("live");
    talkBtn.style.removeProperty("--lvl");
    talkBtn.textContent = "Talk to EVAde";
    talkBtn.setAttribute("aria-pressed", "false");
    if (!statusEl.classList.contains("error")) setStatus("", "Idle");
    refreshData();
  }

  talkBtn.addEventListener("click", () => (ws ? stop(true) : start()));
  if (!window.isSecureContext) setStatus("error", "Open this page on http://localhost:8000 (mic needs localhost or HTTPS)");
  refreshData();
})();
