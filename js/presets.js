import { apiFetch } from './api-fetch.js';
import { t } from './i18n.js';
import { app } from './state.js';
import { escapeAttr, escapeHtml } from './utils/html.js';
import { render } from './render-registry.js';

export function isPresetActive(p) {
  return Boolean(p && !p.deletedAt);
}

export function entryIsActive(e) {
  return Boolean(e && !e.deletedAt);
}

export function activeChorePresets() {
  return app.chorePresets.filter(isPresetActive);
}

export function syncChoreDatalists() {
  const opts = activeChorePresets()
    .map((p) => `<option value="${escapeAttr(p.title)}"></option>`)
    .join('');
  const dl = document.getElementById('editChoreDatalist');
  if (dl) dl.innerHTML = opts;
}

export function presetById(id) {
  return app.chorePresets.find((p) => p.id === id);
}

/** Levenshtein distance; titles are short (≤120). */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
    }
  }
  return dp[m][n];
}

/**
 * Match scheduled chore title to a preset for log suggestions.
 * Exact case-insensitive match first; otherwise best fuzzy match within a small edit budget
 * (handles e.g. "Wipe common surfaces" vs preset "Wiped common surfaces").
 */
export function presetMatchingScheduledTitle(scheduledTitle) {
  const t = String(scheduledTitle).trim().toLowerCase();
  if (!t) return null;
  const exact = activeChorePresets().find((p) => p.title.trim().toLowerCase() === t);
  if (exact) return exact;
  if (t.length < 4) return null;

  const maxDist = Math.min(4, Math.max(2, Math.ceil(t.length * 0.12)));
  let best = null;
  let bestD = Infinity;
  for (const p of activeChorePresets()) {
    const pl = p.title.trim().toLowerCase();
    if (!pl) continue;
    const d = levenshtein(t, pl);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best && bestD <= maxDist) return best;
  return null;
}

export function entryChorePoints(e) {
  if (!e || !e.choreId) return null;
  const pr = presetById(e.choreId);
  if (!pr) return null;
  if (pr.scoringMode === 'per_location') {
    const n = Array.isArray(e.locationIds) ? e.locationIds.length : 0;
    return pr.points * n;
  }
  return pr.points;
}

/**
 * Resolve one chore field segment to an active preset: exact case-insensitive match,
 * then Levenshtein fuzzy match (same budget as scheduled suggestions) when segment length ≥ 4.
 */
export function matchActivePresetForSegment(part) {
  const trimmed = String(part || '').trim();
  if (!trimmed) return null;
  const t = trimmed.toLowerCase();
  const exact = activeChorePresets().find((p) => p.title.trim().toLowerCase() === t);
  if (exact) return exact;
  if (trimmed.length < 4) return null;

  const maxDist = Math.min(4, Math.max(2, Math.ceil(trimmed.length * 0.12)));
  let best = null;
  let bestD = Infinity;
  for (const p of activeChorePresets()) {
    const pl = p.title.trim().toLowerCase();
    if (!pl) continue;
    const d = levenshtein(t, pl);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best && bestD <= maxDist) return best;
  return null;
}

export function resolveChorePayloadRows(raw) {
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, reason: 'empty' };
  const rows = [];
  for (const part of parts) {
    const preset = matchActivePresetForSegment(part);
    if (!preset) {
      return { ok: false, reason: 'unknown', unknownPart: part };
    }
    rows.push({ choreId: preset.id });
  }
  return { ok: true, rows };
}

export async function saveChorePresetsAndQuick() {
  try {
    const r = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chorePresets: app.chorePresets, quickChoreIds: app.quickChoreIds }),
    });
    if (!r.ok) throw new Error('save failed');
    const data = await r.json();
    if (Array.isArray(data.chorePresets)) app.chorePresets = data.chorePresets;
    if (Array.isArray(data.quickChoreIds)) app.quickChoreIds = data.quickChoreIds;
    syncChoreDatalists();
    renderQuickChores();
    renderChorePresetsEditor();
    renderQuickChoresEditor();
    render();
  } catch {
    app.loadError = t('errors.savePresets');
    render();
  }
}

export function readChorePresetsFromDom() {
  const rows = document.querySelectorAll('#chorePresetsList .chore-preset-row');
  const out = [];
  const activeIds = new Set();
  rows.forEach((row) => {
    const id = row.getAttribute('data-id');
    const title = row.querySelector('.chore-preset-title')?.value?.trim() || '';
    let points = Number(row.querySelector('.chore-preset-points')?.value);
    const color = row.querySelector('.chore-preset-color')?.value || '#378ADD';
    const scoringMode = row.querySelector('.chore-preset-scoring')?.value === 'per_location' ? 'per_location' : 'flat';
    if (!id || !title) return;
    if (!Number.isFinite(points)) points = 1;
    activeIds.add(id);
    out.push({ id, title, points, color, scoringMode });
  });
  for (const p of app.chorePresets) {
    if (p.deletedAt && !activeIds.has(p.id)) {
      out.push({ ...p });
    }
  }
  return out;
}

