'use strict';

/**
 * Next due date for scheduled chores.
 * - `interval` (default): anchor + intervalDays (legacy).
 * - `monthlyWeekday`: nth weekday of each month (nth 1–4 = first–fourth, 5 = last).
 * anchor = lastCompletedAt || startsOn; monthly uses strict-after completion when lastCompletedAt set.
 */

function parseYmd(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return { y: Number(m[1]), m0: Number(m[2]) - 1, d: Number(m[3]) };
}

function toYmd(y, m0, day) {
  const mm = String(m0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/** nth 1–4: first–fourth occurrence of weekday in month; nth 5: last occurrence. weekday: 0=Sun … 6=Sat (JS). */
function nthWeekdayInMonth(year, month0, nth, weekday) {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  if (nth >= 1 && nth <= 4) {
    const first = new Date(year, month0, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    const day = 1 + offset + (nth - 1) * 7;
    if (day > lastDay) return null;
    return toYmd(year, month0, day);
  }
  if (nth === 5) {
    for (let d = lastDay; d >= 1; d--) {
      const dt = new Date(year, month0, d);
      if (dt.getDay() === weekday) return toYmd(year, month0, d);
    }
    return null;
  }
  return null;
}

function compareYmd(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * @param {string} anchor YYYY-MM-DD
 * @param {number} nth 1–5
 * @param {number} weekday 0–6
 * @param {boolean} strictAfter if true, due must be > anchor (after marking done on anchor day)
 */
function nextMonthlyNthWeekday(anchor, nth, weekday, strictAfter) {
  const p = parseYmd(anchor);
  if (!p) return anchor;
  const n = Math.min(5, Math.max(1, nth));
  const wd = ((Number(weekday) % 7) + 7) % 7;

  for (let hop = 0; hop < 48; hop++) {
    const totalM = p.m0 + hop;
    const y = p.y + Math.floor(totalM / 12);
    const m0 = ((totalM % 12) + 12) % 12;
    const cand = nthWeekdayInMonth(y, m0, n, wd);
    if (!cand) continue;
    if (strictAfter) {
      if (compareYmd(cand, anchor) > 0) return cand;
    } else if (compareYmd(cand, anchor) >= 0) {
      return cand;
    }
  }
  return anchor;
}

function nextDueDateForScheduled(s, helpers) {
  const addDays = helpers.addDays;
  const scheduledStartsOnCalendar = helpers.scheduledStartsOnCalendar;
  const anchor = s.lastCompletedAt || scheduledStartsOnCalendar(s);
  const strictAfter = Boolean(s.lastCompletedAt);

  if (s.recurrence === 'monthlyWeekday') {
    const nth = Number(s.monthOrdinal);
    const wd = Number(s.weekday);
    if (Number.isFinite(nth) && nth >= 1 && nth <= 5 && Number.isFinite(wd) && wd >= 0 && wd <= 6) {
      return nextMonthlyNthWeekday(anchor, nth, wd, strictAfter);
    }
  }

  let intervalDays = Number(s.intervalDays);
  if (!Number.isFinite(intervalDays) || intervalDays < 1) intervalDays = 7;
  return addDays(anchor, intervalDays);
}

module.exports = {
  nextDueDateForScheduled,
  nextMonthlyNthWeekday,
  nthWeekdayInMonth,
};
