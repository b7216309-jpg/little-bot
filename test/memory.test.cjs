"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { MemoryService } = require("../src/memory-service.cjs");
const {
  defaultMemory,
  attachMemoryService,
  captureEpisode,
  buildMemoryContext,
  saveFact,
  deleteFact,
} = require("../src/memory.cjs");
const { recallSearch, recallRead } = require("../src/recall.cjs");
const folder = "C:\\Projects\\Alpha";
function engine(t, options) {
  const result = new MemoryService(options);
  t.after(() => result.close());
  return result;
}
function chat(extra = {}) {
  return {
    id: "one",
    workspace: folder,
    status: "idle",
    messages: [
      {
        id: "u1",
        role: "user",
        text: "Fix the redirect loop.",
        workspace: folder,
      },
      {
        id: "tool1",
        role: "tool",
        kind: "command",
        text: "Token secret=abc and redirect test passed.",
        workspace: folder,
      },
      {
        id: "a1",
        role: "assistant",
        text: "Fixed the redirect with an event-loop yielding operation.",
        status: "completed",
        workspace: folder,
      },
    ],
    ...extra,
  };
}
test("SQLite memory retains unlimited long records and survives restart without redaction", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "little-memory-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "memory.sqlite");
  let memory = new MemoryService({ filename });
  for (let i = 0; i < 151; i++)
    memory.save({
      text: `Fact ${i}: secret=abc ${"z".repeat(1100)}`,
      scope: "global",
    });
  memory.close();
  memory = new MemoryService({ filename });
  assert.equal(memory.snapshot().records.length, 100);
  assert.equal(
    memory.search({ query: "Fact", scope: "all", limit: 200 }).results.length,
    151,
  );
  assert.ok(
    memory
      .search({ query: "secret", scope: "all", limit: 200 })
      .results[0].text.includes("secret=abc"),
  );
  memory.close();
});
test("corrections preserve source-linked superseded history and forget blocks extraction resurrection", (t) => {
  const m = engine(t);
  const first = m.save({
    text: "Use npm",
    key: "package-manager",
    workspace: folder,
    source: { sessionId: "one", messageId: "u1" },
  });
  const second = m.save({
    text: "Use pnpm",
    key: "package-manager",
    workspace: folder,
  });
  assert.equal(second.supersedes, first.id);
  assert.equal(m.get(first.id).status, "superseded");
  assert.equal(m.search({ query: "npm", workspace: folder }).results.length, 0);
  assert.equal(
    m.search({ query: "npm", workspace: folder, includeSuperseded: true })
      .results.length,
    1,
  );
  m.forget(second.id);
  assert.equal(
    m.save({
      text: "We now use pnpm",
      key: "package-manager",
      workspace: folder,
      automatic: true,
    }),
    null,
  );
  assert.equal(
    m.search({ query: "pnpm", workspace: folder, includeSuperseded: true })
      .results.length,
    0,
  );
});
test("project aliases reconnect knowledge while different projects remain scoped", (t) => {
  const m = engine(t);
  m.save({ text: "Use pnpm", workspace: folder });
  m.save({ text: "Use yarn", workspace: "C:/other" });
  const id = m.registerProject(folder);
  m.addProjectAlias(id, "D:/moved/Alpha");
  assert.equal(
    m.search({ query: "pnpm", workspace: "D:/moved/Alpha" }).results.length,
    1,
  );
  assert.equal(
    m.search({ query: "yarn", workspace: folder }).results.length,
    0,
  );
  assert.equal(
    m.search({ query: "yarn", workspace: folder, scope: "all" }).results.length,
    1,
  );
});
test("tool traces stay readable but are excluded from recall across model switches", (t) => {
  const m = engine(t);
  const c = chat();
  m.indexChat(c);
  c.workspace = "D:/other";
  c.model = "new-model";
  c.messages.push({
    id: "u2",
    role: "user",
    workspace: c.workspace,
    text: "Other folder task",
  });
  m.indexChat(c);
  assert.equal(
    m.search({ query: "secret", workspace: folder, source: "sessions" }).results
      .length,
    0,
  );
  assert.equal(
    m.search({ query: "secret", workspace: c.workspace, source: "sessions" })
      .results.length,
    0,
  );
  assert.equal(
    m.readSession({ sessionId: "one", limit: 20 }).messages.length,
    4,
  );
  assert.ok(
    m
      .readSession({ sessionId: "one" })
      .messages.some((row) => row.role === "tool"),
  );
});
test("episodes are per-turn and idempotent; extraction jobs recover after restart", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "little-jobs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "memory.sqlite");
  let m = new MemoryService({ filename });
  const c = chat();
  m.captureTurn(c);
  m.captureTurn(c);
  const job = m.enqueueExtraction(c);
  m.close();
  m = new MemoryService({ filename });
  assert.equal(m.pendingExtractions()[0].id, job.id);
  assert.equal(
    m.completeExtraction(job.id, [
      {
        text: "Use yielding to fix redirect loops",
        type: "procedure",
        scope: "workspace",
        sourceIds: ["tool1"],
      },
      { text: "Invented", sourceIds: ["missing"] },
    ]).length,
    1,
  );
  assert.equal(m.pendingExtractions().length, 0);
  c.messages.push(
    { id: "u2", role: "user", text: "Continue" },
    { id: "a2", role: "assistant", text: "Validated the fix" },
  );
  m.captureTurn(c);
  assert.equal(m.snapshot().episodes.length, 2);
  const item = m.search({
    query: "yielding",
    source: "procedure",
    workspace: folder,
  }).results[0];
  assert.equal(m.sources(item.id)[0].text, c.messages[1].text);
  m.close();
});
test("context includes pinned preferences, current state and relevant source IDs without unrelated facts", (t) => {
  const m = engine(t);
  const preference = m.save({
    text: "Use concise English",
    type: "preference",
    scope: "global",
  });
  m.save({ text: "Bananas belong in the kitchen", scope: "global" });
  m.setWorkingState("one", { objective: "Fix login", nextStep: "Run tests" });
  const output = m.buildContext({
    query: "login",
    workspace: folder,
    sessionId: "one",
  });
  assert.match(output, /concise English/);
  assert.match(output, /Run tests/);
  assert.ok(output.includes(preference.id));
  assert.ok(!output.includes("Bananas"));
});
test("adapter and recall share persistent memory with current conversation available", (t) => {
  const m = engine(t);
  const memory = attachMemoryService(defaultMemory(), m);
  const c = chat();
  captureEpisode(memory, c);
  saveFact(
    memory,
    { text: "password=personal-only", scope: "global" },
    { workspace: folder },
  );
  const store = {
    memoryService: m,
    data: { memory, chats: [c], settings: { workspace: folder } },
  };
  assert.ok(
    recallSearch(store, { query: "redirect" }, { chat: c }).results.length,
  );
  assert.equal(recallRead(store, { sessionId: c.id }).messages.length, 3);
  assert.match(
    buildMemoryContext(memory, { workspace: folder, query: "password" }),
    /personal-only/,
  );
  const record = memory.facts[0];
  assert.ok(deleteFact(memory, record.id));
});
test("hybrid search recalls semantic matches, persists embeddings and falls back to FTS", async (t) => {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body).input;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: input.map((text, index) => ({
          index,
          embedding: /deadlock|hanging/i.test(text) ? [1, 0] : [0, 1],
        })),
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "little-embed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "memory.sqlite");
  let m = new MemoryService({ filename });
  m.configureEmbedding({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "test-embed",
  });
  const target = m.save({
    text: "Resolved the event-loop deadlock",
    scope: "global",
  });
  m.save({ text: "Saved the grocery list", scope: "global" });
  assert.equal(await m.refreshEmbeddings(), 2);
  m.close();
  m = new MemoryService({ filename });
  assert.equal(m.embedding.model, "test-embed");
  assert.equal(await m.refreshEmbeddings(), 0);
  await m.prepareQuery("app hanging");
  assert.equal(
    m.search({ query: "app hanging", scope: "all" }).results[0].id,
    target.id,
  );
  m.configureEmbedding(null);
  assert.equal(
    m.search({ query: "deadlock", scope: "all" }).results[0].id,
    target.id,
  );
  m.close();
});

