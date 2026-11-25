'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// The saved conversations, as an append-only journal beside state.json. A save appends only what changed since
// the last one: a new message, the latest text of one being streamed, a conversation's own fields, or a new order
// when messages were removed. Rewriting the whole history on every save wore the disk for nothing.
//
// One record per line. With secure storage each line is encrypted on its own ("e" + base64); without it, plain
// JSON ("j" + JSON). Records:
//   { t: 'journal', v }          first line
//   { t: 'chats', ids }          which conversations are saved, in order
//   { t: 'chat', id, chat }      a conversation's fields, without its messages
//   { t: 'm', c, m }             one message of conversation c, replacing any with the same id
//   { t: 'order', c, ids }       conversation c's messages, when they are not the last order plus new ones
// The latest record wins. Once superseded lines outweigh the live ones, the journal is rewritten whole.
const JOURNAL_VERSION = 1;
const FILE_NAME = 'chats.journal';
// Rewrite once the file is more than twice what it holds, plus this much, so small histories are not rewritten often.
const REWRITE_SLACK_BYTES = 1024 * 1024;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
const appendedTo = (before, after) => after.length >= before.length && before.every((id, index) => id === after[index]);

// On Windows an antivirus scan or the search indexer can hold a file for a moment. A replacement that lands then
// is retried briefly instead of failing whatever was being saved.
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(from, to); }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
}

class JournalLockedError extends Error {}

class ChatJournal {
  constructor({ filePath, protector = null, rewriteSlackBytes = REWRITE_SLACK_BYTES }) {
    this.filePath = path.resolve(filePath);
    this.protector = protector;
    this.rewriteSlackBytes = rewriteSlackBytes;
    this.warning = null;
    this.recoveryPath = null;
    // Set when the file must be rewritten whole on the next save: none yet, a stale or damaged one, a failed append.
    this.needsRewrite = true;
    this.damaged = false;
    this.forget();
  }

  // What the file holds, as the exact text of each latest record, so a save can tell what changed.
  forget() {
    this.chatIds = [];
    this.chatsBytes = 0;
    this.chats = new Map();
    this.fileBytes = 0;
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  encode(record) {
    const json = JSON.stringify(record);
    if (!this.protector) return `j${json}\n`;
    const encrypted = this.protector.encryptString(json);
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error('Could not encrypt saved conversations.');
    return `e${encrypted.toString('base64')}\n`;
  }

  decode(line) {
    if (line[0] === 'j') return JSON.parse(line.slice(1));
    if (line[0] !== 'e') throw new SyntaxError('Unknown journal line.');
    if (!this.protector) throw new JournalLockedError('Saved conversations are encrypted and secure storage is unavailable.');
    let json;
    try { json = this.protector.decryptString(Buffer.from(line.slice(1), 'base64')); }
    catch { throw new JournalLockedError('Saved conversations could not be decrypted with this Windows account.'); }
    return JSON.parse(json);
  }

  known(chatId) {
    let entry = this.chats.get(chatId);
    if (!entry) {
      entry = { chat: null, chatBytes: 0, messages: new Map(), order: [], orderBytes: 0 };
      this.chats.set(chatId, entry);
    }
    return entry;
  }

  // Reads the journal into raw conversations (normalized by the store like any loaded state). A torn last line,
  // as a crash in the middle of a save leaves, is dropped. Other unreadable lines are skipped with a warning, and
  // the original is kept beside it before the next save rewrites it. Throws JournalLockedError when nothing
  // encrypted can be read (another Windows account, say): the store then refuses to overwrite it.
  read() {
    this.forget();
    const text = fs.readFileSync(this.filePath, 'utf8');
    this.fileBytes = Buffer.byteLength(text);
    const lines = text.split('\n');
    const torn = lines.at(-1) !== '';
    if (!torn) lines.pop();
    let header = false, unreadable = 0, decrypted = 0, locked = null;
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      let record;
      try {
        record = this.decode(line);
        if (line[0] === 'e') decrypted++;
      } catch (error) {
        if (error instanceof JournalLockedError) locked ||= error;
        if (!(torn && index === lines.length - 1)) unreadable++;
        continue;
      }
      if (!isObject(record)) { unreadable++; continue; }
      if (record.t === 'journal') {
        if (record.v !== JOURNAL_VERSION) throw new Error(`The conversations journal has an unsupported version (${record.v}).`);
        header = true;
        continue;
      }
      const bytes = Buffer.byteLength(line) + 1;
      if (record.t === 'chats' && Array.isArray(record.ids)) {
        this.chatIds = record.ids.filter(id => typeof id === 'string');
        this.chatsBytes = bytes;
      } else if (record.t === 'chat' && typeof record.id === 'string' && isObject(record.chat)) {
        const entry = this.known(record.id);
        entry.chat = JSON.stringify(record.chat);
        entry.chatBytes = bytes;
      } else if (record.t === 'm' && typeof record.c === 'string' && isObject(record.m) && typeof record.m.id === 'string') {
        const entry = this.known(record.c);
        if (!entry.messages.has(record.m.id)) entry.order.push(record.m.id);
        entry.messages.set(record.m.id, { json: JSON.stringify(record.m), bytes });
      } else if (record.t === 'order' && typeof record.c === 'string' && Array.isArray(record.ids)) {
        const entry = this.known(record.c);
        entry.order = record.ids.filter(id => typeof id === 'string');
        entry.orderBytes = bytes;
      } else unreadable++;
    }
    if (locked && !decrypted) throw locked;
    if (!header && (unreadable || this.chats.size)) unreadable++;
    // Messages left out of their conversation's order were removed.
    for (const entry of this.chats.values()) {
      const kept = new Set(entry.order);
      for (const id of entry.messages.keys()) if (!kept.has(id)) entry.messages.delete(id);
      entry.order = entry.order.filter(id => entry.messages.has(id));
    }
    for (const id of [...this.chats.keys()]) if (!this.chatIds.includes(id)) this.chats.delete(id);
    this.damaged = unreadable > 0;
    if (this.damaged) this.warning = `${unreadable} saved conversation record${unreadable === 1 ? ' was' : 's were'} unreadable and skipped. The original file is preserved.`;
    this.needsRewrite = torn || this.damaged;
    return this.chatIds.filter(id => this.chats.get(id)?.chat).map(id => {
      const entry = this.chats.get(id);
      return { ...JSON.parse(entry.chat), messages: entry.order.map(messageId => JSON.parse(entry.messages.get(messageId).json)) };
    });
  }

