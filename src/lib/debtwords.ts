import type { DateKey, Debt, DebtStrategy } from '../types';
import type { ExtraReason, PlanOrderEntry } from './payoff';
import { cutTitle } from './sections';
import { fromDateKey, shortDate, SHORT_MONTHS, SHORT_WEEKDAYS, todayKey } from './time';

/**
 * The words the Debt tab, Money and Today use for debts. Debt is a subject
 * people are ashamed of, so every line here is a plain fact or a plan, never a
 * judgement: nothing is "owed", nothing is "late", nothing is counted against
 * anyone. test/debtwords.test.ts reads the debt screens and this file and
 * fails on the words that do that.
 *
 * Only words live here. Every figure they carry comes from the engine
 * (payoff.ts, debtchecks.ts); nothing below does any sums of its own.
 */

const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Mar 2029", or "March 2029" for the one date the plan is built around. */
export function monthYear(date: DateKey, long = false): string {
  const d = fromDateKey(date);
  return `${(long ? LONG_MONTHS : SHORT_MONTHS)[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Mon, Oct 12" - a due date with its weekday, so nobody has to count. */
export function weekdayDate(date: DateKey, today: DateKey = todayKey()): string {
  return `${SHORT_WEEKDAYS[fromDateKey(date).getDay()]}, ${shortDate(date, today)}`;
}

/** "7 months", "5 years", "7 years 7 months". Nothing for zero or less. */
export function spanWords(months: number): string {
  const m = Math.max(0, Math.floor(months));
  if (m === 0) return '';
  const years = Math.floor(m / 12);
  const rest = m % 12;
  const y = years === 1 ? '1 year' : `${years} years`;
  const r = rest === 1 ? '1 month' : `${rest} months`;
  if (years === 0) return r;
  return rest === 0 ? y : `${y} ${r}`;
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "24.99%", "7.5%", "0%" - as a statement prints it, without trailing zeros. */
export function percentWords(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

/** "24.99% APR", or "no rate yet" when none has been typed. */
export function rateWords(debt: Pick<Debt, 'aprPercent'>): string {
  return debt.aprPercent === undefined || !Number.isFinite(debt.aprPercent)
    ? 'no rate yet'
    : `${percentWords(debt.aprPercent)} APR`;
}

/** "due the 12th", "due the last day", "due every 2 weeks", "no due date yet". */
export function dueWords(debt: Pick<Debt, 'cadence' | 'dueDay' | 'nextDueOn'>): string {
  if (debt.cadence === 'every2weeks') return debt.nextDueOn ? 'due every 2 weeks' : 'no due date yet';
  if (debt.dueDay === undefined || !Number.isFinite(debt.dueDay) || debt.dueDay < 1) return 'no due date yet';
  const day = Math.min(31, Math.floor(debt.dueDay));
  return day === 31 ? 'due the last day' : `due the ${ordinal(day)}`;
}

/**
 * "$3,420" - an "about" figure, in whole dollars. The cents on an estimate
 * years ahead would claim a precision nobody has.
 */
export function wholeMoney(minor: number, currency: string): string {
  const dollars = Math.round(minor / 100);
  let text: string;
  try {
    text = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(dollars);
  } catch {
    text = `${dollars} ${currency}`;
  }
  return text.replace('-', '−');
}

export const STRATEGY_LABELS: Record<DebtStrategy, string> = {
  avalanche: 'Highest interest first',
  snowball: 'Smallest balance first',
};

export const STRATEGY_HINTS: Record<DebtStrategy, string> = {
  avalanche: 'Saves the most in interest.',
  snowball: 'Clears whole debts sooner, one at a time.',
};

/**
 * Why a debt gets the extra, as the end of "The extra goes to Visa, because
 * ...". One sentence, the one the owner can check against the numbers.
 *
 * `next` is for a debt that gets what is left once another has had its
 * share: "the next highest rate", so a 6.9% loan is never said to charge
 * the most interest beside a 29.99% card.
 */
export function extraBecause(reason: ExtraReason, debt: Debt, today: DateKey = todayKey(), next = false): string {
  const rate = debt.aprPercent !== undefined && Number.isFinite(debt.aprPercent) ? ` (${percentWords(debt.aprPercent)})` : '';
  switch (reason) {
    case 'highestRate':
      return next ? `it has the next highest rate${rate}` : `it charges the most interest${rate}`;
    case 'smallestBalance':
      return next ? 'it has the next smallest balance' : 'it has the smallest balance';
    case 'promoDeadline':
      return debt.promo
        ? `its promo rate ends ${shortDate(debt.promo.endsOn, today)}, and this clears it a payment early`
        : 'its promo rate is ending, and this clears it in time';
  }
}

/**
 * The one sentence beside each debt in the plan's list: why it is where it
 * is. `nameOf` turns the debt before it into a name. `promoClears` is false
 * when the plan says a promo will not be cleared in time, so this line never
 * promises what the warning above it says will not happen.
 */
export function orderWhy(
  entry: PlanOrderEntry,
  debt: Debt,
  nameOf: (id: string) => string,
  today: DateKey = todayKey(),
  promoClears = true,
): string {
  if (entry.reason === null) {
    return entry.paidOffOn ? 'Its own minimum finishes it.' : 'Its own minimum only, for now.';
  }
  if (entry.reason === 'promoDeadline') {
    const ends = debt.promo ? `Its promo rate ends ${shortDate(debt.promo.endsOn, today)}. ` : '';
    return promoClears
      ? `${ends}Part of the extra clears it a payment early.`
      : `${ends}The extra goes here first, though at this amount not all of it is cleared by then.`;
  }
  if (entry.firstStep === 0 && entry.after === null) {
    return entry.reason === 'highestRate' ? `First: ${extraBecause('highestRate', debt, today)}.` : 'First: it has the smallest balance.';
  }
  if (entry.firstStep === 0) return `Also from the start: what's left of the extra once ${nameOf(entry.after!)} is paid off.`;
  const when = entry.firstExtraOn ? ` in ${monthYear(entry.firstExtraOn)}` : '';
  return entry.after
    ? `Minimum only for now. The extra moves here after ${nameOf(entry.after)}.`
    : `Minimum only for now. The extra moves here${when}.`;
}

/** "0% until Mar 5, 2027, then 24.99%". */
export function promoWords(debt: Debt, today: DateKey = todayKey()): string {
  const promo = debt.promo;
  if (!promo) return '';
  const after = debt.aprPercent !== undefined && Number.isFinite(debt.aprPercent) ? `, then ${percentWords(debt.aprPercent)}` : '';
  return `${percentWords(promo.aprPercent)} until ${shortDate(promo.endsOn, today)}${after}`;
}

/**
 * "6 charges and 1 debt payment", "1 debt payment", "3 charges". Charges and
 * payments are counted apart, because a payment is not a charge.
 */
export function chargesAndPayments(charges: number, payments: number, paymentWord = 'debt payment'): string {
  const parts: string[] = [];
  if (charges > 0) parts.push(charges === 1 ? '1 charge' : `${charges} charges`);
  if (payments > 0) parts.push(payments === 1 ? `1 ${paymentWord}` : `${payments} ${paymentWord}s`);
  return parts.join(' and ');
}

/** The folded "Paid off" line: "Store card, paid off Oct 2026", or "2 paid off". */
export function paidOffSummary(debts: Pick<Debt, 'name' | 'paidOffOn'>[]): string {
  if (debts.length === 1 && debts[0].paidOffOn) return `${cutTitle(debts[0].name)}, paid off ${monthYear(debts[0].paidOffOn)}`;
  return `${debts.length} paid off`;
}