test("metadata edits preserve identity and sources; changed text preserves correction history", (t) => {
  const m = engine(t);
  const first = m.save({
    text: "Use pnpm",
    type: "decision",
    workspace: folder,
    key: "package-manager",
    source: { sessionId: "one", messageId: "u1" },
  });
  const pinned = m.save({ id: first.id, pinned: true });
  assert.equal(pinned.id, first.id);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.type, "decision");
  assert.deepEqual(pinned.source, first.source);
  const changed = m.save({ id: first.id, text: "Use yarn" });
  assert.equal(changed.pinned, true);
  assert.equal(changed.key, "package-manager");
  assert.equal(changed.supersedes, first.id);
  m.enabled = false;
  assert.equal(m.search({ query: "yarn", scope: "all" }).results.length, 1);
  assert.equal(m.buildContext({ query: "yarn", workspace: folder }), "");
});
test("history result offsets jump to evidence and message-relative paging remains stable", (t) => {
  const m = engine(t);
  const c = chat();
  c.messages[0].text = "x".repeat(4000);
  m.indexChat(c);
  const result = m.search({ query: "redirect", scope: "all", source: "sessions" })
    .results[0];
  assert.equal(result.offset, 4);
  assert.equal(
    m.readSession({ sessionId: c.id, offset: result.offset }).messages[0].id,
    "a1",
  );
  const page = m.readSession({ sessionId: c.id, messageId: "tool1", limit: 1 });
  assert.equal(page.messages[0].id, "tool1");
  assert.equal(page.nextOffset, 1);
  assert.equal(
    m.readSession({
      sessionId: c.id,
      messageId: "tool1",
      offset: page.nextOffset,
    }).messages[0].id,
    "a1",
  );
});
test("embedding errors fall back without breaking a turn and endpoint changes invalidate vectors", async (t) => {
  const m = engine(t);
  const original = m.save({ text: "Exact useful fact", scope: "global" });
  m.configureEmbedding({ baseUrl: "http://127.0.0.1:1/v1", model: "test" });
  const fingerprint = m.embeddingIdentity();
  m.db
    .prepare("UPDATE records SET embedding=?,embedding_model=? WHERE id=?")
    .run("[1,0]", fingerprint, original.id);
  assert.equal(await m.prepareQuery("useful"), false);
  assert.ok(m.snapshot().stats.embeddingError);
  assert.equal(
    m.search({ query: "useful", scope: "all" }).results[0].id,
    original.id,
  );
  m.configureEmbedding({ baseUrl: "http://127.0.0.1:2/v1", model: "test" });
  assert.notEqual(m.embeddingIdentity(), fingerprint);
});

