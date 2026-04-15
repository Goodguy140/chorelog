function isDiscordWebhookUrl(url) {
  return (
    typeof url === 'string' &&
    /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/[^?\s#]+$/i.test(url.trim())
  );
}

function isSlackIncomingWebhookUrl(url) {
  return typeof url === 'string' && /^https:\/\/hooks\.slack\.com\/services\//i.test(url.trim());
}

/** Any HTTPS URL except Discord/Slack (e.g. Zapier, custom receiver). Same JSON body as Discord. */
function isGenericHttpsWebhookUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') return false;
    if (isDiscordWebhookUrl(url) || isSlackIncomingWebhookUrl(url)) return false;
    return Boolean(u.hostname);
  } catch {
    return false;
  }
}

function hasReminderDestination(w) {
  if (!w || typeof w !== 'object') return false;
  if (w.url && isDiscordWebhookUrl(w.url)) return true;
  if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) return true;
  if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) return true;
  return false;
}

/** Normalize "H:MM" or "HH:MM" to HH:MM */
function normalizeTimeHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return '22:00';
  let h = Number(m[1]);
  let min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return '22:00';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function timeStringToMinutes(s) {
  const t = normalizeTimeHHMM(s);
  const [h, min] = t.split(':').map(Number);
  return h * 60 + min;
}

/** Server local clock; quiet range may span midnight (e.g. 22:00–08:00). */
function isInReminderQuietHours(w) {
  if (!w || !w.quietHoursEnabled) return false;
  const start = timeStringToMinutes(w.quietHoursStart || '22:00');
  const end = timeStringToMinutes(w.quietHoursEnd || '08:00');
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

function normalizeDiscordWebhook(raw) {
  const defaults = {
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
  if (!raw || typeof raw !== 'object') return { ...defaults };
  const enabled = Boolean(raw.enabled);
  let url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (url && !isDiscordWebhookUrl(url)) url = '';
  let reminderIntervalMinutes = Number(raw.reminderIntervalMinutes);
  if (!Number.isFinite(reminderIntervalMinutes)) reminderIntervalMinutes = defaults.reminderIntervalMinutes;
  reminderIntervalMinutes = Math.min(10080, Math.max(15, Math.round(reminderIntervalMinutes)));

  const quietHoursEnabled = Boolean(raw.quietHoursEnabled);
  const quietHoursStart = normalizeTimeHHMM(
    typeof raw.quietHoursStart === 'string' ? raw.quietHoursStart : defaults.quietHoursStart,
  );
  const quietHoursEnd = normalizeTimeHHMM(
    typeof raw.quietHoursEnd === 'string' ? raw.quietHoursEnd : defaults.quietHoursEnd,
  );

  let slackWebhookUrl = typeof raw.slackWebhookUrl === 'string' ? raw.slackWebhookUrl.trim() : '';
  if (slackWebhookUrl && !isSlackIncomingWebhookUrl(slackWebhookUrl)) slackWebhookUrl = '';
  let genericWebhookUrl = typeof raw.genericWebhookUrl === 'string' ? raw.genericWebhookUrl.trim() : '';
  if (genericWebhookUrl && !isGenericHttpsWebhookUrl(genericWebhookUrl)) genericWebhookUrl = '';

  const overdueNotifyWebhooks = raw.overdueNotifyWebhooks !== false;
  const overdueNotifyPush = raw.overdueNotifyPush !== false;
  const dueTodayEnabled = Boolean(raw.dueTodayEnabled);
  const dueTodayNotifyWebhooks = raw.dueTodayNotifyWebhooks !== false;
  const dueTodayNotifyPush = raw.dueTodayNotifyPush !== false;

  return {
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
  };
}

function normalizeDiscordReminderSentAt(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k.length > 0 && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      out[k] = v;
    }
  }
  return out;
}

function pruneDiscordReminderSentAt(sentMap, scheduledIds) {
  const set = new Set(scheduledIds);
  const out = {};
  for (const [k, v] of Object.entries(sentMap)) {
    if (set.has(k)) out[k] = v;
  }
  return out;
}

/** Values are calendar days YYYY-MM-DD (last day we sent a “due today” notice per chore). */
function normalizeDiscordDueTodaySentAt(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k.length > 0 && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      out[k] = v;
    }
  }
  return out;
}

function pruneDiscordDueTodaySentAt(sentMap, scheduledIds) {
  const set = new Set(scheduledIds);
  const out = {};
  for (const [k, v] of Object.entries(sentMap)) {
    if (set.has(k)) out[k] = v;
  }
  return out;
}

async function postDiscordWebhook(url, payload) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r.ok || r.status === 204;
  } catch (e) {
    console.error('Discord webhook:', e.message || e);
    return false;
  }
}

async function postSlackIncomingWebhook(url, text) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return r.ok || r.status === 204;
  } catch (e) {
    console.error('Slack webhook:', e.message || e);
    return false;
  }
}

async function sendTestToAllWebhookChannels(w, urlOverrides = {}) {
  const discordUrl = urlOverrides.url != null ? String(urlOverrides.url).trim() : w.url;
  const slackUrl =
    urlOverrides.slackWebhookUrl != null ? String(urlOverrides.slackWebhookUrl).trim() : w.slackWebhookUrl;
  const genericUrl =
    urlOverrides.genericWebhookUrl != null
      ? String(urlOverrides.genericWebhookUrl).trim()
      : w.genericWebhookUrl;
  const payload = {
    embeds: [
      {
        title: 'Chorelog',
        description: 'Test notification — webhook is configured correctly.',
        color: 0x1d9e75,
      },
    ],
  };
  const tasks = [];
  if (discordUrl && isDiscordWebhookUrl(discordUrl)) {
    tasks.push(() => postDiscordWebhook(discordUrl, payload));
  }
  if (slackUrl && isSlackIncomingWebhookUrl(slackUrl)) {
    tasks.push(() =>
      postSlackIncomingWebhook(slackUrl, 'Chorelog — test notification; webhook is configured correctly.'),
    );
  }
  if (genericUrl && isGenericHttpsWebhookUrl(genericUrl)) {
    tasks.push(() => postDiscordWebhook(genericUrl, payload));
  }
  if (!tasks.length) return false;
  const results = await Promise.all(tasks.map((fn) => fn()));
  return results.some(Boolean);
}

module.exports = {
  hasReminderDestination,
  isDiscordWebhookUrl,
  isGenericHttpsWebhookUrl,
  isInReminderQuietHours,
  isSlackIncomingWebhookUrl,
  normalizeDiscordDueTodaySentAt,
  normalizeDiscordReminderSentAt,
  normalizeDiscordWebhook,
  postDiscordWebhook,
  postSlackIncomingWebhook,
  pruneDiscordDueTodaySentAt,
  pruneDiscordReminderSentAt,
  sendTestToAllWebhookChannels,
};
