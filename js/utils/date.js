/** YYYY-MM-DD for the user's local calendar (matches addDays / stored dates, not UTC). */
export function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Calendar YYYY-MM-DD when the schedule interval starts (legacy backups may omit `startsOn`). */
export function scheduledStartsOnCalendar(s) {
  if (s.startsOn && /^\d{4}-\d{2}-\d{2}$/.test(String(s.startsOn))) return String(s.startsOn);
  const ca = s.createdAt;
  if (typeof ca === 'string') {
    const t = ca.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (t.includes('T')) return localDateISO(new Date(t));
  }
  return localDateISO();
}

/** Next due date: lastCompleted + interval, or schedule start + interval if never completed. */
export function nextDueDate(s) {
  const anchor = s.lastCompletedAt || scheduledStartsOnCalendar(s);
  return addDays(anchor, s.intervalDays);
}

export function getMonthKey(d) {
  return d.slice(0, 7);
}

export function getMonthLabel(k, localeBcp47 = 'en-US') {
  const [y, m] = k.split('-');
  return new Date(y, m - 1, 1).toLocaleDateString(localeBcp47, { month: 'long', year: 'numeric' });
}

export function thisCalendarMonthKey() {
  return localDateISO().slice(0, 7);
}
