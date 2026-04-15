const fs = require('fs');
const path = require('path');

function createStoreAccess({
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
}) {
  let householdRegistry = null;
  const sqliteStoreByHousehold = new Map();

  function ensureRegistryLoaded() {
    if (!householdRegistry) {
      householdRegistry = householdReg.ensureRegistry(DATA_DIR, LEGACY_DATA_FILE, process.env.CHORELOG_PASSWORD);
    }
    return householdRegistry;
  }

  function getRegistry() {
    return householdRegistry;
  }

  function householdsRoot() {
    return householdReg.householdsRoot(DATA_DIR);
  }

  function householdDataFile(hid) {
    return path.join(householdsRoot(), hid, 'chores.json');
  }

  function householdSqlitePath(hid) {
    if (!USE_SQLITE_PER_HOUSEHOLD) return null;
    return path.join(householdsRoot(), hid, 'chores.db');
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

  async function ensureSeed(householdId, newId) {
    const store = await readStore(householdId);
    if (store.entries.length > 0) return;
    const expanded = expandRaw(RAW_SEED);
    store.entries = expanded
      .map((e) => normalizeEntry({ id: newId(), d: e.d, c: e.c, p: e.p }))
      .filter(Boolean);
    if (!store.people || store.people.length === 0) store.people = [...DEFAULT_PEOPLE];
    await writeStore(householdId, store);
  }

  return {
    ensureRegistryLoaded,
    ensureSeed,
    getRegistry,
    getSqliteStoreForHousehold,
    householdDataFile,
    householdSqlitePath,
    readStore,
    writeStore,
  };
}

module.exports = {
  createStoreAccess,
};
