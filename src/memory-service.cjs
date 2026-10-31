"use strict";
const { DatabaseSync } = require("node:sqlite");
const { randomUUID, createHash } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const { LocalEmbeddings, BUNDLED_EMBEDDING } = require('./local-embeddings.cjs');
const embeddingManifest = require('../resources/embeddings/manifest.json');
const clean = (value) =>
  typeof value === "string" ? value.replace(/\u0000/g, "").trim() : "";
const key = (value) =>
  clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
// A key names one subject (project.package-manager). A category such as user.preference names none, and
// two unrelated facts filed under it must not replace or forget each other.
const familyKey = (value) =>
  /^(?:(?:user|owner|me|my|project|global|workspace)[ ._-]?)?(?:preferences?|facts?|info|notes?|decisions?|procedures?|issues?|misc|general|memory|memories|data|details?|other)?$/.test(value)
    ? ""
    : value;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const MAX_EXTRACTION_ATTEMPTS = 3;
// Words too common to say what a message is about, in English and French. A message made only of these ("ok thanks",
// "oui vas-y") recalls nothing and teaches nothing. Negations stay out of `wordsOf`: they change what a fact says.
const NEGATIONS = new Set("not no never none nor neither without ne non pas plus jamais sans aucun aucune rien".split(" "));
const COMMON_WORDS = new Set(("a about after again all also am an and any are as at be because been before but by can could did do does done doing for from get go going got had has have he hello her here hey hi him his how i if in into is it its just know let like lol maybe me more most much my need now of off oh ok okay on one only or our out over please really right same see she should so some sure than thank thanks that the their them then there these they thing things this to too try up us use using very want was way we well were what when where which who why will with would yeah yep yes you your " +
  "ah alors au aussi aux avec avoir bon bien ca ce cela ces cet cette comme comment dans de des donc du elle elles en encore es est et etre eux fait faire il ils je juste la le les leur lui ma mais me merci mes moi mon mais nos notre nous ok on ou oui par parfait peut pour pourquoi quand que quel quelle qui sa salut se ses si son stp sur super ta te tes toi ton tres tu un une vas veux vos votre vous voila " +
  "ahead awesome cool continue correct exactly fine go good great next nice perfect yup").split(" ").concat([...NEGATIONS]));
