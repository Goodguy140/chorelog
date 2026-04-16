const crypto = require('crypto');
const {
  normalizeDiscordDueTodaySentAt,
  normalizeDiscordReminderSentAt,
  normalizeDiscordWebhook,
  pruneDiscordDueTodaySentAt,
  pruneDiscordReminderSentAt,
} = require('./webhook-channels.cjs');
const { normalizePushSubscriptions } = require('./push-subscriptions.cjs');
const { normalizeAuditLog } = require('./audit-log.cjs');
const { calendarDateFromISO, localCalendarDateISO, parseCalendarDateParam } = require('./server-dates.cjs');

const DEFAULT_PEOPLE = ['Dylan', 'Rachel', 'Vic', 'Christian'];
const DEFAULT_LOCATIONS = ['Upstairs', 'Stairs', 'Hallway', 'Kitchen', 'Living room', 'Front porch', 'Back porch'];

function newId() {
  return crypto.randomUUID();
}

function normalizeEntry(row) {
  if (!row || typeof row.d !== 'string' || typeof row.p !== 'string') return null;
  const id = typeof row.id === 'string' && row.id ? row.id : newId();
  const d = row.d.trim();
  const p = row.p.trim();
  const c = typeof row.c === 'string' ? row.c.trim() : '';
  let choreId = null;
  let locationIds = [];
  if (row.choreId != null && typeof row.choreId === 'string') {
    const t = row.choreId.trim();
    if (t) choreId = t;
  }
  if (Array.isArray(row.locationIds)) {
    locationIds = row.locationIds
      .filter((x) => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  const note = typeof row.note === 'string' ? row.note.trim().slice(0, 280) : '';
  if (!d || !p) return null;
  if (!c && !choreId) return null;
  const fallbackIso = `${d}T12:00:00.000Z`;
  let createdAt = typeof row.createdAt === 'string' ? row.createdAt : fallbackIso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) createdAt = `${createdAt}T12:00:00.000Z`;
  let updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : createdAt;
  if (/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) updatedAt = `${updatedAt}T12:00:00.000Z`;
  const out = { id, d, c, p, choreId, locationIds, createdAt, updatedAt };
  if (note) out.note = note;
  if (typeof row.deletedAt === 'string' && row.deletedAt.trim()) {
    out.deletedAt = row.deletedAt.trim();
  }
  return out;
}

function normalizeChorePreset(row) {
  if (!row || typeof row.title !== 'string') return null;
  const title = row.title.trim();
  if (!title) return null;
  const id = typeof row.id === 'string' && row.id ? row.id : newId();
  let points = Number(row.points);
  if (!Number.isFinite(points)) points = 1;
  if (points < 0) points = 0;
  if (points > 10000) points = 10000;
  let color = typeof row.color === 'string' ? row.color.trim() : '#378ADD';
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) color = '#378ADD';
  const scoringMode = row.scoringMode === 'per_location' ? 'per_location' : 'flat';
  const out = { id, title, points, color, scoringMode };
  if (typeof row.deletedAt === 'string' && row.deletedAt.trim()) {
    out.deletedAt = row.deletedAt.trim();
  }
  return out;
}

function normalizeChorePresets(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const p = normalizeChorePreset(row);
    if (p) out.push(p);
  }
  return out;
}

function normalizeQuickChoreIds(ids, presets) {
  const valid = new Set(presets.filter((p) => !p.deletedAt).map((x) => x.id));
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !valid.has(id)) continue;
    out.push(id);
  }
  return out.slice(0, 24);
}

function normalizeLocations(arr) {
  if (!Array.isArray(arr)) return [...DEFAULT_LOCATIONS];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const s = String(raw).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : [...DEFAULT_LOCATIONS];
}

function defaultChorePresets() {
  const defs = [
    ['Dishes', 1, '#378ADD'],
    ['Garbage out', 1, '#D85A30'],
    ['Dishwasher', 1, '#7F77DD'],
    ['Wiped common surfaces', 1, '#1D9E75'],
    ['Swept kitchen', 1, '#C973D9'],
    ['Bathroom', 1, '#D8A530'],
  ];
  return defs.map(([title, points, color]) => normalizeChorePreset({ title, points, color })).filter(Boolean);
}

