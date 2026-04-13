'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REGISTRY_NAME = 'registry.json';
const REGISTRY_DB_NAME = 'registry.db';

function householdsRoot(dataDir) {
  return path.join(dataDir, 'households');
}

function registryPath(dataDir) {
  return path.join(householdsRoot(dataDir), REGISTRY_NAME);
}

function registryDbPath(dataDir) {
  return path.join(householdsRoot(dataDir), REGISTRY_DB_NAME);
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(Buffer.from(String(plain), 'utf8'), salt, 64);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function verifyPassword(plain, saltB64, hashB64) {
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(Buffer.from(String(plain), 'utf8'), salt, 64);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Lowercase slug: letter/digit start, then [a-z0-9_-]. Max 63 chars. */
function sanitizeHouseholdId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(s)) return null;
  return s;
}

let _registryDb = null;
let _registryDbForDataDir = null;

function openRegistryDb(dataDir) {
  const dbPath = registryDbPath(dataDir);
  if (_registryDb && _registryDbForDataDir === dbPath) {
    return _registryDb;
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (e) {
    const err = new Error('Household registry requires Node.js 22+ (built-in node:sqlite).');
    err.cause = e;
    throw err;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL');
  } catch {
    /* ignore */
  }
  try {
    db.exec('PRAGMA busy_timeout = 8000');
  } catch {
    /* ignore */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS household_registry (
      id TEXT PRIMARY KEY NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  _registryDb = db;
  _registryDbForDataDir = dbPath;
  return db;
}

function countHouseholdRows(db) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM household_registry').get();
  const n = row && row.c != null ? Number(row.c) : 0;
  return Number.isFinite(n) ? n : 0;
}

function loadRegistryObjectFromDb(db) {
  const rows = db.prepare('SELECT id, salt, hash, created_at FROM household_registry ORDER BY id').all();
  const households = {};
  for (const row of rows) {
    households[row.id] = {
      salt: row.salt,
      hash: row.hash,
      createdAt: row.created_at,
    };
  }
  return { version: 1, households };
}

function replaceAllHouseholdsInDb(dataDir, households) {
  const db = openRegistryDb(dataDir);
  const del = db.prepare('DELETE FROM household_registry');
  const ins = db.prepare(
    'INSERT INTO household_registry (id, salt, hash, created_at) VALUES (?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    del.run();
    for (const id of Object.keys(households || {})) {
      const h = households[id];
      ins.run(id, h.salt, h.hash, h.createdAt || new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function loadRegistry(dataDir) {
  const db = openRegistryDb(dataDir);
  return loadRegistryObjectFromDb(db);
}

function saveRegistry(dataDir, reg) {
  replaceAllHouseholdsInDb(dataDir, reg.households);
}

function listHouseholdIds(reg) {
  return Object.keys(reg.households || {}).sort();
}

function householdRecord(reg, id) {
  return reg.households && reg.households[id] ? reg.households[id] : null;
}

/**
 * Create or migrate registry. Legacy `registry.json` is imported into SQLite once, then renamed to `registry.json.migrated`.
 * Legacy single-file `data/chores.json` → `data/households/default/chores.json`.
 */
function ensureRegistry(dataDir, legacyChoresPath, initialPassword) {
  const db = openRegistryDb(dataDir);
  const jp = registryPath(dataDir);

  if (countHouseholdRows(db) > 0) {
    return loadRegistryObjectFromDb(db);
  }

  if (fs.existsSync(jp)) {
    const raw = fs.readFileSync(jp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.households !== 'object' || !parsed.households) {
      throw new Error('Invalid registry.json');
    }
    replaceAllHouseholdsInDb(dataDir, parsed.households);
    try {
      fs.renameSync(jp, `${jp}.migrated`);
      console.log('Chorelog: migrated data/households/registry.json → registry.db (SQLite)');
    } catch (e) {
      console.warn('Chorelog: could not rename registry.json after SQLite migration', e);
    }
    return loadRegistryObjectFromDb(db);
  }

  const pw = initialPassword != null ? String(initialPassword) : process.env.CHORELOG_PASSWORD || 'monkey';
  const root = householdsRoot(dataDir);
  fs.mkdirSync(root, { recursive: true });
  const defDir = path.join(root, 'default');
  fs.mkdirSync(defDir, { recursive: true });

  if (fs.existsSync(legacyChoresPath)) {
    const dest = path.join(defDir, 'chores.json');
    fs.renameSync(legacyChoresPath, dest);
    console.log('Chorelog: migrated data/chores.json → data/households/default/chores.json');
  }

  const { salt, hash } = hashPassword(pw);
  const createdAt = new Date().toISOString();
  const households = {
    default: {
      salt,
      hash,
      createdAt,
    },
  };
  replaceAllHouseholdsInDb(dataDir, households);
  console.log(
    'Chorelog: created household registry in SQLite (household "default"). Set CHORELOG_PASSWORD on first run or change password in Settings.',
  );
  return { version: 1, households };
}

/** Add a household (new directory + registry row). Caller must sanitize id. */
function addHousehold(dataDir, reg, id, plainPassword) {
  const { salt, hash } = hashPassword(plainPassword);
  if (!reg.households) reg.households = {};
  const createdAt = new Date().toISOString();
  reg.households[id] = {
    salt,
    hash,
    createdAt,
  };
  const dir = path.join(householdsRoot(dataDir), id);
  fs.mkdirSync(dir, { recursive: true });
  const db = openRegistryDb(dataDir);
  db.prepare(
    'INSERT INTO household_registry (id, salt, hash, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, salt, hash, createdAt);
}

function updateHouseholdPassword(dataDir, reg, id, plainPassword) {
  if (!reg.households || !reg.households[id]) throw new Error('Unknown household');
  const { salt, hash } = hashPassword(plainPassword);
  reg.households[id].salt = salt;
  reg.households[id].hash = hash;
  const db = openRegistryDb(dataDir);
  const result = db.prepare('UPDATE household_registry SET salt = ?, hash = ? WHERE id = ?').run(salt, hash, id);
  if (!result || result.changes === 0) {
    db.prepare(
      'INSERT INTO household_registry (id, salt, hash, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, salt, hash, reg.households[id].createdAt || new Date().toISOString());
  }
}

module.exports = {
  householdsRoot,
  registryPath,
  registryDbPath,
  hashPassword,
  verifyPassword,
  sanitizeHouseholdId,
  loadRegistry,
  saveRegistry,
  listHouseholdIds,
  householdRecord,
  ensureRegistry,
  addHousehold,
  updateHouseholdPassword,
};
