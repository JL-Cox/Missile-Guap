import { describe, expect, it } from 'vitest';
import {
  advanceCycle,
  billingDatesBetween,
  describeBilling,
  describeCycle,
  describeRecurrence,
  nextBilling,
  nextOccurrence,
  occurrence,
} from '../src/lib/recurrence';
import { daysBetween, fromDateKey } from '../src/lib/time';
import type { Subscription } from '../src/types';

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: 's1',
    name: 'Test',
    amountMinor: 999,
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

describe('advanceCycle', () => {
  it('steps by the right unit', () => {
    expect(advanceCycle('2026-01-15', 'weekly', 1)).toBe('2026-01-22');
    expect(advanceCycle('2026-01-15', 'monthly', 1)).toBe('2026-02-15');
    expect(advanceCycle('2026-01-15', 'quarterly', 1)).toBe('2026-04-15');
    expect(advanceCycle('2026-01-15', 'yearly', 1)).toBe('2027-01-15');
  });

  it('honours "every N"', () => {
    expect(advanceCycle('2026-01-15', 'weekly', 2)).toBe('2026-01-29');
    expect(advanceCycle('2026-01-15', 'monthly', 6)).toBe('2026-07-15');
  });
});

describe('nextBilling', () => {
  it('returns the first date when billing has not started yet', () => {
    expect(nextBilling(sub(), '2026-01-01')).toBe('2026-01-15');
  });

  it('returns today when a charge lands today', () => {
    expect(nextBilling(sub(), '2026-01-15')).toBe('2026-01-15');
    expect(nextBilling(sub(), '2026-03-15')).toBe('2026-03-15');
  });

  it('rolls forward past dates', () => {
    expect(nextBilling(sub(), '2026-03-16')).toBe('2026-04-15');
    expect(nextBilling(sub({ cycle: 'weekly' }), '2026-02-01')).toBe('2026-02-05');
  });

  it('handles a start date years in the past without hanging', () => {
    const old = sub({ firstBilled: '2005-06-10', cycle: 'monthly' });
    expect(nextBilling(old, '2026-09-15')).toBe('2026-10-10');
  });

  it('clamps month-end dates instead of skipping a month', () => {
    const endOfMonth = sub({ firstBilled: '2026-01-31' });
    expect(nextBilling(endOfMonth, '2026-02-01')).toBe('2026-02-28');
  });

  it('returns null once cancelled', () => {
    expect(nextBilling(sub({ endedOn: '2026-02-01' }), '2026-03-01')).toBeNull();
  });
});

describe('billingDatesBetween', () => {
  it('lists every charge in the window', () => {
    const dates = billingDatesBetween(sub({ cycle: 'weekly' }), '2026-02-01', '2026-02-28');
    expect(dates).toEqual(['2026-02-05', '2026-02-12', '2026-02-19', '2026-02-26']);
  });

  it('is empty when nothing is charged in the window', () => {
    expect(billingDatesBetween(sub({ cycle: 'yearly' }), '2026-03-01', '2026-03-31')).toEqual([]);
  });

  it('finds a single-day hit, which is how the agenda detects renewals', () => {
    expect(billingDatesBetween(sub(), '2026-05-15', '2026-05-15')).toEqual(['2026-05-15']);
    expect(billingDatesBetween(sub(), '2026-05-16', '2026-05-16')).toEqual([]);
  });
});

describe('nextOccurrence', () => {
  it('steps daily and monthly recurrences', () => {
    expect(nextOccurrence({ kind: 'daily', every: 1 }, '2026-09-15')).toBe('2026-09-16');
    expect(nextOccurrence({ kind: 'daily', every: 3 }, '2026-09-15')).toBe('2026-09-18');
    expect(nextOccurrence({ kind: 'monthly', every: 1 }, '2026-09-15')).toBe('2026-10-15');
  });

  it('walks to the next named weekday within the same week', () => {
    // 2026-09-15 is a Tuesday. Mon/Wed/Fri means Wednesday is next.
    expect(nextOccurrence({ kind: 'weekly', every: 1, weekdays: [1, 3, 5] }, '2026-09-15')).toBe('2026-09-16');
  });

  it('wraps to the first named weekday of the next week', () => {
    // From Friday, with Mon/Wed/Fri, the next one is Monday.
    expect(nextOccurrence({ kind: 'weekly', every: 1, weekdays: [1, 3, 5] }, '2026-09-18')).toBe('2026-09-21');
  });

  it('skips whole weeks for "every N weeks"', () => {
    expect(nextOccurrence({ kind: 'weekly', every: 2, weekdays: [1] }, '2026-09-18')).toBe('2026-09-28');
  });

  it('falls back to a plain week step with no named days', () => {
    expect(nextOccurrence({ kind: 'weekly', every: 1 }, '2026-09-15')).toBe('2026-09-22');
  });
});

