import { describe, expect, it } from 'vitest';
import {
  allPaydays,
  billsBetween,
  billsTotalMinor,
  currentPayPeriod,
  endOfMonth,
  outlook,
  payPeriods,
  stillToCome,
  paydaysFrom,
  whyNoPayPeriod,
} from '../src/lib/cashflow';
import type { IncomeSource, Subscription } from '../src/types';

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
    id: Math.random().toString(36).slice(2),
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

describe('endOfMonth', () => {
  it('finds the last day, including the awkward months', () => {
    expect(endOfMonth('2026-09-17')).toBe('2026-09-30');
    expect(endOfMonth('2026-02-01')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-14')).toBe('2028-02-29');
    expect(endOfMonth('2026-12-25')).toBe('2026-12-31');
  });

  it('is stable when called on the last day itself', () => {
    expect(endOfMonth('2026-09-30')).toBe('2026-09-30');
  });
});

describe('billsBetween', () => {
  const netflix = sub({ name: 'Netflix', firstBilled: '2026-09-10', amountMinor: 1_299 });
  const gym = sub({ name: 'Gym', firstBilled: '2026-09-20', amountMinor: 3_500 });

  it('includes both ends of the window', () => {
    expect(billsBetween([netflix], '2026-09-10', '2026-09-10')).toHaveLength(1);
    expect(billsBetween([netflix], '2026-09-11', '2026-09-30')).toHaveLength(0);
  });

  it('puts the soonest first and adds up', () => {
    const bills = billsBetween([gym, netflix], '2026-09-01', '2026-09-30');
    expect(bills.map((b) => b.sub.name)).toEqual(['Netflix', 'Gym']);
    expect(billsTotalMinor(bills)).toBe(1_299 + 3_500);
  });

  it('leaves out a cancelled subscription', () => {
    const cancelled = sub({ firstBilled: '2026-09-10', endedOn: '2026-08-01' });
    expect(billsBetween([cancelled], '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('counts a twice-a-month subscription twice', () => {
    const twice = sub({ cycle: 'semimonthly', daysOfMonth: [1, 15], firstBilled: '2026-09-01', amountMinor: 1_000 });
    expect(billsTotalMinor(billsBetween([twice], '2026-09-01', '2026-09-30'))).toBe(2_000);
  });

  it('is empty rather than throwing when there is nothing to bill', () => {
    expect(billsBetween([], '2026-09-01', '2026-09-30')).toEqual([]);
    expect(billsTotalMinor([])).toBe(0);
  });
});

describe('allPaydays', () => {
  it('merges two jobs paid on the same day into one payday', () => {
    // Two cheques landing together is one moment when the balance changes, and
    // the money has to be added up or a period is funded by half its income.
    const a = income({ name: 'Day job', daysOfMonth: [15], frequency: 'monthly', netMinor: 100_000 });
    const b = income({ name: 'Side work', daysOfMonth: [15], frequency: 'monthly', netMinor: 40_000 });
    const days = allPaydays([a, b], '2026-09-01', '2026-09-30');
    expect(days).toHaveLength(1);
    expect(days[0].incomeMinor).toBe(140_000);
    expect(days[0].paidBy.map((s) => s.name).sort()).toEqual(['Day job', 'Side work']);
  });

  it('keeps separate days separate and in order', () => {
    const a = income({ daysOfMonth: [1], frequency: 'monthly', netMinor: 100_000 });
    const b = income({ daysOfMonth: [20], frequency: 'monthly', netMinor: 40_000 });
    expect(allPaydays([a, b], '2026-09-01', '2026-09-30').map((p) => p.date)).toEqual([
      '2026-09-01',
      '2026-09-20',
    ]);
  });

  it('ignores a job that has ended', () => {
    expect(allPaydays([income({ endedOn: '2026-01-01' })], '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('respects the weekend shift, so a period never ends on a day nobody is paid', () => {
    // 15 Nov 2026 is a Sunday; paid the Friday before.
    const friday = income({ daysOfMonth: [15], frequency: 'monthly', weekendShift: 'friday' });
    expect(allPaydays([friday], '2026-11-01', '2026-11-30')[0].date).toBe('2026-11-13');
  });
});

describe('payPeriods', () => {
  const job = income({ daysOfMonth: [15, 31], netMinor: 185_000 });

  it('starts with the period you are standing in, not the next one', () => {
    // The 17th is after the 15th, so the current period opened on the 15th.
    // Starting at the next payday would answer a question nobody asks.
    const [now] = payPeriods([job], '2026-09-17', 1);
    expect(now.start).toBe('2026-09-15');
    expect(now.end).toBe('2026-09-29');
  });

  it('ends the day before the next payday, so periods never overlap', () => {
    const periods = payPeriods([job], '2026-09-17', 3);
    expect(periods.map((p) => [p.start, p.end])).toEqual([
      ['2026-09-15', '2026-09-29'],
      ['2026-09-30', '2026-10-14'],
      ['2026-10-15', '2026-10-30'],
    ]);
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i].start > periods[i - 1].end).toBe(true);
    }
  });

  it('carries the pay for the day it opens on', () => {
    expect(payPeriods([job], '2026-09-17', 1)[0].incomeMinor).toBe(185_000);
  });

  it('returns nothing at all when no income is recorded', () => {
    // Nothing to guess from. An invented period would be worse than no period.
    expect(payPeriods([], '2026-09-17')).toEqual([]);
  });

  it('returns nothing when the schedule cannot be worked out', () => {
    // An interval job with no anchor date has no derivable paydays.
    expect(payPeriods([income({ frequency: 'biweekly', firstPaid: undefined })], '2026-09-17')).toEqual([]);
  });

  it('handles a fortnightly job, whose periods are exactly 14 days', () => {
    const fortnightly = income({ frequency: 'biweekly', firstPaid: '2026-09-04', daysOfMonth: undefined });
    const periods = payPeriods([fortnightly], '2026-09-17', 3);
    expect(periods[0].start).toBe('2026-09-04');
    for (const p of periods) {
      expect(new Date(`${p.end}T12:00`).getTime() - new Date(`${p.start}T12:00`).getTime()).toBe(
        13 * 86_400_000,
      );
    }
  });

  it('crosses a year boundary without losing a period', () => {
    const periods = payPeriods([job], '2026-12-20', 2);
    expect(periods[0].start).toBe('2026-12-15');
    expect(periods[1].start).toBe('2026-12-31');
    expect(periods[1].end).toBe('2027-01-14');
  });
});

describe('currentPayPeriod', () => {
  const job = income({ daysOfMonth: [15, 31] });

  it('is the period containing today', () => {
    const period = currentPayPeriod([job], '2026-09-20');
    expect(period?.start).toBe('2026-09-15');
  });

  it('is null when no income is recorded', () => {
    expect(currentPayPeriod([], '2026-09-20')).toBeNull();
  });

  it('is null before the first payday has ever happened', () => {
    // A job starting next month has no period you are currently inside.
    const future = income({ frequency: 'biweekly', firstPaid: '2027-01-08', daysOfMonth: undefined });
    expect(currentPayPeriod([future], '2026-09-20')).toBeNull();
  });
});

describe('outlook: what each cheque has to cover', () => {
  const job = income({ daysOfMonth: [15, 31], netMinor: 185_000 });
  // Charged on the 20th, so it lands inside the 15th-29th period.
  const rentish = sub({ name: 'Storage', firstBilled: '2026-09-20', amountMinor: 5_000 });
  const netflix = sub({ name: 'Netflix', firstBilled: '2026-09-16', amountMinor: 1_299 });

  it('subtracts the bills that fall in the period from that cheque', () => {
    const [now] = outlook([job], [rentish, netflix], '2026-09-17', 1);
    expect(now.billsMinor).toBe(5_000 + 1_299);
    expect(now.leftoverMinor).toBe(185_000 - 6_299);
  });

  it('counts every bill in the period for leftover, but only what is ahead for remaining', () => {
    // On the 17th, Netflix on the 16th has already gone out: the cheque still
    // absorbed it, but it is no longer money you are waiting to lose.
    const [now] = outlook([job], [rentish, netflix], '2026-09-17', 1);
    expect(now.billsMinor).toBe(6_299);
    expect(now.remainingMinor).toBe(5_000);
    expect(now.current).toBe(true);
  });

  it('counts the whole period for a cheque that has not arrived yet', () => {
    const periods = outlook([job], [rentish, netflix], '2026-09-17', 3);
    const future = periods[1];
    expect(future.current).toBe(false);
    expect(future.remainingMinor).toBe(future.billsMinor);
  });

  it('can go negative, and says so rather than clamping to zero', () => {
    // A cheque that does not cover its own bills is the single most important
    // thing this screen could tell someone. Hiding it would be a betrayal.
    const expensive = sub({ name: 'Car', firstBilled: '2026-09-20', amountMinor: 250_000 });
    const [now] = outlook([job], [expensive], '2026-09-17', 1);
    expect(now.leftoverMinor).toBeLessThan(0);
    expect(now.leftoverMinor).toBe(185_000 - 250_000);
  });

  it('gives an empty list rather than fake periods when there is no income', () => {
    expect(outlook([], [netflix], '2026-09-17')).toEqual([]);
  });

  it('reports a full cheque when nothing is charged against it', () => {
    const [now] = outlook([job], [], '2026-09-17', 1);
    expect(now.billsMinor).toBe(0);
    expect(now.leftoverMinor).toBe(185_000);
  });

  it('never counts one bill against two cheques', () => {
    const periods = outlook([job], [rentish, netflix], '2026-09-15', 4);
    const ids = periods.flatMap((p) => p.bills.map((b) => `${b.sub.id}@${b.date}`));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('stillToCome', () => {
  const job = income({ daysOfMonth: [15, 31] });
  const later = sub({ name: 'Gym', firstBilled: '2026-09-25', amountMinor: 3_500 });
  const earlier = sub({ name: 'Netflix', firstBilled: '2026-09-18', amountMinor: 1_299 });

  it('adds up what is left in the calendar month', () => {
    const { month } = stillToCome([job], [earlier, later], '2026-09-17');
    expect(month.minor).toBe(1_299 + 3_500);
    expect(month.count).toBe(2);
    expect(month.until).toBe('2026-09-30');
  });

  it('excludes a charge that has already gone out today', () => {
    // Billed on the 10th, today is the 17th: that money is spent, not pending.
    const past = sub({ firstBilled: '2026-09-10', cycle: 'yearly' });
    expect(stillToCome([job], [past], '2026-09-17').month.minor).toBe(0);
  });

  it('includes a charge landing today, because it has not left yet', () => {
    const today = sub({ firstBilled: '2026-09-17', cycle: 'yearly', amountMinor: 999 });
    expect(stillToCome([job], [today], '2026-09-17').month.minor).toBe(999);
  });

  it('counts only up to the next payday for the period figure', () => {
    // The period ends 29 Sep, so the gym on the 25th counts and nothing later would.
    const { period } = stillToCome([job], [earlier, later], '2026-09-17');
    expect(period?.until).toBe('2026-09-29');
    expect(period?.minor).toBe(1_299 + 3_500);
  });

  it('gives a smaller period figure than month figure when a bill falls after payday', () => {
    const afterPayday = sub({ name: 'Insurance', firstBilled: '2026-09-30', amountMinor: 8_000 });
    const { month, period } = stillToCome([job], [earlier, afterPayday], '2026-09-17');
    expect(month.minor).toBe(1_299 + 8_000);
    expect(period?.minor).toBe(1_299);
  });

  it('reports no period rather than a guessed one when income is unknown', () => {
    // "Not itemised" over a plausible wrong number, the same rule the paystub uses.
    const { month, period } = stillToCome([], [earlier], '2026-09-17');
    expect(period).toBeNull();
    expect(month.minor).toBe(1_299);
  });

  it('reports zero, not nothing, when the month is already paid for', () => {
    const { month } = stillToCome([job], [], '2026-09-17');
    expect(month.minor).toBe(0);
    expect(month.count).toBe(0);
  });
});

/*
  "Mark as cancelled" sets the end date to today. The next-charge line still
  showed today's charge - correctly, since a charge on the day you cancel has
  usually already gone - but every total built on real dates dropped the whole
  subscription the moment it had an end date, so the screen said a charge was
  due today and left it out of what was still to come out. They now agree: a
  charge on or before the end date counts.
*/
describe('a charge on the day you cancel', () => {
  const cancelledToday = sub({ firstBilled: '2026-01-23', endedOn: '2026-09-23' });

  it('is still counted in what comes out that day', () => {
    const bills = billsBetween([cancelledToday], '2026-09-23', '2026-09-30');
    expect(bills.map((b) => b.date)).toEqual(['2026-09-23']);
  });

  it('agrees with the next-charge line', async () => {
    const { nextBilling } = await import('../src/lib/recurrence');
    expect(nextBilling(cancelledToday, '2026-09-23')).toBe('2026-09-23');
    expect(stillToCome([], [cancelledToday], '2026-09-23').month.count).toBe(1);
  });

  it('is gone the day after', () => {
    expect(billsBetween([cancelledToday], '2026-09-24', '2026-12-31')).toEqual([]);
  });
});

describe('a job that has ended', () => {
  it('still counts its last payday, on or before the end date', () => {
    const job = income({ endedOn: '2026-09-15' });
    expect(allPaydays([job], '2026-09-01', '2026-10-31').map((p) => p.date)).toEqual(['2026-09-15']);
  });
});

/*
  "Before your next payday" used to say "Add your income above" whenever it
  could not place a payday - including when the income was right there, and
  the only thing missing was a payday to count from.
*/
describe('why there is no pay period', () => {
  const everyTwoWeeks = (firstPaid?: string) =>
    income({ name: 'Main job', frequency: 'biweekly', daysOfMonth: undefined, firstPaid });

  it('asks for income when there is none', () => {
    expect(whyNoPayPeriod([], '2026-09-23')).toEqual({ kind: 'noIncome' });
    expect(whyNoPayPeriod([income({ endedOn: '2026-01-01' })], '2026-09-23')).toEqual({ kind: 'noIncome' });
  });

  it('names the job that needs a payday to count from', () => {
    const job = everyTwoWeeks(undefined);
    expect(currentPayPeriod([job], '2026-09-23')).toBeNull();
    expect(whyNoPayPeriod([job], '2026-09-23')).toEqual({ kind: 'needsRecentPayday', source: job });
  });

  it('treats a first payday still in the future the same way', () => {
    const job = everyTwoWeeks('2026-10-02');
    expect(currentPayPeriod([job], '2026-09-23')).toBeNull();
    expect(whyNoPayPeriod([job], '2026-09-23')).toEqual({ kind: 'needsRecentPayday', source: job });
  });
});

describe('paydaysFrom', () => {
  // 15th and last day; on the 15th itself one job is paid today.
  const paidToday = income({ name: 'Main job', daysOfMonth: [15, 31], netMinor: 185_000 });
  const paidLater = income({ name: 'Weekend job', frequency: 'monthly', daysOfMonth: [20], netMinor: 40_000 });

  it('splits paydays into today and still to come', () => {
    const p = paydaysFrom([paidToday, paidLater], '2026-09-15');
    expect(p.today.map((x) => x.source.name)).toEqual(['Main job']);
    expect(p.soon.map((x) => x.source.name)).toEqual(['Weekend job']);
  });

  // "About $X a month between them" left out a job whose payday was today,
  // understating the month by a whole paycheck's worth of income.
  it('counts every job in the monthly figure, including one paid today', () => {
    const p = paydaysFrom([paidToday, paidLater], '2026-09-15');
    expect(p.monthlyMinor).toBe(185_000 * 2 + 40_000);
  });
});
