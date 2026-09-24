import { describe, expect, it } from 'vitest';
import { outlook, payPeriods, stillToCome } from '../src/lib/cashflow';
import {
  checkPlan,
  checksPerYear,
  hasPerCheck,
  markedPaidIn,
  monthlyBudgetMinor,
  monthRows,
  paycheckRows,
  perCheckShareMinor,
  suggestPerCheck,
  untrackedForDaysMinor,
} from '../src/lib/debtchecks';
import { buildDebtPlan, comparePlans, scheduledPayments } from '../src/lib/payoff';
import type { Debt, DebtPlan, IncomeSource, Subscription } from '../src/types';

/**
 * "How much from each check", held to the design's worked examples
 * (FINANCE_DESIGN §E, V8-V11, V14, V17).
 *
 * V9 and V10 follow the lead's decision 3 rather than the design's first
 * version: the suggestion is "the minimums, plus half of what is left after
 * everything else", rounded down to $10, with no cushion term. The arithmetic
 * for the new figures is written out next to each one.
 */

const FROM = '2026-09-24';

function income(partial: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: partial.name ?? 'job',
    name: 'Main job',
    frequency: 'biweekly',
    firstPaid: '2026-09-18',
    weekendShift: 'friday',
    holidays: [],
    grossMinor: 0,
    netMinor: 140_000,
    deductions: [],
    currency: 'USD',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: partial.name ?? 's',
    name: 'Phone',
    amountMinor: 0,
    currency: 'USD',
    cycle: 'monthly',
    every: 1,
    firstBilled: '2026-01-01',
    notes: '',
    cancelHow: '',
    remindDaysBefore: 3,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function debt(partial: Partial<Debt> = {}): Debt {
  return {
    id: partial.name ?? 'd',
    name: 'Card',
    kind: 'creditCard',
    balanceMinor: 0,
    balanceAsOf: FROM,
    minimum: { kind: 'fixed', amountMinor: 0 },
    dueDay: 1,
    autopay: false,
    currency: 'USD',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const plan = (partial: Partial<DebtPlan> = {}): DebtPlan => ({
  id: 'plan',
  strategy: 'avalanche',
  createdAt: 0,
  updatedAt: 0,
  ...partial,
});

// The V8 setup: one biweekly job, two subscriptions, two cards and a loan due on a payday.
const job = income();
const subs = [
  sub({ name: 'Phone', amountMinor: 6_500, firstBilled: '2026-01-22' }),
  sub({ name: 'Netflix', amountMinor: 1_549, firstBilled: '2026-01-10' }),
];
const cardA = debt({
  name: 'Card A',
  balanceMinor: 200_000,
  aprPercent: 24.99,
  minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 },
  dueDay: 5,
});
const cardB = debt({
  name: 'Card B',
  balanceMinor: 60_000,
  aprPercent: 19.99,
  minimum: { kind: 'percentOfBalance', percent: 3, floorMinor: 3_000 },
  dueDay: 28,
});
const loan = debt({ name: 'Loan', balanceMinor: 400_000, aprPercent: 7.5, minimum: { kind: 'fixed', amountMinor: 18_000 }, dueDay: 16 });
const debts = [cardA, cardB, loan];
const v8Plan = plan({ perCheckMinor: { [job.id]: 20_000 } });

describe('V14: from checks to a monthly budget', () => {
  const budgetFor = (source: IncomeSource, perCheck: number) =>
    monthlyBudgetMinor({ plan: plan({ perCheckMinor: { [source.id]: perCheck } }), incomes: [source], from: FROM, minimumsNowMinor: 0 });

  it('counts the real paydays in the coming year', () => {
    expect(budgetFor(job, 20_000)).toEqual({ budgetMinor: 43_333, source: 'perCheck' });
    expect(budgetFor(income({ frequency: 'semimonthly', daysOfMonth: [15, 31] }), 20_000).budgetMinor).toBe(40_000);
    expect(budgetFor(income({ frequency: 'weekly' }), 10_000).budgetMinor).toBe(43_333);
    expect(budgetFor(income({ frequency: 'monthly', daysOfMonth: [1] }), 50_000).budgetMinor).toBe(50_000);
    expect(checksPerYear([job], FROM)).toEqual({ job: 26 });
  });

  it('keeps paying today\'s minimums when nothing is chosen', () => {
    expect(hasPerCheck(plan(), [job])).toBe(false);
    expect(hasPerCheck(plan({ perCheckMinor: { someoneElse: 5_000 } }), [job])).toBe(false);
    expect(monthlyBudgetMinor({ plan: plan(), incomes: [job], from: FROM, minimumsNowMinor: 27_300 })).toEqual({
      budgetMinor: 27_300,
      source: 'minimums',
    });
  });

  it('uses a monthly amount only when no payday can be placed', () => {
    const noPayday = { incomes: [] as IncomeSource[], from: FROM, minimumsNowMinor: 27_300 };
    expect(monthlyBudgetMinor({ ...noPayday, plan: plan({ perMonthMinor: 40_000 }) })).toEqual({
      budgetMinor: 40_000,
      source: 'perMonth',
    });
    expect(monthlyBudgetMinor({ ...noPayday, plan: plan() }).source).toBe('minimums');
  });

  it('spreads a spending estimate over the days of a period', () => {
    expect(untrackedForDaysMinor(180_000, 14)).toBe(82_849);
    expect(untrackedForDaysMinor(180_000, 16)).toBe(94_685);
    expect(untrackedForDaysMinor(180_000, 7)).toBe(41_425);
  });

  it('turns a monthly amount into a share of each check, rounded up to the dollar (V6)', () => {
    // $250 a month, biweekly: 25000 × 12 / 26 = 11538 → $116.
    expect(perCheckShareMinor(25_000, [job], FROM)).toEqual({ job: 11_600 });
  });
});

describe('V8: which check pays what', () => {
  const cmp = comparePlans(debts, 43_333, 'avalanche', FROM);
  const checks = checkPlan({ incomes: [job], subs, plan: v8Plan, result: cmp.plan, debts, from: FROM });

  it('plans on $200 a check', () => {
    expect(monthlyBudgetMinor({ plan: v8Plan, incomes: [job], from: FROM, minimumsNowMinor: 27_300 }).budgetMinor).toBe(43_333);
    expect(cmp.minimumsNowMinor).toBe(27_300);
    expect(cmp.extraMonthlyMinor).toBe(16_033);
    const step0 = Object.fromEntries(cmp.plan.lines.filter((l) => l.step === 0).map((l) => [l.debtId, [l.minimumMinor, l.extraMinor]]));
    expect(step0).toEqual({ 'Card A': [6_300, 16_033], 'Card B': [3_000, 0], Loan: [18_000, 0] });
  });

  it('matches the plan figures', () => {
    expect(cmp.plan).toMatchObject({ status: 'paidOff', paidOffOn: '2028-02-16', steps: 17, totalInterestMinor: 59_915 });
    expect(cmp.plan.debts.find((d) => d.debtId === 'Card A')!.paidOffOn).toBe('2027-08-05');
    expect(cmp.other).toMatchObject({ paidOffOn: '2028-02-16', totalInterestMinor: 61_961 });
    expect(cmp.other.debts.find((d) => d.debtId === 'Card B')!.paidOffOn).toBe('2026-12-28');
    expect(cmp.minimumsOnly).toMatchObject({ paidOffOn: '2035-09-05', totalInterestMinor: 293_848 });
    expect(cmp.saved).toEqual({ interestMinor: 233_933, months: 91 });
  });

  it('uses the right six periods', () => {
    expect(payPeriods([job], FROM, 6).map((p) => p.start)).toEqual([
      '2026-09-18',
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
      '2026-11-13',
      '2026-11-27',
    ]);
  });

  it('pays a payment due on a payday from the check before', () => {
    expect(checks.map((c) => c.minimums.map((m) => [m.debt.name, m.dueOn, m.amountMinor]))).toEqual([
      [['Card B', '2026-09-28', 3_000]],
      [
        ['Card A', '2026-10-05', 6_300],
        // Due Oct 16, the day that check arrives, so it comes from this one.
        ['Loan', '2026-10-16', 18_000],
      ],
      [['Card B', '2026-10-28', 3_000]],
      [['Card A', '2026-11-05', 5_700]],
    ]);
  });

  it('keeps some of the first check for the second, which has more due than it brings', () => {
    const [p1, p2, p3, p4] = checks;
    expect(p1).toMatchObject({ towardDebtMinor: 20_000, usesKeptMinor: 0, keepForLaterMinor: 4_300, leftMinor: 113_500 });
    expect(p1.keepFor).toEqual(['2026-10-05', '2026-10-16']);
    expect(p1.extra.map((e) => [e.debt.name, e.amountMinor, e.reason])).toEqual([['Card A', 12_700, 'highestRate']]);
    expect(p1.current).toBe(true);

    expect(p2).toMatchObject({ towardDebtMinor: 20_000, usesKeptMinor: 4_300, keepForLaterMinor: 0, leftMinor: 118_451, extra: [] });
    expect(p3.extra.map((e) => [e.debt.name, e.amountMinor])).toEqual([['Card A', 17_000]]);
    expect(p3.leftMinor).toBe(113_500);
    expect(p4.extra.map((e) => [e.debt.name, e.amountMinor])).toEqual([['Card A', 14_300]]);
    expect(p4.leftMinor).toBe(118_451);
    for (const c of checks) expect(c.short).toBeNull();
  });

  it('with nothing chosen, each check pays exactly its own minimums', () => {
    const unset = checkPlan({ incomes: [job], subs, plan: plan(), result: comparePlans(debts, 27_300, 'avalanche', FROM).plan, debts, from: FROM });
    for (const c of unset) {
      expect(c.towardDebtMinor).toBe(c.minimums.reduce((s, m) => s + m.amountMinor, 0));
      expect(c.keepForLaterMinor).toBe(0);
      expect(c.extra).toEqual([]);
    }
  });
});

describe('V17: debt payments on Money', () => {
  const pays = scheduledPayments(comparePlans(debts, 43_333, 'avalanche', FROM).plan, debts, FROM, '2027-12-31');

  it('takes each check\'s payments out of what it leaves', () => {
    const periods = outlook([job], subs, FROM, 4, pays);
    expect(periods.map((p) => p.leftoverMinor)).toEqual([130_500, 114_151, 130_500, 132_751]);
    expect(periods.map((p) => p.paymentsMinor)).toEqual([3_000, 24_300, 3_000, 5_700]);
    expect(periods[1].payments.map((p) => p.debt.name)).toEqual(['Card A', 'Loan']);
    // What is still to come out now includes the payments.
    expect(periods[0].remainingMinor).toBe(3_000);
  });

  it('adds payments to "still to come", counted apart from the charges', () => {
    const { month, period } = stillToCome([job], subs, FROM, pays);
    expect(month).toEqual({ minor: 3_000, count: 0, paymentCount: 1, until: '2026-09-30' });
    expect(period).toEqual({ minor: 3_000, count: 0, paymentCount: 1, until: '2026-10-01' });
  });

  it('counts a payment due on the next payday in this period', () => {
    // Due Oct 2, the day the next check arrives: this check pays it.
    const onPayday = [{ debt: cardA, dueOn: '2026-10-02', amountMinor: 5_000, autopay: false }];
    expect(stillToCome([job], subs, FROM, onPayday).period?.minor).toBe(5_000);
    expect(stillToCome([job], subs, FROM, onPayday).month.minor).toBe(0);
    expect(outlook([job], subs, FROM, 2, onPayday)[0].paymentsMinor).toBe(5_000);
  });

  it('without payments, every figure is what it was', () => {
    expect(outlook([job], subs, FROM, 4).map((p) => p.leftoverMinor)).toEqual([133_500, 138_451, 133_500, 138_451]);
    expect(outlook([job], subs, FROM, 4, []).map((p) => p.remainingMinor)).toEqual(
      outlook([job], subs, FROM, 4).map((p) => p.remainingMinor),
    );
    const { month, period } = stillToCome([job], subs, FROM);
    expect(month).toEqual({ minor: 0, count: 0, paymentCount: 0, until: '2026-09-30' });
    expect(period?.minor).toBe(0);
  });
});

describe('V9: a suggestion per check', () => {
  const estimate = plan({ untrackedMonthlyMinor: 180_000 });

  it('suggests the minimums plus half of what is left after everything else', () => {
    // 7 periods start by Dec 23. Untracked for 14 days: 30,240,000 / 365 → 82849.
    // Room: 140000 − 6500 − 82849 = 50651 (4 phone periods) and
    //       140000 − 1549 − 82849 = 55602 (3 Netflix periods); Σ 369410 of Σ 980000.
    // Per check: 369410 × 140000 / 980000 = 52772.9 → 52773.
    // Minimums: 27300 × 12 / 26 = 12600.
    // 12600 + (52773 − 12600) / 2 = 32686.5 → rounded down to $10: $320.
    const s = suggestPerCheck({ incomes: [job], subs, plan: estimate, minimumsNowMinor: 27_300, from: FROM });
    expect(s.status).toBe('ok');
    expect(s.perSource).toHaveLength(1);
    expect(s.perSource[0]).toMatchObject({ checksPerYear: 26, minimumsNeedMinor: 12_600, roomMinor: 52_773, suggestedMinor: 32_000 });
    expect(s.budgetMinor).toBe(69_333);
  });

  it('with the suggestion used: paid off in August 2027', () => {
    const view = buildDebtPlan({ debts, plan: plan({ perCheckMinor: { job: 32_000 }, untrackedMonthlyMinor: 180_000 }), incomes: [job], subs, from: FROM });
    expect(view.budgetMinor).toBe(69_333);
    expect(view.result).toMatchObject({ paidOffOn: '2027-08-16', steps: 11, totalInterestMinor: 34_260 });
    expect(view.suggestion.perSource[0].suggestedMinor).toBe(32_000);
  });

  it('with the design\'s first figure, $457 a check, the engine gives what the design says', () => {
    const view = buildDebtPlan({ debts, plan: plan({ perCheckMinor: { job: 45_700 } }), incomes: [job], subs, from: FROM });
    expect(view.budgetMinor).toBe(99_017);
    expect(view.result).toMatchObject({ paidOffOn: '2027-04-16', steps: 7, totalInterestMinor: 24_133 });
  });

  it('with nothing chosen: today\'s minimums, kept the same', () => {
    const view = buildDebtPlan({ debts, plan: plan(), incomes: [job], subs, from: FROM });
    expect(view.budgetMinor).toBe(27_300);
    expect(view.result).toMatchObject({ paidOffOn: '2029-03-05', steps: 30, totalInterestMinor: 140_275 });
  });

  it('suggests nothing beyond the minimums without a spending estimate', () => {
    const s = suggestPerCheck({ incomes: [job], subs, plan: plan(), minimumsNowMinor: 27_300, from: FROM });
    expect(s.status).toBe('needsEstimate');
    expect(s.perSource[0]).toMatchObject({ roomMinor: null, suggestedMinor: 12_600, minimumsNeedMinor: 12_600 });
  });

  it('says so when the checks do not quite cover the minimums', () => {
    const s = suggestPerCheck({ incomes: [job], subs, plan: plan({ untrackedMonthlyMinor: 280_000 }), minimumsNowMinor: 27_300, from: FROM });
    expect(s.status).toBe('belowMinimums');
    expect(s.perSource[0].suggestedMinor).toBe(12_600);
  });

  it('never suggests less than the minimums', () => {
    const s = suggestPerCheck({ incomes: [job], subs, plan: estimate, minimumsNowMinor: 200_000, from: FROM });
    expect(s.perSource[0].suggestedMinor).toBe(s.perSource[0].minimumsNeedMinor);
  });

  it('says why when no payday can be placed', () => {
    const s = suggestPerCheck({ incomes: [], subs, plan: estimate, minimumsNowMinor: 27_300, from: FROM });
    expect(s).toMatchObject({ status: 'noPeriods', noPeriodReason: { kind: 'noIncome' }, perSource: [] });
  });
});

describe('V10: two jobs', () => {
  const big = income({ name: 'Job 1', netMinor: 120_000, firstPaid: '2026-09-18' });
  const small = income({ name: 'Job 2', netMinor: 30_000, firstPaid: '2026-09-25' });
  const estimate = plan({ untrackedMonthlyMinor: 180_000 });

  it('gives each check the same share of its take-home', () => {
    // Weekly periods, 14 in the window. Untracked for 7 days: 41425.
    // Room: 120000 − 41425 = 78575 (×7) and 30000 − 41425 = −11425 (×7); Σ 470050 of Σ 1050000.
    // Per check: 470050 × 120000 / 1050000 = 53720 and × 30000 / 1050000 = 13430.
    // No debts: half of each, rounded down to $10: $260 and $60.
    expect(payPeriods([big, small], FROM, 40).filter((p) => p.start <= '2026-12-23')).toHaveLength(14);
    const s = suggestPerCheck({ incomes: [big, small], subs: [], plan: estimate, minimumsNowMinor: 0, from: FROM });
    expect(s.perSource.map((p) => [p.source.name, p.roomMinor, p.suggestedMinor])).toEqual([
      ['Job 1', 53_720, 26_000],
      ['Job 2', 13_430, 6_000],
    ]);
    // (26000 + 6000) × 26 / 12.
    expect(s.budgetMinor).toBe(69_333);
  });

  it('with the V8 debts: each source carries its share of the minimums', () => {
    // Minimums: 27300 × 12 × 120000 / (120000 × 26 + 30000 × 26) = 10080 → $101; the small job's 2520 → $26.
    // 10100 + (53720 − 10100) / 2 = 31910 → $310; 2600 + (13430 − 2600) / 2 = 8015 → $80.
    const s = suggestPerCheck({ incomes: [big, small], subs: [], plan: estimate, minimumsNowMinor: 27_300, from: FROM });
    expect(s.perSource.map((p) => [p.minimumsNeedMinor, p.suggestedMinor])).toEqual([
      [10_100, 31_000],
      [2_600, 8_000],
    ]);
    expect(s.budgetMinor).toBe(84_500);
  });

  it('on a small check, says the bigger checks cover the rest of the estimate', () => {
    const view = buildDebtPlan({
      debts,
      plan: plan({ perCheckMinor: { 'Job 1': 31_000, 'Job 2': 8_000 }, untrackedMonthlyMinor: 180_000 }),
      incomes: [big, small],
      subs: [],
      from: FROM,
    });
    expect(view.budgetMinor).toBe(84_500);
    const [p1, p2, p3, p4] = view.checks;
    expect([p1, p2, p3, p4].map((c) => c.period.paidBy[0].name)).toEqual(['Job 1', 'Job 2', 'Job 1', 'Job 2']);
    expect(p2).toMatchObject({ leftMinor: 22_000, untrackedShareMinor: 41_425, leftBelowEstimate: true });
    expect(p1.leftBelowEstimate).toBe(false);
    // The small check before the loan's payday can't cover $180, so the big one keeps $100 for it.
    expect(p3).toMatchObject({ keepForLaterMinor: 10_000, keepFor: ['2026-10-16'] });
    expect(p4).toMatchObject({ usesKeptMinor: 10_000, towardDebtMinor: 8_000, extra: [] });
  });
});

describe("V11: a check that can't cover its payments", () => {
  const from = '2026-10-17';
  const pay = income({ name: 'J', netMinor: 80_000 });
  const loan650 = debt({ name: 'Loan', balanceMinor: 1_000_000, aprPercent: 0, minimum: { kind: 'fixed', amountMinor: 65_000 }, dueDay: 20 });
  const card200 = debt({ name: 'Card', balanceMinor: 1_000_000, aprPercent: 0, minimum: { kind: 'fixed', amountMinor: 20_000 }, dueDay: 25 });
  const view = buildDebtPlan({ debts: [loan650, card200], plan: plan({ perCheckMinor: { J: 45_000 } }), incomes: [pay], subs: [], from });
  const [p1, p2, p3] = view.checks;

  it('pays what is due anyway, and says by how much it goes over', () => {
    expect(view.checks.map((c) => c.minimums.reduce((s, m) => s + m.amountMinor, 0))).toEqual([85_000, 0, 85_000, 0]);
    expect(p1).toMatchObject({ towardDebtMinor: 85_000, leftMinor: -5_000, short: { overTargetMinor: 40_000, overIncomeMinor: 5_000 } });
  });

  it('keeps money back from the quiet check for the busy one after it', () => {
    expect(p2).toMatchObject({ keepForLaterMinor: 40_000, leftMinor: 35_000, short: null });
    expect(p2.keepFor).toEqual(['2026-11-20', '2026-11-25']);
    expect(p2.extra.map((e) => e.amountMinor)).toEqual([5_000]);
    expect(p3).toMatchObject({ usesKeptMinor: 40_000, towardDebtMinor: 45_000, extra: [], leftMinor: 35_000, short: null });
  });
});

describe('extra near the end of a plan', () => {
  it('never sends more than a balance; the rest stays with you', () => {
    const small = debt({ name: 'Small', balanceMinor: 10_000, aprPercent: 10, minimum: { kind: 'fixed', amountMinor: 2_500 }, dueDay: 5 });
    const view = buildDebtPlan({ debts: [small], plan: plan({ perCheckMinor: { job: 50_000 } }), incomes: [job], subs: [], from: FROM });
    const first = view.checks[0];
    const sent = first.extra.reduce((s, e) => s + e.amountMinor, 0);
    expect(sent + first.minimums.reduce((s, m) => s + m.amountMinor, 0) + first.keepForLaterMinor).toBeLessThanOrEqual(10_084);
    expect(first.staysMinor).toBeGreaterThan(0);
    expect(first.towardDebtMinor).toBe(50_000 - first.staysMinor);
    expect(first.leftMinor).toBe(first.incomeMinor - first.subscriptionsMinor - first.towardDebtMinor);
    // Once it is paid off, later checks keep all of it.
    expect(view.checks[2]).toMatchObject({ towardDebtMinor: 0, staysMinor: 50_000 });
  });
});

describe('the parts of a check add up', () => {
  const cmp = comparePlans(debts, 43_333, 'avalanche', FROM);
  const checks = checkPlan({ incomes: [job], subs, plan: v8Plan, result: cmp.plan, debts, from: FROM });

  it('minimums, extra and kept money make up everything a check puts toward debt', () => {
    expect(checks.map((c) => [c.minimumsMinor, c.extraMinor])).toEqual([
      [3_000, 12_700],
      [24_300, 0],
      [3_000, 17_000],
      [5_700, 14_300],
    ]);
    for (const c of checks) {
      expect(c.minimumsMinor + c.extraMinor + c.keepForLaterMinor - c.usesKeptMinor).toBe(c.towardDebtMinor);
    }
  });

  it('adds up the same way on a check that has to go over the amount chosen (V11)', () => {
    const from = '2026-10-17';
    const pay = income({ name: 'J', netMinor: 80_000 });
    const loan650 = debt({ name: 'Loan', balanceMinor: 1_000_000, aprPercent: 0, minimum: { kind: 'fixed', amountMinor: 65_000 }, dueDay: 20 });
    const card200 = debt({ name: 'Card', balanceMinor: 1_000_000, aprPercent: 0, minimum: { kind: 'fixed', amountMinor: 20_000 }, dueDay: 25 });
    const view = buildDebtPlan({ debts: [loan650, card200], plan: plan({ perCheckMinor: { J: 45_000 } }), incomes: [pay], subs: [], from });
    expect(view.checks[0].short).not.toBeNull();
    for (const c of view.checks) {
      expect(c.minimumsMinor + c.extraMinor + c.keepForLaterMinor - c.usesKeptMinor).toBe(c.towardDebtMinor);
    }
  });

  it('with nothing chosen, leaves exactly what Money says each check leaves', () => {
    // The one definition of "Left from this paycheck", on both screens.
    const result = comparePlans(debts, 27_300, 'avalanche', FROM).plan;
    const unset = checkPlan({ incomes: [job], subs, plan: plan(), result, debts, from: FROM });
    const money = outlook([job], subs, FROM, 4, scheduledPayments(result, debts, FROM, '2027-12-31'));
    expect(unset.map((c) => c.leftMinor)).toEqual(money.map((p) => p.leftoverMinor));
    expect(unset.map((c) => c.minimumsMinor)).toEqual(money.map((p) => p.paymentsMinor));
  });
});

describe('paycheckRows', () => {
  const cmp = comparePlans(debts, 43_333, 'avalanche', FROM);
  const [p1, p2] = checkPlan({ incomes: [job], subs, plan: v8Plan, result: cmp.plan, debts, from: FROM });

  it('gives a debt with nothing due its extra as a row of its own, after the dated ones', () => {
    expect(paycheckRows(p1).map((r) => [r.debt.name, r.dueOn, r.minimumMinor, r.extraMinor, r.totalMinor, r.reason])).toEqual([
      ['Card B', '2026-09-28', 3_000, 0, 3_000, undefined],
      ['Card A', null, 0, 12_700, 12_700, 'highestRate'],
    ]);
  });

  it('lists each minimum once, by date', () => {
    expect(paycheckRows(p2).map((r) => [r.debt.name, r.dueOn, r.totalMinor])).toEqual([
      ['Card A', '2026-10-05', 6_300],
      ['Loan', '2026-10-16', 18_000],
    ]);
  });

  it("puts extra on the same debt's minimum rather than listing the debt twice", () => {
    const rows = paycheckRows({
      minimums: [{ debt: cardA, dueOn: '2026-10-05', amountMinor: 6_300, autopay: false }],
      extra: [{ debt: cardA, amountMinor: 20_000, reason: 'highestRate' }],
    });
    expect(rows).toEqual([
      {
        debt: cardA,
        dueOn: '2026-10-05',
        minimumMinor: 6_300,
        extraMinor: 20_000,
        totalMinor: 26_300,
        reason: 'highestRate',
        autopay: false,
      },
    ]);
  });
});

describe('monthRows', () => {
  it("is the plan's first month: the next payment on each debt, extra where the plan puts it", () => {
    const result = comparePlans(debts, 43_333, 'avalanche', FROM).plan;
    const { rows, totalMinor } = monthRows(result, debts);
    expect(rows.map((r) => [r.debt.name, r.dueOn, r.minimumMinor, r.extraMinor])).toEqual([
      ['Card B', '2026-09-28', 3_000, 0],
      ['Card A', '2026-10-05', 6_300, 16_033],
      ['Loan', '2026-10-16', 18_000, 0],
    ]);
    expect(totalMinor).toBe(43_333);
  });

  it('gives the extra in the order the plan gives it, with why', () => {
    const result = comparePlans(debts, 43_333, 'avalanche', FROM).plan;
    expect(monthRows(result, debts).extras.map((e) => [e.debt.name, e.amountMinor, e.reason])).toEqual([
      ['Card A', 16_033, 'highestRate'],
    ]);
  });

  it('leaves out a month with nothing to pay', () => {
    const family = debt({ name: 'Mum', balanceMinor: 50_000, aprPercent: 0, minimum: { kind: 'fixed', amountMinor: 0 }, dueDay: 1 });
    const result = comparePlans([family], 0, 'avalanche', FROM).plan;
    expect(monthRows(result, [family])).toEqual({ rows: [], totalMinor: 0, extras: [] });
  });
});

describe('markedPaidIn', () => {
  const period = { start: '2026-09-18', end: '2026-10-01', incomeMinor: 0, paidBy: [] };

  it('names the debts marked paid for a payment this check covers, and no others', () => {
    const paid = debt({ name: 'Card B', paidThrough: '2026-09-28' });
    // Due on the next payday, so this check paid it.
    const onPayday = debt({ name: 'Loan', paidThrough: '2026-10-02' });
    // Due on this check's own payday: the check before paid it.
    const earlier = debt({ name: 'Card A', paidThrough: '2026-09-18' });
    const done = debt({ name: 'Old', paidThrough: '2026-09-25', paidOffOn: '2026-09-25' });
    expect(markedPaidIn([paid, onPayday, earlier, done, cardA], period).map((d) => d.name)).toEqual(['Card B', 'Loan']);
  });
});
