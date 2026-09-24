import type { DateKey, Debt, DebtKind, MinimumRule } from '../types';
import { dayInMonth } from './monthdays';
import { addDays, addMonths, daysBetween, fromDateKey } from './time';

/**
 * The arithmetic of one debt: interest, the required payment, and the dates it
 * is due. Everything is whole cents and whole numbers, because every figure
 * here ends up next to a statement the owner can check it against, and a
 * rounding error in the plan is a reason to stop trusting all of it.
 *
 * Interest is worked out a month at a time - APR ÷ 12 on the balance - which
 * is what published payoff calculators and the loan formula use. Card issuers
 * charge a daily rate, so statements differ a little (about 1% of a month's
 * interest at 24.99%), and a balance re-typed from a statement resets that.
 */

/** Rates are held as whole basis points, 24.99% = 2499, so they are never multiplied as floats. */
export function aprBasisPoints(aprPercent: number | undefined): number {
  const bp = Math.round((aprPercent ?? 0) * 100);
  if (!Number.isFinite(bp)) return 0;
  return Math.min(99_999, Math.max(0, bp));
}

/**
 * n ÷ d, rounded to the nearest whole number with halves going up. For
 * n >= 0 and d > 0, both whole numbers.
 *
 * Done with a remainder rather than Math.round(n / d): 300000 × 24.99 ÷ 1200
 * is exactly 6247.5, and as a float it comes out as 6247.4999… and rounds the
 * wrong way.
 */
export function divRoundHalfUp(n: number, d: number): number {
  let q = Math.floor(n / d);
  let r = n - q * d;
  // Float division can land a hair either side of a whole number; the
  // remainder puts it right.
  if (r < 0) {
    q--;
    r += d;
  } else if (r >= d) {
    q++;
    r -= d;
  }
  return 2 * r >= d ? q + 1 : q;
}

/** One month's interest on a balance, in cents, rounded half-up. */
export function monthlyInterestMinor(balanceMinor: number, aprPercent?: number): number {
  if (balanceMinor <= 0) return 0;
  return divRoundHalfUp(balanceMinor * aprBasisPoints(aprPercent), 120_000);
}

export const ceilToDollar = (minor: number): number => Math.ceil(minor / 100) * 100;
export const floorToDollar = (minor: number): number => Math.floor(minor / 100) * 100;

/**
 * The payment a statement asks for.
 *
 *   statementMinor - the balance after this month's interest and fees
 *   interestMinor  - this month's interest, including any held-back interest added now
 *   feesMinor      - this month's fees
 *
 * The percentage rules are rounded up to whole dollars. That is a
 * conservative convention, not a claim about every issuer: it means the plan
 * never assumes a smaller required payment than a statement that rounds. No
 * rule ever asks for more than the whole balance.
 */
export function minimumDueMinor(
  rule: MinimumRule,
  statementMinor: number,
  interestMinor: number,
  feesMinor: number,
): number {
  const s = Math.max(0, statementMinor);
  if (s === 0) return 0;
  switch (rule.kind) {
    case 'fixed':
      return Math.min(s, Math.max(0, Math.round(rule.amountMinor)));
    case 'percentPlusInterest': {
      const share = divRoundHalfUp(s * percentBasisPoints(rule.percent), 10_000);
      return Math.min(s, Math.max(Math.max(0, rule.floorMinor), ceilToDollar(share + interestMinor + feesMinor)));
    }
    case 'percentOfBalance': {
      const share = divRoundHalfUp(s * percentBasisPoints(rule.percent), 10_000);
      return Math.min(s, Math.max(Math.max(0, rule.floorMinor), ceilToDollar(share)));
    }
  }
}

/** A minimum-rule percentage (0-100) in basis points. */
function percentBasisPoints(percent: number): number {
  const bp = Math.round(percent * 100);
  return Number.isFinite(bp) ? Math.min(10_000, Math.max(0, bp)) : 0;
}

/**
 * The monthly payment that pays off a loan in `months` payments: the standard
 * formula P·r / (1 − (1 + r)^−n), with r the monthly rate.
 *
 * Rounded up to the cent, so the scheduled number of payments really does
 * finish the loan; the last payment is then whatever is left, a little less.
 * Rounded to the nearest cent instead, $20,000 at 6.9% over 60 months would
 * need a 61st payment of 10 cents.
 */
export function installmentPaymentMinor(principalMinor: number, aprPercent: number, months: number): number {
  const n = Math.max(1, Math.floor(months));
  const p = Math.max(0, principalMinor);
  const bp = aprBasisPoints(aprPercent);
  if (bp === 0) return Math.ceil(p / n);
  const r = bp / 120_000;
  // The small nudge keeps an exact whole number from rounding up by a cent
  // because of float noise.
  return Math.ceil((p * r) / (1 - (1 + r) ** -n) - 1e-6);
}

