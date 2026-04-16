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
const pushSend = require('./lib/push-send.cjs');
const vapidPersist = require('./lib/vapid-persist.cjs');
const { buildGitHubBuildMeta } = require('./lib/build-meta.cjs');
const { MAX_AUDIT_ENTRIES, appendAudit } = require('./lib/audit-log.cjs');
const {
  formatCalendarDateHuman,
  localCalendarDateISO,
  nextDueDateScheduled,
  nowISO,
  parseCalendarDateParam,
} = require('./lib/server-dates.cjs');
const {
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
} = require('./lib/store-normalize.cjs');
const {
  AUTH_COOKIE,
  COOKIE_MAX_AGE_MS,
  buildRequireApiAuth,
  createAuthToken,
  requireReadWrite,
  verifyAuthCookie,
} = require('./lib/auth-session.cjs');
const { buildEntriesCsv } = require('./lib/csv-export.cjs');
const { createBackupManager } = require('./lib/backup-manager.cjs');
const { createStoreAccess } = require('./lib/store-access.cjs');
const { createReminderEngine } = require('./lib/reminder-engine.cjs');
const {
  hasReminderDestination,
  isDiscordWebhookUrl,
  isGenericHttpsWebhookUrl,
  isInReminderQuietHours,
  isSlackIncomingWebhookUrl,
  normalizeDiscordWebhook,
  postDiscordWebhook,
  postSlackIncomingWebhook,
  sendTestToAllWebhookChannels,
} = require('./lib/webhook-channels.cjs');
const {
  MAX_PUSH_SUBSCRIPTIONS,
  normalizePushPreferencePrefs,
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

function hasUpdatedAtConflict(expectedUpdatedAt, currentUpdatedAt) {
  const expected =
    typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt.trim() : '';
  if (!expected) return false;
  const current =
    typeof currentUpdatedAt === 'string' ? currentUpdatedAt.trim() : '';
  return expected !== current;
}

function sendUpdatedAtConflict(res, currentUpdatedAt) {
  return res.status(409).json({
    error: 'Resource was modified by another session. Refresh and try again.',
    code: 'conflict_updated_at',
    currentUpdatedAt:
      typeof currentUpdatedAt === 'string' ? currentUpdatedAt : null,
  });
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

let ensureRegistryLoaded;
let ensureSeed;
let getRegistry;
let getSqliteStoreForHousehold;
let householdDataFile;
let householdSqlitePath;
let readStore;
let writeStore;

const loginThrottle = createLoginThrottle({ dataDir: DATA_DIR });

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

({
  ensureRegistryLoaded,
  ensureSeed,
  getRegistry,
  getSqliteStoreForHousehold,
  householdDataFile,
  householdSqlitePath,
  readStore,
  writeStore,
} = createStoreAccess({
  DATA_DIR,
  LEGACY_DATA_FILE,
  DEFAULT_PEOPLE,
  DEFAULT_LOCATIONS,
  USE_SQLITE_PER_HOUSEHOLD,
  openSqliteStore,
  householdReg,
  normalizeEntry,
  normalizeStore,
  expandRaw,
  RAW_SEED,
}));

function newId() {
  return crypto.randomUUID();
}

const IMPORT_BACKUP_ENABLED =
  process.env.CHORELOG_IMPORT_BACKUP !== '0' && process.env.CHORELOG_IMPORT_BACKUP !== 'false';
const BACKUP_RETENTION = Math.max(1, Math.min(200, Number(process.env.CHORELOG_BACKUP_RETENTION) || 25));
const SCHEDULED_BACKUP_MS = (() => {
  const n = Number(process.env.CHORELOG_SCHEDULED_BACKUP_MS);
  return Number.isFinite(n) && n >= 60000 ? Math.floor(n) : 0;
})();
const { writeHouseholdBackupSnapshot, runScheduledBackupsForAllHouseholds } = createBackupManager({
  DATA_DIR,
  EXPORT_SCHEMA_VERSION,
  BACKUP_RETENTION,
  normalizeDiscordWebhook,
  readStore,
  ensureRegistryLoaded,
  getRegistry,
  householdsRoot: householdReg.householdsRoot,
});

const app = express();
app.set('trust proxy', process.env.CHORELOG_TRUST_PROXY === '1');
app.use(express.json({ limit: '5mb' }));

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
const requireApiAuth = buildRequireApiAuth({
  ensureRegistryLoaded,
  getRegistry,
});
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
  if (!getRegistry().households[hid]) {
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
      subscriptions: list.map((s) => ({
        id: s.id,
        endpoint: s.endpoint,
        member: s.member || '',
        prefs: normalizePushPreferencePrefs(s.prefs),
      })),
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
    const prefs = normalizePushPreferencePrefs(body.preferences || body.prefs);
    const row = normalizePushSubscription({
      endpoint: sub.endpoint,
      keys: sub.keys,
      createdAt: nowISO(),
      member: req.authPayload.user || '',
      prefs,
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
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        keys: row.keys,
        createdAt: row.createdAt,
        member: row.member,
        prefs: row.prefs,
      };
    }
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

app.post('/api/push/preferences', requireReadWrite, async (req, res) => {
  try {
    if (!browserPushAllowedForHousehold(req.householdId)) {
      return res.status(403).json({
        error: 'Browser push is only available for the default household.',
        code: 'push_household_not_allowed',
      });
    }
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    const prefs = normalizePushPreferencePrefs(req.body?.preferences || req.body?.prefs);
    const store = await readStore(req.householdId);
    const list = normalizePushSubscriptions(store.pushSubscriptions || []);
    const idx = list.findIndex((s) => s.endpoint === endpoint);
    if (idx < 0) return res.status(404).json({ error: 'Subscription not found' });
    list[idx] = {
      ...list[idx],
      member: req.authPayload.user || list[idx].member || '',
      prefs,
    };
    store.pushSubscriptions = normalizePushSubscriptions(list);
    appendAudit(store, req, {
      action: 'push.preferences',
      target: 'web-push',
      detail: 'Browser push preferences updated',
    });
    await writeStore(req.householdId, store);
    res.json({ ok: true, prefs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save push preferences' });
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
    const rec = householdReg.householdRecord(getRegistry(), hid);
    if (!rec || !householdReg.verifyPassword(cur, rec.salt, rec.hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    householdReg.updateHouseholdPassword(DATA_DIR, getRegistry(), hid, newPw);
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
    const rec = householdReg.householdRecord(getRegistry(), hid);
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

  const rec = householdReg.householdRecord(getRegistry(), hid);
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
    const rec = householdReg.householdRecord(getRegistry(), hid);
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
    if (getRegistry().households[id]) {
      return res.status(409).json({ error: 'Household already exists' });
    }
    householdReg.addHousehold(DATA_DIR, getRegistry(), id, pw);
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
    const expectedUpdatedAt =
      typeof req.body?.expectedUpdatedAt === 'string'
        ? req.body.expectedUpdatedAt
        : '';
    if (hasUpdatedAtConflict(expectedUpdatedAt, list[idx].updatedAt)) {
      return sendUpdatedAtConflict(res, list[idx].updatedAt);
    }
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
    if (!removed) return res.status(404).json({ error: 'Not found' });
    const expectedUpdatedAt =
      typeof req.body?.expectedUpdatedAt === 'string'
        ? req.body.expectedUpdatedAt
        : '';
    if (hasUpdatedAtConflict(expectedUpdatedAt, removed.updatedAt)) {
      return sendUpdatedAtConflict(res, removed.updatedAt);
    }
    const next = list.filter((s) => s.id !== id);
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
    const expectedUpdatedAt =
      typeof req.body?.expectedUpdatedAt === 'string'
        ? req.body.expectedUpdatedAt
        : '';
    if (hasUpdatedAtConflict(expectedUpdatedAt, chore.updatedAt)) {
      return sendUpdatedAtConflict(res, chore.updatedAt);
    }
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

const {
  runDiscordReminders,
  sendDigestToAllWebhookChannels,
  sendDueTodayDigestToAllWebhookChannels,
  sendPushPayloadToStoreSubscriptions,
} = createReminderEngine({
  browserPushAllowedForHousehold,
  formatCalendarDateHuman,
  hasReminderDestination,
  isDiscordWebhookUrl,
  isGenericHttpsWebhookUrl,
  isInReminderQuietHours,
  isSlackIncomingWebhookUrl,
  localCalendarDateISO,
  nextDueDateScheduled,
  normalizeDiscordWebhook,
  postDiscordWebhook,
  postSlackIncomingWebhook,
  pushSend,
  readStore,
  reminderPayloads,
  writeStore,
  ensureRegistryLoaded,
  listHouseholdIds: householdReg.listHouseholdIds,
  getRegistry,
});

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
      const note = typeof row.note === 'string' ? row.note.trim().slice(0, 280) : '';
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
        ...(note ? { note } : {}),
      };
      store.entries.push(entry);
      added.push(entry);
    }
    if (added.length) {
      const summary =
        added.length === 1 ? added[0].c.slice(0, 200) : `${added.length} chores`;
      const detail = added
        .map((e) => `${e.d} · ${e.c} · ${e.p}${e.note ? ` · ${e.note}` : ''}`)
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
    const hasNoteField = Object.prototype.hasOwnProperty.call(req.body || {}, 'note');
    let note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 280) : '';
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
    const expectedUpdatedAt =
      typeof req.body?.expectedUpdatedAt === 'string'
        ? req.body.expectedUpdatedAt
        : '';
    if (hasUpdatedAtConflict(expectedUpdatedAt, prev.updatedAt)) {
      return sendUpdatedAtConflict(res, prev.updatedAt);
    }
    if (prev.deletedAt) {
      return res.status(400).json({ error: 'Cannot edit a removed entry; restore it first' });
    }
    const createdAt = typeof prev.createdAt === 'string' ? prev.createdAt : nowISO();
    if (!hasNoteField && typeof prev.note === 'string') note = prev.note.trim().slice(0, 280);
    store.entries[idx] = {
      id,
      d,
      c,
      p,
      choreId,
      locationIds,
      createdAt,
      updatedAt: nowISO(),
      ...(note ? { note } : {}),
    };
    appendAudit(store, req, {
      action: 'entry.update',
      target: c.slice(0, 200),
      detail: `Was: ${prev.d} · ${prev.c.slice(0, 120)} · ${prev.p}${prev.note ? ` · ${prev.note.slice(0, 120)}` : ''}`,
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
    const expectedUpdatedAt =
      typeof req.body?.expectedUpdatedAt === 'string'
        ? req.body.expectedUpdatedAt
        : '';
    if (hasUpdatedAtConflict(expectedUpdatedAt, row.updatedAt)) {
      return sendUpdatedAtConflict(res, row.updatedAt);
    }
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
