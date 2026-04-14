/**
 * Same rules as `resolveChorePayloadRows` / `matchActivePresetForSegment` in `js/presets.js`.
 */
const { test } = require('node:test');
const assert = require('node:assert');

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
    }
  }
  return dp[m][n];
}

function matchActivePresetForSegment(part, chorePresets) {
  const active = chorePresets.filter((p) => !p.deletedAt);
  const trimmed = String(part || '').trim();
  if (!trimmed) return null;
  const t = trimmed.toLowerCase();
  const exact = active.find((p) => p.title.trim().toLowerCase() === t);
  if (exact) return exact;
  if (trimmed.length < 4) return null;
  const maxDist = Math.min(4, Math.max(2, Math.ceil(trimmed.length * 0.12)));
  let best = null;
  let bestD = Infinity;
  for (const p of active) {
    const pl = p.title.trim().toLowerCase();
    if (!pl) continue;
    const d = levenshtein(t, pl);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best && bestD <= maxDist) return best;
  return null;
}

function resolveChorePayloadRows(raw, chorePresets) {
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, reason: 'empty' };
  const rows = [];
  for (const part of parts) {
    const preset = matchActivePresetForSegment(part, chorePresets);
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

test('archived preset title does not resolve', () => {
  const withArchived = [
    ...presets,
    { id: 'z', title: 'Archived chore', points: 1, color: '#111111', scoringMode: 'flat', deletedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const r = resolveChorePayloadRows('Archived chore', withArchived);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unknown');
});

test('fuzzy segment resolves close typo to preset (length >= 4)', () => {
  const r = resolveChorePayloadRows('Dishs', presets);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.rows, [{ choreId: 'a' }]);
});

test('short segment has no fuzzy match (exact only)', () => {
  const r = resolveChorePayloadRows('Dis', presets);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unknown');
});
