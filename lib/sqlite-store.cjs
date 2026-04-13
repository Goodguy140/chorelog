'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Single-row JSON document store with WAL for safer concurrent access than rename-on-write JSON.
 * Uses Node's built-in `node:sqlite` (Node 22+). Loaded only when this function runs.
 * @param {string} dbPath Absolute path to SQLite file
 * @param {string} jsonFallbackPath Path to legacy chores.json for one-time migration when DB is empty
 */
function openSqliteStore(dbPath, jsonFallbackPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (e) {
    const err = new Error(
      'CHORELOG_SQLITE_PATH requires Node.js 22 or later (built-in node:sqlite module).',
    );
    err.cause = e;
    throw err;
  }
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL');
  } catch {
    /* ignore if unsupported */
  }
  try {
    db.exec('PRAGMA busy_timeout = 8000');
  } catch {
    /* ignore */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS chorelog_store (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );
  `);

  const selectRow = db.prepare('SELECT json FROM chorelog_store WHERE id = 1');
  const upsert = db.prepare(
    'INSERT INTO chorelog_store (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
  );

  let migratedFromJson = false;
  const row = selectRow.get();
  const empty = !row || !String(row.json || '').trim();
  if (empty) {
    try {
      const buf = fs.readFileSync(jsonFallbackPath, 'utf8');
      const parsed = JSON.parse(buf);
      const jsonStr = JSON.stringify(parsed);
      upsert.run(jsonStr);
      migratedFromJson = true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  return {
    readJsonString() {
      const r = selectRow.get();
      return r && r.json ? String(r.json) : null;
    },
    writeJsonString(jsonStr) {
      upsert.run(jsonStr);
    },
    migratedFromJson,
    close() {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { openSqliteStore };
