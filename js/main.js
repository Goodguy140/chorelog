import { apiFetch } from './api-fetch.js';
import { applyStaticDom, getLocale, getLocaleBcp47, setLocale, subscribeLocale, t } from './i18n.js';
import { render } from './render-registry.js';
import { switchMonth } from './render.js';
import {
  entryIsActive,
  isPresetActive,
  matchActivePresetForSegment,
  presetById,
  readChorePresetsFromDom,
  renderChorePresetsEditor,
  renderQuickChores,
  renderQuickChoresEditor,
  resolveChorePayloadRows,
  saveChorePresetsAndQuick,
  syncChoreDatalists,
} from './presets.js';
import { app, DEFAULT_LOCATIONS, DEFAULT_PEOPLE } from './state.js';
import { getMonthKey, localDateISO, thisCalendarMonthKey } from './utils/date.js';
import { escapeAttr, escapeHtml } from './utils/html.js';
import { intervalLabel, scheduledStatus } from './scheduled-logic.js';
import { initChoreInputSuggest } from './chore-input-suggest.js';
import {
  disableBrowserPush,
  enableBrowserPush,
  refreshPushNotificationsPanel,
  testBrowserPush,
} from './push-notifications.js';
import {
  administrationTabVisible,
  initAdministrationPanel,
  loadAdministrationPanel,
  syncAdministrationNavVisibility,
} from './administration.js';

async function loadAppVersion() {
  try {
    const r = await fetch('/api/version', { credentials: 'same-origin' });
    if (!r.ok) return;
    const data = await r.json();
    const v = data && typeof data.version === 'string' ? data.version.trim() : '';
    if (!v) return;
    const label = t('version', { v });
    const settingsEl = document.getElementById('settingsAppVersion');
    const footerEl = document.getElementById('footerAppVersion');
    const footerWrap = document.getElementById('footerAppVersionWrap');
    if (settingsEl) {
      settingsEl.textContent = label;
      settingsEl.hidden = false;
    }
    if (footerEl) footerEl.textContent = label;
    if (footerWrap) footerWrap.hidden = false;
  } catch {
    /* ignore */
  }
}

function formatSessionExpiry(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(getLocaleBcp47(), { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function blockReadOnlyAction() {
  if (!app.readOnly) return false;
  app.loadError = t('errors.readOnlyAction');
  render();
  return true;
}

async function loadAccountInfo() {
  try {
    const r = await apiFetch('/api/account');
    if (!r.ok) {
      app.account = null;
      app.readOnly = false;
      return;
    }
    app.account = await r.json();
    app.readOnly = !!app.account.readOnly;
  } catch {
    app.account = null;
    app.readOnly = false;
  }
}

async function loadAccountPanel() {
  const dl = document.getElementById('accountSessionDl');
  const errEl = document.getElementById('accountSessionError');
  const nameInput = document.getElementById('accountDisplayNameInput');
  const createBlock = document.getElementById('accountCreateBlock');
  const masterWrap = document.getElementById('accountMasterPasswordWrap');
  const createHint = document.getElementById('accountCreateHint');
  if (!dl) return;
  errEl.hidden = true;
  errEl.textContent = '';
  try {
    const r = await apiFetch('/api/account');
    if (!r.ok) throw new Error('unauthorized');
    const d = await r.json();
    app.account = d;
    dl.innerHTML = [
      [t('settings.accountHouseholdLabel'), d.household],
      [t('settings.accountUserLabel'), d.user],
      [t('settings.accountSessionExpires'), formatSessionExpiry(d.sessionExpiresAt)],
    ]
      .map(([label, val]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(val))}</dd>`)
      .join('');
    if (nameInput) nameInput.value = d.user;
    const canCreate = d.canCreateHouseholds || d.openRegistration;
    if (createBlock) {
      createBlock.hidden = !canCreate;
      if (masterWrap) masterWrap.hidden = !!d.openRegistration;
      if (createHint) {
        if (d.openRegistration && !d.canCreateHouseholds) {
          createHint.textContent = t('settings.accountCreateHintOpen');
        } else if (d.canCreateHouseholds && !d.openRegistration) {
          createHint.textContent = t('settings.accountCreateHintMaster');
        } else {
          createHint.textContent = t('settings.accountCreateHintBoth');
        }
      }
    }
  } catch {
    errEl.textContent = t('settings.accountLoadError');
    errEl.hidden = false;
    dl.innerHTML = '';
  }
}

async function loadAboutPanel() {
  const dl = document.getElementById('aboutInfoDl');
  const errEl = document.getElementById('aboutInfoError');
  if (!dl || !errEl) return;
  errEl.hidden = true;
  dl.innerHTML = '';
  try {
    const r = await apiFetch('/api/version');
    if (!r.ok) throw new Error('bad status');
    const d = await r.json();
    const rows = [];
    rows.push([t('settings.aboutAppVersion'), d.version != null ? String(d.version) : '—', false]);
    rows.push([t('settings.aboutNode'), d.nodeVersion != null ? String(d.nodeVersion) : '—', false]);
    const gb = d.gitHubBuild && typeof d.gitHubBuild === 'object' ? d.gitHubBuild : null;
    if (gb) {
      if (gb.repository) {
        const repoUrl = `https://github.com/${gb.repository}`;
        rows.push([
          t('settings.aboutGitHubRepo'),
          `<a href="${escapeAttr(repoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(gb.repository)}</a>`,
          true,
        ]);
      }
      if (gb.sha) {
        const short = String(gb.sha).slice(0, 7);
        const commitUrl = gb.repository
          ? `https://github.com/${gb.repository}/commit/${gb.sha}`
          : null;
        rows.push([
          t('settings.aboutGitHubCommit'),
          commitUrl
            ? `<a href="${escapeAttr(commitUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(short)}</a>`
            : escapeHtml(String(gb.sha)),
          true,
        ]);
      }
      if (gb.ref) {
        const shortRef = String(gb.ref).replace(/^refs\/(heads|tags)\//, '');
        rows.push([t('settings.aboutGitHubRef'), shortRef, false]);
      }
      if (gb.workflow) {
        rows.push([t('settings.aboutGitHubWorkflow'), String(gb.workflow), false]);
      }
      if (gb.runId) {
        const runUrl = gb.actionsRunUrl || (gb.repository ? `https://github.com/${gb.repository}/actions/runs/${gb.runId}` : null);
        const runLabel =
          gb.runNumber != null && String(gb.runNumber).trim() !== ''
            ? `#${String(gb.runNumber)}`
            : String(gb.runId);
        rows.push([
          t('settings.aboutGitHubRun'),
          runUrl
            ? `<a href="${escapeAttr(runUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(runLabel)}</a>`
            : escapeHtml(String(gb.runId)),
          true,
        ]);
      } else if (gb.actionsRunUrl) {
        rows.push([
          t('settings.aboutGitHubRun'),
          `<a href="${escapeAttr(gb.actionsRunUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('settings.aboutGitHubRunLink'))}</a>`,
          true,
        ]);
      }
    }
    if (d.household != null && String(d.household).trim()) {
      rows.push([t('settings.aboutHousehold'), String(d.household).trim(), false]);
    }
    if (d.persistence) {
      const persistLabel =
        d.persistence === 'sqlite' ? t('settings.aboutPersistenceSqlite') : t('settings.aboutPersistenceJson');
      rows.push([t('settings.aboutPersistence'), persistLabel, false]);
      rows.push([t('settings.aboutDbFile'), d.databaseRelativePath != null ? String(d.databaseRelativePath) : '—', false]);
      if (d.persistence === 'sqlite' && d.sqliteVersion) {
        rows.push([t('settings.aboutSqliteEngine'), String(d.sqliteVersion), false]);
        if (d.journalMode) {
          rows.push([t('settings.aboutJournalMode'), String(d.journalMode), false]);
        }
      }
    } else {
      rows.push([t('settings.aboutPersistence'), '—', false]);
      rows.push([t('settings.aboutDbFile'), '—', false]);
    }
    rows.push([
      t('settings.aboutExportSchema'),
      d.exportSchemaVersion != null ? String(d.exportSchemaVersion) : '—',
      false,
    ]);
    dl.innerHTML = rows
      .map(([label, val, rawHtml]) => {
        const dd = rawHtml ? val : escapeHtml(val);
        return `<dt>${escapeHtml(label)}</dt><dd>${dd}</dd>`;
      })
      .join('');
  } catch {
    errEl.textContent = t('settings.aboutLoadError');
    errEl.hidden = false;
  }
}

function syncThemeMeta() {
  const el = document.getElementById('metaThemeColor');
  if (!el) return;
  const mode = document.documentElement.getAttribute('data-theme');
  let dark = false;
  if (mode === 'dark') dark = true;
  else if (mode === 'light') dark = false;
  else dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  /* Match app chrome for PWA status / theme bars (iOS/Android). */
  el.content = dark ? '#1e1e1c' : '#f4f3ef';
}

function applyTheme(mode) {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') mode = 'system';
  localStorage.setItem('chorelog-theme', mode);
  document.documentElement.setAttribute('data-theme', mode);
  syncThemeMeta();
  document.querySelectorAll('#themeOptions input[name="theme"]').forEach((el) => {
    el.checked = el.value === mode;
  });
}

function syncPersonSelect() {
  const sel = document.getElementById('inPerson');
  const cur = sel.value;
  sel.innerHTML = '';
  app.people.forEach((p) => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function syncLocationSelect() {
  const sel = document.getElementById('inLocations');
  if (!sel) return;
  const selected = new Set([...sel.selectedOptions].map((o) => o.value));
  sel.innerHTML = '';
  app.locations.forEach((name) => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    if (selected.has(name)) o.selected = true;
    sel.appendChild(o);
  });
}

function choreInputNeedsLocations(raw) {
  const parts = String(raw || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.some((part) => {
    const preset = matchActivePresetForSegment(part);
    return Boolean(preset && preset.scoringMode === 'per_location');
  });
}

function syncLogLocationFieldVisibility() {
  const wrap = document.querySelector('.field-locations');
  const input = document.getElementById('inChore');
  const sel = document.getElementById('inLocations');
  if (!wrap || !input || !sel) return;
  const show = choreInputNeedsLocations(input.value);
  wrap.hidden = !show;
  if (!show) {
    [...sel.options].forEach((o) => {
      o.selected = false;
    });
  }
}

function renderPeopleEditor() {
  const ul = document.getElementById('peopleList');
  ul.innerHTML = app.people
    .map(
      (p, idx) => `
    <li>
      <span>${escapeHtml(p)}</span>
      <button type="button" data-remove="${idx}" ${app.people.length <= 1 ? 'disabled' : ''}>${escapeHtml(t('settings.remove'))}</button>
    </li>
  `,
    )
    .join('');
  ul.querySelectorAll('button[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removePersonAt(Number(btn.getAttribute('data-remove'))));
  });
}

function renderLocationsEditor() {
  const ul = document.getElementById('locationsList');
  if (!ul) return;
  ul.innerHTML = app.locations
    .map(
      (name, idx) => `
    <li>
      <span>${escapeHtml(name)}</span>
      <button type="button" data-remove-location="${idx}" ${app.locations.length <= 1 ? 'disabled' : ''}>${escapeHtml(t('settings.remove'))}</button>
    </li>
  `,
    )
    .join('');
  ul.querySelectorAll('button[data-remove-location]').forEach((btn) => {
    btn.addEventListener('click', () => removeLocationAt(Number(btn.getAttribute('data-remove-location'))));
  });
}

async function savePeopleList(next) {
  if (blockReadOnlyAction()) return;
  const r = await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ people: next }),
  });
  if (!r.ok) throw new Error('save failed');
  const data = await r.json();
  app.people = Array.isArray(data.people) ? data.people : next;
  if (Array.isArray(data.locations)) app.locations = data.locations;
  if (Array.isArray(data.chorePresets)) app.chorePresets = data.chorePresets;
  if (Array.isArray(data.quickChoreIds)) app.quickChoreIds = data.quickChoreIds;
  syncPersonSelect();
  syncLocationSelect();
  syncChoreDatalists();
  renderPeopleEditor();
  renderLocationsEditor();
  renderChorePresetsEditor();
  renderQuickChoresEditor();
  renderQuickChores();
  render();
}

