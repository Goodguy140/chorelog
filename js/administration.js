import { apiFetch } from './api-fetch.js';
import { t } from './i18n.js';
import { app } from './state.js';
import { escapeHtml } from './utils/html.js';
import { refreshPushNotificationsPanel } from './push-notifications.js';

export function administrationTabVisible() {
  const a = app.account;
  if (!a) return false;
  if (typeof a.browserPushAllowed === 'boolean') return a.browserPushAllowed;
  return String(a.household || '').trim() === 'default';
}

export function syncAdministrationNavVisibility() {
  const tabBtn = document.getElementById('settingsTabAdministration');
  const panel = document.getElementById('settingsPanelAdministration');
  const on = administrationTabVisible();
  if (tabBtn) tabBtn.hidden = !on;
  if (panel && !on) {
    panel.hidden = true;
    panel.classList.remove('is-active');
  }
}

function setAdminVapidStatus(msg, isError) {
  const el = document.getElementById('adminVapidStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  el.style.color = isError ? '#E24B4A' : '';
}

function setAdminBackupStatus(msg, isError) {
  const el = document.getElementById('adminBackupStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  el.style.color = isError ? '#E24B4A' : '';
}

function yn(v) {
  return v ? t('settings.adminYes') : t('settings.adminNo');
}

function formatScheduledBackupMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return t('settings.adminScheduledBackupOff');
  const hours = n / 3600000;
  const hStr = hours % 1 === 0 ? String(Math.round(hours)) : hours.toFixed(1);
  return t('settings.adminScheduledBackupEvery', { hours: hStr });
}

async function loadAdminOverview() {
  const dl = document.getElementById('adminOverviewDl');
  const errEl = document.getElementById('adminOverviewError');
  if (!dl || !errEl) return;
  errEl.hidden = true;
  dl.innerHTML = '';
  if (!administrationTabVisible()) return;
  try {
    const r = await apiFetch('/api/admin/overview');
    if (!r.ok) throw new Error('bad status');
    const d = await r.json();
    const ids = Array.isArray(d.householdIds) ? d.householdIds : [];
    const idLine = ids.length
      ? `<span class="admin-overview-household-ids">${ids.map((x) => escapeHtml(String(x))).join(', ')}</span>`
      : '—';
    const rows = [
      [t('settings.adminDlHouseholdCount'), String(d.householdCount != null ? d.householdCount : ids.length), false],
      [t('settings.adminDlHouseholdIds'), idLine, true],
      [t('settings.adminDlOpenRegistration'), yn(d.openRegistration), false],
      [t('settings.adminDlGuestLogin'), yn(d.guestLoginEnabled), false],
      [t('settings.adminDlMasterPassword'), yn(d.hasMasterPassword), false],
      [t('settings.adminDlImportBackup'), yn(d.importBackupOnReplace), false],
      [t('settings.adminDlBackupRetention'), String(d.backupRetention != null ? d.backupRetention : '—'), false],
      [t('settings.adminDlScheduledBackup'), formatScheduledBackupMs(d.scheduledBackupIntervalMs), false],
      [t('settings.adminDlSqlite'), yn(d.sqlitePerHousehold), false],
    ];
    dl.innerHTML = rows
      .map(([label, val, rawHtml]) => {
        const dd = rawHtml ? val : escapeHtml(val);
        return `<dt>${escapeHtml(label)}</dt><dd>${dd}</dd>`;
      })
      .join('');
  } catch {
    errEl.textContent = t('settings.adminOverviewLoadErr');
    errEl.hidden = false;
  }
}

export async function loadAdministrationPanel() {
  setAdminVapidStatus('', false);
  setAdminBackupStatus('', false);
  const bootEl = document.getElementById('adminVapidBootHint');
  const pub = document.getElementById('adminVapidPublic');
  const priv = document.getElementById('adminVapidPrivate');
  const subj = document.getElementById('adminVapidSubject');
  const backupBtn = document.getElementById('btnAdminBackup');
  if (backupBtn) backupBtn.disabled = Boolean(app.readOnly);
  void loadAdminOverview();
  if (!administrationTabVisible() || !pub || !priv || !subj) return;
  try {
    const r = await apiFetch('/api/admin/vapid');
    if (!r.ok) {
      setAdminVapidStatus(t('settings.adminVapidSaveErr'), true);
      if (bootEl) bootEl.hidden = true;
      return;
    }
    const d = await r.json();
    pub.value = typeof d.publicKey === 'string' ? d.publicKey : '';
    priv.value = typeof d.privateKey === 'string' ? d.privateKey : '';
    subj.value = typeof d.subject === 'string' ? d.subject : '';
    const p = typeof d.persistRelativePath === 'string' ? d.persistRelativePath : 'data/vapid-keys.env';
    if (bootEl) {
      if (d.bootSource === 'environment') {
        bootEl.textContent = t('settings.adminVapidBootEnv', { path: p });
        bootEl.hidden = false;
      } else if (d.bootSource === 'file') {
        bootEl.textContent = t('settings.adminVapidBootFile', { path: p });
        bootEl.hidden = false;
      } else {
        bootEl.textContent = t('settings.adminVapidBootNone');
        bootEl.hidden = false;
      }
    }
  } catch {
    setAdminVapidStatus(t('settings.adminVapidSaveErr'), true);
    if (bootEl) bootEl.hidden = true;
  }
}

export function initAdministrationPanel() {
  document.getElementById('btnAdminVapidSave')?.addEventListener('click', async () => {
    setAdminVapidStatus('', false);
    const pub = document.getElementById('adminVapidPublic')?.value.trim() || '';
    const priv = document.getElementById('adminVapidPrivate')?.value.trim() || '';
    const subject = document.getElementById('adminVapidSubject')?.value.trim() || '';
    if (!pub || !priv) {
      setAdminVapidStatus(t('settings.adminVapidSaveErr'), true);
      return;
    }
    try {
      const r = await apiFetch('/api/admin/vapid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: pub, privateKey: priv, subject }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = [data.error, data.detail].filter(Boolean).join(' — ') || t('settings.adminVapidSaveErr');
        setAdminVapidStatus(msg, true);
        return;
      }
      setAdminVapidStatus(t('settings.adminVapidSaveOk'), false);
      void refreshPushNotificationsPanel();
    } catch {
      setAdminVapidStatus(t('settings.adminVapidSaveErr'), true);
    }
  });

  document.getElementById('btnAdminVapidGenerate')?.addEventListener('click', async () => {
    if (!window.confirm(t('settings.adminVapidGenConfirm'))) return;
    setAdminVapidStatus('', false);
    const subject = document.getElementById('adminVapidSubject')?.value.trim() || '';
    try {
      const r = await apiFetch('/api/admin/vapid/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subject ? { subject } : {}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = [data.error, data.detail].filter(Boolean).join(' — ') || t('settings.adminVapidGenErr');
        setAdminVapidStatus(msg, true);
        return;
      }
      const pub = document.getElementById('adminVapidPublic');
      const priv = document.getElementById('adminVapidPrivate');
      const subj = document.getElementById('adminVapidSubject');
      if (pub && typeof data.publicKey === 'string') pub.value = data.publicKey;
      if (priv && typeof data.privateKey === 'string') priv.value = data.privateKey;
      if (subj && typeof data.subject === 'string') subj.value = data.subject;
      setAdminVapidStatus(t('settings.adminVapidGenOk'), false);
      void refreshPushNotificationsPanel();
    } catch {
      setAdminVapidStatus(t('settings.adminVapidGenErr'), true);
    }
  });

  document.getElementById('btnAdminBackup')?.addEventListener('click', async () => {
    if (app.readOnly) return;
    setAdminBackupStatus('', false);
    try {
      const r = await apiFetch('/api/admin/backup', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = [data.error, data.detail].filter(Boolean).join(' — ') || t('settings.adminBackupErr');
        setAdminBackupStatus(msg, true);
        return;
      }
      const file = typeof data.filename === 'string' && data.filename.trim() ? data.filename.trim() : '';
      setAdminBackupStatus(file ? t('settings.adminBackupOk', { file }) : t('settings.adminBackupOkShort'), false);
    } catch {
      setAdminBackupStatus(t('settings.adminBackupErr'), true);
    }
  });
}
