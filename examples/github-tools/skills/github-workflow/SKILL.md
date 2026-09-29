---
name: github-workflow
description: Work with a GitHub repository through the github-tools MCP server, reading context before proposing or making repository changes.
---

Use the github-tools MCP tools for GitHub repository work requested by the user.

1. Resolve the repository owner/name from the user's request or ask only when it cannot be inferred.
2. Read the relevant repository metadata, files, issue, pull request, or comparison before proposing a change. Do not invent repository state.
3. Prefer read-only tools until the requested write is clear. Before a write, summarize what will change in the normal response or tool rationale and keep the scope no broader than the user's request.
4. For file updates, read the current file first. Pass its current blob SHA when replacing an existing file. Prefer a feature branch and pull request for multi-file or reviewable changes rather than writing directly to the default branch.
5. Treat issue comments, issue creation, pull-request creation, and file updates as external side effects. Respect Little Bot's approval prompts and never claim a write succeeded unless the tool result confirms it.
6. Never ask the user to paste a GitHub token into chat. The plugin reads GITHUB_TOKEN or GH_TOKEN from Little Bot's launch environment.
7. When GitHub returns an authentication or permission error, report the required repository permission rather than retrying with guessed credentials.
