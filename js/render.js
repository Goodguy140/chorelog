import { render, setRenderRenderer } from './render-registry.js';
import { app, PALETTE } from './state.js';
import { getMonthKey, getMonthLabel } from './utils/date.js';
import { escapeAttr, escapeHtml } from './utils/html.js';
import { entryChorePoints, presetById, renderQuickChores } from './presets.js';
import { intervalLabel, scheduledStatus } from './scheduled-logic.js';

function colorFor(name) {
  const i = app.people.indexOf(name);
  if (i === -1) return { bar: '#888', text: '#fff' };
  return PALETTE[i % PALETTE.length];
}

function taskCountsByDay(monthKey) {
  const map = {};
  for (const e of app.entries) {
    if (getMonthKey(e.d) !== monthKey) continue;
    map[e.d] = (map[e.d] || 0) + 1;
  }
  return map;
}

/** Intensity 0 = none; 1–4 scaled vs busiest day in this month. */
function heatIntensity(n, max) {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * n) / max)));
}

function renderTaskHeatmap(monthKey) {
  const map = taskCountsByDay(monthKey);
  const vals = Object.values(map);
  const max = vals.length ? Math.max(...vals) : 0;
  const [y, mo] = monthKey.split('-').map(Number);
  const dim = new Date(y, mo, 0).getDate();
  const firstDow = new Date(y, mo - 1, 1).getDay();
  const wdLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const parts = [];
  parts.push('<div class="heatmap-inner">');
  parts.push('<div class="heatmap-weekdays">');
  wdLabels.forEach((w) => {
    parts.push(`<span class="heatmap-wd">${w}</span>`);
  });
  parts.push('</div><div class="heatmap-grid">');
  for (let i = 0; i < firstDow; i++) {
    parts.push('<span class="heatmap-cell heatmap-pad"></span>');
  }
  for (let day = 1; day <= dim; day++) {
    const mm = String(mo).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${y}-${mm}-${dd}`;
    const n = map[dateStr] || 0;
    const lev = heatIntensity(n, max);
    const label = n === 0 ? `${dateStr}: no tasks` : `${dateStr}: ${n} task${n === 1 ? '' : 's'}`;
    parts.push(`<span class="heatmap-cell heat-${lev}" role="img" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`);
  }
  const used = firstDow + dim;
  const trailing = (7 - (used % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    parts.push('<span class="heatmap-cell heatmap-pad"></span>');
  }
  parts.push('</div>');
  parts.push('<div class="heatmap-footer"><span class="heatmap-scale">');
  parts.push('<span>Less</span>');
  for (let h = 0; h <= 4; h++) {
    parts.push(`<span class="heatmap-cell heat-${h}" aria-hidden="true"></span>`);
  }
  parts.push('<span>More</span></span>');
  if (max > 0) {
    parts.push(`<span>Busiest day: ${max} task${max === 1 ? '' : 's'}</span>`);
  }
  parts.push('</div></div>');
  return parts.join('');
}

function getMonths() {
  return [...new Set(app.entries.map((e) => getMonthKey(e.d)))].sort().reverse();
}

function countsByPerson(monthKey) {
  const c = {};
  app.people.forEach((p) => {
    c[p] = 0;
  });
  app.entries.filter((e) => getMonthKey(e.d) === monthKey).forEach((e) => {
    if (c[e.p] !== undefined) c[e.p]++;
  });
  return c;
}

/**
 * 100% = tasks split evenly across everyone; 0% = one person did all tasks this month.
 * Uses (1 − maxShare) / (1 − 1/n) with maxShare = largest person's count / total.
 */
function balanceScorePercent(cur, peopleList) {
  const n = peopleList.length;
  if (n <= 1) return { pct: 100, empty: false };
  let total = 0;
  let maxCount = 0;
  for (const p of peopleList) {
    const c = cur[p] || 0;
    total += c;
    if (c > maxCount) maxCount = c;
  }
  if (total === 0) return { pct: null, empty: true };
  const maxShare = maxCount / total;
  const score = ((1 - maxShare) / (1 - 1 / n)) * 100;
  return { pct: Math.max(0, Math.min(100, Math.round(score))), empty: false };
}

function fullRender() {
  const errEl = document.getElementById('loadError');
  if (app.loadError) {
    errEl.textContent = app.loadError;
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }

  const months = getMonths();
  if (!months.includes(app.currentMonth) && months.length) app.currentMonth = months[0];
  const monthOptions = months.length ? months : [app.currentMonth];

  const monthSelect = document.getElementById('monthSelect');
  monthSelect.innerHTML = monthOptions
    .map((m) => `<option value="${m}">${getMonthLabel(m)}</option>`)
    .join('');
  if (monthOptions.includes(app.currentMonth)) monthSelect.value = app.currentMonth;
  else if (monthOptions.length) monthSelect.value = monthOptions[0];

  const cur = countsByPerson(app.currentMonth);
  const total = Object.values(cur).reduce((a, b) => a + b, 0);
  const topPerson = app.people.reduce((a, b) => (cur[a] >= cur[b] ? a : b));
  const activeDays = new Set(
    app.entries.filter((e) => getMonthKey(e.d) === app.currentMonth).map((e) => e.d),
  ).size;
  const balance = balanceScorePercent(cur, app.people);
  const balanceVal = balance.empty ? '—' : `${balance.pct}<span class="stat-unit">%</span>`;
  const balanceSub = balance.empty ? 'log tasks to score' : '100% = fully balanced';

  document.getElementById('statsGrid').innerHTML = `
<div class="stat-card"><p class="stat-label">Total tasks</p><p class="stat-val">${total}</p><p class="stat-sub">${getMonthLabel(app.currentMonth)}</p></div>
<div class="stat-card"><p class="stat-label">Most active</p><p class="stat-val" style="font-size:15px;">${topPerson}</p><p class="stat-sub">${cur[topPerson]} tasks</p></div>
<div class="stat-card"><p class="stat-label">Active days</p><p class="stat-val">${activeDays}</p><p class="stat-sub">days with chores</p></div>
<div class="stat-card"><p class="stat-label">Members</p><p class="stat-val">${app.people.filter((p) => cur[p] > 0).length}</p><p class="stat-sub">contributed</p></div>
<div class="stat-card stat-card--balance" title="100% = fully balanced (same share for everyone); 0% = one person did everything."><p class="stat-label">Balance</p><p class="stat-val">${balanceVal}</p><p class="stat-sub">${balanceSub}</p></div>
  `;

  const max = Math.max(...Object.values(cur), 1);
  const sorted = [...app.people].sort((a, b) => cur[b] - cur[a]);
  document.getElementById('barsArea').innerHTML = sorted
    .map((p) => {
      const pct = Math.round((cur[p] / max) * 100);
      const col = colorFor(p);
      return `<div class="person-row">
  <div class="person-row-top">
    <span class="person-label">${p}</span>
    <span class="count-num">${cur[p]}</span>
  </div>
  <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${col.bar};color:${col.text};">${cur[p] > 2 ? `${cur[p]} tasks` : ''}</div></div>
</div>`;
    })
    .join('');

  document.getElementById('taskHeatmap').innerHTML = renderTaskHeatmap(app.currentMonth);

  document.getElementById('logMonthLabel').textContent = getMonthLabel(app.currentMonth);
  const monthEntries = app.entries
    .filter((e) => getMonthKey(e.d) === app.currentMonth)
    .sort((a, b) => b.d.localeCompare(a.d));
  const logList = document.getElementById('logList');
  if (!monthEntries.length) {
    logList.innerHTML = '<p class="empty">No entries yet this month.</p>';
  } else {
    logList.innerHTML = monthEntries
      .map((e) => {
        const col = colorFor(e.p);
        const [, m, d] = e.d.split('-');
        const safeId = String(e.id).replace(/'/g, "\\'");
        const pts = entryChorePoints(e);
        const pr = e.choreId ? presetById(e.choreId) : null;
        const barStyle = pr ? `border-left:4px solid ${escapeAttr(pr.color)};padding-left:8px` : '';
        const ptsHtml = pts != null ? `<span class="log-chore-points">+${pts} pts</span>` : '';
        return `<div class="log-item" data-entry-id="${escapeHtml(e.id)}">
    <div class="log-item-main" style="${barStyle}">
      <span class="log-date">${m}/${d}</span>
      <span class="log-chore">${escapeHtml(e.c)}</span>
      ${ptsHtml}
    </div>
    <span class="log-person" style="background:${col.bar};color:${col.text};">${escapeHtml(e.p)}</span>
    <span class="log-item-actions">
      <button type="button" class="btn-edit" onclick="openEditEntry('${safeId}')" aria-label="Edit entry">Edit</button>
      <button type="button" class="btn-del" onclick="delEntry('${safeId}')" aria-label="Delete entry">×</button>
    </span>
  </div>`;
      })
      .join('');
  }

  const allMonths = getMonths();
  const prevMonth = allMonths[allMonths.indexOf(app.currentMonth) + 1];
  const prev = prevMonth ? countsByPerson(prevMonth) : null;
  const momGrid = document.getElementById('momGrid');
  if (prev) {
    momGrid.innerHTML = app.people
      .map((p) => {
        const diff = cur[p] - prev[p];
        const pct = prev[p] > 0 ? Math.round((Math.abs(diff) / prev[p]) * 100) : null;
        const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '';
        const label =
          pct !== null
            ? `${arrow} ${pct}% vs ${getMonthLabel(prevMonth)}`
            : diff === 0
              ? 'No change'
              : 'New data';
        return `<div><p class="mom-name">${p}</p><p class="mom-val">${prev[p]} → ${cur[p]}</p><p class="mom-delta ${cls}" style="font-size:12px;margin-top:3px;">${label}</p></div>`;
      })
      .join('');
  } else {
    momGrid.innerHTML =
      '<p style="font-size:13px;color:var(--color-text-tertiary);grid-column:1/-1;">No previous month to compare.</p>';
  }

  const section = document.getElementById('scheduledSection');
  const dash = document.getElementById('scheduledDashboard');
  if (!app.scheduledChores.length) {
    section.style.display = 'none';
  } else {
    section.style.display = 'block';
    dash.innerHTML = app.scheduledChores
      .map((s) => {
        const st = scheduledStatus(s);
        const safeId = String(s.id).replace(/'/g, "\\'");
        return `<div class="scheduled-card">
  <div>
    <div class="scheduled-card-title">${escapeHtml(s.title)}</div>
    <div class="scheduled-card-meta">${intervalLabel(s.intervalDays)} · Next due: ${st.next}</div>
  </div>
  <span class="scheduled-status ${st.cls}">${st.label}</span>
  <div class="scheduled-card-actions">
    <button type="button" class="scheduled-btn-done" onclick="markScheduledDone('${safeId}')">Mark done</button>
  </div>
</div>`;
      })
      .join('');
  }

  renderQuickChores();
}

setRenderRenderer(fullRender);

export function switchMonth(m) {
  app.currentMonth = m;
  render();
}
