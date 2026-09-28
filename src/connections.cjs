'use strict';

const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:8080/v1';
const DEFAULT_LOCAL_MODEL = 'Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M';
const LOCAL_PROVIDER = 'little_bot_local';

function localBaseUrl(value = DEFAULT_LOCAL_BASE_URL) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a local server URL, such as http://127.0.0.1:8080/v1.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '/v1') {
    throw new Error('Use a loopback server URL ending in /v1, without credentials or query parameters.');
  }
  return `${url.origin}/v1`;
}
function localModel(value = DEFAULT_LOCAL_MODEL) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter a model ID of up to 200 characters.');
  return value.trim();
}
const INPUT_MODALITIES = new Set(['text', 'image', 'audio']);
function normalizedInputModalities(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter(item => typeof item === 'string').map(item => item.toLowerCase()).filter(item => INPUT_MODALITIES.has(item)))];
}
function inferredVision(value = {}) {
  if (typeof value.vision === 'boolean') return value.vision;
  const inputModalities = normalizedInputModalities(value.inputModalities);
  if (inputModalities) return inputModalities.includes('image');
  if (typeof value.modalities?.vision === 'boolean') return value.modalities.vision;
  if (Array.isArray(value.capabilities)) {
    const capabilities = value.capabilities.filter(item => typeof item === 'string').map(item => item.toLowerCase());
    if (capabilities.some(item => ['image', 'images', 'vision', 'multimodal'].includes(item))) return true;
  }
  return null;
}
function normalizeModelCapabilities(value = {}, { vision } = {}) {
  const explicit = normalizedInputModalities(value.inputModalities);
  const hasVisionOverride = typeof vision === 'boolean';
  const supportsVision = hasVisionOverride ? vision : inferredVision(value);
  const inputModalities = hasVisionOverride
    ? ['text', ...(supportsVision ? ['image'] : [])]
    : explicit || (typeof supportsVision === 'boolean' ? ['text', ...(supportsVision ? ['image'] : [])] : null);
  return {
    ...value,
    ...(inputModalities ? { inputModalities } : {}),
    vision: typeof supportsVision === 'boolean' ? supportsVision : null,
  };
}
function modelSupportsVision(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.vision === 'boolean') return value.vision;
  const modalities = normalizedInputModalities(value.inputModalities);
  return modalities ? modalities.includes('image') : null;
}
function normalizeConnectionSettings(value = {}) {
  let baseUrl = DEFAULT_LOCAL_BASE_URL, model = DEFAULT_LOCAL_MODEL;
  try { baseUrl = localBaseUrl(value.localBaseUrl); } catch { /* Recover with the known local endpoint. */ }
  try { model = localModel(value.localModel); } catch { /* Recover with the installed model. */ }
  const connection = value.connection === 'codex' ? 'codex' : 'local';
  const codexModel = typeof value.codexModel === 'string' ? value.codexModel.slice(0, 200)
    : typeof value.model === 'string' && value.model !== model ? value.model.slice(0, 200) : '';
  return { connection, localBaseUrl: baseUrl, localModel: model, localThinking: value.localThinking !== false,
    codexModel, model: connection === 'local' ? model : (value.model || codexModel || '') };
}
// Legacy records came from the OpenAI connection. Never silently send their history elsewhere.
function connectionBinding(value = {}, fallback = 'codex') {
  const connection = ['local', 'codex'].includes(value.connection) ? value.connection : fallback;
  return connection === 'local' ? { connection, localBaseUrl: localBaseUrl(value.localBaseUrl) } : { connection };
}
function isConnectionSelected(value, settings = {}) {
  const saved = connectionBinding(value), selected = settings.connection || 'codex';
  return saved.connection === selected && (selected !== 'local' || (saved.localBaseUrl === localBaseUrl(settings.localBaseUrl)
    && (!value.model || value.model === settings.localModel)));
}
function requireSelectedConnection(value, settings) {
  if (!isConnectionSelected(value, settings)) throw new Error('Select this task’s saved connection in Settings before running it.');
}
async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'error' });
  if (!response.ok) throw new Error(`Local server returned HTTP ${response.status}.`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Local server response is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function probeLocal(settings) {
  const baseUrl = localBaseUrl(settings.localBaseUrl), selected = localModel(settings.localModel);
  const origin = new URL(baseUrl).origin;
  const [catalog, properties] = await Promise.allSettled([readJson(`${baseUrl}/models`), readJson(`${origin}/props`)]);
  if (catalog.status === 'rejected') throw new Error(`Local model is offline. Start your Qwen launcher, then Check connection. ${catalog.reason.message}`);
  const raw = catalog.value;
  const detailedModels = Array.isArray(raw.models) ? raw.models : [];
  const models = (Array.isArray(raw.data) ? raw.data : []).filter(item => typeof item.id === 'string' && item.id.length <= 200)
    .map(item => {
      const details = detailedModels.find(detail => detail?.model === item.id || detail?.name === item.id) || {};
      return normalizeModelCapabilities({
        ...item,
        ...details,
        id: item.id,
        displayName: item.id === DEFAULT_LOCAL_MODEL ? 'Qwen 3.6 · local' : item.id,
        contextWindow: item.meta?.n_ctx ?? details.meta?.n_ctx,
      });
    });
  let found = models.find(item => item.id === selected);
  if (!found) throw new Error('The selected model is not loaded. Choose the model ID shown by your local server.');
  const props = properties.status === 'fulfilled' ? properties.value : {};
  let adapter = null, health = null;
  if (properties.status === 'rejected') {
    try {
      const candidate = await readJson(`${origin}/health`);
      if (candidate?.status === 'ok' && candidate.model === selected
        && Number.isSafeInteger(candidate.max_context) && candidate.max_context >= 4096 && candidate.max_context <= 4000000
        && typeof candidate.images === 'boolean' && typeof candidate.api_key === 'boolean') {
        adapter = 'strata';
        health = candidate;
      }
    } catch { /* Other local servers keep the existing /props fallback behavior. */ }
  }
  const visionOverride = adapter === 'strata' ? health.images : props.modalities?.vision;
  if (typeof visionOverride === 'boolean') {
    const index = models.indexOf(found);
    found = normalizeModelCapabilities(found, { vision: visionOverride });
    models[index] = found;
  }
  const window = adapter === 'strata' ? health.max_context : (props.default_generation_settings?.n_ctx || found.contextWindow);
  const contextWindow = Number.isSafeInteger(window) && window >= 4096 && window <= 4000000 ? window : 32768;
  const vision = modelSupportsVision(found);
  return { models, connection: {
    type: 'local', status: 'connected', label: 'Local Qwen', baseUrl, model: selected, contextWindow,
    vision, ...(adapter ? { adapter } : {}),
    ...(Array.isArray(found.inputModalities) ? { inputModalities: found.inputModalities } : {}), error: null,
  } };
}
function providerConfig(settings, connection, localEndpoint) {
  if (settings.connection === 'codex') return { model_provider: 'openai' };
  return {
    model_provider: LOCAL_PROVIDER,
    [`model_providers.${LOCAL_PROVIDER}`]: { name: 'Local Qwen', base_url: localEndpoint || localBaseUrl(settings.localBaseUrl), wire_api: 'responses',
      requires_openai_auth: false, supports_websockets: false, request_max_retries: 1, stream_max_retries: 0, stream_idle_timeout_ms: 120000 },
    model_context_window: connection?.contextWindow || 32768,
    model_supports_reasoning_summaries: false,
    // llama.cpp accepts images in user input, but not in function-call output.
    // Incoming attachments already supply their pixels as native localImage parts.
    'features.view_image': false,
    web_search: 'disabled',
  };
}

module.exports = { DEFAULT_LOCAL_BASE_URL, DEFAULT_LOCAL_MODEL, LOCAL_PROVIDER, localBaseUrl, localModel, normalizeConnectionSettings, connectionBinding, isConnectionSelected, requireSelectedConnection, normalizeModelCapabilities, modelSupportsVision, probeLocal, providerConfig };
