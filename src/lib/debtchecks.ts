import type { DateKey, Debt, DebtPlan, Id, IncomeSource, Subscription } from '../types';
import {
  billsBetween,
  billsTotalMinor,
  payFromIndex,
  payPeriods,
  whyNoPayPeriod,
  type NoPeriodReason,
  type PayPeriod,
} from './cashflow';
import { ceilToDollar, divRoundHalfUp, floorToDollar } from './debt';
import { paydaysBetween } from './pay';
import type { ExtraReason, PaymentLine, PlanResult } from './payoff';
import { addDays, daysBetween } from './time';

/**
 * How much of each paycheck goes toward debt, and which payments each check
 * covers.
 *
 * The owner's number is "Toward debt from each check": a total, minimums
 * included, one per income source. Keeping that total the same while debts
 * finish is what rolls a finished debt's payment on to the next one, and it is
 * a number that can be checked against a bank balance on payday, which a
 * monthly budget cannot.
 *
 * The plan itself runs a month at a time (payoff.ts); this turns the check
 * amounts into its monthly budget, and lays the plan's real due dates back
 * over the real paychecks, so each check says exactly what it pays.
 */

/* ---------------------------------------------------------------------------
   From checks to a monthly budget
   -------------------------------------------------------------------------- */

/**
 * Paydays in the coming year, per income source. Counted rather than assumed
 * from the frequency, so a job that has ended counts only what it still pays,
 * and a year with a 27th biweekly check says so.
 */
export function checksPerYear(incomes: IncomeSource[], from: DateKey): Record<Id, number> {
  return Object.fromEntries(incomes.map((s) => [s.id, paydaysBetween(s, from, addDays(from, 364)).length]));
}

/** Whether any income source has a per-check amount chosen. Without one, the plan keeps paying today's minimums. */
export function hasPerCheck(plan: Pick<DebtPlan, 'perCheckMinor'>, incomes: IncomeSource[]): boolean {
  return incomes.some((s) => {
    const amount = plan.perCheckMinor?.[s.id];
    return typeof amount === 'number' && Number.isFinite(amount);
  });
}

/**
 * Where the monthly budget came from:
 *   perCheck - the amounts chosen per check, over a year of real paydays
 *   perMonth - a monthly amount, used only when no payday can be placed
 *   minimums - nothing chosen yet, so today's minimums total, kept the same
 */
export type BudgetSource = 'perCheck' | 'perMonth' | 'minimums';

/**
 * The plan's monthly budget: each source's amount times its paydays in the
 * coming year, over 12. A source with no amount chosen gives 0. Months with a
 * third check get slightly ahead of the date shown, which is the right way
 * round to be wrong.
 */
export function monthlyBudgetMinor({
  plan,
  incomes,
  from,
  minimumsNowMinor,
}: {
  plan: Pick<DebtPlan, 'perCheckMinor' | 'perMonthMinor'>;
  incomes: IncomeSource[];
  from: DateKey;
  minimumsNowMinor: number;
}): { budgetMinor: number; source: BudgetSource } {
  const perYear = checksPerYear(incomes, from);
  const anyPayday = Object.values(perYear).some((n) => n > 0);
  if (!anyPayday) {
    return plan.perMonthMinor !== undefined && Number.isFinite(plan.perMonthMinor)
      ? { budgetMinor: Math.max(0, Math.round(plan.perMonthMinor)), source: 'perMonth' }
      : { budgetMinor: minimumsNowMinor, source: 'minimums' };
  }
  if (!hasPerCheck(plan, incomes)) return { budgetMinor: minimumsNowMinor, source: 'minimums' };
  const yearly = incomes.reduce((sum, s) => sum + Math.max(0, plan.perCheckMinor?.[s.id] ?? 0) * (perYear[s.id] ?? 0), 0);
  return { budgetMinor: divRoundHalfUp(yearly, 12), source: 'perCheck' };
}

