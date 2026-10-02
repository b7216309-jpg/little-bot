# Source ownership map

Every tracked file under src, scripts, examples, resources and integrations has a primary guide below. Shared owners link to other subsystems where necessary. Test files are linked from the guides and enumerated by the package test commands. Generated models, dependencies, build output and personal state are not source modules.

## runtime storage

Guide: [01-runtime-storage.md](01-runtime-storage.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/codex.cjs](../../src/codex.cjs) | Production application module |
| [src/main.cjs](../../src/main.cjs) | Production application module |
| [src/preload.cjs](../../src/preload.cjs) | Production application module |
| [src/store.cjs](../../src/store.cjs) | Production application module |

## chat context

Guide: [02-chat-context.md](02-chat-context.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/compaction.cjs](../../src/compaction.cjs) | Production application module |
| [src/controller.cjs](../../src/controller.cjs) | Production application module |

## models strata

Guide: [03-models-strata.md](03-models-strata.md)

| Source / resource | Responsibility |
| --- | --- |
| [integrations/strata/cache-slots.patch](../../integrations/strata/cache-slots.patch) | External Strata patch / build instructions / verification |
| [integrations/strata/README.md](../../integrations/strata/README.md) | External Strata patch / build instructions / verification |
| [integrations/strata/ssd-conversation-cache-0.1.33.patch](../../integrations/strata/ssd-conversation-cache-0.1.33.patch) | Temporary SSD storage for Strata 0.1.33 automatic conversation parking |
| [integrations/strata/verify-conversation-cache.cjs](../../integrations/strata/verify-conversation-cache.cjs) | Conversation-cache and cancellation verification through the Responses relay |
| [integrations/strata/verify-strata-cancel.py](../../integrations/strata/verify-strata-cancel.py) | External Strata patch / build instructions / verification |
| [integrations/strata/verify-strata-needles.py](../../integrations/strata/verify-strata-needles.py) | External Strata patch / build instructions / verification |
| [integrations/strata/verify-strata-slots.py](../../integrations/strata/verify-strata-slots.py) | External Strata patch / build instructions / verification |
| [src/connections.cjs](../../src/connections.cjs) | Production application module |
| [src/local-generation.cjs](../../src/local-generation.cjs) | Production application module |
| [src/local-model-relay.cjs](../../src/local-model-relay.cjs) | Production application module |
| [src/responses-namespace-compat.cjs](../../src/responses-namespace-compat.cjs) | Production application module |
| [src/strata-responses-adapter.cjs](../../src/strata-responses-adapter.cjs) | Production application module |

## memory

Guide: [04-memory.md](04-memory.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/backups.cjs](../../src/backups.cjs) | Production application module |
| [resources/embeddings/LICENSE](../../resources/embeddings/LICENSE) | Bundled defaults, instructions, model manifest or licensing |
| [resources/embeddings/manifest.json](../../resources/embeddings/manifest.json) | Bundled defaults, instructions, model manifest or licensing |
| [resources/embeddings/NOTICE.md](../../resources/embeddings/NOTICE.md) | Bundled defaults, instructions, model manifest or licensing |
| [scripts/prepare-embeddings.cjs](../../scripts/prepare-embeddings.cjs) | Preparation, build, install or developer verification |
| [src/local-embeddings-worker.cjs](../../src/local-embeddings-worker.cjs) | Production application module |
| [src/local-embeddings.cjs](../../src/local-embeddings.cjs) | Production application module |
| [src/memory-consolidator.cjs](../../src/memory-consolidator.cjs) | Production application module |
| [src/memory-service.cjs](../../src/memory-service.cjs) | Production application module |
| [src/memory.cjs](../../src/memory.cjs) | Production application module |
| [src/recall.cjs](../../src/recall.cjs) | Production application module |

## goals

Guide: [05-goals.md](05-goals.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/model-json.cjs](../../src/model-json.cjs) | Production application module |
| [src/goal-contract.cjs](../../src/goal-contract.cjs) | Production application module |
| [src/goal-executor.cjs](../../src/goal-executor.cjs) | Production application module |
| [src/goals.cjs](../../src/goals.cjs) | Production application module |

