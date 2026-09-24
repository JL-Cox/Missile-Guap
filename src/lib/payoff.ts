import type { DateKey, Debt, DebtPlan, DebtStrategy, Id, IncomeSource, Subscription } from '../types';
import {
  accrue,
  aprBasisPoints,
  ceilToDollar,
  dueDatesFrom,
  dueDatesInWindow,
  isEvery2Weeks,
  isPastTerm,
  isPlanned,
  isStale,
  minimumDueMinor,
  notPlannedReason,
  scheduledEndOn,
  startingParts,
  type Accrued,
  type DebtParts,
  type NotPlannedReason,
} from './debt';
import {
  checkPlan,
  checksPerYear,
  monthlyBudgetMinor,
  monthRows,
  suggestPerCheck,
  type BudgetSource,
  type CheckView,
  type MonthView,
  type Suggestion,
} from './debtchecks';
import { addDays, addMonths } from './time';

/**
 * The payoff plan: month by month, one payment on every debt per step.
 *
 * Why months and not paychecks: card interest is billed per statement,
 * minimums and due dates are monthly, and every number the owner can check
 * this against - the statement, a lender's payoff quote, the loan formula - is
 * monthly. A per-paycheck interest model would claim a precision nobody has:
 * we don't know statement closing dates, and balances are typed by hand.
 * Paychecks come in twice instead: as the source of the monthly budget, and as
 * the near-term cash plan in debtchecks.ts.
 *
 * Each step, every debt is charged its interest and fees, every minimum is
 * paid, and whatever is left of the budget - the extra - goes first to a
 * deferred-interest promo that needs it to clear in time, then to one debt at
 * a time in the order the strategy says. When a debt finishes, its minimum
 * stays in the budget and becomes extra for the next one: the total stays the
 * same, which is the whole trick.
 */

export type RunKind = DebtStrategy | 'minimumsOnly';

/** Why a debt got money above its minimum, for the one-sentence "why". */
export type ExtraReason = 'promoDeadline' | 'highestRate' | 'smallestBalance';

export interface PaymentLine {
  debtId: Id;
  step: number;
  dueOn: DateKey;
  interestMinor: number;
  chargedBackMinor: number;
  feesMinor: number;
  minimumMinor: number;
  extraMinor: number;
  balanceAfterMinor: number;
  extraReason?: ExtraReason;
}

export interface DebtOutcome {
  debtId: Id;
  paidOffOn: DateKey | null;
  /** Payments that moved money: a $0 "no set amount" month is not one. */
  payments: number;
  /** Includes any held-back interest added when a deferred promo ended. */
  interestMinor: number;
  feesMinor: number;
  chargedBackMinor: number;
  chargedBackOn: DateKey | null;
  /** When the promo balance reached 0 while the promo still ran. */
  promoClearedOn: DateKey | null;
  /** What was left on the promo when it ended; 0 when it was cleared or never ended in the run. */
  promoLeftMinor: number;
  /** Not going down: paid only its minimum, a year of payments didn't cover a year of interest. */
  stuck: boolean;
  /** No rate typed yet, so it was planned at 0% and the screen asks for one. */
  missingRate: boolean;
}

export interface PlanResult {
  run: RunKind;
  budgetMinor: number;
  /**
   * paidOff - every debt finishes
   * stuck   - the payments about match the interest, so nothing goes down
   * tooLong - more than 50 years
   * Interest totals mean nothing unless it is paidOff, and are never shown otherwise.
   */
  status: 'paidOff' | 'stuck' | 'tooLong';
  /** Months, i.e. payment dates used. */
  steps: number;
  paidOffOn: DateKey | null;
  totalInterestMinor: number;
  totalFeesMinor: number;
  totalPaidMinor: number;
  /**
   * Every payment, step by step. Within a step, the lines that got extra
   * come first, in the order the extra was given (promo deadlines, then the
   * strategy's order); the rest follow by date.
   */
  lines: PaymentLine[];
  debts: DebtOutcome[];
  /** The first date the minimums added up to more than the budget; they are paid anyway. */
  minimumsAboveBudgetOn: DateKey | null;
  /** Per step, the debt the strategy's extra went to first ('' when none did). */
  focusByStep: Id[];
}

/** 600 months is 50 years; past that the plan says so rather than giving a date. */
export const MAX_STEPS = 600;
/** How many months of payments the progress check looks back over. */
const PROGRESS_WINDOW = 12;
/**
 * Any piece of a balance past $500 million is not going to be paid off by
 * anyone, and stopping there keeps balance × rate well inside the range
 * where JavaScript numbers are exact.
 */
const RUNAWAY_MINOR = 5e10;

type PartName = 'standard' | 'promo';

