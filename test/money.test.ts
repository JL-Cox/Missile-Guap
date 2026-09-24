import { describe, expect, it } from 'vitest';
import {
  isActive,
  isOngoing,
  byCategoryYearly,
  deductionsByLabel,
  formatDeduction,
  formatMoney,
  grossYearlyMinor,
  itemisedDeductionsMinor,
  leftoverMonthlyMinor,
  monthlyMinor,
  netMonthlyMinor,
  netYearlyMinor,
  parseMoney,
  totalGrossYearlyMinor,
  totalMonthlyMinor,
  totalNetMonthlyMinor,
  totalYearlyMinor,
  unitemisedMinor,
  yearlyMinor,
} from '../src/lib/money';
import type { IncomeSource, Subscription } from '../src/types';

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Test',
    amountMinor: 1000,
    currency: 'GBP',
    cycle: 'monthly',
    every: 1,
    firstBilled: '2026-01-15',
    notes: '',
    cancelHow: '',
    remindDaysBefore: 3,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('normalising a cost to a year', () => {
  it('handles each cycle', () => {
    expect(yearlyMinor(sub({ amountMinor: 1000, cycle: 'monthly' }))).toBe(12_000);
    expect(yearlyMinor(sub({ amountMinor: 1000, cycle: 'weekly' }))).toBe(52_000);
    expect(yearlyMinor(sub({ amountMinor: 1000, cycle: 'quarterly' }))).toBe(4_000);
    expect(yearlyMinor(sub({ amountMinor: 1000, cycle: 'yearly' }))).toBe(1_000);
  });

  it('divides by "every N"', () => {
    expect(yearlyMinor(sub({ amountMinor: 1200, cycle: 'monthly', every: 2 }))).toBe(7_200);
    expect(yearlyMinor(sub({ amountMinor: 500, cycle: 'weekly', every: 2 }))).toBe(13_000);
  });

  it('gives a monthly average from the yearly figure', () => {
    expect(monthlyMinor(sub({ amountMinor: 1000, cycle: 'weekly' }))).toBe(4_333);
    expect(monthlyMinor(sub({ amountMinor: 6000, cycle: 'yearly' }))).toBe(500);
  });
});

describe('totals', () => {
  const subs = [
    sub({ amountMinor: 999, cycle: 'monthly' }),
    sub({ amountMinor: 8999, cycle: 'yearly' }),
    sub({ amountMinor: 500, cycle: 'weekly' }),
  ];

  it('adds up active subscriptions', () => {
    expect(totalYearlyMinor(subs)).toBe(999 * 12 + 8999 + 500 * 52);
    expect(totalMonthlyMinor(subs)).toBe(Math.round(totalYearlyMinor(subs) / 12));
  });

  it('leaves cancelled ones out of the totals', () => {
    const withCancelled = [...subs, sub({ amountMinor: 50_000, cycle: 'monthly', endedOn: '2026-01-01' })];
    expect(totalYearlyMinor(withCancelled)).toBe(totalYearlyMinor(subs));
  });
});

describe('category breakdown', () => {
  it('groups and sorts by yearly cost, biggest first', () => {
    const result = byCategoryYearly([
      sub({ amountMinor: 1000, category: 'Fun' }),
      sub({ amountMinor: 2000, category: 'Bills' }),
      sub({ amountMinor: 500, category: 'Fun' }),
      sub({ amountMinor: 300 }),
    ]);
    expect(result).toEqual([
      { category: 'Bills', minor: 24_000 },
      { category: 'Fun', minor: 18_000 },
      { category: 'Uncategorized', minor: 3_600 },
    ]);
  });
});

describe('parseMoney', () => {
  it('reads the ways people actually type amounts', () => {
    expect(parseMoney('12.99')).toBe(1299);
    expect(parseMoney('£12.99')).toBe(1299);
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('12,99')).toBe(1299);   // comma as decimal separator
    expect(parseMoney('1,299.00')).toBe(129_900); // comma as thousands separator
    expect(parseMoney(' 7.50 ')).toBe(750);
  });

  it('rejects things that are not amounts rather than guessing', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('about a tenner')).toBeNull();
  });

  it('never produces a floating-point cent', () => {
    expect(Number.isInteger(parseMoney('0.1')!)).toBe(true);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('19.99')).toBe(1999);
  });
});

describe('formatMoney', () => {
  it('falls back gracefully on a currency code it does not know', () => {
    expect(formatMoney(1299, 'NOTACURRENCY')).toContain('12.99');
  });
});


