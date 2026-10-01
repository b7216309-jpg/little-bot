'use strict';

const $ = (id) => document.getElementById(id);
const icons = {
  plus: ['M12 5v14', 'M5 12h14'],
  clock: ['M12 8v4l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'],
  calendar: ['M6 2v4', 'M18 2v4', 'M3 8h18', 'M5 4h14a2 2 0 0 1 2 2v15H3V6a2 2 0 0 1 2-2Z', 'M7 12h3', 'M14 12h3', 'M7 16h3', 'M14 16h3'],
  folder: ['M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  terminal: ['m5 7 5 5-5 5', 'M13 17h6'],
  sparkles: ['m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z', 'M20 2v4', 'M18 4h4'],
  'arrow-up-right': ['M7 17 17 7', 'M7 7h10v10'],
  'arrow-up': ['M12 19V5', 'm6 11 6-6 6 6'],
  'chevron-down': ['m7 10 5 5 5-5'],
  settings: ['M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  user: ['M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M5 21v-2a7 7 0 0 1 14 0v2'],
  chat: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V11.5a9 9 0 0 1 18 0Z'],
  trash: ['M3 6h18', 'M9 6V3h6v3', 'm5 6 1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
  x: ['M6 6l12 12', 'M6 18 18 6'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 11v6', 'M12 7h.01'],
  shield: ['M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z', 'm8 12 3 3 5-6'],
  play: ['m8 4 12 8-12 8Z'],
  edit: ['m14 5 5 5', 'm4 15 12-12 5 5L9 20l-6 1Z'],
  check: ['m5 12 4 4L19 6'],
  heartbeat: ['M2 12h5l3-8 4 16 3-8h5'],
  memory: ['M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3', 'M8 2h8v6H8Z', 'M7 12h10', 'M7 16h7'],
  extensions: ['M8 3h3a3 3 0 1 1 6 0h4v6a3 3 0 1 0 0 6v6h-6a3 3 0 1 0-6 0H3v-6a3 3 0 1 0 0-6V3Z'],
  refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M5.3 7a8 8 0 0 1 13.9-1L20 8', 'M4 16l.8 2A8 8 0 0 0 18.7 17'],
  import: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 16v5h16v-5'],
  server: ['M3 3h18v7H3Z', 'M3 14h18v7H3Z', 'M7 6.5h.01', 'M7 17.5h.01'],
  compact: ['M8 3v5H3', 'M16 3v5h5', 'M8 21v-5H3', 'M16 21v-5h5', 'M3 3l5 5', 'M21 3l-5 5', 'M3 21l5-5', 'M21 21l-5-5'],
  goal: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0', 'M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0'],
  pause: ['M8 5v14', 'M16 5v14'],
  browser: ['M3 4h18v16H3Z', 'M3 9h18', 'M6 6.5h.01', 'M9 6.5h.01', 'M12 6.5h.01'],
  paperclip: ['m21 11-9 9a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 6'],
  file: ['M14 2H5v20h14V7Z', 'M14 2v5h5', 'M8 12h8', 'M8 16h5'],
};

function fillIcon(node, name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of icons[name] || icons.sparkles) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  node.replaceChildren(svg);
  return node;
}

function icon(name, extraClass = '') {
  const node = document.createElement('span');
  node.className = `icon ${extraClass}`.trim();
  return fillIcon(node, name);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function action(label, handler, className = 'button secondary', iconName) {
  const button = element('button', className);
  button.type = 'button';
  if (iconName) button.append(icon(iconName));
  button.append(document.createTextNode(label));
  button.addEventListener('click', handler);
  return button;
}

document.querySelectorAll('[data-icon]').forEach((node) => fillIcon(node, node.dataset.icon));

const sidebarTools = $('sidebar-tools');
try { sidebarTools.open = localStorage.getItem('little-bot.tools-open') === 'true'; } catch { /* Keep navigation usable if storage is unavailable. */ }
sidebarTools.addEventListener('toggle', () => {
  try { localStorage.setItem('little-bot.tools-open', String(sidebarTools.open)); } catch { /* The disclosure still works without persistence. */ }
});

let state = null;
let lastStateRevision = -1;
let stateRefreshPromise = null;
const deferredChatUpdates = [];
const chatMessageLookups = new Map();
let renderedChatId = null;
const renderedMessages = new Map();
const renderedActionGroups = new Map();
let conversationActivity = null;
let taskClockTimer = null;
let selectedChatId = null;
let currentView = 'chat';
let inboxFilter = 'all';
let inboxSource = 'all';
let sending = false;
let thinkingSaving = false;
let loginPending = false;
let loginMetadata = null;
let editingAutomationId = null;
let editingCalendarId = null;
let activeApprovalId = null;
let toastTimer = null;
let confirmResolver = null;
let lastModelCatalog = '';
let initialState = true;
let lastStorageWarning = '';
let navigationVersion = 0;
let editingFactId = null;
let heartbeatDirty = false;
let heartbeatSaving = false;
let heartbeatManualPending = false;
let heartbeatUseCurrentWorkspace = false;
let heartbeatFormRevision = 0;
let heartbeatBaseline = '';
let extensionTab = 'tools';
let extensionsRefreshing = false;
let editingServerId = null;
let editingSkillId = null;
const extensionPending = new Set();
const compactionPending = new Set();
let editingGoalId = null;
let goalDraftContext = null;
let goalCheckSequence = 0;
let goalRestoreTarget = null;
const goalPending = new Set();
const goalAnswerDrafts = new Map();
const goalAnswerPending = new Set();
const goalAnswerErrors = new Map();
let profileInitialized = false;
let profileSaving = false;
let profileSaveError = '';
let profileBaseline = { user: '', soul: '' };
let profilePendingValues = null;
let compactionSettingsInitialized = false;
let compactionSettingsBaseline = 80;
let compactionSettingsSaving = false;
let compactionSettingsError = '';
let systemPromptInitialized = false;
let systemPromptBaseline = '';
let systemPromptSaving = false;
let systemPromptError = '';
let independentCheckSettingsInitialized = false;
let independentCheckSettingsBaseline = 'selective';
let independentCheckSettingsSaving = false;
let independentCheckSettingsError = '';
let browserActionPending = '';
let browserActionError = '';
const serviceKeyPending = new Map();
const serviceKeyErrors = new Map();
const heartbeatFeedbackPending = new Set();
const expandedTools = new Set();
const expandedActionGroups = new Set();
const expandedReasoning = new Set();
const seenApprovals = new Set();
const chatDrafts = new Map();
const planModeDrafts = new Map();
const attachmentDrafts = new Map();
let attachmentImportPending = false;
let connectionInitialized = false;
let connectionBaseline = '';
let connectionPending = false;
let connectionError = '';
let chatFollowTail = true;
let chatScrollProgrammatic = false;
let agentInspectorOpen = false;
const contextUsedCache = new Map();
const contextUsedPending = new Map();
try { agentInspectorOpen = localStorage.getItem('little-bot.agent-inspector-open') === 'true'; } catch { /* Optional UI preference only. */ }

const currentChat = () => state?.chats?.find((chat) => chat.id === selectedChatId) || null;
const isConnected = () => state?.account?.status === 'connected';
const isReady = () => state?.runtime?.status === 'ready';
const connectionType = () => state?.connection?.type || state?.settings?.connection || 'codex';
const isStrataLocal = () => connectionType() === 'local' && state?.connection?.adapter === 'strata';
const draftKey = () => selectedChatId || '__new__';
const queuedAttachments = () => attachmentDrafts.get(draftKey()) || [];
const currentPlanMode = () => planModeDrafts.has(draftKey()) ? planModeDrafts.get(draftKey()) : currentChat()?.mode === 'plan';
const basename = (path) => String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path || 'Choose workspace';

function programmaticChatScroll(action) {
  chatScrollProgrammatic = true;
  try { action(); }
  finally {
    requestAnimationFrame(() => { chatScrollProgrammatic = false; });
  }
}

function scrollChatToBottom() {
  const scroller = $('chat-scroll');
  chatFollowTail = true;
  programmaticChatScroll(() => { scroller.scrollTop = scroller.scrollHeight; });
}

function captureChatScroll() {
  return LittleBotChatScroll.capture($('chat-scroll'), $('messages'), chatFollowTail);
}

function restoreChatScroll(snapshot) {
  programmaticChatScroll(() => LittleBotChatScroll.restore($('chat-scroll'), snapshot));
}

function reportRendererError(kind, value) {
  if (typeof window.bot?.reportError !== 'function') return;
  const error = value instanceof Error ? value : new Error(typeof value === 'string' ? value : String(value ?? 'Renderer error'));
  window.bot.reportError({ kind, message: String(error.message || error).slice(0, 12000), stack: String(error.stack || '').slice(0, 30000) }).catch(() => {});
}

window.addEventListener('error', event => reportRendererError('window-error', event.error || event.message));
window.addEventListener('unhandledrejection', event => reportRendererError('unhandled-rejection', event.reason));

function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = String(message || 'Something went wrong.');
  $('toast').classList.toggle('error', error);
  $('toast').classList.remove('hidden');
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), error ? 9000 : 4500);
}

async function attempt(operation, successMessage) {
  try {
    const result = await operation();
    if (result?.settings && Array.isArray(result.chats)) applyState(result);
    if (successMessage) notify(successMessage);
    return result;
  } catch (error) {
    notify(error?.message || String(error), true);
    return null;
  }
}

function showDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = $(id);
  if (dialog.open) dialog.close();
}

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(button.dataset.close));
});

function applyState(next) {
  if (!next || !next.settings) return;
  const revision = next.stateRevision;
  if (Number.isSafeInteger(revision)) {
    if (revision <= lastStateRevision) return;
    lastStateRevision = revision;
  } else if (lastStateRevision >= 0) return;
  state = next;
  chatMessageLookups.clear();
  if (state.storageWarning && state.storageWarning !== lastStorageWarning) notify(state.storageWarning, true);
  lastStorageWarning = state.storageWarning || '';
  if (initialState) {
    initialState = false;
    const latest = [...(state.chats || [])].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    selectedChatId = latest?.id || null;
  }
  selectedChatId = state.chats?.[0]?.id || null;
  if (isConnected()) {
    loginPending = false;
    loginMetadata = null;
  }
  render();
}

function refreshChatState(event) {
  if (deferredChatUpdates.length < 256) deferredChatUpdates.push(event);
  if (stateRefreshPromise) return;
  stateRefreshPromise = window.bot.getState().then(applyState).catch(error => {
    notify(error?.message || 'Could not refresh the conversation.', true);
  }).finally(() => {
    stateRefreshPromise = null;
    const pending = deferredChatUpdates.splice(0).sort((left, right) => left.revision - right.revision);
    for (const update of pending) applyChatUpdate(update, false);
  });
}

function applyChatUpdate(event, allowRefresh = true) {
  if (!Number.isSafeInteger(event.revision) || event.revision <= lastStateRevision) return;
  if (stateRefreshPromise) {
    if (deferredChatUpdates.length < 256) deferredChatUpdates.push(event);
    return;
  }
  const chat = state?.chats?.find(item => item.id === event.chatId);
  if (!chat || !Array.isArray(event.messages)) {
    if (allowRefresh) refreshChatState(event);
    return;
  }
  let lookup = chatMessageLookups.get(chat.id);
  if (!lookup || lookup.messages !== chat.messages) {
    lookup = { messages: chat.messages, indexes: new Map(chat.messages.map((message, index) => [message.id, index])) };
    chatMessageLookups.set(chat.id, lookup);
  }
  if (event.messages.some(message => !message || !lookup.indexes.has(message.id))) {
    if (allowRefresh) refreshChatState(event);
    return;
  }
  for (const message of event.messages) chat.messages[lookup.indexes.get(message.id)] = message;
  if (Number.isFinite(event.updatedAt)) chat.updatedAt = event.updatedAt;
  state.stateRevision = lastStateRevision = event.revision;
  if (currentView === 'chat' && selectedChatId === chat.id) renderStreamedMessages(chat, event.messages, lookup.indexes);
}

function render() {
  if (!state) return;
  renderHeader();
  renderSidebar();
  renderConnection();
  renderSettings();
  window.LittleBotProviderUsagePanel?.render(state.providerUsage || null);
  if (currentView === 'chat') renderConversation();
  if (currentView === 'automations') renderAutomations();
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'memory') renderMemory();
  if (currentView === 'heartbeat') renderHeartbeat();
  if (currentView === 'inbox') renderActivityInbox();
  if (currentView === 'extensions') renderExtensions();
  if (currentView === 'goals') renderGoals();
  if (currentView === 'profile') renderProfile();
  renderAgentInspector();
  renderApprovals();
  updateComposer();
}

function renderHeader() {
  const chat = currentChat();
  $('page-label').textContent = { inbox: 'Activity inbox', goals: 'Goals', automations: 'Automations', calendar: 'Calendar', memory: 'Memory', profile: 'Profile', heartbeat: 'Heartbeat', extensions: 'Extensions' }[currentView] || 'Conversation';
  const status = state.runtime || {};
  const label = status.status === 'ready' ? 'Ready' : status.status === 'error' ? 'Needs attention' : 'Starting';
  const dot = element('span', `status-dot ${status.status === 'ready' ? '' : status.status === 'error' ? 'error' : 'starting'}`);
  $('runtime-status').replaceChildren(dot, element('span', '', label));
  $('runtime-status').title = status.error || label;
  const workspace = currentView === 'chat' && chat ? chat.workspace : state.settings.workspace;
  $('workspace-label').textContent = basename(workspace);
  $('choose-workspace').title = workspace ? `Current folder: ${workspace}\nSwitch the working folder for this conversation` : 'Choose a workspace folder';
  const models = state.models || [];
  const catalogKey = JSON.stringify(models);
  if (catalogKey !== lastModelCatalog) {
    lastModelCatalog = catalogKey;
    const options = models.map((model) => {
      const option = element('option', '', model.displayName || model.id);
      option.value = model.id;
      return option;
    });
    if (!options.length) {
      const option = element('option', '', state.settings.model || 'Loading models…');
      option.value = state.settings.model || '';
      options.push(option);
    }
    $('model-select').replaceChildren(...options);
  }
  if (!Array.from($('model-select').options).some((option) => option.value === state.settings.model) && state.settings.model) {
    const option = element('option', '', state.settings.model);
    option.value = state.settings.model;
    $('model-select').append(option);
  }
  $('model-select').value = state.settings.model || '';
  $('effort-select').value = state.settings.effort || 'medium';
  const automationCount = (state.automations || []).length;
  $('automation-count').textContent = String(automationCount);
  $('automation-count').classList.toggle('hidden', automationCount === 0);
  const now = Date.now();
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const calendarCount = (state.calendar?.events || []).filter(event => event.endAt > now && event.startAt < tomorrow).length;
  $('calendar-count').textContent = String(calendarCount);
  $('calendar-count').classList.toggle('hidden', calendarCount === 0);
  const unreadCount = (state.heartbeat?.history || []).filter((entry) => entry.unread).length;
  $('heartbeat-unread').textContent = String(unreadCount);
  $('heartbeat-unread').classList.toggle('hidden', unreadCount === 0);
  const goals = state.autonomy?.goals || [];
  const waitingGoals = goals.filter(goal => goal.pendingQuestion).length;
  const visibleGoals = goals.filter(goal => goal.pendingQuestion || goal.status === 'running' || goal.status === 'queued').length;
  $('goals-count').textContent = String(visibleGoals);
  $('goals-count').classList.toggle('hidden', visibleGoals === 0);
  $('goals-count').title = waitingGoals ? `${waitingGoals} waiting for an answer` : 'Running or queued goals';
}

function renderSidebar() {
  $('nav-conversation').classList.toggle('active', currentView === 'chat');
  $('nav-conversation').setAttribute('aria-current', currentView === 'chat' ? 'page' : 'false');
  $('nav-automations').classList.toggle('active', currentView === 'automations');
  $('nav-calendar').classList.toggle('active', currentView === 'calendar');
  $('nav-memory').classList.toggle('active', currentView === 'memory');
  $('nav-heartbeat').classList.toggle('active', currentView === 'heartbeat');
  $('nav-inbox').classList.toggle('active', currentView === 'inbox');
  $('nav-extensions').classList.toggle('active', currentView === 'extensions');
  $('nav-goals').classList.toggle('active', currentView === 'goals');
  $('nav-profile').classList.toggle('active', currentView === 'profile');
  $('account-label').textContent = connectionType() === 'local' ? 'Local Qwen' : 'Codex';
  $('account-sublabel').textContent = `${isConnected() ? 'Connected' : 'Offline'} · Settings`;
}

function saveCurrentDraft() {
  chatDrafts.set(selectedChatId || '__new__', $('message-input').value);
}

function selectChat(id) {
  navigationVersion += 1;
  saveCurrentDraft();
  selectedChatId = state?.chats?.[0]?.id || null;
  id = selectedChatId;
  currentView = 'chat';
  chatFollowTail = true;
  $('message-input').value = chatDrafts.get(id || '__new__') || '';
  $('chat-view').classList.remove('hidden');
  $('automations-view').classList.add('hidden');
  $('calendar-view').classList.add('hidden');
  $('memory-view').classList.add('hidden');
  $('heartbeat-view').classList.add('hidden');
  $('inbox-view').classList.add('hidden');
  $('extensions-view').classList.add('hidden');
  $('goals-view').classList.add('hidden');
  $('profile-view').classList.add('hidden');
  render();
  sizeComposer();
  scrollChatToBottom();
  $('message-input').focus();
}

function showAutomations() {
  showFeature('automations');
}

function showFeature(view) {
  navigationVersion += 1;
  if (currentView === 'chat') saveCurrentDraft();
  currentView = view;
  $('chat-view').classList.add('hidden');
  for (const feature of ['goals', 'automations', 'calendar', 'memory', 'profile', 'heartbeat', 'inbox', 'extensions']) $(feature + '-view').classList.toggle('hidden', feature !== view);
  render();
}

function appendInline(parent, source) {
  const expression = /(\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  for (const match of source.matchAll(expression)) {
    parent.append(document.createTextNode(source.slice(last, match.index)));
    if (match[2]) parent.append(element('strong', '', match[2]));
    else if (match[3]) parent.append(element('code', '', match[3]));
    else {
      const link = element('a', '', match[4]);
      link.href = match[5];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      parent.append(link);
    }
    last = match.index + match[0].length;
  }
  parent.append(document.createTextNode(source.slice(last)));
}

function renderMessageText(parent, text) {
  const pieces = String(text || '').split(/```[^\n]*\n/);
  if (pieces.length === 1) {
    appendInline(parent, text || '');
    return;
  }
  // Parse only complete, fenced code blocks; all other model content remains text.
  const source = String(text || '');
  const fences = /```([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (const match of source.matchAll(fences)) {
    appendInline(parent, source.slice(last, match.index));
    const pre = element('pre');
    const code = element('code', '', match[2].replace(/\n$/, ''));
    pre.append(code);
    parent.append(pre);
    last = match.index + match[0].length;
  }
  appendInline(parent, source.slice(last));
}

function attachmentSource(attachment) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(attachment?.id || '')) return '';
  const thumbnail = attachment.thumbnail;
  if (typeof thumbnail === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(thumbnail)) return thumbnail;
  return `little-bot-attachment://file/${attachment.id}`;
}

function fileSize(size) {
  if (!Number.isFinite(size) || size < 0) return '';
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAttachments(parent, attachments, { draft = false, key = draftKey() } = {}) {
  if (!Array.isArray(attachments) || !attachments.length) return;
  const list = element('div', draft ? 'attachment-list attachment-drafts' : 'attachment-list');
  for (const attachment of attachments.slice(0, 8)) {
    const source = attachmentSource(attachment);
    if (!source) continue;
    const card = element('div', `attachment-card ${attachment.kind === 'image' ? 'attachment-image-card' : ''}`);
    card.dataset.attachmentId = attachment.id;
    if (attachment.kind === 'image') {
      const preview = element('img', 'attachment-preview');
      preview.src = source;
      preview.alt = attachment.name || 'Attached image';
      preview.loading = 'lazy';
      preview.addEventListener('load', () => {
        if (chatFollowTail) scrollChatToBottom();
      }, { once: true });
      const open = action('', () => attempt(() => window.bot.openAttachment({ id: attachment.id })), 'attachment-preview-button');
      open.title = `Open ${attachment.name || 'image'}`;
      open.setAttribute('aria-label', open.title);
      open.append(preview);
      card.append(open);
    } else card.append(icon('file', 'attachment-file-icon'));
    const copy = element('div', 'attachment-copy');
    const name = element('strong', '', attachment.name || 'File');
    name.title = attachment.name || 'File';
    copy.append(name, element('span', '', fileSize(attachment.size)));
    card.append(copy);
    if (draft) {
      const remove = action('', async () => {
        if (sending || attachmentImportPending) return;
        attachmentImportPending = true; updateComposer();
        try {
          await window.bot.releaseAttachment?.({ id: attachment.id });
          attachmentDrafts.set(key, (attachmentDrafts.get(key) || []).filter((item) => item.id !== attachment.id));
        } catch (error) { notify(error.message || String(error), true); }
        finally { attachmentImportPending = false; updateComposer(); }
      }, 'icon-button attachment-remove', 'x');
      remove.title = `Remove ${attachment.name || 'file'}`;
      remove.setAttribute('aria-label', remove.title);
      remove.disabled = sending;
      card.append(remove);
    } else {
      const controls = element('div', 'attachment-actions');
      controls.append(action('Open', () => attempt(() => window.bot.openAttachment({ id: attachment.id })), 'button text-button'));
      controls.append(action('Save', () => attempt(() => window.bot.saveAttachment({ id: attachment.id })), 'button text-button', 'import'));
      controls.append(action('Remove', async () => {
        if (await confirmAction('Remove this saved attachment?', 'Its saved copy will be removed from this conversation. Message text and the original source file will stay.', 'Remove')) {
          await attempt(() => window.bot.deleteAttachment({ id: attachment.id }), 'Saved attachment removed.');
        }
      }, 'button text-button', 'trash'));
      card.append(controls);
    }
    list.append(card);
  }
  parent.append(list);
}

function renderAttachmentQueue() {
  const host = $('attachment-queue');
  host.replaceChildren();
  renderAttachments(host, queuedAttachments(), { draft: true });
  host.classList.toggle('hidden', !queuedAttachments().length);
  $('attach-button').disabled = sending || attachmentImportPending || queuedAttachments().length >= 8;
  $('attach-button').title = attachmentImportPending ? 'Adding files…' : 'Attach files or images · up to 8';
  $('attachment-import-status').textContent = attachmentImportPending ? 'Adding files…' : '';
  $('attachment-import-status').classList.toggle('hidden', !attachmentImportPending);
}

async function addAttachments(files = null) {
  if (sending || attachmentImportPending) return;
  const key = draftKey();
  const remaining = 8 - (attachmentDrafts.get(key) || []).length;
  if (remaining <= 0 || (files && files.length > remaining)) {
    notify('Attach up to 8 files per message.', true);
    return;
  }
  attachmentImportPending = true;
  updateComposer();
  try {
    let imported;
    if (!files) imported = await window.bot.chooseAttachments();
    else imported = await window.bot.attachFiles(Array.from(files));
    const additions = (Array.isArray(imported) ? imported : imported?.attachments || []).filter((item) => attachmentSource(item));
    const existing = attachmentDrafts.get(key) || [];
    const unique = [...existing, ...additions.filter((item) => !existing.some((saved) => saved.id === item.id))];
    if (unique.length > 8) notify('Only the first 8 files were added.', true);
    const retained = unique.slice(0, 8);
    attachmentDrafts.set(key, retained);
    await releaseAttachments((Array.isArray(imported) ? imported : imported?.attachments || []).filter(item => !retained.some(saved => saved.id === item.id)));
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    attachmentImportPending = false;
    updateComposer();
  }
}

async function pasteAttachments(files) {
  if (sending || attachmentImportPending) return;
  const key = draftKey();
  if ((attachmentDrafts.get(key) || []).length + files.length > 8) return notify('Attach up to 8 files per message.', true);
  if (files.some((file) => file.size > 20 * 1024 * 1024)) return notify('Each attachment must be under 20 MB.', true);
  attachmentImportPending = true;
  updateComposer();
  try {
    for (const file of files) {
      const imported = await window.bot.importAttachment({ name: file.name || 'pasted-image.png', bytes: await file.arrayBuffer() });
      const additions = Array.isArray(imported) ? imported : imported?.attachments || [imported];
      const existing = attachmentDrafts.get(key) || [];
      const retained = [...existing, ...additions.filter((item) => attachmentSource(item) && !existing.some((saved) => saved.id === item.id))].slice(0, 8);
      attachmentDrafts.set(key, retained);
      await releaseAttachments(additions.filter(item => !retained.some(saved => saved.id === item.id)));
    }
  } catch (error) { notify(error?.message || String(error), true); }
  finally { attachmentImportPending = false; updateComposer(); }
}

async function releaseAttachments(items) {
  await Promise.all(items.map(item => window.bot.releaseAttachment?.({ id: item.id })));
}

function renderReasoning(message, key, existing) {
  const details = existing || element('details', 'reasoning-details');
  if (!existing) {
    details.dataset.reasoningId = key;
    details.open = expandedReasoning.has(key);
    const summary = element('summary');
    summary.append(icon('chevron-down'), element('span', 'reasoning-label'));
    const content = element('div', 'reasoning-content');
    content.tabIndex = 0;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-label', 'Model reasoning');
    details.append(summary, content);
    details.addEventListener('toggle', () => {
      if (details.open) expandedReasoning.add(key);
      else expandedReasoning.delete(key);
    });
  }
  const running = message.status === 'running';
  const label = running ? 'Thinking…' : message.status === 'interrupted' ? 'Thinking stopped' : 'Thoughts';
  const summaryLabel = details.querySelector('.reasoning-label');
  if (summaryLabel.textContent !== label) summaryLabel.textContent = label;
  details.classList.toggle('running', running);
  const content = details.querySelector('.reasoning-content');
  const scrollTop = content.scrollTop;
  const text = message.text || (running ? 'Waiting for reasoning…' : 'No reasoning text was received.');
  if (content.textContent !== text) {
    // Keep the current text node during streamed appends so reading and selection stay stable.
    if (content.firstChild?.nodeType === Node.TEXT_NODE && text.startsWith(content.textContent)) content.firstChild.appendData(text.slice(content.textContent.length));
    else content.textContent = text;
  }
  content.classList.toggle('empty', !message.text);
  content.scrollTop = scrollTop;
  return details;
}

function replaceConversationItems(host, items) {
  // Leave retained nodes mounted so selection, disclosures, focus, and media survive updates.
  const retained = new Set(items.filter(item => item.parentNode === host));
  for (const child of Array.from(host.childNodes)) if (!retained.has(child)) child.remove();
  let cursor = host.firstChild;
  for (const item of items) {
    if (item === cursor) cursor = cursor.nextSibling;
    else host.insertBefore(item, cursor);
  }
}

function independentCheckSummary(record) {
  if (record?.status === 'running') return 'Independent check in progress…';
  if (record?.status === 'failed') return 'Independent check unavailable';
  if (record?.status === 'interrupted') return 'Independent check stopped';
  if (record?.revisionApplied) return 'Independent check revised this answer';
  if (record?.assessment === 'supported') return 'Independent check: supported';
  if (record?.assessment === 'unsupported') return 'Independent check: unsupported';
  if (record?.assessment === 'preference') return 'Independent check: preference';
  if (record?.assessment === 'not_applicable') return 'Independent check: no material claim';
  return 'Independent check: mixed';
}

let answerMenu = null;
function closeAnswerMenu() {
  if (answerMenu?.matches(':popover-open')) answerMenu.hidePopover();
}
window.addEventListener('resize', closeAnswerMenu);
document.addEventListener('scroll', closeAnswerMenu, true);

function showAnswerMenu(event, node, chatId, messageId) {
  const chat = state?.chats?.find(item => item.id === chatId);
  const message = chat?.messages?.find(item => item.id === messageId);
  if (!window.LittleBotIndependentCheck.eligible(message)) return;
  event.preventDefault();
  closeAnswerMenu();
  if (!answerMenu) {
    answerMenu = element('div', 'answer-context-menu');
    answerMenu.setAttribute('popover', 'auto');
    answerMenu.setAttribute('role', 'menu');
    answerMenu.setAttribute('aria-label', 'Answer actions');
    document.body.append(answerMenu);
  }
  const record = message.independentCheck;
  const button = action(record?.status === 'failed' || record?.status === 'interrupted' ? 'Run check again' : 'Challenge this answer', async () => {
    closeAnswerMenu();
    node.focus({ preventScroll: true });
    const result = await attempt(() => window.bot.challengeIndependentCheck({ chatId, messageId }));
    if (result) notify('Independent Check started.');
  }, 'button text-button');
  button.setAttribute('role', 'menuitem');
  button.disabled = chat.status !== 'idle' || record?.status === 'running' || !isReady() || !isConnected();
  button.title = button.disabled ? 'Wait for the current task to finish.' : 'Force a sequential Independent Check of this answer.';
  answerMenu.replaceChildren(button);
  answerMenu.showPopover();
  const anchor = node.getBoundingClientRect();
  const x = event.clientX || anchor.left;
  const y = event.clientY || anchor.top;
  answerMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - answerMenu.offsetWidth - 8))}px`;
  answerMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - answerMenu.offsetHeight - 8))}px`;
  button.focus();
}

