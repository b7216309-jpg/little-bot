'use strict';

// The Usage page: tokens Little Bot processed and generated on this PC, per day, source, hour and model.
// Charts are plain SVG built as DOM nodes; every value is also available as a table.
window.LittleBotUsage = (() => {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  let range = 30, data = null, loading = false, lastFetch = 0, error = '', visible = () => false;
  try { const saved = localStorage.getItem('little-bot.usage-range'); if (saved !== null && [7, 30, 90, 0].includes(Number(saved))) range = Number(saved); } catch { /* Optional preference. */ }

  const compact = value => {
    const n = Number(value) || 0;
    if (n < 1000) return String(Math.round(n));
    const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    const [size, unit] = units.find(([limit]) => n >= limit);
    const scaled = n / size;
    return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, '')}${unit}`;
  };
  const full = value => Math.round(Number(value) || 0).toLocaleString();
  const percent = (part, whole) => whole ? `${Math.round(part / whole * 100)}%` : '—';
  const rate = value => value ? `${value >= 100 ? Math.round(value) : value.toFixed(1)} tok/s` : '—';
  const dateLabel = (day, options = { day: 'numeric', month: 'short' }) => {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year, month - 1, date).toLocaleDateString(undefined, options);
  };
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svg(tag, attributes = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  // A clean axis maximum: 1, 2 or 5 times a power of ten, at or above the value.
  function niceMax(value) {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    return [1, 2, 2.5, 5, 10].map(step => step * power).find(step => step >= value);
  }
  // A column whose top corners are rounded (the data end) and whose base is square.
  function column(x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height));
    return svg('path', { d: `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z` });
  }

  function tooltip(host) {
    let tip = host.querySelector('.usage-tooltip');
    if (!tip) { tip = el('div', 'usage-tooltip'); tip.setAttribute('role', 'status'); host.append(tip); }
    return tip;
  }
  function showTip(host, x, lines) {
    const tip = tooltip(host);
    tip.replaceChildren(...lines.map(([label, value, group]) => {
      const row = el('div', 'usage-tip-row');
      if (group) row.append(el('span', `usage-swatch series-${group}`));
      row.append(el('span', 'usage-tip-label', label));
      if (value !== undefined) row.append(el('strong', '', value));
      return row;
    }));
    tip.classList.add('visible');
    const width = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(x - width / 2, host.clientWidth - width - 4))}px`;
  }
  function hideTip(host) { host.querySelector('.usage-tooltip')?.classList.remove('visible'); }

  // Generated tokens per day, stacked by group, with a hover readout per day.
  function dailyChart(host, summary) {
    host.replaceChildren();
    const days = summary.days;
    const width = Math.max(320, host.clientWidth || 800), height = 230;
    const margin = { top: 18, right: 8, bottom: 26, left: 46 };
    const plotW = width - margin.left - margin.right, plotH = height - margin.top - margin.bottom;
    const max = niceMax(Math.max(...days.map(day => day.output)));
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'usage-svg', role: 'img',
      'aria-label': `Generated tokens per day, ${dateLabel(summary.first)} to ${dateLabel(summary.today)}. Total ${full(summary.totals.output)}.` });
    for (const tick of [0, 0.5, 1]) {
      const y = margin.top + plotH - tick * plotH;
      chart.append(svg('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: 'usage-grid' }));
      const label = svg('text', { x: margin.left - 8, y: y + 3.5, class: 'usage-axis', 'text-anchor': 'end' });
      label.textContent = compact(max * tick);
      chart.append(label);
    }
    const slot = plotW / days.length, barW = Math.max(2, Math.min(24, slot * 0.68));
    const every = Math.max(1, Math.ceil(days.length / (plotW < 500 ? 4 : 7)));
    const peak = days.reduce((top, day, index) => day.output > (days[top]?.output || 0) ? index : top, -1);
    days.forEach((day, index) => {
      const x = margin.left + slot * index + (slot - barW) / 2;
      let base = margin.top + plotH;
      const segments = summary.groups.filter(group => day.groups[group.id] > 0);
      segments.forEach((group, position) => {
        const fullHeight = day.groups[group.id] / max * plotH;
        const top = position === segments.length - 1;
        // A 2px surface gap separates stacked segments; the topmost carries the rounded data end.
        const heightPx = Math.max(1, fullHeight - (position ? 2 : 0));
        const y = base - (position ? 2 : 0) - heightPx;
        const mark = top ? column(x, y, barW, heightPx, 4) : svg('rect', { x, y, width: barW, height: heightPx });
        mark.setAttribute('class', `usage-mark series-${group.id}`);
        chart.append(mark);
        base = y;
      });
      if (index === peak && day.output > 0) {
        const label = svg('text', { x: x + barW / 2, y: Math.max(11, base - 5), class: 'usage-value', 'text-anchor': 'middle' });
        label.textContent = compact(day.output);
        chart.append(label);
      }
      if (index % every === 0 || index === days.length - 1) {
        const label = svg('text', { x: x + barW / 2, y: height - 8, class: 'usage-axis', 'text-anchor': 'middle' });
        label.textContent = days.length <= 7 ? dateLabel(day.day, { weekday: 'short' }) : dateLabel(day.day);
        if (index === days.length - 1 || index + every < days.length) chart.append(label);
      }
      const hit = svg('rect', { x: margin.left + slot * index, y: margin.top, width: slot, height: plotH, class: 'usage-hit' });
      hit.addEventListener('mouseenter', () => {
        hit.classList.add('active');
        showTip(host, margin.left + slot * index + slot / 2, [
          [dateLabel(day.day, { weekday: 'short', day: 'numeric', month: 'short' })],
          ['Generated', full(day.output)],
          ...summary.groups.filter(group => day.groups[group.id] > 0).map(group => [group.label, full(day.groups[group.id]), group.id]),
          ['Processed', full(day.input)], ['From cache', percent(day.cached, day.input)], ['Requests', full(day.requests)],
        ]);
      });
      hit.addEventListener('mouseleave', () => { hit.classList.remove('active'); hideTip(host); });
      chart.append(hit);
    });
    host.append(chart);
  }

  // Generated tokens by hour of day: one series, so no legend; the title names it.
  function hoursChart(host, summary) {
    host.replaceChildren();
    const width = Math.max(280, host.clientWidth || 400), height = 150;
    const margin = { top: 14, right: 6, bottom: 22, left: 40 };
    const plotW = width - margin.left - margin.right, plotH = height - margin.top - margin.bottom;
    const max = niceMax(Math.max(...summary.hours));
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'usage-svg', role: 'img', 'aria-label': 'Generated tokens by hour of day' });
    for (const tick of [0, 1]) {
      const y = margin.top + plotH - tick * plotH;
      chart.append(svg('line', { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: 'usage-grid' }));
      const label = svg('text', { x: margin.left - 7, y: y + 3.5, class: 'usage-axis', 'text-anchor': 'end' });
      label.textContent = compact(max * tick);
      chart.append(label);
    }
    const slot = plotW / 24, barW = Math.max(2, Math.min(24, slot * 0.66));
    summary.hours.forEach((value, hour) => {
      const x = margin.left + slot * hour + (slot - barW) / 2;
      if (value > 0) {
        const heightPx = Math.max(1, value / max * plotH);
        const mark = column(x, margin.top + plotH - heightPx, barW, heightPx, 3);
        mark.setAttribute('class', 'usage-mark series-chats');
        chart.append(mark);
      }
      if (hour % 6 === 0) {
        const label = svg('text', { x: x + barW / 2, y: height - 6, class: 'usage-axis', 'text-anchor': 'middle' });
        label.textContent = `${String(hour).padStart(2, '0')}h`;
        chart.append(label);
      }
      const hit = svg('rect', { x: margin.left + slot * hour, y: margin.top, width: slot, height: plotH, class: 'usage-hit' });
      hit.addEventListener('mouseenter', () => { hit.classList.add('active'); showTip(host, margin.left + slot * hour + slot / 2, [[`${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`], ['Generated', full(value)]]); });
      hit.addEventListener('mouseleave', () => { hit.classList.remove('active'); hideTip(host); });
      chart.append(hit);
    });
    host.append(chart);
  }

  function table(columns, rows) {
    const node = el('table', 'usage-table');
    const head = el('tr');
    for (const [label, numeric] of columns) head.append(el('th', numeric ? 'numeric' : '', label));
    node.append(el('thead'));
    node.tHead.append(head);
    const body = el('tbody');
    for (const row of rows) {
      const line = el('tr');
      row.forEach((cell, index) => {
        const td = el('td', columns[index][1] ? 'numeric' : '');
        if (cell instanceof Node) td.append(cell); else td.textContent = cell;
        line.append(td);
      });
      body.append(line);
    }
    node.append(body);
    return node;
  }
  function sourceName(source) {
    const name = el('span', 'usage-source');
    name.append(el('span', `usage-swatch series-${source.group}`), el('span', '', source.label));
    return name;
  }
  function share(value, total) {
    const bar = el('span', 'usage-share');
    const fill = el('span', 'usage-share-fill');
    fill.style.width = `${total ? Math.max(1, value / total * 100) : 0}%`;
    bar.append(fill);
    bar.title = percent(value, total);
    return bar;
  }

  function tile(label, value, detail = '', hero = false) {
    const node = el('div', hero ? 'usage-tile hero' : 'usage-tile');
    node.append(el('span', 'usage-tile-label', label), el('strong', 'usage-tile-value', value));
    if (detail) node.append(el('span', 'usage-tile-detail', detail));
    return node;
  }

  function render() {
    if (!visible()) return;
    for (const button of document.querySelectorAll('[data-usage-range]')) button.setAttribute('aria-pressed', String(Number(button.dataset.usageRange) === range));
    $('usage-error').textContent = error;
    $('usage-error').classList.toggle('hidden', !error);
    if (!data) { $('usage-status').textContent = loading ? 'Loading…' : ''; return; }
    const summary = data;
    const totals = summary.totals;
    const span = range ? `last ${range} days` : 'since counting started';
    $('usage-status').textContent = loading ? 'Updating…' : '';
    const empty = !summary.lifetime.requests;
    $('usage-empty').classList.toggle('hidden', !empty);
    $('usage-body').classList.toggle('hidden', empty);
    if (empty) return;
    $('usage-tiles').replaceChildren(
      tile('Generated', full(totals.output), `tokens written, ${span}`, true),
      tile('Processed', compact(totals.input), 'prompt tokens read'),
      tile('From cache', percent(totals.cached, totals.input), `${compact(totals.cached)} reused by Strata`),
      tile('Requests', full(totals.requests), 'model calls'),
      tile('Generation', rate(summary.generation?.tokensPerSecond), 'average speed'),
      tile('Days active', `${summary.activeDays}`, summary.streak ? `${summary.streak}-day streak` : 'no streak right now'),
    );
    $('usage-legend').replaceChildren(...summary.groups.map(group => {
      const item = el('span', 'usage-legend-item');
      item.append(el('span', `usage-swatch series-${group.id}`), el('span', '', group.label));
      return item;
    }));
    dailyChart($('usage-chart'), summary);
    $('usage-day-table').replaceChildren(table([['Day'], ['Generated', true], ['Processed', true], ['From cache', true], ['Requests', true]],
      [...summary.days].reverse().filter(day => day.requests).map(day => [dateLabel(day.day, { weekday: 'short', day: 'numeric', month: 'short' }), full(day.output), full(day.input), percent(day.cached, day.input), full(day.requests)])));
    $('usage-sources').replaceChildren(summary.sources.length ? table([['Source'], ['Generated', true], ['Share'], ['Processed', true], ['From cache', true], ['Requests', true]],
      summary.sources.map(source => [sourceName(source), full(source.output), share(source.output, totals.output), compact(source.input), percent(source.cached, source.input), full(source.requests)]))
      : el('p', 'field-hint', 'Nothing in this range.'));
    hoursChart($('usage-hours'), summary);
    $('usage-models').replaceChildren(summary.models.length ? table([['Model'], ['Generated', true], ['Processed', true], ['Requests', true]],
      summary.models.map(model => [model.id, full(model.output), compact(model.input), full(model.requests)])) : el('p', 'field-hint', 'Nothing in this range.'));
    const since = summary.since ? new Date(summary.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    $('usage-footnote').textContent = `Counted on this PC from Strata's own numbers as each request finishes${since ? `, since ${since}` : ''}: ${full(summary.lifetime.output)} generated and ${full(summary.lifetime.input)} processed in all.${summary.prefill ? ` Prompt reading averages ${rate(summary.prefill.tokensPerSecond)}.` : ''}${summary.best ? ` Busiest day: ${dateLabel(summary.best.day, { day: 'numeric', month: 'long' })} (${compact(summary.best.output)}).` : ''}`;
  }

  // A range picked while another one is loading is loaded right after it, and only the latest range's
  // numbers are shown.
  let again = false;
  async function load(force = false) {
    if (loading) { again ||= force; return; }
    if (!force && Date.now() - lastFetch < 5000) return;
    loading = true; render();
    const asked = range;
    try { const result = await window.bot.usageSummary({ days: asked }); if (asked === range) { data = result; error = ''; } }
    catch (failure) { if (asked === range) error = failure?.message || String(failure); }
    finally {
      loading = false; lastFetch = Date.now();
      if (again || asked !== range) { again = false; void load(true); } else render();
    }
  }

  function init({ isVisible }) {
    visible = isVisible;
    for (const button of document.querySelectorAll('[data-usage-range]')) button.addEventListener('click', () => {
      range = Number(button.dataset.usageRange);
      try { localStorage.setItem('little-bot.usage-range', String(range)); } catch { /* Optional preference. */ }
      void load(true);
    });
    let resizeTimer = null;
    new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (data) render(); }, 120); }).observe($('usage-chart'));
  }

  return { init, open: () => load(true), refresh: () => load(false) };
})();
