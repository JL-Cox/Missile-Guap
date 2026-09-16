import { describe, expect, it } from 'vitest';
import {
  dayInMonth,
  describeDays,
  lastDayOfMonth,
  monthDays,
  monthsBetween,
  normaliseDays,
  nthMonthDay,
} from '../src/lib/monthdays';
import { daysBetween } from '../src/lib/time';

describe('dayInMonth', () => {
  it('resolves an ordinary day', () => {
    expect(dayInMonth(2026, 0, 15)).toBe('2026-01-15');
  });

  it('clamps to the end of a short month, which is what "the last day" means', () => {
    expect(dayInMonth(2026, 1, 31)).toBe('2026-02-28'); // February
    expect(dayInMonth(2028, 1, 31)).toBe('2028-02-29'); // leap year
    expect(dayInMonth(2026, 3, 31)).toBe('2026-04-30'); // April
  });

  it('takes a month index outside the year, so callers can count forward freely', () => {
    expect(dayInMonth(2026, 12, 5)).toBe('2027-01-05');
    expect(dayInMonth(2026, -1, 5)).toBe('2025-12-05');
    expect(dayInMonth(2026, 13, 31)).toBe('2027-02-28');
  });

  it('never produces day zero or a negative day', () => {
    expect(dayInMonth(2026, 0, 0)).toBe('2026-01-01');
    expect(dayInMonth(2026, 0, -4)).toBe('2026-01-01');
  });

  it('agrees with lastDayOfMonth', () => {
    expect(lastDayOfMonth(2026, 1)).toBe(28);
    expect(lastDayOfMonth(2028, 1)).toBe(29);
    expect(lastDayOfMonth(2026, 11)).toBe(31);
  });
});

describe('normaliseDays', () => {
  it('sorts, rounds and removes repeats', () => {
    expect(normaliseDays([15, 1, 15], [99])).toEqual([1, 15]);
    expect(normaliseDays([2.7], [99])).toEqual([2]);
  });

  it('holds values inside a month', () => {
    expect(normaliseDays([0, 40], [99])).toEqual([1, 31]);
  });

  it('drops nonsense rather than producing an invalid date', () => {
    expect(normaliseDays([Number.NaN, 12], [99])).toEqual([12]);
  });

  it('falls back when there is nothing usable, so a schedule is never empty', () => {
    expect(normaliseDays(undefined, [1, 15])).toEqual([1, 15]);
    expect(normaliseDays([], [1, 15])).toEqual([1, 15]);
    expect(normaliseDays([Number.NaN], [1, 15])).toEqual([1, 15]);
  });
});

describe('monthDays', () => {
  it('returns the month\'s dates in order', () => {
    expect(monthDays([15, 1], 2026, 0)).toEqual(['2026-01-01', '2026-01-15']);
  });

  it('keeps two days that clamp onto the same date, because that is two events', () => {
    // Collapsing them would make the yearly total disagree with the dates.
    expect(monthDays([30, 31], 2026, 1)).toEqual(['2026-02-28', '2026-02-28']);
  });
});

describe('nthMonthDay', () => {
  const on1st15th = (anchor: string, n: number) => nthMonthDay([1, 15], anchor, n);

  it('starts on the anchor when the anchor is itself a scheduled day', () => {
    expect(on1st15th('2026-01-01', 0)).toBe('2026-01-01');
    expect(on1st15th('2026-01-01', 1)).toBe('2026-01-15');
    expect(on1st15th('2026-01-01', 2)).toBe('2026-02-01');
  });

  it('starts on the next scheduled day when the anchor is between two', () => {
    expect(on1st15th('2026-01-10', 0)).toBe('2026-01-15');
    expect(on1st15th('2026-01-10', 1)).toBe('2026-02-01');
  });

  it('moves into the next month when the anchor is past every day this month', () => {
    expect(on1st15th('2026-01-20', 0)).toBe('2026-02-01');
    expect(on1st15th('2026-12-20', 0)).toBe('2027-01-01');
  });

  it('crosses a year boundary in step', () => {
    expect(on1st15th('2026-12-01', 2)).toBe('2027-01-01');
    expect(on1st15th('2026-12-01', 3)).toBe('2027-01-15');
  });

  it('produces exactly 24 dates across a year', () => {
    const dates = Array.from({ length: 24 }, (_, i) => on1st15th('2026-01-01', i));
    expect(dates[0]).toBe('2026-01-01');
    expect(dates[23]).toBe('2026-12-15');
    expect(new Set(dates).size).toBe(24);
  });

  it('recovers the last day after a short month instead of drifting', () => {
    // The failure this guards is stepping: 31 Jan -> 28 Feb -> 28 Mar, losing
    // the 31st forever.
    expect(nthMonthDay([31], '2026-01-31', 0)).toBe('2026-01-31');
    expect(nthMonthDay([31], '2026-01-31', 1)).toBe('2026-02-28');
    expect(nthMonthDay([31], '2026-01-31', 2)).toBe('2026-03-31');
    expect(nthMonthDay([31], '2026-01-31', 3)).toBe('2026-04-30');
  });

  it('handles the 15th and the last day', () => {
    expect(nthMonthDay([15, 31], '2026-02-01', 0)).toBe('2026-02-15');
    expect(nthMonthDay([15, 31], '2026-02-01', 1)).toBe('2026-02-28');
    expect(nthMonthDay([15, 31], '2026-02-01', 2)).toBe('2026-03-15');
  });

  it('never goes backwards, over years of dates', () => {
    let previous = nthMonthDay([1, 15], '2026-01-05', 0);
    for (let n = 1; n < 200; n++) {
      const date = nthMonthDay([1, 15], '2026-01-05', n);
      expect(daysBetween(previous, date)).toBeGreaterThan(0);
      previous = date;
    }
  });
});

describe('monthsBetween', () => {
  it('counts calendar months, not thirty-day blocks', () => {
    expect(monthsBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(monthsBetween('2026-01-01', '2026-01-31')).toBe(0);
    expect(monthsBetween('2026-01-15', '2027-03-15')).toBe(14);
    expect(monthsBetween('2026-03-15', '2026-01-15')).toBe(-2);
  });
});

describe('describeDays', () => {
  it('reads as English', () => {
    expect(describeDays([1, 15])).toBe('the 1st and the 15th');
    expect(describeDays([2])).toBe('the 2nd');
    expect(describeDays([1, 10, 20])).toBe('the 1st, the 10th and the 20th');
  });

  it('calls a clamped day the last day, because that is what it means', () => {
    expect(describeDays([15, 31])).toBe('the 15th and the last day');
    expect(describeDays([29])).toBe('the last day');
  });

  it('gets the awkward ordinals right', () => {
    expect(describeDays([3])).toBe('the 3rd');
    expect(describeDays([11])).toBe('the 11th');
    expect(describeDays([12])).toBe('the 12th');
    expect(describeDays([13])).toBe('the 13th');
    expect(describeDays([21])).toBe('the 21st');
    expect(describeDays([22])).toBe('the 22nd');
  });

  it('sorts, so the order they were typed in does not show', () => {
    expect(describeDays([15, 1])).toBe('the 1st and the 15th');
  });
});
