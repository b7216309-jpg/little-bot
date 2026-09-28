# Little Bot

A Windows personal assistant for chat, files, terminal work, web browsing, and proactive tasks. Electron, plain JavaScript, and a pinned Codex tool runtime.

## Start

1. Start your existing Qwen launcher.
2. Choose one Windows build:
   - **Installer:** run `dist/0.8.8/Little-Bot-0.8.8-Setup.exe`. It installs per-user under LocalAppData, adds a Start Menu shortcut, and registers an uninstaller in Apps & Features.
   - **Portable:** unzip `dist/0.8.8/Little-Bot-0.8.8-portable.zip` and run `Little Bot.exe`. Keep the extracted folder together.
   - **Development package:** open **Launch Little Bot.cmd** after `npm run package`.
3. Choose a working folder and send a message.

**Local Qwen** is the default at `http://127.0.0.1:8080/v1`. Settings lets you change its address/model and check the connection. **Codex** is optional, using ChatGPT sign-in or an OpenAI API key. No cloud fallback occurs when the local model is offline.

**Thinking On/Off** beside the model picker controls Qwen reasoning for all local tasks. It remembers your choice and applies to the next run. Finish or stop running work before switching. Codex keeps its effort selector.

Click **Thinking…** in a reply to expand the reasoning as it streams. The completed **Thoughts** remains available in that conversation. Qwen3.6 sampling follows the thinking mode, with output space reserved for the answer.

Little Bot can ask a question during a normal chat, with optional choices or your own answer. Answer to continue, or skip. Autonomous goals save questions on their goal card; answering continues the goal within its existing access and remaining budget. Start a new chat to receive newly added tools.

Chats and autonomous tasks keep their saved connection. Older tasks remain on Codex; switch to their connection before continuing. Use a new chat for another connection or newly added tools. See [CONNECTIONS.md](CONNECTIONS.md).

## Files and images

Attach with the paperclip, drop files, or paste an image. Qwen can inspect photos. PDF, DOCX, and text files supply locally extracted text; scanned PDFs need OCR, which is not included. Other formats remain accessible as files.

The agent can return documents, screenshots, and existing images as attachments with preview/save controls. This version does not add an image-generation model.

Limits: eight files per message, 20 MiB each, 50 MiB total. See [ATTACHMENTS.md](ATTACHMENTS.md) for supported formats and extraction limits.

File changes and terminal work use the existing engine and approval flow. Writes start within the selected working folder; the Windows sandbox does not restrict every read. Requests for additional access appear in chat.

## Browser and web services

**Browser** opens Vercel agent-browser with a separate profile for browsing, forms, tabs, and screenshots. Sign in there manually when needed. It uses Chrome or Edge; Settings offers browser installation when neither is available.

Optional **Firecrawl** and **Brave Search** keys go in **Settings → Web services** and are stored encrypted. Browser control needs neither key. Service queries/URLs go to that service and may consume credits. Direct chats can browse; goals with network permission can search and scrape.

## Personal assistance

- **Profile:** edit USER.md for your facts/preferences and SOUL.md for the assistant's voice. Changes apply on the next request.
- **Memory:** current conversation, recent work, and explicit saved facts—three layers. Say **Remember that ...** or use the Memory panel. The agent can also search and page through saved conversations, including older or compacted chats, using `memory_search` and `session_read`.
- **Goals:** define an objective, completion checks, permissions, and budget. Review the draft, then Run. Checkpoints persist; results are verified. Review undo restores eligible captured files.
- **Automations:** repeating prompts with a saved folder, model, and connection, using either elapsed intervals or exact PC-local times on selected weekdays.
- **Calendar:** a local Little Bot calendar with all-day or timed events. The UI and agent can create, edit, delete, and list events using the PC's local clock. External calendar sync is not included.
- **Heartbeat:** a bounded checklist, active hours, and run limits. Useful, Later, and Don't suggest this control attention. Goals and heartbeat share the notification budget.
- **Extensions:** skills, plugins, and MCP connections. Four included skills cover app operations, web work, research briefs, and meeting preparation. Scheduling questions automatically include the enabled `little-bot` guide with heartbeat setup, routine examples, and troubleshooting. You can also invoke it with `$little-bot`.

Autonomous work runs while the app is open and the PC is awake. **Pause all** pauses it across restarts. There is no tray worker, startup service, or wake-from-sleep mechanism. See [GOALS.md](GOALS.md), [EXTENSIONS.md](EXTENSIONS.md), and [NEXT.md](NEXT.md).

Automations support repeating intervals and exact PC-local clock times on selected weekdays. They do not parse cron expressions or provide one-time timers. If Little Bot is closed or the PC is asleep when a routine becomes due, it runs once when available and advances to the next future occurrence. The agent can draft either schedule form through tools; heartbeat configuration currently uses the Heartbeat panel. Its [built-in operating guide](resources/skills/little-bot/SKILL.md) explains the available controls.

Settings also controls automatic compaction: **20–95%**, default **80%**; **0** retains only native limits. **Compact now** summarizes older context while keeping the visible transcript. See [COMPACTION.md](COMPACTION.md).

Recall requires Memory on. Conversation history stays on its saved connection and defaults to the current folder; direct chats can search across folders when requested. Background work stays in its own folder. Explicit saved facts remain shared memory until removed. Deleted chats cannot be recalled. This searches Little Bot history, not other apps. Start a new chat to use newly added tools.

Bundled skill updates preserve user edits, disabled state, IDs, and deletions. [Skill sources and licenses](resources/skills/SOURCES.md).

## Local data

Data lives in `%APPDATA%/Little Bot/data`: encrypted chat/memory state, profile, attachments, browser state, encrypted service keys, and isolated engine state. Saved conversations and Memory data are encrypted at rest with Windows DPAPI through Electron safeStorage; existing plaintext state migrates automatically on the next save. Attachments, profile Markdown files, calendar/automation metadata, and other local configuration remain ordinary local files. The app does not change your existing Codex or OpenClaw configuration. Streaming replies checkpoint about every two seconds and save immediately on completion or interruption; an abrupt power loss can lose the most recent unsaved text.

Prompts and attachments go to the selected model connection: local Qwen stays on this computer; Codex sends them to its provider. Web services and MCP tools have their own destinations. The renderer has no Node access or remote scripts. This is an unsigned personal build.

## Development

Node.js 24 or newer:

```powershell
npm install
node node_modules/electron/install.js
npm run check:syntax
npm test
npm run test:electron
npm start
npm run package
npm run package:portable
```

`npm run ci` runs the syntax, Node, and Electron checks used by the main CI workflow. The Windows distribution workflow separately verifies packaging, installation, and removal.

On Windows, `npm run package` produces the unpacked app folder, a portable ZIP, and a per-user Setup EXE. `npm run package:portable` skips installer creation and builds only the unpacked folder plus portable ZIP. The installer is a self-extracting Windows bootstrapper built with the .NET Framework compiler, needs no administrator rights, and can be removed from Apps & Features.

Pinned dependencies: Codex 0.157.1, agent-browser 0.38.1, Mammoth 1.12.3, unpdf 1.8.1, and Electron 44.4.5. There is no second agent loop or model download.

For focused checks and remaining limitations, see [VALIDATION.md](VALIDATION.md). Smoke runs require a fresh isolated `LITTLE_BOT_DATA_DIR`.

References: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [agent-browser](https://agent-browser.dev/), [Firecrawl](https://docs.firecrawl.dev/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