/**
 * A monthly amount as a share of each source's checks, in whole dollars
 * rounded up: every check gives the same share of its take-home, so a big
 * check gives more and a small one less. "$250 a month is about $116 a check."
 */
export function perCheckShareMinor(monthlyMinor: number, incomes: IncomeSource[], from: DateKey): Record<Id, number> {
  const perYear = checksPerYear(incomes, from);
  const paidPerYear = incomes.reduce((sum, s) => sum + Math.max(0, s.netMinor) * (perYear[s.id] ?? 0), 0);
  if (paidPerYear <= 0) return {};
  return Object.fromEntries(
    incomes
      .filter((s) => (perYear[s.id] ?? 0) > 0)
      .map((s) => [s.id, ceilToDollar(divRoundHalfUp(Math.max(0, monthlyMinor) * 12 * Math.max(0, s.netMinor), paidPerYear))]),
  );
}

/** A month's spending estimate spread over `days` days: a year of it over 365. */
export function untrackedForDaysMinor(monthlyMinor: number, days: number): number {
  return divRoundHalfUp(Math.max(0, monthlyMinor) * 12 * Math.max(0, days), 365);
}

const floorToTenDollars = (minor: number): number => Math.floor(minor / 1_000) * 1_000;

/* ---------------------------------------------------------------------------
   The suggestion
   -------------------------------------------------------------------------- */

export interface SourceSuggestion {
  source: IncomeSource;
  checksPerYear: number;
  /** This source's share of the minimums: "At least $X covers the minimums". */
  minimumsNeedMinor: number;
  /** An average check's room after subscriptions and the spending estimate; null without an estimate. */
  roomMinor: number | null;
  /** Never below the minimums' share. */
  suggestedMinor: number;
}

/**
 *   ok            - a suggestion per source
 *   needsEstimate - no spending estimate yet, so nothing beyond the minimums
 *   belowMinimums - after subscriptions and the estimate, the checks don't
 *                   quite cover the minimums; the suggestion is the minimums
 *   noPeriods     - no payday can be placed (see noPeriodReason)
 */
export type SuggestionStatus = 'ok' | 'needsEstimate' | 'belowMinimums' | 'noPeriods';

export interface Suggestion {
  status: SuggestionStatus;
  noPeriodReason: NoPeriodReason | null;
  perSource: SourceSuggestion[];
  /** The monthly budget the plan would run on with every suggestion used. */
  budgetMinor: number;
  minimumsNowMinor: number;
}

/** How far ahead the suggestion looks: about 13 weeks, the current period included. */
const SUGGEST_AHEAD_DAYS = 90;

/**
 * A conservative amount per check: the minimums, plus half of what is left
 * after subscriptions and everything else; the other half stays with you for
 * surprises. Rounded down to $10, and never below the minimums' share.
 *
 * "What is left" is averaged over the next 13 weeks of real checks, so a
 * check that happens to carry the phone bill doesn't make the suggestion jump
 * from one check to the next. It is only a suggestion: the app never applies
 * it by itself.
 */