function renderIndependentCheck(node, chat, message) {
  node.querySelector(':scope > .independent-check')?.remove();
  node.querySelector(':scope > .independent-check-actions')?.remove();
  const eligible = window.LittleBotIndependentCheck.eligible(message);
  node.oncontextmenu = eligible ? event => showAnswerMenu(event, node, chat.id, message.id) : null;
  if (eligible) node.tabIndex = 0;
  else node.removeAttribute('tabindex');
  if (!eligible) return;

  const record = message.independentCheck;
  if (record) {
    const details = element('details', 'independent-check');
    details.open = Boolean(record.revisionApplied || record.status === 'failed');
    const summary = element('summary');
    summary.append(icon('shield'), element('span', 'independent-check-label', independentCheckSummary(record)));
    details.append(summary);
    const body = element('div', 'independent-check-body');
    if (record.status === 'running') body.append(element('p', '', 'The same selected model is reviewing the answer sequentially without tools.'));
    else if (record.error) body.append(element('p', 'inline-error', record.error), element('p', 'field-hint', 'The completed draft was kept.'));
    else {
      if (record.strongestCounterpoint) body.append(element('p', '', record.strongestCounterpoint));
      const meta = [];
      if (record.assessment) meta.push(`Assessment: ${humanStatus(record.assessment)}`);
      if (Number.isFinite(record.confidence)) meta.push(`Confidence: ${Math.round(record.confidence * 100)}%`);
      if (meta.length) body.append(element('p', 'field-hint', meta.join(' · ')));
      if (record.wouldChangeConclusion?.length) {
        const list = element('ul', 'independent-check-change-list');
        for (const condition of record.wouldChangeConclusion) list.append(element('li', '', condition));
        body.append(element('strong', '', 'Would change the conclusion:'), list);
      }
      if (record.revisionApplied && record.originalAnswer) {
        const original = element('details', 'independent-check-original');
        original.append(element('summary', '', 'Draft before the check'), element('pre', '', record.originalAnswer));
        body.append(original);
      }
    }
    details.append(body);
    node.append(details);
  }

}

function conversationMessage(chat, message, index) {
  const key = `${chat.id}:${message.id || index}`;
  const fingerprint = [message.role, message.kind, message.status, message.phase, message.text, JSON.stringify(message.attachments || []),
    JSON.stringify(message.independentCheck || null), chat.status, message.automationId, message.automationName, message.goalId, state.goalRuntime?.status, state.goalRuntime?.goalId, JSON.stringify(state.autonomy?.goals?.find(g => g.id === message.goalId)?.pendingQuestion || null)];
  const previous = renderedMessages.get(key);
  if (previous && fingerprint.every((value, position) => value === previous.fingerprint[position])) return previous.node;
  const variant = message.kind === 'compaction' ? 'compaction' : message.role === 'assistant' && message.kind === 'reasoning' ? 'reasoning'
    : message.role === 'assistant' && message.kind === 'plan' ? 'plan'
    : message.role === 'tool' ? `tool:${message.kind || ''}` : message.role === 'user' ? 'user' : 'assistant';
  const retained = previous?.variant === variant ? previous.node : null;
  let node = retained;
  if (variant === 'compaction') {
    if (!node) {
      node = element('div', 'compaction-boundary');
      node.append(icon('compact'), element('span'));
      node.title = 'The model summarizes older context. Your visible conversation history and saved memory stay available.';
    }
    node.lastChild.textContent = message.text || (message.status === 'running' || message.status === 'inProgress' ? 'Summarizing older context…' : 'Older context summarized');
  } else if (variant === 'reasoning') {
    node = renderReasoning(message, key, retained);
  } else if (message.role === 'tool') {
    if (!node) {
      node = element('div', 'tool-message');
      const details = element('details', 'tool-details');
      details.dataset.toolId = key;
      details.open = expandedTools.has(key);
      details.addEventListener('toggle', () => {
        if (details.open) expandedTools.add(key);
        else expandedTools.delete(key);
      });
      const summary = element('summary');
      const label = message.kind === 'command' ? 'Terminal command' : message.kind === 'file' ? 'File changes' : message.kind === 'mcp' ? 'External MCP tool' : message.kind || 'Tool activity';
      summary.append(icon(message.kind === 'command' ? 'terminal' : message.kind === 'file' ? 'folder' : message.kind === 'mcp' ? 'extensions' : 'sparkles'), element('strong', '', label), element('span', 'tool-status'));
      details.append(summary, element('pre'));
      node.append(details);
    }
    const status = node.querySelector('.tool-status');
    const statusText = message.status ? humanStatus(message.status) : '';
    if (status.textContent !== statusText) status.textContent = statusText;
    const output = node.querySelector('pre');
    const text = message.text || 'Waiting for output…';
    if (output.textContent !== text) {
      const top = output.scrollTop, left = output.scrollLeft;
      if (output.firstChild?.nodeType === Node.TEXT_NODE && text.startsWith(output.textContent)) output.firstChild.appendData(text.slice(output.textContent.length));
      else output.textContent = text;
      output.scrollTop = top; output.scrollLeft = left;
    }
  } else {
    if (!node) {
      node = element('article', `message ${variant}`);
      if (variant === 'user' && message.automationId) node.append(element('div', 'message-label automation-label', `Scheduled · ${message.automationName || 'Automation'}`));
      if (variant === 'assistant' || variant === 'plan') {
        const label = element('div', 'message-label');
        label.append(element('span', 'mini-mark', variant === 'plan' ? 'P' : '✳'), document.createTextNode(variant === 'plan' ? 'Plan' : message.goalId ? `Goal · ${message.goalName || 'Little Bot'}` : message.kind === 'heartbeat' ? `Little Bot · on its own${message.heartbeatTopic ? ` · ${message.heartbeatTopic}` : ''}` : message.automationId ? `Little Bot · ${message.automationName || 'Automation'}` : 'Little Bot'));
        node.append(label);
      }
      node.append(element('div', 'message-content'));
    }
    if (!retained || previous.fingerprint[4] !== fingerprint[4]) {
      const content = node.querySelector('.message-content');
      content.replaceChildren();
      if (variant === 'user') content.textContent = message.text || '';
      else renderMessageText(content, message.text || '');
    }
    if (!retained || previous.fingerprint[5] !== fingerprint[5]) {
      node.querySelector(':scope > .attachment-list')?.remove();
      renderAttachments(node, message.attachments);
    }
    renderIndependentCheck(node, chat, message);
    if (message.goalId) {
      const goal = state.autonomy?.goals?.find(g => g.id === message.goalId);
      const existing = node.querySelector('.goal-question');
      if (goal?.pendingQuestion?.id === message.goalQuestionId) { const form = renderGoalQuestion(goal, existing); if (form && !form.isConnected) node.append(form); }
      else existing?.remove();
    }
  }
  node.dataset.messageId = message.id || String(index);
  renderedMessages.set(key, { node, variant, fingerprint });
  return node;
}

function updateActionGroupSummary(node, messages) {
  const summary = LittleBotActionGroups.summarize(messages);
  node.querySelector('.action-group-count').textContent = summary.label;
  node.querySelector('.action-group-status').textContent = summary.status;
  node.classList.toggle('running', summary.running > 0);
  node.classList.toggle('failed', summary.failed > 0);
}

function actionGroupNode(chat, group) {
  const key = `${chat.id}:actions:${group.key}`;
  let node = renderedActionGroups.get(key);
  if (!node) {
    node = element('div', 'action-group');
    const details = element('details', 'action-group-details');
    details.open = expandedActionGroups.has(key);
    details.addEventListener('toggle', () => {
      if (details.open) expandedActionGroups.add(key);
      else expandedActionGroups.delete(key);
    });
    const summary = element('summary');
    summary.append(icon('sparkles'), element('strong', '', 'Tool calls'), element('span', 'action-group-count'), element('span', 'action-group-status'));
    details.append(summary, element('div', 'action-group-body'));
    node.append(details);
    renderedActionGroups.set(key, node);
  }
  const messages = group.tools.map(({ message }) => message);
  updateActionGroupSummary(node, messages);
  node.dataset.actionMessageIds = JSON.stringify(messages.map(message => message.id));
  const children = group.entries.map(({ message, index }) => conversationMessage(chat, message, index));
  replaceConversationItems(node.querySelector('.action-group-body'), children);
  return node;
}

function refreshActionGroupForMessage(chat, node) {
  const group = node.closest('.action-group');
  if (!group) return;
  let ids = [];
  try { ids = JSON.parse(group.dataset.actionMessageIds || '[]'); } catch {}
  const messages = ids.map(id => chat.messages.find(message => message.id === id)).filter(Boolean);
  if (messages.length) updateActionGroupSummary(group, messages);
}

