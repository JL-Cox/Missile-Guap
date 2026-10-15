import type { DateKey, Debt, IncomeSource, Subscription } from '../types';
import type { DebtPlanView } from './payoff';
import { billsBetween, currentPayPeriod, endOfMonth, whyNoPayPeriod, type NoPeriodReason, type PayPeriod } from './cashflow';
import { isChargeGone, isChargePaid } from './paid';
import { isActive } from './money';
import { addDays } from './time';

/**
 * The paycheck you are living on, worked out once.
 *
 * Every screen that says how much is still to come out, how much is left, or
 * what goes next - Home, Today, Money, the Debt page - reads it from here, so
 * no two of them can ever disagree, and marking a charge paid moves all of
 * them at once. Screens choose words and lay out what comes back; they do no
 * sums of their own.
 *
 * The figures always add up, to the cent:
 *
 *   take-home - gone out - still to come out - set aside for debt = left after all of it
 *
 * "Gone out" is subscription charges whose day has passed or that are marked
 * paid. "Still to come out" is the rest of this period's charges, and the
 * debt minimums this check pays from today on - the same minimums the Debt
 * page's This paycheck lists. "Set aside for debt" is whatever else the debt
 * plan has this check put toward debt (extra, and money kept for the next
 * check's payments). A debt payment marked paid on the Debt page has already
 * left the plan, so it is in none of them.
 *
 * Like the rest of Money, it only knows about subscriptions and debts. Rent,
 * food and fuel are invisible to it unless you add them, so "left" is always
 * "left after the bills this app knows about".
 */

export interface ChargeLine {
  key: string;
  sub: Subscription;
  date: DateKey;
  amountMinor: number;
  /** Marked paid. */
  paid: boolean;
  /** Left already: marked paid, or its day has passed. */
  gone: boolean;
}

export interface PaymentLine {
  key: string;
  debt: Debt;
  dueOn: DateKey;
  amountMinor: number;
  autopay: boolean;
}

/** What is still to come out over a stretch: charges and debt payments together, counted apart. */
export interface StillDue {
  minor: number;
  count: number;
  paymentCount: number;
  /** The last day it covers. */
  until: DateKey;
}

/** The next thing to leave, whichever kind it is. */
export interface NextOut {
  kind: 'charge' | 'payment';
  title: string;
  date: DateKey;
  amountMinor: number;
}

export interface PaycheckNow {
  today: DateKey;
  /** The pay period you are in, or null when no payday can be worked out. */
  period: PayPeriod | null;
  /** Why there is no period, so a screen can say what would fix it. */
  noPeriod: NoPeriodReason | null;
  /** What landed on the payday that opened this period. 0 with no period. */
  incomeMinor: number;
  /** Every subscription charge in this period, soonest first, gone or not. */
  charges: ChargeLine[];
  /** The debt minimums this check still pays, from today on, soonest first. */
  payments: PaymentLine[];
  /** Charges in this period that have left. */
  goneOutMinor: number;
  /** Charges not yet gone and the payments above. Null with no period. */
  stillToCome: StillDue | null;
  /** The rest of what the debt plan has this check put toward debt, beyond the minimums above. */
  setAsideMinor: number;
  /** What this paycheck leaves after every one of the above. Null with no period. */
  leftAfterMinor: number | null;
  /** Charges and payments from today to the end of this calendar month, paid ones left out. */
  month: StillDue;
  /** The soonest charge or payment not yet gone, today included, within the next 31 days. */
  next: NextOut | null;
  /** Whether there is anything to add up at all: an active subscription or a planned payment. */
  hasCharges: boolean;
}

/** How far "what goes next" looks: a month, so a monthly bill is always in reach. */
const NEXT_WITHIN_DAYS = 31;

export function paycheckNow({
  incomes,
  subs,
  debtView,
  today,
}: {
  incomes: IncomeSource[];
  subs: Subscription[];
  debtView: Pick<DebtPlanView, 'checks' | 'payments'>;
  today: DateKey;
}): PaycheckNow {
  const period = currentPayPeriod(incomes, today);
  const chargeLine = (b: { sub: Subscription; date: DateKey; amountMinor: number }): ChargeLine => ({
    key: `${b.sub.id}:${b.date}`,
    sub: b.sub,
    date: b.date,
    amountMinor: b.amountMinor,
    paid: isChargePaid(b.sub, b.date),
    gone: isChargeGone(b.sub, b.date, today),
  });

  // The debt plan's check for this period: the same object the Debt page draws.
  const check = period ? debtView.checks.find((c) => c.current && c.period.start === period.start) : undefined;
  const payments: PaymentLine[] = (check?.minimums ?? []).map((m) => ({
    key: `${m.debt.id}:${m.dueOn}`,
    debt: m.debt,
    dueOn: m.dueOn,
    amountMinor: m.amountMinor,
    autopay: m.autopay,
  }));
  const paymentsMinor = sum(payments.map((p) => p.amountMinor));

  const charges = period ? billsBetween(subs, period.start, period.end).map(chargeLine) : [];
  const goneOutMinor = sum(charges.filter((c) => c.gone).map((c) => c.amountMinor));
  const dueCharges = charges.filter((c) => !c.gone);
  const chargesMinor = sum(charges.map((c) => c.amountMinor));
  const towardDebtMinor = check?.towardDebtMinor ?? 0;

  const monthEnd = endOfMonth(today);
  const monthCharges = billsBetween(subs, today, monthEnd).map(chargeLine).filter((c) => !c.gone);
  const monthPayments = debtView.payments.filter((p) => p.dueOn >= today && p.dueOn <= monthEnd);

  const horizon = addDays(today, NEXT_WITHIN_DAYS);
  const upcoming: NextOut[] = [
    ...billsBetween(subs, today, horizon)
      .map(chargeLine)
      .filter((c) => !c.gone)
      .map((c) => ({ kind: 'charge' as const, title: c.sub.name, date: c.date, amountMinor: c.amountMinor })),
    ...debtView.payments
      .filter((p) => p.dueOn >= today && p.dueOn <= horizon)
      .map((p) => ({ kind: 'payment' as const, title: `${p.debt.name} payment`, date: p.dueOn, amountMinor: p.amountMinor })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  return {
    today,
    period,
    noPeriod: period ? null : whyNoPayPeriod(incomes, today),
    incomeMinor: period?.incomeMinor ?? 0,
    charges,
    payments,
    goneOutMinor,
    stillToCome: period
      ? {
          minor: sum(dueCharges.map((c) => c.amountMinor)) + paymentsMinor,
          count: dueCharges.length,
          paymentCount: payments.length,
          until: period.end,
        }
      : null,
    setAsideMinor: towardDebtMinor - paymentsMinor,
    leftAfterMinor: period ? period.incomeMinor - chargesMinor - towardDebtMinor : null,
    month: {
      minor: sum(monthCharges.map((c) => c.amountMinor)) + sum(monthPayments.map((p) => p.amountMinor)),
      count: monthCharges.length,
      paymentCount: monthPayments.length,
      until: monthEnd,
    },
    next: upcoming[0] ?? null,
    hasCharges: subs.some((s) => isActive(s, today)) || debtView.payments.length > 0,
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
