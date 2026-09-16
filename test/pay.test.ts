import { describe, expect, it } from 'vitest';
import {
  describeFrequency,
  weekendShiftOf,
  nextPayday,
  paydaysBetween,
  PERIODS_PER_YEAR,
} from '../src/lib/pay';
import { daysBetween } from '../src/lib/time';
import { isHoliday } from '../src/lib/holidays';
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
    // These tests are about the schedule itself, so weekend adjustment is off
    // unless a test turns it on. The app's own default is 'friday'.
    weekendShift: 'none',
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


describe('weekend paydays', () => {
  // Most US employers pay early rather than late when payday lands on a
  // weekend. These dates are real: 31 May 2026 is a Sunday, 28 Feb 2026 a
  // Saturday, 15 Mar 2026 a Sunday.
  const twice = (weekendShift: 'none' | 'friday' | 'monday') =>
    income({ frequency: 'semimonthly', firstPaid: undefined, daysOfMonth: [15, 31], weekendShift });

  it('moves a Sunday payday back to the Friday', () => {
    expect(nextPayday(twice('friday'), '2026-05-16')).toBe('2026-05-29');
  });

  it('moves a Saturday payday back to the Friday', () => {
    expect(nextPayday(twice('friday'), '2026-02-16')).toBe('2026-02-27');
  });

  it('can move forward to the Monday instead', () => {
    expect(nextPayday(twice('monday'), '2026-05-16')).toBe('2026-06-01');
    expect(nextPayday(twice('monday'), '2026-02-17')).toBe('2026-03-02');
  });

  it('finds a payday that shifted forward into today', () => {
    // 15 Feb 2026 is a Sunday, so under "Monday after" that payday IS the 16th.
    // Searching only from today forward would miss it and report the next one,
    // telling you payday is a fortnight away on the morning it arrives.
    expect(nextPayday(twice('monday'), '2026-02-16')).toBe('2026-02-16');
  });

  it('finds a payday that shifted backward into today', () => {
    // The mirror case: 31 May 2026 is a Sunday, so under "Friday before" that
    // payday is the 29th.
    expect(nextPayday(twice('friday'), '2026-05-29')).toBe('2026-05-29');
  });

  it('leaves a weekday payday alone', () => {
    // 15 May 2026 is a Friday already.
    expect(nextPayday(twice('friday'), '2026-05-01')).toBe('2026-05-15');
  });

  it('does nothing at all when set to none', () => {
    expect(nextPayday(twice('none'), '2026-05-16')).toBe('2026-05-31');
  });

  it('can pull a payday back into the previous month', () => {
    // 1 Aug 2026 is a Saturday, so that payday is really 31 July.
    const firstOfMonth = income({
      frequency: 'monthly', firstPaid: undefined, daysOfMonth: [1], weekendShift: 'friday',
    });
    expect(nextPayday(firstOfMonth, '2026-07-20')).toBe('2026-07-31');
  });

  it('never lands on a weekend once shifting is on', () => {
    for (const shift of ['friday', 'monday'] as const) {
      const dates = paydaysBetween(twice(shift), '2026-01-01', '2026-12-31');
      for (const d of dates) {
        const day = new Date(`${d}T12:00:00`).getDay();
        expect([0, 6]).not.toContain(day);
      }
    }
  });

  it('still counts the right number of paycheques a year', () => {
    // Shifting moves dates; it must never add or drop a payday.
    expect(paydaysBetween(twice('friday'), '2026-01-01', '2026-12-31')).toHaveLength(24);
    expect(paydaysBetween(twice('monday'), '2026-01-01', '2026-12-31')).toHaveLength(24);
  });

  it('does not let shifts compound on an interval schedule', () => {
    // The cycle is measured from the nominal date. If a shifted Friday fed back
    // into the schedule, an every-2-weeks job anchored on a Saturday would creep
    // a day earlier every payday until it had drifted off the calendar.
    // Holidays are off here so this isolates the weekend rule: every payday is
    // the Friday before its nominal Saturday, so they stay exactly 14 apart.
    const saturdayAnchored = income({
      frequency: 'biweekly', firstPaid: '2026-01-03', weekendShift: 'friday', holidays: [],
    });
    const dates = paydaysBetween(saturdayAnchored, '2026-01-01', '2026-12-31');
    expect(dates).toHaveLength(26);
    for (let i = 1; i < dates.length; i++) {
      expect(daysBetween(dates[i - 1], dates[i])).toBe(14);
    }
    expect(dates[0]).toBe('2026-01-02');
  });

  it('still does not compound once holidays are shifting dates too', () => {
    // With holidays on, consecutive paydays are no longer a flat 14 apart - a
    // Christmas-week one rolls further back. What must hold is that the
    // underlying cycle is untouched: same number of paydays, and each one
    // within a few days of where the unshifted schedule put it.
    // Measured mid-year on purpose. Across a year boundary the counts legitimately
    // differ: a Saturday 2 Jan payday rolls back past New Year's Day into the
    // previous December, so that calendar year really does receive an extra one.
    const base = { frequency: 'biweekly' as const, firstPaid: '2026-01-03' };
    const nominal = paydaysBetween(income({ ...base, weekendShift: 'none' }), '2026-02-01', '2026-11-30');
    const shifted = paydaysBetween(income({ ...base, weekendShift: 'friday' }), '2026-02-01', '2026-11-30');

    expect(shifted).toHaveLength(nominal.length);
    for (let i = 0; i < shifted.length; i++) {
      const moved = Math.abs(daysBetween(shifted[i], nominal[i]));
      expect(moved).toBeLessThanOrEqual(6);
    }
  });

  it('defaults to the Friday before for records saved before the option existed', () => {
    const legacy = income({ weekendShift: undefined });
    expect(weekendShiftOf(legacy)).toBe('friday');
  });
});