function formatTaskDuration(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function taskSummaryNode(chat) {
  const task = chat?.lastTask;
  if (!task || chat.status !== 'idle') return null;
  const parts = [`${task.status === 'completed' ? 'Finished' : task.status === 'interrupted' ? 'Stopped' : 'Failed'} in ${formatTaskDuration(task.durationMs)}`];
  if (task.actions) parts.push(`${task.actions} ${task.actions === 1 ? 'action' : 'actions'}`);
  if (task.commands) parts.push(`${task.commands} ${task.commands === 1 ? 'command' : 'commands'}`);
  if (task.files) parts.push(`${task.files} file ${task.files === 1 ? 'change' : 'changes'}`);
  if (task.searches) parts.push(`${task.searches} ${task.searches === 1 ? 'search' : 'searches'}`);
  if (task.mcp) parts.push(`${task.mcp} MCP`);
  if (task.agentTools) parts.push(`${task.agentTools} app ${task.agentTools === 1 ? 'tool' : 'tools'}`);
  return element('div', `task-summary ${task.status || ''}`, parts.join(' · '));
}

function conversationActivityNode(chat) {
  const active = chat.status === 'running' && !chat.messages.some(message => message.kind === 'reasoning' && message.status === 'running');
  if (!active) return null;
  const reviewStartedAt = state?.independentCheckRuntime?.chatId === chat.id ? state.independentCheckRuntime.startedAt : null;
  const startedAt = chat.taskRun?.startedAt || reviewStartedAt;
  const elapsed = startedAt ? ` · ${formatTaskDuration(Date.now() - startedAt)}` : '';
  const reviewing = state?.independentCheckRuntime?.chatId === chat.id;
  const label = chat.compaction?.status === 'running' ? 'Summarizing older context…' : reviewing ? `Independent check…${elapsed}` : `Working…${elapsed}`;
  if (!conversationActivity) {
    conversationActivity = element('div', 'thinking');
    conversationActivity.append(element('span', 'status-dot'), element('span', 'thinking-label', label));
  } else if (conversationActivity.querySelector('.thinking-label')?.textContent !== label) {
    conversationActivity.querySelector('.thinking-label').textContent = label;
  }
  return conversationActivity;
}

function updateTaskClock() {
  if (currentView !== 'chat') return;
  const chat = currentChat();
  const reviewStartedAt = state?.independentCheckRuntime?.chatId === chat?.id ? state.independentCheckRuntime.startedAt : null;
  const startedAt = chat?.taskRun?.startedAt || reviewStartedAt;
  if (!chat || chat.status !== 'running' || !startedAt || chat.compaction?.status === 'running') return;
  const label = conversationActivity?.querySelector('.thinking-label');
  if (label) label.textContent = reviewStartedAt
    ? `Independent check… · ${formatTaskDuration(Date.now() - startedAt)}`
    : `Working… · ${formatTaskDuration(Date.now() - startedAt)}`;
  if (agentInspectorOpen && currentView === 'chat') $('inspector-elapsed').textContent = inspectorElapsedText(chat);
}
taskClockTimer = setInterval(updateTaskClock, 1000);
taskClockTimer.unref?.();

function renderStreamedMessages(chat, messages, indexes) {
  if (renderedChatId !== chat.id || messages.some(message => {
    const previous = renderedMessages.get(`${chat.id}:${message.id}`)?.fingerprint;
    return !previous || previous[0] !== message.role || previous[1] !== message.kind || previous[3] !== message.phase;
  })) {
    renderConversation();
    return;
  }
  const scrollSnapshot = captureChatScroll();
  for (const message of messages) {
    const previous = renderedMessages.get(`${chat.id}:${message.id}`).node;
    const node = conversationMessage(chat, message, indexes.get(message.id));
    if (node !== previous) previous.replaceWith(node);
    if (message.role === 'tool') refreshActionGroupForMessage(chat, node);
  }
  const activity = conversationActivityNode(chat);
  if (activity && activity.parentNode !== $('messages')) $('messages').append(activity);
  else if (!activity) conversationActivity?.remove();
  restoreChatScroll(scrollSnapshot);
  if (agentInspectorOpen) renderAgentInspector();
}

function renderConversation() {
  const chat = currentChat();
  if (renderedChatId !== (chat?.id || null)) {
    renderedChatId = chat?.id || null;
    renderedMessages.clear();
    renderedActionGroups.clear();
    conversationActivity = null;
  }
  const hasMessages = Boolean(chat?.messages?.length);
  $('welcome').classList.toggle('hidden', hasMessages);
  $('messages').classList.toggle('hidden', !hasMessages);
  const scrollSnapshot = captureChatScroll();
  if (hasMessages) {
    const items = [];
    const keys = new Set();
    const actionKeys = new Set();
    for (const unit of LittleBotActionGroups.groupConversation(chat.messages)) {
      if (unit.type === 'message') {
        const { message, index } = unit;
        keys.add(`${chat.id}:${message.id || index}`);
        items.push(conversationMessage(chat, message, index));
        continue;
      }
      const actionKey = `${chat.id}:actions:${unit.key}`;
      actionKeys.add(actionKey);
      for (const { message, index } of unit.entries) keys.add(`${chat.id}:${message.id || index}`);
      items.push(actionGroupNode(chat, unit));
    }
    for (const key of renderedMessages.keys()) if (!keys.has(key)) renderedMessages.delete(key);
    for (const key of renderedActionGroups.keys()) if (!actionKeys.has(key)) renderedActionGroups.delete(key);
    const summary = taskSummaryNode(chat);
    if (summary) items.push(summary);
    const activity = conversationActivityNode(chat);
    if (activity) items.push(activity);
    replaceConversationItems($('messages'), items);
  } else {
    renderedMessages.clear();
    renderedActionGroups.clear();
    conversationActivity = null;
    $('messages').replaceChildren();
  }
  const error = [chat?.error || (state.runtime?.status === 'error' ? state.runtime.error || 'The local engine could not start.' : ''), state.storageWarning].filter(Boolean).join('\n');
  $('chat-error').textContent = error;
  $('chat-error').classList.toggle('hidden', !error);
  if (hasMessages) restoreChatScroll(scrollSnapshot);
}

function updateComposer() {
  const chat = currentChat();
  const running = chat?.status === 'running' || chat?.status === 'waiting' || chat?.compaction?.status === 'running' || compactionPending.has(chat?.id);
  const canSend = Boolean(state && isConnected() && isReady() && !running && !sending && !thinkingSaving && !attachmentImportPending && ($('message-input').value.trim() || queuedAttachments().length));
  $('send-button').disabled = !canSend;
  $('send-button').classList.toggle('hidden', Boolean(running));
  $('stop-button').classList.toggle('hidden', !running);
  $('message-input').disabled = sending;
  $('model-select').disabled = Boolean(running || sending || thinkingSaving || !isReady());
  $('effort-select').disabled = Boolean(running || sending || thinkingSaving || !isReady());
  $('plan-mode-toggle').disabled = Boolean(running || sending || !isReady());
  $('plan-mode-toggle').setAttribute('aria-pressed', String(Boolean(currentPlanMode())));
  $('plan-mode-toggle').classList.toggle('active', Boolean(currentPlanMode()));
  $('message-input').placeholder = currentPlanMode() ? 'Ask Little Bot to plan…' : 'Message Little Bot…';
  renderThinkingControl();
  renderAttachmentQueue();
  renderChatContext();
}

function thinkingChangeBlocked() {
  return Boolean(thinkingSaving || sending || connectionPending || !isReady() || compactionPending.size
    || (state?.chats || []).some(chat => chat.status !== 'idle' || chat.compaction?.status === 'running')
    || state?.heartbeat?.lastStatus === 'running' || heartbeatManualPending
    || (state?.goalRuntime?.status && state.goalRuntime.status !== 'idle')
    || (state?.autonomy?.goals || []).some(goal => goal.status === 'running')
    || state?.extensionsBusy || state?.extensionRuntime?.status === 'syncing' || extensionsRefreshing || extensionPending.size);
}

function renderThinkingControl() {
  const local = connectionType() === 'local';
  const strata = isStrataLocal();
  const enabled = state?.settings?.localThinking !== false;
  const none = $('effort-none');
  none.hidden = !strata;
  $('effort-select').classList.toggle('hidden', local && !strata);
  $('effort-select').title = strata ? 'Strata reasoning level' : 'Reasoning effort';
  $('effort-select').setAttribute('aria-label', strata ? 'Strata reasoning level' : 'Reasoning effort');
  if (strata) $('effort-select').value = enabled ? (state.settings.effort || 'low') : 'none';
  else if ($('effort-select').value === 'none') $('effort-select').value = state.settings.effort || 'medium';
  $('thinking-toggle').classList.toggle('hidden', !local || strata);
  $('thinking-toggle').setAttribute('aria-checked', String(enabled));
  $('thinking-toggle').setAttribute('aria-busy', String(thinkingSaving));
  $('thinking-toggle').disabled = thinkingChangeBlocked();
  $('thinking-value').textContent = enabled ? 'On' : 'Off';
}

async function toggleThinking() {
  if (connectionType() !== 'local' || isStrataLocal() || thinkingChangeBlocked()) return;
  const localThinking = state.settings.localThinking === false;
  thinkingSaving = true;
  updateComposer();
  try { await attempt(() => window.bot.saveSettings({ localThinking })); }
  finally {
    thinkingSaving = false;
    updateComposer();
  }
}

async function changeReasoningEffort() {
  const value = $('effort-select').value;
  if (isStrataLocal()) {
    if (!['none', 'low', 'medium', 'high'].includes(value) || thinkingChangeBlocked()) return;
    thinkingSaving = true;
    updateComposer();
    try {
      const localThinking = value !== 'none';
      await attempt(() => window.bot.saveSettings({
        model: $('model-select').value,
        localThinking,
        ...(localThinking ? { effort: value } : {}),
      }));
    } finally {
      thinkingSaving = false;
      updateComposer();
    }
    return;
  }
  await attempt(() => window.bot.saveSettings({ model: $('model-select').value, effort: value }));
}

function taskReasoningLabel(connection, effort, model) {
  const sameStrataModel = connection === 'local' && state?.connection?.adapter === 'strata'
    && (!model || model === state.connection.model);
  if (sameStrataModel) {
    return state.settings.localThinking === false ? 'Reasoning none' : `Reasoning ${effort || 'low'}`;
  }
  return connection === 'local' ? `Thinking ${state.settings.localThinking === false ? 'off' : 'on'}` : `${effort || 'low'} effort`;
}

function compactDisabledReason(chat) {
  if (!chat?.threadId) return 'Start a conversation before compacting its model context.';
  if (chat.compaction?.status === 'running' || compactionPending.has(chat.id)) return 'This conversation is already compacting.';
  if (chat.status !== 'idle' || sending) return 'Wait for the current reply to finish before compacting.';
  if (!isReady()) return 'Wait for the local engine to be ready.';
  if (!isConnected()) return 'Connect a model before compacting.';
  if (state.extensionsBusy || state.extensionRuntime?.status === 'syncing' || extensionsRefreshing) return 'Wait for the extension operation to finish before compacting.';
  if (state.heartbeat?.lastStatus === 'running' || heartbeatManualPending) return 'Wait for the Heartbeat check to finish, or stop it first.';
  return '';
}

function inspectorModeLabel(chat) {
  const mode = chat?.mode === 'plan' ? 'Plan' : 'Execute';
  return chat?.private ? `Private · ${mode}` : mode;
}

function inspectorElapsedText(chat) {
  if (chat?.taskRun?.startedAt) return formatTaskDuration(Date.now() - chat.taskRun.startedAt);
  if (chat?.lastTask?.durationMs != null) return formatTaskDuration(chat.lastTask.durationMs);
  return '—';
}

function inspectorActionLabel(message) {
  if (!message) return 'No active action.';
  const firstLine = String(message.text || '').split(/\r?\n/, 1)[0].replace(/^\$\s*/, '').trim();
  if (message.kind === 'command') return firstLine ? `Terminal · ${firstLine.slice(0, 120)}` : 'Terminal command';
  if (message.kind === 'file') return 'Updating files';
  if (message.kind === 'search') return firstLine ? `Search · ${firstLine.slice(0, 120)}` : 'Web search';
  if (message.kind === 'mcp') return firstLine ? `MCP · ${firstLine.slice(0, 120)}` : 'External MCP tool';
  if (message.kind === 'agent') return firstLine || 'App tool';
  if (message.kind === 'reasoning') return 'Thinking';
  if (message.kind === 'plan') return 'Writing plan';
  return firstLine || 'Working';
}

function inspectorFilePaths(chat) {
  const paths = [];
  const seen = new Set();
  for (const message of [...(chat?.messages || [])].reverse()) {
    if (message.role !== 'tool' || message.kind !== 'file') continue;
    for (const block of String(message.text || '').split(/\n\n+/)) {
      const path = block.split(/\r?\n/, 1)[0].trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
      if (paths.length >= 8) return paths;
    }
  }
  return paths;
}

function renderContextUsedSnapshot(snapshot, chat) {
  const host = $('inspector-context-used');
  if (!chat) {
    $('inspector-memory-status').textContent = 'Send a message to inspect its context.';
    host.replaceChildren(element('p', 'inspector-empty', 'No turn context captured yet.'));
    return;
  }
  if (!chat.contextUsedAt) {
    $('inspector-memory-status').textContent = chat.private ? 'Private session · saved memory is not recalled.' : 'No turn context captured yet.';
    host.replaceChildren(element('p', 'inspector-empty', 'A snapshot appears after the next turn starts.'));
    return;
  }
  if (!snapshot) {
    $('inspector-memory-status').textContent = 'Loading latest turn context…';
    host.replaceChildren(element('p', 'inspector-empty', 'Loading context snapshot…'));
    return;
  }

  $('inspector-memory-status').textContent = `${snapshot.memoryStatus || 'Memory status unavailable'} · Captured ${formatDate(snapshot.at)} · This snapshot is kept only for the current app session.`;
  const entries = [
    { label: snapshot.developerInstructionsLabel || 'System prompt', text: snapshot.developerInstructions, kind: 'system' },
    ...(Array.isArray(snapshot.inputBlocks) ? snapshot.inputBlocks : []),
  ].filter(entry => typeof entry.text === 'string' && entry.text.length);

  const nodes = entries.map(entry => {
    const details = element('details', 'inspector-context-block');
    const summary = element('summary');
    summary.append(
      element('strong', '', entry.label || entry.kind || 'Context'),
      element('span', '', `${entry.text.length.toLocaleString()} chars`),
    );
    const pre = element('pre', '', entry.text);
    details.append(summary, pre);
    return details;
  });
  if (snapshot.nonTextInputs) {
    const note = element('p', 'inspector-context-note', `${snapshot.nonTextInputs} non-text attachment input${snapshot.nonTextInputs === 1 ? '' : 's'} accompanied this turn.`);
    nodes.push(note);
  }
  host.replaceChildren(...(nodes.length ? nodes : [element('p', 'inspector-empty', 'No injected context blocks were recorded.')]));
}

function loadContextUsed(chat, force = false) {
  if (!chat?.contextUsedAt || typeof window.bot?.getContextUsed !== 'function') {
    renderContextUsedSnapshot(null, chat);
    return;
  }
  const cached = contextUsedCache.get(chat.id);
  if (!force && cached?.at === chat.contextUsedAt) {
    renderContextUsedSnapshot(cached, chat);
    return;
  }
  if (contextUsedPending.get(chat.id) === chat.contextUsedAt) return;
  contextUsedPending.set(chat.id, chat.contextUsedAt);
  renderContextUsedSnapshot(null, chat);
  window.bot.getContextUsed({ chatId: chat.id }).then(snapshot => {
    if (snapshot?.at) contextUsedCache.set(chat.id, snapshot);
    if (selectedChatId === chat.id && agentInspectorOpen && currentView === 'chat') renderContextUsedSnapshot(snapshot, currentChat());
  }).catch(error => {
    if (selectedChatId === chat.id && agentInspectorOpen) {
      $('inspector-memory-status').textContent = error?.message || 'Could not load the context snapshot.';
      $('inspector-context-used').replaceChildren(element('p', 'inspector-empty', 'Context snapshot unavailable.'));
    }
  }).finally(() => {
    if (contextUsedPending.get(chat.id) === chat.contextUsedAt) contextUsedPending.delete(chat.id);
  });
}

function setAgentInspectorOpen(open) {
  agentInspectorOpen = Boolean(open);
  try { localStorage.setItem('little-bot.agent-inspector-open', String(agentInspectorOpen)); } catch {}
  renderAgentInspector();
}

function renderAgentInspector() {
  const visible = currentView === 'chat' && agentInspectorOpen;
  $('agent-inspector-toggle').classList.toggle('hidden', currentView !== 'chat');
  $('agent-inspector-toggle').setAttribute('aria-pressed', String(visible));
  $('agent-inspector').classList.toggle('hidden', !visible);
  $('chat-view').classList.toggle('inspector-open', visible);
  if (!visible) return;

  const chat = currentChat();
  const status = !chat ? 'No conversation' : chat.status === 'waiting' ? 'Waiting for input' : chat.status === 'running' ? 'Working' : chat.error ? 'Failed' : 'Idle';
  $('inspector-status').textContent = status;
  $('inspector-status-dot').className = `status-dot ${chat?.error ? 'error' : chat?.status === 'running' || chat?.status === 'waiting' ? 'starting' : ''}`.trim();
  $('inspector-mode').textContent = inspectorModeLabel(chat);
  $('inspector-elapsed').textContent = inspectorElapsedText(chat);

  const model = chat?.model || state?.settings?.model || '—';
  const connection = chat?.connection || state?.connection?.type || state?.settings?.connection;
  $('inspector-model').textContent = [connection === 'local' ? 'Local' : connection === 'codex' ? 'Codex' : '', model].filter(Boolean).join(' · ') || '—';

  const context = chat?.context || {};
  const used = Number.isFinite(context.usedTokens) ? context.usedTokens : null;
  const total = Number.isFinite(context.windowTokens) && context.windowTokens > 0 ? context.windowTokens : null;
  $('inspector-context').textContent = context.stale ? 'Refreshing…'
    : used !== null && total !== null ? `${Math.round(used / total * 100)}% · ${Math.round(used).toLocaleString()} / ${Math.round(total).toLocaleString()}`
      : used !== null ? `${Math.round(used).toLocaleString()} tokens` : 'Not reported';

  const active = [...(chat?.messages || [])].reverse().find(message =>
    ['running', 'inProgress', 'pending', 'waiting'].includes(message.status)
    && (message.role === 'tool' || ['reasoning', 'plan'].includes(message.kind)));
  $('inspector-current').textContent = chat?.status === 'waiting' ? 'Waiting for your input.' : active ? inspectorActionLabel(active) : chat?.status === 'running' ? 'Preparing the next action…' : 'No active action.';

  const latestPlan = [...(chat?.messages || [])].reverse().find(message => message.role === 'assistant' && message.kind === 'plan' && String(message.text || '').trim());
  $('inspector-plan-section').classList.toggle('hidden', !latestPlan);
  $('inspector-plan').textContent = latestPlan ? String(latestPlan.text).trim().slice(0, 900) : '';

  const tools = (chat?.messages || []).filter(message => message.role === 'tool').slice(-8).reverse();
  const actionItems = tools.map(message => {
    const item = element('div', 'inspector-list-item');
    const copy = element('div');
    copy.append(element('strong', '', inspectorActionLabel(message)), element('span', '', humanStatus(message.status || 'completed')));
    item.append(icon(message.kind === 'command' ? 'terminal' : message.kind === 'file' ? 'folder' : message.kind === 'mcp' ? 'extensions' : 'sparkles'), copy);
    return item;
  });
  $('inspector-actions').replaceChildren(...(actionItems.length ? actionItems : [element('p', 'inspector-empty', 'No actions yet.')]));

  const files = inspectorFilePaths(chat);
  $('inspector-files').replaceChildren(...(files.length
    ? files.map(path => {
        const item = element('div', 'inspector-file');
        item.title = path;
        item.append(icon('file'), element('span', '', path));
        return item;
      })
    : [element('p', 'inspector-empty', 'No file changes yet.')]));
  loadContextUsed(chat);
}

function renderChatContext() {
  const chat = currentChat();
  $('chat-context').classList.toggle('hidden', !chat?.threadId);
  if (!chat?.threadId) return;
  const context = chat.context || {};
  const compaction = chat.compaction || {};
  const pending = compaction.status === 'running' || compactionPending.has(chat.id);
  const used = typeof context.usedTokens === 'number' && Number.isFinite(context.usedTokens) && context.usedTokens >= 0 ? context.usedTokens : null;
  const windowTokens = typeof context.windowTokens === 'number' && Number.isFinite(context.windowTokens) && context.windowTokens > 0 ? context.windowTokens : null;
  const usableMeter = used !== null && windowTokens !== null && !context.stale;
  const formatTokens = (tokens) => Math.round(tokens).toLocaleString();
  const label = context.stale ? 'Awaiting updated context usage' : used === null ? 'Usage not reported yet' : windowTokens === null ? `${formatTokens(used)} tokens · window not reported` : `${formatTokens(used)} / ${formatTokens(windowTokens)} tokens`;
  $('context-usage-label').textContent = label;
  $('context-usage-label').title = `Latest engine-reported context usage, not cumulative usage.${context.updatedAt ? ` Last report: ${formatDate(context.updatedAt)}.` : ''}${context.stale ? ' The previous report predates compaction.' : ''}`;
  $('context-usage-meter').classList.toggle('hidden', !usableMeter);
  $('context-usage-percent').classList.toggle('hidden', !usableMeter);
  if (usableMeter) {
    const percentage = Math.round(used / windowTokens * 100);
    $('context-usage-meter').value = Math.min(100, percentage);
    $('context-usage-meter').setAttribute('aria-valuetext', `${formatTokens(used)} of ${formatTokens(windowTokens)} tokens`);
    $('context-usage-percent').textContent = `${percentage}%`;
    $('context-usage-meter').classList.toggle('near-limit', percentage >= (state.settings.autoCompactPercent || 80));
  } else {
    $('context-usage-meter').removeAttribute('value');
    $('context-usage-meter').removeAttribute('aria-valuetext');
    $('context-usage-percent').textContent = '';
  }
  const compactPercent = state.settings.autoCompactPercent ?? 80;
  $('context-compaction-status').textContent = pending ? 'Compacting…' : compactPercent ? `Auto-compact · ${compactPercent}%` : 'Auto-compact · default';
  $('context-compaction-status').classList.toggle('compacting', pending);
  const count = Number.isInteger(compaction.count) && compaction.count > 0 ? compaction.count : 0;
  $('context-compaction-summary').textContent = count ? `${count} compaction${count === 1 ? '' : 's'}` : '';
  $('context-compaction-summary').title = compaction.lastAt ? `Last compacted ${formatDate(compaction.lastAt)}` : '';
  $('context-compaction-error').textContent = compaction.lastError || '';
  $('context-compaction-error').classList.toggle('hidden', !compaction.lastError);
  const reason = compactDisabledReason(chat);
  $('compact-chat').disabled = Boolean(reason);
  $('compact-chat').title = reason || 'Summarize older model context now. Your conversation and durable memory are preserved.';
  $('compact-chat').replaceChildren(icon('compact'), document.createTextNode(pending ? 'Compacting…' : 'Compact now'));
}

async function compactChat() {
  const chat = currentChat();
  const reason = compactDisabledReason(chat);
  if (reason) { notify(reason); return; }
  compactionPending.add(chat.id);
  updateComposer();
  try {
    const result = await window.bot.compact({ chatId: chat.id });
    if (result?.settings) applyState(result);
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    compactionPending.delete(chat.id);
    updateComposer();
  }
}

function sizeComposer() {
  const input = $('message-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(Math.max(input.scrollHeight, 67), 180)}px`;
}

function clearComposerDraft({ attachments = false } = {}) {
  const key = draftKey();
  $('message-input').value = '';
  chatDrafts.delete(key);
  if (attachments) {
    void releaseAttachments(attachmentDrafts.get(key) || []).catch(error => notify(error.message || String(error), true));
    attachmentDrafts.delete(key);
  }
  sizeComposer();
  updateComposer();
}

function commandDraftName(value, fallback) {
  const first = String(value || '').split(/[\r\n.!?]/, 1)[0].trim();
  return (first || fallback).slice(0, 80);
}

async function executeSlashCommand(parsed) {
  const chat = currentChat();
  const running = chat?.status === 'running' || chat?.status === 'waiting' || chat?.compaction?.status === 'running' || compactionPending.has(chat?.id);
  if (!parsed.known) {
    clearComposerDraft();
    notify(`Unknown command /${parsed.name || '?'}. Use /help to see available commands.`, true);
    return true;
  }

  const args = parsed.args;
  switch (parsed.name) {
    case 'help':
      clearComposerDraft();
      notify(`Commands: ${LittleBotSlashCommands.helpText()}`);
      return true;
    case 'plan':
    case 'execute':
      if (running) {
        clearComposerDraft();
        notify('Wait for the current turn to finish before changing mode.', true);
        return true;
      }
      clearComposerDraft();
      planModeDrafts.set(draftKey(), parsed.name === 'plan');
      updateComposer();
      notify(parsed.name === 'plan' ? 'Plan mode enabled for the next turn.' : 'Execute mode enabled for the next turn.');
      return true;
    case 'goal':
      clearComposerDraft();
      showFeature('goals');
      editGoal();
      if (args) {
        $('goal-name').value = commandDraftName(args, 'New goal');
        $('goal-objective').value = args.slice(0, 12000);
      }
      $('goal-objective').focus();
      return true;
    case 'schedule':
      clearComposerDraft();
      showAutomations();
      editAutomation();
      if (args) {
        $('automation-name').value = commandDraftName(args, 'Scheduled task');
        $('automation-prompt').value = args.slice(0, 32000);
      }
      $('automation-prompt').focus();
      return true;
    case 'calendar':
      clearComposerDraft();
      showFeature('calendar');
      return true;
    case 'memory':
      clearComposerDraft();
      showFeature('memory');
      return true;
    case 'activity':
      clearComposerDraft();
      setAgentInspectorOpen(true);
      return true;
    case 'settings':
      clearComposerDraft();
      showDialog('settings-dialog');
      return true;
    case 'clear':
      clearComposerDraft({ attachments: true });
      notify('Unsent draft cleared.');
      return true;
    default:
      return false;
  }
}

async function sendMessage(event) {
  event?.preventDefault();
  const submittedDraft = $('message-input').value;
  const text = submittedDraft.trim();
  const chat = currentChat();
  const mode = currentPlanMode() ? 'plan' : 'execute';
  const attachmentIds = queuedAttachments().map((attachment) => attachment.id);
  const slashCommand = text ? LittleBotSlashCommands.parse(text) : null;
  if (slashCommand) {
    await executeSlashCommand(slashCommand);
    return;
  }
  if ((!text && !attachmentIds.length) || sending || thinkingSaving || attachmentImportPending || !isConnected() || !isReady() || chat?.status === 'running' || chat?.status === 'waiting' || chat?.compaction?.status === 'running' || compactionPending.has(chat?.id)) return;
  const originChatId = selectedChatId;
  const originDraftKey = originChatId || '__new__';
  const originNavigation = navigationVersion;
  sending = true;
  updateComposer();
  try {
    const result = await window.bot.send({ chatId: originChatId || undefined, text, attachmentIds, mode });
    if (chatDrafts.get(originDraftKey) === submittedDraft) chatDrafts.delete(originDraftKey);
    const remainingAttachments = (attachmentDrafts.get(originDraftKey) || []).filter((attachment) => !attachmentIds.includes(attachment.id));
    if (remainingAttachments.length) attachmentDrafts.set(originDraftKey, remainingAttachments);
    else attachmentDrafts.delete(originDraftKey);
    // The backend now owns these saved references; clear only pending leases.
    void releaseAttachments(attachmentIds.map(id => ({ id }))).catch(error => notify(error.message || String(error), true));
    // The user can visit another panel or chat while send is starting.
    // Clear only this submitted draft, including when they return before the RPC ends.
    if (selectedChatId === originChatId && $('message-input').value === submittedDraft) $('message-input').value = '';
    if (originNavigation === navigationVersion && currentView === 'chat') {
      if (result?.chatId) {
        selectedChatId = result.chatId;
        planModeDrafts.set(result.chatId, mode === 'plan');
        if (originDraftKey === '__new__') {
          planModeDrafts.delete('__new__');
        }
      }
    }
    render();
    sizeComposer();
    if (originNavigation === navigationVersion && currentView === 'chat') scrollChatToBottom();
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    sending = false;
    updateComposer();
    if (originNavigation === navigationVersion && currentView === 'chat') $('message-input').focus();
  }
}

function renderConnection() {
  const local = connectionType() === 'local';
  $('connection-card').classList.toggle('hidden', isConnected() || local);
  $('local-connection-card').classList.toggle('hidden', isConnected() || !local);
  $('local-connection-message').textContent = state?.connection?.error || 'Start your local model, then check the connection.';
  $('connect-chatgpt').disabled = loginPending;
  $('connect-chatgpt').replaceChildren(document.createTextNode(loginPending ? 'Waiting for sign-in…' : 'Sign in with ChatGPT'), icon('arrow-up-right'));
  if (loginMetadata && !isConnected()) renderLoginFeedback(loginMetadata);
  else $('login-feedback').classList.add('hidden');
}

function renderLoginFeedback(metadata) {
  const box = $('login-feedback');
  box.replaceChildren();
  box.classList.remove('hidden');
  const error = metadata.error;
  const message = typeof error === 'string' ? error : error?.message || metadata.message || 'Finish signing in in your browser, then come back here.';
  box.append(element('p', '', message));
  const code = metadata.userCode || metadata.user_code || metadata.code;
  if (code) {
    box.append(element('p', '', 'If the sign-in page asks for a code, use:'), element('code', '', code));
  }
  const url = metadata.authUrl || metadata.verificationUrl || metadata.verification_uri || metadata.url || metadata.loginUrl;
  if (url && /^https?:\/\//i.test(url)) {
    const link = element('a', '', 'Open the sign-in page');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    box.append(link);
  }
}

async function login(type, apiKey) {
  if (loginPending) return;
  loginPending = true;
  loginMetadata = { message: type === 'apiKey' ? 'Connecting your OpenAI account…' : 'Opening your browser to sign in…' };
  renderConnection();
  try {
    const result = await window.bot.login({ type, ...(apiKey ? { apiKey } : {}) });
    $('api-key').value = '';
    if (result) {
      loginMetadata = result;
      if (result.error || result.status === 'error' || result.status === 'cancelled') loginPending = false;
    }
    if (type === 'apiKey') loginPending = false;
    const fresh = await window.bot.getState();
    applyState(fresh);
  } catch (error) {
    loginPending = false;
    loginMetadata = { error: error?.message || String(error) };
    renderConnection();
    notify(error?.message || String(error), true);
  }
}

function renderSettings() {
  $('settings-account').textContent = isConnected() && connectionType() === 'codex' ? state.account.type === 'apiKey' ? 'OpenAI API key' : 'ChatGPT' : 'Codex account';
  $('settings-account-detail').textContent = isConnected() && connectionType() === 'codex' ? state.account.plan ? `Connected · ${state.account.plan}` : 'Connected' : 'ChatGPT sign-in or an OpenAI API key.';
  $('settings-login').textContent = isConnected() ? 'Reconnect' : 'Connect';
  $('settings-workspace').textContent = state.settings.workspace || 'No folder selected';
  $('settings-open-workspace').disabled = !state.settings.workspace;
  $('settings-engine').textContent = isReady() ? 'Running locally' : state.runtime?.status === 'error' ? 'Needs attention' : 'Starting up';
  $('settings-version').textContent = `v${state.appVersion || '0.1.0'}`;
  const storage = state.attachmentStorage;
  $('settings-attachment-usage').textContent = storage ? `${fileSize(storage.usedBytes)} of ${fileSize(storage.maxBytes)} · ${storage.fileCount} saved or pending files · ${fileSize(storage.unusedBytes)} unused` : 'Attachment storage unavailable.';
  $('settings-clean-attachments').disabled = !storage || !storage.unusedBytes;
  $('settings-engine-detail').textContent = connectionType() === 'local' ? 'Your local model. No OpenAI account needed.' : 'Codex connection';
  $('settings-data-detail').textContent = connectionType() === 'local'
    ? 'Conversation and memory are stored on this PC. Web services connect only when used.'
    : 'Conversation and memory are stored on this PC. Model requests go to OpenAI.';
  renderConnectionSettings();
  renderSystemPromptSettings();
  renderIndependentCheckSettings();
  renderCompactionSettings();
  renderBrowserSettings();
  renderServiceKeys();
}

function connectionFormValue() {
  return {
    connection: $('settings-connection').value,
    localBaseUrl: $('settings-local-url').value.trim(),
    localModel: $('settings-local-model').value.trim(),
  };
}

function renderConnectionSettings() {
  const stored = {
    connection: state.settings.connection || state.connection?.type || 'codex',
    localBaseUrl: state.settings.localBaseUrl || 'http://127.0.0.1:8080/v1',
    localModel: state.settings.localModel || 'Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M',
  };
  const changed = connectionInitialized && JSON.stringify(connectionFormValue()) !== connectionBaseline;
  if (!connectionInitialized || (!changed && !connectionPending)) {
    $('settings-connection').value = stored.connection;
    $('settings-local-url').value = stored.localBaseUrl;
    $('settings-local-model').value = stored.localModel;
    connectionBaseline = JSON.stringify(stored);
    connectionInitialized = true;
  }
  const local = $('settings-connection').value === 'local';
  const dirty = JSON.stringify(connectionFormValue()) !== connectionBaseline;
  $('settings-local-fields').classList.toggle('hidden', !local);
  $('settings-codex-account').classList.toggle('hidden', local || connectionType() !== 'codex');
  $('settings-connection-save').disabled = connectionPending || !dirty;
  $('settings-connection-check').disabled = connectionPending || dirty;
  $('local-connection-check').disabled = connectionPending;
  $('settings-connection-check').textContent = connectionPending ? 'Connecting…' : 'Check connection';
  for (const id of ['settings-connection', 'settings-local-url', 'settings-local-model']) $(id).disabled = connectionPending;
  const status = state.connection?.status || (isConnected() ? 'connected' : 'offline');
  $('settings-connection-status').textContent = dirty ? 'Unsaved changes' : status === 'connected' ? 'Connected' : status === 'checking' ? 'Checking…' : 'Offline';
  $('settings-connection-status').classList.toggle('configured', !dirty && status === 'connected');
  const error = connectionError || (!dirty ? state.connection?.error || '' : '');
  $('settings-connection-error').textContent = error;
  $('settings-connection-error').classList.toggle('hidden', !error);
  const capabilities = state.connection?.contextWindow ? `${Number(state.connection.contextWindow).toLocaleString()} context` : '';
  const vision = state.connection?.vision === true ? 'Images supported' : state.connection?.vision === false ? 'Text model · image understanding unavailable' : '';
  $('settings-local-capabilities').textContent = [capabilities, vision].filter(Boolean).join(' · ');
  $('settings-local-capabilities').classList.toggle('hidden', !local || dirty || (!capabilities && !vision));
}

async function saveConnection(event) {
  event?.preventDefault();
  if (connectionPending) return;
  const payload = connectionFormValue();
  if (payload.connection === 'local' && (!payload.localBaseUrl || !payload.localModel)) {
    connectionError = 'Enter a server URL and model.';
    renderConnectionSettings();
    return;
  }
  connectionPending = true;
  connectionError = '';
  renderConnectionSettings();
  try {
    const result = await window.bot.saveConnection(payload);
    connectionBaseline = JSON.stringify(payload);
    applyState(result);
  } catch (error) { connectionError = error?.message || String(error); }
  finally { connectionPending = false; renderConnectionSettings(); }
}

async function checkConnection() {
  if (connectionPending) return;
  connectionPending = true;
  connectionError = '';
  renderConnectionSettings();
  try { applyState(await window.bot.refreshConnection()); }
  catch (error) { connectionError = error?.message || String(error); }
  finally { connectionPending = false; renderConnectionSettings(); }
}

function renderSystemPromptSettings() {
  const input = $('settings-system-prompt');
  const stored = typeof state.settings.systemPrompt === 'string' ? state.settings.systemPrompt : '';
  const hadDraft = systemPromptInitialized && input.value !== systemPromptBaseline;
  systemPromptBaseline = stored;
  if (!systemPromptInitialized || (!hadDraft && !systemPromptSaving)) input.value = stored;
  systemPromptInitialized = true;
  input.disabled = systemPromptSaving;
  const dirty = input.value !== systemPromptBaseline;
  $('save-system-prompt').disabled = systemPromptSaving || !dirty;
  $('reset-system-prompt').disabled = systemPromptSaving || state.settings.systemPromptCustomized !== true;
  $('save-system-prompt').textContent = systemPromptSaving ? 'Saving…' : 'Save prompt';
  $('system-prompt-settings-error').textContent = systemPromptError;
  $('system-prompt-settings-error').classList.toggle('hidden', !systemPromptError);
}

async function saveSystemPromptSettings(event) {
  event?.preventDefault();
  if (systemPromptSaving) return;
  const value = $('settings-system-prompt').value;
  systemPromptSaving = true;
  systemPromptError = '';
  $('system-prompt-settings-saved').textContent = '';
  renderSystemPromptSettings();
  try {
    const result = await window.bot.saveSettings({ systemPrompt: value });
    if (result?.settings) applyState(result);
    systemPromptBaseline = value;
    $('system-prompt-settings-saved').textContent = 'Saved';
  } catch (error) {
    systemPromptError = error?.message || 'Could not save the system prompt.';
  } finally {
    systemPromptSaving = false;
    renderSystemPromptSettings();
  }
}

async function resetSystemPromptSettings() {
  if (systemPromptSaving || state.settings.systemPromptCustomized !== true) return;
  systemPromptSaving = true;
  systemPromptError = '';
  $('system-prompt-settings-saved').textContent = '';
  renderSystemPromptSettings();
  try {
    const result = await window.bot.saveSettings({ systemPrompt: null });
    if (result?.settings) applyState(result);
    systemPromptBaseline = state.settings.systemPrompt || '';
    $('system-prompt-settings-saved').textContent = 'Default restored';
  } catch (error) {
    systemPromptError = error?.message || 'Could not restore the default system prompt.';
  } finally {
    systemPromptSaving = false;
    renderSystemPromptSettings();
  }
}

function renderIndependentCheckSettings() {
  const input = $('settings-independent-check');
  const stored = state.settings.independentCheckMode || 'selective';
  const hadDraft = independentCheckSettingsInitialized && input.value !== independentCheckSettingsBaseline;
  independentCheckSettingsBaseline = stored;
  if (!independentCheckSettingsInitialized || (!hadDraft && !independentCheckSettingsSaving)) input.value = stored;
  independentCheckSettingsInitialized = true;
  input.disabled = independentCheckSettingsSaving;
  const dirty = input.value !== independentCheckSettingsBaseline;
  $('save-independent-check-settings').disabled = independentCheckSettingsSaving || !dirty;
  $('save-independent-check-settings').textContent = independentCheckSettingsSaving ? 'Saving…' : 'Save';
  $('independent-check-settings-error').textContent = independentCheckSettingsError;
  $('independent-check-settings-error').classList.toggle('hidden', !independentCheckSettingsError);
}

async function saveIndependentCheckSettings(event) {
  event?.preventDefault();
  if (independentCheckSettingsSaving) return;
  const independentCheckMode = $('settings-independent-check').value;
  independentCheckSettingsSaving = true;
  independentCheckSettingsError = '';
  $('independent-check-settings-saved').textContent = '';
  renderIndependentCheckSettings();
  try {
    const result = await window.bot.saveSettings({ independentCheckMode });
    if (result?.settings) applyState(result);
    independentCheckSettingsBaseline = independentCheckMode;
    $('independent-check-settings-saved').textContent = 'Saved';
  } catch (error) {
    independentCheckSettingsError = error?.message || 'Could not save Independent Check settings.';
  } finally {
    independentCheckSettingsSaving = false;
    renderIndependentCheckSettings();
  }
}

function renderCompactionSettings() {
  const input = $('settings-auto-compact');
  const hadDraft = compactionSettingsInitialized && input.value !== String(compactionSettingsBaseline);
  compactionSettingsBaseline = state.settings.autoCompactPercent ?? 80;
  if (!compactionSettingsInitialized || (!hadDraft && !compactionSettingsSaving)) input.value = String(compactionSettingsBaseline);
  compactionSettingsInitialized = true;
  input.disabled = compactionSettingsSaving;
  $('save-compaction-settings').disabled = compactionSettingsSaving || input.value === String(compactionSettingsBaseline);
  $('save-compaction-settings').textContent = compactionSettingsSaving ? 'Saving…' : 'Save';
  $('compaction-settings-error').textContent = compactionSettingsError;
  $('compaction-settings-error').classList.toggle('hidden', !compactionSettingsError);
}

async function saveCompactionSettings(event) {
  event?.preventDefault();
  if (compactionSettingsSaving) return;
  const raw = $('settings-auto-compact').value;
  const percentage = Number(raw);
  if (!raw || !Number.isInteger(percentage) || (percentage !== 0 && (percentage < 20 || percentage > 95))) {
    compactionSettingsError = 'Enter a whole number from 20 to 95, or 0 for the engine default.';
    renderCompactionSettings();
    $('settings-auto-compact').focus();
    return;
  }
  compactionSettingsSaving = true;
  compactionSettingsError = '';
  $('compaction-settings-saved').textContent = '';
  renderCompactionSettings();
  try {
    const result = await window.bot.saveSettings({ autoCompactPercent: percentage });
    if (result?.settings) applyState(result);
    $('compaction-settings-saved').textContent = 'Saved';
  } catch (error) {
    compactionSettingsError = error?.message || 'Could not save the compaction setting.';
  } finally {
    compactionSettingsSaving = false;
    renderCompactionSettings();
  }
}

function renderBrowserSettings() {
  const browser = state.browser || {};
  const busy = Boolean(browserActionPending || browser.status === 'running');
  const status = $('settings-browser-status');
  status.textContent = browserActionPending === 'install' ? 'Installing…' : browserActionPending === 'open' ? 'Opening…' : browserActionPending === 'close' ? 'Closing…' : browser.status === 'running' ? 'Working' : browser.active ? 'Open' : browser.available ? 'Ready' : browser.available === false ? 'Setup needed' : 'Checking';
  status.classList.toggle('configured', Boolean(browser.available || browser.active));
  const location = [browser.version ? `agent-browser ${browser.version}` : '', browser.url || ''].filter(Boolean).join(' · ');
  $('settings-browser-location').textContent = location;
  $('settings-browser-location').classList.toggle('hidden', !location);
  $('settings-open-browser').disabled = busy || !browser.available;
  $('settings-close-browser').disabled = Boolean(browserActionPending) || (!browser.active && browser.status !== 'running');
  $('settings-install-browser').classList.toggle('hidden', browser.available !== false || typeof window.bot?.installAgentBrowser !== 'function');
  $('settings-install-browser').disabled = busy;
  $('settings-install-browser').textContent = browserActionPending === 'install' ? 'Installing…' : 'Install browser';
  $('open-agent-browser').disabled = busy;
  $('open-agent-browser').classList.toggle('browser-active', Boolean(browser.active));
  $('open-agent-browser').title = browser.available ? 'Open the agent’s separate browser profile' : 'Set up the agent’s browser';
  const error = browserActionError || browser.error || '';
  $('settings-browser-error').textContent = error;
  $('settings-browser-error').classList.toggle('hidden', !error);
}

async function browserAction(actionName) {
  if (browserActionPending) return;
  if (actionName === 'open' && !state?.browser?.available) {
    showDialog('settings-dialog');
    $('browser-settings-title').scrollIntoView({ block: 'start' });
    return;
  }
  browserActionPending = actionName;
  browserActionError = '';
  renderBrowserSettings();
  try {
    const operation = { open: 'openAgentBrowser', close: 'closeAgentBrowser', install: 'installAgentBrowser' }[actionName];
    const result = await window.bot[operation]();
    if (result?.settings) applyState(result);
  } catch (error) {
    browserActionError = error?.message || 'The browser could not complete that action.';
    if (!$('settings-dialog').open) notify(browserActionError, true);
  } finally {
    browserActionPending = '';
    renderBrowserSettings();
  }
}

function renderServiceKeys() {
  const services = state.webServices || {};
  $('settings-services-error').textContent = services.error || '';
  $('settings-services-error').classList.toggle('hidden', !services.error);
  for (const service of ['firecrawl', 'brave']) {
    const configured = Boolean(services[service]?.configured);
    const pending = serviceKeyPending.get(service);
    const input = $('service-' + service + '-key');
    const status = $('service-' + service + '-status');
    status.textContent = pending === 'save' ? 'Saving…' : pending === 'remove' ? 'Removing…' : configured ? 'Key saved' : 'Not configured';
    status.classList.toggle('configured', configured);
    input.placeholder = configured ? 'Saved · paste a key to replace it' : `Paste your ${service === 'brave' ? 'Brave Search' : 'Firecrawl'} API key`;
    input.disabled = Boolean(pending);
    $('service-' + service + '-save').disabled = Boolean(pending) || !input.value.trim();
    $('service-' + service + '-save').textContent = pending === 'save' ? 'Saving…' : 'Save';
    $('service-' + service + '-remove').disabled = Boolean(pending) || !configured;
    $('service-' + service + '-remove').textContent = pending === 'remove' ? 'Removing…' : 'Remove key';
    const error = serviceKeyErrors.get(service) || '';
    $('service-' + service + '-error').textContent = error;
    $('service-' + service + '-error').classList.toggle('hidden', !error);
  }
}

async function saveServiceKey(service, remove = false) {
  if (serviceKeyPending.has(service)) return;
  const input = $('service-' + service + '-key');
  const apiKey = input.value.trim();
  if (!remove && !apiKey) return;
  serviceKeyPending.set(service, remove ? 'remove' : 'save');
  serviceKeyErrors.delete(service);
  renderServiceKeys();
  try {
    const result = await window.bot.saveServiceKey(remove ? { service, remove: true } : { service, apiKey });
    input.value = '';
    if (result?.settings) applyState(result);
  } catch (error) {
    let message = error?.message || 'Could not update the saved key.';
    if (apiKey) message = message.replaceAll(apiKey, '[redacted]');
    serviceKeyErrors.set(service, message);
  } finally {
    serviceKeyPending.delete(service);
    renderServiceKeys();
  }
}

async function chooseWorkspace() {
  const result = await attempt(() => window.bot.chooseWorkspace());
  if (result) {
    const next = await attempt(() => window.bot.getState());
    if (next) applyState(next);
    notify(currentChat() ? 'Conversation workspace switched.' : 'Workspace selected.');
  }
}

function formatDate(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not yet';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function humanStatus(value) {
  const status = String(value || '');
  return status.replace(/[_-]/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
}

function calendarLocalParts(timestamp) {
  const date = new Date(timestamp);
  return {
    date: `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  };
}

function calendarTimestamp(dateValue, timeValue = '00:00') {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue || '');
  const time = /^(\d{2}):(\d{2})$/.exec(timeValue || '');
  if (!date || !time) return NaN;
  const value = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(time[1]), Number(time[2]), 0, 0);
  return value.getTime();
}

function calendarDayLabel(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function calendarTimeLabel(event) {
  if (event.allDay) return 'All day';
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const startTime = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (start.toDateString() === end.toDateString()) return `${startTime} – ${endTime}`;
  return `${startTime} – ${end.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function renderCalendar() {
  const host = $('calendar-list');
  const events = [...(state.calendar?.events || [])].sort((left, right) => left.startAt - right.startAt || left.title.localeCompare(right.title));
  if (!events.length) {
    const empty = element('div', 'calendar-empty');
    empty.append(icon('calendar'), element('h2', '', 'Nothing scheduled'), element('p', '', 'Add an event here or ask Little Bot to manage your local calendar.'), action('New event', () => editCalendarEvent(), 'button secondary', 'plus'));
    host.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  let previousDay = '';
  for (const event of events.slice(0, 300)) {
    const day = new Date(event.startAt).toDateString();
    if (day !== previousDay) {
      fragment.append(element('h2', 'calendar-day-heading', calendarDayLabel(event.startAt)));
      previousDay = day;
    }
    const card = element('article', 'calendar-event-card');
    const time = element('div', 'calendar-event-time', calendarTimeLabel(event));
    const copy = element('div', 'calendar-event-copy');
    copy.append(element('h3', '', event.title));
    const meta = [event.location, event.notes].filter(Boolean);
    if (meta.length) copy.append(element('p', '', meta.join(' · ')));
    const actions = element('div', 'calendar-event-actions');
    actions.append(action('Edit', () => editCalendarEvent(event), 'button text-button'));
    const remove = action('', async () => {
      if (!await confirmAction('Delete this event?', `“${event.title}” will be removed from Little Bot’s local calendar.`)) return;
      await attempt(() => window.bot.deleteCalendarEvent({ id: event.id }), 'Calendar event deleted.');
    }, 'icon-button', 'trash');
    remove.setAttribute('aria-label', `Delete ${event.title}`);
    actions.append(remove);
    card.append(time, copy, actions);
    fragment.append(card);
  }
  host.replaceChildren(fragment);
}

function renderCalendarAllDay() {
  const allDay = $('calendar-all-day').checked;
  $('calendar-start-time-field').classList.toggle('hidden', allDay);
  $('calendar-end-fields').classList.toggle('hidden', allDay);
  $('calendar-start-time').required = !allDay;
  $('calendar-end-date').required = !allDay;
  $('calendar-end-time').required = !allDay;
}

function editCalendarEvent(event) {
  editingCalendarId = event?.id || null;
  $('calendar-dialog-title').textContent = event ? 'Edit event' : 'New event';
  $('calendar-event-title').value = event?.title || '';
  $('calendar-all-day').checked = Boolean(event?.allDay);
  const start = event ? calendarLocalParts(event.startAt) : calendarLocalParts(Date.now() + 60 * 60 * 1000);
  const end = event ? calendarLocalParts(event.endAt) : calendarLocalParts(Date.now() + 2 * 60 * 60 * 1000);
  $('calendar-start-date').value = start.date;
  $('calendar-start-time').value = event?.allDay ? '09:00' : start.time;
  $('calendar-end-date').value = end.date;
  $('calendar-end-time').value = event?.allDay ? '10:00' : end.time;
  $('calendar-location').value = event?.location || '';
  $('calendar-notes').value = event?.notes || '';
  $('calendar-form-error').textContent = '';
  $('calendar-form-error').classList.add('hidden');
  $('save-calendar-event').textContent = event ? 'Save changes' : 'Create event';
  renderCalendarAllDay();
  showDialog('calendar-dialog');
}

async function saveCalendarEvent(event) {
  event.preventDefault();
  if (!$('calendar-form').reportValidity()) return;
  const allDay = $('calendar-all-day').checked;
  const startAt = calendarTimestamp($('calendar-start-date').value, allDay ? '00:00' : $('calendar-start-time').value);
  const endAt = allDay ? undefined : calendarTimestamp($('calendar-end-date').value, $('calendar-end-time').value);
  const payload = {
    ...(editingCalendarId ? { id: editingCalendarId } : {}),
    title: $('calendar-event-title').value.trim(),
    allDay,
    startAt,
    ...(endAt !== undefined ? { endAt } : {}),
    location: $('calendar-location').value,
    notes: $('calendar-notes').value,
  };
  $('save-calendar-event').disabled = true;
  try {
    const next = await window.bot.saveCalendarEvent(payload);
    if (next?.settings) applyState(next);
    closeDialog('calendar-dialog');
    notify(editingCalendarId ? 'Calendar event updated.' : 'Calendar event created.');
  } catch (error) {
    $('calendar-form-error').textContent = error?.message || String(error);
    $('calendar-form-error').classList.remove('hidden');
  } finally {
    $('save-calendar-event').disabled = false;
  }
}

function intervalLabel(minutes) {
  if (minutes % 1440 === 0) return `Every ${minutes / 1440 === 1 ? 'day' : `${minutes / 1440} days`}`;
  if (minutes % 60 === 0) return `Every ${minutes / 60 === 1 ? 'hour' : `${minutes / 60} hours`}`;
  return `Every ${minutes === 1 ? 'minute' : `${minutes} minutes`}`;
}

const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scheduleLabel(routine) {
  if (routine?.scheduleType !== 'clock') return intervalLabel(routine?.intervalMinutes || 60);
  const days = Array.isArray(routine.daysOfWeek) ? routine.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const normalized = [...new Set(days)].sort((a, b) => a - b);
  let dayLabel;
  if (normalized.length === 7) dayLabel = 'Daily';
  else if (JSON.stringify(normalized) === JSON.stringify([1, 2, 3, 4, 5])) dayLabel = 'Weekdays';
  else if (JSON.stringify(normalized) === JSON.stringify([0, 6])) dayLabel = 'Weekends';
  else dayLabel = normalized.map(day => weekdayNames[day]).filter(Boolean).join(', ');
  return `${dayLabel || 'Selected days'} at ${routine.clockTime || '09:00'}`;
}

function renderAutomationScheduleEditor() {
  const clock = $('automation-schedule-type').value === 'clock';
  $('automation-interval-fields').classList.toggle('hidden', clock);
  $('automation-clock-fields').classList.toggle('hidden', !clock);
  $('automation-interval').required = !clock;
  $('automation-clock-time').required = clock;
  $('automation-schedule-hint').textContent = clock
    ? 'Uses this PC’s local time. If Little Bot is closed or the PC is asleep, it runs once when available, then advances to the next selected time.'
    : 'First automatic run is after this interval.';
}

function renderAutomations() {
  $('automations-view').querySelector('.automation-notice span:last-child').textContent = state.autonomy?.paused ? 'Autonomous work is paused. Resume it from Goals to allow scheduled automations to continue.' : 'Scheduled tasks run in your conversation while Little Bot is open. They wait until other work finishes.';
  const fragment = document.createDocumentFragment();
  const routines = state.automations || [];
  if (!routines.length) {
    const empty = element('div', 'automations-empty');
    empty.append(icon('clock'), element('h2', '', 'No automations yet'), element('p', '', 'Schedule a recurring task.'), action('New automation', () => editAutomation(), 'button secondary', 'plus'));
    fragment.append(empty);
  }
  for (const routine of routines) {
    const card = element('article', 'automation-card');
    const top = element('div', 'automation-card-top');
    const badge = element('div', 'routine-icon');
    badge.append(icon('clock'));
    const copy = element('div', 'routine-copy');
    copy.append(element('h3', '', routine.name), element('p', '', routine.prompt));
    const toggle = element('label', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(routine.enabled);
    input.setAttribute('aria-label', `Enable ${routine.name}`);
    input.addEventListener('change', async () => {
      input.disabled = true;
      const next = await attempt(() => window.bot.saveAutomation({ ...routine, enabled: input.checked }));
      if (!next) input.checked = Boolean(routine.enabled);
      input.disabled = false;
    });
    toggle.append(input, element('span', 'switch-track'));
    top.append(badge, copy, toggle);
    const meta = element('div', 'routine-meta');
    const interval = element('span');
    interval.append(icon('clock'), document.createTextNode(scheduleLabel(routine)));
    const folder = element('span');
    folder.title = routine.workspace || '';
    folder.append(icon('folder'), document.createTextNode(basename(routine.workspace)));
    meta.append(interval, folder, element('span', '', routine.enabled ? `Next: ${formatDate(routine.nextRunAt)}` : 'Paused'));
    const footer = element('div', 'routine-footer');
    const lastText = routine.lastRunAt ? `${humanStatus(routine.lastStatus || 'Last run')} · ${formatDate(routine.lastRunAt)}` : 'Ready for its first run';
    footer.append(element('span', 'routine-status', lastText));
    const runNow = action('Run now', async () => {
      const originNavigation = navigationVersion;
      const result = await attempt(() => window.bot.runAutomation({ id: routine.id }));
      if (result?.chatId && navigationVersion === originNavigation && currentView === 'automations') selectChat(result.chatId);
    }, 'button secondary', 'play');
    runNow.disabled = Boolean(state.autonomy?.paused);
    runNow.title = state.autonomy?.paused ? 'Resume autonomous work in Goals before running an automation.' : 'Run this automation now';
    footer.append(runNow);
    footer.append(action('Edit', () => editAutomation(routine), 'button text-button'));
    const remove = action('', async () => {
      if (await confirmAction('Delete this automation?', `“${routine.name}” will stop running. Its past conversations will stay in your chat history.`)) {
        await attempt(() => window.bot.deleteAutomation({ id: routine.id }), 'Automation deleted.');
      }
    }, 'icon-button', 'trash');
    remove.setAttribute('aria-label', `Delete ${routine.name}`);
    footer.append(remove);
    card.append(top, meta, footer);
    fragment.append(card);
  }
  $('automations-list').replaceChildren(fragment);
}

function editAutomation(routine) {
  editingAutomationId = routine?.id || null;
  $('automation-title').textContent = routine ? 'Edit automation' : 'New automation';
  $('automation-name').value = routine?.name || '';
  $('automation-prompt').value = routine?.prompt || '';
  const scheduleType = routine?.scheduleType === 'clock' ? 'clock' : 'interval';
  $('automation-schedule-type').value = scheduleType;
  $('automation-interval').value = routine?.intervalMinutes || 60;
  $('automation-clock-time').value = routine?.clockTime || '09:00';
  const selectedDays = new Set(Array.isArray(routine?.daysOfWeek) ? routine.daysOfWeek : [0, 1, 2, 3, 4, 5, 6]);
  for (const input of document.querySelectorAll('[data-automation-day]')) input.checked = selectedDays.has(Number(input.value));
  $('automation-enabled').checked = routine ? Boolean(routine.enabled) : true;
  renderAutomationScheduleEditor();
  $('automation-context').textContent = `Folder: ${routine?.workspace || state?.settings?.workspace || 'Choose a workspace before saving'}\nModel: ${routine?.model || state?.settings?.model || 'Default'}`;
  $('save-automation').textContent = routine ? 'Save changes' : 'Create automation';
  showDialog('automation-dialog');
}

async function saveAutomation(event) {
  event.preventDefault();
  if (!$('automation-form').reportValidity()) return;
  const name = $('automation-name').value.trim();
  const prompt = $('automation-prompt').value.trim();
  if (!name || !prompt) return;
  const scheduleType = $('automation-schedule-type').value;
  const schedule = scheduleType === 'clock'
    ? {
        scheduleType: 'clock',
        clockTime: $('automation-clock-time').value,
        daysOfWeek: Array.from(document.querySelectorAll('[data-automation-day]:checked'), input => Number(input.value)),
      }
    : { scheduleType: 'interval', intervalMinutes: Number($('automation-interval').value) };
  if (scheduleType === 'clock' && (!schedule.clockTime || !schedule.daysOfWeek.length)) {
    notify('Choose a time and at least one day.', true);
    return;
  }
  $('save-automation').disabled = true;
  try {
    const next = await window.bot.saveAutomation({
      ...(editingAutomationId ? { id: editingAutomationId } : {}),
      name,
      prompt,
      ...schedule,
      enabled: $('automation-enabled').checked,
    });
    if (next?.settings) applyState(next);
    closeDialog('automation-dialog');
    showAutomations();
    notify(editingAutomationId ? 'Automation updated.' : 'Your automation is ready.');
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    $('save-automation').disabled = false;
  }
}

function renderProfile() {
  const profile = state.profile;
  const available = Boolean(profile && typeof profile.user === 'string' && typeof profile.soul === 'string');
  const limit = profile?.limits?.perFile || 4000;
  const totalLimit = profile?.limits?.total || limit * 2;
  $('profile-root').textContent = profile?.root || 'Profile folder is not available yet.';
  $('open-profile-folder').disabled = !profile?.root;
  $('profile-error').textContent = profileSaveError || profile?.error || '';
  $('profile-error').classList.toggle('hidden', !(profileSaveError || profile?.error));
  let dirtyCount = 0;
  let total = 0;
  let tooLong = false;
  for (const key of ['user', 'soul']) {
    const input = $('profile-' + key);
    input.disabled = !available;
    input.maxLength = limit;
    if (available) {
      const dirty = profileInitialized && input.value !== profileBaseline[key];
      const pending = profilePendingValues && Object.hasOwn(profilePendingValues, key);
      if (!profileInitialized || (!dirty && !pending)) {
        input.value = profile[key];
        profileBaseline[key] = profile[key];
      }
      input.title = profile.files?.[key] || (key === 'user' ? 'USER.md' : 'SOUL.md');
    }
    const changed = available && input.value !== profileBaseline[key];
    if (changed) dirtyCount += 1;
    total += input.value.length;
    tooLong ||= input.value.length > limit;
    $('profile-' + key + '-dirty').classList.toggle('hidden', !changed);
    $('profile-' + key + '-count').textContent = `${input.value.length.toLocaleString()} / ${limit.toLocaleString()}`;
    $('profile-' + key + '-error').textContent = profile?.errors?.[key] || '';
    $('profile-' + key + '-error').classList.toggle('hidden', !profile?.errors?.[key]);
    const externalChange = changed && profile[key] !== profileBaseline[key] && profile[key] !== profilePendingValues?.[key];
    $('profile-' + key + '-conflict').classList.toggle('hidden', !externalChange);
  }
  if (available) profileInitialized = true;
  $('save-profile').disabled = !available || profileSaving || !dirtyCount || tooLong || total > totalLimit;
  $('save-profile').textContent = profileSaving ? 'Saving…' : 'Save changes';
  $('profile-save-status').textContent = !available ? 'Profile files are not available yet.' : profileSaving ? 'Writing your changes to the profile files…' : tooLong || total > totalLimit ? 'Shorten the profile text to fit the character limits.' : dirtyCount ? `${dirtyCount} file${dirtyCount === 1 ? ' has' : 's have'} unsaved changes. Ctrl + S to save.` : 'Saved as Markdown files.';
  $('profile-updated').textContent = profile?.updatedAt ? `File update: ${formatDate(profile.updatedAt)}` : '';
}

async function saveProfile(event) {
  event?.preventDefault();
  if (!profileInitialized || profileSaving) return;
  renderProfile();
  if ($('save-profile').disabled) return;
  const payload = {};
  for (const key of ['user', 'soul']) if ($('profile-' + key).value !== profileBaseline[key]) payload[key] = $('profile-' + key).value;
  if (!Object.keys(payload).length) return;
  profileSaving = true;
  profileSaveError = '';
  profilePendingValues = { ...payload };
  renderProfile();
  try {
    const result = await window.bot.saveProfile(payload);
    const saved = result?.profile;
    for (const key of Object.keys(payload)) {
      const content = typeof saved?.[key] === 'string' ? saved[key] : payload[key];
      profileBaseline[key] = content;
      if ($('profile-' + key).value === payload[key]) $('profile-' + key).value = content;
    }
    profileSaving = false;
    profilePendingValues = null;
    if (result?.settings) applyState(result);
    notify(Object.keys(payload).map((key) => key === 'user' ? 'USER.md' : 'SOUL.md').join(' and ') + ' saved.');
  } catch (error) {
    profileSaveError = error?.message || String(error);
  } finally {
    profileSaving = false;
    profilePendingValues = null;
    if (currentView === 'profile') renderProfile();
  }
}

let memorySearchVersion = 0;
let memorySearchTimer;
let visibleMemoryRecords = [];
function memoryRecords() {
  return state.memory?.records || [...(state.memory?.facts || []), ...(state.memory?.episodes || []).map(item => ({ ...item, type: 'episode', text: item.summary }))];
}

function renderMemory() {
  $('memory-enabled').checked = state.memory?.enabled !== false;
  $('memory-disabled-note').classList.toggle('hidden', state.memory?.enabled !== false);
  refreshMemoryResults();
  renderMemoryContext();
  renderMemorySettings();
  const failures = state.memory?.learning?.failedJobs || [];
  const host = $('memory-learning-failures');
  host.classList.toggle('hidden', !failures.length);
  host.replaceChildren(...failures.map(job => {
    const row = element('article', 'memory-item');
    row.append(element('p', 'memory-item-copy', `Memory learning stopped after ${job.attempts} failed attempts. ${job.error || ''}`));
    const controls = element('div', 'memory-item-actions');
    controls.append(action('Retry', () => attempt(() => window.bot.retryMemoryLearning({ id: job.id }), 'Memory learning queued again.'), 'button secondary'),
      action('Discard', () => attempt(() => window.bot.discardMemoryLearning({ id: job.id }), 'Failed learning job discarded.'), 'button text-button'));
    row.append(controls); return row;
  }));
}

function renderMemorySettings() {
  const memory = state.memory || {};
  const embedding = memory.config?.embedding || memory.embedding || {};
  if (!$('memory-advanced').contains(document.activeElement)) {
    $('memory-embedding-provider').value = embedding.provider === 'bundled' ? 'bundled' : embedding.baseUrl ? 'remote' : 'none';
    $('memory-remote-settings').classList.toggle('hidden', $('memory-embedding-provider').value !== 'remote');
    $('memory-embedding-url').value = embedding.baseUrl || '';
    $('memory-embedding-model').value = embedding.model || '';
    $('memory-embedding-key').value = embedding.apiKey || '';
  }
  const stats = memory.stats || {};
  const searchLabel = embedding.provider === 'bundled' ? 'Local BGE-base · CPU · offline' : embedding.baseUrl ? 'Custom semantic search' : 'Keyword search only';
  $('memory-engine-status').textContent = `${searchLabel} · ${stats.embeddingCount || 0} indexed vectors · ${stats.archivedTraceCount || 0} tool/trace entries excluded from recall${stats.embeddingError ? ` · ${stats.embeddingError}` : ''}`;
  const selected = $('memory-project').value;
  const projects = [...new Map((memory.projects || []).map(project => [project.id, project])).values()];
  $('memory-project').replaceChildren(...projects.map(project => {
    const option = element('option', '', project.name || project.workspace || project.id);
    option.value = project.id;
    return option;
  }));
  if (projects.some(project => project.id === selected)) $('memory-project').value = selected;
  $('memory-link-project').disabled = !projects.length;
}

async function refreshMemoryResults() {
  const version = ++memorySearchVersion;
  const query = $('memory-search').value.trim();
  const type = $('memory-type').value;
  try {
    let records = memoryRecords();
    if (window.bot.searchMemory) {
      const result = await window.bot.searchMemory({ query, type: type || undefined, limit: 100 });
      records = Array.isArray(result) ? result : result.records || [];
    } else {
      records = records.filter(item => (!type || item.type === type) && (!query || String(item.text).toLowerCase().includes(query.toLowerCase())));
    }
    if (version !== memorySearchVersion) return;
    visibleMemoryRecords = records;
    $('memory-result-status').textContent = `${records.length} ${records.length === 1 ? 'memory' : 'memories'}${records.length === 100 ? ' · Refine your search to find more' : ''}`;
    const fragment = document.createDocumentFragment();
    for (const record of records) {
      const row = element('article', 'memory-item');
      row.dataset.memoryId = record.id;
      const copy = element('div', 'memory-item-copy');
      copy.append(element('p', 'memory-item-text', record.text || record.summary || ''));
      const meta = element('div', 'memory-item-meta');
      meta.append(element('span', 'memory-scope', `${record.pinned ? 'Pinned · ' : ''}${String(record.type || 'fact').replaceAll('_', ' ')}`), memoryScope(record.scope === 'global' ? null : record.workspace), element('span', '', formatDate(record.updatedAt || record.createdAt)));
      if (record.status && record.status !== 'active') meta.append(element('span', '', record.status));
      copy.append(meta);
      const actions = element('div', 'memory-item-actions');
      actions.append(action('Edit', () => editFact(record), 'button text-button', 'edit'));
      actions.append(action(record.pinned ? 'Unpin' : 'Pin', async () => {
        await attempt(() => window.bot.saveFact({ id: record.id, text: record.text, type: record.type, scope: record.scope, workspace: record.workspace, pinned: !record.pinned }));
        refreshMemoryResults();
      }, 'button text-button'));
      actions.append(action('Source', async () => {
        const details = row.querySelector('.memory-source');
        if (details) { details.remove(); return; }
        try {
          const result = window.bot.getMemorySource ? await window.bot.getMemorySource({ id: record.id }) : { sources: record.sources || [] };
          const sources = Array.isArray(result) ? result : result.sources || [];
          const source = element('div', 'memory-source');
          for (const item of sources) {
            source.append(element('strong', '', item.label || item.role || 'Source'), element('pre', '', item.text || item.content || item.summary || JSON.stringify(item, null, 2)));
          }
          if (!sources.length) source.append(element('p', '', 'Manually added memory; no conversation source.'));
          copy.append(source);
        } catch (error) { notify(error.message || String(error), true); }
      }, 'button text-button'));
      actions.append(action('Forget', async () => {
        if (await confirmAction('Forget this memory?', 'Remove this memory and prevent automatic learning from restoring it from the same source. The original timeline remains.', 'Forget')) {
          await attempt(() => window.bot.deleteFact({ id: record.id }), 'Memory forgotten.');
          refreshMemoryResults();
        }
      }, 'button text-button', 'trash'));
      row.append(copy, actions);
      fragment.append(row);
    }
    if (!records.length) fragment.append(element('p', 'memory-empty', query || type ? 'No matching memories.' : 'Memory grows as you work. Add something now or ask Little Bot to remember it.'));
    $('facts-list').replaceChildren(fragment);
  } catch (error) {
    if (version === memorySearchVersion) $('memory-result-status').textContent = error.message || 'Could not search memory.';
  }
}

async function renderMemoryContext() {
  const chat = currentChat();
  const host = $('memory-used-context');
  if (!chat?.contextUsedAt || !window.bot.getContextUsed) {
    host.replaceChildren(element('p', 'memory-empty', 'No context captured yet. Send a message to see what the bot recalled.'));
    return;
  }
  try {
    const snapshot = await window.bot.getContextUsed({ chatId: chat.id });
    const blocks = (snapshot?.inputBlocks || []).filter(item => /memory|recall|history|continuity/i.test(`${item.kind} ${item.label}`));
    const nodes = blocks.map(item => {
      const details = element('details', 'inspector-context-block');
      details.append(element('summary', '', item.label || item.kind || 'Recalled memory'), element('pre', '', item.text || ''));
      return details;
    });
    host.replaceChildren(...(nodes.length ? nodes : [element('p', 'memory-empty', snapshot?.memoryStatus || 'No memory was included in this turn.')]));
  } catch (error) { host.replaceChildren(element('p', 'memory-empty', error.message || 'Could not load context.')); }
}

function memoryScope(workspace) {
  const scope = element('span', 'memory-scope');
  scope.title = workspace || 'Available across all workspaces';
  scope.append(icon(workspace ? 'folder' : 'memory'), document.createTextNode(workspace ? basename(workspace) : 'All workspaces'));
  return scope;
}

function editFact(fact) {
  editingFactId = fact?.id || null;
  $('fact-title').textContent = fact ? 'Edit memory' : 'Add memory';
  $('fact-type').value = fact?.type || 'fact';
  $('fact-text').value = fact?.text || '';
  $('fact-scope').value = fact?.scope || 'workspace';
  $('save-fact').disabled = false;
  renderFactScope();
  showDialog('fact-dialog');
}

function renderFactScope() {
  const fact = visibleMemoryRecords.find(item => item.id === editingFactId) || memoryRecords().find(item => item.id === editingFactId);
  const workspace = fact?.scope === 'workspace' ? fact.workspace : state.settings.workspace;
  $('fact-workspace').textContent = $('fact-scope').value === 'global' ? 'Used across your workspaces when saved memory is enabled.' : `Folder: ${workspace || 'Choose a workspace first.'}`;
}

async function saveFact(event) {
  event.preventDefault();
  if (!$('fact-form').reportValidity()) return;
  const text = $('fact-text').value.trim();
  if (!text) return;
  $('save-fact').disabled = true;
  try {
    const result = await window.bot.saveFact({ ...(editingFactId ? { id: editingFactId } : {}), text, type: $('fact-type').value, scope: $('fact-scope').value });
    if (result?.settings) applyState(result);
    closeDialog('fact-dialog');
    notify('Memory saved.');
    refreshMemoryResults();
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    $('save-fact').disabled = false;
  }
}

function heartbeatConfig() {
  const saved = state.heartbeat || {};
  return {
    enabled: $('heartbeat-enabled').checked,
    mode: 'act',
    initiative: $('heartbeat-initiative').value === 'wild' ? 'wild' : 'calm',
    checklist: $('heartbeat-checklist').value,
    intervalMinutes: Number($('heartbeat-interval').value),
    startHour: Number($('heartbeat-start-hour').value),
    endHour: Number($('heartbeat-end-hour').value),
    maxRunsPerDay: Number($('heartbeat-max-runs').value),
    maxAlertsPerDay: Number($('heartbeat-max-alerts').value),
    snoozeMinutes: Number($('heartbeat-snooze-minutes').value),
    workspace: heartbeatUseCurrentWorkspace ? state.settings.workspace : saved.workspace || state.settings.workspace,
    model: heartbeatUseCurrentWorkspace ? state.settings.model : saved.model || state.settings.model,
    effort: heartbeatUseCurrentWorkspace ? state.settings.effort : saved.effort || state.settings.effort,
    ...(heartbeatUseCurrentWorkspace ? { useCurrentWorkspace: true } : {}),
  };
}

function loadHeartbeatForm() {
  const saved = state.heartbeat || {};
  $('heartbeat-enabled').checked = Boolean(saved.enabled);
  $('heartbeat-checklist').value = saved.checklist || '';
  $('heartbeat-initiative').value = saved.initiative === 'wild' ? 'wild' : 'calm';
  $('heartbeat-interval').value = saved.intervalMinutes ?? 30;
  $('heartbeat-start-hour').value = saved.startHour ?? 8;
  $('heartbeat-end-hour').value = saved.endHour ?? 22;
  $('heartbeat-max-runs').value = saved.maxRunsPerDay ?? 12;
  $('heartbeat-max-alerts').value = saved.maxAlertsPerDay ?? 3;
  $('heartbeat-snooze-minutes').value = saved.snoozeMinutes ?? 60;
  heartbeatUseCurrentWorkspace = false;
  heartbeatBaseline = JSON.stringify(heartbeatConfig());
}

function markHeartbeatDirty() {
  heartbeatFormRevision += 1;
  heartbeatDirty = JSON.stringify(heartbeatConfig()) !== heartbeatBaseline;
  renderHeartbeatControls();
}

function renderHeartbeatControls() {
  const saved = state.heartbeat || {};
  const running = saved.lastStatus === 'running' || heartbeatManualPending;
  $('heartbeat-dirty').classList.toggle('hidden', !heartbeatDirty);
  $('save-heartbeat').disabled = heartbeatSaving;
  $('save-heartbeat').textContent = heartbeatSaving ? 'Saving…' : 'Save settings';
  $('heartbeat-checklist').required = $('heartbeat-enabled').checked;
  $('heartbeat-initiative-hint').textContent = $('heartbeat-initiative').value === 'wild'
    ? 'Acts in the saved folder with network access, keeps agenda.md there, can save memories and manage the calendar, routines and draft goals. Pause all still stops it.'
    : 'Can act in the saved folder. No elevated or network access.';
  $('run-heartbeat').classList.toggle('hidden', running);
  $('stop-heartbeat').classList.toggle('hidden', !running);
  $('run-heartbeat').disabled = Boolean(state.autonomy?.paused) || !isConnected() || !isReady() || !saved.checklist?.trim() || heartbeatSaving;
  $('run-heartbeat').title = state.autonomy?.paused ? 'Resume autonomous work in Goals before running a Heartbeat check.' : 'Run a check with saved settings';
  $('heartbeat-run-hint').textContent = state.autonomy?.paused ? 'Resume autonomous work in Goals to run a check.' : heartbeatDirty ? 'Save your changes before running a check.' : !isConnected() ? 'Connect a model to run a check.' : !isReady() ? 'Waiting for the engine.' : !saved.checklist?.trim() ? 'Write and save a checklist to get started.' : 'Uses saved settings.';
  const folder = heartbeatUseCurrentWorkspace ? state.settings.workspace : saved.workspace || state.settings.workspace;
  const model = heartbeatUseCurrentWorkspace ? state.settings.model : saved.model || state.settings.model;
  const effort = heartbeatUseCurrentWorkspace ? state.settings.effort : saved.effort || state.settings.effort;
  const connection = heartbeatUseCurrentWorkspace ? connectionType() : saved.connection || 'codex';
  $('heartbeat-workspace').textContent = folder || 'No working folder selected';
  $('heartbeat-model').textContent = `${model || 'Default model'} · ${taskReasoningLabel(connection, effort, model)}${heartbeatUseCurrentWorkspace ? ' · Update pending' : ''}`;
  $('heartbeat-use-workspace').title = `Use ${state.settings.workspace || 'the selected folder'} and the current model settings`;
}

function renderHeartbeat() {
  const heartbeat = state.heartbeat || {};
  if (!heartbeatDirty && !heartbeatSaving) loadHeartbeatForm();
  renderHeartbeatControls();
  const running = heartbeat.lastStatus === 'running' || heartbeatManualPending;
  const status = running ? 'Checking' : state.autonomy?.paused ? 'Paused globally' : heartbeat.lastStatus === 'error' ? 'Needs attention' : heartbeat.enabled ? 'Enabled' : 'Paused';
  const badge = $('heartbeat-status');
  badge.classList.toggle('running', running);
  badge.classList.toggle('error', !running && heartbeat.lastStatus === 'error');
  badge.replaceChildren(element('span', `status-dot ${running ? 'starting' : heartbeat.lastStatus === 'error' ? 'error' : ''}`), document.createTextNode(status));
  const pulse = Array.isArray(heartbeat.pulse) ? heartbeat.pulse : [];
  const lastPulse = pulse[pulse.length - 1];
  const latest = running ? 'Working through your checklist…' : heartbeat.lastStatus === 'quiet' ? `All quiet.${lastPulse?.status === 'quiet' && lastPulse.note ? ` ${lastPulse.note}` : ' Nothing needs your attention.'}` : heartbeat.lastStatus === 'alert' ? 'A meaningful update is waiting in Activity inbox.' : heartbeat.lastStatus === 'error' ? 'The last check needs attention.' : 'No checks yet.';
  $('heartbeat-last-check').textContent = `${latest}${heartbeat.lastRunAt && !running ? `\n${formatDate(heartbeat.lastRunAt)}` : ''}`;
  $('heartbeat-next-check').textContent = state.autonomy?.paused ? 'Autonomous work is paused. Resume it from Goals.' : heartbeat.enabled && heartbeat.nextRunAt ? `Next scheduled check: ${formatDate(heartbeat.nextRunAt)}` : heartbeat.enabled ? 'Next check follows your active hours and daily limit.' : 'Scheduled checks are paused.';
  $('heartbeat-run-count').textContent = `${heartbeat.runsToday || 0} of ${heartbeat.maxRunsPerDay || 12} checks used today${heartbeat.attention ? ` · ${heartbeat.attention.alertsToday || 0} of ${heartbeat.maxAlertsPerDay || 3} desktop alerts` : ''}`;
  const followups = Array.isArray(heartbeat.followups) ? heartbeat.followups : [];
  if (followups.length && !state.autonomy?.paused) $('heartbeat-next-check').textContent += `\n${followups.length} planned follow-up${followups.length === 1 ? '' : 's'} · next ${formatDate(followups[0].at)}: ${followups[0].note}`;
  $('heartbeat-pulse').classList.toggle('hidden', pulse.length === 0);
  $('heartbeat-pulse-label').textContent = `Recent checks · ${pulse.length}${heartbeat.quietStreak ? ` · quiet ${heartbeat.quietStreak} in a row` : ''}`;
  $('heartbeat-pulse-text').textContent = [...pulse].reverse().slice(0, 12).map(item => `${formatDate(item.at)} · ${item.status}${item.wakeInMinutes ? ` · next in ${item.wakeInMinutes} min` : ''}${item.note ? `\n${item.note}` : ''}`).join('\n\n');
  $('heartbeat-error').textContent = heartbeat.lastError || '';
  $('heartbeat-error').classList.toggle('hidden', !heartbeat.lastError);
  const lastActions = Array.isArray(heartbeat.lastActions) ? heartbeat.lastActions : [];
  $('heartbeat-last-actions').classList.toggle('hidden', lastActions.length === 0);
  $('heartbeat-last-actions-label').textContent = `${lastActions.length} recorded action${lastActions.length === 1 ? '' : 's'}`;
  $('heartbeat-last-actions-text').textContent = lastActions.join('\n\n');
}

function renderActivityInbox() {
  const heartbeat = state?.heartbeat || {};
  const all = [...(heartbeat.history || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  const history = all.filter(entry => (inboxFilter === 'all' || (inboxFilter === 'unread' ? entry.unread : entry.status === 'error'))
    && (inboxSource === 'all' || (entry.source || 'heartbeat') === inboxSource));
  $('inbox-summary').textContent = all.length ? `${all.filter(entry => entry.unread).length} unread · ${all.length} updates` : 'Updates from Heartbeat and goals appear here.';
  $('inbox-source').value = inboxSource;
  for (const button of document.querySelectorAll('[data-inbox-filter]')) {
    button.setAttribute('aria-pressed', String(button.dataset.inboxFilter === inboxFilter));
  }
  const expandedActions = new Set(Array.from($('heartbeat-inbox').querySelectorAll('details[open]'), (details) => details.dataset.entryId));
  $('heartbeat-read-all').disabled = !all.some((entry) => entry.unread);
  const fragment = document.createDocumentFragment();
  for (const entry of history) {
    const row = element('article', `heartbeat-entry ${entry.unread ? 'unread' : ''} ${entry.status === 'error' ? 'error' : ''}`);
    row.dataset.entryId = entry.id;
    const heading = element('div', 'entry-heading');
    const time = element('time', '', formatDate(entry.at));
    if (entry.at && !Number.isNaN(new Date(entry.at).getTime())) time.dateTime = new Date(entry.at).toISOString();
    heading.append(element('strong', '', entry.status === 'error' ? 'Needs attention' : entry.source === 'goal' ? 'Goal update' : 'Heartbeat update'), time);
    row.append(heading, element('p', 'entry-summary', entry.summary || (entry.status === 'error' ? 'The check could not finish.' : 'A check has an update.')));
    const source = element('div', 'entry-source');
    source.append(element('span', '', entry.source === 'goal' ? 'Goal' : 'Heartbeat'));
    if (entry.workspace) { const folder = element('span', '', basename(entry.workspace)); folder.title = entry.workspace; source.append(folder); }
    if (entry.source === 'goal' && entry.goalId && state.autonomy?.goals?.some(goal => goal.id === entry.goalId)) {
      source.append(action('Open goal', () => {
        showFeature('goals');
        Array.from($('goals-list').children).find(node => node.dataset.goalId === entry.goalId)?.scrollIntoView({ block: 'nearest' });
      }, 'button text-button'));
    }
    row.append(source);
    const topic = state.heartbeat?.attention?.topics?.find((item) => item.key === entry.subjectKey);
    const feedbackStatus = element('div', 'entry-feedback-status');
    if (entry.delivery === 'quiet') feedbackStatus.append(element('span', 'quiet-delivery', 'Saved quietly'));
    if (entry.feedback === 'useful') feedbackStatus.append(element('span', '', 'Marked useful'));
    if (topic?.muted || entry.feedback === 'dismiss' && !topic) feedbackStatus.append(element('span', '', 'Topic muted'));
    else if (topic?.snoozedUntil && new Date(topic.snoozedUntil).getTime() > Date.now()) feedbackStatus.append(element('span', '', `Later · ${formatDate(topic.snoozedUntil)}`));
    else if (entry.delivery === 'snoozed' && !topic) feedbackStatus.append(element('span', '', 'Saved while topic was snoozed'));
    if (feedbackStatus.childNodes.length) row.append(feedbackStatus);
    if (Array.isArray(entry.actions) && entry.actions.length) {
      const details = element('details', 'entry-actions');
      details.dataset.entryId = entry.id;
      details.open = expandedActions.has(entry.id);
      details.append(element('summary', '', `${entry.actions.length} recorded action${entry.actions.length === 1 ? '' : 's'}`), element('pre', '', entry.actions.join('\n\n')));
      row.append(details);
    }
    if (entry.unread) row.append(action('Mark as read', () => attempt(() => window.bot.readHeartbeat({ id: entry.id })), 'entry-read'));
    if (entry.subjectKey) {
      const feedback = element('div', 'entry-feedback-actions');
      for (const [choice, label] of [['useful', 'Useful'], ['later', 'Later'], ['dismiss', "Don't suggest this"]]) {
        const button = action(label, () => sendHeartbeatFeedback({ id: entry.id, choice }), 'feedback-button');
        button.disabled = heartbeatFeedbackPending.has(entry.id);
        const selected = choice === 'dismiss' ? Boolean(topic ? topic.muted : entry.feedback === 'dismiss') : choice === 'later' ? entry.feedback === 'later' && Boolean(topic?.snoozedUntil && new Date(topic.snoozedUntil).getTime() > Date.now()) : entry.feedback === choice;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.title = choice === 'useful' ? 'Prioritize similar updates. This does not grant new permissions.' : choice === 'later' ? `Snooze this topic for ${heartbeat.snoozeMinutes || 60} minutes.` : 'Mute this topic until you unmute it.';
        feedback.append(button);
      }
      row.append(feedback);
    }
    fragment.append(row);
  }
  if (!history.length) {
    const empty = element('div', 'inbox-empty');
    empty.append(icon('heartbeat'), element('p', '', all.length ? 'No updates match these filters.' : 'All quiet. Useful updates appear here.'));
    fragment.append(empty);
  }
  $('heartbeat-inbox').replaceChildren(fragment);
  const mutedTopics = (heartbeat.attention?.topics || []).filter((topic) => topic.muted).slice(0, 50);
  $('heartbeat-muted-card').classList.toggle('hidden', mutedTopics.length === 0);
  $('heartbeat-muted-count').textContent = String(mutedTopics.length);
  const muted = document.createDocumentFragment();
  for (const topic of mutedTopics) {
    const row = element('div', 'muted-topic');
    const copy = element('div');
    copy.append(element('p', '', topic.label || 'Saved topic'));
    if (topic.workspace) {
      const folder = element('small', '', basename(topic.workspace));
      folder.title = topic.workspace;
      copy.append(folder);
    }
    const unmute = action('Unmute', () => sendHeartbeatFeedback({ subjectKey: topic.key, choice: 'unmute' }), 'button text-button');
    unmute.disabled = heartbeatFeedbackPending.has(topic.key);
    row.append(copy, unmute);
    muted.append(row);
  }
  $('heartbeat-muted-topics').replaceChildren(muted);
}

async function sendHeartbeatFeedback(payload) {
  const key = payload.id || payload.subjectKey;
  if (heartbeatFeedbackPending.has(key)) return;
  heartbeatFeedbackPending.add(key);
  if (currentView === 'inbox') renderActivityInbox();
  if (currentView === 'heartbeat') renderHeartbeat();
  try {
    const result = await window.bot.heartbeatFeedback(payload);
    if (result?.settings) applyState(result);
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    heartbeatFeedbackPending.delete(key);
    if (currentView === 'inbox') renderActivityInbox();
    if (currentView === 'heartbeat') renderHeartbeat();
  }
}

async function saveHeartbeat(event) {
  event.preventDefault();
  const invalidAttention = $('heartbeat-form').querySelector('.heartbeat-attention-settings input:invalid');
  if (invalidAttention) invalidAttention.closest('details').open = true;
  if (!$('heartbeat-form').reportValidity() || heartbeatSaving) return;
  const revision = heartbeatFormRevision;
  const config = heartbeatConfig();
  heartbeatSaving = true;
  renderHeartbeatControls();
  try {
    const result = await window.bot.saveHeartbeat(config);
    if (heartbeatFormRevision === revision) {
      heartbeatDirty = false;
      heartbeatUseCurrentWorkspace = false;
    }
    heartbeatSaving = false;
    if (result?.settings) applyState(result);
    notify(config.enabled ? 'Heartbeat settings saved.' : 'Heartbeat settings saved. Scheduled checks are paused.');
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    heartbeatSaving = false;
    renderHeartbeatControls();
  }
}

async function runHeartbeat() {
  if (state.autonomy?.paused) { notify('Resume autonomous work in Goals to run a Heartbeat check.'); return; }
  if (heartbeatDirty) {
    notify('Save your Heartbeat changes before running a check.');
    $('save-heartbeat').focus();
    return;
  }
  if (heartbeatManualPending || state.heartbeat?.lastStatus === 'running') return;
  heartbeatManualPending = true;
  renderHeartbeat();
  try {
    const result = await window.bot.runHeartbeat();
    if (result?.settings) applyState(result);
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    heartbeatManualPending = false;
    if (currentView === 'heartbeat') renderHeartbeat();
  }
}

async function mutateGoal(key, operation, successMessage) {
  if (goalPending.has(key)) return null;
  goalPending.add(key);
  if (currentView === 'goals') renderGoals();
  try {
    const result = await operation();
    if (result?.settings) applyState(result);
    if (result != null && successMessage) notify(successMessage);
    return result;
  } catch (error) {
    notify(error?.message || String(error), true);
    return null;
  } finally {
    goalPending.delete(key);
    if (currentView === 'goals') renderGoals();
  }
}

function goalText(value) {
  return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function goalQuestionKey(goalId, questionId) { return `${goalId}:${questionId}`; }
function goalAcceptsAnswer(goal) {
  return Boolean(goal && ['blocked', 'paused'].includes(goal.status) && goal.authorized
    && !(state.goalRuntime?.goalId === goal.id && state.goalRuntime?.status !== 'idle'));
}

function updateGoalQuestionControls(form) {
  const goal = state.autonomy?.goals?.find(item => item.id === form.dataset.goalId);
  const key = goalQuestionKey(form.dataset.goalId, form.dataset.questionId);
  const draft = goalAnswerDrafts.get(key) || { choice: '', text: '' };
  const pending = goalAnswerPending.has(key);
  form.querySelector('fieldset').disabled = pending;
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = pending || !goalAcceptsAnswer(goal) || !(draft.text.trim() || draft.choice);
  submit.title = goalAcceptsAnswer(goal) ? '' : 'The goal is finishing its current step.';
  submit.textContent = pending ? 'Saving…' : state.autonomy?.paused || goal?.status === 'paused' ? 'Save answer' : 'Answer & continue';
  const error = form.querySelector('.goal-question-error');
  error.textContent = goalAnswerErrors.get(key) || '';
  error.classList.toggle('hidden', !error.textContent);
}

function renderGoalQuestion(goal, existing) {
  const question = goal.pendingQuestion;
  if (!question?.id || !question.question) return null;
  const key = goalQuestionKey(goal.id, question.id);
  const draft = goalAnswerDrafts.get(key) || { choice: '', text: '' };
  const form = existing?.dataset.questionId === question.id ? existing : element('form', 'goal-question');
  if (!form.dataset.questionId) {
    form.dataset.goalId = goal.id;
    form.dataset.questionId = question.id;
    const fields = element('fieldset');
    const legend = element('legend', 'goal-question-text');
    const choices = element('div', 'goal-question-options');
    const label = element('label', 'sr-only', 'Your answer');
    const input = element('textarea', 'goal-question-answer');
    input.id = `goal-answer-${goal.id}-${question.id}`;
    label.htmlFor = input.id;
    input.rows = 2;
    input.maxLength = 2000;
    input.addEventListener('input', () => {
      goalAnswerDrafts.set(key, { choice: '', text: input.value });
      choices.querySelectorAll('input').forEach(radio => { radio.checked = false; });
      goalAnswerErrors.delete(key);
      updateGoalQuestionControls(form);
    });
    fields.append(legend, choices, label, input);
    const error = element('p', 'goal-question-error hidden');
    error.setAttribute('role', 'alert');
    const footer = element('div', 'goal-question-actions');
    const submit = element('button', 'button primary');
    submit.type = 'submit';
    footer.append(submit);
    form.append(fields, error, footer);
    form.addEventListener('submit', submitGoalAnswer);
  }
  const legend = form.querySelector('legend');
  if (legend.textContent !== question.question) legend.textContent = question.question;
  const options = (question.options || []).filter(option => typeof option === 'string' && option.trim());
  const choices = form.querySelector('.goal-question-options');
  const signature = JSON.stringify(options);
  if (choices.dataset.options !== signature) {
    choices.dataset.options = signature;
    choices.replaceChildren();
    for (const option of options) {
      const label = element('label', 'goal-question-option');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = `goal-choice-${key}`;
      radio.value = option;
      radio.checked = draft.choice === option && !draft.text;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        goalAnswerDrafts.set(key, { choice: option, text: '' });
        form.querySelector('textarea').value = '';
        goalAnswerErrors.delete(key);
        updateGoalQuestionControls(form);
      });
      label.append(radio, element('span', '', option));
      choices.append(label);
    }
  }
  choices.classList.toggle('hidden', !options.length);
  const input = form.querySelector('textarea');
  if (input.value !== draft.text) input.value = draft.text;
  input.placeholder = options.length ? 'Or write your answer…' : 'Your answer…';
  updateGoalQuestionControls(form);
  return form;
}

async function submitGoalAnswer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.goalId, questionId = form.dataset.questionId;
  const key = goalQuestionKey(id, questionId);
  if (goalAnswerPending.has(key)) return;
  const goal = state.autonomy?.goals?.find(item => item.id === id);
  const draft = goalAnswerDrafts.get(key) || { choice: '', text: '' };
  const answer = (draft.text.trim() || draft.choice).trim();
  if (goal?.pendingQuestion?.id !== questionId || !goalAcceptsAnswer(goal) || !answer || answer.length > 2000) return;
  goalAnswerPending.add(key);
  goalAnswerErrors.delete(key);
  if (currentView === 'goals') renderGoals();
  try {
    const result = await window.bot.answerGoal({ id, questionId, answer });
    goalAnswerDrafts.delete(key);
    goalAnswerErrors.delete(key);
    if (result?.settings) applyState(result);
  } catch (error) {
    goalAnswerErrors.set(key, error?.message || 'Could not save your answer. Try again.');
  } finally {
    goalAnswerPending.delete(key);
    if (currentView === 'goals') renderGoals();
  }
}

function renderGoals() {
  const autonomy = state.autonomy || { paused: false, goals: [] };
  $('pause-autonomy').classList.toggle('hidden', Boolean(autonomy.paused));
  $('resume-autonomy').classList.toggle('hidden', !autonomy.paused);
  $('pause-autonomy').disabled = goalPending.has('autonomy');
  $('resume-autonomy').disabled = goalPending.has('autonomy');
  $('pause-autonomy').title = 'Pause all autonomous work, including goals, Heartbeat, and automations. Normal chat remains available.';
  $('resume-autonomy').title = 'Allow configured goals, Heartbeat, and automations to continue.';
  $('autonomy-paused-note').classList.toggle('hidden', !autonomy.paused);
  const expanded = new Set(Array.from($('goals-list').querySelectorAll('details[open][data-goal-detail]'), (details) => details.dataset.goalDetail));
  const previousCards = new Map(Array.from($('goals-list').querySelectorAll(':scope > [data-goal-id]'), card => [card.dataset.goalId, card]));
  const focusedQuestionControl = document.activeElement?.closest('.goal-question') ? document.activeElement : null;
  const cards = [];
  const goals = [...(autonomy.goals || [])].sort((a, b) => (a.priority || 3) - (b.priority || 3) || new Date(b.updatedAt) - new Date(a.updatedAt));
  for (const goal of goals) {
    const card = element('article', 'goal-card');
    card.dataset.goalId = goal.id;
    const previousCard = previousCards.get(goal.id);
    const questionForm = renderGoalQuestion(goal, previousCard?.querySelector('.goal-question'));
    const questionSlot = questionForm ? element('div') : null;
    const top = element('div', 'goal-card-top');
    const badge = element('div', 'routine-icon');
    badge.append(icon('goal'));
    const copy = element('div', 'goal-card-copy');
    copy.append(element('h2', '', goal.name), element('p', 'goal-objective', goal.objective));
    top.append(badge, copy, element('span', `goal-status ${goal.status || 'draft'}`, questionForm ? 'Needs your answer' : humanStatus(goal.status || 'draft')));
    card.append(top);
    const meta = element('div', 'goal-context-meta');
    const folder = element('span');
    folder.title = goal.workspace || '';
    folder.append(icon('folder'), document.createTextNode(basename(goal.workspace)));
    const trigger = goal.trigger?.type === 'interval' ? intervalLabel(goal.trigger.intervalMinutes) : goal.trigger?.type === 'files' ? 'On selected file changes' : 'Run manually';
    meta.append(folder, element('span', '', `Priority ${goal.priority || 3}`), element('span', '', trigger));
    if (goal.nextRunAt && goal.status === 'queued' && !autonomy.paused) meta.append(element('span', '', `Next: ${formatDate(goal.nextRunAt)}`));
    if (goal.contractVersion === 2) meta.append(element('span', '', goal.kind === 'ongoing' ? 'Ongoing' : 'Task'));
    card.append(meta);
    if (goal.review?.lastResult) card.append(element('p', 'goal-no-data', `Last outcome: ${goal.review.lastResult.outcome}`));
    for (const item of goal.actionItems || []) if (['proposed', 'waiting'].includes(item.status)) card.append(element('p', 'goal-no-data', `${item.owner === 'user' ? 'Your action' : 'Bot action'} · ${item.text}`));
    if (questionSlot) card.append(questionSlot);
    const progress = element('div', `goal-progress${questionForm ? ' goal-awaiting-input' : ''}`);
    const checkpoint = element('div');
    checkpoint.append(element('h3', '', goal.contractVersion === 2 ? 'Latest result' : 'Latest checkpoint'), element('p', '', goalText(goal.review?.lastMeaningfulResult?.summary || goal.review?.lastResult?.summary || (goal.review?.lastResult?.outcome === 'no-change' ? 'No new evidence; stayed quiet.' : goal.checkpoint)) || 'No checkpoint yet.'));
    const next = element('div');
    next.append(element('h3', '', 'Next step'), element('p', '', goalText(goal.nextStep) || (goal.status === 'completed' ? 'Checks passed.' : goal.status === 'draft' ? 'Ready to run when you are.' : 'Waiting for the next step.')));
    progress.append(checkpoint);
    if (!questionForm) progress.append(next);
    card.append(progress);
    const usage = goal.usage || {};
    const limits = goal.limits || {};
    const budget = element('div', 'goal-budget-row');
    const number = (value) => Number.isFinite(value) ? value.toLocaleString() : '—';
    const elapsed = Number.isFinite(usage.elapsedMs) ? Math.round(usage.elapsedMs / 6000) / 10 : 0;
    budget.append(element('span', '', `${number(usage.tokens || 0)} / ${number(limits.maxTokens)} input + output tokens`), element('span', '', `${elapsed} / ${number(limits.maxMinutes)} min`), element('span', '', `${usage.actions || 0} / ${number(limits.maxActions)} actions`), element('span', '', `${usage.runs || 0} / ${number(limits.maxRuns)} runs`), element('span', '', `${usage.retries || 0} / ${number(limits.maxRetries)} retries`));
    if (Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens)) budget.append(element('span', '', `${number(usage.inputTokens)} input · ${number(usage.outputTokens)} generated`));
    card.append(budget);
    if (goal.status === 'running' && goal.currentAction) card.append(element('p', 'goal-no-data', `Current action: ${goal.currentAction}`));
    const footer = element('div', 'goal-card-actions');
    const pending = goalPending.has(goal.id) || Boolean(goal.pendingQuestion && goalAnswerPending.has(goalQuestionKey(goal.id, goal.pendingQuestion.id)));
    const active = goal.status === 'running' || goal.status === 'queued';
    if (active) {
      const pause = action('Pause', () => mutateGoal(`pause:${goal.id}`, () => window.bot.pauseGoal({ id: goal.id })), 'button secondary', 'pause');
      pause.disabled = goalPending.has(`pause:${goal.id}`);
      footer.append(pause);
    } else if (!questionForm) {
      const resume = goal.status === 'paused';
      const run = action(resume ? 'Resume' : goal.status === 'completed' ? 'Run again' : goal.status === 'blocked' ? 'Retry' : 'Run goal', () => mutateGoal(goal.id, () => resume ? window.bot.resumeGoal({ id: goal.id }) : window.bot.runGoal({ id: goal.id })), 'button primary', 'play');
      run.disabled = pending || Boolean(autonomy.paused) || !isReady() || !isConnected();
      run.title = autonomy.paused ? 'Resume autonomous work before running this goal.' : !isConnected() ? 'Connect a model to run this goal.' : 'Run using this goal’s saved permissions, checks, and remaining budget.';
      footer.append(run);
    }
    const edit = action('Edit', () => editGoal(goal), 'button text-button');
    edit.disabled = active || pending;
    edit.title = active ? 'Pause the goal before editing it.' : 'Edit this goal';
    footer.append(edit);
    const remove = action('', async () => {
      if (await confirmAction('Delete this goal?', `“${goal.name}” and its saved file backups will be removed. Files already changed by the goal will stay as they are.`)) await mutateGoal(goal.id, () => window.bot.deleteGoal({ id: goal.id }), 'Goal deleted.');
    }, 'icon-button', 'trash');
    remove.disabled = active || pending;
    remove.setAttribute('aria-label', `Delete ${goal.name}`);
    footer.append(remove);
    card.append(footer);
    const details = element('details', 'goal-details');
    details.dataset.goalDetail = goal.id;
    details.open = expanded.has(goal.id);
    details.append(element('summary', '', 'Plan, evidence, and history'));
    if (!window.LittleBotGoalLedgerPanel?.append(details, goal) && goal.steps?.length) {
      const section = element('section', 'goal-detail-section');
      const list = element('ol');
      goal.steps.forEach((step) => list.append(element('li', '', goalText(step))));
      section.append(element('h3', '', 'Suggested steps'), list);
      details.append(section);
    }
    const history = [...(goal.history || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
    const checks = element('section', 'goal-detail-section');
    checks.append(element('h3', '', 'Success checks'));
    const latestEvidence = history.find((entry) => Array.isArray(entry.verification) && entry.verification.length)?.verification;
    if (latestEvidence) {
      for (const result of latestEvidence) checks.append(goalEvidenceRow(result));
    } else {
      for (const check of goal.checks || []) checks.append(element('p', 'goal-no-data', `${check.type === 'fileExists' ? 'File exists' : check.type === 'fileContains' ? 'File contains text' : 'Command succeeds'}: ${check.path || check.command || ''} · Not verified yet`));
      if (!goal.checks?.length) checks.append(element('p', 'goal-no-data', 'Add a success check before this goal can be completed.'));
    }
    details.append(checks);
    const permissions = goal.permissions || {};
    const access = element('section', 'goal-detail-section');
    access.append(element('h3', '', 'Saved access'), element('p', 'goal-no-data', `File changes: ${permissions.write ? (permissions.writePaths || []).join(', ') || 'No folders selected' : 'Off'}\nTerminal commands: ${permissions.shell ? 'Allowed' : 'Off'} · Network: ${permissions.network ? 'Allowed' : 'Off'}\nExternal MCP tools: ${permissions.mcpTools?.length ? permissions.mcpTools.map((tool) => `${tool.server} / ${tool.tool}`).join(', ') : 'None'}`));
    details.append(access);
    const historySection = element('section', 'goal-detail-section');
    historySection.append(element('h3', '', 'History and changed files'));
    if (!history.length) historySection.append(element('p', 'goal-no-data', 'Run checkpoints, verification results, and recorded changes will appear here.'));
    for (const entry of history) {
      const item = element('article', 'goal-history-item');
      const heading = element('div', 'goal-history-header');
      heading.append(element('strong', '', humanStatus(entry.kind || entry.status || 'Update')), element('time', '', formatDate(entry.at)));
      item.append(heading, element('p', 'goal-history-summary', entry.summary || 'No summary recorded.'));
      if (Number.isFinite(entry.usage?.inputTokens) && Number.isFinite(entry.usage?.outputTokens)) item.append(element('p', 'goal-no-data', `${number(entry.usage.inputTokens)} input · ${number(entry.usage.outputTokens)} generated tokens. Input is counted again on each model request.`));
      if (Array.isArray(entry.actions) && entry.actions.length) item.append(element('pre', 'goal-history-actions', entry.actions.join('\n\n')));
      if (Array.isArray(entry.verification) && entry.verification.length) for (const result of entry.verification) item.append(goalEvidenceRow(result));
      const snapshot = entry.snapshot;
      const runId = snapshot?.runId || entry.runId;
      const undoAvailable = Boolean(runId && (snapshot?.undoAvailable || entry.canUndo));
      if (Array.isArray(snapshot?.changes) && snapshot.changes.length) {
        const changes = element('ul', 'goal-changes');
        for (const change of snapshot.changes) changes.append(element('li', '', typeof change === 'string' ? change : `${humanStatus(change.kind || 'Changed')} · ${change.path || ''}`));
        item.append(changes);
      } else if (Number.isFinite(snapshot?.changes) && snapshot.changes > 0) {
        item.append(element('p', 'field-hint', `${snapshot.changes} changed file${snapshot.changes === 1 ? '' : 's'}.${undoAvailable ? ' Review undo to inspect.' : ''}`));
      }
      if (undoAvailable) {
        const undo = action('Review undo', () => reviewGoalRestore(goal, runId), 'button secondary');
        undo.disabled = active || pending;
        item.append(undo);
        const discard = action('Delete backup', async () => {
          if (await confirmAction('Delete this file backup?', 'This permanently removes the saved file versions for this run. The run history and current workspace files will stay, but this run can no longer be undone.', 'Delete backup')) {
            await mutateGoal(goal.id, () => window.bot.discardGoalSnapshot({ id: goal.id, runId }), 'File backup deleted.');
          }
        }, 'button text-button');
        discard.disabled = active || pending;
        item.append(discard);
      } else if (snapshot && entry.kind === 'started') {
        item.append(element('p', 'field-hint', 'Snapshot taken before run.'));
      } else if (snapshot && (snapshot.changes === 0 || (Array.isArray(snapshot.changes) && snapshot.changes.length === 0))) {
        item.append(element('p', 'field-hint', 'No file changes to undo.'));
      } else if (snapshot && (snapshot.retired === true || snapshot.removed === true || history.some((record) => record.runId === runId && ['snapshot-removed', 'snapshot-retired'].includes(record.kind)))) {
        item.append(element('p', 'field-hint', 'File backup is no longer available. The run history is kept.'));
      }
      historySection.append(item);
    }
    details.append(historySection);
    card.append(details);
    const children = Array.from(card.childNodes, child => child === questionSlot ? questionForm : child);
    const retainedCard = previousCard || card;
    replaceConversationItems(retainedCard, children);
    cards.push(retainedCard);
  }
  if (!goals.length) cards.push(extensionEmpty('No goals yet', 'Choose a result, success checks, and access. Run it when ready.', 'goal'));
  replaceConversationItems($('goals-list'), cards);
  if (focusedQuestionControl?.isConnected && document.activeElement !== focusedQuestionControl) focusedQuestionControl.focus({ preventScroll: true });
}

function goalEvidenceRow(result) {
  const row = element('div', `goal-evidence-row ${result.passed === false ? 'failed' : ''}`);
  row.append(icon(result.passed === true ? 'check' : result.passed === false ? 'x' : 'clock'), element('span', '', `${result.passed === true ? 'Passed' : result.passed === false ? 'Failed' : 'Not verified'}${result.path ? ` · ${result.path}` : ''}${result.detail ? ` · ${goalText(result.detail)}` : ''}`));
  return row;
}

function addGoalCheck(check = {}) {
  if ($('goal-checks').children.length >= 20) return;
  const index = goalCheckSequence++;
  const suffix = index ? `-${index}` : '';
  const row = element('div', 'goal-check-row');
  const header = element('div', 'goal-check-row-header');
  const type = element('select');
  type.id = 'goal-check-type' + suffix;
  type.className = 'goal-check-type';
  type.setAttribute('aria-label', 'Success check type');
  for (const [value, label] of [['fileExists', 'A file exists'], ['fileContains', 'A file contains text'], ['command', 'A command succeeds']]) {
    const option = element('option', '', label);
    option.value = value;
    type.append(option);
  }
  type.value = check.type || 'fileExists';
  const remove = action('', () => { row.remove(); refreshGoalCheckControls(); }, 'icon-button', 'trash');
  remove.setAttribute('aria-label', 'Remove this success check');
  remove.classList.add('goal-remove-check');
  header.append(type, remove);
  row.append(header);
  for (const field of ['path', 'contains', 'command']) {
    const wrapper = element('div', `goal-check-${field}-field`);
    const label = element('label', 'field-label', { path: 'Relative file path', contains: 'Required text', command: 'Verification command' }[field]);
    const input = element(field === 'path' ? 'input' : 'textarea');
    input.id = `goal-check-${field}${suffix}`;
    input.className = `goal-check-${field}`;
    label.htmlFor = input.id;
    input.value = check[field] || '';
    input.maxLength = { path: 500, contains: 4000, command: 4000 }[field];
    input.placeholder = { path: 'reports/weekly-summary.md', contains: 'Summary', command: 'npm test' }[field];
    if (field !== 'path') input.rows = 2;
    wrapper.append(label, input);
    row.append(wrapper);
  }
  type.addEventListener('change', () => renderGoalCheckType(row));
  $('goal-checks').append(row);
  renderGoalCheckType(row);
  refreshGoalCheckControls();
}

function renderGoalCheckType(row) {
  const type = row.querySelector('.goal-check-type').value;
  for (const field of ['path', 'contains', 'command']) {
    const visible = field === 'path' ? type !== 'command' : field === 'contains' ? type === 'fileContains' : type === 'command';
    row.querySelector(`.goal-check-${field}-field`).classList.toggle('hidden', !visible);
    const input = row.querySelector(`.goal-check-${field}`);
    input.disabled = !visible;
    input.required = visible && $('goal-kind').value !== 'ongoing';
  }
}

function refreshGoalCheckControls() {
  const rows = $('goal-checks').children.length;
  $('goal-add-check').disabled = rows >= 20;
  $('goal-checks').querySelectorAll('.goal-remove-check').forEach((button) => { button.disabled = rows <= 1; });
}

function renderGoalKind() {
  const ongoing = $('goal-kind').value === 'ongoing';
  for (const field of $('goal-checks').querySelectorAll('input,textarea')) field.required = !ongoing;
}

function editGoal(goal) {
  editingGoalId = goal?.id || null;
  goalDraftContext = { workspace: goal?.workspace || state.settings.workspace, model: goal?.model || state.settings.model, effort: goal?.effort || state.settings.effort || 'low', connection: goal ? goal.connection || 'codex' : connectionType() };
  $('goal-title').textContent = goal ? 'Edit goal' : 'New goal';
  $('goal-name').value = goal?.name || '';
  $('goal-objective').value = goal?.objective || '';
  $('goal-kind').value = goal?.kind || 'task';
  $('goal-source-chat').checked = goal?.sources?.chat !== false;
  $('goal-active-hours').checked = goal?.respectActiveHours !== false;
  $('goal-source-calendar').checked = goal?.sources?.calendar !== false;
  $('goal-source-files').value = (goal?.sources?.files || []).join('\n');
  $('goal-review-policy').value = goal?.reviewPolicy || 'changes';
  $('goal-max-quiet-hours').value = goal?.maxQuietHours ?? 0;
  $('goal-steps').value = (goal?.steps || []).join('\n');
  $('goal-workspace').textContent = `Folder: ${goalDraftContext.workspace}\nModel: ${goalDraftContext.model} · ${taskReasoningLabel(goalDraftContext.connection, goalDraftContext.effort, goalDraftContext.model)}`;
  $('goal-checks').replaceChildren();
  goalCheckSequence = 0;
  (goal?.checks?.length ? goal.checks : [{ type: 'fileExists' }]).forEach(addGoalCheck);
  $('goal-permission-write').checked = Boolean(goal?.permissions?.write);
  $('goal-write-paths').value = (goal?.permissions?.writePaths || []).join('\n');
  $('goal-permission-shell').checked = Boolean(goal?.permissions?.shell);
  $('goal-permission-network').checked = Boolean(goal?.permissions?.network);
  const defaults = { maxTokens: 50000, maxMinutes: 30, maxActions: 50, maxRuns: 10, maxRetries: 2 };
  for (const [field, id] of Object.entries({ maxTokens: 'goal-max-tokens', maxMinutes: 'goal-max-minutes', maxActions: 'goal-max-actions', maxRuns: 'goal-max-runs', maxRetries: 'goal-max-retries' })) $(id).value = goal?.limits?.[field] ?? defaults[field];
  $('goal-priority').value = goal?.priority || 3;
  $('goal-trigger').value = goal?.trigger?.type || 'manual';
  $('goal-interval').value = goal?.trigger?.intervalMinutes || 30;
  $('goal-trigger-paths').value = (goal?.trigger?.paths || []).join('\n');
  $('goal-advanced').open = false;
  $('goal-form-error').classList.add('hidden');
  $('save-goal').textContent = goal ? 'Save changes' : 'Save draft';
  $('save-goal').disabled = false;
  renderGoalPermissions(goal);
  const dependencies = document.createDocumentFragment();
  for (const other of state.autonomy?.goals || []) {
    if (other.id === goal?.id) continue;
    const label = element('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = other.id;
    const ongoing = other.contractVersion === 2 && other.kind === 'ongoing';
    input.disabled = ongoing;
    input.checked = !ongoing && Boolean(goal?.dependsOn?.includes(other.id));
    label.append(input, element('span', '', `${other.name} · ${ongoing ? 'Ongoing — cannot be a completion dependency' : humanStatus(other.status)}`));
    dependencies.append(label);
  }
  if (!dependencies.childNodes.length) dependencies.append(element('p', 'field-hint', 'No other goals to depend on yet.'));
  $('goal-dependencies').replaceChildren(dependencies);
  renderGoalTrigger();
  renderGoalWriteScope();
  renderGoalKind();
  showDialog('goal-dialog');
}

function renderGoalPermissions(goal) {
  const selected = new Set((goal?.permissions?.mcpTools || []).map((grant) => `${grant.server}\u0000${grant.tool}`));
  const available = new Set();
  const fragment = document.createDocumentFragment();
  for (const server of state.extensionRuntime?.servers || []) {
    for (const [toolName, tool] of Object.entries(server.tools || {})) {
      const key = `${server.name}\u0000${toolName}`;
      available.add(key);
      const label = element('label', 'goal-mcp-option');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.server = server.name;
      input.dataset.tool = toolName;
      input.checked = selected.has(key);
      const copy = element('span', '', `${server.name} / ${tool.name || toolName}`);
      if (tool.description) copy.append(element('small', '', tool.description));
      label.append(input, copy);
      fragment.append(label);
    }
  }
  for (const grant of goal?.permissions?.mcpTools || []) {
    if (available.has(`${grant.server}\u0000${grant.tool}`)) continue;
    const label = element('label', 'goal-mcp-option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.server = grant.server;
    input.dataset.tool = grant.tool;
    input.dataset.unavailable = 'true';
    label.append(input, element('span', '', `${grant.server} / ${grant.tool} · Not currently discovered. Refresh Extensions or remove this grant before saving.`));
    fragment.append(label);
  }
  if (!fragment.childNodes.length) fragment.append(element('p', 'field-hint', 'No MCP tools have been discovered. Configure and refresh a server in Extensions first.'));
  $('goal-mcp-tools').replaceChildren(fragment);
}

function renderGoalTrigger() {
  const type = $('goal-trigger').value;
  $('goal-interval-field').classList.toggle('hidden', type !== 'interval');
  $('goal-trigger-paths-field').classList.toggle('hidden', type !== 'files');
  $('goal-interval').disabled = type !== 'interval';
  $('goal-interval').required = type === 'interval';
  $('goal-trigger-paths').disabled = type !== 'files';
  $('goal-trigger-paths').required = type === 'files';
}

function renderGoalWriteScope() {
  $('goal-write-paths').disabled = !$('goal-permission-write').checked;
  $('goal-write-paths').required = $('goal-permission-write').checked;
}

async function saveGoal(event) {
  event.preventDefault();
  const invalidAdvanced = $('goal-advanced').querySelector('input:invalid,textarea:invalid,select:invalid');
  if (invalidAdvanced) $('goal-advanced').open = true;
  if (!$('goal-form').reportValidity()) return;
  $('goal-form-error').classList.add('hidden');
  $('save-goal').disabled = true;
  try {
    const lines = (id) => $(id).value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const steps = lines('goal-steps');
    if (steps.length > 20 || steps.some((step) => step.length > 1000)) throw new Error('Use up to 20 suggested steps, with at most 1,000 characters per step.');
    const checks = Array.from($('goal-checks').children, (row) => {
      const type = row.querySelector('.goal-check-type').value;
      return { type, ...(type === 'command' ? { command: row.querySelector('.goal-check-command').value.trim() } : { path: row.querySelector('.goal-check-path').value.trim() }), ...(type === 'fileContains' ? { contains: row.querySelector('.goal-check-contains').value } : {}) };
    });
    const selectedMcp = Array.from($('goal-mcp-tools').querySelectorAll('input:checked'));
    if (checks.some((check) => check.type === 'command') && !$('goal-permission-shell').checked) {
      $('goal-advanced').open = true;
      throw new Error('Enable terminal commands under Access to use a command verification check.');
    }
    if (selectedMcp.some((input) => input.dataset.unavailable === 'true')) throw new Error('Refresh Extensions to discover the saved MCP tools, or remove their grants before saving.');
    const existing = state.autonomy?.goals?.find((goal) => goal.id === editingGoalId);
    const payload = {
      ...(editingGoalId ? { id: editingGoalId } : {}), contractVersion: 2, kind: $('goal-kind').value, sources: { chat: $('goal-source-chat').checked, calendar: $('goal-source-calendar').checked, files: lines('goal-source-files') }, reviewPolicy: $('goal-review-policy').value, respectActiveHours: $('goal-active-hours').checked, maxQuietHours: Number($('goal-max-quiet-hours').value) || 0, name: $('goal-name').value.trim(), objective: $('goal-objective').value.trim(), steps, checks: $('goal-kind').value === 'ongoing' ? checks.filter(c => c.path || c.command) : checks,
      workspace: existing?.workspace || goalDraftContext.workspace, model: existing?.model || goalDraftContext.model, effort: existing?.effort || goalDraftContext.effort,
      priority: Number($('goal-priority').value),
      permissions: { write: $('goal-permission-write').checked, writePaths: $('goal-permission-write').checked ? lines('goal-write-paths') : [], shell: $('goal-permission-shell').checked, network: $('goal-permission-network').checked, mcpTools: selectedMcp.map((input) => ({ server: input.dataset.server, tool: input.dataset.tool })) },
      limits: { maxTokens: Number($('goal-max-tokens').value), maxMinutes: Number($('goal-max-minutes').value), maxActions: Number($('goal-max-actions').value), maxRuns: Number($('goal-max-runs').value), maxRetries: Number($('goal-max-retries').value) },
      trigger: { type: $('goal-trigger').value, intervalMinutes: Number($('goal-interval').value || 30), paths: $('goal-trigger').value === 'files' ? lines('goal-trigger-paths') : [] },
      dependsOn: Array.from($('goal-dependencies').querySelectorAll('input:checked'), (input) => input.value),
    };
    const result = await window.bot.saveGoal(payload);
    if (result?.settings) applyState(result);
    closeDialog('goal-dialog');
    if (currentView === 'goals') renderGoals();
    notify(editingGoalId ? 'Goal updated.' : 'Draft saved.');
  } catch (error) {
    $('goal-form-error').textContent = error?.message || String(error);
    $('goal-form-error').classList.remove('hidden');
    $('goal-form-error').scrollIntoView({ block: 'nearest' });
  } finally { $('save-goal').disabled = false; }
}

async function reviewGoalRestore(goal, runId) {
  goalRestoreTarget = { id: goal.id, runId };
  $('goal-restore-title').textContent = 'Undo this run';
  $('goal-restore-description').textContent = `${goal.name}\nReviewing the files changed since this run’s backup…`;
  $('goal-restore-changes').replaceChildren();
  $('goal-restore-error').classList.add('hidden');
  $('confirm-goal-restore').disabled = true;
  showDialog('goal-restore-dialog');
  try {
    const preview = await window.bot.previewGoalRestore({ id: goal.id, runId });
    if (goalRestoreTarget?.id !== goal.id || goalRestoreTarget?.runId !== runId) return;
    $('goal-restore-description').textContent = `${goal.name}\nThese files would be restored to their saved versions before the selected run.`;
    const fragment = document.createDocumentFragment();
    for (const change of preview.changes || []) {
      const row = element('div', 'goal-restore-change');
      const actionText = change.kind === 'created' ? 'Will remove' : change.kind === 'deleted' ? 'Will recreate' : 'Will restore';
      row.append(element('code', '', change.path), element('span', '', actionText));
      fragment.append(row);
    }
    if (!fragment.childNodes.length) fragment.append(element('p', 'goal-no-data', 'No file changes to restore.'));
    $('goal-restore-changes').replaceChildren(fragment);
    if (preview.conflicts?.length) {
      $('goal-restore-error').textContent = `Restore is blocked:\n${preview.conflicts.join('\n')}`;
      $('goal-restore-error').classList.remove('hidden');
    } else if (!preview.canRestore) {
      $('goal-restore-error').textContent = 'This saved run is not available to restore.';
      $('goal-restore-error').classList.remove('hidden');
    }
    $('confirm-goal-restore').disabled = !preview.canRestore || Boolean(preview.conflicts?.length) || !preview.changes?.length;
  } catch (error) {
    $('goal-restore-error').textContent = error?.message || String(error);
    $('goal-restore-error').classList.remove('hidden');
  }
}

async function restoreGoal() {
  if (!goalRestoreTarget || $('confirm-goal-restore').disabled) return;
  const target = { ...goalRestoreTarget };
  $('confirm-goal-restore').disabled = true;
  try {
    const result = await window.bot.restoreGoal(target);
    if (result?.settings) applyState(result);
    if (goalRestoreTarget?.id === target.id && goalRestoreTarget?.runId === target.runId) closeDialog('goal-restore-dialog');
    notify('The reviewed files were restored.');
  } catch (error) {
    if (goalRestoreTarget?.id !== target.id || goalRestoreTarget?.runId !== target.runId) { notify(error?.message || String(error), true); return; }
    $('goal-restore-error').textContent = error?.message || String(error);
    $('goal-restore-error').classList.remove('hidden');
    $('goal-restore-description').textContent = 'Restore did not finish. Close this review and preview the current changes before trying again.';
  }
}

const extensionData = () => state.extensions || { servers: [], skills: [], plugins: [] };
const parentPlugin = (record) => (extensionData().plugins || []).find((plugin) => plugin.id === record.pluginId);
const extensionEnabled = (record) => Boolean(record.enabled && (!record.pluginId || parentPlugin(record)?.enabled));

function selectExtensionTab(tab, focus = false) {
  extensionTab = tab;
  for (const candidate of ['tools', 'skills', 'servers', 'plugins']) {
    const active = candidate === tab;
    const button = $('extensions-tab-' + candidate);
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    $('extensions-panel-' + candidate).classList.toggle('hidden', !active);
  }
  if (focus) $('extensions-tab-' + tab).focus();
  if (state) renderExtensions();
}

async function mutateExtension(key, operation, successMessage) {
  if (extensionPending.has(key)) return null;
  extensionPending.add(key);
  if (currentView === 'extensions') renderExtensions();
  try {
    const result = await operation();
    if (result?.settings) applyState(result);
    if (result != null && successMessage) notify(successMessage);
    return result;
  } catch (error) {
    notify(error?.message || String(error), true);
    return null;
  } finally {
    extensionPending.delete(key);
    if (currentView === 'extensions') renderExtensions();
  }
}

function extensionEmpty(title, description, iconName) {
  const empty = element('div', 'extension-empty');
  empty.append(icon(iconName || 'extensions'), element('h3', '', title), element('p', '', description));
  return empty;
}

function extensionCard(name, description, iconName = 'extensions') {
  const card = element('article', 'extension-card');
  const heading = element('div', 'extension-card-heading');
  const badge = element('div', 'routine-icon');
  badge.append(icon(iconName));
  const copy = element('div', 'extension-card-copy');
  copy.append(element('h3', '', name));
  if (description) copy.append(element('p', 'extension-card-description', description));
  heading.append(badge, copy);
  card.append(heading);
  return { card, heading, copy };
}

function extensionToggle(label, enabled, pendingKey, onChange, disabled = false) {
  const toggle = element('label', 'switch');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = enabled;
  input.disabled = disabled || extensionPending.has(pendingKey);
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => onChange(input.checked));
  toggle.append(input, element('span', 'switch-track'));
  return toggle;
}

function extensionInspector(label, text, key) {
  const details = element('details', 'extension-inspect');
  details.dataset.extensionDetail = key;
  details.append(element('summary', '', label), element('pre', '', text));
  return details;
}

function managedExtensionFooter(record) {
  const footer = element('div', 'extension-card-footer');
  const plugin = parentPlugin(record);
  footer.append(element('span', 'extension-managed-note', `Managed by ${plugin?.name || 'its plugin'}`), action('Manage in Plugins', () => selectExtensionTab('plugins'), 'extension-manage-link'));
  return footer;
}

function runtimeForServer(server) {
  return (state.extensionRuntime?.servers || []).find((runtime) => runtime.name === server.name || runtime.id === server.id);
}

function connectionBadge(runtime) {
  const status = runtime?.runtimeStatus;
  const connected = status === 'ready' || status === 'connected';
  const failed = status === 'error' || status === 'failed';
  const label = connected ? 'Connection verified' : failed ? 'Connection error' : status === 'starting' || status === 'connecting' ? 'Connecting' : status === 'authenticationRequired' ? 'Sign-in needed' : status === 'disabled' ? 'Not connected · disabled' : 'Not connected';
  return element('span', `extension-status ${connected ? 'connected' : failed ? 'error' : ''}`, label);
}

function renderExtensions() {
  const runtime = state.extensionRuntime || {};
  const syncing = extensionsRefreshing || runtime.status === 'syncing';
  $('extensions-refresh').disabled = syncing;
  $('extensions-refresh').replaceChildren(icon('refresh'), document.createTextNode(syncing ? 'Refreshing…' : 'Refresh'));
  $('extensions-status').textContent = syncing ? 'Connecting enabled servers…' : runtime.status === 'error' ? 'Refresh needs attention' : runtime.updatedAt ? 'Saved discovery results' : 'Not connected';
  $('extensions-status').classList.toggle('error', runtime.status === 'error');
  $('extensions-updated').textContent = runtime.updatedAt ? `Last refreshed ${formatDate(runtime.updatedAt)}` : 'Refresh connects enabled servers and discovers their tools.';
  $('extensions-error').textContent = runtime.error || '';
  $('extensions-error').classList.toggle('hidden', !runtime.error);
  $('import-skill').disabled = extensionPending.has('import-skill');
  $('import-plugin').disabled = extensionPending.has('import-plugin');
  const expanded = new Set(Array.from($('extensions-view').querySelectorAll('details[open][data-extension-detail]'), (details) => details.dataset.extensionDetail));
  if (extensionTab === 'tools') renderExtensionTools();
  if (extensionTab === 'skills') renderExtensionSkills();
  if (extensionTab === 'servers') renderExtensionServers();
  if (extensionTab === 'plugins') renderExtensionPlugins();
  for (const details of $('extensions-view').querySelectorAll('details[data-extension-detail]')) details.open = expanded.has(details.dataset.extensionDetail);
}

function renderExtensionTools() {
  const fragment = document.createDocumentFragment();
  fragment.append(element('p', 'extension-group-label', 'Built in'));
  for (const core of [
    { name: 'Terminal commands', description: 'Run commands through the local engine. Sandbox permissions and approval rules apply.', icon: 'terminal' },
    { name: 'Files and folders', description: 'Read and edit project files through the local engine. Changes follow workspace permissions.', icon: 'folder' },
  ]) {
    const { card, heading } = extensionCard(core.name, core.description, core.icon);
    heading.append(element('span', 'extension-tag', 'Built in'));
    fragment.append(card);
  }
  fragment.append(element('p', 'extension-group-label', 'External MCP tools'));
  let discovered = 0;
  for (const server of extensionData().servers || []) {
    const runtime = runtimeForServer(server);
    for (const [key, tool] of Object.entries(runtime?.tools || {})) {
      discovered += 1;
      const { card, heading, copy } = extensionCard(tool.name || key, tool.description || 'This server did not provide a description.', 'extensions');
      const pendingKey = `tool:${server.id}:${key}`;
      const enabled = extensionEnabled(server) && !(server.disabledTools || []).includes(key);
      heading.append(extensionToggle(`Enable ${tool.name || key}`, enabled, pendingKey, (next) => mutateExtension(pendingKey, () => window.bot.toggleMcpTool({ id: server.id, tool: key, enabled: next })), !extensionEnabled(server)));
      const meta = element('div', 'extension-card-meta');
      meta.append(element('span', '', server.name), connectionBadge(runtime), element('span', '', enabled ? 'Approval required per call' : 'Disabled'));
      if (server.pluginId) meta.append(element('span', 'extension-tag', parentPlugin(server)?.name || 'Plugin'));
      copy.append(meta);
      if (tool.inputSchema) card.append(extensionInspector('Inspect input schema', JSON.stringify(tool.inputSchema, null, 2), `tool:${server.id}:${key}`));
      fragment.append(card);
    }
  }
  if (!discovered) fragment.append(extensionEmpty('No external tools', 'Enable an MCP server, then refresh.', 'extensions'));
  $('extensions-tools').replaceChildren(fragment);
}

function renderExtensionSkills() {
  const fragment = document.createDocumentFragment();
  for (const skill of extensionData().skills || []) {
    const { card, heading, copy } = extensionCard(skill.name, skill.description || 'Instructions for an explicitly requested workflow.', 'memory');
    const pendingKey = `skill:${skill.id}`;
    const enabled = extensionEnabled(skill);
    heading.append(extensionToggle(`Enable ${skill.name}`, enabled, pendingKey, (next) => mutateExtension(pendingKey, () => window.bot.saveSkill({ ...skill, enabled: next })), Boolean(skill.pluginId)));
    const meta = element('div', 'extension-card-meta');
    meta.append(element('code', '', `$${skill.name}`), element('span', '', enabled ? 'Enabled' : 'Disabled'));
    if (skill.pluginId) meta.append(element('span', 'extension-tag', parentPlugin(skill)?.name || 'Plugin'));
    if (skill.bundled) meta.append(element('span', 'extension-tag', 'Built in'));
    copy.append(meta);
    card.append(extensionInspector('Read instructions', skill.content || '', `skill:${skill.id}`));
    const footer = skill.pluginId ? managedExtensionFooter(skill) : element('div', 'extension-card-footer');
    const use = action('Use in chat', () => useSkillInChat(skill), 'button secondary', 'chat');
    use.disabled = !enabled;
    footer.prepend(use);
    if (!skill.pluginId) {
      footer.append(action('Edit', () => editSkill(skill), 'button text-button'));
      const remove = action('', async () => {
        if (await confirmAction('Delete this skill?', `“${skill.name}” will be removed from this app. Its original file, if imported, will stay on your computer.`)) await mutateExtension(pendingKey, () => window.bot.deleteSkill({ id: skill.id }), 'Skill deleted.');
      }, 'icon-button', 'trash');
      remove.setAttribute('aria-label', `Delete ${skill.name}`);
      footer.append(remove);
    }
    card.append(footer);
    fragment.append(card);
  }
  if (!(extensionData().skills || []).length) fragment.append(extensionEmpty('No skills yet', 'Create or import a SKILL.md. Use $skill-name in chat.', 'memory'));
  $('extensions-skills').replaceChildren(fragment);
}

function renderExtensionServers() {
  const fragment = document.createDocumentFragment();
  for (const server of extensionData().servers || []) {
    const runtime = runtimeForServer(server);
    const { card, heading, copy } = extensionCard(server.name, server.transport === 'http' ? server.url : [server.command, ...(server.args || [])].join(' '), 'server');
    const pendingKey = `server:${server.id}`;
    const enabled = extensionEnabled(server);
    heading.append(extensionToggle(`Enable ${server.name}`, enabled, pendingKey, (next) => mutateExtension(pendingKey, () => window.bot.saveMcpServer({ ...server, enabled: next })), Boolean(server.pluginId)));
    const meta = element('div', 'extension-card-meta');
    meta.append(element('span', '', server.transport === 'http' ? 'Remote HTTP' : 'Local stdio'), element('span', '', enabled ? 'Enabled' : 'Disabled'), connectionBadge(runtime));
    if (runtime?.authStatus) meta.append(element('span', '', { unknown: 'Authentication unknown', unsupported: 'OAuth not supported', notLoggedIn: 'Not signed in', bearerToken: 'Token authentication', oAuth: 'OAuth signed in' }[runtime.authStatus] || `Auth: ${humanStatus(runtime.authStatus)}`));
    if (server.pluginId) meta.append(element('span', 'extension-tag', parentPlugin(server)?.name || 'Plugin'));
    copy.append(meta);
    if (runtime?.toolsError) card.append(element('p', 'inline-error', runtime.toolsError));
    const footer = server.pluginId ? managedExtensionFooter(server) : element('div', 'extension-card-footer');
    if (server.transport === 'http') {
      const signIn = action('Sign in', async () => {
        const result = await mutateExtension(`login:${server.id}`, () => window.bot.loginMcpServer({ id: server.id }));
        if (result?.started) notify('Finish signing in in your browser, then refresh the server.');
      }, 'button secondary', 'arrow-up-right');
      signIn.disabled = !enabled || extensionPending.has(`login:${server.id}`);
      footer.prepend(signIn);
    }
    if (!server.pluginId) {
      footer.append(action('Edit', () => editMcpServer(server), 'button text-button'));
      const remove = action('', async () => {
        if (await confirmAction('Delete this server?', `“${server.name}” and its saved tool choices will be removed from Little Bot.`)) await mutateExtension(pendingKey, () => window.bot.deleteMcpServer({ id: server.id }), 'Server deleted.');
      }, 'icon-button', 'trash');
      remove.setAttribute('aria-label', `Delete ${server.name}`);
      footer.append(remove);
    }
    card.append(footer);
    fragment.append(card);
  }
  if (!(extensionData().servers || []).length) fragment.append(extensionEmpty('No MCP servers', 'Add a local or remote server. Enable it when ready.', 'server'));
  $('extensions-servers').replaceChildren(fragment);
}

function renderExtensionPlugins() {
  const fragment = document.createDocumentFragment();
  for (const plugin of extensionData().plugins || []) {
    const { card, heading, copy } = extensionCard(plugin.name, plugin.description || 'A local bundle of skill instructions and MCP configurations.', 'extensions');
    const pendingKey = `plugin:${plugin.id}`;
    heading.append(extensionToggle(`Enable ${plugin.name}`, Boolean(plugin.enabled), pendingKey, (enabled) => mutateExtension(pendingKey, () => window.bot.togglePlugin({ id: plugin.id, enabled }))));
    const meta = element('div', 'extension-card-meta');
    meta.append(element('span', '', plugin.enabled ? 'Enabled' : 'Disabled'), element('span', '', `${plugin.skillIds?.length || 0} skills · ${plugin.serverIds?.length || 0} servers`));
    if (plugin.version) meta.append(element('span', '', `v${plugin.version}`));
    copy.append(meta);
    if (plugin.sourcePath) copy.append(element('p', 'field-hint plugin-source', `Imported from ${plugin.sourcePath}`));
    const footer = element('div', 'extension-card-footer');
    footer.append(action('View skills', () => selectExtensionTab('skills'), 'button text-button'), action('View servers', () => selectExtensionTab('servers'), 'button text-button'));
    const remove = action('', async () => {
      if (await confirmAction('Remove this plugin?', `“${plugin.name}” and its imported skills and servers will be removed from Little Bot. The original folder will stay on your computer.`, 'Remove plugin')) await mutateExtension(pendingKey, () => window.bot.deletePlugin({ id: plugin.id }), 'Plugin removed.');
    }, 'icon-button', 'trash');
    remove.setAttribute('aria-label', `Remove ${plugin.name}`);
    footer.append(remove);
    card.append(footer);
    fragment.append(card);
  }
  if (!(extensionData().plugins || []).length) fragment.append(extensionEmpty('No plugins yet', 'Import a folder of skills and MCP connections.', 'extensions'));
  $('extensions-plugins').replaceChildren(fragment);
}

function editMcpServer(server) {
  if (server?.pluginId) { selectExtensionTab('plugins'); return; }
  editingServerId = server?.id || null;
  $('mcp-server-title').textContent = server ? 'Edit MCP server' : 'Add MCP server';
  $('mcp-server-name').value = server?.name || '';
  $('mcp-server-transport').value = server?.transport || 'stdio';
  $('mcp-server-command').value = server?.command || '';
  $('mcp-server-args').value = JSON.stringify(server?.args || [], null, 2);
  $('mcp-server-env').value = (server?.envVars || []).join('\n');
  $('mcp-server-url').value = server?.url || '';
  $('mcp-server-bearer').value = server?.bearerTokenEnvVar || '';
  $('mcp-server-enabled').checked = Boolean(server?.enabled);
  $('mcp-server-error').classList.add('hidden');
  $('save-mcp-server').disabled = false;
  renderMcpTransport();
  showDialog('mcp-server-dialog');
}

function renderMcpTransport() {
  const http = $('mcp-server-transport').value === 'http';
  $('mcp-stdio-fields').classList.toggle('hidden', http);
  $('mcp-http-fields').classList.toggle('hidden', !http);
  for (const id of ['mcp-server-command', 'mcp-server-args', 'mcp-server-env']) $(id).disabled = http;
  for (const id of ['mcp-server-url', 'mcp-server-bearer']) $(id).disabled = !http;
  $('mcp-server-command').required = !http;
  $('mcp-server-url').required = http;
}

async function saveMcpServer(event) {
  event.preventDefault();
  if (!$('mcp-server-form').reportValidity()) return;
  $('mcp-server-error').classList.add('hidden');
  $('save-mcp-server').disabled = true;
  try {
    const existing = (extensionData().servers || []).find((server) => server.id === editingServerId);
    const transport = $('mcp-server-transport').value;
    let args = [];
    if (transport === 'stdio') {
      try { args = JSON.parse($('mcp-server-args').value.trim() || '[]'); }
      catch { throw new Error('Arguments must be a JSON array, for example ["--port", "3000"].'); }
      if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) throw new Error('Arguments must be an array of strings.');
    }
    const envVars = transport === 'stdio' ? [...new Set($('mcp-server-env').value.split(/[,\n\r]+/).map((name) => name.trim()).filter(Boolean))] : [];
    if (envVars.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('Enter environment variable names only, such as SERVICE_API_KEY. Do not include values or equals signs.');
    const bearerTokenEnvVar = transport === 'http' ? $('mcp-server-bearer').value.trim() : '';
    if (bearerTokenEnvVar && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(bearerTokenEnvVar)) throw new Error('Enter the bearer-token variable name only, not the token value.');
    const result = await window.bot.saveMcpServer({
      ...(editingServerId ? { id: editingServerId } : {}), name: $('mcp-server-name').value.trim(), transport,
      command: transport === 'stdio' ? $('mcp-server-command').value.trim() : '', args, envVars,
      url: transport === 'http' ? $('mcp-server-url').value.trim() : '', bearerTokenEnvVar,
      enabled: $('mcp-server-enabled').checked, disabledTools: existing?.disabledTools || [],
    });
    if (result?.settings) applyState(result);
    closeDialog('mcp-server-dialog');
    notify('MCP server saved.');
  } catch (error) {
    $('mcp-server-error').textContent = error?.message || String(error);
    $('mcp-server-error').classList.remove('hidden');
  } finally { $('save-mcp-server').disabled = false; }
}

function editSkill(skill) {
  if (skill?.pluginId) { selectExtensionTab('plugins'); return; }
  editingSkillId = skill?.id || null;
  $('skill-title').textContent = skill ? 'Edit skill' : 'New skill';
  $('skill-name').value = skill?.name || '';
  $('skill-description').value = skill?.description || '';
  $('skill-content').value = skill?.content || '';
  $('skill-enabled').checked = skill ? Boolean(skill.enabled) : true;
  $('skill-error').classList.add('hidden');
  $('save-skill').disabled = false;
  showDialog('skill-dialog');
}

async function saveSkill(event) {
  event.preventDefault();
  if (!$('skill-form').reportValidity()) return;
  $('skill-error').classList.add('hidden');
  $('save-skill').disabled = true;
  try {
    const result = await window.bot.saveSkill({ ...(editingSkillId ? { id: editingSkillId } : {}), name: $('skill-name').value.trim(), description: $('skill-description').value.trim(), content: $('skill-content').value, enabled: $('skill-enabled').checked });
    if (result?.settings) applyState(result);
    closeDialog('skill-dialog');
    notify('Skill saved. Use its $name in a message to apply it.');
  } catch (error) {
    $('skill-error').textContent = error?.message || String(error);
    $('skill-error').classList.remove('hidden');
  } finally { $('save-skill').disabled = false; }
}

async function useSkillInChat(skill) {
  const draft = $('message-input').value;
  const invocation = `$${skill.name} `;
  if (!draft.startsWith(invocation) && draft.length + invocation.length > 32000) {
    notify('Shorten your draft before adding this skill. Your text has been kept.', true);
    return;
  }
  if (draft.trim() && !await confirmAction('Add this skill to your draft?', `Your existing text will be kept. “$${skill.name}” will be added at the beginning. Nothing will be sent.`, 'Use skill')) return;
  selectChat(selectedChatId);
  if (!$('message-input').value.startsWith(invocation)) $('message-input').value = invocation + $('message-input').value;
  saveCurrentDraft();
  sizeComposer();
  updateComposer();
  $('message-input').focus();
}

function renderApprovals() {
  const approvals = state.approvals || [];
  const forChat = approvals.filter((approval) => approval.chatId === selectedChatId);
  $('approval-banner').classList.toggle('hidden', forChat.length === 0);
  $('approval-banner-text').textContent = forChat[0]?.kind === 'question' ? 'Little Bot has a question for you.' : 'Your approval is needed to continue.';
  if (activeApprovalId && !approvals.some((approval) => approval.requestId === activeApprovalId)) {
    closeDialog('approval-dialog');
    activeApprovalId = null;
  }
  const unseen = approvals.find((approval) => !seenApprovals.has(approval.requestId));
  if (unseen && !document.querySelector('dialog[open]')) openApproval(unseen);
}

function openApproval(approval) {
  if (!approval) return;
  activeApprovalId = approval.requestId;
  seenApprovals.add(approval.requestId);
  const isQuestion = approval.kind === 'question';
  const mcpForm = approval.kind === 'mcp' && approval.questions?.length;
  $('approval-eyebrow').textContent = isQuestion ? 'A LITTLE MORE CONTEXT' : "YOU'RE IN CONTROL";
  $('approval-title').textContent = approval.title || (isQuestion ? 'Little Bot has a question' : 'Review this action');
  const chat = state.chats?.find((candidate) => candidate.id === approval.chatId);
  $('approval-description').textContent = `${chat?.title || 'Little Bot'}${chat?.workspace ? `\n${chat.workspace}` : ''}`;
  $('approval-detail').textContent = typeof approval.detail === 'object' ? JSON.stringify(approval.detail, null, 2) : approval.detail || '';
  $('approval-detail').classList.toggle('hidden', !approval.detail);
  const requestedUrl = typeof approval.url === 'string' && /^https?:\/\//i.test(approval.url) ? approval.url : '';
  $('approval-url').classList.toggle('hidden', !requestedUrl);
  if (requestedUrl) $('approval-url').href = requestedUrl;
  else $('approval-url').removeAttribute('href');
  $('accept-approval').textContent = isQuestion ? 'Send answer' : mcpForm ? 'Send response' : 'Allow once';
  $('decline-approval').textContent = isQuestion ? 'Skip' : 'Decline';
  $('accept-approval').disabled = false;
  $('decline-approval').disabled = false;
  const fragment = document.createDocumentFragment();
  for (const [index, question] of (approval.questions || []).entries()) {
    const group = element('fieldset', 'question-block');
    group.dataset.questionId = question.id;
    group.dataset.optional = String(Boolean(question.optional));
    group.append(element('legend', '', (question.question || question.header || 'Your answer') + (question.optional ? ' (optional)' : '')));
    for (const [optionIndex, option] of (question.options || []).entries()) {
      const label = element('label', 'question-option');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `question-${index}`;
      radio.value = option.label;
      radio.id = `question-${index}-option-${optionIndex}`;
      const copy = element('span', '', option.label);
      if (option.description) copy.append(element('small', '', option.description));
      label.append(radio, copy);
      group.append(label);
    }
    const answer = document.createElement('input');
    answer.type = question.isSecret ? 'password' : 'text';
    answer.autocomplete = 'off';
    answer.maxLength = approval.dynamicTool === 'ask_user' ? 2000 : 8000;
    answer.className = 'free-answer';
    answer.placeholder = question.options?.length ? 'Or write your own answer…' : 'Your answer…';
    answer.setAttribute('aria-label', question.question || question.header || 'Your answer');
    answer.addEventListener('input', () => {
      if (answer.value) group.querySelectorAll('input[type=radio]').forEach((radio) => { radio.checked = false; });
    });
    group.querySelectorAll('input[type=radio]').forEach((radio) => radio.addEventListener('change', () => { answer.value = ''; }));
    group.append(answer);
    fragment.append(group);
  }
  $('approval-questions').replaceChildren(fragment);
  showDialog('approval-dialog');
}

async function respondApproval(decision) {
  const requestId = activeApprovalId;
  if (!requestId) return;
  const answers = {};
  if (decision === 'accept') {
    for (const fieldset of $('approval-questions').querySelectorAll('fieldset')) {
      const answer = fieldset.querySelector('.free-answer').value.trim() || fieldset.querySelector('input[type=radio]:checked')?.value;
      if (!answer && fieldset.dataset.optional === 'true') continue;
      if (!answer) {
        notify('Add an answer to each question before continuing.');
        fieldset.querySelector('.free-answer').focus();
        return;
      }
      answers[fieldset.dataset.questionId] = { answers: [answer] };
    }
  }
  $('accept-approval').disabled = true;
  $('decline-approval').disabled = true;
  try {
    await window.bot.respondApproval({ requestId, decision, ...(Object.keys(answers).length ? { answers } : {}) });
    if (activeApprovalId === requestId) {
      closeDialog('approval-dialog');
      activeApprovalId = null;
    }
    const fresh = await window.bot.getState();
    applyState(fresh);
  } catch (error) {
    notify(error?.message || String(error), true);
  } finally {
    $('accept-approval').disabled = false;
    $('decline-approval').disabled = false;
  }
}

function confirmAction(title, message, label = 'Delete') {
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-accept').textContent = label;
  showDialog('confirm-dialog');
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function resolveConfirm(accepted) {
  const resolve = confirmResolver;
  confirmResolver = null;
  closeDialog('confirm-dialog');
  resolve?.(accepted);
}

$('nav-conversation').addEventListener('click', () => selectChat(null));
$('nav-automations').addEventListener('click', showAutomations);
$('nav-calendar').addEventListener('click', () => showFeature('calendar'));
$('nav-memory').addEventListener('click', () => showFeature('memory'));
$('nav-inbox').addEventListener('click', () => showFeature('inbox'));
for (const button of document.querySelectorAll('[data-inbox-filter]')) button.addEventListener('click', () => {
  inboxFilter = button.dataset.inboxFilter; renderActivityInbox();
});
$('inbox-source').addEventListener('change', () => { inboxSource = $('inbox-source').value; renderActivityInbox(); });
$('nav-heartbeat').addEventListener('click', () => showFeature('heartbeat'));
$('nav-extensions').addEventListener('click', () => showFeature('extensions'));
$('nav-goals').addEventListener('click', () => showFeature('goals'));
$('nav-profile').addEventListener('click', () => showFeature('profile'));
$('profile-form').addEventListener('submit', saveProfile);
for (const key of ['user', 'soul']) $('profile-' + key).addEventListener('input', () => { profileSaveError = ''; renderProfile(); });
$('open-profile-folder').addEventListener('click', () => attempt(() => window.bot.openProfileFolder()));
$('create-goal').addEventListener('click', () => editGoal());
$('goal-form').addEventListener('submit', saveGoal);
$('goal-kind').addEventListener('change', renderGoalKind);
$('goal-add-check').addEventListener('click', () => addGoalCheck());
$('goal-trigger').addEventListener('change', renderGoalTrigger);
$('goal-permission-write').addEventListener('change', renderGoalWriteScope);
$('pause-autonomy').addEventListener('click', () => mutateGoal('autonomy', () => window.bot.pauseAutonomy()));
$('resume-autonomy').addEventListener('click', () => mutateGoal('autonomy', () => window.bot.resumeAutonomy()));
$('confirm-goal-restore').addEventListener('click', restoreGoal);
$('goal-restore-dialog').addEventListener('close', () => { goalRestoreTarget = null; });
$('nav-settings').addEventListener('click', () => showDialog('settings-dialog'));
$('connection-settings-form').addEventListener('submit', saveConnection);
for (const id of ['settings-connection', 'settings-local-url', 'settings-local-model']) $(id).addEventListener('input', () => { connectionError = ''; renderConnectionSettings(); });
$('settings-connection-check').addEventListener('click', checkConnection);
$('local-connection-settings').addEventListener('click', () => showDialog('settings-dialog'));
$('local-connection-check').addEventListener('click', checkConnection);
$('system-prompt-settings-form').addEventListener('submit', saveSystemPromptSettings);
$('settings-system-prompt').addEventListener('input', () => {
  systemPromptError = '';
  $('system-prompt-settings-saved').textContent = '';
  renderSystemPromptSettings();
});
$('reset-system-prompt').addEventListener('click', resetSystemPromptSettings);
$('independent-check-settings-form').addEventListener('submit', saveIndependentCheckSettings);
$('settings-independent-check').addEventListener('change', () => {
  independentCheckSettingsError = '';
  $('independent-check-settings-saved').textContent = '';
  renderIndependentCheckSettings();
});
$('compaction-settings-form').addEventListener('submit', saveCompactionSettings);
$('settings-auto-compact').addEventListener('input', () => {
  compactionSettingsError = '';
  $('compaction-settings-saved').textContent = '';
  renderCompactionSettings();
});
$('agent-inspector-toggle').addEventListener('click', () => setAgentInspectorOpen(!agentInspectorOpen));
$('agent-inspector-close').addEventListener('click', () => setAgentInspectorOpen(false));
$('inspector-context-refresh').addEventListener('click', () => {
  const chat = currentChat();
  if (!chat) return;
  contextUsedCache.delete(chat.id);
  loadContextUsed(chat, true);
});
$('open-agent-browser').addEventListener('click', () => browserAction('open'));
$('settings-open-browser').addEventListener('click', () => browserAction('open'));
$('settings-close-browser').addEventListener('click', () => browserAction('close'));
$('settings-install-browser').addEventListener('click', () => browserAction('install'));
for (const service of ['firecrawl', 'brave']) {
  $('service-' + service + '-form').addEventListener('submit', (event) => { event.preventDefault(); saveServiceKey(service); });
  $('service-' + service + '-remove').addEventListener('click', () => saveServiceKey(service, true));
  $('service-' + service + '-key').addEventListener('input', () => { serviceKeyErrors.delete(service); renderServiceKeys(); });
  $('service-' + service + '-page').addEventListener('click', () => attempt(() => window.bot.openServicePage({ service })));
}
$('settings-dialog').addEventListener('close', () => {
  for (const service of ['firecrawl', 'brave']) $('service-' + service + '-key').value = '';
  serviceKeyErrors.clear();
  if (state) renderServiceKeys();
});
$('choose-workspace').addEventListener('click', chooseWorkspace);
$('settings-choose-workspace').addEventListener('click', chooseWorkspace);
$('settings-open-workspace').addEventListener('click', () => attempt(() => window.bot.openWorkspace()));
$('settings-clean-attachments').addEventListener('click', () => attempt(() => window.bot.cleanupAttachments(), 'Unused attachment files cleaned.'));
$('settings-open-logs').addEventListener('click', () => attempt(() => window.bot.openLogs(), 'Opened diagnostic logs.'));
$('settings-login').addEventListener('click', () => {
  closeDialog('settings-dialog');
  if (isConnected()) login('chatgpt');
  else { selectChat(null); programmaticChatScroll(() => { $('chat-scroll').scrollTop = 0; }); $('connect-chatgpt').focus(); }
});
$('chat-scroll').addEventListener('scroll', () => {
  if (!chatScrollProgrammatic) chatFollowTail = LittleBotChatScroll.nearBottom($('chat-scroll'));
});
$('composer').addEventListener('submit', sendMessage);
$('attach-button').addEventListener('click', () => addAttachments());
$('message-input').addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;
  event.preventDefault();
  pasteAttachments(files);
});
let dragDepth = 0;
document.addEventListener('dragover', (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  dragDepth = 0;
  $('chat-view').classList.remove('drop-active');
  if (currentView === 'chat' && !document.querySelector('dialog[open]')) addAttachments(event.dataTransfer.files);
});
$('chat-view').addEventListener('dragenter', (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  $('chat-view').classList.add('drop-active');
});
$('chat-view').addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('chat-view').classList.remove('drop-active');
});
$('compact-chat').addEventListener('click', compactChat);
$('message-input').addEventListener('input', () => { sizeComposer(); updateComposer(); });
$('message-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
});
$('stop-button').addEventListener('click', () => {
  if (selectedChatId) attempt(() => window.bot.stop({ chatId: selectedChatId }));
});
$('model-select').addEventListener('change', () => attempt(() => window.bot.saveSettings({
  model: $('model-select').value,
  effort: state.settings.effort || 'low',
})));
$('effort-select').addEventListener('change', changeReasoningEffort);
$('thinking-toggle').addEventListener('click', toggleThinking);
$('plan-mode-toggle').addEventListener('click', () => {
  if ($('plan-mode-toggle').disabled) return;
  planModeDrafts.set(draftKey(), !currentPlanMode());
  updateComposer();
  $('message-input').focus();
});
document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    $('message-input').value = button.dataset.prompt;
    sizeComposer();
    updateComposer();
    $('message-input').focus();
  });
});
$('connect-chatgpt').addEventListener('click', () => login('chatgpt'));
$('show-api-key').addEventListener('click', () => {
  $('api-key-form').classList.toggle('hidden');
  if (!$('api-key-form').classList.contains('hidden')) $('api-key').focus();
});
$('api-key-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const key = $('api-key').value.trim();
  if (key) login('apiKey', key);
});
$('create-calendar-event').addEventListener('click', () => editCalendarEvent());
$('calendar-form').addEventListener('submit', saveCalendarEvent);
$('calendar-all-day').addEventListener('change', renderCalendarAllDay);
$('create-automation').addEventListener('click', () => editAutomation());
$('suggest-automation').addEventListener('click', () => { showAutomations(); editAutomation(); });
$('automation-form').addEventListener('submit', saveAutomation);
$('automation-schedule-type').addEventListener('change', renderAutomationScheduleEditor);
$('memory-enabled').addEventListener('change', async () => {
  const enabled = $('memory-enabled').checked;
  $('memory-enabled').disabled = true;
  await attempt(() => window.bot.saveMemory({ enabled }));
  $('memory-enabled').disabled = false;
  if (currentView === 'memory') renderMemory();
});
$('add-fact').addEventListener('click', () => editFact());
$('fact-form').addEventListener('submit', saveFact);
$('fact-scope').addEventListener('change', renderFactScope);
$('memory-embedding-provider').addEventListener('change', () => {
  $('memory-remote-settings').classList.toggle('hidden', $('memory-embedding-provider').value !== 'remote');
});
$('memory-embedding-form').addEventListener('submit', async event => {
  event.preventDefault();
  const provider = $('memory-embedding-provider').value;
  const embedding = provider === 'bundled' ? { provider } : provider === 'none' ? null : { baseUrl: $('memory-embedding-url').value.trim(), model: $('memory-embedding-model').value.trim(), apiKey: $('memory-embedding-key').value };
  if (provider === 'remote' && (!embedding.baseUrl || !embedding.model)) return notify('Enter an embedding server URL and model.', true);
  await attempt(() => window.bot.configureMemory({ embedding }), 'Memory search settings saved.');
});
$('memory-project-form').addEventListener('submit', async event => {
  event.preventDefault();
  const workspace = $('memory-project-workspace').value.trim();
  if (!workspace || !$('memory-project').value) return;
  await attempt(() => window.bot.linkMemoryProject({ projectId: $('memory-project').value, workspace }), 'Folder linked to project memory.');
});
$('memory-search').addEventListener('input', () => { clearTimeout(memorySearchTimer); memorySearchTimer = setTimeout(refreshMemoryResults, 160); });
$('memory-type').addEventListener('change', refreshMemoryResults);
$('memory-refresh-context').addEventListener('click', renderMemoryContext);
for (const id of ['heartbeat-start-hour', 'heartbeat-end-hour']) {
  for (let hour = 0; hour < 24; hour += 1) {
    const option = element('option', '', `${String(hour).padStart(2, '0')}:00`);
    option.value = hour;
    $(id).append(option);
  }
}
$('heartbeat-form').addEventListener('input', markHeartbeatDirty);
$('heartbeat-form').addEventListener('change', markHeartbeatDirty);
$('heartbeat-form').addEventListener('submit', saveHeartbeat);
$('heartbeat-use-workspace').addEventListener('click', () => {
  heartbeatUseCurrentWorkspace = true;
  markHeartbeatDirty();
});
$('run-heartbeat').addEventListener('click', runHeartbeat);
$('stop-heartbeat').addEventListener('click', async () => {
  $('stop-heartbeat').disabled = true;
  try { await attempt(() => window.bot.stopHeartbeat()); }
  finally { $('stop-heartbeat').disabled = false; }
});
$('heartbeat-read-all').addEventListener('click', () => attempt(() => window.bot.readHeartbeat({})));
for (const tab of ['tools', 'skills', 'servers', 'plugins']) {
  $('extensions-tab-' + tab).addEventListener('click', () => selectExtensionTab(tab));
  $('extensions-tab-' + tab).addEventListener('keydown', (event) => {
    const tabs = ['tools', 'skills', 'servers', 'plugins'];
    const index = tabs.indexOf(tab);
    let next;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs[tabs.length - 1];
    if (next) { event.preventDefault(); selectExtensionTab(next, true); }
  });
}
$('extensions-refresh').addEventListener('click', async () => {
  if (extensionsRefreshing) return;
  extensionsRefreshing = true;
  renderExtensions();
  try { await attempt(() => window.bot.refreshExtensions()); }
  finally { extensionsRefreshing = false; if (currentView === 'extensions') renderExtensions(); }
});
$('add-mcp-server').addEventListener('click', () => editMcpServer());
$('mcp-server-form').addEventListener('submit', saveMcpServer);
$('mcp-server-transport').addEventListener('change', renderMcpTransport);
$('add-skill').addEventListener('click', () => editSkill());
$('skill-form').addEventListener('submit', saveSkill);
$('import-skill').addEventListener('click', () => mutateExtension('import-skill', () => window.bot.importSkill(), 'Skill imported.'));
$('import-plugin').addEventListener('click', () => mutateExtension('import-plugin', () => window.bot.importPlugin(), 'Plugin imported and disabled. Review its contents before enabling it.'));
$('review-approval').addEventListener('click', () => openApproval(state?.approvals?.find((approval) => approval.chatId === selectedChatId)));
$('approval-form').addEventListener('submit', (event) => { event.preventDefault(); respondApproval('accept'); });
$('decline-approval').addEventListener('click', () => respondApproval('decline'));
$('confirm-accept').addEventListener('click', () => resolveConfirm(true));
$('confirm-cancel').addEventListener('click', () => resolveConfirm(false));
$('confirm-dialog').addEventListener('close', () => {
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(false);
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && currentView === 'profile' && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    saveProfile();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    if (!document.querySelector('dialog[open]')) selectChat(null);
  }
});

