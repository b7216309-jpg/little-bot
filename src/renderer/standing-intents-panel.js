'use strict';

(() => {
  const ui = window.LittleBotStandingIntents;
  if (!window.bot || !ui) return;

  let state = null;
  let editingId = null;
  let mounted = false;
  let saving = false;

  const byId = id => document.getElementById(id);
  const node = (tag, className = '', text = '') => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text) value.textContent = text;
    return value;
  };
  const button = (label, className, handler) => {
    const value = node('button', className, label);
    value.type = 'button';
    value.addEventListener('click', handler);
    return value;
  };
  const option = (value, label) => {
    const item = node('option', '', label);
    item.value = value;
    return item;
  };
  const field = (label, control, hint = '') => {
    const wrapper = node('label', 'standing-intent-field');
    wrapper.append(node('span', 'field-label', label), control);
    if (hint) wrapper.append(node('span', 'field-hint', hint));
    return wrapper;
  };
  const formatDate = value => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet';

  function createPanel() {
    const section = node('section', 'standing-intents-section');
    section.id = 'standing-intents-section';
    const heading = node('div', 'standing-intents-heading');
    const copy = node('div');
    copy.append(node('h2', '', 'Standing intents'), node('p', '', 'React to events while Little Bot is open.'));
    const create = button('New standing intent', 'button secondary', () => editIntent());
    create.id = 'create-standing-intent';
    heading.append(copy, create);
    const notice = node('div', 'standing-intents-notice');
    notice.append(node('strong', '', 'Foreground only.'), document.createTextNode(' Events are not collected while the app is closed, and missed work is not replayed.'));
    const status = node('p', 'standing-intents-runtime');
    status.id = 'standing-intents-runtime';
    const list = node('div', 'standing-intents-list');
    list.id = 'standing-intents-list';
    section.append(heading, notice, status, list);
    return section;
  }

  function createDialog() {
    const dialog = node('dialog', 'dialog standing-intent-dialog');
    dialog.id = 'standing-intent-dialog';
    const form = node('form');
    form.id = 'standing-intent-form';
    form.noValidate = true;
    const header = node('div', 'dialog-header');
    const title = node('h2', '');
    title.id = 'standing-intent-title';
    const close = button('×', 'icon-button standing-intent-close', () => dialog.close());
    close.setAttribute('aria-label', 'Close standing-intent editor');
    header.append(title, close);

    const name = node('input');
    name.id = 'standing-intent-name';
    name.maxLength = 80;
    name.required = true;
    name.placeholder = 'Prepare notes before a meeting';

    const eventType = node('select');
    eventType.id = 'standing-intent-event';
    for (const [value, label] of ui.EVENTS) eventType.append(option(value, label));

    const source = node('input');
    source.id = 'standing-intent-source';
    source.maxLength = 120;
    source.placeholder = 'Optional, for example calendar';

    const filterGrid = node('div', 'standing-intent-filter-grid');
    const filterPath = node('input');
    filterPath.id = 'standing-intent-filter-path';
    filterPath.maxLength = 200;
    filterPath.placeholder = 'Optional, for example path or horizonMinutes';
    const filterOperator = node('select');
    filterOperator.id = 'standing-intent-filter-operator';
    for (const [value, label] of ui.OPERATORS) filterOperator.append(option(value, label));
    const filterValue = node('input');
    filterValue.id = 'standing-intent-filter-value';
    filterValue.maxLength = 500;
    filterValue.placeholder = 'Value or wildcard pattern';
    filterGrid.append(field('Payload field', filterPath), field('Match', filterOperator), field('Value', filterValue));

    const actionGrid = node('div', 'standing-intent-action-grid');
    const actionType = node('select');
    actionType.id = 'standing-intent-action';
    actionType.append(option('goal.run', 'Run an authorized goal'), option('automation.run', 'Run an authorized automation'));
    const target = node('select');
    target.id = 'standing-intent-target';
    target.required = true;
    actionGrid.append(field('Action', actionType), field('Target', target));

    const optionsGrid = node('div', 'standing-intent-options-grid');
    const debounce = node('input');
    debounce.id = 'standing-intent-debounce';
    debounce.type = 'number';
    debounce.min = '0';
    debounce.max = '3600';
    debounce.value = '30';
    const priority = node('input');
    priority.id = 'standing-intent-priority';
    priority.type = 'number';
    priority.min = '-10';
    priority.max = '10';
    priority.value = '0';
    optionsGrid.append(field('Debounce · seconds', debounce), field('Priority · -10 to 10', priority));

    const enabledLabel = node('label', 'checkbox-label standing-intent-enabled');
    const enabled = node('input');
    enabled.id = 'standing-intent-enabled';
    enabled.type = 'checkbox';
    enabled.checked = true;
    enabledLabel.append(enabled, node('span', '', 'Enable this standing intent'));

    const error = node('p', 'inline-error hidden');
    error.id = 'standing-intent-error';
    error.setAttribute('role', 'alert');
    const footer = node('div', 'dialog-footer');
    footer.append(button('Cancel', 'button secondary', () => dialog.close()));
    const save = node('button', 'button primary', 'Create standing intent');
    save.id = 'save-standing-intent';
    save.type = 'submit';
    footer.append(save);

    form.append(header,
      field('Name', name),
      field('When this event happens', eventType, 'Events exist only during the current foreground app session.'),
      field('Event source · optional', source),
      node('p', 'field-label standing-intent-subheading', 'Optional deterministic condition'), filterGrid,
      node('p', 'field-label standing-intent-subheading', 'Then'), actionGrid,
      optionsGrid, enabledLabel, error, footer);
    dialog.append(form);
    document.body.append(dialog);

    actionType.addEventListener('change', populateTargets);
    filterOperator.addEventListener('change', renderFilterValue);
    form.addEventListener('submit', saveIntent);
    dialog.addEventListener('close', () => { editingId = null; error.classList.add('hidden'); error.textContent = ''; });
    return dialog;
  }

  function populateTargets(selected = '') {
    const select = byId('standing-intent-target');
    if (!select || !state) return;
    const actionType = byId('standing-intent-action').value;
    const records = actionType === 'goal.run' ? state.autonomy?.goals || [] : state.automations || [];
    select.replaceChildren(option('', records.length ? 'Choose a target' : 'No targets available'));
    for (const record of records) {
      const suffix = record.authorized === true ? '' : ' · run once first';
      select.append(option(record.id, `${record.name || record.id}${suffix}`));
    }
    if (selected && !records.some(record => record.id === selected)) select.append(option(selected, `Missing target · ${selected}`));
    select.value = selected;
  }

  function renderFilterValue() {
    const exists = byId('standing-intent-filter-operator')?.value === 'exists';
    const input = byId('standing-intent-filter-value');
    if (!input) return;
    input.placeholder = exists ? 'true or false' : 'Value or wildcard pattern';
  }

  function editIntent(intent = null) {
    editingId = intent?.id || null;
    byId('standing-intent-title').textContent = intent ? 'Edit standing intent' : 'New standing intent';
    byId('standing-intent-name').value = intent?.name || '';
    byId('standing-intent-event').value = intent?.when?.type || 'file.changed';
    byId('standing-intent-source').value = intent?.when?.source || '';
    const filter = intent?.when?.filters?.[0] || null;
    byId('standing-intent-filter-path').value = filter?.path?.replace(/^payload\./, '') || '';
    byId('standing-intent-filter-operator').value = filter?.operator || 'equals';
    byId('standing-intent-filter-value').value = filter ? String(filter.value) : '';
    byId('standing-intent-action').value = intent?.action?.type || 'goal.run';
    const targetId = intent?.action?.goalId || intent?.action?.automationId || '';
    populateTargets(targetId);
    byId('standing-intent-debounce').value = String(Math.round((intent?.debounceMs || 30000) / 1000));
    byId('standing-intent-priority').value = String(intent?.priority || 0);
    byId('standing-intent-enabled').checked = intent ? intent.enabled === true : true;
    byId('save-standing-intent').textContent = intent ? 'Save changes' : 'Create standing intent';
    renderFilterValue();
    byId('standing-intent-dialog').showModal();
    byId('standing-intent-name').focus();
  }

  async function saveIntent(event) {
    event.preventDefault();
    if (saving) return;
    const form = byId('standing-intent-form');
    if (!form.reportValidity()) return;
    const error = byId('standing-intent-error');
    const payload = ui.buildIntent({
      id: editingId,
      name: byId('standing-intent-name').value,
      enabled: byId('standing-intent-enabled').checked,
      eventType: byId('standing-intent-event').value,
      source: byId('standing-intent-source').value,
      filterPath: byId('standing-intent-filter-path').value,
      filterOperator: byId('standing-intent-filter-operator').value,
      filterValue: byId('standing-intent-filter-value').value,
      actionType: byId('standing-intent-action').value,
      targetId: byId('standing-intent-target').value,
      priority: byId('standing-intent-priority').value,
      debounceSeconds: byId('standing-intent-debounce').value,
    });
    saving = true;
    byId('save-standing-intent').disabled = true;
    error.classList.add('hidden');
    try {
      state = await window.bot.saveStandingIntent(payload);
      byId('standing-intent-dialog').close();
      render();
    } catch (failure) {
      error.textContent = failure?.message || String(failure);
      error.classList.remove('hidden');
    } finally {
      saving = false;
      byId('save-standing-intent').disabled = false;
    }
  }

  async function removeIntent(intent) {
    if (!window.confirm(`Delete “${intent.name}”?`)) return;
    try {
      state = await window.bot.deleteStandingIntent({ id: intent.id });
      render();
    } catch (failure) {
      window.alert(failure?.message || String(failure));
    }
  }

  async function toggleIntent(intent, input) {
    input.disabled = true;
    try {
      state = await window.bot.toggleStandingIntent({ id: intent.id, enabled: input.checked });
      render();
    } catch (failure) {
      input.checked = intent.enabled === true;
      window.alert(failure?.message || String(failure));
    } finally {
      input.disabled = false;
    }
  }

  function renderCard(intent) {
    const summary = ui.describe(intent, state);
    const card = node('article', 'standing-intent-card');
    const top = node('div', 'standing-intent-card-top');
    const copy = node('div', 'standing-intent-card-copy');
    copy.append(node('h3', '', intent.name), node('p', '', `${summary.event} · ${summary.condition}`));
    const toggle = node('label', 'switch');
    const input = node('input');
    input.type = 'checkbox';
    input.checked = intent.enabled === true;
    input.setAttribute('aria-label', `Enable ${intent.name}`);
    input.addEventListener('change', () => toggleIntent(intent, input));
    toggle.append(input, node('span', 'switch-track'));
    top.append(copy, toggle);

    const action = node('p', 'standing-intent-action', summary.action);
    const meta = node('div', 'standing-intent-meta');
    meta.append(node('span', '', `Status: ${summary.status}`), node('span', '', `Triggered: ${intent.triggerCount || 0}`),
      node('span', '', `Last: ${formatDate(intent.lastTriggeredAt)}`));
    if (intent.lastError) meta.append(node('span', 'standing-intent-error-text', intent.lastError));
    const controls = node('div', 'standing-intent-card-actions');
    controls.append(button('Edit', 'button text-button', () => editIntent(intent)), button('Delete', 'button text-button danger-text', () => removeIntent(intent)));
    card.append(top, action, meta, controls);
    return card;
  }

  function render() {
    if (!mounted || !state) return;
    const runtime = state.eventRuntime || {};
    byId('standing-intents-runtime').textContent = runtime.status === 'running'
      ? `${runtime.enabledStandingIntentCount || 0} enabled · ${runtime.bus?.queued || 0} event${runtime.bus?.queued === 1 ? '' : 's'} queued`
      : 'Event processing is stopped.';
    const intents = state.standingIntents?.intents || [];
    const list = byId('standing-intents-list');
    if (!intents.length) {
      const empty = node('div', 'standing-intents-empty');
      empty.append(node('h3', '', 'No standing intents yet'), node('p', '', 'Connect an in-app event to an existing authorized goal or automation.'));
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...intents.map(renderCard));
  }

  function mount() {
    if (mounted) return;
    const view = byId('automations-view');
    const list = byId('automations-list');
    if (!view || !list) return;
    list.insertAdjacentElement('afterend', createPanel());
    createDialog();
    mounted = true;
    window.bot.onEvent(event => {
      if (event?.type === 'state' && event.state) { state = event.state; render(); }
    });
    window.bot.getState().then(next => { state = next; render(); }).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
