# Radha · Made for Each Other

A WhatsApp-style **voice chat room** where Radha listens and talks back — **entirely inside your
browser**. No server, no API key, no Sarvam credits, nothing to sign up for.

**Live:** https://rinkukumaryouth-hash.github.io/radha-voice-chat/

Tap the mic, allow the microphone once, and speak. Your words appear as chat bubbles and Radha
answers out loud.

---

## Why there are two voice engines

The browser's built-in `SpeechRecognition` only really works in **Google Chrome / Edge** — it
leans on Google's speech service. **Plain Chromium ships without that service**, and worse, it
fails *silently*: `start()` is called, no event ever fires, and the UI sits on "Listening…"
forever.

So the app has two engines and picks one automatically:

| Engine | What it uses | Works in |
| --- | --- | --- |
| **Browser speech** | `webkitSpeechRecognition` | Chrome, Edge |
| **On-device (Whisper)** | [transformers.js](https://github.com/xenova/transformers.js) running Whisper in WASM | **any Chromium**, offline after first load |

**Auto mode** tries browser speech first. A 4-second watchdog notices if it never actually
starts, then silently switches to the on-device model. The choice is remembered, so later visits
skip straight to the engine that works.

You can force either engine in **⚙ Settings → Voice input**.

### On-device mode in practice
- First use downloads a small Whisper model (~40 MB) and caches it; afterwards it starts instantly.
- It's **push-to-talk**: tap the mic, speak, tap again. She transcribes locally and replies.
- `whisper-tiny.en` for English, multilingual `whisper-tiny` for other languages.
- Slower than browser speech (a few seconds per utterance) but it works everywhere and the audio
  never leaves your device.

## Everything else

| Part | What it uses |
| --- | --- |
| **Thinking** | A local reply engine in `app.js`, plus Chrome's built-in AI (Gemini Nano) *if* already installed |
| **Speaking** | The browser's `speechSynthesis` voices |
| **Microphone** | `getUserMedia` (for the level meter and, on-device, for recording) |

Microphone access needs **https** or `localhost`.

## Files

```
index.html               the chat room
styles.css               WhatsApp look & feel
app.js                   engines, local brain, speech synthesis
assets/radha.jpg         Radha's photo (shown in the chat)
assets/radha-avatar.jpg  header avatar
README.md
```

## Using it

1. Open the page over https.
2. Tap the **mic**, allow the microphone.
3. Speak. In Chrome it's hands-free; on-device it's tap-to-start / tap-to-stop.
4. Or just type in the box at the bottom — that always works.

In **⚙ Settings**: voice input engine, language (used for speaking and for browser speech),
Radha's voice on/off, and hands-free mode.

### The "brain"
`ruleReply()` handles greetings, names, "how are you", love, thanks, goodbyes, time and date,
jokes, with a warm fallback pool. If Chrome's on-device model is already available
(`window.LanguageModel`) it is used for freer conversation — the code never triggers a model
download by itself. `generateReply()` is the single seam where a bigger model would plug in.

## Deploy

**GitHub Pages** — push, then Settings → Pages → Deploy from a branch → `main` / `/ (root)`.
**Netlify** — drag the folder onto https://app.netlify.com/drop.

## Notes

- This app uploads nothing itself. In browser-speech mode the audio goes to your browser's own
  speech service; in on-device mode it stays local.
- The Radha photo belongs to whoever supplied it — swap `assets/radha.jpg` for an image you have
  the rights to before publishing publicly.
- MIT licence.

## Earlier version

A first version could open a live session with a **Sarvam Voice Agent** using an API key. That
path was removed on request so the site runs with no key and no credits. Docs, if you ever want
it back: https://docs.sarvam.ai/conversations/deploy/deploy-with-code — and the key must live
behind a server-side proxy, never in the page.