async function saveLocationsList(next) {
  if (blockReadOnlyAction()) return;
  const r = await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: next }),
  });
  if (!r.ok) throw new Error('save failed');
  const data = await r.json();
  app.locations = Array.isArray(data.locations) ? data.locations : next;
  if (Array.isArray(data.chorePresets)) app.chorePresets = data.chorePresets;
  if (Array.isArray(data.quickChoreIds)) app.quickChoreIds = data.quickChoreIds;
  syncLocationSelect();
  if (app.pendingEditEntryId) {
    const ent = app.entries.find((x) => x.id === app.pendingEditEntryId);
    if (ent) fillEditEntryLocationSelect(ent.locationIds);
  }
  renderLocationsEditor();
  renderChorePresetsEditor();
  renderQuickChoresEditor();
  renderQuickChores();
  render();
}

async function addPerson() {
  const input = document.getElementById('newPersonName');
  const name = input.value.trim();
  if (!name) return;
  if (app.people.includes(name)) {
    input.value = '';
    return;
  }
  try {
    await savePeopleList([...app.people, name]);
    input.value = '';
  } catch (e) {
    app.loadError = t('errors.savePeople');
    render();
  }
}

async function removePersonAt(index) {
  if (app.people.length <= 1) return;
  const next = app.people.filter((_, i) => i !== index);
  try {
    await savePeopleList(next);
  } catch (e) {
    app.loadError = t('errors.savePeople');
    render();
  }
}

async function addLocation() {
  const input = document.getElementById('newLocationName');
  const name = input.value.trim();
  if (!name) return;
  if (app.locations.includes(name)) {
    input.value = '';
    return;
  }
  try {
    await saveLocationsList([...app.locations, name]);
    input.value = '';
  } catch {
    app.loadError = t('errors.saveLocations');
    render();
  }
}

async function removeLocationAt(index) {
  if (app.locations.length <= 1) return;
  const next = app.locations.filter((_, i) => i !== index);
  try {
    await saveLocationsList(next);
  } catch {
    app.loadError = t('errors.saveLocations');
    render();
  }
}

async function load() {
  app.loadError = null;
  try {
    await loadAccountInfo();
    /** Cookie from POST /api/login may not be attached to an immediate GET; retry once before session-expired UX. */
    let r = await apiFetch('/api/entries', { skipSessionRedirect: true });
    if (r.status === 401) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      r = await apiFetch('/api/entries');
    }
    if (r.status === 401) return;
    if (!r.ok) throw new Error('Bad response');
    const data = await r.json();
    app.entries = Array.isArray(data.entries) ? data.entries : [];
    app.people = Array.isArray(data.people) && data.people.length ? data.people : [...DEFAULT_PEOPLE];
    app.locations =
      Array.isArray(data.locations) && data.locations.length ? data.locations : [...DEFAULT_LOCATIONS];
    app.chorePresets = Array.isArray(data.chorePresets) ? data.chorePresets : [];
    app.quickChoreIds = Array.isArray(data.quickChoreIds) ? data.quickChoreIds : [];
    app.scheduledChores = Array.isArray(data.scheduledChores) ? data.scheduledChores : [];
    app.discordWebhook = data.discordWebhook || { ...app.discordWebhook };
    syncPersonSelect();
    syncLocationSelect();
    syncChoreDatalists();
    syncAdministrationNavVisibility();
    void refreshPushNotificationsPanel();
  } catch (e) {
    app.entries = [];
    app.people = [...DEFAULT_PEOPLE];
    app.locations = [...DEFAULT_LOCATIONS];
    app.chorePresets = [];
    app.quickChoreIds = [];
    app.scheduledChores = [];
    app.discordWebhook = {
      enabled: false,
      url: '',
      reminderIntervalMinutes: 1440,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      slackWebhookUrl: '',
      genericWebhookUrl: '',
      overdueNotifyWebhooks: true,
      overdueNotifyPush: true,
      dueTodayEnabled: false,
      dueTodayNotifyWebhooks: true,
      dueTodayNotifyPush: true,
    };
    syncPersonSelect();
    syncLocationSelect();
    syncChoreDatalists();
    app.loadError = t('errors.loadFailed');
  }
}

function clearAddToastTimer() {
  if (app.addToastHideTimer) {
    clearTimeout(app.addToastHideTimer);
    app.addToastHideTimer = null;
  }
}

function hideAddToast() {
  const el = document.getElementById('addToast');
  if (el) {
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
  }
  app.pendingUndoEntryIds = [];
}

function showAddToast(addedEntries) {
  if (!addedEntries.length) return;
  clearAddToastTimer();
  app.pendingUndoEntryIds = addedEntries.map((e) => e.id);
  const toast = document.getElementById('addToast');
  const msg = document.getElementById('addToastMsg');
  if (!toast || !msg) return;
  const n = addedEntries.length;
  msg.textContent = n === 1 ? t('toast.oneChore') : t('toast.nChores', { n });
  toast.hidden = false;
  toast.removeAttribute('aria-hidden');
  app.addToastHideTimer = setTimeout(() => {
    hideAddToast();
  }, 6500);
}

async function undoLastAdd() {
  if (blockReadOnlyAction()) return;
  const ids = app.pendingUndoEntryIds.slice();
  if (!ids.length) return;
  clearAddToastTimer();
  hideAddToast();
  try {
    await Promise.all(
      ids.map((id) =>
        apiFetch(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => {
          if (!r.ok && r.status !== 404) throw new Error();
        }),
      ),
    );
    await load();
    render();
  } catch (e) {
    app.loadError = t('errors.undo');
    render();
  }
}

async function addEntry() {
  if (blockReadOnlyAction()) return;
  const d = document.getElementById('inDate').value;
  const raw = document.getElementById('inChore').value.trim();
  const p = document.getElementById('inPerson').value;
  const selectedLocations = [...document.querySelectorAll('#inLocations option:checked')].map((o) => o.value);
  if (!d || !raw) return;
  const resolved = resolveChorePayloadRows(raw);
  if (!resolved.ok) {
    app.loadError =
      resolved.reason === 'empty'
        ? t('errors.choosePreset')
        : resolved.reason === 'unknown'
          ? t('errors.unknownChore', { name: resolved.unknownPart })
          : resolved.reason;
    render();
    return;
  }
  const rows = [];
  for (const row of resolved.rows) {
    const preset = presetById(row.choreId);
    if (preset && preset.scoringMode === 'per_location') {
      if (!selectedLocations.length) {
        app.loadError = t('errors.selectLocation', { title: preset.title });
        render();
        return;
      }
      rows.push({ d, p, choreId: row.choreId, locationIds: selectedLocations });
    } else {
      rows.push({ d, p, choreId: row.choreId, locationIds: [] });
    }
  }
  try {
    const r = await apiFetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: rows }),
    });
    if (!r.ok) throw new Error('save failed');
    const data = await r.json();
    const addedEntries = Array.isArray(data.entries) ? data.entries : [];
    await load();
    app.currentMonth = getMonthKey(d);
    document.getElementById('inChore').value = '';
    [...document.querySelectorAll('#inLocations option')].forEach((o) => {
      o.selected = false;
    });
    syncLogLocationFieldVisibility();
    render();
    showAddToast(addedEntries);
  } catch (e) {
    app.loadError = t('errors.saveChore');
    render();
  }
}

function fillChoreFromPreset(presetId) {
  const preset = presetById(presetId);
  if (!preset || !isPresetActive(preset)) return false;
  const el = document.getElementById('inChore');
  if (el) el.value = preset.title;
  syncLogLocationFieldVisibility();
  if (preset.scoringMode === 'per_location') {
    const sel = document.getElementById('inLocations');
    if (sel && [...sel.selectedOptions].length === 0) {
      [...sel.options].forEach((o) => {
        o.selected = true;
      });
    }
  }
  return true;
}

async function quickLogChore(presetId) {
  if (!fillChoreFromPreset(presetId)) return;
  await addEntry();
}

function initQuickChores() {
  const wrap = document.getElementById('quickChoreButtons');
  if (!wrap || wrap.dataset.delegated === '1') return;
  wrap.dataset.delegated = '1';
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-chore-btn');
    if (!btn) return;
    const id = btn.getAttribute('data-chore-id');
    if (id) quickLogChore(id);
  });
}

function initScheduledLogSuggestions() {
  const box = document.getElementById('scheduledLogSuggestions');
  if (!box || box.dataset.delegated === '1') return;
  box.dataset.delegated = '1';
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('.scheduled-suggest-btn');
    if (!btn) return;
    const id = btn.getAttribute('data-preset-id');
    if (id && fillChoreFromPreset(id)) {
      document.getElementById('inChore')?.focus();
    }
  });
}

