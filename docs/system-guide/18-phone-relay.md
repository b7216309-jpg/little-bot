# Phone relay

## How it works

The [relay](../../src/relay.cjs) is an optional local web server (port 8787 by default, off until enabled in Settings › Phone relay). It serves a small phone web app from [src/relay-web](../../src/relay-web/index.html) and mirrors the one Little Bot conversation to paired phones. The PC stays the only source of truth. Phones keep no chat history of their own; they show the PC's conversation and send actions back.

**Live sync.** [main.cjs](../../src/main.cjs) forwards every controller event to the relay as well as to the desktop window. A `state` event becomes a trimmed snapshot (see [relay-view.cjs](../../src/relay-view.cjs)): the last 200 messages, pending questions and approvals, and goal status. The relay sends the message order plus only the messages that changed since the last broadcast. `chatUpdate` streaming patches pass straight through, so a reply types itself out on the phone and the PC at the same time. Phones use one Server-Sent Events stream fetched with the token in a header. On every (re)connect they receive a full `hello` snapshot, so a phone that was offline catches up without replaying a log.

**Same actions as the desktop.** Phone requests call the same IPC handlers the desktop window uses: `send` (an active goal step steps aside first, as for a desktop message), `stop`, `answerProactive`, `respondApproval` and `runGoal` / `pauseGoal` / `resumeGoal`. The usual rules therefore hold: one turn at a time, and buttons answered on one device disappear on the other.

**Tabs.** The phone has **Conversation**, **Quick** and **Sessions**. Sessions lists the 20 most recent saved sessions (their last 80 messages each travel with the snapshot); **+ New session** starts one whose first message creates it, and an open session has a back button and **Delete**. Requests name the chat they target: `quick: true`, `sessionId`, or `newSession: true`; a `sessionId` must be one the phone was shown. A finished reply in a session notifies like one in the conversation, titled with the session. Replies render lists, headings and quotes like the desktop.

**What a phone can see.** Only the conversation, labels, proactive buttons, attachment names, ids and thumbnails, pending questions and approvals, goal name/status/next step and its pending question, and the names and one-line descriptions of enabled skills (for the `/skill` list). Settings, the system prompt, profile, memory, workspace paths, skill instructions and other extension details never leave the PC. A test checks this.

**Drafts and questions per chat (0.44.0).** Each tab keeps its own unsent text and files, so switching from Quick to the conversation never sends a draft to the wrong chat; files still uploading stay with the chat they were picked in. A question or approval shows in its own chat only; every other tab shows one line, "Little Bot asks something in …", with **Open**.

**Catch-up with the desktop (0.44.0).**
- **Keep:** the Quick bar has **Keep**, like the desktop (`keepQuick` calls `saveQuickSession`). Before the first message it moves the draft to a new saved session instead.
- **`/` menu:** typing `/` lists `/skill`, `/goal` and, in Quick, `/keep`. After `/skill ` it lists the enabled skills with the desktop's own matching ([slash-commands.js](../../src/renderer/slash-commands.js), served at `/slash-commands.js`); picking one puts `$name` in front of the message. A typed `/skill name message` also works: the relay turns it into `$name message`, and refuses a skill that is not enabled.
- **Goal form:** the goal button beside the message box (or `/goal` from the menu) opens **Goal for this chat**: the condition, an optional check command, and turn and minute budgets. It sends the same `/goal` arguments as the desktop drawer, built by the shared `goalArguments`.
- **Goal questions:** a background goal's question gets an answer form in the chat message that asked it and in the **Background goals** sheet (`goalAnswer` calls `answerGoal`). The sheet's button shows a dot while a goal is asking, and each goal shows one action: Pause, Run now, Resume or Run again.
- **Files:** tapping a picture in a message shows it full size; tapping any other file downloads it. The phone asks `fileLink` for a link, which the relay gives only for a file of a message the phone was shown. The link works for 2 minutes without the token header, so an `<img>` or a download can use it. Pictures open inline; every other file downloads as `application/octet-stream` under a sandbox policy, so it can never run as a page on the relay's origin, where the phone's token lives. In the Android app, files other than pictures need the app's `openFile` bridge when it has one; otherwise the WebView's own download handling applies.
- **Notification links:** a notification carries the chat it is about (`/#session=<id>`, `/#quick`, or `/`). Tapping it opens that chat: an open app is told by the service worker, a closed one starts on it.

## Pairing and security

