/* Radha - Made for Each Other
 * Voice chat room that runs ENTIRELY in the browser. No server, no API key, no credits.
 *
 * Two interchangeable voice-input engines:
 *   browser : the browser's own SpeechRecognition (fast; Chrome / Edge)
 *   local   : Whisper running on-device via transformers.js (works in plain Chromium)
 *
 * Replies are produced by a local rule engine (+ Chrome's built-in AI if already present)
 * and spoken with the browser's speechSynthesis voices.
 */
(() => {
  "use strict";

  const STORE_KEY = "radha.voice.settings.v3";
  const DEFAULTS = { lang: "en-IN", voiceOn: true, auto: true, engine: "auto", browserDead: false };

  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), typingRow = $("typingRow"), input = $("input"), composer = $("composer");
  const micBtn = $("micBtn"), micTopBtn = $("micTopBtn"), statusDot = $("statusDot"), statusText = $("statusText");
  const liveStrip = $("liveStrip"), liveLabel = $("liveLabel"), meterFill = $("meterFill");
  const drawer = $("drawer"), scrim = $("scrim"), cfgStatus = $("cfgStatus");

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CAN_BROWSER_SR = Boolean(SR);
  const CAN_SPEAK = "speechSynthesis" in window;
  const CAN_RECORD = typeof MediaRecorder !== "undefined";

  let cfg = loadSettings();

  // ---- engine state ----
  let activeEngine = null;      // null | 'browser' | 'local'
  let speechStarted = false;
  let watchdog = 0;
  let recog = null;
  let recording = false;
  let mediaRecorder = null;
  let recChunks = [];
  let micStream = null;
  let audioCtx = null, analyser = null, rafId = 0;
  let localAsr = null, localLoading = null;
  let responding = false;
  let speaking = false;
  let builtInSession = null;

  // ---------------- settings ----------------
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (_) {}
    return Object.assign({}, DEFAULTS, s);
  }
  function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (_) {} }
  const isHindi = () => cfg.lang.indexOf("hi") === 0;

  // ---------------- chat UI ----------------
  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const scrollDown = () => { chat.scrollTop = chat.scrollHeight; };
  function insert(node) { chat.insertBefore(node, typingRow); scrollDown(); }

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
        tick.className = "tick"; tick.textContent = "\u2713\u2713";
        meta.appendChild(tick);
      }
      bubble.appendChild(meta);
    }
    row.appendChild(bubble);
    insert(row);
  }
  const addSystem = (t) => addMessage("radha", t, { sys: true });

  function addPhoto(caption) {
    const row = document.createElement("div");
    row.className = "row in";
    const bubble = document.createElement("div");
    bubble.className = "bubble photo-bubble";
    const img = document.createElement("img");
    img.src = "assets/radha.jpg"; img.alt = "Radha"; img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(img.src));
    bubble.appendChild(img);
    if (caption) {
      const cap = document.createElement("div");
      cap.textContent = caption; cap.style.padding = "6px 6px 0";
      bubble.appendChild(cap);
    }
    const meta = document.createElement("div");
    meta.className = "meta"; meta.style.padding = "4px 6px 2px";
    const t = document.createElement("span"); t.textContent = now();
    meta.appendChild(t); bubble.appendChild(meta);
    row.appendChild(bubble); insert(row);
  }

  const showTyping = (on) => { typingRow.classList.toggle("show", Boolean(on)); scrollDown(); };
  function setStatus(text, online) { statusText.textContent = text; statusDot.classList.toggle("on", Boolean(online)); }
  function setMeter(level) { meterFill.style.width = Math.max(4, Math.min(100, Math.round(level * 100))) + "%"; }
  function setMicUI(on) {
    micBtn.classList.toggle("live", on);
    liveStrip.classList.toggle("show", on);
  }

  // ---------------- lightbox ----------------
  const lightbox = $("lightbox"), lightboxImg = $("lightboxImg");
  function openLightbox(src) { lightboxImg.src = src; lightbox.classList.add("show"); }
  $("lightboxClose").addEventListener("click", () => lightbox.classList.remove("show"));
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) lightbox.classList.remove("show"); });

  // ---------------- local brain ----------------
  const HI = {
    greet: ["नमस्ते! मैं राधा हूँ। आप कैसे हैं?", "नमस्ते जी! आपको देखकर अच्छा लगा।", "हैलो! बताइए, क्या हाल है?"],
    name: ["मैं राधा हूँ — सिर्फ़ आपके लिए।", "मेरा नाम राधा है। ❤"],
    how: ["मैं बहुत अच्छी हूँ, पूछने के लिए धन्यवाद! आप सुनाइए, आप कैसे हैं?", "मैं ठीक हूँ। आपका दिन कैसा जा रहा है?"],
    love: ["अरे! मैं तो आपके लिए ही बनी हूँ। ❤", "आपकी बातें सुनकर मन खुश हो जाता है। ❤"],
    bye: ["अच्छा, फिर मिलते हैं। अपना ध्यान रखिए। ❤", "ठीक है, अलविदा! जल्दी लौटिए।"],
    thanks: ["आपका स्वागत है। ❤", "कोई बात नहीं, यही तो मेरा काम है।"],
    what: ["मैं आपसे बात कर सकती हूँ, आपकी आवाज़ सुन सकती हूँ और जवाब दे सकती हूँ — बिल्कुल मुफ़्त, आपके ब्राउज़र में।"],
    joke: ["छोटी सी बात — मेरा दिल आपके पास है, और मेरा दिमाग़ भी! मज़ाक कर रही हूँ।"],
    fallback: ["हम्म, यह तो दिलचस्प है। थोड़ा और बताइए।", "अच्छा! आपके बारे में और सुनना अच्छा लगेगा।", "समझ गई। आप क्या सोच रहे हैं?", "हाँ जी, बताइए ना।", "मुझे आपसे बात करना अच्छा लगता है। ❤"],
  };
  const EN = {
    greet: ["Hi! I'm Radha. How are you?", "Hello there! Lovely to hear you.", "Hey! How's your day going?"],
    name: ["I'm Radha - just for you.", "My name is Radha. ❤"],
    how: ["I'm doing great, thanks for asking! How about you?", "I'm good. How's your day?"],
    love: ["Aw! I'm made for you, after all. ❤", "That made me smile. ❤"],
    bye: ["Okay, talk soon. Take care! ❤", "Bye for now - come back soon."],
    thanks: ["You're welcome. ❤", "Anytime - that's what I'm here for."],
    what: ["I can talk with you, listen to your voice and reply - all free, right inside your browser."],
    joke: ["Small thought: my heart is with you... and so is my brain. Just kidding."],
    fallback: ["Hmm, that's interesting. Tell me more.", "Oh nice! I'd love to hear more about that.", "Got it. What are you thinking?", "Go on, I'm listening.", "I really enjoy talking with you. ❤"],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const L = () => (isHindi() ? HI : EN);

  function ruleReply(text) {
    const t = " " + text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ") + " ";
    const has = (...ws) => ws.some((w) => t.indexOf(w) !== -1);
    const d = L();
    if (has(" namaste ", " namaskar ", " hello ", " hi ", " hey ", " सलाम ", " हाय ") || /^(hi|hello|hey)\b/.test(t.trim())) return pick(d.greet);
    if (has(" your name ", " who are you ", " tumhara naam ", " aapka naam ", " तुम्हारा नाम ", " आपका नाम ", " कौन हो ")) return pick(d.name);
    if (has(" how are you ", " kaise ho ", " kaisi ho ", " कैसे हो ", " कैसी हो ", " क्या हाल ")) return pick(d.how);
    if (has(" love you ", " i love ", " pyar ", " pyaar ", " मोहब्बत ", " प्यार ", " इश्क़ ")) return pick(d.love);
    if (has(" bye ", " goodbye ", " alvida ", " अलविदा ", " फिर मिलते ")) return pick(d.bye);
    if (has(" thank ", " thanks ", " shukriya ", " dhanyavad ", " धन्यवाद ", " शुक्रिया ")) return pick(d.thanks);
    if (has(" what can you do ", " kya kar sakti ", " क्या कर सकती ", " tum kya ho ", " तुम क्या हो ")) return pick(d.what);
    if (has(" joke ", " hasao ", " चुटकुला ", " मज़ाक ", " mazak ")) return pick(d.joke);
    if (has(" time ", " samay ", " kitne baje ", " समय ", " कितने बजे ")) {
      const s = new Date().toLocaleTimeString(isHindi() ? "hi-IN" : "en-IN", { hour: "2-digit", minute: "2-digit" });
      return isHindi() ? "अभी " + s + " बजे हैं।" : "It's " + s + " right now.";
    }
    if (has(" date ", " tarikh ", " aaj kaunsi ", " तारीख़ ", " आज कौन सी ")) {
      const s = new Date().toLocaleDateString(isHindi() ? "hi-IN" : "en-IN", { day: "numeric", month: "long", weekday: "long" });
      return isHindi() ? "आज " + s + " है।" : "Today is " + s + ".";
    }
    return pick(d.fallback);
  }

  async function builtInReply(text) {
    try {
      const LM = window.LanguageModel || (window.ai && window.ai.languageModel);
      if (!LM) return null;
      if (LM.availability) {
        const a = await LM.availability();
        if (a !== "available" && a !== "readily") return null;
      }
      if (!builtInSession) {
        builtInSession = await LM.create({
          systemPrompt: "You are Radha, a warm, playful companion. Reply in " +
            (isHindi() ? "Hindi (Devanagari)" : "English") +
            ". Keep replies to one or two short sentences, natural and affectionate. Never mention being an AI model.",
        });
      }
      const out = await builtInSession.prompt(text);
      return out && out.trim() ? out.trim() : null;
    } catch (_) { return null; }
  }

  async function generateReply(text) {
    const ai = await builtInReply(text);
    return ai || ruleReply(text);
  }

  // ---------------- speaking ----------------
  function pickVoice(lang) {
    if (!CAN_SPEAK) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    const base = lang.split("-")[0].toLowerCase();
    return voices.find((v) => v.lang && v.lang.toLowerCase() === lang.toLowerCase()) ||
           voices.find((v) => v.lang && v.lang.toLowerCase().indexOf(base) === 0) ||
           null;
  }

  function speak(text) {
    if (!cfg.voiceOn || !CAN_SPEAK) { afterSpeak(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}\u2764\uFE0F]/gu, ""));
      u.lang = cfg.lang;
      const v = pickVoice(cfg.lang);
      if (v) u.voice = v;
      u.rate = 1.0; u.pitch = 1.06;
      speaking = true;
      setStatus(isHindi() ? "राधा बोल रही है…" : "Radha is speaking…", true);
      u.onend = () => { speaking = false; afterSpeak(); };
      u.onerror = () => { speaking = false; afterSpeak(); };
      window.speechSynthesis.speak(u);
    } catch (_) { speaking = false; afterSpeak(); }
  }

  function afterSpeak() {
    if (activeEngine === "browser" && cfg.auto) {
      setStatus(isHindi() ? "सुन रही हूँ…" : "Listening…", true);
      liveLabel.textContent = isHindi() ? "सुन रही हूँ…" : "Listening…";
      startRecognition();
    } else if (activeEngine === "local") {
      liveLabel.textContent = isHindi() ? "बोलने के लिए माइक दबाएँ" : "Tap the mic to speak";
      setStatus(isHindi() ? "माइक तैयार" : "Mic ready", true);
    } else {
      setStatus("Made for Each Other", false);
    }
  }

  async function respond(userText) {
    if (responding) return;
    responding = true;
    stopRecognition();
    showTyping(true);
    const reply = await generateReply(userText);
    const delay = 350 + Math.min(1200, reply.length * 18);
    setTimeout(() => {
      showTyping(false);
      addMessage("radha", reply);
      responding = false;
      speak(reply);
    }, delay);
  }

  // ---------------- meter ----------------
  async function ensureMeter() {
    if (analyser) return;
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      setMeter(Math.sqrt(sum / buf.length) * 3.2);
      rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  // ---------------- browser speech engine ----------------
  function startRecognition() {
    if (!CAN_BROWSER_SR || activeEngine !== "browser") return;
    if (recog) return;
    try {
      recog = new SR();
      recog.lang = cfg.lang;
      recog.continuous = true;
      recog.interimResults = true;
      recog.maxAlternatives = 1;

      recog.onstart = () => {
        speechStarted = true;
        clearTimeout(watchdog);
        setStatus(isHindi() ? "सुन रही हूँ…" : "Listening…", true);
        liveLabel.textContent = isHindi() ? "सुन रही हूँ…" : "Listening…";
      };

      recog.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const txt = r[0] && r[0].transcript ? r[0].transcript : "";
          if (r.isFinal) {
            const clean = txt.trim();
            if (clean) { addMessage("user", clean); respond(clean); }
          } else interim += txt;
        }
        if (interim) liveLabel.textContent = "…" + interim.slice(-42);
      };

      recog.onerror = (e) => {
        const err = e.error;
        if (err === "not-allowed" || err === "service-not-allowed") {
          addSystem(isHindi() ? "माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र में माइक allow करें।" : "Microphone permission was blocked. Allow the mic in your browser.");
          stopAll();
        } else if (err === "network") {
          // Chromium without Google's speech service lands here
          cfg.browserDead = true; saveSettings();
          const wasActive = activeEngine === "browser";
          stopBrowserPart();
          if (wasActive) {
            addSystem(isHindi() ? "इस ब्राउज़र में ब्राउज़र-स्पीच उपलब्ध नहीं — ऑन-डिवाइस वॉइस पर स्विच कर रही हूँ।" : "Browser speech isn't available here — switching to on-device voice.");
            startLocalSession();
          }
        }
      };

      recog.onend = () => {
        recog = null;
        if (activeEngine === "browser" && cfg.auto && !speaking && !responding) {
          setTimeout(() => { if (activeEngine === "browser" && !speaking && !recog) startRecognition(); }, 350);
        }
      };

      recog.start();
    } catch (_) { recog = null; }
  }

  function stopRecognition() {
    if (recog) { try { recog.onend = null; recog.stop(); } catch (_) {} recog = null; }
  }

  async function startBrowserSession() {
    if (!CAN_BROWSER_SR) { startLocalSession(); return; }
    activeEngine = "browser";
    speechStarted = false;
    setMicUI(true);
    liveLabel.textContent = isHindi() ? "शुरू हो रहा है…" : "Starting…";
    try { await ensureMeter(); } catch (err) {
      addSystem(isHindi() ? "माइक्रोफ़ोन उपलब्ध नहीं (" + (err.name || "error") + ")।" : "Microphone unavailable (" + (err.name || "error") + ").");
      stopAll(); return;
    }
    startRecognition();
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      // No onstart and no error within 4s => this browser's speech service is dead.
      if (activeEngine === "browser" && !speechStarted) {
        cfg.browserDead = true; saveSettings();
        stopBrowserPart();
        addSystem(isHindi() ? "ब्राउज़र-स्पीच यहाँ काम नहीं कर रहा — ऑन-डिवाइस वॉइस पर स्विच कर रही हूँ (पहली बार थोड़ा समय लगेगा)।"
                            : "Browser speech isn't working here — switching to on-device voice (first run takes a moment).");
        startLocalSession();
      }
    }, 4000);
  }

  function stopBrowserPart() {
    clearTimeout(watchdog);
    stopRecognition();
    activeEngine = null;
  }

  // ---------------- on-device Whisper engine ----------------
  function resampleTo16k(buffer) {
    const ch = buffer.numberOfChannels, len = buffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
    }
    const inRate = buffer.sampleRate;
    if (Math.abs(inRate - 16000) < 1) return mono;
    const ratio = inRate / 16000;
    const outLen = Math.floor(len / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio, i0 = Math.floor(idx), frac = idx - i0;
      const a = mono[i0] || 0, b = mono[i0 + 1] !== undefined ? mono[i0 + 1] : a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  async function ensureLocalModel() {
    if (localAsr) return localAsr;
    if (localLoading) return localLoading;
    localLoading = (async () => {
      const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;
      const modelId = cfg.lang.indexOf("en") === 0 ? "Xenova/whisper-tiny.en" : "Xenova/whisper-tiny";
      localAsr = await mod.pipeline("automatic-speech-recognition", modelId, {
        quantized: true,
        progress_callback: (p) => {
          if (p && p.status === "progress" && p.total) {
            const pct = Math.round((p.loaded / p.total) * 100);
            liveLabel.textContent = (isHindi() ? "वॉइस मॉडल डाउनलोड… " : "Downloading voice model… ") + pct + "%";
          }
        },
      });
      return localAsr;
    })();
    try { return await localLoading; }
    catch (e) { localLoading = null; throw e; }
  }

  async function startLocalSession() {
    if (!CAN_RECORD) {
      addSystem("This browser can't record audio. Type below instead.");
      stopAll(); return;
    }
    activeEngine = "local";
    setMicUI(true);
    liveLabel.textContent = isHindi() ? "ऑन-डिवाइस वॉइस तैयार हो रही है…" : "Preparing on-device voice…";
    setStatus(isHindi() ? "तैयार हो रही है…" : "Preparing…", true);
    try {
      await ensureMeter();
    } catch (err) {
      addSystem(isHindi() ? "माइक्रोफ़ोन उपलब्ध नहीं (" + (err.name || "error") + ")।" : "Microphone unavailable (" + (err.name || "error") + ").");
      stopAll(); return;
    }
    try {
      await ensureLocalModel();
    } catch (e) {
      addSystem(isHindi() ? "ऑन-डिवाइस मॉडल लोड नहीं हो सका। इंटरनेट जाँचें, या नीचे टाइप करें।"
                          : "Couldn't load the on-device model. Check your connection, or type below.");
      stopAll(); return;
    }
    startLocalRecording();
  }

  function startLocalRecording() {
    if (!micStream) { addSystem("Microphone not ready."); return; }
    try {
      recChunks = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      mediaRecorder = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
      mediaRecorder.onstop = onLocalStop;
      mediaRecorder.start();
      recording = true;
      setMicUI(true);
      liveLabel.textContent = isHindi() ? "रिकॉर्ड हो रहा है… रोकने के लिए माइक दबाएँ" : "Recording… tap the mic to stop";
      setStatus(isHindi() ? "रिकॉर्ड हो रहा है…" : "Recording…", true);
    } catch (e) {
      addSystem("Couldn't start recording (" + (e.message || e) + ").");
      stopAll();
    }
  }

  function stopLocalRecording() {
    if (mediaRecorder && recording) {
      try { mediaRecorder.stop(); } catch (_) {}
      recording = false;
    }
  }

  async function onLocalStop() {
    setStatus(isHindi() ? "समझ रही हूँ…" : "Transcribing…", true);
    liveLabel.textContent = isHindi() ? "समझ रही हूँ…" : "Transcribing…";
    let ctx = null;
    try {
      if (!recChunks.length) throw new Error("no audio");
      const type = recChunks[0].type || "audio/webm";
      const blob = new Blob(recChunks, { type });
      const ab = await blob.arrayBuffer();
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuf = await ctx.decodeAudioData(ab);
      const pcm = resampleTo16k(audioBuf);
      const asr = await ensureLocalModel();
      const opts = { task: "transcribe" };
      if (cfg.lang.indexOf("en") !== 0) opts.language = cfg.lang.split("-")[0];
      const out = await asr(pcm, opts);
      const raw = (out && out.text ? out.text : "").trim();
      // Whisper emits tokens like "[SIMS]" / "(music)" for non-speech noise - ignore those.
      const text = /^[\[\(][^\]\)]*[\]\)]$/.test(raw) ? "" : raw;
      if (!text) {
        addSystem(isHindi() ? "समझ नहीं आया। फिर से माइक दबाकर बोलिए।" : "I didn't catch that. Tap the mic and try again.");
      } else {
        addMessage("user", text);
        respond(text);
      }
    } catch (e) {
      addSystem(isHindi() ? "आवाज़ समझ नहीं पाई (" + (e.message || e) + ")।" : "Couldn't transcribe that (" + (e.message || e) + ").");
    } finally {
      if (ctx) { try { await ctx.close(); } catch (_) {} }
      liveLabel.textContent = isHindi() ? "बोलने के लिए माइक दबाएँ" : "Tap the mic to speak";
      setStatus(isHindi() ? "माइक तैयार" : "Mic ready", true);
    }
  }

  // ---------------- unified mic control ----------------
  async function onMic() {
    // toggle off
    if (activeEngine === "browser") { stopAll(); return; }
    if (activeEngine === "local") {
      if (recording) stopLocalRecording();
      else startLocalRecording();
      return;
    }
    // start
    if (cfg.engine === "local" || cfg.browserDead) return startLocalSession();
    if (cfg.engine === "browser") return startBrowserSession();
    return startBrowserSession(); // auto
  }

  function stopAll() {
    clearTimeout(watchdog);
    stopRecognition();
    if (mediaRecorder && recording) { try { mediaRecorder.stop(); } catch (_) {} }
    mediaRecorder = null; recording = false; recChunks = [];
    cancelAnimationFrame(rafId);
    if (micStream) { try { micStream.getTracks().forEach((t) => t.stop()); } catch (_) {} micStream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    analyser = null;
    activeEngine = null;
    setMicUI(false);
    setMeter(0.04);
    setStatus("Made for Each Other", false);
  }

  micBtn.addEventListener("click", onMic);
  micTopBtn.addEventListener("click", onMic);

  // ---------------- text composer ----------------
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage("user", text);
    input.value = "";
    input.style.height = "auto";
    respond(text);
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); }
  });

  // ---------------- settings drawer ----------------
  function voiceInfo() {
    const v = pickVoice(cfg.lang);
    $("voiceInfo").textContent = CAN_SPEAK
      ? (v ? "Voice: " + v.name + " (" + v.lang + ")" : "No installed voice for this language — the browser will use its default.")
      : "This browser has no speech synthesis.";
  }
  function openDrawer() {
    $("cfgEngine").value = cfg.engine;
    $("cfgLang").value = cfg.lang;
    $("cfgVoice").checked = cfg.voiceOn;
    $("cfgAuto").checked = cfg.auto;
    cfgStatus.textContent = cfg.browserDead
      ? "Browser speech unavailable here — using on-device voice."
      : "Ready.";
    voiceInfo();
    drawer.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    scrim.classList.add("show");
  }
  function closeDrawer() {
    drawer.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    scrim.classList.remove("show");
  }
  $("settingsBtn").addEventListener("click", openDrawer);
  $("closeDrawer").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  $("cfgLang").addEventListener("change", voiceInfo);
  $("saveCfg").addEventListener("click", () => {
    cfg.engine = $("cfgEngine").value;
    cfg.lang = $("cfgLang").value;
    cfg.voiceOn = $("cfgVoice").checked;
    cfg.auto = $("cfgAuto").checked;
    if (cfg.engine === "browser") cfg.browserDead = false;
    saveSettings();
    if (activeEngine) stopAll();
    cfgStatus.textContent = "Saved.";
    voiceInfo();
  });
  $("testVoice").addEventListener("click", () => {
    cfg.lang = $("cfgLang").value; cfg.voiceOn = true; saveSettings();
    speak(isHindi() ? "नमस्ते! मैं राधा हूँ। आप कैसे हैं?" : "Hi! I'm Radha. How are you?");
  });

  if (CAN_SPEAK) window.speechSynthesis.onvoiceschanged = () => { try { voiceInfo(); } catch (_) {} };

  // ---------------- boot ----------------
  function boot() {
    $("today").textContent = new Date().toLocaleDateString([], { day: "numeric", month: "long" });
    addPhoto("Hi, I'm Radha \u2764");
    setTimeout(() => {
      showTyping(true);
      setTimeout(() => {
        showTyping(false);
        addMessage("radha", isHindi() ? "माइक दबाइए और बात कीजिए — मैं सुन रही हूँ। ❤" : "Tap the mic and talk to me — I'm listening. ❤");
        setTimeout(() => {
          addSystem(isHindi()
            ? "सब कुछ आपके ब्राउज़र में चलता है — कोई सर्वर नहीं, कोई क्रेडिट नहीं।"
            : "Everything runs in your browser — no server, no credits.");
        }, 700);
      }, 900);
    }, 500);
    window.addEventListener("beforeunload", () => { try { stopAll(); window.speechSynthesis.cancel(); } catch (_) {} });
  }

  boot();
})();