  liveBytes() {
    let total = this.chatsBytes;
    for (const entry of this.chats.values()) {
      total += entry.chatBytes + entry.orderBytes;
      for (const message of entry.messages.values()) total += message.bytes;
    }
    return total;
  }

  // Saves normalized conversations: appends what changed, or rewrites the file when it has to.
  write(chats) {
    if (this.needsRewrite || !fs.existsSync(this.filePath)) return this.rewrite(chats);
    const lines = [], updates = [];
    const ids = chats.map(chat => chat.id);
    if (!sameIds(ids, this.chatIds)) {
      const line = this.encode({ t: 'chats', ids });
      lines.push(line);
      updates.push(() => { this.chatIds = ids; this.chatsBytes = Buffer.byteLength(line); for (const id of [...this.chats.keys()]) if (!ids.includes(id)) this.chats.delete(id); });
    }
    for (const chat of chats) {
      const { messages, ...fields } = chat;
      const entry = this.chats.get(chat.id) || { chat: null, chatBytes: 0, messages: new Map(), order: [], orderBytes: 0 };
      const json = JSON.stringify(fields);
      if (json !== entry.chat) {
        const line = this.encode({ t: 'chat', id: chat.id, chat: fields });
        lines.push(line);
        updates.push(() => { const live = this.known(chat.id); live.chat = json; live.chatBytes = Buffer.byteLength(line); });
      }
      for (const message of messages) {
        const text = JSON.stringify(message);
        if (entry.messages.get(message.id)?.json === text) continue;
        const line = this.encode({ t: 'm', c: chat.id, m: message });
        lines.push(line);
        updates.push(() => {
          const live = this.known(chat.id);
          if (!live.messages.has(message.id)) live.order.push(message.id);
          live.messages.set(message.id, { json: text, bytes: Buffer.byteLength(line) });
        });
      }
      const order = messages.map(message => message.id);
      if (!appendedTo(entry.order, order)) {
        const line = this.encode({ t: 'order', c: chat.id, ids: order });
        lines.push(line);
        updates.push(() => {
          const live = this.known(chat.id);
          live.order = order;
          live.orderBytes = Buffer.byteLength(line);
          const kept = new Set(order);
          for (const id of [...live.messages.keys()]) if (!kept.has(id)) live.messages.delete(id);
        });
      }
    }
    if (!lines.length) return { appendedBytes: 0, rewritten: false };
    const payload = lines.join('');
    try {
      const descriptor = fs.openSync(this.filePath, 'a', 0o600);
      try {
        fs.writeSync(descriptor, payload);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      // A partial line may now end the file: the next save rewrites it whole from memory.
      this.needsRewrite = true;
      throw error;
    }
    for (const update of updates) update();
    this.fileBytes += Buffer.byteLength(payload);
    if (this.fileBytes > 2 * this.liveBytes() + this.rewriteSlackBytes) return { ...this.rewrite(chats), appendedBytes: Buffer.byteLength(payload) };
    return { appendedBytes: Buffer.byteLength(payload), rewritten: false };
  }

  // Writes the whole journal to a temporary file and swaps it in.
  rewrite(chats) {
    const lines = [this.encode({ t: 'journal', v: JOURNAL_VERSION }), this.encode({ t: 'chats', ids: chats.map(chat => chat.id) })];
    for (const chat of chats) {
      const { messages, ...fields } = chat;
      lines.push(this.encode({ t: 'chat', id: chat.id, chat: fields }));
      for (const message of messages) lines.push(this.encode({ t: 'm', c: chat.id, m: message }));
    }
    const payload = lines.join('');
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (this.damaged && fs.existsSync(this.filePath)) {
      const recoveryPath = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}`;
      fs.copyFileSync(this.filePath, recoveryPath, fs.constants.COPYFILE_EXCL);
      this.recoveryPath = recoveryPath;
      this.damaged = false;
    }
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      try {
        fs.writeSync(descriptor, payload);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      renameWithRetry(temporaryPath, this.filePath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch { /* It may already have been renamed. */ }
      throw error;
    }
    // Index what was written, line by line, exactly as read() would.
    this.forget();
    let offset = 2;
    this.chatIds = chats.map(chat => chat.id);
    this.chatsBytes = Buffer.byteLength(lines[1]);
    for (const chat of chats) {
      const { messages, ...fields } = chat;
      const entry = this.known(chat.id);
      entry.chat = JSON.stringify(fields);
      entry.chatBytes = Buffer.byteLength(lines[offset++]);
      for (const message of messages) {
        if (!entry.messages.has(message.id)) entry.order.push(message.id);
        entry.messages.set(message.id, { json: JSON.stringify(message), bytes: Buffer.byteLength(lines[offset++]) });
      }
    }
    this.fileBytes = Buffer.byteLength(payload);
    this.needsRewrite = false;
    return { appendedBytes: 0, rewritten: true, bytes: this.fileBytes };
  }
}

module.exports = { ChatJournal, JournalLockedError, JOURNAL_VERSION, FILE_NAME, renameWithRetry };
