import { describe, expect, it } from 'vitest';
import {
  describeFrequency,
  nextPayday,
  paydaysBetween,
  PERIODS_PER_YEAR,
} from '../src/lib/pay';
import { daysBetween } from '../src/lib/time';
import type { IncomeSource } from '../src/types';

function income(partial: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: 'i1',
    name: 'Main job',
    frequency: 'biweekly',
    firstPaid: '2026-01-02',
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

describe('periods per year', () => {
  it('keeps every-2-weeks and twice-a-month apart', () => {
    // The distinction this whole module exists for. Conflating them misstates
    // annual income by two whole paycheques.
    expect(PERIODS_PER_YEAR.biweekly).toBe(26);
    expect(PERIODS_PER_YEAR.semimonthly).toBe(24);
    expect(PERIODS_PER_YEAR.weekly).toBe(52);
    expect(PERIODS_PER_YEAR.monthly).toBe(12);
  });
});

describe('interval schedules (weekly, every 2 weeks)', () => {
  it('returns the anchor itself when asking from before it', () => {
    expect(nextPayday(income({ firstPaid: '2026-01-02' }), '2025-12-20')).toBe('2026-01-02');
  });

  it('returns today when today is a payday', () => {
    expect(nextPayday(income({ firstPaid: '2026-01-02' }), '2026-01-02')).toBe('2026-01-02');
    expect(nextPayday(income({ firstPaid: '2026-01-02' }), '2026-01-16')).toBe('2026-01-16');
  });

  it('steps 14 days for every 2 weeks', () => {
    expect(nextPayday(income(), '2026-01-03')).toBe('2026-01-16');
    expect(nextPayday(income(), '2026-01-17')).toBe('2026-01-30');
  });

  it('steps 7 days for weekly', () => {
    const weekly = income({ frequency: 'weekly', firstPaid: '2026-01-02' });
    expect(nextPayday(weekly, '2026-01-03')).toBe('2026-01-09');
  });

  it('crosses month and year boundaries without drifting', () => {
    expect(nextPayday(income({ firstPaid: '2026-12-25' }), '2026-12-26')).toBe('2027-01-08');
    expect(nextPayday(income({ firstPaid: '2026-01-30' }), '2026-01-31')).toBe('2026-02-13');
  });

  it('lands on the same weekday every time', () => {
    const dates = paydaysBetween(income({ firstPaid: '2026-01-02' }), '2026-01-01', '2026-12-31');
    const weekdays = new Set(dates.map((d) => new Date(`${d}T12:00:00`).getDay()));
    expect(weekdays.size).toBe(1);
  });

  it('gives 26 paydays in a year, each a fortnight apart', () => {
    const dates = paydaysBetween(income({ firstPaid: '2026-01-02' }), '2026-01-02', '2026-12-31');
    expect(dates).toHaveLength(26);
    for (let i = 1; i < dates.length; i++) expect(daysBetween(dates[i - 1], dates[i])).toBe(14);
  });

  it('gives 52 paydays a year when weekly', () => {
    const weekly = income({ frequency: 'weekly', firstPaid: '2026-01-02' });
    expect(paydaysBetween(weekly, '2026-01-02', '2026-12-31')).toHaveLength(52);
  });

  it('says nothing rather than guessing when there is no anchor date', () => {
    expect(nextPayday(income({ firstPaid: undefined }), '2026-03-01')).toBeNull();
  });
});

describe('twice a month, on fixed dates', () => {
  const twice = (daysOfMonth: number[]) =>
    income({ frequency: 'semimonthly', firstPaid: undefined, daysOfMonth });

  it('pays on the 15th and the last day when set to [15, 31]', () => {
    expect(nextPayday(twice([15, 31]), '2026-05-01')).toBe('2026-05-15');
    expect(nextPayday(twice([15, 31]), '2026-05-16')).toBe('2026-05-31');
  });

  it('clamps the last day to the length of a short month', () => {
    // The case a naive "day 31" would break: February, and the 30-day months.
    expect(nextPayday(twice([15, 31]), '2026-02-16')).toBe('2026-02-28');
    expect(nextPayday(twice([15, 31]), '2026-04-16')).toBe('2026-04-30');
    expect(nextPayday(twice([15, 31]), '2026-06-16')).toBe('2026-06-30');
  });

  it('handles a leap February', () => {
    expect(nextPayday(twice([15, 31]), '2028-02-16')).toBe('2028-02-29');
  });

  it('supports the 1st-and-15th schedule too', () => {
    expect(nextPayday(twice([1, 15]), '2026-03-02')).toBe('2026-03-15');
    expect(nextPayday(twice([1, 15]), '2026-03-16')).toBe('2026-04-01');
  });

  it('rolls into the next month after the final payday', () => {
    expect(nextPayday(twice([15, 31]), '2026-12-31')).toBe('2026-12-31');
    expect(nextPayday(twice([15, 31]), '2027-01-01')).toBe('2027-01-15');
  });

  it('gives exactly 24 paydays across a year', () => {
    expect(paydaysBetween(twice([15, 31]), '2026-01-01', '2026-12-31')).toHaveLength(24);
    expect(paydaysBetween(twice([1, 15]), '2026-01-01', '2026-12-31')).toHaveLength(24);
  });

  it('never returns a duplicate when both anchors clamp to the same day', () => {
    // 30 and 31 both mean the last day in November - that is one payday.
    const dates = paydaysBetween(twice([30, 31]), '2026-11-01', '2026-11-30');
    expect(dates).toEqual(['2026-11-30']);
  });
});

describe('monthly', () => {
  const monthly = (day: number) => income({ frequency: 'monthly', firstPaid: undefined, daysOfMonth: [day] });

  it('pays once a month on the chosen day', () => {
    expect(nextPayday(monthly(1), '2026-03-02')).toBe('2026-04-01');
    expect(nextPayday(monthly(25), '2026-03-02')).toBe('2026-03-25');
  });

  it('gives 12 paydays a year', () => {
    expect(paydaysBetween(monthly(15), '2026-01-01', '2026-12-31')).toHaveLength(12);
  });

  it('clamps a 31st to short months', () => {
    expect(nextPayday(monthly(31), '2026-02-01')).toBe('2026-02-28');
  });
});

describe('income that has ended', () => {
  it('has no future paydays', () => {
    expect(nextPayday(income({ endedOn: '2026-03-01' }), '2026-06-01')).toBeNull();
    expect(paydaysBetween(income({ endedOn: '2026-03-01' }), '2026-06-01', '2026-12-31')).toEqual([]);
  });

  it('still reports paydays from before it ended', () => {
    const ended = income({ firstPaid: '2026-01-02', endedOn: '2026-02-28' });
    expect(nextPayday(ended, '2026-01-20')).toBe('2026-01-30');
  });
});

describe('describeFrequency', () => {
  it('reads plainly for intervals', () => {
    expect(describeFrequency(income({ frequency: 'weekly' }))).toBe('weekly');
    expect(describeFrequency(income({ frequency: 'biweekly' }))).toBe('every 2 weeks');
  });

  it('names the actual dates for fixed schedules', () => {
    expect(describeFrequency(income({ frequency: 'semimonthly', daysOfMonth: [1, 15] }))).toBe(
      'twice a month, on the 1st and the 15th',
    );
  });

  it('calls a clamped day the last day, because that is what it means', () => {
    expect(describeFrequency(income({ frequency: 'semimonthly', daysOfMonth: [15, 31] }))).toBe(
      'twice a month, on the 15th and the last day',
    );
  });

  it('gets the awkward ordinals right', () => {
    expect(describeFrequency(income({ frequency: 'monthly', daysOfMonth: [2] }))).toContain('2nd');
    expect(describeFrequency(income({ frequency: 'monthly', daysOfMonth: [3] }))).toContain('3rd');
    expect(describeFrequency(income({ frequency: 'monthly', daysOfMonth: [11] }))).toContain('11th');
    expect(describeFrequency(income({ frequency: 'monthly', daysOfMonth: [21] }))).toContain('21st');
  });
});
