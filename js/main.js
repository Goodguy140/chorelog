import { apiFetch } from './api-fetch.js';
import { render } from './render-registry.js';
import { switchMonth } from './render.js';
import {
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
import { escapeHtml } from './utils/html.js';
import { intervalLabel, scheduledStatus } from './scheduled-logic.js';
import { initChoreInputSuggest } from './chore-input-suggest.js';

function syncThemeMeta() {
  const el = document.getElementById('metaThemeColor');
  if (!el) return;
  const mode = document.documentElement.getAttribute('data-theme');
  let dark = false;
  if (mode === 'dark') dark = true;
  else if (mode === 'light') dark = false;
  else dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  el.content = dark ? '#1e1e1c' : '#1a1a18';
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

function renderPeopleEditor() {
  const ul = document.getElementById('peopleList');
  ul.innerHTML = app.people
    .map(
      (p, idx) => `
    <li>
      <span>${escapeHtml(p)}</span>
      <button type="button" data-remove="${idx}" ${app.people.length <= 1 ? 'disabled' : ''}>Remove</button>
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
      <button type="button" data-remove-location="${idx}" ${app.locations.length <= 1 ? 'disabled' : ''}>Remove</button>
    </li>
  `,
    )
    .join('');
  ul.querySelectorAll('button[data-remove-location]').forEach((btn) => {
    btn.addEventListener('click', () => removeLocationAt(Number(btn.getAttribute('data-remove-location'))));
  });
}

async function savePeopleList(next) {
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
    app.loadError = 'Could not save people list.';
    render();
  }
}

async function removePersonAt(index) {
  if (app.people.length <= 1) return;
  const next = app.people.filter((_, i) => i !== index);
  try {
    await savePeopleList(next);
  } catch (e) {
    app.loadError = 'Could not save people list.';
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
    app.loadError = 'Could not save locations.';
    render();
  }
}

async function removeLocationAt(index) {
  if (app.locations.length <= 1) return;
  const next = app.locations.filter((_, i) => i !== index);
  try {
    await saveLocationsList(next);
  } catch {
    app.loadError = 'Could not save locations.';
    render();
  }
}

async function load() {
  app.loadError = null;
  try {
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
    syncPersonSelect();
    syncLocationSelect();
    syncChoreDatalists();
  } catch (e) {
    app.entries = [];
    app.people = [...DEFAULT_PEOPLE];
    app.locations = [...DEFAULT_LOCATIONS];
    app.chorePresets = [];
    app.quickChoreIds = [];
    app.scheduledChores = [];
    syncPersonSelect();
    syncLocationSelect();
    syncChoreDatalists();
    app.loadError =
      'Could not load chores from the server. Run `npm start` and open this page from the app URL (not file://).';
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
  msg.textContent = n === 1 ? 'Chore logged.' : `${n} chores logged.`;
  toast.hidden = false;
  toast.removeAttribute('aria-hidden');
  app.addToastHideTimer = setTimeout(() => {
    hideAddToast();
  }, 6500);
}

async function undoLastAdd() {
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
    app.loadError = 'Could not undo.';
    render();
  }
}

async function addEntry() {
  const d = document.getElementById('inDate').value;
  const raw = document.getElementById('inChore').value.trim();
  const p = document.getElementById('inPerson').value;
  const selectedLocations = [...document.querySelectorAll('#inLocations option:checked')].map((o) => o.value);
  if (!d || !raw) return;
  const resolved = resolveChorePayloadRows(raw);
  if (!resolved.ok) {
    app.loadError = resolved.reason === 'empty' ? 'Choose a chore from your presets.' : resolved.reason;
    render();
    return;
  }
  const rows = [];
  for (const row of resolved.rows) {
    const preset = presetById(row.choreId);
    if (preset && preset.scoringMode === 'per_location') {
      if (!selectedLocations.length) {
        app.loadError = `Select at least one location for "${preset.title}".`;
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
    render();
    showAddToast(addedEntries);
  } catch (e) {
    app.loadError = 'Could not save chore. Is the server running?';
    render();
  }
}

function fillChoreFromPreset(presetId) {
  const preset = presetById(presetId);
  if (!preset) return false;
  const el = document.getElementById('inChore');
  if (el) el.value = preset.title;
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
  if (!e) return;
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
  const id = app.pendingDeleteEntryId;
  if (!id) return;
  document.getElementById('deleteEntryDialog').close();
  try {
    const r = await apiFetch(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error('delete failed');
    await load();
    render();
  } catch (e) {
    app.loadError = 'Could not delete entry. Is the server running?';
    render();
  }
}

function renderScheduledManageList() {
  const ul = document.getElementById('scheduledManageList');
  if (!ul) return;
  if (!app.scheduledChores.length) {
    ul.innerHTML = '<li style="color:var(--color-text-tertiary);font-size:13px;">No scheduled chores yet.</li>';
    return;
  }
  ul.innerHTML = app.scheduledChores
    .map((s) => {
      const st = scheduledStatus(s);
      const safeId = String(s.id).replace(/'/g, "\\'");
      return `<li>
  <span>${escapeHtml(s.title)} · ${intervalLabel(s.intervalDays)} · <span class="scheduled-status ${st.cls}" style="display:inline;padding:2px 8px;">${st.label}</span></span>
  <div class="scheduled-manage-actions">
    <button type="button" onclick="markScheduledDone('${safeId}')">Mark done</button>
    <button type="button" class="scheduled-btn-danger" onclick="deleteScheduledChore('${safeId}')">Remove</button>
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
  fillScheduledDonePersonSelect();
  document.getElementById('scheduledDoneDialog').showModal();
}

async function confirmScheduledComplete() {
  const id = app.pendingScheduledCompleteId;
  const person = document.getElementById('scheduledDonePerson').value.trim();
  if (!id || !person) return;
  try {
    const r = await apiFetch(`/api/scheduled-chores/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person, completedDate: localDateISO() }),
    });
    if (!r.ok) throw new Error();
    document.getElementById('scheduledDoneDialog').close();
    await load();
    render();
    renderScheduledManageList();
  } catch {
    app.loadError = 'Could not complete scheduled chore.';
    render();
  }
}

function markScheduledDone(id) {
  openScheduledCompleteDialog(id);
}

async function deleteScheduledChore(id) {
  if (!confirm('Remove this scheduled chore?')) return;
  try {
    const r = await apiFetch(`/api/scheduled-chores/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error();
    await load();
    render();
    renderScheduledManageList();
  } catch {
    app.loadError = 'Could not delete scheduled chore.';
    render();
  }
}

function openScheduledDialog() {
  renderScheduledManageList();
  document.getElementById('scheduledDialog').showModal();
}

function startApp() {
  document.getElementById('inDate').value = localDateISO();
  return load().then(() => {
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
    document.getElementById('loginScreen').hidden = true;
    document.getElementById('appShell').hidden = false;
    await startApp();
  } catch {
    document.getElementById('loginScreen').hidden = false;
    document.getElementById('appShell').hidden = true;
  }
}

applyTheme(localStorage.getItem('chorelog-theme') || 'system');
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (document.documentElement.getAttribute('data-theme') === 'system') syncThemeMeta();
});

document.getElementById('themeOptions').addEventListener('change', (e) => {
  const t = e.target;
  if (t && t.name === 'theme' && t.checked) applyTheme(t.value);
});

document.getElementById('btnSettings').addEventListener('click', () => {
  renderPeopleEditor();
  renderLocationsEditor();
  renderChorePresetsEditor();
  renderQuickChoresEditor();
  const mode = localStorage.getItem('chorelog-theme') || 'system';
  document.querySelectorAll('#themeOptions input[name="theme"]').forEach((el) => {
    el.checked = el.value === mode;
  });
  document.getElementById('settingsDialog').showModal();
});

document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsDialog').close();
});

document.getElementById('settingsDialog').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsDialog')) e.target.close();
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
    alert('Export failed.');
  }
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const input = e.target;
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  let data;
  try {
    data = JSON.parse(await f.text());
  } catch {
    alert('Invalid JSON file.');
    return;
  }
  const merge = confirm(
    'Merge with existing data on the server?\n\n' +
      'OK = Merge (append imported entries; combine people lists).\n' +
      'Cancel = Replace all server data with this file.',
  );
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
    app.loadError = 'Import failed.';
    render();
  }
});

document.getElementById('btnScheduled').addEventListener('click', openScheduledDialog);
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
        app.loadError = `Select at least one location for "${preset.title}".`;
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
    app.loadError = 'Could not update entry.';
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
  const title = document.getElementById('scheduledNewTitle').value.trim();
  const intervalDays = Number(document.getElementById('scheduledNewInterval').value);
  if (!title) return;
  try {
    const r = await apiFetch('/api/scheduled-chores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, intervalDays, startsOn: localDateISO() }),
    });
    if (!r.ok) throw new Error();
    await load();
    document.getElementById('scheduledNewTitle').value = '';
    render();
    renderScheduledManageList();
  } catch {
    alert('Could not add scheduled chore.');
  }
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

document.getElementById('chorePresetsList').addEventListener('change', async () => {
  const next = readChorePresetsFromDom();
  if (next.length) {
    app.chorePresets = next;
    await saveChorePresetsAndQuick();
  }
});

document.getElementById('chorePresetsList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.chore-preset-remove');
  if (!btn) return;
  const id = btn.getAttribute('data-remove');
  app.chorePresets = app.chorePresets.filter((p) => p.id !== id);
  app.quickChoreIds = app.quickChoreIds.filter((q) => q !== id);
  renderChorePresetsEditor();
  renderQuickChoresEditor();
  await saveChorePresetsAndQuick();
});

document.getElementById('btnAddChorePreset').addEventListener('click', async () => {
  const id = crypto.randomUUID();
  app.chorePresets.push({ id, title: 'New chore', points: 1, color: '#378ADD', scoringMode: 'flat' });
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

initQuickChores();
initScheduledLogSuggestions();
initChoreInputSuggest();

document.getElementById('addToastUndo').addEventListener('click', () => {
  undoLastAdd();
});

document.getElementById('logList').addEventListener('click', (ev) => {
  if (ev.target.closest('.btn-del') || ev.target.closest('.btn-edit')) return;
  if (!window.matchMedia('(max-width: 560px)').matches) return;
  const row = ev.target.closest('.log-item');
  if (!row) return;
  const id = row.getAttribute('data-entry-id');
  if (id) openEditEntry(id);
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  try {
    const r = await apiFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      let msg = 'Sign in failed.';
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
    document.getElementById('loginScreen').hidden = true;
    document.getElementById('appShell').hidden = false;
    await startApp();
  } catch {
    errEl.textContent = 'Could not reach server.';
    errEl.hidden = false;
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch {
    /* still show login */
  }
  document.getElementById('settingsDialog').close();
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appShell').hidden = true;
});

window.addEntry = addEntry;
window.openEditEntry = openEditEntry;
window.delEntry = delEntry;
window.quickLogChore = quickLogChore;
window.markScheduledDone = markScheduledDone;
window.deleteScheduledChore = deleteScheduledChore;

bootstrap();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
