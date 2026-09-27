'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_BACKUPS = 3;
const MAX_MESSAGE = 8000;
const MAX_STACK = 24000;

function redact(value) {
  return String(value ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{12,}\b/g, '[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, '[redacted]')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[redacted]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .replace(/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|refresh_token|api_key|apikey|client_secret|password|passwd|passphrase|secret|token)([\s"'=:]+)([^\s"',;}]{3,})/gi, '$1$2[redacted]')
    .replace(/([?&](?:access_token|refresh_token|api_key|apikey|client_secret|token|key)=)[^&#\s]+/gi, '$1[redacted]');
}

function scalar(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redact(value).slice(0, 4000);
  return undefined;
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 3 || value == null) return scalar(value);
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeMetadata(item, depth + 1)).filter(item => item !== undefined);
  if (typeof value !== 'object') return scalar(value);
  const result = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (++count > 30) break;
    if (/^(?:prompt|messages?|input|content|body|authorization|cookie)$/i.test(key)) {
      result[key] = '[omitted]';
      continue;
    }
    if (/^(?:access_?token|refresh_?token|api_?key|apikey|client_?secret|password|passwd|passphrase|secret|token|bearer)$/i.test(key)) {
      result[key] = '[redacted]';
      continue;
    }
    const clean = sanitizeMetadata(item, depth + 1);
    if (clean !== undefined) result[String(key).slice(0, 100)] = clean;
  }
  return result;
}

class ErrorLog {
  constructor({ root, appVersion = '', maxBytes = DEFAULT_MAX_BYTES, backups = DEFAULT_BACKUPS } = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('Error log root must be an absolute path.');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new TypeError('Error log maxBytes is invalid.');
    if (!Number.isSafeInteger(backups) || backups < 1 || backups > 10) throw new TypeError('Error log backups is invalid.');
    this.root = root;
    this.filePath = path.join(root, 'errors.jsonl');
    this.appVersion = String(appVersion || '').slice(0, 100);
    this.maxBytes = maxBytes;
    this.backups = backups;
  }

  _rotate(extraBytes) {
    let size = 0;
    try { size = fs.statSync(this.filePath).size; } catch {}
    if (size + extraBytes <= this.maxBytes) return;
    const oldest = `${this.filePath}.${this.backups}`;
    try { fs.rmSync(oldest, { force: true }); } catch {}
    for (let index = this.backups - 1; index >= 1; index--) {
      const from = `${this.filePath}.${index}`;
      const to = `${this.filePath}.${index + 1}`;
      try { fs.renameSync(from, to); } catch {}
    }
    try { fs.renameSync(this.filePath, `${this.filePath}.1`); } catch {}
  }

  capture(source, error, metadata = {}) {
    try {
      fs.mkdirSync(this.root, { recursive: true });
      const message = redact(error?.message ?? error ?? 'Unknown error').slice(0, MAX_MESSAGE);
      const stack = redact(error?.stack || '').slice(0, MAX_STACK);
      const entry = {
        at: new Date().toISOString(),
        source: redact(source || 'unknown').slice(0, 200),
        message,
        ...(stack && stack !== message ? { stack } : {}),
        appVersion: this.appVersion,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        metadata: sanitizeMetadata(metadata),
      };
      const line = Buffer.from(JSON.stringify(entry) + '\n');
      this._rotate(line.length);
      fs.appendFileSync(this.filePath, line);
      return entry;
    } catch (loggingError) {
      try { console.error('Little Bot could not write its diagnostic log:', redact(loggingError?.message || loggingError)); } catch {}
      return null;
    }
  }
}

module.exports = { ErrorLog, redact, sanitizeMetadata };