describe('describeRecurrence', () => {
  it('reads as English', () => {
    expect(describeRecurrence({ kind: 'daily', every: 1 })).toBe('Every day');
    expect(describeRecurrence({ kind: 'daily', every: 3 })).toBe('Every 3 days');
    expect(describeRecurrence({ kind: 'weekly', every: 1, weekdays: [1, 4] })).toBe('Every Mon, Thu');
    expect(describeRecurrence({ kind: 'weekly', every: 2, weekdays: [0] })).toBe('Every 2 weeks on Sun');
  });
});

describe('month-end billing does not drift', () => {
  // Stepping one period at a time would turn 31 Jan into 28 Feb and then keep
  // billing on the 28th forever. Anchoring on the first date fixes that.
  const endOfMonth = sub({ firstBilled: '2026-01-31' });

  it('recovers the 31st after a short month', () => {
    expect(nextBilling(endOfMonth, '2026-02-01')).toBe('2026-02-28');
    expect(nextBilling(endOfMonth, '2026-03-01')).toBe('2026-03-31');
    expect(nextBilling(endOfMonth, '2026-04-01')).toBe('2026-04-30');
    expect(nextBilling(endOfMonth, '2026-05-01')).toBe('2026-05-31');
  });

  it('lists the run correctly', () => {
    expect(billingDatesBetween(endOfMonth, '2026-02-01', '2026-06-01')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });
});

describe('long-dormant subscriptions', () => {
  it('lands on the right date decades later, for every cycle', () => {
    expect(nextBilling(sub({ firstBilled: '2005-06-10' }), '2026-09-15')).toBe('2026-10-10');
    expect(nextBilling(sub({ firstBilled: '2005-06-10', cycle: 'weekly' }), '2026-09-15')).toBe('2026-09-18'); // 10 Jun 2005 was a Friday
    expect(nextBilling(sub({ firstBilled: '2005-06-10', cycle: 'quarterly' }), '2026-09-15')).toBe('2026-12-10');
    expect(nextBilling(sub({ firstBilled: '2005-06-10', cycle: 'yearly' }), '2026-09-15')).toBe('2027-06-10');
  });

  it('agrees with a brute-force walk from the start date', () => {
    const s = sub({ firstBilled: '2019-03-31', cycle: 'monthly', every: 2 });
    const from = '2026-09-15';
    let brute = s.firstBilled;
    let i = 0;
    // Recompute from the anchor each time, the same definition the code uses.
    while (true) {
      const candidate = advanceCycle(s.firstBilled, 'monthly', 2 * i);
      if (candidate >= from) { brute = candidate; break; }
      i++;
      if (i > 500) break;
    }
    expect(nextBilling(s, from)).toBe(brute);
  });
});


describe('every-2-weeks billing dates', () => {
  const fortnightly = (firstBilled: string) => sub({ cycle: 'weekly', every: 2, firstBilled });

  it('steps 14 days, not 7', () => {
    expect(nextBilling(fortnightly('2026-09-04'), '2026-09-05')).toBe('2026-09-18');
  });

  it('crosses a month boundary without drifting', () => {
    expect(nextBilling(fortnightly('2026-09-25'), '2026-09-26')).toBe('2026-10-09');
  });

  it('crosses a year boundary without drifting', () => {
    expect(nextBilling(fortnightly('2026-12-25'), '2026-12-26')).toBe('2027-01-08');
  });

  it('lands on the same weekday every time', () => {
    const dates = billingDatesBetween(fortnightly('2026-01-02'), '2026-01-02', '2026-12-31');
    const weekdays = new Set(dates.map((d) => fromDateKey(d).getDay()));
    expect(weekdays.size).toBe(1);
  });

  it('describes itself unambiguously on the card', () => {
    // Not "semi-weekly" or "bi-weekly", which readers disagree about.
    expect(describeCycle('weekly', 2)).toBe('every 2 weeks');
    expect(describeCycle('weekly', 1)).toBe('every week');
  });

  it('produces 26 charges across a year, each a fortnight apart', () => {
    const dates = billingDatesBetween(fortnightly('2026-01-02'), '2026-01-02', '2026-12-31');
    expect(dates).toHaveLength(26);
    for (let i = 1; i < dates.length; i++) {
      expect(daysBetween(dates[i - 1], dates[i])).toBe(14);
    }
  });
});


describe('twice-a-month billing', () => {
  // The whole reason this is its own cycle rather than a preset: 24 charges a
  // year on set dates, against 26 on a 14-day interval.
  const twice = (partial: Partial<Subscription> = {}) =>
    sub({ cycle: 'semimonthly', every: 1, daysOfMonth: [1, 15], firstBilled: '2026-01-01', ...partial });

  it('charges on the days of the month, not on an interval from the start date', () => {
    expect(nextBilling(twice(), '2026-01-01')).toBe('2026-01-01');
    expect(nextBilling(twice(), '2026-01-02')).toBe('2026-01-15');
    expect(nextBilling(twice(), '2026-01-16')).toBe('2026-02-01');
  });

  it('starts on the first of those days on or after the start date', () => {
    expect(nextBilling(twice({ firstBilled: '2026-01-10' }), '2026-01-01')).toBe('2026-01-15');
    // Past both days in its own month, so the run starts next month.
    expect(nextBilling(twice({ firstBilled: '2026-01-20' }), '2026-01-01')).toBe('2026-02-01');
  });

  it('produces 24 charges in a year, where every 2 weeks produces 26', () => {
    const fixed = billingDatesBetween(twice(), '2026-01-01', '2026-12-31');
    const fortnightly = billingDatesBetween(
      sub({ cycle: 'weekly', every: 2, firstBilled: '2026-01-02' }),
      '2026-01-02',
      '2026-12-31',
    );
    expect(fixed).toHaveLength(24);
    expect(fortnightly).toHaveLength(26);
  });

  it('lands on the same dates every month, which an interval cannot do', () => {
    const dates = billingDatesBetween(twice(), '2026-01-01', '2026-12-31');
    expect(new Set(dates.map((d) => d.slice(8)))).toEqual(new Set(['01', '15']));
  });

  it('clamps the last day rather than skipping a month', () => {
    const endOfMonth = twice({ daysOfMonth: [15, 31], firstBilled: '2026-01-15' });
    expect(billingDatesBetween(endOfMonth, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-15',
      '2026-01-31',
      '2026-02-15',
      '2026-02-28',
      '2026-03-15',
      '2026-03-31',
      '2026-04-15',
      '2026-04-30',
    ]);
  });

  it('ignores a stale "every 2" left behind by a previous rhythm', () => {
    // Twice a month is a pair of dates; nothing about it is halved or doubled
    // by an interval that belonged to a different cycle.
    expect(billingDatesBetween(twice({ every: 2 }), '2026-01-01', '2026-02-28')).toEqual(
      billingDatesBetween(twice(), '2026-01-01', '2026-02-28'),
    );
  });

  it('falls back to the 1st and the 15th rather than charging on no day at all', () => {
    expect(billingDatesBetween(twice({ daysOfMonth: undefined }), '2026-03-01', '2026-03-31')).toEqual([
      '2026-03-01',
      '2026-03-15',
    ]);
    expect(billingDatesBetween(twice({ daysOfMonth: [] }), '2026-03-01', '2026-03-31')).toEqual([
      '2026-03-01',
      '2026-03-15',
    ]);
  });

  it('finds a single-day hit, which is how the agenda detects renewals', () => {
    expect(billingDatesBetween(twice(), '2026-05-15', '2026-05-15')).toEqual(['2026-05-15']);
    expect(billingDatesBetween(twice(), '2026-05-16', '2026-05-16')).toEqual([]);
  });

  it('respects a cancellation like any other cycle', () => {
    expect(nextBilling(twice({ endedOn: '2026-01-20' }), '2026-01-16')).toBeNull();
    expect(nextBilling(twice({ endedOn: '2026-01-20' }), '2026-01-02')).toBe('2026-01-15');
  });

  it('lands on the right date decades later, without walking there', () => {
    expect(nextBilling(twice({ firstBilled: '2005-06-10' }), '2026-09-16')).toBe('2026-10-01');
    expect(nextBilling(twice({ firstBilled: '2005-06-10' }), '2026-09-15')).toBe('2026-09-15');
  });

  it('agrees with a brute-force walk from the start date', () => {
    // The index maths jumps straight to roughly the right charge and nudges;
    // this proves the nudging lands exactly where counting one by one does.
    const s = twice({ daysOfMonth: [3, 17, 28], firstBilled: '2019-03-20' });
    for (const from of ['2019-03-20', '2019-04-01', '2020-02-28', '2026-09-16', '2031-12-31']) {
      let brute = s.firstBilled;
      for (let i = 0; i < 1000; i++) {
        const candidate = occurrence(s, i);
        if (candidate >= from) { brute = candidate; break; }
      }
      expect(nextBilling(s, from)).toBe(brute);
    }
  });

  it('describes itself by its actual dates', () => {
    expect(describeCycle('semimonthly', 1, [1, 15])).toBe('twice a month, on the 1st and the 15th');
    expect(describeCycle('semimonthly', 1, [15, 31])).toBe('twice a month, on the 15th and the last day');
    expect(describeBilling(twice())).toBe('twice a month, on the 1st and the 15th');
  });

  it('says twice a month even with no days recorded, naming the fallback dates', () => {
    expect(describeCycle('semimonthly', 1)).toBe('twice a month, on the 1st and the 15th');
  });
});


describe('a subscription with an end date', () => {
  // These two guard an inverted comparison that shipped: it hid a charge still
  // due before a cancellation took effect, and kept showing charges after one.
  // Both directions are money errors, in opposite directions.
  it('still reports a charge due before the cancellation takes effect', () => {
    expect(nextBilling(sub({ endedOn: '2026-02-20' }), '2026-02-01')).toBe('2026-02-15');
  });

  it('reports nothing once the last charge is past the end date', () => {
    expect(nextBilling(sub({ endedOn: '2026-02-01' }), '2026-01-20')).toBeNull();
  });

  it('lists only the charges that fall on or before the end date', () => {
    expect(billingDatesBetween(sub({ endedOn: '2026-03-20' }), '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });
});
