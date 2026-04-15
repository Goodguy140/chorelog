const scheduledRecurrence = require('./scheduled-recurrence.cjs');

/** Calendar YYYY-MM-DD in the Node process timezone (not UTC). */
function localCalendarDateISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Validates YYYY-MM-DD; rejects invalid calendar dates. */
function parseCalendarDateParam(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return s;
}

function nowISO() {
  return new Date().toISOString();
}

/** Local calendar YYYY-MM-DD from an ISO datetime string (process timezone). */
function calendarDateFromISO(iso) {
  if (typeof iso !== 'string' || !iso.includes('T')) return localCalendarDateISO();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return localCalendarDateISO();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar helpers for scheduled chores (aligned with `js/utils/date.js`). */
function addDaysIso(isoDate, n) {
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
    if (t.includes('T')) return localCalendarDateISO();
  }
  return localCalendarDateISO();
}

function nextDueDateScheduled(s) {
  return scheduledRecurrence.nextDueDateForScheduled(s, {
    addDays: addDaysIso,
    scheduledStartsOnCalendar,
  });
}

/** YYYY-MM-DD → locale medium date for Discord (matches client “Due Mon D, YYYY” style). */
function formatCalendarDateHuman(isoDate) {
  if (!isoDate || typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return String(isoDate || '').trim() || '—';
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

module.exports = {
  calendarDateFromISO,
  formatCalendarDateHuman,
  localCalendarDateISO,
  nextDueDateScheduled,
  nowISO,
  parseCalendarDateParam,
};