## goal ledger files

Guide: [06-goal-ledger-files.md](06-goal-ledger-files.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/goal-files.cjs](../../src/goal-files.cjs) | Production application module |
| [src/goal-ledger.cjs](../../src/goal-ledger.cjs) | Production application module |
| [src/renderer/goal-ledger-panel.js](../../src/renderer/goal-ledger-panel.js) | Feature rendering, normalization or styling |
| [src/renderer/goal-ledger-ui.js](../../src/renderer/goal-ledger-ui.js) | Feature rendering, normalization or styling |
| [src/renderer/goal-ledger.css](../../src/renderer/goal-ledger.css) | Feature rendering, normalization or styling |

## automations

Guide: [07-automations.md](07-automations.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/missed-schedules.cjs](../../src/missed-schedules.cjs) | Production application module |
| [src/schedule-management.cjs](../../src/schedule-management.cjs) | Production application module |
| [src/scheduler.cjs](../../src/scheduler.cjs) | Production application module |

## heartbeat inbox

Guide: [08-heartbeat-inbox.md](08-heartbeat-inbox.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/attention.cjs](../../src/attention.cjs) | Production application module |
| [src/heartbeat.cjs](../../src/heartbeat.cjs) | Production application module |
| [src/proactive-chat.cjs](../../src/proactive-chat.cjs) | Production application module |
| [src/activity.cjs](../../src/activity.cjs) | Production application module |
| [src/web-watch.cjs](../../src/web-watch.cjs) | Production application module |
| [src/steam-library.cjs](../../src/steam-library.cjs) | Production application module |

## events intents calendar

Guide: [09-events-intents-calendar.md](09-events-intents-calendar.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/calendar.cjs](../../src/calendar.cjs) | Production application module |
| [src/event-bus.cjs](../../src/event-bus.cjs) | Production application module |
| [src/event-runtime.cjs](../../src/event-runtime.cjs) | Production application module |
| [src/renderer/standing-intents-panel.js](../../src/renderer/standing-intents-panel.js) | Feature rendering, normalization or styling |
| [src/renderer/standing-intents-ui.js](../../src/renderer/standing-intents-ui.js) | Feature rendering, normalization or styling |
| [src/renderer/standing-intents.css](../../src/renderer/standing-intents.css) | Feature rendering, normalization or styling |
| [src/standing-intents.cjs](../../src/standing-intents.cjs) | Production application module |

## agent tools terminal

Guide: [10-agent-tools-terminal.md](10-agent-tools-terminal.md)

| Source / resource | Responsibility |
| --- | --- |
| [scripts/verify-tool-migration.cjs](../../scripts/verify-tool-migration.cjs) | Preparation, build, install or developer verification |
| [src/agent-tools.cjs](../../src/agent-tools.cjs) | Production application module |
| [src/app-management.cjs](../../src/app-management.cjs) | Production application module |
| [src/shell-conduct.cjs](../../src/shell-conduct.cjs) | Production application module |
| [src/tool-migration.cjs](../../src/tool-migration.cjs) | Production application module |

## browser web

Guide: [11-browser-web.md](11-browser-web.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/agent-browser.cjs](../../src/agent-browser.cjs) | Production application module |
| [src/web-services.cjs](../../src/web-services.cjs) | Production application module |

## skills plugins mcp

Guide: [12-skills-plugins-mcp.md](12-skills-plugins-mcp.md)