describe('every-2-weeks subscriptions', () => {
  // 26 charges a year, not 24. Treating a fortnightly bill as twice-monthly
  // understates the yearly cost by two whole payments, which is exactly the
  // kind of quietly wrong number this app exists to avoid.
  const fortnightly = sub({ amountMinor: 1500, cycle: 'weekly', every: 2 });

  it('counts 26 charges a year', () => {
    expect(yearlyMinor(fortnightly)).toBe(1500 * 26);
  });

  it('averages that over twelve months', () => {
    expect(monthlyMinor(fortnightly)).toBe(Math.round((1500 * 26) / 12));
  });

  it('costs more per year than the same amount billed monthly', () => {
    expect(yearlyMinor(fortnightly)).toBeGreaterThan(yearlyMinor(sub({ amountMinor: 1500, cycle: 'monthly' })));
  });

  it('adds into the totals like any other rhythm', () => {
    expect(totalYearlyMinor([fortnightly])).toBe(1500 * 26);
  });
});


describe('twice-a-month subscriptions', () => {
  // The other half of the same distinction: 24 charges a year, on set dates.
  const twice = sub({ amountMinor: 1500, cycle: 'semimonthly', every: 1, daysOfMonth: [1, 15] });

  it('counts 24 charges a year', () => {
    expect(yearlyMinor(twice)).toBe(1500 * 24);
  });

  it('costs two charges a year less than the same amount every 2 weeks', () => {
    const fortnightly = sub({ amountMinor: 1500, cycle: 'weekly', every: 2 });
    expect(yearlyMinor(fortnightly) - yearlyMinor(twice)).toBe(1500 * 2);
  });

  it('works out at exactly twice the monthly amount', () => {
    expect(monthlyMinor(twice)).toBe(1500 * 2);
  });

  it('ignores a stale "every 2" rather than halving the cost', () => {
    // Switching from every-2-months to twice-a-month can leave every: 2 behind.
    // Dividing by it would report half the money while the dates stayed put.
    expect(yearlyMinor(sub({ ...twice, every: 2 }))).toBe(1500 * 24);
  });

  it('adds into the totals like any other rhythm', () => {
    expect(totalYearlyMinor([twice])).toBe(1500 * 24);
    expect(totalMonthlyMinor([twice])).toBe(1500 * 2);
  });
});


function income(partial: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Main job',
    frequency: 'semimonthly',
    daysOfMonth: [15, 31],
    grossMinor: 250_000,   // $2,500.00
    netMinor: 185_000,     // $1,850.00
    deductions: [],
    currency: 'USD',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('annualising a paystub', () => {
  it('multiplies by the right number of paycheques', () => {
    expect(grossYearlyMinor(income({ frequency: 'semimonthly' }))).toBe(250_000 * 24);
    expect(grossYearlyMinor(income({ frequency: 'biweekly' }))).toBe(250_000 * 26);
    expect(grossYearlyMinor(income({ frequency: 'weekly' }))).toBe(250_000 * 52);
    expect(grossYearlyMinor(income({ frequency: 'monthly' }))).toBe(250_000 * 12);
  });

  it('keeps twice-a-month and every-2-weeks apart', () => {
    // Two whole paycheques of difference on the same stub.
    const twice = netYearlyMinor(income({ frequency: 'semimonthly' }));
    const fortnightly = netYearlyMinor(income({ frequency: 'biweekly' }));
    expect(fortnightly - twice).toBe(185_000 * 2);
  });

  it('gives take-home a month', () => {
    expect(netMonthlyMinor(income())).toBe(Math.round((185_000 * 24) / 12));
    expect(netMonthlyMinor(income())).toBe(370_000);
  });
});

describe('deductions', () => {
  const withLines = income({
    deductions: [
      { id: 'a', label: 'Federal income tax', amountMinor: 32_000 },
      { id: 'b', label: 'Social Security', amountMinor: 15_500 },
      { id: 'c', label: 'Medicare', amountMinor: 3_600 },
    ],
  });

  it('adds up the lines you wrote down', () => {
    expect(itemisedDeductionsMinor(withLines)).toBe(32_000 + 15_500 + 3_600);
  });

  it('reports the rest as not itemised rather than complaining', () => {
    // Gross - net is 65,000; the lines cover 51,100.
    expect(unitemisedMinor(withLines)).toBe(65_000 - 51_100);
  });

  it('is zero when the lines add up exactly', () => {
    const exact = income({ deductions: [{ id: 'a', label: 'All of it', amountMinor: 65_000 }] });
    expect(unitemisedMinor(exact)).toBe(0);
  });

  it('never goes negative when you write down more than the gap', () => {
    // A typo should not produce a negative deduction that corrupts the totals.
    const over = income({ deductions: [{ id: 'a', label: 'Oops', amountMinor: 999_999 }] });
    expect(unitemisedMinor(over)).toBe(0);
  });

  it('groups by label across sources, biggest first, and annualises', () => {
    const rows = deductionsByLabel([withLines]);
    expect(rows[0]).toEqual({ label: 'Federal income tax', minor: 32_000 * 24 });
    expect(rows.map((r) => r.label)).toContain('Not itemized');
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].minor).toBeGreaterThanOrEqual(rows[i].minor);
  });

  it('leaves ended jobs out of the totals', () => {
    const ended = income({ endedOn: '2026-01-01' });
    expect(totalNetMonthlyMinor([income(), ended])).toBe(netMonthlyMinor(income()));
    expect(totalGrossYearlyMinor([income(), ended])).toBe(grossYearlyMinor(income()));
  });
});