export function suggestPerCheck({
  incomes,
  subs,
  plan,
  minimumsNowMinor,
  from,
}: {
  incomes: IncomeSource[];
  subs: Subscription[];
  plan: Pick<DebtPlan, 'untrackedMonthlyMinor'>;
  minimumsNowMinor: number;
  from: DateKey;
}): Suggestion {
  const horizon = addDays(from, SUGGEST_AHEAD_DAYS);
  const window = payPeriods(incomes, from, 40).filter((p) => p.start <= horizon);
  if (window.length === 0) {
    return {
      status: 'noPeriods',
      noPeriodReason: whyNoPayPeriod(incomes, from),
      perSource: [],
      budgetMinor: minimumsNowMinor,
      minimumsNowMinor,
    };
  }

  const perYear = checksPerYear(incomes, from);
  const needs = perCheckShareMinor(minimumsNowMinor, incomes, from);
  const seen = new Set(window.flatMap((p) => p.paidBy.map((s) => s.id)));
  const sources = incomes.filter((s) => seen.has(s.id));

  const estimate = plan.untrackedMonthlyMinor;
  const hasEstimate = estimate !== undefined && Number.isFinite(estimate);
  let totalRoom = 0;
  let totalIncome = 0;
  for (const p of window) {
    const subsMinor = billsTotalMinor(billsBetween(subs, p.start, p.end));
    const untracked = hasEstimate ? untrackedForDaysMinor(estimate!, daysBetween(p.start, p.end) + 1) : 0;
    totalRoom += p.incomeMinor - subsMinor - untracked;
    totalIncome += p.incomeMinor;
  }

  const perSource: SourceSuggestion[] = sources.map((source) => {
    const need = needs[source.id] ?? 0;
    const base = { source, checksPerYear: perYear[source.id] ?? 0, minimumsNeedMinor: need };
    if (!hasEstimate) return { ...base, roomMinor: null, suggestedMinor: need };
    // Every check gives the same share of its take-home.
    const room = totalIncome > 0 ? divRoundHalfUp(Math.max(0, totalRoom) * Math.max(0, source.netMinor), totalIncome) : 0;
    const half = Math.floor(Math.max(0, room - need) / 2);
    return { ...base, roomMinor: room, suggestedMinor: Math.max(need, floorToTenDollars(need + half)) };
  });

  const yearly = (pick: (s: SourceSuggestion) => number) =>
    perSource.reduce((sum, s) => sum + pick(s) * s.checksPerYear, 0);
  const status: SuggestionStatus = !hasEstimate
    ? 'needsEstimate'
    : yearly((s) => s.roomMinor ?? 0) < minimumsNowMinor * 12
      ? 'belowMinimums'
      : 'ok';
  return {
    status,
    noPeriodReason: null,
    perSource,
    budgetMinor: divRoundHalfUp(yearly((s) => s.suggestedMinor), 12),
    minimumsNowMinor,
  };
}

/* ---------------------------------------------------------------------------
   Which check pays what
   -------------------------------------------------------------------------- */

export interface CheckMinimum {
  debt: Debt;
  dueOn: DateKey;
  amountMinor: number;
  autopay: boolean;
}

export interface CheckExtra {
  debt: Debt;
  amountMinor: number;
  reason: ExtraReason;
}

export interface CheckView {
  period: PayPeriod;
  /** The check you are living on now. */
  current: boolean;
  incomeMinor: number;
  /** Every subscription charge in the period, as Money counts them. */
  subscriptionsMinor: number;
  /** What this check puts toward debt: its minimums, anything kept for the next check, and extra. */
  towardDebtMinor: number;
  /** The minimums this check pays: due before the next check arrives. */
  minimums: CheckMinimum[];
  /** Those minimums added up. */
  minimumsMinor: number;
  /**
   * Every extra added up. With the two kept figures below it makes up the
   * whole of towardDebtMinor:
   * towardDebt = minimums + extra + keepForLater - usesKept.
   */
  extraMinor: number;
  /** Money kept from the check before, used here. */
  usesKeptMinor: number;
  /** Kept back for payments due before a later check that can't cover them alone. */
  keepForLaterMinor: number;
  /** The due dates the kept money is for. */
  keepFor: DateKey[];
  /** Where the extra goes, and why. */
  extra: CheckExtra[];
  /** Extra with nowhere to go - the plan is nearly done - so it stays with you, in "left". */
  staysMinor: number;
  /** Take-home, less subscriptions, less toward debt. The same "left" Money means. */
  leftMinor: number;
  /** The spending estimate for these days, for the explanatory line only; null without one. */
  untrackedShareMinor: number | null;
  /** Less left than the estimate for these days: "the bigger checks cover the rest". */
  leftBelowEstimate: boolean;
  /**
   * Payments due before the next check that this one can't cover as planned.
   * overTargetMinor is how far past the chosen amount it goes; overIncomeMinor
   * is how far past the check itself. Never shown in red, never as an error.
   */
  short: null | { overTargetMinor?: number; overIncomeMinor?: number };
}

