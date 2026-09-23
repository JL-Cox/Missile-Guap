import type { DateKey, IncomeSource, Subscription } from '../types';
import { isActive, netMonthlyMinor } from './money';
import { dayInMonth } from './monthdays';
import { isActiveIncome, isIntervalFrequency, nextPayday, paydaysBetween } from './pay';
import { billingDatesBetween } from './recurrence';
import { addDays, daysBetween, fromDateKey, todayKey } from './time';

/**
 * Money between now and the next time you are paid.
 *
 * The monthly averages elsewhere answer "can I afford this at all". They do not
 * answer the question you actually ask standing in a shop on the 28th, which is
 * "what is still going to come out before more money arrives". A subscription
 * that averages £12 a month is £0 some weeks and £12 in one particular day, and
 * an average hides exactly the lump that catches you out.
 *
 * So everything here works in real dates: actual charge dates against actual
 * paydays, with the weekend and holiday shifting already applied by
 * `paydaysBetween`, because a period that ends on a payday the employer never
 * pays on is the wrong period.
 *
 * One thing this module cannot do, and must never pretend to: it only knows
 * about subscriptions. Rent, food, fuel and everything else are invisible to
 * it. Every total here is "what is left after the bills this app knows about",
 * never "spare money", and the wording in the UI has to keep saying so.
 */

export interface BillDue {
  sub: Subscription;
  date: DateKey;
  amountMinor: number;
}