interface Runner {
  debt: Debt;
  parts: DebtParts;
  datesAt: (step: number) => DateKey[];
  done: boolean;
  frozen: boolean;
  window: { paid: number; cost: number }[];
  outcome: DebtOutcome;
}

interface Entry {
  runner: Runner;
  dates: DateKey[];
  accrued: Accrued;
  parts: DebtParts;
  mins: number[];
  minTotal: number;
  minToPromo: number;
  extra: number;
  reason?: ExtraReason;
  /** The order this debt first got extra in, this step; Infinity when it got none. */
  rank: number;
}

/**
 * A debt's due dates for each step. A monthly debt has one: its own m-th due
 * date. An every-2-weeks debt has whichever of its dates fall in the step's
 * month, counted from `from` each time rather than stepped, so a month-end
 * start never drifts.
 */
function stepDates(debt: Debt, from: DateKey): (step: number) => DateKey[] {
  if (isEvery2Weeks(debt)) {
    return (m) => dueDatesInWindow(debt, addMonths(from, m), addDays(addMonths(from, m + 1), -1));
  }
  const cache: DateKey[] = [];
  return (m) => {
    // Worked out in chunks and kept: the promo pace looks ahead many steps.
    if (m >= cache.length) cache.push(...dueDatesFrom(debt, from, m + 24).slice(cache.length));
    return [cache[m]];
  };
}

/** The pieces of a debt in the order its own minimum pays them: highest current rate first. */
function minimumOrder(debt: Debt, parts: DebtParts): PartName[] {
  const standard = aprBasisPoints(debt.aprPercent);
  const promo = parts.promoOn && debt.promo ? aprBasisPoints(debt.promo.aprPercent) : -1;
  // On a tie the promo piece goes last.
  return promo > standard ? ['promo', 'standard'] : ['standard', 'promo'];
}

function rateOf(debt: Debt, parts: DebtParts, part: PartName): number {
  return part === 'promo' && parts.promoOn && debt.promo
    ? aprBasisPoints(debt.promo.aprPercent)
    : aprBasisPoints(debt.aprPercent);
}

function take(parts: DebtParts, part: PartName, amount: number): number {
  const key = part === 'promo' ? 'promoMinor' : 'standardMinor';
  const paid = Math.min(Math.max(0, amount), parts[key]);
  parts[key] -= paid;
  return paid;
}

/**
 * The step's required payments for one debt. Every-2-weeks debts pay once per
 * date, each the set amount or what is left; the month's interest and fees go
 * on the first one.
 */
function minimumsFor(debt: Debt, dates: DateKey[], accrued: Accrued): number[] {
  const firstCharges = accrued.interestMinor + accrued.chargedBackMinor;
  if (dates.length === 1) {
    return [minimumDueMinor(debt.minimum, accrued.statementMinor, firstCharges, accrued.feesMinor)];
  }
  let remaining = accrued.statementMinor;
  return dates.map((_, i) => {
    const due = minimumDueMinor(debt.minimum, remaining, i === 0 ? firstCharges : 0, i === 0 ? accrued.feesMinor : 0);
    remaining -= due;
    return due;
  });
}

const byName = (a: Debt, b: Debt) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Runs one plan.
 *
 *   run: 'avalanche' | 'snowball' - the budget each month, extra to one debt at a time
 *        'minimumsOnly'           - every debt paid only its own minimum
 *
 * Only debts that can be planned are included: not paid off, a balance above
 * 0, in the plan's currency (when one is given) and with a due date. Nothing
 * passed in is changed.
 */
