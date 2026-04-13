const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeStore, buildEntriesCsv } = require('../server.js');

const preset = {
  id: 'preset-1',
  title: 'Dishes',
  points: 3,
  color: '#378ADD',
  scoringMode: 'flat',
};

test('buildEntriesCsv escapes commas in chore text', () => {
  const store = normalizeStore({
    entries: [
      {
        id: 'e1',
        d: '2026-01-01',
        c: 'Hello, world',
        p: 'A',
        choreId: null,
        locationIds: [],
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-01-01T12:00:00.000Z',
      },
    ],
    chorePresets: [preset],
    quickChoreIds: [preset.id],
  });
  const csv = buildEntriesCsv(store);
  assert.ok(csv.includes('"Hello, world"'));
  assert.ok(/^id,date,chore/m.test(csv));
});

test('buildEntriesCsv includes points and preset title when choreId set', () => {
  const store = normalizeStore({
    entries: [
      {
        id: 'e2',
        d: '2026-01-02',
        c: 'Dishes',
        p: 'B',
        choreId: preset.id,
        locationIds: [],
        createdAt: '2026-01-02T12:00:00.000Z',
        updatedAt: '2026-01-02T12:00:00.000Z',
      },
    ],
    chorePresets: [preset],
    quickChoreIds: [preset.id],
  });
  const csv = buildEntriesCsv(store);
  const lines = csv.split(/\r\n/).filter(Boolean);
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[1].includes('Dishes'), 'preset title column');
  assert.ok(lines[1].includes(',3,'), 'points column');
});
