import { describe, expect, it } from 'vitest';
import { paycheckNow } from '../src/lib/paycheck';
import { isChargeGone, isChargePaid, PAID_KEPT_DAYS, withChargePaid } from '../src/lib/paid';
import { addDays } from '../src/lib/time';
import type { IncomeSource, Subscription } from '../src/types';

/**
 * The one place Home, Today, Money and the Debt page get "still to come out"
 * and "left" from. These hold it to the rules each of those screens used to
 * work out on its own, plus the new one: a charge marked paid stops counting
 * the moment it is marked, not at midnight.
 */

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Netflix',
    amountMinor: 1_299,
    currency: 'USD',
    cycle: 'monthly',
    every: 1,
    firstBilled: '2026-01-10',
    notes: '',
    cancelHow: '',
    remindDaysBefore: 3,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function income(partial: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: 'job',
    name: 'Main job',
    frequency: 'semimonthly',
    daysOfMonth: [15, 31],
    weekendShift: 'none',
    holidays: [],
    grossMinor: 250_000,
    netMinor: 185_000,
    deductions: [],
    currency: 'USD',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const NO_DEBT = { checks: [], payments: [] };
const now = (incomes: IncomeSource[], subs: Subscription[], today: string) =>
  paycheckNow({ incomes, subs, debtView: NO_DEBT, today });

describe('still to come out', () => {
  const job = income({ daysOfMonth: [15, 31] });
  const later = sub({ name: 'Gym', firstBilled: '2026-09-25', amountMinor: 3_500 });
  const earlier = sub({ name: 'Netflix', firstBilled: '2026-09-18', amountMinor: 1_299 });

  it('adds up what is left in the calendar month', () => {
    const { month } = now([job], [earlier, later], '2026-09-17');
    expect(month).toEqual({ minor: 1_299 + 3_500, count: 2, paymentCount: 0, until: '2026-09-30' });
  });

  it('leaves out a charge whose day has passed', () => {
    const past = sub({ firstBilled: '2026-09-10', cycle: 'yearly' });
    expect(now([job], [past], '2026-09-17').month.minor).toBe(0);
  });

  it('keeps a charge landing today until it is marked paid', () => {
    const rent = sub({ name: 'Rent', firstBilled: '2026-09-17', cycle: 'yearly', amountMinor: 120_000 });
    expect(now([job], [rent], '2026-09-17').stillToCome?.minor).toBe(120_000);
    const paid = withChargePaid(rent, '2026-09-17', true, '2026-09-17');
    expect(now([job], [paid], '2026-09-17').stillToCome?.minor).toBe(0);
    expect(now([job], [paid], '2026-09-17').month.minor).toBe(0);
  });

  it('counts only up to the next payday for this paycheck', () => {
    const { stillToCome } = now([job], [earlier, later], '2026-09-17');
    expect(stillToCome?.until).toBe('2026-09-29');
    expect(stillToCome?.minor).toBe(1_299 + 3_500);
  });

  it('gives a smaller paycheck figure than month figure when a bill falls after payday', () => {
    const afterPayday = sub({ name: 'Insurance', firstBilled: '2026-09-30', amountMinor: 8_000 });
    const n = now([job], [earlier, afterPayday], '2026-09-17');
    expect(n.month.minor).toBe(1_299 + 8_000);
    expect(n.stillToCome?.minor).toBe(1_299);
  });

  it('reports no paycheck rather than a guessed one when income is unknown', () => {
    const n = now([], [earlier], '2026-09-17');
    expect(n.period).toBeNull();
    expect(n.stillToCome).toBeNull();
    expect(n.leftAfterMinor).toBeNull();
    expect(n.noPeriod?.kind).toBe('noIncome');
    expect(n.month.minor).toBe(1_299);
  });

  it('reports zero, not nothing, when everything is paid for', () => {
    const n = now([job], [], '2026-09-17');
    expect(n.month).toEqual({ minor: 0, count: 0, paymentCount: 0, until: '2026-09-30' });
    expect(n.stillToCome?.minor).toBe(0);
  });

  it('counts a charge marked paid early as gone, before its day', () => {
    const paidEarly = withChargePaid(later, '2026-09-25', true, '2026-09-17');
    const n = now([job], [earlier, paidEarly], '2026-09-17');
    expect(n.stillToCome?.minor).toBe(1_299);
    expect(n.goneOutMinor).toBe(3_500);
  });
});

describe('this paycheck adds up', () => {
  const job = income({ daysOfMonth: [15, 31] });
  // Period 15-29 Sep. One charge before today, one today, one later.
  const before = sub({ name: 'Phone', firstBilled: '2026-09-16', amountMinor: 4_000 });
  const rent = sub({ name: 'Rent', firstBilled: '2026-09-17', amountMinor: 95_000 });
  const gym = sub({ name: 'Gym', firstBilled: '2026-09-25', amountMinor: 3_500 });

  it('take-home less gone out less still to come out is what is left', () => {
    for (const subs of [[before, rent, gym], [before, withChargePaid(rent, '2026-09-17', true, '2026-09-17'), gym]]) {
      const n = now([job], subs, '2026-09-17');
      expect(n.incomeMinor - n.goneOutMinor - n.stillToCome!.minor - n.setAsideMinor).toBe(n.leftAfterMinor);
    }
  });

  it('marking a charge paid moves it from still to come to gone, and leaves "left" alone', () => {
    const open = now([job], [before, rent, gym], '2026-09-17');
    const marked = now([job], [before, withChargePaid(rent, '2026-09-17', true, '2026-09-17'), gym], '2026-09-17');
    expect(open.goneOutMinor).toBe(4_000);
    expect(open.stillToCome?.minor).toBe(95_000 + 3_500);
    expect(marked.goneOutMinor).toBe(4_000 + 95_000);
    expect(marked.stillToCome?.minor).toBe(3_500);
    expect(marked.leftAfterMinor).toBe(open.leftAfterMinor);
    expect(open.leftAfterMinor).toBe(185_000 - 4_000 - 95_000 - 3_500);
  });

  it('lists every charge in the period, saying which have gone', () => {
    const n = now([job], [before, withChargePaid(rent, '2026-09-17', true, '2026-09-17'), gym], '2026-09-17');
    expect(n.charges.map((c) => `${c.sub.name} ${c.date} ${c.paid ? 'paid' : c.gone ? 'gone' : 'due'}`)).toEqual([
      'Phone 2026-09-16 gone',
      'Rent 2026-09-17 paid',
      'Gym 2026-09-25 due',
    ]);
  });

  it('names the next thing to go, skipping one marked paid', () => {
    expect(now([job], [before, rent, gym], '2026-09-17').next).toMatchObject({ title: 'Rent', date: '2026-09-17' });
    const marked = now([job], [before, withChargePaid(rent, '2026-09-17', true, '2026-09-17'), gym], '2026-09-17');
    expect(marked.next).toMatchObject({ title: 'Gym', date: '2026-09-25' });
  });
});

describe('paid marks', () => {
  const rent = sub({ name: 'Rent', firstBilled: '2026-09-17' });

  it('marks one charge, by its date, and takes the mark off again', () => {
    const paid = withChargePaid(rent, '2026-09-17', true, '2026-09-17');
    expect(isChargePaid(paid, '2026-09-17')).toBe(true);
    expect(isChargePaid(paid, '2026-10-17')).toBe(false);
    const unpaid = withChargePaid(paid, '2026-09-17', false, '2026-09-17');
    expect(isChargePaid(unpaid, '2026-09-17')).toBe(false);
    expect('paidDates' in unpaid).toBe(false);
  });

  it('never holds a date twice, and keeps them in order', () => {
    let s = withChargePaid(rent, '2026-10-17', true, '2026-10-17');
    s = withChargePaid(s, '2026-09-17', true, '2026-10-17');
    s = withChargePaid(s, '2026-10-17', true, '2026-10-17');
    expect(s.paidDates).toEqual(['2026-09-17', '2026-10-17']);
  });

  it(`drops marks more than ${PAID_KEPT_DAYS} days old`, () => {
    const old = { ...rent, paidDates: ['2026-01-17', '2026-08-17'] };
    const s = withChargePaid(old, '2026-09-17', true, '2026-09-17');
    expect(s.paidDates).toEqual(['2026-08-17', '2026-09-17']);
    expect(addDays('2026-09-17', -PAID_KEPT_DAYS) > '2026-01-17').toBe(true);
  });

  it('leaves the subscription it was given alone', () => {
    const before = JSON.stringify(rent);
    withChargePaid(rent, '2026-09-17', true, '2026-09-17');
    expect(JSON.stringify(rent)).toBe(before);
  });

  it('a charge today is not gone until marked; one yesterday is', () => {
    expect(isChargeGone(rent, '2026-09-17', '2026-09-17')).toBe(false);
    expect(isChargeGone(rent, '2026-09-16', '2026-09-17')).toBe(true);
  });

  it('ignores a damaged list from a hand-edited backup', () => {
    const odd = { ...rent, paidDates: 'yesterday' as unknown as string[] };
    expect(isChargePaid(odd, '2026-09-17')).toBe(false);
    expect(withChargePaid(odd, '2026-09-17', true, '2026-09-17').paidDates).toEqual(['2026-09-17']);
  });
});