/* ---------------------------------------------------------------------------
   One month on one debt
   -------------------------------------------------------------------------- */

/**
 * A debt's balance, in the pieces that are charged differently.
 *
 * A card with a promo holds two balances at once - the part on the promo rate
 * and everything else - and a payment has to go to one or the other. A
 * deferred-interest promo also carries a third, invisible figure: the interest
 * the promo part would have cost at the full rate, which is added back if the
 * promo part is not cleared by the end date.
 */
export interface DebtParts {
  /** Everything not on the promo, at the debt's own rate. */
  standardMinor: number;
  /** The part on the promo rate, while it lasts. */
  promoMinor: number;
  promoOn: boolean;
  /** Deferred promos only: interest held back since the start of the plan. */
  shadowMinor: number;
}

/**
 * Where a debt starts from. A promo whose end date is before the balance was
 * typed is ignored: the balance already reflects it ending.
 */
export function startingParts(debt: Debt): DebtParts {
  const balance = Math.max(0, debt.balanceMinor);
  const promo = debt.promo;
  if (promo && promo.endsOn >= debt.balanceAsOf) {
    const promoMinor = Math.min(balance, Math.max(0, promo.balanceMinor ?? balance));
    return { standardMinor: balance - promoMinor, promoMinor, promoOn: true, shadowMinor: 0 };
  }
  return { standardMinor: balance, promoMinor: 0, promoOn: false, shadowMinor: 0 };
}

/** A fee landing on this due date: a monthly one every time, a yearly one in its month. */
export function feeDueMinor(debt: Debt, dueOn: DateKey): number {
  const fee = debt.fee;
  if (!fee || !(fee.amountMinor > 0)) return 0;
  if (fee.every === 'month') return fee.amountMinor;
  // A yearly fee with no month cannot be placed, so it is left out rather
  // than guessed; the form asks for the month.
  return fee.month !== undefined && fromDateKey(dueOn).getMonth() + 1 === fee.month ? fee.amountMinor : 0;
}

export interface Accrued {
  /** The pieces after this month's interest and fees, before any payment. */
  parts: DebtParts;
  /** This month's interest on every piece. */
  interestMinor: number;
  /** Held-back interest added now, because a deferred promo ended with a balance left. */
  chargedBackMinor: number;
  feesMinor: number;
  /** What the statement would show: every piece added up. */
  statementMinor: number;
}

/**
 * One month's charges on a debt, up to the statement for `dueOn`: the promo
 * ending if its date has passed, then interest, then fees. Pure - the pieces
 * passed in are left alone.
 */
export function accrue(debt: Debt, parts: DebtParts, dueOn: DateKey): Accrued {
  let { standardMinor, promoMinor, promoOn, shadowMinor } = parts;
  let chargedBackMinor = 0;
  const promo = debt.promo;

  if (promoOn && promo && dueOn > promo.endsOn) {
    promoOn = false;
    // "No interest if paid in full" means exactly that: anything left of the
    // promo balance brings every month of held-back interest with it.
    if (promo.deferred && promoMinor > 0) {
      chargedBackMinor = Math.max(0, promo.heldBackMinor ?? 0) + shadowMinor;
      standardMinor += chargedBackMinor;
    }
    standardMinor += promoMinor;
    promoMinor = 0;
    shadowMinor = 0;
  }

  const standardInterest = monthlyInterestMinor(standardMinor, debt.aprPercent);
  const promoInterest = promoOn && promo ? monthlyInterestMinor(promoMinor, promo.aprPercent) : 0;
  if (promoOn && promo?.deferred) shadowMinor += monthlyInterestMinor(promoMinor, debt.aprPercent);
  standardMinor += standardInterest;
  promoMinor += promoInterest;

  const feesMinor = feeDueMinor(debt, dueOn);
  standardMinor += feesMinor;

  return {
    parts: { standardMinor, promoMinor, promoOn, shadowMinor },
    interestMinor: standardInterest + promoInterest,
    chargedBackMinor,
    feesMinor,
    statementMinor: standardMinor + promoMinor,
  };
}

/**
 * The balance after paying `paidMinor` on `dueOn`, for the "Balance now?" box
 * after "Paid". It is the plan's own one-month step, so the prefilled number
 * is the one the plan was already assuming; the owner corrects it from the
 * statement if it differs.
 */
export function balanceAfterPaymentMinor(debt: Debt, dueOn: DateKey, paidMinor: number): number {
  return Math.max(0, accrue(debt, startingParts(debt), dueOn).statementMinor - Math.max(0, paidMinor));
}

