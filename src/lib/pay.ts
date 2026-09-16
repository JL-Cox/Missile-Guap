import type { DateKey, HolidayId, IncomeSource, PayFrequency, WeekendShift } from '../types';
import { holidaysOf, isHoliday } from './holidays';
import { describeDays, monthDays, normaliseDays } from './monthdays';
import { addDays, daysBetween, fromDateKey, todayKey } from './time';

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

/**
 * The month's paydays, in order, for a fixed-date schedule.
 *
 * Unlike a billing schedule, two clamped days landing on the same date are
 * merged: "the 30th and the 31st" is one February payday, because no employer
 * runs payroll twice in one day.
 */
function paydaysInMonth(days: number[], year: number, monthIndex: number): DateKey[] {
  return [...new Set(monthDays(days, year, monthIndex))];
}

function anchorDays(source: IncomeSource): number[] {
  // A sensible default rather than nothing: the 15th and the last day is the
  // most common US twice-a-month schedule.
  return normaliseDays(source.daysOfMonth, source.frequency === 'semimonthly' ? [15, 31] : [1]);
}

/**
 * Moving a payday off a day nobody is working.
 *
 * Most US employers pay early rather than late when payday lands on a weekend
 * or a shutdown day - a late wage is a problem, an early one is not. Some pay
 * the next working day instead.
 *
 * This steps rather than hops, because one move is often not enough: a payday
 * on Saturday 26 December moves to Friday the 25th, which is Christmas, so it
 * ends up on Thursday the 24th. A payday on the Friday after Thanksgiving has
 * Thanksgiving itself behind it, so it lands on the Wednesday.
 */
function rollToWorkingDay(date: DateKey, shift: WeekendShift, holidays: HolidayId[]): DateKey {
  if (shift === 'none') return date;
  const step = shift === 'friday' ? -1 : 1;
  let cursor = date;
  // A week is far more than any real run of closures; the bound just guarantees
  // this can never spin if a future holiday set were pathological.
  for (let guard = 0; guard < 10; guard++) {
    const day = fromDateKey(cursor).getDay(); // 0 Sunday .. 6 Saturday
    const closed = day === 0 || day === 6 || isHoliday(cursor, holidays);
    if (!closed) return cursor;
    cursor = addDays(cursor, step);
  }
  return cursor;
}

/** Records saved before this option existed follow the commonest US practice. */
export function weekendShiftOf(source: IncomeSource): WeekendShift {
  return source.weekendShift ?? 'friday';
}

/**
 * The furthest a shift can move a date, used to size the search window.
 *
 * Six rather than three now that holidays are in play: a Christmas-week payday
 * can roll back past a weekend and two closures together.
 */
const MAX_SHIFT_DAYS = 6;

/**
 * The schedule's own dates, before any weekend adjustment.
 *
 * Kept separate on purpose: the cycle must always be measured from the nominal
 * date. Feeding a shifted date back into the schedule would compound the
 * shifts, so an every-2-weeks job anchored on a Saturday would creep a day
 * earlier every payday until it had drifted off the calendar entirely.
 */
function nominalPaydays(source: IncomeSource, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];

  if (isIntervalFrequency(source.frequency)) {
    if (!source.firstPaid) return [];
    const step = intervalDays(source.frequency);
    const gap = daysBetween(source.firstPaid, from);
    const firstPeriod = gap <= 0 ? 0 : Math.ceil(gap / step);
    let guard = 0;
    for (let n = firstPeriod; guard++ < 500; n++) {
      const date = addDays(source.firstPaid, n * step);
      if (daysBetween(date, to) < 0) break;
      out.push(date);
    }
    return out;
  }

  const days = anchorDays(source);
  const start = fromDateKey(from);
  let guard = 0;
  for (let monthOffset = 0; guard++ < 400; monthOffset++) {
    const probe = new Date(start.getFullYear(), start.getMonth() + monthOffset, 1);
    const inMonth = paydaysInMonth(days, probe.getFullYear(), probe.getMonth());
    if (inMonth.length > 0 && daysBetween(inMonth[0], to) < 0) break;
    for (const date of inMonth) {
      if (daysBetween(from, date) >= 0 && daysBetween(date, to) >= 0) out.push(date);
    }
  }
  return out;
}

/**
 * Every payday in [from, to], weekend adjustment applied, in order.
 *
 * The window is widened at both ends before shifting, because a Saturday the
 * 1st moves back to the Friday of the previous month - a payday genuinely
 * outside the nominal range.
 */
export function paydaysBetween(source: IncomeSource, from: DateKey, to: DateKey): DateKey[] {
  if (source.endedOn && daysBetween(source.endedOn, from) > 0) return [];

  const shift = weekendShiftOf(source);
  const holidays = holidaysOf(source);
  const nominal = nominalPaydays(
    source,
    addDays(from, -MAX_SHIFT_DAYS),
    addDays(to, MAX_SHIFT_DAYS),
  );

  return nominal
    .map((date) => rollToWorkingDay(date, shift, holidays))
    // Two adjacent nominal paydays can land on the same Friday. Both are real
    // deposits, so both are kept - collapsing them would undercount the year.
    .filter((date) => daysBetween(from, date) >= 0 && daysBetween(date, to) >= 0)
    .filter((date) => !source.endedOn || daysBetween(source.endedOn, date) <= 0)
    .sort();
}

/**
 * The next payday on or after `from`, or null when the schedule cannot be
 * worked out (no anchor date yet) or the source has ended.
 *
 * Returning null rather than guessing matters: a made-up payday on the Today
 * screen is worse than an empty space.
 */
export function nextPayday(source: IncomeSource, from: DateKey = todayKey()): DateKey | null {
  // 45 days clears the longest gap any supported schedule can produce.
  return paydaysBetween(source, from, addDays(from, 45))[0] ?? null;
}

export const WEEKEND_SHIFT_LABELS: Record<WeekendShift, string> = {
  none: 'Paid on the date, weekend or not',
  friday: 'The Friday before',
  monday: 'The Monday after',
};

export function describeFrequency(source: IncomeSource): string {
  const base = FREQUENCY_LABELS[source.frequency].toLowerCase();
  if (isIntervalFrequency(source.frequency)) return base;
  return `${base}, on ${describeDays(anchorDays(source))}`;
}

export function isActiveIncome(source: IncomeSource): boolean {
  return !source.endedOn;
}