const fold = (value) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const tokens = (value) => fold(clean(value)).match(/[\p{L}\p{N}_]+/gu) || [];
const significantTerms = (value) => [...new Set(tokens(value))].filter((term) => (term.length > 2 || /\d/.test(term)) && !COMMON_WORDS.has(term));
const wordsOf = (value) => new Set(tokens(value).filter((term) => NEGATIONS.has(term) || ((term.length > 2 || /\d/.test(term)) && !COMMON_WORDS.has(term))));
// A record clearly related to a message, measured on the bundled encoder. Similarity alone will not do: it scores French
// text about 0.15 higher whatever it says (related English 0.46-0.63, unrelated French up to 0.55). So a lower score
// needs a shared word, or to stand well clear of the next best record.
function clearlyRelated(row, runnerUp) {
  if (row.similarity >= 0.6) return true;
  if (row.matched >= Math.max(1, Math.ceil(row.termCount / 2)) && (row.matched >= 2 || row.termCount <= 2)) return true;
  if (row.similarity >= 0.45 && row.matched >= 1) return true;
  return row.similarity >= 0.5 && row.similarity - runnerUp >= 0.08;
}
const MAX_RECALLED_FACTS = 6;
const MAX_RECALLED_EPISODES = 2;
const day = (stamp) => new Date(stamp).toISOString().slice(0, 10);
const brief = (value, limit) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
function workspaceKey(value) {
  const folder = clean(value);
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(folder)
    ? path.win32
        .normalize(folder)
        .replace(/[\\/]+$/, "")
        .toLowerCase()
    : folder
      ? path.posix.normalize(folder).replace(/\/+$/, "") || "/"
      : "";
}
const parse = (value, fallback = {}) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
class MemoryService {
  constructor({ filename = ":memory:", embedding = null } = {}) {
    if (filename !== ":memory:")
      fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.embedding = embedding;
    this.semantic = new Map();
    this.indexedMessages = new Map();
    this.embeddingGeneration = 0;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aliases(path TEXT PRIMARY KEY,project_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,type TEXT NOT NULL,text TEXT NOT NULL,scope TEXT NOT NULL,project_id TEXT,workspace TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',semantic_key TEXT NOT NULL DEFAULT '',pinned INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,supersedes TEXT,embedding TEXT,embedding_model TEXT);
      CREATE INDEX IF NOT EXISTS records_scope ON records(project_id,status,type);
      CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(id UNINDEXED,text,tokenize='unicode61');
      CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN INSERT INTO records_fts(id,text) VALUES(new.id,new.text); END;
      CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN DELETE FROM records_fts WHERE id=old.id; END;
      CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE OF text ON records BEGIN DELETE FROM records_fts WHERE id=old.id; INSERT INTO records_fts(id,text) VALUES(new.id,new.text); END;
      CREATE TABLE IF NOT EXISTS suppressions(fingerprint TEXT NOT NULL,semantic_key TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(fingerprint,project_id));
      CREATE TABLE IF NOT EXISTS suppressed_sources(chat_id TEXT NOT NULL,message_id TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(chat_id,message_id,project_id));
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,workspace TEXT NOT NULL,updated_at INTEGER NOT NULL);
      DROP TABLE IF EXISTS working_state;
      CREATE TABLE IF NOT EXISTS extraction_jobs(id TEXT PRIMARY KEY,chat_id TEXT,workspace TEXT,payload TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,next_attempt INTEGER DEFAULT 0,error TEXT);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    `);
    if (!this.db.prepare('PRAGMA table_info(records)').all().some(column => column.name === 'recallable')) {
      this.db.exec("BEGIN; ALTER TABLE records ADD COLUMN recallable INTEGER NOT NULL DEFAULT 1; UPDATE records SET recallable=0,embedding=NULL,embedding_model=NULL WHERE type='history' AND (COALESCE(json_extract(source,'$.role'),'tool') NOT IN ('user','assistant') OR COALESCE(json_extract(source,'$.kind'),'') IN ('reasoning','analysis','plan','commentary') OR COALESCE(json_extract(source,'$.phase'),'') IN ('analysis','commentary')); COMMIT;");
    }
    // Quarantine exhausted jobs from older releases without replaying them.
    this.db.prepare("UPDATE extraction_jobs SET status='failed' WHERE status='pending' AND attempts>=?").run(MAX_EXTRACTION_ATTEMPTS);
    const savedEmbedding = this.db.prepare("SELECT value FROM settings WHERE key='embedding'").get();
    this.embedding = embedding || (savedEmbedding ? parse(savedEmbedding.value, null) : { ...BUNDLED_EMBEDDING });
    if (this.embedding?.provider === 'bundled') this.embedding = { ...BUNDLED_EMBEDDING };
    this.localEmbeddings = new LocalEmbeddings();
  }
  close() {
    this.localEmbeddings.close();
    this.db.close();
  }
  get enabled() {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key='enabled'").get()
        ?.value !== "false"
    );
  }
  set enabled(value) {
    if (this.enabled !== (value !== false)) this.embeddingGeneration++;
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES('enabled',?)")
      .run(String(value !== false));
  }
  registerProject(workspace, { id, name } = {}) {
    const folder = workspaceKey(workspace);
    if (!folder) return null;
    const existing = this.db
      .prepare("SELECT project_id FROM aliases WHERE path=?")
      .get(folder);
    if (existing && !id) return existing.project_id;
    const projectId = id || randomUUID();
    this.db
      .prepare("INSERT OR IGNORE INTO projects VALUES(?,?)")
      .run(
        projectId,
        name || path.basename(folder.replace(/\\/g, "/")) || folder,
      );
    this.addProjectAlias(projectId, workspace);
    return projectId;
  }
  addProjectAlias(id, workspace) {
    const folder = workspaceKey(workspace);
    if (!folder) throw new Error("A project alias needs a folder.");
    if (!this.db.prepare("SELECT id FROM projects WHERE id=?").get(id))
      throw new Error("Project not found.");
    const old = this.db
      .prepare("SELECT project_id FROM aliases WHERE path=?")
      .get(folder);
    if (old && old.project_id !== id) {
      this.db
        .prepare("UPDATE records SET project_id=? WHERE project_id=?")
        .run(id, old.project_id);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO suppressions SELECT fingerprint,semantic_key,? FROM suppressions WHERE project_id=?",
        )
        .run(id, old.project_id);
      this.db
        .prepare("DELETE FROM suppressions WHERE project_id=?")
        .run(old.project_id);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO suppressed_sources SELECT chat_id,message_id,? FROM suppressed_sources WHERE project_id=?",
        )
        .run(id, old.project_id);
      this.db
        .prepare("DELETE FROM suppressed_sources WHERE project_id=?")
        .run(old.project_id);
      this.db
        .prepare("UPDATE aliases SET project_id=? WHERE project_id=?")
        .run(id, old.project_id);
    }
    this.db
      .prepare("INSERT OR REPLACE INTO aliases VALUES(?,?)")
      .run(folder, id);
    return id;
  }
  decode(row) {
    return row
      ? {
          id: row.id,
          type: row.type,
          text: row.text,
          summary: row.type === "episode" ? row.text : undefined,
          scope: row.scope,
          projectId: row.project_id,
          workspace: row.workspace,
          status: row.status,
          key: row.semantic_key,
          pinned: !!row.pinned,
          source: parse(row.source),
          sources: this.sourceRefs(parse(row.source)),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          supersedes: row.supersedes,
        }
      : null;
  }
  get(id) {
    return this.decode(
      this.db.prepare("SELECT * FROM records WHERE id=?").get(id),
    );
  }
  save(input) {
    const previous =
      input.id || input.supersedesId
        ? this.get(input.id || input.supersedesId)
        : null;
    if ((input.id || input.supersedesId) && !previous)
      throw new Error("Memory record not found.");
    input = {
      ...previous,
      ...input,
      source: input.source || previous?.source || {},
    };
    const text = clean(input.text || input.summary);
    if (!text) throw new Error("Memory text cannot be empty.");
    const type = input.type || "fact",
      scope = input.scope || (input.workspace ? "workspace" : "global");
    if (
      ![
        "fact",
        "preference",
        "decision",
        "discovery",
        "issue",
        "procedure",
        "episode",
        "history",
      ].includes(type)
    )
      throw new Error("Unknown memory type.");
    if (!["global", "workspace"].includes(scope))
      throw new Error("Choose global or workspace scope.");
    const projectId =
      scope === "global"
        ? null
        : input.workspace
          ? this.registerProject(input.workspace)
          : input.projectId;
    if (scope === "workspace" && !projectId)
      throw new Error("Choose a working folder for project memory.");
    const semanticKey = key(input.key),
      fingerprint = hash(key(text));
    if (
      input.automatic &&
      this.db
        .prepare(
          "SELECT 1 FROM suppressions WHERE project_id=? AND (fingerprint=? OR (semantic_key<>'' AND semantic_key=?))",
        )
        .get(projectId || "", fingerprint, familyKey(semanticKey))
    )
      return null;
    if (
      input.automatic &&
      this.sourceRefs(input.source).some((ref) =>
        this.db
          .prepare(
            "SELECT 1 FROM suppressed_sources WHERE chat_id=? AND message_id=? AND project_id=?",
          )
          .get(ref.chatId || "", ref.messageId, projectId || ""),
      )
    )
      return null;
    const old =
      previous ||
      (familyKey(semanticKey)
        ? this.decode(
            this.db
              .prepare(
                "SELECT * FROM records WHERE semantic_key=? AND COALESCE(project_id,'')=? AND status='active' AND type NOT IN ('history','episode') ORDER BY updated_at DESC LIMIT 1",
              )
              .get(semanticKey, projectId || ""),
          )
        : null);
    if (old && old.status === "forgotten" && input.automatic) return null;
    const stamp = Date.now();
    if (old && old.text === text) {
      this.db
        .prepare(
          "UPDATE records SET type=?,scope=?,project_id=?,workspace=?,semantic_key=?,pinned=?,source=?,updated_at=? WHERE id=?",
        )
        .run(
          type,
          scope,
          projectId,
          clean(input.workspace),
          semanticKey,
          input.pinned ? 1 : 0,
          JSON.stringify(input.source),
          stamp,
          old.id,
        );
      return this.get(old.id);
    }
    const duplicate =
      !previous &&
      !["episode", "history"].includes(type) &&
      this.decode(
        this.db
          .prepare(
            "SELECT * FROM records WHERE text=? AND type=? AND COALESCE(project_id,'')=? AND status='active'",
          )
          .get(text, type, projectId || ""),
      );
    if (duplicate) return duplicate;
    let replaced = old;
    if (input.automatic && !old && !["episode", "history"].includes(type)) {
      const near = this.nearDuplicate(text, projectId);
      if (near?.covered) return null;
      if (near) replaced = near.record;
    }
    const id = randomUUID();
    this.db.exec("BEGIN");
    try {
      if (replaced)
        this.db
          .prepare(
            "UPDATE records SET status='superseded',updated_at=? WHERE id=?",
          )
          .run(stamp, replaced.id);
      this.db
        .prepare(
          "INSERT INTO records(id,type,text,scope,project_id,workspace,semantic_key,pinned,source,created_at,updated_at,supersedes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          type,
          text,
          scope,
          projectId,
          clean(input.workspace),
          semanticKey,
          input.pinned ? 1 : 0,
          JSON.stringify(input.source),
          stamp,
          stamp,
          replaced?.id || null,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(id);
  }
  // A learned memory with no word that a kept one lacks adds nothing (covered); one with every word of a kept one and
  // more replaces it. Models rephrase and invent new keys, so an exact comparison misses these. It has to be strict:
  // one different word can be the whole correction, and a duplicate that stays only waits for the nightly tidy.
  nearDuplicate(text, projectId) {
    const words = wordsOf(text);
    if (words.size < 3) return null;
    const rows = this.db
      .prepare(
        "SELECT * FROM records WHERE status='active' AND pinned=0 AND type NOT IN ('history','episode') AND COALESCE(project_id,'') IN ('',?) ORDER BY updated_at DESC LIMIT 1000",
      )
      .all(projectId || "");
    const negated = (set) => [...set].some((word) => NEGATIONS.has(word));
    for (const row of rows) {
      const other = wordsOf(row.text);
      if (other.size < 3 || negated(words) !== negated(other)) continue;
      const shared = [...words].filter((word) => other.has(word)).length;
      if (shared === words.size) return { covered: true, record: this.decode(row) };
      if (shared === other.size && (row.project_id || "") === (projectId || "")) return { covered: false, record: this.decode(row) };
    }
    return null;
  }
  // Recall shows the first characters of an id; the memory tools take those or the whole id.
  resolveId(id) {
    const value = clean(id);
    if (!/^[0-9a-f-]{6,35}$/i.test(value)) return value;
    const rows = this.db.prepare("SELECT id FROM records WHERE id LIKE ? AND type<>'history' LIMIT 2").all(`${value}%`);
    return rows.length === 1 ? rows[0].id : value;
  }
  // Only what Little Bot learned by itself may be tidied. The user's pins and "remember that"s stay as written.
  learned(id) {
    const record = this.get(id);
    return record?.status === "active" && !record.pinned && ["Automatic extraction", "Dream"].includes(record.source?.label) ? record : null;
  }
  // Several overlapping memories become one.
  mergeLearned(ids, { text, chatId } = {}) {
    const records = [...new Set(ids)].map((id) => this.learned(id));
    if (records.length < 2 || records.some((record) => !record) || new Set(records.map((record) => record.projectId || "")).size > 1) return null;
    const [first, ...others] = records;
    const merged = this.save({ text, type: first.type, scope: first.scope, projectId: first.projectId, workspace: first.workspace, key: first.key, supersedesId: first.id,
      automatic: true, source: { chatId, messageIds: records.flatMap((record) => record.sources.map((source) => source.messageId)), label: "Dream", merged: records.map((record) => record.id) } });
    if (!merged) return null;
    const stamp = Date.now();
    for (const record of others) this.db.prepare("UPDATE records SET status='superseded',updated_at=? WHERE id=?").run(stamp, record.id);
    return merged;
  }
  // No longer true or finished. It leaves recall but stays findable, and may be learned again if it becomes true.
  retireLearned(id) {
    if (!this.learned(id)) return false;
    this.db.prepare("UPDATE records SET status='superseded',updated_at=? WHERE id=?").run(Date.now(), id);
    return true;
  }
  forget(id) {
    const record = this.get(id);
    if (!record) return false;
    const ids = new Set([id]),
      pending = [record];
    // Forget the full correction family, including edits without a semantic key.
    while (pending.length) {
      const current = pending.pop();
      const related = this.db
        .prepare(
          "SELECT * FROM records WHERE id=? OR supersedes=? OR (semantic_key<>'' AND semantic_key=? AND COALESCE(project_id,'')=?)",
        )
        .all(
          current.supersedes || "",
          current.id,
          familyKey(current.key || ""),
          current.projectId || "",
        );
      for (const row of related)
        if (!ids.has(row.id)) {
          ids.add(row.id);
          pending.push(this.decode(row));
        }
    }
    this.db.exec("BEGIN");
    try {
      for (const target of ids) {
        const item = this.get(target);
        this.db
          .prepare("INSERT OR REPLACE INTO suppressions VALUES(?,?,?)")
          .run(hash(key(item.text)), familyKey(item.key || ""), item.projectId || "");
        for (const source of item.sources)
          this.db
            .prepare("INSERT OR IGNORE INTO suppressed_sources VALUES(?,?,?)")
            .run(source.chatId || "", source.messageId, item.projectId || "");
        this.db
          .prepare(
            "UPDATE records SET status='forgotten',embedding=NULL WHERE id=?",
          )
          .run(target);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }
  pin(id, pinned = true) {
    this.db
      .prepare("UPDATE records SET pinned=? WHERE id=?")
      .run(pinned ? 1 : 0, id);
    return this.get(id);
  }
  clearEpisodes() {
    return Number(
      this.db.prepare("DELETE FROM records WHERE type='episode'").run().changes,
    );
  }
  snapshot() {
    const rows = this.db
      .prepare(
        "SELECT * FROM records WHERE status='active' AND type<>'history' ORDER BY pinned DESC,updated_at DESC LIMIT 100",
      )
      .all()
      .map((row) => this.decode(row));
    return {
      enabled: this.enabled,
      records: rows.slice(0, 100),
      embedding: this.embedding
        ? { provider: this.embedding.provider || 'remote', baseUrl: this.embedding.baseUrl, model: this.embedding.model }
        : null,
      facts: rows.filter((row) => row.type !== "episode"),
      episodes: rows.filter((row) => row.type === "episode"),
      projects: this.db
        .prepare(
          "SELECT p.id,p.name,a.path AS workspace,a.path FROM projects p JOIN aliases a ON p.id=a.project_id",
        )
        .all()
        .map((row) => ({ ...row })),
      stats: {
        records: this.db
          .prepare(
            "SELECT type,status,COUNT(*) AS count FROM records WHERE recallable=1 GROUP BY type,status",
          )
          .all()
          .map((row) => ({ ...row })),
        embeddingCount: Number(
          this.db
            .prepare(
              "SELECT COUNT(*) AS count FROM records WHERE embedding IS NOT NULL AND recallable=1 AND status='active' AND embedding_model=?",
            )
            .get(this.embeddingIdentity()).count,
        ),
        archivedTraceCount: Number(this.db.prepare("SELECT COUNT(*) AS count FROM records WHERE recallable=0").get().count),
        embeddingError: this.embeddingError || null,
      },
    };
  }
  indexChat(chat) {
    if (!this.enabled || !chat?.id || chat.private) return;
    this.db
      .prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?,?)")
      .run(
        chat.id,
        clean(chat.title) || "Conversation",
        clean(chat.workspace),
        Date.now(),
      );
    let chunkOffset = 0;
    for (const [index, message] of (chat.messages || []).entries()) {
      const content = clean(message.text || message.output || message.content);
      if (!content) continue;
      const messageId = message.id || `message-${index}`;
      const id = `history:${chat.id}:${messageId}`;
      const source = JSON.stringify({
        sessionId: chat.id,
        messageId,
        role: message.role || "tool",
        kind: message.kind || "",
        phase: message.phase || "",
        ...(message.automationId ? { automationId: message.automationId, automationName: message.automationName || "Scheduled task" } : {}),
        workspace: message.workspace || chat.workspace,
        model: message.model || chat.model,
        connection: message.connection || chat.connection,
        index,
        chunkOffset,
      });
      chunkOffset += Math.max(1, Math.ceil(content.length / 1800));
      const fingerprint = hash(content + source);
      if (this.indexedMessages.get(id) === fingerprint) continue;
      const projectId = this.registerProject(
          message.workspace || chat.workspace,
        ),
        stamp = message.updatedAt || message.createdAt || Date.now();
      this.db
        .prepare(
          `INSERT INTO records(id,type,text,scope,project_id,workspace,source,created_at,updated_at) VALUES(?,'history',?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,source=excluded.source,project_id=excluded.project_id,workspace=excluded.workspace,updated_at=excluded.updated_at,embedding=NULL WHERE records.text<>excluded.text OR records.source<>excluded.source`,
        )
        .run(
          id,
          content,
          projectId ? "workspace" : "global",
          projectId,
          clean(message.workspace || chat.workspace),
          source,
          stamp,
          stamp,
        );
      const recallable = ['user', 'assistant'].includes(message.role)
        && !['reasoning', 'analysis', 'plan', 'commentary', 'automation', 'memory'].includes(message.kind)
        && !['analysis', 'commentary'].includes(message.phase);
      this.db.prepare('UPDATE records SET recallable=?,embedding=CASE WHEN ? THEN embedding ELSE NULL END WHERE id=?').run(Number(recallable), Number(recallable), id);
      this.indexedMessages.set(id, fingerprint);
    }
  }
  captureTurn(chat) {
    this.indexChat(chat);
    if (
      !this.enabled ||
      chat?.private ||
      ["running", "waiting"].includes(chat?.status)
    )
      return null;
    const messages = chat.messages || [];
    let index = messages.findIndex((message) => message.id === chat.lastTurnRequestId);
    if (index < 0) {
      index = messages.length - 1;
      while (index >= 0 && messages[index].role !== "user") index--;
    }
    if (index < 0) return null;
    if (!significantTerms(messages[index].text).length) return null;
    const answer = messages
      .slice(index + 1)
      .filter(
        (m) =>
          m.role === "assistant" &&
          !["analysis", "reasoning", "plan", "commentary", "question"].includes(m.kind) &&
          !["analysis", "commentary"].includes(m.phase),
      )
      .map((m) => clean(m.text))
      .filter(Boolean)
      .join("\n");
    if (!answer) return null;
    const source = {
      sessionId: chat.id,
      messageId: messages[index].id || `message-${index}`,
      role: "episode",
    };
    const episodeKey = `turn:${chat.id}:${source.messageId}`;
    const existing = this.db
      .prepare("SELECT id FROM records WHERE semantic_key=? AND type='episode'")
      .get(episodeKey);
    if (existing) return this.get(existing.id);
    return this.save({
      type: "episode",
      text: `${messages[index].automationId ? "Scheduled task (" + (messages[index].automationName || messages[index].automationId) + ")" : "Request"}: ${brief(messages.slice(index).filter((message) => message.role === "user").map((message) => clean(message.text)).join("\nClarification: "), 1500)}\nOutcome: ${brief(answer, 3000)}`,
      workspace: messages[index].workspace || chat.workspace,
      key: episodeKey,
      source,
    });
  }
  indexGoal(goal) {
    if (!this.enabled || !goal?.id) return;
    const records = [];
    for (const kind of ["observations", "decisions", "assumptions"])
      for (const entry of goal.ledger?.[kind] || []) {
        records.push({
          id: `${kind}:${entry.id || hash(JSON.stringify(entry))}`,
          role: "tool",
          kind: "goal-ledger",
          text: JSON.stringify({
            goalId: goal.id,
            objective: goal.objective,
            kind,
            ...entry,
          }),
          workspace: goal.workspace,
        });
      }
    if (records.length)
      this.indexChat({
        id: `goal:${goal.id}`,
        title: goal.title || goal.objective,
        workspace: goal.workspace,
        messages: records,
      });
  }
  // A deleted session leaves no searchable trace: its source history, work episodes, title and working state go.
  // Knowledge already learned from it stays, like any memory, and can be forgotten on its own.
  forgetSession(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return 0;
    const removed = this.db.prepare("DELETE FROM records WHERE type IN ('history','episode') AND json_extract(source,'$.sessionId')=?").run(sessionId).changes;
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
    this.db.prepare("DELETE FROM extraction_jobs WHERE chat_id=? AND status IN ('pending','failed')").run(sessionId);
    for (const key of [...this.indexedMessages.keys()]) if (key.startsWith(`history:${sessionId}:`)) this.indexedMessages.delete(key);
    return removed;
  }
  // Cosine similarity of a stored vector with the query's. Parsed vectors are kept between searches (until
  // the stored text changes): parsing every one on each message took seconds once a long history was indexed.
  similarity(row, query, queryNorm) {
    this.vectors ||= new Map();
    let cached = this.vectors.get(row.id);
    if (!cached || cached.raw !== row.embedding) {
      const vector = parse(row.embedding, []);
      let norm = 0;
      for (const value of vector) norm += value * value;
      cached = { raw: row.embedding, vector, norm: Math.sqrt(norm) };
      this.vectors.delete(row.id);
      this.vectors.set(row.id, cached);
      if (this.vectors.size > 30000) this.vectors.delete(this.vectors.keys().next().value);
    }
    if (cached.vector.length !== query.length) return -1;
    let dot = 0;
    for (let i = 0; i < query.length; i++) dot += cached.vector[i] * query[i];
    return dot / (cached.norm * queryNorm || 1);
  }
  search({
    query = "",
    source = "all",
    scope = "workspace",
    workspace = "",
    limit = 10,
    offset = 0,
    includeSuperseded = false,
  } = {}) {
    const projectId = this.db
      .prepare("SELECT project_id FROM aliases WHERE path=?")
      .get(workspaceKey(workspace))?.project_id;
    const where = [
        includeSuperseded ? "r.status<>'forgotten'" : "r.status='active'",
        "r.recallable=1",
      ],
      params = [];
    if (scope !== "all") {
      where.push("(r.scope='global' OR r.project_id=?)");
      params.push(projectId || "");
    }
    if (source === "facts") where.push("r.type NOT IN ('episode','history')");
    else if (source === "episodes") where.push("r.type='episode'");
    else if (source === "sessions") where.push("r.type='history'");
    else if (source !== "all") {
      where.push("r.type=?");
      params.push(source);
    }
    // Common words only slow the search and match everything. A query of nothing else still looks for them.
    const significant = significantTerms(query);
    const terms = (significant.length ? significant : tokens(query)).slice(0, 32);
    let rows;
    if (terms.length) {
      const fts = terms
        .map((term) => '"' + term.replace(/"/g, '""') + '"')
        .join(" OR ");
      rows = this.db
        .prepare(
          `SELECT r.*,bm25(records_fts) AS rank FROM records_fts JOIN records r ON r.id=records_fts.id WHERE records_fts MATCH ? AND ${where.join(" AND ")} ORDER BY rank LIMIT ?`,
        )
        .all(fts, ...params, Math.max(300, (offset + limit) * 3));
    } else
      rows = this.db
        .prepare(
          `SELECT r.*,0 AS rank FROM records r WHERE ${where.join(" AND ")} ORDER BY r.pinned DESC,r.updated_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, Math.max(1, limit) + 1, offset);
    const lexicalIds = new Set(rows.map(row => row.id));
    const semantic = this.semantic.get(key(query));
    const queryNorm = semantic ? Math.sqrt(semantic.reduce((sum, value) => sum + value * value, 0)) : 0;
    if (terms.length && semantic) {
      // Every vector is compared, but whole records are read only for the closest ones.
      const seen = new Set(rows.map((r) => r.id));
      const closest = this.db
        .prepare(
          `SELECT r.id,r.embedding FROM records r WHERE r.embedding IS NOT NULL AND r.embedding_model=? AND ${where.join(" AND ")}`,
        )
        .all(this.embeddingIdentity(), ...params)
        .filter((row) => !seen.has(row.id))
        .map((row) => ({ id: row.id, similarity: this.similarity(row, semantic, queryNorm) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, Math.max(100, (offset + limit) * 5));
      for (let index = 0; index < closest.length; index += 500) {
        const ids = closest.slice(index, index + 500).map((item) => item.id);
        rows.push(...this.db.prepare(`SELECT r.*,0 AS rank FROM records r WHERE r.id IN (${ids.map(() => "?").join(",")})`).all(...ids));
      }
    }
    rows = rows.map((row) => {
      let score = 0;
      let similarity = -1;
      let matched = 0;
      if (terms.length) {
        const words = new Set(tokens(row.text));
        matched = terms.filter((term) => words.has(term)).length;
        score = -Number(row.rank || 0);
        if (key(row.text).includes(key(query))) score += 3;
        score += matched / terms.length;
        if (semantic && row.embedding) {
          similarity = this.similarity(row, semantic, queryNorm);
          if (similarity > -1) score += 2 * similarity;
        }
      }
      const minimumSimilarity = this.embedding?.provider === 'bundled' ? embeddingManifest.minimumSimilarity : 0.3;
      return { ...this.decode(row), score, similarity, matched, termCount: terms.length, relevant: !terms.length || lexicalIds.has(row.id) || similarity >= minimumSimilarity };
    }).filter(row => row.relevant);
    if (terms.length)
      rows.sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.pinned) - Number(a.pinned) ||
          b.updatedAt - a.updatedAt,
      );
    const start = terms.length ? offset : 0,
      selected = rows.slice(start, start + limit);
    return {
      query,
      source,
      scope,
      results: selected.map((record) => ({
        ...record,
        sourceRef: record.source,
        source:
          record.type === "history"
            ? "session"
            : record.type === "episode"
              ? "episode"
              : "fact",
        sessionId: record.source.sessionId || record.source.chatId,
        messageId: record.source.messageId || record.source.messageIds?.[0],
        offset: record.source.chunkOffset,
        excerpt: record.text.slice(0, 1600),
        date: new Date(record.updatedAt).toISOString(),
      })),
      nextOffset: rows.length > start + limit ? offset + limit : null,
    };
  }
  readSession({ sessionId, messageId, offset = 0, limit = 10 } = {}) {
    const session = this.db
      .prepare("SELECT * FROM sessions WHERE id=?")
      .get(sessionId);
    if (!session) throw new Error("Conversation not found.");
    const rows = this.db
      .prepare(
        "SELECT * FROM records WHERE type='history' AND status='active' AND json_extract(source,'$.sessionId')=? ORDER BY CAST(json_extract(source,'$.index') AS INTEGER)",
      )
      .all(sessionId);
    const chunks = [];
    for (const row of rows) {
      const source = parse(row.source);
      for (let start = 0; start < row.text.length; start += 1800)
        chunks.push({
          id: source.messageId,
          role: source.role,
          kind: source.kind,
          text: row.text.slice(start, start + 1800),
          offset: chunks.length,
        });
    }
    const relativeOffset = offset;
    if (messageId) {
      const start = chunks.findIndex((chunk) => chunk.id === messageId);
      if (start < 0) throw new Error("Source message not found.");
      offset = start + offset;
    }
    return {
      session: { ...session },
      messages: chunks.slice(offset, offset + limit),
      nextOffset:
        chunks.length > offset + limit ? relativeOffset + limit : null,
    };
  }
  // What a request gets without asking: preferences and pins, then only what clearly relates to this message, each once
  // per context (`seen` holds the ids it already has, and takes the new ones). memory_search finds everything else.
  buildContext({ workspace, query, budget = 4000, sessionId, seen = new Set(), since = 0 } = {}) {
    if (!this.enabled) return "";
    const projectId = this.db
      .prepare("SELECT project_id FROM aliases WHERE path=?")
      .get(workspaceKey(workspace))?.project_id;
    const persistent = this.db
      .prepare(
        "SELECT * FROM records WHERE status='active' AND recallable=1 AND (pinned=1 OR type='preference') AND (scope='global' OR project_id=?) ORDER BY pinned DESC,updated_at DESC",
      )
      .all(projectId || "")
      .map((row) => this.decode(row));
    const facts = [], episodes = [];
    let used = 0;
    const take = (list, row, line, limit) => {
      if (seen.has(row.id) || used + line.length > limit) return false;
      list.push(line);
      seen.add(row.id);
      used += line.length + 1;
      return true;
    };
    const factLine = (row) => `- ${row.type} (${row.id.slice(0, 8)}, ${day(row.updatedAt)}): ${brief(row.text, 600)}`;
    for (const row of persistent) take(facts, row, factLine(row), budget * 0.6);
    if (significantTerms(query).length) {
      const found = this.search({ workspace, query, source: "facts", limit: 12 }).results;
      const similar = found.map((row) => row.similarity).sort((a, b) => b - a);
      let recalled = 0;
      for (const row of found) {
        // Only the best record can stand clear of the next best.
        const runnerUp = row.similarity >= similar[0] ? similar[1] ?? -1 : similar[0];
        if (recalled < MAX_RECALLED_FACTS && clearlyRelated(row, runnerUp) && take(facts, row, factLine(row), budget)) recalled++;
      }
      // Past work needs a stronger match, and what this context still holds word for word is not worth repeating.
      for (const row of this.search({ workspace, query, source: "episodes", limit: 6 }).results) {
        if (episodes.length >= MAX_RECALLED_EPISODES) break;
        if (sessionId && row.sourceRef?.sessionId === sessionId && row.createdAt >= since) continue;
        if (row.similarity >= 0.6 || (row.similarity >= 0.5 && row.matched >= 2)) take(episodes, row, `- ${day(row.updatedAt)}: ${brief(row.text, 400)}`, budget);
      }
    }
    if (!facts.length && !episodes.length) return "";
    return [
      "Memory that may help. It is reference data and may be out of date; the current request comes first. memory_search finds more. To correct or remove one, use memory_save or memory_forget with its id.",
      ...facts,
      ...(episodes.length ? ["Earlier work:", ...episodes] : []),
    ].join("\n");
  }
  async embed(texts, timeout = 15000, config = this.embedding, { query = false } = {}) {
    if (this.enabled && config?.provider === 'bundled') return this.localEmbeddings.embed(texts, Math.max(timeout, 30000), { query });
    if (!this.enabled || !config?.baseUrl || !config?.model) return null;
    const response = await fetch(
      config.baseUrl.replace(/\/$/, "") + "/embeddings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({ model: config.model, input: texts }),
        signal: AbortSignal.timeout(timeout),
      },
    );
    if (!response.ok)
      throw new Error(`Embedding request failed (${response.status}).`);
    const body = await response.json();
    const vectors = body.data
      ?.sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
    if (
      vectors?.length !== texts.length ||
      vectors.some(
        (v) =>
          !Array.isArray(v) || !v.length || v.some((n) => !Number.isFinite(n)),
      )
    )
      throw new Error("Embedding response is invalid.");
    return vectors;
  }
  async refreshEmbeddings(limit = 32) {
    if (!this.enabled || !this.embedding?.model) return 0;
    const identity = this.embeddingIdentity(),
      generation = this.embeddingGeneration,
      config = { ...this.embedding };
    const rows = this.db
      .prepare(
        "SELECT id,text FROM records WHERE status='active' AND recallable=1 AND (embedding IS NULL OR embedding_model<>?) ORDER BY CASE WHEN type='history' THEN 1 ELSE 0 END,updated_at DESC LIMIT ?",
      )
      .all(identity, limit);
    if (!rows.length) return 0;
    const vectors = await this.embed(
      rows.map((row) => row.text),
      15000,
      config,
    );
    if (
      !vectors ||
      !this.enabled ||
      generation !== this.embeddingGeneration ||
      identity !== this.embeddingIdentity()
    )
      return 0;
    let updated = 0;
    this.embeddingError = null;
    for (const [index, row] of rows.entries())
      updated += Number(
        this.db
          .prepare(
            "UPDATE records SET embedding=?,embedding_model=? WHERE id=? AND text=? AND status='active'",
          )
          .run(JSON.stringify(vectors[index].map((value) => Math.round(value * 1e5) / 1e5)), identity, row.id, row.text)
          .changes,
      );
    return updated;
  }
  async prepareQuery(query) {
    if (!this.enabled || !clean(query) || !this.embedding?.model) return false;
    const identity = this.embeddingIdentity(),
      generation = this.embeddingGeneration,
      config = { ...this.embedding };
    if (this.semantic.has(key(query))) return true;
    try {
      const vectors = await this.embed([query], 3000, config, { query: true });
      if (
        !vectors ||
        !this.enabled ||
        generation !== this.embeddingGeneration ||
        identity !== this.embeddingIdentity()
      )
        return false;
      this.semantic.set(key(query), vectors[0]);
      if (this.semantic.size > 100)
        this.semantic.delete(this.semantic.keys().next().value);
      this.embeddingError = null;
      return true;
    } catch (error) {
      if (generation === this.embeddingGeneration)
        this.embeddingError = error.message;
      return false;
    }
  }
  embeddingIdentity() {
    if (this.embedding?.provider === 'bundled') return BUNDLED_EMBEDDING.model;
    return this.embedding
      ? hash(
          this.embedding.baseUrl.replace(/\/$/, "") +
            "|" +
            this.embedding.model,
        )
      : "";
  }
  configureEmbedding(config) {
    const sameEndpoint =
      clean(config?.baseUrl).replace(/\/$/, "") ===
      this.embedding?.baseUrl?.replace(/\/$/, "");
    const existingKey = sameEndpoint ? this.embedding?.apiKey || "" : "";
    this.embeddingGeneration++;
    this.embedding = config?.provider === 'bundled' ? { ...BUNDLED_EMBEDDING } :
      config?.baseUrl && config?.model
        ? {
            baseUrl: clean(config.baseUrl),
            model: clean(config.model),
            apiKey: config.clearApiKey
              ? ""
              : clean(config.apiKey) || existingKey,
          }
        : null;
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES('embedding',?)")
      .run(JSON.stringify(this.embedding));
    this.semantic.clear();
    this.embeddingError = null;
    this.localEmbeddings.close();
    return this.embedding;
  }
  sourceRefs(source) {
    const ids =
      source.messageIds ||
      source.sourceIds ||
      (source.messageId ? [source.messageId] : []);
    return ids.map((messageId) => ({
      chatId: source.chatId || source.sessionId,
      messageId,
      label: source.label || source.role || "Source",
    }));
  }
  sources(id) {
    const record = this.get(id);
    if (!record) return [];
    return record.sources.map((ref) => {
      const row = this.db
        .prepare(
          "SELECT text FROM records WHERE type='history' AND json_extract(source,'$.sessionId')=? AND json_extract(source,'$.messageId')=?",
        )
        .get(ref.chatId || "", ref.messageId);
      return { ...ref, text: row?.text || "" };
    });
  }
  enqueueExtraction(chat) {
    if (
      !this.enabled ||
      !chat?.id ||
      chat.private ||
      ["running", "waiting"].includes(chat.status)
    )
      return null;
    const messages = chat.messages || [];
    let start = messages.findIndex((message) => message.id === chat.lastTurnRequestId);
    if (start < 0) {
      start = messages.length - 1;
      while (start >= 0 && messages[start].role !== "user") start--;
    }
    if (start < 0 || messages[start].automationId || ["automation", "goal-step"].includes(messages[start].kind)) return null;
    // "ok thanks" has nothing to teach, and asking the model to confirm that costs it a whole request.
    if (!significantTerms(messages.slice(start).filter((message) => message.role === "user").map((message) => clean(message.text)).join(" ")).length) return null;
    const items = messages
      .slice(start)
      .map((m, i) => ({
        id: m.id || `message-${start + i}`,
        role: m.role || "tool",
        kind: m.kind || "",
        text: clean(m.text || m.output || m.content),
      }))
      .filter((m) => m.text);
    if (items.length < 2) return null;
    const id = `extraction:${chat.id}:${items[0].id}`;
    const job = {
      id,
      chatId: chat.id,
      workspace: messages[start].workspace || chat.workspace || "",
      messages: items,
      sourceIds: items.map((m) => m.id),
    };
    this.db
      .prepare(
        "INSERT OR IGNORE INTO extraction_jobs(id,chat_id,workspace,payload) VALUES(?,?,?,?)",
      )
      .run(id, chat.id, chat.workspace || "", JSON.stringify(job));
    return job;
  }
  pendingExtractions(limit = 1) {
    return this.db
      .prepare(
        "SELECT * FROM extraction_jobs WHERE status='pending' AND attempts<? AND next_attempt<=? ORDER BY rowid LIMIT ?",
      )
      .all(MAX_EXTRACTION_ATTEMPTS, Date.now(), limit)
      .map((row) => ({
        ...parse(row.payload),
        attempts: row.attempts,
        error: row.error,
      }));
  }
  completeExtraction(id, candidates) {
    const row = this.db
      .prepare("SELECT * FROM extraction_jobs WHERE id=?")
      .get(id);
    if (!row || row.status === "complete") return [];
    const job = parse(row.payload),
      valid = new Set(job.sourceIds);
    const records = [];
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const sourceIds = (candidate.sourceIds || []).filter((value) =>
        valid.has(value),
      );
      if (!sourceIds.length) continue;
      const old = candidate.supersedesId
        ? this.get(candidate.supersedesId)
        : null;
      if (candidate.supersedesId && (!old || old.status !== "active")) continue;
      const record = this.save({
        ...candidate,
        workspace: job.workspace,
        automatic: true,
        source: {
          chatId: job.chatId,
          messageIds: sourceIds,
          label: "Automatic extraction",
        },
      });
      if (record) records.push(record);
    }
    this.db
      .prepare(
        "UPDATE extraction_jobs SET status='complete',error=NULL WHERE id=?",
      )
      .run(id);
    return records;
  }
  failExtraction(id, error) {
    const row = this.db.prepare("SELECT attempts,status FROM extraction_jobs WHERE id=?").get(id);
    if (!row || row.status !== 'pending') return;
    const attempts = row.attempts + 1;
    this.db
      .prepare(
        "UPDATE extraction_jobs SET attempts=?,status=?,next_attempt=?,error=? WHERE id=?",
      )
      .run(attempts, attempts >= MAX_EXTRACTION_ATTEMPTS ? 'failed' : 'pending',
        Date.now() + 60000 * 2 ** (attempts - 1), String(error?.message || error).slice(0, 2000), id);
  }
  failedExtractions() {
    return this.db.prepare("SELECT id,chat_id AS chatId,attempts,error FROM extraction_jobs WHERE status='failed' ORDER BY rowid LIMIT 100").all();
  }
  retryExtraction(id) {
    const result = this.db.prepare("UPDATE extraction_jobs SET status='pending',attempts=0,next_attempt=0,error=NULL WHERE id=? AND status='failed'").run(id);
    if (!result.changes) throw new Error('Choose a failed memory learning job.');
  }
  discardExtraction(id) {
    // Keep the identifier so indexing the same completed turn cannot resurrect it.
    const result = this.db.prepare("UPDATE extraction_jobs SET status='discarded' WHERE id=? AND status='failed'").run(id);
    if (!result.changes) throw new Error('Choose a failed memory learning job.');
  }
}
module.exports = { MemoryService, workspaceKey, significantTerms, MAX_EXTRACTION_ATTEMPTS };
