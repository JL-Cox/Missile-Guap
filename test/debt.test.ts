import { describe, expect, it } from 'vitest';
import {
  accrue,
  applyKindPreset,
  aprBasisPoints,
  balanceAfterPaymentMinor,
  ceilToDollar,
  DEBT_KIND_LABELS,
  DEBT_KIND_PRESETS,
  DEBT_KINDS,
  divRoundHalfUp,
  dueDatesFrom,
  dueDatesInWindow,
  feeDueMinor,
  floorToDollar,
  hasSchedule,
  installmentPaymentMinor,
  isInterestOnly,
  isPastTerm,
  isPlanned,
  isStale,
  minimumDueMinor,
  monthlyInterestMinor,
  nextDueOn,
  notPlannedReason,
  scheduledEndOn,
  startingParts,
} from '../src/lib/debt';
import { parsePercent } from '../src/lib/money';
import type { Debt } from '../src/types';

/**
 * The arithmetic of one debt. Every figure here ends up next to a statement
 * the owner can check it against, so the rounding is pinned down exactly,
 * including the one case a float gets wrong.
 */

const FROM = '2026-09-24';

function debt(partial: Partial<Debt> = {}): Debt {
  return {
    id: partial.name ?? 'd1',
    name: 'Card A',
    kind: 'creditCard',
    balanceMinor: 200_000,
    balanceAsOf: FROM,
    aprPercent: 24.99,
    minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 },
    dueDay: 5,
    autopay: false,
    currency: 'USD',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('rates are whole basis points, never multiplied as floats', () => {
  it('converts the rates people actually type (V14)', () => {
    expect(aprBasisPoints(24.99)).toBe(2499);
    expect(aprBasisPoints(8.99)).toBe(899);
    expect(aprBasisPoints(7.5)).toBe(750);
    expect(aprBasisPoints(29.99)).toBe(2999);
  });

  it('treats a missing rate as 0 and keeps silly ones in range', () => {
    expect(aprBasisPoints(undefined)).toBe(0);
    expect(aprBasisPoints(-3)).toBe(0);
    expect(aprBasisPoints(5000)).toBe(99_999);
    expect(aprBasisPoints(Number.NaN)).toBe(0);
  });
});

describe('divRoundHalfUp', () => {
  it('rounds halves up and everything else to the nearest', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(7, 4)).toBe(2);
    expect(divRoundHalfUp(5, 4)).toBe(1);
    expect(divRoundHalfUp(0, 7)).toBe(0);
    expect(divRoundHalfUp(120_000, 120_000)).toBe(1);
  });

  it('gets the exact half a float misses (V1)', () => {
    // 300000 × 24.99 ÷ 1200 is exactly 6247.5. As floats it is 6247.4999…,
    // which rounds to 6247 - a cent short on the very first statement.
    expect(Math.round((300_000 * 24.99) / 1200)).toBe(6247);
    expect(divRoundHalfUp(300_000 * 2499, 120_000)).toBe(6248);
    expect(monthlyInterestMinor(300_000, 24.99)).toBe(6248);
  });
});

describe('monthlyInterestMinor', () => {
  it('is APR ÷ 12 on the balance, to the cent (V1, V2, V5, V6)', () => {
    expect(monthlyInterestMinor(296_248, 24.99)).toBe(6169);
    expect(monthlyInterestMinor(292_417, 24.99)).toBe(6090);
    expect(monthlyInterestMinor(250_000, 22.99)).toBe(4790);
    expect(monthlyInterestMinor(80_000, 17.99)).toBe(1199);
    expect(monthlyInterestMinor(500_000, 8.99)).toBe(3746);
    expect(monthlyInterestMinor(2_000_000, 6.9)).toBe(11_500);
    expect(monthlyInterestMinor(1_000_000, 29.99)).toBe(24_992);
  });

  it('charges nothing on nothing, or on a missing rate', () => {
    expect(monthlyInterestMinor(0, 24.99)).toBe(0);
    expect(monthlyInterestMinor(-500, 24.99)).toBe(0);
    expect(monthlyInterestMinor(300_000, undefined)).toBe(0);
  });
});

describe('whole dollars', () => {
  it('rounds up and down to the dollar', () => {
    expect(ceilToDollar(9_310)).toBe(9_400);
    expect(ceilToDollar(9_300)).toBe(9_300);
    expect(ceilToDollar(1)).toBe(100);
    expect(floorToDollar(45_773)).toBe(45_700);
    expect(floorToDollar(45_700)).toBe(45_700);
  });
});

