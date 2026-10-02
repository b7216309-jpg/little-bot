# Phone relay

## How it works

The [relay](../../src/relay.cjs) is an optional local web server (port 8787 by default, off until enabled in Settings › Phone relay). It serves a small phone web app from [src/relay-web](../../src/relay-web/index.html) and mirrors the one Little Bot conversation to paired phones. The PC stays the only source of truth. Phones keep no chat history of their own; they show the PC's conversation and send actions back.

**Live sync.** [main.cjs](../../src/main.cjs) forwards every controller event to the relay as well as to the desktop window. A `state` event becomes a trimmed snapshot (see [relay-view.cjs](../../src/relay-view.cjs)): the last 200 messages, pending questions and approvals, and goal status. The relay sends the message order plus only the messages that changed since the last broadcast. `chatUpdate` streaming patches pass straight through, so a reply types itself out on the phone and the PC at the same time. Phones use one Server-Sent Events stream fetched with the token in a header. On every (re)connect they receive a full `hello` snapshot, so a phone that was offline catches up without replaying a log.

**Same actions as the desktop.** Phone requests call the same IPC handlers the desktop window uses: `send` (which pauses an active goal or heartbeat first), `stop`, `answerProactive`, `respondApproval` and `runGoal` / `pauseGoal` / `resumeGoal`. The usual rules therefore hold: one turn at a time, and buttons answered on one device disappear on the other.

**What a phone can see.** Only the conversation, labels, proactive buttons, attachment names and thumbnails, pending questions and approvals, and goal name/status/next step. Settings, the system prompt, profile, memory, service keys, workspace paths and extensions never leave the PC. A test checks this.

## Pairing and security

- Settings › Pair a phone shows a QR code holding `http(s)://<pc>:<port>/#pair=<code>`. The code works once, expires after 10 minutes, and is destroyed after 5 wrong attempts.
- Pairing gives the phone its own random 256-bit token. Only its SHA-256 hash is stored, in `data/relay.json`, which is encrypted with Windows secure storage like the conversation. Up to 5 phones can be paired, and each can be removed from Settings (or unpairs itself from its menu).
- Every API call needs the token. Twenty failed attempts from one address lock it out for 10 minutes. Request bodies are capped at 64 KB, and the web app is served with a strict Content-Security-Policy and no CORS headers.
- Answering `ask_user` questions from the phone is always allowed. Approving other actions (commands, file changes) is a separate opt-in that is off by default; requests that need a form (MCP) must be answered on the PC.
- The server listens on all interfaces so a phone on the same Wi-Fi can reach it. Windows asks once whether to allow Little Bot on private networks. Plain Wi-Fi traffic is not encrypted; use Tailscale for encryption and for access away from home.

## Tailscale and notifications

Browsers only allow service workers, installing to the home screen and push notifications on https. **Turn on Tailscale HTTPS** runs `tailscale serve --bg http://127.0.0.1:<port>`, which gives the PC an `https://<machine>.<tailnet>.ts.net` address with a real certificate, reachable from the phone over the encrypted tailnet. The relay detects this with `tailscale status` / `tailscale serve status` and offers the https link first.

On https, the phone's menu can turn on notifications. [web-push.cjs](../../src/web-push.cjs) implements Web Push without a dependency: VAPID (ES256 JWT, keys kept in `relay.json`) and aes128gcm payload encryption (RFC 8291). Pushes only go to known push services (FCM, Mozilla, Windows, Apple). The rules in `relay-view.notifications` send one for a new proactive message, a new question or approval, and a finished reply. They are sent only while no phone has the app open and the desktop window is not focused. The service worker also skips the notification if the app is already visible.

App icons come from the Wink icon build ([build-icons.cjs](../../scripts/build-icons.cjs)): 192 and 512 px PNGs and a full-bleed maskable PNG for Android launchers.

## Conditions that prevent operation

- The PC must be on with Little Bot running; the model runs on the PC. When unreachable, the phone shows "PC unreachable · retrying" and reconnects with backoff (up to 15 s), immediately when it becomes visible or regains network.
- A port already in use shows an error in Settings.
- Without https (plain Wi-Fi), chat works but notifications and installing are unavailable.

## Tests

[relay.test.cjs](../../test/relay.test.cjs) decrypts pushes the way a browser does and verifies the VAPID signature. It also checks the trimmed view for leaks and the notification rules, then runs a real server to cover pairing, tokens, lockouts, live updates, deltas, handlers, approvals, push gating, static files and restart persistence.

## Android app

The Android app is plain Java with no third-party libraries; the source is in [android](../../android/AndroidManifest.xml). [build-android.cjs](../../scripts/build-android.cjs) builds it with the SDK build tools (aapt2, javac, d8, zipalign and apksigner), without Gradle. The signing key is created once next to the SDK and is never committed. The relay serves the signed APK at `/little-bot.apk`, and Chrome on an Android phone offers it in the phone web app's menu.

- **Pairing.** The desktop QR code opens the pairing page in Chrome. "Pair the Android app instead" hands the code to the app through an `intent://` link. Pasting the pairing link also works. The token is encrypted with an Android Keystore key.
- **Chat.** A WebView loads the PC's own phone web app and passes it the token through a small JavaScript bridge. Only the PC's origin stays in the WebView; other links open outside it. Chat, questions, buttons and goals behave exactly as on the web.
- **Notifications.** A foreground service of type remoteMessaging keeps one background event stream open (`/api/events?background=1`). A background stream never counts as someone looking at the chat. When nobody is looking, the relay sends `notify` events, and the service shows them as notifications. No Google push account is involved. The service restarts after a reboot or an app update.
- **Location.** It is off until enabled in the app menu. The app first asks for while-in-use permission, then for "Allow all the time". It sends the location (at most every 5 minutes or 100 m) and the battery level to `/api/context`, and refreshes every 30 minutes. [phone-context.cjs](../../src/phone-context.cjs) validates the data and keeps only the latest context, in memory. "Set this place as home" stores one home point (200 m radius) in the encrypted relay file. Prompts for chat, heartbeat and goals get a short line: at home or how far away, coordinates rounded to about 100 m, accuracy, and battery. Leaving or reaching home publishes `phone.left_home` / `phone.arrived_home`, which can wake a wild heartbeat.
- **Thinking.** The model's reasoning and commentary are folded into the collapsed "Thinking" group on the phone, as on the desktop. They never trigger a "replied" notification.