/** Four checks are shown; two more are looked at so a big payment coming up can be saved for. */
const LOOKAHEAD_CHECKS = 2;

/**
 * The next `count` checks against the plan.
 *
 * Each payment is paid from the last check that arrives strictly before its
 * due date (see payFromIndex). A check that can't cover what is due before the
 * next one is helped by the check before it keeping some back, worked out
 * backwards from the furthest check looked at. The rest of each check's amount
 * is extra, split between the debts the plan puts extra on that month.
 */
export function checkPlan({
  incomes,
  subs,
  plan,
  result,
  debts,
  from,
  count = 4,
}: {
  incomes: IncomeSource[];
  subs: Subscription[];
  plan: Pick<DebtPlan, 'perCheckMinor' | 'untrackedMonthlyMinor'>;
  result: PlanResult;
  debts: Debt[];
  from: DateKey;
  count?: number;
}): CheckView[] {
  const periods = payPeriods(incomes, from, count + LOOKAHEAD_CHECKS);
  if (periods.length === 0) return [];
  const byId = new Map(debts.map((d) => [d.id, d]));

  const mapped: PaymentLine[][] = periods.map(() => []);
  for (const line of result.lines) {
    if (line.dueOn < from || line.minimumMinor <= 0 || !byId.has(line.debtId)) continue;
    const at = payFromIndex(periods, line.dueOn);
    if (at >= 0) mapped[at].push(line);
  }
  const mins = mapped.map((lines) => lines.reduce((sum, l) => sum + l.minimumMinor, 0));

  // Nothing chosen: each check pays exactly the minimums due before the next.
  const chosen = hasPerCheck(plan, incomes);
  const target = periods.map((p, i) =>
    chosen ? p.paidBy.reduce((sum, s) => sum + Math.max(0, plan.perCheckMinor?.[s.id] ?? 0), 0) : mins[i],
  );

  // What each check has to keep for the ones after it, from the far end back.
  const last = periods.length - 1;
  const need = periods.map(() => 0);
  for (let p = last - 1; p >= 0; p--) need[p] = Math.max(0, mins[p + 1] + need[p + 1] - target[p + 1]);

  // Extra already sent to a debt's line in a step, so two checks feeding the
  // same month never add up to more than its balance.
  const given = new Map<string, number>();
  const estimate = plan.untrackedMonthlyMinor;
  const hasEstimate = estimate !== undefined && Number.isFinite(estimate);

  const out: CheckView[] = [];
  let kept = 0;
  for (let p = 0; p < Math.min(count, periods.length); p++) {
    const period = periods[p];
    const avail = target[p] + kept;
    let extra = 0;
    let keepOut = 0;
    let fromCheck = target[p];
    let overTarget = 0;
    if (avail >= mins[p] + need[p]) {
      extra = avail - mins[p] - need[p];
      keepOut = need[p];
    } else if (avail >= mins[p]) {
      keepOut = avail - mins[p];
    } else {
      fromCheck = mins[p] - kept;
      overTarget = fromCheck - target[p];
    }

    const { destinations, staysMinor } = sendExtra(extra, period, from, result, byId, given);
    const subscriptionsMinor = billsTotalMinor(billsBetween(subs, period.start, period.end));
    const towardDebtMinor = fromCheck - staysMinor;
    const leftMinor = period.incomeMinor - subscriptionsMinor - towardDebtMinor;
    const untrackedShareMinor = hasEstimate
      ? untrackedForDaysMinor(estimate!, daysBetween(period.start, period.end) + 1)
      : null;

    const keepFor: DateKey[] = [];
    if (keepOut > 0) {
      for (let q = p + 1; q < periods.length; q++) {
        keepFor.push(...mapped[q].map((l) => l.dueOn));
        if (need[q] === 0) break;
      }
    }

    const short =
      overTarget > 0 || leftMinor < 0
        ? {
            ...(overTarget > 0 ? { overTargetMinor: overTarget } : {}),
            ...(leftMinor < 0 ? { overIncomeMinor: -leftMinor } : {}),
          }
        : null;

    out.push({
      period,
      current: daysBetween(period.start, from) >= 0 && daysBetween(from, period.end) >= 0,
      incomeMinor: period.incomeMinor,
      subscriptionsMinor,
      towardDebtMinor,
      minimums: mapped[p]
        .map((l) => {
          const debt = byId.get(l.debtId)!;
          return { debt, dueOn: l.dueOn, amountMinor: l.minimumMinor, autopay: debt.autopay };
        })
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.debt.name.localeCompare(b.debt.name)),
      minimumsMinor: mins[p],
      extraMinor: destinations.reduce((sum, d) => sum + d.amountMinor, 0),
      usesKeptMinor: kept,
      keepForLaterMinor: keepOut,
      keepFor: [...new Set(keepFor)].sort(),
      extra: destinations,
      staysMinor,
      leftMinor,
      untrackedShareMinor,
      leftBelowEstimate: untrackedShareMinor !== null && leftMinor < untrackedShareMinor,
      short,
    });
    kept = keepOut;
  }
  return out;
}