describe('minimumDueMinor', () => {
  const card = { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 } as const;

  it('1% plus interest, rounded up to the dollar (V4)', () => {
    // I 6248; S 306248; 1% is 3062.48 → 3062; + 6248 = 9310 → $94.
    expect(minimumDueMinor(card, 306_248, 6_248, 0)).toBe(9_400);
    // I 6182; S 303030; 3030 + 6182 = 9212 → $93.
    expect(minimumDueMinor(card, 303_030, 6_182, 0)).toBe(9_300);
  });

  it('never goes below the floor, or above the balance', () => {
    expect(minimumDueMinor(card, 100_000, 500, 0)).toBe(3_500);
    expect(minimumDueMinor(card, 2_000, 30, 0)).toBe(2_000);
    expect(minimumDueMinor(card, 0, 0, 0)).toBe(0);
  });

  it('counts fees in a card minimum (V13)', () => {
    // S 139689; 1% 1397; + interest 2343 + fee 9500 = 13240 → $133.
    expect(minimumDueMinor(card, 139_689, 2_343, 9_500)).toBe(13_300);
  });

  it('a percentage of the balance, with its own floor (V4, V8)', () => {
    const store = { kind: 'percentOfBalance', percent: 3, floorMinor: 3_000 } as const;
    expect(minimumDueMinor(store, 306_248, 6_248, 0)).toBe(9_200);
    // 3% of 61000 is 1830 → $19, under the $30 floor.
    expect(minimumDueMinor(store, 61_000, 1_000, 0)).toBe(3_000);
  });

  it('a set amount, or what is left when that is less', () => {
    expect(minimumDueMinor({ kind: 'fixed', amountMinor: 10_000 }, 300_000, 6_248, 0)).toBe(10_000);
    expect(minimumDueMinor({ kind: 'fixed', amountMinor: 10_000 }, 5_583, 114, 0)).toBe(5_583);
    expect(minimumDueMinor({ kind: 'fixed', amountMinor: 0 }, 120_000, 0, 0)).toBe(0);
  });

  it('interest only is the interest, rounded up to the dollar', () => {
    const interestOnly = { kind: 'percentPlusInterest', percent: 0, floorMinor: 0 } as const;
    expect(isInterestOnly(interestOnly)).toBe(true);
    expect(isInterestOnly(card)).toBe(false);
    expect(minimumDueMinor(interestOnly, 1_004_992, 24_992, 0)).toBe(25_000);
  });
});

describe('installmentPaymentMinor', () => {
  it('rounds up to the cent, so the scheduled count finishes the loan (V5)', () => {
    // The formula gives 39508.1047.
    expect(installmentPaymentMinor(2_000_000, 6.9, 60)).toBe(39_509);
    expect(installmentPaymentMinor(500_000, 11.99, 36)).toBe(16_605);
    expect(installmentPaymentMinor(1_000_000, 29.99, 36)).toBe(42_447);
  });

  it('divides evenly, rounding up, at 0%', () => {
    expect(installmentPaymentMinor(120_000, 0, 12)).toBe(10_000);
    expect(installmentPaymentMinor(125_000, 0, 12)).toBe(10_417);
  });

  it('never divides by zero months', () => {
    expect(installmentPaymentMinor(50_000, 0, 0)).toBe(50_000);
  });
});