describe('paydays that land on a holiday', () => {
  const lastDay = (partial = {}) =>
    income({ frequency: 'semimonthly', firstPaid: undefined, daysOfMonth: [15, 31], weekendShift: 'friday', ...partial });

  it('moves off the day the office is shut for the new year', () => {
    // The case that prompted all this: 1 Jan 2028 is a Saturday, so Friday
    // 31 Dec 2027 is the day off - and it is a payday.
    expect(nextPayday(lastDay(), '2027-12-20')).toBe('2027-12-30');
  });

  it('rolls back more than one day when a weekend and a holiday sit together', () => {
    // 26 Dec 2026 is a Saturday; the 25th is Christmas, a Friday.
    const boxingWeek = income({
      frequency: 'monthly', firstPaid: undefined, daysOfMonth: [26], weekendShift: 'friday',
    });
    expect(nextPayday(boxingWeek, '2026-12-20')).toBe('2026-12-24');
  });

  it('steps back past Thanksgiving when payday is the Friday after it', () => {
    // 27 Nov 2026 is the day after Thanksgiving, itself a holiday, and the 26th
    // is Thanksgiving - so it lands on the Wednesday.
    const late = income({
      frequency: 'monthly', firstPaid: undefined, daysOfMonth: [27], weekendShift: 'friday',
    });
    expect(nextPayday(late, '2026-11-20')).toBe('2026-11-25');
  });

  it('can move forward past a holiday instead', () => {
    const forward = income({
      frequency: 'monthly', firstPaid: undefined, daysOfMonth: [25], weekendShift: 'monday',
    });
    // 25 Dec 2026 is Christmas on a Friday; forward lands on the Monday.
    expect(nextPayday(forward, '2026-12-01')).toBe('2026-12-28');
  });

  it('ignores holidays entirely when shifting is off', () => {
    expect(nextPayday(lastDay({ weekendShift: 'none' }), '2027-12-20')).toBe('2027-12-31');
  });

  it('ignores holidays a job does not observe', () => {
    // Same December, but this employer works through the new year.
    expect(nextPayday(lastDay({ holidays: [] }), '2027-12-20')).toBe('2027-12-31');
  });

  it('never lands on a weekend or an observed holiday, across a whole year', () => {
    const dates = paydaysBetween(lastDay(), '2027-01-01', '2027-12-31');
    for (const d of dates) {
      expect([0, 6]).not.toContain(new Date(`${d}T12:00:00`).getDay());
      expect(isHoliday(d)).toBe(false);
    }
  });

  it('still counts the right number of paycheques with holidays in play', () => {
    // Rolling moves dates; it must never add or drop a payday.
    expect(paydaysBetween(lastDay(), '2027-01-01', '2027-12-31')).toHaveLength(24);
    const weekly = income({ frequency: 'weekly', firstPaid: '2027-01-01', weekendShift: 'friday' });
    expect(paydaysBetween(weekly, '2027-01-01', '2027-12-31')).toHaveLength(52);
  });
});


describe('a payday that rolls across a year boundary', () => {
  it('is counted in the year it actually arrives', () => {
    // 2 Jan 2027 is a Saturday and 1 Jan is New Year's Day, so that paycheque
    // really lands on Thursday 31 Dec 2026. Reporting it in 2027 would put
    // money in a month it was never in.
    const fortnightly = income({ frequency: 'biweekly', firstPaid: '2026-01-03', weekendShift: 'friday' });
    expect(paydaysBetween(fortnightly, '2026-12-01', '2026-12-31')).toContain('2026-12-31');
    expect(paydaysBetween(fortnightly, '2027-01-01', '2027-01-31')).not.toContain('2027-01-02');
  });
});


describe('income saved before holidays existed', () => {
  it('picks up the default holiday set rather than losing holiday handling', () => {
    // No weekendShift, no holidays - exactly the shape already on the phone.
    const legacy = {
      id: 'i1', name: 'Main job', frequency: 'semimonthly', daysOfMonth: [15, 31],
      grossMinor: 250_000, netMinor: 185_000, deductions: [], currency: 'USD', notes: '',
      createdAt: 0, updatedAt: 0,
    } as IncomeSource;
    // 31 Dec 2027 is the observed New Year holiday, so this must move to the 30th.
    expect(nextPayday(legacy, '2027-12-20')).toBe('2027-12-30');
  });
});
