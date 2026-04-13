'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

test('household registry migrates registry.json into SQLite and verifies password', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorelog-reg-'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataDir, 'households'), { recursive: true });
  const hr = require('../lib/households-registry.cjs');
  const { salt, hash } = hr.hashPassword('test-secret');
  const reg = {
    version: 1,
    households: {
      alpha: { salt, hash, createdAt: '2020-01-01T00:00:00.000Z' },
    },
  };
  fs.writeFileSync(path.join(dataDir, 'households', 'registry.json'), JSON.stringify(reg), 'utf8');
  const legacyMissing = path.join(dataDir, 'no-chores.json');
  const loaded = hr.ensureRegistry(dataDir, legacyMissing, 'unused');
  assert.strictEqual(Object.keys(loaded.households).length, 1);
  assert.ok(hr.verifyPassword('test-secret', loaded.households.alpha.salt, loaded.households.alpha.hash));
  assert.ok(fs.existsSync(hr.registryDbPath(dataDir)));
  assert.ok(fs.existsSync(path.join(dataDir, 'households', 'registry.json.migrated')));
});
