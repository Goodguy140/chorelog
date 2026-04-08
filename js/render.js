import { render, setRenderRenderer } from './render-registry.js';
import { app, PALETTE } from './state.js';
import { getMonthKey, getMonthLabel, nextDueDate } from './utils/date.js';
import { escapeAttr, escapeHtml } from './utils/html.js';
import { entryChorePoints, presetById, presetMatchingScheduledTitle, renderQuickChores } from './presets.js';
import { intervalLabel, scheduledStatus } from './scheduled-logic.js';

function colorFor(name) {
  const i = app.people.indexOf(name);
  if (i === -1) return { bar: '#888', text: '#fff' };
  return PALETTE[i % PALETTE.length];
}

function entryMatchesAnalyticsFilters(e) {
  if (app.analyticsPersonFilter && e.p !== app.analyticsPersonFilter) return false;
  if (app.analyticsLocationFilter) {
    const ids = Array.isArray(e.locationIds) ? e.locationIds : [];
    if (!ids.includes(app.analyticsLocationFilter)) return false;
  }
  return true;
}

/** Entries in `monthKey` that pass analytics person/location filters. */
function entriesForAnalyticsMonth(monthKey) {
  return app.entries.filter((e) => getMonthKey(e.d) === monthKey && entryMatchesAnalyticsFilters(e));
}

