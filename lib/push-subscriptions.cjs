const crypto = require('crypto');

const MAX_PUSH_SUBSCRIPTIONS = 24;

function newId() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Decode p256dh / auth from PushSubscription JSON. Prefer URL-safe base64; fall back to RFC 4648
 * so keys match web-push `Buffer.from(..., 'base64url')` after re-encoding.
 */
function decodeP256dhKeyBytes(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s/g, '');
  if (!trimmed) return null;
  const tryStd = () => {
    const std = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (std.length % 4)) % 4);
    return Buffer.from(std + pad, 'base64');
  };
  const attempts = [() => Buffer.from(trimmed, 'base64url'), tryStd];
  for (const fn of attempts) {
    try {
      const buf = fn();
      if (buf && buf.length === 65) return buf;
    } catch {
      /* try next */
    }
  }
  return null;
}

function decodeAuthKeyBytes(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s/g, '');
  if (!trimmed) return null;
  const tryStd = () => {
    const std = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (std.length % 4)) % 4);
    return Buffer.from(std + pad, 'base64');
  };
  const attempts = [() => Buffer.from(trimmed, 'base64url'), tryStd];
  for (const fn of attempts) {
    try {
      const buf = fn();
      if (buf && buf.length >= 16) return buf;
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalizePushSubscription(row) {
  if (!row || typeof row !== 'object') return null;
  const endpoint = typeof row.endpoint === 'string' ? row.endpoint.trim() : '';
  if (!endpoint) return null;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const keys = row.keys && typeof row.keys === 'object' ? row.keys : {};
  const rawP =
    (typeof keys.p256dh === 'string' && keys.p256dh) ||
    (typeof keys.P256DH === 'string' && keys.P256DH) ||
    '';
  const rawA =
    (typeof keys.auth === 'string' && keys.auth) ||
    (typeof keys.Auth === 'string' && keys.Auth) ||
    '';
  const bufP = decodeP256dhKeyBytes(rawP);
  const bufA = decodeAuthKeyBytes(rawA);
  if (!bufP || !bufA) return null;
  const p256dh = bufP.toString('base64url');
  const auth = bufA.toString('base64url');
  const id = typeof row.id === 'string' && row.id ? row.id : newId();
  let createdAt = typeof row.createdAt === 'string' ? row.createdAt : nowISO();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt)) createdAt = nowISO();
  return { id, endpoint, keys: { p256dh, auth }, createdAt };
}

function normalizePushSubscriptions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    const n = normalizePushSubscription(row);
    if (!n || seen.has(n.endpoint)) continue;
    seen.add(n.endpoint);
    out.push(n);
  }
  return out.slice(0, MAX_PUSH_SUBSCRIPTIONS);
}

module.exports = {
  MAX_PUSH_SUBSCRIPTIONS,
  normalizePushSubscription,
  normalizePushSubscriptions,
};
