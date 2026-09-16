import type { DateKey, IncomeSource, PayFrequency, WeekendShift } from '../types';
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
 * Weekend handling.
 *
 * Most US employers move a payday that lands on a weekend rather than paying
 * late - usually to the Friday before, since a late wage is a problem and an
 * early one is not. Some pay the Monday after instead.
 *
 * Bank holidays shift paydays too, and are deliberately not modelled: the
 * federal list moves each year, states differ, and a stale holiday table would
 * produce confidently wrong dates - the exact failure this app avoids
 * elsewhere by not calculating tax.
 */
function shiftOffWeekend(date: DateKey, shift: WeekendShift): DateKey {
  if (shift === 'none') return date;
  const day = fromDateKey(date).getDay(); // 0 Sunday .. 6 Saturday
  if (day !== 0 && day !== 6) return date;
  if (shift === 'friday') return addDays(date, day === 6 ? -1 : -2);
  return addDays(date, day === 6 ? 2 : 1);
}

/** Records saved before this option existed follow the commonest US practice. */
export function weekendShiftOf(source: IncomeSource): WeekendShift {
  return source.weekendShift ?? 'friday';
}

/** The furthest a shift can move a date, used to size the search window. */
const MAX_SHIFT_DAYS = 3;

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
  const nominal = nominalPaydays(
    source,
    addDays(from, -MAX_SHIFT_DAYS),
    addDays(to, MAX_SHIFT_DAYS),
  );

  return nominal
    .map((date) => shiftOffWeekend(date, shift))
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
