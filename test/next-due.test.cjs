/**
 * Mirrors `js/utils/date.js` — keep in sync when editing scheduled due logic.
 */
const { test } = require('node:test');
const assert = require('node:assert');

function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function scheduledStartsOnCalendar(s) {
  if (s.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(String(s.startsOn))) return String(s.startsOn);
  const ca = s.createdAt;
  if (typeof ca === 'string') {
    const t = ca.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (t.includes('T')) return localDateISO(new Date(t));
  }
  return localDateISO();
}

function nextDueDate(s) {
  const anchor = s.lastCompletedAt || scheduledStartsOnCalendar(s);
  return addDays(anchor, s.intervalDays);
}

test('next due uses lastCompletedAt when set', () => {
  const s = {
    startsOn: '2026-01-01',
    lastCompletedAt: '2026-02-01',
    intervalDays: 7,
    createdAt: '2026-01-01T12:00:00.000Z',
  };
  assert.strictEqual(nextDueDate(s), '2026-02-08');
});

test('next due uses startsOn when never completed', () => {
  const s = {
    startsOn: '2026-03-10',
    intervalDays: 14,
    createdAt: '2026-03-10T12:00:00.000Z',
  };
  assert.strictEqual(nextDueDate(s), '2026-03-24');
});

test('month boundary crossing', () => {
  const s = { startsOn: '2026-01-28', intervalDays: 7, createdAt: '2026-01-28T12:00:00.000Z' };
  assert.strictEqual(nextDueDate(s), '2026-02-04');
});
