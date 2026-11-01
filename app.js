/* Radha - Made for Each Other
 * A voice chat room that runs ENTIRELY in the browser.
 *   - Listening : the browser's own SpeechRecognition (webkitSpeechRecognition)
 *   - Thinking  : a local reply engine (+ Chrome's built-in AI when available)
 *   - Speaking  : the browser's speechSynthesis voices
 *
 * No server. No API key. No Sarvam credits. Nothing is uploaded by this app.
 */
(() => {
  "use strict";

  const STORE_KEY = "radha.voice.settings.v2";

  const DEFAULTS = { lang: "hi-IN", voiceOn: true, auto: true };

  const $ = (id) => document.getElementById(id);
  const chat = $("chat");
  const typingRow = $("typingRow");
  const input = $("input");
  const composer = $("composer");
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

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CAN_LISTEN = Boolean(SR);
  const CAN_SPEAK = "speechSynthesis" in window;

  let cfg = loadSettings();
  let recog = null;
  let micOn = false;        // user wants to listen
  let speaking = false;     // TTS in progress
  let micStream = null;
  let audioCtx = null;
  let analyser = null;
  let rafId = 0;
  let builtInSession = null;

  // ---------------- settings ----------------
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (_) {}
    return Object.assign({}, DEFAULTS, s);
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (_) {}
  }
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
        tick.className = "tick";
        tick.textContent = "\u2713\u2713";
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

  const showTyping = (on) => { typingRow.classList.toggle("show", Boolean(on)); scrollDown(); };
  function setStatus(text, online) { statusText.textContent = text; statusDot.classList.toggle("on", Boolean(online)); }
  function setMeter(level) { meterFill.style.width = Math.max(4, Math.min(100, Math.round(level * 100))) + "%"; }

  // ---------------- lightbox ----------------
  const lightbox = $("lightbox");
  const lightboxImg = $("lightboxImg");
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
    fallback: [
      "हम्म, यह तो दिलचस्प है। थोड़ा और बताइए।",
      "अच्छा! आपके बारे में और सुनना अच्छा लगेगा।",
      "समझ गई। आप क्या सोच रहे हैं?",
      "हाँ जी, बताइए ना।",
      "मुझे आपसे बात करना अच्छा लगता है। ❤",
    ],
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
    fallback: [
      "Hmm, that's interesting. Tell me more.",
      "Oh nice! I'd love to hear more about that.",
      "Got it. What are you thinking?",
      "Go on, I'm listening.",
      "I really enjoy talking with you. ❤",
    ],
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const L = () => (isHindi() ? HI : EN);

  function ruleReply(text) {
    const t = " " + text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ") + " ";
    const has = (...ws) => ws.some((w) => t.indexOf(w) !== -1);
    const d = L();

    if (has(" namaste ", " namaskar ", " hello ", " hi ", " hey ", " सलाम ", " हाय ") || /^(hi|hello|hey)\b/.test(t.trim()))
      return pick(d.greet);
    if (has(" your name ", " who are you ", " tumhara naam ", " aapka naam ", " तुम्हारा नाम ", " आपका नाम ", " कौन हो "))
      return pick(d.name);
    if (has(" how are you ", " kaise ho ", " kaise ho ", " kaisi ho ", " कैसे हो ", " कैसी हो ", " क्या हाल "))
      return pick(d.how);
    if (has(" love you ", " i love ", " pyar ", " pyaar ", " मोहब्बत ", " प्यार ", " इश्क़ "))
      return pick(d.love);
    if (has(" bye ", " goodbye ", " alvida ", " अलविदा ", " फिर मिलते "))
      return pick(d.bye);
    if (has(" thank ", " thanks ", " shukriya ", " dhanyavad ", " धन्यवाद ", " शुक्रिया "))
      return pick(d.thanks);
    if (has(" what can you do ", " kya kar sakti ", " क्या कर सकती ", " tum kya ho ", " तुम क्या हो "))
      return pick(d.what);
    if (has(" joke ", " hasao ", " चुटकुला ", " मज़ाक ", " mazak "))
      return pick(d.joke);

    const timeMatch = has(" time ", " samay ", " kitne baje ", " समय ", " कितने बजे ");
    if (timeMatch) {
      const s = new Date().toLocaleTimeString(isHindi() ? "hi-IN" : "en-IN", { hour: "2-digit", minute: "2-digit" });
      return isHindi() ? "अभी " + s + " बजे हैं।" : "It's " + s + " right now.";
    }
    if (has(" date ", " tarikh ", " aaj kaunsi ", " तारीख़ ", " आज कौन सी ")) {
      const s = new Date().toLocaleDateString(isHindi() ? "hi-IN" : "en-IN", { day: "numeric", month: "long", weekday: "long" });
      return isHindi() ? "आज " + s + " है।" : "Today is " + s + ".";
    }
    return pick(d.fallback);
  }

  // Chrome built-in AI (Gemini Nano) - used only when already available locally.
  async function builtInReply(text) {
    try {
      const LM = window.LanguageModel || (window.ai && window.ai.languageModel);
      if (!LM) return null;
      if (LM.availability) {
        const a = await LM.availability();
        if (a !== "available" && a !== "readily") return null; // never trigger a download
      }
      if (!builtInSession) {
        builtInSession = await LM.create({
          systemPrompt:
            "You are Radha, a warm, playful companion. Reply in " +
            (isHindi() ? "Hindi (Devanagari)" : "English") +
            ". Keep replies to one or two short sentences, natural and affectionate. Never mention being an AI model.",
        });
      }
      const out = await builtInSession.prompt(text);
      return out && out.trim() ? out.trim() : null;
    } catch (_) {
      return null;
    }
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
    return (
      voices.find((v) => v.lang && v.lang.toLowerCase() === lang.toLowerCase()) ||
      voices.find((v) => v.lang && v.lang.toLowerCase().indexOf(base) === 0) ||
      voices.find((v) => v.lang && v.lang.toLowerCase().indexOf("in") !== -1 && base === "en") ||
      null
    );
  }

  function speak(text) {
    if (!cfg.voiceOn || !CAN_SPEAK) { afterSpeak(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}\u2764\uFE0F]/gu, ""));
      u.lang = cfg.lang;
      const v = pickVoice(cfg.lang);
      if (v) u.voice = v;
      u.rate = 1.0;
      u.pitch = 1.06;
      speaking = true;
      setStatus(isHindi() ? "राधा बोल रही है…" : "Radha is speaking…", true);
      u.onend = () => { speaking = false; afterSpeak(); };
      u.onerror = () => { speaking = false; afterSpeak(); };
      window.speechSynthesis.speak(u);
    } catch (_) {
      speaking = false;
      afterSpeak();
    }
  }

  function afterSpeak() {
    if (micOn) {
      setStatus(isHindi() ? "सुन रही हूँ…" : "Listening…", true);
      liveLabel.textContent = isHindi() ? "सुन रही हूँ…" : "Listening…";
      if (cfg.auto) startRecognition();
    } else {
      setStatus("Made for Each Other", false);
    }
  }

  // ---------------- responding ----------------
  let responding = false;
  async function respond(userText) {
    if (responding) return;
    responding = true;
    stopRecognition();           // don't hear ourselves
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

  // ---------------- listening ----------------
  function startRecognition() {
    if (!CAN_LISTEN || !micOn) return;
    if (recog) return;
    try {
      recog = new SR();
      recog.lang = cfg.lang;
      recog.continuous = true;
      recog.interimResults = true;
      recog.maxAlternatives = 1;

      recog.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const txt = r[0] && r[0].transcript ? r[0].transcript : "";
          if (r.isFinal) {
            const clean = txt.trim();
            if (clean) {
              addMessage("user", clean);
              respond(clean);
            }
          } else {
            interim += txt;
          }
        }
        if (interim) liveLabel.textContent = "…" + interim.slice(-42);
      };

      recog.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          addSystem(isHindi() ? "माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र में माइक allow करें।" : "Microphone permission was blocked. Allow the mic in your browser.");
          stopMic();
        } else if (e.error === "no-speech") {
          /* ignore, will restart */
        }
      };

      recog.onend = () => {
        recog = null;
        if (micOn && !speaking && cfg.auto && !responding) {
          setTimeout(() => { if (micOn && !speaking && !recog) startRecognition(); }, 350);
        }
      };

      recog.start();
    } catch (_) {
      recog = null;
    }
  }

  function stopRecognition() {
    if (recog) {
      try { recog.onend = null; recog.stop(); } catch (_) {}
      recog = null;
    }
  }

  async function startMic() {
    if (!CAN_LISTEN) {
      addSystem(isHindi()
        ? "यह ब्राउज़र आवाज़ नहीं पहचान सकता। Chrome या Edge आज़माएँ — या नीचे टाइप करें।"
        : "This browser can't do speech recognition. Try Chrome or Edge — or just type below.");
      return;
    }
    micOn = true;
    micBtn.classList.add("live");
    liveStrip.classList.add("show");
    liveLabel.textContent = isHindi() ? "सुन रही हूँ…" : "Listening…";
    setStatus(isHindi() ? "सुन रही हूँ…" : "Listening…", true);

    // meter
    try {
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
    } catch (err) {
      addSystem(isHindi() ? "माइक्रोफ़ोन उपलब्ध नहीं (" + (err.name || "error") + ")।" : "Microphone unavailable (" + (err.name || "error") + ").");
      stopMic();
      return;
    }
    startRecognition();
  }

  function stopMic() {
    micOn = false;
    micBtn.classList.remove("live");
    stopRecognition();
    cancelAnimationFrame(rafId);
    if (micStream) { try { micStream.getTracks().forEach((t) => t.stop()); } catch (_) {} micStream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    analyser = null;
    liveStrip.classList.remove("show");
    setMeter(0.04);
    setStatus("Made for Each Other", false);
  }

  function onMic() {
    if (micOn) stopMic();
    else startMic();
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
      ? (v ? "Voice: " + v.name + " (" + v.lang + ")" : "No installed voice found for this language — the browser will pick a default.")
      : "This browser has no speech synthesis.";
  }
  function openDrawer() {
    $("cfgLang").value = cfg.lang;
    $("cfgVoice").checked = cfg.voiceOn;
    $("cfgAuto").checked = cfg.auto;
    cfgStatus.textContent = CAN_LISTEN ? "Microphone ready." : "Speech recognition not supported here — typing still works.";
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
    cfg.lang = $("cfgLang").value;
    cfg.voiceOn = $("cfgVoice").checked;
    cfg.auto = $("cfgAuto").checked;
    saveSettings();
    if (micOn) { stopMic(); startMic(); }
    cfgStatus.textContent = "Saved.";
    voiceInfo();
  });
  $("testVoice").addEventListener("click", () => {
    cfg.lang = $("cfgLang").value;
    cfg.voiceOn = true;
    saveSettings();
    speak(isHindi() ? "नमस्ते! मैं राधा हूँ। आप कैसे हैं?" : "Hi! I'm Radha. How are you?");
  });

  // warm up the voice list (Chrome loads it async)
  if (CAN_SPEAK) {
    window.speechSynthesis.onvoiceschanged = () => { try { voiceInfo(); } catch (_) {} };
  }

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
    window.addEventListener("beforeunload", () => { try { stopMic(); window.speechSynthesis.cancel(); } catch (_) {} });
  }

  boot();
})();