export function simulate(
  debts: Debt[],
  o: { budgetMinor: number; run: RunKind; from: DateKey; maxSteps?: number; currency?: string },
): PlanResult {
  const maxSteps = Math.max(0, Math.floor(o.maxSteps ?? MAX_STEPS));
  const budget = Math.max(0, Math.round(o.budgetMinor));
  const minimumsOnly = o.run === 'minimumsOnly';

  const runners: Runner[] = debts
    .filter((d) => isPlanned(d, o.currency))
    .map((debt) => ({
      debt,
      parts: startingParts(debt),
      datesAt: stepDates(debt, o.from),
      done: false,
      frozen: false,
      window: [],
      outcome: {
        debtId: debt.id,
        paidOffOn: null,
        payments: 0,
        interestMinor: 0,
        feesMinor: 0,
        chargedBackMinor: 0,
        chargedBackOn: null,
        promoClearedOn: null,
        promoLeftMinor: 0,
        stuck: false,
        missingRate: debt.aprPercent === undefined || !Number.isFinite(debt.aprPercent),
      },
    }));

  const lines: PaymentLine[] = [];
  const focusByStep: Id[] = [];
  const planWindow: { paid: number; cost: number }[] = [];
  let minimumsAboveBudgetOn: DateKey | null = null;
  let planStuck = false;
  let lastStepWithLines = -1;

  for (let m = 0; m < maxSteps && !planStuck; m++) {
    const live = runners.filter((r) => !r.done && !r.frozen);
    if (live.length === 0) break;

    // 1-4: promo endings, interest, fees and each debt's minimum.
    const entries: Entry[] = [];
    for (const runner of live) {
      const dates = runner.datesAt(m);
      if (dates.length === 0) continue;
      const accrued = accrue(runner.debt, runner.parts, dates[0]);
      const mins = minimumsFor(runner.debt, dates, accrued);
      entries.push({
        runner,
        dates,
        accrued,
        parts: { ...accrued.parts },
        mins,
        minTotal: mins.reduce((a, b) => a + b, 0),
        minToPromo: 0,
        extra: 0,
        rank: Infinity,
      });
    }
    if (entries.length === 0) {
      focusByStep.push('');
      continue;
    }

    // 5: the budget. Minimums are paid even when they add up to more.
    const minimumsTotal = entries.reduce((sum, e) => sum + e.minTotal, 0);
    const spend = minimumsOnly ? minimumsTotal : Math.max(budget, minimumsTotal);
    if (!minimumsOnly && minimumsTotal > budget && minimumsAboveBudgetOn === null) {
      minimumsAboveBudgetOn = entries.map((e) => e.dates[0]).sort()[0];
    }

    // 6: each debt's own minimum, highest-rate piece first.
    for (const e of entries) {
      let left = e.minTotal;
      for (const part of minimumOrder(e.runner.debt, e.parts)) {
        const paid = take(e.parts, part, left);
        if (part === 'promo') e.minToPromo = paid;
        left -= paid;
      }
    }

    // 7: what is left of the budget is the extra.
    let extra = spend - minimumsTotal;
    let rank = 0;
    let focus: Id = '';

    if (!minimumsOnly) {
      // 8: a deferred promo gets an even pace that clears it one payment
      // before its end date. Paying a 0% balance early saves nothing, so the
      // pace guarantees the deadline and leaves every other dollar to the
      // strategy. Earliest end date first.
      const paced = entries
        .filter((e) => e.runner.debt.promo?.deferred && e.parts.promoOn && e.parts.promoMinor > 0)
        .sort(
          (a, b) =>
            a.runner.debt.promo!.endsOn.localeCompare(b.runner.debt.promo!.endsOn) || byName(a.runner.debt, b.runner.debt),
        );
      for (const e of paced) {
        const endsOn = e.runner.debt.promo!.endsOn;
        let n = 0;
        while (m + n < maxSteps + 1 && (e.runner.datesAt(m + n)[0] ?? '9999-12-31') <= endsOn) n++;
        const target = Math.ceil(e.accrued.parts.promoMinor / (n >= 2 ? n - 1 : 1));
        const add = Math.min(extra, Math.max(0, target - e.minToPromo), e.parts.promoMinor);
        if (add > 0) {
          e.parts.promoMinor -= add;
          e.extra += add;
          e.reason = 'promoDeadline';
          if (e.rank === Infinity) e.rank = rank++;
          extra -= add;
        }
      }

      // 9: the strategy, one piece at a time until the extra runs out.
      if (extra > 0) {
        const balanceOf = (e: Entry) => e.parts.standardMinor + e.parts.promoMinor;
        const pieces = entries.flatMap((e) =>
          (['standard', 'promo'] as PartName[])
            .filter((part) => (part === 'promo' ? e.parts.promoMinor : e.parts.standardMinor) > 0)
            .map((part) => ({ e, part, rate: rateOf(e.runner.debt, e.parts, part), balance: balanceOf(e) })),
        );
        pieces.sort((a, b) => {
          const byRate = b.rate - a.rate;
          const byBalance = a.balance - b.balance;
          const first = o.run === 'snowball' ? byBalance || byRate : byRate || byBalance;
          return first || byName(a.e.runner.debt, b.e.runner.debt) || (a.part === 'standard' ? -1 : 1);
        });
        const reason: ExtraReason = o.run === 'snowball' ? 'smallestBalance' : 'highestRate';
        for (const piece of pieces) {
          if (extra <= 0) break;
          const paid = take(piece.e.parts, piece.part, extra);
          if (paid <= 0) continue;
          extra -= paid;
          piece.e.extra += paid;
          piece.e.reason ??= reason;
          if (piece.e.rank === Infinity) piece.e.rank = rank++;
          if (!focus) focus = piece.e.runner.debt.id;
        }
      }
    }
    focusByStep.push(focus);

    // 10: record the lines. Leftover extra in the final step is simply unspent.
    entries.sort(
      (a, b) => a.rank - b.rank || a.dates[0].localeCompare(b.dates[0]) || byName(a.runner.debt, b.runner.debt),
    );
    let stepPaid = 0;
    let stepCost = 0;
    let runaway = false;
    for (const e of entries) {
      const { runner, accrued, dates } = e;
      const out = runner.outcome;
      if (runner.parts.promoOn && !accrued.parts.promoOn) out.promoLeftMinor = runner.parts.promoMinor;
      if (accrued.chargedBackMinor > 0) {
        out.chargedBackMinor += accrued.chargedBackMinor;
        out.chargedBackOn = dates[0];
      }
      if (accrued.parts.promoOn && accrued.parts.promoMinor > 0 && e.parts.promoMinor === 0) {
        out.promoClearedOn ??= dates[0];
      }

      let balance = accrued.statementMinor;
      dates.forEach((dueOn, i) => {
        if (i > 0 && e.mins[i] === 0) return;
        const extraHere = i === 0 ? e.extra : 0;
        balance -= e.mins[i] + extraHere;
        lines.push({
          debtId: runner.debt.id,
          step: m,
          dueOn,
          interestMinor: i === 0 ? accrued.interestMinor : 0,
          chargedBackMinor: i === 0 ? accrued.chargedBackMinor : 0,
          feesMinor: i === 0 ? accrued.feesMinor : 0,
          minimumMinor: e.mins[i],
          extraMinor: extraHere,
          balanceAfterMinor: balance,
          ...(extraHere > 0 && e.reason ? { extraReason: e.reason } : {}),
        });
        if (e.mins[i] + extraHere > 0) out.payments++;
        if (balance === 0 && out.paidOffOn === null) out.paidOffOn = dueOn;
      });

      out.interestMinor += accrued.interestMinor + accrued.chargedBackMinor;
      out.feesMinor += accrued.feesMinor;
      runner.parts = e.parts;
      runner.done = e.parts.standardMinor + e.parts.promoMinor === 0;

      // Held-back interest is a one-time charge, so it is left out of the
      // progress check: it would make a plan that is working look stuck.
      const paid = e.minTotal + e.extra;
      const cost = accrued.interestMinor + accrued.feesMinor;
      stepPaid += paid;
      stepCost += cost;
      const tooBig = e.parts.standardMinor > RUNAWAY_MINOR || e.parts.promoMinor > RUNAWAY_MINOR;
      runaway ||= tooBig;

      // 11, minimums only: each debt on its own. One that a year of
      // payments hasn't brought down is set aside as stuck, never paid off.
      if (minimumsOnly && !runner.done) {
        runner.window.push({ paid, cost });
        if (runner.window.length > PROGRESS_WINDOW) runner.window.shift();
        if (tooBig || (runner.window.length === PROGRESS_WINDOW && notShrinking(runner.window))) {
          runner.frozen = true;
          out.stuck = true;
        }
      }
    }
    lastStepWithLines = m;

    // 11, a plan: the same test on the totals ends the run.
    if (!minimumsOnly) {
      planWindow.push({ paid: stepPaid, cost: stepCost });
      if (planWindow.length > PROGRESS_WINDOW) planWindow.shift();
      if (runaway || (planWindow.length === PROGRESS_WINDOW && notShrinking(planWindow))) planStuck = true;
    }
  }

  const outcomes = runners.map((r) => r.outcome);
  const allDone = runners.every((r) => r.done);
  const anyLive = runners.some((r) => !r.done && !r.frozen);
  const status: PlanResult['status'] = allDone ? 'paidOff' : planStuck ? 'stuck' : anyLive ? 'tooLong' : 'stuck';
  if (status === 'stuck' && !minimumsOnly) {
    for (const r of runners) if (!r.done) r.outcome.stuck = true;
  }

  return {
    run: o.run,
    budgetMinor: budget,
    status,
    steps: lastStepWithLines + 1,
    paidOffOn: allDone
      ? outcomes.reduce<DateKey | null>((last, d) => (d.paidOffOn && (!last || d.paidOffOn > last) ? d.paidOffOn : last), null)
      : null,
    totalInterestMinor: outcomes.reduce((sum, d) => sum + d.interestMinor, 0),
    totalFeesMinor: outcomes.reduce((sum, d) => sum + d.feesMinor, 0),
    totalPaidMinor: lines.reduce((sum, l) => sum + l.minimumMinor + l.extraMinor, 0),
    lines,
    debts: outcomes,
    minimumsAboveBudgetOn,
    focusByStep: focusByStep.slice(0, lastStepWithLines + 1),
  };
}

