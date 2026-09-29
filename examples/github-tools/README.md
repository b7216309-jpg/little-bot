# GitHub Tools plugin

A zero-dependency GitHub MCP plugin for Little Bot. It uses Node's built-in `fetch`, talks to the GitHub REST API, and keeps credentials outside plugin files.

## Install

1. Create a GitHub token with only the repository permissions you want Little Bot to use.
2. Set `GITHUB_TOKEN` (or `GH_TOKEN`) in the environment that launches Little Bot, then restart the app. Public read-only repository calls can work without a token, but code search and all writes require one.
3. Open **Extensions → Plugins → Import plugin** and select this `examples/github-tools` folder.
4. Enable **github-tools**, click **Refresh**, and inspect the discovered tools under **Tools**.
5. Optionally invoke `$github-workflow` in chat for repository-oriented guidance.

For GitHub Enterprise Server, set `GITHUB_API_URL` to its REST API root (for example `https://github.example.com/api/v3`) before launching Little Bot.

## Tools

Read-only tools cover repository metadata, directory listings, UTF-8 file reads, code search, issues, pull requests, and ref comparisons. Write tools can create branches and issues, comment on issue/PR conversations, open pull requests, and create or update UTF-8 files.

The plugin does not run `git`, clone repositories, store credentials, or install packages. GitHub API errors are returned to the model as tool errors. Write tools are marked destructive so Little Bot can present them appropriately in its normal MCP approval flow.
