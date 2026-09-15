import type { BillingCycle, DateKey, Recurrence, Subscription } from '../types';
import { addDays, addMonths, daysBetween, fromDateKey, toDateKey, todayKey } from './time';

const CYCLE_MONTHS: Partial<Record<BillingCycle, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** Advance one billing period from `key`. */
export function advanceCycle(key: DateKey, cycle: BillingCycle, every: number): DateKey {
  const step = Math.max(1, Math.floor(every));
  if (cycle === 'weekly') return addDays(key, 7 * step);
  return addMonths(key, (CYCLE_MONTHS[cycle] ?? 1) * step);
}

/**
 * The nth billing date, always measured from `firstBilled` rather than by
 * stepping one period at a time. That matters for month-end dates: stepping
 * 31 Jan -> 28 Feb -> 28 Mar loses the 31st forever, whereas anchoring gives
 * 28 Feb then 31 Mar, which is what the card actually gets charged on.
 */
export function occurrence(sub: Subscription, n: number): DateKey {
  const every = Math.max(1, Math.floor(sub.every));
  if (sub.cycle === 'weekly') return addDays(sub.firstBilled, n * 7 * every);
  return addMonths(sub.firstBilled, n * (CYCLE_MONTHS[sub.cycle] ?? 1) * every);
}

/**
 * Index of the first billing on or after `from`. The arithmetic below lands
 * within a period of the answer in one step - no loop over twenty years of
 * months - and the two nudges correct for month-length clamping.
 */
export function billingIndexOnOrAfter(sub: Subscription, from: DateKey): number {
  if (daysBetween(sub.firstBilled, from) <= 0) return 0;
  const every = Math.max(1, Math.floor(sub.every));

  let n: number;
  if (sub.cycle === 'weekly') {
    n = Math.floor(daysBetween(sub.firstBilled, from) / (7 * every));
  } else {
    const months = (CYCLE_MONTHS[sub.cycle] ?? 1) * every;
    const a = fromDateKey(sub.firstBilled);
    const b = fromDateKey(from);
    const elapsedMonths = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    n = Math.max(0, Math.floor(elapsedMonths / months));
  }

  let guard = 0;
  while (n > 0 && daysBetween(occurrence(sub, n - 1), from) <= 0 && guard++ < 64) n--;
  guard = 0;
  while (daysBetween(occurrence(sub, n), from) > 0 && guard++ < 64) n++;
  return n;
}

/**
 * The next time this subscription takes money, on or after `from`.
 * Returns null for a cancelled subscription whose end date has passed.
 */
export function nextBilling(sub: Subscription, from: DateKey = todayKey()): DateKey | null {
  if (sub.endedOn && daysBetween(sub.endedOn, from) > 0) return null;
  const date = occurrence(sub, billingIndexOnOrAfter(sub, from));
  if (sub.endedOn && daysBetween(sub.endedOn, date) < 0) return null;
  return date;
}

/** Every billing date for this subscription within [from, to]. */
export function billingDatesBetween(sub: Subscription, from: DateKey, to: DateKey): DateKey[] {
  if (sub.endedOn && daysBetween(sub.endedOn, from) > 0) return [];
  const out: DateKey[] = [];
  let n = billingIndexOnOrAfter(sub, from);
  let guard = 0;
  while (guard++ < 1000) {
    const date = occurrence(sub, n);
    if (daysBetween(date, to) < 0) break;
    if (sub.endedOn && daysBetween(sub.endedOn, date) < 0) break;
    out.push(date);
    n++;
  }
  return out;
}

/**
 * The next date a recurring task should appear on, strictly after `after`.
 * Weekly recurrences may name specific weekdays.
 */
export function nextOccurrence(rec: Recurrence, after: DateKey): DateKey {
  const every = Math.max(1, Math.floor(rec.every));
  switch (rec.kind) {
    case 'daily':
      return addDays(after, every);
    case 'weekly': {
      const days = rec.weekdays?.length ? [...rec.weekdays].sort((a, b) => a - b) : null;
      if (!days) return addDays(after, 7 * every);
      // Walk forward to the next named weekday; only skip whole weeks once we wrap.
      const startDow = fromDateKey(after).getDay();
      const nextDow = days.find((d) => d > startDow);
      if (nextDow !== undefined) return addDays(after, nextDow - startDow);
      const daysToWeekStart = 7 - startDow;
      return addDays(after, daysToWeekStart + 7 * (every - 1) + days[0]);
    }
    case 'monthly':
      return addMonths(after, every);
    case 'yearly':
      return addMonths(after, 12 * every);
  }
}

export function describeRecurrence(rec: Recurrence): string {
  const n = Math.max(1, Math.floor(rec.every));
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (rec.kind === 'weekly' && rec.weekdays?.length) {
    const which = rec.weekdays.slice().sort((a, b) => a - b).map((d) => names[d]).join(', ');
    return n === 1 ? `Every ${which}` : `Every ${n} weeks on ${which}`;
  }
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rec.kind];
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

export function describeCycle(cycle: BillingCycle, every: number): string {
  const n = Math.max(1, Math.floor(every));
  const unit = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' }[cycle];
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
}

/** Utility for tests and seeding: today's key, re-exported so callers need one import. */
export { todayKey, toDateKey };
