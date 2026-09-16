import type { DateKey } from '../types';
import { addDays, fromDateKey, toDateKey } from './time';

/**
 * The holidays an employer closes for, computed rather than looked up.
 *
 * Every one of these is derivable exactly and permanently: three are fixed
 * dates, three are "the nth weekday of a month", and Good Friday is two days
 * before Easter, which the Gregorian computus gives deterministically. So there
 * is no table here to go stale, no yearly maintenance, and no network call -
 * which is what makes this safe to build at all.
 *
 * It is not a list of US federal holidays and does not try to be. It is the set
 * of days a particular employer is shut, chosen per job.
 */

export type HolidayId =
  | 'newYear'
  | 'goodFriday'
  | 'memorial'
  | 'independence'
  | 'labor'
  | 'thanksgiving'
  | 'thanksgivingFriday'
  | 'christmas';

export const HOLIDAY_LABELS: Record<HolidayId, string> = {
  newYear: "New Year's Day",
  goodFriday: 'Good Friday',
  memorial: 'Memorial Day',
  independence: 'Independence Day',
  labor: 'Labor Day',
  thanksgiving: 'Thanksgiving',
  thanksgivingFriday: 'Day after Thanksgiving',
  christmas: 'Christmas',
};

export const ALL_HOLIDAYS: HolidayId[] = [
  'newYear',
  'goodFriday',
  'memorial',
  'independence',
  'labor',
  'thanksgiving',
  'thanksgivingFriday',
  'christmas',
];

/** What a new job starts with. Change it per job in the editor. */
export const DEFAULT_HOLIDAYS: HolidayId[] = [...ALL_HOLIDAYS];

/**
 * Easter Sunday, by the anonymous Gregorian algorithm (Meeus/Jones/Butcher).
 *
 * Opaque by nature - it is modular arithmetic standing in for a lunisolar
 * calendar - so it is verified against known dates in the tests rather than by
 * reading it.
 */
export function easterSunday(year: number): DateKey {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toDateKey(new Date(year, month - 1, day));
}

/** The nth given weekday of a month, 1-indexed. */
function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, n: number): DateKey {
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return toDateKey(new Date(year, monthIndex, 1 + offset + (n - 1) * 7));
}

/** The last given weekday of a month. */
function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number): DateKey {
  const last = new Date(year, monthIndex + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return toDateKey(new Date(year, monthIndex, last.getDate() - offset));
}

/**
 * The weekday a fixed-date holiday is actually taken.
 *
 * Saturday is taken the Friday before, Sunday the Monday after - the standard
 * US practice. It matters more than it sounds: 1 Jan 2028 is a Saturday, so the
 * day off is Friday 31 December 2027, which is a payday on a
 * last-day-of-the-month schedule.
 */
function observed(date: DateKey): DateKey {
  const day = fromDateKey(date).getDay();
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, 1);
  return date;
}

function dateOf(year: number, id: HolidayId): DateKey {
  switch (id) {
    case 'newYear':
      return observed(toDateKey(new Date(year, 0, 1)));
    case 'goodFriday':
      // Always a Friday by construction, so no observance rule applies.
      return addDays(easterSunday(year), -2);
    case 'memorial':
      return lastWeekdayOfMonth(year, 4, 1); // last Monday in May
    case 'independence':
      return observed(toDateKey(new Date(year, 6, 4)));
    case 'labor':
      return nthWeekdayOfMonth(year, 8, 1, 1); // first Monday in September
    case 'thanksgiving':
      return nthWeekdayOfMonth(year, 10, 4, 4); // fourth Thursday in November
    case 'thanksgivingFriday':
      return addDays(nthWeekdayOfMonth(year, 10, 4, 4), 1);
    case 'christmas':
      return observed(toDateKey(new Date(year, 11, 25)));
  }
}

/**
 * Every selected holiday falling in `year`.
 *
 * New Year's Day is generated for the following year too, because its observed
 * day can land in December of this one - miss that and the 31 December payday
 * is wrong once every few years, which is exactly the kind of rare quiet error
 * nobody catches by eye.
 */
export function holidayDates(year: number, ids: HolidayId[] = DEFAULT_HOLIDAYS): DateKey[] {
  const dates = ids.map((id) => dateOf(year, id));
  if (ids.includes('newYear')) dates.push(dateOf(year + 1, 'newYear'));
  return [...new Set(dates)].filter((d) => d.startsWith(String(year))).sort();
}

export function isHoliday(date: DateKey, ids: HolidayId[] = DEFAULT_HOLIDAYS): boolean {
  if (ids.length === 0) return false;
  const year = Number(date.slice(0, 4));
  return holidayDates(year, ids).includes(date);
}

/** The holidays a job observes; absent means the default set. */
export function holidaysOf(source: { holidays?: HolidayId[] }): HolidayId[] {
  return source.holidays ?? DEFAULT_HOLIDAYS;
}
