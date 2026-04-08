import { localDateISO, nextDueDate } from './utils/date.js';

/** YYYY-MM-DD → short locale date for UI copy (matches server Discord formatting). */
export function formatCalendarDateHuman(isoDate) {
  if (!isoDate || typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return String(isoDate || '').trim() || '—';
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * `next` = YYYY-MM-DD due date; `nextHuman` = readable date for subtitles;
 * `label` = pill text (relative: "In N days", "Today", or "N days overdue").
 */
export function scheduledStatus(s) {
  const next = nextDueDate(s);
  const nextHuman = formatCalendarDateHuman(next);
  const today = localDateISO();
  if (next < today) {
    const daysPast = Math.floor((new Date(today + 'T12:00:00') - new Date(next + 'T12:00:00')) / 864e5);
    return {
      next,
      nextHuman,
      label: `${daysPast} day${daysPast === 1 ? '' : 's'} overdue`,
      cls: 'overdue',
    };
  }
  if (next === today) {
    return { next, nextHuman, label: 'Today', cls: 'today' };
  }
  const daysUntil = Math.floor((new Date(next + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5);
  const label = `In ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
  const cls = daysUntil <= 3 ? 'soon' : 'later';
  return { next, nextHuman, label, cls };
}

export function intervalLabel(days) {
  const d = Number(days);
  if (d === 1) return 'daily';
  if (d === 7) return 'weekly';
  if (d === 14) return 'every 2 weeks';
  if (d === 21) return 'every 3 weeks';
  if (d === 30) return '~monthly';
  if (d === 60) return '~every 2 months';
  if (d === 90) return '~every 3 months';
  return `every ${d} days`;
}
