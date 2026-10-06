# Bundled skill provenance

Reviewed 2026-09-26. These are a small selection for Little Bot's current capabilities, not a universal ranking. Only Markdown instructions and required license notices are bundled. Nothing is downloaded, installed, or updated automatically at runtime.

## Included adaptations

| Little Bot skill | Pinned upstream source | Why it fits |
| --- | --- | --- |
| `research-brief` | [Notion research documentation](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/notion-research-documentation/SKILL.md) | Produces a useful conclusion from several sources, preserves evidence and disagreements, and keeps the output proportional to the question. |
| `meeting-prep` | [Notion meeting intelligence](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/notion-meeting-intelligence/SKILL.md) | Turns existing material into preparation focused on outcomes, decisions, and unresolved work. |

Both upstream skills are Copyright 2025 Notion Labs, Inc. and distributed under the MIT license. Their original notices are preserved in each adapted skill's `LICENSE.txt`.

Repository: `openai/skills`  
Reviewed commit: `49f948faa9258a0c61caceaf225e179651397431`

Changes made for Little Bot: removed Notion-specific commands, OAuth setup, database templates, automatic remote publishing, and unavailable reference-file dependencies; replaced them with local/supplied sources and already available tools. Added explicit missing-source handling and source dates. Condensed each workflow into one self-contained file. These are modified adaptations, not the original upstream packages.

## Reviewed but not bundled

- [Anthropic doc co-authoring](https://github.com/anthropics/skills/blob/33375500bcea98d610eb30ce10ac4e59b89c390d/skills/doc-coauthoring/SKILL.md): useful reader-oriented drafting ideas, but its extensive interactive stages conflict with this app's lightweight workflow. This folder also has no skill-specific license file at the reviewed revision. No content from it is included.
- [Anthropic web app testing](https://github.com/anthropics/skills/blob/33375500bcea98d610eb30ce10ac4e59b89c390d/skills/webapp-testing/SKILL.md): depends on Python Playwright and helper scripts, which are not bundled. Little Bot instead uses its original `web-tools` guide with the built-in browser.
- [Notion knowledge capture](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/notion-knowledge-capture/SKILL.md): overlaps Little Bot's existing memory and goal features and adds Notion database assumptions. Excluded to keep the starter collection small.

Anthropic repository reviewed commit: `33375500bcea98d610eb30ce10ac4e59b89c390d`.

`little-bot`, the app command guide, and `web-tools` are authored specifically for Little Bot and are not upstream adaptations. A skill supplies instructions; it does not grant tools, credentials, or permissions.