/**
 * Splits a check's extra between the debts the plan gives extra to in the
 * month this check pays into: in proportion to what the plan gives each, in
 * the order it gives them, whole dollars except the last share, which takes
 * the cents. A month with no extra in the plan (the minimums ate the budget)
 * sends it where the plan's next extra goes. Nothing goes past a balance;
 * anything over stays with you.
 */
function sendExtra(
  amount: number,
  period: PayPeriod,
  from: DateKey,
  result: PlanResult,
  byId: Map<Id, Debt>,
  given: Map<string, number>,
): { destinations: CheckExtra[]; staysMinor: number } {
  if (amount <= 0) return { destinations: [], staysMinor: 0 };
  const startAt = period.start > from ? period.start : from;
  let first: PaymentLine | undefined;
  for (const line of result.lines) {
    if (line.dueOn >= startAt && (!first || line.dueOn < first.dueOn)) first = line;
  }
  if (!first) return { destinations: [], staysMinor: amount };

  let receiving: PaymentLine[] = [];
  for (let step = first.step; step < result.steps && receiving.length === 0; step++) {
    receiving = result.lines.filter((l) => l.step === step && l.extraMinor > 0 && byId.has(l.debtId));
  }
  if (receiving.length === 0) return { destinations: [], staysMinor: amount };

  const weight = receiving.reduce((sum, l) => sum + l.extraMinor, 0);
  const fallback: ExtraReason = result.run === 'snowball' ? 'smallestBalance' : 'highestRate';
  const destinations: CheckExtra[] = [];
  let shared = 0;
  let staysMinor = 0;
  receiving.forEach((line, i) => {
    const share =
      i === receiving.length - 1 ? amount - shared : floorToDollar(Math.floor((amount * line.extraMinor) / weight));
    shared += share;
    const key = `${line.step}:${line.debtId}`;
    const room = Math.max(0, line.balanceAfterMinor + line.extraMinor - (given.get(key) ?? 0));
    const sent = Math.min(share, room);
    staysMinor += share - sent;
    if (sent > 0) {
      given.set(key, (given.get(key) ?? 0) + sent);
      destinations.push({ debt: byId.get(line.debtId)!, amountMinor: sent, reason: line.extraReason ?? fallback });
    }
  });
  return { destinations, staysMinor };
}

/* ---------------------------------------------------------------------------
   Rows for the screen
   -------------------------------------------------------------------------- */

/**
 * One debt's line on a check - or, with no paycheck to hang it on, in the
 * coming month: the minimum due on a date and any extra going to it, as one
 * row, "by Mon, Oct 12 · $35 minimum + $200 extra". A row with no dueOn is
 * extra alone, for a debt with nothing due before the next check.
 */
