/* Radha - Made for Each Other
 * WhatsApp-style voice chat room for a Sarvam Voice Agent.
 * Static, no server, open source. The API key never leaves the browser.
 *
 * Two modes:
 *   - Demo mode  : mic permission + live meter + local replies (works with no key).
 *   - Live mode  : real-time voice session with your agent via sarvam-conv-ai-sdk/browser.
 */
(() => {
  "use strict";

  const SDK_URL = "https://esm.sh/sarvam-conv-ai-sdk@0.0.42/browser";
  const STORE_KEY = "radha.voice.settings.v1";

  const DEFAULTS = {
    orgId: "019f48af-6eaf-7b13-ba20-679bc10903c4",
    workspaceId: "019f48af-6eb6-7642-be56-bc4e7bc080ed",
    appId: "",
    apiKey: "",
    userId: "radha-web-user",
    lang: "",
    inputSampleRate: 16000,
    outputSampleRate: 16000,
  };

  // ---------- element handles ----------
  const $ = (id) => document.getElementById(id);
  const chat = $("chat");
  const typingRow = $("typingRow");
  const input = $("input");
  const composer = $("composer");
  const sendBtn = $("sendBtn");
  const micBtn = $("micBtn");
  const micTopBtn = $("micTopBtn");
  const statusDot = $("statusDot");
  const statusText = $("statusText");
  const liveStrip = $("liveStrip");
  const liveLabel = $("liveLabel");
  const meterFill = $("meterFill");
  const drawer = $("drawer");
  const scrim = $("scrim");
  const cfgStatus = $("cfgStatus");

  // ---------- state ----------
  let cfg = loadSettings();
  let agent = null;            // live ConversationAgent
  let audioInterface = null;
  let live = false;            // a real session is active
  let demo = null;             // demo mic resources
  let busy = false;

  // ---------- settings ----------
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (_) {}
    return Object.assign({}, DEFAULTS, saved);
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (_) {}
  }
  function isConfigured() {
    return Boolean(cfg.apiKey && cfg.appId && cfg.orgId && cfg.workspaceId);
  }

  // ---------- chat helpers ----------
  function now() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function scrollDown() { chat.scrollTop = chat.scrollHeight; }

  function insert(node) {
    chat.insertBefore(node, typingRow);
    scrollDown();
  }

  function addMessage(role, text, opts = {}) {
    const row = document.createElement("div");
    row.className = "row " + (role === "user" ? "out" : "in");
    const bubble = document.createElement("div");
    bubble.className = "bubble" + (opts.sys ? " sys" : "");
    const body = document.createElement("span");
    body.textContent = text;
    bubble.appendChild(body);
    if (!opts.sys) {
      const meta = document.createElement("div");
      meta.className = "meta";
      const t = document.createElement("span");
      t.textContent = now();
      meta.appendChild(t);
      if (role === "user") {
        const tick = document.createElement("span");
        tick.className = "tick";
        tick.textContent = "\u2713\u2713";
        meta.appendChild(tick);
      }
      bubble.appendChild(meta);
    }
    row.appendChild(bubble);
    insert(row);
    return row;
  }

  function addSystem(text) { addMessage("radha", text, { sys: true }); }

  function addPhoto(caption) {
    const row = document.createElement("div");
    row.className = "row in";
    const bubble = document.createElement("div");
    bubble.className = "bubble photo-bubble";
    const img = document.createElement("img");
    img.src = "assets/radha.jpg";
    img.alt = "Radha";
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(img.src));
    bubble.appendChild(img);
    if (caption) {
      const cap = document.createElement("div");
      cap.textContent = caption;
      cap.style.padding = "6px 6px 0";
      bubble.appendChild(cap);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.style.padding = "4px 6px 2px";
    const t = document.createElement("span");
    t.textContent = now();
    meta.appendChild(t);
    bubble.appendChild(meta);
    row.appendChild(bubble);
    insert(row);
  }

  function showTyping(on) { typingRow.classList.toggle("show", Boolean(on)); scrollDown(); }

  function setStatus(text, online) {
    statusText.textContent = text;
    statusDot.classList.toggle("on", Boolean(online));
  }

  function setMeter(level) {
    const pct = Math.max(4, Math.min(100, Math.round(level * 100)));
    meterFill.style.width = pct + "%";
  }

  // ---------- lightbox ----------
  const lightbox = $("lightbox");
  const lightboxImg = $("lightboxImg");
  function openLightbox(src) { lightboxImg.src = src; lightbox.classList.add("show"); }
  $("lightboxClose").addEventListener("click", () => lightbox.classList.remove("show"));
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) lightbox.classList.remove("show"); });

  // ---------- demo replies ----------
  const DEMO_LINES = [
    "Radha is here \u2764 Add your agent ID and API key in Settings and I'll answer with my real voice.",
    "Namaste! This is demo mode \u2014 connect your Voice Agent to hear me speak. \uD83C\uDFB5",
    "I can hear your mic is ready. Pop in your API key and we'll talk for real.",
    "Made for each other \u2764 once you connect your agent, just tap the mic and speak to me.",
    "Try the mic button \u2014 in live mode I'll answer you out loud, in Hindi or English.",
  ];
  let demoIdx = 0;
  function demoTick(cb) {
    showTyping(true);
    const line = DEMO_LINES[demoIdx++ % DEMO_LINES.length];
    const delay = 500 + Math.min(1400, line.length * 22);
    setTimeout(() => { showTyping(false); cb(line); }, delay);
  }

  // ---------- demo mic (permission + meter) ----------
  async function startDemoMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      addSystem("This browser can't access the microphone. Try Chrome, Edge or Safari on https.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setMeter(Math.sqrt(sum / buf.length) * 3.2);
        raf = requestAnimationFrame(loop);
      };
      loop();
      demo = { stream, ctx, raf };
      liveStrip.classList.add("show");
      liveLabel.textContent = "Mic is live (demo)";
      micBtn.classList.add("live");
      setStatus("Mic on \u2014 demo mode", true);
      addSystem("Microphone is on. Demo mode: connect your agent in Settings for a real voice call.");
    } catch (err) {
      micBtn.classList.remove("live");
      addSystem("Microphone permission was blocked or unavailable (" + (err && err.name ? err.name : "error") + "). Allow the mic in your browser and try again.");
    }
  }

  function stopDemoMic() {
    if (!demo) return;
    cancelAnimationFrame(demo.raf);
    try { demo.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { demo.ctx.close(); } catch (_) {}
    demo = null;
    liveStrip.classList.remove("show");
    micBtn.classList.remove("live");
    setMeter(0.04);
    setStatus("Made for Each Other", false);
  }

  // ---------- live session ----------
  async function startLive() {
    if (busy) return;
    busy = true;
    micBtn.disabled = true;
    setStatus("Connecting\u2026", true);
    liveLabel.textContent = "Connecting to Radha\u2026";
    liveStrip.classList.add("show");
    micBtn.classList.add("live");

    try {
      const mod = await import(/* @vite-ignore */ SDK_URL);
      const { ConversationAgent, BrowserAudioInterface, InteractionType } = mod;

      audioInterface = new BrowserAudioInterface(cfg.inputSampleRate);

      const config = {
        org_id: cfg.orgId,
        workspace_id: cfg.workspaceId,
        app_id: cfg.appId,
        user_identifier: cfg.userId || "radha-web-user",
        user_identifier_type: "custom",
        interaction_type: InteractionType.CALL,
        input_sample_rate: cfg.inputSampleRate,
        output_sample_rate: cfg.outputSampleRate,
      };
      if (cfg.lang) config.initial_language_name = cfg.lang;

      agent = new ConversationAgent({
        apiKey: cfg.apiKey,
        config,
        audioInterface,
        transcriptCallback: async (msg) => {
          const role = String(msg && msg.role ? msg.role : "").toLowerCase();
          const text = (msg && msg.content ? msg.content : "").trim();
          if (!text) return;
          if (role.indexOf("user") !== -1) addMessage("user", text);
          else addMessage("radha", text);
        },
        audioLevelCallback: (lvl) => {
          const level = lvl && typeof lvl.rms === "number" ? Math.min(1, lvl.rms * 4) : 0.05;
          setMeter(level);
        },
        stateCallback: (state) => {
          const s = String(state || "").toUpperCase();
          if (s.indexOf("SPEAKING") !== -1) { liveLabel.textContent = "Radha is speaking\u2026"; setStatus("Speaking\u2026", true); }
          else if (s.indexOf("LISTENING") !== -1) { liveLabel.textContent = "Listening\u2026"; setStatus("Listening\u2026", true); }
          else if (s.indexOf("CONNECTED") !== -1) { liveLabel.textContent = "In call"; setStatus("In call", true); }
          else if (s.indexOf("ERROR") !== -1) { liveLabel.textContent = "Error"; setStatus("Connection error", false); }
        },
        endCallback: () => { if (live) { addSystem("Call ended."); stopLive(); } },
      });

      await agent.start();
      const ok = await agent.waitForConnect(10);
      if (!ok) throw new Error("timeout");

      live = true;
      liveLabel.textContent = "In call \u2014 speak to Radha";
      setStatus("In call", true);
      addSystem("You're connected to Radha. Speak naturally \u2014 she'll reply by voice.");
    } catch (err) {
      const name = err && err.name ? err.name : "";
      let hint = err && err.message ? err.message : String(err);
      if (name.indexOf("Auth") !== -1) hint = "Check your API key.";
      else if (String(hint).toLowerCase().indexOf("timeout") !== -1)
        hint = "Could not connect. Check the agent ID, that the agent has a committed version, and your network.";
      addSystem("Couldn't start the live call: " + hint);
      setStatus("Not connected", false);
      await stopLive(true);
    } finally {
      busy = false;
      micBtn.disabled = false;
    }
  }

  async function stopLive(keepStrip) {
    live = false;
    micBtn.classList.remove("live");
    setStatus("Made for Each Other", false);
    setMeter(0.04);
    if (!keepStrip) liveStrip.classList.remove("show");
    const a = agent, ai = audioInterface;
    agent = null; audioInterface = null;
    try { if (a) await a.stop(); } catch (_) {}
    try { if (ai && ai.stop) await ai.stop(); } catch (_) {}
  }

  // ---------- mic button behaviour ----------
  async function onMic() {
    if (live) { await stopLive(); return; }
    if (demo) { stopDemoMic(); return; }
    if (isConfigured()) await startLive();
    else await startDemoMic();
  }
  micBtn.addEventListener("click", onMic);
  micTopBtn.addEventListener("click", onMic);

  // ---------- text composer ----------
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage("user", text);
    input.value = "";
    input.style.height = "auto";
    if (live) return; // voice session: agent answers by voice
    demoTick((line) => addMessage("radha", line));
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); }
  });

  // ---------- settings drawer ----------
  function openDrawer() {
    $("cfgAppId").value = cfg.appId || "";
    $("cfgApiKey").value = cfg.apiKey || "";
    $("cfgOrg").value = cfg.orgId || "";
    $("cfgWorkspace").value = cfg.workspaceId || "";
    $("cfgUser").value = cfg.userId || "";
    $("cfgLang").value = cfg.lang || "";
    cfgStatus.textContent = isConfigured() ? "Configured \u2014 ready for a live call." : "Not configured \u2014 running in demo mode.";
    drawer.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    scrim.classList.add("show");
  }
  function closeDrawer() {
    drawer.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    scrim.classList.remove("show");
  }
  function readForm() {
    cfg.appId = $("cfgAppId").value.trim();
    cfg.apiKey = $("cfgApiKey").value.trim();
    cfg.orgId = $("cfgOrg").value.trim();
    cfg.workspaceId = $("cfgWorkspace").value.trim();
    cfg.userId = $("cfgUser").value.trim() || "radha-web-user";
    cfg.lang = $("cfgLang").value;
    saveSettings();
  }
  $("settingsBtn").addEventListener("click", openDrawer);
  $("closeDrawer").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  $("saveCfg").addEventListener("click", () => {
    readForm();
    cfgStatus.textContent = isConfigured() ? "Saved \u2014 ready for a live call." : "Saved \u2014 still in demo mode (need API key + agent ID).";
  });
  $("testCfg").addEventListener("click", async () => {
    readForm();
    closeDrawer();
    if (!isConfigured()) { addSystem("Add your API key and agent ID first."); return; }
    if (live) await stopLive();
    if (demo) stopDemoMic();
    await startLive();
  });
  $("clearCfg").addEventListener("click", () => {
    cfg = Object.assign({}, DEFAULTS);
    saveSettings();
    $("cfgAppId").value = ""; $("cfgApiKey").value = ""; $("cfgUser").value = DEFAULTS.userId;
    $("cfgOrg").value = DEFAULTS.orgId; $("cfgWorkspace").value = DEFAULTS.workspaceId; $("cfgLang").value = "";
    cfgStatus.textContent = "Cleared \u2014 back to demo mode.";
  });

  // ---------- boot ----------
  function boot() {
    $("today").textContent = new Date().toLocaleDateString([], { day: "numeric", month: "long" });
    addPhoto("Hi, I'm Radha \u2764");
    setTimeout(() => {
      showTyping(true);
      setTimeout(() => {
        showTyping(false);
        addMessage("radha", "Tap the mic and talk to me \u2014 or type below. \u2764");
        if (!isConfigured()) {
          setTimeout(() => addSystem("Tip: add your agent ID + API key in \u2699 Settings for a real voice call."), 700);
        }
      }, 900);
    }, 500);
    window.addEventListener("beforeunload", () => { if (live && agent) { try { agent.stop(); } catch (_) {} } });
  }

  boot();
})();
