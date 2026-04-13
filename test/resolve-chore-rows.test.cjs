/**
 * Same rules as `resolveChorePayloadRows` in `js/presets.js` (presets passed in).
 */
const { test } = require('node:test');
const assert = require('node:assert');

function resolveChorePayloadRows(raw, chorePresets) {
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, reason: 'empty' };
  const rows = [];
  for (const part of parts) {
    const preset = chorePresets.find((p) => p.title.toLowerCase() === part.toLowerCase());
    if (!preset) {
      return { ok: false, reason: 'unknown', unknownPart: part };
    }
    rows.push({ choreId: preset.id });
  }
  return { ok: true, rows };
}

const presets = [
  { id: 'a', title: 'Dishes', points: 1, color: '#378ADD', scoringMode: 'flat' },
  { id: 'b', title: 'Bathroom', points: 2, color: '#111111', scoringMode: 'flat' },
];

test('semicolon bundle resolves to preset ids', () => {
  const r = resolveChorePayloadRows('Dishes; Bathroom', presets);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.rows, [{ choreId: 'a' }, { choreId: 'b' }]);
});

test('case-insensitive title match', () => {
  const r = resolveChorePayloadRows('dishes', presets);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.rows, [{ choreId: 'a' }]);
});

test('unknown segment fails with part name', () => {
  const r = resolveChorePayloadRows('Dishes; Unknown chore', presets);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unknown');
  assert.strictEqual(r.unknownPart, 'Unknown chore');
});

test('empty after trim', () => {
  const r = resolveChorePayloadRows('   ;  ', presets);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'empty');
});
