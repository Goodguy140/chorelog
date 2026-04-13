const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const { openSqliteStore } = require('../lib/sqlite-store.cjs');

test('sqlite store roundtrip and migrates from JSON when DB empty', { skip: !DatabaseSync }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorelog-sql-'));
  const dbPath = path.join(dir, 'store.db');
  const jsonPath = path.join(dir, 'legacy.json');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      entries: [],
      people: ['A'],
      locations: ['L'],
      scheduledChores: [],
      chorePresets: [],
      quickChoreIds: [],
    }),
    'utf8',
  );
  const s = openSqliteStore(dbPath, jsonPath);
  assert.strictEqual(s.migratedFromJson, true);
  const raw = JSON.parse(s.readJsonString());
  assert.deepStrictEqual(raw.people, ['A']);
  const next = { ...raw, people: ['A', 'B'] };
  s.writeJsonString(JSON.stringify(next));
  s.close();

  const s2 = openSqliteStore(dbPath, jsonPath);
  assert.strictEqual(s2.migratedFromJson, false);
  assert.deepStrictEqual(JSON.parse(s2.readJsonString()).people, ['A', 'B']);
  s2.close();
});
