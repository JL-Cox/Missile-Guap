import type { DateKey, IncomeSource, PayFrequency } from '../types';
import { addDays, daysBetween, fromDateKey, toDateKey, todayKey } from './time';

/**
 * When you actually get paid.
 *
 * US pay schedules come in two shapes that are easy to conflate:
 *
 *   intervals   - weekly and every 2 weeks, a fixed number of days apart
 *   fixed dates - twice a month and monthly, on set days of the month
 *
 * "Every 2 weeks" and "twice a month" sound like the same thing and are not:
 * 26 paycheques a year against 24. Treating one as the other misstates annual
 * income by two whole paycheques, which is exactly the sort of quiet error this
 * app is meant not to make.
 */

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
};

export function isIntervalFrequency(frequency: PayFrequency): boolean {
  return frequency === 'weekly' || frequency === 'biweekly';
}

/** Days between paydays, for the interval frequencies. */
function intervalDays(frequency: PayFrequency): number {
  return frequency === 'weekly' ? 7 : 14;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * A day-of-month anchor resolved against a real month.
 *
 * Clamping is what makes "the last day of the month" need no special case: 31
 * lands on the 28th in February and the 30th in April, the same rule `addMonths`
 * already uses. A sentinel value for "last day" would be one more thing to get
 * wrong.
 */
function dayInMonth(year: number, monthIndex: number, day: number): DateKey {
  const clamped = Math.min(Math.max(1, Math.floor(day)), lastDayOfMonth(year, monthIndex));
  return toDateKey(new Date(year, monthIndex, clamped));
}

/** The month's paydays, in order, for a fixed-date schedule. */
function paydaysInMonth(days: number[], year: number, monthIndex: number): DateKey[] {
  return [...new Set(days.map((d) => dayInMonth(year, monthIndex, d)))].sort();
}

function anchorDays(source: IncomeSource): number[] {
  const days = source.daysOfMonth?.filter((d) => Number.isFinite(d)) ?? [];
  if (days.length > 0) return days;
  // A sensible default rather than nothing: the 15th and the last day is the
  // most common US twice-a-month schedule.
  return source.frequency === 'semimonthly' ? [15, 31] : [1];
}

/**
 * The next payday on or after `from`, or null when the schedule cannot be
 * worked out (no anchor date yet) or the source has ended.
 *
 * Returning null rather than guessing matters: a made-up payday on the Today
 * screen is worse than an empty space.
 */
export function nextPayday(source: IncomeSource, from: DateKey = todayKey()): DateKey | null {
  if (source.endedOn && daysBetween(source.endedOn, from) > 0) return null;

  let date: DateKey | null = null;

  if (isIntervalFrequency(source.frequency)) {
    if (!source.firstPaid) return null;
    const step = intervalDays(source.frequency);
    const gap = daysBetween(source.firstPaid, from);
    // Jump straight to the right period instead of stepping a year of Fridays.
    const periods = gap <= 0 ? 0 : Math.ceil(gap / step);
    date = addDays(source.firstPaid, periods * step);
  } else {
    const days = anchorDays(source);
    const start = fromDateKey(from);
    // This month, then next: a fixed-date schedule always pays within 31 days.
    for (let monthOffset = 0; monthOffset <= 1 && !date; monthOffset++) {
      const probe = new Date(start.getFullYear(), start.getMonth() + monthOffset, 1);
      const candidates = paydaysInMonth(days, probe.getFullYear(), probe.getMonth());
      date = candidates.find((d) => daysBetween(d, from) <= 0) ?? null;
    }
  }

  if (!date) return null;
  if (source.endedOn && daysBetween(source.endedOn, date) > 0) return null;
  return date;
}

/** Every payday in [from, to], in order. */
export function paydaysBetween(source: IncomeSource, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  let cursor = nextPayday(source, from);
  let guard = 0;
  while (cursor && daysBetween(cursor, to) >= 0 && guard++ < 400) {
    out.push(cursor);
    cursor = nextPayday(source, addDays(cursor, 1));
  }
  return out;
}

export function describeFrequency(source: IncomeSource): string {
  const base = FREQUENCY_LABELS[source.frequency].toLowerCase();
  if (isIntervalFrequency(source.frequency)) return base;

  const days = anchorDays(source).slice().sort((a, b) => a - b);
  const names = days.map((d) => (d >= 29 ? 'the last day' : `the ${ordinal(d)}`));
  return `${base}, on ${names.join(' and ')}`;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function isActiveIncome(source: IncomeSource): boolean {
  return !source.endedOn;
}
