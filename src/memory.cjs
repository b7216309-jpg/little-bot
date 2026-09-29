"use strict";
const { MemoryService, workspaceKey } = require("./memory-service.cjs");
const clean = (value) => (typeof value === "string" ? value.trim() : "");
function defaultMemory() {
  return { enabled: true, facts: [], episodes: [], records: [], stats: [] };
}
function normalizeMemory(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    enabled: input.enabled !== false,
    facts: Array.isArray(input.facts) ? input.facts : [],
    episodes: Array.isArray(input.episodes) ? input.episodes : [],
    records: Array.isArray(input.records) ? input.records : [],
    stats: Array.isArray(input.stats) ? input.stats : [],
  };
}
function attachMemoryService(memory, service) {
  Object.defineProperty(memory, "service", {
    value: service,
    configurable: true,
    enumerable: false,
  });
  sync(memory);
  return memory;
}
function serviceOf(memory) {
  if (!memory || typeof memory !== "object")
    throw new Error("Memory is unavailable.");
  if (!memory.service) attachMemoryService(memory, new MemoryService());
  memory.service.enabled = memory.enabled !== false;
  return memory.service;
}
function sync(memory) {
  if (memory.service) Object.assign(memory, memory.service.snapshot());
  return memory;
}
function saveFact(memory, input, settings = {}) {
  const service = serviceOf(memory);
  const record = service.save({
    ...input,
    workspace: input.workspace || settings.workspace,
  });
  sync(memory);
  return record;
}
function deleteFact(memory, id) {
  const changed = serviceOf(memory).forget(id);
  sync(memory);
  return changed;
}
function clearEpisodes(memory) {
  const count = serviceOf(memory).clearEpisodes();
  sync(memory);
  return count;
}
function captureEpisode(memory, chat) {
  const service = serviceOf(memory);
  const episode = service.captureTurn(chat);
  service.enqueueExtraction(chat);
  sync(memory);
  return episode;
}
function buildMemoryContext(memory, options = {}) {
  if (memory?.enabled === false) return "";
  return serviceOf(memory).buildContext({
    ...options,
    sessionId: options.sessionId || options.chatId,
  });
}
function automaticRemember(memory, text, settings = {}, chatId, messageId) {
  if (memory?.enabled === false) return null;
  const match = clean(text).match(
    /^(?:please\s+)?remember(?:\s+that\b|\s*:)\s*([\s\S]+)$/i,
  );
  if (!match) return null;
  return saveFact(
    memory,
    {
      text: match[1],
      scope: settings.workspace ? "workspace" : "global",
      source: {
        sessionId: chatId,
        ...(messageId ? { messageId } : {}),
        role: "user",
        label: "Explicit remember request",
      },
    },
    settings,
  );
}
module.exports = {
  defaultMemory,
  normalizeMemory,
  attachMemoryService,
  serviceOf,
  sync,
  saveFact,
  deleteFact,
  clearEpisodes,
  captureEpisode,
  buildMemoryContext,
  automaticRemember,
  workspaceKey,
  looksSecret: () => false,
};
