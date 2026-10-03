'use strict';

window.LittleBotWidget = (() => {
  const widget = window.bot?.windowMode === 'widget';
  const $ = id => document.getElementById(id);
  let api, display = { mode: 'full', collapsed: false, pinned: true }, pending = null, switching = false;
  if (widget) document.documentElement.classList.add('widget-mode');
  function closeMenu() { $('widget-menu').hidden = true; $('widget-more').setAttribute('aria-expanded', 'false'); }

  function applyDisplay(event) {
    display = event.display || display;
    document.documentElement.classList.toggle('widget-collapsed', widget && display.collapsed);
    $('widget-pin')?.setAttribute('aria-pressed', String(display.pinned));
    if ($('widget-pin')) $('widget-pin').title = display.pinned ? 'Unpin from other windows' : 'Keep above other windows';
    if (event.target === (widget ? 'widget' : 'full') && (event.draft || event.view)) pending = event;
    consume();
  }
  function consume() {
    if (!api?.state() || !pending) return;
    const event = pending; pending = null;
    api.showView(event.view || 'chat');
    if (event.draft) api.importDraft(event.draft);
    if (widget && !display.collapsed) requestAnimationFrame(() => $('message-input').focus());
  }
  async function change(mode, view = 'chat') {
    if (!api || switching) return;
    if (api.busy()) { api.notify('Finish your open dialog, adding files, or sending your message before switching views.'); return; }
    switching = true;
    closeMenu();
    try { applyDisplay({ display: await window.bot.setDisplayMode({ mode, view, draft: api.exportDraft() }) }); }
    catch (error) { api.notify(error.message || String(error), true); }
    finally { switching = false; }
  }
  async function controls(value) {
    try { applyDisplay({ display: await window.bot.setWidgetState(value) }); return true; }
    catch (error) { api.notify(error.message || String(error), true); return false; }
  }
  function render(state) {
    consume();
    if (!state || !widget) return;
    const chat = state.chats?.[0];
    const waiting = chat?.status === 'waiting' || state.approvals?.length;
    const working = chat?.status === 'running' || chat?.compaction?.status === 'running';
    const offline = state.account?.status !== 'connected';
    const broken = state.runtime?.status === 'error';
    const label = waiting ? 'Needs your input' : chat?.compaction?.status === 'running' ? 'Summarizing…' : working ? 'Working…'
      : broken ? 'Needs attention' : offline ? 'Offline' : state.runtime?.status !== 'ready' ? 'Starting…' : (state.connection?.type || state.settings?.connection) === 'local' ? 'Local' : 'Connected';
    $('widget-status').textContent = label;
    $('widget-pill-status').textContent = waiting || working || offline || broken ? label : 'Ready';
    for (const dot of document.querySelectorAll('.widget-status-dot')) {
      dot.classList.toggle('working', working); dot.classList.toggle('attention', Boolean(waiting || broken || offline));
    }
    $('widget-pill-stop').hidden = !working && !waiting;
    $('widget-compact').disabled = $('compact-chat').disabled;
    $('widget-pill-expand').title = waiting ? 'Expand to answer Little Bot' : 'Expand conversation';
  }
  function init(callbacks) {
    api = callbacks;
    if (widget) for (const option of $('effort-select').options) option.textContent = option.value.charAt(0).toUpperCase() + option.value.slice(1);
    $('enter-widget').addEventListener('click', () => change('widget'));
    $('widget-full').addEventListener('click', () => change('full'));
    $('widget-collapse').addEventListener('click', () => controls({ collapsed: true }));
    $('widget-pin').addEventListener('click', () => controls({ pinned: !display.pinned }));
    $('widget-pill-expand').addEventListener('click', () => controls({ collapsed: false }));
    $('widget-pill-stop').addEventListener('click', () => $('stop-button').click());
    $('widget-pill-attach').addEventListener('click', async () => { if (await controls({ collapsed: false })) $('attach-button').click(); });
    $('widget-more').addEventListener('click', () => { $('widget-menu').hidden = !$('widget-menu').hidden; $('widget-more').setAttribute('aria-expanded', String(!$('widget-menu').hidden)); });
    document.querySelectorAll('[data-widget-view]').forEach(button => button.addEventListener('click', () => change('full', button.dataset.widgetView)));
    $('widget-compact').addEventListener('click', () => { closeMenu(); $('compact-chat').click(); });
    document.addEventListener('click', event => { if (!event.target.closest('.widget-menu-wrap')) closeMenu(); });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault(); void change(widget ? 'full' : 'widget');
      } else if (widget && event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        if (!$('widget-menu').hidden) closeMenu();
        else if (!display.collapsed) void controls({ collapsed: true });
      }
    });
    window.bot?.getDisplayState?.().then(value => applyDisplay({ display: value })).catch(error => api.notify(error.message, true));
    consume();
  }
  return { init, render, applyDisplay, widget, openFull: view => change('full', view),
    isActive: () => display.mode === (widget ? 'widget' : 'full'),
    expand: () => display.mode === 'widget' && display.collapsed ? controls({ collapsed: false }) : Promise.resolve(true) };
})();