- Settings › Pair a phone shows a QR code holding `http(s)://<pc>:<port>/#pair=<code>`. The code works once and expires after 10 minutes. Wrong guesses do not cancel it (72 random bits cannot be guessed, and cancelling would let anyone on the network cancel the owner's pairing).
- Pairing gives the phone its own random 256-bit token. Only its SHA-256 hash is stored, in the base `data/relay.json` (shared by all profiles, so the phone follows the running one), which is encrypted with Windows secure storage like the conversation. Up to 5 phones can be paired, and each can be removed from Settings (or unpairs itself from its menu).
- Every API call needs the token. Twenty wrong pairing codes from one address lock pairing out for 10 minutes. A missing or revoked phone token only gets a 401: tokens are 256 random bits, and counting them would lock every phone out behind Tailscale, where all clients share 127.0.0.1. A request body that has not arrived after 60 seconds is cut off. Request bodies are capped at 64 KB, and the web app is served with a strict Content-Security-Policy and no CORS headers.
- Answering `ask_user` questions from the phone is always allowed. Approving other actions (commands, file changes) is a separate opt-in that is off by default; requests that need a form (MCP) must be answered on the PC.
- The server listens on all interfaces so a phone on the same Wi-Fi can reach it. Windows asks once whether to allow Little Bot on private networks. Plain Wi-Fi traffic is not encrypted; use Tailscale for encryption and for access away from home.

## Tailscale and notifications

Browsers only allow service workers, installing to the home screen and push notifications on https. **Turn on Tailscale HTTPS** runs `tailscale serve --bg http://127.0.0.1:<port>`, which gives the PC an `https://<machine>.<tailnet>.ts.net` address with a real certificate, reachable from the phone over the encrypted tailnet. The relay detects this with `tailscale status` / `tailscale serve status` and offers the https link first.

The phone's menu starts with the **Background work** switch, the same global pause as the desktop sidebar switch (`/api/background`). On https, the phone's menu can also turn on notifications. [web-push.cjs](../../src/web-push.cjs) implements Web Push without a dependency: VAPID (ES256 JWT, keys kept in `relay.json`) and aes128gcm payload encryption (RFC 8291). Pushes only go to known push services (FCM, Mozilla, Windows, Apple). The rules in `relay-view.notifications` send one for a new proactive message, a new question or approval, and a finished reply. They are sent only while no phone has the app open and the desktop window is not focused. The service worker also skips the notification if the app is already visible.

App icons come from the Wink icon build ([build-icons.cjs](../../scripts/build-icons.cjs)): 192 and 512 px PNGs and a full-bleed maskable PNG for Android launchers.

## Conditions that prevent operation

- The PC must be on with Little Bot running; the model runs on the PC. When unreachable, the phone shows "PC unreachable · retrying" and reconnects with backoff (up to 15 s), immediately when it becomes visible or regains network.
- A port already in use shows an error in Settings.
- Without https (plain Wi-Fi), chat works but notifications and installing are unavailable.

## Tests

[relay.test.cjs](../../test/relay.test.cjs) decrypts pushes the way a browser does and verifies the VAPID signature. It also checks the trimmed view for leaks and the notification rules, then runs a real server to cover pairing, tokens, lockouts, live updates, deltas, handlers, approvals, push gating, static files and restart persistence.

## Android app

The Android app lives in its own private repository. It is plain Java with no third-party libraries, built with the SDK build tools without Gradle. Its `npm run build -- --to <this project>` copies the signed APK to `resources/android/little-bot.apk`. The relay serves that file at `/little-bot.apk`, and Chrome on an Android phone offers it in the phone web app's menu. The signing key stays next to the Android SDK and is never committed.

- **Pairing.** The desktop QR code opens the pairing page in Chrome. "Pair the Android app instead" hands the code to the app through an `intent://` link. Pasting the pairing link also works. The token is encrypted with an Android Keystore key.
- **Chat.** A WebView loads the PC's own phone web app and passes it the token through a small JavaScript bridge. Only the PC's origin stays in the WebView; other links open outside it. Chat, questions, buttons and goals behave exactly as on the web.
- **Notifications.** A foreground service of type remoteMessaging keeps one background event stream open (`/api/events?background=1`). A background stream never counts as someone looking at the chat. When nobody is looking, the relay sends `notify` events, and the service shows them as notifications. No Google push account is involved. The service restarts after a reboot or an app update.
- **Location.** It is off until enabled in the app menu. The app first asks for while-in-use permission, then for "Allow all the time". It sends the location (at most every 5 minutes or 100 m) and the battery level to `/api/context`, and refreshes every 30 minutes. [phone-context.cjs](../../src/phone-context.cjs) validates the data and keeps only the latest context, in memory. "Set this place as home" stores one home point (200 m radius) in the encrypted relay file. Prompts for chat, heartbeat and goals get a short line: at home or how far away, coordinates rounded to about 100 m, accuracy, and battery. Leaving or reaching home publishes `phone.left_home` / `phone.arrived_home`, which can wake a wild heartbeat.
- **Thinking.** The model's reasoning and commentary are folded into the collapsed "Thinking" group on the phone, as on the desktop. They never trigger a "replied" notification.

## Photos, voice and phone actions (0.16.0, app 1.1.0)

- **Attachments.** The phone's 📎 button uses Android's picker; in a browser it is a normal file input. Share → Little Bot works from any app. Large photos are shrunk on the phone. Each file goes to `POST /api/attach` (base64, up to 20 MB) and is imported by the same importer as desktop attachments, which resizes images and makes thumbnails. The `send` action then carries the attachment IDs. Files appear as chips in the composer until sent.
- **Voice.** The 🎤 button opens Android's own speech recognizer. The app needs no microphone permission, and the recognized text is placed in the composer.
- **Phone actions.** The `phone_action` agent tool can set an alarm (hour:minute, phone time), start a timer, ring the phone (alarm stream, even in silent mode, for up to two minutes) or prepare a navigation route. It works only in the user's direct conversation, never in a heartbeat, goal or automation. [relay.cjs](../../src/relay.cjs) sends the action to the app's background connection; when no app is connected, the tool reports that. The app schedules alarms and timers with exact alarms (`USE_EXACT_ALARM`) and rings until Stop is pressed. A route is a notification that opens Maps.
- **Notification buttons.** Notes carry what the app needs to add buttons:
  - Proactive suggestions get ✅ / ⏰ / ✖ (`/api/proactive`).
  - Questions get up to two choices plus Answer (`/api/answer`).
  - Everything else gets Reply (`/api/send`).
  After a button is used, the notification turns into a short confirmation.

