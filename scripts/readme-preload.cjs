'use strict';
// Preload for scripts/readme-screenshots.cjs only: a stand-in for the real bridge that serves the fictional demo state.
// Every other call resolves quietly, so no engine, model or personal profile is ever involved.
const fs = require('node:fs');

const arg = name => (process.argv.find(item => item.startsWith(`--readme-${name}=`)) || '').split('=').slice(1).join('=');
const state = JSON.parse(fs.readFileSync(arg('state'), 'utf8'));
try { localStorage.setItem('little-bot.theme', arg('theme') || 'dark'); } catch { /* Theme falls back to the system. */ }

const overrides = {
  windowMode: arg('mode') || 'full',
  getState: async () => state,
  searchMemory: async () => ({ records: state.demoRecords || [], total: (state.demoRecords || []).length }),
  getContextUsed: async () => ({ memoryStatus: 'Relevant saved preferences are included.', inputBlocks: [] }),
  getDisplayState: async () => ({ mode: arg('mode') || 'full', collapsed: false, pinned: true }),
  relayState: async () => ({ enabled: false, devices: [] }),
  onEvent: () => () => {},
};
window.bot = new Proxy(overrides, { get: (target, key) => key in target ? target[key] : async () => ({}) });