export interface PaymentRow {
  debt: Debt;
  dueOn: DateKey | null;
  minimumMinor: number;
  extraMinor: number;
  /** The two together: what goes to this debt. */
  totalMinor: number;
  /** Why it gets extra, when it does. */
  reason?: ExtraReason;
  autopay: boolean;
}

/**
 * A check's minimums and extra as one row per payment. Extra joins the
 * debt's earliest minimum on the check, so a debt is never listed twice for
 * one reason; extra for a debt with nothing due comes after, undated.
 */
export function paycheckRows(check: Pick<CheckView, 'minimums' | 'extra'>): PaymentRow[] {
  const rows: PaymentRow[] = check.minimums.map((m) => ({
    debt: m.debt,
    dueOn: m.dueOn,
    minimumMinor: m.amountMinor,
    extraMinor: 0,
    totalMinor: m.amountMinor,
    autopay: m.autopay,
  }));
  for (const e of check.extra) {
    const row = rows.find((r) => r.debt.id === e.debt.id);
    if (row) {
      row.extraMinor += e.amountMinor;
      row.totalMinor += e.amountMinor;
      row.reason ??= e.reason;
    } else {
      rows.push({
        debt: e.debt,
        dueOn: null,
        minimumMinor: 0,
        extraMinor: e.amountMinor,
        totalMinor: e.amountMinor,
        reason: e.reason,
        autopay: e.debt.autopay,
      });
    }
  }
  return rows;
}

/** The plan's first month, for when there is no paycheck to lay it over. */
export interface MonthView {
  /** The next payment on every debt, by date. */
  rows: PaymentRow[];
  totalMinor: number;
  /** The extra, in the order the plan gives it, for the "because" lines. */
  extras: CheckExtra[];
}

/**
 * The plan's first month as rows: the next payment on every debt, with the
 * extra where the plan puts it. For when no payday can be placed, so there
 * is no check to lay the payments over. A month with nothing to pay on a
 * debt (a $0 "no set amount" with no extra) is left out.
 */
export function monthRows(result: PlanResult, debts: Debt[]): MonthView {
  const byId = new Map(debts.map((d) => [d.id, d]));
  const rows: PaymentRow[] = [];
  const extras: CheckExtra[] = [];
  const fallback: ExtraReason = result.run === 'snowball' ? 'smallestBalance' : 'highestRate';
  // Lines within a step list the debts that got extra first, in the order
  // they got it, so the extras come out in the plan's own order.
  for (const line of result.lines) {
    const extraDebt = byId.get(line.debtId);
    if (line.step === 0 && extraDebt && line.extraMinor > 0) {
      extras.push({ debt: extraDebt, amountMinor: line.extraMinor, reason: line.extraReason ?? fallback });
    }
  }
  for (const line of result.lines) {
    const debt = byId.get(line.debtId);
    if (line.step !== 0 || !debt || line.minimumMinor + line.extraMinor <= 0) continue;
    rows.push({
      debt,
      dueOn: line.dueOn,
      minimumMinor: line.minimumMinor,
      extraMinor: line.extraMinor,
      totalMinor: line.minimumMinor + line.extraMinor,
      ...(line.extraReason ? { reason: line.extraReason } : {}),
      autopay: debt.autopay,
    });
  }
  rows.sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || a.debt.name.localeCompare(b.debt.name));
  return { rows, totalMinor: rows.reduce((sum, r) => sum + r.totalMinor, 0), extras };
}

/**
 * Debts marked "Paid" for a payment this check covers: due after it arrives
 * and by the next payday. Read from paidThrough alone - the one date kept -
 * so it says "marked as paid" without any record of payments.
 */
export function markedPaidIn(debts: Debt[], period: PayPeriod): Debt[] {
  const first = addDays(period.start, 1);
  const last = addDays(period.end, 1);
  return debts
    .filter((d) => !d.paidOffOn && d.paidThrough !== undefined && d.paidThrough >= first && d.paidThrough <= last)
    .sort((a, b) => a.paidThrough!.localeCompare(b.paidThrough!) || a.name.localeCompare(b.name));
}