/* ---------------------------------------------------------------------------
   Due dates
   -------------------------------------------------------------------------- */

export function isEvery2Weeks(debt: Debt): boolean {
  return debt.cadence === 'every2weeks';
}

/** Whether a debt has enough of a schedule to put a payment on a real date. */
export function hasSchedule(debt: Debt): boolean {
  if (isEvery2Weeks(debt)) return Boolean(debt.nextDueOn);
  return debt.dueDay !== undefined && Number.isFinite(debt.dueDay) && debt.dueDay >= 1;
}

function dueDayOf(debt: Debt): number {
  return Math.min(31, Math.max(1, Math.floor(debt.dueDay ?? 1)));
}

/** The first day a payment can still be planned for: from today, and after anything marked paid. */
function openFrom(debt: Debt, from: DateKey): DateKey {
  return debt.paidThrough && debt.paidThrough >= from ? addDays(debt.paidThrough, 1) : from;
}

/**
 * The next `count` due dates on or after `from`, after anything marked paid.
 *
 * A monthly debt's dates are each worked out from the due day, never stepped
 * from the date before: a card due on the 31st is due on the 28th in February
 * and on the 31st again in March, not the 28th forever after.
 */
export function dueDatesFrom(debt: Debt, from: DateKey, count: number): DateKey[] {
  if (!hasSchedule(debt) || count <= 0) return [];
  const start = openFrom(debt, from);
  if (isEvery2Weeks(debt)) {
    const anchor = debt.nextDueOn!;
    const gap = daysBetween(anchor, start);
    const first = gap <= 0 ? 0 : Math.ceil(gap / 14);
    return Array.from({ length: count }, (_, k) => addDays(anchor, (first + k) * 14));
  }
  const day = dueDayOf(debt);
  const s = fromDateKey(start);
  const year = s.getFullYear();
  let month = s.getMonth();
  if (dayInMonth(year, month, day) < start) month += 1;
  return Array.from({ length: count }, (_, k) => dayInMonth(year, month + k, day));
}

/** Every due date in [a, b], after anything marked paid. */
export function dueDatesInWindow(debt: Debt, a: DateKey, b: DateKey): DateKey[] {
  if (!hasSchedule(debt) || b < a) return [];
  const start = openFrom(debt, a);
  const out: DateKey[] = [];
  // At most one a month, or three every-2-weeks dates in any 31 days, so the
  // count below always reaches past `b`.
  const perMonth = isEvery2Weeks(debt) ? 3 : 1;
  const months = Math.max(1, Math.ceil((daysBetween(start, b) + 1) / 28));
  for (const date of dueDatesFrom(debt, start, months * perMonth + 1)) {
    if (date > b) break;
    out.push(date);
  }
  return out;
}

/** The next due date on or after `from`, or null without a schedule. */
export function nextDueOn(debt: Debt, from: DateKey): DateKey | null {
  return dueDatesFrom(debt, from, 1)[0] ?? null;
}

/** When a loan was scheduled to finish: the last of its original payments. */
export function scheduledEndOn(debt: Debt): DateKey | null {
  const first = debt.loan?.firstPaymentOn;
  const months = debt.loan?.termMonths;
  if (!first || !months || months < 1) return null;
  return addMonths(first, Math.floor(months) - 1);
}

/**
 * A loan still being paid after its original last payment. Said as a neutral
 * note, never as a problem - deferments and changed payments do this.
 */
export function isPastTerm(debt: Debt, today: DateKey): boolean {
  const end = scheduledEndOn(debt);
  return end !== null && end < today && debt.balanceMinor > 0 && !debt.paidOffOn;
}

/** Balances older than this get one quiet "update it when you can" line. */
export const STALE_AFTER_DAYS = 35;

export function isStale(debt: Debt, today: DateKey): boolean {
  return daysBetween(debt.balanceAsOf, today) > STALE_AFTER_DAYS;
}

/* ---------------------------------------------------------------------------
   Which debts are planned
   -------------------------------------------------------------------------- */

/**
 * Why a debt is not in the plan, or null when it is.
 *
 *   paidOff       - marked as paid off
 *   zeroBalance   - a balance of 0 not marked paid off; the screen offers to
 *                   move it, and never does it by itself
 *   otherCurrency - the plan is in one currency, and adding dollars to euros is
 *                   exactly the quiet wrongness this app avoids
 *   noSchedule    - no due day (monthly) or next date (every 2 weeks) yet
 */
export type NotPlannedReason = 'paidOff' | 'zeroBalance' | 'otherCurrency' | 'noSchedule';

