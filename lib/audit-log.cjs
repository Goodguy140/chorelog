const crypto = require('crypto');

const MAX_AUDIT_ENTRIES = 500;

function newId() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeAuditEntry(row) {
  if (!row || typeof row !== 'object') return null;
  const id = typeof row.id === 'string' && row.id ? row.id : newId();
  let at = typeof row.at === 'string' ? row.at.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at)) at = nowISO();
  const actor = typeof row.actor === 'string' ? row.actor.trim().slice(0, 120) : '';
  const action = typeof row.action === 'string' ? row.action.trim().slice(0, 96) : '';
  const target = typeof row.target === 'string' ? row.target.trim().slice(0, 240) : '';
  const detail = row.detail != null ? String(row.detail).trim().slice(0, 800) : '';
  if (!action) return null;
  const out = {
    id,
    at,
    actor: actor || '—',
    action,
    target: target || '—',
  };
  if (detail) out.detail = detail;
  return out;
}

function normalizeAuditLog(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const a = normalizeAuditEntry(row);
    if (a) out.push(a);
  }
  return out.slice(0, MAX_AUDIT_ENTRIES);
}

function appendAudit(store, req, { action, target, detail }) {
  if (!store.auditLog) store.auditLog = [];
  const actor =
    req.authPayload && typeof req.authPayload.user === 'string' && req.authPayload.user.trim()
      ? req.authPayload.user.trim().slice(0, 120)
      : (req.authPayload && req.authPayload.household) || 'house';
  const row = normalizeAuditEntry({
    id: newId(),
    at: nowISO(),
    actor,
    action,
    target: target || '—',
    ...(detail ? { detail } : {}),
  });
  if (!row) return;
  store.auditLog.unshift(row);
  if (store.auditLog.length > MAX_AUDIT_ENTRIES) {
    store.auditLog = store.auditLog.slice(0, MAX_AUDIT_ENTRIES);
  }
}

module.exports = {
  MAX_AUDIT_ENTRIES,
  appendAudit,
  normalizeAuditLog,
};