| Source / resource | Responsibility |
| --- | --- |
| [examples/github-tools/mcp.json](../../examples/github-tools/mcp.json) | Example plugin configuration, tool server or skill |
| [examples/github-tools/plugin.json](../../examples/github-tools/plugin.json) | Example plugin configuration, tool server or skill |
| [examples/github-tools/README.md](../../examples/github-tools/README.md) | Example plugin configuration, tool server or skill |
| [examples/github-tools/server.cjs](../../examples/github-tools/server.cjs) | Example plugin configuration, tool server or skill |
| [examples/github-tools/skills/github-workflow/SKILL.md](../../examples/github-tools/skills/github-workflow/SKILL.md) | Example plugin configuration, tool server or skill |
| [examples/writing-tools/mcp.json](../../examples/writing-tools/mcp.json) | Example plugin configuration, tool server or skill |
| [examples/writing-tools/plugin.json](../../examples/writing-tools/plugin.json) | Example plugin configuration, tool server or skill |
| [examples/writing-tools/server.cjs](../../examples/writing-tools/server.cjs) | Example plugin configuration, tool server or skill |
| [examples/writing-tools/skills/writing-review/SKILL.md](../../examples/writing-tools/skills/writing-review/SKILL.md) | Example plugin configuration, tool server or skill |
| [resources/skills/little-bot/SKILL.md](../../resources/skills/little-bot/SKILL.md) | Bundled defaults, instructions, model manifest or licensing |
| [resources/skills/meeting-prep/LICENSE.txt](../../resources/skills/meeting-prep/LICENSE.txt) | Bundled defaults, instructions, model manifest or licensing |
| [resources/skills/meeting-prep/SKILL.md](../../resources/skills/meeting-prep/SKILL.md) | Bundled defaults, instructions, model manifest or licensing |
| [resources/skills/research-brief/LICENSE.txt](../../resources/skills/research-brief/LICENSE.txt) | Bundled defaults, instructions, model manifest or licensing |
| [resources/skills/research-brief/SKILL.md](../../resources/skills/research-brief/SKILL.md) | Bundled defaults, instructions, model manifest or licensing |
| [resources/skills/SOURCES.md](../../resources/skills/SOURCES.md) | Bundled defaults, instructions, model manifest or licensing |
| [resources/skills/web-tools/SKILL.md](../../resources/skills/web-tools/SKILL.md) | Bundled defaults, instructions, model manifest or licensing |
| [src/bundled-skills.cjs](../../src/bundled-skills.cjs) | Production application module |
| [src/extension-runtime.cjs](../../src/extension-runtime.cjs) | Production application module |
| [src/extensions.cjs](../../src/extensions.cjs) | Production application module |
| [src/skill-context.cjs](../../src/skill-context.cjs) | Production application module |

## settings profile

Guide: [13-settings-profile.md](13-settings-profile.md)

| Source / resource | Responsibility |
| --- | --- |
| [resources/profile/SOUL.md](../../resources/profile/SOUL.md) | Bundled defaults, instructions, model manifest or licensing |
| [resources/profile/USER.md](../../resources/profile/USER.md) | Bundled defaults, instructions, model manifest or licensing |
| [src/profile.cjs](../../src/profile.cjs) | Production application module |

## attachments

Guide: [14-attachments.md](14-attachments.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/attachment-message.cjs](../../src/attachment-message.cjs) | Production application module |
| [src/attachments.cjs](../../src/attachments.cjs) | Production application module |

## questions answer checks

Guide: [15-questions-answer-checks.md](15-questions-answer-checks.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/independent-check-runner.cjs](../../src/independent-check-runner.cjs) | Production application module |
| [src/independent-check.cjs](../../src/independent-check.cjs) | Production application module |
| [src/mcp-forms.cjs](../../src/mcp-forms.cjs) | Production application module |
| [src/renderer/independent-check.js](../../src/renderer/independent-check.js) | Feature rendering, normalization or styling |
| [src/user-questions.cjs](../../src/user-questions.cjs) | Production application module |

## interface