function notShrinking(window: { paid: number; cost: number }[]): boolean {
  let paid = 0;
  let cost = 0;
  for (const w of window) {
    paid += w.paid;
    cost += w.cost;
  }
  return paid <= cost;
}

/* ---------------------------------------------------------------------------
   Comparisons
   -------------------------------------------------------------------------- */

export interface PromoWarning {
  debtId: Id;
  endsOn: DateKey;
  /** Still on the promo when it ends, on this plan. */
  leftMinor: number;
  /** The held-back interest that would be added then. */
  chargeMinor: number;
  /** What this card needs each month to clear the promo in time. */
  neededMonthlyMinor: number;
  /** That, plus every other debt's minimum: a budget that clears it. */
  neededBudgetMinor: number;
}

export interface PlanComparison {
  plan: PlanResult;
  /** The other strategy, at the same budget. */
  other: PlanResult;
  minimumsOnly: PlanResult;
  /** Every minimum due in the first month. */
  minimumsNowMinor: number;
  /** How much more than the minimums the budget is. */
  extraMonthlyMinor: number;
  /** Against minimums only; only when both finish. */
  saved: { interestMinor: number; months: number } | null;
  /** What the other strategy would cost more (negative: less); only when both finish. */
  strategyDelta: { interestMinor: number; aboutTheSame: boolean } | null;
  /** When the plan is stuck: the monthly amount at which the balances start to shrink. */
  makeProgressMinor: number | null;
  promoWarnings: PromoWarning[];
}

