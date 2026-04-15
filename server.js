const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const pkg = require('./package.json');
/** Matches `version` in JSON export (`GET /api/export`) and `/api/version` `exportSchemaVersion`. */
const EXPORT_SCHEMA_VERSION = 5;

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
/** Legacy single-file store; migrated once into `data/households/default/chores.json`. */
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'chores.json');

/**
 * Multi-household: isolated stores under `data/households/<id>/` + household credentials in SQLite `data/households/registry.db` (legacy `registry.json` is migrated once).
 * Optional SQLite: set CHORELOG_SQLITE_PATH (any value) to use `chores.db` per household dir instead of JSON.
 * Login brute-force: CHORELOG_LOGIN_MAX_FAILURES, CHORELOG_LOGIN_LOCKOUT_MS, CHORELOG_LOGIN_WINDOW_MS;
 * data/login-throttle.json persists lockouts. CHORELOG_TRUST_PROXY=1 when behind a reverse proxy (uses X-Forwarded-For).
 */
const { createLoginThrottle } = require('./lib/login-throttle.cjs');
const { openSqliteStore } = require('./lib/sqlite-store.cjs');
const householdReg = require('./lib/households-registry.cjs');
const { buildOpenApiDocument } = require('./lib/openapi-spec.cjs');
const scheduledRecurrence = require('./lib/scheduled-recurrence.cjs');
const pushSend = require('./lib/push-send.cjs');
const vapidPersist = require('./lib/vapid-persist.cjs');
const { buildGitHubBuildMeta } = require('./lib/build-meta.cjs');
const {
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
} = require('./lib/webhook-channels.cjs');
const {
  MAX_PUSH_SUBSCRIPTIONS,
  normalizePushSubscription,
  normalizePushSubscriptions,
} = require('./lib/push-subscriptions.cjs');
const reminderPayloads = require('./lib/reminder-payloads.cjs');

const USE_SQLITE_PER_HOUSEHOLD = Boolean(
  process.env.CHORELOG_SQLITE_PATH && String(process.env.CHORELOG_SQLITE_PATH).trim(),
);

/** Browser push (PWA subscriptions) is only managed for the seeded admin household (`default`). */
const BROWSER_PUSH_HOUSEHOLD_ID = 'default';
function browserPushAllowedForHousehold(hid) {
  return String(hid || '').trim() === BROWSER_PUSH_HOUSEHOLD_ID;
}

/** @type {'environment' | 'file' | 'none'} */
let VAPID_BOOT_SOURCE = 'none';
(function initVapidKeysAtStartup() {
  const hadEnv =
    process.env.CHORELOG_VAPID_PUBLIC_KEY &&
    String(process.env.CHORELOG_VAPID_PUBLIC_KEY).trim() &&
    process.env.CHORELOG_VAPID_PRIVATE_KEY &&
    String(process.env.CHORELOG_VAPID_PRIVATE_KEY).trim();
  if (hadEnv) {
    VAPID_BOOT_SOURCE = 'environment';
    return;
  }
  if (vapidPersist.loadVapidFromDiskIfUnset(DATA_DIR)) {
    VAPID_BOOT_SOURCE = 'file';
  } else {
    VAPID_BOOT_SOURCE = 'none';
  }
})();

function requireAdminHousehold(req, res, next) {
  if (!browserPushAllowedForHousehold(req.householdId)) {
    return res.status(403).json({
      error: 'This action requires the admin household.',
      code: 'admin_only',
    });
  }
  next();
}

let householdRegistry = null;
const sqliteStoreByHousehold = new Map();

function ensureRegistryLoaded() {
  if (!householdRegistry) {
    householdRegistry = householdReg.ensureRegistry(DATA_DIR, LEGACY_DATA_FILE, process.env.CHORELOG_PASSWORD);
  }
  return householdRegistry;
}

function householdDataFile(hid) {
  return path.join(householdReg.householdsRoot(DATA_DIR), hid, 'chores.json');
}

function householdSqlitePath(hid) {
  if (!USE_SQLITE_PER_HOUSEHOLD) return null;
  return path.join(householdReg.householdsRoot(DATA_DIR), hid, 'chores.db');
}

function getSqliteStoreForHousehold(hid) {
  if (!USE_SQLITE_PER_HOUSEHOLD) return null;
  if (sqliteStoreByHousehold.has(hid)) return sqliteStoreByHousehold.get(hid);
  const dbPath = householdSqlitePath(hid);
  const jsonPath = householdDataFile(hid);
  const st = openSqliteStore(dbPath, jsonPath);
  if (st.migratedFromJson) {
    console.log(`Chorelog: migrated household "${hid}" store from JSON to SQLite`);
  }
  sqliteStoreByHousehold.set(hid, st);
  return st;
}

const loginThrottle = createLoginThrottle({ dataDir: DATA_DIR });

const DEFAULT_PEOPLE = ['Dylan', 'Rachel', 'Vic', 'Christian'];
const DEFAULT_LOCATIONS = ['Upstairs', 'Stairs', 'Hallway', 'Kitchen', 'Living room', 'Front porch', 'Back porch'];