describe('one month on one debt', () => {
  it('starts every piece where the typed balance says', () => {
    expect(startingParts(debt())).toEqual({ standardMinor: 200_000, promoMinor: 0, promoOn: false, shadowMinor: 0 });
    const transfer = debt({
      balanceMinor: 500_000,
      promo: { aprPercent: 0, endsOn: '2027-06-30', deferred: false, balanceMinor: 400_000 },
    });
    expect(startingParts(transfer)).toEqual({ standardMinor: 100_000, promoMinor: 400_000, promoOn: true, shadowMinor: 0 });
  });

  it('ignores a promo that ended before the balance was typed (V16)', () => {
    const ended = debt({
      balanceAsOf: '2026-09-01',
      promo: { aprPercent: 0, endsOn: '2026-08-31', deferred: true, heldBackMinor: 5_000 },
    });
    expect(startingParts(ended).promoOn).toBe(false);
    expect(accrue(ended, startingParts(ended), '2026-10-05').chargedBackMinor).toBe(0);
  });

  it('never lets the promo piece be more than the balance', () => {
    const odd = debt({ balanceMinor: 1_000, promo: { aprPercent: 0, endsOn: '2027-01-01', deferred: false, balanceMinor: 5_000 } });
    expect(startingParts(odd)).toMatchObject({ standardMinor: 0, promoMinor: 1_000 });
  });

  it('holds back the full-rate interest on a deferred promo, and adds it back if a balance is left (V3)', () => {
    const store = debt({
      name: 'Store card',
      balanceMinor: 120_000,
      aprPercent: 29.99,
      promo: { aprPercent: 0, endsOn: '2027-03-05', deferred: true, heldBackMinor: 12_000 },
    });
    const month = accrue(store, startingParts(store), '2026-10-05');
    expect(month.interestMinor).toBe(0);
    expect(month.parts.shadowMinor).toBe(2_999);
    // After the promo date, whatever is left brings all of it with it.
    const later = accrue(store, { standardMinor: 0, promoMinor: 102_000, promoOn: true, shadowMinor: 16_869 }, '2027-04-05');
    expect(later.chargedBackMinor).toBe(28_869);
    expect(later.interestMinor).toBe(3_271);
    expect(later.statementMinor).toBe(102_000 + 28_869 + 3_271);
  });

  it('leaves the pieces it is given alone', () => {
    const parts = { standardMinor: 100, promoMinor: 0, promoOn: false, shadowMinor: 0 };
    accrue(debt(), parts, '2026-10-05');
    expect(parts).toEqual({ standardMinor: 100, promoMinor: 0, promoOn: false, shadowMinor: 0 });
  });

  it('charges a monthly fee every month, and a yearly one in its month', () => {
    const monthly = debt({ fee: { amountMinor: 500, every: 'month' } });
    expect(feeDueMinor(monthly, '2026-10-05')).toBe(500);
    const yearly = debt({ fee: { amountMinor: 9_500, every: 'year', month: 1 } });
    expect(feeDueMinor(yearly, '2027-01-12')).toBe(9_500);
    expect(feeDueMinor(yearly, '2027-02-12')).toBe(0);
    // A yearly fee with no month can't be placed, so it is not guessed.
    expect(feeDueMinor(debt({ fee: { amountMinor: 9_500, every: 'year' } }), '2027-01-12')).toBe(0);
  });

  it('prefills "Balance now?" with the plan\'s own month (V16)', () => {
    // 200000 + 4165 interest − 6300 paid.
    expect(balanceAfterPaymentMinor(debt(), '2026-10-05', 6_300)).toBe(197_865);
    expect(balanceAfterPaymentMinor(debt(), '2026-10-05', 999_999)).toBe(0);
  });
});

