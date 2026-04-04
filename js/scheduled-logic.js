import { localDateISO, nextDueDate } from './utils/date.js';

export function scheduledStatus(s) {
  const next = nextDueDate(s);
  const today = localDateISO();
  if (next < today) {
    const daysPast = Math.floor((new Date(today + 'T12:00:00') - new Date(next + 'T12:00:00')) / 864e5);
    return { next, label: `${daysPast} day${daysPast === 1 ? '' : 's'} overdue`, cls: 'overdue' };
  }
  if (next === today) {
    return { next, label: 'Due today', cls: 'today' };
  }
  const daysUntil = Math.floor((new Date(next + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5);
  if (daysUntil <= 3) {
    return { next, label: `Due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`, cls: 'soon' };
  }
  return {
    next,
    label: `Due ${new Date(next + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
    cls: 'later',
  };
}

export function intervalLabel(days) {
  const d = Number(days);
  if (d === 1) return 'daily';
  if (d === 7) return 'weekly';
  if (d === 14) return 'every 2 weeks';
  if (d === 30) return '~monthly';
  if (d === 60) return '~every 2 months';
  if (d === 90) return '~every 3 months';
  return `every ${d} days`;
}
