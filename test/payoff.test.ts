import { describe, expect, it } from 'vitest';
import {
  budgetToFinishWithin,
  buildDebtPlan,
  comparePlans,
  growsAtMinimum,
  MAX_STEPS,
  openBalances,
  paymentToShrinkMinor,
  planOrder,
  scheduledPayments,
  simulate,
  type PlanResult,
} from '../src/lib/payoff';
import { installmentPaymentMinor } from '../src/lib/debt';
import type { Debt, DebtPlan, IncomeSource } from '../src/types';

/**
 * The payoff engine, held to the design's worked examples (FINANCE_DESIGN §E).
 * Each vector was worked out independently and its first rows checked by
 * hand; a change here that moves a figure by a cent is a change to what the
 * owner is told about their money, and has to be deliberate.
 */

const FROM = '2026-09-24';

function debt(partial: Partial<Debt> = {}): Debt {
  return {
    id: partial.name ?? 'd',
    name: 'Card',
    kind: 'creditCard',
    balanceMinor: 0,
    balanceAsOf: FROM,
    minimum: { kind: 'fixed', amountMinor: 0 },
    dueDay: 24,
    autopay: false,
    currency: 'USD',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const fixed = (amountMinor: number) => ({ kind: 'fixed', amountMinor }) as const;
const card = { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 } as const;
const run = (debts: Debt[], budgetMinor: number, r: PlanResult['run'] = 'avalanche', maxSteps?: number) =>
  simulate(debts, { budgetMinor, run: r, from: FROM, maxSteps });
const linesOf = (result: PlanResult, id: string) => result.lines.filter((l) => l.debtId === id);
const outcomeOf = (result: PlanResult, id: string) => result.debts.find((d) => d.debtId === id)!;
const last = <T>(xs: T[]) => xs[xs.length - 1];

describe('V1: one card, a set $100 a month', () => {
  const v1 = debt({ name: 'Card', balanceMinor: 300_000, aprPercent: 24.99, minimum: fixed(10_000) });
  const result = run([v1], 10_000);
  const lines = linesOf(result, 'Card');

  it('charges exactly the right interest in the first months', () => {
    expect(lines.slice(0, 3).map((l) => [l.interestMinor, l.balanceAfterMinor])).toEqual([
      [6_248, 296_248],
      [6_169, 292_417],
      [6_090, 288_507],
    ]);
  });

  it('pays off in 48 payments, the last one exactly what is left', () => {
    expect(lines[46]).toMatchObject({ interestMinor: 316, balanceAfterMinor: 5_469 });
    expect(lines[47]).toMatchObject({ interestMinor: 114, minimumMinor: 5_583, balanceAfterMinor: 0 });
    expect(result).toMatchObject({
      status: 'paidOff',
      steps: 48,
      paidOffOn: '2030-08-24',
      totalInterestMinor: 175_583,
      totalPaidMinor: 475_583,
    });
    // Cross-check: −ln(1 − rB/P) / ln(1 + r) = 47.56, so the 48th payment is a part one.
    const r = 2499 / 120_000;
    expect(Math.ceil(-Math.log(1 - (r * 300_000) / 10_000) / Math.log(1 + r))).toBe(48);
  });
});

describe('V2: least interest against quickest wins', () => {
  const A = debt({ name: 'A', balanceMinor: 250_000, aprPercent: 22.99, minimum: fixed(5_000), dueDay: 10 });
  const B = debt({ name: 'B', balanceMinor: 80_000, aprPercent: 17.99, minimum: fixed(2_500), dueDay: 10 });
  const C = debt({ name: 'C', balanceMinor: 500_000, aprPercent: 8.99, minimum: fixed(15_000), dueDay: 10 });
  const cmp = comparePlans([A, B, C], 50_000, 'avalanche', FROM);
  const step = (r: PlanResult, s: number) =>
    Object.fromEntries(r.lines.filter((l) => l.step === s).map((l) => [l.debtId, l.balanceAfterMinor]));

  it('puts all the extra on the highest rate first', () => {
    expect(cmp.minimumsNowMinor).toBe(22_500);
    expect(cmp.plan.lines.filter((l) => l.step === 0).map((l) => [l.debtId, l.interestMinor])).toEqual([
      ['A', 4_790],
      ['B', 1_199],
      ['C', 3_746],
    ]);
    expect(step(cmp.plan, 0)).toEqual({ A: 222_290, B: 78_699, C: 488_746 });
    expect(linesOf(cmp.plan, 'A')[0]).toMatchObject({ extraMinor: 27_500, extraReason: 'highestRate' });
    expect(linesOf(cmp.plan, 'A')[1]).toMatchObject({ interestMinor: 4_259, balanceAfterMinor: 194_049 });
    expect(cmp.plan.focusByStep[0]).toBe('A');
  });

  it('puts all the extra on the smallest balance for quickest wins', () => {
    expect(step(cmp.other, 0)).toMatchObject({ A: 249_790, B: 51_199 });
    expect(linesOf(cmp.other, 'B')[0]).toMatchObject({ extraMinor: 27_500, extraReason: 'smallestBalance' });
  });

  it('matches the table', () => {
    const table = (r: PlanResult) => r.debts.map((d) => [d.debtId, d.paidOffOn, d.payments]);
    expect(table(cmp.plan)).toEqual([
      ['A', '2027-06-10', 9],
      ['B', '2027-08-10', 11],
      ['C', '2028-04-10', 19],
    ]);
    expect(cmp.plan.debts.map((d) => d.interestMinor)).toEqual([23_116, 10_998, 47_386]);
    expect(cmp.plan.totalInterestMinor).toBe(81_500);
    expect(table(cmp.other)).toEqual([
      ['A', '2027-08-10', 11],
      ['B', '2026-12-10', 3],
      ['C', '2028-04-10', 19],
    ]);
    expect(cmp.other.totalInterestMinor).toBe(84_307);
    expect(table(cmp.minimumsOnly)).toEqual([
      ['A', '2040-08-10', 167],
      ['B', '2030-05-10', 44],
      ['C', '2029-12-10', 39],
    ]);
    expect(cmp.minimumsOnly.totalInterestMinor).toBe(691_929);
  });

  it('says how far apart the two strategies are', () => {
    expect(cmp.strategyDelta).toEqual({ interestMinor: 2_807, aboutTheSame: false });
    expect(cmp.extraMonthlyMinor).toBe(27_500);
    expect(cmp.saved).toEqual({ interestMinor: 691_929 - 81_500, months: 167 - 19 });
  });

  it('pays the minimums anyway when they come to more than the budget, and says when', () => {
    const tight = run([A, B, C], 20_000);
    expect(tight.minimumsAboveBudgetOn).toBe('2026-10-10');
    expect(tight.lines.filter((l) => l.step === 0).reduce((s, l) => s + l.minimumMinor + l.extraMinor, 0)).toBe(22_500);
  });

  it('keeps the total the same as debts finish: a finished minimum becomes extra', () => {
    // After B is paid off in quickest wins, every month still spends $500.
    const spent = (r: PlanResult, s: number) =>
      r.lines.filter((l) => l.step === s).reduce((sum, l) => sum + l.minimumMinor + l.extraMinor, 0);
    for (let s = 0; s < 17; s++) expect(spent(cmp.other, s), `step ${s}`).toBe(50_000);
  });
});

describe('V3: a deferred-interest promo', () => {
  const store = debt({
    name: 'Store card',
    balanceMinor: 120_000,
    aprPercent: 29.99,
    promo: { aprPercent: 0, endsOn: '2027-03-05', deferred: true, heldBackMinor: 12_000 },
    minimum: fixed(3_000),
    dueDay: 5,
  });
  const cardA = debt({ name: 'Card A', balanceMinor: 200_000, aprPercent: 24.99, minimum: fixed(6_000), dueDay: 15 });

  it('(a) paces the promo to clear one payment early, and gives the rest to the strategy', () => {
    const cmp = comparePlans([store, cardA], 40_000, 'avalanche', FROM);
    const promoLines = linesOf(cmp.plan, 'Store card');
    // 6 due dates to Mar 5, less one: 120000 / 5 = 24000 a month, $30 of it the minimum.
    expect(promoLines[0]).toMatchObject({ minimumMinor: 3_000, extraMinor: 21_000, extraReason: 'promoDeadline' });
    expect(promoLines.map((l) => l.balanceAfterMinor)).toEqual([96_000, 72_000, 48_000, 24_000, 0]);
    expect(last(promoLines).dueOn).toBe('2027-02-05');
    expect(linesOf(cmp.plan, 'Card A')[0]).toMatchObject({ extraMinor: 10_000, balanceAfterMinor: 188_165 });

    const promo = outcomeOf(cmp.plan, 'Store card');
    expect(promo.promoClearedOn).toBe('2027-02-05');
    // The held-back interest is discarded: the promo balance was cleared in time.
    expect(promo.chargedBackMinor).toBe(0);
    expect(outcomeOf(cmp.plan, 'Card A').paidOffOn).toBe('2027-06-15');
    expect(cmp.plan).toMatchObject({ steps: 9, totalInterestMinor: 25_127 });
    expect(cmp.promoWarnings).toEqual([]);
  });

  it('(a) clears the promo in time in quickest wins too', () => {
    const snowball = run([store, cardA], 40_000, 'snowball');
    expect(outcomeOf(snowball, 'Store card').paidOffOn).toBe('2027-01-05');
    expect(snowball.totalInterestMinor).toBe(27_074);
  });

  it('(b) at the minimums, adds the held-back interest back and never finishes', () => {
    const mins = run([store, cardA], 0, 'minimumsOnly');
    const lines = linesOf(mins, 'Store card');
    // Shadow interest on 120000, 117000 … 105000: 2999 + 2924 + … + 2624.
    expect(lines.slice(0, 6).map((l) => l.balanceAfterMinor)).toEqual([117_000, 114_000, 111_000, 108_000, 105_000, 102_000]);
    expect(lines[6]).toMatchObject({
      dueOn: '2027-04-05',
      chargedBackMinor: 12_000 + 16_869,
      interestMinor: 3_271,
      balanceAfterMinor: 131_140,
    });
    const promo = outcomeOf(mins, 'Store card');
    expect(promo).toMatchObject({ chargedBackMinor: 28_869, chargedBackOn: '2027-04-05', promoLeftMinor: 102_000 });
    // $30 is less than the interest after that, so it is stuck, not paid off.
    expect(promo.stuck).toBe(true);
    expect(promo.paidOffOn).toBeNull();
    expect(outcomeOf(mins, 'Card A')).toMatchObject({ paidOffOn: '2031-07-15', payments: 58, interestMinor: 144_890 });
    expect(mins.status).toBe('stuck');
  });

  it('(c) warns when the plan cannot clear the promo in time', () => {
    const cmp = comparePlans([store, cardA], 15_000, 'avalanche', FROM);
    const promo = outcomeOf(cmp.plan, 'Store card');
    // Shadow 2999 + 2774 + 2549 + 2324 + 2099 + 1874 = 14619.
    expect(promo).toMatchObject({ chargedBackMinor: 26_619, chargedBackOn: '2027-04-05', paidOffOn: '2028-04-05' });
    expect(outcomeOf(cmp.plan, 'Card A').paidOffOn).toBe('2029-04-15');
    expect(cmp.plan.totalInterestMinor).toBe(133_907);
    expect(cmp.promoWarnings).toEqual([
      {
        debtId: 'Store card',
        endsOn: '2027-03-05',
        leftMinor: 66_000,
        chargeMinor: 26_619,
        neededMonthlyMinor: 24_000,
        neededBudgetMinor: 30_000,
      },
    ]);
  });
});

describe('V4: "1% plus interest, at least $35"', () => {
  const v4 = debt({ name: 'Card', balanceMinor: 300_000, aprPercent: 24.99, minimum: card });

  it('minimums only: shrinking payments, the floor from payment 94, 147 in all', () => {
    const r = run([v4], 0, 'minimumsOnly');
    expect(r.lines.slice(0, 3).map((l) => l.minimumMinor)).toEqual([9_400, 9_300, 9_200]);
    expect(r.lines[0].balanceAfterMinor).toBe(296_848);
    expect(r.lines.findIndex((l) => l.minimumMinor === 3_500) + 1).toBe(94);
    expect(r).toMatchObject({ status: 'paidOff', steps: 147, totalInterestMinor: 447_959 });
    expect(last(r.lines).minimumMinor).toBe(2_059);
  });

  it('"keep paying $94" finishes in 54', () => {
    const r = run([v4], 9_400);
    expect(r).toMatchObject({ steps: 54, totalInterestMinor: 198_255 });
    expect(last(r.lines).minimumMinor + last(r.lines).extraMinor).toBe(55);
  });

  it('3% of the balance, at least $30', () => {
    const r = run([{ ...v4, minimum: { kind: 'percentOfBalance', percent: 3, floorMinor: 3_000 } }], 0, 'minimumsOnly');
    expect(r.lines[0].minimumMinor).toBe(9_200);
    expect(r).toMatchObject({ steps: 166, totalInterestMinor: 485_475 });
  });
});

describe('V5: an installment loan', () => {
  it('finishes in exactly the scheduled 60 payments', () => {
    const payment = installmentPaymentMinor(2_000_000, 6.9, 60);
    const r = run([debt({ balanceMinor: 2_000_000, aprPercent: 6.9, minimum: fixed(payment) })], 0, 'minimumsOnly');
    expect(r.lines[0]).toMatchObject({ interestMinor: 11_500, balanceAfterMinor: 1_971_991 });
    expect(r).toMatchObject({ steps: 60, totalInterestMinor: 370_475 });
    expect(last(r.lines).minimumMinor).toBe(39_444);
  });

  it('would need a 61st payment of 10 cents if the payment were rounded to the nearest cent', () => {
    const r = run([debt({ balanceMinor: 2_000_000, aprPercent: 6.9, minimum: fixed(39_508) })], 0, 'minimumsOnly');
    expect(r.steps).toBe(61);
    expect(last(r.lines).minimumMinor).toBe(10);
  });

  it('$5,000 at 11.99% over 36 months', () => {
    const r = run([debt({ balanceMinor: 500_000, aprPercent: 11.99, minimum: fixed(16_605) })], 0, 'minimumsOnly');
    expect(r).toMatchObject({ steps: 36, totalInterestMinor: 97_767 });
    expect(last(r.lines).minimumMinor).toBe(16_592);
  });
});

describe('V6: a payment below the interest', () => {
  const v6 = debt({ name: 'Card', balanceMinor: 1_000_000, aprPercent: 29.99, minimum: fixed(20_000) });

  it('grows at the minimum', () => {
    const r = run([v6], 0, 'minimumsOnly');
    expect(r.lines.slice(0, 2).map((l) => [l.interestMinor, l.balanceAfterMinor])).toEqual([
      [24_992, 1_004_992],
      [25_116, 1_010_108],
    ]);
    expect(r.lines[11].balanceAfterMinor).toBe(1_068_858);
    expect(r.debts[0].stuck).toBe(true);
    expect(growsAtMinimum(v6, FROM)).toBe(true);
  });

  it('says the monthly payment where it starts to shrink', () => {
    expect(paymentToShrinkMinor(v6, FROM)).toBe(25_000);
    expect(paymentToShrinkMinor({ ...v6, minimum: fixed(30_000) }, FROM)).toBeNull();
    expect(growsAtMinimum({ ...v6, minimum: fixed(30_000) }, FROM)).toBe(false);
  });

  it('just about finishes at that payment', () => {
    expect(run([v6], 25_000)).toMatchObject({ status: 'paidOff', steps: 325, totalInterestMinor: 7_110_503 });
  });

  it('works out what finishes it in 3 years', () => {
    expect(installmentPaymentMinor(1_000_000, 29.99, 36)).toBe(42_447);
    expect(budgetToFinishWithin([v6], 'avalanche', FROM, 36)).toBe(42_500);
    expect(run([v6], 42_500)).toMatchObject({ steps: 36, totalInterestMinor: 526_915 });
    expect(run([v6], 42_400).steps).toBe(37);
  });

  it('calls a plan below the interest stuck, and says what gets it moving', () => {
    const cmp = comparePlans([v6], 20_000, 'avalanche', FROM);
    expect(cmp.plan.status).toBe('stuck');
    expect(cmp.plan.paidOffOn).toBeNull();
    expect(cmp.makeProgressMinor).toBe(25_000);
    expect(cmp.saved).toBeNull();
    expect(cmp.strategyDelta).toBeNull();
    expect(cmp.plan.debts[0].stuck).toBe(true);
  });
});

describe('V7: a 0% loan from family', () => {
  const v7 = debt({ name: 'Mom', kind: 'person', balanceMinor: 120_000, aprPercent: 0, minimum: fixed(10_000), dueDay: 1 });

  it('12 payments of $100', () => {
    expect(run([v7], 0, 'minimumsOnly')).toMatchObject({ steps: 12, totalInterestMinor: 0, paidOffOn: '2027-09-01' });
  });

  it('a part payment at the end', () => {
    const r = run([{ ...v7, balanceMinor: 125_000 }], 0, 'minimumsOnly');
    expect(r.steps).toBe(13);
    expect(last(r.lines)).toMatchObject({ dueOn: '2027-10-01', minimumMinor: 5_000 });
  });

  it('no set amount: stuck on its own, paid from the extra in a plan', () => {
    const none = { ...v7, minimum: fixed(0) };
    expect(run([none], 0, 'minimumsOnly').debts[0]).toMatchObject({ stuck: true, paidOffOn: null, payments: 0 });
    const planned = run([none], 10_000);
    expect(planned).toMatchObject({ status: 'paidOff', steps: 12 });
    expect(planned.lines.every((l) => l.minimumMinor === 0 && l.extraMinor > 0)).toBe(true);
    expect(planned.debts[0].payments).toBe(12);
  });
});

describe('V12: a balance transfer on part of the balance', () => {
  const v12 = debt({
    balanceMinor: 500_000,
    aprPercent: 27.99,
    promo: { aprPercent: 0, endsOn: '2027-06-30', deferred: false, balanceMinor: 400_000 },
    minimum: card,
    dueDay: 12,
  });

  it('pays the full-rate part first, minimum and extra', () => {
    const r = run([v12], 40_000);
    // I = 100000 × 2799 / 120000 = 2332.5 → 2333; 5023 + 2333 → $74.
    expect(r.lines[0]).toMatchObject({ interestMinor: 2_333, minimumMinor: 7_400, extraMinor: 32_600 });
    // 62333 left on the full-rate part, 400000 still on the promo.
    expect(r.lines[0].balanceAfterMinor).toBe(62_333 + 400_000);
    expect(r).toMatchObject({ steps: 13, paidOffOn: '2027-10-12', totalInterestMinor: 12_602 });
  });

  it('at the minimums', () => {
    expect(run([v12], 0, 'minimumsOnly')).toMatchObject({ paidOffOn: '2043-06-12', totalInterestMinor: 879_944 });
  });
});

describe('V13: an annual fee', () => {
  const v13 = debt({
    balanceMinor: 150_000,
    aprPercent: 21.99,
    minimum: card,
    dueDay: 12,
    fee: { amountMinor: 9_500, every: 'year', month: 1 },
  });

  it('raises the balance and the minimum in its month', () => {
    const r = run([v13], 10_000);
    const jan = r.lines.find((l) => l.dueOn === '2027-01-12')!;
    expect(jan).toMatchObject({ interestMinor: 2_343, feesMinor: 9_500, minimumMinor: 13_300 });
    expect(r.minimumsAboveBudgetOn).toBe('2027-01-12');
    expect(r).toMatchObject({ steps: 20, paidOffOn: '2028-05-12', totalInterestMinor: 29_486, totalFeesMinor: 19_000 });
  });
});

describe('V16: small rules in the engine', () => {
  it('starts after a payment marked paid', () => {
    const r = run([debt({ balanceMinor: 200_000, aprPercent: 24.99, minimum: card, dueDay: 5, paidThrough: '2026-10-05' })], 0, 'minimumsOnly');
    expect(r.lines[0].dueOn).toBe('2026-11-05');
  });

  it('leaves out a zero balance, a paid-off debt, another currency and one with no due date', () => {
    const skipped = [
      debt({ name: 'zero', balanceMinor: 0 }),
      debt({ name: 'done', balanceMinor: 5_000, paidOffOn: '2026-09-01' }),
      debt({ name: 'euro', balanceMinor: 5_000, currency: 'EUR' }),
      debt({ name: 'undated', balanceMinor: 5_000, dueDay: undefined }),
    ];
    const r = simulate(skipped, { budgetMinor: 10_000, run: 'avalanche', from: FROM, currency: 'USD' });
    expect(r.lines).toEqual([]);
    expect(r.debts).toEqual([]);
  });

  it('plans a missing rate at 0 and flags it', () => {
    const r = run([debt({ balanceMinor: 50_000, minimum: fixed(10_000) })], 0, 'minimumsOnly');
    expect(r.totalInterestMinor).toBe(0);
    expect(r.debts[0].missingRate).toBe(true);
    expect(run([debt({ balanceMinor: 50_000, aprPercent: 0, minimum: fixed(10_000) })], 0, 'minimumsOnly').debts[0].missingRate).toBe(false);
  });

  it('ignores a promo that ended before the balance was typed', () => {
    const ended = debt({
      balanceMinor: 100_000,
      balanceAsOf: '2026-09-01',
      aprPercent: 24.99,
      minimum: fixed(10_000),
      promo: { aprPercent: 0, endsOn: '2026-08-31', deferred: true, heldBackMinor: 5_000 },
    });
    const r = run([ended], 0, 'minimumsOnly');
    expect(r.lines[0].interestMinor).toBe(2_083);
    expect(r.totalInterestMinor).toBe(run([{ ...ended, promo: undefined }], 0, 'minimumsOnly').totalInterestMinor);
  });

  it('ends a promo whose date is before the first payment at the first payment', () => {
    const ending = debt({
      balanceMinor: 100_000,
      balanceAsOf: '2026-09-01',
      aprPercent: 24.99,
      minimum: fixed(10_000),
      dueDay: 5,
      promo: { aprPercent: 0, endsOn: '2026-09-30', deferred: true, heldBackMinor: 5_000 },
    });
    expect(run([ending], 0, 'minimumsOnly').lines[0]).toMatchObject({ dueOn: '2026-10-05', chargedBackMinor: 5_000 });
  });
});

describe('every-2-weeks payments', () => {
  const bnpl = debt({
    name: 'Pay in 4',
    kind: 'bnpl',
    cadence: 'every2weeks',
    dueDay: undefined,
    nextDueOn: '2026-10-01',
    balanceMinor: 40_000,
    aprPercent: 0,
    minimum: fixed(10_000),
  });

  it('pays on each of its dates, two a month', () => {
    const r = run([bnpl], 0, 'minimumsOnly');
    expect(r.lines.map((l) => [l.step, l.dueOn, l.minimumMinor, l.balanceAfterMinor])).toEqual([
      [0, '2026-10-01', 10_000, 30_000],
      [0, '2026-10-15', 10_000, 20_000],
      [1, '2026-10-29', 10_000, 10_000],
      [1, '2026-11-12', 10_000, 0],
    ]);
    expect(r).toMatchObject({ steps: 2, paidOffOn: '2026-11-12' });
    expect(r.debts[0].payments).toBe(4);
  });

  it('takes the month\'s extra on its first date, and rolls its payments on when it is done', () => {
    const other = debt({ name: 'Card', balanceMinor: 100_000, aprPercent: 20, minimum: fixed(5_000), dueDay: 10 });
    const r = run([bnpl, other], 30_000, 'snowball');
    expect(linesOf(r, 'Pay in 4')[0]).toMatchObject({ extraMinor: 5_000, extraReason: 'smallestBalance' });
    expect(outcomeOf(r, 'Pay in 4').paidOffOn).toBe('2026-11-12');
    expect(linesOf(r, 'Card').slice(2, 4).map((l) => l.extraMinor)).toEqual([25_000, 25_000]);
  });
});

describe('the engine', () => {
  const a = debt({ name: 'A', balanceMinor: 250_000, aprPercent: 22.99, minimum: card, dueDay: 10 });
  const b = debt({ name: 'B', balanceMinor: 80_000, aprPercent: 17.99, minimum: fixed(2_500), dueDay: 20 });

  it('never changes what it is given', () => {
    const before = JSON.stringify([a, b]);
    comparePlans([a, b], 30_000, 'snowball', FROM);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it('gives the same answer every time', () => {
    expect(run([a, b], 30_000)).toEqual(run([a, b], 30_000));
  });

  it('breaks a tie in rate by the smaller balance, then the name', () => {
    const x = debt({ name: 'X', balanceMinor: 90_000, aprPercent: 20, minimum: fixed(2_500), dueDay: 10 });
    const y = debt({ name: 'Y', balanceMinor: 50_000, aprPercent: 20, minimum: fixed(2_500), dueDay: 10 });
    const z = debt({ name: 'Z', balanceMinor: 50_000, aprPercent: 20, minimum: fixed(2_500), dueDay: 10 });
    expect(run([x, z, y], 20_000).focusByStep[0]).toBe('Y');
  });

  it('says so when it would take more than 50 years', () => {
    // 33 cents a month over the interest on $100,000 at 5%: it shrinks, just
    // not within a lifetime (about 1,700 months by the loan formula).
    const slow = debt({ balanceMinor: 10_000_000, aprPercent: 5, minimum: fixed(20_000) });
    const r = run([slow], 41_700);
    expect(r.status).toBe('tooLong');
    expect(r.steps).toBe(MAX_STEPS);
    expect(r.paidOffOn).toBeNull();
  });

  it('stops a balance that could never be paid, rather than counting to infinity', () => {
    const huge = debt({ balanceMinor: 1e9, aprPercent: 999, minimum: fixed(100) });
    const r = run([huge], 100);
    expect(r.status).toBe('stuck');
    expect(r.steps).toBeLessThanOrEqual(24);
  });

  it('with nothing to plan, is simply done', () => {
    const r = run([], 10_000);
    expect(r).toMatchObject({ status: 'paidOff', steps: 0, paidOffOn: null, lines: [], debts: [] });
  });
});

describe('scheduledPayments', () => {
  it('lists the minimums due in a window, by date then name', () => {
    const a = debt({ name: 'A', balanceMinor: 100_000, aprPercent: 10, minimum: fixed(5_000), dueDay: 10, autopay: true });
    const b = debt({ name: 'B', balanceMinor: 100_000, aprPercent: 10, minimum: fixed(4_000), dueDay: 1 });
    const r = run([a, b], 20_000);
    const payments = scheduledPayments(r, [a, b], FROM, '2026-11-10');
    expect(payments.map((p) => [p.debt.name, p.dueOn, p.amountMinor, p.autopay])).toEqual([
      ['B', '2026-10-01', 4_000, false],
      ['A', '2026-10-10', 5_000, true],
      ['B', '2026-11-01', 4_000, false],
      ['A', '2026-11-10', 5_000, true],
    ]);
  });

  it('leaves out a month with no set amount: the extra is per check, not a dated payment', () => {
    const mom = debt({ name: 'Mom', balanceMinor: 120_000, aprPercent: 0, minimum: fixed(0), dueDay: 1 });
    expect(scheduledPayments(run([mom], 10_000), [mom], FROM, '2027-12-31')).toEqual([]);
  });
});

describe('buildDebtPlan', () => {
  const job: IncomeSource = {
    id: 'job',
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
  };
  const plan = (partial: Partial<DebtPlan> = {}): DebtPlan => ({
    id: 'plan',
    strategy: 'avalanche',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  });
  const a = debt({ name: 'Card A', balanceMinor: 200_000, aprPercent: 24.99, minimum: card, dueDay: 5 });
  const euro = debt({ name: 'Euro card', balanceMinor: 50_000, aprPercent: 20, minimum: card, currency: 'EUR' });
  const zero = debt({ name: 'Old card', balanceMinor: 0, aprPercent: 20, minimum: card });

  it('keeps paying today\'s minimums until an amount is chosen', () => {
    const view = buildDebtPlan({ debts: [a], plan: plan(), incomes: [job], subs: [], from: FROM });
    expect(view.budgetSource).toBe('minimums');
    expect(view.budgetMinor).toBe(6_300);
    expect(view.comparison.minimumsNowMinor).toBe(6_300);
    expect(view.suggestion.status).toBe('needsEstimate');
  });

  it('runs on the amounts chosen per check', () => {
    const view = buildDebtPlan({ debts: [a], plan: plan({ perCheckMinor: { job: 20_000 } }), incomes: [job], subs: [], from: FROM });
    expect(view.budgetSource).toBe('perCheck');
    expect(view.budgetMinor).toBe(43_333);
    expect(view.checksPerYear).toEqual({ job: 26 });
    expect(view.result).toBe(view.comparison.plan);
    expect(view.checks).toHaveLength(4);
  });

  it('lists every debt, and says why one is not in the plan', () => {
    const view = buildDebtPlan({ debts: [a, euro, zero], plan: plan(), incomes: [job], subs: [], from: FROM, currency: 'USD' });
    expect(view.planned.map((d) => d.name)).toEqual(['Card A']);
    expect(view.debts.map((d) => [d.debt.name, d.notPlanned])).toEqual([
      ['Card A', null],
      ['Euro card', 'otherCurrency'],
      ['Old card', 'zeroBalance'],
    ]);
    const [first, other] = view.debts;
    expect(first.next).toEqual({ dueOn: '2026-10-05', minimumMinor: 6_300, extraMinor: 0 });
    expect(first.interestNowMinor).toBe(4_165);
    expect(first.plan?.paidOffOn).toBeTruthy();
    expect(first.minimumsOnly?.paidOffOn).toBeTruthy();
    expect(other.plan).toBeNull();
    expect(other.next).toBeNull();
  });

  it('gives Money and Today the dated minimums', () => {
    const view = buildDebtPlan({ debts: [a], plan: plan(), incomes: [job], subs: [], from: FROM });
    expect(view.payments.slice(0, 2).map((p) => [p.dueOn, p.amountMinor])).toEqual([
      ['2026-10-05', 6_300],
      ['2026-11-05', 6_200],
    ]);
  });

  it('works out what gets a stuck plan done in 3 years', () => {
    const v6 = debt({ name: 'Card', balanceMinor: 1_000_000, aprPercent: 29.99, minimum: fixed(20_000) });
    const view = buildDebtPlan({ debts: [v6], plan: plan(), incomes: [], subs: [], from: FROM });
    expect(view.result.status).toBe('stuck');
    expect(view.finishIn3YearsMinor).toBe(42_500);
    expect(view.debts[0]).toMatchObject({ growsAtMinimum: true, paymentToShrinkMinor: 25_000, finishIn3YearsMinor: 42_500 });
  });

  it('falls back to a monthly amount only when no payday can be placed', () => {
    const view = buildDebtPlan({ debts: [a], plan: plan({ perMonthMinor: 30_000, perCheckMinor: { job: 20_000 } }), incomes: [], subs: [], from: FROM });
    expect(view.budgetSource).toBe('perMonth');
    expect(view.budgetMinor).toBe(30_000);
    expect(view.checks).toEqual([]);
    expect(view.suggestion.status).toBe('noPeriods');
  });

  it('flags the notes a debt card needs', () => {
    const old = debt({
      name: 'Car',
      balanceMinor: 300_000,
      balanceAsOf: '2026-07-01',
      minimum: fixed(40_000),
      loan: { firstPaymentOn: '2021-06-10', termMonths: 60 },
    });
    const [summary] = buildDebtPlan({ debts: [old], plan: plan(), incomes: [], subs: [], from: FROM }).debts;
    expect(summary).toMatchObject({ stale: true, pastTerm: true, scheduledEndOn: '2026-05-10', missingRate: true, noSetPayment: false });
  });
});

describe('planOrder', () => {
  const a = debt({ name: 'Card A', balanceMinor: 200_000, aprPercent: 24.99, minimum: card, dueDay: 5 });
  const b = debt({ name: 'Card B', balanceMinor: 60_000, aprPercent: 19.99, minimum: card, dueDay: 28 });
  const loan = debt({ name: 'Loan', balanceMinor: 400_000, aprPercent: 7.5, minimum: fixed(18_000), dueDay: 16 });
  const avalanche = run([a, b, loan], 43_333);

  it('lists the debts in the order the extra reaches them, with why, and which one it moved on from', () => {
    const order = planOrder(avalanche);
    expect(order.map((e) => [e.debtId, e.reason, e.after])).toEqual([
      ['Card A', 'highestRate', null],
      ['Card B', 'highestRate', 'Card A'],
      ['Loan', 'highestRate', 'Card B'],
    ]);
    expect(order[0]).toMatchObject({ firstStep: 0, paidOffOn: '2027-08-05' });
    // Each one's first extra is on the plan's own line for it.
    for (const entry of order) {
      const first = linesOf(avalanche, entry.debtId).find((l) => l.extraMinor > 0)!;
      expect([entry.firstStep, entry.firstExtraOn]).toEqual([first.step, first.dueOn]);
    }
    expect(order[1].firstStep!).toBeGreaterThan(0);
  });

  it('follows the smallest balance for the snowball', () => {
    expect(planOrder(run([a, b, loan], 43_333, 'snowball'))[0]).toMatchObject({ debtId: 'Card B', reason: 'smallestBalance' });
  });

  it('puts debts only ever paid their own minimum after the rest, by when they finish', () => {
    const order = planOrder(run([a, b, loan], 0, 'minimumsOnly'));
    expect(order.every((e) => e.reason === null && e.firstStep === null && e.after === null)).toBe(true);
    const dates = order.map((e) => e.paidOffOn ?? '9999-12-31');
    expect([...dates].sort()).toEqual(dates);
  });

  it('gives a paced promo its own reason, with no debt before it', () => {
    const store = debt({
      name: 'Store',
      balanceMinor: 120_000,
      aprPercent: 29.99,
      minimum: card,
      dueDay: 10,
      promo: { aprPercent: 0, endsOn: '2027-03-10', deferred: true },
    });
    expect(planOrder(run([a, store], 60_000))[0]).toMatchObject({
      debtId: 'Store',
      reason: 'promoDeadline',
      firstStep: 0,
      after: null,
    });
  });
});

describe('openBalances', () => {
  it("counts what is still being paid, and adds up the balances in the plan's currency", () => {
    const a = debt({ name: 'A', balanceMinor: 100_000 });
    const b = debt({ name: 'B', balanceMinor: 25_050 });
    const done = debt({ name: 'Done', balanceMinor: 0, paidOffOn: '2026-09-01' });
    expect(openBalances([a, b, done], 'USD')).toEqual({ count: 2, totalMinor: 125_050, otherCurrency: 0, asOf: FROM });
  });

  it('gives no single date when balances were typed on different days, and leaves other currencies out of the total', () => {
    const a = debt({ name: 'A', balanceMinor: 100_000, balanceAsOf: '2026-09-01' });
    const euro = debt({ name: 'E', balanceMinor: 5_000, currency: 'EUR' });
    expect(openBalances([a, euro], 'USD')).toEqual({ count: 2, totalMinor: 100_000, otherCurrency: 1, asOf: null });
  });
});

describe('buildDebtPlan, for the screen', () => {
  const a = debt({ name: 'Card A', balanceMinor: 200_000, aprPercent: 24.99, minimum: card, dueDay: 5 });
  const plan: DebtPlan = { id: 'plan', strategy: 'avalanche', createdAt: 0, updatedAt: 0 };

  it('hands over the first month as rows, the plan order and the open balances', () => {
    const view = buildDebtPlan({ debts: [a], plan, incomes: [], subs: [], from: FROM });
    expect(view.month).toEqual({
      rows: [{ debt: a, dueOn: '2026-10-05', minimumMinor: 6_300, extraMinor: 0, totalMinor: 6_300, autopay: false }],
      totalMinor: 6_300,
      extras: [],
    });
    expect(view.order.map((e) => e.debtId)).toEqual(['Card A']);
    expect(view.open).toEqual({ count: 1, totalMinor: 200_000, otherCurrency: 0, asOf: FROM });
  });
});