describe('due dates', () => {
  it('starts at the first due date on or after today', () => {
    expect(dueDatesFrom(debt({ dueDay: 5 }), FROM, 3)).toEqual(['2026-10-05', '2026-11-05', '2026-12-05']);
    expect(dueDatesFrom(debt({ dueDay: 24 }), FROM, 1)).toEqual(['2026-09-24']);
    expect(nextDueOn(debt({ dueDay: 28 }), FROM)).toBe('2026-09-28');
  });

  it('starts after a payment marked paid (V16)', () => {
    expect(nextDueOn(debt({ dueDay: 5, paidThrough: '2026-10-05' }), FROM)).toBe('2026-11-05');
    // A mark from before today changes nothing.
    expect(nextDueOn(debt({ dueDay: 28, paidThrough: '2026-08-28' }), FROM)).toBe('2026-09-28');
  });

  it('keeps the 31st: the last day of short months, and the 31st again after', () => {
    expect(dueDatesFrom(debt({ dueDay: 31 }), '2027-01-01', 4)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
  });

  it('steps every 2 weeks from the next date typed', () => {
    const bnpl = debt({ cadence: 'every2weeks', dueDay: undefined, nextDueOn: '2026-09-10' });
    // Sep 10 + 14 days is today, which still counts.
    expect(dueDatesFrom(bnpl, FROM, 3)).toEqual(['2026-09-24', '2026-10-08', '2026-10-22']);
    expect(dueDatesFrom(bnpl, '2026-09-25', 1)).toEqual(['2026-10-08']);
    const later = debt({ cadence: 'every2weeks', dueDay: undefined, nextDueOn: '2026-10-01' });
    expect(nextDueOn(later, FROM)).toBe('2026-10-01');
    expect(dueDatesInWindow(later, FROM, '2026-10-23')).toEqual(['2026-10-01', '2026-10-15']);
  });

  it('finds every date in a window, after anything marked paid', () => {
    expect(dueDatesInWindow(debt({ dueDay: 5 }), '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-05',
      '2026-11-05',
      '2026-12-05',
    ]);
    expect(dueDatesInWindow(debt({ dueDay: 5, paidThrough: '2026-10-05' }), '2026-10-01', '2026-11-30')).toEqual([
      '2026-11-05',
    ]);
    expect(dueDatesInWindow(debt(), '2026-10-10', '2026-10-01')).toEqual([]);
  });

  it('has no dates without a schedule, rather than guessing one', () => {
    expect(hasSchedule(debt({ dueDay: undefined }))).toBe(false);
    expect(hasSchedule(debt({ cadence: 'every2weeks', nextDueOn: undefined }))).toBe(false);
    expect(nextDueOn(debt({ dueDay: undefined }), FROM)).toBeNull();
  });
});

describe('loan terms', () => {
  it('knows when a loan was scheduled to finish (V16)', () => {
    const car = debt({ kind: 'autoLoan', loan: { firstPaymentOn: '2021-06-10', termMonths: 60 } });
    expect(scheduledEndOn(car)).toBe('2026-05-10');
    expect(isPastTerm(car, FROM)).toBe(true);
    expect(isPastTerm({ ...car, balanceMinor: 0 }, FROM)).toBe(false);
    expect(isPastTerm({ ...car, loan: { firstPaymentOn: '2023-06-10', termMonths: 60 } }, FROM)).toBe(false);
  });

  it('says nothing without both dates', () => {
    expect(scheduledEndOn(debt({ loan: { termMonths: 60 } }))).toBeNull();
    expect(scheduledEndOn(debt())).toBeNull();
  });
});

describe('which debts are planned', () => {
  it('plans a debt with a balance, a due date and the plan currency', () => {
    expect(isPlanned(debt(), 'USD')).toBe(true);
    expect(notPlannedReason(debt(), 'USD')).toBeNull();
  });

  it('says why, when one is not', () => {
    expect(notPlannedReason(debt({ paidOffOn: '2026-09-01' }), 'USD')).toBe('paidOff');
    // A zero balance is offered a move to Paid off; nothing moves it by itself.
    expect(notPlannedReason(debt({ balanceMinor: 0 }), 'USD')).toBe('zeroBalance');
    expect(notPlannedReason(debt({ currency: 'EUR' }), 'USD')).toBe('otherCurrency');
    expect(notPlannedReason(debt({ dueDay: undefined }), 'USD')).toBe('noSchedule');
  });

  it('calls a balance older than 35 days stale', () => {
    expect(isStale(debt({ balanceAsOf: '2026-08-20' }), FROM)).toBe(false);
    expect(isStale(debt({ balanceAsOf: '2026-08-19' }), FROM)).toBe(true);
  });
});

describe('kinds and presets', () => {
  it('labels every kind', () => {
    for (const kind of DEBT_KINDS) expect(DEBT_KIND_LABELS[kind]).toBeTruthy();
    expect(Object.keys(DEBT_KIND_PRESETS).sort()).toEqual([...DEBT_KINDS].sort());
  });

  it('fills in the usual minimum and schedule for a kind', () => {
    const bnpl = applyKindPreset(debt({ aprPercent: undefined }), 'bnpl');
    expect(bnpl.kind).toBe('bnpl');
    expect(bnpl.cadence).toBe('every2weeks');
    expect(bnpl.aprPercent).toBe(0);
    expect(bnpl.minimum).toEqual({ kind: 'fixed', amountMinor: 0 });
    const heloc = applyKindPreset(debt(), 'lineOfCredit');
    expect(isInterestOnly(heloc.minimum)).toBe(true);
    expect('cadence' in heloc).toBe(false);
    expect(DEBT_KIND_PRESETS.storeCard.promoDeferred).toBe(true);
  });

  it('keeps a rate already typed, and a set amount across fixed-payment kinds', () => {
    expect(applyKindPreset(debt({ aprPercent: 12 }), 'medical').aprPercent).toBe(12);
    expect(applyKindPreset(debt({ aprPercent: undefined }), 'creditCard').aprPercent).toBeUndefined();
    const loan = debt({ minimum: { kind: 'fixed', amountMinor: 39_509 } });
    expect(applyKindPreset(loan, 'autoLoan').minimum).toEqual({ kind: 'fixed', amountMinor: 39_509 });
  });

  it('never changes the debt it is given', () => {
    const before = debt();
    applyKindPreset(before, 'bnpl');
    expect(before.kind).toBe('creditCard');
    expect(before.cadence).toBeUndefined();
  });
});

describe('parsePercent', () => {
  it('reads a rate however it is typed', () => {
    expect(parsePercent('24.99')).toBe(24.99);
    expect(parsePercent('24.99%')).toBe(24.99);
    expect(parsePercent(' 24.99 ')).toBe(24.99);
    expect(parsePercent('24.99 %')).toBe(24.99);
    expect(parsePercent('0')).toBe(0);
    expect(parsePercent('.5')).toBe(0.5);
    expect(parsePercent('7.')).toBe(7);
  });

  it('rounds to two decimals, as a statement prints it', () => {
    expect(parsePercent('24.999')).toBe(25);
    expect(parsePercent('7.125')).toBe(7.13);
  });

  it("says so when it isn't a rate", () => {
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
    expect(parsePercent('-5')).toBeNull();
    expect(parsePercent('24.9.9')).toBeNull();
    expect(parsePercent('%')).toBeNull();
  });
});
