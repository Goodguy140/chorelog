'use strict';

let webpush;
try {
  webpush = require('web-push');
} catch {
  webpush = null;
}

let vapidConfigured = false;

function vapidKeysPresent() {
  return Boolean(
    process.env.CHORELOG_VAPID_PUBLIC_KEY &&
      String(process.env.CHORELOG_VAPID_PUBLIC_KEY).trim() &&
      process.env.CHORELOG_VAPID_PRIVATE_KEY &&
      String(process.env.CHORELOG_VAPID_PRIVATE_KEY).trim(),
  );
}

function ensureVapidConfigured() {
  if (vapidConfigured) return true;
  if (!webpush || !vapidKeysPresent()) return false;
  const subject = String(process.env.CHORELOG_VAPID_SUBJECT || 'mailto:noreply@localhost').trim();
  try {
    webpush.setVapidDetails(
      subject,
      String(process.env.CHORELOG_VAPID_PUBLIC_KEY).trim(),
      String(process.env.CHORELOG_VAPID_PRIVATE_KEY).trim(),
    );
  } catch (e) {
    console.error('VAPID configuration invalid:', e.message || e);
    return false;
  }
  vapidConfigured = true;
  return true;
}

/** Public VAPID key for `PushManager.subscribe` (URL-safe base64). */
function getPublicVapidKey() {
  const k = process.env.CHORELOG_VAPID_PUBLIC_KEY;
  return k && String(k).trim() ? String(k).trim() : '';
}

/**
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} subscription
 * @param {string} payload UTF-8 string (often JSON)
 */
async function sendToSubscription(subscription, payload) {
  if (!ensureVapidConfigured()) {
    const err = new Error('VAPID not configured');
    err.statusCode = 503;
    throw err;
  }
  return webpush.sendNotification(subscription, payload, { TTL: 86_400 });
}

module.exports = {
  vapidKeysPresent,
  ensureVapidConfigured,
  getPublicVapidKey,
  sendToSubscription,
};