function normalizePeople(arr) {
  if (!Array.isArray(arr)) return [...DEFAULT_PEOPLE];
  const seen = new Set();
  const out = [];
  for (const p of arr) {
    const s = String(p).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.length ? out : [...DEFAULT_PEOPLE];
}

function normalizeScheduledChores(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    if (!row || typeof row.title !== 'string') continue;
    const title = row.title.trim();
    if (!title) continue;
    let intervalDays = Number(row.intervalDays);
    if (!Number.isFinite(intervalDays) || intervalDays < 1) intervalDays = 7;
    if (intervalDays > 3650) intervalDays = 3650;
    const id = typeof row.id === 'string' && row.id ? row.id : newId();

    let startsOn = null;
    if (typeof row.startsOn === 'string') {
      startsOn = parseCalendarDateParam(row.startsOn);
    }
    const legacy = row.createdAt;
    if (!startsOn && typeof legacy === 'string') {
      const t = legacy.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        startsOn = parseCalendarDateParam(t);
      } else if (t.includes('T')) {
        startsOn = calendarDateFromISO(t);
      }
    }
    if (!startsOn) startsOn = localCalendarDateISO();

    let createdAt = typeof row.createdAt === 'string' && row.createdAt.includes('T') ? row.createdAt : null;
    let updatedAt = typeof row.updatedAt === 'string' && row.updatedAt.includes('T') ? row.updatedAt : null;
    if (!createdAt) createdAt = `${startsOn}T12:00:00.000Z`;
    if (!updatedAt) updatedAt = createdAt;

    let lastCompletedAt = row.lastCompletedAt;
    if (lastCompletedAt != null && typeof lastCompletedAt === 'string') lastCompletedAt = lastCompletedAt.slice(0, 10);
    else lastCompletedAt = null;

    const reminderEnabled = row.reminderEnabled === false ? false : true;

    let recurrence = row.recurrence === 'monthlyWeekday' ? 'monthlyWeekday' : 'interval';
    let monthOrdinal = Number(row.monthOrdinal);
    let weekday = Number(row.weekday);
    if (recurrence === 'monthlyWeekday') {
      if (!Number.isFinite(monthOrdinal) || monthOrdinal < 1 || monthOrdinal > 5) monthOrdinal = 2;
      if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) weekday = 2;
      intervalDays = 30;
    } else {
      recurrence = 'interval';
      monthOrdinal = undefined;
      weekday = undefined;
    }

    out.push({
      id,
      title,
      intervalDays,
      recurrence,
      ...(recurrence === 'monthlyWeekday' ? { monthOrdinal, weekday } : {}),
      startsOn,
      lastCompletedAt,
      reminderEnabled,
      createdAt,
      updatedAt,
    });
  }
  return out;
}

function normalizeStore(raw) {
  const safeRaw = raw && typeof raw === 'object' ? raw : {};
  const rawEntries = Array.isArray(safeRaw.entries) ? safeRaw.entries : [];
  const people = normalizePeople(safeRaw.people);
  const locations = normalizeLocations(safeRaw.locations);
  const scheduledChores = normalizeScheduledChores(safeRaw.scheduledChores);
  let chorePresets = normalizeChorePresets(safeRaw.chorePresets);
  let quickChoreIds = normalizeQuickChoreIds(safeRaw.quickChoreIds, chorePresets);
  const quickKeyPresent = Object.prototype.hasOwnProperty.call(safeRaw, 'quickChoreIds');
  if (!chorePresets.filter((p) => !p.deletedAt).length) {
    chorePresets = defaultChorePresets();
    quickChoreIds = chorePresets.slice(0, 6).map((x) => x.id);
  } else if (!quickChoreIds.length && !quickKeyPresent) {
    const activePresets = chorePresets.filter((p) => !p.deletedAt);
    quickChoreIds = activePresets.slice(0, Math.min(6, activePresets.length)).map((x) => x.id);
  }
  const presetMap = new Map(chorePresets.map((p) => [p.id, p]));
  let entries = rawEntries.map(normalizeEntry).filter(Boolean);
  entries = entries.map((e) => {
    if (!e.c && e.choreId && presetMap.has(e.choreId)) {
      return { ...e, c: presetMap.get(e.choreId).title };
    }
    const validLocationIds = (e.locationIds || []).filter((x) => locations.includes(x));
    return { ...e, locationIds: validLocationIds };
  });
  entries = entries.filter((e) => e.c && e.d && e.p);
  const discordWebhook = normalizeDiscordWebhook(safeRaw.discordWebhook);
  let discordReminderSentAt = normalizeDiscordReminderSentAt(safeRaw.discordReminderSentAt);
  discordReminderSentAt = pruneDiscordReminderSentAt(
    discordReminderSentAt,
    scheduledChores.map((s) => s.id),
  );
  let discordDueTodaySentAt = normalizeDiscordDueTodaySentAt(safeRaw.discordDueTodaySentAt);
  discordDueTodaySentAt = pruneDiscordDueTodaySentAt(
    discordDueTodaySentAt,
    scheduledChores.map((s) => s.id),
  );
  const auditLog = normalizeAuditLog(safeRaw.auditLog);
  const pushSubscriptions = normalizePushSubscriptions(safeRaw.pushSubscriptions);
  return {
    entries,
    people,
    locations,
    scheduledChores,
    chorePresets,
    quickChoreIds,
    discordWebhook,
    discordReminderSentAt,
    discordDueTodaySentAt,
    pushSubscriptions,
    auditLog,
  };
}

module.exports = {
  DEFAULT_LOCATIONS,
  DEFAULT_PEOPLE,
  defaultChorePresets,
  normalizeChorePreset,
  normalizeChorePresets,
  normalizeEntry,
  normalizeLocations,
  normalizePeople,
  normalizeQuickChoreIds,
  normalizeScheduledChores,
  normalizeStore,
};