const stepTotal = (result: PlanResult, step: number, pick: (l: PaymentLine) => number, except?: Id) =>
  result.lines.filter((l) => l.step === step && l.debtId !== except).reduce((sum, l) => sum + pick(l), 0);

/** Under $10 apart, the two strategies are "about the same". */
const ABOUT_THE_SAME_MINOR = 1_000;

export function comparePlans(
  debts: Debt[],
  budgetMinor: number,
  strategy: DebtStrategy,
  from: DateKey,
  currency?: string,
): PlanComparison {
  const otherStrategy: DebtStrategy = strategy === 'avalanche' ? 'snowball' : 'avalanche';
  const plan = simulate(debts, { budgetMinor, run: strategy, from, currency });
  const other = simulate(debts, { budgetMinor, run: otherStrategy, from, currency });
  const minimumsOnly = simulate(debts, { budgetMinor, run: 'minimumsOnly', from, currency });
  const minimumsNowMinor = stepTotal(minimumsOnly, 0, (l) => l.minimumMinor);

  const promoWarnings: PromoWarning[] = [];
  for (const outcome of plan.debts) {
    if (outcome.chargedBackMinor <= 0) continue;
    const debt = debts.find((d) => d.id === outcome.debtId)!;
    const neededMonthlyMinor = promoPaceMinor(debt, from);
    promoWarnings.push({
      debtId: debt.id,
      endsOn: debt.promo!.endsOn,
      leftMinor: outcome.promoLeftMinor,
      chargeMinor: outcome.chargedBackMinor,
      neededMonthlyMinor,
      neededBudgetMinor: neededMonthlyMinor + stepTotal(minimumsOnly, 0, (l) => l.minimumMinor, debt.id),
    });
  }

  const bothFinish = (a: PlanResult, b: PlanResult) => a.status === 'paidOff' && b.status === 'paidOff';
  const delta = other.totalInterestMinor - plan.totalInterestMinor;
  return {
    plan,
    other,
    minimumsOnly,
    minimumsNowMinor,
    extraMonthlyMinor: Math.max(0, plan.budgetMinor - minimumsNowMinor),
    saved: bothFinish(plan, minimumsOnly)
      ? {
          interestMinor: minimumsOnly.totalInterestMinor - plan.totalInterestMinor,
          months: minimumsOnly.steps - plan.steps,
        }
      : null,
    strategyDelta: bothFinish(plan, other)
      ? { interestMinor: delta, aboutTheSame: Math.abs(delta) < ABOUT_THE_SAME_MINOR }
      : null,
    makeProgressMinor:
      plan.status === 'stuck'
        ? ceilToDollar(stepTotal(plan, 0, (l) => l.interestMinor + l.feesMinor) + 1)
        : null,
    promoWarnings,
  };
}

/**
 * The first month's pace for a deferred promo: its balance after that month's
 * interest, spread over its payments before the end date less one.
 */
