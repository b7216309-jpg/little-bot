# Skills, plugins, MCP and GitHub

## Skills and the bundled guide

[extensions.cjs](../../src/extensions.cjs) validates skill/server/plugin records and imports managed files. [skill-context.cjs](../../src/skill-context.cjs) selects enabled named skills for requests; skill_list and skill_read let the agent discover/read further instructions. A skill is guidance, not an executable integration.

[bundled-skills.cjs](../../src/bundled-skills.cjs) installs/upgrades the [little-bot operating guide](../../resources/skills/little-bot/SKILL.md). Current guide version is 20. Recognized unedited earlier content can be upgraded; user-edited content and recorded deletion are preserved. Disabling the guide or its owning plugin prevents normal skill selection.

Limits include 100 skills, 30 servers and 20 plugins; plugin imports accept at most 20 skills. SKILL.md imports are bounded in bytes and their parsed instruction content to 20,000 characters. Bad metadata, names or missing files can prevent import.

## Plugins

A local plugin can supply skills and MCP server configuration. Import copies its declared resources into managed extension storage. Enabling a plugin enables its eligible owned resources; disabled tools remain explicitly tracked. Importing a folder does not mean the server successfully started or authenticated.

Existing thread dynamic-tool schemas need the [migration mechanism](10-agent-tools-terminal.md). Extension updates require an idle lane, invalidate server inventory and unsubscribe idle threads so the next execution uses the new configuration.

## MCP

[ExtensionRuntime](../../src/extension-runtime.cjs) turns managed server records into native engine configuration, discovers tools/auth status and performs OAuth flows when supported. stdio servers need an available command and declared environment-variable names; HTTP servers need a working endpoint and optional configured bearer-token environment variable.

Inventory is paginated, up to 100 pages/10,000 rows; invalid cursors fail explicitly. Disabling a tool changes saved configuration, not just its display. Goal MCP access uses saved server/tool grants and a goal-specific broker. Heartbeat verifies MCP is disabled rather than inheriting ambient enabled servers.

A server can be configured but failed, authentication-required or tool-less. Refresh and runtime status determine availability. Missing credentials, executable paths, offline endpoints, schema differences and deleted tool names prevent calls.

## GitHub plugin

[examples/github-tools](../../examples/github-tools/README.md) contains a zero-dependency MCP integration using GitHub REST. It offers repository/file/search/issue/PR/compare reads and branch, issue, comment, PR and UTF-8 file writes. It uses GITHUB_TOKEN or GH_TOKEN inherited by the app; it does not itself invoke git or gh.

It must be imported, enabled and refreshed. Public reads can work without a token; code search and writes require suitable credentials/permissions. It is included as an example plugin, not automatically connected to every account. No real GitHub write through the agent plugin was attempted in this review.