test("forgetting suppresses source-linked paraphrases and the complete keyless correction family", (t) => {
  const m = engine(t);
  const c = chat();
  m.indexChat(c);
  const first = m.save({
    text: "Prefer brief replies",
    scope: "global",
    source: { sessionId: c.id, messageId: "u1" },
  });
  const second = m.save({ id: first.id, text: "Prefer concise replies" });
  m.forget(second.id);
  assert.equal(m.get(first.id).status, "forgotten");
  assert.equal(
    m.save({
      text: "User likes short answers",
      key: "different-key",
      scope: "global",
      automatic: true,
      source: { chatId: c.id, messageIds: ["u1"] },
    }),
    null,
  );
  assert.ok(
    m.readSession({ sessionId: c.id }).messages.length,
    "Forgetting knowledge retains original transcript",
  );
});

test("embedding configuration preserves an existing key on blank same-endpoint edits", (t) => {
  const m = engine(t);
  m.configureEmbedding({
    baseUrl: "http://localhost:1234/v1",
    model: "a",
    apiKey: "personal-key",
  });
  m.configureEmbedding({
    baseUrl: "http://localhost:1234/v1/",
    model: "b",
    apiKey: "",
  });
  assert.equal(m.embedding.apiKey, "personal-key");
  m.configureEmbedding({
    baseUrl: "http://localhost:1234/v1",
    model: "b",
    apiKey: "",
    clearApiKey: true,
  });
  assert.equal(m.embedding.apiKey, "");
});

test("in-flight vectors are discarded after endpoint reconfiguration or memory pause", async (t) => {
  let release,
    started,
    requests = 0;
  let gate = new Promise((resolve) => {
    release = resolve;
  });
  let arrival = new Promise((resolve) => {
    started = resolve;
  });
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { input } = JSON.parse(body);
    requests++;
    if (requests === 2) started();
    await gate;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: input.map((_, index) => ({ index, embedding: [1, 0] })),
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const m = engine(t);
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  m.configureEmbedding({ baseUrl, model: "same-model" });
  m.save({ text: "Useful historical fact", scope: "global" });
  const refresh = m.refreshEmbeddings(),
    query = m.prepareQuery("semantic request");
  await arrival;
  m.configureEmbedding({ baseUrl: baseUrl + "/new", model: "same-model" });
  release();
  assert.equal(await refresh, 0);
  assert.equal(await query, false);
  assert.equal(m.snapshot().stats.embeddingCount, 0);
  assert.equal(m.semantic.size, 0);
  m.enabled = false;
  assert.equal(await m.refreshEmbeddings(), 0);
  assert.equal(await m.prepareQuery("disabled query"), false);
  assert.equal(requests, 2);
  m.enabled = true;
  requests = 0;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  arrival = new Promise((resolve) => {
    started = resolve;
  });
  const pausedRefresh = m.refreshEmbeddings(),
    pausedQuery = m.prepareQuery("paused query");
  await arrival;
  m.enabled = false;
  release();
  assert.equal(await pausedRefresh, 0);
  assert.equal(await pausedQuery, false);
  assert.equal(m.snapshot().stats.embeddingCount, 0);
  assert.equal(m.semantic.size, 0);
});

test("pending corpus embeddings cannot resurrect forgotten or edited content", async (t) => {
  let release, started;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    arrival = new Promise((resolve) => {
      started = resolve;
    });
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { input } = JSON.parse(body);
    started();
    await gate;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: input.map((_, index) => ({ index, embedding: [1, 0] })),
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const m = engine(t);
  m.configureEmbedding({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    model: "test",
  });
  const forgotten = m.save({ text: "Forget this fact", scope: "global" });
  const edited = m.save({ text: "Old preference", scope: "global" });
  m.indexChat({
    id: "continuous",
    messages: [{ id: "tool1", role: "tool", text: "partial output" }],
  });
  const refreshing = m.refreshEmbeddings();
  await arrival;
  m.forget(forgotten.id);
  m.save({ id: edited.id, text: "Updated preference" });
  m.indexChat({
    id: "continuous",
    messages: [{ id: "tool1", role: "tool", text: "complete output" }],
  });
  release();
  assert.equal(await refreshing, 0);
  assert.equal(m.snapshot().stats.embeddingCount, 0);
});