function fillEditEntryPersonSelect() {
  const sel = document.getElementById('editEntryPerson');
  const cur = sel.value;
  sel.innerHTML = '';
  app.people.forEach((p) => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function fillEditEntryLocationSelect(locationIds) {
  const sel = document.getElementById('editEntryLocations');
  if (!sel) return;
  const selected = new Set(Array.isArray(locationIds) ? locationIds : []);
  sel.innerHTML = '';
  app.locations.forEach((name) => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    if (selected.has(name)) o.selected = true;
    sel.appendChild(o);
  });
}

function openEditEntry(id) {
  const e = app.entries.find((x) => x.id === id);
  if (!e || !entryIsActive(e)) return;
  app.pendingEditEntryId = id;
  document.getElementById('editEntryDate').value = e.d;
  syncChoreDatalists();
  document.getElementById('editEntryChore').value = e.c;
  fillEditEntryPersonSelect();
  document.getElementById('editEntryPerson').value = e.p;
  fillEditEntryLocationSelect(e.locationIds);
  document.getElementById('editEntryDialog').showModal();
}

function delEntry(id) {
  const e = app.entries.find((x) => x.id === id);
  if (!e) return;
  app.pendingDeleteEntryId = id;
  const prev = document.getElementById('deleteEntryPreview');
  if (prev) prev.textContent = `${e.d} · ${e.c} · ${e.p}`;
  document.getElementById('deleteEntryDialog').showModal();
}

async function confirmDeleteEntry() {
  if (blockReadOnlyAction()) return;
  const id = app.pendingDeleteEntryId;
  if (!id) return;
  document.getElementById('deleteEntryDialog').close();
  try {
    const r = await apiFetch(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error('delete failed');
    await load();
    render();
  } catch (e) {
    app.loadError = t('errors.deleteEntry');
    render();
  }
}

function renderScheduledManageList() {
  const ul = document.getElementById('scheduledManageList');
  if (!ul) return;
  if (!app.scheduledChores.length) {
    ul.innerHTML = `<li style="color:var(--color-text-tertiary);font-size:13px;">${escapeHtml(t('scheduled.emptyList'))}</li>`;
    return;
  }
  ul.innerHTML = app.scheduledChores
    .map((s) => {
      const st = scheduledStatus(s);
      const safeId = String(s.id).replace(/'/g, "\\'");
      const domKey = String(s.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const startInputId = `scheduledStart_${domKey}`;
      const remindOn = s.reminderEnabled !== false;
      return `<li>
  <div class="scheduled-manage-main">
    <span>${escapeHtml(s.title)} · ${escapeHtml(intervalLabel(s))} · <span class="scheduled-status ${st.cls}" style="display:inline;padding:2px 8px;">${st.label}</span></span>
    <div class="scheduled-start-edit">
      <label for="${startInputId}">${escapeHtml(t('scheduled.startDate'))}</label>
      <input id="${startInputId}" type="date" value="${escapeHtml(s.startsOn || '')}" aria-label="${escapeAttr(t('scheduled.startAria', { title: s.title }))}">
      <button type="button" onclick="saveScheduledStartDate('${safeId}','${domKey}')">${escapeHtml(t('scheduled.saveStart'))}</button>
    </div>
    <label class="scheduled-remind-label"><input type="checkbox" ${remindOn ? 'checked' : ''} onchange="setScheduledReminderEnabled('${safeId}',this.checked)"> ${escapeHtml(t('scheduled.remindForOverdue'))}</label>
  </div>
  <div class="scheduled-manage-actions">
    <button type="button" onclick="markScheduledDone('${safeId}')">${escapeHtml(t('scheduled.markDone'))}</button>
    <button type="button" class="scheduled-btn-danger" onclick="deleteScheduledChore('${safeId}')">${escapeHtml(t('scheduled.remove'))}</button>
  </div>
</li>`;
    })
    .join('');
}

function fillScheduledDonePersonSelect() {
  const sel = document.getElementById('scheduledDonePerson');
  const cur = sel.value;
  sel.innerHTML = '';
  app.people.forEach((p) => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function openScheduledCompleteDialog(id) {
  const s = app.scheduledChores.find((x) => x.id === id);
  if (!s) return;
  app.pendingScheduledCompleteId = id;
  document.getElementById('scheduledDoneChoreTitle').textContent = s.title;
  const today = localDateISO();
  const dateInp = document.getElementById('scheduledDoneCompletedDate');
  if (dateInp) {
    dateInp.value = today;
    dateInp.max = today;
  }
  fillScheduledDonePersonSelect();
  document.getElementById('scheduledDoneDialog').showModal();
}

async function confirmScheduledComplete() {
  if (blockReadOnlyAction()) return;
  const id = app.pendingScheduledCompleteId;
  const person = document.getElementById('scheduledDonePerson').value.trim();
  const completedDateRaw = document.getElementById('scheduledDoneCompletedDate')?.value?.trim() || '';
  if (!id || !person) return;
  if (!completedDateRaw || !/^\d{4}-\d{2}-\d{2}$/.test(completedDateRaw)) {
    app.loadError = t('errors.scheduledCompletedDateRequired');
    render();
    return;
  }
  const today = localDateISO();
  if (completedDateRaw > today) {
    app.loadError = t('errors.scheduledCompletedDateFuture');
    render();
    return;
  }
  try {
    const r = await apiFetch(`/api/scheduled-chores/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person, completedDate: completedDateRaw }),
    });
    if (!r.ok) throw new Error();
    document.getElementById('scheduledDoneDialog').close();
    await load();
    render();
    renderScheduledManageList();
  } catch {
    app.loadError = t('errors.completeScheduled');
    render();
  }
}

function markScheduledDone(id) {
  openScheduledCompleteDialog(id);
}

async function saveScheduledStartDate(id, domKey) {
  if (blockReadOnlyAction()) return;
  const input = document.getElementById(`scheduledStart_${domKey}`);
  const startsOn = input ? input.value : '';
  if (!startsOn) {
    app.loadError = t('errors.scheduledStartInvalid');
    render();
    return;
  }
  try {
    const r = await apiFetch(`/api/scheduled-chores/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startsOn }),
    });
    if (!r.ok) throw new Error();
    await load();
    render();
    renderScheduledManageList();
  } catch {
    app.loadError = t('errors.scheduledStartUpdate');
    render();
  }
}

async function setScheduledReminderEnabled(id, reminderEnabled) {
  if (blockReadOnlyAction()) return;
  try {
    const r = await apiFetch(`/api/scheduled-chores/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminderEnabled }),
    });
    if (!r.ok) throw new Error();
    const data = await r.json();
    app.scheduledChores = Array.isArray(data.scheduledChores) ? data.scheduledChores : app.scheduledChores;
    renderScheduledManageList();
    render();
  } catch {
    app.loadError = t('errors.scheduledReminderUpdate');
    render();
  }
}

async function deleteScheduledChore(id) {
  if (blockReadOnlyAction()) return;
  if (!confirm(t('scheduled.confirmRemove'))) return;
  try {
    const r = await apiFetch(`/api/scheduled-chores/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error();
    await load();
    render();
    renderScheduledManageList();
  } catch {
    app.loadError = t('errors.deleteScheduled');
    render();
  }
}

function openScheduledDialog() {
  fillTranslatedSelectOptions();
  syncScheduledRecurrenceUi();
  renderScheduledManageList();
  document.getElementById('scheduledDialog').showModal();
}

function openLogChoreDialog() {
  document.getElementById('logChoreDialog')?.showModal();
}

function startApp() {
  document.getElementById('inDate').value = localDateISO();
  return load().then(async () => {
    const months = [...new Set(app.entries.map((e) => getMonthKey(e.d)))].sort().reverse();
    if (months.length) app.currentMonth = months[0];
    else app.currentMonth = thisCalendarMonthKey();
    render();
  });
}

async function bootstrap() {
  try {
    const r = await apiFetch('/api/auth');
    if (!r.ok) throw new Error('not authed');
    let authJson = null;
    try {
      authJson = await r.json();
    } catch {
      /* ignore */
    }
    app.readOnly = !!(authJson && authJson.readOnly);
    document.getElementById('loginScreen').hidden = true;
    document.getElementById('appShell').hidden = false;
    await startApp();
  } catch {
    app.readOnly = false;
    document.getElementById('loginScreen').hidden = false;
    document.getElementById('appShell').hidden = true;
  }
}

async function loadAuditLogIntoSettings() {
  const list = document.getElementById('auditLogList');
  const status = document.getElementById('auditLogStatus');
  if (!list) return;
  list.innerHTML = '';
  if (status) {
    status.hidden = false;
    status.textContent = t('settings.auditLoading');
  }
  try {
    const r = await apiFetch('/api/audit?limit=150');
    if (!r.ok) throw new Error();
    const data = await r.json();
    const rows = Array.isArray(data.auditLog) ? data.auditLog : [];
    if (status) status.hidden = true;
    if (!rows.length) {
      list.innerHTML = `<li class="audit-log-item">${escapeHtml(t('settings.auditEmpty'))}</li>`;
      return;
    }
    list.innerHTML = rows
      .map((row) => {
        const actor = escapeHtml(row.actor || '—');
        const action = escapeHtml(row.action || '');
        const target = escapeHtml(row.target || '');
        const detail = row.detail ? escapeHtml(row.detail) : '';
        const when = row.at
          ? new Date(row.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
          : '—';
        return `<li class="audit-log-item">
        <div class="audit-log-meta">${escapeHtml(when)} · ${actor}</div>
        <div><span class="audit-log-action">${action}</span> — ${target}</div>
        ${detail ? `<div class="audit-log-detail">${detail}</div>` : ''}
      </li>`;
      })
      .join('');
  } catch {
    if (status) {
      status.textContent = t('settings.auditErr');
      status.hidden = false;
    }
  }
}

function syncDiscordWebhookForm() {
  const w = app.discordWebhook || {};
  const en = document.getElementById('discordWebhookEnabled');
  const urlEl = document.getElementById('discordWebhookUrl');
  const intervalEl = document.getElementById('discordReminderInterval');
  const qhEn = document.getElementById('discordQuietHoursEnabled');
  const qhStart = document.getElementById('discordQuietHoursStart');
  const qhEnd = document.getElementById('discordQuietHoursEnd');
  const slackEl = document.getElementById('slackWebhookUrl');
  const genEl = document.getElementById('genericWebhookUrl');
  const status = document.getElementById('discordWebhookStatus');
  if (en) en.checked = Boolean(w.enabled);
  if (urlEl) urlEl.value = typeof w.url === 'string' ? w.url : '';
  if (intervalEl) {
    const m = Number(w.reminderIntervalMinutes);
    const v = Number.isFinite(m) ? String(m) : '1440';
    intervalEl.value = [...intervalEl.options].some((o) => o.value === v) ? v : '1440';
  }
  if (qhEn) qhEn.checked = Boolean(w.quietHoursEnabled);
  if (qhStart) qhStart.value = typeof w.quietHoursStart === 'string' ? w.quietHoursStart : '22:00';
  if (qhEnd) qhEnd.value = typeof w.quietHoursEnd === 'string' ? w.quietHoursEnd : '08:00';
  if (slackEl) slackEl.value = typeof w.slackWebhookUrl === 'string' ? w.slackWebhookUrl : '';
  if (genEl) genEl.value = typeof w.genericWebhookUrl === 'string' ? w.genericWebhookUrl : '';
  const owh = document.getElementById('remindOverdueWebhooks');
  const owp = document.getElementById('remindOverduePush');
  const dte = document.getElementById('remindDueTodayEnabled');
  const dtw = document.getElementById('remindDueTodayWebhooks');
  const dtp = document.getElementById('remindDueTodayPush');
  if (owh) owh.checked = w.overdueNotifyWebhooks !== false;
  if (owp) owp.checked = w.overdueNotifyPush !== false;
  if (dte) dte.checked = Boolean(w.dueTodayEnabled);
  if (dtw) dtw.checked = w.dueTodayNotifyWebhooks !== false;
  if (dtp) dtp.checked = w.dueTodayNotifyPush !== false;
  if (status) {
    status.textContent = '';
    status.hidden = true;
    status.style.color = '';
  }
}

function setDiscordStatus(msg, isError) {
  const status = document.getElementById('discordWebhookStatus');
  if (!status) return;
  status.textContent = msg || '';
  status.hidden = !msg;
  status.style.color = isError ? '#E24B4A' : '';
}

async function saveDiscordWebhookSettings() {
  if (blockReadOnlyAction()) return;
  const enabled = document.getElementById('discordWebhookEnabled')?.checked;
  const url = document.getElementById('discordWebhookUrl')?.value.trim() ?? '';
  const reminderIntervalMinutes = Number(document.getElementById('discordReminderInterval')?.value);
  const quietHoursEnabled = document.getElementById('discordQuietHoursEnabled')?.checked;
  const quietHoursStart = document.getElementById('discordQuietHoursStart')?.value ?? '22:00';
  const quietHoursEnd = document.getElementById('discordQuietHoursEnd')?.value ?? '08:00';
  const slackWebhookUrl = document.getElementById('slackWebhookUrl')?.value.trim() ?? '';
  const genericWebhookUrl = document.getElementById('genericWebhookUrl')?.value.trim() ?? '';
  const overdueNotifyWebhooks = document.getElementById('remindOverdueWebhooks')?.checked;
  const overdueNotifyPush = document.getElementById('remindOverduePush')?.checked;
  const dueTodayEnabled = document.getElementById('remindDueTodayEnabled')?.checked;
  const dueTodayNotifyWebhooks = document.getElementById('remindDueTodayWebhooks')?.checked;
  const dueTodayNotifyPush = document.getElementById('remindDueTodayPush')?.checked;
  try {
    const r = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discordWebhook: {
          enabled,
          url,
          reminderIntervalMinutes,
          quietHoursEnabled,
          quietHoursStart,
          quietHoursEnd,
          slackWebhookUrl,
          genericWebhookUrl,
          overdueNotifyWebhooks,
          overdueNotifyPush,
          dueTodayEnabled,
          dueTodayNotifyWebhooks,
          dueTodayNotifyPush,
        },
      }),
    });
    if (!r.ok) throw new Error();
    const data = await r.json();
    app.discordWebhook = data.discordWebhook;
    syncDiscordWebhookForm();
    setDiscordStatus(t('settings.discordSaved'), false);
  } catch {
    setDiscordStatus(t('settings.discordSaveErr'), true);
  }
}

async function testDiscordWebhook() {
  if (blockReadOnlyAction()) return;
  const payload = {};
  const u = document.getElementById('discordWebhookUrl')?.value.trim();
  const s = document.getElementById('slackWebhookUrl')?.value.trim();
  const g = document.getElementById('genericWebhookUrl')?.value.trim();
  if (u) payload.url = u;
  if (s) payload.slackWebhookUrl = s;
  if (g) payload.genericWebhookUrl = g;
  try {
    const r = await apiFetch('/api/discord-webhook/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.keys(payload).length ? payload : {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    setDiscordStatus(t('settings.discordTestOk'), false);
  } catch {
    setDiscordStatus(t('settings.discordTestErr'), true);
  }
}

async function discordRemindOverdueNow() {
  if (blockReadOnlyAction()) return;
  try {
    const r = await apiFetch('/api/discord-webhook/remind-now', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setDiscordStatus(data.error || t('settings.discordPostErr'), true);
      return;
    }
    const nOver = data.sentOverdue;
    const nDue = data.sentDueToday;
    if (typeof nOver === 'number' && typeof nDue === 'number' && nOver === 0 && nDue === 0) {
      setDiscordStatus(data.message || t('settings.discordNoReminders'), false);
      return;
    }
    if (typeof nOver === 'number' && typeof nDue === 'number') {
      setDiscordStatus(
        t('settings.discordPostedMixed', { overdue: nOver, dueToday: nDue }),
        false,
      );
      return;
    }
    setDiscordStatus(t('settings.discordPosted', { n: data.sent }), false);
  } catch {
    setDiscordStatus(t('settings.discordPostErr'), true);
  }
}

function fillTranslatedSelectOptions() {
  const discordSel = document.getElementById('discordReminderInterval');
  if (discordSel) {
    [...discordSel.options].forEach((opt) => {
      const v = opt.value;
      if (v) opt.textContent = t(`discordIntervals.${v}`);
    });
  }
}

function syncScheduledRecurrenceUi() {
  const modeEl = document.getElementById('scheduledRecurrenceMode');
  const intervalWrap = document.getElementById('scheduledIntervalWrap');
  const monthlyWrap = document.getElementById('scheduledMonthlyWrap');
  const intInp = document.getElementById('scheduledIntervalDays');
  const ordSel = document.getElementById('scheduledMonthOrdinal');
  const wdSel = document.getElementById('scheduledWeekday');
  if (!modeEl || !intervalWrap || !monthlyWrap) return;
  const monthly = modeEl.value === 'monthlyWeekday';
  if (intInp) intInp.disabled = monthly;
  if (ordSel) ordSel.disabled = !monthly;
  if (wdSel) wdSel.disabled = !monthly;
  intervalWrap.classList.toggle('scheduled-add-row--muted', monthly);
  monthlyWrap.classList.toggle('scheduled-add-row--muted', !monthly);
}

function syncSettingsLocaleSelect() {
  const sel = document.getElementById('settingsLocale');
  if (sel) sel.value = getLocale();
}

function setAnalyticsMode(mode, persist = true) {
  const next = mode === 'points' ? 'points' : 'tasks';
  app.analyticsMode = next;
  document.querySelectorAll('input[name="analyticsMode"]').forEach((el) => {
    el.checked = el.value === next;
  });
  if (persist) {
    try {
      localStorage.setItem('chorelog-analytics-mode', next);
    } catch {
      /* ignore */
    }
  }
}

loadAppVersion();

applyTheme(localStorage.getItem('chorelog-theme') || 'system');
setAnalyticsMode(localStorage.getItem('chorelog-analytics-mode') || 'tasks', false);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (document.documentElement.getAttribute('data-theme') === 'system') syncThemeMeta();
});

