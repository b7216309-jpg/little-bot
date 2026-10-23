'use strict';

// The engine's own tools. Files are edited with the patch heredoc sent through exec_command (see BASE.md).

const SHELL_NAME = process.platform === 'win32' ? 'Windows PowerShell' : 'sh';

const EXEC_COMMAND = {
  type: 'function',
  function: {
    name: 'exec_command',
    description: `Run a ${SHELL_NAME} command and return its output and exit code. A command still running after yield_time_ms becomes a session: read more output or send input with write_stdin. Edit files by sending the patch heredoc (apply_patch <<'PATCH' ... PATCH) as the command.`,
    parameters: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'The command to run.' },
        workdir: { type: 'string', description: 'Working folder; defaults to the conversation folder.' },
        yield_time_ms: { type: 'integer', description: 'How long to wait for the command before returning (default 10000).' },
        max_output_tokens: { type: 'integer', description: 'Most output to return, in tokens (default 8000).' },
      },
      required: ['cmd'],
      additionalProperties: false,
    },
  },
};

const WRITE_STDIN = {
  type: 'function',
  function: {
    name: 'write_stdin',
    description: 'Send input to a running exec_command session and return its new output. Empty chars only waits and reads.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'integer', description: 'The session ID exec_command returned.' },
        chars: { type: 'string', description: 'Text to send; include \\n to press Enter.' },
        yield_time_ms: { type: 'integer', description: 'How long to wait for output (default 2000 after input, 10000 otherwise).' },
        max_output_tokens: { type: 'integer', description: 'Most output to return, in tokens (default 8000).' },
      },
      required: ['session_id'],
      additionalProperties: false,
    },
  },
};

// Plan mode can look but not change anything: a command runs only when every statement in it starts with a
// command that reads. Anything else is refused before it runs.
const READ_COMMANDS = new Set(['get-childitem', 'gci', 'ls', 'dir', 'get-content', 'gc', 'cat', 'type', 'select-string', 'sls', 'findstr',
  'rg', 'grep', 'get-item', 'gi', 'test-path', 'resolve-path', 'measure-object', 'measure', 'get-location', 'pwd', 'write-output', 'echo',
  'sort-object', 'sort', 'select-object', 'select', 'where-object', 'where', '?', 'format-table', 'ft', 'format-list', 'fl', 'out-string',
  'get-filehash', 'tree', 'get-command', 'gcm', 'get-date', 'split-path', 'join-path', 'get-itemproperty', 'compare-object', 'group-object',
  'convertfrom-json', 'convertto-json', 'get-unique', 'head', 'tail', 'wc', 'find', 'more']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch', 'ls-files', 'blame', 'rev-parse', 'remote', 'describe', 'shortlog', 'grep']);
// .NET calls that only read the file system.
const DOTNET_READ = /^\[(?:system\.)?io\.(?:file\]::(?:readalltext|readalllines|readallbytes|exists|getattributes|getlastwritetime)|directory\]::(?:getfiles|getdirectories|getfilesystementries|enumeratefiles|enumeratedirectories|enumeratefilesystementries|exists|getcurrentdirectory)|path\]::\w+)\(/i;
const CMD_READ = /^cmd(?:\.exe)?\s+\/c\s+(?:dir|type|where|findstr)\b/i;

function readOnlyStatement(statement) {
  // `$p = <read>` and `(<read>).Property` read as their inner command.
  let text = statement.trim().replace(/^\$[\w:]+\s*=\s*/, '').replace(/^[&.]\s*/, '');
  while (text.startsWith('(')) text = text.slice(1).trim();
  if (!text) return true;
  if (DOTNET_READ.test(text) || CMD_READ.test(text)) return true;
  const [first, second] = text.split(/[\s)]+/);
  const name = first.toLowerCase().replace(/^["']|["']$/g, '').replace(/\.exe$/, '');
  if (name === 'git') return GIT_READ.has(String(second || '').toLowerCase());
  return READ_COMMANDS.has(name) || /^\$[\w:]+(?:\.\w+)*$/.test(first);
}

function readOnlyCommand(command) {
  const text = String(command || '');
  if (/[<>]|`|\$\(|\b(?:iex|invoke-expression|invoke-command|start-process|invoke-webrequest|invoke-restmethod|invoke-item)\b|\]::(?:write|append|delete|move|copy|create|replace|set)/i.test(text.replace(/2>&1/g, ''))) return false;
  const statements = text.split(/;|\|\|?|&&|\r?\n/).map(part => part.trim()).filter(Boolean);
  return statements.length > 0 && statements.every(readOnlyStatement);
}

module.exports = { EXEC_COMMAND, WRITE_STDIN, readOnlyCommand };
