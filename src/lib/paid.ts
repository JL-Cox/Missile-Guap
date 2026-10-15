import type { DateKey, Subscription } from '../types';
import { addDays } from './time';

/**
 * "Paid": a subscription charge you have seen go out.
 *
 * A charge stops counting as still to come out once its day has passed. That
 * is right for most of them, but wrong on the day itself: rent that left at
 * 6am still counted until midnight, and "still to come out before payday"
 * said more than was really going to leave. Marking it paid takes it out at
 * once. It can be marked early too, for a bill paid before its date.
 *
 * Only the charge's own scheduled date is kept - never an amount or a time -
 * so a mark always means "this charge, on this date", and moving the
 * subscription's schedule simply leaves an old mark matching nothing.
 */

/** How far back marks are kept. Further back, a charge has long since counted as gone anyway. */
export const PAID_KEPT_DAYS = 120;

export function isChargePaid(sub: Pick<Subscription, 'paidDates'>, date: DateKey): boolean {
  return Array.isArray(sub.paidDates) && sub.paidDates.includes(date);
}

/**
 * Whether a charge has left: marked paid, or its day is behind you. A charge
 * due today counts as still to come until it is marked.
 */
export function isChargeGone(sub: Pick<Subscription, 'paidDates'>, date: DateKey, today: DateKey): boolean {
  return date < today || isChargePaid(sub, date);
}

/**
 * The subscription with one charge marked paid or not, and marks older than
 * PAID_KEPT_DAYS dropped. The list stays sorted and never holds a date
 * twice; with nothing left, the field is taken away rather than left empty.
 */
export function withChargePaid(sub: Subscription, date: DateKey, paid: boolean, today: DateKey): Subscription {
  const oldest = addDays(today, -PAID_KEPT_DAYS);
  const dates = new Set((Array.isArray(sub.paidDates) ? sub.paidDates : []).filter((d) => d >= oldest));
  if (paid) dates.add(date);
  else dates.delete(date);
  const next = { ...sub };
  if (dates.size > 0) next.paidDates = [...dates].sort();
  else delete next.paidDates;
  return next;
}