document.getElementById('themeOptions').addEventListener('change', (e) => {
  const t = e.target;
  if (t && t.name === 'theme' && t.checked) applyTheme(t.value);
});

const SETTINGS_TAB_KEY = 'chorelog-settings-tab';
const DASHBOARD_ORDER_KEY = 'chorelog-dashboard-order';
const DASHBOARD_HIDDEN_BLOCKS_KEY = 'chorelog-dashboard-hidden-blocks';
const DASHBOARD_HIDDEN_STAT_CARDS_KEY = 'chorelog-dashboard-hidden-stat-cards';
const DASHBOARD_DESKTOP_LAYOUT_KEY = 'chorelog-dashboard-desktop-layout';
const DEFAULT_DASHBOARD_BLOCK_ORDER = [
  'dashboardBlockStats',
  'dashboardBlockContributions',
  'dashboardBlockHeatmap',
  'dashboardBlockLog',
  'dashboardBlockScheduled',
  'dashboardBlockMom',
];
const ALL_DASHBOARD_STAT_CARD_KEYS = [
  'tasks_totalTasks',
  'tasks_mostActive',
  'tasks_activeDays',
  'tasks_members',
  'tasks_balance',
  'points_totalPoints',
  'points_topEarner',
  'points_avgPtsPerTask',
  'points_members',
  'points_balance',
];
const DEFAULT_DASHBOARD_DESKTOP_LAYOUT = Object.freeze({
  dashboardBlockStats: 'full',
  dashboardBlockContributions: 'third',
  dashboardBlockHeatmap: 'third',
  dashboardBlockLog: 'full',
  dashboardBlockScheduled: 'third',
  dashboardBlockMom: 'third',
});
const VALID_SETTINGS_TABS = new Set([
  'interface',
  'household',
  'chores',
  'integrations',
  'account',
  'administration',
  'audit',
  'data',
  'about',
]);

function normalizeDashboardBlockOrder(raw) {
  const ids = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!DEFAULT_DASHBOARD_BLOCK_ORDER.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of DEFAULT_DASHBOARD_BLOCK_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function readDashboardBlockOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(DASHBOARD_ORDER_KEY) || '[]');
    return normalizeDashboardBlockOrder(raw);
  } catch {
    return [...DEFAULT_DASHBOARD_BLOCK_ORDER];
  }
}

function writeDashboardBlockOrder(order) {
  try {
    localStorage.setItem(DASHBOARD_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

function normalizeDashboardHiddenBlocks(raw) {
  const ids = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
  const valid = new Set(DEFAULT_DASHBOARD_BLOCK_ORDER);
  return [...new Set(ids.filter((id) => valid.has(id)))];
}

function readDashboardHiddenBlocks() {
  try {
    const raw = JSON.parse(localStorage.getItem(DASHBOARD_HIDDEN_BLOCKS_KEY) || '[]');
    return normalizeDashboardHiddenBlocks(raw);
  } catch {
    return [];
  }
}

function writeDashboardHiddenBlocks(ids) {
  try {
    localStorage.setItem(DASHBOARD_HIDDEN_BLOCKS_KEY, JSON.stringify(normalizeDashboardHiddenBlocks(ids)));
  } catch {
    /* ignore */
  }
}

function normalizeDashboardHiddenStatCards(raw) {
  const ids = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
  const valid = new Set(ALL_DASHBOARD_STAT_CARD_KEYS);
  return [...new Set(ids.filter((id) => valid.has(id)))];
}

function readDashboardHiddenStatCards() {
  try {
    const raw = JSON.parse(localStorage.getItem(DASHBOARD_HIDDEN_STAT_CARDS_KEY) || '[]');
    return normalizeDashboardHiddenStatCards(raw);
  } catch {
    return [];
  }
}

function writeDashboardHiddenStatCards(ids) {
  try {
    localStorage.setItem(
      DASHBOARD_HIDDEN_STAT_CARDS_KEY,
      JSON.stringify(normalizeDashboardHiddenStatCards(ids)),
    );
  } catch {
    /* ignore */
  }
}

function normalizeDashboardDesktopLayout(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const id of DEFAULT_DASHBOARD_BLOCK_ORDER) {
    const val = src[id];
    out[id] = val === 'quarter' || val === 'third' || val === 'half' ? val : 'full';
  }
  return out;
}

function readDashboardDesktopLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(DASHBOARD_DESKTOP_LAYOUT_KEY) || '{}');
    return normalizeDashboardDesktopLayout({ ...DEFAULT_DASHBOARD_DESKTOP_LAYOUT, ...raw });
  } catch {
    return { ...DEFAULT_DASHBOARD_DESKTOP_LAYOUT };
  }
}

function writeDashboardDesktopLayout(layout) {
  try {
    localStorage.setItem(
      DASHBOARD_DESKTOP_LAYOUT_KEY,
      JSON.stringify(normalizeDashboardDesktopLayout(layout)),
    );
  } catch {
    /* ignore */
  }
}

function applyDashboardBlockOrder(order) {
  const container = document.getElementById('dashboardBlocks');
  if (!container) return;
  for (const id of order) {
    const el = document.getElementById(id);
    if (!el) continue;
    container.appendChild(el);
  }
}

function applyDashboardBlockVisibility() {
  const hidden = new Set(app.dashboardHiddenBlocks || []);
  for (const id of DEFAULT_DASHBOARD_BLOCK_ORDER) {
    const el = document.getElementById(id);
    if (el) el.hidden = hidden.has(id);
  }
}

function applyDashboardDesktopLayout() {
  const layout = readDashboardDesktopLayout();
  for (const id of DEFAULT_DASHBOARD_BLOCK_ORDER) {
    const el = document.getElementById(id);
    if (!el) continue;
    const size = layout[id] || 'full';
    el.classList.toggle('dashboard-block--desktop-quarter', size === 'quarter');
    el.classList.toggle('dashboard-block--desktop-third', size === 'third');
    el.classList.toggle('dashboard-block--desktop-half', size === 'half');
    el.classList.toggle('dashboard-block--desktop-full', size === 'full');
  }
}

function dashboardStatCardLabel(cardKey) {
  const [mode, metric] = String(cardKey || '').split('_');
  if (mode === 'tasks') {
    if (metric === 'totalTasks') return t('stats.totalTasks');
    if (metric === 'mostActive') return t('stats.mostActive');
    if (metric === 'activeDays') return t('stats.activeDays');
    if (metric === 'members') return t('stats.members');
    if (metric === 'balance') return t('stats.balance');
  }
  if (mode === 'points') {
    if (metric === 'totalPoints') return t('stats.totalPoints');
    if (metric === 'topEarner') return t('stats.topEarner');
    if (metric === 'avgPtsPerTask') return t('stats.avgPtsPerTask');
    if (metric === 'members') return t('stats.members');
    if (metric === 'balance') return t('stats.balance');
  }
  return cardKey;
}