export function notPlannedReason(debt: Debt, currency?: string): NotPlannedReason | null {
  if (debt.paidOffOn) return 'paidOff';
  if (!(debt.balanceMinor > 0)) return 'zeroBalance';
  if (currency !== undefined && debt.currency !== currency) return 'otherCurrency';
  if (!hasSchedule(debt)) return 'noSchedule';
  return null;
}

export function isPlanned(debt: Debt, currency?: string): boolean {
  return notPlannedReason(debt, currency) === null;
}

/* ---------------------------------------------------------------------------
   Kinds, presets and labels
   -------------------------------------------------------------------------- */

export const DEBT_KINDS: DebtKind[] = [
  'creditCard',
  'storeCard',
  'personalLoan',
  'autoLoan',
  'studentFederal',
  'studentPrivate',
  'medical',
  'bnpl',
  'lineOfCredit',
  'person',
  'other',
];

export const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  creditCard: 'Credit card',
  storeCard: 'Store card',
  personalLoan: 'Personal loan',
  autoLoan: 'Car loan',
  studentFederal: 'Federal student loan',
  studentPrivate: 'Private student loan',
  medical: 'Medical bill',
  bnpl: 'Buy now, pay later',
  lineOfCredit: 'Line of credit or HELOC',
  person: 'Someone I know',
  other: 'Something else',
};

/** Which optional details the form offers first for a kind. */
export type DebtDetail = 'limit' | 'promo' | 'loan';

export interface DebtKindPreset {
  minimum: MinimumRule;
  /** Set only where the answer is nearly always the same (0 for medical plans, BNPL and family). */
  aprPercent?: number;
  cadence: 'monthly' | 'every2weeks';
  /** Whether a new promo starts as "no interest if paid in full". */
  promoDeferred: boolean;
  details: DebtDetail[];
}

const CARD_MINIMUM: MinimumRule = { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 };
const FIXED: MinimumRule = { kind: 'fixed', amountMinor: 0 };

/**
 * What tapping a kind fills in on a new debt. Only ever a starting point:
 * every value can be changed, and the engine never reads the kind itself.
 */
export const DEBT_KIND_PRESETS: Record<DebtKind, DebtKindPreset> = {
  creditCard: { minimum: CARD_MINIMUM, cadence: 'monthly', promoDeferred: false, details: ['limit', 'promo'] },
  // Store cards usually run "no interest if paid in full" promos; the
  // "3% of the balance" rule is one tap away in the form.
  storeCard: { minimum: CARD_MINIMUM, cadence: 'monthly', promoDeferred: true, details: ['promo'] },
  personalLoan: { minimum: FIXED, cadence: 'monthly', promoDeferred: false, details: ['loan'] },
  autoLoan: { minimum: FIXED, cadence: 'monthly', promoDeferred: false, details: ['loan'] },
  studentFederal: { minimum: FIXED, cadence: 'monthly', promoDeferred: false, details: ['loan'] },
  studentPrivate: { minimum: FIXED, cadence: 'monthly', promoDeferred: false, details: ['loan'] },
  medical: { minimum: FIXED, aprPercent: 0, cadence: 'monthly', promoDeferred: false, details: [] },
  bnpl: { minimum: FIXED, aprPercent: 0, cadence: 'every2weeks', promoDeferred: false, details: [] },
  // Interest only, as in a HELOC's draw period.
  lineOfCredit: {
    minimum: { kind: 'percentPlusInterest', percent: 0, floorMinor: 0 },
    cadence: 'monthly',
    promoDeferred: false,
    details: ['limit'],
  },
  person: { minimum: FIXED, aprPercent: 0, cadence: 'monthly', promoDeferred: false, details: [] },
  other: { minimum: FIXED, cadence: 'monthly', promoDeferred: false, details: [] },
};

/**
 * A debt with a kind's presets applied, for when a kind is tapped on a new
 * debt. A rate already typed is kept - the preset only fills a blank - and a
 * set amount already typed survives a switch between two fixed-payment kinds.
 */
export function applyKindPreset(debt: Debt, kind: DebtKind): Debt {
  const preset = DEBT_KIND_PRESETS[kind];
  const keepMinimum = debt.minimum.kind === 'fixed' && preset.minimum.kind === 'fixed';
  const next: Debt = {
    ...debt,
    kind,
    minimum: keepMinimum ? debt.minimum : { ...preset.minimum },
    aprPercent: debt.aprPercent ?? preset.aprPercent,
  };
  if (preset.cadence === 'every2weeks') next.cadence = 'every2weeks';
  else delete next.cadence;
  if (next.aprPercent === undefined) delete next.aprPercent;
  return next;
}

/** "Interest only" is a card rule with nothing but the interest in it. */
export function isInterestOnly(rule: MinimumRule): boolean {
  return rule.kind === 'percentPlusInterest' && rule.percent === 0 && rule.floorMinor === 0;
}