if (!window.bot) {
  $('chat-error').textContent = 'The local engine connection is unavailable. Start Little Bot using its desktop launcher.';
  $('chat-error').classList.remove('hidden');
  $('runtime-status').replaceChildren(element('span', 'status-dot error'), element('span', '', 'Desktop connection unavailable'));
} else {
  window.bot.onEvent((event) => {
    if (event.type === 'state') applyState(event.state);
    else if (event.type === 'chatUpdate') applyChatUpdate(event);
    else if (event.type === 'goalQuestion') {
      showFeature('goals');
      const card = Array.from($('goals-list').children).find(node => node.dataset.goalId === event.goalId);
      card?.scrollIntoView({ block: 'nearest' });
      card?.querySelector('.goal-question-answer')?.focus({ preventScroll: true });
    }
    else if (event.type === 'memory' && event.message) notify(event.message, Boolean(event.error));
    else if (event.type === 'heartbeat') { inboxFilter = 'all'; inboxSource = 'all'; showFeature('inbox'); }
    else if (event.type === 'login') {
      loginMetadata = event;
      if (event.error || event.status === 'error' || event.status === 'cancelled' || event.status === 'complete' || event.status === 'success') loginPending = false;
      renderConnection();
    }
  });
  window.bot.getState().then(applyState).catch((error) => {
    notify(error?.message || String(error), true);
    $('chat-error').textContent = 'Little Bot could not load its local state. Close and reopen the app to try again.';
    $('chat-error').classList.remove('hidden');
  });
}