function renderDashboardOrderList(order) {
  const list = document.getElementById('dashboardOrderList');
  if (!list) return;
  list.innerHTML = order
    .map((id, idx) => {
      const block = document.getElementById(id);
      const labelKey = block?.getAttribute('data-order-label') || '';
      const label = labelKey ? t(labelKey) : id;
      return `<li class="dashboard-order-item">
  <span class="dashboard-order-name">${escapeHtml(label)}</span>
  <span class="dashboard-order-actions">
    <button type="button" class="btn-secondary" data-order-move="up" data-order-id="${escapeAttr(id)}" ${idx === 0 ? 'disabled' : ''} aria-label="${escapeAttr(t('dashboard.moveUp'))}">↑</button>
    <button type="button" class="btn-secondary" data-order-move="down" data-order-id="${escapeAttr(id)}" ${idx === order.length - 1 ? 'disabled' : ''} aria-label="${escapeAttr(t('dashboard.moveDown'))}">↓</button>
  </span>
</li>`;
    })
    .join('');
}

function renderDashboardVisibilityList() {
  const list = document.getElementById('dashboardVisibilityList');
  if (!list) return;
  const hidden = new Set(app.dashboardHiddenBlocks || []);
  list.innerHTML = DEFAULT_DASHBOARD_BLOCK_ORDER.map((id) => {
    const block = document.getElementById(id);
    const labelKey = block?.getAttribute('data-order-label') || '';
    const label = labelKey ? t(labelKey) : id;
    return `<li class="dashboard-order-item">
  <label class="dashboard-order-name">
    <input type="checkbox" data-toggle-block="${escapeAttr(id)}" ${hidden.has(id) ? '' : 'checked'} />
    ${escapeHtml(label)}
  </label>
</li>`;
  }).join('');
}

function renderDashboardStatsVisibilityList() {
  const list = document.getElementById('dashboardStatsVisibilityList');
  if (!list) return;
  const hidden = new Set(app.dashboardHiddenStatCards || []);
  list.innerHTML = ALL_DASHBOARD_STAT_CARD_KEYS.map((key) => {
    const label = dashboardStatCardLabel(key);
    return `<li class="dashboard-order-item">
  <label class="dashboard-order-name">
    <input type="checkbox" data-toggle-stat-card="${escapeAttr(key)}" ${hidden.has(key) ? '' : 'checked'} />
    ${escapeHtml(label)}
  </label>
</li>`;
  }).join('');
}

function renderDashboardDesktopLayoutList() {
  const list = document.getElementById('dashboardDesktopLayoutList');
  if (!list) return;
  const layout = readDashboardDesktopLayout();
  list.innerHTML = DEFAULT_DASHBOARD_BLOCK_ORDER.map((id) => {
    const block = document.getElementById(id);
    const labelKey = block?.getAttribute('data-order-label') || '';
    const label = labelKey ? t(labelKey) : id;
    const current =
      layout[id] === 'quarter' || layout[id] === 'third' || layout[id] === 'half'
        ? layout[id]
        : 'full';
    return `<li class="dashboard-order-item">
  <span class="dashboard-order-name">${escapeHtml(label)}</span>
  <span class="dashboard-order-actions">
    <select data-desktop-layout-block="${escapeAttr(id)}" aria-label="${escapeAttr(label)}">
      <option value="full" ${current === 'full' ? 'selected' : ''}>${escapeHtml(t('dashboard.desktopWidthFull'))}</option>
      <option value="half" ${current === 'half' ? 'selected' : ''}>${escapeHtml(t('dashboard.desktopWidthHalf'))}</option>
      <option value="third" ${current === 'third' ? 'selected' : ''}>${escapeHtml(t('dashboard.desktopWidthThird'))}</option>
      <option value="quarter" ${current === 'quarter' ? 'selected' : ''}>${escapeHtml(t('dashboard.desktopWidthQuarter'))}</option>
    </select>
  </span>
</li>`;
  }).join('');
}

function openDashboardOrderDialog() {
  const order = readDashboardBlockOrder();
  app.dashboardHiddenBlocks = readDashboardHiddenBlocks();
  app.dashboardHiddenStatCards = readDashboardHiddenStatCards();
  renderDashboardOrderList(order);
  renderDashboardVisibilityList();
  renderDashboardDesktopLayoutList();
  renderDashboardStatsVisibilityList();
  document.getElementById('dashboardOrderDialog')?.showModal();
}

function closeSettingsMobileNav() {
  const nav = document.getElementById('settingsNav');
  const backdrop = document.getElementById('settingsNavBackdrop');
  const toggle = document.getElementById('settingsNavToggle');
  nav?.classList.remove('is-open');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
  }
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.setAttribute('aria-label', t('settings.navOpen'));
}

function openSettingsMobileNav() {
  const nav = document.getElementById('settingsNav');
  const backdrop = document.getElementById('settingsNavBackdrop');
  const toggle = document.getElementById('settingsNavToggle');
  nav?.classList.add('is-open');
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
  }
  toggle?.setAttribute('aria-expanded', 'true');
  toggle?.setAttribute('aria-label', t('settings.navClose'));
}

function setSettingsTab(id) {
  if (!VALID_SETTINGS_TABS.has(id)) id = 'interface';
  const dialog = document.getElementById('settingsDialog');
  if (!dialog) return;
  dialog.querySelectorAll('[data-settings-tab]').forEach((btn) => {
    const on = btn.dataset.settingsTab === id;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.classList.toggle('is-active', on);
  });
  dialog.querySelectorAll('[data-settings-panel]').forEach((p) => {
    const on = p.dataset.settingsPanel === id;
    p.hidden = !on;
    p.classList.toggle('is-active', on);
  });
  try {
    sessionStorage.setItem(SETTINGS_TAB_KEY, id);
  } catch {
    /* ignore */
  }
  closeSettingsMobileNav();
  if (id === 'about') {
    void loadAboutPanel();
  }
  if (id === 'account') {
    void loadAccountPanel();
  }
  if (id === 'administration') {
    void loadAdministrationPanel();
  }
}

function initSettingsShell() {
  const dialog = document.getElementById('settingsDialog');
  const toggle = document.getElementById('settingsNavToggle');
  const backdrop = document.getElementById('settingsNavBackdrop');
  if (!dialog || !toggle || !backdrop) return;

  dialog.querySelectorAll('[data-settings-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab));
  });

  toggle.addEventListener('click', () => {
    if (document.getElementById('settingsNav')?.classList.contains('is-open')) {
      closeSettingsMobileNav();
    } else {
      openSettingsMobileNav();
    }
  });

  backdrop.addEventListener('click', () => closeSettingsMobileNav());

  dialog.addEventListener('close', () => closeSettingsMobileNav());

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth >= 768) closeSettingsMobileNav();
    }, 120);
  });
}

document.getElementById('btnSettings').addEventListener('click', () => {
  renderPeopleEditor();
  renderLocationsEditor();
  renderChorePresetsEditor();
  renderQuickChoresEditor();
  syncDiscordWebhookForm();
  syncAdministrationNavVisibility();
  void refreshPushNotificationsPanel();
  loadAuditLogIntoSettings();
  fillTranslatedSelectOptions();
  syncSettingsLocaleSelect();
  const mode = localStorage.getItem('chorelog-theme') || 'system';
  document.querySelectorAll('#themeOptions input[name="theme"]').forEach((el) => {
    el.checked = el.value === mode;
  });
  let tab = 'interface';
  try {
    const s = sessionStorage.getItem(SETTINGS_TAB_KEY);
    if (s && VALID_SETTINGS_TABS.has(s)) tab = s;
  } catch {
    /* ignore */
  }
  if (tab === 'administration' && !administrationTabVisible()) tab = 'interface';
  setSettingsTab(tab);
  document.getElementById('settingsDialog').showModal();
});

document.getElementById('btnReorderDashboard')?.addEventListener('click', () => {
  openDashboardOrderDialog();
});

document.getElementById('btnRefreshAuditLog').addEventListener('click', () => loadAuditLogIntoSettings());

document.getElementById('btnSaveDisplayName')?.addEventListener('click', async () => {
  if (blockReadOnlyAction()) return;
  const input = document.getElementById('accountDisplayNameInput');
  const status = document.getElementById('accountDisplayNameStatus');
  if (!input || !status) return;
  const user = input.value.trim();
  if (!user) {
    status.textContent = t('settings.accountDisplayNameRequired');
    status.hidden = false;
    return;
  }
  status.hidden = true;
  try {
    const r = await apiFetch('/api/account/display-name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user }),
    });
    if (!r.ok) {
      let msg = t('settings.accountDisplayNameErr');
      try {
        const j = await r.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      status.textContent = msg;
      status.hidden = false;
      return;
    }
    status.textContent = t('settings.accountDisplayNameOk');
    status.hidden = false;
    await loadAccountInfo();
  } catch {
    status.textContent = t('settings.accountDisplayNameErr');
    status.hidden = false;
  }
});

document.getElementById('btnAccountChangePassword')?.addEventListener('click', async () => {
  if (blockReadOnlyAction()) return;
  const cur = document.getElementById('accountCurrentPassword');
  const n1 = document.getElementById('accountNewPassword');
  const n2 = document.getElementById('accountConfirmPassword');
  const status = document.getElementById('accountPasswordStatus');
  if (!cur || !n1 || !n2 || !status) return;
  const currentPassword = cur.value;
  const newPassword = n1.value;
  const confirm = n2.value;
  status.hidden = true;
  if (newPassword !== confirm) {
    status.textContent = t('settings.accountPasswordMismatch');
    status.hidden = false;
    return;
  }
  if (newPassword.length < 8) {
    status.textContent = t('settings.accountPasswordTooShort');
    status.hidden = false;
    return;
  }
  try {
    const r = await apiFetch('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!r.ok) {
      let msg = t('settings.accountPasswordErr');
      try {
        const j = await r.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      status.textContent = msg;
      status.hidden = false;
      return;
    }
    status.textContent = t('settings.accountPasswordOk');
    status.hidden = false;
    cur.value = '';
    n1.value = '';
    n2.value = '';
  } catch {
    status.textContent = t('settings.accountPasswordErr');
    status.hidden = false;
  }
});

document.getElementById('btnCreateHousehold')?.addEventListener('click', async () => {
  if (blockReadOnlyAction()) return;
  const idRaw = document.getElementById('accountNewHouseholdId')?.value.trim().toLowerCase() || '';
  const pw = document.getElementById('accountNewHouseholdPassword')?.value || '';
  const pw2 = document.getElementById('accountNewHouseholdPassword2')?.value || '';
  const master = document.getElementById('accountMasterPassword')?.value || '';
  const status = document.getElementById('accountCreateStatus');
  if (!status) return;
  status.hidden = true;
  if (pw !== pw2) {
    status.textContent = t('settings.accountPasswordMismatch');
    status.hidden = false;
    return;
  }
  if (pw.length < 8) {
    status.textContent = t('settings.accountPasswordTooShort');
    status.hidden = false;
    return;
  }
  if (!app.account) await loadAccountInfo();
  const body = { id: idRaw, password: pw };
  if (app.account && !app.account.openRegistration) {
    body.masterPassword = master;
  }
  try {
    const r = await apiFetch('/api/households', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = t('settings.accountCreateErr');
      try {
        const j = await r.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      status.textContent = msg;
      status.hidden = false;
      return;
    }
    status.textContent = t('settings.accountCreateOk');
    status.hidden = false;
    const idEl = document.getElementById('accountNewHouseholdId');
    const p1 = document.getElementById('accountNewHouseholdPassword');
    const p2 = document.getElementById('accountNewHouseholdPassword2');
    const m = document.getElementById('accountMasterPassword');
    if (idEl) idEl.value = '';
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (m) m.value = '';
    await loadAccountInfo();
    await loadAccountPanel();
  } catch {
    status.textContent = t('settings.accountCreateErr');
    status.hidden = false;
  }
});

document.getElementById('settingsLocale')?.addEventListener('change', async (e) => {
  const v = e.target && e.target.value;
  if (v) await setLocale(v);
});

document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsDialog').close();
});

