'use strict';

const readline = require('node:readline');

const MAX_LINE = 512000;
const DEFAULT_API_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 20000;
const MAX_OUTPUT_CHARS = 80000;
const slug = /^[A-Za-z0-9_.-]{1,100}$/;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function text(value, label, { required = true, max = 1000 } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || result.includes('\0')) throw new Error(`${label} is invalid.`);
  return result;
}
function rawText(value, label, { required = true, max = 50000 } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  if ((required && !value.trim()) || value.length > max || value.includes('\0')) throw new Error(`${label} is invalid.`);
  return value;
}
function repoPart(value, label) {
  const result = text(value, label, { max: 100 });
  if (!slug.test(result)) throw new Error(`${label} contains unsupported characters.`);
  return result;
}
function repository(args) {
  return { owner: repoPart(args?.owner, 'owner'), repo: repoPart(args?.repo, 'repo') };
}
function safePath(value = '') {
  if (value == null || value === '') return '';
  const result = text(value, 'path', { max: 2000 });
  const parts = result.split('/');
  if (result.startsWith('/') || result.includes('\\') || parts.some(part => !part || part === '.' || part === '..')) throw new Error('path must be a repository-relative path without traversal.');
  return parts.map(encodeURIComponent).join('/');
}
function encodeRef(value, label = 'ref') { return encodeURIComponent(text(value, label, { max: 300 })); }
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const result = search.toString();
  return result ? `?${result}` : '';
}
function apiBase() {
  const configured = (process.env.GITHUB_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(configured); } catch { throw new Error('GITHUB_API_URL must be a valid URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('GITHUB_API_URL must use HTTPS, except for loopback test servers.');
  if (url.username || url.password || url.search || url.hash) throw new Error('GITHUB_API_URL cannot contain credentials, a query string, or a fragment.');
  return url.href.replace(/\/+$/, '');
}
function token() { return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim(); }
function requireToken() {
  const value = token();
  if (!value) throw new Error('This GitHub operation requires GITHUB_TOKEN or GH_TOKEN in Little Bot\'s environment.');
  return value;
}

async function githubRequest(method, endpoint, { body, authRequired = false } = {}) {
  const auth = authRequired ? requireToken() : token();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(`${apiBase()}${endpoint}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'little-bot-github-plugin/1.0.0',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = raw; }
    }
    if (!response.ok) {
      const detail = object(payload) && typeof payload.message === 'string' ? payload.message : typeof payload === 'string' ? payload.slice(0, 500) : response.statusText;
      throw new Error(`GitHub API ${response.status}: ${detail || 'request failed'}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('GitHub API request timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

function compact(value) {
  const json = JSON.stringify(value, null, 2);
  return json.length <= MAX_OUTPUT_CHARS ? json : `${json.slice(0, MAX_OUTPUT_CHARS)}\n…output truncated by github-tools`;
}
function pickRepository(value) {
  return {
    full_name: value?.full_name, private: value?.private, description: value?.description, default_branch: value?.default_branch,
    archived: value?.archived, visibility: value?.visibility, html_url: value?.html_url, updated_at: value?.updated_at,
    permissions: value?.permissions,
  };
}
function pickIssue(value) {
  return {
    number: value?.number, title: value?.title, state: value?.state, html_url: value?.html_url, user: value?.user?.login,
    labels: Array.isArray(value?.labels) ? value.labels.map(label => typeof label === 'string' ? label : label?.name).filter(Boolean) : [],
    assignees: Array.isArray(value?.assignees) ? value.assignees.map(user => user?.login).filter(Boolean) : [],
    created_at: value?.created_at, updated_at: value?.updated_at, body: value?.body ?? '',
  };
}
function pickPull(value) {
  return {
    number: value?.number, title: value?.title, state: value?.state, draft: value?.draft, html_url: value?.html_url,
    user: value?.user?.login, base: value?.base?.ref, head: value?.head?.ref, mergeable: value?.mergeable,
    created_at: value?.created_at, updated_at: value?.updated_at, body: value?.body ?? '',
  };
}
function schema(properties, required = []) {
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}
const repoFields = {
  owner: { type: 'string', description: 'GitHub owner or organization login.' },
  repo: { type: 'string', description: 'Repository name without the owner.' },
};
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const TOOLS = [
  {
    name: 'github_get_repository', description: 'Get repository metadata and the authenticated token\'s repository permissions when GitHub returns them.',
    inputSchema: schema(repoFields, ['owner', 'repo']), annotations: readOnly,
  },
  {
    name: 'github_list_directory', description: 'List one directory in a GitHub repository at an optional branch, tag, or commit.',
    inputSchema: schema({ ...repoFields, path: { type: 'string', description: 'Repository-relative directory path. Empty means repository root.' }, ref: { type: 'string', description: 'Optional branch, tag, or commit SHA.' } }, ['owner', 'repo']), annotations: readOnly,
  },
  {
    name: 'github_read_file', description: 'Read a UTF-8 text file from a GitHub repository. Binary content is rejected.',
    inputSchema: schema({ ...repoFields, path: { type: 'string', description: 'Repository-relative file path.' }, ref: { type: 'string', description: 'Optional branch, tag, or commit SHA.' }, max_bytes: { type: 'integer', minimum: 1, maximum: 500000, description: 'Maximum decoded bytes to return. Default 200000.' } }, ['owner', 'repo', 'path']), annotations: readOnly,
  },
  {
    name: 'github_search_code', description: 'Search code within one repository. GitHub code search normally requires authentication.',
    inputSchema: schema({ ...repoFields, query: { type: 'string', description: 'Code search terms, without a repo: qualifier.' }, per_page: { type: 'integer', minimum: 1, maximum: 100 } }, ['owner', 'repo', 'query']), annotations: readOnly,
  },
  {
    name: 'github_list_issues', description: 'List issues in a repository. Pull requests are filtered out of the result.',
    inputSchema: schema({ ...repoFields, state: { type: 'string', enum: ['open', 'closed', 'all'] }, per_page: { type: 'integer', minimum: 1, maximum: 100 } }, ['owner', 'repo']), annotations: readOnly,
  },
  {
    name: 'github_get_issue', description: 'Get one GitHub issue by number.',
    inputSchema: schema({ ...repoFields, number: { type: 'integer', minimum: 1 } }, ['owner', 'repo', 'number']), annotations: readOnly,
  },
  {
    name: 'github_list_pull_requests', description: 'List pull requests in a repository.',
    inputSchema: schema({ ...repoFields, state: { type: 'string', enum: ['open', 'closed', 'all'] }, per_page: { type: 'integer', minimum: 1, maximum: 100 } }, ['owner', 'repo']), annotations: readOnly,
  },
  {
    name: 'github_get_pull_request', description: 'Get one pull request by number.',
    inputSchema: schema({ ...repoFields, number: { type: 'integer', minimum: 1 } }, ['owner', 'repo', 'number']), annotations: readOnly,
  },
  {
    name: 'github_compare', description: 'Compare two refs and return commit/file summary information.',
    inputSchema: schema({ ...repoFields, base: { type: 'string', description: 'Base branch, tag, or commit.' }, head: { type: 'string', description: 'Head branch, tag, or commit.' } }, ['owner', 'repo', 'base', 'head']), annotations: readOnly,
  },
  {
    name: 'github_create_branch', description: 'Create a branch from an existing branch, tag, or commit. Requires repository Contents write permission.',
    inputSchema: schema({ ...repoFields, branch: { type: 'string', maxLength: 300, description: 'New branch name, without refs/heads/.' }, from: { type: 'string', maxLength: 300, description: 'Existing branch, tag, or commit to branch from.' } }, ['owner', 'repo', 'branch', 'from']), annotations: write,
  },
  {
    name: 'github_create_issue', description: 'Create a GitHub issue. Requires a token with repository issue write permission.',
    inputSchema: schema({ ...repoFields, title: { type: 'string', maxLength: 256 }, body: { type: 'string', maxLength: 50000 }, labels: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } } }, ['owner', 'repo', 'title']), annotations: write,
  },
  {
    name: 'github_comment_issue', description: 'Add a comment to an issue or pull request conversation. Requires repository write permission.',
    inputSchema: schema({ ...repoFields, number: { type: 'integer', minimum: 1 }, body: { type: 'string', maxLength: 50000 } }, ['owner', 'repo', 'number', 'body']), annotations: write,
  },
  {
    name: 'github_create_pull_request', description: 'Open a pull request from an existing head branch into a base branch.',
    inputSchema: schema({ ...repoFields, title: { type: 'string', maxLength: 256 }, head: { type: 'string', maxLength: 300 }, base: { type: 'string', maxLength: 300 }, body: { type: 'string', maxLength: 50000 }, draft: { type: 'boolean' } }, ['owner', 'repo', 'title', 'head', 'base']), annotations: write,
  },
  {
    name: 'github_create_or_update_file', description: 'Create or replace one UTF-8 text file through GitHub\'s Contents API. Updating an existing file requires its current blob SHA.',
    inputSchema: schema({ ...repoFields, path: { type: 'string', maxLength: 2000 }, content: { type: 'string', maxLength: 300000 }, message: { type: 'string', maxLength: 1000 }, branch: { type: 'string', maxLength: 300 }, sha: { type: 'string', maxLength: 100, description: 'Current blob SHA when replacing an existing file.' } }, ['owner', 'repo', 'path', 'content', 'message']), annotations: write,
  },
];

async function callTool(name, args) {
  if (!object(args)) throw new Error('Tool arguments must be an object.');
  const { owner, repo } = repository(args);
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (name === 'github_get_repository') return pickRepository(await githubRequest('GET', root));
  if (name === 'github_list_directory') {
    const path = safePath(args.path || '');
    const payload = await githubRequest('GET', `${root}/contents${path ? `/${path}` : ''}${query({ ref: args.ref ? text(args.ref, 'ref', { max: 300 }) : undefined })}`);
    if (!Array.isArray(payload)) throw new Error('GitHub returned a file where a directory was expected.');
    return payload.slice(0, 200).map(entry => ({ name: entry?.name, path: entry?.path, type: entry?.type, size: entry?.size, sha: entry?.sha, html_url: entry?.html_url }));
  }
  if (name === 'github_read_file') {
    const path = safePath(args.path);
    const payload = await githubRequest('GET', `${root}/contents/${path}${query({ ref: args.ref ? text(args.ref, 'ref', { max: 300 }) : undefined })}`);
    if (!object(payload) || payload.type !== 'file' || typeof payload.content !== 'string' || payload.encoding !== 'base64') throw new Error('GitHub did not return a base64 file payload.');
    const buffer = Buffer.from(payload.content.replace(/\s+/g, ''), 'base64');
    const maxBytes = integer(args.max_bytes, 200000, 1, 500000);
    if (buffer.length > maxBytes) throw new Error(`File is ${buffer.length} bytes; increase max_bytes up to 500000 or read a smaller file.`);
    const decoded = buffer.toString('utf8');
    if (decoded.includes('\uFFFD') && !buffer.equals(Buffer.from(decoded, 'utf8'))) throw new Error('File does not appear to be valid UTF-8 text.');
    return { path: payload.path, sha: payload.sha, size: buffer.length, content: decoded };
  }
  if (name === 'github_search_code') {
    const terms = text(args.query, 'query', { max: 500 });
    const payload = await githubRequest('GET', `/search/code${query({ q: `${terms} repo:${owner}/${repo}`, per_page: integer(args.per_page, 20, 1, 100) })}`, { authRequired: true });
    return { total_count: payload?.total_count, items: Array.isArray(payload?.items) ? payload.items.map(item => ({ name: item?.name, path: item?.path, sha: item?.sha, html_url: item?.html_url })) : [] };
  }
  if (name === 'github_list_issues') {
    const state = ['open', 'closed', 'all'].includes(args.state) ? args.state : 'open';
    const payload = await githubRequest('GET', `${root}/issues${query({ state, per_page: integer(args.per_page, 30, 1, 100) })}`);
    return (Array.isArray(payload) ? payload : []).filter(item => !item?.pull_request).map(pickIssue);
  }
  if (name === 'github_get_issue') {
    const number = integer(args.number, null, 1, Number.MAX_SAFE_INTEGER);
    if (number == null) throw new Error('number must be a positive integer.');
    return pickIssue(await githubRequest('GET', `${root}/issues/${number}`));
  }
  if (name === 'github_list_pull_requests') {
    const state = ['open', 'closed', 'all'].includes(args.state) ? args.state : 'open';
    const payload = await githubRequest('GET', `${root}/pulls${query({ state, per_page: integer(args.per_page, 30, 1, 100) })}`);
    return (Array.isArray(payload) ? payload : []).map(pickPull);
  }
  if (name === 'github_get_pull_request') {
    const number = integer(args.number, null, 1, Number.MAX_SAFE_INTEGER);
    if (number == null) throw new Error('number must be a positive integer.');
    return pickPull(await githubRequest('GET', `${root}/pulls/${number}`));
  }
  if (name === 'github_compare') {
    const base = encodeRef(args.base, 'base');
    const head = encodeRef(args.head, 'head');
    const payload = await githubRequest('GET', `${root}/compare/${base}...${head}`);
    return {
      status: payload?.status, ahead_by: payload?.ahead_by, behind_by: payload?.behind_by, total_commits: payload?.total_commits,
      html_url: payload?.html_url,
      commits: Array.isArray(payload?.commits) ? payload.commits.slice(0, 100).map(commit => ({ sha: commit?.sha, html_url: commit?.html_url, message: commit?.commit?.message, author: commit?.author?.login || commit?.commit?.author?.name })) : [],
      files: Array.isArray(payload?.files) ? payload.files.slice(0, 200).map(file => ({ filename: file?.filename, status: file?.status, additions: file?.additions, deletions: file?.deletions, changes: file?.changes })) : [],
    };
  }
  if (name === 'github_create_branch') {
    const branch = text(args.branch, 'branch', { max: 300 });
    if (branch.startsWith('refs/') || branch.startsWith('/') || branch.endsWith('/') || branch.includes('\\') || branch.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('branch must be a valid branch name without refs/heads/.');
    const from = text(args.from, 'from', { max: 300 });
    const commit = await githubRequest('GET', `${root}/commits/${encodeURIComponent(from)}`, { authRequired: true });
    if (typeof commit?.sha !== 'string' || !commit.sha) throw new Error('GitHub did not resolve the source ref to a commit SHA.');
    const payload = await githubRequest('POST', `${root}/git/refs`, { authRequired: true, body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
    return { ref: payload?.ref, sha: payload?.object?.sha, url: payload?.url };
  }
  if (name === 'github_create_issue') {
    const labels = args.labels == null ? undefined : Array.isArray(args.labels) && args.labels.length <= 20 ? args.labels.map(value => text(value, 'label', { max: 100 })) : (() => { throw new Error('labels must contain at most 20 strings.'); })();
    const payload = await githubRequest('POST', `${root}/issues`, { authRequired: true, body: { title: text(args.title, 'title', { max: 256 }), ...(args.body == null ? {} : { body: rawText(args.body, 'body', { required: false, max: 50000 }) }), ...(labels ? { labels } : {}) } });
    return pickIssue(payload);
  }
  if (name === 'github_comment_issue') {
    const number = integer(args.number, null, 1, Number.MAX_SAFE_INTEGER);
    if (number == null) throw new Error('number must be a positive integer.');
    const payload = await githubRequest('POST', `${root}/issues/${number}/comments`, { authRequired: true, body: { body: rawText(args.body, 'body', { max: 50000 }) } });
    return { id: payload?.id, html_url: payload?.html_url, user: payload?.user?.login, created_at: payload?.created_at, body: payload?.body };
  }
  if (name === 'github_create_pull_request') {
    const payload = await githubRequest('POST', `${root}/pulls`, { authRequired: true, body: {
      title: text(args.title, 'title', { max: 256 }), head: text(args.head, 'head', { max: 300 }), base: text(args.base, 'base', { max: 300 }),
      ...(args.body == null ? {} : { body: rawText(args.body, 'body', { required: false, max: 50000 }) }), ...(typeof args.draft === 'boolean' ? { draft: args.draft } : {}),
    } });
    return pickPull(payload);
  }
  if (name === 'github_create_or_update_file') {
    const path = safePath(args.path);
    const body = {
      message: text(args.message, 'message', { max: 1000 }), content: Buffer.from(rawText(args.content, 'content', { required: false, max: 300000 }), 'utf8').toString('base64'),
      ...(args.branch == null ? {} : { branch: text(args.branch, 'branch', { max: 300 }) }), ...(args.sha == null ? {} : { sha: text(args.sha, 'sha', { max: 100 }) }),
    };
    const payload = await githubRequest('PUT', `${root}/contents/${path}`, { authRequired: true, body });
    return { content: { path: payload?.content?.path, sha: payload?.content?.sha, html_url: payload?.content?.html_url }, commit: { sha: payload?.commit?.sha, html_url: payload?.commit?.html_url, message: payload?.commit?.message } };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function toolResult(id, value) { send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: compact(value) }] } }); }
function toolError(id, error) { send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: error?.message || 'GitHub tool failed.' }] } }); }

function main() {
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', async line => {
    if (line.length > MAX_LINE) { input.close(); process.exitCode = 1; return; }
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.id == null) return;
    const result = value => send({ jsonrpc: '2.0', id: request.id, result: value });
    try {
      if (request.method === 'initialize') result({ protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'little-bot-github-tools', version: '1.0.0' } });
      else if (request.method === 'ping') result({});
      else if (request.method === 'tools/list') result({ tools: TOOLS });
      else if (request.method === 'tools/call') toolResult(request.id, await callTool(request.params?.name, request.params?.arguments || {}));
      else if (request.method === 'resources/list') result({ resources: [] });
      else if (request.method === 'resources/templates/list') result({ resourceTemplates: [] });
      else send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not supported.' } });
    } catch (error) {
      if (request.method === 'tools/call') toolError(request.id, error);
      else send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: error?.message || 'Request failed.' } });
    }
  });
}

if (require.main === module) main();
module.exports = { TOOLS, apiBase, callTool, githubRequest };
