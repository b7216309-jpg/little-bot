---
name: writing-review
description: Review a supplied passage for clarity, preserve its meaning, and give concise editing suggestions.
---

Review the passage in the user's message. If they have not supplied a passage or named a file, ask for one.

1. Identify its intended audience and main point from the supplied context. Do not invent missing facts.
2. Use the writing-tools text_stats MCP tool if the user wants word or character counts. This tool accepts supplied text; it does not read files.
3. Offer a revised passage that preserves the original meaning and voice.
4. Explain the two or three edits that matter most. Flag ambiguity rather than silently changing factual claims.

Do not overwrite files unless the current user request asks for an edit. Respect the app's tool permissions.