document.getElementById('settingsDialog').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsDialog')) e.target.close();
});

document.getElementById('dashboardOrderClose')?.addEventListener('click', () => {
  document.getElementById('dashboardOrderDialog')?.close();
});
document.getElementById('dashboardOrderDialog')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('dashboardOrderDialog')) e.target.close();
});
document.getElementById('dashboardOrderList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-order-move][data-order-id]');
  if (!btn) return;
  const id = btn.getAttribute('data-order-id');
  const move = btn.getAttribute('data-order-move');
  const order = readDashboardBlockOrder();
  const idx = order.indexOf(id);
  if (idx === -1) return;
  if (move === 'up' && idx > 0) {
    const tmp = order[idx - 1];
    order[idx - 1] = order[idx];
    order[idx] = tmp;
  } else if (move === 'down' && idx < order.length - 1) {
    const tmp = order[idx + 1];
    order[idx + 1] = order[idx];
    order[idx] = tmp;
  } else {
    return;
  }
  writeDashboardBlockOrder(order);
  applyDashboardBlockOrder(order);
  renderDashboardOrderList(order);
});
document.getElementById('dashboardVisibilityList')?.addEventListener('change', (e) => {
  const cb = e.target.closest('input[type="checkbox"][data-toggle-block]');
  if (!cb) return;
  const id = cb.getAttribute('data-toggle-block');
  const hidden = new Set(readDashboardHiddenBlocks());
  if (cb.checked) hidden.delete(id);
  else hidden.add(id);
  app.dashboardHiddenBlocks = [...hidden];
  writeDashboardHiddenBlocks(app.dashboardHiddenBlocks);
  applyDashboardBlockVisibility();
});
document.getElementById('dashboardDesktopLayoutList')?.addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-desktop-layout-block]');
  if (!sel) return;
  const id = sel.getAttribute('data-desktop-layout-block');
  const next =
    sel.value === 'quarter' || sel.value === 'third' || sel.value === 'half'
      ? sel.value
      : 'full';
  const layout = readDashboardDesktopLayout();
  layout[id] = next;
  writeDashboardDesktopLayout(layout);
  applyDashboardDesktopLayout();
});
document.getElementById('dashboardStatsVisibilityList')?.addEventListener('change', (e) => {
  const cb = e.target.closest('input[type="checkbox"][data-toggle-stat-card]');
  if (!cb) return;
  const key = cb.getAttribute('data-toggle-stat-card');
  const hidden = new Set(readDashboardHiddenStatCards());
  if (cb.checked) hidden.delete(key);
  else hidden.add(key);
  app.dashboardHiddenStatCards = [...hidden];
  writeDashboardHiddenStatCards(app.dashboardHiddenStatCards);
  render();
});

document.getElementById('btnAddPerson').addEventListener('click', () => addPerson());
document.getElementById('newPersonName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addPerson();
  }
});
document.getElementById('btnAddLocation').addEventListener('click', () => addLocation());
document.getElementById('newLocationName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addLocation();
  }
});

document.getElementById('btnSaveDiscordWebhook').addEventListener('click', () => saveDiscordWebhookSettings());
document.getElementById('btnTestDiscordWebhook').addEventListener('click', () => testDiscordWebhook());
document.getElementById('btnDiscordRemindNow').addEventListener('click', () => discordRemindOverdueNow());
document.getElementById('btnPushSubscribe')?.addEventListener('click', () => enableBrowserPush());
document.getElementById('btnPushUnsubscribe')?.addEventListener('click', () => disableBrowserPush());
document.getElementById('btnPushTest')?.addEventListener('click', () => testBrowserPush());

document.getElementById('btnExport').addEventListener('click', async () => {
  try {
    const r = await apiFetch('/api/export');
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chorelog-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    alert(t('errors.exportFailed'));
  }
});

document.getElementById('btnExportCsv').addEventListener('click', async () => {
  try {
    const r = await apiFetch('/api/export/entries.csv');
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const cd = r.headers.get('Content-Disposition');
    const m = cd && /filename="([^"]+)"/.exec(cd);
    a.download = m ? m[1] : `chorelog-entries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    alert(t('errors.exportFailed'));
  }
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  if (blockReadOnlyAction()) return;
  const input = e.target;
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  let data;
  try {
    data = JSON.parse(await f.text());
  } catch {
    alert(t('import.invalidJson'));
    return;
  }
  const merge = confirm(t('import.confirm'));
  try {
    const r = await apiFetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        people: data.people,
        locations: data.locations,
        entries: data.entries,
        scheduledChores: data.scheduledChores,
        chorePresets: data.chorePresets,
        quickChoreIds: data.quickChoreIds,
        discordWebhook: data.discordWebhook,
        auditLog: data.auditLog,
        mode: merge ? 'merge' : 'replace',
      }),
    });
    if (!r.ok) throw new Error();
    await load();
    renderPeopleEditor();
    renderChorePresetsEditor();
    renderQuickChoresEditor();
    render();
    renderScheduledManageList();
  } catch {
    app.loadError = t('errors.importFailed');
    render();
  }
});

document.getElementById('btnScheduled').addEventListener('click', openScheduledDialog);
document.getElementById('btnLogChoreTop')?.addEventListener('click', openLogChoreDialog);
document.getElementById('btnLogChoreFab')?.addEventListener('click', openLogChoreDialog);
document.getElementById('btnOpenScheduledFromSettings').addEventListener('click', () => {
  document.getElementById('settingsDialog').close();
  openScheduledDialog();
});
document.getElementById('scheduledDialogClose').addEventListener('click', () => {
  document.getElementById('scheduledDialog').close();
});
document.getElementById('scheduledDialog').addEventListener('click', (e) => {
  if (e.target === document.getElementById('scheduledDialog')) e.target.close();
});
document.getElementById('scheduledDialog').addEventListener('toggle', (e) => {
  document.body.style.overflow = e.target.open ? 'hidden' : '';
});
document.getElementById('logChoreDialogClose')?.addEventListener('click', () => {
  document.getElementById('logChoreDialog')?.close();
});
document.getElementById('logChoreDialog')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('logChoreDialog')) e.target.close();
});

document.getElementById('scheduledDoneDialogClose').addEventListener('click', () => {
  document.getElementById('scheduledDoneDialog').close();
});
document.getElementById('scheduledDoneCancel').addEventListener('click', () => {
  document.getElementById('scheduledDoneDialog').close();
});
document.getElementById('scheduledDoneConfirm').addEventListener('click', () => {
  confirmScheduledComplete();
});
document.getElementById('scheduledDoneDialog').addEventListener('click', (e) => {
  if (e.target === document.getElementById('scheduledDoneDialog')) e.target.close();
});
document.getElementById('scheduledDoneDialog').addEventListener('close', () => {
  app.pendingScheduledCompleteId = null;
});

document.getElementById('editEntryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (blockReadOnlyAction()) return;
  const id = app.pendingEditEntryId;
  if (!id) return;
  const d = document.getElementById('editEntryDate').value;
  const title = document.getElementById('editEntryChore').value.trim();
  const p = document.getElementById('editEntryPerson').value;
  if (!d || !title || !p) return;
  const preset = app.chorePresets.find((x) => x.title.toLowerCase() === title.toLowerCase());
  const selectedLocations = [...document.querySelectorAll('#editEntryLocations option:checked')].map(
    (o) => o.value,
  );
  let body;
  if (preset) {
    if (preset.scoringMode === 'per_location') {
      if (!selectedLocations.length) {
        app.loadError = t('errors.selectLocation', { title: preset.title });
        render();
        return;
      }
      body = { d, p, choreId: preset.id, locationIds: selectedLocations };
    } else {
      body = { d, p, choreId: preset.id, locationIds: [] };
    }
  } else {
    body = { d, c: title, p, locationIds: [] };
  }
  try {
    const r = await apiFetch(`/api/entries/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    document.getElementById('editEntryDialog').close();
    app.pendingEditEntryId = null;
    await load();
    app.currentMonth = getMonthKey(d);
    render();
  } catch {
    app.loadError = t('errors.updateEntry');
    render();
  }
});
document.getElementById('editEntryDialogClose').addEventListener('click', () => {
  document.getElementById('editEntryDialog').close();
});
document.getElementById('editEntryCancel').addEventListener('click', () => {
  document.getElementById('editEntryDialog').close();
});
document.getElementById('editEntryDialog').addEventListener('click', (e) => {
  if (e.target === document.getElementById('editEntryDialog')) e.target.close();
});
document.getElementById('editEntryDialog').addEventListener('close', () => {
  app.pendingEditEntryId = null;
});

document.getElementById('deleteEntryDialogClose').addEventListener('click', () => {
  document.getElementById('deleteEntryDialog').close();
});
document.getElementById('deleteEntryCancel').addEventListener('click', () => {
  document.getElementById('deleteEntryDialog').close();
});
document.getElementById('deleteEntryConfirm').addEventListener('click', () => {
  confirmDeleteEntry();
});
document.getElementById('deleteEntryDialog').addEventListener('click', (e) => {
  if (e.target === document.getElementById('deleteEntryDialog')) e.target.close();
});
document.getElementById('deleteEntryDialog').addEventListener('close', () => {
  app.pendingDeleteEntryId = null;
});

document.getElementById('addScheduledForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (blockReadOnlyAction()) return;
  const title = document.getElementById('scheduledNewTitle').value.trim();
  if (!title) return;
  const mode = document.getElementById('scheduledRecurrenceMode')?.value || 'interval';
  const startsOn = localDateISO();
  const body =
    mode === 'monthlyWeekday'
      ? {
          title,
          startsOn,
          recurrence: 'monthlyWeekday',
          monthOrdinal: Number(document.getElementById('scheduledMonthOrdinal').value),
          weekday: Number(document.getElementById('scheduledWeekday').value),
        }
      : (() => {
          let intervalDays = Math.round(Number(document.getElementById('scheduledIntervalDays')?.value));
          if (!Number.isFinite(intervalDays) || intervalDays < 1) intervalDays = 7;
          if (intervalDays > 3650) intervalDays = 3650;
          return {
            title,
            startsOn,
            recurrence: 'interval',
            intervalDays,
          };
        })();
  try {
    const r = await apiFetch('/api/scheduled-chores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    await load();
    document.getElementById('scheduledNewTitle').value = '';
    const intEl = document.getElementById('scheduledIntervalDays');
    if (intEl) intEl.value = '7';
    render();
    renderScheduledManageList();
  } catch {
    alert(t('scheduled.addFailed'));
  }
});

document.getElementById('scheduledRecurrenceMode')?.addEventListener('change', () => {
  syncScheduledRecurrenceUi();
});

document.getElementById('monthSelect').addEventListener('change', (e) => {
  switchMonth(e.target.value);
});

document.getElementById('analyticsPersonFilter').addEventListener('change', (e) => {
  app.analyticsPersonFilter = e.target.value;
  render();
});

