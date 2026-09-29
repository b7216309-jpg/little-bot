"use strict";
const { serviceOf } = require("./memory.cjs");
const CHUNK_CHARS = 1800,
  MAX_PAGE_CHARS = 40000;
function service(store) {
  if (store?.data?.memory?.enabled === false) throw new Error("Memory is off.");
  return store.memoryService || serviceOf(store.data.memory);
}
function recallSearch(store, args = {}, { chat } = {}) {
  return service(store).search({
    ...args,
    workspace: chat?.workspace || store.data.settings?.workspace,
  });
}
function recallRead(store, args = {}) {
  return service(store).readSession(args);
}
function recallSpecs() {
  const scope = {
    type: "string",
    enum: ["workspace", "all"],
    description:
      "Search the current project or all projects. All models share memory.",
  };
  return [
    {
      type: "function",
      name: "memory_search",
      description:
        "Search durable knowledge, decisions, episodes, and original conversation/tool history. Results include source IDs; use session_read for surrounding evidence. Empty query lists recent records.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          source: {
            type: "string",
            enum: ["all", "facts", "episodes", "sessions"],
          },
          scope,
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
          includeSuperseded: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "session_read",
      description:
        "Read original messages and tool outputs from the continuous conversation, including history retained after compaction. Use either the search result offset alone, or messageId with offset omitted to jump to its start. With messageId, offsets and nextOffset are relative to that message; otherwise they are absolute 1800-character chunk offsets.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          messageId: {
            type: "string",
            description:
              "Jump directly to a source message ID from memory_search.",
          },
          scope,
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
    },
  ];
}
module.exports = {
  recallSearch,
  recallRead,
  recallSpecs,
  CHUNK_CHARS,
  MAX_PAGE_CHARS,
};