export function renderChorePresetsEditor() {
  const ul = document.getElementById('chorePresetsList');
  const archivedUl = document.getElementById('chorePresetsArchivedList');
  const archivedWrap = document.getElementById('chorePresetsArchivedWrap');
  if (!ul) return;
  const active = activeChorePresets();
  const archived = app.chorePresets.filter((p) => p.deletedAt);
  const canRemoveActive = active.length > 1;
  ul.innerHTML = active
    .map(
      (p) => `
    <li class="chore-preset-row" data-id="${escapeAttr(p.id)}">
      <input type="text" class="chore-preset-title" value="${escapeAttr(p.title)}" maxlength="120" aria-label="${escapeAttr(t('presets.titleAria'))}">
      <input type="number" class="chore-preset-points" value="${Number(p.points)}" min="0" max="10000" step="1" aria-label="${escapeAttr(t('presets.pointsAria'))}">
      <select class="chore-preset-scoring" aria-label="${escapeAttr(t('presets.pointsModeAria'))}">
        <option value="flat" ${p.scoringMode === 'per_location' ? '' : 'selected'}>${escapeHtml(t('presets.flat'))}</option>
        <option value="per_location" ${p.scoringMode === 'per_location' ? 'selected' : ''}>${escapeHtml(t('presets.perLocation'))}</option>
      </select>
      <input type="color" class="chore-preset-color" value="${escapeAttr(p.color)}" aria-label="${escapeAttr(t('presets.colorAria'))}">
      <button type="button" class="btn-secondary chore-preset-remove" data-remove="${escapeAttr(p.id)}" ${!canRemoveActive ? 'disabled' : ''}>${escapeHtml(t('settings.remove'))}</button>
    </li>`,
    )
    .join('');
  if (archivedUl && archivedWrap) {
    archivedWrap.hidden = archived.length === 0;
    archivedUl.innerHTML = archived
      .map(
        (p) => `<li class="chore-preset-archived-row">
  <span class="chore-preset-archived-title" style="border-left:4px solid ${escapeAttr(p.color)}">${escapeHtml(p.title)}</span>
  <button type="button" class="btn-secondary chore-preset-restore" data-restore="${escapeAttr(p.id)}">${escapeHtml(t('presets.restore'))}</button>
</li>`,
      )
      .join('');
  }
}

export function renderQuickChoresEditor() {
  const ul = document.getElementById('quickChoresList');
  const sel = document.getElementById('quickChorePresetSelect');
  if (!ul) return;
  ul.innerHTML = app.quickChoreIds
    .map((id, idx) => {
      const p = presetById(id);
      if (!p) return '';
      return `<li class="quick-chore-editor-row" data-qid="${escapeAttr(id)}">
  <span class="quick-chore-editor-title" style="border-left:4px solid ${escapeAttr(p.color)}">${escapeHtml(p.title)}</span>
  <span class="quick-chore-editor-actions">
    <button type="button" class="btn-secondary btn-quick-move" data-dir="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="${escapeAttr(t('presets.moveUpAria'))}">↑</button>
    <button type="button" class="btn-secondary btn-quick-move" data-dir="down" data-idx="${idx}" ${idx === app.quickChoreIds.length - 1 ? 'disabled' : ''} aria-label="${escapeAttr(t('presets.moveDownAria'))}">↓</button>
    <button type="button" class="btn-secondary btn-quick-remove" data-remove="${escapeAttr(id)}">${escapeHtml(t('settings.remove'))}</button>
  </span>
</li>`;
    })
    .join('');
  if (sel) {
    const inQuick = new Set(app.quickChoreIds);
    sel.innerHTML = activeChorePresets()
      .filter((p) => !inQuick.has(p.id))
      .map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.title)}</option>`)
      .join('');
    if (!sel.innerHTML) {
      sel.innerHTML = `<option value="">${escapeHtml(t('settings.quickBarAll'))}</option>`;
    }
  }
}

export function renderQuickChores() {
  const wrap = document.getElementById('quickChoreButtons');
  if (!wrap) return;
  const section = wrap.closest('.quick-chores');
  const hasQuick = app.quickChoreIds.some((id) => {
    const pr = presetById(id);
    return pr && isPresetActive(pr);
  });
  if (section) section.hidden = !hasQuick;
  wrap.innerHTML = app.quickChoreIds
    .map((id) => {
      const preset = presetById(id);
      if (!preset || !isPresetActive(preset)) return '';
      const safe = escapeHtml(preset.title);
      const col = escapeAttr(preset.color);
      return `<button type="button" class="quick-chore-btn" data-chore-id="${escapeAttr(preset.id)}" style="border-color:${col};background:color-mix(in srgb, ${col} 20%, transparent)" title="${escapeAttr(t('logForm.quickTitle', { name: preset.title }))}">${safe}</button>`;
    })
    .join('');
}