document.getElementById('analyticsLocationFilter').addEventListener('change', (e) => {
  app.analyticsLocationFilter = e.target.value;
  render();
});

document.getElementById('logSearch').addEventListener('input', (e) => {
  app.logSearchQuery = e.target.value;
  render();
});

document.getElementById('logShowRemoved')?.addEventListener('change', (e) => {
  app.showArchivedLogEntries = e.target.checked;
  render();
});

document.querySelectorAll('input[name="analyticsMode"]').forEach((el) => {
  el.addEventListener('change', (e) => {
    if (!e.target?.checked) return;
    setAnalyticsMode(e.target.value);
    render();
  });
});

document.getElementById('chorePresetsList').addEventListener('change', async () => {
  const next = readChorePresetsFromDom();
  if (!next.filter((p) => !p.deletedAt).length) {
    app.loadError = t('errors.atLeastOnePreset');
    renderChorePresetsEditor();
    render();
    return;
  }
  app.chorePresets = next;
  await saveChorePresetsAndQuick();
});

document.getElementById('chorePresetsList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.chore-preset-remove');
  if (!btn) return;
  const id = btn.getAttribute('data-remove');
  const p = app.chorePresets.find((x) => x.id === id);
  if (!p) return;
  const activeCount = app.chorePresets.filter((x) => !x.deletedAt).length;
  if (!p.deletedAt && activeCount <= 1) return;
  p.deletedAt = new Date().toISOString();
  app.quickChoreIds = app.quickChoreIds.filter((q) => q !== id);
  renderChorePresetsEditor();
  renderQuickChoresEditor();
  await saveChorePresetsAndQuick();
});

document.getElementById('chorePresetsArchivedList')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.chore-preset-restore');
  if (!btn) return;
  const id = btn.getAttribute('data-restore');
  const p = app.chorePresets.find((x) => x.id === id);
  if (!p || !p.deletedAt) return;
  delete p.deletedAt;
  renderChorePresetsEditor();
  renderQuickChoresEditor();
  await saveChorePresetsAndQuick();
});

document.getElementById('btnAddChorePreset').addEventListener('click', async () => {
  const id = crypto.randomUUID();
  app.chorePresets.push({ id, title: t('newPresetTitle'), points: 1, color: '#378ADD', scoringMode: 'flat' });
  renderChorePresetsEditor();
  await saveChorePresetsAndQuick();
});

document.getElementById('quickChoresList').addEventListener('click', async (e) => {
  const up = e.target.closest('.btn-quick-move[data-dir="up"]');
  const down = e.target.closest('.btn-quick-move[data-dir="down"]');
  const rm = e.target.closest('.btn-quick-remove');
  if (up) {
    const idx = Number(up.getAttribute('data-idx'));
    if (idx > 0) {
      const t = app.quickChoreIds[idx];
      app.quickChoreIds[idx] = app.quickChoreIds[idx - 1];
      app.quickChoreIds[idx - 1] = t;
      renderQuickChoresEditor();
      await saveChorePresetsAndQuick();
    }
  } else if (down) {
    const idx = Number(down.getAttribute('data-idx'));
    if (idx < app.quickChoreIds.length - 1) {
      const t = app.quickChoreIds[idx];
      app.quickChoreIds[idx] = app.quickChoreIds[idx + 1];
      app.quickChoreIds[idx + 1] = t;
      renderQuickChoresEditor();
      await saveChorePresetsAndQuick();
    }
  } else if (rm) {
    const id = rm.getAttribute('data-remove');
    app.quickChoreIds = app.quickChoreIds.filter((q) => q !== id);
    renderQuickChoresEditor();
    await saveChorePresetsAndQuick();
  }
});

document.getElementById('btnAddQuickChore').addEventListener('click', async () => {
  const sel = document.getElementById('quickChorePresetSelect');
  const id = sel && sel.value;
  if (!id || app.quickChoreIds.includes(id)) return;
  app.quickChoreIds.push(id);
  renderQuickChoresEditor();
  await saveChorePresetsAndQuick();
});

document.getElementById('inChore')?.addEventListener('input', () => {
  syncLogLocationFieldVisibility();
});

initQuickChores();
initScheduledLogSuggestions();
initChoreInputSuggest();
syncLogLocationFieldVisibility();
app.dashboardHiddenBlocks = readDashboardHiddenBlocks();
app.dashboardHiddenStatCards = readDashboardHiddenStatCards();
applyDashboardBlockOrder(readDashboardBlockOrder());
applyDashboardBlockVisibility();
applyDashboardDesktopLayout();

document.getElementById('addToastUndo').addEventListener('click', () => {
  undoLastAdd();
});

document.getElementById('logList').addEventListener('click', (ev) => {
  if (ev.target.closest('.btn-del') || ev.target.closest('.btn-edit')) return;
  if (!window.matchMedia('(max-width: 560px)').matches) return;
  const row = ev.target.closest('.log-item');
  if (!row || row.classList.contains('log-item--removed')) return;
  const id = row.getAttribute('data-entry-id');
  if (id) openEditEntry(id);
});

try {
  const lastH = localStorage.getItem('chorelog-household');
  const he = document.getElementById('loginHousehold');
  if (lastH && he) he.value = lastH;
  const rj = document.getElementById('regJoinHousehold');
  if (lastH && rj) rj.value = lastH;
} catch {
  /* ignore */
}

/** @type {{ household: string, password: string } | null} */
let pendingSignIn = null;
/** @type {{ household: string, password: string } | null} */
let pendingRegJoin = null;
/** @type {{ id: string, password: string } | null} */
let pendingRegCreate = null;

let registerInfoCache = null;

async function fetchRegisterInfo() {
  try {
    const r = await apiFetch('/api/register-info');
    if (!r.ok) throw new Error('bad');
    registerInfoCache = await r.json();
    return registerInfoCache;
  } catch {
    registerInfoCache = {
      openRegistration: false,
      hasMasterPassword: false,
      allowCreateHousehold: false,
    };
    return registerInfoCache;
  }
}

function syncRegisterFlowPanels(flow) {
  const createFields = document.getElementById('registerCreateFields');
  const joinFields = document.getElementById('registerJoinFields');
  const createPick = document.getElementById('registerCreateMemberPick');
  const isJoin = flow === 'join';
  resetRegisterJoinSteps();
  if (isJoin) {
    if (createFields) createFields.hidden = true;
    if (createPick) createPick.hidden = true;
    if (joinFields) joinFields.hidden = false;
    pendingRegCreate = null;
  } else {
    if (joinFields) joinFields.hidden = true;
    if (createPick) createPick.hidden = true;
    if (createFields) createFields.hidden = false;
  }
}

function resetRegisterJoinSteps() {
  const s1 = document.getElementById('registerJoinStep1');
  const s2 = document.getElementById('registerJoinStep2');
  if (s1) s1.hidden = false;
  if (s2) s2.hidden = true;
  pendingRegJoin = null;
}

function fillMemberSelect(selectEl, people) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = t('login.selectMemberPlaceholder');
  ph.disabled = true;
  ph.selected = true;
  selectEl.appendChild(ph);
  for (const name of people) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    selectEl.appendChild(o);
  }
}

async function fetchHouseholdMembers(household, password, guest = false) {
  const r = await apiFetch('/api/login/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ household, password, guest: !!guest }),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    const err = new Error('members');
    err.body = j;
    throw err;
  }
  return Array.isArray(j.people) ? j.people : [];
}

function setLoginSignInStep(step) {
  const s1 = document.getElementById('loginSignInStep1');
  const s2 = document.getElementById('loginSignInStep2');
  const d1 = document.getElementById('loginProgressDot1');
  const d2 = document.getElementById('loginProgressDot2');
  const line = document.getElementById('loginProgressLine');
  const prog = document.getElementById('loginSignInProgress');
  if (step === 2) {
    if (s1) s1.hidden = true;
    if (s2) s2.hidden = false;
    if (d1) {
      d1.classList.add('is-done');
      d1.removeAttribute('aria-current');
    }
    if (d2) {
      d2.classList.add('is-on');
      d2.setAttribute('aria-current', 'step');
    }
    if (line) line.classList.add('is-done');
    if (prog) prog.classList.add('login-progress--step2');
  } else {
    if (s1) s1.hidden = false;
    if (s2) s2.hidden = true;
    if (d1) {
      d1.classList.remove('is-done');
      d1.classList.add('is-on');
      d1.setAttribute('aria-current', 'step');
    }
    if (d2) {
      d2.classList.remove('is-on');
      d2.classList.remove('is-done');
      d2.removeAttribute('aria-current');
    }
    if (line) line.classList.remove('is-done');
    if (prog) prog.classList.remove('login-progress--step2');
    pendingSignIn = null;
  }
}

function resetSignInToStep1() {
  setLoginSignInStep(1);
}

function applyRegisterInfoToForm(info) {
  const createRadio = document.getElementById('registerFlowCreate');
  const joinRadio = document.getElementById('registerFlowJoin');
  const hint = document.getElementById('registerCreateDisabledHint');
  const masterWrap = document.getElementById('regMasterPasswordWrap');
  const flow = document.querySelector('input[name="registerFlow"]:checked')?.value || 'create';
  if (!info.allowCreateHousehold) {
    if (createRadio) createRadio.disabled = true;
    if (joinRadio) joinRadio.checked = true;
    if (hint) hint.hidden = false;
    syncRegisterFlowPanels('join');
  } else {
    if (createRadio) createRadio.disabled = false;
    if (hint) hint.hidden = true;
    const hasM = info.hasMasterPassword;
    if (masterWrap) {
      if (!hasM) masterWrap.hidden = true;
      else masterWrap.hidden = false;
    }
    syncRegisterFlowPanels(flow);
  }
}

async function completeLoginSession(household, username, password, opts = {}) {
  const errEl = document.getElementById('loginError');
  const r = await apiFetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ household, username, password, guest: !!opts.guest }),
  });
  if (!r.ok) {
    let msg = t('login.errorFailed');
    try {
      const j = await r.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    errEl.textContent = msg;
    errEl.hidden = false;
    return false;
  }
  let loginJson = null;
  try {
    loginJson = await r.json();
  } catch {
    /* ignore */
  }
  app.readOnly = !!loginJson?.readOnly;
  try {
    localStorage.setItem('chorelog-household', String(household).toLowerCase());
  } catch {
    /* ignore */
  }
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appShell').hidden = false;
  await startApp();
  return true;
}

async function submitLoginSignInStep1() {
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const household = document.getElementById('loginHousehold')?.value.trim().toLowerCase() || 'default';
  const password = document.getElementById('loginPass')?.value || '';
  if (!household) {
    errEl.textContent = t('login.householdIdRequired');
    errEl.hidden = false;
    return;
  }
  if (!password) {
    errEl.textContent = t('login.passwordRequired');
    errEl.hidden = false;
    return;
  }
  const guest = document.getElementById('loginGuestMode')?.checked;
  try {
    const people = await fetchHouseholdMembers(household, password, guest);
    pendingSignIn = { household, password, guest: !!guest };
    fillMemberSelect(document.getElementById('loginMemberSelect'), people);
    setLoginSignInStep(2);
  } catch (e) {
    let msg = t('login.errorFailed');
    if (e && e.body && typeof e.body.error === 'string') msg = e.body.error;
    errEl.textContent = msg;
    errEl.hidden = false;
  }
}

document.getElementById('btnLoginStep1Continue')?.addEventListener('click', () => {
  void submitLoginSignInStep1();
});

