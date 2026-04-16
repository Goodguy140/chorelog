const fs = require('fs');
const path = require('path');

function createBackupManager({
  DATA_DIR,
  EXPORT_SCHEMA_VERSION,
  BACKUP_RETENTION,
  normalizeDiscordWebhook,
  readStore,
  ensureRegistryLoaded,
  getRegistry,
  householdsRoot,
}) {
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
    const registry = getRegistry();
    const hid = String(householdId || '').trim();
    if (!hid || !registry.households[hid]) {
      throw new Error('Invalid household');
    }
    const store = await readStore(hid);
    const backupDir = path.join(householdsRoot(DATA_DIR), hid, 'backups');
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
    return { filename, relativePath: path.join('households', hid, 'backups', filename) };
  }

  async function runScheduledBackupsForAllHouseholds() {
    ensureRegistryLoaded();
    const registry = getRegistry();
    const ids = Object.keys(registry.households || {});
    for (const hid of ids) {
      try {
        await writeHouseholdBackupSnapshot(hid, 'scheduled');
      } catch (e) {
        console.error(`Chorelog: scheduled backup failed for household "${hid}":`, e.message || e);
      }
    }
  }

  return {
    runScheduledBackupsForAllHouseholds,
    writeHouseholdBackupSnapshot,
  };
}

module.exports = {
  createBackupManager,
};
