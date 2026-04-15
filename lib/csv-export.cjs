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

module.exports = {
  buildEntriesCsv,
};