/** Every charge landing in [from, to] inclusive, soonest first. */
export function billsBetween(subs: Subscription[], from: DateKey, to: DateKey): BillDue[] {
  const out: BillDue[] = [];
  for (const sub of subs) {
    // A charge on or before the end date still counts; billingDatesBetween
    // stops at the end date by itself.
    if (!isActive(sub, from)) continue;
    for (const date of billingDatesBetween(sub, from, to)) {
      out.push({ sub, date, amountMinor: sub.amountMinor });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.sub.name.localeCompare(b.sub.name));
}

export function billsTotalMinor(bills: BillDue[]): number {
  return bills.reduce((sum, b) => sum + b.amountMinor, 0);
}

/** The last day of the month `date` falls in. 31 clamps, so February is handled. */
export function endOfMonth(date: DateKey): DateKey {
  const d = fromDateKey(date);
  return dayInMonth(d.getFullYear(), d.getMonth(), 31);
}

/**
 * A stretch of time from one payday to the day before the next.
 *
 * Boundaries come from every active income source at once, not one of them: if
 * one job pays on the 1st and another on the 15th, the money you are living on
 * changes on both days, and a period that ignored one of them would tell you a
 * fortnight's bills were covered by half a fortnight's pay.
 */
export interface PayPeriod {
  /** The payday this period opens on. */
  start: DateKey;
  /** The day before the next payday. Inclusive, like `start`. */
  end: DateKey;
  /** Everything landing on `start`, across every source paid that day. */
  incomeMinor: number;
  /** Which sources paid on `start`, for naming them in the UI. */
  paidBy: IncomeSource[];
}

interface Payday {
  date: DateKey;
  incomeMinor: number;
  paidBy: IncomeSource[];
}

/**
 * Every payday in [from, to] across all active sources, merged and in order.
 *
 * Two sources paying on the same day are one payday with the money added up -
 * there is only one moment when the balance changes.
 */
export function allPaydays(incomes: IncomeSource[], from: DateKey, to: DateKey): Payday[] {
  const byDate = new Map<DateKey, Payday>();
  for (const source of incomes) {
    // No "ended" check here: paydaysBetween already keeps a final payday on or
    // before the end date and nothing after it, the same rule subscriptions use.
    for (const date of paydaysBetween(source, from, to)) {
      const at = byDate.get(date) ?? { date, incomeMinor: 0, paidBy: [] };
      at.incomeMinor += source.netMinor;
      at.paidBy.push(source);
      byDate.set(date, at);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * How far back and forward to look for paydays.
 *
 * Backwards only has to clear the longest gap any supported schedule produces -
 * a month, plus room for a shifted payday. Forwards has to cover enough periods
 * to be worth showing without walking years of dates for nothing.
 */
const LOOK_BACK_DAYS = 45;
const LOOK_AHEAD_DAYS = 400;

/**
 * The pay periods covering `from` onwards, starting with the one you are in.
 *
 * The current period is found by looking *backwards* for the most recent
 * payday. Starting from today instead would tell you the period begins at your
 * next payday, which is the one question nobody asks - you already have this
 * money, and it is this money that has to last.
 */
export function payPeriods(incomes: IncomeSource[], from: DateKey = todayKey(), count = 4): PayPeriod[] {
  const paydays = allPaydays(incomes, addDays(from, -LOOK_BACK_DAYS), addDays(from, LOOK_AHEAD_DAYS));
  if (paydays.length === 0) return [];

  // The period containing `from` is the last one that opened on or before it.
  let first = paydays.findIndex((p) => daysBetween(p.date, from) < 0) - 1;
  if (first < -1) first = paydays.length - 1; // every payday is in the past
  if (first < 0) first = 0; // every payday is in the future; start at the first

  const out: PayPeriod[] = [];
  for (let i = first; i < paydays.length - 1 && out.length < count; i++) {
    out.push({
      start: paydays[i].date,
      end: addDays(paydays[i + 1].date, -1),
      incomeMinor: paydays[i].incomeMinor,
      paidBy: paydays[i].paidBy,
    });
  }
  return out;
}

/** The period you are in right now, or null when no payday can be worked out. */
export function currentPayPeriod(incomes: IncomeSource[], from: DateKey = todayKey()): PayPeriod | null {
  const [period] = payPeriods(incomes, from, 1);
  if (!period) return null;
  // A period that has not opened yet is not the one you are in.
  return daysBetween(period.start, from) >= 0 ? period : null;
}

export interface PeriodOutlook {
  period: PayPeriod;
  /** Every charge in the period, whether or not it has already gone out. */
  bills: BillDue[];
  billsMinor: number;
  /** Charges from `from` onwards - what is still to come out. */
  remainingMinor: number;
  /** Income for the period minus everything charged in it. */
  leftoverMinor: number;
  /** True for the period containing `from`, where some charges are already paid. */
  current: boolean;
}

/**
 * Each upcoming paycheque against the bills it has to cover.
 *
 * `leftoverMinor` counts every charge in the period, because that is what the
 * cheque has to absorb. `remainingMinor` counts only what is still ahead of
 * you, which is the useful number for the period you are already standing in.
 */
export function outlook(
  incomes: IncomeSource[],
  subs: Subscription[],
  from: DateKey = todayKey(),
  count = 4,
): PeriodOutlook[] {
  return payPeriods(incomes, from, count).map((period) => {
    const bills = billsBetween(subs, period.start, period.end);
    const billsMinor = billsTotalMinor(bills);
    const current = daysBetween(period.start, from) >= 0 && daysBetween(from, period.end) >= 0;
    const remainingFrom = current ? from : period.start;
    return {
      period,
      bills,
      billsMinor,
      remainingMinor: billsTotalMinor(billsBetween(subs, remainingFrom, period.end)),
      leftoverMinor: period.incomeMinor - billsMinor,
      current,
    };
  });
}

export interface StillToCome {
  /** Charges from today to the last day of this calendar month. */
  month: { minor: number; count: number; until: DateKey };
  /**
   * Charges from today to the end of the pay period. Null when there is no
   * income recorded, or not enough of it to place a payday - in which case the
   * app says so rather than guessing a period.
   */
  period: { minor: number; count: number; until: DateKey } | null;
}

/** The two "what is still going to come out" figures, for the Money screen. */
export function stillToCome(
  incomes: IncomeSource[],
  subs: Subscription[],
  from: DateKey = todayKey(),
): StillToCome {
  const monthEnd = endOfMonth(from);
  const monthBills = billsBetween(subs, from, monthEnd);

  const period = currentPayPeriod(incomes, from);
  const periodBills = period ? billsBetween(subs, from, period.end) : null;

  return {
    month: { minor: billsTotalMinor(monthBills), count: monthBills.length, until: monthEnd },
    period:
      period && periodBills
        ? { minor: billsTotalMinor(periodBills), count: periodBills.length, until: period.end }
        : null,
  };
}

export type NoPeriodReason =
  | { kind: 'noIncome' }
  | { kind: 'needsRecentPayday'; source: IncomeSource }
  | { kind: 'unknown' };

/**
 * Why no pay period could be placed, so the screen can say what would fix it
 * rather than asking for income that is already there.
 *
 * An every-week or every-2-weeks job counts its paydays from one that has
 * already happened. Without one - or with only a future one - there is
 * nothing to count back from, so the period you are in cannot be known.
 */
export function whyNoPayPeriod(incomes: IncomeSource[], from: DateKey = todayKey()): NoPeriodReason {
  const running = incomes.filter(isActiveIncome);
  if (running.length === 0) return { kind: 'noIncome' };
  const unplaced = running.find(
    (s) => isIntervalFrequency(s.frequency) && (!s.firstPaid || daysBetween(s.firstPaid, from) < 0),
  );
  return unplaced ? { kind: 'needsRecentPayday', source: unplaced } : { kind: 'unknown' };
}

export interface PaydaysFrom {
  /** Jobs paid today. */
  today: { source: IncomeSource; date: DateKey }[];
  /** Every other job's next payday, soonest first. */
  soon: { source: IncomeSource; date: DateKey }[];
  /** Take-home a month across all of them - today's included. */
  monthlyMinor: number;
}

/**
 * The next payday of each running job, for Today.
 *
 * The monthly figure covers every job with a payday, including one paid
 * today. It used to be summed over the "still to come" list only, so on a
 * payday the job that had just paid dropped out of "about $X a month".
 */
export function paydaysFrom(incomes: IncomeSource[], today: DateKey = todayKey()): PaydaysFrom {
  const all = incomes
    .filter(isActiveIncome)
    .map((source) => ({ source, date: nextPayday(source, today) }))
    .filter((p): p is { source: IncomeSource; date: DateKey } => p.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    today: all.filter((p) => p.date === today),
    soon: all.filter((p) => p.date !== today),
    monthlyMinor: all.reduce((sum, p) => sum + netMonthlyMinor(p.source), 0),
  };
}
