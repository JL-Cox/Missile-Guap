import type { DateKey } from '../types';
import { fromDateKey, toDateKey } from './time';

/**
 * Schedules pinned to days of the month rather than to an interval.
 *
 * Two things in this app work this way: a twice-a-month paycheque and a
 * twice-a-month subscription. They are the same arithmetic, so it lives here
 * once. "Every 2 weeks" and "twice a month" differ by two events a year, and
 * two separate copies of this would be two chances to get that difference
 * wrong in two different ways.
 *
 * Every day is clamped to the month's length, which is what lets "the last
 * day" need no special case: 31 lands on the 28th in February and the 30th in
 * April. A sentinel value for "last" would be one more thing to remember.
 */

export function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * A day-of-month anchor resolved against a real month.
 *
 * The month index may be out of range - 12 means January of the next year, -1
 * means last December - because callers count months forward from an anchor
 * and normalising that by hand is where off-by-one errors live.
 */
export function dayInMonth(year: number, monthIndex: number, day: number): DateKey {
  const clamped = Math.min(Math.max(1, Math.floor(day)), lastDayOfMonth(year, monthIndex));
  return toDateKey(new Date(year, monthIndex, clamped));
}

/**
 * The days a schedule uses, tidied up: whole numbers, 1 to 31, in order, with
 * repeats removed. An empty or unusable list falls back rather than producing
 * a schedule with no dates in it at all.
 */
export function normaliseDays(days: number[] | undefined, fallback: number[]): number[] {
  const clean = [
    ...new Set(
      (days ?? [])
        .filter((d) => Number.isFinite(d))
        .map((d) => Math.min(31, Math.max(1, Math.floor(d)))),
    ),
  ].sort((a, b) => a - b);
  return clean.length > 0 ? clean : fallback;
}

/**
 * One date per listed day, in order, for a given month.
 *
 * Collisions are kept rather than merged: a schedule of "the 30th and the 31st"
 * gives two events on the 28th of February, and two events is what it is.
 * Collapsing them would make the dates on the calendar disagree with the yearly
 * total, and a total that does not match the dates behind it is exactly the
 * quiet wrongness this app exists to avoid. Callers that genuinely want one
 * event per date - an employer does not pay you twice on one day - say so at
 * their own call site.
 */
export function monthDays(days: number[], year: number, monthIndex: number): DateKey[] {
  return days.map((d) => dayInMonth(year, monthIndex, d)).sort();
}

/**
 * The nth date of a fixed-day schedule, counting from the first one on or after
 * `anchor`, which is index 0.
 *
 * Computed from the anchor every time rather than by stepping, for the same
 * reason billing dates are: stepping accumulates clamping errors, so a schedule
 * that touches February would come back with the wrong dates forever after.
 */
export function nthMonthDay(days: number[], anchor: DateKey, n: number): DateKey {
  const start = fromDateKey(anchor);
  const year = start.getFullYear();
  const month = start.getMonth();
  const slots = days.length;

  // Where in the anchor's own month the schedule starts. If the anchor is past
  // every date in that month, it starts at the first date of the next one.
  const inAnchorMonth = monthDays(days, year, month);
  let first = inAnchorMonth.findIndex((d) => d >= anchor);
  let monthShift = 0;
  if (first < 0) {
    first = 0;
    monthShift = 1;
  }

  const index = first + Math.max(0, Math.floor(n));
  return monthDays(days, year, month + monthShift + Math.floor(index / slots))[index % slots];
}

/** How many whole calendar months lie between two dates, ignoring the day. */
export function monthsBetween(from: DateKey, to: DateKey): number {
  const a = fromDateKey(from);
  const b = fromDateKey(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * "the 1st and the 15th". A day that always clamps is called the last day,
 * because that is what it means to the person reading it - nobody thinks of
 * their February payday as "the 31st".
 */
export function describeDays(days: number[]): string {
  const names = [...days]
    .sort((a, b) => a - b)
    .map((d) => (d >= 29 ? 'the last day' : `the ${ordinal(d)}`));
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
