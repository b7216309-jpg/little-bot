'use strict';

const fs = require('node:fs');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); }
function replaceOnce(file, before, after, label) {
  const source = read(file);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}.`);
  fs.writeFileSync(file, source.replace(before, after), 'utf8');
}

replaceOnce('src/provider-usage.cjs',
`  const byId = value.rateLimitsByLimitId ?? value.rate_limits_by_limit_id;
  if (object(byId)) return Object.entries(byId);
  const limits = value.rateLimits ?? value.rate_limits ?? value;`,
`  const byId = value.rateLimitsByLimitId ?? value.rate_limits_by_limit_id;
  if (object(byId) && Object.keys(byId).length) return Object.entries(byId);
  const limits = value.rateLimits ?? value.rate_limits ?? value;`,
'empty multi-bucket fallback');

replaceOnce('src/provider-usage.cjs',
`    } else {
      this.state = {
        kind: 'local', status: current.status === 'connected' ? (this.samples.length ? 'ready' : 'waiting') : 'offline',
        updatedAt: this.samples.at(-1)?.at || null, model: current.model, latest: this.samples.at(-1) || null,
        average: averageSamples(this.samples), sampleCount: this.samples.length,
        error: current.status === 'connected' ? null : 'Local performance appears after a completed model turn.',
      };
    }`,
`    } else {
      if (current.model && this.samples.some(sample => sample.model && sample.model !== current.model)) this.samples = [];
      const connected = current.status === 'connected';
      const checking = current.status === 'checking';
      this.state = {
        kind: 'local', status: connected ? (this.samples.length ? 'ready' : 'waiting') : checking ? 'waiting' : 'offline',
        updatedAt: this.samples.at(-1)?.at || null, model: current.model, latest: this.samples.at(-1) || null,
        average: averageSamples(this.samples), sampleCount: this.samples.length,
        error: connected || checking ? null : 'Local performance appears after a completed model turn.',
      };
    }`,
'local connection state');

replaceOnce('src/provider-usage.cjs',
`    const current = normalizeConnection(this.connection());
    if (current.type !== 'codex') return this.connectionChanged(current);
    if (current.status !== 'connected' || this.account()?.status !== 'connected') {`,
`    const current = normalizeConnection(this.connection());
    if (current.type !== 'codex') {
      const connected = current.status === 'connected';
      this.state = {
        kind: 'local', status: connected ? (this.samples.length ? 'ready' : 'waiting') : current.status === 'checking' ? 'waiting' : 'offline',
        updatedAt: this.samples.at(-1)?.at || null, model: current.model, latest: this.samples.at(-1) || null,
        average: averageSamples(this.samples), sampleCount: this.samples.length,
        error: connected || current.status === 'checking' ? null : 'Local performance appears after a completed model turn.',
      };
      this.changed(); return this.publicState();
    }
    if (current.status !== 'connected' || this.account()?.status !== 'connected') {`,
'non-destructive local refresh');

replaceOnce('src/controller.cjs',
`const { INDEPENDENT_CHECK_MODES, normalizeIndependentCheckMode } = require('./independent-check.cjs');`,
`const { INDEPENDENT_CHECK_MODES, normalizeIndependentCheckMode } = require('./independent-check.cjs');
const { ProviderUsage } = require('./provider-usage.cjs');`,
'provider usage import');

replaceOnce('src/controller.cjs',
`    this.goalExecutor = new GoalExecutor(this);
    this.independentCheck = new IndependentCheckRunner(this);
    this.store.data.memory ||= defaultMemory();`,
`    this.goalExecutor = new GoalExecutor(this);
    this.independentCheck = new IndependentCheckRunner(this);
    this.providerUsage = new ProviderUsage({
      client,
      connection: () => this.connection,
      account: () => this.account,
      onChange: () => this.changed(),
    });
    this.store.data.memory ||= defaultMemory();`,
'provider usage constructor');

replaceOnce('src/controller.cjs',
`      runtime: this.runtime, account: this.account,
      connection: this.connection,
      extensionsBusy: this.extensionsBusy,`,
`      runtime: this.runtime, account: this.account,
      connection: this.connection,
      providerUsage: this.providerUsage.publicState(),
      extensionsBusy: this.extensionsBusy,`,
'provider usage state');

replaceOnce('src/controller.cjs',
`    } catch (error) {
      // The sign-in screen still works if the provider catalog is temporarily unavailable.
      this.runtime.catalogError = cleanError(error);
    }
    this.changed();
  }
  async refreshConnection() {`,
`    } catch (error) {
      // The sign-in screen still works if the provider catalog is temporarily unavailable.
      this.runtime.catalogError = cleanError(error);
    }
    await this.providerUsage.refresh();
    this.changed();
  }
  async refreshConnection() {`,
'codex usage refresh');

replaceOnce('src/controller.cjs',
`    this.connection = { type: 'local', status: 'checking', label: 'Local Qwen', baseUrl: settings.localBaseUrl, model: settings.localModel, error: null };
    this.account = { status: 'signedOut', type: 'local' };
    this.changed();`,
`    this.connection = { type: 'local', status: 'checking', label: 'Local Qwen', baseUrl: settings.localBaseUrl, model: settings.localModel, error: null };
    this.account = { status: 'signedOut', type: 'local' };
    this.providerUsage.connectionChanged(this.connection);
    this.changed();`,
'local checking usage state');

replaceOnce('src/controller.cjs',
`      this.models = result.models; this.connection = result.connection;
      this.account = { status: 'connected', type: 'local' };`,
`      this.models = result.models; this.connection = result.connection;
      this.account = { status: 'connected', type: 'local' };
      this.providerUsage.connectionChanged(this.connection);`,
'local connected usage state');

replaceOnce('src/controller.cjs',
`      this.models = []; this.account = { status: 'signedOut', type: 'local' };
      this.connection = { ...this.connection, status: 'offline', error: cleanError(error) };`,
`      this.models = []; this.account = { status: 'signedOut', type: 'local' };
      this.connection = { ...this.connection, status: 'offline', error: cleanError(error) };
      this.providerUsage.connectionChanged(this.connection);`,
'local offline usage state');

replaceOnce('src/controller.cjs',
`    this.models = []; this.changed();
    return this.refreshConnection();
  }
  async login({ type, apiKey } = {}) {`,
`    this.models = [];
    this.providerUsage.connectionChanged({ type: next.connection, status: 'checking', model: next.model });
    this.changed();
    return this.refreshConnection();
  }
  async refreshProviderUsage() { return this.providerUsage.refresh(); }
  async login({ type, apiKey } = {}) {`,
'provider usage refresh API');

replaceOnce('src/controller.cjs',
`  notification(method, params = {}) {
    if (this.closing) return;
    if (this.independentCheck.notification(method, params)) return;`,
`  notification(method, params = {}) {
    if (this.closing) return;
    this.providerUsage.notification(method, params);
    if (this.independentCheck.notification(method, params)) return;`,
'provider usage notifications');

replaceOnce('src/preload.cjs',
`  saveConnection: invoke('saveConnection'), refreshConnection: invoke('refreshConnection'),`,
`  saveConnection: invoke('saveConnection'), refreshConnection: invoke('refreshConnection'), refreshProviderUsage: invoke('refreshProviderUsage'),`,
'provider usage preload');

replaceOnce('src/main.cjs',
`  register('refreshConnection', () => controller.refreshConnection());`,
`  register('refreshConnection', () => controller.refreshConnection());
  register('refreshProviderUsage', () => controller.refreshProviderUsage());`,
'provider usage IPC');

fs.writeFileSync('test/provider-usage-wiring.test.cjs', `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('controller exposes transient provider usage and observes all engine turns', () => {
  const controller = read('src/controller.cjs');
  assert.match(controller, /new ProviderUsage/);
  assert.match(controller, /providerUsage: this\.providerUsage\.publicState\(\)/);
  assert.match(controller, /this\.providerUsage\.notification\(method, params\)/);
  assert.match(read('src/provider-usage.cjs'), /account\/rateLimits\/read/);
  assert.doesNotMatch(read('src/store.cjs'), /providerUsage/);
});

test('provider usage refresh is exposed through trusted IPC only', () => {
  assert.match(read('src/main.cjs'), /register\('refreshProviderUsage'/);
  assert.match(read('src/preload.cjs'), /refreshProviderUsage: invoke\('refreshProviderUsage'\)/);
});
`, 'utf8');