describe('income against expenses', () => {
  it('is take-home minus the subscriptions', () => {
    const subs = [sub({ amountMinor: 1_299, cycle: 'monthly' })];
    expect(leftoverMonthlyMinor([income()], subs)).toBe(370_000 - totalMonthlyMinor(subs));
  });

  it('can go negative, and says so rather than clamping', () => {
    // Being told you are over is the entire point; hiding it would be a lie.
    const expensive = [sub({ amountMinor: 500_000, cycle: 'monthly' })];
    expect(leftoverMonthlyMinor([income()], expensive)).toBeLessThan(0);
  });

  it('is just the negative of expenses when there is no income yet', () => {
    const subs = [sub({ amountMinor: 1_000, cycle: 'monthly' })];
    expect(leftoverMonthlyMinor([], subs)).toBe(-totalMonthlyMinor(subs));
  });

  it("takes the debt plan's monthly amount out too, and is unchanged without one", () => {
    const subs = [sub({ amountMinor: 1_299, cycle: 'monthly' })];
    expect(leftoverMonthlyMinor([income()], subs, 43_333)).toBe(370_000 - totalMonthlyMinor(subs) - 43_333);
    expect(leftoverMonthlyMinor([income()], subs, 0)).toBe(leftoverMonthlyMinor([income()], subs));
  });
});


describe('isActive and isOngoing', () => {
  it('counts a subscription as able to charge up to and including its end date', () => {
    expect(isActive(sub({ endedOn: '2026-09-23' }), '2026-09-23')).toBe(true);
    expect(isActive(sub({ endedOn: '2026-09-23' }), '2026-09-24')).toBe(false);
    expect(isActive(sub(), '2030-01-01')).toBe(true);
  });

  // Averages are about what a subscription costs from here on, and a
  // cancelled one costs nothing from here on.
  it('leaves anything marked cancelled out of the monthly and yearly averages', () => {
    expect(isOngoing(sub({ endedOn: '2026-09-23' }))).toBe(false);
    expect(totalMonthlyMinor([sub({ amountMinor: 1_000 }), sub({ amountMinor: 1_000, endedOn: '2099-01-01' })])).toBe(1_000);
  });
});

describe('signs on money', () => {
  it('writes a negative with a true minus sign, not a hyphen', () => {
    expect(formatMoney(-4799, 'USD')).toBe('−$47.99');
    expect(formatMoney(-4799, 'USD')).not.toContain('-');
  });

  it('leaves positives alone', () => {
    expect(formatMoney(185000, 'USD')).toBe('$1,850.00');
  });

  it('writes an amount being taken away with the same minus, and no space', () => {
    expect(formatDeduction(3000, 'USD')).toBe('−$30.00');
    // Already negative or positive, it is the size that is being taken away.
    expect(formatDeduction(-3000, 'USD')).toBe('−$30.00');
  });

  it('does not put a minus in front of nothing', () => {
    expect(formatDeduction(0, 'USD')).toBe('$0.00');
  });

  it('keeps the minus when the currency is unknown', () => {
    expect(formatMoney(-1299, 'NOTACURRENCY')).toBe('−12.99 NOTACURRENCY');
  });
});
