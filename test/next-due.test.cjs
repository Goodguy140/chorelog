/**
 * Scheduled next-due logic — must match `lib/scheduled-recurrence.cjs` (and browser `js/scheduled-recurrence.js`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { nextDueDateForScheduled } = require('../lib/scheduled-recurrence.cjs');

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
  return nextDueDateForScheduled(s, { addDays, scheduledStartsOnCalendar });
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

test('monthlyWeekday: second Tuesday from start of year', () => {
  const s = {
    recurrence: 'monthlyWeekday',
    monthOrdinal: 2,
    weekday: 2,
    intervalDays: 30,
    startsOn: '2026-01-01',
    createdAt: '2026-01-01T12:00:00.000Z',
  };
  assert.strictEqual(nextDueDate(s), '2026-01-13');
});

test('monthlyWeekday: after completion same month advances to next month', () => {
  const s = {
    recurrence: 'monthlyWeekday',
    monthOrdinal: 2,
    weekday: 2,
    intervalDays: 30,
    startsOn: '2026-01-01',
    lastCompletedAt: '2026-01-13',
    createdAt: '2026-01-01T12:00:00.000Z',
  };
  assert.strictEqual(nextDueDate(s), '2026-02-10');
});

test('monthlyWeekday: last Monday of month', () => {
  const s = {
    recurrence: 'monthlyWeekday',
    monthOrdinal: 5,
    weekday: 1,
    intervalDays: 30,
    startsOn: '2026-01-01',
    createdAt: '2026-01-01T12:00:00.000Z',
  };
  assert.strictEqual(nextDueDate(s), '2026-01-26');
});
