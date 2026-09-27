'use strict';

const COMMAND_OUTPUT_LIMIT = 60000;
const TRUNCATION_MARKER = '\n\n… [command output truncated by Little Bot to keep the session responsive] …\n\n';

const SHELL_CONDUCT = `Shell conduct for Windows CMD and PowerShell:
- Prefer non-interactive commands. Supply flags/arguments that prevent prompts, confirmations, pagers, and credential questions whenever the tool supports them.
- Never start an interactive shell, REPL, pager, full-screen program, or command that waits indefinitely for keyboard input.
- Bound recursive filesystem work. Target the relevant folder and filter early; do not scan an entire drive or user profile unless the user explicitly asks.
- Bound output before it reaches the chat. Prefer summaries, counts, targeted Select-Object/Where-Object filtering, and small result windows instead of dumping thousands of lines.
- Avoid endless commands such as watchers, tail/follow loops, continuous ping, event monitors, or foreground servers unless the user explicitly requests a long-running process. If a persistent process is needed, start it in a way that does not hold the current shell call open and report how to stop it.
- For PowerShell, prefer -NoLogo -NoProfile -NonInteractive when launching a nested powershell.exe/pwsh process. Use -ErrorAction Stop when failure must be detected rather than silently ignored.
- For commands that may take a long time, split the work into bounded steps and check progress between them instead of issuing one giant command.
- Do not pipe binary or enormous generated content into the conversation. Write large artifacts to files and report the path plus a concise summary.
- Preserve the user's requested result; these rules are about execution hygiene, not asking for extra permission.`;

function clipCommandText(value, max = COMMAND_OUTPUT_LIMIT) {
  const text = String(value ?? '');
  if (!Number.isSafeInteger(max) || max < TRUNCATION_MARKER.length + 200) throw new TypeError('A practical command output limit is required.');
  if (text.length <= max) return text;
  const available = max - TRUNCATION_MARKER.length;
  const head = Math.ceil(available * 0.6);
  const tail = available - head;
  return text.slice(0, head) + TRUNCATION_MARKER + text.slice(-tail);
}

function commandTranscript(command, output, max = COMMAND_OUTPUT_LIMIT) {
  return clipCommandText(`$ ${String(command ?? '')}\n${String(output ?? '')}`, max);
}

function appendCommandDelta(existing, delta, max = COMMAND_OUTPUT_LIMIT) {
  return clipCommandText(String(existing ?? '') + String(delta ?? ''), max);
}

module.exports = {
  COMMAND_OUTPUT_LIMIT,
  SHELL_CONDUCT,
  TRUNCATION_MARKER,
  clipCommandText,
  commandTranscript,
  appendCommandDelta,
};