function promoPaceMinor(debt: Debt, from: DateKey): number {
  const promo = debt.promo;
  if (!promo) return 0;
  const datesAt = stepDates(debt, from);
  const first = datesAt(0)[0];
  if (!first) return 0;
  const accrued = accrue(debt, startingParts(debt), first);
  if (!accrued.parts.promoOn) return 0;
  let n = 0;
  while (n <= MAX_STEPS && (datesAt(n)[0] ?? '9999-12-31') <= promo.endsOn) n++;
  return Math.ceil(accrued.parts.promoMinor / (n >= 2 ? n - 1 : 1));
}

/**
 * The smallest whole-dollar monthly budget that has every debt paid off within
 * `months` payments, for "to be done in 3 years: about $425 a month". Null
 * when no budget can do it (a debt with no due date in that time).
 */
export function budgetToFinishWithin(
  debts: Debt[],
  strategy: DebtStrategy,
  from: DateKey,
  months: number,
  currency?: string,
): number | null {
  const steps = Math.floor(months);
  if (steps < 1) return null;
  const finishes = (budgetMinor: number) => {
    const r = simulate(debts, { budgetMinor, run: strategy, from, maxSteps: steps, currency });
    return r.status === 'paidOff' && r.steps <= steps;
  };
  const first = simulate(debts, { budgetMinor: 0, run: 'minimumsOnly', from, maxSteps: 1, currency });
  const minimumsNow = stepTotal(first, 0, (l) => l.minimumMinor);
  // Everything owed after the first month's charges clears in one step.
  const everything = first.lines.reduce((sum, l) => sum + l.balanceAfterMinor + l.minimumMinor, 0);

  let low = Math.ceil(minimumsNow / 100);
  if (finishes(low * 100)) return low * 100;
  let high = Math.max(low + 1, Math.ceil(everything / 100));
  for (let tries = 0; !finishes(high * 100); tries++) {
    if (tries > 20) return null;
    high *= 2;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (finishes(mid * 100)) high = mid;
    else low = mid;
  }
  return high * 100;
}

/* ---------------------------------------------------------------------------
   One debt at its minimum
   -------------------------------------------------------------------------- */

/** The first month on its own minimum: what it asks for, and what it charges. */
function firstMonth(debt: Debt, from: DateKey) {
  const r = simulate([debt], { budgetMinor: 0, run: 'minimumsOnly', from, maxSteps: 1 });
  const lines = r.lines.filter((l) => l.step === 0);
  return {
    has: lines.length > 0,
    requiredMinor: lines.reduce((sum, l) => sum + l.minimumMinor, 0),
    costMinor: lines.reduce((sum, l) => sum + l.interestMinor + l.feesMinor, 0),
  };
}

/**
 * Whether the required payment is no more than the month's interest and fees,
 * so paying only it, the balance never comes down. A $0 "no set amount" loan
 * at 0% counts too: it doesn't come down either.
 */
export function growsAtMinimum(debt: Debt, from: DateKey): boolean {
  const first = firstMonth(debt, from);
  return first.has && first.requiredMinor <= first.costMinor;
}

/**
 * The monthly payment from which the balance starts to shrink: a dollar over
 * the interest and fees, in whole dollars. Null when its own minimum already
 * shrinks it.
 */
export function paymentToShrinkMinor(debt: Debt, from: DateKey): number | null {
  const first = firstMonth(debt, from);
  if (!first.has || first.requiredMinor > first.costMinor) return null;
  return ceilToDollar(first.costMinor + 1);
}

/* ---------------------------------------------------------------------------
   Payments on real dates, for Money and Today
   -------------------------------------------------------------------------- */

/** A payment the plan has due on a date. The minimum only: the extra is per check. */
export interface ScheduledPayment {
  debt: Debt;
  dueOn: DateKey;
  amountMinor: number;
  autopay: boolean;
}

/** The plan's minimum payments due in [from, to], by date and then name. */
export function scheduledPayments(result: PlanResult, debts: Debt[], from: DateKey, to: DateKey): ScheduledPayment[] {
  const byId = new Map(debts.map((d) => [d.id, d]));
  const out: ScheduledPayment[] = [];
  for (const line of result.lines) {
    const debt = byId.get(line.debtId);
    if (!debt || line.minimumMinor <= 0 || line.dueOn < from || line.dueOn > to) continue;
    out.push({ debt, dueOn: line.dueOn, amountMinor: line.minimumMinor, autopay: debt.autopay });
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || byName(a.debt, b.debt));
}

/* ---------------------------------------------------------------------------
   The order the plan works through the debts
   -------------------------------------------------------------------------- */

/**
 * One debt's place in the plan, for "Visa · paid off Aug 2027 · First: it
 * charges the most interest."
 *
 *   reason     - why it first got money above its minimum; null if it never
 *                does, because its own minimum finishes it first
 *   firstStep  - the month that happens in, counted from 0, and firstExtraOn
 *                the due date it happens on
 *   after      - the debt the strategy's extra was on before it moved here;
 *                null for the first one, and for a promo paced on its own
 */