/** Same shape as the original HTML SEED: one row per log line, chores can contain `;` */
const RAW_SEED = [
  { d: '2026-03-03', c: 'Dishes; Wiped Table; Cleaned Fridge', p: 'Vic' },
  { d: '2026-03-03', c: 'Wiped common surfaces', p: 'Dylan' },
  { d: '2026-03-05', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-05', c: 'Dishes', p: 'Vic' },
  { d: '2026-03-06', c: 'Garbage out', p: 'Vic' },
  { d: '2026-03-06', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-08', c: 'Dishwasher, Cleaned bathroom', p: 'Rachel' },
  { d: '2026-03-09', c: 'Cleaned bathtub/grout', p: 'Rachel' },
  { d: '2026-03-09', c: 'Swept upstairs, stairs, hallway, kitchen; Tidied sussy room', p: 'Christian' },
  { d: '2026-03-10', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-11', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-13', c: 'Dishes; Wiped counter, shelf, stove and table; Swept kitchen twice', p: 'Dylan' },
  { d: '2026-03-14', c: 'Dishwasher', p: 'Rachel' },
  { d: '2026-03-14', c: 'Dishes + put away', p: 'Vic' },
  { d: '2026-03-15', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-17', c: 'Many dishes', p: 'Vic' },
  { d: '2026-03-19', c: 'Dishes; Swept hallways, kitchen & stairs; Changed cans & garbage', p: 'Dylan' },
  { d: '2026-03-19', c: 'Change Cardboard', p: 'Christian' },
  { d: '2026-03-20', c: 'Dishes + put away', p: 'Dylan' },
  { d: '2026-03-21', c: 'Swept stairs, hallway, back porch and kitchen; Dishwasher', p: 'Rachel' },
  { d: '2026-03-23', c: 'Shoveled Front & Back', p: 'Rachel' },
  { d: '2026-03-23', c: 'Dishes; Put away dishes x2', p: 'Dylan' },
  { d: '2026-03-27', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-27', c: 'Mail to Fred', p: 'Vic' },
  { d: '2026-03-29', c: 'Bathroom clean; Dishwasher', p: 'Rachel' },
  { d: '2026-02-01', c: 'Mopped floor, Dishes', p: 'Dylan' },
  { d: '2026-02-02', c: 'Dishes and Dishwasher in/out', p: 'Dylan' },
  { d: '2026-02-02', c: 'Clean Bathroom and Dishwasher', p: 'Rachel' },
  { d: '2026-02-02', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-03', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-04', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-04', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-04', c: 'Swept Kitchen & Hallway', p: 'Christian' },
  { d: '2026-02-05', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-05', c: 'Garbage out', p: 'Christian' },
  { d: '2026-02-06', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-07', c: 'Swept backdoor porch', p: 'Rachel' },
  { d: '2026-02-08', c: 'Swept upstairs, stairs, hallway, and Kitchen', p: 'Dylan' },
  { d: '2026-02-08', c: 'Wiped table, Took garbage down & Dishes', p: 'Dylan' },
  { d: '2026-02-09', c: 'Dishes & Dishwasher', p: 'Dylan' },
  { d: '2026-02-10', c: 'Dishes & Dishwasher away', p: 'Vic' },
  { d: '2026-02-11', c: 'Swept Upstairs, Hallway and Kitchen; Dishes; Dishwasher; Stove Deep-cleaned', p: 'Dylan' },
  { d: '2026-02-11', c: 'Swept Back Porch & Kitchen', p: 'Rachel' },
  { d: '2026-02-12', c: 'Shoveled to Clear a Path, Salted', p: 'Christian' },
  { d: '2026-02-12', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-15', c: 'Swept Upstairs, Stairs, Hallway and Kitchen; Lysoled floor; Dishwasher', p: 'Christian' },
  { d: '2026-02-15', c: 'Dishes and Trash to Basement', p: 'Dylan' },
  { d: '2026-02-16', c: 'Put away Dishes and did Dishes', p: 'Christian' },
  { d: '2026-02-17', c: 'Wiped common surfaces', p: 'Dylan' },
  { d: '2026-02-17', c: 'Swept and Mopped Entry Way; Dishes', p: 'Vic' },
  { d: '2026-02-17', c: 'Bathroom', p: 'Rachel' },
  { d: '2026-02-18', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-18', c: 'Dishwasher', p: 'Rachel' },
  { d: '2026-02-18', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-19', c: 'Dishes, Wiped down table, stove; Changed bathroom trash; Swept', p: 'Dylan' },
  { d: '2026-02-19', c: 'Garbage out', p: 'Christian' },
  { d: '2026-02-21', c: 'Swept stairs, hallway, living room and back porch', p: 'Rachel' },
  { d: '2026-02-21', c: 'Wiped Under recyclables bag; Dishes', p: 'Vic' },
  { d: '2026-02-22', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-23', c: 'Dishes away', p: 'Dylan' },
  { d: '2026-02-23', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-24', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-24', c: 'Shoveled Front and back steps; Dishwasher and put away dishes', p: 'Rachel' },
  { d: '2026-02-27', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-27', c: 'Garbage down + bag replaced', p: 'Vic' },
  { d: '2026-02-28', c: 'Changed bathroom trash; Swept house; Mopped hallways; Dishes; Cleaned table', p: 'Dylan' },
];

function expandRaw(raw) {
  const out = [];
  raw.forEach((e) => {
    e.c.split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((task) => {
        out.push({ d: e.d, c: task, p: e.p });
      });
  });
  return out;
}

function newId() {
  return crypto.randomUUID();
}

/** Calendar YYYY-MM-DD in the Node process timezone (not UTC). */
function localCalendarDateISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Validates YYYY-MM-DD; rejects invalid calendar dates. */
function parseCalendarDateParam(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return s;
}

function nowISO() {
  return new Date().toISOString();
}

/** Local calendar YYYY-MM-DD from an ISO datetime string (process timezone). */
function calendarDateFromISO(iso) {
  if (typeof iso !== 'string' || !iso.includes('T')) return localCalendarDateISO();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return localCalendarDateISO();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeEntry(row) {
  if (!row || typeof row.d !== 'string' || typeof row.p !== 'string') return null;
  const id = typeof row.id === 'string' && row.id ? row.id : newId();
  const d = row.d.trim();
  const p = row.p.trim();
  let c = typeof row.c === 'string' ? row.c.trim() : '';
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
  if (!d || !p) return null;
  if (!c && !choreId) return null;
  const fallbackIso = `${d}T12:00:00.000Z`;
  let createdAt = typeof row.createdAt === 'string' ? row.createdAt : fallbackIso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) createdAt = `${createdAt}T12:00:00.000Z`;
  let updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : createdAt;
  if (/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) updatedAt = `${updatedAt}T12:00:00.000Z`;
  const out = { id, d, c, p, choreId, locationIds, createdAt, updatedAt };
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
    if (!createdAt) {
      createdAt = `${startsOn}T12:00:00.000Z`;
    }
    if (!updatedAt) {
      updatedAt = createdAt;
    }

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

/** Calendar helpers for scheduled chores (aligned with `js/utils/date.js`). */
function addDaysIso(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function scheduledStartsOnCalendar(s) {
  if (s.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(String(s.startsOn))) return String(s.startsOn);
  const ca = s.createdAt;
  if (typeof ca === 'string') {
    const t = ca.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (t.includes('T')) return localCalendarDateISO();
  }
  return localCalendarDateISO();
}

function nextDueDateScheduled(s) {
  return scheduledRecurrence.nextDueDateForScheduled(s, {
    addDays: addDaysIso,
    scheduledStartsOnCalendar,
  });
}

/** YYYY-MM-DD → locale medium date for Discord (matches client “Due Mon D, YYYY” style). */
function formatCalendarDateHuman(isoDate) {
  if (!isoDate || typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return String(isoDate || '').trim() || '—';
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const MAX_AUDIT_ENTRIES = 500;

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

function normalizeStore(raw) {
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : [];
  const people = normalizePeople(raw.people);
  const locations = normalizeLocations(raw.locations);
  const scheduledChores = normalizeScheduledChores(raw.scheduledChores);
  let chorePresets = normalizeChorePresets(raw.chorePresets);
  let quickChoreIds = normalizeQuickChoreIds(raw.quickChoreIds, chorePresets);
  const quickKeyPresent = raw && Object.prototype.hasOwnProperty.call(raw, 'quickChoreIds');
  if (!chorePresets.filter((p) => !p.deletedAt).length) {
    chorePresets = defaultChorePresets();
    quickChoreIds = chorePresets.slice(0, 6).map((x) => x.id);
  } else if (!quickChoreIds.length && !quickKeyPresent) {
    /* Legacy stores without quickChoreIds: default the bar. Explicit [] means user cleared it. */
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
  const discordWebhook = normalizeDiscordWebhook(raw.discordWebhook);
  let discordReminderSentAt = normalizeDiscordReminderSentAt(raw.discordReminderSentAt);
  discordReminderSentAt = pruneDiscordReminderSentAt(
    discordReminderSentAt,
    scheduledChores.map((s) => s.id),
  );
  let discordDueTodaySentAt = normalizeDiscordDueTodaySentAt(raw.discordDueTodaySentAt);
  discordDueTodaySentAt = pruneDiscordDueTodaySentAt(
    discordDueTodaySentAt,
    scheduledChores.map((s) => s.id),
  );
  const auditLog = normalizeAuditLog(raw.auditLog);
  const pushSubscriptions = normalizePushSubscriptions(raw.pushSubscriptions);
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

async function readStore(householdId) {
  ensureRegistryLoaded();
  const hid = String(householdId || '').trim();
  if (!hid || !householdRegistry.households[hid]) {
    throw new Error('Invalid household');
  }
  const sqliteStore = getSqliteStoreForHousehold(hid);
  const dataFile = householdDataFile(hid);
  if (sqliteStore) {
    const raw = sqliteStore.readJsonString();
    if (raw == null || raw === '') {
      return normalizeStore({
        entries: [],
        people: [...DEFAULT_PEOPLE],
        locations: [...DEFAULT_LOCATIONS],
        scheduledChores: [],
        chorePresets: [],
        quickChoreIds: [],
      });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('SQLite store contains invalid JSON');
    }
    return normalizeStore(data);
  }
  try {
    const buf = await fs.promises.readFile(dataFile, 'utf8');
    const data = JSON.parse(buf);
    return normalizeStore(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return normalizeStore({
        entries: [],
        people: [...DEFAULT_PEOPLE],
        locations: [...DEFAULT_LOCATIONS],
        scheduledChores: [],
        chorePresets: [],
        quickChoreIds: [],
      });
    }
    throw err;
  }
}

async function writeStore(householdId, data) {
  ensureRegistryLoaded();
  const hid = String(householdId || '').trim();
  if (!hid || !householdRegistry.households[hid]) {
    throw new Error('Invalid household');
  }
  const normalized = normalizeStore(data);
  const sqliteStore = getSqliteStoreForHousehold(hid);
  if (sqliteStore) {
    sqliteStore.writeJsonString(JSON.stringify(normalized));
    return;
  }
  const dataFile = householdDataFile(hid);
  const dir = path.dirname(dataFile);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = `${dataFile}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  await fs.promises.rename(tmp, dataFile);
}

const IMPORT_BACKUP_ENABLED =
  process.env.CHORELOG_IMPORT_BACKUP !== '0' && process.env.CHORELOG_IMPORT_BACKUP !== 'false';
const BACKUP_RETENTION = Math.max(1, Math.min(200, Number(process.env.CHORELOG_BACKUP_RETENTION) || 25));
const SCHEDULED_BACKUP_MS = (() => {
  const n = Number(process.env.CHORELOG_SCHEDULED_BACKUP_MS);
  return Number.isFinite(n) && n >= 60000 ? Math.floor(n) : 0;
})();

async function pruneHouseholdBackups(backupDir, keep) {
  let names;
  try {
    names = await fs.promises.readdir(backupDir);
  } catch {
    return;
  }
  const stats = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fp = path.join(backupDir, name);
    try {
      const st = await fs.promises.stat(fp);
      stats.push({ fp, mtime: st.mtimeMs });
    } catch {
      /* ignore */
    }
  }
  stats.sort((a, b) => b.mtime - a.mtime);
  for (let i = keep; i < stats.length; i++) {
    await fs.promises.unlink(stats[i].fp).catch(() => {});
  }
}

/** Export-shaped JSON under `data/households/<id>/backups/` (works for JSON or SQLite-backed store). */
async function writeHouseholdBackupSnapshot(householdId, reason) {
  ensureRegistryLoaded();
  const hid = String(householdId || '').trim();
  if (!hid || !householdRegistry.households[hid]) {
    throw new Error('Invalid household');
  }
  const store = await readStore(hid);
  const backupDir = path.join(householdReg.householdsRoot(DATA_DIR), hid, 'backups');
  await fs.promises.mkdir(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeReason = String(reason || 'backup')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'backup';
  const filename = `${safeReason}-${ts}.json`;
  const payload = {
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    backupReason: reason,
    people: store.people,
    locations: store.locations || [],
    entries: store.entries,
    scheduledChores: store.scheduledChores || [],
    chorePresets: store.chorePresets || [],
    quickChoreIds: store.quickChoreIds || [],
    discordWebhook: store.discordWebhook || normalizeDiscordWebhook(null),
    discordReminderSentAt: store.discordReminderSentAt || {},
    discordDueTodaySentAt: store.discordDueTodaySentAt || {},
    pushSubscriptions: store.pushSubscriptions || [],
    auditLog: store.auditLog || [],
  };
  const fp = path.join(backupDir, filename);
  const tmp = `${fp}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.promises.rename(tmp, fp);
  await pruneHouseholdBackups(backupDir, BACKUP_RETENTION);
}

async function runScheduledBackupsForAllHouseholds() {
  ensureRegistryLoaded();
  const ids = Object.keys(householdRegistry.households || {});
  for (const hid of ids) {
    try {
      await writeHouseholdBackupSnapshot(hid, 'scheduled');
    } catch (e) {
      console.error(`Chorelog: scheduled backup failed for household "${hid}":`, e.message || e);
    }
  }
}

async function ensureSeed(householdId) {
  const store = await readStore(householdId);
  if (store.entries.length > 0) return;
  const expanded = expandRaw(RAW_SEED);
  store.entries = expanded
    .map((e) => normalizeEntry({ id: newId(), d: e.d, c: e.c, p: e.p }))
    .filter(Boolean);
  if (!store.people || store.people.length === 0) store.people = [...DEFAULT_PEOPLE];
  await writeStore(householdId, store);
}

const app = express();
app.set('trust proxy', process.env.CHORELOG_TRUST_PROXY === '1');
app.use(express.json({ limit: '5mb' }));

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

const AUTH_COOKIE = 'chorelog_auth';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getSessionSecret() {
  return process.env.CHORELOG_SECRET || 'chorelog-dev-secret-change-me';
}

function parseCookieHeader(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function createAuthToken(username, householdId, opts = {}) {
  const user = String(username || '')
    .trim()
    .slice(0, 120) || 'member';
  const household = String(householdId || '')
    .trim()
    .slice(0, 64);
  const payload = { v: 2, exp: Date.now() + COOKIE_MAX_AGE_MS, user, household };
  if (opts.readOnly) payload.ro = true;
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyAuthCookie(cookieHeader) {
  const token = parseCookieHeader(cookieHeader, AUTH_COOKIE);
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  if (payload.v !== 2 || typeof payload.household !== 'string' || !payload.household.trim()) {
    return null;
  }
  return payload;
}

function requireApiAuth(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  if (req.method === 'GET' && req.path === '/api/auth') return next();
  if (req.method === 'GET' && req.path === '/api/version') return next();
  if (req.method === 'GET' && req.path === '/api/register-info') return next();
  if (req.method === 'GET' && req.path === '/api/openapi.json') return next();
  if (req.method === 'GET' && req.path === '/api/push/vapid-public') return next();
  if (req.method === 'POST' && req.path === '/api/login') return next();
  if (req.method === 'POST' && req.path === '/api/login/members') return next();
  if (req.method === 'POST' && req.path === '/api/logout') return next();
  if (req.method === 'POST' && req.path === '/api/households') return next();
  const payload = verifyAuthCookie(req.headers.cookie);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  ensureRegistryLoaded();
  const hid = String(payload.household).trim();
  if (!householdRegistry.households[hid]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.authPayload = payload;
  req.householdId = hid;
  next();
}

/** Block mutating API calls for read-only (guest) sessions. Mount after `requireApiAuth` on POST/PUT/DELETE handlers. */
function requireReadWrite(req, res, next) {
  if (!req.authPayload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.authPayload.ro) {
    return res.status(403).json({ error: 'Read-only session', code: 'read_only' });
  }
  next();
}

app.use(requireApiAuth);

function buildVersionPayload(req) {
  const gitHubBuild = buildGitHubBuildMeta();
  const base = {
    version: pkg.version,
    nodeVersion: process.version,
    exportSchemaVersion: EXPORT_SCHEMA_VERSION,
    multiHousehold: true,
    ...(gitHubBuild && Object.keys(gitHubBuild).length ? { gitHubBuild } : {}),
  };
  const p = req && verifyAuthCookie(req.headers.cookie);
  if (!p || p.v !== 2 || !p.household) {
    return base;
  }
  ensureRegistryLoaded();
  const hid = String(p.household).trim();
  if (!householdRegistry.households[hid]) {
    return base;
  }
  const sqliteStore = getSqliteStoreForHousehold(hid);
  const persistence = sqliteStore ? 'sqlite' : 'json';
  const dbPath = sqliteStore ? householdSqlitePath(hid) : householdDataFile(hid);
  let databaseRelativePath = path.relative(__dirname, dbPath);
  if (!databaseRelativePath || databaseRelativePath.startsWith('..')) {
    databaseRelativePath = dbPath;
  }
  databaseRelativePath = databaseRelativePath.split(path.sep).join('/');
  let sqliteVersion = null;
  let journalMode = null;
  if (sqliteStore && typeof sqliteStore.getEngineInfo === 'function') {
    const info = sqliteStore.getEngineInfo();
    if (info.sqliteVersion) sqliteVersion = info.sqliteVersion;
    if (info.journalMode) journalMode = info.journalMode;
  }
  return {
    ...base,
    household: hid,
    persistence,
    databaseRelativePath,
    sqliteVersion,
    journalMode,
  };
}

app.get('/api/auth', (req, res) => {
  const payload = verifyAuthCookie(req.headers.cookie);
  if (!payload) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    readOnly: Boolean(payload.ro),
    user:
      typeof payload.user === 'string' && payload.user.trim()
        ? payload.user.trim()
        : 'member',
    household:
      typeof payload.household === 'string' && payload.household.trim()
        ? payload.household.trim()
        : 'default',
  });
});

app.get('/api/version', (req, res) => {
  res.json(buildVersionPayload(req));
});

/** Public: which registration options the server allows (for login “Create account” UI). */
app.get('/api/register-info', (req, res) => {
  const open = process.env.CHORELOG_OPEN_REGISTRATION === '1';
  const master = Boolean(process.env.CHORELOG_MASTER_PASSWORD);
  const guestPw = process.env.CHORELOG_GUEST_PASSWORD && String(process.env.CHORELOG_GUEST_PASSWORD);
  res.json({
    openRegistration: open,
    hasMasterPassword: master,
    allowCreateHousehold: open || master,
    guestLoginEnabled: Boolean(guestPw && guestPw.trim()),
  });
});

/** OpenAPI 3.0 document for integrators (public). */
app.get('/api/openapi.json', (req, res) => {
  res.type('application/json');
  res.json(buildOpenApiDocument(req));
});

app.get('/api/push/vapid-public', (req, res) => {
  const pub = pushSend.getPublicVapidKey();
  if (!pub) return res.status(503).json({ error: 'Push is not configured on this server' });
  res.json({ publicKey: pub });
});

app.get('/api/push/subscriptions', async (req, res) => {
  try {
    if (!browserPushAllowedForHousehold(req.householdId)) {
      return res.status(403).json({
        error: 'Browser push is only available for the default household.',
        code: 'push_household_not_allowed',
      });
    }
    const store = await readStore(req.householdId);
    const list = normalizePushSubscriptions(store.pushSubscriptions);
    if (list.length !== (store.pushSubscriptions || []).length) {
      store.pushSubscriptions = list;
      await writeStore(req.householdId, store);
    }
    res.json({
      serverEnabled: pushSend.vapidKeysPresent(),
      subscriptions: list.map((s) => ({ id: s.id, endpoint: s.endpoint })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load push subscriptions' });
  }
});

app.post('/api/push/subscribe', requireReadWrite, async (req, res) => {
  try {
    if (!browserPushAllowedForHousehold(req.householdId)) {
      return res.status(403).json({
        error: 'Browser push is only available for the default household.',
        code: 'push_household_not_allowed',
      });
    }
    if (!pushSend.vapidKeysPresent()) {
      return res.status(503).json({ error: 'Push is not configured on this server' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sub =
      body.subscription && typeof body.subscription === 'object' ? body.subscription : body;
    const row = normalizePushSubscription({
      endpoint: sub.endpoint,
      keys: sub.keys,
      createdAt: nowISO(),
    });
    if (!row) {
      return res.status(400).json({
        error: 'Invalid subscription',
        detail: 'Expected HTTPS endpoint and valid p256dh (65 bytes) and auth (16+ bytes) keys',
      });
    }
    const store = await readStore(req.householdId);
    let list = normalizePushSubscriptions(store.pushSubscriptions || []);
    const idx = list.findIndex((x) => x.endpoint === row.endpoint);
    if (idx >= 0) list[idx] = { ...list[idx], keys: row.keys, createdAt: row.createdAt };
    else {
      list.push(row);
      list = list.slice(-MAX_PUSH_SUBSCRIPTIONS);
    }
    store.pushSubscriptions = normalizePushSubscriptions(list);
    appendAudit(store, req, {
      action: 'push.subscribe',
      target: 'web-push',
      detail: `Browser push subscription registered`,
    });
    await writeStore(req.householdId, store);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

app.post('/api/push/unsubscribe', requireReadWrite, async (req, res) => {
  try {
    if (!browserPushAllowedForHousehold(req.householdId)) {
      return res.status(403).json({
        error: 'Browser push is only available for the default household.',
        code: 'push_household_not_allowed',
      });
    }
    const endpoint = typeof req.body && req.body.endpoint ? String(req.body.endpoint).trim() : '';
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    const store = await readStore(req.householdId);
    const before = (store.pushSubscriptions || []).length;
    store.pushSubscriptions = (store.pushSubscriptions || []).filter((s) => s.endpoint !== endpoint);
    if (store.pushSubscriptions.length === before) {
      return res.json({ ok: true, removed: false });
    }
    appendAudit(store, req, {
      action: 'push.unsubscribe',
      target: 'web-push',
      detail: 'Browser push subscription removed',
    });
    await writeStore(req.householdId, store);
    res.json({ ok: true, removed: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

app.post('/api/push/test', requireReadWrite, async (req, res) => {
  try {
    if (!browserPushAllowedForHousehold(req.householdId)) {
      return res.status(403).json({
        error: 'Browser push is only available for the default household.',
        code: 'push_household_not_allowed',
      });
    }
    if (!pushSend.vapidKeysPresent()) {
      return res.status(503).json({ error: 'Push is not configured on this server' });
    }
    const store = await readStore(req.householdId);
    const subs = normalizePushSubscriptions(store.pushSubscriptions || []);
    if (!subs.length) {
      return res.status(400).json({
        error: 'No browser subscriptions for this household',
        code: 'no_subscriptions',
      });
    }
    store.pushSubscriptions = subs;
    const payload = JSON.stringify({
      title: 'Chorelog',
      body: 'Test notification — browser push is working.',
      url: '/',
      tag: 'chorelog-test',
    });
    const pushRes = await sendPushPayloadToStoreSubscriptions(store, req.householdId, payload);
    if (!pushRes.ok) {
      return res.status(502).json({
        error:
          'Push could not be delivered. Check VAPID keys match this server, network access to the push service, and try subscribing again.',
        code: 'send_failed',
      });
    }
    appendAudit(store, req, {
      action: 'push.test',
      target: 'web-push',
      detail: 'Test push sent',
    });
    await writeStore(req.householdId, store);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Test failed' });
  }
});

app.get('/api/admin/vapid', requireAdminHousehold, (req, res) => {
  try {
    const persistPath = vapidPersist.vapidEnvPath(DATA_DIR);
    let persistRelativePath = path.relative(__dirname, persistPath);
    if (!persistRelativePath || persistRelativePath.startsWith('..')) {
      persistRelativePath = persistPath;
    }
    persistRelativePath = persistRelativePath.split(path.sep).join('/');
    res.json({
      publicKey: pushSend.getPublicVapidKey() || '',
      privateKey: pushSend.getPrivateVapidKey() || '',
      subject: pushSend.getVapidSubject(),
      bootSource: VAPID_BOOT_SOURCE,
      persistRelativePath,
      persistFileExists: fs.existsSync(persistPath),
      configured: pushSend.vapidKeysPresent(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load VAPID settings' });
  }
});

app.put('/api/admin/vapid', requireReadWrite, requireAdminHousehold, (req, res) => {
  let webpushMod;
  try {
    webpushMod = require('web-push');
  } catch {
    return res.status(503).json({ error: 'web-push module is not available' });
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const publicKey = String(body.publicKey != null ? body.publicKey : '').trim();
    const privateKey = String(body.privateKey != null ? body.privateKey : '').trim();
    let subject = String(body.subject != null ? body.subject : '').trim();
    if (!publicKey || !privateKey) {
      return res.status(400).json({ error: 'publicKey and privateKey are required' });
    }
    if (!subject) subject = 'mailto:noreply@localhost';
    try {
      webpushMod.setVapidDetails(subject, publicKey, privateKey);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid VAPID key pair or subject',
        detail: e.message || String(e),
      });
    }
    vapidPersist.writeVapidEnvFile(DATA_DIR, { publicKey, privateKey, subject });
    if (!pushSend.setRuntimeVapidKeys(publicKey, privateKey, subject)) {
      return res.status(500).json({ error: 'Could not apply VAPID keys at runtime' });
    }
    res.json({ ok: true, configured: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save VAPID keys' });
  }
});

app.post('/api/admin/vapid/generate', requireReadWrite, requireAdminHousehold, (req, res) => {
  let webpushMod;
  try {
    webpushMod = require('web-push');
  } catch {
    return res.status(503).json({ error: 'web-push module is not available' });
  }
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const keys = webpushMod.generateVAPIDKeys();
    let subject = String(body.subject != null ? body.subject : '').trim();
    if (!subject) {
      subject = pushSend.getVapidSubject() || 'mailto:noreply@localhost';
    }
    try {
      webpushMod.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid subject', detail: e.message || String(e) });
    }
    vapidPersist.writeVapidEnvFile(DATA_DIR, {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject,
    });
    if (!pushSend.setRuntimeVapidKeys(keys.publicKey, keys.privateKey, subject)) {
      return res.status(500).json({ error: 'Could not apply generated VAPID keys' });
    }
    res.json({
      ok: true,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject,
      configured: true,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate VAPID keys' });
  }
});

app.get('/api/account', (req, res) => {
  try {
    const p = req.authPayload;
    if (!p || !p.household) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const hid = String(p.household).trim();
    res.json({
      user: typeof p.user === 'string' && p.user.trim() ? p.user.trim() : 'member',
      household: hid,
      readOnly: Boolean(p.ro),
      sessionExpiresAt: new Date(p.exp).toISOString(),
      canCreateHouseholds: Boolean(process.env.CHORELOG_MASTER_PASSWORD),
      openRegistration: process.env.CHORELOG_OPEN_REGISTRATION === '1',
      browserPushAllowed: browserPushAllowedForHousehold(hid),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load account' });
  }
});

app.put('/api/account/display-name', requireReadWrite, (req, res) => {
  try {
    const p = req.authPayload;
    if (!p || !p.household) return res.status(401).json({ error: 'Unauthorized' });
    const name = String(req.body && req.body.user != null ? req.body.user : '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'Display name is required' });
    const token = createAuthToken(name, p.household);
    const maxAgeSec = Math.floor(COOKIE_MAX_AGE_MS / 1000);
    res.setHeader(
      'Set-Cookie',
      `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`,
    );
    res.json({ ok: true, user: name });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update display name' });
  }
});

app.post('/api/account/password', requireReadWrite, (req, res) => {
  try {
    ensureRegistryLoaded();
    const hid = req.householdId;
    const cur = String(req.body && req.body.currentPassword != null ? req.body.currentPassword : '');
    const newPw = String(req.body && req.body.newPassword != null ? req.body.newPassword : '');
    if (newPw.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const rec = householdReg.householdRecord(householdRegistry, hid);
    if (!rec || !householdReg.verifyPassword(cur, rec.salt, rec.hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    householdReg.updateHouseholdPassword(DATA_DIR, householdRegistry, hid, newPw);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

app.get('/api/audit', async (req, res) => {
  try {
    const store = await readStore(req.householdId);
    let limit = Number(req.query && req.query.limit);
    if (!Number.isFinite(limit) || limit < 1) limit = 100;
    if (limit > MAX_AUDIT_ENTRIES) limit = MAX_AUDIT_ENTRIES;
    res.json({ auditLog: (store.auditLog || []).slice(0, limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

app.post('/api/login', async (req, res) => {
  const ip = clientIp(req);
  const throttle = loginThrottle.check(ip);
  if (!throttle.allowed) {
    const retry = throttle.retryAfterSec || 60;
    res.setHeader('Retry-After', String(retry));
    return res.status(429).json({
      error: `Too many sign-in attempts. Try again in ${retry} seconds.`,
      retryAfterSeconds: retry,
    });
  }
  ensureRegistryLoaded();
  let hidRaw = req.body && req.body.household != null ? req.body.household : '';
  if (hidRaw === '' || hidRaw == null) hidRaw = 'default';
  const hid = householdReg.sanitizeHouseholdId(hidRaw);
  if (!hid) {
    loginThrottle.recordFailure(ip);
    return res.status(400).json({ error: 'Invalid household id' });
  }
  const u = String(req.body && req.body.username != null ? req.body.username : '').trim();
  const p = String(req.body && req.body.password != null ? req.body.password : '');
  const guestMode = req.body && req.body.guest === true;
  const guestSecret =
    process.env.CHORELOG_GUEST_PASSWORD && String(process.env.CHORELOG_GUEST_PASSWORD).trim();

  if (guestMode) {
    if (!guestSecret) {
      loginThrottle.recordFailure(ip);
      return res.status(403).json({ error: 'Guest login is disabled on this server.' });
    }
    if (p !== guestSecret) {
      loginThrottle.recordFailure(ip);
      return res.status(401).json({ error: 'Unknown household or wrong password' });
    }
    const rec = householdReg.householdRecord(householdRegistry, hid);
    if (!rec) {
      loginThrottle.recordFailure(ip);
      return res.status(401).json({ error: 'Unknown household or wrong password' });
    }
    try {
      const store = await readStore(hid);
      const people = Array.isArray(store.people) ? store.people : [];
      if (!u || !people.includes(u)) {
        loginThrottle.recordFailure(ip);
        return res.status(400).json({ error: 'Choose a valid household member' });
      }
    } catch (e) {
      console.error(e);
      loginThrottle.recordFailure(ip);
      return res.status(500).json({ error: 'Failed to verify member' });
    }
    loginThrottle.recordSuccess(ip);
    const token = createAuthToken(u, hid, { readOnly: true });
    const maxAgeSec = Math.floor(COOKIE_MAX_AGE_MS / 1000);
    res.setHeader(
      'Set-Cookie',
      `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`,
    );
    return res.json({ ok: true, household: hid, readOnly: true });
  }

  const rec = householdReg.householdRecord(householdRegistry, hid);
  if (!rec) {
    loginThrottle.recordFailure(ip);
    return res.status(401).json({ error: 'Unknown household or wrong password' });
  }
  if (!householdReg.verifyPassword(p, rec.salt, rec.hash)) {
    loginThrottle.recordFailure(ip);
    return res.status(401).json({ error: 'Unknown household or wrong password' });
  }
  loginThrottle.recordSuccess(ip);
  const token = createAuthToken(u || 'member', hid);
  const maxAgeSec = Math.floor(COOKIE_MAX_AGE_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`,
  );
  res.json({ ok: true, household: hid, readOnly: false });
});

/**
 * List people names for a household after password check (login step 1 → step 2).
 * Uses the same brute-force throttle as POST /api/login on failures; does not record success (session is created only by POST /api/login).
 */
app.post('/api/login/members', async (req, res) => {
  const ip = clientIp(req);
  const throttle = loginThrottle.check(ip);
  if (!throttle.allowed) {
    const retry = throttle.retryAfterSec || 60;
    res.setHeader('Retry-After', String(retry));
    return res.status(429).json({
      error: `Too many sign-in attempts. Try again in ${retry} seconds.`,
      retryAfterSeconds: retry,
    });
  }
  try {
    ensureRegistryLoaded();
    let hidRaw = req.body && req.body.household != null ? req.body.household : '';
    if (hidRaw === '' || hidRaw == null) hidRaw = 'default';
    const hid = householdReg.sanitizeHouseholdId(hidRaw);
    if (!hid) {
      loginThrottle.recordFailure(ip);
      return res.status(400).json({ error: 'Invalid household id' });
    }
    const rec = householdReg.householdRecord(householdRegistry, hid);
    if (!rec) {
      loginThrottle.recordFailure(ip);
      return res.status(401).json({ error: 'Unknown household or wrong password' });
    }
    const p = String(req.body && req.body.password != null ? req.body.password : '');
    const guestMode = req.body && req.body.guest === true;
    const guestSecret =
      process.env.CHORELOG_GUEST_PASSWORD && String(process.env.CHORELOG_GUEST_PASSWORD).trim();
    if (guestMode) {
      if (!guestSecret || p !== guestSecret) {
        loginThrottle.recordFailure(ip);
        return res.status(401).json({ error: 'Unknown household or wrong password' });
      }
    } else if (!householdReg.verifyPassword(p, rec.salt, rec.hash)) {
      loginThrottle.recordFailure(ip);
      return res.status(401).json({ error: 'Unknown household or wrong password' });
    }
    const store = await readStore(hid);
    let people = Array.isArray(store.people) ? store.people.slice() : [];
    people = people
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());
    if (people.length === 0) {
      people = [...DEFAULT_PEOPLE];
    }
    people.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    res.json({ people });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load household members' });
  }
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.status(204).end();
});

/**
 * Create a household (isolated store). No auth cookie required.
 * — If `CHORELOG_OPEN_REGISTRATION=1`: body `{ id, password }` (min 8 chars).
 * — Else if `CHORELOG_MASTER_PASSWORD` is set: body `{ id, password, masterPassword }`.
 * — Otherwise: 403.
 */
app.post('/api/households', (req, res) => {
  try {
    ensureRegistryLoaded();
    const master = process.env.CHORELOG_MASTER_PASSWORD;
    const openReg = process.env.CHORELOG_OPEN_REGISTRATION === '1';
    let allowed = false;
    if (openReg) {
      allowed = true;
    } else if (master && String(req.body && req.body.masterPassword) === master) {
      allowed = true;
    }
    if (!allowed) {
      return res.status(403).json({ error: 'Household creation is disabled on this server.' });
    }
    const id = householdReg.sanitizeHouseholdId(req.body && (req.body.id || req.body.householdId));
    const pw = req.body && req.body.password;
    if (!id || typeof pw !== 'string' || pw.length < 8) {
      return res.status(400).json({ error: 'Invalid household id or password (min 8 characters)' });
    }
    if (householdRegistry.households[id]) {
      return res.status(409).json({ error: 'Household already exists' });
    }
    householdReg.addHousehold(DATA_DIR, householdRegistry, id, pw);
    res.status(201).json({ ok: true, household: id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create household' });
  }
});

app.get('/api/entries', async (req, res) => {
  try {
    await ensureSeed(req.householdId);
    const store = await readStore(req.householdId);
    res.json({
      entries: store.entries,
      people: store.people,
      locations: store.locations,
      scheduledChores: store.scheduledChores || [],
      chorePresets: store.chorePresets || [],
      quickChoreIds: store.quickChoreIds || [],
      discordWebhook: store.discordWebhook || normalizeDiscordWebhook(null),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load entries' });
  }
});

app.post('/api/scheduled-chores', requireReadWrite, async (req, res) => {
  try {
    const title = String(req.body && req.body.title ? req.body.title : '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });
    const recurrence =
      req.body && req.body.recurrence === 'monthlyWeekday' ? 'monthlyWeekday' : 'interval';
    let intervalDays = Number(req.body && req.body.intervalDays);
    let monthOrdinal;
    let weekday;
    if (recurrence === 'monthlyWeekday') {
      monthOrdinal = Number(req.body && req.body.monthOrdinal);
      weekday = Number(req.body && req.body.weekday);
      if (!Number.isFinite(monthOrdinal) || monthOrdinal < 1 || monthOrdinal > 5) {
        return res.status(400).json({ error: 'monthOrdinal must be 1–5 (5 = last weekday of month)' });
      }
      if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) {
        return res.status(400).json({ error: 'weekday must be 0–6 (Sun–Sat)' });
      }
      intervalDays = 30;
    } else {
      if (!Number.isFinite(intervalDays) || intervalDays < 1) intervalDays = 7;
      if (intervalDays > 3650) intervalDays = 3650;
    }
    const store = await readStore(req.householdId);
    if (!store.scheduledChores) store.scheduledChores = [];
    const startsOn =
      parseCalendarDateParam(req.body && req.body.startsOn) ??
      parseCalendarDateParam(req.body && req.body.createdAt) ??
      localCalendarDateISO();
    const ts = nowISO();
    const reminderEnabled = req.body && req.body.reminderEnabled === false ? false : true;
    const row = {
      id: newId(),
      title,
      intervalDays,
      recurrence,
      ...(recurrence === 'monthlyWeekday' ? { monthOrdinal, weekday } : {}),
      startsOn,
      lastCompletedAt: null,
      reminderEnabled,
      createdAt: ts,
      updatedAt: ts,
    };
    store.scheduledChores.push(row);
    const detail =
      recurrence === 'monthlyWeekday'
        ? `Calendar monthly (ordinal ${monthOrdinal}, weekday ${weekday}); id ${row.id}`
        : `Every ${intervalDays} day(s); id ${row.id}`;
    appendAudit(store, req, {
      action: 'scheduled.create',
      target: title,
      detail,
    });
    await writeStore(req.householdId, store);
    res.status(201).json({ scheduledChores: store.scheduledChores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create scheduled chore' });
  }
});

app.put('/api/scheduled-chores/:id', requireReadWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore(req.householdId);
    const list = store.scheduledChores || [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    if (req.body.title != null) {
      const t = String(req.body.title).trim();
      if (t) list[idx].title = t;
    }
    if (req.body.intervalDays != null) {
      let n = Number(req.body.intervalDays);
      if (Number.isFinite(n) && n >= 1 && n <= 3650) list[idx].intervalDays = n;
    }
    if (req.body.startsOn != null) {
      const nextStart = parseCalendarDateParam(req.body.startsOn);
      if (!nextStart) {
        return res.status(400).json({ error: 'startsOn must be YYYY-MM-DD calendar date' });
      }
      list[idx].startsOn = nextStart;
    }
    if (req.body.reminderEnabled != null) {
      list[idx].reminderEnabled = Boolean(req.body.reminderEnabled);
    }
    if (req.body.recurrence != null) {
      const r = req.body.recurrence === 'monthlyWeekday' ? 'monthlyWeekday' : 'interval';
      list[idx].recurrence = r;
      if (r === 'interval') {
        delete list[idx].monthOrdinal;
        delete list[idx].weekday;
      }
    }
    if (req.body.monthOrdinal != null) {
      const mo = Number(req.body.monthOrdinal);
      if (Number.isFinite(mo) && mo >= 1 && mo <= 5) list[idx].monthOrdinal = mo;
    }
    if (req.body.weekday != null) {
      const wd = Number(req.body.weekday);
      if (Number.isFinite(wd) && wd >= 0 && wd <= 6) list[idx].weekday = wd;
    }
    if (list[idx].recurrence === 'monthlyWeekday') {
      list[idx].intervalDays = 30;
    }
    list[idx].updatedAt = nowISO();
    store.scheduledChores = list;
    const ch = list[idx];
    const changes = [];
    if (req.body.title != null) changes.push('title');
    if (req.body.intervalDays != null) changes.push('interval');
    if (req.body.startsOn != null) changes.push('startsOn');
    if (req.body.reminderEnabled != null) changes.push('reminderEnabled');
    if (req.body.recurrence != null) changes.push('recurrence');
    if (req.body.monthOrdinal != null) changes.push('monthOrdinal');
    if (req.body.weekday != null) changes.push('weekday');
    appendAudit(store, req, {
      action: 'scheduled.update',
      target: ch.title,
      detail: changes.length ? changes.join(', ') : 'update',
    });
    await writeStore(req.householdId, store);
    res.json({ scheduledChores: store.scheduledChores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update scheduled chore' });
  }
});

app.delete('/api/scheduled-chores/:id', requireReadWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore(req.householdId);
    const list = store.scheduledChores || [];
    const removed = list.find((s) => s.id === id);
    const next = list.filter((s) => s.id !== id);
    if (next.length === list.length) return res.status(404).json({ error: 'Not found' });
    store.scheduledChores = next;
    if (store.discordReminderSentAt && store.discordReminderSentAt[id]) {
      delete store.discordReminderSentAt[id];
    }
    if (store.discordDueTodaySentAt && store.discordDueTodaySentAt[id]) {
      delete store.discordDueTodaySentAt[id];
    }
    appendAudit(store, req, {
      action: 'scheduled.delete',
      target: removed ? removed.title : id,
    });
    await writeStore(req.householdId, store);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete scheduled chore' });
  }
});

app.post('/api/scheduled-chores/:id/complete', requireReadWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const person = String(req.body && req.body.person ? req.body.person : '').trim();
    if (!person) return res.status(400).json({ error: 'person is required' });
    const store = await readStore(req.householdId);
    if (!store.people.includes(person)) {
      return res.status(400).json({ error: 'Person must be in your household list' });
    }
    const list = store.scheduledChores || [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const chore = list[idx];
    const completedDate = parseCalendarDateParam(req.body && req.body.completedDate);
    if (!completedDate) {
      return res.status(400).json({ error: 'completedDate is required (YYYY-MM-DD calendar date)' });
    }
    chore.lastCompletedAt = completedDate;
    chore.updatedAt = nowISO();
    const entryTs = nowISO();
    const matchPreset = (store.chorePresets || []).find((x) => x.title === chore.title);
    const locationIds =
      matchPreset && matchPreset.scoringMode === 'per_location'
        ? [...(store.locations || [])]
        : [];
    store.entries.push({
      id: newId(),
      d: completedDate,
      c: chore.title,
      p: person,
      choreId: matchPreset ? matchPreset.id : null,
      locationIds,
      createdAt: entryTs,
      updatedAt: entryTs,
    });
    if (store.discordReminderSentAt && store.discordReminderSentAt[id]) {
      delete store.discordReminderSentAt[id];
    }
    if (store.discordDueTodaySentAt && store.discordDueTodaySentAt[id]) {
      delete store.discordDueTodaySentAt[id];
    }
    appendAudit(store, req, {
      action: 'scheduled.complete',
      target: chore.title,
      detail: `Logged for ${person} on ${completedDate}`,
    });
    await writeStore(req.householdId, store);
    res.json({
      scheduledChores: store.scheduledChores,
      entries: store.entries,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to complete scheduled chore' });
  }
});

app.put('/api/settings', requireReadWrite, async (req, res) => {
  try {
    const body = req.body || {};
    const store = await readStore(req.householdId);
    if (body.people != null) {
      const people = normalizePeople(body.people);
      if (people.length < 1) {
        return res.status(400).json({ error: 'At least one person is required' });
      }
      store.people = people;
    }
    if (body.locations != null) {
      const locations = normalizeLocations(body.locations);
      if (locations.length < 1) {
        return res.status(400).json({ error: 'At least one location is required' });
      }
      store.locations = locations;
      store.entries = (store.entries || []).map((e) => ({
        ...e,
        locationIds: (e.locationIds || []).filter((x) => locations.includes(x)),
      }));
    }
    if (body.chorePresets != null) {
      const next = normalizeChorePresets(body.chorePresets);
      if (!next.filter((p) => !p.deletedAt).length) {
        return res.status(400).json({ error: 'At least one active chore preset is required' });
      }
      store.chorePresets = next;
      store.quickChoreIds = normalizeQuickChoreIds(store.quickChoreIds, store.chorePresets);
    }
    if (body.quickChoreIds != null) {
      store.quickChoreIds = normalizeQuickChoreIds(body.quickChoreIds, store.chorePresets || []);
    }
    if (body.discordWebhook != null) {
      store.discordWebhook = normalizeDiscordWebhook(body.discordWebhook);
    }
    const touched = [];
    if (body.people != null) touched.push('people');
    if (body.locations != null) touched.push('locations');
    if (body.chorePresets != null) touched.push('chorePresets');
    if (body.quickChoreIds != null) touched.push('quickChoreIds');
    if (body.discordWebhook != null) touched.push('discordWebhook');
    if (touched.length) {
      appendAudit(store, req, {
        action: 'settings.update',
        target: 'household',
        detail: touched.join(', '),
      });
    }
    await writeStore(req.householdId, store);
    res.json({
      people: store.people,
      locations: store.locations,
      chorePresets: store.chorePresets,
      quickChoreIds: store.quickChoreIds,
      discordWebhook: store.discordWebhook || normalizeDiscordWebhook(null),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/** Sends the same overdue notification to every configured channel; succeeds if at least one delivery works. */
async function sendOverdueToAllWebhookChannels(w, chore, nextDue, today) {
  const discordPayload = reminderPayloads.buildOverdueDiscordPayload(
    chore,
    nextDue,
    today,
    formatCalendarDateHuman,
  );
  const slackText = reminderPayloads.buildOverdueSlackPlainText(
    chore,
    nextDue,
    today,
    formatCalendarDateHuman,
  );
  const tasks = [];
  if (w.url && isDiscordWebhookUrl(w.url)) {
    tasks.push(() => postDiscordWebhook(w.url, discordPayload));
  }
  if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
    tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
  }
  if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
    tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
  }
  if (!tasks.length) return false;
  const results = await Promise.all(tasks.map((fn) => fn()));
  return results.some(Boolean);
}

async function sendDigestToAllWebhookChannels(w, chores, today) {
  const digestHelpers = { nextDueDateScheduled, formatCalendarDateHuman };
  const discordPayload = reminderPayloads.buildDiscordOverdueDigestPayload(
    chores,
    today,
    digestHelpers,
  );
  const slackText = reminderPayloads.buildSlackOverdueDigestPlainText(chores, today, digestHelpers);
  const tasks = [];
  if (w.url && isDiscordWebhookUrl(w.url)) {
    tasks.push(() => postDiscordWebhook(w.url, discordPayload));
  }
  if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
    tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
  }
  if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
    tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
  }
  if (!tasks.length) return false;
  const results = await Promise.all(tasks.map((fn) => fn()));
  return results.some(Boolean);
}

async function sendDueTodayToAllWebhookChannels(w, chore, today) {
  const discordPayload = reminderPayloads.buildDueTodayDiscordPayload(
    chore,
    today,
    formatCalendarDateHuman,
  );
  const slackText = reminderPayloads.buildDueTodaySlackPlainText(
    chore,
    today,
    formatCalendarDateHuman,
  );
  const tasks = [];
  if (w.url && isDiscordWebhookUrl(w.url)) {
    tasks.push(() => postDiscordWebhook(w.url, discordPayload));
  }
  if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
    tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
  }
  if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
    tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
  }
  if (!tasks.length) return false;
  const results = await Promise.all(tasks.map((fn) => fn()));
  return results.some(Boolean);
}

async function sendDueTodayDigestToAllWebhookChannels(w, chores, today) {
  const discordPayload = reminderPayloads.buildDiscordDueTodayDigestPayload(
    chores,
    today,
    formatCalendarDateHuman,
  );
  const slackText = reminderPayloads.buildSlackDueTodayDigestPlainText(
    chores,
    today,
    formatCalendarDateHuman,
  );
  const tasks = [];
  if (w.url && isDiscordWebhookUrl(w.url)) {
    tasks.push(() => postDiscordWebhook(w.url, discordPayload));
  }
  if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
    tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
  }
  if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
    tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
  }
  if (!tasks.length) return false;
  const results = await Promise.all(tasks.map((fn) => fn()));
  return results.some(Boolean);
}

/**
 * @returns {Promise<{ ok: boolean, pruned: boolean }>}
 */
async function sendPushPayloadToStoreSubscriptions(store, householdId, payloadString) {
  const subs = store.pushSubscriptions;
  if (!subs || !subs.length || !pushSend.vapidKeysPresent()) return { ok: false, pruned: false };
  if (!pushSend.ensureVapidConfigured()) return { ok: false, pruned: false };
  const dead = [];
  let any = false;
  for (const sub of subs) {
    const subscription = { endpoint: sub.endpoint, keys: sub.keys };
    try {
      await pushSend.sendToSubscription(subscription, payloadString);
      any = true;
    } catch (e) {
      const code = e.statusCode;
      if (code === 404 || code === 410) dead.push(sub.endpoint);
      else console.error('Web push:', e.message || e);
      /* Sync errors from web-push (e.g. bad key encoding) have no statusCode */
      if (code == null && e && e.message) console.error('Web push (detail):', sub.endpoint.slice(0, 48), e.message);
    }
  }
  if (dead.length) {
    store.pushSubscriptions = subs.filter((s) => !dead.includes(s.endpoint));
    await writeStore(householdId, store);
    return { ok: any, pruned: true };
  }
  return { ok: any, pruned: false };
}

let discordReminderJobRunning = false;
async function runDiscordReminders() {
  if (discordReminderJobRunning) return;
  discordReminderJobRunning = true;
  try {
    ensureRegistryLoaded();
    const ids = householdReg.listHouseholdIds(householdRegistry);
    for (const householdId of ids) {
      const store = await readStore(householdId);
      const w = store.discordWebhook || normalizeDiscordWebhook(null);
      if (!w.enabled) continue;
      const webhookPath = hasReminderDestination(w);
      const hasPush =
        browserPushAllowedForHousehold(householdId) &&
        pushSend.vapidKeysPresent() &&
        Array.isArray(store.pushSubscriptions) &&
        store.pushSubscriptions.length > 0;

      const overdueWh = webhookPath && w.overdueNotifyWebhooks;
      const overduePush = hasPush && w.overdueNotifyPush;
      const dueTodayWh = webhookPath && w.dueTodayNotifyWebhooks;
      const dueTodayPush = hasPush && w.dueTodayNotifyPush;
      const anyOverdueChannel = overdueWh || overduePush;
      const anyDueTodayChannel = w.dueTodayEnabled && (dueTodayWh || dueTodayPush);

      if (!anyOverdueChannel && !anyDueTodayChannel) continue;
      if (isInReminderQuietHours(w)) continue;

      const today = localCalendarDateISO();
      const intervalMs = w.reminderIntervalMinutes * 60 * 1000;
      const now = Date.now();
      const list = store.scheduledChores || [];
      let sentMap = { ...store.discordReminderSentAt };
      let dueTodayMap = { ...(store.discordDueTodaySentAt || {}) };
      let changed = false;

      for (const s of list) {
        if (s.reminderEnabled === false) continue;
        const next = nextDueDateScheduled(s);

        if (next > today) {
          if (sentMap[s.id]) {
            delete sentMap[s.id];
            changed = true;
          }
          if (dueTodayMap[s.id]) {
            delete dueTodayMap[s.id];
            changed = true;
          }
          continue;
        }

        if (next < today) {
          if (dueTodayMap[s.id]) {
            delete dueTodayMap[s.id];
            changed = true;
          }
          if (!anyOverdueChannel) continue;

          const last = sentMap[s.id] ? Date.parse(sentMap[s.id]) : 0;
          if (last && now - last < intervalMs) continue;

          let okWh = false;
          let pushRes = { ok: false, pruned: false };
          if (overdueWh) okWh = await sendOverdueToAllWebhookChannels(w, s, next, today);
          if (overduePush) {
            pushRes = await sendPushPayloadToStoreSubscriptions(
              store,
              householdId,
              reminderPayloads.buildOverduePushPayloadJson(s, next, today, formatCalendarDateHuman),
            );
          }
          if (pushRes.pruned) changed = true;
          if (okWh || pushRes.ok) {
            sentMap[s.id] = new Date().toISOString();
            changed = true;
          }
          continue;
        }

        /* next === today */
        if (sentMap[s.id]) {
          delete sentMap[s.id];
          changed = true;
        }

        if (!w.dueTodayEnabled) {
          if (dueTodayMap[s.id]) {
            delete dueTodayMap[s.id];
            changed = true;
          }
          continue;
        }

        if (!anyDueTodayChannel) continue;

        if (dueTodayMap[s.id] === today) continue;

        let okWh = false;
        let pushRes = { ok: false, pruned: false };
        if (dueTodayWh) okWh = await sendDueTodayToAllWebhookChannels(w, s, today);
        if (dueTodayPush) {
          pushRes = await sendPushPayloadToStoreSubscriptions(
            store,
            householdId,
            reminderPayloads.buildDueTodayPushPayloadJson(s, today),
          );
        }
        if (pushRes.pruned) changed = true;
        if (okWh || pushRes.ok) {
          dueTodayMap[s.id] = today;
          changed = true;
        }
      }

      if (changed) {
        store.discordReminderSentAt = sentMap;
        store.discordDueTodaySentAt = dueTodayMap;
        await writeStore(householdId, store);
      }
    }
  } catch (e) {
    console.error('Discord reminders:', e);
  } finally {
    discordReminderJobRunning = false;
  }
}

app.post('/api/discord-webhook/test', requireReadWrite, async (req, res) => {
  try {
    const store = await readStore(req.householdId);
    const w = store.discordWebhook || normalizeDiscordWebhook(null);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fromBody =
      typeof body.url === 'string' || typeof body.slackWebhookUrl === 'string' || typeof body.genericWebhookUrl === 'string';
    const overrides = fromBody
      ? {
          url: typeof body.url === 'string' ? body.url : undefined,
          slackWebhookUrl: typeof body.slackWebhookUrl === 'string' ? body.slackWebhookUrl : undefined,
          genericWebhookUrl: typeof body.genericWebhookUrl === 'string' ? body.genericWebhookUrl : undefined,
        }
      : {};
    const ok = await sendTestToAllWebhookChannels(w, overrides);
    if (!ok) {
      return res.status(400).json({
        error: 'Enter a valid webhook URL (Discord, Slack hooks.slack.com, or generic HTTPS)',
      });
    }
    appendAudit(store, req, {
      action: 'discord.test',
      target: 'webhook',
      detail: 'Test message sent',
    });
    await writeStore(req.householdId, store);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Test failed' });
  }
});

app.post('/api/discord-webhook/remind-now', requireReadWrite, async (req, res) => {
  try {
    const store = await readStore(req.householdId);
    const w = store.discordWebhook || normalizeDiscordWebhook(null);
    if (!w.enabled) {
      return res.status(400).json({
        error: 'Turn on “Send overdue reminders automatically” to post reminders (webhooks and/or push)',
      });
    }
    const webhookPath = hasReminderDestination(w);
    const hasPush =
      browserPushAllowedForHousehold(req.householdId) &&
      pushSend.vapidKeysPresent() &&
      Array.isArray(store.pushSubscriptions) &&
      store.pushSubscriptions.length > 0;
    if (!webhookPath && !hasPush) {
      return res.status(400).json({
        error:
          'Configure at least one webhook URL or subscribe a device to browser push (Settings → Integrations)',
      });
    }

    const overdueWh = webhookPath && w.overdueNotifyWebhooks;
    const overduePush = hasPush && w.overdueNotifyPush;
    const dueTodayWh = webhookPath && w.dueTodayNotifyWebhooks;
    const dueTodayPush = hasPush && w.dueTodayNotifyPush;
    const anyOverdue = overdueWh || overduePush;
    const anyDueToday = w.dueTodayEnabled && (dueTodayWh || dueTodayPush);

    const today = localCalendarDateISO();
    const overdue = (store.scheduledChores || []).filter(
      (s) => s.reminderEnabled !== false && nextDueDateScheduled(s) < today,
    );
    const dueToday = (store.scheduledChores || []).filter(
      (s) => s.reminderEnabled !== false && nextDueDateScheduled(s) === today,
    );

    if (!overdue.length && !dueToday.length) {
      return res.json({
        ok: true,
        sentOverdue: 0,
        sentDueToday: 0,
        message: 'No overdue or due-today scheduled chores',
      });
    }

    const wantOverdue = overdue.length && anyOverdue;
    const wantDueToday = dueToday.length && anyDueToday;
    if (!wantOverdue && !wantDueToday) {
      return res.status(400).json({
        error:
          'Enable reminder channels in Settings (overdue and/or “due today”, webhooks and/or browser push).',
      });
    }

    if (isInReminderQuietHours(w)) {
      return res.status(400).json({ error: 'Quiet hours are active; reminders are not sent' });
    }

    let okWhOverdue = false;
    let okWhDueToday = false;
    let pushOverdue = { ok: false, pruned: false };
    let pushDueToday = { ok: false, pruned: false };

    if (wantOverdue) {
      if (overdueWh) okWhOverdue = await sendDigestToAllWebhookChannels(w, overdue, today);
      if (overduePush) {
        pushOverdue = await sendPushPayloadToStoreSubscriptions(
          store,
          req.householdId,
          reminderPayloads.buildDigestPushPayloadJson(overdue, today, { nextDueDateScheduled }),
        );
      }
    }
    if (wantDueToday) {
      if (dueTodayWh) okWhDueToday = await sendDueTodayDigestToAllWebhookChannels(w, dueToday, today);
      if (dueTodayPush) {
        pushDueToday = await sendPushPayloadToStoreSubscriptions(
          store,
          req.householdId,
          reminderPayloads.buildDueTodayDigestPushPayloadJson(dueToday, today),
        );
      }
    }

    const anyOk =
      okWhOverdue || okWhDueToday || pushOverdue.ok || pushDueToday.ok;
    if (!anyOk) {
      return res.status(502).json({ error: 'Could not deliver reminders to webhooks or push subscriptions' });
    }

    const parts = [];
    if (overdue.length && wantOverdue) {
      parts.push(
        `${overdue.length} overdue${okWhOverdue ? ' (webhook)' : ''}${pushOverdue.ok ? ' (push)' : ''}`,
      );
    }
    if (dueToday.length && wantDueToday) {
      parts.push(
        `${dueToday.length} due today${okWhDueToday ? ' (webhook)' : ''}${pushDueToday.ok ? ' (push)' : ''}`,
      );
    }

    appendAudit(store, req, {
      action: 'discord.remind_now',
      target: 'reminders',
      detail: parts.length ? `Posted ${parts.join('; ')}` : 'Manual reminder',
    });
    await writeStore(req.householdId, store);
    res.json({
      ok: true,
      sentOverdue: overdue.length,
      sentDueToday: dueToday.length,
      webhooksOverdue: okWhOverdue,
      webhooksDueToday: okWhDueToday,
      pushOverdue: pushOverdue.ok,
      pushDueToday: pushDueToday.ok,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to send' });
  }
});

function csvEscapeCell(value) {
  const s = value == null ? '' : String(value);
  if (/[\r\n",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function entryPointsForCsvExport(entry, presetMap) {
  if (!entry || !entry.choreId) return '';
  const pr = presetMap.get(entry.choreId);
  if (!pr) return '';
  if (pr.scoringMode === 'per_location') {
    const n = Array.isArray(entry.locationIds) ? entry.locationIds.length : 0;
    return pr.points * n;
  }
  return pr.points;
}

function buildEntriesCsv(store) {
  const presets = store.chorePresets || [];
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  const entries = [...(store.entries || [])].sort((a, b) => {
    const da = String(a.d || '');
    const db = String(b.d || '');
    if (da !== db) return da.localeCompare(db);
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const headers = [
    'id',
    'date',
    'chore',
    'person',
    'points',
    'preset_title',
    'chore_id',
    'locations',
    'created_at',
    'updated_at',
  ];
  const lines = [headers.map(csvEscapeCell).join(',')];
  for (const e of entries) {
    if (e.deletedAt) continue;
    const pr = e.choreId ? presetMap.get(e.choreId) : null;
    const presetTitle = pr ? pr.title : '';
    const pts = entryPointsForCsvExport(e, presetMap);
    const locs = Array.isArray(e.locationIds) ? e.locationIds.join('; ') : '';
    const row = [
      csvEscapeCell(e.id),
      csvEscapeCell(e.d),
      csvEscapeCell(e.c),
      csvEscapeCell(e.p),
      csvEscapeCell(pts === '' ? '' : pts),
      csvEscapeCell(presetTitle),
      csvEscapeCell(e.choreId || ''),
      csvEscapeCell(locs),
      csvEscapeCell(e.createdAt || ''),
      csvEscapeCell(e.updatedAt || ''),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}

app.get('/api/export/entries.csv', async (req, res) => {
  try {
    await ensureSeed(req.householdId);
    const store = await readStore(req.householdId);
    const csv = buildEntriesCsv(store);
    const filename = `chorelog-entries-${localCalendarDateISO()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    await ensureSeed(req.householdId);
    const store = await readStore(req.householdId);
    const payload = {
      version: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      people: store.people,
      locations: store.locations || [],
      entries: store.entries,
      scheduledChores: store.scheduledChores || [],
      chorePresets: store.chorePresets || [],
      quickChoreIds: store.quickChoreIds || [],
      discordWebhook: store.discordWebhook || normalizeDiscordWebhook(null),
      auditLog: store.auditLog || [],
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="chorelog-backup.json"');
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to export' });
  }
});

app.post('/api/import', requireReadWrite, async (req, res) => {
  try {
    const body = req.body || {};
    const mode = body.mode === 'merge' ? 'merge' : 'replace';
    const incomingPeople = normalizePeople(body.people);
    const incomingLocations = Array.isArray(body.locations) ? normalizeLocations(body.locations) : [];
    const incomingEntries = Array.isArray(body.entries) ? body.entries : [];
    const incomingScheduled = normalizeScheduledChores(Array.isArray(body.scheduledChores) ? body.scheduledChores : []);
    const incomingPresets = normalizeChorePresets(Array.isArray(body.chorePresets) ? body.chorePresets : []);

    if (incomingPeople.length < 1) {
      return res.status(400).json({ error: 'Import must include at least one person' });
    }

    const store = await readStore(req.householdId);

    if (mode === 'replace') {
      if (IMPORT_BACKUP_ENABLED) {
        try {
          await writeHouseholdBackupSnapshot(req.householdId, 'pre-import-replace');
        } catch (e) {
          console.error(e);
          return res.status(500).json({ error: 'Failed to create backup before import' });
        }
      }
      const nextEntries = [];
      for (const row of incomingEntries) {
        if (!row || typeof row.d !== 'string' || typeof row.p !== 'string') continue;
        const d = row.d.trim();
        const p = row.p.trim();
        const c = typeof row.c === 'string' ? row.c.trim() : '';
        const choreId = row.choreId != null && typeof row.choreId === 'string' ? row.choreId.trim() : '';
        if (!d || !p) continue;
        if (!c && !choreId) continue;
        const e = normalizeEntry({
          id: newId(),
          d,
          c,
          p,
          choreId: choreId || null,
          locationIds: Array.isArray(row.locationIds) ? row.locationIds : [],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        });
        if (e) nextEntries.push(e);
      }
      store.entries = nextEntries;
      store.people = incomingPeople;
      store.locations = incomingLocations.length ? incomingLocations : [...DEFAULT_LOCATIONS];
      store.entries = store.entries.map((e) => ({
        ...e,
        locationIds: (e.locationIds || []).filter((x) => store.locations.includes(x)),
      }));
      store.scheduledChores = incomingScheduled.map((s) => ({
        ...s,
        id: newId(),
      }));
      if (incomingPresets.length) {
        store.chorePresets = incomingPresets.map((p) => normalizeChorePreset(p)).filter(Boolean);
        if (!store.chorePresets.filter((p) => !p.deletedAt).length) {
          return res.status(400).json({ error: 'Import must include at least one active chore preset' });
        }
        store.quickChoreIds = normalizeQuickChoreIds(
          Array.isArray(body.quickChoreIds) ? body.quickChoreIds : [],
          store.chorePresets,
        );
      } else {
        store.chorePresets = defaultChorePresets();
        store.quickChoreIds = store.chorePresets.slice(0, 6).map((x) => x.id);
      }
      store.discordReminderSentAt = {};
      store.discordDueTodaySentAt = {};
      store.discordWebhook = normalizeDiscordWebhook(
        body.discordWebhook != null ? body.discordWebhook : null,
      );
      store.auditLog = normalizeAuditLog(body.auditLog || []);
      appendAudit(store, req, {
        action: 'import.replace',
        target: 'store',
        detail: `${store.entries.length} log entries, ${store.scheduledChores.length} scheduled`,
      });
    } else {
      const peopleSet = new Set(store.people);
      incomingPeople.forEach((p) => peopleSet.add(p));
      store.people = normalizePeople([...peopleSet]);
      const locationSet = new Set(store.locations || []);
      incomingLocations.forEach((x) => locationSet.add(x));
      store.locations = normalizeLocations([...locationSet]);
      for (const row of incomingEntries) {
        if (!row || typeof row.d !== 'string' || typeof row.p !== 'string') continue;
        const d = row.d.trim();
        const p = row.p.trim();
        const c = typeof row.c === 'string' ? row.c.trim() : '';
        const choreId = row.choreId != null && typeof row.choreId === 'string' ? row.choreId.trim() : '';
        if (!d || !p) continue;
        if (!c && !choreId) continue;
        const e = normalizeEntry({
          id: newId(),
          d,
          c,
          p,
          choreId: choreId || null,
          locationIds: Array.isArray(row.locationIds) ? row.locationIds : [],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        });
        if (e) store.entries.push(e);
      }
      store.entries = store.entries.map((e) => ({
        ...e,
        locationIds: (e.locationIds || []).filter((x) => store.locations.includes(x)),
      }));
      if (!store.scheduledChores) store.scheduledChores = [];
      for (const s of incomingScheduled) {
        store.scheduledChores.push({ ...s, id: newId() });
      }
      const incomingAudit = normalizeAuditLog(body.auditLog || []);
      store.auditLog = [...incomingAudit, ...(store.auditLog || [])].slice(0, MAX_AUDIT_ENTRIES);
      appendAudit(store, req, {
        action: 'import.merge',
        target: 'store',
        detail: `Imported ${incomingEntries.length} row(s) from file`,
      });
    }

    await writeStore(req.householdId, store);
    res.json({
      entries: store.entries,
      people: store.people,
      locations: store.locations || [],
      scheduledChores: store.scheduledChores || [],
      chorePresets: store.chorePresets || [],
      quickChoreIds: store.quickChoreIds || [],
      discordWebhook: store.discordWebhook || normalizeDiscordWebhook(null),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to import' });
  }
});

app.post('/api/entries', requireReadWrite, async (req, res) => {
  try {
    const body = req.body;
    const items = Array.isArray(body.entries) ? body.entries : null;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Expected { entries: [{ d, p, choreId? }, ...] }' });
    }
    const store = await readStore(req.householdId);
    const presets = store.chorePresets || [];
    const added = [];
    for (const row of items) {
      if (!row || typeof row.d !== 'string' || typeof row.p !== 'string') {
        return res.status(400).json({ error: 'Each entry needs d and p' });
      }
      const d = row.d.trim();
      const p = row.p.trim();
      if (!d || !p) continue;
      let c = '';
      let choreId = null;
      let locationIds = [];
      const cid = typeof row.choreId === 'string' ? row.choreId.trim() : '';
      if (cid) {
        const preset = presets.find((x) => x.id === cid && !x.deletedAt);
        if (!preset) return res.status(400).json({ error: 'Unknown choreId' });
        c = preset.title;
        choreId = cid;
        if (Array.isArray(row.locationIds)) {
          locationIds = row.locationIds
            .filter((x) => typeof x === 'string' && store.locations.includes(x))
            .map((x) => x.trim())
            .filter(Boolean);
        }
        if (preset.scoringMode === 'per_location' && !locationIds.length) {
          return res.status(400).json({ error: 'Location-based chores need at least one location' });
        }
      } else {
        if (typeof row.c !== 'string') return res.status(400).json({ error: 'Each entry needs choreId or c' });
        c = row.c.trim();
        if (!c) continue;
      }
      const ts = nowISO();
      const entry = {
        id: newId(),
        d,
        c,
        p,
        choreId,
        locationIds,
        createdAt: ts,
        updatedAt: ts,
      };
      store.entries.push(entry);
      added.push(entry);
    }
    if (added.length) {
      const summary =
        added.length === 1 ? added[0].c.slice(0, 200) : `${added.length} chores`;
      const detail = added
        .map((e) => `${e.d} · ${e.c} · ${e.p}`)
        .join(' · ')
        .slice(0, 800);
      appendAudit(store, req, {
        action: 'entry.create',
        target: summary,
        ...(detail ? { detail } : {}),
      });
    }
    await writeStore(req.householdId, store);
    res.status(201).json({ entries: added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save entries' });
  }
});

app.post('/api/entries/:id/restore', requireReadWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore(req.householdId);
    const idx = store.entries.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const row = store.entries[idx];
    if (!row.deletedAt) {
      return res.status(400).json({ error: 'Entry is not removed' });
    }
    delete row.deletedAt;
    row.updatedAt = nowISO();
    appendAudit(store, req, {
      action: 'entry.restore',
      target: row.c.slice(0, 200),
      detail: `${row.d} · ${row.p}`,
    });
    await writeStore(req.householdId, store);
    res.json({ entry: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to restore entry' });
  }
});

app.put('/api/entries/:id', requireReadWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const d = parseCalendarDateParam(req.body && req.body.d);
    const p = String(req.body && req.body.p != null ? req.body.p : '').trim();
    if (!d || !p) {
      return res.status(400).json({ error: 'Valid d (YYYY-MM-DD) and p are required' });
    }
    const store = await readStore(req.householdId);
    if (!store.people.includes(p)) {
      return res.status(400).json({ error: 'Person must be in your household list' });
    }
    const presets = store.chorePresets || [];
    let c = '';
    let choreId = null;
    let locationIds = [];
    const cid = typeof req.body.choreId === 'string' ? req.body.choreId.trim() : '';
    if (cid) {
      const preset = presets.find((x) => x.id === cid && !x.deletedAt);
      if (!preset) return res.status(400).json({ error: 'Unknown choreId' });
      c = preset.title;
      choreId = cid;
      if (Array.isArray(req.body.locationIds)) {
        locationIds = req.body.locationIds
          .filter((x) => typeof x === 'string' && store.locations.includes(x))
          .map((x) => x.trim())
          .filter(Boolean);
      }
      if (preset.scoringMode === 'per_location' && !locationIds.length) {
        return res.status(400).json({ error: 'Location-based chores need at least one location' });
      }
    } else {
      c = String(req.body && req.body.c != null ? req.body.c : '').trim();
      if (!c) return res.status(400).json({ error: 'choreId or c is required' });
    }
    const idx = store.entries.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const prev = store.entries[idx];
    if (prev.deletedAt) {
      return res.status(400).json({ error: 'Cannot edit a removed entry; restore it first' });
    }
    const createdAt = typeof prev.createdAt === 'string' ? prev.createdAt : nowISO();
    store.entries[idx] = { id, d, c, p, choreId, locationIds, createdAt, updatedAt: nowISO() };
    appendAudit(store, req, {
      action: 'entry.update',
      target: c.slice(0, 200),
      detail: `Was: ${prev.d} · ${prev.c.slice(0, 120)} · ${prev.p}`,
    });
    await writeStore(req.householdId, store);
    res.json({ entry: store.entries[idx] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

app.delete('/api/entries/:id', requireReadWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore(req.householdId);
    const idx = store.entries.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const row = store.entries[idx];
    if (row.deletedAt) {
      return res.status(400).json({ error: 'Entry already removed' });
    }
    row.deletedAt = nowISO();
    row.updatedAt = nowISO();
    appendAudit(store, req, {
      action: 'entry.archive',
      target: row.c.slice(0, 200),
      detail: `${row.d} · ${row.p}`,
    });
    await writeStore(req.householdId, store);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/site.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'site.webmanifest'));
});

app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/icons/app-icon.svg');
});

app.use(express.static(__dirname));

/** Exported for `npm test` / CI only (`normalizeStore` is otherwise internal). */
module.exports = { normalizeStore, buildEntriesCsv };

if (require.main === module) {
  setInterval(() => {
    runDiscordReminders().catch((e) => console.error(e));
  }, 60 * 1000);

  if (SCHEDULED_BACKUP_MS > 0) {
    setInterval(() => {
      runScheduledBackupsForAllHouseholds().catch((e) => console.error(e));
    }, SCHEDULED_BACKUP_MS);
  }

  app.listen(PORT, () => {
    console.log(`Chore tracker: http://127.0.0.1:${PORT}/`);
  });
}
