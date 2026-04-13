import { localDateISO, nextDueDate } from './utils/date.js';
import { getLocaleBcp47, t } from './i18n.js';

/** YYYY-MM-DD → short locale date for UI copy (matches server Discord formatting). */
export function formatCalendarDateHuman(isoDate) {
  if (!isoDate || typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return String(isoDate || '').trim() || '—';
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(getLocaleBcp47(), { month: 'short', day: 'numeric', year: 'numeric' });
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
      label: daysPast === 1 ? t('scheduled.overdueOne') : t('scheduled.overdueMany', { n: daysPast }),
      cls: 'overdue',
    };
  }
  if (next === today) {
    return { next, nextHuman, label: t('scheduled.today'), cls: 'today' };
  }
  const daysUntil = Math.floor((new Date(next + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5);
  const label =
    daysUntil === 1 ? t('scheduled.inOneDay') : t('scheduled.inDays', { n: daysUntil });
  const cls = daysUntil <= 3 ? 'soon' : 'later';
  return { next, nextHuman, label, cls };
}

/** Pass a scheduled chore object, or legacy `intervalDays` number only. */
export function intervalLabel(schedOrDays) {
  const s = schedOrDays && typeof schedOrDays === 'object' ? schedOrDays : null;
  if (s && s.recurrence === 'monthlyWeekday') {
    const mo = Number(s.monthOrdinal);
    const wd = Number(s.weekday);
    if (Number.isFinite(mo) && mo >= 1 && mo <= 5 && Number.isFinite(wd) && wd >= 0 && wd <= 6) {
      const ordKey = `scheduled.monthOrd${mo}`;
      const wdKey = `scheduled.weekdayLong${wd}`;
      return t('scheduled.intervalMonthlyPattern', { ordinal: t(ordKey), weekday: t(wdKey) });
    }
  }
  const d = Number(s ? s.intervalDays : schedOrDays);
  if (d === 1) return t('scheduled.intervalDaily');
  if (d === 7) return t('scheduled.intervalWeekly');
  if (d === 14) return t('scheduled.interval2w');
  if (d === 21) return t('scheduled.interval3w');
  if (d === 30) return t('scheduled.intervalMonthly');
  if (d === 60) return t('scheduled.interval2m');
  if (d === 90) return t('scheduled.interval3m');
  return t('scheduled.intervalEveryDays', { n: d });
}
