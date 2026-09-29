'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const fingerprint = tools => createHash('sha256').update(JSON.stringify(tools)).digest('hex');
// Pinned engine 0.157.1 persists dynamic tools at creation, with no update RPC.
// Update only its tool registry, before engine startup; never replace conversation history.
function migrateTools(home, threadId, tools) {
  if (!/^[a-f0-9-]{36}$/.test(threadId)) throw new Error('Invalid engine thread ID.');
  const database = path.join(home, 'state_5.sqlite');
  const db = new DatabaseSync(database);
  db.exec('PRAGMA busy_timeout=5000');
  try {
    const thread = db.prepare('SELECT rollout_path FROM threads WHERE id=?').get(threadId);
    if (!thread) throw new Error('The saved engine conversation is missing.');
    const file = path.resolve(thread.rollout_path), root = path.resolve(home) + path.sep;
    if (!file.startsWith(root)) throw new Error('Engine history is outside its data folder.');
    const data = fs.readFileSync(file, 'utf8'), end = data.indexOf('\n');
    if (end < 0) throw new Error('Invalid engine history header.');
    const meta = JSON.parse(data.slice(0, end));
    if (meta.type !== 'session_meta' || (meta.payload.id || meta.payload.session_id) !== threadId) throw new Error('Engine history identity mismatch.');
    const records = tools.map(t => ({ type:'function', name:t.name, description:t.description, inputSchema:t.inputSchema }));
    const backup = `${file}.tools-${fingerprint(tools).slice(0,12)}.bak`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    meta.payload.dynamic_tools = records;
    const temporary = `${file}.tools.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(meta) + data.slice(end));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM thread_dynamic_tools WHERE thread_id=?').run(threadId);
      const insert = db.prepare('INSERT INTO thread_dynamic_tools(thread_id,position,name,description,input_schema,defer_loading,namespace) VALUES(?,?,?,?,?,0,NULL)');
      records.forEach((t,i)=>insert.run(threadId,i,t.name,t.description,JSON.stringify(t.inputSchema)));
      fs.renameSync(temporary,file);
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
module.exports={migrateTools,fingerprint};
