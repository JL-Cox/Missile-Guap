import { describe, expect, it } from 'vitest';
import { byCategoryYearly, formatMoney, monthlyMinor, parseMoney, totalMonthlyMinor, totalYearlyMinor, yearlyMinor } from '../src/lib/money';
import type { Subscription } from '../src/types';

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
      { category: 'Uncategorised', minor: 3_600 },
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
