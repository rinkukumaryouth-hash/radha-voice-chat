# Radha · Made for Each Other

A WhatsApp-style **voice chat room** for a Sarvam **Voice Agents** agent. Tap the mic,
Chromium asks for microphone permission, and you talk to Radha in real time — her words
appear as chat bubbles as she speaks.

Static site. No server, no build step, open source. Works on GitHub Pages, Netlify, or any
static host (must be **https** or `localhost` for microphone access).

---

## What's in the box

```
index.html            the chat room (WhatsApp-style UI)
styles.css            WhatsApp look & feel, Radha theme
app.js                mic + live voice session + demo mode
assets/radha.jpg      Radha's photo (shown in the chat)
assets/radha-avatar.jpg  small header avatar
README.md
```

## Two modes

**Demo mode (no key needed).** Open the page, tap the mic — the browser asks for microphone
permission and a live level meter appears. Typed messages get friendly local replies so the
room feels alive. This works with zero configuration, so the public link is useful to anyone.

**Live mode (real voice).** Open **⚙ Settings**, paste your **Agent ID** and **API key**, save,
then tap the mic. The page starts a real-time session with your agent over the
`sarvam-conv-ai-sdk/browser` SDK: your microphone audio streams to Sarvam, and the agent's
reply plays out loud while both sides appear as chat bubbles.

Your Organization ID and Workspace ID are pre-filled from your workspace.

## How to get the two values you need

| Value | Where |
| --- | --- |
| **API key** (`X-API-Key`) | Indus → **Settings → API Key**: https://indus.sarvam.ai/samvaad/settings/api-key — Voice Agents keys are separate from standard TTS/STT keys |
| **Agent ID** (`app_id`) | Indus → your agent → **···** menu → **Copy agent ID** |

The agent must have a **committed version** or the session will fail to connect.

---

## About the API key (please read)

The docs are explicit: *never put a production API key in browser code — proxy it server-side.*
This project deliberately takes the "no server" route you asked for, which means the key is
typed into the page and kept **only in your browser's `localStorage`**, then sent straight to
Sarvam. It is never written into this repo and never sent anywhere else.

That is fine for a personal demo you open yourself. For a **public** site, don't hand the key
to visitors — put it behind a tiny proxy instead and point the SDK's `baseUrl` at it
(`apiKey: ""`, `baseUrl: "/api/sarvam/"`). See the "Keeping the key server-side" note in the
Sarvam Web SDK docs.

---

## Deploy

### GitHub Pages
1. Push these files to a repo (root, or `/docs`).
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → branch `main`, folder `/ (root)`.
3. Your room goes live at `https://<user>.github.io/<repo>/`.

### Netlify (fastest)
Drag the folder onto https://app.netlify.com/drop, or connect the repo with:
- Build command: *(none)*
- Publish directory: `/` (the repo root)

---

## Under the hood — the Voice Agents bits

Auth is a single header on every call: `X-API-Key: <key>`.

The browser session uses the official Web SDK, `sarvam-conv-ai-sdk` (browser entry point),
with `ConversationAgent` + `BrowserAudioInterface`:

```js
import { ConversationAgent, BrowserAudioInterface, InteractionType }
  from "sarvam-conv-ai-sdk/browser";

const agent = new ConversationAgent({
  apiKey: "<key>",
  config: {
    org_id: "<org>", workspace_id: "<workspace>", app_id: "<agent>",
    user_identifier: "radha-web-user", user_identifier_type: "custom",
    interaction_type: InteractionType.CALL,
    input_sample_rate: 16000, output_sample_rate: 16000,
  },
  audioInterface: new BrowserAudioInterface(16000),
  transcriptCallback: (m) => console.log(m.role, m.content),
});
await agent.start();
await agent.waitForConnect(10);
```

`start()` must run from a user gesture (the mic tap) so Chromium allows mic + playback.
Reconnection is not supported — each session URL is single-use; call `stop()` and start a new
agent if the connection drops.

### Service base URLs (they differ per service)
| Service | Base URL |
| --- | --- |
| Deployments | `https://apps.sarvam.ai/api/app-authoring` |
| Campaigns & Cohorts | `https://apps.sarvam.ai/api/scheduling` |
| Instant Outbound | `https://apps.sarvam.ai/api/outbounds` |
| Analytics & Boards | `https://apps.sarvam.ai/api` |
| Tests | `https://apps.sarvam.ai/api/evals` |
| Runtime (WebSocket sessions) | `https://apps.sarvam.ai/api/app-runtime/` |

### Instant outbound call (server-side, optional)
If you later want a "call me" button, this is the exact contract — run it from a backend,
never the browser:

```
POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds
X-API-Key: <key>
{
  "app_config": {
    "app_id": "<agent id>",
    "app_version": 1,
    "connection_config": { "connection_id": "<connection id>", "agent_phone_number": "<your Sarvam number>" }
  },
  "user_config": { "user_phone_number": "+91XXXXXXXXXX" }
}
-> { "attempt_id": "..." }
```

You'll need a **connection ID** and a **phone number** (E.164) for this — ask your workspace
admin, or bring/rent a number under Deploy → Phone Numbers.

---

## Docs
- Deploy with code: https://docs.sarvam.ai/conversations/deploy/deploy-with-code
- Web SDK: https://docs.sarvam.ai/voice-agents/deploy/sdks/web
- API reference: https://docs.sarvam.ai/conversations/api/introduction

Licence: MIT. The Radha photo belongs to whoever supplied it — replace `assets/radha.jpg` with
an image you have the rights to before publishing publicly.
