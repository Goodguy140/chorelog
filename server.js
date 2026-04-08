const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const pkg = require('./package.json');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'chores.json');

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
  return { id, d, c, p, choreId, locationIds, createdAt, updatedAt };
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
  return { id, title, points, color, scoringMode };
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
  const valid = new Set(presets.map((x) => x.id));
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

    out.push({
      id,
      title,
      intervalDays,
      startsOn,
      lastCompletedAt,
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
  const anchor = s.lastCompletedAt || scheduledStartsOnCalendar(s);
  return addDaysIso(anchor, s.intervalDays);
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

function isDiscordWebhookUrl(url) {
  return (
    typeof url === 'string' &&
    /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/[^?\s#]+$/i.test(url.trim())
  );
}

function normalizeDiscordWebhook(raw) {
  const defaults = { enabled: false, url: '', reminderIntervalMinutes: 1440 };
  if (!raw || typeof raw !== 'object') return { ...defaults };
  const enabled = Boolean(raw.enabled);
  let url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (url && !isDiscordWebhookUrl(url)) url = '';
  let reminderIntervalMinutes = Number(raw.reminderIntervalMinutes);
  if (!Number.isFinite(reminderIntervalMinutes)) reminderIntervalMinutes = defaults.reminderIntervalMinutes;
  reminderIntervalMinutes = Math.min(10080, Math.max(15, Math.round(reminderIntervalMinutes)));
  return { enabled, url, reminderIntervalMinutes };
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
      : process.env.CHORELOG_USER || 'house';
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
  if (!chorePresets.length) {
    chorePresets = defaultChorePresets();
    quickChoreIds = chorePresets.slice(0, 6).map((x) => x.id);
  } else if (!quickChoreIds.length && !quickKeyPresent) {
    /* Legacy stores without quickChoreIds: default the bar. Explicit [] means user cleared it. */
    quickChoreIds = chorePresets.slice(0, Math.min(6, chorePresets.length)).map((x) => x.id);
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
  const auditLog = normalizeAuditLog(raw.auditLog);
  return {
    entries,
    people,
    locations,
    scheduledChores,
    chorePresets,
    quickChoreIds,
    discordWebhook,
    discordReminderSentAt,
    auditLog,
  };
}

async function readStore() {
  try {
    const buf = await fs.promises.readFile(DATA_FILE, 'utf8');
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

async function writeStore(data) {
  const normalized = normalizeStore(data);
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  await fs.promises.rename(tmp, DATA_FILE);
}

async function ensureSeed() {
  const store = await readStore();
  if (store.entries.length > 0) return;
  const expanded = expandRaw(RAW_SEED);
  store.entries = expanded
    .map((e) => normalizeEntry({ id: newId(), d: e.d, c: e.c, p: e.p }))
    .filter(Boolean);
  if (!store.people || store.people.length === 0) store.people = [...DEFAULT_PEOPLE];
  await writeStore(store);
}

const app = express();
app.use(express.json({ limit: '5mb' }));

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

function createAuthToken(username) {
  const user =
    String(username || '')
      .trim()
      .slice(0, 120) || (process.env.CHORELOG_USER || 'house');
  const payload = { v: 1, exp: Date.now() + COOKIE_MAX_AGE_MS, user };
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
  return payload;
}

function requireApiAuth(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  if (req.method === 'GET' && req.path === '/api/auth') return next();
  if (req.method === 'GET' && req.path === '/api/version') return next();
  if (req.method === 'POST' && req.path === '/api/login') return next();
  if (req.method === 'POST' && req.path === '/api/logout') return next();
  const payload = verifyAuthCookie(req.headers.cookie);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.authPayload = payload;
  next();
}

app.use(requireApiAuth);

app.get('/api/auth', (req, res) => {
  const payload = verifyAuthCookie(req.headers.cookie);
  if (!payload) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    user:
      typeof payload.user === 'string' && payload.user.trim()
        ? payload.user.trim()
        : process.env.CHORELOG_USER || 'house',
  });
});

app.get('/api/version', (req, res) => {
  res.json({ version: pkg.version });
});

app.get('/api/audit', async (req, res) => {
  try {
    const store = await readStore();
    let limit = Number(req.query && req.query.limit);
    if (!Number.isFinite(limit) || limit < 1) limit = 100;
    if (limit > MAX_AUDIT_ENTRIES) limit = MAX_AUDIT_ENTRIES;
    res.json({ auditLog: (store.auditLog || []).slice(0, limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
});

app.post('/api/login', (req, res) => {
  const u = String(req.body && req.body.username != null ? req.body.username : '').trim();
  const p = String(req.body && req.body.password != null ? req.body.password : '');
  const okUser = process.env.CHORELOG_USER || 'house';
  const okPass = process.env.CHORELOG_PASSWORD || 'monkey';
  if (u !== okUser || p !== okPass) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = createAuthToken(u);
  const maxAgeSec = Math.floor(COOKIE_MAX_AGE_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`,
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.status(204).end();
});

app.get('/api/entries', async (req, res) => {
  try {
    await ensureSeed();
    const store = await readStore();
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

app.post('/api/scheduled-chores', async (req, res) => {
  try {
    const title = String(req.body && req.body.title ? req.body.title : '').trim();
    let intervalDays = Number(req.body && req.body.intervalDays);
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!Number.isFinite(intervalDays) || intervalDays < 1) intervalDays = 7;
    if (intervalDays > 3650) intervalDays = 3650;
    const store = await readStore();
    if (!store.scheduledChores) store.scheduledChores = [];
    const startsOn =
      parseCalendarDateParam(req.body && req.body.startsOn) ??
      parseCalendarDateParam(req.body && req.body.createdAt) ??
      localCalendarDateISO();
    const ts = nowISO();
    const row = {
      id: newId(),
      title,
      intervalDays,
      startsOn,
      lastCompletedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    store.scheduledChores.push(row);
    appendAudit(store, req, {
      action: 'scheduled.create',
      target: title,
      detail: `Every ${intervalDays} day(s); id ${row.id}`,
    });
    await writeStore(store);
    res.status(201).json({ scheduledChores: store.scheduledChores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create scheduled chore' });
  }
});

app.put('/api/scheduled-chores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore();
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
    list[idx].updatedAt = nowISO();
    store.scheduledChores = list;
    const ch = list[idx];
    const changes = [];
    if (req.body.title != null) changes.push('title');
    if (req.body.intervalDays != null) changes.push('interval');
    if (req.body.startsOn != null) changes.push('startsOn');
    appendAudit(store, req, {
      action: 'scheduled.update',
      target: ch.title,
      detail: changes.length ? changes.join(', ') : 'update',
    });
    await writeStore(store);
    res.json({ scheduledChores: store.scheduledChores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update scheduled chore' });
  }
});

app.delete('/api/scheduled-chores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore();
    const list = store.scheduledChores || [];
    const removed = list.find((s) => s.id === id);
    const next = list.filter((s) => s.id !== id);
    if (next.length === list.length) return res.status(404).json({ error: 'Not found' });
    store.scheduledChores = next;
    if (store.discordReminderSentAt && store.discordReminderSentAt[id]) {
      delete store.discordReminderSentAt[id];
    }
    appendAudit(store, req, {
      action: 'scheduled.delete',
      target: removed ? removed.title : id,
    });
    await writeStore(store);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete scheduled chore' });
  }
});

app.post('/api/scheduled-chores/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const person = String(req.body && req.body.person ? req.body.person : '').trim();
    if (!person) return res.status(400).json({ error: 'person is required' });
    const store = await readStore();
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
    appendAudit(store, req, {
      action: 'scheduled.complete',
      target: chore.title,
      detail: `Logged for ${person} on ${completedDate}`,
    });
    await writeStore(store);
    res.json({
      scheduledChores: store.scheduledChores,
      entries: store.entries,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to complete scheduled chore' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const store = await readStore();
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
      if (!next.length) {
        return res.status(400).json({ error: 'At least one chore preset is required' });
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
    await writeStore(store);
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

async function sendDiscordTestMessage(url) {
  return postDiscordWebhook(url, {
    embeds: [
      {
        title: 'Chorelog',
        description: 'Test notification — webhook is configured correctly.',
        color: 0x1d9e75,
      },
    ],
  });
}

async function sendDiscordOverdueMessage(url, chore, nextDue, today) {
  const daysPast = Math.floor(
    (new Date(`${today}T12:00:00`).getTime() - new Date(`${nextDue}T12:00:00`).getTime()) / 864e5,
  );
  const title = String(chore.title || 'Chore').replace(/\*/g, '');
  const dueWhen = formatCalendarDateHuman(nextDue);
  return postDiscordWebhook(url, {
    embeds: [
      {
        title: 'Scheduled chore overdue',
        description: `**${title}** was due **${dueWhen}** (${daysPast} day${daysPast === 1 ? '' : 's'} overdue).`,
        color: 0xe24b4a,
      },
    ],
  });
}

async function sendDiscordOverdueDigest(url, chores, today) {
  const lines = chores.map((s) => {
    const next = nextDueDateScheduled(s);
    const daysPast = Math.floor(
      (new Date(`${today}T12:00:00`).getTime() - new Date(`${next}T12:00:00`).getTime()) / 864e5,
    );
    const title = String(s.title || 'Chore').replace(/\*/g, '');
    const dueWhen = formatCalendarDateHuman(next);
    return `• **${title}** — due ${dueWhen} (${daysPast}d overdue)`;
  });
  const desc = lines.join('\n').slice(0, 3900);
  return postDiscordWebhook(url, {
    content: `**${chores.length} overdue scheduled chore(s)**`,
    embeds: [{ description: desc, color: 0xe24b4a }],
  });
}

let discordReminderJobRunning = false;
async function runDiscordReminders() {
  if (discordReminderJobRunning) return;
  discordReminderJobRunning = true;
  try {
    const store = await readStore();
    const w = store.discordWebhook;
    if (!w || !w.enabled || !w.url) return;

    const today = localCalendarDateISO();
    const intervalMs = w.reminderIntervalMinutes * 60 * 1000;
    const now = Date.now();
    const list = store.scheduledChores || [];
    let sentMap = { ...store.discordReminderSentAt };
    let changed = false;

    for (const s of list) {
      const next = nextDueDateScheduled(s);
      if (next >= today) {
        if (sentMap[s.id]) {
          delete sentMap[s.id];
          changed = true;
        }
        continue;
      }
      const last = sentMap[s.id] ? Date.parse(sentMap[s.id]) : 0;
      if (last && now - last < intervalMs) continue;

      const ok = await sendDiscordOverdueMessage(w.url, s, next, today);
      if (ok) {
        sentMap[s.id] = new Date().toISOString();
        changed = true;
      }
    }

    if (changed) {
      store.discordReminderSentAt = sentMap;
      await writeStore(store);
    }
  } catch (e) {
    console.error('Discord reminders:', e);
  } finally {
    discordReminderJobRunning = false;
  }
}

app.post('/api/discord-webhook/test', async (req, res) => {
  try {
    const store = await readStore();
    const fromBody = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
    const url = fromBody || (store.discordWebhook && store.discordWebhook.url);
    if (!url || !isDiscordWebhookUrl(url)) {
      return res.status(400).json({ error: 'Enter a valid Discord webhook URL' });
    }
    const ok = await sendDiscordTestMessage(url);
    if (!ok) {
      return res.status(502).json({ error: 'Discord did not accept the webhook (check URL)' });
    }
    appendAudit(store, req, {
      action: 'discord.test',
      target: 'webhook',
      detail: 'Test message sent',
    });
    await writeStore(store);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Test failed' });
  }
});

app.post('/api/discord-webhook/remind-now', async (req, res) => {
  try {
    const store = await readStore();
    const w = store.discordWebhook;
    const url = w && w.url;
    if (!url || !isDiscordWebhookUrl(url)) {
      return res.status(400).json({ error: 'Save a valid Discord webhook URL first' });
    }
    const today = localCalendarDateISO();
    const overdue = (store.scheduledChores || []).filter((s) => nextDueDateScheduled(s) < today);
    if (!overdue.length) {
      return res.json({ ok: true, sent: 0, message: 'No overdue scheduled chores' });
    }
    const ok = await sendDiscordOverdueDigest(url, overdue, today);
    if (!ok) return res.status(502).json({ error: 'Discord did not accept the webhook' });
    appendAudit(store, req, {
      action: 'discord.remind_now',
      target: 'webhook',
      detail: `Posted ${overdue.length} overdue chore(s)`,
    });
    await writeStore(store);
    res.json({ ok: true, sent: overdue.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to send' });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    await ensureSeed();
    const store = await readStore();
    const payload = {
      version: 5,
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

app.post('/api/import', async (req, res) => {
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

    const store = await readStore();

    if (mode === 'replace') {
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
        store.quickChoreIds = normalizeQuickChoreIds(
          Array.isArray(body.quickChoreIds) ? body.quickChoreIds : [],
          store.chorePresets,
        );
      } else {
        store.chorePresets = defaultChorePresets();
        store.quickChoreIds = store.chorePresets.slice(0, 6).map((x) => x.id);
      }
      store.discordReminderSentAt = {};
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

    await writeStore(store);
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

app.post('/api/entries', async (req, res) => {
  try {
    const body = req.body;
    const items = Array.isArray(body.entries) ? body.entries : null;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Expected { entries: [{ d, p, choreId? }, ...] }' });
    }
    const store = await readStore();
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
        const preset = presets.find((x) => x.id === cid);
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
    await writeStore(store);
    res.status(201).json({ entries: added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save entries' });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = parseCalendarDateParam(req.body && req.body.d);
    const p = String(req.body && req.body.p != null ? req.body.p : '').trim();
    if (!d || !p) {
      return res.status(400).json({ error: 'Valid d (YYYY-MM-DD) and p are required' });
    }
    const store = await readStore();
    if (!store.people.includes(p)) {
      return res.status(400).json({ error: 'Person must be in your household list' });
    }
    const presets = store.chorePresets || [];
    let c = '';
    let choreId = null;
    let locationIds = [];
    const cid = typeof req.body.choreId === 'string' ? req.body.choreId.trim() : '';
    if (cid) {
      const preset = presets.find((x) => x.id === cid);
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
    const createdAt = typeof prev.createdAt === 'string' ? prev.createdAt : nowISO();
    store.entries[idx] = { id, d, c, p, choreId, locationIds, createdAt, updatedAt: nowISO() };
    appendAudit(store, req, {
      action: 'entry.update',
      target: c.slice(0, 200),
      detail: `Was: ${prev.d} · ${prev.c.slice(0, 120)} · ${prev.p}`,
    });
    await writeStore(store);
    res.json({ entry: store.entries[idx] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore();
    const idx = store.entries.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const gone = store.entries[idx];
    store.entries.splice(idx, 1);
    appendAudit(store, req, {
      action: 'entry.delete',
      target: gone.c.slice(0, 200),
      detail: `${gone.d} · ${gone.p}`,
    });
    await writeStore(store);
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

setInterval(() => {
  runDiscordReminders().catch((e) => console.error(e));
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Chore tracker: http://127.0.0.1:${PORT}/`);
});
