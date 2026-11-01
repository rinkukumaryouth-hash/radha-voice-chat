# Radha · Made for Each Other

A WhatsApp-style **voice chat room** where Radha listens and talks back — **entirely inside your
browser**. No server, no API key, no Sarvam credits, nothing to sign up for.

Tap the mic, allow the microphone once, and speak. Your words appear as chat bubbles and Radha
answers out loud, in Hindi or English.

Live: https://rinkukumaryouth-hash.github.io/radha-voice-chat/

---

## How it works (all client-side)

| Part | What it uses |
| --- | --- |
| **Listening** | The browser's own `SpeechRecognition` / `webkitSpeechRecognition` |
| **Thinking** | A local reply engine in `app.js`, plus Chrome's built-in AI (Gemini Nano) *if* it is already installed on the device |
| **Speaking** | The browser's `speechSynthesis` voices |
| **Microphone** | `getUserMedia`, only for the live level meter |

There is no backend to deploy, no key to paste and no per-minute cost. The page is plain
`index.html` + `styles.css` + `app.js` and can be opened from any static host.

**Browser support:** speech *recognition* works in Chrome, Edge and Chromium on desktop and
Android (Safari/Firefox will still let you type, and will still speak replies). Microphone
access needs **https** or `localhost`.

## Files

```
index.html               the chat room
styles.css               WhatsApp look & feel
app.js                   mic, speech recognition, local brain, speech synthesis
assets/radha.jpg         Radha's photo (shown in the chat)
assets/radha-avatar.jpg  header avatar
README.md
```

## Using it

1. Open the page (https).
2. Tap the **mic**. Allow the microphone when Chromium asks.
3. Speak — Radha transcribes you into the chat and replies aloud.
4. Tap the mic again to stop. Or just type in the box at the bottom.

In **⚙ Settings** you can change the language (used for both listening and speaking), turn
Radha's voice off, and switch *hands-free* mode — where she keeps listening after each reply.

### Voices
The voice depends on what your device has installed. On Chrome desktop you usually get a Hindi
voice (`hi-IN`) and an Indian English voice (`en-IN`); on Android there are more. If no voice
exists for a language, the browser falls back to its default — the Settings panel shows which
voice is currently selected.

### The "brain"
`ruleReply()` in `app.js` handles greetings, names, "how are you", love, thanks, goodbyes, the
time and date, jokes, and falls back to a small pool of warm lines. It is deliberately simple and
fully offline. If Chrome's on-device model is already available (`window.LanguageModel`), Radha
uses it for freer conversation instead — the code never triggers a model download on its own.

To give her a bigger brain later, replace `generateReply()` with a call to any API you like. That
is the single seam where a real model would plug in.

## Deploy

**GitHub Pages** — push to a repo, then Settings → Pages → Deploy from a branch → `main` / `/ (root)`.

**Netlify** — drag the folder onto https://app.netlify.com/drop.

## Notes

- Nothing this app does is uploaded by *this app*; audio only reaches your browser's own speech
  service, which Chrome/Edge use to transcribe.
- The Radha photo belongs to whoever supplied it — swap `assets/radha.jpg` for an image you have
  the rights to before publishing publicly.
- MIT licence.

## Earlier version

A first version of this project could open a live session with a **Sarvam Voice Agent**
(`sarvam-conv-ai-sdk/browser`) using an API key. That path has been removed on request, so the
site now runs with no key and no credits. If you ever want it back, the Sarvam docs are at
https://docs.sarvam.ai/conversations/deploy/deploy-with-code — and the key must live behind a
server-side proxy, never in the page.
