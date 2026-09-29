"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, PROTECTED_STATE_VERSION } = require("../src/store.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "little-bot-encryption-"),
  );
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    filePath: path.join(directory, "state.json"),
    defaultWorkspace: directory,
    stores,
  };
}

function protector(tag = "A") {
  return {
    encryptString(value) {
      return Buffer.from(
        `${tag}:${Buffer.from(value, "utf8").toString("base64")}`,
        "utf8",
      );
    },
    decryptString(buffer) {
      const value = Buffer.from(buffer).toString("utf8");
      if (!value.startsWith(`${tag}:`)) throw new Error("wrong key");
      return Buffer.from(value.slice(tag.length + 1), "base64").toString(
        "utf8",
      );
    },
  };
}

function seedSensitive(store, workspace) {
  store.data.chats.push({
    id: "secret-chat",
    title: "Sensitive conversation",
    threadId: "thread-secret",
    workspace,
    model: "gpt-test",
    connection: "codex",
    status: "idle",
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: "u", role: "user", text: "SESSION SECRET 49173" },
      {
        id: "a",
        role: "assistant",
        text: "Assistant secret reply",
        status: "completed",
      },
    ],
  });
  store.memoryService.save({
    text: "MEMORY SECRET 88421",
    scope: "global",
    workspace: "",
    source: "manual",
    createdAt: 3,
    updatedAt: 3,
  });
}

test("protected state.json encrypts chats and memory snapshot while SQLite remains local plain storage", (t) => {
  const f = fixture(t);
  const store = new Store({ ...f, protector: protector("A") });
  f.stores.push(store);
  seedSensitive(store, f.directory);
  store.data.settings.effort = "medium";
  store.save();

  const raw = fs.readFileSync(f.filePath, "utf8");
  assert.equal(raw.includes("SESSION SECRET 49173"), false);
  assert.equal(raw.includes("MEMORY SECRET 88421"), false);
  assert.equal(raw.includes("Sensitive conversation"), false);

  const disk = JSON.parse(raw);
  assert.equal(disk.protected.version, PROTECTED_STATE_VERSION);
  assert.equal(disk.protected.format, "safeStorage");
  assert.equal(typeof disk.protected.data, "string");
  assert.equal(Object.hasOwn(disk, "chats"), false);
  assert.equal(Object.hasOwn(disk, "memory"), false);
  assert.equal(disk.settings.effort, "medium");

  const reopened = new Store({ ...f, protector: protector("A") });
  f.stores.push(reopened);
  assert.equal(reopened.warning, null);
  assert.equal(reopened.locked, false);
  assert.equal(reopened.data.chats[0].messages[0].text, "SESSION SECRET 49173");
  assert.equal(reopened.data.memory.facts[0].text, "MEMORY SECRET 88421");
});

test("existing plaintext state.json becomes protected on the next save", (t) => {
  const f = fixture(t);
  const legacy = new Store(f);
  f.stores.push(legacy);
  seedSensitive(legacy, f.directory);
  legacy.save();
  assert.match(fs.readFileSync(f.filePath, "utf8"), /SESSION SECRET 49173/);

  const migrating = new Store({ ...f, protector: protector("A") });
  f.stores.push(migrating);
  assert.equal(migrating.warning, null);
  assert.equal(
    migrating.data.chats[0].messages[0].text,
    "SESSION SECRET 49173",
  );
  migrating.save();

  const encrypted = fs.readFileSync(f.filePath, "utf8");
  assert.equal(encrypted.includes("SESSION SECRET 49173"), false);
  assert.equal(encrypted.includes("MEMORY SECRET 88421"), false);
  assert.ok(JSON.parse(encrypted).protected);

  const reopened = new Store({ ...f, protector: protector("A") });
  f.stores.push(reopened);
  assert.equal(reopened.data.chats[0].id, "secret-chat");
  assert.equal(reopened.data.memory.facts[0].text, "MEMORY SECRET 88421");
});

test("encrypted state fails closed with the wrong protector and cannot be overwritten", (t) => {
  const f = fixture(t);
  const store = new Store({ ...f, protector: protector("A") });
  f.stores.push(store);
  seedSensitive(store, f.directory);
  store.save();
  const original = fs.readFileSync(f.filePath, "utf8");

  const locked = new Store({ ...f, protector: protector("B") });
  f.stores.push(locked);
  assert.equal(locked.locked, true);
  assert.match(locked.warning, /could not be decrypted/i);
  assert.deepEqual(locked.data.chats, []);
  assert.throws(() => locked.save(), /locked/i);
  assert.equal(fs.readFileSync(f.filePath, "utf8"), original);
});

test("encrypted state cannot be opened without a protector", (t) => {
  const f = fixture(t);
  const store = new Store({ ...f, protector: protector("A") });
  f.stores.push(store);
  seedSensitive(store, f.directory);
  store.save();

  const locked = new Store(f);
  f.stores.push(locked);
  assert.equal(locked.locked, true);
  assert.match(locked.warning, /secure storage is unavailable/i);
  assert.throws(() => locked.flush(), /locked/i);
});

test("production main wires Store to Electron safeStorage and refuses insecure startup", () => {
  const main = fs.readFileSync(
    path.join(__dirname, "..", "src", "main.cjs"),
    "utf8",
  );
  assert.match(main, /function stateProtector\(\)/);
  assert.match(main, /safeStorage\.isEncryptionAvailable\(\)/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /safeStorage\.decryptString/);
  assert.match(main, /protector: stateProtector\(\)/);
  assert.match(main, /if \(store\.locked\) throw/);
});