document.getElementById('btnLoginBack')?.addEventListener('click', () => {
  document.getElementById('loginError').hidden = true;
  resetSignInToStep1();
});

document.getElementById('loginFormSignIn')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const step2 = document.getElementById('loginSignInStep2');
  if (step2 && step2.hidden) {
    await submitLoginSignInStep1();
    return;
  }
  if (!pendingSignIn) {
    errEl.textContent = t('login.sessionExpired');
    errEl.hidden = false;
    resetSignInToStep1();
    return;
  }
  const username = document.getElementById('loginMemberSelect')?.value?.trim() || '';
  if (!username) {
    errEl.textContent = t('login.selectMemberRequired');
    errEl.hidden = false;
    return;
  }
  try {
    await completeLoginSession(pendingSignIn.household, username, pendingSignIn.password, {
      guest: pendingSignIn.guest,
    });
  } catch {
    errEl.textContent = t('login.errorServer');
    errEl.hidden = false;
  }
});

document.querySelectorAll('input[name="registerFlow"]').forEach((el) => {
  el.addEventListener('change', () => {
    const v = document.querySelector('input[name="registerFlow"]:checked')?.value;
    if (v) syncRegisterFlowPanels(v);
  });
});

document.getElementById('loginTabSignIn')?.addEventListener('click', () => {
  const signIn = document.getElementById('loginFormSignIn');
  const reg = document.getElementById('loginFormRegister');
  const t1 = document.getElementById('loginTabSignIn');
  const t2 = document.getElementById('loginTabRegister');
  if (signIn) signIn.hidden = false;
  if (reg) reg.hidden = true;
  if (t1) {
    t1.classList.add('is-active');
    t1.setAttribute('aria-selected', 'true');
  }
  if (t2) {
    t2.classList.remove('is-active');
    t2.setAttribute('aria-selected', 'false');
  }
  document.getElementById('loginError').hidden = true;
  resetSignInToStep1();
});

document.getElementById('loginTabRegister')?.addEventListener('click', async () => {
  const signIn = document.getElementById('loginFormSignIn');
  const reg = document.getElementById('loginFormRegister');
  const t1 = document.getElementById('loginTabSignIn');
  const t2 = document.getElementById('loginTabRegister');
  if (signIn) signIn.hidden = true;
  if (reg) reg.hidden = false;
  if (t1) {
    t1.classList.remove('is-active');
    t1.setAttribute('aria-selected', 'false');
  }
  if (t2) {
    t2.classList.add('is-active');
    t2.setAttribute('aria-selected', 'true');
  }
  registerInfoCache = null;
  pendingRegCreate = null;
  const info = await fetchRegisterInfo();
  applyRegisterInfoToForm(info);
  const flow = document.querySelector('input[name="registerFlow"]:checked')?.value || 'create';
  syncRegisterFlowPanels(flow);
});

document.getElementById('loginFormRegister')?.addEventListener('submit', (e) => {
  e.preventDefault();
});

document.getElementById('btnRegisterJoinContinue')?.addEventListener('click', async () => {
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const householdRaw = document.getElementById('regJoinHousehold')?.value.trim().toLowerCase() || '';
  const password = document.getElementById('regJoinPassword')?.value || '';
  if (!householdRaw) {
    errEl.textContent = t('login.householdIdRequired');
    errEl.hidden = false;
    return;
  }
  if (!password) {
    errEl.textContent = t('login.passwordRequired');
    errEl.hidden = false;
    return;
  }
  try {
    const people = await fetchHouseholdMembers(householdRaw, password);
    pendingRegJoin = { household: householdRaw, password };
    fillMemberSelect(document.getElementById('regJoinMemberSelect'), people);
    document.getElementById('registerJoinStep1').hidden = true;
    document.getElementById('registerJoinStep2').hidden = false;
  } catch (e) {
    let msg = t('login.errorFailed');
    if (e && e.body && typeof e.body.error === 'string') msg = e.body.error;
    errEl.textContent = msg;
    errEl.hidden = false;
  }
});

document.getElementById('btnRegisterJoinBack')?.addEventListener('click', () => {
  document.getElementById('loginError').hidden = true;
  resetRegisterJoinSteps();
});

document.getElementById('btnRegisterJoinDone')?.addEventListener('click', async () => {
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const username = document.getElementById('regJoinMemberSelect')?.value?.trim() || '';
  if (!username) {
    errEl.textContent = t('login.selectMemberRequired');
    errEl.hidden = false;
    return;
  }
  if (!pendingRegJoin) {
    errEl.textContent = t('login.sessionExpired');
    errEl.hidden = false;
    resetRegisterJoinSteps();
    return;
  }
  try {
    await completeLoginSession(pendingRegJoin.household, username, pendingRegJoin.password);
  } catch {
    errEl.textContent = t('login.errorServer');
    errEl.hidden = false;
  }
});

document.getElementById('btnRegisterCreateContinue')?.addEventListener('click', async () => {
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const info = await fetchRegisterInfo();
  if (!info.allowCreateHousehold) {
    errEl.textContent = t('login.registerCreateDisabled');
    errEl.hidden = false;
    return;
  }
  const idRaw = document.getElementById('regCreateHouseholdId')?.value.trim().toLowerCase() || '';
  const pw = document.getElementById('regCreatePassword')?.value || '';
  const pw2 = document.getElementById('regCreatePassword2')?.value || '';
  const master = document.getElementById('regMasterPassword')?.value || '';
  if (!idRaw) {
    errEl.textContent = t('login.newHouseholdIdRequired');
    errEl.hidden = false;
    return;
  }
  if (pw !== pw2) {
    errEl.textContent = t('settings.accountPasswordMismatch');
    errEl.hidden = false;
    return;
  }
  if (pw.length < 8) {
    errEl.textContent = t('settings.accountPasswordTooShort');
    errEl.hidden = false;
    return;
  }
  if (!info.openRegistration && info.hasMasterPassword && !master) {
    errEl.textContent = t('login.masterPasswordRequired');
    errEl.hidden = false;
    return;
  }
  const body = { id: idRaw, password: pw };
  if (info.openRegistration && !info.hasMasterPassword) {
    /* no master */
  } else if (!info.openRegistration && info.hasMasterPassword) {
    body.masterPassword = master;
  } else if (info.openRegistration && info.hasMasterPassword && master) {
    body.masterPassword = master;
  }
  try {
    const r = await apiFetch('/api/households', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = t('settings.accountCreateErr');
      try {
        const j = await r.json();
        if (j && j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      errEl.textContent = msg;
      errEl.hidden = false;
      return;
    }
    pendingRegCreate = { id: idRaw, password: pw };
    const people = await fetchHouseholdMembers(idRaw, pw);
    document.getElementById('registerCreateFields').hidden = true;
    document.getElementById('registerCreateMemberPick').hidden = false;
    fillMemberSelect(document.getElementById('regCreateMemberSelect'), people);
  } catch (e) {
    let msg = t('login.errorServer');
    if (e && e.body && typeof e.body.error === 'string') msg = e.body.error;
    errEl.textContent = msg;
    errEl.hidden = false;
  }
});

document.getElementById('btnRegisterCreateDone')?.addEventListener('click', async () => {
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const username = document.getElementById('regCreateMemberSelect')?.value?.trim() || '';
  if (!username) {
    errEl.textContent = t('login.selectMemberRequired');
    errEl.hidden = false;
    return;
  }
  if (!pendingRegCreate) {
    errEl.textContent = t('login.sessionExpired');
    errEl.hidden = false;
    return;
  }
  try {
    await completeLoginSession(pendingRegCreate.id, username, pendingRegCreate.password);
  } catch {
    errEl.textContent = t('login.errorServer');
    errEl.hidden = false;
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch {
    /* still show login */
  }
  app.readOnly = false;
  document.getElementById('settingsDialog').close();
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appShell').hidden = true;
  const signIn = document.getElementById('loginFormSignIn');
  const reg = document.getElementById('loginFormRegister');
  const t1 = document.getElementById('loginTabSignIn');
  const t2 = document.getElementById('loginTabRegister');
  if (signIn) signIn.hidden = false;
  if (reg) reg.hidden = true;
  if (t1) {
    t1.classList.add('is-active');
    t1.setAttribute('aria-selected', 'true');
  }
  if (t2) {
    t2.classList.remove('is-active');
    t2.setAttribute('aria-selected', 'false');
  }
  resetSignInToStep1();
});

async function restoreLogEntry(id) {
  if (blockReadOnlyAction()) return;
  if (!id) return;
  try {
    const r = await apiFetch(`/api/entries/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    if (!r.ok) throw new Error('restore failed');
    await load();
    render();
  } catch {
    app.loadError = t('errors.restoreEntry');
    render();
  }
}

window.addEntry = addEntry;
window.openEditEntry = openEditEntry;
window.delEntry = delEntry;
window.restoreLogEntry = restoreLogEntry;
window.quickLogChore = quickLogChore;
window.markScheduledDone = markScheduledDone;
window.deleteScheduledChore = deleteScheduledChore;
window.saveScheduledStartDate = saveScheduledStartDate;
window.setScheduledReminderEnabled = setScheduledReminderEnabled;

subscribeLocale(() => {
  applyStaticDom(document.body);
  fillTranslatedSelectOptions();
  syncScheduledRecurrenceUi();
  void refreshPushNotificationsPanel();
  syncSettingsLocaleSelect();
  const navOpen = document.getElementById('settingsNav')?.classList.contains('is-open');
  const toggle = document.getElementById('settingsNavToggle');
  if (toggle) {
    toggle.setAttribute('aria-label', navOpen ? t('settings.navClose') : t('settings.navOpen'));
  }
  const shell = document.getElementById('appShell');
  if (shell && !shell.hidden) {
    render();
    renderPeopleEditor();
    renderLocationsEditor();
    renderChorePresetsEditor();
    renderQuickChoresEditor();
    renderScheduledManageList();
    syncDiscordWebhookForm();
    void refreshPushNotificationsPanel();
  }
  const aboutPanel = document.getElementById('settingsPanelAbout');
  if (aboutPanel && !aboutPanel.hidden) {
    void loadAboutPanel();
  }
  const accountPanel = document.getElementById('settingsPanelAccount');
  if (accountPanel && !accountPanel.hidden) {
    void loadAccountPanel();
  }
  syncAdministrationNavVisibility();
  const adminPanel = document.getElementById('settingsPanelAdministration');
  if (adminPanel && !adminPanel.hidden) {
    void loadAdministrationPanel();
  }
});

fillTranslatedSelectOptions();
syncScheduledRecurrenceUi();
syncSettingsLocaleSelect();

initSettingsShell();
initAdministrationPanel();

async function initLoginGuestUi() {
  try {
    const r = await apiFetch('/api/register-info');
    if (r.ok) {
      const info = await r.json();
      const wrap = document.getElementById('loginGuestModeWrap');
      if (wrap && info.guestLoginEnabled) wrap.hidden = false;
    }
  } catch {
    /* ignore */
  }
  const guestCb = document.getElementById('loginGuestMode');
  const passLabel = document.getElementById('loginPassLabel');
  if (guestCb && passLabel) {
    guestCb.addEventListener('change', () => {
      passLabel.textContent = guestCb.checked ? t('login.guestPassword') : t('login.password');
    });
  }
}

document.getElementById('btnGuestLogout')?.addEventListener('click', async () => {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  app.readOnly = false;
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appShell').hidden = true;
  resetSignInToStep1();
});

void initLoginGuestUi().then(() => bootstrap());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