function taskCountsByDay(monthKey) {
  const map = {};
  for (const e of entriesForAnalyticsMonth(monthKey)) {
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
  for (const e of entriesForAnalyticsMonth(monthKey)) {
    if (c[e.p] !== undefined) c[e.p]++;
  }
  return c;
}

/** Sum of preset points per person for the month (entries without a preset contribute 0). */
function pointsByPerson(monthKey) {
  const c = {};
  app.people.forEach((p) => {
    c[p] = 0;
  });
  for (const e of entriesForAnalyticsMonth(monthKey)) {
    if (c[e.p] === undefined) continue;
    const pts = entryChorePoints(e);
    if (pts != null) c[e.p] += pts;
  }
  return c;
}

/** Whitespace-separated tokens; entry must match all (case-insensitive). Matches date, chore text, person, locations, points. */
function entryMatchesLogSearch(e, rawQ) {
  const q = rawQ.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const loc = Array.isArray(e.locationIds) ? e.locationIds.join(' ') : '';
  const pts = entryChorePoints(e);
  const hay = [e.d, e.c || '', e.p || '', loc, pts != null ? String(pts) : ''].join(' ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/**
 * 100% = totals split evenly across everyone; 0% = one person has 100% of the total.
 * Uses (1 − maxShare) / (1 − 1/n) with maxShare = largest person's share.
 * Works for task counts or point totals per person.
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

  if (app.analyticsPersonFilter && !app.people.includes(app.analyticsPersonFilter)) {
    app.analyticsPersonFilter = '';
  }
  if (app.analyticsLocationFilter && !app.locations.includes(app.analyticsLocationFilter)) {
    app.analyticsLocationFilter = '';
  }

  const personFilterEl = document.getElementById('analyticsPersonFilter');
  if (personFilterEl) {
    personFilterEl.innerHTML = `<option value="">All people</option>${app.people
      .map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`)
      .join('')}`;
    personFilterEl.value = app.analyticsPersonFilter;
    if (personFilterEl.value !== app.analyticsPersonFilter) app.analyticsPersonFilter = personFilterEl.value;
  }
  const locationFilterEl = document.getElementById('analyticsLocationFilter');
  if (locationFilterEl) {
    locationFilterEl.innerHTML = `<option value="">All locations</option>${app.locations
      .map((loc) => `<option value="${escapeAttr(loc)}">${escapeHtml(loc)}</option>`)
      .join('')}`;
    locationFilterEl.value = app.analyticsLocationFilter;
    if (locationFilterEl.value !== app.analyticsLocationFilter) {
      app.analyticsLocationFilter = locationFilterEl.value;
    }
  }

  const filterHintEl = document.getElementById('analyticsFilterHint');
  if (filterHintEl) {
    const parts = [];
    if (app.analyticsPersonFilter) {
      parts.push(`Person: ${escapeHtml(app.analyticsPersonFilter)}`);
    }
    if (app.analyticsLocationFilter) {
      parts.push(`Location: ${escapeHtml(app.analyticsLocationFilter)}`);
    }
    if (parts.length) {
      filterHintEl.hidden = false;
      filterHintEl.textContent = `Showing analytics for ${parts.join(' · ')}.`;
    } else {
      filterHintEl.hidden = true;
      filterHintEl.textContent = '';
    }
  }

  const monthSelect = document.getElementById('monthSelect');
  monthSelect.innerHTML = monthOptions
    .map((m) => `<option value="${m}">${getMonthLabel(m)}</option>`)
    .join('');
  if (monthOptions.includes(app.currentMonth)) monthSelect.value = app.currentMonth;
  else if (monthOptions.length) monthSelect.value = monthOptions[0];

  const cur = countsByPerson(app.currentMonth);
  const curPts = pointsByPerson(app.currentMonth);
  const total = Object.values(cur).reduce((a, b) => a + b, 0);
  const totalPts = Object.values(curPts).reduce((a, b) => a + b, 0);
  const topPerson = app.people.reduce((a, b) => (cur[a] >= cur[b] ? a : b));
  const topPersonPts = app.people.reduce((a, b) => (curPts[a] >= curPts[b] ? a : b));
  const activeDays = new Set(entriesForAnalyticsMonth(app.currentMonth).map((e) => e.d)).size;
  const balance = balanceScorePercent(cur, app.people);
  const balanceVal = balance.empty ? '—' : `${balance.pct}<span class="stat-unit">%</span>`;
  const balanceSub = balance.empty ? 'log tasks to score' : '100% = fully balanced';
  const balancePts = balanceScorePercent(curPts, app.people);
  const balancePtsVal = balancePts.empty ? '—' : `${balancePts.pct}<span class="stat-unit">%</span>`;
  const balancePtsSub = balancePts.empty ? 'log preset chores to score' : '100% = fully balanced';
  const avgPtsPerTask =
    total > 0 ? Math.round((totalPts / total) * 10) / 10 : null;

  document.getElementById('statsGrid').innerHTML = `
<div class="stat-card"><p class="stat-label">Total tasks</p><p class="stat-val">${total}</p><p class="stat-sub">${getMonthLabel(app.currentMonth)}</p></div>
<div class="stat-card"><p class="stat-label">Most active</p><p class="stat-val" style="font-size:15px;">${topPerson}</p><p class="stat-sub">${cur[topPerson]} tasks</p></div>
<div class="stat-card"><p class="stat-label">Active days</p><p class="stat-val">${activeDays}</p><p class="stat-sub">days with chores</p></div>
<div class="stat-card"><p class="stat-label">Members</p><p class="stat-val">${app.people.filter((p) => cur[p] > 0).length}</p><p class="stat-sub">contributed</p></div>
<div class="stat-card stat-card--balance" title="By task count: 100% = everyone did the same share; 0% = one person logged every task."><p class="stat-label">Balance</p><p class="stat-val">${balanceVal}</p><p class="stat-sub">${balanceSub}</p></div>
  `;

  document.getElementById('statsGridPoints').innerHTML = `
<div class="stat-card"><p class="stat-label">Total points</p><p class="stat-val">${totalPts}</p><p class="stat-sub">${getMonthLabel(app.currentMonth)} · preset weights</p></div>
<div class="stat-card"><p class="stat-label">Top earner</p><p class="stat-val" style="font-size:15px;">${topPersonPts}</p><p class="stat-sub">${curPts[topPersonPts]} pts</p></div>
<div class="stat-card"><p class="stat-label">Avg pts / task</p><p class="stat-val">${avgPtsPerTask == null ? '—' : avgPtsPerTask}</p><p class="stat-sub">${total === 0 ? 'no tasks this month' : 'mean over all logged tasks'}</p></div>
<div class="stat-card"><p class="stat-label">Members</p><p class="stat-val">${app.people.filter((p) => curPts[p] > 0).length}</p><p class="stat-sub">earned preset points</p></div>
<div class="stat-card stat-card--balance" title="By points: 100% = everyone earned the same share; 0% = one person earned every point."><p class="stat-label">Balance</p><p class="stat-val">${balancePtsVal}</p><p class="stat-sub">${balancePtsSub}</p></div>
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

  const maxPts = Math.max(...Object.values(curPts), 1);
  const sortedPts = [...app.people].sort((a, b) => curPts[b] - curPts[a]);
  document.getElementById('barsAreaPoints').innerHTML = sortedPts
    .map((p) => {
      const pct = Math.round((curPts[p] / maxPts) * 100);
      const col = colorFor(p);
      return `<div class="person-row">
  <div class="person-row-top">
    <span class="person-label">${p}</span>
    <span class="count-num">${curPts[p]}</span>
  </div>
  <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${col.bar};color:${col.text};">${curPts[p] > 2 ? `${curPts[p]} pts` : ''}</div></div>
</div>`;
    })
    .join('');

  document.getElementById('taskHeatmap').innerHTML = renderTaskHeatmap(app.currentMonth);

  document.getElementById('logMonthLabel').textContent = getMonthLabel(app.currentMonth);
  const monthEntries = app.entries
    .filter((e) => getMonthKey(e.d) === app.currentMonth)
    .sort((a, b) => b.d.localeCompare(a.d));
  const filteredLogEntries = monthEntries.filter((e) => entryMatchesLogSearch(e, app.logSearchQuery));
  const logList = document.getElementById('logList');
  const logSearchEl = document.getElementById('logSearch');
  if (logSearchEl) logSearchEl.value = app.logSearchQuery;
  if (!monthEntries.length) {
    logList.innerHTML = '<p class="empty">No entries yet this month.</p>';
  } else if (!filteredLogEntries.length) {
    logList.innerHTML = '<p class="empty">No entries match your search.</p>';
  } else {
    logList.innerHTML = filteredLogEntries
      .map((e) => {
        const col = colorFor(e.p);
        const [, m, d] = e.d.split('-');
        const safeId = String(e.id).replace(/'/g, "\\'");
        const pts = entryChorePoints(e);
        const pr = e.choreId ? presetById(e.choreId) : null;
        const barStyle = pr ? `border-left:4px solid ${escapeAttr(pr.color)};padding-left:8px` : '';
        const ptsHtml = pts != null ? `<span class="log-chore-points">+${pts} pts</span>` : '';
        const locHtml = Array.isArray(e.locationIds) && e.locationIds.length
          ? `<span class="log-chore-points">${escapeHtml(e.locationIds.join(', '))}</span>`
          : '';
        return `<div class="log-item" data-entry-id="${escapeHtml(e.id)}">
    <div class="log-item-main" style="${barStyle}">
      <span class="log-date">${m}/${d}</span>
      <span class="log-chore">${escapeHtml(e.c)}</span>
      ${ptsHtml}
      ${locHtml}
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
  const prevPts = prevMonth ? pointsByPerson(prevMonth) : null;
  const momGrid = document.getElementById('momGrid');
  const momGridPoints = document.getElementById('momGridPoints');
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
    momGridPoints.innerHTML = app.people
      .map((p) => {
        const diff = curPts[p] - prevPts[p];
        const pct = prevPts[p] > 0 ? Math.round((Math.abs(diff) / prevPts[p]) * 100) : null;
        const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
        const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '';
        const label =
          pct !== null
            ? `${arrow} ${pct}% vs ${getMonthLabel(prevMonth)}`
            : diff === 0
              ? 'No change'
              : 'New data';
        return `<div><p class="mom-name">${p}</p><p class="mom-val">${prevPts[p]} → ${curPts[p]}</p><p class="mom-delta ${cls}" style="font-size:12px;margin-top:3px;">${label}</p></div>`;
      })
      .join('');
  } else {
    const emptyMom =
      '<p style="font-size:13px;color:var(--color-text-tertiary);grid-column:1/-1;">No previous month to compare.</p>';
    momGrid.innerHTML = emptyMom;
    momGridPoints.innerHTML = emptyMom;
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
    <div class="scheduled-card-meta">${intervalLabel(s.intervalDays)} · Next due: ${st.nextHuman}</div>
  </div>
  <span class="scheduled-status ${st.cls}">${st.label}</span>
  <div class="scheduled-card-actions">
    <button type="button" class="scheduled-btn-done" onclick="markScheduledDone('${safeId}')">Mark done</button>
  </div>
</div>`;
      })
      .join('');
  }

  const schedSuggestBox = document.getElementById('scheduledLogSuggestions');
  const schedSuggestWrap = document.getElementById('scheduledLogSuggestionsWrap');
  if (schedSuggestBox && schedSuggestWrap) {
    const urgent = app.scheduledChores
      .map((s) => {
        const st = scheduledStatus(s);
        const preset = presetMatchingScheduledTitle(s.title);
        return { s, st, preset };
      })
      .filter(
        ({ st, preset }) =>
          preset && (st.cls === 'overdue' || st.cls === 'today' || st.cls === 'soon'),
      )
      .sort((a, b) => nextDueDate(a.s).localeCompare(nextDueDate(b.s)));
    if (!urgent.length) {
      schedSuggestWrap.hidden = true;
      schedSuggestBox.innerHTML = '';
    } else {
      schedSuggestWrap.hidden = false;
      schedSuggestBox.innerHTML = urgent
        .map(({ s, st, preset }) => {
          const tip = `${s.title} — ${st.label}`;
          return `<button type="button" class="scheduled-suggest-btn scheduled-suggest-btn--${st.cls}" data-preset-id="${escapeAttr(preset.id)}" title="${escapeAttr(tip)}">
  <span class="scheduled-suggest-title">${escapeHtml(s.title)}</span>
  <span class="scheduled-suggest-meta">${escapeHtml(st.label)}</span>
</button>`;
        })
        .join('');
    }
  }

  renderQuickChores();
}

setRenderRenderer(fullRender);

export function switchMonth(m) {
  app.currentMonth = m;
  app.logSearchQuery = '';
  render();
}