Guide: [16-interface.md](16-interface.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/provider-usage.cjs](../../src/provider-usage.cjs) | Production application module |
| [src/renderer/action-groups.js](../../src/renderer/action-groups.js) | Feature rendering, normalization or styling |
| [src/renderer/app.js](../../src/renderer/app.js) | Feature rendering, normalization or styling |
| [src/renderer/chat-scroll.js](../../src/renderer/chat-scroll.js) | Feature rendering, normalization or styling |
| [src/renderer/index.html](../../src/renderer/index.html) | Feature rendering, normalization or styling |
| [src/renderer/provider-usage-panel.js](../../src/renderer/provider-usage-panel.js) | Feature rendering, normalization or styling |
| [src/renderer/provider-usage-ui.js](../../src/renderer/provider-usage-ui.js) | Feature rendering, normalization or styling |
| [src/renderer/provider-usage.css](../../src/renderer/provider-usage.css) | Feature rendering, normalization or styling |
| [src/renderer/slash-commands.js](../../src/renderer/slash-commands.js) | Feature rendering, normalization or styling |
| [src/renderer/styles.css](../../src/renderer/styles.css) | Feature rendering, normalization or styling |
| [src/renderer/assets/wink.svg](../../src/renderer/assets/wink.svg) | Wink brand mark used in the sidebar and welcome screen |
| [src/renderer/branding.css](../../src/renderer/branding.css) | Feature rendering, normalization or styling |

## diagnostics distribution

Guide: [17-diagnostics-distribution.md](17-diagnostics-distribution.md)

| Source / resource | Responsibility |
| --- | --- |
| [scripts/build-installer.ps1](../../scripts/build-installer.ps1) | Preparation, build, install or developer verification |
| [scripts/check-syntax.cjs](../../scripts/check-syntax.cjs) | Preparation, build, install or developer verification |
| [scripts/install.ps1](../../scripts/install.ps1) | Preparation, build, install or developer verification |
| [scripts/package.cjs](../../scripts/package.cjs) | Preparation, build, install or developer verification |
| [scripts/readme-screenshots.cjs](../../scripts/readme-screenshots.cjs) | Preparation, build, install or developer verification |
| [scripts/uninstall.ps1](../../scripts/uninstall.ps1) | Preparation, build, install or developer verification |
| [src/attachment-smoke.cjs](../../src/attachment-smoke.cjs) | Isolated development smoke harness |
| [src/error-log.cjs](../../src/error-log.cjs) | Production application module |
| [src/goals-smoke.cjs](../../src/goals-smoke.cjs) | Isolated development smoke harness |
| [src/personal-smoke.cjs](../../src/personal-smoke.cjs) | Isolated development smoke harness |
| [src/recall-smoke.cjs](../../src/recall-smoke.cjs) | Isolated development smoke harness |
| [src/smoke.cjs](../../src/smoke.cjs) | Isolated development smoke harness |
| [src/web-settings-smoke.cjs](../../src/web-settings-smoke.cjs) | Isolated development smoke harness |
| [src/web-smoke.cjs](../../src/web-smoke.cjs) | Isolated development smoke harness |
| [scripts/build-icons.cjs](../../scripts/build-icons.cjs) | Preparation, build, install or developer verification |
| [resources/icons/little-bot.ico](../../resources/icons/little-bot.ico) | Windows app, installer and shortcut icon |
| [resources/icons/little-bot.png](../../resources/icons/little-bot.png) | 512 px app icon, also the phone app icon |
| [resources/icons/little-bot.svg](../../resources/icons/little-bot.svg) | Source tile for the app icons |

## phone relay

Guide: [18-phone-relay.md](18-phone-relay.md)

| Source / resource | Responsibility |
| --- | --- |
| [src/relay.cjs](../../src/relay.cjs) | Local relay server, pairing, live stream and phone actions |
| [src/relay-view.cjs](../../src/relay-view.cjs) | Trimmed phone view and notification rules |
| [src/web-push.cjs](../../src/web-push.cjs) | Dependency-free Web Push (VAPID and aes128gcm) |
| [src/relay-web/index.html](../../src/relay-web/index.html) | Phone web app |
| [src/relay-web/app.js](../../src/relay-web/app.js) | Phone web app |
| [src/relay-web/app.css](../../src/relay-web/app.css) | Phone web app |
| [src/relay-web/sw.js](../../src/relay-web/sw.js) | Phone notifications and offline shell |
| [src/relay-web/manifest.webmanifest](../../src/relay-web/manifest.webmanifest) | Phone app install manifest |
| [resources/icons/little-bot-192.png](../../resources/icons/little-bot-192.png) | Phone app icon |
| [resources/icons/little-bot-maskable.png](../../resources/icons/little-bot-maskable.png) | Android launcher icon |