export interface PlanOrderEntry {
  debtId: Id;
  paidOffOn: DateKey | null;
  reason: ExtraReason | null;
  firstStep: number | null;
  firstExtraOn: DateKey | null;
  after: Id | null;
}

/**
 * The debts in the order the plan works through them: first by when each
 * first gets extra (and, within a month, the order it was given), then the
 * ones only ever paid their own minimum, by when they finish.
 */
export function planOrder(result: PlanResult): PlanOrderEntry[] {
  const out: PlanOrderEntry[] = [];
  const seen = new Set<Id>();
  const paidOff = new Map(result.debts.map((d) => [d.debtId, d.paidOffOn]));
  let lastFocus: Id | null = null;
  // Lines within a step already list the debts that got extra first, in the
  // order they got it.
  for (const line of result.lines) {
    if (line.extraMinor <= 0) continue;
    const reason = line.extraReason ?? null;
    if (!seen.has(line.debtId)) {
      seen.add(line.debtId);
      out.push({
        debtId: line.debtId,
        paidOffOn: paidOff.get(line.debtId) ?? null,
        reason,
        firstStep: line.step,
        firstExtraOn: line.dueOn,
        after: reason === 'promoDeadline' ? null : lastFocus,
      });
    }
    if (reason !== 'promoDeadline') lastFocus = line.debtId;
  }
  const rest = result.debts
    .filter((d) => !seen.has(d.debtId))
    .sort((a, b) => (a.paidOffOn ?? '9999-12-31').localeCompare(b.paidOffOn ?? '9999-12-31'));
  for (const d of rest) {
    out.push({ debtId: d.debtId, paidOffOn: d.paidOffOn, reason: null, firstStep: null, firstExtraOn: null, after: null });
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Everything the Debt screen needs, in one call
   -------------------------------------------------------------------------- */

/**
 * The debts still being paid, for the folded "Your debts" line. The total
 * adds up only the ones in the plan's currency; `asOf` is the date every
 * balance was typed on, or null when they differ.
 */
export interface OpenBalances {
  count: number;
  totalMinor: number;
  otherCurrency: number;
  asOf: DateKey | null;
}

export function openBalances(debts: Debt[], currency: string): OpenBalances {
  const open = debts.filter((d) => !d.paidOffOn);
  const same = open.filter((d) => d.currency === currency);
  const dates = new Set(open.map((d) => d.balanceAsOf));
  return {
    count: open.length,
    totalMinor: same.reduce((sum, d) => sum + Math.max(0, d.balanceMinor), 0),
    otherCurrency: open.length - same.length,
    asOf: dates.size === 1 ? [...dates][0] : null,
  };
}

/** How far ahead the plan's dated payments are listed for Money and Today. */
export const PAYMENTS_AHEAD_DAYS = 400;

export interface DebtSummary {
  debt: Debt;
  /** Null when it is in the plan. */
  notPlanned: NotPlannedReason | null;
  /** On the plan. Null when it is not in it. */
  plan: DebtOutcome | null;
  /** Paying only its own minimum: "On its own, at the minimum: paid off by Nov 2034". */
  minimumsOnly: DebtOutcome | null;
  /** Its next payment on the plan, with any extra the plan's month gives it. */
  next: { dueOn: DateKey; minimumMinor: number; extraMinor: number; extraReason?: ExtraReason } | null;
  /** The first month's interest: "Interest right now: about $51 a month". */
  interestNowMinor: number;
  growsAtMinimum: boolean;
  paymentToShrinkMinor: number | null;
  /** On its own, what a month gets it paid off within 3 years; only when its minimum doesn't shrink it. */
  finishIn3YearsMinor: number | null;
  /** A set amount of $0: "No set payment, so it's paid from the extra in your plan." */
  noSetPayment: boolean;
  missingRate: boolean;
  stale: boolean;
  pastTerm: boolean;
  scheduledEndOn: DateKey | null;
}

export interface DebtPlanView {
  from: DateKey;
  currency: string;
  strategy: DebtStrategy;
  /** The debts the plan covers. */
  planned: Debt[];
  /** Every debt passed in, in the same order, planned or not. */
  debts: DebtSummary[];
  /** The monthly budget the plan runs on, and where it came from. */
  budgetMinor: number;
  budgetSource: BudgetSource;
  comparison: PlanComparison;
  /** The chosen plan; the same object as comparison.plan. */
  result: PlanResult;
  /** The next four checks: which minimums each pays, what it keeps, where its extra goes. */
  checks: CheckView[];
  /** The plan's first month as rows, for when there is no paycheck to lay it over. */
  month: MonthView;
  /** The planned debts in the order the plan works through them. */
  order: PlanOrderEntry[];
  /** The debts still being paid, for the folded "Your debts" line. */
  open: OpenBalances;
  /** The plan's minimums due over the next PAYMENTS_AHEAD_DAYS, for Money and Today. */
  payments: ScheduledPayment[];
  suggestion: Suggestion;
  /** Paydays in the next year per income source, for "about $116 a check". */
  checksPerYear: Record<Id, number>;
  /** When the plan doesn't finish: the monthly budget that finishes it within 3 years. */
  finishIn3YearsMinor: number | null;
}

const THREE_YEARS = 36;

/**
 * The whole plan, worked out once: the chosen strategy against the other one
 * and against minimums only, the per-check view, the dated payments and the
 * suggestion. The screen only formats what comes back; it does no maths of
 * its own, so every number on it comes from one place and one set of
 * rounding rules.
 */
export function buildDebtPlan({
  debts,
  plan,
  incomes,
  subs,
  from,
  currency = 'USD',
}: {
  debts: Debt[];
  plan: DebtPlan;
  incomes: IncomeSource[];
  subs: Subscription[];
  from: DateKey;
  /** The plan's currency, settings.currency. Debts in any other are listed but not planned. */
  currency?: string;
}): DebtPlanView {
  const strategy: DebtStrategy = plan.strategy === 'snowball' ? 'snowball' : 'avalanche';
  const planned = debts.filter((d) => isPlanned(d, currency));

  // The minimums come first, because an unset plan's budget is "today's minimums".
  const first = simulate(planned, { budgetMinor: 0, run: 'minimumsOnly', from, maxSteps: 1 });
  const minimumsNowMinor = stepTotal(first, 0, (l) => l.minimumMinor);
  const { budgetMinor, source: budgetSource } = monthlyBudgetMinor({ plan, incomes, from, minimumsNowMinor });

  const comparison = comparePlans(planned, budgetMinor, strategy, from);
  const result = comparison.plan;

  const summaries: DebtSummary[] = debts.map((debt) => {
    const reason = notPlannedReason(debt, currency);
    const inPlan = reason === null;
    const nextLine = inPlan ? result.lines.find((l) => l.debtId === debt.id) : undefined;
    const firstLine = first.lines.find((l) => l.debtId === debt.id);
    // The same one-month test as growsAtMinimum: a shrink point exists only when it grows.
    const shrinkAt = inPlan ? paymentToShrinkMinor(debt, from) : null;
    const grows = shrinkAt !== null;
    return {
      debt,
      notPlanned: reason,
      plan: inPlan ? result.debts.find((d) => d.debtId === debt.id) ?? null : null,
      minimumsOnly: inPlan ? comparison.minimumsOnly.debts.find((d) => d.debtId === debt.id) ?? null : null,
      next: nextLine
        ? {
            dueOn: nextLine.dueOn,
            minimumMinor: nextLine.minimumMinor,
            extraMinor: nextLine.extraMinor,
            ...(nextLine.extraReason ? { extraReason: nextLine.extraReason } : {}),
          }
        : null,
      interestNowMinor: firstLine?.interestMinor ?? 0,
      growsAtMinimum: grows,
      paymentToShrinkMinor: shrinkAt,
      finishIn3YearsMinor: grows ? budgetToFinishWithin([debt], strategy, from, THREE_YEARS) : null,
      noSetPayment: debt.minimum.kind === 'fixed' && !(debt.minimum.amountMinor > 0),
      missingRate: debt.aprPercent === undefined || !Number.isFinite(debt.aprPercent),
      stale: isStale(debt, from),
      pastTerm: isPastTerm(debt, from),
      scheduledEndOn: scheduledEndOn(debt),
    };
  });

  return {
    from,
    currency,
    strategy,
    planned,
    debts: summaries,
    budgetMinor,
    budgetSource,
    comparison,
    result,
    checks: checkPlan({ incomes, subs, plan, result, debts: planned, from }),
    month: monthRows(result, planned),
    order: planOrder(result),
    open: openBalances(debts, currency),
    payments: scheduledPayments(result, planned, from, addDays(from, PAYMENTS_AHEAD_DAYS)),
    suggestion: suggestPerCheck({ incomes, subs, plan, minimumsNowMinor, from }),
    checksPerYear: checksPerYear(incomes, from),
    finishIn3YearsMinor:
      planned.length > 0 && result.status !== 'paidOff'
        ? budgetToFinishWithin(planned, strategy, from, THREE_YEARS)
        : null,
  };
}
