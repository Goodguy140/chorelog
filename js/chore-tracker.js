const DEFAULT_PEOPLE = ['Dylan', 'Rachel', 'Vic', 'Christian'];
const PALETTE = [
  { bar: '#378ADD', text: '#E6F1FB' },
  { bar: '#D85A30', text: '#FAECE7' },
  { bar: '#7F77DD', text: '#EEEDFE' },
  { bar: '#1D9E75', text: '#E1F5EE' },
  { bar: '#C973D9', text: '#F8EEFB' },
  { bar: '#D8A530', text: '#FAF4E7' },
  { bar: '#2DB3A8', text: '#E3F8F6' },
  { bar: '#B85A6E', text: '#F8EEF0' },
];

let people = [...DEFAULT_PEOPLE];
let entries = [];
let scheduledChores = [];
let loadError = null;
let pendingScheduledCompleteId = null;

function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Next due date: lastCompleted + interval, or created + interval if never completed. */
function nextDueDate(s) {
  const anchor = s.lastCompletedAt || s.createdAt;
  return addDays(anchor, s.intervalDays);
}

function scheduledStatus(s) {
  const next = nextDueDate(s);
  const today = new Date().toISOString().slice(0, 10);
  if (next < today) {
    const daysPast = Math.floor((new Date(today + 'T12:00:00') - new Date(next + 'T12:00:00')) / 864e5);
    return { next, label: `${daysPast} day${daysPast === 1 ? '' : 's'} overdue`, cls: 'overdue' };
  }
  if (next === today) {
    return { next, label: 'Due today', cls: 'today' };
  }
  const daysUntil = Math.floor((new Date(next + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5);
  if (daysUntil <= 3) {
    return { next, label: `Due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`, cls: 'soon' };
  }
  return {
    next,
    label: `Due ${new Date(next + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
    cls: 'later',
  };
}

function intervalLabel(days) {
  const d = Number(days);
  if (d === 1) return 'daily';
  if (d === 7) return 'weekly';
  if (d === 14) return 'every 2 weeks';
  if (d === 30) return '~monthly';
  if (d === 60) return '~every 2 months';
  if (d === 90) return '~every 3 months';
  return `every ${d} days`;
}

function colorFor(name) {
  const i = people.indexOf(name);
  if (i === -1) return { bar: '#888', text: '#fff' };
  return PALETTE[i % PALETTE.length];
}

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
  people.forEach((p) => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPeopleEditor() {
  const ul = document.getElementById('peopleList');
  ul.innerHTML = people.map((p, idx) => `
    <li>
      <span>${escapeHtml(p)}</span>
      <button type="button" data-remove="${idx}" ${people.length <= 1 ? 'disabled' : ''}>Remove</button>
    </li>
  `).join('');
  ul.querySelectorAll('button[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => removePersonAt(Number(btn.getAttribute('data-remove'))));
  });
}

async function savePeopleList(next) {
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ people: next }),
  });
  if (!r.ok) throw new Error('save failed');
  const data = await r.json();
  people = Array.isArray(data.people) ? data.people : next;
  syncPersonSelect();
  renderPeopleEditor();
  render();
}

async function addPerson() {
  const input = document.getElementById('newPersonName');
  const name = input.value.trim();
  if (!name) return;
  if (people.includes(name)) {
    input.value = '';
    return;
  }
  try {
    await savePeopleList([...people, name]);
    input.value = '';
  } catch (e) {
    loadError = 'Could not save people list.';
    render();
  }
}

async function removePersonAt(index) {
  if (people.length <= 1) return;
  const next = people.filter((_, i) => i !== index);
  try {
    await savePeopleList(next);
  } catch (e) {
    loadError = 'Could not save people list.';
    render();
  }
}

async function load() {
  loadError = null;
  try {
    const r = await fetch('/api/entries');
    if (!r.ok) throw new Error('Bad response');
    const data = await r.json();
    entries = Array.isArray(data.entries) ? data.entries : [];
    people = Array.isArray(data.people) && data.people.length ? data.people : [...DEFAULT_PEOPLE];
    scheduledChores = Array.isArray(data.scheduledChores) ? data.scheduledChores : [];
    syncPersonSelect();
  } catch (e) {
    entries = [];
    people = [...DEFAULT_PEOPLE];
    scheduledChores = [];
    syncPersonSelect();
    loadError = 'Could not load chores from the server. Run `npm start` and open this page from the app URL (not file://).';
  }
}

function getMonthKey(d) { return d.slice(0, 7); }
function getMonthLabel(k) {
  const [y, m] = k.split('-');
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
}

function thisCalendarMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

let currentMonth = thisCalendarMonthKey();

function getMonths() {
  return [...new Set(entries.map(e => getMonthKey(e.d)))].sort().reverse();
}

function countsByPerson(monthKey) {
  const c = {};
  people.forEach(p => { c[p] = 0; });
  entries.filter(e => getMonthKey(e.d) === monthKey).forEach(e => {
    if (c[e.p] !== undefined) c[e.p]++;
  });
  return c;
}

function render() {
  const errEl = document.getElementById('loadError');
  if (loadError) {
    errEl.textContent = loadError;
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }

  const months = getMonths();
  if (!months.includes(currentMonth) && months.length) currentMonth = months[0];
  const monthOptions = months.length ? months : [currentMonth];

  const monthSelect = document.getElementById('monthSelect');
  monthSelect.innerHTML = monthOptions
    .map((m) => `<option value="${m}">${getMonthLabel(m)}</option>`)
    .join('');
  if (monthOptions.includes(currentMonth)) monthSelect.value = currentMonth;
  else if (monthOptions.length) monthSelect.value = monthOptions[0];

  const cur = countsByPerson(currentMonth);
  const total = Object.values(cur).reduce((a, b) => a + b, 0);
  const topPerson = people.reduce((a, b) => cur[a] >= cur[b] ? a : b);
  const activeDays = new Set(entries.filter(e => getMonthKey(e.d) === currentMonth).map(e => e.d)).size;

  document.getElementById('statsGrid').innerHTML = `
<div class="stat-card"><p class="stat-label">Total tasks</p><p class="stat-val">${total}</p><p class="stat-sub">${getMonthLabel(currentMonth)}</p></div>
<div class="stat-card"><p class="stat-label">Most active</p><p class="stat-val" style="font-size:15px;">${topPerson}</p><p class="stat-sub">${cur[topPerson]} tasks</p></div>
<div class="stat-card"><p class="stat-label">Active days</p><p class="stat-val">${activeDays}</p><p class="stat-sub">days with chores</p></div>
<div class="stat-card"><p class="stat-label">Members</p><p class="stat-val">${people.filter(p => cur[p] > 0).length}</p><p class="stat-sub">contributed</p></div>
  `;

  const max = Math.max(...Object.values(cur), 1);
  const sorted = [...people].sort((a, b) => cur[b] - cur[a]);
  document.getElementById('barsArea').innerHTML = sorted.map(p => {
    const pct = Math.round((cur[p] / max) * 100);
    const col = colorFor(p);
    return `<div class="person-row">
  <span class="person-label">${p}</span>
  <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${col.bar};color:${col.text};">${cur[p] > 2 ? cur[p] + ' tasks' : ''}</div></div>
  <span class="count-num">${cur[p]}</span>
</div>`;
  }).join('');

  document.getElementById('logMonthLabel').textContent = getMonthLabel(currentMonth);
  const monthEntries = entries.filter(e => getMonthKey(e.d) === currentMonth).sort((a, b) => b.d.localeCompare(a.d));
  const logList = document.getElementById('logList');
  if (!monthEntries.length) {
    logList.innerHTML = '<p class="empty">No entries yet this month.</p>';
  } else {
    logList.innerHTML = monthEntries.map(e => {
      const col = colorFor(e.p);
      const [, m, d] = e.d.split('-');
      const safeId = String(e.id).replace(/'/g, "\\'");
      return `<div class="log-item">
    <span class="log-date">${m}/${d}</span>
    <span class="log-chore">${e.c}</span>
    <span class="log-person" style="background:${col.bar};color:${col.text};">${e.p}</span>
    <button class="btn-del" onclick="delEntry('${safeId}')">×</button>
  </div>`;
    }).join('');
  }

  const allMonths = getMonths();
  const prevMonth = allMonths[allMonths.indexOf(currentMonth) + 1];
  const prev = prevMonth ? countsByPerson(prevMonth) : null;
  const momGrid = document.getElementById('momGrid');
  if (prev) {
    momGrid.innerHTML = people.map(p => {
      const diff = cur[p] - prev[p];
      const pct = prev[p] > 0 ? Math.round(Math.abs(diff) / prev[p] * 100) : null;
      const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '';
      const label = pct !== null ? `${arrow} ${pct}% vs ${getMonthLabel(prevMonth)}` : (diff === 0 ? 'No change' : 'New data');
      return `<div><p class="mom-name">${p}</p><p class="mom-val">${prev[p]} → ${cur[p]}</p><p class="mom-delta ${cls}" style="font-size:12px;margin-top:3px;">${label}</p></div>`;
    }).join('');
  } else {
    momGrid.innerHTML = '<p style="font-size:13px;color:var(--color-text-tertiary);grid-column:1/-1;">No previous month to compare.</p>';
  }

  const section = document.getElementById('scheduledSection');
  const dash = document.getElementById('scheduledDashboard');
  if (!scheduledChores.length) {
    section.style.display = 'none';
  } else {
    section.style.display = 'block';
    dash.innerHTML = scheduledChores
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
}

function switchMonth(m) { currentMonth = m; render(); }

async function addEntry() {
  const d = document.getElementById('inDate').value;
  const raw = document.getElementById('inChore').value.trim();
  const p = document.getElementById('inPerson').value;
  if (!d || !raw) return;
  const rows = raw.split(';').map(s => s.trim()).filter(Boolean).map(c => ({ d, c, p }));
  try {
    const r = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: rows }),
    });
    if (!r.ok) throw new Error('save failed');
    await load();
    currentMonth = getMonthKey(d);
    document.getElementById('inChore').value = '';
    render();
  } catch (e) {
    loadError = 'Could not save chore. Is the server running?';
    render();
  }
}

async function delEntry(id) {
  try {
    const r = await fetch('/api/entries/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error('delete failed');
    await load();
    render();
  } catch (e) {
    loadError = 'Could not delete entry. Is the server running?';
    render();
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

document.getElementById('btnExport').addEventListener('click', async () => {
  try {
    const r = await fetch('/api/export');
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
      'Cancel = Replace all server data with this file.'
  );
  try {
    const r = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        people: data.people,
        entries: data.entries,
        scheduledChores: data.scheduledChores,
        mode: merge ? 'merge' : 'replace',
      }),
    });
    if (!r.ok) throw new Error();
    await load();
    renderPeopleEditor();
    render();
    renderScheduledManageList();
  } catch {
    loadError = 'Import failed.';
    render();
  }
});

function renderScheduledManageList() {
  const ul = document.getElementById('scheduledManageList');
  if (!ul) return;
  if (!scheduledChores.length) {
    ul.innerHTML = '<li style="color:var(--color-text-tertiary);font-size:13px;">No scheduled chores yet.</li>';
    return;
  }
  ul.innerHTML = scheduledChores
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
  people.forEach((p) => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function openScheduledCompleteDialog(id) {
  const s = scheduledChores.find((x) => x.id === id);
  if (!s) return;
  pendingScheduledCompleteId = id;
  document.getElementById('scheduledDoneChoreTitle').textContent = s.title;
  fillScheduledDonePersonSelect();
  document.getElementById('scheduledDoneDialog').showModal();
}

async function confirmScheduledComplete() {
  const id = pendingScheduledCompleteId;
  const person = document.getElementById('scheduledDonePerson').value.trim();
  if (!id || !person) return;
  try {
    const r = await fetch(`/api/scheduled-chores/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person }),
    });
    if (!r.ok) throw new Error();
    document.getElementById('scheduledDoneDialog').close();
    await load();
    render();
    renderScheduledManageList();
  } catch {
    loadError = 'Could not complete scheduled chore.';
    render();
  }
}

function markScheduledDone(id) {
  openScheduledCompleteDialog(id);
}

async function deleteScheduledChore(id) {
  if (!confirm('Remove this scheduled chore?')) return;
  try {
    const r = await fetch(`/api/scheduled-chores/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error();
    await load();
    render();
    renderScheduledManageList();
  } catch {
    loadError = 'Could not delete scheduled chore.';
    render();
  }
}

window.markScheduledDone = markScheduledDone;
window.deleteScheduledChore = deleteScheduledChore;

function openScheduledDialog() {
  renderScheduledManageList();
  document.getElementById('scheduledDialog').showModal();
}

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
  pendingScheduledCompleteId = null;
});

document.getElementById('addScheduledForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('scheduledNewTitle').value.trim();
  const intervalDays = Number(document.getElementById('scheduledNewInterval').value);
  if (!title) return;
  try {
    const r = await fetch('/api/scheduled-chores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, intervalDays }),
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

document.getElementById('inDate').value = new Date().toISOString().slice(0, 10);
load().then(() => {
  const months = getMonths();
  if (months.length) currentMonth = months[0];
  else currentMonth = thisCalendarMonthKey();
  render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
